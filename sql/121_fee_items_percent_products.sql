-- Extends sql/120's Fee Schedule -> invoice-picker sync to also cover
-- percent-based fee items (e.g. the CC/ACH Client Surcharge, added
-- 2026-08-29) -- direct owner ask: "the list should have all the items in
-- the Fee schedule." A percent fee has no single fixed dollar rate, so its
-- mirrored product row leaves `rate` NULL and carries the percentage in
-- the new `percent_rate` column instead; the invoice editor computes the
-- actual dollar amount at selection time, off that invoice's current
-- subtotal (see feeItemProductSync.ts / InvoiceEditorModal.tsx).

ALTER TABLE altax.v3_products_services
    ADD COLUMN IF NOT EXISTS percent_rate NUMERIC(7,4);

INSERT INTO altax.v3_products_services
    (product_id, name, category, rate, percent_rate, taxable, active, fee_item_id, source_system, source_record_id)
SELECT
    fee_item_id,
    name || CASE WHEN speed IS NOT NULL THEN ' (' || speed || ')' ELSE '' END,
    COALESCE(agency, category), NULL, percent_rate, true, active,
    fee_item_id, 'Fee Schedule Sync', fee_item_id
FROM altax.v3_fee_items
WHERE amount_kind = 'percent'
ON CONFLICT (product_id) DO UPDATE SET
    name = EXCLUDED.name, category = EXCLUDED.category, rate = EXCLUDED.rate,
    percent_rate = EXCLUDED.percent_rate, active = EXCLUDED.active,
    fee_item_id = EXCLUDED.fee_item_id, updated_at = now();
