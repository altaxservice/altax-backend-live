import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { KIND_LABEL, cellLink, monthLabel, trackerTotals, type TrackerCell, type TrackerData, type TrackerKind } from "../pages/FilingTrackerPage";

const KINDS: TrackerKind[] = ["sales", "withholding", "eftps", "form941", "ui"];
const SHORT: Record<string, string> = { not_filed: "not filed", unpaid: "payment missing", not_sent: "not sent" };

function Bar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 100;
  return (
    <div style={{ height: 6, borderRadius: 999, background: "#e6eaf0", overflow: "hidden" }} aria-hidden="true">
      <div style={{ width: `${pct}%`, height: "100%", background: done === total ? "var(--green)" : "var(--teal)" }} />
    </div>
  );
}

/**
 * Command Center strip: where the current close's recurring filings stand (sales tax, withholding, EFTPS, 941, unemployment), and which
 * clients still have something open. Reads GET /filing-tracker; the full board with filters, links and the bulk send lives at /filing-tracker.
 */
export function FilingTrackerStrip() {
  const [data, setData] = useState<TrackerData | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.get<TrackerData>("/filing-tracker").then((d) => { if (!cancelled) setData(d); }).catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, []);
  if (!data || data.rows.length === 0) return null;

  const t = trackerTotals(data);
  const open = (c: TrackerCell) => c.status === "not_filed" || c.status === "unpaid" || c.status === "not_sent";
  const attention = data.rows.filter((r) => r.cells.some(open));
  const overdueClients = attention.filter((r) => r.cells.some((c) => c.overdue)).length;

  return (
    <div className="command-panel" style={{ marginBottom: 16 }}>
      <div className="command-panel-header" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 className="command-panel-title">Filing Tracker · {monthLabel(data.month)} filings</h2>
          <div className="command-panel-note">
            {t.left === 0 ? "Every filing for this close is done." : `${t.done} of ${t.total} done · ${attention.length} client${attention.length === 1 ? "" : "s"} still have something open${overdueClients ? ` (${overdueClients} overdue)` : ""}`}
          </div>
        </div>
        <Link to="/filing-tracker" className="action-button">Open Filing Tracker</Link>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 14, padding: "0 16px 14px" }}>
        {KINDS.map((k) => {
          const s = data.summary[k];
          return (
            <Link key={k} to="/filing-tracker" style={{ textDecoration: "none", color: "inherit", display: "grid", gap: 5 }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>{KIND_LABEL[k]}</div>
              <div style={{ fontWeight: 800, fontSize: 18, fontVariantNumeric: "tabular-nums" }}>{s.done}<span className="muted" style={{ fontSize: 13 }}> / {s.total}</span></div>
              <Bar done={s.done} total={s.total} />
              <div className="muted" style={{ fontSize: 11.5 }}>{s.total === 0 ? (s.noData ? `${s.noData} need payroll data` : "Nothing due") : s.total - s.done === 0 ? "All done" : `${s.total - s.done} left`}</div>
            </Link>
          );
        })}
      </div>
      {attention.length > 0 && (
        <div style={{ borderTop: "1px solid var(--line)" }}>
          {attention.slice(0, 6).map((r) => (
            <div key={r.clientId} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "9px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
              <Link to={`/clients/${r.clientId}`} style={{ fontWeight: 700 }}>{r.clientName}</Link>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {r.cells.filter(open).map((c) => (
                  <Link key={`${c.kind}|${c.periodEnd}|${c.state}`} to={cellLink(r.clientId, c)} className={`status-pill ${c.status === "not_filed" ? "status-red" : c.status === "unpaid" ? "status-amber" : "status-purple"}`} style={{ textDecoration: "none" }}>
                    {KIND_LABEL[c.kind]} · {SHORT[c.status]}
                  </Link>
                ))}
              </div>
            </div>
          ))}
          {attention.length > 6 && <div style={{ padding: "9px 16px" }}><Link to="/filing-tracker" className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>+ {attention.length - 6} more clients — see the full list</Link></div>}
        </div>
      )}
    </div>
  );
}
