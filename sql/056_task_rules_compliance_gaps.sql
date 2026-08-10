-- Fills real gaps found in altax.v3_task_rules while generalizing the client
-- flag system beyond MD Sales Tax (per user request 2026-08-09: EFTPS, MD
-- Withholding, MD UI, MD Annual Report, and Business Tax Return should all
-- auto-flag when overdue and auto-clear once marked done, the same way MD
-- Sales Tax already does).
--
-- Investigation found the Task Rules Agent engine (src/modules/rules/rules.routes.ts)
-- and the generic AgencyPastDue flag source (computeClientFlags() in
-- clients.routes.ts) were already fully built and already wired to real
-- client columns (eftps_enabled, md_withholding_frequency, mdui_enabled,
-- md_annual_report_enabled, business_return_type) — 21 rules already existed
-- (TR-001 through TR-019, plus TR-005A/TR-014Q variants). The real gaps:
--
-- 1. MD Withholding Payment (TR-015) only covers Monthly filers, but every
--    real client on file uses Quarterly (54 of them) — TR-015 has never once
--    matched a real client. TR-015Q closes this; TR-015S/TR-015A added for
--    completeness (no client currently on those frequencies, but the same
--    gap TR-015 had would otherwise recur the moment one signs up).
-- 2. MD Withholding Filing (TR-014/TR-014Q) has no Semiannual/Annually
--    counterpart — TR-014S/TR-014A close this (same "matches nobody yet,
--    matches the day it's needed" reasoning).
-- 3. No rule exists at all for the MW508 annual reconciliation (due Jan 31,
--    separate from the periodic MW506 filing/payment) — TR-020/Q/S/A add it,
--    one per underlying filing frequency since a single rule can only match
--    one trigger_value.
-- 4. Business Return Type "1120S" and "1065" (S-Corp / Partnership, due
--    March 15) have no rule at all — only "1120" (TR-011) and "Schedule C"
--    (TR-017) do. TR-021/TR-022 close this.
--
-- Deliberate deviation from the existing Filing/Payment convention (Filing
-- rules normally have payment_required=false, since a separate Payment rule
-- carries the actual flag): Business Return rules (TR-011, TR-017, and the
-- two new ones below) have no Payment-type sibling anywhere in this system,
-- so as configured they can NEVER trigger the AgencyPastDue flag no matter
-- how overdue — silently defeating the exact behavior the user asked for.
-- Since the return itself is the money-relevant deadline here (tax due WITH
-- the return, no separate deposit), TR-011 and TR-017 are corrected to
-- payment_required=true below, and the two new rules match that. Same
-- reasoning applies to the new MW508 reconciliation rules — no Payment
-- sibling exists for it either, so it also gets payment_required=true.
--
-- All new rules ship active=true — the Task Rules Agent's own draft/approve
-- gate (v3_task_batch_drafts, staff must approve before any real task is
-- created) is the safety net, matching how every other rule in this table
-- already works.

-- Fix: Business Return rules can never flag as configured (see above).
UPDATE altax.v3_task_rules SET payment_required = true, updated_at = now() WHERE rule_id IN ('TR-011', 'TR-017');

INSERT INTO altax.v3_task_rules
  (rule_id, task_type, trigger_column, trigger_value, frequency, period_type, due_month, due_day,
   payment_required, requires_filing, portal_name, warning_days, active, notes, portal_url)
VALUES
  ('TR-014S', 'MD Withholding Filing', 'MD Withholding Frequency', 'Semiannual', 'Semiannual', NULL, '1', '15',
   false, true, 'Maryland Tax Connect', '14,7,3', true, 'Added 2026-08-09 — no client on this frequency yet; keeps the rule set complete for the day one signs up.', NULL),
  ('TR-014A', 'MD Withholding Filing', 'MD Withholding Frequency', 'Annually', 'Annual', NULL, '1', '15',
   false, true, 'Maryland Tax Connect', '14,7,3', true, 'Added 2026-08-09 — no client on this frequency yet; keeps the rule set complete for the day one signs up.', NULL),

  ('TR-015Q', 'MD Withholding Payment', 'MD Withholding Frequency', 'Quarterly', 'Quarterly', NULL, NULL, '15',
   true, false, 'MD Tax Connect', '14,7,3', true, 'Added 2026-08-09 — TR-015 only covers Monthly, but every real MD-withholding client is Quarterly; this is the actual gap that kept these clients invisible to the flag system.', NULL),
  ('TR-015S', 'MD Withholding Payment', 'MD Withholding Frequency', 'Semiannual', 'Semiannual', NULL, '1', '15',
   true, false, 'MD Tax Connect', '14,7,3', true, 'Added 2026-08-09 — no client on this frequency yet; keeps the rule set complete for the day one signs up.', NULL),
  ('TR-015A', 'MD Withholding Payment', 'MD Withholding Frequency', 'Annually', 'Annual', NULL, '1', '15',
   true, false, 'MD Tax Connect', '14,7,3', true, 'Added 2026-08-09 — no client on this frequency yet; keeps the rule set complete for the day one signs up.', NULL),

  ('TR-020', 'MD Withholding Annual Reconciliation', 'MD Withholding Frequency', 'Monthly', 'Annual', NULL, '1', '31',
   true, true, 'Maryland Tax Connect', '30,14,7', true, 'Added 2026-08-09 — MW508 annual reconciliation, due Jan 31, separate from the periodic MW506 filing/payment. No client on Monthly withholding today, kept for completeness.', NULL),
  ('TR-020Q', 'MD Withholding Annual Reconciliation', 'MD Withholding Frequency', 'Quarterly', 'Annual', NULL, '1', '31',
   true, true, 'Maryland Tax Connect', '30,14,7', true, 'Added 2026-08-09 — MW508 annual reconciliation for the 54 real Quarterly MD-withholding clients on file.', NULL),
  ('TR-020S', 'MD Withholding Annual Reconciliation', 'MD Withholding Frequency', 'Semiannual', 'Annual', NULL, '1', '31',
   true, true, 'Maryland Tax Connect', '30,14,7', true, 'Added 2026-08-09 — no client on this frequency yet; kept for completeness.', NULL),
  ('TR-020A', 'MD Withholding Annual Reconciliation', 'MD Withholding Frequency', 'Annually', 'Annual', NULL, '1', '31',
   true, true, 'Maryland Tax Connect', '30,14,7', true, 'Added 2026-08-09 — no client on this frequency yet; kept for completeness.', NULL),

  ('TR-021', '1120S Return', 'Business Return Type', '1120S', 'Annual', NULL, '3', '15',
   true, true, 'Drake', '30,14,7', true, 'Added 2026-08-09 — S-Corp business return, due March 15 (15th day of the 3rd month after calendar year-end). 77 real clients have business_return_type=1120S (the single largest business-return segment, more than 1120 and Schedule C combined) and had zero task-rule coverage before this.', NULL),
  ('TR-022', '1065 Return', 'Business Return Type', '1065', 'Annual', NULL, '3', '15',
   true, true, 'Drake', '30,14,7', true, 'Added 2026-08-09 — Partnership business return, due March 15 (15th day of the 3rd month after calendar year-end). No 1065 client on file yet; kept for completeness alongside TR-011 (1120)/TR-017 (Schedule C).', NULL)
ON CONFLICT (rule_id) DO NOTHING;
