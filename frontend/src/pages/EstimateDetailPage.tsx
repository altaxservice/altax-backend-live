import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError, downloadFile, printFile, fetchAuthedBlob, buildFilename } from "../api/client";
import { BackLink } from "../components/BackLink";
import { PrevNextNav } from "../components/PrevNextNav";
import { getAdjacentIds } from "../utils/listNav";
import { ErrorBanner } from "../components/ErrorBanner";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/Toast";
import { SendEstimateModal } from "../components/SendEstimateModal";
import { AddEstimateLineModal } from "../components/AddEstimateLineModal";
import { ENTITY_TYPES, BUSINESS_TYPES, SPEEDS, money, type Estimate, type EstimateLine, type EstimateTotals } from "../api/estimates";
import { useConfirm, usePrompt, useNotify } from "../components/ConfirmProvider";
import { fmtDateTime } from "../utils/date";

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
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();
  const notify = useNotify();
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [lines, setLines] = useState<EstimateLine[]>([]);
  const [totals, setTotals] = useState<EstimateTotals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [realPrinting, setRealPrinting] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [editingInfo, setEditingInfo] = useState(false);
  const [infoForm, setInfoForm] = useState<Record<string, string>>({});
  const [infoSaving, setInfoSaving] = useState(false);
  const [jurisdictions, setJurisdictions] = useState<string[]>([]);
  const [discountType, setDiscountType] = useState<"fixed" | "percent">("fixed");
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());

  function load() {
    if (!estimateId) return;
    api.get<{ estimate: Estimate; lines: EstimateLine[]; totals: EstimateTotals }>(`/estimates/${estimateId}`)
      .then((res) => {
        setEstimate(res.estimate); setLines(res.lines); setTotals(res.totals); setDirty(false);
        setDiscountType(Number(res.estimate.discount_percent) > 0 ? "percent" : "fixed");
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this estimate."));
  }
  useEffect(load, [estimateId]);
  useEffect(() => {
    api.get<{ jurisdictions: string[] }>("/estimates/fee-items")
      .then((res) => setJurisdictions(res.jurisdictions))
      .catch(() => {});
  }, []);

  function openEditInfo() {
    if (!estimate) return;
    setInfoForm({
      businessName: estimate.business_name || "",
      contactName: estimate.contact_name || "",
      email: estimate.email || "",
      phone: estimate.phone || "",
      street: estimate.street || "",
      city: estimate.city || "",
      state: estimate.state || "",
      zip: estimate.zip || "",
      entityType: estimate.entity_type || "",
      businessType: estimate.business_type || "",
      jurisdiction: estimate.jurisdiction || "",
      speed: estimate.speed || "Standard",
      // valid_until comes back as a full ISO timestamp; a date input only accepts
      // the YYYY-MM-DD portion and silently blanks itself on anything longer.
      validUntil: (estimate.valid_until || "").slice(0, 10),
    });
    setEditingInfo(true);
  }

  async function saveInfo() {
    if (!estimateId) return;
    if (!infoForm.businessName.trim()) { await notify("Business name is required."); return; }
    setInfoSaving(true);
    try {
      await api.patch(`/estimates/${estimateId}`, infoForm);
      setEditingInfo(false);
      load();
      toast("Client information updated.");
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not save this information.");
    } finally {
      setInfoSaving(false);
    }
  }

  function patchLine(index: number, patch: Partial<EstimateLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    setDirty(true);
  }

  // New (not-yet-saved) lines have no line_id yet, same fallback the row's
  // React `key` already uses — keeps selection stable across re-renders
  // without needing a persisted id for lines that don't have one yet.
  function lineKey(line: EstimateLine, i: number): string {
    return line.line_id || `new-${i}`;
  }
  function toggleLineSelected(key: string) {
    setSelectedLines((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function toggleSelectAllLines() {
    setSelectedLines((prev) => (prev.size === lines.length ? new Set() : new Set(lines.map(lineKey))));
  }
  function removeSelectedLines() {
    setLines((prev) => prev.filter((line, i) => !selectedLines.has(lineKey(line, i))));
    setSelectedLines(new Set());
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
      await notify(err instanceof ApiError ? err.message : "Could not save these lines.");
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
    const ok = await confirmDialog({ title: "Rebuild lines", message: "Any edits to the lines will be lost.", confirmLabel: "Rebuild", danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.post<{ lines: EstimateLine[]; totals: EstimateTotals }>(`/estimates/${estimateId}/rebuild`, {});
      setLines(res.lines);
      setTotals(res.totals);
      toast("Lines rebuilt from the fee schedule.");
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not rebuild.");
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    const method = await promptFor({ title: "Approve estimate", message: "How did the client approve? (Phone, Email, In person, Signed)", defaultValue: "Phone" });
    if (!method) return;
    setBusy(true);
    try {
      await api.post(`/estimates/${estimateId}/approve`, { method });
      toast("Estimate approved.");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not approve.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConvert() {
    const ok = await confirmDialog({ title: "Convert estimate", message: "Create the client, invoice and setup tasks from this estimate?" });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.post<{ clientId: string }>(`/estimates/${estimateId}/convert`, {});
      toast("Client created from this estimate.");
      navigate(`/clients/${res.clientId}`);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not convert this estimate.");
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
      await notify(err instanceof ApiError ? err.message : "Could not generate the PDF.");
    } finally {
      setViewing(false);
    }
  }

  async function handleDownload() {
    if (!estimateId) return;
    setPrinting(true);
    try {
      await ensureSaved();
      await downloadFile(`/estimates/${estimateId}/print`, buildFilename([estimate?.business_name, "Estimate", estimate?.estimate_number], "pdf"));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not generate the PDF.");
    } finally {
      setPrinting(false);
    }
  }

  async function handlePrint() {
    if (!estimateId) return;
    setRealPrinting(true);
    try {
      await ensureSaved();
      await printFile(`/estimates/${estimateId}/print`);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not print the PDF.");
    } finally {
      setRealPrinting(false);
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
      <div style={{ display: "flex", alignItems: "center" }}>
        <BackLink fallback="/estimates" fallbackLabel="All estimates" />
        <PrevNextNav basePath="/estimates" {...getAdjacentIds("estimates", estimateId)} />
      </div>

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
          <button className="btn" disabled={realPrinting} onClick={handlePrint}>{realPrinting ? "Printing…" : "Print PDF"}</button>
          <button className="btn" onClick={handleOpenSend}>Send to Client</button>
          <button className="btn btn-sm" onClick={() => navigate("/estimates")}>Close</button>
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
          Approved {fmtDateTime(estimate.approved_at)} by {estimate.approved_by}
          {estimate.approval_method ? ` — ${estimate.approval_method}` : ""}.
          {estimate.client_id && ` Converted to client ${estimate.client_id}.`}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Estimate Lines</h2>
          <div style={{ display: "flex", gap: 8 }}>
            {!locked && selectedLines.size > 0 && (
              <button className="btn btn-sm" style={{ color: "var(--red)" }} onClick={removeSelectedLines}>
                Remove Selected ({selectedLines.size})
              </button>
            )}
            {!locked && <button className="btn btn-sm" onClick={() => setAddLineOpen(true)}>Add Line</button>}
          </div>
        </div>

        {addLineOpen && (
          <AddEstimateLineModal
            jurisdiction={estimate.jurisdiction}
            onClose={() => setAddLineOpen(false)}
            onAdd={handleLineAdded}
          />
        )}

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {!locked && (
                  <th scope="col" style={{ width: 32 }}>
                    <input type="checkbox" checked={lines.length > 0 && selectedLines.size === lines.length} onChange={toggleSelectAllLines} />
                  </th>
                )}
                <th scope="col">Description</th>
                <th scope="col">Type</th>
                <th scope="col" style={{ width: 70 }}>Qty</th>
                <th scope="col" style={{ width: 110, textAlign: "right" }}>Our Cost</th>
                <th scope="col" style={{ width: 110, textAlign: "right" }}>Client Price</th>
                <th scope="col" style={{ width: 120 }}>Paid By</th>
                <th scope="col" style={{ textAlign: "right" }}>Amount</th>
                {!locked && <th scope="col"></th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const isPercent = line.amount_kind === "percent";
                const amount = line.included ? 0 : isPercent
                  ? Math.round(totals.governmentTotal * ((line.percent_rate || 0) / 100) * 100) / 100
                  : Math.round(line.qty * line.unit_price * 100) / 100;
                const key = lineKey(line, i);
                return (
                  <tr key={key} data-row-id={line.line_id}>
                    {!locked && (
                      <td>
                        <input type="checkbox" checked={selectedLines.has(key)} onChange={() => toggleLineSelected(key)} />
                      </td>
                    )}
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
                        <button className="link-button" style={{ color: "var(--red)" }}
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
          {totals.discount > 0 && (
            <Row label={totals.discountPercent > 0 ? `Discount (${totals.discountPercent}%)` : "Discount"} value={`− ${money(totals.discount)}`} />
          )}
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
            <p style={{ fontSize: 12, marginTop: 10, color: "var(--red)" }}>
              {money(totals.unremitted)} collected for agencies is not yet marked as paid.
            </p>
          )}
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 0, marginBottom: 10 }}>
            <h2 style={{ fontSize: 15, margin: 0 }}>Job &amp; Client</h2>
            {!locked && !editingInfo && <button className="btn btn-sm" onClick={openEditInfo}>Edit</button>}
          </div>

          {editingInfo ? (
            <div>
              <div className="field">
                <label htmlFor="ei-name">Business name</label>
                <input id="ei-name" value={infoForm.businessName} onChange={(e) => setInfoForm({ ...infoForm, businessName: e.target.value })} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label htmlFor="ei-contact">Contact name</label>
                  <input id="ei-contact" value={infoForm.contactName} onChange={(e) => setInfoForm({ ...infoForm, contactName: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="ei-phone">Phone</label>
                  <input id="ei-phone" value={infoForm.phone} onChange={(e) => setInfoForm({ ...infoForm, phone: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="ei-email">Email</label>
                <input id="ei-email" type="email" value={infoForm.email} onChange={(e) => setInfoForm({ ...infoForm, email: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="ei-street">Street</label>
                <input id="ei-street" value={infoForm.street} onChange={(e) => setInfoForm({ ...infoForm, street: e.target.value })} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label htmlFor="ei-city">City</label>
                  <input id="ei-city" value={infoForm.city} onChange={(e) => setInfoForm({ ...infoForm, city: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="ei-state">State</label>
                  <input id="ei-state" value={infoForm.state} onChange={(e) => setInfoForm({ ...infoForm, state: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="ei-zip">ZIP</label>
                  <input id="ei-zip" value={infoForm.zip} onChange={(e) => setInfoForm({ ...infoForm, zip: e.target.value })} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label htmlFor="ei-entity">Entity type</label>
                  <select id="ei-entity" value={infoForm.entityType} onChange={(e) => setInfoForm({ ...infoForm, entityType: e.target.value })}>
                    <option value="">—</option>
                    {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="ei-biz">Business type</label>
                  <select id="ei-biz" value={infoForm.businessType} onChange={(e) => setInfoForm({ ...infoForm, businessType: e.target.value })}>
                    <option value="">—</option>
                    {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="ei-jur">Jurisdiction</label>
                  <select id="ei-jur" value={infoForm.jurisdiction} onChange={(e) => setInfoForm({ ...infoForm, jurisdiction: e.target.value })}>
                    <option value="">—</option>
                    {jurisdictions.map((j) => <option key={j} value={j}>{j}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="ei-speed">Filing speed</label>
                  <select id="ei-speed" value={infoForm.speed} onChange={(e) => setInfoForm({ ...infoForm, speed: e.target.value })}>
                    {SPEEDS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="ei-valid">Valid until</label>
                <input id="ei-valid" type="date" value={infoForm.validUntil} onChange={(e) => setInfoForm({ ...infoForm, validUntil: e.target.value })} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                <button className="btn btn-sm" onClick={() => setEditingInfo(false)} disabled={infoSaving}>Cancel</button>
                <button className="btn btn-sm btn-primary" onClick={saveInfo} disabled={infoSaving}>{infoSaving ? "Saving…" : "Save"}</button>
              </div>
            </div>
          ) : (
            <>
              <Row label="Entity" value={estimate.entity_type || "—"} />
              <Row label="Business type" value={estimate.business_type || "—"} />
              <Row label="Jurisdiction" value={estimate.jurisdiction || "—"} />
              <Row label="Filing speed" value={estimate.speed} />
              <Row label="Contact" value={estimate.contact_name || "—"} />
              <Row label="Email" value={estimate.email || "—"} />
              <Row label="Phone" value={estimate.phone || "—"} />
              <Row label="Address" value={[estimate.street, [estimate.city, estimate.state, estimate.zip].filter(Boolean).join(", ")].filter(Boolean).join(", ") || "—"} />
              <Row label="Valid until" value={estimate.valid_until ? fmtDateTime(estimate.valid_until) : "—"} />
            </>
          )}

          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="est-deposit">Deposit received</label>
            <input id="est-deposit" type="number" step="0.01" defaultValue={estimate.deposit_amount}
              onBlur={(e) => patchEstimate({ depositAmount: Number(e.target.value) })} disabled={locked} />
          </div>
          <div className="field">
            <label htmlFor="est-discount">Discount</label>
            <div style={{ display: "flex", gap: 6 }}>
              <select
                id="est-discount-type" value={discountType} disabled={locked}
                style={{ maxWidth: 90 }}
                aria-label="Discount type"
                onChange={(e) => setDiscountType(e.target.value as "fixed" | "percent")}
              >
                <option value="fixed">$</option>
                <option value="percent">%</option>
              </select>
              {discountType === "percent" ? (
                <input
                  id="est-discount" type="number" step="0.01" min="0" max="100"
                  defaultValue={estimate.discount_percent} disabled={locked}
                  onBlur={(e) => patchEstimate({ discountPercent: Number(e.target.value), discountAmount: 0 })}
                />
              ) : (
                <input
                  id="est-discount" type="number" step="0.01" min="0"
                  defaultValue={estimate.discount_amount} disabled={locked}
                  onBlur={(e) => patchEstimate({ discountAmount: Number(e.target.value), discountPercent: 0 })}
                />
              )}
            </div>
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
