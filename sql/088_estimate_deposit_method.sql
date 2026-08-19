-- deposit_date already existed (002_estimates.sql) but was never exposed in
-- the UI; deposit_method is new — how the deposit was actually collected
-- (Cash/Check/Zelle/Card/ACH/Wire/Other), same option set as invoice
-- payments (frontend/src/pages/InvoicesListPage.tsx's METHODS).
ALTER TABLE altax.v3_estimates
  ADD COLUMN IF NOT EXISTS deposit_method VARCHAR(32);
