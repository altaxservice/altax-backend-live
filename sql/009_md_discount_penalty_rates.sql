-- ---------------------------------------------------------------------------
-- Maryland Form 202 Line 18 (timely discount) and Line 37a (late penalty)
-- parameters, stored as v3_tax_rates rows so they're editable through the
-- same Accounting -> Tax Rates screen the interest rate (MD-SUT-INTEREST-
-- MONTHLY, sql/008) already uses, instead of hardcoded constants.
--
-- wage_cap is reused here (the same column FUTA/SUTA/Social Security already
-- use for their own dollar ceilings, and the Tax Rates screen already
-- renders as "Cap $X.XX") to carry each row's dollar figure:
--   - MD-SUT-DISCOUNT-LOW.wage_cap  = the $6,000 tier threshold
--   - MD-SUT-DISCOUNT-HIGH.wage_cap = the $18 flat add-on above that threshold
--   - MD-SUT-DISCOUNT-CAP.wage_cap  = the $500 maximum discount; its `rate`
--     is unused (0) since this row has no percentage meaning at all -- an
--     earlier version of this migration put $500 directly in `rate`, which
--     the admin screen rendered as "50000.00%" (it always displays rate as
--     a percentage), so it was moved to wage_cap for a correct display.
-- ---------------------------------------------------------------------------
INSERT INTO v3_tax_rates (rate_id, scope, client_id, client_name, rate_type, rate, wage_cap, state, active, notes)
VALUES
  ('MD-SUT-LATE-PENALTY', 'Global', NULL, NULL, 'MD Late Filing Penalty (Line 37a)', 0.10, NULL, 'MD', true,
   'Flat penalty percent applied to tax due when a Form 202 return is filed/paid after its due date.'),
  ('MD-SUT-DISCOUNT-LOW', 'Global', NULL, NULL, 'MD Timely Discount - Rate at/under Threshold (Line 18)', 0.012, 6000, 'MD', true,
   'Applies when tax due <= wage_cap (the $6,000 threshold). Discount = tax due x this rate.'),
  ('MD-SUT-DISCOUNT-HIGH', 'Global', NULL, NULL, 'MD Timely Discount - Rate above Threshold + Flat Add (Line 18)', 0.009, 18, 'MD', true,
   'Applies when tax due > MD-SUT-DISCOUNT-LOW.wage_cap. Discount = tax due x this rate, plus wage_cap here as a flat dollar add-on.'),
  ('MD-SUT-DISCOUNT-CAP', 'Global', NULL, NULL, 'MD Timely Discount - Maximum $ (Line 18)', 0, 500, 'MD', true,
   'rate is unused (0) -- wage_cap holds the $500 maximum discount the computed discount can never exceed.')
ON CONFLICT DO NOTHING;
