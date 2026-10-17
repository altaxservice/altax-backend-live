import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { StickyNote, Check, AlertTriangle } from "lucide-react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useConfirm, useNotify } from "./ConfirmProvider";

/**
 * Row Notes — put a note on any row of a table, a card or an amount. A small note icon sits at the end of the row; point at it (or tap it)
 * and the note appears; click to write, change or delete it. "Needs attention" turns the icon red and lists the note on the Command Center
 * until it is marked resolved. The row is named by (type, clientId, id), chosen by the screen, so the same filing shows the same note on the
 * Filing Tracker and on the client's own filing table.
 *
 * Use it in three lines on any screen:
 *   const notes = useRowNotes("invoice");                              // loads the notes for that kind of row
 *   <RowNote notes={notes} type="invoice" id={inv.invoice_id} clientId={inv.client_id} label={`Invoice ${inv.invoice_id}`} />
 * `label` is the plain-words name shown in the Command Center list.
 */
export interface RowNoteData {
  noteId: string; type: string; clientId: string; key: string; label: string | null; link: string | null; body: string;
  attention: boolean; resolved: boolean; resolvedAt: string | null; resolvedBy: string | null;
  createdBy: string; createdByName: string; createdAt: string; updatedBy: string | null; updatedAt: string; clientName?: string;
}
export interface RowNotesApi {
  get: (type: string, clientId: string, id: string) => RowNoteData | undefined;
  save: (input: { type: string; clientId: string; id: string; label: string; body: string; attention: boolean }) => Promise<void>;
  resolve: (note: RowNoteData, resolved: boolean) => Promise<void>;
  remove: (note: RowNoteData) => Promise<void>;
}

const CHANGED = "row-notes-changed";
const k = (type: string, clientId: string, id: string) => `${type}|${clientId || ""}|${id}`;

