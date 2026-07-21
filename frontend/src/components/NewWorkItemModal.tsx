import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Client } from "../api/types";
import type { WebOptions } from "../api/types2";
import { fileToBase64, MAX_UPLOAD_BYTES } from "../utils/file";
import { useToast } from "./Toast";

type Mode = "task" | "request";
const OTHER = "Other";

/**
 * Mirrors legacy's "New Work Item" modal: a combined Task/Request creator that can fan
 * out to multiple selected clients at once (client picker with the same search/status/
 * sales-tax/payroll filters as Create Batch Tasks), rather than the single-client form
 * this replaced. Dropdown lists (task types, request types, requested items, months,
 * priorities, staff) come from GET /system/options — the same centralized list the rest
 * of the app uses, rather than hardcoding a second copy. `initialTaskId`/`initialMode`
 * let a caller (e.g. Tasks' "Request Document" row action) pre-link the created request
 * back to the originating task and jump straight to Request mode. Legacy also has a "Sub Type /
 * Form" field here with no backend column anywhere in v3_tasks — omitted rather than
 * faked; see project_polish_backlog memory. "Month(s)" has no backend field either — a
 * request selecting multiple months fans out to one request per client per month.
 */
export function NewWorkItemModal({ initialClientId, initialTaskId, initialMode, onClose, onDone }: {
  initialClientId?: string; initialTaskId?: string; initialMode?: Mode; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>(initialMode || "task");
  const [clients, setClients] = useState<Client[]>([]);
  const [options, setOptions] = useState<WebOptions | null>(null);
  const [addClientId, setAddClientId] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [salesTaxFilter, setSalesTaxFilter] = useState("all");
  const [payrollFilter, setPayrollFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set(initialClientId ? [initialClientId] : []));
  const [internalTask, setInternalTask] = useState(false);
  // A "Create Task"/"+ New Task" action on a client's own row or profile page
  // navigates here with initialClientId set — in that case the searchable,
  // 100+ row roster below is pure friction (the user already picked their
  // client, they shouldn't have to find it again). Locked mode swaps that
  // picker for a one-line "creating for X" banner; "Change Client" drops back
  // to the full roster for the multi-client batch-create case this modal also
  // serves when opened without a specific client in mind.
  const [clientLocked, setClientLocked] = useState(!!initialClientId);

  const [taskType, setTaskType] = useState("Custom");
  const [taskName, setTaskName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [period, setPeriod] = useState("");
  const [paymentRequired, setPaymentRequired] = useState(false);

  const [requestType, setRequestType] = useState("Document Request");
  const [requestedItem, setRequestedItem] = useState("");
  const [requestedItemOther, setRequestedItemOther] = useState("");
  const [months, setMonths] = useState<string[]>([]);
  const [priority, setPriority] = useState("Normal");

  const [file, setFile] = useState<File | null>(null);
  const [attachmentName, setAttachmentName] = useState("");
  const [attachmentLink, setAttachmentLink] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ clients: Client[] }>("/clients").then((res) => setClients(res.clients)).catch(() => {});
    api.get<WebOptions>("/system/options").then(setOptions).catch(() => {});
  }, []);

  const staffOptions = options?.staff || [];
  const taskTypeOptions = options?.taskTypes || [];
  const requestTypeOptions = options?.requestTypes || [];
  const requestedItemOptions = options?.requestedItems || [];
  const monthOptions = options?.months || [];
  const priorityOptions = options?.priorities || ["Normal", "Low", "High", "Urgent"];

  const lockedClient = useMemo(() => clients.find((c) => c.client_id === initialClientId) || null, [clients, initialClientId]);

  const salesTaxOptions = useMemo(() => Array.from(new Set(clients.map((c) => c.sales_tax_frequency).filter(Boolean))) as string[], [clients]);
  const payrollOptions = useMemo(() => Array.from(new Set(clients.map((c) => c.payroll_frequency).filter(Boolean))) as string[], [clients]);

  const visibleClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (statusFilter !== "all" && String(c.status || "") !== statusFilter) return false;
      if (salesTaxFilter !== "all" && String(c.sales_tax_frequency || "") !== salesTaxFilter) return false;
      if (payrollFilter !== "all" && String(c.payroll_frequency || "") !== payrollFilter) return false;
      if (q && ![c.client_name, c.client_id, c.email].some((v) => String(v || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [clients, search, statusFilter, salesTaxFilter, payrollFilter]);

  function toggle(clientId: string) {
    setSelected((prev) => { const next = new Set(prev); next.has(clientId) ? next.delete(clientId) : next.add(clientId); return next; });
  }
  function selectVisible() { setSelected((prev) => new Set([...prev, ...visibleClients.map((c) => c.client_id)])); }
  function selectAllActive() { setSelected(new Set(clients.filter((c) => String(c.status || "").toLowerCase() === "active").map((c) => c.client_id))); }
  function clearSelection() { setSelected(new Set()); }
  function addClient() { if (addClientId) { setSelected((prev) => new Set(prev).add(addClientId)); setAddClientId(""); } }

  async function handleSubmit() {
    const isInternal = mode === "task" && internalTask;
    if (!isInternal && selected.size === 0) { setError("Select at least one client."); return; }
    if (mode === "task" && !taskName.trim()) { setError("Task name is required."); return; }
    if (mode === "task" && !dueDate) { setError("Due date is required."); return; }
    const resolvedRequestedItem = requestedItem === OTHER ? requestedItemOther.trim() : requestedItem;
    if (mode === "request" && !resolvedRequestedItem) { setError("Requested item is required."); return; }
    if (file && file.size > MAX_UPLOAD_BYTES) { setError(`That file is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Use the Attachment Link field instead.`); return; }

    setSaving(true);
    setError(null);
    let created = 0;
    const failures: string[] = [];
    try {
      const fileData = file ? await fileToBase64(file) : null;
      const finalRequestedItem = months.length > 0 ? `${resolvedRequestedItem} | Month(s): ${months.join(", ")}` : resolvedRequestedItem;
      const targets = isInternal ? [null] : Array.from(selected);
      for (const clientId of targets) {
        try {
          if (mode === "task") {
            const res = await api.post<{ taskId: string }>("/tasks", {
              clientId: clientId || undefined, internalTask: isInternal || undefined,
              taskName, taskType, agencyDueDate: dueDate, assignedTo, period,
              paymentRequired, notes,
            });
            if (fileData || attachmentLink) {
              await api.post("/documents/uploads", {
                taskId: res.taskId,
                fileName: attachmentName || file?.name || "Linked document",
                fileData: fileData || undefined,
                mimeType: file?.type || undefined,
                fileUrl: !fileData ? attachmentLink : undefined,
              });
            }
          } else {
            const res = await api.post<{ requestId: string }>("/documents/requests", {
              clientId, requestedItem: finalRequestedItem, taskId: initialTaskId || undefined,
              dueDate, priority, assignedTo, requestType, notes,
            });
            if (fileData || attachmentLink) {
              await api.post("/documents/uploads", {
                requestId: res.requestId,
                fileName: attachmentName || file?.name || "Linked document",
                fileData: fileData || undefined,
                mimeType: file?.type || undefined,
                fileUrl: !fileData ? attachmentLink : undefined,
                markReceived: "Yes",
              });
            }
          }
          created++;
        } catch (err) {
          failures.push(err instanceof ApiError ? err.message : "unknown error");
        }
      }
      if (failures.length) {
        setError(`Created ${created} of ${targets.length}. ${failures.length} failed: ${failures[0]}`);
      } else {
        toast(`${created} ${mode === "task" ? "task(s)" : "request(s)"} created.`);
        onDone();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 720, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New Work Item</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        {error && <div className="error-banner">{error}</div>}

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button type="button" className={`quick-tab ${mode === "task" ? "active" : ""}`} onClick={() => setMode("task")}>Task</button>
          <button type="button" className={`quick-tab ${mode === "request" ? "active" : ""}`} onClick={() => { setMode("request"); setInternalTask(false); }}>Request</button>
        </div>

        {mode === "task" && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 16 }}>
            <input type="checkbox" checked={internalTask} onChange={(e) => setInternalTask(e.target.checked)} />
            Internal firm task — not tied to a client (admin/staff work only)
          </label>
        )}

        {!internalTask && clientLocked && initialClientId && (
          <>
            <div className="form-section-title">Client</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8, marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{lockedClient?.client_name || "Loading…"}</div>
                <div className="muted" style={{ fontSize: 12 }}>{initialClientId}</div>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => setClientLocked(false)}>Change Client</button>
            </div>
          </>
        )}

        {!internalTask && !clientLocked && (
          <>
            <div className="form-section-title">Client(s)</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <input placeholder="Search name, ID, email…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 160, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)" }} />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All Status</option><option>Active</option><option>Inactive</option><option>Archived</option>
              </select>
              <select value={salesTaxFilter} onChange={(e) => setSalesTaxFilter(e.target.value)}>
                <option value="all">All Sales Tax</option>
                {salesTaxOptions.map((o) => <option key={o}>{o}</option>)}
              </select>
              <select value={payrollFilter} onChange={(e) => setPayrollFilter(e.target.value)}>
                <option value="all">All Payroll</option>
                {payrollOptions.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <select value={addClientId} onChange={(e) => setAddClientId(e.target.value)} style={{ flex: 1, minWidth: 180 }}>
                <option value="">Add a specific client…</option>
                {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
              </select>
              <button type="button" className="btn btn-sm" onClick={addClient}>Add Selected Client</button>
              <button type="button" className="btn btn-sm" onClick={selectVisible}>Select Visible</button>
              <button type="button" className="btn btn-sm" onClick={selectAllActive}>Select All Active</button>
              <button type="button" className="btn btn-sm" onClick={clearSelection}>Clear</button>
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{selected.size} selected | {visibleClients.length} visible</div>
            <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, marginBottom: 16 }}>
              {visibleClients.map((c) => (
                <label key={c.client_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--line)", fontSize: 12.5, cursor: "pointer" }}>
                  <input type="checkbox" checked={selected.has(c.client_id)} onChange={() => toggle(c.client_id)} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{c.client_name}</div>
                    <div className="muted" style={{ display: "flex", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
                      <span>{c.client_id}</span><span>{c.status || "—"}</span>
                      <span>SALES {c.sales_tax_frequency || "N/A"}</span><span>PAYROLL {c.payroll_frequency || "N/A"}</span>
                    </div>
                  </div>
                </label>
              ))}
              {visibleClients.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No clients match these filters.</p>}
            </div>
          </>
        )}

        {mode === "task" ? (
          <div className="form-grid">
            <div className="field">
              <label>Task Type</label>
              <select value={taskType} onChange={(e) => setTaskType(e.target.value)}>
                {taskTypeOptions.length === 0 && <option value={taskType}>{taskType}</option>}
                {taskTypeOptions.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="field"><label>Task Name</label><input required value={taskName} onChange={(e) => setTaskName(e.target.value)} placeholder="e.g. May bank reconciliation" /></div>
            <div className="field"><label>Due Date</label><input type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
            <div className="field">
              <label>Assigned To</label>
              <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                <option value="">Use client default staff</option>
                {staffOptions.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="field"><label>Period</label><input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. June 2026" /></div>
            <div className="field">
              <label>Payment Required</label>
              <select value={paymentRequired ? "yes" : "no"} onChange={(e) => setPaymentRequired(e.target.value === "yes")}>
                <option value="no">No</option><option value="yes">Yes</option>
              </select>
            </div>
          </div>
        ) : (
          <div className="form-grid">
            <div className="field">
              <label>Request Type</label>
              <select value={requestType} onChange={(e) => setRequestType(e.target.value)}>
                {requestTypeOptions.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                {priorityOptions.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="field"><label>Due From Client</label><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
            <div className="field">
              <label>Assigned To</label>
              <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                <option value="">Use client default staff</option>
                {staffOptions.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Requested Item</label>
              <select value={requestedItem} onChange={(e) => setRequestedItem(e.target.value)}>
                <option value="">Select…</option>
                {requestedItemOptions.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            {requestedItem === OTHER && (
              <div className="field"><label>Other Item</label><input required value={requestedItemOther} onChange={(e) => setRequestedItemOther(e.target.value)} placeholder="Describe what's requested" /></div>
            )}
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Month(s) <span className="muted" style={{ textTransform: "none", fontWeight: 500 }}>(optional — appended to the requested item, e.g. "Bank Statement | Month(s): April, May")</span></label>
              <select multiple value={months} onChange={(e) => setMonths(Array.from(e.target.selectedOptions).map((o) => o.value))} style={{ height: 110 }}>
                {monthOptions.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
        )}

        <div className="form-section-title">Attachment</div>
        <div className="field"><label>Upload Attachment</label><input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
        <div className="form-grid">
          <div className="field"><label>Attachment Name</label><input value={attachmentName} onChange={(e) => setAttachmentName(e.target.value)} placeholder="Optional when choosing a file" /></div>
          <div className="field"><label>Attachment Link</label><input value={attachmentLink} onChange={(e) => setAttachmentLink(e.target.value)} placeholder="Google Drive or portal link" disabled={!!file} /></div>
        </div>
        <div className="field"><label>Notes</label><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes" /></div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSubmit}>{saving ? "Creating…" : "Create"}</button>
        </div>
      </div>
    </div>
  );
}
