-- Lets a client attach a receipt photo to a purchase/expense they logged in
-- the client portal (v3_client_purchase_drafts), reusing the existing
-- v3_document_uploads pipeline (encryption, R2-or-Postgres blob storage,
-- download tokens) instead of a separate upload path.
-- ON DELETE SET NULL (not CASCADE): deleting a purchase draft must never
-- silently delete the uploaded receipt evidence -- the photo survives as an
-- orphaned-but-recoverable upload.
ALTER TABLE altax.v3_document_uploads
  ADD COLUMN IF NOT EXISTS purchase_draft_id VARCHAR(64) REFERENCES altax.v3_client_purchase_drafts(draft_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_v3_document_uploads_purchase_draft ON altax.v3_document_uploads(purchase_draft_id) WHERE purchase_draft_id IS NOT NULL;
