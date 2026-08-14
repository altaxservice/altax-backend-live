-- PERF-009 (hard audit, 2026-08-13): v3_paychecks had no composite index with
-- pay_date, only a lone client_id index — added proactively before real
-- payroll volume lands (all current paycheck data is placeholder-scale).
CREATE INDEX IF NOT EXISTS idx_v3_paychecks_client_pay_date
  ON altax.v3_paychecks (client_id, pay_date DESC);
