-- Adds a "2 hours before" (120 minutes) appointment reminder preset,
-- per firm request 2026-08-10: clients should get a reminder 1 day before
-- AND 2 hours before, via both email and SMS. The send pipeline
-- (runAppointmentReminders, hourly cron with a +-60min window) already
-- fires once per configured lead time and already sends to both email and
-- SMS whenever both exist on the appointment's contact -- see
-- notifyAppointment() in appointments.routes.ts. 120 was simply missing
-- from the allowed preset list (sql/031_appointment_reminder_lead_times.sql
-- only had 10080/4320/1440/240/60).
ALTER TABLE altax.v3_appointment_settings
  DROP CONSTRAINT IF EXISTS chk_v3_appointment_settings_reminder_lead_minutes;
ALTER TABLE altax.v3_appointment_settings
  ADD CONSTRAINT chk_v3_appointment_settings_reminder_lead_minutes
  CHECK (reminder_lead_minutes <@ ARRAY[10080, 4320, 1440, 240, 120, 60]::integer[]);

-- Turn it on now rather than just making the option available -- the firm
-- asked for this to actually be happening, not merely selectable next time
-- someone opens Calendar Settings. Adds 120 alongside whatever's already
-- configured (idempotent: skips clients where 120 is already present).
UPDATE altax.v3_appointment_settings
  SET reminder_lead_minutes = array_append(reminder_lead_minutes, 120), updated_at = now()
  WHERE NOT (120 = ANY(reminder_lead_minutes));

-- Same for 1440 (1 day before) -- ensure it's present even if a firm had
-- previously unchecked it, since the request explicitly asked for both.
UPDATE altax.v3_appointment_settings
  SET reminder_lead_minutes = array_append(reminder_lead_minutes, 1440), updated_at = now()
  WHERE NOT (1440 = ANY(reminder_lead_minutes));
