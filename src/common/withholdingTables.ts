/**
 * Real bracket-based federal and Maryland payroll withholding — replaces the flat-rate
 * estimate (a single percentage like 2.5116% applied to every dollar) that this app used
 * previously. Source data transcribed directly from the 2026 IRS Publication 15-T
 * ("Percentage Method Tables for Automated Payroll Systems," STANDARD Withholding Rate
 * Schedules, page 12) and the Maryland Comptroller's Central Payroll Bureau memo "2026
 * Maryland State and Local Income Tax Withholding Information" (Feb 4, 2026) plus the
 * "2026 Maryland Employer Withholding Guide" (standard deduction / exemption table, p.10).
 *
 * Both engines use the same shape of math: annualize the per-period taxable wages, walk
 * a bracket table to get annual tax, divide back down by the number of pay periods. This
 * is exactly IRS Worksheet 1A's method, and it's provably equivalent to Maryland's own
 * pre-divided per-period withholding tables (verified against the guide's own Delaware-
 * reciprocal example table: its weekly $2,885 bracket boundary is the annual $150,000
 * boundary divided by 52, rounded up).
 *
 * Scope deliberately excludes what this app's employee data model doesn't capture: W-4
 * Steps 3/4(a)/4(b)/4(c) adjustments (federal) and anything beyond a flat MW507 exemption
 * count (Maryland). Missing/unrecognized inputs fall back to the same conservative
 * defaults the IRS itself prescribes for a missing W-4 (withhold as Single, no
 * adjustments) or that Maryland's Central Payroll Bureau prescribes for missing address
 * data (tax at the maximum local rate). These are estimates for calculatePaycheck's
 * default — the existing manual-override field (enter a real number from an actual
 * payroll processor) is untouched and always wins when set.
 */

export type PayFrequency =
  | "Weekly" | "Bi-Weekly" | "Semi-Monthly" | "Monthly" | "Quarterly" | "Semi-Annually" | "Annually" | "Daily";

export const PAY_FREQUENCIES: PayFrequency[] = [
  "Weekly", "Bi-Weekly", "Semi-Monthly", "Monthly", "Quarterly", "Semi-Annually", "Annually", "Daily",
];

// IRS Publication 15-T, Table 3 — periods per year. Maryland's own tables use the same set.
const PAY_PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  "Weekly": 52, "Bi-Weekly": 26, "Semi-Monthly": 24, "Monthly": 12,
  "Quarterly": 4, "Semi-Annually": 2, "Annually": 1, "Daily": 260,
};

function periodsPerYear(payFrequency: string | null | undefined): number {
  const key = PAY_FREQUENCIES.find((f) => f.toLowerCase() === String(payFrequency || "").trim().toLowerCase());
  // Biweekly is the most common payroll cadence for small employers — a reasonable
  // fallback for an incomplete profile; the manual-override field is always available
  // for an exact figure regardless of this default.
  return key ? PAY_PERIODS_PER_YEAR[key] : PAY_PERIODS_PER_YEAR["Bi-Weekly"];
}

interface Bracket {
  atLeast: number;
  baseTax: number;
  rate: number;
}

// 2026 IRS STANDARD Withholding Rate Schedules (Pub 15-T, p.12) — used when Form W-4 is
// 2019-or-earlier, or 2020+ with Step 2 checkbox unchecked (the common case, and the only
// case this app's data model distinguishes).
const FEDERAL_BRACKETS_MFJ: Bracket[] = [
  { atLeast: 0, baseTax: 0, rate: 0 },
  { atLeast: 19300, baseTax: 0, rate: 0.10 },
  { atLeast: 44100, baseTax: 2480, rate: 0.12 },
  { atLeast: 120100, baseTax: 11600, rate: 0.22 },
  { atLeast: 230700, baseTax: 35932, rate: 0.24 },
  { atLeast: 422850, baseTax: 82048, rate: 0.32 },
  { atLeast: 531750, baseTax: 116896, rate: 0.35 },
  { atLeast: 788000, baseTax: 206583.50, rate: 0.37 },
];

