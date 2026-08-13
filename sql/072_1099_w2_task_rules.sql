-- TAX-003 (Hard Audit, 2026-08-13): 1099-NEC/MISC and W-2/W-3 Jan 31 filing
-- deadlines existed only as PDF-generation code (accounting/nec1099.ts,
-- w2.ts, w3.ts) with zero deadline tracking or Task Rule anywhere — a client
-- with contractors/employees could miss the Jan 31 filing with the platform
-- never having tracked it. w21099_enabled is an existing client-level
-- checkbox ("W-2 / 1099 Enabled") already wired into the Task Rules engine's
-- trigger-column map (CLIENT_TRIGGER_COLUMNS.W21099Enabled) and into a Fix
-- Center check — it was simply never used to seed an actual rule. Two
-- separate rules (not one) since they're two distinct filings with two
-- distinct PDF generators; both due_month/due_day='1'/'31' matches the
-- existing MW508 rule's (TR-020) "Annual, offset 1 month past year-end"
-- shape in computeDuePeriod(). requires_filing=true so TAX-005's
-- evidence-before-Completed gate (confirmation_number/filed_date) applies —
-- correct, since these are e-filed, not just paid.
INSERT INTO altax.v3_task_rules
  (rule_id, task_type, trigger_column, trigger_value, frequency, period_type, due_month, due_day,
   payment_required, requires_filing, portal_name, warning_days, active, notes, portal_url)
VALUES
  ('TR-027', '1099-NEC/MISC Filing', 'W21099Enabled', 'Yes', 'Annual', NULL, '1', '31',
   false, true, 'IRS FIRE/IRIS', '30,14,7', true, 'Added 2026-08-14 (TAX-003) — annual 1099-NEC/MISC filing for contractor payments, due Jan 31 of the following year. (TR-023 through TR-026 were already in use by real Payroll Processing rules — verified against live data before picking these IDs.)', NULL),
  ('TR-028', 'W-2/W-3 Filing', 'W21099Enabled', 'Yes', 'Annual', NULL, '1', '31',
   false, true, 'SSA Business Services Online', '30,14,7', true, 'Added 2026-08-14 (TAX-003) — annual W-2/W-3 filing for employee wages, due Jan 31 of the following year.', NULL)
ON CONFLICT (rule_id) DO NOTHING;
