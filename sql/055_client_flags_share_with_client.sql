-- Lets staff mark an individual manual flag as safe to show the client
-- (see clients.routes.ts computeClientFlags / POST :clientId/flags) — a
-- flag category like "Legal / Dispute" or a free-text Details field can
-- contain internal phrasing not meant to be read verbatim by the client, so
-- nothing is ever included in a client-facing notification unless staff
-- explicitly opts it in. Defaults to false (opt-in), including for every
-- existing row — nothing becomes client-visible just from running this
-- migration. Computed flags (BalancePastDue/AgencyPastDue) have no row here
-- at all and are always eligible; this column only governs the staff-entered
-- Credit/Custom rows.
ALTER TABLE altax.v3_client_flags
    ADD COLUMN IF NOT EXISTS share_with_client BOOLEAN NOT NULL DEFAULT false;
