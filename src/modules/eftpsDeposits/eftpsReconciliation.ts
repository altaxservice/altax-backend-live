import type { DrakeFederalPaycheckDetail, DrakeTaxLiabilitySummary } from "../payrollImport/parsers";

/**
 * Pure computation for the EFTPS deposit workflow — kept out of the route file
 * since this is the part real federal tax dollars ride on, and is easy to test
 * in isolation this way.
 */

export interface EftpsEmployeeBreakdown {
  employeeName: string;
  federalIncomeTax: number;
  socialSecurity: number;
  medicare: number;
  subtotal: number;
}

export interface EftpsComputation {
  employees: EftpsEmployeeBreakdown[];
  federalIncomeTaxTotal: number;
  socialSecurityTotal: number;
  medicareTotal: number;
  totalAmount: number;
  /** Drake's own "941 Total" row, kept alongside for comparison — never silently substituted for the computed total. */
  drakeTotal941: number | null;
  /**
   * When Drake's own Tax Liability report for this exact month agrees with the paychecks to within
   * rounding, the totals above ARE Drake's figures (Drake rounds each tax on the month's total wages;
   * doubling each paycheck's withholding can land a cent or two away). This is the small difference
   * between the two, so the breakdown still adds up — null when nothing was adjusted.
   */
  roundingAdjustment: { federalIncomeTax: number; socialSecurity: number; medicare: number; total: number } | null;
  reconciliationStatus: "Matched" | "Mismatch";
  reconciliationDifference: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Sums each employee's actual withheld Federal Income Tax, plus their withheld
 * Social Security and Medicare doubled for the employer's matching share
 * (correct even across the annual SS wage cap — see parseDrakePayrollWagesDetail's
 * own comment: Drake already caps the withheld amount per paycheck, doubling
 * whatever it reports is always right, no separate cap logic needed here).
 */
export function computeEftpsBreakdown(
  paychecks: DrakeFederalPaycheckDetail[],
  taxLiability: DrakeTaxLiabilitySummary | null
): EftpsComputation {
  const byEmployee = new Map<string, EftpsEmployeeBreakdown>();
  for (const p of paychecks) {
    const row = byEmployee.get(p.employeeName) || {
      employeeName: p.employeeName,
      federalIncomeTax: 0,
      socialSecurity: 0,
      medicare: 0,
      subtotal: 0,
    };
    row.federalIncomeTax += p.federalWithheld || 0;
    row.socialSecurity += (p.socialSecurityWithheld || 0) * 2;
    row.medicare += (p.medicareWithheld || 0) * 2;
    byEmployee.set(p.employeeName, row);
  }

  const employees = Array.from(byEmployee.values()).map((row) => ({
    ...row,
    federalIncomeTax: round2(row.federalIncomeTax),
    socialSecurity: round2(row.socialSecurity),
    medicare: round2(row.medicare),
    subtotal: round2(row.federalIncomeTax + row.socialSecurity + row.medicare),
  }));

  let federalIncomeTaxTotal = round2(employees.reduce((s, e) => s + e.federalIncomeTax, 0));
  let socialSecurityTotal = round2(employees.reduce((s, e) => s + e.socialSecurity, 0));
  let medicareTotal = round2(employees.reduce((s, e) => s + e.medicare, 0));
  let totalAmount = round2(federalIncomeTaxTotal + socialSecurityTotal + medicareTotal);
  const paycheckTotal = totalAmount;

  const drakeTotal941 = taxLiability ? round2(taxLiability.total941) : null;
  // A few dollars of tolerance absorbs normal per-paycheck rounding noise between
  // Drake's own percentage-of-annual-wages calculation and the sum of actual
  // withheld cents across every paycheck — real, expected, and not a data error.
  // A larger gap means something is actually wrong (a missed paycheck, a bad
  // parse) and needs a human to look before this number is trusted.
  const TOLERANCE = 2.0;
  const reconciliationDifference = drakeTotal941 !== null ? round2(totalAmount - drakeTotal941) : null;
  const reconciliationStatus: "Matched" | "Mismatch" =
    reconciliationDifference === null || Math.abs(reconciliationDifference) <= TOLERANCE ? "Matched" : "Mismatch";

  // Matched, and Drake's three lines add up to its own 941 total: use Drake's figures so the amounts
  // typed into EFTPS equal the report (and the Form 941 that follows).
  let roundingAdjustment: EftpsComputation["roundingAdjustment"] = null;
  if (taxLiability && drakeTotal941 !== null && reconciliationStatus === "Matched") {
    const dFed = round2(taxLiability.federalIncomeTax), dSs = round2(taxLiability.socialSecurity), dMed = round2(taxLiability.medicare);
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;
    if (Math.abs(round2(dFed + dSs + dMed) - drakeTotal941) <= 0.03 && near(dFed, federalIncomeTaxTotal) && near(dSs, socialSecurityTotal) && near(dMed, medicareTotal)) {
      roundingAdjustment = {
        federalIncomeTax: round2(dFed - federalIncomeTaxTotal), socialSecurity: round2(dSs - socialSecurityTotal),
        medicare: round2(dMed - medicareTotal), total: round2(drakeTotal941 - paycheckTotal),
      };
      federalIncomeTaxTotal = dFed; socialSecurityTotal = dSs; medicareTotal = dMed; totalAmount = drakeTotal941;
      if (roundingAdjustment.total === 0 && roundingAdjustment.socialSecurity === 0 && roundingAdjustment.medicare === 0 && roundingAdjustment.federalIncomeTax === 0) roundingAdjustment = null;
    }
  }

  return {
    employees,
    federalIncomeTaxTotal,
    socialSecurityTotal,
    medicareTotal,
    totalAmount,
    drakeTotal941,
    roundingAdjustment,
    reconciliationStatus,
    reconciliationDifference: drakeTotal941 !== null ? round2(totalAmount - drakeTotal941) : null,
  };
}
