import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, resolveFileUrl } from "../api/client";
import type { DocumentRequest, DocumentUpload, WebOptions } from "../api/types2";
import { useAuth } from "../auth/AuthContext";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/Toast";
import { fileToBase64, MAX_UPLOAD_BYTES } from "../utils/file";
import { fmtDateOnly } from "../utils/date";

const STATUS_OPTIONS_FALLBACK = ["Requested", "Open", "Waiting on Client", "Received", "Completed", "Closed", "Void"];

export function DocumentDetailPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const [request, setRequest] = useState<DocumentRequest | null>(null);
  const [uploads, setUploads] = useState<DocumentUpload[] | null>(null);
  const [options, setOptions] = useState<WebOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUploadForm, setShowUploadForm] = useState(searchParams.get("open") === "upload");
  const [uploadMode, setUploadMode] = useState<"browse" | "link">("browse");
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const canManage = user?.role === "admin" || user?.role === "staff";

  function load() {
    if (!requestId) return;
    api.get<{ request: DocumentRequest }>(`/documents/requests/${requestId}`)
      .then((res) => setRequest(res.request))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this request."));
  }
  function loadUploads() {
    if (!requestId) return;
    api.get<{ uploads: DocumentUpload[] }>(`/documents/uploads?requestId=${requestId}`)
      .then((res) => setUploads(res.uploads))
      .catch(() => setUploads([]));
  }

  useEffect(load, [requestId]);
  useEffect(loadUploads, [requestId]);
  useEffect(() => { if (canManage) api.get<WebOptions>("/system/options").then(setOptions).catch(() => {}); }, [canManage]);

  const visibleUploads = (uploads || []).filter((u) => u.status !== "Removed");

  async function handleDelete() {
    if (!requestId || !request) return;
    const confirmValue = prompt(`Permanently delete "${request.requested_item}"? This cannot be undone. Type DELETE DOCUMENT to confirm.`);
    if (confirmValue === null) return;
    setDeleting(true);
    try {
      await api.post(`/documents/requests/${requestId}/delete`, { confirm: confirmValue });
      toast("Document request deleted.");
      navigate("/documents");
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not delete this request.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleStatusChange(status: string) {
    if (!requestId) return;
    setStatusSaving(true);
    try {
      await api.post(`/documents/requests/${requestId}/status`, { status });
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not update status.");
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!requestId) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (uploadMode === "browse") {
        if (!file) throw new ApiError("Choose a file to upload.", 400);
        if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(`That file is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Files over 8MB need to be shared as a link instead.`, 400);
        const fileData = await fileToBase64(file);
        await api.post("/documents/uploads", { requestId, fileName: fileName || file.name, fileData, mimeType: file.type, notes: note || undefined });
      } else {
        await api.post("/documents/uploads", { requestId, fileUrl, fileName, notes: note || undefined });
      }
      setShowUploadForm(false);
      setFile(null);
      setFileUrl("");
      setFileName("");
      setNote("");
      toast("File uploaded.");
      load();
      loadUploads();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not upload this document.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveFile(uploadId: string) {
    if (!confirm("Remove this file? It stays in the audit trail but will no longer be visible or listed here.")) return;
    setRemovingId(uploadId);
    try {
      await api.post(`/documents/uploads/${uploadId}/remove`, {});
      toast("File removed.");
      loadUploads();
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not remove this file.");
    } finally {
      setRemovingId(null);
    }
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!request) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div>
      <Link to="/documents" className="muted">← All documents</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", margin: "8px 0 24px", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>{request.requested_item}</h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <StatusBadge status={request.status} />
            <Link to={`/clients/${request.client_id}`} className="muted">{request.client_name}</Link>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value=""
            disabled={statusSaving}
            onChange={(e) => e.target.value && handleStatusChange(e.target.value)}
            style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)" }}
          >
            <option value="">Change status…</option>
            {(options?.documentStatuses || STATUS_OPTIONS_FALLBACK).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => setShowUploadForm((v) => !v)}>{showUploadForm ? "Cancel" : "Upload File"}</button>
          {user?.role === "admin" && <button className="btn btn-danger" disabled={deleting} onClick={handleDelete}>{deleting ? "Deleting…" : "Delete Document Row"}</button>}
        </div>
      </div>

      {showUploadForm && (
        <form onSubmit={handleUpload} className="card" style={{ maxWidth: 480, marginBottom: 24 }}>
          {saveError && <div className="error-banner">{saveError}</div>}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button type="button" className={`btn btn-sm ${uploadMode === "browse" ? "btn-primary" : ""}`} onClick={() => setUploadMode("browse")}>Browse a file</button>
            <button type="button" className={`btn btn-sm ${uploadMode === "link" ? "btn-primary" : ""}`} onClick={() => setUploadMode("link")}>Paste a link instead</button>
          </div>
          {uploadMode === "browse" ? (
            <>
              <div className="field">
                <label htmlFor="f-file">Choose File</label>
                <input id="f-file" type="file" required onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </div>
              {file && <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>{file.name} · {(file.size / 1024).toFixed(0)} KB</p>}
            </>
          ) : (
            <div className="field">
              <label htmlFor="f-url">File Link (Drive, etc.)</label>
              <input id="f-url" type="url" required placeholder="https://…" value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="f-name">File Name {uploadMode === "browse" && <span className="muted">(optional — uses the file's own name)</span>}</label>
            <input id="f-name" required={uploadMode === "link"} value={fileName} onChange={(e) => setFileName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-note">Note <span className="muted">(optional)</span></label>
            <input id="f-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Q2 statement, pages 1-3 only" />
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Uploading…" : uploadMode === "browse" ? "Upload File" : "Link File"}</button>
        </form>
      )}

      <div className="card" style={{ maxWidth: 560, marginBottom: 16 }}>
        <Row label="Priority" value={request.priority} />
        <Row label="Request Type" value={request.request_type} />
        <Row label="Direction" value={request.direction} />
        <Row label="Assigned To" value={request.assigned_to as string | null} />
        <Row label="Due From Client" value={request.due_from_client} />
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Files ({visibleUploads.length})</strong>
        </div>
        {visibleUploads.length === 0 && <p className="muted" style={{ fontSize: 13, margin: 0 }}>No files yet.</p>}
        {visibleUploads.map((u) => (
          <div key={u.upload_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
            <div>
              <a href={resolveFileUrl(u.file_url) || undefined} target="_blank" rel="noreferrer">{u.file_name}</a>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                {u.direction || "—"} · {(u as any).uploaded_by || "—"} · {u.uploaded_at ? fmtDateOnly(u.uploaded_at) : "—"}
              </div>
              {(u as any).notes && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{(u as any).notes}</div>}
            </div>
            {canManage && (
              <button className="btn btn-sm btn-danger" disabled={removingId === u.upload_id} onClick={() => handleRemoveFile(u.upload_id)}>
                {removingId === u.upload_id ? "Removing…" : "Remove"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value, link }: { label: string; value: string | null | undefined; link?: string | null }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
      <span className="muted">{label}</span>
      <span>{link ? <a href={link} target="_blank" rel="noreferrer">{value}</a> : (value || "—")}</span>
    </div>
  );
}
