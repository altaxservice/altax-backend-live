-- Global on/off switch for the Payroll Agent's automatic nightly sweep — mirrors
-- the QuickBooks Online "Auto Payroll: On/Off" status the feature was modeled
-- after. Turning this Off does NOT touch existing schedules or pending drafts,
-- and it never affects the manual "Run Agent Now" button (that's an explicit
-- staff action, not automation, so it always works regardless of this flag).
-- It only gates whether the 6:15AM cron job (server.ts) actually drafts anything
-- on its own. Singleton row, same shape as v3_appointment_settings/v3_firm_settings.
CREATE TABLE IF NOT EXISTS altax.v3_payroll_agent_settings (
    id VARCHAR(16) PRIMARY KEY DEFAULT 'PAYAGENT-1',
    auto_run_enabled BOOLEAN NOT NULL DEFAULT true,
    updated_by VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
