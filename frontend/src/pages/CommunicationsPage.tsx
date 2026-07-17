import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { Communication } from "../api/types2";
import type { Client } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useSelectedClient } from "../context/SelectedClientContext";

interface StaffDirectoryEntry { name: string; email: string; phone: string | null; role: string }
interface TemplateRow { templateId: string | null; name: string; category: string; subject: string; source: string }
interface TemplateDetail { subject: string; message_english: string | null; message_arabic: string | null }

const CHANNELS = ["Email", "SMS", "WhatsApp", "Phone", "Portal Note"];

/** sessionStorage key prefix (suffixed with `:${clientId}`) Reports' Client Message tab uses to hand off a computed period message to this page's composer — see ClientMessages' mount effect below. */
export const CLIENT_MESSAGE_HANDOFF_KEY = "altax_client_message_handoff";

const ROLE_HEADER: Record<string, { title: string; note: string }> = {
  admin: { title: "Firm Communication Center", note: "Send and log client messages, staff notes, and reminders from one controlled history." },
  staff: { title: "Staff Message Center", note: "Send and log client messages and staff notes for the clients you work with." },
  client: { title: "Client Message Center", note: "Message AL TAX directly and review your message history." },
  employee: { title: "Employee Message Center", note: "Message AL TAX about your pay or account and review your message history." },
};

