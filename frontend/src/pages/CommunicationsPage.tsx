import { useEffect, useMemo, useState, type FormEvent } from "react";
import { RefreshCw, Download } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { Communication } from "../api/types2";
import type { Client } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useLanguage, Num } from "../context/LanguageContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { exportCsv } from "../components/FilterBar";
import { FileDropInput } from "../components/FileDropInput";
import { fileToBase64, MAX_UPLOAD_BYTES } from "../utils/file";
import { PAYROLL_PROVIDERS } from "../utils/clientOptions";
import { useResizableWidth } from "../hooks/useResizableWidth";

/**
 * Every composer on this page now uses explicit "Save and Close" / "Save and
 * Send" submit buttons (matching the same pattern already used for filing/
 * payment confirmations in ClientAtAGlance) instead of a "Send now" checkbox
 * paired with one ambiguous button — reads which button was actually clicked
 * off the submit event's submitter, so the form keeps native required-field
 * validation instead of switching every button to type="button".
 */
function submitAction(e: FormEvent<HTMLFormElement>): string | undefined {
  return ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.dataset.action;
}

/** Reads a File into the { filename, contentBase64, contentType } shape the communications endpoints accept. Email-only — attachments are dropped for SMS/WhatsApp server-side. */
async function fileToAttachment(file: File): Promise<{ filename: string; contentBase64: string; contentType?: string }> {
  return { filename: file.name, contentBase64: await fileToBase64(file), contentType: file.type || undefined };
}

/** Lightweight section divider inside the compose form — same uppercase-label convention used elsewhere this session (RuleDetailPage) so a dense form reads as grouped sections instead of one flat list of fields. */
const sectionHeadingStyle: React.CSSProperties = {
  fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--muted)", fontWeight: 700,
  margin: "20px 0 8px", paddingTop: 12, borderTop: "1px solid var(--line)",
};

