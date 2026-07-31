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
  let months = (paidDate.getFullYear() - dueDate.getFullYear()) * 12 + (paidDate.getMonth() - dueDate.getMonth());
  const monthMark = new Date(dueDate);
  monthMark.setMonth(monthMark.getMonth() + months);
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
  const end = new Date(`${periodEndIso}T00:00:00`);
  const due = new Date(end.getFullYear(), end.getMonth() + 1, 20);
  return due.toISOString().slice(0, 10);
}

export async function computeMdFiling(taxDue: number, dueDateStr: string, paidDateStr: string): Promise<MdFilingResult> {
  const dueDate = new Date(`${dueDateStr}T00:00:00`);
  const paidDate = new Date(`${paidDateStr}T00:00:00`);
  const params = await loadMdFilingParams();

  if (paidDate <= dueDate) {
    const discount = computeDiscount(taxDue, params);
    return {
      taxDue, onTime: true, discount, penalty: 0, interest: 0, interestRateMonthly: params.interestMonthly, monthsLate: 0,
      balanceDue: round2(taxDue - discount),
    };
  }

  const monthsLate = monthsLateInclusive(dueDate, paidDate);
  const penalty = round2(taxDue * params.penaltyRate);
  const interest = round2(taxDue * params.interestMonthly * monthsLate);
  return {
    taxDue, onTime: false, discount: 0, penalty, interest, interestRateMonthly: params.interestMonthly, monthsLate,
    balanceDue: round2(taxDue + penalty + interest),
  };
}
