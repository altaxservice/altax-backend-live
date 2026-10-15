import { useCallback, useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { StickyNote, Plus, Pencil, Trash2, ChevronDown, Check } from "lucide-react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useConfirm } from "./ConfirmProvider";

/**
 * Page Note — a note pinned to the page you are on. It opens, hard to miss, when you arrive; "Got it" folds it to a slim bar that stays on
 * the page. It opens again by itself when someone edits it, and on a new day. Priorities colour it (Info / Important / Critical), lines
 * that start with [ ] become tick-boxes, and a note can wait for a date or retire itself after one. Staff and admin only.
 */
interface Note {
  noteId: string; pageKey: string; tab: string | null; title: string | null; body: string;
  priority: "Info" | "Important" | "Critical"; visibility: "firm" | "admin" | "me";
  showFrom: string | null; showUntil: string | null; hidden: boolean;
  createdBy: string; createdByName: string | null; createdAt: string; updatedBy: string | null; updatedAt: string;
  ackedVersion: string | null; ackedOn: string | null; mine: boolean; canEdit: boolean;
}
interface Payload { today: string; notes: Note[]; isAdmin: boolean }

/** The exact page: "/accounting", or one client's page "/clients/c-1063" — never a pattern shared with other pages. */
export function pageKeyFor(pathname: string): string {
  const parts = pathname.toLowerCase().split("/").filter(Boolean);
  return parts.length ? `/${parts.join("/")}` : "/";
}

const TONE = { Info: "info", Important: "important", Critical: "critical" } as const;
const VIS_LABEL = { firm: "Everyone on staff", admin: "Administrators only", me: "Only you" } as const;
const CHECK_RE = /^(\s*(?:[-*]\s*)?)\[( |x|X)\]\s*(.*)$/;

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function NoteBody({ note, onToggle }: { note: Note; onToggle: (lineIndex: number) => void }) {
  const lines = note.body.split("\n");
  return (
    <div className="pnote-body">
      {lines.map((line, i) => {
        const m = line.match(CHECK_RE);
        if (m) {
          const done = m[2].toLowerCase() === "x";
          return (
            <label key={i} className={`pnote-check${done ? " done" : ""}`}>
              <input type="checkbox" checked={done} disabled={!note.canEdit} onChange={() => onToggle(i)} />
              <span>{m[3]}</span>
            </label>
          );
        }
        return line.trim() ? <p key={i}>{line}</p> : <div key={i} className="pnote-gap" />;
      })}
    </div>
  );
}

interface Draft { noteId: string | null; title: string; body: string; priority: Note["priority"]; visibility: Note["visibility"]; tabOnly: boolean; showFrom: string; showUntil: string }
const EMPTY: Draft = { noteId: null, title: "", body: "", priority: "Info", visibility: "firm", tabOnly: false, showFrom: "", showUntil: "" };

export function PageNote({ pageTitle }: { pageTitle: string }) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const location = useLocation();
  const [params] = useSearchParams();
  const allowed = user?.role === "admin" || user?.role === "staff";
  const page = pageKeyFor(location.pathname);
  const tab = (params.get("tab") || "").toLowerCase();
  const [data, setData] = useState<Payload | null>(null);
  const [forceOpen, setForceOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!allowed) return;
    api.get<Payload>(`/page-notes?page=${encodeURIComponent(page)}${tab ? `&tab=${encodeURIComponent(tab)}` : ""}`).then(setData).catch(() => setData(null));
  }, [allowed, page, tab]);
  useEffect(() => { setData(null); setForceOpen(false); setDraft(null); setShowHidden(false); setError(null); load(); }, [load]);

  if (!allowed) return null;
  const today = data?.today || "";
  const live = (data?.notes || []).filter((n) => !n.hidden);
  const hiddenNotes = (data?.notes || []).filter((n) => n.hidden);
  const me = (user?.email || "").toLowerCase();

  // Smart part: a note needs your attention when you never acknowledged it, it was edited since, or it is a new day.
  const attention = (n: Note) => !n.ackedVersion || new Date(n.updatedAt) > new Date(n.ackedVersion) || n.ackedOn !== today;
  const changedByOther = (n: Note) => Boolean(n.ackedVersion) && new Date(n.updatedAt) > new Date(n.ackedVersion!) && (n.updatedBy || "").toLowerCase() !== me;
  const brandNew = (n: Note) => !n.ackedVersion;
  const open = forceOpen || live.some(attention);
  const top = live[0]?.priority || "Info";

  async function ackAll() {
    setForceOpen(false);
    await Promise.all(live.filter(attention).map((n) => api.post(`/page-notes/${n.noteId}/ack`).catch(() => {})));
    load();
  }
  async function toggleLine(n: Note, i: number) {
    const lines = n.body.split("\n");
    const m = lines[i].match(CHECK_RE);
    if (!m) return;
    lines[i] = `${m[1]}[${m[2].toLowerCase() === "x" ? " " : "x"}] ${m[3]}`;
    try { await api.patch(`/page-notes/${n.noteId}`, { body: lines.join("\n") }); load(); } catch (e) { setError(e instanceof ApiError ? e.message : "Could not update the note."); }
  }
  async function save() {
    if (!draft) return;
    setBusy(true); setError(null);
    const payload = {
      page, tab: draft.tabOnly && tab ? tab : null, title: draft.title, body: draft.body, priority: draft.priority, visibility: draft.visibility,
      showFrom: draft.showFrom || null, showUntil: draft.showUntil || null,
    };
    try {
      if (draft.noteId) await api.patch(`/page-notes/${draft.noteId}`, payload); else await api.post("/page-notes", payload);
      setDraft(null); load();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not save the note."); } finally { setBusy(false); }
  }
  async function remove(n: Note) {
    if (!(await confirm({ title: "Delete this page note?", message: n.title || n.body.slice(0, 80), confirmLabel: "Delete", danger: true }))) return;
    try { await api.delete(`/page-notes/${n.noteId}`); load(); } catch (e) { setError(e instanceof ApiError ? e.message : "Could not delete the note."); }
  }
  const edit = (n: Note) => setDraft({ noteId: n.noteId, title: n.title || "", body: n.body, priority: n.priority, visibility: n.visibility, tabOnly: Boolean(n.tab), showFrom: n.showFrom || "", showUntil: n.showUntil || "" });

  // ---------- the editor ----------
  const editor = draft && (
    <div className="pnote-edit" role="group" aria-label={draft.noteId ? "Edit page note" : "New page note"}>
      <div className="pnote-grid">
        <div className="field"><label htmlFor="pn-title">Title <span className="muted">(optional)</span></label><input id="pn-title" value={draft.title} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Before you import sales" /></div>
        <div className="field"><label htmlFor="pn-pri">Importance</label>
          <select id="pn-pri" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Note["priority"] })}>
            <option value="Info">Info — a reminder</option><option value="Important">Important — don't skip it</option><option value="Critical">Critical — stop and read</option>
          </select></div>
      </div>
      <div className="field"><label htmlFor="pn-body">Note</label>
        <textarea id="pn-body" rows={5} value={draft.body} maxLength={4000} autoFocus onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          placeholder={"What should you remember when you work on this page?\nStart a line with [ ] to make a tick-box."} />
      </div>
      <div className="pnote-grid">
        <div className="field"><label htmlFor="pn-vis">Who sees it</label>
          <select id="pn-vis" value={draft.visibility} onChange={(e) => setDraft({ ...draft, visibility: e.target.value as Note["visibility"] })}>
            <option value="firm">{VIS_LABEL.firm}</option>{data?.isAdmin && <option value="admin">{VIS_LABEL.admin}</option>}<option value="me">{VIS_LABEL.me}</option>
          </select></div>
        <div className="field"><label htmlFor="pn-from">Show from <span className="muted">(optional)</span></label><input id="pn-from" type="date" value={draft.showFrom} onChange={(e) => setDraft({ ...draft, showFrom: e.target.value })} /></div>
        <div className="field"><label htmlFor="pn-until">Show until <span className="muted">(optional)</span></label><input id="pn-until" type="date" value={draft.showUntil} onChange={(e) => setDraft({ ...draft, showUntil: e.target.value })} /></div>
      </div>
      {tab && <label className="pnote-tabonly"><input type="checkbox" checked={draft.tabOnly} onChange={(e) => setDraft({ ...draft, tabOnly: e.target.checked })} /> Only on the “{tab}” tab (otherwise it shows on every tab of this page)</label>}
      {error && <div className="tender-warn" style={{ color: "var(--red)", marginTop: 8 }}>{error}</div>}
      <div className="pnote-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !draft.body.trim()} onClick={save}>{busy ? "Saving…" : "Save note"}</button>
        <button type="button" className="btn btn-sm" onClick={() => { setDraft(null); setError(null); }}>Cancel</button>
      </div>
    </div>
  );

  const noteCard = (n: Note) => (
    <div key={n.noteId} className={`pnote-item tone-${TONE[n.priority]}${n.hidden ? " is-hidden" : ""}`}>
      <div className="pnote-item-head">
        {n.title ? <strong>{n.title}</strong> : null}
        {n.priority !== "Info" && <span className={`pnote-chip tone-${TONE[n.priority]}`}>{n.priority}</span>}
        {brandNew(n) && !n.mine ? <span className="pnote-chip new">New</span> : changedByOther(n) ? <span className="pnote-chip new">Updated</span> : null}
        {n.hidden && <span className="pnote-chip muted">{n.showFrom && n.showFrom > today ? `Shows ${fmtDay(n.showFrom)}` : "Expired"}</span>}
      </div>
      <NoteBody note={n} onToggle={(i) => toggleLine(n, i)} />
      <div className="pnote-meta">
        <span>{n.createdByName || n.createdBy}{n.updatedBy && n.updatedBy.toLowerCase() !== n.createdBy.toLowerCase() ? ` · edited by ${n.updatedBy}` : ""} · {ago(n.updatedAt)}</span>
        <span>{VIS_LABEL[n.visibility]}{n.tab ? ` · ${n.tab} tab only` : ""}{n.showUntil ? ` · until ${fmtDay(n.showUntil)}` : ""}</span>
        {n.canEdit && (
          <span className="pnote-item-actions">
            <button type="button" className="pnote-link" onClick={() => edit(n)}><Pencil size={12} aria-hidden="true" /> Edit</button>
            <button type="button" className="pnote-link danger" onClick={() => remove(n)}><Trash2 size={12} aria-hidden="true" /> Delete</button>
          </span>
        )}
      </div>
    </div>
  );

  // ---------- nothing to show: a quiet "add" link ----------
  if (data && !live.length && !draft) {
    return (
      <div className="pnote-empty">
        <button type="button" className="pnote-link" onClick={() => setDraft({ ...EMPTY })}><Plus size={13} aria-hidden="true" /> Page note for {pageTitle}</button>
        {hiddenNotes.length > 0 && <button type="button" className="pnote-link" onClick={() => setShowHidden((v) => !v)}>{hiddenNotes.length} scheduled or expired</button>}
        {showHidden && <div className="pnote pnote-hiddenlist">{hiddenNotes.map(noteCard)}</div>}
      </div>
    );
  }
  if (!data) return null;

  // ---------- the banner ----------
  if (!open && !draft) {
    const first = live[0];
    const preview = (first.title || first.body.split("\n").find((l) => l.trim()) || "").replace(CHECK_RE, "$3");
    return (
      <div className={`pnote pnote-slim tone-${TONE[top]}`} role="region" aria-label="Page note">
        <button type="button" className="pnote-slim-main" aria-expanded={false} onClick={() => setForceOpen(true)}>
          <StickyNote size={15} aria-hidden="true" />
          <span className="pnote-eyebrow">Page note</span>
          <span className="pnote-preview">{preview}</span>
          {live.length > 1 && <span className="pnote-chip muted">+{live.length - 1} more</span>}
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <button type="button" className="pnote-link" onClick={() => setDraft({ ...EMPTY })} aria-label="Add a page note"><Plus size={13} aria-hidden="true" /> Add</button>
      </div>
    );
  }
  return (
    <div className={`pnote pnote-open tone-${TONE[top]}`} role="region" aria-label="Page note">
      <div className="pnote-head">
        <div className="pnote-eyebrow-row"><StickyNote size={16} aria-hidden="true" /><span className="pnote-eyebrow">Page note · {pageTitle}{tab ? ` · ${tab}` : ""} — only on this page</span></div>
        <div className="pnote-head-actions">
          {!draft && <button type="button" className="pnote-link" onClick={() => setDraft({ ...EMPTY })}><Plus size={13} aria-hidden="true" /> Add</button>}
          {live.length > 0 && <button type="button" className="btn btn-sm btn-primary" onClick={ackAll}><Check size={13} aria-hidden="true" /> Got it</button>}
        </div>
      </div>
      {live.map(noteCard)}
      {error && !draft && <div className="tender-warn" style={{ color: "var(--red)", marginTop: 8 }}>{error}</div>}
      {editor}
      {hiddenNotes.length > 0 && (
        <div className="pnote-hiddenwrap">
          <button type="button" className="pnote-link" onClick={() => setShowHidden((v) => !v)}>{showHidden ? "Hide" : "Show"} {hiddenNotes.length} scheduled or expired</button>
          {showHidden && hiddenNotes.map(noteCard)}
        </div>
      )}
    </div>
  );
}
