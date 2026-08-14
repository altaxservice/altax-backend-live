/**
 * Fills Maryland SDAT's own real fillable PDF for "Articles of Dissolution"
 * (domestic corporation only) — same overlay-onto-a-real-government-form
 * pattern as every other form in this module, never a firm-drawn substitute.
 *
 * Source: SDAT Articles of Dissolution (Rev. 04/2025), saved to
 * src/assets/tax-forms/mddissolution.pdf. 4 pages, but pages 3-4 are pure
 * instruction/guidance text with zero AcroForm fields (confirmed: all 36
 * fields live on pages 1-2) — extractFlattenedPages only pulls page indexes
 * [0, 1].
 *
 * Field-name verification — take extra care here, this revision has a real
 * bug in its own field naming: every AcroForm field was cross-checked
 * against a 150dpi render of both pages with each field's own widget
 * rectangle drawn on top (pdf-lib `field.acroField.getWidgets()[0]`, and
 * separately confirmed via pdf-lib `field.isMultiline()`/PyMuPDF widget
 * rects), NOT trusted from the field's own name — see why below.
 *
 * BUG IN THE PDF ITSELF: the blank answer line for each of FIRST/SECOND/
 * THIRD/FOURTH is one position OFF from what its own field name claims.
 * The field named after each section's text is actually positioned as the
 * ANSWER BOX FOR THE PRECEDING SECTION, not its own:
 *   - Field "FIRST The full name of the corporation as listed in SDATs
 *     record is" sits on FIRST's own blank — this one is NOT shifted,
 *     correctly named.
 *   - Field "SDAT ID if available" sits on FIRST's own SDAT-ID box —
 *     correctly named.
 *   - Field "THIRD The full name of the Maryland resident agent who shall
 *     serve for one year after" sits on SECOND's blank (the principal
 *     office address line, printed directly above the THIRD heading) —
 *     SHIFTED. This field actually holds `principalOfficeAddress`.
 *   - Field "FOURTH The address including city state zip code of the
 *     resident agent in Maryland is" sits on THIRD's blank (the resident
 *     agent's full NAME line, printed above the FOURTH heading) — SHIFTED.
 *     This field actually holds `residentAgentName`.
 *   - Field "FIFTH The full name and address including city state zip
 *     code of each of the directors or" (plus an identically-positioned
 *     duplicate "..._2") sits on FOURTH's blank (the resident agent's
 *     ADDRESS line, printed above the FIFTH heading/directors table) —
 *     SHIFTED. This field actually holds `residentAgentAddress`. Only the
 *     primary field is filled, NOT its "_2" duplicate — live-rendering a
 *     test PDF confirmed that filling both stacks two copies of the same
 *     text directly on top of each other (identical widget rect) into
 *     garbled, overlapping glyphs, not two readable lines. Leaving "_2"
 *     blank renders cleanly; same treatment applies to the RESIDENT AGENT'S
 *     CONSENT text field below, which has the identical "_2" duplicate
 *     situation.
 *   - The FIFTH (directors/trustees) and SIXTH (officers) tables below
 *     that are correctly, unambiguously named per-row: "DirectorTrustee
 *     Name"/"Address" then "_2"/"_3"/"_4" for up to 4 director/trustee
 *     rows, then "President Name"/"Address_5", "Treasurer Name"/
 *     "Address_6", "Secretary Name"/"Address_7", "Other Officer
 *     Name"/"Address_8" for the 4 officer rows.
 *
 * SEVENTH (page 2, "Please only check ONE of the following" — the manner of
 * approval) is a real PDFRadioGroup, `Group13`, with 9 options Choice1-9
 * confirmed via each widget's on-screen y-position matched to the 9 printed
 * checkbox rows top-to-bottom (see APPROVAL_MANNER_OPTIONS below for the
 * exact printed text of each). Choice9 ("Other manner not specified above")
 * is paired with a free-text field, `Text2`, positioned immediately after it
 * (this one field has 2 widget rects — a 2-line wrap of the same field, not
 * two different facts).
 *
 * EIGHTH ("check one" — creditor notice) is `Group14`, 2 options: Choice10
 * ("mailed to all known creditors on the following date", paired with date
 * field `Date4_af_date`) and Choice11 ("no known creditors").
 *
 * NINTH (dissolution effective date) is NOT a radio choice — it's a single
 * date field `Date5_af_date` for the optional future date (≤30 days after
 * filing); left blank means "effective upon the filing date," per the
 * form's own printed default.
 *
 * TENTH (optional additional provisions) is `Text6`, a single-line field
 * despite its large printed blank box (this revision's AcroForm simply
 * doesn't mark it multiline — not something this app can change without
 * drawing outside the real form's own field).
 *
 * Both CERTIFICATION signature blocks ("Attested by" / "Signed by") and the
 * "RESIDENT AGENT'S CONSENT" signature are PDFSignature fields, each with an
 * identically-positioned "_2" duplicate — none are filled, per this
 * module's standing rule of never filling a signature field on any
 * government form (see cra.ts/form8822b.ts). The one adjacent real text
 * field, "Line required only if an MD LLC or corp is the resident agent"
 * (+ "_2" duplicate), IS filled — it's the printed "Full Name & Title of
 * person signing" line used only when the resident agent itself is an MD
 * LLC or corporation (not a person), per the form's own instructions.
 */
