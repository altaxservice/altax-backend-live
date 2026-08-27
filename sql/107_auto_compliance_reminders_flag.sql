-- Per-client "Auto Reminder" on/off switch — direct owner request,
-- 2026-08-26, after the compliance deadline reminder feature (sql/106)
-- shipped: lets staff exclude a specific client from the automatic daily
-- reminder sweep (runComplianceDeadlineReminders) without touching that
-- client's underlying obligation flags (md_annual_report_enabled etc.,
-- which also drive Fix Center's sweep and the Upcoming Deadlines list —
-- turning THOSE off would be a much bigger change than "don't auto-remind
-- this one client"). Manual "Send to Client" is never affected by this —
-- it's staff explicitly choosing to send right now, this switch only
-- gates the automatic sweep. Defaults true so every existing client keeps
-- getting reminders unless someone opts them out.
ALTER TABLE altax.v3_clients
    ADD COLUMN IF NOT EXISTS auto_compliance_reminders_enabled BOOLEAN NOT NULL DEFAULT true;
