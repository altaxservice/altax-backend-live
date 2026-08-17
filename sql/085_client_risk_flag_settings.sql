-- Two new thresholds for the smarter client-flags feature (payroll cadence
-- gaps, bookkeeping staleness) — see src/modules/clients/complianceGapFlags.ts.
-- Same singleton settings row (id='DASHALERT-1') as the existing
-- overdue_days_threshold/filing_deadline_days_threshold columns.

ALTER TABLE altax.v3_dashboard_alert_settings
  ADD COLUMN IF NOT EXISTS payroll_cadence_grace_days INTEGER NOT NULL DEFAULT 10,
  -- Real production data check (2026-08-17): the firm's whole client base
  -- normally lags ~48 days behind on GL posting (monthly close cadence) — a
  -- 45-day threshold would have flagged 25 of 86 clients simultaneously for
  -- that same firm-wide catch-up rhythm, not individual problems. 75 days
  -- correctly narrows to genuinely stale clients only.
  ADD COLUMN IF NOT EXISTS bookkeeping_staleness_days_threshold INTEGER NOT NULL DEFAULT 75;
