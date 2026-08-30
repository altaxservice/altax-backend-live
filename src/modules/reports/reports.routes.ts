import { Router, Response } from "express";
import crypto from "crypto";
import { query, queryOne } from "../../config/db";
import { publicBaseUrl } from "../../common/publicUrl";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { decryptClientPii } from "../../common/encryption";
import { logAudit } from "../../common/audit";
import { resolveTemplate, computeClientPeriodSummaryTable } from "../templates/templates.routes";
import { NON_TAXABLE_CATEGORY_ID } from "../../common/taxRates";
import type { LedgerLine, ReportClientInfo, PayrollTaxRow, PayrollCheckRow } from "../accounting/reportsPdf";
import type { MdFilingPeriod } from "../../common/mdFiling";
import { summarizeMdFilingOnTime, classifyMdFilingPeriod } from "../../common/mdFiling";
import { getDashboardAlertSettings, updateDashboardAlertSettings } from "../clients/dashboardAlerts";
import { runMonthlyManagementSummary } from "../clients/monthlyManagementSummary";
import { computeUpcomingDeadlines } from "../clients/complianceCalendar";
import { computeClientFlags } from "../clients/clients.routes";
import { computeClientComplianceTimeline, computeClientComplianceScore } from "../clients/complianceTimeline";
import { SERVICE_LABEL } from "../contracts/contractContent";
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

