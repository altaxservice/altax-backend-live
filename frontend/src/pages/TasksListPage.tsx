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
import { useSelectedTask } from "../context/SelectedTaskContext";
import { useAuth } from "../auth/AuthContext";
import { fmtDateOnly } from "../utils/date";
import { useStickyState } from "../utils/listState";
import { saveListOrder } from "../utils/listNav";
import { TASK_STATUSES, statusOptionsForTaskType, DueLabel, TaskFileCell, taskActionOptions, TASK_QUICK_ACTIONS, TASK_QUICK_ACTION_ICON } from "../components/TaskCells";
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

// PERF-010 (Hard Audit, 2026-08-13) — live tabs (the fastest-growing, most-
// visited view) are now server-paginated/filtered/sorted instead of the page
// fetching every task the caller can see and filtering the whole set in the
// browser on every keystroke. History tabs (Completed/Archived/All History)
// are unchanged — smaller, slower-growing data, and "All History" genuinely
// needs the full live+archived union, so pagination doesn't help there.
const PAGE_SIZE = 50;
const isLiveTab = (t: QuickTab): boolean => (LIVE_TABS as readonly string[]).includes(t);

interface TaskSummary {
  openCount: number; overdueCount: number; dueTodayCount: number; waitingCount: number;
  taskGroupCount: number; topTaskGroup: { name: string; count: number } | null;
  staffLoadCount: number; topStaff: { name: string; count: number } | null;
}

