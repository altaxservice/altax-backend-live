import { MessageSquare, StickyNote } from "lucide-react";
import type { Task } from "../api/types";
import { openAnyFile, downloadAnyFile } from "../api/client";
import { daysUntil } from "../utils/date";
import { StatusBadge } from "./StatusBadge";
import type { ActionMenuOption } from "./ActionMenu";

/**
 * Full status list. The original 12 values were ported 1:1 from legacy's
 * TASK_STATUSES; the 5 after "Submitted" (In Review through Approved) were
 * added for permit/license application tracking (Health Permit, Use &
 * Occupancy, etc.) — that workflow moves through a government review/
 * inspection/fee pipeline the original tax/payroll statuses don't cover.
 * Mirrored in src/modules/system/system.routes.ts's taskStatuses — keep both
 * in sync (see that file's comment).
 */
export const TASK_STATUSES = [
  "Not Started", "In Progress", "In Process", "Waiting Docs", "Waiting on Client", "Pending", "Preparation",
  "Submitted", "In Review", "Inspection Phase", "Additional Information Required", "Fee Due", "Approved",
  "Completed", "Closed", "Archived", "Void",
];

export function isOpenTask(t: Task): boolean {
  return !["completed", "void", "closed", "archived"].includes(String(t.status || "").toLowerCase());
}
export function isOverdue(t: Task): boolean {
  const d = dueDays(t);
  return d !== null && d < 0;
}
export function isDueToday(t: Task): boolean {
  return dueDays(t) === 0;
}
export function isDueWeek(t: Task): boolean {
  const d = dueDays(t);
  return d !== null && d >= 0 && d <= 7;
}
export function isDueSoon(t: Task): boolean {
  const d = dueDays(t);
  return d !== null && d >= 0 && d <= 7;
}
export function isWaiting(t: Task): boolean {
  return ["waiting docs", "waiting on client", "pending"].includes(String(t.status || "").toLowerCase());
}
/** Days until due — see utils/date.ts's daysUntil() for why this can't be a raw timestamp diff. */
export function dueDays(t: Task): number | null {
  return daysUntil(t.agency_due_date);
}

/** Mirrors legacy's dueLabel(): a distinct pill for overdue/due-today/due-soon, plain text past 7 days. */
export function DueLabel({ task }: { task: Task }) {
  const d = dueDays(task);
  if (d === null) return <StatusBadge status="No Due Date" />;
  if (d < 0) return <StatusBadge status="Overdue" />;
  if (d === 0) return <StatusBadge status="Due Today" />;
  if (d <= 7) return <StatusBadge status="Due Soon" />;
  return <span className="muted">{d} days</span>;
}

/**
 * Mirrors legacy's taskFileCell(): "Open Attachment" link + file name, or "No file".
 * Uses openAnyFile/downloadAnyFile (authed blob fetch for internal URLs) rather than a
 * plain <a href> — a raw link can't carry the JWT, so clicking it silently failed to
 * authenticate instead of opening the file.
 */
export function TaskFileCell({ task }: { task: Task }) {
  const url = task.first_file_url;
  const name = task.first_file_name;
  if (!url) return <span className="muted">No file</span>;
  return (
    <div className="task-file-cell" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="ghost-button btn-sm" onClick={() => openAnyFile(url)}>Open</button>
      <button type="button" className="ghost-button btn-sm" onClick={() => downloadAnyFile(url, name || "attachment")}>Download</button>
      <div className="task-file-name muted" style={{ fontSize: 11 }}>{name || "Attachment"}</div>
    </div>
  );
}

export function taskActionOptions(role: string | undefined): ActionMenuOption[] {
  if (role === "client") return [{ value: "task-file", label: "Files" }, { value: "request-doc", label: "New Request" }];
  const options: ActionMenuOption[] = [
    { value: "task-history", label: "Review Notes / Messages" },
    { value: "edit-task", label: "Edit Task" },
    { value: "task-file", label: "Files" },
    { value: "void-task", label: "Void Task" },
    { value: "request-doc", label: "Document Request" },
  ];
  if (role === "admin") options.push({ value: "delete-task", label: "Delete Task Row" });
  return options;
}

/** The two task actions frequent enough to deserve an always-visible button instead
 * of being buried in the overflow menu — everything else in taskActionOptions() is
 * comparatively rare (edit, void, delete) or already reachable by clicking the row
 * itself ("Review Task" was pure duplication of the row's own onClick and has been
 * dropped rather than pinned). Not shown for the client role, which has its own
 * 2-item action set with no message/note concept. */
export const TASK_QUICK_ACTIONS: ActionMenuOption[] = [
  { value: "task-message", label: "Message" },
  { value: "task-note", label: "Note" },
];

/** One icon per quick-action value — these are the two buttons pinned onto every
 * task row app-wide (see TASK_QUICK_ACTIONS above), so this is the highest-traffic
 * place in the product an icon can go. Keyed by value rather than assumed
 * array order, so it stays correct if TASK_QUICK_ACTIONS is reordered later. */
export const TASK_QUICK_ACTION_ICON: Record<string, typeof MessageSquare> = {
  "task-message": MessageSquare,
  "task-note": StickyNote,
};

export function archivedTaskActionOptions(): ActionMenuOption[] {
  return [
    { value: "review-task", label: "Review Task" },
    { value: "task-history", label: "Review Notes / Messages" },
    { value: "task-file", label: "Files" },
    { value: "restore-task", label: "Restore to Active" },
  ];
}
