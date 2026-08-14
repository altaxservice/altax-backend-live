-- BC-008 (hard audit, 2026-08-13) — durable storage for a rotated JWT signing
-- secret. /system/diagnostics/rotate-jwt-secret previously only mutated
-- process.env.JWT_SECRET in memory; a server restart before the admin
-- manually copied the new value into .env silently reverted the rotation.
-- Single-row table, same pattern as v3_firm_settings.
CREATE TABLE IF NOT EXISTS altax.v3_jwt_secret_rotation (
    id VARCHAR(16) PRIMARY KEY DEFAULT 'JWT-1',
    secret TEXT NOT NULL,
    rotated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_by VARCHAR(255)
);
