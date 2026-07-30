-- ---------------------------------------------------------------------------
-- Clients: separate email/phone for the responsible-party/company contact,
-- distinct from the client's own main email/phone (v3_clients.email/phone —
-- the company's main line). The responsible party is often a specific
-- person (owner, officer) who isn't the one answering the main number, same
-- reasoning that already split out company_contact_name/title/ssn from the
-- client's own identity fields.
-- ---------------------------------------------------------------------------
ALTER TABLE v3_clients ADD COLUMN IF NOT EXISTS company_contact_email VARCHAR(255);
ALTER TABLE v3_clients ADD COLUMN IF NOT EXISTS company_contact_phone VARCHAR(255);
