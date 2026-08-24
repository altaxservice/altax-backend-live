-- Client attendance tracking — direct owner request, 2026-08-24: "if the
-- client available in the meeting or not, attending or absent." Latest-
-- mark-only (not a history log), matching this app's existing "Mark Filed"/
-- "Mark Checked" pattern — staff records what actually happened once the
-- appointment has started, distinct from `status` (Scheduled/Completed/
-- Cancelled), which only tracks the appointment's own lifecycle, not
-- whether the client actually showed up.
ALTER TABLE altax.v3_appointments
    ADD COLUMN IF NOT EXISTS client_attendance VARCHAR(20),
    ADD COLUMN IF NOT EXISTS client_attendance_marked_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS client_attendance_marked_at TIMESTAMPTZ;
