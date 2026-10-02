-- The two payroll-related catalog services were named for Maryland ("MD
-- Withholding Filing", "Maryland Unemployment Insurance Filing") even though the
-- firm has clients in DC/VA/PA/DE. service_key values (md_withholding_filing,
-- mdui) stay as they are -- they're stored on every client and rule. Only the
-- label changes, and only where it still holds the original seeded text, so an
-- admin's own rename in the Fee Schedule is never overwritten. Skips cleanly on
-- a database that has no service catalog yet.
DO $$
BEGIN
  IF to_regclass('altax.v3_service_catalog') IS NOT NULL THEN
    UPDATE altax.v3_service_catalog SET label = 'State Withholding Filing'
     WHERE service_key = 'md_withholding_filing' AND label = 'MD Withholding Filing';
    UPDATE altax.v3_service_catalog SET label = 'State Unemployment Insurance Filing'
     WHERE service_key = 'mdui' AND label = 'Maryland Unemployment Insurance Filing';
  END IF;
END $$;
