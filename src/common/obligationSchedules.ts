import { query, queryOne } from "../config/db";
import { computeForm941Quarter, sumEftpsDepositsInPeriod } from "../modules/accounting/form941Data";
import { computeMonthlyReview } from "../modules/eftpsDeposits/eftpsMonthly";
import { splitIntoWithholdingPeriods, type WithholdingPeriodSpan } from "./withholdingFiling";

/**
 * Period tables for the three other recurring filings that get the same
 * treatment as sales tax and withholding — state unemployment insurance (UI),
 * the yearly business annual/biennial report, and federal Form 941: for each
 * period, the statutory due date, an internal target filing date, the amount
 * (suggested from the books, or what was filed), whether it's on time, and the
 * penalty/interest if it's late — merged with what's been recorded in each
 * obligation's own filings table.
 *
 * Due dates and late charges are from each jurisdiction's own published
 * instructions (researched 2026-10-02, cited per rule below). Where an official
 * source didn't state a rule clearly, the period still tracks everything but
 * shows no penalty rather than a number that might be wrong.
 */

export type ObligationKind = "ui" | "annual-report" | "form941" | "eftps";
export const OBLIGATION_KINDS: ObligationKind[] = ["ui", "annual-report", "form941", "eftps"];
export function asObligationKind(v: unknown): ObligationKind | null {
  return (OBLIGATION_KINDS as string[]).includes(String(v)) ? (v as ObligationKind) : null;
}

export interface ObligationClient {
  clientId: string; state: string; entityType: string | null; dateOfFormation: string | null;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function parseIso(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function lastDayOfMonth(year: number, month0: number): number { return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate(); }
function nextBusinessDay(isoDate: string): string {
  const d = parseIso(isoDate);
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (dow === 0) d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}
function isoOnly(v: unknown): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}
function monthsLateInclusive(due: Date, paid: Date): number {
  if (paid <= due) return 0;
  let months = (paid.getUTCFullYear() - due.getUTCFullYear()) * 12 + (paid.getUTCMonth() - due.getUTCMonth());
  if (paid.getUTCDate() > Math.min(due.getUTCDate(), lastDayOfMonth(paid.getUTCFullYear(), paid.getUTCMonth()))) months += 1;
  return Math.max(months, 1);
}
function daysBetween(a: Date, b: Date): number { return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000)); }

/** One filing period as the generic table shows it. */
export interface ObligationPeriodSpan {
  start: string; end: string;
  /** Statutory due date (weekends moved to Monday). */
  dueDate: string;
  /** What the period is called in a heading ("Q3 2026", "2026 report"). */
  label: string;
  /** Amount suggested from the books, null when the filing amount is simply staff-entered. */
  suggestedAmount: number | null;
  /** Extra read-only facts shown with the period (e.g. Form 941's gross liability and EFTPS deposits). */
  detail?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Due dates
// ---------------------------------------------------------------------------

/**
 * State UI quarterly report/contribution due date: the last day of the month
 * after the quarter in every state we track — MD (COMAR 09.32.01.09; the firm's
 * own 24th is an internal target, not the statutory date), DC (DOES UC-30), VA
 * (VEC FC-20/FC-21), PA (L&I UC-2/UC-2A), DE (DOL UC-8/UC-8A). Weekend rule:
 * Virginia (Va. Code 60.2-512) and Pennsylvania (UC-2INS) move a weekend/holiday
 * due date to the next business day; DC's handbook says reports are due
 * regardless of a non-business day, and Maryland and Delaware don't state a rule,
 * so those dates are left as published.
 */
export function uiDueDate(state: string, periodEnd: string): string {
  const end = parseIso(periodEnd);
  const dueYear = end.getUTCMonth() === 11 ? end.getUTCFullYear() + 1 : end.getUTCFullYear();
  const dueMonth0 = (end.getUTCMonth() + 1) % 12;
  const due = iso(new Date(Date.UTC(dueYear, dueMonth0, lastDayOfMonth(dueYear, dueMonth0))));
  const code = state.toUpperCase();
  return code === "VA" || code === "PA" ? nextBusinessDay(due) : due;
}

/** Federal Form 941: last day of the month after the quarter, next business day if that's a weekend/holiday (Form 941 instructions, Rev. 3-2026). */
export function form941DueDate(periodEnd: string): string {
  const end = parseIso(periodEnd);
  const dueYear = end.getUTCMonth() === 11 ? end.getUTCFullYear() + 1 : end.getUTCFullYear();
  const dueMonth0 = (end.getUTCMonth() + 1) % 12;
  return nextBusinessDay(iso(new Date(Date.UTC(dueYear, dueMonth0, lastDayOfMonth(dueYear, dueMonth0)))));
}

/**
 * Federal payroll tax deposit (EFTPS) for a monthly depositor: the 15th of the month after the
 * payroll month, moved to the next business day when that's a weekend (Pub. 15, Circular E).
 * MLK Day and Washington's Birthday, the two federal holidays that can fall on the 15th–17th, are handled.
 */
export function eftpsDueDate(periodEnd: string): string {
  const end = parseIso(periodEnd);
  let d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 15));
  // Weekends, and the two federal holidays that fall around the 15th: Martin Luther King Jr. Day
  // (3rd Monday of January) and Washington's Birthday (3rd Monday of February).
  const isHoliday = (x: Date) => (x.getUTCMonth() === 0 || x.getUTCMonth() === 1) && x.getUTCDay() === 1 && x.getUTCDate() >= 15 && x.getUTCDate() <= 21;
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || isHoliday(d)) d = new Date(d.getTime() + 86400000);
  return iso(d);
}

