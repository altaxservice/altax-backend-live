-- Employer state income tax WITHHOLDING filings -- the withholding counterpart of
-- the sales tax filing records (v3_md_filing_payments / v3_dc_filing_payments):
-- one row per client per filed period, recording when it was filed and paid.
-- Penalty and interest are NOT stored; they're recomputed from filed/paid dates
-- against the client's state rules (withholdingFiling.ts), same as sales tax.
-- tax_due is what was actually withheld in the period (suggested from paychecks'
-- state_tax, staff-correctable), balance_due is tax plus any late charges once a
-- payment date is known.
CREATE TABLE IF NOT EXISTS altax.v3_withholding_filings (
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    state VARCHAR(2),
    filed_date DATE NOT NULL,
    paid_date DATE,
    tax_due NUMERIC(12,2),
    balance_due NUMERIC(12,2),
    on_time BOOLEAN,
    filed_by VARCHAR(255),
    filed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    share_token VARCHAR(64) UNIQUE,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_ip VARCHAR(64),
    sent_at TIMESTAMPTZ,
    PRIMARY KEY (client_id, period_end)
);

-- Soft-hide a never-filed period that carried no real obligation (restorable),
-- same design as the sales tax period exclusions.
CREATE TABLE IF NOT EXISTS altax.v3_withholding_period_exclusions (
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    reason TEXT,
    excluded_by VARCHAR(255),
    excluded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, period_end)
);
