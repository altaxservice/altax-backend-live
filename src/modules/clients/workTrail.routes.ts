/**
 * Automatic "where you left off" for a client: a merged, newest-first trail of what has actually been done on the
 * client (sales and payroll entered, filings marked filed/paid, deposits, tasks, messages, documents, invoices, profile
 * edits), read straight from the tables those actions already write to — no extra step for staff. Each staff member's
 * own visits are remembered too, so the page can mark everything that happened since they last worked on the client.
 * Mounted at /clients before clientsRouter (literal "recent-work" must not be read as a :clientId).
 */
import { Router, Response } from "express";
import { query } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient, getUserAliases } from "../../common/assignment";

export const workTrailRouter = Router();

export interface TrailEvent {
  at: string;
  by: string | null;
  kind: string;
  label: string;
  detail?: string;
  /** Where this work lives: a tab on the client's own page, or a tab on the Accounting page. */
  page?: "client" | "accounting";
  tab?: string;
  count?: number;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : "");
const ymd = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : "");
const usd = (n: unknown) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthYear = (v: unknown) => (v ? new Date(v as string).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "");
const period = (s: unknown, e: unknown) => {
  const a = monthYear(s), b = monthYear(e);
  return a === b ? a : `${a} – ${b}`;
};
const shortDate = (v: unknown) => (v ? new Date(v as string).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");

/** Two events of the same kind within this many minutes read as one burst of work (an import of nine months is one entry, not nine). */
const BURST_MINUTES = 15;

function mergeBursts(events: TrailEvent[]): TrailEvent[] {
  const out: TrailEvent[] = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    const gap = prev ? Math.abs(new Date(prev.at).getTime() - new Date(e.at).getTime()) / 60000 : Infinity;
    if (prev && prev.kind === e.kind && ["sales", "payroll", "document", "message"].includes(e.kind) && gap <= BURST_MINUTES && prev.by === e.by) {
      prev.count = (prev.count || 1) + 1;
    } else {
      out.push({ ...e });
    }
  }
  return out.map((e) => {
    if (!e.count || e.count < 2) return e;
    const noun: Record<string, string> = { sales: "Sales entered", payroll: "Payroll recorded", document: "Documents added", message: "Messages" };
    return { ...e, label: `${noun[e.kind] || e.label} × ${e.count}`, detail: undefined };
  });
}

