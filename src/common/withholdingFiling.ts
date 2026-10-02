import { query, queryOne } from "../config/db";

/**
 * Employer state income tax WITHHOLDING filing math — the withholding
 * counterpart of mdFiling.ts / dcFiling.ts (sales tax). Given a client's state
 * and withholding frequency it derives the filing periods, each period's
 * statutory due date, how much was withheld in it (from recorded paychecks),
 * and — for the states where the late-charge rules are built — the penalty and
 * interest if it's filed/paid late.
 *
 * Every date and rate below is from the state's own published instructions,
 * researched 2026-10-02 (sources in the per-state comments). Where a state's
 * penalty/interest isn't built (anything but MD and DC), the period still
 * tracks due date, filed/paid, client confirmation and status — it just shows
 * no penalty or interest rather than a number that might be wrong.
 */

export type WithholdingFrequency = "Monthly" | "Quarterly" | "Semiannual" | "Annually";
export const WITHHOLDING_STATES = ["MD", "DC", "VA", "PA", "DE"] as const;
export type WithholdingState = (typeof WITHHOLDING_STATES)[number];

export function asWithholdingState(state: unknown): WithholdingState | null {
  const code = String(state || "").trim().toUpperCase();
  return (WITHHOLDING_STATES as readonly string[]).includes(code) ? (code as WithholdingState) : null;
}

