import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { FIRM_SERVICES } from "../utils/clientOptions";
import { useConfirm, useNotify } from "../components/ConfirmProvider";

interface ChecklistItem { item_id: string; document_name: string; sort_order: number }
interface Checklist { checklist_id: string; name: string; client_type: string | null; service_key: string | null; active: boolean; items: ChecklistItem[] }

const CLIENT_TYPES = ["", "Business", "Individual"];

/**
 * Admin-managed document checklist templates — Practice Management's "did we
 * collect everything we need" tracker. A template applies to a client_type
 * and/or a FIRM_SERVICES service (either left blank = applies regardless).
 * The per-client progress checklist itself lives on ClientDetailPage.tsx's
 * Documents tab (ClientChecklistSection), synced against whichever templates
 * here currently match that client.
 */
export function DocumentChecklistsPage() {
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const [checklists, setChecklists] = useState<Checklist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [clientType, setClientType] = useState("");
  const [serviceKey, setServiceKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [newItemName, setNewItemName] = useState<Record<string, string>>({});

  function load() {
    api.get<{ checklists: Checklist[] }>("/checklists")
      .then((res) => setChecklists(res.checklists))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load checklist templates."));
  }
  useEffect(load, []);

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.post("/checklists", { name: name.trim(), clientType, serviceKey });
      setName(""); setClientType(""); setServiceKey(""); setCreating(false);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not create this template.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteChecklist(id: string) {
    const ok = await confirmDialog({ title: "Delete checklist template", message: "Clients who already have progress against it keep their existing rows.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.post(`/checklists/${id}/delete`, {});
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this template.");
    }
  }

  async function handleAddItem(checklistId: string) {
    const documentName = (newItemName[checklistId] || "").trim();
    if (!documentName) return;
    try {
      await api.post(`/checklists/${checklistId}/items`, { documentName });
      setNewItemName((prev) => ({ ...prev, [checklistId]: "" }));
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not add this item.");
    }
  }

  async function handleDeleteItem(checklistId: string, itemId: string) {
    try {
      await api.post(`/checklists/${checklistId}/items/${itemId}/delete`, {});
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this item.");
    }
  }

  if (error) return <ErrorBanner error={error} />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Required-document templates by client type and/or service. Every client whose type/services match a template gets its items on their Documents tab automatically.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>{creating ? "Cancel" : "New Checklist"}</button>
      </div>

      {creating && (
        <div className="card" style={{ marginBottom: 16, padding: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ margin: 0, minWidth: 220 }}>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New Business Formation" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Client Type</label>
            <select value={clientType} onChange={(e) => setClientType(e.target.value)}>
              {CLIENT_TYPES.map((t) => <option key={t} value={t}>{t || "Any"}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0, minWidth: 220 }}>
            <label>Service</label>
            <select value={serviceKey} onChange={(e) => setServiceKey(e.target.value)}>
              <option value="">Any</option>
              {FIRM_SERVICES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" disabled={saving || !name.trim()} onClick={handleCreate}>{saving ? "Saving…" : "Create"}</button>
        </div>
      )}

      {!checklists ? (
        <div className="spinner-wrap">Loading…</div>
      ) : !checklists.length ? (
        <p className="muted">No checklist templates yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {checklists.map((c) => (
            <div key={c.checklist_id} className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
                <div>
                  <strong>{c.name}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {c.client_type || "Any client type"} · {c.service_key ? FIRM_SERVICES.find((s) => s.key === c.service_key)?.label || c.service_key : "Any service"}
                  </div>
                </div>
                <button className="btn btn-sm" onClick={() => handleDeleteChecklist(c.checklist_id)}>Delete</button>
              </div>
              <div style={{ padding: "8px 16px" }}>
                {c.items.map((item) => (
                  <div key={item.item_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
                    <span>{item.document_name}</span>
                    <button className="btn btn-sm" onClick={() => handleDeleteItem(c.checklist_id, item.item_id)}>Remove</button>
                  </div>
                ))}
                {!c.items.length && <p className="muted" style={{ fontSize: 12, margin: "6px 0" }}>No items yet.</p>}
                <div style={{ display: "flex", gap: 8, marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
                  <input
                    style={{ flex: 1 }}
                    placeholder="Add a required document…"
                    value={newItemName[c.checklist_id] || ""}
                    onChange={(e) => setNewItemName((prev) => ({ ...prev, [c.checklist_id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddItem(c.checklist_id); }}
                  />
                  <button className="btn btn-sm" onClick={() => handleAddItem(c.checklist_id)}>+ Add</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
