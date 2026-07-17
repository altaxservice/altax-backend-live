/**
 * W-2 generation — fills the official IRS fillable Form W-2 (src/assets/tax-forms/fw2.pdf,
 * 2026 revision) rather than hand-drawing a replica, so box numbers/legal language stay
 * exactly IRS-compliant. Box paths below were confirmed by rendering a labeled copy of the
 * real template and visually matching each field to its box (no tooltip metadata exists on
 * this PDF) — see conversation for the reference render.
 *
 * Only the "employee copy" bundle is generated here — Copy B (federal), Copy C (employee's
 * records), Copy 2 (state/local, if required). Copy A (to SSA) and Copy D (employer's
 * records) are deliberately not offered: Copy A legally cannot be printed on plain paper —
 * it must be e-filed (SSA Business Services Online, free) or printed on special red-ink
 * scannable stock. Fabricating a plain-paper Copy A would not be accepted by SSA.
 */
import { loadTemplate, fillCopy, extractFlattenedPages, money2 } from "../../common/pdfForms";

// Array, not a { B: 3, C: 5, "2": 7 } object — JS reorders integer-like keys
// ("2") ahead of string keys regardless of insertion order, which silently put
// Copy 2 first in the output (caught by rendering the actual generated PDF).
const COPY_PAGES: [string, number][] = [["B", 3], ["C", 5], ["2", 7]];

// Canonical field paths, captured from Copy B; other copies share identical internal
// structure, only the "CopyB[0]" segment differs, so paths for C/2 are derived by
// substitution rather than re-declared.
const CANONICAL_FIELDS: Record<string, string> = {
  ssn: "topmostSubform[0].CopyB[0].BoxA_ReadOrder[0].f2_01[0]",
  ein: "topmostSubform[0].CopyB[0].Col_Left[0].f2_02[0]",
  employerNameAddr: "topmostSubform[0].CopyB[0].Col_Left[0].f2_03[0]",
  controlNumber: "topmostSubform[0].CopyB[0].Col_Left[0].f2_04[0]",
  firstName: "topmostSubform[0].CopyB[0].Col_Left[0].FirstName_ReadOrder[0].f2_05[0]",
  lastName: "topmostSubform[0].CopyB[0].Col_Left[0].LastName_ReadOrder[0].f2_06[0]",
  suffix: "topmostSubform[0].CopyB[0].Col_Left[0].f2_07[0]",
  employeeAddr: "topmostSubform[0].CopyB[0].Col_Left[0].f2_08[0]",
  box1: "topmostSubform[0].CopyB[0].Col_Right[0].Box1_ReadOrder[0].f2_09[0]",
  box2: "topmostSubform[0].CopyB[0].Col_Right[0].f2_10[0]",
  box3: "topmostSubform[0].CopyB[0].Col_Right[0].Box3_ReadOrder[0].f2_11[0]",
  box4: "topmostSubform[0].CopyB[0].Col_Right[0].f2_12[0]",
  box5: "topmostSubform[0].CopyB[0].Col_Right[0].Box5_ReadOrder[0].f2_13[0]",
  box6: "topmostSubform[0].CopyB[0].Col_Right[0].f2_14[0]",
  box7: "topmostSubform[0].CopyB[0].Col_Right[0].Box7_ReadOrder[0].f2_15[0]",
  box8: "topmostSubform[0].CopyB[0].Col_Right[0].f2_16[0]",
  box10: "topmostSubform[0].CopyB[0].Col_Right[0].Box10_ReadOrder[0].f2_18[0]",
  box11: "topmostSubform[0].CopyB[0].Col_Right[0].f2_19[0]",
  box15State: "topmostSubform[0].CopyB[0].Boxes15_ReadOrder[0].Box15_ReadOrder[0].f2_31[0]",
  box15EmployerId: "topmostSubform[0].CopyB[0].Boxes15_ReadOrder[0].f2_32[0]",
  box16: "topmostSubform[0].CopyB[0].Box16_ReadOrder[0].f2_35[0]",
  box17: "topmostSubform[0].CopyB[0].Box17_ReadOrder[0].f2_37[0]",
  box18: "topmostSubform[0].CopyB[0].Box18_ReadOrder[0].f2_39[0]",
  box19: "topmostSubform[0].CopyB[0].Box19_ReadOrder[0].f2_41[0]",
  box20: "topmostSubform[0].CopyB[0].f2_43[0]",
};

function fieldsForCopy(copy: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, path] of Object.entries(CANONICAL_FIELDS)) {
    out[key] = path.replace("CopyB[0]", `Copy${copy}[0]`);
  }
  return out;
}

function formatSsn(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length !== 9) return String(raw || "");
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}
function formatEin(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length !== 9) return String(raw || "");
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

export interface W2Data {
  employerEin: string | null;
  employerName: string;
  employerAddress: string | null;
  employeeSsn: string | null;
  employeeName: string;
  employeeAddress: string | null;
  box1: number; box2: number; box3: number; box4: number; box5: number; box6: number;
  state: string | null; employerStateId: string | null; box16: number; box17: number;
}

/** Builds the 3-page (Copy B / C / 2) employee W-2 PDF bytes for one employee/year. */
export async function generateW2EmployeeCopies(data: W2Data): Promise<Uint8Array> {
  const doc = await loadTemplate("fw2.pdf");
  const values: Record<string, string> = {
    ssn: formatSsn(data.employeeSsn),
    ein: formatEin(data.employerEin),
    employerNameAddr: [data.employerName, data.employerAddress].filter(Boolean).join("\n"),
    firstName: data.employeeName.split(" ").slice(0, -1).join(" ") || data.employeeName,
    lastName: data.employeeName.split(" ").slice(-1).join(" "),
    employeeAddr: data.employeeAddress || "",
    box1: money2(data.box1), box2: money2(data.box2), box3: money2(data.box3),
    box4: money2(data.box4), box5: money2(data.box5), box6: money2(data.box6),
    box15State: data.state || "", box15EmployerId: data.employerStateId || "",
    box16: money2(data.box16), box17: money2(data.box17),
  };

  for (const [copy] of COPY_PAGES) {
    fillCopy(doc, fieldsForCopy(copy), values);
  }

  return extractFlattenedPages(doc, COPY_PAGES.map(([, pageIndex]) => pageIndex));
}
