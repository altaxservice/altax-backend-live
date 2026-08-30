-- Real filing record for MD Annual Report — previously a generic v3_tasks
-- row + v3_obligation_completions row with no tracked amount, no client
-- acknowledge link. Same shape as v3_md_filing_payments/v3_eftps_deposits
-- (share_token/acknowledged_at/acknowledged_ip = the same token-gated
-- client acknowledge pattern), minus the sales-tax-specific columns — a
-- flat filed amount, not a per-category breakdown.
CREATE TABLE IF NOT EXISTS altax.v3_annual_report_filings (
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    filed_date DATE NOT NULL,
    paid_date DATE,
    amount NUMERIC(12,2) NOT NULL,
    filed_by VARCHAR(255),
    filed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    share_token VARCHAR(64) UNIQUE,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_ip VARCHAR(64),
    PRIMARY KEY (client_id, period_end)
);
