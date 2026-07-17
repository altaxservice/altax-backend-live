/**
 * Form 940 generation — fills the official IRS fillable Form 940 (src/assets/tax-forms/f940.pdf,
 * "for 2025" revision — the latest IRS has published as of this build; re-check
 * irs.gov/pub/irs-pdf/f940.pdf each filing season for a newer year's template).
 * Annual FUTA return, one per employer/year, pages 0-1 of the 3-page template (page 2 is
 * the separate 940-V payment voucher + instructions, not filled here).
 *
 * Field paths confirmed by rendering the real template and cross-checking each field's
 * rect against the printed line/box position — same method used for w2.ts/nec1099.ts/w3.ts.
 *
 * FUTA math implemented here (not just box transcription): only the first $7,000 of each
 * employee's wages for the year is FUTA-taxable (IRC 3306(b)). The existing per-paycheck
 * `futa` column in v3_paychecks does NOT apply this cap — it just multiplies every
 * paycheck's wages by the rate — so it cannot be summed directly for this form. This
 * module recomputes taxable wages per employee (and per employee per quarter, for the
 * Part 5 quarterly liability breakdown) directly from gross_wages instead.
 */
import { loadTemplate, fillCopy, checkBox, extractFlattenedPages } from "../../common/pdfForms";

const FUTA_WAGE_CAP = 7000;

const FIELDS: Record<string, string> = {
  einPart1: "topmostSubform[0].Page1[0].EntityArea[0].f1_1[0]",
  einPart2: "topmostSubform[0].Page1[0].EntityArea[0].f1_2[0]",
  name: "topmostSubform[0].Page1[0].EntityArea[0].f1_3[0]",
  tradeName: "topmostSubform[0].Page1[0].EntityArea[0].f1_4[0]",
  addressLine: "topmostSubform[0].Page1[0].EntityArea[0].f1_5[0]",
  city: "topmostSubform[0].Page1[0].EntityArea[0].f1_6[0]",
  state: "topmostSubform[0].Page1[0].EntityArea[0].f1_7[0]",
  zip: "topmostSubform[0].Page1[0].EntityArea[0].f1_8[0]",
  line1aState1: "topmostSubform[0].Page1[0].f1_12[0]",
  line1aState2: "topmostSubform[0].Page1[0].f1_13[0]",
  line3Dollars: "topmostSubform[0].Page1[0].f1_14[0]",
  line3Cents: "topmostSubform[0].Page1[0].f1_15[0]",
  line4Dollars: "topmostSubform[0].Page1[0].f1_16[0]",
  line4Cents: "topmostSubform[0].Page1[0].f1_17[0]",
  line5Dollars: "topmostSubform[0].Page1[0].f1_18[0]",
  line5Cents: "topmostSubform[0].Page1[0].f1_19[0]",
  line6Dollars: "topmostSubform[0].Page1[0].f1_20[0]",
  line6Cents: "topmostSubform[0].Page1[0].f1_21[0]",
  line7Dollars: "topmostSubform[0].Page1[0].f1_22[0]",
  line7Cents: "topmostSubform[0].Page1[0].f1_23[0]",
  line8Dollars: "topmostSubform[0].Page1[0].f1_24[0]",
  line8Cents: "topmostSubform[0].Page1[0].f1_25[0]",
  line12Dollars: "topmostSubform[0].Page1[0].f1_32[0]",
  line12Cents: "topmostSubform[0].Page1[0].f1_33[0]",
  line13Dollars: "topmostSubform[0].Page1[0].f1_34[0]",
  line13Cents: "topmostSubform[0].Page1[0].f1_35[0]",
  line14Dollars: "topmostSubform[0].Page1[0].f1_36[0]",
  line14Cents: "topmostSubform[0].Page1[0].f1_37[0]",
  routingNumber: "topmostSubform[0].Page1[0].RoutingNo[0].f1_40[0]",
  accountNumber: "topmostSubform[0].Page1[0].AccountNo[0].f1_41[0]",
};

const PAGE2_FIELDS: Record<string, string> = {
  headerName: "topmostSubform[0].Page2[0].f1_3[0]",
  headerEinPart1: "topmostSubform[0].Page2[0].f1_1[0]",
  headerEinPart2: "topmostSubform[0].Page2[0].f1_2[0]",
  line16aDollars: "topmostSubform[0].Page2[0].f2_1[0]",
  line16aCents: "topmostSubform[0].Page2[0].f2_2[0]",
  line16bDollars: "topmostSubform[0].Page2[0].f2_3[0]",
  line16bCents: "topmostSubform[0].Page2[0].f2_4[0]",
  line16cDollars: "topmostSubform[0].Page2[0].f2_5[0]",
  line16cCents: "topmostSubform[0].Page2[0].f2_6[0]",
  line16dDollars: "topmostSubform[0].Page2[0].f2_7[0]",
  line16dCents: "topmostSubform[0].Page2[0].f2_8[0]",
  line17Dollars: "topmostSubform[0].Page2[0].f2_9[0]",
  line17Cents: "topmostSubform[0].Page2[0].f2_10[0]",
  preparerPrintName: "topmostSubform[0].Page2[0].f2_14[0]",
  preparerPrintTitle: "topmostSubform[0].Page2[0].f2_15[0]",
  preparerPhone: "topmostSubform[0].Page2[0].f2_16[0]",
};

const CHECKBOX_THIRD_PARTY_NO = "topmostSubform[0].Page2[0].c2_1[1]";

function formatEinParts(raw: string | null | undefined): { part1: string; part2: string } {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length !== 9) return { part1: "", part2: "" };
  return { part1: digits.slice(0, 2), part2: digits.slice(2) };
}

