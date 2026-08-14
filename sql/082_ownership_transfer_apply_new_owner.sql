-- "Apply New Owner to Client Profile" (see
-- src/modules/clients/ownershipTransfer.routes.ts,
-- POST /:clientId/ownership-transfers/:transferId/apply-new-owner) — the final
-- step after an Ownership Transfer's own generated filings (8822-B, CRA,
-- Amendment, Dissolution) are all Submitted: pushes the transfer's buyer_*
-- info onto the client's own Responsible Party fields and transfers portal
-- login control from the old owner to the new one. These two columns track
-- whether/when/by-whom that action has been run for a given transfer, same
-- nullable-until-acted-on convention as created_by on this same table
-- (sql/049_ownership_transfers.sql) — both stay NULL until the action has
-- actually been triggered once, and the route refuses to run it a second
-- time once applied_to_profile_at is set.
ALTER TABLE altax.v3_ownership_transfers
    ADD COLUMN IF NOT EXISTS applied_to_profile_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS applied_by VARCHAR(255);