/** The current calendar quarter's [start, end] as YYYY-MM-DD — same "quick-range" convenience the Form 941/MD UI obligation tabs already use, so composing a real quarterly report doesn't mean hand-typing three months of dates. Exported for ReportsPage's equivalent date picker. */
export function thisQuarterRange(): { start: string; end: string } {
  const now = new Date();
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
  const start = new Date(now.getFullYear(), quarterStartMonth, 1);
  const end = new Date(now.getFullYear(), quarterStartMonth + 3, 0);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** Mirrors REPORT_TEMPLATE_NAMES in communications.routes.ts — these auto-attach a real PDF server-side even with no file manually chosen, so the frontend needs to know which templates that applies to (e.g. to show the "sensitive document" option). */
const REPORT_TEMPLATE_NAMES = new Set(["Client Tax and Payroll Update", "Payroll Summary", "Sales Tax Summary"]);

interface StaffDirectoryEntry { name: string; email: string; phone: string | null; role: string }
interface TemplateRow { templateId: string | null; name: string; category: string; subject: string; source: string }
interface TemplateDetail { subject: string; message_english: string | null; message_arabic: string | null }

/** Fixed reading order for the grouped template dropdown — Reports first (the ones staff reach for most), General last (catch-all). Any category not in this list (e.g. a custom override with its own category) falls in after, alphabetically. */
const TEMPLATE_CATEGORY_ORDER = ["Reports", "Appointments", "Reminders & Notices", "Requests & Questions", "General"];

/** Groups templates into <optgroup>s in a fixed reading order instead of one flat 30-item list — same options, same values, just organized. */
function TemplateOptions({ templates }: { templates: TemplateRow[] }) {
  const byCategory = new Map<string, TemplateRow[]>();
  for (const t of templates) {
    const list = byCategory.get(t.category) || [];
    list.push(t);
    byCategory.set(t.category, list);
  }
  const orderedCategories = [
    ...TEMPLATE_CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...Array.from(byCategory.keys()).filter((c) => !TEMPLATE_CATEGORY_ORDER.includes(c)).sort(),
  ];
  return (
    <>
      {orderedCategories.map((category) => (
        <optgroup key={category} label={category}>
          {byCategory.get(category)!.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
        </optgroup>
      ))}
    </>
  );
}

// SMS/WhatsApp are wired end-to-end in the backend but not connected — no Twilio
// credentials configured — so picking either here would just fail with a "not
// connected" error every time. Left out of every channel picker below rather than
// offered as a choice that doesn't actually work; re-add once Twilio is live.
const CHANNELS = ["Email", "Phone", "Portal Note"];

/** sessionStorage key prefix (suffixed with `:${clientId}`) Reports' Client Message tab uses to hand off a computed period message to this page's composer — see ClientMessages' mount effect below. */
export const CLIENT_MESSAGE_HANDOFF_KEY = "altax_client_message_handoff";

const ROLE_HEADER: Record<string, { title: string; note: string }> = {
  admin: { title: "Firm Communication Center", note: "Send and log client messages, staff notes, and reminders from one controlled history." },
  staff: { title: "Staff Message Center", note: "Send and log client messages and staff notes for the clients you work with." },
  client: { title: "Client Message Center", note: "Message AL TAX directly and review your message history." },
  employee: { title: "Employee Message Center", note: "Message AL TAX about your pay or account and review your message history." },
};

/** `resize` is optional — when omitted, Panel behaves exactly as before (fixed-width card in whatever layout its parent uses). When passed, the panel becomes an independently draggable-width `.resizable-card`, matching the pattern already used for the client Profile/edit-form cards (ClientDetailPage.tsx). */
function Panel({ title, note, action, children, resize }: {
  title: React.ReactNode; note?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode;
  resize?: { width: number; resizing: boolean; onResizeStart: (e: React.MouseEvent) => void };
}) {
  return (
    <div
      className={`command-panel${resize ? " resizable-card" : ""}`}
      style={{ marginBottom: 20, ...(resize ? { width: resize.width, maxWidth: "100%" } : {}) }}
    >
      {resize && (
        <div
          className={`resizable-card-handle ${resize.resizing ? "dragging" : ""}`}
          onMouseDown={resize.onResizeStart}
          title="Drag to resize"
        />
      )}
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
  const { t, dir } = useLanguage();
  const canManage = user?.role === "admin" || user?.role === "staff";
  const roleHeader = user?.role === "employee"
    ? { title: t("communications.employee.title"), note: t("communications.employee.note") }
    : user?.role === "client"
      ? { title: t("communications.client.title"), note: t("communications.client.note") }
      : (ROLE_HEADER[user?.role || ""] || ROLE_HEADER.client);

  const [clients, setClients] = useState<Client[]>([]);
  const [comms, setComms] = useState<Communication[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Messaging one specific client now lives on that client's own profile
  // (Communications tab), same move already made for Documents — this page
  // is left with only the genuinely firm-wide tools: bulk client blasts and
  // internal staff notes.
  const [activeTab, setActiveTab] = useState<"bulk" | "staff">("bulk");

  function load(): Promise<void> {
    return api.get<{ communications: Communication[] }>("/communications")
      .then((res) => setComms(res.communications))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load communications."));
  }

  useEffect(() => {
    load();
    if (canManage) api.get<{ clients: Client[] }>("/clients").then((res) => setClients(res.clients)).catch(() => {});
  }, [canManage]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  const staffMessages = (comms || []).filter((c) => c.direction === "Staff to Staff");

  function handleExportStaffCsv() {
    exportCsv(
      "staff-messages.csv",
      [
        { key: "sent_at", label: "Date/Time" }, { key: "channel", label: "Channel" },
        { key: "sent_to", label: "Sent To" }, { key: "subject", label: "Subject" }, { key: "status", label: "Status" },
      ],
      staffMessages as unknown as Record<string, unknown>[]
    );
  }

  const TABS: { key: typeof activeTab; label: string }[] = [
    { key: "bulk", label: "Bulk Client Message" },
    { key: "staff", label: "Staff Messages" },
  ];

  return (
    <div dir={dir}>
      <div className="portal-banner" style={{ marginBottom: 16 }}>
        <div className="topbar-eyebrow">{canManage ? "Communications" : t("communications.eyebrow")}</div>
        <h2>{roleHeader.title}</h2>
        <p>{roleHeader.note}</p>
      </div>

      {canManage && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <div className="no-print" role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)" }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={activeTab === t.key}
                onClick={() => setActiveTab(t.key)}
                style={{
                  padding: "10px 16px", fontSize: 14, fontWeight: 500, cursor: "pointer", border: "none", font: "inherit", background: "transparent",
                  color: activeTab === t.key ? "var(--ink)" : "var(--muted)",
                  borderBottom: activeTab === t.key ? "2px solid var(--teal)" : "2px solid transparent",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" className="ghost-button" disabled={refreshing} onClick={handleRefresh}><RefreshCw size={13} strokeWidth={2} aria-hidden="true" className={refreshing ? "icon-spin" : undefined} />{refreshing ? "Refreshing…" : "Refresh"}</button>
            <button type="button" className="ghost-button" onClick={handleExportStaffCsv}><Download size={13} strokeWidth={2} aria-hidden="true" />Export CSV</button>
            <RunRemindersButton onDone={load} />
          </div>
        </div>
      )}

      {canManage && (
        <p className="muted" style={{ fontSize: 12, margin: "-8px 0 16px" }}>
          Looking to message one specific client? Open their profile and use its Communications tab.
        </p>
      )}

      {error && <ErrorBanner error={error} />}

      {comms === null && !error && <div className="spinner-wrap">Loading…</div>}

      {comms !== null && canManage && activeTab === "staff" && <StaffMessages messages={staffMessages} onSent={load} />}

      {canManage && activeTab === "bulk" && clients.length > 0 && <BulkClientMessage clients={clients} onSent={load} />}

      {comms !== null && !canManage && user && (
        <SelfMessages
          role={user.role}
          clientId={user.clientId || ""}
          clientEmail={user.email}
          messages={comms}
          onSent={load}
        />
      )}
    </div>
  );
}

function StaffMessages({ messages, onSent }: { messages: Communication[]; onSent: () => void }) {
  const [staff, setStaff] = useState<StaffDirectoryEntry[]>([]);
  const [recipients, setRecipients] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState("Firm staff message");
  const [channels, setChannels] = useState<string[]>(["Email"]);
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
      return next;
    });
  }

  function toggleChannel(c: string) {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const sendNow = submitAction(e) !== "close";
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
        const recipient = [...recipients][0];
        const outcomes: { channel: string; sent?: boolean; sendError?: string }[] = [];
        for (const channel of channels) {
          const res = await api.post<{ sent?: boolean; sendError?: string }>("/communications/staff", { recipientEmail: recipient, subject, channel, messageEnglish: message, sendNow, attachment: attachmentPayload });
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
        </div>
        <div className="field"><label htmlFor="comm-staff-subject">Subject</label><input id="comm-staff-subject" required value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="field"><label htmlFor="comm-staff-message">Message</label><textarea id="comm-staff-message" rows={3} required value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write the staff message or task update here." /></div>
        <div className="field"><label>Add Attachment <span className="muted">(optional — Email only)</span></label><FileDropInput file={attachment} onChange={setAttachment} /></div>
        <ChannelCheckboxes selected={channels} onToggle={toggleChannel} />
        <p className="muted" style={{ fontSize: 11, margin: "4px 0 12px" }}>Save and Send attempts real delivery on Email; Phone and Portal Note always just save a log entry either way.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" data-action="close" className="btn" disabled={saving}>{saving ? "Saving…" : "Save and Close"}</button>
          <button type="submit" data-action="send" className="btn btn-primary" disabled={saving}>{saving ? "Sending…" : "Save and Send"}</button>
        </div>
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
        <thead><tr><th scope="col">Date/Time</th><th scope="col">Channel</th><th scope="col">Sent To</th><th scope="col">Subject</th><th scope="col">Status</th></tr></thead>
        <tbody>
          {messages.slice(0, 10).map((m) => (
            <tr key={m.communication_id} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => setViewingMsg(m)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setViewingMsg(m); } }}>
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

const BULK_CHANNELS = ["Email", "SMS"];

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
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sensitiveAttachment, setSensitiveAttachment] = useState(false);
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

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const sendNow = submitAction(e) !== "close";
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
        sensitiveAttachment,
      });
      setResults(res.results);
      setMessageEnglish("");
      setMessageArabic("");
      setAttachment(null);
      setSensitiveAttachment(false);
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
    <Panel title="Bulk Client Message" note="Send one message to many clients at once — each channel only reaches clients who've opted in to it.">
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
                  <thead><tr><th scope="col">Client</th><th scope="col">Channel</th><th scope="col">Result</th></tr></thead>
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
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setSelected(new Set()); }} style={{ minWidth: 140, maxWidth: 200 }}>
              <option value="all">Any status</option>
              {[...new Set(clients.map((c) => String(c.status || "")).filter(Boolean))].sort().map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={salesTaxFilter} onChange={(e) => { setSalesTaxFilter(e.target.value); setSelected(new Set()); }} style={{ minWidth: 190, maxWidth: 240 }}>
              <option value="all">Any sales tax frequency</option>
              {salesTaxOptions.map((s) => <option key={s} value={s}>Sales tax: {s}</option>)}
            </select>
            <select value={payrollFilter} onChange={(e) => { setPayrollFilter(e.target.value); setSelected(new Set()); }} style={{ minWidth: 190, maxWidth: 240 }}>
              <option value="all">Any payroll frequency</option>
              {payrollOptions.map((s) => <option key={s} value={s}>Payroll: {s}</option>)}
            </select>
            <select value={payrollProviderFilter} onChange={(e) => { setPayrollProviderFilter(e.target.value); setSelected(new Set()); }} style={{ minWidth: 190, maxWidth: 240 }}>
              <option value="all">Any payroll provider</option>
              {PAYROLL_PROVIDERS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients…" style={{ marginBottom: 6 }} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set(filtered.map((c) => c.client_id)))}>Select shown ({filtered.length})</button>
            <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set(emailOptedIn.map((c) => c.client_id)))}>Email opted-in ({emailOptedIn.length})</button>
            <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 6, padding: 8 }}>
            {filtered.map((c) => (
              <label key={c.client_id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 0" }}>
                <input type="checkbox" checked={selected.has(c.client_id)} onChange={() => toggleClient(c.client_id)} />
                {c.client_name}
                <span className="muted" style={{ fontSize: 11 }}>{c.email_allowed ? "· Email ok" : ""}</span>
              </label>
            ))}
            {filtered.length === 0 && <p className="muted" style={{ margin: 0 }}>No clients match.</p>}
          </div>
        </div>

        <div className="field">
          <label htmlFor="bulk-template">Template</label>
          <select id="bulk-template" value={templateName} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">Custom</option>
            <TemplateOptions templates={templates} />
          </select>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="bulk-period-start">Period Start</label>
            <input id="bulk-period-start" type="date" value={period.start} onChange={(e) => { const next = { ...period, start: e.target.value }; setPeriod(next); if (templateName) applyTemplate(templateName, next); }} />
          </div>
          <div className="field">
            <label htmlFor="bulk-period-end">Period End</label>
            <input id="bulk-period-end" type="date" value={period.end} onChange={(e) => { const next = { ...period, end: e.target.value }; setPeriod(next); if (templateName) applyTemplate(templateName, next); }} />
          </div>
        </div>
        <div className="field"><label htmlFor="bulk-subject">Subject</label><input id="bulk-subject" required value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="field">
          <label htmlFor="bulk-message-english">English Message</label>
          <textarea id="bulk-message-english" rows={3} value={messageEnglish} onChange={(e) => setMessageEnglish(e.target.value)} />
          <span className="muted" style={{ fontSize: 11 }}>Tokens like {"{{clientName}}"} and {"{{periodSummary}}"} are personalized per client when sent — they stay literal here in the preview.</span>
        </div>
        <div className="field"><label htmlFor="bulk-message-arabic">Arabic Message</label><textarea id="bulk-message-arabic" rows={3} dir="rtl" value={messageArabic} onChange={(e) => setMessageArabic(e.target.value)} /></div>
        <div className="field"><label>Add Attachment <span className="muted">(optional — Email only)</span></label><FileDropInput file={attachment} onChange={setAttachment} /></div>
        {(attachment || REPORT_TEMPLATE_NAMES.has(templateName)) && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, margin: "0 0 12px" }}>
            <input type="checkbox" checked={sensitiveAttachment} onChange={(e) => setSensitiveAttachment(e.target.checked)} />
            Sensitive document — on SMS/WhatsApp, only offer the client-portal login, not a direct download link
          </label>
        )}
        <ChannelCheckboxes selected={channels} onToggle={toggleChannel} options={BULK_CHANNELS} />
        <p className="muted" style={{ fontSize: 11, margin: "4px 0 12px" }}>Save and Send attempts real delivery to every selected, opted-in client; Save and Close just logs the message.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" data-action="close" className="btn" disabled={saving}>{saving ? "Saving…" : `Save and Close (${selected.size})`}</button>
          <button type="submit" data-action="send" className="btn btn-primary" disabled={saving}>{saving ? `Sending to ${selected.size}…` : `Save and Send (${selected.size})`}</button>
        </div>
      </form>
    </Panel>
  );
}

