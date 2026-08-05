-- Historical record for the At a Glance dashboard's "current vs prior
-- period" and 12-month trend — before this, every dashboard figure was
-- always recomputed live from today's GL state, so there was no way to
-- answer "how does this month compare to last month" without a second,
-- separately-scoped live query, and no long-running trend beyond whatever
-- window a single live query covered. One row per client per calendar
-- month, populated by the monthly snapshot sweep (src/modules/clients/
-- monthlySnapshot.ts) run on the 1st of each month for the month that just
-- closed. Revenue/expenses/profit/payroll are properly month-scoped flow
-- figures; cash/AR/AP/tax-liabilities are the balance AT SWEEP TIME (not
-- retroactively reconstructed as of month-end) — same "current balance,
-- not a historical reconstruction" convention computeFirmSummary's
-- taxLiabilities already uses.

CREATE TABLE IF NOT EXISTS altax.v3_client_monthly_snapshot (
    snapshot_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    period_year INTEGER NOT NULL,
    period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    revenue NUMERIC(14,2), expenses NUMERIC(14,2), profit NUMERIC(14,2),
    cash_balance NUMERIC(14,2), ar_balance NUMERIC(14,2), ap_balance NUMERIC(14,2),
    tax_liabilities NUMERIC(14,2), payroll_cost NUMERIC(14,2),
    health_score INTEGER, health_band VARCHAR(8), open_tasks INTEGER,
    created_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_v3_client_monthly_snapshot UNIQUE (client_id, period_year, period_month)
);
CREATE INDEX IF NOT EXISTS idx_v3_client_monthly_snapshot_client ON altax.v3_client_monthly_snapshot(client_id, period_year, period_month);
