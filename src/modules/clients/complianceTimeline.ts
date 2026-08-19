import { query, queryOne } from "../../config/db";
import { CLIENT_TRIGGER_COLUMNS, clientMatchesRule, computeDuePeriodsBack } from "../rules/rules.routes";
import { relevantMissingTaskRules, taskLabelsLikelyMatch, MISSING_TASK_MATCH_WINDOW_DAYS, daysBetween, isoDate } from "./complianceGapFlags";
import { computeMdFilingForReport } from "../reports/reports.routes";
import { classifyMdFilingPeriod, type MdFilingPeriodStatus } from "../../common/mdFiling";
import type { ReportClientInfo } from "../accounting/reportsPdf";
import type { PayrollCadenceGap, BookkeepingStaleness, MissingComplianceTaskGap } from "./complianceGapFlags";

/**
 * Client Compliance Score + Compliance Timeline — replaces the scattered,
 * moment-in-time flags view with one trustworthy "is this client under
 * control" signal, backed by real filing/task history rather than today's
 * status alone. See the plan doc for the full design rationale.
 *
 * Business Tax Return is deliberately NOT a lane here — the same real
 * production data that justified excluding Annual-frequency rules from
 * complianceGapFlags.ts's missing-task check (annual return prep almost
 * never gets a matching task row in this system) means a "missing" square
 * for it would be false almost every time. Only obligations with a real,
 * reliable ground-truth signal get a lane.
 *
 * Real-data check (2026-08-18, against production, before this shipped):
 * walking back a flat 12 months from `asOf` produced false "missing" squares
 * for periods before a client had ANY real evidence of the obligation —
 * e.g. 4 GUYS DELI MART (C-1001) has sales-tax-frequency history anchored at
 * the 2000-01-01 sentinel (correct, for its actual filing history), but its
 * real sales data (v3_sales_input) only starts 2026-01-31 and its earliest
 * task only exists from 2026-07-17 — the system simply never tracked this
 * client before then. `computeTaskRuleLanes` clamps its lookback to the
 * earliest task ever recorded (any type), falling back to the client's own
 * `created_at` if it has never had a task.
 *
 * `computeMdSalesTaxLane` deliberately does NOT use that same created_at
 * fallback — a second real-data check (2026-08-18, same day, caught live
 * right after this first fix shipped) found it originally skipped the WHOLE
 * lane for any client with zero v3_sales_input rows, silently contradicting
 * the older, still-live SalesTaxFilingDue flag in clients.routes.ts, which
 * correctly treats a $0/not-yet-quantified period as a real filing
 * obligation the moment it exists (a nil return still has to be filed).
 * Dozens of real MD clients have a genuine quarterly obligation but zero
 * sales entered yet. Falling back to created_at would have "fixed" that by
 * introducing a WORSE bug: 140 of ~160 clients share one bulk-import
 * created_at (2026-07-08), so that floor would silently hide genuinely-
 * current overdue quarters. The MD lane instead clamps its lookback ONLY
 * when real sales evidence exists to clamp against; with zero evidence it
 * trusts the frequency-history period grid fully, same as the flag does.
 */

export type TimelineStatus = MdFilingPeriodStatus;
export interface TimelinePeriod { periodLabel: string; dueDate: string; status: TimelineStatus; filedDate: string | null }
export type ComplianceObligationType = "MD Sales Tax" | "EFTPS" | "MD Withholding" | "MD UI";
export interface ComplianceTimelineLane { obligationType: ComplianceObligationType; periods: TimelinePeriod[] }

const TASK_RULE_LANES: { obligationType: ComplianceObligationType; triggerColumn: string }[] = [
  { obligationType: "EFTPS", triggerColumn: "eftps_enabled" },
  { obligationType: "MD Withholding", triggerColumn: "md_withholding_frequency" },
  { obligationType: "MD UI", triggerColumn: "mdui_enabled" },
];

function periodsPerRule(frequency: unknown, monthsBack: number): number {
  const freq = String(frequency || "").trim().toLowerCase();
  if (freq === "quarterly") return Math.ceil(monthsBack / 3);
  if (freq === "semiannual") return Math.ceil(monthsBack / 6);
  if (freq === "monthly") return monthsBack;
  return 0; // Annual/Weekly/One-Time — already excluded by relevantMissingTaskRules, or has no period grid to walk.
}

