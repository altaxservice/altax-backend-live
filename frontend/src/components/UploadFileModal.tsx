import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { fileToBase64, MAX_UPLOAD_BYTES } from "../utils/file";
import { useToast } from "./Toast";

/**
 * Direct "drop a file into this client's Documents" flow — for the Clients page's
 * "Upload Document" row action, which previously navigated to /documents?new=1&...
 * and opened the Request-mode work-item modal (asking the CLIENT for a document)
 * instead of actually uploading one. POST /documents/uploads now accepts a bare
 * clientId (no requestId/taskId) for exactly this case.
 */
export function UploadFileModal({ clientId, clientName, onClose, onDone }: {
  clientId: string; clientName: string; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<"browse" | "link">("browse");
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (mode === "browse" && !file) { setError("Choose a file."); return; }
    if (mode === "link" && !fileUrl.trim()) { setError("Paste a file link."); return; }
    if (file && file.size > MAX_UPLOAD_BYTES) { setError(`That file is too large (${(file.size / 1024 / 1024).toFixed(1)}MB).`); return; }

    setSaving(true);
    setError(null);
    try {
      const fileData = file ? await fileToBase64(file) : null;
      await api.post("/documents/uploads", {
        clientId,
        fileName: fileName || file?.name || undefined,
        fileData: fileData || undefined,
        mimeType: file?.type || undefined,
        fileUrl: !fileData ? fileUrl.trim() : undefined,
        notes: note.trim() || undefined,
      });
      toast(`Uploaded to ${clientName}'s Documents.`);
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
      <div className="modal-panel" style={{ maxWidth: 480, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Upload Document — {clientName}</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button type="button" className={`btn btn-sm ${mode === "browse" ? "btn-primary" : ""}`} onClick={() => setMode("browse")}>Browse a file</button>
            <button type="button" className={`btn btn-sm ${mode === "link" ? "btn-primary" : ""}`} onClick={() => setMode("link")}>Paste a link instead</button>
          </div>
          {mode === "browse" ? (
            <>
              <div className="field">
                <label>Choose File</label>
                <input type="file" required onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </div>
              {file && <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>{file.name} · {(file.size / 1024).toFixed(0)} KB</p>}
            </>
          ) : (
            <div className="field">
              <label>File Link (Drive, etc.)</label>
              <input type="url" required placeholder="https://…" value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label>File Name {mode === "browse" && <span className="muted">(optional — uses the file's own name)</span>}</label>
            <input required={mode === "link"} value={fileName} onChange={(e) => setFileName(e.target.value)} />
          </div>
          <div className="field">
            <label>Note <span className="muted">(optional)</span></label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Signed engagement letter" />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Uploading…" : "Upload"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
