-- Page Notes: a note pinned to a page of the app (optionally to one tab of it) that shows at the top of that page for staff.
-- Per-user state remembers what each person has already acknowledged, so a note re-opens when it changes or when a new day starts.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS altax.v3_page_notes (
  note_id         VARCHAR(64) PRIMARY KEY,
  page_key        VARCHAR(120) NOT NULL,
  tab             VARCHAR(80),
  title           VARCHAR(120),
  body            TEXT NOT NULL,
  priority        VARCHAR(12) NOT NULL DEFAULT 'Info',
  visibility      VARCHAR(8)  NOT NULL DEFAULT 'firm',
  show_from       DATE,
  show_until      DATE,
  created_by      VARCHAR(255) NOT NULL,
  created_by_name VARCHAR(255),
  updated_by      VARCHAR(255),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v3_page_notes_page ON altax.v3_page_notes (page_key);
CREATE TABLE IF NOT EXISTS altax.v3_page_note_state (
  note_id       VARCHAR(64) NOT NULL REFERENCES altax.v3_page_notes(note_id) ON DELETE CASCADE,
  user_email    VARCHAR(255) NOT NULL,
  acked_version TIMESTAMPTZ NOT NULL,
  acked_on      DATE NOT NULL,
  PRIMARY KEY (note_id, user_email)
);
