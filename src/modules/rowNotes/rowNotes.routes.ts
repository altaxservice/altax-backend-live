import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient, staffClientIds } from "../../common/assignment";
import { logAudit } from "../../common/audit";

/**
 * Row Notes — a note on one row of any table (a filing period, an invoice, a client...), one card or one amount. The row is named by
 * entity_type + client_id + entity_key, chosen by the screen that shows it, so a note written on the Filing Tracker is the same note the
 * client's own filing table shows. One note per row (edit it, do not stack them). "Needs attention" turns the icon red and lists the note
 * on the Command Center until somebody marks it resolved. Staff and admins only; a note on a client's row follows that client's access.
 */
export const rowNotesRouter = Router();

const TYPE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function shape(r: any) {
  return {
    noteId: r.note_id, type: r.entity_type, clientId: r.client_id || "", key: r.entity_key, label: r.label, link: r.link, body: r.body,
    attention: Boolean(r.attention), resolved: Boolean(r.resolved_at), resolvedAt: r.resolved_at, resolvedBy: r.resolved_by,
    createdBy: r.created_by, createdByName: r.created_by_name || r.created_by, createdAt: r.created_at,
    updatedBy: r.updated_by, updatedAt: r.updated_at, clientName: r.client_name || undefined,
  };
}

/** Only the clients this login may see (staff: the ones they have work on; rows with no client are open to all staff). */
async function visible(req: AuthedRequest, rows: any[]): Promise<any[]> {
  const allowed = await staffClientIds(req.user!);
  return allowed ? rows.filter((r) => !r.client_id || allowed.has(r.client_id)) : rows;
}

/** Notes for one or more row types, optionally for one client: GET /row-notes?types=filing,invoice&clientId=C-1 */
rowNotesRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const types = String(req.query.types || req.query.type || "").split(",").map((t) => t.trim()).filter(Boolean);
  if (types.length === 0 || types.some((t) => !TYPE_RE.test(t))) return res.status(400).json({ error: "Say which kind of row the notes are for." });
  const clientId = String(req.query.clientId || "").trim();
  if (clientId && !(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const rows = await query<any>(
    `SELECT n.*, c.client_name FROM altax.v3_row_notes n LEFT JOIN altax.v3_clients c ON c.client_id = n.client_id
      WHERE n.entity_type = ANY($1::text[]) AND ($2 = '' OR n.client_id = $2) ORDER BY n.updated_at DESC LIMIT 5000`,
    [types, clientId]
  );
  res.json({ notes: (clientId ? rows : await visible(req, rows)).map(shape) });
}));

/** Every note still flagged "needs attention" and not resolved — the Command Center list. */
rowNotesRouter.get("/attention", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rows = await query<any>(
    `SELECT n.*, c.client_name FROM altax.v3_row_notes n LEFT JOIN altax.v3_clients c ON c.client_id = n.client_id
      WHERE n.attention AND n.resolved_at IS NULL ORDER BY n.updated_at DESC LIMIT 200`
  );
  res.json({ notes: (await visible(req, rows)).map(shape) });
}));

/** Create or change the note on a row. */
rowNotesRouter.put("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const b = req.body || {};
  const type = String(b.type || "").trim();
  const key = String(b.key || "").trim();
  const clientId = String(b.clientId || "").trim();
  const text = String(b.body ?? "").trim();
  if (!TYPE_RE.test(type) || !key || key.length > 200) return res.status(400).json({ error: "That row cannot take a note." });
  if (!text) return res.status(400).json({ error: "Write the note first." });
  if (text.length > 2000) return res.status(400).json({ error: "That note is too long (2,000 characters at most)." });
  if (clientId && !(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const label = String(b.label || "").trim().slice(0, 240) || null;
  const link = /^\/[^\s]{0,398}$/.test(String(b.link || "")) && !String(b.link).startsWith("//") ? String(b.link) : null;
  const attention = b.attention === true;
  const me = req.user!.email.toLowerCase();
  const author = await queryOne<any>(`SELECT name FROM altax.v3_users WHERE lower(email) = $1`, [me]);
  // Editing a note re-opens it: a resolved problem that gets new words is a live problem again.
  const row = await queryOne<any>(
    `INSERT INTO altax.v3_row_notes (note_id, entity_type, client_id, entity_key, label, link, body, attention, created_by, created_by_name, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9)
     ON CONFLICT (entity_type, client_id, entity_key) DO UPDATE
       SET body = EXCLUDED.body, attention = EXCLUDED.attention, label = COALESCE(EXCLUDED.label, altax.v3_row_notes.label),
           link = COALESCE(EXCLUDED.link, altax.v3_row_notes.link), updated_by = EXCLUDED.updated_by, updated_at = now(), resolved_at = NULL, resolved_by = NULL
     RETURNING *`,
    [`RN-${idSuffix()}`, type, clientId, key, label, link, text, attention, me, author?.name || null]
  );
  logAudit("Row Notes", "SAVE", row.note_id, "row", "", `${type}:${key}`, `Note saved on ${label || `${type} ${key}`}${attention ? " (needs attention)" : ""}.`, req.user!.email).catch(() => {});
  res.json({ note: shape(row) });
}));

async function loadAllowed(req: AuthedRequest, res: Response): Promise<any | null> {
  const n = await queryOne<any>(`SELECT * FROM altax.v3_row_notes WHERE note_id = $1`, [req.params.noteId]);
  if (!n) { res.status(404).json({ error: "Note not found." }); return null; }
  if (n.client_id && !(await canAccessClient(req.user!, n.client_id))) { res.status(403).json({ error: "You do not have access to this client." }); return null; }
  return n;
}

rowNotesRouter.post("/:noteId/resolve", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const n = await loadAllowed(req, res); if (!n) return;
  const resolved = req.body?.resolved !== false;
  const row = await queryOne<any>(
    `UPDATE altax.v3_row_notes SET resolved_at = ${resolved ? "now()" : "NULL"}, resolved_by = ${resolved ? "$2" : "NULL"}, updated_at = now() WHERE note_id = $1 RETURNING *`,
    resolved ? [n.note_id, req.user!.email] : [n.note_id]
  );
  logAudit("Row Notes", resolved ? "RESOLVE" : "REOPEN", n.note_id, "row", "", `${n.entity_type}:${n.entity_key}`, `Note ${resolved ? "marked resolved" : "re-opened"} on ${n.label || n.entity_key}.`, req.user!.email).catch(() => {});
  res.json({ note: shape(row) });
}));

rowNotesRouter.delete("/:noteId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const n = await loadAllowed(req, res); if (!n) return;
  await query(`DELETE FROM altax.v3_row_notes WHERE note_id = $1`, [n.note_id]);
  logAudit("Row Notes", "DELETE", n.note_id, "row", `${n.entity_type}:${n.entity_key}`, "", `Note deleted on ${n.label || n.entity_key}.`, req.user!.email).catch(() => {});
  res.json({ ok: true });
}));
