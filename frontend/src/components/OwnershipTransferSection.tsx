import { useEffect, useState, type FormEvent } from "react";
import { api, downloadFile, buildFilename } from "../api/client";
import { useToast } from "./Toast";
import { fmtDateOnly } from "../utils/date";
import { US_STATES } from "../utils/clientOptions";

interface OwnershipTransfer {
  transfer_id: string;
  seller_name: string;
  seller_title: string | null;
  buyer_name: string;
  buyer_title: string | null;
  buyer_ssn: string | null;
  effective_date: string | null;
  sale_price: number | null;
  gov_form_8822b_filing_id: string | null;
  gov_form_cra_filing_id: string | null;
  md_amendment_task_id: string | null;
  created_at: string;
}

const EMPTY_FORM = {
  sellerName: "", sellerTitle: "",
  buyerName: "", buyerTitle: "", buyerSsn: "", buyerEmail: "", buyerPhone: "",
  buyerStreetAddress: "", buyerCity: "", buyerState: "", buyerZipCode: "",
  effectiveDate: "", salePrice: "",
  assetsIncluded: "", liabilitiesIncluded: "", additionalTerms: "",
};

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
  const toast = useToast();
  const [transfers, setTransfers] = useState<OwnershipTransfer[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ created: Record<string, boolean>; skippedReasons: string[] } | null>(null);

  function load() {
    api.get<{ transfers: OwnershipTransfer[] }>(`/clients/${clientId}/ownership-transfers`)
      .then((res) => setTransfers(res.transfers))
      .catch(() => setTransfers([]));
  }
  useEffect(load, [clientId]);

  function openForm() {
    setForm({ ...EMPTY_FORM, sellerName: sellerNameDefault || "", sellerTitle: sellerTitleDefault || "" });
    setSaveError(null);
    setLastResult(null);
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.sellerName.trim() || !form.buyerName.trim()) {
      setSaveError("Seller name and buyer name are required.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.post<{ transferId: string; created: Record<string, boolean>; skippedReasons: string[] }>(
        `/clients/${clientId}/ownership-transfers`, form
      );
      setLastResult({ created: res.created, skippedReasons: res.skippedReasons });
      toast("Ownership transfer package created.");
      load();
    } catch (err: any) {
      setSaveError(err?.message || "Could not create the transfer package.");
    } finally {
      setSaving(false);
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
        Capture the buyer/seller and sale terms once — this generates a Bill of Sale below, drafts a Form 8822-B and
        Maryland CRA update naming the buyer as the new responsible party (both appear in Government Forms), and
        creates a task to file the MD Amendment with SDAT by hand.
      </p>

      {showForm && (
        <form onSubmit={handleSubmit} style={{ marginBottom: 16, border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
          {saveError && <div className="error-banner" role="alert" style={{ marginBottom: 10 }}>{saveError}</div>}
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
            <div className="field"><label htmlFor="xfer-price">Sale Price</label><input id="xfer-price" type="number" step="0.01" min="0" value={form.salePrice} onChange={(e) => setForm((f) => ({ ...f, salePrice: e.target.value }))} /></div>
          </div>
          <div className="field"><label htmlFor="xfer-assets">Assets Included</label><textarea id="xfer-assets" rows={2} value={form.assetsIncluded} onChange={(e) => setForm((f) => ({ ...f, assetsIncluded: e.target.value }))} placeholder="e.g. Equipment, inventory, goodwill, business name" /></div>
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
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Creating…" : "Create Transfer Package"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
          </div>
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
                    <button className="btn-secondary" onClick={() => handleDownloadBillOfSale(t)}>PDF</button>
                    <button className="btn-secondary" onClick={() => handleDownloadBillOfSaleDocx(t)}>Word (.docx)</button>
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
