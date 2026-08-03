-- Which channel(s) the internal staff/admin appointment reminder (see
-- notifyAppointmentStaff in appointments.routes.ts) goes out on. Default
-- 'email' keeps existing behavior unchanged for firms that never touch this.
ALTER TABLE altax.v3_appointment_settings
  ADD COLUMN IF NOT EXISTS staff_reminder_channel VARCHAR(10) NOT NULL DEFAULT 'email';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_v3_appointment_settings_staff_reminder_channel'
  ) THEN
    ALTER TABLE altax.v3_appointment_settings
      ADD CONSTRAINT chk_v3_appointment_settings_staff_reminder_channel
      CHECK (staff_reminder_channel IN ('email', 'sms', 'both'));
  END IF;
END $$;
