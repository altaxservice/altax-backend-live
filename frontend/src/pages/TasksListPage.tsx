import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Task } from "../api/types";
import type { TaskRule, WebOptions } from "../api/types2";
import { StatusBadge, colorClassFor } from "../components/StatusBadge";
import { ActionMenu } from "../components/ActionMenu";
import { FilterBar, exportCsv, activeViewDates } from "../components/FilterBar";
import { useToast } from "../components/Toast";
import { useSelectedClient } from "../context/SelectedClientContext";
import { useAuth } from "../auth/AuthContext";
import { fmtDateOnly } from "../utils/date";
import { useStickyState } from "../utils/listState";
import { saveListOrder } from "../utils/listNav";
import { TASK_STATUSES, isOpenTask, isOverdue, isDueToday, isDueWeek, isWaiting, DueLabel, TaskFileCell, taskActionOptions, TASK_QUICK_ACTIONS, TASK_QUICK_ACTION_ICON } from "../components/TaskCells";
import { LabelChips, LabelPicker, useEntityLabels } from "../components/Labels";
import { CreateBatchTasksModal } from "../components/CreateBatchTasksModal";
import { NewWorkItemModal } from "../components/NewWorkItemModal";
import { RequestDocumentModal } from "../components/RequestDocumentModal";
import { ErrorBanner } from "../components/ErrorBanner";
import { useConfirm, usePrompt, useNotify } from "../components/ConfirmProvider";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

const QUICK_TABS = ["Active", "Overdue", "Due Today", "Due Week", "Waiting", "All Active", "Completed", "Archived", "All History"] as const;
// Grouped into "live" (what's actually open right now) vs "history" (completed/
// archived/everything) purely for a visual divider in the quick-tab row — same
// underlying QUICK_TABS list and behavior, just clustered so the row reads as two
// short groups instead of nine flat, equally-weighted pills.
const LIVE_TABS = ["Active", "Overdue", "Due Today", "Due Week", "Waiting", "All Active"] as const;
const HISTORY_TABS = ["Completed", "Archived", "All History"] as const;
type QuickTab = typeof QUICK_TABS[number];
type SortKey = "client_name" | "service_line" | "task_name" | "agency_due_date" | "assigned_to";

