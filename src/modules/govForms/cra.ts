/**
 * Fills the Comptroller of Maryland's own real fillable PDF for Form CRA
 * (Combined Registration Application) — same overlay-onto-a-real-government-
 * form pattern as every other form in this module and poaForms.service.ts,
 * never a firm-drawn substitute.
 *
 * Source: https://www.marylandtaxes.gov/forms/current_forms/cra.pdf
 * (COM/RAD-093, Rev 11/25), saved to src/assets/tax-forms/cra.pdf.
 *
 * Unlike SS-4/2553/548, this revision's AcroForm fields are self-describing
 * (e.g. "Enter FEIN", "Check for Sales and use tax") rather than generic
 * "f1_2[0]"/"Text Field 2" names, so field identity was confirmed directly
 * from each field's own name (pdf-lib's `form.getFields()`) cross-checked
 * against the form's printed instructional text, rather than needing the
 * self-naming-render methodology SS-4's doc comment describes.
 *
 * The real form is 8 pages, but pages 5-8 are pure "INSTRUCTIONS" reference
 * text with zero AcroForm fields on them (confirmed: all 171 fields live on
 * pages 1-4, i.e. Sections A/B/C/D/E/F) — extractFlattenedPages only pulls
 * page indexes 0-3, the actual application itself.
 *
 * Scope — this form registers a business for up to nine different Maryland
 * tax accounts and asks dozens of yes/no eligibility questions specific to
 * each one (alcohol/tobacco wholesale activity, motor fuel import/transport/
 * storage, successor-employer/merger unemployment-insurance history,
 * domestic/agricultural payroll thresholds, cannabis licensing, etc. — all
 * of Section B questions 10-16 and all of Sections C/D). None of that is
 * filled in: it's genuinely conditional on facts this app's client data
 * model doesn't capture, and guessing wrong on an eligibility question is
 * worse than leaving it for the preparer to complete by hand from the
 * printed instructions already on pages 5-8 of the real form. What IS
 * filled — Section A in full (identity, addresses, reason for applying,
 * which tax accounts are being requested, entity/ownership type), the
 * NAICS/business-activity description and one responsible-party/officer
 * from Section B, and the preparer name in Section F — covers the
 * overwhelming majority of what this firm actually uses CRA for: a new
 * small business registering for a Sales & Use Tax and/or Employer
 * Withholding account. The form supports up to three officers (Section B,
 * question 21); only the first is filled, matching how this app already
 * only tracks one company_contact_* responsible party per client. Section E
 * (paper-coupon opt-in) and Section F's Print Name/Title/Date/Signature are
 * deliberately left blank — the former is a firm operating preference not
 * modeled anywhere in this app, the latter per this app's standing rule of
 * never filling a signature field on any government form.
 */
import { loadTemplate, fillCopy, checkBox, extractFlattenedPages } from "../../common/pdfForms";

export const CRA_REASONS = [
  "New Business",
  "Change of entity",
  "Additional location(s)",
  "Remit use tax on purchase(s)",
  "Merger",
  "Reorganization",
  "Purchased going business",
  "Re-activate/Re-open",
  "Other",
] as const;

export const CRA_TAX_TYPES = [
  "Sales and use tax",
  "Employer withholding tax",
  "Admissions and amusement tax",
  "Alcohol tax",
  "Tobacco tax",
  "Motor fuel tax",
  "Transient vendor license",
  "Transportation Network Company",
  "Tire recycling fee",
] as const;

export const CRA_OWNERSHIP_TYPES = [
  "Sole proprietorship",
  "Partnership",
  "Nonprofit organization",
  "Maryland corporation",
  "Limited liability company",
  "Non-Maryland corporation",
  "Governmental",
  "Fiduciary",
  "Business trust",
] as const;

export interface CraData {
  fein?: string;
  ssn?: string;
  datEntityId?: string;
  legalFirstName?: string;
  legalLastName: string;
  tradeName?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  county?: string;
  phone?: string;
  fax?: string;
  email?: string;
  /** Only fill in when the mailing address differs from the physical location above. */
  mailingStreet1?: string;
  mailingStreet2?: string;
  mailingCity?: string;
  mailingState?: string;
  mailingZip?: string;
  reason: (typeof CRA_REASONS)[number];
  reasonOther?: string;
  taxTypes: (typeof CRA_TAX_TYPES)[number][];
  ownershipType: (typeof CRA_OWNERSHIP_TYPES)[number];
  naicsCode?: string;
  businessActivity?: string;
  productOrService?: string;
  officerLastName?: string;
  officerFirstName?: string;
  officerSsn?: string;
  officerTitle?: string;
  officerStreet?: string;
  officerCity?: string;
  officerState?: string;
  officerZip?: string;
  officerPhone?: string;
  preparerName?: string;
}

const REASON_CHECKBOX: Record<(typeof CRA_REASONS)[number], string> = {
  "New Business": "Check for New Business",
  "Change of entity": "Check for Change of entity",
  "Additional location(s)": "Check for Additional location(s)",
  "Remit use tax on purchase(s)": "Check for Remit use tax on purchase(s)",
  Merger: "Check for Merger",
  Reorganization: "Check for Reorganization",
  "Purchased going business": "Check for Purchased going business",
  "Re-activate/Re-open": "Check for Re-activate/Re-open",
  Other: "Check for Other",
};

