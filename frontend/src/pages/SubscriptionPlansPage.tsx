import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { ServiceCatalogEntry, SubscriptionTier } from "../api/types";
import { ErrorBanner } from "../components/ErrorBanner";
import { useNotify } from "../components/ConfirmProvider";
import { useAuth } from "../auth/AuthContext";

/**
 * "Minimum Fee Schedule" — direct owner request, 2026-08-26: every
 * subscription service (recurring or one-time) is its own editable row here;
 * a client's monthly subscription price and tier are both derived
 * automatically from whichever of these a staff member checks on the client
 * profile (see SubscriptionServicesChecklist.tsx), never a separate
 * hand-picked number. Named "Subscription Plans" in the nav (not "Fee
 * Schedule") to avoid colliding with the unrelated, pre-existing Estimates
 * fee schedule at /fee-schedule (government filing cost items).
 */

type Draft = { label: string; groupName: string; minFee: string; active: boolean };

const NEW_SERVICE_DEFAULTS = { serviceKey: "", label: "", groupName: "", role: "addon" as "addon" | "one_time", minFee: "" };

export function SubscriptionPlansPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const notify = useNotify();
  const [services, setServices] = useState<ServiceCatalogEntry[] | null>(null);
  const [tiers, setTiers] = useState<SubscriptionTier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [tierDrafts, setTierDrafts] = useState<Record<string, { tierName: string; description: string }>>({});
  const [savingTier, setSavingTier] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newService, setNewService] = useState(NEW_SERVICE_DEFAULTS);
  const [newSaving, setNewSaving] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);

  function load() {
    Promise.all([
      api.get<{ services: ServiceCatalogEntry[] }>("/service-catalog"),
      api.get<{ tiers: SubscriptionTier[] }>("/service-catalog/tiers"),
    ]).then(([svc, t]) => {
      setServices(svc.services);
      setDrafts(Object.fromEntries(svc.services.map((s) => [s.service_key, {
        label: s.label, groupName: s.group_name, minFee: s.min_fee != null ? String(s.min_fee) : "", active: s.active,
      }])));
      setTiers(t.tiers);
      setTierDrafts(Object.fromEntries(t.tiers.map((tr) => [tr.tier_key, { tierName: tr.tier_name, description: tr.description || "" }])));
    }).catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the Minimum Fee Schedule."));
  }
  useEffect(load, []);

  async function saveRow(key: string) {
    const d = drafts[key];
    if (!d) return;
    setSavingKey(key);
    try {
      await api.patch(`/service-catalog/${key}`, {
        label: d.label, groupName: d.groupName,
        minFee: d.minFee === "" ? null : Number(d.minFee),
        active: d.active,
      });
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not save this service.");
    } finally {
      setSavingKey(null);
    }
  }

  async function saveTier(key: string) {
    const d = tierDrafts[key];
    if (!d) return;
    setSavingTier(key);
    try {
      await api.patch(`/service-catalog/tiers/${key}`, { tierName: d.tierName, description: d.description });
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not save this tier.");
    } finally {
      setSavingTier(null);
    }
  }

  async function handleAddService(e: FormEvent) {
    e.preventDefault();
    setNewSaving(true);
    setNewError(null);
    try {
      await api.post("/service-catalog", {
        serviceKey: newService.serviceKey || undefined,
        label: newService.label, groupName: newService.groupName, role: newService.role,
        minFee: newService.minFee === "" ? null : Number(newService.minFee),
      });
      setNewService(NEW_SERVICE_DEFAULTS);
      setShowNewForm(false);
      load();
    } catch (err) {
      setNewError(err instanceof ApiError ? err.message : "Could not add this service.");
    } finally {
      setNewSaving(false);
    }
  }

  if (error) return <ErrorBanner error={error} />;
  if (!services || !tiers) return <div className="spinner-wrap">Loading…</div>;

  const groups = Array.from(new Set(services.filter((s) => !s.legacy).map((s) => s.group_name)));
  const ROLE_LABEL: Record<string, string> = { core_pillar: "Core pillar (tier-defining)", addon: "Add-on", one_time: "One-time" };

  return (
    <div>
      <p className="muted" style={{ marginBottom: 16, maxWidth: 760 }}>
        Every service a client can be checked into, with its own minimum monthly fee. Editing a fee here applies to every client with that service checked the next time their profile is saved. Core-pillar services (Bookkeeping, Payroll, Sales Tax, Business Tax Return) also decide a client's subscription tier — that rule is fixed in code, not editable here, so relabeling a service never silently changes what counts toward a tier.
      </p>

      <div className="command-panel" style={{ marginBottom: 20 }}>
        <div className="command-panel-header">
          <h2 className="command-panel-title">Subscription Tiers</h2>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th scope="col">Tier</th><th scope="col">Description</th><th scope="col"></th></tr></thead>
            <tbody>
              {tiers.map((t) => (
                <tr key={t.tier_key}>
                  <td style={{ width: 200 }}>
                    <input
                      value={tierDrafts[t.tier_key]?.tierName ?? ""}
                      disabled={!isAdmin}
                      onChange={(e) => setTierDrafts((prev) => ({ ...prev, [t.tier_key]: { ...prev[t.tier_key], tierName: e.target.value } }))}
                    />
                  </td>
                  <td>
                    <input
                      style={{ width: "100%" }}
                      value={tierDrafts[t.tier_key]?.description ?? ""}
                      disabled={!isAdmin}
                      onChange={(e) => setTierDrafts((prev) => ({ ...prev, [t.tier_key]: { ...prev[t.tier_key], description: e.target.value } }))}
                    />
                  </td>
                  <td>{isAdmin && <button className="btn btn-sm" disabled={savingTier === t.tier_key} onClick={() => saveTier(t.tier_key)}>{savingTier === t.tier_key ? "Saving…" : "Save"}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="command-panel">
        <div className="command-panel-header">
          <h2 className="command-panel-title">Minimum Fee Schedule</h2>
          {isAdmin && <button className="btn btn-sm btn-primary" onClick={() => setShowNewForm((v) => !v)}>{showNewForm ? "Cancel" : "+ Add Service"}</button>}
        </div>

        {showNewForm && isAdmin && (
          <form onSubmit={handleAddService} className="card" style={{ marginBottom: 16, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
            {newError && <div style={{ gridColumn: "1 / -1" }}><ErrorBanner error={newError} /></div>}
            <div className="field"><label>Label</label><input required value={newService.label} onChange={(e) => setNewService((s) => ({ ...s, label: e.target.value }))} placeholder="e.g. Quarterly Financial Review" /></div>
            <div className="field"><label>Group</label><input required list="fee-schedule-groups" value={newService.groupName} onChange={(e) => setNewService((s) => ({ ...s, groupName: e.target.value }))} placeholder="e.g. Bookkeeping & Accounting" /></div>
            <datalist id="fee-schedule-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
            <div className="field">
              <label>Type</label>
              <select value={newService.role} onChange={(e) => setNewService((s) => ({ ...s, role: e.target.value as "addon" | "one_time" }))}>
                <option value="addon">Recurring add-on (adds to the monthly subscription)</option>
                <option value="one_time">One-time (billed per engagement, never part of the subscription)</option>
              </select>
            </div>
            <div className="field">
              <label>{newService.role === "one_time" ? "Reference Fee ($, one-time — shown but never added to the subscription)" : "Minimum Fee ($/mo)"}</label>
              <input type="number" step="0.01" value={newService.minFee} onChange={(e) => setNewService((s) => ({ ...s, minFee: e.target.value }))} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <button type="submit" className="btn btn-primary" disabled={newSaving}>{newSaving ? "Adding…" : "Add Service"}</button>
            </div>
          </form>
        )}

        {groups.map((group) => (
          <div key={group} style={{ marginBottom: 18 }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{group}</div>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th scope="col">Label</th><th scope="col">Type</th><th scope="col">Min. Fee</th><th scope="col">Billed</th><th scope="col">Active</th><th scope="col"></th></tr></thead>
                <tbody>
                  {services.filter((s) => s.group_name === group && !s.legacy).map((s) => {
                    const d = drafts[s.service_key];
                    if (!d) return null;
                    const billedLabel = s.role === "one_time" ? "One-time / per engagement" : "Monthly";
                    return (
                      <tr key={s.service_key}>
                        <td style={{ minWidth: 220 }}>
                          <input style={{ width: "100%" }} value={d.label} disabled={!isAdmin} onChange={(e) => setDrafts((prev) => ({ ...prev, [s.service_key]: { ...prev[s.service_key], label: e.target.value } }))} />
                        </td>
                        <td className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{ROLE_LABEL[s.role]}</td>
                        <td style={{ width: 140 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            $<input type="number" step="0.01" style={{ width: 80 }} placeholder="—" value={d.minFee} disabled={!isAdmin} onChange={(e) => setDrafts((prev) => ({ ...prev, [s.service_key]: { ...prev[s.service_key], minFee: e.target.value } }))} />
                          </span>
                        </td>
                        <td className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{billedLabel}</td>
                        <td><input type="checkbox" checked={d.active} disabled={!isAdmin} onChange={(e) => setDrafts((prev) => ({ ...prev, [s.service_key]: { ...prev[s.service_key], active: e.target.checked } }))} /></td>
                        <td>{isAdmin && <button className="btn btn-sm" disabled={savingKey === s.service_key} onClick={() => saveRow(s.service_key)}>{savingKey === s.service_key ? "Saving…" : "Save"}</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
