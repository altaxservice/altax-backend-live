/**
 * Fills the IRS's own real fillable Form W-4 (Employee's Withholding
 * Certificate) — the same overlay-onto-a-real-government-form pattern
 * already used for W-2/1099/940/941/1096 (see src/common/pdfForms.ts) and
 * Forms 2848/8821/MD 548 (see src/modules/poaForms/poaForms.service.ts),
 * never a firm-drawn substitute.
 *
 * Only the front page (page 1 of 5) is filled and returned. The other four
 * pages of the official PDF are: page 2, general instructions; page 3, the
 * Multiple Jobs Worksheet (Step 2(b)); page 4, the Deductions Worksheet
 * (Step 4(b)) plus the Privacy Act notice; page 5, blank. Pages 3-4 are
 * optional worksheets an employee fills out for themselves to arrive at a
 * dollar figure that then goes on page 1 (Step 4(c) / Step 4(b)) — the IRS
 * explicitly tells filers to use its online estimator at irs.gov/W4App for
 * that math instead, and the worksheets aren't part of what's filed with
 * the employer. Page 1 is the only page an employee actually submits.
 *
 * Field names were confirmed the way poaForms.service.ts's doc comment
 * describes, methodology (b): unlike Form 8821/548, none of this form's
 * AcroForm fields carry /TU tooltip text (checked directly — every field
 * returned null), so every text field was filled with its own field name
 * and the result rendered via `qlmanage -t` and visually compared against
 * the blank form to confirm placement. For the Step 1(c) filing-status
 * question (methodology (c)): pdf-lib reports c1_1[0]/c1_1[1]/c1_1[2] as
 * three independent PDFCheckBox fields (not a single PDFRadioGroup) sharing
 * one base name — the PDF does not enforce mutual exclusivity the way a
 * true radio group would. Their widget rects (y=625.97, 613.97, 602.22 —
 * top to bottom) confirmed which checkbox is which after each was checked
 * individually and re-rendered: c1_1[0] = "Single or Married filing
 * separately", c1_1[1] = "Married filing jointly or Qualifying surviving
 * spouse", c1_1[2] = "Head of household". Because they're independent
 * checkboxes, only the one matching the caller's filingStatus is ever
 * checked here — nothing enforces exclusivity except this code.
 *
 * Step 2 (Multiple Jobs or Spouse Works) really is just a single checkbox
 * on page 1 (c1_2[0], "If there are only two jobs total, you may check
 * this box") — confirmed by rendering. The worksheet-driven alternative
 * (Step 2(b), page 3) is deliberately not implemented; per the form's own
 * instructions an employee with a more complex multiple-jobs situation
 * should use the IRS's online estimator instead.
 *
 * Step 3 (Claim Dependents) has three real fillable amount fields on page
 * 1: f1_06 (3(a), qualifying children x $2,000 — the 2026 revision of the
 * form prints $2,200 per current law, but the field itself just holds
 * whatever dollar amount the caller supplies), f1_07 (3(b), other
 * dependents x $500), and f1_08 (line 3, the total) — the form does NOT
 * auto-sum 3(a)+3(b); line 3 is its own fillable field the filer (or this
 * generator) must total independently. All three are supported here.
 *
 * Also discovered but deliberately NOT implemented: c1_3[0] is a fourth
 * checkbox, "Exempt from withholding" ("I claim exemption from withholding
 * for 2026, and I certify that I meet both of the conditions for
 * exemption..."), positioned between Step 4 and Step 5. It wasn't in this
 * module's requested scope (exemption is a distinct, comparatively rare
 * filing situation with its own certification language) and is left
 * unchecked/unfilled.
 *
 * Deliberately does NOT fill the employee's signature or date. The form
 * itself says "This form is not valid unless you sign it" — neither field
 * exists as an AcroForm field on the official PDF at all (there is nothing
 * to fill even if we wanted to), so leaving them untouched is both the
 * correct behavior and the only possible one. The printed page is always
 * ready for a real pen signature at the moment the employee actually signs.
 */
import { loadTemplate, fillCopy, checkBox, extractFlattenedPages } from "../../common/pdfForms";

