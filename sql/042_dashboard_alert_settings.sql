-- Firm-wide on/off switch + thresholds for the Phase 4 dashboard alert push
-- (email/SMS/WhatsApp to a client's assigned staff, or all admins if
-- unassigned, when a genuinely urgent condition is detected during the
-- nightly SWOT findings sweep). Same singleton-settings shape as
-- v3_payroll_agent_settings / v3_task_rules_agent_settings.

CREATE TABLE IF NOT EXISTS altax.v3_dashboard_alert_settings (
    id VARCHAR(16) PRIMARY KEY,
    auto_alerts_enabled BOOLEAN NOT NULL DEFAULT true,
    -- Cash balance below this triggers a Red finding/alert (default: negative cash only).
    cash_threshold NUMERIC(14,2) NOT NULL DEFAULT 0,
    -- An overdue invoice past this many days is Urgent-priority (alert-worthy);
    -- fewer days is still a finding on the dashboard, just not pushed.
    overdue_days_threshold INTEGER NOT NULL DEFAULT 90,
    -- An upcoming (not yet late) filing deadline within this many days is
    -- Urgent-priority; further out is still a finding, just not pushed.
    filing_deadline_days_threshold INTEGER NOT NULL DEFAULT 7,
    updated_by VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO altax.v3_dashboard_alert_settings (id) VALUES ('DASHALERT-1') ON CONFLICT (id) DO NOTHING;
