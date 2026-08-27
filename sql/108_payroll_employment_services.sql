-- Two new billable line items under "Payroll & Employment" — direct owner
-- decision, 2026-08-26, closing a real pricing gap: the compliance-reminder
-- system already tracks "Federal Payroll Tax" (941) and "MD Withholding" as
-- ongoing filing obligations per client (v3_clients.md_withholding_frequency,
-- REMINDABLE_SOURCES in complianceReminders.ts), but neither had a matching
-- priced line item here — that work was either silently bundled into
-- Payroll Processing's $175/mo base fee or done with no price on it at all.
--
-- Both are 'addon' role (like eftps/mdui/w2_1099 already are) — they add to
-- a client's subscription price but don't affect subscription tier; 'payroll'
-- (Payroll Processing) stays the sole payroll core_pillar, per the owner's
-- explicit choice to keep it as the base "we run your payroll" fee with
-- these as add-ons on top. min_fee is left NULL/unset here on purpose — set
-- the real price for each in the Subscription Fee Schedule table.
INSERT INTO altax.v3_service_catalog (service_key, label, group_name, role, min_fee, sort_order, active, legacy) VALUES
    ('federal_payroll_tax_941', 'Federal Payroll Tax (941) Filing', 'Payroll & Employment', 'addon', NULL, 45, true, false),
    ('md_withholding_filing', 'MD Withholding Filing', 'Payroll & Employment', 'addon', NULL, 47, true, false)
ON CONFLICT (service_key) DO NOTHING;
