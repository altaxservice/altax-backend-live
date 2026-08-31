-- Use and Occupancy Number and Fire Department Permit Number — government-
-- issued identifiers a business already has before/alongside its health
-- permit, needed on Health Permit license/plan-review applications (see
-- v3_haccp_plans.license_application_data.useAndOccupancyNumber, previously
-- only ever entered per-plan with no home on the client record itself, so
-- staff retyped it on every renewal). Not encrypted — like
-- secretary_of_state_id, these are business-facing government reference
-- numbers on a public permit, not confidential tax/SSN-class data.
ALTER TABLE altax.v3_clients
  ADD COLUMN IF NOT EXISTS use_and_occupancy_number VARCHAR(255),
  ADD COLUMN IF NOT EXISTS fire_dept_permit_number VARCHAR(255);
