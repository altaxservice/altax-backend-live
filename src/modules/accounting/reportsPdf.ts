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
import { pdfSafeText } from "../../common/pdfText";
import type { MdFilingResult } from "../../common/mdFiling";
import { classifyMdFilingPeriod } from "../../common/mdFiling";

const PAGE_W = 612;
const PAGE_H = 792;
const INK = rgb(0.09, 0.09, 0.09);
const MUTED = rgb(0.42, 0.42, 0.42);
const LINE = rgb(0.82, 0.82, 0.82);
const TEAL = rgb(0.043, 0.42, 0.42);
const TEAL_TINT = rgb(0.93, 0.97, 0.97);

// PERF-014 (hard audit, 2026-08-13): shared cap for the report sections whose
// row count scales with transaction/client volume rather than a firm's
// (small, effectively fixed) chart of accounts — a busy client's payroll
// check list or a firm's full AR aging client list could otherwise turn a
// single report request into an unbounded, silently enormous PDF generated
// synchronously in the request handler. Matches the value already proven
// out in generateClientValueReportPdf's own LIST_ITEM_CAP.
const REPORT_ROW_CAP = 150;

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

/**
 * Sets the PDF's own /Title metadata. The "Download" button already produces
 * a correct filename via the `download` attribute, but "Preview / Print"
 * opens the raw PDF in a new tab (viewFile()) — Save/Print-to-PDF from there
 * falls back to whatever the browser's PDF viewer reads as the document
 * title, which without this was blank, so it fell back to a generic browser
 * default instead of anything client- or period-specific. Unlike a filename,
 * this isn't a filesystem path, so "/" (date separators from fmtDate) and
 * other punctuation are left alone — only typographic dashes/quotes get
 * normalized to plain ASCII, since setTitle() WinAnsi-encodes and throws on
 * characters outside that set.
 */
function setPdfTitle(doc: PDFDocument, parts: (string | null | undefined)[]) {
  const title = parts
    .filter((p) => p && p.trim())
    .map((p) => p!.replace(/[‐-―]/g, "-").replace(/[‘-‟]/g, "'").replace(/\s+/g, " ").trim())
    .join(" - ");
  if (title) doc.setTitle(title);
}

export interface ReportClientInfo {
  clientName: string;
  clientId: string;
  ein: string | null;
  address: string | null;
  state?: string | null;
  salesTaxFrequency?: string | null;
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
    // Split on newlines first (composeAddress joins street / city-state-zip with
    // one), then on commas — splitting on commas alone left the newline embedded,
    // which is what crashed every report PDF for multi-line addresses.
    for (const line of client.address.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean)) {
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
  // Null client = firm-wide roll-up across every client's GL activity (internal
  // analytics, same firm-letterhead framing as AR Aging/Firm Overview) rather
  // than one client's own P&L (client letterhead, meant for their records).
  client: ReportClientInfo | null;
  from: string; to: string;
  income: LedgerLine[]; cogs: LedgerLine[]; expenses: LedgerLine[];
  totalIncome: number; totalCogs: number; grossProfit: number; totalExpenses: number; netIncome: number;
}