/** Firm Overview's fallback window when no from/to is supplied (old bookmarked links, direct API calls) — the same "last 6 months ending today" this route always showed before from/to support existed. Exported so other modules needing this same standard 6-month window (clients.routes.ts's MD flags block, SWOT input, the MD notice cron) share one implementation instead of hand-duplicating the date math. */
export function defaultFirmSummaryRange(): { from: string; to: string } {
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
  await ensureCoaTypeCache();
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
 * Firm Report — 4 firm-level views built entirely on data the app already
 * captures per client, just never rolled up before (owner request,
 * 2026-08-20: "what other firms have in their system to be on top of their
 * company"). Each one answers a real question:
 *   - Revenue by Service Type: where the money actually comes from. Uses
 *     each client's own service_type as the bucket (a client's revenue isn't
 *     split across sub-services even on a "Full Service" client — an
 *     approximation, not a true service-line P&L, since GL entries aren't
 *     tagged by service line at all).
 *   - Client Concentration: what % of revenue rides on the top few clients —
 *     losing a client that's 15%+ of revenue is a real risk worth knowing
 *     about before it happens, not after.
 *   - MD On-Time Filing Rate: the firm-wide rollup of the same
 *     classifyMdFilingPeriod math already used per-client (mdFiling.ts) —
 *     "what % of MD sales tax periods across every client were on time."
 *   - Estimate Win Rate: of estimates that reached a real decision (Approved
 *     or Declined) in the window, what fraction were won. Still-open
 *     estimates (Draft/Contacted/Sent) are excluded from the rate itself
 *     (nothing to win/lose yet) but reported alongside for context.
 */
export async function computeFirmInsights(from: string, to: string) {
  await ensureCoaTypeCache();

  // --- Revenue by Service Type + Client Concentration: same GL-bucketing
  // approach as computeFirmSummary, just grouped by client instead of by
  // month, then joined to each client's service_type/name in one pass. ---
  const glRows = await query<any>(
    `SELECT client_id, account, debit, credit FROM altax.v3_gl_entries WHERE entry_date >= $1::date AND entry_date <= $2::date`,
    [from, to]
  );
  const revenueByClient = new Map<string, number>();
  for (const row of glRows) {
    if (!row.client_id) continue;
    if (bucketAccount(row.account) !== "revenue") continue;
    revenueByClient.set(row.client_id, (revenueByClient.get(row.client_id) || 0) + (Number(row.credit || 0) - Number(row.debit || 0)));
  }
  const clientIds = Array.from(revenueByClient.keys());
  const clientRows = clientIds.length
    ? await query<any>(`SELECT client_id, client_name, service_type FROM altax.v3_clients WHERE client_id = ANY($1::text[])`, [clientIds])
    : [];
  const clientMeta = new Map(clientRows.map((c: any) => [c.client_id, c]));

  const totalRevenue = Array.from(revenueByClient.values()).reduce((sum, v) => sum + v, 0);

  const revenueByServiceMap = new Map<string, number>();
  for (const [clientId, revenue] of revenueByClient) {
    const serviceType = clientMeta.get(clientId)?.service_type || "(not set)";
    revenueByServiceMap.set(serviceType, (revenueByServiceMap.get(serviceType) || 0) + revenue);
  }
  const revenueByServiceType = Array.from(revenueByServiceMap.entries())
    .map(([serviceType, revenue]) => ({
      serviceType, revenue: round2(revenue), pctOfTotal: totalRevenue > 0 ? round2((revenue / totalRevenue) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const clientConcentrationAll = Array.from(revenueByClient.entries())
    .map(([clientId, revenue]) => ({
      clientId, clientName: clientMeta.get(clientId)?.client_name || clientId,
      revenue: round2(revenue), pctOfTotal: totalRevenue > 0 ? round2((revenue / totalRevenue) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
  const clientConcentration = clientConcentrationAll.slice(0, 10);
  const top5Pct = round2(clientConcentrationAll.slice(0, 5).reduce((sum, c) => sum + c.pctOfTotal, 0));
  const top10Pct = round2(clientConcentrationAll.slice(0, 10).reduce((sum, c) => sum + c.pctOfTotal, 0));

  // --- MD On-Time Filing Rate: firm-wide rollup of the same per-client
  // classifyMdFilingPeriod math (mdFiling.ts) — every MD client with a real
  // sales-tax frequency, every period whose due date falls in [from, to]. ---
  const mdClients = await query<any>(
    `SELECT client_id, client_name, ein, address, state, sales_tax_frequency FROM altax.v3_clients
      WHERE state = 'MD' AND sales_tax_frequency IS NOT NULL AND sales_tax_frequency <> ''
            AND (status IS NULL OR lower(status) NOT IN ('no','false','inactive','archived'))`
  );
  let onTime = 0, late = 0, missing = 0, filedPendingPayment = 0, notYetDue = 0;
  for (const c of mdClients) {
    const reportClient: ReportClientInfo = {
      clientId: c.client_id, clientName: c.client_name, ein: c.ein, address: c.address, state: c.state, salesTaxFrequency: c.sales_tax_frequency,
    };
    const mdFiling = await computeMdFilingForReport(reportClient, from, to, undefined, undefined, { includeZeroTaxPeriods: true });
    if (!mdFiling) continue;
    for (const p of mdFiling.periods) {
      if (p.dueDate < from || p.dueDate > to) continue;
      const status = classifyMdFilingPeriod(p, to);
      if (status === "onTime") onTime++;
      else if (status === "late") late++;
      else if (status === "missing") missing++;
      else if (status === "filedPendingPayment") filedPendingPayment++;
      else notYetDue++;
    }
  }
  const decidedTotal = onTime + late + missing;
  const mdOnTimeFilingRate = {
    onTime, late, missing, filedPendingPayment, notYetDue, total: decidedTotal,
    pct: decidedTotal > 0 ? round2((onTime / decidedTotal) * 100) : null,
  };

  // --- Firm-Wide Filing Compliance: every task with a real agency due date —
  // federal, other states, payroll deposits, etc. — not just MD sales tax
  // (which keeps its own deeper penalty/discount-aware metric above). Same
  // on-time/late/missing classification shape as classifyMdFilingPeriod,
  // generalized: a task's "completed date" is its Filed Date if staff set
  // one, else (for a task that reached Completed status without ever
  // recording a Filed Date — about half of real archived tasks) the date it
  // was archived, since completing a task auto-archives it in this app. Open
  // v3_tasks rows are never "Completed" by definition (completion
  // auto-archives), so they only ever carry a real completedDate when staff
  // set Filed Date early without the task being done yet. ---
  const complianceRows = await query<any>(
    `SELECT service_line, agency_due_date, filed_date, NULL::timestamptz AS archived_at
       FROM altax.v3_tasks WHERE agency_due_date IS NOT NULL AND agency_due_date >= $1::date AND agency_due_date <= $2::date
     UNION ALL
     SELECT service_line, agency_due_date, filed_date, archived_at
       FROM altax.v3_archived_tasks WHERE agency_due_date IS NOT NULL AND agency_due_date >= $1::date AND agency_due_date <= $2::date`,
    [from, to]
  );
  let cOnTime = 0, cLate = 0, cMissing = 0, cNotYetDue = 0;
  const byServiceLineMap = new Map<string, { onTime: number; late: number; missing: number }>();
  for (const r of complianceRows) {
    const dueDate = new Date(r.agency_due_date).toISOString().slice(0, 10);
    const completedDate = r.filed_date
      ? new Date(r.filed_date).toISOString().slice(0, 10)
      : r.archived_at ? new Date(r.archived_at).toISOString().slice(0, 10) : null;
    const status: "onTime" | "late" | "missing" | "notYetDue" =
      completedDate !== null ? (completedDate <= dueDate ? "onTime" : "late") : dueDate < to ? "missing" : "notYetDue";
    if (status === "onTime") cOnTime++;
    else if (status === "late") cLate++;
    else if (status === "missing") cMissing++;
    else cNotYetDue++;
    if (status !== "notYetDue") {
      const line = r.service_line || "(not set)";
      const entry = byServiceLineMap.get(line) || { onTime: 0, late: 0, missing: 0 };
      entry[status] += 1;
      byServiceLineMap.set(line, entry);
    }
  }
  const cDecidedTotal = cOnTime + cLate + cMissing;
  const filingCompliance = {
    onTime: cOnTime, late: cLate, missing: cMissing, notYetDue: cNotYetDue, total: cDecidedTotal,
    pct: cDecidedTotal > 0 ? round2((cOnTime / cDecidedTotal) * 100) : null,
    byServiceLine: Array.from(byServiceLineMap.entries())
      .map(([serviceLine, s]) => {
        const decided = s.onTime + s.late + s.missing;
        return { serviceLine, onTime: s.onTime, late: s.late, missing: s.missing, pct: decided > 0 ? round2((s.onTime / decided) * 100) : null };
      })
      .sort((a, b) => (a.pct ?? -1) - (b.pct ?? -1)),
  };

  // --- Estimate Win Rate ---
  const estimateRows = await query<any>(
    `SELECT status FROM altax.v3_estimates WHERE estimate_date >= $1::date AND estimate_date <= $2::date`,
    [from, to]
  );
  const won = estimateRows.filter((r: any) => r.status === "Approved").length;
  const lost = estimateRows.filter((r: any) => r.status === "Declined").length;
  const stillOpen = estimateRows.length - won - lost;
  const estimateWinRate = {
    won, lost, stillOpen, totalCreated: estimateRows.length,
    winRatePct: won + lost > 0 ? round2((won / (won + lost)) * 100) : null,
  };

  // --- Client Growth: created_at reflects when a client record entered this
  // system, which for most of the client base was a single bulk data-migration
  // event rather than organic acquisition. Rather than present that as a fake
  // growth spike, any month whose new-client count is anomalously high is
  // flagged so the UI can visually separate "real" months from the migration. ---
  const newClientRows = await query<any>(
    `SELECT date_trunc('month', created_at)::date AS month, count(*)::int AS count
       FROM altax.v3_clients WHERE created_at >= $1::date AND created_at <= ($2::date + interval '1 day')
      GROUP BY 1 ORDER BY 1`,
    [from, to]
  );
  const BULK_IMPORT_THRESHOLD = 20;
  const clientGrowthMonthly = newClientRows.map((r: any) => ({
    month: new Date(r.month).toISOString().slice(0, 7),
    newClients: r.count,
    likelyBulkImport: r.count >= BULK_IMPORT_THRESHOLD,
  }));
  const activeClientCountRow = await queryOne<any>(
    `SELECT count(*)::int AS count FROM altax.v3_clients WHERE status IS NULL OR lower(status) NOT IN ('no','false','inactive','archived')`
  );
  const clientGrowth = {
    monthly: clientGrowthMonthly,
    activeClientCountNow: activeClientCountRow?.count ?? 0,
    note: "Months flagged likelyBulkImport had an unusually large jump in new client records and most likely reflect a one-time data migration, not real client acquisition — exclude those months when reading this as a growth trend.",
  };

  // --- Staff Utilization: hours logged per staff member, from real time-entry
  // history (v3_time_entries) — unlike client growth, this has no bulk-import
  // artifact, so it's a genuine trend from day one. ---
  const timeRows = await query<any>(
    `SELECT user_email, hours, billable, status FROM altax.v3_time_entries
      WHERE entry_date >= $1::date AND entry_date <= $2::date`,
    [from, to]
  );
  const byStaff = new Map<string, { totalHours: number; billableHours: number; approvedHours: number }>();
  for (const r of timeRows) {
    const entry = byStaff.get(r.user_email) || { totalHours: 0, billableHours: 0, approvedHours: 0 };
    const hours = Number(r.hours || 0);
    entry.totalHours += hours;
    if (r.billable) entry.billableHours += hours;
    if (r.status === "Approved") entry.approvedHours += hours;
    byStaff.set(r.user_email, entry);
  }
  const staffEmails = Array.from(byStaff.keys());
  const staffMeta = staffEmails.length
    ? await query<any>(`SELECT email, name FROM altax.v3_users WHERE email = ANY($1::text[])`, [staffEmails])
    : [];
  const staffNameByEmail = new Map(staffMeta.map((u: any) => [u.email, u.name]));
  const staffUtilization = Array.from(byStaff.entries())
    .map(([email, s]) => ({
      email, name: staffNameByEmail.get(email) || email,
      totalHours: round2(s.totalHours), billableHours: round2(s.billableHours),
      billablePct: s.totalHours > 0 ? round2((s.billableHours / s.totalHours) * 100) : 0,
      approvedHours: round2(s.approvedHours),
    }))
    .sort((a, b) => b.totalHours - a.totalHours);

  return {
    revenueByServiceType, clientConcentration, concentrationRisk: { top5Pct, top10Pct },
    mdOnTimeFilingRate, filingCompliance, estimateWinRate, clientGrowth, staffUtilization,
  };
}

reportsRouter.get("/firm-insights", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { from, to } = defaultFirmSummaryRange();
  const rangeFrom = String(req.query.from || "").slice(0, 10) || from;
  const rangeTo = String(req.query.to || "").slice(0, 10) || to;
  res.json(await computeFirmInsights(rangeFrom, rangeTo));
}));

/** Print-friendly PDF version of the Firm Report — same computeFirmInsights data as the JSON/CSV routes above, rendered as a real viewable/printable document via generateFirmInsightsPdf. */
reportsRouter.get("/pdf/firm-insights", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { from, to } = defaultFirmSummaryRange();
  const rangeFrom = String(req.query.from || "").slice(0, 10) || from;
  const rangeTo = String(req.query.to || "").slice(0, 10) || to;
  const insights = await computeFirmInsights(rangeFrom, rangeTo);

  const { generateFirmInsightsPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generateFirmInsightsPdf({ from: rangeFrom, to: rangeTo, ...insights });

  await logAudit("Reports", "GENERATE_FIRM_INSIGHTS_PDF", "Firm", "Period", "", `${rangeFrom} to ${rangeTo}`, `Firm Report PDF generated by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="FirmReport_${rangeFrom}_${rangeTo}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

/** One combined CSV/XLSX covering all 6 Firm Report sections — sectioned with blank-row separators since each metric has a different column shape, same {sendTabular} helper (and its ?format=xlsx toggle) as every other export in this file. */
reportsRouter.get("/csv/firm-insights", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { from, to } = defaultFirmSummaryRange();
  const rangeFrom = String(req.query.from || "").slice(0, 10) || from;
  const rangeTo = String(req.query.to || "").slice(0, 10) || to;
  const insights = await computeFirmInsights(rangeFrom, rangeTo);

  const rows: (string | number)[][] = [];
  rows.push(["Revenue by Service Type"]);
  rows.push(["Service Type", "Revenue", "% of Total"]);
  for (const r of insights.revenueByServiceType) rows.push([r.serviceType, r.revenue, r.pctOfTotal]);
  rows.push([]);

  rows.push([`Client Concentration (Top 5: ${insights.concentrationRisk.top5Pct}% · Top 10: ${insights.concentrationRisk.top10Pct}%)`]);
  rows.push(["Client", "Revenue", "% of Total"]);
  for (const c of insights.clientConcentration) rows.push([c.clientName, c.revenue, c.pctOfTotal]);
  rows.push([]);

  rows.push(["MD On-Time Filing Rate"]);
  rows.push(["On-Time Rate", "On Time", "Late", "Missing", "Filed Pending Payment", "Not Yet Due"]);
  rows.push([
    insights.mdOnTimeFilingRate.pct !== null ? `${insights.mdOnTimeFilingRate.pct}%` : "—",
    insights.mdOnTimeFilingRate.onTime, insights.mdOnTimeFilingRate.late, insights.mdOnTimeFilingRate.missing,
    insights.mdOnTimeFilingRate.filedPendingPayment, insights.mdOnTimeFilingRate.notYetDue,
  ]);
  rows.push([]);

  rows.push(["Firm-Wide Filing Compliance (all agencies — federal, state, payroll)"]);
  rows.push(["On-Time Rate", "On Time", "Late", "Missing", "Not Yet Due"]);
  rows.push([
    insights.filingCompliance.pct !== null ? `${insights.filingCompliance.pct}%` : "—",
    insights.filingCompliance.onTime, insights.filingCompliance.late, insights.filingCompliance.missing, insights.filingCompliance.notYetDue,
  ]);
  rows.push(["Service Line", "On-Time Rate", "On Time", "Late", "Missing"]);
  for (const s of insights.filingCompliance.byServiceLine) rows.push([s.serviceLine, s.pct !== null ? `${s.pct}%` : "—", s.onTime, s.late, s.missing]);
  rows.push([]);

  rows.push(["Estimate Win Rate"]);
  rows.push(["Win Rate", "Won", "Lost", "Still Open"]);
  rows.push([
    insights.estimateWinRate.winRatePct !== null ? `${insights.estimateWinRate.winRatePct}%` : "—",
    insights.estimateWinRate.won, insights.estimateWinRate.lost, insights.estimateWinRate.stillOpen,
  ]);
  rows.push([]);

  rows.push([`Client Growth (Active clients today: ${insights.clientGrowth.activeClientCountNow})`]);
  rows.push(["Month", "New Clients", "Likely Bulk Import"]);
  for (const m of insights.clientGrowth.monthly) rows.push([m.month, m.newClients, m.likelyBulkImport ? "Yes" : ""]);
  rows.push([]);

  rows.push(["Staff Utilization"]);
  rows.push(["Staff", "Total Hours", "Billable Hours", "Billable %"]);
  for (const s of insights.staffUtilization) rows.push([s.name, s.totalHours, s.billableHours, s.billablePct]);

  await logAudit("Reports", "EXPORT_FIRM_INSIGHTS_CSV", "Firm", "Period", "", `${rangeFrom} to ${rangeTo}`, `Firm Report ${String(req.query.format || "").toLowerCase() === "xlsx" ? "Excel" : "CSV"} exported by ${req.user!.email}.`, req.user!.email);
  sendTabular(req, res, "Firm Report", [`Firm Report: ${rangeFrom} to ${rangeTo}`], rows, `FirmReport_${rangeFrom}_${rangeTo}`);
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

// Display labels kept local to this report — the FORM_LABELS maps in
// govForms.routes.ts / poaForms.routes.ts are module-private and describe the
// full legal form name (fine for a filing detail page); this report wants a
// short line that fits one row in a list, so it's a deliberately separate,
// shorter set of labels rather than importing and reusing those.
const VALUE_REPORT_GOV_FORM_LABELS: Record<string, string> = {
  SS4: "IRS Form SS-4 (EIN Application)", "2553": "IRS Form 2553 (S-Corp Election)", W9: "IRS Form W-9",
  "8832": "IRS Form 8832 (Entity Classification)", W4: "IRS Form W-4", CRA: "MD Form CRA (Combined Registration)",
  "8822B": "IRS Form 8822-B (Change of Address)",
};
const VALUE_REPORT_POA_FORM_LABELS: Record<string, string> = {
  "2848": "IRS Form 2848 (Power of Attorney)", "8821": "IRS Form 8821 (Tax Information Authorization)", "548": "MD Form 548 (Power of Attorney)",
};

/**
 * "What we did for you this year" — a client-relationship deliverable
 * (see generateClientValueReportPdf) built from data the app already tracks:
 * completed tasks, gov-form/POA filings, HACCP packages, documents delivered,
 * and (admin only) billing. Defaults to the trailing 12 months when no
 * from/to query params are given.
 */
reportsRouter.get("/pdf/client-value-report/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });

  const to = String(req.query.to || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const fromDefault = (() => { const d = new Date(`${to}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString().slice(0, 10); })();
  const from = String(req.query.from || "").slice(0, 10) || fromDefault;
  // Without this, a reversed explicit range (e.g. a stale ?from= left over
  // from a swapped date picker) silently matches zero rows in every query
  // below — the requester gets a "successful" PDF with all-zero tiles and a
  // nonsensical period label instead of any indication their range was wrong.
  if (new Date(`${from}T00:00:00Z`).getTime() > new Date(`${to}T00:00:00Z`).getTime()) {
    return res.status(400).json({ error: "The \"From\" date must be on or before the \"To\" date." });
  }

  const tasksRows = await query<any>(
    `SELECT task_name, service_line, archived_at FROM altax.v3_archived_tasks
      WHERE client_id = $1 AND lower(status) = 'completed' AND archived_at BETWEEN $2 AND $3
      ORDER BY archived_at`,
    [client.clientId, from, to]
  );
  const govFormRows = await query<any>(
    `SELECT form_type, created_at FROM altax.v3_gov_form_filings
      WHERE client_id = $1 AND status <> 'Void' AND created_at BETWEEN $2 AND $3
      ORDER BY created_at`,
    [client.clientId, from, to]
  );
  const poaRows = await query<any>(
    `SELECT form_type, created_at FROM altax.v3_poa_filings
      WHERE client_id = $1 AND status <> 'Void' AND created_at BETWEEN $2 AND $3
      ORDER BY created_at`,
    [client.clientId, from, to]
  );
  const haccpRows = await query<any>(
    `SELECT business_name, created_at FROM altax.v3_haccp_plans
      WHERE client_id = $1 AND created_at BETWEEN $2 AND $3
      ORDER BY created_at`,
    [client.clientId, from, to]
  );
  // status='Generated' catches firm-produced files (HACCP packages, signed
  // gov forms); direction='Firm to Client' catches everything else staff
  // explicitly sent — together these exclude plain client/employee uploads,
  // which aren't something the firm "did for" the client. See haccp.routes.ts
  // save-to-documents and documents.routes.ts/communications.routes.ts sends.
  const docRows = await query<any>(
    `SELECT file_name, uploaded_at FROM altax.v3_document_uploads
      WHERE client_id = $1 AND uploaded_at BETWEEN $2 AND $3
        AND (status = 'Generated' OR direction = 'Firm to Client')
      ORDER BY uploaded_at`,
    [client.clientId, from, to]
  );

  const isAdmin = req.user!.role === "admin";
  let billing: { totalBilled: number; totalPaid: number; invoiceCount: number } | null = null;
  if (isAdmin) {
    const invoiceTotals = await queryOne<any>(
      `SELECT COALESCE(SUM(total_amount), 0) AS billed, COUNT(*)::int AS count
         FROM altax.v3_invoices WHERE client_id = $1 AND status <> 'Void' AND invoice_date BETWEEN $2 AND $3`,
      [client.clientId, from, to]
    );
    const paymentTotals = await queryOne<any>(
      `SELECT COALESCE(SUM(actual_amount), 0) AS paid
         FROM altax.v3_payments WHERE client_id = $1 AND payment_date BETWEEN $2 AND $3 AND status <> 'Reversed'`,
      [client.clientId, from, to]
    );
    billing = { totalBilled: Number(invoiceTotals?.billed || 0), totalPaid: Number(paymentTotals?.paid || 0), invoiceCount: Number(invoiceTotals?.count || 0) };
  }

  const filingsAndForms = [
    ...govFormRows.map((f: any) => ({ label: VALUE_REPORT_GOV_FORM_LABELS[f.form_type] || `Form ${f.form_type}`, date: new Date(f.created_at).toISOString() })),
    ...poaRows.map((f: any) => ({ label: VALUE_REPORT_POA_FORM_LABELS[f.form_type] || `Form ${f.form_type}`, date: new Date(f.created_at).toISOString() })),
    ...haccpRows.map((h: any) => ({ label: `HACCP / Food Safety Plan — ${h.business_name}`, date: new Date(h.created_at).toISOString() })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const { generateClientValueReportPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generateClientValueReportPdf({
    client,
    periodLabel: `${new Date(`${from}T00:00:00Z`).toLocaleDateString()} – ${new Date(`${to}T00:00:00Z`).toLocaleDateString()}`,
    preparedBy: req.user!.email,
    tasksCompleted: tasksRows.map((t: any) => ({ label: `${t.task_name}${t.service_line ? ` (${t.service_line})` : ""}`, date: new Date(t.archived_at).toISOString() })),
    filingsAndForms,
    documentsDelivered: docRows.map((d: any) => ({ label: d.file_name, date: new Date(d.uploaded_at).toISOString() })),
    billing,
  });

  await logAudit("Reports", "GENERATE_CLIENT_VALUE_REPORT_PDF", client.clientId, "", "", "", `Annual value report generated by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="AnnualValueReport_${client.clientId}_${from}_${to}.pdf"`);
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
 * Firm-wide client roster PDF — "Client Listing" (Code + Name) or "Client
 * Detailed Listing" (adds EIN/entity type/status/assigned staff), matching
 * a request modeled on a payroll platform's own equivalent report. ?clientIds=
 * (comma-separated) scopes to a picked subset; omitted means every client.
 * EIN is encrypted at rest (v3_clients.ein) — decryptClientPii runs on every
 * row before it ever reaches the PDF, same as every other EIN read in this
 * file, regardless of whether ?maskEin then re-masks it for display.
 */
reportsRouter.get("/pdf/client-listing", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const detailed = String(req.query.detailed || "") === "1";
  const maskEin = String(req.query.maskEin || "") === "1";
  const clientIdsParam = String(req.query.clientIds || "").trim();
  const clientIds = clientIdsParam ? clientIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : null;

  const rows = await query<any>(
    clientIds
      ? `SELECT client_id, client_name, ein, entity_type, status, assigned_to, address FROM altax.v3_clients WHERE client_id = ANY($1::text[]) ORDER BY client_name`
      : `SELECT client_id, client_name, ein, entity_type, status, assigned_to, address FROM altax.v3_clients ORDER BY client_name`,
    clientIds ? [clientIds] : []
  );
  const decrypted = rows.map((r: any) => decryptClientPii(r));

  const { generateClientListingPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generateClientListingPdf({
    rows: decrypted.map((r: any) => ({
      clientId: r.client_id, clientName: r.client_name, ein: r.ein, entityType: r.entity_type,
      status: r.status, assignedTo: r.assigned_to, address: r.address,
    })),
    detailed, maskEin,
  });

  await logAudit("Reports", "GENERATE_CLIENT_LISTING_PDF", "Firm", "Type", "", detailed ? "Detailed" : "Listing", `Client ${detailed ? "Detailed " : ""}Listing PDF generated by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${detailed ? "ClientDetailedListing" : "ClientListing"}_${new Date().toISOString().slice(0, 10)}.pdf"`);
  res.send(Buffer.from(pdfBytes));
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
// PERF-015 (Hard Audit, 2026-08-13) — this is a firm-wide account list (not
// client-scoped), but computeClientCashBalance runs once per client inside
// sweeps that loop over every client (nightly SWOT sweep, monthly snapshot
// sweep) — same TTL-cache shape as ensureCoaTypeCache just above, so a sweep
// over N clients hits this query once instead of N times.
let cashAccountsCache: string[] | null = null;
let cashAccountsCacheAt = 0;
const CASH_ACCOUNTS_CACHE_TTL_MS = 30_000;

async function loadCashAccountNames(): Promise<string[]> {
  if (cashAccountsCache && Date.now() - cashAccountsCacheAt < CASH_ACCOUNTS_CACHE_TTL_MS) return cashAccountsCache;
  const accounts = await query<any>(`SELECT account_name, detail_type FROM altax.v3_coa WHERE active = true AND account_type = 'Asset'`);
  cashAccountsCache = accounts
    .filter((a: any) => {
      const name = String(a.account_name || "").toLowerCase();
      const detail = String(a.detail_type || "").toLowerCase();
      return CASH_HINTS.some((h) => name.includes(h) || detail.includes(h));
    })
    .map((a: any) => a.account_name);
  cashAccountsCacheAt = Date.now();
  return cashAccountsCache;
}

export async function computeClientCashBalance(clientId: string): Promise<number> {
  const cashAccounts = await loadCashAccountNames();
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
  await ensureCoaTypeCache();
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
  else if (params.mdFilingOnTime === false) { compPts = 0; compDetail = "One or more sales tax filings are late or have no filing on record."; }
  components.push({ label: "Compliance", points: compPts, maxPoints: 10, detail: compDetail });

  const score = components.reduce((s, c) => s + c.points, 0);
  const band: "Green" | "Yellow" | "Red" = score >= 75 ? "Green" : score >= 50 ? "Yellow" : "Red";
  return { score, band, components };
}

/**
 * Firm-wide composite health score — same transparent points-+-components
 * shape as computeClientHealthScore (never shown as a bare number, always
 * with the breakdown), but scoring the FIRM's own condition instead of one
 * client's: profitability, revenue trend, AR aging, and task backlog reuse
 * that function's exact tiering (rescaled to fit this score's own weights);
 * Filing Compliance swaps in the firm-wide, all-agency figure
 * (computeFirmInsights.filingCompliance, not the MD-only per-client one)
 * since a firm-level score should reflect every jurisdiction, not just MD;
 * Staff Utilization is new here, with no per-client equivalent. Any
 * dimension with no decided data yet (e.g. no time entries logged) gets
 * full credit with a "not enough data" note, same "don't penalize what
 * can't be measured yet" convention computeClientHealthScore already uses
 * for mdFilingOnTime === null.
 */
export interface FirmHealthScore { score: number; band: "Green" | "Yellow" | "Red"; components: HealthScoreComponent[] }

export async function computeFirmHealthScore(from: string, to: string): Promise<FirmHealthScore> {
  const [summary, arAging, insights, taskRow] = await Promise.all([
    computeFirmSummary(from, to),
    computeArAging(),
    computeFirmInsights(from, to),
    queryOne<any>(
      `SELECT
         COUNT(*) FILTER (WHERE lower(status) NOT IN ('completed','void','closed','archived')) AS open_count,
         COUNT(*) FILTER (WHERE lower(status) NOT IN ('completed','void','closed','archived') AND agency_due_date IS NOT NULL AND agency_due_date::date < CURRENT_DATE) AS overdue_count
       FROM altax.v3_tasks`
    ),
  ]);
  const { trendPct } = computeRevenueTrend(summary.months);
  const netMarginPct = summary.totals.revenue > 0 ? Math.round((summary.totals.profit / summary.totals.revenue) * 1000) / 10 : null;

  const components: HealthScoreComponent[] = [];

  let profPts = 0;
  let profDetail = "No revenue recorded in this window.";
  if (netMarginPct !== null) {
    if (netMarginPct >= 15) { profPts = 25; profDetail = `Net margin ${netMarginPct}% (healthy, ≥15%).`; }
    else if (netMarginPct >= 5) { profPts = 17; profDetail = `Net margin ${netMarginPct}% (moderate, 5-15%).`; }
    else if (netMarginPct >= 0) { profPts = 8; profDetail = `Net margin ${netMarginPct}% (thin, 0-5%).`; }
    else { profPts = 0; profDetail = `Net margin ${netMarginPct}% (net loss).`; }
  }
  components.push({ label: "Profitability", points: profPts, maxPoints: 25, detail: profDetail });

  let trendPts = 9;
  let trendDetail = "Revenue roughly flat over the period.";
  if (trendPct !== null) {
    if (trendPct >= 10) { trendPts = 15; trendDetail = `Revenue up ${trendPct}% over the period.`; }
    else if (trendPct <= -10) { trendPts = 0; trendDetail = `Revenue down ${Math.abs(trendPct)}% over the period.`; }
    else { trendPts = 9; trendDetail = `Revenue roughly flat (${trendPct >= 0 ? "+" : ""}${trendPct}%).`; }
  }
  components.push({ label: "Revenue Trend", points: trendPts, maxPoints: 15, detail: trendDetail });

  let arPts = 15;
  let arDetail = "No overdue receivables.";
  if (arAging.totals.d90Plus > 0) { arPts = 0; arDetail = `${fmtMoney(arAging.totals.d90Plus)} over 90 days past due, firm-wide.`; }
  else if (arAging.totals.d61_90 > 0) { arPts = 5; arDetail = `${fmtMoney(arAging.totals.d61_90)} in the 61-90 day bucket, firm-wide.`; }
  else if (arAging.totals.total > 0) { arPts = 10; arDetail = `${fmtMoney(arAging.totals.total)} overdue, within 60 days, firm-wide.`; }
  components.push({ label: "AR Aging", points: arPts, maxPoints: 15, detail: arDetail });

  let compPts = 20;
  let compDetail = "No decided filing periods in this window.";
  if (insights.filingCompliance.pct !== null) {
    compPts = Math.round((insights.filingCompliance.pct / 100) * 20);
    compDetail = `${insights.filingCompliance.pct}% on-time across every agency (${insights.filingCompliance.late} late, ${insights.filingCompliance.missing} missing).`;
  }
  components.push({ label: "Filing Compliance", points: compPts, maxPoints: 20, detail: compDetail });

  const openCount = Number(taskRow?.open_count || 0);
  const overdueCount = Number(taskRow?.overdue_count || 0);
  const overduePct = openCount > 0 ? (overdueCount / openCount) * 100 : 0;
  let workPts = 15;
  let workDetail = "No open work.";
  if (openCount > 0) {
    if (overduePct >= 25) { workPts = 0; workDetail = `${overdueCount} of ${openCount} open tasks are overdue (${Math.round(overduePct)}%).`; }
    else if (overduePct >= 10) { workPts = 5; workDetail = `${overdueCount} of ${openCount} open tasks are overdue (${Math.round(overduePct)}%).`; }
    else if (overdueCount > 0) { workPts = 10; workDetail = `${overdueCount} of ${openCount} open tasks are overdue (${Math.round(overduePct)}%).`; }
    else { workPts = 15; workDetail = `${openCount} open tasks, none overdue.`; }
  }
  components.push({ label: "Overdue Work", points: workPts, maxPoints: 15, detail: workDetail });

  const staffWithHours = insights.staffUtilization.filter((s) => s.totalHours > 0);
  let staffPts = 10;
  let staffDetail = "Not enough time-tracking data yet.";
  if (staffWithHours.length > 0) {
    const avgBillablePct = staffWithHours.reduce((sum, s) => sum + s.billablePct, 0) / staffWithHours.length;
    if (avgBillablePct >= 70) { staffPts = 10; staffDetail = `${Math.round(avgBillablePct)}% average billable time across ${staffWithHours.length} staff.`; }
    else if (avgBillablePct >= 40) { staffPts = 6; staffDetail = `${Math.round(avgBillablePct)}% average billable time across ${staffWithHours.length} staff.`; }
    else { staffPts = 3; staffDetail = `${Math.round(avgBillablePct)}% average billable time across ${staffWithHours.length} staff.`; }
  }
  components.push({ label: "Staff Utilization", points: staffPts, maxPoints: 10, detail: staffDetail });

  const score = components.reduce((s, c) => s + c.points, 0);
  const band: "Green" | "Yellow" | "Red" = score >= 75 ? "Green" : score >= 50 ? "Yellow" : "Red";
  return { score, band, components };
}

reportsRouter.get("/firm-health-score", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { from, to } = defaultFirmSummaryRange();
  const rangeFrom = String(req.query.from || "").slice(0, 10) || from;
  const rangeTo = String(req.query.to || "").slice(0, 10) || to;
  res.json(await computeFirmHealthScore(rangeFrom, rangeTo));
}));

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
// "bank" was previously in this list to catch bank-account-named assets, but the only
// account anywhere in the system containing that substring is "Bank Fees" (an Expense
// account) — the keyword only ever misclassified it as an asset since ASSET_HINTS is
// checked before EXPENSE_HINTS. Removed rather than reordered, since no real asset
// account name depends on it (see reports.routes.ts git history for the incident).
const ASSET_HINTS = ["cash", "asset", "receivable"];
const LIABILITY_HINTS = ["payable", "liability", "tax payable"];
// Equity accounts (Owner Equity, Owner Draw, Retained Earnings, Opening Balance Equity,
// Owner Contributions, ...) were never a recognized bucket at all — they fell into
// "other", and loadBucketedGl's P&L expense filter treats "other" as an expense (a
// reasonable fallback for genuine-but-unlabeled expense accounts like "Dues and
// Subscriptions"), so every equity account silently showed up as a P&L expense line
// the moment it had any GL activity. Confirmed live on DEL Studio Architects' P&L
// (Opening Balance Equity, Retained Earnings, Owner Contributions all appeared under
// Expenses) before this fix.
const EQUITY_HINTS = ["equity", "retained earnings", "owner draw", "owner contribution"];

type Bucket = "income" | "cogs" | "expense" | "asset" | "liability" | "equity" | "other";
const COA_TYPE_TO_BUCKET: Record<string, Bucket> = {
  Income: "income", Revenue: "income", COGS: "cogs", Expense: "expense",
  Asset: "asset", Liability: "liability", Equity: "equity",
};

/**
 * Name-keyword guessing (below) used to be the only classification, and it's fragile by
 * construction: it has already misclassified "Bank Fees" as an asset and let Equity
 * accounts leak onto the P&L as expenses (see git history), simply because an account's
 * real category doesn't always show up as a substring of its name — "Bank Fees" is an
 * Expense, "Furniture and Equipment" is an Asset, "Prepaid Expenses" is an Asset despite
 * the word "expense" in it. The Chart of Accounts already carries the real, staff-assigned
 * account_type for every account, so that's now checked FIRST and is authoritative;
 * keyword-guessing only ever runs as a fallback for a GL account name with no COA row
 * (e.g. a stray/orphaned account, or COA type "Other" which isn't a real bucket).
 */
let coaTypeCache: Map<string, string> | null = null;
let coaTypeCacheAt = 0;
const COA_TYPE_CACHE_TTL_MS = 30_000;

async function ensureCoaTypeCache(): Promise<void> {
  if (coaTypeCache && Date.now() - coaTypeCacheAt < COA_TYPE_CACHE_TTL_MS) return;
  const rows = await query<any>(`SELECT account_name, account_type FROM altax.v3_coa`);
  const next = new Map<string, string>();
  for (const r of rows) next.set(String(r.account_name || "").toLowerCase(), r.account_type);
  coaTypeCache = next;
  coaTypeCacheAt = Date.now();
}

function bucketFor(account: string): Bucket {
  const a = String(account || "").toLowerCase();
  const coaType = coaTypeCache?.get(a);
  const coaBucket = coaType ? COA_TYPE_TO_BUCKET[coaType] : undefined;
  if (coaBucket) return coaBucket;
  if (INCOME_TYPES.some((t) => a.includes(t.toLowerCase()))) return "income";
  if (COGS_TYPES.some((t) => a.includes(t.toLowerCase()))) return "cogs";
  if (LIABILITY_HINTS.some((t) => a.includes(t))) return "liability";
  if (ASSET_HINTS.some((t) => a.includes(t))) return "asset";
  if (EQUITY_HINTS.some((t) => a.includes(t))) return "equity";
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
/**
 * Recorded actual filing/payment dates (v3_md_filing_payments) within a
 * period-end range, keyed by period_end ISO string. Exported so
 * computeClientFlags (clients.routes.ts) can check whether a period has
 * actually been marked filed WITHOUT going through computeMdFilingForReport
 * — that path silently drops any period whose summed tax comes to $0 (see
 * computeMdFilingBreakdown's `if (taxDue <= 0) continue`), which is exactly
 * the nil/no-data-yet case a "still needs to be filed" flag has to catch.
 */
export async function loadRecordedMdFilingPayments(clientId: string, expandedFrom: string, expandedTo: string): Promise<Map<string, { filedDate: string; paidDate: string | null }>> {
  const rows = await query<{ period_end: string; filed_date: string; paid_date: string | null }>(
    `SELECT period_end::date::text AS period_end, filed_date::date::text AS filed_date, paid_date::date::text AS paid_date
       FROM altax.v3_md_filing_payments
      WHERE client_id = $1 AND period_end::date >= $2::date AND period_end::date <= $3::date`,
    [clientId, expandedFrom, expandedTo]
  );
  return new Map(rows.map((r) => [r.period_end, { filedDate: r.filed_date, paidDate: r.paid_date }]));
}

/**
 * A client's real MD sales-tax filing frequency history (v3_client_sales_tax_
 * frequency_history), ordered oldest-first — see splitIntoMdFilingPeriodsForClient
 * in mdFiling.ts for why period math needs this instead of just the client's
 * current sales_tax_frequency. Empty array (not null) when a client has no
 * history rows at all, which the splitter treats as "fall back to the plain
 * single-frequency behavior" — same fallback this returns if the table
 * itself doesn't exist yet (code and its own migration deploy on different
 * clocks; see the identical try/catch on GET /clients/:clientId).
 */
export async function loadSalesTaxFrequencyHistory(clientId: string): Promise<{ frequency: string; effectiveFrom: string; effectiveTo: string | null }[]> {
  try {
    const rows = await query<{ frequency: string; effective_from: string; effective_to: string | null }>(
      `SELECT frequency, effective_from::date::text AS effective_from, effective_to::date::text AS effective_to
         FROM altax.v3_client_sales_tax_frequency_history
        WHERE client_id = $1
        ORDER BY effective_from ASC`,
      [clientId]
    );
    return rows.map((r) => ({ frequency: r.frequency, effectiveFrom: r.effective_from, effectiveTo: r.effective_to }));
  } catch {
    return [];
  }
}

/** Batched version of loadSalesTaxFrequencyHistory for sweeps that touch many clients at once (avoids one query per client). */
export async function loadSalesTaxFrequencyHistoryBatch(clientIds: string[]): Promise<Map<string, { frequency: string; effectiveFrom: string; effectiveTo: string | null }[]>> {
  const map = new Map<string, { frequency: string; effectiveFrom: string; effectiveTo: string | null }[]>();
  if (clientIds.length === 0) return map;
  let rows: { client_id: string; frequency: string; effective_from: string; effective_to: string | null }[];
  try {
    rows = await query<{ client_id: string; frequency: string; effective_from: string; effective_to: string | null }>(
      `SELECT client_id, frequency, effective_from::date::text AS effective_from, effective_to::date::text AS effective_to
         FROM altax.v3_client_sales_tax_frequency_history
        WHERE client_id = ANY($1::text[])
        ORDER BY effective_from ASC`,
      [clientIds]
    );
  } catch {
    return map;
  }
  for (const r of rows) {
    if (!map.has(r.client_id)) map.set(r.client_id, []);
    map.get(r.client_id)!.push({ frequency: r.frequency, effectiveFrom: r.effective_from, effectiveTo: r.effective_to });
  }
  return map;
}

export async function computeMdFilingForReport(
  client: ReportClientInfo,
  from: string,
  to: string,
  filedDateOverride?: string,
  paidDateOverride?: string,
  options?: { includeZeroTaxPeriods?: boolean }
) {
  if (client.state !== "MD") return null;
  const { splitIntoMdFilingPeriodsForClient, computeMdFilingBreakdown } = await import("../../common/mdFiling");
  const history = await loadSalesTaxFrequencyHistory(client.clientId);
  const periodsResult = splitIntoMdFilingPeriodsForClient(from, to, history, client.salesTaxFrequency);
  const { periods } = periodsResult;
  if (periods.length === 0) return null;
  const expandedFrom = periods[0].start;
  const expandedTo = periods[periods.length - 1].end;
  const [sales, recordedFilings] = await Promise.all([
    loadSalesDatesAndTaxForPeriod(client.clientId, expandedFrom, expandedTo),
    loadRecordedMdFilingPayments(client.clientId, expandedFrom, expandedTo),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const filedDate = filedDateOverride && /^\d{4}-\d{2}-\d{2}$/.test(filedDateOverride) ? filedDateOverride : today;
  const paidDate = paidDateOverride && /^\d{4}-\d{2}-\d{2}$/.test(paidDateOverride) ? paidDateOverride : today;
  const breakdown = await computeMdFilingBreakdown(sales, from, to, client.salesTaxFrequency, filedDate, paidDate, recordedFilings, periodsResult, options);
  if (breakdown.periods.length === 0) return null;
  return { ...breakdown, filedDate, paidDate };
}

export interface MdSalesTaxMissedFiling {
  clientId: string;
  clientName: string;
  periodEnd: string;
  dueDate: string;
  balanceDue: number;
}

/**
 * Firm-wide, bulk-queryable counterpart to computeMdFilingForReport — used by
 * GET /clients/flags (UX-001's at-risk panel) so "has this client's most
 * recent MD Sales Tax period actually been filed" shows up as one real
 * cross-client list, instead of only appearing when someone opens that one
 * client's own page (that gap was called out explicitly in this function's
 * own history — see the "Deliberately excludes" doc comment on GET /flags in
 * clients.routes.ts — this closes it per a direct owner request, 2026-08-13:
 * "I need to see a flag telling me this client [is] missing something...
 * auto not just by task").
 *
 * Stays flat-cost regardless of client count: two bulk queries cover every
 * MD client's sales data and recorded filings in one round trip each, and
 * the period math itself needs no DB call (splitIntoMdFilingPeriods is pure
 * date arithmetic). Only the small subset of clients that actually turn out
 * unfiled-and-overdue get the one extra call for penalty/interest math
 * (computeMdFiling, which does its own rate lookups) — that cost scales with
 * real problems found, not with total client count.
 *
 * Deliberately checks only each client's single most-recently-due period,
 * not every historical gap — this answers "did I miss filing for anyone
 * this cycle," the exact workflow described, not a full compliance-history
 * audit back to whenever Mark Period Filed started being used.
 */
export async function computeFirmWideMdSalesTaxMissedFilings(): Promise<MdSalesTaxMissedFiling[]> {
  const clients = await query<any>(
    `SELECT client_id, client_name, sales_tax_frequency FROM altax.v3_clients
      WHERE state = 'MD' AND sales_tax_frequency IS NOT NULL AND sales_tax_frequency <> ''`
  );
  if (clients.length === 0) return [];

  const today = new Date();
  const windowFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 13, 1)).toISOString().slice(0, 10);
  const windowTo = today.toISOString().slice(0, 10);
  const clientIds = clients.map((c: any) => c.client_id);

  const [salesRows, filingRows] = await Promise.all([
    query<any>(
      `SELECT client_id, sale_date, total_tax_due FROM altax.v3_sales_input
        WHERE client_id = ANY($1::text[]) AND sale_date::date >= $2::date AND sale_date::date <= $3::date`,
      [clientIds, windowFrom, windowTo]
    ),
    query<any>(
      `SELECT client_id, period_end::date::text AS period_end FROM altax.v3_md_filing_payments WHERE client_id = ANY($1::text[])`,
      [clientIds]
    ),
  ]);

  const isoDateOnly = (v: unknown): string | null => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);

  const salesByClient = new Map<string, { date: string; taxDue: number }[]>();
  for (const r of salesRows) {
    const d = isoDateOnly(r.sale_date);
    if (!d) continue;
    if (!salesByClient.has(r.client_id)) salesByClient.set(r.client_id, []);
    salesByClient.get(r.client_id)!.push({ date: d, taxDue: Number(r.total_tax_due || 0) });
  }
  const recordedByClient = new Map<string, Set<string>>();
  for (const r of filingRows) {
    if (!recordedByClient.has(r.client_id)) recordedByClient.set(r.client_id, new Set());
    recordedByClient.get(r.client_id)!.add(r.period_end);
  }

  const { splitIntoMdFilingPeriodsForClient, computeMdFiling } = await import("../../common/mdFiling");
  const historyByClient = await loadSalesTaxFrequencyHistoryBatch(clients.map((c) => c.client_id));
  const candidates: { clientId: string; clientName: string; period: MdFilingPeriod; taxDue: number }[] = [];
  for (const c of clients) {
    const { periods } = splitIntoMdFilingPeriodsForClient(windowFrom, windowTo, historyByClient.get(c.client_id), c.sales_tax_frequency);
    const mostRecentPastDue = periods.filter((p) => p.dueDate < windowTo).sort((a, b) => b.end.localeCompare(a.end))[0];
    if (!mostRecentPastDue) continue;
    const recorded = recordedByClient.get(c.client_id);
    if (recorded?.has(mostRecentPastDue.end)) continue; // already marked filed — settled
    const sales = salesByClient.get(c.client_id) || [];
    const taxDue = sales
      .filter((s) => s.date >= mostRecentPastDue.start && s.date <= mostRecentPastDue.end)
      .reduce((sum, s) => sum + s.taxDue, 0);
    if (taxDue > 0) candidates.push({ clientId: c.client_id, clientName: c.client_name, period: mostRecentPastDue, taxDue: Math.round(taxDue * 100) / 100 });
  }
  if (candidates.length === 0) return [];

  const results: MdSalesTaxMissedFiling[] = [];
  for (const { clientId, clientName, period, taxDue } of candidates) {
    const filing = await computeMdFiling(taxDue, period.dueDate, windowTo, windowTo);
    if (!filing.onTime) results.push({ clientId, clientName, periodEnd: period.end, dueDate: period.dueDate, balanceDue: filing.balanceDue });
  }
  return results;
}

export interface ManagementException {
  severity: "critical" | "warning";
  label: string;
  count: number;
  amount?: number;
  detail: string;
  link: string;
}

/**
 * "Management manages exceptions, not thousands of records" — a single
 * ranked list (critical first, then warning; by count within each tier)
 * pulling together signals that already exist as separate DashboardPage
 * panels (At-Risk Clients, Missing Sales Tax Filings, Verification Due) plus
 * a couple of direct counts (overdue tasks, overdue invoices, AR aging) —
 * intentionally reuses computeArAging/computeFirmWideMdSalesTaxMissedFilings
 * rather than re-deriving the same numbers a second way. Deliberately does
 * NOT include client-level manual flags (computeClientFlags) — that logic
 * lives in clients.routes.ts and isn't bulk-queryable without the kind of
 * larger refactor computeFirmWideMdSalesTaxMissedFilings itself needed; left
 * for a follow-up rather than duplicating per-client N+1 queries here.
 * As-of-today only (no from/to) — this reports current risk, not a period.
 */
export async function computeManagementExceptions(): Promise<ManagementException[]> {
  const [arAging, mdMissed, overdueTaskRow, verificationRows, overdueInvoiceRow, noticesOverdueRows, noticesDueSoonRows, overdueReturnsRows] = await Promise.all([
    computeArAging(),
    computeFirmWideMdSalesTaxMissedFilings(),
    queryOne<any>(
      `SELECT COUNT(*)::int AS count FROM altax.v3_tasks
        WHERE lower(status) NOT IN ('completed','void','closed','archived')
          AND agency_due_date IS NOT NULL AND agency_due_date::date < CURRENT_DATE`
    ),
    // Was COUNT(*)-only — every row here now carries client_id too, so the
    // exception can link straight to the worst offender's own record instead
    // of a bare, unfiltered list page (owner's own words: "clicking on any
    // item row does not take us to the exact item but it goes to the general
    // page"). ORDER BY picks the single most overdue as the link target;
    // count/amount for the summary line still comes from the full row set.
    query<any>(
      `SELECT client_id, mdtaxconnect_verified_at, md_business_express_verified_at FROM altax.v3_clients
        WHERE state = 'MD' AND (status IS NULL OR lower(status) NOT IN ('no','false','inactive','archived'))
          AND (mdtaxconnect_verified_at IS NULL OR mdtaxconnect_verified_at <= CURRENT_DATE - INTERVAL '30 days'
               OR md_business_express_verified_at IS NULL OR md_business_express_verified_at <= CURRENT_DATE - INTERVAL '30 days')
        ORDER BY LEAST(COALESCE(mdtaxconnect_verified_at, '1900-01-01'), COALESCE(md_business_express_verified_at, '1900-01-01')) ASC`
    ),
    queryOne<any>(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(balance_due), 0) AS total FROM altax.v3_invoices
        WHERE lower(status) NOT IN ('paid', 'void') AND balance_due > 0
          AND due_date IS NOT NULL AND due_date::date < CURRENT_DATE`
    ),
    query<any>(
      `SELECT client_id, response_deadline::date::text AS response_deadline FROM altax.v3_notices
        WHERE status <> 'Resolved' AND response_deadline IS NOT NULL AND response_deadline::date < CURRENT_DATE
        ORDER BY response_deadline ASC`
    ),
    query<any>(
      `SELECT client_id, response_deadline::date::text AS response_deadline FROM altax.v3_notices
        WHERE status <> 'Resolved' AND response_deadline IS NOT NULL
          AND response_deadline::date >= CURRENT_DATE AND response_deadline::date <= CURRENT_DATE + INTERVAL '7 days'
        ORDER BY response_deadline ASC`
    ),
    query<any>(
      `SELECT client_id, due_date::date::text AS due_date FROM altax.v3_tax_returns
        WHERE status NOT IN ('Accepted', 'Completed') AND due_date IS NOT NULL AND due_date::date < CURRENT_DATE
        ORDER BY due_date ASC`
    ),
  ]);

  const items: ManagementException[] = [];
  // Every exception below links to one specific client (the worst/most
  // overdue) rather than a blank list page — but the label/count still
  // describes everyone affected, so a multi-client exception needs this
  // said explicitly or clicking "3 client(s)" and landing on just one reads
  // as broken rather than as "here's the most urgent one first."
  const clickHint = (n: number) => (n > 1 ? " Click for the most urgent." : "");

  if (arAging.totals.d90Plus > 0) {
    const worstClients = arAging.rows.filter((r: any) => r.d90Plus > 0);
    items.push({
      severity: "critical", label: "A/R over 90 days past due",
      count: worstClients.length, amount: arAging.totals.d90Plus,
      detail: `${fmtMoney(arAging.totals.d90Plus)} across ${worstClients.length} client(s).${clickHint(worstClients.length)}`,
      link: `/billing?clientId=${worstClients[0].clientId}`,
    });
  }
  if (mdMissed.length > 0) {
    const total = mdMissed.reduce((s, f) => s + f.balanceDue, 0);
    // Same deep-link shape as the At-Risk Clients / Missing Sales Tax Filings
    // panels' own mdSalesTaxDeepLink() (frontend/src/pages/DashboardPage.tsx)
    // — a year-plus lookback ending on the missed period so the actual unfiled
    // period is guaranteed to be on screen without a second click to widen it.
    const worst = mdMissed[0];
    const periodEnd = new Date(`${worst.periodEnd}T00:00:00Z`);
    const from = new Date(periodEnd);
    from.setUTCDate(from.getUTCDate() - 370);
    items.push({
      severity: "critical", label: "Missed MD Sales Tax filings", count: mdMissed.length, amount: total,
      detail: `${mdMissed.length} client(s), ${fmtMoney(total)} tax due.${clickHint(mdMissed.length)}`,
      link: `/accounting?client=${worst.clientId}&tab=Sales&from=${from.toISOString().slice(0, 10)}&to=${worst.periodEnd}`,
    });
  }
  const overdueTasks = Number(overdueTaskRow?.count || 0);
  if (overdueTasks > 0) {
    items.push({ severity: "critical", label: "Overdue tasks", count: overdueTasks, detail: `${overdueTasks} task(s) past their agency due date.`, link: "/tasks?tab=Overdue" });
  }
  const overdueInvoiceCount = Number(overdueInvoiceRow?.count || 0);
  if (overdueInvoiceCount > 0) {
    const total = Number(overdueInvoiceRow?.total || 0);
    items.push({ severity: "warning", label: "Overdue invoices", count: overdueInvoiceCount, amount: total, detail: `${overdueInvoiceCount} invoice(s), ${fmtMoney(total)} outstanding.`, link: "/billing?status=Overdue" });
  }
  if (arAging.totals.d61_90 > 0) {
    const worstClients = arAging.rows.filter((r: any) => r.d61_90 > 0);
    items.push({
      severity: "warning", label: "A/R in the 61-90 day bucket",
      count: worstClients.length, amount: arAging.totals.d61_90,
      detail: `${fmtMoney(arAging.totals.d61_90)} — will become critical (90+) if not collected soon.${clickHint(worstClients.length)}`,
      link: `/billing?clientId=${worstClients[0].clientId}`,
    });
  }
  if (verificationRows.length > 0) {
    items.push({
      severity: "warning", label: "MD portal verification overdue", count: verificationRows.length,
      detail: `${verificationRows.length} MD client(s) not checked in MDTAXCONNECT/MD Business Express in 30+ days.${clickHint(verificationRows.length)}`,
      link: `/clients/${verificationRows[0].client_id}`,
    });
  }
  if (noticesOverdueRows.length > 0) {
    items.push({
      severity: "critical", label: "IRS/state notice response deadlines missed", count: noticesOverdueRows.length,
      detail: `${noticesOverdueRows.length} open notice(s) past their response deadline.${clickHint(noticesOverdueRows.length)}`,
      link: `/clients/${noticesOverdueRows[0].client_id}`,
    });
  }
  if (noticesDueSoonRows.length > 0) {
    items.push({
      severity: "warning", label: "IRS/state notice deadlines within 7 days", count: noticesDueSoonRows.length,
      detail: `${noticesDueSoonRows.length} open notice(s) due to respond within a week.${clickHint(noticesDueSoonRows.length)}`,
      link: `/clients/${noticesDueSoonRows[0].client_id}`,
    });
  }
  if (overdueReturnsRows.length > 0) {
    items.push({
      severity: "critical", label: "Tax returns past their due date, not yet filed", count: overdueReturnsRows.length,
      detail: `${overdueReturnsRows.length} return(s) still in production past their due date.${clickHint(overdueReturnsRows.length)}`,
      link: `/clients/${overdueReturnsRows[0].client_id}`,
    });
  }

  const order: Record<string, number> = { critical: 0, warning: 1 };
  items.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
  return items;
}

reportsRouter.get("/management-exceptions", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json({ items: await computeManagementExceptions() });
}));

/**
 * No per-staff "expected hours" setting exists anywhere in this app yet
 * (v3_users has no such column) — building one is a real UI/schema decision
 * (per-person? role-based default? who edits it?), not something to guess
 * silently. Uses one clearly-labeled firm-wide default instead, so this is
 * honest about what it is: real logged hours (v3_time_entries) against a
 * flat assumption, not a per-person-tuned capacity model. Easy to swap for
 * a real per-staff setting later without changing this function's shape.
 */
const DEFAULT_CAPACITY_HOURS_PER_WEEK = 40;

export type StaffCapacityStatus = "Under Capacity" | "Healthy" | "Near Capacity" | "Over Capacity";
export interface StaffCapacity {
  email: string; name: string; capacityHours: number; loggedHours: number; availableHours: number; status: StaffCapacityStatus;
}

export async function computeStaffCapacity(from: string, to: string): Promise<StaffCapacity[]> {
  const periodDays = Math.max(1, Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000) + 1);
  const capacityHours = round2(DEFAULT_CAPACITY_HOURS_PER_WEEK * (periodDays / 7));

  const [staffRows, hoursRows] = await Promise.all([
    query<any>(`SELECT email, name FROM altax.v3_users WHERE lower(role) IN ('admin', 'staff') AND active = true`),
    query<any>(
      `SELECT user_email, COALESCE(SUM(hours), 0) AS hours FROM altax.v3_time_entries
        WHERE entry_date >= $1::date AND entry_date <= $2::date GROUP BY user_email`,
      [from, to]
    ),
  ]);
  const hoursByEmail = new Map(hoursRows.map((r: any) => [r.user_email, Number(r.hours)]));

  return staffRows
    .map((s: any) => {
      const loggedHours = round2(hoursByEmail.get(s.email) || 0);
      const availableHours = round2(capacityHours - loggedHours);
      const pctUsed = capacityHours > 0 ? (loggedHours / capacityHours) * 100 : 0;
      const status: StaffCapacityStatus = pctUsed >= 100 ? "Over Capacity" : pctUsed >= 85 ? "Near Capacity" : pctUsed >= 40 ? "Healthy" : "Under Capacity";
      return { email: s.email, name: s.name || s.email, capacityHours, loggedHours, availableHours, status };
    })
    .sort((a: StaffCapacity, b: StaffCapacity) => b.loggedHours - a.loggedHours);
}

reportsRouter.get("/staff-capacity", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { from, to } = defaultFirmSummaryRange();
  const rangeFrom = String(req.query.from || "").slice(0, 10) || from;
  const rangeTo = String(req.query.to || "").slice(0, 10) || to;
  res.json({ capacityHoursPerWeek: DEFAULT_CAPACITY_HOURS_PER_WEEK, staff: await computeStaffCapacity(rangeFrom, rangeTo) });
}));

const RECURRING_MIN_DISTINCT_MONTHS = 3;

export interface RecurringRevenue {
  mrr: number; arr: number;
  recurringClientCount: number; oneTimeClientCount: number;
  recurringRevenueTotal: number; oneTimeRevenueTotal: number;
  recurringPctOfTotal: number | null;
  windowFrom: string; windowTo: string;
}

/**
 * No "is this client a recurring engagement" flag exists anywhere in
 * v3_clients — service_type/services are what work they do, not how it's
 * billed. Rather than guess a business rule (which services "count" as
 * recurring is a real policy call, not a data fact), this classifies
 * empirically off actual GL revenue history: a client with revenue posted
 * in RECURRING_MIN_DISTINCT_MONTHS (3) or more separate months over the
 * trailing 12 months is "recurring" — their billing pattern repeats,
 * regardless of what service line it's under; everyone else (a single tax
 * return, a one-off registration) is "one-time." Always a trailing-12-month
 * window ending today, not the page's own from/to picker — MRR/ARR are
 * run-rate metrics ("as of now"), not a period comparison.
 */
export async function computeRecurringRevenue(): Promise<RecurringRevenue> {
  await ensureCoaTypeCache();
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1).toISOString().slice(0, 10);

  const rows = await query<any>(
    `SELECT client_id, to_char(entry_date, 'YYYY-MM') AS month, account, debit, credit
       FROM altax.v3_gl_entries WHERE entry_date >= $1::date AND entry_date <= $2::date`,
    [from, to]
  );
  const byClient = new Map<string, { months: Set<string>; total: number }>();
  for (const row of rows) {
    if (!row.client_id || bucketAccount(row.account) !== "revenue") continue;
    const revenue = Number(row.credit || 0) - Number(row.debit || 0);
    const entry = byClient.get(row.client_id) || { months: new Set<string>(), total: 0 };
    if (revenue !== 0) entry.months.add(row.month);
    entry.total += revenue;
    byClient.set(row.client_id, entry);
  }

  let recurringClientCount = 0, oneTimeClientCount = 0, recurringRevenueTotal = 0, oneTimeRevenueTotal = 0;
  for (const { months, total } of byClient.values()) {
    if (months.size >= RECURRING_MIN_DISTINCT_MONTHS) { recurringClientCount++; recurringRevenueTotal += total; }
    else { oneTimeClientCount++; oneTimeRevenueTotal += total; }
  }
  const totalRevenue = recurringRevenueTotal + oneTimeRevenueTotal;
  const mrr = round2(recurringRevenueTotal / 12);

  return {
    mrr, arr: round2(mrr * 12),
    recurringClientCount, oneTimeClientCount,
    recurringRevenueTotal: round2(recurringRevenueTotal), oneTimeRevenueTotal: round2(oneTimeRevenueTotal),
    recurringPctOfTotal: totalRevenue > 0 ? round2((recurringRevenueTotal / totalRevenue) * 100) : null,
    windowFrom: from, windowTo: to,
  };
}

reportsRouter.get("/recurring-revenue", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json(await computeRecurringRevenue());
}));

export interface QualityControlRow { type: string; count: number; totalDecided: number; rejectionRatePct: number | null; recentNotes: string[] }
export interface QualityControl {
  govFormRejections: QualityControlRow[];
  taxReturnRejections: QualityControlRow[];
  totalRejections: number;
  note: string;
}

/**
 * "The objective should be process improvement, not just employee scoring"
 * (the user's own spec) — grouped by form/return TYPE, not by who
 * prepared or reviewed it, even though both source tables carry that
 * info. Built from two real existing rejection signals rather than a new
 * complaint-tracking system invented from scratch:
 *  - v3_gov_form_filings.review_status = 'rejected' — an OPT-IN internal
 *    maker-checker step (sql/074); staff choose whether to route a filing
 *    through review at all, so rejectionRatePct is rejections ÷ every
 *    filing that WAS reviewed (approved or rejected), not ÷ every filing
 *    ever created — most filings never go through this step.
 *  - v3_tax_returns.status = 'Rejected' (this session's new tracking) — an
 *    actual agency e-file rejection, not an internal catch.
 * All-time, not a from/to window — both sources are low-volume enough
 * right now that a period filter would mostly just show zeros.
 */
export async function computeQualityControl(): Promise<QualityControl> {
  const [govRows, govReviewedRow, taxRows, taxTotalRow] = await Promise.all([
    query<any>(
      `SELECT form_type, review_note FROM altax.v3_gov_form_filings WHERE review_status = 'rejected' ORDER BY reviewed_at DESC`
    ),
    query<any>(
      `SELECT form_type, COUNT(*)::int AS count FROM altax.v3_gov_form_filings WHERE review_status IN ('approved', 'rejected') GROUP BY form_type`
    ),
    query<any>(
      `SELECT return_type, rejection_reason FROM altax.v3_tax_returns WHERE status = 'Rejected' ORDER BY updated_at DESC`
    ),
    query<any>(
      `SELECT return_type, COUNT(*)::int AS count FROM altax.v3_tax_returns GROUP BY return_type`
    ),
  ]);

  function buildRows(rejectedRows: any[], totalRows: any[], typeKey: string, noteKey: string): QualityControlRow[] {
    const totalByType = new Map(totalRows.map((r: any) => [r[typeKey], r.count]));
    const byType = new Map<string, { count: number; notes: string[] }>();
    for (const r of rejectedRows) {
      const entry = byType.get(r[typeKey]) || { count: 0, notes: [] };
      entry.count++;
      if (r[noteKey] && entry.notes.length < 3) entry.notes.push(r[noteKey]);
      byType.set(r[typeKey], entry);
    }
    return Array.from(byType.entries())
      .map(([type, { count, notes }]) => {
        const totalDecided = Number(totalByType.get(type) || count);
        return { type, count, totalDecided, rejectionRatePct: totalDecided > 0 ? round2((count / totalDecided) * 100) : null, recentNotes: notes };
      })
      .sort((a, b) => b.count - a.count);
  }

  const govFormRejections = buildRows(govRows, govReviewedRow, "form_type", "review_note");
  const taxReturnRejections = buildRows(taxRows, taxTotalRow, "return_type", "rejection_reason");

  return {
    govFormRejections, taxReturnRejections,
    totalRejections: govRows.length + taxRows.length,
    note: "Grouped by form/return type, not by staff — the goal is spotting a recurring process problem, not scoring individuals. All-time, not a period window.",
  };
}

reportsRouter.get("/quality-control", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json(await computeQualityControl());
}));

export interface CommunicationGapClient { clientId: string; clientName: string; lastContactAt: string | null; daysSinceContact: number | null }

/**
 * "Clients with no contact in X days" (spec item #22) — every active
 * client's most recent v3_communications row (COALESCE(sent_at, created_at)
 * — a Portal Note or a send that never actually went out still counts as
 * "we touched this client," which is the honest reading of "last contact,"
 * not "last successful external send"). thresholdDays defaults to 30;
 * clients with zero communications ever show as daysSinceContact: null,
 * sorted first (never contacted is worse than contacted 90 days ago).
 */
export async function computeCommunicationGaps(thresholdDays = 30): Promise<{ clients: CommunicationGapClient[]; thresholdDays: number }> {
  const rows = await query<any>(
    `SELECT c.client_id, c.client_name, MAX(COALESCE(comm.sent_at, comm.created_at)) AS last_contact
       FROM altax.v3_clients c
       LEFT JOIN altax.v3_communications comm ON comm.client_id = c.client_id
      WHERE (c.status IS NULL OR lower(c.status) NOT IN ('inactive', 'archived', 'no', 'false'))
      GROUP BY c.client_id, c.client_name`
  );
  const clients = rows
    .map((r: any) => {
      const lastContactAt = r.last_contact ? new Date(r.last_contact).toISOString() : null;
      const daysSinceContact = lastContactAt ? Math.floor((Date.now() - new Date(lastContactAt).getTime()) / 86400000) : null;
      return { clientId: r.client_id, clientName: r.client_name, lastContactAt, daysSinceContact };
    })
    .filter((c: CommunicationGapClient) => c.daysSinceContact === null || c.daysSinceContact >= thresholdDays)
    .sort((a: CommunicationGapClient, b: CommunicationGapClient) => (b.daysSinceContact ?? Infinity) - (a.daysSinceContact ?? Infinity));
  return { clients, thresholdDays };
}

reportsRouter.get("/communication-gaps", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const thresholdDays = req.query.thresholdDays ? Number(req.query.thresholdDays) : 30;
  res.json(await computeCommunicationGaps(Number.isFinite(thresholdDays) && thresholdDays > 0 ? thresholdDays : 30));
}));

export interface DocumentGapRow { requestId: string; clientId: string; clientName: string; requestedItem: string; assignedTo: string | null; daysWaiting: number }

/**
 * "Days waiting" per open document request (spec item #23) — same
 * open-status list DashboardPage.tsx's own openDocs filter already uses,
 * so this agrees with what staff see there. No "reminders sent" count
 * exists anywhere to surface (document-request reminders aren't tracked
 * as their own event) — flagged here rather than fabricated.
 */
export async function computeDocumentCollectionGaps(): Promise<{ rows: DocumentGapRow[]; totalOutstanding: number; avgDaysWaiting: number | null }> {
  const rows = await query<any>(
    `SELECT dr.request_id, dr.client_id, c.client_name, dr.requested_item, dr.assigned_to,
            EXTRACT(DAY FROM now() - dr.request_date)::int AS days_waiting
       FROM altax.v3_document_requests dr
       JOIN altax.v3_clients c ON c.client_id = dr.client_id
      WHERE dr.received_date IS NULL AND dr.request_date IS NOT NULL
            AND lower(dr.status) NOT IN ('closed', 'completed', 'void', 'archived')
      ORDER BY dr.request_date ASC`
  );
  const mapped = rows.map((r: any) => ({
    requestId: r.request_id, clientId: r.client_id, clientName: r.client_name,
    requestedItem: r.requested_item || "Document", assignedTo: r.assigned_to, daysWaiting: Number(r.days_waiting) || 0,
  }));
  const avgDaysWaiting = mapped.length > 0 ? round2(mapped.reduce((s: number, r: any) => s + r.daysWaiting, 0) / mapped.length) : null;
  return { rows: mapped, totalOutstanding: mapped.length, avgDaysWaiting };
}

reportsRouter.get("/document-collection-gaps", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json(await computeDocumentCollectionGaps());
}));

export type ProfitabilityTier = "Highly Profitable" | "Normal" | "Low Margin" | "Unprofitable";
export interface ClientProfitabilityRow {
  clientId: string; clientName: string; revenue: number; directCosts: number; profit: number;
  marginPct: number | null; arBalance: number; tier: ProfitabilityTier;
}

/**
 * Deliberately simplified per the user's own explicit choice (2026-08-20,
 * asked directly rather than guessing): Revenue - Direct Costs only, no
 * staff-time cost allocation — that needs a $/hour methodology decision
 * (flat rate? per-person?) the user chose to skip rather than answer right
 * now. "Direct Costs" = every GL entry bucketed expense/COGS and posted
 * under that CLIENT's own client_id (bucketFor via ensureCoaTypeCache) —
 * real costs actually attributed to serving them, not an allocated share
 * of firm overhead. Tiers are a reasonable default (not requested by the
 * user, easy to adjust): >=20% Highly Profitable, 10-20% Normal, 0-10% Low
 * Margin, <0 Unprofitable.
 */
export async function computeClientProfitability(from: string, to: string): Promise<ClientProfitabilityRow[]> {
  await ensureCoaTypeCache();
  const [glRows, arAging, clientRows] = await Promise.all([
    query<any>(
      `SELECT client_id, account, debit, credit FROM altax.v3_gl_entries
        WHERE entry_date >= $1::date AND entry_date <= $2::date AND client_id IS NOT NULL`,
      [from, to]
    ),
    computeArAging(),
    query<any>(`SELECT client_id, client_name FROM altax.v3_clients`),
  ]);
  const clientNameById = new Map(clientRows.map((c: any) => [c.client_id, c.client_name]));
  const arByClient = new Map(arAging.rows.map((r: any) => [r.clientId, r.total]));

  const byClient = new Map<string, { revenue: number; costs: number }>();
  for (const row of glRows) {
    const entry = byClient.get(row.client_id) || { revenue: 0, costs: 0 };
    const bucket = bucketAccount(row.account);
    if (bucket === "revenue") entry.revenue += Number(row.credit || 0) - Number(row.debit || 0);
    else if (bucket === "expense") entry.costs += Number(row.debit || 0) - Number(row.credit || 0);
    byClient.set(row.client_id, entry);
  }

  const rows: ClientProfitabilityRow[] = [];
  for (const [clientId, { revenue, costs }] of byClient) {
    if (revenue === 0 && costs === 0) continue;
    const profit = revenue - costs;
    const marginPct = revenue > 0 ? round2((profit / revenue) * 100) : null;
    const tier: ProfitabilityTier = marginPct === null ? "Unprofitable" : marginPct >= 20 ? "Highly Profitable" : marginPct >= 10 ? "Normal" : marginPct >= 0 ? "Low Margin" : "Unprofitable";
    rows.push({
      clientId, clientName: (clientNameById.get(clientId) as string) || clientId,
      revenue: round2(revenue), directCosts: round2(costs), profit: round2(profit), marginPct,
      arBalance: round2(Number(arByClient.get(clientId) || 0)), tier,
    });
  }
  return rows.sort((a, b) => b.profit - a.profit);
}

reportsRouter.get("/client-profitability", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { from, to } = defaultFirmSummaryRange();
  const rangeFrom = String(req.query.from || "").slice(0, 10) || from;
  const rangeTo = String(req.query.to || "").slice(0, 10) || to;
  res.json({ clients: await computeClientProfitability(rangeFrom, rangeTo) });
}));

// ---- Minimum Fee Schedule (item #21, Pricing & Fee Analysis) ----
// Checks actual invoiced totals against the firm's own floor — not the same
// thing as the "Subscription Fee Schedule" (v3_service_catalog, see
// serviceCatalog.routes.ts), which prices a client's monthly subscription
// from whichever services they're checked into. Deliberately separate.

function feeIdSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
}

reportsRouter.get("/minimum-fees", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query<any>(`SELECT * FROM altax.v3_minimum_fees ORDER BY service_key, variant NULLS FIRST`);
  res.json({ minimumFees: rows });
}));

reportsRouter.post("/minimum-fees", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const serviceKey = String(body.serviceKey || "").trim();
  const label = String(body.label || "").trim();
  const baseFee = Number(body.baseFee);
  if (!serviceKey) return res.status(400).json({ error: "Service is required." });
  if (!label) return res.status(400).json({ error: "Label is required." });
  if (!Number.isFinite(baseFee) || baseFee < 0) return res.status(400).json({ error: "Base fee must be a non-negative number." });

  const minFeeId = `MINFEE-${feeIdSuffix()}`;
  await query(
    `INSERT INTO altax.v3_minimum_fees
       (min_fee_id, service_key, label, variant, base_fee, per_unit_fee, per_unit_threshold, per_unit_label, billing_cadence, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      minFeeId, serviceKey, label, String(body.variant || "").trim() || null, baseFee,
      body.perUnitFee !== undefined && body.perUnitFee !== "" ? Number(body.perUnitFee) : null,
      body.perUnitThreshold !== undefined && body.perUnitThreshold !== "" ? Number(body.perUnitThreshold) : null,
      String(body.perUnitLabel || "").trim() || null,
      String(body.billingCadence || "monthly").trim(),
      req.user!.email,
    ]
  );
  await logAudit("MinimumFees", "CREATE", minFeeId, "", "", `${label} — ${fmtMoney(baseFee)}`, `Minimum fee added by ${req.user!.email}.`, req.user!.email);
  res.status(201).json({ ok: true, minFeeId });
}));

reportsRouter.patch("/minimum-fees/:minFeeId", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { minFeeId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_minimum_fees WHERE min_fee_id = $1`, [minFeeId]);
  if (!existing) return res.status(404).json({ error: "Minimum fee not found." });

  const body = req.body || {};
  const next = {
    label: body.label !== undefined ? String(body.label).trim() : existing.label,
    variant: body.variant !== undefined ? (String(body.variant).trim() || null) : existing.variant,
    baseFee: body.baseFee !== undefined ? Number(body.baseFee) : Number(existing.base_fee),
    perUnitFee: body.perUnitFee !== undefined ? (body.perUnitFee === "" ? null : Number(body.perUnitFee)) : existing.per_unit_fee,
    perUnitThreshold: body.perUnitThreshold !== undefined ? (body.perUnitThreshold === "" ? null : Number(body.perUnitThreshold)) : existing.per_unit_threshold,
    perUnitLabel: body.perUnitLabel !== undefined ? (String(body.perUnitLabel).trim() || null) : existing.per_unit_label,
    billingCadence: body.billingCadence !== undefined ? String(body.billingCadence).trim() : existing.billing_cadence,
    active: body.active !== undefined ? Boolean(body.active) : existing.active,
  };
  if (!Number.isFinite(next.baseFee) || next.baseFee < 0) return res.status(400).json({ error: "Base fee must be a non-negative number." });

  await query(
    `UPDATE altax.v3_minimum_fees SET
       label=$2, variant=$3, base_fee=$4, per_unit_fee=$5, per_unit_threshold=$6, per_unit_label=$7, billing_cadence=$8, active=$9, updated_at=now()
     WHERE min_fee_id = $1`,
    [minFeeId, next.label, next.variant, next.baseFee, next.perUnitFee, next.perUnitThreshold, next.perUnitLabel, next.billingCadence, next.active]
  );
  await logAudit("MinimumFees", "EDIT", minFeeId, "Base Fee", String(existing.base_fee), String(next.baseFee), `Minimum fee updated by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true, minFeeId });
}));

reportsRouter.post("/minimum-fees/:minFeeId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { minFeeId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_minimum_fees WHERE min_fee_id = $1`, [minFeeId]);
  if (!existing) return res.status(404).json({ error: "Minimum fee not found." });
  await query(`DELETE FROM altax.v3_minimum_fees WHERE min_fee_id = $1`, [minFeeId]);
  await logAudit("MinimumFees", "DELETE", minFeeId, "", "", "", `Minimum fee deleted by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

export type FeeComplianceStatus = "Below Minimum" | "At Minimum" | "Above Minimum" | "Not Enough Data";
export interface FeeComplianceRow {
  clientId: string; clientName: string; expectedMinimum: number; actualRevenue: number;
  gap: number; status: FeeComplianceStatus; servicesUsed: string[]; hasAnyRevenue: boolean;
}

/**
 * Compares real GL revenue per client against an EXPECTED MINIMUM built
 * from which services the client is actually enrolled in
 * (v3_clients.services[], matched against v3_minimum_fees.service_key) and
 * this app's real fee schedule — not a per-invoice-line match (invoices
 * aren't reliably categorized against these 5 service buckets), so this
 * answers "given what they're signed up for, did their total recorded
 * revenue at least clear the floor," not "was every single line item
 * priced correctly." Sales Tax uses the client's own sales_tax_frequency
 * to pick the right variant and to count how many filing periods fall in
 * the window; Payroll uses their real active v3_employees count against
 * the base_fee/per_unit_fee/per_unit_threshold structure, prorated by
 * month; Bookkeeping is a flat monthly fee prorated by month; Business/
 * Individual Tax Return are flat annual fees prorated by the fraction of a
 * year the window covers. A client with services[] set but no matching
 * active v3_minimum_fees row for what they're enrolled in is skipped
 * (nothing to compare against), not silently counted as $0 expected.
 *
 * hasAnyRevenue distinguishes "genuinely underpriced" (some revenue
 * recorded, still below the floor) from "no GL revenue recorded for this
 * client at all" (a billing/tracking gap, not a pricing verdict) — real
 * production data (2026-08-20) showed only 103 of 158 clients have ANY
 * GL revenue this year at all, so this distinction matters: without it,
 * "not billed" and "billed too little" would look identical.
 */
export async function computeFeeCompliance(from: string, to: string): Promise<FeeComplianceRow[]> {
  await ensureCoaTypeCache();
  const monthsInRange = Math.max(1, (new Date(`${to}T00:00:00Z`).getUTCFullYear() - new Date(`${from}T00:00:00Z`).getUTCFullYear()) * 12
    + (new Date(`${to}T00:00:00Z`).getUTCMonth() - new Date(`${from}T00:00:00Z`).getUTCMonth()) + 1);

  const [feeRows, clientRows, glRows, employeeRows] = await Promise.all([
    query<any>(`SELECT * FROM altax.v3_minimum_fees WHERE active = true`),
    query<any>(`SELECT client_id, client_name, services, sales_tax_frequency FROM altax.v3_clients WHERE services IS NOT NULL AND array_length(services, 1) > 0`),
    query<any>(`SELECT client_id, account, debit, credit FROM altax.v3_gl_entries WHERE entry_date >= $1::date AND entry_date <= $2::date AND client_id IS NOT NULL`, [from, to]),
    query<any>(`SELECT client_id, COUNT(*)::int AS count FROM altax.v3_employees WHERE lower(status) = 'active' GROUP BY client_id`),
  ]);

  const feesByServiceVariant = new Map<string, any>();
  for (const f of feeRows) feesByServiceVariant.set(`${f.service_key}::${f.variant || ""}`, f);
  const revenueByClient = new Map<string, number>();
  for (const row of glRows) {
    if (bucketAccount(row.account) !== "revenue") continue;
    revenueByClient.set(row.client_id, (revenueByClient.get(row.client_id) || 0) + (Number(row.credit || 0) - Number(row.debit || 0)));
  }
  const employeeCountByClient = new Map(employeeRows.map((r: any) => [r.client_id, r.count]));

  const rows: FeeComplianceRow[] = [];
  for (const c of clientRows) {
    const services: string[] = c.services || [];
    let expectedMinimum = 0;
    let hadAnyMatch = false;

    for (const key of services) {
      if (key === "sales_tax") {
        const freq = String(c.sales_tax_frequency || "").trim();
        const fee = feesByServiceVariant.get(`sales_tax::${freq}`);
        if (!fee) continue;
        hadAnyMatch = true;
        const periodsPerYear = freq === "Monthly" ? 12 : freq === "Quarterly" ? 4 : freq === "Semiannual" ? 2 : 0;
        const periodsInRange = periodsPerYear > 0 ? round2((periodsPerYear / 12) * monthsInRange) : 0;
        expectedMinimum += Number(fee.base_fee) * periodsInRange;
      } else if (key === "payroll") {
        const fee = feesByServiceVariant.get("payroll::");
        if (!fee) continue;
        hadAnyMatch = true;
        const employeeCount = Number(employeeCountByClient.get(c.client_id) || 0);
        const extraUnits = fee.per_unit_threshold != null ? Math.max(0, employeeCount - Number(fee.per_unit_threshold)) : 0;
        const monthlyFee = Number(fee.base_fee) + extraUnits * Number(fee.per_unit_fee || 0);
        expectedMinimum += monthlyFee * monthsInRange;
      } else if (key === "bookkeeping") {
        const fee = feesByServiceVariant.get("bookkeeping::");
        if (!fee) continue;
        hadAnyMatch = true;
        expectedMinimum += Number(fee.base_fee) * monthsInRange;
      } else if (key === "business_tax_prep" || key === "personal_tax_prep") {
        const fee = feesByServiceVariant.get(`${key}::`);
        if (!fee) continue;
        hadAnyMatch = true;
        expectedMinimum += Number(fee.base_fee) * (monthsInRange / 12);
      }
    }

    if (!hadAnyMatch) continue; // nothing in their service list has a fee schedule row — no basis for comparison
    const actualRevenue = round2(revenueByClient.get(c.client_id) || 0);
    expectedMinimum = round2(expectedMinimum);
    const gap = round2(actualRevenue - expectedMinimum);
    const status: FeeComplianceStatus = gap < -0.5 ? "Below Minimum" : gap > 0.5 ? "Above Minimum" : "At Minimum";
    rows.push({ clientId: c.client_id, clientName: c.client_name, expectedMinimum, actualRevenue, gap, status, servicesUsed: services, hasAnyRevenue: revenueByClient.has(c.client_id) });
  }
  return rows.sort((a, b) => a.gap - b.gap);
}

reportsRouter.get("/fee-compliance", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { from, to } = defaultFirmSummaryRange();
  const rangeFrom = String(req.query.from || "").slice(0, 10) || from;
  const rangeTo = String(req.query.to || "").slice(0, 10) || to;
  res.json({ clients: await computeFeeCompliance(rangeFrom, rangeTo) });
}));

/**
 * Income/COGS/Expense are period-flow accounts — they reset every fiscal year, so a P&L
 * legitimately only wants the activity strictly between `from` and `to`. Assets,
 * Liabilities, and Equity are point-in-time balances — a Balance Sheet "as of" a date
 * means everything since the account's first-ever entry through that date, not just
 * activity that happens to fall inside whatever `from` the caller picked. Using the same
 * from/to filter for both (as this used to) meant a Balance Sheet pulled for a short or
 * recent window — e.g. "8/1/2026-8/9/2026" — showed Cash and every liability as if the
 * business had no assets or debts before August, when in reality those balances just
 * predate the window. Confirmed live: a real client's Balance Sheet showed $0 for every
 * account under a narrow date range for exactly this reason.
 */
/** clientId omitted = firm-wide roll-up across every client's GL activity (used by the firm-wide P&L/Balance Sheet routes below), same optional-scope convention as computeFirmSummary. */
async function loadBucketedGl(clientId: string | undefined, from: string, to: string) {
  await ensureCoaTypeCache();
  const [periodRows, cumulativeRows] = await Promise.all([
    query<any>(
      `SELECT account, COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit
         FROM altax.v3_gl_entries
        WHERE entry_date::date >= $1::date AND entry_date::date <= $2::date ${clientId ? "AND client_id = $3" : ""}
        GROUP BY account ORDER BY account`,
      clientId ? [from, to, clientId] : [from, to]
    ),
    query<any>(
      `SELECT account, COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit
         FROM altax.v3_gl_entries
        WHERE entry_date::date <= $1::date ${clientId ? "AND client_id = $2" : ""}
        GROUP BY account ORDER BY account`,
      clientId ? [to, clientId] : [to]
    ),
  ]);
  const toLines = (rows: any[]): LedgerLine[] => rows.map((r) => ({ account: r.account || "Unclassified", debit: Number(r.debit) || 0, credit: Number(r.credit) || 0 }));
  const periodLines = toLines(periodRows);
  const cumulativeLines = toLines(cumulativeRows);
  return {
    income: periodLines.filter((l) => bucketFor(l.account) === "income"),
    cogs: periodLines.filter((l) => bucketFor(l.account) === "cogs"),
    expenses: periodLines.filter((l) => bucketFor(l.account) === "expense" || bucketFor(l.account) === "other"),
    assets: cumulativeLines.filter((l) => bucketFor(l.account) === "asset"),
    liabilities: cumulativeLines.filter((l) => bucketFor(l.account) === "liability"),
    all: periodLines,
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

/**
 * Same period's paychecks as loadPayrollForPeriod, split into one PayrollTaxRow[]
 * per employee instead of one firm-wide set — powers the Payroll Dashboard's
 * "Tax Liability by Employee" section (direct owner request, 2026-08-24: the
 * dashboard's existing Payroll Tax Summary only ever showed the firm-wide
 * total, with no way to see which employee a given dollar of withholding
 * belonged to without opening the separate Employee report). Reuses the same
 * raw paycheck columns loadPayrollForPeriod already sums firm-wide, just
 * grouped in JS instead of SQL — one query, not one per employee.
 */
export async function loadPayrollTaxByEmployee(clientId: string, from: string, to: string): Promise<{ employee: string; taxRows: PayrollTaxRow[] }[]> {
  const rows = await query<any>(
    `SELECT employee, federal_withholding, social_security_ee, social_security_er, medicare_ee, medicare_er, state_tax, suta, futa
       FROM altax.v3_paychecks
      WHERE client_id = $1 AND pay_date::date >= $2::date AND pay_date::date <= $3::date AND lower(status) <> 'void'
      ORDER BY employee`,
    [clientId, from, to]
  );
  const byEmployee = new Map<string, any[]>();
  for (const r of rows) {
    const key = r.employee || "Unknown";
    if (!byEmployee.has(key)) byEmployee.set(key, []);
    byEmployee.get(key)!.push(r);
  }
  return Array.from(byEmployee.entries()).map(([employee, empRows]) => {
    const sum = (col: string) => empRows.reduce((s, r) => s + (Number(r[col]) || 0), 0);
    const taxRows: PayrollTaxRow[] = [
      { label: "Federal Withholding", employee: sum("federal_withholding"), employer: 0 },
      { label: "Social Security", employee: sum("social_security_ee"), employer: sum("social_security_er") },
      { label: "Medicare", employee: sum("medicare_ee"), employer: sum("medicare_er") },
      { label: "MD Withholding", employee: sum("state_tax"), employer: 0 },
      { label: "MD Unemployment (SUTA)", employee: 0, employer: sum("suta") },
      { label: "Federal Unemployment (FUTA)", employee: 0, employer: sum("futa") },
    ];
    return { employee, taxRows };
  });
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
/**
 * Extracted so the "At a Glance" JSON route and the Client Profile PDF
 * below can share the exact same computation instead of the PDF
 * re-deriving (and risking drift from) these numbers a second way. Returns
 * null when the client doesn't exist — callers decide how to respond
 * (404 JSON vs. a PDF error), access-checking stays the caller's job too
 * (canAccessClient), same division of responsibility every other
 * compute* function in this file already uses.
 */
export async function computeClientDashboard(clientId: string) {
  const clientRow = decryptClientPii(await queryOne<any>(
    `SELECT client_id, client_name, ein, address, state, sales_tax_frequency, payroll_enabled, md_annual_report_enabled, entity_type, date_of_formation,
            eftps_enabled, md_withholding_frequency, mdui_enabled, business_return_type, client_type, w21099_enabled,
            state_tax_id, secretary_of_state_id, cra_registration_number, md_ui_employer_id, md_ui_tax_rate,
            company_contact_title, company_contact_address, payroll_frequency, payroll_system, notes,
            sales_tax_registered_since::date::text AS sales_tax_registered_since,
            eftps_registered_since::date::text AS eftps_registered_since,
            md_withholding_registered_since::date::text AS md_withholding_registered_since,
            mdui_registered_since::date::text AS mdui_registered_since
       FROM altax.v3_clients WHERE client_id = $1`,
    [clientId]
  ));
  if (!clientRow) return null;
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
  const mdFilingOnTime = clientRow.state === "MD" && mdFiling ? summarizeMdFilingOnTime(mdFiling.periods, to) : null;
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
  const [nextPayrollRow, has2553Row, completionRows] = await Promise.all([
    queryOne<any>(`SELECT MIN(next_pay_date) AS next_pay_date FROM altax.v3_payroll_schedules WHERE client_id = $1 AND status = 'Active'`, [clientId]),
    queryOne<any>(`SELECT 1 FROM altax.v3_gov_form_filings WHERE client_id = $1 AND form_type = '2553' AND status != 'Void' LIMIT 1`, [clientId]),
    query<any>(`SELECT source, due_date FROM altax.v3_obligation_completions WHERE client_id = $1`, [clientId]),
  ]);
  const completedKeys = new Set(completionRows.map((r: any) => `${r.source}|${new Date(r.due_date).toISOString().slice(0, 10)}`));
  // A period staff has already marked filed has nothing left pending, even if it
  // was filed late — showing its due date as an "upcoming deadline" would be
  // stale. Pick the last period that's still actually unresolved.
  const unresolvedMdPeriods = mdFiling ? mdFiling.periods.filter((p: any) => !p.markedPaidDate) : [];
  const deadlines = computeUpcomingDeadlines({
    mdCurrentPeriodDueDate: unresolvedMdPeriods.length > 0 ? unresolvedMdPeriods[unresolvedMdPeriods.length - 1].dueDate : null,
    payrollNextDate: nextPayrollRow?.next_pay_date ? new Date(nextPayrollRow.next_pay_date).toISOString().slice(0, 10) : null,
    payrollEnabled: Boolean(clientRow.payroll_enabled),
    mdAnnualReportEnabled: Boolean(clientRow.md_annual_report_enabled),
    entityType: clientRow.entity_type || null,
    dateOfFormation: clientRow.date_of_formation ? new Date(clientRow.date_of_formation).toISOString().slice(0, 10) : null,
    has2553Filing: Boolean(has2553Row),
    eftpsEnabled: Boolean(clientRow.eftps_enabled),
    mdWithholdingFrequency: clientRow.md_withholding_frequency || null,
    mduiEnabled: Boolean(clientRow.mdui_enabled),
    businessReturnType: clientRow.business_return_type || null,
    clientType: clientRow.client_type || null,
    w21099Enabled: Boolean(clientRow.w21099_enabled),
    completedKeys,
  });

  return {
    clientRow, reportClient,
    data: {
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
    },
  };
}

reportsRouter.get("/client-dashboard/:clientId", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const result = await computeClientDashboard(clientId);
  if (!result) return res.status(404).json({ error: "Client not found." });
  res.json(result.data);
}));

/**
 * Client Profile / At a Glance — printable summary combining the client's
 * own profile fields with the exact same financial/health/AR/deadline data
 * the on-screen "At a Glance" tab shows (computeClientDashboard above).
 * Neither "At a Glance" nor "Profile" had any print/PDF option before —
 * the earlier downloadFile() audit only checked for a missing view/print
 * PAIR on existing download buttons, which never catches a screen with no
 * download button at all (the exact gap the user flagged).
 */
reportsRouter.get("/pdf/client-profile/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  const variant = String(req.query.variant || "") === "at-a-glance" ? "at-a-glance" : "profile";
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  // Hard Audit finding, 2026-08-27: this route's "at-a-glance" variant
  // prints the exact consolidated financial dashboard (revenue, cash
  // balance, tax liabilities, health score, A/R aging, budget vs actual)
  // that the sibling JSON route (GET /client-dashboard/:clientId, above)
  // deliberately restricts to admin-only — that restriction was never
  // enforced here, letting any staff member with access to this client
  // pull the same data through the PDF export instead. The "profile"
  // variant doesn't render any of this, so only the at-a-glance variant
  // needs the gate. generateClientProfilePdf's at-a-glance section reads
  // data.financials/arAging/etc. unconditionally (no undefined-guards), so
  // this is a hard block rather than a redact-and-continue.
  if (variant === "at-a-glance" && req.user!.role !== "admin") {
    return res.status(403).json({ error: "Only an admin can generate the At a Glance PDF." });
  }
  const profileRow = await queryOne<any>(
    `SELECT phone, email, company_contact_name, company_contact_email, company_contact_phone, status, assigned_to, service_type, industry_category,
            client_type, entity_type, date_of_formation, state, services, preferred_contact, preferred_language,
            sms_allowed, email_allowed, portal_enabled, referral_source
       FROM altax.v3_clients WHERE client_id = $1`,
    [clientId]
  );
  const result = await computeClientDashboard(clientId);
  if (!result || !profileRow) return res.status(404).json({ error: "Client not found." });
  const cr = result.clientRow;

  let flags: any[] = [];
  let complianceScore: any = null;
  if (variant === "at-a-glance") {
    const flagsResult = await computeClientFlags(clientId);
    flags = flagsResult.flags;
    const timeline = await computeClientComplianceTimeline(clientId, cr);
    complianceScore = computeClientComplianceScore(timeline, flagsResult.gaps);
  }
  let salesTaxFrequencyEffectiveFrom: string | null = null;
  if (variant === "profile" && cr.sales_tax_frequency) {
    const history = await loadSalesTaxFrequencyHistory(clientId);
    const current = history.find((h) => h.effectiveTo === null) || history[history.length - 1];
    salesTaxFrequencyEffectiveFrom = current ? current.effectiveFrom : null;
  }

  const { generateClientProfilePdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generateClientProfilePdf({
    client: result.reportClient,
    phone: profileRow.phone, email: profileRow.email,
    companyContactName: profileRow.company_contact_name, companyContactEmail: profileRow.company_contact_email, companyContactPhone: profileRow.company_contact_phone,
    status: profileRow.status, assignedTo: profileRow.assigned_to, serviceType: profileRow.service_type, industryCategory: profileRow.industry_category,
    clientType: profileRow.client_type, entityType: profileRow.entity_type,
    dateOfFormation: profileRow.date_of_formation ? new Date(profileRow.date_of_formation).toISOString().slice(0, 10) : null,
    state: profileRow.state, services: (profileRow.services || []).map((k: string) => SERVICE_LABEL[k] || k),
    preferredContact: profileRow.preferred_contact || null, preferredLanguage: profileRow.preferred_language,
    smsAllowed: Boolean(profileRow.sms_allowed), emailAllowed: Boolean(profileRow.email_allowed),
    portalEnabled: Boolean(profileRow.portal_enabled), referralSource: profileRow.referral_source,
    // Business Tax IDs, Owner/Responsible Party, Payroll/Sales Tax/Tax Prep detail, Notes —
    // straight off computeClientDashboard's already-decrypted clientRow, not a second query.
    // Owner SSN is deliberately never included in a printed document.
    stateTaxId: cr.state_tax_id, secretaryOfStateId: cr.secretary_of_state_id, craRegistrationNumber: cr.cra_registration_number,
    mdUiEmployerId: cr.md_ui_employer_id, mdUiTaxRate: cr.md_ui_tax_rate != null ? Number(cr.md_ui_tax_rate) : null,
    ownerTitle: cr.company_contact_title, ownerAddress: cr.company_contact_address,
    payrollFrequency: cr.payroll_frequency, payrollSystem: cr.payroll_system,
    eftpsEnabled: Boolean(cr.eftps_enabled), mduiEnabled: Boolean(cr.mdui_enabled), w21099Enabled: Boolean(cr.w21099_enabled),
    mdWithholdingFrequency: cr.md_withholding_frequency,
    salesTaxFrequencyEffectiveFrom,
    businessReturnType: cr.business_return_type, mdAnnualReportEnabled: Boolean(cr.md_annual_report_enabled),
    notes: cr.notes,
    flags: flags.map((f: any) => ({ label: f.flagType, note: f.note, color: f.color })),
    complianceScore,
    ...result.data,
  }, variant);

  await logAudit("Reports", "GENERATE_CLIENT_PROFILE_PDF", clientId, "Variant", "", variant, `${variant === "at-a-glance" ? "At a Glance" : "Client Profile"} PDF generated by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${variant === "at-a-glance" ? "AtAGlance" : "ClientProfile"}_${clientId}.pdf"`);
  res.send(Buffer.from(pdfBytes));
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
      payrollCadenceGraceDays: body.payrollCadenceGraceDays !== undefined ? Number(body.payrollCadenceGraceDays) : undefined,
      bookkeepingStalenessDaysThreshold: body.bookkeepingStalenessDaysThreshold !== undefined ? Number(body.bookkeepingStalenessDaysThreshold) : undefined,
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

/** Firm-wide P&L — every client's GL activity rolled into one statement (item #2, "no firm-rollup P&L" from the Firm Command Center gap analysis). No path-collision risk with /pdf/pl/:clientId below — different segment counts, so order doesn't matter here (unlike GET /clients/flags vs /:clientId, a same-depth collision). */
reportsRouter.get("/pdf/pl", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });

  const gl = await loadBucketedGl(undefined, period.from, period.to);
  const totalIncome = gl.income.reduce((s, l) => s + (l.credit - l.debit), 0);
  const totalCogs = gl.cogs.reduce((s, l) => s + (l.debit - l.credit), 0);
  const totalExpenses = gl.expenses.reduce((s, l) => s + (l.debit - l.credit), 0);
  const grossProfit = totalIncome - totalCogs;

  const { generatePLPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generatePLPdf({
    client: null, from: period.from, to: period.to, income: gl.income, cogs: gl.cogs, expenses: gl.expenses,
    totalIncome, totalCogs, grossProfit, totalExpenses, netIncome: grossProfit - totalExpenses,
  });

  await logAudit("Reports", "GENERATE_PL_PDF", "Firm", "Period", "", `${period.from} - ${period.to}`, `Firm-wide P&L PDF generated by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="PL_Firm_${period.from}_${period.to}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

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

/** Firm-wide Balance Sheet — same firm-rollup treatment as /pdf/pl above. */
reportsRouter.get("/pdf/balance-sheet", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });

  const gl = await loadBucketedGl(undefined, period.from, period.to);
  const totalAssets = gl.assets.reduce((s, l) => s + (l.debit - l.credit), 0);
  const totalLiabilities = gl.liabilities.reduce((s, l) => s + (l.credit - l.debit), 0);

  const { generateBalanceSheetPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generateBalanceSheetPdf({
    client: null, from: period.from, to: period.to, assets: gl.assets, liabilities: gl.liabilities,
    totalAssets, totalLiabilities, totalEquity: totalAssets - totalLiabilities,
  });

  await logAudit("Reports", "GENERATE_BALANCE_SHEET_PDF", "Firm", "Period", "", `${period.from} - ${period.to}`, `Firm-wide Balance Sheet PDF generated by ${req.user!.email}.`, req.user!.email);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="BalanceSheet_Firm_${period.from}_${period.to}.pdf"`);
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

  const [payroll, taxByEmployee] = await Promise.all([
    loadPayrollForPeriod(client.clientId, period.from, period.to),
    loadPayrollTaxByEmployee(client.clientId, period.from, period.to),
  ]);
  const { generatePayrollPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generatePayrollPdf({ client, from: period.from, to: period.to, ...payroll, taxByEmployee });

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
  // "Employee_C-1097_2026-01-01_2026-12-24.pdf" was identical whether this was
  // the all-employees summary or one specific person's own report — a folder
  // of these was unreadable without opening each one. Slugged (not raw) so a
  // comma-containing "Last, First M" name doesn't produce an odd-looking
  // saved filename.
  const employeeSlug = employeeFilter ? `_${employeeFilter.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}` : "";
  res.setHeader("Content-Disposition", `attachment; filename="Employee_${client.clientId}${employeeSlug}_${period.from}_${period.to}.pdf"`);
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

  const mdFiledDate = String(req.query.mdFiledDate || "").trim() || undefined;
  const mdPaidDate = String(req.query.mdPaidDate || "").trim() || undefined;
  const table = await computeClientPeriodSummaryTable(client.clientId, period.from, period.to, mdFiledDate, mdPaidDate);
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
    `SELECT sale_date, total_tax_due, payment_date FROM altax.v3_sales_input WHERE client_id = $1 AND sale_date::date >= $2::date AND sale_date::date <= $3::date`,
    [clientId, from, to]
  );
  return rows.map((r: any) => ({ saleDate: r.sale_date, totalTaxDue: Number(r.total_tax_due) || 0, paymentDate: r.payment_date }));
}

export async function loadSalesTaxForPeriod(clientId: string, from: string, to: string) {
  const sales = await query<any>(
    `SELECT sale_id, sale_date, gross_sales, total_tax_due, adjustments
       FROM altax.v3_sales_input
      WHERE client_id = $1 AND sale_date::date >= $2::date AND sale_date::date <= $3::date
      ORDER BY sale_date`,
    [clientId, from, to]
  );
  // Taxed amount per sale — the sum of every category line EXCEPT an explicit
  // CAT-NON-TAXABLE tag. Non-Taxable Sales is then Gross − this figure, not just
  // whatever was explicitly tagged CAT-NON-TAXABLE: a client's own spreadsheet
  // (e.g. the Sales_Input importer) typically only breaks gross sales down into
  // its TAXED categories (6%/12%/20%/60%) and never carries a separate
  // "non-taxable" line at all — under the old logic that untracked remainder
  // silently got counted as "Taxable Sales" on this report even though no tax
  // was ever computed on it. Deriving it as a residual means every dollar of
  // gross sales lands in exactly one bucket, taxed or not, whether or not the
  // source data ever named the non-taxable portion explicitly.
  const taxedRows = await query<{ sale_id: string; amount: string }>(
    `SELECT l.sale_id, COALESCE(SUM(l.taxable_amount), 0) AS amount
       FROM altax.v3_sales_input_lines l
       JOIN altax.v3_sales_input s ON s.sale_id = l.sale_id
      WHERE s.client_id = $1 AND s.sale_date::date >= $2::date AND s.sale_date::date <= $3::date
        AND l.category_id <> $4
      GROUP BY l.sale_id`,
    [clientId, from, to, NON_TAXABLE_CATEGORY_ID]
  );
  const taxedBySaleId = new Map(taxedRows.map((r) => [r.sale_id, Number(r.amount) || 0]));
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
      const taxableSales = taxedBySaleId.get(r.sale_id) || 0;
      // Non-Taxable Sales = Gross - Taxable — a residual, so it always accounts
      // for the full gross figure even when the source data never explicitly
      // called out a non-taxable amount. Floored at 0 since a taxed total that
      // exceeds gross means an adjustment or data-entry issue on the sale, not
      // a negative non-taxable amount.
      const nonTaxableSales = Math.max(0, grossSales - taxableSales);
      return {
        saleId: r.sale_id, saleDate: r.sale_date, grossSales,
        totalTaxDue: Number(r.total_tax_due) || 0, adjustments: Number(r.adjustments) || 0,
        nonTaxableSales, taxableSales,
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
  const mdFiledDate = String(req.query.mdFiledDate || "").trim() || undefined;
  const mdPaidDate = String(req.query.mdPaidDate || "").trim() || undefined;
  const mdFiling = await computeMdFilingForReport(client, period.from, period.to, mdFiledDate, mdPaidDate);
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
  const mdFiledDate = String(req.query.mdFiledDate || "").trim() || undefined;
  const mdPaidDate = String(req.query.mdPaidDate || "").trim() || undefined;
  const mdFiling = await computeMdFilingForReport(client, period.from, period.to, mdFiledDate, mdPaidDate);
  res.json({ mdFiling });
}));

/**
 * Records that a specific MD filing period was actually filed on a real date
 * — the only way the dashboard's "MD Sales & Use Tax (ending ...)" Past Due
 * flags and "MD Sales Tax Filing" upcoming deadline can ever clear (see
 * computeClientFlags in clients.routes.ts and computeMdFilingForReport
 * above), since both are otherwise computed against today's date forever.
 * Snapshots taxDue at the recorded date so history stays accurate even if
 * this period's sales data is edited later.
 *
 * paidDate is now OPTIONAL (was required in the same request as filedDate
 * until the Save & Send filing-confirmation feature) — filing and paying are
 * genuinely separate events; recording one shouldn't force fabricating the
 * other. When paidDate is omitted, balance_due/on_time are left NULL rather
 * than computed against a made-up payment date (see computeMdFilingBreakdown's
 * filedPendingPayment branch) until record-payment below fills them in for
 * real. `notify: true` sends the client a filing-confirmation email
 * immediately and, if payment isn't recorded yet, schedules the 24h-before-
 * due-date reminder (see src/common/paymentReminders.ts).
 */
const SALES_TAX_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Derives the same period-label format the Task Rules Agent's own
 * computeDuePeriod (rules.routes.ts) uses for TR-001 (Monthly)/TR-003
 * (Quarterly) — "August 2026" / "Q3 2026" — directly from a period's actual
 * start date rather than re-deriving it from "today", since this is called
 * with the specific period just filed, not the sweep's own current period.
 * Null for Semiannual/Annual/unset frequency — TR-001/TR-003 don't cover those.
 */
function deriveSalesTaxPeriodLabel(periodStart: string, salesTaxFrequency: string | null | undefined): string | null {
  const freq = String(salesTaxFrequency || "").trim().toLowerCase();
  const d = new Date(`${periodStart}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (freq === "monthly") return `${SALES_TAX_MONTH_NAMES[m]} ${y}`;
  if (freq === "quarterly") return `Q${Math.floor(m / 3) + 1} ${y}`;
  return null;
}

/**
 * Closes the real Task-Rules-Agent-generated v3_tasks row for this
 * client+period, once a period is genuinely marked filed here — mirrors
 * closeEftpsStaffTask's intent (eftpsStaffTasks.ts) but against a different
 * task-creation mechanism (the generic Task Rules Agent's TR-001/TR-003,
 * not EFTPS's own bespoke sweep), so it reuses runRuleBatch's own
 * client_id+task_name+period idempotency key (rules.routes.ts) instead of
 * source_system/source_record_id — runRuleBatch sets those to the batch's
 * own ID, shared across every client in the batch, not a per-client-period
 * key, so they can't be used to look up "the task for this client+period."
 * A safe no-op when no matching task exists (e.g. it was filed manually
 * without ever going through the Agent, or already closed).
 */
async function closeSalesTaxTask(clientId: string, periodStart: string, salesTaxFrequency: string | null | undefined): Promise<void> {
  const periodLabel = deriveSalesTaxPeriodLabel(periodStart, salesTaxFrequency);
  if (!periodLabel) return;
  await query(
    `UPDATE altax.v3_tasks SET status = 'Completed', updated_at = now()
      WHERE client_id = $1 AND lower(task_name) = lower('Sales Tax Filing & Payment')
        AND lower(coalesce(period,'')) = lower($2)
        AND lower(status) NOT IN ('completed','closed','archived','void')`,
    [clientId, periodLabel]
  );
}

reportsRouter.post("/md-filing/:clientId/mark-filed", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });
  if (client.state !== "MD") return res.status(400).json({ error: "This client is not MD-based." });

  const body = req.body || {};
  const periodStart = String(body.periodStart || "").trim();
  const periodEnd = String(body.periodEnd || "").trim();
  const filedDate = String(body.filedDate || "").trim();
  const paidDateRaw = String(body.paidDate || "").trim();
  const paidDate = paidDateRaw ? paidDateRaw : null;
  const notify = body.notify === true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || !/^\d{4}-\d{2}-\d{2}$/.test(filedDate)
    || (paidDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(paidDate))) {
    return res.status(400).json({ error: "periodStart, periodEnd, and filedDate must be YYYY-MM-DD (paidDate too, if provided)." });
  }

  const { mdDueDateForPeriod, computeMdFiling } = await import("../../common/mdFiling");
  const sales = await loadSalesDatesAndTaxForPeriod(client.clientId, periodStart, periodEnd);
  const taxDue = round2(sales.reduce((sum, s) => sum + (s.totalTaxDue || 0), 0));
  const dueDate = mdDueDateForPeriod(periodEnd);
  const result = paidDate ? await computeMdFiling(taxDue, dueDate, filedDate, paidDate) : null;
  // Generated once, only on first insert — COALESCE keeps it stable across
  // an edit/refiling of the same period (this route re-runs via ON CONFLICT
  // DO UPDATE), since the token may already be out in an emailed link.
  const newShareToken = crypto.randomBytes(24).toString("hex");

  const row = await queryOne<{ share_token: string }>(
    `INSERT INTO altax.v3_md_filing_payments (client_id, period_start, period_end, filed_date, paid_date, tax_due, balance_due, on_time, filed_by, share_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (client_id, period_end) DO UPDATE SET
       period_start = EXCLUDED.period_start, filed_date = EXCLUDED.filed_date, paid_date = EXCLUDED.paid_date, tax_due = EXCLUDED.tax_due,
       balance_due = EXCLUDED.balance_due, on_time = EXCLUDED.on_time, filed_by = EXCLUDED.filed_by, filed_at = now(),
       share_token = COALESCE(altax.v3_md_filing_payments.share_token, EXCLUDED.share_token)
     RETURNING share_token`,
    [client.clientId, periodStart, periodEnd, filedDate, paidDate, taxDue, result?.balanceDue ?? null, result?.onTime ?? null, req.user!.email, newShareToken]
  );
  await logAudit("Accounting", "MD_FILING_MARK_FILED", client.clientId, "Period", "", `${periodStart} - ${periodEnd}: filed ${filedDate}${paidDate ? `, paid ${paidDate}` : ""}`,
    `MD sales tax filing (${periodStart} - ${periodEnd}) marked filed ${filedDate}${paidDate ? `, paid ${paidDate}` : " (payment not yet recorded)"} by ${req.user!.email}.`, req.user!.email);

  await closeSalesTaxTask(client.clientId, periodStart, client.salesTaxFrequency);

  if (notify) {
    const clientContact = await queryOne<any>(`SELECT email, email_allowed FROM altax.v3_clients WHERE client_id = $1`, [client.clientId]);
    const { sendFilingConfirmation } = await import("../../common/filingConfirmationEmail");
    const sourceRecordId = `${client.clientId}:${periodEnd}`;
    const acknowledgeUrl = `${publicBaseUrl(req) || ""}/public/md-filing/${row?.share_token}`;
    await sendFilingConfirmation({
      client: { clientId: client.clientId, clientName: client.clientName, email: clientContact?.email ?? null, emailAllowed: Boolean(clientContact?.email_allowed) },
      sourceRecordId, filingType: "Maryland Sales & Use Tax", periodLabel: `${periodStart} – ${periodEnd}`,
      filedDate, amount: taxDue, paymentDueDate: dueDate, paidDate, acknowledgeUrl, req,
    });
    if (!paidDate) {
      const { schedulePaymentReminder } = await import("../../common/paymentReminders");
      await schedulePaymentReminder({
        sourceSystem: "MdFiling", sourceRecordId, clientId: client.clientId, filingType: "Maryland Sales & Use Tax",
        periodLabel: `${periodStart} – ${periodEnd}`, amount: taxDue, paymentDueDate: dueDate, createdBy: req.user!.email, leadDays: 3,
      });
    }
  }

  res.json({ ok: true, periodEnd, filedDate, paidDate, onTime: result?.onTime ?? null, balanceDue: result?.balanceDue ?? null });
}));

/**
 * Records the actual payment date for a period already marked filed (see
 * mark-filed above) — the second half of the filed/paid split. Requires an
 * existing filed row with no payment recorded yet; use unmark-paid below to
 * correct a mistaken date rather than silently overwriting a real one.
 * Cancels any pending payment-due reminder for this period once payment is
 * genuinely recorded.
 */
reportsRouter.post("/md-filing/:clientId/record-payment", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });
  if (client.state !== "MD") return res.status(400).json({ error: "This client is not MD-based." });

  const body = req.body || {};
  const periodEnd = String(body.periodEnd || "").trim();
  const paidDate = String(body.paidDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || !/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) {
    return res.status(400).json({ error: "periodEnd and paidDate must be YYYY-MM-DD." });
  }

  const existing = await queryOne<any>(
    `SELECT period_start, filed_date, paid_date, tax_due FROM altax.v3_md_filing_payments WHERE client_id = $1 AND period_end = $2::date`,
    [client.clientId, periodEnd]
  );
  if (!existing) return res.status(400).json({ error: "This period hasn't been marked filed yet — mark it filed first." });
  if (existing.paid_date) return res.status(400).json({ error: "This period already has a payment recorded. Use unmark-paid to correct it, then re-record." });

  const { mdDueDateForPeriod, computeMdFiling } = await import("../../common/mdFiling");
  const dueDate = mdDueDateForPeriod(periodEnd);
  const filedDateStr = new Date(existing.filed_date).toISOString().slice(0, 10);
  const taxDue = Number(existing.tax_due);
  const result = await computeMdFiling(taxDue, dueDate, filedDateStr, paidDate);

  await query(
    `UPDATE altax.v3_md_filing_payments SET paid_date = $3, balance_due = $4, on_time = $5 WHERE client_id = $1 AND period_end = $2::date`,
    [client.clientId, periodEnd, paidDate, result.balanceDue, result.onTime]
  );
  await logAudit("Accounting", "MD_FILING_RECORD_PAYMENT", client.clientId, "Period", "", `${periodEnd}: paid ${paidDate}`,
    `Payment for MD sales tax filing (period ending ${periodEnd}) recorded as paid ${paidDate} by ${req.user!.email}.`, req.user!.email);

  const { cancelPaymentReminder } = await import("../../common/paymentReminders");
  await cancelPaymentReminder("MdFiling", `${client.clientId}:${periodEnd}`, "Payment recorded");

  res.json({ ok: true, periodEnd, paidDate, onTime: result.onTime, balanceDue: result.balanceDue });
}));

/** Reverses a mark-paid entry (staff correcting a mistaken date) — the period goes back to being computed live against today, same as before it was ever marked. */
reportsRouter.post("/md-filing/:clientId/unmark-paid", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });

  const periodEnd = String((req.body || {}).periodEnd || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return res.status(400).json({ error: "periodEnd must be YYYY-MM-DD." });

  await query(`DELETE FROM altax.v3_md_filing_payments WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd]);
  await logAudit("Accounting", "MD_FILING_UNMARK_PAID", client.clientId, "Period", "", periodEnd,
    `MD sales tax filing (period ending ${periodEnd}) un-marked by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

reportsRouter.get("/pdf/sales-tax/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const period = parsePeriod(req);
  if (!period) return res.status(400).json({ error: "Valid from/to dates (YYYY-MM-DD) are required." });
  const client = await loadClientInfo(req, req.params.clientId);
  if (!client) return res.status(403).json({ error: "You do not have access to this client." });

  const data = await loadSalesTaxForPeriod(client.clientId, period.from, period.to);
  const mdFiledDate = String(req.query.mdFiledDate || "").trim() || undefined;
  const mdPaidDate = String(req.query.mdPaidDate || "").trim() || undefined;
  const mdFiling = await computeMdFilingForReport(client, period.from, period.to, mdFiledDate, mdPaidDate);
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
  const mdFiledDate = String(req.query.mdFiledDate || "").trim() || undefined;
  const mdPaidDate = String(req.query.mdPaidDate || "").trim() || undefined;
  const mdFiling = await computeMdFilingForReport(client, period.from, period.to, mdFiledDate, mdPaidDate);
  const rows: (string | number)[][] = data.byCategory.map((c) => [c.categoryName, c.state || "", `${(c.rate * 100).toFixed(2)}%`, c.taxableAmount.toFixed(2), c.taxAmount.toFixed(2)]);
  if (mdFiling) {
    rows.push(["", "", "", "", ""]);
    rows.push(["Filing date", "", "", "", mdFiling.filedDate]);
    rows.push(["Payment date", "", "", "", mdFiling.paidDate]);
    const todayStr = new Date().toISOString().slice(0, 10);
    for (const p of mdFiling.periods) {
      rows.push(["", "", "", "", ""]);
      rows.push([`Period ${p.start} to ${p.end}`, "", "", "", ""]);
      rows.push(["Return due date", "", "", "", p.dueDate]);
      rows.push(["Target filing date (internal)", "", "", "", p.targetFilingDate]);
      rows.push(["Tax due", "", "", "", p.taxDue.toFixed(2)]);
      // Same reasoning as reportsPdf.ts's per-period render: a filed-but-not-
      // yet-paid period's onTime/discount/penalty math is a non-trustworthy
      // placeholder, not a real verdict — see computeMdFilingBreakdown.
      const status = classifyMdFilingPeriod(p, todayStr);
      if (status === "filedPendingPayment") {
        rows.push(["Payment status", "", "", "", "Filed — payment not yet recorded"]);
        rows.push(["Balance due (discount/penalty pending payment)", "", "", "", p.balanceDue.toFixed(2)]);
      } else if (p.onTime) {
        rows.push(["Timely discount", "", "", "", (-p.discount).toFixed(2)]);
        rows.push(["Balance due", "", "", "", p.balanceDue.toFixed(2)]);
      } else {
        rows.push([`Late penalty (${(p.penaltyRate * 100).toFixed(0)}%)`, "", "", "", p.penalty.toFixed(2)]);
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
