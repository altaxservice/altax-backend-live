-- Structured findings layer for the SWOT/Business Advisory tab
-- (altax.v3_client_swot) — that table stays as the free-text "executive
-- summary" prose staff write for a client conversation; this adds discrete,
-- trackable findings/action items alongside it, each carrying exactly the
-- 8 elements a real advisory finding needs: the finding, supporting data,
-- business impact, priority, recommended action, owner, target date, and
-- status. See src/modules/clients/swotFindingsEngine.ts.

CREATE TABLE IF NOT EXISTS altax.v3_swot_findings (
    finding_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    category VARCHAR(16) NOT NULL CHECK (category IN ('Strength','Weakness','Opportunity','Threat','Recommendation')),
    -- Only meaningful when category='Recommendation' — lets tax/staffing/marketing/
    -- growth/cost-reduction/revenue-growth/cash-flow/compliance recommendations
    -- each carry their own priority/owner/due-date/status without diluting the
    -- classic 4-box S/W/O/T categories.
    subcategory VARCHAR(24) CHECK (subcategory IN ('Tax','Staffing','Marketing','Growth','CostReduction','RevenueGrowth','CashFlow','Compliance')),
    finding_text TEXT NOT NULL,
    -- Sentence-style, referencing a real number (e.g. "Balance due: $4,230
    -- across 2 invoices as of today") — never a raw JSON blob shown to a
    -- nontechnical user.
    supporting_data TEXT NOT NULL,
    business_impact TEXT,
    priority VARCHAR(8) NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Urgent')),
    recommended_action TEXT,
    responsible_party VARCHAR(255),
    target_date DATE,
    status VARCHAR(16) NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Resolved','Dismissed')),
    source VARCHAR(8) NOT NULL DEFAULT 'Manual' CHECK (source IN ('Auto','Manual')),
    -- Separates facts from assumptions/estimates/recommendations, per the
    -- explicit "don't blur these together" requirement.
    data_type VARCHAR(16) NOT NULL DEFAULT 'Fact' CHECK (data_type IN ('Fact','Estimate','Assumption','Recommendation')),
    -- Stable identity of WHICH rule produced this (e.g. 'revenue_decline',
    -- 'overdue_ar:INV-2026-004', 'md_filing_late:2026-06'). Null for Manual
    -- findings. Drives both dedup (partial unique index below) and the
    -- auto-resolve reconciliation sweep added in Phase 3.
    auto_trigger_key VARCHAR(128),
    -- Set the moment a human edits/resolves/dismisses an Auto finding — the
    -- Phase 3 reconciliation sweep must never touch a finding once this is
    -- true, so automation can never silently overwrite staff judgment.
    edited_by_staff BOOLEAN NOT NULL DEFAULT false,
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMPTZ,
    dismissed_reason TEXT,
    created_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_by VARCHAR(255),
    resolved_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_swot_findings_client_status ON altax.v3_swot_findings(client_id, status);

-- Backstop for existence-check-before-insert dedup (same shape the Task
-- Rules Agent already uses) — only one open auto-generated finding per
-- trigger key per client at a time; a resolved/dismissed one doesn't block
-- a fresh re-trigger later.
CREATE UNIQUE INDEX IF NOT EXISTS uq_v3_swot_findings_open_trigger
    ON altax.v3_swot_findings(client_id, auto_trigger_key)
    WHERE auto_trigger_key IS NOT NULL AND status NOT IN ('Resolved','Dismissed');
