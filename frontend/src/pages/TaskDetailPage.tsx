import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, resolveFileUrl } from "../api/client";
import type { Task } from "../api/types";
import type { Communication } from "../api/types2";
import { useAuth } from "../auth/AuthContext";
import { StatusBadge } from "../components/StatusBadge";
import { fmtDateOnly } from "../utils/date";
import { fileToBase64, MAX_UPLOAD_BYTES } from "../utils/file";

const STATUS_OPTIONS = ["Not Started", "In Progress", "Waiting on Client", "Filed", "Paid", "Completed"];

const EDITABLE_FIELDS: { key: string; label: string; apiKey: string; type?: string }[] = [
  { key: "task_name", label: "Task Name", apiKey: "taskName" },
  { key: "service_line", label: "Service Line", apiKey: "serviceLine" },
  { key: "period", label: "Period", apiKey: "period" },
  { key: "frequency", label: "Frequency", apiKey: "frequency" },
  { key: "assigned_to", label: "Assigned To", apiKey: "assignedTo" },
  { key: "agency_due_date", label: "Agency Due Date", apiKey: "agencyDueDate", type: "date" },
  { key: "staff_due_date", label: "Staff Due Date", apiKey: "staffDueDate", type: "date" },
  { key: "payment_required", label: "Payment Required", apiKey: "paymentRequired", type: "checkbox" },
  { key: "payment_amount", label: "Payment Amount", apiKey: "paymentAmount", type: "number" },
  { key: "filed_date", label: "Filed Date", apiKey: "filedDate", type: "date" },
  { key: "paid_date", label: "Paid Date", apiKey: "paidDate", type: "date" },
  { key: "confirmation_number", label: "Confirmation Number", apiKey: "confirmationNumber" },
  { key: "portal_name", label: "Portal Name", apiKey: "portalName" },
  { key: "portal_url", label: "Portal URL", apiKey: "portalUrl" },
  { key: "notes", label: "Notes", apiKey: "notes" },
];

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== "" ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

function toDateInput(value: unknown): string {
  if (!value) return "";
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const openParam = searchParams.get("open");
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(openParam === "edit");
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const attachmentsRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const canEdit = user?.role === "admin" || user?.role === "staff";

  useEffect(() => {
    if (!task) return;
    const target = openParam === "files" ? attachmentsRef.current : openParam === "message" || openParam === "note" ? threadRef.current : null;
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, openParam]);

  function load() {
    if (!taskId) return;
    api.get<{ task: Task }>(`/tasks/${taskId}`)
      .then((res) => {
        setTask(res.task);
        const initial: Record<string, string> = {};
        for (const f of EDITABLE_FIELDS) {
          const raw = res.task[f.key];
          initial[f.apiKey] = f.type === "date" ? toDateInput(raw) : String(raw ?? "");
        }
        setForm(initial);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this task."));
  }

  useEffect(load, [taskId]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!taskId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload: Record<string, unknown> = { ...form };
      payload.paymentRequired = form.paymentRequired === "true";
      await api.patch(`/tasks/${taskId}`, payload);
      setEditing(false);
      load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    if (!taskId) return;
    setStatusSaving(true);
    try {
      await api.patch(`/tasks/${taskId}`, { status: newStatus });
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not update status.");
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleVoid() {
    if (!taskId) return;
    const reason = prompt("Reason for voiding this task?");
    if (reason === null) return;
    try {
      await api.post(`/tasks/${taskId}/void`, { reason });
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not void this task.");
    }
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!task) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div>
      <Link to="/tasks" className="muted">← All tasks</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", margin: "8px 0 24px", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>{task.task_name}</h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <StatusBadge status={task.status} />
            <Link to={`/clients/${task.client_id}`} className="muted">{task.client_name}</Link>
          </div>
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value=""
              disabled={statusSaving}
              onChange={(e) => e.target.value && handleStatusChange(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)" }}
            >
              <option value="">Change status…</option>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {!editing && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
            <button className="btn btn-danger" onClick={handleVoid}>Void</button>
          </div>
        )}
      </div>

      {editing ? (
        <form onSubmit={handleSave} className="card" style={{ maxWidth: 560 }}>
          {saveError && <div className="error-banner">{saveError}</div>}
          {EDITABLE_FIELDS.map((f) => (
            <div className="field" key={f.apiKey}>
              {f.type === "checkbox" ? (
                <label htmlFor={f.apiKey} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    id={f.apiKey}
                    type="checkbox"
                    checked={form[f.apiKey] === "true"}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.apiKey]: e.target.checked ? "true" : "false" }))}
                  />
                  {f.label}
                </label>
              ) : (
                <>
                  <label htmlFor={f.apiKey}>{f.label}</label>
                  {f.apiKey === "notes" ? (
                    <textarea id={f.apiKey} rows={3} value={form[f.apiKey] ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, [f.apiKey]: e.target.value }))} />
                  ) : (
                    <input
                      id={f.apiKey}
                      type={f.type || "text"}
                      step={f.type === "number" ? "0.01" : undefined}
                      value={form[f.apiKey] ?? ""}
                      onChange={(e) => setForm((prev) => ({ ...prev, [f.apiKey]: e.target.value }))}
                    />
                  )}
                </>
              )}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="card" style={{ maxWidth: 560 }}>
          <DetailRow label="Service Line" value={task.service_line} />
          <DetailRow label="Period" value={task.period} />
          <DetailRow label="Frequency" value={task.frequency} />
          <DetailRow label="Assigned To" value={task.assigned_to} />
          <DetailRow label="Agency Due Date" value={task.agency_due_date ? fmtDateOnly(task.agency_due_date) : null} />
          <DetailRow label="Staff Due Date" value={task.staff_due_date ? fmtDateOnly(task.staff_due_date) : null} />
          <DetailRow label="Portal Name" value={task.portal_name} />
          <DetailRow label="Portal URL" value={task.portal_url} link />
          <DetailRow label="Payment Required" value={task.payment_required ? "Yes" : "No"} />
          <DetailRow label="Payment Amount" value={task.payment_amount != null ? fmtMoney(task.payment_amount) : null} />
          <DetailRow label="Filed Date" value={task.filed_date ? fmtDateOnly(task.filed_date) : null} />
          <DetailRow label="Paid Date" value={task.paid_date ? fmtDateOnly(task.paid_date) : null} />
          <DetailRow label="Confirmation Number" value={task.confirmation_number} />
          <DetailRow label="Notes" value={task.notes} />
        </div>
      )}

      {canEdit && taskId && <div ref={attachmentsRef}><TaskAttachments taskId={taskId} /></div>}
      {canEdit && taskId && <div ref={threadRef}><TaskThread taskId={taskId} initialMode={openParam === "message" ? "message" : "note"} /></div>}
    </div>
  );
}

