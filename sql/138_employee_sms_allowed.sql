-- SMS consent flag for employees, mirroring v3_clients.sms_allowed. Defaults
-- to false (opt-in, not opt-out) — texting business communications without
-- consent carries real TCPA exposure, unlike email's much looser rules,
-- so this is NOT treated like the existing no-consent-gate employee email
-- sends (govForms.routes.ts, documents.routes.ts's notifyPortalFileShared)
-- that predate this column.
ALTER TABLE altax.v3_employees
  ADD COLUMN IF NOT EXISTS sms_allowed BOOLEAN NOT NULL DEFAULT false;
