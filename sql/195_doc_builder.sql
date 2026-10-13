-- Document Builder: every document made from a guided questionnaire keeps its answers, so it can be re-opened, duplicated or re-created.
-- The finished text itself lives in v3_client_contracts (service_key = 'doc_<template>'), which gives it sending, e-signing and PDFs for free.
CREATE TABLE IF NOT EXISTS altax.v3_doc_builder_docs (
  doc_id VARCHAR(64) PRIMARY KEY,
  client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
  template_key VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  answers JSONB NOT NULL,
  contract_id VARCHAR(64),
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v3_doc_builder_docs_client ON altax.v3_doc_builder_docs(client_id, created_at DESC);
