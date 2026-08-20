-- Splits "mark filed" from "record payment" as two independently-recordable
-- events (Save & Send filing-confirmation feature). Previously filed_date
-- and paid_date were both required in the same request (reports.routes.ts's
-- old /md-filing/:clientId/mark-paid), which made it structurally impossible
-- to record "we filed this return, payment not sent yet." balance_due/
-- on_time depend on both dates (computeMdFiling) and are meaningless until
-- paid_date is known, so they're nullable too — a filed-but-unpaid row
-- deliberately leaves them NULL rather than a fabricated "as of today"
-- figure that would silently drift on every page load.
ALTER TABLE altax.v3_md_filing_payments ALTER COLUMN paid_date DROP NOT NULL;
ALTER TABLE altax.v3_md_filing_payments ALTER COLUMN balance_due DROP NOT NULL;
ALTER TABLE altax.v3_md_filing_payments ALTER COLUMN on_time DROP NOT NULL;
