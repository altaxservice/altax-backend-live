import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient, getUserAliases } from "../../common/assignment";
import { encryptValue, decryptTolerant, decryptClientPii } from "../../common/encryption";
import { composeAddress } from "../../common/address";
import { generateContractForService } from "../contracts/contracts.routes";
import { POA_COVERED_SERVICE_KEYS, POA_RELEASE_SERVICE_KEY } from "../contracts/contractContent";

/**
 * Best-effort: called after a client is created/updated with a newly-checked
 * service, so "check a service, save" alone is enough to get a suggested
 * contract without a separate trip to the Contracts section. Never throws —
 * generateContractForService already no-ops safely if a contract for this
 * client+service exists, and any other failure here (e.g. a bad template)
 * shouldn't block the client save that triggered it.
 *
 * Also the trigger point for the Authorization to Act and Release of
 * Information: the moment a client is checked for formation, permits &
 * licenses, or the SNAP retailer application, this generates BOTH the
 * ordinary engagement letter AND the authorization together, in the same
 * save — "so when the client signed for the service, he need to sign all
 * the document" in one sitting rather than a separate trip back for the
 * authorization later. generateContractForService's own no-op-if-exists
 * check keeps this safe to call on every save that touches a covered
 * service, not just the first one.
 */
async function autoGenerateContracts(clientId: string, serviceKeys: string[], createdBy: string): Promise<void> {
  for (const serviceKey of serviceKeys) {
    try {
      await generateContractForService({ clientId, serviceKey, createdBy });
    } catch {
      // best-effort — client save already succeeded, don't surface this as an error
    }
  }
  if (serviceKeys.some((k) => POA_COVERED_SERVICE_KEYS.includes(k))) {
    try {
      await generateContractForService({ clientId, serviceKey: POA_RELEASE_SERVICE_KEY, createdBy });
    } catch {
      // best-effort, same as above
    }
  }
}

export const clientsRouter = Router();

/**
 * List clients — mirrors alTaxV3PortalFilterData_: admin sees every client; staff sees
 * only clients they have at least one task assigned to them for (previously this
 * returned every client to any staff account — closed now that Tasks provides the
 * real assignment data to scope against).
 */
clientsRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const baseSelect = `SELECT client_id, client_name, entity_type, status, state, email, phone, assigned_to,
                              portal_enabled, client_type, service_type, services, sales_tax_frequency, payroll_frequency,
                              payroll_enabled, company_contact_name, company_contact_ssn, individual_ssn, ein,
                              payroll_system, eftps_enabled, md_withholding_frequency, mdui_enabled,
                              md_annual_report_enabled, business_return_type, sms_allowed, email_allowed,
                              w21099_enabled, preferred_language
                         FROM altax.v3_clients`;

  let rows: any[];
  if (req.user!.role === "admin") {
    rows = await query(`${baseSelect} ORDER BY client_name ASC`);
  } else {
    const aliases = await getUserAliases(req.user!.email);
    rows = await query(
      `${baseSelect}
        WHERE client_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($1::text[]))
        ORDER BY client_name ASC`,
      [Array.from(aliases)]
    );
  }

  rows = rows.map((row) => decryptClientPii(row));
  if (req.user!.role !== "admin") {
    for (const c of rows) {
      c.company_contact_ssn = maskTail(c.company_contact_ssn);
      c.individual_ssn = maskTail(c.individual_ssn);
      c.ein = maskTail(c.ein);
    }
  }

  res.json({ clients: rows });
}));

/**
 * Client profile — masks SSN/EIN/State Tax ID for everyone except Admin, matching the Sheets UI rule.
 * Access scoping ported from alTaxV3PortalClientAllowed_ via the shared canAccessClient helper:
 * admin sees any client; client role is locked to their own assigned clientId; staff need a
 * task assignment tying them to this client (same rule as the list route above). Employee is
 * excluded rather than falling through to canAccessClient's own-clientId match — this is the
 * firm's internal "company profile" for the employee's employer (address, payroll system, tax
 * enrollment flags, service type, internal notes), not something an employee has a right to see
 * about their employer. Confirmed live as the exact "company's billing and company profile"
 * exposure the user flagged, still reachable here directly even after the frontend-side fixes
 * (ClientContextPanel/route guards) removed every UI surface that called this for employees.
 */
