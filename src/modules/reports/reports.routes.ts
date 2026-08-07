import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { decryptClientPii } from "../../common/encryption";
import { logAudit } from "../../common/audit";
import { resolveTemplate, computeClientPeriodSummaryTable } from "../templates/templates.routes";
import { NON_TAXABLE_CATEGORY_ID } from "../../common/taxRates";
import type { LedgerLine, ReportClientInfo, PayrollTaxRow, PayrollCheckRow } from "../accounting/reportsPdf";
import { getDashboardAlertSettings, updateDashboardAlertSettings } from "../clients/dashboardAlerts";
import { runMonthlyManagementSummary } from "../clients/monthlyManagementSummary";
import { computeUpcomingDeadlines } from "../clients/complianceCalendar";
import { buildXlsxBuffer } from "../../common/xlsxWriter";

/**
 * Firm-wide analytics — distinct from the existing per-client P&L/Balance
 * Sheet on ReportsPage.tsx (which reads one client's v3_gl_entries at a
 * time). This rolls revenue/expense/profit up across every client so the
 * firm can see its own numbers, not just each client's, plus the
 * firm-wide unpaid-invoice balance. Admin-only: this is the firm's own
 * financial data, not something a staff account needs cross-client
 * visibility into.
 */
export const reportsRouter = Router();

// Every report reflects live GL/sales/payroll data and is regenerated on
// every request — without this, a browser (or an intermediary proxy) can
// legitimately serve an old cached response for the exact same
// URL+querystring, silently showing stale figures (discovered via the MD
// filing penalty/interest fix: a client-side blob: URL tab stayed open with
// pre-fix numbers, easy to mistake for a fresh reload since the tab title
// gives no indication it's stale).
reportsRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

/**
 * Delegates to bucketFor (below) rather than its own substring rules — this
 * used to independently match `a.includes("sales")`, which also matched
 * "Sales Tax Payable" (a liability, not revenue) and silently inflated Firm
 * Overview's Revenue/Net Profit by however much sales tax was collected
 * that period. bucketFor already gets this right (LIABILITY_HINTS includes
 * "payable", checked before it would ever fall through to a bare "sales"
 * match), so Firm Overview now reads off the exact same classification the
 * P&L/Balance Sheet tabs already use — one ruleset, not two that can drift
 * apart.
 */
function bucketAccount(account: string): "revenue" | "expense" | "other" {
  const bucket = bucketFor(account);
  if (bucket === "income") return "revenue";
  if (bucket === "cogs" || bucket === "expense") return "expense";
  return "other";
}

/** Firm Overview's fallback window when no from/to is supplied (old bookmarked links, direct API calls) — the same "last 6 months ending today" this route always showed before from/to support existed. */
function defaultFirmSummaryRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth() - 5, 1);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/**
 * Shared by GET /firm-summary (JSON, dashboard) and the PDF/CSV export routes below, so
 * both read identical numbers. Optionally scoped to one client (clientId) — same shape,
 * just every query gets an extra client_id filter — so the "Firm Overview" tab can show
 * one client's revenue/expense/profit trend instead of the whole firm's, matching the
 * client-scoped pattern the other report tabs (P&L, Balance Sheet, Payroll) already use.
 * activeClientCount is meaningless for a single client, so it's null in that case.
 *
 * Takes an explicit from/to date range — previously this only accepted a "months back
 * from today" count, so the FROM/TO date pickers already on ReportsPage.tsx (used by
 * every other tab) were silently ignored here: picking Jan–Jun always still showed
 * whatever the last 6 calendar months happened to be. Capped at 36 months walked so an
 * accidental far-past `from` can't build an enormous table.
 */
// Exported so src/modules/clients/clients.routes.ts's SWOT auto-draft (computeSwotAutoDraft)
// can reuse the exact same revenue/expense/profit numbers the "At a Glance" Financial
// Snapshot and Reports' Financial Overview already show, instead of a second computation
// that could drift out of sync with what's on screen.
export async function computeFirmSummary(from: string, to: string, clientId?: string) {
  const startDate = new Date(`${from}T00:00:00`);
  const endDate = new Date(`${to}T00:00:00`);
  const startMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  const glRows = await query<any>(
    `SELECT to_char(entry_date, 'YYYY-MM') AS month, account, debit, credit
       FROM altax.v3_gl_entries
      WHERE entry_date >= $1::date AND entry_date <= $2::date ${clientId ? "AND client_id = $3" : ""}`,
    clientId ? [from, to, clientId] : [from, to]
  );

  const byMonth = new Map<string, { revenue: number; expenses: number }>();
  for (const row of glRows) {
    const month = row.month;
    if (!month) continue;
    const entry = byMonth.get(month) || { revenue: 0, expenses: 0 };
    const bucket = bucketAccount(row.account);
    if (bucket === "revenue") entry.revenue += Number(row.credit || 0) - Number(row.debit || 0);
    if (bucket === "expense") entry.expenses += Number(row.debit || 0) - Number(row.credit || 0);
    byMonth.set(month, entry);
  }

  const months: { month: string; revenue: number; expenses: number; profit: number }[] = [];
  const cursor = new Date(startMonth);
  let guard = 0;
  while (cursor <= endMonth && guard < 36) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const entry = byMonth.get(key) || { revenue: 0, expenses: 0 };
    months.push({ month: key, revenue: Math.round(entry.revenue * 100) / 100, expenses: Math.round(entry.expenses * 100) / 100, profit: Math.round((entry.revenue - entry.expenses) * 100) / 100 });
    cursor.setMonth(cursor.getMonth() + 1);
    guard++;
  }

  const totals = months.reduce((acc, m) => ({ revenue: acc.revenue + m.revenue, expenses: acc.expenses + m.expenses, profit: acc.profit + m.profit }), { revenue: 0, expenses: 0, profit: 0 });

  const unpaidRow = await queryOne<any>(
    `SELECT COALESCE(SUM(balance_due), 0) AS unpaid, COUNT(*)::int AS count
       FROM altax.v3_invoices WHERE status NOT IN ('Paid', 'Void') ${clientId ? "AND client_id = $1" : ""}`,
    clientId ? [clientId] : []
  );
  const activeClientsRow = clientId
    ? null
    : await queryOne<any>(`SELECT COUNT(*)::int AS count FROM altax.v3_clients WHERE lower(status) NOT IN ('archived', 'inactive')`);

  // Legacy's dashboard read this from a manually-typed spreadsheet cell (dashSheet!I4),
  // not a formula — there was nothing to port 1:1. Computed here instead as the real
  // outstanding balance of the firm's tax/payroll liability accounts (all-time balance
  // owed, not scoped to the months window above, since it's a point-in-time liability).
  const taxLiabilitiesRow = await queryOne<any>(
    `SELECT COALESCE(SUM(credit - debit), 0) AS balance
       FROM altax.v3_gl_entries
      WHERE account IN ('Sales Tax Payable', 'Payroll Tax Payable', 'Payroll Deduction Payable') ${clientId ? "AND client_id = $1" : ""}`,
    clientId ? [clientId] : []
  );

  return {
    months,
    totals: { revenue: Math.round(totals.revenue * 100) / 100, expenses: Math.round(totals.expenses * 100) / 100, profit: Math.round(totals.profit * 100) / 100 },
    unpaidBalance: Number(unpaidRow?.unpaid || 0),
    unpaidInvoiceCount: Number(unpaidRow?.count || 0),
    activeClientCount: activeClientsRow ? Number(activeClientsRow.count || 0) : null,
    taxLiabilities: Math.round(Number(taxLiabilitiesRow?.balance || 0) * 100) / 100,
  };
}

reportsRouter.get("/firm-summary", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { from, to } = defaultFirmSummaryRange();
  const rangeFrom = String(req.query.from || "").slice(0, 10) || from;
  const rangeTo = String(req.query.to || "").slice(0, 10) || to;
  const clientId = req.query.clientId ? String(req.query.clientId) : undefined;
  res.json(await computeFirmSummary(rangeFrom, rangeTo, clientId));
}));

/**
 * Same computeFirmSummary a client scoped down to just this one client — powers
 * the "Financial Snapshot" on Client Detail's "At a Glance" tab. Admin-only,
 * matching every other route in this file that surfaces this revenue/expense
 * data (Financial Overview and AR Aging are both admin-only too) — the
 * frontend only calls this when the logged-in user is an admin, so a staff
 * session never even attempts it.
 */
reportsRouter.get("/client-summary/:clientId", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const { from, to } = defaultFirmSummaryRange();
  const rangeFrom = String(req.query.from || "").slice(0, 10) || from;
  const rangeTo = String(req.query.to || "").slice(0, 10) || to;
  res.json(await computeFirmSummary(rangeFrom, rangeTo, clientId));
}));

/**
 * The actual client-facing deliverable for the SWOT/business-advisory
 * analysis (ClientSwotSection.tsx) — a printable PDF a staff member can
 * hand or email to the client, not just the internal edit screen. Pulls
 * the client's v3_client_swot row (empty fields render as omitted
 * sections in the PDF, not blank placeholders) plus, for an admin caller
 * only, the same financial snapshot the "At a Glance" tab shows — matching
 * that tab's own admin-only restriction on this data.
 */
