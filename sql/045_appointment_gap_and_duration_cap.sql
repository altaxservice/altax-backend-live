-- Two related booking-rule changes:
--
-- 1. Gap/buffer between appointments — until now the only conflict rule was
--    "don't overlap"; two appointments could be booked back-to-back with zero
--    breathing room between them (one ending at 2:00 PM, the next starting at
--    2:00 PM sharp). gap_minutes pads the conflict window on both sides of
--    every existing appointment when checking a new booking, so the firm gets
--    real turnaround time between clients. Same singleton-row settings table
--    (id='APPT-1') as slot_minutes/business hours — configurable, not
--    hardcoded, matching how every other calendar rule in this app works.
--
-- 2. Appointment Type duration ceiling tightened from 480 (8 hours — the
--    original, deliberately generous default from migration 036) down to 90,
--    the firm's actual policy: a client-chosen appointment can run at most
--    90 minutes. Safe to tighten now — no appointment ever booked has
--    exceeded 60 minutes (verified against both dev and prod data before
--    writing this migration).
ALTER TABLE altax.v3_appointment_settings ADD COLUMN IF NOT EXISTS gap_minutes INTEGER NOT NULL DEFAULT 15;
ALTER TABLE altax.v3_appointment_settings DROP CONSTRAINT IF EXISTS chk_v3_appointment_settings_gap;
ALTER TABLE altax.v3_appointment_settings ADD CONSTRAINT chk_v3_appointment_settings_gap CHECK (gap_minutes >= 0 AND gap_minutes <= 60);

ALTER TABLE altax.v3_appointment_types DROP CONSTRAINT IF EXISTS chk_v3_appointment_types_duration;
ALTER TABLE altax.v3_appointment_types ADD CONSTRAINT chk_v3_appointment_types_duration CHECK (duration_minutes > 0 AND duration_minutes <= 90);

-- Give clients an actual duration choice on the public booking page — until
-- now there was only one active Appointment Type (60-min "Consultation"),
-- and the type picker on /book stays hidden whenever there's just one
-- option. Firm can rename/reorder/deactivate these anytime from Calendar
-- Settings → Appointment Types; this just seeds sensible defaults so the
-- picker has something to show immediately.
INSERT INTO altax.v3_appointment_types (appointment_type_id, name, duration_minutes, sort_order)
SELECT 'APPTTYPE-30MIN', 'Quick Consultation', 30, -1
WHERE NOT EXISTS (SELECT 1 FROM altax.v3_appointment_types WHERE duration_minutes = 30);

INSERT INTO altax.v3_appointment_types (appointment_type_id, name, duration_minutes, sort_order)
SELECT 'APPTTYPE-90MIN', 'Extended Consultation', 90, 1
WHERE NOT EXISTS (SELECT 1 FROM altax.v3_appointment_types WHERE duration_minutes = 90);
