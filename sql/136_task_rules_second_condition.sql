-- Optional second AND condition on a task rule — needed so a rule like
-- "Form 941 Filing" can require BOTH its real domain gate (Payroll? = Yes)
-- AND a payroll-provider split (PayrollSystem = Drake) without silently
-- dropping the domain gate the way simply repointing trigger_column would.
-- Nullable/backward compatible: existing single-condition rules are
-- unaffected (clientMatchesRule only applies this when both columns are set).
ALTER TABLE altax.v3_task_rules
  ADD COLUMN IF NOT EXISTS trigger_column_2 VARCHAR(255),
  ADD COLUMN IF NOT EXISTS trigger_value_2 VARCHAR(255);
