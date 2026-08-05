import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ErrorBanner } from "./ErrorBanner";

interface ClientSummary { openTasks: number; openRequests: number; openInvoices: number; balanceDue: number; employeesCount: number }

interface HealthScoreComponent { label: string; points: number; maxPoints: number; detail: string }
interface ClientHealthScore { score: number; band: "Green" | "Yellow" | "Red"; components: HealthScoreComponent[] }
interface ClientRatios {
  netMarginPct: number | null; grossMarginPct: number | null; dso: number | null;
  ar90PlusPct: number | null; payrollPctOfRevenue: number | null; taxLiabilityPctOfRevenue: number | null;
}
interface ClientArAging { current: number; d1_30: number; d31_60: number; d61_90: number; d90Plus: number; total: number }
interface BudgetVsActualRow { accountName: string; budget: number; actual: number; variance: number }
interface Deadline { label: string; date: string; source?: string }
interface MonthlySnapshot { periodLabel: string; revenue: number; expenses: number; profit: number; cashBalance: number; arBalance: number; apBalance: number; taxLiabilities: number; payrollCost: number; healthScore: number | null; healthBand: string | null; openTasks: number | null }

interface ClientDashboard {
  period: { from: string; to: string };
  financials: { revenue: number; expenses: number; grossProfit: number; netProfit: number; cogs: number; months: { month: string; revenue: number; expenses: number; profit: number }[] };
  cashBalance: number; apEstimate: number; taxLiabilities: number;
  arAging: ClientArAging; payrollCost: number;
  ratios: ClientRatios; health: ClientHealthScore;
  budgetVsActual: BudgetVsActualRow[]; budgetPeriodLabel: string;
  deadlines: Deadline[];
  dataLimitations: string[];
}

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}
function fmtPct(v: number | null): string {
  return v === null ? "—" : `${v}%`;
}
function bandPillClass(band: "Green" | "Yellow" | "Red"): string {
  return band === "Green" ? "status-green" : band === "Yellow" ? "status-amber" : "status-red";
}
function daysUntil(dateStr: string): number {
  const ms = new Date(`${dateStr}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime();
  return Math.round(ms / 86400000);
}
function deadlinePillClass(days: number): string {
  return days < 7 ? "status-red" : days < 30 ? "status-amber" : "status-gray";
}

/** Small vs-prior-month delta — green/up when the change is favorable for that metric (revenue up, expenses down), red/down otherwise. */
function DeltaArrow({ current, prior, higherIsBetter = true }: { current: number; prior: number; higherIsBetter?: boolean }) {
  if (prior === 0) return null;
  const pct = Math.round(((current - prior) / Math.abs(prior)) * 100);
  if (pct === 0) return <span className="muted" style={{ fontSize: 11 }}> · flat vs last month</span>;
  const up = pct > 0;
  const favorable = higherIsBetter ? up : !up;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: favorable ? "var(--green)" : "var(--red)" }}>
      {" "}{up ? "▲" : "▼"} {Math.abs(pct)}% vs last month
    </span>
  );
}

/** Inline SVG polyline — no chart library exists in this frontend, and one line doesn't need one. */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  const w = 240, h = 48, pad = 4;
  const max = Math.max(...points, 0);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((v, i) => `${pad + i * step},${h - pad - ((v - min) / range) * (h - pad * 2)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label="Revenue trend">
      <polyline points={coords.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * "At a Glance" — the first tab a staff member lands on when opening a
 * client. Two parts:
 *
 * - Operations tiles, from the `summary` ClientDetailPage.tsx already
 *   fetches (no duplicate fetch — passed in as a prop) — visible to staff
 *   and admin alike.
 * - A full financial dashboard, admin-only (matching the existing
 *   restriction on this data everywhere else — Reports' Financial Overview
 *   and AR Aging are both admin-only too), fetched in one call from
 *   GET /reports/client-dashboard/:clientId: health score, period totals
 *   with color-coded tiles, ratios, budget vs actual, upcoming deadlines,
 *   and a revenue trend sparkline. Cash Balance and Accounts Payable are
 *   GL-derived estimates (no bank feed or vendor-bill subledger exists in
 *   this app) — always labeled as such per dataLimitations from the API.
 */
export function ClientAtAGlance({ clientId, summary }: { clientId: string; summary: ClientSummary | null }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [dash, setDash] = useState<ClientDashboard | null>(null);
  const [snapshots, setSnapshots] = useState<MonthlySnapshot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) { setDash(null); setSnapshots(null); return; }
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<ClientDashboard>(`/reports/client-dashboard/${clientId}`),
      api.get<{ snapshots: MonthlySnapshot[] }>(`/reports/client-monthly-snapshots/${clientId}?months=12`).then((r) => r.snapshots).catch(() => []),
    ])
      .then(([d, s]) => { setDash(d); setSnapshots(s); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the client dashboard."))
      .finally(() => setLoading(false));
  }, [clientId, isAdmin]);

  const priorMonth = snapshots && snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
  const latestMonth = snapshots && snapshots.length >= 1 ? snapshots[snapshots.length - 1] : null;

  const urgentDeadlines = dash ? dash.deadlines.filter((d) => daysUntil(d.date) < 7) : [];
  const showAlert = dash && (dash.health.band === "Red" || dash.arAging.d90Plus > 0 || urgentDeadlines.length > 0);

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Operations</h2>
        <div className="metric-grid">
          <div className="metric"><div className="metric-label">Open Tasks</div><div className="metric-value">{summary ? summary.openTasks : "—"}</div></div>
          <div className="metric"><div className="metric-label">Open Document Requests</div><div className="metric-value">{summary ? summary.openRequests : "—"}</div></div>
          <div className="metric"><div className="metric-label">Open Invoices</div><div className="metric-value">{summary ? summary.openInvoices : "—"}</div></div>
          <div className="metric"><div className="metric-label">Balance Due</div><div className="metric-value">{summary ? fmtMoney(summary.balanceDue) : "—"}</div></div>
          <div className="metric"><div className="metric-label">Employees</div><div className="metric-value">{summary ? summary.employeesCount : "—"}</div></div>
        </div>
      </div>

      {isAdmin && (
        <div>
          {error && <ErrorBanner error={error} />}
          {loading && <div className="spinner-wrap">Loading…</div>}

          {!loading && dash && (
            <>
              {showAlert && (
                <div className="alert-strip">
                  {dash.health.band === "Red" && <span>Health score is <strong>{dash.health.score}</strong> (Red) — see the breakdown below.</span>}
                  {dash.health.band !== "Red" && dash.arAging.d90Plus > 0 && <span><strong>{fmtMoney(dash.arAging.d90Plus)}</strong> is over 90 days past due.</span>}
                  {dash.health.band !== "Red" && dash.arAging.d90Plus <= 0 && urgentDeadlines.length > 0 && (
                    <span><strong>{urgentDeadlines[0].label}</strong> is due {daysUntil(urgentDeadlines[0].date) <= 0 ? "today" : `in ${daysUntil(urgentDeadlines[0].date)} day${daysUntil(urgentDeadlines[0].date) === 1 ? "" : "s"}`}.</span>
                  )}
                </div>
              )}

              <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <h2 style={{ fontSize: 15, margin: 0 }}>Business Health Score</h2>
                  <span className={`status-pill ${bandPillClass(dash.health.band)}`}>{dash.health.band}</span>
                </div>
                <div style={{ fontSize: 40, fontWeight: 850, fontFamily: "var(--serif)" }}>{dash.health.score}<span style={{ fontSize: 16, color: "var(--muted)" }}> / 100</span></div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
                  {dash.health.components.map((c) => (
                    <div key={c.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, gap: 12 }}>
                      <span className="muted">{c.label} — {c.detail}</span>
                      <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{c.points}/{c.maxPoints}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card" style={{ marginBottom: 16 }}>
                <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>This Period</h2>
                <div className="metric-grid">
                  <div className="metric"><div className="metric-label">Revenue</div><div className="metric-value">{fmtMoney(dash.financials.revenue)}</div><div className="metric-note">Last 6 months</div></div>
                  <div className="metric"><div className="metric-label">Expenses</div><div className="metric-value">{fmtMoney(dash.financials.expenses)}</div><div className="metric-note">Last 6 months</div></div>
                  <div className="metric"><div className="metric-label">Gross Profit</div><div className="metric-value">{fmtMoney(dash.financials.grossProfit)}</div><div className="metric-note">Revenue − COGS</div></div>
                  <div className={`metric${dash.financials.netProfit < 0 ? " metric-critical" : ""}`}><div className="metric-label">Net Profit</div><div className="metric-value">{fmtMoney(dash.financials.netProfit)}</div><div className="metric-note">Last 6 months</div></div>
                </div>
                {(snapshots && snapshots.length > 1 ? snapshots.length : dash.financials.months.length) > 1 && (
                  <div style={{ marginTop: 14 }}>
                    <div className="metric-label" style={{ marginBottom: 4 }}>
                      Revenue Trend ({snapshots && snapshots.length > 1 ? `${snapshots.length} mo.` : "6 mo."})
                    </div>
                    <Sparkline
                      points={snapshots && snapshots.length > 1 ? snapshots.map((s) => s.revenue) : dash.financials.months.map((m) => m.revenue)}
                      color="var(--teal)"
                    />
                  </div>
                )}
              </div>

              {latestMonth && priorMonth && (
                <div className="card" style={{ marginBottom: 16 }}>
                  <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>This Month vs. Last Month</h2>
                  <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>{latestMonth.periodLabel} vs {priorMonth.periodLabel}, from the monthly snapshot history.</p>
                  <div className="metric-grid">
                    <div className="metric">
                      <div className="metric-label">Revenue</div>
                      <div className="metric-value">{fmtMoney(latestMonth.revenue)}</div>
                      <DeltaArrow current={latestMonth.revenue} prior={priorMonth.revenue} higherIsBetter />
                    </div>
                    <div className="metric">
                      <div className="metric-label">Expenses</div>
                      <div className="metric-value">{fmtMoney(latestMonth.expenses)}</div>
                      <DeltaArrow current={latestMonth.expenses} prior={priorMonth.expenses} higherIsBetter={false} />
                    </div>
                    <div className="metric">
                      <div className="metric-label">Net Profit</div>
                      <div className="metric-value">{fmtMoney(latestMonth.profit)}</div>
                      <DeltaArrow current={latestMonth.profit} prior={priorMonth.profit} higherIsBetter />
                    </div>
                    <div className="metric">
                      <div className="metric-label">Health Score</div>
                      <div className="metric-value">{latestMonth.healthScore ?? "—"}</div>
                      {latestMonth.healthScore !== null && priorMonth.healthScore !== null && (
                        <DeltaArrow current={latestMonth.healthScore} prior={priorMonth.healthScore} higherIsBetter />
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="card" style={{ marginBottom: 16 }}>
                <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Financial Position</h2>
                <div className="metric-grid">
                  <div className="metric"><div className="metric-label">Cash Balance</div><div className="metric-value">{fmtMoney(dash.cashBalance)}</div><div className="metric-note">Estimate — see note below</div></div>
                  <div className={`metric${dash.arAging.d90Plus > 0 ? " metric-critical" : ""}`}><div className="metric-label">Accounts Receivable</div><div className="metric-value">{fmtMoney(dash.arAging.total)}</div><div className="metric-note">{dash.arAging.d90Plus > 0 ? `${fmtMoney(dash.arAging.d90Plus)} over 90 days` : "None over 90 days"}</div></div>
                  <div className="metric"><div className="metric-label">Accounts Payable</div><div className="metric-value">{fmtMoney(dash.apEstimate)}</div><div className="metric-note">GL estimate — see note below</div></div>
                  <div className={`metric${dash.taxLiabilities > 0 ? " metric-critical" : ""}`}><div className="metric-label">Tax Liabilities</div><div className="metric-value">{fmtMoney(dash.taxLiabilities)}</div><div className="metric-note">Sales/payroll tax payable, current balance</div></div>
                </div>
              </div>

              <div className="card" style={{ marginBottom: 16 }}>
                <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Ratios</h2>
                <div className="metric-grid metric-grid-3">
                  <div className="metric"><div className="metric-label">Net Profit Margin</div><div className="metric-value">{fmtPct(dash.ratios.netMarginPct)}</div></div>
                  <div className="metric"><div className="metric-label">Days Sales Outstanding</div><div className="metric-value">{dash.ratios.dso === null ? "—" : dash.ratios.dso}</div><div className="metric-note">Days</div></div>
                  <div className="metric"><div className="metric-label">Payroll % of Revenue</div><div className="metric-value">{fmtPct(dash.ratios.payrollPctOfRevenue)}</div><div className="metric-note">{fmtMoney(dash.payrollCost)}</div></div>
                </div>
              </div>

              {dash.budgetVsActual.length > 0 && (
                <div className="card" style={{ marginBottom: 16 }}>
                  <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Budget vs. Actual — {dash.budgetPeriodLabel}</h2>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Account</th><th>Budget</th><th>Actual</th><th>Variance</th></tr></thead>
                      <tbody>
                        {dash.budgetVsActual.map((r) => (
                          <tr key={r.accountName}>
                            <td>{r.accountName}</td>
                            <td>{fmtMoney(r.budget)}</td>
                            <td>{fmtMoney(r.actual)}</td>
                            <td style={{ color: r.variance < 0 ? "var(--red)" : "var(--green)", fontWeight: 700 }}>{r.variance > 0 ? "+" : ""}{fmtMoney(r.variance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {dash.deadlines.length > 0 && (
                <div className="card" style={{ marginBottom: 16 }}>
                  <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Upcoming Deadlines</h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {dash.deadlines.map((d) => {
                      const days = daysUntil(d.date);
                      return (
                        <div key={`${d.label}-${d.date}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span>{d.label} — {d.date}</span>
                          <span className={`status-pill ${deadlinePillClass(days)}`}>{days < 0 ? "Overdue" : days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {dash.dataLimitations.length > 0 && (
                <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                  {dash.dataLimitations.join(" ")}
                </p>
              )}
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                For a longer or custom date range, see Reports → Financial Overview for this client.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
