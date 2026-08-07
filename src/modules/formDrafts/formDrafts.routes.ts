import { Router, Response } from "express";
import crypto from "crypto";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";

/**
 * Generic per-user, per-form autosave store — see sql/046_form_drafts.sql for
 * the full rationale. formKey is caller-chosen (e.g. "add-client" or
 * "edit-client:C-1234") and arrives URL-encoded in the path; Express decodes
 * it automatically. No audit logging here on purpose — a debounced autosave
 * firing every couple seconds would otherwise flood the audit log with
 * noise that carries no real business meaning.
 */
export const formDraftsRouter = Router();

function draftId(): string {
  return `DRAFT-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

formDraftsRouter.get("/:formKey", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const row = await queryOne<any>(
    `SELECT draft_data, updated_at FROM altax.v3_form_drafts WHERE user_email = $1 AND form_key = $2`,
    [req.user!.email, req.params.formKey]
  );
  res.json({ draft: row ? { data: row.draft_data, updatedAt: row.updated_at } : null });
}));

formDraftsRouter.put("/:formKey", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = req.body?.data;
  if (data === undefined) return res.status(400).json({ error: "Missing draft data." });

  await query(
    `INSERT INTO altax.v3_form_drafts (draft_id, user_email, form_key, draft_data, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_email, form_key)
     DO UPDATE SET draft_data = EXCLUDED.draft_data, updated_at = now()`,
    [draftId(), req.user!.email, req.params.formKey, JSON.stringify(data)]
  );
  res.json({ ok: true });
}));

// POST, not DELETE — this codebase never uses the DELETE verb (deletions
// elsewhere go through a POST .../delete sub-route; see e.g.
// accounting.routes.ts's journal-entry delete), so this matches that
// convention rather than introducing a new one just for this module.
formDraftsRouter.post("/:formKey/discard", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  await query(`DELETE FROM altax.v3_form_drafts WHERE user_email = $1 AND form_key = $2`, [req.user!.email, req.params.formKey]);
  res.json({ ok: true });
}));
