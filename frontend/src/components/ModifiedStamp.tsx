/**
 * "Date Modified" cell content shared by the list pages: the calendar date on one line, "by <person>" under it when
 * the record tracks who changed it, and the exact date and time in the tooltip. Local timezone — it is a real
 * moment (updated_at), not a calendar-only date.
 */
export function ModifiedStamp({ at, by }: { at: unknown; by?: string | null }) {
  if (!at) return <span className="muted">—</span>;
  const d = new Date(at as string);
  if (Number.isNaN(d.getTime())) return <span className="muted">—</span>;
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const full = d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return (
    <div title={`${full}${by ? ` · by ${by}` : ""}`}>
      <div>{date}</div>
      {by ? <div className="cell-sub">by {by}</div> : null}
    </div>
  );
}
