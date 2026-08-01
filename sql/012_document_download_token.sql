-- The unauthenticated "anyone with the link" download path (documents.routes.ts
-- GET /uploads/:uploadId/download) relied solely on uploadId being hard to guess —
-- but uploadId is only a timestamp + 3-digit Math.random() suffix (~900 real
-- possibilities), not a real secret. This adds a genuinely random per-upload token
-- (same shape as contracts'/invoices' share_token) required for any unauthenticated
-- download going forward; authenticated requests are separately gated by an
-- ownership check added in the same change.
ALTER TABLE altax.v3_document_uploads ADD COLUMN IF NOT EXISTS download_token VARCHAR(64);
