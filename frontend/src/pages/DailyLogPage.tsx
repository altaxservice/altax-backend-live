import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Client } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { useConfirm, useNotify } from "../components/ConfirmProvider";
import { useToast } from "../components/Toast";
import { DailyLogFormModal } from "../components/DailyLogFormModal";
import { NoteFormModal } from "../components/NoteFormModal";
import { NewWorkItemModal } from "../components/NewWorkItemModal";

interface FirmServiceOption { key: string; label: string }

interface DailyLogEntry {
  logId: string; authorEmail: string; authorName: string | null;
  clientId: string | null; clientName: string | null;
  taskId: string | null; taskName: string | null;
  loggedAt: string; category: string | null; services: string[]; body: string;
  timeSpentMinutes: number | null;
  createdAt: string; updatedAt: string;
}

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

/** What the Log Work modal should open pre-filled with — undefined means "leave that field blank," so opening it with `{}` (the plain "+ Log Work" button) reproduces a completely unconnected entry. */
interface LogModalState {
  logId?: string;
  clientId?: string; taskId?: string; body?: string; category?: string; services?: string[];
  loggedAt?: string; timeSpentHours?: string; timeSpentMinutes?: string;
}

/**
 * Daily Log — a personal/firm work journal, deliberately separate from both
 * Time Tracking (a billing tool: hours + rate + invoice rollup, no
 * narrative worth reading back) and Notes (forward-looking reminders, not a
 * "here's what I did" record). Real owner request, 2026-09-13: date+time,
 * which client(s), which task if any, and free text on what was involved
 * and what was done about it. Extended 2026-09-14: one entry can cover
 * several clients at once ("I did sales tax for 6 clients") and multiple of
 * the firm's real services — see dailyLog.routes.ts's header comment for
 * how the client picker fans out into one row per client behind the scenes,
 * and for why this is offered to everyone but never required/reminded.
 * Extended again 2026-09-14: an entry can link to a specific Task, and any
 * entry can spin off a Note or a Task of its own — see DailyLogFormModal/
 * NoteFormModal for the shared forms every cross-link path reuses.
 */
export function DailyLogPage() {
  const { user } = useAuth();
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const toast = useToast();

  const [logs, setLogs] = useState<DailyLogEntry[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [serviceOptions, setServiceOptions] = useState<FirmServiceOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [clientFilter, setClientFilter] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [search, setSearch] = useState("");

  // Undefined = closed. An empty object ({}) opens a completely blank,
  // unconnected entry — every pre-filled path below is purely additive.
  const [logModal, setLogModal] = useState<LogModalState | undefined>(undefined);
  const [noteModalFor, setNoteModalFor] = useState<DailyLogEntry | null>(null);
  const [taskModalFor, setTaskModalFor] = useState<DailyLogEntry | null>(null);

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
  useEffect(() => { api.get<{ services: FirmServiceOption[] }>("/daily-log/services").then((r) => setServiceOptions(r.services)).catch(() => {}); }, []);

  function startEdit(l: DailyLogEntry) {
    setLogModal({
      logId: l.logId, clientId: l.clientId || undefined, taskId: l.taskId || undefined,
      body: l.body, category: l.category || undefined, services: l.services || [],
      loggedAt: toDatetimeLocal(l.loggedAt),
      timeSpentHours: l.timeSpentMinutes ? String(Math.floor(l.timeSpentMinutes / 60)) : undefined,
      timeSpentMinutes: l.timeSpentMinutes ? String(l.timeSpentMinutes % 60) : undefined,
    });
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

  const serviceLabel = (key: string) => serviceOptions.find((s) => s.key === key)?.label || key;

  return (
    <div style={{ padding: 20 }}>
      <div className="command-panel">
        <div className="command-panel-header">
          <h2 className="command-panel-title">Daily Log</h2>
          <div className="command-panel-note">What you worked on, for which client(s), and on which task if any — a personal work journal, not a Task.</div>
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
          <button type="button" className="btn btn-sm btn-primary" style={{ marginLeft: "auto" }} onClick={() => setLogModal({})}>
            + Log Work
          </button>
        </div>

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
                              {(l.services || []).map((s) => <span key={s} className="status-pill status-teal" style={{ fontSize: 10 }}>{serviceLabel(s)}</span>)}
                              {l.clientName && <span style={{ fontSize: 12, fontWeight: 700 }}>{l.clientName}</span>}
                              {l.taskId && <Link to={`/tasks/${l.taskId}`} className="muted" style={{ fontSize: 11.5 }}>· {l.taskName || l.taskId}</Link>}
                              {l.timeSpentMinutes ? <span className="muted" style={{ fontSize: 11 }}>· {fmtTimeSpent(l.timeSpentMinutes)}</span> : null}
                            </div>
                            <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{l.body}</div>
                            <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>{l.authorName || l.authorEmail}</div>
                          </div>
                          <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <button type="button" className="btn btn-sm" title="Write a note for this client/task" onClick={() => setNoteModalFor(l)}>+ Note</button>
                            <button type="button" className="btn btn-sm" title="Create a task from this entry" onClick={() => setTaskModalFor(l)}>Create Task</button>
                            {canEdit && (
                              <>
                                <button type="button" className="btn btn-sm" onClick={() => startEdit(l)}>Edit</button>
                                <button type="button" className="btn btn-sm btn-danger" onClick={() => deleteOne(l.logId)}>Delete</button>
                              </>
                            )}
                          </div>
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

      {logModal !== undefined && (
        <DailyLogFormModal
          logId={logModal.logId}
          initialClientId={logModal.clientId}
          initialTaskId={logModal.taskId}
          initialBody={logModal.body}
          initialCategory={logModal.category}
          initialServices={logModal.services}
          initialLoggedAt={logModal.loggedAt}
          initialTimeSpentHours={logModal.timeSpentHours}
          initialTimeSpentMinutes={logModal.timeSpentMinutes}
          onClose={() => setLogModal(undefined)}
          onDone={load}
        />
      )}
      {noteModalFor && (
        <NoteFormModal
          initialClientId={noteModalFor.clientId || undefined}
          initialTaskId={noteModalFor.taskId || undefined}
          onClose={() => setNoteModalFor(null)}
          onDone={() => toast("Note saved.")}
        />
      )}
      {taskModalFor && (
        <NewWorkItemModal
          initialClientId={taskModalFor.clientId || undefined}
          initialNotes={taskModalFor.body}
          onClose={() => setTaskModalFor(null)}
          onDone={() => {}}
        />
      )}
    </div>
  );
}
