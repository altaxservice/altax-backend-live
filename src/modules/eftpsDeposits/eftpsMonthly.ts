import { query, queryOne } from "../../config/db";
import { computeEftpsBreakdown } from "./eftpsReconciliation";
import type { DrakeFederalPaycheckDetail, DrakeTaxLiabilitySummary } from "../payrollImport/parsers";

/**
 * Month-by-month EFTPS figures computed from the imported Drake reports — used by
 * the Review/File routes and by the EFTPS period table (obligationSchedules.ts).
 */

/** v3_eftps_deposits.due_date comes back from `SELECT *` as a JS Date object, not a string — String(date) yields a locale format ("Tue Sep 15 2026 ..."), not ISO, so it must go through toISOString() before use in a reminder's source_record_id. */
export function isoDate(v: unknown): string {
  return new Date(v as string).toISOString().slice(0, 10);
}

/** v3_eftps_deposits has no stored label column — period_start/period_end are always the source of truth, formatted fresh wherever a human-readable label is needed (email, PDF). Accepts either a plain "YYYY-MM-DD" string (request-body values) or a JS Date object (a `SELECT *` row) — String(date) would shift UTC midnight back a day in local time, so a Date always goes through isoDate() first. */
export function fmtPeriodLabel(start: unknown, end: unknown): string {
  const fmt = (v: unknown) => {
    const raw = v instanceof Date ? isoDate(v) : String(v).slice(0, 10);
    const d = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

export async function computeForPeriod(clientId: string, periodStart: string, periodEnd: string) {
  const rows = await query<any>(
    `SELECT employee_name, pay_date::text AS pay_date, check_number, federal_withheld, social_security_withheld, medicare_withheld, social_security_wages, medicare_wages
       FROM altax.v3_eftps_paycheck_import
      WHERE client_id = $1 AND pay_date >= $2 AND pay_date <= $3`,
    [clientId, periodStart, periodEnd]
  );
  const paychecks: DrakeFederalPaycheckDetail[] = rows.map((r: any) => ({
    employeeName: r.employee_name, payDate: r.pay_date, checkNumber: r.check_number || undefined,
    federalWithheld: Number(r.federal_withheld) || 0,
    socialSecurityWithheld: Number(r.social_security_withheld) || 0,
    medicareWithheld: Number(r.medicare_withheld) || 0,
    socialSecurityWageBase: r.social_security_wages === null || r.social_security_wages === undefined ? undefined : Number(r.social_security_wages),
    medicareWageBase: r.medicare_wages === null || r.medicare_wages === undefined ? undefined : Number(r.medicare_wages),
  }));

  const snapshot = await queryOne<any>(
    `SELECT federal_income_tax, social_security, medicare, total_941 FROM altax.v3_eftps_tax_liability_import
      WHERE client_id = $1 AND range_start = $2 AND range_end = $3
      ORDER BY imported_at DESC LIMIT 1`,
    [clientId, periodStart, periodEnd]
  );
  const taxLiability: DrakeTaxLiabilitySummary | null = snapshot
    ? { federalIncomeTax: Number(snapshot.federal_income_tax) || 0, socialSecurity: Number(snapshot.social_security) || 0, medicare: Number(snapshot.medicare) || 0, total941: Number(snapshot.total_941) || 0, futa: 0, total940: 0, stateTotal: 0, localTotal: 0, grandTotal: 0 }
    : null;

  return { computation: computeEftpsBreakdown(paychecks, taxLiability), hasReconciliationReference: Boolean(snapshot), paycheckCount: paychecks.length };
}

type MonthBucket = { monthKey: string; periodStart: string; periodEnd: string };

/**
 * Splits [periodStart, periodEnd] into one bucket per calendar month touched —
 * clipped to the requested range only at the first/last bucket, interior
 * months are always the full calendar month (EFTPS deposits are always filed
 * per full calendar month in practice). All-UTC arithmetic, same convention
 * isoDate()/fmtPeriodLabel() above already require — local-time Date math
 * would shift month boundaries by a day depending on server TZ. Capped at 36
 * iterations, same guard reports.routes.ts's computeFirmSummary uses for the
 * same reason (a runaway-range backstop, not an expected real case).
 */
function splitIntoMonthBuckets(periodStart: string, periodEnd: string): MonthBucket[] {
  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(`${periodEnd}T00:00:00Z`);
  const buckets: MonthBucket[] = [];
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return buckets;

  let cy = start.getUTCFullYear(), cm = start.getUTCMonth();
  const ey = end.getUTCFullYear(), em = end.getUTCMonth();
  let guard = 0;
  while ((cy < ey || (cy === ey && cm <= em)) && guard < 36) {
    const monthFirst = new Date(Date.UTC(cy, cm, 1));
    const monthLast = new Date(Date.UTC(cy, cm + 1, 0));
    const bucketStart = monthFirst > start ? monthFirst : start;
    const bucketEnd = monthLast < end ? monthLast : end;
    buckets.push({
      monthKey: `${cy}-${String(cm + 1).padStart(2, "0")}`,
      periodStart: bucketStart.toISOString().slice(0, 10),
      periodEnd: bucketEnd.toISOString().slice(0, 10),
    });
    cm++;
    if (cm > 11) { cm = 0; cy++; }
    guard++;
  }
  return buckets;
}

/**
 * Computes one review row per calendar month touched by [periodStart,
 * periodEnd] in 3 batched queries (not N+1 — up to 36 months would otherwise
 * mean 36 sequential round trips). computeEftpsBreakdown itself is unchanged,
 * just invoked once per bucket instead of once for the whole range.
 */
export async function computeMonthlyReview(clientId: string, periodStart: string, periodEnd: string) {
  const buckets = splitIntoMonthBuckets(periodStart, periodEnd);
  if (!buckets.length) return [];
  const rangeStart = buckets[0].periodStart, rangeEnd = buckets[buckets.length - 1].periodEnd;

  const paycheckRows = await query<any>(
    `SELECT employee_name, pay_date::text AS pay_date, check_number, federal_withheld, social_security_withheld, medicare_withheld, social_security_wages, medicare_wages
       FROM altax.v3_eftps_paycheck_import
      WHERE client_id = $1 AND pay_date >= $2 AND pay_date <= $3`,
    [clientId, rangeStart, rangeEnd]
  );
  const paychecksByMonth = new Map<string, DrakeFederalPaycheckDetail[]>();
  for (const r of paycheckRows) {
    const key = String(r.pay_date).slice(0, 7); // pay_date is already bounded to [rangeStart, rangeEnd] by the query, so every row lands in exactly one bucket
    const list = paychecksByMonth.get(key) || [];
    list.push({
      employeeName: r.employee_name, payDate: r.pay_date, checkNumber: r.check_number || undefined,
      federalWithheld: Number(r.federal_withheld) || 0,
      socialSecurityWithheld: Number(r.social_security_withheld) || 0,
      medicareWithheld: Number(r.medicare_withheld) || 0,
      socialSecurityWageBase: r.social_security_wages === null || r.social_security_wages === undefined ? undefined : Number(r.social_security_wages),
      medicareWageBase: r.medicare_wages === null || r.medicare_wages === undefined ? undefined : Number(r.medicare_wages),
    });
    paychecksByMonth.set(key, list);
  }

  const snapshotRows = await query<any>(
    `SELECT range_start::text AS range_start, range_end::text AS range_end, federal_income_tax, social_security, medicare, total_941
       FROM altax.v3_eftps_tax_liability_import
      WHERE client_id = $1 AND range_start >= $2 AND range_end <= $3
      ORDER BY imported_at DESC`,
    [clientId, rangeStart, rangeEnd]
  );
  const snapshotByPeriod = new Map<string, any>();
  for (const s of snapshotRows) {
    const key = `${s.range_start}|${s.range_end}`;
    if (!snapshotByPeriod.has(key)) snapshotByPeriod.set(key, s); // ORDER BY imported_at DESC above means first-seen is most recent
  }

  const existingRows = await query<any>(
    `SELECT deposit_id, period_start::text AS period_start, period_end::text AS period_end,
            status, filing_date::text AS filing_date, due_date::text AS due_date,
            payment_date::text AS payment_date, total_amount, reconciliation_status, acknowledged_at
       FROM altax.v3_eftps_deposits
      WHERE client_id = $1 AND period_start >= $2 AND period_end <= $3`,
    [clientId, rangeStart, rangeEnd]
  );
  const existingByPeriod = new Map(existingRows.map((r: any) => [`${r.period_start}|${r.period_end}`, r]));

  return buckets.map((b) => {
    const paychecks = paychecksByMonth.get(b.monthKey) || [];
    const snapshot = snapshotByPeriod.get(`${b.periodStart}|${b.periodEnd}`);
    const taxLiability: DrakeTaxLiabilitySummary | null = snapshot
      ? { federalIncomeTax: Number(snapshot.federal_income_tax) || 0, socialSecurity: Number(snapshot.social_security) || 0, medicare: Number(snapshot.medicare) || 0, total941: Number(snapshot.total_941) || 0, futa: 0, total940: 0, stateTotal: 0, localTotal: 0, grandTotal: 0 }
      : null;
    return {
      monthKey: b.monthKey, periodStart: b.periodStart, periodEnd: b.periodEnd,
      label: fmtPeriodLabel(b.periodStart, b.periodEnd),
      paycheckCount: paychecks.length,
      computation: paychecks.length ? computeEftpsBreakdown(paychecks, taxLiability) : null,
      hasReconciliationReference: Boolean(snapshot),
      existingDeposit: existingByPeriod.get(`${b.periodStart}|${b.periodEnd}`) || null,
    };
  });
}

