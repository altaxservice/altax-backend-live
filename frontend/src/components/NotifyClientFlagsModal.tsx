import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { type ClientFlag, flagLabel } from "../utils/clientFlags";

interface NotifyPreview {
  subject: string;
  messageEnglish: string;
  messageArabic: string;
  count: number;
  flags: ClientFlag[];
}

/**
 * "Notify Client" for account flags — GET :clientId/flags/notify-preview
 * (clients.routes.ts) builds the bilingual EN/AR body from only the flags
 * staff has marked "Share with client"; this modal lets staff review/edit
 * that text before it goes out, then sends it through the same
 * POST /communications path every other client-facing send in this app
 * already uses (consent gate, share-token view link, audit log). Nothing
 * here invents a second send pipeline.
 */
export function NotifyClientFlagsModal({ clientId, clientName, clientEmail, clientPhone, onClose }: {
  clientId: string; clientName: string; clientEmail: string | null; clientPhone: string | null; onClose: () => void;
}) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [subject, setSubject] = useState("");
  const [messageEnglish, setMessageEnglish] = useState("");
  const [messageArabic, setMessageArabic] = useState("");
  const [channel, setChannel] = useState<"Email" | "SMS">(clientEmail ? "Email" : "SMS");
  const [sentTo, setSentTo] = useState(clientEmail || clientPhone || "");
  const [cc, setCc] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // Every flag currently eligible to share (the "Share?" toggle on each flag
  // controls this standing eligibility) — the checklist below lets staff pick
  // a subset for THIS particular send, without changing that eligibility.
  const [shareableFlags, setShareableFlags] = useState<ClientFlag[] | null>(null);
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.get<NotifyPreview>(`/clients/${clientId}/flags/notify-preview`)
      .then((r) => {
        setSubject(r.subject);
        setMessageEnglish(r.messageEnglish);
        setMessageArabic(r.messageArabic);
        setCount(r.count);
        setShareableFlags(r.flags);
        setExcludedKeys(new Set());
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Could not load the flags for this client."))
      .finally(() => setLoading(false));
  }, [clientId]);

  async function refreshForSelection(nextExcluded: Set<string>) {
    if (!shareableFlags) return;
    const selectedKeys = shareableFlags.filter((f) => !nextExcluded.has(f.key)).map((f) => f.key);
    if (selectedKeys.length === 0) {
      // Guard client-side — an empty flagKeys= would 404 with a misleading
      // "nothing is shared" message; this just means "select at least one."
      setMessageEnglish("");
      setMessageArabic("");
      setCount(0);
      return;
    }
    try {
      const r = await api.get<NotifyPreview>(`/clients/${clientId}/flags/notify-preview?flagKeys=${encodeURIComponent(selectedKeys.join(","))}`);
      // Deliberately not re-setting subject — leave any hand-edit staff made
      // to it alone as the selection changes.
      setMessageEnglish(r.messageEnglish);
      setMessageArabic(r.messageArabic);
      setCount(r.count);
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : "Could not update the preview for this selection.");
    }
  }

  function toggleFlag(key: string) {
    setExcludedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      refreshForSelection(next);
      return next;
    });
  }

  useEffect(() => {
    setSentTo(channel === "Email" ? (clientEmail || "") : (clientPhone || ""));
  }, [channel, clientEmail, clientPhone]);

  const canSend = !loading && !loadError && count > 0 && sentTo.trim().length > 0 && (messageEnglish.trim() || messageArabic.trim());

  async function handleSend() {
    setSending(true);
    setSendError(null);
    try {
      // CC only makes sense for Email — sendChannel has no cc concept for SMS.
      const ccList = channel === "Email" ? cc.split(/[,;]/).map((v) => v.trim()).filter((v) => v.includes("@")) : [];
      const res = await api.post<{ sent: boolean; sendError?: string }>("/communications", {
        clientId, subject, messageEnglish, messageArabic, channel, sentTo, sendNow: true, sourceSystem: "Client Flags",
        cc: ccList.length ? ccList : undefined,
        // Always send both languages here regardless of the client's stored
        // preferred_language (which POST /communications otherwise defaults
        // to) — this feature exists specifically to notify in English AND
        // Arabic, not to respect the single-language preference used for
        // other correspondence like invoices or general messages.
        languagePreference: "Both",
      });
      if (res.sent) {
        setSent(true);
      } else {
        setSendError(res.sendError || "Could not send — check the client's contact info and opt-in status.");
      }
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : "Could not send this message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="notify-client-flags-title" style={{ maxWidth: 720, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="notify-client-flags-title">Notify {clientName} of Account Items</h2>
          <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
        </div>

        {loading && <div className="spinner-wrap" style={{ padding: 24 }}>Loading…</div>}
        {loadError && <ErrorBanner error={loadError} />}
        {sendError && <ErrorBanner error={sendError} />}

        {!loading && !loadError && (
          sent ? (
            <div className="status-pill status-green" style={{ padding: "8px 12px" }}>
              ✓ Sent to {sentTo} via {channel}{channel === "Email" && cc.trim() ? ` (cc: ${cc.trim()})` : ""}.
            </div>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
                {count} of {shareableFlags?.length ?? count} item{(shareableFlags?.length ?? count) === 1 ? "" : "s"} selected below will be included. Review and edit the text before sending —
                nothing sends automatically.
              </p>

              {shareableFlags && shareableFlags.length > 0 && (
                <div className="field">
                  <label>Include in this message</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: 8 }}>
                    {shareableFlags.map((f) => (
                      <label key={f.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
                        <input type="checkbox" checked={!excludedKeys.has(f.key)} onChange={() => toggleFlag(f.key)} />
                        {flagLabel(f)}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="field">
                <label htmlFor="notify-flags-channel">Send via</label>
                <select id="notify-flags-channel" value={channel} onChange={(e) => setChannel(e.target.value as "Email" | "SMS")}>
                  <option value="Email">Email</option>
                  <option value="SMS">SMS</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="notify-flags-sentto">{channel === "Email" ? "Email address" : "Phone number"}</label>
                <input id="notify-flags-sentto" value={sentTo} onChange={(e) => setSentTo(e.target.value)} placeholder={channel === "Email" ? "client@example.com" : "+1 555 555 5555"} />
              </div>
              {channel === "Email" && (
                <div className="field">
                  <label htmlFor="notify-flags-cc">CC (optional, comma-separated)</label>
                  <input id="notify-flags-cc" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="bookkeeper@example.com, owner@example.com" />
                </div>
              )}
              <div className="field">
                <label htmlFor="notify-flags-subject">Subject</label>
                <input id="notify-flags-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="notify-flags-en">English</label>
                <textarea id="notify-flags-en" rows={8} value={messageEnglish} onChange={(e) => setMessageEnglish(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="notify-flags-ar">Arabic — العربية</label>
                <textarea id="notify-flags-ar" rows={8} dir="rtl" value={messageArabic} onChange={(e) => setMessageArabic(e.target.value)} />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                <button type="button" className="btn" onClick={onClose}>Cancel</button>
                <button type="button" className="btn btn-primary" disabled={sending || !canSend} onClick={handleSend}>{sending ? "Sending…" : "Send Now"}</button>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}
