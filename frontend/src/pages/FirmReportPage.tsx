import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, downloadFile, buildFilename } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";

/**
 * Firm-wide health metrics for AL TAX SERVICE itself — not a client report.
 * Used to live inside Reports' "Financial Overview" tab behind an "All
 * Clients (Firm-Wide)" dropdown option, which staff kept missing because
 * that whole page reads as "pick a client, see their numbers." Pulled out
 * into its own nav item/page so it's discoverable on its own rather than
 * hidden inside a client-scoped page. Backed by the same GET /reports/
 * firm-insights and GET /reports/csv/firm-insights routes as before — no
 * backend change, this is purely a frontend relocation.
 */
interface FirmInsights {
  revenueByServiceType: { serviceType: string; revenue: number; pctOfTotal: number }[];
  clientConcentration: { clientId: string; clientName: string; revenue: number; pctOfTotal: number }[];
  concentrationRisk: { top5Pct: number; top10Pct: number };
  mdOnTimeFilingRate: { onTime: number; late: number; missing: number; filedPendingPayment: number; notYetDue: number; total: number; pct: number | null };
  filingCompliance: {
    onTime: number; late: number; missing: number; notYetDue: number; total: number; pct: number | null;
    byServiceLine: { serviceLine: string; onTime: number; late: number; missing: number; pct: number | null }[];
  };
  estimateWinRate: { won: number; lost: number; stillOpen: number; totalCreated: number; winRatePct: number | null };
  clientGrowth: { monthly: { month: string; newClients: number; likelyBulkImport: boolean }[]; activeClientCountNow: number; note: string };
  staffUtilization: { email: string; name: string; totalHours: number; billableHours: number; billablePct: number; approvedHours: number }[];
}

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00";
}

