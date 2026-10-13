-- Document Builder e-signing: one row per person who has to sign a built document (seller, buyer, each member, the firm…).
-- Each signer has their own private link; the document counts as Signed (v3_client_contracts.status) only when every signer has signed.
CREATE TABLE IF NOT EXISTS altax.v3_doc_signers (
  signer_id VARCHAR(64) PRIMARY KEY,
  doc_id VARCHAR(64) NOT NULL,
  contract_id VARCHAR(64) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  role_label VARCHAR(120) NOT NULL,
  signer_name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  delivery VARCHAR(16) NOT NULL DEFAULT 'email',
  share_token VARCHAR(64) UNIQUE,
  status VARCHAR(16) NOT NULL DEFAULT 'Pending',
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  decline_reason TEXT,
  signed_name VARCHAR(255),
  signature_image TEXT,
  signer_ip VARCHAR(64),
  signer_user_agent TEXT,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  last_reminder_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v3_doc_signers_doc ON altax.v3_doc_signers(doc_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_v3_doc_signers_contract ON altax.v3_doc_signers(contract_id);
