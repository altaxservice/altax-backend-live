-- Owner groups: companies that belong to the same owner. Staff confirm a suggestion ("same owner") and name the group; a client is in at most one group.
-- Dismissed suggestions are remembered so they are not suggested again. Safe to run more than once.
CREATE TABLE IF NOT EXISTS altax.v3_client_groups (
  group_id    VARCHAR(64) PRIMARY KEY,
  group_name  VARCHAR(160) NOT NULL,
  created_by  VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS altax.v3_client_group_members (
  client_id VARCHAR(64) PRIMARY KEY REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
  group_id  VARCHAR(64) NOT NULL REFERENCES altax.v3_client_groups(group_id) ON DELETE CASCADE,
  added_by  VARCHAR(255),
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v3_client_group_members_group ON altax.v3_client_group_members (group_id);
CREATE TABLE IF NOT EXISTS altax.v3_client_link_dismissed (
  client_a     VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
  client_b     VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
  dismissed_by VARCHAR(255),
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_a, client_b),
  CHECK (client_a < client_b)
);
