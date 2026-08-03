import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { Client } from "../api/types";
import { fileToBase64, MAX_UPLOAD_BYTES } from "../utils/file";
import { useToast } from "./Toast";
import { ErrorBanner } from "./ErrorBanner";
import { FileDropInput } from "./FileDropInput";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface EmployeeOption { employee_id: string; employee_name: string }

/**
 * Sends a file straight to a client's or an employee's portal — no document request
 * needed first. Belongs to whichever record it's opened from: the Client page's "Send
 * File to Client" locks the client (lockedClientId); the Employee page's "Send File to
 * Employee" locks the employee directly (lockedEmployeeId) and skips the client picker
 * entirely, since staff are already on that one person's page and picking their own
 * employer from a client dropdown first was exactly the "same issue as Documents"
 * confusion flagged live — every action should belong to the record it's on, not force
 * a trip through a general-purpose picker. Both targets post to the same
 * POST /documents/uploads route; the employee target (employeeId body field) resolves
 * its own client_id server-side, so lockedEmployeeId alone is enough here.
 */
export function UploadToPortalModal({ mode, lockedClientId, lockedClientName, lockedEmployeeId, lockedEmployeeName, onClose, onDone }: {
  mode: "client" | "employee";
  lockedClientId?: string;
  lockedClientName?: string;
  lockedEmployeeId?: string;
  lockedEmployeeName?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const toast = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState(lockedClientId || "");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = useState(lockedEmployeeId || "");
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (lockedClientId || lockedEmployeeId) return;
    api.get<{ clients: Client[] }>("/clients").then((res) => setClients(res.clients)).catch(() => {});
  }, [lockedClientId, lockedEmployeeId]);

  useEffect(() => {
    if (mode !== "employee" || lockedEmployeeId || !clientId) { setEmployees([]); return; }
    setLoadingEmployees(true);
    api.get<{ employees: EmployeeOption[] }>(`/accounting/employees/${clientId}`)
      .then((res) => setEmployees(res.employees))
      .catch(() => setEmployees([]))
      .finally(() => setLoadingEmployees(false));
  }, [mode, clientId, lockedEmployeeId]);

  const clientLabel = lockedClientName || clients.find((c) => c.client_id === clientId)?.client_name || "";
  const employeeLabel = lockedEmployeeName || employees.find((e) => e.employee_id === employeeId)?.employee_name || "";

  const title = mode === "client" ? "Send File to Client" : "Send File to Employee";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (mode === "client" && !clientId) { setError("Choose a client."); return; }
    if (mode === "employee" && !employeeId) { setError("Choose an employee."); return; }
    if (files.length === 0) { setError("Choose at least one file to upload."); return; }
    const tooBig = files.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooBig) { setError(`"${tooBig.name}" is too large (${(tooBig.size / 1024 / 1024).toFixed(1)}MB). Files over 8MB aren't supported by this upload.`); return; }

    setSaving(true);
    setError(null);
    try {
      // Sequential uploads; only the LAST file triggers the recipient's email,
      // carrying every filename in the batch so they get one combined
      // "AL TAX shared N files with you" notification instead of N emails.
      const allNames = files.map((f) => f.name);
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const isLast = i === files.length - 1;
        const fileData = await fileToBase64(f);
        await api.post("/documents/uploads", {
          clientId: mode === "client" ? clientId : undefined,
          employeeId: mode === "employee" ? employeeId : undefined,
          fileName: f.name,
          fileData, mimeType: f.type,
          notes: notes || undefined,
          notify: isLast,
          batchFileNames: isLast && files.length > 1 ? allNames : undefined,
          cc: isLast ? cc || undefined : undefined,
          bcc: isLast ? bcc || undefined : undefined,
        });
      }
      const who = mode === "client" ? "client's" : "employee's";
      toast(files.length > 1 ? `${files.length} files shared to the ${who} portal — they've been emailed.` : `File shared to the ${who} portal — they've been emailed.`);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not upload. Some files may have gone through — check the Documents tab before retrying.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="upload-to-portal-title" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="upload-to-portal-title">{title}</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        <form onSubmit={handleSubmit}>
          {error && <ErrorBanner error={error} />}

          {lockedEmployeeId ? (
            <div className="field">
              <label>Employee</label>
              <div style={{ padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontWeight: 700 }}>{employeeLabel || lockedEmployeeId}</div>
            </div>
          ) : (
            <>
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
            </>
          )}

          <div className="field">
            <label>Files</label>
            <FileDropInput files={files} onFilesChange={setFiles} />
          </div>
          <div className="field">
            <label htmlFor="up-notes">
              Note <span className="muted">(optional — included in the notification email)</span>
              {!showCcBcc && <button type="button" className="link-button" style={{ float: "right", fontWeight: 400 }} onClick={() => setShowCcBcc(true)}>Add Cc/Bcc</button>}
            </label>
            <input id="up-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Your W-2 for 2025" />
          </div>
          {showCcBcc && (
            <>
              <div className="field"><label>Cc <span className="muted">(comma-separated for more than one)</span></label><input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="colleague@example.com" /></div>
              <div className="field"><label>Bcc <span className="muted">(comma-separated, not visible to other recipients)</span></label><input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="records@altaxgroup.com" /></div>
            </>
          )}

          <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
            The {mode === "client" ? "client" : "employee"} gets one email letting them know the file{files.length > 1 ? "s are" : " is"} waiting in their portal.
          </p>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Uploading…" : files.length > 1 ? `Share ${files.length} Files to Portal` : "Share to Portal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
