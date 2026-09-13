-- Real owner request, 2026-09-13: "Remind me on" only ever compared a bare
-- DATE (no time-of-day) and never actually notified anyone -- setting it
-- just colored the row red once overdue. Adds a real time-of-day, a
-- priority level (matching v3_tasks' own Normal/Low/High/Urgent
-- convention), and an assigned_to so a reminder has an actual person to
-- notify, not just an author. reminder_sent_at is the claim column for the
-- new cron (runStaffNoteReminders) -- NULL means still pending, set once an
-- SMS/email has actually gone out, mirroring the Scheduled/Sent pattern
-- already used by v3_payment_reminders.
ALTER TABLE altax.v3_staff_notes
  ADD COLUMN IF NOT EXISTS priority VARCHAR(16) NOT NULL DEFAULT 'Normal',
  ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- remind_at was DATE (day-only); existing values become local midnight UTC,
-- which is fine -- no note previously had a time-of-day to preserve.
ALTER TABLE altax.v3_staff_notes ALTER COLUMN remind_at TYPE TIMESTAMPTZ USING remind_at::timestamptz;

CREATE INDEX IF NOT EXISTS idx_v3_staff_notes_reminder_due
  ON altax.v3_staff_notes (remind_at)
  WHERE status = 'Open' AND reminder_sent_at IS NULL;
