import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { FIRM_SERVICES } from "../contracts/contractContent";

const FIRM_SERVICE_KEYS = new Set(FIRM_SERVICES.map((s) => s.key));

/**
 * Daily Log — a personal/firm work journal, distinct from both Time Tracking
 * (hours-as-a-number + billable rate + invoice rollup, no narrative field
 * worth reading back later) and Staff Notes (a forward-looking reminder/
 * follow-up tool, not a backward-looking "here's what I did" record). Real
 * owner request, 2026-09-13: date+time, which client, which task (if any),
 * and a free-form narrative of what was involved and what was done about
 * it. Visible firm-wide (every entry attributed to its author) rather than
 * private, so the owner can also see what staff logged -- but logging is
 * deliberately NOT required/reminded, only offered: a mandatory daily habit
 * with no proven value yet tends to produce hollow, box-checking entries.
 *
 * 2026-09-14: one entry can cover several clients at once ("I did sales tax
 * for 6 clients") and multiple of the firm's real services (FIRM_SERVICES,
 * the same catalog behind v3_clients.services/contracts/subscription
 * pricing). client_id stays a single FK per row -- picking N clients fans
 * out into N rows at creation time sharing the same body/services/time,
 * not one row with an array of client ids -- so every existing per-client
 * query (filters, reports) keeps working unchanged. services IS a genuine
 * array per row: "for this client today I did Sales Tax AND Payroll" is
 * one row, not two.
 */
export const dailyLogRouter = Router();