const FEDERAL_BRACKETS_SINGLE: Bracket[] = [
  { atLeast: 0, baseTax: 0, rate: 0 },
  { atLeast: 7500, baseTax: 0, rate: 0.10 },
  { atLeast: 19900, baseTax: 1240, rate: 0.12 },
  { atLeast: 57900, baseTax: 5800, rate: 0.22 },
  { atLeast: 113200, baseTax: 17966, rate: 0.24 },
  { atLeast: 209275, baseTax: 41024, rate: 0.32 },
  { atLeast: 263725, baseTax: 58448, rate: 0.35 },
  { atLeast: 648100, baseTax: 192979.25, rate: 0.37 },
];

const FEDERAL_BRACKETS_HOH: Bracket[] = [
  { atLeast: 0, baseTax: 0, rate: 0 },
  { atLeast: 15550, baseTax: 0, rate: 0.10 },
  { atLeast: 33250, baseTax: 1770, rate: 0.12 },
  { atLeast: 83000, baseTax: 7740, rate: 0.22 },
  { atLeast: 121250, baseTax: 16155, rate: 0.24 },
  { atLeast: 217300, baseTax: 39207, rate: 0.32 },
  { atLeast: 271750, baseTax: 56631, rate: 0.35 },
  { atLeast: 656150, baseTax: 191171, rate: 0.37 },
];

export type FederalFilingStatus = "Single" | "Married Filing Jointly" | "Married Filing Separately" | "Head of Household";
export const FEDERAL_FILING_STATUSES: FederalFilingStatus[] = [
  "Single", "Married Filing Jointly", "Married Filing Separately", "Head of Household",
];

function federalBracketsFor(filingStatus: string | null | undefined): Bracket[] {
  const status = String(filingStatus || "").trim().toLowerCase();
  if (status === "married filing jointly") return FEDERAL_BRACKETS_MFJ;
  if (status === "head of household") return FEDERAL_BRACKETS_HOH;
  // Single, Married Filing Separately, and "no W-4 on file" all use the Single/MFS
  // schedule — this is also the IRS-mandated default when filing status is unknown.
  return FEDERAL_BRACKETS_SINGLE;
}

function applyBrackets(annualTaxableIncome: number, brackets: Bracket[]): number {
  if (annualTaxableIncome <= 0) return 0;
  let bracket = brackets[0];
  for (const b of brackets) {
    if (annualTaxableIncome >= b.atLeast) bracket = b;
    else break;
  }
  return bracket.baseTax + (annualTaxableIncome - bracket.atLeast) * bracket.rate;
}

/**
 * Federal income tax withholding for one paycheck, IRS Worksheet 1A method (annualize,
 * apply the STANDARD bracket schedule, divide back down). `periodTaxableWages` should
 * already have pre-tax deductions (retirement/health/HSA) subtracted — the same
 * `federalTaxableWages` figure this app already computes for FICA/FUTA purposes.
 */
export function calculateFederalWithholding(
  periodTaxableWages: number,
  payFrequency: string | null | undefined,
  filingStatus: string | null | undefined
): number {
  if (periodTaxableWages <= 0) return 0;
  const periods = periodsPerYear(payFrequency);
  const annualWages = periodTaxableWages * periods;
  const annualTax = applyBrackets(annualWages, federalBracketsFor(filingStatus));
  return annualTax / periods;
}

// ---- Maryland ----

// 2026 Maryland state income tax brackets, cumulative form — derived from the marginal
// rate table in the Comptroller's "2026 Maryland State and Local Income Tax Withholding
// Information" memo (Attachment: state rate chart, p.1). These are the same graduated
// brackets used on the actual Form 502 return.
const MD_STATE_BRACKETS_SINGLE: Bracket[] = [
  { atLeast: 0, baseTax: 0, rate: 0.02 },
  { atLeast: 1000, baseTax: 20, rate: 0.03 },
  { atLeast: 2000, baseTax: 50, rate: 0.04 },
  { atLeast: 3000, baseTax: 90, rate: 0.0475 },
  { atLeast: 100000, baseTax: 4697.50, rate: 0.05 },
  { atLeast: 125000, baseTax: 5947.50, rate: 0.0525 },
  { atLeast: 150000, baseTax: 7260, rate: 0.055 },
  { atLeast: 250000, baseTax: 12760, rate: 0.0575 },
  { atLeast: 500000, baseTax: 27135, rate: 0.0625 },
  { atLeast: 1000000, baseTax: 58385, rate: 0.065 },
];