export async function loadWorkTrail(clientId: string, limit = 25): Promise<TrailEvent[]> {
  const since = "now() - interval '180 days'";
  // One broken source must not hide the rest of the trail, but it must not fail silently either.
  const q = (sql: string) => query<any>(sql, [clientId]).catch((err) => { console.error("[workTrail] source query failed:", err?.message); return [] as any[]; });
  const [sales, payroll, mdTax, withholding, ui, annual, f941, eftps, tasks, comms, docs, invoices, client, govForms, contracts, returns] = await Promise.all([
    q(`SELECT sale_date, gross_sales, created_at FROM altax.v3_sales_input WHERE client_id = $1 AND created_at > ${since} ORDER BY created_at DESC LIMIT 40`),
    q(`SELECT pay_date, employee, created_at FROM altax.v3_payroll_input WHERE client_id = $1 AND created_at > ${since} ORDER BY created_at DESC LIMIT 60`),
    q(`SELECT period_start, period_end, filed_date, paid_date, filed_by, filed_at, acknowledged_at FROM altax.v3_md_filing_payments WHERE client_id = $1 AND filed_at > ${since} ORDER BY filed_at DESC LIMIT 10`),
    q(`SELECT state, period_start, period_end, filed_date, paid_date, filed_by, filed_at FROM altax.v3_withholding_filings WHERE client_id = $1 AND filed_at > ${since} ORDER BY filed_at DESC LIMIT 10`),
    q(`SELECT period_start, period_end, filed_date, paid_date, filed_by, filed_at FROM altax.v3_md_ui_filings WHERE client_id = $1 AND filed_at > ${since} ORDER BY filed_at DESC LIMIT 6`),
    q(`SELECT period_start, period_end, filed_date, paid_date, filed_by, filed_at FROM altax.v3_annual_report_filings WHERE client_id = $1 AND filed_at > ${since} ORDER BY filed_at DESC LIMIT 4`),
    q(`SELECT period_start, period_end, quarter, filed_date, paid_date, filed_by, filed_at FROM altax.v3_form941_filings WHERE client_id = $1 AND filed_at > ${since} ORDER BY filed_at DESC LIMIT 6`),
    q(`SELECT period_start, period_end, status, filing_date, payment_date, total_amount, created_by, updated_at FROM altax.v3_eftps_deposits WHERE client_id = $1 AND updated_at > ${since} ORDER BY updated_at DESC LIMIT 10`),
    q(`SELECT task_name, status, updated_at, updated_by FROM altax.v3_tasks WHERE client_id = $1 AND updated_at > ${since} ORDER BY updated_at DESC LIMIT 12`),
    q(`SELECT channel, subject, status, sent_by, sent_at FROM altax.v3_communications WHERE client_id = $1 AND direction = 'Outbound' AND sent_at > ${since} AND sent_by NOT ILIKE 'System%' ORDER BY sent_at DESC LIMIT 12`),
    q(`SELECT file_name, direction, uploaded_by, uploaded_at FROM altax.v3_document_uploads WHERE client_id = $1 AND uploaded_at > ${since} AND lower(coalesce(status,'')) NOT IN ('removed','replaced') ORDER BY uploaded_at DESC LIMIT 12`),
    q(`SELECT invoice_id, status, total_amount, updated_at FROM altax.v3_invoices WHERE client_id = $1 AND updated_at > ${since} ORDER BY updated_at DESC LIMIT 8`),
    q(`SELECT updated_at, updated_by, created_at FROM altax.v3_clients WHERE client_id = $1`),
    q(`SELECT form_type, status, signer_name, updated_at FROM altax.v3_gov_form_filings WHERE client_id = $1 AND updated_at > ${since} ORDER BY updated_at DESC LIMIT 8`),
    q(`SELECT title, status, updated_at FROM altax.v3_client_contracts WHERE client_id = $1 AND updated_at > ${since} ORDER BY updated_at DESC LIMIT 8`),
    q(`SELECT tax_year, return_type, status, updated_at FROM altax.v3_tax_returns WHERE client_id = $1 AND updated_at > ${since} ORDER BY updated_at DESC LIMIT 8`),
  ]);

  const paidText = (paid: unknown, filed: unknown) => `filed ${shortDate(filed)} · ${paid ? `paid ${shortDate(paid)}` : "payment not recorded yet"}`;
  const events: TrailEvent[] = [];
  for (const r of sales) events.push({ at: iso(r.created_at), by: null, kind: "sales", label: `Sales entered · ${shortDate(r.sale_date)}`, detail: usd(r.gross_sales), page: "accounting", tab: "Sales" });
  for (const r of payroll) events.push({ at: iso(r.created_at), by: null, kind: "payroll", label: `Payroll recorded · ${shortDate(r.pay_date)}`, detail: r.employee || undefined, page: "accounting", tab: "Payroll" });
  for (const r of mdTax) {
    events.push({ at: iso(r.filed_at), by: r.filed_by, kind: "filing", label: `MD sales tax ${period(r.period_start, r.period_end)}`, detail: paidText(r.paid_date, r.filed_date), page: "accounting", tab: "Sales" });
    if (r.acknowledged_at) events.push({ at: iso(r.acknowledged_at), by: "Client", kind: "filing", label: `Client confirmed MD sales tax ${period(r.period_start, r.period_end)}`, page: "accounting", tab: "Sales" });
  }
  for (const r of withholding) events.push({ at: iso(r.filed_at), by: r.filed_by, kind: "filing", label: `${r.state || ""} withholding ${period(r.period_start, r.period_end)}`.trim(), detail: paidText(r.paid_date, r.filed_date), page: "accounting", tab: "Withholding" });
  for (const r of ui) events.push({ at: iso(r.filed_at), by: r.filed_by, kind: "filing", label: `Unemployment (UI) ${period(r.period_start, r.period_end)}`, detail: paidText(r.paid_date, r.filed_date), page: "accounting", tab: "MD UI" });
  for (const r of annual) events.push({ at: iso(r.filed_at), by: r.filed_by, kind: "filing", label: `Annual report ${period(r.period_start, r.period_end)}`, detail: paidText(r.paid_date, r.filed_date), page: "accounting", tab: "Annual Report" });
  for (const r of f941) events.push({ at: iso(r.filed_at), by: r.filed_by, kind: "filing", label: `Form 941 ${r.quarter ? `Q${r.quarter} ` : ""}${period(r.period_start, r.period_end)}`, detail: paidText(r.paid_date, r.filed_date), page: "accounting", tab: "Form 941" });
  for (const r of eftps) events.push({ at: iso(r.updated_at), by: r.created_by, kind: "filing", label: `EFTPS deposit ${period(r.period_start, r.period_end)}`, detail: `${r.status || "In progress"} · ${usd(r.total_amount)}${r.payment_date ? ` · paid ${shortDate(r.payment_date)}` : ""}`, page: "accounting", tab: "EFTPS Deposits" });
  for (const r of tasks) events.push({ at: iso(r.updated_at), by: r.updated_by, kind: "task", label: `Task “${r.task_name}”`, detail: r.status || undefined, page: "client", tab: "Tasks" });
  for (const r of comms) events.push({ at: iso(r.sent_at), by: r.sent_by, kind: "message", label: `${r.channel}: ${r.subject}`, detail: String(r.status || "").startsWith("Saved +") ? "sent" : "logged", page: "client", tab: "Communications" });
  for (const r of docs) events.push({ at: iso(r.uploaded_at), by: r.uploaded_by, kind: "document", label: `Document: ${r.file_name}`, detail: r.direction || undefined, page: "client", tab: "Documents" });
  for (const r of invoices) events.push({ at: iso(r.updated_at), by: null, kind: "invoice", label: `Invoice ${r.invoice_id} · ${r.status}`, detail: usd(r.total_amount), page: "client", tab: "Billing" });
  for (const r of govForms) events.push({ at: iso(r.updated_at), by: null, kind: "form", label: `Government form ${r.form_type}`, detail: r.status || undefined, page: "client", tab: "Gov Forms" });
  for (const r of contracts) events.push({ at: iso(r.updated_at), by: null, kind: "contract", label: `Contract “${r.title}”`, detail: r.status || undefined, page: "client", tab: "Contracts" });
  for (const r of returns) events.push({ at: iso(r.updated_at), by: null, kind: "return", label: `${r.tax_year} ${r.return_type || "tax return"}`, detail: r.status || undefined, page: "client", tab: "Tax Return Production" });
  if (client[0]?.updated_at && new Date(client[0].updated_at).getTime() > Date.now() - 180 * 86400000) {
    events.push({ at: iso(client[0].updated_at), by: client[0].updated_by || null, kind: "profile", label: client[0].created_at && new Date(client[0].updated_at).getTime() - new Date(client[0].created_at).getTime() < 120000 ? "New client created" : "Client profile edited", page: "client", tab: "Profile" });
  }

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return mergeBursts(events.filter((e) => e.at)).slice(0, limit);
}

