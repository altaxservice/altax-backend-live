-- Card/EBT sales now post straight to Cash (no Undeposited Funds). Each card / EBT portion is its own Cash line; this links
-- the open item to that ledger line so a bank deposit can claim it and so it drops out of the Bank Rec "unmatched" list.
ALTER TABLE altax.v3_tender_clearing ADD COLUMN IF NOT EXISTS gl_entry_id VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_tender_clearing_gl ON altax.v3_tender_clearing (gl_entry_id);
