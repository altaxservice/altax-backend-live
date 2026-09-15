import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Client } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { StatusBadge } from "../components/StatusBadge";
import { NoteFormModal } from "../components/NoteFormModal";
import { DailyLogFormModal } from "../components/DailyLogFormModal";
import { NewWorkItemModal } from "../components/NewWorkItemModal";
import { useConfirm, useNotify } from "../components/ConfirmProvider";
import { useToast } from "../components/Toast";

interface StaffNote {
  noteId: string; authorEmail: string; authorName: string | null;
  clientId: string | null; clientName: string | null;
  taskId: string | null; taskName: string | null; body: string;
  visibility: "firm" | "admin"; category: string | null; status: "Open" | "Done";
  priority: string; assignedTo: string | null;
  remindAt: string | null; reminderSentAt: string | null; resolvedAt: string | null; resolvedBy: string | null;
  createdAt: string; updatedAt: string; unread: boolean;
}

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Remind date+time is always shown in America/New_York regardless of the viewer's own browser timezone — matches exactly how the backend (etWallClockToUtc) interprets what staff type in, so this never shows a different moment than what was actually scheduled. */
function fmtRemindAt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

/** Converts a stored UTC ISO timestamp into the "YYYY-MM-DDTHH:mm" a <input type="datetime-local"> needs, expressed in America/New_York wall-clock time — the same timezone the backend assumes when re-parsing whatever gets typed back in, so editing an existing reminder round-trips to the exact same instant instead of drifting by the viewer's own UTC offset. */
function toEasternDatetimeLocal(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** What the New/Edit/Duplicate Note modal should open pre-filled with — undefined means "leave that field blank," so opening it with `{}` (the plain "+ New Note" button) reproduces a completely unconnected note. */
interface NoteModalState {
  noteId?: string;
  clientId?: string; taskId?: string; body?: string; category?: string; remindAt?: string;
  priority?: string; assignedTo?: string;
}

/**
 * Firm Notes — a follow-up notebook, separate from Tasks and from the
 * per-client "Client Note"/"Firm Note" activity log. Real owner request,
 * 2026-09-07: while working through client tasks, jot a reminder that isn't
 * a formal Task, then review/resolve/delete it later from ONE central place
 * instead of visiting each client individually.
 *
 * Private by author, 2026-09-14: a staff member only ever sees their own
 * notes (see staffNotes.routes.ts's GET / — admin still sees every note
 * firm-wide); the old Team/Admin-Only visibility toggle is gone since it no
 * longer has anything left to control. Linking a note to a Task, or
 * spinning off a Task/Log entry from one, is admin-only (the "Log Work"/
 * "Create Task" row actions and NoteFormModal's Task field only render for
 * admin) — see NoteFormModal/DailyLogFormModal for the shared forms.
 */
export function NotesPage() {
  const { user } = useAuth();
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const toast = useToast();
  const isAdmin = user?.role === "admin";

  const [notes, setNotes] = useState<StaffNote[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"open" | "done" | "all">("open");
  const [clientFilter, setClientFilter] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Undefined = closed. An empty object ({}) opens a completely blank,
  // unconnected note — every pre-filled path below is purely additive.
  const [noteModal, setNoteModal] = useState<NoteModalState | undefined>(undefined);
  const [logModalFor, setLogModalFor] = useState<StaffNote | null>(null);
  const [taskModalFor, setTaskModalFor] = useState<StaffNote | null>(null);

  function load() {
    const params = new URLSearchParams({ status: statusFilter });
    if (clientFilter) params.set("clientId", clientFilter);
    if (mineOnly) params.set("mine", "1");
    if (search.trim()) params.set("search", search.trim());
    api.get<{ notes: StaffNote[] }>(`/staff-notes?${params.toString()}`)
      .then((r) => { setNotes(r.notes); setSelected(new Set()); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load notes."));
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter, clientFilter, mineOnly, search]);
  useEffect(() => { api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => {}); }, []);

  async function markRead(noteId: string) {
    try {
      await api.post(`/staff-notes/${noteId}/read`, {});
      setNotes((prev) => prev && prev.map((n) => (n.noteId === noteId ? { ...n, unread: false } : n)));
    } catch { /* best-effort */ }
  }

  async function setStatus(noteId: string, status: "Open" | "Done") {
    try {
      await api.post(`/staff-notes/${noteId}/status`, { status });
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not update this note.");
    }
  }

  async function deleteOne(noteId: string) {
    const ok = await confirmDialog({ title: "Delete note", message: "Delete this note? This cannot be undone.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.post(`/staff-notes/${noteId}/delete`, {});
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this note.");
    }
  }

  /** Opens the New Note form pre-filled from an existing note's text/category/remind date — for the same reminder that applies to several clients (e.g. "collect signed engagement letter"), so it doesn't have to be retyped. Client and task are deliberately left blank rather than copied — this is FOR a different client, picking the same ones back would just be a no-op duplicate. */
  function startDuplicate(n: StaffNote) {
    setNoteModal({
      body: n.body, category: n.category || undefined, remindAt: n.remindAt ? toEasternDatetimeLocal(n.remindAt) : undefined,
      priority: n.priority || "Normal", assignedTo: n.assignedTo || undefined,
    });
  }

  /** Opens the form editing this note in place — same fields pre-filled, including its current client/task, unlike Duplicate which blanks them on purpose. Author or admin only; the backend enforces this too. */
  function startEdit(n: StaffNote) {
    setNoteModal({
      noteId: n.noteId, clientId: n.clientId || undefined, taskId: n.taskId || undefined,
      body: n.body, category: n.category || undefined, remindAt: n.remindAt ? toEasternDatetimeLocal(n.remindAt) : undefined,
      priority: n.priority || "Normal", assignedTo: n.assignedTo || undefined,
    });
  }

  function toggleSelected(noteId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId); else next.add(noteId);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected((prev) => (prev.size === (notes?.length || 0) ? new Set() : new Set((notes || []).map((n) => n.noteId))));
  }

  async function handleBulk(action: "read" | "done" | "delete") {
    if (selected.size === 0) return;
    if (action === "delete") {
      const ok = await confirmDialog({ title: "Delete notes", message: `Delete ${selected.size} selected note(s)? This cannot be undone.`, confirmLabel: "Delete", danger: true });
      if (!ok) return;
    }
    setBulkBusy(true);
    try {
      await Promise.all(Array.from(selected).map((noteId) => {
        if (action === "read") return api.post(`/staff-notes/${noteId}/read`, {});
        if (action === "done") return api.post(`/staff-notes/${noteId}/status`, { status: "Done" });
        return api.post(`/staff-notes/${noteId}/delete`, {});
      }));
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Some notes could not be updated.");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <div className="command-panel">
        <div className="command-panel-header">
          <h2 className="command-panel-title">Notes</h2>
          <div className="command-panel-note">A shared follow-up notebook — not a Task, just things to come back to.</div>
        </div>

        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={{ fontSize: 12.5 }}>
            <option value="open">Open</option>
            <option value="done">Done</option>
            <option value="all">All</option>
          </select>
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} style={{ fontSize: 12.5, maxWidth: 220 }}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
          </select>
          {isAdmin && (
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5 }}>
              <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
              Created by me
            </label>
          )}
          <input placeholder="Search notes…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ fontSize: 12.5, maxWidth: 220 }} />
          <button type="button" className="btn btn-sm btn-primary" style={{ marginLeft: "auto" }} onClick={() => setNoteModal({})}>
            + New Note
          </button>
        </div>

        {error && <div style={{ padding: 16 }}><ErrorBanner error={error} /></div>}

        {selected.size > 0 && (
          <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--line)", display: "flex", gap: 8, alignItems: "center", background: "var(--surface)" }}>
            <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{selected.size} selected</span>
            <button type="button" className="ghost-button" disabled={bulkBusy} onClick={() => handleBulk("read")}>Mark Read</button>
            <button type="button" className="ghost-button" disabled={bulkBusy} onClick={() => handleBulk("done")}>Mark Done</button>
            <button type="button" className="danger-button" disabled={bulkBusy} onClick={() => handleBulk("delete")}>Delete</button>
          </div>
        )}

        {!notes && !error && <div className="spinner-wrap">Loading…</div>}
        {notes && notes.length === 0 && <p className="muted" style={{ padding: 16 }}>Nothing here — you're caught up.</p>}
        {notes && notes.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col" style={{ width: 32 }}><input type="checkbox" checked={selected.size > 0 && selected.size === notes.length} onChange={toggleSelectAll} /></th>
                  <th scope="col">Note</th>
                  <th scope="col">Client</th>
                  <th scope="col">Task</th>
                  <th scope="col">Category</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Author</th>
                  <th scope="col">Notify</th>
                  <th scope="col">Remind</th>
                  <th scope="col">Created</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {notes.map((n) => {
                  const overdue = n.status === "Open" && n.remindAt && new Date(n.remindAt) <= new Date();
                  const canEdit = isAdmin || n.authorEmail.toLowerCase() === (user?.email || "").toLowerCase();
                  function openRow() {
                    if (n.unread) markRead(n.noteId);
                    if (canEdit) startEdit(n);
                  }
                  return (
                    <tr
                      key={n.noteId} style={{ opacity: n.status === "Done" ? 0.6 : 1, cursor: canEdit ? "pointer" : "default" }}
                      onClick={openRow} title={canEdit ? "Click to view / edit" : undefined}
                    >
                      <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(n.noteId)} onChange={() => toggleSelected(n.noteId)} /></td>
                      <td style={{ maxWidth: 360, fontWeight: n.unread ? 700 : 400 }}>
                        {n.unread && <span style={{ color: "var(--teal)" }}>● </span>}
                        {n.body}
                      </td>
                      <td className="muted">{n.clientName || "—"}</td>
                      <td className="muted" onClick={(e) => n.taskId && e.stopPropagation()}>
                        {n.taskId ? <Link to={`/tasks/${n.taskId}`}>{n.taskName || n.taskId}</Link> : "—"}
                      </td>
                      <td className="muted">{n.category || "—"}</td>
                      <td>{n.priority && n.priority !== "Normal" ? <StatusBadge status={n.priority} /> : <span className="muted">—</span>}</td>
                      <td className="muted">{n.authorName || n.authorEmail}</td>
                      <td className="muted">{n.remindAt ? (n.assignedTo || `${n.authorName || n.authorEmail} (author)`) : "—"}</td>
                      <td style={overdue ? { color: "var(--red)", fontWeight: 700 } : undefined}>
                        {n.remindAt ? fmtRemindAt(n.remindAt) : "—"}
                        {n.remindAt && n.reminderSentAt && <div className="muted" style={{ fontSize: 10.5, fontWeight: 400 }}>Sent {fmtRelative(n.reminderSentAt)}</div>}
                      </td>
                      <td className="muted">{fmtRelative(n.createdAt)}</td>
                      <td onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {n.status === "Open"
                          ? <button type="button" className="btn btn-sm" onClick={() => setStatus(n.noteId, "Done")}>Mark Done</button>
                          : <button type="button" className="btn btn-sm" onClick={() => setStatus(n.noteId, "Open")}>Reopen</button>}
                        {canEdit && <button type="button" className="btn btn-sm" onClick={() => startEdit(n)}>Edit</button>}
                        <button type="button" className="btn btn-sm" title="Reuse this note's text for a different client" onClick={() => startDuplicate(n)}>Duplicate</button>
                        {isAdmin && <button type="button" className="btn btn-sm" title="Log work for this client/task" onClick={() => setLogModalFor(n)}>Log Work</button>}
                        {isAdmin && <button type="button" className="btn btn-sm" title="Create a task from this note" onClick={() => setTaskModalFor(n)}>Create Task</button>}
                        {canEdit && <button type="button" className="btn btn-sm btn-danger" onClick={() => deleteOne(n.noteId)}>Delete</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {noteModal !== undefined && (
        <NoteFormModal
          noteId={noteModal.noteId}
          initialClientId={noteModal.clientId}
          initialTaskId={noteModal.taskId}
          initialBody={noteModal.body}
          initialCategory={noteModal.category}
          initialRemindAt={noteModal.remindAt}
          initialPriority={noteModal.priority}
          initialAssignedTo={noteModal.assignedTo}
          onClose={() => setNoteModal(undefined)}
          onDone={load}
        />
      )}
      {logModalFor && (
        <DailyLogFormModal
          initialClientId={logModalFor.clientId || undefined}
          initialTaskId={logModalFor.taskId || undefined}
          onClose={() => setLogModalFor(null)}
          onDone={() => toast("Logged.")}
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
