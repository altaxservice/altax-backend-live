import crypto from "crypto";
import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit, logClientActivity } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient, getUserAliases } from "../../common/assignment";
import { encryptValue, decryptTolerant, decryptClientPii } from "../../common/encryption";
import { composeAddress } from "../../common/address";
import { generateContractForService } from "../contracts/contracts.routes";
import { POA_COVERED_SERVICE_KEYS, POA_RELEASE_SERVICE_KEY, FIRM_SERVICES, SERVICE_LABEL, deriveServiceType } from "../contracts/contractContent";
import { computeSubscriptionTier, computeSubscriptionFee, type ServiceCatalogEntry, type ClientWorkerCounts } from "../../common/subscriptionPricing";
import { computeFirmSummary, computeMdFilingForReport, computeRevenueTrend, computeClientCashBalance, loadPayrollForPeriod, computeFirmWideMdSalesTaxMissedFilings, loadRecordedMdFilingPayments, loadSalesTaxFrequencyHistory, defaultFirmSummaryRange } from "../reports/reports.routes";
import { splitIntoMdFilingPeriodsForClient, classifyMdFilingPeriod } from "../../common/mdFiling";
import type { ReportClientInfo } from "../accounting/reportsPdf";
import { computeSwotFindings, groupFindingsToLegacyFields, type SwotEngineInput, type CandidateFinding } from "./swotFindingsEngine";
import { getDashboardAlertSettings, runDashboardAlertPush, type CreatedFindingInfo } from "./dashboardAlerts";
import { computeUpcomingDeadlines } from "./complianceCalendar";
import {
  computeClientPayrollCadenceGap, computeFirmWidePayrollCadenceGaps,
  computeClientBookkeepingStaleness, computeFirmWideBookkeepingStaleness,
  computeClientMissingComplianceTaskGaps, computeFirmWideMissingComplianceTaskGaps,
  computeFirmWideMdAnnualReportOverdue, laterOf,
  type PayrollCadenceGap, type BookkeepingStaleness, type MissingComplianceTaskGap,
} from "./complianceGapFlags";
import { computeClientComplianceTimeline, computeClientComplianceScore } from "./complianceTimeline";
import { sendEmail } from "../../common/notifications";
import { sendChannel } from "../../common/sendChannel";
import { wrapEmailHtml } from "../../common/emailTemplate";
import { escapeHtml } from "../../common/html";
import { getFirmProfile } from "../../common/firmProfile";
import { resolveAssigneeEmail } from "../reminders/reminders.routes";
import { getComplianceReminderSettings, buildComplianceReminderMessage, REMINDABLE_SOURCES, deadlineReminderStableKey, flagReminderStableKey } from "../../common/complianceReminders";

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
                              w21099_enabled, preferred_language, address, street_address, city, zip_code
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
 * Firm-wide at-risk-clients view (hard audit 2026-08-13, UX-001). The flags
 * computeClientFlags() already tracks per client — balance past due, agency
 * (tax/EFTPS/etc) obligations past due, and staff-entered manual flags — had
 * no aggregate anywhere in the app: an owner could only discover a client had
 * crossed into risk by opening that specific client's own panel. This runs
 * the same underlying signals as three bulk GROUP BY queries instead of
 * calling computeClientFlags() once per client (which would mean N+1 queries
 * per page load, including a computeMdFilingForReport call for every MD
 * client) — cost stays flat regardless of how many clients exist.
 *
 * Originally excluded the MD-sales-tax-filing-period flag computeClientFlags()
 * also carries, since it wasn't cheaply bulk-queryable without a larger
 * refactor to computeMdFilingForReport itself — computeFirmWideMdSalesTaxMissedFilings
 * (reports.routes.ts) is that refactor, added 2026-08-13 per a direct owner
 * request for a real firm-wide "did I miss filing for anyone" check that
 * isn't tied to whether a task happens to exist for it. This view now covers
 * unpaid balances, tracked-obligation (agency) past-due tasks, staff-entered
 * flags, AND MD Sales & Use Tax periods that are overdue and unfiled per the
 * actual filed/paid record — not literally every flag type the per-client
 * panel shows (Credit/Custom manual flags with no "past due" meaning are
 * still per-client only), but everything that represents real risk.
 *
 * Registered here, before GET /:clientId — a literal path segment like
 * "flags" is otherwise swallowed by :clientId's wildcard match (Express
 * matches route registration order), which silently 404'd this entire
 * endpoint as "client not found" for a client literally named "flags". Found
 * live 2026-08-14 verifying the dashboard: both AtRiskClientsPanel and
 * MissingSalesTaxFilingsPanel had been failing silently since they were
 * built, since each just swallows the fetch error into an empty list.
 */
clientsRouter.get("/flags", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const aliases = isAdmin ? null : Array.from(await getUserAliases(req.user!.email));
  const staffScope = isAdmin ? "" : `AND c.client_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($1::text[]))`;
  const params = isAdmin ? [] : [aliases];

  const { payrollCadenceGraceDays, bookkeepingStalenessDaysThreshold } = await getDashboardAlertSettings();
  const [balanceRows, agencyRows, manualRows, mdSalesTaxMissed, payrollGaps, bookkeepingGaps, missingTaskGaps] = await Promise.all([
    query<any>(
      `SELECT c.client_id, c.client_name, COALESCE(SUM(i.balance_due), 0) AS amount
         FROM altax.v3_clients c
         JOIN altax.v3_invoices i ON i.client_id = c.client_id
        WHERE i.status NOT IN ('Paid', 'Void') AND i.balance_due > 0
          AND i.due_date IS NOT NULL AND i.due_date::date < CURRENT_DATE
          ${staffScope}
        GROUP BY c.client_id, c.client_name`,
      params
    ),
    query<any>(
      `SELECT c.client_id, c.client_name, COUNT(*)::int AS count, COALESCE(SUM(t.payment_amount), 0) AS amount
         FROM altax.v3_clients c
         JOIN altax.v3_tasks t ON t.client_id = c.client_id
        WHERE t.payment_required = true AND t.paid_date IS NULL
          AND t.agency_due_date IS NOT NULL AND t.agency_due_date::date < CURRENT_DATE
          ${staffScope}
        GROUP BY c.client_id, c.client_name`,
      params
    ),
    query<any>(
      `SELECT c.client_id, c.client_name, COUNT(*)::int AS count
         FROM altax.v3_clients c
         JOIN altax.v3_client_flags f ON f.client_id = c.client_id
        WHERE f.status = 'Open'
          ${staffScope}
        GROUP BY c.client_id, c.client_name`,
      params
    ),
    computeFirmWideMdSalesTaxMissedFilings(),
    computeFirmWidePayrollCadenceGaps(payrollCadenceGraceDays),
    computeFirmWideBookkeepingStaleness(bookkeepingStalenessDaysThreshold),
    computeFirmWideMissingComplianceTaskGaps(),
  ]);

  // computeFirmWideMdSalesTaxMissedFilings() has no per-client filter of its own
  // (it scans every MD client) — for a scoped staff view, restrict its results
  // to the same assigned-client set the other three queries already use.
  const staffAllowedClientIds = isAdmin
    ? null
    : new Set((await query<any>(`SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($1::text[])`, [aliases])).map((r: any) => r.client_id));

  const byClient = new Map<string, {
    clientId: string; clientName: string; balancePastDue: number; agencyPastDueCount: number; agencyPastDueAmount: number; manualFlagCount: number;
    mdSalesTaxUnfiledPeriodEnd: string | null; mdSalesTaxUnfiledAmount: number;
    payrollGapNote: string | null; bookkeepingStaleDays: number | null; missingComplianceTaskCount: number;
  }>();
  const get = (clientId: string, clientName: string) => {
    if (!byClient.has(clientId)) byClient.set(clientId, {
      clientId, clientName, balancePastDue: 0, agencyPastDueCount: 0, agencyPastDueAmount: 0, manualFlagCount: 0,
      mdSalesTaxUnfiledPeriodEnd: null, mdSalesTaxUnfiledAmount: 0,
      payrollGapNote: null, bookkeepingStaleDays: null, missingComplianceTaskCount: 0,
    });
    return byClient.get(clientId)!;
  };
  for (const r of balanceRows) get(r.client_id, r.client_name).balancePastDue = Number(r.amount || 0);
  for (const r of agencyRows) {
    const c = get(r.client_id, r.client_name);
    c.agencyPastDueCount = r.count || 0;
    c.agencyPastDueAmount = Number(r.amount || 0);
  }
  for (const r of manualRows) get(r.client_id, r.client_name).manualFlagCount = r.count || 0;
  for (const m of mdSalesTaxMissed) {
    if (staffAllowedClientIds && !staffAllowedClientIds.has(m.clientId)) continue;
    const c = get(m.clientId, m.clientName);
    c.mdSalesTaxUnfiledPeriodEnd = m.periodEnd;
    c.mdSalesTaxUnfiledAmount = m.balanceDue;
  }
  for (const [clientId, gap] of payrollGaps) {
    if (staffAllowedClientIds && !staffAllowedClientIds.has(clientId)) continue;
    get(clientId, gap.clientName).payrollGapNote = `last paycheck ${gap.lastPayDate} (${gap.daysSinceLastPay} days ago)`;
  }
  for (const [clientId, gap] of bookkeepingGaps) {
    if (staffAllowedClientIds && !staffAllowedClientIds.has(clientId)) continue;
    get(clientId, gap.clientName).bookkeepingStaleDays = gap.daysSinceLastEntry;
  }
  for (const [clientId, entry] of missingTaskGaps) {
    if (staffAllowedClientIds && !staffAllowedClientIds.has(clientId)) continue;
    get(clientId, entry.clientName).missingComplianceTaskCount = entry.gaps.length;
  }

  // Ranked by dollars owed first (the most consequential kind of risk), then
  // by how many distinct agency obligations are overdue.
  const clients = Array.from(byClient.values()).sort((a, b) => (b.balancePastDue - a.balancePastDue) || (b.agencyPastDueCount - a.agencyPastDueCount));
  res.json({ clients });
}));

/**
 * Firm-wide worklist for the manual MDTAXCONNECT/MD Business Express checks
 * (sql/095) — every MD client whose sales-tax or annual-report/good-standing
 * check is either missing entirely or more than 30 days old, oldest first.
 * The whole point is to replace "check whichever clients I remember" with a
 * real queue, so re-checking an already-verified client or missing one
 * entirely stops happening. 30 days is a flat threshold, not tuned per
 * client's actual filing frequency — simple starting point, revisit if it
 * turns out too aggressive/lax in practice.
 */
clientsRouter.get("/verification-due", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const staffScope = isAdmin ? "" : `AND client_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($1::text[]))`;
  const params = isAdmin ? [] : [Array.from(await getUserAliases(req.user!.email))];
  const rows = await query<any>(
    `SELECT client_id, client_name, mdtaxconnect_verified_at, mdtaxconnect_verified_by,
            md_business_express_verified_at, md_business_express_verified_by,
            GREATEST(
              COALESCE(CURRENT_DATE - mdtaxconnect_verified_at::date, 999999),
              COALESCE(CURRENT_DATE - md_business_express_verified_at::date, 999999)
            ) AS max_days_since_verified
       FROM altax.v3_clients
      WHERE state = 'MD' AND (status IS NULL OR lower(status) NOT IN ('no','false','inactive','archived'))
            ${staffScope}
        AND (
          mdtaxconnect_verified_at IS NULL OR mdtaxconnect_verified_at <= NOW() - INTERVAL '30 days'
          OR md_business_express_verified_at IS NULL OR md_business_express_verified_at <= NOW() - INTERVAL '30 days'
        )
      ORDER BY max_days_since_verified DESC`,
    params
  );
  res.json({
    clients: rows.map((r: any) => ({
      clientId: r.client_id, clientName: r.client_name,
      mdtaxconnectVerifiedAt: r.mdtaxconnect_verified_at, mdtaxconnectVerifiedBy: r.mdtaxconnect_verified_by,
      mdBusinessExpressVerifiedAt: r.md_business_express_verified_at, mdBusinessExpressVerifiedBy: r.md_business_express_verified_by,
    })),
  });
}));

/**
 * Firm-wide list of clients with no recorded completion for their most
 * recently due MD Annual Report — see complianceCalendar.ts's
 * computeUpcomingDeadlines for why this could never be seen before (it only
 * ever showed a future date) and complianceGapFlags.ts's
 * computeFirmWideMdAnnualReportOverdue for the compute logic. Backs the bulk
 * "Mark Done" tool below — most of these were very likely filed the normal
 * way outside this app, before this obligation type had any completion
 * tracking at all; this list just has no way to know that on its own.
 */
clientsRouter.get("/md-annual-report-overdue", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const overdue = await computeFirmWideMdAnnualReportOverdue();
  if (isAdmin) return res.json({ clients: overdue });
  const aliases = Array.from(await getUserAliases(req.user!.email));
  const allowedIds = new Set((await query<any>(`SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($1::text[])`, [aliases])).map((r: any) => r.client_id));
  res.json({ clients: overdue.filter((c) => allowedIds.has(c.clientId)) });
}));

/**
 * Bulk companion to POST /:clientId/obligations/mark-done — same INSERT, same
 * validation, same audit trail, just looped over multiple (clientId, dueDate)
 * pairs in one request instead of clicking through each client individually.
 * Partial success by design (matches the /tasks/bulk convention): a bad
 * clientId doesn't abort the rest of the batch.
 */
clientsRouter.post("/obligations/mark-done-bulk", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const source = String(body.source || "").trim();
  const items = Array.isArray(body.items) ? body.items : [];
  if (!OBLIGATION_MARK_DONE_SOURCES.has(source)) return res.status(400).json({ error: "Unrecognized obligation type." });
  if (items.length === 0) return res.status(400).json({ error: "No items provided." });

  const completedDate = new Date().toISOString().slice(0, 10);
  let succeeded = 0;
  const failed: { clientId: string; error: string }[] = [];
  for (const item of items) {
    const clientId = String(item?.clientId || "").trim();
    const dueDate = String(item?.dueDate || "").trim();
    const label = String(item?.label || "").trim() || null;
    if (!clientId || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) { failed.push({ clientId: clientId || "(missing)", error: "Invalid clientId or dueDate." }); continue; }
    if (!(await canAccessClient(req.user!, clientId))) { failed.push({ clientId, error: "No access to this client." }); continue; }
    try {
      await query(
        `INSERT INTO altax.v3_obligation_completions (client_id, source, due_date, label, completed_date, completed_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (client_id, source, due_date) DO UPDATE SET
           label = EXCLUDED.label, completed_date = EXCLUDED.completed_date,
           completed_by = EXCLUDED.completed_by, completed_at = now()`,
        [clientId, source, dueDate, label, completedDate, req.user!.email]
      );
      await logAudit("Clients", "OBLIGATION_MARKED_DONE", clientId, "obligation", "", `${source} (${dueDate})`, `${label || source} (due ${dueDate}) marked done in bulk by ${req.user!.email}.`, req.user!.email);
      succeeded++;
    } catch (err) {
      failed.push({ clientId, error: err instanceof Error ? err.message : "Unknown error." });
    }
  }
  res.json({ ok: true, succeeded, failed });
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

  // When the currently-set frequency began — lets the Compliance tab show
  // "effective since {date}" instead of just the bare frequency value, so
  // staff can tell at a glance whether a change is already on file. Wrapped
  // in try/catch, not because this should ever fail, but because code and
  // database migrations deploy on two different clocks (code auto-deploys
  // the instant it's pushed; the migration needs a human to run it) — a
  // deploy that lands even a minute before its own migration would otherwise
  // 500 this entire route for every client. Missing table -> just no
  // "effective since" label yet, not a broken page.
  try {
    const openFreqRow = await queryOne<{ effective_from: string }>(
      `SELECT effective_from::date::text AS effective_from FROM altax.v3_client_sales_tax_frequency_history
        WHERE client_id = $1 AND effective_to IS NULL`,
      [clientId]
    );
    c.sales_tax_frequency_effective_from = openFreqRow?.effective_from ?? null;
  } catch {
    c.sales_tax_frequency_effective_from = null;
  }

  if (req.user!.role !== "admin") {
    c.individual_ssn = maskTail(c.individual_ssn);
    c.ein = maskTail(c.ein);
    c.state_tax_id = maskTail(c.state_tax_id);
    c.cra_registration_number = maskTail(c.cra_registration_number);
    c.company_contact_ssn = maskTail(c.company_contact_ssn);
  }

  res.json({ client: c });
}));

/**
 * Lightweight per-client activity summary — powers the persistent client-context
 * panel (Open Tasks/Requests/Invoices/Balance) shown alongside Tasks, Documents,
 * Billing, Accounting, Reports, and Communications, mirroring the "ACCOUNT" block
 * in the legacy client side panel, and now also the SWOT auto-draft's operational
 * signals below. Kept separate from the full profile fetch above so pages that
 * only need these counters don't pull the whole client row.
 */
/**
 * viewerAliases (staff role only — see the /summary route below): when passed,
 * also computes how many of this client's open tasks are actually assigned to
 * the viewer, using the identical `lower(assigned_to) = ANY(aliases)` scoping
 * GET /tasks uses. Without this, the panel's "Open Tasks" count (every open
 * task for the client, any assignee) didn't match what a staff member saw
 * after clicking through to /tasks?clientId=X (server-scoped to just their
 * own assigned tasks) — a staff member could see "5 Open Tasks" and land on
 * 2, with nothing explaining the difference.
 */
