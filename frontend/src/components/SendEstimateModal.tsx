import { useEffect, useRef, useState } from "react";
import { api, ApiError, fetchAuthedBlob } from "../api/client";
import type { Estimate, EstimateTotals } from "../api/estimates";
import { useToast } from "./Toast";
import { ErrorBanner } from "./ErrorBanner";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

/**
 * Send Estimate — mirrors SendInvoiceModal exactly (same PDF preview, same
 * manual "Send Now" button, email only) so staff who already know how to send
 * an invoice need to learn nothing new. Sending is ALWAYS this one deliberate
 * click: nothing in the estimate flow — not saving, not approving, not
 * converting — emails the client on its own.
 */
export function SendEstimateModal({ estimate, totals, onClose, onSent }: {
  estimate: Estimate; totals: EstimateTotals; onClose: () => void; onSent: () => void;
}) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const toast = useToast();
  const [email, setEmail] = useState(estimate.email || "");
  const [phone, setPhone] = useState(estimate.phone || "");
  const [subject, setSubject] = useState(`Estimate ${estimate.estimate_number} from AL Tax Service`);
  const [message, setMessage] = useState(
    `Please find your estimate attached for ${estimate.business_name}. Total estimated: $${totals.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    fetchAuthedBlob(`/estimates/${estimate.estimate_id}/print`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch((err) => setPreviewError(err instanceof ApiError ? err.message : "Could not load a preview."));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [estimate.estimate_id]);

  async function handleSend() {
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<{ ok: boolean; error?: string; smsError?: string }>(`/estimates/${estimate.estimate_id}/send`, {
        email, phone, subject, message,
      });
      setResult(res);
      toast(res.ok ? "Estimate sent." : `Could not send — ${res.error || res.smsError}`);
      if (res.ok) onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send this estimate.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="send-estimate-title" style={{ maxWidth: 880, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2 id="send-estimate-title">Send {estimate.estimate_number}</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        {error && <ErrorBanner error={error} />}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div>
            <div className="field"><label htmlFor="send-estimate-email">Email address</label><input id="send-estimate-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" /></div>
            <div className="field"><label htmlFor="send-estimate-phone">Phone (optional — sends a short SMS heads-up)</label><input id="send-estimate-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" /></div>
            <div className="field"><label htmlFor="send-estimate-subject">Subject</label><input id="send-estimate-subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
            <div className="field"><label htmlFor="send-estimate-message">Message</label><textarea id="send-estimate-message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} /></div>

            {result && (
              <div className="card" style={{ marginTop: 8 }}>
                <div style={{ fontSize: 13, color: result.ok ? "var(--green)" : "var(--red)" }}>
                  {result.ok ? "✓ Sent" : `✗ ${result.error}`}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Preview</label>
            {previewError && <ErrorBanner error={previewError} />}
            {previewUrl ? (
              <iframe src={previewUrl} title="Estimate preview" style={{ width: "100%", height: 460, border: "1px solid var(--line)", borderRadius: 6 }} />
            ) : !previewError ? (
              <div className="muted" style={{ padding: 40, textAlign: "center" }}>Loading preview…</div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={sending || (!email.trim() && !phone.trim())} onClick={handleSend}>{sending ? "Sending…" : "Send Now"}</button>
        </div>
      </div>
    </div>
  );
}