async function earliestSaleDate(clientId: string): Promise<string | null> {
  const row = await queryOne<any>(`SELECT MIN(sale_date) AS d FROM altax.v3_sales_input WHERE client_id = $1`, [clientId]);
  return isoDate(row?.d);
}

async function earliestTaskEvidenceDate(clientId: string): Promise<string | null> {
  const row = await queryOne<any>(
    `SELECT MIN(d) AS d FROM (
       SELECT agency_due_date AS d FROM altax.v3_tasks WHERE client_id = $1 AND agency_due_date IS NOT NULL
       UNION ALL
       SELECT agency_due_date AS d FROM altax.v3_archived_tasks WHERE client_id = $1 AND agency_due_date IS NOT NULL
     ) t`,
    [clientId]
  );
  return isoDate(row?.d);
}

/** MD Sales Tax lane — reuses the exact, already-proven computeMdFilingForReport chain rather than reassembling its period-splitting/query pipeline. */
async function computeMdSalesTaxLane(clientId: string, clientRow: any, monthsBack: number, asOf: Date): Promise<ComplianceTimelineLane | null> {
  if (String(clientRow.state || "").trim().toUpperCase() !== "MD") return null;
  // Only clamp the lookback when there's real sales evidence to clamp
  // against (guards the original 4 GUYS-style false positive: real sales
  // evidence starting partway through the window means the obligation
  // likely didn't exist before that). With ZERO sales evidence, don't floor
  // at all — trust the period grid the same way the older, already-live
  // SalesTaxFilingDue flag in clients.routes.ts does (it has no evidence
  // floor either, only a shorter 6-month recency window): a $0/never-entered
  // period is still a real filing obligation, not proof one never existed.
  // client.created_at is NOT a usable floor here — 140 of ~160 clients share
  // one bulk-import created_at (2026-07-08), so it would silently hide
  // genuinely-current overdue quarters (e.g. Q2 2026, due ~Jul 20) that the
  // Account Flags card and Business Health Score both correctly still show.
  const earliestSale = await earliestSaleDate(clientId);
  const to = asOf.toISOString().slice(0, 10);
  const fromDate = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - monthsBack, 1));
  const from = earliestSale && fromDate.toISOString().slice(0, 10) < earliestSale ? earliestSale : fromDate.toISOString().slice(0, 10);
  const reportClient: ReportClientInfo = {
    clientId, clientName: "", ein: null, address: null,
    state: clientRow.state, salesTaxFrequency: clientRow.sales_tax_frequency,
  };
  // includeZeroTaxPeriods: true — without this, a $0 period staff already
  // marked filed is dropped entirely (no green square, excluded from the
  // on-time-rate numerator/denominator), and a client with zero taxable
  // sales in the whole window loses the MD lane altogether. Reports/PDFs/CSVs
  // keep the default (skip) behavior; this Timeline needs every period
  // represented. See mdFiling.ts's computeMdFilingBreakdown doc comment.
  const result = await computeMdFilingForReport(reportClient, from, to, undefined, undefined, { includeZeroTaxPeriods: true });
  if (!result) return null;
  const todayStr = to;
  const periods: TimelinePeriod[] = result.periods.map((p) => ({
    periodLabel: `${p.start} – ${p.end}`, dueDate: p.dueDate,
    status: classifyMdFilingPeriod(p, todayStr), filedDate: p.markedFiledDate,
  }));
  return { obligationType: "MD Sales Tax", periods };
}

interface ClientTaskRow { taskName: string; dueDate: string; status: string; filedDate: string | null }

