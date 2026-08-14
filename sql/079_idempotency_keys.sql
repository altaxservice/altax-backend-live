-- ACC-019 (hard audit, 2026-08-13) — a double-click or a browser retry on
-- "Record Payment" or "Post Journal Entry" creates a fresh payment_id/jeid
-- every submit, so nothing in the schema stops two identical submissions
-- from posting twice. Composite PK on (key, endpoint) scopes a key to one
-- route, so the same client-generated key can't collide across unrelated
-- endpoints.
CREATE TABLE IF NOT EXISTS altax.v3_idempotency_keys (
    idempotency_key VARCHAR(128) NOT NULL,
    endpoint VARCHAR(128) NOT NULL,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (idempotency_key, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_v3_idempotency_keys_created_at ON altax.v3_idempotency_keys(created_at);
