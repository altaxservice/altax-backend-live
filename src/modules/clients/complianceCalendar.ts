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
  /**
   * `source` is a stable internal key (stored in v3_obligation_completions as
   * `${source}|${date}`, and matched by reminders/SWOT/timeline) — it is NOT
   * shown to anyone. Several keys keep their historical "MD" name even when
   * the deadline belongs to a DC client ("MD Withholding" covers DC
   * withholding too); renaming them would orphan every saved "mark done".
   * The state-correct wording lives in `label`, which is what users see.
   */
  source: "MD Sales Tax" | "DC Sales Tax" | "Payroll" | "Federal Payroll Tax" | "MD Annual Report" | "S-Corp Election" | "EFTPS" | "MD Withholding" | "MD UI" | "Business Tax Return" | "Individual Tax Return" | "Estimated Tax" | "1099/W-2";
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
 * State obligation rules for every state other than Maryland (Maryland's
 * original rules stay inline in computeUpcomingDeadlines). Every date below is
 * from that state's own published instructions, researched 2026-10-02 — none is
 * inferred from Maryland's. Anything an official source didn't state clearly is
 * deliberately left out rather than guessed:
 *
 *  DC  withholding: monthly deposit+return the 20th (FR-900M); quarterly deposit
 *      the 20th, FR-900Q return month-end after the quarter; annual filer Jan 20
 *      (deposit) / Jan 31 (FR-900A). UI (DOES, UC-30): month-end after quarter.
 *      Biennial report (DLCP, BRA-25): April 1 of the year after registration,
 *      then every two years.
 *  VA  withholding (Tax): monthly VA-5 the 25th; quarterly VA-5 month-end after
 *      the quarter; every filer's VA-6 annual reconciliation Jan 31. Semi-weekly
 *      (VA-15) depends on bank cutoffs, so it isn't a single date and isn't
 *      shown. UI (VEC, FC-20/FC-21): month-end after quarter. SCC annual
 *      registration fee: last day of the entity's formation month.
 *  PA  withholding (Revenue): quarterly return+payment month-end after the
 *      quarter; monthly payment the 15th (December: Jan 31) plus the quarterly
 *      reconciliation return; REV-1667 annual reconciliation Jan 31. UC (L&I,
 *      UC-2/UC-2A): month-end after quarter. Dept. of State annual report (from
 *      2025): LLCs Sept 30, corporations June 30.
 *  DE  withholding (Revenue): monthly W-1 the 15th; quarterly W-1Q month-end
 *      after the quarter; WTH-REC annual reconciliation Jan 31. UI (DOL,
 *      UC-8/UC-8A): month-end after quarter. Division of Corporations: LLC/
 *      partnership annual tax June 1; corporation annual report + franchise tax
 *      March 1.
 *
 * Payroll deadlines move to the next business day when they land on a weekend
 * (every state's own rule, except where noted); holidays aren't modeled.
 * Withholding frequencies the app offers that a state doesn't have (DC and VA
 * have no semiannual; PA/DE/VA have no annual payment frequency) simply yield
 * no payment deadline. Sales tax isn't covered here — only Maryland and DC have
 * a filing engine to resolve a period against.
 */
