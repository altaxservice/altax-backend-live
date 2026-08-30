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

  const federalIncomeTaxTotal = round2(employees.reduce((s, e) => s + e.federalIncomeTax, 0));
  const socialSecurityTotal = round2(employees.reduce((s, e) => s + e.socialSecurity, 0));
  const medicareTotal = round2(employees.reduce((s, e) => s + e.medicare, 0));
  const totalAmount = round2(federalIncomeTaxTotal + socialSecurityTotal + medicareTotal);

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

  return {
    employees,
    federalIncomeTaxTotal,
    socialSecurityTotal,
    medicareTotal,
    totalAmount,
    drakeTotal941,
    reconciliationStatus,
    reconciliationDifference,
  };
}