/** EFTPS / MD Withholding / MD UI lanes — one rules query + one bounded UNION tasks query, independent of monthsBack or rule count. */
async function computeTaskRuleLanes(clientId: string, clientRow: any, monthsBack: number, asOf: Date): Promise<ComplianceTimelineLane[]> {
  const allRules = relevantMissingTaskRules(await query<any>(`SELECT * FROM altax.v3_task_rules WHERE active = true`));

  type RulePeriods = { obligationType: ComplianceObligationType; periods: ReturnType<typeof computeDuePeriodsBack> };
  const candidateLanes: RulePeriods[] = [];
  for (const lane of TASK_RULE_LANES) {
    const rule = allRules.find((r: any) => {
      const col = CLIENT_TRIGGER_COLUMNS[String(r.trigger_column || "").trim()];
      return col === lane.triggerColumn && clientMatchesRule(clientRow, r);
    });
    if (!rule) continue;
    const count = periodsPerRule(rule.frequency, monthsBack);
    if (count <= 0) continue;
    const periods = computeDuePeriodsBack(rule, asOf, count);
    if (periods.length > 0) candidateLanes.push({ obligationType: lane.obligationType, periods });
  }
  if (candidateLanes.length === 0) return [];

  // Real-data floor — see this file's top doc comment. Never assert a period
  // "missing" further back than the earliest task this client has ever had
  // on record (any type — a cheap, robust proxy for "when did this system
  // start tracking this client's filings"), falling back to the client's own
  // created_at only if it has never had a single task yet.
  const floor = (await earliestTaskEvidenceDate(clientId)) ?? isoDate(clientRow.created_at);
  const rulePeriodsByLane = candidateLanes
    .map((lane) => ({ ...lane, periods: floor ? lane.periods.filter((p) => p.dueDate >= floor) : lane.periods }))
    .filter((lane) => lane.periods.length > 0);
  if (rulePeriodsByLane.length === 0) return [];

  const minDueDate = rulePeriodsByLane.flatMap((l) => l.periods).reduce((min, p) => (p.dueDate < min ? p.dueDate : min), asOf.toISOString().slice(0, 10));
  const windowFrom = new Date(`${minDueDate}T00:00:00Z`);
  windowFrom.setUTCDate(windowFrom.getUTCDate() - MISSING_TASK_MATCH_WINDOW_DAYS);
  const rows = await query<any>(
    `SELECT task_name, agency_due_date::date AS agency_due_date, status, filed_date::date AS filed_date FROM altax.v3_tasks
      WHERE client_id = $1 AND agency_due_date IS NOT NULL AND agency_due_date >= $2::date
      UNION ALL
      SELECT task_name, agency_due_date::date AS agency_due_date, status, filed_date::date AS filed_date FROM altax.v3_archived_tasks
      WHERE client_id = $1 AND agency_due_date IS NOT NULL AND agency_due_date >= $2::date`,
    [clientId, windowFrom.toISOString().slice(0, 10)]
  );
  const taskRows: ClientTaskRow[] = rows
    .map((r: any) => ({ taskName: String(r.task_name || ""), dueDate: isoDate(r.agency_due_date), status: String(r.status || ""), filedDate: isoDate(r.filed_date) }))
    .filter((r: any): r is ClientTaskRow => !!r.dueDate);

  const todayStr = asOf.toISOString().slice(0, 10);
  const lanes: ComplianceTimelineLane[] = [];
  for (const lane of rulePeriodsByLane) {
    const taskType = allRules.find((r: any) => TASK_RULE_LANES.find((l) => l.obligationType === lane.obligationType)!.triggerColumn === CLIENT_TRIGGER_COLUMNS[String(r.trigger_column || "").trim()] && clientMatchesRule(clientRow, r))?.task_type || "";
    const periods: TimelinePeriod[] = lane.periods.map((p) => {
      const candidates = taskRows.filter((r) => taskLabelsLikelyMatch(r.taskName, String(taskType)) && Math.abs(daysBetween(r.dueDate, p.dueDate)) <= MISSING_TASK_MATCH_WINDOW_DAYS);
      const completed = candidates.filter((r) => r.status.trim().toLowerCase() === "completed");
      let status: TimelineStatus;
      let filedDate: string | null = null;
      if (completed.length > 0) {
        const withFiledDate = completed.find((r) => r.filedDate);
        if (withFiledDate?.filedDate) {
          filedDate = withFiledDate.filedDate;
          status = filedDate <= p.dueDate ? "onTime" : "late";
        } else {
          status = "onTime"; // Completed, but no filed_date on record (older tasks predate the TAX-005 evidence gate) — benefit of doubt, not evidence of lateness.
        }
      } else if (p.dueDate < todayStr) {
        status = "missing"; // no completed task in the window — covers both "no task at all" and "task exists but still open"
      } else {
        status = "notYetDue";
      }
      return { periodLabel: p.periodLabel, dueDate: p.dueDate, status, filedDate };
    });
    lanes.push({ obligationType: lane.obligationType, periods });
  }
  return lanes;
}