const TAX_TYPE_CHECKBOX: Record<(typeof CRA_TAX_TYPES)[number], string> = {
  "Sales and use tax": "Check for Sales and use tax",
  "Employer withholding tax": "Check for Employer withholding tax",
  "Admissions and amusement tax": "Check for Admissions and amusement tax",
  "Alcohol tax": "Check for Alcohol tax",
  "Tobacco tax": "Check for Tobacco tax",
  "Motor fuel tax": "Check for Motor fuel tax",
  "Transient vendor license": "Check for Transient vendor license",
  "Transportation Network Company": "Check for Transportation Network Company",
  "Tire recycling fee": "Check for Tire recycling fee",
};

const OWNERSHIP_CHECKBOX: Record<(typeof CRA_OWNERSHIP_TYPES)[number], string> = {
  "Sole proprietorship": "Check for Sole proprietorship",
  Partnership: "Check for Partnership",
  "Nonprofit organization": "Check for Nonprofit organization",
  "Maryland corporation": "Check for Maryland corporation",
  "Limited liability company": "Check for Limited liability company",
  "Non-Maryland corporation": "Check for Non-Maryland corporation",
  Governmental: "Check for Governmental",
  Fiduciary: "Check for Fiduciary",
  "Business trust": "Check for Business trust",
};

export async function generateCra(data: CraData): Promise<Uint8Array> {
  const doc = await loadTemplate("cra.pdf");

  fillCopy(
    doc,
    {
      fein: "Enter FEIN",
      ssn: "Enter SSN",
      datEntityId: "Enter Department of Assessments and Taxation Entity Identification Number",
      legalFirstName: "Enter Legal first name of dealer, employer, corporation or owner",
      legalLastName: "Enter Legal last name of dealer, employer, corporation or owner",
      tradeName: "Enter Trade name",
      street1: "Enter Street Address - Line 1",
      street2: "Enter Street Address - Line 2",
      city: "Enter City",
      state: "Enter State",
      zip: "Enter Zip Code",
      county: "Enter County",
      phone: "Enter Telephone number",
      fax: "Enter Fax number",
      email: "Enter Email address",
      mailingStreet1: "Enter Mailing Address - Line 1",
      mailingStreet2: "Enter Mailing Address - Line 2",
      mailingCity: "Enter City - Mailing Address",
      mailingState: "Enter State - Mailing Address",
      mailingZip: "Enter Zip Code - Mailing Address",
      reasonOther: "Enter Other description",
      naicsCode: "Enter your 6 digit NAICS Code that best describes the profit or nonprofit business activity that generates revenue",
      businessActivity: "Describe for profit or nonprofit business activity that generates revenue",
      productOrService: "Specify the product manufactured and/or sold, or the type of service performed",
      officerLastName: "Enter Last name_1",
      officerFirstName: "Enter first name_1",
      officerSsn: "Enter SSN_1",
      officerTitle: "Enter Title_1",
      officerStreet: "Enter Street Address_1",
      officerCity: "Enter City_1",
      officerState: "Enter State_1",
      officerZip: "Enter Zip_1",
      officerPhone: "Enter Telephone_1",
      preparerName: "Enter Name of Preparer other than applicant",
    },
    {
      fein: data.fein || "",
      ssn: data.ssn || "",
      datEntityId: data.datEntityId || "",
      legalFirstName: data.legalFirstName || "",
      legalLastName: data.legalLastName,
      tradeName: data.tradeName || "",
      street1: data.street1,
      street2: data.street2 || "",
      city: data.city,
      state: data.state,
      zip: data.zip,
      county: data.county || "",
      phone: data.phone || "",
      fax: data.fax || "",
      email: data.email || "",
      mailingStreet1: data.mailingStreet1 || "",
      mailingStreet2: data.mailingStreet2 || "",
      mailingCity: data.mailingCity || "",
      mailingState: data.mailingState || "",
      mailingZip: data.mailingZip || "",
      reasonOther: data.reason === "Other" ? data.reasonOther || "" : "",
      naicsCode: data.naicsCode || "",
      businessActivity: data.businessActivity || "",
      productOrService: data.productOrService || "",
      officerLastName: data.officerLastName || "",
      officerFirstName: data.officerFirstName || "",
      officerSsn: data.officerSsn || "",
      officerTitle: data.officerTitle || "",
      officerStreet: data.officerStreet || "",
      officerCity: data.officerCity || "",
      officerState: data.officerState || "",
      officerZip: data.officerZip || "",
      officerPhone: data.officerPhone || "",
      preparerName: data.preparerName || "",
    }
  );

  checkBox(doc, REASON_CHECKBOX[data.reason]);
  for (const t of data.taxTypes) checkBox(doc, TAX_TYPE_CHECKBOX[t]);
  checkBox(doc, OWNERSHIP_CHECKBOX[data.ownershipType]);

  return extractFlattenedPages(doc, [0, 1, 2, 3]);
}