import { loadTemplate, fillCopy, selectRadio, extractFlattenedPages } from "../../common/pdfForms";

/** SEVENTH's 9 checkbox options, verbatim from the printed form, top to bottom. */
export const MD_DISSOLUTION_APPROVAL_MANNERS = [
  "There is no stock outstanding or subscribed for; the dissolution was duly authorized by the incorporators before an organizational meeting of the directors.",
  "There is no stock outstanding or subscribed for; the dissolution was duly authorized by the directors after an organizational meeting of the directors.",
  "There is stock to be voted on (outstanding or subscribed for); the dissolution was duly authorized by the directors and stockholders.",
  "There is stock to be voted on (outstanding or subscribed for) registered as an open-end investment company under the Investment Company Act of 1940, dissolution duly authorized by the directors in the manner required under the Investment Company Act of 1940.",
  "The entity is a close corporation that has elected to have no board of directors; the dissolution was approved by the stockholders.",
  "The corporation is a nonstock corporation; the dissolution was duly authorized by the directors and members.",
  "The corporation is a nonstock corporation; the dissolution was duly authorized by the directors; there is no membership entitled to vote on the matter.",
  "The corporation is a religious corporation; the dissolution was duly authorized by the trustees and members.",
  "Other manner not specified above",
] as const;

const APPROVAL_MANNER_CHOICE: Record<(typeof MD_DISSOLUTION_APPROVAL_MANNERS)[number], string> = {
  [MD_DISSOLUTION_APPROVAL_MANNERS[0]]: "Choice1",
  [MD_DISSOLUTION_APPROVAL_MANNERS[1]]: "Choice2",
  [MD_DISSOLUTION_APPROVAL_MANNERS[2]]: "Choice3",
  [MD_DISSOLUTION_APPROVAL_MANNERS[3]]: "Choice4",
  [MD_DISSOLUTION_APPROVAL_MANNERS[4]]: "Choice5",
  [MD_DISSOLUTION_APPROVAL_MANNERS[5]]: "Choice6",
  [MD_DISSOLUTION_APPROVAL_MANNERS[6]]: "Choice7",
  [MD_DISSOLUTION_APPROVAL_MANNERS[7]]: "Choice8",
  [MD_DISSOLUTION_APPROVAL_MANNERS[8]]: "Choice9",
};

/** "Other manner not specified above" — the last option — is the only one paired with a free-text field (Text2). */
export const MD_DISSOLUTION_OTHER_MANNER = MD_DISSOLUTION_APPROVAL_MANNERS[8];

export interface MdDissolutionPerson {
  name: string;
  /** Single free-text line, per the form's own layout: "full name and address (including city, state & zip code)". */
  address: string;
}

export interface MdDissolutionData {
  /** FIRST. */
  corpName: string;
  /** SDAT ID# box — optional. */
  sdatId?: string;
  /** SECOND — the corporation's Maryland principal office address. */
  principalOfficeAddress: string;
  /** THIRD — full name of the resident agent serving for the 1-year wind-up period. */
  residentAgentName: string;
  /** FOURTH — that resident agent's Maryland address. */
  residentAgentAddress: string;
  /** FIFTH — up to 4 directors (or, for a religious corporation, at least 4 trustees per the form's own instruction). */
  directors: MdDissolutionPerson[];
  /** SIXTH — officers; at least President/Treasurer/Secretary are requested by the form to avoid rejection, even if the same person holds more than one role. */
  officers: {
    president?: MdDissolutionPerson;
    treasurer?: MdDissolutionPerson;
    secretary?: MdDissolutionPerson;
    other?: MdDissolutionPerson;
  };
  /** SEVENTH — manner of approval, one of the 9 canonical options above. */
  approvalManner: (typeof MD_DISSOLUTION_APPROVAL_MANNERS)[number];
  /** Only used when approvalManner is "Other manner not specified above". */
  otherMannerText?: string;
  /** EIGHTH — creditor notice. */
  creditorNotice: "Mailed to known creditors" | "No known creditors";
  /** Only used when creditorNotice is "Mailed to known creditors". Free-text date, form's own field format (MM/DD/YYYY). */
  creditorNoticeMailedDate?: string;
  /** NINTH — "immediate" (effective on filing date, the form's own default; leaves the date field blank) or a specific future date string (MM/DD/YYYY, must be ≤30 days after filing per the form's own instruction). */
  effectiveDate: "immediate" | string;
  /** TENTH — optional additional provisions. */
  additionalProvisions?: string;
  /**
   * CERTIFICATION signatures — informational only, NOT rendered onto the
   * PDF (see this file's header comment: both are PDFSignature fields).
   */
  attestedByName?: string;
  attestedByTitle?: string;
  signedByName?: string;
  signedByTitle?: string;
  /**
   * RESIDENT AGENT'S CONSENT — "Full Name & Title of person signing," only
   * needed when the resident agent itself is an MD LLC or corporation
   * rather than an individual (the form's own instruction on that line).
   */
  residentAgentConsentSignerName?: string;
}