export function TasksListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();
  const notify = useNotify();
  const { setSelectedClient } = useSelectedClient();
  const { setSelectedTask } = useSelectedTask();
  const [searchParams, setSearchParams] = useSearchParams();

  // `tasks` (the full live table) is now only fetched for the "All History"
  // tab, which genuinely needs the whole live+archived union — every other
  // live tab gets its rows from `pageTasks` (server-paginated) instead.
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [archivedTasks, setArchivedTasks] = useState<Task[] | null>(null);
  const [pageTasks, setPageTasks] = useState<Task[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<TaskSummary | null>(null);
  const [rules, setRules] = useState<TaskRule[]>([]);
  const [options, setOptions] = useState<WebOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Sticky for the session so opening a task and pressing Back returns you to the
  // same filtered, sorted list — with the task you were working on still in it.
  const [search, setSearch] = useStickyState("tasks.search", "");
  const [quickTab, setQuickTab] = useStickyState<QuickTab>("tasks.tab", "Active");
  // UX-003: seeded from ?staff= the same way statusFilter seeds from ?status=
  // below — lets the new admin-dashboard Staff Load panel deep-link straight
  // into a filtered pipeline instead of dumping the admin on the unfiltered one.
  const [staffFilter, setStaffFilter] = useStickyState("tasks.staff", searchParams.get("staff") || "all");
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

  /** Full live+archived union — the one thing only "All History" still needs. */
  function loadAllHistory(): Promise<void> {
    return api.get<{ tasks: Task[] }>("/tasks")
      .then((res) => setTasks(res.tasks))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load tasks."));
  }

  function liveQueryParams(): URLSearchParams {
    const params = new URLSearchParams();
    params.set("quickTab", quickTab);
    if (clientIdFilter) params.set("clientId", clientIdFilter);
    if (staffFilter !== "all") params.set("staff", staffFilter);
    if (serviceFilter !== "all") params.set("service", serviceFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (labelFilter !== "all") params.set("label", labelFilter);
    if (search.trim()) params.set("search", search.trim());
    params.set("sortBy", sortKey);
    params.set("sortDir", sortDir);
    return params;
  }

  /** Server-paginated/filtered/sorted fetch for the 6 live tabs. */
  function loadPage(): Promise<void> {
    if (!isLiveTab(quickTab)) return Promise.resolve();
    const params = liveQueryParams();
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    return api.get<{ tasks: Task[]; totalCount: number }>(`/tasks?${params.toString()}`)
      .then((res) => { setPageTasks(res.tasks); setTotalCount(res.totalCount); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load tasks."));
  }

  function loadSummary(): Promise<void> {
    return api.get<TaskSummary>("/tasks/summary").then(setSummary).catch(() => {});
  }

  function loadArchived(): Promise<void> {
    return api.get<{ tasks: Task[] }>("/tasks/archived/list").then((res) => setArchivedTasks(res.tasks)).catch(() => {});
  }

  /** Refreshes whatever's actually backing the current view, after a write. */
  function reloadCurrentView(): Promise<void> {
    return Promise.all([
      isLiveTab(quickTab) ? loadPage() : Promise.resolve(),
      quickTab === "All History" ? loadAllHistory() : Promise.resolve(),
      archivedTasks !== null ? loadArchived() : Promise.resolve(),
      loadSummary(),
    ]).then(() => {});
  }

  useEffect(() => { loadSummary(); }, []);

  useEffect(() => {
    if (quickTab === "Archived" || quickTab === "Completed" || quickTab === "All History") {
      if (archivedTasks === null) loadArchived();
    }
    if (quickTab === "All History" && tasks === null) loadAllHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickTab]);

  // Immediate refetch for live tabs on any structural filter/sort/page change.
  useEffect(() => {
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickTab, clientIdFilter, staffFilter, serviceFilter, statusFilter, labelFilter, sortKey, sortDir, page]);

  // A filter/sort change should always land back on page 1 — but changing
  // `page` itself obviously shouldn't re-trigger this reset.
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickTab, clientIdFilter, staffFilter, serviceFilter, statusFilter, labelFilter, sortKey, sortDir]);

  // Debounced separately from the effect above — typing shouldn't fire a
  // request per keystroke. Skips the mount-time firing (the effects above
  // already cover the initial load) so the page doesn't double-fetch on open.
  const searchMounted = useRef(false);
  useEffect(() => {
    if (!searchMounted.current) { searchMounted.current = true; return; }
    const t = setTimeout(() => { setPage(1); loadPage(); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (canManage) api.get<{ rules: TaskRule[] }>("/rules").then((res) => setRules(res.rules)).catch(() => {});
  }, [canManage]);

  useEffect(() => {
    if (canManage) api.get<WebOptions>("/system/options").then(setOptions).catch(() => {});
  }, [canManage]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([
        loadSummary(),
        isLiveTab(quickTab) ? loadPage() : Promise.resolve(),
        quickTab === "All History" ? loadAllHistory() : Promise.resolve(),
        archivedTasks !== null ? loadArchived() : Promise.resolve(),
      ]);
      toast("Data refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  // Sourced from /system/options (the canonical, firm-wide lists) rather than
  // derived from whatever tasks happen to be loaded — with live tabs now only
  // ever holding one page of rows, deriving these from `tasks` would shrink
  // the dropdowns to just what's on the current page.
  const staffOptions = useMemo(() => options?.staff || [], [options]);
  const serviceOptions = useMemo(() => options?.taskTypes || [], [options]);
  // Label names, not label_ids, since that's what the FilterBar select renders
  // as both the option value and its display text — safe because label names
  // are firm-unique (sql/030_labels.sql: uq_v3_labels_name).
  const labelNames = useMemo(() => allLabels.map((l) => l.name).sort(), [allLabels]);

  const isArchivedView = quickTab === "Archived";

  /**
   * History tabs only (Completed/Archived/All History) — filtered/sorted
   * entirely client-side, same as before PERF-010. Live tabs get their rows
   * from `pageTasks` directly (already filtered/sorted/paginated server-side)
   * via `visibleRows` below, so this only ever computes for the other three.
   * Completed tasks are auto-archived the moment their status is set (see
   * tasks.routes.ts archiveTask), so a live-table status==='Completed' filter
   * would always be empty — "Completed" has to read from the archive instead.
   * "All History" merges both sources, matching legacy's description.
   */
  const baseRows: Task[] = useMemo(() => {
    if (quickTab === "Archived") return archivedTasks || [];
    if (quickTab === "Completed") return (archivedTasks || []).filter((t) => String(t.status || "").toLowerCase() === "completed");
    if (quickTab === "All History") return [...(tasks || []), ...(archivedTasks || [])];
    return [];
  }, [quickTab, tasks, archivedTasks]);

  const historyFiltered = useMemo(() => {
    if (isLiveTab(quickTab)) return [];
    let rows = baseRows;
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

  const visibleRows: Task[] = isLiveTab(quickTab) ? (pageTasks || []) : historyFiltered;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Lets TaskDetailPage's Previous/Next paging step through whatever
  // filtered/sorted order is currently on screen — see utils/listNav.ts. On a
  // live tab this now only spans the current page, not the whole pipeline —
  // standard for a paginated list, and Prev/Next still works, it just stops
  // at the page boundary the way it would in any paginated UI.
  useEffect(() => {
    saveListOrder("tasks", visibleRows.map((t) => t.task_id));
  }, [visibleRows]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }
  function sortArrow(key: SortKey) { return sortKey !== key ? "" : sortDir === "asc" ? " ▲" : " ▼"; }

  function toggleSelected(taskId: string) {
    setSelected((prev) => { const next = new Set(prev); next.has(taskId) ? next.delete(taskId) : next.add(taskId); return next; });
  }
  // Selects everything currently on screen — on a live tab that's just the
  // current page, not every row matching the filter across every page. Kept
  // deliberately scoped this way: a "select all matching filter" that spans
  // pages would let one click bulk-complete/void/delete far more than what's
  // visible, which is a much easier mistake to make sight-unseen.
  function toggleSelectAll() {
    setSelected((prev) => (prev.size === visibleRows.length ? new Set() : new Set(visibleRows.map((t) => t.task_id))));
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
      const res = await api.post<{ succeeded: number; failed: string[]; evidenceMissing: { taskId: string; reason: string }[] }>(
        "/tasks/bulk", { taskIds: Array.from(selected), action, confirm: confirmValue }
      );
      const parts: string[] = [];
      if (res.failed.length) parts.push(`${res.failed.length} could not be updated (no access or not found)`);
      // TAX-005: a filing/payment task now needs its evidence fields (filed
      // date, paid date, confirmation number) filled in before it can be
      // completed — skipped here rather than silently checked off with nothing
      // to prove the work actually happened.
      if (res.evidenceMissing.length) parts.push(`${res.evidenceMissing.length} skipped — missing completion evidence (open each task and fill in the filed/paid date and confirmation number)`);
      if (parts.length) await notify(`${res.succeeded} updated. ${parts.join("; ")}.`);
      else toast(`${res.succeeded} task(s) ${action === "delete" ? "deleted" : "updated"}.`);
      setSelected(new Set());
      reloadCurrentView();
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
      reloadCurrentView();
      toast("Task restored.");
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not restore this task.");
    } finally {
      setRestoring(null);
    }
  }

  async function handleStatusChange(taskId: string, status: string) {
    setSavingStatusId(taskId);
    const previousPageTasks = pageTasks;
    const previousTasks = tasks;
    // Optimistic local patch instead of an unbounded full-table refetch on
    // every single inline status change — the API call already tells us
    // exactly what changed. reloadCurrentView() still runs after, but in the
    // background (not awaited) to reconcile any server-side derived fields
    // and the summary tile counts, rather than blocking the UI on a refetch.
    // Patches whichever array actually holds this row (pageTasks for a live
    // tab, tasks for the All History view) — the other's map is a no-op.
    setPageTasks((prev) => prev?.map((t) => (t.task_id === taskId ? { ...t, status } : t)) ?? prev);
    setTasks((prev) => prev?.map((t) => (t.task_id === taskId ? { ...t, status } : t)) ?? prev);
    try {
      await api.patch(`/tasks/${taskId}`, { status });
      toast("Status updated.");
      reloadCurrentView();
    } catch (err) {
      setPageTasks(previousPageTasks);
      setTasks(previousTasks);
      const message = err instanceof ApiError ? err.message : "Could not update status.";
      // Same evidence-required rejection TaskDetailPage.tsx's own status control
      // handles (missingCompletionEvidence, tasks.routes.ts) — but there's no
      // inline edit form in a table row to open, so send staff to the one place
      // that has it instead of just naming fields they can't reach from here.
      const needsEvidence = message.includes("before marking this task Completed");
      await notify(needsEvidence ? `${message} Opening this task to add them.` : message);
      if (needsEvidence) navigate(`/tasks/${taskId}?open=edit`);
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
        reloadCurrentView();
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
        reloadCurrentView();
      } catch (err) {
        await notify(err instanceof ApiError ? err.message : "Could not delete this task.");
      }
    }
  }

  /**
   * "Export what I'm looking at" — for a live tab that means every row
   * matching the current filters, not just the current page, so this makes
   * its own server round-trip (same filters, no page/pageSize) rather than
   * exporting just `visibleRows`.
   */
  async function handleExport() {
    if (!isLiveTab(quickTab)) {
      return exportCsv("tasks.csv", [
        { key: "client_name", label: "Client" }, { key: "service_line", label: "Service" }, { key: "task_name", label: "Task" },
        { key: "agency_due_date", label: "Due" }, { key: "status", label: "Status" }, { key: "assigned_to", label: "Owner" },
      ], historyFiltered as unknown as Record<string, unknown>[]);
    }
    try {
      const res = await api.get<{ tasks: Task[] }>(`/tasks?${liveQueryParams().toString()}`);
      exportCsv("tasks.csv", [
        { key: "client_name", label: "Client" }, { key: "service_line", label: "Service" }, { key: "task_name", label: "Task" },
        { key: "agency_due_date", label: "Due" }, { key: "status", label: "Status" }, { key: "assigned_to", label: "Owner" },
      ], res.tasks as unknown as Record<string, unknown>[]);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not export tasks.");
    }
  }

  // Firm-wide aggregate tiles (Open Tasks, Overdue, Due Today, Task Groups,
  // Staff Load, Waiting) — sourced from /tasks/summary (computed in SQL over
  // every open task, not just the current page) rather than derived from a
  // full task-row fetch, which is exactly the cost PERF-010 removes.
  const overdueAll = summary?.overdueCount ?? 0;
  const dueTodayAll = summary?.dueTodayCount ?? 0;
  const waitingAll = summary?.waitingCount ?? 0;
  const openTasksCount = summary?.openCount ?? 0;

  const tableTitle = user?.role === "admin" ? "Master Task Pipeline" : "My Task Pipeline";
  const ready = isArchivedView
    ? archivedTasks !== null
    : quickTab === "Completed" ? archivedTasks !== null
    : quickTab === "All History" ? tasks !== null && archivedTasks !== null
    : pageTasks !== null;

  function goToTab(tab: QuickTab) {
    setQuickTab(tab);
    setSelected(new Set());
    document.getElementById("master-task-pipeline")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div>
      {clientIdFilter && (
        <div className="card" style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px" }}>
          <span>Showing tasks for <strong>{visibleRows[0]?.client_name || clientIdFilter}</strong> only.</span>
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
            <div className="metric-value">{openTasksCount}</div>
            <div className="metric-note">{isLiveTab(quickTab) ? totalCount : visibleRows.length} visible</div>
          </button>
          <button type="button" className="metric metric-clickable" onClick={() => goToTab("Overdue")}>
            <div className="metric-label">Overdue</div>
            <div className="metric-value">{overdueAll}</div>
            <div className="metric-note">before today</div>
          </button>
          <button type="button" className="metric metric-clickable" onClick={() => goToTab("Due Today")}>
            <div className="metric-label">Due Today</div>
            <div className="metric-value">{dueTodayAll}</div>
            <div className="metric-note">{fmtDateOnly(new Date().toISOString())}</div>
          </button>
          <button type="button" className="metric metric-clickable" onClick={() => goToTab("All Active")}>
            <div className="metric-label">Task Groups</div>
            <div className="metric-value">{summary?.taskGroupCount ?? 0}</div>
            {/* Just the single biggest group, not a 3-way pipe-joined list — the
                full breakdown is one click away in the table itself, so this tile
                only needs to say "here's what's piling up," not restate the table. */}
            <div className="metric-note">{summary?.topTaskGroup ? `Top: ${summary.topTaskGroup.name} (${summary.topTaskGroup.count})` : "—"}</div>
          </button>
          <button type="button" className="metric metric-clickable" onClick={() => goToTab("All Active")}>
            <div className="metric-label">Staff Load</div>
            <div className="metric-value">{summary?.staffLoadCount ?? 0}</div>
            <div className="metric-note">{summary?.topStaff ? `Busiest: ${summary.topStaff.name} (${summary.topStaff.count})` : "—"}</div>
          </button>
          <button type="button" className="metric metric-clickable" onClick={() => goToTab("Waiting")}>
            <div className="metric-label">Waiting</div>
            <div className="metric-value">{waitingAll}</div>
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
            <span className="muted" style={{ fontSize: 12 }}>
              {isLiveTab(quickTab)
                ? `${visibleRows.length ? (page - 1) * PAGE_SIZE + 1 : 0}–${(page - 1) * PAGE_SIZE + visibleRows.length} of ${totalCount}`
                : `${visibleRows.length} tasks`}
            </span>
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
                  <th scope="col" style={{ width: 32 }}><input type="checkbox" checked={selected.size > 0 && selected.size === visibleRows.length} onChange={toggleSelectAll} /></th>
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
              {visibleRows.map((t) => (
                <tr
                  key={t.task_id}
                  data-row-id={t.task_id}
                  tabIndex={0}
                  // Selects the task (shows it in the sidebar panel, right here on the
                  // list) instead of navigating away — the task's own name below is the
                  // real link to its full detail page. Was a straight navigate() until
                  // 2026-08-23, per direct owner request to preview without leaving the list.
                  onClick={() => { setSelectedClient(t.client_id, t.client_name); setSelectedTask(t.task_id, t.task_name); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedClient(t.client_id, t.client_name); setSelectedTask(t.task_id, t.task_name); } }}
                >
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
                      <div>
                        <button
                          type="button"
                          className="link-button"
                          onClick={(e) => { e.stopPropagation(); setSelectedClient(t.client_id, t.client_name); setSelectedTask(t.task_id, t.task_name); navigate(`/tasks/${t.task_id}`); }}
                        >
                          {t.task_name}
                        </button>
                      </div>
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
                        {statusOptionsForTaskType(options?.taskStatusesWithType, t.service_line).map((s) => <option key={s} value={s}>{s}</option>)}
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
          {visibleRows.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No tasks match.</p>}
          {isLiveTab(quickTab) && totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
              <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
              <span className="muted" style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
              <button type="button" className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
            </div>
          )}
        </div>
      )}

      {showBatchModal && (
        rules.length > 0 ? (
          <CreateBatchTasksModal rules={rules} onClose={() => setShowBatchModal(false)} onDone={() => reloadCurrentView()} />
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
          onDone={() => reloadCurrentView()}
        />
      )}

      {requestDocTask && (
        <RequestDocumentModal
          clientId={requestDocTask.client_id}
          clientName={requestDocTask.client_name}
          taskId={requestDocTask.task_id}
          onClose={() => setRequestDocTask(null)}
          onDone={() => reloadCurrentView()}
        />
      )}
    </div>
  );
}
