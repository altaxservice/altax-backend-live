/**
 * Mirror of src/common/subscriptionPricing.ts (backend) — kept in sync
 * manually, same convention as deriveServiceType above. Used here purely for
 * the live "Estimated Subscription" preview on the client profile edit form,
 * before the user even saves; the backend's copy is what actually gets
 * persisted on save, so this never needs to be authoritative, only accurate.
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

export interface ClientWorkerCounts { employees: number; workers: number }

export type SubscriptionTierKey = "essentials" | "growth" | "complete";

const CORE_PILLAR_KEYS = ["bookkeeping", "payroll", "sales_tax", "business_tax_prep"] as const;

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
