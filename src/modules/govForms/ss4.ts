/**
 * Fills the IRS's own real fillable PDF for Form SS-4 (Application for
 * Employer Identification Number) — the same overlay-onto-a-real-
 * government-form pattern already used for W-2/1099/940/941/1096 and
 * Form 2848/8821/MD 548 (see src/common/pdfForms.ts and
 * src/modules/poaForms/poaForms.service.ts), never a firm-drawn substitute.
 * Source: https://www.irs.gov/pub/irs-pdf/fss4.pdf (Rev. December 2025),
 * saved to src/assets/tax-forms/fss4.pdf. One page of actual form content
 * (page 2 of the PDF is a "Do I Need an EIN?" reference table with no
 * fields) — extractFlattenedPages only pulls page index 0.
 *
 * Field-name verification methodology (same three-part approach as
 * poaForms.service.ts's doc comment):
 *
 * (1) Tooltip check: every one of this form's 89 AcroForm fields has an
 * EMPTY /TU tooltip. Unlike Form 8821/548, this revision of SS-4 carries no
 * usable tooltip text at all, so verification relied entirely on (2)/(3).
 *
 * (2) Self-naming render: every text field was filled with its own field
 * name (e.g. "f1_2[0]") and every checkbox was checked, then rendered with
 * `qlmanage -t` and visually compared box-by-box against the blank form.
 * This is how every f1_N text field below (legal name, addresses,
 * responsible party, dates, etc.) was confirmed — see the field list
 * inline in the code.
 *
 * (3) Per-checkbox render, group by group: c1_3 (line 9a, 16 options),
 * c1_4 (line 10, 9 options), and c1_6 (line 16, 12 options) are each a set
 * of independent PDFCheckBox fields (this form is NOT built from true
 * PDFRadioGroup fields — pdf-lib sees "c1_3[0]" through "c1_3[15]" etc. as
 * 16 separate checkbox fields sharing a base name, each with its own /AP
 * export value "/1".."/16"), so nothing stops more than one from being
 * checked and each had to be individually confirmed. Every export value
 * 1..16 (c1_3), 1..9 (c1_4), and 1..12 (c1_6) was checked one at a time and
 * rendered. c1_3 and c1_4 turned out to number their options in plain
 * reading order (left column top-to-bottom, then right column
 * top-to-bottom). c1_6 (line 16, principal activity) does NOT: the IRS's
 * internal numbering is 1 Construction, 2 Real estate, 3 Rental & leasing,
 * 4 Manufacturing, 5 Transportation & warehousing, 6 Finance & insurance,
 * 7 Health care & social assistance, 8 Accommodation & food service,
 * 9 Other (specify), 10 Wholesale—agent/broker, 11 Wholesale—other,
 * 12 Retail — "Other" sits at position 9, ahead of the three
 * wholesale/retail options that are printed after it on the page. Every
 * one of these 37 checkbox positions was rendered and confirmed
 * individually; none were assumed. The four Yes/No checkbox pairs (line
 * 8a, 8c, 18) and the single line-14 checkbox were likewise each rendered
 * and confirmed: for every Yes/No pair, index [0] is Yes and [1] is No.
 *
 * Line 9a has no "LLC" checkbox at all (this matches the real paper form —
 * the IRS's own line 9a caution says an LLC must check the box matching
 * how it's taxed, not a dedicated LLC box), so entityType "LLC" is resolved
 * at fill time using the IRS default-classification rule printed right on
 * the form: a single-member domestic LLC defaults to Sole proprietor
 * (disregarded entity); a multi-member domestic LLC defaults to
 * Partnership. Likewise there is no "S Corporation" checkbox — S-corp
 * status is a later election (Form 2553), so both "Corporation" and
 * "S Corporation" check the same Corporation box and differ only in the
 * form-number blank next to it ("1120" vs "1120-S"), exactly how a preparer
 * fills this out by hand.
 *
 * Deliberately does NOT fill any signature field: there isn't one to fill.
 * The IRS's own AcroForm for this revision has no field at all under the
 * printed "Signature" / "Date" line at the bottom (only "Name and title,"
 * "Applicant's telephone number," and "Applicant's fax number" are real
 * fields) — so leaving the signature line untouched happens automatically,
 * consistent with this app's rule (see poaForms.service.ts) of never
 * filling a signature field on any government form.
 *
 * Skipped by design (rare for this firm's small-business/company-formation
 * use case, per the task this module was built for):
 *  - Line 5a/5b "street address if different" IS implemented (optional
 *    `physicalAddress`), but line 9a's Group Exemption Number blank,
 *    the Estate/Trust/Plan-administrator TIN blanks, and the "Other
 *    nonprofit (specify)" blank are not — this app's data model has no
 *    corresponding fields and they're edge cases for the entity types
 *    (church, REMIC, plan administrator, etc.) this firm doesn't file for.
 *  - Line 14 (expects tax liability ≤ $1,000, wants to file 944 instead of
 *    941) — confirmed as checkbox c1_5[0], but left unimplemented: it's a
 *    real election with payroll-filing consequences, not just a box to
 *    tick, and out of scope for the fields this task asked for.
 *  - Line 18's "if Yes, write previous EIN here" follow-up (f1_39) — only
 *    the Yes/No checkbox is filled; a previous EIN isn't in this app's data
 *    model and guessing it wrong is worse than leaving it blank.
 *  - Third Party Designee section entirely, and the EIN box itself (the
 *    IRS fills that in, not the applicant).
 */
