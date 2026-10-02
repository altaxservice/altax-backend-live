-- Task rules that only apply in Maryland no longer fire for clients in other
-- states, and DC/VA/PA/DE get their own rules built from each state's published
-- due dates (researched 2026-10-02; the same dates complianceCalendar.ts shows
-- on At a Glance). Until now every rule keyed off the client's "MD Withholding
-- Frequency" / "MD UI" flags only, so a DC client with withholding on was
-- drafted "MD Withholding Filing & Payment" tasks on Maryland's due dates.
--
-- state_scope (new, nullable) limits a rule to a comma-separated list of state
-- codes; empty means every state, exactly as before. It's its own column
-- rather than a "State = MD" second condition because the second condition is
-- already taken on the Maryland UI rules (it splits Drake vs QBO payroll
-- clients). A client with NO state on file still counts as Maryland
-- (rules.routes.ts clientMatchesRule), the app's only behavior until now.
--
-- Scoped to MD: every rule named "MD ..." and every rule triggered by an MD-only
-- flag (MD Withholding Frequency, MD UI, MD Annual Report). Generic rules
-- (sales tax, EFTPS, Form 941, payroll, business returns, 1099/W-2) stay
-- unscoped: their due dates are the same in every state we serve.
--
-- Annual-report obligations aren't added as rules for the other states: they
-- depend on entity type and formation date, so they live in
-- complianceCalendar.ts. PA's December monthly withholding payment is due Jan
-- 31, not the 15th; a rule can't express one odd month, so that single task is
-- drafted for the 15th.
ALTER TABLE altax.v3_task_rules ADD COLUMN IF NOT EXISTS state_scope VARCHAR(50);

UPDATE altax.v3_task_rules
   SET state_scope = 'MD', updated_at = now()
 WHERE COALESCE(btrim(state_scope), '') = ''
   AND (task_type LIKE 'MD %'
        OR trigger_column IN ('MD Withholding Frequency', 'MDWithholdingFrequency', 'MD UI', 'MDUIEnabled', 'MD Annual Report?', 'MDAnnualReportEnabled'));

INSERT INTO altax.v3_task_rules
  (rule_id, task_type, trigger_column, trigger_value, frequency, due_month, due_day,
   payment_required, requires_filing, portal_name, portal_url, warning_days, active, notes, state_scope)
