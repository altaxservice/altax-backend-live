-- Corrects DC FR-800 late-payment interest. sql/153 seeded it as a flat 1.5%
-- per month, but DC OTR's own 2025 FR-800M instructions and its Sales and Use
-- Tax FAQ both say "Interest of 10% per year, compounded daily, on a late
-- payment." dcFiling.ts now reads this annual row and compounds daily; the old
-- monthly row is deactivated (not deleted) so the correction stays auditable.
INSERT INTO altax.v3_tax_rates (rate_id, scope, client_id, client_name, rate_type, rate, state, active, notes)
VALUES
  ('DC-SUT-INTEREST-ANNUAL', 'Global', NULL, NULL, 'DC Late Payment Interest (per year, compounded daily)', 0.10, 'DC', true,
   '10% per year, compounded daily, on unpaid tax from the due date -- DC OTR 2025 FR-800M instructions and Sales and Use Tax FAQ. Charged on the tax only, not the penalty.')
ON CONFLICT DO NOTHING;

UPDATE altax.v3_tax_rates
   SET active = false,
       notes = COALESCE(notes, '') || ' [Superseded 2026-10-02 by DC-SUT-INTEREST-ANNUAL: DC interest is 10%/year compounded daily, not 1.5%/month.]'
 WHERE rate_id = 'DC-SUT-INTEREST-MONTHLY' AND state = 'DC';
