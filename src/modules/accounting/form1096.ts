/**
 * Form 1096 generation — fills the official IRS fillable Form 1096
 * (src/assets/tax-forms/f1096.pdf, 2026 revision), the annual transmittal
 * that accompanies paper Copy A of every 1099-NEC an employer/client files.
 * Single page, single copy. The "FILER" on this form is the client
 * (the business that paid contractors and issued the 1099-NECs), not AL TAX
 * SERVICE itself.
 *
 * Field paths confirmed by rendering the real template and cross-checking
 * each field's rect against the printed box label position — same method
 * used for w2.ts/nec1099.ts/w3.ts. This template's checkbox names are
 * unusually self-descriptive (e.g. "F1099-NEC[0]"), so no ambiguity there.
 */
import { loadTemplate, fillCopy, checkBox, extractFlattenedPages, money2 } from "../../common/pdfForms";

const FIELDS: Record<string, string> = {
  filerName: "topmostSubform[0].Page1[0].NameAddress_ReadOrder[0].f1_1[0]",
  streetAddress: "topmostSubform[0].Page1[0].NameAddress_ReadOrder[0].f1_2[0]",
  roomSuite: "topmostSubform[0].Page1[0].NameAddress_ReadOrder[0].f1_3[0]",
  city: "topmostSubform[0].Page1[0].NameAddress_ReadOrder[0].f1_4[0]",
  state: "topmostSubform[0].Page1[0].NameAddress_ReadOrder[0].f1_5[0]",
  country: "topmostSubform[0].Page1[0].NameAddress_ReadOrder[0].f1_6[0]",
  zip: "topmostSubform[0].Page1[0].NameAddress_ReadOrder[0].f1_7[0]",
  contactName: "topmostSubform[0].Page1[0].NameAddress_ReadOrder[0].f1_8[0]",
  contactPhone: "topmostSubform[0].Page1[0].NameAddress_ReadOrder[0].f1_9[0]",
  contactEmail: "topmostSubform[0].Page1[0].NameAddress_ReadOrder[0].f1_10[0]",
  contactFax: "topmostSubform[0].Page1[0].NameAddress_ReadOrder[0].f1_11[0]",
  box1_Ein: "topmostSubform[0].Page1[0].f1_12[0]",
  box2_Ssn: "topmostSubform[0].Page1[0].f1_13[0]",
  box3_TotalForms: "topmostSubform[0].Page1[0].f1_14[0]",
  box4_FederalTaxWithheld: "topmostSubform[0].Page1[0].Box4_ReadOrder[0].f1_15[0]",
  box5_TotalReported: "topmostSubform[0].Page1[0].f1_16[0]",
};

const CHECKBOX_1099NEC = "topmostSubform[0].Page1[0].F1099-NEC[0].c1_1[0]";

export interface Form1096Data {
  filerEin: string | null;
  filerName: string;
  filerAddress: string | null; // parsed into street/city/state/zip below
  filerState: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  totalFormsFiled: number;
  totalAmountReported: number;
}

function formatEin(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length !== 9) return String(raw || "");
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/**
 * Splits a single free-text address string into street / city / zip, best-effort
 * (same convention as paycheckPdf.ts's address splitting). The trailing state
 * abbreviation is also stripped from city, since Form 1096 has its own separate
 * "State or province" box (filled from client.state, not parsed from this string)
 * — leaving it in would show "Rosedale MD" in the city box right above "MD" again.
 */
function splitAddress(address: string): { street: string; city: string; zip: string } {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const zipMatch = last.match(/(\d{5}(-\d{4})?)\s*$/);
    return {
      street: parts[0],
      city: parts.slice(1).join(", ")
        .replace(/\d{5}(-\d{4})?\s*$/, "")
        .replace(/\b[A-Z]{2}\s*$/, "")
        .trim(),
      zip: zipMatch ? zipMatch[1] : "",
    };
  }
  return { street: address, city: "", zip: "" };
}

/** Builds the single-page Form 1096 PDF bytes for one client/year's 1099-NEC batch. */
export async function generateForm1096(data: Form1096Data): Promise<Uint8Array> {
  const doc = await loadTemplate("f1096.pdf");

  checkBox(doc, CHECKBOX_1099NEC);

  const addr = splitAddress(data.filerAddress || "");

  fillCopy(doc, FIELDS, {
    filerName: data.filerName,
    streetAddress: addr.street,
    city: addr.city,
    state: data.filerState || "",
    country: "United States",
    zip: addr.zip,
    contactName: data.contactName || "",
    contactPhone: data.contactPhone || "",
    contactEmail: data.contactEmail || "",
    box1_Ein: formatEin(data.filerEin),
    box3_TotalForms: data.totalFormsFiled > 0 ? String(data.totalFormsFiled) : "",
    box5_TotalReported: money2(data.totalAmountReported),
  });

  return extractFlattenedPages(doc, [1]);
}
