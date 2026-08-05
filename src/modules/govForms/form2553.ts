/**
 * Fills the IRS's own real fillable PDF for Form 2553 (Election by a Small
 * Business Corporation — the S-Corp election), same overlay-onto-a-real-
 * government-form pattern used for W-2/1099/940/941/1096 and Form
 * 2848/8821/MD 548 (see src/common/pdfForms.ts and
 * src/modules/poaForms/poaForms.service.ts).
 *
 * Downloaded fresh from https://www.irs.gov/pub/irs-pdf/f2553.pdf (Rev.
 * December 2017, the current revision as of this writing — 123,289 bytes,
 * verified against the server's content-length header so it isn't a
 * truncated fetch). It is a 4-page, 100-field AcroForm with no /TU tooltip
 * text anywhere (same situation as Form 8832 — the IRS shipped this one with
 * plain f1_NN/f2_NN/c1_N-style names and no tooltips), so every field below
 * was confirmed the harder way: filled with its own field name (or, for the
 * shareholder table, a row-distinguishing test string), rendered via
 * `qlmanage -t -s 1700`, and read back as an image to visually confirm which
 * box on the page it lands in. Confirmed twice over: once via the
 * name-echo render, and a second time by checking one checkbox in each
 * checkbox group (D's "name" box, F's "Fiscal year ending" option, and G)
 * simultaneously and confirming all three landed in their correct boxes with
 * nothing checked elsewhere.
 *
 * Field map (Part I, Election Information — page 1, all under
 * "topmostSubform[0].Page1[0]."):
 *   NameAddress[0].f1_01[0]  Corporation's name
 *   NameAddress[0].f1_02[0]  Number, street, room/suite
 *   NameAddress[0].f1_03[0]  City or town, state, ZIP
 *   f1_04[0]                 A. Employer identification number
 *   f1_05[0]                 B. Date incorporated
 *   f1_06[0]                 C. State of incorporation
 *   c1_1[0] / c1_2[0]        D. Changed name / changed address since EIN (checkboxes — NOT implemented, see below)
 *   f1_07[0]                 E. Election effective date (tax year beginning)
 *   c1_3[0]                  F(1). Calendar year
 *   c1_3[1]                  F(2). Fiscal year ending (month and day)
 *   f1_08[0]                 F(2). the month/day value itself
 *   c1_3[2] / c1_3[3]        F(3)/F(4). 52-53-week year options (NOT implemented, see below)
 *   f1_09[0]                 F(4). reference month for 52-53-week option (NOT implemented)
 *   c1_4[0]                  G. >100 shareholders / family-as-one-shareholder box (NOT implemented, see below)
 *   f1_10[0]                 H. Name and title of officer/legal rep the IRS may call
 *   f1_11[0]                 H. That person's telephone number
 *   f1_12[0]..f1_20[0]       I. Nine blank lines for late-election reasonable-cause explanation (NOT implemented, see below)
 *   f1_21[0]                 Sign Here: Title (of the officer signing)
 * "Signature of officer" and "Date" on the Sign Here row have NO underlying
 * AcroForm field at all on this revision — confirmed by rendering the
 * name-echoed copy and finding no field label drawn on either line — so
 * there's nothing to deliberately skip there; a pen is the only way to fill
 * either.
 *
 * Field map (shareholder consent table — page 2, under
 * "topmostSubform[0].Page2[0]."):
 *   f2_01[0] / f2_02[0]   Repeated header: corporation name / EIN
 *   Table_Part1[0].Row{n}[0].f2_XX[0]  Per-shareholder row, n = 1..7 on the
 *     real page (this module exposes the first 4, matching the 4-representative
 *     cap already used for Form 2848). Unlike 2848's RepresentativesName1..4
 *     naming, this table's field numbers are NOT a fixed suffix per row —
 *     they simply increment by 7 across 7 columns per row (row 1 = f2_03..f2_09,
 *     row 2 = f2_10..f2_16, row 3 = f2_17..f2_23, row 4 = f2_24..f2_30, and so
 *     on through row 7 = f2_45..f2_51). Confirmed by filling row 1 and row 2
 *     with distinct test strings and rendering: row 1's text landed only in
 *     row 1's cells, row 2's only in row 2's, with no bleed into the shared
 *     header or the row above/below. Within each row the 7 columns are, in
 *     field-number order:
 *       +0  J. Shareholder's name and address
 *       +1  K. Signature                (blank — see below)
 *       +2  K. Date (of that signature) (blank — see below)
 *       +3  L. Number of shares or percentage of ownership
 *       +4  L. Date(s) acquired
 *       +5  M. Social security number or EIN
 *       +6  N. Shareholder's tax year ends (month and day)
 *
 * Deliberately does NOT fill any signature field, on either page. A typed
 * name in a signature field is not a legal signature; this app only fills
 * the supporting print/text fields and leaves every signature line —
 * including each shareholder's individual consent signature on page 2 —
 * blank for a wet-ink signature, exactly like the POA forms and Form 8832.
 * The shareholder consent table's own "Date" column (K) is the date that
 * shareholder physically signed, which by definition isn't known until they
 * do, so it's left blank alongside the signature next to it rather than
 * guessed at.
 *
 * Deliberately NOT implemented (all confirmed present on the real form but
 * out of scope per the task this module was built for):
 *   - Part II (page 3, fiscal year selection) — only needed for a
 *     non-calendar-year election going through the natural-business-year /
 *     ownership-tax-year / business-purpose / section 444 approval process;
 *     this module supports the common "Calendar year" and simple "Fiscal
 *     year ending [month/day]" cases directly on Part I's item F without
 *     needing Part II at all.
 *   - Part III (page 4 top, Qualified Subchapter S Trust election) — only
 *     for QSST elections, a distinct and comparatively rare shareholder
 *     structure.
 *   - Part IV (page 4 bottom, late corporate classification election
 *     representations) — only applies to LLCs making a late entity
 *     classification election concurrently with a late S-corp election.
 *   - Item D's "changed name or address since applying for EIN" checkboxes
 *     and item I's late-election reasonable-cause explanation lines — both
 *     genuinely rare/optional per the task, and adding them would require
 *     either more optional interface fields wired to a single-purpose
 *     checkbox pair or the same multi-line word-wrap machinery
 *     poaForms.service.ts uses for its notes fields, for a part of the form
 *     most filings leave untouched.
 *   - Item G's >100-shareholders-as-one-family checkbox — a narrow edge case
 *     (S corps can have up to 100 shareholders; this only matters once a
 *     filer is exactly at that boundary and relying on family attribution).
 *   - The two 52-53-week tax year options (F(3)/F(4)) — per the task, only
 *     "Calendar year" and "Fiscal year ending" are required; adding the
 *     52-53-week variant would mean a third FORM2553_TAX_YEAR_TYPES value
 *     plus the F(4) reference-month field for one specific, uncommon fiscal
 *     convention (F(3) doesn't even need a value — it's fixed to December).
 *
 * Because only Part I and the shareholder table are filled, and both live
 * entirely on pages 1-2 (confirmed: page 3 is Part II, page 4 is Part III +
 * Part IV), only those two pages are extracted into the final document.
 */
