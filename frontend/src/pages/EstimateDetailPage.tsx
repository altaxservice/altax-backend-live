import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError, downloadFile, fetchAuthedBlob } from "../api/client";
import { BackLink } from "../components/BackLink";
import { ErrorBanner } from "../components/ErrorBanner";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/Toast";
import { SendEstimateModal } from "../components/SendEstimateModal";
import { AddEstimateLineModal } from "../components/AddEstimateLineModal";
import { money, type Estimate, type EstimateLine, type EstimateTotals } from "../api/estimates";

/**
 * The estimate builder.
 *
 * Lines arrive priced from the fee catalog, then staff adjust them: quantity,
 * price, mark a line Included, or hand it to the client to pay the agency
 * directly. Two figures per government line — what the agency charges us and
 * what the client pays — because the firm rounds up (a $216.30 filing billed at
 * $225) and that difference is real margin that has to land somewhere visible
 * rather than disappearing into a single lump sum.
 */
export function EstimateDetailPage() {
  const { estimateId } = useParams<{ estimateId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [lines, setLines] = useState<EstimateLine[]>([]);
  const [totals, setTotals] = useState<EstimateTotals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [addLineOpen, setAddLineOpen] = useState(false);

  function load() {
    if (!estimateId) return;
    api.get<{ estimate: Estimate; lines: EstimateLine[]; totals: EstimateTotals }>(`/estimates/${estimateId}`)
      .then((res) => { setEstimate(res.estimate); setLines(res.lines); setTotals(res.totals); setDirty(false); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this estimate."));
  }
  useEffect(load, [estimateId]);

  function patchLine(index: number, patch: Partial<EstimateLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    setDirty(true);
  }

  async function saveLines(next?: EstimateLine[]) {
    if (!estimateId) return;
    setSaving(true);
    try {
      const res = await api.put<{ lines: EstimateLine[]; totals: EstimateTotals }>(`/estimates/${estimateId}/lines`, {
        lines: next || lines,
      });
      setLines(res.lines);
      setTotals(res.totals);
      setDirty(false);
      toast("Estimate saved.");
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not save these lines.");
    } finally {
      setSaving(false);
    }
  }

  async function patchEstimate(patch: Record<string, unknown>) {
    if (!estimateId) return;
    await api.patch(`/estimates/${estimateId}`, patch);
    load();
  }

  async function handleRebuild() {
    if (!confirm("Rebuild the lines from the fee schedule? Any edits to the lines will be lost.")) return;
    setBusy(true);
    try {
      const res = await api.post<{ lines: EstimateLine[]; totals: EstimateTotals }>(`/estimates/${estimateId}/rebuild`, {});
      setLines(res.lines);
      setTotals(res.totals);
      toast("Lines rebuilt from the fee schedule.");
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not rebuild.");
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    const method = prompt("How did the client approve? (Phone, Email, In person, Signed)", "Phone");
    if (!method) return;
    setBusy(true);
    try {
      await api.post(`/estimates/${estimateId}/approve`, { method });
      toast("Estimate approved.");
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not approve.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConvert() {
    if (!confirm("Create the client, invoice and setup tasks from this estimate?")) return;
    setBusy(true);
    try {
      const res = await api.post<{ clientId: string }>(`/estimates/${estimateId}/convert`, {});
      toast("Client created from this estimate.");
      navigate(`/clients/${res.clientId}`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not convert this estimate.");
    } finally {
      setBusy(false);
    }
  }

  // The PDF/send routes read the SAVED lines, so an unsaved edit would print or
  // email a stale version — save first rather than let that happen silently.
  async function ensureSaved() {
    if (dirty) await saveLines();
  }

  async function handleView() {
    if (!estimateId) return;
    // The blank tab has to open on THIS line — the very first thing the handler
    // does, before any await — or Safari/Chrome no longer count it as tied to
    // the click and silently block it as a popup. ensureSaved() below awaits a
    // network save when the lines are dirty, so viewFile's own all-in-one
    // window.open()-then-fetch can't be used here; opening the tab first and
    // filling it in once the (possibly two-step) fetch resolves preserves the
    // same guarantee.
    const win = window.open("", "_blank");
    setViewing(true);
    try {
      await ensureSaved();
      const blob = await fetchAuthedBlob(`/estimates/${estimateId}/print`);
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
      else window.open(url, "_blank");
    } catch (err) {
      win?.close();
      alert(err instanceof ApiError ? err.message : "Could not generate the PDF.");
    } finally {
      setViewing(false);
    }
  }

  async function handleDownload() {
    if (!estimateId) return;
    setPrinting(true);
    try {
      await ensureSaved();
      await downloadFile(`/estimates/${estimateId}/print`, `Estimate_${estimate?.estimate_number || estimateId}.pdf`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate the PDF.");
    } finally {
      setPrinting(false);
    }
  }

  async function handleOpenSend() {
    await ensureSaved();
    setSendOpen(true);
  }

  function handleLineAdded(newLines: EstimateLine[]) {
    setLines((prev) => [...prev, ...newLines]);
    setDirty(true);
    setAddLineOpen(false);
  }

  if (error) return <ErrorBanner error={error} />;
  if (!estimate || !totals) return <div className="spinner-wrap">Loading…</div>;

  const locked = Boolean(estimate.client_id);

  return (
    <div>
      <BackLink fallback="/estimates" fallbackLabel="All estimates" />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, margin: "8px 0 20px" }}>
        <div>
          <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>{estimate.business_name}</h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <StatusBadge status={estimate.status} />
            <span className="muted">{estimate.estimate_number}</span>
            {estimate.client_id && (
              <a className="muted" href={`/clients/${estimate.client_id}`}>→ Client record</a>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {dirty && <button className="btn btn-primary" disabled={saving} onClick={() => saveLines()}>{saving ? "Saving…" : "Save Changes"}</button>}
          <button className="btn" disabled={viewing} onClick={handleView}>{viewing ? "Generating…" : "Preview PDF"}</button>
          <button className="btn" disabled={printing} onClick={handleDownload}>{printing ? "Generating…" : "Download PDF"}</button>
          <button className="btn" onClick={handleOpenSend}>Send to Client</button>
          {!locked && <button className="btn" disabled={busy} onClick={handleRebuild}>Rebuild from Fee Schedule</button>}
          {estimate.status !== "Approved" && <button className="btn" disabled={busy} onClick={handleApprove}>Mark Approved</button>}
          {estimate.status === "Approved" && !estimate.client_id && (
            <button className="btn btn-primary" disabled={busy} onClick={handleConvert}>Convert to Client</button>
          )}
        </div>
      </div>

      {sendOpen && (
        <SendEstimateModal
          estimate={estimate}
          totals={totals}
          onClose={() => setSendOpen(false)}
          onSent={load}
        />
      )}

      {estimate.approved_at && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--teal)" }}>
          Approved {new Date(estimate.approved_at).toLocaleDateString()} by {estimate.approved_by}
          {estimate.approval_method ? ` — ${estimate.approval_method}` : ""}.
          {estimate.client_id && ` Converted to client ${estimate.client_id}.`}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Estimate Lines</h2>
          {!locked && <button className="btn btn-sm" onClick={() => setAddLineOpen(true)}>Add Line</button>}
        </div>

        {addLineOpen && (
          <AddEstimateLineModal
            jurisdiction={estimate.jurisdiction}
            onClose={() => setAddLineOpen(false)}
            onAdd={handleLineAdded}
          />
        )}

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Type</th>
                <th style={{ width: 70 }}>Qty</th>
                <th style={{ width: 110, textAlign: "right" }}>Our Cost</th>
                <th style={{ width: 110, textAlign: "right" }}>Client Price</th>
                <th style={{ width: 120 }}>Paid By</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                {!locked && <th></th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const isPercent = line.amount_kind === "percent";
                const amount = line.included ? 0 : isPercent
                  ? Math.round(totals.governmentTotal * ((line.percent_rate || 0) / 100) * 100) / 100
                  : Math.round(line.qty * line.unit_price * 100) / 100;
                return (
                  <tr key={line.line_id || `new-${i}`} data-row-id={line.line_id}>
                    <td data-label="Description">
                      {locked ? line.description : (
                        <input value={line.description} style={{ width: "100%", minWidth: 180 }}
                          onChange={(e) => patchLine(i, { description: e.target.value })} />
                      )}
                      {line.agency && <div className="cell-sub">{line.agency}</div>}
                    </td>
                    <td data-label="Type">
                      {locked ? line.category : (
                        <select value={line.category} onChange={(e) => patchLine(i, { category: e.target.value as "Government" | "Service" })}>
                          <option value="Government">Government</option>
                          <option value="Service">AL TAX</option>
                        </select>
                      )}
                    </td>
                    <td data-label="Qty">
                      {isPercent ? <span className="muted">{line.percent_rate}%</span> : locked ? line.qty : (
                        <input type="number" step="1" min="0" value={line.qty} style={{ width: 60 }}
                          onChange={(e) => patchLine(i, { qty: Number(e.target.value) })} />
                      )}
                    </td>
                    <td data-label="Our Cost" style={{ textAlign: "right" }}>
                      {isPercent || line.included ? <span className="muted">—</span> : locked ? money(line.unit_cost) : (
                        <input type="number" step="0.01" value={line.unit_cost} style={{ width: 95, textAlign: "right" }}
                          onChange={(e) => patchLine(i, { unit_cost: Number(e.target.value) })} />
                      )}
                    </td>
                    <td data-label="Client Price" style={{ textAlign: "right" }}>
                      {isPercent || line.included ? <span className="muted">{line.included ? "Included" : "—"}</span> : locked ? money(line.unit_price) : (
                        <input type="number" step="0.01" value={line.unit_price} style={{ width: 95, textAlign: "right" }}
                          onChange={(e) => patchLine(i, { unit_price: Number(e.target.value) })} />
                      )}
                    </td>
                    <td data-label="Paid By">
                      {line.category === "Service" ? <span className="muted">—</span> : locked ? line.payer : (
                        <select value={line.payer || "Firm"} onChange={(e) => patchLine(i, { payer: e.target.value as "Firm" | "Client" })}>
                          <option value="Firm">We collect</option>
                          <option value="Client">Client pays agency</option>
                        </select>
                      )}
                    </td>
                    <td data-label="Amount" style={{ textAlign: "right", fontWeight: 600 }}>
                      {line.included ? <span className="muted">Included</span>
                        : line.payer === "Client" ? <span className="muted">{money(amount)} direct</span>
                        : money(amount)}
                    </td>
                    {!locked && (
                      <td style={{ textAlign: "right" }}>
                        <button className="link-button" style={{ color: "var(--danger, #cf222e)" }}
                          onClick={() => { setLines((p) => p.filter((_, j) => j !== i)); setDirty(true); }}>
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        <div className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Totals</h2>
          <Row label="AL TAX service fees" value={money(totals.serviceTotal)} />
          <Row label="Government / agency fees" value={money(totals.governmentTotal)} />
          {totals.clientDirectTotal > 0 && (
            <Row label="Client pays agencies directly" value={money(totals.clientDirectTotal)} muted />
          )}
          <Row label="Subtotal" value={money(totals.subtotal)} bold />
          <Row label="Discount" value={`− ${money(totals.discount)}`} />
          {totals.taxRate > 0 && <Row label={`Tax (${totals.taxRate}%)`} value={money(totals.tax)} />}
          <Row label="Total" value={money(totals.total)} bold />
          <Row label="Deposit received" value={`− ${money(totals.deposit)}`} />
          <Row label="Balance due" value={money(totals.balanceDue)} bold />
        </div>

        <div className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Firm View</h2>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Not shown to the client.</p>
          <Row label="Charged for agency fees" value={money(totals.governmentTotal)} />
          <Row label="What those fees cost us" value={money(totals.agencyCost)} />
          <Row label="Margin on pass-throughs" value={money(totals.passThroughMargin)} bold />
          <Row label="Real revenue on this job" value={money(totals.serviceTotal + totals.passThroughMargin)} bold />
          {totals.unremitted > 0 && (
            <p style={{ fontSize: 12, marginTop: 10, color: "var(--danger, #cf222e)" }}>
              {money(totals.unremitted)} collected for agencies is not yet marked as paid.
            </p>
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Job &amp; Client</h2>
          <Row label="Entity" value={estimate.entity_type || "—"} />
          <Row label="Business type" value={estimate.business_type || "—"} />
          <Row label="Jurisdiction" value={estimate.jurisdiction || "—"} />
          <Row label="Filing speed" value={estimate.speed} />
          <Row label="Contact" value={estimate.contact_name || "—"} />
          <Row label="Email" value={estimate.email || "—"} />
          <Row label="Phone" value={estimate.phone || "—"} />
          <Row label="Valid until" value={estimate.valid_until || "—"} />
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="est-deposit">Deposit received</label>
            <input id="est-deposit" type="number" step="0.01" defaultValue={estimate.deposit_amount}
              onBlur={(e) => patchEstimate({ depositAmount: Number(e.target.value) })} disabled={locked} />
          </div>
          <div className="field">
            <label htmlFor="est-discount">Discount</label>
            <input id="est-discount" type="number" step="0.01" defaultValue={estimate.discount_amount}
              onBlur={(e) => patchEstimate({ discountAmount: Number(e.target.value) })} disabled={locked} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", gap: 16, padding: "7px 0",
      borderBottom: "1px solid var(--line)", fontWeight: bold ? 700 : 400,
      color: muted ? "var(--muted)" : undefined,
    }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
