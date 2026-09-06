-- Tax depreciation (Section 179 + Bonus + MACRS) for Fixed Assets, alongside
-- the existing straight-line-only path. Added after reviewing a real client's
-- filed Form 4562: their $3,510 book depreciation on a $6,750 asset wasn't
-- straight-line at all, it was 40% bonus depreciation + Year-1 MACRS
-- (5-year, half-year convention) on the remaining basis, verified to the
-- penny. Scoped to 5-year/7-year property, half-year convention only — see
-- src/common/macrsTables.ts.
ALTER TABLE altax.v3_fixed_assets
  ADD COLUMN IF NOT EXISTS section_179_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_depreciation_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS macrs_property_class VARCHAR(16),
  ADD COLUMN IF NOT EXISTS macrs_convention VARCHAR(16) NOT NULL DEFAULT 'Half-Year';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_fixed_assets_depreciation_method') THEN
    ALTER TABLE altax.v3_fixed_assets
      ADD CONSTRAINT chk_fixed_assets_depreciation_method CHECK (depreciation_method IN ('Straight-Line','MACRS'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_fixed_assets_macrs_class') THEN
    ALTER TABLE altax.v3_fixed_assets
      ADD CONSTRAINT chk_fixed_assets_macrs_class CHECK (macrs_property_class IS NULL OR macrs_property_class IN ('5-Year','7-Year'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_fixed_assets_macrs_convention') THEN
    ALTER TABLE altax.v3_fixed_assets
      ADD CONSTRAINT chk_fixed_assets_macrs_convention CHECK (macrs_convention = 'Half-Year');
  END IF;
END $$;