export async function computeClientComplianceTimeline(
  clientId: string, clientRow: any, asOf: Date = new Date(), monthsBack = 12
): Promise<ComplianceTimelineLane[]> {
  const [mdLane, taskLanes] = await Promise.all([
    computeMdSalesTaxLane(clientId, clientRow, monthsBack, asOf),
    computeTaskRuleLanes(clientId, clientRow, monthsBack, asOf),
  ]);
  return [...(mdLane ? [mdLane] : []), ...taskLanes];
}

// ---------------------------------------------------------------------------
// Compliance Score — pure, no DB calls, derived from the Timeline plus the
// gap objects computeClientFlags already computes (no second round-trip).
// Bands are deliberately stricter than the Business Health Score's 75/50: a
// missed filing is more consequential than a soft financial ratio, so this
// score should tip out of Green sooner.
// ---------------------------------------------------------------------------

export interface ComplianceScoreComponent { label: string; points: number; maxPoints: number; detail: string }
export interface ClientComplianceScore {
  score: number; band: "Green" | "Yellow" | "Red";
  components: ComplianceScoreComponent[];
  currentlyOverdueCount: number;
}

export function computeClientComplianceScore(
  timeline: ComplianceTimelineLane[],
  gaps: { payrollGap: PayrollCadenceGap | null; bookkeepingGap: BookkeepingStaleness | null; missingTaskGaps: MissingComplianceTaskGap[] }
): ClientComplianceScore {
  const allPeriods = timeline.flatMap((l) => l.periods);
  const overdueCount = allPeriods.filter((p) => p.status === "missing").length;

  const overduePoints = overdueCount === 0 ? 40 : overdueCount === 1 ? 25 : overdueCount === 2 ? 10 : 0;
  const overdueComponent: ComplianceScoreComponent = {
    label: "Currently Overdue", points: overduePoints, maxPoints: 40,
    detail: allPeriods.length === 0 ? "No compliance obligations on file for this client." : overdueCount === 0 ? "Nothing currently overdue." : `${overdueCount} period${overdueCount === 1 ? "" : "s"} overdue right now (no completed filing on record — an open, unfinished task still counts).`,
  };

  const onTime = allPeriods.filter((p) => p.status === "onTime").length;
  const late = allPeriods.filter((p) => p.status === "late").length;
  const resolvedOrOverdue = onTime + late + overdueCount;
  const onTimeRate = resolvedOrOverdue === 0 ? null : onTime / resolvedOrOverdue;
  const onTimePoints = onTimeRate === null ? 30 : Math.round(onTimeRate * 30);
  const onTimeComponent: ComplianceScoreComponent = {
    label: "12-Month On-Time Rate", points: onTimePoints, maxPoints: 30,
    detail: onTimeRate === null ? "No filing history yet in the last 12 months — not held against the client." : `${Math.round(onTimeRate * 100)}% of periods filed on time.`,
  };

  const missingTaskCount = gaps.missingTaskGaps.length;
  const missingTaskPoints = missingTaskCount === 0 ? 15 : missingTaskCount === 1 ? 8 : missingTaskCount === 2 ? 3 : 0;
  const missingTaskComponent: ComplianceScoreComponent = {
    label: "Missing Compliance Tasks", points: missingTaskPoints, maxPoints: 15,
    detail: missingTaskCount === 0 ? "No structurally missing filing tasks." : `${missingTaskCount} filing task${missingTaskCount === 1 ? "" : "s"} where no task was ever created for it.`,
  };

  const payrollPoints = gaps.payrollGap === null ? 8 : 0;
  const booksPoints = gaps.bookkeepingGap === null ? 7 : 0;
  const currencyComponent: ComplianceScoreComponent = {
    label: "Payroll & Books Currency", points: payrollPoints + booksPoints, maxPoints: 15,
    detail: gaps.payrollGap === null && gaps.bookkeepingGap === null ? "Payroll and bookkeeping both current." :
      [gaps.payrollGap ? `Payroll: ${gaps.payrollGap.daysSinceLastPay} days since last paycheck.` : null,
       gaps.bookkeepingGap ? `Books: ${gaps.bookkeepingGap.daysSinceLastEntry} days since last GL entry.` : null].filter(Boolean).join(" "),
  };

  const components = [overdueComponent, onTimeComponent, missingTaskComponent, currencyComponent];
  const score = components.reduce((sum, c) => sum + c.points, 0);
  const band: "Green" | "Yellow" | "Red" = score >= 80 ? "Green" : score >= 60 ? "Yellow" : "Red";
  return { score, band, components, currentlyOverdueCount: overdueCount };
}
