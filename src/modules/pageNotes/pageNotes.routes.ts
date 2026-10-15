import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";

/**
 * Page Notes — a note pinned to a page of the app (optionally to one tab of that page) that opens at the top of the page when staff
 * arrive. Separate from Firm Notes (a follow-up notebook) and from the per-client activity log: this is "what to remember when you are
 * working HERE". What makes it smart is in the data it returns, which the page banner uses:
 *  - the per-user acknowledgment (acked_version / acked_on) so a note re-opens when it was edited since you last saw it, and again on a
 *    new day (every day for Critical notes), and otherwise collapses to a slim bar;
 *  - the optional show-from / show-until window (America/New_York dates), so a note can wait for a date or retire itself;
 *  - three visibility levels: everyone on staff, admins only (only an admin can create or see one), or just the author.
 * page_key is the route pattern (e.g. "/accounting", "/clients/:id"), tab is the ?tab= value when a page has tabs.
 */
export const pageNotesRouter = Router();

const PRIORITIES = ["Info", "Important", "Critical"] as const;
const VISIBILITIES = ["firm", "admin", "me"] as const;

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${Math.floor(100 + Math.random() * 900)}`;
}

const TODAY_ET = `(now() AT TIME ZONE 'America/New_York')::date`;
const PAGE_KEY_RE = /^\/[a-z0-9\-/:]{0,100}$/;

function cleanPageKey(raw: unknown): string | null {
  const v = String(raw || "").trim().toLowerCase();
  return PAGE_KEY_RE.test(v) ? v : null;
}
function cleanTab(raw: unknown): string | null {
  const v = String(raw || "").trim().toLowerCase().slice(0, 80);
  return /^[a-z0-9_\- ]+$/.test(v) ? v : null;
}
/** A date as YYYY-MM-DD, null when left empty, false when it is not a real date. */
function cleanDate(raw: unknown): string | null | false {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : false;
}

function shape(r: any, me: string, isAdmin: boolean) {
  return {
    noteId: r.note_id, pageKey: r.page_key, tab: r.tab, title: r.title, body: r.body, priority: r.priority, visibility: r.visibility,
    showFrom: r.show_from, showUntil: r.show_until, hidden: Boolean(r.hidden),
    createdBy: r.created_by, createdByName: r.created_by_name, createdAt: r.created_at, updatedBy: r.updated_by, updatedAt: r.updated_at,
    ackedVersion: r.acked_version || null, ackedOn: r.acked_on || null,
    mine: String(r.created_by || "").toLowerCase() === me, canEdit: isAdmin || String(r.created_by || "").toLowerCase() === me,
  };
}

const VISIBLE_SQL = `(n.visibility = 'firm' OR (n.visibility = 'admin' AND $2 = true) OR (n.visibility = 'me' AND lower(n.created_by) = $1))`;

pageNotesRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const page = cleanPageKey(req.query.page);
  if (!page) return res.status(400).json({ error: "Unknown page." });
  const tab = cleanTab(req.query.tab);
  const me = req.user!.email.toLowerCase();
  const isAdmin = req.user!.role === "admin";
  const rows = await query<any>(
    `SELECT n.*, s.acked_version, s.acked_on::text AS acked_on, n.show_from::text AS show_from_t, n.show_until::text AS show_until_t,
            NOT ((n.show_from IS NULL OR n.show_from <= ${TODAY_ET}) AND (n.show_until IS NULL OR n.show_until >= ${TODAY_ET})) AS hidden,
            ${TODAY_ET}::text AS today
       FROM altax.v3_page_notes n
       LEFT JOIN altax.v3_page_note_state s ON s.note_id = n.note_id AND s.user_email = $1
      WHERE n.page_key = $3 AND (n.tab IS NULL OR n.tab = $4) AND ${VISIBLE_SQL}
      ORDER BY CASE n.priority WHEN 'Critical' THEN 0 WHEN 'Important' THEN 1 ELSE 2 END, n.updated_at DESC`,
    [me, isAdmin, page, tab || ""]
  );
  const today = rows[0]?.today || (await queryOne<any>(`SELECT ${TODAY_ET}::text AS today`))?.today;
  const notes = rows.map((r) => shape({ ...r, show_from: r.show_from_t, show_until: r.show_until_t }, me, isAdmin));
  res.json({ today, notes, isAdmin });
}));

function readInput(body: any, isAdmin: boolean): { error?: string; v?: any } {
  const text = String(body?.body ?? "").trim();
  if (!text) return { error: "Write the note first." };
  if (text.length > 4000) return { error: "That note is too long (4,000 characters at most)." };
  const title = String(body?.title ?? "").trim().slice(0, 120) || null;
  const priority = PRIORITIES.includes(body?.priority) ? body.priority : "Info";
  const visibility = VISIBILITIES.includes(body?.visibility) ? body.visibility : "firm";
  if (visibility === "admin" && !isAdmin) return { error: "Only an administrator can make an admin-only note." };
  const showFrom = cleanDate(body?.showFrom);
  const showUntil = cleanDate(body?.showUntil);
  if (showFrom === false || showUntil === false) return { error: "Use real dates for 'show from' and 'show until'." };
  if (showFrom && showUntil && showUntil < showFrom) return { error: "'Show until' cannot be before 'show from'." };
  return { v: { text, title, priority, visibility, showFrom, showUntil } };
}

pageNotesRouter.post("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const page = cleanPageKey(req.body?.page);
  if (!page) return res.status(400).json({ error: "Unknown page." });
  const tab = req.body?.tab ? cleanTab(req.body.tab) : null;
  const isAdmin = req.user!.role === "admin";
  const parsed = readInput(req.body, isAdmin);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.v;
  const me = req.user!.email.toLowerCase();
  const author = await queryOne<any>(`SELECT name FROM altax.v3_users WHERE lower(email) = $1`, [me]);
  const noteId = `PN-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_page_notes (note_id, page_key, tab, title, body, priority, visibility, show_from, show_until, created_by, created_by_name, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10)`,
    [noteId, page, tab, v.title, v.text, v.priority, v.visibility, v.showFrom, v.showUntil, me, author?.name || null]
  );
  // The author already knows what it says: don't pop it open for them at once.
  await query(
    `INSERT INTO altax.v3_page_note_state (note_id, user_email, acked_version, acked_on)
     SELECT note_id, $2, updated_at, ${TODAY_ET} FROM altax.v3_page_notes WHERE note_id = $1`, [noteId, me]);
  logAudit("Page Notes", "CREATE", noteId, "page", "", page, `Page note added on ${page}${tab ? ` (${tab} tab)` : ""} (${v.visibility}).`, req.user!.email).catch(() => {});
  res.status(201).json({ ok: true, noteId });
}));

async function loadEditable(req: AuthedRequest, res: Response): Promise<any | null> {
  const me = req.user!.email.toLowerCase();
  const isAdmin = req.user!.role === "admin";
  const n = await queryOne<any>(`SELECT n.*, to_char(n.show_from,'YYYY-MM-DD') AS show_from_t, to_char(n.show_until,'YYYY-MM-DD') AS show_until_t FROM altax.v3_page_notes n WHERE n.note_id = $3 AND ${VISIBLE_SQL}`, [me, isAdmin, req.params.noteId]);
  if (!n) { res.status(404).json({ error: "Note not found." }); return null; }
  if (!isAdmin && String(n.created_by).toLowerCase() !== me) { res.status(403).json({ error: "Only the person who wrote this note, or an administrator, can change it." }); return null; }
  return n;
}

pageNotesRouter.patch("/:noteId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const n = await loadEditable(req, res); if (!n) return;
  const isAdmin = req.user!.role === "admin";
  const parsed = readInput({ ...{ body: n.body, title: n.title, priority: n.priority, visibility: n.visibility, showFrom: n.show_from_t, showUntil: n.show_until_t }, ...req.body }, isAdmin);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.v;
  const tab = req.body && "tab" in req.body ? (req.body.tab ? cleanTab(req.body.tab) : null) : n.tab;
  await query(
    `UPDATE altax.v3_page_notes SET title=$2, body=$3, priority=$4, visibility=$5, show_from=$6, show_until=$7, tab=$8, updated_by=$9, updated_at=now() WHERE note_id=$1`,
    [n.note_id, v.title, v.text, v.priority, v.visibility, v.showFrom, v.showUntil, tab, req.user!.email.toLowerCase()]
  );
  // The editor has seen their own change; everyone else gets it re-opened.
  await query(
    `INSERT INTO altax.v3_page_note_state (note_id, user_email, acked_version, acked_on)
     SELECT note_id, $2, updated_at, ${TODAY_ET} FROM altax.v3_page_notes WHERE note_id = $1
     ON CONFLICT (note_id, user_email) DO UPDATE SET acked_version = EXCLUDED.acked_version, acked_on = EXCLUDED.acked_on`, [n.note_id, req.user!.email.toLowerCase()]);
  logAudit("Page Notes", "UPDATE", n.note_id, "body", "", "", `Page note edited on ${n.page_key}.`, req.user!.email).catch(() => {});
  res.json({ ok: true });
}));

pageNotesRouter.delete("/:noteId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const n = await loadEditable(req, res); if (!n) return;
  await query(`DELETE FROM altax.v3_page_notes WHERE note_id = $1`, [n.note_id]);
  logAudit("Page Notes", "DELETE", n.note_id, "page", n.page_key, "", `Page note deleted on ${n.page_key}.`, req.user!.email).catch(() => {});
  res.json({ ok: true });
}));

/** "Got it": remember the version and the day, so the note collapses to a slim bar until it changes or a new day starts. */
pageNotesRouter.post("/:noteId/ack", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const me = req.user!.email.toLowerCase();
  const isAdmin = req.user!.role === "admin";
  const n = await queryOne<any>(`SELECT n.note_id FROM altax.v3_page_notes n WHERE n.note_id = $3 AND ${VISIBLE_SQL}`, [me, isAdmin, req.params.noteId]);
  if (!n) return res.status(404).json({ error: "Note not found." });
  await query(
    `INSERT INTO altax.v3_page_note_state (note_id, user_email, acked_version, acked_on)
     SELECT note_id, $2, updated_at, ${TODAY_ET} FROM altax.v3_page_notes WHERE note_id = $1
     ON CONFLICT (note_id, user_email) DO UPDATE SET acked_version = EXCLUDED.acked_version, acked_on = EXCLUDED.acked_on`, [n.note_id, me]);
  res.json({ ok: true });
}));
