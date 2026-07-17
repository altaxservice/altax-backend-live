/**
 * Invoice PDF — hand-drawn from scratch (pdf-lib primitives), same approach
 * as paycheckPdf.ts: there's no official government form for an invoice.
 * Renders an itemized line-item table (QuickBooks-style, added at the user's
 * request) when the invoice has line items, falling back to the original
 * single description/total layout for older invoices created before this
 * feature existed (no line items on file). Layout matches the firm's real
 * QuickBooks Online invoice screenshots (Bill To/Ship To columns, Activity
 * column formatted as category:name, taxable "T" suffix) — deliberately
 * omits the QR "Scan to pay" code and card-network badges QBO shows, since
 * those link to real online payment collection and no payment processor is
 * connected here; Payment Instructions text remains the only payment guidance.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { FIRM_NAME, FIRM_ADDRESS_LINES, FIRM_PHONE, FIRM_EMAIL } from "../../common/firmProfile";

const PAGE_W = 612;
const PAGE_H = 792;
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
function addressLines(v: string | null | undefined, max: number): string[] {
  return String(v || "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, max);
}

export interface InvoiceLineItemPdfData {
  serviceDate: string | null; productName: string | null; productCategory?: string | null; description: string | null;
  quantity: number; rate: number; amount: number; taxable?: boolean;
}

export interface InvoicePdfData {
  invoiceId: string;
  invoiceDate: string | null;
  dueDate: string | null;
  description: string | null;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  status: string | null;
  clientName: string;
  clientAddress: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  payments: { paymentDate: string | null; actualAmount: number; method: string | null }[];
  terms?: string | null;
  billTo?: string | null;
  shipTo?: string | null;
  shipVia?: string | null;
  shippingDate?: string | null;
  trackingNumber?: string | null;
  paymentInstructions?: string | null;
  clientNote?: string | null;
  lineItems?: InvoiceLineItemPdfData[];
  subtotalAmount?: number | null;
  discountAmount?: number | null;
  salesTaxAmount?: number | null;
  shippingAmount?: number | null;
  depositAmount?: number | null;
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

export async function generateInvoicePdf(data: InvoicePdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const c = new Cursor(page, font, bold, PAGE_H);
  const L = 48, R = PAGE_W - 48, M = L + 175;

  c.rect(0, 0, PAGE_W, 8);

  let y = 50;
  c.text(L, y, FIRM_NAME.toUpperCase(), { size: 18, bold: true, color: TEAL });
  c.text(R, y, "INVOICE", { size: 22, bold: true, align: "right" });
  for (const line of FIRM_ADDRESS_LINES) { y += 13; c.text(L, y, line, { size: 9, color: MUTED }); }
  y += 13; c.text(L, y, FIRM_PHONE, { size: 9, color: MUTED });
  y += 13; c.text(L, y, FIRM_EMAIL, { size: 9, color: MUTED });
  y += 24;

  c.line(L, y, R, y, LINE, 1);
  y += 24;

  const billLines = [data.clientName, ...addressLines(data.billTo || data.clientAddress, 4)];
  const shipRaw = data.shipTo && data.shipTo !== data.billTo ? data.shipTo : null;
  const shipLines = shipRaw ? [data.clientName, ...addressLines(shipRaw, 4)] : [];

  const blockTop = y;
  c.text(L, blockTop, "Bill To", { size: 8, bold: true, color: MUTED });
  if (shipLines.length) c.text(M, blockTop, "Ship To", { size: 8, bold: true, color: MUTED });
  c.text(R, blockTop, "Invoice #", { size: 8, bold: true, color: MUTED, align: "right" });

  let leftY = blockTop + 14;
  billLines.forEach((line, i) => { c.text(L, leftY, line.slice(0, 42), { size: i === 0 ? 11 : 9, bold: i === 0, color: i === 0 ? INK : MUTED }); leftY += i === 0 ? 15 : 12; });
  let shipY = blockTop + 14;
  shipLines.forEach((line, i) => { c.text(M, shipY, line.slice(0, 42), { size: i === 0 ? 11 : 9, bold: i === 0, color: i === 0 ? INK : MUTED }); shipY += i === 0 ? 15 : 12; });

  let metaY = blockTop + 14;
  c.text(R, metaY, data.invoiceId, { size: 10, align: "right" });
  metaY += 16;
  c.text(R, metaY, "Date", { size: 8, bold: true, color: MUTED, align: "right" });
  metaY += 12;
  c.text(R, metaY, fmtDate(data.invoiceDate), { size: 10, align: "right" });
  metaY += 16;
  c.text(R, metaY, "Due Date", { size: 8, bold: true, color: MUTED, align: "right" });
  metaY += 12;
  c.text(R, metaY, fmtDate(data.dueDate), { size: 10, align: "right" });
  metaY += 16;
  if (data.terms) {
    c.text(R, metaY, "Terms", { size: 8, bold: true, color: MUTED, align: "right" });
    metaY += 12;
    c.text(R, metaY, data.terms, { size: 10, align: "right" });
    metaY += 16;
  }

  y = Math.max(leftY, shipY, metaY) + 8;

  if (data.shipVia || data.shippingDate || data.trackingNumber) {
    const parts = [
      data.shipVia ? `Ship via ${data.shipVia}` : null,
      data.shippingDate ? `Shipping date ${fmtDate(data.shippingDate)}` : null,
      data.trackingNumber ? `Tracking # ${data.trackingNumber}` : null,
    ].filter(Boolean);
    c.text(L, y, parts.join("   •   "), { size: 9, color: MUTED });
    y += 18;
  }

  y += 8;
  c.line(L, y, R, y, INK, 1);
  y += 16;

  const lineItems = data.lineItems || [];
  if (lineItems.length > 0) {
    const colDate = L + 60, colQty = R - 260, colRate = R - 190, colAmt = R;
    c.text(L, y, "Date", { size: 9, bold: true });
    c.text(colDate, y, "Activity / Description", { size: 9, bold: true });
    c.text(colQty, y, "Qty", { size: 9, bold: true, align: "right" });
    c.text(colRate, y, "Rate", { size: 9, bold: true, align: "right" });
    c.text(colAmt, y, "Amount", { size: 9, bold: true, align: "right" });
    y += 8;
    c.line(L, y, R, y, LINE, 0.75);
    y += 18;
    for (const li of lineItems) {
      const activity = li.productCategory ? `${li.productCategory}:${li.productName || "Service"}` : (li.productName || "Service");
      const label = [activity, li.description].filter(Boolean).join(" — ");
      c.text(L, y, fmtDate(li.serviceDate), { size: 9, color: MUTED });
      c.text(colDate, y, label.slice(0, 50), { size: 10 });
      c.text(colQty, y, String(li.quantity), { size: 10, align: "right" });
      c.text(colRate, y, `$${money(li.rate)}`, { size: 10, align: "right" });
      c.text(colAmt, y, `$${money(li.amount)}${li.taxable === false ? "" : "T"}`, { size: 10, align: "right" });
      y += 18;
      if (y > PAGE_H - 220) break; // single-page layout; overflow items are omitted rather than mis-rendered
    }
    y += 6;
    c.line(L, y, R, y, LINE, 0.75);
    y += 26;
  } else {
    c.text(L, y, "Description", { size: 9, bold: true });
    c.text(R, y, "Amount", { size: 9, bold: true, align: "right" });
    y += 8;
    c.line(L, y, R, y, LINE, 0.75);
    y += 20;
    c.text(L, y, data.description || "Service invoice", { size: 10 });
    c.text(R, y, `$${money(data.subtotalAmount ?? data.totalAmount)}`, { size: 10, align: "right" });
    y += 24;
    c.line(L, y, R, y, LINE, 0.75);
    y += 30;
  }

  const summaryX = R - 200;
  if (lineItems.length > 0 && data.subtotalAmount != null) {
    c.text(summaryX, y, "Subtotal", { size: 10, color: MUTED });
    c.text(R, y, `$${money(data.subtotalAmount)}`, { size: 10, align: "right", color: MUTED });
    y += 15;
    if (data.discountAmount) {
      c.text(summaryX, y, "Discount", { size: 10, color: MUTED });
      c.text(R, y, `-$${money(data.discountAmount)}`, { size: 10, align: "right", color: MUTED });
      y += 15;
    }
    if (data.salesTaxAmount) {
      c.text(summaryX, y, "Sales Tax", { size: 10, color: MUTED });
      c.text(R, y, `$${money(data.salesTaxAmount)}`, { size: 10, align: "right", color: MUTED });
      y += 15;
    }
    if (data.shippingAmount) {
      c.text(summaryX, y, "Shipping", { size: 10, color: MUTED });
      c.text(R, y, `$${money(data.shippingAmount)}`, { size: 10, align: "right", color: MUTED });
      y += 15;
    }
  }
  c.text(summaryX, y, "Total", { size: 10 });
  c.text(R, y, `$${money(data.totalAmount)}`, { size: 10, align: "right" });
  y += 16;
  c.text(summaryX, y, "Amount Paid", { size: 10, color: MUTED });
  c.text(R, y, `$${money(data.amountPaid)}`, { size: 10, align: "right", color: MUTED });
  y += 16;
  if (data.depositAmount) {
    c.text(summaryX, y, "Deposit", { size: 10, color: MUTED });
    c.text(R, y, `$${money(data.depositAmount)}`, { size: 10, align: "right", color: MUTED });
    y += 16;
  }
  c.line(summaryX, y, R, y, LINE, 0.75);
  y += 14;
  c.text(summaryX, y, "Balance Due", { size: 12, bold: true });
  c.text(R, y, `$${money(data.balanceDue)}`, { size: 12, bold: true, align: "right" });
  y += 16;
  c.text(summaryX, y, "Status", { size: 9, color: MUTED });
  c.text(R, y, data.status || "", { size: 9, color: MUTED, align: "right" });
  y += 30;

  if (data.paymentInstructions) {
    c.text(L, y, "Payment Instructions", { size: 9, bold: true });
    y += 13;
    c.text(L, y, data.paymentInstructions.slice(0, 120), { size: 9, color: MUTED });
    y += 20;
  }
  if (data.clientNote) {
    c.text(L, y, data.clientNote.slice(0, 140), { size: 9, color: MUTED });
    y += 20;
  }

  if (data.payments.length && y < PAGE_H - 120) {
    c.text(L, y, "Payment History", { size: 9, bold: true });
    y += 14;
    c.text(L, y, "Date", { size: 8, bold: true, color: MUTED });
    c.text(L + 140, y, "Method", { size: 8, bold: true, color: MUTED });
    c.text(R, y, "Amount", { size: 8, bold: true, color: MUTED, align: "right" });
    y += 6;
    c.line(L, y, R, y, LINE, 0.5);
    y += 12;
    for (const p of data.payments) {
      if (y > PAGE_H - 60) break;
      c.text(L, y, fmtDate(p.paymentDate), { size: 9 });
      c.text(L + 140, y, p.method || "", { size: 9, color: MUTED });
      c.text(R, y, `$${money(p.actualAmount)}`, { size: 9, align: "right" });
      y += 14;
    }
  }

  c.text(L, PAGE_H - 30, "Thank you for your business.", { size: 9, color: MUTED });

  return doc.save();
}
