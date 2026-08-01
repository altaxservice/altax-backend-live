-- How a client found the firm — free-text with a suggested list in the UI, not a
-- hard enum, since firms discover new referral channels over time.
ALTER TABLE altax.v3_clients ADD COLUMN IF NOT EXISTS referral_source VARCHAR(255);

-- Manually-logged client interaction timeline (calls, in-person meetings, etc.) —
-- distinct from v3_communications, which only captures messages actually sent
-- through this app. See clients.routes.ts's GET/POST /:clientId/activity.
CREATE TABLE IF NOT EXISTS altax.v3_client_activity_log (
    activity_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL,
    activity_type VARCHAR(64) NOT NULL,
    note TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    logged_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_client_activity_log_client_id FOREIGN KEY (client_id) REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_v3_client_activity_log_client_id ON altax.v3_client_activity_log(client_id);