export const STATES_WITH_OBLIGATION_RULES = ["DC", "VA", "PA", "DE"] as const;

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A due date that lands on Saturday/Sunday moves to Monday. */
function nextBusinessDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (dow === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The most recent already-due and the next upcoming DC biennial report dates, or null when the formation year (which fixes the two-year cycle) isn't known. */
export function dcBiennialReportDueDates(dateOfFormation: string | null | undefined, asOf: Date): { previous: string | null; next: string } | null {
  const formationYear = Number(String(dateOfFormation || "").slice(0, 4));
  if (!Number.isFinite(formationYear) || formationYear < 1900) return null;
  const today = localYmd(asOf);
  const firstDueYear = formationYear + 1;
  let year = firstDueYear;
  while (`${year}-04-01` < today) year += 2;
  return { previous: year - 2 >= firstDueYear ? `${year - 2}-04-01` : null, next: `${year}-04-01` };
}

/** The last already-due and next upcoming occurrence of a once-a-year `month`/`day` (day 0 = last day of the month), never before `minYear`. */
function yearlyDueDates(month: number, day: number, minYear: number, asOf: Date): { previous: string | null; next: string } {
  const today = localYmd(asOf);
  const dateIn = (y: number) => {
    const d = day === 0 ? new Date(Date.UTC(y, month, 0)).getUTCDate() : day;
    return `${y}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  let nextYear = Math.max(asOf.getFullYear(), minYear);
  while (dateIn(nextYear) < today) nextYear += 1;
  return { previous: nextYear - 1 >= minYear ? dateIn(nextYear - 1) : null, next: dateIn(nextYear) };
}

type PayrollFrequency = "Monthly" | "Quarterly" | "Annual";

function recurringDue(frequency: PayrollFrequency, dueDay: number, asOf: Date, dueMonth = "1"): string | null {
  const p = computeDuePeriod({ frequency, due_day: String(dueDay), due_month: frequency === "Annual" ? dueMonth : null }, asOf);
  return p ? p.dueDate : null;
}

function computeStateWithholdingDeadlines(st: string, frequency: string, asOf: Date): ComplianceDeadline[] {
  const out: ComplianceDeadline[] = [];
  const add = (label: string, date: string | null) => {
    if (date) out.push({ label, date: nextBusinessDay(date), source: "MD Withholding" });
  };
  const monthly = frequency === "Monthly";
  const quarterly = frequency === "Quarterly";

  if (st === "DC") {
    if (monthly) add("DC Withholding Deposit & Return (FR-900M)", recurringDue("Monthly", 20, asOf));
    else if (quarterly) {
      add("DC Withholding Deposit", recurringDue("Quarterly", 20, asOf));
      add("DC Withholding Return (FR-900Q)", recurringDue("Quarterly", 31, asOf));
    } else if (frequency === "Annually") {
      add("DC Withholding Deposit (annual filer)", recurringDue("Annual", 20, asOf));
      add("DC Withholding Return (FR-900A)", recurringDue("Annual", 31, asOf));
    }
  } else if (st === "VA") {
    if (monthly) add("VA Withholding Return & Payment (VA-5)", recurringDue("Monthly", 25, asOf));
    else if (quarterly) add("VA Withholding Return & Payment (VA-5, quarterly)", recurringDue("Quarterly", 31, asOf));
    add("VA Annual Withholding Reconciliation (VA-6)", recurringDue("Annual", 31, asOf));
  } else if (st === "PA") {
    if (quarterly) add("PA Withholding Return & Payment (quarterly)", recurringDue("Quarterly", 31, asOf));
    else if (monthly) {
      let payment = recurringDue("Monthly", 15, asOf);
      // PA's December payment is due Jan 31, not Jan 15 (REV-415).
      if (payment && payment.slice(5, 7) === "01") payment = `${payment.slice(0, 4)}-01-31`;
      add("PA Withholding Payment", payment);
      add("PA Withholding Quarterly Reconciliation Return", recurringDue("Quarterly", 31, asOf));
    }
    add("PA Annual Withholding Reconciliation (REV-1667)", recurringDue("Annual", 31, asOf));
  } else if (st === "DE") {
    if (monthly) add("DE Withholding Return & Payment (W-1)", recurringDue("Monthly", 15, asOf));
    else if (quarterly) add("DE Withholding Return & Payment (W-1Q)", recurringDue("Quarterly", 31, asOf));
    add("DE Annual Withholding Reconciliation (WTH-REC)", recurringDue("Annual", 31, asOf));
  }
  return out;
}

const STATE_UI_LABELS: Record<string, string> = {
  DC: "DC UI Contributions & Wage Report (UC-30)",
  VA: "VA UI Tax & Wage Reports (FC-20/FC-21)",
  PA: "PA UC Reports & Contributions (UC-2/UC-2A)",
  DE: "DE UI Tax & Wage Reports (UC-8/UC-8A)",
};

function computeStateUiDeadline(st: string, asOf: Date): ComplianceDeadline[] {
  const label = STATE_UI_LABELS[st];
  const date = recurringDue("Quarterly", 31, asOf);
  if (!label || !date) return [];
  // Delaware's DOL doesn't state a weekend rule, so its date is left as published.
  return [{ label, date: st === "DE" ? date : nextBusinessDay(date), source: "MD UI" }];
}

function computeStateAnnualReportDeadlines(st: string, params: { entityType?: string | null; dateOfFormation?: string | null }, asOf: Date): ComplianceDeadline[] {
  const out: ComplianceDeadline[] = [];
  const push = (label: string, dates: { previous: string | null; next: string } | null) => {
    if (!dates) return;
    if (dates.previous) out.push({ label, date: dates.previous, source: "MD Annual Report" });
    out.push({ label, date: dates.next, source: "MD Annual Report" });
  };
  const entity = String(params.entityType || "").trim();
  const isLlc = entity === "LLC";
  const isCorp = entity === "S-Corp" || entity === "C-Corp";
  const formed = String(params.dateOfFormation || "");
  const formationYear = Number(formed.slice(0, 4));
  const hasFormation = Number.isFinite(formationYear) && formationYear >= 1900;
  // An entity formed during a year first owes the filing the year after; an
  // unknown formation date is treated as "established", the same default the
  // Maryland Annual Report uses.
  const earliestYear = hasFormation ? formationYear + 1 : 1900;

  if (st === "DC") {
    push("DC Biennial Report (BRA-25)", dcBiennialReportDueDates(params.dateOfFormation, asOf));
  } else if (st === "VA" && (isLlc || isCorp) && hasFormation) {
    // The SCC's annual fee is due the last day of the month the entity was formed.
    const formationMonth = Number(formed.slice(5, 7));
    if (formationMonth >= 1 && formationMonth <= 12) {
      push(isCorp ? "VA SCC Annual Report & Registration Fee" : "VA SCC Annual Registration Fee", yearlyDueDates(formationMonth, 0, earliestYear, asOf));
    }
  } else if (st === "PA" && (isLlc || isCorp)) {
    // PA's Dept. of State annual report requirement began January 1, 2025.
    push(isCorp ? "PA Annual Report (corporation)" : "PA Annual Report (LLC)", yearlyDueDates(isCorp ? 6 : 9, isCorp ? 30 : 30, Math.max(2025, earliestYear), asOf));
  } else if (st === "DE") {
    if (isCorp) push("DE Corporation Annual Report & Franchise Tax", yearlyDueDates(3, 1, earliestYear, asOf));
    else if (isLlc || entity === "Partnership") push("DE LLC/Partnership Annual Tax", yearlyDueDates(6, 1, earliestYear, asOf));
  }
  return out;
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
  /**
   * v3_clients.state. Decides which state's obligation rules apply to the
   * state-specific deadlines below (withholding, unemployment insurance, annual
   * report). Unset means Maryland, the app's original behavior. MD, DC, VA, PA
   * and DE have rules (see STATES_WITH_OBLIGATION_RULES); any other state gets
   * none of those deadlines rather than Maryland's dates under another state's name.
   */
  state?: string | null;
  mdCurrentPeriodDueDate: string | null;
  /** DC sales tax (FR-800) due date of the latest unresolved period — the DC counterpart of mdCurrentPeriodDueDate. */
  dcCurrentPeriodDueDate?: string | null;
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
  const stateCode = String(params.state || "").trim().toUpperCase();
  const isMd = !stateCode || stateCode === "MD";
  const isDc = stateCode === "DC";
  const hasStateRules = (STATES_WITH_OBLIGATION_RULES as readonly string[]).includes(stateCode);

  if (params.mdCurrentPeriodDueDate) {
    deadlines.push({ label: "MD Sales Tax Filing", date: params.mdCurrentPeriodDueDate, source: "MD Sales Tax" });
  }
  if (isDc && params.dcCurrentPeriodDueDate) {
    deadlines.push({ label: "DC Sales Tax Filing (FR-800)", date: params.dcCurrentPeriodDueDate, source: "DC Sales Tax" });
  }
  if (params.payrollNextDate) {
    deadlines.push({ label: "Next Payroll", date: params.payrollNextDate, source: "Payroll" });
  }
  deadlines.push(...computeFederalPayrollDeadlines(params.payrollEnabled, withinDays, asOf));

  if (params.mdAnnualReportEnabled && hasStateRules) {
    deadlines.push(...computeStateAnnualReportDeadlines(stateCode, params, asOf));
  } else if (params.mdAnnualReportEnabled && isMd) {
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

  if (hasStateRules && params.mdWithholdingFrequency) {
    deadlines.push(...computeStateWithholdingDeadlines(stateCode, params.mdWithholdingFrequency, asOf));
  }
  const mdWhFrequency = isMd && params.mdWithholdingFrequency ? MD_WITHHOLDING_FREQ_TO_RULE_FREQUENCY[params.mdWithholdingFrequency] : undefined;
  if (mdWhFrequency) {
    const period = computeDuePeriod({ frequency: mdWhFrequency, due_day: "15", due_month: "1" }, asOf);
    if (period) deadlines.push({ label: "MD Withholding Payment", date: period.dueDate, source: "MD Withholding" });
    const reconciliation = computeDuePeriod({ frequency: "Annual", due_day: "31", due_month: "1" }, asOf);
    if (reconciliation) deadlines.push({ label: "MD Withholding Annual Reconciliation (MW508)", date: reconciliation.dueDate, source: "MD Withholding" });
  }

  if (params.mduiEnabled && hasStateRules) {
    deadlines.push(...computeStateUiDeadline(stateCode, asOf));
  }
  if (params.mduiEnabled && isMd) {
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
