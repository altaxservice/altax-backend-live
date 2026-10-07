-- Permit tracker for a new or changed business location: the zoning use permit, certificate of occupancy
-- (the "use and occupancy" number), fire marshal inspection, health permit, trader's license and tobacco license.
-- The numbers live on v3_clients next to the existing use_and_occupancy / fire_dept / traders / health columns
-- (one place per number, and the Health Permits generator already reads them there); this table only holds the
-- progress of each item: status, issue/expiry dates and notes.
ALTER TABLE altax.v3_clients
    ADD COLUMN IF NOT EXISTS zoning_use_permit_number VARCHAR(255),
    ADD COLUMN IF NOT EXISTS tobacco_license_number VARCHAR(255);

CREATE TABLE IF NOT EXISTS altax.v3_client_permits (
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    permit_key VARCHAR(32) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'Not Started',
    issued_date DATE,
    expires_date DATE,
    notes TEXT,
    updated_by VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, permit_key)
);
