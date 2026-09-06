-- Fixed Assets register — client-scoped asset purchases with straight-line
-- depreciation. v3_coa is firm-wide (no client_id) and has no purchase date,
-- cost, or useful life — an actual asset purchase (which client, which date,
-- how much, how long it depreciates) is inherently per-client data with
-- nowhere to live until now. Discovered via a real client's Balance Sheet
-- showing $3,510 of Accumulated Depreciation with no underlying asset ever
-- recorded. No separate depreciation-history table: accumulated depreciation
-- and "already posted this year?" are both derived from v3_gl_entries via the
-- source_system/source_record_id convention already used by
-- ensureEftpsStaffTasks and the Recurring Billing Sweep.
CREATE TABLE IF NOT EXISTS altax.v3_fixed_assets (
  asset_id VARCHAR(64) PRIMARY KEY,
  client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id),
  asset_name VARCHAR(255) NOT NULL,
  account_name VARCHAR(255) NOT NULL,
  asset_class VARCHAR(16) NOT NULL DEFAULT 'Fixed' CHECK (asset_class IN ('Current','Fixed')),
  purchase_date DATE NOT NULL,
  cost NUMERIC(14,2) NOT NULL,
  salvage_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  useful_life_years NUMERIC(5,2),
  depreciation_method VARCHAR(32) NOT NULL DEFAULT 'Straight-Line',
  offset_account VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Disposed')),
  disposed_date DATE,
  notes TEXT,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_client ON altax.v3_fixed_assets(client_id);
