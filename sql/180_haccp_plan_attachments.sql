-- Files attached to a health permit plan so the whole submission can be printed as one packet: the manufacturer's
-- equipment cut sheet for each piece of equipment, the certificate of occupancy, the zoning use permit and anything
-- else the reviewer asks for. The file content goes through the same encrypted blob storage as every other upload
-- (Postgres, or R2 when configured); this table holds the metadata.
CREATE TABLE IF NOT EXISTS altax.v3_haccp_plan_attachments (
    attachment_id VARCHAR(64) PRIMARY KEY,
    plan_id VARCHAR(64) NOT NULL REFERENCES altax.v3_haccp_plans(plan_id) ON DELETE CASCADE,
    kind VARCHAR(24) NOT NULL CHECK (kind IN ('cut_sheet','occupancy','zoning','other')),
    equipment_key VARCHAR(120),
    label VARCHAR(255),
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL,
    file_data TEXT,
    blob_backend VARCHAR(16) NOT NULL DEFAULT 'postgres',
    uploaded_by VARCHAR(255),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_haccp_plan_attachments_plan ON altax.v3_haccp_plan_attachments (plan_id);
