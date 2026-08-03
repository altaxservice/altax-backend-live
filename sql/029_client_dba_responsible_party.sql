-- "Doing Business As" / trade name — the public-facing name a client operates
-- under when it differs from the legal client_name (e.g. legal name "XYZ LLC",
-- trade name "Joe's Deli"). Free text, shown right under the legal name.
ALTER TABLE altax.v3_clients ADD COLUMN IF NOT EXISTS dba_name VARCHAR(255);

-- Home address for the Responsible Party (the existing company_contact_name/
-- title/ssn/email/phone fields — see clients.routes.ts UPDATABLE_FIELDS and
-- ClientDetailPage.tsx's "Responsible Party" tab), separate from the business's
-- own address. Same structured-fields-plus-composed-text shape already used for
-- the business address (street_address/city/state/zip_code -> address), so
-- existing composeAddress() logic and PDF/print readers can be reused as-is.
ALTER TABLE altax.v3_clients
  ADD COLUMN IF NOT EXISTS company_contact_street_address VARCHAR(255),
  ADD COLUMN IF NOT EXISTS company_contact_city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS company_contact_state VARCHAR(255),
  ADD COLUMN IF NOT EXISTS company_contact_zip_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS company_contact_address TEXT;
