-- Makes a true duplicate EFTPS import structurally impossible at the database
-- level, instead of relying on a UI checkbox + confirm dialog a busy user can
-- click through repeatedly. Confirmed live on client C-1005: the same Drake
-- "Payroll Wages" file got re-imported into altax.v3_eftps_paycheck_import
-- three separate times over a few hours despite the app-level dedup check and
-- a confirmation dialog, doubling (then tripling) every federal deposit total
-- until cleaned up by hand each time. A unique index + ON CONFLICT DO NOTHING
-- (paychecks are immutable historical facts — a true duplicate should always
-- be silently ignored) removes the entire bug class regardless of what the
-- frontend does. Uses check_number normalized via COALESCE(check_number, '')
-- since the column is nullable and NULL <> NULL would otherwise let two
-- genuinely identical no-check-number rows both insert.

CREATE UNIQUE INDEX IF NOT EXISTS uq_eftps_paycheck_import_key
  ON altax.v3_eftps_paycheck_import (client_id, employee_name, pay_date, COALESCE(check_number, ''));

-- Tax Liability snapshots aren't summed the way paychecks are (only the
-- latest is used for reconciliation), so a duplicate snapshot was never a
-- financial-correctness bug — but it's still pure clutter and the same
-- accidental-re-import pattern applies. Upsert (refresh the numbers on the
-- same range) is friendlier here than silently dropping a corrected re-import.
CREATE UNIQUE INDEX IF NOT EXISTS uq_eftps_tax_liability_import_key
  ON altax.v3_eftps_tax_liability_import (client_id, range_start, range_end);
