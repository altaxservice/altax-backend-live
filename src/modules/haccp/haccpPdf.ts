/**
 * HACCP Plan PDF — hand-drawn from scratch (pdf-lib primitives), same
 * self-contained local Cursor/newPage/wrapText approach as contractPdf.ts/
 * invoicePdf.ts/reportsPdf.ts/paycheckPdf.ts. Cover sheet (business info +
 * jurisdiction/COMAR citation) on page 1, then the plan body (CCP sections,
 * general handling/training, menu + equipment checklist) flowed across
 * however many pages it needs, with light bolding for section headers and
 * CCP field labels (CCP & EQUIPMENT / MONITORING / CORRECTIVE ACTION /
 * VERIFICATION) so the CCP tables read cleanly instead of as a wall of text.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { getFirmProfile, type FirmProfile } from "../../common/firmProfile";
import { embedFirmLogo } from "../../common/pdfLogo";

const PAGE_W = 612;
const PAGE_H = 792;
const INK = rgb(0.09, 0.09, 0.09);
const MUTED = rgb(0.42, 0.42, 0.42);
const LINE = rgb(0.82, 0.82, 0.82);
const TEAL = rgb(0.043, 0.42, 0.42);
const TEAL_TINT = rgb(0.93, 0.97, 0.97);

const CCP_LABEL_RE = /^(CCP & EQUIPMENT|MONITORING|CORRECTIVE ACTION|VERIFICATION):\s*/;

