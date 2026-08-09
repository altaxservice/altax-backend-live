import { queryOne } from "../config/db";

/**
 * Maryland Form 202 Line 18 (timely discount) / Line 37 (late penalty +
 * interest) math — sourced directly from the Comptroller's own 2026 Form 202
 * instructions (COM RAD 098), not an estimate. Verified against a real
 * client return: $1,575.15 tax due -> $18.90 timely discount, matching the
 * filed form exactly.
 *
 * Line 18: if tax <= threshold, discount = tax * lowRate; if over
 * threshold, discount = tax * highRate + flatAdd; capped at a maximum;
 * only available if the return is filed AND PAID by its due date.
 * Line 37a: flat penalty rate on the tax due.
 * Line 37b: interest at a monthly rate, applied "per month or fraction of a
 * month" — even one day into a new month counts as a full month.
 *
 * Every number above (the discount's threshold/rates/flat-add/cap, the
 * penalty rate, and the interest rate) is stored in v3_tax_rates rather than
 * hardcoded, editable through the same Accounting -> Tax Rates screen used
 * for every other firm rate (SUTA, state withholding, etc.) — see
 * sql/008_md_late_interest_rate.sql and sql/009_md_discount_penalty_rates.sql
 * for the seeded rows and their rate_ids. wage_cap carries each discount
 * row's dollar figure (the $6,000 threshold on the low-tier row, the $18
 * flat add-on on the high-tier row, the $500 cap on its own row) — the same
 * column FUTA/SUTA/Social Security already use for their own caps, and the
 * Tax Rates screen already renders it as "Cap $X.XX", so this reads
 * correctly there without any UI changes. The constants below are only a
 * defensive fallback for the (should-never-happen) case a row is missing or
 * deactivated.
 */

const FALLBACK = {
  penaltyRate: 0.10,
  discountLowRate: 0.012,
  discountThreshold: 6000,
  discountHighRate: 0.009,
  discountFlatAdd: 18,
  discountMax: 500,
  interestMonthly: 0.009011,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Parses a "YYYY-MM-DD" string as UTC midnight, not local midnight — every
 * date built or compared in this file goes through this (or Date.UTC
 * directly) and every field read back off it uses the UTC getters
 * (getUTCFullYear/getUTCMonth/etc). `new Date(\`${iso}T00:00:00\`)` (no Z)
 * parses as LOCAL midnight instead, which only happens to produce the right
 * calendar date on hosts west of UTC (any negative offset, including US
 * timezones) — a host configured with a POSITIVE UTC offset would parse
 * local midnight as still being the previous day in UTC, silently shifting
 * every period boundary and due date back one calendar day once formatted
 * back out via toISOString(). Nothing in this repo sets TZ today, so Node
 * defaults to UTC and the bug has never actually fired — this closes the
 * gap so it can't, regardless of future deployment config.
 */
function parseIsoDateUTC(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

async function getMdRateRow(rateId: string): Promise<{ rate: number; wageCap: number | null } | null> {
  const row = await queryOne<any>(
    `SELECT rate, wage_cap FROM altax.v3_tax_rates WHERE rate_id = $1 AND active = true AND (client_id IS NULL OR client_id = '') LIMIT 1`,
    [rateId]
  );
  if (!row) return null;
  return { rate: Number(row.rate), wageCap: row.wage_cap != null ? Number(row.wage_cap) : null };
}

interface MdFilingParams {
  penaltyRate: number;
  discountLowRate: number;
  discountThreshold: number;
  discountHighRate: number;
  discountFlatAdd: number;
  discountMax: number;
  interestMonthly: number;
}

async function loadMdFilingParams(): Promise<MdFilingParams> {
  const [penalty, discountLow, discountHigh, discountCap, interest] = await Promise.all([
    getMdRateRow("MD-SUT-LATE-PENALTY"),
    getMdRateRow("MD-SUT-DISCOUNT-LOW"),
    getMdRateRow("MD-SUT-DISCOUNT-HIGH"),
    getMdRateRow("MD-SUT-DISCOUNT-CAP"),
    getMdRateRow("MD-SUT-INTEREST-MONTHLY"),
  ]);
  return {
    penaltyRate: penalty?.rate ?? FALLBACK.penaltyRate,
    discountLowRate: discountLow?.rate ?? FALLBACK.discountLowRate,
    discountThreshold: discountLow?.wageCap ?? FALLBACK.discountThreshold,
    discountHighRate: discountHigh?.rate ?? FALLBACK.discountHighRate,
    discountFlatAdd: discountHigh?.wageCap ?? FALLBACK.discountFlatAdd,
    discountMax: discountCap?.wageCap ?? FALLBACK.discountMax,
    interestMonthly: interest?.rate ?? FALLBACK.interestMonthly,
  };
}

function computeDiscount(taxDue: number, params: MdFilingParams): number {
  if (taxDue <= 0) return 0;
  const raw = taxDue <= params.discountThreshold
    ? taxDue * params.discountLowRate
    : taxDue * params.discountHighRate + params.discountFlatAdd;
  return Math.min(round2(raw), params.discountMax);
}

/**
 * "Per month or fraction of a month" past the due date: full calendar
 * months elapsed, plus 1 more if any time remains past that exact
 * N-month mark. Returns 0 if paid on or before the due date.
 */
function monthsLateInclusive(dueDate: Date, paidDate: Date): number {
  if (paidDate <= dueDate) return 0;
  let months = (paidDate.getUTCFullYear() - dueDate.getUTCFullYear()) * 12 + (paidDate.getUTCMonth() - dueDate.getUTCMonth());
  const monthMark = new Date(dueDate);
  monthMark.setUTCMonth(monthMark.getUTCMonth() + months);
  if (paidDate > monthMark) months += 1;
  return Math.max(months, 1);
}

export interface MdFilingResult {
  taxDue: number;
  onTime: boolean;
  discount: number;
  penalty: number;
  interest: number;
  interestRateMonthly: number;
  monthsLate: number;
  balanceDue: number;
}

/**
 * The statutory MD Form 202 due date for a given reporting period — the 20th
 * of the month AFTER periodEnd, unlike the Calculator/Sales Input quick-entry
 * default (nextMdDueDate in the frontend) which anchors to today because
 * those tools have no fixed period. A report already has a fixed period, so
 * its due date should be derived from that period, not from whenever the
 * report happens to be generated.
 */
export function mdDueDateForPeriod(periodEndIso: string): string {
  const end = parseIsoDateUTC(periodEndIso);
  const due = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 20));
  return due.toISOString().slice(0, 10);
}

