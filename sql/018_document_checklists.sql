-- Per-engagement-type document checklists — an internal staff-facing "did we
-- collect everything we need" tracker, distinct from Document Requests (which
-- ask the CLIENT to upload something). A template applies to a client_type
-- ('Business'/'Individual'/NULL = either) and/or a FIRM_SERVICES service_key
-- (NULL = applies regardless of which services are checked).
CREATE TABLE IF NOT EXISTS altax.v3_document_checklists (
    checklist_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    client_type VARCHAR(32),
    service_key VARCHAR(64),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS altax.v3_document_checklist_items (
    item_id VARCHAR(64) PRIMARY KEY,
    checklist_id VARCHAR(64) NOT NULL REFERENCES altax.v3_document_checklists(checklist_id) ON DELETE CASCADE,
    document_name VARCHAR(255) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v3_document_checklist_items_checklist ON altax.v3_document_checklist_items(checklist_id);

-- One row per (client, item) once a matching template's items have been applied
-- to that client — lazily synced on read (GET /clients/:clientId/checklist),
-- so editing a template or a client's services later just adds/removes the
-- newly-(mis)matching rows next time the tracker is viewed, rather than needing
-- a separate "apply" action or a save-time hook.
CREATE TABLE IF NOT EXISTS altax.v3_client_checklist_progress (
    progress_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    checklist_id VARCHAR(64) NOT NULL REFERENCES altax.v3_document_checklists(checklist_id) ON DELETE CASCADE,
    item_id VARCHAR(64) NOT NULL REFERENCES altax.v3_document_checklist_items(item_id) ON DELETE CASCADE,
    checked BOOLEAN NOT NULL DEFAULT FALSE,
    checked_at TIMESTAMPTZ,
    checked_by VARCHAR(255),
    linked_upload_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_v3_client_checklist_progress_item UNIQUE (client_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_v3_client_checklist_progress_client ON altax.v3_client_checklist_progress(client_id);
