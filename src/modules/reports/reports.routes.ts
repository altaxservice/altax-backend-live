import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { decryptClientPii } from "../../common/encryption";
import { logAudit } from "../../common/audit";
import { resolveTemplate, computeClientPeriodSummaryTable } from "../templates/templates.routes";
import type { LedgerLine, ReportClientInfo, PayrollTaxRow, PayrollCheckRow } from "../accounting/reportsPdf";

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
async function computeFirmSummary(from: string, to: string, clientId?: string) {
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
  const csv = toCsv(
    ["Month", "Revenue", "Expenses", "Profit"],
    summary.months.map((m) => [m.month, m.revenue.toFixed(2), m.expenses.toFixed(2), m.profit.toFixed(2)])
  );

  await logAudit("Reports", "EXPORT_FIRM_OVERVIEW_CSV", clientId || "Firm", "Period", "", `${rangeFrom} to ${rangeTo}`, `${clientId ? "Client" : "Firm"} Overview CSV exported by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${clientId ? `Overview_${clientId}` : "FirmOverview"}_${rangeFrom}_${rangeTo}.csv"`);
  res.send(csv);
}));

/**
 * AR Aging — which clients owe the firm money and how overdue. Every open
 * (not Paid/Void) invoice's balance_due is bucketed off today - due_date,
 * grouped by client. AP aging (what the firm owes) is out of scope: this
 * app has no vendor-bills concept — only GL liability account balances,
 * which have no per-bill due date to bucket against — so AP aging would
 * need a whole new module, not this report.
 */
async function computeArAging() {
  const rows = await query<any>(
    `SELECT i.client_id, c.client_name,
            i.balance_due, i.due_date,
            (CURRENT_DATE - i.due_date::date) AS days_overdue
       FROM altax.v3_invoices i
       JOIN altax.v3_clients c ON c.client_id = i.client_id
      WHERE i.status NOT IN ('Paid', 'Void') AND i.balance_due > 0
      ORDER BY c.client_name ASC`
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

reportsRouter.get("/ar-aging", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json(await computeArAging());
}));