function fmtDate(v: unknown): string {
  if (!v) return new Date().toLocaleDateString(undefined, { timeZone: "UTC" });
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

export interface HaccpPdfData {
  planId: string;
  businessName: string;
  businessTypeLabel: string;
  jurisdiction: string;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  phone?: string | null;
  email?: string | null;
  contactPerson?: string | null;
  licenseNumber?: string | null;
  riskPriority: "High" | "Moderate";
  renderedBody: string;
  createdAt: string | null;
}

class Cursor {
  constructor(private page: PDFPage, private font: PDFFont, private bold: PDFFont, private top: number) {}
  text(x: number, yFromTop: number, str: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center" } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const width = font.widthOfTextAtSize(str, size);
    const drawX = opts.align === "right" ? x - width : opts.align === "center" ? x - width / 2 : x;
    this.page.drawText(str, { x: drawX, y: this.top - yFromTop, size, font, color: opts.color ?? INK });
  }
  line(x1: number, y1: number, x2: number, y2: number, color = LINE, thickness = 0.75) {
    this.page.drawLine({ start: { x: x1, y: this.top - y1 }, end: { x: x2, y: this.top - y2 }, thickness, color });
  }
  rect(x: number, y: number, w: number, h: number, color = TEAL) {
    this.page.drawRectangle({ x, y: this.top - y - h, width: w, height: h, color });
  }
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

function newPage(doc: PDFDocument, font: PDFFont, bold: PDFFont): { page: PDFPage; c: Cursor } {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const c = new Cursor(page, font, bold, PAGE_H);
  c.rect(0, 0, PAGE_W, 6, TEAL);
  return { page, c };
}

function drawFooter(c: Cursor, jurisdiction: string, pageLabel: string) {
  c.text(48, PAGE_H - 28, `Prepared in accordance with Maryland COMAR 10.15.03 and ${jurisdiction} Health Department HACCP Guidelines`, { size: 7.5, color: MUTED });
  c.text(PAGE_W - 48, PAGE_H - 28, pageLabel, { size: 8, color: MUTED, align: "right" });
}

export async function generateHaccpPdf(data: HaccpPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const profile: FirmProfile = await getFirmProfile();
  const logo = await embedFirmLogo(doc, profile);

  const L = 48, R = PAGE_W - 48;
  const maxWidth = R - L;

  // ---- Cover sheet ----
  let { page, c } = newPage(doc, font, bold);
  let y = 48;
  let textL = L;
  if (logo) {
    const logoH = 30;
    const logoW = (logo.width / logo.height) * logoH;
    page.drawImage(logo, { x: L, y: PAGE_H - y - logoH + 6, width: logoW, height: logoH });
    textL = L + logoW + 10;
  }
  c.text(textL, y, profile.firmName.toUpperCase(), { size: 14, bold: true, color: TEAL });
  y += 16;
  for (const line of [profile.addressLine1, profile.addressLine2].filter((l) => l && l.trim())) {
    c.text(textL, y, line, { size: 9, color: MUTED });
    y += 11;
  }
  y += 20;

  c.text(PAGE_W / 2, y, "HAZARD ANALYSIS CRITICAL CONTROL POINT (HACCP) PLAN", { size: 18, bold: true, align: "center" });
  y += 22;
  c.text(PAGE_W / 2, y, `Prepared in accordance with Maryland COMAR 10.15.03 and ${data.jurisdiction} Health Department HACCP Guidelines`, { size: 9, color: MUTED, align: "center" });
  y += 36;

  c.rect(L, y, R - L, 132, TEAL_TINT);
  const boxL = L + 16;
  let by = y + 22;
  c.text(boxL, by, data.businessName, { size: 16, bold: true });
  by += 20;
  c.text(boxL, by, data.businessTypeLabel, { size: 10.5, color: TEAL, bold: true });
  by += 18;
  const addressParts = [data.streetAddress, [data.city, data.state, data.zipCode].filter(Boolean).join(", ")].filter(Boolean);
  if (addressParts.length) { c.text(boxL, by, addressParts.join(" — "), { size: 9.5 }); by += 14; }
  const contactParts = [data.phone, data.email].filter(Boolean);
  if (contactParts.length) { c.text(boxL, by, contactParts.join("   ·   "), { size: 9.5 }); by += 14; }
  if (data.contactPerson) { c.text(boxL, by, `Contact: ${data.contactPerson}`, { size: 9.5 }); by += 14; }
  if (data.licenseNumber) { c.text(boxL, by, `License/Permit #: ${data.licenseNumber}`, { size: 9.5 }); by += 14; }

  c.text(R - 16, y + 22, `Risk Priority: ${data.riskPriority}`, { size: 9.5, bold: true, color: TEAL, align: "right" });
  c.text(R - 16, y + 36, `Jurisdiction: ${data.jurisdiction}`, { size: 9.5, align: "right" });
  c.text(R - 16, y + 50, `Prepared: ${fmtDate(data.createdAt)}`, { size: 9.5, align: "right" });
  c.text(R - 16, y + 64, `Plan ID: ${data.planId}`, { size: 8, color: MUTED, align: "right" });

  y += 150;
  c.line(L, y, R, y, INK, 1.25);

  drawFooter(c, data.jurisdiction, "Page 1");
  let pageNum = 1;

  // ---- Body: CCP sections, general handling/training, menu + equipment checklist ----
  y = 60;
  ({ page, c } = newPage(doc, font, bold));
  pageNum += 1;
  drawFooter(c, data.jurisdiction, `Page ${pageNum}`);

  const paragraphs = data.renderedBody.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  for (const para of paragraphs) {
    const rawLines = para.split("\n");
    for (const rawLine of rawLines) {
      const isSectionHeader = /^[A-Z][A-Z0-9 &().,/'-]{3,}$/.test(rawLine) && rawLine === rawLine.toUpperCase();
      const ccpLabelMatch = rawLine.match(CCP_LABEL_RE);

      if (isSectionHeader) {
        if (y > PAGE_H - 60) { pageNum += 1; ({ page, c } = newPage(doc, font, bold)); y = 56; drawFooter(c, data.jurisdiction, `Page ${pageNum}`); }
        y += 6;
        c.text(L, y, rawLine, { size: 11.5, bold: true, color: TEAL });
        y += 8;
        c.line(L, y, R, y, LINE, 0.75);
        y += 14;
        continue;
      }

      if (ccpLabelMatch) {
        const label = ccpLabelMatch[1] + ": ";
        const rest = rawLine.slice(ccpLabelMatch[0].length);
        const labelW = bold.widthOfTextAtSize(label, 9.5);
        if (y > PAGE_H - 60) { pageNum += 1; ({ page, c } = newPage(doc, font, bold)); y = 56; drawFooter(c, data.jurisdiction, `Page ${pageNum}`); }
        c.text(L, y, label, { size: 9.5, bold: true });
        const wrapped = wrapText(rest, font, 9.5, maxWidth - labelW);
        wrapped.forEach((line, i) => {
          if (i > 0 && y > PAGE_H - 60) { pageNum += 1; ({ page, c } = newPage(doc, font, bold)); y = 56; drawFooter(c, data.jurisdiction, `Page ${pageNum}`); }
          c.text(i === 0 ? L + labelW : L + 14, y, line, { size: 9.5 });
          y += 13;
        });
        continue;
      }

      const isSubHeader = /^(Process \d|Menu:?$|MENU$|EQUIPMENT LIST$)/i.test(rawLine.trim());
      for (const wrapped of wrapText(rawLine, font, 9.5, maxWidth)) {
        if (y > PAGE_H - 60) { pageNum += 1; ({ page, c } = newPage(doc, font, bold)); y = 56; drawFooter(c, data.jurisdiction, `Page ${pageNum}`); }
        c.text(L, y, wrapped, isSubHeader ? { size: 10, bold: true, color: TEAL } : { size: 9.5 });
        y += 13;
      }
    }
    y += 9;
  }

  return doc.save();
}
