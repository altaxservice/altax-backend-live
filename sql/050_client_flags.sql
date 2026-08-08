-- Noticeable, colored account-level issues for the client side panel — a
-- Credit flag (client has an overpayment/credit not represented anywhere
-- else in this app) or a Custom flag (anything else staff needs to keep in
-- front of them, e.g. "client disputes March invoice"). Balance Past Due is
-- NOT stored here — it's computed fresh from real invoice data on every
-- read (see computeClientFlags in clients.routes.ts) so it can never go
-- stale and self-clears the moment the invoice is paid, unlike a manually
-- dismissed note.
CREATE TABLE IF NOT EXISTS altax.v3_client_flags (
    flag_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    flag_type VARCHAR(16) NOT NULL CHECK (flag_type IN ('Credit', 'Custom')),
    amount NUMERIC(14,2),
    note TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Resolved')),
    created_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_by VARCHAR(255),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_v3_client_flags_client_status ON altax.v3_client_flags(client_id, status);
