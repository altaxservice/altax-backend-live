/** Mirrors the legacy .status-pill color system (status-open/completed/overdue/etc). Exported so other status controls (e.g. the inline task-status <select>) can carry the same color, not just the read-only pill. */
export function colorClassFor(status: string): string {
  const s = status.toLowerCase().trim();
  if (["open", "not started", "partial"].includes(s)) return "status-amber";
  if (["completed", "closed", "paid", "active", "approved"].includes(s)) return "status-green";
  if (["overdue", "unpaid", "void", "reversed"].includes(s)) return "status-red";
  if (["in progress", "progress", "pending", "received", "file uploaded", "created", "queued", "printed", "inspection phase"].includes(s)) return "status-blue";
  if (["waiting on client", "waiting docs", "requested", "additional information required", "fee due"].includes(s)) return "status-amber";
  if (["ready for review", "under review", "in review"].includes(s)) return "status-teal";
  if (["unknown", "inactive", "archived", "deleted"].includes(s)) return "status-gray";
  return "status-gray";
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const label = status || "—";
  return <span className={`status-pill ${colorClassFor(label)}`}>{label}</span>;
}
