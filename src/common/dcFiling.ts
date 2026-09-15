import { queryOne } from "../config/db";
import { getDashboardAlertSettings } from "../modules/clients/dashboardAlerts";

/**
 * DC FR-800 sales and use tax penalty/interest math — sourced from DC OTR's
 * own sales-and-use-tax FAQ page and the FR-800M return's own printed
 * instructions ("H. PENALTY AND INTEREST CHARGES"), 2026-09-14. Deliberately
 * simpler than mdFiling.ts's MD Form 202 math: DC has NO timely-filing
 * discount at all — the FR-800 form itself says "Credit for timely-filed
 * and fully-paid return is no longer allowed due to the Tax Clarity Act of
 * 2001" — so there is nothing to compute when a period is on time beyond
 * "no penalty, no interest."
 *
 * Late penalty: 5% per month or fraction of a month on the unpaid tax,
 * capped at 25% of the tax due (unlike MD's flat one-time 10%, DC's penalty
 * genuinely compounds by how many months late the filing is).
 * Late interest: 1.5% per month or fraction of a month on the unpaid tax,
 * uncapped, "without regard to any extension."
 * Due date: 20th of the month following the reporting period — same rule
 * MD happens to use, coincidentally.
 *
 * Every rate is stored in v3_tax_rates (state='DC'), editable through the
 * same Accounting -> Tax Rates screen used for every other firm rate — see
 * sql/153_dc_filing_rates.sql for the seeded rows. The constants below are
 * only a defensive fallback for the (should-never-happen) case a row is
 * missing or deactivated.
 */

const FALLBACK = {
  penaltyRateMonthly: 0.05,
  penaltyCapRate: 0.25,
  interestMonthly: 0.015,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** See mdFiling.ts's identical helper for why UTC parsing matters here — same reasoning applies verbatim. */
function parseIsoDateUTC(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

async function getDcRateRow(rateId: string): Promise<{ rate: number } | null> {
  const row = await queryOne<any>(
    `SELECT rate FROM altax.v3_tax_rates WHERE rate_id = $1 AND active = true AND (client_id IS NULL OR client_id = '') LIMIT 1`,
    [rateId]
  );
  if (!row) return null;
  return { rate: Number(row.rate) };
}

interface DcFilingParams {
  penaltyRateMonthly: number;
  penaltyCapRate: number;
  interestMonthly: number;
}

async function loadDcFilingParams(): Promise<DcFilingParams> {
  const [penalty, penaltyCap, interest] = await Promise.all([
    getDcRateRow("DC-SUT-LATE-PENALTY-MONTHLY"),
    getDcRateRow("DC-SUT-LATE-PENALTY-CAP"),
    getDcRateRow("DC-SUT-INTEREST-MONTHLY"),
  ]);
  return {
    penaltyRateMonthly: penalty?.rate ?? FALLBACK.penaltyRateMonthly,
    penaltyCapRate: penaltyCap?.rate ?? FALLBACK.penaltyCapRate,
    interestMonthly: interest?.rate ?? FALLBACK.interestMonthly,
  };
}

/** See mdFiling.ts's identical helper (monthsLateInclusive) for the full "per month or fraction of a month" reasoning and the ACC-015 correctness note — duplicated verbatim here rather than shared, matching this codebase's convention of each filing type owning its own self-contained module. */
function monthsLateInclusive(dueDate: Date, paidDate: Date): number {
  if (paidDate <= dueDate) return 0;
  let months = (paidDate.getUTCFullYear() - dueDate.getUTCFullYear()) * 12 + (paidDate.getUTCMonth() - dueDate.getUTCMonth());
  const dueDay = dueDate.getUTCDate();
  const daysInPaidMonth = new Date(Date.UTC(paidDate.getUTCFullYear(), paidDate.getUTCMonth() + 1, 0)).getUTCDate();
  const effectiveDueDay = Math.min(dueDay, daysInPaidMonth);
  if (paidDate.getUTCDate() > effectiveDueDay) months += 1;
  return Math.max(months, 1);
}

export interface DcFilingResult {
  taxDue: number;
  onTime: boolean;
  /** Always 0 — DC has no timely-filing discount. Kept in the shape so the frontend can reuse the same row-rendering pattern as MD's periods. */
  discount: number;
  penalty: number;
  penaltyRateMonthly: number;
  interest: number;
  interestRateMonthly: number;
  monthsLate: number;
  balanceDue: number;
}

/** DC FR-800's statutory due date for a given reporting period — the 20th of the month AFTER periodEnd. */
export function dcDueDateForPeriod(periodEndIso: string): string {
  const end = parseIsoDateUTC(periodEndIso);
  const due = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 20));
  return due.toISOString().slice(0, 10);
}