/** Records this staff member's visit and returns the previous working session's start ("since you were last here"). */
async function touchVisit(email: string, clientId: string): Promise<string | null> {
  const rows = await query<any>(
    `INSERT INTO altax.v3_client_visits (user_email, client_id, last_visit_at, prev_visit_at)
     VALUES ($1, $2, now(), NULL)
     ON CONFLICT (user_email, client_id) DO UPDATE SET
       prev_visit_at = CASE WHEN altax.v3_client_visits.last_visit_at < now() - interval '30 minutes' THEN altax.v3_client_visits.last_visit_at ELSE altax.v3_client_visits.prev_visit_at END,
       last_visit_at = now()
     RETURNING prev_visit_at`,
    [email.toLowerCase(), clientId]
  );
  return rows[0]?.prev_visit_at ? new Date(rows[0].prev_visit_at).toISOString() : null;
}

const CLIENT_EVENTS_SQL = `
       SELECT client_id, created_at AS at, NULL::text AS by, 'Sales entered' AS label, 'for ' || to_char(sale_date, 'Mon FMDD, YYYY') AS detail, 'accounting' AS page, 'Sales' AS tab FROM altax.v3_sales_input
       UNION ALL SELECT client_id, created_at, NULL, 'Payroll recorded', 'pay date ' || to_char(pay_date, 'Mon FMDD, YYYY'), 'accounting', 'Payroll' FROM altax.v3_payroll_input
       UNION ALL SELECT client_id, filed_at, filed_by, 'MD sales tax filed', CASE WHEN paid_date IS NULL THEN 'payment not recorded yet' ELSE 'paid ' || to_char(paid_date, 'Mon FMDD') END, 'accounting', 'Sales' FROM altax.v3_md_filing_payments
       UNION ALL SELECT client_id, filed_at, filed_by, state || ' withholding filed', CASE WHEN paid_date IS NULL THEN 'payment not recorded yet' ELSE 'paid ' || to_char(paid_date, 'Mon FMDD') END, 'accounting', 'Withholding' FROM altax.v3_withholding_filings
       UNION ALL SELECT client_id, filed_at, filed_by, 'Unemployment (UI) filed', CASE WHEN paid_date IS NULL THEN 'payment not recorded yet' ELSE 'paid ' || to_char(paid_date, 'Mon FMDD') END, 'accounting', 'MD UI' FROM altax.v3_md_ui_filings
       UNION ALL SELECT client_id, filed_at, filed_by, 'Annual report filed', CASE WHEN paid_date IS NULL THEN 'payment not recorded yet' ELSE 'paid ' || to_char(paid_date, 'Mon FMDD') END, 'accounting', 'Annual Report' FROM altax.v3_annual_report_filings
       UNION ALL SELECT client_id, filed_at, filed_by, 'Form 941 filed', CASE WHEN paid_date IS NULL THEN 'payment not recorded yet' ELSE 'paid ' || to_char(paid_date, 'Mon FMDD') END, 'accounting', 'Form 941' FROM altax.v3_form941_filings
       UNION ALL SELECT client_id, updated_at, created_by, 'EFTPS deposit', coalesce(status, ''), 'accounting', 'EFTPS Deposits' FROM altax.v3_eftps_deposits
       UNION ALL SELECT client_id, updated_at, updated_by, 'Task: ' || task_name, status, 'client', 'Tasks' FROM altax.v3_tasks
       UNION ALL SELECT client_id, sent_at, sent_by, 'Message: ' || subject, CASE WHEN status LIKE 'Saved +%' THEN 'sent' ELSE 'logged' END, 'client', 'Communications' FROM altax.v3_communications WHERE direction = 'Outbound' AND sent_by NOT ILIKE 'System%'
       UNION ALL SELECT client_id, uploaded_at, uploaded_by, 'Document: ' || file_name, direction, 'client', 'Documents' FROM altax.v3_document_uploads WHERE lower(coalesce(status,'')) NOT IN ('removed','replaced') AND client_id IS NOT NULL
       UNION ALL SELECT client_id, updated_at, NULL, 'Invoice ' || invoice_id, status, 'client', 'Billing' FROM altax.v3_invoices
       UNION ALL SELECT client_id, updated_at, NULL, 'Government form ' || form_type, status, 'client', 'Gov Forms' FROM altax.v3_gov_form_filings WHERE client_id IS NOT NULL
       UNION ALL SELECT client_id, updated_at, NULL, 'Contract: ' || title, status, 'client', 'Contracts' FROM altax.v3_client_contracts
       UNION ALL SELECT client_id, updated_at, NULL, tax_year::text || ' ' || coalesce(return_type, 'tax return'), status, 'client', 'Tax Return Production' FROM altax.v3_tax_returns
       UNION ALL SELECT client_id, updated_at, updated_by, CASE WHEN created_at IS NOT NULL AND updated_at - created_at < interval '2 minutes' THEN 'New client created' ELSE 'Profile edited' END, '', 'client', 'Profile' FROM altax.v3_clients
`;

