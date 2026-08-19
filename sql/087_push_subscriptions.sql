-- Web Push subscriptions — one row per admin/staff device that has opted
-- into real phone/desktop push notifications (see src/common/webPush.ts).
-- Keyed by endpoint (unique per browser+device registration), not user, so
-- the same person can have several devices subscribed at once and each is
-- pruned independently the moment its own subscription expires (a 404/410
-- from the push service). user_email is a plain snapshot for lookup, not an
-- FK — matches this app's existing "who" convention (e.g. v3_suggestions),
-- and survives a user rename/deactivation without orphaning the row.
CREATE TABLE IF NOT EXISTS altax.v3_push_subscriptions (
    subscription_id  VARCHAR(64) PRIMARY KEY,
    user_email       VARCHAR(255) NOT NULL,
    endpoint         TEXT NOT NULL UNIQUE,
    p256dh           TEXT NOT NULL,
    auth             TEXT NOT NULL,
    user_agent       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_email ON altax.v3_push_subscriptions (lower(user_email));