async function computeClientOpsSummary(clientId: string, viewerAliases?: string[] | null) {
  const [openTasks, overdueTasks, taskStatusBreakdown, openRequests, invoiceBalance, employees, documents, myOpenTasks] = await Promise.all([
    queryOne<any>(
      `SELECT COUNT(*)::int AS count FROM altax.v3_tasks
        WHERE client_id = $1 AND lower(status) NOT IN ('completed','void','closed','archived')`,
      [clientId]
    ),
    // UX-009: the panel's "Open Tasks" count answers "how much work", but not
    // "how much of it is late" — a staff member had to click through to Tasks
    // to find that out. Same overdue definition (agency_due_date::date <
    // CURRENT_DATE) as the compliance-flag queries below and the frontend's
    // own isOverdue()/dueDays() in TaskCells.tsx.
    queryOne<any>(
      `SELECT COUNT(*)::int AS count FROM altax.v3_tasks
        WHERE client_id = $1 AND lower(status) NOT IN ('completed','void','closed','archived')
          AND agency_due_date IS NOT NULL AND agency_due_date::date < CURRENT_DATE`,
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
    // Matches the "Employees" worker-profiles tab's own filter exactly
    // (worker_type NOT LIKE contractor) — that tab does not exclude archived
    // workers, so this count doesn't either; otherwise the badge and the
    // list it links to disagree.
    queryOne<any>(
      `SELECT COUNT(*)::int AS count FROM altax.v3_employees
        WHERE client_id = $1 AND lower(COALESCE(worker_type, '')) NOT LIKE '%contractor%'`,
      [clientId]
    ),
    // Files actually on file for this client, so the panel can answer "do we
    // have their documents?" without opening the Documents page. Matches the
    // Documents tab's own filter exactly (client-only uploads, not internal-
    // direction rows) — those two exclusions live only in the frontend list's
    // filter, so this count must mirror them or the badge overcounts what the
    // list actually shows.
    queryOne<any>(
      `SELECT COUNT(*)::int AS count FROM altax.v3_document_uploads
        WHERE client_id = $1 AND lower(status) NOT IN ('removed','replaced')
          AND employee_id IS NULL AND lower(COALESCE(direction, '')) <> 'internal'`,
      [clientId]
    ),
    viewerAliases && viewerAliases.length
      ? queryOne<any>(
          `SELECT COUNT(*)::int AS count FROM altax.v3_tasks
            WHERE client_id = $1 AND lower(status) NOT IN ('completed','void','closed','archived')
              AND lower(assigned_to) = ANY($2::text[])`,
          [clientId, viewerAliases]
        )
      : Promise.resolve(null),
  ]);

  return {
    openTasks: openTasks?.count || 0,
    overdueTasks: overdueTasks?.count || 0,
    myOpenTasks: viewerAliases ? (myOpenTasks?.count || 0) : null,
    taskStatusBreakdown: (taskStatusBreakdown || []).map((r: any) => ({ status: r.status, count: r.count })),
    openRequests: openRequests?.count || 0,
    openInvoices: invoiceBalance?.count || 0,
    balanceDue: Number(invoiceBalance?.balance || 0),
    employeesCount: employees?.count || 0,
    documentsCount: documents?.count || 0,
  };
}

clientsRouter.get("/:clientId/summary", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (req.user!.role === "employee") return res.status(403).json({ error: "You do not have access to this client." });
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const viewerAliases = req.user!.role === "staff" ? Array.from(await getUserAliases(req.user!.email)) : null;
  res.json(await computeClientOpsSummary(clientId, viewerAliases));
}));

/**
 * UX-005 (Hard Audit, 2026-08-13) — the "push" counterpart to UX-001's at-risk
 * dashboard panel (a "pull" mechanism: someone has to go look). Nightly,
 * firm-wide (same two bulk GROUP BY queries as GET /flags above, just without
 * the staff-scope filter), diffs against v3_flag_alerts_sent to find clients
 * newly crossing into BalancePastDue or AgencyPastDue, logs one audit event
 * each (which is all that's needed — "Clients" is already in the since-login
 * digest's module allowlist, system.routes.ts's ACTIVITY_DIGEST_MODULES), and
 * records the flag as seen. When a client's flag has since cleared, the
 * tracking row is deleted so the NEXT occurrence alerts again — same
 * self-clearing behavior as the flags themselves.
 */
export async function runClientRiskFlagSweep(actorEmail: string): Promise<{ newlyFlagged: number }> {
  const { payrollCadenceGraceDays, bookkeepingStalenessDaysThreshold } = await getDashboardAlertSettings();
  const [balanceRows, agencyRows, alreadySent, payrollGaps, bookkeepingGaps, missingTaskGaps] = await Promise.all([
    query<any>(
      `SELECT c.client_id, c.client_name FROM altax.v3_clients c
         JOIN altax.v3_invoices i ON i.client_id = c.client_id
        WHERE i.status NOT IN ('Paid', 'Void') AND i.balance_due > 0
          AND i.due_date IS NOT NULL AND i.due_date::date < CURRENT_DATE
        GROUP BY c.client_id, c.client_name`
    ),
    query<any>(
      `SELECT c.client_id, c.client_name FROM altax.v3_clients c
         JOIN altax.v3_tasks t ON t.client_id = c.client_id
        WHERE t.payment_required = true AND t.paid_date IS NULL
          AND t.agency_due_date IS NOT NULL AND t.agency_due_date::date < CURRENT_DATE
        GROUP BY c.client_id, c.client_name`
    ),
    query<any>(`SELECT client_id, flag_type FROM altax.v3_flag_alerts_sent`),
    computeFirmWidePayrollCadenceGaps(payrollCadenceGraceDays),
    computeFirmWideBookkeepingStaleness(bookkeepingStalenessDaysThreshold),
    computeFirmWideMissingComplianceTaskGaps(),
  ]);
  const sentSet = new Set(alreadySent.map((r: any) => `${r.client_id}|${r.flag_type}`));
  const currentlyFlagged: { clientId: string; clientName: string; flagType: "BalancePastDue" | "AgencyPastDue" | "PayrollCadenceGap" | "BookkeepingStale" | "MissingComplianceTask" }[] = [
    ...balanceRows.map((r: any) => ({ clientId: r.client_id, clientName: r.client_name, flagType: "BalancePastDue" as const })),
    ...agencyRows.map((r: any) => ({ clientId: r.client_id, clientName: r.client_name, flagType: "AgencyPastDue" as const })),
    ...Array.from(payrollGaps, ([clientId, gap]) => ({ clientId, clientName: gap.clientName, flagType: "PayrollCadenceGap" as const })),
    ...Array.from(bookkeepingGaps, ([clientId, gap]) => ({ clientId, clientName: gap.clientName, flagType: "BookkeepingStale" as const })),
    ...Array.from(missingTaskGaps, ([clientId, entry]) => ({ clientId, clientName: entry.clientName, flagType: "MissingComplianceTask" as const })),
  ];
  const active = new Set(currentlyFlagged.map((f) => `${f.clientId}|${f.flagType}`));

  const FLAG_DESCRIPTIONS: Record<string, (name: string) => string> = {
    BalancePastDue: (name) => `${name} has an overdue balance owed to the firm.`,
    AgencyPastDue: (name) => `${name} has an overdue agency obligation (tax/EFTPS/etc).`,
    PayrollCadenceGap: (name) => `${name}'s payroll appears to have stopped running — no paycheck in longer than their pay frequency allows.`,
    BookkeepingStale: (name) => `${name}'s bookkeeping has gone stale — no GL activity in longer than the staleness threshold.`,
    MissingComplianceTask: (name) => `${name} has a recurring compliance task (EFTPS/MD Withholding/MD UI/Business Tax Return) that should exist for the current period and doesn't.`,
  };

  let newlyFlagged = 0;
  for (const { clientId, clientName, flagType } of currentlyFlagged) {
    if (sentSet.has(`${clientId}|${flagType}`)) continue;
    await query(
      `INSERT INTO altax.v3_flag_alerts_sent (client_id, flag_type) VALUES ($1, $2) ON CONFLICT (client_id, flag_type) DO NOTHING`,
      [clientId, flagType]
    );
    await logAudit("Clients", "CLIENT_BECAME_AT_RISK", clientId, "flag", "", flagType, FLAG_DESCRIPTIONS[flagType](clientName), actorEmail);
    newlyFlagged++;
  }
  // Self-clear: any tracking row whose flag is no longer active gets removed
  // so a future recurrence alerts again instead of staying silently suppressed.
  const stale = [...sentSet].filter((key) => !active.has(key));
  for (const key of stale) {
    const [clientId, flagType] = key.split("|");
    await query(`DELETE FROM altax.v3_flag_alerts_sent WHERE client_id = $1 AND flag_type = $2`, [clientId, flagType]);
  }
  return { newlyFlagged };
}

function nextFlagId(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `FLAG-${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

export interface ClientFlag {
  flagId: string | null;
  /** Stable identity for per-send selection in the Notify Client modal — computed flag
   * types (BalancePastDue/AgencyPastDue) have flagId: null, so flagId alone can't address
   * one specific flag across a notify-preview call and the later filtered send. */
  key: string;
  flagType: "BalancePastDue" | "AgencyPastDue" | "SalesTaxFilingDue" | "SalesTaxBalanceDue" | "PayrollCadenceGap" | "BookkeepingStale" | "MissingComplianceTask" | "Credit" | "Custom";
  amount: number | null;
  note: string | null;
  color: "red" | "green" | "amber";
  createdAt: string | null;
  createdBy: string | null;
  resolvable: boolean;
  linkTaskId?: string;
  linkUrl?: string;
  /** Custom-flag-only extras — a short classification (e.g. "Not in Good Standing"), a
   * longer free-text body for specifics, and an optional relevant date. Absent on the
   * computed flag types (BalancePastDue/AgencyPastDue), which have no row to carry them. */
  category?: string | null;
  details?: string | null;
  dueDate?: string | null;
  /** MissingComplianceTask-only — the Task Rule's task_type text, matched against
   * v3_tasks.task_name by taskLabelsLikelyMatch() in complianceGapFlags.ts. Lets the
   * frontend pre-fill a real "Create Task" form instead of just describing the gap. */
  gapTaskType?: string;
  /** Whether this flag is allowed to appear in a client-facing notification (see POST :clientId/flags/notify-preview). Computed flags (Balance/Agency Past Due) are always eligible; manual flags default to false until staff opts them in. */
  shareWithClient: boolean;
  /** Only populated by computeResolvedClientFlags — who/when a manual flag was resolved. */
  resolvedBy?: string | null;
  resolvedAt?: string | null;
}

/**
 * Noticeable, colored account-level issues for the client panel — kept
 * separate from the freeform Activity Timeline because a note's "read" state
 * says nothing about whether the underlying problem is actually fixed.
 * Balance Past Due (money owed TO the firm) is computed fresh from real
 * invoice data on every call. Agency Past Due (money the CLIENT owes an
 * agency directly — sales tax, EFTPS, MD withholding, MD UI, etc.) has two
 * sources, both read live, never stored: (1) the same source as the client's
 * existing Tax Payments tab — any task with payment_required=true already
 * carries a real agency_due_date and payment_amount, entered by staff per
 * obligation — one flag per unpaid task past its due date, labeled with that
 * task's own service_line/task_name so every tax type staff tracks this way
 * shows up automatically; and (2) for MD clients, the same real Form 202
 * discount/penalty/interest calculation already used by the Accounting >
 * Sales tab and the SWOT findings engine (computeMdFilingForReport) — a
 * client can be genuinely late on MD sales tax without staff ever having
 * created a payment-tracking task for it, since that math is fully
 * automatic. That MD math also drives two more-specific flag types,
 * SalesTaxFilingDue and SalesTaxBalanceDue, computed per filing period over
 * the same 6-month lookback: Filing fires once a period is within the
 * dashboard-alert "due soon" window (getDashboardAlertSettings().
 * filingDeadlineDaysThreshold) through any point after, regardless of
 * whether tax is owed for that period — a nil return still has to be filed
 * — while Balance Due keeps the original overdue-and-owing-only gating.
 * They're independent facts and are expected to co-occur when a filing is
 * both late and has money owed. All of these self-clear the moment the
 * underlying record clears (task marked paid / period marked filed or
 * paid). Credit and Custom are
 * staff-entered since this app has no source of truth for either — no
 * overpayment/credit-memo concept exists anywhere, and "something else" is
 * by definition not something the system can compute.
 */
interface ClientFlagsResult {
  flags: ClientFlag[];
  clientRow: any;
  gaps: { payrollGap: PayrollCadenceGap | null; bookkeepingGap: BookkeepingStaleness | null; missingTaskGaps: MissingComplianceTaskGap[] };
}

export async function computeClientFlags(clientId: string): Promise<ClientFlagsResult> {
  const flags: ClientFlag[] = [];

  const overdue = await queryOne<any>(
    `SELECT COALESCE(SUM(balance_due), 0) AS total FROM altax.v3_invoices
      WHERE client_id = $1 AND status NOT IN ('Paid', 'Void') AND balance_due > 0
            AND due_date IS NOT NULL AND due_date::date < CURRENT_DATE`,
    [clientId]
  );
  const overdueAmount = Number(overdue?.total || 0);
  if (overdueAmount > 0) {
    flags.push({ flagId: null, key: "computed:BalancePastDue", flagType: "BalancePastDue", amount: overdueAmount, note: null, color: "red", createdAt: null, createdBy: null, resolvable: false, shareWithClient: true });
  }

  const agencyRows = await query<any>(
    `SELECT task_id, task_name, service_line, payment_amount, agency_due_date FROM altax.v3_tasks
      WHERE client_id = $1 AND payment_required = true AND paid_date IS NULL
            AND agency_due_date IS NOT NULL AND agency_due_date::date < CURRENT_DATE
      ORDER BY agency_due_date ASC`,
    [clientId]
  );
  for (const row of agencyRows) {
    flags.push({
      flagId: null, key: `computed:AgencyPastDue:task:${row.task_id}`, flagType: "AgencyPastDue", amount: row.payment_amount !== null ? Number(row.payment_amount) : null,
      note: row.service_line || row.task_name, color: "red", createdAt: null, createdBy: null, resolvable: false,
      linkTaskId: row.task_id, shareWithClient: true,
    });
  }

  const clientRow = await queryOne<any>(
    `SELECT client_id, client_name, ein, address, state, sales_tax_frequency, created_at, date_of_formation::date::text AS date_of_formation,
            payroll_enabled, payroll_frequency, eftps_enabled, md_withholding_frequency, mdui_enabled, business_return_type,
            sales_tax_registered_since::date::text AS sales_tax_registered_since,
            eftps_registered_since::date::text AS eftps_registered_since,
            md_withholding_registered_since::date::text AS md_withholding_registered_since,
            mdui_registered_since::date::text AS mdui_registered_since
       FROM altax.v3_clients WHERE client_id = $1`,
    [clientId]
  );
  if (clientRow?.state === "MD") {
    let { from: fromStr, to: toStr } = defaultFirmSummaryRange();
    // Never assert a filing/balance obligation before the client's own
    // confirmed start date. Prefers the obligation-specific
    // sales_tax_registered_since when set (see
    // sql/102_obligation_registered_since.sql), but falls back to
    // date_of_formation automatically — a client can't owe sales tax before
    // it legally existed, and there's no reason to make staff re-enter a
    // date that's already on file just because it lives in a different
    // field. Whichever is LATER wins (a business can form before actually
    // registering for sales tax, never the other way around).
    const salesTaxFloor = laterOf(clientRow.sales_tax_registered_since, clientRow.date_of_formation);
    if (salesTaxFloor && salesTaxFloor > fromStr) {
      fromStr = salesTaxFloor;
    }
    const reportClient: ReportClientInfo = {
      clientId, clientName: clientRow.client_name, ein: clientRow.ein, address: clientRow.address,
      state: clientRow.state, salesTaxFrequency: clientRow.sales_tax_frequency,
    };
    // Filing obligation — determined from the period calendar + recorded
    // filings directly, NOT from computeMdFilingForReport's periods below:
    // that list only shows a $0 period once it's due-soon-or-overdue
    // (computeMdFilingBreakdown's own skip logic), whereas this flag needs
    // every period in the full lookback window regardless of whether it's
    // "due soon" yet — a $0 or not-yet-quantified period is still a real
    // filing obligation the moment it exists, not just once it's about to
    // be late. Fires once the period enters the "due soon" window and keeps
    // firing through overdue. Amber while there's still time to file, red
    // once the due date has actually passed.
    const frequencyHistory = await loadSalesTaxFrequencyHistory(clientId);
    const { periods: allPeriods } = splitIntoMdFilingPeriodsForClient(fromStr, toStr, frequencyHistory, clientRow.sales_tax_frequency);
    if (allPeriods.length > 0) {
      const recordedFilings = await loadRecordedMdFilingPayments(clientId, allPeriods[0].start, allPeriods[allPeriods.length - 1].end);
      const { filingDeadlineDaysThreshold } = await getDashboardAlertSettings();
      for (const p of allPeriods) {
        if (recordedFilings.get(p.end)?.filedDate) continue;
        const daysUntilDue = Math.round((new Date(`${p.dueDate}T00:00:00Z`).getTime() - new Date(`${toStr}T00:00:00Z`).getTime()) / 86400000);
        if (daysUntilDue <= filingDeadlineDaysThreshold) {
          flags.push({
            flagId: null, key: `computed:SalesTaxFilingDue:md:${p.end}`, flagType: "SalesTaxFilingDue", amount: null,
            note: `for the period ${p.end}`, color: daysUntilDue < 0 ? "red" : "amber", createdAt: null, createdBy: null, resolvable: false,
            linkUrl: `/accounting?client=${clientId}&tab=Sales&from=${p.start}&to=${p.end}`, shareWithClient: true,
          });
        }
      }
    }

    // Balance owed — unchanged timing from the flag this replaces: still
    // overdue-and-owing only, driven off the same tax-gated breakdown as
    // before (a period with no balance owed has nothing to flag here). A
    // period staff has already marked filed is settled — even if it was
    // filed late, the money's been paid, so it shouldn't keep showing as an
    // active past-due flag (see computeMdFilingForReport / v3_md_filing_payments).
    const mdFiling = await computeMdFilingForReport(reportClient, fromStr, toStr);
    if (mdFiling) {
      for (const p of mdFiling.periods) {
        const status = classifyMdFilingPeriod(p, toStr);
        if (!p.markedPaidDate && (status === "missing" || status === "late") && p.balanceDue > 0) {
          flags.push({
            flagId: null, key: `computed:SalesTaxBalanceDue:md:${p.end}`, flagType: "SalesTaxBalanceDue", amount: p.balanceDue,
            note: `for the period ${p.end}`, color: "red", createdAt: null, createdBy: null, resolvable: false,
            linkUrl: `/accounting?client=${clientId}&tab=Sales&from=${p.start}&to=${p.end}`, shareWithClient: true,
          });
        }
      }
    }
  }

  // Cross-service gap checks — payroll cadence, bookkeeping staleness, and
  // missing compliance tasks (EFTPS/MD Withholding/MD UI/Business Tax
  // Return) — see complianceGapFlags.ts for what evidence each one requires
  // before it will ever assert a gap. Applies to any client regardless of
  // state, unlike the MD-only block above. Hoisted to outer scope (not just
  // `if (clientRow)`-local) so they can be returned alongside flags — the
  // Compliance Score (complianceTimeline.ts) reuses these exact objects
  // instead of re-querying them a second time.
  let payrollGap: PayrollCadenceGap | null = null;
  let bookkeepingGap: BookkeepingStaleness | null = null;
  let missingTaskGaps: MissingComplianceTaskGap[] = [];
  if (clientRow) {
    const { payrollCadenceGraceDays, bookkeepingStalenessDaysThreshold } = await getDashboardAlertSettings();

    payrollGap = await computeClientPayrollCadenceGap(clientId, clientRow, payrollCadenceGraceDays);
    if (payrollGap) {
      flags.push({
        flagId: null, key: `computed:PayrollCadenceGap:${clientId}`, flagType: "PayrollCadenceGap", amount: null,
        note: `last paycheck ${payrollGap.lastPayDate} (${payrollGap.daysSinceLastPay} days ago)`, color: "red",
        createdAt: null, createdBy: null, resolvable: false,
        linkUrl: `/accounting?client=${clientId}&tab=Payroll`, shareWithClient: true,
      });
    }

    bookkeepingGap = await computeClientBookkeepingStaleness(clientId, bookkeepingStalenessDaysThreshold);
    if (bookkeepingGap) {
      flags.push({
        flagId: null, key: `computed:BookkeepingStale:${clientId}`, flagType: "BookkeepingStale", amount: null,
        note: `last GL entry ${bookkeepingGap.lastEntryDate} (${bookkeepingGap.daysSinceLastEntry} days ago)`, color: "amber",
        createdAt: null, createdBy: null, resolvable: false,
        linkUrl: `/accounting?client=${clientId}&tab=GL`, shareWithClient: true,
      });
    }

    missingTaskGaps = await computeClientMissingComplianceTaskGaps(clientId, clientRow);
    for (const gap of missingTaskGaps) {
      flags.push({
        flagId: null, key: `computed:MissingComplianceTask:${gap.ruleId}:${gap.periodLabel}`, flagType: "MissingComplianceTask", amount: null,
        note: `${gap.taskType} for ${gap.periodLabel} (due ${gap.dueDate}) — no task on file`, color: "red",
        createdAt: null, createdBy: null, resolvable: false,
        gapTaskType: gap.taskType, dueDate: gap.dueDate,
        // Internal process-integrity signal, not a client-facing "we forgot" admission.
        shareWithClient: false,
      });
    }
  }

  const manual = await query<any>(
    `SELECT flag_id, flag_type, amount, note, category, details, due_date, link_task_id, created_at, created_by, share_with_client
       FROM altax.v3_client_flags
      WHERE client_id = $1 AND status = 'Open' ORDER BY created_at DESC`,
    [clientId]
  );
  for (const row of manual) {
    flags.push({
      flagId: row.flag_id, key: row.flag_id, flagType: row.flag_type, amount: row.amount !== null ? Number(row.amount) : null,
      note: row.note, color: row.flag_type === "Credit" ? "green" : "amber",
      createdAt: row.created_at, createdBy: row.created_by, resolvable: true,
      category: row.category, details: row.details, dueDate: row.due_date,
      linkTaskId: row.link_task_id || undefined, shareWithClient: row.share_with_client === true,
    });
  }

  return { flags, clientRow, gaps: { payrollGap, bookkeepingGap, missingTaskGaps } };
}

/**
 * Resolved manual flags — the counterpart to computeClientFlags' `status = 'Open'`
 * filter, which otherwise makes a flag vanish permanently the moment it's resolved.
 * Powers the panel's "View History" section. Computed flag types (BalancePastDue/
 * AgencyPastDue) have no history to show: they self-clear from live data and were
 * never a stored row to begin with.
 */
async function computeResolvedClientFlags(clientId: string, limit = 50): Promise<ClientFlag[]> {
  const manual = await query<any>(
    `SELECT flag_id, flag_type, amount, note, category, details, due_date, link_task_id,
            created_at, created_by, resolved_by, resolved_at, share_with_client
       FROM altax.v3_client_flags
      WHERE client_id = $1 AND status = 'Resolved'
      ORDER BY resolved_at DESC
      LIMIT $2`,
    [clientId, limit]
  );
  return manual.map((row: any) => ({
    flagId: row.flag_id, key: row.flag_id, flagType: row.flag_type,
    amount: row.amount !== null ? Number(row.amount) : null,
    note: row.note, color: row.flag_type === "Credit" ? "green" : "amber",
    createdAt: row.created_at, createdBy: row.created_by, resolvable: false,
    category: row.category, details: row.details, dueDate: row.due_date,
    linkTaskId: row.link_task_id || undefined, shareWithClient: row.share_with_client === true,
    resolvedBy: row.resolved_by, resolvedAt: row.resolved_at,
  }));
}

clientsRouter.get("/:clientId/flags", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const { flags, clientRow, gaps } = await computeClientFlags(clientId);
  let complianceScore = null;
  let complianceTimeline: Awaited<ReturnType<typeof computeClientComplianceTimeline>> = [];
  if (clientRow) {
    complianceTimeline = await computeClientComplianceTimeline(clientId, clientRow);
    complianceScore = computeClientComplianceScore(complianceTimeline, gaps);
  }
  res.json({ flags, complianceScore, complianceTimeline });
}));

clientsRouter.post("/:clientId/flags", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const body = req.body || {};
  const flagType = String(body.flagType || "").trim();
  if (!["Credit", "Custom"].includes(flagType)) return res.status(400).json({ error: "flagType must be Credit or Custom." });

  let amount: number | null = null;
  let note: string | null = null;
  let category: string | null = null;
  let details: string | null = null;
  let dueDate: string | null = null;
  let linkTaskId: string | null = null;

  if (flagType === "Credit") {
    amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Enter the credit amount." });
    note = String(body.note || "").trim() || null;
  } else {
    // Custom flags are classified by category (the same admin-editable dropdown-list
    // pattern as every other preset list in this app — see
    // MANAGED_DROPDOWN_DEFAULTS.clientFlagCategories) rather than one open-ended text
    // field, so "what kind of issue is this" is scannable across clients instead of
    // buried in whatever a staffer happened to type. `note` is still populated from
    // category for backward-compat display in the places that only render `note`.
    category = String(body.category || "").trim();
    if (!category) return res.status(400).json({ error: "Choose what kind of flag this is." });
    note = category;
    details = String(body.details || "").trim() || null;
    if (body.amount !== undefined && body.amount !== "" && body.amount !== null) {
      const n = Number(body.amount);
      if (Number.isFinite(n)) amount = n;
    }
    if (body.dueDate) {
      const d = String(body.dueDate).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dueDate = d;
    }
    if (body.linkTaskId) {
      const taskId = String(body.linkTaskId).trim();
      // Confirm the task actually belongs to this client — a staffer picking from a
      // list should never be able to point a flag at someone else's task, whether by
      // a stale client switch mid-form or a tampered request.
      const task = await queryOne<any>(`SELECT task_id FROM altax.v3_tasks WHERE task_id = $1 AND client_id = $2`, [taskId, clientId]);
      if (!task) return res.status(400).json({ error: "That task doesn't belong to this client." });
      linkTaskId = taskId;
    }
  }

  const shareWithClient = Boolean(body.shareWithClient);

  const flagId = nextFlagId();
  await query(
    `INSERT INTO altax.v3_client_flags (flag_id, client_id, flag_type, amount, note, category, details, due_date, link_task_id, created_by, share_with_client)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [flagId, clientId, flagType, amount, note, category, details, dueDate, linkTaskId, req.user!.email, shareWithClient]
  );
  await logAudit("Clients", "FLAG_ADDED", clientId, "flag", "", flagType, `${flagType} flag added for client by ${req.user!.email}${note ? `: ${note}` : ""}.`, req.user!.email);
  await logClientActivity(clientId, "Flag Added", `${flagType} flag added${note ? `: ${note}` : ""}.`, req.user!.email);
  res.status(201).json({ ok: true, flagId });
}));

