/**
 * Fills the IRS's and Maryland's own real fillable PDFs for Form 2848
 * (Power of Attorney and Declaration of Representative), Form 8821 (Tax
 * Information Authorization), and Maryland Form 548 (Power of Attorney) —
 * the same overlay-onto-a-real-government-form pattern already used for
 * W-2/1099/940/941/1096 (see src/common/pdfForms.ts), never a firm-drawn
 * substitute.
 *
 * Every field name below was confirmed two ways before being trusted: (1)
 * every text field on Form 8821 and Form 548 carries the agency's own
 * tooltip text (/TU) naming exactly what it is, read directly off the
 * downloaded PDF; (2) every field on all three forms was cross-checked by
 * filling each one with its own field name and rendering the result
 * alongside the blank form, confirming visually that TaxpayerName really
 * does land in the taxpayer name box and not, say, the representative's.
 * Form 2848's own field names are already self-describing
 * (RepresentativesName1, CAFNumber1, etc.) and matched on inspection alone.
 *
 * Deliberately does NOT fill any signature field. None of these forms are
 * signed inside this app: the IRS only honors an electronic signature on
 * 2848/8821 if the form is then submitted through the IRS's own online
 * portal (a typed signature is invalid for mail/fax), and Maryland has no
 * e-file path for Form 548 at all. Leaving every signature line untouched
 * means the printed page is always ready for the one signature method every
 * submission channel accepts: a real pen.
 */
import { PDFDocument } from "pdf-lib";
import { loadTemplate, fillCopy, checkBox, extractFlattenedPages } from "../../common/pdfForms";

export interface PoaRepresentative {
  name: string;
  firmName?: string;
  address: string;
  ptin?: string;
  cafNumber?: string;
  phone?: string;
  fax?: string;
  email?: string;
  sendCopies?: boolean;
  /** Free-text label, e.g. "Unenrolled Return Preparer" — the generator maps this to the letter/number each specific form expects. */
  designation?: string;
  jurisdiction?: string;
  licenseNumber?: string;
}

export interface PoaTaxMatter {
  description: string;
  taxForm?: string;
  years?: string;
}

export interface PoaFilingData {
  taxpayerName: string;
  taxpayerAddress: string;
  taxpayerSsn?: string;
  taxpayerEin?: string;
  taxpayerItin?: string;
  taxpayerPhone?: string;
  spouseName?: string;
  spouseSsn?: string;
  representatives: PoaRepresentative[];
  taxMatters: PoaTaxMatter[];
  retainPrior: boolean;
  notes?: string;
}

/** IRS Form 2848 Part II designations — the letter printed on the form itself. */
const F2848_DESIGNATION_LETTER: Record<string, string> = {
  Attorney: "a",
  "Certified Public Accountant": "b",
  "Enrolled Agent": "c",
  Officer: "d",
  "Full-Time Employee": "e",
  "Family Member": "f",
  "Enrolled Actuary": "g",
  "Unenrolled Return Preparer": "h",
  "Qualifying Student or Law Graduate": "k",
  "Enrolled Retirement Plan Agent": "r",
};

/** Maryland Form 548's own numbered list — confirmed from the form's own printed text, distinct from the federal list above (MD has no "attorney/CPA/EA-only" restriction the same way, and uses "Maryland Registered Individual Tax Preparer" where the IRS says "Unenrolled Return Preparer"). */
const MD548_DESIGNATION_NUMBER: Record<string, string> = {
  Attorney: "1",
  "Certified Public Accountant": "2",
  "Enrolled Agent": "3",
  "Maryland Registered Individual Tax Preparer": "4",
  Officer: "5",
  "Full-Time Employee": "6",
  "Family Member": "7",
  "General Partner": "8",
  Fiduciary: "9",
  Other: "10",
};

export const F2848_DESIGNATIONS = Object.keys(F2848_DESIGNATION_LETTER);
export const MD548_DESIGNATIONS = Object.keys(MD548_DESIGNATION_NUMBER);

function taxpayerIdLine(data: PoaFilingData): { ssn: string; ein: string; itin: string } {
  return { ssn: data.taxpayerSsn || "", ein: data.taxpayerEin || "", itin: data.taxpayerItin || "" };
}

