-- Profit-share partners a client sets up in the portal (owner + partners, percentages sum to 100).
-- Used only to show each person's share of net income on My Income & Expenses and its PDF.
CREATE TABLE IF NOT EXISTS altax.v3_client_partners (
  partner_id VARCHAR(64) PRIMARY KEY,
  client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
  partner_name VARCHAR(120) NOT NULL,
  percent NUMERIC(6,3) NOT NULL CHECK (percent >= 0 AND percent <= 100),
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v3_client_partners_client ON altax.v3_client_partners(client_id, sort_order);
