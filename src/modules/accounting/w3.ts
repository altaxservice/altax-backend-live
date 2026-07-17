/**
 * W-3 generation — fills the official IRS fillable Form W-3 (src/assets/tax-forms/fw3.pdf,
 * 2026 revision), the annual transmittal summing one employer's W-2 totals across all its
 * employees for a calendar year. Single page, single copy (unlike W-2/1099-NEC, W-3 has no
 * recipient/employee copies — it's filed once per employer alongside Copy A of every W-2).
 *
 * Field paths below were confirmed by rendering the real template and cross-checking each
 * field's rect against the printed box label position (no tooltip metadata exists on this
 * PDF) — same method used for w2.ts/nec1099.ts.
 */
import { loadTemplate, fillCopy, checkBox, extractFlattenedPages, money2 } from "../../common/pdfForms";

const FIELDS: Record<string, string> = {
  controlNumber: "topmostSubform[0].Page1[0].f1_01[0]",
  boxC_TotalW2s: "topmostSubform[0].Page1[0].BoxesC-H[0].f1_02[0]",
  boxD_Establishment: "topmostSubform[0].Page1[0].BoxesC-H[0].f1_03[0]",
  boxE_Ein: "topmostSubform[0].Page1[0].BoxesC-H[0].f1_04[0]",
  boxF_EmployerName: "topmostSubform[0].Page1[0].BoxesC-H[0].f1_05[0]",
  boxG_EmployerAddress: "topmostSubform[0].Page1[0].BoxesC-H[0].f1_06[0]",
  boxH_OtherEin: "topmostSubform[0].Page1[0].BoxesC-H[0].f1_07[0]",
  box1_Wages: "topmostSubform[0].Page1[0].Boxes1-14[0].f1_08[0]",
  box2_FederalTax: "topmostSubform[0].Page1[0].Boxes1-14[0].f1_09[0]",
  box3_SsWages: "topmostSubform[0].Page1[0].Boxes1-14[0].f1_10[0]",
  box4_SsTax: "topmostSubform[0].Page1[0].Boxes1-14[0].f1_11[0]",
  box5_MedicareWages: "topmostSubform[0].Page1[0].Boxes1-14[0].f1_12[0]",
  box6_MedicareTax: "topmostSubform[0].Page1[0].Boxes1-14[0].f1_13[0]",
  box15State: "topmostSubform[0].Page1[0].f1_23[0]",
  box15EmployerStateId: "topmostSubform[0].Page1[0].f1_24[0]",
  box16_StateWages: "topmostSubform[0].Page1[0].f1_25[0]",
  box17_StateTax: "topmostSubform[0].Page1[0].f1_26[0]",
  contactPerson: "topmostSubform[0].Page1[0].f1_29[0]",
  telephone: "topmostSubform[0].Page1[0].f1_30[0]",
  email: "topmostSubform[0].Page1[0].f1_32[0]",
};

const CHECKBOX_KIND_OF_PAYER_941 = "topmostSubform[0].Page1[0].bKind_ReadOrder[0].b941[0].c1_1[0]";
const CHECKBOX_KIND_OF_EMPLOYER_NONE = "topmostSubform[0].Page1[0].bKindOfEmployer_ReadOrder[0].EmployerCheckboxes[0].None[0].c1_2[0]";

export interface W3Data {
  employerEin: string | null;
  employerName: string;
  employerAddress: string | null;
  totalW2Count: number;
  box1: number; box2: number; box3: number; box4: number; box5: number; box6: number;
  state: string | null; employerStateId: string | null; box16: number; box17: number;
  contactPerson: string | null; telephone: string | null; email: string | null;
}

function formatEin(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length !== 9) return String(raw || "");
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/** Builds the single-page Form W-3 PDF bytes for one employer/year. */
export async function generateW3(data: W3Data): Promise<Uint8Array> {
  const doc = await loadTemplate("fw3.pdf");

  checkBox(doc, CHECKBOX_KIND_OF_PAYER_941);
  checkBox(doc, CHECKBOX_KIND_OF_EMPLOYER_NONE);

  fillCopy(doc, FIELDS, {
    boxC_TotalW2s: data.totalW2Count > 0 ? String(data.totalW2Count) : "",
    boxE_Ein: formatEin(data.employerEin),
    boxF_EmployerName: data.employerName,
    boxG_EmployerAddress: data.employerAddress || "",
    box1_Wages: money2(data.box1), box2_FederalTax: money2(data.box2),
    box3_SsWages: money2(data.box3), box4_SsTax: money2(data.box4),
    box5_MedicareWages: money2(data.box5), box6_MedicareTax: money2(data.box6),
    box15State: data.state || "", box15EmployerStateId: data.employerStateId || "",
    box16_StateWages: money2(data.box16), box17_StateTax: money2(data.box17),
    contactPerson: data.contactPerson || "", telephone: data.telephone || "", email: data.email || "",
  });

  // Page index 1 is the single actual W-3 form page; page 0 is the SSA's separate "Do Not Cut..." instructions cover sheet bundled into the same template PDF.
  return extractFlattenedPages(doc, [1]);
}
