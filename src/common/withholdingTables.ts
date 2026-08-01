/**
 * Real bracket-based federal, Maryland, Virginia, DC, and Delaware payroll withholding —
 * replaces the flat-rate estimate (a single percentage like 2.5116% applied to every
 * dollar) that this app used previously. Source data transcribed directly from official
 * state/federal sources: the 2026 IRS Publication 15-T ("Percentage Method Tables for
 * Automated Payroll Systems," STANDARD Withholding Rate Schedules, page 12); the Maryland
 * Comptroller's Central Payroll Bureau memo "2026 Maryland State and Local Income Tax
 * Withholding Information" (Feb 4, 2026) plus the "2026 Maryland Employer Withholding
 * Guide" (standard deduction / exemption table, p.10); Virginia Tax's "Income Tax
 * Withholding Guide for Employers" (Rev. 05/25, formula effective for wages paid after
 * July 1, 2025 — cross-checked against the guide's own worked example); DC OTR's current
 * individual income tax bracket schedule (no separate withholding-specific standard
 * deduction — DC only allows a dependent allowance); and Delaware's official 2026
 * "Tax Computation Schedule" (from the Division of Revenue's PIT-EST estimated-tax
 * instructions, which states the same brackets used for withholding).
 *
 * VA/DC/DE all have NO local/county income tax layer (unlike Maryland), so each of those
 * three is just a single state bracket table — no per-county lookup needed.
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
 * for Maryland residents working in Maryland. `periodTaxableWages` is the same
 * federal-taxable-wages figure used elsewhere (gross less pre-tax retirement/health/HSA
 * deductions). See calculateVirginiaWithholding/calculateDcWithholding/
 * calculateDelawareWithholding below for those three states' real bracket engines —
 * calculatePaycheck still falls back to the flat-rate estimate for any other work state
 * (PA is already exact as a flat 3.07% rate, seeded directly in v3_tax_rates, so it needs
 * no bracket function here).
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

// ---- Virginia ----

// Virginia Tax's "Income Tax Withholding Guide for Employers" (Rev. 05/25), formula
// effective for wages paid after July 1, 2025 (Taxable Year 2025 and after). Unlike
// federal/MD, Virginia's formula uses ONE bracket table regardless of filing status —
// the marital distinction lives entirely in the VA-4 exemption count (E1), not a
// separate married/single table. Cross-checked against the guide's own worked example
// (semi-monthly pay, 5 exemptions, $2,649 gross → $109.50 withheld — matches exactly).
const VA_BRACKETS: Bracket[] = [
  { atLeast: 0, baseTax: 0, rate: 0.02 },
  { atLeast: 3000, baseTax: 60, rate: 0.03 },
  { atLeast: 5000, baseTax: 120, rate: 0.05 },
  { atLeast: 17000, baseTax: 720, rate: 0.0575 },
];

// Per Form VA-4: $8,750 base amount (the guide's own formula constant — not literally a
// "standard deduction" line item, just the formula's fixed subtraction), $930 per
// personal/dependent exemption (E1), $800 per age-65-or-over-or-blind exemption (E2).
const VA_BASE_AMOUNT = 8750;
const VA_EXEMPTION_AMOUNT = 930;
const VA_AGE_BLIND_AMOUNT = 800;

/**
 * Virginia state income tax withholding for one paycheck — no local/county layer (VA has
 * none). `personalExemptions` is Form VA-4's E1 (personal + dependent count, defaults to
 * 0 — safer/higher-withholding default absent real VA-4 data, same reasoning as
 * Maryland's exemption default). `ageBlindExemptions` is E2 (age 65+/blind count).
 */
export function calculateVirginiaWithholding(
  periodTaxableWages: number,
  payFrequency: string | null | undefined,
  personalExemptions: number | null | undefined,
  ageBlindExemptions: number | null | undefined
): number {
  if (periodTaxableWages <= 0) return 0;
  const periods = periodsPerYear(payFrequency);
  const annualWages = periodTaxableWages * periods;
  const e1 = Math.max(0, Number(personalExemptions) || 0);
  const e2 = Math.max(0, Number(ageBlindExemptions) || 0);
  const annualTaxableIncome = Math.max(0, annualWages - VA_BASE_AMOUNT - e1 * VA_EXEMPTION_AMOUNT - e2 * VA_AGE_BLIND_AMOUNT);
  const annualTax = applyBrackets(annualTaxableIncome, VA_BRACKETS);
  return annualTax / periods;
}

// ---- District of Columbia ----