/**
 * The latest thing done on EVERY client the caller can see, in one query — for the Clients list's "Last activity"
 * column, so nobody has to open each client to find where work stopped. One UNION over the same sources loadWorkTrail
 * reads, newest row per client. Registered before the /:clientId routes.
 */
workTrailRouter.get("/last-activity", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params: any[] = [];
  let scope = "";
  if (req.user!.role !== "admin") {
    params.push(Array.from(await getUserAliases(req.user!.email)));
    scope = `AND client_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($1::text[]))`;
  }
  const rows = await query<any>(
    `SELECT DISTINCT ON (client_id) client_id, at, by, label, detail, page, tab FROM (
${CLIENT_EVENTS_SQL}     ) a
     WHERE at IS NOT NULL AND client_id IS NOT NULL ${scope}
     ORDER BY client_id, at DESC`,
    params
  );
  const out: Record<string, { at: string; by: string | null; label: string; detail: string; page: string; tab: string }> = {};
  for (const r of rows) out[r.client_id] = { at: new Date(r.at).toISOString(), by: r.by, label: r.label, detail: r.detail || "", page: r.page, tab: r.tab };
  res.json({ activity: out, me: req.user!.email.toLowerCase() });
}));

/**
 * "Last activity" banner for the top of a main page: the latest thing done on that page's records by anyone, and the
 * latest by the caller — so on returning to Tasks, Invoices, Documents, etc. the first thing visible is where work stopped.
 * Staff only see activity on clients they work with (same assigned-task rule as the Clients list).
 */