reportsRouter.get("/pdf/client-swot/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });

  const swotRow = await queryOne<any>(`SELECT * FROM altax.v3_client_swot WHERE client_id = $1`, [client.clientId]);
  const findingRows = await query<any>(`SELECT category, finding_text, priority, status, recommended_action, responsible_party, target_date FROM altax.v3_swot_findings WHERE client_id = $1`, [client.clientId]);
  const isAdmin = req.user!.role === "admin";
  let financials: { totals: { revenue: number; expenses: number; profit: number }; unpaidBalance: number; taxLiabilities: number } | null = null;
  if (isAdmin) {
    const { from, to } = defaultFirmSummaryRange();
    const summary = await computeFirmSummary(from, to, client.clientId);
    financials = { totals: summary.totals, unpaidBalance: summary.unpaidBalance, taxLiabilities: summary.taxLiabilities };
  }

  const { generateClientSwotPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generateClientSwotPdf({
    client, asOfLabel: `As of ${new Date().toLocaleDateString()}`, preparedBy: req.user!.email, financials,
    overview: swotRow?.overview || "", strengths: swotRow?.strengths || "", weaknesses: swotRow?.weaknesses || "",
    opportunities: swotRow?.opportunities || "", threats: swotRow?.threats || "",
    taxRecommendations: swotRow?.tax_recommendations || "", staffingRecommendations: swotRow?.staffing_recommendations || "",
    marketingRecommendations: swotRow?.marketing_recommendations || "", growthRecommendations: swotRow?.growth_recommendations || "",
    additionalNotes: swotRow?.additional_notes || "",
    findings: findingRows.map((f: any) => ({
      category: f.category, findingText: f.finding_text, priority: f.priority, status: f.status,
      recommendedAction: f.recommended_action, responsibleParty: f.responsible_party,
      targetDate: f.target_date ? new Date(f.target_date).toISOString().slice(0, 10) : null,
    })),
  });

  await logAudit("Reports", "GENERATE_CLIENT_SWOT_PDF", client.clientId, "", "", "", `Business advisory report generated by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="BusinessAdvisory_${client.clientId}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

reportsRouter.get("/pdf/firm-overview", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { from, to } = defaultFirmSummaryRange();
  const rangeFrom = String(req.query.from || "").slice(0, 10) || from;
  const rangeTo = String(req.query.to || "").slice(0, 10) || to;
  const clientId = req.query.clientId ? String(req.query.clientId) : undefined;
  const summary = await computeFirmSummary(rangeFrom, rangeTo, clientId);
  let clientName: string | undefined;
  if (clientId) {
    const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
    clientName = client?.client_name || clientId;
  }

  const { generateFirmOverviewPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generateFirmOverviewPdf({ from: rangeFrom, to: rangeTo, ...summary, clientName });

  await logAudit("Reports", "GENERATE_FIRM_OVERVIEW_PDF", clientId || "Firm", "Period", "", `${rangeFrom} to ${rangeTo}`, `${clientName ? `${clientName} overview` : "Firm Overview"} PDF generated by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${clientName ? `Overview_${clientId}` : "FirmOverview"}_${rangeFrom}_${rangeTo}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

reportsRouter.get("/csv/firm-overview", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { from, to } = defaultFirmSummaryRange();
  const rangeFrom = String(req.query.from || "").slice(0, 10) || from;
  const rangeTo = String(req.query.to || "").slice(0, 10) || to;
  const clientId = req.query.clientId ? String(req.query.clientId) : undefined;
  const summary = await computeFirmSummary(rangeFrom, rangeTo, clientId);
  const headers = ["Month", "Revenue", "Expenses", "Profit"];
  const rows = summary.months.map((m) => [m.month, m.revenue.toFixed(2), m.expenses.toFixed(2), m.profit.toFixed(2)]);

  await logAudit("Reports", "EXPORT_FIRM_OVERVIEW_CSV", clientId || "Firm", "Period", "", `${rangeFrom} to ${rangeTo}`, `${clientId ? "Client" : "Firm"} Overview ${String(req.query.format || "").toLowerCase() === "xlsx" ? "Excel" : "CSV"} exported by ${req.user!.email}.`, req.user!.email);
  sendTabular(req, res, "Overview", headers, rows, `${clientId ? `Overview_${clientId}` : "FirmOverview"}_${rangeFrom}_${rangeTo}`);
}));

/**
 * AR Aging — which clients owe the firm money and how overdue. Every open
 * (not Paid/Void) invoice's balance_due is bucketed off today - due_date,
 * grouped by client. AP aging (what the firm owes) is out of scope: this
 * app has no vendor-bills concept — only GL liability account balances,
 * which have no per-bill due date to bucket against — so AP aging would
 * need a whole new module, not this report.
 *
 * Admin-only (see the 3 routes below), same as /firm-summary just above —
 * this is firm-wide financial data with no per-client filter or
 * canAccessClient check, so a staff account without every client assigned
 * would otherwise see every client's name and balance regardless of their
 * own task-based assignments.
 */
// Optional clientId param added for computeClientArAging below (the per-client
// dashboard) — the firm-wide /ar-aging, /pdf/ar-aging, /csv/ar-aging routes
// below call this with no clientId, unchanged behavior.
async function computeArAging(clientId?: string) {
  const rows = await query<any>(
    `SELECT i.client_id, c.client_name,
            i.balance_due, i.due_date,
            (CURRENT_DATE - i.due_date::date) AS days_overdue
       FROM altax.v3_invoices i
       JOIN altax.v3_clients c ON c.client_id = i.client_id
      WHERE i.status NOT IN ('Paid', 'Void') AND i.balance_due > 0 ${clientId ? "AND i.client_id = $1" : ""}
      ORDER BY c.client_name ASC`,
    clientId ? [clientId] : []
  );

  const byClient = new Map<string, { clientId: string; clientName: string; current: number; d1_30: number; d31_60: number; d61_90: number; d90Plus: number; total: number }>();
  for (const r of rows) {
    const bal = Number(r.balance_due || 0);
    if (bal <= 0) continue;
    const days = r.due_date ? Number(r.days_overdue || 0) : -1; // no due date at all reads as not-yet-due (Current)
    const entry = byClient.get(r.client_id) || { clientId: r.client_id, clientName: r.client_name, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90Plus: 0, total: 0 };
    if (days <= 0) entry.current += bal;
    else if (days <= 30) entry.d1_30 += bal;
    else if (days <= 60) entry.d31_60 += bal;
    else if (days <= 90) entry.d61_90 += bal;
    else entry.d90Plus += bal;
    entry.total += bal;
    byClient.set(r.client_id, entry);
  }

  const clientRows = [...byClient.values()].sort((a, b) => b.total - a.total);
  const totals = clientRows.reduce(
    (acc, r) => ({
      current: acc.current + r.current, d1_30: acc.d1_30 + r.d1_30, d31_60: acc.d31_60 + r.d31_60,
      d61_90: acc.d61_90 + r.d61_90, d90Plus: acc.d90Plus + r.d90Plus, total: acc.total + r.total,
    }),
    { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90Plus: 0, total: 0 }
  );
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    asOf: new Date().toISOString().slice(0, 10),
    rows: clientRows.map((r) => ({ ...r, current: round2(r.current), d1_30: round2(r.d1_30), d31_60: round2(r.d31_60), d61_90: round2(r.d61_90), d90Plus: round2(r.d90Plus), total: round2(r.total) })),
    totals: { current: round2(totals.current), d1_30: round2(totals.d1_30), d31_60: round2(totals.d31_60), d61_90: round2(totals.d61_90), d90Plus: round2(totals.d90Plus), total: round2(totals.total) },
  };
}