/**
 * An internal "file by" target, ahead of the real statutory due date — the
 * firm's own buffer for mail/processing time, NOT a substitute for it. The
 * actual MD due date (mdDueDateForPeriod) is always the 20th and is what
 * drives on-time/penalty/interest math and every overdue flag; this is
 * purely an earlier reminder date shown alongside it. 2 days early normally,
 * 3 when the statutory due date itself falls on a Saturday or Sunday (more
 * buffer needed since bank/mail processing doesn't run those days either).
 */
export function mdFilingTargetDate(dueDateIso: string): string {
  const due = parseIsoDateUTC(dueDateIso);
  const dayOfWeek = due.getUTCDay(); // 0 = Sunday, 6 = Saturday
  const bufferDays = dayOfWeek === 0 || dayOfWeek === 6 ? 3 : 2;
  const target = new Date(due);
  target.setUTCDate(target.getUTCDate() - bufferDays);
  return target.toISOString().slice(0, 10);
}

/**
 * The timely discount legally requires the return to be BOTH filed and paid
 * by the due date (see this file's top doc comment, Line 18) — so the LATER
 * of filedDateStr/paidDateStr is what actually governs on-time status and
 * the penalty/interest math. Being on time on one date but late on the
 * other still loses the discount.
 */
export async function computeMdFiling(taxDue: number, dueDateStr: string, filedDateStr: string, paidDateStr: string): Promise<MdFilingResult> {
  const dueDate = parseIsoDateUTC(dueDateStr);
  const filedDate = parseIsoDateUTC(filedDateStr);
  const paidDate = parseIsoDateUTC(paidDateStr);
  const effectiveDate = filedDate > paidDate ? filedDate : paidDate;
  const params = await loadMdFilingParams();

  if (effectiveDate <= dueDate) {
    const discount = computeDiscount(taxDue, params);
    return {
      taxDue, onTime: true, discount, penalty: 0, interest: 0, interestRateMonthly: params.interestMonthly, monthsLate: 0,
      balanceDue: round2(taxDue - discount),
    };
  }

  const monthsLate = monthsLateInclusive(dueDate, effectiveDate);
  const penalty = round2(taxDue * params.penaltyRate);
  const interest = round2(taxDue * params.interestMonthly * monthsLate);
  return {
    taxDue, onTime: false, discount: 0, penalty, interest, interestRateMonthly: params.interestMonthly, monthsLate,
    balanceDue: round2(taxDue + penalty + interest),
  };
}

