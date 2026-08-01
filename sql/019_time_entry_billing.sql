-- Time-and-materials client billing: mark a time entry billable at a rate,
-- then roll unbilled billable entries for a client into an invoice (see
-- POST /billing/invoices/from-time in billing.routes.ts). Distinct from
-- payroll: v3_time_entries.user_email is an AL TAX staff member, while
-- payroll/v3_employees pays a CLIENT's own workers — these are different
-- people, so this wires time tracking into client billing, not payroll.
ALTER TABLE altax.v3_time_entries ADD COLUMN IF NOT EXISTS billable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE altax.v3_time_entries ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2);
ALTER TABLE altax.v3_time_entries ADD COLUMN IF NOT EXISTS billed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE altax.v3_time_entries ADD COLUMN IF NOT EXISTS invoice_id VARCHAR(64);