/** "Internal target" a couple of days early, same buffer the sales tax tables use. */
export function targetFilingDate(dueDateIso: string): string {
  const due = parseIso(dueDateIso);
  const dow = due.getUTCDay();
  due.setUTCDate(due.getUTCDate() - (dow === 0 || dow === 6 ? 3 : 2));
  return iso(due);
}

// ---------------------------------------------------------------------------
// Annual / biennial report (due-year D <-> report year D-1, matching how the
// Maryland Annual Report has always been recorded: period Jan 1-Dec 31 of the
// year before its due date).
// ---------------------------------------------------------------------------

function entityClass(entityType: string | null): "llc" | "corp" | "partnership" | "other" {
  const e = String(entityType || "").trim();
  if (e === "LLC") return "llc";
  if (e === "S-Corp" || e === "C-Corp") return "corp";
  if (e === "Partnership") return "partnership";
  return "other";
}

/**
 * The state's annual/biennial filing due date in due-year `dueYear`, or null
 * when no filing is due that year for this entity.
 *  MD  Annual Report + Personal Property Return, April 15 (SDAT).
 *  DC  Biennial Report (DLCP), April 1 of the year after registration then every two years.
 *  VA  SCC annual registration fee, last day of the formation month (LLCs, corporations).
 *  PA  Dept. of State annual report, from 2025: LLCs Sept 30, corporations June 30.
 *  DE  LLC/partnership annual tax June 1; corporation annual report + franchise tax March 1.
 */
export function annualReportDueDate(client: ObligationClient, dueYear: number): string | null {
  const st = client.state.toUpperCase();
  const cls = entityClass(client.entityType);
  const formationYear = Number(String(client.dateOfFormation || "").slice(0, 4));
  const hasFormation = Number.isFinite(formationYear) && formationYear >= 1900;
  const afterFormation = !hasFormation || dueYear >= formationYear + 1;
  const pad = (n: number) => String(n).padStart(2, "0");

  if (st === "MD") return `${dueYear}-04-15`;
  if (st === "DC") {
    if (!hasFormation || dueYear < formationYear + 1 || (dueYear - (formationYear + 1)) % 2 !== 0) return null;
    return `${dueYear}-04-01`;
  }
  if (st === "VA") {
    if ((cls !== "llc" && cls !== "corp") || !hasFormation || !afterFormation) return null;
    const month = Number(String(client.dateOfFormation).slice(5, 7));
    if (month < 1 || month > 12) return null;
    return `${dueYear}-${pad(month)}-${pad(lastDayOfMonth(dueYear, month - 1))}`;
  }
  if (st === "PA") {
    if ((cls !== "llc" && cls !== "corp") || dueYear < 2025 || !afterFormation) return null;
    return cls === "corp" ? `${dueYear}-06-30` : `${dueYear}-09-30`;
  }
  if (st === "DE") {
    if (!afterFormation) return null;
    if (cls === "corp") return `${dueYear}-03-01`;
    if (cls === "llc" || cls === "partnership") return `${dueYear}-06-01`;
    return null;
  }
  return null;
}