import { loadTemplate, fillCopy, checkBox, extractFlattenedPages } from "../../common/pdfForms";

export interface Form2553Shareholder {
  name: string;
  address: string;
  idNumber?: string; // SSN or EIN
  sharesOwned?: string;
  dateAcquired?: string;
  taxYearEnd?: string; // shareholder's own tax year end, month/day
}

export interface Form2553Data {
  corporationName: string;
  corporationAddress: string;
  ein?: string;
  dateIncorporated?: string;
  stateIncorporated?: string;
  electionEffectiveDate?: string;
  taxYearType: string; // "Calendar Year" | "Fiscal Year" — see FORM2553_TAX_YEAR_TYPES
  fiscalYearEndMonth?: string; // only used when taxYearType is "Fiscal Year"
  officerName: string;
  officerTitle?: string;
  officerPhone?: string;
  shareholders: Form2553Shareholder[];
}

/** Confirmed option list for item F, "Selected tax year" — see module doc comment for why the two 52-53-week options are omitted. */
export const FORM2553_TAX_YEAR_TYPES = ["Calendar Year", "Fiscal Year"];

/** The 7-column, per-row field-number layout of the shareholder table on page 2 (see module doc comment). */
const SHAREHOLDER_ROW_COLUMNS = ["name", "signature", "sigDate", "shares", "dateAcquired", "idNumber", "taxYearEnd"] as const;

