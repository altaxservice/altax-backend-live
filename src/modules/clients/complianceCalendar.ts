/**
 * Aggregates every deadline source this app can actually compute for one
 * client into a single, sorted "Upcoming Deadlines" list — no new table,
 * no new data entry. Confirmed via research: no generic compliance-
 * calendar concept existed anywhere in this codebase before this; the only
 * real deadline sources are MD sales tax filing (mdFiling.ts), each
 * client's next scheduled payroll date (v3_payroll_schedules), the
 * federal payroll tax forms' fixed IRS due dates (941 quarterly, 940
 * annual) for any client with payroll enabled, the Maryland Annual Report
 * (fixed April 15, any client with md_annual_report_enabled), and — added
 * for the Gov Forms hard-evaluation round — the Form 2553 S-Corp election
 * deadline (see scorpElection.ts) for an LLC/C-Corp with a formation date
 * on file and no 2553 filed yet. Deliberately does NOT invent deadlines
 * this system has no real data for (POA renewals, W4/W9 signing
 * deadlines) — see the Phase 5 research note in the approved plan.
 *
 * A pure function — the caller (reports.routes.ts's client-dashboard
 * route, and clients.routes.ts's SWOT findings engine input) supplies
 * already-computed values (MD due date/tax due, next payroll date) so this
 * file has no DB access of its own and can't create an import cycle.
 */

import { computeScorpElectionStatus } from "../../common/scorpElection";
import { computeDuePeriod } from "../rules/rules.routes";

