import { query, queryOne } from "../../config/db";

/**
 * Mirrors a single altax.v3_fee_items row into altax.v3_products_services so it's
 * selectable on an invoice — same pattern as serviceCatalog/productSync.ts. Every fee
 * item gets a row regardless of amount_kind (direct owner ask, 2026-08-29: "the list
 * should have all the items in the Fee schedule"). A fixed fee stores its dollar amount
 * in `rate`; a percent fee (e.g. the CC/ACH Client Surcharge) has no single fixed
 * amount, so `rate` stays NULL and `percent_rate` carries the percentage instead — the
 * invoice editor computes the actual dollar amount at selection time, off that
 * invoice's current subtotal (see InvoiceEditorModal.tsx's selectProduct). Reuses the
 * fee item's own id as the product id (a distinct "FEE-..." namespace already, no
 * collision risk) for a direct, traceable 1:1 mapping.
 */
export async function syncFeeItemProduct(feeItemId: string): Promise<void> {
  const item = await queryOne<any>(`SELECT * FROM altax.v3_fee_items WHERE fee_item_id = $1`, [feeItemId]);
  if (!item) return;

  const isPercent = item.amount_kind === "percent";
  const name = item.name + (item.speed ? ` (${item.speed})` : "");
  await query(
    `INSERT INTO altax.v3_products_services
       (product_id, name, category, rate, percent_rate, taxable, active, fee_item_id, source_system, source_record_id)
     VALUES ($1, $2, $3, $4, $5, true, $6, $1, 'Fee Schedule Sync', $1)
     ON CONFLICT (product_id) DO UPDATE SET
       name = EXCLUDED.name, category = EXCLUDED.category, rate = EXCLUDED.rate,
       percent_rate = EXCLUDED.percent_rate, active = EXCLUDED.active,
       fee_item_id = EXCLUDED.fee_item_id, updated_at = now()`,
    [feeItemId, name, item.agency || item.category, isPercent ? null : item.unit_price, isPercent ? item.percent_rate : null, Boolean(item.active)]
  );
}