// EFTPS deliberately excluded, 2026-08-29: the dedicated EFTPS Deposit workflow
// (src/modules/eftpsDeposits/) is now the one path for EFTPS specifically — it
// writes the same (client, source, due_date) row this generic route does, plus
// a real per-employee breakdown, reconciliation, and client report this route
// has no way to produce. Keeping "EFTPS" here would let staff bypass all of
// that with a flat, undetailed completion on the same key.
const OBLIGATION_MARK_DONE_SOURCES = new Set(["MD Withholding", "MD UI", "Business Tax Return", "Individual Tax Return", "Estimated Tax", "MD Annual Report", "Federal Payroll Tax", "1099/W-2"]);

/**
 * One click, right on the dashboard, to silence a specific upcoming/overdue
 * obligation reminder once staff have actually handled it outside this
 * system (e.g. filed EFTPS via the real IRS site) — no Task Rules Agent
 * draft/approve/mark-paid detour required for something this lightweight.
 * See sql/057_obligation_completions.sql and sql/093 (amount/paid_date).
 *
 * amount and paidDate are both optional — paidDate omitted means "handled/
 * filed, payment not yet made," matching MD Sales Tax's and Tasks' same
 * filed/paid split. `notify: true` sends a filing-confirmation email
 * immediately (only meaningful with a real amount) and, if paidDate is
 * omitted, schedules the 24h-before-due-date reminder. For this table the
 * stored due_date already IS the payment due date, unlike MD's separate
 * return-due-date concept.
 */
clientsRouter.post("/:clientId/obligations/mark-done", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const body = req.body || {};
  const source = String(body.source || "").trim();
  const dueDate = String(body.dueDate || "").trim();
  const label = String(body.label || "").trim() || null;
  const amountRaw = body.amount;
  const amount = amountRaw !== undefined && amountRaw !== null && amountRaw !== "" && Number.isFinite(Number(amountRaw)) ? Number(amountRaw) : null;
  const paidDateRaw = String(body.paidDate || "").trim();
  const paidDate = paidDateRaw ? paidDateRaw : null;
  const notify = body.notify === true;
  if (!OBLIGATION_MARK_DONE_SOURCES.has(source)) return res.status(400).json({ error: "Unrecognized obligation type." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return res.status(400).json({ error: "dueDate must be YYYY-MM-DD." });
  if (paidDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) return res.status(400).json({ error: "paidDate must be YYYY-MM-DD." });

  const completedDate = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO altax.v3_obligation_completions (client_id, source, due_date, label, completed_date, completed_by, amount, paid_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (client_id, source, due_date) DO UPDATE SET
       label = EXCLUDED.label, completed_date = EXCLUDED.completed_date, completed_by = EXCLUDED.completed_by, completed_at = now(),
       amount = EXCLUDED.amount, paid_date = EXCLUDED.paid_date`,
    [clientId, source, dueDate, label, completedDate, req.user!.email, amount, paidDate]
  );
  await logAudit("Clients", "OBLIGATION_MARKED_DONE", clientId, "obligation", "", `${source} (${dueDate})`,
    `${label || source} (due ${dueDate}) marked done by ${req.user!.email}${paidDate ? `, paid ${paidDate}` : ""}.`, req.user!.email);

  if (notify && amount !== null) {
    const clientContact = await queryOne<any>(`SELECT client_name, email, email_allowed FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
    if (clientContact) {
      const { sendFilingConfirmation } = await import("../../common/filingConfirmationEmail");
      const sourceRecordId = `${clientId}:${source}:${dueDate}`;
      await sendFilingConfirmation({
        client: { clientId, clientName: clientContact.client_name, email: clientContact.email, emailAllowed: Boolean(clientContact.email_allowed) },
        sourceRecordId, filingType: label || source, periodLabel: null,
        filedDate: completedDate, amount, paymentDueDate: dueDate, paidDate, req,
      });
      if (!paidDate) {
        const { schedulePaymentReminder } = await import("../../common/paymentReminders");
        await schedulePaymentReminder({
          sourceSystem: "ObligationCompletion", sourceRecordId, clientId, filingType: label || source,
          periodLabel: null, amount, paymentDueDate: dueDate, createdBy: req.user!.email,
        });
      }
    }
  }

  res.json({ ok: true });
}));

/** Per-obligation-type lead-day settings for the automatic client compliance reminder sweep — see complianceReminders.ts. Read: any staff. Write: admin only, matching Firm Settings/Tax Rates conventions. */
clientsRouter.get("/compliance-reminder-settings", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json({ settings: await getComplianceReminderSettings() });
}));

clientsRouter.patch("/compliance-reminder-settings/:source", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { source } = req.params;
  if (!REMINDABLE_SOURCES.has(source)) return res.status(404).json({ error: "Unrecognized obligation type." });
  const body = req.body || {};
  const leadDays = Array.isArray(body.leadDays) ? body.leadDays.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n >= 0) : undefined;
  const enabled = body.enabled !== undefined ? Boolean(body.enabled) : undefined;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_compliance_reminder_settings WHERE source = $1`, [source]);
  if (!existing) return res.status(404).json({ error: "Setting not found." });

  await query(
    `UPDATE altax.v3_compliance_reminder_settings SET lead_days = $2, enabled = $3, updated_at = now(), updated_by = $4 WHERE source = $1`,
    [source, leadDays ?? existing.lead_days, enabled ?? existing.enabled, req.user!.email]
  );
  await logAudit("Clients", "EDIT_COMPLIANCE_REMINDER_SETTING", source, "leadDays", String(existing.lead_days), String(leadDays ?? existing.lead_days),
    `Compliance reminder setting for "${source}" edited by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

/** Preview of a single manual "Send to Client" for one deadline/flag line — same bilingual builder the automatic sweep uses, so a manual send and an automatic one always read identically. */
clientsRouter.get("/:clientId/deadline-notify-preview", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const label = String(req.query.label || "").trim();
  const date = String(req.query.date || "").trim();
  if (!label || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "label and date (YYYY-MM-DD) are required." });

  const client = await queryOne<any>(`SELECT client_name, email, phone, email_allowed, sms_allowed FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const daysUntil = Math.round((new Date(`${date}T00:00:00Z`).getTime() - new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime()) / 86400000);
  const firmName = (await getFirmProfile()).firmName;
  const { subject, body, smsBody } = buildComplianceReminderMessage(client.client_name, label, date, daysUntil, firmName);
  res.json({
    ok: true, subject, body, smsBody,
    canEmail: Boolean(client.email_allowed && client.email), canSms: Boolean(client.sms_allowed && client.phone),
    email: client.email, phone: client.phone,
  });
}));

/** Sends the manual "Send to Client" reminder for one deadline/flag line — staff picks channels, same delivery path (sendChannel) and communications-log convention as the automatic sweep, just its own source_system so the two are distinguishable in history. */
clientsRouter.post("/:clientId/deadline-notify-send", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const body = req.body || {};
  const label = String(body.label || "").trim();
  const date = String(body.date || "").trim();
  const source = String(body.source || "").trim();
  const channels: string[] = Array.isArray(body.channels) ? body.channels : [];
  if (!label || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "label and date (YYYY-MM-DD) are required." });
  if (!source || !REMINDABLE_SOURCES.has(source)) return res.status(400).json({ error: "Unrecognized obligation type." });
  if (channels.length === 0) return res.status(400).json({ error: "Select at least one channel to send with." });

  const client = await queryOne<any>(`SELECT client_name, email, phone, email_allowed, sms_allowed FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const daysUntil = Math.round((new Date(`${date}T00:00:00Z`).getTime() - new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime()) / 86400000);
  const firmName = (await getFirmProfile()).firmName;
  const { subject, body: emailBody, smsBody } = buildComplianceReminderMessage(client.client_name, label, date, daysUntil, firmName);

  const results: { channel: string; ok: boolean; error?: string }[] = [];
  const sentToParts: string[] = [];
  for (const channel of channels) {
    let ok = false, error: string | undefined;
    try {
      if (channel === "email") {
        if (!client.email) throw new Error("No email address on file.");
        if (!client.email_allowed) throw new Error("This client has not consented to email.");
        const r = await sendChannel("email", client.email, subject, emailBody, { firmName });
        if (!r.sent) throw new Error(r.error || "Send failed.");
        sentToParts.push(client.email);
      } else if (channel === "sms") {
        if (!client.phone) throw new Error("No phone number on file.");
        if (!client.sms_allowed) throw new Error("This client has not consented to SMS.");
        const r = await sendChannel("sms", client.phone, subject, smsBody, { firmName });
        if (!r.sent) throw new Error(r.error || "Send failed.");
        sentToParts.push(client.phone);
      } else {
        throw new Error(`Unknown channel "${channel}".`);
      }
      ok = true;
    } catch (err: any) {
      error = err?.message || "Send failed.";
    }
    results.push({ channel, ok, error });
  }
  const anySent = results.some((r) => r.ok);

  await query(
    `INSERT INTO altax.v3_communications
       (communication_id, client_id, client_name, related_task_id, subject, message_english, message_arabic,
        sent_to, sent_by, direction, channel, sent_at, status, source_system, source_record_id)
     VALUES ($1,$2,$3,NULL,$4,$5,'',$6,$7,'Outbound','Email',now(),$8,'ComplianceReminderManual',$9)`,
    [
      `COM-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`, clientId, client.client_name, subject, emailBody,
      sentToParts.join(", "), req.user!.email, anySent ? "Sent" : "Failed", `${deadlineReminderStableKey(clientId, source, date)}#manual#${Date.now()}`,
    ]
  );
  await logAudit("Clients", "COMPLIANCE_REMINDER_MANUAL_SEND", clientId, "", "", label,
    `Manual compliance reminder ("${label}", due ${date}) sent by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, results });
}));

/**
 * "Last sent" lookup for the Send to Client buttons (both deadline- and
 * flag-based) — direct owner request, 2026-08-26. Covers all three
 * source_systems a compliance reminder can land under (the automatic sweep,
 * a manual deadline send, a manual flag send) so "last sent" is the same
 * answer regardless of which path actually sent it. Each source_record_id is
 * `${stableKey}#auto#N` or `${stableKey}#manual#timestamp`
 * (deadlineReminderStableKey/flagReminderStableKey in complianceReminders.ts)
 * — splitting on "#" recovers the stable key so repeat sends for the same
 * slot collapse to one "most recent" answer instead of one row per send.
 * Returns keys with the clientId prefix stripped (the frontend already knows
 * its own clientId) so it can look up by plain `${source}:${date}` or
 * `flag:${flagKey}`.
 */
clientsRouter.get("/:clientId/reminder-history", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const rows = await query<any>(
    `SELECT source_record_id, sent_at FROM altax.v3_communications
      WHERE client_id = $1 AND status = 'Sent'
            AND source_system IN ('ComplianceReminder', 'ComplianceReminderManual', 'Client Flags')
      ORDER BY sent_at DESC`,
    [clientId]
  );
  const prefix = `${clientId}:`;
  const history: Record<string, string> = {};
  for (const row of rows) {
    const stableKey = String(row.source_record_id).split("#")[0];
    if (!stableKey.startsWith(prefix)) continue;
    const shortKey = stableKey.slice(prefix.length);
    if (!(shortKey in history)) history[shortKey] = row.sent_at;
  }
  res.json({ history });
}));

