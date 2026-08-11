-- Adds a "12 hours before" (720 minutes) reminder preset, and a client-facing
-- reminder channel setting mirroring the existing staff_reminder_channel one
-- (email/sms/both — currently the client reminder always went out on every
-- channel the client had on file, with no admin control).
--
-- The reminder_lead_minutes CHECK constraint is rebuilt from scratch (drop +
-- add, not "add 720 to the existing one") rather than assuming 060's 120
-- value made it into this constraint already — running this on an
-- environment where 060 was never applied is exactly the failure mode this
-- migration exists to fix: the Calendar Settings page sends the FULL
-- settings object on every save (not a diff), so once the frontend started
-- rendering a "2 hours before" checkbox (client code shipped with 120 in its
-- preset list) any save at all — touching reminders or not — would try to
-- write 120 into reminder_lead_minutes and hit the old constraint, failing
-- with a generic 500 on every single Calendar Settings save.
ALTER TABLE altax.v3_appointment_settings
  DROP CONSTRAINT IF EXISTS chk_v3_appointment_settings_reminder_lead_minutes;
ALTER TABLE altax.v3_appointment_settings
  ADD CONSTRAINT chk_v3_appointment_settings_reminder_lead_minutes
  CHECK (reminder_lead_minutes <@ ARRAY[10080, 4320, 1440, 720, 240, 120, 60]::integer[]);

ALTER TABLE altax.v3_appointment_settings
  ADD COLUMN IF NOT EXISTS client_reminder_channel VARCHAR(10) NOT NULL DEFAULT 'both';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_v3_appointment_settings_client_reminder_channel'
  ) THEN
    ALTER TABLE altax.v3_appointment_settings
      ADD CONSTRAINT chk_v3_appointment_settings_client_reminder_channel
      CHECK (client_reminder_channel IN ('email', 'sms', 'both'));
  END IF;
END $$;