export async function generateMdDissolution(data: MdDissolutionData): Promise<Uint8Array> {
  const doc = await loadTemplate("mddissolution.pdf");

  const directors = data.directors.slice(0, 4);
  const directorFields = ["", "_2", "_3", "_4"];

  const fieldMap: Record<string, string> = {
    corpName: "FIRST The full name of the corporation as listed in SDATs record is",
    sdatId: "SDAT ID if available",
    // Shifted per this file's header comment — see BUG IN THE PDF ITSELF.
    principalOfficeAddress: "THIRD The full name of the Maryland resident agent who shall serve for one year after",
    residentAgentName: "FOURTH The address including city state  zip code of the resident agent in Maryland is",
    // Deliberately does NOT also fill "...or_2" — live-rendering confirmed
    // that identically-positioned "_2" duplicate stacks a second copy of the
    // same text directly on top of this one, producing garbled overlapping
    // glyphs rather than two readable lines. Filling only the primary field
    // renders cleanly; the "_2" widget simply stays blank underneath it.
    residentAgentAddress: "FIFTH The full name and address including city state  zip code of each of the directors or",
    otherMannerText: "Text2",
    creditorNoticeMailedDate: "Date4_af_date",
    futureEffectiveDate: "Date5_af_date",
    additionalProvisions: "Text6",
    // Same identically-positioned-duplicate situation as residentAgentAddress
    // above — only the primary field is filled, not "..._2".
    residentAgentConsentSignerName: "Line required only if an MD LLC or corp is the resident agent",
  };
  const valueMap: Record<string, string> = {
    corpName: data.corpName,
    sdatId: data.sdatId || "",
    principalOfficeAddress: data.principalOfficeAddress,
    residentAgentName: data.residentAgentName,
    residentAgentAddress: data.residentAgentAddress,
    otherMannerText: data.approvalManner === MD_DISSOLUTION_OTHER_MANNER ? data.otherMannerText || "" : "",
    creditorNoticeMailedDate: data.creditorNotice === "Mailed to known creditors" ? data.creditorNoticeMailedDate || "" : "",
    futureEffectiveDate: data.effectiveDate === "immediate" ? "" : data.effectiveDate,
    additionalProvisions: data.additionalProvisions || "",
    residentAgentConsentSignerName: data.residentAgentConsentSignerName || "",
  };

  directors.forEach((d, i) => {
    const suffix = directorFields[i];
    fieldMap[`directorName${i}`] = `DirectorTrustee Name${suffix}`;
    fieldMap[`directorAddress${i}`] = `Address${suffix}`;
    valueMap[`directorName${i}`] = d.name;
    valueMap[`directorAddress${i}`] = d.address;
  });

  const officerRows: [MdDissolutionPerson | undefined, string, string][] = [
    [data.officers.president, "President Name", "Address_5"],
    [data.officers.treasurer, "Treasurer Name", "Address_6"],
    [data.officers.secretary, "Secretary Name", "Address_7"],
    [data.officers.other, "Other Officer Name", "Address_8"],
  ];
  officerRows.forEach(([person, nameField, addressField], i) => {
    if (!person) return;
    fieldMap[`officerName${i}`] = nameField;
    fieldMap[`officerAddress${i}`] = addressField;
    valueMap[`officerName${i}`] = person.name;
    valueMap[`officerAddress${i}`] = person.address;
  });

  fillCopy(doc, fieldMap, valueMap);

  selectRadio(doc, "Group13", APPROVAL_MANNER_CHOICE[data.approvalManner]);
  selectRadio(doc, "Group14", data.creditorNotice === "Mailed to known creditors" ? "Choice10" : "Choice11");

  return extractFlattenedPages(doc, [0, 1]);
}