function idSuffix(suffix = ""): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${Math.floor(100 + Math.random() * 900)}${suffix}`;
}

function parseTimeSpent(hoursRaw: unknown, minutesRaw: unknown): number | null {
  const hours = Number(hoursRaw) || 0;
  const minutes = Number(minutesRaw) || 0;
  const total = Math.round(hours * 60 + minutes);
  return total > 0 ? total : null;
}

/** Silently drops anything that isn't a real FIRM_SERVICES key rather than rejecting the whole request — a stale/renamed key from an old client shouldn't block someone from logging their work. */
function normalizeServices(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const v of raw) {
    const key = String(v || "").trim();
    if (key && FIRM_SERVICE_KEYS.has(key)) seen.add(key);
  }
  return Array.from(seen);
}

dailyLogRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const clientId = String(req.query.clientId || "").trim();
  const taskId = String(req.query.taskId || "").trim();
  const service = String(req.query.service || "").trim();
  const search = String(req.query.search || "").trim();
  const mineOnly = String(req.query.mine || "") === "1";
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();

  const params: any[] = [];
  let where = "1=1";
  if (clientId) { params.push(clientId); where += ` AND l.client_id = $${params.length}`; }
  if (taskId) { params.push(taskId); where += ` AND l.task_id = $${params.length}`; }
  if (service) { params.push(service); where += ` AND l.services @> ARRAY[$${params.length}]::text[]`; }
  if (mineOnly) { params.push(req.user!.email); where += ` AND l.author_email = $${params.length}`; }
  // Daily Log entries are private to their author by default (real owner
  // request, 2026-09-14: staff shouldn't see each other's or admin's
  // entries) — admin still sees every entry firm-wide.
  if (!isAdmin) { params.push(req.user!.email); where += ` AND l.author_email = $${params.length}`; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { params.push(from); where += ` AND l.logged_at::date >= $${params.length}`; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { params.push(to); where += ` AND l.logged_at::date <= $${params.length}`; }
  if (search) { params.push(`%${search}%`); where += ` AND l.body ILIKE $${params.length}`; }

  const rows = await query<any>(
    `SELECT l.*, c.client_name, t.task_name
       FROM altax.v3_daily_logs l
       LEFT JOIN altax.v3_clients c ON c.client_id = l.client_id
       LEFT JOIN altax.v3_tasks t ON t.task_id = l.task_id
      WHERE ${where}
      ORDER BY l.logged_at DESC`,
    params
  );
  res.json({
    logs: rows.map((r) => ({
      logId: r.log_id, authorEmail: r.author_email, authorName: r.author_name,
      clientId: r.client_id, clientName: r.client_name, taskId: r.task_id, taskName: r.task_name,
      loggedAt: r.logged_at, category: r.category, services: r.services || [], body: r.body, timeSpentMinutes: r.time_spent_minutes,
      createdAt: r.created_at, updatedAt: r.updated_at,
    })),
  });
}));

/** GET /services — the firm's real service catalog, for the multi-select picker. Sourced from FIRM_SERVICES (contractContent.ts), the same list that already drives client profiles/contracts/subscription pricing, not a new one invented for this page. */
/**
 * "What I did that day", assembled automatically from what the app already recorded under this person's name (the audit
 * log, messages sent, files uploaded), grouped per client with a plain-English line for each kind of work — so keeping the
 * log is a review-and-save, not writing from memory. Anything already saved from a previous auto-draft (category
 * "Auto-logged") for that client and day is left out, so saving twice never duplicates.
 */
const FRIENDLY: Record<string, string> = {
  MD_FILING_MARK_FILED: "Marked MD sales tax filed", MD_FILING_MARK_PAID: "Recorded MD sales tax payment", MD_FILING_RECORD_PAYMENT: "Recorded MD sales tax payment",
  MD_FILING_UNMARK_PAID: "Reopened an MD sales tax payment", MD_FILING_EDITED: "Edited an MD sales tax filing", MD_FILING_SENT: "Sent an MD filing confirmation",
  WITHHOLDING_FILING_MARK_FILED: "Marked withholding filed", WITHHOLDING_FILING_EDITED: "Edited a withholding filing", DC_FILING_MARK_FILED: "Marked DC filing filed",
  FORM_941_FILED: "Filed Form 941", MD_UI_FILED: "Filed MD unemployment (UI)", ANNUAL_REPORT_FILED: "Filed annual report",
  EFTPS_DEPOSIT_FILED: "Marked an EFTPS deposit filed", EFTPS_DEPOSIT_PAYMENT_RECORDED: "Recorded an EFTPS payment", IMPORT_EFTPS_PAYCHECKS: "Imported paychecks for EFTPS", IMPORT_EFTPS_TAX_LIABILITY: "Imported tax liability for EFTPS",
  CREATE_SALES_INPUT: "Entered sales", EDIT_SALES_INPUT: "Corrected sales entries", IMPORT_SALES_INPUT: "Imported sales from Excel", REPLACE_SALES_INPUT: "Replaced a sales entry", DELETE_SALES_INPUT: "Removed a sales entry",
  CREATE_PAYROLL: "Entered payroll", IMPORT_PAYROLL: "Imported payroll", EDIT_PAYCHECK: "Edited a paycheck", DELETE_PAYCHECK: "Removed a paycheck", CREATE_PAYCHECK: "Created a paycheck",
  CREATE_JE: "Posted a journal entry", GENERATE_941: "Generated Form 941", GENERATE_940: "Generated Form 940", GENERATE_W2: "Generated W-2s", GENERATE_1099NEC: "Generated 1099-NEC",
  CLIENT_CREATED: "Created the client", CREATE: "Created a record", EDIT: "Updated the profile", EDIT_SENSITIVE: "Updated sensitive details", FLAG_ADDED: "Added a flag", FLAG_RESOLVED: "Resolved a flag",
  OBLIGATION_MARKED_DONE: "Marked a filing done", SALES_TAX_FREQUENCY_CHANGE: "Changed the sales tax filing frequency", EXTERNAL_VERIFICATION_CHECKED: "Checked an external portal",
  CREATE_INVOICE: "Created an invoice", EDIT_INVOICE: "Edited an invoice", SEND_INVOICE: "Sent an invoice", RECORD_PAYMENT: "Recorded a payment", VOID_INVOICE: "Voided an invoice", STATEMENT: "Generated a statement",
  STATUS: "Updated a task status", ARCHIVE: "Archived a task", BULK_COMPLETE: "Completed tasks in bulk", UPLOAD: "Uploaded a document",
  GENERATE: "Generated a document", SIGN: "Collected a signature", SEND: "Sent a contract", CREATE_GOV_FORM: "Prepared a government form", UPDATE_GOV_FORM: "Updated a government form",
  CREATE_APPOINTMENT: "Scheduled an appointment", UPDATE_APPOINTMENT: "Changed an appointment",
};
const SKIP_MODULES = ["Security", "System", "Reports", "DailyLog", "Settings", "Labels", "Templates", "Rules"];
const CREATE_BY_MODULE: Record<string, string> = { Clients: "Created the client", Employees: "Added an employee", Documents: "Added a document request", Tasks: "Created a task", Communications: "Logged a message", Notes: "Wrote a note", Contracts: "Prepared a contract", Billing: "Created a billing record" };
function friendlyFor(module: string, action: string): string {
  if (action === "CREATE" && CREATE_BY_MODULE[module]) return CREATE_BY_MODULE[module];
  if (action === "EDIT" && module === "Tasks") return "Edited a task";
  if (action === "EDIT" && module === "Employees") return "Updated an employee";
  return FRIENDLY[action] || humanizeAction(action);
}
const humanizeAction = (a: string) => { const t = a.toLowerCase().replace(/_/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); };

dailyLogRouter.get("/auto-draft", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const dateRaw = String(req.query.date || "").trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const email = req.user!.email.toLowerCase();
  const range = `>= ($2::date)::timestamp AT TIME ZONE 'America/New_York' AND %COL% < (($2::date + 1)::timestamp AT TIME ZONE 'America/New_York')`;
  const within = (col: string) => `${col} ${range.replace("%COL%", col)}`;

  const [audit, comms, docs, already] = await Promise.all([
    query<any>(
      `SELECT * FROM (
         SELECT a.created_at AS at, a.module, a.action, a.field,
                COALESCE(CASE WHEN a.record_id ~ '^C-' THEN a.record_id END,
                         (SELECT client_id FROM altax.v3_sales_input WHERE sale_id = a.record_id),
                         (SELECT client_id FROM altax.v3_payroll_input WHERE payroll_input_id = a.record_id),
                         (SELECT client_id FROM altax.v3_tasks WHERE task_id = a.record_id),
                         (SELECT client_id FROM altax.v3_invoices WHERE invoice_id = a.record_id)) AS client_id
           FROM altax.v3_audit_log a
          WHERE lower(a.user_email) = $1 AND ${within("a.created_at")} AND a.module <> ALL($3::text[])
       ) x WHERE client_id IS NOT NULL ORDER BY at`,
      [email, date, SKIP_MODULES]
    ),
    query<any>(`SELECT client_id, channel, subject, sent_at AS at FROM altax.v3_communications WHERE lower(sent_by) = $1 AND direction = 'Outbound' AND ${within("sent_at")}`, [email, date]),
    query<any>(`SELECT client_id, file_name, uploaded_at AS at FROM altax.v3_document_uploads WHERE lower(uploaded_by) = $1 AND client_id IS NOT NULL AND ${within("uploaded_at")}`, [email, date]),
    query<any>(`SELECT client_id, MAX(created_at) AS saved_at FROM altax.v3_daily_logs WHERE lower(author_email) = $1 AND category = 'Auto-logged' AND ${within("logged_at")} AND client_id IS NOT NULL GROUP BY client_id`, [email, date]),
  ]);
  const savedAt = new Map<string, number>(already.map((r) => [r.client_id, new Date(r.saved_at).getTime()]));

  type Ev = { at: number; label: string };
  const byClient = new Map<string, Ev[]>();
  const push = (clientId: string, at: Date | string, label: string) => {
    const t = new Date(at).getTime();
    if (t <= (savedAt.get(clientId) || 0)) return;
    if (!byClient.has(clientId)) byClient.set(clientId, []);
    byClient.get(clientId)!.push({ at: t, label });
  };
  for (const r of audit) push(r.client_id, r.at, friendlyFor(r.module, r.action));
  for (const r of comms) if (r.client_id) push(r.client_id, r.at, `Sent ${/^[aeiou]/i.test(String(r.channel)) ? "an" : "a"} ${String(r.channel).toLowerCase()} message: ${r.subject}`);
  for (const r of docs) push(r.client_id, r.at, `Uploaded ${r.file_name}`);

  const ids = Array.from(byClient.keys());
  const names = new Map<string, string>();
  if (ids.length) for (const c of await query<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = ANY($1::text[])`, [ids])) names.set(c.client_id, c.client_name);

  const drafts = ids.map((clientId) => {
    const events = byClient.get(clientId)!.sort((a, b) => a.at - b.at);
    const counts = new Map<string, number>();
    for (const e of events) counts.set(e.label, (counts.get(e.label) || 0) + 1);
    const lines = Array.from(counts, ([label, n]) => (n > 1 ? `${label} × ${n}` : label));
    const spanMin = Math.round((events[events.length - 1].at - events[0].at) / 60000);
    // A rough "time on this client" from the first to the last action, capped, in 5-minute steps — editable before saving.
    const suggestedMinutes = Math.max(5, Math.min(180, Math.round(spanMin / 5) * 5));
    return {
      clientId, clientName: names.get(clientId) || clientId, count: events.length, lines,
      firstAt: new Date(events[0].at).toISOString(), lastAt: new Date(events[events.length - 1].at).toISOString(), suggestedMinutes,
    };
  }).sort((a, b) => new Date(a.firstAt).getTime() - new Date(b.firstAt).getTime());

  res.json({ date, drafts });
}));

