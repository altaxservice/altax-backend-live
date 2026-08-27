import { useEffect, useState } from "react";
import { api, ApiError, downloadFile } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useConfirm, useNotify } from "../components/ConfirmProvider";
import { ErrorBanner } from "../components/ErrorBanner";
import { fmtDateTime } from "../utils/date";

/**
 * Newsletter subscriber list + the one deliberately manual send action —
 * direct owner request, 2026-08-27. The public signup form
 * (marketing-site footer) only captures subscribers; nothing here ever
 * auto-generates or auto-sends content — a tax firm's content going out
 * unsupervised is real legal exposure. Staff write (or paste in reviewed
 * AI-drafted) content and click Send themselves, every time.
 */
interface Subscriber { subscriber_id: string; email: string; status: string; source: string | null; subscribed_at: string | null; unsubscribed_at: string | null }

/** "pending" = subscribe form submitted but the confirmation email link hasn't been clicked yet (double opt-in, added 2026-08-27) — not yet a real subscriber and never gets a broadcast send, but distinct from "unsubscribed" so staff aren't misled into thinking someone actively opted out. */
function statusLabel(status: string): string {
  if (status === "subscribed") return "Subscribed";
  if (status === "pending") return "Pending confirmation";
  return "Unsubscribed";
}
interface NewsletterSend { send_id: string; subject: string; recipient_count: number; failed_count: number; sent_by: string; sent_at: string }

export function NewsletterPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const confirmDialog = useConfirm();
  const notify = useNotify();

  const [subscribers, setSubscribers] = useState<Subscriber[] | null>(null);
  const [sends, setSends] = useState<NewsletterSend[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [exporting, setExporting] = useState(false);

  function load() {
    Promise.all([
      api.get<{ subscribers: Subscriber[] }>("/newsletter/subscribers"),
      api.get<{ sends: NewsletterSend[] }>("/newsletter/sends"),
    ]).then(([s, h]) => {
      setSubscribers(s.subscribers);
      setSends(h.sends);
    }).catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the newsletter list."));
  }
  useEffect(load, []);

  const activeCount = (subscribers || []).filter((s) => s.status === "subscribed").length;

  async function handleExport() {
    setExporting(true);
    try {
      await downloadFile("/newsletter/subscribers/export.csv", "newsletter-subscribers.csv");
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not export the subscriber list.");
    } finally {
      setExporting(false);
    }
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim()) { await notify("Enter both a subject and a message."); return; }
    const ok = await confirmDialog({
      title: "Send newsletter",
      message: `Send "${subject.trim()}" to ${activeCount} active subscriber${activeCount === 1 ? "" : "s"}? This goes out immediately — there's no draft/preview step after this.`,
    });
    if (!ok) return;
    setSending(true);
    try {
      const res = await api.post<{ sent: number; failed: number; total: number }>("/newsletter/send", { subject: subject.trim(), body: body.trim() });
      await notify(res.failed > 0 ? `Sent to ${res.sent} of ${res.total} subscribers — ${res.failed} failed (see server logs).` : `Sent to all ${res.sent} subscribers.`);
      setSubject("");
      setBody("");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not send the newsletter.");
    } finally {
      setSending(false);
    }
  }

  if (error) return <ErrorBanner error={error} />;
  if (!subscribers || !sends) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div>
      <div className="portal-banner" style={{ marginBottom: 16 }}>
        <div className="topbar-eyebrow">Newsletter</div>
        <h2>Subscriber List &amp; Manual Send</h2>
        <p>
          Everyone here opted in through the "Stay Connected" form on the marketing site. Nothing sends automatically —
          write a message below and send it yourself whenever you actually have something worth sharing.
        </p>
      </div>

      {isAdmin && (
        <div className="command-panel" style={{ marginBottom: 20 }}>
          <div className="command-panel-header">
            <div>
              <h2 className="command-panel-title">Compose &amp; Send</h2>
              <div className="command-panel-note">Goes to all {activeCount} active subscriber{activeCount === 1 ? "" : "s"} — each gets their own unsubscribe link.</div>
            </div>
          </div>
          <div style={{ padding: 16 }}>
            <div className="field" style={{ marginBottom: 12 }}>
              <label htmlFor="nl-subject">Subject</label>
              <input id="nl-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Your Q3 estimated tax payment is coming up" />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label htmlFor="nl-body">Message</label>
              <textarea id="nl-body" rows={8} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write in plain text — blank lines start a new paragraph." />
            </div>
            <button className="btn btn-primary" disabled={sending || activeCount === 0} onClick={handleSend}>
              {sending ? "Sending…" : activeCount === 0 ? "No active subscribers" : `Send to ${activeCount} Subscriber${activeCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}

      <div className="command-panel" style={{ marginBottom: 20 }}>
        <div className="command-panel-header">
          <div>
            <h2 className="command-panel-title">Subscribers</h2>
            <div className="command-panel-note">{activeCount} active, {subscribers.length} total</div>
          </div>
          <button className="btn btn-sm" disabled={exporting} onClick={handleExport}>{exporting ? "Exporting…" : "Export CSV"}</button>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Source</th><th scope="col">Subscribed</th></tr></thead>
            <tbody>
              {subscribers.map((s) => (
                <tr key={s.subscriber_id}>
                  <td>{s.email}</td>
                  <td className={s.status === "subscribed" ? "" : "muted"}>{statusLabel(s.status)}</td>
                  <td className="muted">{s.source || "—"}</td>
                  <td className="muted">{s.subscribed_at ? fmtDateTime(s.subscribed_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {subscribers.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>Nobody has subscribed yet.</p>}
      </div>

      <div className="command-panel">
        <div className="command-panel-header">
          <h2 className="command-panel-title">Send History</h2>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th scope="col">Subject</th><th scope="col">Recipients</th><th scope="col">Failed</th><th scope="col">Sent By</th><th scope="col">Sent</th></tr></thead>
            <tbody>
              {sends.map((s) => (
                <tr key={s.send_id}>
                  <td>{s.subject}</td>
                  <td>{s.recipient_count}</td>
                  <td className={s.failed_count > 0 ? "" : "muted"}>{s.failed_count}</td>
                  <td className="muted">{s.sent_by}</td>
                  <td className="muted">{fmtDateTime(s.sent_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sends.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No newsletters sent yet.</p>}
      </div>
    </div>
  );
}
