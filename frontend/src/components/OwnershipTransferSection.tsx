import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, downloadFile, buildFilename } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "./Toast";
import { useConfirm, useNotify } from "./ConfirmProvider";
import { fmtDateOnly } from "../utils/date";
import { US_STATES, ASSET_ALLOCATION_CATEGORIES } from "../utils/clientOptions";

interface AssetAllocationLine {
  category: string;
  description: string | null;
  amount: number;
}

interface OwnershipTransfer {
  transfer_id: string;
  seller_name: string;
  seller_title: string | null;
  buyer_name: string;
  buyer_title: string | null;
  buyer_ssn: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  buyer_street_address: string | null;
  buyer_city: string | null;
  buyer_state: string | null;
  buyer_zip_code: string | null;
  effective_date: string | null;
  sale_price: number | null;
  assets_included: string | null;
  asset_allocations: AssetAllocationLine[] | null;
  liabilities_included: string | null;
  additional_terms: string | null;
  include_bill_of_sale: boolean;
  gov_form_8822b_filing_id: string | null;
  gov_form_cra_filing_id: string | null;
  md_amendment_task_id: string | null;
  created_at: string;
}

/** Row shape while being edited in the form — amount stays a string so the input can be empty mid-typing, parsed to a number only on submit. */
interface AllocationRow {
  category: string;
  description: string;
  amount: string;
}

const EMPTY_FORM = {
  sellerName: "", sellerTitle: "",
  buyerName: "", buyerTitle: "", buyerSsn: "", buyerEmail: "", buyerPhone: "",
  buyerStreetAddress: "", buyerCity: "", buyerState: "", buyerZipCode: "",
  effectiveDate: "", salePrice: "",
  assetsIncluded: "", liabilitiesIncluded: "", additionalTerms: "",
  includeBillOfSale: true, include8822b: true, includeCra: true, includeMdAmendmentTask: true,
  assetAllocations: [] as AllocationRow[],
};

