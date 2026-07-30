/**
 * Estimate PDF — hand-drawn (pdf-lib), matching the firm's own invoicePdf.ts
 * conventions (same header layout, fonts, fitText helper) so an estimate and
 * the invoice it becomes look like they came from the same firm.
 *
 * Government and AL TAX service fees print as two separate, labeled sections
 * rather than one merged table — the whole point of quoting this way is that
 * the client can see what's a pass-through agency cost versus what they're
 * paying AL TAX for its own work, not one opaque lump sum.
 *
 * Paginates properly: a Baltimore City food-service job easily runs to 10+
 * government fee lines, and invoicePdf.ts's original single-page approach
 * (silently dropping lines past a fixed cutoff while the printed TOTAL still
 * included them) would hand the client a total that didn't match what's
 * listed above it — worse than not sending the PDF at all.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { getFirmProfile } from "../../common/firmProfile";
import { embedFirmLogo } from "../../common/pdfLogo";
import { pdfSafeText } from "../../common/pdfText";

const PAGE_W = 612;
const PAGE_H = 792;
const L = 48, R = PAGE_W - 48;
/** Nothing is drawn below this line — leaves room for the footer note on every page. */
const BOTTOM = PAGE_H - 56;
const TOP_MARGIN = 50;

const INK = rgb(0.09, 0.09, 0.09);
const MUTED = rgb(0.4, 0.4, 0.4);
const LINE = rgb(0.75, 0.75, 0.75);
const TEAL = rgb(0.043, 0.42, 0.42);

