-- History of manual newsletter broadcasts — direct owner request, 2026-08-27,
-- as the human-reviewed send half of the newsletter feature (see
-- publicNewsletter.routes.ts's top comment for why the send itself is never
-- automated: a tax firm's content going out unsupervised is real legal
-- exposure). Staff draft the subject/body themselves and click Send; this
-- table is just the record of what actually went out, to whom, and when.
CREATE TABLE IF NOT EXISTS altax.v3_newsletter_sends (
    send_id           VARCHAR(64) PRIMARY KEY,
    subject           VARCHAR(255) NOT NULL,
    body               TEXT NOT NULL,
    recipient_count    INT NOT NULL,
    failed_count       INT NOT NULL DEFAULT 0,
    sent_by            VARCHAR(255) NOT NULL,
    sent_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
