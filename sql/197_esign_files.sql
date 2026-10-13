-- E-Sign tab: a PDF uploaded to be signed (instead of a document built from a template). Stored encrypted, like client document uploads.
CREATE TABLE IF NOT EXISTS altax.v3_esign_files (
  doc_id VARCHAR(64) PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  mime VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  size_bytes INTEGER NOT NULL,
  page_count INTEGER NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  file_data TEXT,
  blob_backend VARCHAR(16) NOT NULL DEFAULT 'postgres',
  uploaded_by VARCHAR(255),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
