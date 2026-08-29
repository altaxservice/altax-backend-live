-- Syncs altax.v3_fee_items (the Estimates module's "Fee Schedule" — real
-- government/agency filing fees like MD SDAT costs, plus a few AL TAX
-- service fees) into the invoice Product/Service picker, same pattern as
-- sql/119's Subscription Fee Schedule sync. Direct owner ask, 2026-08-29:
-- "add the whole list of Fee in Fee Schedule ... even the Agencies fees"
-- to the invoice picker.
--
-- Percent-based fee items (amount_kind='percent', e.g. the 3% Maryland
-- Technology Fee) are deliberately excluded — there is no fixed dollar
-- amount to put on an invoice line without knowing what base it applies
-- to; staff still bill those manually via quick-add.

ALTER TABLE altax.v3_products_services
    ADD COLUMN IF NOT EXISTS fee_item_id VARCHAR(64)
        REFERENCES altax.v3_fee_items(fee_item_id) ON DELETE SET NULL;

-- Reuses the fee item's own id as the product id directly (already a
-- distinct "FEE-..." namespace, no collision with the "PS-..."/"SVC-..."
-- ids already in this table) so the mapping is 1:1 and traceable at a
-- glance. Speed is appended to the name when set, since two rows can
-- otherwise share an identical name (e.g. "Certified Copy — Expedited" vs
-- "— Rush"). Uses unit_price (what the client is charged), not unit_cost
-- (what the firm pays the agency).
INSERT INTO altax.v3_products_services
    (product_id, name, category, rate, taxable, active, fee_item_id, source_system, source_record_id)
SELECT
    fee_item_id,
    name || CASE WHEN speed IS NOT NULL THEN ' (' || speed || ')' ELSE '' END,
    COALESCE(agency, category), unit_price, true, active,
    fee_item_id, 'Fee Schedule Sync', fee_item_id
FROM altax.v3_fee_items
WHERE amount_kind = 'fixed'
ON CONFLICT (product_id) DO UPDATE SET
    name = EXCLUDED.name, category = EXCLUDED.category, rate = EXCLUDED.rate,
    active = EXCLUDED.active, fee_item_id = EXCLUDED.fee_item_id, updated_at = now();
