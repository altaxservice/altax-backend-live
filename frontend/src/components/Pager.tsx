import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

/** Bottom-of-list pager: first, back, page numbers, forward, last. Renders nothing when everything fits on one page. */
export function Pager({ page, totalPages, onPage, total, pageSize }: { page: number; totalPages: number; onPage: (p: number) => void; total?: number; pageSize?: number }) {
  if (totalPages <= 1) return null;
  const numbers = Array.from({ length: totalPages }, (_, i) => i + 1).filter((n) => n === 1 || n === totalPages || Math.abs(n - page) <= 2);
  const from = total !== undefined && pageSize ? (page - 1) * pageSize + 1 : null;
  const to = total !== undefined && pageSize ? Math.min(total, page * pageSize) : null;
  return (
    <div className="pager" role="navigation" aria-label="Pages">
      <button type="button" aria-label="First page" disabled={page <= 1} onClick={() => onPage(1)}><ChevronsLeft size={15} aria-hidden="true" /></button>
      <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={15} aria-hidden="true" /></button>
      {numbers.map((n, i) => (
        <span key={n} style={{ display: "inline-flex", gap: 4 }}>
          {i > 0 && n - numbers[i - 1] > 1 ? <span className="muted" style={{ alignSelf: "center" }}>…</span> : null}
          <button type="button" className={n === page ? "pager-current" : ""} aria-current={n === page ? "page" : undefined} onClick={() => onPage(n)}>{n}</button>
        </span>
      ))}
      <button type="button" aria-label="Next page" disabled={page >= totalPages} onClick={() => onPage(page + 1)}><ChevronRight size={15} aria-hidden="true" /></button>
      <button type="button" aria-label="Last page" disabled={page >= totalPages} onClick={() => onPage(totalPages)}><ChevronsRight size={15} aria-hidden="true" /></button>
      <span className="pager-info">{from !== null && to !== null ? `${from}–${to} of ${total}` : `Page ${page} of ${totalPages}`}</span>
    </div>
  );
}
