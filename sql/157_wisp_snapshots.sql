-- A staff acknowledgment previously only logged a name + timestamp against a
-- "version" that was really just a date — the PDF itself was regenerated live
-- on every view, so if the policy text ever changed later, pulling up "version
-- 2026-09-16" a year from now would silently render the NEW wording under the
-- OLD acknowledgment date. That's not real proof of what someone actually read
-- and signed off on. This table freezes the exact PDF bytes at the moment a
-- version is adopted or marked reviewed (see compliance.routes.ts's
-- ensureWispSnapshot), reusing the same encrypted blob storage as client
-- document uploads (src/common/uploadBlobStorage.ts) — an acknowledgment now
-- points at an immutable document, not a regenerable one.
CREATE TABLE IF NOT EXISTS altax.v3_wisp_snapshots (
    version DATE PRIMARY KEY,
    file_data TEXT,
    blob_backend VARCHAR(16) NOT NULL DEFAULT 'postgres',
    file_size INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(255)
);
