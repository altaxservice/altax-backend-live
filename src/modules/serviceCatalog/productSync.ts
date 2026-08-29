import { query, queryOne } from "../../config/db";

/**
 * Keeps altax.v3_products_services (the invoice "Product/Service" picker's data
 * source) in sync with a single altax.v3_service_catalog row, so the picker never
 * drifts from the real Fee Schedule the way it did before (see sql/119). Rows this
 * function owns are tagged with catalog_service_key and always fully overwritten;
 * genuine hand-typed one-off products (catalog_service_key IS NULL, e.g. a one-off
 * lease line item) are never touched. A row that should no longer apply — the
 * one-time price was cleared — is deactivated, never deleted or renamed, so any
 * invoice that already references it keeps resolving correctly on reprint.
 */
export async function syncCatalogProducts(serviceKey: string): Promise<void> {
  const svc = await queryOne<any>(`SELECT * FROM altax.v3_service_catalog WHERE service_key = $1`, [serviceKey]);
  if (!svc || svc.legacy) return;

  const mainId = `SVC-${serviceKey}`;
  const otId = `SVC-${serviceKey}-OT`;
  const hasOneTime = svc.role !== "one_time" && svc.one_time_fee != null;
  const mainName = hasOneTime ? `${svc.label} — Subscription` : svc.label;
  const mainActive = Boolean(svc.active) && svc.min_fee != null;

  await query(
    `INSERT INTO altax.v3_products_services
       (product_id, name, category, rate, taxable, active, catalog_service_key, price_context, source_system, source_record_id)
     VALUES ($1, $2, $3, $4, true, $5, $6, $7, 'Service Catalog Sync', $1)
     ON CONFLICT (product_id) DO UPDATE SET
       name = EXCLUDED.name, category = EXCLUDED.category, rate = EXCLUDED.rate,
       active = EXCLUDED.active, catalog_service_key = EXCLUDED.catalog_service_key,
       price_context = EXCLUDED.price_context, updated_at = now()`,
    [mainId, mainName, svc.group_name, svc.min_fee, mainActive, serviceKey, svc.role === "one_time" ? "one_time" : "subscription"]
  );

  if (hasOneTime) {
    await query(
      `INSERT INTO altax.v3_products_services
         (product_id, name, category, rate, taxable, active, catalog_service_key, price_context, source_system, source_record_id)
       VALUES ($1, $2, $3, $4, true, $5, $6, 'one_time', 'Service Catalog Sync', $1)
       ON CONFLICT (product_id) DO UPDATE SET
         name = EXCLUDED.name, category = EXCLUDED.category, rate = EXCLUDED.rate,
         active = EXCLUDED.active, catalog_service_key = EXCLUDED.catalog_service_key,
         price_context = EXCLUDED.price_context, updated_at = now()`,
      [otId, `${svc.label} — One-Time`, svc.group_name, svc.one_time_fee, Boolean(svc.active), serviceKey]
    );
  } else {
    await query(
      `UPDATE altax.v3_products_services SET active = false, updated_at = now()
        WHERE product_id = $1 AND catalog_service_key = $2`,
      [otId, serviceKey]
    );
  }
}
