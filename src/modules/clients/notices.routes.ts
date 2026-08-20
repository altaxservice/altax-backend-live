/**
 * IRS/state notice tracking (Firm Command Center gap analysis, item #24).
 * Client | Agency | Notice Type | Tax Period | Amount | Received Date |
 * Response Deadline | Assigned Staff | Status | Response Filed | Follow-Up
 * Date | Resolution — fields the spec calls out directly. Mounted at
 * /clients (sql/096_notices.sql), same pattern as ownershipTransfer.routes.ts:
 * a focused router for one client sub-feature rather than growing
 * clients.routes.ts further. The firm-wide GET /notices route is registered
 * FIRST, before GET /:clientId/notices — a literal path segment mounted
 * under the same prefix as a :clientId wildcard route is silently swallowed
 * by route registration order otherwise (the exact bug GET /clients/flags
 * hit and fixed, see clients.routes.ts's own comment on it).
 */
import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { logAudit } from "../../common/audit";

export const noticesRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
}

const STATUSES = ["Open", "Response Filed", "Resolved"];

/** Firm-wide, admin/staff (role-scoped like every other cross-client list in this app) — soonest response_deadline first, unresolved only unless ?includeResolved=1. */
noticesRouter.get("/notices", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const includeResolved = String(req.query.includeResolved || "") === "1";
  const isAdmin = req.user!.role === "admin";
  const conditions: string[] = [];
  const params: any[] = [];
  if (!includeResolved) conditions.push(`n.status <> 'Resolved'`);
  if (!isAdmin) {
    params.push(req.user!.email);
    conditions.push(`lower(n.assigned_to) = lower($${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await query<any>(
    `SELECT n.*, c.client_name FROM altax.v3_notices n
       JOIN altax.v3_clients c ON c.client_id = n.client_id
       ${where}
      ORDER BY (n.response_deadline IS NULL), n.response_deadline ASC, n.received_date DESC`,
    params
  );
  res.json({ notices: rows });
}));

noticesRouter.get("/:clientId/notices", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const rows = await query<any>(
    `SELECT * FROM altax.v3_notices WHERE client_id = $1 ORDER BY (response_deadline IS NULL), response_deadline ASC, received_date DESC`,
    [clientId]
  );
  res.json({ notices: rows });
}));

noticesRouter.post("/:clientId/notices", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const body = req.body || {};
  const agency = String(body.agency || "").trim();
  const noticeType = String(body.noticeType || "").trim();
  const receivedDate = String(body.receivedDate || "").trim();
  if (!agency) return res.status(400).json({ error: "Agency is required." });
  if (!noticeType) return res.status(400).json({ error: "Notice type is required." });
  if (!receivedDate) return res.status(400).json({ error: "Received date is required." });

  const noticeId = `NOTICE-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_notices
       (notice_id, client_id, agency, notice_type, tax_period, amount, received_date, response_deadline,
        assigned_to, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Open',$10,$11)`,
    [
      noticeId, clientId, agency, noticeType,
      String(body.taxPeriod || "").trim() || null,
      body.amount !== undefined && body.amount !== "" ? Number(body.amount) : null,
      receivedDate,
      String(body.responseDeadline || "").trim() || null,
      String(body.assignedTo || "").trim() || null,
      String(body.notes || "").trim() || null,
      req.user!.email,
    ]
  );
  await logAudit("Notices", "CREATE", noticeId, "", "", `${agency} — ${noticeType}`, `Notice logged for ${clientId} by ${req.user!.email}.`, req.user!.email);
  res.status(201).json({ ok: true, noticeId });
}));

noticesRouter.patch("/:clientId/notices/:noticeId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, noticeId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_notices WHERE notice_id = $1 AND client_id = $2`, [noticeId, clientId]);
  if (!existing) return res.status(404).json({ error: "Notice not found." });

  const body = req.body || {};
  const status = body.status !== undefined ? String(body.status).trim() : existing.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(", ")}.` });

  const next = {
    agency: body.agency !== undefined ? String(body.agency).trim() : existing.agency,
    noticeType: body.noticeType !== undefined ? String(body.noticeType).trim() : existing.notice_type,
    taxPeriod: body.taxPeriod !== undefined ? (String(body.taxPeriod).trim() || null) : existing.tax_period,
    amount: body.amount !== undefined ? (body.amount === "" ? null : Number(body.amount)) : existing.amount,
    receivedDate: body.receivedDate !== undefined ? String(body.receivedDate).trim() : existing.received_date,
    responseDeadline: body.responseDeadline !== undefined ? (String(body.responseDeadline).trim() || null) : existing.response_deadline,
    assignedTo: body.assignedTo !== undefined ? (String(body.assignedTo).trim() || null) : existing.assigned_to,
    responseFiledDate: body.responseFiledDate !== undefined ? (String(body.responseFiledDate).trim() || null) : existing.response_filed_date,
    followUpDate: body.followUpDate !== undefined ? (String(body.followUpDate).trim() || null) : existing.follow_up_date,
    resolution: body.resolution !== undefined ? (String(body.resolution).trim() || null) : existing.resolution,
    notes: body.notes !== undefined ? (String(body.notes).trim() || null) : existing.notes,
  };

  await query(
    `UPDATE altax.v3_notices SET
       agency=$3, notice_type=$4, tax_period=$5, amount=$6, received_date=$7, response_deadline=$8,
       assigned_to=$9, status=$10, response_filed_date=$11, follow_up_date=$12, resolution=$13, notes=$14, updated_at=now()
     WHERE notice_id = $1 AND client_id = $2`,
    [noticeId, clientId, next.agency, next.noticeType, next.taxPeriod, next.amount, next.receivedDate, next.responseDeadline,
     next.assignedTo, status, next.responseFiledDate, next.followUpDate, next.resolution, next.notes]
  );
  await logAudit("Notices", "EDIT", noticeId, "Status", existing.status || "", status, `Notice updated for ${clientId} by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true, noticeId });
}));

noticesRouter.post("/:clientId/notices/:noticeId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, noticeId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_notices WHERE notice_id = $1 AND client_id = $2`, [noticeId, clientId]);
  if (!existing) return res.status(404).json({ error: "Notice not found." });
  await query(`DELETE FROM altax.v3_notices WHERE notice_id = $1`, [noticeId]);
  await logAudit("Notices", "DELETE", noticeId, "", "", "", `Notice deleted for ${clientId} by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));
