import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";

/**
 * Firm Notes — a shared follow-up notebook for admin/staff, separate from
 * Tasks and separate from the per-client activity log (v3_client_activity_log,
 * the "Client Note"/"Firm Note" buttons on a client's own page). Real owner
 * request, 2026-09-07: while working through client tasks, staff need
 * somewhere to jot a quick reminder ("this client is missing something,"
 * "come back and invoice them") that isn't a formal Task, then review/
 * resolve/delete it later from ONE central place — not by visiting each
 * client individually, which the activity log has no way to do (every route
 * against it is scoped to one client_id).
 *
 * Visibility is role-based, not author-based, per two rounds of owner
 * clarification: staff don't need notes hidden from each other (one shared
 * notebook), but the owner's own notes as admin genuinely are different from
 * staff notes and need to stay separate. `visibility='firm'` (the default)
 * is visible to everyone; `visibility='admin'` is visible only to admin
 * accounts, and only an admin can ever create one — enforced server-side in
 * every route below, never trusted from client input alone.
 */
export const staffNotesRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

staffNotesRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const status = String(req.query.status || "open").toLowerCase();
  const clientId = String(req.query.clientId || "").trim();
  const search = String(req.query.search || "").trim();
  const mineOnly = String(req.query.mine || "") === "1";

  const params: any[] = [req.user!.email];
  let where = "1=1";
  if (status === "open") where += ` AND n.status = 'Open'`;
  else if (status === "done") where += ` AND n.status = 'Done'`;
  if (clientId) { params.push(clientId); where += ` AND n.client_id = $${params.length}`; }
  if (search) { params.push(`%${search}%`); where += ` AND n.body ILIKE $${params.length}`; }
  if (mineOnly) { params.push(req.user!.email); where += ` AND n.author_email = $${params.length}`; }
  if (!isAdmin) where += ` AND n.visibility = 'firm'`;

  const rows = await query<any>(
    `SELECT n.*, c.client_name,
            EXISTS (SELECT 1 FROM altax.v3_activity_reads r WHERE r.entity_type = 'staff_note' AND r.entity_id = n.note_id AND r.reader_email = $1) AS is_read
       FROM altax.v3_staff_notes n
       LEFT JOIN altax.v3_clients c ON c.client_id = n.client_id
      WHERE ${where}
      ORDER BY (n.status = 'Open' AND n.remind_at IS NOT NULL AND n.remind_at <= CURRENT_DATE) DESC, n.remind_at ASC NULLS LAST, n.created_at DESC`,
    params
  );
  res.json({
    notes: rows.map((r) => ({
      noteId: r.note_id, authorEmail: r.author_email, authorName: r.author_name,
      clientId: r.client_id, clientName: r.client_name, body: r.body, visibility: r.visibility,
      category: r.category, status: r.status, remindAt: r.remind_at, resolvedAt: r.resolved_at, resolvedBy: r.resolved_by,
      createdAt: r.created_at, updatedAt: r.updated_at, unread: !r.is_read,
    })),
  });
}));

staffNotesRouter.get("/unread-count", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const row = await queryOne<any>(
    `SELECT COUNT(*)::int AS count FROM altax.v3_staff_notes n
      WHERE n.status = 'Open' ${isAdmin ? "" : "AND n.visibility = 'firm'"}
        AND NOT EXISTS (SELECT 1 FROM altax.v3_activity_reads r WHERE r.entity_type = 'staff_note' AND r.entity_id = n.note_id AND r.reader_email = $1)`,
    [req.user!.email]
  );
  res.json({ count: row?.count || 0 });
}));

staffNotesRouter.post("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const body = String(req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "Note text is required." });
  const clientId = String(req.body?.clientId || "").trim() || null;
  const category = String(req.body?.category || "").trim() || null;
  const remindAtRaw = String(req.body?.remindAt || "").trim();
  const remindAt = /^\d{4}-\d{2}-\d{2}$/.test(remindAtRaw) ? remindAtRaw : null;
  // Never trust visibility: 'admin' from the request body alone — a staff
  // account could otherwise write itself into the admin-only tier.
  const visibility = isAdmin && req.body?.visibility === "admin" ? "admin" : "firm";

  if (clientId) {
    const client = await queryOne<any>(`SELECT client_id FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
    if (!client) return res.status(400).json({ error: "Client not found." });
  }

  const noteId = `SN-${idSuffix()}`;
  const authorRow = await queryOne<any>(`SELECT name FROM altax.v3_users WHERE lower(email) = lower($1)`, [req.user!.email]);
  await query(
    `INSERT INTO altax.v3_staff_notes (note_id, author_email, author_name, client_id, body, visibility, category, remind_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [noteId, req.user!.email, authorRow?.name || req.user!.email, clientId, body, visibility, category, remindAt]
  );
  await logAudit("Notes", "CREATE_STAFF_NOTE", noteId, "", "", "", `Note added by ${req.user!.email}.`, req.user!.email);
  res.status(201).json({ ok: true, noteId });
}));

staffNotesRouter.post("/:noteId/status", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const { noteId } = req.params;
  const note = await queryOne<any>(`SELECT * FROM altax.v3_staff_notes WHERE note_id = $1`, [noteId]);
  if (!note) return res.status(404).json({ error: "Note not found." });
  if (note.visibility === "admin" && !isAdmin) return res.status(403).json({ error: "You do not have access to this note." });

  const status = req.body?.status === "Done" ? "Done" : "Open";
  await query(
    `UPDATE altax.v3_staff_notes SET status = $2, resolved_at = $3, resolved_by = $4, updated_at = now() WHERE note_id = $1`,
    [noteId, status, status === "Done" ? new Date() : null, status === "Done" ? req.user!.email : null]
  );
  res.json({ ok: true });
}));

staffNotesRouter.post("/:noteId/read", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const { noteId } = req.params;
  const note = await queryOne<any>(`SELECT visibility FROM altax.v3_staff_notes WHERE note_id = $1`, [noteId]);
  if (!note) return res.status(404).json({ error: "Note not found." });
  if (note.visibility === "admin" && !isAdmin) return res.status(403).json({ error: "You do not have access to this note." });

  await query(
    `INSERT INTO altax.v3_activity_reads (entity_type, entity_id, reader_email) VALUES ('staff_note', $1, $2) ON CONFLICT DO NOTHING`,
    [noteId, req.user!.email]
  );
  res.json({ ok: true });
}));

/** Author or admin only — a shared notebook still shouldn't let anyone erase anyone else's entry. */
staffNotesRouter.post("/:noteId/delete", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const { noteId } = req.params;
  const note = await queryOne<any>(`SELECT * FROM altax.v3_staff_notes WHERE note_id = $1`, [noteId]);
  if (!note) return res.status(404).json({ error: "Note not found." });
  if (note.visibility === "admin" && !isAdmin) return res.status(403).json({ error: "You do not have access to this note." });
  if (note.author_email.toLowerCase() !== req.user!.email.toLowerCase() && !isAdmin) {
    return res.status(403).json({ error: "Only the author or an admin can delete this note." });
  }

  await query(`DELETE FROM altax.v3_activity_reads WHERE entity_type = 'staff_note' AND entity_id = $1`, [noteId]);
  await query(`DELETE FROM altax.v3_staff_notes WHERE note_id = $1`, [noteId]);
  await logAudit("Notes", "DELETE_STAFF_NOTE", noteId, "", "", "", `Note deleted by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));
