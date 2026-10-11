-- Firm-wide master switch for the monthly client summary email. OFF until an admin has previewed it and turns it on.
ALTER TABLE altax.v3_firm_settings ADD COLUMN IF NOT EXISTS monthly_client_summary_enabled BOOLEAN NOT NULL DEFAULT false;