/**
 * Records the actual payment date for an obligation already marked done with
 * no payment recorded yet (see mark-done above) — the second half of the
 * filed/paid split. Cancels any pending payment-due reminder once payment is
 * genuinely recorded.
 */
clientsRouter.post("/:clientId/obligations/record-payment", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const body = req.body || {};
  const source = String(body.source || "").trim();
  const dueDate = String(body.dueDate || "").trim();
  const paidDate = String(body.paidDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) {
    return res.status(400).json({ error: "dueDate and paidDate must be YYYY-MM-DD." });
  }

  const existing = await queryOne<any>(
    `SELECT paid_date FROM altax.v3_obligation_completions WHERE client_id = $1 AND source = $2 AND due_date = $3::date`,
    [clientId, source, dueDate]
  );
  if (!existing) return res.status(400).json({ error: "This obligation hasn't been marked done yet — mark it done first." });
  if (existing.paid_date) return res.status(400).json({ error: "This obligation already has a payment recorded. Use Undo to correct it, then re-record." });

  await query(
    `UPDATE altax.v3_obligation_completions SET paid_date = $4 WHERE client_id = $1 AND source = $2 AND due_date = $3::date`,
    [clientId, source, dueDate, paidDate]
  );
  await logAudit("Clients", "OBLIGATION_RECORD_PAYMENT", clientId, "obligation", "", `${source} (${dueDate}): paid ${paidDate}`,
    `Payment for ${source} (due ${dueDate}) recorded as paid ${paidDate} by ${req.user!.email}.`, req.user!.email);

  const { cancelPaymentReminder } = await import("../../common/paymentReminders");
  await cancelPaymentReminder("ObligationCompletion", `${clientId}:${source}:${dueDate}`, "Payment recorded");

  res.json({ ok: true });
}));

/** Reverses a mark-done entry (staff correcting a mistake) — the deadline goes back to showing on the dashboard, same as before it was ever marked. */
clientsRouter.post("/:clientId/obligations/unmark-done", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const body = req.body || {};
  const source = String(body.source || "").trim();
  const dueDate = String(body.dueDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return res.status(400).json({ error: "dueDate must be YYYY-MM-DD." });

  await query(`DELETE FROM altax.v3_obligation_completions WHERE client_id = $1 AND source = $2 AND due_date = $3::date`, [clientId, source, dueDate]);
  await logAudit("Clients", "OBLIGATION_UNMARKED_DONE", clientId, "obligation", "", `${source} (${dueDate})`,
    `${source} (due ${dueDate}) un-marked by ${req.user!.email}.`, req.user!.email);

  const { cancelPaymentReminder } = await import("../../common/paymentReminders");
  await cancelPaymentReminder("ObligationCompletion", `${clientId}:${source}:${dueDate}`, "Obligation un-marked");
  res.json({ ok: true });
}));

/**
 * External verification tracking — staff manually checks a client's real
 * status on MDTAXCONNECT (sales tax filing/payment) and MD Business Express
 * (Annual Report / Good Standing), outside this app entirely. Previously
 * nothing recorded when a client was last checked, so staff kept re-checking
 * some clients while missing others with no way to tell which was which. A
 * one-click "Mark Checked Today" per portal (sql/095) is the whole feature —
 * latest-check-only, matching v3_obligation_completions' "mark done" shape,
 * not a full history log.
 */
const VERIFICATION_PORTALS: Record<string, { atColumn: string; byColumn: string }> = {
  mdtaxconnect: { atColumn: "mdtaxconnect_verified_at", byColumn: "mdtaxconnect_verified_by" },
  "md-business-express": { atColumn: "md_business_express_verified_at", byColumn: "md_business_express_verified_by" },
};

clientsRouter.post("/:clientId/verify/:portal", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, portal } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const cols = VERIFICATION_PORTALS[portal];
  if (!cols) return res.status(400).json({ error: "Unrecognized verification portal." });

  await query(
    `UPDATE altax.v3_clients SET ${cols.atColumn} = NOW(), ${cols.byColumn} = $2 WHERE client_id = $1`,
    [clientId, req.user!.email]
  );
  await logAudit("Clients", "EXTERNAL_VERIFICATION_CHECKED", clientId, portal, "", new Date().toISOString(),
    `${portal} checked by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

clientsRouter.post("/:clientId/flags/:flagId/resolve", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, flagId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const row = await queryOne<any>(`SELECT * FROM altax.v3_client_flags WHERE flag_id = $1 AND client_id = $2`, [flagId, clientId]);
  if (!row) return res.status(404).json({ error: "Flag not found." });
  await query(`UPDATE altax.v3_client_flags SET status = 'Resolved', resolved_by = $2, resolved_at = now() WHERE flag_id = $1`, [flagId, req.user!.email]);
  await logAudit("Clients", "FLAG_RESOLVED", clientId, "flag", "Open", "Resolved", `${row.flag_type} flag resolved by ${req.user!.email}.`, req.user!.email);
  await logClientActivity(clientId, "Flag Resolved", `${row.flag_type} flag${row.note ? ` (${row.note})` : ""} resolved.`, req.user!.email);
  res.json({ ok: true });
}));

clientsRouter.post("/:clientId/flags/:flagId/delete", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, flagId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const row = await queryOne<any>(`SELECT * FROM altax.v3_client_flags WHERE flag_id = $1 AND client_id = $2`, [flagId, clientId]);
  if (!row) return res.status(404).json({ error: "Flag not found." });
  await query(`DELETE FROM altax.v3_client_flags WHERE flag_id = $1`, [flagId]);
  await logAudit("Clients", "FLAG_DELETED", clientId, "flag", row.flag_type, "", `${row.flag_type} flag deleted by ${req.user!.email}.`, req.user!.email);
  await logClientActivity(clientId, "Flag Deleted", `${row.flag_type} flag${row.note ? ` (${row.note})` : ""} deleted.`, req.user!.email);
  res.json({ ok: true });
}));

/** Resolved manual flags — read-only, powers the panel's "View History" section. */
clientsRouter.get("/:clientId/flags/history", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  res.json({ flags: await computeResolvedClientFlags(clientId) });
}));

/** Flips whether a manual flag is allowed to appear in a client-facing notification — see POST :clientId/flags/notify-preview. */
clientsRouter.post("/:clientId/flags/:flagId/toggle-share", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, flagId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const row = await queryOne<any>(`SELECT * FROM altax.v3_client_flags WHERE flag_id = $1 AND client_id = $2`, [flagId, clientId]);
  if (!row) return res.status(404).json({ error: "Flag not found." });
  const next = !row.share_with_client;
  await query(`UPDATE altax.v3_client_flags SET share_with_client = $2 WHERE flag_id = $1`, [flagId, next]);
  await logAudit("Clients", "FLAG_SHARE_TOGGLED", clientId, "flag", String(row.share_with_client), String(next),
    `${row.flag_type} flag ${next ? "marked shareable with" : "hidden from"} client by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true, shareWithClient: next });
}));

/** English/Arabic label pairs for the flag types and preset categories staff can pick — everything not in these maps (a custom dropdown option, or free-text notes) stays as the original English text in both columns, same convention computeClientPeriodSummaryTable already uses for staff-defined free text with no stored translation. */
const FLAG_TYPE_LABELS_AR: Record<string, string> = {
  BalancePastDue: "رصيد متأخر السداد",
  AgencyPastDue: "تقديم متأخر لدى الجهة الحكومية",
  SalesTaxFilingDue: "تقديم إقرار ضريبة المبيعات",
  SalesTaxBalanceDue: "رصيد ضريبة المبيعات المستحق",
  PayrollCadenceGap: "توقف في معالجة الرواتب",
  BookkeepingStale: "الدفاتر المحاسبية غير محدثة",
  Credit: "رصيد دائن في الحساب",
};
const FLAG_CATEGORY_LABELS_AR: Record<string, string> = {
  "Balance Past Due": "رصيد متأخر السداد",
  "Not in Good Standing": "الوضع القانوني غير سليم",
  "Compliance Issue": "عدم الالتزام بمتطلبات قوانين سياسة الشركات في ولاية ماريلاند",
  "Missing Documentation": "مستندات ناقصة",
  "Legal / Dispute": "نزاع / مسألة قانونية",
  "Ownership Change Pending": "تغيير الملكية قيد الإجراء",
  "Collections": "تحصيل ديون",
  "Other": "أخرى",
};
const FLAG_TYPE_LABELS_EN: Record<string, string> = {
  BalancePastDue: "Balance Past Due",
  AgencyPastDue: "Agency Filing Past Due",
  SalesTaxFilingDue: "Sales Tax Filing",
  SalesTaxBalanceDue: "Sales Tax Balance Due",
  PayrollCadenceGap: "Payroll Processing Gap",
  BookkeepingStale: "Bookkeeping Not Up to Date",
  Credit: "Credit on Account",
};

/**
 * Builds the bilingual EN/AR body for a "here are your open account items"
 * notification — pure computation, no send. Only flags with
 * shareWithClient=true are ever included (see the migration's doc comment
 * for why manual flags default to excluded). Returns null when there's
 * nothing shareable, so the route can 404 with a clear reason instead of
 * sending an empty message.
 */
async function buildClientFlagsNotification(clientId: string, selectedKeys?: string[]): Promise<{ subject: string; messageEnglish: string; messageArabic: string; count: number; flags: ClientFlag[] } | null> {
  const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return null;
  const shareable = (await computeClientFlags(clientId)).flags.filter((f) => f.shareWithClient);
  if (shareable.length === 0) return null;
  // A one-time, per-send filter only — never touches share_with_client itself
  // (that stays the separate standing toggle via POST .../toggle-share).
  // Filtering happens server-side against the already-shareable set, so a
  // tampered flagKeys list can never smuggle in a non-shareable flag.
  const flags = selectedKeys ? shareable.filter((f) => selectedKeys.includes(f.key)) : shareable;
  if (flags.length === 0) return null;

  // Kept as PLAIN text here on purpose — this result is reused for SMS, a
  // staff preview endpoint, and the stored v3_communications log, none of
  // which should ever see HTML-escaped entities. Only the actual email send
  // (clientsRouter.post(".../flags/notify-send")) escapes it, right before
  // building the HTML body.
  const enLines: string[] = [];
  const arLines: string[] = [];
  for (const f of flags) {
    const label = f.category || FLAG_TYPE_LABELS_EN[f.flagType] || f.flagType;
    const labelAr = f.category
      ? (FLAG_CATEGORY_LABELS_AR[f.category] || f.category)
      : (FLAG_TYPE_LABELS_AR[f.flagType] || label);
    const amountText = f.amount !== null ? ` — ${fmtMoneyPlain(f.amount)}` : "";
    const noteText = f.flagType !== "Custom" && f.note ? ` (${f.note})` : "";
    const dueText = f.dueDate ? ` — Due ${fmtFlagDate(f.dueDate)}` : "";
    const dueTextAr = f.dueDate ? ` — الاستحقاق ${fmtFlagDate(f.dueDate)}` : "";
    enLines.push(`• ${label}${noteText}${amountText}${dueText}${f.details ? `: ${f.details}` : ""}`);
    arLines.push(`• ${labelAr}${noteText}${amountText}${dueTextAr}${f.details ? `: ${f.details}` : ""}`);
  }

  const firmName = (await getFirmProfile()).firmName;
  const subject = `Account Notice — ${client.client_name}`;
  const messageEnglish = [
    `Dear ${client.client_name},`, "",
    "The following item(s) on your account need your attention:", "",
    ...enLines, "",
    "If you have any questions or would like help resolving these, please reply to this message or contact our office.", "",
    "Thank you,", firmName,
  ].join("\n");
  const messageArabic = [
    `عزيزنا ${client.client_name}،`, "",
    "يوجد البند/البنود التالية في حسابكم بحاجة إلى المتابعة:", "",
    ...arLines, "",
    "إذا كانت لديكم أي أسئلة أو ترغبون بالمساعدة في حل هذه الأمور، يرجى الرد على هذه الرسالة أو التواصل مع مكتبنا.", "",
    "شكراً لكم،", firmName,
  ].join("\n");

  return { subject, messageEnglish, messageArabic, count: flags.length, flags: shareable };
}

/**
 * Client-portal read model of "here's what's outstanding on your account" —
 * only flags staff has explicitly marked shareWithClient=true, and only the
 * fields needed to display them. No flagId-driven action is exposed to the
 * client: a flag is a fact only staff can resolve (by fixing the underlying
 * balance/filing/issue), so this is deliberately read-only. A notice
 * disappears from this list the moment staff resolves it or unshares it —
 * same computeClientFlags() the staff-side panel uses, just filtered and
 * bilingual-labeled for the client's own view.
 */
clientsRouter.get("/notices/mine", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (req.user!.role !== "client" || !req.user!.clientId) return res.json({ notices: [] });
  const flags = (await computeClientFlags(req.user!.clientId)).flags.filter((f) => f.shareWithClient);
  const notices = flags.map((f) => {
    const labelEn = f.category || FLAG_TYPE_LABELS_EN[f.flagType] || f.flagType;
    const labelAr = f.category
      ? (FLAG_CATEGORY_LABELS_AR[f.category] || f.category)
      : (FLAG_TYPE_LABELS_AR[f.flagType] || labelEn);
    return {
      flagId: f.flagId,
      labelEn, labelAr,
      note: f.flagType !== "Custom" ? f.note : null,
      details: f.details ?? null,
      amount: f.amount,
      dueDate: f.dueDate ?? null,
      color: f.color,
    };
  });
  res.json({ notices });
}));

/** Read-only preview of what a "Notify Client" send would contain — lets the frontend show/edit the bilingual message before actually sending it via POST /communications. */
clientsRouter.get("/:clientId/flags/notify-preview", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const flagKeysParam = typeof req.query.flagKeys === "string" ? req.query.flagKeys : undefined;
  const selectedKeys = flagKeysParam !== undefined
    ? flagKeysParam.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const content = await buildClientFlagsNotification(clientId, selectedKeys);
  if (!content) return res.status(404).json({ error: "No flags are marked to share with the client yet. Check \"Share with client\" on a flag first." });
  res.json({ ok: true, ...content });
}));

/**
 * One-click "Send to Client" for a single Account Flags line — direct
 * owner request, 2026-08-26, alongside the compliance deadline reminders
 * above. Unlike the bulk "Notify Client" flow (NotifyClientFlagsModal,
 * which previews/lets staff edit before posting to the generic
 * POST /communications composer), this sends immediately to the client's
 * own email/phone, matching the same self-contained shape as
 * /:clientId/deadline-notify-send — the frontend button doesn't need to
 * already know the client's contact info or pick a channel.
 */
