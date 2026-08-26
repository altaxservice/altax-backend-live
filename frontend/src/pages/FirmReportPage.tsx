import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, downloadFile, viewFile, printFile, buildFilename } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { useConfirm, useNotify } from "../components/ConfirmProvider";
import type { Client } from "../api/types";
import { ArAgingReport } from "../components/ArAgingReport";

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

interface FirmHealthScore {
  score: number;
  band: "Green" | "Yellow" | "Red";
  components: { label: string; points: number; maxPoints: number; detail: string }[];
}

interface StaffCapacityRow {
  email: string; name: string; capacityHours: number; loggedHours: number; availableHours: number;
  status: "Under Capacity" | "Healthy" | "Near Capacity" | "Over Capacity";
}
const CAPACITY_STATUS_COLOR: Record<string, string> = {
  "Under Capacity": "var(--muted)", "Healthy": "var(--teal)", "Near Capacity": "#b8860b", "Over Capacity": "var(--red)",
};

const BAND_COLOR: Record<string, string> = { Green: "var(--teal)", Yellow: "#b8860b", Red: "var(--red)" };

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00";
}

export function FirmReportPage() {
  const navigate = useNavigate();
  const [from, setFrom] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [insights, setInsights] = useState<FirmInsights | null>(null);
  const [healthScore, setHealthScore] = useState<FirmHealthScore | null>(null);
  const [capacity, setCapacity] = useState<{ capacityHoursPerWeek: number; staff: StaffCapacityRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    setInsights(null);
    setError(null);
    api.get<FirmInsights>(`/reports/firm-insights?from=${from}&to=${to}`)
      .then(setInsights)
      .catch(() => setError("Could not load the Firm Report."));
    setHealthScore(null);
    api.get<FirmHealthScore>(`/reports/firm-health-score?from=${from}&to=${to}`)
      .then(setHealthScore)
      .catch(() => {});
    setCapacity(null);
    api.get<{ capacityHoursPerWeek: number; staff: StaffCapacityRow[] }>(`/reports/staff-capacity?from=${from}&to=${to}`)
      .then(setCapacity)
      .catch(() => {});
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

  async function handleStatementPdf(kind: "pl" | "balance-sheet", mode: "view" | "download" | "print") {
    const key = `${kind}-${mode}`;
    setExporting(key);
    try {
      const path = `/reports/pdf/${kind}?from=${from}&to=${to}`;
      const label = kind === "pl" ? "Firm-Wide P&L" : "Firm-Wide Balance Sheet";
      if (mode === "view") await viewFile(path);
      else if (mode === "print") await printFile(path);
      else await downloadFile(path, buildFilename([label, `${from} to ${to}`], "pdf"));
    } catch {
      setError(`Could not generate the ${kind === "pl" ? "P&L" : "Balance Sheet"}.`);
    } finally {
      setExporting(null);
    }
  }

  async function handlePdf(mode: "view" | "download" | "print") {
    setExporting(`pdf-${mode}`);
    try {
      const path = `/reports/pdf/firm-insights?from=${from}&to=${to}`;
      if (mode === "view") await viewFile(path);
      else if (mode === "print") await printFile(path);
      else await downloadFile(path, buildFilename(["Firm Report", `${from} to ${to}`], "pdf"));
    } catch {
      setError("Could not generate the Firm Report PDF.");
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
            <button type="button" className="btn" disabled={exporting !== null} onClick={() => handlePdf("view")}>
              {exporting === "pdf-view" ? "Opening…" : "View / Print"}
            </button>
            <button type="button" className="btn" disabled={exporting !== null} onClick={() => handlePdf("print")}>
              {exporting === "pdf-print" ? "Printing…" : "Print"}
            </button>
            <button type="button" className="btn" disabled={exporting !== null} onClick={() => handlePdf("download")}>
              {exporting === "pdf-download" ? "Generating…" : "Download PDF"}
            </button>
            <button type="button" className="btn" disabled={exporting !== null} onClick={() => handleExport("csv")}>
              {exporting === "csv" ? "Exporting…" : "Export CSV"}
            </button>
            <button type="button" className="btn" disabled={exporting !== null} onClick={() => handleExport("xlsx")}>
              {exporting === "xlsx" ? "Exporting…" : "Export Excel"}
            </button>
          </div>
        </div>
      </div>

      {healthScore && (
        <div className="command-panel" style={{ marginBottom: 16 }}>
          <div className="command-panel-header">
            <h2 className="command-panel-title">Firm Health Score</h2>
            <div className="command-panel-note">One composite number combining profitability, revenue trend, AR aging, filing compliance, overdue work, and staff utilization — always shown with the breakdown, never as a bare number.</div>
          </div>
          <div style={{ display: "flex", gap: 20, alignItems: "center", padding: "0 16px 16px", flexWrap: "wrap" }}>
            <div style={{ textAlign: "center", minWidth: 96 }}>
              <div style={{ fontSize: 40, fontWeight: 800, color: BAND_COLOR[healthScore.band] }}>{healthScore.score}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: BAND_COLOR[healthScore.band] }}>{healthScore.band.toUpperCase()}</div>
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <table>
                <tbody>
                  {healthScore.components.map((c) => (
                    <tr key={c.label}>
                      <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{c.label}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{c.points} / {c.maxPoints}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{c.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="command-panel" style={{ marginBottom: 16 }}>
        <div className="command-panel-header">
          <h2 className="command-panel-title">Financial Statements</h2>
          <div className="command-panel-note">Firm-wide P&L and Balance Sheet — every client's GL activity rolled into one statement, for the period above.</div>
        </div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", padding: "0 16px 16px" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Profit &amp; Loss</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn" disabled={exporting !== null} onClick={() => handleStatementPdf("pl", "view")}>{exporting === "pl-view" ? "Opening…" : "View / Print"}</button>
              <button type="button" className="btn" disabled={exporting !== null} onClick={() => handleStatementPdf("pl", "print")}>{exporting === "pl-print" ? "Printing…" : "Print"}</button>
              <button type="button" className="btn" disabled={exporting !== null} onClick={() => handleStatementPdf("pl", "download")}>{exporting === "pl-download" ? "Generating…" : "Download PDF"}</button>
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Balance Sheet</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn" disabled={exporting !== null} onClick={() => handleStatementPdf("balance-sheet", "view")}>{exporting === "balance-sheet-view" ? "Opening…" : "View / Print"}</button>
              <button type="button" className="btn" disabled={exporting !== null} onClick={() => handleStatementPdf("balance-sheet", "print")}>{exporting === "balance-sheet-print" ? "Printing…" : "Print"}</button>
              <button type="button" className="btn" disabled={exporting !== null} onClick={() => handleStatementPdf("balance-sheet", "download")}>{exporting === "balance-sheet-download" ? "Generating…" : "Download PDF"}</button>
            </div>
          </div>
        </div>
      </div>

      <ArAgingReport />

      <RecurringRevenueSection />

      <TaxReturnProductionSummary />

      <QualityControlSection />

      <CommunicationGapsSection />

      <DocumentCollectionGapsSection />

      <ClientProfitabilitySection from={from} to={to} />

      <MinimumFeeScheduleSection />

      <FeeComplianceSection from={from} to={to} />

      <ClientListingSection />

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

      {capacity && (
        <div className="command-panel" style={{ marginTop: 16 }}>
          <div className="command-panel-header">
            <h2 className="command-panel-title">Staff Capacity</h2>
            <div className="command-panel-note">
              Real hours logged in Time Tracking against a flat {capacity.capacityHoursPerWeek}-hour/week assumption (no per-staff capacity setting exists yet) — "Under Capacity" for everyone below just means little/no time has been logged for this window yet, not necessarily light workload.
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th scope="col">Staff</th><th scope="col">Capacity Hours</th><th scope="col">Logged Hours</th><th scope="col">Available</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {capacity.staff.length === 0 && <tr><td colSpan={5} className="muted">No active staff.</td></tr>}
                {capacity.staff.map((s) => (
                  <tr key={s.email}>
                    <td>{s.name}</td>
                    <td>{s.capacityHours}</td>
                    <td>{s.loggedHours}</td>
                    <td style={{ color: s.availableHours < 0 ? "var(--red)" : undefined }}>{s.availableHours}</td>
                    <td><span style={{ color: CAPACITY_STATUS_COLOR[s.status], fontWeight: 700 }}>{s.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

interface RecurringRevenue {
  mrr: number; arr: number;
  recurringClientCount: number; oneTimeClientCount: number;
  recurringRevenueTotal: number; oneTimeRevenueTotal: number;
  recurringPctOfTotal: number | null;
  windowFrom: string; windowTo: string;
}

/**
 * Trailing-12-month MRR/ARR — independent of the page's own From/To picker
 * (a run-rate metric, not a period comparison), so it's its own
 * self-fetching section rather than reusing the page's from/to state.
 */
function RecurringRevenueSection() {
  const [data, setData] = useState<RecurringRevenue | null>(null);

  useEffect(() => {
    api.get<RecurringRevenue>("/reports/recurring-revenue").then(setData).catch(() => {});
  }, []);

  if (!data) return null;

  return (
    <div className="command-panel" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <h2 className="command-panel-title">Recurring Revenue</h2>
        <div className="command-panel-note">
          Trailing 12 months ({data.windowFrom} to {data.windowTo}). A client counts as "recurring" if they posted revenue in 3+ separate months in that window — an empirical read of actual billing pattern, not a manually-tagged contract type.
        </div>
      </div>
      <div className="metric-grid" style={{ padding: 16 }}>
        <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">MRR</div><div className="metric-value">{fmtMoney(data.mrr)}</div></div>
        <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">ARR</div><div className="metric-value">{fmtMoney(data.arr)}</div></div>
        <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Recurring Clients</div><div className="metric-value">{data.recurringClientCount}</div></div>
        <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">One-Time Clients</div><div className="metric-value">{data.oneTimeClientCount}</div></div>
      </div>
      <p className="muted" style={{ fontSize: 11, padding: "0 16px 12px" }}>
        {data.recurringPctOfTotal !== null ? `${data.recurringPctOfTotal}% of revenue` : "Revenue"} from recurring clients ({fmtMoney(data.recurringRevenueTotal)}) vs {fmtMoney(data.oneTimeRevenueTotal)} from one-time engagements.
      </p>
    </div>
  );
}

/**
 * Firm-wide production board — status counts across every tracked return
 * (excludes Accepted/Completed by default, same "active work only" framing
 * as the Management Exception Report). This workflow was never tracked in
 * this system before this feature — counts will be genuinely zero
 * everywhere until staff start using the new "Tax Return Production" tab
 * on each client's profile.
 */
function TaxReturnProductionSummary() {
  const navigate = useNavigate();
  const [data, setData] = useState<{ counts: Record<string, number>; statuses: string[] } | null>(null);

  useEffect(() => {
    api.get<{ counts: Record<string, number>; statuses: string[] }>("/clients/tax-returns/summary").then(setData).catch(() => {});
  }, []);

  if (!data) return null;
  const total = Object.values(data.counts).reduce((s, n) => s + n, 0);

  return (
    <div className="command-panel" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <h2 className="command-panel-title">Tax Return Production</h2>
        <div className="command-panel-note">
          {total} active return{total === 1 ? "" : "s"} being tracked, by stage. Start tracking a return from a client's "Tax Return Production" tab.
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr>{data.statuses.map((s) => <th scope="col" key={s}>{s}</th>)}</tr></thead>
          <tbody>
            <tr>
              {data.statuses.map((s) => (
                <td key={s} style={{ cursor: data.counts[s] > 0 ? "pointer" : undefined, fontWeight: data.counts[s] > 0 ? 700 : undefined }} onClick={() => data.counts[s] > 0 && navigate("/clients")}>
                  {data.counts[s]}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface QualityControlRow { type: string; count: number; totalDecided: number; rejectionRatePct: number | null; recentNotes: string[] }
interface QualityControl { govFormRejections: QualityControlRow[]; taxReturnRejections: QualityControlRow[]; totalRejections: number; note: string }

/**
 * Grouped by form/return TYPE, not by staff — see the note the API itself
 * returns (`data.note`) and the backend comment on computeQualityControl:
 * this is about spotting a recurring process problem, not scoring
 * individuals. Real signals only (gov-form internal-review rejections,
 * tax-return e-file rejections) — no invented complaint-tracking.
 */
function QualityControlSection() {
  const [data, setData] = useState<QualityControl | null>(null);

  useEffect(() => {
    api.get<QualityControl>("/reports/quality-control").then(setData).catch(() => {});
  }, []);

  if (!data) return null;

  function renderTable(rows: QualityControlRow[], emptyLabel: string) {
    if (rows.length === 0) return <p className="muted" style={{ padding: "0 16px 12px", fontSize: 12.5 }}>{emptyLabel}</p>;
    return (
      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Type</th><th scope="col">Rejections</th><th scope="col">Rejection Rate</th><th scope="col">Recent Notes</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.type}>
                <td>{r.type}</td>
                <td>{r.count} of {r.totalDecided}</td>
                <td>{r.rejectionRatePct !== null ? `${r.rejectionRatePct}%` : "—"}</td>
                <td className="muted" style={{ fontSize: 12 }}>{r.recentNotes.join(" · ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="command-panel" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <h2 className="command-panel-title">Quality Control</h2>
        <div className="command-panel-note">{data.note}</div>
      </div>
      <div style={{ padding: "0 16px 4px", fontWeight: 700, fontSize: 13 }}>Government Form Filings (internal review rejections)</div>
      {renderTable(data.govFormRejections, "No rejections — either everything passed review, or no filing has gone through the optional review step yet.")}
      <div style={{ padding: "12px 16px 4px", fontWeight: 700, fontSize: 13 }}>Tax Returns (agency e-file rejections)</div>
      {renderTable(data.taxReturnRejections, "No rejections tracked yet.")}
    </div>
  );
}

interface CommunicationGapClient { clientId: string; clientName: string; lastContactAt: string | null; daysSinceContact: number | null }

/** "Clients with no contact in X days" (spec item #22) — every active client's most recent v3_communications row, firm-wide. */
function CommunicationGapsSection() {
  const navigate = useNavigate();
  const [data, setData] = useState<{ clients: CommunicationGapClient[]; thresholdDays: number } | null>(null);

  useEffect(() => {
    api.get<{ clients: CommunicationGapClient[]; thresholdDays: number }>("/reports/communication-gaps").then(setData).catch(() => {});
  }, []);

  if (!data) return null;

  return (
    <div className="command-panel" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <h2 className="command-panel-title">Communication Gaps</h2>
        <div className="command-panel-note">Active clients with no logged communication in {data.thresholdDays}+ days (or ever) — {data.clients.length} client{data.clients.length === 1 ? "" : "s"}.</div>
      </div>
      {data.clients.length === 0 ? (
        <p className="muted" style={{ padding: "0 16px 12px", fontSize: 12.5 }}>Every active client has been contacted within {data.thresholdDays} days.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">Client</th><th scope="col">Last Contact</th><th scope="col">Days Since</th></tr></thead>
            <tbody>
              {data.clients.slice(0, 30).map((c) => (
                <tr key={c.clientId} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => navigate(`/clients/${c.clientId}`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/clients/${c.clientId}`); } }}>
                  <td>{c.clientName}</td>
                  <td>{c.lastContactAt ? new Date(c.lastContactAt).toLocaleDateString() : "Never"}</td>
                  <td style={{ color: "var(--red)" }}>{c.daysSinceContact !== null ? c.daysSinceContact : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.clients.length > 30 && <p className="muted" style={{ padding: "8px 16px", fontSize: 11 }}>+{data.clients.length - 30} more not shown.</p>}
        </div>
      )}
    </div>
  );
}

interface DocumentGapRow { requestId: string; clientId: string; clientName: string; requestedItem: string; assignedTo: string | null; daysWaiting: number }

/** "Days waiting" per open document request (spec item #23) — no "reminders sent" count exists anywhere to surface, so this is days-waiting only, not fabricated. */
function DocumentCollectionGapsSection() {
  const navigate = useNavigate();
  const [data, setData] = useState<{ rows: DocumentGapRow[]; totalOutstanding: number; avgDaysWaiting: number | null } | null>(null);

  useEffect(() => {
    api.get<{ rows: DocumentGapRow[]; totalOutstanding: number; avgDaysWaiting: number | null }>("/reports/document-collection-gaps").then(setData).catch(() => {});
  }, []);

  if (!data) return null;

  return (
    <div className="command-panel" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <h2 className="command-panel-title">Document Collection</h2>
        <div className="command-panel-note">{data.totalOutstanding} outstanding request{data.totalOutstanding === 1 ? "" : "s"}{data.avgDaysWaiting !== null ? `, averaging ${data.avgDaysWaiting} days waiting` : ""}.</div>
      </div>
      {data.rows.length === 0 ? (
        <p className="muted" style={{ padding: "0 16px 12px", fontSize: 12.5 }}>No outstanding document requests.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">Client</th><th scope="col">Requested Item</th><th scope="col">Assigned To</th><th scope="col">Days Waiting</th></tr></thead>
            <tbody>
              {data.rows.slice(0, 30).map((r) => (
                <tr key={r.requestId} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => navigate(`/clients/${r.clientId}`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/clients/${r.clientId}`); } }}>
                  <td>{r.clientName}</td>
                  <td>{r.requestedItem}</td>
                  <td>{r.assignedTo || "—"}</td>
                  <td style={{ color: r.daysWaiting > 14 ? "var(--red)" : undefined, fontWeight: r.daysWaiting > 14 ? 700 : undefined }}>{r.daysWaiting}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.rows.length > 30 && <p className="muted" style={{ padding: "8px 16px", fontSize: 11 }}>+{data.rows.length - 30} more not shown.</p>}
        </div>
      )}
    </div>
  );
}

type ProfitabilityTier = "Highly Profitable" | "Normal" | "Low Margin" | "Unprofitable";
interface ClientProfitabilityRow {
  clientId: string; clientName: string; revenue: number; directCosts: number; profit: number;
  marginPct: number | null; arBalance: number; tier: ProfitabilityTier;
}
const TIER_COLOR: Record<ProfitabilityTier, string> = {
  "Highly Profitable": "var(--teal)", "Normal": "var(--ink)", "Low Margin": "#b8860b", "Unprofitable": "var(--red)",
};

/**
 * Simplified per the user's own explicit choice (2026-08-20): revenue minus
 * direct GL-posted costs only, no staff-time cost allocation — they chose
 * to skip that rather than pick a costing methodology right now. Uses the
 * page's own From/To period, unlike the fixed-window sections above.
 */
function ClientProfitabilitySection({ from, to }: { from: string; to: string }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ClientProfitabilityRow[] | null>(null);

  useEffect(() => {
    setRows(null);
    api.get<{ clients: ClientProfitabilityRow[] }>(`/reports/client-profitability?from=${from}&to=${to}`)
      .then((res) => setRows(res.clients))
      .catch(() => {});
  }, [from, to]);

  if (!rows) return null;

  return (
    <div className="command-panel" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <h2 className="command-panel-title">Client Profitability</h2>
        <div className="command-panel-note">
          Revenue minus direct costs posted to each client's own GL activity — no staff-time cost allocation (skipped by choice, since that needs a $/hour methodology decision first).
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="muted" style={{ padding: "0 16px 12px", fontSize: 12.5 }}>No client GL activity in this window.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">Client</th><th scope="col">Revenue</th><th scope="col">Direct Costs</th><th scope="col">Profit</th><th scope="col">Margin</th><th scope="col">Tier</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.clientId} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => navigate(`/clients/${r.clientId}`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/clients/${r.clientId}`); } }}>
                  <td>{r.clientName}</td>
                  <td>{fmtMoney(r.revenue)}</td>
                  <td>{fmtMoney(r.directCosts)}</td>
                  <td style={{ fontWeight: 700, color: r.profit >= 0 ? undefined : "var(--red)" }}>{fmtMoney(r.profit)}</td>
                  <td>{r.marginPct !== null ? `${r.marginPct}%` : "—"}</td>
                  <td><span style={{ color: TIER_COLOR[r.tier], fontWeight: 700 }}>{r.tier}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface MinimumFeeRow {
  min_fee_id: string; service_key: string; label: string; variant: string | null; base_fee: number;
  per_unit_fee: number | null; per_unit_threshold: number | null; per_unit_label: string | null;
  billing_cadence: string; active: boolean;
}
const FEE_SERVICE_OPTIONS = [
  { key: "sales_tax", label: "Sales Tax Filing" },
  { key: "payroll", label: "Payroll Processing" },
  { key: "bookkeeping", label: "Bookkeeping" },
  { key: "business_tax_prep", label: "Business Tax Return" },
  { key: "personal_tax_prep", label: "Individual Tax Return" },
  { key: "other", label: "Other" },
];
const EMPTY_FEE_FORM = {
  serviceKey: "sales_tax", label: "", variant: "", baseFee: "", perUnitFee: "", perUnitThreshold: "", perUnitLabel: "", billingCadence: "monthly",
};

/**
 * Real, admin-editable minimum-fee floors (item #21) — given directly by
 * the user 2026-08-20 rather than sourced from the pre-existing Fee
 * Schedule (checked, found too thin/stale to use). Backs
 * FeeComplianceSection below. Sales Tax uses `variant` for its real
 * fee-by-filing-frequency structure; Payroll uses the per-unit fields for
 * its real base-covers-N-employees-then-$X-more structure; every other
 * service is flat.
 */
function MinimumFeeScheduleSection() {
  const notify = useNotify();
  const confirmDialog = useConfirm();
  const [fees, setFees] = useState<MinimumFeeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FEE_FORM);
  const [saving, setSaving] = useState(false);

  function load() {
    api.get<{ minimumFees: MinimumFeeRow[] }>("/reports/minimum-fees")
      .then((res) => setFees(res.minimumFees))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the fee schedule."));
  }
  useEffect(load, []);

  function startAdd() {
    setForm(EMPTY_FEE_FORM);
    setEditingId(null);
    setShowForm(true);
  }
  function startEdit(f: MinimumFeeRow) {
    setForm({
      serviceKey: f.service_key, label: f.label, variant: f.variant || "", baseFee: String(f.base_fee),
      perUnitFee: f.per_unit_fee != null ? String(f.per_unit_fee) : "", perUnitThreshold: f.per_unit_threshold != null ? String(f.per_unit_threshold) : "",
      perUnitLabel: f.per_unit_label || "", billingCadence: f.billing_cadence,
    });
    setEditingId(f.min_fee_id);
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        serviceKey: form.serviceKey, label: form.label || FEE_SERVICE_OPTIONS.find((o) => o.key === form.serviceKey)?.label || form.serviceKey,
        variant: form.variant, baseFee: form.baseFee, perUnitFee: form.perUnitFee, perUnitThreshold: form.perUnitThreshold,
        perUnitLabel: form.perUnitLabel, billingCadence: form.billingCadence,
      };
      if (editingId) await api.patch(`/reports/minimum-fees/${editingId}`, payload);
      else await api.post("/reports/minimum-fees", payload);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this fee.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(f: MinimumFeeRow) {
    try {
      await api.patch(`/reports/minimum-fees/${f.min_fee_id}`, { active: !f.active });
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not update this fee.");
    }
  }

  async function handleDelete(f: MinimumFeeRow) {
    const ok = await confirmDialog({ title: "Delete minimum fee", message: `Delete the "${f.label}${f.variant ? ` — ${f.variant}` : ""}" fee? This can't be undone.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.post(`/reports/minimum-fees/${f.min_fee_id}/delete`, {});
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this fee.");
    }
  }

  return (
    <div className="command-panel" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <h2 className="command-panel-title">Minimum Fee Schedule</h2>
        <div className="command-panel-note">Your real fee floors — edit these anytime, the Fee Compliance report below always reads the current values.</div>
      </div>
      <div style={{ padding: "0 16px 16px" }}>
        {error && <ErrorBanner error={error} />}
        {!showForm && <button type="button" className="btn" onClick={startAdd}>+ Add Fee</button>}

        {showForm && (
          <form onSubmit={handleSubmit} className="card" style={{ marginTop: 12, padding: 16 }}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="fee-service">Service</label>
                <select id="fee-service" value={form.serviceKey} onChange={(e) => setForm({ ...form, serviceKey: e.target.value, label: FEE_SERVICE_OPTIONS.find((o) => o.key === e.target.value)?.label || "" })}>
                  {FEE_SERVICE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </div>
              <div className="field"><label htmlFor="fee-label">Label</label><input id="fee-label" required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Shown on the report" /></div>
            </div>
            <div className="form-grid">
              <div className="field"><label htmlFor="fee-variant">Variant <span className="muted">(optional — e.g. Monthly/Quarterly/Semiannual for Sales Tax)</span></label><input id="fee-variant" value={form.variant} onChange={(e) => setForm({ ...form, variant: e.target.value })} /></div>
              <div className="field"><label htmlFor="fee-cadence">Billing Cadence</label>
                <select id="fee-cadence" value={form.billingCadence} onChange={(e) => setForm({ ...form, billingCadence: e.target.value })}>
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                  <option value="per_period">Per Filing Period</option>
                </select>
              </div>
            </div>
            <div className="field"><label htmlFor="fee-base">Base Fee ($)</label><input id="fee-base" type="number" step="0.01" required value={form.baseFee} onChange={(e) => setForm({ ...form, baseFee: e.target.value })} /></div>
            <div className="form-grid">
              <div className="field"><label htmlFor="fee-perunit">Per-Unit Fee ($) <span className="muted">(optional)</span></label><input id="fee-perunit" type="number" step="0.01" value={form.perUnitFee} onChange={(e) => setForm({ ...form, perUnitFee: e.target.value })} /></div>
              <div className="field"><label htmlFor="fee-threshold">Base Covers Up To <span className="muted">(optional)</span></label><input id="fee-threshold" type="number" value={form.perUnitThreshold} onChange={(e) => setForm({ ...form, perUnitThreshold: e.target.value })} placeholder="e.g. 2" /></div>
              <div className="field"><label htmlFor="fee-unitlabel">Unit Label <span className="muted">(optional)</span></label><input id="fee-unitlabel" value={form.perUnitLabel} onChange={(e) => setForm({ ...form, perUnitLabel: e.target.value })} placeholder="e.g. employee" /></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : editingId ? "Save Changes" : "Add Fee"}</button>
              <button type="button" className="btn" disabled={saving} onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        )}

        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th scope="col">Service</th><th scope="col">Variant</th><th scope="col">Base Fee</th><th scope="col">Per Unit</th><th scope="col">Cadence</th><th scope="col">Active</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {fees === null && <tr><td colSpan={7} className="muted">Loading…</td></tr>}
              {fees !== null && fees.length === 0 && <tr><td colSpan={7} className="muted">No fees set yet.</td></tr>}
              {fees?.map((f) => (
                <tr key={f.min_fee_id} style={{ opacity: f.active ? 1 : 0.5 }}>
                  <td>{f.label}</td>
                  <td>{f.variant || "—"}</td>
                  <td>{fmtMoney(f.base_fee)}</td>
                  <td>{f.per_unit_fee != null ? `+${fmtMoney(f.per_unit_fee)}/${f.per_unit_label || "unit"} over ${f.per_unit_threshold ?? 0}` : "—"}</td>
                  <td>{f.billing_cadence}</td>
                  <td><button type="button" className="link-button" onClick={() => handleToggleActive(f)}>{f.active ? "Yes" : "No"}</button></td>
                  <td>
                    <button type="button" className="link-button" onClick={() => startEdit(f)}>Edit</button>
                    {" · "}
                    <button type="button" className="link-button" onClick={() => handleDelete(f)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface FeeComplianceRow {
  clientId: string; clientName: string; expectedMinimum: number; actualRevenue: number;
  gap: number; status: "Below Minimum" | "At Minimum" | "Above Minimum" | "Not Enough Data"; servicesUsed: string[]; hasAnyRevenue: boolean;
}

/**
 * Real production data (2026-08-20) showed this distinction matters a lot:
 * of 131 service-enrolled clients compared, only 1 had actual revenue
 * recorded AND fell below the floor — 124 had ZERO GL revenue recorded at
 * all. Those are very different problems (a pricing issue vs. a billing/
 * tracking gap), so the panel leads with the genuinely-underpriced list and
 * treats the no-revenue group as its own, separately-labeled section
 * instead of dumping both into one "red flag" list.
 */
function FeeComplianceSection({ from, to }: { from: string; to: string }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<FeeComplianceRow[] | null>(null);

  useEffect(() => {
    setRows(null);
    api.get<{ clients: FeeComplianceRow[] }>(`/reports/fee-compliance?from=${from}&to=${to}`)
      .then((res) => setRows(res.clients))
      .catch(() => {});
  }, [from, to]);

  if (!rows) return null;
  const underpriced = rows.filter((r) => r.status === "Below Minimum" && r.hasAnyRevenue);
  const noRevenue = rows.filter((r) => !r.hasAnyRevenue);
  const compliant = rows.filter((r) => r.hasAnyRevenue && r.status !== "Below Minimum");

  return (
    <div className="command-panel" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <h2 className="command-panel-title">Fee Compliance</h2>
        <div className="command-panel-note">
          {rows.length} service-enrolled client{rows.length === 1 ? "" : "s"} compared against the fee schedule above, for this period.
        </div>
        <div className="command-panel-note" style={{ marginTop: 4 }}>
          "Actual Revenue" below is each client's own recorded business revenue (their sales, tracked as part of your bookkeeping service for them) — not the fees they pay AL TAX SERVICE, which this app doesn't yet track consistently enough to compare against. Read this as a bookkeeping-coverage check ("is this client's revenue actually being recorded"), not a verified billing audit, until real invoice/payment history exists.
        </div>
      </div>

      <div style={{ padding: "0 16px 4px", fontWeight: 700, fontSize: 13, color: "var(--red)" }}>Below Minimum ({underpriced.length})</div>
      {underpriced.length === 0 ? (
        <p className="muted" style={{ padding: "0 16px 12px", fontSize: 12.5 }}>No client with recorded business revenue falls below their fee floor — expected, since a real business's own sales revenue is almost always far larger than a service fee. This check rarely catches anything on its own.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">Client</th><th scope="col">Expected Minimum</th><th scope="col">Actual Revenue</th><th scope="col">Gap</th></tr></thead>
            <tbody>
              {underpriced.map((r) => (
                <tr key={r.clientId} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => navigate(`/clients/${r.clientId}`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/clients/${r.clientId}`); } }}>
                  <td>{r.clientName}</td>
                  <td>{fmtMoney(r.expectedMinimum)}</td>
                  <td>{fmtMoney(r.actualRevenue)}</td>
                  <td style={{ color: "var(--red)", fontWeight: 700 }}>{fmtMoney(r.gap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ padding: "12px 16px 4px", fontWeight: 700, fontSize: 13 }}>No Revenue Recorded ({noRevenue.length})</div>
      <p className="muted" style={{ padding: "0 16px 12px", fontSize: 12.5 }}>
        These clients are enrolled in a billed service but have $0 GL revenue recorded for this period — a billing/tracking gap, not necessarily a pricing problem. Worth checking whether they're actually being invoiced.
      </p>
      {noRevenue.length > 0 && (
        <details style={{ padding: "0 16px 12px" }}>
          <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--muted)" }}>Show {noRevenue.length} client{noRevenue.length === 1 ? "" : "s"}</summary>
          <div className="table-scroll" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th scope="col">Client</th><th scope="col">Services</th></tr></thead>
              <tbody>
                {noRevenue.map((r) => (
                  <tr key={r.clientId} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => navigate(`/clients/${r.clientId}`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/clients/${r.clientId}`); } }}>
                    <td>{r.clientName}</td>
                    <td className="muted">{r.servicesUsed.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <p className="muted" style={{ padding: "12px 16px 12px", fontSize: 11 }}>{compliant.length} client{compliant.length === 1 ? "" : "s"} have recorded business revenue above their fee floor — not proof they're actually paying you correctly, just that their own books show activity.</p>
    </div>
  );
}

/**
 * Client Listing / Client Detailed Listing — a printable firm-wide client
 * roster, modeled on a payroll platform's own "Reports" screen (Report
 * Group: Firm -> Client Listing / Client Detailed Listing): a client picker
 * with search + status filter, a Mask Federal ID toggle for the Detailed
 * variant (which is the only one that shows EIN at all), and the same
 * View/Print/Download trio every other PDF report in this app uses.
 */
function ClientListingSection() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [reportType, setReportType] = useState<"listing" | "detailed">("listing");
  const [maskEin, setMaskEin] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ clients: Client[] }>("/clients")
      .then((r) => {
        setClients(r.clients);
        setSelected(new Set(r.clients.filter((c) => String(c.status || "") === "Active").map((c) => c.client_id)));
      })
      .catch(() => {});
  }, []);

  const statuses = useMemo(() => Array.from(new Set(clients.map((c) => String(c.status || "")).filter(Boolean))).sort(), [clients]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (statusFilter !== "all" && String(c.status || "") !== statusFilter) return false;
      if (q && !c.client_name.toLowerCase().includes(q) && !c.client_id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [clients, search, statusFilter]);

  function toggleClient(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function pdfPath() {
    const detailed = reportType === "detailed" ? "1" : "0";
    const mask = maskEin ? "1" : "0";
    const clientIds = selected.size ? `&clientIds=${encodeURIComponent(Array.from(selected).join(","))}` : "";
    return `/reports/pdf/client-listing?detailed=${detailed}&maskEin=${mask}${clientIds}`;
  }

  const reportTitle = reportType === "detailed" ? "Client Detailed Listing" : "Client Listing";

  async function handleRun(mode: "view" | "download" | "print") {
    if (selected.size === 0) { setError("Select at least one client."); return; }
    setBusy(mode);
    setError(null);
    try {
      if (mode === "view") await viewFile(pdfPath());
      else if (mode === "print") await printFile(pdfPath());
      else await downloadFile(pdfPath(), buildFilename([reportTitle, new Date().toISOString().slice(0, 10)], "pdf"));
    } catch {
      setError(`Could not generate the ${reportTitle}.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="command-panel" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <h2 className="command-panel-title">Client Listing</h2>
        <div className="command-panel-note">A printable client roster — pick a report type, choose which clients to include, then view, print, or download.</div>
      </div>
      <div style={{ padding: "0 16px 16px" }}>
        {error && <ErrorBanner error={error} />}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 12px" }}>
          <button type="button" className={`btn btn-sm ${reportType === "listing" ? "btn-primary" : ""}`} onClick={() => setReportType("listing")}>Client Listing</button>
          <button type="button" className={`btn btn-sm ${reportType === "detailed" ? "btn-primary" : ""}`} onClick={() => setReportType("detailed")}>Client Detailed Listing</button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients…" style={{ maxWidth: 220 }} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ maxWidth: 150 }}>
            <option value="all">Any status</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set(filtered.map((c) => c.client_id)))}>Select shown ({filtered.length})</button>
          <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set(clients.map((c) => c.client_id)))}>Select all ({clients.length})</button>
          <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>

        <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 6, padding: 8, marginBottom: 12 }}>
          {filtered.map((c) => (
            <label key={c.client_id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 0" }}>
              <input type="checkbox" checked={selected.has(c.client_id)} onChange={() => toggleClient(c.client_id)} />
              {c.client_name} <span className="muted" style={{ fontSize: 11 }}>({c.client_id})</span>
            </label>
          ))}
          {filtered.length === 0 && <p className="muted" style={{ margin: 0 }}>No clients match.</p>}
        </div>

        {reportType === "detailed" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, margin: "0 0 12px" }}>
            <input type="checkbox" checked={maskEin} onChange={(e) => setMaskEin(e.target.checked)} />
            Mask Federal ID (show only the last 4 digits)
          </label>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn" disabled={busy !== null} onClick={() => handleRun("view")}>{busy === "view" ? "Opening…" : "View / Print"}</button>
          <button type="button" className="btn" disabled={busy !== null} onClick={() => handleRun("print")}>{busy === "print" ? "Printing…" : "Print"}</button>
          <button type="button" className="btn" disabled={busy !== null} onClick={() => handleRun("download")}>{busy === "download" ? "Generating…" : "Download PDF"}</button>
        </div>
        <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>{selected.size} client{selected.size === 1 ? "" : "s"} selected for the {reportTitle}.</p>
      </div>
    </div>
  );
}
