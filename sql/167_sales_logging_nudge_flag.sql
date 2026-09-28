-- Opt-in/out toggle for the "you haven't logged sales in a while" client
-- portal nudge (src/common/salesLoggingNudges.ts), mirroring the
-- auto_compliance_reminders_enabled flag's exact pattern. Defaults to true
-- so existing My Books clients start getting the nudge without staff having
-- to turn it on per client; staff can disable it per client if unwanted.
ALTER TABLE altax.v3_clients ADD COLUMN IF NOT EXISTS sales_logging_nudges_enabled BOOLEAN NOT NULL DEFAULT true;
