import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ErrorBanner } from "./ErrorBanner";
import { useConfirm, useNotify } from "./ConfirmProvider";
import { NewWorkItemModal } from "./NewWorkItemModal";
import { fmtDateOnly as fmtDateNumeric } from "../utils/date";

interface ClientSummary { openTasks: number; openRequests: number; openInvoices: number; balanceDue: number; employeesCount: number }

interface ClientFlag {
  flagId: string | null;
  /** Stable per-flag id (see clients.routes.ts's ClientFlag) — used to target a single flag for the per-line "Send to Client" action below, distinct from flagId (which is null for computed, not-yet-a-real-row flags like Sales Tax Filing Due). */
  key?: string;
  /** Whether this flag is currently eligible for "Notify Client"/Send to Client — see the standing toggle at .../flags/:flagId/toggle-share. */
  shareWithClient?: boolean;
  flagType: "BalancePastDue" | "AgencyPastDue" | "SalesTaxFilingDue" | "SalesTaxBalanceDue" | "PayrollCadenceGap" | "BookkeepingStale" | "MissingComplianceTask" | "Credit" | "Custom";
  amount: number | null;
  note: string | null;
  color: "red" | "green" | "amber";
  createdAt: string | null;
  createdBy: string | null;
  resolvable: boolean;
  linkTaskId?: string;
  linkUrl?: string;
  category?: string | null;
  details?: string | null;
  dueDate?: string | null;
  /** MissingComplianceTask-only — see clients.routes.ts's ClientFlag interface. Drives
   * the "Create Task" action below (pre-fills NewWorkItemModal so the created task
   * actually satisfies the gap, not just describes it). */
  gapTaskType?: string;
}

interface ComplianceScoreComponent { label: string; points: number; maxPoints: number; detail: string }
interface ClientComplianceScore { score: number; band: "Green" | "Yellow" | "Red"; components: ComplianceScoreComponent[]; currentlyOverdueCount: number }
interface TimelinePeriod { periodLabel: string; dueDate: string; status: "onTime" | "late" | "missing" | "notYetDue"; filedDate: string | null }
interface ComplianceTimelineLane { obligationType: string; periods: TimelinePeriod[] }

const TIMELINE_STATUS_COLOR: Record<TimelinePeriod["status"], string> = {
  onTime: "var(--green)", late: "var(--amber)", missing: "var(--red)", notYetDue: "var(--line)",
};
const TIMELINE_STATUS_LABEL: Record<TimelinePeriod["status"], string> = {
  onTime: "filed on time", late: "filed late", missing: "missing", notYetDue: "not yet due",
};

/** One obligation's period-by-period strip — small colored squares, oldest to newest, so a pattern ("always late on X") is visible at a glance instead of inferred from today's status alone. */
function ComplianceTimelineRow({ lane }: { lane: ComplianceTimelineLane }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 130 }}>{lane.obligationType}</span>
      <div style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {lane.periods.map((p) => (
          <div
            key={p.periodLabel}
            title={`${p.periodLabel} — due ${p.dueDate}${p.filedDate ? `, filed ${p.filedDate}` : ""} (${TIMELINE_STATUS_LABEL[p.status]})`}
            style={{ width: 14, height: 14, borderRadius: 3, background: TIMELINE_STATUS_COLOR[p.status] }}
          />
        ))}
      </div>
    </div>
  );
}