export function FirmReportPage() {
  const navigate = useNavigate();
  const [from, setFrom] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [insights, setInsights] = useState<FirmInsights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    setInsights(null);
    setError(null);
    api.get<FirmInsights>(`/reports/firm-insights?from=${from}&to=${to}`)
      .then(setInsights)
      .catch(() => setError("Could not load the Firm Report."));
  }, [from, to]);

  async function handleExport(format: "csv" | "xlsx") {
    setExporting(format);
    try {
      await downloadFile(`/reports/csv/firm-insights?from=${from}&to=${to}&format=${format}`, buildFilename(["Firm Report", `${from} to ${to}`], format));
    } catch {
      setError("Could not export this data.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div>
      <p className="muted" style={{ marginBottom: 16, maxWidth: 720 }}>
        AL TAX SERVICE's own business health — not a client's numbers. Revenue mix, client concentration risk, filing
        compliance across every agency, estimate win rate, client growth, and staff utilization for the period below.
      </p>

      <div className="command-panel" style={{ marginBottom: 16 }}>
        <div className="command-panel-header" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="fr-from">From</label>
              <input id="fr-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="fr-to">To</label>
              <input id="fr-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" disabled={exporting !== null} onClick={() => handleExport("csv")}>
              {exporting === "csv" ? "Exporting…" : "Export CSV"}
            </button>
            <button type="button" className="btn" disabled={exporting !== null} onClick={() => handleExport("xlsx")}>
              {exporting === "xlsx" ? "Exporting…" : "Export Excel"}
            </button>
          </div>
        </div>
      </div>

      {error && <ErrorBanner error={error} />}
      {!insights && !error && <div className="spinner-wrap">Loading Firm Report…</div>}

      {insights && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="command-panel">
            <div className="command-panel-header">
              <h2 className="command-panel-title">Revenue by Service Type</h2>
              <div className="command-panel-note">Grouped by each client's own Service Type — a client's revenue isn't split across sub-services</div>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th scope="col">Service Type</th><th scope="col">Revenue</th><th scope="col">% of Total</th></tr></thead>
                <tbody>
                  {insights.revenueByServiceType.map((r) => (
                    <tr key={r.serviceType}><td>{r.serviceType}</td><td>{fmtMoney(r.revenue)}</td><td>{r.pctOfTotal}%</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="command-panel">
            <div className="command-panel-header">
              <h2 className="command-panel-title">Client Concentration</h2>
              <div className="command-panel-note">
                Top 5: {insights.concentrationRisk.top5Pct}% of revenue &middot; Top 10: {insights.concentrationRisk.top10Pct}%
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th scope="col">Client</th><th scope="col">Revenue</th><th scope="col">% of Total</th></tr></thead>
                <tbody>
                  {insights.clientConcentration.map((c) => (
                    <tr key={c.clientId} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => navigate(`/clients/${c.clientId}`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/clients/${c.clientId}`); } }}>
                      <td>{c.clientName}</td><td>{fmtMoney(c.revenue)}</td><td>{c.pctOfTotal}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="command-panel">
            <div className="command-panel-header">
              <h2 className="command-panel-title">MD On-Time Filing Rate</h2>
              <div className="command-panel-note">Every MD sales tax period due in this window, across every MD client</div>
            </div>
            <div className="metric-grid" style={{ padding: 16, gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">On-Time Rate</div><div className="metric-value">{insights.mdOnTimeFilingRate.pct !== null ? `${insights.mdOnTimeFilingRate.pct}%` : "—"}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">On Time</div><div className="metric-value">{insights.mdOnTimeFilingRate.onTime}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Late</div><div className="metric-value" style={{ color: insights.mdOnTimeFilingRate.late > 0 ? "var(--red)" : undefined }}>{insights.mdOnTimeFilingRate.late}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Missing</div><div className="metric-value" style={{ color: insights.mdOnTimeFilingRate.missing > 0 ? "var(--red)" : undefined }}>{insights.mdOnTimeFilingRate.missing}</div></div>
            </div>
            <p className="muted" style={{ fontSize: 11, padding: "0 16px 12px" }}>
              {insights.mdOnTimeFilingRate.filedPendingPayment} filed with payment still pending, {insights.mdOnTimeFilingRate.notYetDue} not yet due — neither counts toward the rate above.
            </p>
          </div>

          <div className="command-panel">
            <div className="command-panel-header">
              <h2 className="command-panel-title">Firm-Wide Filing Compliance</h2>
              <div className="command-panel-note">Every task with an agency due date in this window — federal, other states, payroll, not just MD sales tax</div>
            </div>
            <div className="metric-grid" style={{ padding: 16, gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">On-Time Rate</div><div className="metric-value">{insights.filingCompliance.pct !== null ? `${insights.filingCompliance.pct}%` : "—"}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">On Time</div><div className="metric-value">{insights.filingCompliance.onTime}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Late</div><div className="metric-value" style={{ color: insights.filingCompliance.late > 0 ? "var(--red)" : undefined }}>{insights.filingCompliance.late}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Missing</div><div className="metric-value" style={{ color: insights.filingCompliance.missing > 0 ? "var(--red)" : undefined }}>{insights.filingCompliance.missing}</div></div>
            </div>
            {insights.filingCompliance.byServiceLine.length > 0 && (
              <div className="table-scroll">
                <table>
                  <thead><tr><th scope="col">Service Line</th><th scope="col">On-Time Rate</th><th scope="col">On Time</th><th scope="col">Late</th><th scope="col">Missing</th></tr></thead>
                  <tbody>
                    {insights.filingCompliance.byServiceLine.map((s) => (
                      <tr key={s.serviceLine}>
                        <td>{s.serviceLine}</td>
                        <td>{s.pct !== null ? `${s.pct}%` : "—"}</td>
                        <td>{s.onTime}</td>
                        <td style={{ color: s.late > 0 ? "var(--red)" : undefined }}>{s.late}</td>
                        <td style={{ color: s.missing > 0 ? "var(--red)" : undefined }}>{s.missing}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted" style={{ fontSize: 11, padding: "0 16px 12px" }}>
              {insights.filingCompliance.notYetDue} not yet due — doesn't count toward the rate above.
            </p>
          </div>

          <div className="command-panel">
            <div className="command-panel-header">
              <h2 className="command-panel-title">Estimate Win Rate</h2>
              <div className="command-panel-note">Of estimates that reached a decision (Approved or Declined) in this window</div>
            </div>
            <div className="metric-grid" style={{ padding: 16, gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Win Rate</div><div className="metric-value">{insights.estimateWinRate.winRatePct !== null ? `${insights.estimateWinRate.winRatePct}%` : "—"}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Won</div><div className="metric-value">{insights.estimateWinRate.won}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Lost</div><div className="metric-value">{insights.estimateWinRate.lost}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Still Open</div><div className="metric-value">{insights.estimateWinRate.stillOpen}</div></div>
            </div>
          </div>

          <div className="command-panel">
            <div className="command-panel-header">
              <h2 className="command-panel-title">Client Growth</h2>
              <div className="command-panel-note">{insights.clientGrowth.activeClientCountNow} active clients today</div>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th scope="col">Month</th><th scope="col">New Clients</th></tr></thead>
                <tbody>
                  {insights.clientGrowth.monthly.map((m) => (
                    <tr key={m.month}>
                      <td>{m.month}</td>
                      <td>
                        {m.newClients}
                        {m.likelyBulkImport && (
                          <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>likely bulk import, not real growth</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 11, padding: "0 16px 12px" }}>{insights.clientGrowth.note}</p>
          </div>

          <div className="command-panel">
            <div className="command-panel-header">
              <h2 className="command-panel-title">Staff Utilization</h2>
              <div className="command-panel-note">Hours logged in Time Tracking for this window</div>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th scope="col">Staff</th><th scope="col">Total Hours</th><th scope="col">Billable Hours</th><th scope="col">Billable %</th></tr></thead>
                <tbody>
                  {insights.staffUtilization.length === 0 && (
                    <tr><td colSpan={4} className="muted">No time entries logged in this window.</td></tr>
                  )}
                  {insights.staffUtilization.map((s) => (
                    <tr key={s.email}>
                      <td>{s.name}</td><td>{s.totalHours}</td><td>{s.billableHours}</td><td>{s.billablePct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
