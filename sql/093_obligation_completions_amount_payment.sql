-- Extends the lightweight obligation "Mark Done" table (sql/057) with an
-- amount and a real paid_date, so EFTPS/MD Withholding/MD UI/Federal Payroll
-- Tax/Business Tax Return/Individual Tax Return/Estimated Tax/MD Annual
-- Report/1099-W-2 deposits can go through the same Save & Send + payment-due
-- reminder flow as MD Sales Tax and task-tracked filings.
--
-- completed_date keeps its existing meaning (functionally "the day staff
-- marked/handled this," i.e. the filed date); paid_date is new and
-- independent, defaulting to NULL (payment pending) until recorded
-- separately via the new record-payment route.
ALTER TABLE altax.v3_obligation_completions
    ADD COLUMN IF NOT EXISTS amount NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS paid_date DATE;