export interface ComplianceDeadline {
  label: string;
  date: string; // YYYY-MM-DD
  source: "MD Sales Tax" | "Payroll" | "Federal Payroll Tax" | "MD Annual Report" | "S-Corp Election" | "EFTPS" | "MD Withholding" | "MD UI" | "Business Tax Return";
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
// Maryland Withholding filing frequency vocabulary ("Monthly"/"Quarterly"/
// "Semiannual"/"Annually" — the same FREQ_OPTIONS as sales_tax_frequency) uses
// plural "Annually", but computeDuePeriod's own frequency field expects
// singular "Annual" — this map bridges that real, confirmed vocabulary split
// rather than re-deriving it inline. See sql/056_task_rules_compliance_gaps.sql.
const MD_WITHHOLDING_FREQ_TO_RULE_FREQUENCY: Record<string, string> = {
  Monthly: "Monthly", Quarterly: "Quarterly", Semiannual: "Semiannual", Annually: "Annual",
};

// business_return_type -> months after Dec 31 year-end the return is due (matches
// TR-011/TR-017/TR-021/TR-022 in sql/056): S-Corp (1120S) and Partnership (1065)
// are due March 15 (offset 3); C-Corp (1120) and the owner's own Schedule C
// (filed with the individual 1040) are due April 15 (offset 4).
const BUSINESS_RETURN_DUE_OFFSET_MONTHS: Record<string, string> = {
  "1120": "4", "1120S": "3", "1065": "3", "Schedule C": "4",
};

export function computeUpcomingDeadlines(params: {
  mdCurrentPeriodDueDate: string | null;
  payrollNextDate: string | null;
  payrollEnabled: boolean;
  mdAnnualReportEnabled?: boolean;
  entityType?: string | null;
  dateOfFormation?: string | null;
  has2553Filing?: boolean;
  eftpsEnabled?: boolean;
  mdWithholdingFrequency?: string | null;
  mduiEnabled?: boolean;
  businessReturnType?: string | null;
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

  if (params.mdAnnualReportEnabled) {
    deadlines.push({ label: "MD Annual Report", date: nextFixedAnnualDate(4, 15, asOf), source: "MD Annual Report" });
  }

  // Same due-date engine the seeded Task Rules use (sql/056), reused here rather
  // than re-derived, so the "upcoming" preview on the dashboard and the actual
  // task the Task Rules Agent later drafts never quietly disagree on the date.
  if (params.eftpsEnabled) {
    const period = computeDuePeriod({ frequency: "Monthly", due_day: "15", due_month: "1" }, asOf);
    if (period) deadlines.push({ label: "EFTPS Deposit", date: period.dueDate, source: "EFTPS" });
  }

  const mdWhFrequency = params.mdWithholdingFrequency ? MD_WITHHOLDING_FREQ_TO_RULE_FREQUENCY[params.mdWithholdingFrequency] : undefined;
  if (mdWhFrequency) {
    const period = computeDuePeriod({ frequency: mdWhFrequency, due_day: "15", due_month: "1" }, asOf);
    if (period) deadlines.push({ label: "MD Withholding Payment", date: period.dueDate, source: "MD Withholding" });
    const reconciliation = computeDuePeriod({ frequency: "Annual", due_day: "31", due_month: "1" }, asOf);
    if (reconciliation) deadlines.push({ label: "MD Withholding Annual Reconciliation (MW508)", date: reconciliation.dueDate, source: "MD Withholding" });
  }

  if (params.mduiEnabled) {
    // due_day=24 matches the firm's own existing MD UI task rules (TR-009/TR-010) —
    // an internal target a few days ahead of MD's own ~30-day statutory window.
    const period = computeDuePeriod({ frequency: "Quarterly", due_day: "24", due_month: null }, asOf);
    if (period) deadlines.push({ label: "MD UI Wages Filing & Payment", date: period.dueDate, source: "MD UI" });
  }

  const businessReturnOffset = params.businessReturnType ? BUSINESS_RETURN_DUE_OFFSET_MONTHS[params.businessReturnType] : undefined;
  if (businessReturnOffset) {
    const period = computeDuePeriod({ frequency: "Annual", due_day: "15", due_month: businessReturnOffset }, asOf);
    if (period) deadlines.push({ label: "Business Tax Return", date: period.dueDate, source: "Business Tax Return" });
  }

  const scorp = computeScorpElectionStatus(params.entityType ?? null, params.dateOfFormation ?? null, params.has2553Filing ?? false, asOf);
  // Only surfaced while there's still something to actually do about it —
  // the plain deadline hasn't passed yet, or it has but late-election
  // relief (Rev. Proc. 2013-30) is still open. Once relief also closes,
  // this stops appearing rather than sitting as permanent unfixable noise.
  if (scorp && (!scorp.pastDeadline || scorp.lateReliefAvailable)) {
    deadlines.push({
      label: scorp.pastDeadline ? "Form 2553 (S-Corp Election) — late-relief window" : "Form 2553 (S-Corp Election) Deadline",
      date: scorp.pastDeadline ? scorp.lateReliefDeadline : scorp.deadline,
      source: "S-Corp Election",
    });
  }

  // EFTPS/MD Withholding/MD UI/Business Tax Return all come from computeDuePeriod(),
  // which (by design, for the Task Rules Agent's own use) always returns the most
  // recently CLOSED period's due date, even if that date is months in the past —
  // it has no idea whether that period was already filed outside this system before
  // this tracking existed. Unlike MD Sales Tax (whose caller only passes a date once
  // a real v3_md_filing_payments record confirms it's still unresolved), these 4
  // sources have no such confirmation, so a past date here is unverified, not a
  // proven overdue filing. Only show them once they're a genuine heads-up (today or
  // later, within the normal cutoff) — a real overdue filing still surfaces through
  // the actual flag system once staff approve a Task Rules Agent draft for it.
  const UNVERIFIED_PAST_SOURCES = new Set<ComplianceDeadline["source"]>(["EFTPS", "MD Withholding", "MD UI", "Business Tax Return"]);
  const todayStart = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const cutoff = new Date(asOf.getTime() + withinDays * 86400000);
  return deadlines
    .filter((d) => {
      const dueDate = new Date(`${d.date}T00:00:00`);
      if (dueDate > cutoff) return false;
      if (UNVERIFIED_PAST_SOURCES.has(d.source) && dueDate < todayStart) return false;
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
