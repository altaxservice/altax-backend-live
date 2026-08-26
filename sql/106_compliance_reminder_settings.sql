-- Compliance deadline reminders to CLIENTS — direct owner request,
-- 2026-08-26: "add manual and auto reminder option to the client... your
-- Annual Report is due... your sales tax filing due... and so on." Builds
-- on top of what already exists rather than replacing it:
--   - MD Sales Tax already has its own dedicated daily reminder sweep
--     (runClientMdSalesTaxDeadlineNotifications, clients.routes.ts) — not
--     touched here, this table intentionally excludes 'MD Sales Tax'.
--   - "Payroll" (next scheduled pay date) isn't a filing/compliance
--     deadline in the same sense — excluded here too.
-- The remaining 9 sources are exactly MARKABLE_DEADLINE_SOURCES on the
-- frontend (ClientAtAGlance.tsx) — the same whitelist already used for
-- "Mark Done," so a source only ever gets a client reminder if it's
-- already a real, actionable obligation elsewhere in the app.
CREATE TABLE IF NOT EXISTS altax.v3_compliance_reminder_settings (
    source        VARCHAR(40) PRIMARY KEY,
    -- Days-before-due-date to send a reminder — a client fires once per
    -- (source, due date, lead day) combination, so multiple entries here
    -- (e.g. '{14,3}') mean multiple separate reminders as the date nears.
    lead_days     INT[] NOT NULL DEFAULT '{7}',
    enabled       BOOLEAN NOT NULL DEFAULT true,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by    VARCHAR(255)
);

INSERT INTO altax.v3_compliance_reminder_settings (source, lead_days, enabled) VALUES
    ('EFTPS', '{7}', true),
    ('MD Withholding', '{7}', true),
    ('MD UI', '{7}', true),
    ('Business Tax Return', '{14,3}', true),
    ('Individual Tax Return', '{14,3}', true),
    ('Estimated Tax', '{7}', true),
    ('MD Annual Report', '{14,3}', true),
    ('Federal Payroll Tax', '{7}', true),
    ('1099/W-2', '{14,3}', true)
ON CONFLICT (source) DO NOTHING;
