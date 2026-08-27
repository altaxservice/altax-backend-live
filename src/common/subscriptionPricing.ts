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
 *
 * pricing_unit (sql/109, 2026-08-26): most services are 'flat' (min_fee
 * contributes once, unchanged from the original design). 'per_employee'/
 * 'per_worker' services instead multiply min_fee by the client's actual
 * headcount — see computeSubscriptionFee's `counts` param.
 */
export interface ServiceCatalogEntry {
  service_key: string;
  label: string;
  group_name: string;
  role: "core_pillar" | "addon" | "one_time";
  min_fee: number | string | null;
  pricing_unit?: "flat" | "per_employee" | "per_worker";
  sort_order: number;
  active: boolean;
  legacy: boolean;
}

/**
 * employees: W-2 workers only (excludes 1099 contractors — they aren't run
 * through payroll). workers: everyone on file, employees AND contractors
 * (both eventually need one of W-2 or 1099).
 */
export interface ClientWorkerCounts { employees: number; workers: number }

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

/**
 * Sum of min_fee for every checked service whose catalog role isn't
 * one_time. Missing/unpriced entries contribute 0. A 'per_employee' or
 * 'per_worker' entry's min_fee is a per-unit rate, multiplied by the
 * relevant count from `counts` (0 by default — a brand-new client with no
 * employees yet correctly prices those services at $0 until real headcount
 * is on file).
 */
export function computeSubscriptionFee(selectedServiceKeys: string[], catalog: ServiceCatalogEntry[], counts: ClientWorkerCounts = { employees: 0, workers: 0 }): number {
  const byKey = new Map(catalog.map((c) => [c.service_key, c]));
  let total = 0;
  for (const key of selectedServiceKeys) {
    const entry = byKey.get(key);
    if (!entry || entry.role === "one_time" || entry.min_fee === null || entry.min_fee === undefined) continue;
    const rate = Number(entry.min_fee);
    if (entry.pricing_unit === "per_employee") total += rate * counts.employees;
    else if (entry.pricing_unit === "per_worker") total += rate * counts.workers;
    else total += rate;
  }
  return Math.round(total * 100) / 100;
}