// DC OTR's current individual income tax brackets — 7 brackets, 4% to 10.75%. No local
// layer (DC has none — it IS the local jurisdiction) and no separate withholding-specific
// standard deduction; DC's own percentage-method instructions only subtract a Dependent
// Allowance before applying this same bracket table.
const DC_BRACKETS: Bracket[] = [
  { atLeast: 0, baseTax: 0, rate: 0.04 },
  { atLeast: 10000, baseTax: 400, rate: 0.06 },
  { atLeast: 40000, baseTax: 2200, rate: 0.065 },
  { atLeast: 60000, baseTax: 3500, rate: 0.085 },
  { atLeast: 250000, baseTax: 19650, rate: 0.0925 },
  { atLeast: 500000, baseTax: 42775, rate: 0.0975 },
  { atLeast: 1000000, baseTax: 91525, rate: 0.1075 },
];

const DC_DEPENDENT_ALLOWANCE = 4150;

/**
 * DC income tax withholding for one paycheck. `dependents` is the number of dependents
 * claimed (defaults to 0 — same safer/higher-withholding default as MD/VA).
 */
export function calculateDcWithholding(
  periodTaxableWages: number,
  payFrequency: string | null | undefined,
  dependents: number | null | undefined
): number {
  if (periodTaxableWages <= 0) return 0;
  const periods = periodsPerYear(payFrequency);
  const annualWages = periodTaxableWages * periods;
  const dependentCount = Math.max(0, Number(dependents) || 0);
  const annualTaxableIncome = Math.max(0, annualWages - dependentCount * DC_DEPENDENT_ALLOWANCE);
  const annualTax = applyBrackets(annualTaxableIncome, DC_BRACKETS);
  return annualTax / periods;
}

// ---- Delaware ----

// Delaware Division of Revenue's 2026 "Tax Computation Schedule" (from the PIT-EST
// estimated-tax instructions, which use the same brackets as withholding) — 7 brackets,
// 0% to 6.6%. No local layer (DE has none).
const DE_BRACKETS: Bracket[] = [
  { atLeast: 0, baseTax: 0, rate: 0 },
  { atLeast: 2000, baseTax: 0, rate: 0.022 },
  { atLeast: 5000, baseTax: 66, rate: 0.039 },
  { atLeast: 10000, baseTax: 261, rate: 0.048 },
  { atLeast: 20000, baseTax: 741, rate: 0.052 },
  { atLeast: 25000, baseTax: 1001, rate: 0.0555 },
  { atLeast: 60000, baseTax: 2943, rate: 0.066 },
];

// Delaware is structurally different from MD/VA/federal: instead of subtracting
// exemptions from income before applying the bracket table, it applies a flat $110
// PERSONAL CREDIT per exemption directly against the computed tax, after the bracket
// step — per the official Tax Computation Schedule ("Personal Credits ($110.00 X total
// number of Federal Exemptions and exemptions for being 60 or older)"). The standard
// deduction ($3,250 single/MFS, $6,500 MFJ) is still a before-bracket subtraction like
// every other state here. Deliberately not implementing the additional $2,500 age-65-
// or-blind deduction (a further, separate adjustment) — this app's employee data model
// doesn't track age/blind status, same scope line already drawn for federal Step 3/4
// adjustments and MD/VA's own optional adjustments.
const DE_STANDARD_DEDUCTION_SINGLE = 3250;
const DE_STANDARD_DEDUCTION_MARRIED = 6500;
const DE_PERSONAL_CREDIT = 110;

/**
 * Delaware state income tax withholding for one paycheck. `filingStatus` reuses the same
 * MD_FILING_STATUSES values already on the employee record ("Single" | "Married" | "Head
 * of Household") — Delaware's own form only distinguishes Single/MFS/Dependent vs.
 * Married Filing Jointly, so "Head of Household" is treated as Single here (Delaware's
 * own Tax Computation Schedule groups "single, divorced or widow(er), head of household"
 * under the same $3,250 standard deduction). `exemptions` reuses the same
 * `state_exemptions` count as DC/VA, defaults to 0 (safer/higher-withholding default).
 */
export function calculateDelawareWithholding(
  periodTaxableWages: number,
  payFrequency: string | null | undefined,
  filingStatus: string | null | undefined,
  exemptions: number | null | undefined
): number {
  if (periodTaxableWages <= 0) return 0;
  const periods = periodsPerYear(payFrequency);
  const annualWages = periodTaxableWages * periods;
  const status = String(filingStatus || "").trim().toLowerCase();
  const standardDeduction = status === "married" ? DE_STANDARD_DEDUCTION_MARRIED : DE_STANDARD_DEDUCTION_SINGLE;
  const annualTaxableIncome = Math.max(0, annualWages - standardDeduction);
  const annualTaxBeforeCredit = applyBrackets(annualTaxableIncome, DE_BRACKETS);
  const exemptionCount = Math.max(0, Number(exemptions) || 0);
  const annualTax = Math.max(0, annualTaxBeforeCredit - exemptionCount * DE_PERSONAL_CREDIT);
  return annualTax / periods;
}
