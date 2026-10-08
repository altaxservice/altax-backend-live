-- The phone number clients can send Zelle payments to, printed on every invoice (PDF, online invoice page, invoice
-- email) alongside the optional "Scan to Pay" QR code. Stored formatted, e.g. (443) 825-8804.
ALTER TABLE altax.v3_firm_settings ADD COLUMN IF NOT EXISTS zelle_phone VARCHAR(40);
