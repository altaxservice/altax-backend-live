/**
 * Form 941 generation — fills the official IRS fillable Form 941 (src/assets/tax-forms/f941.pdf,
 * Rev. March 2026), the quarterly federal payroll tax return. One per employer/quarter, pages 0-1
 * of the 3-page template (page 2 is the separate 941-V payment voucher, not filled here).
 *
 * Field paths confirmed by rendering the real template and cross-checking each field's rect
 * against the printed line/box position — same method used for w2.ts/nec1099.ts/w3.ts/form940.ts.
 *
 * Known simplifications (left blank rather than guessed, since this system doesn't track the
 * underlying data): Line 5b (tips), 5d (Additional Medicare Tax withholding), 5f (unreported-tip
 * notices), 7-9 (fractions-of-cents/sick-pay/tips adjustments), 11 (Form 8974 research credit),
 * 13 (deposits made). Line 16 (monthly vs. semiweekly depositor) is only auto-checked for the
 * "liability under $2,500" case, since the alternative requires the employer's prior-quarter
 * lookback liability, which this system doesn't retain — a preparer must set that manually for
 * quarters at or above $2,500. Also note: line 5a's Social Security wage base cap (a separate,
 * much higher annual per-employee cap than FUTA's $7,000) is NOT applied here — see form940.ts
 * for how that kind of cap is implemented; extending it to SS wages was out of scope for this
 * pass since AL TAX's client base is far under that cap in practice.
 */
import { loadTemplate, fillCopy, checkBox, extractFlattenedPages } from "../../common/pdfForms";

const FIELDS: Record<string, string> = {
  einPart1: "topmostSubform[0].Page1[0].Header[0].EntityArea[0].f1_1[0]",
  einPart2: "topmostSubform[0].Page1[0].Header[0].EntityArea[0].f1_2[0]",
  name: "topmostSubform[0].Page1[0].Header[0].EntityArea[0].f1_3[0]",
  tradeName: "topmostSubform[0].Page1[0].Header[0].EntityArea[0].f1_4[0]",
  addressLine: "topmostSubform[0].Page1[0].Header[0].EntityArea[0].f1_5[0]",
  city: "topmostSubform[0].Page1[0].Header[0].EntityArea[0].f1_6[0]",
  state: "topmostSubform[0].Page1[0].Header[0].EntityArea[0].f1_7[0]",
  zip: "topmostSubform[0].Page1[0].Header[0].EntityArea[0].f1_8[0]",
  line1: "topmostSubform[0].Page1[0].f1_12[0]",
  line2Dollars: "topmostSubform[0].Page1[0].f1_13[0]",
  line2Cents: "topmostSubform[0].Page1[0].f1_14[0]",
  line3Dollars: "topmostSubform[0].Page1[0].f1_15[0]",
  line3Cents: "topmostSubform[0].Page1[0].f1_16[0]",
  line5aCol1Dollars: "topmostSubform[0].Page1[0].f1_17[0]",
  line5aCol1Cents: "topmostSubform[0].Page1[0].f1_18[0]",
  line5aCol2Dollars: "topmostSubform[0].Page1[0].f1_19[0]",
  line5aCol2Cents: "topmostSubform[0].Page1[0].f1_20[0]",
  line5cCol1Dollars: "topmostSubform[0].Page1[0].f1_25[0]",
  line5cCol1Cents: "topmostSubform[0].Page1[0].f1_26[0]",
  line5cCol2Dollars: "topmostSubform[0].Page1[0].f1_27[0]",
  line5cCol2Cents: "topmostSubform[0].Page1[0].f1_28[0]",
  line5eDollars: "topmostSubform[0].Page1[0].f1_33[0]",
  line5eCents: "topmostSubform[0].Page1[0].f1_34[0]",
  line6Dollars: "topmostSubform[0].Page1[0].f1_37[0]",
  line6Cents: "topmostSubform[0].Page1[0].f1_38[0]",
  line10Dollars: "topmostSubform[0].Page1[0].f1_45[0]",
  line10Cents: "topmostSubform[0].Page1[0].f1_46[0]",
  line12Dollars: "topmostSubform[0].Page1[0].f1_49[0]",
  line12Cents: "topmostSubform[0].Page1[0].f1_50[0]",
  line14Dollars: "topmostSubform[0].Page1[0].f1_53[0]",
  line14Cents: "topmostSubform[0].Page1[0].f1_54[0]",
  routingNumber: "topmostSubform[0].Page1[0].RoutingNo[0].f1_57[0]",
  accountNumber: "topmostSubform[0].Page1[0].AccountNo[0].f1_58[0]",
};

