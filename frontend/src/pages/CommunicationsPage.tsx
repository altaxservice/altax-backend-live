import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { Communication } from "../api/types2";
import type { Client } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useSelectedClient } from "../context/SelectedClientContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { FileDropInput } from "../components/FileDropInput";
import { fileToBase64, MAX_UPLOAD_BYTES } from "../utils/file";
import { PAYROLL_PROVIDERS } from "../utils/clientOptions";

/** Reads a File into the { filename, contentBase64, contentType } shape the communications endpoints accept. Email-only — attachments are dropped for SMS/WhatsApp server-side. */
async function fileToAttachment(file: File): Promise<{ filename: string; contentBase64: string; contentType?: string }> {
  return { filename: file.name, contentBase64: await fileToBase64(file), contentType: file.type || undefined };
}

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
function ChannelCheckboxes({ selected, onToggle, options = CHANNELS }: { selected: string[]; onToggle: (c: string) => void; options?: string[] }) {
  return (
    <div className="field">
      <label>Channels</label>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
        {options.map((c) => (
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

      {error && <ErrorBanner error={error} />}

      {canManage && <StaffMessages messages={staffMessages} onSent={load} />}

      {canManage && clients.length > 0 && <BulkClientMessage clients={clients} onSent={load} />}

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
  const [recipients, setRecipients] = useState<Set<string>>(new Set());
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("Firm staff message");
  const [channels, setChannels] = useState<string[]>(["Email"]);
  const [sendNow, setSendNow] = useState(true);
  const [message, setMessage] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ channel: string; sent?: boolean; sendError?: string }[]>([]);
  const [bulkResults, setBulkResults] = useState<{ name: string; channel: string; sent: boolean; skipped?: string; error?: string }[]>([]);
  const [viewingMsg, setViewingMsg] = useState<Communication | null>(null);

  useEffect(() => {
    api.get<{ staff: StaffDirectoryEntry[] }>("/communications/staff-directory").then((r) => setStaff(r.staff)).catch(() => {});
  }, []);

  function toggleRecipient(email: string) {
    setRecipients((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      // The manual phone override only makes sense for a single recipient.
      if (next.size === 1) setPhone(staff.find((s) => next.has(s.email))?.phone || "");
      return next;
    });
  }

  function toggleChannel(c: string) {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (recipients.size === 0) { setError("Select at least one staff recipient."); return; }
    if (channels.length === 0) { setError("Choose at least one channel."); return; }
    if (attachment && attachment.size > MAX_UPLOAD_BYTES) { setError(`That file is too large (${(attachment.size / 1024 / 1024).toFixed(1)}MB).`); return; }
    setSaving(true);
    setError(null);
    setResults([]);
    setBulkResults([]);
    try {
      const attachmentPayload = attachment ? await fileToAttachment(attachment) : undefined;
      if (recipients.size === 1) {
        // Single recipient keeps the original route so the manual phone override still works.
        const recipient = [...recipients][0];
        const outcomes: { channel: string; sent?: boolean; sendError?: string }[] = [];
        for (const channel of channels) {
          const sentTo = ["SMS", "WhatsApp"].includes(channel) ? phone : undefined;
          const res = await api.post<{ sent?: boolean; sendError?: string }>("/communications/staff", { recipientEmail: recipient, subject, channel, messageEnglish: message, sendNow, sentTo, attachment: attachmentPayload });
          outcomes.push({ channel, sent: res.sent, sendError: res.sendError });
        }
        setResults(outcomes);
      } else {
        const res = await api.post<{ results: { name: string; channel: string; sent: boolean; skipped?: string; error?: string }[] }>(
          "/communications/staff/bulk",
          { recipientEmails: [...recipients], subject, channels, messageEnglish: message, sendNow, attachment: attachmentPayload }
        );
        setBulkResults(res.results || []);
      }
      setMessage("");
      setAttachment(null);
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send this message.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title="Firm Staff Messages" note={`${messages.length} staff message(s)`}>
      <p className="muted" style={{ padding: "0 16px 12px" }}>Internal firm-to-staff messages. Only active Admin/Staff portal users appear here; clients are excluded. Pick one person or several — the same message goes to everyone selected.</p>
      <form onSubmit={handleSubmit} style={{ padding: "0 16px 16px" }}>
        {error && <ErrorBanner error={error} />}
        <SendResults results={results} />
        {bulkResults.length > 0 && (
          <div className="card" style={{ marginBottom: 12, fontSize: 13 }}>
            <strong>Sent to {bulkResults.filter((r) => r.sent).length} of {bulkResults.length}</strong>
            <div className="table-scroll" style={{ marginTop: 6 }}>
              <table>
                <tbody>
                  {bulkResults.map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td className="muted">{r.channel}</td>
                      <td className="muted">{r.sent ? "Sent" : r.skipped || r.error || "Saved"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="form-grid">
          <div className="field">
            <label>Recipients ({recipients.size} selected)</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
              <button type="button" className="btn btn-sm" onClick={() => setRecipients(new Set(staff.map((s) => s.email)))}>All staff ({staff.length})</button>
              <button type="button" className="btn btn-sm" onClick={() => setRecipients(new Set())}>Clear</button>
            </div>
            <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 8, maxHeight: 160, overflowY: "auto" }}>
              {staff.map((s) => (
                <label key={s.email} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 0" }}>
                  <input type="checkbox" checked={recipients.has(s.email)} onChange={() => toggleRecipient(s.email)} />
                  {s.name} <span className="muted" style={{ fontSize: 11 }}>({s.role})</span>
                </label>
              ))}
              {staff.length === 0 && <p className="muted" style={{ margin: 0 }}>No active staff users.</p>}
            </div>
          </div>
          {recipients.size === 1 && (
            <div className="field">
              <label>SMS / WhatsApp Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1XXXXXXXXXX — needed only for SMS/WhatsApp" />
            </div>
          )}
        </div>
        <div className="field"><label>Subject</label><input required value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="field"><label>Message</label><textarea rows={3} required value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write the staff message or task update here." /></div>
        <div className="field"><label>Add Attachment <span className="muted">(optional — Email only)</span></label><FileDropInput file={attachment} onChange={setAttachment} /></div>
        <ChannelCheckboxes selected={channels} onToggle={toggleChannel} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, margin: "4px 0 12px" }}>
          <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
          Send now (Email/SMS/WhatsApp attempt real delivery; Portal Note always just saves)
        </label>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Sending…" : "Send / Save Staff Message"}</button>
      </form>
      {viewingMsg && (
        <div className="card" style={{ margin: "0 16px 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div>
              <strong>{viewingMsg.subject}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {viewingMsg.channel} · to {viewingMsg.sent_to} · {viewingMsg.sent_at ? new Date(viewingMsg.sent_at).toLocaleString() : "—"} · {viewingMsg.status}
              </div>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => setViewingMsg(null)}>Close</button>
          </div>
          <p style={{ whiteSpace: "pre-wrap", fontSize: 13, margin: "10px 0 0" }}>{viewingMsg.message_english || "(no message text saved)"}</p>
        </div>
      )}
      <div className="table-scroll card-table">
      <table>
        <thead><tr><th>Date/Time</th><th>Channel</th><th>Sent To</th><th>Subject</th><th>Status</th></tr></thead>
        <tbody>
          {messages.slice(0, 10).map((m) => (
            <tr key={m.communication_id} style={{ cursor: "pointer" }} onClick={() => setViewingMsg(m)}>
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

const BULK_CHANNELS = ["Email", "SMS", "WhatsApp"];

interface BulkResult { clientId: string; clientName: string; channel: string; sent: boolean; skipped?: string; error?: string }

/**
 * Send the same message to many clients in one action. SMS/WhatsApp only reaches
 * clients with sms_allowed set and a phone on file; Email only reaches clients with
 * email_allowed set and an email on file — the backend (POST /communications/bulk)
 * enforces this per-client and reports back who was skipped and why, so a bulk send
 * can never silently blast someone who hasn't opted in.
 */
function BulkClientMessage({ clients, onSent }: { clients: Client[]; onSent: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [salesTaxFilter, setSalesTaxFilter] = useState("all");
  const [payrollFilter, setPayrollFilter] = useState("all");
  const [payrollProviderFilter, setPayrollProviderFilter] = useState("all");
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10),
    };
  });
  const [subject, setSubject] = useState("AL TAX SERVICE");
  const [messageEnglish, setMessageEnglish] = useState("");
  const [messageArabic, setMessageArabic] = useState("");
  const [channels, setChannels] = useState<string[]>(["Email"]);
  const [sendNow, setSendNow] = useState(true);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    api.get<{ templates: TemplateRow[] }>("/templates").then((r) => setTemplates(r.templates)).catch(() => {});
  }, []);

  // Bulk has no single client to resolve {{clientName}}/{{periodSummary}} against, so this
  // preview intentionally shows the raw template — literal {{tokens}} stay visible (see
  // substitutePlaceholders' fallback) as a signal they'll be personalized per recipient when
  // actually sent (POST /communications/bulk resolves them individually for each client).
  async function applyTemplate(name: string, periodOverride?: { start: string; end: string }) {
    setTemplateName(name);
    if (!name) return;
    const p = periodOverride || period;
    try {
      const res = await api.get<{ template: TemplateDetail }>(
        `/templates/${encodeURIComponent(name)}?periodStart=${p.start}&periodEnd=${p.end}`
      );
      setSubject(res.template.subject || "");
      setMessageEnglish(res.template.message_english || "");
      setMessageArabic(res.template.message_arabic || "");
    } catch {
      // Template couldn't be loaded; leave existing draft as-is.
    }
  }

  // Same group-category filters as Create Batch Tasks (status/sales tax/payroll/payroll
  // provider) so a bulk message can target "everyone Quarterly on Sales Tax" or "all
  // Active payroll clients" the same way batch task creation already lets staff group
  // clients by rule-relevant attributes, instead of hand-picking names one at a time.
  const salesTaxOptions = useMemo(() => Array.from(new Set(clients.map((c) => c.sales_tax_frequency).filter(Boolean))) as string[], [clients]);
  const payrollOptions = useMemo(() => Array.from(new Set(clients.map((c) => c.payroll_frequency).filter(Boolean))) as string[], [clients]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = clients.filter((c) => {
      if (statusFilter !== "all" && String(c.status || "") !== statusFilter) return false;
      if (salesTaxFilter !== "all" && String(c.sales_tax_frequency || "") !== salesTaxFilter) return false;
      if (payrollFilter !== "all" && String(c.payroll_frequency || "") !== payrollFilter) return false;
      if (payrollProviderFilter !== "all" && String(c.payroll_system || "") !== payrollProviderFilter) return false;
      if (q && !c.client_name.toLowerCase().includes(q)) return false;
      return true;
    });
    // Selected clients float to the top (stable sort keeps alphabetical order within each
    // group) so a staff member reviewing a large selection doesn't have to hunt through an
    // alphabetical list to confirm who's checked — same pattern as Create Batch Tasks.
    return [...matches].sort((a, b) => Number(selected.has(b.client_id)) - Number(selected.has(a.client_id)));
  }, [clients, search, statusFilter, salesTaxFilter, payrollFilter, payrollProviderFilter, selected]);
  const smsOptedIn = filtered.filter((c) => c.sms_allowed && c.phone);
  const emailOptedIn = filtered.filter((c) => c.email_allowed && c.email);

  function toggleClient(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleChannel(c: string) {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (selected.size === 0) { setError("Select at least one client."); return; }
    if (channels.length === 0) { setError("Choose at least one channel."); return; }
    if (!messageEnglish.trim() && !messageArabic.trim()) { setError("Enter a message."); return; }
    if (attachment && attachment.size > MAX_UPLOAD_BYTES) { setError(`That file is too large (${(attachment.size / 1024 / 1024).toFixed(1)}MB).`); return; }
    setSaving(true);
    setError(null);
    setResults(null);
    try {
      const res = await api.post<{ results: BulkResult[] }>("/communications/bulk", {
        clientIds: Array.from(selected), subject, messageEnglish, messageArabic, channels, sendNow,
        templateName: templateName || undefined, periodStart: period.start, periodEnd: period.end,
        attachment: attachment ? await fileToAttachment(attachment) : undefined,
      });
      setResults(res.results);
      setMessageEnglish("");
      setMessageArabic("");
      setAttachment(null);
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send this bulk message.");
    } finally {
      setSaving(false);
    }
  }

  const sentCount = results?.filter((r) => r.sent).length || 0;
  const skippedCount = results?.filter((r) => r.skipped).length || 0;
  const failedCount = results ? results.length - sentCount - skippedCount : 0;

  return (
    <Panel title="Bulk Client Message" note="Send one message to many clients at once — SMS/Email only reach clients who've opted in.">
      <form onSubmit={handleSubmit} style={{ padding: "0 16px 16px" }}>
        {error && <ErrorBanner error={error} />}
        {results && (
          <div className="card" style={{ marginBottom: 12, fontSize: 12, padding: 10 }}>
            <div><strong>{sentCount}</strong> sent &middot; <strong>{skippedCount}</strong> skipped (no consent or contact info) &middot; <strong>{failedCount}</strong> failed</div>
            <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setShowDetails((s) => !s)}>
              {showDetails ? "Hide details" : "Show details"}
            </button>
            {showDetails && (
              <div className="table-scroll" style={{ marginTop: 8 }}>
                <table>
                  <thead><tr><th>Client</th><th>Channel</th><th>Result</th></tr></thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={i}>
                        <td data-label="Client">{r.clientName}</td>
                        <td className="muted" data-label="Channel">{r.channel}</td>
                        <td className="muted" data-label="Result">{r.sent ? "Sent" : r.skipped || r.error || "Saved"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="field">
          <label>Recipients ({selected.size} selected)</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setSelected(new Set()); }} style={{ maxWidth: 150 }}>
              <option value="all">Any status</option>
              {[...new Set(clients.map((c) => String(c.status || "")).filter(Boolean))].sort().map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={salesTaxFilter} onChange={(e) => { setSalesTaxFilter(e.target.value); setSelected(new Set()); }} style={{ maxWidth: 170 }}>
              <option value="all">Any sales tax freq.</option>
              {salesTaxOptions.map((s) => <option key={s} value={s}>Sales tax: {s}</option>)}
            </select>
            <select value={payrollFilter} onChange={(e) => { setPayrollFilter(e.target.value); setSelected(new Set()); }} style={{ maxWidth: 170 }}>
              <option value="all">Any payroll freq.</option>
              {payrollOptions.map((s) => <option key={s} value={s}>Payroll: {s}</option>)}
            </select>
            <select value={payrollProviderFilter} onChange={(e) => { setPayrollProviderFilter(e.target.value); setSelected(new Set()); }} style={{ maxWidth: 170 }}>
              <option value="all">Any payroll provider</option>
              {PAYROLL_PROVIDERS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients…" style={{ marginBottom: 6 }} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set(filtered.map((c) => c.client_id)))}>Select shown ({filtered.length})</button>
            <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set(smsOptedIn.map((c) => c.client_id)))}>SMS opted-in ({smsOptedIn.length})</button>
            <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set(emailOptedIn.map((c) => c.client_id)))}>Email opted-in ({emailOptedIn.length})</button>
            <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 6, padding: 8 }}>
            {filtered.map((c) => (
              <label key={c.client_id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 0" }}>
                <input type="checkbox" checked={selected.has(c.client_id)} onChange={() => toggleClient(c.client_id)} />
                {c.client_name}
                <span className="muted" style={{ fontSize: 11 }}>{c.sms_allowed ? "· SMS ok" : ""}{c.email_allowed ? "· Email ok" : ""}</span>
              </label>
            ))}
            {filtered.length === 0 && <p className="muted" style={{ margin: 0 }}>No clients match.</p>}
          </div>
        </div>

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
        <div className="field"><label>Subject</label><input required value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="field">
          <label>English Message</label>
          <textarea rows={3} value={messageEnglish} onChange={(e) => setMessageEnglish(e.target.value)} />
          <span className="muted" style={{ fontSize: 11 }}>Tokens like {"{{clientName}}"} and {"{{periodSummary}}"} are personalized per client when sent — they stay literal here in the preview.</span>
        </div>
        <div className="field"><label>Arabic Message</label><textarea rows={3} dir="rtl" value={messageArabic} onChange={(e) => setMessageArabic(e.target.value)} /></div>
        <div className="field"><label>Add Attachment <span className="muted">(optional — Email only)</span></label><FileDropInput file={attachment} onChange={setAttachment} /></div>
        <ChannelCheckboxes selected={channels} onToggle={toggleChannel} options={BULK_CHANNELS} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, margin: "4px 0 12px" }}>
          <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
          Send now (attempts real delivery to every selected, opted-in client)
        </label>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? `Sending to ${selected.size}…` : `Send to ${selected.size} Client(s)`}</button>
      </form>
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
  const [attachment, setAttachment] = useState<File | null>(null);
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
      const handoff = JSON.parse(raw) as { subject: string; body: string; bodyArabic?: string; periodStart: string; periodEnd: string };
      setSubject(handoff.subject);
      setMessageEnglish(handoff.body);
      setMessageArabic(handoff.bodyArabic || "");
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
    if (attachment && attachment.size > MAX_UPLOAD_BYTES) { setError(`That file is too large (${(attachment.size / 1024 / 1024).toFixed(1)}MB).`); return; }
    setSaving(true);
    setError(null);
    setResults([]);
    try {
      const attachmentPayload = attachment ? await fileToAttachment(attachment) : undefined;
      const outcomes: { channel: string; sent?: boolean; sendError?: string }[] = [];
      for (const channel of targetChannels) {
        const sentTo = ["SMS", "WhatsApp", "Phone"].includes(channel) ? (phone || undefined) : (client.email || undefined);
        const res = await api.post<{ sent?: boolean; sendError?: string }>("/communications", { clientId: client.client_id, subject, channel, messageEnglish, messageArabic, sentTo, sendNow: channel === "Portal Note" ? false : sendNow, attachment: attachmentPayload });
        outcomes.push({ channel, sent: res.sent, sendError: res.sendError });
      }
      setResults(outcomes);
      setMessageEnglish("");
      setMessageArabic("");
      setAttachment(null);
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
          {error && <ErrorBanner error={error} />}
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
          <div className="field"><label>Add Attachment <span className="muted">(optional — Email only)</span></label><FileDropInput file={attachment} onChange={setAttachment} /></div>
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
          {error && <ErrorBanner error={error} />}
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
