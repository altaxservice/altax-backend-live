import { query, queryOne } from "../../config/db";

/**
 * Mirrors a single altax.v3_fee_items row into altax.v3_products_services so it's
 * selectable on an invoice — same pattern as serviceCatalog/productSync.ts. Percent-based
 * fee items (amount_kind='percent', e.g. the Maryland Technology Fee) have no fixed dollar
 * amount to put on an invoice line, so they're deliberately skipped — staff still bill
 * those manually via quick-add. Reuses the fee item's own id as the product id (a distinct
 * "FEE-..." namespace already, no collision risk) for a direct, traceable 1:1 mapping.
 */
export async function syncFeeItemProduct(feeItemId: string): Promise<void> {
  const item = await queryOne<any>(`SELECT * FROM altax.v3_fee_items WHERE fee_item_id = $1`, [feeItemId]);
  if (!item) return;

  if (item.amount_kind !== "fixed") {
    // Was fixed, now switched to percent — deactivate any previously-synced row
    // rather than leaving a stale fixed price live.
    await query(
      `UPDATE altax.v3_products_services SET active = false, updated_at = now() WHERE product_id = $1 AND fee_item_id = $2`,
      [feeItemId, feeItemId]
    );
    return;
  }

  const name = item.name + (item.speed ? ` (${item.speed})` : "");
  await query(
    `INSERT INTO altax.v3_products_services
       (product_id, name, category, rate, taxable, active, fee_item_id, source_system, source_record_id)
     VALUES ($1, $2, $3, $4, true, $5, $1, 'Fee Schedule Sync', $1)
     ON CONFLICT (product_id) DO UPDATE SET
       name = EXCLUDED.name, category = EXCLUDED.category, rate = EXCLUDED.rate,
       active = EXCLUDED.active, fee_item_id = EXCLUDED.fee_item_id, updated_at = now()`,
    [feeItemId, name, item.agency || item.category, item.unit_price, Boolean(item.active)]
  );
}
