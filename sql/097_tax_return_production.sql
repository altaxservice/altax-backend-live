-- Tax Return Production tracking (Firm Command Center gap analysis, item
-- #8). Confirmed directly with the user (2026-08-20): return preparation
-- has NEVER been tracked in this system — every real v3_tasks row is
-- recurring compliance work (Sales Tax Filing, Payroll, MD Withholding,
-- EFTPS), nothing for the annual "prepare and file the return" workflow,
-- even though 141 of 158 real clients have a business_return_type on file.
-- This is new operational capability, not a report over existing data.
--
-- One row per client per tax year (a client can have at most one active
-- return per year — an amended return reuses the same row, tracked via
-- status history in v3_communications/audit log rather than a second row).
CREATE TABLE IF NOT EXISTS altax.v3_tax_returns (
    tax_return_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    tax_year INTEGER NOT NULL,
    return_type VARCHAR(64) NOT NULL, -- 1120S | 1120 | Schedule C | 1040 | 1065 | ...
    status VARCHAR(32) NOT NULL DEFAULT 'Not Started',
    -- Not Started | Documents Requested | Documents Received | In Preparation |
    -- Missing Information | Review | Client Approval | E-file Ready | Filed |
    -- Accepted | Rejected | Completed
    preparer VARCHAR(255),
    reviewer VARCHAR(255),
    extension_filed BOOLEAN NOT NULL DEFAULT FALSE,
    due_date DATE,
    filed_date DATE,
    accepted_date DATE,
    rejection_reason TEXT,
    notes TEXT,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (client_id, tax_year)
);

CREATE INDEX IF NOT EXISTS idx_v3_tax_returns_status ON altax.v3_tax_returns(status) WHERE status NOT IN ('Completed', 'Accepted');
CREATE INDEX IF NOT EXISTS idx_v3_tax_returns_client ON altax.v3_tax_returns(client_id);