function allocationTotal(rows: AllocationRow[]): number {
  return Math.round(rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0) * 100) / 100;
}
function fmtMoney(v: number): string {
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * "Ownership Transfer" package — a single intake (old owner -> new owner,
 * effective date, sale terms) that, on submit, generates a Bill of Sale, a
 * pre-filled Form 8822-B and Maryland CRA update naming the buyer as the new
 * responsible party, and a task to file the MD Amendment with SDAT by hand
 * (that form isn't auto-generated yet — see ownershipTransfer.routes.ts).
 * The 8822-B/CRA drafts intentionally show up in the Government Forms
 * section below, not here — this component only owns the transfer intake
 * and the Bill of Sale, since the other two already have a home.
 */
export function OwnershipTransferSection({ clientId, clientName, sellerNameDefault, sellerTitleDefault }: {
  clientId: string; clientName: string; sellerNameDefault?: string; sellerTitleDefault?: string;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const toast = useToast();
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const [transfers, setTransfers] = useState<OwnershipTransfer[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingTransfer, setEditingTransfer] = useState<OwnershipTransfer | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ created: Record<string, boolean>; skippedReasons: string[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    api.get<{ transfers: OwnershipTransfer[] }>(`/clients/${clientId}/ownership-transfers`)
      .then((res) => setTransfers(res.transfers))
      .catch(() => setTransfers([]));
  }
  useEffect(load, [clientId]);

  function openForm() {
    setEditingTransfer(null);
    setForm({ ...EMPTY_FORM, sellerName: sellerNameDefault || "", sellerTitle: sellerTitleDefault || "" });
    setSaveError(null);
    setLastResult(null);
    setShowForm(true);
  }

  function openEditForm(t: OwnershipTransfer) {
    setEditingTransfer(t);
    setForm({
      sellerName: t.seller_name || "", sellerTitle: t.seller_title || "",
      buyerName: t.buyer_name || "", buyerTitle: t.buyer_title || "", buyerSsn: t.buyer_ssn || "",
      buyerEmail: t.buyer_email || "", buyerPhone: t.buyer_phone || "",
      buyerStreetAddress: t.buyer_street_address || "", buyerCity: t.buyer_city || "",
      buyerState: t.buyer_state || "", buyerZipCode: t.buyer_zip_code || "",
      effectiveDate: t.effective_date ? t.effective_date.slice(0, 10) : "", salePrice: t.sale_price !== null ? String(t.sale_price) : "",
      assetsIncluded: t.assets_included || "", liabilitiesIncluded: t.liabilities_included || "", additionalTerms: t.additional_terms || "",
      includeBillOfSale: t.include_bill_of_sale, include8822b: true, includeCra: true, includeMdAmendmentTask: true,
      assetAllocations: (t.asset_allocations || []).map((a) => ({ category: a.category, description: a.description || "", amount: String(a.amount) })),
    });
    setSaveError(null);
    setLastResult(null);
    setShowForm(true);
  }

  function addAllocationRow() {
    setForm((f) => ({ ...f, assetAllocations: [...f.assetAllocations, { category: ASSET_ALLOCATION_CATEGORIES[0], description: "", amount: "" }] }));
  }
  function updateAllocationRow(index: number, patch: Partial<AllocationRow>) {
    setForm((f) => ({ ...f, assetAllocations: f.assetAllocations.map((r, i) => (i === index ? { ...r, ...patch } : r)) }));
  }
  function removeAllocationRow(index: number) {
    setForm((f) => ({ ...f, assetAllocations: f.assetAllocations.filter((_, i) => i !== index) }));
  }

  const allocRows = form.assetAllocations.filter((r) => r.category.trim());
  const allocTotal = allocationTotal(allocRows);
  const allDocsSelected = form.includeBillOfSale && form.include8822b && form.includeCra && form.includeMdAmendmentTask;
  function toggleAllDocs() {
    const next = !allDocsSelected;
    setForm((f) => ({ ...f, includeBillOfSale: next, include8822b: next, includeCra: next, includeMdAmendmentTask: next }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.sellerName.trim() || !form.buyerName.trim()) {
      setSaveError("Seller name and buyer name are required.");
      return;
    }
    for (const r of allocRows) {
      if (!(Number(r.amount) > 0)) {
        setSaveError(`Enter a positive amount for the "${r.category}" allocation line, or remove it.`);
        return;
      }
    }
    setSaving(true);
    setSaveError(null);
    const payload = {
      ...form,
      assetAllocations: allocRows.map((r) => ({ category: r.category, description: r.description || null, amount: Number(r.amount) })),
    };
    try {
      if (editingTransfer) {
        await api.patch(`/clients/${clientId}/ownership-transfers/${editingTransfer.transfer_id}`, payload);
        toast("Ownership transfer updated.");
        setShowForm(false);
      } else {
        const res = await api.post<{ transferId: string; created: Record<string, boolean>; skippedReasons: string[] }>(
          `/clients/${clientId}/ownership-transfers`, payload
        );
        setLastResult({ created: res.created, skippedReasons: res.skippedReasons });
        toast("Ownership transfer package created.");
      }
      load();
    } catch (err: any) {
      setSaveError(err?.message || "Could not save the transfer.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(t: OwnershipTransfer) {
    const ok = await confirmDialog({
      title: "Delete ownership transfer",
      message: `Delete the ${t.seller_name} → ${t.buyer_name} transfer? Any linked 8822-B/CRA drafts still in Draft and the MD Amendment task (if not yet started) will be removed too. This can't be undone.`,
      confirmLabel: "Delete", danger: true,
    });
    if (!ok) return;
    setBusyId(t.transfer_id);
    try {
      const res = await api.post<{ ok: boolean; left: string[] }>(`/clients/${clientId}/ownership-transfers/${t.transfer_id}/delete`, {});
      toast(res.left && res.left.length > 0 ? `Transfer deleted. ${res.left.join(" ")}` : "Transfer deleted.");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this transfer.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDownloadBillOfSale(t: OwnershipTransfer) {
    await downloadFile(
      `/clients/${clientId}/ownership-transfers/${t.transfer_id}/bill-of-sale.pdf`,
      buildFilename([clientName, "Bill of Sale", t.buyer_name], "pdf")
    );
  }

  async function handleDownloadBillOfSaleDocx(t: OwnershipTransfer) {
    await downloadFile(
      `/clients/${clientId}/ownership-transfers/${t.transfer_id}/bill-of-sale.docx`,
      buildFilename([clientName, "Bill of Sale", t.buyer_name], "docx")
    );
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Ownership Transfer</h2>
        {!showForm && <button className="btn-primary" onClick={openForm}>Start Ownership Transfer</button>}
      </div>
      <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 12.5 }}>
        Capture the buyer/seller and sale terms once — choose below which of the Bill of Sale, Form 8822-B, Maryland
        CRA update, and MD Amendment reminder task to generate. The 8822-B/CRA drafts appear in Government Forms.
      </p>

      {showForm && (
        <form onSubmit={handleSubmit} style={{ marginBottom: 16, border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
          {saveError && <div className="error-banner" role="alert" style={{ marginBottom: 10 }}>{saveError}</div>}

          <div className="form-section-title">Documents to Generate</div>
          {!editingTransfer ? (
            <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "8px 12px", marginBottom: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>
                <input type="checkbox" checked={allDocsSelected} onChange={toggleAllDocs} />
                All documents
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 4 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                  <input type="checkbox" checked={form.includeBillOfSale} onChange={(e) => setForm((f) => ({ ...f, includeBillOfSale: e.target.checked }))} />
                  Bill of Sale (PDF + Word)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                  <input type="checkbox" checked={form.include8822b} onChange={(e) => setForm((f) => ({ ...f, include8822b: e.target.checked }))} />
                  IRS Form 8822-B — Change of Responsible Party
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                  <input type="checkbox" checked={form.includeCra} onChange={(e) => setForm((f) => ({ ...f, includeCra: e.target.checked }))} />
                  Maryland CRA Update — Change of Entity
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                  <input type="checkbox" checked={form.includeMdAmendmentTask} onChange={(e) => setForm((f) => ({ ...f, includeMdAmendmentTask: e.target.checked }))} />
                  MD Amendment reminder task (SDAT)
                </label>
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={form.includeBillOfSale} onChange={(e) => setForm((f) => ({ ...f, includeBillOfSale: e.target.checked }))} />
                Bill of Sale (show its download buttons below)
              </label>
              <p className="muted" style={{ fontSize: 11.5, margin: "4px 0 0" }}>
                8822-B / CRA / MD Amendment task were already decided when this package was created — edit those directly in Government Forms/Tasks if needed.
              </p>
            </div>
          )}

          <div className="form-section-title">Seller (current owner)</div>
          <div className="form-grid-3">
            <div className="field"><label htmlFor="xfer-seller-name">Seller Name</label><input id="xfer-seller-name" required value={form.sellerName} onChange={(e) => setForm((f) => ({ ...f, sellerName: e.target.value }))} /></div>
            <div className="field"><label htmlFor="xfer-seller-title">Seller Title</label><input id="xfer-seller-title" value={form.sellerTitle} onChange={(e) => setForm((f) => ({ ...f, sellerTitle: e.target.value }))} /></div>
          </div>

          <div className="form-section-title">Buyer (new owner)</div>
          <div className="form-grid-3">
            <div className="field"><label htmlFor="xfer-buyer-name">Buyer Name</label><input id="xfer-buyer-name" required value={form.buyerName} onChange={(e) => setForm((f) => ({ ...f, buyerName: e.target.value }))} /></div>
            <div className="field"><label htmlFor="xfer-buyer-title">Buyer Title</label><input id="xfer-buyer-title" value={form.buyerTitle} onChange={(e) => setForm((f) => ({ ...f, buyerTitle: e.target.value }))} placeholder="e.g. Member, President" /></div>
            <div className="field"><label htmlFor="xfer-buyer-ssn">Buyer SSN <span className="muted">(for 8822-B/CRA)</span></label><input id="xfer-buyer-ssn" value={form.buyerSsn} onChange={(e) => setForm((f) => ({ ...f, buyerSsn: e.target.value }))} /></div>
            <div className="field"><label htmlFor="xfer-buyer-email">Buyer Email</label><input id="xfer-buyer-email" type="email" value={form.buyerEmail} onChange={(e) => setForm((f) => ({ ...f, buyerEmail: e.target.value }))} /></div>
            <div className="field"><label htmlFor="xfer-buyer-phone">Buyer Phone</label><input id="xfer-buyer-phone" value={form.buyerPhone} onChange={(e) => setForm((f) => ({ ...f, buyerPhone: e.target.value }))} /></div>
          </div>
          <div className="form-grid-3">
            <div className="field"><label htmlFor="xfer-buyer-street">Buyer Street Address</label><input id="xfer-buyer-street" value={form.buyerStreetAddress} onChange={(e) => setForm((f) => ({ ...f, buyerStreetAddress: e.target.value }))} /></div>
            <div className="field"><label htmlFor="xfer-buyer-city">City</label><input id="xfer-buyer-city" value={form.buyerCity} onChange={(e) => setForm((f) => ({ ...f, buyerCity: e.target.value }))} /></div>
            <div className="field">
              <label htmlFor="xfer-buyer-state">State</label>
              <select id="xfer-buyer-state" value={form.buyerState} onChange={(e) => setForm((f) => ({ ...f, buyerState: e.target.value }))}>
                <option value="">Select…</option>
                {US_STATES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="xfer-buyer-zip">ZIP</label><input id="xfer-buyer-zip" value={form.buyerZipCode} onChange={(e) => setForm((f) => ({ ...f, buyerZipCode: e.target.value }))} /></div>
          </div>

          <div className="form-section-title">Sale Terms</div>
          <div className="form-grid-3">
            <div className="field"><label htmlFor="xfer-effective">Effective Date</label><input id="xfer-effective" type="date" value={form.effectiveDate} onChange={(e) => setForm((f) => ({ ...f, effectiveDate: e.target.value }))} /></div>
            <div className="field">
              <label htmlFor="xfer-price">Sale Price</label>
              {allocRows.length > 0 ? (
                <input id="xfer-price" value={fmtMoney(allocTotal)} disabled title="Computed from the asset allocation below" />
              ) : (
                <input id="xfer-price" type="number" step="0.01" min="0" value={form.salePrice} onChange={(e) => setForm((f) => ({ ...f, salePrice: e.target.value }))} />
              )}
            </div>
          </div>

          <div className="form-section-title">Allocation of Purchase Price <span className="muted" style={{ fontWeight: 400 }}>(optional — itemize instead of one Sale Price above)</span></div>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 0, marginBottom: 8 }}>
            Each line gets its own category and price; the Sale Price above is then computed as their total, mirroring a real IRC §1060 / Form 8594 allocation schedule. Leave empty to use the plain "Assets Included" description below instead.
          </p>
          {form.assetAllocations.length > 0 && (
            <div className="table-wrap" style={{ marginBottom: 8 }}>
              <table>
                <thead><tr><th>Category</th><th>Description</th><th>Amount</th><th></th></tr></thead>
                <tbody>
                  {form.assetAllocations.map((row, i) => (
                    <tr key={i}>
                      <td>
                        <select value={row.category} onChange={(e) => updateAllocationRow(i, { category: e.target.value })} aria-label="Allocation category">
                          {ASSET_ALLOCATION_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                      </td>
                      <td>
                        <input
                          value={row.description} onChange={(e) => updateAllocationRow(i, { description: e.target.value })}
                          placeholder="Optional detail" aria-label="Allocation description"
                        />
                      </td>
                      <td style={{ width: 130 }}>
                        <input
                          type="number" step="0.01" min="0" value={row.amount}
                          onChange={(e) => updateAllocationRow(i, { amount: e.target.value })}
                          aria-label="Allocation amount"
                        />
                      </td>
                      <td>
                        <button type="button" className="btn-secondary" onClick={() => removeAllocationRow(i)} aria-label="Remove this allocation line">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <button type="button" className="btn-secondary" onClick={addAllocationRow}>+ Add Allocation Line</button>
            {allocRows.length > 0 && <strong style={{ fontSize: 13 }}>Total Allocated: {fmtMoney(allocTotal)}</strong>}
          </div>

          {allocRows.length === 0 && (
            <div className="field"><label htmlFor="xfer-assets">Assets Included</label><textarea id="xfer-assets" rows={2} value={form.assetsIncluded} onChange={(e) => setForm((f) => ({ ...f, assetsIncluded: e.target.value }))} placeholder="e.g. Equipment, inventory, goodwill, business name" /></div>
          )}
          <div className="field"><label htmlFor="xfer-liabilities">Liabilities Included</label><textarea id="xfer-liabilities" rows={2} value={form.liabilitiesIncluded} onChange={(e) => setForm((f) => ({ ...f, liabilitiesIncluded: e.target.value }))} placeholder="e.g. None; or specific debts/leases Buyer is assuming" /></div>
          <div className="field">
            <label htmlFor="xfer-terms">Additional Clause(s) / Information <span className="muted">(optional)</span></label>
            <textarea
              id="xfer-terms" rows={4} value={form.additionalTerms}
              onChange={(e) => setForm((f) => ({ ...f, additionalTerms: e.target.value }))}
              placeholder="Anything else the Bill of Sale should say — a non-compete clause, a payment schedule, an indemnification clause, contingencies, etc. Appears as its own numbered section in the PDF."
            />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : editingTransfer ? "Save Changes" : "Create Transfer Package"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => { setShowForm(false); setEditingTransfer(null); }} disabled={saving}>Cancel</button>
          </div>
          {editingTransfer && (
            <p className="muted" style={{ fontSize: 11.5, marginTop: 8, marginBottom: 0 }}>
              Saving updates the Bill of Sale on future downloads. Already-created 8822-B/CRA drafts have their own edit option under Government Forms.
            </p>
          )}
        </form>
      )}

      {lastResult && (
        <div className="alert-strip" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.5 }}>
            {lastResult.created.billOfSale && <div>✓ Bill of Sale ready to download below.</div>}
            {lastResult.created.form8822b && <div>✓ Form 8822-B drafted — see Government Forms.</div>}
            {lastResult.created.craUpdate && <div>✓ Maryland CRA update drafted — see Government Forms.</div>}
            {lastResult.created.mdAmendmentTask && <div>✓ Task created to file the MD Amendment with SDAT.</div>}
            {lastResult.skippedReasons.map((r, i) => <div key={i} style={{ color: "var(--danger, #b23)" }}>⚠ {r}</div>)}
          </div>
        </div>
      )}

      {transfers === null ? (
        <p className="muted">Loading…</p>
      ) : transfers.length === 0 ? (
        !showForm && <p className="muted">No ownership transfers on file for this client yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Seller</th><th>Buyer</th><th>Effective Date</th><th>Sale Price</th><th>Created</th><th></th></tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.transfer_id}>
                  <td>{t.seller_name}</td>
                  <td>{t.buyer_name}</td>
                  <td>{t.effective_date ? fmtDateOnly(t.effective_date) : "—"}</td>
                  <td>{t.sale_price != null ? `$${Number(t.sale_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}</td>
                  <td>{fmtDateOnly(t.created_at)}</td>
                  <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {t.include_bill_of_sale && (
                      <>
                        <button className="btn-secondary" onClick={() => handleDownloadBillOfSale(t)}>PDF</button>
                        <button className="btn-secondary" onClick={() => handleDownloadBillOfSaleDocx(t)}>Word (.docx)</button>
                      </>
                    )}
                    <button className="btn-secondary" onClick={() => openEditForm(t)} disabled={busyId === t.transfer_id}>Edit</button>
                    {isAdmin && (
                      <button className="btn-secondary" onClick={() => handleDelete(t)} disabled={busyId === t.transfer_id}>{busyId === t.transfer_id ? "Deleting…" : "Delete"}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
