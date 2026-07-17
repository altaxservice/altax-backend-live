import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { logAudit } from "../../common/audit";
import { resolveTemplate } from "../templates/templates.routes";
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

function bucketAccount(account: string): "revenue" | "expense" | "other" {
  const a = String(account || "").toLowerCase();
  if (a.includes("revenue") || a.includes("sales")) return "revenue";
  if (a.includes("expense") || a.includes("tax") || a.includes("cost of goods")) return "expense";
  return "other";
}

/** Shared by GET /firm-summary (JSON, dashboard) and the PDF/CSV export routes below, so both read identical numbers. */
async function computeFirmSummary(monthsBack: number) {
  const since = new Date();
  since.setMonth(since.getMonth() - (monthsBack - 1));
  since.setDate(1);

  const glRows = await query<any>(
    `SELECT to_char(entry_date, 'YYYY-MM') AS month, account, debit, credit
       FROM altax.v3_gl_entries
      WHERE entry_date >= $1`,
    [since.toISOString()]
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
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(since);
    d.setMonth(d.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const entry = byMonth.get(key) || { revenue: 0, expenses: 0 };
    months.push({ month: key, revenue: Math.round(entry.revenue * 100) / 100, expenses: Math.round(entry.expenses * 100) / 100, profit: Math.round((entry.revenue - entry.expenses) * 100) / 100 });
  }

  const totals = months.reduce((acc, m) => ({ revenue: acc.revenue + m.revenue, expenses: acc.expenses + m.expenses, profit: acc.profit + m.profit }), { revenue: 0, expenses: 0, profit: 0 });

  const unpaidRow = await queryOne<any>(
    `SELECT COALESCE(SUM(balance_due), 0) AS unpaid, COUNT(*)::int AS count
       FROM altax.v3_invoices WHERE status NOT IN ('Paid', 'Void')`
  );
  const activeClientsRow = await queryOne<any>(
    `SELECT COUNT(*)::int AS count FROM altax.v3_clients WHERE lower(status) NOT IN ('archived', 'inactive')`
  );

  // Legacy's dashboard read this from a manually-typed spreadsheet cell (dashSheet!I4),
  // not a formula — there was nothing to port 1:1. Computed here instead as the real
  // outstanding balance of the firm's tax/payroll liability accounts (all-time balance
  // owed, not scoped to the months window above, since it's a point-in-time liability).
  const taxLiabilitiesRow = await queryOne<any>(
    `SELECT COALESCE(SUM(credit - debit), 0) AS balance
       FROM altax.v3_gl_entries
      WHERE account IN ('Sales Tax Payable', 'Payroll Tax Payable', 'Payroll Deduction Payable')`
  );

  return {
    months,
    totals: { revenue: Math.round(totals.revenue * 100) / 100, expenses: Math.round(totals.expenses * 100) / 100, profit: Math.round(totals.profit * 100) / 100 },
    unpaidBalance: Number(unpaidRow?.unpaid || 0),
    unpaidInvoiceCount: Number(unpaidRow?.count || 0),
    activeClientCount: Number(activeClientsRow?.count || 0),
    taxLiabilities: Math.round(Number(taxLiabilitiesRow?.balance || 0) * 100) / 100,
  };
}

reportsRouter.get("/firm-summary", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const monthsBack = Math.min(24, Math.max(1, Number(req.query.months) || 6));
  res.json(await computeFirmSummary(monthsBack));
}));

reportsRouter.get("/pdf/firm-overview", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const monthsBack = Math.min(24, Math.max(1, Number(req.query.months) || 6));
  const summary = await computeFirmSummary(monthsBack);

  const { generateFirmOverviewPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generateFirmOverviewPdf({ monthsBack, ...summary });

  await logAudit("Reports", "GENERATE_FIRM_OVERVIEW_PDF", "Firm", "Months", "", String(monthsBack), `Firm Overview PDF generated by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="FirmOverview_${monthsBack}mo.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

reportsRouter.get("/csv/firm-overview", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const monthsBack = Math.min(24, Math.max(1, Number(req.query.months) || 6));
  const summary = await computeFirmSummary(monthsBack);
  const csv = toCsv(
    ["Month", "Revenue", "Expenses", "Profit"],
    summary.months.map((m) => [m.month, m.revenue.toFixed(2), m.expenses.toFixed(2), m.profit.toFixed(2)])
  );

  await logAudit("Reports", "EXPORT_FIRM_OVERVIEW_CSV", "Firm", "Months", "", String(monthsBack), `Firm Overview CSV exported by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="FirmOverview_${monthsBack}mo.csv"`);
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
const ASSET_HINTS = ["cash", "asset", "bank"];
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
  const client = await queryOne<any>(`SELECT client_id, client_name, ein, address FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return null;
  return { clientId: client.client_id, clientName: client.client_name, ein: client.ein, address: client.address };
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

async function loadPayrollForPeriod(clientId: string, from: string, to: string) {
  const rows = await query<any>(
    `SELECT paycheck_id, pay_date, employee, gross_wages, employee_taxes, employer_taxes, net_pay, total_cost,
            federal_withholding, social_security_ee, social_security_er, medicare_ee, medicare_er, state_tax, suta, futa
       FROM altax.v3_paychecks
      WHERE client_id = $1 AND pay_date::date >= $2::date AND pay_date::date <= $3::date AND lower(status) <> 'void'
      ORDER BY pay_date`,
    [clientId, from, to]
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