export type MdFilingFrequency = "Monthly" | "Quarterly" | "Semiannual" | "Annually";

export interface MdFilingPeriod {
  start: string;
  end: string;
  dueDate: string;
}

/**
 * Splits [from, to] into the client's real MD filing periods (calendar
 * month/quarter/half/year, per their stored sales_tax_frequency) instead of
 * treating the whole requested range as one return — a report spanning
 * several months otherwise blends every period into a single wrong due date
 * (see mdDueDateForPeriod's own doc comment: it's meant for ONE period).
 * Each period's start/end are always that period's TRUE calendar
 * boundaries, never clamped to the requested [from, to] — a period's real
 * tax liability is everything filed for that whole period, not just the
 * slice of it the caller happened to ask for. (An earlier version clamped
 * to the requested range for tax-summing, which silently understated —
 * or entirely hid — the liability whenever the report window didn't
 * happen to cover a full period exactly, which is the common case: the
 * default report view is "1st of this month to today," never aligned to
 * a quarter/half-year/year boundary.) Callers must fetch sales data over
 * each period's true [start, end], not just the requested range — see
 * computeMdFilingForReport in reports.routes.ts, which widens its sales
 * query to the full span of periods touched by the request.
 *
 * Periods are calendar-aligned (Jan-Mar/Apr-Jun/... for Quarterly,
 * Jan-Jun/Jul-Dec for Semiannual), not relative to the client's fiscal year
 * or to whatever date the report happens to start on — this matches how
 * the Comptroller assigns filing periods.
 *
 * When frequency is missing or not one of the four recognized values
 * (frontend/src/utils/clientOptions.ts's FREQ_OPTIONS also allows "N/A",
 * and the DB column has no CHECK constraint so legacy/typo values are
 * possible), this deliberately does NOT guess a period length — guessing
 * wrong changes the computed due date and therefore the penalty/interest
 * shown to a client. It falls back to the pre-split behavior (whole range
 * as one period) and reports frequencyUsed: null so the caller can flag it.
 */
export function splitIntoMdFilingPeriods(
  from: string,
  to: string,
  frequency: string | null | undefined
): { periods: MdFilingPeriod[]; frequencyUsed: MdFilingFrequency | null } {
  const fromDate = parseIsoDateUTC(from);
  const toDate = parseIsoDateUTC(to);
  const normalized = String(frequency || "").trim().toLowerCase();
  let freq: MdFilingFrequency | null = null;
  if (normalized === "monthly") freq = "Monthly";
  else if (normalized === "quarterly") freq = "Quarterly";
  else if (normalized === "semiannual" || normalized === "semi-annual" || normalized === "semiannually") freq = "Semiannual";
  else if (normalized === "annually" || normalized === "annual") freq = "Annually";

  if (!freq) {
    return { periods: [{ start: from, end: to, dueDate: mdDueDateForPeriod(to) }], frequencyUsed: null };
  }

  const monthsPerPeriod = freq === "Monthly" ? 1 : freq === "Quarterly" ? 3 : freq === "Semiannual" ? 6 : 12;
  const periods: MdFilingPeriod[] = [];
  const periodStartMonth = Math.floor(fromDate.getUTCMonth() / monthsPerPeriod) * monthsPerPeriod;
  let cursor = new Date(Date.UTC(fromDate.getUTCFullYear(), periodStartMonth, 1));
  while (cursor <= toDate) {
    const periodEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + monthsPerPeriod, 0));
    periods.push({
      start: cursor.toISOString().slice(0, 10),
      end: periodEnd.toISOString().slice(0, 10),
      dueDate: mdDueDateForPeriod(periodEnd.toISOString().slice(0, 10)),
    });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + monthsPerPeriod, 1));
  }
  return { periods, frequencyUsed: freq };
}