interface HealthScoreComponent { label: string; points: number; maxPoints: number; detail: string }
interface ClientHealthScore { score: number; band: "Green" | "Yellow" | "Red"; components: HealthScoreComponent[] }
interface ClientRatios {
  netMarginPct: number | null; grossMarginPct: number | null; dso: number | null;
  ar90PlusPct: number | null; payrollPctOfRevenue: number | null; taxLiabilityPctOfRevenue: number | null;
}
interface ClientArAging { current: number; d1_30: number; d31_60: number; d61_90: number; d90Plus: number; total: number }
interface BudgetVsActualRow { accountName: string; budget: number; actual: number; variance: number }
interface Deadline { label: string; date: string; source?: string }
/** Obligation types with a lightweight "Mark Done" record (v3_obligation_completions) — see clients.routes.ts's /obligations/mark-done. */
const MARKABLE_DEADLINE_SOURCES = new Set(["EFTPS", "MD Withholding", "MD UI", "Business Tax Return", "Individual Tax Return", "Estimated Tax", "MD Annual Report", "Federal Payroll Tax", "1099/W-2"]);
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
function fmtDateOnly(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function flagLabel(f: ClientFlag): string {
  if (f.flagType === "BalancePastDue") return `Balance Past Due: ${fmtMoney(f.amount)}`;
  if (f.flagType === "AgencyPastDue") return `${f.note} Past Due${f.amount !== null ? `: ${fmtMoney(f.amount)}` : ""}`;
  if (f.flagType === "SalesTaxFilingDue") return `Sales Tax Filing ${f.note}`;
  if (f.flagType === "SalesTaxBalanceDue") return `Sales Tax Balance Due ${f.note}${f.amount !== null ? `: ${fmtMoney(f.amount)}` : ""}`;
  if (f.flagType === "Credit") return `Credit: ${fmtMoney(f.amount)}${f.note ? ` — ${f.note}` : ""}`;
  // These three already spell out their own date/period inline (see complianceGapFlags.ts's
  // note text) — the generic dueDate suffix below would just repeat it a second time.
  if (f.flagType === "PayrollCadenceGap" || f.flagType === "BookkeepingStale" || f.flagType === "MissingComplianceTask") return f.note || "";
  const label = f.category || f.note;
  return `${label}${f.amount !== null ? ` (${fmtMoney(f.amount)})` : ""}${f.dueDate ? ` — ${fmtDateOnly(f.dueDate)}` : ""}`;
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

/**
 * Every tile in this app that can meaningfully take you somewhere is a
 * `<button class="metric metric-clickable">`, not a plain div (established
 * pattern — see DashboardPage.tsx, TasksListPage.tsx, InvoicesListPage.tsx).
 * Renders a plain non-interactive div when no onClick is given, so a tile
 * with no real destination doesn't pretend to be clickable.
 */
function MetricTile({ label, value, note, critical, onClick }: { label: string; value: ReactNode; note?: ReactNode; critical?: boolean; onClick?: () => void }) {
  const cls = `metric${critical ? " metric-critical" : ""}${onClick ? " metric-clickable" : ""}`;
  const inner = (
    <>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {note}
    </>
  );
  return onClick
    ? <button type="button" className={cls} onClick={onClick}>{inner}</button>
    : <div className={cls}>{inner}</div>;
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
export function ClientAtAGlance({ clientId, summary, flags, complianceScore, complianceTimeline, onNavigateTab, onFlagsChanged, headerActions }: {
  clientId: string;
  summary: ClientSummary | null;
  flags: ClientFlag[] | null;
  complianceScore: ClientComplianceScore | null;
  complianceTimeline: ComplianceTimelineLane[];
  onNavigateTab: (tab: string) => void;
  /** Reloads the flags/gaps prop (lifted to ClientDetailPage) — called after
   * creating a task from a Missing Compliance Task gap so that gap's flag
   * disappears as soon as the real fix exists. */
  onFlagsChanged: () => void;
  /** Rendered at the top of the loaded view (e.g. the Client Profile PDF View/Print/Download row) — lives inside this tab's own content, not floating above it. */
  headerActions?: ReactNode;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const notify = useNotify();
  const confirmDialog = useConfirm();
  const isAdmin = user?.role === "admin";
  const goToReports = () => navigate(`/reports?clientId=${clientId}`);
  const [dash, setDash] = useState<ClientDashboard | null>(null);
  const [snapshots, setSnapshots] = useState<MonthlySnapshot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingDone, setMarkingDone] = useState<string | null>(null);
  // "Send to Client" per deadline/flag line — a lightweight confirm-then-send
  // (not a full preview/edit modal like the bulk "Notify Client" flow) since
  // the body is a fixed, simple template by design (direct owner request,
  // 2026-08-26: "just a reminder and to contact us regarding that matter").
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  async function handleSendDeadlineReminder(d: Deadline) {
    const key = `${d.source}|${d.date}`;
    const ok = await confirmDialog({ title: "Send reminder to client", message: `Send a reminder that "${d.label}" is due ${fmtDateOnly(d.date)}?` });
    if (!ok) return;
    setSendingKey(key);
    try {
      const preview = await api.get<{ canEmail: boolean; canSms: boolean }>(`/clients/${clientId}/deadline-notify-preview?label=${encodeURIComponent(d.label)}&date=${d.date}`);
      const channels = [preview.canEmail && "email", preview.canSms && "sms"].filter(Boolean) as string[];
      if (channels.length === 0) { await notify("This client hasn't consented to email or SMS, so no reminder can be sent."); return; }
      await api.post(`/clients/${clientId}/deadline-notify-send`, { label: d.label, date: d.date, channels });
      await notify("Reminder sent.");
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not send this reminder.");
    } finally {
      setSendingKey(null);
    }
  }
  function renderSendToClientControl(d: Deadline) {
    const key = `${d.source}|${d.date}`;
    return (
      <button type="button" className="ghost-button btn-sm" disabled={sendingKey === key} onClick={() => handleSendDeadlineReminder(d)}>
        {sendingKey === key ? "…" : "Send to Client"}
      </button>
    );
  }
  async function handleSendFlagToClient(f: ClientFlag) {
    if (!f.key) return;
    const ok = await confirmDialog({ title: "Send reminder to client", message: `Send "${flagLabel(f)}" to the client now?` });
    if (!ok) return;
    setSendingKey(f.key);
    try {
      await api.post(`/clients/${clientId}/flags/notify-send`, { flagKeys: [f.key] });
      await notify("Reminder sent.");
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not send this reminder.");
    } finally {
      setSendingKey(null);
    }
  }
  function renderSendFlagControl(f: ClientFlag) {
    if (!f.key || !f.shareWithClient) return null;
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); handleSendFlagToClient(f); }}
        disabled={sendingKey === f.key}
        style={{ background: "none", border: "1px solid currentColor", borderRadius: 4, cursor: "pointer", color: "inherit", padding: "1px 6px", fontSize: 10, fontWeight: 700, marginLeft: 6 }}
      >
        {sendingKey === f.key ? "…" : "Send to Client"}
      </button>
    );
  }
  const [createTaskGap, setCreateTaskGap] = useState<{ taskType: string; dueDate: string } | null>(null);
  // Inline "Mark Done" expansion (amount + optional paid date + Save and
  // Close/Send) — one shared bit of state/render logic for both places this
  // list appears (the alert-strip quick action and the full deadline list
  // below), instead of duplicating the form twice in this file.
  const [markDoneKey, setMarkDoneKey] = useState<string | null>(null);
  const [markDoneAmount, setMarkDoneAmount] = useState("");
  const [markDonePaidDate, setMarkDonePaidDate] = useState("");

  /**
   * amount/paidDate are both optional; "Save and Send" (sendConfirmation)
   * emails a filing confirmation (only meaningful with a real amount) and,
   * if paidDate is blank, schedules a payment-due reminder — see
   * clients.routes.ts's /obligations/mark-done doc comment.
   */
  async function handleMarkDone(d: Deadline, sendConfirmation: boolean) {
    const key = `${d.source}|${d.date}`;
    setMarkingDone(key);
    try {
      await api.post(`/clients/${clientId}/obligations/mark-done`, {
        source: d.source, dueDate: d.date, label: d.label,
        amount: markDoneAmount.trim() ? Number(markDoneAmount) : undefined,
        paidDate: markDonePaidDate || undefined,
        notify: sendConfirmation,
      });
      setDash((prev) => (prev ? { ...prev, deadlines: prev.deadlines.filter((x) => `${x.source}|${x.date}` !== key) } : prev));
      setMarkDoneKey(null);
      setMarkDoneAmount("");
      setMarkDonePaidDate("");
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not mark this as done.");
    } finally {
      setMarkingDone(null);
    }
  }

  function renderMarkDoneControl(d: Deadline) {
    if (!d.source || !MARKABLE_DEADLINE_SOURCES.has(d.source)) return null;
    const key = `${d.source}|${d.date}`;
    if (markDoneKey !== key) {
      return (
        <button type="button" className="ghost-button btn-sm" disabled={markingDone === key} onClick={() => { setMarkDoneKey(key); setMarkDoneAmount(""); setMarkDonePaidDate(""); }}>
          Mark Done
        </button>
      );
    }
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <input type="number" step="0.01" placeholder="Amount (optional)" value={markDoneAmount} onChange={(e) => setMarkDoneAmount(e.target.value)} style={{ width: 110, padding: "2px 4px", fontSize: 11.5 }} />
        <input type="date" title="Payment date (optional — leave blank if not yet paid)" value={markDonePaidDate} onChange={(e) => setMarkDonePaidDate(e.target.value)} style={{ padding: "2px 4px", fontSize: 11.5 }} />
        <button type="button" className="ghost-button btn-sm" disabled={markingDone === key} onClick={() => handleMarkDone(d, false)}>{markingDone === key ? "…" : "Save and Close"}</button>
        <button type="button" className="ghost-button btn-sm" disabled={markingDone === key} onClick={() => handleMarkDone(d, true)}>{markingDone === key ? "…" : "Save and Send"}</button>
        <button type="button" className="ghost-button btn-sm" onClick={() => { setMarkDoneKey(null); setMarkDoneAmount(""); setMarkDonePaidDate(""); }}>Cancel</button>
      </div>
    );
  }

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
      {headerActions}
      {complianceScore && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h2 style={{ fontSize: 15, margin: 0 }}>Compliance Score</h2>
            <span className={`status-pill ${bandPillClass(complianceScore.band)}`}>{complianceScore.band}</span>
          </div>
          <div style={{ fontSize: 40, fontWeight: 850, fontFamily: "var(--serif)" }}>{complianceScore.score}<span style={{ fontSize: 16, color: "var(--muted)" }}> / 100</span></div>
          <p className="muted" style={{ fontSize: 11.5, margin: "6px 0 0", lineHeight: 1.5 }}>
            Filing discipline only — the last 12 months of sales tax, payroll-tax and unemployment filings. Money and profitability are scored separately.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
            {complianceScore.components.map((c) => (
              <div key={c.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, gap: 12 }}>
                <span className="muted">{c.label} — {c.detail}</span>
                <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{c.points}/{c.maxPoints}</span>
              </div>
            ))}
          </div>
          {complianceTimeline.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
              <div className="metric-label">Filing History — last 12 periods</div>
              {complianceTimeline.map((lane) => (
                <ComplianceTimelineRow key={lane.obligationType} lane={lane} />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Operations</h2>
        <div className="metric-grid">
          <MetricTile label="Open Tasks" value={summary ? summary.openTasks : "—"} onClick={() => onNavigateTab("Tasks")} />
          <MetricTile label="Open Document Requests" value={summary ? summary.openRequests : "—"} onClick={() => onNavigateTab("Documents")} />
          <MetricTile label="Open Invoices" value={summary ? summary.openInvoices : "—"} onClick={() => onNavigateTab("Billing")} />
          <MetricTile label="Balance Due" value={summary ? fmtMoney(summary.balanceDue) : "—"} onClick={() => onNavigateTab("Billing")} />
          <MetricTile label="Employees" value={summary ? summary.employeesCount : "—"} onClick={() => onNavigateTab("Account")} />
        </div>
      </div>

      {flags && flags.length > 0 && (
        <div id="account-flags" className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Account Flags</h2>
          <div className="metric-grid">
            <div>
              <div className="metric-label" style={{ marginBottom: 6 }}>Owed to Us</div>
              {(() => {
                const owedToUs = flags.filter((f) => f.flagType === "BalancePastDue" || f.flagType === "Credit");
                return owedToUs.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {owedToUs.map((f) => (
                      <span key={f.flagId || f.flagType} className={`status-pill status-${f.color}`} style={{ width: "fit-content" }}>{flagLabel(f)}</span>
                    ))}
                  </div>
                ) : <span className="muted" style={{ fontSize: 12.5 }}>None</span>;
              })()}
            </div>
            <div>
              <div className="metric-label" style={{ marginBottom: 6 }}>Owed to Agencies</div>
              {(() => {
                const owedToAgencies = flags.filter((f) => f.flagType === "AgencyPastDue" || f.flagType === "SalesTaxFilingDue" || f.flagType === "SalesTaxBalanceDue");
                return owedToAgencies.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {owedToAgencies.map((f) => {
                      const target = f.linkTaskId ? `/tasks/${f.linkTaskId}` : f.linkUrl;
                      return (
                        <span key={f.linkTaskId || `${f.flagType}-${f.note}`} style={{ display: "inline-flex", alignItems: "center", width: "fit-content" }}>
                          <button
                            type="button"
                            onClick={() => target && navigate(target)}
                            className={`status-pill status-${f.color}`}
                            style={{ width: "fit-content", border: "none", cursor: target ? "pointer" : "default", textDecoration: target ? "underline" : "none" }}
                          >
                            {flagLabel(f)}
                          </button>
                          {renderSendFlagControl(f)}
                        </span>
                      );
                    })}
                  </div>
                ) : <span className="muted" style={{ fontSize: 12.5 }}>None</span>;
              })()}
            </div>
            <div>
              <div className="metric-label" style={{ marginBottom: 6 }}>Other Notes</div>
              <p className="muted" style={{ fontSize: 11, margin: "0 0 6px", lineHeight: 1.4 }}>
                Staff-entered notes (e.g. not in good standing) covering risks the system can't compute — not part of the Compliance Score.
              </p>
              {(() => {
                const other = flags.filter((f) => f.flagType === "Custom");
                return other.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {other.map((f) => {
                      const target = f.linkTaskId ? `/tasks/${f.linkTaskId}` : undefined;
                      return (
                        <div key={f.flagId || f.flagType} className={`status-pill status-${f.color}`} style={{ flexDirection: "column", alignItems: "flex-start", width: "fit-content", maxWidth: "100%" }}>
                          <span style={{ display: "inline-flex", alignItems: "center" }}>
                            {target ? (
                              <button type="button" onClick={() => navigate(target)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit", padding: 0, textDecoration: "underline" }}>
                                {flagLabel(f)}
                              </button>
                            ) : flagLabel(f)}
                            {renderSendFlagControl(f)}
                          </span>
                          {f.details && <div style={{ fontWeight: 400, opacity: 0.85, marginTop: 2, fontSize: 11 }}>{f.details}</div>}
                        </div>
                      );
                    })}
                  </div>
                ) : <span className="muted" style={{ fontSize: 12.5 }}>None</span>;
              })()}
            </div>
            <div>
              <div className="metric-label" style={{ marginBottom: 6 }}>Process Gaps</div>
              <p className="muted" style={{ fontSize: 11, margin: "0 0 6px", lineHeight: 1.4 }}>
                Computed from real payroll/bookkeeping/task records — no manual override. Payroll and Bookkeeping clear the moment a new paycheck or GL entry is posted; a missing task can be created right here.
              </p>
              {(() => {
                const gaps = flags.filter((f) => f.flagType === "PayrollCadenceGap" || f.flagType === "BookkeepingStale" || f.flagType === "MissingComplianceTask");
                return gaps.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {gaps.map((f) => {
                      if (f.flagType === "MissingComplianceTask") {
                        return (
                          <div key={f.flagId || `${f.flagType}-${f.note}`} className={`status-pill status-${f.color}`} style={{ flexDirection: "column", alignItems: "flex-start", width: "fit-content", maxWidth: "100%", gap: 4 }}>
                            <span>{flagLabel(f)}</span>
                            <button
                              type="button"
                              onClick={() => setCreateTaskGap({ taskType: f.gapTaskType || "", dueDate: f.dueDate || "" })}
                              style={{ background: "none", border: "1px solid currentColor", borderRadius: 4, cursor: "pointer", color: "inherit", padding: "1px 6px", fontSize: 10.5, fontWeight: 700 }}
                            >
                              Create Task
                            </button>
                          </div>
                        );
                      }
                      const target = f.linkUrl;
                      return (
                        <button
                          key={f.flagId || `${f.flagType}-${f.note}`}
                          type="button"
                          onClick={() => target && navigate(target)}
                          className={`status-pill status-${f.color}`}
                          style={{ width: "fit-content", border: "none", cursor: target ? "pointer" : "default", textDecoration: target ? "underline" : "none" }}
                        >
                          {flagLabel(f)}
                        </button>
                      );
                    })}
                  </div>
                ) : <span className="muted" style={{ fontSize: 12.5 }}>None</span>;
              })()}
            </div>
          </div>
        </div>
      )}

      {createTaskGap && (
        <NewWorkItemModal
          initialClientId={clientId}
          initialTaskType={createTaskGap.taskType}
          initialTaskName={createTaskGap.taskType}
          initialDueDate={createTaskGap.dueDate}
          onClose={() => setCreateTaskGap(null)}
          onDone={() => { setCreateTaskGap(null); onFlagsChanged(); }}
        />
      )}

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
                  {dash.health.band !== "Red" && dash.arAging.d90Plus <= 0 && urgentDeadlines.length > 0 && (() => {
                    const days = daysUntil(urgentDeadlines[0].date);
                    // days < 0 means the due date has already passed — a genuinely
                    // overdue filing was previously mislabeled "is due today" here,
                    // which reads as far less urgent than it actually is.
                    const wording = days < 0 ? `is ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`
                      : days === 0 ? "is due today"
                      : `is due in ${days} day${days === 1 ? "" : "s"}`;
                    const top = urgentDeadlines[0];
                    return (
                      <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span><strong>{top.label}</strong> {wording}.</span>
                        {renderMarkDoneControl(top)}
                        {renderSendToClientControl(top)}
                      </span>
                    );
                  })()}
                </div>
              )}

              <div className="card" style={{ marginBottom: 16 }} id="health-score-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <h2 style={{ fontSize: 15, margin: 0 }}>Business Health Score</h2>
                  <span className={`status-pill ${bandPillClass(dash.health.band)}`}>{dash.health.band}</span>
                </div>
                <div style={{ fontSize: 40, fontWeight: 850, fontFamily: "var(--serif)" }}>{dash.health.score}<span style={{ fontSize: 16, color: "var(--muted)" }}> / 100</span></div>
                <p className="muted" style={{ fontSize: 11.5, margin: "6px 0 0", lineHeight: 1.5 }}>
                  Financial health over the last 6 months; its Compliance line covers MD sales tax only — see the Compliance Score above for the full filing picture.
                </p>
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
                  <MetricTile label="Revenue" value={fmtMoney(dash.financials.revenue)} note={<div className="metric-note">Last 6 months</div>} onClick={goToReports} />
                  <MetricTile label="Expenses" value={fmtMoney(dash.financials.expenses)} note={<div className="metric-note">Last 6 months</div>} onClick={goToReports} />
                  <MetricTile label="Gross Profit" value={fmtMoney(dash.financials.grossProfit)} note={<div className="metric-note">Revenue − COGS</div>} onClick={goToReports} />
                  <MetricTile label="Net Profit" value={fmtMoney(dash.financials.netProfit)} note={<div className="metric-note">Last 6 months</div>} critical={dash.financials.netProfit < 0} onClick={goToReports} />
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
                    <MetricTile
                      label="Revenue" value={fmtMoney(latestMonth.revenue)} onClick={goToReports}
                      note={<DeltaArrow current={latestMonth.revenue} prior={priorMonth.revenue} higherIsBetter />}
                    />
                    <MetricTile
                      label="Expenses" value={fmtMoney(latestMonth.expenses)} onClick={goToReports}
                      note={<DeltaArrow current={latestMonth.expenses} prior={priorMonth.expenses} higherIsBetter={false} />}
                    />
                    <MetricTile
                      label="Net Profit" value={fmtMoney(latestMonth.profit)} onClick={goToReports}
                      note={<DeltaArrow current={latestMonth.profit} prior={priorMonth.profit} higherIsBetter />}
                    />
                    <MetricTile
                      label="Health Score" value={latestMonth.healthScore ?? "—"}
                      onClick={() => { /* scroll to the Business Health Score card above, where the full breakdown lives */ document.getElementById("health-score-card")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                      note={latestMonth.healthScore !== null && priorMonth.healthScore !== null ? <DeltaArrow current={latestMonth.healthScore} prior={priorMonth.healthScore} higherIsBetter /> : undefined}
                    />
                  </div>
                </div>
              )}

              <div className="card" style={{ marginBottom: 16 }}>
                <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Financial Position</h2>
                <div className="metric-grid">
                  <MetricTile label="Cash Balance" value={fmtMoney(dash.cashBalance)} note={<div className="metric-note">Estimate — see note below</div>} onClick={goToReports} />
                  <MetricTile
                    label="Accounts Receivable" value={fmtMoney(dash.arAging.total)} critical={dash.arAging.d90Plus > 0}
                    note={<div className="metric-note">{dash.arAging.d90Plus > 0 ? `${fmtMoney(dash.arAging.d90Plus)} over 90 days` : "None over 90 days"}</div>}
                    onClick={() => onNavigateTab("Billing")}
                  />
                  <MetricTile label="Accounts Payable" value={fmtMoney(dash.apEstimate)} note={<div className="metric-note">GL estimate — see note below</div>} onClick={goToReports} />
                  <MetricTile
                    label="Tax Liabilities" value={fmtMoney(dash.taxLiabilities)} critical={dash.taxLiabilities > 0}
                    note={<div className="metric-note">Sales/payroll tax payable, current balance</div>}
                    onClick={() => onNavigateTab("Tax Payments")}
                  />
                </div>
              </div>

              <div className="card" style={{ marginBottom: 16 }}>
                <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Ratios</h2>
                <div className="metric-grid metric-grid-3">
                  <MetricTile label="Net Profit Margin" value={fmtPct(dash.ratios.netMarginPct)} onClick={goToReports} />
                  <MetricTile label="Days Sales Outstanding" value={dash.ratios.dso === null ? "—" : dash.ratios.dso} note={<div className="metric-note">Days</div>} onClick={() => onNavigateTab("Billing")} />
                  <MetricTile label="Payroll % of Revenue" value={fmtPct(dash.ratios.payrollPctOfRevenue)} note={<div className="metric-note">{fmtMoney(dash.payrollCost)}</div>} onClick={goToReports} />
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
                        <div key={`${d.label}-${d.date}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                          <span>{d.label} — {fmtDateNumeric(d.date)}</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span className={`status-pill ${deadlinePillClass(days)}`}>{days < 0 ? "Overdue" : days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`}</span>
                            {renderMarkDoneControl(d)}
                            {renderSendToClientControl(d)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="muted" style={{ fontSize: 11, margin: "10px 0 0", lineHeight: 1.4 }}>
                    EFTPS, MD Withholding, MD UI and business-return deadlines drop off this list once they're past due — anything already overdue shows in Account Flags and the filing history above.
                  </p>
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
