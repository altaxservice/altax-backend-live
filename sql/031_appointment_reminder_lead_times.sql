-- Configurable reminder lead times (e.g. "1 day before", "1 hour before")
-- instead of the hardcoded day-before-only reminder. Values are minutes-before
-- the appointment, drawn from a fixed preset list enforced in appointments.routes.ts
-- (REMINDER_LEAD_PRESETS) — the CHECK constraint mirrors that same list so a bad
-- value can't be written directly via SQL either. Default keeps existing behavior
-- (day-before only) unchanged for firms that never touch the new setting.
ALTER TABLE altax.v3_appointment_settings
  ADD COLUMN IF NOT EXISTS reminder_lead_minutes INTEGER[] NOT NULL DEFAULT '{1440}';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_v3_appointment_settings_reminder_lead_minutes'
  ) THEN
    ALTER TABLE altax.v3_appointment_settings
      ADD CONSTRAINT chk_v3_appointment_settings_reminder_lead_minutes
      CHECK (reminder_lead_minutes <@ ARRAY[10080, 4320, 1440, 240, 60]::integer[]);
  END IF;
END $$;

-- Which of the configured lead times have already fired for this appointment —
-- replaces the old single reminder_sent_at timestamp (kept, now unused) so an
-- appointment with multiple configured lead times (e.g. both a day-before and an
-- hour-before reminder) gets each one exactly once instead of only the first.
ALTER TABLE altax.v3_appointments
  ADD COLUMN IF NOT EXISTS reminder_lead_minutes_sent INTEGER[] NOT NULL DEFAULT '{}';
