/**
 * Aggregates every deadline source this app can actually compute for one
 * client into a single, sorted "Upcoming Deadlines" list — no new table,
 * no new data entry. Confirmed via research: no generic compliance-
 * calendar concept existed anywhere in this codebase before this; the only
 * real deadline sources are MD sales tax filing (mdFiling.ts), each
 * client's next scheduled payroll date (v3_payroll_schedules), and the
 * federal payroll tax forms' fixed IRS due dates (941 quarterly, 940
 * annual) for any client with payroll enabled. Deliberately does NOT
 * invent deadlines this system has no real data for (POA renewals, W4/W9
 * signing deadlines) — see the Phase 5 research note in the approved plan.
 *
 * A pure function — the caller (reports.routes.ts's client-dashboard
 * route, and clients.routes.ts's SWOT findings engine input) supplies
 * already-computed values (MD due date/tax due, next payroll date) so this
 * file has no DB access of its own and can't create an import cycle.
 */

export interface ComplianceDeadline {
  label: string;
  date: string; // YYYY-MM-DD
  source: "MD Sales Tax" | "Payroll" | "Federal Payroll Tax";
}

/** Next occurrence of a fixed month/day from `asOf` — rolls to next year if this year's date has already passed. */
function nextFixedAnnualDate(month: number, day: number, asOf: Date): string {
  const year = asOf.getFullYear();
  let candidate = new Date(year, month - 1, day);
  if (candidate.getTime() < new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()).getTime()) {
    candidate = new Date(year + 1, month - 1, day);
  }
  return candidate.toISOString().slice(0, 10);
}

// IRS Form 941 (quarterly payroll tax return) fixed due dates — the month/day
// after each calendar quarter closes. Form 940 (annual FUTA return) is due
// January 31 following the year it covers. Both computed as "next
// occurrence" so this never needs updating for a new year.
const FORM_941_DUE_DATES: [number, number][] = [
  [4, 30], // Q1 (Jan-Mar)
  [7, 31], // Q2 (Apr-Jun)
  [10, 31], // Q3 (Jul-Sep)
  [1, 31], // Q4 (Oct-Dec), due the following January
];
const FORM_940_DUE = [1, 31] as [number, number];

/** Every upcoming federal payroll-tax filing deadline within `withinDays` — only meaningful for a client with payroll enabled. */
export function computeFederalPayrollDeadlines(payrollEnabled: boolean, withinDays: number, asOf: Date = new Date()): ComplianceDeadline[] {
  if (!payrollEnabled) return [];
  const cutoff = new Date(asOf.getTime() + withinDays * 86400000);
  const deadlines: ComplianceDeadline[] = [];
  const seen = new Set<string>();
  for (const [month, day] of FORM_941_DUE_DATES) {
    const date = nextFixedAnnualDate(month, day, asOf);
    if (new Date(`${date}T00:00:00`) <= cutoff && !seen.has(date)) {
      deadlines.push({ label: "Form 941 (Quarterly Payroll Tax Return)", date, source: "Federal Payroll Tax" });
      seen.add(date);
    }
  }
  const form940Date = nextFixedAnnualDate(FORM_940_DUE[0], FORM_940_DUE[1], asOf);
  if (new Date(`${form940Date}T00:00:00`) <= cutoff) {
    deadlines.push({ label: "Form 940 (Annual FUTA Return)", date: form940Date, source: "Federal Payroll Tax" });
  }
  return deadlines;
}

/**
 * Combines MD filing + next payroll date (both already computed by the
 * caller) with the federal payroll deadlines above into one sorted list,
 * nearest first — this is what backs the dashboard's Upcoming Deadlines
 * card and (indirectly, via the SWOT findings engine's own MD-specific
 * rule) the alert sweep.
 */
export function computeUpcomingDeadlines(params: {
  mdCurrentPeriodDueDate: string | null;
  payrollNextDate: string | null;
  payrollEnabled: boolean;
  withinDays?: number;
  asOf?: Date;
}): ComplianceDeadline[] {
  const withinDays = params.withinDays ?? 90;
  const asOf = params.asOf ?? new Date();
  const deadlines: ComplianceDeadline[] = [];

  if (params.mdCurrentPeriodDueDate) {
    deadlines.push({ label: "MD Sales Tax Filing", date: params.mdCurrentPeriodDueDate, source: "MD Sales Tax" });
  }
  if (params.payrollNextDate) {
    deadlines.push({ label: "Next Payroll", date: params.payrollNextDate, source: "Payroll" });
  }
  deadlines.push(...computeFederalPayrollDeadlines(params.payrollEnabled, withinDays, asOf));

  const cutoff = new Date(asOf.getTime() + withinDays * 86400000);
  return deadlines
    .filter((d) => new Date(`${d.date}T00:00:00`) <= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date));
}