const CHECKBOX_QUARTER = [
  "topmostSubform[0].Page1[0].Header[0].ReportForQuarter[0].c1_1[0]",
  "topmostSubform[0].Page1[0].Header[0].ReportForQuarter[0].c1_1[1]",
  "topmostSubform[0].Page1[0].Header[0].ReportForQuarter[0].c1_1[2]",
  "topmostSubform[0].Page1[0].Header[0].ReportForQuarter[0].c1_1[3]",
];

const PAGE2_FIELDS: Record<string, string> = {
  headerName: "topmostSubform[0].Page2[0].Name_ReadOrder[0].f1_3[0]",
  headerEinPart1: "topmostSubform[0].Page2[0].EIN_Number[0].f1_1[0]",
  headerEinPart2: "topmostSubform[0].Page2[0].EIN_Number[0].f1_2[0]",
  preparerPrintName: "topmostSubform[0].Page2[0].f2_13[0]",
  preparerPrintTitle: "topmostSubform[0].Page2[0].f2_14[0]",
  preparerPhone: "topmostSubform[0].Page2[0].f2_15[0]",
};

const CHECKBOX_LINE16_UNDER_2500 = "topmostSubform[0].Page2[0].c2_1[0]";
const CHECKBOX_THIRD_PARTY_NO = "topmostSubform[0].Page2[0].c2_4[1]";

function formatEinParts(raw: string | null | undefined): { part1: string; part2: string } {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length !== 9) return { part1: "", part2: "" };
  return { part1: digits.slice(0, 2), part2: digits.slice(2) };
}

function splitCents(amount: number): { dollars: string; cents: string } {
  const cents = Math.round(amount * 100);
  if (cents === 0) return { dollars: "", cents: "" };
  const wholeDollars = Math.floor(cents / 100);
  const remCents = cents % 100;
  return { dollars: String(wholeDollars), cents: String(remCents).padStart(2, "0") };
}

function prefixSplit(prefix: string, amount: number): Record<string, string> {
  const { dollars, cents } = splitCents(amount);
  return { [`${prefix}Dollars`]: dollars, [`${prefix}Cents`]: cents };
}

/** Same street/city/zip splitter convention as form1096.ts/form940.ts. */
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

export interface Form941Data {
  employerEin: string | null;
  employerName: string;
  employerAddress: string | null;
  employerState: string | null;
  quarter: 1 | 2 | 3 | 4;
  employeeCount: number;
  wages: number;
  federalWithholding: number;
  socialSecurityWages: number;
  medicareWages: number;
  contactName: string | null;
  contactPhone: string | null;
}

/** Builds the 2-page (Page 1 + Page 2) Form 941 PDF bytes for one employer/quarter. */
export async function generateForm941(data: Form941Data): Promise<Uint8Array> {
  const doc = await loadTemplate("f941.pdf");

  const ein = formatEinParts(data.employerEin);
  const addr = splitAddress(data.employerAddress || "");

  const line5aCol2 = data.socialSecurityWages * 0.124;
  const line5cCol2 = data.medicareWages * 0.029;
  const line5e = line5aCol2 + line5cCol2;
  const line6 = data.federalWithholding + line5e;
  const line10 = line6;
  const line12 = line10;
  const line14 = line12;

  checkBox(doc, CHECKBOX_QUARTER[data.quarter - 1]);
  checkBox(doc, CHECKBOX_THIRD_PARTY_NO);
  if (line12 < 2500) checkBox(doc, CHECKBOX_LINE16_UNDER_2500);

  fillCopy(doc, FIELDS, {
    einPart1: ein.part1, einPart2: ein.part2,
    name: data.employerName,
    addressLine: addr.street, city: addr.city, state: data.employerState || "", zip: addr.zip,
    line1: data.employeeCount > 0 ? String(data.employeeCount) : "",
    ...prefixSplit("line2", data.wages),
    ...prefixSplit("line3", data.federalWithholding),
    ...prefixSplit("line5aCol1", data.socialSecurityWages),
    ...prefixSplit("line5aCol2", line5aCol2),
    ...prefixSplit("line5cCol1", data.medicareWages),
    ...prefixSplit("line5cCol2", line5cCol2),
    ...prefixSplit("line5e", line5e),
    ...prefixSplit("line6", line6),
    ...prefixSplit("line10", line10),
    ...prefixSplit("line12", line12),
    ...prefixSplit("line14", line14),
  });

  fillCopy(doc, PAGE2_FIELDS, {
    headerName: data.employerName, headerEinPart1: ein.part1, headerEinPart2: ein.part2,
    preparerPrintName: data.contactName || "", preparerPrintTitle: "", preparerPhone: data.contactPhone || "",
  });

  return extractFlattenedPages(doc, [0, 1]);
}