/** See mdFiling.ts's mdFilingTargetDate for the full reasoning — same internal "file by" buffer, duplicated for DC's own due date. */
export function dcFilingTargetDate(dueDateIso: string): string {
  const due = parseIsoDateUTC(dueDateIso);
  const dayOfWeek = due.getUTCDay();
  const bufferDays = dayOfWeek === 0 || dayOfWeek === 6 ? 3 : 2;
  const target = new Date(due);
  target.setUTCDate(target.getUTCDate() - bufferDays);
  return target.toISOString().slice(0, 10);
}

/**
 * Unlike MD (where the discount requires filed AND paid by the due date),
 * DC's penalty/interest are both driven off the LATER of filed/paid too —
 * there's no separate discount to lose, but a return filed on time with
 * payment made late (or vice versa) is still not fully "on time" for
 * penalty/interest purposes, since DC Code assesses penalty/interest on the
 * unpaid TAX, not the return itself.
 */
export async function computeDcFiling(taxDue: number, dueDateStr: string, filedDateStr: string, paidDateStr: string): Promise<DcFilingResult> {
  const dueDate = parseIsoDateUTC(dueDateStr);
  const filedDate = parseIsoDateUTC(filedDateStr);
  const paidDate = parseIsoDateUTC(paidDateStr);
  const effectiveDate = filedDate > paidDate ? filedDate : paidDate;
  const params = await loadDcFilingParams();

  if (effectiveDate <= dueDate) {
    return {
      taxDue, onTime: true, discount: 0, penalty: 0, penaltyRateMonthly: params.penaltyRateMonthly,
      interest: 0, interestRateMonthly: params.interestMonthly, monthsLate: 0, balanceDue: round2(taxDue),
    };
  }

  const monthsLate = monthsLateInclusive(dueDate, effectiveDate);
  const penaltyCap = round2(taxDue * params.penaltyCapRate);
  const penalty = Math.min(round2(taxDue * params.penaltyRateMonthly * monthsLate), penaltyCap);
  const interest = round2(taxDue * params.interestMonthly * monthsLate);
  return {
    taxDue, onTime: false, discount: 0, penalty, penaltyRateMonthly: params.penaltyRateMonthly,
    interest, interestRateMonthly: params.interestMonthly, monthsLate, balanceDue: round2(taxDue + penalty + interest),
  };
}

export type DcFilingFrequency = "Monthly" | "Quarterly" | "Semiannual" | "Annually";

export interface DcFilingPeriod {
  start: string;
  end: string;
  dueDate: string;
}

/** Identical calendar-alignment logic to mdFiling.ts's splitIntoMdFilingPeriods — see that function's doc comment for the full reasoning (calendar-aligned periods, no guessing on an unrecognized/missing frequency). Duplicated rather than shared/parameterized, matching this codebase's per-filing-type module convention. */
export function splitIntoDcFilingPeriods(
  from: string,
  to: string,
  frequency: string | null | undefined
): { periods: DcFilingPeriod[]; frequencyUsed: DcFilingFrequency | null } {
  const fromDate = parseIsoDateUTC(from);
  const toDate = parseIsoDateUTC(to);
  const normalized = String(frequency || "").trim().toLowerCase();
  let freq: DcFilingFrequency | null = null;
  if (normalized === "monthly") freq = "Monthly";
  else if (normalized === "quarterly") freq = "Quarterly";
  else if (normalized === "semiannual" || normalized === "semi-annual" || normalized === "semiannually") freq = "Semiannual";
  else if (normalized === "annually" || normalized === "annual") freq = "Annually";

  if (!freq) {
    return { periods: [{ start: from, end: to, dueDate: dcDueDateForPeriod(to) }], frequencyUsed: null };
  }

  const monthsPerPeriod = freq === "Monthly" ? 1 : freq === "Quarterly" ? 3 : freq === "Semiannual" ? 6 : 12;
  const periods: DcFilingPeriod[] = [];
  const periodStartMonth = Math.floor(fromDate.getUTCMonth() / monthsPerPeriod) * monthsPerPeriod;
  let cursor = new Date(Date.UTC(fromDate.getUTCFullYear(), periodStartMonth, 1));
  while (cursor <= toDate) {
    const periodEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + monthsPerPeriod, 0));
    periods.push({
      start: cursor.toISOString().slice(0, 10),
      end: periodEnd.toISOString().slice(0, 10),
      dueDate: dcDueDateForPeriod(periodEnd.toISOString().slice(0, 10)),
    });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + monthsPerPeriod, 1));
  }
  return { periods, frequencyUsed: freq };
}

