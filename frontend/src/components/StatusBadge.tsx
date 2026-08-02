import { CheckCircle2, XCircle, Clock, Loader2, Eye, Circle } from "lucide-react";

/** Mirrors the legacy .status-pill color system (status-open/completed/overdue/etc). Exported so other status controls (e.g. the inline task-status <select>) can carry the same color, not just the read-only pill. */
export function colorClassFor(status: string): string {
  const s = status.toLowerCase().trim();
  if (["open", "not started", "partial"].includes(s)) return "status-amber";
  if (["completed", "closed", "paid", "active", "approved"].includes(s)) return "status-green";
  if (["overdue", "unpaid", "void", "reversed", "declined", "lost"].includes(s)) return "status-red";
  if (["in progress", "progress", "pending", "received", "file uploaded", "created", "queued", "printed", "inspection phase", "contacted"].includes(s)) return "status-blue";
  if (["waiting on client", "waiting docs", "requested", "additional information required", "fee due"].includes(s)) return "status-amber";
  if (["ready for review", "under review", "in review"].includes(s)) return "status-teal";
  if (["urgent"].includes(s)) return "status-red";
  if (["high"].includes(s)) return "status-amber";
  if (["low"].includes(s)) return "status-gray";
  if (["unknown", "inactive", "archived", "deleted"].includes(s)) return "status-gray";
  return "status-gray";
}

/** One icon per color class (not per literal status string) — the same six-way
 * semantic bucket colorClassFor already sorts every status into, so a new
 * status string picks up an icon automatically instead of needing its own
 * entry here. Small and quiet by design: this reinforces the color, it
 * doesn't replace reading the label. */
const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  "status-green": CheckCircle2,
  "status-red": XCircle,
  "status-amber": Clock,
  "status-blue": Loader2,
  "status-teal": Eye,
  "status-gray": Circle,
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const label = status || "—";
  const cls = colorClassFor(label);
  const Icon = STATUS_ICON[cls] || Circle;
  return (
    <span className={`status-pill ${cls}`}>
      <Icon size={11} strokeWidth={2.5} aria-hidden="true" style={{ flexShrink: 0 }} />
      {label}
    </span>
  );
}
