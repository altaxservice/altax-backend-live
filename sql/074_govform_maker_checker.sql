-- TAX-004 (Hard Audit, 2026-08-13) — optional second-approver step before a
-- government filing is marked Submitted. NULL review_status means "no review
-- requested," the default and unchanged solo-submit path. Admin-only approval,
-- staff's choice whether to request it (see govForms.routes.ts).
ALTER TABLE altax.v3_gov_form_filings
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS review_requested_by VARCHAR(255),
  ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_note TEXT;
