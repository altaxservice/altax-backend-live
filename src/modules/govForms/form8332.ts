/**
 * Fills the IRS's own real fillable PDF for Form 8332 (Release/Revocation of
 * Release of Claim to Exemption for Child by Custodial Parent) — same
 * overlay-onto-a-real-government-form pattern used for W-2/1099/940/941/1096
 * and Form 2848/8821/MD 548 (see src/common/pdfForms.ts and
 * src/modules/poaForms/poaForms.service.ts).
 *
 * Field names were confirmed the same way as the POA forms: (a) checked for
 * /TU tooltip text on every widget first (none present on this revision —
 * the IRS shipped this form with plain f1_1..f1_11 field names and no
 * tooltips); (b) filled every field with its own name and rendered the
 * result via `qlmanage -t` alongside the blank form, confirming visually
 * which box on the page each field lands in.
 *
 * IMPORTANT — this is the Rev. December 2025 template, downloaded fresh from
 * irs.gov, and it is laid out differently than older 8332 revisions people
 * may remember: "Name of noncustodial parent" and the noncustodial parent's
 * SSN are now a SINGLE header box at the very top of the page (above Part
 * I), not repeated inside each of the three parts. Only 11 fields exist on
 * the whole form:
 *   f1_1  Name of noncustodial parent               (header, whole form)
 *   f1_2  Noncustodial parent's SSN                  (header, whole form)
 *   f1_3  Part I  — Name(s) of qualifying child(ren)
 *   f1_4  Part I  — 2-digit tax year ("for the tax year 20__")
 *   f1_5  Part I  — Custodial parent's SSN
 *   f1_6  Part II — Name(s) of qualifying child(ren)
 *   f1_7  Part II — Tax year(s) ("for the tax year(s) ____", free text)
 *   f1_8  Part II — Custodial parent's SSN
 *   f1_9  Part III — Name(s) of qualifying child(ren)
 *   f1_10 Part III — Tax year(s) being revoked (free text)
 *   f1_11 Part III — Custodial parent's SSN
 * There is no fillable field for "Date" next to any of the three signature
 * lines on this revision — only the SSN box beside each signature line is a
 * real AcroForm field. That, together with the signature lines themselves,
 * is deliberately left blank (see below).
 *
 * Because the real form only has one noncustodial-parent name/SSN box for
 * the entire page (not one per part), this module's interface follows that
 * shape rather than repeating those fields under each part: one form
 * (physical page) is inherently "for" one noncustodial parent, whichever
 * combination of Parts I/II/III on it are filled in.
 *
 * Deliberately does NOT fill any signature field. A typed name in a
 * signature field is not a legal signature; this app only fills the
 * supporting print/text fields (child names, SSNs, tax years) and leaves
 * every "Signature of custodial parent..." line blank for a wet-ink
 * signature, exactly like the POA forms.
 */
import { loadTemplate, fillCopy, extractFlattenedPages } from "../../common/pdfForms";

export interface Form8332Part {
  /** Combined free-text, e.g. "Jane Doe, John Doe". */
  childNames: string;
  /**
   * Part II/III only: the tax year(s) text, e.g. "2027 through 2030" or
   * "All future years" (Part II), or the year(s) a prior release is being
   * revoked for (Part III). Ignored for Part I, which instead uses
   * `taxYear` below.
   */
  years?: string;
}

export interface Form8332PartI extends Pick<Form8332Part, "childNames"> {
  /**
   * The current tax year, printed after the form's preprinted "20__" (e.g.
   * pass "2026" or just "26" — either works, only the last 2 digits are
   * used since the field itself is only wide enough for 2 characters).
   */
  taxYear: string;
}

export interface Form8332Data {
  /**
   * Header box at the very top of the form, shared by whichever of the
   * three parts below are filled in — the real form has only one
   * "Name of noncustodial parent" / SSN box for the whole page, not one per
   * part (see module doc comment).
   */
  noncustodialParentName: string;
  noncustodialParentSsn?: string;
  /**
   * Custodial parent's SSN — printed in whichever part(s) are filled below
   * (each part has its own SSN box on the real form, but it's the same
   * custodial parent signing the one physical page, so one value here fills
   * every active part's box).
   */
  custodialParentSsn?: string;

  /** Part I — Release of Claim to Exemption for Current Year. Omit if this filing isn't releasing the current year. */
  partI?: Form8332PartI;
  /** Part II — Release of Claim to Exemption for Future Years. Omit if this filing isn't releasing future years. */
  partII?: Form8332Part;
  /** Part III — Revocation of Release of Claim to Exemption for Future Year(s). Omit if this filing isn't revoking a prior release. */
  partIII?: Form8332Part;
}

function twoDigitYear(input: string): string {
  const digits = input.replace(/\D/g, "");
  return digits.length >= 2 ? digits.slice(-2) : digits;
}

export async function generateForm8332(data: Form8332Data): Promise<Uint8Array> {
  const doc = await loadTemplate("f8332.pdf");
  const P = "topmostSubform[0].Page1[0]";

  fillCopy(
    doc,
    { name: `${P}.f1_1[0]`, ssn: `${P}.f1_2[0]` },
    { name: data.noncustodialParentName, ssn: data.noncustodialParentSsn || "" }
  );

  if (data.partI) {
    fillCopy(
      doc,
      { child: `${P}.f1_3[0]`, year: `${P}.f1_4[0]`, custodialSsn: `${P}.f1_5[0]` },
      {
        child: data.partI.childNames,
        year: twoDigitYear(data.partI.taxYear),
        custodialSsn: data.custodialParentSsn || "",
      }
    );
  }

  if (data.partII) {
    fillCopy(
      doc,
      { child: `${P}.f1_6[0]`, years: `${P}.f1_7[0]`, custodialSsn: `${P}.f1_8[0]` },
      {
        child: data.partII.childNames,
        years: data.partII.years || "",
        custodialSsn: data.custodialParentSsn || "",
      }
    );
  }

  if (data.partIII) {
    fillCopy(
      doc,
      { child: `${P}.f1_9[0]`, years: `${P}.f1_10[0]`, custodialSsn: `${P}.f1_11[0]` },
      {
        child: data.partIII.childNames,
        years: data.partIII.years || "",
        custodialSsn: data.custodialParentSsn || "",
      }
    );
  }

  return extractFlattenedPages(doc, [0]);
}
