-- ---------------------------------------------------------------------------
-- Maryland Form 202 Line 37b late-payment interest rate, stored the same way
-- SUTA/state-withholding rates already are (a Global v3_tax_rates row) so the
-- firm can update it every January when the Comptroller republishes a new
-- rate, without a code deploy. Source: Comptroller's own 2026 Form 202
-- instructions (COM RAD 098) — "interest is calculated at a rate of 0.9011%
-- per month or fraction of a month," effective January 1 - December 31, 2026.
-- ---------------------------------------------------------------------------
INSERT INTO v3_tax_rates (rate_id, scope, client_id, client_name, rate_type, rate, state, active, notes)
VALUES ('MD-SUT-INTEREST-MONTHLY', 'Global', NULL, NULL, 'MD Sales Tax Late Interest (Monthly)', 0.009011, 'MD', true,
        'Form 202 Line 37b — effective Jan 1 - Dec 31, 2026 per Comptroller instructions (COM RAD 098). Update every January.')
ON CONFLICT DO NOTHING;