clientsRouter.get("/:clientId", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (req.user!.role === "employee") return res.status(403).json({ error: "You do not have access to this client." });
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }

  const c = decryptClientPii(await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [clientId]));
  if (!c) return res.status(404).json({ error: "Client not found." });

  if (req.user!.role !== "admin") {
    c.individual_ssn = maskTail(c.individual_ssn);
    c.ein = maskTail(c.ein);
    c.state_tax_id = maskTail(c.state_tax_id);
    c.company_contact_ssn = maskTail(c.company_contact_ssn);
  }

  res.json({ client: c });
}));

/**
 * Lightweight per-client activity summary — powers the persistent client-context
 * panel (Open Tasks/Requests/Invoices/Balance) shown alongside Tasks, Documents,
 * Billing, Accounting, Reports, and Communications, mirroring the "ACCOUNT" block
 * in the legacy client side panel. Kept separate from the full profile fetch above
 * so pages that only need these counters don't pull the whole client row.
 */
clientsRouter.get("/:clientId/summary", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (req.user!.role === "employee") return res.status(403).json({ error: "You do not have access to this client." });
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }

  const [openTasks, taskStatusBreakdown, openRequests, invoiceBalance, employees, documents] = await Promise.all([
    queryOne<any>(
      `SELECT COUNT(*)::int AS count FROM altax.v3_tasks
        WHERE client_id = $1 AND lower(status) NOT IN ('completed','void','closed','archived')`,
      [clientId]
    ),
    // Feeds the Client panel's status breakdown — same open-task scope as the
    // count above, grouped so the panel can show "3 Overdue-ish / 2 Waiting"
    // instead of a single opaque number.
    query<any>(
      `SELECT status, COUNT(*)::int AS count FROM altax.v3_tasks
        WHERE client_id = $1 AND lower(status) NOT IN ('completed','void','closed','archived')
        GROUP BY status ORDER BY count DESC`,
      [clientId]
    ),
    queryOne<any>(
      `SELECT COUNT(*)::int AS count FROM altax.v3_document_requests
        WHERE client_id = $1 AND lower(status) NOT IN ('closed','completed','void','archived')`,
      [clientId]
    ),
    queryOne<any>(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(balance_due), 0) AS balance FROM altax.v3_invoices
        WHERE client_id = $1 AND lower(status) NOT IN ('paid','void')`,
      [clientId]
    ),
    queryOne<any>(
      `SELECT COUNT(*)::int AS count FROM altax.v3_employees WHERE client_id = $1 AND lower(status) <> 'archived'`,
      [clientId]
    ),
    // Files actually on file for this client, so the panel can answer "do we
    // have their documents?" without opening the Documents page.
    queryOne<any>(
      `SELECT COUNT(*)::int AS count FROM altax.v3_document_uploads
        WHERE client_id = $1 AND lower(status) NOT IN ('removed','replaced')`,
      [clientId]
    ),
  ]);

  res.json({
    openTasks: openTasks?.count || 0,
    taskStatusBreakdown: (taskStatusBreakdown || []).map((r) => ({ status: r.status, count: r.count })),
    openRequests: openRequests?.count || 0,
    openInvoices: invoiceBalance?.count || 0,
    balanceDue: Number(invoiceBalance?.balance || 0),
    employeesCount: employees?.count || 0,
    documentsCount: documents?.count || 0,
  });
}));

const SWOT_FIELDS = [
  "overview", "strengths", "weaknesses", "opportunities", "threats",
  "taxRecommendations", "staffingRecommendations", "marketingRecommendations", "growthRecommendations", "additionalNotes",
] as const;
const SWOT_COLUMNS: Record<(typeof SWOT_FIELDS)[number], string> = {
  overview: "overview", strengths: "strengths", weaknesses: "weaknesses", opportunities: "opportunities", threats: "threats",
  taxRecommendations: "tax_recommendations", staffingRecommendations: "staffing_recommendations",
  marketingRecommendations: "marketing_recommendations", growthRecommendations: "growth_recommendations", additionalNotes: "additional_notes",
};

/**
 * Per-client business advisory analysis — a living document staff write and
 * revisit over time (one row per client, upserted below), not a dated log
 * entry. Broader than a classic 4-box SWOT by explicit ask: alongside the
 * standard Strengths/Weaknesses/Opportunities/Threats, staff can record
 * concrete category recommendations (tax savings + penalty/interest
 * avoidance, staffing, marketing, growth) plus an open "Additional Notes"
 * intake card for anything else supporting the strategy. See
 * sql/037_client_swot.sql.
 */
clientsRouter.get("/:clientId/swot", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const row = await queryOne<any>(`SELECT * FROM altax.v3_client_swot WHERE client_id = $1`, [clientId]);
  const swot: Record<string, any> = {};
  for (const field of SWOT_FIELDS) swot[field] = row?.[SWOT_COLUMNS[field]] || "";
  swot.updatedBy = row?.updated_by || null;
  swot.updatedAt = row?.updated_at || null;
  res.json({ swot });
}));

clientsRouter.patch("/:clientId/swot", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const body = req.body || {};
  const values = SWOT_FIELDS.map((f) => (body[f] !== undefined ? String(body[f]) : ""));

  await query(
    `INSERT INTO altax.v3_client_swot
       (client_id, overview, strengths, weaknesses, opportunities, threats,
        tax_recommendations, staffing_recommendations, marketing_recommendations, growth_recommendations, additional_notes,
        updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
     ON CONFLICT (client_id) DO UPDATE SET
       overview=$2, strengths=$3, weaknesses=$4, opportunities=$5, threats=$6,
       tax_recommendations=$7, staffing_recommendations=$8, marketing_recommendations=$9, growth_recommendations=$10, additional_notes=$11,
       updated_by=$12, updated_at=now()`,
    [clientId, ...values, req.user!.email]
  );
  await logAudit("Clients", "EDIT_SWOT", clientId, "", "", "", `Business advisory analysis (SWOT) updated by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

function nextActivityId(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `ACT-${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

/**
 * Manually-logged client interaction timeline — "Called about Q3 estimate," "In-person
 * meeting," etc. — distinct from the Communications log, which only captures messages
 * actually sent through this app (email/SMS/WhatsApp/portal note). A phone call or a
 * walk-in meeting leaves no trace otherwise. Merges in Communications rows as read-only
 * timeline entries (a cheap UNION, no schema change) so staff get one combined view
 * instead of checking two separate places. Admin/staff only — this is an internal
 * relationship-management tool, not something a client or employee portal user sees.
 */
clientsRouter.get("/:clientId/activity", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }

  const logged = await query<any>(
    `SELECT activity_id AS id, activity_type AS type, note, occurred_at, logged_by, 'log' AS source
       FROM altax.v3_client_activity_log WHERE client_id = $1`,
    [clientId]
  );
  const sent = await query<any>(
    `SELECT communication_id AS id, channel AS type, subject AS note, sent_at AS occurred_at, sent_by AS logged_by, 'communication' AS source
       FROM altax.v3_communications WHERE client_id = $1 AND sent_at IS NOT NULL`,
    [clientId]
  );
  const combined = [...logged, ...sent].sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
  res.json({ activity: combined });
}));

clientsRouter.post("/:clientId/activity", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const body = req.body || {};
  const activityType = String(body.activityType || "").trim();
  const note = String(body.note || "").trim();
  if (!activityType || !note) return res.status(400).json({ error: "Type and note are required." });

  const activityId = nextActivityId();
  await query(
    `INSERT INTO altax.v3_client_activity_log (activity_id, client_id, activity_type, note, occurred_at, logged_by)
     VALUES ($1,$2,$3,$4,now(),$5)`,
    [activityId, clientId, activityType, note, req.user!.email]
  );
  await logAudit("Clients", "LOG_ACTIVITY", activityId, "", "", activityType, `Activity logged for ${clientId} by ${req.user!.email}.`, req.user!.email);
  res.status(201).json({ ok: true, activityId });
}));

clientsRouter.post("/:clientId/activity/:activityId/delete", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, activityId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const row = await queryOne<any>(`SELECT * FROM altax.v3_client_activity_log WHERE activity_id = $1 AND client_id = $2`, [activityId, clientId]);
  if (!row) return res.status(404).json({ error: "Activity entry not found." });
  await query(`DELETE FROM altax.v3_client_activity_log WHERE activity_id = $1`, [activityId]);
  await logAudit("Clients", "DELETE_ACTIVITY", activityId, "", row.activity_type || "", "", `Activity entry deleted by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

/** Next sequential C-#### id, matching the existing client_id pattern in real data. */
async function nextClientId(): Promise<string> {
  const row = await queryOne<any>(
    `SELECT MAX(substring(client_id from '^C-(\\d+)$')::int) AS max_num FROM altax.v3_clients WHERE client_id ~ '^C-\\d+$'`
  );
  const next = (row?.max_num || 1000) + 1;
  return `C-${next}`;
}

/** camelCase API field -> [db column, isBoolean]. Allow-list ported 1:1 from alTaxV3UpdateClientProfile. */
const UPDATABLE_FIELDS: Record<string, { column: string; boolean?: boolean; date?: boolean; encrypted?: boolean }> = {
  clientName: { column: "client_name" },
  dbaName: { column: "dba_name" },
  entityType: { column: "entity_type" },
  // date_of_formation is a DATE column — an empty string (an optional field
  // left blank on Add Client) is not valid input for it, unlike every other
  // UPDATABLE_FIELDS entry so far, which are all text/boolean columns that
  // happily accept "". The `date` flag below coerces "" to null instead.
  dateOfFormation: { column: "date_of_formation", date: true },
  status: { column: "status" },
  state: { column: "state" },
  email: { column: "email" },
  phone: { column: "phone" },
  assignedTo: { column: "assigned_to" },
  salesTaxFrequency: { column: "sales_tax_frequency" },
  payrollEnabled: { column: "payroll_enabled", boolean: true },
  payrollFrequency: { column: "payroll_frequency" },
  payrollSystem: { column: "payroll_system" },
  eftpsEnabled: { column: "eftps_enabled", boolean: true },
  mdWithholdingFrequency: { column: "md_withholding_frequency" },
  mduiEnabled: { column: "mdui_enabled", boolean: true },
  mdAnnualReportEnabled: { column: "md_annual_report_enabled", boolean: true },
  businessReturnType: { column: "business_return_type" },
  smsAllowed: { column: "sms_allowed", boolean: true },
  emailAllowed: { column: "email_allowed", boolean: true },
  portalEnabled: { column: "portal_enabled", boolean: true },
  address: { column: "address" },
  streetAddress: { column: "street_address" },
  city: { column: "city" },
  zipCode: { column: "zip_code" },
  preferredContact: { column: "preferred_contact" },
  referralSource: { column: "referral_source" },
  notes: { column: "notes" },
  ein: { column: "ein", encrypted: true },
  individualSsn: { column: "individual_ssn", encrypted: true },
  stateTaxId: { column: "state_tax_id", encrypted: true },
  secretaryOfStateId: { column: "secretary_of_state_id" },
  companyContactName: { column: "company_contact_name" },
  companyContactTitle: { column: "company_contact_title" },
  companyContactSsn: { column: "company_contact_ssn", encrypted: true },
  // Separate from the client's own email/phone above — those are the company's
  // main line, this is how to reach the actual responsible-party person (who
  // may not be the one answering the main number), same distinction already
  // drawn for name/title/SSN.
  companyContactEmail: { column: "company_contact_email" },
  companyContactPhone: { column: "company_contact_phone" },
  // Home address for the Responsible Party person, separate from the
  // business's own address above — composed into company_contact_address
  // the same way street/city/state/zip compose into `address` (see the
  // POST/PATCH handlers below).
  companyContactStreetAddress: { column: "company_contact_street_address" },
  companyContactCity: { column: "company_contact_city" },
  companyContactState: { column: "company_contact_state" },
  companyContactZipCode: { column: "company_contact_zip_code" },
  clientType: { column: "client_type" },
  serviceType: { column: "service_type" },
  // Granular, multi-select firm service lines (tax_prep, bookkeeping, payroll,
  // sales_tax, formation, immigration, consulting) — drives contract suggestions
  // on the client profile (see contracts.routes.ts). Independent of the legacy
  // single-select serviceType above. A plain JS array is passed straight through
  // to the TEXT[] column; the pg driver serializes it automatically.
  services: { column: "services" },
  w21099Enabled: { column: "w21099_enabled", boolean: true },
  preferredLanguage: { column: "preferred_language" },
  // Advisory only, not enforced — see v3_clients.industry_category's schema comment.
  industryCategory: { column: "industry_category" },
};

/** Columns whose value must never appear in plain text in the audit log — see the PATCH route's redacted logAudit call below, matching the same "EDIT_SENSITIVE" pattern already used for employee SSN/EIN/bank edits. */
const ENCRYPTED_CLIENT_COLUMNS = new Set(
  Object.values(UPDATABLE_FIELDS).filter((f) => f.encrypted).map((f) => f.column)
);

/**
 * Create client — ported from alTaxPortalAddClient / clientProfileFormHtml's Add path.
 * Accepts the full ~30-field profile (same allow-list as the PATCH route below), not just
 * the handful of identity fields — legacy's Add and Edit forms share one field set, and this
 * mirrors that so a client created here doesn't need an immediate follow-up edit to fill in
 * compliance/tax-id/contact-preference fields.
 */
clientsRouter.post("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  if (!body.clientName) {
    return res.status(400).json({ error: "clientName is required." });
  }

  const dupe = await queryOne<any>(
    `SELECT client_id FROM altax.v3_clients WHERE lower(client_name) = lower($1) AND status <> 'Archived'`,
    [String(body.clientName).trim()]
  );
  if (dupe) {
    return res.status(409).json({ error: `A client named "${body.clientName}" already exists (${dupe.client_id}).` });
  }

  // Name matching alone misses the same legal entity re-entered under a
  // slightly different name (punctuation, "Inc" vs "Inc.", a typo) — this
  // firm also has many genuinely distinct clients with near-identical names
  // (franchise-style naming: "BIG BOYS CARRYOUT INC" / "BIG BOYS CARRYOUT 1
  // INC"), so fuzzy name matching would false-positive on those. EIN is the
  // one field that's actually unique per legal entity, so check it too
  // whenever one was entered, normalized to digits only so "12-3456789" and
  // "123456789" are recognized as the same EIN.
  const einDigits = String(body.ein || "").replace(/\D/g, "");
  if (einDigits) {
    // ein is now encrypted at rest, so a SQL-side regexp_replace against the raw
    // column (the old approach) would just compare digits pulled out of ciphertext
    // and never match anything real — the comparison has to happen after decryption,
    // in application code. Same linear scan cost as the old SQL version had anyway
    // (there was never an index on ein), just moved client-side.
    const candidates = await query<any>(
      `SELECT client_id, client_name, ein FROM altax.v3_clients WHERE ein IS NOT NULL AND ein <> '' AND status <> 'Archived'`
    );
    const einDupe = candidates
      .map((row) => ({ ...row, ein: decryptTolerant(row.ein) }))
      .find((row) => row.ein.replace(/\D/g, "") === einDigits);
    if (einDupe) {
      return res.status(409).json({ error: `A client with EIN ${body.ein} already exists: "${einDupe.client_name}" (${einDupe.client_id}).` });
    }
  }

  const clientId = String(body.clientId || "").trim() || await nextClientId();

  const columns = ["client_id"];
  const placeholders = ["$1"];
  const values: any[] = [clientId];
  for (const [key, { column, boolean, date, encrypted }] of Object.entries(UPDATABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      columns.push(column);
      values.push(
        boolean ? Boolean(body[key])
          : date ? (body[key] || null)
          : encrypted ? (String(body[key] || "").trim() ? encryptValue(String(body[key]).trim()) : null)
          : body[key]
      );
      placeholders.push(`$${values.length}`);
    }
  }
  if (!Object.prototype.hasOwnProperty.call(body, "address")
      && ["streetAddress", "city", "state", "zipCode"].some((k) => Object.prototype.hasOwnProperty.call(body, k))) {
    const composed = composeAddress({ street: body.streetAddress, city: body.city, state: body.state, zip: body.zipCode });
    if (!columns.includes("address")) {
      columns.push("address");
      values.push(composed);
      placeholders.push(`$${values.length}`);
    }
  }
  if (["companyContactStreetAddress", "companyContactCity", "companyContactState", "companyContactZipCode"].some((k) => Object.prototype.hasOwnProperty.call(body, k))) {
    const composed = composeAddress({ street: body.companyContactStreetAddress, city: body.companyContactCity, state: body.companyContactState, zip: body.companyContactZipCode });
    columns.push("company_contact_address");
    values.push(composed);
    placeholders.push(`$${values.length}`);
  }
  if (!columns.includes("status")) {
    columns.push("status");
    values.push("Active");
    placeholders.push(`$${values.length}`);
  }

  await query(
    `INSERT INTO altax.v3_clients (${columns.join(", ")}) VALUES (${placeholders.join(",")})`,
    values
  );

  await logAudit("Clients", "CLIENT_CREATED", clientId, "ClientName", "", body.clientName,
    "Client created via web app.", req.user!.email);

  if (Array.isArray(body.services) && body.services.length > 0) {
    await autoGenerateContracts(clientId, body.services, req.user!.email);
  }

  res.status(201).json({ ok: true, clientId });
}));

/**
 * Update client profile — ported from alTaxV3UpdateClientProfile: allow-listed fields only,
 * per-field audit diff logged only when a value actually changes. Access matches
 * alTaxPortalUpdateClientProfile: client-role edits are rejected outright ("Client profile
 * edits are limited to AL TAX staff.") via requireRole below, and staff are additionally
 * scoped to only clients they have a task assignment for (alTaxV3PortalClientAllowed_,
 * same rule as the list/detail routes above). Note: legacy's access check would technically
 * also allow an employee to edit their own employer's client profile — that's not opened up
 * here, since requireRole blocks employee outright and nothing in this codebase exercises
 * that legacy path; preserving it looked more like dead code than an intended capability.
 */
clientsRouter.patch("/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }

  const body = req.body || {};

  const old = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!old) return res.status(404).json({ error: "Client not found." });

  // Whether any encrypted (SSN/EIN/state-tax-ID) field actually changed — tracked
  // separately from `fields` since `fields[column]` holds ciphertext by the time the
  // UPDATE runs, so it can't be compared against decryptTolerant(old[column]) the way
  // the generic per-field diff loop below compares every other column.
  let sensitiveChanged = false;
  const fields: Record<string, any> = {};
  for (const [key, { column, boolean, date, encrypted }] of Object.entries(UPDATABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      if (encrypted) {
        const plaintext = String(body[key] || "").trim();
        if (plaintext !== decryptTolerant(old[column] || "")) sensitiveChanged = true;
        fields[column] = plaintext ? encryptValue(plaintext) : null;
      } else {
        fields[column] = boolean ? Boolean(body[key]) : date ? (body[key] || null) : body[key];
      }
    }
  }

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: "No client fields received." });
  }

  if (!Object.prototype.hasOwnProperty.call(body, "address")
      && ["streetAddress", "city", "state", "zipCode"].some((k) => Object.prototype.hasOwnProperty.call(body, k))) {
    fields.address = composeAddress({
      street: "street_address" in fields ? fields.street_address : old.street_address,
      city: "city" in fields ? fields.city : old.city,
      state: "state" in fields ? fields.state : old.state,
      zip: "zip_code" in fields ? fields.zip_code : old.zip_code,
    });
  }
  if (["companyContactStreetAddress", "companyContactCity", "companyContactState", "companyContactZipCode"].some((k) => Object.prototype.hasOwnProperty.call(body, k))) {
    fields.company_contact_address = composeAddress({
      street: "company_contact_street_address" in fields ? fields.company_contact_street_address : old.company_contact_street_address,
      city: "company_contact_city" in fields ? fields.company_contact_city : old.company_contact_city,
      state: "company_contact_state" in fields ? fields.company_contact_state : old.company_contact_state,
      zip: "company_contact_zip_code" in fields ? fields.company_contact_zip_code : old.company_contact_zip_code,
    });
  }

  const setClause = Object.keys(fields)
    .map((col, i) => `${col} = $${i + 2}`)
    .join(", ");
  await query(
    `UPDATE altax.v3_clients SET ${setClause}, updated_at = now(), updated_by = $${Object.keys(fields).length + 2} WHERE client_id = $1`,
    [clientId, ...Object.values(fields), req.user!.email]
  );

  for (const [col, newValue] of Object.entries(fields)) {
    // Encrypted columns never get their value into the audit log, even redacted-
    // looking — old[col]/newValue are ciphertext at this point, but logging
    // ciphertext-vs-ciphertext as "old"/"new" would still be pointless noise, and a
    // future refactor that decrypted one side and not the other could easily leak a
    // real SSN into v3_audit_log. One EDIT_SENSITIVE entry below covers all of them.
    if (ENCRYPTED_CLIENT_COLUMNS.has(col)) continue;
    const oldValue = old[col];
    if (String(oldValue ?? "") !== String(newValue ?? "")) {
      await logAudit(
        "Clients", "EDIT", clientId, col, String(oldValue ?? ""), String(newValue ?? ""),
        "Client updated from web app.", req.user!.email
      );
    }
  }
  if (sensitiveChanged) {
    await logAudit("Clients", "EDIT_SENSITIVE", clientId, "", "", "",
      `Sensitive client fields (SSN/EIN/state tax ID) updated by ${req.user!.email}.`, req.user!.email);
  }

  if (Object.prototype.hasOwnProperty.call(fields, "services")) {
    const oldServices: string[] = Array.isArray(old.services) ? old.services : [];
    const newServices: string[] = Array.isArray(fields.services) ? fields.services : [];
    const addedServices = newServices.filter((k) => !oldServices.includes(k));
    if (addedServices.length > 0) {
      await autoGenerateContracts(clientId, addedServices, req.user!.email);
    }
  }

  res.json({ ok: true });
}));

