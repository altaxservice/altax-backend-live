-- Real VA/DC withholding needs exemption counts distinct from Maryland's own
-- (different dollar values per exemption) — kept separate from md_exemptions so the
-- already-shipped, verified MD field is never at risk of being repurposed.
ALTER TABLE altax.v3_employees ADD COLUMN IF NOT EXISTS state_exemptions INTEGER;
-- Virginia's own E2 (age 65+ / blind exemptions, VA-4) — VA-specific, no other state
-- here uses this concept.
ALTER TABLE altax.v3_employees ADD COLUMN IF NOT EXISTS age_blind_exemptions INTEGER;
