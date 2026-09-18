-- What AL TAX pays its own staff/admin per hour — separate from the
-- client-billable "Rate" already on v3_time_entries, which is what a
-- CLIENT is charged. Nothing in the app translated tracked hours into pay
-- before this; admin-set only, shown as estimated pay on Time Tracking's
-- "Hours by Staff" panel.
ALTER TABLE altax.v3_users ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2);
