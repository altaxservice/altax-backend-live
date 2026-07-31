import { queryOne } from "../config/db";

/**
 * Maryland Form 202 Line 18 (timely discount) / Line 37 (late penalty +
 * interest) math — sourced directly from the Comptroller's own 2026 Form 202
 * instructions (COM RAD 098), not an estimate. Verified against a real
 * client return: $1,575.15 tax due -> $18.90 timely discount, matching the
 * filed form exactly.
 *
 * Line 18: if tax <= $6,000, discount = tax * 1.2%; if over $6,000,
 * discount = tax * 0.9% + $18; capped at $500; only available if the return
 * is filed AND PAID by its due date (not just filed).
 *
 * Line 37a: flat 10% penalty on the tax due.
 * Line 37b: interest at a monthly rate the Comptroller republishes every
 * January (currently 0.9011%/month for Jan 1 - Dec 31, 2026), applied "per
 * month or fraction of a month" — even one day into a new month counts as a
 * full month of interest. Stored in v3_tax_rates (rate_id
 * MD-SUT-INTEREST-MONTHLY) so the firm can update it each year without a
 * code deploy, the same pattern already used for SUTA/state-withholding
 * rates.
 */

export const MD_LATE_PENALTY_RATE = 0.10;
export const MD_TIMELY_DISCOUNT_MAX = 500;
/** Only used if the DB row is somehow missing — the real value lives in v3_tax_rates. */
const MD_INTEREST_FALLBACK_MONTHLY = 0.009011;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeMdTimelyDiscount(taxDue: number): number {
  if (taxDue <= 0) return 0;
  const raw = taxDue <= 6000 ? taxDue * 0.012 : taxDue * 0.009 + 18;
  return Math.min(round2(raw), MD_TIMELY_DISCOUNT_MAX);
}

async function getMdMonthlyInterestRate(): Promise<number> {
  const row = await queryOne<any>(
    `SELECT rate FROM altax.v3_tax_rates WHERE rate_id = 'MD-SUT-INTEREST-MONTHLY' AND active = true AND (client_id IS NULL OR client_id = '') LIMIT 1`
  );
  return row ? Number(row.rate) || MD_INTEREST_FALLBACK_MONTHLY : MD_INTEREST_FALLBACK_MONTHLY;
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

export async function computeMdFiling(taxDue: number, dueDateStr: string, paidDateStr: string): Promise<MdFilingResult> {
  const dueDate = new Date(`${dueDateStr}T00:00:00`);
  const paidDate = new Date(`${paidDateStr}T00:00:00`);
  const interestRateMonthly = await getMdMonthlyInterestRate();

  if (paidDate <= dueDate) {
    const discount = computeMdTimelyDiscount(taxDue);
    return {
      taxDue, onTime: true, discount, penalty: 0, interest: 0, interestRateMonthly, monthsLate: 0,
      balanceDue: round2(taxDue - discount),
    };
  }

  const monthsLate = monthsLateInclusive(dueDate, paidDate);
  const penalty = round2(taxDue * MD_LATE_PENALTY_RATE);
  const interest = round2(taxDue * interestRateMonthly * monthsLate);
  return {
    taxDue, onTime: false, discount: 0, penalty, interest, interestRateMonthly, monthsLate,
    balanceDue: round2(taxDue + penalty + interest),
  };
}