export function normalizeWithholdingFrequency(value: unknown): WithholdingFrequency | null {
  const v = String(value || "").trim().toLowerCase();
  if (v === "monthly") return "Monthly";
  if (v === "quarterly") return "Quarterly";
  if (v === "semiannual" || v === "semi-annual" || v === "semiannually") return "Semiannual";
  if (v === "annually" || v === "annual") return "Annually";
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseIsoDateUTC(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function lastDayOfMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** A due date landing on a weekend moves to Monday (holidays aren't modeled). */
function nextBusinessDay(isoDate: string): string {
  const d = parseIsoDateUTC(isoDate);
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (dow === 0) d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}

interface StateWithholdingRules {
  agency: string;
  formName: Partial<Record<WithholdingFrequency, string>>;
  /** Which frequencies the state actually has — anything else can't be tracked for that state. */
  frequencies: WithholdingFrequency[];
  /** Day-of-month payment is due, the month after the period (monthly) — 0 = last day of the month. */
  monthlyDueDay: number;
  /** Quarterly: day-of-month, month after the quarter (0 = last day). */
  quarterlyDueDay: number;
  /** Annual filers: payment due day in January after the year. */
  annualDueDay?: number;
  /** Which late-charge rule set applies ("md"/"dc", loaded from the editable rate rows), or null when the state's penalty/interest isn't built yet. */
  lateCharges: "md" | "dc" | null;
}

interface LateChargeRules {
  /** Percent of the unpaid tax per month or fraction of a month, capped at capRate of the tax. */
  penaltyRatePerMonth: number;
  penaltyCapRate: number;
  /** Minimum penalty in dollars once any penalty applies. */
  penaltyMinimum?: number;
  /** "flat" = a one-time penalty of penaltyRatePerMonth regardless of months late (cap ignored). */
  penaltyMode: "monthly" | "flat";
  interest:
    | { mode: "compound-daily"; annualRate: number }
    | { mode: "simple-monthly"; monthlyRate: number };
}

/**
 * Sources (2026-10-02, official documents):
 *  - Maryland — Comptroller's 2026 Employer Withholding Guide + Withholding Tax
 *    Facts: monthly (more than $700 in a quarter) due the 15th of the next month;
 *    quarterly (under $700/quarter) due Apr/Jul/Oct/Jan 15; annual (under $250/yr)
 *    due January — the guide says "last day of January" in its text but Jan 15 in
 *    its due-date table, so the earlier Jan 15 is used; weekend -> next business
 *    day. Late: a 10% penalty (Tax-General 13-701; Comptroller Business Tip 10:
 *    "10 percent penalty after 30 days, plus interest"; the guide allows up to
 *    25% for withholding, which isn't modeled) and interest of 0.9011% per month
 *    or fraction (10.8133%/yr for 2026, Tax-General 13-604) — read from the same
 *    editable MD-SUT-INTEREST-MONTHLY rate row the sales tax engine uses, so the
 *    yearly update happens in one place. Accelerated (MW506M, 3 business days
 *    after pay date) isn't a calendar period and isn't tracked here.
 *  - DC — OTR 2025 FR-900Q instructions: deposits by the 20th of the following
 *    month (or of the month after the quarter); FR-900Q return month-end after
 *    the quarter; annual filers deposit Jan 20. "A penalty of 5% per month if you
 *    fail to file a return or pay any tax due on time ... may not exceed ... 25%";
 *    "Interest of 10% per year, compounded daily". Payments are tracked (the
 *    return itself is filed quarterly on MyTax.DC.gov).
 *  - Virginia (VA-5: monthly the 25th, quarterly month-end), Pennsylvania
 *    (REV-415: monthly the 15th with December on Jan 31, quarterly month-end),
 *    Delaware (W-1 monthly the 15th, W-1Q quarterly month-end): dates only; their
 *    penalty/interest rules aren't built.
 */
const MD_PENALTY_RATE = 0.10;
const MD_FALLBACK_INTEREST_MONTHLY = 0.009011;

const RULES: Record<WithholdingState, StateWithholdingRules> = {
  MD: {
    agency: "Comptroller of Maryland",
    formName: { Monthly: "MW506", Quarterly: "MW506", Semiannual: "MW506", Annually: "MW506" },
    frequencies: ["Monthly", "Quarterly", "Semiannual", "Annually"],
    monthlyDueDay: 15, quarterlyDueDay: 15, annualDueDay: 15,
    lateCharges: "md",
  },
  DC: {
    agency: "DC Office of Tax and Revenue",
    formName: { Monthly: "FR-900Q (monthly deposits)", Quarterly: "FR-900Q", Annually: "FR-900A" },
    frequencies: ["Monthly", "Quarterly", "Annually"],
    monthlyDueDay: 20, quarterlyDueDay: 20, annualDueDay: 20,
    lateCharges: "dc",
  },
  VA: {
    agency: "Virginia Tax",
    formName: { Monthly: "VA-5", Quarterly: "VA-5" },
    frequencies: ["Monthly", "Quarterly"],
    monthlyDueDay: 25, quarterlyDueDay: 0,
    lateCharges: null,
  },
  PA: {
    agency: "PA Department of Revenue",
    formName: { Monthly: "PA withholding payment", Quarterly: "PA quarterly return" },
    frequencies: ["Monthly", "Quarterly"],
    monthlyDueDay: 15, quarterlyDueDay: 0,
    lateCharges: null,
  },
  DE: {
    agency: "Delaware Division of Revenue",
    formName: { Monthly: "W-1", Quarterly: "W-1Q" },
    frequencies: ["Monthly", "Quarterly"],
    monthlyDueDay: 15, quarterlyDueDay: 0,
    lateCharges: null,
  },
};

async function rateRow(rateId: string): Promise<number | null> {
  const row = await queryOne<any>(
    `SELECT rate FROM altax.v3_tax_rates WHERE rate_id = $1 AND active = true AND (client_id IS NULL OR client_id = '') LIMIT 1`, [rateId]
  );
  return row ? Number(row.rate) : null;
}

/** The late-charge rules for a state, with the yearly-changing rates read from the editable Tax Rates rows. */
export async function loadLateCharges(state: WithholdingState): Promise<LateChargeRules | null> {
  const kind = RULES[state].lateCharges;
  if (kind === "md") {
    return {
      penaltyRatePerMonth: MD_PENALTY_RATE, penaltyCapRate: MD_PENALTY_RATE, penaltyMode: "flat",
      interest: { mode: "simple-monthly", monthlyRate: (await rateRow("MD-SUT-INTEREST-MONTHLY")) ?? MD_FALLBACK_INTEREST_MONTHLY },
    };
  }
  if (kind === "dc") {
    const [penalty, cap, annual] = await Promise.all([rateRow("DC-SUT-LATE-PENALTY-MONTHLY"), rateRow("DC-SUT-LATE-PENALTY-CAP"), rateRow("DC-SUT-INTEREST-ANNUAL")]);
    return {
      penaltyRatePerMonth: penalty ?? 0.05, penaltyCapRate: cap ?? 0.25, penaltyMode: "monthly",
      interest: { mode: "compound-daily", annualRate: annual ?? 0.10 },
    };
  }
  return null;
}

export function withholdingRulesFor(state: WithholdingState) {
  const r = RULES[state];
  return { agency: r.agency, frequencies: r.frequencies, formName: r.formName, hasLateCharges: r.lateCharges !== null };
}

export interface WithholdingPeriodSpan { start: string; end: string }

/** Calendar-aligned periods for a frequency overlapping [from, to]. */
export function splitIntoWithholdingPeriods(from: string, to: string, frequency: WithholdingFrequency): WithholdingPeriodSpan[] {
  const monthsPer = frequency === "Monthly" ? 1 : frequency === "Quarterly" ? 3 : frequency === "Semiannual" ? 6 : 12;
  const fromDate = parseIsoDateUTC(from);
  const toDate = parseIsoDateUTC(to);
  const startMonth = Math.floor(fromDate.getUTCMonth() / monthsPer) * monthsPer;
  let cursor = new Date(Date.UTC(fromDate.getUTCFullYear(), startMonth, 1));
  const out: WithholdingPeriodSpan[] = [];
  while (cursor <= toDate) {
    const end = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + monthsPer, 0));
    out.push({ start: iso(cursor), end: iso(end) });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + monthsPer, 1));
  }
  return out;
}

