import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { Client } from "../api/types";
import { fileToBase64, MAX_UPLOAD_BYTES } from "../utils/file";
import { useToast } from "./Toast";
import { ErrorBanner } from "./ErrorBanner";
import { FileDropInput } from "./FileDropInput";

interface EmployeeOption { employee_id: string; employee_name: string }

/**
 * Sends a file straight to a client's or an employee's portal — no document request
 * needed first. Powers the Documents section's "Upload to Client Portal" / "Upload to
 * Employee Portal" buttons and the Client page's "Send File to Client" action
 * (lockedClientId skips the picker for that entry point). Both targets post to the
 * same POST /documents/uploads route this app already had for direct client uploads;
 * the employee target (employeeId body field) is new.
 */
export function UploadToPortalModal({ mode, lockedClientId, lockedClientName, onClose, onDone }: {
  mode: "client" | "employee";
  lockedClientId?: string;
  lockedClientName?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState(lockedClientId || "");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (lockedClientId) return;
    api.get<{ clients: Client[] }>("/clients").then((res) => setClients(res.clients)).catch(() => {});
  }, [lockedClientId]);

  useEffect(() => {
    if (mode !== "employee" || !clientId) { setEmployees([]); setEmployeeId(""); return; }
    setLoadingEmployees(true);
    api.get<{ employees: EmployeeOption[] }>(`/accounting/employees/${clientId}`)
      .then((res) => setEmployees(res.employees))
      .catch(() => setEmployees([]))
      .finally(() => setLoadingEmployees(false));
  }, [mode, clientId]);

  const clientLabel = lockedClientName || clients.find((c) => c.client_id === clientId)?.client_name || "";

  const title = mode === "client" ? "Upload to Client Portal" : "Upload to Employee Portal";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!clientId) { setError("Choose a client."); return; }
    if (mode === "employee" && !employeeId) { setError("Choose an employee."); return; }
    if (!file) { setError("Choose a file to upload."); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setError(`That file is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Files over 8MB aren't supported by this upload.`); return; }

    setSaving(true);
    setError(null);
    try {
      const fileData = await fileToBase64(file);
      await api.post("/documents/uploads", {
        clientId: mode === "client" ? clientId : undefined,
        employeeId: mode === "employee" ? employeeId : undefined,
        fileName: fileName || file.name,
        fileData, mimeType: file.type,
        notes: notes || undefined,
      });
      toast(mode === "client" ? "File shared to the client's portal." : "File shared to the employee's portal.");
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not upload this file.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        <form onSubmit={handleSubmit}>
          {error && <ErrorBanner error={error} />}

          {lockedClientId ? (
            <div className="field">
              <label>Client</label>
              <div style={{ padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontWeight: 700 }}>{clientLabel || lockedClientId}</div>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="up-client">Client</label>
              <select id="up-client" required value={clientId} onChange={(e) => { setClientId(e.target.value); setEmployeeId(""); }}>
                <option value="">Select a client…</option>
                {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
              </select>
            </div>
          )}

          {mode === "employee" && (
            <div className="field">
              <label htmlFor="up-employee">Employee</label>
              <select id="up-employee" required disabled={!clientId || loadingEmployees} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">{loadingEmployees ? "Loading…" : clientId ? "Select an employee…" : "Choose a client first"}</option>
                {employees.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.employee_name}</option>)}
              </select>
              {clientId && !loadingEmployees && employees.length === 0 && (
                <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>This client has no employees on file yet.</p>
              )}
            </div>
          )}

          <div className="field">
            <label>File</label>
            <FileDropInput file={file} onChange={setFile} />
          </div>
          <div className="field">
            <label htmlFor="up-name">File Name <span className="muted">(optional — uses the file's own name)</span></label>
            <input id="up-name" value={fileName} onChange={(e) => setFileName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="up-notes">Note <span className="muted">(optional)</span></label>
            <input id="up-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Your W-2 for 2025" />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Uploading…" : "Share to Portal"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
