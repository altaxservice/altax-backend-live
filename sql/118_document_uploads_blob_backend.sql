-- Tracks where an upload's actual bytes live: 'postgres' (file_data column, the
-- only option until now) or 'r2' (Cloudflare R2 object storage, key = upload_id).
-- New uploads go straight to 'r2' once R2 is configured; existing rows stay
-- 'postgres' until the one-time backfill script (scripts/backfillUploadsToR2.ts)
-- moves them over and flips this.
ALTER TABLE altax.v3_document_uploads
  ADD COLUMN IF NOT EXISTS blob_backend VARCHAR(16) NOT NULL DEFAULT 'postgres';
