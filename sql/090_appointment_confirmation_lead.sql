-- The "please confirm you're coming" ask (24h before, by default) previously
-- had a hardcoded lead time (CONFIRMATION_REQUEST_LEAD_MINUTES,
-- appointments.routes.ts) — the only fixed timing left in a settings panel
-- where every other lead time is admin-configurable. Default 1440 preserves
-- current behavior exactly.
ALTER TABLE altax.v3_appointment_settings
  ADD COLUMN IF NOT EXISTS confirmation_request_lead_minutes INTEGER NOT NULL DEFAULT 1440;
