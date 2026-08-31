/**
 * HACCP Plan PDF — hand-drawn from scratch (pdf-lib primitives), same
 * self-contained local Cursor/newPage/wrapText approach as contractPdf.ts/
 * invoicePdf.ts/reportsPdf.ts/paycheckPdf.ts. This is AL TAX's own work
 * product handed to a government health department, not client-facing
 * correspondence — deliberately carries no AL TAX letterhead/logo, unlike
 * every other generated PDF in this app.
 *
 * Page 1: cover sheet (business info + jurisdiction/COMAR citation).
 * Page 2: dedicated Menu checklist (own page, business-info banner at top,
 * per explicit request that staff see the menu first).
 * Page 3+: the plan body (CCP sections, general handling/training) flowed
 * across however many pages it needs, with light bolding for section headers
 * and CCP field labels (CCP & EQUIPMENT / MONITORING / CORRECTIVE ACTION /
 * VERIFICATION) so the CCP tables read cleanly instead of as a wall of text.
 * Final section: Equipment List, on its own fresh page — matches the Word
 * doc's document order (Cover → Menu → Body → Equipment List).
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, degrees } from "pdf-lib";
import { pdfSafeText } from "../../common/pdfText";

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

export interface HaccpMenuGroup { category: string; items: string[] }
export interface HaccpEquipmentLine { label: string; quantity: number }

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
  renderedBody: string | null;
  menuGroups: HaccpMenuGroup[];
  equipment: HaccpEquipmentLine[];
  createdAt: string | null;
  /** Which sections this document actually wants — see haccp.routes.ts's HACCP_PLAN_COMPONENTS. */
  components: string[];
}

