import crypto from "crypto";
import { query, queryOne } from "../../config/db";
import {
  computeFirmSummary, computeClientCashBalance, computeClientApEstimate, computeClientArAging,
  computeClientCogs, computeClientRatios, computeClientHealthScore, computeRevenueTrend, computeMdFilingForReport, loadPayrollForPeriod,
} from "../reports/reports.routes";
import type { ReportClientInfo } from "../accounting/reportsPdf";
import { summarizeMdFilingOnTime } from "../../common/mdFiling";

// crypto.randomUUID() rather than a 3-digit random suffix — this sweep
// inserts one row per active client within the same run, and a 900-value
// keyspace collided in real testing (148 clients, 1 duplicate-key failure
// in one run). A UUID slice makes that collision probability negligible.
function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/**
 * Snapshots the calendar month that just closed (not the month the sweep
 * runs in) for every active client — run on the 1st of each month, after
 * the month it's recording has fully ended. `ON CONFLICT ... DO UPDATE`
 * makes this safe to re-run (a manual backfill or a retried sweep just
 * recomputes the same row) — it never creates a second row for the same
 * client+month.
 *
 * Revenue/expenses/profit/payroll are properly scoped to that one month.
 * Cash/AR/AP/tax-liabilities are point-in-time balances as of when the
 * sweep runs, not retroactively reconstructed as of month-end — see
 * sql/041_client_monthly_snapshot.sql's doc comment for why that's the
 * deliberate, simpler choice here (matches computeFirmSummary's own
 * taxLiabilities convention).
 */
export async function runMonthlySnapshotSweep(actorEmail: string, opts: { runDate?: Date } = {}): Promise<{ snapshotted: number; errors: string[] }> {
  const runDate = opts.runDate || new Date();
  const target = new Date(runDate.getFullYear(), runDate.getMonth() - 1, 1);
  const year = target.getFullYear();
  const month = target.getMonth() + 1;
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = new Date(year, month, 0).toISOString().slice(0, 10);
  // 6-month window ending at the snapshot month, matching how the live
  // dashboard's health score always looks back 6 months from "today" —
  // here "today" is effectively monthEnd, the month being snapshotted.
  const trendFrom = new Date(year, month - 6, 1).toISOString().slice(0, 10);

  const clients = await query<any>(`SELECT client_id, client_name, ein, address, state, sales_tax_frequency FROM altax.v3_clients WHERE status IS NULL OR lower(status) NOT IN ('no', 'false', 'inactive', 'archived')`);

  let snapshotted = 0;
  const errors: string[] = [];

  for (const c of clients) {
    try {
      const [monthFinancials, trendFinancials, cashBalance, apEstimate, arAging, cogs, payroll, openTasksRow] = await Promise.all([
        computeFirmSummary(monthStart, monthEnd, c.client_id),
        computeFirmSummary(trendFrom, monthEnd, c.client_id),
        computeClientCashBalance(c.client_id),
        computeClientApEstimate(c.client_id),
        computeClientArAging(c.client_id),
        computeClientCogs(c.client_id, monthStart, monthEnd),
        loadPayrollForPeriod(c.client_id, monthStart, monthEnd),
        queryOne<any>(`SELECT COUNT(*)::int AS count FROM altax.v3_tasks WHERE client_id = $1 AND lower(status) NOT IN ('completed','void','closed','archived')`, [c.client_id]),
      ]);

      const openTasks = openTasksRow?.count || 0;
      const ratios = computeClientRatios({
        revenue: monthFinancials.totals.revenue, profit: monthFinancials.totals.profit, cogs,
        arTotal: arAging.total, ar90Plus: arAging.d90Plus, payrollCost: payroll.totalCost,
        taxLiabilities: monthFinancials.taxLiabilities, periodDays: 31,
      });
      const { trendPct } = computeRevenueTrend(trendFinancials.months);

      let mdFilingOnTime: boolean | null = null;
      if (c.state === "MD") {
        const reportClient: ReportClientInfo = { clientId: c.client_id, clientName: c.client_name, ein: c.ein, address: c.address, state: c.state, salesTaxFrequency: c.sales_tax_frequency };
        const mdFiling = await computeMdFilingForReport(reportClient, trendFrom, monthEnd);
        // asOf is monthEnd, not today — this snapshot records how things stood
        // as of the month it's recording, not as of whenever the sweep happens
        // to run.
        if (mdFiling) mdFilingOnTime = summarizeMdFilingOnTime(mdFiling.periods, monthEnd);
      }

      const health = computeClientHealthScore({
        netMarginPct: ratios.netMarginPct, trendPct,
        arD61_90: arAging.d61_90, arD90Plus: arAging.d90Plus, arTotal: arAging.total,
        taxLiabilities: monthFinancials.taxLiabilities, revenue: monthFinancials.totals.revenue,
        openTasks, mdFilingOnTime,
      });

      await query(
        `INSERT INTO altax.v3_client_monthly_snapshot
           (snapshot_id, client_id, period_year, period_month, revenue, expenses, profit, cash_balance, ar_balance, ap_balance,
            tax_liabilities, payroll_cost, health_score, health_band, open_tasks, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (client_id, period_year, period_month) DO UPDATE SET
           revenue=$5, expenses=$6, profit=$7, cash_balance=$8, ar_balance=$9, ap_balance=$10,
           tax_liabilities=$11, payroll_cost=$12, health_score=$13, health_band=$14, open_tasks=$15, updated_at=now()`,
        [
          `SNAP-${idSuffix()}`, c.client_id, year, month,
          monthFinancials.totals.revenue, monthFinancials.totals.expenses, monthFinancials.totals.profit,
          cashBalance, arAging.total, apEstimate, monthFinancials.taxLiabilities, payroll.totalCost,
          health.score, health.band, openTasks, actorEmail,
        ]
      );
      snapshotted++;
    } catch (err) {
      errors.push(`${c.client_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { snapshotted, errors };
}
