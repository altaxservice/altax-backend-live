-- Firm-wide switch for the 5:30 PM Daily Log reminder email to staff. OFF until an admin turns it on.
ALTER TABLE altax.v3_firm_settings ADD COLUMN IF NOT EXISTS daily_log_reminder_enabled BOOLEAN NOT NULL DEFAULT false;
