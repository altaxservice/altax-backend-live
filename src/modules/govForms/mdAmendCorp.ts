/**
 * Fills Maryland SDAT's own real fillable PDF for "Articles of Amendment for
 * a Maryland ___ Corporation" — same overlay-onto-a-real-government-form
 * pattern as every other form in this module, never a firm-drawn substitute.
 *
 * Source: SDAT Corporate Charter Amendment (Rev. August 2024), saved to
 * src/assets/tax-forms/mdamendcorp.pdf. 2 pages: page 1 is the actual form,
 * page 2 is pure "GUIDELINES FOR DRAFTING ARTICLES OF AMENDMENT" instruction
 * text with zero AcroForm fields — extractFlattenedPages only pulls page
 * index 0.
 *
 * Field-name verification: this revision's 10 AcroForm fields are already
 * self-describing (e.g. "2. Insert the exact name of the organization"),
 * confirmed against a 150dpi render of both pages (the printed numbered
 * blanks on page 1 line up 1:1 with the field names, and page 2's own
 * "GUIDELINES" section spells out exactly what belongs in each blank —
 * see below for where this app's data model deviates from a naive reading
 * of the field names):
 *
 * - (1) "1. Insert \"Stock,\" \"Nonstock,\" or \"Professional\"" — the field's
 *   own tooltip text lists only 3 options, but page 2's own guideline (1)
 *   explicitly lists FOUR: "Stock", "Close", "Nonstock", or "Professional"
 *   ("Close" — a close corporation — is missing from the field's truncated
 *   tooltip but is a real, distinct option per the form's own instructions).
 *   `corpTypeBefore` uses all 4.
 * - (2) "2. Insert the exact name of the organization" — corp's exact legal
 *   name PRIOR to this amendment's effect (per guideline (2): must match
 *   Departmental Records exactly).
 * - (3) "3. State the changes to the charter" — the amendment text itself.
 *   Multiline (`isMultiline() === true`), matching its large blank box.
 * - (4) "...approved by: 1" / "...approved by: 2" — TWO separate, NON-
 *   multiline single-line text fields, not a 5-way checkbox/radio group
 *   despite guideline (4) describing "the five most common methods of
 *   approval" — this revision's AcroForm simply doesn't have a choice
 *   field there, only two blank lines for whichever exact phrase the
 *   preparer types in. Guideline (4) gives 5 exact suggested phrases, each
 *   already pre-wrapped by SDAT's own instructions text across those same
 *   2 lines (verified the guideline text's own line breaks land at the
 *   same word boundaries used below) — `approvalMethod` is a union of
 *   those 5 canonical phrases, and CORP_APPROVAL_TEXT below composes each
 *   into the exact 2-line split SDAT's own guidelines use.
 * - (5) "Attested to by (Signature/title)" / "Signed By (signature/title)"
 *   — BOTH are PDFSignature fields (not text fields) covering the entire
 *   "name AND title" line as one signature block each; unlike Form 8822-B's
 *   revision, there's no separate plain-text Title-only field here to fill.
 *   Per this module's standing rule of never filling a signature field
 *   (see cra.ts/form8822b.ts), `attestedByName/Title` and
 *   `signedByName/Title` are collected for informational/audit purposes
 *   only and never rendered onto the PDF.
 * - (6) "Return address of filing party: 1/2/3" — 3 single-line fields.
 *   Guideline (6) says only "Insert a return address for the filing" with
 *   no further structure (unlike, say, CRA's explicit street/city/state/zip
 *   breakdown) — modeled as 3 generic free-text lines so staff can enter
 *   name/street/city-state-zip or whatever fits, matching the blank form's
 *   own unstructured 3 lines.
 */
import { loadTemplate, fillCopy, extractFlattenedPages } from "../../common/pdfForms";

export const MD_AMEND_CORP_TYPES = ["Stock", "Close", "Nonstock", "Professional"] as const;

export const MD_AMEND_CORP_APPROVAL_METHODS = [
  "Directors and stockholders",
  "Stockholders only (close corporation with no directors)",
  "Directors only (no stock issued yet)",
  "Directors and members (nonstock, no authority to issue stock)",
  "Directors only (nonstock, no membership entitled to vote)",
] as const;

/** Composes each canonical approval method into the exact 2-line split SDAT's own printed guidelines use for that phrase. */
const CORP_APPROVAL_TEXT: Record<(typeof MD_AMEND_CORP_APPROVAL_METHODS)[number], [string, string]> = {
  "Directors and stockholders": ["the directors and stockholders", ""],
  "Stockholders only (close corporation with no directors)": [
    "the stockholders. This is a close corporation",
    "that has elected to have no directors",
  ],
  "Directors only (no stock issued yet)": ["the directors. No stock has been issued", ""],
  "Directors and members (nonstock, no authority to issue stock)": ["the directors and members", ""],
  "Directors only (nonstock, no membership entitled to vote)": [
    "the directors. There is no membership entitled",
    "to vote on amendments",
  ],
};

export interface MdAmendCorpData {
  /** (1): "Stock", "Close", "Nonstock", or "Professional" — prior to this amendment's effect. */
  corpTypeBefore: (typeof MD_AMEND_CORP_TYPES)[number];
  /** (2): exact legal name of the corporation, prior to this amendment's effect. */
  corpName: string;
  /** (3): the actual charter amendment text — what's changing and how. */
  amendmentText: string;
  /** (4): which of SDAT's 5 canonical approval methods applies — composed into the form's 2 answer lines. */
  approvalMethod: (typeof MD_AMEND_CORP_APPROVAL_METHODS)[number];
  /**
   * (5) — informational only, NOT rendered onto the PDF (see this file's
   * header comment: both signature blocks are PDFSignature fields). Kept so
   * staff have a record of who's expected to sign before printing.
   */
  attestedByName?: string;
  attestedByTitle?: string;
  signedByName?: string;
  signedByTitle?: string;
  /** (6): 3 free-text lines for the filing party's return address. */
  returnAddressLine1?: string;
  returnAddressLine2?: string;
  returnAddressLine3?: string;
}

export async function generateMdAmendCorp(data: MdAmendCorpData): Promise<Uint8Array> {
  const doc = await loadTemplate("mdamendcorp.pdf");
  const [approvalLine1, approvalLine2] = CORP_APPROVAL_TEXT[data.approvalMethod];

  fillCopy(
    doc,
    {
      corpTypeBefore: '1. Insert "Stock," "Nonstock," or "Professional"',
      corpName: "2. Insert the exact name of the organization",
      amendmentText: "3. State the changes to the charter",
      approvalLine1: "4. This amendment of the charter of the corporation has been approved by: 1",
      approvalLine2: "4. This amendment of the charter of the corporation has been approved by: 2",
      returnAddressLine1: "6. Return address of filing party: 1",
      returnAddressLine2: "6. Return address of filing party: 2",
      returnAddressLine3: "6. Return address of filing party: 3",
    },
    {
      corpTypeBefore: data.corpTypeBefore,
      corpName: data.corpName,
      amendmentText: data.amendmentText,
      approvalLine1,
      approvalLine2,
      returnAddressLine1: data.returnAddressLine1 || "",
      returnAddressLine2: data.returnAddressLine2 || "",
      returnAddressLine3: data.returnAddressLine3 || "",
    }
  );

  return extractFlattenedPages(doc, [0]);
}
