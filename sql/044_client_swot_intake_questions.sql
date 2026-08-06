-- Replaces the 4 broad Business Intake free-text fields (sql/038) with 12
-- specific, "smart" questions across 6 categories — designed so each
-- question maps directly to what actually informs the Staffing/Marketing/
-- Growth Plan advisory fields, which nothing in this system can compute on
-- its own. See src/modules/clients/clients.routes.ts's SWOT_FIELDS for the
-- exact question wording shown in the UI.

ALTER TABLE altax.v3_client_swot
    -- Target Market & Customers
    ADD COLUMN IF NOT EXISTS typical_customer TEXT,
    ADD COLUMN IF NOT EXISTS service_area TEXT,
    -- Competitive Position
    ADD COLUMN IF NOT EXISTS top_competitors TEXT,
    ADD COLUMN IF NOT EXISTS competitive_edge TEXT,
    -- Marketing & Customer Acquisition
    ADD COLUMN IF NOT EXISTS customer_acquisition TEXT,
    ADD COLUMN IF NOT EXISTS current_marketing TEXT,
    -- Staffing & Operations
    ADD COLUMN IF NOT EXISTS staffing_level TEXT,
    ADD COLUMN IF NOT EXISTS staffing_challenges TEXT,
    -- Business Goals
    ADD COLUMN IF NOT EXISTS top_goal TEXT,
    ADD COLUMN IF NOT EXISTS expansion_plans TEXT,
    -- Known Challenges & Risks
    ADD COLUMN IF NOT EXISTS daily_challenge TEXT,
    ADD COLUMN IF NOT EXISTS financial_concerns TEXT;

-- Best-effort forward migration for any existing free-text answers (only
-- one real row exists as of this migration — AL TAX SERVICE's own example
-- content — but this is written generically in case others exist elsewhere).
-- Whole old blob copied into the nearest matching new question; nothing
-- silently dropped.
UPDATE altax.v3_client_swot SET
    typical_customer = COALESCE(typical_customer, NULLIF(target_market, '')),
    top_competitors = COALESCE(top_competitors, NULLIF(competitors, '')),
    top_goal = COALESCE(top_goal, NULLIF(business_goals, '')),
    daily_challenge = COALESCE(daily_challenge, NULLIF(known_challenges, ''))
WHERE target_market IS NOT NULL OR competitors IS NOT NULL OR business_goals IS NOT NULL OR known_challenges IS NOT NULL;

ALTER TABLE altax.v3_client_swot
    DROP COLUMN IF EXISTS target_market,
    DROP COLUMN IF EXISTS competitors,
    DROP COLUMN IF EXISTS business_goals,
    DROP COLUMN IF EXISTS known_challenges;
