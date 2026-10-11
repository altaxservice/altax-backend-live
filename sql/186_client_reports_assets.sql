-- Client portal: Reports + Assets.
-- 1) Official financial statements (P&L, Balance Sheet from the posted ledger) are shown to a client in their portal only
--    after staff turn this on — books that aren't reconciled yet must never surface as "official" numbers.
ALTER TABLE altax.v3_clients ADD COLUMN IF NOT EXISTS portal_financial_reports_enabled BOOLEAN NOT NULL DEFAULT false;

-- 2) Assets a client reports from their portal (a purchase of equipment, a vehicle, furniture...). Staff review each one and
--    record it with the right accounts/depreciation; nothing posts to the ledger from a draft.
CREATE TABLE IF NOT EXISTS altax.v3_client_asset_drafts (
    draft_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    client_name VARCHAR(255),
    asset_name VARCHAR(255) NOT NULL,
    category VARCHAR(64),
    purchase_date DATE NOT NULL,
    cost NUMERIC(14,2) NOT NULL,
    vendor_name VARCHAR(255),
    notes TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'Pending',
    submitted_by VARCHAR(255),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_by VARCHAR(255),
    approved_at TIMESTAMPTZ,
    resulting_asset_id VARCHAR(64),
    dismissed_by VARCHAR(255),
    dismissed_at TIMESTAMPTZ,
    dismissed_reason TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_asset_drafts_client ON altax.v3_client_asset_drafts (client_id, status);
