/**
 * Fills the IRS's own real fillable PDF for Form 8832 (Entity Classification
 * Election) — same overlay-onto-a-real-government-form pattern used for
 * every other form in this module.
 *
 * Source: https://www.irs.gov/pub/irs-pdf/f8832.pdf (Rev. December 2013),
 * saved to src/assets/tax-forms/f8832.pdf. The downloaded PDF is 8 pages,
 * but page 1 (PDF index 0) is only an IRS-inserted "New Mailing Address"
 * notice with zero AcroForm fields, not real form content, and pages 5-8
 * are pure instructions — extractFlattenedPages only pulls the three real
 * content pages, PDF indexes 1/2/3 (the form's own pages 1/2/3).
 *
 * Field-name verification: every one of this revision's 70 AcroForm fields
 * carries an empty /TU tooltip (same situation as SS-4/8822-B), so
 * identity was confirmed the same way as 8822-B — cross-referencing each
 * widget's page index + rectangle (`acroField.getWidgets()[0].getRectangle()`)
 * against the printed label nearest it (pdfjs-dist text content, x/y). Every
 * checkbox PAIR/GROUP's option order was individually confirmed against the
 * printed a/b or Yes/No order on the page (not assumed from field-name
 * numbering — see cra.ts's and ss4.ts's doc comments for why that numbering
 * can't be trusted on its own): c1_02[0]/[1] = line 1 a ("Initial
 * classification")/b ("Change in current classification"); c1_03[0]/[1] and
 * c1_04[0]/[1] = lines 2a/2b Yes/[0]/No/[1]; c1_05[0]/[1] = line 3 Yes/No;
 * c2_01[0..5] = line 6 a through f, top to bottom exactly as printed.
 *
 * Both "Pg2Table" (form's page 2, the regular Part I consent statement) and
 * "Pg3Table" (form's page 3, the separate Part II late-election-relief
 * consent statement) are 16-row tables under a "Signature(s) / Date /
 * Title" header, but each row has only ONE real AcroForm field — its
 * rectangle (x=374.4, width 201.6, the rightmost third of the row) lines up
 * with the "Title" column only. Signature and Date have no fillable field
 * on this revision at all, consistent with this module's standing rule of
 * never filling a signature — here the form itself doesn't even offer a
 * field to fill for either Signature or Date. Only row 1 of each table is
 * exposed (an optional printed Title for the primary signer), matching how
 * cra.ts and ss4.ts only fill the first of several repeatable
 * officer/member slots the real form supports — this app's client data
 * model doesn't track a roster of every member/owner who might need to
 * countersign, so guessing which of the other 15 rows apply to whom is
 * left to the preparer.
 *
 * Line 11 (Part II's late-filing explanation) is nine separate single-line
 * AcroForm fields (f3_001..f3_009, not one multi-line field), so a free-text
 * explanation is word-wrapped across up to 9 lines here; anything beyond 9
 * lines is silently dropped rather than overflowing off the page — same
 * "truncate, don't crash" philosophy as setTextSafe's maxLength handling in
 * pdfForms.ts.
 */
import { loadTemplate, fillCopy, checkBox, extractFlattenedPages, sanitizePhone } from "../../common/pdfForms";

export const FORM8832_TYPE_OF_ELECTION = [
  "Initial classification by a newly-formed entity",
  "Change in current classification",
] as const;

export const FORM8832_ENTITY_TYPES = [
  "Domestic — association taxable as a corporation",
  "Domestic — partnership",
  "Domestic — single owner, disregarded as a separate entity",
  "Foreign — association taxable as a corporation",
  "Foreign — partnership",
  "Foreign — single owner, disregarded as a separate entity",
] as const;

export interface Form8832Data {
  /** Line 1, top of the form. */
  legalName: string;
  ein?: string;
  /** "Number, street, and room or suite no." — one free-text line on this revision, not split into separate fields. */
  street: string;
  /** "City or town, state, and ZIP code" — likewise one free-text line. */
  cityStateZip: string;

  /** "Check if:" Address change. */
  addressChange?: boolean;
  /** "Check if:" Late classification relief sought under Revenue Procedure 2009-41. */
  lateReliefUnder200941?: boolean;
  /** "Check if:" Relief for a late change of entity classification election sought under Revenue Procedure 2010-32. */
  lateChangeReliefUnder201032?: boolean;

  /** Line 1 (Part I). */
  typeOfElection: (typeof FORM8832_TYPE_OF_ELECTION)[number];
  /** Line 2a — only asked when typeOfElection is "Change in current classification". */
  priorElectionLast60Months?: boolean;
  /** Line 2b — only asked when line 2a is Yes. */
  priorElectionWasInitialAtFormation?: boolean;
  /** Line 3. */
  moreThanOneOwner: boolean;
  /** Line 4a — only if the entity has a single owner (line 3 = No). */
  ownerName?: string;
  /** Line 4b. */
  ownerId?: string;
  /** Line 5a — only if owned by one or more affiliated corporations filing a consolidated return. */
  parentCorpName?: string;
  /** Line 5b. */
  parentCorpEin?: string;

