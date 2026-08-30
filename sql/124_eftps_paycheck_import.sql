-- Reworks the EFTPS deposit workflow to match the existing Sales Tax import
-- pattern (v3_sales_input) — direct owner ask, 2026-08-29: import raw dated
-- records whenever, review/save by any period afterward, computed live from
-- what's actually stored. Replaces the original "upload must match the
-- exact selected period" design, which silently summed a whole-year Drake
-- export as if it were one month's deposit.
--
-- One row per paycheck (mirrors v3_sales_input's "one row per day"). Dedup
-- is application-level, same convention as the sales importer: checked
-- before insert, a re-imported paycheck is skipped, not duplicated or
-- overwritten.
CREATE TABLE IF NOT EXISTS altax.v3_eftps_paycheck_import (
    id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    employee_name VARCHAR(255) NOT NULL,
    pay_date DATE NOT NULL,
    check_number VARCHAR(64),
    federal_withheld NUMERIC(14,2) NOT NULL DEFAULT 0,
    social_security_withheld NUMERIC(14,2) NOT NULL DEFAULT 0,
    medicare_withheld NUMERIC(14,2) NOT NULL DEFAULT 0,
    source_system VARCHAR(255),
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eftps_paycheck_import_client_date ON altax.v3_eftps_paycheck_import (client_id, pay_date);

-- One row per Tax Liability file imported — it's a company-wide aggregate
-- for whatever range Drake generated it, not a per-day series, so one
-- snapshot per upload rather than a row per paycheck. Used only as a
-- best-effort reconciliation reference when its range happens to exactly
-- match a reviewed period — never required, never blocking.
CREATE TABLE IF NOT EXISTS altax.v3_eftps_tax_liability_import (
    id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    range_start DATE NOT NULL,
    range_end DATE NOT NULL,
    federal_income_tax NUMERIC(14,2) NOT NULL DEFAULT 0,
    social_security NUMERIC(14,2) NOT NULL DEFAULT 0,
    medicare NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_941 NUMERIC(14,2) NOT NULL DEFAULT 0,
    imported_by VARCHAR(255) NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eftps_tax_liability_import_client_range ON altax.v3_eftps_tax_liability_import (client_id, range_start, range_end);
