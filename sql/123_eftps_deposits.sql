-- EFTPS federal payroll tax deposit workflow — direct owner ask, 2026-08-29.
-- Header + line-item child table (not a JSON blob), same convention as
-- v3_invoice_line_items/v3_estimate_lines. federal_income_tax_total/
-- social_security_total/medicare_total/total_amount are computed once at
-- Save time from the imported Drake reports and never recomputed live —
-- same "snapshot, not a live reference" rule invoices already follow.
--
-- share_token/acknowledged_at/acknowledged_ip mirror v3_client_contracts'
-- token-gated client acknowledge pattern exactly (see publicContract.routes.ts).
CREATE TABLE IF NOT EXISTS altax.v3_eftps_deposits (
    deposit_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    due_date DATE NOT NULL,
    filing_date DATE,
    payment_date DATE,
    federal_income_tax_total NUMERIC(14,2) NOT NULL DEFAULT 0,
    social_security_total NUMERIC(14,2) NOT NULL DEFAULT 0,
    medicare_total NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    -- Whether the per-employee breakdown summed to the same figure as
    -- Drake's own authoritative "941 Total" row — a real mismatch here
    -- means a staff review is needed before this number is trusted.
    reconciliation_status VARCHAR(16) NOT NULL DEFAULT 'Matched' CHECK (reconciliation_status IN ('Matched', 'Mismatch')),
    status VARCHAR(16) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Filed', 'Sent')),
    share_token VARCHAR(64) UNIQUE,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_ip VARCHAR(64),
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One deposit per client per period — the generic obligation-completion
    -- upsert already guards (client, source, due_date), this guards the
    -- richer record the same way.
    UNIQUE (client_id, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS altax.v3_eftps_deposit_lines (
    line_id VARCHAR(64) PRIMARY KEY,
    deposit_id VARCHAR(64) NOT NULL REFERENCES altax.v3_eftps_deposits(deposit_id) ON DELETE CASCADE,
    employee_name VARCHAR(255) NOT NULL,
    federal_income_tax NUMERIC(14,2) NOT NULL DEFAULT 0,
    social_security NUMERIC(14,2) NOT NULL DEFAULT 0,
    medicare NUMERIC(14,2) NOT NULL DEFAULT 0,
    subtotal NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_eftps_deposit_lines_deposit ON altax.v3_eftps_deposit_lines (deposit_id);
CREATE INDEX IF NOT EXISTS idx_eftps_deposits_client ON altax.v3_eftps_deposits (client_id);
