-- Unifies the invoice "Product/Service" picker with the real Fee Schedule
-- (altax.v3_service_catalog) instead of the separate, drifted, manually
-- typed altax.v3_products_services list — e.g. "Business Formation" is
-- $450 (one-time) in the real catalog but a misspelled "Buiness Formation"
-- sat at $500 in the invoice picker; other prices had drifted too. Direct
-- owner ask, 2026-08-29, after spotting this live while invoicing a real
-- client. v3_products_services stays the FK anchor for
-- v3_invoice_line_items.product_id (zero risk to that constraint or to
-- buildInvoicePdf's live category join) but is now kept in sync with the
-- catalog on every write (src/modules/serviceCatalog/productSync.ts) — this
-- migration does the one-time backfill; ongoing catalog edits sync live.

-- Standalone one-time price for an addon/core_pillar (subscription-context)
-- service — e.g. Annual Report Filing is $7/mo as a subscription addon, but
-- the firm also bills it at $75 one-time for a client not on that
-- subscription. NULL means no separate one-time price exists (most addons
-- never need one). role='one_time' services don't use this column; their
-- min_fee already IS their one-time price (see sql/110).
ALTER TABLE altax.v3_service_catalog
    ADD COLUMN IF NOT EXISTS one_time_fee NUMERIC(10,2);

-- Marks a v3_products_services row as owned/derived by the catalog sync
-- (non-NULL) vs. a genuine hand-typed one-off with no catalog equivalent
-- (NULL — e.g. "Residential Lease" — never touched by sync).
ALTER TABLE altax.v3_products_services
    ADD COLUMN IF NOT EXISTS catalog_service_key VARCHAR(64)
        REFERENCES altax.v3_service_catalog(service_key) ON DELETE SET NULL;

-- Which of a dual-priced service's two rows this is. NULL for hand-typed rows.
ALTER TABLE altax.v3_products_services
    ADD COLUMN IF NOT EXISTS price_context VARCHAR(20)
        CHECK (price_context IN ('subscription', 'one_time'));

-- Confirmed real dual-price example: annual_report is $7/mo (min_fee,
-- already live) plus a genuine $75 one-time filing fee the firm has been
-- billing manually via the ad-hoc "Annual Report Service" product row.
UPDATE altax.v3_service_catalog SET one_time_fee = 75.00 WHERE service_key = 'annual_report';

-- Backfill: one SVC-<service_key> row per active, priced, non-legacy
-- catalog entry, plus a second SVC-<service_key>-OT row for any service
-- with a one-time fee. Deterministic ids matching productSync.ts exactly,
-- so this backfill and the ongoing live sync never diverge. Idempotent —
-- safe to re-run.
INSERT INTO altax.v3_products_services
    (product_id, name, category, rate, taxable, active, catalog_service_key, price_context, source_system, source_record_id)
SELECT
    'SVC-' || service_key,
    CASE WHEN role <> 'one_time' AND one_time_fee IS NOT NULL THEN label || ' — Subscription' ELSE label END,
    group_name, min_fee, true, (active AND min_fee IS NOT NULL),
    service_key, CASE WHEN role = 'one_time' THEN 'one_time' ELSE 'subscription' END,
    'Service Catalog Sync', 'SVC-' || service_key
FROM altax.v3_service_catalog
WHERE NOT legacy
ON CONFLICT (product_id) DO UPDATE SET
    name = EXCLUDED.name, category = EXCLUDED.category, rate = EXCLUDED.rate,
    active = EXCLUDED.active, catalog_service_key = EXCLUDED.catalog_service_key,
    price_context = EXCLUDED.price_context, updated_at = now();

INSERT INTO altax.v3_products_services
    (product_id, name, category, rate, taxable, active, catalog_service_key, price_context, source_system, source_record_id)
SELECT
    'SVC-' || service_key || '-OT', label || ' — One-Time',
    group_name, one_time_fee, true, active,
    service_key, 'one_time', 'Service Catalog Sync', 'SVC-' || service_key || '-OT'
FROM altax.v3_service_catalog
WHERE NOT legacy AND role <> 'one_time' AND one_time_fee IS NOT NULL
ON CONFLICT (product_id) DO UPDATE SET
    name = EXCLUDED.name, category = EXCLUDED.category, rate = EXCLUDED.rate,
    active = EXCLUDED.active, catalog_service_key = EXCLUDED.catalog_service_key,
    price_context = EXCLUDED.price_context, updated_at = now();

-- Deactivate (never delete/rename, so any existing invoice line item still
-- resolves its product_id FK on reprint) the confirmed drifted/superseded
-- ad-hoc duplicates, now that a single accurate SVC-* row exists for each:
--   - "Buiness Formation" $500 (misspelled, wrong price — the real
--     one-time price is $450, now SVC-formation)
--   - "Annual Report Service" $75 (superseded by SVC-annual_report-OT, same
--     $75 price — nothing was wrong here, just duplicated)
--   - "Sales Tax Service fee" $125 (doesn't match anything — the real
--     catalog price is $53/mo subscription with no confirmed one-time
--     price; leaving this stale duplicate live would just recreate the
--     exact confusion this migration exists to fix)
-- Every other catalog_service_key IS NULL row (e.g. "Residential Lease") is
-- left completely untouched — genuine one-off items with no catalog
-- equivalent.
UPDATE altax.v3_products_services SET active = false, updated_at = now()
 WHERE product_id IN ('PS-20260809173433-651', 'PS-20260809152642-644', 'PS-20260809152454-635');
