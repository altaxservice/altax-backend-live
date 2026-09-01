/**
 * Fills the IRS's own real fillable PDF for Form 8822-B (Change of Address
 * or Responsible Party — Business) — same overlay-onto-a-real-government-
 * form pattern used for every other form in this module.
 *
 * Source: https://www.irs.gov/pub/irs-pdf/f8822b.pdf (Rev. December 2019),
 * saved to src/assets/tax-forms/f8822b.pdf. One page of actual form content
 * (page 2 is "Where To File" mailing addresses plus instructions text, no
 * fields) — extractFlattenedPages only pulls page index 0.
 *
 * Field-name verification: this revision ships all 22 AcroForm fields with
 * an empty /TU tooltip (same situation as SS-4/8832), so identity was
 * confirmed by extracting each printed label's page position (pdfjs-dist
 * text content, with x/y) and each field's own widget rectangle (pdf-lib
 * `acroField.getWidgets()[0].getRectangle()`), then matching each field to
 * the label immediately above or to its left. The four checkboxes (c1_1
 * through c1_4) land, top to bottom: c1_1 next to "If you are a tax-exempt
 * organization... check here" (a standalone line above the numbered list,
 * NOT part of it — despite the field naming making it look like it might be
 * "line 1"), then c1_2/c1_3/c1_4 beside numbered lines 1/2/3 ("Employment,
 * excise, income, and other business returns" / "Employee plan returns" /
 * "Business location"). The 18 text fields (f1_1 through f1_18) resolve to,
 * in order: line 4a business name, line 4b EIN, then three repeated
 * 4-field groups (main address line + foreign country/province/postal
 * code) for line 5 (old mailing address), line 6 (new mailing address),
 * and line 7 (new business location), then line 8 (new responsible
 * party's name), line 9 (new responsible party's SSN/ITIN/EIN), the
 * daytime phone number, and finally the signer's Title in the "Sign Here"
 * block. Every one of these 22 positions was individually cross-checked,
 * none assumed from the field numbering alone (form field numbers on IRS
 * PDFs don't reliably follow reading order — see cra.ts's and ss4.ts's own
 * doc comments for prior examples of that trap).
 *
 * Deliberately does NOT fill any signature field: "Signature of owner,
 * officer, or representative" and the "Date" line beside it have no
 * AcroForm field at all on this revision (only the printed Title line
 * below them is a real fillable field) — consistent with this module's
 * standing rule of never filling a signature field on any government form,
 * and here the form itself doesn't even offer one to fill.
 */
import { loadTemplate, fillCopy, checkBox, extractFlattenedPages, sanitizePhone } from "../../common/pdfForms";

export interface Form8822bData {
  /** Line 1: "If you are a tax-exempt organization... check here" — a standalone box above the numbered list, not itself a numbered line. */
  taxExemptOrg?: boolean;
  /** Numbered line 1: employment, excise, income, and other business returns. */
  affectsEmploymentReturns?: boolean;
  /** Numbered line 2: employee plan returns (Forms 5500, 5500-EZ, etc.). */
  affectsEmployeePlanReturns?: boolean;
  /** Numbered line 3: business location. */
  affectsBusinessLocation?: boolean;

  /** Line 4a. */
  businessName: string;
  /** Line 4b. */
  ein?: string;

  /** Line 5 — only fill in if the mailing address changed. */
  oldMailingAddress?: string;
  oldMailingForeignCountry?: string;
  oldMailingForeignProvince?: string;
  oldMailingForeignPostalCode?: string;

  /** Line 6 — only fill in if the mailing address changed. */
  newMailingAddress?: string;
  newMailingForeignCountry?: string;
  newMailingForeignProvince?: string;
  newMailingForeignPostalCode?: string;

  /** Line 7 — only fill in if the business's physical location changed. */
  newBusinessLocation?: string;
  newBusinessLocationForeignCountry?: string;
  newBusinessLocationForeignProvince?: string;
  newBusinessLocationForeignPostalCode?: string;

  /** Line 8 — only fill in if the responsible party changed. */
  newResponsiblePartyName?: string;
  /** Line 9 — the NEW responsible party's own SSN/ITIN/EIN, not the business's. */
  newResponsiblePartyId?: string;

  /** Optional daytime phone number of the person the IRS can contact about this filing. */
  daytimePhone?: string;
  /** Title of the signer (officer, owner, general partner, LLC member manager, fiduciary, etc.) — printed next to the blank signature line, not itself a signature. */
  title?: string;
}

export async function generateForm8822b(data: Form8822bData): Promise<Uint8Array> {
  const doc = await loadTemplate("f8822b.pdf");
  const P = "topmostSubform[0].Page1[0]";

  fillCopy(
    doc,
    {
      businessName: `${P}.Line4aReadOrder[0].f1_1[0]`,
      ein: `${P}.Line4bReadOrder[0].f1_2[0]`,
      oldMailingAddress: `${P}.f1_3[0]`,
      oldMailingForeignCountry: `${P}.f1_4[0]`,
      oldMailingForeignProvince: `${P}.f1_5[0]`,
      oldMailingForeignPostalCode: `${P}.f1_6[0]`,
      newMailingAddress: `${P}.f1_7[0]`,
      newMailingForeignCountry: `${P}.f1_8[0]`,
      newMailingForeignProvince: `${P}.f1_9[0]`,
      newMailingForeignPostalCode: `${P}.f1_10[0]`,
      newBusinessLocation: `${P}.f1_11[0]`,
      newBusinessLocationForeignCountry: `${P}.f1_12[0]`,
      newBusinessLocationForeignProvince: `${P}.f1_13[0]`,
      newBusinessLocationForeignPostalCode: `${P}.f1_14[0]`,
      newResponsiblePartyName: `${P}.f1_15[0]`,
      newResponsiblePartyId: `${P}.f1_16[0]`,
      daytimePhone: `${P}.f1_17[0]`,
      title: `${P}.f1_18[0]`,
    },
    {
      businessName: data.businessName,
      ein: data.ein || "",
      oldMailingAddress: data.oldMailingAddress || "",
      oldMailingForeignCountry: data.oldMailingForeignCountry || "",
      oldMailingForeignProvince: data.oldMailingForeignProvince || "",
      oldMailingForeignPostalCode: data.oldMailingForeignPostalCode || "",
      newMailingAddress: data.newMailingAddress || "",
      newMailingForeignCountry: data.newMailingForeignCountry || "",
      newMailingForeignProvince: data.newMailingForeignProvince || "",
      newMailingForeignPostalCode: data.newMailingForeignPostalCode || "",
      newBusinessLocation: data.newBusinessLocation || "",
      newBusinessLocationForeignCountry: data.newBusinessLocationForeignCountry || "",
      newBusinessLocationForeignProvince: data.newBusinessLocationForeignProvince || "",
      newBusinessLocationForeignPostalCode: data.newBusinessLocationForeignPostalCode || "",
      newResponsiblePartyName: data.newResponsiblePartyName || "",
      newResponsiblePartyId: data.newResponsiblePartyId || "",
      daytimePhone: sanitizePhone(data.daytimePhone),
      title: data.title || "",
    }
  );

  if (data.taxExemptOrg) checkBox(doc, `${P}.c1_1[0]`);
  if (data.affectsEmploymentReturns) checkBox(doc, `${P}.c1_2[0]`);
  if (data.affectsEmployeePlanReturns) checkBox(doc, `${P}.c1_3[0]`);
  if (data.affectsBusinessLocation) checkBox(doc, `${P}.c1_4[0]`);

  return extractFlattenedPages(doc, [0]);
}
