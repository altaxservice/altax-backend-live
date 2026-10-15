/**
 * Fills the Maryland Comptroller's own real fillable PDFs for the two "Final Return" notices a business sends when it permanently
 * closes or sells: Form MW506FR (Employer Withholding — Final Return, COM/RAD 046, rev. 07/25) and Form 202FR (Sales and Use Tax —
 * Final Return Form, COM/RAD 102, rev. 06/23). Same overlay-onto-the-agency's-own-form pattern as every other form in this module.
 *
 * Sources: the Comptroller's mw506fr.pdf and SUT202FR.pdf, saved to src/assets/tax-forms/mw506fr.pdf and sut202fr.pdf. Each is one
 * page; the instructions are printed under the signature line and carry no fields. Both forms ask for exactly the same eleven items
 * (FEIN, Central Registration Number, date permanently discontinued, name, street address, city/state/ZIP+4, purchaser if sold, date
 * sold, person completing, phone, email, signature), so one data shape serves both and the form type only picks the template.
 * The form itself says to send it WITH the final return (MW506 / MW506M, or the sales and use tax return), or to mail it
 * separately if the final return is filed electronically.
 *
 * Field-name verification: the MW506FR ships generic "Text Field N" names with no tooltips, so each was matched to its printed label by
 * comparing the widget's rectangle (pdf-lib) against the label positions from pdfjs-dist, top to bottom: 1 = line 1 FEIN, 2 = line 2
 * CRN, 3 = line 3 date discontinued, 4 = line 4 name, 5 = line 5 street, 6/7/8/9 = city / state / ZIP / +4 on the line below,
 * 10 = line 6 purchaser (multi-line), 13 = line 7 date sold, 14 = line 8 person completing, 16 = line 9 phone, 15 = line 10 email
 * (16 sits above 15 on the page even though 15 comes first by number). The 202FR's fields are named after their labels. Boxes cap
 * their own length (FEIN 9, CRN 8, state 2, ZIP 5, +4 4, MW506FR dates 10 characters), so numbers are written as digits only and
 * dates as MM/DD/YYYY. The signature line (11) has no field: it is signed by hand, never filled in by the app.
 */
import { StandardFonts, rgb } from "pdf-lib";
import { loadTemplate, fillCopy, extractFlattenedPages, sanitizePhone } from "../../common/pdfForms";
import { pdfSafeText } from "../../common/pdfText";

export interface MdFinalReturnData {
  /** Line 1 — 9 digits. */
  ein?: string;
  /** Line 2 — Maryland Central Registration Number (8 digits). */
  craNumber?: string;
  /** Line 3 — date the business permanently stopped (yyyy-mm-dd or MM/DD/YYYY). */
  dateDiscontinued?: string;
  /** Line 4. */
  businessName: string;
  /** Line 5. */
  street?: string;
  city?: string;
  state?: string;
  /** 5-digit ZIP. */
  zip?: string;
  /** The 4-digit ZIP+4 extension (optional). */
  zip4?: string;
  /** Line 6 — name and address of whoever bought the business, only if it was sold. */
  purchaser?: string;
  /** Line 7 — date sold, only if it was sold. */
  dateSold?: string;
  /** Line 8. */
  personCompleting?: string;
  /** Line 9. */
  phone?: string;
  /** Line 10. */
  email?: string;
}

const digits = (v: unknown, max: number) => String(v ?? "").replace(/\D/g, "").slice(0, max);

/** yyyy-mm-dd → MM/DD/YYYY; anything already typed another way is passed through trimmed. */
export function usDate(v: unknown): string {
  const s = String(v ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : s;
}

/** Splits a typed "21224-1234" (or a 9-digit run) into ZIP and +4; an explicit +4 wins. */
export function splitZip(zip: unknown, zip4: unknown): { zip: string; zip4: string } {
  const d = String(zip ?? "").replace(/\D/g, "");
  return { zip: d.slice(0, 5), zip4: String(zip4 ?? "").replace(/\D/g, "").slice(0, 4) || d.slice(5, 9) };
}

function common(data: MdFinalReturnData) {
  const z = splitZip(data.zip, data.zip4);
  return {
    ein: digits(data.ein, 9), craNumber: digits(data.craNumber, 8), dateDiscontinued: usDate(data.dateDiscontinued), businessName: data.businessName || "",
    street: data.street || "", city: data.city || "", state: String(data.state || "").trim().toUpperCase().slice(0, 2), zip: z.zip, zip4: z.zip4,
    purchaser: data.purchaser || "", dateSold: usDate(data.dateSold), personCompleting: data.personCompleting || "",
    phone: sanitizePhone(data.phone), email: data.email || "",
  };
}

export async function generateMw506Fr(data: MdFinalReturnData): Promise<Uint8Array> {
  const doc = await loadTemplate("mw506fr.pdf");
  fillCopy(
    doc,
    {
      ein: "Text Field 1", craNumber: "Text Field 2", dateDiscontinued: "Text Field 3", businessName: "Text Field 4", street: "Text Field 5",
      city: "Text Field 6", zip: "Text Field 8", zip4: "Text Field 9", dateSold: "Text Field 13",
      personCompleting: "Text Field 14", phone: "Text Field 16", email: "Text Field 15",
    },
    common(data)
  );
  // Two boxes do not print well from their own fields, so each is shrunk to nothing and its text is set on the form instead:
  // the state box is only 17 points wide (viewers clip "MD" to "M"), and line 6 sits on three printed rules that the form's
  // multi-line box draws its text straight across.
  try {
    const form = doc.getForm();
    for (const name of ["Text Field 7", "Text Field 10"]) form.getField(name).acroField.getWidgets().forEach((w) => w.setRectangle({ x: 0, y: 0, width: 0, height: 0 }));
    const page = doc.getPage(0);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const state = common(data).state;
    if (state) page.drawText(state, { x: 302.5, y: 459, size: 9, font, color: rgb(0, 0, 0) });
    const lines = String(data.purchaser || "").split(/\r?\n/).map((l) => pdfSafeText(l.trim())).filter(Boolean);
    const shown = lines.length > 3 ? [...lines.slice(0, 2), lines.slice(2).join(", ")] : lines;
    const baselines = [434, 422, 410];
    shown.forEach((line, i) => {
      let size = 9;
      while (size > 6 && font.widthOfTextAtSize(line, size) > 212) size -= 0.5;
      page.drawText(line, { x: 362, y: baselines[i], size, font, color: rgb(0, 0, 0) });
    });
  } catch { /* field missing on a newer revision */ }
  return extractFlattenedPages(doc, [0]);
}

export async function generateSut202Fr(data: MdFinalReturnData): Promise<Uint8Array> {
  const doc = await loadTemplate("sut202fr.pdf");
  fillCopy(
    doc,
    {
      ein: "FEIN", craNumber: "CR NUMBER", dateDiscontinued: "DATE IF PERMANENTLY DISCONTINUED", businessName: "NAME", street: "STREET ADDRESS",
      city: "CITY", state: "STATE", zip: "Zip code", zip4: "+4", purchaser: "PURCHASERS NAME AND ADDRESS", dateSold: "DATE SOLD",
      personCompleting: "PERSON COMPLETING FORM", phone: "TELEPHONE NUMBER", email: "EMAIL ADDRESS",
    },
    common(data)
  );
  return extractFlattenedPages(doc, [0]);
}