export function ClientMessages({ client, messages, onSent }: { client: Client; messages: Communication[]; onSent: () => void }) {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [subject, setSubject] = useState("Client message");
  const [messageEnglish, setMessageEnglish] = useState("");
  const [messageArabic, setMessageArabic] = useState("");
  const [channels, setChannels] = useState<string[]>(["Email"]);
  const [phone, setPhone] = useState(client.phone || "");
  // Businesses with more than one owner/contact carry a second email/phone
  // (company_contact_email/phone, shown as "Owner Email/Phone" on the client
  // profile) — previously only used by a few PDF/tax-form flows, never by an
  // actual send. This lets staff pick it as the send target instead of only
  // ever reaching the primary contact on file.
  const [sendToEmail, setSendToEmail] = useState(client.email || "");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sensitiveAttachment, setSensitiveAttachment] = useState(false);
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
  const composeResize = useResizableWidth({ storageKey: "altax_comms_compose_width", defaultWidth: 560, min: 380, max: 900 });
  const historyResize = useResizableWidth({ storageKey: "altax_comms_history_width", defaultWidth: 480, min: 320, max: 900 });

  useEffect(() => {
    api.get<{ templates: TemplateRow[] }>("/templates").then((r) => setTemplates(r.templates)).catch(() => {});
  }, []);
  useEffect(() => { setPhone(client.phone || ""); }, [client.phone]);
  useEffect(() => { setSendToEmail(client.email || ""); }, [client.email]);

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

  async function send(sendNow: boolean, channelsOverride?: string[]) {
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
        const sentTo = ["SMS", "WhatsApp", "Phone"].includes(channel) ? (phone || undefined) : (sendToEmail || undefined);
        const res = await api.post<{ sent?: boolean; sendError?: string }>("/communications", {
          clientId: client.client_id, subject, channel, messageEnglish, messageArabic, sentTo, sendNow: channel === "Portal Note" ? false : sendNow, attachment: attachmentPayload,
          // Lets the backend auto-generate and attach the real PDF for the three
          // report templates when no file was manually chosen — see
          // generateAutoReportAttachment in communications.routes.ts.
          templateName: templateName || undefined, periodStart: period.start, periodEnd: period.end,
          sensitiveAttachment,
        });
        outcomes.push({ channel, sent: res.sent, sendError: res.sendError });
      }
      setResults(outcomes);
      setMessageEnglish("");
      setMessageArabic("");
      setAttachment(null);
      setSensitiveAttachment(false);
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this message.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const action = submitAction(e);
    if (action === "portal-note") await send(false, ["Portal Note"]);
    else await send(action !== "close");
  }

  return (
    <div className="compose-split" style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      <Panel
        title="Send / Save Client Message" note={sendToEmail || undefined}
        resize={{ width: composeResize.width, resizing: composeResize.resizing, onResizeStart: composeResize.startResize }}
      >
        <form onSubmit={handleSubmit} style={{ padding: "0 16px 16px" }}>
          {error && <ErrorBanner error={error} />}
          <SendResults results={results} />
          <div style={sectionHeadingStyle}>Message</div>
          <div className="field">
            <label htmlFor="cm-template">Template</label>
            <select id="cm-template" value={templateName} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">Custom</option>
              <TemplateOptions templates={templates} />
            </select>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="cm-period-start">Period Start</label>
              <input id="cm-period-start" type="date" value={period.start} onChange={(e) => { const next = { ...period, start: e.target.value }; setPeriod(next); if (templateName) applyTemplate(templateName, next); }} />
            </div>
            <div className="field">
              <label htmlFor="cm-period-end">Period End</label>
              <input id="cm-period-end" type="date" value={period.end} onChange={(e) => { const next = { ...period, end: e.target.value }; setPeriod(next); if (templateName) applyTemplate(templateName, next); }} />
            </div>
          </div>
          <button
            type="button" className="link-button" style={{ fontSize: 12, margin: "-6px 0 12px" }}
            onClick={() => { const next = thisQuarterRange(); setPeriod(next); if (templateName) applyTemplate(templateName, next); }}
          >
            Use this quarter
          </button>

          <div style={sectionHeadingStyle}>Recipient</div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="cm-send-to">Send To (Email)</label>
              {client.company_contact_email ? (
                <select id="cm-send-to" value={sendToEmail} onChange={(e) => setSendToEmail(e.target.value)}>
                  {client.email && <option value={client.email}>{client.email} (primary)</option>}
                  <option value={client.company_contact_email}>{client.company_contact_email} ({client.company_contact_name || "Owner"})</option>
                </select>
              ) : (
                <input id="cm-send-to" value={sendToEmail} readOnly />
              )}
            </div>
            <div className="field">
              <label htmlFor="cm-phone">Phone Number <span className="muted">(for SMS/WhatsApp/Phone)</span></label>
              <input id="cm-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" />
              {client.company_contact_phone && client.company_contact_phone !== phone && (
                <button type="button" className="link-button" style={{ fontSize: 12, marginTop: 4 }} onClick={() => setPhone(client.company_contact_phone || "")}>
                  Use {client.company_contact_name || "owner"}'s phone ({client.company_contact_phone})
                </button>
              )}
            </div>
          </div>

          <div style={sectionHeadingStyle}>Content</div>
          <div className="field"><label htmlFor="cm-subject">Subject</label><input id="cm-subject" required value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="field"><label htmlFor="cm-message-english">English Message</label><textarea id="cm-message-english" rows={3} value={messageEnglish} onChange={(e) => setMessageEnglish(e.target.value)} /></div>
          <div className="field"><label htmlFor="cm-message-arabic">Arabic Message</label><textarea id="cm-message-arabic" rows={3} dir="rtl" value={messageArabic} onChange={(e) => setMessageArabic(e.target.value)} /></div>

          <div style={sectionHeadingStyle}>Delivery</div>
          <div className="field"><label>Add Attachment <span className="muted">(optional — Email only)</span></label><FileDropInput file={attachment} onChange={setAttachment} /></div>
          {(attachment || REPORT_TEMPLATE_NAMES.has(templateName)) && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, margin: "0 0 12px" }}>
              <input type="checkbox" checked={sensitiveAttachment} onChange={(e) => setSensitiveAttachment(e.target.checked)} />
              Sensitive document — on SMS/WhatsApp, only offer the client-portal login, not a direct download link
            </label>
          )}
          <ChannelCheckboxes selected={channels} onToggle={toggleChannel} />
          <p className="muted" style={{ fontSize: 11, margin: "4px 0 12px" }}>Save and Send attempts real delivery on Email; Phone and Portal Note always just save a log entry either way.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="submit" data-action="close" className="btn" disabled={saving}>{saving ? "Saving…" : "Save and Close"}</button>
            <button type="submit" data-action="send" className="btn btn-primary" disabled={saving}>{saving ? "Sending…" : "Save and Send"}</button>
            <button type="submit" data-action="portal-note" className="btn" disabled={saving}>Save Portal Note Only</button>
          </div>
        </form>
      </Panel>
      <Panel
        title="History" note={`${messages.length} messages`}
        resize={{ width: historyResize.width, resizing: historyResize.resizing, onResizeStart: historyResize.startResize }}
      >
        {messages.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No messages for this client yet.</p>}
        <div className="scroll-list" style={{ padding: messages.length ? "0 16px 16px" : 0 }}>
          {messages.map((m) => <CommunicationCard key={m.communication_id} c={m} />)}
        </div>
      </Panel>
    </div>
  );
}

