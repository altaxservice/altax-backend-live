-- Per-invoice card payment link (e.g. a Chase "Accept Payments" link created for this invoice's amount).
ALTER TABLE altax.v3_invoices ADD COLUMN IF NOT EXISTS card_payment_link TEXT;