/** The statutory payment due date for the period ending `periodEnd`. */
export function withholdingDueDate(state: WithholdingState, frequency: WithholdingFrequency, periodEnd: string): string {
  const rules = RULES[state];
  const end = parseIsoDateUTC(periodEnd);
  const dueYear = end.getUTCMonth() === 11 ? end.getUTCFullYear() + 1 : end.getUTCFullYear();
  const dueMonth0 = (end.getUTCMonth() + 1) % 12;
  const pick = (day: number) => (day === 0 ? lastDayOfMonth(dueYear, dueMonth0) : Math.min(day, lastDayOfMonth(dueYear, dueMonth0)));
  let day: number;
  if (frequency === "Monthly") {
    // Pennsylvania's December payment is due Jan 31 (REV-415), not the 15th.
    day = state === "PA" && dueMonth0 === 0 ? 0 : rules.monthlyDueDay;
  } else if (frequency === "Quarterly") {
    day = rules.quarterlyDueDay;
  } else {
    day = rules.annualDueDay ?? rules.monthlyDueDay;
  }
  const due = new Date(Date.UTC(dueYear, dueMonth0, pick(day)));
  return nextBusinessDay(iso(due));
}

/** Same internal "file a couple days early" buffer the sales tax tables use. */
export function withholdingTargetFilingDate(dueDateIso: string): string {
  const due = parseIsoDateUTC(dueDateIso);
  const dow = due.getUTCDay();
  const buffer = dow === 0 || dow === 6 ? 3 : 2;
  due.setUTCDate(due.getUTCDate() - buffer);
  return iso(due);
}

function monthsLateInclusive(dueDate: Date, paidDate: Date): number {
  if (paidDate <= dueDate) return 0;
  let months = (paidDate.getUTCFullYear() - dueDate.getUTCFullYear()) * 12 + (paidDate.getUTCMonth() - dueDate.getUTCMonth());
  const daysInPaidMonth = lastDayOfMonth(paidDate.getUTCFullYear(), paidDate.getUTCMonth());
  if (paidDate.getUTCDate() > Math.min(dueDate.getUTCDate(), daysInPaidMonth)) months += 1;
  return Math.max(months, 1);
}

export interface WithholdingFilingResult {
  taxDue: number;
  onTime: boolean;
  penalty: number;
  interest: number;
  monthsLate: number;
  balanceDue: number;
  /** False when the state's late-charge rules aren't built: penalty/interest are 0 and shouldn't be read as "none owed". */
  latePenaltyComputed: boolean;
}

