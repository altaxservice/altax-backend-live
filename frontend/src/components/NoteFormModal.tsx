import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { Client, Task } from "../api/types";
import type { WebOptions } from "../api/types2";
import { useAuth } from "../auth/AuthContext";
import { ErrorBanner } from "./ErrorBanner";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

const CATEGORY_SUGGESTIONS = ["Billing", "Missing Info", "Follow-up", "General"];
const PRIORITY_OPTIONS = ["Low", "Normal", "High", "Urgent"];

/**
 * Standalone Note create/edit form, extracted from NotesPage so any page can
 * launch it pre-filled and cross-link a note to a client/task — Task
 * Detail's "+ Note" action and Daily Log's "+ Note" row action reuse this
 * exact same form, alongside Notes' own inline New/Edit/Duplicate. Passing
 * no initial props at all reproduces a completely blank, unconnected note —
 * every cross-link here is additive, never required.
 *
 * Notes are private to their own author by default (staff never see each
 * other's or admin's notes — see staffNotes.routes.ts's GET /), so the old
 * Team/Admin-Only visibility choice is gone entirely. Real owner request,
 * 2026-09-14: linking a note to a task is also admin-only now — a staff
 * user never sees the Task field here at all, only ever creating plain,
 * unconnected notes (or notes tied only to a client).
 */
export function NoteFormModal({
  noteId, initialClientId, initialTaskId, initialBody, initialCategory, initialRemindAt,
  initialPriority, initialAssignedTo, onClose, onDone,
}: {
  noteId?: string;
  initialClientId?: string; initialTaskId?: string; initialBody?: string; initialCategory?: string;
  initialRemindAt?: string; initialPriority?: string; initialAssignedTo?: string;
  onClose: () => void; onDone: () => void;
}) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [clients, setClients] = useState<Client[]>([]);
  const [staffOptions, setStaffOptions] = useState<string[]>([]);
  const [formTasks, setFormTasks] = useState<Task[]>([]);

  const [body, setBody] = useState(initialBody || "");
  const [clientId, setClientId] = useState(initialClientId || "");
  const [taskId, setTaskId] = useState(isAdmin ? (initialTaskId || "") : "");
  const [category, setCategory] = useState(initialCategory || "");
  const [remindAt, setRemindAt] = useState(initialRemindAt || "");
  const [priority, setPriority] = useState(initialPriority || "Normal");
  const [assignedTo, setAssignedTo] = useState(initialAssignedTo || "");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => { api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => {}); }, []);
  useEffect(() => {
    api.get<WebOptions>("/system/options").then((r) => setStaffOptions(r.staff || [])).catch(() => {});
  }, []);

  // A task only makes sense against a specific client — populated whenever
  // one is picked, cleared (via the client <select>'s own onChange below)
  // the moment the client changes. Staff never see the Task field at all
  // (admin-only cross-linking), so there's nothing to fetch for them.
  useEffect(() => {
    if (!isAdmin || !clientId) { setFormTasks([]); return; }
    api.get<{ tasks: Task[] }>(`/tasks?clientId=${encodeURIComponent(clientId)}&status=all`)
      .then((r) => setFormTasks(r.tasks))
      .catch(() => setFormTasks([]));
  }, [isAdmin, clientId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) { setSaveError("Note text is required."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        body: body.trim(), clientId: clientId || undefined, taskId: isAdmin ? (taskId || undefined) : undefined,
        category: category.trim() || undefined, remindAt: remindAt || undefined,
        priority, assignedTo: assignedTo || undefined,
      };
      if (noteId) {
        await api.post(`/staff-notes/${noteId}/edit`, payload);
      } else {
        await api.post("/staff-notes", payload);
      }
      onDone();
      onClose();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save this note.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (onClose)(); }}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="note-form-title" style={{ width: "min(560px, 94vw)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="note-form-title">{noteId ? "Edit Note" : "New Note"}</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {saveError && <ErrorBanner error={saveError} />}
          <div className="field">
            <label htmlFor="note-body">Note</label>
            <textarea id="note-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="e.g. AAA Carryout is missing a W-9 — chase before month-end." />
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "1 1 220px" }}>
              <label htmlFor="note-client">Client (optional)</label>
              <select id="note-client" value={clientId} onChange={(e) => { setClientId(e.target.value); setTaskId(""); }}>
                <option value="">No client — general note</option>
                {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
              </select>
            </div>
            {isAdmin && (
              <div className="field" style={{ flex: "1 1 220px" }}>
                <label htmlFor="note-task">Task (optional)</label>
                <select id="note-task" value={taskId} onChange={(e) => setTaskId(e.target.value)} disabled={!clientId}>
                  <option value="">{clientId ? "No specific task" : "Pick a client first"}</option>
                  {formTasks.map((t) => <option key={t.task_id} value={t.task_id}>{t.task_name}</option>)}
                </select>
              </div>
            )}
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label htmlFor="note-category">Category (optional)</label>
              <input id="note-category" list="note-category-list" value={category} onChange={(e) => setCategory(e.target.value)} />
              <datalist id="note-category-list">
                {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="field" style={{ flex: "1 1 200px" }}>
              <label htmlFor="note-remind">Remind me on (optional)</label>
              <input id="note-remind" type="datetime-local" value={remindAt} onChange={(e) => setRemindAt(e.target.value)} />
              <span className="muted" style={{ fontSize: 10.5 }}>Eastern time</span>
            </div>
            <div className="field" style={{ flex: "1 1 130px" }}>
              <label htmlFor="note-priority">Priority</label>
              <select id="note-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: "1 1 180px" }}>
              <label htmlFor="note-assigned">Notify (optional)</label>
              <select id="note-assigned" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                <option value="">{remindAt ? "Just me (the author)" : "No one"}</option>
                {assignedTo && !staffOptions.includes(assignedTo) && (
                  <option value={assignedTo}>{assignedTo} (Inactive)</option>
                )}
                {staffOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : noteId ? "Save Changes" : "Save Note"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