/**
 * Archive client — ported from alTaxPortalArchiveClient: admin-only in legacy
 * (alTaxV5RequirePortalUser_(email, true)). Sets status=Archived, disables the portal,
 * appends a timestamped note, deactivates every portal user assigned to this client
 * (alTaxV5DeactivateUsersForClient_), and audit-logs the change.
 *
 * Legacy also has alTaxPortalDeleteClientHard — a permanent, confirm-text-gated row
 * delete. That is intentionally NOT ported here: it's an irreversible destructive
 * operation on live production data with no undo path, and hasn't been requested.
 * Archive is the safe, reversible equivalent and matches the default action the
 * legacy UI actually exposes for removing a client.
 */
clientsRouter.post("/:clientId/archive", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  const reason = String((req.body || {}).reason || "Archived from web app");

  const old = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!old) return res.status(404).json({ error: "Client not found." });

  const newNotes = `${old.notes || ""}\nArchived ${new Date().toISOString()}: ${reason}`;

  await query(
    `UPDATE altax.v3_clients SET status = 'Archived', portal_enabled = false, notes = $2, updated_at = now(), updated_by = $3 WHERE client_id = $1`,
    [clientId, newNotes, req.user!.email]
  );
  await query(`UPDATE altax.v3_users SET active = false WHERE assigned_client_id = $1`, [clientId]);

  await logAudit(
    "Clients", "ARCHIVE", clientId, "Status", old.status || "", "Archived",
    `Client archived by ${req.user!.email}.`, req.user!.email
  );

  res.json({ ok: true, clientId });
}));

function maskTail(value: string | null): string | null {
  if (!value) return value;
  const digits = String(value).replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `***-**-${digits.slice(-4)}`;
}
