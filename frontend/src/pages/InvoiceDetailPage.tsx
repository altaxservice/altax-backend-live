import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, downloadFile, viewFile } from "../api/client";
import type { Client } from "../api/types";
import type { Invoice, Payment } from "../api/types2";
import { useAuth } from "../auth/AuthContext";
import { InvoiceEditorModal } from "../components/InvoiceEditorModal";
import { SendInvoiceModal } from "../components/SendInvoiceModal";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/Toast";
import { fmtDateOnly } from "../utils/date";
import { METHODS, ACCOUNT_TYPES, MANUAL_PROFILE, PaymentProfileField } from "./InvoicesListPage";

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

const PAYMENT_FORM_DEFAULTS = {
  paymentDate: "", amount: "", method: "Check", paymentProfile: MANUAL_PROFILE,
  bankName: "", accountType: "", routingNumber: "", accountNumber: "", bankLast4: "", confirmationNumber: "", notes: "",
};

export function InvoiceDetailPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState(PAYMENT_FORM_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [viewingInvoice, setViewingInvoice] = useState(false);
  const [statementing, setStatementing] = useState(false);
  const [viewingStatement, setViewingStatement] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [sharing, setSharing] = useState(false);

  const canManage = user?.role === "admin" || user?.role === "staff";

  useEffect(() => {
    if (canManage) api.get<{ clients: Client[] }>("/clients").then((res) => setClients(res.clients)).catch(() => {});
  }, [canManage]);

  async function handleViewInvoice() {
    if (!invoiceId) return;
    setViewingInvoice(true);
    try {
      await viewFile(`/billing/invoices/${invoiceId}/print`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this invoice PDF.");
    } finally {
      setViewingInvoice(false);
    }
  }

  async function handlePrint() {
    if (!invoiceId) return;
    setPrinting(true);
    try {
      await downloadFile(`/billing/invoices/${invoiceId}/print`, `Invoice_${invoiceId}.pdf`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this invoice PDF.");
    } finally {
      setPrinting(false);
    }
  }

  async function handleViewStatement() {
    if (!invoice) return;
    setViewingStatement(true);
    try {
      await viewFile(`/billing/clients/${invoice.client_id}/statement`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this statement.");
    } finally {
      setViewingStatement(false);
    }
  }

  async function handleStatement() {
    if (!invoice) return;
    setStatementing(true);
    try {
      await downloadFile(`/billing/clients/${invoice.client_id}/statement`, `Statement_${invoice.client_id}.pdf`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this statement.");
    } finally {
      setStatementing(false);
    }
  }

  function load() {
    if (!invoiceId) return;
    Promise.all([
      api.get<{ invoice: Invoice }>(`/billing/invoices/${invoiceId}`),
      api.get<{ payments: Payment[] }>(`/billing/invoices/${invoiceId}/payments`),
    ])
      .then(([i, p]) => { setInvoice(i.invoice); setPayments(p.payments); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this invoice."));
  }

  useEffect(load, [invoiceId]);

  async function handleRecordPayment(e: FormEvent) {
    e.preventDefault();
    if (!invoiceId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.post(`/billing/invoices/${invoiceId}/payments`, {
        paymentDate: paymentForm.paymentDate || undefined, actualAmount: Number(paymentForm.amount), method: paymentForm.method,
        paymentMethodId: paymentForm.paymentProfile === MANUAL_PROFILE ? undefined : paymentForm.paymentProfile,
        paymentBankName: paymentForm.bankName, paymentAccountType: paymentForm.accountType, paymentRoutingNumber: paymentForm.routingNumber,
        paymentAccountNumber: paymentForm.accountNumber, paymentBankLast4: paymentForm.bankLast4, confirmationNumber: paymentForm.confirmationNumber,
        notes: paymentForm.notes,
      });
      setShowPaymentForm(false);
      setPaymentForm(PAYMENT_FORM_DEFAULTS);
      toast("Payment recorded.");
      load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not record payment.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReverse(paymentId: string) {
    const reason = prompt("Reason for reversing this payment?");
    if (!reason) return;
    try {
      await api.post(`/billing/payments/${paymentId}/reverse`, { reason });
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not reverse this payment.");
    }
  }

  async function handleShareLink() {
    if (!invoiceId) return;
    setSharing(true);
    try {
      const res = await api.post<{ shareToken: string }>(`/billing/invoices/${invoiceId}/share`, {});
      const url = `${window.location.origin}/public/invoice/${res.shareToken}`;
      await navigator.clipboard.writeText(url);
      toast("Share link copied to clipboard.");
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not create a share link.");
    } finally {
      setSharing(false);
    }
  }

  async function handleVoid() {
    if (!invoiceId) return;
    if (!confirm("Void this invoice? This cannot be undone.")) return;
    try {
      await api.post(`/billing/invoices/${invoiceId}/void`, {});
      navigate("/billing");
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not void this invoice.");
    }
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!invoice) return <div className="spinner-wrap">Loading…</div>;

  const lineItems = invoice.lineItems || [];
  const invoiceClient = clients.find((c) => c.client_id === invoice.client_id);

  return (
    <div>
      <Link to="/billing" className="muted">← All invoices</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", margin: "8px 0 24px", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>{invoice.invoice_id}</h1>
          <StatusBadge status={invoice.status} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" disabled={viewingInvoice} onClick={handleViewInvoice}>{viewingInvoice ? "Generating…" : "View Invoice"}</button>
          <button className="btn" disabled={printing} onClick={handlePrint}>{printing ? "Generating…" : "Download Invoice"}</button>
          <button className="btn" disabled={viewingStatement} onClick={handleViewStatement}>{viewingStatement ? "Generating…" : "View Statement"}</button>
          <button className="btn" disabled={statementing} onClick={handleStatement}>{statementing ? "Generating…" : "Download Statement"}</button>
          {canManage && invoice.status !== "Void" && (
            <>
              <button className="btn" onClick={() => setEditing(true)}>Edit</button>
              <button className="btn" disabled={sharing} onClick={handleShareLink}>{sharing ? "Creating…" : "Copy Share Link"}</button>
              <button className="btn btn-primary" onClick={() => setShowSend(true)}>Send</button>
              <button className="btn btn-primary" onClick={() => setShowPaymentForm((v) => !v)}>Record Payment</button>
              <button className="btn btn-danger" onClick={handleVoid}>Void</button>
            </>
          )}
        </div>
      </div>

      {editing && (
        <InvoiceEditorModal
          clients={clients}
          editing={invoice}
          onClose={() => setEditing(false)}
          onDone={() => load()}
        />
      )}

      {showSend && (
        <SendInvoiceModal
          invoice={invoice}
          clientEmail={invoiceClient?.email || null}
          clientPhone={invoiceClient?.phone || null}
          onClose={() => setShowSend(false)}
        />
      )}

      {showPaymentForm && (
        <form onSubmit={handleRecordPayment} className="card" style={{ maxWidth: 500, marginBottom: 24 }}>
          {saveError && <div className="error-banner">{saveError}</div>}
          <div className="form-grid">
            <div className="field"><label>Payment Date</label><input type="date" value={paymentForm.paymentDate} onChange={(e) => setPaymentForm((f) => ({ ...f, paymentDate: e.target.value }))} /></div>
            <div className="field"><label>Amount</label><input type="number" step="0.01" min="0.01" required value={paymentForm.amount} onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))} /></div>
            <PaymentProfileField clientId={invoice.client_id} value={paymentForm.paymentProfile} onChange={(v) => setPaymentForm((f) => ({ ...f, paymentProfile: v }))} />
            <div className="field"><label>Method</label><select value={paymentForm.method} onChange={(e) => setPaymentForm((f) => ({ ...f, method: e.target.value }))}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
          </div>
          {paymentForm.paymentProfile === MANUAL_PROFILE && (
            <div className="form-grid">
              <div className="field"><label>Bank Name</label><input value={paymentForm.bankName} onChange={(e) => setPaymentForm((f) => ({ ...f, bankName: e.target.value }))} /></div>
              <div className="field"><label>Account Type</label><select value={paymentForm.accountType} onChange={(e) => setPaymentForm((f) => ({ ...f, accountType: e.target.value }))}><option value="">Select…</option>{ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
              <div className="field"><label>Routing Number</label><input value={paymentForm.routingNumber} onChange={(e) => setPaymentForm((f) => ({ ...f, routingNumber: e.target.value }))} /></div>
              <div className="field"><label>Account Number</label><input value={paymentForm.accountNumber} onChange={(e) => setPaymentForm((f) => ({ ...f, accountNumber: e.target.value }))} /></div>
              <div className="field"><label>Bank Last 4</label><input value={paymentForm.bankLast4} onChange={(e) => setPaymentForm((f) => ({ ...f, bankLast4: e.target.value }))} maxLength={4} /></div>
              <div className="field"><label>Confirmation #</label><input value={paymentForm.confirmationNumber} onChange={(e) => setPaymentForm((f) => ({ ...f, confirmationNumber: e.target.value }))} /></div>
            </div>
          )}
          <div className="field"><label>Notes</label><textarea rows={2} value={paymentForm.notes} onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Recording…" : "Record Payment"}</button>
        </form>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        <div className="card">
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Details</h2>
          <Row label="Description" value={invoice.description} />
          <Row label="Invoice Date" value={invoice.invoice_date ? fmtDateOnly(invoice.invoice_date) : null} />
          <Row label="Due Date" value={invoice.due_date ? fmtDateOnly(invoice.due_date) : null} />
          <Row label="Terms" value={invoice.terms} />
          <Row label="Bill To" value={invoice.bill_to} />
          {invoice.ship_to && invoice.ship_to !== invoice.bill_to && <Row label="Ship To" value={invoice.ship_to} />}
        </div>
        <div className="card">
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Amounts</h2>
          {lineItems.length > 0 && <Row label="Subtotal" value={fmtMoney(invoice.subtotal_amount)} />}
          {Number(invoice.discount_amount) > 0 && <Row label="Discount" value={`-${fmtMoney(invoice.discount_amount)}`} />}
          {Number(invoice.sales_tax_amount) > 0 && <Row label="Sales Tax" value={fmtMoney(invoice.sales_tax_amount)} />}
          {Number(invoice.shipping_amount) > 0 && <Row label="Shipping" value={fmtMoney(invoice.shipping_amount)} />}
          <Row label="Total" value={fmtMoney(invoice.total_amount)} />
          <Row label="Paid" value={fmtMoney(invoice.amount_paid)} />
          <Row label="Balance Due" value={fmtMoney(invoice.balance_due)} />
        </div>
      </div>

      {lineItems.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, margin: 0, padding: "16px 20px 0" }}>Line Items</h2>
          <div className="table-scroll">
          <table style={{ marginTop: 12 }}>
            <thead><tr><th>Service Date</th><th>Product/Service</th><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
            <tbody>
              {lineItems.map((li) => (
                <tr key={li.line_item_id}>
                  <td className="muted">{li.service_date ? fmtDateOnly(li.service_date) : "—"}</td>
                  <td>{li.product_name || "—"}</td>
                  <td className="muted">{li.description || "—"}</td>
                  <td>{li.quantity}</td>
                  <td>{fmtMoney(li.rate)}</td>
                  <td>{fmtMoney(li.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <h2 style={{ fontSize: 15, margin: 0, padding: "16px 20px 0" }}>Payments</h2>
        <div className="table-scroll">
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.payment_id}>
                <td>{fmtDateOnly(p.payment_date)}</td>
                <td>{fmtMoney(p.actual_amount)}</td>
                <td className="muted">{p.method}</td>
                <td><StatusBadge status={p.status} /></td>
                <td>
                  {canManage && p.status === "Active" && (
                    <button className="btn btn-sm btn-danger" onClick={() => handleReverse(p.payment_id)}>Reverse</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {payments.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No payments recorded.</p>}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
      <span className="muted">{label}</span>
      <span>{value || "—"}</span>
    </div>
  );
}
