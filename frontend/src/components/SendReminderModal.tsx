import { useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Invoice } from "../api/types2";
import { useToast } from "./Toast";
import { ErrorBanner } from "./ErrorBanner";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

type Urgency = "reminder" | "urgent";

/**
 * Manual "Send Reminder" — separate from the automatic one-time reminder
 * (fires once, 3 days past the invoice's due date). Deliberately much
 * lighter than SendInvoiceModal: no PDF preview, no channel picker (email
 * only, same as the automatic reminder) — just a tone choice and a send
 * button, matching the two-level urgency the user asked for.
 */
export function SendReminderModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const toast = useToast();
  const [urgency, setUrgency] = useState<Urgency>("reminder");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      await api.post(`/billing/invoices/${invoice.invoice_id}/send-reminder`, { urgency });
      setSent(true);
      toast("Reminder sent.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send this reminder.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="send-reminder-title" style={{ maxWidth: 440, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2 id="send-reminder-title">Send Reminder — {invoice.invoice_id}</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        {error && <ErrorBanner error={error} />}

        {sent ? (
          <p style={{ color: "var(--green)", fontWeight: 600 }}>✓ Reminder sent.</p>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Balance due: <strong>${Number(invoice.balance_due).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </p>
            <div className="field">
              <label>Tone</label>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className={`btn btn-sm${urgency === "reminder" ? " btn-primary" : ""}`}
                  onClick={() => setUrgency("reminder")}
                >
                  Reminder
                </button>
                <button
                  type="button"
                  className={`btn btn-sm${urgency === "urgent" ? " btn-primary" : ""}`}
                  style={urgency === "urgent" ? { background: "var(--red)", borderColor: "var(--red)" } : undefined}
                  onClick={() => setUrgency("urgent")}
                >
                  Urgent
                </button>
              </div>
              <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                {urgency === "urgent" ? "Adds an \"[Urgent]\" subject prefix and a red action-needed banner." : "The standard payment reminder — no extra emphasis."}
              </p>
            </div>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={onClose}>{sent ? "Close" : "Cancel"}</button>
          {!sent && <button className="btn btn-primary" disabled={sending} onClick={handleSend}>{sending ? "Sending…" : "Send"}</button>}
        </div>
      </div>
    </div>
  );
}
