-- Budget vs. actual — one row per client per COA account per month. Budgets are
-- scoped to a client (not firm-wide) since every other accounting feature in this
-- app (P&L, Balance Sheet, GL) is already client-scoped the same way, and the
-- Accounting page itself always operates against one selected client.
CREATE TABLE IF NOT EXISTS altax.v3_budgets (
    budget_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    -- Matches v3_gl_entries.account / v3_coa.account_name (a free-text string
    -- everywhere else in this app, not a account_id FK) so actuals join cleanly.
    account_name VARCHAR(255) NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_v3_budgets_client_account_period UNIQUE (client_id, account_name, year, month),
    CONSTRAINT chk_v3_budgets_month CHECK (month BETWEEN 1 AND 12)
);
CREATE INDEX IF NOT EXISTS idx_v3_budgets_client_year ON altax.v3_budgets(client_id, year);
