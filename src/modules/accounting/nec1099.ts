/**
 * 1099-NEC generation — fills the official IRS fillable Form 1099-NEC
 * (src/assets/tax-forms/f1099nec.pdf, Rev. December 2026). Same reasoning as w2.ts:
 * only the recipient-facing copy (Copy B) plus Copy 2 (state, if required) are
 * generated. Copy A (to IRS) must be e-filed (IRS FIRE/IRIS) or printed on
 * special red-ink scannable stock — not offered here.
 */
import { loadTemplate, fillCopy, extractFlattenedPages, money2 } from "../../common/pdfForms";

// Array, not an object — see w2.ts's COPY_PAGES comment: JS reorders
// integer-like keys ("2") ahead of string keys regardless of insertion order.
const COPY_PAGES: [string, number][] = [["B", 3], ["2", 5]];

const CANONICAL_FIELDS: Record<string, string> = {
  year: "topmostSubform[0].CopyB[0].PgHeader[0].CalendarYear[0].f2_1[0]",
  payerName: "topmostSubform[0].CopyB[0].LeftCol[0].f2_2[0]",
  payerStreet: "topmostSubform[0].CopyB[0].LeftCol[0].f2_3[0]",
  payerCity: "topmostSubform[0].CopyB[0].LeftCol[0].f2_5[0]",
  payerPhone: "topmostSubform[0].CopyB[0].LeftCol[0].f2_6[0]",
  payerZip: "topmostSubform[0].CopyB[0].LeftCol[0].f2_9[0]",
  payerTin: "topmostSubform[0].CopyB[0].LeftCol[0].f2_10[0]",
  recipientTin: "topmostSubform[0].CopyB[0].LeftCol[0].f2_11[0]",
  recipientName: "topmostSubform[0].CopyB[0].LeftCol[0].f2_12[0]",
  recipientStreet: "topmostSubform[0].CopyB[0].LeftCol[0].f2_13[0]",
  recipientCity: "topmostSubform[0].CopyB[0].LeftCol[0].f2_15[0]",
  recipientZip: "topmostSubform[0].CopyB[0].LeftCol[0].f2_18[0]",
  box1a: "topmostSubform[0].CopyB[0].RightCol[0].f2_20[0]",
  box4: "topmostSubform[0].CopyB[0].RightCol[0].f2_26[0]",
  box5: "topmostSubform[0].CopyB[0].RightCol[0].Box5_ReadOrder[0].f2_27[0]",
  box6: "topmostSubform[0].CopyB[0].RightCol[0].Box6_ReadOrder[0].f2_29[0]",
  box7: "topmostSubform[0].CopyB[0].RightCol[0].f2_31[0]",
};

function fieldsForCopy(copy: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, path] of Object.entries(CANONICAL_FIELDS)) {
    out[key] = path.replace("CopyB[0]", `Copy${copy}[0]`);
  }
  return out;
}

function formatTin(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 9) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return String(raw || "");
}

export interface Nec1099Data {
  year: string;
  payerName: string;
  payerAddress: string | null;
  payerPhone: string | null;
  payerTin: string | null;
  recipientTin: string | null;
  recipientName: string;
  recipientAddress: string | null;
  box1a: number;
  box4: number;
  state: string | null;
  stateTaxWithheld: number;
  statePayerNo: string | null;
  stateIncome: number;
}

export async function generate1099NecCopies(data: Nec1099Data): Promise<Uint8Array> {
  const doc = await loadTemplate("f1099nec.pdf");
  const values: Record<string, string> = {
    year: data.year,
    payerName: data.payerName,
    payerStreet: data.payerAddress || "",
    payerPhone: data.payerPhone || "",
    payerTin: formatTin(data.payerTin),
    recipientTin: formatTin(data.recipientTin),
    recipientName: data.recipientName,
    recipientStreet: data.recipientAddress || "",
    box1a: money2(data.box1a),
    box4: money2(data.box4),
    box5: money2(data.stateTaxWithheld),
    box6: data.statePayerNo || "",
    box7: money2(data.stateIncome),
  };

  for (const [copy] of COPY_PAGES) {
    fillCopy(doc, fieldsForCopy(copy), values);
  }

  return extractFlattenedPages(doc, COPY_PAGES.map(([, pageIndex]) => pageIndex));
}