/** Penalty/interest driven off the LATER of filed/paid, same as the sales tax engines. Late charges are passed in so a breakdown loads the rate rows once. */
function computeWithLateCharges(
  late: LateChargeRules | null, taxDue: number, dueDateStr: string, filedDateStr: string, paidDateStr: string
): WithholdingFilingResult {
  const dueDate = parseIsoDateUTC(dueDateStr);
  const filed = parseIsoDateUTC(filedDateStr);
  const paid = parseIsoDateUTC(paidDateStr);
  const effective = filed > paid ? filed : paid;

  if (effective <= dueDate) {
    return { taxDue, onTime: true, penalty: 0, interest: 0, monthsLate: 0, balanceDue: round2(taxDue), latePenaltyComputed: late !== null };
  }
  const monthsLate = monthsLateInclusive(dueDate, effective);
  if (!late) {
    return { taxDue, onTime: false, penalty: 0, interest: 0, monthsLate, balanceDue: round2(taxDue), latePenaltyComputed: false };
  }
  let penalty = late.penaltyMode === "flat"
    ? round2(taxDue * late.penaltyRatePerMonth)
    : Math.min(round2(taxDue * late.penaltyRatePerMonth * monthsLate), round2(taxDue * late.penaltyCapRate));
  if (late.penaltyMinimum !== undefined && taxDue > 0) penalty = Math.max(penalty, late.penaltyMinimum);
  const daysLate = Math.max(0, Math.round((effective.getTime() - dueDate.getTime()) / 86400000));
  const interest = late.interest.mode === "compound-daily"
    ? round2(taxDue * (Math.pow(1 + late.interest.annualRate / 365, daysLate) - 1))
    : round2(taxDue * late.interest.monthlyRate * monthsLate);
  return { taxDue, onTime: false, penalty, interest, monthsLate, balanceDue: round2(taxDue + penalty + interest), latePenaltyComputed: true };
}


export async function computeWithholdingFiling(
  state: WithholdingState, taxDue: number, dueDateStr: string, filedDateStr: string, paidDateStr: string
): Promise<WithholdingFilingResult> {
  return computeWithLateCharges(await loadLateCharges(state), taxDue, dueDateStr, filedDateStr, paidDateStr);
}

export interface WithholdingPeriodResult extends WithholdingFilingResult {
  start: string;
  end: string;
  dueDate: string;
  targetFilingDate: string;
  filedDate: string;
  paidDate: string;
  markedFiledDate: string | null;
  markedPaidDate: string | null;
  acknowledgedAt: string | null;
  sentAt: string | null;
}

export interface WithholdingBreakdown {
  state: WithholdingState;
  frequency: WithholdingFrequency;
  periods: WithholdingPeriodResult[];
  totals: { taxDue: number; penalty: number; interest: number; balanceDue: number };
}

