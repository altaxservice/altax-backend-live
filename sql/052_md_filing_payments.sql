-- Lets staff mark a specific MD sales tax filing period as actually filed/paid,
-- with a real paid date. Without this, the client dashboard's "MD Sales & Use
-- Tax (ending ...)" Past Due flags and "MD Sales Tax Filing" upcoming deadline
-- (computeClientFlags / computeMdFilingForReport in reports.routes.ts) are
-- computed against TODAY's date on every single load, forever — a period that
-- was genuinely filed (even late) had no way to ever clear, and its
-- penalty/interest kept silently growing day over day instead of freezing at
-- the real filing date. One row per client per filing period, keyed by
-- period_end (calendar-fixed regardless of when this row is created).
CREATE TABLE IF NOT EXISTS altax.v3_md_filing_payments (
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    paid_date DATE NOT NULL,
    tax_due NUMERIC(12,2),
    balance_due NUMERIC(12,2),
    on_time BOOLEAN,
    filed_by VARCHAR(255),
    filed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, period_end)
);
