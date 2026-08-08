-- Maryland Unemployment Insurance employer account number and the client's own
-- experience-rated UI tax rate (assigned by MD Dept of Labor, varies per employer —
-- distinct from the firm-wide default SUTA rate in v3_tax_rates). Stored as a
-- PERCENT value (e.g. 2.600 = 2.60%), matching how MD's rate notices state it;
-- clients.routes.ts converts to a decimal fraction when syncing the client-scoped
-- SUTA override into v3_tax_rates.
ALTER TABLE altax.v3_clients
  ADD COLUMN IF NOT EXISTS md_ui_employer_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS md_ui_tax_rate NUMERIC(6,3);