  /** Line 6. */
  entityType: (typeof FORM8832_ENTITY_TYPES)[number];
  /** Line 7 — only for a foreign eligible entity. */
  foreignCountryOfOrganization?: string;
  /** Line 8, "month, day, year" — e.g. "01/01/2026". */
  effectiveDate?: string;
  /** Line 9 — combined name-and-title of the IRS contact person, one field on this revision. */
  contactNameTitle?: string;
  /** Line 10. */
  contactPhone?: string;
  /** Printed Title for the first signer of the Part I consent statement — see module doc comment for why only one row is exposed. */
  signerTitle?: string;

  /** Line 11 (Part II) — only relevant when lateReliefUnder200941 is checked; word-wrapped across up to 9 lines. */
  lateReliefExplanation?: string;
  /** Printed Title for the first signer of the Part II consent statement. */
  lateReliefSignerTitle?: string;
}

/** Greedily wraps `text` to `maxChars`-wide lines, returning at most `maxLines`. */
function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

const TYPE_OF_ELECTION_CHECKBOX: Record<(typeof FORM8832_TYPE_OF_ELECTION)[number], string> = {
  "Initial classification by a newly-formed entity": "c1_02_0_[0]",
  "Change in current classification": "c1_02_0_[1]",
};

const ENTITY_TYPE_CHECKBOX: Record<(typeof FORM8832_ENTITY_TYPES)[number], string> = {
  "Domestic — association taxable as a corporation": "c2_01_0_[0]",
  "Domestic — partnership": "c2_01_0_[1]",
  "Domestic — single owner, disregarded as a separate entity": "c2_01_0_[2]",
  "Foreign — association taxable as a corporation": "c2_01_0_[3]",
  "Foreign — partnership": "c2_01_0_[4]",
  "Foreign — single owner, disregarded as a separate entity": "c2_01_0_[5]",
};

export async function generateForm8832(data: Form8832Data): Promise<Uint8Array> {
  const doc = await loadTemplate("f8832.pdf");
  const P1 = "topmostSubform[0].Page1[0]";
  const P2 = "topmostSubform[0].Page2[0]";
  const P3 = "topmostSubform[0].Page3[0]";

  fillCopy(
    doc,
    {
      legalName: `${P1}.p1-t1[0]`,
      ein: `${P1}.p1-t2[0]`,
      street: `${P1}.p1-t4[0]`,
      cityStateZip: `${P1}.p1-t5[0]`,
      ownerName: `${P1}.p1-t6[0]`,
      ownerId: `${P1}.p1-t7[0]`,
      parentCorpName: `${P1}.p1-t8[0]`,
      parentCorpEin: `${P1}.p1-t9[0]`,
      foreignCountryOfOrganization: `${P2}.p2-t1[0]`,
      effectiveDate: `${P2}.p2-t2[0]`,
      contactNameTitle: `${P2}.p2-t5[0]`,
      contactPhone: `${P2}.p2-t7[0]`,
      signerTitle: `${P2}.Pg2Table[0].BodyRow1[0].p2-t9[0]`,
      lateReliefSignerTitle: `${P3}.Pg3Table[0].BodyRow1[0].f3_010[0]`,
    },
    {
      legalName: data.legalName,
      ein: data.ein || "",
      street: data.street,
      cityStateZip: data.cityStateZip,
      ownerName: data.moreThanOneOwner ? "" : data.ownerName || "",
      ownerId: data.moreThanOneOwner ? "" : data.ownerId || "",
      parentCorpName: data.parentCorpName || "",
      parentCorpEin: data.parentCorpEin || "",
      foreignCountryOfOrganization: data.foreignCountryOfOrganization || "",
      effectiveDate: data.effectiveDate || "",
      contactNameTitle: data.contactNameTitle || "",
      contactPhone: sanitizePhone(data.contactPhone),
      signerTitle: data.signerTitle || "",
      lateReliefSignerTitle: data.lateReliefSignerTitle || "",
    }
  );

  const explanationLines = wrapLines(data.lateReliefExplanation || "", 95, 9);
  const explanationFields = ["f3_001", "f3_002", "f3_003", "f3_004", "f3_005", "f3_006", "f3_007", "f3_008", "f3_009"];
  fillCopy(
    doc,
    Object.fromEntries(explanationFields.map((f) => [f, `${P3}.${f}[0]`])),
    Object.fromEntries(explanationFields.map((f, i) => [f, explanationLines[i] || ""]))
  );

  if (data.addressChange) checkBox(doc, `${P1}.c1_01_0_[0]`);
  if (data.lateReliefUnder200941) checkBox(doc, `${P1}.c1_06_0_[0]`);
  if (data.lateChangeReliefUnder201032) checkBox(doc, `${P1}.c1_07[0]`);
  checkBox(doc, `${P1}.${TYPE_OF_ELECTION_CHECKBOX[data.typeOfElection]}`);
  if (data.typeOfElection === "Change in current classification") {
    checkBox(doc, `${P1}.c1_03_0_[${data.priorElectionLast60Months ? 0 : 1}]`);
    if (data.priorElectionLast60Months) {
      checkBox(doc, `${P1}.c1_04_0_[${data.priorElectionWasInitialAtFormation ? 0 : 1}]`);
    }
  }
  checkBox(doc, `${P1}.c1_05_0_[${data.moreThanOneOwner ? 0 : 1}]`);
  checkBox(doc, `${P2}.${ENTITY_TYPE_CHECKBOX[data.entityType]}`);

  return extractFlattenedPages(doc, [1, 2, 3]);
}