function splitCents(amount: number): { dollars: string; cents: string } {
  const cents = Math.round(amount * 100);
  const wholeDollars = Math.floor(cents / 100);
  const remCents = cents % 100;
  if (cents === 0) return { dollars: "", cents: "" };
  return { dollars: String(wholeDollars), cents: String(remCents).padStart(2, "0") };
}

export interface EmployeeQuarterWages {
  employee: string;
  quarter: 1 | 2 | 3 | 4;
  wages: number;
}

export interface Form940Data {
  employerEin: string | null;
  employerName: string;
  employerAddress: string | null; // split into street/city/zip below
  employerState: string | null;
  futaRate: number;
  quarterlyWages: EmployeeQuarterWages[]; // one row per employee per quarter that had any pay
  contactName: string | null;
  contactPhone: string | null;
}

/** Same street/city/zip splitter convention as form1096.ts. */
function splitAddress(address: string): { street: string; city: string; zip: string } {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const zipMatch = last.match(/(\d{5}(-\d{4})?)\s*$/);
    return {
      street: parts[0],
      city: parts.slice(1).join(", ").replace(/\d{5}(-\d{4})?\s*$/, "").replace(/\b[A-Z]{2}\s*$/, "").trim(),
      zip: zipMatch ? zipMatch[1] : "",
    };
  }
  return { street: address, city: "", zip: "" };
}

/**
 * Applies the $7,000-per-employee-per-year FUTA wage cap across quarters in
 * calendar order, so each quarter gets only the slice of that employee's wages
 * that falls below the cumulative cap (the same wages counted once, not once
 * per paycheck). Returns totals: overall (uncapped) wages paid, capped taxable
 * wages, and taxable wages broken out by quarter.
 */
function computeFutaTotals(rows: EmployeeQuarterWages[]) {
  const byEmployee = new Map<string, Map<number, number>>();
  let totalPayments = 0;
  for (const row of rows) {
    totalPayments += row.wages;
    if (!byEmployee.has(row.employee)) byEmployee.set(row.employee, new Map());
    byEmployee.get(row.employee)!.set(row.quarter, row.wages);
  }

  const taxableByQuarter: Record<1 | 2 | 3 | 4, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let totalTaxableWages = 0;

  for (const quarters of byEmployee.values()) {
    let cumulative = 0;
    for (const q of [1, 2, 3, 4] as const) {
      const wages = quarters.get(q) || 0;
      const before = Math.min(cumulative, FUTA_WAGE_CAP);
      cumulative += wages;
      const after = Math.min(cumulative, FUTA_WAGE_CAP);
      const taxable = Math.max(0, after - before);
      taxableByQuarter[q] += taxable;
      totalTaxableWages += taxable;
    }
  }

  return { totalPayments, totalTaxableWages, taxableByQuarter };
}

/** Builds the 2-page (Page 1 + Page 2) Form 940 PDF bytes for one employer/year. */
export async function generateForm940(data: Form940Data): Promise<Uint8Array> {
  const doc = await loadTemplate("f940.pdf");

  const { totalPayments, totalTaxableWages, taxableByQuarter } = computeFutaTotals(data.quarterlyWages);
  const excessOver7000 = Math.max(0, totalPayments - totalTaxableWages);
  const futaBeforeAdjustments = totalTaxableWages * data.futaRate;
  // Lines 9-11 (adjustments for exempt-from-SUTA / late-SUTA / credit-reduction states) are
  // left blank: they depend on the state's annual credit-reduction status and each
  // employee's state unemployment filing timeliness, neither of which this system tracks.
  // That matches the common case (no credit reduction, all SUTA paid on time), where line
  // 12 simply equals line 8 — but a preparer must still confirm that before filing.
  const line12 = futaBeforeAdjustments;
  const ein = formatEinParts(data.employerEin);
  const addr = splitAddress(data.employerAddress || "");

  checkBox(doc, CHECKBOX_THIRD_PARTY_NO);

  fillCopy(doc, FIELDS, {
    einPart1: ein.part1, einPart2: ein.part2,
    name: data.employerName,
    addressLine: addr.street, city: addr.city, state: data.employerState || "", zip: addr.zip,
    line1aState1: (data.employerState || "").slice(0, 1), line1aState2: (data.employerState || "").slice(1, 2),
    ...prefixSplit("line3", totalPayments),
    ...prefixSplit("line5", excessOver7000),
    ...prefixSplit("line6", excessOver7000),
    ...prefixSplit("line7", totalTaxableWages),
    ...prefixSplit("line8", futaBeforeAdjustments),
    ...prefixSplit("line12", line12),
    ...prefixSplit("line14", line12),
  });

  fillCopy(doc, PAGE2_FIELDS, {
    headerName: data.employerName, headerEinPart1: ein.part1, headerEinPart2: ein.part2,
    ...(line12 > 500
      ? {
          ...prefixSplit("line16a", taxableByQuarter[1] * data.futaRate),
          ...prefixSplit("line16b", taxableByQuarter[2] * data.futaRate),
          ...prefixSplit("line16c", taxableByQuarter[3] * data.futaRate),
          ...prefixSplit("line16d", taxableByQuarter[4] * data.futaRate),
          ...prefixSplit("line17", line12),
        }
      : {}),
    preparerPrintName: data.contactName || "", preparerPrintTitle: "", preparerPhone: data.contactPhone || "",
  });

  return extractFlattenedPages(doc, [0, 1]);
}

/** Splits a dollar amount into `${prefix}Dollars`/`${prefix}Cents` keys matching this form's comb-field convention. */
function prefixSplit(prefix: string, amount: number): Record<string, string> {
  const { dollars, cents } = splitCents(amount);
  return { [`${prefix}Dollars`]: dollars, [`${prefix}Cents`]: cents };
}
