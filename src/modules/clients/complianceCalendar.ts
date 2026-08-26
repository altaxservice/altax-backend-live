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
  source: "MD Sales Tax" | "Payroll" | "Federal Payroll Tax" | "MD Annual Report" | "S-Corp Election" | "EFTPS" | "MD Withholding" | "MD UI" | "Business Tax Return" | "Individual Tax Return" | "Estimated Tax" | "1099/W-2";
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

// Fixed federal individual-taxpayer dates: Form 1040 filing/extension-request
// deadline (April 15), the extended filing deadline if Form 4868 was filed
// (October 15), and the four Form 1040-ES quarterly estimated-payment dates
// (Q4's own due date is January 15 of the FOLLOWING year, same "next
// occurrence" pattern as Form 940 above).
const FORM_1040_DUE = [4, 15] as [number, number];
const FORM_1040_EXTENDED_DUE = [10, 15] as [number, number];
const ESTIMATED_TAX_DUE_DATES: [number, number][] = [
  [4, 15], // Q1
  [6, 15], // Q2
  [9, 15], // Q3
  [1, 15], // Q4, due the following January
];

/**
 * Hard audit (2026-08-13), TAX-002 — complianceCalendar.ts previously covered
 * only the firm's clients as employers/sales-tax filers/business-return
 * filers; a client_type='Individual' client (already a real, selectable
 * value — see ClientsListPage.tsx's Client Type field) had zero deadline
 * tracking of their own personal return. Every date here is a fixed federal
 * due date, so — like the S-Corp/941/940 dates above — this never needs
 * updating for a new year and needs no new schema.
 */
export function computeIndividualDeadlines(clientType: string | null | undefined, withinDays: number, asOf: Date = new Date()): ComplianceDeadline[] {
  if (String(clientType || "").trim().toLowerCase() !== "individual") return [];
  const cutoff = new Date(asOf.getTime() + withinDays * 86400000);
  const deadlines: ComplianceDeadline[] = [];

  const form1040Date = nextFixedAnnualDate(FORM_1040_DUE[0], FORM_1040_DUE[1], asOf);
  if (new Date(`${form1040Date}T00:00:00`) <= cutoff) {
    deadlines.push({ label: "Form 1040 (Individual Tax Return) — or file Form 4868 for an extension", date: form1040Date, source: "Individual Tax Return" });
  }

  const extendedDate = nextFixedAnnualDate(FORM_1040_EXTENDED_DUE[0], FORM_1040_EXTENDED_DUE[1], asOf);
  if (new Date(`${extendedDate}T00:00:00`) <= cutoff) {
    deadlines.push({ label: "Extended Filing Deadline (only if Form 4868 was filed)", date: extendedDate, source: "Individual Tax Return" });
  }

  const seenEstimated = new Set<string>();
  for (const [month, day] of ESTIMATED_TAX_DUE_DATES) {
    const date = nextFixedAnnualDate(month, day, asOf);
    if (new Date(`${date}T00:00:00`) <= cutoff && !seenEstimated.has(date)) {
      deadlines.push({ label: "Quarterly Estimated Tax Payment (Form 1040-ES)", date, source: "Estimated Tax" });
      seenEstimated.add(date);
    }
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
  /** v3_clients.client_type — "Individual" surfaces the Form 1040/4868/1040-ES deadlines below; any other value (or unset) surfaces none of them. */
  clientType?: string | null;
  /** v3_clients.w21099_enabled — TAX-003: surfaces the 1099-NEC/MISC and W-2/W-3 Jan 31 deadlines below. */
  w21099Enabled?: boolean;
  /** `${source}|${date}` keys already marked done via v3_obligation_completions — see clients.routes.ts's /obligations/mark-done. */
  completedKeys?: Set<string>;
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
    // Was nextFixedAnnualDate — which only ever returns a FUTURE April 15, so a
    // client that missed its Annual Report (the filing that keeps it in good
    // standing) never showed anything overdue here, and Annual-frequency rules
    // are deliberately excluded from the missing-task-gap check elsewhere
    // (relevantMissingTaskRules, complianceGapFlags.ts) — so nothing anywhere
    // in this app caught it. Confirmed live: a real client's April 2026 report
    // was never filed, never tracked, and only surfaced when a staffer entered
    // a manual "not in good standing" note months later. computeDuePeriod's
    // annual branch (same engine Business Tax Return/MW508 already use here)
    // reports last year's period whether its due date has passed or not, which
    // is what actually lets this show as overdue. It has no per-client
    // awareness on its own, though — it always reports last calendar year's
    // period regardless of the client's actual formation date, so the
    // dateOfFormation check below is a floor: a client that didn't exist yet
    // for that fiscal year falls back to the safe forward-only date instead
    // of being falsely flagged. Deliberately NOT added to UNVERIFIED_PAST_SOURCES below —
    // unlike EFTPS/MD Withholding/MD UI/Business Tax Return, there is no flag/
    // timeline backup that would otherwise catch a missed one.
    //
    // 2026-08-26: that floor was written as "only show overdue if we have a
    // formation date AND it proves the client existed" — but date_of_formation
    // turned out to be unset on 140 of the 141 real clients with this flag
    // on, so in practice almost nobody was ever checked at all (confirmed
    // against production). Flipped to the opposite default: a MISSING
    // formation date now means "assume old enough to owe it" (the common,
    // safe case for an established client), and the safe forward-only
    // fallback only applies when we have a formation date that PROVES the
    // client is too new — the one case the floor actually exists to protect.
    const period = computeDuePeriod({ frequency: "Annual", due_day: "15", due_month: "4" }, asOf);
    if (period && (!params.dateOfFormation || params.dateOfFormation <= period.periodEnd)) {
      deadlines.push({ label: "MD Annual Report", date: period.dueDate, source: "MD Annual Report" });
    } else {
      deadlines.push({ label: "MD Annual Report", date: nextFixedAnnualDate(4, 15, asOf), source: "MD Annual Report" });
    }
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

  deadlines.push(...computeIndividualDeadlines(params.clientType, withinDays, asOf));

  // TAX-003: mirrors TR-023/TR-024 (sql/072) — same computeDuePeriod engine
  // the Task Rules Agent uses, so this preview and the real drafted task
  // never disagree on the date.
  if (params.w21099Enabled) {
    const period = computeDuePeriod({ frequency: "Annual", due_day: "31", due_month: "1" }, asOf);
    if (period) {
      deadlines.push({ label: "1099-NEC/MISC Filing", date: period.dueDate, source: "1099/W-2" });
      deadlines.push({ label: "W-2/W-3 Filing", date: period.dueDate, source: "1099/W-2" });
    }
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
      if (params.completedKeys?.has(`${d.source}|${d.date}`)) return false;
      const dueDate = new Date(`${d.date}T00:00:00`);
      if (dueDate > cutoff) return false;
      if (UNVERIFIED_PAST_SOURCES.has(d.source) && dueDate < todayStart) return false;
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