/** Same aging buckets as computeArAging, scoped to one client, defaulting to all-zero when the client has no overdue invoices — used by the client dashboard so a clean client isn't treated as "no data." Exported for the monthly snapshot sweep (monthlySnapshot.ts). */
export async function computeClientArAging(clientId: string) {
  const { rows } = await computeArAging(clientId);
  return rows[0] || { clientId, clientName: "", current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90Plus: 0, total: 0 };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
function fmtMoney(v: number): string {
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Revenue trend shared by the SWOT auto-draft engine (clients.routes.ts) and
 * the dashboard health score below — first-half vs. second-half average of
 * whatever month window is passed in, so a single unusual month can't flip
 * the read the way month-over-month would. A jump from $0 in the first half
 * to any amount in the second isn't really a "100% increase," so that case
 * gets its own startedFromZero flag instead of a misleading percentage.
 */
export function computeRevenueTrend(months: { revenue: number }[]): { trendPct: number | null; startedFromZero: boolean } {
  if (months.length < 2) return { trendPct: null, startedFromZero: false };
  const mid = Math.floor(months.length / 2);
  const avg = (arr: typeof months) => arr.reduce((s, m) => s + m.revenue, 0) / arr.length;
  const firstAvg = avg(months.slice(0, mid));
  const secondAvg = avg(months.slice(mid));
  if (firstAvg > 0) return { trendPct: Math.round(((secondAvg - firstAvg) / firstAvg) * 100), startedFromZero: false };
  if (secondAvg > 0) return { trendPct: null, startedFromZero: true };
  return { trendPct: null, startedFromZero: false };
}

const CASH_HINTS = ["cash", "bank", "checking", "savings"];

/**
 * Estimated cash position — sums recorded GL activity (debit - credit) on
 * every Asset-type COA account that looks like a bank/cash account (by
 * detail_type or account name, the same hint-matching style bucketFor
 * already uses for P&L/Balance Sheet). This is derived from ledger entries,
 * not a real bank feed — opening balances or activity never entered as a GL
 * entry aren't included, so it's always labeled "estimate" wherever shown
 * (ClientAtAGlance.tsx, the SWOT PDF, and the health score).
 */
export async function computeClientCashBalance(clientId: string): Promise<number> {
  const accounts = await query<any>(`SELECT account_name, detail_type FROM altax.v3_coa WHERE active = true AND account_type = 'Asset'`);
  const cashAccounts = accounts
    .filter((a: any) => {
      const name = String(a.account_name || "").toLowerCase();
      const detail = String(a.detail_type || "").toLowerCase();
      return CASH_HINTS.some((h) => name.includes(h) || detail.includes(h));
    })
    .map((a: any) => a.account_name);
  if (cashAccounts.length === 0) return 0;
  const row = await queryOne<any>(
    `SELECT COALESCE(SUM(debit - credit), 0) AS balance FROM altax.v3_gl_entries WHERE client_id = $1 AND account = ANY($2::text[])`,
    [clientId, cashAccounts]
  );
  return round2(Number(row?.balance || 0));
}

// Excluded here since computeFirmSummary's taxLiabilities already breaks these
// three out separately — counting them again here would double-count the same
// liability under two different dashboard tiles.
const AP_EXCLUDED_ACCOUNTS = ["Sales Tax Payable", "Payroll Tax Payable", "Payroll Deduction Payable"];

/**
 * Estimated accounts payable — GL balance (credit - debit) of Liability
 * accounts whose name contains "payable", excluding the tax/payroll
 * liabilities already shown separately. This app has no vendor-bills
 * subledger (no per-bill due date), so this is always labeled "GL balance —
 * estimate" wherever it's shown, never presented as true AP aging.
 */
export async function computeClientApEstimate(clientId: string): Promise<number> {
  const accounts = await query<any>(
    `SELECT account_name FROM altax.v3_coa WHERE active = true AND account_type = 'Liability' AND account_name ILIKE '%payable%'`
  );
  const apAccounts = accounts.map((a: any) => a.account_name).filter((n: string) => !AP_EXCLUDED_ACCOUNTS.includes(n));
  if (apAccounts.length === 0) return 0;
  const row = await queryOne<any>(
    `SELECT COALESCE(SUM(credit - debit), 0) AS balance FROM altax.v3_gl_entries WHERE client_id = $1 AND account = ANY($2::text[])`,
    [clientId, apAccounts]
  );
  return round2(Number(row?.balance || 0));
}

/** COGS total for the window — computeFirmSummary doesn't split this out (it only needs revenue/expense for the P&L trend), so Gross Margin gets its own small query using the same bucketFor classification the rest of this file already uses. Exported for the monthly snapshot sweep. */
export async function computeClientCogs(clientId: string, from: string, to: string): Promise<number> {
  const rows = await query<any>(
    `SELECT account, COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit
       FROM altax.v3_gl_entries
      WHERE client_id = $1 AND entry_date::date >= $2::date AND entry_date::date <= $3::date
      GROUP BY account`,
    [clientId, from, to]
  );
  const cogs = rows.filter((r: any) => bucketFor(r.account) === "cogs").reduce((s: number, r: any) => s + (Number(r.debit) || 0) - (Number(r.credit) || 0), 0);
  return round2(cogs);
}

export interface ClientRatios {
  netMarginPct: number | null;
  grossMarginPct: number | null;
  dso: number | null;
  ar90PlusPct: number | null;
  payrollPctOfRevenue: number | null;
  taxLiabilityPctOfRevenue: number | null;
}

/**
 * Only ratios this data honestly supports. Current Ratio / Quick Ratio /
 * Debt-to-Equity are deliberately not computed anywhere in this app — there's
 * no complete current-liabilities or equity picture (AP is a GL estimate with
 * no bill-level detail, see computeClientApEstimate), and a ratio built on a
 * partial balance sheet is worse than no ratio at all.
 */
export function computeClientRatios(params: {
  revenue: number; profit: number; cogs: number;
  arTotal: number; ar90Plus: number;
  payrollCost: number; taxLiabilities: number;
  periodDays: number;
}): ClientRatios {
  const { revenue, profit, cogs, arTotal, ar90Plus, payrollCost, taxLiabilities, periodDays } = params;
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
  return {
    netMarginPct: pct(profit, revenue),
    grossMarginPct: pct(revenue - cogs, revenue),
    dso: revenue > 0 && periodDays > 0 ? Math.round((arTotal / (revenue / periodDays)) * 10) / 10 : null,
    ar90PlusPct: pct(ar90Plus, arTotal),
    payrollPctOfRevenue: pct(payrollCost, revenue),
    taxLiabilityPctOfRevenue: pct(taxLiabilities, revenue),
  };
}

export interface HealthScoreComponent { label: string; points: number; maxPoints: number; detail: string }
export interface ClientHealthScore { score: number; band: "Green" | "Yellow" | "Red"; components: HealthScoreComponent[] }

/**
 * Transparent 0-100 point score — always rendered with its component
 * breakdown (frontend never shows the bare number), so staff can point to
 * exactly which line cost points and explain it to a client rather than
 * treating it as a black box.
 */
export function computeClientHealthScore(params: {
  netMarginPct: number | null;
  trendPct: number | null;
  arD61_90: number; arD90Plus: number; arTotal: number;
  taxLiabilities: number; revenue: number;
  openTasks: number;
  mdFilingOnTime: boolean | null;
}): ClientHealthScore {
  const components: HealthScoreComponent[] = [];

  let profPts = 0;
  let profDetail = "No revenue recorded in this window.";
  if (params.netMarginPct !== null) {
    if (params.netMarginPct >= 15) { profPts = 30; profDetail = `Net margin ${params.netMarginPct}% (healthy, ≥15%).`; }
    else if (params.netMarginPct >= 5) { profPts = 20; profDetail = `Net margin ${params.netMarginPct}% (moderate, 5-15%).`; }
    else if (params.netMarginPct >= 0) { profPts = 10; profDetail = `Net margin ${params.netMarginPct}% (thin, 0-5%).`; }
    else { profPts = 0; profDetail = `Net margin ${params.netMarginPct}% (net loss).`; }
  }
  components.push({ label: "Profitability", points: profPts, maxPoints: 30, detail: profDetail });

  let trendPts = 12;
  let trendDetail = "Revenue roughly flat over the period.";
  if (params.trendPct !== null) {
    if (params.trendPct >= 10) { trendPts = 20; trendDetail = `Revenue up ${params.trendPct}% over the period.`; }
    else if (params.trendPct <= -10) { trendPts = 0; trendDetail = `Revenue down ${Math.abs(params.trendPct)}% over the period.`; }
    else { trendPts = 12; trendDetail = `Revenue roughly flat (${params.trendPct >= 0 ? "+" : ""}${params.trendPct}%).`; }
  }
  components.push({ label: "Revenue Trend", points: trendPts, maxPoints: 20, detail: trendDetail });

  let arPts = 15;
  let arDetail = "No overdue receivables.";
  if (params.arD90Plus > 0) { arPts = 0; arDetail = `${fmtMoney(params.arD90Plus)} over 90 days past due.`; }
  else if (params.arD61_90 > 0) { arPts = 5; arDetail = `${fmtMoney(params.arD61_90)} in the 61-90 day bucket.`; }
  else if (params.arTotal > 0) { arPts = 10; arDetail = `${fmtMoney(params.arTotal)} overdue, within 60 days.`; }
  components.push({ label: "AR Aging", points: arPts, maxPoints: 15, detail: arDetail });

  let taxPts = 15;
  let taxDetail = "No outstanding tax liability.";
  if (params.taxLiabilities > 0) {
    const pctOfRev = params.revenue > 0 ? (params.taxLiabilities / params.revenue) * 100 : 100;
    if (pctOfRev < 5) { taxPts = 8; taxDetail = `${fmtMoney(params.taxLiabilities)} outstanding (<5% of revenue).`; }
    else { taxPts = 0; taxDetail = `${fmtMoney(params.taxLiabilities)} outstanding (≥5% of revenue).`; }
  }
  components.push({ label: "Tax Liability", points: taxPts, maxPoints: 15, detail: taxDetail });

  let taskPts = 10;
  let taskDetail = "No open tasks.";
  if (params.openTasks >= 4) { taskPts = 0; taskDetail = `${params.openTasks} open tasks.`; }
  else if (params.openTasks >= 1) { taskPts = 6; taskDetail = `${params.openTasks} open task${params.openTasks === 1 ? "" : "s"}.`; }
  components.push({ label: "Task Backlog", points: taskPts, maxPoints: 10, detail: taskDetail });

  let compPts = 10;
  let compDetail = "Not applicable (non-MD client or no filing period in range).";
  if (params.mdFilingOnTime === true) { compPts = 10; compDetail = "Sales tax filings on time."; }
  else if (params.mdFilingOnTime === false) { compPts = 0; compDetail = "One or more sales tax filings currently show as late."; }
  components.push({ label: "Compliance", points: compPts, maxPoints: 10, detail: compDetail });

  const score = components.reduce((s, c) => s + c.points, 0);
  const band: "Green" | "Yellow" | "Red" = score >= 75 ? "Green" : score >= 50 ? "Yellow" : "Red";
  return { score, band, components };
}

reportsRouter.get("/ar-aging", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json(await computeArAging());
}));

