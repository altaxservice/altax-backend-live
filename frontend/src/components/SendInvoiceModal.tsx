import { useEffect, useState } from "react";
import { api, ApiError, fetchAuthedBlob } from "../api/client";
import type { Invoice } from "../api/types2";
import { useToast } from "./Toast";

interface SendResult { channel: string; ok: boolean; error?: string }

/**
 * Send Invoice — Edit/Save/View already exist elsewhere (InvoiceEditorModal,
 * InvoiceDetailPage); this is specifically the "Send Now" step, built at the user's
 * explicit request: pick a channel (email/SMS/WhatsApp), always see the actual PDF
 * before sending (the embedded preview below loads automatically, no extra click
 * needed to satisfy "view every one before we send them"), then send. Each channel
 * is attempted independently server-side — one missing provider (e.g. no Twilio key)
 * doesn't block the others. Also used for Sales Receipts, which are just Paid-status
 * invoices under the hood (see billing.routes.ts POST /sales-receipt).
 */
export function SendInvoiceModal({ invoice, clientEmail, clientPhone, onClose }: {
  invoice: Invoice; clientEmail: string | null; clientPhone: string | null; onClose: () => void;
}) {
  const toast = useToast();
  const [email, setEmail] = useState(clientEmail || "");
  const [phone, setPhone] = useState(clientPhone || "");
  const [channels, setChannels] = useState<{ email: boolean; sms: boolean; whatsapp: boolean }>({ email: Boolean(clientEmail), sms: false, whatsapp: false });
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

  const selectedChannels = Object.entries(channels).filter(([, v]) => v).map(([k]) => k);
  const canSend = selectedChannels.length > 0
    && (!channels.email || email.trim())
    && (!(channels.sms || channels.whatsapp) || phone.trim());

  async function handleSend() {
    setSending(true);
    setError(null);
    setResults(null);
    try {
      const res = await api.post<{ results: SendResult[] }>(`/billing/invoices/${invoice.invoice_id}/send`, {
        channels: selectedChannels, email, phone, subject, message,
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 880, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>Send {invoice.invoice_id}</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        {error && <div className="error-banner">{error}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <div className="field">
              <label>Send via</label>
              <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500 }}>
                  <input type="checkbox" checked={channels.email} onChange={(e) => setChannels((c) => ({ ...c, email: e.target.checked }))} /> Email
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500 }}>
                  <input type="checkbox" checked={channels.sms} onChange={(e) => setChannels((c) => ({ ...c, sms: e.target.checked }))} /> SMS
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500 }}>
                  <input type="checkbox" checked={channels.whatsapp} onChange={(e) => setChannels((c) => ({ ...c, whatsapp: e.target.checked }))} /> WhatsApp
                </label>
              </div>
            </div>
            {channels.email && <div className="field"><label>Email address</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" /></div>}
            {(channels.sms || channels.whatsapp) && <div className="field"><label>Phone number</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1..." /></div>}
            {channels.email && <div className="field"><label>Subject</label><input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>}
            <div className="field"><label>Message</label><textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} /></div>

            {results && (
              <div className="card" style={{ marginTop: 8 }}>
                <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Send Results</h3>
                {results.map((r) => (
                  <div key={r.channel} style={{ fontSize: 13, padding: "3px 0", color: r.ok ? "var(--good, #1a7f37)" : "var(--danger, #cf222e)" }}>
                    {r.ok ? "✓" : "✗"} {r.channel}{r.error ? ` — ${r.error}` : " — sent"}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Preview</label>
            {previewError && <div className="error-banner">{previewError}</div>}
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
