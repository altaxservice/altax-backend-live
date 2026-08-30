/**
 * EFTPS federal tax deposit report PDF — hand-drawn from scratch (pdf-lib
 * primitives), same approach as every other report PDF in this app
 * (reportsPdf.ts, invoicePdf.ts, contractPdf.ts, paycheckPdf.ts). Each of
 * those files keeps its own local Cursor/newPage/drawHeader/drawFooter
 * rather than sharing one — this file follows that same convention
 * deliberately, not by oversight.
 *
 * Federal only, by design: Federal Income Tax / Social Security / Medicare,
 * by employee — never state withholding or unemployment insurance, which
 * belong to a separate quarterly report this workflow doesn't touch.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { getFirmProfile } from "../../common/firmProfile";
import { pdfSafeText } from "../../common/pdfText";

const PAGE_W = 612;
const PAGE_H = 792;
const INK = rgb(0.09, 0.09, 0.09);
const MUTED = rgb(0.42, 0.42, 0.42);
const LINE = rgb(0.82, 0.82, 0.82);
const TEAL = rgb(0.043, 0.42, 0.42);
const TEAL_TINT = rgb(0.93, 0.97, 0.97);

function money(v: unknown): string {
  const n = Number(v);
  return `$${(Number.isFinite(n) ? n : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}
function setPdfTitle(doc: PDFDocument, parts: (string | null | undefined)[]) {
  const title = parts.filter((p) => p && p.trim()).map((p) => p!.trim()).join(" - ");
  if (title) doc.setTitle(title);
}

class Cursor {
  constructor(private page: PDFPage, private font: PDFFont, private bold: PDFFont, private top: number) {}
  text(x: number, yFromTop: number, str: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center" } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const safe = pdfSafeText(str);
    if (!safe) return;
    const width = font.widthOfTextAtSize(safe, size);
    const drawX = opts.align === "right" ? x - width : opts.align === "center" ? x - width / 2 : x;
    this.page.drawText(safe, { x: drawX, y: this.top - yFromTop, size, font, color: opts.color ?? INK });
  }
  line(x1: number, y1: number, x2: number, y2: number, color = LINE, thickness = 0.75) {
    this.page.drawLine({ start: { x: x1, y: this.top - y1 }, end: { x: x2, y: this.top - y2 }, thickness, color });
  }
  rect(x: number, y: number, w: number, h: number, color = TEAL) {
    this.page.drawRectangle({ x, y: this.top - y - h, width: w, height: h, color });
  }
}

async function newPage(doc: PDFDocument, font: PDFFont, bold: PDFFont): Promise<{ page: PDFPage; c: Cursor }> {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const c = new Cursor(page, font, bold, PAGE_H);
  c.rect(0, 0, PAGE_W, 6, TEAL);
  return { page, c };
}

function drawFooter(c: Cursor, firmName: string) {
  const L = 48, R = PAGE_W - 48;
  c.text(L, PAGE_H - 28, `Generated ${fmtDate(new Date().toISOString())} — ${firmName}`, { size: 8, color: MUTED });
  c.text(R, PAGE_H - 28, "Federal deposit amounts only — see your quarterly payroll report for state/UI.", { size: 8, color: MUTED, align: "right" });
}

function sectionLabel(c: Cursor, y: number, label: string): number {
  c.text(48, y, label.toUpperCase(), { size: 9, bold: true, color: TEAL });
  return y + 14;
}

export interface EftpsDepositPdfClientInfo {
  clientName: string;
  clientId: string;
  ein: string | null;
  address: string | null;
}
export interface EftpsDepositPdfEmployeeRow {
  employeeName: string;
  federalIncomeTax: number;
  socialSecurity: number;
  medicare: number;
  subtotal: number;
}
export interface EftpsDepositPdfData {
  client: EftpsDepositPdfClientInfo;
  periodLabel: string;
  filingDate: string;
  paymentDate: string | null;
  federalIncomeTaxTotal: number;
  socialSecurityTotal: number;
  medicareTotal: number;
  totalAmount: number;
  employees: EftpsDepositPdfEmployeeRow[];
}

export async function generateEftpsDepositPdf(data: EftpsDepositPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setPdfTitle(doc, [data.client.clientName, "EFTPS Deposit", data.periodLabel]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let { page, c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();

  const L = 48, R = PAGE_W - 48;
  let y = 48;
  c.text(L, y, data.client.clientName.toUpperCase(), { size: 16, bold: true, color: TEAL });
  c.text(R, y, "FEDERAL TAX DEPOSIT", { size: 16, bold: true, align: "right" });
  y += 16;
  c.text(L, y, `Client ID: ${data.client.clientId}${data.client.ein ? ` · EIN: ${data.client.ein}` : ""}`, { size: 9, color: MUTED });
  c.text(R, y, data.periodLabel, { size: 10, color: MUTED, align: "right" });
  y += 12;
  if (data.client.address) {
    for (const line of data.client.address.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean)) {
      c.text(L, y, line, { size: 9, color: MUTED });
      y += 11;
    }
  }
  y += 6;
  c.text(L, y, `Prepared by ${profile.firmName}`, { size: 8, color: MUTED });
  y += 14;
  c.line(L, y, R, y, INK, 1.25);
  y += 22;

  const tiles: [string, string][] = [
    ["Filed", fmtDate(data.filingDate)],
    ["Payment Date", data.paymentDate ? fmtDate(data.paymentDate) : "Pending"],
    ["Total Federal Deposit", money(data.totalAmount)],
  ];
  const tileW = (PAGE_W - 96 - 2 * 10) / 3;
  tiles.forEach(([label, value], i) => {
    const x = L + i * (tileW + 10);
    c.rect(x, y, tileW, 44, TEAL_TINT);
    c.text(x + 10, y + 16, label.toUpperCase(), { size: 7, bold: true, color: MUTED });
    c.text(x + 10, y + 34, value, { size: 13, bold: true });
  });
  y += 58;

  y = sectionLabel(c, y, "Federal Deposit Summary");
  const colLabel = L, colValue = R;
  const summaryRows: [string, string, boolean?][] = [
    ["Federal Income Tax", money(data.federalIncomeTaxTotal)],
    ["Social Security", money(data.socialSecurityTotal)],
    ["Medicare", money(data.medicareTotal)],
  ];
  for (const [label, value] of summaryRows) {
    c.text(colLabel, y, label, { size: 10 });
    c.text(colValue, y, value, { size: 10, align: "right" });
    y += 16;
  }
  y += 2;
  c.line(L, y, R, y, INK, 1);
  y += 16;
  c.rect(L, y - 12, PAGE_W - 96, 22, TEAL_TINT);
  c.text(colLabel, y, "Total Federal Deposit", { size: 10, bold: true, color: TEAL });
  c.text(colValue, y, money(data.totalAmount), { size: 10, bold: true, color: TEAL, align: "right" });
  y += 30;

  y = sectionLabel(c, y, `By Employee (${data.employees.length})`);
  const colEmployee = L, colFit = R - 300, colSs = R - 200, colMed = R - 100, colTotal = R;
  c.text(colEmployee, y, "Employee", { size: 8, bold: true, color: MUTED });
  c.text(colFit, y, "Federal Income Tax", { size: 8, bold: true, color: MUTED, align: "right" });
  c.text(colSs, y, "Social Security", { size: 8, bold: true, color: MUTED, align: "right" });
  c.text(colMed, y, "Medicare", { size: 8, bold: true, color: MUTED, align: "right" });
  c.text(colTotal, y, "Total", { size: 8, bold: true, color: MUTED, align: "right" });
  y += 6;
  c.line(L, y, R, y, LINE, 0.75);
  y += 14;
  for (const e of data.employees) {
    if (y > PAGE_H - 60) {
      drawFooter(c, profile.firmName);
      ({ page, c } = await newPage(doc, font, bold));
      y = 60;
    }
    c.text(colEmployee, y, e.employeeName.slice(0, 40), { size: 9 });
    c.text(colFit, y, money(e.federalIncomeTax), { size: 9, align: "right" });
    c.text(colSs, y, money(e.socialSecurity), { size: 9, align: "right" });
    c.text(colMed, y, money(e.medicare), { size: 9, align: "right" });
    c.text(colTotal, y, money(e.subtotal), { size: 9, align: "right", bold: true });
    y += 15;
  }

  drawFooter(c, profile.firmName);
  return doc.save();
}