reportsRouter.get("/pdf/ar-aging", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = await computeArAging();
  const { generateArAgingPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generateArAgingPdf(data);
  await logAudit("Reports", "GENERATE_AR_AGING_PDF", "Firm", "", "", data.asOf, `AR Aging PDF generated by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="AR_Aging_${data.asOf}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

reportsRouter.get("/csv/ar-aging", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = await computeArAging();
  const headers = ["Client", "Current", "1-30 Days", "31-60 Days", "61-90 Days", "90+ Days", "Total"];
  const rows = data.rows.map((r) => [r.clientName, r.current.toFixed(2), r.d1_30.toFixed(2), r.d31_60.toFixed(2), r.d61_90.toFixed(2), r.d90Plus.toFixed(2), r.total.toFixed(2)]);
  await logAudit("Reports", "EXPORT_AR_AGING_CSV", "Firm", "", "", data.asOf, `AR Aging ${String(req.query.format || "").toLowerCase() === "xlsx" ? "Excel" : "CSV"} exported by ${req.user!.email}.`, req.user!.email);
  sendTabular(req, res, "AR Aging", headers, rows, `AR_Aging_${data.asOf}`);
}));

/**
 * Per-client report PDFs + CSV exports (P&L, Balance Sheet, Payroll,
 * Client Message) — the print/download buttons on ReportsPage.tsx's
 * per-client tabs. Bucketing logic below intentionally mirrors
 * ReportsPage.tsx's client-side INCOME_TYPES/COGS_TYPES/EXPENSE_HINTS/
 * ASSET_HINTS/LIABILITY_HINTS exactly, so the PDF a preparer downloads
 * always matches what's on screen — this is the backend's own independent
 * computation from v3_gl_entries, not a re-post of frontend-computed
 * numbers, matching how every other PDF in this app (paychecks, invoices,
 * tax forms) is generated authoritatively server-side.
 */
const INCOME_TYPES = ["Sales Revenue", "Income", "Revenue"];
const COGS_TYPES = ["COGS", "Cost of Goods Sold"];
const EXPENSE_HINTS = ["expense", "payroll tax", "office"];
const ASSET_HINTS = ["cash", "asset", "bank", "receivable"];
const LIABILITY_HINTS = ["payable", "liability", "tax payable"];

function bucketFor(account: string): "income" | "cogs" | "expense" | "asset" | "liability" | "other" {
  const a = String(account || "").toLowerCase();
  if (INCOME_TYPES.some((t) => a.includes(t.toLowerCase()))) return "income";
  if (COGS_TYPES.some((t) => a.includes(t.toLowerCase()))) return "cogs";
  if (LIABILITY_HINTS.some((t) => a.includes(t))) return "liability";
  if (ASSET_HINTS.some((t) => a.includes(t))) return "asset";
  if (EXPENSE_HINTS.some((t) => a.includes(t))) return "expense";
  return "other";
}

async function loadClientInfo(req: AuthedRequest, clientId: string): Promise<ReportClientInfo | null> {
  if (!(await canAccessClient(req.user!, clientId))) return null;
  const client = decryptClientPii(await queryOne<any>(`SELECT client_id, client_name, ein, address, state, sales_tax_frequency FROM altax.v3_clients WHERE client_id = $1`, [clientId]));
  if (!client) return null;
  return {
    clientId: client.client_id, clientName: client.client_name, ein: client.ein, address: client.address, state: client.state,
    salesTaxFrequency: client.sales_tax_frequency,
  };
}

/**
 * Maryland Form 202 Line 18/37 discount/penalty/interest for EVERY real
 * filing period inside the report's [from, to] range — null for any other
 * state, or when no period in range has tax due to discount/penalize in
 * the first place. A report spanning several months no longer collapses
 * into one blended (and often wrong) due date; see
 * computeMdFilingBreakdown's own doc comment for why splitting by the
 * client's stored sales_tax_frequency matters. Paid date defaults to today
 * (the report's generation date) unless the caller passed an explicit
 * override (the Sales & Tax tab's own editable date field) — one payment
 * date compared against each period's own due date, matching the real
 * case of a client catching up several periods with a single payment.
 *
 * Fetches its OWN sales data over each period's true [start, end] rather
 * than reusing the report's [from, to] sales — those are two different
 * things. A period's real tax liability is everything filed for that
 * whole period, not just the slice of it inside the requested report
 * window (the default Sales & Tax view is "1st of this month to today,"
 * which almost never lines up with a Quarterly/Semiannual/Annual
 * boundary). Widening only this query — not the rest of the report —
 * keeps "Tax by Category"/"Sales" honestly scoped to what was asked for
 * while making the MD filing box always reflect the real due amount.
 */
// Exported for the same reason as computeFirmSummary above — the SWOT auto-draft
// (clients.routes.ts) reuses this for its "current period" MD filing status signal
// instead of re-deriving it, so it can never disagree with the reports/At a Glance figures.
export async function computeMdFilingForReport(
  client: ReportClientInfo,
  from: string,
  to: string,
  paidDateOverride?: string
) {
  if (client.state !== "MD") return null;
  const { splitIntoMdFilingPeriods, computeMdFilingBreakdown } = await import("../../common/mdFiling");
  const { periods } = splitIntoMdFilingPeriods(from, to, client.salesTaxFrequency);
  if (periods.length === 0) return null;
  const expandedFrom = periods[0].start;
  const expandedTo = periods[periods.length - 1].end;
  const sales = await loadSalesDatesAndTaxForPeriod(client.clientId, expandedFrom, expandedTo);
  const paidDate = paidDateOverride && /^\d{4}-\d{2}-\d{2}$/.test(paidDateOverride) ? paidDateOverride : new Date().toISOString().slice(0, 10);
  const breakdown = await computeMdFilingBreakdown(sales, from, to, client.salesTaxFrequency, paidDate);
  if (breakdown.periods.length === 0) return null;
  return { ...breakdown, paidDate };
}

async function loadBucketedGl(clientId: string, from: string, to: string) {
  const rows = await query<any>(
    `SELECT account, COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit
       FROM altax.v3_gl_entries
      WHERE client_id = $1 AND entry_date::date >= $2::date AND entry_date::date <= $3::date
      GROUP BY account ORDER BY account`,
    [clientId, from, to]
  );
  const lines: LedgerLine[] = rows.map((r: any) => ({ account: r.account || "Unclassified", debit: Number(r.debit) || 0, credit: Number(r.credit) || 0 }));
  return {
    income: lines.filter((l) => bucketFor(l.account) === "income"),
    cogs: lines.filter((l) => bucketFor(l.account) === "cogs"),
    expenses: lines.filter((l) => bucketFor(l.account) === "expense" || bucketFor(l.account) === "other"),
    assets: lines.filter((l) => bucketFor(l.account) === "asset"),
    liabilities: lines.filter((l) => bucketFor(l.account) === "liability"),
    all: lines,
  };
}

// Exported so the SWOT findings engine (swotFindingsEngine.ts) can compare
// this month's payroll cost to last month's for its payroll-cost-spike rule,
// reusing the exact same totalCost figure the Payroll report already shows.
export async function loadPayrollForPeriod(clientId: string, from: string, to: string, employee?: string) {
  const rows = await query<any>(
    `SELECT paycheck_id, pay_date, employee, gross_wages, employee_taxes, employer_taxes, net_pay, total_cost,
            federal_withholding, social_security_ee, social_security_er, medicare_ee, medicare_er, state_tax, suta, futa
       FROM altax.v3_paychecks
      WHERE client_id = $1 AND pay_date::date >= $2::date AND pay_date::date <= $3::date AND lower(status) <> 'void'
            ${employee ? "AND lower(employee) = lower($4)" : ""}
      ORDER BY pay_date`,
    employee ? [clientId, from, to, employee] : [clientId, from, to]
  );
  const sum = (col: string) => rows.reduce((s: number, r: any) => s + (Number(r[col]) || 0), 0);
  const taxRows: PayrollTaxRow[] = [
    { label: "Federal Withholding", employee: sum("federal_withholding"), employer: 0 },
    { label: "Social Security", employee: sum("social_security_ee"), employer: sum("social_security_er") },
    { label: "Medicare", employee: sum("medicare_ee"), employer: sum("medicare_er") },
    { label: "MD Withholding", employee: sum("state_tax"), employer: 0 },
    { label: "MD Unemployment (SUTA)", employee: 0, employer: sum("suta") },
    { label: "Federal Unemployment (FUTA)", employee: 0, employer: sum("futa") },
  ];
  const checks: PayrollCheckRow[] = rows.map((r: any) => ({ payDate: r.pay_date, employee: r.employee, gross: Number(r.gross_wages) || 0, net: Number(r.net_pay) || 0 }));
  return {
    grossWages: sum("gross_wages"), checkCount: rows.length, employeeTaxes: sum("employee_taxes"),
    employerTaxes: sum("employer_taxes"), netPay: sum("net_pay"), totalCost: sum("total_cost"),
    taxRows, checks,
  };
}

/** Same period's paychecks as loadPayrollForPeriod, grouped by employee instead of left flat — powers the Employee report's all-employees summary table. */
async function loadEmployeeSummaryForPeriod(clientId: string, from: string, to: string) {
  const rows = await query<any>(
    `SELECT employee, COUNT(*) AS check_count, COALESCE(SUM(gross_wages), 0) AS gross_wages,
            COALESCE(SUM(employee_taxes), 0) AS employee_taxes, COALESCE(SUM(employer_taxes), 0) AS employer_taxes,
            COALESCE(SUM(net_pay), 0) AS net_pay, COALESCE(SUM(total_cost), 0) AS total_cost
       FROM altax.v3_paychecks
      WHERE client_id = $1 AND pay_date::date >= $2::date AND pay_date::date <= $3::date AND lower(status) <> 'void'
      GROUP BY employee ORDER BY employee`,
    [clientId, from, to]
  );
  return rows.map((r: any) => ({
    employee: r.employee, checkCount: Number(r.check_count) || 0, grossWages: Number(r.gross_wages) || 0,
    employeeTaxes: Number(r.employee_taxes) || 0, employerTaxes: Number(r.employer_taxes) || 0,
    netPay: Number(r.net_pay) || 0, totalCost: Number(r.total_cost) || 0,
  }));
}

/**
 * Single aggregated fetch backing the redesigned "At a Glance" dashboard —
 * composes computeFirmSummary + cash/AP estimates + client AR aging +
 * ratios + health score + current-month budget-vs-actual + payroll cost +
 * upcoming deadlines into one response instead of 6+ separate round trips.
 * Admin-only, matching every other financial route in this file
 * (Financial Overview, AR Aging, client-summary) — staff still see
 * operations-only data via the existing /clients/:clientId/summary route.
 */
reportsRouter.get("/client-dashboard/:clientId", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const clientRow = await queryOne<any>(
    `SELECT client_id, client_name, ein, address, state, sales_tax_frequency, payroll_enabled FROM altax.v3_clients WHERE client_id = $1`,
    [clientId]
  );
  if (!clientRow) return res.status(404).json({ error: "Client not found." });
  const reportClient: ReportClientInfo = {
    clientId: clientRow.client_id, clientName: clientRow.client_name, ein: clientRow.ein,
    address: clientRow.address, state: clientRow.state, salesTaxFrequency: clientRow.sales_tax_frequency,
  };

  const { from, to } = defaultFirmSummaryRange();

  const [financials, cashBalance, apEstimate, arAging, cogs, openTasksRow, payroll, mdFiling] = await Promise.all([
    computeFirmSummary(from, to, clientId),
    computeClientCashBalance(clientId),
    computeClientApEstimate(clientId),
    computeClientArAging(clientId),
    computeClientCogs(clientId, from, to),
    queryOne<any>(`SELECT COUNT(*)::int AS count FROM altax.v3_tasks WHERE client_id = $1 AND lower(status) NOT IN ('completed','void','closed','archived')`, [clientId]),
    loadPayrollForPeriod(clientId, from, to),
    computeMdFilingForReport(reportClient, from, to),
  ]);

  const openTasks = openTasksRow?.count || 0;
  const periodDays = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1);
  const ratios = computeClientRatios({
    revenue: financials.totals.revenue, profit: financials.totals.profit, cogs,
    arTotal: arAging.total, ar90Plus: arAging.d90Plus,
    payrollCost: payroll.totalCost, taxLiabilities: financials.taxLiabilities,
    periodDays,
  });
  const { trendPct } = computeRevenueTrend(financials.months);
  const mdFilingOnTime = clientRow.state === "MD" && mdFiling && mdFiling.periods.length > 0
    ? mdFiling.periods.every((p: any) => p.onTime)
    : null;
  const health = computeClientHealthScore({
    netMarginPct: ratios.netMarginPct, trendPct,
    arD61_90: arAging.d61_90, arD90Plus: arAging.d90Plus, arTotal: arAging.total,
    taxLiabilities: financials.taxLiabilities, revenue: financials.totals.revenue,
    openTasks, mdFilingOnTime,
  });

  // Budget vs actual for the current month only — the dashboard's mini-table;
  // full-year detail stays on the dedicated Budget tab (budgets.routes.ts).
  const now = new Date();
  const budgetAccounts = await query<any>(
    `SELECT account_name, account_type FROM altax.v3_coa WHERE active = true AND account_type = ANY($1::text[])`,
    [["Income", "COGS", "Expense"]]
  );
  const budgetRows = await query<any>(
    `SELECT account_name, amount FROM altax.v3_budgets WHERE client_id = $1 AND year = $2 AND month = $3`,
    [clientId, now.getFullYear(), now.getMonth() + 1]
  );
  const actualRows = await query<any>(
    `SELECT account, COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit
       FROM altax.v3_gl_entries
      WHERE client_id = $1 AND EXTRACT(YEAR FROM entry_date) = $2 AND EXTRACT(MONTH FROM entry_date) = $3
      GROUP BY account`,
    [clientId, now.getFullYear(), now.getMonth() + 1]
  );
  const typeByAccount = new Map<string, string>(budgetAccounts.map((a: any) => [a.account_name, a.account_type]));
  const budgetVsActual = budgetRows.map((b: any) => {
    const actualRow = actualRows.find((r: any) => r.account === b.account_name);
    const isIncome = typeByAccount.get(b.account_name) === "Income";
    const actual = actualRow ? (isIncome ? Number(actualRow.credit) - Number(actualRow.debit) : Number(actualRow.debit) - Number(actualRow.credit)) : 0;
    return { accountName: b.account_name, budget: Number(b.amount), actual: round2(actual), variance: round2(actual - Number(b.amount)) };
  }).sort((a: any, b: any) => Math.abs(b.variance) - Math.abs(a.variance));

  // Upcoming deadlines — every source this app can actually compute,
  // aggregated by computeUpcomingDeadlines (complianceCalendar.ts): MD
  // filing (current period only, per this codebase's documented
  // limitation — no persisted per-period filing history exists), the
  // client's nearest scheduled payroll date, and (if payroll is enabled)
  // the next federal Form 941/940 due dates.
  const nextPayrollRow = await queryOne<any>(
    `SELECT MIN(next_pay_date) AS next_pay_date FROM altax.v3_payroll_schedules WHERE client_id = $1 AND status = 'Active'`,
    [clientId]
  );
  const deadlines = computeUpcomingDeadlines({
    mdCurrentPeriodDueDate: mdFiling && mdFiling.periods.length > 0 ? mdFiling.periods[mdFiling.periods.length - 1].dueDate : null,
    payrollNextDate: nextPayrollRow?.next_pay_date ? new Date(nextPayrollRow.next_pay_date).toISOString().slice(0, 10) : null,
    payrollEnabled: Boolean(clientRow.payroll_enabled),
  });

  res.json({
    period: { from, to },
    financials: {
      revenue: financials.totals.revenue, expenses: financials.totals.expenses,
      grossProfit: round2(financials.totals.revenue - cogs), netProfit: financials.totals.profit,
      cogs, months: financials.months,
    },
    cashBalance, apEstimate, taxLiabilities: financials.taxLiabilities,
    arAging, payrollCost: payroll.totalCost,
    ratios, health,
    budgetVsActual, budgetPeriodLabel: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    deadlines,
    dataLimitations: [
      "Cash Balance and Accounts Payable are estimates derived from recorded ledger (GL) activity, not a live bank feed or vendor-bill subledger.",
      "Current Ratio, Quick Ratio, and Debt-to-Equity are not shown — this system doesn't track a complete liabilities/equity picture, and a ratio built on partial data would be misleading.",
    ],
  });
}));

/**
 * Real month-over-month history from v3_client_monthly_snapshot (populated
 * by the monthly snapshot sweep, src/modules/clients/monthlySnapshot.ts) —
 * powers the dashboard's 12-month trend and "vs prior period" deltas, both
 * of which are otherwise unanswerable since every other figure in this file
 * is always recomputed live from today's GL state. Admin-only, matching the
 * rest of this file's financial data.
 */
reportsRouter.get("/client-monthly-snapshots/:clientId", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const months = Math.min(36, Math.max(1, Number(req.query.months) || 12));
  const rows = await query<any>(
    `SELECT period_year, period_month, revenue, expenses, profit, cash_balance, ar_balance, ap_balance,
            tax_liabilities, payroll_cost, health_score, health_band, open_tasks
       FROM altax.v3_client_monthly_snapshot
      WHERE client_id = $1
      ORDER BY period_year DESC, period_month DESC
      LIMIT $2`,
    [clientId, months]
  );
  const snapshots = rows.reverse().map((r: any) => ({
    periodLabel: `${r.period_year}-${String(r.period_month).padStart(2, "0")}`,
    revenue: Number(r.revenue), expenses: Number(r.expenses), profit: Number(r.profit),
    cashBalance: Number(r.cash_balance), arBalance: Number(r.ar_balance), apBalance: Number(r.ap_balance),
    taxLiabilities: Number(r.tax_liabilities), payrollCost: Number(r.payroll_cost),
    healthScore: r.health_score, healthBand: r.health_band, openTasks: r.open_tasks,
  }));
  res.json({ snapshots });
}));

/**
 * Admin toggle + thresholds for the Phase 4 dashboard alert push (see
 * runDashboardAlertPush, clients/dashboardAlerts.ts) — lets a firm admin
 * turn automated email/SMS alerts off entirely, or tune what counts as
 * "urgent enough to page someone" without touching code.
 */
reportsRouter.get("/dashboard-alert-settings", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json(await getDashboardAlertSettings());
}));

reportsRouter.patch("/dashboard-alert-settings", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  await updateDashboardAlertSettings(
    {
      autoAlertsEnabled: typeof body.autoAlertsEnabled === "boolean" ? body.autoAlertsEnabled : undefined,
      cashThreshold: body.cashThreshold !== undefined ? Number(body.cashThreshold) : undefined,
      overdueDaysThreshold: body.overdueDaysThreshold !== undefined ? Number(body.overdueDaysThreshold) : undefined,
      filingDeadlineDaysThreshold: body.filingDeadlineDaysThreshold !== undefined ? Number(body.filingDeadlineDaysThreshold) : undefined,
    },
    req.user!.email
  );
  await logAudit("Reports", "UPDATE_DASHBOARD_ALERT_SETTINGS", "Firm", "", "", "", `Dashboard alert settings updated by ${req.user!.email}.`, req.user!.email);
  res.json(await getDashboardAlertSettings());
}));

/** Manual trigger for the monthly management summary (server.ts crons this automatically on the 1st of each month) — lets an admin send it on demand for testing or a mid-month re-send. */
reportsRouter.post("/monthly-management-summary/run", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const result = await runMonthlyManagementSummary(req.user!.email);
  await logAudit("Reports", "RUN_MONTHLY_MANAGEMENT_SUMMARY", "Firm", "", "", "", `Monthly management summary run by ${req.user!.email}: ${result.sent} sent, ${result.skipped} skipped.`, req.user!.email);
  res.json(result);
}));

function parsePeriod(req: AuthedRequest): { from: string; to: string } | null {
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  return { from, to };
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers: string[], rows: (string | number)[][]): string {
  return [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
}

/**
 * Every /csv/... report route below can also produce a real .xlsx workbook
 * from the exact same headers/rows — controlled by ?format=xlsx on the same
 * URL, so the frontend doesn't need a second route per report. Defaults to
 * CSV (the long-standing behavior) when the param is absent or unrecognized.
 */
function sendTabular(req: AuthedRequest, res: Response, sheetName: string, headers: string[], rows: (string | number)[][], filenameBase: string) {
  if (String(req.query.format || "").toLowerCase() === "xlsx") {
    const buffer = buildXlsxBuffer(sheetName, headers, rows);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.xlsx"`);
    res.send(buffer);
  } else {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.csv"`);
    res.send(toCsv(headers, rows));
  }
}

