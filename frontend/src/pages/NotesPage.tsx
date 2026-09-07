import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { Client } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { useConfirm, useNotify } from "../components/ConfirmProvider";

interface StaffNote {
  noteId: string; authorEmail: string; authorName: string | null;
  clientId: string | null; clientName: string | null; body: string;
  visibility: "firm" | "admin"; category: string | null; status: "Open" | "Done";
  remindAt: string | null; resolvedAt: string | null; resolvedBy: string | null;
  createdAt: string; updatedAt: string; unread: boolean;
}

const CATEGORY_SUGGESTIONS = ["Billing", "Missing Info", "Follow-up", "General"];

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Firm Notes — a shared follow-up notebook, separate from Tasks and from the
 * per-client "Client Note"/"Firm Note" activity log. Real owner request,
 * 2026-09-07: while working through client tasks, jot a reminder that isn't
 * a formal Task, then review/resolve/delete it later from ONE central place
 * instead of visiting each client individually — see staffNotes.routes.ts's
 * header comment for the full design (role-based visibility: 'firm' notes
 * are shared with the whole team, 'admin' notes are visible only to admin,
 * a toggle only admin ever sees).
 */
export function NotesPage() {
  const { user } = useAuth();
  const confirmDialog = useConfirm();
  const notify = useNotify();
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

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ body: "", clientId: "", category: "", remindAt: "", visibility: "firm" as "firm" | "admin" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.body.trim()) { setSaveError("Note text is required."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      await api.post("/staff-notes", {
        body: form.body.trim(), clientId: form.clientId || undefined,
        category: form.category.trim() || undefined, remindAt: form.remindAt || undefined,
        visibility: isAdmin ? form.visibility : undefined,
      });
      setForm({ body: "", clientId: "", category: "", remindAt: "", visibility: "firm" });
      setShowForm(false);
      load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save this note.");
    } finally {
      setSaving(false);
    }
  }

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

  /** Opens the New Note form pre-filled from an existing note's text/category/remind date — for the same reminder that applies to several clients (e.g. "collect signed engagement letter"), so it doesn't have to be retyped. Client is deliberately left blank rather than copied — this is FOR a different client, picking the same one back would just be a no-op duplicate. */
  function startDuplicate(n: StaffNote) {
    setForm({ body: n.body, clientId: "", category: n.category || "", remindAt: n.remindAt ? n.remindAt.slice(0, 10) : "", visibility: "firm" });
    setSaveError(null);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5 }}>
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            Created by me
          </label>
          <input placeholder="Search notes…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ fontSize: 12.5, maxWidth: 220 }} />
          <button type="button" className="btn btn-sm btn-primary" style={{ marginLeft: "auto" }} onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "+ New Note"}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 10 }}>
            {saveError && <ErrorBanner error={saveError} />}
            <div className="field">
              <label htmlFor="note-body">Note</label>
              <textarea id="note-body" rows={3} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="e.g. AAA Carryout is missing a W-9 — chase before month-end." />
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div className="field" style={{ flex: "1 1 220px" }}>
                <label htmlFor="note-client">Client (optional)</label>
                <select id="note-client" value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}>
                  <option value="">No client — general note</option>
                  {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
                </select>
              </div>
              <div className="field" style={{ flex: "1 1 160px" }}>
                <label htmlFor="note-category">Category (optional)</label>
                <input id="note-category" list="note-category-list" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
                <datalist id="note-category-list">
                  {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="field" style={{ flex: "1 1 160px" }}>
                <label htmlFor="note-remind">Remind me on (optional)</label>
                <input id="note-remind" type="date" value={form.remindAt} onChange={(e) => setForm((f) => ({ ...f, remindAt: e.target.value }))} />
              </div>
              {isAdmin && (
                <div className="field" style={{ flex: "1 1 160px" }}>
                  <label htmlFor="note-visibility">Visible to</label>
                  <select id="note-visibility" value={form.visibility} onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.value as "firm" | "admin" }))}>
                    <option value="firm">Team</option>
                    <option value="admin">Admin Only</option>
                  </select>
                </div>
              )}
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ alignSelf: "flex-start" }}>{saving ? "Saving…" : "Save Note"}</button>
          </form>
        )}

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
                  <th scope="col">Category</th>
                  <th scope="col">Author</th>
                  <th scope="col">Remind</th>
                  <th scope="col">Created</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {notes.map((n) => {
                  const overdue = n.status === "Open" && n.remindAt && new Date(n.remindAt) <= new Date();
                  return (
                    <tr key={n.noteId} style={{ opacity: n.status === "Done" ? 0.6 : 1 }} onClick={() => n.unread && markRead(n.noteId)}>
                      <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(n.noteId)} onChange={() => toggleSelected(n.noteId)} /></td>
                      <td style={{ maxWidth: 360, fontWeight: n.unread ? 700 : 400 }}>
                        {n.unread && <span style={{ color: "var(--teal)" }}>● </span>}
                        {n.body}
                        {n.visibility === "admin" && <span className="badge" style={{ marginLeft: 8, fontSize: 10 }}>Admin Only</span>}
                      </td>
                      <td className="muted">{n.clientName || "—"}</td>
                      <td className="muted">{n.category || "—"}</td>
                      <td className="muted">{n.authorName || n.authorEmail}</td>
                      <td style={overdue ? { color: "var(--red)", fontWeight: 700 } : undefined}>{n.remindAt ? fmtRelative(n.remindAt) : "—"}</td>
                      <td className="muted">{fmtRelative(n.createdAt)}</td>
                      <td onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6 }}>
                        {n.status === "Open"
                          ? <button type="button" className="btn btn-sm" onClick={() => setStatus(n.noteId, "Done")}>Mark Done</button>
                          : <button type="button" className="btn btn-sm" onClick={() => setStatus(n.noteId, "Open")}>Reopen</button>}
                        <button type="button" className="btn btn-sm" title="Reuse this note's text for a different client" onClick={() => startDuplicate(n)}>Duplicate</button>
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => deleteOne(n.noteId)}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
