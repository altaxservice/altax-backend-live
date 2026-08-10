-- Merges 5 Filing+Payment rule pairs into single combined rules, per firm
-- confirmation 2026-08-09: filing and payment for these obligations are
-- submitted together in one portal session in practice, so tracking them as
-- 2 separate rules (2 batches, 2 approvals) for one real action was pure
-- overhead. Mirrors the pattern already proven by TR-011/TR-013/TR-017/
-- TR-020-family/TR-021/TR-022 (one row, payment_required=true AND
-- requires_filing=true) -- v3_tasks already has independent filed_date and
-- paid_date columns on one row, so nothing is lost even if the two happen on
-- different days occasionally.
--
-- Frequency tiers are NOT touched -- Monthly/Quarterly/Semiannual/Annual
-- remain fully separate rules and separate batches, exactly as before. Only
-- Filing+Payment within each tier are combined.
--
-- The surviving rule (previously "Filing") absorbs the Payment rule's
-- payment_required flag. The retired rule is deactivated, not deleted, so
-- its rule_id stays valid for any historical v3_tasks/v3_task_batches rows
-- that reference it. approveBatchDraft() re-reads the rule fresh from
-- v3_task_rules at approval time (not cached from when the draft was
-- drafted), so any already-pending draft against a surviving rule_id will
-- automatically pick up the new merged behavior on Approve; any pending
-- draft against a now-retired rule_id will cleanly fail to approve
-- ("This rule has since been deactivated") rather than silently
-- misbehaving -- it should just be Dismissed.

-- Sales Tax, Monthly: TR-001 (Filing) absorbs TR-002 (Payment)
UPDATE altax.v3_task_rules SET task_type = 'Sales Tax Filing & Payment', payment_required = true, requires_filing = true,
  notes = 'Monthly sales tax filing & payment (merged from TR-001/TR-002 2026-08-09 -- filed and paid together via MD Tax Connect)', updated_at = now()
  WHERE rule_id = 'TR-001';
UPDATE altax.v3_task_rules SET active = false,
  notes = 'Retired 2026-08-09 -- merged into TR-001 (Sales Tax Filing & Payment, Monthly)', updated_at = now()
  WHERE rule_id = 'TR-002';

-- Sales Tax, Quarterly: TR-003 (Filing) absorbs TR-004 (Payment)
UPDATE altax.v3_task_rules SET task_type = 'Sales Tax Filing & Payment', payment_required = true, requires_filing = true,
  notes = 'Quarterly sales tax filing & payment (merged from TR-003/TR-004 2026-08-09)', updated_at = now()
  WHERE rule_id = 'TR-003';
UPDATE altax.v3_task_rules SET active = false,
  notes = 'Retired 2026-08-09 -- merged into TR-003 (Sales Tax Filing & Payment, Quarterly)', updated_at = now()
  WHERE rule_id = 'TR-004';

-- MD Annual Report: TR-007 (Filing) absorbs TR-008 (Payment)
UPDATE altax.v3_task_rules SET task_type = 'MD Annual Report Filing & Payment', payment_required = true, requires_filing = true,
  notes = 'MD Annual Report filing & payment (merged from TR-007/TR-008 2026-08-09)', updated_at = now()
  WHERE rule_id = 'TR-007';
UPDATE altax.v3_task_rules SET active = false,
  notes = 'Retired 2026-08-09 -- merged into TR-007 (MD Annual Report Filing & Payment)', updated_at = now()
  WHERE rule_id = 'TR-008';

-- MD UI Wages, Quarterly: TR-009 (Filing) absorbs TR-010 (Payment)
UPDATE altax.v3_task_rules SET task_type = 'MD UI Wages Filing & Payment', payment_required = true, requires_filing = true,
  notes = 'MD UI wages filing & payment (merged from TR-009/TR-010 2026-08-09)', updated_at = now()
  WHERE rule_id = 'TR-009';
UPDATE altax.v3_task_rules SET active = false,
  notes = 'Retired 2026-08-09 -- merged into TR-009 (MD UI Wages Filing & Payment)', updated_at = now()
  WHERE rule_id = 'TR-010';

-- MD Withholding, Monthly: TR-014 (Filing) absorbs TR-015 (Payment)
UPDATE altax.v3_task_rules SET task_type = 'MD Withholding Filing & Payment', payment_required = true, requires_filing = true,
  notes = 'Monthly MD withholding filing & payment (merged from TR-014/TR-015 2026-08-09)', updated_at = now()
  WHERE rule_id = 'TR-014';
UPDATE altax.v3_task_rules SET active = false,
  notes = 'Retired 2026-08-09 -- merged into TR-014 (MD Withholding Filing & Payment, Monthly)', updated_at = now()
  WHERE rule_id = 'TR-015';

-- MD Withholding, Quarterly: TR-014Q (Filing) absorbs TR-015Q (Payment)
UPDATE altax.v3_task_rules SET task_type = 'MD Withholding Filing & Payment', payment_required = true, requires_filing = true,
  notes = 'Quarterly MD withholding filing & payment (merged from TR-014Q/TR-015Q 2026-08-09)', updated_at = now()
  WHERE rule_id = 'TR-014Q';
UPDATE altax.v3_task_rules SET active = false,
  notes = 'Retired 2026-08-09 -- merged into TR-014Q (MD Withholding Filing & Payment, Quarterly)', updated_at = now()
  WHERE rule_id = 'TR-015Q';

-- MD Withholding, Semiannual: TR-014S (Filing) absorbs TR-015S (Payment)
UPDATE altax.v3_task_rules SET task_type = 'MD Withholding Filing & Payment', payment_required = true, requires_filing = true,
  notes = 'Semiannual MD withholding filing & payment (merged from TR-014S/TR-015S 2026-08-09)', updated_at = now()
  WHERE rule_id = 'TR-014S';
UPDATE altax.v3_task_rules SET active = false,
  notes = 'Retired 2026-08-09 -- merged into TR-014S (MD Withholding Filing & Payment, Semiannual)', updated_at = now()
  WHERE rule_id = 'TR-015S';

-- MD Withholding, Annual: TR-014A (Filing) absorbs TR-015A (Payment)
UPDATE altax.v3_task_rules SET task_type = 'MD Withholding Filing & Payment', payment_required = true, requires_filing = true,
  notes = 'Annual MD withholding filing & payment (merged from TR-014A/TR-015A 2026-08-09)', updated_at = now()
  WHERE rule_id = 'TR-014A';
UPDATE altax.v3_task_rules SET active = false,
  notes = 'Retired 2026-08-09 -- merged into TR-014A (MD Withholding Filing & Payment, Annual)', updated_at = now()
  WHERE rule_id = 'TR-015A';
