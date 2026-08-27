import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ServiceCatalogEntry, SubscriptionTier } from "../api/types";
import { INDIVIDUAL_SERVICE_KEYS } from "../utils/clientOptions";
import { computeSubscriptionFee, computeSubscriptionTier, type ClientWorkerCounts } from "../utils/subscriptionPricing";

const PRICING_UNIT_SUFFIX: Record<string, string> = { per_employee: "/employee/mo", per_worker: "/worker/mo" };

const TIER_COLOR: Record<string, { fg: string; bg: string }> = {
  essentials: { fg: "var(--teal)", bg: "var(--teal-soft)" },
  growth: { fg: "var(--amber)", bg: "var(--amber-soft)" },
  complete: { fg: "var(--green)", bg: "var(--green-soft)" },
};

/**
 * "Services Provided" checklist, rebuilt to read from the Minimum Fee
 * Schedule (v3_service_catalog) instead of the hardcoded FIRM_SERVICES array
 * — direct owner request, 2026-08-26: each service carries its own editable
 * fee, and checking boxes here builds up both the subscription price and the
 * tier live, before the form is even saved. One-time/project services are
 * rendered in their own section, entirely excluded from the price/tier math
 * (see subscriptionPricing.ts) — they still land in the same `services`
 * array underneath (so existing contract-suggestion logic keyed off it
 * keeps working unchanged), they just don't count toward the subscription.
 */
export function SubscriptionServicesChecklist({
  services, onChange, isBusinessClient, clientId,
}: {
  services: string[];
  onChange: (services: string[]) => void;
  isBusinessClient: boolean;
  /** Omitted while creating a brand-new client — worker counts default to 0/0, matching a client with no employees on file yet. */
  clientId?: string;
}) {
  const [catalog, setCatalog] = useState<ServiceCatalogEntry[] | null>(null);
  const [tiers, setTiers] = useState<SubscriptionTier[] | null>(null);
  const [counts, setCounts] = useState<ClientWorkerCounts>({ employees: 0, workers: 0 });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<{ services: ServiceCatalogEntry[] }>("/service-catalog"),
      api.get<{ tiers: SubscriptionTier[] }>("/service-catalog/tiers"),
    ]).then(([svc, t]) => {
      if (cancelled) return;
      setCatalog(svc.services);
      setTiers(t.tiers);
    }).catch(() => { if (!cancelled) { setCatalog([]); setTiers([]); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!clientId) { setCounts({ employees: 0, workers: 0 }); return; }
    let cancelled = false;
    api.get<ClientWorkerCounts>(`/clients/${clientId}/worker-counts`)
      .then((res) => { if (!cancelled) setCounts(res); })
      .catch(() => { if (!cancelled) setCounts({ employees: 0, workers: 0 }); });
    return () => { cancelled = true; };
  }, [clientId]);

  if (!catalog || !tiers) return <p className="muted" style={{ fontSize: 12 }}>Loading services…</p>;

  const visible = catalog
    .filter((s) => s.active)
    .filter((s) => isBusinessClient || INDIVIDUAL_SERVICE_KEYS.includes(s.service_key));
  const recurring = visible.filter((s) => s.role !== "one_time");
  const oneTime = visible.filter((s) => s.role === "one_time");

  function groupBy(entries: ServiceCatalogEntry[]): [string, ServiceCatalogEntry[]][] {
    const map = new Map<string, ServiceCatalogEntry[]>();
    for (const s of entries) {
      const arr = map.get(s.group_name) || [];
      arr.push(s);
      map.set(s.group_name, arr);
    }
    return Array.from(map.entries());
  }

  function toggle(key: string, checked: boolean) {
    onChange(checked ? [...services, key] : services.filter((k) => k !== key));
  }

  const tierKey = computeSubscriptionTier(services);
  const fee = computeSubscriptionFee(services, catalog, counts);
  const tierMeta = tiers.find((t) => t.tier_key === tierKey);
  const color = TIER_COLOR[tierKey] || TIER_COLOR.essentials;
  const anyRecurringChecked = recurring.some((s) => services.includes(s.service_key));

  return (
    <>
      <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
        Select every service this client is engaged for — the Contracts section below will suggest the matching contract for each one, and Recurring services build the monthly subscription price automatically.
        {!isBusinessClient && " Showing individual-relevant services only; switch Client Type to Business to see the rest."}
      </p>

      <div className="ac-subcard-title" style={{ marginBottom: 6 }}>Recurring Services</div>
      {groupBy(recurring).map(([group, entries]) => (
        <div key={group} style={{ marginBottom: 10 }}>
          <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>{group}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px 16px" }}>
            {entries.map((s) => {
              const unit = s.pricing_unit || "flat";
              const unitCount = unit === "per_employee" ? counts.employees : unit === "per_worker" ? counts.workers : null;
              return (
                <label key={s.service_key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={services.includes(s.service_key)} onChange={(e) => toggle(s.service_key, e.target.checked)} />
                  {s.label}
                  {s.min_fee != null && (
                    <span className="muted" style={{ fontSize: 11 }}>
                      ${Number(s.min_fee).toFixed(0)}{PRICING_UNIT_SUFFIX[unit] || "/mo"}
                      {unitCount !== null && ` (× ${unitCount} = $${(Number(s.min_fee) * unitCount).toFixed(0)}/mo)`}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {anyRecurringChecked && (
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 16, marginTop: 4,
          padding: "6px 14px", borderRadius: 999, background: color.bg, border: `1px solid ${color.fg}`,
        }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: color.fg }}>${fee.toFixed(2)}/mo</span>
          <span className="muted" style={{ fontSize: 12 }}>—</span>
          <span style={{ fontWeight: 700, fontSize: 12, color: color.fg }}>{tierMeta?.tier_name || tierKey}</span>
        </div>
      )}

      {oneTime.length > 0 && (
        <>
          <div className="ac-subcard-title" style={{ marginBottom: 6, marginTop: anyRecurringChecked ? 0 : 8 }}>One-Time / Project Services</div>
          <p className="muted" style={{ fontSize: 11.5, margin: "0 0 8px" }}>Billed per engagement — never part of the monthly subscription.</p>
          {groupBy(oneTime).map(([group, entries]) => (
            <div key={group} style={{ marginBottom: 10 }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>{group}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px 16px" }}>
                {entries.map((s) => {
                  // subscriber_discount (sql/110) — knocks a flat $ off a
                  // one-time fee for a client who already has at least one
                  // other active recurring service checked, i.e. they're
                  // already a subscriber, not buying this standalone.
                  const discount = s.subscriber_discount != null ? Number(s.subscriber_discount) : 0;
                  const discountApplies = discount > 0 && anyRecurringChecked && services.includes(s.service_key);
                  const rawFee = s.min_fee != null ? Number(s.min_fee) : null;
                  return (
                    <label key={s.service_key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <input type="checkbox" checked={services.includes(s.service_key)} onChange={(e) => toggle(s.service_key, e.target.checked)} />
                      {s.label}
                      {rawFee != null && (
                        <span className="muted" style={{ fontSize: 11 }}>
                          {discountApplies ? (
                            <>
                              <span style={{ textDecoration: "line-through" }}>${rawFee.toFixed(0)}</span>{" "}
                              <strong style={{ color: "var(--teal)" }}>${(rawFee - discount).toFixed(0)}</strong> one-time
                              {" "}(${discount.toFixed(0)} subscriber discount)
                            </>
                          ) : (
                            `$${rawFee.toFixed(0)} one-time${discount > 0 ? ` ($${discount.toFixed(0)} off if bundled with an active subscription)` : ""}`
                          )}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}
