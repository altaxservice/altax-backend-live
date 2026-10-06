-- Taxable wage bases per imported paycheck, so a month's Social Security and Medicare can be
-- computed the way Drake does it (rate x the period's total wages, rounded once) and match its
-- Tax Liability report to the cent. Nullable: rows imported before this column existed are
-- filled in when the same Payroll Wages file is imported again.
ALTER TABLE altax.v3_eftps_paycheck_import ADD COLUMN IF NOT EXISTS social_security_wages NUMERIC(14,2);
ALTER TABLE altax.v3_eftps_paycheck_import ADD COLUMN IF NOT EXISTS medicare_wages NUMERIC(14,2);
