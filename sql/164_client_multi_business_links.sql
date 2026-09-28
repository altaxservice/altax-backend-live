-- One client-portal login (v3_users role='client') can now be linked to
-- multiple v3_clients businesses (up to 10-15), switched like staff already
-- switch between clients in the Admin portal. Staff-only linking -- no client
-- self-service creation of new businesses. v3_users.assigned_client_id is left
-- untouched and keeps working as the "default/primary business" pointer used
-- at login; it is unaffected for the 'employee' role, which stays single-client.
CREATE TABLE IF NOT EXISTS altax.v3_user_clients (
  user_id VARCHAR(64) NOT NULL REFERENCES altax.v3_users(user_id) ON DELETE CASCADE,
  client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_by VARCHAR(255),
  PRIMARY KEY (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_v3_user_clients_user ON altax.v3_user_clients(user_id);

-- Backfill: every existing single-business login becomes a linked business,
-- so canAccessClient returns the exact same answer it did before this
-- migration for every existing login -- zero access change on day one.
INSERT INTO altax.v3_user_clients (user_id, client_id, linked_by)
SELECT user_id, assigned_client_id, 'Migration 164 backfill'
  FROM altax.v3_users
 WHERE role = 'client' AND assigned_client_id IS NOT NULL AND assigned_client_id != ''
ON CONFLICT (user_id, client_id) DO NOTHING;