clientsRouter.post("/:clientId/flags/notify-send", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const flagKeys: string[] = Array.isArray(req.body?.flagKeys) ? req.body.flagKeys : [];
  if (flagKeys.length === 0) return res.status(400).json({ error: "No flag specified." });

  const content = await buildClientFlagsNotification(clientId, flagKeys);
  if (!content) return res.status(404).json({ error: "No flags are marked to share with the client yet. Check \"Share with client\" on a flag first." });

  const client = await queryOne<any>(`SELECT client_name, email, phone, email_allowed, sms_allowed FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });
  const canEmail = Boolean(client.email_allowed && client.email);
  const canSms = Boolean(client.sms_allowed && client.phone);
  if (!canEmail && !canSms) return res.status(400).json({ error: "This client has not consented to email or SMS, so no reminder can be sent." });

  const firmName = (await getFirmProfile()).firmName;
  const smsBody = content.messageEnglish.length > 400 ? `${content.subject}. ${firmName} will follow up by email/portal for full details.` : content.messageEnglish;
  let anySent = false;
  let providerMessageId: string | null = null;
  const sentToParts: string[] = [];
  if (canEmail) {
    // Escaped only here, for the HTML email render — content.messageEnglish/
    // messageArabic stay plain everywhere else (SMS above, the stored log below).
    const emailBody = `${escapeHtml(content.messageEnglish)}\n\n---\n\n${escapeHtml(content.messageArabic)}`;
    const r = await sendChannel("email", client.email, content.subject, emailBody, { firmName });
    if (r.sent) { anySent = true; providerMessageId = r.providerMessageId || null; sentToParts.push(client.email); }
  }
  if (canSms) {
    const r = await sendChannel("sms", client.phone, content.subject, smsBody, { firmName });
    if (r.sent) { anySent = true; providerMessageId = providerMessageId || r.providerMessageId || null; sentToParts.push(client.phone); }
  }

  await query(
    `INSERT INTO altax.v3_communications
       (communication_id, client_id, client_name, related_task_id, subject, message_english, message_arabic,
        sent_to, sent_by, direction, channel, sent_at, status, source_system, source_record_id, provider_message_id)
     VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,'Outbound','Email',now(),$9,'Client Flags',$10,$11)`,
    [
      `COM-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`, clientId, client.client_name, content.subject,
      content.messageEnglish, content.messageArabic, sentToParts.join(", "), req.user!.email,
      anySent ? "Sent" : "Failed", `${flagReminderStableKey(clientId, flagKeys.join(","))}#manual#${Date.now()}`, providerMessageId,
    ]
  );
  await logAudit("Clients", "CLIENT_FLAG_NOTIFIED", clientId, "", "", flagKeys.join(","),
    `Account flag notice sent to client by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, sent: anySent });
}));

const SWOT_FIELDS = [
  "overview", "strengths", "weaknesses", "opportunities", "threats",
  "taxRecommendations", "staffingRecommendations", "marketingRecommendations", "growthRecommendations", "additionalNotes",
  // Business Intake — 12 specific questions across 6 categories, replacing
  // the original 4 broad free-text boxes (sql/038) with something designed
  // to actually elicit what informs Staffing/Marketing/Growth Plan below —
  // qualitative context no transaction in this system can infer, gathered
  // directly from the client/staff conversation. See
  // sql/044_client_swot_intake_questions.sql.
  "typicalCustomer", "serviceArea",
  "topCompetitors", "competitiveEdge",
  "customerAcquisition", "currentMarketing",
  "staffingLevel", "staffingChallenges",
  "topGoal", "expansionPlans",
  "dailyChallenge", "financialConcerns",
] as const;
const SWOT_COLUMNS: Record<(typeof SWOT_FIELDS)[number], string> = {
  overview: "overview", strengths: "strengths", weaknesses: "weaknesses", opportunities: "opportunities", threats: "threats",
  taxRecommendations: "tax_recommendations", staffingRecommendations: "staffing_recommendations",
  marketingRecommendations: "marketing_recommendations", growthRecommendations: "growth_recommendations", additionalNotes: "additional_notes",
  typicalCustomer: "typical_customer", serviceArea: "service_area",
  topCompetitors: "top_competitors", competitiveEdge: "competitive_edge",
  customerAcquisition: "customer_acquisition", currentMarketing: "current_marketing",
  staffingLevel: "staffing_level", staffingChallenges: "staffing_challenges",
  topGoal: "top_goal", expansionPlans: "expansion_plans",
  dailyChallenge: "daily_challenge", financialConcerns: "financial_concerns",
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
// admin/staff only — this is internal advisory content (Weaknesses, Threats,
// staff's private notes) never meant for a client or employee to read
// directly. canAccessClient alone isn't enough here: for role "client" it
// returns true for the client's OWN clientId, which would otherwise let a
// client hit this endpoint directly (bypassing the frontend's staff-only
// tab gate) and see internal-only content. See the separate, deliberately
// narrower /business-intake routes below for what a client IS allowed to
// read/write on this same table.
clientsRouter.get("/:clientId/swot", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
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

  // Built from SWOT_FIELDS/SWOT_COLUMNS rather than a hand-written column
  // list — the GET route above already loops over these arrays generically;
  // this keeps the PATCH route in sync automatically the next time a field
  // is added here, instead of needing this SQL edited by hand too.
  const columns = SWOT_FIELDS.map((f) => SWOT_COLUMNS[f]);
  const valuePlaceholders = columns.map((_, i) => `$${i + 2}`);
  const updatedByPlaceholder = `$${columns.length + 2}`;
  const setClause = columns.map((col, i) => `${col}=$${i + 2}`).join(", ");
  await query(
    `INSERT INTO altax.v3_client_swot
       (client_id, ${columns.join(", ")}, updated_by, updated_at)
     VALUES ($1, ${valuePlaceholders.join(", ")}, ${updatedByPlaceholder}, now())
     ON CONFLICT (client_id) DO UPDATE SET
       ${setClause}, updated_by=${updatedByPlaceholder}, updated_at=now()`,
    [clientId, ...values, req.user!.email]
  );
  await logAudit("Clients", "EDIT_SWOT", clientId, "", "", "", `Business advisory analysis (SWOT) updated by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

// The 12 Business Intake questions only — a deliberately narrow subset of
// SWOT_FIELDS. Reused here (not redefined) so a future new intake question
// only ever needs adding to SWOT_FIELDS once.
const INTAKE_FIELDS = SWOT_FIELDS.slice(10) as readonly (typeof SWOT_FIELDS)[number][];

function intakeRowToJson(row: any) {
  const out: Record<string, any> = {};
  for (const field of INTAKE_FIELDS) out[field] = row?.[SWOT_COLUMNS[field]] || "";
  out.updatedBy = row?.updated_by || null;
  out.updatedAt = row?.updated_at || null;
  return out;
}

/**
 * Client self-service on the same 12 Business Intake questions staff see on
 * the SWOT Analysis tab (sql/044) — a client answering these directly, in
 * their own words, gets more clients actually covered than relying on staff
 * to ask and type it in during a call. Deliberately narrower than the
 * staff-only /swot routes above: only these 12 columns are readable/
 * writable here, never the narrative Strengths/Weaknesses/Threats/
 * Recommendations fields — those stay internal, staff-only. Employees are
 * explicitly excluded (canAccessClient alone would allow them, same as
 * client — but an employee is an individual worker, not the business
 * owner, and has no business answering questions about the employer's
 * competitors or growth plans).
 */
clientsRouter.get("/:clientId/business-intake", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (req.user!.role === "employee") return res.status(403).json({ error: "You do not have access to this." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const row = await queryOne<any>(`SELECT * FROM altax.v3_client_swot WHERE client_id = $1`, [clientId]);
  res.json({ intake: intakeRowToJson(row) });
}));

clientsRouter.patch("/:clientId/business-intake", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (req.user!.role === "employee") return res.status(403).json({ error: "You do not have access to this." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const body = req.body || {};
  const values = INTAKE_FIELDS.map((f) => (body[f] !== undefined ? String(body[f]) : undefined));
  const columns = INTAKE_FIELDS.map((f) => SWOT_COLUMNS[f]);

  // Only ever touches the 12 intake columns — an UPDATE, not the full
  // upsert the staff /swot route uses, since a client submitting the intake
  // form before any staff member has ever opened the SWOT tab for them
  // still needs a row to exist first.
  await query(
    `INSERT INTO altax.v3_client_swot (client_id, updated_by, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (client_id) DO NOTHING`,
    [clientId, req.user!.email]
  );
  const setParts: string[] = [];
  const params: any[] = [clientId];
  columns.forEach((col, i) => {
    if (values[i] === undefined) return;
    params.push(values[i]);
    setParts.push(`${col} = $${params.length}`);
  });
  if (setParts.length > 0) {
    params.push(req.user!.email);
    await query(
      `UPDATE altax.v3_client_swot SET ${setParts.join(", ")}, updated_by = $${params.length}, updated_at = now() WHERE client_id = $1`,
      params
    );
  }

  await logAudit("Clients", "EDIT_BUSINESS_INTAKE", clientId, "", "", "", `Business Intake questionnaire updated by ${req.user!.email}.`, req.user!.email);

  // Best-effort heads-up to the assigned staff member when a CLIENT (not
  // staff editing their own client) submits — otherwise a client filling
  // this out has no way of knowing anyone noticed. Never blocks the save.
  if (req.user!.role === "client") {
    try {
      const client = await queryOne<any>(`SELECT client_name, assigned_to FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
      const assigneeEmail = client?.assigned_to ? await resolveAssigneeEmail(client.assigned_to) : null;
      if (assigneeEmail) {
        const html = await wrapEmailHtml(
          `<p>${client.client_name} just updated their Business Intake answers (Target Market, Competitors, Goals, Challenges) on the SWOT Analysis tab.</p>
           <p>Review it before writing or updating the Staffing/Marketing recommendations.</p>`,
          req
        );
        await sendEmail({ to: assigneeEmail, subject: `${client.client_name} updated their business profile`, html });
      }
    } catch { /* best-effort — never block the client's save */ }
  }

  res.json({ ok: true });
}));

// Individual clients have no payroll/registered-agent/sales-tax needs — same
// filter frontend/src/utils/clientOptions.ts's INDIVIDUAL_SERVICE_KEYS applies
// for the "check a new service" list, mirrored here since that constant isn't
// exported backend-side (only FIRM_SERVICES/SERVICE_LABEL are, from contractContent.ts).
const INDIVIDUAL_SERVICE_KEYS = ["personal_tax_prep", "immigration", "consulting"];

function fmtMoneyPlain(v: number): string {
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtFlagDate(v: unknown): string {
  const d = v ? new Date(v as string) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { timeZone: "UTC" }) : "";
}

/**
 * Assembles a fully-resolved SwotEngineInput from real data (GL, tasks,
 * invoices, tax liabilities, cash, MD filing, budgets, payroll) — the
 * single place that gathers everything the structured-findings engine
 * (swotFindingsEngine.ts) needs, so both the legacy "Auto-Fill" draft and
 * the new "Generate Findings Now" action read off one consistent snapshot.
 */
async function assembleSwotEngineInput(clientId: string, clientRow: any): Promise<SwotEngineInput> {
  const { from: fromStr, to: toStr } = defaultFirmSummaryRange();

  const [financials, ops, cashBalance, alertSettings, has2553Row] = await Promise.all([
    computeFirmSummary(fromStr, toStr, clientId),
    computeClientOpsSummary(clientId),
    computeClientCashBalance(clientId),
    getDashboardAlertSettings(),
    queryOne<any>(`SELECT 1 FROM altax.v3_gov_form_filings WHERE client_id = $1 AND form_type = '2553' AND status != 'Void' LIMIT 1`, [clientId]),
  ]);
  const has2553Filing = Boolean(has2553Row);
  const { trendPct, startedFromZero } = computeRevenueTrend(financials.months);

  const overdueInvoiceRows = await query<any>(
    `SELECT invoice_id, balance_due, (CURRENT_DATE - due_date::date) AS days_overdue
       FROM altax.v3_invoices
      WHERE client_id = $1 AND status NOT IN ('Paid', 'Void') AND balance_due > 0
            AND due_date IS NOT NULL AND (CURRENT_DATE - due_date::date) > 0
      ORDER BY days_overdue DESC`,
    [clientId]
  );
  const overdueInvoices = overdueInvoiceRows.map((r: any) => ({ invoiceId: r.invoice_id, balanceDue: Number(r.balance_due), daysOverdue: Number(r.days_overdue) }));

  let mdFilingOnTime: boolean | null = null;
  const mdLatePeriodEnds: string[] = [];
  let mdCurrentPeriodEnd: string | null = null;
  let mdCurrentPeriodDueDate: string | null = null;
  let mdCurrentPeriodTaxDue = 0;
  let mdCurrentPeriodOnTime: boolean | null = null;
  // Set from the current period's markedFiledDate (mdFiling.ts) — non-null
  // only when staff has genuinely used "Mark Period Filed" for this period
  // (a real v3_md_filing_payments row), not just because the period isn't
  // due yet. See swotFindingsEngine.ts's mdCurrentPeriodAlreadyMarkedFiled
  // doc comment for why this has to be tracked separately from onTime.
  let mdCurrentPeriodAlreadyMarkedFiled = false;
  if (clientRow.state === "MD") {
    const reportClient: ReportClientInfo = {
      clientId, clientName: clientRow.client_name, ein: clientRow.ein, address: clientRow.address,
      state: clientRow.state, salesTaxFrequency: clientRow.sales_tax_frequency,
    };
    const mdFiling = await computeMdFilingForReport(reportClient, fromStr, toStr);
    if (mdFiling && mdFiling.periods.length > 0) {
      mdFilingOnTime = mdFiling.periods.every((p) => p.onTime);
      for (const p of mdFiling.periods) if (!p.onTime) mdLatePeriodEnds.push(p.end);
      const current = mdFiling.periods[mdFiling.periods.length - 1];
      mdCurrentPeriodEnd = current.end;
      mdCurrentPeriodDueDate = current.dueDate;
      mdCurrentPeriodTaxDue = Number(current.taxDue) || 0;
      mdCurrentPeriodOnTime = current.onTime;
      mdCurrentPeriodAlreadyMarkedFiled = Boolean(current.markedFiledDate);
    }
  }

  const currentServices: string[] = Array.isArray(clientRow.services) ? clientRow.services : [];
  const eligible = clientRow.client_type === "Individual"
    ? FIRM_SERVICES.filter((s) => INDIVIDUAL_SERVICE_KEYS.includes(s.key))
    : FIRM_SERVICES;
  const serviceGaps = eligible.filter((s) => !s.legacy && !currentServices.includes(s.key)).map((s) => ({ key: s.key, label: s.label }));

  const now = new Date();
  const periodLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [budgetRows, actualRows, coaRows] = await Promise.all([
    query<any>(`SELECT account_name, amount FROM altax.v3_budgets WHERE client_id = $1 AND year = $2 AND month = $3`, [clientId, now.getFullYear(), now.getMonth() + 1]),
    query<any>(
      `SELECT account, COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit
         FROM altax.v3_gl_entries
        WHERE client_id = $1 AND EXTRACT(YEAR FROM entry_date) = $2 AND EXTRACT(MONTH FROM entry_date) = $3
        GROUP BY account`,
      [clientId, now.getFullYear(), now.getMonth() + 1]
    ),
    query<any>(`SELECT account_name, account_type FROM altax.v3_coa WHERE active = true AND account_type = ANY($1::text[])`, [["Income", "COGS", "Expense"]]),
  ]);
  const typeByAccount = new Map<string, "Income" | "COGS" | "Expense">(coaRows.map((a: any) => [a.account_name, a.account_type]));
  const budgetVariances = budgetRows.map((b: any) => {
    const actualRow = actualRows.find((r: any) => r.account === b.account_name);
    const accountType = typeByAccount.get(b.account_name) || "Expense";
    const actual = actualRow ? (accountType === "Income" ? Number(actualRow.credit) - Number(actualRow.debit) : Number(actualRow.debit) - Number(actualRow.credit)) : 0;
    const budgetAmount = Number(b.amount);
    return { accountName: b.account_name, accountType, budget: budgetAmount, actual: Math.round(actual * 100) / 100, variance: Math.round((actual - budgetAmount) * 100) / 100, periodLabel };
  });

  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [payrollThisMonth, payrollLastMonth] = await Promise.all([
    loadPayrollForPeriod(clientId, thisMonthStart.toISOString().slice(0, 10), toStr),
    loadPayrollForPeriod(clientId, lastMonthStart.toISOString().slice(0, 10), lastMonthEnd.toISOString().slice(0, 10)),
  ]);

  let yearsInBusiness: number | null = null;
  if (clientRow.date_of_formation) {
    const years = Math.floor((Date.now() - new Date(clientRow.date_of_formation).getTime()) / (365.25 * 24 * 3600 * 1000));
    if (years >= 0) yearsInBusiness = years;
  }

  // EFTPS/MD Withholding/MD UI/Business Tax Return upcoming deadlines — same
  // engine that feeds the dashboard's Upcoming Deadlines card. MD Sales Tax,
  // Payroll, Federal Payroll Tax, MD Annual Report, and S-Corp Election are
  // filtered out here since they already have their own dedicated finding
  // rules (or, for MD Annual Report, aren't yet one — left for a later pass).
  const obligationCompletionRows = await query<any>(`SELECT source, due_date FROM altax.v3_obligation_completions WHERE client_id = $1`, [clientId]);
  const obligationCompletedKeys = new Set(obligationCompletionRows.map((r: any) => `${r.source}|${new Date(r.due_date).toISOString().slice(0, 10)}`));
  const upcomingObligationDeadlines = computeUpcomingDeadlines({
    mdCurrentPeriodDueDate: null, payrollNextDate: null, payrollEnabled: false,
    eftpsEnabled: Boolean(clientRow.eftps_enabled),
    mdWithholdingFrequency: clientRow.md_withholding_frequency || null,
    mduiEnabled: Boolean(clientRow.mdui_enabled),
    businessReturnType: clientRow.business_return_type || null,
    clientType: clientRow.client_type || null,
    completedKeys: obligationCompletedKeys,
    withinDays: 60,
  }).filter((d) => d.source === "EFTPS" || d.source === "MD Withholding" || d.source === "MD UI" || d.source === "Business Tax Return" || d.source === "Individual Tax Return" || d.source === "Estimated Tax");

  return {
    clientId, industryCategory: clientRow.industry_category || null, yearsInBusiness,
    entityType: clientRow.entity_type || null,
    // date_of_formation comes back from pg as a JS Date, not a string —
    // String(date) gives "Mon Jun 03 2026 ..." (not parseable as an ISO
    // date), the same class of bug this file's yearsInBusiness calc just
    // above already avoids by going through new Date(...).getTime() instead.
    dateOfFormation: clientRow.date_of_formation ? new Date(clientRow.date_of_formation).toISOString().slice(0, 10) : null,
    has2553Filing,
    currentServiceLabels: currentServices.map((k) => SERVICE_LABEL[k] || k), serviceGaps,
    clientTypeIsIndividual: clientRow.client_type === "Individual",
    revenue: financials.totals.revenue, profit: financials.totals.profit, trendPct, startedFromZero,
    openTasks: ops.openTasks, balanceDue: ops.balanceDue, overdueInvoices,
    taxLiabilities: financials.taxLiabilities, cashBalance,
    mdFilingOnTime, mdLatePeriodEnds, mdCurrentPeriodEnd, mdCurrentPeriodDueDate, mdCurrentPeriodTaxDue, mdCurrentPeriodOnTime,
    mdCurrentPeriodAlreadyMarkedFiled,
    upcomingObligationDeadlines,
    budgetVariances,
    payrollThisMonthCost: payrollThisMonth.totalCost, payrollLastMonthCost: payrollLastMonth.totalCost, payrollPeriodLabel: periodLabel,
    alertThresholds: { cashThreshold: alertSettings.cashThreshold, overdueDaysThreshold: alertSettings.overdueDaysThreshold, filingDeadlineDaysThreshold: alertSettings.filingDeadlineDaysThreshold },
  };
}

/**
 * Deterministic, rule-based draft for the 6 SWOT/advisory fields that have a
 * real data signal behind them. Now a thin wrapper around the structured
 * findings engine (swotFindingsEngine.ts) — groups the same candidates the
 * "Generate Findings Now" action persists into the 6 legacy paragraph
 * fields, so the "Auto-Fill from Business Data" button's behavior is
 * unchanged from before the structured-findings layer existed.
 *
 * Staffing/Marketing/Additional Notes are deliberately NOT drafted here —
 * nothing in this system tracks marketing performance or staffing adequacy,
 * so inventing text for those would just be generic filler dressed as
 * analysis. Those stay staff-written, informed by the Business Intake
 * answers (target market, competitors, goals) shown alongside them.
 */
async function computeSwotAutoDraft(clientRow: any, clientId: string) {
  const input = await assembleSwotEngineInput(clientId, clientRow);
  const findings = computeSwotFindings(input);
  const legacy = groupFindingsToLegacyFields(findings);

  const overviewParts: string[] = [];
  if (input.industryCategory) overviewParts.push(`Operates in the ${input.industryCategory} industry`);
  if (input.yearsInBusiness !== null) overviewParts.push(`in business ${input.yearsInBusiness} year${input.yearsInBusiness === 1 ? "" : "s"}`);
  if (input.currentServiceLabels.length > 0) overviewParts.push(`currently engaged for: ${input.currentServiceLabels.join(", ")}`);
  const overview = overviewParts.length ? `${overviewParts.join(", ")}.` : "";

  return { ...legacy, overview };
}

clientsRouter.post("/:clientId/swot/autodraft", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const clientRow = await queryOne<any>(
    `SELECT client_name, ein, address, state, sales_tax_frequency, industry_category, date_of_formation, entity_type, services, client_type
       FROM altax.v3_clients WHERE client_id = $1`,
    [clientId]
  );
  if (!clientRow) return res.status(404).json({ error: "Client not found." });
  const draft = await computeSwotAutoDraft(clientRow, clientId);
  res.json({ draft });
}));

const FINDING_FIELDS = [
  "category", "subcategory", "findingText", "supportingData", "businessImpact",
  "priority", "recommendedAction", "responsibleParty", "targetDate", "status", "dataType",
] as const;
const FINDING_COLUMNS: Record<(typeof FINDING_FIELDS)[number], string> = {
  category: "category", subcategory: "subcategory", findingText: "finding_text", supportingData: "supporting_data",
  businessImpact: "business_impact", priority: "priority", recommendedAction: "recommended_action",
  responsibleParty: "responsible_party", targetDate: "target_date", status: "status", dataType: "data_type",
};

function findingRowToJson(row: any) {
  const out: Record<string, any> = { findingId: row.finding_id, clientId: row.client_id };
  for (const f of FINDING_FIELDS) out[f] = row[FINDING_COLUMNS[f]];
  out.source = row.source;
  out.autoTriggerKey = row.auto_trigger_key;
  out.editedByStaff = row.edited_by_staff;
  out.reviewedBy = row.reviewed_by;
  out.reviewedAt = row.reviewed_at;
  out.dismissedReason = row.dismissed_reason;
  out.createdBy = row.created_by;
  out.createdAt = row.created_at;
  out.resolvedBy = row.resolved_by;
  out.resolvedAt = row.resolved_at;
  out.updatedAt = row.updated_at;
  return out;
}

// crypto.randomUUID() rather than a 3-digit random suffix — the nightly
// sweep (runSwotFindingsSweep) can insert many rows across many clients
// within the same wall-clock second, and a 900-value keyspace collided in
// real testing (145 clients, 4 duplicate-key failures in one run). A UUID
// slice makes that collision probability negligible.
function nextFindingId(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `SWF-${ts}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

const PRIORITY_ORDER: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const STATUS_ORDER: Record<string, number> = { Open: 0, "In Progress": 1, Resolved: 2, Dismissed: 3 };

/**
 * Structured findings — one row per discrete finding, each carrying the 8
 * elements a real advisory item needs (finding, supporting data, impact,
 * priority, recommended action, owner, due date, status). Sits alongside
 * the free-text narrative fields above (v3_client_swot), not a replacement
 * for them. See sql/040_swot_findings.sql.
 */
clientsRouter.get("/:clientId/swot-findings", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const rows = await query<any>(`SELECT * FROM altax.v3_swot_findings WHERE client_id = $1`, [clientId]);
  const findings = rows
    .map(findingRowToJson)
    .sort((a: any, b: any) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) || (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
  res.json({ findings });
}));

clientsRouter.post("/:clientId/swot-findings", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const body = req.body || {};
  if (!body.category || !body.findingText) return res.status(400).json({ error: "Category and finding text are required." });
  const findingId = nextFindingId();
  await query(
    `INSERT INTO altax.v3_swot_findings
       (finding_id, client_id, category, subcategory, finding_text, supporting_data, business_impact,
        priority, recommended_action, responsible_party, target_date, status, source, data_type, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Manual', $13, $14)`,
    [
      findingId, clientId, body.category, body.subcategory || null, body.findingText, body.supportingData || "",
      body.businessImpact || null, body.priority || "Medium", body.recommendedAction || null,
      body.responsibleParty || null, body.targetDate || null, body.status || "Open", body.dataType || "Fact",
      req.user!.email,
    ]
  );
  await logAudit("Clients", "CREATE_SWOT_FINDING", clientId, "finding", "", body.findingText, `Finding created by ${req.user!.email}.`, req.user!.email);
  const row = await queryOne<any>(`SELECT * FROM altax.v3_swot_findings WHERE finding_id = $1`, [findingId]);
  res.status(201).json({ finding: findingRowToJson(row) });
}));

clientsRouter.patch("/:clientId/swot-findings/:findingId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, findingId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_swot_findings WHERE finding_id = $1 AND client_id = $2`, [findingId, clientId]);
  if (!existing) return res.status(404).json({ error: "Finding not found." });

  const body = req.body || {};
  const sets: string[] = [];
  const values: any[] = [];
  let i = 1;
  const auditLines: string[] = [];
  for (const f of FINDING_FIELDS) {
    if (body[f] === undefined) continue;
    const col = FINDING_COLUMNS[f];
    const oldVal = existing[col];
    const newVal = body[f];
    if (String(oldVal ?? "") === String(newVal ?? "")) continue;
    sets.push(`${col} = $${i}`);
    values.push(newVal === "" ? null : newVal);
    i++;
    auditLines.push(`${f}: "${oldVal ?? ""}" -> "${newVal ?? ""}"`);
  }
  if (sets.length === 0) return res.json({ finding: findingRowToJson(existing) });

  // Every Auto-sourced finding is locked from future automated changes the
  // moment a human edits it — the Phase 3 reconciliation sweep checks this
  // flag before ever touching a row, so automation can never silently
  // overwrite staff judgment.
  sets.push(`edited_by_staff = true`, `updated_at = now()`);
  if (!existing.reviewed_by) { sets.push(`reviewed_by = $${i}`, `reviewed_at = now()`); values.push(req.user!.email); i++; }

  await query(`UPDATE altax.v3_swot_findings SET ${sets.join(", ")} WHERE finding_id = $${i}`, [...values, findingId]);
  await logAudit("Clients", "EDIT_SWOT_FINDING", clientId, "finding", "", "", `Finding ${findingId} updated by ${req.user!.email}: ${auditLines.join("; ")}`, req.user!.email);
  const row = await queryOne<any>(`SELECT * FROM altax.v3_swot_findings WHERE finding_id = $1`, [findingId]);
  res.json({ finding: findingRowToJson(row) });
}));

clientsRouter.post("/:clientId/swot-findings/:findingId/resolve", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, findingId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const existing = await queryOne<any>(`SELECT finding_id FROM altax.v3_swot_findings WHERE finding_id = $1 AND client_id = $2`, [findingId, clientId]);
  if (!existing) return res.status(404).json({ error: "Finding not found." });
  await query(
    `UPDATE altax.v3_swot_findings SET status = 'Resolved', resolved_by = $1, resolved_at = now(), edited_by_staff = true, updated_at = now() WHERE finding_id = $2`,
    [req.user!.email, findingId]
  );
  await logAudit("Clients", "RESOLVE_SWOT_FINDING", clientId, "status", "Open", "Resolved", `Finding ${findingId} resolved by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

clientsRouter.post("/:clientId/swot-findings/:findingId/dismiss", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, findingId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const existing = await queryOne<any>(`SELECT finding_id FROM altax.v3_swot_findings WHERE finding_id = $1 AND client_id = $2`, [findingId, clientId]);
  if (!existing) return res.status(404).json({ error: "Finding not found." });
  const reason = String(req.body?.reason || "").slice(0, 2000) || null;
  await query(
    `UPDATE altax.v3_swot_findings SET status = 'Dismissed', dismissed_reason = $1, edited_by_staff = true, updated_at = now() WHERE finding_id = $2`,
    [reason, findingId]
  );
  await logAudit("Clients", "DISMISS_SWOT_FINDING", clientId, "status", "Open", "Dismissed", `Finding ${findingId} dismissed by ${req.user!.email}.${reason ? ` Reason: ${reason}` : ""}`, req.user!.email);
  res.json({ ok: true });
}));

/**
 * The core generate+reconcile pass for one client, shared by the manual
 * "Generate Findings Now" route and the nightly sweep (runSwotFindingsSweep
 * below) so a manual run and an automated run can never disagree about
 * behavior.
 *
 * Two halves:
 * 1. Reconciliation — every existing Open/In Progress Auto finding whose
 *    auto_trigger_key is no longer present in the freshly-computed
 *    candidate set gets auto-resolved (kept for history, never deleted).
 *    Skipped entirely for any finding a human has already edited
 *    (edited_by_staff=true) — automation can never silently override staff
 *    judgment. This is the piece that fulfills "remove outdated SWOT items
 *    automatically."
 * 2. Generate — inserts any candidate whose trigger key doesn't already
 *    have an open row, existence-check-before-insert (same shape the Task
 *    Rules Agent already uses), with the partial unique index
 *    (sql/040_swot_findings.sql) as a hard backstop against a duplicate
 *    slipping through a race.
 */
async function runFindingsGenerateAndReconcile(clientId: string, clientRow: any, actorLabel: string): Promise<{ created: number; resolved: number; evaluated: number; createdFindings: CreatedFindingInfo[] }> {
  const input = await assembleSwotEngineInput(clientId, clientRow);
  const candidates: CandidateFinding[] = computeSwotFindings(input);
  const candidateKeys = new Set(candidates.map((c) => c.autoTriggerKey));

  const openAutoRows = await query<any>(
    `SELECT finding_id, auto_trigger_key FROM altax.v3_swot_findings
      WHERE client_id = $1 AND source = 'Auto' AND edited_by_staff = false
            AND auto_trigger_key IS NOT NULL AND status NOT IN ('Resolved', 'Dismissed')`,
    [clientId]
  );
  let resolved = 0;
  for (const row of openAutoRows) {
    if (candidateKeys.has(row.auto_trigger_key)) continue;
    await query(
      `UPDATE altax.v3_swot_findings SET status = 'Resolved', resolved_by = $1, resolved_at = now(), updated_at = now() WHERE finding_id = $2`,
      [actorLabel, row.finding_id]
    );
    resolved++;
  }

  const openRows = await query<any>(
    `SELECT auto_trigger_key FROM altax.v3_swot_findings WHERE client_id = $1 AND auto_trigger_key IS NOT NULL AND status NOT IN ('Resolved', 'Dismissed')`,
    [clientId]
  );
  const openKeys = new Set(openRows.map((r: any) => r.auto_trigger_key));

  let created = 0;
  const createdFindings: CreatedFindingInfo[] = [];
  for (const c of candidates) {
    if (openKeys.has(c.autoTriggerKey)) continue;
    const findingId = nextFindingId();
    const insertedRows = await query<any>(
      `INSERT INTO altax.v3_swot_findings
         (finding_id, client_id, category, subcategory, finding_text, supporting_data, business_impact,
          priority, recommended_action, status, source, data_type, auto_trigger_key, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Open', 'Auto', $10, $11, $12)
       ON CONFLICT (client_id, auto_trigger_key) WHERE auto_trigger_key IS NOT NULL AND status NOT IN ('Resolved', 'Dismissed') DO NOTHING
       RETURNING finding_id`,
      [findingId, clientId, c.category, c.subcategory || null, c.findingText, c.supportingData, c.businessImpact,
        c.priority, c.recommendedAction, c.dataType, c.autoTriggerKey, actorLabel]
    );
    openKeys.add(c.autoTriggerKey);
    if (insertedRows.length > 0) {
      created++;
      createdFindings.push({ ...c, findingId, clientId, clientName: clientRow.client_name || clientId });
    }
  }

  return { created, resolved, evaluated: candidates.length, createdFindings };
}

clientsRouter.post("/:clientId/swot-findings/generate", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const clientRow = await queryOne<any>(
    `SELECT client_name, ein, address, state, sales_tax_frequency, industry_category, date_of_formation, entity_type, services, client_type
       FROM altax.v3_clients WHERE client_id = $1`,
    [clientId]
  );
  if (!clientRow) return res.status(404).json({ error: "Client not found." });

  const result = await runFindingsGenerateAndReconcile(clientId, clientRow, req.user!.email);
  await logAudit("Clients", "GENERATE_SWOT_FINDINGS", clientId, "", "", "", `${result.created} new finding(s) generated, ${result.resolved} auto-resolved, by ${req.user!.email}.`, req.user!.email);
  res.json(result);
}));

/**
 * Nightly automation: generate+reconcile for every active client in one
 * pass, then pushes an email/SMS alert (runDashboardAlertPush,
 * dashboardAlerts.ts) for any newly-created finding urgent enough to
 * page someone — folded in here rather than a separate cron so alerting
 * always reflects the exact same sweep that created the finding, never a
 * second, potentially-stale pass. Matches the Payroll/Task Rules Agent
 * cron shape (server.ts) — per-client errors are collected, not thrown,
 * so one bad client can't abort the whole sweep.
 */
export async function runSwotFindingsSweep(actorEmail: string): Promise<{ clientsProcessed: number; created: number; resolved: number; alertsPushed: number; errors: string[] }> {
  const clients = await query<any>(
    `SELECT client_id, client_name, ein, address, state, sales_tax_frequency, industry_category, date_of_formation, services, client_type
       FROM altax.v3_clients WHERE status IS NULL OR lower(status) NOT IN ('no', 'false', 'inactive', 'archived')`
  );
  let created = 0;
  let resolved = 0;
  let clientsProcessed = 0;
  const errors: string[] = [];
  const allCreatedFindings: CreatedFindingInfo[] = [];
  for (const c of clients) {
    try {
      const result = await runFindingsGenerateAndReconcile(c.client_id, c, actorEmail);
      created += result.created;
      resolved += result.resolved;
      allCreatedFindings.push(...result.createdFindings);
      clientsProcessed++;
    } catch (err) {
      // Hard Audit finding, 2026-08-29: neither helper below deliberately
      // throws a user-facing message, so anything caught here is a raw
      // error — logged server-side, replaced with a generic per-client note
      // rather than folded into this sweep's error summary verbatim.
      // eslint-disable-next-line no-console
      console.error(`[swot-sweep] ${c.client_id}:`, err);
      errors.push(`${c.client_id}: Could not process this client.`);
    }
  }
  if (created > 0 || resolved > 0) {
    await logAudit("Clients", "SWOT_FINDINGS_SWEEP", "Firm", "", "", "", `Nightly sweep: ${created} finding(s) created, ${resolved} auto-resolved across ${clientsProcessed} client(s).`, actorEmail);
  }
  let alertsPushed = 0;
  try {
    const alertResult = await runDashboardAlertPush(allCreatedFindings, actorEmail);
    alertsPushed = alertResult.pushed;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[swot-sweep] alert push:", err);
    errors.push("alert push: Could not send the alert.");
  }
  return { clientsProcessed, created, resolved, alertsPushed, errors };
}

/**
 * Client-facing MD Sales Tax deadline notice — the client-appropriate
 * counterpart to the staff-only filing_deadline_soon finding above.
 * Deliberately scoped to MD Sales Tax only (per owner decision, 2026-08-15):
 * EFTPS/MD Withholding/MD UI/Business Tax Return stay staff-only for now.
 *
 * For every MD client with a current-period filing due within the same
 * filing_deadline_days_threshold this whole system already uses (no
 * separate hardcoded window), not yet genuinely marked filed (reuses the
 * same markedFiledDate signal the bug-2 fix above threads through), with
 * tax due > 0:
 *   - Sends only through channels the CLIENT has actually opted into
 *     (v3_clients.email_allowed / sms_allowed — the client's own consent,
 *     not the staff-facing company_contact_* fields) and only to the
 *     client's own email/phone. No consent on file -> silently skipped,
 *     never logged as a failure.
 *   - Wording is written for a client, not staff — no "See the SWOT
 *     Analysis tab" internal-tool language.
 *   - Idempotent per client+period (source_system='ClientMdFilingNotice',
 *     keyed separately from the staff alert's own per-finding-id dedup key
 *     so the two can never collide) — never re-sent once a period has been
 *     notified, even though this sweep runs nightly.
 */
export async function runClientMdSalesTaxDeadlineNotifications(actorEmail: string): Promise<{ sent: number; skipped: number }> {
  const settings = await getDashboardAlertSettings();
  const firmName = (await getFirmProfile()).firmName;

  const clients = await query<any>(
    `SELECT client_id, client_name, ein, address, state, sales_tax_frequency, email, phone, email_allowed, sms_allowed
       FROM altax.v3_clients
      WHERE state = 'MD' AND sales_tax_frequency IS NOT NULL AND sales_tax_frequency <> ''
            AND (status IS NULL OR lower(status) NOT IN ('no', 'false', 'inactive', 'archived'))`
  );

  const { from: fromStr, to: toStr } = defaultFirmSummaryRange();

  let sent = 0;
  let skipped = 0;
  for (const c of clients) {
    try {
      const reportClient: ReportClientInfo = {
        clientId: c.client_id, clientName: c.client_name, ein: c.ein, address: c.address,
        state: c.state, salesTaxFrequency: c.sales_tax_frequency,
      };
      const mdFiling = await computeMdFilingForReport(reportClient, fromStr, toStr);
      if (!mdFiling || mdFiling.periods.length === 0) continue;
      const current = mdFiling.periods[mdFiling.periods.length - 1];
      if (current.markedFiledDate) continue; // already genuinely marked filed — nothing to notify about
      if (!(current.taxDue > 0)) continue;
      const daysUntilDue = Math.round((new Date(`${current.dueDate}T00:00:00Z`).getTime() - new Date(`${toStr}T00:00:00Z`).getTime()) / 86400000);
      if (daysUntilDue < 0 || daysUntilDue > settings.filingDeadlineDaysThreshold) continue;

      const dedupKey = `${c.client_id}:${current.end}`;
      const already = await queryOne<any>(
        `SELECT 1 FROM altax.v3_communications WHERE source_system = 'ClientMdFilingNotice' AND source_record_id = $1`,
        [dedupKey]
      );
      if (already) continue;

      const canEmail = Boolean(c.email_allowed && c.email);
      const canSms = Boolean(c.sms_allowed && c.phone);
      if (!canEmail && !canSms) { skipped++; continue; } // no consent on file — skip silently, not a failure

      // Wording fix (2026-08-22, direct owner correction): the firm always
      // handles the actual filing — the client's only job is sending their
      // sales/tax data in time for us to file it. The old "if we're already
      // handling this, no action needed" copy implied the client might file
      // it themselves, which is never true here.
      const subject = `Reminder: Maryland Sales Tax Filing Due ${current.dueDate}`;
      // Email body goes through sendChannel's HTML rendering, so the client name
      // (freely staff-editable) needs escaping; the SMS body is plain text and
      // must NOT be escaped, or the recipient would see literal "&amp;" etc.
      const body = `Dear ${escapeHtml(c.client_name)},\n\nYour Maryland sales tax filing for the period ending ${current.end} is due on ${current.dueDate}, in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}.\n\nTo file this on time, please send us your sales and tax report for this period as soon as possible. If you've already sent it to us, no action is needed. If you have questions, please contact us.`;
      const smsBody = `${c.client_name}: your Maryland sales tax filing (period ending ${current.end}) is due ${current.dueDate}, in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}. Please send us your sales & tax report so we can file on time. Already sent it? No action needed.`;

      let anySent = false;
      let providerMessageId: string | null = null;
      if (canEmail) {
        const emailResult = await sendChannel("email", c.email, subject, body, { firmName });
        if (emailResult.sent) { anySent = true; providerMessageId = emailResult.providerMessageId || null; }
      }
      if (canSms) {
        const smsResult = await sendChannel("sms", c.phone, subject, smsBody, { firmName });
        if (smsResult.sent) { anySent = true; providerMessageId = providerMessageId || smsResult.providerMessageId || null; }
      }

      await query(
        `INSERT INTO altax.v3_communications
           (communication_id, client_id, client_name, related_task_id, subject, message_english, message_arabic,
            sent_to, sent_by, direction, channel, sent_at, status, source_system, source_record_id, provider_message_id)
         VALUES ($1,$2,$3,NULL,$4,$5,'',$6,$7,'Outbound','Email',now(),$8,'ClientMdFilingNotice',$9,$10)`,
        [
          `COM-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`, c.client_id, c.client_name, subject, body,
          [canEmail ? c.email : null, canSms ? c.phone : null].filter(Boolean).join(", "),
          actorEmail, anySent ? "Sent" : "Failed", dedupKey, providerMessageId,
        ]
      );
      if (anySent) sent++; else skipped++;
    } catch (err) {
      skipped++;
    }
  }

  if (sent > 0 || skipped > 0) {
    await logAudit("Clients", "CLIENT_MD_FILING_NOTICE_SWEEP", "Firm", "", "", "", `Client MD sales tax deadline notice sweep: ${sent} sent, ${skipped} skipped, by ${actorEmail}.`, actorEmail);
  }
  return { sent, skipped };
}

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

  const limitParam = Number(req.query.limit);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 200) : null;
  const cap = limit ? limit : 500;

  const logged = await query<any>(
    `SELECT activity_id AS id, activity_type AS type, note, occurred_at, logged_by, 'log' AS source
       FROM altax.v3_client_activity_log WHERE client_id = $1
      ORDER BY occurred_at DESC LIMIT $2`,
    [clientId, cap]
  );
  // Task Note/Task Message are task-scoped (v3_communications.related_task_id) and have
  // their own thread on the task itself (TaskDetailPage's "Notes & Messages") — excluded
  // here so they don't leak into the client's Notes feed as an opaque, content-free line.
  const sent = await query<any>(
    `SELECT communication_id AS id, channel AS type, subject AS note, sent_at AS occurred_at, sent_by AS logged_by, 'communication' AS source
       FROM altax.v3_communications WHERE client_id = $1 AND sent_at IS NOT NULL AND channel NOT IN ('Task Note', 'Task Message')
      ORDER BY sent_at DESC LIMIT $2`,
    [clientId, cap]
  );
  let combined = [...logged, ...sent].sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
  if (limit) combined = combined.slice(0, limit);
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
  // Deliberately NOT self-marked read — a newly added note should show up as
  // unread (including to its own author) until it's actually reviewed via the
  // Activity Timeline tab, matching "when a note is added it should appear in
  // the panel, and reviewing it is what marks it read."
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
  await query(`DELETE FROM altax.v3_activity_reads WHERE entity_type = 'client_note' AND entity_id = $1`, [activityId]);
  await logAudit("Clients", "DELETE_ACTIVITY", activityId, "", row.activity_type || "", "", `Activity entry deleted by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

/** Marks every one of this client's logged notes as read, for this reader — fired when the panel's "Activity Timeline" tab loads. */
clientsRouter.post("/:clientId/activity/mark-read", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  await query(
    `INSERT INTO altax.v3_activity_reads (entity_type, entity_id, reader_email)
     SELECT 'client_note', activity_id, $2 FROM altax.v3_client_activity_log WHERE client_id = $1
     ON CONFLICT DO NOTHING`,
    [clientId, req.user!.email]
  );
  res.json({ ok: true });
}));

/**
 * Per-staff-member unread counts for the panel's "Client Note"/"Task Note"
 * Account rows. Scoped to req.user!.email — two staff members viewing the
 * same client see independent counts. Task Note count is scoped to this
 * client's OPEN tasks only — a note on a closed task isn't something that
 * needs a badge nagging staff about it.
 */
clientsRouter.get("/:clientId/unread-counts", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const email = req.user!.email;
  const [clientNote, taskNote] = await Promise.all([
    queryOne<any>(
      `SELECT COUNT(*)::int AS count FROM altax.v3_client_activity_log l
        WHERE l.client_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM altax.v3_activity_reads r
             WHERE r.entity_type = 'client_note' AND r.entity_id = l.activity_id AND r.reader_email = $2
          )`,
      [clientId, email]
    ),
    queryOne<any>(
      `SELECT COUNT(*)::int AS count FROM altax.v3_communications c
        JOIN altax.v3_tasks t ON t.task_id = c.related_task_id
       WHERE t.client_id = $1 AND c.channel = 'Task Note'
         AND lower(t.status) NOT IN ('completed','void','closed','archived')
         AND NOT EXISTS (
           SELECT 1 FROM altax.v3_activity_reads r
            WHERE r.entity_type = 'task_note' AND r.entity_id = c.communication_id AND r.reader_email = $2
         )`,
      [clientId, email]
    ),
  ]);
  res.json({ clientNoteUnread: clientNote?.count || 0, taskNoteUnread: taskNote?.count || 0 });
}));

/**
 * Cross-task inbox of every Task Note on this client's open tasks — the
 * destination for the panel's "Task Note" counter. Each row links into its own
 * task's Activity Timeline rather than duplicating the note-writing UI here.
 */
clientsRouter.get("/:clientId/task-notes", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const rows = await query<any>(
    `SELECT c.communication_id AS id, c.related_task_id AS task_id, t.task_name, t.status AS task_status,
            c.message_english AS note, c.sent_at, c.sent_by,
            EXISTS (
              SELECT 1 FROM altax.v3_activity_reads r
               WHERE r.entity_type = 'task_note' AND r.entity_id = c.communication_id AND r.reader_email = $2
            ) AS is_read
       FROM altax.v3_communications c
       JOIN altax.v3_tasks t ON t.task_id = c.related_task_id
      WHERE t.client_id = $1 AND c.channel = 'Task Note'
        AND lower(t.status) NOT IN ('completed','void','closed','archived')
      ORDER BY c.sent_at DESC`,
    [clientId, req.user!.email]
  );
  res.json({ taskNotes: rows });
}));

/**
 * A formation date is logically bounded — never in the future, never
 * meaningfully before ~1900. Server-side backstop for the frontend's own
 * min/max on that field: a native `<input type="date">` can commit an
 * out-of-range value if typed directly into the year segment before the
 * browser's own constraint validation catches it (or via a direct API call,
 * or an older cached frontend build) — confirmed live, a client's Date of
 * Formation saved as "0006-08-13" (year 6 AD) this way.
 */
function validateDateOfFormation(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "Date of Formation is not a valid date.";
  if (d.getUTCFullYear() < 1900) return "Date of Formation's year looks wrong (before 1900) — check the full year was entered.";
  if (d.getTime() > Date.now()) return "Date of Formation can't be in the future.";
  return null;
}

/** Next sequential C-#### id, matching the existing client_id pattern in real data. */
async function nextClientId(): Promise<string> {
  const row = await queryOne<any>(
    `SELECT MAX(substring(client_id from '^C-(\\d+)$')::int) AS max_num FROM altax.v3_clients WHERE client_id ~ '^C-\\d+$'`
  );
  const next = (row?.max_num || 1000) + 1;
  return `C-${next}`;
}

/** camelCase API field -> [db column, isBoolean]. Allow-list ported 1:1 from alTaxV3UpdateClientProfile. */
const UPDATABLE_FIELDS: Record<string, { column: string; boolean?: boolean; date?: boolean; numeric?: boolean; encrypted?: boolean }> = {
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
  // Explicitly staff-entered "since when has this obligation actually
  // existed" per obligation type — NOT the same as dateOfFormation (real
  // production data showed date_of_formation/created_at aren't reliable
  // enough to floor filing-period generation on; see
  // sql/102_obligation_registered_since.sql and computeMdSalesTaxLane's/
  // computeTaskRuleLanes' doc comments). NULL (the default) changes
  // nothing — every existing fallback keeps working exactly as before.
  // Only set this when someone actually knows the real registration date.
  salesTaxRegisteredSince: { column: "sales_tax_registered_since", date: true },
  payrollEnabled: { column: "payroll_enabled", boolean: true },
  payrollFrequency: { column: "payroll_frequency" },
  payrollSystem: { column: "payroll_system" },
  eftpsEnabled: { column: "eftps_enabled", boolean: true },
  eftpsRegisteredSince: { column: "eftps_registered_since", date: true },
  mdWithholdingFrequency: { column: "md_withholding_frequency" },
  mdWithholdingRegisteredSince: { column: "md_withholding_registered_since", date: true },
  mduiEnabled: { column: "mdui_enabled", boolean: true },
  mduiRegisteredSince: { column: "mdui_registered_since", date: true },
  mdAnnualReportEnabled: { column: "md_annual_report_enabled", boolean: true },
  businessReturnType: { column: "business_return_type" },
  smsAllowed: { column: "sms_allowed", boolean: true },
  emailAllowed: { column: "email_allowed", boolean: true },
  autoComplianceRemindersEnabled: { column: "auto_compliance_reminders_enabled", boolean: true },
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
  // Government reference numbers on a public health/fire permit, not
  // confidential tax/SSN-class data — feed into generated Health Permit
  // license/plan-review applications (haccp.routes.ts's
  // fillPermitNumbersFromClient) so staff enter them once, not on every
  // renewal. See sql/131_client_use_and_occupancy_fire_dept_permit.sql.
  useAndOccupancyNumber: { column: "use_and_occupancy_number" },
  fireDeptPermitNumber: { column: "fire_dept_permit_number" },
  // Maryland's Central Registration Number, issued after a filed CRA is
  // approved — distinct from secretaryOfStateId (assigned at formation) and
  // from stateTaxId. See sql/047_client_cra_registration_number.sql.
  craRegistrationNumber: { column: "cra_registration_number", encrypted: true },
  // Maryland UI account number + this client's own experience-rated UI tax
  // rate (varies per employer, unlike the firm-wide default SUTA rate) —
  // see sql/048_client_md_ui.sql. Saving mdUiTaxRate also syncs a
  // client-scoped SUTA override into v3_tax_rates (below) so payroll
  // actually uses this client's real rate instead of the firm default.
  mdUiEmployerId: { column: "md_ui_employer_id", encrypted: true },
  mdUiTaxRate: { column: "md_ui_tax_rate", numeric: true },
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
  // service_type (the legacy single-select) is deliberately NOT in this map —
  // it's no longer settable independently. It's auto-derived from `services`
  // below (see deriveServiceType, applied in the POST/PATCH handlers) after a
  // real production mismatch: 78 of 152 active clients were labeled "Full
  // Service" while missing most of what was actually checked, because nothing
  // ever kept the two in sync.
  //
  // Granular, multi-select firm service lines (tax_prep, bookkeeping, payroll,
  // sales_tax, formation, immigration, consulting) — drives contract suggestions
  // on the client profile (see contracts.routes.ts). A plain JS array is passed
  // straight through to the TEXT[] column; the pg driver serializes it automatically.
  services: { column: "services" },
  // Both auto-recomputed from `services` on every save (see below) unless
  // subscriptionFeeIsCustom is set — a staff-negotiated price then survives
  // future service/schedule changes until explicitly turned back off.
  subscriptionFeeIsCustom: { column: "subscription_fee_is_custom", boolean: true },
  subscriptionMonthlyFee: { column: "subscription_monthly_fee", numeric: true },
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
 * Keeps v3_tax_rates in sync with this client's own md_ui_tax_rate whenever a
 * create/update touches it, so payroll's SUTA lookup (lookupRate("SUTA", ...,
 * clientId, ...) — see accountingHelpers.ts) automatically uses this specific
 * employer's real MD UI rate instead of the firm-wide default the moment it's
 * entered on the client profile, rather than requiring a separate trip to the
 * Tax Rates admin screen to create the same client-scoped override by hand.
 * md_ui_tax_rate is stored as a PERCENT (e.g. 2.6 = 2.6%); v3_tax_rates.rate
 * is a decimal fraction, hence the /100 here. Clearing the rate deactivates
 * (not deletes) the override row, matching this app's soft-delete convention.
 */
async function syncMdUiTaxRateOverride(clientId: string, clientName: string): Promise<void> {
  const row = await queryOne<any>(`SELECT md_ui_tax_rate FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  const percent = row?.md_ui_tax_rate;
  const existing = await queryOne<any>(
    `SELECT tax_rate_row_id FROM altax.v3_tax_rates WHERE rate_id = 'SUTA' AND scope = 'Client' AND client_id = $1`,
    [clientId]
  );
  if (percent === null || percent === undefined) {
    if (existing) {
      await query(`UPDATE altax.v3_tax_rates SET active = false, updated_at = now() WHERE tax_rate_row_id = $1`, [existing.tax_rate_row_id]);
    }
    return;
  }
  const rate = Number(percent) / 100;
  if (existing) {
    await query(
      `UPDATE altax.v3_tax_rates SET rate = $2, client_name = $3, state = 'MD', active = true, updated_at = now() WHERE tax_rate_row_id = $1`,
      [existing.tax_rate_row_id, rate, clientName]
    );
  } else {
    await query(
      `INSERT INTO altax.v3_tax_rates (rate_id, scope, client_id, client_name, rate_type, rate, state, active)
       VALUES ('SUTA', 'Client', $1, $2, 'State Unemployment (SUTA) — MD UI rate', $3, 'MD', true)`,
      [clientId, clientName, rate]
    );
  }
}