/**
 * What the filing normally costs, as a starting point staff can correct.
 * MD: SDAT's $300 Form 1 filing fee for stock corporations, LLCs and LPs ($0
 * for a nonstock/nonprofit corporation) — the amounts recorded for real MD
 * clients are the fee actually paid. DC: $300 (DLCP, LLC and corporation).
 * VA: LLC $50 (corporation fees depend on authorized shares, so staff enter
 * it). PA: $7. DE: LLC/partnership annual tax — $300 through the June 2026
 * payment, $400 from June 2027 (HB 400); Delaware's own pages disagree on
 * which payment first bills $400, so confirm before filing. Corporation
 * franchise tax depends on shares/capital, so staff enter it.
 */
export function annualReportSuggestedFee(client: ObligationClient, dueYear: number): number | null {
  const st = client.state.toUpperCase();
  const cls = entityClass(client.entityType);
  if (st === "MD") return String(client.entityType || "") === "Nonprofit" ? 0 : 300;
  if (st === "DC") return 300;
  if (st === "VA") return cls === "llc" ? 50 : null;
  if (st === "PA") return 7;
  if (st === "DE") return cls === "llc" || cls === "partnership" ? (dueYear <= 2026 ? 300 : 400) : null;
  return null;
}

export function annualReportApplies(client: ObligationClient): { applies: boolean; reason?: string } {
  const st = client.state.toUpperCase();
  if (!["MD", "DC", "VA", "PA", "DE"].includes(st)) return { applies: false, reason: `Annual report tracking isn't built for ${st || "this client's"} state yet — it covers MD, DC, VA, PA and DE.` };
  const cls = entityClass(client.entityType);
  if (st !== "MD" && cls === "other") return { applies: false, reason: "This client's entity type doesn't file a state annual report (it applies to LLCs and corporations)." };
  if ((st === "DC" || st === "VA") && !String(client.dateOfFormation || "").trim()) {
    return { applies: false, reason: `${st === "DC" ? "DC's biennial report cycle" : "Virginia's annual registration month"} comes from the formation date — add this client's Date of Formation on their profile.` };
  }
  return { applies: true };
}

// ---------------------------------------------------------------------------
// Period lists
// ---------------------------------------------------------------------------

function quarterLabel(start: string): string {
  const m = Number(start.slice(5, 7));
  return `Q${Math.floor((m - 1) / 3) + 1} ${start.slice(0, 4)}`;
}

/**
 * SUM of SUTA withheld for the employer in a period — only paychecks whose
 * payroll state is the client's own (an employee in another state accrues that
 * state's unemployment tax, not this one's).
 */
async function sutaByPeriod(clientId: string, state: string, spans: WithholdingPeriodSpan[]): Promise<number[]> {
  if (spans.length === 0) return [];
  const rows = await query<{ pay_date: unknown; suta: string }>(
    `SELECT p.pay_date, p.suta FROM altax.v3_paychecks p
       LEFT JOIN altax.v3_employees e ON e.employee_id = p.employee_id
      WHERE p.client_id = $1 AND lower(p.status) <> 'void'
        AND p.pay_date::date >= $2::date AND p.pay_date::date <= $3::date
        AND upper(COALESCE(NULLIF(btrim(e.state), ''), $4)) = $4`,
    [clientId, spans[0].start, spans[spans.length - 1].end, state.toUpperCase()]
  );
  return spans.map((s) => round2(rows.reduce((sum, r) => {
    const d = isoOnly(r.pay_date);
    return d !== null && d >= s.start && d <= s.end ? sum + (Number(r.suta) || 0) : sum;
  }, 0)));
}

