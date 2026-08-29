-- Backs the system-wide "remember what I typed" feature (direct owner ask,
-- 2026-08-29): staff-only, firm-wide shared suggestion memory for short
-- operational text fields (agency names, notice types, product/service
-- names, etc.) -- NOT narrative Notes/Description fields, which are
-- deliberately excluded on the frontend to avoid pooling client-specific
-- confidential commentary across the whole firm. One row per distinct
-- value ever seen for a given field, upserted (not duplicated) on reuse.
CREATE TABLE altax.v3_field_suggestions (
    field_key VARCHAR(255) NOT NULL,
    value VARCHAR(500) NOT NULL,
    use_count INT NOT NULL DEFAULT 1,
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (field_key, value)
);

CREATE INDEX v3_field_suggestions_lookup_idx
    ON altax.v3_field_suggestions (field_key, use_count DESC, last_used_at DESC);