function Panel({ title, note, action, children }: { title: string; note?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="command-panel" style={{ marginBottom: 20 }}>
      <div className="command-panel-header">
        <div>
          <h2 className="command-panel-title">{title}</h2>
          {note && <div className="command-panel-note">{note}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Multi-select channel checkbox grid — replaces a single-select dropdown so a message can go out on more than one channel at once, matching legacy. */
function ChannelCheckboxes({ selected, onToggle }: { selected: string[]; onToggle: (c: string) => void }) {
  return (
    <div className="field">
      <label>Channels</label>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
        {CHANNELS.map((c) => (
          <label key={c} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={selected.includes(c)} onChange={() => onToggle(c)} />
            {c}
          </label>
        ))}
      </div>
    </div>
  );
}

/** Shows per-channel delivery outcomes after a multi-channel send (one entry per POST call). */
function SendResults({ results }: { results: { channel: string; sent?: boolean; sendError?: string }[] }) {
  if (results.length === 0) return null;
  return (
    <div className="card" style={{ marginBottom: 12, fontSize: 12 }}>
      {results.map((r, i) => (
        <div key={i}>
          <strong>{r.channel}:</strong>{" "}
          {r.sent ? <span style={{ color: "var(--green)" }}>Sent.</span>
            : r.sendError ? <span className="muted">Saved, not sent — {r.sendError}</span>
            : <span className="muted">Saved to history.</span>}
        </div>
      ))}
    </div>
  );
}

interface ReminderRunResult {
  staff: { sent: number; skipped: number; failed: number };
  clients: { sent: number; skipped: number; failed: number };
  payments: { sent: number; skipped: number; failed: number };
}

/**
 * Manually triggers reminders.routes.ts POST /reminders/run — there's no
 * scheduler in this backend (see that route's doc comment), so a staff
 * member clicks this whenever they want reminders sent: one daily digest per
 * staff member covering their due/overdue tasks, one per client with open
 * document requests, and one per client with an unpaid invoice balance.
 * Idempotent server-side: clicking twice in one day just re-skips everything
 * already sent.
 */
function RunRemindersButton({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReminderRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<ReminderRunResult>("/reminders/run", { daysAhead: 3 });
      setResult(res);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not run reminders.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ textAlign: "right" }}>
      <button type="button" className="btn" disabled={running} onClick={handleRun}>
        {running ? "Running…" : "Run Reminders"}
      </button>
      {error && <div className="muted" style={{ fontSize: 11, marginTop: 4, color: "var(--red)" }}>{error}</div>}
      {result && (
        <div className="muted" style={{ fontSize: 11, marginTop: 4, maxWidth: 320 }}>
          Staff digests: {result.staff.sent + result.staff.failed} logged ({result.staff.sent} emailed{result.staff.failed ? `, ${result.staff.failed} email not configured` : ""}), {result.staff.skipped} already today
          <br />
          Document reminders: {result.clients.sent + result.clients.failed} logged ({result.clients.sent} emailed{result.clients.failed ? `, ${result.clients.failed} email not configured` : ""}), {result.clients.skipped} already today
          <br />
          Payment reminders: {result.payments.sent + result.payments.failed} logged ({result.payments.sent} emailed{result.payments.failed ? `, ${result.payments.failed} email not configured` : ""}), {result.payments.skipped} already today
        </div>
      )}
    </div>
  );
}

export function CommunicationsPage() {
  const { user } = useAuth();
  const { clientId: globalClientId, setSelectedClient } = useSelectedClient();
  const canManage = user?.role === "admin" || user?.role === "staff";
  const roleHeader = ROLE_HEADER[user?.role || ""] || ROLE_HEADER.client;

  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState(globalClientId || "");
  const [comms, setComms] = useState<Communication[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<{ communications: Communication[] }>("/communications")
      .then((res) => setComms(res.communications))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load communications."));
  }

  useEffect(() => {
    load();
    if (canManage) api.get<{ clients: Client[] }>("/clients").then((res) => setClients(res.clients)).catch(() => {});
  }, [canManage]);

  function handleClientChange(id: string) {
    setClientId(id);
    setSelectedClient(id || null, clients.find((c) => c.client_id === id)?.client_name);
  }

  const client = clients.find((c) => c.client_id === clientId);
  const staffMessages = (comms || []).filter((c) => c.direction === "Staff to Staff");
  const clientMessages = (comms || []).filter((c) => c.client_id === clientId);

  return (
    <div>
      <div className="portal-banner" style={{ marginBottom: 16 }}>
        <div className="topbar-eyebrow">Communications</div>
        <h2>{roleHeader.title}</h2>
        <p>{roleHeader.note}</p>
      </div>

      {canManage && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <div className="field" style={{ maxWidth: 320, margin: 0 }}>
            <label htmlFor="comm-client">Client</label>
            <select id="comm-client" value={clientId} onChange={(e) => handleClientChange(e.target.value)}>
              <option value="">Select a client…</option>
              {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
            </select>
          </div>
          <RunRemindersButton onDone={load} />
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {canManage && <StaffMessages messages={staffMessages} onSent={load} />}

      {canManage && client && <ClientMessages client={client} messages={clientMessages} onSent={load} />}

      {!canManage && user && (
        <SelfMessages
          role={user.role}
          clientId={user.clientId || ""}
          clientEmail={user.email}
          messages={comms || []}
          onSent={load}
        />
      )}

      {canManage && !client && (
        <p className="muted">Pick a client above to send them a message, or use Firm Staff Messages above for internal notes.</p>
      )}
    </div>
  );
}

function StaffMessages({ messages, onSent }: { messages: Communication[]; onSent: () => void }) {
  const [staff, setStaff] = useState<StaffDirectoryEntry[]>([]);
  const [recipient, setRecipient] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("Firm staff message");
  const [channels, setChannels] = useState<string[]>(["Email"]);
  const [sendNow, setSendNow] = useState(true);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ channel: string; sent?: boolean; sendError?: string }[]>([]);

  useEffect(() => {
    api.get<{ staff: StaffDirectoryEntry[] }>("/communications/staff-directory").then((r) => setStaff(r.staff)).catch(() => {});
  }, []);

  function handleRecipientChange(email: string) {
    setRecipient(email);
    setPhone(staff.find((s) => s.email === email)?.phone || "");
  }

  function toggleChannel(c: string) {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (channels.length === 0) { setError("Choose at least one channel."); return; }
    setSaving(true);
    setError(null);
    setResults([]);
    try {
      const outcomes: { channel: string; sent?: boolean; sendError?: string }[] = [];
      for (const channel of channels) {
        const sentTo = ["SMS", "WhatsApp"].includes(channel) ? phone : undefined;
        const res = await api.post<{ sent?: boolean; sendError?: string }>("/communications/staff", { recipientEmail: recipient, subject, channel, messageEnglish: message, sendNow, sentTo });
        outcomes.push({ channel, sent: res.sent, sendError: res.sendError });
      }
      setResults(outcomes);
      setMessage("");
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send this message.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title="Firm Staff Messages" note={`${messages.length} staff message(s)`}>
      <p className="muted" style={{ padding: "0 16px 12px" }}>Internal firm-to-staff messages. Only active Admin/Staff portal users appear here; clients are excluded.</p>
      <form onSubmit={handleSubmit} style={{ padding: "0 16px 16px" }}>
        {error && <div className="error-banner">{error}</div>}
        <SendResults results={results} />
        <div className="field">
          <label>Staff / Manager / Admin</label>
          <select required value={recipient} onChange={(e) => handleRecipientChange(e.target.value)}>
            <option value="">Select a recipient…</option>
            {staff.map((s) => <option key={s.email} value={s.email}>{s.name} ({s.role})</option>)}
          </select>
        </div>
        <div className="field"><label>Subject</label><input required value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="field"><label>Message</label><textarea rows={3} required value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write the staff message or task update here." /></div>
        <ChannelCheckboxes selected={channels} onToggle={toggleChannel} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, margin: "4px 0 12px" }}>
          <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
          Send now (Email/SMS/WhatsApp attempt real delivery; Portal Note always just saves)
        </label>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Sending…" : "Send / Save Staff Message"}</button>
      </form>
      <div className="table-scroll card-table">
      <table>
        <thead><tr><th>Date/Time</th><th>Channel</th><th>Sent To</th><th>Subject</th><th>Status</th></tr></thead>
        <tbody>
          {messages.slice(0, 10).map((m) => (
            <tr key={m.communication_id}>
              <td>{m.sent_at ? new Date(m.sent_at).toLocaleString() : "—"}</td>
              <td className="muted" data-label="Channel">{m.channel}</td>
              <td className="muted" data-label="Sent To">{m.sent_to}</td>
              <td data-label="Subject">{m.subject}</td>
              <td className="muted" data-label="Status">{m.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {messages.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No firm-staff messages saved yet.</p>}
    </Panel>
  );
}

function ClientMessages({ client, messages, onSent }: { client: Client; messages: Communication[]; onSent: () => void }) {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [subject, setSubject] = useState("Client message");
  const [messageEnglish, setMessageEnglish] = useState("");
  const [messageArabic, setMessageArabic] = useState("");
  const [channels, setChannels] = useState<string[]>(["Email"]);
  const [phone, setPhone] = useState(client.phone || "");
  const [sendNow, setSendNow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ channel: string; sent?: boolean; sendError?: string }[]>([]);
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10),
    };
  });

  useEffect(() => {
    api.get<{ templates: TemplateRow[] }>("/templates").then((r) => setTemplates(r.templates)).catch(() => {});
  }, []);
  useEffect(() => { setPhone(client.phone || ""); }, [client.phone]);

  // One-time hand-off from Reports' Client Message tab ("Open Communications to Send"):
  // it stashes the already-computed period message here before navigating, keyed to
  // this client, so the composer opens pre-filled instead of asking staff to redo the merge.
  useEffect(() => {
    const key = `${CLIENT_MESSAGE_HANDOFF_KEY}:${client.client_id}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    sessionStorage.removeItem(key);
    try {
      const handoff = JSON.parse(raw) as { subject: string; body: string; periodStart: string; periodEnd: string };
      setSubject(handoff.subject);
      setMessageEnglish(handoff.body);
      setPeriod({ start: handoff.periodStart, end: handoff.periodEnd });
      setTemplateName("Client Tax and Payroll Update");
    } catch {
      // Malformed stash — ignore and leave the composer at its defaults.
    }
  }, [client.client_id]);

  async function applyTemplate(name: string, periodOverride?: { start: string; end: string }) {
    setTemplateName(name);
    if (!name) return;
    const p = periodOverride || period;
    try {
      const res = await api.get<{ template: TemplateDetail }>(
        `/templates/${encodeURIComponent(name)}?clientId=${encodeURIComponent(client.client_id)}&periodStart=${p.start}&periodEnd=${p.end}`
      );
      setSubject(res.template.subject || "");
      setMessageEnglish(res.template.message_english || "");
      setMessageArabic(res.template.message_arabic || "");
    } catch {
      // Template couldn't be loaded; leave existing draft as-is.
    }
  }

  function toggleChannel(c: string) {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function send(channelsOverride?: string[]) {
    const targetChannels = channelsOverride || channels;
    if (targetChannels.length === 0) { setError("Choose at least one channel."); return; }
    setSaving(true);
    setError(null);
    setResults([]);
    try {
      const outcomes: { channel: string; sent?: boolean; sendError?: string }[] = [];
      for (const channel of targetChannels) {
        const sentTo = ["SMS", "WhatsApp", "Phone"].includes(channel) ? (phone || undefined) : (client.email || undefined);
        const res = await api.post<{ sent?: boolean; sendError?: string }>("/communications", { clientId: client.client_id, subject, channel, messageEnglish, messageArabic, sentTo, sendNow: channel === "Portal Note" ? false : sendNow });
        outcomes.push({ channel, sent: res.sent, sendError: res.sendError });
      }
      setResults(outcomes);
      setMessageEnglish("");
      setMessageArabic("");
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this message.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await send();
  }

  return (
    <div className="compose-split" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
      <Panel title="Send / Save Client Message" note={client.email || undefined}>
        <form onSubmit={handleSubmit} style={{ padding: "0 16px 16px" }}>
          {error && <div className="error-banner">{error}</div>}
          <SendResults results={results} />
          <div className="field">
            <label>Template</label>
            <select value={templateName} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">Custom</option>
              {templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Period Start</label>
              <input type="date" value={period.start} onChange={(e) => { const next = { ...period, start: e.target.value }; setPeriod(next); if (templateName) applyTemplate(templateName, next); }} />
            </div>
            <div className="field">
              <label>Period End</label>
              <input type="date" value={period.end} onChange={(e) => { const next = { ...period, end: e.target.value }; setPeriod(next); if (templateName) applyTemplate(templateName, next); }} />
            </div>
          </div>
          <div className="form-grid">
            <div className="field"><label>Send To</label><input value={client.email || ""} readOnly /></div>
            <div className="field"><label>SMS / WhatsApp Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" /></div>
          </div>
          <div className="field"><label>Subject</label><input required value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="field"><label>English Message</label><textarea rows={3} value={messageEnglish} onChange={(e) => setMessageEnglish(e.target.value)} /></div>
          <div className="field"><label>Arabic Message</label><textarea rows={3} dir="rtl" value={messageArabic} onChange={(e) => setMessageArabic(e.target.value)} /></div>
          <ChannelCheckboxes selected={channels} onToggle={toggleChannel} />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, margin: "4px 0 12px" }}>
            <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
            Send now (Email/SMS/WhatsApp attempt real delivery; Portal Note always just saves)
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Sending…" : "Send / Save Client Message"}</button>
            <button type="button" className="btn" disabled={saving} onClick={() => send(["Portal Note"])}>Save Portal Note Only</button>
          </div>
        </form>
      </Panel>
      <Panel title="History" note={`${messages.length} messages`}>
        {messages.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No messages for this client yet.</p>}
        <div className="scroll-list" style={{ padding: messages.length ? "0 16px 16px" : 0 }}>
          {messages.map((m) => <CommunicationCard key={m.communication_id} c={m} />)}
        </div>
      </Panel>
    </div>
  );
}

/** Client/employee self-service composer — backend's POST /communications already allows any authenticated role (access enforced per-client), this was purely a missing frontend affordance. Direction is "Inbound" since the portal user is the one initiating contact with the firm. */
function SelfMessages({ role, clientId, clientEmail, messages, onSent }: { role: string; clientId: string; clientEmail: string; messages: Communication[]; onSent: () => void }) {
  const [subject, setSubject] = useState(role === "employee" ? "Payroll message" : "Message to AL TAX");
  const [messageEnglish, setMessageEnglish] = useState("");
  const [channels, setChannels] = useState<string[]>(["Portal Note"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleChannel(c: string) {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function send(channelsOverride?: string[]) {
    const targetChannels = channelsOverride || channels;
    if (!messageEnglish.trim()) { setError("Enter a message."); return; }
    if (targetChannels.length === 0) { setError("Choose at least one channel."); return; }
    if (!clientId) { setError("Your account isn't linked to a client record — contact AL TAX directly."); return; }
    setSaving(true);
    setError(null);
    try {
      for (const channel of targetChannels) {
        // sendNow is always false here — sentTo is the client's own address (for the log), and there is
        // no real "recipient" to notify: the firm reviews inbound messages from the portal, they aren't emailed to.
        await api.post("/communications", { clientId, subject, channel, messageEnglish, direction: "Inbound", sentTo: clientEmail, sendNow: false });
      }
      setMessageEnglish("");
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send this message.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await send();
  }

  return (
    <div className="compose-split" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
      <Panel title="Send Message to AL TAX">
        <form onSubmit={handleSubmit} style={{ padding: "0 16px 16px" }}>
          {error && <div className="error-banner">{error}</div>}
          <div className="field"><label>Subject</label><input required value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="field"><label>Message</label><textarea rows={4} required value={messageEnglish} onChange={(e) => setMessageEnglish(e.target.value)} placeholder={role === "employee" ? "Ask about your paystub, direct deposit, or account." : "Ask about documents, payments, or your account."} /></div>
          <ChannelCheckboxes selected={channels} onToggle={toggleChannel} />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Sending…" : "Send Message"}</button>
            <button type="button" className="btn" disabled={saving} onClick={() => send(["Portal Note"])}>Save Portal Note Only</button>
          </div>
        </form>
      </Panel>
      <Panel title="History" note={`${messages.length} messages`}>
        {messages.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No communications yet.</p>}
        <div className="scroll-list" style={{ padding: messages.length ? "0 16px 16px" : 0 }}>
          {messages.map((m) => <CommunicationCard key={m.communication_id} c={m} />)}
        </div>
      </Panel>
    </div>
  );
}

/** Shows one communication's date/subject/channel plus its message body, with an English/Arabic toggle when both exist. */
function CommunicationCard({ c }: { c: Communication }) {
  const hasEnglish = !!c.message_english;
  const hasArabic = !!c.message_arabic;
  const [lang, setLang] = useState<"english" | "arabic">(hasEnglish ? "english" : "arabic");
  const body = lang === "arabic" ? c.message_arabic : c.message_english;

  return (
    <div style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 4 }}>
        <div>
          <strong style={{ fontSize: 13 }}>{c.subject}</strong>
          <div className="muted" style={{ fontSize: 12 }}>{c.direction || "—"} · {c.channel} · {c.status} · {c.sent_at ? new Date(c.sent_at).toLocaleString() : "—"}</div>
        </div>
        {hasEnglish && hasArabic && (
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button type="button" className={`btn btn-sm ${lang === "english" ? "btn-primary" : ""}`} onClick={() => setLang("english")}>English</button>
            <button type="button" className={`btn btn-sm ${lang === "arabic" ? "btn-primary" : ""}`} onClick={() => setLang("arabic")}>العربية</button>
          </div>
        )}
      </div>
      {body && <div style={{ fontSize: 13, whiteSpace: "pre-wrap", direction: lang === "arabic" ? "rtl" : "ltr", textAlign: lang === "arabic" ? "right" : "left" }}>{body}</div>}
      {!body && <div className="muted" style={{ fontSize: 13 }}>No message text.</div>}
    </div>
  );
}