export interface W4Data {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  ssn?: string;
  /** Must be one of W4_FILING_STATUSES (exact wording from the real form's Step 1(c)). */
  filingStatus: string;
  /** Step 2(c) checkbox — "If there are only two jobs total, you may check this box." */
  multipleJobsCheckbox?: boolean;
  /** Step 3(a), dollar amount (qualifying children under 17 x the per-child amount printed on the form). */
  qualifyingChildrenAmount?: string;
  /** Step 3(b), dollar amount (other dependents x $500). */
  otherDependentsAmount?: string;
  /** Step 4(a) — other income not from jobs. */
  otherIncome?: string;
  /** Step 4(b) — deductions (from the Deductions Worksheet on page 4, entered here as a total). */
  deductions?: string;
  /** Step 4(c) — extra withholding per pay period. */
  extraWithholding?: string;
  employerName?: string;
  employerAddress?: string;
  firstDateOfEmployment?: string;
  employerEin?: string;
}

/** Step 1(c) filing-status options — exact wording as printed on the real form. */
export const W4_FILING_STATUSES = [
  "Single or Married filing separately",
  "Married filing jointly or Qualifying surviving spouse",
  "Head of household",
];

/** Maps each Step 1(c) option to its confirmed AcroForm checkbox path (see module doc comment). */
const FILING_STATUS_FIELD: Record<string, string> = {
  "Single or Married filing separately": "c1_1[0]",
  "Married filing jointly or Qualifying surviving spouse": "c1_1[1]",
  "Head of household": "c1_1[2]",
};

export async function generateW4(data: W4Data): Promise<Uint8Array> {
  const doc = await loadTemplate("fw4.pdf");
  const P = "topmostSubform[0].Page1[0]";

  // Step 1 — Personal Information
  fillCopy(doc, {
    firstName: `${P}.Step1a[0].f1_01[0]`,
    lastName: `${P}.Step1a[0].f1_02[0]`,
    address: `${P}.Step1a[0].f1_03[0]`,
    cityStateZip: `${P}.Step1a[0].f1_04[0]`,
    ssn: `${P}.f1_05[0]`,
  }, {
    firstName: data.firstName,
    lastName: data.lastName,
    address: data.address,
    cityStateZip: [data.city, [data.state, data.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    ssn: data.ssn || "",
  });

  // Step 1(c) — filing status (independent checkboxes, not a PDFRadioGroup; see doc comment)
  const statusField = FILING_STATUS_FIELD[data.filingStatus];
  if (statusField) checkBox(doc, `${P}.${statusField}`);

  // Step 2 — Multiple Jobs or Spouse Works (single checkbox; worksheet path not implemented)
  if (data.multipleJobsCheckbox) checkBox(doc, `${P}.c1_2[0]`);

  // Step 3 — Claim Dependents
  fillCopy(doc, {
    children: `${P}.Step3_ReadOrder[0].f1_06[0]`,
    otherDependents: `${P}.Step3_ReadOrder[0].f1_07[0]`,
    total: `${P}.f1_08[0]`,
  }, {
    children: data.qualifyingChildrenAmount || "",
    otherDependents: data.otherDependentsAmount || "",
    total: money2Sum(data.qualifyingChildrenAmount, data.otherDependentsAmount),
  });

  // Step 4 — Other Adjustments (optional)
  fillCopy(doc, {
    otherIncome: `${P}.f1_09[0]`,
    deductions: `${P}.f1_10[0]`,
    extraWithholding: `${P}.f1_11[0]`,
  }, {
    otherIncome: data.otherIncome || "",
    deductions: data.deductions || "",
    extraWithholding: data.extraWithholding || "",
  });

  // Step 5 — Sign Here: deliberately left blank (no AcroForm field exists for
  // signature/date on the official PDF; see module doc comment).

  // Employers Only
  fillCopy(doc, {
    employer: `${P}.f1_12[0]`,
    firstDate: `${P}.f1_13[0]`,
    ein: `${P}.f1_14[0]`,
  }, {
    employer: [data.employerName, data.employerAddress].filter(Boolean).join("\n"),
    firstDate: data.firstDateOfEmployment || "",
    ein: data.employerEin || "",
  });

  return extractFlattenedPages(doc, [0]);
}

/** Sums Step 3(a) + 3(b) into line 3's own fillable total field — the form does not auto-total these. */
function money2Sum(a?: string, b?: string): string {
  const na = Number(a);
  const nb = Number(b);
  const sum = (Number.isFinite(na) ? na : 0) + (Number.isFinite(nb) ? nb : 0);
  return sum > 0 ? String(sum) : "";
}