/** Loads the notes for one or more kinds of row (and one client, when the screen is about one client) and keeps them current. */
export function useRowNotes(types: string | string[], clientId?: string | null): RowNotesApi {
  const typeList = Array.isArray(types) ? types.join(",") : types;
  const [map, setMap] = useState<Record<string, RowNoteData>>({});
  const reloadRef = useRef<() => void>(() => {});

  const load = useCallback(() => {
    const q = new URLSearchParams({ types: typeList });
    if (clientId) q.set("clientId", clientId);
    api.get<{ notes: RowNoteData[] }>(`/row-notes?${q.toString()}`)
      .then((r) => { const m: Record<string, RowNoteData> = {}; for (const n of r.notes) m[k(n.type, n.clientId, n.key)] = n; setMap(m); })
      .catch(() => { /* a screen still works without its notes */ });
  }, [typeList, clientId]);
  reloadRef.current = load;
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const on = () => reloadRef.current();
    window.addEventListener(CHANGED, on);
    return () => window.removeEventListener(CHANGED, on);
  }, []);

  return useMemo<RowNotesApi>(() => {
    const put = (n: RowNoteData) => setMap((m) => ({ ...m, [k(n.type, n.clientId, n.key)]: n }));
    const announce = () => window.dispatchEvent(new Event(CHANGED));
    return {
      get: (type, cid, id) => map[k(type, cid, id)],
      save: async ({ type, clientId: cid, id, label, body, attention }) => {
        const r = await api.put<{ note: RowNoteData }>("/row-notes", { type, clientId: cid, key: id, label, body, attention, link: window.location.pathname + window.location.search });
        put(r.note); announce();
      },
      resolve: async (note, resolved) => { const r = await api.post<{ note: RowNoteData }>(`/row-notes/${note.noteId}/resolve`, { resolved }); put(r.note); announce(); },
      remove: async (note) => {
        await api.delete(`/row-notes/${note.noteId}`);
        setMap((m) => { const c = { ...m }; delete c[k(note.type, note.clientId, note.key)]; return c; }); announce();
      },
    };
  }, [map]);
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function RowNote({ notes, type, id, clientId = "", label, className }: { notes: RowNotesApi; type: string; id: string; clientId?: string; label: string; className?: string }) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const notify = useNotify();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [mode, setMode] = useState<"closed" | "peek" | "edit">("closed");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [text, setText] = useState("");
  const [attention, setAttention] = useState(false);
  const [busy, setBusy] = useState(false);
  const note = notes.get(type, clientId, id);
  const canUse = user?.role === "admin" || user?.role === "staff";

  const place = useCallback(() => {
    const el = btn.current; if (!el) return;
    const r = el.getBoundingClientRect(); const w = 330; const h = pop.current?.offsetHeight || 220;
    const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    const below = r.bottom + 8; const top = below + h > window.innerHeight - 8 && r.top - h - 8 > 8 ? r.top - h - 8 : below;
    setPos({ top, left });
  }, []);
  useLayoutEffect(() => { if (mode !== "closed") place(); }, [mode, note, text, place]);
  useEffect(() => {
    if (mode === "closed") return;
    const close = () => setMode("closed");
    const down = (e: MouseEvent) => { if (mode === "edit" && !pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("scroll", close, true); window.addEventListener("resize", close);
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [mode]);

  if (!canUse) return null;

  const hover = (on: boolean) => {
    window.clearTimeout(timer.current);
    if (on) timer.current = window.setTimeout(() => setMode((m) => (m === "closed" ? "peek" : m)), 140);
    else timer.current = window.setTimeout(() => setMode((m) => (m === "peek" ? "closed" : m)), 200);
  };
  const startEdit = () => { window.clearTimeout(timer.current); setText(note?.body || ""); setAttention(note ? note.attention : false); setMode("edit"); };

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (err) { await notify(err instanceof ApiError ? err.message : "Could not save the note."); } finally { setBusy(false); }
  }
  const save = () => run(async () => { await notes.save({ type, clientId, id, label, body: text, attention }); setMode("closed"); });
  const del = async () => {
    if (!note) return;
    if (!(await confirm({ title: "Delete this note?", message: "The note on this row will be removed for everyone.", confirmLabel: "Delete", danger: true }))) return;
    await run(async () => { await notes.remove(note); setMode("closed"); });
  };

  const state = !note ? "" : note.attention && !note.resolved ? "attn" : note.resolved ? "done" : "has";
  const Icon = state === "attn" ? AlertTriangle : state === "done" ? Check : StickyNote;
  const aria = note ? `Note on ${label}: ${note.body}` : `Add a note to ${label}`;

  return (
    <>
      <button ref={btn} type="button" className={`rn-btn ${state} ${className || ""}`} aria-label={aria} aria-haspopup="dialog" aria-expanded={mode !== "closed"}
        onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)} onFocus={() => hover(true)} onBlur={() => hover(false)}
        onClick={(e) => { e.stopPropagation(); mode === "edit" ? setMode("closed") : startEdit(); }}>
        <Icon size={15} strokeWidth={2.2} />
      </button>
      {mode !== "closed" && pos && createPortal(
        <div ref={pop} className={`rn-pop ${state}`} role="dialog" aria-label={`Note on ${label}`} style={{ top: pos.top, left: pos.left }}
          onMouseEnter={() => { window.clearTimeout(timer.current); }} onMouseLeave={() => hover(false)}>
          <div className="rn-label">{label}</div>
          {mode === "peek" && (note ? (
            <>
              <div className="rn-status">{note.attention && !note.resolved ? <span className="rn-tag attn">Needs attention</span> : note.resolved ? <span className="rn-tag done">Resolved</span> : <span className="rn-tag">Note</span>}</div>
              <div className="rn-body">{note.body}</div>
              <div className="rn-meta">{note.createdByName} · {when(note.updatedAt)}{note.resolved && note.resolvedBy ? ` · resolved by ${note.resolvedBy}` : ""}</div>
              <div className="rn-hint">Click the icon to edit</div>
            </>
          ) : <div className="rn-hint" style={{ marginTop: 6 }}>No note yet. Click to add one to this row.</div>)}
          {mode === "edit" && (
            <>
              <textarea className="rn-text" autoFocus rows={4} maxLength={2000} value={text} placeholder="e.g. Attention: this period has a problem. Fix it before sending."
                onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim()) save(); }} />
              <label className="rn-check"><input type="checkbox" checked={attention} onChange={(e) => setAttention(e.target.checked)} /> Needs attention <span className="muted">(red icon, listed on the Command Center)</span></label>
              <div className="rn-actions">
                <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={save}>Save</button>
                <button type="button" className="btn" disabled={busy} onClick={() => setMode("closed")}>Cancel</button>
                {note && note.attention && !note.resolved && <button type="button" className="btn" disabled={busy} onClick={() => run(async () => { await notes.resolve(note, true); setMode("closed"); })}>Mark resolved</button>}
                {note && note.resolved && <button type="button" className="btn" disabled={busy} onClick={() => run(async () => { await notes.resolve(note, false); setMode("closed"); })}>Re-open</button>}
                {note && <button type="button" className="btn btn-danger" disabled={busy} onClick={del} style={{ marginLeft: "auto" }}>Delete</button>}
              </div>
              {note && <div className="rn-meta">Written by {note.createdByName} · {when(note.createdAt)}{note.updatedAt !== note.createdAt ? ` · edited ${when(note.updatedAt)}` : ""}</div>}
            </>
          )}
        </div>, document.body)}
    </>
  );
}
