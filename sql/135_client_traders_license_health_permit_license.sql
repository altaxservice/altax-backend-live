-- Trader's License and Health Permit License numbers — government-issued
-- business licenses staff need on file, grouped with the other Licenses &
-- Permits fields (use_and_occupancy_number, fire_dept_permit_number). Not
-- encrypted — same tier as those: business-facing public license numbers,
-- not confidential tax/SSN-class data.
ALTER TABLE altax.v3_clients
  ADD COLUMN IF NOT EXISTS traders_license_number VARCHAR(255),
  ADD COLUMN IF NOT EXISTS health_permit_license_number VARCHAR(255);