/**
 * Word-wraps into single-line field values — 2848's AdditionalActs1-3 and
 * 548's specific-deletions lines are each one plain text field, not a
 * multi-line box, so a long note has to be split across them rather than
 * overflowing a line past the page edge. `widths` gives each line's own
 * character budget (measured from the real field's /Rect width and font
 * size on the actual template — 2848's AdditionalActs1 shares its row with
 * checkbox labels and is much narrower than lines 2-3, which run the full
 * page width; a single uniform width undersized line 1 badly enough to cut
 * off mid-word). The last width repeats for any line beyond the array.
 */
function wrapAcrossLines(text: string | undefined, widths: number[]): string[] {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const limit = widths[Math.min(lines.length, widths.length - 1)];
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > limit && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/* ------------------------------------------------------------------------ */
/* Form 2848 — Power of Attorney and Declaration of Representative          */
/* ------------------------------------------------------------------------ */
export async function generateForm2848(data: PoaFilingData): Promise<Uint8Array> {
  const doc = await loadTemplate("f2848.pdf");
  const P = "topmostSubform[0].Page1[0]";
  const ids = taxpayerIdLine(data);

  fillCopy(doc, {
    name: `${P}.TaxpayerName[0]`,
    address: `${P}.TaxpayerAddress[0]`,
    ssn: `${P}.TaxpayerIDSSN[0]`,
    itin: `${P}.TaxpayerIDITIN[0]`,
    ein: `${P}.TaxpayerIDEIN[0]`,
    phone: `${P}.TaxpayerTelephone[0]`,
  }, {
    name: data.taxpayerName, address: data.taxpayerAddress,
    ssn: ids.ssn, itin: ids.itin, ein: ids.ein, phone: data.taxpayerPhone || "",
  });

  data.representatives.slice(0, 4).forEach((rep, i) => {
    const n = i + 1;
    fillCopy(doc, {
      name: `${P}.RepresentativesName${n}[0]`,
      address: `${P}.RepresentativesAddress${n}[0]`,
      caf: `${P}.CAFNumber${n}[0]`,
      ptin: `${P}.PTIN${n}[0]`,
      phone: `${P}.TelephoneNo${n}[0]`,
      fax: `${P}.FaxNo${n}[0]`,
    }, {
      name: rep.name, address: rep.address, caf: rep.cafNumber || "None",
      ptin: rep.ptin || "", phone: rep.phone || "", fax: rep.fax || "",
    });
    // Only reps 1-2 have a "sent copies" checkbox — the form itself says
    // "IRS sends notices and communications to only two representatives."
    if (n <= 2 && rep.sendCopies) checkBox(doc, `${P}.SentCopies${n}[0]`);
  });

  data.taxMatters.slice(0, 3).forEach((m, i) => {
    const n = i + 1;
    const row = `${P}.Table_Line3[0].BodyRow${n}[0]`;
    fillCopy(doc, {
      desc: `${row}.Description${n}[0]`,
      form: `${row}.TaxForm${n}[0]`,
      years: `${row}.Years${n}[0]`,
    }, { desc: m.description, form: m.taxForm || "", years: m.years || "" });
  });

  // Three single-line fields, not one multi-line box — line 1 shares its row
  // with checkbox labels (Helvetica-Bold 8pt in a 129.6pt-wide box, ~24
  // chars) while lines 2-3 run the full page width (511.2pt, ~95 chars).
  wrapAcrossLines(data.notes, [24, 95, 95]).forEach((line, i) => {
    if (i < 3) fillCopy(doc, { n: `${P}.AdditionalActs${i + 1}[0]` }, { n: line });
  });

  // Line 6: the form's default is to REVOKE all earlier POAs for the same
  // matters — checking this box means the opposite (keep an earlier one in
  // effect), so it only gets checked when the firm explicitly asked for that.
  if (data.retainPrior) checkBox(doc, "topmostSubform[0].Page2[0].RetentionRevocation[1]");

  fillCopy(doc, { n: "topmostSubform[0].Page2[0].PrintNameTaxpayer[0]" }, { n: data.taxpayerName });

  const P2 = "topmostSubform[0].Page2[0].Table_PartII[0]";
  data.representatives.slice(0, 4).forEach((rep, i) => {
    const n = i + 1;
    const letter = rep.designation ? F2848_DESIGNATION_LETTER[rep.designation] || "" : "";
    fillCopy(doc, {
      designation: `${P2}.BodyRow${n}[0].Designation${n}[0]`,
      jurisdiction: `${P2}.BodyRow${n}[0].Jurisdiction${n}[0]`,
      bar: `${P2}.BodyRow${n}[0].Bar${n}[0]`,
      // Signature/Date deliberately left blank — see module doc comment.
    }, { designation: letter, jurisdiction: rep.jurisdiction || "", bar: rep.licenseNumber || "" });
  });

  return extractFlattenedPages(doc, [0, 1]);
}

/* ------------------------------------------------------------------------ */
/* Form 8821 — Tax Information Authorization                                */
/* ------------------------------------------------------------------------ */
export async function generateForm8821(data: PoaFilingData): Promise<Uint8Array> {
  const doc = await loadTemplate("f8821.pdf");
  const P = "topmostSubform[0].Page1[0]";
  const ids = taxpayerIdLine(data);
  const taxpayerId = [ids.ssn, ids.ein, ids.itin].filter(Boolean).join(" / ");

  fillCopy(doc, {
    name: `${P}.f1_6[0]`,
    id: `${P}.f1_7[0]`,
    phone: `${P}.f1_8[0]`,
  }, { name: `${data.taxpayerName}\n${data.taxpayerAddress}`, id: taxpayerId, phone: data.taxpayerPhone || "" });

  // Designee 1
  const [rep1, rep2] = data.representatives;
  if (rep1) {
    fillCopy(doc, {
      name: `${P}.f1_10[0]`, caf: `${P}.f1_11[0]`, ptin: `${P}.f1_12[0]`, phone: `${P}.f1_13[0]`, fax: `${P}.f1_14[0]`,
    }, {
      name: `${rep1.name}\n${rep1.address}`, caf: rep1.cafNumber || "None", ptin: rep1.ptin || "", phone: rep1.phone || "", fax: rep1.fax || "",
    });
    if (rep1.sendCopies) checkBox(doc, `${P}.c1_2[0]`);
  }
  // Designee 2
  if (rep2) {
    fillCopy(doc, {
      name: `${P}.f1_15[0]`, caf: `${P}.f1_16[0]`, ptin: `${P}.f1_17[0]`, phone: `${P}.f1_18[0]`, fax: `${P}.f1_19[0]`,
    }, {
      name: `${rep2.name}\n${rep2.address}`, caf: rep2.cafNumber || "None", ptin: rep2.ptin || "", phone: rep2.phone || "", fax: rep2.fax || "",
    });
    if (rep2.sendCopies) checkBox(doc, `${P}.c1_6[0]`);
  }

  // Each row has a 4th field (column d, "Specific Tax Matters") — left blank
  // here since PoaTaxMatter has no per-row equivalent; it's a supplementary
  // column on the form, not a required one.
  const rows = [
    ["f1_20", "f1_21", "f1_22"],
    ["f1_24", "f1_25", "f1_26"],
    ["f1_28", "f1_29", "f1_30"],
  ];
  data.taxMatters.slice(0, 3).forEach((m, i) => {
    const [descF, formF, yearsF] = rows[i];
    fillCopy(doc, {
      desc: `${P}.Table_Line3[0].BodyRow${i + 1}[0].${descF}[0]`,
      form: `${P}.Table_Line3[0].BodyRow${i + 1}[0].${formF}[0]`,
      years: `${P}.Table_Line3[0].BodyRow${i + 1}[0].${yearsF}[0]`,
    }, { desc: m.description, form: m.taxForm || "", years: m.years || "" });
  });

  // Line 5: same "keep an earlier authorization" meaning as 2848's line 6,
  // just numbered differently on this form.
  if (data.retainPrior) checkBox(doc, `${P}.c1_12[0]`);

  fillCopy(doc, { n: `${P}.f1_32[0]` }, { n: data.taxpayerName });

  return extractFlattenedPages(doc, [0]);
}

/* ------------------------------------------------------------------------ */
/* Maryland Form 548 — Power of Attorney                                    */
/* ------------------------------------------------------------------------ */
export async function generateFormMD548(data: PoaFilingData): Promise<Uint8Array> {
  const doc = await loadTemplate("md548.pdf");
  const ids = taxpayerIdLine(data);

  fillCopy(doc, {
    name: "Text Field 2", spouseName: "Text Field 1",
    ssn: "Text Field 3", ein: "Text Field 4", spouseSsn: "Text Field 5",
    phone: "Text Field 6",
  }, {
    name: data.taxpayerName, spouseName: data.spouseName || "",
    ssn: ids.ssn, ein: ids.ein, spouseSsn: data.spouseSsn || "", phone: data.taxpayerPhone || "",
  });

  // Address is one line on this form (vs 2848/8821's combined free-text
  // block) — split naively on the first comma, matching how a typical
  // "street, city, state zip" line reads; anything unparsed lands in the
  // street field so nothing is silently dropped.
  const addrParts = (data.taxpayerAddress || "").split(",").map((s) => s.trim());
  fillCopy(doc, {
    street: "Text Field 7", city: "Text Field 9", state: "Text Field 10", zip: "Text Field 11",
  }, {
    street: addrParts[0] || data.taxpayerAddress || "",
    city: addrParts[1] || "", state: addrParts[2] || "", zip: addrParts[3] || "",
  });

  const [rep1, rep2] = data.representatives;
  if (rep1) {
    fillCopy(doc, {
      name: "Text Field 12", firm: "Text Field 13", addr1: "Text Field 14", ptin: "Text Field 15",
      addr2: "Text Field 16", phone: "Text Field 17", fax: "Text Field 18", email: "Text Field 19",
    }, {
      name: rep1.name, firm: rep1.firmName || "", addr1: rep1.address, ptin: rep1.ptin || "",
      addr2: "", phone: rep1.phone || "", fax: rep1.fax || "", email: rep1.email || "",
    });
  }
  if (rep2) {
    fillCopy(doc, {
      name: "Text Field 20", addr1: "Text Field 21", ptin: "Text Field 22",
      addr2: "Text Field 23", phone: "Text Field 24", fax: "Text Field 25", email: "Text Field 26",
    }, {
      name: rep2.name, addr1: rep2.address, ptin: rep2.ptin || "",
      addr2: "", phone: rep2.phone || "", fax: rep2.fax || "", email: rep2.email || "",
    });
  }

  const rows = [
    ["Text Field 27", "Text Field 28", "Text Field 29"],
    ["Text Field 30", "Text Field 31", "Text Field 32"],
    ["Text Field 33", "Text Field 34", "Text Field 35"],
  ];
  data.taxMatters.slice(0, 3).forEach((m, i) => {
    const [descF, formF, yearsF] = rows[i];
    fillCopy(doc, { desc: descF, form: formF, years: yearsF }, { desc: m.description, form: m.taxForm || "", years: m.years || "" });
  });

  // Three single-line fields (36/37/38) at full page width (518.5pt,
  // Courier New 10pt monospace, ~82 chars) — same reasoning as 2848's AdditionalActs1-3.
  wrapAcrossLines(data.notes, [82]).forEach((line, i) => {
    if (i < 3) fillCopy(doc, { n: `Text Field ${36 + i}` }, { n: line });
  });

  if (data.retainPrior) checkBox(doc, "Check Box 1");

  fillCopy(doc, { ssn: "Text Field 39", name: "Text Field 40" }, { ssn: ids.ssn || ids.ein, name: data.taxpayerName });

  const designationRows = [
    ["Text Field 43", "Text Field 45", "Text Field 47"],
    ["Text Field 44", "Text Field 46", "Text Field 48"],
  ];
  data.representatives.slice(0, 2).forEach((rep, i) => {
    const [desigF, jurF, idF] = designationRows[i];
    const number = rep.designation ? MD548_DESIGNATION_NUMBER[rep.designation] || "" : "";
    fillCopy(doc, { desig: desigF, jur: jurF, id: idF }, { desig: number, jur: rep.jurisdiction || "", id: rep.licenseNumber || "" });
  });

  return extractFlattenedPages(doc, [0, 1]);
}

export async function generatePoaForm(formType: "2848" | "8821" | "548", data: PoaFilingData): Promise<Uint8Array> {
  if (formType === "2848") return generateForm2848(data);
  if (formType === "8821") return generateForm8821(data);
  return generateFormMD548(data);
}

// Re-exported so callers never need to reach into pdf-lib directly.
export type { PDFDocument };
