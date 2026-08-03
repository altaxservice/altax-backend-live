-- Firm-wide, admin-managed colored labels — a name + a hex color, reusable
-- across any record type in the app (Tasks and Clients to start; the
-- entity_type column keeps this open to more without another migration).
CREATE TABLE IF NOT EXISTS altax.v3_labels (
    label_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7) NOT NULL DEFAULT '#0f2d3e',
    created_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_v3_labels_color CHECK (color ~ '^#[0-9a-fA-F]{6}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_v3_labels_name ON altax.v3_labels(lower(name));

-- Polymorphic assignment: which labels are on which record. entity_type is a
-- free short code ('task', 'client', ...) rather than a hard enum/FK, so a
-- future entity type (invoices, appointments, ...) needs no schema change —
-- only a new UI wiring point, same open-ended shape as v3_document_uploads'
-- own entity linkage elsewhere in this app.
CREATE TABLE IF NOT EXISTS altax.v3_entity_labels (
    entity_type VARCHAR(32) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    label_id VARCHAR(64) NOT NULL REFERENCES altax.v3_labels(label_id) ON DELETE CASCADE,
    assigned_by VARCHAR(255),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (entity_type, entity_id, label_id)
);
CREATE INDEX IF NOT EXISTS idx_v3_entity_labels_entity ON altax.v3_entity_labels(entity_type, entity_id);
