/**
 * Food Facility License Application + Plan Review Application — the other two
 * documents that make up a complete Baltimore City health-permit submission
 * package alongside the HACCP plan (haccpPdf.ts). Modeled field-for-field on
 * two real Baltimore City Health Department (Bureau of Environmental Health,
 * 1001 E. Fayette Street) forms reviewed this session — the Food Facility
 * License Application filed for Chase Grocery And Deli LLC and the Plan
 * Review Application filed for Fells Point Cafe & Deli. Both source forms are
 * Baltimore City forms specifically; Baltimore County's equivalent
 * applications likely differ (different office, address, fee schedule) but
 * no real County sample was available to build from, so these two renderers
 * print the Baltimore City forms regardless of the plan's own jurisdiction
 * field — flagged here and to the user rather than guessing at County-specific
 * bureaucratic details with no source to verify against.
 *
 * Unlike haccpPdf.ts, these are structured government forms, not flowing
 * prose — rendered as labeled field boxes / checklists / a fee table rather
 * than paragraph text, same self-contained local Cursor/newPage pattern as
 * every other PDF generator in this app.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

const PAGE_W = 612;
const PAGE_H = 792;
const INK = rgb(0.09, 0.09, 0.09);
const MUTED = rgb(0.42, 0.42, 0.42);
const LINE = rgb(0.6, 0.6, 0.6);
const TEAL = rgb(0.043, 0.42, 0.42);
const TEAL_TINT = rgb(0.88, 0.95, 0.95);

class Cursor {
  constructor(private page: PDFPage, private font: PDFFont, private bold: PDFFont, private top: number) {}
  text(x: number, yFromTop: number, str: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center" } = {}) {
    const size = opts.size ?? 9.5;
    const font = opts.bold ? this.bold : this.font;
    const width = font.widthOfTextAtSize(str, size);
    const drawX = opts.align === "right" ? x - width : opts.align === "center" ? x - width / 2 : x;
    this.page.drawText(str, { x: drawX, y: this.top - yFromTop, size, font, color: opts.color ?? INK });
  }
  line(x1: number, y1: number, x2: number, y2: number, color = LINE, thickness = 0.75) {
    this.page.drawLine({ start: { x: x1, y: this.top - y1 }, end: { x: x2, y: this.top - y2 }, thickness, color });
  }
  rect(x: number, y: number, w: number, h: number, color = TEAL, strokeOnly = false) {
    if (strokeOnly) this.page.drawRectangle({ x, y: this.top - y - h, width: w, height: h, borderColor: color, borderWidth: 0.75 });
    else this.page.drawRectangle({ x, y: this.top - y - h, width: w, height: h, color });
  }
  /** Small square checkbox — filled teal if checked, empty outline otherwise. */
  checkbox(x: number, yFromTop: number, checked: boolean, size = 9) {
    this.page.drawRectangle({ x, y: this.top - yFromTop - size, width: size, height: size, borderColor: INK, borderWidth: 0.9, color: checked ? TEAL : undefined });
    if (checked) {
      this.text(x + 1.5, yFromTop + size - 1, "X", { size: size - 1, bold: true, color: rgb(1, 1, 1) });
    }
  }
}

function newPage(doc: PDFDocument, font: PDFFont, bold: PDFFont): { page: PDFPage; c: Cursor } {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const c = new Cursor(page, font, bold, PAGE_H);
  c.rect(0, 0, PAGE_W, 6, TEAL);
  return { page, c };
}

function drawHeader(c: Cursor, title: string, deptLines: string[]): number {
  const L = 48, R = PAGE_W - 48;
  let y = 40;
  c.text(L, y, "BALTIMORE CITY HEALTH DEPARTMENT", { size: 11, bold: true, color: TEAL });
  y += 13;
  for (const line of deptLines) {
    c.text(L, y, line, { size: 8.5, color: MUTED });
    y += 10.5;
  }
  y += 10;
  c.rect(L, y, R - L, 26, TEAL_TINT);
  c.text(PAGE_W / 2, y + 17, title, { size: 14, bold: true, align: "center" });
  y += 34;
  c.text(PAGE_W / 2, y, "PLEASE PRINT ALL INFORMATION CLEARLY", { size: 8.5, bold: true, align: "center" });
  y += 16;
  return y;
}