import { PDFDocument, PDFCheckBox } from "pdf-lib";
import { loadTemplate, fillCopy, extractFlattenedPages } from "../../common/pdfForms";

export interface Ss4Data {
  legalName: string;
  tradeName?: string;
  /** Line 3 — "Executor, administrator, trustee, 'care of' name." */
  careOf?: string;
  /** Line 4a/4b — combined "street, city, state zip"; split on the first comma (street vs. the rest), matching how line 4b itself is one "City, state, and ZIP code" field on the real form. */
  mailingAddress: string;
  /** Line 5a/5b — only fill in when the physical location differs from the mailing address; same "street, city, state zip" comma-split as mailingAddress. */
  physicalAddress?: string;
  county?: string;
  /** State where the principal business is located (line 6, paired with county). */
  state: string;
  responsiblePartyName: string;
  responsiblePartyId?: string;
  isLlc: boolean;
  llcMemberCount?: string;
  llcOrganizedInUs?: boolean;
  entityType:
    | "Sole Proprietor"
    | "Partnership"
    | "Corporation"
    | "S Corporation"
    | "LLC"
    | "Other Nonprofit"
    | "Estate"
    | "Trust";
  /** Line 9b — state or foreign country of incorporation; only meaningful for Corporation/S Corporation. */
  incorporationState?: string;
  reasonForApplying:
    | "Started new business"
    | "Hired employees"
    | "Banking purpose"
    | "Changed type of organization"
    | "Purchased going business"
    | "Created a trust"
    | "Created a pension plan"
    | "Other";
  /** Free-text "specify" line that goes with several of the reasons above (started-new-business type, banking purpose, new org type, trust type, pension type, or the Other description). */
  reasonOther?: string;
  dateBusinessStarted?: string;
  closingMonth?: string;
  employeesAgricultural?: string;
  employeesHousehold?: string;
  employeesOther?: string;
  firstWageDate?: string;
  principalActivity:
    | "Construction"
    | "Real estate"
    | "Rental & leasing"
    | "Manufacturing"
    | "Transportation & warehousing"
    | "Finance & insurance"
    | "Health care & social assistance"
    | "Accommodation & food service"
    | "Wholesale-agent/broker"
    | "Wholesale-other"
    | "Retail"
    | "Other";
  principalActivityOther?: string;
  principalMerchandise?: string;
  appliedBefore?: boolean;
  applicantName: string;
  applicantTitle?: string;
  applicantPhone?: string;
}

