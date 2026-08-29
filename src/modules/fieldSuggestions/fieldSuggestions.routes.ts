import { Router, Response } from "express";
import { query } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { rateLimit } from "../../common/rateLimit";

/**
 * Backs the system-wide "remember what I typed" feature — see
 * frontend/src/utils/fieldSuggestions.ts for the DOM sweep that calls these
 * routes and the security exclusions that keep sensitive fields (SSN, EIN,
 * bank/card numbers, passwords) from ever reaching here in the first place.
 *
 * requireRole("admin", "staff") deliberately, not bare requireAuth — this
 * app's client/employee portals share the same login system, and a firm-wide
 * shared suggestion pool must stay an internal staff tool only.
 *
 * The digit-run rejection below is the last line of defense, independent of
 * anything the frontend does: SSNs, EINs, routing numbers, and account
 * numbers are all pure digit runs (once spaces/dashes are stripped) in the
 * 4-17 character range, so rejecting that shape outright costs nothing real
 * (a legitimate short numeric value just doesn't get remembered) against a
 * severe downside if every upstream exclusion layer somehow fails.
 */
export const fieldSuggestionsRouter = Router();

const writeLimiter = rateLimit({ name: "field-suggestions-write", windowMs: 60_000, max: 60, keyOn: (req) => (req as AuthedRequest).user?.sub });

function looksSensitive(value: string): boolean {
  const digitsOnly = value.replace(/[\s-]/g, "");
  return /^\d{4,17}$/.test(digitsOnly);
}

fieldSuggestionsRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const fieldKey = String(req.query.fieldKey || "").trim();
  if (!fieldKey) return res.json({ values: [] });
  const rows = await query<{ value: string }>(
    `SELECT value FROM altax.v3_field_suggestions
      WHERE field_key = $1
      ORDER BY use_count DESC, last_used_at DESC
      LIMIT 20`,
    [fieldKey]
  );
  res.json({ values: rows.map((r) => r.value) });
}));

fieldSuggestionsRouter.post("/", requireAuth, requireRole("admin", "staff"), writeLimiter, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const fieldKey = String(req.body?.fieldKey || "").trim().slice(0, 255);
  const value = String(req.body?.value || "").trim().slice(0, 500);
  if (!fieldKey || !value) return res.status(400).json({ error: "fieldKey and value are required." });
  if (looksSensitive(value)) return res.status(400).json({ error: "This value looks like an ID/account number and will not be remembered." });

  await query(
    `INSERT INTO altax.v3_field_suggestions (field_key, value, use_count, last_used_at)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (field_key, value) DO UPDATE SET use_count = altax.v3_field_suggestions.use_count + 1, last_used_at = now()`,
    [fieldKey, value]
  );
  res.status(201).json({ ok: true });
}));