export function TasksListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();
  const notify = useNotify();
  const { setSelectedClient } = useSelectedClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [archivedTasks, setArchivedTasks] = useState<Task[] | null>(null);
  const [rules, setRules] = useState<TaskRule[]>([]);
  const [options, setOptions] = useState<WebOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Sticky for the session so opening a task and pressing Back returns you to the
  // same filtered, sorted list — with the task you were working on still in it.
  const [search, setSearch] = useStickyState("tasks.search", "");
  const [quickTab, setQuickTab] = useStickyState<QuickTab>("tasks.tab", "Active");
  const [staffFilter, setStaffFilter] = useStickyState("tasks.staff", "all");
  const [serviceFilter, setServiceFilter] = useStickyState("tasks.service", "all");
  const [statusFilter, setStatusFilter] = useStickyState("tasks.status", searchParams.get("status") || "all");
  const [labelFilter, setLabelFilter] = useStickyState("tasks.label", "all");
  const [period, setPeriod] = useState(activeViewDates());

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useStickyState<SortKey>("tasks.sortKey", "agency_due_date");
  const [sortDir, setSortDir] = useStickyState<"asc" | "desc">("tasks.sortDir", "asc");

  const [showBatchModal, setShowBatchModal] = useState(false);
  // Only for the "no rules yet" fallback panel below — CreateBatchTasksModal handles
  // its own Escape when rules exist.
  useEscapeToClose(() => setShowBatchModal(false), showBatchModal && rules.length === 0);
  const batchEmptyPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(batchEmptyPanelRef, showBatchModal && rules.length === 0);
  const [requestDocTask, setRequestDocTask] = useState<Task | null>(null);
  const [showNewWorkItem, setShowNewWorkItem] = useState(searchParams.get("new") === "1");
  const newWorkItemClientId = searchParams.get("clientId") || undefined;
  // Same ?clientId= param doubles as a list filter — the Client panel's "Open
  // Tasks" count links here with just clientId (no new=1) to land on that
  // client's tasks directly instead of the entire unfiltered pipeline.
  const clientIdFilter = searchParams.get("clientId") || null;

  const canManage = user?.role === "admin" || user?.role === "staff";
  const { allLabels, byEntity: taskLabels, assign: assignLabel, unassign: unassignLabel } = useEntityLabels("task");

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

  useEffect(() => {
    if (canManage) api.get<WebOptions>("/system/options").then(setOptions).catch(() => {});
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
  // Union of the canonical task-type list (/system/options) and whatever's actually
  // on existing tasks — building this from live tasks alone (the old behavior) hid
  // every task type no task had used yet, so newly added ones (Health Permit, Use &
  // Occupancy Permit, …) could never be filtered on until a task existed for them.
  const serviceOptions = useMemo(
    () => Array.from(new Set([...(options?.taskTypes || []), ...(tasks || []).map((t) => t.service_line).filter(Boolean) as string[]])),
    [tasks, options]
  );
  // Label names, not label_ids, since that's what the FilterBar select renders
  // as both the option value and its display text — safe because label names
  // are firm-unique (sql/030_labels.sql: uq_v3_labels_name).
  const labelNames = useMemo(() => allLabels.map((l) => l.name).sort(), [allLabels]);

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

    if (clientIdFilter) rows = rows.filter((t) => t.client_id === clientIdFilter);
    if (staffFilter !== "all") rows = rows.filter((t) => t.assigned_to === staffFilter);
    if (serviceFilter !== "all") rows = rows.filter((t) => t.service_line === serviceFilter);
    if (statusFilter !== "all") rows = rows.filter((t) => String(t.status || "").toLowerCase() === statusFilter.toLowerCase());
    if (labelFilter !== "all") rows = rows.filter((t) => (taskLabels[t.task_id] || []).some((l) => l.name === labelFilter));

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
  }, [baseRows, quickTab, clientIdFilter, staffFilter, serviceFilter, statusFilter, labelFilter, taskLabels, search, sortKey, sortDir, isArchivedView]);

  // Lets TaskDetailPage's Previous/Next paging step through whatever
  // filtered/sorted order is currently on screen — see utils/listNav.ts.
  useEffect(() => {
    saveListOrder("tasks", filtered.map((t) => t.task_id));
  }, [filtered]);

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
      const typed = await promptFor({
        title: "Permanently delete tasks",
        message: `${selected.size} selected task(s) — this cannot be undone. Type DELETE SELECTED to confirm.`,
        placeholder: "DELETE SELECTED",
      });
      if (typed === null) return;
      confirmValue = typed;
    } else {
      const ok = await confirmDialog({ title: action === "complete" ? "Complete tasks" : "Void tasks", message: `${action === "complete" ? "Complete" : "Void"} ${selected.size} selected task(s)?` });
      if (!ok) return;
    }
    setBulkBusy(true);
    try {
      const res = await api.post<{ succeeded: number; failed: string[] }>("/tasks/bulk", { taskIds: Array.from(selected), action, confirm: confirmValue });
      if (res.failed.length) await notify(`${res.succeeded} updated, ${res.failed.length} could not be updated (no access or not found).`);
      else toast(`${res.succeeded} task(s) ${action === "delete" ? "deleted" : "updated"}.`);
      setSelected(new Set());
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Bulk action failed.");
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
      await notify(err instanceof ApiError ? err.message : "Could not restore this task.");
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
      await notify(err instanceof ApiError ? err.message : "Could not update status.");
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
    if (action === "request-doc") return setRequestDocTask(task);
    if (action === "void-task") {
      const reason = await promptFor({ title: "Void task", message: "Reason for voiding this task?" });
      if (reason === null) return;
      try {
        await api.post(`/tasks/${task.task_id}/void`, { reason });
        toast("Task voided.");
        load();
      } catch (err) {
        await notify(err instanceof ApiError ? err.message : "Could not void this task.");
      }
    }
    if (action === "delete-task") {
      const confirmValue = await promptFor({
        title: "Permanently delete task",
        message: `"${task.task_name}" — this cannot be undone. Type DELETE TASK to confirm.`,
        placeholder: "DELETE TASK",
      });
      if (confirmValue === null) return;
      try {
        await api.post(`/tasks/${task.task_id}/delete`, { confirm: confirmValue });
        toast("Task deleted.");
        load();
      } catch (err) {
        await notify(err instanceof ApiError ? err.message : "Could not delete this task.");
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
      {clientIdFilter && (
        <div className="card" style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px" }}>
          <span>Showing tasks for <strong>{filtered[0]?.client_name || clientIdFilter}</strong> only.</span>
          <button type="button" className="btn btn-sm" onClick={() => setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete("clientId"); return next; })}>Show all clients</button>
        </div>
      )}

      {canManage && (
        <FilterBar
          search={!isArchivedView ? { value: search, onChange: setSearch, placeholder: "Task, client, owner…" } : undefined}
          selects={[
            { label: "Staff", value: staffFilter, options: staffOptions, onChange: setStaffFilter },
            { label: "Service", value: serviceFilter, options: serviceOptions, onChange: setServiceFilter },
            { label: "Status", value: statusFilter, options: TASK_STATUSES, onChange: setStatusFilter },
            { label: "Label", value: labelFilter, options: labelNames, onChange: setLabelFilter },
          ]}
          period={{ start: period.start, end: period.end, onStartChange: (v) => setPeriod((p) => ({ ...p, start: v })), onEndChange: (v) => setPeriod((p) => ({ ...p, end: v })), onActiveView: () => setPeriod(activeViewDates()) }}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          onExportCsv={handleExport}
        >
          {/* Bulk-action buttons only take up space once something is actually
              selected — previously always rendered (just disabled), which meant
              3 extra buttons sat in the toolbar on every visit regardless of
              whether there was anything to act on. */}
          {!isArchivedView && selected.size > 0 && (
            <>
              <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{selected.size} selected</span>
              <button type="button" className="ghost-button" disabled={bulkBusy} onClick={() => handleBulk("complete")}>Mark Complete</button>
              <button type="button" className="ghost-button" disabled={bulkBusy} onClick={() => handleBulk("void")}>Void</button>
              {user?.role === "admin" && (
                <button type="button" className="danger-button" disabled={bulkBusy} onClick={() => handleBulk("delete")}>Delete</button>
              )}
            </>
          )}
          <button className="ghost-button" type="button" onClick={() => setShowBatchModal(true)}>Create Batch Tasks</button>
          <button className="action-button" type="button" onClick={() => setShowNewWorkItem(true)}>New Work Item</button>
        </FilterBar>
      )}

      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, margin: "0 0 12px" }}>
        <div className="quick-tabs">
          {LIVE_TABS.map((t) => (
            <button key={t} type="button" className={`quick-tab ${quickTab === t ? "active" : ""}`} onClick={() => goToTab(t)}>{t}</button>
          ))}
        </div>
        <div style={{ width: 1, alignSelf: "stretch", background: "var(--line)" }} />
        <div className="quick-tabs">
          {HISTORY_TABS.map((t) => (
            <button key={t} type="button" className={`quick-tab ${quickTab === t ? "active" : ""}`} onClick={() => goToTab(t)}>{t}</button>
          ))}
        </div>
      </div>

      {canManage && !isArchivedView && (
        <div className="metric-grid" style={{ marginBottom: 12 }}>
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
            {/* Just the single biggest group, not a 3-way pipe-joined list — the
                full breakdown is one click away in the table itself, so this tile
                only needs to say "here's what's piling up," not restate the table. */}
            <div className="metric-note">{taskGroupCounts.length ? `Top: ${taskGroupCounts[0][0]} (${taskGroupCounts[0][1]})` : "—"}</div>
          </button>
          <button type="button" className="metric metric-clickable" onClick={() => goToTab("All Active")}>
            <div className="metric-label">Staff Load</div>
            <div className="metric-value">{staffLoadCounts.length}</div>
            <div className="metric-note">{staffLoadCounts.length ? `Busiest: ${staffLoadCounts[0][0]} (${staffLoadCounts[0][1]})` : "—"}</div>
          </button>
          <button type="button" className="metric metric-clickable" onClick={() => goToTab("Waiting")}>
            <div className="metric-label">Waiting</div>
            <div className="metric-value">{waitingAll.length}</div>
            <div className="metric-note">client/docs/pending</div>
          </button>
        </div>
      )}

      {error && <ErrorBanner error={error} />}

      {!ready && <div className="spinner-wrap">Loading tasks…</div>}

      {ready && (
        /* No overflow:hidden here (unlike most .card wrappers) — that would clip
           the sticky table header, since position:sticky's stick range is bound
           by the nearest ancestor whose overflow isn't visible. The card's own
           border-radius still rounds its outer edge visually via its border. */
        <div className="card" style={{ padding: 0 }} id="master-task-pipeline">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ fontSize: 14 }}>{tableTitle}</strong>
            <span className="muted" style={{ fontSize: 12 }}>{filtered.length} tasks</span>
          </div>
          {/* No separate overflow:auto wrapper around .table-scroll — that div computed
              its own overflow-y to "auto" too (pairing a non-visible overflow-x with a
              default-visible overflow-y forces this per spec), becoming a second scroll
              container that broke the sticky header below exactly like .table-scroll
              itself used to before it got an explicit overflow-y:visible. */}
          <div className="table-scroll card-table no-h-scroll">
          <table>
            <thead>
              <tr>
                {!isArchivedView && canManage && (
                  <th scope="col" style={{ width: 32 }}><input type="checkbox" checked={selected.size > 0 && selected.size === filtered.length} onChange={toggleSelectAll} /></th>
                )}
                {/* Client+Service, Task+Priority, Due+Risk and Owner+Last-Updated
                    are each stacked in one cell. As 12 separate columns this table
                    was ~1360px and ran off the right edge at 100% zoom. */}
                <th scope="col" className="sortable" tabIndex={0} role="button" onClick={() => toggleSort("client_name")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort("client_name"); } }}>Client{sortArrow("client_name")}</th>
                <th scope="col" className="sortable" tabIndex={0} role="button" onClick={() => toggleSort("task_name")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort("task_name"); } }}>Task{sortArrow("task_name")}</th>
                <th scope="col" className="sortable" tabIndex={0} role="button" onClick={() => toggleSort("agency_due_date")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort("agency_due_date"); } }}>Due{sortArrow("agency_due_date")}</th>
                <th scope="col" className="sortable" tabIndex={0} role="button" onClick={() => toggleSort("assigned_to")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort("assigned_to"); } }}>Owner{sortArrow("assigned_to")}</th>
                <th scope="col">Status</th>
                {isArchivedView && <th scope="col">Archived</th>}
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.task_id} data-row-id={t.task_id} tabIndex={0} onClick={() => { setSelectedClient(t.client_id, t.client_name); navigate(`/tasks/${t.task_id}`); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedClient(t.client_id, t.client_name); navigate(`/tasks/${t.task_id}`); } }}>
                  {!isArchivedView && canManage && (
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(t.task_id)} onChange={() => toggleSelected(t.task_id)} /></td>
                  )}
                  <td>
                    {/* Wrapped in one div so card-table's mobile layout (a flex row per
                        <td>, label on the left) sees a single flex item instead of two
                        or three, and these lines stack the way they do on desktop. */}
                    <div>
                      <div>{t.client_name}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{t.service_line || "—"}</div>
                    </div>
                  </td>
                  <td data-label="Task">
                    <div>
                      <div>{t.task_name}</div>
                      {t.priority && t.priority !== "Normal" && (
                        <div style={{ marginTop: 2 }}><StatusBadge status={t.priority} /></div>
                      )}
                      <LabelChips labels={taskLabels[t.task_id] || []} onRemove={canManage ? (labelId) => unassignLabel(t.task_id, labelId) : undefined} />
                      {canManage && (
                        <LabelPicker
                          allLabels={allLabels}
                          assignedIds={new Set((taskLabels[t.task_id] || []).map((l) => l.label_id))}
                          onAdd={(labelId) => assignLabel(t.task_id, labelId)}
                        />
                      )}
                    </div>
                  </td>
                  <td data-label="Due">
                    <div>
                      <div className="muted">{fmtDateOnly(t.agency_due_date)}</div>
                      <DueLabel task={t} />
                    </div>
                  </td>
                  <td className="muted" data-label="Owner">
                    <div>
                      <div>{t.assigned_to || "Unassigned"}</div>
                      <div style={{ fontSize: 11 }}>{t.updated_at ? `Upd. ${fmtDateOnly(t.updated_at)}` : "Not updated"}</div>
                      {t.updated_by && <div style={{ fontSize: 11 }}>by {t.updated_by}</div>}
                    </div>
                  </td>
                  <td data-label="Status" onClick={(e) => e.stopPropagation()}>
                    {!isArchivedView && canManage ? (
                      <select className={`inline-select ${colorClassFor(t.status || "Not Started")}`} value={t.status || "Not Started"} disabled={savingStatusId === t.task_id} onChange={(e) => handleStatusChange(t.task_id, e.target.value)}>
                        {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : <StatusBadge status={t.status} />}
                  </td>
                  {isArchivedView && <td className="muted" data-label="Archived">{t.archived_at ? new Date(String(t.archived_at)).toLocaleDateString() : "—"}</td>}
                  {/* Files folded in here rather than owning a column of its own —
                      most rows have no attachment, so a whole column was spent
                      printing "No file". */}
                  <td data-label="Action" onClick={(e) => e.stopPropagation()}>
                    {isArchivedView ? (
                      <button type="button" className="btn btn-sm" disabled={restoring === t.task_id} onClick={() => handleRestore(t.task_id)}>{restoring === t.task_id ? "Restoring…" : "Restore"}</button>
                    ) : (
                      <>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          {user?.role !== "client" && TASK_QUICK_ACTIONS.map((a) => {
                            const Icon = TASK_QUICK_ACTION_ICON[a.value];
                            return (
                              <button key={a.value} type="button" className="btn btn-sm" onClick={() => handleAction(t, a.value)}>
                                {Icon && <Icon size={13} strokeWidth={2} aria-hidden="true" />}
                                {a.label}
                              </button>
                            );
                          })}
                          <ActionMenu options={taskActionOptions(user?.role)} onSelect={(action) => handleAction(t, action)} />
                        </div>
                        {t.first_file_url && <TaskFileCell task={t} />}
                      </>
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
            <div ref={batchEmptyPanelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="batch-tasks-empty-title" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header"><h2 id="batch-tasks-empty-title">Create Batch Tasks</h2><button className="btn btn-sm" onClick={() => setShowBatchModal(false)}>Close</button></div>
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

      {requestDocTask && (
        <RequestDocumentModal
          clientId={requestDocTask.client_id}
          clientName={requestDocTask.client_name}
          taskId={requestDocTask.task_id}
          onClose={() => setRequestDocTask(null)}
          onDone={() => load()}
        />
      )}
    </div>
  );
}
