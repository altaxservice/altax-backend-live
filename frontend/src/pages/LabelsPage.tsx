import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { LabelChips, type LabelInfo } from "../components/Labels";
import { useConfirm, useNotify } from "../components/ConfirmProvider";

const DEFAULT_COLOR = "#0f2d3e";

/**
 * Admin-managed label palette — name + color, reusable everywhere labels show
 * up (Tasks, Clients, ...). Deleting a label here removes it from every record
 * it was on (v3_entity_labels cascades), same "changes here don't rewrite past
 * records" caveat as List Settings, just the opposite direction: a label is
 * live everywhere it's attached, not a frozen snapshot on save.
 */
export function LabelsPage() {
  const notify = useNotify();
  const confirmDialog = useConfirm();
  const [labels, setLabels] = useState<LabelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(DEFAULT_COLOR);

  function load() {
    api.get<{ labels: LabelInfo[] }>("/labels")
      .then((res) => { setLabels(res.labels); setError(null); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load labels."));
  }
  useEffect(load, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.post("/labels", { name: name.trim(), color });
      setName("");
      setColor(DEFAULT_COLOR);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not create this label.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(l: LabelInfo) {
    setEditingId(l.label_id);
    setEditName(l.name);
    setEditColor(l.color);
  }

  async function handleSaveEdit(labelId: string) {
    if (!editName.trim()) return;
    try {
      await api.patch(`/labels/${labelId}`, { name: editName.trim(), color: editColor });
      setEditingId(null);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not save this label.");
    }
  }

  async function handleDelete(l: LabelInfo) {
    const ok = await confirmDialog({
      title: "Delete label",
      message: `Delete "${l.name}"? It will be removed from every task/client it's currently on.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(`/labels/${l.label_id}/delete`, {});
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this label.");
    }
  }

  const filteredLabels = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? (labels || []).filter((l) => l.name.toLowerCase().includes(q)) : labels || [];
  }, [labels, search]);

  if (error) return <ErrorBanner error={error} onRetry={load} />;
  if (!labels) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div>
      <p className="muted" style={{ marginBottom: 16, maxWidth: 720 }}>
        A firm-wide set of colored labels you can attach to Tasks and Clients — helpful for anything a status field
        doesn't cover (e.g. "VIP", "Needs Callback", "New Client"). Deleting a label here removes it everywhere it's attached.
      </p>

      <form onSubmit={handleCreate} className="card" style={{ maxWidth: 420, marginBottom: 20, display: "flex", gap: 10, alignItems: "flex-end" }}>
        <div className="field" style={{ flex: 1, margin: 0 }}>
          <label htmlFor="label-name">New label</label>
          <input id="label-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VIP" />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="label-color">Color</label>
          <input id="label-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 44, height: 34, padding: 2 }} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>{saving ? "Adding…" : "Add"}</button>
      </form>

      <div style={{ marginBottom: 14 }}>
        <input placeholder="Search labels…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", width: 200 }} />
      </div>

      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Preview</th><th scope="col">Name</th><th scope="col">Color</th><th scope="col"></th></tr></thead>
          <tbody>
            {filteredLabels.map((l) => (
              <tr key={l.label_id}>
                {editingId === l.label_id ? (
                  <>
                    <td><LabelChips labels={[{ label_id: l.label_id, name: editName || l.name, color: editColor }]} /></td>
                    <td><input value={editName} onChange={(e) => setEditName(e.target.value)} /></td>
                    <td><input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} style={{ width: 40, height: 30, padding: 2 }} /></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => handleSaveEdit(l.label_id)}>Save</button>{" "}
                      <button type="button" className="btn btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td><LabelChips labels={[l]} /></td>
                    <td>{l.name}</td>
                    <td className="muted">{l.color}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="btn btn-sm" onClick={() => startEdit(l)}>Edit</button>{" "}
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDelete(l)}>Delete</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filteredLabels.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>{labels.length === 0 ? "No labels yet — add one above." : "No labels match."}</p>}
    </div>
  );
}
