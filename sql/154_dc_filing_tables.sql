-- DC mirror of v3_md_filing_payments / v3_md_filing_period_exclusions --
-- real owner request, 2026-09-14: FATIMA LLC (a genuine DC client) had no
-- equivalent of MD's "Mark Filed" / Filing Discount-Penalty tracking table.
-- Schema matches v3_md_filing_payments' EFFECTIVE (post-migration) shape
-- directly, rather than replaying MD's own incremental history of ALTERs
-- (filed_date added later, paid_date/balance_due/on_time made nullable,
-- share_token/acknowledge columns, sent_at) -- this table starts at that
-- same end state since there's no legacy DC data to migrate around.
CREATE TABLE IF NOT EXISTS altax.v3_dc_filing_payments (
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
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

-- Lets staff permanently exclude a never-filed DC sales-tax period from the
-- Filing Penalty table (e.g. the client genuinely had no obligation that
-- period) -- same soft-hide/restorable design as v3_md_filing_period_exclusions.
CREATE TABLE IF NOT EXISTS altax.v3_dc_filing_period_exclusions (
  client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  reason TEXT,
  excluded_by VARCHAR(255),
  excluded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, period_end)
);
