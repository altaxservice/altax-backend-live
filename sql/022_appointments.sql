-- Appointment scheduling on the Calendar page — a standalone, self-contained
-- scheduler (Google-Calendar-style day/week/month usage, but this app's own data
-- and email/SMS pipeline). Real Google Calendar sync is a separate later add-on
-- once a Google Cloud OAuth app is set up; this does not depend on it.
--
-- client_id is nullable (ON DELETE SET NULL, not CASCADE) because an appointment
-- can be with an existing client OR a brand-new contact who isn't a client yet —
-- contact_name/contact_email/contact_phone hold that case, and are also used to
-- snapshot a real client's info at booking time (so the row still reads sensibly
-- if the client is ever deleted).
CREATE TABLE IF NOT EXISTS altax.v3_appointments (
    appointment_id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    client_id VARCHAR(64) REFERENCES altax.v3_clients(client_id) ON DELETE SET NULL,
    contact_name VARCHAR(255),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(64),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    location VARCHAR(255),
    notes TEXT,
    assigned_to VARCHAR(255),
    status VARCHAR(32) NOT NULL DEFAULT 'Scheduled',
    notify_client BOOLEAN NOT NULL DEFAULT true,
    reminder_sent_at TIMESTAMPTZ,
    created_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_v3_appointments_status CHECK (status IN ('Scheduled', 'Completed', 'Cancelled')),
    CONSTRAINT chk_v3_appointments_time_order CHECK (end_time >= start_time)
);
CREATE INDEX IF NOT EXISTS idx_v3_appointments_start_time ON altax.v3_appointments(start_time);
CREATE INDEX IF NOT EXISTS idx_v3_appointments_client ON altax.v3_appointments(client_id);
CREATE INDEX IF NOT EXISTS idx_v3_appointments_reminder ON altax.v3_appointments(status, reminder_sent_at, start_time);
