import type { ReactNode } from "react";
import { RefreshCw, Download, CalendarRange } from "lucide-react";

interface SelectFilter {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  allLabel?: string;
}

export interface PeriodFilter {
  start: string;
  end: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onActiveView: () => void;
}

/** First/last day of the current month, as yyyy-mm-dd — legacy's "Active View" default range (resetPeriodToActiveDefaults). */
export function activeViewDates(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

export interface SearchFilter {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** Mirrors legacy's renderFilters(): a row of Service/Status/Staff-style selects, an optional From/To period range, plus Refresh/Export/action buttons, sitting under the page title. Each page configures which pieces it needs — legacy only shows the period range on Tasks/Billing/Documents/Communications/Accounting/Reports (periodFilteredViews()), not every page. `search` folds a page's own search box into this same row instead of it sitting in a separate row above — one less band of toolbar before the list starts. */
export function FilterBar({ search, selects = [], period, onRefresh, refreshing, onExportCsv, children }: { search?: SearchFilter; selects?: SelectFilter[]; period?: PeriodFilter; onRefresh?: () => void; refreshing?: boolean; onExportCsv?: () => void; children?: ReactNode }) {
  return (
    <div className="filter-band">
      {search && (
        <label className="filter-control" style={{ minWidth: 200 }}>
          Search
          <input type="text" value={search.value} placeholder={search.placeholder} onChange={(e) => search.onChange(e.target.value)} />
        </label>
      )}
      {selects.map((f) => (
        <label className="filter-control" key={f.label}>
          {f.label}
          <select value={f.value} onChange={(e) => f.onChange(e.target.value)}>
            <option value="all">{f.allLabel || "All"}</option>
            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      ))}
      {period && (
        <>
          <label className="filter-control">From
            <input type="date" value={period.start} onChange={(e) => period.onStartChange(e.target.value)} />
          </label>
          <label className="filter-control">To
            <input type="date" value={period.end} onChange={(e) => period.onEndChange(e.target.value)} />
          </label>
          <button className="ghost-button" type="button" onClick={period.onActiveView}><CalendarRange size={13} strokeWidth={2} aria-hidden="true" />Active View</button>
        </>
      )}
      {onRefresh && (
        <button className="ghost-button" type="button" disabled={refreshing} onClick={onRefresh}>
          <RefreshCw size={13} strokeWidth={2} aria-hidden="true" className={refreshing ? "icon-spin" : undefined} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      )}
      {onExportCsv && <button className="ghost-button" type="button" onClick={onExportCsv}><Download size={13} strokeWidth={2} aria-hidden="true" />Export CSV</button>}
      {children}
    </div>
  );
}

/** Mirrors legacy's exportCurrentCsv(): downloads the given rows as a CSV file, quoting/escaping values that contain commas, quotes, or newlines. */
export function exportCsv(filename: string, columns: { key: string; label: string }[], rows: Record<string, unknown>[]) {
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    columns.map((c) => escape(c.label)).join(","),
    ...rows.map((row) => columns.map((c) => escape(row[c.key])).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
