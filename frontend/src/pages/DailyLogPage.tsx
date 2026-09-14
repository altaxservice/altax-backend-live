import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { Client, Task } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { useConfirm, useNotify } from "../components/ConfirmProvider";

interface DailyLogEntry {
  logId: string; authorEmail: string; authorName: string | null;
  clientId: string | null; clientName: string | null;
  taskId: string | null; taskName: string | null;
  loggedAt: string; category: string | null; body: string;
  timeSpentMinutes: number | null;
  createdAt: string; updatedAt: string;
}

const CATEGORY_SUGGESTIONS = ["Call", "Filing", "Research", "Meeting", "Admin", "General"];

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function fmtTimeSpent(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** "Today"/"Yesterday" for the two most recent days, a full weekday+date otherwise — the day is always derived from the entry's own timestamp, never a separate field to keep in sync. */
function dayLabel(dayStr: string): string {
  const d = new Date(`${dayStr}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.getTime() === today.getTime()) return "Today";
  if (d.getTime() === yesterday.getTime()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

/** ISO timestamp -> the "YYYY-MM-DDTHH:mm" a <input type="datetime-local"> needs, in the viewer's own local time (unlike Notes' reminder field, this isn't a cross-timezone scheduling instant — it's "when did you personally do this," so the viewer's own clock is exactly what's wanted). */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The LOCAL calendar date (YYYY-MM-DD) an entry's timestamp falls on — real bug, found live: grouping by the raw UTC date (a naive .slice(0,10) of the ISO string) put an 8PM Eastern entry under "tomorrow," since that same instant is already past midnight UTC. Day boundaries have to be computed in the viewer's own timezone, not UTC's. */
function localDayKey(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Daily Log — a personal/firm work journal, deliberately separate from both
 * Time Tracking (a billing tool: hours + rate + invoice rollup, no
 * narrative worth reading back) and Notes (forward-looking reminders, not a
 * "here's what I did" record). Real owner request, 2026-09-13: date+time,
 * which client, which task if any, and free text on what was involved and
 * what was done about it. See dailyLog.routes.ts's header comment for why
 * this is offered to everyone but never required/reminded.
 */
export function DailyLogPage() {
  const { user } = useAuth();
  const confirmDialog = useConfirm();
  const notify = useNotify();

  const [logs, setLogs] = useState<DailyLogEntry[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [clientFilter, setClientFilter] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ body: "", clientId: "", taskId: "", category: "", loggedAt: "", timeSpentHours: "", timeSpentMinutes: "" });
  const [formTasks, setFormTasks] = useState<Task[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);

  function load() {
    const params = new URLSearchParams();
    if (clientFilter) params.set("clientId", clientFilter);
    if (mineOnly) params.set("mine", "1");
    if (search.trim()) params.set("search", search.trim());
    api.get<{ logs: DailyLogEntry[] }>(`/daily-log?${params.toString()}`)
      .then((r) => setLogs(r.logs))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the daily log."));
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientFilter, mineOnly, search]);
  useEffect(() => { api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => {}); }, []);

  // The task picker only makes sense once a client is chosen — narrows to
  // that client's own tasks instead of every task in the firm.
  useEffect(() => {
    if (!form.clientId) { setFormTasks([]); return; }
    api.get<{ tasks: Task[] }>(`/tasks?clientId=${encodeURIComponent(form.clientId)}&status=all`)
      .then((r) => setFormTasks(r.tasks))
      .catch(() => setFormTasks([]));
  }, [form.clientId]);

  function closeForm() {
    setForm({ body: "", clientId: "", taskId: "", category: "", loggedAt: "", timeSpentHours: "", timeSpentMinutes: "" });
    setShowForm(false);
    setEditingLogId(null);
    setSaveError(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!form.body.trim()) { setSaveError("Describe what you worked on."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        body: form.body.trim(), clientId: form.clientId || undefined, taskId: form.taskId || undefined,
        category: form.category.trim() || undefined, loggedAt: form.loggedAt || undefined,
        timeSpentHours: form.timeSpentHours || undefined, timeSpentMinutes: form.timeSpentMinutes || undefined,
      };
      if (editingLogId) {
        await api.post(`/daily-log/${editingLogId}/edit`, payload);
      } else {
        await api.post("/daily-log", payload);
      }
      closeForm();
      load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save this entry.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(l: DailyLogEntry) {
    setForm({
      body: l.body, clientId: l.clientId || "", taskId: l.taskId || "", category: l.category || "",
      loggedAt: toDatetimeLocal(l.loggedAt),
      timeSpentHours: l.timeSpentMinutes ? String(Math.floor(l.timeSpentMinutes / 60)) : "",
      timeSpentMinutes: l.timeSpentMinutes ? String(l.timeSpentMinutes % 60) : "",
    });
    setEditingLogId(l.logId);
    setSaveError(null);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }

  async function deleteOne(logId: string) {
    const ok = await confirmDialog({ title: "Delete entry", message: "Delete this log entry? This cannot be undone.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.post(`/daily-log/${logId}/delete`, {});
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this entry.");
    }
  }

  const grouped = useMemo(() => {
    if (!logs) return [];
    const map = new Map<string, DailyLogEntry[]>();
    for (const l of logs) {
      const day = localDayKey(l.loggedAt);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(l);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [logs]);

  return (
    <div style={{ padding: 20 }}>
      <div className="command-panel">
        <div className="command-panel-header">
          <h2 className="command-panel-title">Daily Log</h2>
          <div className="command-panel-note">What you worked on, for which client, and on which task if any — a personal work journal, not a Task.</div>
        </div>

        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} style={{ fontSize: 12.5, maxWidth: 220 }}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5 }}>
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            Logged by me
          </label>
          <input placeholder="Search entries…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ fontSize: 12.5, maxWidth: 220 }} />
          <button type="button" className="btn btn-sm btn-primary" style={{ marginLeft: "auto" }} onClick={() => (showForm ? closeForm() : setShowForm(true))}>
            {showForm ? "Cancel" : "+ Log Work"}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleSave} style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{editingLogId ? "Edit Entry" : "Log Work"}</div>
            {saveError && <ErrorBanner error={saveError} />}
            <div className="field">
              <label htmlFor="dl-body">What did you work on, and what did you do about it?</label>
              <textarea id="dl-body" rows={3} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="e.g. Called AAA Carryout about their missing W-9 — they'll fax it Friday, following up Monday if not received." />
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div className="field" style={{ flex: "1 1 200px" }}>
                <label htmlFor="dl-when">Date &amp; time</label>
                <input id="dl-when" type="datetime-local" value={form.loggedAt} onChange={(e) => setForm((f) => ({ ...f, loggedAt: e.target.value }))} />
                <span className="muted" style={{ fontSize: 10.5 }}>Blank = right now</span>
              </div>
              <div className="field" style={{ flex: "1 1 200px" }}>
                <label htmlFor="dl-client">Client (optional)</label>
                <select id="dl-client" value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value, taskId: "" }))}>
                  <option value="">No client — internal/general</option>
                  {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
                </select>
              </div>
              <div className="field" style={{ flex: "1 1 200px" }}>
                <label htmlFor="dl-task">Task (optional)</label>
                <select id="dl-task" value={form.taskId} onChange={(e) => setForm((f) => ({ ...f, taskId: e.target.value }))} disabled={!form.clientId}>
                  <option value="">{form.clientId ? "No specific task" : "Pick a client first"}</option>
                  {formTasks.map((t) => <option key={t.task_id} value={t.task_id}>{t.task_name}</option>)}
                </select>
              </div>
              <div className="field" style={{ flex: "1 1 150px" }}>
                <label htmlFor="dl-category">Category (optional)</label>
                <input id="dl-category" list="dl-category-list" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
                <datalist id="dl-category-list">
                  {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="field" style={{ flex: "1 1 170px" }}>
                <label htmlFor="dl-hours">Time spent (optional)</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input id="dl-hours" type="number" min="0" step="1" placeholder="hrs" value={form.timeSpentHours} onChange={(e) => setForm((f) => ({ ...f, timeSpentHours: e.target.value }))} style={{ width: 56 }} />
                  <span className="muted" style={{ fontSize: 12 }}>h</span>
                  <input id="dl-minutes" type="number" min="0" max="59" step="5" placeholder="min" value={form.timeSpentMinutes} onChange={(e) => setForm((f) => ({ ...f, timeSpentMinutes: e.target.value }))} style={{ width: 56 }} />
                  <span className="muted" style={{ fontSize: 12 }}>m</span>
                </div>
                <span className="muted" style={{ fontSize: 10.5 }}>For your own awareness — not billing. Use Time Tracking for billable hours.</span>
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ alignSelf: "flex-start" }}>{saving ? "Saving…" : editingLogId ? "Save Changes" : "Save Entry"}</button>
          </form>
        )}

        {error && <div style={{ padding: 16 }}><ErrorBanner error={error} /></div>}

        {!logs && !error && <div className="spinner-wrap">Loading…</div>}
        {logs && logs.length === 0 && <p className="muted" style={{ padding: 16 }}>Nothing logged yet.</p>}
        {logs && logs.length > 0 && (
          <div style={{ padding: 16 }}>
            {grouped.map(([day, entries]) => (
              <div key={day} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--muted)", marginBottom: 8 }}>
                  {dayLabel(day)}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {entries.map((l) => {
                    const canEdit = user?.role === "admin" || l.authorEmail.toLowerCase() === (user?.email || "").toLowerCase();
                    return (
                      <div key={l.logId} className="card" style={{ padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                              <span className="muted" style={{ fontSize: 11.5, fontWeight: 700 }}>{fmtTime(l.loggedAt)}</span>
                              {l.category && <span className="badge" style={{ fontSize: 10 }}>{l.category}</span>}
                              {l.clientName && <span style={{ fontSize: 12, fontWeight: 700 }}>{l.clientName}</span>}
                              {l.taskName && <span className="muted" style={{ fontSize: 11.5 }}>· {l.taskName}</span>}
                              {l.timeSpentMinutes ? <span className="muted" style={{ fontSize: 11 }}>· {fmtTimeSpent(l.timeSpentMinutes)}</span> : null}
                            </div>
                            <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{l.body}</div>
                            <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>{l.authorName || l.authorEmail}</div>
                          </div>
                          {canEdit && (
                            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                              <button type="button" className="btn btn-sm" onClick={() => startEdit(l)}>Edit</button>
                              <button type="button" className="btn btn-sm btn-danger" onClick={() => deleteOne(l.logId)}>Delete</button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
