/**
 * Financial report PDFs (P&L, Balance Sheet, Payroll Dashboard, Client
 * Message) — hand-drawn from scratch (pdf-lib primitives), same approach as
 * invoicePdf.ts/paycheckPdf.ts: no official template exists for these.
 *
 * Unlike invoices (AL TAX's own document, firm letterhead) these are the
 * CLIENT's financial statements prepared BY the firm, so the header leads
 * with the client's identity (name/EIN/address) — matching paycheckPdf.ts's
 * convention — with a small "Prepared by AL Tax Service" line, not a full
 * firm letterhead.
 *
 * Client Message is deliberately English-only here, even though the
 * on-screen/emailed version is bilingual (English + Arabic — see
 * templates.routes.ts message_arabic). Rendering Arabic correctly in a
 * pdf-lib PDF needs an embedded Arabic-script font AND real RTL/contextual
 * glyph shaping (Arabic letterforms change shape based on position in a
 * word); pdf-lib does neither automatically, and a naive "just draw the
 * Unicode string" or "reverse the string" approach produces disconnected or
 * backwards letterforms — worse than omitting it, not better, for a
 * professional client-facing document. The real send channels (email/SMS/
 * WhatsApp, in notifications.ts) render Arabic correctly since those are
 * plain Unicode text handled by the client's own font stack, not something
 * this codebase has to shape itself — only this specific PDF path is
 * affected. Flagged here rather than silently shipping broken Arabic.
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

function money(v: unknown): string {
  const n = Number(v);
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(Number.isFinite(n) ? n : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(v: unknown): string {
  if (!v) return "";
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

export interface ReportClientInfo {
  clientName: string;
  clientId: string;
  ein: string | null;
  address: string | null;
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

async function newPage(doc: PDFDocument, font: PDFFont, bold: PDFFont): Promise<{ page: PDFPage; c: Cursor }> {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const c = new Cursor(page, font, bold, PAGE_H);
  c.rect(0, 0, PAGE_W, 6, TEAL);
  return { page, c };
}

/** Draws the shared client-letterhead header; returns the y position content can start at. */
function drawHeader(c: Cursor, client: ReportClientInfo, reportTitle: string, periodLabel: string, firmName: string): number {
  const L = 48, R = PAGE_W - 48;
  let y = 48;
  c.text(L, y, client.clientName.toUpperCase(), { size: 16, bold: true, color: TEAL });
  c.text(R, y, reportTitle, { size: 16, bold: true, align: "right" });
  y += 16;
  c.text(L, y, `Client ID: ${client.clientId}${client.ein ? ` · EIN: ${client.ein}` : ""}`, { size: 9, color: MUTED });
  c.text(R, y, periodLabel, { size: 10, color: MUTED, align: "right" });
  y += 12;
  if (client.address) {
    for (const line of client.address.split(",").map((s) => s.trim()).filter(Boolean)) {
      c.text(L, y, line, { size: 9, color: MUTED });
      y += 11;
    }
  }
  y += 6;
  c.text(L, y, `Prepared by ${firmName}`, { size: 8, color: MUTED });
  y += 14;
  c.line(L, y, R, y, INK, 1.25);
  return y + 22;
}

function drawFooter(c: Cursor, firmName: string, note = "For the client's records. Not a substitute for filed tax returns.") {
  const L = 48, R = PAGE_W - 48;
  c.text(L, PAGE_H - 28, `Generated ${fmtDate(new Date())} — ${firmName}`, { size: 8, color: MUTED });
  c.text(R, PAGE_H - 28, note, { size: 8, color: MUTED, align: "right" });
}

/** Firm's own letterhead (not a client's) — for the firm-wide overview report, which is the firm's own internal analytics, not a client deliverable. */
function drawFirmHeader(page: PDFPage, c: Cursor, reportTitle: string, periodLabel: string, profile: FirmProfile, logo: Awaited<ReturnType<typeof embedFirmLogo>>): number {
  const L = 48, R = PAGE_W - 48;
  let y = 48;
  let textL = L;
  if (logo) {
    const logoH = 28;
    const logoW = (logo.width / logo.height) * logoH;
    page.drawImage(logo, { x: L, y: PAGE_H - y - logoH + 6, width: logoW, height: logoH });
    textL = L + logoW + 10;
  }
  c.text(textL, y, profile.firmName.toUpperCase(), { size: 16, bold: true, color: TEAL });
  c.text(R, y, reportTitle, { size: 16, bold: true, align: "right" });
  y += 16;
  for (const line of [profile.addressLine1, profile.addressLine2].filter((l) => l && l.trim())) {
    c.text(textL, y, line, { size: 9, color: MUTED });
    y += 11;
  }
  c.text(R, y - 11, periodLabel, { size: 10, color: MUTED, align: "right" });
  y += 6;
  c.line(L, y, R, y, INK, 1.25);
  return y + 22;
}