dailyLogRouter.get("/services", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json({ services: FIRM_SERVICES.filter((s) => !s.legacy) });
}));

dailyLogRouter.post("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = String(req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "A description of what you worked on is required." });

  // clientIds is the current contract (fan-out); a bare clientId is still
  // accepted for backward compatibility with anything calling this before
  // the multi-client change.
  const clientIdsRaw: unknown = Array.isArray(req.body?.clientIds) ? req.body.clientIds
    : req.body?.clientId ? [req.body.clientId] : [];
  const clientIds = Array.from(new Set((clientIdsRaw as unknown[]).map((v) => String(v || "").trim()).filter(Boolean)));
  const taskId = clientIds.length === 1 ? (String(req.body?.taskId || "").trim() || null) : null;
  const category = String(req.body?.category || "").trim() || null;
  const services = normalizeServices(req.body?.services);
  const timeSpentMinutes = parseTimeSpent(req.body?.timeSpentHours, req.body?.timeSpentMinutes);
  const loggedAtRaw = String(req.body?.loggedAt || "").trim();
  const loggedAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(loggedAtRaw) ? new Date(loggedAtRaw) : new Date();

  if (clientIds.length > 0) {
    const found = await query<any>(`SELECT client_id FROM altax.v3_clients WHERE client_id = ANY($1::text[])`, [clientIds]);
    const foundIds = new Set(found.map((r) => r.client_id));
    const missing = clientIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) return res.status(400).json({ error: `Client(s) not found: ${missing.join(", ")}` });
  }
  if (taskId) {
    const task = await queryOne<any>(`SELECT task_id FROM altax.v3_tasks WHERE task_id = $1`, [taskId]);
    if (!task) return res.status(400).json({ error: "Task not found." });
  }

  const authorRow = await queryOne<any>(`SELECT name FROM altax.v3_users WHERE lower(email) = lower($1)`, [req.user!.email]);
  const authorName = authorRow?.name || req.user!.email;
  // No client picked at all -> one general/internal entry, same as before.
  const targets = clientIds.length > 0 ? clientIds : [null];

  const logIds: string[] = [];
  for (let i = 0; i < targets.length; i++) {
    const logId = `DL-${idSuffix(targets.length > 1 ? `-${i}` : "")}`;
    await query(
      `INSERT INTO altax.v3_daily_logs (log_id, author_email, author_name, client_id, task_id, logged_at, category, services, body, time_spent_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [logId, req.user!.email, authorName, targets[i], taskId, loggedAt, category, services, body, timeSpentMinutes]
    );
    logIds.push(logId);
  }
  // One audit row per fan-out batch, not per generated row -- and never the
  // full id list joined together: record_id is varchar(64) and note is
  // varchar(255), and a big enough client selection blows past either.
  // Just the count plus the first id as a pointer back into the batch.
  await logAudit("DailyLog", "CREATE_DAILY_LOG", logIds[0], "", "", "",
    `Daily log entry added by ${req.user!.email}${targets.length > 1 ? ` (${targets.length} clients)` : ""}.`, req.user!.email);
  res.status(201).json({ ok: true, logIds, logId: logIds[0] });
}));

dailyLogRouter.post("/:logId/edit", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const { logId } = req.params;
  const entry = await queryOne<any>(`SELECT * FROM altax.v3_daily_logs WHERE log_id = $1`, [logId]);
  if (!entry) return res.status(404).json({ error: "Log entry not found." });
  if (entry.author_email.toLowerCase() !== req.user!.email.toLowerCase() && !isAdmin) {
    return res.status(403).json({ error: "Only the author or an admin can edit this entry." });
  }

  const body = String(req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "A description of what you worked on is required." });
  // Editing is single-entry, single-client — the multi-client picker only
  // fans out into several rows at creation time; splitting/merging rows on
  // edit would be a much bigger, murkier operation for little real benefit.
  const clientId = String(req.body?.clientId || "").trim() || null;
  const taskId = String(req.body?.taskId || "").trim() || null;
  const category = String(req.body?.category || "").trim() || null;
  const services = normalizeServices(req.body?.services);
  const timeSpentMinutes = parseTimeSpent(req.body?.timeSpentHours, req.body?.timeSpentMinutes);
  const loggedAtRaw = String(req.body?.loggedAt || "").trim();
  const loggedAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(loggedAtRaw) ? new Date(loggedAtRaw) : new Date(entry.logged_at);

  if (clientId) {
    const client = await queryOne<any>(`SELECT client_id FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
    if (!client) return res.status(400).json({ error: "Client not found." });
  }
  if (taskId) {
    const task = await queryOne<any>(`SELECT task_id FROM altax.v3_tasks WHERE task_id = $1`, [taskId]);
    if (!task) return res.status(400).json({ error: "Task not found." });
  }

  await query(
    `UPDATE altax.v3_daily_logs SET client_id = $2, task_id = $3, logged_at = $4, category = $5, services = $6, body = $7, time_spent_minutes = $8, updated_at = now()
      WHERE log_id = $1`,
    [logId, clientId, taskId, loggedAt, category, services, body, timeSpentMinutes]
  );
  await logAudit("DailyLog", "EDIT_DAILY_LOG", logId, "", "", "", `Daily log entry edited by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

dailyLogRouter.post("/:logId/delete", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const { logId } = req.params;
  const entry = await queryOne<any>(`SELECT * FROM altax.v3_daily_logs WHERE log_id = $1`, [logId]);
  if (!entry) return res.status(404).json({ error: "Log entry not found." });
  if (entry.author_email.toLowerCase() !== req.user!.email.toLowerCase() && !isAdmin) {
    return res.status(403).json({ error: "Only the author or an admin can delete this entry." });
  }

  await query(`DELETE FROM altax.v3_daily_logs WHERE log_id = $1`, [logId]);
  await logAudit("DailyLog", "DELETE_DAILY_LOG", logId, "", "", "", `Daily log entry deleted by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));
