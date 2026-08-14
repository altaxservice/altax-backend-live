-- Extends the Ownership Transfer package (see
-- src/modules/clients/ownershipTransfer.routes.ts) with the 2 new documents
-- the Phase 4 Maryland SDAT generators (mdAmendLlc.ts, mdAmendCorp.ts,
-- mdDissolution.ts) made possible: a REAL MD Articles of Amendment
-- (Corp or LLC, auto-picked from the client's entity_type) instead of the
-- old plain reminder task, and an optional Articles of Dissolution when the
-- ownership-transfer wizard's "is the old entity being dissolved?" toggle is
-- on. Same nullable-pointer pattern as the existing
-- gov_form_8822b_filing_id / gov_form_cra_filing_id columns
-- (sql/049_ownership_transfers.sql) — these just point at the
-- v3_gov_form_filings row each drafted filing lives in. The old
-- md_amendment_task_id column (sql/049) is left in place: it's still used
-- as the fallback when a client's entity_type isn't corp-like or LLC-like
-- (e.g. Partnership, Sole Proprietorship) and no real Amendment generator
-- applies.
ALTER TABLE altax.v3_ownership_transfers
    ADD COLUMN IF NOT EXISTS gov_form_amendment_filing_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS gov_form_dissolution_filing_id VARCHAR(64);