reportsRouter.get("/pdf/pl/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });

  const gl = await loadBucketedGl(client.clientId, period.from, period.to);
  const totalIncome = gl.income.reduce((s, l) => s + (l.credit - l.debit), 0);
  const totalCogs = gl.cogs.reduce((s, l) => s + (l.debit - l.credit), 0);
  const totalExpenses = gl.expenses.reduce((s, l) => s + (l.debit - l.credit), 0);
  const grossProfit = totalIncome - totalCogs;

  const { generatePLPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generatePLPdf({
    client, from: period.from, to: period.to, income: gl.income, cogs: gl.cogs, expenses: gl.expenses,
    totalIncome, totalCogs, grossProfit, totalExpenses, netIncome: grossProfit - totalExpenses,
  });

  await logAudit("Reports", "GENERATE_PL_PDF", client.clientId, "Period", "", `${period.from} - ${period.to}`, `P&L PDF generated by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="PL_${client.clientId}_${period.from}_${period.to}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

reportsRouter.get("/pdf/balance-sheet/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });

  const gl = await loadBucketedGl(client.clientId, period.from, period.to);
  const totalAssets = gl.assets.reduce((s, l) => s + (l.debit - l.credit), 0);
  const totalLiabilities = gl.liabilities.reduce((s, l) => s + (l.credit - l.debit), 0);

  const { generateBalanceSheetPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generateBalanceSheetPdf({
    client, from: period.from, to: period.to, assets: gl.assets, liabilities: gl.liabilities,
    totalAssets, totalLiabilities, totalEquity: totalAssets - totalLiabilities,
  });

  await logAudit("Reports", "GENERATE_BALANCE_SHEET_PDF", client.clientId, "Period", "", `${period.from} - ${period.to}`, `Balance Sheet PDF generated by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="BalanceSheet_${client.clientId}_${period.from}_${period.to}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

reportsRouter.get("/pdf/payroll/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });

  const payroll = await loadPayrollForPeriod(client.clientId, period.from, period.to);
  const { generatePayrollPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generatePayrollPdf({ client, from: period.from, to: period.to, ...payroll });

  await logAudit("Reports", "GENERATE_PAYROLL_PDF", client.clientId, "Period", "", `${period.from} - ${period.to}`, `Payroll Dashboard PDF generated by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="Payroll_${client.clientId}_${period.from}_${period.to}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

/**
 * Same underlying payroll data as /pdf/payroll, grouped by employee instead of
 * left as one flat check list — an optional ?employee= name switches from the
 * all-employees totals table to that one employee's tax breakdown + checks.
 */
reportsRouter.get("/pdf/employee/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });
  const employeeFilter = String(req.query.employee || "").trim() || null;

  const { generateEmployeeReportPdf } = await import("../accounting/reportsPdf");
  let pdfBytes: Uint8Array;
  if (employeeFilter) {
    const payroll = await loadPayrollForPeriod(client.clientId, period.from, period.to, employeeFilter);
    pdfBytes = await generateEmployeeReportPdf({
      client, from: period.from, to: period.to, employeeFilter, summaryRows: [], taxRows: payroll.taxRows, checks: payroll.checks,
      totals: { grossWages: payroll.grossWages, checkCount: payroll.checkCount, employeeTaxes: payroll.employeeTaxes, employerTaxes: payroll.employerTaxes, netPay: payroll.netPay, totalCost: payroll.totalCost },
    });
  } else {
    const summaryRows = await loadEmployeeSummaryForPeriod(client.clientId, period.from, period.to);
    const totals = summaryRows.reduce((s, r) => ({
      grossWages: s.grossWages + r.grossWages, checkCount: s.checkCount + r.checkCount, employeeTaxes: s.employeeTaxes + r.employeeTaxes,
      employerTaxes: s.employerTaxes + r.employerTaxes, netPay: s.netPay + r.netPay, totalCost: s.totalCost + r.totalCost,
    }), { grossWages: 0, checkCount: 0, employeeTaxes: 0, employerTaxes: 0, netPay: 0, totalCost: 0 });
    pdfBytes = await generateEmployeeReportPdf({ client, from: period.from, to: period.to, employeeFilter: null, summaryRows, taxRows: [], checks: [], totals });
  }

  await logAudit("Reports", "GENERATE_EMPLOYEE_PDF", client.clientId, "Period", "", `${period.from} - ${period.to}${employeeFilter ? ` (${employeeFilter})` : ""}`, `Employee Report PDF generated by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="Employee_${client.clientId}_${period.from}_${period.to}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

reportsRouter.get("/pdf/client-message/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });

  const resolved = await resolveTemplate("Client Tax and Payroll Update", client.clientId, period.from, period.to);
  if (!resolved) return res.status(404).json({ error: "Client message template not found." });

  const { generateClientMessagePdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generateClientMessagePdf({
    client, from: period.from, to: period.to, subject: resolved.subject, bodyEnglish: resolved.message_english,
  });

  await logAudit("Reports", "GENERATE_CLIENT_MESSAGE_PDF", client.clientId, "Period", "", `${period.from} - ${period.to}`, `Client Message PDF generated by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="ClientMessage_${client.clientId}_${period.from}_${period.to}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

reportsRouter.get("/pdf/sales-tax-payroll/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });

  const mdPaidDate = String(req.query.mdPaidDate || "").trim() || undefined;
  const table = await computeClientPeriodSummaryTable(client.clientId, period.from, period.to, mdPaidDate);
  const { generateSalesTaxPayrollReportPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generateSalesTaxPayrollReportPdf({
    client, from: period.from, to: period.to,
    sections: table.sections.map((s) => ({ title: s.title, rows: s.rows.map((r) => ({ label: r.label, value: r.value })) })),
  });

  await logAudit("Reports", "GENERATE_SALES_TAX_PAYROLL_PDF", client.clientId, "Period", "", `${period.from} - ${period.to}`, `Sales, Tax & Payroll Report PDF generated by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="SalesTaxPayroll_${client.clientId}_${period.from}_${period.to}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

/**
 * Sales & Tax report — per-category sales/tax totals for a period, from the real
 * v3_sales_input + v3_sales_input_lines rows (not the GL, which only carries a
 * single rolled-up "Sales Tax Payable" figure with no category detail). This is
 * what a sales tax return actually needs filled in box by box, and until now the
 * only way to see it was opening each sale's Edit form one at a time.
 */
/** Just sale_date + total_tax_due, for MD filing's per-period summing — deliberately lighter than loadSalesTaxForPeriod (no byCategory join) since it's sometimes called over a widened date range that spans full filing periods rather than just the requested report window. */
async function loadSalesDatesAndTaxForPeriod(clientId: string, from: string, to: string) {
  const rows = await query<any>(
    `SELECT sale_date, total_tax_due FROM altax.v3_sales_input WHERE client_id = $1 AND sale_date::date >= $2::date AND sale_date::date <= $3::date`,
    [clientId, from, to]
  );
  return rows.map((r: any) => ({ saleDate: r.sale_date, totalTaxDue: Number(r.total_tax_due) || 0 }));
}

async function loadSalesTaxForPeriod(clientId: string, from: string, to: string) {
  const sales = await query<any>(
    `SELECT sale_id, sale_date, gross_sales, total_tax_due, adjustments
       FROM altax.v3_sales_input
      WHERE client_id = $1 AND sale_date::date >= $2::date AND sale_date::date <= $3::date
      ORDER BY sale_date`,
    [clientId, from, to]
  );
  // Non-taxable amount per sale (SNAP/EBT, exempt items) — a sale's non-taxable
  // portion lives as a CAT-NON-TAXABLE line in v3_sales_input_lines, not as a
  // column on v3_sales_input itself, so it's fetched separately and merged in
  // below rather than joined into the main query above (which would multiply
  // rows for sales with several category lines).
  const nonTaxableRows = await query<{ sale_id: string; amount: string }>(
    `SELECT l.sale_id, COALESCE(SUM(l.taxable_amount), 0) AS amount
       FROM altax.v3_sales_input_lines l
       JOIN altax.v3_sales_input s ON s.sale_id = l.sale_id
      WHERE s.client_id = $1 AND s.sale_date::date >= $2::date AND s.sale_date::date <= $3::date
        AND l.category_id = $4
      GROUP BY l.sale_id`,
    [clientId, from, to, NON_TAXABLE_CATEGORY_ID]
  );
  const nonTaxableBySaleId = new Map(nonTaxableRows.map((r) => [r.sale_id, Number(r.amount) || 0]));
  const byCategory = await query<any>(
    `SELECT c.category_name, c.state, l.tax_rate_used,
            COALESCE(SUM(l.taxable_amount), 0) AS taxable_amount,
            COALESCE(SUM(l.tax_amount), 0) AS tax_amount
       FROM altax.v3_sales_input_lines l
       JOIN altax.v3_sales_input s ON s.sale_id = l.sale_id
       JOIN altax.v3_sales_tax_categories c ON c.category_id = l.category_id
      WHERE s.client_id = $1 AND s.sale_date::date >= $2::date AND s.sale_date::date <= $3::date
      GROUP BY c.category_name, c.state, l.tax_rate_used, c.display_order
      ORDER BY c.display_order, c.category_name`,
    [clientId, from, to]
  );
  const totalGross = sales.reduce((s: number, r: any) => s + (Number(r.gross_sales) || 0), 0);
  const totalTax = sales.reduce((s: number, r: any) => s + (Number(r.total_tax_due) || 0), 0);
  const totalAdjustments = sales.reduce((s: number, r: any) => s + (Number(r.adjustments) || 0), 0);
  return {
    sales: sales.map((r: any) => {
      const grossSales = Number(r.gross_sales) || 0;
      const nonTaxableSales = nonTaxableBySaleId.get(r.sale_id) || 0;
      // Taxable Sales = Gross - Non-Taxable — the same split the Tax by
      // Category table above already totals to (its categories always sum
      // back to gross sales), just surfaced per-sale instead of per-category.
      return {
        saleId: r.sale_id, saleDate: r.sale_date, grossSales,
        totalTaxDue: Number(r.total_tax_due) || 0, adjustments: Number(r.adjustments) || 0,
        nonTaxableSales, taxableSales: grossSales - nonTaxableSales,
      };
    }),
    byCategory: byCategory.map((r: any) => ({
      categoryName: r.category_name, state: r.state, rate: Number(r.tax_rate_used) || 0,
      taxableAmount: Number(r.taxable_amount) || 0, taxAmount: Number(r.tax_amount) || 0,
    })),
    totals: { grossSales: totalGross, taxDue: totalTax, adjustments: totalAdjustments, saleCount: sales.length },
  };
}

/**
 * Trial balance — every account's debit and credit totals, and whether the two
 * sides agree.
 *
 * Nothing in this system previously checked that the ledger balances. Sales,
 * payroll and journal entries all post GL lines, and the delete paths now
 * reverse them; if any of those ever wrote a half-entry, the books would be
 * quietly wrong and the first person to notice would be a client's accountant.
 * This turns that silent class of bug into something visible on demand.
 *
 * The out-of-balance test uses a half-cent tolerance because the amounts are
 * fixed-point currency accumulated in floating point — an exact === would flag
 * healthy books over representation noise.
 */
reportsRouter.get("/trial-balance/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });

  // Period is optional here: a trial balance is normally run to date, but being
  // able to bound it is what makes it useful for closing a quarter.
  const from = String(req.query.from || "").trim() || null;
  const to = String(req.query.to || "").trim() || null;

  const rows = await query<any>(
    `SELECT account,
            COALESCE(SUM(debit), 0)  AS debits,
            COALESCE(SUM(credit), 0) AS credits,
            COUNT(*)::int            AS line_count
       FROM altax.v3_gl_entries
      WHERE client_id = $1
        AND ($2::date IS NULL OR entry_date >= $2::date)
        AND ($3::date IS NULL OR entry_date <= $3::date)
      GROUP BY account
      ORDER BY account`,
    [client.clientId, from, to]
  );

  const accounts = rows.map((r) => {
    const debits = Number(r.debits || 0);
    const credits = Number(r.credits || 0);
    return {
      account: r.account,
      debits,
      credits,
      balance: Number((debits - credits).toFixed(2)),
      lineCount: Number(r.line_count || 0),
    };
  });

  const totalDebits = Number(accounts.reduce((s, a) => s + a.debits, 0).toFixed(2));
  const totalCredits = Number(accounts.reduce((s, a) => s + a.credits, 0).toFixed(2));
  const difference = Number((totalDebits - totalCredits).toFixed(2));

  // Entries whose own debits and credits disagree — this points at the exact
  // source document rather than just saying "something is wrong somewhere".
  const unbalancedRefs = await query<any>(
    `SELECT ref, source,
            COALESCE(SUM(debit), 0)  AS debits,
            COALESCE(SUM(credit), 0) AS credits
       FROM altax.v3_gl_entries
      WHERE client_id = $1
        AND ($2::date IS NULL OR entry_date >= $2::date)
        AND ($3::date IS NULL OR entry_date <= $3::date)
      GROUP BY ref, source
     HAVING ABS(COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0)) > 0.005
      ORDER BY ref`,
    [client.clientId, from, to]
  );

  res.json({
    client,
    from,
    to,
    accounts,
    totals: { debits: totalDebits, credits: totalCredits, difference },
    inBalance: Math.abs(difference) < 0.005,
    unbalancedEntries: unbalancedRefs.map((r) => ({
      ref: r.ref,
      source: r.source,
      debits: Number(r.debits || 0),
      credits: Number(r.credits || 0),
      difference: Number((Number(r.debits || 0) - Number(r.credits || 0)).toFixed(2)),
    })),
  });
}));

reportsRouter.get("/csv/trial-balance/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });
  const from = String(req.query.from || "").trim() || null;
  const to = String(req.query.to || "").trim() || null;

  const rows = await query<any>(
    `SELECT account, COALESCE(SUM(debit), 0) AS debits, COALESCE(SUM(credit), 0) AS credits
       FROM altax.v3_gl_entries
      WHERE client_id = $1
        AND ($2::date IS NULL OR entry_date >= $2::date)
        AND ($3::date IS NULL OR entry_date <= $3::date)
      GROUP BY account
      ORDER BY account`,
    [client.clientId, from, to]
  );
  const headers = ["Account", "Debits", "Credits", "Balance"];
  const dataRows = rows.map((r) => {
    const debits = Number(r.debits || 0);
    const credits = Number(r.credits || 0);
    return [r.account, debits.toFixed(2), credits.toFixed(2), (debits - credits).toFixed(2)];
  });
  const totalDebits = rows.reduce((s, r) => s + Number(r.debits || 0), 0);
  const totalCredits = rows.reduce((s, r) => s + Number(r.credits || 0), 0);
  dataRows.push(["", "", "", ""]);
  dataRows.push(["Total", totalDebits.toFixed(2), totalCredits.toFixed(2), (totalDebits - totalCredits).toFixed(2)]);

  await logAudit("Reports", "EXPORT_TRIAL_BALANCE_CSV", client.clientId, "Period", "", `${from || "all"} - ${to || "all"}`, `Trial Balance ${String(req.query.format || "").toLowerCase() === "xlsx" ? "Excel" : "CSV"} exported by ${req.user!.email}.`, req.user!.email);
  sendTabular(req, res, "Trial Balance", headers, dataRows, `TrialBalance_${client.clientId}${from ? `_${from}` : ""}${to ? `_${to}` : ""}`);
}));

/** JSON for the on-screen Sales & Tax tab (and its Preview). */
reportsRouter.get("/sales-tax/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });
  const data = await loadSalesTaxForPeriod(client.clientId, period.from, period.to);
  const mdPaidDate = String(req.query.mdPaidDate || "").trim() || undefined;
  const mdFiling = await computeMdFilingForReport(client, period.from, period.to, mdPaidDate);
  res.json({ client, from: period.from, to: period.to, ...data, mdFiling });
}));

/**
 * Same per-real-filing-period MD Form 202 breakdown as the JSON above, but
 * standalone (no byCategory/sales/totals) — used by Accounting → Sales &
 * Tax by Period so that working tab shares the exact same due-date/
 * frequency-aware math as the client-facing report, instead of the
 * client-agnostic /calculators/md-filing endpoint (which has no period or
 * filing-frequency concept and was blending everything into one due date).
 */
reportsRouter.get("/md-filing/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });
  const data = await loadSalesTaxForPeriod(client.clientId, period.from, period.to);
  const mdPaidDate = String(req.query.mdPaidDate || "").trim() || undefined;
  const mdFiling = await computeMdFilingForReport(client, period.from, period.to, mdPaidDate);
  res.json({ mdFiling });
}));

reportsRouter.get("/pdf/sales-tax/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });

  const data = await loadSalesTaxForPeriod(client.clientId, period.from, period.to);
  const mdPaidDate = String(req.query.mdPaidDate || "").trim() || undefined;
  const mdFiling = await computeMdFilingForReport(client, period.from, period.to, mdPaidDate);
  const { generateSalesTaxPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generateSalesTaxPdf({ client, from: period.from, to: period.to, ...data, mdFiling });

  await logAudit("Reports", "GENERATE_SALES_TAX_PDF", client.clientId, "Period", "", `${period.from} - ${period.to}`, `Sales & Tax PDF generated by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="SalesTax_${client.clientId}_${period.from}_${period.to}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

reportsRouter.get("/csv/sales-tax/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });

  const data = await loadSalesTaxForPeriod(client.clientId, period.from, period.to);
  const mdPaidDate = String(req.query.mdPaidDate || "").trim() || undefined;
  const mdFiling = await computeMdFilingForReport(client, period.from, period.to, mdPaidDate);
  const rows: (string | number)[][] = data.byCategory.map((c) => [c.categoryName, c.state || "", `${(c.rate * 100).toFixed(2)}%`, c.taxableAmount.toFixed(2), c.taxAmount.toFixed(2)]);
  if (mdFiling) {
    rows.push(["", "", "", "", ""]);
    rows.push(["Filing / payment date", "", "", "", mdFiling.paidDate]);
    for (const p of mdFiling.periods) {
      rows.push(["", "", "", "", ""]);
      rows.push([`Period ${p.start} to ${p.end}`, "", "", "", ""]);
      rows.push(["Return due date", "", "", "", p.dueDate]);
      rows.push(["Tax due", "", "", "", p.taxDue.toFixed(2)]);
      if (p.onTime) {
        rows.push(["Timely discount", "", "", "", (-p.discount).toFixed(2)]);
        rows.push(["Balance due", "", "", "", p.balanceDue.toFixed(2)]);
      } else {
        rows.push(["Late penalty (10%)", "", "", "", p.penalty.toFixed(2)]);
        rows.push([`Interest (${p.monthsLate} mo)`, "", "", "", p.interest.toFixed(2)]);
        rows.push(["Balance due", "", "", "", p.balanceDue.toFixed(2)]);
      }
    }
    if (mdFiling.periods.length > 1) {
      rows.push(["", "", "", "", ""]);
      rows.push(["Total discount", "", "", "", (-mdFiling.totals.discount).toFixed(2)]);
      rows.push(["Total penalty", "", "", "", mdFiling.totals.penalty.toFixed(2)]);
      rows.push(["Total interest", "", "", "", mdFiling.totals.interest.toFixed(2)]);
      rows.push(["Total balance due", "", "", "", mdFiling.totals.balanceDue.toFixed(2)]);
    }
    if (!mdFiling.frequencyUsed) {
      rows.push(["", "", "", "", ""]);
      rows.push(["Note", "", "", "", "Filing frequency not set on client profile — shown as one combined period; verify against actual Comptroller filing schedule."]);
    }
  }
  const headers = ["Category", "State", "Rate", "Taxable Amount", "Tax Amount"];

  await logAudit("Reports", "EXPORT_SALES_TAX_CSV", client.clientId, "Period", "", `${period.from} - ${period.to}`, `Sales & Tax ${String(req.query.format || "").toLowerCase() === "xlsx" ? "Excel" : "CSV"} exported by ${req.user!.email}.`, req.user!.email);
  sendTabular(req, res, "Sales Tax", headers, rows, `SalesTax_${client.clientId}_${period.from}_${period.to}`);
}));

reportsRouter.get("/csv/gl/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });

  const gl = await loadBucketedGl(client.clientId, period.from, period.to);
  const headers = ["Account", "Section", "Debit", "Credit", "Net"];
  const rows = gl.all.map((l) => [l.account, bucketFor(l.account), l.debit.toFixed(2), l.credit.toFixed(2), (l.credit - l.debit).toFixed(2)]);

  await logAudit("Reports", "EXPORT_GL_CSV", client.clientId, "Period", "", `${period.from} - ${period.to}`, `GL ${String(req.query.format || "").toLowerCase() === "xlsx" ? "Excel" : "CSV"} exported by ${req.user!.email}.`, req.user!.email);
  sendTabular(req, res, "GL", headers, rows, `GL_${client.clientId}_${period.from}_${period.to}`);
}));

reportsRouter.get("/csv/payroll/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });

  const payroll = await loadPayrollForPeriod(client.clientId, period.from, period.to);
  const headers = ["Pay Date", "Employee", "Gross", "Net"];
  const rows = payroll.checks.map((c) => [c.payDate ? String(c.payDate).slice(0, 10) : "", c.employee, c.gross.toFixed(2), c.net.toFixed(2)]);

  await logAudit("Reports", "EXPORT_PAYROLL_CSV", client.clientId, "Period", "", `${period.from} - ${period.to}`, `Payroll ${String(req.query.format || "").toLowerCase() === "xlsx" ? "Excel" : "CSV"} exported by ${req.user!.email}.`, req.user!.email);
  sendTabular(req, res, "Payroll", headers, rows, `Payroll_${client.clientId}_${period.from}_${period.to}`);
}));

reportsRouter.get("/csv/employee/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });
  const employeeFilter = String(req.query.employee || "").trim() || null;

  const headers = employeeFilter ? ["Pay Date", "Employee", "Gross", "Net"] : ["Employee", "Checks", "Gross Wages", "Employee Taxes", "Employer Taxes", "Net Pay", "Total Cost"];
  const rows = employeeFilter
    ? (await loadPayrollForPeriod(client.clientId, period.from, period.to, employeeFilter)).checks
        .map((c) => [c.payDate ? String(c.payDate).slice(0, 10) : "", c.employee, c.gross.toFixed(2), c.net.toFixed(2)])
    : (await loadEmployeeSummaryForPeriod(client.clientId, period.from, period.to))
        .map((r) => [r.employee, r.checkCount, r.grossWages.toFixed(2), r.employeeTaxes.toFixed(2), r.employerTaxes.toFixed(2), r.netPay.toFixed(2), r.totalCost.toFixed(2)]);

  await logAudit("Reports", "EXPORT_EMPLOYEE_CSV", client.clientId, "Period", "", `${period.from} - ${period.to}${employeeFilter ? ` (${employeeFilter})` : ""}`, `Employee Report ${String(req.query.format || "").toLowerCase() === "xlsx" ? "Excel" : "CSV"} exported by ${req.user!.email}.`, req.user!.email);
  sendTabular(req, res, "Employee", headers, rows, `Employee_${client.clientId}_${period.from}_${period.to}`);
}));
