-- One generic "remind the client before their payment is due" scheduler shared
-- by every filing/payment source system (MD sales tax, obligation-completion
-- deposits, tasks) instead of three copy-pasted crons. Mirrors the atomic-claim
-- + idempotency shape runAppointmentConfirmationRequests already uses
-- (appointments.routes.ts) via a `status` column, not a bare boolean, so a
-- reminder can move through Scheduled -> Sent / Canceled / Failed and be
-- inspected in one query rather than several timestamp columns.
--
-- One row per underlying filing/payment obligation (source_system,
-- source_record_id) — re-scheduling (e.g. staff corrects the due date or
-- amount) upserts this row rather than accumulating duplicates.
CREATE TABLE IF NOT EXISTS altax.v3_payment_reminders (
    reminder_id VARCHAR(64) PRIMARY KEY,
    source_system VARCHAR(32) NOT NULL,        -- 'MdFiling' | 'ObligationCompletion' | 'Task'
    source_record_id VARCHAR(128) NOT NULL,    -- e.g. '{clientId}:{periodEnd}', '{clientId}:{source}:{dueDate}', taskId
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    filing_type VARCHAR(128) NOT NULL,         -- human label, e.g. "Maryland Sales & Use Tax", "EFTPS Deposit"
    period_label VARCHAR(128),                 -- e.g. "2026-06-01 to 2026-06-30"; null for obligations/tasks with no period
    amount NUMERIC(14,2) NOT NULL,
    payment_due_date DATE NOT NULL,
    remind_at TIMESTAMPTZ NOT NULL,            -- when the sweep should fire this (9AM ET the day before payment_due_date)
    status VARCHAR(16) NOT NULL DEFAULT 'Scheduled', -- Scheduled | Sent | Canceled | Failed
    sent_at TIMESTAMPTZ,
    canceled_at TIMESTAMPTZ,
    canceled_reason VARCHAR(255),
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_system, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_v3_payment_reminders_sweep
    ON altax.v3_payment_reminders (status, remind_at) WHERE status = 'Scheduled';
