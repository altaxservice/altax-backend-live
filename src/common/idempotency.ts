import type { DbClient } from "../config/db";

/**
 * ACC-019 (Hard Audit, 2026-08-13) — a double-click on "Record Payment" or
 * "Post Journal Entry" (or a browser retrying a timed-out POST) generates a
 * fresh payment_id/jeid every submit, so nothing stopped two identical
 * submissions from both landing. This is a different problem from the
 * row-locking already in place on invoice payments (ACC-004) — locking
 * prevents two CONCURRENT submits from corrupting each other's numbers, but
 * both still succeed and both still create a row. An idempotency key closes
 * that: the caller sends the same client-generated key on every attempt of
 * "the same" submission, and only the first attempt actually creates
 * anything.
 *
 * reserveIdempotencyKey() must run inside the same transaction as the write
 * it's protecting, and BEFORE that write, so the reservation and the create
 * are atomic together — reserving it outside a transaction (or after
 * creating the resource) reopens the exact race this exists to close.
 */
export async function reserveIdempotencyKey(db: DbClient, key: string, endpoint: string): Promise<{ reserved: boolean; existingResponse: any | null }> {
  const inserted = await db.query(
    `INSERT INTO altax.v3_idempotency_keys (idempotency_key, endpoint) VALUES ($1, $2)
     ON CONFLICT (idempotency_key, endpoint) DO NOTHING
     RETURNING idempotency_key`,
    [key, endpoint]
  );
  if (inserted.length > 0) return { reserved: true, existingResponse: null };
  const existing = await db.queryOne<any>(
    `SELECT response_body FROM altax.v3_idempotency_keys WHERE idempotency_key = $1 AND endpoint = $2`,
    [key, endpoint]
  );
  return { reserved: false, existingResponse: existing?.response_body ?? null };
}

export async function saveIdempotencyResponse(db: DbClient, key: string, endpoint: string, response: unknown): Promise<void> {
  await db.query(
    `UPDATE altax.v3_idempotency_keys SET response_body = $3 WHERE idempotency_key = $1 AND endpoint = $2`,
    [key, endpoint, JSON.stringify(response)]
  );
}
