-- Pipeline redesign (hard audit follow-up, 2026-08-13): a prospect's only
-- "service" concept was entity_type/business_type, which just drives which
-- fee-catalog lines get pulled in (Formation/Permit-style quoting). There was
-- no way to record "pitching this prospect on Bookkeeping/Payroll" — this
-- column is that, using the same FIRM_SERVICES keys as v3_clients.services
-- (frontend/src/utils/clientOptions.ts) so a converted client's services
-- array can be seeded straight from what the estimate says.
ALTER TABLE altax.v3_estimates ADD COLUMN IF NOT EXISTS service_interest TEXT[] NOT NULL DEFAULT '{}';