function sectionLabel(c: Cursor, y: number, label: string): number {
  c.text(48, y, label.toUpperCase(), { size: 9, bold: true, color: TEAL });
  return y + 14;
}

function row(c: Cursor, y: number, label: string, value: string, opts: { bold?: boolean; accent?: boolean; indent?: boolean } = {}): number {
  const L = 48 + (opts.indent ? 12 : 0), R = PAGE_W - 48;
  c.text(L, y, label, { size: 10, bold: opts.bold, color: opts.accent ? TEAL : INK });
  c.text(R, y, value, { size: 10, bold: opts.bold, color: opts.accent ? TEAL : INK, align: "right" });
  return y + 16;
}

function emptyNote(c: Cursor, y: number): number {
  c.text(60, y, "No activity in this section for the selected period.", { size: 9, color: MUTED });
  return y + 16;
}

export interface LedgerLine { account: string; debit: number; credit: number }

export interface PLReportData {
  client: ReportClientInfo;
  from: string; to: string;
  income: LedgerLine[]; cogs: LedgerLine[]; expenses: LedgerLine[];
  totalIncome: number; totalCogs: number; grossProfit: number; totalExpenses: number; netIncome: number;
}

export async function generatePLPdf(data: PLReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();
  let y = drawHeader(c, data.client, "PROFIT AND LOSS", `${fmtDate(data.from)} – ${fmtDate(data.to)}`, profile.firmName);

  y = sectionLabel(c, y, "Income");
  if (!data.income.length) y = emptyNote(c, y);
  for (const l of data.income) y = row(c, y, l.account, money(l.credit - l.debit), { indent: true });
  y = row(c, y + 2, "Total Income", money(data.totalIncome), { bold: true });
  y += 8;

  y = sectionLabel(c, y, "Cost of Goods Sold");
  if (!data.cogs.length) y = emptyNote(c, y);
  for (const l of data.cogs) y = row(c, y, l.account, money(l.debit - l.credit), { indent: true });
  y = row(c, y + 2, "Total Cost of Goods Sold", money(data.totalCogs), { bold: true });
  y += 4;
  c.rect(48, y - 12, PAGE_W - 96, 22, TEAL_TINT);
  y = row(c, y, "Gross Profit", money(data.grossProfit), { bold: true });
  y += 12;

  y = sectionLabel(c, y, "Expenses");
  if (!data.expenses.length) y = emptyNote(c, y);
  for (const l of data.expenses) y = row(c, y, l.account, money(l.debit - l.credit), { indent: true });
  y = row(c, y + 2, "Total Expenses", money(data.totalExpenses), { bold: true });
  y += 10;

  c.line(48, y, PAGE_W - 48, y, INK, 1);
  y += 16;
  y = row(c, y, "Net Income", money(data.netIncome), { bold: true, accent: true });

  drawFooter(c, profile.firmName);
  return doc.save();
}

export interface BalanceSheetReportData {
  client: ReportClientInfo;
  from: string; to: string;
  assets: LedgerLine[]; liabilities: LedgerLine[];
  totalAssets: number; totalLiabilities: number; totalEquity: number;
}

export async function generateBalanceSheetPdf(data: BalanceSheetReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();
  let y = drawHeader(c, data.client, "BALANCE SHEET", `As of ${fmtDate(data.to)}`, profile.firmName);

  y = sectionLabel(c, y, "Assets");
  if (!data.assets.length) y = emptyNote(c, y);
  for (const l of data.assets) y = row(c, y, l.account, money(l.debit - l.credit), { indent: true });
  y = row(c, y + 2, "Total Assets", money(data.totalAssets), { bold: true });
  y += 10;

  y = sectionLabel(c, y, "Liabilities");
  if (!data.liabilities.length) y = emptyNote(c, y);
  for (const l of data.liabilities) y = row(c, y, l.account, money(l.credit - l.debit), { indent: true });
  y = row(c, y + 2, "Total Liabilities", money(data.totalLiabilities), { bold: true });
  y += 10;

  y = sectionLabel(c, y, "Equity");
  y = row(c, y, "Equity (Assets - Liabilities)", money(data.totalEquity), { indent: true });
  y += 10;

  c.line(48, y, PAGE_W - 48, y, INK, 1);
  y += 16;
  c.rect(48, y - 12, PAGE_W - 96, 22, TEAL_TINT);
  y = row(c, y, "Total Liabilities + Equity", money(data.totalLiabilities + data.totalEquity), { bold: true, accent: true });

  drawFooter(c, profile.firmName);
  return doc.save();
}