class Cursor {
  constructor(private page: PDFPage, private font: PDFFont, private bold: PDFFont, private top: number) {}
  text(x: number, yFromTop: number, str: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center" } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const safeStr = pdfSafeText(str);
    const width = font.widthOfTextAtSize(safeStr, size);
    const drawX = opts.align === "right" ? x - width : opts.align === "center" ? x - width / 2 : x;
    this.page.drawText(safeStr, { x: drawX, y: this.top - yFromTop, size, font, color: opts.color ?? INK });
  }
  line(x1: number, y1: number, x2: number, y2: number, color = LINE, thickness = 0.75) {
    this.page.drawLine({ start: { x: x1, y: this.top - y1 }, end: { x: x2, y: this.top - y2 }, thickness, color });
  }
  rect(x: number, y: number, w: number, h: number, color = TEAL) {
    this.page.drawRectangle({ x, y: this.top - y - h, width: w, height: h, color });
  }
  /** Small solid square — used as a "confirmed/included" checklist marker instead of a plain "-" dash. */
  checkbox(x: number, yFromTop: number, size = 6) {
    this.page.drawRectangle({ x, y: this.top - yFromTop - size + 1, width: size, height: size, color: TEAL });
  }
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  // Sanitize before measuring: widthOfTextAtSize throws on characters WinAnsi
  // can't encode, so an unsanitized string would crash here even though the
  // Cursor.text() draw path is already safe.
  const words = pdfSafeText(text).split(" ");
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

/**
 * Diagonal, low-contrast watermark across the page body (not the margin) —
 * the footer notice alone survives printing but sits in a strip that's easy
 * to crop off a photocopy or scan without touching the content; a page's
 * CCP text is otherwise generic boilerplate with nothing else identifying
 * which business it belongs to. Overlaying the watermark across the body
 * means removing it also removes the content, which defeats the point of
 * lifting the page in the first place.
 */
function drawWatermark(page: PDFPage, font: PDFFont, businessName: string) {
  page.drawText(pdfSafeText(`PREPARED FOR ${businessName.toUpperCase()}`), {
    x: 60, y: 330, size: 26, font, color: rgb(0.88, 0.88, 0.88), rotate: degrees(35),
  });
}

function newPage(doc: PDFDocument, font: PDFFont, bold: PDFFont, businessName: string): { page: PDFPage; c: Cursor } {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  drawWatermark(page, font, businessName);
  const c = new Cursor(page, font, bold, PAGE_H);
  c.rect(0, 0, PAGE_W, 6, TEAL);
  return { page, c };
}

/**
 * Multi-line footer on every page — identifies which business/plan a page
 * belongs to if pages get separated or mixed with another printed plan, plus
 * a brief exclusive-use notice (this is the firm's prepared work product for
 * one specific business, not a template another business can reuse). The
 * citation/notice line is wrapped rather than a single drawText call — a
 * long business name pushes it well past one line at the small footer size.
 */
function drawFooter(c: Cursor, font: PDFFont, businessName: string, jurisdiction: string, pageLabel: string, docTypeLabel: string) {
  const maxWidth = PAGE_W - 96;
  c.text(48, PAGE_H - 40, `${businessName} — ${docTypeLabel}`, { size: 8, bold: true });
  c.text(PAGE_W - 48, PAGE_H - 40, pageLabel, { size: 8, color: MUTED, align: "right" });
  const notice = `Prepared in accordance with Maryland COMAR 10.15.03 and ${jurisdiction} Health Department HACCP Guidelines. Prepared exclusively for ${businessName} — not for use by any other business.`;
  const lines = wrapText(notice, font, 7, maxWidth);
  lines.forEach((line, i) => c.text(48, PAGE_H - 28 + i * 9, line, { size: 7, color: MUTED }));
}

export async function generateHaccpPdf(data: HaccpPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const L = 48, R = PAGE_W - 48;
  const maxWidth = R - L;
  const hasHaccpPlan = data.components.includes("haccp_plan") && Boolean(data.renderedBody);
  const hasMenuEquipment = data.components.includes("menu_equipment");
  const docTypeLabel = hasHaccpPlan ? "HACCP Plan" : "Menu & Equipment List";
  const titleBannerText = hasHaccpPlan
    ? "HAZARD ANALYSIS CRITICAL CONTROL POINT (HACCP) PLAN"
    : "MENU & EQUIPMENT LIST";

  // ---- Cover sheet ----
  // Same rhythm as the Word doc's cover (title banner → business/filing
  // details → big gap → a plain contact block at the bottom) — only the
  // layout moved to match; the teal accent stays, since that's the one
  // piece of the PDF's look that's being kept as-is.
  let { page, c } = newPage(doc, font, bold, data.businessName);
  let y = 56;

  c.rect(L, y, R - L, 64, TEAL_TINT);
  c.text(PAGE_W / 2, y + 26, titleBannerText, { size: 15, bold: true, align: "center" });
  c.text(PAGE_W / 2, y + 46, `Prepared in accordance with Maryland COMAR 10.15.03 and ${data.jurisdiction} Health Department HACCP Guidelines`, { size: 9, color: MUTED, align: "center" });
  y += 64;
  y += 26;

  // Business identity + filing metadata — no longer boxed with the title,
  // just its own block; phone/email/contact-person moved down to the
  // bottom contact block (mirroring Word) instead of appearing twice.
  const blockTop = y;
  let leftY = blockTop;
  c.text(L, leftY, data.businessName, { size: 14, bold: true });
  leftY += 18;
  c.text(L, leftY, data.businessTypeLabel, { size: 10, color: TEAL, bold: true });
  leftY += 16;
  const addressParts = [data.streetAddress, [data.city, data.state, data.zipCode].filter(Boolean).join(", ")].filter(Boolean);
  if (addressParts.length) { c.text(L, leftY, addressParts.join(" — "), { size: 9.5 }); leftY += 14; }
  if (data.licenseNumber) { c.text(L, leftY, `License/Permit #: ${data.licenseNumber}`, { size: 9.5 }); leftY += 14; }

  // Left-aligned at a fixed X (not right-aligned) — right-aligning each line
  // gave every line a different starting position depending on its own
  // length ("Risk Priority: Moderate" vs "Jurisdiction: Baltimore City"),
  // which read as a ragged, hard-to-scan block. A shared left edge reads
  // normally, left to right, like the rest of the page.
  const metaX = R - 175;
  let rightY = blockTop + 4;
  c.text(metaX, rightY, `Risk Priority: ${data.riskPriority}`, { size: 9.5, bold: true, color: TEAL });
  rightY += 14;
  c.text(metaX, rightY, `Jurisdiction: ${data.jurisdiction}`, { size: 9.5 });
  rightY += 14;
  c.text(metaX, rightY, `Prepared: ${fmtDate(data.createdAt)}`, { size: 9.5 });
  rightY += 14;
  c.text(metaX, rightY, `Plan ID: ${data.planId}`, { size: 8, color: MUTED });
  rightY += 14;

  y = Math.max(leftY, rightY) + 12;
  c.line(L, y, R, y, LINE, 0.75);
  y += 28;

  // "At a Glance" summary panel — this used to be a large empty gap between
  // the business-info block and the contact block. A one-page cover with
  // nothing but a title and an address reads as unfinished; a quick count of
  // what's actually in the plan gives the reader something real to look at
  // before flipping to the detail pages.
  const totalMenuItems = data.menuGroups.reduce((n, g) => n + g.items.length, 0);
  const panelH = 92;
  c.rect(L, y, R - L, panelH, TEAL_TINT);
  c.text(L + 16, y + 22, "AT A GLANCE", { size: 9, bold: true, color: TEAL });
  const stats: [string, string][] = [
    ["Menu categories covered", String(data.menuGroups.length)],
    ["Menu items on file", String(totalMenuItems)],
    ["Equipment on file", String(data.equipment.length)],
    ...(hasHaccpPlan ? ([["Critical control processes", "3"]] as [string, string][]) : []),
  ];
  const colGap = (R - L - 32) / 2;
  stats.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const sx = L + 16 + col * colGap;
    const sy = y + 42 + row * 26;
    c.text(sx, sy, value, { size: 15, bold: true });
    c.text(sx + 34, sy - 4, label, { size: 8.5, color: MUTED });
  });
  y += panelH + 20;

  // Then the contact block — same "CONTACT PERSON / PHONE NUMBER / EMAIL"
  // centered layout the Word doc's cover already has.
  y += 40;
  function coverContactLine(label: string, value?: string | null) {
    if (!value) return;
    const labelText = `${label}: `;
    const labelW = font.widthOfTextAtSize(labelText, 9.5);
    const valueW = bold.widthOfTextAtSize(value, 9.5);
    const startX = PAGE_W / 2 - (labelW + valueW) / 2;
    c.text(startX, y, labelText, { size: 9.5, color: MUTED });
    c.text(startX + labelW, y, value, { size: 9.5, bold: true });
    y += 15;
  }
  coverContactLine("CONTACT PERSON", data.contactPerson);
  coverContactLine("PHONE NUMBER", data.phone);
  coverContactLine("EMAIL", data.email);

  drawFooter(c, font, data.businessName, data.jurisdiction, "Page 1", docTypeLabel);
  let pageNum = 1;

  // ---- Menu & Equipment checklist (its own page, up front, with a business-info recap banner) — only when actually requested ----
  if (hasMenuEquipment) {
  ({ page, c } = newPage(doc, font, bold, data.businessName));
  pageNum += 1;
  drawFooter(c, font, data.businessName, data.jurisdiction, `Page ${pageNum}`, docTypeLabel);
  y = 48;

  c.rect(L, y, R - L, 40, TEAL_TINT);
  c.text(L + 12, y + 17, data.businessName, { size: 12.5, bold: true });
  c.text(L + 12, y + 32, data.businessTypeLabel, { size: 9, color: TEAL, bold: true });
  const bannerAddr = [data.streetAddress, [data.city, data.state, data.zipCode].filter(Boolean).join(", ")].filter(Boolean).join(" — ");
  if (bannerAddr) c.text(R - 12, y + 17, bannerAddr, { size: 8.5, align: "right" });
  c.text(R - 12, y + 32, data.jurisdiction, { size: 8.5, color: MUTED, align: "right" });
  y += 56;

  c.text(L, y, "MENU", { size: 12.5, bold: true, color: TEAL });
  y += 8;
  c.line(L, y, R, y, LINE, 0.75);
  y += 16;
  if (!data.menuGroups.length) {
    c.text(L, y, "(none selected)", { size: 9.5, color: MUTED });
    y += 16;
  }
  // Two-column checklist with a small solid-square marker per item, instead
  // of one plain "- item" column — a business with a real menu (a full-size
  // restaurant can easily run 80-100+ items once real dish names are added,
  // not just the ~35 generic master categories) used to print as several
  // pages of a bare single-column list. Category header gets a light tint
  // band so a long menu still reads as sectioned, not a wall of text.
  const colGapMenu = 24;
  const colWidthMenu = (R - L - 28 - colGapMenu) / 2;
  const leftColX = L + 14;
  const rightColX = leftColX + colWidthMenu + colGapMenu;
  for (const group of data.menuGroups) {
    if (y > PAGE_H - 70) { pageNum += 1; ({ page, c } = newPage(doc, font, bold, data.businessName)); y = 56; drawFooter(c, font, data.businessName, data.jurisdiction, `Page ${pageNum}`, docTypeLabel); }
    c.rect(L, y, R - L, 16, TEAL_TINT);
    c.text(L + 8, y + 11, group.category, { size: 9.5, bold: true, color: TEAL });
    y += 24;
    for (let i = 0; i < group.items.length; i += 2) {
      const leftItem = group.items[i];
      const rightItem = group.items[i + 1];
      const leftLines = wrapText(leftItem, font, 9, colWidthMenu - 14);
      const rightLines = rightItem ? wrapText(rightItem, font, 9, colWidthMenu - 14) : [];
      const rowLines = Math.max(leftLines.length, rightLines.length || 1);
      if (y + rowLines * 12 > PAGE_H - 60) { pageNum += 1; ({ page, c } = newPage(doc, font, bold, data.businessName)); y = 56; drawFooter(c, font, data.businessName, data.jurisdiction, `Page ${pageNum}`, docTypeLabel); }
      c.checkbox(leftColX, y - 7);
      leftLines.forEach((line, li) => c.text(leftColX + 12, y + li * 12, line, { size: 9 }));
      if (rightItem) {
        c.checkbox(rightColX, y - 7);
        rightLines.forEach((line, li) => c.text(rightColX + 12, y + li * 12, line, { size: 9 }));
      }
      y += rowLines * 12 + 4;
    }
    y += 10;
  }
  }

  // ---- Body: CCP sections, general handling/training — starts on its own fresh page, only when a HACCP plan was actually requested ----
  if (hasHaccpPlan) {
  y = 60;
  ({ page, c } = newPage(doc, font, bold, data.businessName));
  pageNum += 1;
  drawFooter(c, font, data.businessName, data.jurisdiction, `Page ${pageNum}`, docTypeLabel);

  const paragraphs = (data.renderedBody || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  for (const para of paragraphs) {
    const rawLines = para.split("\n");
    for (const rawLine of rawLines) {
      const isSectionHeader = /^[A-Z][A-Z0-9 &().,/'-]{3,}$/.test(rawLine) && rawLine === rawLine.toUpperCase();
      const ccpLabelMatch = rawLine.match(CCP_LABEL_RE);

      if (isSectionHeader) {
        if (y > PAGE_H - 60) { pageNum += 1; ({ page, c } = newPage(doc, font, bold, data.businessName)); y = 56; drawFooter(c, font, data.businessName, data.jurisdiction, `Page ${pageNum}`, docTypeLabel); }
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
        const labelW = bold.widthOfTextAtSize(pdfSafeText(label), 9.5);
        if (y > PAGE_H - 60) { pageNum += 1; ({ page, c } = newPage(doc, font, bold, data.businessName)); y = 56; drawFooter(c, font, data.businessName, data.jurisdiction, `Page ${pageNum}`, docTypeLabel); }
        c.text(L, y, label, { size: 9.5, bold: true });
        const wrapped = wrapText(rest, font, 9.5, maxWidth - labelW);
        wrapped.forEach((line, i) => {
          if (i > 0 && y > PAGE_H - 60) { pageNum += 1; ({ page, c } = newPage(doc, font, bold, data.businessName)); y = 56; drawFooter(c, font, data.businessName, data.jurisdiction, `Page ${pageNum}`, docTypeLabel); }
          c.text(i === 0 ? L + labelW : L + 14, y, line, { size: 9.5 });
          y += 13;
        });
        continue;
      }

      const isSubHeader = /^Process \d/i.test(rawLine.trim());
      for (const wrapped of wrapText(rawLine, font, 9.5, maxWidth)) {
        if (y > PAGE_H - 60) { pageNum += 1; ({ page, c } = newPage(doc, font, bold, data.businessName)); y = 56; drawFooter(c, font, data.businessName, data.jurisdiction, `Page ${pageNum}`, docTypeLabel); }
        c.text(L, y, wrapped, isSubHeader ? { size: 10, bold: true, color: TEAL } : { size: 9.5 });
        y += 13;
      }
    }
    y += 9;
  }
  }

  // ---- Equipment List — true final section, matching the Word doc, always
  // starting on its own fresh page rather than flowing wherever the Body
  // happened to end. Only when Menu & Equipment was actually requested. ----
  if (hasMenuEquipment) {
  pageNum += 1;
  ({ page, c } = newPage(doc, font, bold, data.businessName));
  y = 56;
  drawFooter(c, font, data.businessName, data.jurisdiction, `Page ${pageNum}`, docTypeLabel);
  c.text(L, y, "EQUIPMENT LIST", { size: 12.5, bold: true, color: TEAL });
  y += 8;
  c.line(L, y, R, y, LINE, 0.75);
  y += 16;
  if (!data.equipment.length) {
    c.text(L, y, "(none selected)", { size: 9.5, color: MUTED });
    y += 16;
  }
  // Same two-column checklist treatment as the Menu page, for the same
  // reason — a well-equipped kitchen easily lists 20-30+ pieces.
  const colGapEquip = 24;
  const colWidthEquip = (R - L - colGapEquip) / 2;
  const leftEquipX = L;
  const rightEquipX = leftEquipX + colWidthEquip + colGapEquip;
  for (let i = 0; i < data.equipment.length; i += 2) {
    const leftItem = data.equipment[i];
    const rightItem = data.equipment[i + 1];
    const leftLabel = `${leftItem.label}${leftItem.quantity > 1 ? ` (x${leftItem.quantity})` : ""}`;
    const rightLabel = rightItem ? `${rightItem.label}${rightItem.quantity > 1 ? ` (x${rightItem.quantity})` : ""}` : "";
    const leftLines = wrapText(leftLabel, font, 9.5, colWidthEquip - 14);
    const rightLines = rightItem ? wrapText(rightLabel, font, 9.5, colWidthEquip - 14) : [];
    const rowLines = Math.max(leftLines.length, rightLines.length || 1);
    if (y + rowLines * 13 > PAGE_H - 60) { pageNum += 1; ({ page, c } = newPage(doc, font, bold, data.businessName)); y = 56; drawFooter(c, font, data.businessName, data.jurisdiction, `Page ${pageNum}`, docTypeLabel); }
    c.checkbox(leftEquipX, y - 7);
    leftLines.forEach((line, li) => c.text(leftEquipX + 12, y + li * 13, line, { size: 9.5 }));
    if (rightItem) {
      c.checkbox(rightEquipX, y - 7);
      rightLines.forEach((line, li) => c.text(rightEquipX + 12, y + li * 13, line, { size: 9.5 }));
    }
    y += rowLines * 13 + 4;
  }
  }

  return doc.save();
}