interface TaskUpload { upload_id: string; file_name: string; file_url: string; uploaded_by: string; uploaded_at: string | null; notes: string | null }

function TaskAttachments({ taskId }: { taskId: string }) {
  const [uploads, setUploads] = useState<TaskUpload[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"browse" | "link">("browse");
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function load() {
    api.get<{ uploads: TaskUpload[] }>(`/documents/uploads/task/${taskId}`)
      .then((res) => setUploads(res.uploads))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load attachments."));
  }
  useEffect(load, [taskId]);

  async function handleAttach(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      if (mode === "browse") {
        if (!file) throw new ApiError("Choose a file to attach.", 400);
        if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(`That file is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Files over 8MB need to be shared as a link instead.`, 400);
        const fileData = await fileToBase64(file);
        await api.post("/documents/uploads", { taskId, fileName: fileName || file.name, fileData, mimeType: file.type });
      } else {
        await api.post("/documents/uploads", { taskId, fileUrl, fileName });
      }
      setFile(null);
      setFileName("");
      setFileUrl("");
      load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not attach this file.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="command-panel" style={{ maxWidth: 560, marginTop: 20 }}>
      <div className="command-panel-header">
        <h2 className="command-panel-title">Attachments</h2>
        <div className="command-panel-note">{uploads?.length ?? 0} files · internal only</div>
      </div>
      <form onSubmit={handleAttach} style={{ padding: 16, borderBottom: "1px solid var(--line)" }}>
        {saveError && <div className="error-banner" style={{ width: "100%" }}>{saveError}</div>}
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button type="button" className={`btn btn-sm ${mode === "browse" ? "btn-primary" : ""}`} onClick={() => setMode("browse")}>Browse a file</button>
          <button type="button" className={`btn btn-sm ${mode === "link" ? "btn-primary" : ""}`} onClick={() => setMode("link")}>Paste a link instead</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          {mode === "browse" ? (
            <div className="field" style={{ margin: 0, flex: "2 1 240px" }}>
              <label>Choose File</label>
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>
          ) : (
            <div className="field" style={{ margin: 0, flex: "2 1 240px" }}><label>File Link</label><input required value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="Drive link or other URL" /></div>
          )}
          <div className="field" style={{ margin: 0, flex: "1 1 160px" }}><label>File Name</label><input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder={mode === "browse" ? "Uses the file's own name" : "e.g. Draft return"} /></div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Attaching…" : "Attach"}</button>
        </div>
      </form>
      {error && <div className="error-banner" style={{ margin: 16 }}>{error}</div>}
      {uploads && uploads.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No files attached to this task yet.</p>}
      {uploads && uploads.length > 0 && (
        <div style={{ padding: "8px 16px" }}>
          {uploads.map((u) => (
            <div key={u.upload_id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", gap: 12 }}>
              <a href={resolveFileUrl(u.file_url)} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>{u.file_name}</a>
              <span className="muted" style={{ fontSize: 12 }}>{u.uploaded_at ? new Date(u.uploaded_at).toLocaleDateString() : "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface StaffDirectoryEntry { name: string; email: string; role: string }

function TaskThread({ taskId, initialMode = "note" }: { taskId: string; initialMode?: "note" | "message" }) {
  const [thread, setThread] = useState<Communication[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"note" | "message">(initialMode);
  const [staff, setStaff] = useState<StaffDirectoryEntry[]>([]);
  const [recipient, setRecipient] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  function load() {
    api.get<{ communications: Communication[] }>(`/communications/task/${taskId}`)
      .then((res) => setThread(res.communications))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load notes and messages."));
  }

  useEffect(load, [taskId]);
  useEffect(() => {
    api.get<{ staff: StaffDirectoryEntry[] }>("/communications/staff-directory").then((r) => setStaff(r.staff)).catch(() => {});
  }, []);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setSendError(null);
    try {
      await api.post("/communications/task", { taskId, mode, messageEnglish: text, recipientEmail: mode === "message" ? recipient : undefined });
      setText("");
      load();
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : "Could not save this.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="command-panel" style={{ maxWidth: 560, marginTop: 20 }}>
      <div className="command-panel-header">
        <h2 className="command-panel-title">Notes &amp; Messages</h2>
        <div className="command-panel-note">{thread?.length ?? 0} entries</div>
      </div>

      <form onSubmit={handleSend} style={{ padding: 16, borderBottom: "1px solid var(--line)" }}>
        {sendError && <div className="error-banner">{sendError}</div>}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button type="button" className={`btn btn-sm ${mode === "note" ? "btn-primary" : ""}`} onClick={() => setMode("note")}>Add Note</button>
          <button type="button" className={`btn btn-sm ${mode === "message" ? "btn-primary" : ""}`} onClick={() => setMode("message")}>Send Message</button>
        </div>
        {mode === "message" && (
          <div className="field">
            <label>Recipient</label>
            <select required value={recipient} onChange={(e) => setRecipient(e.target.value)}>
              <option value="">Select a recipient…</option>
              {staff.map((s) => <option key={s.email} value={s.email}>{s.name} ({s.role})</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label>{mode === "note" ? "Note" : "Message"}</label>
          <textarea rows={3} required value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === "note" ? "Internal note — not sent to anyone." : "Message text"} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={sending}>{sending ? "Saving…" : mode === "note" ? "Save Note" : "Send Message"}</button>
      </form>

      {error && <div className="error-banner" style={{ margin: 16 }}>{error}</div>}
      {!thread && !error && <div className="spinner-wrap">Loading…</div>}
      {thread && thread.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No notes or messages on this task yet.</p>}
      {thread && thread.length > 0 && (
        <div className="scroll-list" style={{ padding: "8px 16px" }}>
          {thread.map((c) => (
            <div key={c.communication_id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                <span>{c.channel} · {c.direction}{c.sent_to ? ` · to ${c.sent_to}` : ""}</span>
                <span>{c.sent_at ? new Date(c.sent_at).toLocaleString() : "—"}</span>
              </div>
              <div style={{ fontSize: 13 }}>{c.message_english}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, link }: { label: string; value: string | null | undefined; link?: boolean }) {
  const href = link && value ? (/^https?:\/\//i.test(value) ? value : `https://${value}`) : null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13, gap: 16 }}>
      <span className="muted" style={{ flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right" }}>
        {href ? <a href={href} target="_blank" rel="noreferrer">{value}</a> : (value || "—")}
      </span>
    </div>
  );
}