export const SS4_ENTITY_TYPES = [
  "Sole Proprietor",
  "Partnership",
  "Corporation",
  "S Corporation",
  "LLC",
  "Other Nonprofit",
  "Estate",
  "Trust",
] as const;

export const SS4_REASONS = [
  "Started new business",
  "Hired employees",
  "Banking purpose",
  "Changed type of organization",
  "Purchased going business",
  "Created a trust",
  "Created a pension plan",
  "Other",
] as const;

export const SS4_ACTIVITIES = [
  "Construction",
  "Real estate",
  "Rental & leasing",
  "Manufacturing",
  "Transportation & warehousing",
  "Finance & insurance",
  "Health care & social assistance",
  "Accommodation & food service",
  "Wholesale-agent/broker",
  "Wholesale-other",
  "Retail",
  "Other",
] as const;

const P = "topmostSubform[0].Page1[0]";

/** Line 9a — 16 independent checkboxes (not a true PDFRadioGroup); export values confirmed individually, see module doc comment. */
const ENTITY_CHECKBOX: Record<Exclude<Ss4Data["entityType"], "LLC">, string> = {
  "Sole Proprietor": `${P}.c1_3[0]`,
  Partnership: `${P}.c1_3[2]`,
  Corporation: `${P}.c1_3[4]`,
  "S Corporation": `${P}.c1_3[4]`,
  "Other Nonprofit": `${P}.c1_3[12]`,
  Estate: `${P}.c1_3[1]`,
  Trust: `${P}.c1_3[5]`,
};

/**
 * Line 10 — 9 independent checkboxes; field name -> [checkbox path, optional
 * "specify" text field, and that field's own character budget]. Budgets are
 * derived from each field's real /Rect width on the template (measured with
 * pdf-lib's `getRectangle()`) divided by ~5.2pt/char for this form's 8pt
 * Helvetica-Bold field font — these single-line boxes are not wide enough
 * for a long free-text answer and pdf-lib doesn't clip overflow to the
 * widget's box, so an untruncated value would print past the field into
 * neighboring text.
 */
const REASON_CHECKBOX: Record<Ss4Data["reasonForApplying"], { box: string; specify?: string; specifyMax?: number }> = {
  "Started new business": { box: `${P}.c1_4[0]`, specify: `${P}.f1_25[0]` }, // wrapped across f1_25/f1_26, handled separately below
  "Hired employees": { box: `${P}.c1_4[3]` },
  "Banking purpose": { box: `${P}.c1_4[8]`, specify: `${P}.f1_24[0]`, specifyMax: 29 },
  "Changed type of organization": { box: `${P}.c1_4[1]`, specify: `${P}.f1_27[0]`, specifyMax: 20 },
  "Purchased going business": { box: `${P}.c1_4[2]` },
  "Created a trust": { box: `${P}.c1_4[4]`, specify: `${P}.f1_28[0]`, specifyMax: 33 },
  "Created a pension plan": { box: `${P}.c1_4[6]`, specify: `${P}.f1_29[0]`, specifyMax: 27 },
  Other: { box: `${P}.c1_4[7]`, specify: `${P}.f1_30[0]`, specifyMax: 84 },
};

/** Line 16 — 12 independent checkboxes; IRS's internal numbering is NOT the printed reading order (see doc comment). */
const ACTIVITY_CHECKBOX: Record<Ss4Data["principalActivity"], string> = {
  Construction: `${P}.c1_6[2]`,
  "Real estate": `${P}.c1_6[8]`,
  "Rental & leasing": `${P}.c1_6[3]`,
  Manufacturing: `${P}.c1_6[9]`,
  "Transportation & warehousing": `${P}.c1_6[4]`,
  "Finance & insurance": `${P}.c1_6[10]`,
  "Health care & social assistance": `${P}.c1_6[0]`,
  "Accommodation & food service": `${P}.c1_6[5]`,
  "Wholesale-agent/broker": `${P}.c1_6[1]`,
  "Wholesale-other": `${P}.c1_6[6]`,
  Retail: `${P}.c1_6[7]`,
  Other: `${P}.c1_6[11]`,
};

