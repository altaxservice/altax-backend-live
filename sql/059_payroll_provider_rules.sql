-- QBO already runs payroll AND withdraws payroll tax automatically every
-- month (confirmed by firm 2026-08-09) -- staff no longer need a "go process
-- payroll" task for these clients, just a periodic check that the auto-run
-- actually completed correctly. Cadence stays Monthly, matching QBO's own
-- monthly run/deposit cycle (firm's explicit call); only the nature of the
-- task changes from "do this" to "verify this happened".
UPDATE altax.v3_task_rules SET task_type = 'QBO Payroll Follow-Up',
  notes = 'Monthly QBO auto-payroll follow-up (spot-check the auto-run + tax withdrawal completed correctly) -- not a manual processing task, QBO runs itself. Changed from "Payroll Processing" 2026-08-09.',
  updated_at = now()
  WHERE rule_id = 'TR-019';

-- TR-005/TR-005A were blanket, provider-blind rules that fired for every payroll
-- client regardless of who actually processes their payroll -- now fully
-- redundant with (and creating duplicate draft batches against) the
-- provider-specific rules below (TR-018/019/023/024/025/026). Retired rather
-- than deleted so historical batch/task references stay valid.
UPDATE altax.v3_task_rules SET active = false,
  notes = 'Retired 2026-08-09 -- superseded by provider-specific rules (TR-018/019/023/024/025/026), which correctly distinguish QBO auto-payroll from manually-processed providers.', updated_at = now()
  WHERE rule_id = 'TR-005';
UPDATE altax.v3_task_rules SET active = false,
  notes = 'Retired 2026-08-09 -- superseded by provider-specific rules (TR-018/019/023/024/025/026).', updated_at = now()
  WHERE rule_id = 'TR-005A';

-- Provider-specific rules for the remaining PAYROLL_PROVIDERS options with zero
-- clients today (Gusto, ADP, Paychex, Other) -- default to manual processing
-- (a real monthly task), the safe assumption until the firm confirms otherwise
-- for a specific provider (same as QBO was, until today). Zero-cost now (no
-- client matches yet), pure safety net for whenever a client lands on one of
-- these.
INSERT INTO altax.v3_task_rules
  (rule_id, task_type, trigger_column, trigger_value, frequency, period_type, due_month, due_day,
   payment_required, requires_filing, portal_name, warning_days, active, notes, portal_url)
VALUES
  ('TR-023', 'Payroll Processing', 'PayrollSystem', 'Gusto', 'Monthly', NULL, NULL, '28', false, true, 'Gusto', '7,3', true,
   'Monthly payroll checkpoint for clients processed on Gusto. Assumed manual by default -- if Gusto turns out to run payroll automatically like QBO, change this the same way TR-019 was changed 2026-08-09.', NULL),
  ('TR-024', 'Payroll Processing', 'PayrollSystem', 'ADP', 'Monthly', NULL, NULL, '28', false, true, 'ADP', '7,3', true,
   'Monthly payroll checkpoint for clients processed on ADP. Assumed manual by default -- see TR-023 note.', NULL),
  ('TR-025', 'Payroll Processing', 'PayrollSystem', 'Paychex', 'Monthly', NULL, NULL, '28', false, true, 'Paychex', '7,3', true,
   'Monthly payroll checkpoint for clients processed on Paychex. Assumed manual by default -- see TR-023 note.', NULL),
  ('TR-026', 'Payroll Processing', 'PayrollSystem', 'Other', 'Monthly', NULL, NULL, '28', false, true, NULL, '7,3', true,
   'Monthly payroll checkpoint for clients on an unlisted/other payroll system. Assumed manual by default -- see TR-023 note.', NULL)
ON CONFLICT (rule_id) DO NOTHING;