/** Builds the exact page-2 field path for a given 1-based row and column offset (0 = name, 6 = tax year end). */
function shareholderField(row: number, columnOffset: number): string {
  const fieldNumber = 3 + 7 * (row - 1) + columnOffset;
  const padded = String(fieldNumber).padStart(2, "0");
  return `topmostSubform[0].Page2[0].Table_Part1[0].Row${row}[0].f2_${padded}[0]`;
}

export async function generateForm2553(data: Form2553Data): Promise<Uint8Array> {
  const doc = await loadTemplate("f2553.pdf");
  const P = "topmostSubform[0].Page1[0]";

  // Address is one field on this task's interface but two on the real form
  // (street, then city/state/ZIP combined) — same naive first-comma split
  // poaForms.service.ts's MD 548 generator uses for its own single-line-in/
  // multi-field-out address case.
  const commaIdx = data.corporationAddress.indexOf(",");
  const street = commaIdx >= 0 ? data.corporationAddress.slice(0, commaIdx).trim() : data.corporationAddress;
  const cityStateZip = commaIdx >= 0 ? data.corporationAddress.slice(commaIdx + 1).trim() : "";

  fillCopy(
    doc,
    {
      name: `${P}.NameAddress[0].f1_01[0]`,
      street: `${P}.NameAddress[0].f1_02[0]`,
      cityStateZip: `${P}.NameAddress[0].f1_03[0]`,
      ein: `${P}.f1_04[0]`,
      dateIncorporated: `${P}.f1_05[0]`,
      stateIncorporated: `${P}.f1_06[0]`,
      electionEffectiveDate: `${P}.f1_07[0]`,
      fiscalYearEndMonth: `${P}.f1_08[0]`,
      officerNameTitle: `${P}.f1_10[0]`,
      officerPhone: `${P}.f1_11[0]`,
      signHereTitle: `${P}.f1_21[0]`,
    },
    {
      name: data.corporationName,
      street,
      cityStateZip,
      ein: data.ein || "",
      dateIncorporated: data.dateIncorporated || "",
      stateIncorporated: data.stateIncorporated || "",
      electionEffectiveDate: data.electionEffectiveDate || "",
      fiscalYearEndMonth: data.taxYearType === "Fiscal Year" ? data.fiscalYearEndMonth || "" : "",
      officerNameTitle: data.officerTitle ? `${data.officerName}, ${data.officerTitle}` : data.officerName,
      officerPhone: data.officerPhone || "",
      signHereTitle: data.officerTitle || "",
    }
  );

  // Item F: Selected tax year — mutually exclusive checkboxes, not a true
  // pdf-lib PDFRadioGroup on this form (each is its own independent
  // PDFCheckBox field), so only the matching one is ever checked.
  if (data.taxYearType === "Fiscal Year") {
    checkBox(doc, `${P}.c1_3[1]`);
  } else {
    checkBox(doc, `${P}.c1_3[0]`);
  }

  // Shareholder consent table (page 2) — header repeats the corporation's
  // name/EIN, then up to 4 rows (of the 7 the real page has room for; see
  // module doc comment on why this module caps at 4, matching Form 2848's
  // representative cap).
  fillCopy(
    doc,
    { name: "topmostSubform[0].Page2[0].f2_01[0]", ein: "topmostSubform[0].Page2[0].f2_02[0]" },
    { name: data.corporationName, ein: data.ein || "" }
  );

  data.shareholders.slice(0, 4).forEach((shareholder, i) => {
    const row = i + 1;
    const fields: Record<string, string> = {};
    const values: Record<string, string> = {};
    SHAREHOLDER_ROW_COLUMNS.forEach((col, offset) => {
      // signature and sigDate deliberately left unfilled — see module doc comment.
      if (col === "signature" || col === "sigDate") return;
      fields[col] = shareholderField(row, offset);
    });
    values.name = `${shareholder.name}\n${shareholder.address}`;
    values.shares = shareholder.sharesOwned || "";
    values.dateAcquired = shareholder.dateAcquired || "";
    values.idNumber = shareholder.idNumber || "";
    values.taxYearEnd = shareholder.taxYearEnd || "";
    fillCopy(doc, fields, values);
  });

  return extractFlattenedPages(doc, [0, 1]);
}
