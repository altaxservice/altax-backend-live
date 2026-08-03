import { useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { fileToBase64, MAX_UPLOAD_BYTES } from "../utils/file";
import { useToast } from "./Toast";
import { ErrorBanner } from "./ErrorBanner";
import { FileDropInput } from "./FileDropInput";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

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
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const toast = useToast();
  const [mode, setMode] = useState<"browse" | "link">("browse");
  const [files, setFiles] = useState<File[]>([]);
  const [fileUrl, setFileUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [note, setNote] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (mode === "browse" && files.length === 0) { setError("Choose at least one file."); return; }
    if (mode === "link" && !fileUrl.trim()) { setError("Paste a file link."); return; }
    const tooBig = files.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooBig) { setError(`"${tooBig.name}" is too large (${(tooBig.size / 1024 / 1024).toFixed(1)}MB).`); return; }

    setSaving(true);
    setError(null);
    try {
      if (mode === "link") {
        await api.post("/documents/uploads", {
          clientId,
          fileName: fileName || undefined,
          fileUrl: fileUrl.trim(),
          notes: note.trim() || undefined,
          cc: cc || undefined, bcc: bcc || undefined,
        });
      } else {
        // Sequential uploads; only the LAST one triggers the client's notification
        // email, carrying every filename so a batch arrives as one message.
        const allNames = files.map((f) => f.name);
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const isLast = i === files.length - 1;
          await api.post("/documents/uploads", {
            clientId,
            fileName: files.length === 1 && fileName ? fileName : f.name,
            fileData: await fileToBase64(f),
            mimeType: f.type || undefined,
            notes: note.trim() || undefined,
            notify: isLast,
            batchFileNames: isLast && files.length > 1 ? allNames : undefined,
            cc: isLast ? cc || undefined : undefined,
            bcc: isLast ? bcc || undefined : undefined,
          });
        }
      }
      toast(mode === "browse" && files.length > 1
        ? `${files.length} files shared to ${clientName}'s portal — they've been emailed.`
        : `File shared to ${clientName}'s portal — they've been emailed.`);
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
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="upload-file-title" style={{ maxWidth: 480, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="upload-file-title">Send File to {clientName}</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        {error && <ErrorBanner error={error} />}
        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button type="button" className={`btn btn-sm ${mode === "browse" ? "btn-primary" : ""}`} onClick={() => setMode("browse")}>Browse a file</button>
            <button type="button" className={`btn btn-sm ${mode === "link" ? "btn-primary" : ""}`} onClick={() => setMode("link")}>Paste a link instead</button>
          </div>
          {mode === "browse" ? (
            <div className="field">
              <label>Choose Files</label>
              <FileDropInput files={files} onFilesChange={setFiles} />
            </div>
          ) : (
            <div className="field">
              <label>File Link (Drive, etc.)</label>
              <input type="url" required placeholder="https://…" value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} />
            </div>
          )}
          {(mode === "link" || files.length <= 1) && (
            <div className="field">
              <label>File Name {mode === "browse" && <span className="muted">(optional — uses the file's own name)</span>}</label>
              <input required={mode === "link"} value={fileName} onChange={(e) => setFileName(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label>
              Note <span className="muted">(optional — included in the notification email)</span>
              {!showCcBcc && <button type="button" className="link-button" style={{ float: "right", fontWeight: 400 }} onClick={() => setShowCcBcc(true)}>Add Cc/Bcc</button>}
            </label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Signed engagement letter" />
          </div>
          {showCcBcc && (
            <>
              <div className="field"><label>Cc <span className="muted">(comma-separated for more than one)</span></label><input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="colleague@example.com" /></div>
              <div className="field"><label>Bcc <span className="muted">(comma-separated, not visible to other recipients)</span></label><input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="records@altaxgroup.com" /></div>
            </>
          )}
          <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
            {clientName} gets one email letting them know the file{files.length > 1 ? "s are" : " is"} waiting in their portal.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Uploading…" : mode === "browse" && files.length > 1 ? `Upload ${files.length} Files` : "Upload"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
