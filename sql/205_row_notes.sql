-- Row Notes: a short note attached to one row of any table, one card or one amount (a filing period, an invoice, a client...).
-- entity_type + client_id + entity_key identify the row, so the same row shows the same note everywhere it appears.
-- "attention" flags a problem (the icon turns red and the note is listed on the Command Center until someone marks it resolved).
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS altax.v3_row_notes (
  note_id         VARCHAR(64) PRIMARY KEY,
  entity_type     VARCHAR(40)  NOT NULL,
  client_id       VARCHAR(64)  NOT NULL DEFAULT '',
  entity_key      VARCHAR(200) NOT NULL,
  label           VARCHAR(240),
  link            VARCHAR(400),
  body            TEXT NOT NULL,
  attention       BOOLEAN NOT NULL DEFAULT false,
  resolved_at     TIMESTAMPTZ,
  resolved_by     VARCHAR(255),
  created_by      VARCHAR(255) NOT NULL,
  created_by_name VARCHAR(255),
  updated_by      VARCHAR(255),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, client_id, entity_key)
);
CREATE INDEX IF NOT EXISTS idx_v3_row_notes_lookup ON altax.v3_row_notes (entity_type, client_id);
CREATE INDEX IF NOT EXISTS idx_v3_row_notes_open_attention ON altax.v3_row_notes (updated_at DESC) WHERE attention AND resolved_at IS NULL;
