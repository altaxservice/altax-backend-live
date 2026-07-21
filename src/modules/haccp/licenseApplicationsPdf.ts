/**
 * The two (or, for Baltimore County, two differently-shaped) documents that
 * make up a complete health-permit submission package alongside the HACCP
 * plan (haccpPdf.ts). Every form here loads the actual government PDF and
 * fills it — the same approach already used for IRS forms elsewhere in this
 * app (src/common/pdfForms.ts + src/assets/tax-forms/*.pdf) — rather than a
 * hand-drawn recreation, so a real submission looks exactly like what the
 * department issues:
 *
 * - Baltimore City: Food Facility License Application (2pg) + Plan Review
 *   Application (1pg), both real Bureau of Environmental Health forms
 *   downloaded from baltimorecity.gov, 1001 E. Fayette Street. Both are flat
 *   (non-fillable) PDFs, so the real pages are copied into the output and
 *   text is drawn directly on top at coordinates calibrated against the
 *   real form's own layout.
 * - Baltimore County: Food Service Facility Permit Application and Fee
 *   Statement — the County's real form, downloaded from baltimorecountymd.gov,
 *   and unlike the City forms it IS a genuine fillable AcroForm (48 named
 *   fields), filled the same way as an IRS form (fillCopy/checkBox +
 *   extractFlattenedPages) — plus a Plans Review Submission Guide. Baltimore
 *   County does NOT have a separate fillable "Plan Review Application" the
 *   way the City does — the real County process (per its own published
 *   "Guidelines for Retail Food Establishment Plans Review Submittals") is
 *   to submit the permit application plus plans/menu/HACCP plan/equipment
 *   cut sheets to one of two County offices depending on whether the work
 *   needs a building permit. Fabricating a County "Plan Review Application"
 *   that doesn't exist would violate "use their own applications," so the
 *   County package returns that real 4-page guide's bytes unmodified — it's
 *   generic, non-business-specific guidance with no blanks to fill.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { loadHealthFormTemplate, readHealthFormBytes } from "../../common/healthForms";
import { fillCopy, checkBox, extractFlattenedPages } from "../../common/pdfForms";

const PAGE_H = 792;
const INK = rgb(0.09, 0.09, 0.09);
const TEAL = rgb(0.043, 0.42, 0.42);

/** Draws overlay text/annotations onto a copy of a real government PDF page — no header/footer/field-box drawing, since those already exist on the real page underneath. */
class Cursor {
  constructor(private page: PDFPage, private font: PDFFont, private bold: PDFFont, private top: number) {}
  text(x: number, yFromTop: number, str: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center" } = {}) {
    const size = opts.size ?? 9.5;
    const font = opts.bold ? this.bold : this.font;
    const width = font.widthOfTextAtSize(str, size);
    const drawX = opts.align === "right" ? x - width : opts.align === "center" ? x - width / 2 : x;
    this.page.drawText(str, { x: drawX, y: this.top - yFromTop, size, font, color: opts.color ?? INK });
  }
  rect(x: number, y: number, w: number, h: number, color = TEAL, strokeOnly = false) {
    if (strokeOnly) this.page.drawRectangle({ x, y: this.top - y - h, width: w, height: h, borderColor: color, borderWidth: 0.75 });
    else this.page.drawRectangle({ x, y: this.top - y - h, width: w, height: h, color });
  }
}

