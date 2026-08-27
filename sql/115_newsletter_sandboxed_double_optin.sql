-- Hard Audit findings, 2026-08-27, both fixed together since both require
-- moving this table:
--
--  1. Public /subscribe wrote through the main DB pool/role (full access to
--     every PII table) instead of the sandboxed altax_public_app role every
--     other public/unauthenticated write path in this app uses. Move the
--     table into altax_public, the same isolated schema tool_leads already
--     lives in (see 062_public_tools_schema.sql) — an internet-facing route
--     with a bug can no longer reach client records, because Postgres
--     itself denies it, not application code discipline.
--
--  2. No verification gate meant this app could be made to send a real
--     "you're subscribed" email to any address, repeatedly, without that
--     person's consent. Double opt-in closes this structurally rather than
--     raising the cost of abuse: the first email is a generic confirm-or-
--     ignore link, and an address only lands on the real send list after
--     that person clicks it themselves.
CREATE TABLE IF NOT EXISTS altax_public.v3_newsletter_subscribers (
    subscriber_id     VARCHAR(64) PRIMARY KEY,
    email              VARCHAR(255) NOT NULL UNIQUE,
    status             VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'subscribed', 'unsubscribed')),
    confirm_token      VARCHAR(64) UNIQUE,
    unsubscribe_token  VARCHAR(64) NOT NULL UNIQUE,
    source             VARCHAR(80),
    ip_address         VARCHAR(64),
    subscribed_at      TIMESTAMPTZ,
    unsubscribed_at    TIMESTAMPTZ
);

-- Anyone already subscribed under the old immediate-confirm flow carries
-- over as already-confirmed — they already received and acted on a real
-- email from this list, so there's nothing to re-litigate for existing rows.
-- Guarded so this migration is safe to run twice (the source table is gone
-- after the first run).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'altax' AND table_name = 'v3_newsletter_subscribers') THEN
    INSERT INTO altax_public.v3_newsletter_subscribers
      (subscriber_id, email, status, unsubscribe_token, source, ip_address, subscribed_at, unsubscribed_at)
    SELECT subscriber_id, email, status, unsubscribe_token, source, ip_address, subscribed_at, unsubscribed_at
    FROM altax.v3_newsletter_subscribers
    ON CONFLICT (subscriber_id) DO NOTHING;

    DROP TABLE altax.v3_newsletter_subscribers;
  END IF;
END $$;

-- altax_public_app previously only needed SELECT/INSERT (tool_leads is
-- write-once). Confirm and unsubscribe both flip a row's status, so this
-- table needs UPDATE too.
GRANT SELECT, INSERT, UPDATE ON altax_public.v3_newsletter_subscribers TO altax_public_app;
