import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient, getUserAliases } from "../../common/assignment";
import { composeAddress } from "../../common/address";
import { generateContractForService } from "../contracts/contracts.routes";

/**
 * Best-effort: called after a client is created/updated with a newly-checked
 * service, so "check a service, save" alone is enough to get a suggested
 * contract without a separate trip to the Contracts section. Never throws —
 * generateContractForService already no-ops safely if a contract for this
 * client+service exists, and any other failure here (e.g. a bad template)
 * shouldn't block the client save that triggered it.
 */
async function autoGenerateContracts(clientId: string, serviceKeys: string[], createdBy: string): Promise<void> {
  for (const serviceKey of serviceKeys) {
    try {
      await generateContractForService({ clientId, serviceKey, createdBy });
    } catch {
      // best-effort — client save already succeeded, don't surface this as an error
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

  const c = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
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

  const [openTasks, openRequests, invoiceBalance, employees] = await Promise.all([
    queryOne<any>(
      `SELECT COUNT(*)::int AS count FROM altax.v3_tasks
        WHERE client_id = $1 AND lower(status) NOT IN ('completed','void','closed','archived')`,
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
  ]);

  res.json({
    openTasks: openTasks?.count || 0,
    openRequests: openRequests?.count || 0,
    openInvoices: invoiceBalance?.count || 0,
    balanceDue: Number(invoiceBalance?.balance || 0),
    employeesCount: employees?.count || 0,
  });
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
const UPDATABLE_FIELDS: Record<string, { column: string; boolean?: boolean }> = {
  clientName: { column: "client_name" },
  entityType: { column: "entity_type" },
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
  notes: { column: "notes" },
  ein: { column: "ein" },
  individualSsn: { column: "individual_ssn" },
  stateTaxId: { column: "state_tax_id" },
  secretaryOfStateId: { column: "secretary_of_state_id" },
  companyContactName: { column: "company_contact_name" },
  companyContactTitle: { column: "company_contact_title" },
  companyContactSsn: { column: "company_contact_ssn" },
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

  const clientId = String(body.clientId || "").trim() || await nextClientId();

  const columns = ["client_id"];
  const placeholders = ["$1"];
  const values: any[] = [clientId];
  for (const [key, { column, boolean }] of Object.entries(UPDATABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      columns.push(column);
      values.push(boolean ? Boolean(body[key]) : body[key]);
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

  const fields: Record<string, any> = {};
  for (const [key, { column, boolean }] of Object.entries(UPDATABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      fields[column] = boolean ? Boolean(body[key]) : body[key];
    }
  }

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: "No client fields received." });
  }

  const old = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!old) return res.status(404).json({ error: "Client not found." });

  if (!Object.prototype.hasOwnProperty.call(body, "address")
      && ["streetAddress", "city", "state", "zipCode"].some((k) => Object.prototype.hasOwnProperty.call(body, k))) {
    fields.address = composeAddress({
      street: "street_address" in fields ? fields.street_address : old.street_address,
      city: "city" in fields ? fields.city : old.city,
      state: "state" in fields ? fields.state : old.state,
      zip: "zip_code" in fields ? fields.zip_code : old.zip_code,
    });
  }

  const setClause = Object.keys(fields)
    .map((col, i) => `${col} = $${i + 2}`)
    .join(", ");
  await query(
    `UPDATE altax.v3_clients SET ${setClause}, updated_at = now() WHERE client_id = $1`,
    [clientId, ...Object.values(fields)]
  );

  for (const [col, newValue] of Object.entries(fields)) {
    const oldValue = old[col];
    if (String(oldValue ?? "") !== String(newValue ?? "")) {
      await logAudit(
        "Clients", "EDIT", clientId, col, String(oldValue ?? ""), String(newValue ?? ""),
        "Client updated from web app.", req.user!.email
      );
    }
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
    `UPDATE altax.v3_clients SET status = 'Archived', portal_enabled = false, notes = $2, updated_at = now() WHERE client_id = $1`,
    [clientId, newNotes]
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