/** Opens a new (still-current) sales-tax-frequency-history row — see sql/084_sales_tax_frequency_history.sql and splitIntoMdFilingPeriodsForClient. */
async function openSalesTaxFrequencyHistoryRow(clientId: string, frequency: string, effectiveFrom: string, createdBy: string): Promise<void> {
  await query(
    `INSERT INTO altax.v3_client_sales_tax_frequency_history (client_id, frequency, effective_from, effective_to, created_by)
     VALUES ($1, $2, $3, NULL, $4)`,
    [clientId, frequency, effectiveFrom, createdBy]
  );
}

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
  const dateOfFormationError = validateDateOfFormation(body.dateOfFormation);
  if (dateOfFormationError) return res.status(400).json({ error: dateOfFormationError });

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
  for (const [key, { column, boolean, date, numeric, encrypted }] of Object.entries(UPDATABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      columns.push(column);
      values.push(
        boolean ? Boolean(body[key])
          : date ? (body[key] || null)
          : numeric ? (body[key] === "" || body[key] === null || body[key] === undefined ? null : Number(body[key]))
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
  if (Array.isArray(body.services)) {
    columns.push("service_type");
    values.push(deriveServiceType(body.services));
    placeholders.push(`$${values.length}`);

    columns.push("subscription_tier");
    values.push(computeSubscriptionTier(body.services));
    placeholders.push(`$${values.length}`);

    // A brand-new client has no existing custom-fee override — only
    // auto-fill from the current Subscription Fee Schedule if the caller
    // didn't already supply an explicit subscriptionMonthlyFee (handled
    // above by the UPDATABLE_FIELDS loop).
    if (!columns.includes("subscription_monthly_fee")) {
      const catalog = await query<ServiceCatalogEntry>(`SELECT * FROM altax.v3_service_catalog`);
      columns.push("subscription_monthly_fee");
      // A brand-new client has no employees on file yet (they're added
      // separately, after creation) — per-employee/per-worker services
      // correctly price at $0 here, same as getClientWorkerCounts would
      // return for a client with zero rows in v3_employees.
      values.push(computeSubscriptionFee(body.services, catalog, { employees: 0, workers: 0 }));
      placeholders.push(`$${values.length}`);
    }
  }

  await query(
    `INSERT INTO altax.v3_clients (${columns.join(", ")}) VALUES (${placeholders.join(",")})`,
    values
  );

  await logAudit("Clients", "CLIENT_CREATED", clientId, "ClientName", "", body.clientName,
    "Client created via web app.", req.user!.email);

  if (Object.prototype.hasOwnProperty.call(body, "mdUiTaxRate")) {
    await syncMdUiTaxRateOverride(clientId, body.clientName);
  }

  // Anchored at a far-past sentinel date, not today — a client's sales tax
  // history (including any imported past data) needs SOME frequency row
  // covering it from the start, or splitIntoMdFilingPeriodsForClient would
  // find a coverage gap. See sql/084_sales_tax_frequency_history.sql, which
  // backfills the same sentinel for clients that already existed.
  if (String(body.salesTaxFrequency || "").trim()) {
    await openSalesTaxFrequencyHistoryRow(clientId, String(body.salesTaxFrequency).trim(), "2000-01-01", req.user!.email);
  }

  if (Array.isArray(body.services) && body.services.length > 0) {
    await autoGenerateContracts(clientId, body.services, req.user!.email);
  }

  res.status(201).json({ ok: true, clientId });
}));

