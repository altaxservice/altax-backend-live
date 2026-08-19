import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, openAnyFile, downloadAnyFile, printAnyFile } from "../api/client";
import type { DocumentRequest, DocumentUpload, WebOptions } from "../api/types2";
import { useAuth } from "../auth/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { StatusBadge } from "../components/StatusBadge";
import { ActionMenu } from "../components/ActionMenu";
import { FilterBar, exportCsv, activeViewDates } from "../components/FilterBar";
import { NewWorkItemModal } from "../components/NewWorkItemModal";
import { useToast } from "../components/Toast";
import { useConfirm, usePrompt, useNotify } from "../components/ConfirmProvider";
import { useSelectedClient } from "../context/SelectedClientContext";
import { saveListOrder } from "../utils/listNav";
import { fmtDateOnly, fmtDateTime } from "../utils/date";
import { ErrorBanner } from "../components/ErrorBanner";

const DOCUMENT_STATUSES = ["Requested", "Open", "Waiting on Client", "Received", "Completed", "Closed", "Void"];
const CLOSED_STATUSES = ["completed", "closed", "void"];

function hasFile(r: DocumentRequest): boolean {
  return Boolean(r.first_file_url) || Number(r.file_count || 0) > 0;
}
function isOverdue(r: DocumentRequest): boolean {
  if (!r.due_from_client || CLOSED_STATUSES.includes(String(r.status || "").toLowerCase())) return false;
  const d = new Date(r.due_from_client);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}
// UX-004: overdue already had a red "(overdue)" tag here, but a request due
// tomorrow looked identical to one due next month — nothing flagged it before
// it actually lapsed. 3-day window matches isDueSoon's task-list convention
// (TaskCells.tsx) so "soon" means the same thing across the app.
function isDueSoon(r: DocumentRequest): boolean {
  if (!r.due_from_client || CLOSED_STATUSES.includes(String(r.status || "").toLowerCase())) return false;
  const d = new Date(r.due_from_client);
  if (Number.isNaN(d.getTime())) return false;
  const days = (d.getTime() - Date.now()) / 86400000;
  return days >= 0 && days <= 3;
}

function FilesCell({ request, onRemove }: { request: DocumentRequest; onRemove?: (uploadId: string) => void }) {
  const { t } = useLanguage();
  if (!request.first_file_url) return <span className="muted">{t("documents.client.noFileYet")}</span>;
  const extra = Number(request.file_count || 1) - 1;
  const url = request.first_file_url;
  const name = request.first_file_name || "file";
  const uploadId = request.first_upload_id as string | undefined;
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <button type="button" className="link-button" onClick={() => openAnyFile(url)}>{name}</button>
      {" "}
      <button type="button" className="link-button" onClick={() => downloadAnyFile(url, name)}>{t("documents.client.download")}</button>
      {" "}
      <button type="button" className="link-button" onClick={() => printAnyFile(url)}>{t("documents.client.print")}</button>
      {onRemove && uploadId && (
        <>
          {" "}
          {/* "Revoke" (not "Remove") — this takes the file back from the client
              too, distinct from the staff-only "Archive" offered in the
              Files Shared Directly section below. */}
          <button type="button" className="link-button" style={{ color: "var(--red)" }} onClick={() => onRemove(uploadId)}>Revoke</button>
        </>
      )}
      {extra > 0 && <span className="muted"> (+{extra} {t("documents.client.more")})</span>}
    </span>
  );
}

