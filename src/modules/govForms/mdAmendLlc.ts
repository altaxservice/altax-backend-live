/**
 * Fills Maryland SDAT's own real fillable PDF for "Articles of Amendment for
 * a Limited Liability Company" — same overlay-onto-a-real-government-form
 * pattern as every other form in this module, never a firm-drawn substitute.
 *
 * Source: SDAT Charter Articles of Amendment for LLC (Revised August 2024),
 * saved to src/assets/tax-forms/mdamendllc.pdf. One page of actual form
 * content; instructions are printed on the same page below the signature
 * block (no separate instructions page, unlike CRA/8822-B) — no field lives
 * there so extractFlattenedPages only needs page index 0.
 *
 * Field-name verification: this revision's 6 AcroForm fields are already
 * self-describing (e.g. "Insert full name of the Limited Liability Company
 * (LLC)"), and were cross-checked against the rendered page image
 * (pdf-lib's `form.getFields()` + `field.acroField.getWidgets()[0]` rect,
 * confirmed against a 150dpi render of the page) rather than assumed from
 * the field name alone:
 *   - Blank (1): LLC name.
 *   - Blank (2): the amendment text itself — a real multiline field
 *     (`isMultiline() === true`), matching its large blank box on the page.
 *   - Blank (3) left column, "Signature of Authorized Person(s)": up to
 *     THREE separate PDFSignature fields stacked in that one blank
 *     ("Signature of Authorized Persons 1/2/3") — LLC amendments must be
 *     approved by unanimous member consent per the form's own printed
 *     instructions, so the form allows more than one signer here.
 *   - Blank (3) right column, "Signature required only for new resident
 *     agents": a single PDFSignature field, printed directly under "I
 *     hereby consent to serve as Resident Agent for the above-named Limited
 *     Liability Company" — the form's own label makes clear this line is
 *     ONLY filled in when a NEW resident agent is being appointed, not when
 *     the existing one continues to serve.
 *
 * All four signature blocks are PDFSignature fields, not PDFTextField —
 * pdf-lib has no way to write a name into those (they're for an actual
 * digital signature), and this module's standing rule (see cra.ts's and
 * form8822b.ts's own doc comments) is to never fill a signature field on any
 * government form regardless. `newResidentAgentName` is therefore collected
 * from staff for context/audit only (stored in the filing's form_data) and
 * used solely to decide whether to surface the "a new resident agent is
 * being appointed — they'll need to sign this copy by hand" note in the UI;
 * it is never written onto the PDF itself.
 */
import { loadTemplate, fillCopy, extractFlattenedPages } from "../../common/pdfForms";

export interface MdAmendLlcData {
  /** Blank (1): full legal name of the LLC as currently on file with SDAT. */
  llcName: string;
  /** Blank (2): the actual charter amendment text — what's changing and how. */
  amendmentText: string;
  /**
   * Informational only — NOT rendered onto the PDF (see this file's header
   * comment: the resident-agent consent line is a PDFSignature field, which
   * pdf-lib cannot fill). Set this when a NEW resident agent is being
   * appointed by this amendment, so the UI can flag that a physical
   * signature is required on that specific line before filing (the form's
   * own label: "Signature required only for new resident agents").
   */
  newResidentAgentName?: string;
}

export async function generateMdAmendLlc(data: MdAmendLlcData): Promise<Uint8Array> {
  const doc = await loadTemplate("mdamendllc.pdf");

  fillCopy(
    doc,
    {
      llcName: "Insert full name of the Limited Liability Company LLC",
      amendmentText: "The Charter of the Limited Liability Company is hereby amended as follows:",
    },
    {
      llcName: data.llcName,
      amendmentText: data.amendmentText,
    }
  );

  return extractFlattenedPages(doc, [0]);
}
