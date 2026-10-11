-- Sales tender split: how a day's sales were actually paid. Cash is always "the rest" (collected total - card - EBT), so
-- only card and EBT are stored. NULL = a legacy / not-specified sale, treated as 100% cash exactly as before.
-- Card and EBT money is not in the bank until the processor / state deposits it, so each sale's card and EBT portions are
-- also tracked as open "clearing" items until a bank deposit is matched against them (Bank Rec → Card / EBT deposit).
ALTER TABLE altax.v3_sales_input ADD COLUMN IF NOT EXISTS tender_card NUMERIC(14,2);
ALTER TABLE altax.v3_sales_input ADD COLUMN IF NOT EXISTS tender_ebt NUMERIC(14,2);
ALTER TABLE altax.v3_client_sales_drafts ADD COLUMN IF NOT EXISTS tender_card NUMERIC(14,2);
ALTER TABLE altax.v3_client_sales_drafts ADD COLUMN IF NOT EXISTS tender_ebt NUMERIC(14,2);

CREATE TABLE IF NOT EXISTS altax.v3_tender_clearing (
    clearing_id SERIAL PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    sale_id VARCHAR(64) NOT NULL,
    tender VARCHAR(8) NOT NULL CHECK (tender IN ('card', 'ebt')),
    amount NUMERIC(14,2) NOT NULL,
    sale_date DATE,
    cleared_at TIMESTAMPTZ,
    cleared_by VARCHAR(255),
    bank_line_id VARCHAR(64),
    clearing_ref VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tender_clearing_client_open ON altax.v3_tender_clearing (client_id, sale_date) WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tender_clearing_sale ON altax.v3_tender_clearing (sale_id);
CREATE INDEX IF NOT EXISTS idx_tender_clearing_line ON altax.v3_tender_clearing (bank_line_id);
