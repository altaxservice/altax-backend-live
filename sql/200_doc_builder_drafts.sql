-- Document Builder: documents the user started but has not finished. Saved as they go so nothing is lost if the page closes.
CREATE TABLE IF NOT EXISTS altax.v3_doc_builder_drafts (
  draft_id VARCHAR(64) PRIMARY KEY,
  template_key VARCHAR(100) NOT NULL,
  client_id VARCHAR(64) REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
  lang VARCHAR(8) NOT NULL DEFAULT 'en',
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  step INTEGER NOT NULL DEFAULT 0,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v3_doc_builder_drafts_owner ON altax.v3_doc_builder_drafts (lower(created_by), updated_at DESC);