/** Client/employee self-service composer — backend's POST /communications already allows any authenticated role (access enforced per-client), this was purely a missing frontend affordance. Direction is "Inbound" since the portal user is the one initiating contact with the firm. */
/** Quick-pick topics so a client/employee doesn't have to think of a subject line from scratch — clicking one fills the subject and gives the message a nudge to start from. i18n keys, not literals, so the chips follow the Arabic toggle like the rest of the composer. */
const CLIENT_TOPIC_KEYS = ["communications.topic.document", "communications.topic.payment", "communications.topic.tax", "communications.topic.update", "communications.topic.other"];
const EMPLOYEE_TOPIC_KEYS = ["communications.topic.paystub", "communications.topic.directDeposit", "communications.topic.update", "communications.topic.other"];

function SelfMessages({ role, clientId, clientEmail, messages, onSent }: { role: string; clientId: string; clientEmail: string; messages: Communication[]; onSent: () => void }) {
  const { t } = useLanguage();
  const isEmployee = role === "employee";
  const [subject, setSubject] = useState("");
  const [messageEnglish, setMessageEnglish] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!messageEnglish.trim()) { setError(t("communications.self.enterMessage")); return; }
    if (!clientId) { setError(t("communications.self.noClientLink")); return; }
    setSaving(true);
    setError(null);
    setSent(false);
    try {
      // Every self-service message is stored as a Portal Note the firm reviews — there's
      // no real channel to pick from this side (sendNow is never true here, so a channel
      // choice would only ever change how the row looks in the firm's log, not who gets
      // notified), so the picker that used to sit here was pure friction with no effect.
      await api.post("/communications", {
        clientId, subject: subject.trim() || (isEmployee ? "Payroll message" : "Message to AL TAX"),
        channel: "Portal Note", messageEnglish, direction: "Inbound", sentTo: clientEmail, sendNow: false,
      });
      setMessageEnglish("");
      setSubject("");
      setSent(true);
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("communications.self.sendError"));
    } finally {
      setSaving(false);
    }
  }

  const topicKeys = isEmployee ? EMPLOYEE_TOPIC_KEYS : CLIENT_TOPIC_KEYS;

  return (
    <div className="compose-split" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
      <Panel title={isEmployee ? t("communications.self.panelTitleEmployee") : t("communications.self.panelTitle")} note={t("communications.self.panelNote")}>
        <form onSubmit={handleSubmit} style={{ padding: "0 16px 16px" }}>
          {error && <ErrorBanner error={error} />}
          {sent && <div className="card" style={{ marginBottom: 12, borderColor: "var(--teal)", padding: 10, fontSize: 13 }}>{t("communications.self.sentConfirm")}</div>}
          <div className="field" style={{ marginBottom: 6 }}>
            <label>{t("communications.self.topicLabel")}</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {topicKeys.map((key) => (
                <button
                  key={key} type="button"
                  className={`btn btn-sm ${subject === t(key) ? "btn-primary" : ""}`}
                  onClick={() => setSubject(t(key))}
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
          <div className="field"><label htmlFor="self-subject">{t("communications.self.subjectLabel")}</label><input id="self-subject" required value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={isEmployee ? t("communications.self.subjectPlaceholderEmployee") : t("communications.self.subjectPlaceholder")} /></div>
          <div className="field"><label htmlFor="self-message">{t("communications.self.messageLabel")}</label><textarea id="self-message" rows={5} required value={messageEnglish} onChange={(e) => setMessageEnglish(e.target.value)} placeholder={isEmployee ? t("communications.self.placeholderEmployee") : t("communications.self.placeholderClient")} /></div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? t("communications.self.sending") : t("communications.self.send")}</button>
        </form>
      </Panel>
      <Panel title={t("communications.self.historyTitle")} note={<><Num>{messages.length}</Num> {t("communications.card.messages")}</>}>
        {messages.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>{t("communications.self.historyEmpty")}</p>}
        <div className="scroll-list" style={{ padding: messages.length ? "0 16px 16px" : 0 }}>
          {messages.map((m) => <CommunicationCard key={m.communication_id} c={m} />)}
        </div>
      </Panel>
    </div>
  );
}

/** Shows one communication's date/subject/channel plus its message body, with an English/Arabic toggle when both exist. */
function CommunicationCard({ c }: { c: Communication }) {
  const { t } = useLanguage();
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
      {!body && <div className="muted" style={{ fontSize: 13 }}>{t("communications.card.noText")}</div>}
    </div>
  );
}