function isoDateOnly(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/**
 * How much state income tax was withheld per period. Counts only paychecks
 * whose payroll state is the client's own — an employee who lives in another
 * state has THEIR state's tax withheld, which isn't this return's to report
 * (same employee-state-over-client-state precedence the paycheck calculator
 * uses).
 */
export async function loadWithheldByPeriod(clientId: string, clientState: string, periods: WithholdingPeriodSpan[]): Promise<number[]> {
  if (periods.length === 0) return [];
  const rows = await query<{ pay_date: unknown; state_tax: string }>(
    `SELECT p.pay_date, p.state_tax
       FROM altax.v3_paychecks p
       LEFT JOIN altax.v3_employees e ON e.employee_id = p.employee_id
      WHERE p.client_id = $1 AND lower(p.status) <> 'void'
        AND p.pay_date::date >= $2::date AND p.pay_date::date <= $3::date
        AND upper(COALESCE(NULLIF(btrim(e.state), ''), $4)) = $4`,
    [clientId, periods[0].start, periods[periods.length - 1].end, clientState.toUpperCase()]
  );
  return periods.map((p) =>
    round2(rows.reduce((sum, r) => {
      const d = isoDateOnly(r.pay_date);
      return d !== null && d >= p.start && d <= p.end ? sum + (Number(r.state_tax) || 0) : sum;
    }, 0))
  );
}

export interface RecordedWithholdingFiling {
  filedDate: string; paidDate: string | null; taxDue: number | null;
  acknowledgedAt: string | null; sentAt: string | null;
}

export async function computeWithholdingBreakdown(
  clientId: string, state: WithholdingState, frequency: WithholdingFrequency,
  from: string, to: string, defaultFiledDate: string, defaultPaidDate: string
): Promise<WithholdingBreakdown> {
  const spans = splitIntoWithholdingPeriods(from, to, frequency);
  const late = await loadLateCharges(state);

  const [recordedRows, excludedRows, withheld] = await Promise.all([
    spans.length
      ? query<any>(
          `SELECT period_end::date::text AS period_end, filed_date::date::text AS filed_date, paid_date::date::text AS paid_date,
                  tax_due, acknowledged_at, sent_at
             FROM altax.v3_withholding_filings WHERE client_id = $1 AND period_end >= $2::date AND period_end <= $3::date`,
          [clientId, spans[0].start, spans[spans.length - 1].end]
        )
      : Promise.resolve([] as any[]),
    spans.length
      ? query<{ period_end: string }>(
          `SELECT period_end::date::text AS period_end FROM altax.v3_withholding_period_exclusions
            WHERE client_id = $1 AND period_end >= $2::date AND period_end <= $3::date`,
          [clientId, spans[0].start, spans[spans.length - 1].end]
        )
      : Promise.resolve([] as { period_end: string }[]),
    loadWithheldByPeriod(clientId, state, spans),
  ]);
  const recorded = new Map<string, RecordedWithholdingFiling>(
    recordedRows.map((r: any) => [r.period_end, {
      filedDate: r.filed_date, paidDate: r.paid_date, taxDue: r.tax_due === null ? null : Number(r.tax_due),
      acknowledgedAt: r.acknowledged_at ? new Date(r.acknowledged_at).toISOString() : null,
      sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null,
    }])
  );
  const excluded = new Set(excludedRows.map((r) => r.period_end));

  const periods: WithholdingPeriodResult[] = [];
  spans.forEach((span, i) => {
    if (excluded.has(span.end) && !recorded.has(span.end)) return;
    const rec = recorded.get(span.end) ?? null;
    const dueDate = withholdingDueDate(state, frequency, span.end);
    // A filed period reports what was actually filed, not today's live recompute.
    const taxDue = rec && rec.taxDue !== null ? rec.taxDue : withheld[i];
    const filedDate = rec?.filedDate ?? defaultFiledDate;
    const paidDate = rec?.paidDate ?? defaultPaidDate;

    let result: WithholdingFilingResult;
    if (rec && rec.paidDate === null) {
      result = { taxDue, onTime: true, penalty: 0, interest: 0, monthsLate: 0, balanceDue: taxDue, latePenaltyComputed: late !== null };
    } else {
      result = computeWithLateCharges(late, taxDue, dueDate, filedDate, paidDate);
    }
    periods.push({
      ...result, start: span.start, end: span.end, dueDate, targetFilingDate: withholdingTargetFilingDate(dueDate),
      filedDate, paidDate, markedFiledDate: rec?.filedDate ?? null, markedPaidDate: rec?.paidDate ?? null,
      acknowledgedAt: rec?.acknowledgedAt ?? null, sentAt: rec?.sentAt ?? null,
    });
  });

  const totals = periods.reduce(
    (acc, p) => ({
      taxDue: round2(acc.taxDue + p.taxDue), penalty: round2(acc.penalty + p.penalty),
      interest: round2(acc.interest + p.interest), balanceDue: round2(acc.balanceDue + p.balanceDue),
    }),
    { taxDue: 0, penalty: 0, interest: 0, balanceDue: 0 }
  );
  return { state, frequency, periods, totals };
}

/**
 * Every At a Glance deadline date (complianceCalendar.ts) that recording this
 * period as filed satisfies. Usually just the payment due date; DC's quarterly
 * and annual filers also have a separate return deadline (month-end / Jan 31)
 * that the same filing covers.
 */
export function calendarDatesSatisfied(state: WithholdingState, frequency: WithholdingFrequency, periodEnd: string): string[] {
  const due = withholdingDueDate(state, frequency, periodEnd);
  const dates = [due];
  if (state === "DC" && (frequency === "Quarterly" || frequency === "Annually")) {
    const end = parseIsoDateUTC(periodEnd);
    const dueYear = end.getUTCMonth() === 11 ? end.getUTCFullYear() + 1 : end.getUTCFullYear();
    const dueMonth0 = (end.getUTCMonth() + 1) % 12;
    const returnDate = frequency === "Annually"
      ? new Date(Date.UTC(dueYear, 0, 31))
      : new Date(Date.UTC(dueYear, dueMonth0, lastDayOfMonth(dueYear, dueMonth0)));
    const adjusted = nextBusinessDay(iso(returnDate));
    if (adjusted !== due) dates.push(adjusted);
  }
  return dates;
}