/** Same shape as mdFiling.ts's SalesTaxFrequencyHistoryRow — deliberately reused via the same v3_client_sales_tax_frequency_history table, since that table isn't state-specific (see reports.routes.ts's loadSalesTaxFrequencyHistory, shared by both MD and DC callers). */
export interface SalesTaxFrequencyHistoryRow {
  frequency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** Identical history-aware segmentation logic to mdFiling.ts's splitIntoMdFilingPeriodsForClient — see that function's extensive doc comment for the full reasoning (leading-gap fallback, cursorFloor mid-period-change handling). Duplicated for DC's own due-date/period rules. */
export function splitIntoDcFilingPeriodsForClient(
  from: string,
  to: string,
  history: SalesTaxFrequencyHistoryRow[] | null | undefined,
  fallbackFrequency: string | null | undefined
): { periods: DcFilingPeriod[]; frequencyUsed: DcFilingFrequency | null } {
  if (!history || history.length === 0) {
    return splitIntoDcFilingPeriods(from, to, fallbackFrequency);
  }
  const sorted = [...history].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const periods: DcFilingPeriod[] = [];
  let frequencyUsed: DcFilingFrequency | null = null;
  let cursorFloor: string | null = null;
  if (sorted[0].effectiveFrom > from) {
    const gapTo = new Date(`${sorted[0].effectiveFrom}T00:00:00Z`);
    gapTo.setUTCDate(gapTo.getUTCDate() - 1);
    const gapToStr = gapTo.toISOString().slice(0, 10);
    if (gapToStr >= from) {
      const gapSeg = splitIntoDcFilingPeriods(from, gapToStr < to ? gapToStr : to, fallbackFrequency);
      periods.push(...gapSeg.periods);
      if (gapSeg.frequencyUsed) frequencyUsed = gapSeg.frequencyUsed;
      if (gapSeg.periods.length > 0) {
        const lastEnd = gapSeg.periods[gapSeg.periods.length - 1].end;
        const nextDay = new Date(`${lastEnd}T00:00:00Z`);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        cursorFloor = nextDay.toISOString().slice(0, 10);
      }
    }
  }
  for (const row of sorted) {
    // Captured BEFORE this iteration's own segFrom clamp overwrites it —
    // see mdFiling.ts's splitIntoMdFilingPeriodsForClient for the full
    // reasoning (two related off-by-ones, both fixed the same way here).
    const priorCursorFloor = cursorFloor;
    let segFrom = row.effectiveFrom > from ? row.effectiveFrom : from;
    if (cursorFloor && cursorFloor > segFrom) segFrom = cursorFloor;
    const segTo = (row.effectiveTo && row.effectiveTo < to) ? row.effectiveTo : to;
    if (segFrom > segTo) continue;
    const seg = splitIntoDcFilingPeriods(segFrom, segTo, row.frequency);
    // Fix 1 (effectiveTo) DROPS the offending period since the next row's
    // own segment correctly regenerates that time. Fix 2 (priorCursorFloor)
    // instead CLIPS the period's start forward — there is no later segment
    // to regenerate dropped time here, so dropping would trade a duplicate
    // for a silent invisible gap instead. See mdFiling.ts's identical fix
    // for the full reasoning and the real incident that surfaced it.
    let segPeriods = row.effectiveTo ? seg.periods.filter((p) => p.start < row.effectiveTo!) : seg.periods;
    if (priorCursorFloor) {
      segPeriods = segPeriods.map((p) => (p.start < priorCursorFloor! ? { ...p, start: priorCursorFloor! } : p));
    }
    periods.push(...segPeriods);
    if (seg.frequencyUsed) frequencyUsed = seg.frequencyUsed;
    if (segPeriods.length > 0) {
      const lastEnd = segPeriods[segPeriods.length - 1].end;
      const nextDay = new Date(`${lastEnd}T00:00:00Z`);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      cursorFloor = nextDay.toISOString().slice(0, 10);
    }
  }
  return { periods, frequencyUsed };
}

export interface DcFilingPeriodResult extends DcFilingResult {
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

export interface DcFilingBreakdown {
  periods: DcFilingPeriodResult[];
  totals: { taxDue: number; discount: number; penalty: number; interest: number; balanceDue: number };
  frequencyUsed: DcFilingFrequency | null;
}

export type DcFilingPeriodStatus = "onTime" | "late" | "filedPendingPayment" | "missing" | "notYetDue";

/** Identical logic to mdFiling.ts's classifyMdFilingPeriod — see that function's doc comment for why `onTime` alone is never trustworthy outside the markedFiledDate branch. */
export function classifyDcFilingPeriod(
  p: Pick<DcFilingPeriodResult, "markedFiledDate" | "markedPaidDate" | "dueDate" | "onTime">,
  asOfStr: string
): DcFilingPeriodStatus {
  if (p.markedFiledDate !== null && p.markedPaidDate === null) return "filedPendingPayment";
  if (p.markedFiledDate !== null) return p.onTime ? "onTime" : "late";
  if (p.dueDate < asOfStr) return "missing";
  return "notYetDue";
}

/** Identical logic to mdFiling.ts's summarizeMdFilingOnTime. */
export function summarizeDcFilingOnTime(
  periods: Pick<DcFilingPeriodResult, "markedFiledDate" | "markedPaidDate" | "dueDate" | "onTime">[],
  asOfStr: string
): boolean | null {
  const statuses = periods.map((p) => classifyDcFilingPeriod(p, asOfStr));
  if (statuses.some((s) => s === "late" || s === "missing")) return false;
  if (statuses.some((s) => s === "onTime")) return true;
  return null;
}

function isoDateOnly(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/**
 * DC FR-800 penalty/interest for EVERY real filing period inside [from, to]
 * — see mdFiling.ts's computeMdFilingBreakdown doc comment for the full
 * reasoning on why periods aren't blended together and why a $0 period is
 * skipped unless it's currently actionable. Identical logic here, calling
 * computeDcFiling instead of computeMdFiling.
 */
export async function computeDcFilingBreakdown(
  sales: { saleDate: unknown; totalTaxDue: number; paymentDate?: unknown }[],
  from: string,
  to: string,
  frequency: string | null | undefined,
  filedDateStr: string,
  paidDateStr: string,
  recordedFilings?: Map<string, { filedDate: string; paidDate: string | null; acknowledgedAt?: string | null; sentAt?: string | null }>,
  periodsOverride?: { periods: DcFilingPeriod[]; frequencyUsed: DcFilingFrequency | null },
  options?: { includeZeroTaxPeriods?: boolean; excludedPeriodEnds?: string[] }
): Promise<DcFilingBreakdown> {
  const { periods, frequencyUsed } = periodsOverride ?? splitIntoDcFilingPeriods(from, to, frequency);
  const { filingDeadlineDaysThreshold } = await getDashboardAlertSettings();
  const todayStr = new Date().toISOString().slice(0, 10);
  const results: DcFilingPeriodResult[] = [];
  for (const period of periods) {
    const salesInPeriod = sales.filter((s) => {
      const d = isoDateOnly(s.saleDate);
      return d !== null && d >= period.start && d <= period.end;
    });
    const taxDue = round2(salesInPeriod.reduce((sum, s) => sum + Number(s.totalTaxDue || 0), 0));
    if (taxDue <= 0 && options?.excludedPeriodEnds?.includes(period.end)) continue;
    const recorded = recordedFilings?.get(period.end) ?? null;
    if (!options?.includeZeroTaxPeriods && taxDue <= 0 && periods.length > 1) {
      if (recorded) continue;
      const periodAlreadyEnded = period.end <= todayStr;
      if (!periodAlreadyEnded) {
        const daysUntilDue = Math.round((new Date(`${period.dueDate}T00:00:00Z`).getTime() - new Date(`${todayStr}T00:00:00Z`).getTime()) / 86400000);
        if (daysUntilDue > filingDeadlineDaysThreshold) continue;
      }
    }
    const salesPaymentDate = salesInPeriod
      .map((s) => isoDateOnly(s.paymentDate))
      .filter((d): d is string => d !== null)
      .sort()
      .pop() ?? null;
    const filedDate = recorded?.filedDate ?? salesPaymentDate ?? filedDateStr;
    if (recorded && recorded.paidDate === null) {
      results.push({
        taxDue, onTime: true, discount: 0, penalty: 0, penaltyRateMonthly: 0, interest: 0, interestRateMonthly: 0, monthsLate: 0, balanceDue: taxDue,
        start: period.start, end: period.end, dueDate: period.dueDate,
        targetFilingDate: dcFilingTargetDate(period.dueDate), filedDate, paidDate: filedDate,
        markedFiledDate: recorded.filedDate, markedPaidDate: null, acknowledgedAt: recorded.acknowledgedAt ?? null,
        sentAt: recorded.sentAt ?? null,
      });
      continue;
    }
    const paidDate = recorded?.paidDate ?? salesPaymentDate ?? paidDateStr;
    const result = await computeDcFiling(taxDue, period.dueDate, filedDate, paidDate);
    results.push({
      ...result, start: period.start, end: period.end, dueDate: period.dueDate,
      targetFilingDate: dcFilingTargetDate(period.dueDate), filedDate, paidDate,
      markedFiledDate: recorded?.filedDate ?? null, markedPaidDate: recorded?.paidDate ?? null,
      acknowledgedAt: recorded?.acknowledgedAt ?? null, sentAt: recorded?.sentAt ?? null,
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