export interface MdFilingPeriodResult extends MdFilingResult {
  start: string;
  end: string;
  dueDate: string;
  /** Internal "file by" reminder target — see mdFilingTargetDate's doc comment. Not the statutory deadline. */
  targetFilingDate: string;
  /** The filing date actually used for this period's on-time/penalty math (either the caller's default or a recorded real filing). */
  filedDate: string;
  /** The payment date actually used for this period's on-time/penalty math. */
  paidDate: string;
  /** Set when staff has explicitly marked this period filed/paid (v3_md_filing_payments) — the filed date that was used, overriding filedDateStr. Null means this result used the caller's (usually "today") date, not a real recorded filing. */
  markedFiledDate: string | null;
  /** Set when staff has explicitly marked this period filed/paid (v3_md_filing_payments) — the paid date that was used, overriding paidDateStr. Null means this result used the caller's (usually "today") date, not a real recorded filing. */
  markedPaidDate: string | null;
}

export interface MdFilingBreakdown {
  periods: MdFilingPeriodResult[];
  totals: { taxDue: number; discount: number; penalty: number; interest: number; balanceDue: number };
  frequencyUsed: MdFilingFrequency | null;
}

/**
 * pg returns a DATE column as a native JS Date (UTC midnight), not a
 * string — String(dateObject) gives "Mon Jun 30 2026 00:00:00 GMT+...",
 * which never matches a "YYYY-MM-DD" period boundary. Route callers pass
 * raw rows straight through (see loadSalesTaxForPeriod's saleDate field),
 * so this has to handle both a Date and an already-string value.
 */
function isoDateOnly(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/**
 * Line 18/37 for EVERY real filing period inside [from, to], not just one
 * blended figure for the whole range — this is what actually happens when
 * a client catches up several overdue (or on-time) returns with a single
 * payment: each period keeps its own due date, and only one paid date is
 * needed (the date of that one catch-up payment) since that's the real
 * business event, not a separate payment per period. Periods with no tax
 * due (no sales recorded) are skipped rather than shown as a zero row.
 */
export async function computeMdFilingBreakdown(
  sales: { saleDate: unknown; totalTaxDue: number }[],
  from: string,
  to: string,
  frequency: string | null | undefined,
  filedDateStr: string,
  paidDateStr: string,
  recordedFilings?: Map<string, { filedDate: string; paidDate: string }>
): Promise<MdFilingBreakdown> {
  const { periods, frequencyUsed } = splitIntoMdFilingPeriods(from, to, frequency);
  const results: MdFilingPeriodResult[] = [];
  for (const period of periods) {
    const taxDue = round2(
      sales
        .filter((s) => {
          const d = isoDateOnly(s.saleDate);
          return d !== null && d >= period.start && d <= period.end;
        })
        .reduce((sum, s) => sum + Number(s.totalTaxDue || 0), 0)
    );
    if (taxDue <= 0) continue;
    // A period staff has explicitly marked filed uses those REAL filed/paid dates
    // instead of filedDateStr/paidDateStr (normally "today") — so its on-time/late
    // status and penalty/interest freeze at the actual filing event rather than
    // recomputing against whatever day this happens to be rendered.
    const recorded = recordedFilings?.get(period.end) ?? null;
    const filedDate = recorded?.filedDate ?? filedDateStr;
    const paidDate = recorded?.paidDate ?? paidDateStr;
    const result = await computeMdFiling(taxDue, period.dueDate, filedDate, paidDate);
    results.push({
      ...result, start: period.start, end: period.end, dueDate: period.dueDate,
      targetFilingDate: mdFilingTargetDate(period.dueDate), filedDate, paidDate,
      markedFiledDate: recorded?.filedDate ?? null, markedPaidDate: recorded?.paidDate ?? null,
    });
  }
  const totals = results.reduce(
    (acc, r) => ({
      taxDue: round2(acc.taxDue + r.taxDue),
      discount: round2(acc.discount + r.discount),
      penalty: round2(acc.penalty + r.penalty),
      interest: round2(acc.interest + r.interest),
      balanceDue: round2(acc.balanceDue + r.balanceDue),
    }),
    { taxDue: 0, discount: 0, penalty: 0, interest: 0, balanceDue: 0 }
  );
  return { periods: results, totals, frequencyUsed };
}
