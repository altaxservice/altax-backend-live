-- Lets staff permanently exclude a never-filed MD sales-tax period from the
-- Filing Discount/Late Penalty table (e.g. the client genuinely had no
-- obligation that period, so it sits there forever showing $0.00 and
-- "Late" with nothing to actually do). Distinct from v3_md_filing_payments,
-- whose existence means "this was actually filed" -- an exclusion means the
-- opposite: never filed, and never will be. Restorable (see the
-- restore-period route), so this is a soft hide, not data loss.
CREATE TABLE IF NOT EXISTS altax.v3_md_filing_period_exclusions (
  client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  reason TEXT,
  excluded_by VARCHAR(255),
  excluded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, period_end)
);
