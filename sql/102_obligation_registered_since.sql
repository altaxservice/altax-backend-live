-- Real bug reported live 2026-08-22: a client formed 2026-07-29 was showing
-- "missing" Sales Tax filing periods going back to before the business
-- existed. Root cause is deliberate, documented behavior in
-- computeMdSalesTaxLane (complianceTimeline.ts) and the SalesTaxFilingDue
-- flag (clients.routes.ts) — both intentionally avoid floor-ing on
-- date_of_formation/created_at, because a 2026-08-18 production incident
-- found 140 of ~160 clients share one bulk-import created_at that would
-- have silently hidden real, current overdue filings. date_of_formation has
-- the same reliability problem for many clients (missing/unverified).
--
-- The fix isn't to reuse an unreliable existing date — it's a dedicated,
-- explicitly staff-entered "registered since" per obligation, so the floor
-- is only ever applied when someone has actually confirmed it. NULL means
-- "unknown" and changes nothing (all existing fallback logic keeps working
-- exactly as before); a real date here always wins.
ALTER TABLE altax.v3_clients
    ADD COLUMN IF NOT EXISTS sales_tax_registered_since DATE,
    ADD COLUMN IF NOT EXISTS md_withholding_registered_since DATE,
    ADD COLUMN IF NOT EXISTS mdui_registered_since DATE,
    ADD COLUMN IF NOT EXISTS eftps_registered_since DATE;