export async function listObligationPeriods(kind: ObligationKind, client: ObligationClient, from: string, to: string): Promise<ObligationPeriodSpan[]> {
  if (kind === "ui") {
    const spans = splitIntoWithholdingPeriods(from, to, "Quarterly");
    const amounts = await sutaByPeriod(client.clientId, client.state, spans);
    return spans.map((s, i) => ({ ...s, dueDate: uiDueDate(client.state, s.end), label: quarterLabel(s.start), suggestedAmount: amounts[i] }));
  }
  if (kind === "form941") {
    const spans = splitIntoWithholdingPeriods(from, to, "Quarterly");
    const out: ObligationPeriodSpan[] = [];
    for (const s of spans) {
      const year = Number(s.start.slice(0, 4));
      const quarter = (Math.floor((Number(s.start.slice(5, 7)) - 1) / 3) + 1) as 1 | 2 | 3 | 4;
      const totals = await computeForm941Quarter(client.clientId, year, quarter);
      const deposits = await sumEftpsDepositsInPeriod(client.clientId, s.start, s.end);
      out.push({
        ...s, dueDate: form941DueDate(s.end), label: quarterLabel(s.start),
        suggestedAmount: round2(Math.max(0, totals.grossLiability - deposits)),
        detail: { grossLiability: round2(totals.grossLiability), eftpsDeposits: round2(deposits), wages: round2(totals.wages) },
      });
    }
    return out;
  }
  if (kind === "eftps") {
    // One period per calendar month that has imported paychecks (or an already-filed deposit).
    const first = `${from.slice(0, 7)}-01`;
    const lastDay = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0)).getUTCDate();
    const last = `${to.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
    const months = await computeMonthlyReview(client.clientId, first, last);
    return months
      .filter((m) => m.paycheckCount > 0 || m.existingDeposit)
      .map((m) => ({
        start: m.periodStart, end: m.periodEnd, dueDate: eftpsDueDate(m.periodEnd),
        label: new Date(`${m.periodStart}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
        suggestedAmount: m.computation ? m.computation.totalAmount : null,
        detail: m.computation ? {
          federalIncomeTax: m.computation.federalIncomeTaxTotal, socialSecurity: m.computation.socialSecurityTotal,
          medicare: m.computation.medicareTotal, paychecks: m.paycheckCount, computedTotal: m.computation.totalAmount,
          basis: m.computation.basis === "drake" ? 2 : m.computation.basis === "wages" ? 1 : 0,
        } : undefined,
      }));
  }
  // annual report: one period per due year whose report year (due year - 1) overlaps [from, to]
  const out: ObligationPeriodSpan[] = [];
  for (let reportYear = Number(from.slice(0, 4)); reportYear <= Number(to.slice(0, 4)); reportYear++) {
    const due = annualReportDueDate(client, reportYear + 1);
    if (!due) continue;
    out.push({
      start: `${reportYear}-01-01`, end: `${reportYear}-12-31`, dueDate: nextBusinessDay(due),
      label: `${reportYear + 1} report`, suggestedAmount: annualReportSuggestedFee(client, reportYear + 1),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recorded filings (each obligation keeps its own table; these are read-only here)
// ---------------------------------------------------------------------------

export interface RecordedObligation {
  filedDate: string; paidDate: string | null; amount: number;
  acknowledgedAt: string | null; sentAt: string | null;
  /** The filing's own id when its routes are addressed by id (EFTPS deposits). */
  recordId: string | null;
}

export async function loadRecordedObligations(kind: ObligationKind, clientId: string, from: string, to: string): Promise<Map<string, RecordedObligation>> {
  if (kind === "eftps") {
    const rows = await query<any>(
      `SELECT deposit_id, period_end::date::text AS period_end, filing_date::date::text AS filed_date, payment_date::date::text AS paid_date,
              total_amount AS amount, acknowledged_at, CASE WHEN status = 'Sent' THEN updated_at END AS sent_at
         FROM altax.v3_eftps_deposits WHERE client_id = $1 AND period_end >= $2::date AND period_end <= $3::date`,
      [clientId, from, to]
    );
    return new Map(rows.map((r: any) => [r.period_end, {
      filedDate: r.filed_date, paidDate: r.paid_date, amount: Number(r.amount) || 0,
      acknowledgedAt: r.acknowledged_at ? new Date(r.acknowledged_at).toISOString() : null,
      sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null, recordId: r.deposit_id,
    }]));
  }
  const table = kind === "ui" ? "v3_md_ui_filings" : kind === "annual-report" ? "v3_annual_report_filings" : "v3_form941_filings";
  const amountCol = kind === "form941" ? "balance_due" : "amount";
  const rows = await query<any>(
    `SELECT period_end::date::text AS period_end, filed_date::date::text AS filed_date, paid_date::date::text AS paid_date,
            ${amountCol} AS amount, acknowledged_at, sent_at
       FROM altax.${table} WHERE client_id = $1 AND period_end >= $2::date AND period_end <= $3::date`,
    [clientId, from, to]
  );
  return new Map(rows.map((r: any) => [r.period_end, {
    filedDate: r.filed_date, paidDate: r.paid_date, amount: Number(r.amount) || 0,
    acknowledgedAt: r.acknowledged_at ? new Date(r.acknowledged_at).toISOString() : null,
    sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null, recordId: null,
  }]));
}

export async function loadExcludedObligationPeriods(kind: ObligationKind, clientId: string, from: string, to: string): Promise<Set<string>> {
  const rows = await query<{ period_end: string }>(
    `SELECT period_end::date::text AS period_end FROM altax.v3_obligation_period_exclusions
      WHERE client_id = $1 AND kind = $2 AND period_end >= $3::date AND period_end <= $4::date`,
    [clientId, kind, from, to]
  );
  return new Set(rows.map((r) => r.period_end));
}

// ---------------------------------------------------------------------------
// Late charges
// ---------------------------------------------------------------------------

export interface ObligationLateResult {
  amount: number; onTime: boolean; penalty: number; interest: number; monthsLate: number; balanceDue: number;
  /** False when this jurisdiction's late-charge rules aren't built: penalty/interest are 0 and don't mean "none owed". */
  lateChargesComputed: boolean;
}

/** IRS underpayment interest rates by quarter (federal short-term rate + 3 points, compounded daily) — IRS quarterly interest-rate notices; update each quarter. */
const IRS_UNDERPAYMENT_RATE: Record<string, number> = {
  "2025-Q4": 0.07, "2026-Q1": 0.07, "2026-Q2": 0.06, "2026-Q3": 0.07, "2026-Q4": 0.07,
};
const IRS_FALLBACK_RATE = 0.07;
function irsRateOn(d: Date): number {
  return IRS_UNDERPAYMENT_RATE[`${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`] ?? IRS_FALLBACK_RATE;
}

/**
 * Federal Form 941 balance due paid/filed late (Pub. 15 and Form 941
 * instructions, 2026): failure-to-file is 5% of the unpaid tax per month or part
 * of a month (25% cap), reduced by the failure-to-pay penalty (0.5% per month or
 * part, 25% cap) in months both apply — so $5,000 filed and paid 2 months late is
 * $450 + $50. Interest is the quarterly underpayment rate, compounded daily from
 * the due date. Failure-to-DEPOSIT penalties depend on each EFTPS deposit's own
 * timing and aren't part of this return-level figure.
 */
function form941Late(amount: number, dueDate: string, filedDate: string, paidDate: string): ObligationLateResult {
  const due = parseIso(dueDate);
  const filed = parseIso(filedDate);
  const paid = parseIso(paidDate);
  const fm = monthsLateInclusive(due, filed);
  const pm = monthsLateInclusive(due, paid);
  if (fm === 0 && pm === 0) return { amount, onTime: true, penalty: 0, interest: 0, monthsLate: 0, balanceDue: round2(amount), lateChargesComputed: true };
  const ftf = Math.max(0, amount * Math.min(0.25, 0.05 * fm) - amount * 0.005 * Math.min(fm, pm));
  const ftp = amount * Math.min(0.25, 0.005 * pm);
  const penalty = round2(ftf + ftp);
  // Day-by-day compounding so a balance carried across a quarter that changes the rate uses each day's own rate.
  let factor = 1;
  for (let d = new Date(due.getTime() + 86400000); d <= paid; d = new Date(d.getTime() + 86400000)) factor *= 1 + irsRateOn(d) / 365;
  const interest = round2(amount * (factor - 1));
  return { amount, onTime: false, penalty, interest, monthsLate: Math.max(fm, pm), balanceDue: round2(amount + penalty + interest), lateChargesComputed: true };
}

/**
 * Federal failure-to-deposit penalty (IRC 6656; Pub. 15 "Deposit Penalties"): 2% of the late deposit
 * when it's 1-5 days late, 5% when 6-15 days late, 10% when more than 15 days late (15% after an IRS
 * demand, not modelled). The deposit counts as made on the day it was paid. Interest is the quarterly
 * underpayment rate compounded daily from the due date to the payment date.
 */
function eftpsLate(amount: number, dueDate: string, paidDate: string): ObligationLateResult {
  const due = parseIso(dueDate);
  const paid = parseIso(paidDate);
  const days = paid > due ? daysBetween(due, paid) : 0;
  if (days === 0) return { amount, onTime: true, penalty: 0, interest: 0, monthsLate: 0, balanceDue: round2(amount), lateChargesComputed: true };
  const rate = days <= 5 ? 0.02 : days <= 15 ? 0.05 : 0.10;
  let factor = 1;
  for (let d = new Date(due.getTime() + 86400000); d <= paid; d = new Date(d.getTime() + 86400000)) factor *= 1 + irsRateOn(d) / 365;
  const penalty = round2(amount * rate);
  const interest = round2(amount * (factor - 1));
  // monthsLate carries the number of DAYS late for this filing (the table shows "Late — N days").
  return { amount, onTime: false, penalty, interest, monthsLate: days, balanceDue: round2(amount + penalty + interest), lateChargesComputed: true };
}

interface UiRule { reportPenalty: (amount: number) => number; interestMonthly: number; singlePenaltyEitherLate: boolean }
/**
 * State UI late charges (2026 rules, official sources):
 *  MD  $35 per late report (COMAR 09.32.01.16); 1.5%/month on late contributions. No separate late-payment penalty.
 *  DC  one penalty for a late report and/or tax: the greater of 10% of the tax or $100 (DOES UI handbook); 1.5%/month or fraction.
 *  VA  $100 per late report (Va. Code 60.2-513; waived when no wages were paid); 1.5%/month, a part month counts as a full one.
 *  PA  15% of the quarter's contributions, min $125, max $450 (UC-2INS); interest 1%/month for 2026 (the greater of 1/12 of the Fiscal Code rate or 1%) — update the rate each year.
 *  DE  $17.50 per late report (DOL FAQ; the older handbook says $17.25 and only after 5 days); 1.5%/month or fraction.
 * Interest is simple, per month or part of a month, on the contribution from the due date until paid.
 */
const UI_RULES: Record<string, UiRule> = {
  MD: { reportPenalty: () => 35, interestMonthly: 0.015, singlePenaltyEitherLate: false },
  DC: { reportPenalty: (a) => Math.max(a * 0.10, 100), interestMonthly: 0.015, singlePenaltyEitherLate: true },
  VA: { reportPenalty: (a) => (a > 0 ? 100 : 0), interestMonthly: 0.015, singlePenaltyEitherLate: false },
  PA: { reportPenalty: (a) => Math.min(450, Math.max(125, a * 0.15)), interestMonthly: 0.01, singlePenaltyEitherLate: false },
  DE: { reportPenalty: () => 17.5, interestMonthly: 0.015, singlePenaltyEitherLate: false },
};

function uiLate(rule: UiRule, amount: number, dueDate: string, filedDate: string, paidDate: string): ObligationLateResult {
  const due = parseIso(dueDate);
  const filed = parseIso(filedDate);
  const paid = parseIso(paidDate);
  const reportLate = filed > due;
  const payLate = paid > due;
  if (!reportLate && !payLate) return { amount, onTime: true, penalty: 0, interest: 0, monthsLate: 0, balanceDue: round2(amount), lateChargesComputed: true };
  const penalty = round2((reportLate || (rule.singlePenaltyEitherLate && payLate)) ? rule.reportPenalty(amount) : 0);
  const monthsLate = payLate ? monthsLateInclusive(due, paid) : 0;
  const interest = round2(amount * rule.interestMonthly * monthsLate);
  return { amount, onTime: false, penalty, interest, monthsLate: Math.max(monthsLate, reportLate ? monthsLateInclusive(due, filed) : 0), balanceDue: round2(amount + penalty + interest), lateChargesComputed: true };
}

/**
 * Annual / biennial report late charges where a state publishes a flat rule:
 *  DC  $100 late fee (DLCP fee schedule).
 *  VA  LLC $25; stock corporation the greater of 10% or $10 (SCC). Interest isn't published.
 *  DE  $200 penalty plus 1.5% per month on the tax and penalty (Division of Corporations).
 *  MD  SDAT bills a penalty of 1/10 of 1% of the county personal property assessment — not knowable here, so not computed.
 *  PA  no late fee is published (the consequence is dissolution), so not computed.
 */
function annualLate(client: ObligationClient, amount: number, dueDate: string, filedDate: string, paidDate: string): ObligationLateResult {
  const due = parseIso(dueDate);
  const filed = parseIso(filedDate);
  const paid = parseIso(paidDate);
  const late = filed > due || paid > due;
  if (!late) return { amount, onTime: true, penalty: 0, interest: 0, monthsLate: 0, balanceDue: round2(amount), lateChargesComputed: lateChargesBuilt("annual-report", client) };
  const st = client.state.toUpperCase();
  const cls = entityClass(client.entityType);
  const effective = filed > paid ? filed : paid;
  const monthsLate = monthsLateInclusive(due, effective);
  let penalty = 0;
  let interest = 0;
  if (st === "DC") penalty = 100;
  else if (st === "VA") penalty = cls === "llc" ? 25 : Math.max(amount * 0.10, 10);
  else if (st === "DE") { penalty = 200; interest = (amount + penalty) * 0.015 * monthsLate; }
  penalty = round2(penalty); interest = round2(interest);
  return { amount, onTime: false, penalty, interest, monthsLate, balanceDue: round2(amount + penalty + interest), lateChargesComputed: lateChargesBuilt("annual-report", client) };
}

export function lateChargesBuilt(kind: ObligationKind, client: ObligationClient): boolean {
  const st = client.state.toUpperCase();
  if (kind === "form941" || kind === "eftps") return true;
  if (kind === "ui") return st in UI_RULES;
  if (st === "DC" || st === "DE") return true;
  if (st === "VA") return entityClass(client.entityType) === "llc" || entityClass(client.entityType) === "corp";
  return false;
}

export async function computeObligationLate(
  kind: ObligationKind, client: ObligationClient, amount: number, dueDate: string, filedDate: string, paidDate: string
): Promise<ObligationLateResult> {
  if (kind === "form941") return form941Late(amount, dueDate, filedDate, paidDate);
  if (kind === "eftps") return eftpsLate(amount, dueDate, paidDate);
  if (kind === "ui") {
    const rule = UI_RULES[client.state.toUpperCase()];
    if (rule) return uiLate(rule, amount, dueDate, filedDate, paidDate);
  } else if (lateChargesBuilt(kind, client)) {
    return annualLate(client, amount, dueDate, filedDate, paidDate);
  }
  const due = parseIso(dueDate);
  const effective = parseIso(filedDate) > parseIso(paidDate) ? parseIso(filedDate) : parseIso(paidDate);
  const monthsLate = monthsLateInclusive(due, effective);
  return { amount, onTime: monthsLate === 0, penalty: 0, interest: 0, monthsLate, balanceDue: round2(amount), lateChargesComputed: false };
}

export const _internal = { monthsLateInclusive, daysBetween, round2, parseIso };

// ---------------------------------------------------------------------------
// Breakdown
// ---------------------------------------------------------------------------

export interface ObligationPeriodResult extends ObligationLateResult {
  start: string; end: string; label: string; dueDate: string; targetFilingDate: string;
  filedDate: string; paidDate: string; markedFiledDate: string | null; markedPaidDate: string | null;
  acknowledgedAt: string | null; sentAt: string | null; recordId: string | null; detail?: Record<string, number>;
}

export interface ObligationBreakdown {
  periods: ObligationPeriodResult[];
  totals: { amount: number; penalty: number; interest: number; balanceDue: number };
}

export async function computeObligationBreakdown(
  kind: ObligationKind, client: ObligationClient, from: string, to: string, defaultFiledDate: string, defaultPaidDate: string
): Promise<ObligationBreakdown> {
  const spans = await listObligationPeriods(kind, client, from, to);
  if (spans.length === 0) return { periods: [], totals: { amount: 0, penalty: 0, interest: 0, balanceDue: 0 } };
  const first = spans[0].start;
  const last = spans[spans.length - 1].end;
  const [recorded, excluded] = await Promise.all([
    loadRecordedObligations(kind, client.clientId, first, last),
    loadExcludedObligationPeriods(kind, client.clientId, first, last),
  ]);

  const periods: ObligationPeriodResult[] = [];
  for (const span of spans) {
    const rec = recorded.get(span.end) ?? null;
    if (excluded.has(span.end) && !rec) continue;
    // A filed period reports what was actually filed, not today's recompute.
    const amount = rec ? rec.amount : span.suggestedAmount ?? 0;
    const filedDate = rec?.filedDate ?? defaultFiledDate;
    const paidDate = rec?.paidDate ?? defaultPaidDate;
    const built = lateChargesBuilt(kind, client);
    const late: ObligationLateResult = rec && rec.paidDate === null
      ? { amount, onTime: true, penalty: 0, interest: 0, monthsLate: 0, balanceDue: round2(amount), lateChargesComputed: built }
      : await computeObligationLate(kind, client, amount, span.dueDate, filedDate, paidDate);
    periods.push({
      ...late, start: span.start, end: span.end, label: span.label, dueDate: span.dueDate, targetFilingDate: targetFilingDate(span.dueDate),
      filedDate, paidDate, markedFiledDate: rec?.filedDate ?? null, markedPaidDate: rec?.paidDate ?? null,
      acknowledgedAt: rec?.acknowledgedAt ?? null, sentAt: rec?.sentAt ?? null, recordId: rec?.recordId ?? null, detail: span.detail,
    });
  }
  const totals = periods.reduce(
    (a, p) => ({ amount: round2(a.amount + p.amount), penalty: round2(a.penalty + p.penalty), interest: round2(a.interest + p.interest), balanceDue: round2(a.balanceDue + p.balanceDue) }),
    { amount: 0, penalty: 0, interest: 0, balanceDue: 0 }
  );
  return { periods, totals };
}

export async function loadObligationClient(clientId: string): Promise<(ObligationClient & { clientName: string }) | null> {
  const c = await queryOne<any>(`SELECT client_id, client_name, state, entity_type, date_of_formation FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!c) return null;
  return {
    clientId: c.client_id, clientName: c.client_name, state: String(c.state || "").trim().toUpperCase(), entityType: c.entity_type || null,
    dateOfFormation: c.date_of_formation ? isoOnly(c.date_of_formation) : null,
  };
}