const PAGE_ACTIVITY_SQL: Record<string, string> = {
  clients: `
    SELECT e.client_id, c.client_name, e.at, e.by, e.label || CASE WHEN e.detail <> '' THEN ' — ' || e.detail ELSE '' END AS label,
           CASE WHEN e.page = 'accounting' THEN '/accounting?client=' || e.client_id || '&tab=' || e.tab ELSE '/clients/' || e.client_id END AS link
      FROM (${"${CLIENT_EVENTS_SQL}"}) e JOIN altax.v3_clients c ON c.client_id = e.client_id`,
  tasks: `
    SELECT client_id, client_name, updated_at AS at, updated_by AS by, 'Task “' || task_name || '” → ' || coalesce(status, '—') AS label, '/tasks/' || task_id AS link FROM altax.v3_tasks
    UNION ALL SELECT t.client_id, t.client_name, n.created_at, n.author_email, 'Note on task “' || t.task_name || '”', '/tasks/' || t.task_id FROM altax.v3_staff_notes n JOIN altax.v3_tasks t ON t.task_id = n.task_id
    UNION ALL SELECT t.client_id, t.client_name, u.uploaded_at, u.uploaded_by, 'File on task “' || t.task_name || '”: ' || u.file_name, '/tasks/' || t.task_id FROM altax.v3_document_uploads u JOIN altax.v3_tasks t ON t.task_id = u.task_id WHERE lower(coalesce(u.status, '')) NOT IN ('removed','replaced')`,
  invoices: `
    SELECT i.client_id, c.client_name, p.payment_date::timestamptz AS at, NULL::text AS by, 'Payment of $' || trim(to_char(p.actual_amount, 'FM999,999,990.00')) || ' on ' || i.invoice_id AS label, '/billing/' || i.invoice_id AS link
      FROM altax.v3_payments p JOIN altax.v3_invoices i ON i.invoice_id = p.invoice_id JOIN altax.v3_clients c ON c.client_id = i.client_id WHERE lower(coalesce(p.status, '')) NOT LIKE 'revers%'
    UNION ALL SELECT i.client_id, c.client_name, e.occurred_at, e.actor, CASE e.event_type WHEN 'sent' THEN 'Invoice ' || i.invoice_id || ' sent by ' || coalesce(e.channel, 'email') WHEN 'viewed' THEN 'Invoice ' || i.invoice_id || ' opened by the client' ELSE 'Sending failed for ' || i.invoice_id END, '/billing/' || i.invoice_id
      FROM altax.v3_invoice_events e JOIN altax.v3_invoices i ON i.invoice_id = e.invoice_id JOIN altax.v3_clients c ON c.client_id = i.client_id
    UNION ALL SELECT i.client_id, c.client_name, i.updated_at, NULL, 'Invoice ' || i.invoice_id || ' ' || lower(coalesce(i.status, 'updated')), '/billing/' || i.invoice_id
      FROM altax.v3_invoices i JOIN altax.v3_clients c ON c.client_id = i.client_id`,
  documents: `
    SELECT u.client_id, u.client_name, u.uploaded_at AS at, u.uploaded_by AS by, 'File uploaded: ' || u.file_name AS label, CASE WHEN u.request_id IS NOT NULL THEN '/documents/' || u.request_id ELSE '/documents' END AS link
      FROM altax.v3_document_uploads u WHERE u.client_id IS NOT NULL AND lower(coalesce(u.status, '')) NOT IN ('removed','replaced')
    UNION ALL SELECT r.client_id, r.client_name, r.updated_at, NULL, 'Request “' || r.requested_item || '” → ' || coalesce(r.status, 'Requested'), '/documents/' || r.request_id FROM altax.v3_document_requests r WHERE r.client_id IS NOT NULL`,
  estimates: `
    SELECT e.client_id, e.business_name AS client_name, e.updated_at AS at, NULL::text AS by, 'Estimate ' || e.estimate_number || ' · ' || coalesce(e.status, '') AS label, '/estimates/' || e.estimate_id AS link FROM altax.v3_estimates e`,
  communications: `
    SELECT client_id, client_name, sent_at AS at, sent_by AS by, channel || ': ' || subject || CASE WHEN status LIKE 'Saved +%' THEN ' (sent)' ELSE ' (logged)' END AS label, '/clients/' || client_id || '?tab=Communications' AS link
      FROM altax.v3_communications WHERE direction = 'Outbound' AND sent_by NOT ILIKE 'System%'`,
  notes: `
    SELECT client_id, NULL::text AS client_name, updated_at AS at, author_email AS by, 'Note: ' || left(body, 60) AS label, '/notes' AS link FROM altax.v3_staff_notes`,
};

