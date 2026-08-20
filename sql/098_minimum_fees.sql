-- Minimum Fee Schedule (Firm Command Center gap analysis, item #21,
-- Pricing & Fee Analysis) — real admin-editable floors per service, given
-- to the app owner directly (2026-08-20) rather than sourced from the
-- pre-existing v3_products_services table (checked and found too thin/
-- stale — 6 rows, duplicates, no real coverage of the firm's actual
-- core services).
--
-- service_key matches FIRM_SERVICES keys in clientOptions.ts (sales_tax,
-- payroll, bookkeeping, business_tax_prep, personal_tax_prep) so a row here
-- can be matched directly against v3_clients.services[]. 'other' is a free
-- slot for anything not in that list — the user asked for exactly this.
--
-- variant handles Sales Tax Filing's real fee-by-filing-frequency structure
-- ($53 Monthly / $78 Quarterly / $128 Semiannual) — NULL for every other
-- service, which is flat. per_unit_fee/per_unit_threshold/per_unit_label
-- handle Payroll's real structure ($150 covers 2 employees, +$25 per
-- additional) — NULL for every flat service.
CREATE TABLE IF NOT EXISTS altax.v3_minimum_fees (
    min_fee_id VARCHAR(64) PRIMARY KEY,
    service_key VARCHAR(64) NOT NULL,
    label VARCHAR(255) NOT NULL,
    variant VARCHAR(64),
    base_fee NUMERIC(14,2) NOT NULL,
    per_unit_fee NUMERIC(14,2),
    per_unit_threshold INTEGER,
    per_unit_label VARCHAR(64),
    billing_cadence VARCHAR(16) NOT NULL DEFAULT 'monthly', -- monthly | annual | per_period (sales tax's own filing frequency IS the cadence)
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (service_key, variant)
);

INSERT INTO altax.v3_minimum_fees (min_fee_id, service_key, label, variant, base_fee, billing_cadence, created_by) VALUES
    ('MINFEE-SEED-1', 'sales_tax', 'Sales Tax Filing', 'Monthly', 53.00, 'per_period', 'system-seed'),
    ('MINFEE-SEED-2', 'sales_tax', 'Sales Tax Filing', 'Quarterly', 78.00, 'per_period', 'system-seed'),
    ('MINFEE-SEED-3', 'sales_tax', 'Sales Tax Filing', 'Semiannual', 128.00, 'per_period', 'system-seed'),
    ('MINFEE-SEED-5', 'bookkeeping', 'Bookkeeping', NULL, 400.00, 'monthly', 'system-seed'),
    ('MINFEE-SEED-6', 'business_tax_prep', 'Business Tax Return', NULL, 350.00, 'annual', 'system-seed'),
    ('MINFEE-SEED-7', 'personal_tax_prep', 'Individual Tax Return', NULL, 200.00, 'annual', 'system-seed')
ON CONFLICT (service_key, variant) DO NOTHING;

INSERT INTO altax.v3_minimum_fees (min_fee_id, service_key, label, variant, base_fee, per_unit_fee, per_unit_threshold, per_unit_label, billing_cadence, created_by) VALUES
    ('MINFEE-SEED-4', 'payroll', 'Payroll Processing', NULL, 150.00, 25.00, 2, 'employee', 'monthly', 'system-seed')
ON CONFLICT (service_key, variant) DO NOTHING;
