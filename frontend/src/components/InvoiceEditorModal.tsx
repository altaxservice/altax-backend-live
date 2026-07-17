import { useEffect, useMemo, useState } from "react";
import { api, ApiError, downloadFile, viewFile } from "../api/client";
import type { Client } from "../api/types";
import type { Invoice, ProductService } from "../api/types2";
import { AddRecurringModal } from "./AddRecurringModal";
import { useToast } from "./Toast";
import { AddressFields } from "./AddressFields";

const TERMS_OPTIONS = ["Due on receipt", "Net 15", "Net 30", "Net 60"];
const TERMS_DAYS: Record<string, number> = { "Due on receipt": 0, "Net 15": 15, "Net 30": 30, "Net 60": 60 };

interface Row {
  key: string; serviceDate: string; productId: string; productName: string; description: string;
  quantity: string; rate: string; taxable: boolean;
}

function newRow(): Row {
  return { key: Math.random().toString(36).slice(2), serviceDate: "", productId: "", productName: "", description: "", quantity: "1", rate: "", taxable: true };
}

function money(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00";
}

/**
 * QuickBooks-style line-item invoice editor, built at the user's explicit request as a
 * UI/UX upgrade over legacy's single-description/single-total invoice. Deliberately does
 * NOT include real online payment collection or email/SMS delivery (the "Review and
 * send" step in the QuickBooks reference screenshots) — no payment processor or
 * email/SMS provider is wired up anywhere in this app; invoices are still generated as
 * PDFs, matching how the rest of the app already works. Shared by both InvoicesListPage
 * (create) and InvoiceDetailPage (edit) via the `editing` prop.
 */
