import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Task } from "../api/types";
import { StatusBadge } from "./StatusBadge";
import { DueLabel } from "./TaskCells";
import { useSelectedTask } from "../context/SelectedTaskContext";
import { useSelectedClient } from "../context/SelectedClientContext";
import { fmtDateOnly, fmtDateTime } from "../utils/date";

const PANEL_WIDTH_MIN = 260;
const PANEL_WIDTH_MAX = 520;
const PANEL_WIDTH_KEY = "altax_task_panel_width";

function clampPanelWidth(n: number): number {
  return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, n));
}

/**
 * Task counterpart to ClientContextPanel — same "hide, don't clear" panel
 * shape, same client-panel-* CSS classes (generic layout/style, not actually
 * client-specific despite the name), reusing them here on purpose so this
 * gets identical visuals for free. Deliberately leaner than the client
 * panel: no activity feed (a task's own thread is one click away on its
 * Activity Timeline tab, unlike a client's cross-cutting activity log which
 * has no other single place to see it), no status-change control (Task
 * Detail's own header already has one — a second one here would just be a
 * second way to do the same thing). The real value-add is being visible
 * across all three of Task Detail's sub-tabs (Details/Attachments/Activity
 * Timeline), not just the one that happens to show these fields today.
 */
export function TaskContextPanel() {
  const { taskId, taskName, setSelectedTask, panelHidden, setPanelHidden } = useSelectedTask();
  const { setSelectedClient } = useSelectedClient();
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return Number.isFinite(saved) && saved > 0 ? clampPanelWidth(saved) : PANEL_WIDTH_MIN;
  });
  const [resizing, setResizing] = useState(false);

  function startResize(e: ReactMouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;
    setResizing(true);
    function onMove(ev: MouseEvent) {
      setPanelWidth(clampPanelWidth(startWidth + (startX - ev.clientX)));
    }
    function onUp() {
      setResizing(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setPanelWidth((w) => { localStorage.setItem(PANEL_WIDTH_KEY, String(w)); return w; });
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  useEffect(() => {
    if (!taskId) { setTask(null); return; }
    let cancelled = false;
    api.get<{ task: Task }>(`/tasks/${taskId}`)
      .then((res) => { if (!cancelled) setTask(res.task); })
      .catch(() => { if (!cancelled) setTask(null); });
    return () => { cancelled = true; };
  }, [taskId]);

  if (panelHidden) {
    return (
      <button
        type="button"
        className="client-panel-reopen"
        onClick={() => setPanelHidden(false)}
        title={`Show task panel — ${taskName || taskId}`}
      >
        <span aria-hidden="true">‹</span>
        <span className="client-panel-reopen-label">{taskName || taskId}</span>
      </button>
    );
  }

  return (
    <aside className="client-panel" style={{ width: panelWidth }}>
      <div
        className={`client-panel-resize-handle ${resizing ? "dragging" : ""}`}
        onMouseDown={startResize}
        title="Drag to resize"
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4, gap: 6 }}>
        <div className="small-label" style={{ color: "var(--muted)" }}>{taskId}</div>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" className="btn btn-sm" onClick={() => setPanelHidden(true)} title="Hide this panel (keeps the task selected)">✕</button>
          <button type="button" className="btn btn-sm" onClick={() => setSelectedTask(null)} title="Clear the selected task">Clear</button>
        </div>
      </div>

      {!task && <div className="spinner-wrap" style={{ padding: 24 }}>Loading…</div>}

      {task && (
        <>
          <h2 style={{ fontSize: 17, margin: "0 0 6px" }}>
            <button type="button" onClick={() => navigate(`/tasks/${task.task_id}`)} className="client-panel-name-link">{task.task_name}</button>
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <StatusBadge status={task.status} />
            <DueLabel task={task} />
          </div>

          <div className="client-panel-section">
            <div className="small-label">Client</div>
            <TaskRow
              label="Client"
              value={task.client_name}
              onClick={() => { setSelectedClient(task.client_id, task.client_name); navigate(`/clients/${task.client_id}`); }}
            />
          </div>

          <div className="client-panel-section">
            <div className="small-label">Task</div>
            <TaskRow label="Service Line" value={task.service_line} />
            <TaskRow label="Priority" value={task.priority} />
            <TaskRow label="Period" value={task.period} />
            <TaskRow label="Frequency" value={task.frequency} />
            <TaskRow label="Assigned To" value={task.assigned_to} />
            <TaskRow label="Agency Due Date" value={task.agency_due_date ? fmtDateOnly(task.agency_due_date) : null} />
            <TaskRow label="Staff Due Date" value={task.staff_due_date ? fmtDateOnly(task.staff_due_date) : null} />
          </div>

          {task.payment_required && (
            <div className="client-panel-section">
              <div className="small-label">Payment</div>
              <TaskRow label="Amount" value={task.payment_amount != null ? `$${Number(task.payment_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null} />
              <TaskRow label="Filed Date" value={task.filed_date ? fmtDateOnly(task.filed_date) : null} />
              <TaskRow label="Paid Date" value={task.paid_date ? fmtDateOnly(task.paid_date) : null} />
              <TaskRow label="Confirmation #" value={task.confirmation_number} />
            </div>
          )}

          {(task.portal_name || task.portal_url) && (
            <div className="client-panel-section">
              <div className="small-label">Portal</div>
              <TaskRow label="Portal" value={task.portal_name} href={task.portal_url || undefined} />
            </div>
          )}

          {task.notes && (
            <div className="client-panel-section">
              <div className="small-label">Notes</div>
              <div className="muted" style={{ fontSize: 12.5, padding: "4px 0", whiteSpace: "pre-line" }}>{task.notes}</div>
            </div>
          )}

          <div className="client-panel-section">
            <div className="muted" style={{ fontSize: 11 }}>
              {task.updated_at ? `Last updated ${fmtDateTime(task.updated_at)}` : ""}
              {task.updated_by ? ` by ${task.updated_by}` : ""}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

function TaskRow({ label, value, onClick, href }: { label: string; value: string | null | undefined; onClick?: () => void; href?: string }) {
  const display = value || "—";
  const clickable = Boolean((onClick || href) && value);
  const rowInner = (
    <>
      <span>{label}</span>
      <span>{display}</span>
    </>
  );
  if (clickable && href) {
    return <a href={href} target="_blank" rel="noreferrer" className="client-panel-row-link">{rowInner}</a>;
  }
  if (clickable && onClick) {
    return <button type="button" onClick={onClick} className="client-panel-row-link">{rowInner}</button>;
  }
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12.5 }}>
      <span className="muted">{label}</span>
      <span>{display}</span>
    </div>
  );
}
