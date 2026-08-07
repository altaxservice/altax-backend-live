-- Maryland issues a Central Registration Number once a filed CRA (Combined
-- Registration Application) is approved — a different number from the SDAT
-- Entity ID (assigned at formation, stored in secretary_of_state_id) and
-- from state_tax_id. There was previously nowhere on the client profile to
-- record it once it comes back from the state. Encrypted at rest, same
-- treatment as state_tax_id — it's a real government tax-registration
-- identifier, not a public registry number like the SDAT ID.
ALTER TABLE altax.v3_clients ADD COLUMN IF NOT EXISTS cra_registration_number VARCHAR(255);