function money(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";
}
function fmtDate(v: unknown): string {
  if (!v) return "";
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

function fitText(font: PDFFont, str: string, size: number, maxWidth: number): string {
  const safe = pdfSafeText(str);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let s = safe;
  while (s.length > 1 && font.widthOfTextAtSize(s.trimEnd() + "...", size) > maxWidth) s = s.slice(0, -1);
  return s.trimEnd() + "...";
}

class Cursor {
  constructor(private page: PDFPage, private font: PDFFont, private bold: PDFFont, private top: number) {}
  text(x: number, yFromTop: number, str: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const safeStr = pdfSafeText(str);
    const width = opts.align === "right" ? font.widthOfTextAtSize(safeStr, size) : 0;
    this.page.drawText(safeStr, { x: x - width, y: this.top - yFromTop, size, font, color: opts.color ?? INK });
  }
  line(x1: number, y1: number, x2: number, y2: number, color = LINE, thickness = 0.75) {
    this.page.drawLine({ start: { x: x1, y: this.top - y1 }, end: { x: x2, y: this.top - y2 }, thickness, color });
  }
  rect(x: number, y: number, w: number, h: number, color = TEAL) {
    this.page.drawRectangle({ x, y: this.top - y - h, width: w, height: h, color });
  }
}

export interface EstimatePdfLine {
  description: string;
  category: "Government" | "Service";
  agency?: string | null;
  qty: number;
  amount: number; // already resolved — percentage lines pass their computed dollar amount
  included: boolean;
  payer: "Firm" | "Client";
}

export interface EstimatePdfData {
  estimateId: string;
  estimateNumber: string;
  status: string;
  estimateDate: string | null;
  validUntil: string | null;
  businessName: string;
  contactName: string | null;
  address: string | null;
  entityType: string | null;
  businessType: string | null;
  jurisdiction: string | null;
  speed: string | null;
  lines: EstimatePdfLine[];
  serviceTotal: number;
  governmentTotal: number;
  clientDirectTotal: number;
  discount: number;
  discountPercent?: number;
  taxRate: number;
  tax: number;
  total: number;
  deposit: number;
  balanceDue: number;
  terms: string | null;
  preparedBy: string | null;
}

export async function generateEstimatePdf(data: EstimatePdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const profile = await getFirmProfile();
  const logo = await embedFirmLogo(doc, profile);

  // Mutable render position — reassigned by newPage() whenever content would
  // otherwise run past BOTTOM, so every section (line items, totals, notes)
  // flows onto a continuation page instead of being silently cut off.
  const ctx: { page: PDFPage; c: Cursor; y: number } = {
    page: doc.addPage([PAGE_W, PAGE_H]),
    c: null as unknown as Cursor,
    y: TOP_MARGIN,
  };
  ctx.c = new Cursor(ctx.page, font, bold, PAGE_H);

  function newPage() {
    ctx.page = doc.addPage([PAGE_W, PAGE_H]);
    ctx.c = new Cursor(ctx.page, font, bold, PAGE_H);
    ctx.c.rect(0, 0, PAGE_W, 8);
    ctx.y = TOP_MARGIN;
    ctx.c.text(L, ctx.y, `${profile.firmName} — Estimate ${data.estimateNumber} (continued)`, { size: 9, bold: true, color: MUTED });
    ctx.y += 16;
    ctx.c.line(L, ctx.y, R, ctx.y, LINE, 0.5);
    ctx.y += 20;
  }

  /** Starts a new page when the next `need` points of content wouldn't fit above BOTTOM. */
  function ensureRoom(need: number) {
    if (ctx.y + need > BOTTOM) newPage();
  }

  // ---- Page 1 header ----
  ctx.c.rect(0, 0, PAGE_W, 8);
  let textL = L;
  if (logo) {
    const logoH = 60;
    const logoW = (logo.width / logo.height) * logoH;
    ctx.page.drawImage(logo, { x: L, y: PAGE_H - ctx.y - logoH + 8, width: logoW, height: logoH });
    textL = L + logoW + 10;
  }
  ctx.c.text(textL, ctx.y, profile.firmName.toUpperCase(), { size: 18, bold: true, color: TEAL });
  ctx.c.text(R, ctx.y, "ESTIMATE", { size: 22, bold: true, align: "right" });
  for (const line of [profile.addressLine1, profile.addressLine2].filter((l) => l && l.trim())) { ctx.y += 13; ctx.c.text(textL, ctx.y, line, { size: 9, color: MUTED }); }
  ctx.y += 13; ctx.c.text(textL, ctx.y, profile.phone, { size: 9, color: MUTED });
  ctx.y += 13; ctx.c.text(textL, ctx.y, profile.email, { size: 9, color: MUTED });
  ctx.y += 24;
  ctx.c.line(L, ctx.y, R, ctx.y, LINE, 1);
  ctx.y += 24;

  const blockTop = ctx.y;
  ctx.c.text(L, blockTop, "Prepared For", { size: 8, bold: true, color: MUTED });
  ctx.c.text(R, blockTop, "Estimate #", { size: 8, bold: true, color: MUTED, align: "right" });

  let leftY = blockTop + 14;
  ctx.c.text(L, leftY, fitText(font, data.businessName, 11, 260), { size: 11, bold: true }); leftY += 15;
  if (data.contactName) { ctx.c.text(L, leftY, fitText(font, data.contactName, 9, 260), { size: 9, color: MUTED }); leftY += 12; }
  if (data.address) { ctx.c.text(L, leftY, fitText(font, data.address, 9, 260), { size: 9, color: MUTED }); leftY += 12; }

  let metaY = blockTop + 14;
  ctx.c.text(R, metaY, data.estimateNumber, { size: 10, align: "right" }); metaY += 16;
  ctx.c.text(R, metaY, "Date", { size: 8, bold: true, color: MUTED, align: "right" }); metaY += 12;
  ctx.c.text(R, metaY, fmtDate(data.estimateDate), { size: 10, align: "right" }); metaY += 16;
  ctx.c.text(R, metaY, "Valid Until", { size: 8, bold: true, color: MUTED, align: "right" }); metaY += 12;
  ctx.c.text(R, metaY, fmtDate(data.validUntil), { size: 10, align: "right" }); metaY += 16;

  ctx.y = Math.max(leftY, metaY) + 8;

  const jobParts = [data.entityType, data.businessType, data.jurisdiction, data.speed ? `${data.speed} filing` : null].filter(Boolean);
  if (jobParts.length) {
    ctx.c.text(L, ctx.y, jobParts.join("  •  "), { size: 9, color: MUTED });
    ctx.y += 20;
  }

  ctx.y += 4;
  ctx.c.line(L, ctx.y, R, ctx.y, INK, 1);
  ctx.y += 16;

  // ---- Line-item sections ----
  const colDesc = L, colQty = R - 190, colAmt = R;
  const descMaxWidth = colQty - colDesc - 20;

  function section(title: string, lines: EstimatePdfLine[]) {
    if (!lines.length) return;
    ensureRoom(34 + 16); // section title + column header + at least one row
    ctx.c.text(L, ctx.y, title, { size: 10, bold: true, color: TEAL });
    ctx.y += 14;
    ctx.c.text(colDesc, ctx.y, "Description", { size: 8, bold: true, color: MUTED });
    ctx.c.text(colQty, ctx.y, "Qty", { size: 8, bold: true, color: MUTED, align: "right" });
    ctx.c.text(colAmt, ctx.y, "Amount", { size: 8, bold: true, color: MUTED, align: "right" });
    ctx.y += 6;
    ctx.c.line(L, ctx.y, R, ctx.y, LINE, 0.5);
    ctx.y += 14;
    for (const line of lines) {
      ensureRoom(16);
      const label = fitText(font, line.agency ? `${line.description} (${line.agency})` : line.description, 10, descMaxWidth);
      ctx.c.text(colDesc, ctx.y, label, { size: 10 });
      ctx.c.text(colQty, ctx.y, String(line.qty), { size: 10, align: "right", color: MUTED });
      const amtLabel = line.included ? "Included" : line.payer === "Client" ? `$${money(line.amount)} *` : `$${money(line.amount)}`;
      ctx.c.text(colAmt, ctx.y, amtLabel, { size: 10, align: "right", color: line.included || line.payer === "Client" ? MUTED : INK });
      ctx.y += 16;
    }
    ctx.y += 10;
  }

  section("AL TAX Service Fees", data.lines.filter((l) => l.category === "Service"));
  section("Government / Agency Fees", data.lines.filter((l) => l.category === "Government" && l.payer === "Firm"));
  const clientDirect = data.lines.filter((l) => l.category === "Government" && l.payer === "Client");
  section("Paid By You Directly to the Agency", clientDirect);
  if (clientDirect.length) {
    ensureRoom(18);
    ctx.c.text(L, ctx.y, "* You pay this fee directly — it is not included in the total below.", { size: 8, color: MUTED });
    ctx.y += 18;
  }

  // ---- Totals ----
  // Reserve room for the whole block up front (title rule + up to 7 rows) so
  // the total line is never split from the rows that justify it onto a
  // different page.
  const totalsRowCount = 3 + (data.discount ? 1 : 0) + (data.taxRate ? 1 : 0) + (data.deposit ? 2 : 0);
  ensureRoom(24 + totalsRowCount * 15 + 14);
  ctx.c.line(L, ctx.y, R, ctx.y, INK, 1);
  ctx.y += 20;

  const summaryX = R - 200;
  ctx.c.text(summaryX, ctx.y, "AL TAX Service Fees", { size: 10, color: MUTED });
  ctx.c.text(R, ctx.y, `$${money(data.serviceTotal)}`, { size: 10, align: "right", color: MUTED });
  ctx.y += 15;
  ctx.c.text(summaryX, ctx.y, "Government / Agency Fees", { size: 10, color: MUTED });
  ctx.c.text(R, ctx.y, `$${money(data.governmentTotal)}`, { size: 10, align: "right", color: MUTED });
  ctx.y += 15;
  if (data.discount) {
    const label = data.discountPercent ? `Discount (${data.discountPercent}%)` : "Discount";
    ctx.c.text(summaryX, ctx.y, label, { size: 10, color: MUTED });
    ctx.c.text(R, ctx.y, `-$${money(data.discount)}`, { size: 10, align: "right", color: MUTED });
    ctx.y += 15;
  }
  if (data.taxRate) {
    ctx.c.text(summaryX, ctx.y, `Tax (${data.taxRate}%)`, { size: 10, color: MUTED });
    ctx.c.text(R, ctx.y, `$${money(data.tax)}`, { size: 10, align: "right", color: MUTED });
    ctx.y += 15;
  }
  ctx.c.line(summaryX, ctx.y, R, ctx.y, LINE, 0.75);
  ctx.y += 14;
  ctx.c.text(summaryX, ctx.y, "Total Estimate", { size: 12, bold: true });
  ctx.c.text(R, ctx.y, `$${money(data.total)}`, { size: 12, bold: true, align: "right" });
  ctx.y += 18;
  if (data.deposit) {
    ctx.c.text(summaryX, ctx.y, "Deposit Due to Start", { size: 10, color: MUTED });
    ctx.c.text(R, ctx.y, `$${money(data.deposit)}`, { size: 10, align: "right", color: MUTED });
    ctx.y += 15;
    ctx.c.text(summaryX, ctx.y, "Balance", { size: 10, color: MUTED });
    ctx.c.text(R, ctx.y, `$${money(data.balanceDue)}`, { size: 10, align: "right", color: MUTED });
    ctx.y += 15;
  }
  ctx.y += 14;

  if (data.terms) {
    ensureRoom(13 + 16);
    ctx.c.text(L, ctx.y, "Notes", { size: 9, bold: true });
    ctx.y += 13;
    ctx.c.text(L, ctx.y, fitText(font, data.terms, 9, R - L), { size: 9, color: MUTED });
    ctx.y += 18;
  }

  // Footer note on whichever page ends up last — Cursor.text is relative to
  // that page's own top, so this always lands at the bottom of the page it's
  // actually called on.
  ctx.c.text(L, PAGE_H - 44, `Prepared by ${data.preparedBy || profile.firmName}. This is an estimate, not an invoice — actual agency fees may change before filing.`, { size: 8, color: MUTED });
  ctx.c.text(L, PAGE_H - 30, "Thank you for considering AL Tax Service.", { size: 9, color: MUTED });

  return doc.save();
}