const MD_STATE_BRACKETS_MARRIED: Bracket[] = [
  { atLeast: 0, baseTax: 0, rate: 0.02 },
  { atLeast: 1000, baseTax: 20, rate: 0.03 },
  { atLeast: 2000, baseTax: 50, rate: 0.04 },
  { atLeast: 3000, baseTax: 90, rate: 0.0475 },
  { atLeast: 150000, baseTax: 7072.50, rate: 0.05 },
  { atLeast: 175000, baseTax: 8322.50, rate: 0.0525 },
  { atLeast: 225000, baseTax: 10947.50, rate: 0.055 },
  { atLeast: 300000, baseTax: 15072.50, rate: 0.0575 },
  { atLeast: 600000, baseTax: 32322.50, rate: 0.0625 },
  { atLeast: 1200000, baseTax: 69822.50, rate: 0.065 },
];

export type MdFilingStatus = "Single" | "Married" | "Head of Household";
export const MD_FILING_STATUSES: MdFilingStatus[] = ["Single", "Married", "Head of Household"];

function mdStateBracketsFor(filingStatus: string | null | undefined): Bracket[] {
  const status = String(filingStatus || "").trim().toLowerCase();
  if (status === "married" || status === "head of household") return MD_STATE_BRACKETS_MARRIED;
  return MD_STATE_BRACKETS_SINGLE;
}

// Local (county) tax rates for 2026 — Comptroller memo Attachment 1. Two counties
// (Anne Arundel, Frederick) have their own tiered local-rate schedules instead of one
// flat percentage; everyone else is a flat rate. "Unknown Maryland County" (3.30%) is
// the Central Payroll Bureau's own mandated default "absent of employee submitted
// address data" — used here the same way, when no county is on file. "Out of State"
// (2.25%) is for Maryland-source income paid to a person who lives outside Maryland.
export const MD_COUNTIES = [
  "Allegany County", "Anne Arundel County", "Baltimore County", "Baltimore City",
  "Calvert County", "Caroline County", "Carroll County", "Cecil County", "Charles County",
  "Dorchester County", "Frederick County", "Garrett County", "Harford County", "Howard County",
  "Kent County", "Montgomery County", "Prince George's County", "Queen Anne's County",
  "St. Mary's County", "Somerset County", "Talbot County", "Washington County",
  "Wicomico County", "Worcester County", "Unknown Maryland County", "Out of State",
] as const;
export type MdCounty = (typeof MD_COUNTIES)[number];

const FLAT_LOCAL_RATES: Partial<Record<MdCounty, number>> = {
  "Allegany County": 0.0320, "Baltimore County": 0.0320, "Baltimore City": 0.0320,
  "Calvert County": 0.0320, "Caroline County": 0.0320, "Carroll County": 0.0303,
  "Cecil County": 0.0274, "Charles County": 0.0303, "Dorchester County": 0.0330,
  "Garrett County": 0.0265, "Harford County": 0.0306, "Howard County": 0.0320,
  "Kent County": 0.0330, "Montgomery County": 0.0320, "Prince George's County": 0.0320,
  "Queen Anne's County": 0.0320, "St. Mary's County": 0.0320, "Somerset County": 0.0320,
  "Talbot County": 0.0240, "Washington County": 0.0295, "Wicomico County": 0.0320,
  "Worcester County": 0.0225, "Unknown Maryland County": 0.0330, "Out of State": 0.0225,
};

