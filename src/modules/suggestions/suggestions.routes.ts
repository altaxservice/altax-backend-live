import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";

/**
 * "Suggestions" — a shared, firm-internal improvement-idea board for Admin
 * and Staff. Deliberately an open board, not a private inbox to the owner:
 * anyone can post, everyone sees the same list. Only Admin gets the status
 * triage control (New -> Under Review -> Planned -> In Progress -> Done, or
 * Declined) and the admin_note shown back to everyone, so ideas visibly get
 * looked at instead of silently disappearing.
 *
 * No client scoping (no client_id column, no canAccessClient checks) — this
 * is firm-internal, not tied to any client record.
 *
 * Simplification: the spec's "let the original submitter edit their own
 * title/description while status is still New" nice-to-have was skipped to
 * keep the route contract simple — Admin edits status/note, a submitter's
 * post is fixed once created. Small internal feedback items are cheap to
 * just re-post if something was mistyped.
 */
export const suggestionsRouter = Router();

const STATUSES = ["New", "Under Review", "Planned", "In Progress", "Done", "Declined"];

/** Mirrors nextUserId()/idSuffix() elsewhere in this app: prefix + yyyyMMddHHmmss + "-" + 3-digit random. */
function nextSuggestionId(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `SUG-${ts}-${rand}`;
}

suggestionsRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const suggestions = await query(
    `SELECT suggestion_id, title, description, category, submitted_by_name, submitted_by_email, submitted_by_role,
            status, admin_note, status_updated_by, status_updated_at, created_at, updated_at
       FROM altax.v3_suggestions
      ORDER BY created_at DESC`
  );
  res.json({ suggestions });
}));

suggestionsRouter.post("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const title = String(req.body?.title || "").trim();
  const description = req.body?.description !== undefined ? String(req.body.description).trim() : "";
  const category = req.body?.category !== undefined ? String(req.body.category).trim() : "";
  if (!title) return res.status(400).json({ error: "Title is required." });

  // req.user carries email/role/sub but not a display name — look up the
  // submitter's name from v3_users the same way other routes resolve a
  // display name for the authed user (e.g. system.routes.ts's previous_login lookup).
  const me = await queryOne<any>(`SELECT name FROM altax.v3_users WHERE user_id = $1`, [req.user!.sub]);
  const submittedByName = me?.name || req.user!.email;

  const suggestionId = nextSuggestionId();
  await query(
    `INSERT INTO altax.v3_suggestions
       (suggestion_id, title, description, category, submitted_by_name, submitted_by_email, submitted_by_role, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'New')`,
    [suggestionId, title, description || null, category || null, submittedByName, req.user!.email, req.user!.role]
  );
  res.status(201).json({ ok: true, suggestionId });
}));

/**
 * Admin-only status triage + admin note. Staff can submit and read (see the
 * GET/POST routes above) but never manage status — enforced here server-side,
 * not just hidden in the UI.
 */
suggestionsRouter.patch("/:suggestionId", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { suggestionId } = req.params;
  const old = await queryOne<any>(`SELECT * FROM altax.v3_suggestions WHERE suggestion_id = $1`, [suggestionId]);
  if (!old) return res.status(404).json({ error: "Suggestion not found." });

  const statusProvided = req.body?.status !== undefined;
  const status = statusProvided ? String(req.body.status).trim() : old.status;
  if (statusProvided && !STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(", ")}.` });
  }
  const adminNote = req.body?.adminNote !== undefined ? String(req.body.adminNote).trim() : old.admin_note;
  const statusChanged = statusProvided && status !== old.status;

  await query(
    `UPDATE altax.v3_suggestions
        SET status = $2, admin_note = $3, updated_at = now(),
            status_updated_by = CASE WHEN $4 THEN $5 ELSE status_updated_by END,
            status_updated_at = CASE WHEN $4 THEN now() ELSE status_updated_at END
      WHERE suggestion_id = $1`,
    [suggestionId, status, adminNote || null, statusChanged, req.user!.email]
  );
  res.json({ ok: true });
}));

/**
 * Hard delete — this is lightweight internal feedback, not a financial/legal
 * record, so unlike most of this app's config data it needs no audit trail
 * or soft-delete.
 */
suggestionsRouter.post("/:suggestionId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { suggestionId } = req.params;
  const old = await queryOne<any>(`SELECT suggestion_id FROM altax.v3_suggestions WHERE suggestion_id = $1`, [suggestionId]);
  if (!old) return res.status(404).json({ error: "Suggestion not found." });
  await query(`DELETE FROM altax.v3_suggestions WHERE suggestion_id = $1`, [suggestionId]);
  res.json({ ok: true });
}));
