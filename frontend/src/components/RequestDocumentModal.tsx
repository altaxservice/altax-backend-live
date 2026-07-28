import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { WebOptions } from "../api/types2";
import { useToast } from "./Toast";
import { ErrorBanner } from "./ErrorBanner";

const OTHER = "Other";

/**
 * Requests a document from ONE client — always locked, no client picker. Replaces
 * every "Request Document" entry point that used to bounce out to the global
 * Documents page and open NewWorkItemModal's multi-client fan-out picker even when
 * the caller already knew exactly which client (a row action on the Clients list, a
 * button on a client's own profile, a task's own "request a doc for this" action) —
 * that picker exists for the real cross-client case (asking every client for their
 * Q2 sales tax report at once), which stays on the global page. This one is for
 * "I'm looking at Client X, get them to send me something."
 */
export function RequestDocumentModal({ clientId, clientName, employeeId, employeeName, taskId, onClose, onDone }: {
  clientId: string;
  clientName: string;
  /** When set, the request is addressed to this one employee instead of the client generally — clientId/clientName are still required for display and are ignored server-side in favor of the employee's own client. */
  employeeId?: string;
  employeeName?: string;
  taskId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [options, setOptions] = useState<WebOptions | null>(null);
  const [requestType, setRequestType] = useState("Document Request");
  const [requestedItem, setRequestedItem] = useState("");
  const [requestedItemOther, setRequestedItemOther] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [assignedTo, setAssignedTo] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.get<WebOptions>("/system/options").then(setOptions).catch(() => {}); }, []);

  const requestTypeOptions = options?.requestTypes || [];
  const requestedItemOptions = options?.requestedItems || [];
  const priorityOptions = options?.priorities || ["Normal", "Low", "High", "Urgent"];
  const staffOptions = options?.staff || [];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const finalRequestedItem = requestedItem === OTHER ? requestedItemOther.trim() : requestedItem;
    if (!finalRequestedItem) { setError("Requested item is required."); return; }

    setSaving(true);
    setError(null);
    try {
      await api.post("/documents/requests", {
        clientId: employeeId ? undefined : clientId, employeeId: employeeId || undefined,
        requestedItem: finalRequestedItem, taskId: taskId || undefined,
        dueDate: dueDate || undefined, priority, assignedTo: assignedTo || undefined,
        requestType, notes: notes || undefined,
      });
      toast(`Request sent to ${employeeName || clientName}.`);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create this request.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Request Document — {employeeName || clientName}</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        <form onSubmit={handleSubmit}>
          {error && <ErrorBanner error={error} />}

          <div className="field">
            <label htmlFor="rd-item">Requested Item</label>
            <select id="rd-item" required value={requestedItem} onChange={(e) => setRequestedItem(e.target.value)}>
              <option value="">Select…</option>
              {requestedItemOptions.map((o) => <option key={o}>{o}</option>)}
              <option value={OTHER}>{OTHER}</option>
            </select>
          </div>
          {requestedItem === OTHER && (
            <div className="field"><label htmlFor="rd-item-other">Describe what's needed</label><input id="rd-item-other" required value={requestedItemOther} onChange={(e) => setRequestedItemOther(e.target.value)} /></div>
          )}
          <div className="field">
            <label htmlFor="rd-type">Request Type</label>
            <select id="rd-type" value={requestType} onChange={(e) => setRequestType(e.target.value)}>
              {requestTypeOptions.length === 0 && <option value={requestType}>{requestType}</option>}
              {requestTypeOptions.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label htmlFor="rd-due">Due From Client</label><input id="rd-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
            <div className="field">
              <label htmlFor="rd-priority">Priority</label>
              <select id="rd-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                {priorityOptions.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="rd-owner">Assigned To</label>
            <select id="rd-owner" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">Use client default staff</option>
              {staffOptions.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="rd-notes">Notes <span className="muted">(optional)</span></label><textarea id="rd-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Sending…" : "Send Request"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
