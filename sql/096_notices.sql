-- IRS/state notice tracking (Firm Command Center gap analysis, item #24:
-- Notices & Resolution Report). Previously the only thing resembling
-- "notices" was GET /clients/:clientId/notices/mine, which is actually just
-- computeClientFlags() relabeled — no agency/notice-type/tax-period/amount/
-- deadline fields at all. This is a real, separate tracked record.
CREATE TABLE IF NOT EXISTS altax.v3_notices (
    notice_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    agency VARCHAR(255) NOT NULL,
    notice_type VARCHAR(255) NOT NULL,
    tax_period VARCHAR(255),
    amount NUMERIC(14,2),
    received_date DATE NOT NULL,
    response_deadline DATE,
    assigned_to VARCHAR(255),
    status VARCHAR(32) NOT NULL DEFAULT 'Open', -- Open | Response Filed | Resolved
    response_filed_date DATE,
    follow_up_date DATE,
    resolution TEXT,
    notes TEXT,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_notices_client ON altax.v3_notices(client_id);
CREATE INDEX IF NOT EXISTS idx_v3_notices_deadline ON altax.v3_notices(response_deadline) WHERE status <> 'Resolved';
