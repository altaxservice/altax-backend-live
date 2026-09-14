import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";

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
 */
export const dailyLogRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

function parseTimeSpent(hoursRaw: unknown, minutesRaw: unknown): number | null {
  const hours = Number(hoursRaw) || 0;
  const minutes = Number(minutesRaw) || 0;
  const total = Math.round(hours * 60 + minutes);
  return total > 0 ? total : null;
}

dailyLogRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.query.clientId || "").trim();
  const taskId = String(req.query.taskId || "").trim();
  const search = String(req.query.search || "").trim();
  const mineOnly = String(req.query.mine || "") === "1";
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();

  const params: any[] = [];
  let where = "1=1";
  if (clientId) { params.push(clientId); where += ` AND l.client_id = $${params.length}`; }
  if (taskId) { params.push(taskId); where += ` AND l.task_id = $${params.length}`; }
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
      loggedAt: r.logged_at, category: r.category, body: r.body, timeSpentMinutes: r.time_spent_minutes,
      createdAt: r.created_at, updatedAt: r.updated_at,
    })),
  });
}));

dailyLogRouter.post("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = String(req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "A description of what you worked on is required." });
  const clientId = String(req.body?.clientId || "").trim() || null;
  const taskId = String(req.body?.taskId || "").trim() || null;
  const category = String(req.body?.category || "").trim() || null;
  const timeSpentMinutes = parseTimeSpent(req.body?.timeSpentHours, req.body?.timeSpentMinutes);
  const loggedAtRaw = String(req.body?.loggedAt || "").trim();
  const loggedAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(loggedAtRaw) ? new Date(loggedAtRaw) : new Date();

  if (clientId) {
    const client = await queryOne<any>(`SELECT client_id FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
    if (!client) return res.status(400).json({ error: "Client not found." });
  }
  if (taskId) {
    const task = await queryOne<any>(`SELECT task_id FROM altax.v3_tasks WHERE task_id = $1`, [taskId]);
    if (!task) return res.status(400).json({ error: "Task not found." });
  }

  const logId = `DL-${idSuffix()}`;
  const authorRow = await queryOne<any>(`SELECT name FROM altax.v3_users WHERE lower(email) = lower($1)`, [req.user!.email]);
  await query(
    `INSERT INTO altax.v3_daily_logs (log_id, author_email, author_name, client_id, task_id, logged_at, category, body, time_spent_minutes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [logId, req.user!.email, authorRow?.name || req.user!.email, clientId, taskId, loggedAt, category, body, timeSpentMinutes]
  );
  await logAudit("DailyLog", "CREATE_DAILY_LOG", logId, "", "", "", `Daily log entry added by ${req.user!.email}.`, req.user!.email);
  res.status(201).json({ ok: true, logId });
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
  const clientId = String(req.body?.clientId || "").trim() || null;
  const taskId = String(req.body?.taskId || "").trim() || null;
  const category = String(req.body?.category || "").trim() || null;
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
    `UPDATE altax.v3_daily_logs SET client_id = $2, task_id = $3, logged_at = $4, category = $5, body = $6, time_spent_minutes = $7, updated_at = now()
      WHERE log_id = $1`,
    [logId, clientId, taskId, loggedAt, category, body, timeSpentMinutes]
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
