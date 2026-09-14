-- "Daily Log" — a personal/firm work journal, deliberately separate from
-- both Time Tracking (a billing tool: hours-as-a-number + rate + invoice
-- rollup, no narrative) and Staff Notes (forward-looking reminders, not a
-- backward-looking "here's what I did" record). Real owner request,
-- 2026-09-13: date+time, which client, which task (if any), and free-form
-- narrative of what was involved and what was done about it.
--
-- time_spent_minutes is deliberately NOT wired to Time Tracking's billing
-- fields (billable/hourly_rate/invoice_id) -- it's a lightweight personal
-- awareness figure only. If something logged here turns out to actually be
-- billable, that's still recorded properly in Time Tracking, same as today.
CREATE TABLE IF NOT EXISTS altax.v3_daily_logs (
    log_id VARCHAR(64) PRIMARY KEY,
    author_email VARCHAR(255) NOT NULL,
    author_name VARCHAR(255),
    client_id VARCHAR(64) REFERENCES altax.v3_clients(client_id) ON DELETE SET NULL,
    task_id VARCHAR(64) REFERENCES altax.v3_tasks(task_id) ON DELETE SET NULL,
    logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    category VARCHAR(64),
    body TEXT NOT NULL,
    time_spent_minutes INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v3_daily_logs_logged_at ON altax.v3_daily_logs(logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_daily_logs_client ON altax.v3_daily_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_v3_daily_logs_author ON altax.v3_daily_logs(author_email);