/**
 * Pages whose activity also comes from the audit log — which records nearly everything staff do (creating a client,
 * editing, deleting, sending, filing …). `where` selects that page's audit entries. System jobs and client self-service
 * entries are left out: this strip is about work people did.
 */
const AUDIT_PAGES: Record<string, string> = {
  clients: `(module IN ('Clients','Contracts','Haccp','Secure Vault') OR (module = 'Tools' AND (action ILIKE '%GOV_FORM%' OR action ILIKE '%POA%')) OR (module = 'Accounting' AND action NOT ILIKE 'CREATE_COA' AND action NOT ILIKE '%_COA'))`,
  tasks: `(module = 'Tasks' OR (module = 'Communications' AND action IN ('TASK_NOTE','TASK_MESSAGE')))`,
  invoices: `module = 'Billing'`,
  documents: `module = 'Documents'`,
  estimates: `(module = 'Tools' AND action ILIKE '%ESTIMATE%')`,
  communications: `(module = 'Communications' AND action NOT IN ('DAILY_OPERATIONS_ALERT','STAFF_DAILY_ALERT','AUTO_REMINDERS','REMINDER_AUTOMATION_RUN','STAFF_TASK_NOTICE','STAFF_BATCH_TASK_NOTICE','PORTAL_NOTE_NOTICE'))`,
  notes: `module = 'Notes'`,
  rules: `module = 'Rules'`,
  labels: `module = 'Labels'`,
  calendar: `module = 'Calendar'`,
  permits: `module = 'Haccp'`,
  timetracking: `module = 'Time Tracking'`,
  users: `(module IN ('Staff','Portal Users') OR (module = 'Security' AND action IN ('CLIENT_INVITE','RESEND_INVITE','RESET_INVITE','TEMP_PASSWORD')))`,
};