function drawFooter(c: Cursor, formName: string, pageLabel: string) {
  c.text(48, PAGE_H - 28, `Baltimore City Health Department — ${formName}`, { size: 7.5, color: MUTED });
  c.text(PAGE_W - 48, PAGE_H - 28, pageLabel, { size: 8, color: MUTED, align: "right" });
}

/** One "LABEL: value" row inside a bordered box, filling the box width. */
function fieldRow(c: Cursor, x: number, y: number, w: number, h: number, label: string, value: string) {
  c.rect(x, y, w, h, LINE, true);
  c.text(x + 6, y + 11, `${label}${value ? ":" : ""}`, { size: 8.5, bold: true });
  if (value) {
    c.text(x + 6, y + h - 6, value, { size: 9.5 });
  }
}

function drawSignatureBlock(c: Cursor, y: number, contactPerson: string, officerTitle: string): number {
  const L = 48, R = PAGE_W - 48;
  y += 8;
  c.line(L, y, R, y, INK, 1);
  y += 16;
  c.text(L, y, `I CERTIFY THAT THE ABOVE INFORMATION IS CORRECT TO THE BEST OF MY KNOWLEDGE AND BELIEF.`, { size: 8.5, bold: true });
  y += 22;
  c.text(L, y, "APPLICANT'S SIGNATURE: ______________________________", { size: 9.5 });
  c.text(R, y, `APPLICANT'S TITLE: ${officerTitle || "____________"}`, { size: 9.5, align: "right" });
  y += 22;
  c.text(L, y, `APPLICANT'S NAME (PRINT): ${contactPerson || "____________________________"}`, { size: 9.5 });
  return y;
}

export interface LicenseApplicationData {
  officerTitle?: string;
  tradeName?: string;
  ownerHomeStreet?: string;
  ownerHomeCity?: string;
  ownerHomeZip?: string;
  ownerHomePhone?: string;
  mailingAddress?: string;
  wasteHaulerOption?: "under3" | "contract" | "smallHauler";
  smallHaulerLicenseNumber?: string;
  sellsTobacco?: boolean;
  tobaccoLicenseNumber?: string;
  ownerEntityType?: "Incorporated" | "LLC" | "Other";
  useAndOccupancyNumber?: string;
  permitsApplied?: string[];
  facilityTypeOverride?: string;
}

export interface LicensePdfInput {
  planId: string;
  businessName: string;
  businessTypeLabel: string;
  riskPriority: "High" | "Moderate";
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  phone?: string | null;
  email?: string | null;
  contactPerson?: string | null;
  applicationData: LicenseApplicationData;
}

