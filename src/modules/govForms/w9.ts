/**
 * Fills the IRS's own real fillable Form W-9 (Request for Taxpayer
 * Identification Number and Certification) — the same
 * overlay-onto-a-real-government-form pattern already used for
 * W-2/1099/940/941/1096 (see src/common/pdfForms.ts) and Forms
 * 2848/8821/MD 548/W-4 (see src/modules/poaForms/poaForms.service.ts and
 * src/modules/govForms/w4.ts), never a firm-drawn substitute.
 *
 * Only page 1 of 6 is filled and returned. Pages 2-6 of the official PDF are
 * pure instructions (What's New, Purpose of Form, definitions, penalties,
 * the "What Name and Number To Give the Requester" table, and the Privacy
 * Act Notice) — nothing fillable lives there.
 *
 * Field names were confirmed the way poaForms.service.ts's doc comment
 * describes, but by a different route than usual: this PDF's AcroForm
 * fields carry no /TU tooltip text at all (checked directly — every field
 * returned null for both the field dict and every widget dict). However,
 * unlike a plain flattened form, this PDF still embeds its *original* XFA
 * template packet even though pdf-lib (correctly) ignores it when reading
 * the AcroForm. Extracting that XFA `template` stream directly (via
 * pikepdf, since pdf-lib discards it) exposed every field's real caption
 * text and screen-reader `<speak>` description verbatim — e.g. field
 * "f1_01" is captioned "1  Name of entity/individual...", "f1_11" is
 * captioned "Social security number" with a `<speak>` description reading
 * "...Social security number. First 3 digits." This is a stronger source
 * than a tooltip would have been (it's the same text the form designer
 * wrote for the caption/accessibility layer) and every placement was then
 * re-confirmed visually per methodology (b): each field filled with a
 * distinguishing value and the result rendered with `qlmanage -t` and
 * compared against the blank form.
 *
 * Line 3a (federal tax classification) is NOT a PDFRadioGroup — pdf-lib
 * reports seven independent PDFCheckBox fields sharing the base name
 * "c1_1" (topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].c1_1[0..6]), the
 * same "checkboxes, not a real radio group" pattern already seen on Form
 * W-4's Step 1(c). The XFA template's own field order (left-to-right, top
 * row then down) combined with each field's caption text confirms the
 * mapping 1:1 with the seven boxes printed on the form: [0] Individual/sole
 * proprietor, [1] C corporation, [2] S corporation, [3] Partnership, [4]
 * Trust/estate, [5] LLC, [6] Other. Because these are independent
 * checkboxes, nothing in the PDF itself enforces "check only one" — this
 * module only ever checks the single box matching the caller's
 * taxClassification. Immediately after the LLC checkbox (index [5]) sits
 * f1_03 (maxLen 1) — the one-letter LLC tax-classification code (C/S/P) —
 * and immediately after the Other checkbox (index [6]) sits f1_04, the
 * free-text "Other" description. Both were confirmed by filling each with
 * a distinguishing value and re-rendering: the letter landed centered in
 * its own small boxed sub-field on the LLC line, and the description text
 * landed on the Other line.
 *
 * Line 3b (the foreign-partner box, c1_2[0]) is deliberately NOT
 * implemented — a rare edge case (foreign partnerships) this firm's
 * Maryland small-business/contractor clients essentially never hit, per
 * the requested scope.
 *
 * Line 4 (Exemptions — exempt payee code, f1_05, and FATCA exemption code,
 * f1_06) is deliberately NOT implemented — essentially never used by this
 * firm's typical vendors/contractors; left blank on every generated form.
 *
 * Line 7 (List account number(s), f1_10, optional) and the "Requester's
 * name and address (optional)" box (f1_09) are deliberately NOT
 * implemented — both optional and rarely used, matching the requested
 * scope.
 *
 * Part I (Taxpayer Identification Number) really is boxed digits, not one
 * plain text field, for both TIN types, confirmed by each field's own
 * maxLength and the XFA caption text: SSN is three combined text fields —
 * f1_11 (first 3 digits, maxLen 3), f1_12 (middle 2, maxLen 2), f1_13 (last
 * 4, maxLen 4) — and EIN is two combined text fields — f1_14 (first 2,
 * maxLen 2), f1_15 (last 7, maxLen 7). Both TINs are supported; the caller
 * may supply either or both (the real form has both an SSN box and an EIN
 * box printed side by side joined by "or", and leaves it to the filer to
 * fill in whichever applies).
 *
 * Part II (Certification) is deliberately left completely blank. It
 * consists only of a signature line and a date line — there is no separate
 * "print name" field distinct from line 1 anywhere on this form, confirmed
 * both by the XFA extraction (no further f1_NN fields exist beyond f1_15,
 * i.e. there is nothing past Part I in the AcroForm at all) and by visual
 * inspection of the rendered blank form. This matches the same rule
 * applied to every other government form this app generates: a typed name
 * is not a legal signature, so nothing in Part II is ever filled — the
 * printed page is always ready for a real pen signature.
 */