export function DocumentsListPage() {
  const { user } = useAuth();
  const { t, dir } = useLanguage();
  const navigate = useNavigate();
  const { setSelectedClient } = useSelectedClient();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();
  const notify = useNotify();
  const [searchParams, setSearchParams] = useSearchParams();

  const [requests, setRequests] = useState<DocumentRequest[] | null>(null);
  const [uploads, setUploads] = useState<DocumentUpload[] | null>(null);
  const [options, setOptions] = useState<WebOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState(activeViewDates());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);

  const [showNewWorkItem, setShowNewWorkItem] = useState(searchParams.get("new") === "1");
  const newWorkItemClientId = searchParams.get("clientId") || undefined;
  const newWorkItemTaskId = searchParams.get("taskId") || undefined;
  const scopedClientId = searchParams.get("new") === "1" ? null : searchParams.get("clientId");
  const [scopedClientName, setScopedClientName] = useState<string | null>(null);

  const canManage = user?.role === "admin" || user?.role === "staff";
  const isAdmin = user?.role === "admin";
  const [removingId, setRemovingId] = useState<string | null>(null);

  function loadRequests(): Promise<void> {
    return api.get<{ requests: DocumentRequest[] }>("/documents/requests")
      .then((res) => setRequests(res.requests))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load document requests."));
  }
  function loadUploads(): Promise<void> {
    return api.get<{ uploads: DocumentUpload[] }>("/documents/uploads")
      .then((res) => setUploads(res.uploads))
      .catch(() => setUploads([]));
  }
  function loadAll(): Promise<void> {
    return Promise.all([loadRequests(), loadUploads()]).then(() => {});
  }

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { if (canManage) api.get<WebOptions>("/system/options").then(setOptions).catch(() => {}); }, [canManage]);
  useEffect(() => {
    if (!scopedClientId) { setScopedClientName(null); return; }
    api.get<{ client: { client_name: string } }>(`/clients/${scopedClientId}`).then((res) => setScopedClientName(res.client.client_name)).catch(() => {});
  }, [scopedClientId]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await loadAll();
      toast("Data refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  const uploadsByRequestId = useMemo(() => {
    const map = new Map<string, DocumentUpload[]>();
    for (const u of uploads || []) {
      if (!u.request_id || u.status === "Removed") continue;
      const list = map.get(u.request_id) || [];
      list.push(u);
      map.set(u.request_id, list);
    }
    return map;
  }, [uploads]);

  const scopedRequests = useMemo(() => (requests || []).filter((r) => !scopedClientId || r.client_id === scopedClientId), [requests, scopedClientId]);
  const scopedUploads = useMemo(() => (uploads || []).filter((u) => !scopedClientId || u.client_id === scopedClientId), [uploads, scopedClientId]);

  // Standalone (no-request) uploads sent straight to THIS logged-in client's/
  // employee's own portal — still needed for their own "Files Shared With You"
  // section below. The cross-client admin version of this ("Files Shared
  // Directly", plus Upload-to-Client/Employee-Portal buttons) was removed:
  // sending or managing an individual client's/employee's files now happens
  // from that record's own profile (ClientDetailPage's Documents tab /
  // EmployeeDetailPage's Documents section), which is also where Archive
  // lives — Revoke (below) still applies to the triage worklist's own Files
  // column, since that's the one place action stays on this page.
  const standaloneUploads = useMemo(
    () => scopedUploads.filter((u) => !u.request_id && !u.task_id && u.status !== "Removed"),
    [scopedUploads]
  );

  async function handleRemoveUpload(uploadId: string) {
    const ok = await confirmDialog({ title: "Revoke file", message: "It will disappear from the client's/employee's portal too, not just from here.", confirmLabel: "Revoke", danger: true });
    if (!ok) return;
    setRemovingId(uploadId);
    try {
      await api.post(`/documents/uploads/${uploadId}/remove`, {});
      toast("File revoked — removed from both sides.");
      loadAll();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not revoke this file.");
    } finally {
      setRemovingId(null);
    }
  }

  const filteredRequests = useMemo(() => {
    let rows = scopedRequests.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      const d = r.request_date ? r.request_date.slice(0, 10) : null;
      if (d && period.start && d < period.start) return false;
      if (d && period.end && d > period.end) return false;
      return true;
    });
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => [r.requested_item, r.client_name, r.assigned_to, r.status].some((v) => String(v || "").toLowerCase().includes(q)));
    return rows;
  }, [scopedRequests, statusFilter, period, search]);

  // Powers DocumentDetailPage's Previous/Next paging — see utils/listNav.ts.
  useEffect(() => {
    saveListOrder("documents", filteredRequests.map((r) => r.request_id));
  }, [filteredRequests]);

  const openRequestsAll = useMemo(() => scopedRequests.filter((r) => !hasFile(r) && !CLOSED_STATUSES.includes(String(r.status || "").toLowerCase())), [scopedRequests]);
  const overdueAll = useMemo(() => openRequestsAll.filter(isOverdue), [openRequestsAll]);
  const receivedUploadsAll = useMemo(() => scopedUploads.filter((u) => (u.direction === "Client to Firm" || u.direction === "Employee to Firm") && u.status !== "Removed"), [scopedUploads]);
  const sentUploadsAll = useMemo(() => scopedUploads.filter((u) => (u.direction === "Firm to Client" || u.direction === "Firm to Employee") && u.status !== "Removed"), [scopedUploads]);

  const openRequests = useMemo(() => filteredRequests.filter((r) => !hasFile(r) && !CLOSED_STATUSES.includes(String(r.status || "").toLowerCase())), [filteredRequests]);
  const receivedRequests = useMemo(() => filteredRequests.filter((r) => (uploadsByRequestId.get(r.request_id) || []).some((u) => u.direction === "Client to Firm" || u.direction === "Employee to Firm")), [filteredRequests, uploadsByRequestId]);
  const sentRequests = useMemo(() => filteredRequests.filter((r) => (uploadsByRequestId.get(r.request_id) || []).some((u) => u.direction === "Firm to Client" || u.direction === "Firm to Employee")), [filteredRequests, uploadsByRequestId]);

  function toggleSelected(id: string) {
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function toggleSelectAll() {
    setSelected((prev) => (prev.size === openRequests.length ? new Set() : new Set(openRequests.map((r) => r.request_id))));
  }

  async function handleStatusChange(requestId: string, status: string) {
    setSavingStatusId(requestId);
    try {
      await api.post(`/documents/requests/${requestId}/status`, { status });
      toast("Status updated.");
      loadRequests();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not update status.");
    } finally {
      setSavingStatusId(null);
    }
  }

  async function handleAction(request: DocumentRequest, action: string) {
    if (action === "upload") return navigate(`/documents/${request.request_id}?open=upload`);
    if (action === "edit") return navigate(`/documents/${request.request_id}`);
    if (action === "delete-request") {
      const confirmValue = await promptFor({
        title: "Permanently delete document request",
        message: `"${request.requested_item}" — this cannot be undone. Type DELETE DOCUMENT to confirm.`,
        placeholder: "DELETE DOCUMENT",
      });
      if (confirmValue === null) return;
      try {
        await api.post(`/documents/requests/${request.request_id}/delete`, { confirm: confirmValue });
        toast("Document request deleted.");
        loadAll();
      } catch (err) {
        await notify(err instanceof ApiError ? err.message : "Could not delete this request.");
      }
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    const confirmValue = await promptFor({
      title: "Permanently delete document requests",
      message: `${selected.size} selected document request(s) — this cannot be undone. Type DELETE SELECTED to confirm.`,
      placeholder: "DELETE SELECTED",
    });
    if (confirmValue === null) return;
    setBulkBusy(true);
    try {
      const res = await api.post<{ deleted: number }>("/documents/requests/bulk-delete", { requestIds: Array.from(selected), confirm: confirmValue });
      toast(`${res.deleted} document request(s) deleted.`);
      setSelected(new Set());
      loadAll();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Bulk delete failed.");
    } finally {
      setBulkBusy(false);
    }
  }

  function handleExport() {
    exportCsv("documents.csv", [
      { key: "client_name", label: "Client" }, { key: "requested_item", label: "Request" },
      { key: "request_date", label: "Requested" }, { key: "due_from_client", label: "Due" },
      { key: "assigned_to", label: "Owner" }, { key: "status", label: "Status" },
    ], filteredRequests as unknown as Record<string, unknown>[]);
  }

  function documentActionOptions(role?: string) {
    const opts = [{ value: "upload", label: "Upload / Share File" }, { value: "edit", label: "Edit" }];
    if (role === "admin") opts.push({ value: "delete-request", label: "Delete Document Row" });
    return opts;
  }

  const ready = requests !== null && uploads !== null;

  return (
    <div dir={dir}>
      {/* No in-page h1 for any role — the topbar already reads "Documents"/"المستندات". */}

      {scopedClientId && (
        <div className="card" style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Reviewing documents for <strong>{scopedClientName || scopedClientId}</strong>.</span>
          <button className="btn btn-sm" onClick={() => setSearchParams({})}>Show All Documents</button>
        </div>
      )}

      {canManage && (
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Document, client, owner…" }}
          selects={[{ label: "Status", value: statusFilter, options: options?.documentStatuses || DOCUMENT_STATUSES, onChange: setStatusFilter }]}
          period={{ start: period.start, end: period.end, onStartChange: (v) => setPeriod((p) => ({ ...p, start: v })), onEndChange: (v) => setPeriod((p) => ({ ...p, end: v })), onActiveView: () => setPeriod(activeViewDates()) }}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          onExportCsv={handleExport}
        >
          {isAdmin && (
            <button type="button" className="danger-button" disabled={bulkBusy || selected.size === 0} onClick={handleBulkDelete}>Delete Selected Rows</button>
          )}
          {selected.size > 0 && <span className="muted" style={{ fontSize: 12 }}>{selected.size} selected</span>}
        </FilterBar>
      )}

      {canManage && (
        <div className="portal-banner" style={{ margin: "16px 0" }}>
          <div className="topbar-eyebrow">Document Center</div>
          <h2>Firm-Wide Request Queue</h2>
          <p>What's outstanding across every client, in one place. To send a file or manage one client's (or employee's) documents, open their own profile — that's where Send File, Request Document, Archive, and Revoke live now.</p>
          <div className="quick-actions" style={{ marginTop: 12 }}>
            <button className="action-button" type="button" onClick={() => setShowNewWorkItem(true)}>New Document Request (multiple clients)</button>
          </div>
        </div>
      )}

      {error && <ErrorBanner error={error} />}

      {canManage && ready && (
        <div className="metric-grid" style={{ marginBottom: 20 }}>
          {/* "Waiting" is the number staff act on, so it filters the list. */}
          <button type="button" className="metric metric-clickable" onClick={() => setStatusFilter("Requested")}>
            <div className="metric-label">Waiting</div>
            <div className="metric-value">{openRequestsAll.length}</div>
            <div className="metric-note">{openRequests.length} visible</div>
          </button>
          <div className="metric">
            <div className="metric-label">Received</div>
            <div className="metric-value">{receivedUploadsAll.length}</div>
            <div className="metric-note">from clients</div>
          </div>
          <div className="metric">
            <div className="metric-label">Sent</div>
            <div className="metric-value">{sentUploadsAll.length}</div>
            <div className="metric-note">shared to clients</div>
          </div>
          <div className="metric">
            <div className="metric-label">Overdue</div>
            <div className="metric-value">{overdueAll.length}</div>
            <div className="metric-note">past due from client</div>
          </div>
        </div>
      )}

      {!ready && !error && <div className="spinner-wrap">Loading…</div>}

      {ready && !canManage && (
        <>
          <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
              <strong style={{ fontSize: 14 }}>{t("documents.client.requestsTitle")}</strong>
              <p className="muted" style={{ fontSize: 12, margin: "2px 0 0" }}>{t("documents.client.requestsNote")}</p>
            </div>
            <div className="table-scroll card-table">
            <table>
              <thead><tr><th scope="col">{t("documents.client.colItem")}</th><th scope="col">{t("documents.client.colStatus")}</th><th scope="col">{t("documents.client.colPriority")}</th><th scope="col">{t("documents.client.colDue")}</th><th scope="col">{t("documents.client.colFiles")}</th></tr></thead>
              <tbody>
                {scopedRequests.map((r) => (
                  <tr key={r.request_id} data-row-id={r.request_id} onClick={() => navigate(`/documents/${r.request_id}`)} style={{ cursor: "pointer" }} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/documents/${r.request_id}`); } }}>
                    <td><span className="link-button" style={{ fontWeight: 600 }} onClick={(e) => { e.stopPropagation(); navigate(`/documents/${r.request_id}`); }}>{r.requested_item}</span></td>
                    <td data-label={t("documents.client.colStatus")}><StatusBadge status={r.status} /></td>
                    <td className="muted" data-label={t("documents.client.colPriority")}>{r.priority || "—"}</td>
                    <td className="muted" data-label={t("documents.client.colDue")} style={isOverdue(r) ? { color: "var(--red)", fontWeight: 600 } : isDueSoon(r) ? { color: "var(--amber)", fontWeight: 600 } : undefined}>{r.due_from_client || "—"}</td>
                    <td data-label={t("documents.client.colFiles")}><FilesCell request={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {scopedRequests.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>{t("documents.client.noRequests")}</p>}
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
              <strong style={{ fontSize: 14 }}>{t("documents.client.sharedTitle")}</strong>
              <p className="muted" style={{ fontSize: 12, margin: "2px 0 0" }}>{t("documents.client.sharedNote")}</p>
            </div>
            {standaloneUploads.length === 0 ? (
              <p className="muted" style={{ padding: 16, textAlign: "center" }}>{t("documents.client.noShared")}</p>
            ) : (
              <div className="table-scroll card-table">
              <table>
                <thead><tr><th scope="col">{t("documents.client.colFile")}</th><th scope="col">{t("documents.client.colNote")}</th><th scope="col">{t("documents.client.colShared")}</th><th scope="col">{t("documents.client.colAction")}</th></tr></thead>
                <tbody>
                  {standaloneUploads.map((u) => (
                    <tr key={u.upload_id}>
                      <td><button type="button" className="link-button" style={{ fontWeight: 600 }} onClick={() => openAnyFile(u.file_url)}>{u.file_name}</button></td>
                      <td className="muted" data-label={t("documents.client.colNote")}>{u.notes || "—"}</td>
                      <td className="muted" data-label={t("documents.client.colShared")}>{u.uploaded_at ? fmtDateTime(u.uploaded_at) : "—"}</td>
                      <td data-label={t("documents.client.colAction")}>
                        <button type="button" className="link-button" onClick={() => downloadAnyFile(u.file_url, u.file_name)}>{t("documents.client.download")}</button>
                        {" "}
                        <button type="button" className="link-button" onClick={() => printAnyFile(u.file_url)}>{t("documents.client.print")}</button>
                        {" "}
                        <button type="button" className="link-button" style={{ color: "var(--red)" }} disabled={removingId === u.upload_id} onClick={() => handleRemoveUpload(u.upload_id)}>
                          {removingId === u.upload_id ? t("documents.client.removing") : t("documents.client.remove")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </>
      )}

      {ready && canManage && (
        <>
          <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
              <strong style={{ fontSize: 14 }}>Open Requests - Need Client Upload</strong>
              <span className="muted" style={{ fontSize: 12 }}>{openRequests.length} waiting</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <div className="table-scroll card-table">
              <table>
                <thead>
                  <tr>
                    {canManage && <th scope="col" style={{ width: 32 }}><input type="checkbox" checked={openRequests.length > 0 && selected.size === openRequests.length} onChange={toggleSelectAll} /></th>}
                    <th scope="col">Client</th><th scope="col">Request</th><th scope="col">Requested</th><th scope="col">Due</th><th scope="col">Owner</th><th scope="col">Status</th><th scope="col">Files</th><th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {openRequests.map((r) => (
                    <tr key={r.request_id} data-row-id={r.request_id} tabIndex={0} onClick={() => { setSelectedClient(r.client_id, r.client_name); navigate(`/documents/${r.request_id}`); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedClient(r.client_id, r.client_name); navigate(`/documents/${r.request_id}`); } }}>
                      {canManage && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(r.request_id)} onChange={() => toggleSelected(r.request_id)} /></td>}
                      <td>{r.client_name}</td>
                      <td data-label="Request"><span className="link-button" style={{ fontWeight: 600 }} onClick={(e) => { e.stopPropagation(); setSelectedClient(r.client_id, r.client_name); navigate(`/documents/${r.request_id}`); }}>{r.requested_item}</span></td>
                      <td className="muted" data-label="Requested">{r.request_date ? fmtDateOnly(r.request_date) : "—"}</td>
                      <td className="muted" data-label="Due" style={isOverdue(r) ? { color: "var(--red)", fontWeight: 600 } : isDueSoon(r) ? { color: "var(--amber)", fontWeight: 600 } : undefined}>{r.due_from_client || "—"}{isOverdue(r) ? " (overdue)" : isDueSoon(r) ? " (due soon)" : ""}</td>
                      <td className="muted" data-label="Owner">{r.assigned_to || "—"}</td>
                      <td data-label="Status" onClick={(e) => e.stopPropagation()}>
                        {canManage ? (
                          <select className="inline-select" value={r.status || "Requested"} disabled={savingStatusId === r.request_id} onChange={(e) => handleStatusChange(r.request_id, e.target.value)}>
                            {(options?.documentStatuses || DOCUMENT_STATUSES).map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : <StatusBadge status={r.status} />}
                      </td>
                      <td data-label="Files"><FilesCell request={r} onRemove={handleRemoveUpload} /></td>
                      <td data-label="Action" onClick={(e) => e.stopPropagation()}>{canManage && <ActionMenu options={documentActionOptions(user?.role)} onSelect={(action) => handleAction(r, action)} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
            {openRequests.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No open requests.</p>}
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
              <strong style={{ fontSize: 14 }}>Files Received From Client</strong>
              <span className="muted" style={{ fontSize: 12 }}>{receivedRequests.length} request(s) ready — click any row to open it</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <div className="table-scroll card-table">
              <table>
                <thead><tr><th scope="col">Client</th><th scope="col">Request</th><th scope="col">Requested</th><th scope="col">Due</th><th scope="col">Owner</th><th scope="col">Status</th><th scope="col">Files</th></tr></thead>
                <tbody>
                  {receivedRequests.map((r) => (
                    <tr key={r.request_id} data-row-id={r.request_id} tabIndex={0} onClick={() => { setSelectedClient(r.client_id, r.client_name); navigate(`/documents/${r.request_id}`); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedClient(r.client_id, r.client_name); navigate(`/documents/${r.request_id}`); } }}>
                      <td>{r.client_name}</td>
                      <td data-label="Request">{r.requested_item}</td>
                      <td className="muted" data-label="Requested">{r.request_date ? fmtDateOnly(r.request_date) : "—"}</td>
                      <td className="muted" data-label="Due">{r.due_from_client || "—"}</td>
                      <td className="muted" data-label="Owner">{r.assigned_to || "—"}</td>
                      <td data-label="Status"><StatusBadge status={r.status} /></td>
                      <td data-label="Files"><FilesCell request={r} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
            {receivedRequests.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No received client documents.</p>}
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
              <strong style={{ fontSize: 14 }}>Files Sent To Client</strong>
              <span className="muted" style={{ fontSize: 12 }}>{sentRequests.length} request(s) shared — click any row to open it</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <div className="table-scroll card-table">
              <table>
                <thead><tr><th scope="col">Client</th><th scope="col">Request</th><th scope="col">Requested</th><th scope="col">Due</th><th scope="col">Owner</th><th scope="col">Status</th><th scope="col">Files</th></tr></thead>
                <tbody>
                  {sentRequests.map((r) => (
                    <tr key={r.request_id} data-row-id={r.request_id} tabIndex={0} onClick={() => { setSelectedClient(r.client_id, r.client_name); navigate(`/documents/${r.request_id}`); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedClient(r.client_id, r.client_name); navigate(`/documents/${r.request_id}`); } }}>
                      <td>{r.client_name}</td>
                      <td data-label="Request">{r.requested_item}</td>
                      <td className="muted" data-label="Requested">{r.request_date ? fmtDateOnly(r.request_date) : "—"}</td>
                      <td className="muted" data-label="Due">{r.due_from_client || "—"}</td>
                      <td className="muted" data-label="Owner">{r.assigned_to || "—"}</td>
                      <td data-label="Status"><StatusBadge status={r.status} /></td>
                      <td data-label="Files"><FilesCell request={r} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
            {sentRequests.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No documents shared to clients.</p>}
          </div>
        </>
      )}

      {showNewWorkItem && (
        <NewWorkItemModal
          initialClientId={newWorkItemClientId}
          initialTaskId={newWorkItemTaskId}
          initialMode="request"
          onClose={() => { setShowNewWorkItem(false); setSearchParams({}); }}
          onDone={() => loadAll()}
        />
      )}
    </div>
  );
}
