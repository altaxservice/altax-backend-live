import { query } from "../config/db";

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
    [userEmail || "system", moduleName, action, recordId, field, oldValue, newValue, note]
  );
}
