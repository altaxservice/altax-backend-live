-- Add a plain-text username/user ID field to the per-client Secure Vault,
-- matching the column that already exists on v3_firm_portals — most portal
-- logins are a username+password pair, not a bare secret, and there was
-- previously nowhere to record the username half.
ALTER TABLE altax.v3_client_secrets ADD COLUMN IF NOT EXISTS username VARCHAR(300);
