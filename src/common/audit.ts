import { query } from "../config/db";

/** Real incident, 2026-09-17: v3_audit_log.note is VARCHAR(255) — a caller passing a longer note (easy to do with a descriptive message) crashed the whole action with a raw Postgres error instead of just logging a shorter note. Truncating here, once, protects every caller instead of relying on each one to remember the limit. */
function clampNote(note: string): string {
  const s = String(note ?? "");
  return s.length > 255 ? `${s.slice(0, 252)}...` : s;
}

/** Ported from v3LogAudit_(module, action, recordId, field, oldValue, newValue, note). */
export async function logAudit(
  moduleName: string,
  action: string,
  recordId: string,
  field: string,
  oldValue: string,
  newValue: string,
  note: string,
  userEmail?: string
): Promise<void> {
  await query(
    `INSERT INTO altax.v3_audit_log
      (logged_at, user_email, module, action, record_id, field, old_value, new_value, note)
     VALUES (now(), $1, $2, $3, $4, $5, $6, $7, $8)`,
    [userEmail || "system", moduleName, action, recordId, field, oldValue, newValue, clampNote(note)]
  );
}

/**
 * Writes to the client-facing Activity Timeline (v3_client_activity_log) —
 * the narrower, human-readable feed shown on the Client Detail page, as
 * distinct from logAudit()'s comprehensive field-level system-of-record.
 * Call this alongside logAudit() for anything a staff member glancing at a
 * client should see without opening the audit log — appointment lifecycle,
 * flags, permit events. Best-effort by design: never let a timeline note
 * block the action it's describing.
 */
export async function logClientActivity(
  clientId: string,
  activityType: string,
  note: string,
  loggedBy: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO altax.v3_client_activity_log (activity_id, client_id, activity_type, note, occurred_at, logged_by)
       VALUES ($1,$2,$3,$4,now(),$5)`,
      [`ACT-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`, clientId, activityType, note, loggedBy]
    );
  } catch { /* best-effort — never block the caller's main action over a timeline note */ }
}
