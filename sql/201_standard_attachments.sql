-- Standard attachments: an official PDF kept once and appended to every PDF of certain Document Builder documents
-- (e.g. the Maryland Tenants' Bill of Rights, which must be attached to every residential lease and is reissued each October 1).
CREATE TABLE IF NOT EXISTS altax.v3_standard_attachments (
  attach_key VARCHAR(100) PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  edition_label VARCHAR(100) NOT NULL DEFAULT '',
  valid_from DATE,
  content BYTEA NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  uploaded_by VARCHAR(255),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
