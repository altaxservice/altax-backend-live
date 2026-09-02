-- Extends the QBO-vs-Drake payroll-provider split (TR-018 Drake / TR-019 QBO
-- for "Payroll Processing", added 2026-08-09) to the two remaining filing
-- obligations that still treated every payroll client identically: Form 941
-- and MD UI. QBO auto-files and auto-pays both of these itself for QBO
-- clients; staff only need to confirm it happened, not actually file.

-- TR-013 (Form 941 Filing) narrows to Drake via the new second condition
-- (trigger_column_2/trigger_value_2, sql/136) rather than repointing its
-- existing Payroll?=Yes gate, so a client without payroll enabled still
-- never matches regardless of PayrollSystem.
UPDATE altax.v3_task_rules SET
  trigger_column_2 = 'PayrollSystem', trigger_value_2 = 'Drake',
  portal_name = 'Drake',
  notes = 'Quarterly 941 filing for Drake-processed payroll clients. QBO clients are handled by the "Form 941 — Confirm QBO Filed" rule instead (added 2026-09-02, mirrors the TR-018/TR-019 payroll-processing split).',
  updated_at = now()
  WHERE rule_id = 'TR-013';

-- TR-009 (MD UI Wages Filing & Payment) narrows to Drake the same way.
UPDATE altax.v3_task_rules SET
  trigger_column_2 = 'PayrollSystem', trigger_value_2 = 'Drake',
  notes = 'MD UI wages filing & payment for Drake-processed payroll clients (merged from TR-009/TR-010 2026-08-09). QBO clients are handled by the "MD UI — Confirm QBO Filed" rule instead (added 2026-09-02).',
  updated_at = now()
  WHERE rule_id = 'TR-009';

INSERT INTO altax.v3_task_rules
  (rule_id, task_type, trigger_column, trigger_value, trigger_column_2, trigger_value_2,
   frequency, period_type, due_month, due_day, payment_required, requires_filing,
   portal_name, warning_days, active, depends_on, portal_url, notes)
VALUES
  -- QBO siblings: same statutory cadence/due dates as the Drake rule they
  -- mirror, but reframed as a verify-not-file task, exactly like TR-019.
  ('TR-029', 'Form 941 — Confirm QBO Filed', 'Payroll?', 'Yes', 'PayrollSystem', 'QBO',
   'Quarterly', 'Quarterly', 'Quarter End + 1', '31', true, true,
   'QBO', '14,7,3', true, 'QBO Payroll Follow-Up', 'https://qbo.intuit.com/',
   'Quarterly Form 941 — confirm QuickBooks Online auto-filed this correctly. Not a manual filing task; QBO files itself. Added 2026-09-02.'),
  ('TR-030', 'MD UI — Confirm QBO Filed', 'MD UI', 'Yes', 'PayrollSystem', 'QBO',
   'Quarterly', 'Quarterly', 'Quarter End + 1', '24', true, true,
   'QBO', '14,7,3', true, 'QBO Payroll Follow-Up', 'https://qbo.intuit.com/',
   'Quarterly MD UI wages filing & payment — confirm QuickBooks Online auto-filed and paid this correctly. Not a manual filing task; QBO files itself. Added 2026-09-02.'),

  -- Safety-net siblings for the remaining PAYROLL_PROVIDERS options with zero
  -- clients today (Gusto, ADP, Paychex, Other) -- inactive, same pattern as
  -- TR-023-026: default to manual processing (a real filing task, same as
  -- Drake) until the firm confirms a given provider files itself the way QBO
  -- does. Zero-cost now; flip `active` the same way TR-019 was changed if
  -- ever needed.
  ('TR-031', 'Form 941 Filing', 'Payroll?', 'Yes', 'PayrollSystem', 'Gusto',
   'Quarterly', 'Quarterly', 'Quarter End + 1', '31', true, true,
   'Gusto', '14,7,3', false, 'Payroll Processing', NULL,
   'Quarterly 941 filing for clients processed on Gusto. Assumed manual by default -- see TR-023''s note.'),
  ('TR-032', 'Form 941 Filing', 'Payroll?', 'Yes', 'PayrollSystem', 'ADP',
   'Quarterly', 'Quarterly', 'Quarter End + 1', '31', true, true,
   'ADP', '14,7,3', false, 'Payroll Processing', NULL,
   'Quarterly 941 filing for clients processed on ADP. Assumed manual by default -- see TR-024''s note.'),
  ('TR-033', 'Form 941 Filing', 'Payroll?', 'Yes', 'PayrollSystem', 'Paychex',
   'Quarterly', 'Quarterly', 'Quarter End + 1', '31', true, true,
   'Paychex', '14,7,3', false, 'Payroll Processing', NULL,
   'Quarterly 941 filing for clients processed on Paychex. Assumed manual by default -- see TR-025''s note.'),
  ('TR-034', 'Form 941 Filing', 'Payroll?', 'Yes', 'PayrollSystem', 'Other',
   'Quarterly', 'Quarterly', 'Quarter End + 1', '31', true, true,
   NULL, '14,7,3', false, 'Payroll Processing', NULL,
   'Quarterly 941 filing for clients on an unlisted/other payroll system. Assumed manual by default -- see TR-026''s note.'),
  ('TR-035', 'MD UI Wages Filing & Payment', 'MD UI', 'Yes', 'PayrollSystem', 'Gusto',
   'Quarterly', 'Quarterly', 'Quarter End + 1', '24', true, true,
   'employer.beacon.labor.md', '14,7,3', false, NULL, 'https://employer.beacon.labor.md.gov/',
   'MD UI wages filing & payment for clients processed on Gusto. Assumed manual by default -- see TR-023''s note.'),
  ('TR-036', 'MD UI Wages Filing & Payment', 'MD UI', 'Yes', 'PayrollSystem', 'ADP',
   'Quarterly', 'Quarterly', 'Quarter End + 1', '24', true, true,
   'employer.beacon.labor.md', '14,7,3', false, NULL, 'https://employer.beacon.labor.md.gov/',
   'MD UI wages filing & payment for clients processed on ADP. Assumed manual by default -- see TR-024''s note.'),
  ('TR-037', 'MD UI Wages Filing & Payment', 'MD UI', 'Yes', 'PayrollSystem', 'Paychex',
   'Quarterly', 'Quarterly', 'Quarter End + 1', '24', true, true,
   'employer.beacon.labor.md', '14,7,3', false, NULL, 'https://employer.beacon.labor.md.gov/',
   'MD UI wages filing & payment for clients processed on Paychex. Assumed manual by default -- see TR-025''s note.'),
  ('TR-038', 'MD UI Wages Filing & Payment', 'MD UI', 'Yes', 'PayrollSystem', 'Other',
   'Quarterly', 'Quarterly', 'Quarter End + 1', '24', true, true,
   'employer.beacon.labor.md', '14,7,3', false, NULL, 'https://employer.beacon.labor.md.gov/',
   'MD UI wages filing & payment for clients on an unlisted/other payroll system. Assumed manual by default -- see TR-026''s note.')
ON CONFLICT (rule_id) DO NOTHING;
