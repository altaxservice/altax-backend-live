-- Which document(s) a saved HACCP-area plan actually wants — replaces the
-- old binary "haccpOnly"/"full" frontend toggle (HaccpGeneratorPage.tsx),
-- which only ever gated the license/plan-review section and could not
-- express "just a Menu & Equipment list, no CCP plan" (confirmed bug: staff
-- could not generate a standalone Menu & Equipment list for a convenience
-- store because POST /haccp/plans always required a resolvable CCP
-- template). Array, not a single enum, because a plan can want any
-- combination: 'haccp_plan' | 'menu_equipment' | 'license_application' |
-- 'plan_review'.
ALTER TABLE altax.v3_haccp_plans
  ADD COLUMN IF NOT EXISTS components TEXT[] NOT NULL DEFAULT ARRAY['haccp_plan','menu_equipment']::text[];

-- Backfill: every existing row was generated with the old flow, which always
-- produced a HACCP plan + menu/equipment (menu/equipment was never
-- independently selectable). "Full" mode (License + Plan Review also
-- generated) is inferred with the same heuristic the frontend already used
-- to reopen a plan as "full": a real license_number, or
-- license_application_data.tradeName, or license_application_data.
-- ownerHomeStreet actually populated. Guarded by the WHERE so re-running
-- this file is a no-op for rows already upgraded.
UPDATE altax.v3_haccp_plans
SET components = ARRAY['haccp_plan','menu_equipment','license_application','plan_review']
WHERE components = ARRAY['haccp_plan','menu_equipment']::text[]
  AND (
    (license_number IS NOT NULL AND license_number <> '')
    OR COALESCE(license_application_data->>'tradeName', '') <> ''
    OR COALESCE(license_application_data->>'ownerHomeStreet', '') <> ''
  );
