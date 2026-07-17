import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Task } from "../api/types";
import type { TaskRule } from "../api/types2";
import { StatusBadge } from "../components/StatusBadge";
import { ActionMenu } from "../components/ActionMenu";
import { FilterBar, exportCsv, activeViewDates } from "../components/FilterBar";
import { useToast } from "../components/Toast";
import { useSelectedClient } from "../context/SelectedClientContext";
import { useAuth } from "../auth/AuthContext";
import { fmtDateOnly } from "../utils/date";
import { TASK_STATUSES, isOpenTask, isOverdue, isDueToday, isDueWeek, isWaiting, DueLabel, TaskFileCell, taskActionOptions } from "../components/TaskCells";
import { CreateBatchTasksModal } from "../components/CreateBatchTasksModal";
import { NewWorkItemModal } from "../components/NewWorkItemModal";

const QUICK_TABS = ["Active", "Overdue", "Due Today", "Due Week", "Waiting", "All Active", "Completed", "Archived", "All History"] as const;
type QuickTab = typeof QUICK_TABS[number];
type SortKey = "client_name" | "service_line" | "task_name" | "agency_due_date" | "assigned_to";

export function TasksListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const { setSelectedClient } = useSelectedClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [archivedTasks, setArchivedTasks] = useState<Task[] | null>(null);
  const [rules, setRules] = useState<TaskRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState("");
  const [quickTab, setQuickTab] = useState<QuickTab>("Active");
  const [staffFilter, setStaffFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [period, setPeriod] = useState(activeViewDates());

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("agency_due_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showNewWorkItem, setShowNewWorkItem] = useState(searchParams.get("new") === "1");
  const newWorkItemClientId = searchParams.get("clientId") || undefined;

  const canManage = user?.role === "admin" || user?.role === "staff";

  function load(): Promise<void> {
    return api.get<{ tasks: Task[] }>("/tasks")
      .then((res) => setTasks(res.tasks))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load tasks."));
  }
  useEffect(() => { load(); }, []);

  function loadArchived(): Promise<void> {
    return api.get<{ tasks: Task[] }>("/tasks/archived/list").then((res) => setArchivedTasks(res.tasks)).catch(() => {});
  }
  useEffect(() => {
    if ((quickTab === "Archived" || quickTab === "Completed" || quickTab === "All History") && archivedTasks === null) loadArchived();
  }, [quickTab]);

  useEffect(() => {
    if (canManage) api.get<{ rules: TaskRule[] }>("/rules").then((res) => setRules(res.rules)).catch(() => {});
  }, [canManage]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([load(), archivedTasks !== null ? loadArchived() : Promise.resolve()]);
      toast("Data refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  const staffOptions = useMemo(() => Array.from(new Set((tasks || []).map((t) => t.assigned_to).filter(Boolean))) as string[], [tasks]);
  const serviceOptions = useMemo(() => Array.from(new Set((tasks || []).map((t) => t.service_line).filter(Boolean))) as string[], [tasks]);

  const isArchivedView = quickTab === "Archived";

  /**
   * Which underlying rows a quick-tab draws from. Completed tasks are auto-archived the
   * moment their status is set (see tasks.routes.ts archiveTask), so a live-table
   * status==='Completed' filter would always be empty — "Completed" has to read from the
   * archive instead. "All History" merges both sources, matching legacy's description.
   */
  const baseRows: Task[] = useMemo(() => {
    if (quickTab === "Archived") return archivedTasks || [];
    if (quickTab === "Completed") return (archivedTasks || []).filter((t) => String(t.status || "").toLowerCase() === "completed");
    if (quickTab === "All History") return [...(tasks || []), ...(archivedTasks || [])];
    return tasks || [];
  }, [quickTab, tasks, archivedTasks]);

  const filtered = useMemo(() => {
    let rows = baseRows;
    if (quickTab === "Active" || quickTab === "All Active") rows = rows.filter(isOpenTask);
    else if (quickTab === "Overdue") rows = rows.filter((t) => isOpenTask(t) && isOverdue(t));
    else if (quickTab === "Due Today") rows = rows.filter((t) => isOpenTask(t) && isDueToday(t));
    else if (quickTab === "Due Week") rows = rows.filter((t) => isOpenTask(t) && isDueWeek(t));
    else if (quickTab === "Waiting") rows = rows.filter((t) => isOpenTask(t) && isWaiting(t));

    if (staffFilter !== "all") rows = rows.filter((t) => t.assigned_to === staffFilter);
    if (serviceFilter !== "all") rows = rows.filter((t) => t.service_line === serviceFilter);
    if (statusFilter !== "all") rows = rows.filter((t) => String(t.status || "").toLowerCase() === statusFilter.toLowerCase());

    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((t) => [t.task_name, t.client_name, t.assigned_to, t.service_line].some((v) => String(v || "").toLowerCase().includes(q)));

    if (!isArchivedView) {
      rows = [...rows].sort((a, b) => {
        const av = String(a[sortKey] || "");
        const bv = String(b[sortKey] || "");
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
    } else {
      rows = [...rows].sort((a, b) => new Date(String(b.archived_at || b.agency_due_date || 0)).getTime() - new Date(String(a.archived_at || a.agency_due_date || 0)).getTime());
    }
    return rows;
  }, [baseRows, quickTab, staffFilter, serviceFilter, statusFilter, search, sortKey, sortDir, isArchivedView]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }
  function sortArrow(key: SortKey) { return sortKey !== key ? "" : sortDir === "asc" ? " ▲" : " ▼"; }

  function toggleSelected(taskId: string) {
    setSelected((prev) => { const next = new Set(prev); next.has(taskId) ? next.delete(taskId) : next.add(taskId); return next; });
  }
  function toggleSelectAll() {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((t) => t.task_id))));
  }

  async function handleBulk(action: "complete" | "void" | "delete") {
    if (selected.size === 0) return;
    let confirmValue: string | undefined;
    if (action === "delete") {
      const typed = prompt(`Permanently delete ${selected.size} selected task(s)? This cannot be undone. Type DELETE SELECTED to confirm.`);
      if (typed === null) return;
      confirmValue = typed;
    } else if (!confirm(`${action === "complete" ? "Complete" : "Void"} ${selected.size} selected task(s)?`)) {
      return;
    }
    setBulkBusy(true);
    try {
      const res = await api.post<{ succeeded: number; failed: string[] }>("/tasks/bulk", { taskIds: Array.from(selected), action, confirm: confirmValue });
      if (res.failed.length) alert(`${res.succeeded} updated, ${res.failed.length} could not be updated (no access or not found).`);
      else toast(`${res.succeeded} task(s) ${action === "delete" ? "deleted" : "updated"}.`);
      setSelected(new Set());
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Bulk action failed.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleRestore(taskId: string) {
    setRestoring(taskId);
    try {
      await api.post(`/tasks/${taskId}/restore`, {});
      loadArchived();
      load();
      toast("Task restored.");
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not restore this task.");
    } finally {
      setRestoring(null);
    }
  }

  async function handleStatusChange(taskId: string, status: string) {
    setSavingStatusId(taskId);
    try {
      await api.patch(`/tasks/${taskId}`, { status });
      toast("Status updated.");
      await load();
      if (archivedTasks !== null) await loadArchived();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not update status.");
    } finally {
      setSavingStatusId(null);
    }
  }

  async function handleAction(task: Task, action: string) {
    if (action === "review-task" || action === "task-history") return navigate(`/tasks/${task.task_id}`);
    if (action === "task-message") return navigate(`/tasks/${task.task_id}?open=message`);
    if (action === "task-note") return navigate(`/tasks/${task.task_id}?open=note`);
    if (action === "edit-task") return navigate(`/tasks/${task.task_id}?open=edit`);
    if (action === "task-file") return navigate(`/tasks/${task.task_id}?open=files`);
    if (action === "request-doc") return navigate(`/documents?new=1&clientId=${task.client_id}&taskId=${task.task_id}`);
    if (action === "void-task") {
      const reason = prompt("Reason for voiding this task?");
      if (reason === null) return;
      try {
        await api.post(`/tasks/${task.task_id}/void`, { reason });
        toast("Task voided.");
        load();
      } catch (err) {
        alert(err instanceof ApiError ? err.message : "Could not void this task.");
      }
    }
    if (action === "delete-task") {
      const confirm = prompt(`Permanently delete "${task.task_name}"? This cannot be undone. Type DELETE TASK to confirm.`);
      if (confirm === null) return;
      try {
        await api.post(`/tasks/${task.task_id}/delete`, { confirm });
        toast("Task deleted.");
        load();
      } catch (err) {
        alert(err instanceof ApiError ? err.message : "Could not delete this task.");
      }
    }
  }

  function handleExport() {
    exportCsv("tasks.csv", [
      { key: "client_name", label: "Client" }, { key: "service_line", label: "Service" }, { key: "task_name", label: "Task" },
      { key: "agency_due_date", label: "Due" }, { key: "status", label: "Status" }, { key: "assigned_to", label: "Owner" },
    ], filtered as unknown as Record<string, unknown>[]);
  }

  const openTasksAll = (tasks || []).filter(isOpenTask);
  const overdueAll = openTasksAll.filter(isOverdue);
  const dueTodayAll = openTasksAll.filter(isDueToday);
  const waitingAll = openTasksAll.filter(isWaiting);
  const taskGroupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of openTasksAll) {
      const key = t.task_name || t.service_line || "Task";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [openTasksAll]);
  const staffLoadCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of openTasksAll) {
      const key = t.assigned_to || "Unassigned";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [openTasksAll]);

  const tableTitle = user?.role === "admin" ? "Master Task Pipeline" : "My Task Pipeline";
  const ready = isArchivedView ? archivedTasks !== null : quickTab === "Completed" || quickTab === "All History" ? tasks !== null && archivedTasks !== null : tasks !== null;

  function goToTab(tab: QuickTab) {
    setQuickTab(tab);
    setSelected(new Set());
    document.getElementById("master-task-pipeline")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Tasks</h1>
        {!isArchivedView && (
          <input
            placeholder="Search tasks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", width: 220 }}
          />
        )}
      </div>

      {canManage && (
        <FilterBar
          selects={[
            { label: "Staff", value: staffFilter, options: staffOptions, onChange: setStaffFilter },
            { label: "Service", value: serviceFilter, options: serviceOptions, onChange: setServiceFilter },
            { label: "Status", value: statusFilter, options: TASK_STATUSES, onChange: setStatusFilter },
          ]}
          period={{ start: period.start, end: period.end, onStartChange: (v) => setPeriod((p) => ({ ...p, start: v })), onEndChange: (v) => setPeriod((p) => ({ ...p, end: v })), onActiveView: () => setPeriod(activeViewDates()) }}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          onExportCsv={handleExport}
        >
          {!isArchivedView && (
            <>
              <button type="button" className="ghost-button" disabled={bulkBusy || selected.size === 0} onClick={() => handleBulk("complete")}>Mark Selected Complete</button>
              <button type="button" className="ghost-button" disabled={bulkBusy || selected.size === 0} onClick={() => handleBulk("void")}>Void Selected</button>
              {user?.role === "admin" && (
                <button type="button" className="danger-button" disabled={bulkBusy || selected.size === 0} onClick={() => handleBulk("delete")}>Delete Selected Tasks</button>
              )}
              {selected.size > 0 && <span className="muted" style={{ fontSize: 12 }}>{selected.size} selected</span>}
            </>
          )}
          <button className="ghost-button" type="button" onClick={() => setShowBatchModal(true)}>Create Batch Tasks</button>
          <button className="action-button" type="button" onClick={() => setShowNewWorkItem(true)}>New Work Item</button>
        </FilterBar>
      )}

      <div className="quick-tabs" style={{ margin: "10px 0 16px" }}>
        {QUICK_TABS.map((t) => (
          <button key={t} type="button" className={`quick-tab ${quickTab === t ? "active" : ""}`} onClick={() => goToTab(t)}>{t}</button>
        ))}
      </div>

      {canManage && !isArchivedView && (
        <div className="metric-grid" style={{ marginBottom: 16 }}>
          <button type="button" className="metric metric-clickable" onClick={() => goToTab("All Active")}>
            <div className="metric-label">Open Tasks</div>
            <div className="metric-value">{openTasksAll.length}</div>
            <div className="metric-note">{filtered.length} visible</div>
          </button>
          <button type="button" className="metric metric-clickable" onClick={() => goToTab("Overdue")}>
            <div className="metric-label">Overdue</div>
            <div className="metric-value">{overdueAll.length}</div>
            <div className="metric-note">before today</div>
          </button>
          <button type="button" className="metric metric-clickable" onClick={() => goToTab("Due Today")}>
            <div className="metric-label">Due Today</div>
            <div className="metric-value">{dueTodayAll.length}</div>
            <div className="metric-note">{fmtDateOnly(new Date().toISOString())}</div>
          </button>
          <button type="button" className="metric metric-clickable" onClick={() => goToTab("All Active")}>
            <div className="metric-label">Task Groups</div>
            <div className="metric-value">{taskGroupCounts.length}</div>
            <div className="metric-note">{taskGroupCounts.slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(" | ") || "—"}</div>
          </button>
          <button type="button" className="metric metric-clickable" onClick={() => goToTab("All Active")}>
            <div className="metric-label">Staff Load</div>
            <div className="metric-value">{staffLoadCounts.length}</div>
            <div className="metric-note">{staffLoadCounts.slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(" | ") || "—"}</div>
          </button>
          <button type="button" className="metric metric-clickable" onClick={() => goToTab("Waiting")}>
            <div className="metric-label">Waiting</div>
            <div className="metric-value">{waitingAll.length}</div>
            <div className="metric-note">client/docs/pending</div>
          </button>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {!ready && <div className="spinner-wrap">Loading tasks…</div>}

      {ready && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }} id="master-task-pipeline">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ fontSize: 14 }}>{tableTitle}</strong>
            <span className="muted" style={{ fontSize: 12 }}>{filtered.length} tasks</span>
          </div>
          <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                {!isArchivedView && canManage && (
                  <th style={{ width: 32 }}><input type="checkbox" checked={selected.size > 0 && selected.size === filtered.length} onChange={toggleSelectAll} /></th>
                )}
                <th className="sortable" onClick={() => toggleSort("client_name")}>Client{sortArrow("client_name")}</th>
                <th className="sortable" onClick={() => toggleSort("service_line")}>Service{sortArrow("service_line")}</th>
                <th className="sortable" onClick={() => toggleSort("task_name")}>Task{sortArrow("task_name")}</th>
                <th className="sortable" onClick={() => toggleSort("agency_due_date")}>Due{sortArrow("agency_due_date")}</th>
                <th>Risk</th>
                <th className="sortable" onClick={() => toggleSort("assigned_to")}>Owner{sortArrow("assigned_to")}</th>
                <th>Status</th>
                <th>Files</th>
                {isArchivedView && <th>Archived</th>}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.task_id} onClick={() => { setSelectedClient(t.client_id, t.client_name); navigate(`/tasks/${t.task_id}`); }}>
                  {!isArchivedView && canManage && (
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(t.task_id)} onChange={() => toggleSelected(t.task_id)} /></td>
                  )}
                  <td>{t.client_name}</td>
                  <td className="muted">{t.service_line || "—"}</td>
                  <td>{t.task_name}</td>
                  <td className="muted">{fmtDateOnly(t.agency_due_date)}</td>
                  <td><DueLabel task={t} /></td>
                  <td className="muted">{t.assigned_to || "Unassigned"}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {!isArchivedView && canManage ? (
                      <select className="inline-select" value={t.status || "Not Started"} disabled={savingStatusId === t.task_id} onChange={(e) => handleStatusChange(t.task_id, e.target.value)}>
                        {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : <StatusBadge status={t.status} />}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}><TaskFileCell task={t} /></td>
                  {isArchivedView && <td className="muted">{t.archived_at ? new Date(String(t.archived_at)).toLocaleDateString() : "—"}</td>}
                  <td onClick={(e) => e.stopPropagation()}>
                    {isArchivedView ? (
                      <button type="button" className="btn btn-sm" disabled={restoring === t.task_id} onClick={() => handleRestore(t.task_id)}>{restoring === t.task_id ? "Restoring…" : "Restore"}</button>
                    ) : (
                      <ActionMenu options={taskActionOptions(user?.role)} onSelect={(action) => handleAction(t, action)} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {filtered.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No tasks match.</p>}
        </div>
      )}

      {showBatchModal && (
        rules.length > 0 ? (
          <CreateBatchTasksModal rules={rules} onClose={() => setShowBatchModal(false)} onDone={() => load()} />
        ) : (
          <div className="modal-overlay" onClick={() => setShowBatchModal(false)}>
            <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header"><h2>Create Batch Tasks</h2><button className="btn btn-sm" onClick={() => setShowBatchModal(false)}>Close</button></div>
              <p className="muted">No task rules exist yet. Create one on the Rules page first.</p>
            </div>
          </div>
        )
      )}

      {showNewWorkItem && (
        <NewWorkItemModal
          initialClientId={newWorkItemClientId}
          onClose={() => { setShowNewWorkItem(false); setSearchParams({}); }}
          onDone={() => load()}
        />
      )}
    </div>
  );
}
