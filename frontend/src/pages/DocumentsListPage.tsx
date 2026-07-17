import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, resolveFileUrl } from "../api/client";
import type { DocumentRequest, DocumentUpload, WebOptions } from "../api/types2";
import { useAuth } from "../auth/AuthContext";
import { StatusBadge } from "../components/StatusBadge";
import { ActionMenu } from "../components/ActionMenu";
import { FilterBar, exportCsv, activeViewDates } from "../components/FilterBar";
import { NewWorkItemModal } from "../components/NewWorkItemModal";
import { useToast } from "../components/Toast";
import { useSelectedClient } from "../context/SelectedClientContext";
import { fmtDateOnly } from "../utils/date";

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

function FilesCell({ request }: { request: DocumentRequest }) {
  if (!request.first_file_url) return <span className="muted">No file yet</span>;
  const extra = Number(request.file_count || 1) - 1;
  return (
    <span>
      <a href={resolveFileUrl(request.first_file_url)} target="_blank" rel="noreferrer">{request.first_file_name || "View file"}</a>
      {extra > 0 && <span className="muted"> (+{extra} more)</span>}
    </span>
  );
}

export function DocumentsListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { setSelectedClient } = useSelectedClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [requests, setRequests] = useState<DocumentRequest[] | null>(null);
  const [uploads, setUploads] = useState<DocumentUpload[] | null>(null);
  const [options, setOptions] = useState<WebOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [statusFilter, setStatusFilter] = useState("all");
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

  const filteredRequests = useMemo(() => {
    return scopedRequests.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      const d = r.request_date ? r.request_date.slice(0, 10) : null;
      if (d && period.start && d < period.start) return false;
      if (d && period.end && d > period.end) return false;
      return true;
    });
  }, [scopedRequests, statusFilter, period]);

  const openRequestsAll = useMemo(() => scopedRequests.filter((r) => !hasFile(r) && !CLOSED_STATUSES.includes(String(r.status || "").toLowerCase())), [scopedRequests]);
  const overdueAll = useMemo(() => openRequestsAll.filter(isOverdue), [openRequestsAll]);
  const receivedUploadsAll = useMemo(() => scopedUploads.filter((u) => u.direction === "Client to Firm" && u.status !== "Removed"), [scopedUploads]);
  const sentUploadsAll = useMemo(() => scopedUploads.filter((u) => u.direction === "Firm to Client" && u.status !== "Removed"), [scopedUploads]);

  const openRequests = useMemo(() => filteredRequests.filter((r) => !hasFile(r) && !CLOSED_STATUSES.includes(String(r.status || "").toLowerCase())), [filteredRequests]);
  const receivedRequests = useMemo(() => filteredRequests.filter((r) => (uploadsByRequestId.get(r.request_id) || []).some((u) => u.direction === "Client to Firm")), [filteredRequests, uploadsByRequestId]);
  const sentRequests = useMemo(() => filteredRequests.filter((r) => (uploadsByRequestId.get(r.request_id) || []).some((u) => u.direction === "Firm to Client")), [filteredRequests, uploadsByRequestId]);

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
      alert(err instanceof ApiError ? err.message : "Could not update status.");
    } finally {
      setSavingStatusId(null);
    }
  }

  async function handleAction(request: DocumentRequest, action: string) {
    if (action === "upload") return navigate(`/documents/${request.request_id}?open=upload`);
    if (action === "edit") return navigate(`/documents/${request.request_id}`);
    if (action === "delete-request") {
      const confirmValue = prompt(`Permanently delete "${request.requested_item}"? This cannot be undone. Type DELETE DOCUMENT to confirm.`);
      if (confirmValue === null) return;
      try {
        await api.post(`/documents/requests/${request.request_id}/delete`, { confirm: confirmValue });
        toast("Document request deleted.");
        loadAll();
      } catch (err) {
        alert(err instanceof ApiError ? err.message : "Could not delete this request.");
      }
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    const confirmValue = prompt(`Permanently delete ${selected.size} selected document request(s)? This cannot be undone. Type DELETE SELECTED to confirm.`);
    if (confirmValue === null) return;
    setBulkBusy(true);
    try {
      const res = await api.post<{ deleted: number }>("/documents/requests/bulk-delete", { requestIds: Array.from(selected), confirm: confirmValue });
      toast(`${res.deleted} document request(s) deleted.`);
      setSelected(new Set());
      loadAll();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Bulk delete failed.");
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
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Documents</h1>
      </div>

      {scopedClientId && (
        <div className="card" style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Reviewing documents for <strong>{scopedClientName || scopedClientId}</strong>.</span>
          <button className="btn btn-sm" onClick={() => setSearchParams({})}>Show All Documents</button>
        </div>
      )}

      {canManage && (
        <FilterBar
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
          <h2>Requests and File Exchange</h2>
          <p>Track requests, client uploads, firm-shared files, and request status from one page.</p>
          <div className="quick-actions" style={{ marginTop: 12 }}>
            <button className="action-button" type="button" onClick={() => setShowNewWorkItem(true)}>New Document Request</button>
          </div>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {canManage && ready && (
        <div className="metric-grid" style={{ marginBottom: 20 }}>
          <div className="metric">
            <div className="metric-label">Waiting</div>
            <div className="metric-value">{openRequestsAll.length}</div>
            <div className="metric-note">{openRequests.length} visible</div>
          </div>
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
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-scroll card-table">
          <table>
            <thead><tr><th>Requested Item</th><th>Status</th><th>Priority</th><th>Due</th><th>Files</th></tr></thead>
            <tbody>
              {scopedRequests.map((r) => (
                <tr key={r.request_id} onClick={() => navigate(`/documents/${r.request_id}`)} style={{ cursor: "pointer" }}>
                  <td>{r.requested_item}</td>
                  <td data-label="Status"><StatusBadge status={r.status} /></td>
                  <td className="muted" data-label="Priority">{r.priority || "—"}</td>
                  <td className="muted" data-label="Due">{r.due_from_client || "—"}</td>
                  <td data-label="Files"><FilesCell request={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {scopedRequests.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No document requests.</p>}
        </div>
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
                    {canManage && <th style={{ width: 32 }}><input type="checkbox" checked={openRequests.length > 0 && selected.size === openRequests.length} onChange={toggleSelectAll} /></th>}
                    <th>Client</th><th>Request</th><th>Requested</th><th>Due</th><th>Owner</th><th>Status</th><th>Files</th><th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {openRequests.map((r) => (
                    <tr key={r.request_id} onClick={() => { setSelectedClient(r.client_id, r.client_name); navigate(`/documents/${r.request_id}`); }}>
                      {canManage && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(r.request_id)} onChange={() => toggleSelected(r.request_id)} /></td>}
                      <td>{r.client_name}</td>
                      <td data-label="Request">{r.requested_item}</td>
                      <td className="muted" data-label="Requested">{r.request_date ? fmtDateOnly(r.request_date) : "—"}</td>
                      <td className={isOverdue(r) ? "muted" : "muted"} data-label="Due" style={isOverdue(r) ? { color: "var(--danger, #cf222e)", fontWeight: 600 } : undefined}>{r.due_from_client || "—"}{isOverdue(r) ? " (overdue)" : ""}</td>
                      <td className="muted" data-label="Owner">{r.assigned_to || "—"}</td>
                      <td data-label="Status" onClick={(e) => e.stopPropagation()}>
                        {canManage ? (
                          <select className="inline-select" value={r.status || "Requested"} disabled={savingStatusId === r.request_id} onChange={(e) => handleStatusChange(r.request_id, e.target.value)}>
                            {(options?.documentStatuses || DOCUMENT_STATUSES).map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : <StatusBadge status={r.status} />}
                      </td>
                      <td data-label="Files"><FilesCell request={r} /></td>
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
              <span className="muted" style={{ fontSize: 12 }}>{receivedRequests.length} request(s) ready</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <div className="table-scroll card-table">
              <table>
                <thead><tr><th>Client</th><th>Request</th><th>Requested</th><th>Due</th><th>Owner</th><th>Status</th><th>Files</th><th>Action</th></tr></thead>
                <tbody>
                  {receivedRequests.map((r) => (
                    <tr key={r.request_id} onClick={() => { setSelectedClient(r.client_id, r.client_name); navigate(`/documents/${r.request_id}`); }}>
                      <td>{r.client_name}</td>
                      <td data-label="Request">{r.requested_item}</td>
                      <td className="muted" data-label="Requested">{r.request_date ? fmtDateOnly(r.request_date) : "—"}</td>
                      <td className="muted" data-label="Due">{r.due_from_client || "—"}</td>
                      <td className="muted" data-label="Owner">{r.assigned_to || "—"}</td>
                      <td data-label="Status"><StatusBadge status={r.status} /></td>
                      <td data-label="Files"><FilesCell request={r} /></td>
                      <td data-label="Action" onClick={(e) => e.stopPropagation()}>{canManage && <ActionMenu options={documentActionOptions(user?.role)} onSelect={(action) => handleAction(r, action)} />}</td>
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
              <span className="muted" style={{ fontSize: 12 }}>{sentRequests.length} request(s) shared</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <div className="table-scroll card-table">
              <table>
                <thead><tr><th>Client</th><th>Request</th><th>Requested</th><th>Due</th><th>Owner</th><th>Status</th><th>Files</th><th>Action</th></tr></thead>
                <tbody>
                  {sentRequests.map((r) => (
                    <tr key={r.request_id} onClick={() => { setSelectedClient(r.client_id, r.client_name); navigate(`/documents/${r.request_id}`); }}>
                      <td>{r.client_name}</td>
                      <td data-label="Request">{r.requested_item}</td>
                      <td className="muted" data-label="Requested">{r.request_date ? fmtDateOnly(r.request_date) : "—"}</td>
                      <td className="muted" data-label="Due">{r.due_from_client || "—"}</td>
                      <td className="muted" data-label="Owner">{r.assigned_to || "—"}</td>
                      <td data-label="Status"><StatusBadge status={r.status} /></td>
                      <td data-label="Files"><FilesCell request={r} /></td>
                      <td data-label="Action" onClick={(e) => e.stopPropagation()}>{canManage && <ActionMenu options={documentActionOptions(user?.role)} onSelect={(action) => handleAction(r, action)} />}</td>
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
