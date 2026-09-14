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
