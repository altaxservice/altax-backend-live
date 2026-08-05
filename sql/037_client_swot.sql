-- Per-client business advisory analysis — a living document staff revisit
-- and update over time (one row per client, upserted via ON CONFLICT in
-- clients.routes.ts), not a log of dated entries.
--
-- Broader than a classic 4-box SWOT by design, per explicit ask: staff need
-- to give the client real advisory guidance — where the business stands
-- today, the standard Strengths/Weaknesses/Opportunities/Threats, and then
-- concrete category-specific recommendations (tax savings + penalty/interest
-- avoidance, staffing, marketing, overall growth), plus an open-ended
-- "Additional Notes" intake card for anything else supporting the strategy
-- that doesn't fit one of the named categories. Every field is optional free
-- text — staff fill in whatever's relevant for a given client, not a
-- required checklist.

CREATE TABLE IF NOT EXISTS altax.v3_client_swot (
    client_id VARCHAR(64) PRIMARY KEY REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    overview TEXT,
    strengths TEXT,
    weaknesses TEXT,
    opportunities TEXT,
    threats TEXT,
    tax_recommendations TEXT,
    staffing_recommendations TEXT,
    marketing_recommendations TEXT,
    growth_recommendations TEXT,
    additional_notes TEXT,
    updated_by VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
