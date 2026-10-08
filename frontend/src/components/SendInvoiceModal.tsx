import { useEffect, useRef, useState } from "react";
import { api, ApiError, fetchAuthedBlob } from "../api/client";
import type { Invoice } from "../api/types2";
import { useToast } from "./Toast";
import { ErrorBanner } from "./ErrorBanner";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface SendResult { channel: string; ok: boolean; error?: string }

/**
 * Send Invoice — Edit/Save/View already exist elsewhere (InvoiceEditorModal,
 * InvoiceDetailPage); this is specifically the "Send Now" step, always showing the
 * actual PDF before sending (the embedded preview below loads automatically, no
 * extra click needed to satisfy "view every one before we send them"), then send.
 * Email and/or text message. The email carries the PDF plus a "View invoice online" button; the text carries
 * the same online link. Texting requires the client's "SMS allowed" consent, so the option is disabled without it.
 * Also used for Sales Receipts, which are just Paid-status invoices under the hood
 * (see billing.routes.ts POST /sales-receipt).
 */
export function SendInvoiceModal({ invoice, clientEmail, clientPhone, smsAllowed, onClose }: {
  invoice: Invoice; clientEmail: string | null; clientPhone?: string | null; smsAllowed?: boolean; onClose: () => void;
}) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const toast = useToast();
  const [email, setEmail] = useState(clientEmail || "");
  const [byEmail, setByEmail] = useState(true);
  const [bySms, setBySms] = useState(false);
  const [phone, setPhone] = useState(clientPhone || "");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState(`Invoice ${invoice.invoice_id} from AL Tax Service`);
  const [message, setMessage] = useState(`Please find invoice ${invoice.invoice_id} attached. Total due: $${Number(invoice.balance_due).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    fetchAuthedBlob(`/billing/invoices/${invoice.invoice_id}/print`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch((err) => setPreviewError(err instanceof ApiError ? err.message : "Could not load a preview."));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [invoice.invoice_id]);

  const canSend = (byEmail || bySms) && (!byEmail || email.trim().length > 0) && (!bySms || phone.trim().length > 0);

  async function handleSend() {
    setSending(true);
    setError(null);
    setResults(null);
    try {
      const res = await api.post<{ results: SendResult[] }>(`/billing/invoices/${invoice.invoice_id}/send`, {
        channels: [...(byEmail ? ["email"] : []), ...(bySms ? ["sms"] : [])], email, phone, cc, bcc, subject, message,
      });
      setResults(res.results);
      const allOk = res.results.every((r) => r.ok);
      toast(allOk ? "Sent." : "Some channels failed — see details below.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send this invoice.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (onClose)(); }}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="send-invoice-title" style={{ width: "min(880px, 94vw)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2 id="send-invoice-title">Send {invoice.invoice_id}</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        {error && <ErrorBanner error={error} />}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <div style={{ display: "flex", gap: 18, marginBottom: 10, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}><input type="checkbox" checked={byEmail} onChange={(e) => setByEmail(e.target.checked)} /> Email (PDF + online link)</label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, opacity: smsAllowed ? 1 : 0.6 }}>
                <input type="checkbox" checked={bySms} disabled={!smsAllowed} onChange={(e) => setBySms(e.target.checked)} /> Text message (online link)
              </label>
            </div>
            {!smsAllowed && <div className="muted" style={{ fontSize: 12, margin: "-4px 0 10px" }}>Texting is off because this client has not agreed to text messages or has no phone number. Turn on "SMS allowed" and add a phone in their profile to enable it.</div>}
            {bySms && (
              <div className="field">
                <label htmlFor="send-invoice-phone">Phone number (text)</label>
                <input id="send-invoice-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(410) 555-0123" />
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>The text says: "AL TAX SERVICE: Invoice {invoice.invoice_id} — $balance due. View it here: [secure link]".</div>
              </div>
            )}
            <div className="field">
              <label htmlFor="send-invoice-email">
                Email address
                {!showCcBcc && <button type="button" className="link-button" style={{ float: "right", fontWeight: 400 }} onClick={() => setShowCcBcc(true)}>Add Cc/Bcc</button>}
              </label>
              <input id="send-invoice-email" type="email" value={email} disabled={!byEmail} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" />
            </div>
            {showCcBcc && (
              <>
                <div className="field"><label htmlFor="send-invoice-cc">Cc <span className="muted">(comma-separated for more than one)</span></label><input id="send-invoice-cc" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="colleague@example.com, manager@example.com" /></div>
                <div className="field"><label htmlFor="send-invoice-bcc">Bcc <span className="muted">(comma-separated, not visible to other recipients)</span></label><input id="send-invoice-bcc" value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="records@altaxgroup.com" /></div>
              </>
            )}
            <div className="field"><label htmlFor="send-invoice-subject">Subject</label><input id="send-invoice-subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
            <div className="field"><label htmlFor="send-invoice-message">Message</label><textarea id="send-invoice-message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} /></div>

            {results && (
              <div className="card" style={{ marginTop: 8 }}>
                <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Send Results</h3>
                {results.map((r) => (
                  <div key={r.channel} style={{ fontSize: 13, padding: "3px 0", color: r.ok ? "var(--green)" : "var(--red)" }}>
                    {r.ok ? "✓" : "✗"} {r.channel}{r.error ? ` — ${r.error}` : " — sent"}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Preview</label>
            {previewError && <ErrorBanner error={previewError} />}
            {previewUrl ? (
              <iframe src={previewUrl} title="Invoice preview" style={{ width: "100%", height: 460, border: "1px solid var(--line)", borderRadius: 6 }} />
            ) : !previewError ? (
              <div className="muted" style={{ padding: 40, textAlign: "center" }}>Loading preview…</div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={sending || !canSend} onClick={handleSend}>{sending ? "Sending…" : "Send Now"}</button>
        </div>
      </div>
    </div>
  );
}
