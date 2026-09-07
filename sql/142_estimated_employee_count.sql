-- A staff-entered placeholder headcount for per-employee/per-worker service
-- pricing (W-2/1099 Prep, MD Unemployment Insurance) at client setup time,
-- before any real v3_employees rows exist — real employee data always wins
-- the moment it exists (see getClientWorkerCounts in clients.routes.ts);
-- this is a bridge to real data, never a standing override.
ALTER TABLE altax.v3_clients ADD COLUMN IF NOT EXISTS estimated_employee_count INTEGER;