reportsRouter.get("/pdf/ar-aging", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = await computeArAging();
  const { generateArAgingPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generateArAgingPdf(data);
  await logAudit("Reports", "GENERATE_AR_AGING_PDF", "Firm", "", "", data.asOf, `AR Aging PDF generated by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="AR_Aging_${data.asOf}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

reportsRouter.get("/csv/ar-aging", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = await computeArAging();
  const csv = toCsv(
    ["Client", "Current", "1-30 Days", "31-60 Days", "61-90 Days", "90+ Days", "Total"],
    data.rows.map((r) => [r.clientName, r.current.toFixed(2), r.d1_30.toFixed(2), r.d31_60.toFixed(2), r.d61_90.toFixed(2), r.d90Plus.toFixed(2), r.total.toFixed(2)])
  );
  await logAudit("Reports", "EXPORT_AR_AGING_CSV", "Firm", "", "", data.asOf, `AR Aging CSV exported by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="AR_Aging_${data.asOf}.csv"`);
  res.send(csv);
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
 */
async function computeMdFilingForReport(
  client: ReportClientInfo,
  sales: { saleDate: unknown; totalTaxDue: number }[],
  from: string,
  to: string,
  paidDateOverride?: string
) {
  if (client.state !== "MD") return null;
  const { computeMdFilingBreakdown } = await import("../../common/mdFiling");
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

async function loadPayrollForPeriod(clientId: string, from: string, to: string, employee?: string) {
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
async function loadSalesTaxForPeriod(clientId: string, from: string, to: string) {
  const sales = await query<any>(
    `SELECT sale_id, sale_date, gross_sales, total_tax_due, adjustments
       FROM altax.v3_sales_input
      WHERE client_id = $1 AND sale_date::date >= $2::date AND sale_date::date <= $3::date
      ORDER BY sale_date`,
    [clientId, from, to]
  );
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
    sales: sales.map((r: any) => ({
      saleId: r.sale_id, saleDate: r.sale_date, grossSales: Number(r.gross_sales) || 0,
      totalTaxDue: Number(r.total_tax_due) || 0, adjustments: Number(r.adjustments) || 0,
    })),
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

/** JSON for the on-screen Sales & Tax tab (and its Preview). */
reportsRouter.get("/sales-tax/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });
  const data = await loadSalesTaxForPeriod(client.clientId, period.from, period.to);
  const mdPaidDate = String(req.query.mdPaidDate || "").trim() || undefined;
  const mdFiling = await computeMdFilingForReport(client, data.sales, period.from, period.to, mdPaidDate);
  res.json({ client, from: period.from, to: period.to, ...data, mdFiling });
}));

reportsRouter.get("/pdf/sales-tax/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });

  const data = await loadSalesTaxForPeriod(client.clientId, period.from, period.to);
  const mdPaidDate = String(req.query.mdPaidDate || "").trim() || undefined;
  const mdFiling = await computeMdFilingForReport(client, data.sales, period.from, period.to, mdPaidDate);
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
  const mdFiling = await computeMdFilingForReport(client, data.sales, period.from, period.to, mdPaidDate);
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
  const csv = toCsv(["Category", "State", "Rate", "Taxable Amount", "Tax Amount"], rows);

  await logAudit("Reports", "EXPORT_SALES_TAX_CSV", client.clientId, "Period", "", `${period.from} - ${period.to}`, `Sales & Tax CSV exported by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="SalesTax_${client.clientId}_${period.from}_${period.to}.csv"`);
  res.send(csv);
}));

reportsRouter.get("/csv/gl/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });

  const gl = await loadBucketedGl(client.clientId, period.from, period.to);
  const csv = toCsv(
    ["Account", "Section", "Debit", "Credit", "Net"],
    gl.all.map((l) => [l.account, bucketFor(l.account), l.debit.toFixed(2), l.credit.toFixed(2), (l.credit - l.debit).toFixed(2)])
  );

  await logAudit("Reports", "EXPORT_GL_CSV", client.clientId, "Period", "", `${period.from} - ${period.to}`, `GL CSV exported by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="GL_${client.clientId}_${period.from}_${period.to}.csv"`);
  res.send(csv);
}));

reportsRouter.get("/csv/payroll/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });

  const payroll = await loadPayrollForPeriod(client.clientId, period.from, period.to);
  const csv = toCsv(
    ["Pay Date", "Employee", "Gross", "Net"],
    payroll.checks.map((c) => [c.payDate ? String(c.payDate).slice(0, 10) : "", c.employee, c.gross.toFixed(2), c.net.toFixed(2)])
  );

  await logAudit("Reports", "EXPORT_PAYROLL_CSV", client.clientId, "Period", "", `${period.from} - ${period.to}`, `Payroll CSV exported by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="Payroll_${client.clientId}_${period.from}_${period.to}.csv"`);
  res.send(csv);
}));

reportsRouter.get("/csv/employee/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });
  const employeeFilter = String(req.query.employee || "").trim() || null;

  const csv = employeeFilter
    ? toCsv(
        ["Pay Date", "Employee", "Gross", "Net"],
        (await loadPayrollForPeriod(client.clientId, period.from, period.to, employeeFilter)).checks
          .map((c) => [c.payDate ? String(c.payDate).slice(0, 10) : "", c.employee, c.gross.toFixed(2), c.net.toFixed(2)])
      )
    : toCsv(
        ["Employee", "Checks", "Gross Wages", "Employee Taxes", "Employer Taxes", "Net Pay", "Total Cost"],
        (await loadEmployeeSummaryForPeriod(client.clientId, period.from, period.to))
          .map((r) => [r.employee, r.checkCount, r.grossWages.toFixed(2), r.employeeTaxes.toFixed(2), r.employerTaxes.toFixed(2), r.netPay.toFixed(2), r.totalCost.toFixed(2)])
      );

  await logAudit("Reports", "EXPORT_EMPLOYEE_CSV", client.clientId, "Period", "", `${period.from} - ${period.to}${employeeFilter ? ` (${employeeFilter})` : ""}`, `Employee Report CSV exported by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="Employee_${client.clientId}_${period.from}_${period.to}.csv"`);
  res.send(csv);
}));
