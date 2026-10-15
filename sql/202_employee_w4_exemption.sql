-- W-4 "Exempt from withholding" election, mirrored onto the employee record when an exempt W-4 is signed
-- (see govForms.routes.ts syncEmployeeW4Exemption). Payroll reads these two columns:
-- calculateFederalWithholding() withholds $0 federal income tax while the exemption is in force, i.e. for
-- wages paid from Jan 1 of federal_w4_exempt_year through Feb 15 of the following year (Treas. Reg.
-- 31.3402(f)(4)-1(b)); after that it withholds normally and staff see a warning that a new W-4 is needed.
-- Apply before the new code is deployed. Safe to run more than once.
ALTER TABLE altax.v3_employees ADD COLUMN IF NOT EXISTS federal_w4_exempt BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE altax.v3_employees ADD COLUMN IF NOT EXISTS federal_w4_exempt_year INTEGER;
