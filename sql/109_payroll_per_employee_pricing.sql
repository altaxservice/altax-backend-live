-- Per-employee/per-worker pricing for the Subscription Fee Schedule —
-- direct owner request, 2026-08-26. Owner's reasoning: Payroll Processing
-- can't actually be delivered without also doing the tax deposits,
-- withholding filing, EFTPS, and UI filing — those are already their own
-- priced line items, so a separate FLAT number for "Payroll Processing"
-- double-counts work already priced elsewhere. What Payroll Processing
-- really represents is the labor of cutting paychecks each cycle, which is
-- inherently headcount-driven — same for W-2/1099 Preparation, which is
-- literally one form per person.
--
-- pricing_unit: 'flat' (unchanged behavior — every existing service) |
-- 'per_employee' (min_fee is a $/employee/mo rate, multiplied by the
-- client's actual W-2 employee count, EXCLUDING 1099 contractors — they
-- aren't run through payroll) | 'per_worker' (min_fee is a $/mo rate per
-- person, multiplied by ALL workers on file, employees AND contractors,
-- since every one of them needs either a W-2 or a 1099).
ALTER TABLE altax.v3_service_catalog
    ADD COLUMN IF NOT EXISTS pricing_unit VARCHAR(20) NOT NULL DEFAULT 'flat'
        CHECK (pricing_unit IN ('flat', 'per_employee', 'per_worker'));

-- min_fee is reset to NULL for both, not carried over from the old flat
-- rate — a flat $/mo number and a $/employee/mo rate are not the same
-- quantity, and silently reinterpreting one as the other could badly
-- over- or under-charge a client the next time their services are saved.
-- Set the real per-unit rate directly in the Subscription Fee Schedule.
UPDATE altax.v3_service_catalog SET pricing_unit = 'per_employee', min_fee = NULL WHERE service_key = 'payroll';
UPDATE altax.v3_service_catalog SET pricing_unit = 'per_worker', min_fee = NULL WHERE service_key = 'w2_1099';
