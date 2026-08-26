import { useEffect, useRef, useState } from "react";
import { api, ApiError, fetchAuthedBlob } from "../api/client";
import type { Client } from "../api/types";
import { useToast } from "./Toast";
import { ErrorBanner } from "./ErrorBanner";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface SendResult { channel: string; ok: boolean; error?: string }

/**
 * "Explain the service to the client" (direct owner request, 2026-08-26) —
 * send the Subscription Plans brochure by email (PDF attached directly) or
 * SMS (a link to the public brochure page, since SMS can't carry a PDF —
 * see publicServiceCatalog.routes.ts). Modeled on SendInvoiceModal.tsx, with
 * an optional client picker that autofills email/phone so staff don't have
 * to leave the client's own record to find it.
 */
export function SendSubscriptionBrochureModal({ onClose }: { onClose: () => void }) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const toast = useToast();

  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [sendSms, setSendSms] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("Our Subscription Plans");
  const [message, setMessage] = useState("Attached is an overview of our subscription plans and current pricing.");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    fetchAuthedBlob(`/service-catalog/brochure/pdf`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch((err) => setPreviewError(err instanceof ApiError ? err.message : "Could not load a preview."));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, []);

  function pickClient(id: string) {
    setClientId(id);
    const c = clients.find((cl) => cl.client_id === id);
    if (c) {
      if (c.email) setEmail(c.email);
      if (c.phone) setPhone(c.phone);
    }
  }

  const channels = [sendEmail && "email", sendSms && "sms"].filter(Boolean) as string[];
  const canSend = channels.length > 0 && (!sendEmail || email.trim()) && (!sendSms || phone.trim());

  async function handleSend() {
    setSending(true);
    setError(null);
    setResults(null);
    try {
      const res = await api.post<{ results: SendResult[] }>(`/service-catalog/brochure/send`, {
        channels, email, phone, clientId: clientId || undefined, subject, message,
      });
      setResults(res.results);
      const allOk = res.results.every((r) => r.ok);
      toast(allOk ? "Sent." : "Some channels failed — see details below.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the brochure.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="send-brochure-title" style={{ maxWidth: 880, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2 id="send-brochure-title">Send Subscription Plans</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        {error && <ErrorBanner error={error} />}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <div className="field">
              <label htmlFor="send-brochure-client">Client <span className="muted">(optional — autofills email/phone)</span></label>
              <select id="send-brochure-client" value={clientId} onChange={(e) => pickClient(e.target.value)}>
                <option value="">— Not tied to a client —</option>
                {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
              </select>
            </div>

            <div style={{ display: "flex", gap: 16, margin: "10px 0" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Email (PDF attached)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={sendSms} onChange={(e) => setSendSms(e.target.checked)} /> SMS (link to view)
              </label>
            </div>

            {sendEmail && (
              <div className="field"><label htmlFor="send-brochure-email">Email address</label><input id="send-brochure-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" /></div>
            )}
            {sendSms && (
              <div className="field"><label htmlFor="send-brochure-phone">Phone number</label><input id="send-brochure-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(410) 555-0100" /></div>
            )}
            <div className="field"><label htmlFor="send-brochure-subject">Subject</label><input id="send-brochure-subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
            <div className="field"><label htmlFor="send-brochure-message">Message</label><textarea id="send-brochure-message" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} /></div>

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
              <iframe src={previewUrl} title="Subscription Plans preview" style={{ width: "100%", height: 460, border: "1px solid var(--line)", borderRadius: 6 }} />
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