import { loadTemplate, fillCopy, checkBox, extractFlattenedPages } from "../../common/pdfForms";

export interface W9Data {
  name: string;
  businessName?: string;
  /** Must be one of W9_TAX_CLASSIFICATIONS (exact wording from the real form's line 3a). */
  taxClassification: string;
  /** Only used when taxClassification is "LLC" — single letter C/S/P. */
  llcTaxClassificationCode?: string;
  /** Only used when taxClassification is "Other". */
  otherClassificationText?: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  ssn?: string;
  ein?: string;
}

/** Line 3a options — exact wording as printed on the real form, in the form's own order. */
export const W9_TAX_CLASSIFICATIONS = [
  "Individual/Sole Proprietor",
  "C Corporation",
  "S Corporation",
  "Partnership",
  "Trust/Estate",
  "LLC",
  "Other",
];

/** Maps each line 3a option to its confirmed AcroForm checkbox index (see module doc comment). */
const CLASSIFICATION_FIELD: Record<string, string> = {
  "Individual/Sole Proprietor": "c1_1[0]",
  "C Corporation": "c1_1[1]",
  "S Corporation": "c1_1[2]",
  Partnership: "c1_1[3]",
  "Trust/Estate": "c1_1[4]",
  LLC: "c1_1[5]",
  Other: "c1_1[6]",
};

/** Splits a 9-digit TIN into the fixed-width boxed groups the real form prints. Non-digit characters (dashes, spaces) are stripped first. */
function splitDigits(value: string | undefined, widths: number[]): string[] {
  const digits = (value || "").replace(/\D/g, "");
  const parts: string[] = [];
  let i = 0;
  for (const w of widths) {
    parts.push(digits.slice(i, i + w));
    i += w;
  }
  return parts;
}

export async function generateW9(data: W9Data): Promise<Uint8Array> {
  const doc = await loadTemplate("fw9.pdf");
  const P = "topmostSubform[0].Page1[0]";
  const B = `${P}.Boxes3a-b_ReadOrder[0]`;
  const A = `${P}.Address_ReadOrder[0]`;

  // Line 1 & 2 — Name / business name
  fillCopy(doc, {
    name: `${P}.f1_01[0]`,
    businessName: `${P}.f1_02[0]`,
  }, {
    name: data.name,
    businessName: data.businessName || "",
  });

  // Line 3a — Federal tax classification (independent checkboxes, not a
  // PDFRadioGroup; see module doc comment). Only the one matching the
  // caller's taxClassification is checked.
  const classificationField = CLASSIFICATION_FIELD[data.taxClassification];
  if (classificationField) checkBox(doc, `${B}.${classificationField}`);

  // LLC follow-up — one-letter tax classification code (C/S/P)
  if (data.taxClassification === "LLC") {
    fillCopy(doc, { code: `${B}.f1_03[0]` }, { code: data.llcTaxClassificationCode || "" });
  }

  // Other follow-up — free-text description
  if (data.taxClassification === "Other") {
    fillCopy(doc, { text: `${B}.f1_04[0]` }, { text: data.otherClassificationText || "" });
  }

  // Line 3b (foreign-partner box) and Line 4 (Exemptions) deliberately
  // skipped — see module doc comment.

  // Line 5 & 6 — Address / City, state, ZIP
  fillCopy(doc, {
    address: `${A}.f1_07[0]`,
    cityStateZip: `${A}.f1_08[0]`,
  }, {
    address: data.address,
    cityStateZip: [data.city, [data.state, data.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
  });

  // Line 7 (account numbers) deliberately skipped — see module doc comment.

  // Part I — Taxpayer Identification Number (SSN and/or EIN, boxed digits)
  const [ssn1, ssn2, ssn3] = splitDigits(data.ssn, [3, 2, 4]);
  fillCopy(doc, {
    ssn1: `${P}.f1_11[0]`,
    ssn2: `${P}.f1_12[0]`,
    ssn3: `${P}.f1_13[0]`,
  }, { ssn1, ssn2, ssn3 });

  const [ein1, ein2] = splitDigits(data.ein, [2, 7]);
  fillCopy(doc, {
    ein1: `${P}.f1_14[0]`,
    ein2: `${P}.f1_15[0]`,
  }, { ein1, ein2 });

  // Part II — Certification: deliberately left blank (signature/date only;
  // see module doc comment).

  return extractFlattenedPages(doc, [0]);
}
