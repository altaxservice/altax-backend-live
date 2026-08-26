/**
 * Subscription tier + price derivation from a client's checked services —
 * direct owner request, 2026-08-26. Mirrored in
 * frontend/src/utils/subscriptionPricing.ts for the live client-profile
 * preview (kept in sync manually, same convention as deriveServiceType in
 * clientOptions.ts/contractContent.ts).
 *
 * Price is mechanical: sum of min_fee for every checked service that isn't
 * one_time — pulled from the v3_service_catalog table (sql/104), fully
 * editable there. Tier is NOT mechanical — it's a deliberate business rule
 * keyed on 4 specific service_keys, not a generic "role" lookup, so editing
 * the catalog's `role` column for cosmetic/organizational reasons can never
 * silently change what counts toward a client's tier.
 */
export interface ServiceCatalogEntry {
  service_key: string;
  label: string;
  group_name: string;
  role: "core_pillar" | "addon" | "one_time";
  min_fee: number | string | null;
  sort_order: number;
  active: boolean;
  legacy: boolean;
}

export type SubscriptionTierKey = "essentials" | "growth" | "complete";

const CORE_PILLAR_KEYS = ["bookkeeping", "payroll", "sales_tax", "business_tax_prep"] as const;

/**
 * Decision table (locked after review — see conversation 2026-08-26):
 *   - Bookkeeping + Payroll + (Sales Tax or Business Tax Return)  -> Complete
 *   - Bookkeeping alone, any 2 pillars, or Payroll+SalesTax+BizTax
 *     without Bookkeeping                                         -> Growth
 *   - Everything else (0 or 1 non-Bookkeeping pillar)              -> Essentials
 */
export function computeSubscriptionTier(selectedServiceKeys: string[]): SubscriptionTierKey {
  const has = (k: string) => selectedServiceKeys.includes(k);
  const hasBookkeeping = has("bookkeeping");
  const hasPayroll = has("payroll");
  const hasSalesTax = has("sales_tax");
  const hasBusinessTax = has("business_tax_prep");
  const pillarCount = CORE_PILLAR_KEYS.filter(has).length;

  if (hasBookkeeping && hasPayroll && (hasSalesTax || hasBusinessTax)) return "complete";
  if (hasBookkeeping) return "growth";
  if (pillarCount >= 2) return "growth";
  return "essentials";
}

/** Sum of min_fee for every checked service whose catalog role isn't one_time. Missing/unpriced entries contribute 0. */
export function computeSubscriptionFee(selectedServiceKeys: string[], catalog: ServiceCatalogEntry[]): number {
  const byKey = new Map(catalog.map((c) => [c.service_key, c]));
  let total = 0;
  for (const key of selectedServiceKeys) {
    const entry = byKey.get(key);
    if (!entry || entry.role === "one_time" || entry.min_fee === null || entry.min_fee === undefined) continue;
    total += Number(entry.min_fee);
  }
  return Math.round(total * 100) / 100;
}
