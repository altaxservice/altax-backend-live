import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { StatusBadge } from "../components/StatusBadge";
import { useStickyState } from "../utils/listState";
import { BUSINESS_TYPES, ENTITY_TYPES, SPEEDS, money, type Estimate } from "../api/estimates";
import { useEscapeToClose } from "../hooks/useEscapeToClose";

/**
 * Estimates — the pipeline of businesses being quoted.
 *
 * These are prospects, not clients: an estimate carries its own business name
 * and address, so quoting somebody never puts a half-real record in the Clients
 * list. A client is created only when an estimate is approved and converted.
 */
export function EstimatesListPage() {
  const navigate = useNavigate();
  const [estimates, setEstimates] = useState<Estimate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useStickyState("estimates.status", "open");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [jurisdictions, setJurisdictions] = useState<string[]>([]);
  const [form, setForm] = useState({
    businessName: "", contactName: "", email: "", phone: "",
    street: "", city: "", state: "MD", zip: "",
    entityType: "LLC", businessType: "Restaurant / Carryout", jurisdiction: "Baltimore City", speed: "Standard",
  });

  useEscapeToClose(() => setCreating(false), creating);

  function load() {
    api.get<{ estimates: Estimate[] }>("/estimates")
      .then((res) => setEstimates(res.estimates))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load estimates."));
  }
  useEffect(load, []);
  useEffect(() => {
    api.get<{ jurisdictions: string[] }>("/estimates/fee-items")
      .then((res) => setJurisdictions(res.jurisdictions))
      .catch(() => {});
  }, []);

  const filtered = (estimates || []).filter((e) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "open") return e.status === "Draft" || e.status === "Contacted" || e.status === "Sent";
    return e.status === statusFilter;
  });

  const pipeline = (estimates || [])
    .filter((e) => e.status === "Draft" || e.status === "Contacted" || e.status === "Sent")
    .reduce((sum, e) => sum + (e.totals?.total || 0), 0);
  const won = (estimates || []).filter((e) => e.status === "Approved");
  const unremitted = (estimates || []).reduce((sum, e) => sum + (e.totals?.unremitted || 0), 0);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.post<{ estimateId: string }>("/estimates", form);
      navigate(`/estimates/${res.estimateId}`);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not create this estimate.");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <ErrorBanner error={error} />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Quote a new business, then turn an approved quote into a client, invoice and task list in one step.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>New Estimate</button>
      </div>

      <div className="metric-grid metric-grid-3" style={{ marginBottom: 16 }}>
        <div className="metric">
          <div className="metric-label">Open Pipeline</div>
          <div className="metric-value">{money(pipeline)}</div>
          <div className="metric-sub">{(estimates || []).filter((e) => e.status === "Draft" || e.status === "Contacted" || e.status === "Sent").length} estimates</div>
        </div>
        <div className="metric">
          <div className="metric-label">Approved</div>
          <div className="metric-value">{won.length}</div>
          <div className="metric-sub">{won.filter((e) => !e.client_id).length} awaiting conversion</div>
        </div>
        <div className="metric">
          <div className="metric-label">Agency Fees Not Yet Paid</div>
          <div className="metric-value">{money(unremitted)}</div>
          <div className="metric-sub">Collected but not remitted</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {["open", "all", "Draft", "Contacted", "Sent", "Approved", "Declined"].map((s) => (
          <button key={s} className={`btn btn-sm ${statusFilter === s ? "btn-primary" : ""}`} onClick={() => setStatusFilter(s)}>
            {s === "open" ? "Open" : s === "all" ? "All" : s}
          </button>
        ))}
      </div>

      {estimates === null && !error && <div className="spinner-wrap">Loading estimates…</div>}

      {estimates !== null && (
      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Business</th>
                <th>Job</th>
                <th>Status</th>
                <th>Valid Until</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th style={{ textAlign: "right" }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((est) => (
                <tr key={est.estimate_id} data-row-id={est.estimate_id}
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/estimates/${est.estimate_id}`)}>
                  <td data-label="Business">
                    <div className="cell-primary">{est.business_name}</div>
                    <div className="cell-sub">{est.estimate_number}{est.city ? ` · ${est.city}` : ""}</div>
                  </td>
                  <td data-label="Job" className="muted" style={{ fontSize: 12 }}>
                    {[est.entity_type, est.business_type].filter(Boolean).join(" · ") || "—"}
                    <br />
                    {[est.jurisdiction, est.speed].filter(Boolean).join(" · ")}
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={est.status} />
                    {est.client_id && <div className="cell-sub">Converted</div>}
                  </td>
                  <td data-label="Valid Until" className="muted">{est.valid_until || "—"}</td>
                  <td data-label="Total" style={{ textAlign: "right", fontWeight: 700 }}>{money(est.totals?.total)}</td>
                  <td data-label="Balance" style={{ textAlign: "right" }}>{money(est.totals?.balanceDue)}</td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>No estimates here yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {creating && (
        <div className="modal-overlay" onClick={() => setCreating(false)}>
          <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="new-estimate-title" style={{ maxWidth: 560, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="new-estimate-title">New Estimate</h2>
              <button className="btn btn-sm" onClick={() => setCreating(false)}>Close</button>
            </div>
            <form onSubmit={handleCreate}>
              {saveError && <ErrorBanner error={saveError} />}

              <div className="field">
                <label htmlFor="ne-name">Business name</label>
                <input id="ne-name" required autoFocus value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field">
                  <label htmlFor="ne-contact">Contact name</label>
                  <input id="ne-contact" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="ne-phone">Phone</label>
                  <input id="ne-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="ne-email">Email</label>
                <input id="ne-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="ne-street">Street</label>
                <input id="ne-street" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
                <div className="field">
                  <label htmlFor="ne-city">City</label>
                  <input id="ne-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="ne-state">State</label>
                  <input id="ne-state" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="ne-zip">ZIP</label>
                  <input id="ne-zip" value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} />
                </div>
              </div>

              <p className="muted" style={{ fontSize: 12, margin: "8px 0 4px" }}>
                These four choices decide which fees are pulled in — you can change every line afterwards.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field">
                  <label htmlFor="ne-entity">Entity type</label>
                  <select id="ne-entity" value={form.entityType} onChange={(e) => setForm({ ...form, entityType: e.target.value })}>
                    {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="ne-biz">Business type</label>
                  <select id="ne-biz" value={form.businessType} onChange={(e) => setForm({ ...form, businessType: e.target.value })}>
                    {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="ne-jur">Jurisdiction</label>
                  <select id="ne-jur" value={form.jurisdiction} onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })}>
                    {jurisdictions.map((j) => <option key={j} value={j}>{j}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="ne-speed">Filing speed</label>
                  <select id="ne-speed" value={form.speed} onChange={(e) => setForm({ ...form, speed: e.target.value })}>
                    {SPEEDS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                <button type="button" className="btn" onClick={() => setCreating(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Building…" : "Build Estimate"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
