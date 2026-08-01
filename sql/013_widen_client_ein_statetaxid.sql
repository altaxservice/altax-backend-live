-- individual_ssn/company_contact_ssn are already stored encrypted-at-rest (see
-- src/common/encryption.ts's envelope format) and are VARCHAR(255), plenty of room.
-- ein/state_tax_id were VARCHAR(64) — enough for the plaintext value but too narrow
-- for the encrypted envelope ("v1:<wrapped-data-key>:<payload>", ~140+ chars even for
-- a short 9-digit EIN). Widen both to match.
ALTER TABLE altax.v3_clients ALTER COLUMN ein TYPE VARCHAR(255);
ALTER TABLE altax.v3_clients ALTER COLUMN state_tax_id TYPE VARCHAR(255);