// Tiered local rates, annual thresholds, split by the same Single-vs-Married/HOH grouping
// as the state brackets (Comptroller memo Attachment 1).
const TIERED_LOCAL_RATES: Partial<Record<MdCounty, { single: Bracket[]; married: Bracket[] }>> = {
  "Anne Arundel County": {
    single: [
      { atLeast: 0, baseTax: 0, rate: 0.0270 },
      { atLeast: 50000, baseTax: 1350, rate: 0.0294 },
      { atLeast: 400000, baseTax: 11640, rate: 0.0320 },
    ],
    married: [
      { atLeast: 0, baseTax: 0, rate: 0.0270 },
      { atLeast: 75000, baseTax: 2025, rate: 0.0294 },
      { atLeast: 480000, baseTax: 13932, rate: 0.0320 },
    ],
  },
  "Frederick County": {
    single: [
      { atLeast: 0, baseTax: 0, rate: 0.0225 },
      { atLeast: 25000, baseTax: 562.50, rate: 0.0275 },
      { atLeast: 50000, baseTax: 1250, rate: 0.0296 },
      { atLeast: 150000, baseTax: 4210, rate: 0.0320 },
    ],
    married: [
      { atLeast: 0, baseTax: 0, rate: 0.0225 },
      { atLeast: 25000, baseTax: 562.50, rate: 0.0275 },
      { atLeast: 100000, baseTax: 2625, rate: 0.0296 },
      { atLeast: 250000, baseTax: 7065, rate: 0.0320 },
    ],
  },
};

function localTaxFor(annualTaxableIncome: number, county: string | null | undefined, filingStatus: string | null | undefined): number {
  const match = MD_COUNTIES.find((c) => c.toLowerCase() === String(county || "").trim().toLowerCase());
  const resolved: MdCounty = match || "Unknown Maryland County";
  const tiered = TIERED_LOCAL_RATES[resolved];
  if (tiered) {
    const status = String(filingStatus || "").trim().toLowerCase();
    const brackets = status === "married" || status === "head of household" ? tiered.married : tiered.single;
    return applyBrackets(annualTaxableIncome, brackets);
  }
  const flatRate = FLAT_LOCAL_RATES[resolved] ?? FLAT_LOCAL_RATES["Unknown Maryland County"]!;
  return annualTaxableIncome * flatRate;
}

// Maryland Employer Withholding Guide, p.10 — per-pay-period Standard Deduction and
// per-exemption amount, both stated here as their annual figures (the guide's own
// per-period columns are these divided by the period count, e.g. weekly $3,400/52 =
// $65.38 — verified against the printed table). $3,400 standard deduction is fixed
// specifically for the percentage-method withholding calculation (not the full Form 502
// standard deduction formula, which is income-based with its own floor/cap).
const MD_ANNUAL_STANDARD_DEDUCTION = 3400;
const MD_ANNUAL_EXEMPTION_AMOUNT = 3200;

/**
 * Maryland state + local (county) income tax withholding for one paycheck. Only accurate
 * for Maryland residents working in Maryland — this app doesn't yet have real DC/PA/VA/DE
 * bracket data, so calculatePaycheck should keep using the flat-rate estimate for any
 * other work state. `periodTaxableWages` is the same federal-taxable-wages figure used
 * elsewhere (gross less pre-tax retirement/health/HSA deductions).
 *
 * `exemptions` is the MW507 exemption count (defaults to 0 — the safer, higher-
 * withholding default absent real MW507 data on file). `county` defaults to "Unknown
 * Maryland County" (3.30%, the Central Payroll Bureau's own mandated default for missing
 * address data) when not set.
 */
export function calculateMarylandWithholding(
  periodTaxableWages: number,
  payFrequency: string | null | undefined,
  stateFilingStatus: string | null | undefined,
  county: string | null | undefined,
  exemptions: number | null | undefined
): number {
  if (periodTaxableWages <= 0) return 0;
  const periods = periodsPerYear(payFrequency);
  const annualWages = periodTaxableWages * periods;
  const exemptionCount = Math.max(0, Number(exemptions) || 0);
  const annualTaxableIncome = Math.max(
    0,
    annualWages - MD_ANNUAL_STANDARD_DEDUCTION - exemptionCount * MD_ANNUAL_EXEMPTION_AMOUNT
  );
  const annualStateTax = applyBrackets(annualTaxableIncome, mdStateBracketsFor(stateFilingStatus));
  const annualLocalTax = localTaxFor(annualTaxableIncome, county, stateFilingStatus);
  return (annualStateTax + annualLocalTax) / periods;
}
