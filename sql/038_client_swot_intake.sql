-- Business Intake fields for the SWOT/advisory tab (sql/037_client_swot.sql)
-- — captures qualitative business context that no transaction in this
-- system can infer (target market, competitors, stated goals, known
-- challenges), gathered directly from the client/staff conversation. Added
-- to the existing table rather than a new one: it's still one row per
-- client, saved through the same GET/PATCH pair, and these answers are
-- meant to sit alongside and inform the rest of the analysis, not live in
-- a separate screen that could drift out of sync.

ALTER TABLE altax.v3_client_swot
    ADD COLUMN IF NOT EXISTS target_market TEXT,
    ADD COLUMN IF NOT EXISTS competitors TEXT,
    ADD COLUMN IF NOT EXISTS business_goals TEXT,
    ADD COLUMN IF NOT EXISTS known_challenges TEXT;
