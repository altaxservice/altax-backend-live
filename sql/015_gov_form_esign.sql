-- Lets staff send a Draft W-4/W-9 filing to the employee's own portal to fill in
-- and electronically sign, instead of only the existing staff-fills-and-prints flow.
ALTER TABLE altax.v3_gov_form_filings ADD COLUMN IF NOT EXISTS sent_to_employee_at TIMESTAMPTZ;
-- Audit-trail companion to the existing signer_name/signed_at columns, captured
-- only for the new self-serve e-sign path (the staff-recorded in-person /sign
-- route has no IP to capture — that signature happened on paper, in the room).
ALTER TABLE altax.v3_gov_form_filings ADD COLUMN IF NOT EXISTS signer_ip VARCHAR(64);
-- Points at the v3_document_uploads row the signed PDF was auto-attached as,
-- so the filing record and the employee's Documents tab can cross-reference
-- each other instead of only being findable by matching dates.
ALTER TABLE altax.v3_gov_form_filings ADD COLUMN IF NOT EXISTS attached_upload_id VARCHAR(64);
