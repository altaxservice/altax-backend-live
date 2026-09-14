-- DC FR-800 sales tax late penalty/interest rates, sourced from DC OTR's
-- sales-and-use-tax FAQ and the FR-800M return's own printed instructions
-- ("H. PENALTY AND INTEREST CHARGES"), 2026-09-14. See dcFiling.ts's header
-- comment for the full sourcing. Unlike MD, DC has no timely-filing
-- discount at all -- the Tax Clarity Act of 2001 eliminated it -- so there
-- are no discount rows here, only penalty + interest.
INSERT INTO altax.v3_tax_rates (rate_id, scope, client_id, client_name, rate_type, rate, state, active, notes)
VALUES
  ('DC-SUT-LATE-PENALTY-MONTHLY', 'Global', NULL, NULL, 'DC Late Filing/Payment Penalty (per month)', 0.05, 'DC', true,
   '5% per month or fraction of a month on unpaid tax, from the FR-800 return''s own instructions ("H(a)"). Compounds by months late, unlike MD''s flat one-time penalty.'),
  ('DC-SUT-LATE-PENALTY-CAP', 'Global', NULL, NULL, 'DC Late Penalty Maximum (% of tax due)', 0.25, 'DC', true,
   'The monthly penalty above never exceeds this percent of the tax due, per FR-800 instructions ("shall not exceed 25 percent of the tax due").'),
  ('DC-SUT-INTEREST-MONTHLY', 'Global', NULL, NULL, 'DC Late Payment Interest (per month)', 0.015, 'DC', true,
   '1.5% per month or fraction of a month on unpaid tax after the due date, "without regard to any extension," per FR-800 instructions ("H(c)").')
ON CONFLICT DO NOTHING;
