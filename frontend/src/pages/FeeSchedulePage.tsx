import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { useToast } from "../components/Toast";
import { useStickyState } from "../utils/listState";
import { BUSINESS_TYPES, ENTITY_TYPES, SPEEDS, money, type FeeItem } from "../api/estimates";

/**
 * The priced catalog behind every estimate.
 *
 * Deliberately the ONLY place a fee amount exists. Agencies change their prices
 * and the firm re-prices with them, so nothing here is compiled into the app —
 * staff edit these rows and every future estimate follows. Rows are matched into
 * an estimate by entity type, business type, jurisdiction and speed, which is why
 * adding a new county is data entry rather than a code change.
 */

const EMPTY: Partial<FeeItem> & { unit_cost: string; unit_price: string } = {
  name: "", category: "Government", agency: "", jurisdiction: "Maryland",
  entity_types: [], business_types: [], speed: null,
  amount_kind: "fixed", percent_rate: "0", unit_cost: "0", unit_price: "0",
  included: false, optional: false, turnaround_days: "", notes: "", active: true, sort_order: 0,
};

export function FeeSchedulePage() {
  const toast = useToast();
  const [items, setItems] = useState<FeeItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<(Partial<FeeItem> & Record<string, unknown>) | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [jurisdictionFilter, setJurisdictionFilter] = useStickyState("fees.jurisdiction", "all");
  const [categoryFilter, setCategoryFilter] = useStickyState("fees.category", "all");

  function load() {
    api.get<{ feeItems: FeeItem[] }>("/estimates/fee-items")
      .then((res) => setItems(res.feeItems))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the fee schedule."));
  }
  useEffect(load, []);

  const jurisdictions = Array.from(new Set((items || []).map((i) => i.jurisdiction))).sort();
  const filtered = (items || []).filter((i) => {
    if (jurisdictionFilter !== "all" && i.jurisdiction !== jurisdictionFilter) return false;
    if (categoryFilter !== "all" && i.category !== categoryFilter) return false;
    return true;
  });

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.post("/estimates/fee-items", {
        feeItemId: editing.fee_item_id,
        name: editing.name,
        category: editing.category,
        agency: editing.agency,
        jurisdiction: editing.jurisdiction,
        entityTypes: editing.entity_types || [],
        businessTypes: editing.business_types || [],
        speed: editing.speed || "",
        amountKind: editing.amount_kind,
        percentRate: Number(editing.percent_rate) || 0,
        unitCost: Number(editing.unit_cost) || 0,
        unitPrice: Number(editing.unit_price) || 0,
        defaultQty: Number(editing.default_qty) || 1,
        included: Boolean(editing.included),
        optional: Boolean(editing.optional),
        statewide: Boolean(editing.statewide),
        createsTask: Boolean(editing.creates_task),
        turnaroundDays: editing.turnaround_days,
        notes: editing.notes,
        active: editing.active === undefined ? true : Boolean(editing.active),
        sortOrder: Number(editing.sort_order) || 0,
      });
      toast(editing.fee_item_id ? "Fee updated." : "Fee added.");
      setEditing(null);
      load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save this fee.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(item: FeeItem) {
    if (!confirm(`Deactivate "${item.name}"? It stays on estimates that already use it.`)) return;
    try {
      await api.post(`/estimates/fee-items/${item.fee_item_id}/delete`, {});
      toast("Fee deactivated.");
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not deactivate this fee.");
    }
  }

  function toggleIn(list: string[] | undefined, value: string): string[] {
    const arr = list || [];
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
  }

  if (error) return <ErrorBanner error={error} />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Fee Schedule</h1>
          <p className="muted" style={{ margin: 0, fontSize: 13, maxWidth: 640 }}>
            Every amount an estimate can use. Change a fee here and all future estimates follow — estimates already
            sent keep the amounts they were built with.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })}>Add Fee</button>
      </div>

      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ margin: 0, minWidth: 180 }}>
          <label htmlFor="fs-j">Jurisdiction</label>
          <select id="fs-j" value={jurisdictionFilter} onChange={(e) => setJurisdictionFilter(e.target.value)}>
            <option value="all">All</option>
            {jurisdictions.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0, minWidth: 180 }}>
          <label htmlFor="fs-c">Type</label>
          <select id="fs-c" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="Government">Government / agency fee</option>
            <option value="Service">AL TAX service fee</option>
          </select>
        </div>
        <div className="muted" style={{ fontSize: 12, paddingBottom: 8 }}>{filtered.length} of {(items || []).length} fees</div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fee</th>
                <th>Applies To</th>
                <th>Speed</th>
                <th style={{ textAlign: "right" }}>Agency Cost</th>
                <th style={{ textAlign: "right" }}>Client Price</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const cost = item.amount_kind === "percent" ? `${Number(item.percent_rate)}%` : money(item.unit_cost);
                const price = item.amount_kind === "percent" ? `${Number(item.percent_rate)}%` : money(item.unit_price);
                const margin = Number(item.unit_price) - Number(item.unit_cost);
                return (
                  <tr key={item.fee_item_id} data-row-id={item.fee_item_id} style={{ opacity: item.active ? 1 : 0.5 }}>
                    <td data-label="Fee">
                      <div className="cell-primary">{item.name}</div>
                      <div className="cell-sub">
                        {item.agency || "—"} · {item.jurisdiction}
                        {item.statewide && " · Statewide"}
                        {item.creates_task && " · Creates task"}
                        {item.included && " · Included"}
                        {item.optional && " · Optional"}
                        {!item.active && " · Inactive"}
                      </div>
                    </td>
                    <td data-label="Applies To" className="muted" style={{ fontSize: 12 }}>
                      {(item.entity_types || []).length ? item.entity_types.join(", ") : "Any entity"}
                      <br />
                      {(item.business_types || []).length ? item.business_types.join(", ") : "Any business"}
                    </td>
                    <td data-label="Speed">{item.speed || "Any"}</td>
                    <td data-label="Agency Cost" style={{ textAlign: "right" }}>{cost}</td>
                    <td data-label="Client Price" style={{ textAlign: "right" }}>
                      {price}
                      {item.amount_kind !== "percent" && margin !== 0 && (
                        <div className="cell-sub" style={{ color: margin > 0 ? "var(--teal)" : "var(--danger, #cf222e)" }}>
                          {margin > 0 ? "+" : ""}{money(margin)} margin
                        </div>
                      )}
                    </td>
                    <td data-label="" style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn btn-sm" onClick={() => setEditing({ ...item })}>Edit</button>{" "}
                      {item.active && <button className="btn btn-sm" onClick={() => handleDeactivate(item)}>Remove</button>}
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>No fees match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal-panel" style={{ maxWidth: 640, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editing.fee_item_id ? "Edit Fee" : "Add Fee"}</h2>
              <button className="btn btn-sm" onClick={() => setEditing(null)}>Close</button>
            </div>
            <form onSubmit={handleSave}>
              {saveError && <ErrorBanner error={saveError} />}

              <div className="field">
                <label htmlFor="fe-name">Fee name</label>
                <input id="fe-name" required value={String(editing.name || "")} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field">
                  <label htmlFor="fe-cat">Type</label>
                  <select id="fe-cat" value={String(editing.category)} onChange={(e) => setEditing({ ...editing, category: e.target.value as "Government" | "Service" })}>
                    <option value="Government">Government / agency fee</option>
                    <option value="Service">AL TAX service fee</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="fe-agency">Agency</label>
                  <input id="fe-agency" value={String(editing.agency || "")} placeholder="MD SDAT" onChange={(e) => setEditing({ ...editing, agency: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="fe-jur">Jurisdiction</label>
                  <input id="fe-jur" list="fe-jur-list" value={String(editing.jurisdiction || "")} onChange={(e) => setEditing({ ...editing, jurisdiction: e.target.value })} />
                  <datalist id="fe-jur-list">
                    {jurisdictions.map((j) => <option key={j} value={j} />)}
                    <option value="Any" />
                  </datalist>
                  <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>Type a new county name to add it.</p>
                </div>
                <div className="field">
                  <label htmlFor="fe-speed">Only at speed</label>
                  <select id="fe-speed" value={String(editing.speed || "")} onChange={(e) => setEditing({ ...editing, speed: e.target.value || null })}>
                    <option value="">Any speed</option>
                    {SPEEDS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="field">
                <label htmlFor="fe-kind">Amount</label>
                <select id="fe-kind" value={String(editing.amount_kind)} onChange={(e) => setEditing({ ...editing, amount_kind: e.target.value as "fixed" | "percent" })}>
                  <option value="fixed">Fixed amount</option>
                  <option value="percent">Percentage of the government subtotal</option>
                </select>
              </div>

              {editing.amount_kind === "percent" ? (
                <div className="field">
                  <label htmlFor="fe-pct">Percent</label>
                  <input id="fe-pct" type="number" step="0.01" value={String(editing.percent_rate ?? 0)} onChange={(e) => setEditing({ ...editing, percent_rate: e.target.value })} />
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="field">
                    <label htmlFor="fe-cost">What the agency charges us</label>
                    <input id="fe-cost" type="number" step="0.01" value={String(editing.unit_cost ?? 0)} onChange={(e) => setEditing({ ...editing, unit_cost: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="fe-price">What we charge the client</label>
                    <input id="fe-price" type="number" step="0.01" value={String(editing.unit_price ?? 0)} onChange={(e) => setEditing({ ...editing, unit_price: e.target.value })} />
                  </div>
                </div>
              )}

              <div className="field">
                <label>Only for these entity types <span className="muted">(none = all)</span></label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {ENTITY_TYPES.map((t) => (
                    <button key={t} type="button"
                      className={`btn btn-sm ${(editing.entity_types as string[] || []).includes(t) ? "btn-primary" : ""}`}
                      onClick={() => setEditing({ ...editing, entity_types: toggleIn(editing.entity_types as string[], t) })}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Only for these business types <span className="muted">(none = all)</span></label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {BUSINESS_TYPES.map((t) => (
                    <button key={t} type="button"
                      className={`btn btn-sm ${(editing.business_types as string[] || []).includes(t) ? "btn-primary" : ""}`}
                      onClick={() => setEditing({ ...editing, business_types: toggleIn(editing.business_types as string[], t) })}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", margin: "4px 0 12px", fontSize: 13 }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={Boolean(editing.included)} onChange={(e) => setEditing({ ...editing, included: e.target.checked })} />
                  Show as "Included" (no charge)
                </label>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={Boolean(editing.optional)} onChange={(e) => setEditing({ ...editing, optional: e.target.checked })} />
                  Optional — staff add it manually
                </label>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={Boolean(editing.statewide)} onChange={(e) => setEditing({ ...editing, statewide: e.target.checked })} />
                  Applies statewide (every county)
                </label>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={Boolean(editing.creates_task)} onChange={(e) => setEditing({ ...editing, creates_task: e.target.checked })} />
                  Real work — open a task on conversion
                </label>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={editing.active === undefined ? true : Boolean(editing.active)} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                  Active
                </label>
              </div>

              <div className="field">
                <label htmlFor="fe-notes">Notes <span className="muted">(shown to staff, not the client)</span></label>
                <input id="fe-notes" value={String(editing.notes || "")} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Fee"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