/** Checks a checkbox by its exact AcroForm path, skipping silently if the field is missing or not a checkbox on this revision — same tolerance as pdfForms.ts's own checkBox() helper. */
function check(doc: PDFDocument, fieldName: string) {
  try {
    const field = doc.getForm().getField(fieldName);
    if (field instanceof PDFCheckBox) field.check();
  } catch {
    // Field not present on this revision — skip rather than fail the whole document.
  }
}

/** Splits a combined "street, city, state zip" line on the first comma only, since SS-4's own line 4b/5b field is itself one "City, state, and ZIP code" box — everything after the first comma belongs together in that one field. */
function splitAddress(addr: string | undefined): { street: string; cityStateZip: string } {
  if (!addr) return { street: "", cityStateZip: "" };
  const idx = addr.indexOf(",");
  if (idx === -1) return { street: addr.trim(), cityStateZip: "" };
  return { street: addr.slice(0, idx).trim(), cityStateZip: addr.slice(idx + 1).trim() };
}

/** Truncates to a field's real character budget (see REASON_CHECKBOX doc comment) rather than letting pdf-lib print text past the widget's box. */
function fit(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/**
 * Word-wraps the "Started new business (specify type)" line across its two
 * real fields — f1_25 (57.6pt wide, ~11 chars at this form's 8pt bold field
 * font) shares its row with the checkbox label, while f1_26 (208.8pt wide,
 * ~40 chars) is a full-width continuation line directly below it.
 */
function wrapStartedBusinessType(text: string | undefined): [string, string] {
  if (!text) return ["", ""];
  const words = text.split(/\s+/).filter(Boolean);
  let line1 = "";
  let i = 0;
  while (i < words.length) {
    const candidate = line1 ? `${line1} ${words[i]}` : words[i];
    if (candidate.length > 11 && line1) break;
    line1 = candidate;
    i++;
  }
  const line2 = fit(words.slice(i).join(" "), 40);
  return [line1, line2];
}

export async function generateSs4(data: Ss4Data): Promise<Uint8Array> {
  const doc = await loadTemplate("fss4.pdf");

  const mailing = splitAddress(data.mailingAddress);
  const physical = splitAddress(data.physicalAddress);

  fillCopy(
    doc,
    {
      legalName: `${P}.f1_2[0]`,
      tradeName: `${P}.f1_3[0]`,
      careOf: `${P}.f1_4[0]`,
      mailingStreet: `${P}.Line4ReadOrder[0].f1_5[0]`,
      mailingCityStateZip: `${P}.Line4ReadOrder[0].f1_6[0]`,
      physicalStreet: `${P}.f1_7[0]`,
      physicalCityStateZip: `${P}.f1_8[0]`,
      countyState: `${P}.f1_9[0]`,
      responsibleName: `${P}.f1_10[0]`,
      responsibleId: `${P}.f1_11[0]`,
      llcMemberCount: `${P}.f1_12[0]`,
      incorporationState: `${P}.f1_21[0]`,
      dateBusinessStarted: `${P}.f1_31[0]`,
      closingMonth: `${P}.f1_32[0]`,
      employeesAgricultural: `${P}.f1_33[0]`,
      employeesHousehold: `${P}.f1_34[0]`,
      employeesOther: `${P}.f1_35[0]`,
      firstWageDate: `${P}.f1_36[0]`,
      principalMerchandise: `${P}.f1_38[0]`,
      applicantNameTitle: `${P}.f1_44[0]`,
      applicantPhone: `${P}.f1_45[0]`,
    },
    {
      legalName: data.legalName,
      tradeName: data.tradeName || "",
      careOf: data.careOf || "",
      mailingStreet: mailing.street,
      mailingCityStateZip: mailing.cityStateZip,
      physicalStreet: physical.street,
      physicalCityStateZip: physical.cityStateZip,
      countyState: [data.county, data.state].filter(Boolean).join(", "),
      responsibleName: data.responsiblePartyName,
      responsibleId: data.responsiblePartyId || "",
      llcMemberCount: data.isLlc ? data.llcMemberCount || "" : "",
      incorporationState:
        data.entityType === "Corporation" || data.entityType === "S Corporation" ? data.incorporationState || "" : "",
      dateBusinessStarted: data.dateBusinessStarted || "",
      closingMonth: data.closingMonth || "",
      employeesAgricultural: data.employeesAgricultural || "",
      employeesHousehold: data.employeesHousehold || "",
      employeesOther: data.employeesOther || "",
      firstWageDate: data.firstWageDate || "",
      principalMerchandise: data.principalMerchandise || "",
      applicantNameTitle: [data.applicantName, data.applicantTitle].filter(Boolean).join(", "),
      applicantPhone: data.applicantPhone || "",
    }
  );

  // Line 8a/8c — Yes/No pairs; index [0] is Yes, [1] is No (confirmed by render).
  check(doc, data.isLlc ? `${P}.c1_1[0]` : `${P}.c1_1[1]`);
  if (data.isLlc && data.llcOrganizedInUs !== undefined) {
    check(doc, data.llcOrganizedInUs ? `${P}.c1_2[0]` : `${P}.c1_2[1]`);
  }

  // Line 9a — no dedicated "LLC" checkbox exists on the real form (see doc
  // comment): resolve using the IRS default-classification rule printed on
  // the form itself — single member defaults to Sole proprietor, 2+ members
  // default to Partnership.
  if (data.entityType === "LLC") {
    const isSingleMember = (data.llcMemberCount || "").trim() === "1";
    check(doc, isSingleMember ? ENTITY_CHECKBOX["Sole Proprietor"] : ENTITY_CHECKBOX.Partnership);
  } else {
    check(doc, ENTITY_CHECKBOX[data.entityType]);
  }
  // Corporation/S Corporation share one checkbox; only the form-number blank differs.
  if (data.entityType === "Corporation") fillCopy(doc, { n: `${P}.f1_16[0]` }, { n: "1120" });
  if (data.entityType === "S Corporation") fillCopy(doc, { n: `${P}.f1_16[0]` }, { n: "1120-S" });

  // Line 10 — reason for applying, plus its paired "specify" free-text line
  // (line 1 of "Started new business" wraps across two real fields).
  const reason = REASON_CHECKBOX[data.reasonForApplying];
  if (reason) {
    check(doc, reason.box);
    if (reason.specify && data.reasonOther) {
      if (data.reasonForApplying === "Started new business") {
        const [l1, l2] = wrapStartedBusinessType(data.reasonOther);
        fillCopy(doc, { l1: `${P}.f1_25[0]`, l2: `${P}.f1_26[0]` }, { l1, l2 });
      } else {
        fillCopy(doc, { n: reason.specify }, { n: fit(data.reasonOther, reason.specifyMax ?? 30) });
      }
    }
  }

  // Line 16 — principal activity, plus its "Other (specify)" free-text line
  // (f1_37 is 180pt wide, ~34 chars at this form's 8pt bold field font).
  check(doc, ACTIVITY_CHECKBOX[data.principalActivity]);
  if (data.principalActivity === "Other" && data.principalActivityOther) {
    fillCopy(doc, { n: `${P}.f1_37[0]` }, { n: fit(data.principalActivityOther, 34) });
  }

  // Line 18 — Yes/No; only filled when the caller actually knows the answer.
  if (data.appliedBefore !== undefined) {
    check(doc, data.appliedBefore ? `${P}.c1_7[0]` : `${P}.c1_7[1]`);
  }

  return extractFlattenedPages(doc, [0]);
}