export function InvoiceEditorModal({ clients, editing, initialClientId, onClose, onDone }: {
  clients: Client[]; editing?: Invoice; initialClientId?: string; onClose: () => void; onDone: (invoiceId: string) => void;
}) {
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = Boolean(editing);

  const [products, setProducts] = useState<ProductService[]>([]);
  const [showQuickAdd, setShowQuickAdd] = useState<string | null>(null); // row key currently adding a new product
  const [quickAddForm, setQuickAddForm] = useState({ name: "", rate: "", taxable: true });

  const [clientId, setClientId] = useState(editing?.client_id || initialClientId || "");
  const [invoiceDate, setInvoiceDate] = useState(editing?.invoice_date ? editing.invoice_date.slice(0, 10) : today);
  const [terms, setTerms] = useState(String(editing?.terms || "Due on receipt"));
  const [dueDate, setDueDate] = useState(editing?.due_date ? editing.due_date.slice(0, 10) : today);
  const [customerType, setCustomerType] = useState(String(editing?.customer_type || ""));
  const [billTo, setBillTo] = useState(String(editing?.bill_to || ""));
  const [sameAsBillTo, setSameAsBillTo] = useState(!editing?.ship_to || editing.ship_to === editing.bill_to);
  const [shipTo, setShipTo] = useState(String(editing?.ship_to || ""));
  const [shipToStreet, setShipToStreet] = useState(String(editing?.ship_to_street || ""));
  const [shipToCity, setShipToCity] = useState(String(editing?.ship_to_city || ""));
  const [shipToState, setShipToState] = useState(String(editing?.ship_to_state || ""));
  const [shipToZip, setShipToZip] = useState(String(editing?.ship_to_zip || ""));
  const [shipFrom, setShipFrom] = useState(String(editing?.ship_from || ""));
  const [shipVia, setShipVia] = useState(String(editing?.ship_via || ""));
  const [shippingDate, setShippingDate] = useState(editing?.shipping_date ? editing.shipping_date.slice(0, 10) : "");
  const [trackingNumber, setTrackingNumber] = useState(String(editing?.tracking_number || ""));
  const [status, setStatus] = useState(String(editing?.status || "Unpaid"));
  const [showRecurring, setShowRecurring] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [rows, setRows] = useState<Row[]>(() => {
    if (editing?.lineItems?.length) {
      return editing.lineItems.map((li) => ({
        key: li.line_item_id, serviceDate: li.service_date ? String(li.service_date).slice(0, 10) : "",
        productId: li.product_id || "", productName: li.product_name || "", description: li.description || "",
        quantity: String(li.quantity ?? 1), rate: String(li.rate ?? ""), taxable: li.taxable !== false,
      }));
    }
    return [newRow()];
  });

  const [paymentInstructions, setPaymentInstructions] = useState(String(editing?.payment_instructions || ""));
  const [clientNote, setClientNote] = useState(String(editing?.client_note || "We appreciate your business and look forward to helping you again soon."));
  const [internalNote, setInternalNote] = useState(String(editing?.internal_note || ""));

  const [discountMode, setDiscountMode] = useState<"percent" | "amount">(editing?.discount_amount ? "amount" : "percent");
  const [discountPercent, setDiscountPercent] = useState(editing?.discount_percent ? String(editing.discount_percent) : "0");
  const [discountAmountInput, setDiscountAmountInput] = useState(editing?.discount_amount ? String(editing.discount_amount) : "0");
  const [taxMode, setTaxMode] = useState<"auto" | "manual" | "none">(editing?.sales_tax_rate ? "manual" : "auto");
  const [manualTaxRate, setManualTaxRate] = useState(editing?.sales_tax_rate ? String(editing.sales_tax_rate) : "0");
  const [shippingAmount, setShippingAmount] = useState(editing?.shipping_amount ? String(editing.shipping_amount) : "0");
  const [depositAmount, setDepositAmount] = useState(editing?.deposit_amount ? String(editing.deposit_amount) : "0");
  const [amountPaid, setAmountPaid] = useState(String(editing?.amount_paid ?? "0"));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ products: ProductService[] }>("/products").then((r) => setProducts(r.products.filter((p) => p.active))).catch(() => {});
  }, []);

  const selectedClient = clients.find((c) => c.client_id === clientId);
  useEffect(() => {
    if (!isEdit && selectedClient) {
      if (!billTo) setBillTo(String(selectedClient.address || ""));
      if (!customerType) setCustomerType(String(selectedClient.client_type || ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (sameAsBillTo) setShipTo(billTo);
  }, [billTo, sameAsBillTo]);

  function handleTermsChange(t: string) {
    setTerms(t);
    const days = TERMS_DAYS[t] ?? 0;
    const base = invoiceDate ? new Date(invoiceDate) : new Date();
    base.setDate(base.getDate() + days);
    setDueDate(base.toISOString().slice(0, 10));
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, newRow()]);
  }
  function removeRow(key: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }
  function moveRow(key: string, direction: -1 | 1) {
    setRows((prev) => {
      const i = prev.findIndex((r) => r.key === key);
      const j = i + direction;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function clearAllLines() {
    setRows([newRow()]);
  }
  function selectProduct(key: string, productId: string) {
    if (productId === "__new__") {
      setShowQuickAdd(key);
      setQuickAddForm({ name: "", rate: "", taxable: true });
      return;
    }
    const p = products.find((x) => x.product_id === productId);
    if (!p) { updateRow(key, { productId: "", productName: "" }); return; }
    updateRow(key, { productId: p.product_id, productName: p.name, description: p.description || "", rate: String(p.rate ?? ""), taxable: p.taxable });
  }

  async function handleQuickAddProduct() {
    if (!showQuickAdd || !quickAddForm.name.trim()) return;
    try {
      const res = await api.post<{ productId: string }>("/products", { name: quickAddForm.name, rate: Number(quickAddForm.rate) || 0, taxable: quickAddForm.taxable });
      const newProduct: ProductService = { product_id: res.productId, name: quickAddForm.name, category: null, description: null, rate: Number(quickAddForm.rate) || 0, taxable: quickAddForm.taxable, active: true };
      setProducts((prev) => [...prev, newProduct]);
      updateRow(showQuickAdd, { productId: newProduct.product_id, productName: newProduct.name, rate: String(newProduct.rate), taxable: newProduct.taxable });
      setShowQuickAdd(null);
      toast("Product/service added.");
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not add this product/service.");
    }
  }

  const lineAmounts = useMemo(() => rows.map((r) => (Number(r.quantity) || 0) * (Number(r.rate) || 0)), [rows]);
  const subtotal = useMemo(() => lineAmounts.reduce((s, a) => s + a, 0), [lineAmounts]);
  const taxableSubtotal = useMemo(() => rows.reduce((s, r, i) => s + (r.taxable ? lineAmounts[i] : 0), 0), [rows, lineAmounts]);
  const discountAmt = discountMode === "percent" ? subtotal * ((Number(discountPercent) || 0) / 100) : Number(discountAmountInput) || 0;
  const previewTaxAmt = taxMode === "manual" ? taxableSubtotal * ((Number(manualTaxRate) || 0) / 100) : taxMode === "none" ? 0 : null;
  const shippingAmt = Number(shippingAmount) || 0;
  const previewTotal = previewTaxAmt !== null ? subtotal - discountAmt + previewTaxAmt + shippingAmt : null;

  async function handleSubmit() {
    if (!clientId) { setError("Select a client."); return; }
    const validRows = rows.filter((r) => r.rate.trim() !== "" || r.productId || r.description.trim());
    if (validRows.length === 0) { setError("Add at least one line item."); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        clientId, invoiceDate, dueDate, terms, customerType, billTo,
        ...(sameAsBillTo
          ? { shipTo }
          : { shipToStreet, shipToCity, shipToState, shipToZip }),
        shipFrom,
        shipVia: shipVia || undefined, shippingDate: shippingDate || undefined, trackingNumber: trackingNumber || undefined,
        description: validRows[0].description || validRows[0].productName || "Service invoice",
        lineItems: validRows.map((r) => ({
          serviceDate: r.serviceDate || undefined, productId: r.productId || undefined, productName: r.productName || undefined,
          description: r.description, quantity: Number(r.quantity) || 1, rate: Number(r.rate) || 0, taxable: r.taxable,
        })),
        paymentInstructions, clientNote, internalNote,
        discountPercent: discountMode === "percent" ? Number(discountPercent) || 0 : 0,
        discountAmount: discountMode === "amount" ? Number(discountAmountInput) || 0 : 0,
        autoTax: taxMode === "auto", salesTaxRate: taxMode === "manual" ? Number(manualTaxRate) || 0 : 0,
        shippingAmount: shippingAmt, depositAmount: Number(depositAmount) || 0, amountPaid: Number(amountPaid) || 0,
        status,
      };
      const res = isEdit
        ? await api.patch<{ invoiceId: string }>(`/billing/invoices/${editing!.invoice_id}`, payload)
        : await api.post<{ invoiceId: string }>("/billing/invoices", payload);
      const invoiceId = isEdit ? editing!.invoice_id : res.invoiceId;
      toast(isEdit ? "Invoice updated." : "Invoice created.");
      onDone(invoiceId);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this invoice.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 920, width: "96vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>{isEdit ? `Edit ${editing!.invoice_id}` : "Create Invoice"}</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        {error && <div className="error-banner">{error}</div>}

        <div className="form-grid">
          <div className="field"><label>Client</label><select value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={isEdit}><option value="">Select a client…</option>{clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}</select></div>
          <div className="field"><label>Customer Type</label><input value={customerType} onChange={(e) => setCustomerType(e.target.value)} placeholder="Business / Individual" /></div>
          <div className="field"><label>Invoice Date</label><input type="date" value={invoiceDate} onChange={(e) => { setInvoiceDate(e.target.value); handleTermsChange(terms); }} /></div>
          <div className="field"><label>Terms</label><select value={terms} onChange={(e) => handleTermsChange(e.target.value)}>{TERMS_OPTIONS.map((t) => <option key={t}>{t}</option>)}</select></div>
          <div className="field"><label>Due Date</label><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          <div className="field"><label>Status</label><select value={status} onChange={(e) => setStatus(e.target.value)}><option>Unpaid</option><option>Partial</option><option>Paid</option><option>Void</option></select></div>
        </div>

        <div className="form-grid">
          <div className="field"><label>Bill To</label><textarea rows={3} value={billTo} onChange={(e) => setBillTo(e.target.value)} /></div>
          <div className="field">
            <label>Ship To <span className="muted" style={{ textTransform: "none", fontWeight: 500 }}><input type="checkbox" checked={sameAsBillTo} onChange={(e) => setSameAsBillTo(e.target.checked)} style={{ marginRight: 4 }} />Same as Bill To</span></label>
            {sameAsBillTo ? (
              <textarea rows={3} value={shipTo} disabled />
            ) : (
              <AddressFields
                idPrefix="ship-to"
                value={{ street: shipToStreet, city: shipToCity, state: shipToState, zip: shipToZip }}
                onChange={(patch) => {
                  if (patch.street !== undefined) setShipToStreet(patch.street);
                  if (patch.city !== undefined) setShipToCity(patch.city);
                  if (patch.state !== undefined) setShipToState(patch.state);
                  if (patch.zip !== undefined) setShipToZip(patch.zip);
                }}
              />
            )}
          </div>
          <div className="field"><label>Ship From (firm address)</label><textarea rows={3} value={shipFrom} onChange={(e) => setShipFrom(e.target.value)} placeholder="AL Tax Service address" /></div>
        </div>

        <div className="form-grid">
          <div className="field"><label>Ship Via</label><input value={shipVia} onChange={(e) => setShipVia(e.target.value)} placeholder="USPS, UPS, hand delivered…" /></div>
          <div className="field"><label>Shipping Date</label><input type="date" value={shippingDate} onChange={(e) => setShippingDate(e.target.value)} /></div>
          <div className="field"><label>Tracking No.</label><input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} /></div>
        </div>

        <div className="form-section-title">Product or Service</div>
        <div style={{ overflowX: "auto", marginBottom: 8 }}>
          <div className="table-scroll">
          <table>
            <thead><tr><th>Service Date</th><th>Product/Service</th><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th><th>Tax</th><th></th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td><input type="date" value={r.serviceDate} onChange={(e) => updateRow(r.key, { serviceDate: e.target.value })} style={{ width: 130 }} /></td>
                  <td>
                    <select value={r.productId} onChange={(e) => selectProduct(r.key, e.target.value)} style={{ width: 160 }}>
                      <option value="">Select…</option>
                      <option value="__new__">+ Add new product/service</option>
                      {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td><input value={r.description} onChange={(e) => updateRow(r.key, { description: e.target.value })} style={{ width: 200 }} /></td>
                  <td><input type="number" min="0" step="0.01" value={r.quantity} onChange={(e) => updateRow(r.key, { quantity: e.target.value })} style={{ width: 60 }} /></td>
                  <td><input type="number" min="0" step="0.01" value={r.rate} onChange={(e) => updateRow(r.key, { rate: e.target.value })} style={{ width: 80 }} /></td>
                  <td className="muted">{money(lineAmounts[i])}</td>
                  <td style={{ textAlign: "center" }}><input type="checkbox" checked={r.taxable} onChange={(e) => updateRow(r.key, { taxable: e.target.checked })} /></td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button type="button" className="btn btn-sm" disabled={i === 0} onClick={() => moveRow(r.key, -1)} title="Move up">↑</button>
                      <button type="button" className="btn btn-sm" disabled={i === rows.length - 1} onClick={() => moveRow(r.key, 1)} title="Move down">↓</button>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => removeRow(r.key)}>×</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button type="button" className="btn btn-sm" onClick={addRow}>Add product or service</button>
          <button type="button" className="btn btn-sm" onClick={clearAllLines}>Clear all lines</button>
        </div>

        {showQuickAdd && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>New Product / Service</h3>
            <div className="form-grid">
              <div className="field"><label>Name</label><input value={quickAddForm.name} onChange={(e) => setQuickAddForm((f) => ({ ...f, name: e.target.value }))} /></div>
              <div className="field"><label>Rate</label><input type="number" step="0.01" value={quickAddForm.rate} onChange={(e) => setQuickAddForm((f) => ({ ...f, rate: e.target.value }))} /></div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 22 }}>
                <input type="checkbox" checked={quickAddForm.taxable} onChange={(e) => setQuickAddForm((f) => ({ ...f, taxable: e.target.checked }))} />
                Taxable
              </label>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={handleQuickAddProduct}>Add</button>
              <button type="button" className="btn btn-sm" onClick={() => setShowQuickAdd(null)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="form-grid">
          <div className="field"><label>Payment Instructions</label><textarea rows={2} value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} placeholder="Tell your client how you want to get paid." /></div>
          <div className="field"><label>Note to Client</label><textarea rows={2} value={clientNote} onChange={(e) => setClientNote(e.target.value)} /></div>
          <div className="field"><label>Internal Notes (hidden)</label><textarea rows={2} value={internalNote} onChange={(e) => setInternalNote(e.target.value)} placeholder="Only visible to staff." /></div>
        </div>

        <div className="form-section-title">Totals</div>
        <div className="form-grid">
          <div className="field">
            <label>Discount</label>
            <div style={{ display: "flex", gap: 6 }}>
              <select value={discountMode} onChange={(e) => setDiscountMode(e.target.value as "percent" | "amount")} style={{ width: 70 }}><option value="percent">%</option><option value="amount">$</option></select>
              {discountMode === "percent" ? (
                <input type="number" min="0" step="0.01" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} />
              ) : (
                <input type="number" min="0" step="0.01" value={discountAmountInput} onChange={(e) => setDiscountAmountInput(e.target.value)} />
              )}
            </div>
          </div>
          <div className="field">
            <label>Sales Tax</label>
            <select value={taxMode} onChange={(e) => setTaxMode(e.target.value as "auto" | "manual" | "none")}>
              <option value="auto">Automatic Calculation</option>
              <option value="manual">Manual Rate</option>
              <option value="none">No Tax</option>
            </select>
          </div>
          {taxMode === "manual" && <div className="field"><label>Tax Rate %</label><input type="number" min="0" step="0.001" value={manualTaxRate} onChange={(e) => setManualTaxRate(e.target.value)} /></div>}
          <div className="field"><label>Shipping</label><input type="number" min="0" step="0.01" value={shippingAmount} onChange={(e) => setShippingAmount(e.target.value)} /></div>
          <div className="field"><label>Deposit</label><input type="number" min="0" step="0.01" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} /></div>
          <div className="field"><label>Amount Paid</label><input type="number" min="0" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} /></div>
        </div>

        <div style={{ marginLeft: "auto", maxWidth: 260, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span className="muted">Subtotal</span><span>{money(subtotal)}</span></div>
          {discountAmt > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span className="muted">Discount</span><span>-{money(discountAmt)}</span></div>}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span className="muted">Taxable Subtotal</span><span>{money(taxableSubtotal)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span className="muted">Sales Tax</span>
            <span>{taxMode === "auto" ? "Calculated on save" : money(previewTaxAmt)}</span>
          </div>
          {shippingAmt > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span className="muted">Shipping</span><span>{money(shippingAmt)}</span></div>}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid var(--line)", marginTop: 4, fontWeight: 700 }}>
            <span>Invoice Total</span><span>{previewTotal !== null ? money(previewTotal) : "Calculated on save"}</span>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
          <div style={{ display: "flex", gap: 12 }}>
            {isEdit && (
              <>
                <button
                  type="button" className="btn btn-sm" disabled={printing}
                  onClick={() => { setPrinting(true); viewFile(`/billing/invoices/${editing!.invoice_id}/print`).catch((err) => alert(err instanceof ApiError ? err.message : "Could not open this invoice.")).finally(() => setPrinting(false)); }}
                >{printing ? "Opening…" : "View / Print"}</button>
                <button
                  type="button" className="btn btn-sm" disabled={downloading}
                  onClick={() => { setDownloading(true); downloadFile(`/billing/invoices/${editing!.invoice_id}/print`, `Invoice_${editing!.invoice_id}.pdf`).catch((err) => alert(err instanceof ApiError ? err.message : "Could not download this invoice.")).finally(() => setDownloading(false)); }}
                >{downloading ? "Generating…" : "Download"}</button>
                <button type="button" className="btn btn-sm" onClick={() => setShowRecurring(true)}>Make Recurring</button>
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSubmit}>{saving ? "Saving…" : isEdit ? "Save Changes" : "Save Invoice"}</button>
          </div>
        </div>
      </div>

      {showRecurring && isEdit && (
        <AddRecurringModal
          clients={clients}
          editing={{ client_id: editing!.client_id, description: editing!.description || "", amount: editing!.total_amount, frequency: "Monthly" }}
          onClose={() => setShowRecurring(false)}
          onDone={() => {}}
        />
      )}
    </div>
  );
}
