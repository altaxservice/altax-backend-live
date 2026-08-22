-- service_type (the "Full Service"/"Bookkeeping Only"/etc. dropdown) used to
-- be set independently of the `services` array (the actual Services Provided
-- checkboxes) — nothing ever kept them in sync. Confirmed live 2026-08-22:
-- 78 of 152 active clients were labeled "Full Service" while missing most of
-- what was actually checked (one had zero services checked at all). Going
-- forward the app derives service_type automatically from `services` on
-- every create/update (see deriveServiceType in
-- src/modules/contracts/contractContent.ts) — this is the one-time backfill
-- for every client that already exists, using the exact same rule in SQL:
--   3+ of {bookkeeping, payroll, sales_tax, tax prep}  -> 'Full Service'
--   exactly 1 of those 4, and no permits/consulting     -> the matching '<X> Only'
--   only permits_licenses                                -> 'Permits & Licensing Only'
--   only consulting                                       -> 'Consulting'
--   anything else (0 services, or a mix that doesn't fit) -> 'Custom' (or NULL if 0 services)
UPDATE altax.v3_clients SET service_type = CASE
  WHEN services IS NULL OR array_length(services, 1) IS NULL THEN NULL
  WHEN (
    (CASE WHEN 'bookkeeping' = ANY(services) THEN 1 ELSE 0 END) +
    (CASE WHEN 'payroll' = ANY(services) THEN 1 ELSE 0 END) +
    (CASE WHEN 'sales_tax' = ANY(services) THEN 1 ELSE 0 END) +
    (CASE WHEN 'business_tax_prep' = ANY(services) OR 'personal_tax_prep' = ANY(services) OR 'tax_prep' = ANY(services) THEN 1 ELSE 0 END)
  ) >= 3 THEN 'Full Service'
  WHEN (
    (CASE WHEN 'bookkeeping' = ANY(services) THEN 1 ELSE 0 END) +
    (CASE WHEN 'payroll' = ANY(services) THEN 1 ELSE 0 END) +
    (CASE WHEN 'sales_tax' = ANY(services) THEN 1 ELSE 0 END) +
    (CASE WHEN 'business_tax_prep' = ANY(services) OR 'personal_tax_prep' = ANY(services) OR 'tax_prep' = ANY(services) THEN 1 ELSE 0 END)
  ) = 1 AND NOT ('permits_licenses' = ANY(services)) AND NOT ('consulting' = ANY(services)) THEN (
    CASE
      WHEN 'bookkeeping' = ANY(services) THEN 'Bookkeeping Only'
      WHEN 'payroll' = ANY(services) THEN 'Payroll Only'
      WHEN 'sales_tax' = ANY(services) THEN 'Sales Tax Only'
      ELSE 'Tax Only'
    END
  )
  WHEN (
    (CASE WHEN 'bookkeeping' = ANY(services) THEN 1 ELSE 0 END) +
    (CASE WHEN 'payroll' = ANY(services) THEN 1 ELSE 0 END) +
    (CASE WHEN 'sales_tax' = ANY(services) THEN 1 ELSE 0 END) +
    (CASE WHEN 'business_tax_prep' = ANY(services) OR 'personal_tax_prep' = ANY(services) OR 'tax_prep' = ANY(services) THEN 1 ELSE 0 END)
  ) = 0 AND 'permits_licenses' = ANY(services) AND NOT ('consulting' = ANY(services)) THEN 'Permits & Licensing Only'
  WHEN (
    (CASE WHEN 'bookkeeping' = ANY(services) THEN 1 ELSE 0 END) +
    (CASE WHEN 'payroll' = ANY(services) THEN 1 ELSE 0 END) +
    (CASE WHEN 'sales_tax' = ANY(services) THEN 1 ELSE 0 END) +
    (CASE WHEN 'business_tax_prep' = ANY(services) OR 'personal_tax_prep' = ANY(services) OR 'tax_prep' = ANY(services) THEN 1 ELSE 0 END)
  ) = 0 AND 'consulting' = ANY(services) AND NOT ('permits_licenses' = ANY(services)) THEN 'Consulting'
  ELSE 'Custom'
END;
