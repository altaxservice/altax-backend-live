-- More than one seller and/or buyer on an ownership transfer. The first seller and first buyer stay
-- in the existing seller_* / buyer_* columns (the 8822-B responsible party, the CRA/Amendment officer
-- and the portal login all follow the first buyer); anyone else is stored here as
-- [{ "name", "title", "email", "phone", "address" }] and appears on the Bill of Sale and its signature blocks.
ALTER TABLE altax.v3_ownership_transfers
    ADD COLUMN IF NOT EXISTS additional_sellers JSONB,
    ADD COLUMN IF NOT EXISTS additional_buyers JSONB;
