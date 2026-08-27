-- Real backing store for the marketing site's "Stay Connected — Join"
-- newsletter signup form, which until now was purely decorative (main.js
-- just showed a browser alert and threw the email away — its own
-- translation string literally said "(static preview)"). Direct owner
-- request 2026-08-27: "add whatever will benefit us and our clients without
-- trouble for either side and free of legal matter" — finishing this form so
-- it actually captures the email is the safe half of "add an automated
-- newsletter"; see publicNewsletter.routes.ts's own comment for why the
-- SENDING side is deliberately left to a human, not automated.
--
-- unsubscribe_token: opaque, unguessable — the link a "Save my clicking
-- unsubscribe" email footer points to, with no login required (CAN-SPAM Act
-- requires a working one-click unsubscribe on any commercial bulk email).
CREATE TABLE IF NOT EXISTS altax.v3_newsletter_subscribers (
    subscriber_id     VARCHAR(64) PRIMARY KEY,
    email              VARCHAR(255) NOT NULL UNIQUE,
    status             VARCHAR(20) NOT NULL DEFAULT 'subscribed' CHECK (status IN ('subscribed', 'unsubscribed')),
    unsubscribe_token  VARCHAR(64) NOT NULL UNIQUE,
    source             VARCHAR(80),
    ip_address         VARCHAR(64),
    subscribed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    unsubscribed_at    TIMESTAMPTZ
);
