import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { api } from "../api/client";
import type { RowNoteData } from "./RowNote";

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return mins < 2 ? "just now" : `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** Command Center: every row note marked "Needs attention" that nobody has resolved yet, so a problem flagged on one row is not forgotten. */
export function RowNotesAttentionPanel() {
  const [notes, setNotes] = useState<RowNoteData[] | null>(null);
  const load = useCallback(() => {
    api.get<{ notes: RowNoteData[] }>("/row-notes/attention").then((r) => setNotes(r.notes)).catch(() => setNotes([]));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener("row-notes-changed", load);
    return () => window.removeEventListener("row-notes-changed", load);
  }, [load]);
  if (!notes || notes.length === 0) return null;

  async function resolve(n: RowNoteData) {
    await api.post(`/row-notes/${n.noteId}/resolve`, { resolved: true }).catch(() => {});
    window.dispatchEvent(new Event("row-notes-changed"));
  }

  return (
    <div className="command-panel command-panel-critical" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <div>
          <h2 className="command-panel-title">Notes that need attention</h2>
          <div className="command-panel-note">{notes.length} row{notes.length === 1 ? "" : "s"} flagged — write or clear one with the note icon at the end of any row</div>
        </div>
      </div>
      <div>
        {notes.slice(0, 8).map((n) => (
          <div key={n.noteId} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
            <AlertTriangle size={16} color="var(--red)" style={{ marginTop: 2, flex: "none" }} aria-hidden="true" />
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                {n.link ? <Link to={n.link}>{n.label || n.key}</Link> : (n.label || n.key)}
                {n.clientName && <span className="muted" style={{ fontWeight: 600 }}> · <Link to={`/clients/${n.clientId}`}>{n.clientName}</Link></span>}
              </div>
              <div style={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>{n.body.length > 220 ? `${n.body.slice(0, 220)}…` : n.body}</div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{n.createdByName} · {ago(n.updatedAt)}</div>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => resolve(n)}>Mark resolved</button>
          </div>
        ))}
        {notes.length > 8 && <div className="muted" style={{ padding: "9px 16px", fontSize: 12.5 }}>+ {notes.length - 8} more flagged notes</div>}
      </div>
    </div>
  );
}
