-- Payroll Agent: background automation that drafts upcoming paychecks for
-- employees on a recurring pay schedule, so staff review/approve a draft
-- instead of re-entering the same numbers every pay period. Modeled on the
-- existing v3_recurring_billing + runRecurringBillingSweep pattern, with one
-- deliberate difference: this never creates a real, GL-posted v3_paychecks
-- row on its own. It only ever produces a Pending draft; a real paycheck is
-- created (via the existing createSinglePaycheck()) only when staff clicks
-- Approve. Drafts are intentionally thin — no dollar amounts are stored here,
-- since those are recomputed live from calculatePaycheck() every time a
-- draft is displayed or approved, so a draft can never go stale on screen.

CREATE TABLE IF NOT EXISTS altax.v3_payroll_schedules (
    payroll_schedule_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    client_name VARCHAR(255),
    -- One active schedule per employee — re-enabling after a pause/archive
    -- reuses the same row rather than creating a duplicate.
    employee_id VARCHAR(64) NOT NULL UNIQUE REFERENCES altax.v3_employees(employee_id) ON DELETE CASCADE,
    employee_name VARCHAR(255),
    frequency VARCHAR(32) NOT NULL,
    anchor_date TIMESTAMPTZ NOT NULL,
    next_pay_date TIMESTAMPTZ NOT NULL,
    -- How many days before next_pay_date the sweep drafts it — gives staff a
    -- real review window instead of a draft appearing the same day it's due.
    lead_days INTEGER NOT NULL DEFAULT 5,
    status VARCHAR(32) NOT NULL DEFAULT 'Active',
    last_drafted_pay_date TIMESTAMPTZ,
    notes TEXT,
    created_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_v3_payroll_schedules_frequency CHECK (frequency IN ('Weekly','Biweekly','Semimonthly','Monthly')),
    CONSTRAINT chk_v3_payroll_schedules_status CHECK (status IN ('Active','Paused','Archived'))
);
CREATE INDEX IF NOT EXISTS idx_v3_payroll_schedules_status_next ON altax.v3_payroll_schedules(status, next_pay_date);

CREATE TABLE IF NOT EXISTS altax.v3_payroll_drafts (
    payroll_draft_id VARCHAR(64) PRIMARY KEY,
    payroll_schedule_id VARCHAR(64) NOT NULL REFERENCES altax.v3_payroll_schedules(payroll_schedule_id) ON DELETE CASCADE,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    client_name VARCHAR(255),
    employee_id VARCHAR(64) NOT NULL REFERENCES altax.v3_employees(employee_id) ON DELETE CASCADE,
    employee_name VARCHAR(255),
    pay_date TIMESTAMPTZ NOT NULL,
    pay_period_start TIMESTAMPTZ,
    pay_period_end TIMESTAMPTZ,
    status VARCHAR(32) NOT NULL DEFAULT 'Pending',
    -- Edits staff made to this draft before approving (same shape as the
    -- manual /accounting/payroll body) — merged over the computed defaults
    -- when the draft is displayed or approved. Null until staff edits it.
    staff_overrides JSONB,
    resulting_paycheck_id VARCHAR(64) REFERENCES altax.v3_paychecks(paycheck_id) ON DELETE SET NULL,
    dismissed_reason TEXT,
    approved_by VARCHAR(255),
    approved_at TIMESTAMPTZ,
    dismissed_by VARCHAR(255),
    dismissed_at TIMESTAMPTZ,
    source_system VARCHAR(255) DEFAULT 'Payroll Agent',
    source_record_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_v3_payroll_drafts_status CHECK (status IN ('Pending','Approved','Dismissed')),
    -- Hard idempotency guarantee — the sweep can safely run twice on the same
    -- day (or be re-triggered manually) without ever double-drafting the same
    -- employee's same pay date.
    CONSTRAINT uq_v3_payroll_drafts_schedule_paydate UNIQUE (payroll_schedule_id, pay_date)
);
CREATE INDEX IF NOT EXISTS idx_v3_payroll_drafts_status ON altax.v3_payroll_drafts(status);
CREATE INDEX IF NOT EXISTS idx_v3_payroll_drafts_client ON altax.v3_payroll_drafts(client_id, status);
