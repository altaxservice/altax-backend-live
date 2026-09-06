-- "Manual (Drake-computed)" depreciation method — for anything beyond the
-- verified 5-year/7-year 200% DB / half-year path (150% DB, Mid-Quarter,
-- real property Mid-Month, etc.), staff enters the amount the firm's actual
-- tax software (Drake) already computed for that year instead of this app
-- trying to independently reproduce IRS tables it can't verify against a
-- real return. Drake stays the source of truth for the harder tax math;
-- this just keeps the books in sync with it. macrs_property_class is
-- intentionally left unconstrained to a fixed list for this method — it's
-- a free-text label for staff's own reference (e.g. "27.5-yr S/L, MM"),
-- not something this app calculates from.
ALTER TABLE altax.v3_fixed_assets
  DROP CONSTRAINT IF EXISTS chk_fixed_assets_depreciation_method;
ALTER TABLE altax.v3_fixed_assets
  ADD CONSTRAINT chk_fixed_assets_depreciation_method CHECK (depreciation_method IN ('Straight-Line','MACRS','Manual'));
ALTER TABLE altax.v3_fixed_assets
  ADD COLUMN IF NOT EXISTS manual_method_label VARCHAR(128);
