-- Supports the new per-client dashboard queries (cash balance, AP estimate,
-- ratios, health score) added alongside GET /reports/client-dashboard/:clientId
-- — every one of them filters v3_gl_entries by client_id (+ often entry_date),
-- and no composite index existed for that combination before now.

CREATE INDEX IF NOT EXISTS idx_v3_gl_entries_client_date
    ON altax.v3_gl_entries(client_id, entry_date);
