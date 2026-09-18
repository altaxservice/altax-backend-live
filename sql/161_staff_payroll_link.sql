-- Links an admin/staff account to a v3_employees record (under the firm's
-- own self-client) so Time Tracking's hours can export straight into the
-- existing real paycheck engine. Deliberately a NEW field, not a reuse of
-- assigned_employee_id -- that field grants an employee-PORTAL login access
-- to a client's record and has deactivation logic tied to it; this is a
-- payroll-export link for a firm-internal admin/staff account and has none
-- of that behavior.
ALTER TABLE altax.v3_users ADD COLUMN IF NOT EXISTS payroll_employee_id VARCHAR(64) REFERENCES altax.v3_employees(employee_id) ON DELETE SET NULL;
