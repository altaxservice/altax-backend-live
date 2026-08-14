import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError, downloadFile, viewFile, buildFilename } from "../api/client";
import type { Client } from "../api/types";
import type { Invoice, Payment } from "../api/types2";
import { useAuth } from "../auth/AuthContext";
import { InvoiceEditorModal } from "../components/InvoiceEditorModal";
import { SendInvoiceModal } from "../components/SendInvoiceModal";
import { StatusBadge } from "../components/StatusBadge";
import { BackLink } from "../components/BackLink";
import { useToast } from "../components/Toast";
import { fmtDateOnly } from "../utils/date";
import { METHODS, ACCOUNT_TYPES, MANUAL_PROFILE, PaymentProfileField } from "./InvoicesListPage";
import { ErrorBanner } from "../components/ErrorBanner";
import { useConfirm, usePrompt, useNotify } from "../components/ConfirmProvider";

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
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();
  const notify = useNotify();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState(PAYMENT_FORM_DEFAULTS);
  // ACC-019 — stays the same across repeat submits of this one open form (a
  // failed/retried "Record Payment" click resends the same key, so the
  // backend recognizes it as the same attempt instead of a new payment), and
  // is cleared once the form closes so the NEXT payment gets its own key.
  const paymentIdempotencyKey = useRef<string | null>(null);
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
      await notify(err instanceof ApiError ? err.message : "Could not generate this invoice PDF.");
    } finally {
      setViewingInvoice(false);
    }
  }

  async function handlePrint() {
    if (!invoiceId) return;
    setPrinting(true);
    try {
      await downloadFile(`/billing/invoices/${invoiceId}/print`, buildFilename([clients.find((c) => c.client_id === invoice?.client_id)?.client_name, "Invoice", invoiceId], "pdf"));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not generate this invoice PDF.");
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
      await notify(err instanceof ApiError ? err.message : "Could not generate this statement.");
    } finally {
      setViewingStatement(false);
    }
  }

  async function handleStatement() {
    if (!invoice) return;
    setStatementing(true);
    try {
      await downloadFile(`/billing/clients/${invoice.client_id}/statement`, buildFilename([clients.find((c) => c.client_id === invoice.client_id)?.client_name, "Statement"], "pdf"));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not generate this statement.");
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
      if (!paymentIdempotencyKey.current) paymentIdempotencyKey.current = crypto.randomUUID();
      await api.post(`/billing/invoices/${invoiceId}/payments`, {
        paymentDate: paymentForm.paymentDate || undefined, actualAmount: Number(paymentForm.amount), method: paymentForm.method,
        paymentMethodId: paymentForm.paymentProfile === MANUAL_PROFILE ? undefined : paymentForm.paymentProfile,
        paymentBankName: paymentForm.bankName, paymentAccountType: paymentForm.accountType, paymentRoutingNumber: paymentForm.routingNumber,
        paymentAccountNumber: paymentForm.accountNumber, paymentBankLast4: paymentForm.bankLast4, confirmationNumber: paymentForm.confirmationNumber,
        notes: paymentForm.notes, idempotencyKey: paymentIdempotencyKey.current,
      });
      paymentIdempotencyKey.current = null;
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
    const reason = await promptFor({ title: "Reverse payment", message: "Reason for reversing this payment?" });
    if (reason === null) return;
    try {
      await api.post(`/billing/payments/${paymentId}/reverse`, { reason });
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not reverse this payment.");
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
      await notify(err instanceof ApiError ? err.message : "Could not create a share link.");
    } finally {
      setSharing(false);
    }
  }

  async function handleVoid() {
    if (!invoiceId) return;
    const ok = await confirmDialog({ title: "Void invoice", message: "This cannot be undone.", confirmLabel: "Void", danger: true });
    if (!ok) return;
    try {
      await api.post(`/billing/invoices/${invoiceId}/void`, {});
      navigate("/billing");
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not void this invoice.");
    }
  }

  if (error) return <ErrorBanner error={error} />;
  if (!invoice) return <div className="spinner-wrap">Loading…</div>;

  const lineItems = invoice.lineItems || [];
  const invoiceClient = clients.find((c) => c.client_id === invoice.client_id);

  return (
    <div>
      <BackLink fallback="/billing" fallbackLabel="All invoices" />
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
          onClose={() => setShowSend(false)}
        />
      )}

      {showPaymentForm && (
        <form onSubmit={handleRecordPayment} className="card" style={{ maxWidth: 500, marginBottom: 24 }}>
          {saveError && <ErrorBanner error={saveError} />}
          <div className="form-grid">
            <div className="field"><label htmlFor="inv-payment-date">Payment Date</label><input id="inv-payment-date" type="date" value={paymentForm.paymentDate} onChange={(e) => setPaymentForm((f) => ({ ...f, paymentDate: e.target.value }))} /></div>
            <div className="field"><label htmlFor="inv-payment-amount">Amount</label><input id="inv-payment-amount" type="number" step="0.01" min="0.01" required value={paymentForm.amount} onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))} /></div>
            <PaymentProfileField clientId={invoice.client_id} value={paymentForm.paymentProfile} onChange={(v) => setPaymentForm((f) => ({ ...f, paymentProfile: v }))} />
            <div className="field"><label htmlFor="inv-payment-method">Method</label><select id="inv-payment-method" value={paymentForm.method} onChange={(e) => setPaymentForm((f) => ({ ...f, method: e.target.value }))}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
          </div>
          {paymentForm.paymentProfile === MANUAL_PROFILE && (
            <div className="form-grid">
              <div className="field"><label htmlFor="inv-bank-name">Bank Name</label><input id="inv-bank-name" value={paymentForm.bankName} onChange={(e) => setPaymentForm((f) => ({ ...f, bankName: e.target.value }))} /></div>
              <div className="field"><label htmlFor="inv-account-type">Account Type</label><select id="inv-account-type" value={paymentForm.accountType} onChange={(e) => setPaymentForm((f) => ({ ...f, accountType: e.target.value }))}><option value="">Select…</option>{ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
              <div className="field"><label htmlFor="inv-routing-number">Routing Number</label><input id="inv-routing-number" value={paymentForm.routingNumber} onChange={(e) => setPaymentForm((f) => ({ ...f, routingNumber: e.target.value }))} /></div>
              <div className="field"><label htmlFor="inv-account-number">Account Number</label><input id="inv-account-number" value={paymentForm.accountNumber} onChange={(e) => setPaymentForm((f) => ({ ...f, accountNumber: e.target.value }))} /></div>
              <div className="field"><label htmlFor="inv-bank-last4">Bank Last 4</label><input id="inv-bank-last4" value={paymentForm.bankLast4} onChange={(e) => setPaymentForm((f) => ({ ...f, bankLast4: e.target.value }))} maxLength={4} /></div>
              <div className="field"><label htmlFor="inv-confirmation-number">Confirmation #</label><input id="inv-confirmation-number" value={paymentForm.confirmationNumber} onChange={(e) => setPaymentForm((f) => ({ ...f, confirmationNumber: e.target.value }))} /></div>
            </div>
          )}
          <div className="field"><label htmlFor="inv-payment-notes">Notes</label><textarea id="inv-payment-notes" rows={2} value={paymentForm.notes} onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Recording…" : "Record Payment"}</button>
        </form>
      )}

      <div className="compose-split" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        <div className="card" style={{ maxWidth: 480 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Details</h2>
          <Row label="Description" value={invoice.description} />
          <Row label="Invoice Date" value={invoice.invoice_date ? fmtDateOnly(invoice.invoice_date) : null} />
          <Row label="Due Date" value={invoice.due_date ? fmtDateOnly(invoice.due_date) : null} />
          <Row label="Terms" value={invoice.terms} />
          <Row label="Bill To" value={invoice.bill_to} />
          {invoice.ship_to && invoice.ship_to !== invoice.bill_to && <Row label="Ship To" value={invoice.ship_to} />}
        </div>
        <div className="card" style={{ maxWidth: 480 }}>
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
          <div className="table-scroll card-table">
          <table style={{ marginTop: 12 }}>
            <thead><tr><th scope="col">Service Date</th><th scope="col">Product/Service</th><th scope="col">Description</th><th scope="col">Qty</th><th scope="col">Rate</th><th scope="col">Amount</th></tr></thead>
            <tbody>
              {lineItems.map((li) => (
                <tr key={li.line_item_id}>
                  <td className="muted">{li.service_date ? fmtDateOnly(li.service_date) : "—"}</td>
                  <td data-label="Product/Service">{li.product_name || "—"}</td>
                  <td className="muted" data-label="Description">{li.description || "—"}</td>
                  <td data-label="Qty">{li.quantity}</td>
                  <td data-label="Rate">{fmtMoney(li.rate)}</td>
                  <td data-label="Amount">{fmtMoney(li.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <h2 style={{ fontSize: 15, margin: 0, padding: "16px 20px 0" }}>Payments</h2>
        <div className="table-scroll card-table">
        <table style={{ marginTop: 12 }}>
          <thead><tr><th scope="col">Date</th><th scope="col">Amount</th><th scope="col">Method</th><th scope="col">Status</th><th scope="col"></th></tr></thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.payment_id}>
                <td>{fmtDateOnly(p.payment_date)}</td>
                <td data-label="Amount">{fmtMoney(p.actual_amount)}</td>
                <td className="muted" data-label="Method">{p.method}</td>
                <td data-label="Status"><StatusBadge status={p.status} /></td>
                <td data-label="">
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
