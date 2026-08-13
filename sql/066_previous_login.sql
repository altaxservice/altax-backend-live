-- Tracks the login BEFORE the current session, so "what happened since I was
-- last here" can use a stable cutoff — last_login itself gets overwritten the
-- moment the current session starts, so it can never be used for that.
ALTER TABLE altax.v3_users ADD COLUMN IF NOT EXISTS previous_login TIMESTAMPTZ;
