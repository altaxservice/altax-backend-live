-- Per-staff-member read state for the client panel's "Client Note"/"Task Note"
-- unread counters. Polymorphic on purpose: client notes (v3_client_activity_log)
-- and task notes (v3_communications, channel='Task Note') are different tables
-- with different PK columns, but both PKs are VARCHAR(64) — one shared
-- entity_id avoids maintaining two structurally-identical tables and two
-- separate mark-read/unread-count code paths. entity_id isn't a real FK (no
-- single parent table to point at); trusted at the application layer, same as
-- v3_client_flags.link_task_id and similar loosely-typed references already
-- do elsewhere in this schema. An orphaned read row left behind by a hard
-- delete is harmless (never joined against again) — the delete routes clean
-- these up explicitly anyway.
CREATE TABLE IF NOT EXISTS altax.v3_activity_reads (
    entity_type   VARCHAR(16) NOT NULL CHECK (entity_type IN ('client_note', 'task_note')),
    entity_id     VARCHAR(64) NOT NULL,
    reader_email  VARCHAR(255) NOT NULL,
    read_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (entity_type, entity_id, reader_email)
);

-- Powers "how many of this client's items has THIS reader not seen yet" — the
-- query pattern both the unread-count and mark-read endpoints use.
CREATE INDEX IF NOT EXISTS idx_v3_activity_reads_reader ON altax.v3_activity_reads(reader_email, entity_type, entity_id);
