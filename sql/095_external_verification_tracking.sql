-- External verification tracking — the user manually checks MDTAXCONNECT
-- (MD sales tax filing/payment status) and MD Business Express (MD Annual
-- Report / Good Standing) for every client, with no record of when a given
-- client was last checked. That leads to re-checking some clients while
-- missing others. These 4 columns give each MD client a "last checked"
-- date + who checked it, per portal — a real dated record instead of
-- relying on memory. Latest-check-only (not a history log), matching this
-- app's existing v3_obligation_completions "mark done" pattern rather than
-- a full audit trail, since only "when did I last actually look" matters
-- here, not every historical check.
ALTER TABLE altax.v3_clients
    ADD COLUMN IF NOT EXISTS mdtaxconnect_verified_at DATE,
    ADD COLUMN IF NOT EXISTS mdtaxconnect_verified_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS md_business_express_verified_at DATE,
    ADD COLUMN IF NOT EXISTS md_business_express_verified_by VARCHAR(255);
