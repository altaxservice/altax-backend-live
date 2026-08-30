-- Real filing record for federal Form 941 — previously a stateless PDF
-- generator (form941.ts) with no persistence at all. Same client-acknowledge
-- shape as v3_annual_report_filings/v3_md_ui_filings (sql/128/129), plus a
-- full snapshot of the underlying Form941Data (not just an amount) so the
-- public PDF route can regenerate the exact filed PDF later without risk of
-- drift if paychecks are edited after filing — same "compute once at Save
-- time, never recomputed live" principle v3_eftps_deposits already follows.
--
-- eftps_deposits_applied/balance_due: the form's own Line 12/14 ("total
-- taxes") is the quarter's GROSS liability — it never subtracts deposits
-- already made (Line 13 is deliberately left blank, see form941.ts's own
-- header comment). Since this app tracks real EFTPS deposits for the same
-- client/period, balance_due nets them out at filing time — not floored at
-- 0, since an overpaid quarter is a real, honest outcome worth showing.
CREATE TABLE IF NOT EXISTS altax.v3_form941_filings (
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    quarter SMALLINT NOT NULL,
    employee_count INTEGER NOT NULL DEFAULT 0,
    wages NUMERIC(14,2) NOT NULL DEFAULT 0,
    federal_withholding NUMERIC(14,2) NOT NULL DEFAULT 0,
    social_security_wages NUMERIC(14,2) NOT NULL DEFAULT 0,
    medicare_wages NUMERIC(14,2) NOT NULL DEFAULT 0,
    gross_liability NUMERIC(14,2) NOT NULL DEFAULT 0,
    eftps_deposits_applied NUMERIC(14,2) NOT NULL DEFAULT 0,
    balance_due NUMERIC(14,2) NOT NULL DEFAULT 0,
    filed_date DATE NOT NULL,
    paid_date DATE,
    filed_by VARCHAR(255),
    filed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    share_token VARCHAR(64) UNIQUE,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_ip VARCHAR(64),
    PRIMARY KEY (client_id, period_end)
);
