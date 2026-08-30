-- Gives MD Sales Tax the same client-acknowledge flow EFTPS already has —
-- share_token/acknowledged_at/acknowledged_ip mirror v3_eftps_deposits'
-- columns exactly (sql/123_eftps_deposits.sql), same token-gated public-link
-- pattern (see publicMdFiling.routes.ts).
ALTER TABLE altax.v3_md_filing_payments
    ADD COLUMN IF NOT EXISTS share_token VARCHAR(64) UNIQUE,
    ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS acknowledged_ip VARCHAR(64);