/**
 * Real headcount for 'per_employee'/'per_worker' pricing (subscriptionPricing.ts,
 * sql/109) — direct owner request, 2026-08-26. `employees` is everyone with
 * worker_type != Contractor; `workers` is everyone regardless of type, for
 * W-2/1099 Prep — every worker needs one of the two forms.
 *
 * Both are scoped to status = Active only (2026-08-26 follow-up): a seasonal
 * or terminated worker turned Inactive shouldn't keep costing the client
 * money every month, and this is a live query (re-run on every save/
 * recalculate), not a snapshot — an Inactive worker who later comes back
 * Active is picked up automatically the next time the client's services are
 * saved or recalculated, no special handling needed. The worker record
 * itself is never touched here — this only changes what counts toward
 * price, nothing is deleted or archived.
 */
async function getClientWorkerCounts(clientId: string): Promise<ClientWorkerCounts> {
  const row = await queryOne<any>(
    `SELECT
       COUNT(*) FILTER (WHERE lower(COALESCE(worker_type, '')) NOT LIKE '%contractor%')::int AS employees,
       COUNT(*)::int AS workers
     FROM altax.v3_employees
     WHERE client_id = $1 AND lower(COALESCE(status, 'active')) = 'active'`,
    [clientId]
  );
  return { employees: row?.employees || 0, workers: row?.workers || 0 };
}