export async function generateFoodLicenseApplicationPdf(data: LicensePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const L = 48, R = PAGE_W - 48;
  const app = data.applicationData || {};

  let { page, c } = newPage(doc, font, bold);
  let y = drawHeader(c, "FOOD FACILITY LICENSE APPLICATION", ["Bureau of Environmental Health", "Environmental Inspection Services", "1001 E. Fayette Street", "Baltimore, Maryland 21202", "410-396-4428"]);
  drawFooter(c, "Food Facility License Application", "Page 1");

  const rowH = 26;
  fieldRow(c, L, y, R - L, rowH, "CORPORATE NAME", data.businessName); y += rowH;
  fieldRow(c, L, y, (R - L) * 0.65, rowH, "OFFICER/OWNER NAME", data.contactPerson || "");
  fieldRow(c, L + (R - L) * 0.65, y, (R - L) * 0.35, rowH, "TITLE", app.officerTitle || ""); y += rowH;
  fieldRow(c, L, y, R - L, rowH, "TRADE NAME", app.tradeName || ""); y += rowH;
  const cityStateZip = [data.city, data.state].filter(Boolean).join(", ");
  fieldRow(c, L, y, (R - L) * 0.72, rowH, "BUSINESS ADDRESS", [data.streetAddress, cityStateZip].filter(Boolean).join(", "));
  fieldRow(c, L + (R - L) * 0.72, y, (R - L) * 0.28, rowH, "ZIP CODE", data.zipCode || ""); y += rowH;
  fieldRow(c, L, y, (R - L) * 0.5, rowH, "BUSINESS TELEPHONE", data.phone || "");
  fieldRow(c, L + (R - L) * 0.5, y, (R - L) * 0.5, rowH, "HOME TELEPHONE", app.ownerHomePhone || ""); y += rowH;
  const ownerHomeCityZip = [app.ownerHomeCity].filter(Boolean).join(", ");
  fieldRow(c, L, y, (R - L) * 0.72, rowH, "OWNER'S HOME ADDRESS", [app.ownerHomeStreet, ownerHomeCityZip].filter(Boolean).join(", "));
  fieldRow(c, L + (R - L) * 0.72, y, (R - L) * 0.28, rowH, "ZIP CODE", app.ownerHomeZip || ""); y += rowH;
  fieldRow(c, L, y, R - L, rowH, "MAILING ADDRESS (IF DIFFERENT THAN BUSINESS)", app.mailingAddress || ""); y += rowH;
  fieldRow(c, L, y, R - L, rowH, "EMAIL ADDRESS", data.email || ""); y += rowH + 10;

  c.rect(L, y, R - L, 16, TEAL_TINT);
  c.text(PAGE_W / 2, y + 11, "REQUIRED FEES BASED ON FACILITY TYPE/PRIORITY", { size: 9, bold: true, align: "center" });
  y += 16;
  c.text(PAGE_W / 2, y + 9, "(YOUR PLAN REVIEWER WILL ASSESS YOUR FACILITY AND ASSIGN A TYPE/PRIORITY)", { size: 7, color: MUTED, align: "center" });
  y += 16;

  const feeRows: [string, string, string, string][] = [
    ["HIGH PRIORITY FACILITY", "$520", "HIGH PRIORITY FACILITY - SEASONAL", "$350"],
    ["MODERATE PRIORITY FACILITY", "$285", "MODERATE PRIORITY FACILITY - SEASONAL", "$145"],
    ["LOW PRIORITY FACILITY", "$65", "CATERING LICENSE", "$625"],
    ["VENDING MACHINE", "$10", "OTHER _______________________", "$______"],
  ];
  const halfW = (R - L) / 2;
  for (const [labelA, feeA, labelB, feeB] of feeRows) {
    const isApplicableA = labelA.startsWith(data.riskPriority.toUpperCase());
    const isApplicableB = labelB.startsWith(data.riskPriority.toUpperCase());
    c.rect(L, y, halfW, 15, LINE, true);
    c.rect(L + halfW, y, halfW, 15, LINE, true);
    c.text(L + 5, y + 10.5, labelA, { size: 8, bold: isApplicableA, color: isApplicableA ? TEAL : INK });
    c.text(L + halfW - 5, y + 10.5, feeA, { size: 8, bold: isApplicableA, color: isApplicableA ? TEAL : INK, align: "right" });
    c.text(L + halfW + 5, y + 10.5, labelB, { size: 8, bold: isApplicableB, color: isApplicableB ? TEAL : INK });
    c.text(R - 5, y + 10.5, feeB, { size: 8, bold: isApplicableB, color: isApplicableB ? TEAL : INK, align: "right" });
    y += 15;
  }
  y += 6;
  const priorityNote = `This facility's plan review categorizes it as ${data.riskPriority} Priority (${data.businessTypeLabel}) — the row above is highlighted for reference; the health department's plan reviewer makes the final assignment.`;
  for (const line of wrapText(priorityNote, font, 7.5, R - L)) { c.text(L, y, line, { size: 7.5, color: MUTED }); y += 10; }
  y += 8;

  c.rect(L, y, R - L, 14, TEAL_TINT);
  c.text(PAGE_W / 2, y + 10, "COMPLIANCE WITH THE MARYLAND WORKERS' COMPENSATION ACT", { size: 8.5, bold: true, align: "center" });
  y += 18;
  const workersCompText = "Maryland Annotated Code, Health General Article, Section 1-202 requires that before any license or permit is issued to an employer to engage in an activity in which the employer may employ a covered individual, the employer must file with the issuing authority a certificate of compliance with the state workers' compensation laws, or the employer's worker's compensation insurance policy or binder number.";
  for (const line of wrapText(workersCompText, font, 8, R - L)) { c.text(L, y, line, { size: 8 }); y += 11; }
  y += 4;
  c.text(L, y, `PLEASE SUBMIT A "CERTIFICATE OF COMPLIANCE" WITH THIS APPLICATION.`, { size: 8.5, bold: true });

  // ---- Page 2: waste hauler / tobacco / signature ----
  ({ page, c } = newPage(doc, font, bold));
  drawFooter(c, "Food Facility License Application", "Page 2");
  y = 48;

  c.rect(L, y, R - L, 14, TEAL_TINT);
  c.text(PAGE_W / 2, y + 10, "STATEMENT OF WASTE HAULER SERVICE", { size: 8.5, bold: true, align: "center" });
  y += 20;
  const wasteOptions: { key: string; label: string }[] = [
    { key: "under3", label: "My business will generate three (3) or fewer thirty-two (32) gallon commercial trash receptacles per week." },
    { key: "contract", label: "My business will generate more than three (3) receptacles per week and I have a contract with a licensed waste hauler." },
    { key: "smallHauler", label: `My business will generate more than three (3) receptacles per week and I have a small hauler license.${app.smallHaulerLicenseNumber ? ` License #: ${app.smallHaulerLicenseNumber}` : ""}` },
  ];
  for (const opt of wasteOptions) {
    c.checkbox(L, y, app.wasteHaulerOption === opt.key);
    const lines = wrapText(opt.label, font, 8.5, R - L - 20);
    lines.forEach((line, i) => { c.text(L + 16, y + 8 + i * 11, line, { size: 8.5 }); });
    y += 8 + lines.length * 11 + 6;
  }
  y += 10;

  c.rect(L, y, R - L, 14, TEAL_TINT);
  c.text(PAGE_W / 2, y + 10, "STATEMENT OF TOBACCO LICENSEE", { size: 8.5, bold: true, align: "center" });
  y += 20;
  if (app.sellsTobacco) {
    c.text(L, y, `State of Maryland License Number (if known): ${app.tobaccoLicenseNumber || "________________"}`, { size: 8.5 });
    y += 16;
    const tobaccoStatements = [
      "The sale of cigarettes, other tobacco products, and electronic smoking devices to anyone under the age of 18 is illegal — photo ID must be requested from any person who appears to be younger than 27.",
      "The sale of individual cigarettes is illegal. No \"loosies\" or partial packs may be sold; cigarette packs must be sold in a minimum package of 20.",
      "Tobacco products and electronic smoking devices must be placed so they cannot be reached by any person under the age of 18.",
      "It is the applicant's responsibility to ensure all staff are aware of and understand these rules before selling any merchandise to customers.",
    ];
    for (const stmt of tobaccoStatements) {
      c.text(L, y, "Initials: ______", { size: 8, color: MUTED });
      const lines = wrapText(stmt, font, 8, R - L - 60);
      lines.forEach((line, i) => c.text(L + 62, y + i * 10.5, line, { size: 8 }));
      y += Math.max(11, lines.length * 10.5) + 5;
    }
  } else {
    c.text(L, y, "Not applicable — this facility does not sell tobacco products or electronic smoking devices.", { size: 8.5, color: MUTED });
    y += 16;
  }
  y += 12;

  c.text(L, y, "FACILITY TYPE/PRIORITY: (BCHD use only)", { size: 8, color: MUTED });
  c.text(R, y, "FEE SUBMITTED WITH APPLICATION: $______", { size: 8, color: MUTED, align: "right" });
  y += 16;
  c.text(L, y, `Make check or money order payable to "Director of Finance." Mail to: Environmental Inspection Services, 1001 E. Fayette Street, Baltimore, MD 21202.`, { size: 8, color: MUTED });
  y += 20;

  drawSignatureBlock(c, y, data.contactPerson || "", app.officerTitle || "");

  return doc.save();
}

export async function generatePlanReviewApplicationPdf(data: LicensePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const L = 48, R = PAGE_W - 48;
  const app = data.applicationData || {};

  const { c } = newPage(doc, font, bold);
  let y = drawHeader(c, "PLAN REVIEW APPLICATION", ["Bureau of Environmental Health", "Environmental Inspection Services", "1001 E. Fayette Street", "Baltimore, Maryland 21202", "(Office) 410-396-4425  (Fax) 410-396-5986"]);
  drawFooter(c, "Plan Review Application", "Page 1");

  const rowH = 26;
  fieldRow(c, L, y, R - L, rowH, "FACILITY NAME", data.businessName); y += rowH;
  const cityStateZip = [data.city, data.state].filter(Boolean).join(", ");
  fieldRow(c, L, y, (R - L) * 0.72, rowH, "FACILITY ADDRESS", [data.streetAddress, cityStateZip].filter(Boolean).join(", "));
  fieldRow(c, L + (R - L) * 0.72, y, (R - L) * 0.28, rowH, "ZIP CODE", data.zipCode || ""); y += rowH;
  fieldRow(c, L, y, R - L, rowH, "FACILITY TYPE", app.facilityTypeOverride || data.businessTypeLabel); y += rowH;
  fieldRow(c, L, y, R - L, rowH, "BUSINESS TELEPHONE", data.phone || ""); y += rowH;
  fieldRow(c, L, y, R - L, rowH, "EMAIL ADDRESS", data.email || ""); y += rowH + 12;

  c.text(L, y, "OWNER: (select one)", { size: 9, bold: true });
  const entityTypes: ("Incorporated" | "LLC" | "Other")[] = ["Incorporated", "LLC", "Other"];
  let ex = L + 100;
  for (const et of entityTypes) {
    c.checkbox(ex, y - 8, app.ownerEntityType === et);
    c.text(ex + 14, y, et, { size: 9 });
    ex += 90;
  }
  y += 20;
  fieldRow(c, L, y, R - L, rowH, "NAME", data.contactPerson || ""); y += rowH;
  fieldRow(c, L, y, R - L, rowH, "ADDRESS", app.ownerHomeStreet || ""); y += rowH;
  fieldRow(c, L, y, (R - L) * 0.5, rowH, "CITY", app.ownerHomeCity || "");
  fieldRow(c, L + (R - L) * 0.5, y, (R - L) * 0.5, rowH, "ZIP CODE", app.ownerHomeZip || ""); y += rowH;
  fieldRow(c, L, y, R - L, rowH, "PHONE NUMBER", app.ownerHomePhone || ""); y += rowH + 12;

  c.text(L, y, "PERMITS APPLIED FOR:", { size: 9, bold: true });
  y += 16;
  const permitOptions: { key: string; label: string }[] = [
    { key: "useAndOccupancy", label: `Use and Occupancy${app.useAndOccupancyNumber ? ` — Use Number: ${app.useAndOccupancyNumber}` : ""}` },
    { key: "zoning", label: "Zoning Permit Application" },
    { key: "building", label: "Building Permit with Plans" },
    { key: "occupancy", label: "Occupancy Permit Application" },
    { key: "liquor", label: "Liquor License Application" },
    { key: "retailFood", label: "Retail Food Permit Application" },
    { key: "dayCare", label: "Day Care License Application" },
  ];
  const permitsApplied = new Set(app.permitsApplied || ["retailFood"]);
  for (const opt of permitOptions) {
    c.checkbox(L, y, permitsApplied.has(opt.key));
    c.text(L + 16, y + 8, opt.label, { size: 8.5 });
    y += 15;
  }
  y += 8;

  c.rect(L, y, R - L, 14, TEAL_TINT);
  c.text(PAGE_W / 2, y + 10, "FEES REQUIRED FOR ALL FOOD FACILITY OPERATIONS", { size: 8, bold: true, align: "center" });
  y += 14;
  const feeRows: [string, string][] = [
    ["New Plan Review Fee (review of floor plans)", "$75"],
    ["Plan Review Inspection Fee", "$150"],
    ["Additional Inspection Fee", "$50"],
    ["Normal Inspection After Permit Suspension", "$100"],
    ["After-Hours Inspection After Permit Suspension", "$300"],
  ];
  for (const [label, fee] of feeRows) {
    c.rect(L, y, R - L, 15, LINE, true);
    c.text(L + 5, y + 10.5, label, { size: 8 });
    c.text(L + (R - L) * 0.62, y + 10.5, fee, { size: 8, bold: true });
    c.text(L + (R - L) * 0.75, y + 10.5, "Amount Paid: __________", { size: 7.5, color: MUTED });
    c.text(R - 5, y + 10.5, "Date: __________", { size: 7.5, color: MUTED, align: "right" });
    y += 15;
  }
  y += 8;
  c.text(L, y, "For information or to submit materials, contact the Plan Reviewer section at 410-396-4544.", { size: 8, color: MUTED });
  y += 16;

  drawSignatureBlock(c, y, data.contactPerson || "", app.officerTitle || "");

  return doc.save();
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}