export async function generatePLPdf(data: PLReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setPdfTitle(doc, [data.client?.clientName || "Firm-Wide", "P&L", `${fmtDate(data.from)} to ${fmtDate(data.to)}`]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { page, c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();
  let y: number;
  if (data.client) {
    y = drawHeader(c, data.client, "PROFIT AND LOSS", `${fmtDate(data.from)} – ${fmtDate(data.to)}`, profile.firmName);
  } else {
    const logo = await embedFirmLogo(doc, profile);
    y = drawFirmHeader(page, c, "FIRM-WIDE PROFIT AND LOSS", `${fmtDate(data.from)} – ${fmtDate(data.to)}`, profile, logo);
  }

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

  drawFooter(c, profile.firmName, data.client ? undefined : "Internal firm analytics — not a client-facing document.");
  return doc.save();
}

export interface BalanceSheetReportData {
  client: ReportClientInfo | null;
  from: string; to: string;
  assets: LedgerLine[]; liabilities: LedgerLine[];
  totalAssets: number; totalLiabilities: number; totalEquity: number;
}

export async function generateBalanceSheetPdf(data: BalanceSheetReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setPdfTitle(doc, [data.client?.clientName || "Firm-Wide", "Balance Sheet", `As of ${fmtDate(data.to)}`]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { page, c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();
  let y: number;
  if (data.client) {
    y = drawHeader(c, data.client, "BALANCE SHEET", `As of ${fmtDate(data.to)}`, profile.firmName);
  } else {
    const logo = await embedFirmLogo(doc, profile);
    y = drawFirmHeader(page, c, "FIRM-WIDE BALANCE SHEET", `As of ${fmtDate(data.to)}`, profile, logo);
  }

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

  drawFooter(c, profile.firmName, data.client ? undefined : "Internal firm analytics — not a client-facing document.");
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
  setPdfTitle(doc, [data.client.clientName, "Payroll", `${fmtDate(data.from)} to ${fmtDate(data.to)}`]);
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
    // PERF-014 (hard audit, 2026-08-13): a long date range for a client with
    // frequent payroll could otherwise produce an unbounded, silently-huge
    // PDF — same cap-and-say-so pattern already used by
    // generateClientValueReportPdf's LIST_ITEM_CAP below.
    const shownChecks = data.checks.slice(0, REPORT_ROW_CAP);
    for (const check of shownChecks) {
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
    if (data.checks.length > shownChecks.length) {
      if (y > PAGE_H - 60) { drawFooter(c, profile.firmName); ({ page, c } = await newPage(doc, font, bold)); y = 60; }
      c.text(colDate, y, `+ ${data.checks.length - shownChecks.length} more — export CSV for the full list.`, { size: 8.5, color: MUTED });
      y += 14;
    }
  }

  drawFooter(c, profile.firmName);
  return doc.save();
}

export interface EmployeeSummaryRow {
  employee: string; checkCount: number; grossWages: number; employeeTaxes: number; employerTaxes: number; netPay: number; totalCost: number;
}

export interface EmployeeReportData {
  client: ReportClientInfo;
  from: string; to: string;
  /** null = all-employees summary table; set = one employee's tax breakdown + check list (same shape as PayrollReportData). */
  employeeFilter: string | null;
  summaryRows: EmployeeSummaryRow[];
  taxRows: PayrollTaxRow[];
  checks: PayrollCheckRow[];
  totals: { grossWages: number; checkCount: number; employeeTaxes: number; employerTaxes: number; netPay: number; totalCost: number };
}

/**
 * Employee-scoped view of the same payroll data as generatePayrollPdf — that
 * report is one flat list of every check in the period; this groups by
 * employee instead, either as an all-employees totals table or (when a single
 * employee is picked) that employee's own tax breakdown + check list, reusing
 * the exact same section layout generatePayrollPdf already established.
 */
export async function generateEmployeeReportPdf(data: EmployeeReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setPdfTitle(doc, [data.client.clientName, "Employee", data.employeeFilter, `${fmtDate(data.from)} to ${fmtDate(data.to)}`]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let { page, c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();
  // Employee name goes in the smaller periodLabel line, not appended to the big bold
  // title — a real employee name + a real (often long) client name both drawn at
  // size 16 bold on the same line collided and overlapped illegibly (found live,
  // via an actual received test email: "AL TAX SEMPLOYEE REPORT..."). periodLabel
  // is size 10 with far more room, and there's no client-name collision risk there.
  const title = "EMPLOYEE REPORT";
  const periodLabel = data.employeeFilter
    ? `${data.employeeFilter.toUpperCase()} · ${fmtDate(data.from)} – ${fmtDate(data.to)}`
    : `ALL EMPLOYEES · ${fmtDate(data.from)} – ${fmtDate(data.to)}`;
  let y = drawHeader(c, data.client, title, periodLabel, profile.firmName);

  const tiles: [string, string][] = [
    ["Gross Wages", money(data.totals.grossWages)], ["Checks", String(data.totals.checkCount)],
    ["Employee Taxes", money(data.totals.employeeTaxes)], ["Employer Taxes", money(data.totals.employerTaxes)],
    ["Net Pay", money(data.totals.netPay)], ["Total Payroll Cost", money(data.totals.totalCost)],
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

  if (!data.employeeFilter) {
    y = sectionLabel(c, y, `Employees (${data.summaryRows.length})`);
    if (!data.summaryRows.length) {
      emptyNote(c, y);
    } else {
      const colEmp = 48, colChk = PAGE_W - 48 - 320, colGross = PAGE_W - 48 - 250, colEeTax = PAGE_W - 48 - 170, colErTax = PAGE_W - 48 - 90, colNet = PAGE_W - 48;
      c.text(colEmp, y, "Employee", { size: 8, bold: true, color: MUTED });
      c.text(colChk, y, "Checks", { size: 8, bold: true, color: MUTED, align: "right" });
      c.text(colGross, y, "Gross", { size: 8, bold: true, color: MUTED, align: "right" });
      c.text(colEeTax, y, "EE Taxes", { size: 8, bold: true, color: MUTED, align: "right" });
      c.text(colErTax, y, "ER Taxes", { size: 8, bold: true, color: MUTED, align: "right" });
      c.text(colNet, y, "Net Pay", { size: 8, bold: true, color: MUTED, align: "right" });
      y += 6;
      c.line(48, y, PAGE_W - 48, y, LINE, 0.75);
      y += 14;
      for (const r of data.summaryRows) {
        if (y > PAGE_H - 60) {
          drawFooter(c, profile.firmName);
          ({ page, c } = await newPage(doc, font, bold));
          y = 60;
        }
        c.text(colEmp, y, r.employee.slice(0, 30), { size: 9 });
        c.text(colChk, y, String(r.checkCount), { size: 9, align: "right" });
        c.text(colGross, y, money(r.grossWages), { size: 9, align: "right" });
        c.text(colEeTax, y, money(r.employeeTaxes), { size: 9, align: "right" });
        c.text(colErTax, y, money(r.employerTaxes), { size: 9, align: "right" });
        c.text(colNet, y, money(r.netPay), { size: 9, align: "right" });
        y += 14;
      }
    }
    drawFooter(c, profile.firmName);
    return doc.save();
  }

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
    // PERF-014 follow-up (found by independent review, 2026-08-13) — same
    // unbounded-loop shape as generatePayrollPdf/generateArAgingPdf, just
    // missed in that pass. Lower real-world exposure (one employee's own
    // checks, not firm-wide), but capped for consistency.
    const shownChecks = data.checks.slice(0, REPORT_ROW_CAP);
    const colDate = 48, colGross = PAGE_W - 48 - 90, colNet = PAGE_W - 48;
    c.text(colDate, y, "Date", { size: 8, bold: true, color: MUTED });
    c.text(colGross, y, "Gross", { size: 8, bold: true, color: MUTED, align: "right" });
    c.text(colNet, y, "Net", { size: 8, bold: true, color: MUTED, align: "right" });
    y += 6;
    c.line(48, y, PAGE_W - 48, y, LINE, 0.75);
    y += 14;
    for (const check of shownChecks) {
      if (y > PAGE_H - 60) {
        drawFooter(c, profile.firmName);
        ({ page, c } = await newPage(doc, font, bold));
        y = 60;
      }
      c.text(colDate, y, fmtDate(check.payDate), { size: 9 });
      c.text(colGross, y, money(check.gross), { size: 9, align: "right" });
      c.text(colNet, y, money(check.net), { size: 9, align: "right" });
      y += 14;
    }
    if (data.checks.length > shownChecks.length) {
      if (y > PAGE_H - 60) { drawFooter(c, profile.firmName); ({ page, c } = await newPage(doc, font, bold)); y = 60; }
      c.text(colDate, y, `+ ${data.checks.length - shownChecks.length} more — export CSV for the full list.`, { size: 8.5, color: MUTED });
      y += 14;
    }
  }

  drawFooter(c, profile.firmName);
  return doc.save();
}

export interface SalesTaxCategoryRow { categoryName: string; state: string | null; rate: number; taxableAmount: number; taxAmount: number }
export interface SalesTaxSaleRow { saleId: string; saleDate: string | null; grossSales: number; totalTaxDue: number; adjustments: number; nonTaxableSales: number; taxableSales: number }

export interface SalesTaxReportData {
  client: ReportClientInfo;
  from: string; to: string;
  byCategory: SalesTaxCategoryRow[];
  sales: SalesTaxSaleRow[];
  totals: { grossSales: number; taxDue: number; adjustments: number; saleCount: number };
  mdFiling?: {
    periods: (MdFilingResult & { start: string; end: string; dueDate: string; targetFilingDate: string; filedDate: string; paidDate: string; markedFiledDate: string | null; markedPaidDate: string | null })[];
    totals: { taxDue: number; discount: number; penalty: number; interest: number; balanceDue: number };
    frequencyUsed: string | null;
    filedDate: string;
    paidDate: string;
  } | null;
}

/**
 * Sales & Tax report — the category-by-category breakdown a sales tax return
 * actually needs, which no existing report covered (P&L/Balance Sheet read the
 * GL, where sales tax is one rolled-up "Sales Tax Payable" number with no
 * category detail).
 */
export async function generateSalesTaxPdf(data: SalesTaxReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setPdfTitle(doc, [data.client.clientName, "Sales & Tax", `${fmtDate(data.from)} to ${fmtDate(data.to)}`]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let { page, c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();
  let y = drawHeader(c, data.client, "SALES & TAX REPORT", `${fmtDate(data.from)} – ${fmtDate(data.to)}`, profile.firmName);

  const tiles: [string, string][] = [
    ["Gross Sales", money(data.totals.grossSales)],
    ["Total Tax Due", money(data.totals.taxDue)],
    ["Sales Recorded", String(data.totals.saleCount)],
  ];
  const tileW = (PAGE_W - 96 - 2 * 10) / 3;
  tiles.forEach(([label, value], i) => {
    const x = 48 + i * (tileW + 10);
    c.rect(x, y, tileW, 44, TEAL_TINT);
    c.text(x + 10, y + 16, label.toUpperCase(), { size: 7, bold: true, color: MUTED });
    c.text(x + 10, y + 34, value, { size: 13, bold: true });
  });
  y += 58;

  y = sectionLabel(c, y, "Tax by Category");
  if (!data.byCategory.length) {
    y = emptyNote(c, y) + 12;
  } else {
    const colCat = 48, colRate = PAGE_W - 48 - 250, colTaxable = PAGE_W - 48 - 130, colTax = PAGE_W - 48;
    c.text(colCat, y, "Category", { size: 8, bold: true, color: MUTED });
    c.text(colRate, y, "Rate", { size: 8, bold: true, color: MUTED, align: "right" });
    c.text(colTaxable, y, "Taxable Sales", { size: 8, bold: true, color: MUTED, align: "right" });
    c.text(colTax, y, "Tax", { size: 8, bold: true, color: MUTED, align: "right" });
    y += 6;
    c.line(48, y, PAGE_W - 48, y, LINE, 0.75);
    y += 14;
    for (const r of data.byCategory) {
      if (y > PAGE_H - 60) {
        drawFooter(c, profile.firmName);
        ({ page, c } = await newPage(doc, font, bold));
        y = 60;
      }
      c.text(colCat, y, `${r.categoryName}${r.state ? ` (${r.state})` : ""}`.slice(0, 46), { size: 9 });
      c.text(colRate, y, `${(r.rate * 100).toFixed(2)}%`, { size: 9, align: "right" });
      c.text(colTaxable, y, money(r.taxableAmount), { size: 9, align: "right" });
      c.text(colTax, y, money(r.taxAmount), { size: 9, align: "right" });
      y += 15;
    }
    y += 2;
    c.line(48, y, PAGE_W - 48, y, INK, 1);
    y += 14;
    const taxableTotal = data.byCategory.reduce((s, r) => s + r.taxableAmount, 0);
    c.text(colCat, y, "Total", { size: 9, bold: true });
    c.text(colTaxable, y, money(taxableTotal), { size: 9, bold: true, align: "right" });
    c.text(colTax, y, money(data.byCategory.reduce((s, r) => s + r.taxAmount, 0)), { size: 9, bold: true, align: "right" });
    y += 26;
  }

  y = sectionLabel(c, y, `Sales Recorded (${data.sales.length})`);
  if (!data.sales.length) {
    emptyNote(c, y);
  } else {
    // 6 columns need to fit in the same 516pt body width as every other
    // table here — headers run at size 7 (down from 8) specifically in this
    // row so "Non-Taxable Sales" and "Taxable Sales" don't collide at their
    // shared boundary; the money values themselves stay size 9 since digits
    // are narrow and never get close to the column edge.
    const colDate = 48, colGross = PAGE_W - 48 - 357, colTaxable = PAGE_W - 48 - 268, colNonTax = PAGE_W - 48 - 179, colAdj = PAGE_W - 48 - 90, colDue = PAGE_W - 48;
    c.text(colDate, y, "Date", { size: 7, bold: true, color: MUTED });
    c.text(colGross, y, "Gross Sales", { size: 7, bold: true, color: MUTED, align: "right" });
    c.text(colTaxable, y, "Taxable Sales", { size: 7, bold: true, color: MUTED, align: "right" });
    c.text(colNonTax, y, "Non-Taxable Sales", { size: 7, bold: true, color: MUTED, align: "right" });
    c.text(colAdj, y, "Adjustments", { size: 7, bold: true, color: MUTED, align: "right" });
    c.text(colDue, y, "Tax Due", { size: 7, bold: true, color: MUTED, align: "right" });
    y += 6;
    c.line(48, y, PAGE_W - 48, y, LINE, 0.75);
    y += 14;
    for (const s of data.sales) {
      if (y > PAGE_H - 60) {
        drawFooter(c, profile.firmName);
        ({ page, c } = await newPage(doc, font, bold));
        y = 60;
      }
      c.text(colDate, y, fmtDate(s.saleDate), { size: 9 });
      c.text(colGross, y, money(s.grossSales), { size: 9, align: "right" });
      c.text(colTaxable, y, money(s.taxableSales), { size: 9, align: "right" });
      c.text(colNonTax, y, money(s.nonTaxableSales), { size: 9, align: "right" });
      c.text(colAdj, y, money(s.adjustments), { size: 9, align: "right" });
      c.text(colDue, y, money(s.totalTaxDue), { size: 9, align: "right" });
      y += 14;
    }
  }

  if (data.mdFiling && data.mdFiling.periods.length) {
    if (y > PAGE_H - 120) {
      drawFooter(c, profile.firmName);
      ({ page, c } = await newPage(doc, font, bold));
      y = 60;
    }
    y += 10;
    y = sectionLabel(c, y, "Filing Discount / Late Penalty (Form 202)");
    y = row(c, y, "Filing date", fmtDate(data.mdFiling.filedDate));
    y = row(c, y, "Payment date", fmtDate(data.mdFiling.paidDate));
    if (!data.mdFiling.frequencyUsed) {
      c.text(48, y, "Filing frequency not set on client profile — shown as one combined period; verify against the client's actual filing schedule.", { size: 8, color: MUTED });
      y += 16;
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    for (const p of data.mdFiling.periods) {
      // A late period draws up to 9 lines (~136pt: header + 7 rows + the
      // period-header's own leading gap) after this check passes, so the
      // threshold has to leave that much room above the footer — the old
      // fixed "PAGE_H - 110" left only ~16pt, which is why a period landing
      // near the bottom of a page ran straight into the footer text instead
      // of rolling to a new page.
      if (y > PAGE_H - 182) {
        drawFooter(c, profile.firmName);
        ({ page, c } = await newPage(doc, font, bold));
        y = 60;
      }
      y += 6;
      c.text(48, y, `${fmtDate(p.start)} – ${fmtDate(p.end)}`, { size: 9, bold: true, color: TEAL });
      y += 14;
      // A period genuinely filed-but-not-yet-paid (Save & Send, marked filed
      // with no payment recorded) has non-trustworthy onTime/discount/penalty
      // math — see computeMdFilingBreakdown's filedPendingPayment branch —
      // so it gets its own row set instead of claiming a discount was earned
      // or penalty/interest accrued on a payment date that doesn't exist yet.
      const status = classifyMdFilingPeriod(p, todayStr);
      y = row(c, y, "Return due date", fmtDate(p.dueDate), { indent: true });
      y = row(c, y, "Target filing date (internal)", fmtDate(p.targetFilingDate), { indent: true });
      y = row(c, y, "Filed Date", fmtDate(p.filedDate), { indent: true });
      y = row(c, y, "Payment Date", status === "filedPendingPayment" ? "Not yet recorded" : fmtDate(p.paidDate), { indent: true });
      y = row(c, y, "Tax due", money(p.taxDue), { indent: true });
      if (status === "filedPendingPayment") {
        y = row(c, y, "Balance due (payment pending — discount/penalty not yet determined)", money(p.balanceDue), { bold: true, accent: true, indent: true });
      } else if (p.onTime) {
        y = row(c, y, "Timely discount (Line 18)", `− ${money(p.discount)}`, { indent: true });
        y = row(c, y, "Balance due (Line 20)", money(p.balanceDue), { bold: true, accent: true, indent: true });
      } else {
        y = row(c, y, "Penalty — 10% (Line 37a)", money(p.penalty), { indent: true });
        y = row(c, y, `Interest — ${(p.interestRateMonthly * 100).toFixed(4)}% × ${p.monthsLate} mo (Line 37b)`, money(p.interest), { indent: true });
        y = row(c, y, "Balance due (Line 38)", money(p.balanceDue), { bold: true, accent: true, indent: true });
      }
    }
    if (data.mdFiling.periods.length > 1) {
      // This trailing summary (4 rows, ~84pt with its leading line/gap) had
      // no overflow check at all — it always drew right after the last
      // period regardless of how close to the bottom that left the cursor,
      // which is exactly what produced the overlap with drawFooter's
      // fixed-position text: a report whose last period ended just above
      // the old threshold still had this block run straight past the
      // footer with nothing to catch it.
      if (y > PAGE_H - 130) {
        drawFooter(c, profile.firmName);
        ({ page, c } = await newPage(doc, font, bold));
        y = 60;
      }
      y += 6;
      c.line(48, y, PAGE_W - 48, y, INK, 1);
      y += 14;
      y = row(c, y, "Total discount", `− ${money(data.mdFiling.totals.discount)}`);
      y = row(c, y, "Total penalty", money(data.mdFiling.totals.penalty));
      y = row(c, y, "Total interest", money(data.mdFiling.totals.interest));
      y = row(c, y, "Total balance due", money(data.mdFiling.totals.balanceDue), { bold: true, accent: true });
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
  setPdfTitle(doc, [data.client.clientName, "Client Message", `${fmtDate(data.from)} to ${fmtDate(data.to)}`]);
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

export interface SalesTaxPayrollReportData {
  client: ReportClientInfo;
  from: string; to: string;
  sections: { title: string; rows: { label: string; value: string }[] }[];
}

/**
 * Standalone report version of the same figures Client Message sends — a clean
 * label/value table per section (Summary, Sales Tax Detail, Payroll Summary, Payroll
 * Tax Detail, Important Dates) instead of a wall of pre-formatted text. English-only
 * for the same reason generateClientMessagePdf is: pdf-lib has no Arabic shaping (see
 * this file's top doc comment) — the on-screen and emailed versions carry the real
 * Arabic translation, only this specific PDF path can't render it correctly.
 */
export async function generateSalesTaxPayrollReportPdf(data: SalesTaxPayrollReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setPdfTitle(doc, [data.client.clientName, "Sales, Tax & Payroll Report", `${fmtDate(data.from)} to ${fmtDate(data.to)}`]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let { page, c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();
  let y = drawHeader(c, data.client, "SALES, TAX & PAYROLL REPORT", `${fmtDate(data.from)} – ${fmtDate(data.to)}`, profile.firmName);

  if (data.sections.length === 0) {
    y = emptyNote(c, y);
  }
  for (const section of data.sections) {
    if (y > PAGE_H - 80) {
      drawFooter(c, profile.firmName);
      ({ page, c } = await newPage(doc, font, bold));
      y = 60;
    }
    y = sectionLabel(c, y, section.title);
    for (const r of section.rows) {
      if (y > PAGE_H - 60) {
        drawFooter(c, profile.firmName);
        ({ page, c } = await newPage(doc, font, bold));
        y = 60;
      }
      y = row(c, y, r.label, r.value);
    }
    y += 8;
  }

  drawFooter(c, profile.firmName);
  return doc.save();
}

export interface FirmOverviewMonth { month: string; revenue: number; expenses: number; profit: number }
export interface FirmOverviewReportData {
  from: string;
  to: string;
  months: FirmOverviewMonth[];
  totals: { revenue: number; expenses: number; profit: number };
  unpaidBalance: number; unpaidInvoiceCount: number; activeClientCount: number | null;
  clientName?: string;
}

/** Firm-wide analytics PDF — AL Tax Service's own numbers across every client, not a client deliverable, hence drawFirmHeader (firm letterhead) instead of drawHeader (client letterhead). Mirrors ReportsPage.tsx's Firm Overview tab exactly. Also doubles as a single client's overview when clientName/activeClientCount=null are passed (same layout, scoped numbers, no "active clients" stat since that's meaningless for one client). */
export async function generateFirmOverviewPdf(data: FirmOverviewReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setPdfTitle(doc, [data.clientName || "Firm", "Firm Overview", `${fmtDate(data.from)} to ${fmtDate(data.to)}`]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { page, c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();
  const logo = await embedFirmLogo(doc, profile);
  const title = data.clientName ? `${data.clientName.toUpperCase()} — OVERVIEW` : "FIRM OVERVIEW";
  let y = drawFirmHeader(page, c, title, `${fmtDate(data.from)} – ${fmtDate(data.to)}`, profile, logo);

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
  const statLine = data.activeClientCount == null
    ? `${data.unpaidInvoiceCount} unpaid invoices`
    : `${data.activeClientCount} active clients  ·  ${data.unpaidInvoiceCount} unpaid invoices`;
  c.text(48, y, statLine, { size: 9, color: MUTED });
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

export interface ArAgingRow {
  clientId: string; clientName: string;
  current: number; d1_30: number; d31_60: number; d61_90: number; d90Plus: number; total: number;
}
export interface ArAgingReportData {
  asOf: string;
  rows: ArAgingRow[];
  totals: { current: number; d1_30: number; d31_60: number; d61_90: number; d90Plus: number; total: number };
}

/** Firm-wide — which clients owe the firm money and how overdue, bucketed off each open invoice's due_date. Internal collections tool, not a client deliverable, hence the firm letterhead. */
export async function generateArAgingPdf(data: ArAgingReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setPdfTitle(doc, ["AR Aging", fmtDate(data.asOf)]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let { page, c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();
  const logo = await embedFirmLogo(doc, profile);
  let y = drawFirmHeader(page, c, "AR AGING", `As of ${fmtDate(data.asOf)}`, profile, logo);

  const tiles: [string, string][] = [
    ["Total Outstanding", money(data.totals.total)], ["Current", money(data.totals.current)],
    ["1-30 Days", money(data.totals.d1_30)], ["31-60 Days", money(data.totals.d31_60)],
    ["61-90 Days", money(data.totals.d61_90)], ["90+ Days", money(data.totals.d90Plus)],
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

  y = sectionLabel(c, y, `Clients With A Balance (${data.rows.length})`);
  if (!data.rows.length) {
    emptyNote(c, y);
  } else {
    // Two lines per client (name+total, then buckets on their own line) rather than
    // one packed row — a fixed-width "Client" column sized for a short name (the
    // original layout) ran straight into the neighboring dollar column for this
    // firm's real client names (many 25-40+ characters), producing overlapping,
    // unreadable text. Giving the name its own full-width line makes overlap
    // impossible regardless of how long a real client name is.
    const L = 48, R = PAGE_W - 48;
    const drawRow = (name: string, total: number, bold_: boolean, current: number, d1_30: number, d31_60: number, d61_90: number, d90Plus: number) => {
      c.text(L, y, name, { size: 9.5, bold: bold_ });
      c.text(R, y, money(total), { size: 9.5, bold: true, align: "right" });
      y += 12;
      const bucketColor = d61_90 > 0 || d90Plus > 0 ? rgb(0.6, 0.25, 0.15) : MUTED;
      const bucketLine = `Current ${money(current)}   ·   1-30 ${money(d1_30)}   ·   31-60 ${money(d31_60)}   ·   61-90 ${money(d61_90)}   ·   90+ ${money(d90Plus)}`;
      c.text(L + 8, y, bucketLine, { size: 8, color: bucketColor });
      y += 15;
    };
    // PERF-014 (hard audit, 2026-08-13): capped so a firm with hundreds of
    // clients carrying a balance can't turn this into an unbounded PDF —
    // this already paginates across pages fine, but a firm-wide collections
    // list has no natural upper bound the way a chart of accounts does.
    const shownRows = data.rows.slice(0, REPORT_ROW_CAP);
    for (const r of shownRows) {
      if (y > PAGE_H - 75) {
        drawFooter(c, profile.firmName);
        ({ page, c } = await newPage(doc, font, bold));
        y = 60;
      }
      drawRow(r.clientName.slice(0, 60), r.total, false, r.current, r.d1_30, r.d31_60, r.d61_90, r.d90Plus);
    }
    if (data.rows.length > shownRows.length) {
      if (y > PAGE_H - 75) { drawFooter(c, profile.firmName); ({ page, c } = await newPage(doc, font, bold)); y = 60; }
      c.text(L, y, `+ ${data.rows.length - shownRows.length} more clients — export CSV for the full list.`, { size: 8.5, color: MUTED });
      y += 15;
    }
    y += 4;
    c.line(L, y, R, y, INK, 1);
    y += 14;
    drawRow("Total", data.totals.total, true, data.totals.current, data.totals.d1_30, data.totals.d31_60, data.totals.d61_90, data.totals.d90Plus);
  }

  drawFooter(c, profile.firmName, "Internal firm analytics — not a client-facing document.");
  return doc.save();
}

export interface ClientListingRow {
  clientId: string; clientName: string; ein: string | null; entityType: string | null;
  status: string | null; assignedTo: string | null; address: string | null;
}
export interface ClientListingReportData {
  rows: ClientListingRow[];
  detailed: boolean;
  maskEin: boolean;
}

/**
 * Last-4-visible EIN mask, e.g. "12-3456789" -> "**-***6789" — keeps the
 * dash in place (cosmetic only) and masks every digit except the last 4, the
 * common convention for a "sensitive but still distinguishable" identifier
 * on a printed roster that might leave the office.
 */
function maskEinDigits(ein: string): string {
  const digits = ein.replace(/\D/g, "");
  if (digits.length <= 4) return ein.replace(/\d/g, "*");
  const visible = digits.slice(-4);
  const maskedDigits = "*".repeat(digits.length - 4) + visible;
  let i = 0;
  return ein.replace(/\d/g, () => maskedDigits[i++]);
}

/**
 * Firm-wide client roster — internal analytics, not a client deliverable
 * (same firm-letterhead framing as AR Aging/Firm Overview above). "Listing"
 * is just Code + Name; "Detailed" adds EIN (optionally masked), entity type,
 * status, and assigned staff. No REPORT_ROW_CAP here — unlike a transaction
 * log this is a bounded-by-nature list (a firm's own client count, not
 * unbounded ledger activity), and clipping the very report whose purpose is
 * "list every client" would silently drop real clients from their own
 * roster.
 */
export async function generateClientListingPdf(data: ClientListingReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const reportTitle = data.detailed ? "Client Detailed Listing" : "Client Listing";
  setPdfTitle(doc, [reportTitle, fmtDate(new Date())]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let { page, c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();
  const logo = await embedFirmLogo(doc, profile);
  let y = drawFirmHeader(page, c, reportTitle.toUpperCase(), `${data.rows.length} client${data.rows.length === 1 ? "" : "s"}`, profile, logo);

  const L = 48, R = PAGE_W - 48;
  // Detailed columns: Code | Name | EIN | Entity Type | Status | Assigned To.
  const colCode = L, colName = L + 60, colEin = L + 210, colEntity = L + 290, colStatus = L + 380, colAssigned = L + 440;

  function drawColumnHeaders(): number {
    c.text(colCode, y, "CODE", { size: 8, bold: true, color: MUTED });
    c.text(data.detailed ? colName : colCode + 60, y, "NAME", { size: 8, bold: true, color: MUTED });
    if (data.detailed) {
      c.text(colEin, y, "EIN", { size: 8, bold: true, color: MUTED });
      c.text(colEntity, y, "ENTITY TYPE", { size: 8, bold: true, color: MUTED });
      c.text(colStatus, y, "STATUS", { size: 8, bold: true, color: MUTED });
      c.text(colAssigned, y, "ASSIGNED TO", { size: 8, bold: true, color: MUTED });
    }
    y += 6;
    c.line(L, y, R, y, LINE, 0.75);
    return y + 14;
  }
  y = drawColumnHeaders();

  if (!data.rows.length) {
    emptyNote(c, y);
  } else {
    for (const r of data.rows) {
      if (y > PAGE_H - 60) {
        drawFooter(c, profile.firmName);
        ({ page, c } = await newPage(doc, font, bold));
        y = 60;
        y = drawColumnHeaders();
      }
      c.text(colCode, y, r.clientId, { size: 9 });
      c.text(data.detailed ? colName : colCode + 60, y, r.clientName.slice(0, data.detailed ? 32 : 70), { size: 9 });
      if (data.detailed) {
        const einDisplay = r.ein ? (data.maskEin ? maskEinDigits(r.ein) : r.ein) : "—";
        c.text(colEin, y, einDisplay, { size: 8.5, color: MUTED });
        c.text(colEntity, y, (r.entityType || "—").slice(0, 16), { size: 8.5, color: MUTED });
        c.text(colStatus, y, r.status || "—", { size: 8.5, color: MUTED });
        c.text(colAssigned, y, (r.assignedTo || "—").slice(0, 18), { size: 8.5, color: MUTED });
      }
      y += 14;
    }
  }

  drawFooter(c, profile.firmName, "Internal firm analytics — not a client-facing document.");
  return doc.save();
}

export interface FirmInsightsReportData {
  from: string; to: string;
  revenueByServiceType: { serviceType: string; revenue: number; pctOfTotal: number }[];
  clientConcentration: { clientName: string; revenue: number; pctOfTotal: number }[];
  concentrationRisk: { top5Pct: number; top10Pct: number };
  mdOnTimeFilingRate: { onTime: number; late: number; missing: number; filedPendingPayment: number; notYetDue: number; pct: number | null };
  filingCompliance: {
    onTime: number; late: number; missing: number; notYetDue: number; pct: number | null;
    byServiceLine: { serviceLine: string; onTime: number; late: number; missing: number; pct: number | null }[];
  };
  estimateWinRate: { won: number; lost: number; stillOpen: number; winRatePct: number | null };
  clientGrowth: { monthly: { month: string; newClients: number; likelyBulkImport: boolean }[]; activeClientCountNow: number };
  staffUtilization: { name: string; totalHours: number; billableHours: number; billablePct: number }[];
}

/**
 * A print-friendly version of the Firm Report dashboard (FirmReportPage.tsx)
 * — that page only ever had CSV/Excel export until now, no viewable/
 * printable document. Same section order as the on-screen panels and the
 * CSV export's sections, condensed into compact tables so all 6-7 pieces
 * plausibly fit a handful of pages instead of one per metric.
 */
export async function generateFirmInsightsPdf(data: FirmInsightsReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setPdfTitle(doc, ["Firm Report", `${fmtDate(data.from)} to ${fmtDate(data.to)}`]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let { page, c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();
  const logo = await embedFirmLogo(doc, profile);
  let y = drawFirmHeader(page, c, "FIRM REPORT", `${fmtDate(data.from)} – ${fmtDate(data.to)}`, profile, logo);

  async function breakIfNeeded(minRoom: number) {
    if (y > PAGE_H - minRoom) {
      drawFooter(c, profile.firmName);
      ({ page, c } = await newPage(doc, font, bold));
      y = 60;
    }
  }

  // --- Summary tiles ---
  const tiles: [string, string][] = [
    ["MD On-Time Rate", data.mdOnTimeFilingRate.pct !== null ? `${data.mdOnTimeFilingRate.pct}%` : "—"],
    ["Filing Compliance", data.filingCompliance.pct !== null ? `${data.filingCompliance.pct}%` : "—"],
    ["Estimate Win Rate", data.estimateWinRate.winRatePct !== null ? `${data.estimateWinRate.winRatePct}%` : "—"],
    ["Active Clients", String(data.clientGrowth.activeClientCountNow)],
  ];
  const tileW = (PAGE_W - 96 - 3 * 10) / 4;
  tiles.forEach(([label, value], i) => {
    const x = 48 + i * (tileW + 10);
    c.rect(x, y, tileW, 40, TEAL_TINT);
    c.text(x + 8, y + 15, label.toUpperCase(), { size: 6.5, bold: true, color: MUTED });
    c.text(x + 8, y + 31, value, { size: 13, bold: true });
  });
  y += 56;

  // --- Revenue by Service Type ---
  y = sectionLabel(c, y, "Revenue by Service Type");
  const L = 48, R = PAGE_W - 48;
  c.text(L, y, "Service Type", { size: 8, bold: true, color: MUTED });
  c.text(R - 100, y, "Revenue", { size: 8, bold: true, color: MUTED, align: "right" });
  c.text(R, y, "% of Total", { size: 8, bold: true, color: MUTED, align: "right" });
  y += 6; c.line(L, y, R, y, LINE, 0.75); y += 13;
  for (const r of data.revenueByServiceType) {
    await breakIfNeeded(75);
    c.text(L, y, r.serviceType, { size: 9 });
    c.text(R - 100, y, money(r.revenue), { size: 9, align: "right" });
    c.text(R, y, `${r.pctOfTotal}%`, { size: 9, align: "right" });
    y += 13;
  }
  y += 10;

  // --- Client Concentration ---
  await breakIfNeeded(90);
  y = sectionLabel(c, y, `Client Concentration — Top 5: ${data.concentrationRisk.top5Pct}%, Top 10: ${data.concentrationRisk.top10Pct}%`);
  c.text(L, y, "Client", { size: 8, bold: true, color: MUTED });
  c.text(R - 100, y, "Revenue", { size: 8, bold: true, color: MUTED, align: "right" });
  c.text(R, y, "% of Total", { size: 8, bold: true, color: MUTED, align: "right" });
  y += 6; c.line(L, y, R, y, LINE, 0.75); y += 13;
  for (const cl of data.clientConcentration) {
    await breakIfNeeded(75);
    c.text(L, y, cl.clientName.slice(0, 45), { size: 9 });
    c.text(R - 100, y, money(cl.revenue), { size: 9, align: "right" });
    c.text(R, y, `${cl.pctOfTotal}%`, { size: 9, align: "right" });
    y += 13;
  }
  y += 10;

  // --- MD On-Time Filing Rate ---
  await breakIfNeeded(60);
  y = sectionLabel(c, y, "MD On-Time Filing Rate (Maryland Sales Tax only)");
  c.text(L, y, `On-Time: ${data.mdOnTimeFilingRate.pct !== null ? `${data.mdOnTimeFilingRate.pct}%` : "—"}   ·   On Time: ${data.mdOnTimeFilingRate.onTime}   ·   Late: ${data.mdOnTimeFilingRate.late}   ·   Missing: ${data.mdOnTimeFilingRate.missing}`, { size: 9 });
  y += 12;
  c.text(L, y, `${data.mdOnTimeFilingRate.filedPendingPayment} filed with payment pending, ${data.mdOnTimeFilingRate.notYetDue} not yet due — neither counts toward the rate.`, { size: 8, color: MUTED });
  y += 20;

  // --- Firm-Wide Filing Compliance ---
  await breakIfNeeded(90);
  y = sectionLabel(c, y, "Firm-Wide Filing Compliance (every agency — federal, other states, payroll)");
  c.text(L, y, `On-Time: ${data.filingCompliance.pct !== null ? `${data.filingCompliance.pct}%` : "—"}   ·   On Time: ${data.filingCompliance.onTime}   ·   Late: ${data.filingCompliance.late}   ·   Missing: ${data.filingCompliance.missing}`, { size: 9 });
  y += 16;
  if (data.filingCompliance.byServiceLine.length) {
    c.text(L, y, "Service Line", { size: 8, bold: true, color: MUTED });
    c.text(R - 80, y, "On-Time", { size: 8, bold: true, color: MUTED, align: "right" });
    c.text(R - 40, y, "Late", { size: 8, bold: true, color: MUTED, align: "right" });
    c.text(R, y, "Missing", { size: 8, bold: true, color: MUTED, align: "right" });
    y += 6; c.line(L, y, R, y, LINE, 0.75); y += 13;
    for (const s of data.filingCompliance.byServiceLine) {
      await breakIfNeeded(75);
      c.text(L, y, s.serviceLine.slice(0, 40), { size: 9 });
      c.text(R - 80, y, s.pct !== null ? `${s.pct}%` : "—", { size: 9, align: "right" });
      c.text(R - 40, y, String(s.late), { size: 9, align: "right", color: s.late > 0 ? rgb(0.7, 0.15, 0.15) : INK });
      c.text(R, y, String(s.missing), { size: 9, align: "right", color: s.missing > 0 ? rgb(0.7, 0.15, 0.15) : INK });
      y += 13;
    }
  }
  y += 10;

  // --- Estimate Win Rate ---
  await breakIfNeeded(60);
  y = sectionLabel(c, y, "Estimate Win Rate");
  c.text(L, y, `Win Rate: ${data.estimateWinRate.winRatePct !== null ? `${data.estimateWinRate.winRatePct}%` : "—"}   ·   Won: ${data.estimateWinRate.won}   ·   Lost: ${data.estimateWinRate.lost}   ·   Still Open: ${data.estimateWinRate.stillOpen}`, { size: 9 });
  y += 20;

  // --- Client Growth ---
  await breakIfNeeded(90);
  y = sectionLabel(c, y, `Client Growth (${data.clientGrowth.activeClientCountNow} active clients today)`);
  c.text(L, y, "Month", { size: 8, bold: true, color: MUTED });
  c.text(R, y, "New Clients", { size: 8, bold: true, color: MUTED, align: "right" });
  y += 6; c.line(L, y, R, y, LINE, 0.75); y += 13;
  for (const m of data.clientGrowth.monthly) {
    await breakIfNeeded(75);
    c.text(L, y, m.month, { size: 9 });
    c.text(R, y, `${m.newClients}${m.likelyBulkImport ? "  (bulk import)" : ""}`, { size: 9, align: "right", color: m.likelyBulkImport ? MUTED : INK });
    y += 13;
  }
  y += 10;

  // --- Staff Utilization ---
  await breakIfNeeded(90);
  y = sectionLabel(c, y, "Staff Utilization");
  if (!data.staffUtilization.length) {
    emptyNote(c, y);
  } else {
    c.text(L, y, "Staff", { size: 8, bold: true, color: MUTED });
    c.text(R - 140, y, "Total Hours", { size: 8, bold: true, color: MUTED, align: "right" });
    c.text(R - 70, y, "Billable Hours", { size: 8, bold: true, color: MUTED, align: "right" });
    c.text(R, y, "Billable %", { size: 8, bold: true, color: MUTED, align: "right" });
    y += 6; c.line(L, y, R, y, LINE, 0.75); y += 13;
    for (const s of data.staffUtilization) {
      await breakIfNeeded(75);
      c.text(L, y, s.name, { size: 9 });
      c.text(R - 140, y, String(s.totalHours), { size: 9, align: "right" });
      c.text(R - 70, y, String(s.billableHours), { size: 9, align: "right" });
      c.text(R, y, `${s.billablePct}%`, { size: 9, align: "right" });
      y += 13;
    }
  }

  drawFooter(c, profile.firmName, "Internal firm analytics — not a client-facing document.");
  return doc.save();
}

export interface ClientSwotReportData {
  client: ReportClientInfo;
  asOfLabel: string;
  preparedBy: string | null;
  // Omitted entirely (not just zeroed) when the requester isn't an admin —
  // matches the same admin-only restriction this data has everywhere else
  // in the app (Financial Overview, AR Aging, the At a Glance tab itself).
  financials: { totals: { revenue: number; expenses: number; profit: number }; unpaidBalance: number; taxLiabilities: number } | null;
  overview: string; strengths: string; weaknesses: string; opportunities: string; threats: string;
  taxRecommendations: string; staffingRecommendations: string; marketingRecommendations: string; growthRecommendations: string;
  additionalNotes: string;
  // Structured findings (v3_swot_findings) — only Open/In Progress ones are
  // worth printing for a client meeting; Resolved/Dismissed stay internal.
  findings: { category: string; findingText: string; priority: string; status: string; recommendedAction: string | null; responsibleParty: string | null; targetDate: string | null }[];
}

/**
 * The actual client-facing deliverable for the SWOT/business-advisory
 * analysis (ClientSwotSection.tsx on the client's own "SWOT Analysis" tab)
 * — something a staff member can print or email to walk a client through
 * where their business stands and what to do next, not just an internal
 * screen. Client letterhead framing (drawFirmHeader, same as Firm Overview/
 * AR Aging use for their own internal-analytics look), but the footer note
 * makes clear this one IS meant for the client, unlike those two.
 *
 * Sections render sequentially (not a 2x2 SWOT grid) — this is meant to be
 * read top to bottom like a real advisory memo, and a single column avoids
 * the real complexity of tracking independent page-break points for two
 * columns of unpredictable-length free text.
 */
export async function generateClientSwotPdf(data: ClientSwotReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setPdfTitle(doc, [data.client.clientName, "Business Advisory Report"]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let { page, c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();
  const logo = await embedFirmLogo(doc, profile);
  const footerNote = `Prepared exclusively for ${data.client.clientName}${data.preparedBy ? ` by ${data.preparedBy}` : ""} — for discussion purposes, not tax advice on its own.`;
  let y = drawFirmHeader(page, c, "BUSINESS ADVISORY REPORT", data.asOfLabel, profile, logo);

  c.text(48, y, data.client.clientName.toUpperCase(), { size: 13, bold: true, color: TEAL });
  y += 22;

  async function ensureRoom(needed: number) {
    if (y + needed > PAGE_H - 60) {
      drawFooter(c, profile.firmName, footerNote);
      ({ page, c } = await newPage(doc, font, bold));
      y = 60;
    }
  }

  if (data.financials) {
    await ensureRoom(120);
    y = sectionLabel(c, y, "Financial Snapshot");
    const row1: [string, string][] = [
      ["Revenue", money(data.financials.totals.revenue)], ["Expenses", money(data.financials.totals.expenses)], ["Net Profit", money(data.financials.totals.profit)],
    ];
    const tileW3 = (PAGE_W - 96 - 2 * 10) / 3;
    row1.forEach(([label, value], i) => {
      const x = 48 + i * (tileW3 + 10);
      c.rect(x, y, tileW3, 44, TEAL_TINT);
      c.text(x + 10, y + 16, label.toUpperCase(), { size: 7, bold: true, color: MUTED });
      c.text(x + 10, y + 34, value, { size: 12, bold: true });
    });
    y += 58;
    const row2: [string, string][] = [["Unpaid Balance", money(data.financials.unpaidBalance)], ["Tax Liabilities", money(data.financials.taxLiabilities)]];
    const tileW2 = (PAGE_W - 96 - 10) / 2;
    row2.forEach(([label, value], i) => {
      const x = 48 + i * (tileW2 + 10);
      c.rect(x, y, tileW2, 44, TEAL_TINT);
      c.text(x + 10, y + 16, label.toUpperCase(), { size: 7, bold: true, color: MUTED });
      c.text(x + 10, y + 34, value, { size: 12, bold: true });
    });
    y += 66;
  }

  async function paragraphSection(title: string, text: string) {
    const clean = (text || "").trim();
    if (!clean) return;
    await ensureRoom(30);
    y = sectionLabel(c, y, title);
    for (const line of wrapText(clean, font, 10, PAGE_W - 96)) {
      await ensureRoom(16);
      c.text(48, y, line, { size: 10 });
      y += 14;
    }
    y += 10;
  }

  await paragraphSection("Business Overview", data.overview);
  await paragraphSection("Strengths", data.strengths);
  await paragraphSection("Weaknesses", data.weaknesses);
  await paragraphSection("Opportunities", data.opportunities);
  await paragraphSection("Threats", data.threats);
  await paragraphSection("Tax Strategy & Savings", data.taxRecommendations);
  await paragraphSection("Staffing & Employees", data.staffingRecommendations);
  await paragraphSection("Marketing", data.marketingRecommendations);
  await paragraphSection("Growth Plan", data.growthRecommendations);
  await paragraphSection("Additional Notes", data.additionalNotes);

  const openFindings = data.findings.filter((f) => f.status === "Open" || f.status === "In Progress");
  if (openFindings.length > 0) {
    await ensureRoom(30);
    y = sectionLabel(c, y, "Findings & Action Items");
    for (const f of openFindings) {
      await ensureRoom(30);
      c.text(48, y, `[${f.category}${f.priority === "Urgent" || f.priority === "High" ? ` — ${f.priority} priority` : ""}]`, { size: 8.5, bold: true, color: f.priority === "Urgent" ? undefined : MUTED });
      y += 12;
      for (const line of wrapText(f.findingText, font, 10, PAGE_W - 96)) {
        await ensureRoom(16);
        c.text(48, y, line, { size: 10 });
        y += 14;
      }
      if (f.recommendedAction) {
        for (const line of wrapText(`Recommended: ${f.recommendedAction}`, font, 9, PAGE_W - 96)) {
          await ensureRoom(14);
          c.text(48, y, line, { size: 9, color: MUTED });
          y += 12;
        }
      }
      const meta = [f.responsibleParty ? `Owner: ${f.responsibleParty}` : null, f.targetDate ? `Target: ${f.targetDate}` : null].filter(Boolean).join("   ");
      if (meta) { c.text(48, y, meta, { size: 8.5, color: MUTED }); y += 12; }
      y += 8;
    }
  }

  drawFooter(c, profile.firmName, footerNote);
  return doc.save();
}

export interface ClientValueReportItem { label: string; date: string; detail?: string }

export interface ClientValueReportData {
  client: ReportClientInfo;
  periodLabel: string;
  preparedBy: string | null;
  tasksCompleted: ClientValueReportItem[];
  filingsAndForms: ClientValueReportItem[];
  documentsDelivered: ClientValueReportItem[];
  // Same admin-only restriction as ClientSwotReportData.financials — omitted
  // entirely (not zeroed) for a staff requester.
  billing: { totalBilled: number; totalPaid: number; invoiceCount: number } | null;
}

/**
 * "What we did for you this year" — a client-facing deliverable summarizing
 * completed work over a date range (tasks closed, government/authorization
 * forms and HACCP packages generated, documents delivered, and — admin only
 * — billing activity), built entirely from records the app already has. A
 * relationship/retention tool for renewal conversations, not an advisory
 * memo (see generateClientSwotPdf for that) — so it stays terse: what was
 * done and when, not analysis or recommendations.
 */
export async function generateClientValueReportPdf(data: ClientValueReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setPdfTitle(doc, [data.client.clientName, "Annual Value Report", data.periodLabel]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let { page, c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();
  const logo = await embedFirmLogo(doc, profile);
  const footerNote = `Prepared exclusively for ${data.client.clientName}${data.preparedBy ? ` by ${data.preparedBy}` : ""} — a summary of completed work, not a substitute for tax advice or filed returns.`;
  let y = drawFirmHeader(page, c, "ANNUAL VALUE REPORT", data.periodLabel, profile, logo);

  c.text(48, y, data.client.clientName.toUpperCase(), { size: 13, bold: true, color: TEAL });
  y += 22;

  async function ensureRoom(needed: number) {
    if (y + needed > PAGE_H - 60) {
      drawFooter(c, profile.firmName, footerNote);
      ({ page, c } = await newPage(doc, font, bold));
      y = 60;
    }
  }

  const tiles: [string, string][] = [
    ["Tasks Completed", String(data.tasksCompleted.length)],
    ["Filings & Forms", String(data.filingsAndForms.length)],
    ["Documents Delivered", String(data.documentsDelivered.length)],
  ];
  await ensureRoom(70);
  const tileW3 = (PAGE_W - 96 - 2 * 10) / 3;
  tiles.forEach(([label, value], i) => {
    const x = 48 + i * (tileW3 + 10);
    c.rect(x, y, tileW3, 44, TEAL_TINT);
    c.text(x + 10, y + 16, label.toUpperCase(), { size: 7, bold: true, color: MUTED });
    c.text(x + 10, y + 34, value, { size: 16, bold: true });
  });
  y += 58;

  if (data.billing) {
    await ensureRoom(58);
    const tileW2 = (PAGE_W - 96 - 10) / 2;
    const billingTiles: [string, string][] = [
      ["Total Billed", money(data.billing.totalBilled)],
      ["Total Collected", money(data.billing.totalPaid)],
    ];
    billingTiles.forEach(([label, value], i) => {
      const x = 48 + i * (tileW2 + 10);
      c.rect(x, y, tileW2, 44, TEAL_TINT);
      c.text(x + 10, y + 16, label.toUpperCase(), { size: 7, bold: true, color: MUTED });
      c.text(x + 10, y + 34, value, { size: 12, bold: true });
    });
    y += 58;
  }

  // Caps a single section's line count so a busy client's list of hundreds
  // of tasks/documents can't turn this into an unbounded, silently enormous
  // PDF — matches the same "cap + say what was dropped" pattern the sibling
  // since-last-login digest already uses (system.routes.ts's LIMIT 200 +
  // its "showing the most recent 200" note).
  const LIST_ITEM_CAP = 150;

  async function listSection(title: string, items: ClientValueReportItem[]) {
    await ensureRoom(30);
    y = sectionLabel(c, y, title);
    if (items.length === 0) {
      y = emptyNote(c, y);
      y += 10;
      return;
    }
    const shown = items.slice(0, LIST_ITEM_CAP);
    for (const item of shown) {
      // Reserve room for the right-aligned date on the label's own line —
      // a long task name/filename that isn't wrapped would otherwise run
      // past the page margin or straight through the date column.
      const lines = wrapText(item.label, font, 10, PAGE_W - 96 - 90);
      await ensureRoom(16);
      c.text(48, y, lines[0] || "", { size: 10 });
      c.text(PAGE_W - 48, y, fmtDate(item.date), { size: 9, color: MUTED, align: "right" });
      y += 14;
      for (const line of lines.slice(1)) {
        await ensureRoom(14);
        c.text(48, y, line, { size: 10 });
        y += 14;
      }
      if (item.detail) {
        await ensureRoom(14);
        c.text(60, y, item.detail, { size: 8.5, color: MUTED });
        y += 12;
      }
    }
    if (items.length > shown.length) {
      await ensureRoom(14);
      c.text(48, y, `…and ${items.length - shown.length} more not shown.`, { size: 9, color: MUTED });
      y += 14;
    }
    y += 10;
  }

  await listSection("Filings & Forms Completed", data.filingsAndForms);
  await listSection("Tasks Completed", data.tasksCompleted);
  await listSection("Documents Delivered", data.documentsDelivered);

  drawFooter(c, profile.firmName, footerNote);
  return doc.save();
}

export interface ClientProfileReportData {
  client: ReportClientInfo;
  phone: string | null; email: string | null;
  companyContactName: string | null; companyContactEmail: string | null; companyContactPhone: string | null;
  status: string | null; assignedTo: string | null; serviceType: string | null; industryCategory: string | null;
  clientType: string | null; entityType: string | null; dateOfFormation: string | null; state: string | null;
  services: string[]; preferredContact: string | null; preferredLanguage: string | null;
  smsAllowed: boolean; emailAllowed: boolean; portalEnabled: boolean; referralSource: string | null;
  period: { from: string; to: string };
  financials: { revenue: number; expenses: number; grossProfit: number; netProfit: number; cogs: number };
  cashBalance: number; apEstimate: number; taxLiabilities: number;
  arAging: { current: number; d1_30: number; d31_60: number; d61_90: number; d90Plus: number; total: number };
  payrollCost: number;
  ratios: { netMarginPct: number | null; grossMarginPct: number | null; dso: number | null; ar90PlusPct: number | null };
  health: { score: number; band: "Green" | "Yellow" | "Red"; components: { label: string; points: number; maxPoints: number; detail: string }[] };
  budgetVsActual: { accountName: string; budget: number; actual: number; variance: number }[];
  budgetPeriodLabel: string;
  deadlines: { label: string; date: string; source: string }[];
}

const HEALTH_BAND_COLOR: Record<string, ReturnType<typeof rgb>> = { Green: TEAL, Yellow: rgb(0.72, 0.55, 0.05), Red: rgb(0.7, 0.15, 0.15) };

/**
 * Staff-facing printable views for the "Profile" tab and the "At a Glance"
 * tab — neither had a print/PDF option before (the earlier downloadFile()
 * audit only checked for a missing view/print PAIR on existing download
 * buttons, which never catches a screen with no download button at all).
 * variant controls which sections render: "profile" is the client's own
 * profile/contact fields only, "at-a-glance" is the financial/health/AR/
 * deadline data only — two distinct documents matching what each tab
 * actually shows, not one combined PDF shared by both print buttons (the
 * first version of this did that and the user correctly flagged it as
 * wrong — clicking Print on Profile should print the Profile tab, not a
 * bundle of both). One function, not two, since the page/header/footer
 * boilerplate is identical either way. Client letterhead (drawHeader), same
 * as every other per-client statement in this file — internal staff
 * reference, not itself a client deliverable (the Annual Value Report above
 * is the client-facing equivalent).
 */
export async function generateClientProfilePdf(data: ClientProfileReportData, variant: "profile" | "at-a-glance"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const title = variant === "profile" ? "Profile" : "At a Glance";
  setPdfTitle(doc, [data.client.clientName, title]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let { page, c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();
  let y = drawHeader(c, data.client, title.toUpperCase(), `As of ${fmtDate(new Date())}`, profile.firmName);

  async function breakIfNeeded(minRoom: number) {
    if (y > PAGE_H - minRoom) {
      drawFooter(c, profile.firmName);
      ({ page, c } = await newPage(doc, font, bold));
      y = 60;
    }
  }

  if (variant === "profile") {
    y = sectionLabel(c, y, "Profile");
    if (data.clientType) y = row(c, y, "Client Type", data.clientType);
    if (data.entityType) y = row(c, y, "Entity Type", data.entityType);
    if (data.dateOfFormation) y = row(c, y, "Date of Formation", fmtDate(data.dateOfFormation));
    if (data.state) y = row(c, y, "State", data.state);
    if (data.status) y = row(c, y, "Status", data.status);
    if (data.serviceType) y = row(c, y, "Service Type", data.serviceType);
    if (data.services.length) y = row(c, y, "Services Provided", data.services.join(", "));
    if (data.industryCategory) y = row(c, y, "Industry", data.industryCategory);
    y += 4;

    await breakIfNeeded(140);
    y = sectionLabel(c, y, "Contact & Assignment");
    if (data.phone) y = row(c, y, "Phone", data.phone);
    if (data.email) y = row(c, y, "Email", data.email);
    if (data.companyContactName) y = row(c, y, "Owner Contact", `${data.companyContactName}${data.companyContactPhone ? ` — ${data.companyContactPhone}` : ""}${data.companyContactEmail ? ` — ${data.companyContactEmail}` : ""}`);
    if (data.assignedTo) y = row(c, y, "Assigned To", data.assignedTo);
    if (data.preferredContact) y = row(c, y, "Preferred Contact", data.preferredContact);
    if (data.preferredLanguage) y = row(c, y, "Preferred Language", data.preferredLanguage);
    y = row(c, y, "SMS Enabled", data.smsAllowed ? "Yes" : "No");
    y = row(c, y, "Email Enabled", data.emailAllowed ? "Yes" : "No");
    y = row(c, y, "Portal Enabled", data.portalEnabled ? "Yes" : "No");
    if (data.referralSource) y = row(c, y, "Referral Source", data.referralSource);

    drawFooter(c, profile.firmName);
    return doc.save();
  }

  y = sectionLabel(c, y, "Client Health Score");
  const bandColor = HEALTH_BAND_COLOR[data.health.band] || INK;
  c.text(48, y, `${data.health.score} / 100`, { size: 20, bold: true, color: bandColor });
  c.text(48 + 90, y - 5, data.health.band.toUpperCase(), { size: 10, bold: true, color: bandColor });
  y += 20;
  for (const comp of data.health.components) {
    c.text(56, y, `${comp.label}: ${comp.points}/${comp.maxPoints}`, { size: 9, bold: true });
    y += 12;
    c.text(64, y, comp.detail, { size: 8.5, color: MUTED });
    y += 13;
  }
  y += 6;

  await breakIfNeeded(140);
  y = sectionLabel(c, y, `Financial Summary (${fmtDate(data.period.from)} – ${fmtDate(data.period.to)})`);
  y = row(c, y, "Revenue", money(data.financials.revenue));
  y = row(c, y, "Expenses", money(data.financials.expenses));
  y = row(c, y, "Gross Profit", money(data.financials.grossProfit));
  y = row(c, y, "Net Profit", money(data.financials.netProfit), { bold: true, accent: true });
  y = row(c, y, "Estimated Cash Balance", money(data.cashBalance));
  y = row(c, y, "Estimated A/P", money(data.apEstimate));
  y = row(c, y, "Tax Liabilities Outstanding", money(data.taxLiabilities));
  if (data.payrollCost > 0) y = row(c, y, "Payroll Cost (period)", money(data.payrollCost));
  y += 8;

  await breakIfNeeded(120);
  y = sectionLabel(c, y, "A/R Aging");
  y = row(c, y, "Current", money(data.arAging.current));
  y = row(c, y, "1-30 Days", money(data.arAging.d1_30));
  y = row(c, y, "31-60 Days", money(data.arAging.d31_60));
  y = row(c, y, "61-90 Days", money(data.arAging.d61_90), { accent: data.arAging.d61_90 > 0 });
  y = row(c, y, "90+ Days", money(data.arAging.d90Plus), { bold: data.arAging.d90Plus > 0, accent: data.arAging.d90Plus > 0 });
  y = row(c, y, "Total Outstanding", money(data.arAging.total), { bold: true });
  y += 8;

  if (data.budgetVsActual.length > 0) {
    await breakIfNeeded(100);
    y = sectionLabel(c, y, `Budget vs Actual (${data.budgetPeriodLabel})`);
    for (const b of data.budgetVsActual.slice(0, 10)) {
      await breakIfNeeded(60);
      c.text(48, y, b.accountName, { size: 9 });
      c.text(PAGE_W - 48, y, `${money(b.actual)} vs ${money(b.budget)} (${b.variance >= 0 ? "+" : ""}${money(b.variance)})`, { size: 9, align: "right", color: Math.abs(b.variance) > 0 ? (b.variance < 0 ? rgb(0.7, 0.15, 0.15) : TEAL) : MUTED });
      y += 14;
    }
    y += 6;
  }

  await breakIfNeeded(100);
  y = sectionLabel(c, y, "Upcoming Deadlines");
  if (!data.deadlines.length) {
    y = emptyNote(c, y);
  } else {
    for (const d of data.deadlines) {
      await breakIfNeeded(60);
      c.text(48, y, d.label, { size: 9 });
      c.text(PAGE_W - 48, y, `${fmtDate(d.date)} — ${d.source}`, { size: 9, align: "right", color: MUTED });
      y += 14;
    }
  }

  drawFooter(c, profile.firmName, "Internal staff reference — cash/A/P figures are ledger-derived estimates, not a live bank feed.");
  return doc.save();
}

export interface CalculatorSalesTaxLine { categoryName: string; taxableAmount: number; rate: number; taxAmount: number }
export interface CalculatorSalesTaxMdFiling {
  dueDate: string; targetFilingDate: string; filedDate: string; paidDate: string; onTime: boolean;
  discount: number; penalty: number; interest: number; interestRateMonthly: number; monthsLate: number; balanceDue: number;
}
export interface CalculatorSalesTaxPdfData {
  state: string;
  lines: CalculatorSalesTaxLine[];
  totalTaxableAmount: number;
  taxableOnlyAmount: number;
  totalTax: number;
  grandTotal: number;
  mdFiling?: CalculatorSalesTaxMdFiling | null;
}

/**
 * Tools → Calculators' Sales Tax card, as a PDF — the calculator has no
 * client or saved record behind it (see calculators.routes.ts), so this
 * uses the firm letterhead (drawFirmHeader) rather than a client's, the same
 * choice generateFirmOverviewPdf makes for the same reason. Unlike that one
 * this IS meant to be sent onward (Preview PDF / Email on the calculator
 * card), so the footer omits the "internal analytics" disclaimer.
 */
export async function generateCalculatorSalesTaxPdf(data: CalculatorSalesTaxPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setPdfTitle(doc, ["Sales Tax Calculator", data.state]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { page, c } = await newPage(doc, font, bold);
  const profile = await getFirmProfile();
  const logo = await embedFirmLogo(doc, profile);
  let y = drawFirmHeader(page, c, "SALES TAX CALCULATION", `${data.state} · ${fmtDate(new Date())}`, profile, logo);

  y = sectionLabel(c, y, "Sales by Category");
  for (const l of data.lines) {
    y = row(c, y, `${l.categoryName} — ${money(l.taxableAmount)} @ ${l.rate}%`, money(l.taxAmount));
  }
  y += 4;
  c.line(48, y, PAGE_W - 48, y, LINE, 0.75);
  y += 12;
  y = row(c, y, "Gross sales (Line 3)", money(data.totalTaxableAmount));
  y = row(c, y, "Taxable amount", money(data.taxableOnlyAmount));
  y = row(c, y, "Total tax", money(data.totalTax), { bold: true });
  y = row(c, y, "Grand total", money(data.grandTotal), { bold: true, accent: true });

  if (data.mdFiling) {
    y += 10;
    y = sectionLabel(c, y, "Filing Discount / Late Penalty (Form 202)");
    y = row(c, y, "Return due date", fmtDate(data.mdFiling.dueDate));
    y = row(c, y, "Target filing date (internal)", fmtDate(data.mdFiling.targetFilingDate));
    y = row(c, y, "Filing date", fmtDate(data.mdFiling.filedDate));
    y = row(c, y, "Payment date", fmtDate(data.mdFiling.paidDate));
    if (data.mdFiling.onTime) {
      y = row(c, y, "Timely discount (Line 18)", `− ${money(data.mdFiling.discount)}`);
      y = row(c, y, "Balance due (Line 20)", money(data.mdFiling.balanceDue), { bold: true, accent: true });
    } else {
      y = row(c, y, "Penalty — 10% (Line 37a)", money(data.mdFiling.penalty));
      y = row(c, y, `Interest — ${(data.mdFiling.interestRateMonthly * 100).toFixed(4)}% × ${data.mdFiling.monthsLate} mo (Line 37b)`, money(data.mdFiling.interest));
      y = row(c, y, "Balance due (Line 38)", money(data.mdFiling.balanceDue), { bold: true, accent: true });
    }
  }

  drawFooter(c, profile.firmName, "Prepared for reference — not a substitute for the filed return.");
  return doc.save();
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
