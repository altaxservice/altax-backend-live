-- Gives MD Sales Tax, Form 941, MD UI, and Annual Report the same
-- independently-triggerable "Send" action EFTPS already has
-- (v3_eftps_deposits.status flips to 'Sent' via POST /:depositId/send,
-- re-triggerable any time after filing, not just as a one-time choice at
-- mark-filed). None of these four tables track "was the confirmation email
-- actually sent" as its own fact — only whether `notify` was requested at
-- mark-filed time, which is a request, not a delivery record, and gives no
-- way to (re-)send after the fact if a client says they never got it.
ALTER TABLE altax.v3_md_filing_payments ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE altax.v3_form941_filings ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE altax.v3_md_ui_filings ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE altax.v3_annual_report_filings ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
