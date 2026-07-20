import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError, resolveFileUrl } from "../api/client";

interface PublicLineItem {
  line_item_id: string; service_date: string | null; product_name: string | null; description: string | null;
  quantity: string | number; rate: string | number; amount: string | number;
}
interface PublicInvoice {
  invoice_id: string; invoice_date: string | null; due_date: string | null; description: string | null;
  total_amount: string | number; amount_paid: string | number; balance_due: string | number; status: string;
  terms: string | null; bill_to: string | null; payment_instructions: string | null; client_note: string | null;
  subtotal_amount: string | number | null; discount_amount: string | number | null; sales_tax_amount: string | number | null;
  shipping_amount: string | number | null; lineItems: PublicLineItem[];
}

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}
function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/**
 * Public, no-login invoice view — the destination of an invoice's "Copy Share Link".
 * Deliberately outside <ProtectedRoute> in App.tsx: access is gated by knowing the
 * opaque token in the URL, not by a portal account, matching how QuickBooks share
 * links work. Fetches straight from GET /public/invoices/:token (no auth required).
 */
export function PublicInvoicePage() {
  const { token } = useParams<{ token: string }>();
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api.get<{ invoice: PublicInvoice }>(`/public/invoices/${token}`)
      .then((r) => setInvoice(r.invoice))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this invoice."));
  }, [token]);

  const pageStyle = { maxWidth: 720, margin: "40px auto", padding: "0 20px", fontFamily: "inherit" };

  if (error) return <div style={pageStyle}><div className="error-banner">{error}</div></div>;
  if (!invoice) return <div style={pageStyle}><div className="spinner-wrap">Loading…</div></div>;

  const lineItems = invoice.lineItems || [];
  // Plain links, not the app's usual authed blob-fetch pattern (viewFile/downloadFile) —
  // this route needs no auth, and iOS Safari/Gmail's in-app browser have shown blank
  // pages when navigating a new window to a blob: URL created in a different one.
  const pdfUrl = resolveFileUrl(`/public/invoices/${token}/print`);

  return (
    <div style={pageStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: "var(--muted-fg, #6b7280)" }}>AL Tax Service</div>
          <h1 style={{ fontSize: 24, margin: "4px 0 0" }}>Invoice {invoice.invoice_id}</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn" href={pdfUrl} target="_blank" rel="noopener noreferrer">View PDF</a>
          <a className="btn btn-primary" href={pdfUrl} download={`Invoice_${invoice.invoice_id}.pdf`}>Download PDF</a>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontSize: 13 }}>
          <div>
            <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Bill To</div>
            <div style={{ whiteSpace: "pre-line" }}>{invoice.bill_to || "—"}</div>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}><span className="muted">Invoice Date</span><span>{fmtDate(invoice.invoice_date)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}><span className="muted">Due Date</span><span>{fmtDate(invoice.due_date)}</span></div>
            {invoice.terms && <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}><span className="muted">Terms</span><span>{invoice.terms}</span></div>}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}><span className="muted">Status</span><span>{invoice.status}</span></div>
          </div>
        </div>
      </div>

      {lineItems.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
          <div className="table-scroll">
          <table style={{ marginTop: 0 }}>
            <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
            <tbody>
              {lineItems.map((li) => (
                <tr key={li.line_item_id}>
                  <td>{[li.product_name, li.description].filter(Boolean).join(" — ") || "Service"}</td>
                  <td>{li.quantity}</td>
                  <td>{fmtMoney(li.rate)}</td>
                  <td>{fmtMoney(li.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 20 }}>{invoice.description || "Service invoice"}</div>
      )}

      <div className="card" style={{ marginBottom: 20, marginLeft: "auto", maxWidth: 300 }}>
        {invoice.subtotal_amount != null && <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13 }}><span className="muted">Subtotal</span><span>{fmtMoney(invoice.subtotal_amount)}</span></div>}
        {Number(invoice.discount_amount) > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13 }}><span className="muted">Discount</span><span>-{fmtMoney(invoice.discount_amount)}</span></div>}
        {Number(invoice.sales_tax_amount) > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13 }}><span className="muted">Sales Tax</span><span>{fmtMoney(invoice.sales_tax_amount)}</span></div>}
        {Number(invoice.shipping_amount) > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13 }}><span className="muted">Shipping</span><span>{fmtMoney(invoice.shipping_amount)}</span></div>}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 14, fontWeight: 700, borderTop: "1px solid var(--line)", marginTop: 4 }}><span>Total</span><span>{fmtMoney(invoice.total_amount)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 13 }}><span className="muted">Paid</span><span>{fmtMoney(invoice.amount_paid)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 14, fontWeight: 700 }}><span>Balance Due</span><span>{fmtMoney(invoice.balance_due)}</span></div>
      </div>

      {invoice.payment_instructions && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Payment Instructions</div>
          <div style={{ fontSize: 13 }}>{invoice.payment_instructions}</div>
        </div>
      )}
      {invoice.client_note && <p className="muted" style={{ fontSize: 13 }}>{invoice.client_note}</p>}
    </div>
  );
}
