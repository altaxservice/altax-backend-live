import { query, queryOne } from "../config/db";

/**
 * BC-008 (Hard Audit, 2026-08-13) — /system/diagnostics/rotate-jwt-secret only
 * ever mutated process.env.JWT_SECRET in memory (see system.routes.ts), with
 * an honest note telling the admin to paste the new value into .env by hand.
 * If the server restarts (a routine Railway redeploy) before that manual step
 * happens, the rotation silently reverts to whatever .env still has — which
 * defeats the entire point of rotating in response to a suspected leak, since
 * a leaked-then-rotated secret becomes valid again on the very next deploy.
 * This persists the rotated secret to Postgres (same "DB is the source of
 * truth for runtime config that must survive a restart" pattern as
 * v3_firm_settings) and reapplies it to process.env.JWT_SECRET once at server
 * start, so every existing JWT_SECRET call site (requireAuth, auth.routes,
 * totp.ts, documents.routes) keeps working unchanged — restarts just stop
 * undoing a rotation.
 */
export async function applyPersistedJwtSecret(): Promise<void> {
  try {
    const row = await queryOne<any>(`SELECT secret FROM altax.v3_jwt_secret_rotation WHERE id = 'JWT-1'`);
    if (row?.secret) process.env.JWT_SECRET = row.secret;
  } catch {
    // Table may not exist yet (fresh DB before this migration has run) — fall back to .env's value.
  }
}

export async function persistRotatedJwtSecret(secret: string, rotatedBy: string): Promise<void> {
  await query(
    `INSERT INTO altax.v3_jwt_secret_rotation (id, secret, rotated_at, rotated_by) VALUES ('JWT-1', $1, now(), $2)
     ON CONFLICT (id) DO UPDATE SET secret = EXCLUDED.secret, rotated_at = now(), rotated_by = EXCLUDED.rotated_by`,
    [secret, rotatedBy]
  );
}
