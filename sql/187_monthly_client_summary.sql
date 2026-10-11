-- Per-client switch for the monthly "how your business did" email (on by default; staff can turn it off for a client).
ALTER TABLE altax.v3_clients ADD COLUMN IF NOT EXISTS monthly_summary_enabled BOOLEAN NOT NULL DEFAULT true;
