-- Real filing record for MD Unemployment Insurance quarterly wage filings —
-- same shape as v3_annual_report_filings (sql/128). Amount is staff-entered,
-- suggested from SUM(v3_paychecks.suta) over the period but not force-
-- trusted the way EFTPS/MD Sales Tax's live recompute is, since MD's real
-- Contribution Report can include adjustments this app doesn't model.
CREATE TABLE IF NOT EXISTS altax.v3_md_ui_filings (
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