/** Fields specific to Baltimore County's own Food Service Facility Permit Application and Fee Statement — no equivalent on the Baltimore City form. */
export interface CountyPermitData {
  facilityId?: string;
  cateringServiceProvided?: boolean;
  cateringId?: string;
  facilityClassification?: string;
  numberOfSeats?: string;
  waterService?: string;
  sewageDisposal?: string;
  majorMenuChanges?: boolean;
  certifiedFoodManagers?: { name?: string; idNumber?: string; expirationDate?: string }[];
  daysOfOperation?: string;
  hoursOfOperation?: string;
  numberOfEmployees?: string;
  residentAgentName?: string;
  residentAgentPhone?: string;
  sendCorrespondenceTo?: "trade" | "owner";
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
  county?: CountyPermitData;
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

/**
 * Overlays onto copies of the real Baltimore City Food Facility License
 * Application pages (flat/non-fillable, so text is drawn directly on top of
 * the copied real page rather than into AcroForm fields). Coordinates below
 * were read directly off the real PDF's own text layer (PyMuPDF word/line
 * extraction against baltimore_city_food_license_application.pdf), not
 * eyeballed — each value sits immediately after its label on the same row.
 */
export async function generateFoodLicenseApplicationPdf(data: LicensePdfInput): Promise<Uint8Array> {
  const template = await loadHealthFormTemplate("baltimore_city_food_license_application.pdf");
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const [p1, p2] = await out.copyPages(template, [0, 1]);
  out.addPage(p1);
  out.addPage(p2);
  const app = data.applicationData || {};

  const c1 = new Cursor(p1, font, bold, PAGE_H);
  const cityStateZip = [data.city, data.state].filter(Boolean).join(", ");
  c1.text(150, 220, data.businessName, { size: 10 });
  c1.text(175, 247, data.contactPerson || "", { size: 10 });
  c1.text(378, 247, app.officerTitle || "", { size: 10 });
  c1.text(122, 274, app.tradeName || "", { size: 10 });
  c1.text(150, 301, [data.streetAddress, cityStateZip].filter(Boolean).join(", "), { size: 10 });
  c1.text(504, 301, data.zipCode || "", { size: 10 });
  c1.text(165, 328, data.phone || "", { size: 10 });
  c1.text(418, 328, app.ownerHomePhone || "", { size: 10 });
  c1.text(187, 355, [app.ownerHomeStreet, app.ownerHomeCity].filter(Boolean).join(", "), { size: 10 });
  c1.text(504, 355, app.ownerHomeZip || "", { size: 10 });
  c1.text(310, 382, app.mailingAddress || "", { size: 10 });
  c1.text(135, 409, data.email || "", { size: 10 });

  // Highlight (annotate, don't redraw) the fee-table row matching riskPriority.
  const feeRowY = data.riskPriority === "High" ? 463 : 486;
  c1.rect(36, feeRowY, 264, 16, TEAL, true);

  const c2 = new Cursor(p2, font, bold, PAGE_H);
  const waste = app.wasteHaulerOption;
  if (waste === "under3") c2.text(57.5, 150, "X", { size: 10, bold: true, color: TEAL });
  if (waste === "contract") c2.text(57.5, 181, "X", { size: 10, bold: true, color: TEAL });
  if (waste === "smallHauler") {
    c2.text(57.5, 227, "X", { size: 10, bold: true, color: TEAL });
    c2.text(340, 257, app.smallHaulerLicenseNumber || "", { size: 9 });
  }
  if (app.sellsTobacco) {
    c2.text(400, 338, app.tobaccoLicenseNumber || "", { size: 9 });
  }
  c2.text(469, 602, app.officerTitle || "", { size: 10 });
  c2.text(190, 624, data.contactPerson || "", { size: 10 });

  return out.save();
}

/**
 * Overlays onto a copy of the real Baltimore City Plan Review Application
 * page (flat/non-fillable). Text-label coordinates read directly off the
 * real PDF's text layer; the "OWNER: (select one)" and "PERMITS APPLIED
 * FOR" checkbox cells aren't text at all on the real form — they're bordered
 * table cells drawn as vector rectangles, whose positions were read from the
 * PDF's own drawing/path data (not eyeballed) and marked with a centered "X".
 */
export async function generatePlanReviewApplicationPdf(data: LicensePdfInput): Promise<Uint8Array> {
  const template = await loadHealthFormTemplate("baltimore_city_plan_review_application.pdf");
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const [p1] = await out.copyPages(template, [0]);
  out.addPage(p1);
  const app = data.applicationData || {};
  const c = new Cursor(p1, font, bold, PAGE_H);

  const cityStateZip = [data.city, data.state].filter(Boolean).join(", ");
  c.text(125, 172, data.businessName, { size: 10 });
  c.text(138, 194, [data.streetAddress, cityStateZip].filter(Boolean).join(", "), { size: 10 });
  c.text(520, 194, data.zipCode || "", { size: 10 });
  c.text(118, 216, app.facilityTypeOverride || data.businessTypeLabel, { size: 10 });
  c.text(466, 216, data.phone || "", { size: 10 });
  c.text(129, 238, data.email || "", { size: 10 });

  const entityCheckboxCenters: Record<string, number> = { Incorporated: 283.5, LLC: 351.1, Other: 551 };
  if (app.ownerEntityType && entityCheckboxCenters[app.ownerEntityType] !== undefined) {
    c.text(entityCheckboxCenters[app.ownerEntityType], 258, "X", { size: 9, bold: true, color: TEAL, align: "center" });
  }
  c.text(84, 277, data.contactPerson || "", { size: 10 });
  c.text(97, 299, app.ownerHomeStreet || "", { size: 10 });
  c.text(385, 299, app.ownerHomeCity || "", { size: 10 });
  c.text(523, 299, app.ownerHomeZip || "", { size: 10 });
  c.text(132, 321, app.ownerHomePhone || "", { size: 10 });

  if (app.useAndOccupancyNumber) c.text(250, 367, app.useAndOccupancyNumber, { size: 9 });
  const permitCellCenters: Record<string, [number, number]> = {
    zoning: [331, 382.75],
    building: [552, 382.75],
    occupancy: [331, 404.9],
    liquor: [552, 404.9],
    retailFood: [331, 427],
    dayCare: [552, 427],
  };
  const permitsApplied = new Set(app.permitsApplied || ["retailFood"]);
  for (const [key, [x, yFromTop]] of Object.entries(permitCellCenters)) {
    if (permitsApplied.has(key)) c.text(x, yFromTop, "X", { size: 9, bold: true, color: TEAL, align: "center" });
  }

  c.text(469, 649, app.officerTitle || "", { size: 10 });
  c.text(167, 684, data.contactPerson || "", { size: 10 });

  return out.save();
}

/**
 * Real Baltimore County form — an actual fillable AcroForm (48 named fields,
 * confirmed against the live baltimorecountymd.gov PDF), filled the same way
 * the IRS forms are (src/common/pdfForms.ts's fillCopy/setTextSafe pattern),
 * not hand-drawn. Structurally different from the City's Food Facility
 * License Application, not a reskin of it.
 *
 * Check Box2–5 and "Text1" have no self-explanatory names in the real PDF —
 * mapped by inspecting each widget's on-page rectangle against the rendered
 * form: Check Box4/5 sit directly under "Major Changes In the Menu During
 * the Year? YES / NO"; Check Box2/3 sit under "Send correspondence to: Trade
 * Name Address / Owner Address"; Text1 is a wide single-line field exactly
 * one row below "Hours of Operation" at the same row spacing as the
 * Days→Hours rows above it, i.e. the (otherwise-unlabeled-in-the-AcroForm)
 * "No. of Employees" blank.
 */
export async function generateCountyFoodServicePermitApplicationPdf(data: LicensePdfInput): Promise<Uint8Array> {
  const app = data.applicationData || {};
  const county = app.county || {};

  const doc = await loadHealthFormTemplate("baltimore_county_food_service_permit_application.pdf");
  const cityStateZip = data.state || "MD";

  const values: Record<string, string> = {
    "Trade Name": data.businessName,
    "Facility ID": county.facilityId || "",
    "Address": data.streetAddress || "",
    "City": data.city || "",
    "State": cityStateZip,
    "Zip Code": data.zipCode || "",
    "Telephone": data.phone || "",
    "Email Address": data.email || "",
    "Catering Service Provided": county.cateringServiceProvided ? "Yes" : "No",
    "Catering ID": county.cateringId || "",
    "Facility Classification": county.facilityClassification || "",
    "Type of Facility": app.facilityTypeOverride || data.businessTypeLabel,
    "Number of Seats Provided": county.numberOfSeats || "",
    "Water Service": county.waterService || "",
    "Sewage Disposal": county.sewageDisposal || "",
    "Days of Operation": county.daysOfOperation || "",
    "Hours of Operation": county.hoursOfOperation || "",
    "Text1": county.numberOfEmployees || "",
    "Owner": data.contactPerson || "",
    "Zip Code_2": app.ownerHomeZip || "",
    "Address_2": [app.ownerHomeStreet, app.ownerHomeCity].filter(Boolean).join(", "),
    "Telephone_2": app.ownerHomePhone || "",
    "Resident Agent": county.residentAgentName || "",
    "Telephone_3": county.residentAgentPhone || "",
    "Applicants Name": data.contactPerson || "",
    "Telephone_4": data.phone || "",
  };
  const managerFieldNames = [
    "Name of certified manager Baltimore County ID number and Expiration Date",
    "Name of certified manager Baltimore County ID number and Expiration Date_2",
    "Name of certified manager Baltimore County ID number and Expiration Date 1",
    "Name of certified manager Baltimore County ID number and Expiration Date_3",
  ];
  const managers = county.certifiedFoodManagers || [];
  managerFieldNames.forEach((fieldName, i) => {
    const mgr = managers[i];
    if (!mgr) return;
    values[fieldName] = [mgr.name, mgr.idNumber ? `ID: ${mgr.idNumber}` : "", mgr.expirationDate ? `Exp: ${mgr.expirationDate}` : ""].filter(Boolean).join("   —   ");
  });
  fillCopy(doc, Object.fromEntries(Object.keys(values).map((k) => [k, k])), values);

  if (county.majorMenuChanges === true) checkBox(doc, "Check Box4");
  if (county.majorMenuChanges === false) checkBox(doc, "Check Box5");
  if (county.sendCorrespondenceTo === "owner") checkBox(doc, "Check Box3");
  else checkBox(doc, "Check Box2");

  return extractFlattenedPages(doc, [0]);
}

/**
 * Baltimore County has no separate fillable "Plan Review Application" the
 * way Baltimore City does — its real process (per the County's own published
 * "Guidelines for Retail Food Establishment Plans Review Submittals") is to
 * submit the permit application above plus supporting materials to one of
 * two County offices depending on the scope of work. This renders that real
 * guidance rather than a fabricated application form.
 */
export async function generateCountyPlansReviewGuidePdf(_data: LicensePdfInput): Promise<Uint8Array> {
  return readHealthFormBytes("baltimore_county_plans_review_guide.pdf");
}