VALUES
    ('TR-DC-WH-M', 'DC Withholding Filing & Payment', 'MD Withholding Frequency', 'Monthly', 'Monthly', NULL, '20', true, true, 'MyTax.DC.gov', 'https://mytax.dc.gov', '14,7,3', true, 'Added 2026-10-02 from DC''s own published due dates; see complianceCalendar.ts.', 'DC'),
    ('TR-DC-WH-QD', 'DC Withholding Deposit', 'MD Withholding Frequency', 'Quarterly', 'Quarterly', NULL, '20', true, false, 'MyTax.DC.gov', 'https://mytax.dc.gov', '14,7,3', true, 'Added 2026-10-02 from DC''s own published due dates; see complianceCalendar.ts.', 'DC'),
    ('TR-DC-WH-QR', 'DC Withholding Return (FR-900Q)', 'MD Withholding Frequency', 'Quarterly', 'Quarterly', NULL, '31', false, true, 'MyTax.DC.gov', 'https://mytax.dc.gov', '14,7,3', true, 'Added 2026-10-02 from DC''s own published due dates; see complianceCalendar.ts.', 'DC'),
    ('TR-DC-WH-AD', 'DC Withholding Deposit (annual filer)', 'MD Withholding Frequency', 'Annually', 'Annual', '1', '20', true, false, 'MyTax.DC.gov', 'https://mytax.dc.gov', '14,7,3', true, 'Added 2026-10-02 from DC''s own published due dates; see complianceCalendar.ts.', 'DC'),
    ('TR-DC-WH-AR', 'DC Withholding Return (FR-900A)', 'MD Withholding Frequency', 'Annually', 'Annual', '1', '31', false, true, 'MyTax.DC.gov', 'https://mytax.dc.gov', '14,7,3', true, 'Added 2026-10-02 from DC''s own published due dates; see complianceCalendar.ts.', 'DC'),
    ('TR-DC-UI', 'DC UI Wages Filing & Payment', 'MD UI', 'Yes', 'Quarterly', NULL, '31', true, true, 'DOES Employer Self-Service', NULL, '14,7,3', true, 'Added 2026-10-02 from DC''s own published due dates; see complianceCalendar.ts.', 'DC'),
    ('TR-VA-WH-M', 'VA Withholding Filing & Payment', 'MD Withholding Frequency', 'Monthly', 'Monthly', NULL, '25', true, true, 'Virginia Tax Online Services', 'https://www.tax.virginia.gov', '14,7,3', true, 'Added 2026-10-02 from VA''s own published due dates; see complianceCalendar.ts.', 'VA'),
    ('TR-VA-WH-Q', 'VA Withholding Filing & Payment', 'MD Withholding Frequency', 'Quarterly', 'Quarterly', NULL, '31', true, true, 'Virginia Tax Online Services', 'https://www.tax.virginia.gov', '14,7,3', true, 'Added 2026-10-02 from VA''s own published due dates; see complianceCalendar.ts.', 'VA'),
    ('TR-VA-UI', 'VA UI Wages Filing & Payment', 'MD UI', 'Yes', 'Quarterly', NULL, '31', true, true, 'Virginia Employment Commission', 'https://www.vec.virginia.gov', '14,7,3', true, 'Added 2026-10-02 from VA''s own published due dates; see complianceCalendar.ts.', 'VA'),
    ('TR-PA-WH-Q', 'PA Withholding Filing & Payment', 'MD Withholding Frequency', 'Quarterly', 'Quarterly', NULL, '31', true, true, 'PA myPATH', NULL, '14,7,3', true, 'Added 2026-10-02 from PA''s own published due dates; see complianceCalendar.ts.', 'PA'),
    ('TR-PA-WH-M', 'PA Withholding Payment', 'MD Withholding Frequency', 'Monthly', 'Monthly', NULL, '15', true, false, 'PA myPATH', NULL, '14,7,3', true, 'Added 2026-10-02 from PA''s own published due dates; see complianceCalendar.ts.', 'PA'),
    ('TR-PA-WH-MR', 'PA Withholding Quarterly Reconciliation Return', 'MD Withholding Frequency', 'Monthly', 'Quarterly', NULL, '31', false, true, 'PA myPATH', NULL, '14,7,3', true, 'Added 2026-10-02 from PA''s own published due dates; see complianceCalendar.ts.', 'PA'),
    ('TR-PA-UI', 'PA UC Wages Filing & Payment', 'MD UI', 'Yes', 'Quarterly', NULL, '31', true, true, 'PA UC Management System (UCMS)', 'https://www.uctax.pa.gov', '14,7,3', true, 'Added 2026-10-02 from PA''s own published due dates; see complianceCalendar.ts.', 'PA'),
    ('TR-DE-WH-M', 'DE Withholding Filing & Payment', 'MD Withholding Frequency', 'Monthly', 'Monthly', NULL, '15', true, true, 'Delaware Division of Revenue', NULL, '14,7,3', true, 'Added 2026-10-02 from DE''s own published due dates; see complianceCalendar.ts.', 'DE'),
    ('TR-DE-WH-Q', 'DE Withholding Filing & Payment', 'MD Withholding Frequency', 'Quarterly', 'Quarterly', NULL, '31', true, true, 'Delaware Division of Revenue', NULL, '14,7,3', true, 'Added 2026-10-02 from DE''s own published due dates; see complianceCalendar.ts.', 'DE'),
    ('TR-DE-UI', 'DE UI Wages Filing & Payment', 'MD UI', 'Yes', 'Quarterly', NULL, '31', true, true, 'DE Online Employer Services', 'https://oes.delawareworks.com', '14,7,3', true, 'Added 2026-10-02 from DE''s own published due dates; see complianceCalendar.ts.', 'DE'),
    ('TR-VA-REC-M', 'VA Annual Withholding Reconciliation (VA-6)', 'MD Withholding Frequency', 'Monthly', 'Annual', '1', '31', false, true, 'Virginia Tax Online Services', NULL, '14,7,3', true, 'Added 2026-10-02 from VA''s own published due dates; see complianceCalendar.ts.', 'VA'),
    ('TR-VA-REC-Q', 'VA Annual Withholding Reconciliation (VA-6)', 'MD Withholding Frequency', 'Quarterly', 'Annual', '1', '31', false, true, 'Virginia Tax Online Services', NULL, '14,7,3', true, 'Added 2026-10-02 from VA''s own published due dates; see complianceCalendar.ts.', 'VA'),
    ('TR-VA-REC-S', 'VA Annual Withholding Reconciliation (VA-6)', 'MD Withholding Frequency', 'Semiannual', 'Annual', '1', '31', false, true, 'Virginia Tax Online Services', NULL, '14,7,3', true, 'Added 2026-10-02 from VA''s own published due dates; see complianceCalendar.ts.', 'VA'),
    ('TR-VA-REC-A', 'VA Annual Withholding Reconciliation (VA-6)', 'MD Withholding Frequency', 'Annually', 'Annual', '1', '31', false, true, 'Virginia Tax Online Services', NULL, '14,7,3', true, 'Added 2026-10-02 from VA''s own published due dates; see complianceCalendar.ts.', 'VA'),
    ('TR-PA-REC-M', 'PA Annual Withholding Reconciliation (REV-1667)', 'MD Withholding Frequency', 'Monthly', 'Annual', '1', '31', false, true, 'PA myPATH', NULL, '14,7,3', true, 'Added 2026-10-02 from PA''s own published due dates; see complianceCalendar.ts.', 'PA'),
    ('TR-PA-REC-Q', 'PA Annual Withholding Reconciliation (REV-1667)', 'MD Withholding Frequency', 'Quarterly', 'Annual', '1', '31', false, true, 'PA myPATH', NULL, '14,7,3', true, 'Added 2026-10-02 from PA''s own published due dates; see complianceCalendar.ts.', 'PA'),
    ('TR-PA-REC-S', 'PA Annual Withholding Reconciliation (REV-1667)', 'MD Withholding Frequency', 'Semiannual', 'Annual', '1', '31', false, true, 'PA myPATH', NULL, '14,7,3', true, 'Added 2026-10-02 from PA''s own published due dates; see complianceCalendar.ts.', 'PA'),
    ('TR-PA-REC-A', 'PA Annual Withholding Reconciliation (REV-1667)', 'MD Withholding Frequency', 'Annually', 'Annual', '1', '31', false, true, 'PA myPATH', NULL, '14,7,3', true, 'Added 2026-10-02 from PA''s own published due dates; see complianceCalendar.ts.', 'PA'),
    ('TR-DE-REC-M', 'DE Annual Withholding Reconciliation (WTH-REC)', 'MD Withholding Frequency', 'Monthly', 'Annual', '1', '31', false, true, 'Delaware Division of Revenue', NULL, '14,7,3', true, 'Added 2026-10-02 from DE''s own published due dates; see complianceCalendar.ts.', 'DE'),
    ('TR-DE-REC-Q', 'DE Annual Withholding Reconciliation (WTH-REC)', 'MD Withholding Frequency', 'Quarterly', 'Annual', '1', '31', false, true, 'Delaware Division of Revenue', NULL, '14,7,3', true, 'Added 2026-10-02 from DE''s own published due dates; see complianceCalendar.ts.', 'DE'),
    ('TR-DE-REC-S', 'DE Annual Withholding Reconciliation (WTH-REC)', 'MD Withholding Frequency', 'Semiannual', 'Annual', '1', '31', false, true, 'Delaware Division of Revenue', NULL, '14,7,3', true, 'Added 2026-10-02 from DE''s own published due dates; see complianceCalendar.ts.', 'DE'),
    ('TR-DE-REC-A', 'DE Annual Withholding Reconciliation (WTH-REC)', 'MD Withholding Frequency', 'Annually', 'Annual', '1', '31', false, true, 'Delaware Division of Revenue', NULL, '14,7,3', true, 'Added 2026-10-02 from DE''s own published due dates; see complianceCalendar.ts.', 'DE')
ON CONFLICT (rule_id) DO NOTHING;
