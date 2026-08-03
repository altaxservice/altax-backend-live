-- Optional per-weekday hour overrides for Calendar Settings. Each day's
-- start/end hour defaults to NULL, meaning "use the firm's default
-- business_start_hour/business_end_hour" — existing firms keep behaving
-- exactly as before until an admin sets a custom range for a specific day
-- (e.g. Friday closes early).
ALTER TABLE altax.v3_appointment_settings
  ADD COLUMN IF NOT EXISTS mon_start_hour INTEGER,
  ADD COLUMN IF NOT EXISTS mon_end_hour INTEGER,
  ADD COLUMN IF NOT EXISTS tue_start_hour INTEGER,
  ADD COLUMN IF NOT EXISTS tue_end_hour INTEGER,
  ADD COLUMN IF NOT EXISTS wed_start_hour INTEGER,
  ADD COLUMN IF NOT EXISTS wed_end_hour INTEGER,
  ADD COLUMN IF NOT EXISTS thu_start_hour INTEGER,
  ADD COLUMN IF NOT EXISTS thu_end_hour INTEGER,
  ADD COLUMN IF NOT EXISTS fri_start_hour INTEGER,
  ADD COLUMN IF NOT EXISTS fri_end_hour INTEGER,
  ADD COLUMN IF NOT EXISTS sat_start_hour INTEGER,
  ADD COLUMN IF NOT EXISTS sat_end_hour INTEGER,
  ADD COLUMN IF NOT EXISTS sun_start_hour INTEGER,
  ADD COLUMN IF NOT EXISTS sun_end_hour INTEGER;

DO $$
DECLARE
  d TEXT;
BEGIN
  FOREACH d IN ARRAY ARRAY['mon','tue','wed','thu','fri','sat','sun'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'chk_v3_appointment_settings_' || d || '_hours'
    ) THEN
      EXECUTE format(
        'ALTER TABLE altax.v3_appointment_settings ADD CONSTRAINT chk_v3_appointment_settings_%s_hours
           CHECK ((%s_start_hour IS NULL AND %s_end_hour IS NULL) OR (%s_end_hour > %s_start_hour))',
        d, d, d, d, d
      );
    END IF;
  END LOOP;
END $$;
