-- Minimum advance notice a client must give when self-booking (or
-- rescheduling) an appointment online — see src/modules/publicAppointments.
-- Default 1440 minutes (24 hours): same-day and next-few-hours bookings were
-- previously allowed (the only prior check was "must be in the future").
-- Same singleton settings row (id='APPT-1') as gap_minutes/slot_minutes.

ALTER TABLE altax.v3_appointment_settings
  ADD COLUMN IF NOT EXISTS min_lead_minutes INTEGER NOT NULL DEFAULT 1440;
