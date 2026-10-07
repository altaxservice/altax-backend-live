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
import { tidyAddress } from "../govForms/billOfSale";
import { groupEquipment } from "./haccpContent";
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
const CCP_FIELD_ORDER = ["CCP & EQUIPMENT", "MONITORING", "CORRECTIVE ACTION", "VERIFICATION"];
const CCP_COLUMN_LABELS = ["CCP Procedures & Equipment", "Monitoring", "Corrective Action", "Verification"];
// Bolds a short lead-in phrase ("Approved Food Sources.") before the rest of a
// numbered general-handling line — same pattern haccpDocx.ts already uses, so
// the two formats read the same way instead of the PDF being the plainer one.
const LEAD_IN_RE = /^(\d+\.\s*)?([A-Z][A-Za-z0-9 &/'-]{2,50}[.:])\s+(.+)$/;

/** The firm works in Eastern time — a plan built at 9 PM on Oct 6 is dated 10/6, not the UTC date 10/7. */
function fmtDate(v: unknown): string {
  const d = v ? new Date(v as string) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", year: "numeric" });
}

/** "131 1/2 Back River Neck Rd — Essex, MD 21221": normal case, single spaces, "ST ZIP" together. */
function addressLine(data: { streetAddress?: string | null; city?: string | null; state?: string | null; zipCode?: string | null }): string {
  const squish = (v?: string | null) => String(v || "").replace(/\s+/g, " ").trim();
  const street = tidyAddress(squish(data.streetAddress)) || "";
  const city = tidyAddress(squish(data.city)) || "";
  const stateZip = [squish(data.state), squish(data.zipCode)].filter(Boolean).join(" ");
  return [street, [city, stateZip].filter(Boolean).join(", ")].filter(Boolean).join(" — ");
}

export interface HaccpMenuGroup { category: string; items: string[] }
export interface HaccpEquipmentLine { label: string; quantity: number; model?: string; key?: string }

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
  riskPriority: "High" | "Moderate" | "Low";
  renderedBody: string | null;
  menuGroups: HaccpMenuGroup[];
  equipment: HaccpEquipmentLine[];
  createdAt: string | null;
  /** The priority-assessment facts for this business type (foods, food service system, population served) and why it lands on its level. */
  priorityAssessment?: { foods: string; system: string; population: string } | null;
  priorityReason?: string | null;
  /** Which sections this document actually wants — see haccp.routes.ts's HACCP_PLAN_COMPONENTS. */
  components: string[];
}

/**
 * Text width the way pdf-lib actually DRAWS it. widthOfTextAtSize() subtracts kerning, but drawText()
 * doesn't apply it, so a label measured that way ("CROSS-CONTAMINATION:") is drawn wider than measured
 * and the next piece of text lands on top of it. Summing single characters has no kerning to subtract.
 */
function drawnWidth(font: PDFFont, text: string, size: number): number {
  let w = 0;
  for (const ch of pdfSafeText(text)) w += font.widthOfTextAtSize(ch, size);
  return w;
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
  const text = pdfSafeText(`PREPARED FOR ${businessName.toUpperCase()}`);
  // Shrink a long name so the whole thing fits along the diagonal instead of running off the page.
  const size = Math.max(11, Math.min(26, 560 / Math.max(font.widthOfTextAtSize(text, 1), 1)));
  page.drawText(text, { x: 60, y: 330, size, font, color: rgb(0.88, 0.88, 0.88), rotate: degrees(35) });
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
  const coverAddress = addressLine(data);
  if (coverAddress) { c.text(L, leftY, coverAddress, { size: 9.5 }); leftY += 14; }
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
  // How many CCP processes the plan really contains — one per "Process:" heading in its body (this used to print a fixed 3).
  const bodyLines = (data.renderedBody || "").split("\n").map((l) => l.trim());
  const ccpProcessCount = bodyLines.filter((l) => /^Process\b/i.test(l)).length || bodyLines.filter((l) => /^CCP & EQUIPMENT:/.test(l)).length;
  const totalMenuItems = data.menuGroups.reduce((n, g) => n + g.items.length, 0);
  const panelH = 92;
  c.rect(L, y, R - L, panelH, TEAL_TINT);
  c.text(L + 16, y + 22, "AT A GLANCE", { size: 9, bold: true, color: TEAL });
  const stats: [string, string][] = [
    ["Menu categories covered", String(data.menuGroups.length)],
    ["Menu items on file", String(totalMenuItems)],
    ["Equipment on file", String(data.equipment.length)],
    ...(hasHaccpPlan ? ([["Critical control processes", String(ccpProcessCount)]] as [string, string][]) : []),
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
    const labelW = drawnWidth(font, labelText, 9.5);
    const valueW = drawnWidth(bold, value, 9.5);
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

  // Shared by the Menu table and the CCP tables below — starts a fresh page
  // (redrawing the footer) whenever the next block of content wouldn't fit,
  // so every table-drawing helper can just ask for the room it needs instead
  // of repeating this same page-break check inline everywhere.
  function ensurePdfSpace(neededH: number): boolean {
    if (y + neededH > PAGE_H - 60) {
      pageNum += 1;
      ({ page, c } = newPage(doc, font, bold, data.businessName));
      y = 56;
      drawFooter(c, font, data.businessName, data.jurisdiction, `Page ${pageNum}`, docTypeLabel);
      return true;
    }
    return false;
  }

  // ---- Menu & Equipment checklist (its own page, up front, with a business-info recap banner) — only when actually requested ----
  if (hasMenuEquipment) {
  ({ page, c } = newPage(doc, font, bold, data.businessName));
  pageNum += 1;
  drawFooter(c, font, data.businessName, data.jurisdiction, `Page ${pageNum}`, docTypeLabel);
  y = 48;

  c.rect(L, y, R - L, 40, TEAL_TINT);
  c.text(L + 12, y + 17, data.businessName, { size: 12.5, bold: true });
  c.text(L + 12, y + 32, data.businessTypeLabel, { size: 9, color: TEAL, bold: true });
  const bannerAddr = addressLine(data);
  if (bannerAddr) c.text(R - 12, y + 17, bannerAddr, { size: 8.5, align: "right" });
  c.text(R - 12, y + 32, data.jurisdiction, { size: 8.5, color: MUTED, align: "right" });
  y += 56;

  // No HACCP plan in this document: print the priority assessment the health department classifies the facility from.
  if (!hasHaccpPlan && data.priorityAssessment) {
    c.text(L, y, "PRIORITY ASSESSMENT INFORMATION", { size: 12.5, bold: true, color: TEAL });
    y += 8;
    c.line(L, y, R, y, LINE, 0.75);
    y += 16;
    const rows: [string, string][] = [
      ["Foods", data.priorityAssessment.foods],
      ["Food service system", data.priorityAssessment.system],
      ["Population served", data.priorityAssessment.population],
    ];
    for (const [label, text] of rows) {
      const lines = wrapText(text, font, 9.5, maxWidth - 120);
      ensurePdfSpace(lines.length * 13 + 6);
      c.text(L, y, label, { size: 9.5, bold: true });
      lines.forEach((line, i) => c.text(L + 120, y + i * 13, line, { size: 9.5 }));
      y += lines.length * 13 + 6;
    }
    if (data.priorityReason) {
      const reasonLines = wrapText(`Priority: ${data.priorityReason}`, font, 9, maxWidth);
      ensurePdfSpace(reasonLines.length * 12 + 10);
      reasonLines.forEach((line) => { c.text(L, y, line, { size: 9, color: MUTED }); y += 12; });
    }
    y += 10;
  }

  c.text(L, y, "MENU", { size: 12.5, bold: true, color: TEAL });
  y += 8;
  c.line(L, y, R, y, LINE, 0.75);
  y += 16;
  if (!data.menuGroups.length) {
    c.text(L, y, "(none selected)", { size: 9.5, color: MUTED });
    y += 16;
  }
  // A real bordered 2-column table with a full-width gray category-header
  // row per section — matches the reference plan's own Menu page and
  // haccpDocx.ts's menuTable(), instead of a borderless checkbox checklist.
  // Still 2 items per row (not 1) for the same reason the old layout was:
  // a full-size restaurant's real menu can run 80-100+ items once real dish
  // names are added on top of the ~35 generic master categories.
  const menuColW = (R - L) / 2;
  function menuCategoryRow(category: string) {
    ensurePdfSpace(20);
    c.rect(L, y, R - L, 16, TEAL_TINT);
    c.text(L + (R - L) / 2, y + 11, category.toUpperCase(), { size: 9.5, bold: true, color: TEAL, align: "center" });
    y += 16;
    c.line(L, y, R, y, INK, 0.75);
  }
  function menuItemRow(leftItem: string | undefined, rightItem: string | undefined) {
    const leftLines = leftItem ? wrapText(leftItem, bold, 9, menuColW - 20) : [];
    const rightLines = rightItem ? wrapText(rightItem, bold, 9, menuColW - 20) : [];
    const rowLines = Math.max(leftLines.length, rightLines.length, 1);
    const rowH = rowLines * 12 + 5;
    ensurePdfSpace(rowH);
    const rowTop = y;
    leftLines.forEach((line, li) => c.text(L + menuColW / 2, rowTop + 11 + li * 12, line, { size: 9, bold: true, align: "center" }));
    rightLines.forEach((line, li) => c.text(L + menuColW + menuColW / 2, rowTop + 11 + li * 12, line, { size: 9, bold: true, align: "center" }));
    y += rowH;
    // Left, middle, and right vertical rules for this row — drawn per row
    // (rather than one tall rect spanning the whole category, which a page
    // break partway through a category would have cut off cleanly anyway).
    c.line(L, rowTop, L, y, LINE, 0.75);
    c.line(L + menuColW, rowTop, L + menuColW, y, LINE, 0.75);
    c.line(R, rowTop, R, y, LINE, 0.75);
    c.line(L, y, R, y, LINE, 0.75);
  }
  for (const group of data.menuGroups) {
    menuCategoryRow(group.category);
    for (let i = 0; i < group.items.length; i += 2) menuItemRow(group.items[i], group.items[i + 1]);
    y += 5;
  }
  }

  // ---- Body: CCP sections, general handling/training — starts on its own fresh page, only when a HACCP plan was actually requested ----
  if (hasHaccpPlan) {
  y = 60;
  ({ page, c } = newPage(doc, font, bold, data.businessName));
  pageNum += 1;
  drawFooter(c, font, data.businessName, data.jurisdiction, `Page ${pageNum}`, docTypeLabel);

  // Real bordered 4-column table for CCP quads — matches haccpDocx.ts's
  // renderBody(), which already parses these exact same label-prefixed lines
  // into a Table; the PDF (what actually gets printed and handed to a health
  // inspector) used to draw them as stacked "LABEL: text" paragraphs instead,
  // which is the "temperature table" formatting Baltimore City Health flagged.
  const ccpColW = maxWidth / CCP_FIELD_ORDER.length;
  const ccpCellPad = 5;
  const ccpLineH = 10.5;
  const ccpFontSize = 8;
  function drawCcpHeaderRow() {
    ensurePdfSpace(24);
    c.rect(L, y, maxWidth, 20, TEAL_TINT);
    CCP_COLUMN_LABELS.forEach((label, i) => {
      c.text(L + i * ccpColW + ccpColW / 2, y + 13, label, { size: 8, bold: true, color: TEAL, align: "center" });
    });
    y += 20;
    for (let i = 0; i <= CCP_FIELD_ORDER.length; i++) c.line(L + i * ccpColW, y - 20, L + i * ccpColW, y, i === 0 || i === CCP_FIELD_ORDER.length ? INK : LINE, 0.75);
    c.line(L, y - 20, R, y - 20, INK, 1);
    c.line(L, y, R, y, INK, 1);
  }
  function drawCcpTable(rows: Record<string, string>[]) {
    if (!rows.length) return;
    y += 4;
    drawCcpHeaderRow();
    for (const row of rows) {
      const cellLines = CCP_FIELD_ORDER.map((key) => wrapText(row[key] || "", font, ccpFontSize, ccpColW - ccpCellPad * 2));
      const rowLineCount = Math.max(...cellLines.map((l) => l.length), 1);
      const rowH = rowLineCount * ccpLineH + ccpCellPad * 2;
      if (ensurePdfSpace(rowH)) drawCcpHeaderRow();
      const rowTop = y;
      cellLines.forEach((lines, i) => {
        lines.forEach((line, li) => c.text(L + i * ccpColW + ccpCellPad, rowTop + ccpCellPad + 7 + li * ccpLineH, line, { size: ccpFontSize }));
      });
      y += rowH;
      for (let i = 0; i <= CCP_FIELD_ORDER.length; i++) c.line(L + i * ccpColW, rowTop, L + i * ccpColW, y, LINE, 0.75);
      c.line(L, y, R, y, LINE, 0.75);
    }
    y += 12;
  }

  let pendingCcpRow: Record<string, string> = {};
  let pendingCcpRows: Record<string, string>[] = [];
  function flushCcpRow() {
    if (Object.keys(pendingCcpRow).length) { pendingCcpRows.push(pendingCcpRow); pendingCcpRow = {}; }
  }
  function flushCcpTable() {
    flushCcpRow();
    if (pendingCcpRows.length) drawCcpTable(pendingCcpRows);
    pendingCcpRows = [];
  }

  // Flat line-by-line pass over the WHOLE body (not paragraph-batched) — same
  // as haccpDocx.ts's renderBody(). A blank line is just spacing, not a table
  // boundary, so two CCP quads separated only by a blank line still merge
  // into one table; only a Process/Section header line (or the body ending)
  // actually closes it.
  for (const rawLine of (data.renderedBody || "").split("\n")) {
    const line = rawLine.trim();
    if (!line) { y += 7; continue; }

    const ccpLabelMatch = line.match(CCP_LABEL_RE);
    if (ccpLabelMatch) {
      pendingCcpRow[ccpLabelMatch[1]] = line.slice(ccpLabelMatch[0].length);
      continue;
    }
    flushCcpTable();

    const isSectionHeader = /^[A-Z][A-Z0-9 &().,/'-]{3,}$/.test(line) && line === line.toUpperCase();
    if (isSectionHeader) {
      ensurePdfSpace(76); // heading + at least the first few lines of its text on the same page
      y += 6;
      c.text(L, y, line, { size: 11.5, bold: true, color: TEAL });
      y += 8;
      c.line(L, y, R, y, LINE, 0.75);
      y += 14;
      continue;
    }

    const isSubHeader = /^Process \d/i.test(line);
    if (isSubHeader) {
      ensurePdfSpace(20);
      c.text(L, y, line, { size: 10, bold: true, color: TEAL });
      y += 15;
      continue;
    }

    const leadMatch = line.match(LEAD_IN_RE);
    if (leadMatch) {
      const [, numPrefix, lead, rest] = leadMatch;
      const numW = drawnWidth(font, numPrefix || "", 9.5);
      const prefixW = numW + drawnWidth(bold, `${lead} `, 9.5);
      ensurePdfSpace(16);
      c.text(L, y, numPrefix || "", { size: 9.5 });
      c.text(L + numW, y, `${lead} `, { size: 9.5, bold: true, color: TEAL });
      const wrapped = wrapText(rest, font, 9.5, maxWidth - prefixW);
      wrapped.forEach((wline, i) => {
        if (i > 0) ensurePdfSpace(13);
        c.text(i === 0 ? L + prefixW : L + 14, y, wline, { size: 9.5 });
        y += 13;
      });
      continue;
    }

    for (const wrapped of wrapText(line, font, 9.5, maxWidth)) {
      ensurePdfSpace(13);
      c.text(L, y, wrapped, { size: 9.5 });
      y += 13;
    }
  }
  flushCcpTable();
  }

  // ---- Equipment List — true final section, matching the Word doc, always
  // starting on its own fresh page rather than flowing wherever the Body
  // happened to end. Only when Menu & Equipment was actually requested. ----
  if (hasMenuEquipment) {
  if (hasHaccpPlan) {
    pageNum += 1;
    ({ page, c } = newPage(doc, font, bold, data.businessName));
    y = 56;
    drawFooter(c, font, data.businessName, data.jurisdiction, `Page ${pageNum}`, docTypeLabel);
  } else {
    // A stand-alone Menu & Equipment List flows on: the equipment follows the menu instead of sitting alone on a new page.
    y += 4;
    ensurePdfSpace(34 + Math.ceil(data.equipment.length / 2) * 17);
  }
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
  for (const grp of groupEquipment(data.equipment.map((e) => ({ ...e, key: e.key || e.label })))) {
  // Section heading — kept with at least its first row.
  if (y + 40 > PAGE_H - 60) { pageNum += 1; ({ page, c } = newPage(doc, font, bold, data.businessName)); y = 56; drawFooter(c, font, data.businessName, data.jurisdiction, `Page ${pageNum}`, docTypeLabel); }
  c.text(L, y, grp.group, { size: 9.5, bold: true, color: MUTED });
  y += 14;
  for (let i = 0; i < grp.items.length; i += 2) {
    const leftItem = grp.items[i];
    const rightItem = grp.items[i + 1];
    const leftLabel = `${leftItem.label}${leftItem.quantity > 1 ? ` (x${leftItem.quantity})` : ""}${leftItem.model ? ` - ${leftItem.model}` : ""}`;
    const rightLabel = rightItem ? `${rightItem.label}${rightItem.quantity > 1 ? ` (x${rightItem.quantity})` : ""}${rightItem.model ? ` - ${rightItem.model}` : ""}` : "";
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
  y += 6;
  }
  }

  return doc.save();
}
