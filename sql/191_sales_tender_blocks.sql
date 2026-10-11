-- The sales entry is now three blocks — Cash, Card, SNAP/EBT — each with its own total and, for cash and card, how much of
-- that total was taxable at each rate (the rest is non-taxable). The user's exact entry is kept here so an entry can be
-- reopened and edited as typed; the category lines and tender amounts used for tax and the ledger are derived from it.
ALTER TABLE altax.v3_client_sales_drafts ADD COLUMN IF NOT EXISTS tender_blocks JSONB;
ALTER TABLE altax.v3_sales_input ADD COLUMN IF NOT EXISTS tender_blocks JSONB;
