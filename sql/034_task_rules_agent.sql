-- Task Rules Agent: background automation that drafts recurring compliance
-- task batches (sales tax filings, payroll deposits, etc.) from an active
-- v3_task_rules row, instead of requiring a staff member to open "Create
-- Batch Tasks" and type in the period label / due date by hand every time a
-- period rolls around. Modeled directly on the Payroll Agent
-- (sql/026_payroll_agent.sql, sql/027_payroll_agent_auto_toggle.sql) and Bank
-- Rec Agent (sql/033_je_drafts.sql) pattern: a nightly sweep never creates
-- real tasks on its own — it only ever produces a Pending draft here. Staff
-- review and approve (or dismiss) before the existing, unmodified
-- POST /rules/:ruleId/batch client-matching + per-client duplicate-task-guard
-- logic actually runs and creates anything.
--
-- Deliberately stateless per rule (no next_run_date-style column added to
-- v3_task_rules): the sweep always computes "the most recently fully
-- completed period as of today" fresh from frequency/due_day/due_month, and
-- relies on the UNIQUE(rule_id, period_label) constraint below — the same
-- role source_record_id-existence-check idempotency shape Recurring Billing
-- uses — to never draft the same period twice. This means a sweep outage of
-- more than roughly one period (e.g. the cron down for 5+ weeks for a
-- Monthly rule) can silently skip an intervening period once time has moved
-- on, since there's no persisted pointer to catch up from the way Payroll
-- Agent's next_pay_date does. Accepted v1 tradeoff — a gap that long means
-- every other nightly job (payroll, billing, reminders) is equally broken
-- and already alerting admins via the cron dead-man's-switch.

CREATE TABLE IF NOT EXISTS altax.v3_task_batch_drafts (
    task_batch_draft_id VARCHAR(64) PRIMARY KEY,
    rule_id VARCHAR(64) NOT NULL REFERENCES altax.v3_task_rules(rule_id) ON DELETE CASCADE,
    task_type VARCHAR(255),
    frequency VARCHAR(32),
    period_label VARCHAR(255) NOT NULL,
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    due_date TIMESTAMPTZ NOT NULL,
    -- How many active clients matched the rule's trigger at draft time — a
    -- display-only snapshot for the review list. The actual client match and
    -- per-client duplicate-task check both re-run live, against current data,
    -- at approval time (same "never trust a stale snapshot" rule Payroll
    -- Agent's fresh-computed preview follows) — this count can be off by the
    -- time staff approves if a client was added/archived/already had the
    -- task created manually in between, which is expected and harmless.
    matched_client_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'Pending',
    -- Edits staff made to this draft before approving (assignedTo/notes/
    -- staffDueDate) — same shape as the manual Create Batch Tasks modal body,
    -- merged in at approval time. Null until staff edits it.
    staff_overrides JSONB,
    resulting_batch_id VARCHAR(64) REFERENCES altax.v3_task_batches(batch_id) ON DELETE SET NULL,
    dismissed_reason TEXT,
    approved_by VARCHAR(255),
    approved_at TIMESTAMPTZ,
    dismissed_by VARCHAR(255),
    dismissed_at TIMESTAMPTZ,
    source_system VARCHAR(255) DEFAULT 'Task Rules Agent',
    source_record_id VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_v3_task_batch_drafts_status CHECK (status IN ('Pending','Approved','Dismissed')),
    -- Hard idempotency guarantee — the sweep can safely run twice on the same
    -- day (or be re-triggered manually) without ever double-drafting the same
    -- rule's same period.
    CONSTRAINT uq_v3_task_batch_drafts_rule_period UNIQUE (rule_id, period_label)
);
CREATE INDEX IF NOT EXISTS idx_v3_task_batch_drafts_status ON altax.v3_task_batch_drafts(status);
CREATE INDEX IF NOT EXISTS idx_v3_task_batch_drafts_rule ON altax.v3_task_batch_drafts(rule_id);

-- Global on/off switch for the automatic nightly sweep, same shape as
-- v3_payroll_agent_settings. Turning this off does not touch existing rules
-- or pending drafts, and never affects the manual "Run Agent Now" button
-- (an explicit staff action, not automation) or the existing manual
-- "Create Batch Tasks" flow, both of which always work regardless of this flag.
CREATE TABLE IF NOT EXISTS altax.v3_task_rules_agent_settings (
    id VARCHAR(16) PRIMARY KEY DEFAULT 'TRAGENT-1',
    auto_run_enabled BOOLEAN NOT NULL DEFAULT true,
    updated_by VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