/** Powers the live "Estimated Subscription" preview on the client profile edit form before it's saved. */
clientsRouter.get("/:clientId/worker-counts", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  res.json(await getClientWorkerCounts(clientId));
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
  const dateOfFormationError = validateDateOfFormation(body.dateOfFormation);
  if (dateOfFormationError) return res.status(400).json({ error: dateOfFormationError });

  const old = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!old) return res.status(404).json({ error: "Client not found." });

  // Whether any encrypted (SSN/EIN/state-tax-ID) field actually changed — tracked
  // separately from `fields` since `fields[column]` holds ciphertext by the time the
  // UPDATE runs, so it can't be compared against decryptTolerant(old[column]) the way
  // the generic per-field diff loop below compares every other column.
  let sensitiveChanged = false;
  const fields: Record<string, any> = {};
  for (const [key, { column, boolean, date, numeric, encrypted }] of Object.entries(UPDATABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      if (encrypted) {
        const plaintext = String(body[key] || "").trim();
        if (plaintext !== decryptTolerant(old[column] || "")) sensitiveChanged = true;
        fields[column] = plaintext ? encryptValue(plaintext) : null;
      } else {
        fields[column] = boolean ? Boolean(body[key])
          : date ? (body[key] || null)
          : numeric ? (body[key] === "" || body[key] === null || body[key] === undefined ? null : Number(body[key]))
          : body[key];
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(fields, "services")) {
    fields.service_type = deriveServiceType(Array.isArray(fields.services) ? fields.services : []);
  }

  // Recompute tier/price whenever the service mix changes, or whenever the
  // custom-override flag itself changes (e.g. staff turning a negotiated
  // price back off should snap the fee back to the current Fee Schedule).
  // While a custom override is in effect, the tier label still updates
  // (it reflects what the client actually has), but the fee is left alone.
  const servicesChanged = Object.prototype.hasOwnProperty.call(fields, "services");
  const customFlagChanged = Object.prototype.hasOwnProperty.call(fields, "subscription_fee_is_custom");
  if (servicesChanged || customFlagChanged) {
    const effectiveServices: string[] = servicesChanged
      ? (Array.isArray(fields.services) ? fields.services : [])
      : (Array.isArray(old.services) ? old.services : []);
    fields.subscription_tier = computeSubscriptionTier(effectiveServices);
    const isCustom = customFlagChanged ? Boolean(fields.subscription_fee_is_custom) : Boolean(old.subscription_fee_is_custom);
    if (!isCustom && !Object.prototype.hasOwnProperty.call(fields, "subscription_monthly_fee")) {
      const [catalog, counts] = await Promise.all([
        query<ServiceCatalogEntry>(`SELECT * FROM altax.v3_service_catalog`),
        getClientWorkerCounts(clientId),
      ]);
      fields.subscription_monthly_fee = computeSubscriptionFee(effectiveServices, catalog, counts);
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

  if (Object.prototype.hasOwnProperty.call(body, "mdUiTaxRate")) {
    await syncMdUiTaxRateOverride(clientId, fields.client_name ?? old.client_name);
  }

  // MD Comptroller can reassign a client's filing frequency (e.g. Quarterly
  // -> Monthly) effective a given date — recorded as a new history row
  // rather than just overwriting sales_tax_frequency, so period math for
  // periods BEFORE the change keeps using the OLD frequency's boundaries
  // (matching what was actually filed/recorded) instead of every past
  // period silently recomputing under whatever frequency is set today. See
  // splitIntoMdFilingPeriodsForClient (mdFiling.ts).
  if (Object.prototype.hasOwnProperty.call(fields, "sales_tax_frequency")) {
    const newFreq = String(fields.sales_tax_frequency || "").trim();
    const oldFreq = String(old.sales_tax_frequency || "").trim();
    const effectiveDateRaw = String(body.salesTaxFrequencyEffectiveDate || "").trim();
    const effectiveDateProvided = /^\d{4}-\d{2}-\d{2}$/.test(effectiveDateRaw);
    const openRow = await queryOne<{ effective_from: string; frequency: string }>(
      `SELECT effective_from::date::text AS effective_from, frequency FROM altax.v3_client_sales_tax_frequency_history
        WHERE client_id = $1 AND effective_to IS NULL`,
      [clientId]
    );
    // When staff doesn't type an explicit effective date, "today" is only the
    // right default if this client already has real frequency coverage to
    // build forward from (openRow exists) — that's a genuine "changing as of
    // today" edit. If this is the client's very FIRST-EVER frequency history
    // row (openRow is null), defaulting to today silently orphans any real
    // sales/tax data recorded before today from every report and flag that
    // depends on frequency history (splitIntoMdFilingPeriodsForClient never
    // looks earlier than the earliest row) — a real production gap found
    // 2026-08-18 across 6 clients whose frequency had been set via this PATCH
    // path with no prior history row. The client CREATE path already anchors
    // brand-new clients at this same sentinel (see "2000-01-01" above, used
    // unconditionally for every new client); this closes the other way a
    // client ends up with a frequency assigned for the first time.
    const effectiveDate = effectiveDateProvided ? effectiveDateRaw : (openRow ? new Date().toISOString().slice(0, 10) : "2000-01-01");
    // Two distinct real edits share this one form field set: (a) the frequency
    // is genuinely changing, or (b) staff is correcting WHEN the already-open
    // segment started — e.g. it was saved with today's default date and the
    // real change happened earlier, or the frequency field was re-saved as its
    // own current value while only the date was actually edited. Both need to
    // run below; a pure resubmission of the exact same frequency+date is the
    // only real no-op.
    const dateIsCorrection = !!openRow && effectiveDateProvided && effectiveDate !== openRow.effective_from;
    if (newFreq !== oldFreq || dateIsCorrection) {
      if (openRow && effectiveDate < openRow.effective_from) {
        // Backdating into the segment that's already open — e.g. THRUWAY
        // CARRYOUT (C-1118) hit this in production: staff set Monthly
        // effective "today" by not noticing the date field's default, then
        // came back to correct it to the real date (07/01/2026) and got
        // rejected outright, with no way to fix it themselves. This is a
        // legitimate correction, not the risky case the floor below guards
        // against — it's only unsafe if it reaches back far enough to rewrite
        // the segment BEFORE the current one, so the floor is the previous
        // row's own start date, not the current row's.
        const prevRow = await queryOne<{ effective_from: string }>(
          `SELECT effective_from::date::text AS effective_from FROM altax.v3_client_sales_tax_frequency_history
            WHERE client_id = $1 AND effective_to IS NOT NULL
            ORDER BY effective_from DESC LIMIT 1`,
          [clientId]
        );
        if (prevRow && effectiveDate <= prevRow.effective_from) {
          return res.status(400).json({ error: `The frequency effective date must be after ${prevRow.effective_from}, when the prior frequency began.` });
        }
        const dayBeforeNew = new Date(`${effectiveDate}T00:00:00Z`);
        dayBeforeNew.setUTCDate(dayBeforeNew.getUTCDate() - 1);
        if (newFreq === openRow.frequency) {
          // Same frequency, just correcting its own start date — adjust the
          // open row in place rather than opening a duplicate identical row.
          await query(
            `UPDATE altax.v3_client_sales_tax_frequency_history SET effective_from = $2 WHERE client_id = $1 AND effective_to IS NULL`,
            [clientId, effectiveDate]
          );
        } else {
          // A genuinely different frequency slotted in before the current
          // segment — insert it as its own closed row; the current open row
          // is untouched since this new segment ends right where it begins.
          await query(
            `INSERT INTO altax.v3_client_sales_tax_frequency_history (client_id, frequency, effective_from, effective_to, created_by)
             VALUES ($1, $2, $3, $4, $5)`,
            [clientId, newFreq, effectiveDate, openRow.effective_from, req.user!.email]
          );
          // openRow.effective_from is inclusive on the current row, so the new
          // row's effective_to must be the day before it, not openRow.effective_from itself.
          const dayBeforeOpen = new Date(`${openRow.effective_from}T00:00:00Z`);
          dayBeforeOpen.setUTCDate(dayBeforeOpen.getUTCDate() - 1);
          await query(
            `UPDATE altax.v3_client_sales_tax_frequency_history SET effective_to = $2 WHERE client_id = $1 AND frequency = $3 AND effective_from = $4`,
            [clientId, dayBeforeOpen.toISOString().slice(0, 10), newFreq, effectiveDate]
          );
        }
        if (prevRow) {
          await query(
            `UPDATE altax.v3_client_sales_tax_frequency_history SET effective_to = $2
               WHERE client_id = $1 AND effective_from = $3`,
            [clientId, dayBeforeNew.toISOString().slice(0, 10), prevRow.effective_from]
          );
        }
      } else if (openRow && effectiveDate > openRow.effective_from && newFreq === openRow.frequency) {
        // Symmetric correction the other direction: same frequency, but its
        // real start was actually LATER than what's on file (e.g. entered a
        // few days early). Move the open row's start forward and extend
        // whatever preceded it to cover the gap — no new row either way.
        await query(
          `UPDATE altax.v3_client_sales_tax_frequency_history SET effective_from = $2 WHERE client_id = $1 AND effective_to IS NULL`,
          [clientId, effectiveDate]
        );
        const dayBeforeNewFwd = new Date(`${effectiveDate}T00:00:00Z`);
        dayBeforeNewFwd.setUTCDate(dayBeforeNewFwd.getUTCDate() - 1);
        await query(
          `UPDATE altax.v3_client_sales_tax_frequency_history SET effective_to = $2
             WHERE client_id = $1 AND effective_to = $3`,
          [clientId, dayBeforeNewFwd.toISOString().slice(0, 10), (() => {
            const d = new Date(`${openRow.effective_from}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() - 1);
            return d.toISOString().slice(0, 10);
          })()]
        );
      } else if (newFreq !== oldFreq) {
        // Existing forward-moving path: a new frequency taking effect from
        // here on — close whatever's currently open and start a fresh row.
        if (openRow && effectiveDate <= openRow.effective_from) {
          return res.status(400).json({ error: `The frequency effective date must be after ${openRow.effective_from}, when the current frequency (${openRow.frequency || "unset"}) began.` });
        }
        if (openRow) {
          const dayBefore = new Date(`${effectiveDate}T00:00:00Z`);
          dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
          await query(
            `UPDATE altax.v3_client_sales_tax_frequency_history SET effective_to = $2 WHERE client_id = $1 AND effective_to IS NULL`,
            [clientId, dayBefore.toISOString().slice(0, 10)]
          );
        }
        if (newFreq) {
          await openSalesTaxFrequencyHistoryRow(clientId, newFreq, effectiveDate, req.user!.email);
        }
      }
      await logAudit("Clients", "SALES_TAX_FREQUENCY_CHANGE", clientId, "sales_tax_frequency", oldFreq, newFreq,
        `Sales tax filing frequency set to "${newFreq || "N/A"}" effective ${effectiveDate}. Periods before that date keep using the prior frequency automatically.`,
        req.user!.email);
    }
  }

  res.json({ ok: true });
}));

/**
 * Refresh a client's subscription tier/fee snapshot against the CURRENT
 * Subscription Fee Schedule without touching their services — for after an
 * admin edits a fee schedule price and wants an already-saved client to
 * pick it up immediately, rather than waiting for the next unrelated
 * services edit. Respects subscription_fee_is_custom exactly like the PATCH
 * route above: a negotiated override's fee is left untouched, only the
 * tier label refreshes.
 */
clientsRouter.post("/:clientId/recalculate-subscription", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  // Hard Audit finding, 2026-08-27: every other :clientId-scoped route in
  // this file checks canAccessClient — this one was skipped, letting a
  // scoped staff user recompute and overwrite another client's
  // subscription_tier/subscription_monthly_fee.
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT services, subscription_fee_is_custom FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const services: string[] = Array.isArray(client.services) ? client.services : [];
  const tier = computeSubscriptionTier(services);
  const setClauses = ["subscription_tier = $2"];
  const values: any[] = [clientId, tier];
  let fee: number | null = null;
  if (!client.subscription_fee_is_custom) {
    const [catalog, counts] = await Promise.all([
      query<ServiceCatalogEntry>(`SELECT * FROM altax.v3_service_catalog`),
      getClientWorkerCounts(clientId),
    ]);
    fee = computeSubscriptionFee(services, catalog, counts);
    setClauses.push(`subscription_monthly_fee = $${values.length + 1}`);
    values.push(fee);
  }
  await query(`UPDATE altax.v3_clients SET ${setClauses.join(", ")}, updated_at = now() WHERE client_id = $1`, values);
  res.json({ ok: true, tier, fee });
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
