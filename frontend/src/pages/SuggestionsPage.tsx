import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmProvider";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { fmtDateTime } from "../utils/date";

interface Suggestion {
  suggestion_id: string;
  title: string;
  description: string | null;
  category: string | null;
  submitted_by_name: string | null;
  submitted_by_email: string | null;
  submitted_by_role: string | null;
  status: string;
  admin_note: string | null;
  status_updated_by: string | null;
  status_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

// Fixed short list rather than free text, same "pick a lane, not a raw string
// field" idea as clientFlagCategories — but this list only has one call site
// (the New Suggestion form below), unlike clientFlagCategories which is also
// read by ClientContextPanel.tsx and the List Settings admin screen, so it's
// kept as a plain local constant here rather than wired into the full
// admin-managed dropdown system (system.routes.ts's MANAGED_DROPDOWN_DEFAULTS)
// — that system exists for lists edited and reused in multiple places, and
// adding this one there would be more machinery than a single-field pick-list
// needs.
const CATEGORIES = ["Process Improvement", "Feature Request", "Bug / Issue", "Tooling", "Client Experience", "Other"];

const STATUSES = ["New", "Under Review", "Planned", "In Progress", "Done", "Declined"];

function NewSuggestionModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError("Title is required."); return; }
    setSaving(true);
    setError(null);
    try {
      await api.post("/suggestions", { title: title.trim(), description: description.trim() || undefined, category: category || undefined });
      toast("Suggestion submitted — thanks for the idea.");
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not submit this suggestion.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="new-suggestion-title" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2 id="new-suggestion-title">New Suggestion</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        {error && <ErrorBanner error={error} />}
        <form onSubmit={handleSubmit}>
          <div className="field"><label htmlFor="sug-title">Title</label><input id="sug-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Add a search box to Documents" autoFocus /></div>
          <div className="field"><label htmlFor="sug-category">Category</label>
            <select id="sug-category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Select a category…</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="sug-description">Description</label><textarea id="sug-description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's the idea, and why would it help?" /></div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || !title.trim()}>{saving ? "Submitting…" : "Submit Suggestion"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Firm-wide improvement-idea board for Admin + Staff — an open list, not a
 * private inbox to the owner. Anyone on the team can post an idea (POST
 * /suggestions); everyone sees the same list (GET /suggestions). Only Admin
 * gets the status-triage <select> and admin-note editor per row (PATCH
 * /suggestions/:id) plus Delete — enforced server-side by requireRole("admin")
 * on those routes, not just hidden here.
 */
export function SuggestionsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  function load() {
    api.get<{ suggestions: Suggestion[] }>("/suggestions")
      .then((res) => { setSuggestions(res.suggestions); setError(null); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load suggestions."));
  }
  useEffect(load, []);

  async function handleStatusChange(s: Suggestion, status: string) {
    try {
      await api.patch(`/suggestions/${s.suggestion_id}`, { status });
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not update status.");
    }
  }

  async function handleSaveNote(s: Suggestion) {
    const adminNote = noteDrafts[s.suggestion_id] ?? s.admin_note ?? "";
    try {
      await api.patch(`/suggestions/${s.suggestion_id}`, { adminNote });
      toast("Note saved.");
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not save this note.");
    }
  }

  async function handleDelete(s: Suggestion) {
    const ok = await confirmDialog({
      title: "Delete suggestion",
      message: `Delete "${s.title}"? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(`/suggestions/${s.suggestion_id}/delete`, {});
      load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not delete this suggestion.");
    }
  }

  if (error) return <ErrorBanner error={error} onRetry={load} />;
  if (!suggestions) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div>
      <p className="muted" style={{ marginBottom: 16, maxWidth: 720 }}>
        A shared idea board for the whole team — post anything that would make the day-to-day work better.
        Everyone sees every idea; Admin marks where each one stands and can leave a note explaining the call.
      </p>

      <div style={{ marginBottom: 16 }}>
        <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>+ New Suggestion</button>
      </div>

      {suggestions.length === 0 ? (
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>No suggestions yet — be the first to share an idea.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Category</th>
                <th scope="col">Submitted By</th>
                <th scope="col">Submitted</th>
                <th scope="col">Status</th>
                <th scope="col">Admin Note</th>
                {isAdmin && <th scope="col"></th>}
              </tr>
            </thead>
            <tbody>
              {suggestions.map((s) => (
                <tr key={s.suggestion_id}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{s.title}</div>
                    {s.description && <div className="muted" style={{ fontSize: 12.5, marginTop: 2, maxWidth: 320 }}>{s.description}</div>}
                  </td>
                  <td>{s.category || "—"}</td>
                  <td>
                    {s.submitted_by_name || s.submitted_by_email || "—"}
                    {s.submitted_by_role && <div className="muted" style={{ fontSize: 12 }}>{s.submitted_by_role}</div>}
                  </td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(s.created_at)}</td>
                  <td>
                    {isAdmin ? (
                      <select value={s.status} onChange={(e) => handleStatusChange(s, e.target.value)}>
                        {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                      </select>
                    ) : (
                      <StatusBadge status={s.status} />
                    )}
                  </td>
                  <td style={{ minWidth: 200 }}>
                    {isAdmin ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <textarea
                          rows={2}
                          value={noteDrafts[s.suggestion_id] ?? s.admin_note ?? ""}
                          onChange={(e) => setNoteDrafts((d) => ({ ...d, [s.suggestion_id]: e.target.value }))}
                          placeholder="Note back to the team…"
                          style={{ flex: 1, fontSize: 12.5 }}
                        />
                        <button type="button" className="btn btn-sm" onClick={() => handleSaveNote(s)}>Save</button>
                      </div>
                    ) : (
                      s.admin_note ? <span style={{ fontSize: 12.5 }}>{s.admin_note}</span> : <span className="muted">—</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDelete(s)}>Delete</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && <NewSuggestionModal onClose={() => setShowNew(false)} onDone={load} />}
    </div>
  );
}