const ACTION_WORDS: Record<string, string> = {
  CLIENT_CREATED: "New client created", CREATE: "Created", EDIT: "Edited", ARCHIVE: "Archived", HARD_DELETE: "Deleted", DELETE: "Deleted",
  STATUS: "Status changed", BULK_COMPLETE: "Completed in bulk", BATCH_CREATE: "Batch of tasks created", UPLOAD: "File uploaded",
  CREATE_APPOINTMENT: "Appointment created", UPDATE_APPOINTMENT: "Appointment changed", DELETE_APPOINTMENT: "Appointment deleted",
  GENERATE: "Generated", REGENERATE: "Regenerated", SEND: "Sent", SIGN: "Signed", VOID: "Voided",
};
const NOUN_BY_MODULE: Record<string, string> = { Communications: "message", Calendar: "appointment", Billing: "invoice", Haccp: "health permit plan", Clients: "client", Tasks: "task", Documents: "document", Notes: "note", Rules: "rule", Labels: "label", Staff: "staff member", "Time Tracking": "time entry" };

function humanize(action: string): string {
  const t = action.toLowerCase().replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function auditLabel(r: { module: string; action: string; field: string | null; note: string | null }): string {
  const base = ACTION_WORDS[r.action];
  const noun = NOUN_BY_MODULE[r.module];
  if (r.module === "Clients" && (r.action === "CREATE" || r.action === "CLIENT_CREATED")) return "New client created";
  if (base && noun && ["CREATE", "EDIT", "ARCHIVE", "DELETE", "HARD_DELETE", "STATUS"].includes(r.action)) {
    const verb = r.action === "CREATE" ? "created" : r.action === "EDIT" ? "edited" : r.action === "ARCHIVE" ? "archived" : r.action === "STATUS" ? "status changed" : "deleted";
    return `${noun.charAt(0).toUpperCase() + noun.slice(1)} ${verb}${r.action === "EDIT" && r.field ? ` (${r.field})` : ""}`;
  }
  return base ? `${base}${r.field && r.action === "EDIT" ? ` (${r.field})` : ""}` : humanize(r.action);
}

function auditLink(recordId: string, action: string): string | null {
  if (/DELETE|ARCHIVE/.test(action) || !recordId) return null;
  if (/^C-\w+/.test(recordId)) return `/clients/${recordId}`;
  if (/^T-/.test(recordId)) return `/tasks/${recordId}`;
  if (/^INV-/.test(recordId)) return `/billing/${recordId}`;
  if (/^EST-/.test(recordId)) return `/estimates/${recordId}`;
  return null;
}

workTrailRouter.get("/page-activity", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const page = String(req.query.page || "");
  const body = PAGE_ACTIVITY_SQL[page];
  const auditWhere = AUDIT_PAGES[page];
  if (!body && !auditWhere) return res.status(400).json({ error: "Unknown page." });
  const sql = body ? body.replace("${CLIENT_EVENTS_SQL}", CLIENT_EVENTS_SQL) : "";
  const email = req.user!.email.toLowerCase();
  const isAdmin = req.user!.role === "admin";
  const aliases = isAdmin || page === "notes" ? [] : Array.from(await getUserAliases(req.user!.email));

  type Item = { at: string; by: string | null; label: string; clientId: string | null; clientName: string | null; link: string | null };
  const fromData = async (mineOnly: boolean): Promise<Item | null> => {
    if (!sql) return null;
    // Only the parameters the SQL actually references are sent (Postgres rejects extras).
    const params: any[] = [];
    const conds: string[] = ["at IS NOT NULL"];
    if (!isAdmin) {
      if (page === "notes") { params.push(email); conds.push(`lower(by) = $${params.length}`); }
      else { params.push(aliases); conds.push(`client_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($${params.length}::text[]))`); }
    }
    if (mineOnly && !(page === "notes" && !isAdmin)) { params.push(email); conds.push(`lower(by) = $${params.length}`); }
    const rows = await query<any>(`SELECT at, by, label, client_id, client_name, link FROM (${sql}) a WHERE ${conds.join(" AND ")} ORDER BY at DESC LIMIT 1`, params);
    const r = rows[0];
    return r ? { at: new Date(r.at).toISOString(), by: r.by, label: r.label, clientId: r.client_id, clientName: r.client_name, link: r.link } : null;
  };
  const fromAudit = async (mineOnly: boolean): Promise<Item | null> => {
    if (!auditWhere) return null;
    const params: any[] = [];
    const conds = [auditWhere, `user_email NOT ILIKE 'system%'`, `user_email NOT IN ('Public Manage Link','Client','system')`];
    // Staff see only their own audited actions (the audit log has no client link to scope by).
    if (!isAdmin || mineOnly) { params.push(email); conds.push(`lower(user_email) = $${params.length}`); }
    const rows = await query<any>(`SELECT module, action, record_id, field, note, user_email, created_at FROM altax.v3_audit_log WHERE ${conds.join(" AND ")} ORDER BY created_at DESC LIMIT 1`, params);
    const r = rows[0];
    if (!r) return null;
    let clientName: string | null = null;
    if (/^C-\w+/.test(r.record_id || "")) {
      const c = await query<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [r.record_id]);
      clientName = c[0]?.client_name || null;
    }
    return { at: new Date(r.created_at).toISOString(), by: r.user_email, label: auditLabel(r), clientId: /^C-\w+/.test(r.record_id || "") ? r.record_id : null, clientName, link: auditLink(r.record_id || "", r.action) };
  };
  const newest = (a: Item | null, b: Item | null) => (a && b ? (new Date(a.at) >= new Date(b.at) ? a : b) : a || b);
  const [dLatest, aLatest, dMine, aMine] = await Promise.all([fromData(false), fromAudit(false), fromData(true), fromAudit(true)]);
  res.json({ latest: newest(dLatest, aLatest), mine: newest(dMine, aMine), me: email });
}));

