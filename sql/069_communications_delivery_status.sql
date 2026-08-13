-- Hard audit (2026-08-13), BC-001: "sent" previously only ever meant the
-- provider's API call didn't throw — there was no way to know whether an
-- email/SMS/WhatsApp message actually reached anyone, bounced, or was never
-- delivered at all. These columns are populated by the new webhook receivers
-- (src/modules/webhooks/webhooks.routes.ts) using each message's own
-- provider-assigned id, captured at send time (see notifications.ts /
-- sendChannel.ts). All nullable — a row from before this migration, or one
-- whose provider doesn't confirm delivery, simply has no delivery data, same
-- as today.
ALTER TABLE altax.v3_communications ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(255);
ALTER TABLE altax.v3_communications ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(50);
ALTER TABLE altax.v3_communications ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE altax.v3_communications ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_v3_communications_provider_message_id ON altax.v3_communications(provider_message_id) WHERE provider_message_id IS NOT NULL;
