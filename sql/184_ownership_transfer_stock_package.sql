-- Stock Transfer Package (sale of a Maryland corporation's shares): whether it is part of this transfer, and the
-- corporation facts the documents need (SDAT ID, stock vs. close, shares, par value, per-person share counts,
-- officers, directors, resident agent). Stored as one JSON object; see sanitizeStockDetails in ownershipTransfer.routes.ts.
ALTER TABLE altax.v3_ownership_transfers
  ADD COLUMN IF NOT EXISTS include_stock_package BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stock_details JSONB;
