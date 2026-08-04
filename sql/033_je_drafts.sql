-- Bank Rec Agent: reads an uploaded bank statement and drafts the journal
-- entry for each line, so staff review/approve instead of entering JEs one
-- by one. Two deliberate approval gates, mirroring how the user described
-- the workflow: approving a draft posts the JE to the real GL but does NOT
-- reconcile it; a separate "Ready to Reconcile" confirmation (reusing the
-- existing /bank-rec/:lineId/match route) is required before the bank line
-- is marked matched. Categorization is rule-based only (no LLM/AI call),
-- matching the same "in-app deterministic automation" decision already made
-- for the Payroll Agent (see 026_payroll_agent.sql).

CREATE TABLE IF NOT EXISTS altax.v3_je_category_rules (
    rule_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    -- Matched case-insensitively as a substring against a bank line's
    -- description. Client-scoped, not bank-account-scoped.
    match_text VARCHAR(255) NOT NULL,
    -- v3_coa.account_name — free-text convention every other accounting
    -- feature in this app already uses; not FK-enforced since COA rows are
    -- keyed by that string, not a stable id, across the codebase.
    account_name VARCHAR(255) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v3_je_category_rules_client_active ON altax.v3_je_category_rules(client_id, active);

CREATE TABLE IF NOT EXISTS altax.v3_je_drafts (
    je_draft_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    client_name VARCHAR(255),
    -- One draft per bank line, ever — cascades automatically when a Pending
    -- draft's line is deleted (nothing posted yet, nothing to orphan). An
    -- Approved draft's line must be blocked from deletion at the app layer
    -- instead, since cascading there would silently orphan a posted GL entry.
    bank_line_id VARCHAR(64) NOT NULL UNIQUE REFERENCES altax.v3_bank_statement_lines(line_id) ON DELETE CASCADE,
    bank_account_name VARCHAR(255) NOT NULL,
    amount NUMERIC(14,2) NOT NULL,
    description TEXT,
    -- NULL = no rule matched; staff must pick an account before approving.
    suggested_account VARCHAR(255),
    matched_rule_id VARCHAR(64) REFERENCES altax.v3_je_category_rules(rule_id) ON DELETE SET NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'Pending',
    -- {account, description} if staff edits before approving.
    staff_overrides JSONB,
    -- Set on approve: the bank-side GL entry id (exactly what the existing
    -- /bank-rec/:lineId/match route needs as glEntryId for Stage 2) and the
    -- shared jeId ref (for the GL tab's existing ?ref= full-entry viewer).
    resulting_gl_entry_id VARCHAR(64),
    resulting_je_ref VARCHAR(64),
    dismissed_reason TEXT,
    approved_by VARCHAR(255),
    approved_at TIMESTAMPTZ,
    dismissed_by VARCHAR(255),
    dismissed_at TIMESTAMPTZ,
    source_system VARCHAR(255) DEFAULT 'Bank Rec Agent',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_v3_je_drafts_status CHECK (status IN ('Pending','Approved','Dismissed'))
);
CREATE INDEX IF NOT EXISTS idx_v3_je_drafts_status ON altax.v3_je_drafts(status);
CREATE INDEX IF NOT EXISTS idx_v3_je_drafts_client ON altax.v3_je_drafts(client_id, status);