export interface PayrollTaxRow { label: string; employee: number; employer: number }
export interface PayrollCheckRow { payDate: string | null; employee: string; gross: number; net: number }

export interface PayrollReportData {
  client: ReportClientInfo;
  from: string; to: string;
  grossWages: number; checkCount: number; employeeTaxes: number; employerTaxes: number; netPay: number; totalCost: number;
  taxRows: PayrollTaxRow[];
  checks: PayrollCheckRow[];
}

export async function generatePayrollPdf(data: PayrollReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let { page, c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();
  let y = drawHeader(c, data.client, "PAYROLL DASHBOARD", `${fmtDate(data.from)} – ${fmtDate(data.to)}`, profile.firmName);

  const tiles: [string, string][] = [
    ["Gross Wages", money(data.grossWages)], ["Checks", String(data.checkCount)],
    ["Employee Taxes", money(data.employeeTaxes)], ["Employer Taxes", money(data.employerTaxes)],
    ["Net Pay", money(data.netPay)], ["Total Payroll Cost", money(data.totalCost)],
  ];
  const tileW = (PAGE_W - 96 - 2 * 10) / 3;
  tiles.forEach(([label, value], i) => {
    const col = i % 3, rowI = Math.floor(i / 3);
    const x = 48 + col * (tileW + 10);
    const tileY = y + rowI * 54;
    c.rect(x, tileY, tileW, 44, TEAL_TINT);
    c.text(x + 10, tileY + 16, label.toUpperCase(), { size: 7, bold: true, color: MUTED });
    c.text(x + 10, tileY + 34, value, { size: 13, bold: true });
  });
  y += 2 * 54 + 14;

  y = sectionLabel(c, y, "Payroll Tax Summary");
  const colTax = 48, colEe = PAGE_W - 48 - 220, colEr = PAGE_W - 48 - 130, colTot = PAGE_W - 48;
  c.text(colTax, y, "Tax", { size: 8, bold: true, color: MUTED });
  c.text(colEe, y, "Employee", { size: 8, bold: true, color: MUTED, align: "right" });
  c.text(colEr, y, "Employer", { size: 8, bold: true, color: MUTED, align: "right" });
  c.text(colTot, y, "Total", { size: 8, bold: true, color: MUTED, align: "right" });
  y += 6;
  c.line(48, y, PAGE_W - 48, y, LINE, 0.75);
  y += 14;
  for (const r of data.taxRows) {
    c.text(colTax, y, r.label, { size: 9 });
    c.text(colEe, y, money(r.employee), { size: 9, align: "right" });
    c.text(colEr, y, money(r.employer), { size: 9, align: "right" });
    c.text(colTot, y, money(r.employee + r.employer), { size: 9, align: "right" });
    y += 15;
  }
  y += 2;
  c.line(48, y, PAGE_W - 48, y, INK, 1);
  y += 14;
  const empTotal = data.taxRows.reduce((s, r) => s + r.employee, 0);
  const erTotal = data.taxRows.reduce((s, r) => s + r.employer, 0);
  c.text(colTax, y, "Total", { size: 9, bold: true });
  c.text(colEe, y, money(empTotal), { size: 9, bold: true, align: "right" });
  c.text(colEr, y, money(erTotal), { size: 9, bold: true, align: "right" });
  c.text(colTot, y, money(empTotal + erTotal), { size: 9, bold: true, align: "right" });
  y += 26;

  y = sectionLabel(c, y, `Checks (${data.checks.length})`);
  if (!data.checks.length) {
    emptyNote(c, y);
  } else {
    const colDate = 48, colEmp = 130, colGross = PAGE_W - 48 - 90, colNet = PAGE_W - 48;
    c.text(colDate, y, "Date", { size: 8, bold: true, color: MUTED });
    c.text(colEmp, y, "Employee", { size: 8, bold: true, color: MUTED });
    c.text(colGross, y, "Gross", { size: 8, bold: true, color: MUTED, align: "right" });
    c.text(colNet, y, "Net", { size: 8, bold: true, color: MUTED, align: "right" });
    y += 6;
    c.line(48, y, PAGE_W - 48, y, LINE, 0.75);
    y += 14;
    for (const check of data.checks) {
      if (y > PAGE_H - 60) {
        drawFooter(c, profile.firmName);
        ({ page, c } = await newPage(doc, font, bold));
        y = 60;
      }
      c.text(colDate, y, fmtDate(check.payDate), { size: 9 });
      c.text(colEmp, y, check.employee.slice(0, 28), { size: 9 });
      c.text(colGross, y, money(check.gross), { size: 9, align: "right" });
      c.text(colNet, y, money(check.net), { size: 9, align: "right" });
      y += 14;
    }
  }

  drawFooter(c, profile.firmName);
  return doc.save();
}

export interface ClientMessageReportData {
  client: ReportClientInfo;
  from: string; to: string;
  subject: string;
  bodyEnglish: string;
}

export async function generateClientMessagePdf(data: ClientMessageReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let { page, c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();
  let y = drawHeader(c, data.client, "CLIENT MESSAGE", `${fmtDate(data.from)} – ${fmtDate(data.to)}`, profile.firmName);

  c.text(48, y, data.subject, { size: 13, bold: true });
  y += 24;

  const maxWidth = PAGE_W - 96;
  const lines = data.bodyEnglish.split("\n");
  for (const rawLine of lines) {
    if (y > PAGE_H - 60) {
      drawFooter(c, profile.firmName);
      ({ page, c } = await newPage(doc, font, bold));
      y = 60;
    }
    if (!rawLine.trim()) { y += 10; continue; }
    for (const wrapped of wrapText(rawLine, font, 10, maxWidth)) {
      if (y > PAGE_H - 60) {
        drawFooter(c, profile.firmName);
        ({ page, c } = await newPage(doc, font, bold));
        y = 60;
      }
      const isHeading = wrapped === wrapped.toUpperCase() && /[A-Z]/.test(wrapped) && wrapped.length < 40;
      c.text(48, y, wrapped, { size: 10, bold: isHeading });
      y += 14;
    }
  }

  drawFooter(c, profile.firmName);
  return doc.save();
}

export interface FirmOverviewMonth { month: string; revenue: number; expenses: number; profit: number }
export interface FirmOverviewReportData {
  monthsBack: number;
  months: FirmOverviewMonth[];
  totals: { revenue: number; expenses: number; profit: number };
  unpaidBalance: number; unpaidInvoiceCount: number; activeClientCount: number;
}

/** Firm-wide analytics PDF — AL Tax Service's own numbers across every client, not a client deliverable, hence drawFirmHeader (firm letterhead) instead of drawHeader (client letterhead). Mirrors ReportsPage.tsx's Firm Overview tab exactly. */
export async function generateFirmOverviewPdf(data: FirmOverviewReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { page, c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();
  const logo = await embedFirmLogo(doc, profile);
  let y = drawFirmHeader(page, c, "FIRM OVERVIEW", `Last ${data.monthsBack} months`, profile, logo);

  const tiles: [string, string][] = [
    ["Revenue", money(data.totals.revenue)], ["Expenses", money(data.totals.expenses)],
    ["Net Profit", money(data.totals.profit)], ["Unpaid Balance", money(data.unpaidBalance)],
  ];
  const tileW = (PAGE_W - 96 - 3 * 10) / 4;
  tiles.forEach(([label, value], i) => {
    const x = 48 + i * (tileW + 10);
    c.rect(x, y, tileW, 44, TEAL_TINT);
    c.text(x + 10, y + 16, label.toUpperCase(), { size: 7, bold: true, color: MUTED });
    c.text(x + 10, y + 34, value, { size: 12, bold: true });
  });
  y += 60;
  c.text(48, y, `${data.activeClientCount} active clients  ·  ${data.unpaidInvoiceCount} unpaid invoices`, { size: 9, color: MUTED });
  y += 24;

  y = sectionLabel(c, y, "Monthly Trend");
  const colMonth = 48, colRev = PAGE_W - 48 - 220, colExp = PAGE_W - 48 - 110, colProfit = PAGE_W - 48;
  c.text(colMonth, y, "Month", { size: 8, bold: true, color: MUTED });
  c.text(colRev, y, "Revenue", { size: 8, bold: true, color: MUTED, align: "right" });
  c.text(colExp, y, "Expenses", { size: 8, bold: true, color: MUTED, align: "right" });
  c.text(colProfit, y, "Profit", { size: 8, bold: true, color: MUTED, align: "right" });
  y += 6;
  c.line(48, y, PAGE_W - 48, y, LINE, 0.75);
  y += 14;
  for (const m of data.months) {
    c.text(colMonth, y, m.month, { size: 9 });
    c.text(colRev, y, money(m.revenue), { size: 9, align: "right" });
    c.text(colExp, y, money(m.expenses), { size: 9, align: "right", color: MUTED });
    c.text(colProfit, y, money(m.profit), { size: 9, bold: true, align: "right", color: m.profit >= 0 ? TEAL : rgb(0.7, 0.15, 0.15) });
    y += 15;
  }

  drawFooter(c, profile.firmName, "Internal firm analytics — not a client-facing document.");
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
