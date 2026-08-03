import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import { money, type EstimateLine, type FeeItem } from "../api/estimates";
import { ErrorBanner } from "./ErrorBanner";
import { useEscapeToClose } from "../hooks/useEscapeToClose";

/**
 * Add Line — two ways onto an estimate, because they serve different moments:
 *
 *  - "From Fee Schedule" is the normal path: pick an already-priced item (the
 *    same catalog Tools → Fee Schedule maintains) so the amount is never
 *    retyped and never drifts from what the firm actually charges for it.
 *  - "New Line" is for the one-off — a fee that isn't in the catalog yet, or
 *    genuinely never will be. It can ALSO be saved to the Fee Schedule on the
 *    way in, so the next estimate that needs the same thing finds it already
 *    there instead of every job re-typing a fee the firm charges routinely.
 */
export function AddEstimateLineModal({ jurisdiction, onClose, onAdd }: {
  jurisdiction: string | null;
  onClose: () => void;
  onAdd: (lines: EstimateLine[]) => void;
}) {
  useEscapeToClose(onClose);
  const [mode, setMode] = useState<"catalog" | "new">("catalog");

  // ---- Catalog mode ----
  const [items, setItems] = useState<FeeItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [catalogQty, setCatalogQty] = useState(1);

  useEffect(() => {
    api.get<{ feeItems: FeeItem[] }>("/estimates/fee-items")
      .then((res) => setItems(res.feeItems.filter((i) => i.active)))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Could not load the fee schedule."));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = items || [];
    if (!q) return list;
    return list.filter((i) => i.name.toLowerCase().includes(q) || (i.agency || "").toLowerCase().includes(q) || i.jurisdiction.toLowerCase().includes(q));
  }, [items, search]);

  const selected = (items || []).find((i) => i.fee_item_id === selectedId) || null;

  function addFromCatalog() {
    if (!selected) return;
    onAdd([{
      fee_item_id: selected.fee_item_id,
      description: selected.name,
      category: selected.category,
      agency: selected.agency,
      qty: catalogQty || 1,
      unit_cost: Number(selected.unit_cost),
      unit_price: Number(selected.unit_price),
      amount_kind: selected.amount_kind,
      percent_rate: Number(selected.percent_rate),
      included: selected.included,
      payer: "Firm",
    }]);
  }

  // ---- New line mode ----
  const [desc, setDesc] = useState("");
  const [category, setCategory] = useState<"Government" | "Service">("Government");
  const [agency, setAgency] = useState("");
  const [qty, setQty] = useState(1);
  const [cost, setCost] = useState(0);
  const [price, setPrice] = useState(0);
  const [included, setIncluded] = useState(false);
  const [payer, setPayer] = useState<"Firm" | "Client">("Firm");
  const [saveToSchedule, setSaveToSchedule] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function addNewLine() {
    if (!desc.trim()) { setSaveError("Enter a description."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      let feeItemId: string | null = null;
      if (saveToSchedule) {
        const res = await api.post<{ feeItemId: string }>("/estimates/fee-items", {
          name: desc.trim(),
          category,
          agency: agency.trim() || null,
          // Scoped to the job's own jurisdiction rather than added statewide —
          // a one-off fee shouldn't silently start applying to every county's
          // estimates just because it was saved from this one.
          jurisdiction: jurisdiction || "Any",
          entityTypes: [],
          businessTypes: [],
          amountKind: "fixed",
          unitCost: cost,
          unitPrice: price,
          included,
        });
        feeItemId = res.feeItemId;
      }
      onAdd([{
        fee_item_id: feeItemId,
        description: desc.trim(),
        category,
        agency: agency.trim() || null,
        qty: qty || 1,
        unit_cost: cost,
        unit_price: price,
        amount_kind: "fixed",
        percent_rate: 0,
        included,
        payer: category === "Government" ? payer : "Firm",
      }]);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save this fee.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" role="dialog" aria-modal="true" style={{ maxWidth: 640, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>Add Line</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button type="button" className={`btn btn-sm ${mode === "catalog" ? "btn-primary" : ""}`} onClick={() => setMode("catalog")}>From Fee Schedule</button>
          <button type="button" className={`btn btn-sm ${mode === "new" ? "btn-primary" : ""}`} onClick={() => setMode("new")}>New Line</button>
        </div>

        {mode === "catalog" ? (
          <>
            {loadError && <ErrorBanner error={loadError} />}
            <div className="field">
              <label htmlFor="al-search">Search</label>
              <input id="al-search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Fee name, agency, or jurisdiction…" />
            </div>
            <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
              {filtered.map((item) => (
                <button
                  key={item.fee_item_id} type="button"
                  onClick={() => setSelectedId(item.fee_item_id)}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
                    textAlign: "left", padding: "9px 12px", border: "none", borderBottom: "1px solid var(--line)",
                    background: selectedId === item.fee_item_id ? "var(--teal-soft)" : "transparent", cursor: "pointer",
                  }}
                >
                  <span>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>{item.agency || "—"} · {item.jurisdiction}{item.speed ? ` · ${item.speed}` : ""}</div>
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, flexShrink: 0, marginLeft: 10 }}>
                    {item.amount_kind === "percent" ? `${Number(item.percent_rate)}%` : item.included ? "Included" : money(item.unit_price)}
                  </span>
                </button>
              ))}
              {!filtered.length && items && (
                <div className="muted" style={{ padding: 20, textAlign: "center", fontSize: 13 }}>No fees match "{search}".</div>
              )}
              {!items && !loadError && (
                <div className="muted" style={{ padding: 20, textAlign: "center", fontSize: 13 }}>Loading…</div>
              )}
            </div>

            {selected && (
              <div className="field" style={{ maxWidth: 120, marginTop: 12 }}>
                <label htmlFor="al-qty">Quantity</label>
                <input id="al-qty" type="number" min="1" step="1" value={catalogQty} onChange={(e) => setCatalogQty(Number(e.target.value))} />
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={!selected} onClick={addFromCatalog}>Add to Estimate</button>
            </div>
          </>
        ) : (
          <>
            {saveError && <ErrorBanner error={saveError} />}
            <div className="field">
              <label htmlFor="al-desc">Description</label>
              <input id="al-desc" autoFocus value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field">
                <label htmlFor="al-cat">Type</label>
                <select id="al-cat" value={category} onChange={(e) => setCategory(e.target.value as "Government" | "Service")}>
                  <option value="Government">Government / agency fee</option>
                  <option value="Service">AL TAX service fee</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="al-agency">Agency</label>
                <input id="al-agency" value={agency} onChange={(e) => setAgency(e.target.value)} placeholder="e.g. MD SDAT" />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div className="field">
                <label htmlFor="al-newqty">Qty</label>
                <input id="al-newqty" type="number" min="1" step="1" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
              </div>
              <div className="field">
                <label htmlFor="al-cost">Our Cost</label>
                <input id="al-cost" type="number" step="0.01" value={cost} onChange={(e) => setCost(Number(e.target.value))} />
              </div>
              <div className="field">
                <label htmlFor="al-price">Client Price</label>
                <input id="al-price" type="number" step="0.01" value={price} onChange={(e) => setPrice(Number(e.target.value))} disabled={included} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", margin: "4px 0 4px", fontSize: 13 }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={included} onChange={(e) => setIncluded(e.target.checked)} />
                Show as "Included" (no charge)
              </label>
              {category === "Government" && (
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span className="muted">Paid by:</span>
                  <select value={payer} onChange={(e) => setPayer(e.target.value as "Firm" | "Client")} style={{ padding: "2px 6px" }}>
                    <option value="Firm">We collect</option>
                    <option value="Client">Client pays agency</option>
                  </select>
                </label>
              )}
            </div>

            <label className="card" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginTop: 8 }}>
              <input type="checkbox" checked={saveToSchedule} onChange={(e) => setSaveToSchedule(e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                Also add this to the Fee Schedule
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  Makes it pickable from "From Fee Schedule" on future estimates
                  {jurisdiction ? ` for ${jurisdiction} jobs` : ""}. Fine-tune who it applies to later in Tools → Fee Schedule.
                </div>
              </span>
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={saving || !desc.trim()} onClick={addNewLine}>
                {saving ? "Adding…" : "Add to Estimate"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
