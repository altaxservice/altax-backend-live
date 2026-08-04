-- Appointment Types: admin-configurable list of named durations (e.g. "Quick
-- Question" 15 min, "Full Consultation" 60 min) a client picks on the public
-- /book page, and staff pick from on the internal Calendar's "+ New
-- Appointment" form. Previously appointment length was one single firm-wide
-- "Slot Length" value on v3_appointment_settings — that value now serves a
-- different, narrower role (the spacing between candidate start times /
-- "time grid"), decoupled from how long any individual appointment actually
-- runs.
CREATE TABLE IF NOT EXISTS altax.v3_appointment_types (
    appointment_type_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    duration_minutes INTEGER NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_v3_appointment_types_duration CHECK (duration_minutes > 0 AND duration_minutes <= 480)
);
CREATE INDEX IF NOT EXISTS idx_v3_appointment_types_active ON altax.v3_appointment_types(active);

-- Which type an appointment was booked as — nullable and denormalized (name
-- snapshotted alongside the id) so a later rename/deactivation of the type
-- never rewrites history on appointments already booked under it, matching
-- how client_name/employee_name are snapshotted elsewhere in this app.
ALTER TABLE altax.v3_appointments ADD COLUMN IF NOT EXISTS appointment_type_id VARCHAR(64) REFERENCES altax.v3_appointment_types(appointment_type_id) ON DELETE SET NULL;
ALTER TABLE altax.v3_appointments ADD COLUMN IF NOT EXISTS appointment_type_name VARCHAR(255);

-- Seed exactly one default type so booking keeps working immediately after
-- this migration runs, with zero required admin action — its duration
-- matches whatever slot_minutes was already configured (or defaults to 60,
-- the same fallback DEFAULT_APPOINTMENT_SETTINGS.slotMinutes already used).
INSERT INTO altax.v3_appointment_types (appointment_type_id, name, duration_minutes, sort_order)
SELECT 'APPTTYPE-DEFAULT', 'Consultation', COALESCE((SELECT slot_minutes FROM altax.v3_appointment_settings WHERE id = 'APPT-1'), 60), 0
WHERE NOT EXISTS (SELECT 1 FROM altax.v3_appointment_types);
