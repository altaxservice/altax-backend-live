-- Paychecks were only ever linked to an employee by matching the free-text
-- `employee` name column against v3_employees.employee_name — an employee-portal
-- ownership check (accounting.routes.ts /paychecks/mine and /:paycheckId/print)
-- compared name strings, so two employees sharing a name (at the same or a
-- different client) could see each other's paystub, including SSN and bank
-- details. Adding a real FK closes that off; backfilled from the existing
-- client_id + name match, which is unambiguous today (no duplicate names found
-- in either dev or prod at the time of this migration).

ALTER TABLE altax.v3_paychecks
  ADD COLUMN IF NOT EXISTS employee_id VARCHAR(64) REFERENCES altax.v3_employees(employee_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_v3_paychecks_employee_id ON altax.v3_paychecks(employee_id);

UPDATE altax.v3_paychecks p
   SET employee_id = e.employee_id
  FROM altax.v3_employees e
 WHERE p.employee_id IS NULL
   AND p.client_id = e.client_id
   AND lower(p.employee) = lower(e.employee_name);
