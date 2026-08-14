-- AUTO-011 (hard audit, 2026-08-13): moves the hardcoded $600 1099-NEC
-- reporting threshold into v3_tax_rates, consistent with every other rate in
-- accounting.routes.ts. Mirrors the same row DEFAULT_TAX_RATES in
-- system.routes.ts's /seed-defaults would create on a fresh deployment.
INSERT INTO altax.v3_tax_rates (rate_id, scope, rate_type, rate, wage_cap, active, notes)
VALUES ('1099_THRESHOLD', 'Global', '1099-NEC Reporting Threshold', 0, 600,
        true, 'IRS reporting threshold — not a hard block; a firm may still issue a 1099-NEC below this if backup withholding applies. Statutory, stable for decades.')
ON CONFLICT (rate_id, scope, COALESCE(client_id, ''), COALESCE(state, '')) DO NOTHING;
