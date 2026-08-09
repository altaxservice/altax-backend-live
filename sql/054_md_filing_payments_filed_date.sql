-- Splits the single "paid_date" this table used to store into two real facts:
-- when the return was FILED (submitted to Maryland) and when the tax was
-- PAID (funds sent/cleared) — previously treated as always the same day.
-- MD's timely discount legally requires BOTH to be on/before the due date
-- (see src/common/mdFiling.ts's computeMdFiling), so both need their own
-- column now. Existing rows only ever recorded one date, so backfill
-- filed_date from the old paid_date (the closest honest guess: prior to
-- this migration staff had no way to enter a different filing date anyway).
ALTER TABLE altax.v3_md_filing_payments
    ADD COLUMN IF NOT EXISTS filed_date DATE;

UPDATE altax.v3_md_filing_payments SET filed_date = paid_date WHERE filed_date IS NULL;

ALTER TABLE altax.v3_md_filing_payments ALTER COLUMN filed_date SET NOT NULL;