/** Latest activity per TASK (status change, task note, uploaded file, message) for the ids shown on the Tasks list. */
workTrailRouter.get("/task-activity", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const ids = String(req.query.ids || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 300);
  if (ids.length === 0) return res.json({ activity: {}, me: req.user!.email.toLowerCase() });
  const rows = await query<any>(
    `SELECT DISTINCT ON (task_id) task_id, at, by, label FROM (
       SELECT task_id, updated_at AS at, updated_by AS by, 'Status: ' || coalesce(status, '—') AS label FROM altax.v3_tasks WHERE task_id = ANY($1::text[])
       UNION ALL SELECT task_id, created_at, author_name, 'Note added' FROM altax.v3_staff_notes WHERE task_id = ANY($1::text[])
       UNION ALL SELECT task_id, uploaded_at, uploaded_by, 'File: ' || file_name FROM altax.v3_document_uploads WHERE task_id = ANY($1::text[]) AND lower(coalesce(status,'')) NOT IN ('removed','replaced')
       UNION ALL SELECT related_task_id, sent_at, sent_by, 'Message: ' || subject FROM altax.v3_communications WHERE related_task_id = ANY($1::text[]) AND direction = 'Outbound'
     ) a WHERE at IS NOT NULL ORDER BY task_id, at DESC`,
    [ids]
  );
  const out: Record<string, { at: string; by: string | null; label: string }> = {};
  for (const r of rows) out[r.task_id] = { at: new Date(r.at).toISOString(), by: r.by, label: r.label };
  res.json({ activity: out, me: req.user!.email.toLowerCase() });
}));

/** The clients this person worked on most recently, each with what was last done there — the Command Center's "pick up where you left off". Registered before /:clientId/... routes. */
workTrailRouter.get("/recent-work", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rows = await query<any>(
    `SELECT v.client_id, v.last_visit_at, c.client_name, c.status
       FROM altax.v3_client_visits v JOIN altax.v3_clients c ON c.client_id = v.client_id
      WHERE v.user_email = $1 ORDER BY v.last_visit_at DESC LIMIT 8`,
    [req.user!.email.toLowerCase()]
  );
  const items = [];
  for (const r of rows) {
    if (!(await canAccessClient(req.user!, r.client_id))) continue;
    const trail = await loadWorkTrail(r.client_id, 3);
    items.push({ clientId: r.client_id, clientName: r.client_name, status: r.status, lastVisitAt: new Date(r.last_visit_at).toISOString(), latest: trail[0] || null });
  }
  res.json({ items });
}));

workTrailRouter.get("/:clientId/work-trail", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const sinceVisit = String(req.query.visit || "") === "1" ? await touchVisit(req.user!.email, clientId) : null;
  const events = await loadWorkTrail(clientId, 25);
  res.json({ events, sinceVisit, me: req.user!.email.toLowerCase() });
}));
