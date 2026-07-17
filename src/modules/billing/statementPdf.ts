/**
 * Statement of Account PDF — hand-drawn (pdf-lib), same approach as
 * invoicePdf.ts. Lists every invoice for a client in a date range with a
 * running balance, ending in a total-outstanding summary — the standard
 * "here's what you owe across everything" document, distinct from a
 * single-invoice PDF.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { FIRM_NAME, FIRM_ADDRESS_LINES, FIRM_PHONE, FIRM_EMAIL } from "../../common/firmProfile";

const PAGE_W = 612;
const PAGE_H = 792;
const INK = rgb(0.09, 0.09, 0.09);
const MUTED = rgb(0.4, 0.4, 0.4);
const LINE = rgb(0.75, 0.75, 0.75);
const TEAL = rgb(0.043, 0.42, 0.42);
const ROW_H = 18;

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

export interface StatementInvoiceRow {
  invoiceId: string;
  invoiceDate: string | null;
  description: string | null;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  status: string | null;
}

export interface StatementPdfData {
  clientName: string;
  clientAddress: string | null;
  clientEmail: string | null;
  rangeLabel: string;
  invoices: StatementInvoiceRow[];
}

class Cursor {
  constructor(private page: PDFPage, private font: PDFFont, private bold: PDFFont, private top: number) {}
  text(x: number, yFromTop: number, str: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const width = opts.align === "right" ? font.widthOfTextAtSize(str, size) : 0;
    this.page.drawText(str, { x: x - width, y: this.top - yFromTop, size, font, color: opts.color ?? INK });
  }
  line(x1: number, y1: number, x2: number, y2: number, color = LINE, thickness = 0.75) {
    this.page.drawLine({ start: { x: x1, y: this.top - y1 }, end: { x: x2, y: this.top - y2 }, thickness, color });
  }
  rect(x: number, y: number, w: number, h: number, color = TEAL) {
    this.page.drawRectangle({ x, y: this.top - y - h, width: w, height: h, color });
  }
}

export async function generateStatementPdf(data: StatementPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const L = 48, R = PAGE_W - 48;

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let c = new Cursor(page, font, bold, PAGE_H);

  function drawHeader(): number {
    c.rect(0, 0, PAGE_W, 8);
    let y = 50;
    c.text(L, y, FIRM_NAME.toUpperCase(), { size: 18, bold: true, color: TEAL });
    c.text(R, y, "STATEMENT OF ACCOUNT", { size: 16, bold: true, align: "right" });
    for (const line of FIRM_ADDRESS_LINES) { y += 13; c.text(L, y, line, { size: 9, color: MUTED }); }
    y += 13; c.text(L, y, FIRM_PHONE, { size: 9, color: MUTED });
    y += 13; c.text(L, y, FIRM_EMAIL, { size: 9, color: MUTED });
    y += 20;
    c.line(L, y, R, y, LINE, 1);
    y += 20;
    c.text(L, y, data.clientName, { size: 12, bold: true });
    c.text(R, y, data.rangeLabel, { size: 9, color: MUTED, align: "right" });
    y += 14;
    if (data.clientAddress) { c.text(L, y, data.clientAddress, { size: 9, color: MUTED }); y += 12; }
    if (data.clientEmail) { c.text(L, y, data.clientEmail, { size: 9, color: MUTED }); y += 12; }
    y += 14;
    c.text(L, y, "Invoice #", { size: 8, bold: true, color: MUTED });
    c.text(L + 118, y, "Date", { size: 8, bold: true, color: MUTED });
    c.text(L + 185, y, "Description", { size: 8, bold: true, color: MUTED });
    c.text(R - 200, y, "Total", { size: 8, bold: true, color: MUTED, align: "right" });
    c.text(R - 100, y, "Paid", { size: 8, bold: true, color: MUTED, align: "right" });
    c.text(R, y, "Balance", { size: 8, bold: true, color: MUTED, align: "right" });
    y += 8;
    c.line(L, y, R, y, INK, 1);
    y += 12;
    return y;
  }

  let y = drawHeader();
  let totalBalance = 0;

  for (const inv of data.invoices) {
    if (y > PAGE_H - 100) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      c = new Cursor(page, font, bold, PAGE_H);
      y = drawHeader();
    }
    c.text(L, y, inv.invoiceId, { size: 8 });
    c.text(L + 118, y, fmtDate(inv.invoiceDate), { size: 9 });
    c.text(L + 185, y, (inv.description || "").slice(0, 22), { size: 9, color: MUTED });
    c.text(R - 200, y, `$${money(inv.totalAmount)}`, { size: 9, align: "right" });
    c.text(R - 100, y, `$${money(inv.amountPaid)}`, { size: 9, align: "right", color: MUTED });
    c.text(R, y, `$${money(inv.balanceDue)}`, { size: 9, align: "right" });
    totalBalance += inv.balanceDue;
    y += ROW_H;
  }

  if (data.invoices.length === 0) {
    c.text(L, y, "No invoices in this range.", { size: 9, color: MUTED });
    y += ROW_H;
  }

  y += 10;
  c.line(R - 200, y, R, y, INK, 1);
  y += 16;
  c.text(R - 200, y, "Total Outstanding Balance", { size: 11, bold: true });
  c.text(R, y, `$${money(totalBalance)}`, { size: 12, bold: true, align: "right" });

  return doc.save();
}
