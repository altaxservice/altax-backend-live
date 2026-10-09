-- When each staff member last opened each client. Powers "since your last visit" and "pick up where you left off"
-- automatically — nobody types anything. prev_visit_at is the visit before the current working session (a visit
-- within 30 minutes of the last one continues the same session and leaves it unchanged).
CREATE TABLE IF NOT EXISTS altax.v3_client_visits (
    user_email VARCHAR(255) NOT NULL,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    last_visit_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    prev_visit_at TIMESTAMPTZ,
    PRIMARY KEY (user_email, client_id)
);
CREATE INDEX IF NOT EXISTS idx_client_visits_user ON altax.v3_client_visits (user_email, last_visit_at DESC);
