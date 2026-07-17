/**
 * Paycheck stub + check PDF — drawn from scratch (pdf-lib primitives), not a
 * filled template, since there's no official form for this the way there is
 * for W-2/1099-NEC. Layout follows the same 3-part structure the client's
 * existing payroll provider uses (employee stub / employer stub / check),
 * confirmed against a real sample, but redrawn cleanly rather than replicated
 * pixel-for-pixel.
 *
 * The MICR line at the bottom of the check uses a real embedded E-13B font
 * (src/assets/fonts/micr-encoding.ttf, "MICR Encoding" by Digital Graphic
 * Labs — see MICR-ENCODING-LICENSE.txt alongside it), not a plain-text
 * approximation. Field layout/positioning and the font's own A/B/C/D ->
 * Transit/Amount/On-Us/Dash symbol mapping were verified against Morovia's
 * published MICR/E-13B fontware reference manual and this font's actual
 * cmap + rendered glyph shapes (not guessed) — see buildMicrLine() below.
 *
 * What this DOES guarantee: correct E-13B glyph shapes, correct symbol
 * placement (transit brackets the routing number, on-us terminates the
 * account number), and print position within the ANSI clear-band spec
 * (3/16"-7/16" from the check's bottom edge). What it CANNOT guarantee from
 * a PDF alone: the check is only truly "MICR" (magnetically readable) if
 * it's actually printed with magnetic ink/toner on qualifying check stock —
 * that's a printer/paper concern, not something any PDF can control. Most
 * modern deposit paths (mobile deposit, ATM, image-based Check 21
 * processing) read the check optically and don't require magnetic ink, but
 * some high-volume bank sorting equipment still does. Have your bank or a
 * check-printing service verify one physical sample before relying on this
 * for real payroll disbursement.
 *
 * Per-client Check Settings (X/Y offsets, accounting.routes.ts
 * /check-settings) ARE read and applied to every drawn field here
 * (date/payee/amount/memo/signature/MICR line) via CheckOffsets — that's
 * the calibration values legacy's "MICR Calibration" tool edited, just
 * without that tool's visual editor (legacy's "Check Designer" preview UI is
 * still not ported — flagged, not silently skipped).
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "fs";
import path from "path";
import { amountToWords } from "../../common/numberToWords";

const PAGE_W = 612; // 8.5in
const PAGE_H = 792; // 11in
const INK = rgb(0.09, 0.09, 0.09);
const MUTED = rgb(0.4, 0.4, 0.4);
const LINE = rgb(0.75, 0.75, 0.75);

const MICR_FONT_PATH = path.join(__dirname, "..", "..", "assets", "fonts", "micr-encoding.ttf");
let micrFontBytesCache: Buffer | null = null;
function loadMicrFontBytes(): Buffer {
  if (!micrFontBytesCache) micrFontBytesCache = fs.readFileSync(MICR_FONT_PATH);
  return micrFontBytesCache;
}

/**
 * Builds the MICR line content using this font's A/B/C/D -> symbol mapping
 * (A=Transit, B=Amount, C=On-Us, D=Dash — see module doc comment). Exactly
 * 3 space-separated fields, left to right: check number, then the
 * Transit-bracketed routing number, then the account number terminated by
 * the On-Us symbol.
 *
 * Field order has been revisited twice (2026-07-12) — worth recording why
 * this is the final answer. A generic "check → routing → account is wrong,
 * it should be routing → account → check" correction was applied based on
 * web-searched banking reference articles, but that was itself wrong for
 * this printer: the user supplied an actual blank check-stock sample image
 * (a standard 3-per-page business check template, the kind ordered from a
 * check printer) showing check-number-first order on every check —
 * "⑈001001⑈ ⑆000006789⑆ 1234567⑈", "⑈001002⑈ ⑆000006789⑆ 1234567⑈", etc.
 * A real printed sample of the exact stock being used outranks a generic
 * web article every time; don't re-"fix" this again without one. The Amount
 * field is deliberately left blank — it's encoded by the first bank that
 * processes the check, not printed by the issuer. Only digits/space survive
 * into the output since the font has no other glyphs (no letters, no other
 * punctuation) — anything else would fail to render.
 */
function buildMicrLine(routingNumber: string | null, accountNumber: string | null, checkNumber: string | null): string {
  const routing = (routingNumber || "").replace(/\D/g, "").padStart(9, "0").slice(-9);
  const account = (accountNumber || "").replace(/\D/g, "");
  const checkNo = (checkNumber || "").replace(/\D/g, "");
  return `C${checkNo}C A${routing}A ${account}C`;
}

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
function maskSsn(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length !== 9) return "XXX-XX-XXXX";
  return `XXX-XX-${digits.slice(5)}`;
}
/** Client addresses are free-form (some already newline-separated, some "Street, City ST Zip" on one line) — normalize to exactly 2 display lines for the check header. */
function splitAddressTwoLines(raw: string): [string, string] {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) return [lines[0], lines.slice(1).join(", ")];
  const commaIndex = raw.indexOf(",");
  if (commaIndex === -1) return [raw.trim(), ""];
  return [raw.slice(0, commaIndex).trim(), raw.slice(commaIndex + 1).trim()];
}

/**
 * Per-client print-position offsets from the Check Settings CRUD
 * (accounting.routes.ts /check-settings, v3_check_settings) — every field
 * defaults to 0 (draw exactly where drawCheck already does today) so a
 * client with no saved settings prints identically to before this existed.
 * Positive X shifts right, positive Y shifts down.
 */
export interface CheckOffsets {
  dateX?: number; dateY?: number;
  payeeX?: number; payeeY?: number;
  amountX?: number; amountY?: number;
  memoX?: number; memoY?: number;
  signatureX?: number; signatureY?: number;
  micrXOffset?: number; micrYOffset?: number;
}

export interface PaycheckPdfData {
  clientName: string;
  clientAddress: string | null;
  clientPhone: string | null;
  employerEin: string | null;
  employeeName: string;
  employeeSsn: string | null;
  employeeAddress: string | null;
  checkNumber: string | null;
  payDate: string | null;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  payType: string | null;
  rate: number; hours: number;
  grossCurrent: number; grossYtd: number;
  federalCurrent: number; federalYtd: number;
  ssCurrent: number; ssYtd: number;
  medicareCurrent: number; medicareYtd: number;
  stateCurrent: number; stateYtd: number;
  netCurrent: number; netYtd: number;
  bankName: string | null;
  bankLast4: string | null;
  routingNumber: string | null;
  accountNumber: string | null;
  memo?: string | null;
  checkOffsets?: CheckOffsets;
  /**
   * When true, drawCheck overlays a 1-inch reference grid and a labeled
   * crosshair at every field position (computed with the exact same
   * base-position + offset formulas the real check uses — not a separate
   * re-derivation, so this can never drift out of sync with what actually
   * prints). Powers the MICR Calibration sheet: print this on the real
   * blank check stock, compare crosshairs to the stock's own pre-printed
   * lines, and adjust Check Settings X/Y offsets by the measured
   * difference. Reusing generatePaycheckPdf for this (rather than a
   * separate calibration-only drawing routine) is deliberate — it's the
   * only way to guarantee the calibration sheet matches reality.
   */
  calibrationMode?: boolean;
}

class Cursor {
  constructor(private page: PDFPage, private font: PDFFont, private bold: PDFFont, private top: number) {}

  text(x: number, yFromTop: number, str: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" } = {}) {
    const size = opts.size ?? 8;
    const font = opts.bold ? this.bold : this.font;
    const width = opts.align === "right" ? font.widthOfTextAtSize(str, size) : 0;
    this.page.drawText(str, { x: x - width, y: this.top - yFromTop, size, font, color: opts.color ?? INK });
  }

  line(x1: number, y1: number, x2: number, y2: number, color = LINE, thickness = 0.5) {
    this.page.drawLine({ start: { x: x1, y: this.top - y1 }, end: { x: x2, y: this.top - y2 }, thickness, color });
  }

  rect(x: number, y: number, w: number, h: number, color = INK, thickness = 0.75) {
    this.page.drawRectangle({ x, y: this.top - y - h, width: w, height: h, borderColor: color, borderWidth: thickness });
  }

  /** Calibration-mode marker: a small red "+" at an already-computed field position, plus its label above. */
  crosshair(x: number, yFromTop: number, label: string) {
    const red = rgb(0.85, 0.1, 0.1);
    this.line(x - 5, yFromTop, x + 5, yFromTop, red, 1);
    this.line(x, yFromTop - 5, x, yFromTop + 5, red, 1);
    this.text(x + 6, yFromTop - 4, label, { size: 6, color: red, bold: true });
  }
}

/**
 * 1-inch reference grid for the MICR Calibration sheet — drawn under a
 * check-height section so the printed sheet can be compared directly
 * against pre-printed check stock. Labels each line in inches from the
 * section's top-left corner (this app's coordinate origin), not from the
 * physical page edge, since that's what an X/Y offset in Check Settings
 * actually measures against.
 */
function drawCalibrationGrid(c: Cursor, top: number, height: number) {
  const grid = rgb(0.75, 0.85, 0.95);
  const IN = 72; // 1 inch = 72pt
  for (let x = 0; x <= PAGE_W; x += IN) {
    c.line(x, top, x, top + height, grid, 0.5);
    c.text(x + 2, top + 9, `${Math.round(x / IN)}"`, { size: 6, color: grid });
  }
  for (let y = 0; y <= height; y += IN) {
    c.line(0, top + y, PAGE_W, top + y, grid, 0.5);
    c.text(2, top + y + 9, `${Math.round(y / IN)}"`, { size: 6, color: grid });
  }
}

/** Draws one earnings stub (used for both the employee and employer copies — identical content). */
function drawStub(c: Cursor, top: number, height: number, data: PaycheckPdfData) {
  const L = 36, R = PAGE_W - 36;

  // Left block: company identity. Right block: check/pay metadata. Both
  // advance independent cursors, then the table starts below whichever is
  // taller — this was previously mis-coordinated (a shared cursor collided
  // with the right block's own cursor), causing overlapping text.
  let y = top + 16;
  c.text(L, y, data.clientName, { size: 10, bold: true });
  y += 13;
  if (data.clientAddress) { c.text(L, y, data.clientAddress, { size: 8, color: MUTED }); y += 11; }
  if (data.clientPhone) { c.text(L, y, `Phone: ${data.clientPhone}`, { size: 8, color: MUTED }); y += 11; }

  let ry = top + 16;
  const rightLines = [
    `Check Number: ${data.checkNumber || ""}`,
    `Check Date: ${fmtDate(data.payDate)}`,
    `Pay Class: ${data.payType || "Salary"}`,
    `Pay Period: ${fmtDate(data.payPeriodStart)} - ${fmtDate(data.payPeriodEnd)}`,
    `Employer EIN: ${data.employerEin || ""}`,
  ];
  for (const line of rightLines) {
    c.text(R, ry, line, { size: 8, align: "right" });
    ry += 12;
  }

  y = Math.max(y, ry) + 4;
  c.text(L, y, `Name: ${data.employeeName}`, { size: 9, bold: true });
  c.text(300, y, `SSN: ${maskSsn(data.employeeSsn)}`, { size: 8 });
  y += 18;

  // Earnings table header
  const cols = { label: L, rate: 220, hours: 270, current: 340, ytd: 420 };
  c.line(L, y, R, y);
  y += 13;
  c.text(cols.label, y, "Earnings", { size: 8, bold: true });
  c.text(cols.rate, y, "Rate", { size: 8, bold: true });
  c.text(cols.hours, y, "Hours", { size: 8, bold: true });
  c.text(cols.current, y, "Current", { size: 8, bold: true, align: "right" });
  c.text(cols.ytd, y, "YTD", { size: 8, bold: true, align: "right" });
  y += 6;
  c.line(L, y, R, y);
  y += 12;

  c.text(cols.label, y, data.payType || "Salary", { size: 8 });
  if (data.rate) c.text(cols.rate, y, `$${money(data.rate)}`, { size: 8 });
  if (data.hours) c.text(cols.hours, y, String(data.hours), { size: 8 });
  c.text(cols.current, y, `$${money(data.grossCurrent)}`, { size: 8, align: "right" });
  c.text(cols.ytd, y, `$${money(data.grossYtd)}`, { size: 8, align: "right" });
  y += 14;

  c.line(L, y, R, y);
  y += 13;
  c.text(L, y, "Gross Pay:", { size: 8, bold: true });
  c.text(cols.current, y, `$${money(data.grossCurrent)}`, { size: 8, bold: true, align: "right" });
  c.text(cols.ytd, y, `$${money(data.grossYtd)}`, { size: 8, bold: true, align: "right" });
  y += 16;

  c.text(L, y, "Withholdings", { size: 8, bold: true });
  c.text(cols.current, y, "Current", { size: 8, bold: true, align: "right" });
  c.text(cols.ytd, y, "YTD", { size: 8, bold: true, align: "right" });
  y += 12;
  const withholdings: [string, number, number][] = [
    ["Federal", data.federalCurrent, data.federalYtd],
    ["Social Security", data.ssCurrent, data.ssYtd],
    ["Medicare", data.medicareCurrent, data.medicareYtd],
    ["State", data.stateCurrent, data.stateYtd],
  ];
  for (const [label, cur, ytd] of withholdings) {
    c.text(L, y, label, { size: 8, color: MUTED });
    c.text(cols.current, y, `$${money(cur)}`, { size: 8, align: "right" });
    c.text(cols.ytd, y, `$${money(ytd)}`, { size: 8, align: "right" });
    y += 11;
  }

  y += 6;
  c.line(L, y, R, y);
  y += 14;
  c.text(L, y, "Net Pay:", { size: 10, bold: true });
  c.text(cols.current, y, `$${money(data.netCurrent)}`, { size: 10, bold: true, align: "right" });
  c.text(cols.ytd, y, `$${money(data.netYtd)}`, { size: 10, bold: true, align: "right" });

  // Section separator
  c.line(0, top + height, PAGE_W, top + height, INK, 1);
}

/**
 * Drawn to match the layout of standard pre-printed business check stock
 * (the kind ordered from a check printer): company info top-left / bank
 * info top-right, boxed dollar amount with a leading "$", an underlined
 * "PAY TO THE ORDER OF" payee line, an underlined amount-in-words line,
 * and an underlined MEMO field. No border box is drawn — real check stock
 * (per the blank sample the user printed and shared 2026-07-13) already
 * has its own pre-printed security background/border, so a second box
 * drawn on top of it would double up and misalign with the real one.
 */
function drawCheck(c: Cursor, top: number, height: number, data: PaycheckPdfData, page: PDFPage, micrFont: PDFFont) {
  const L = 36, R = PAGE_W - 36;
  const o = data.checkOffsets || {};
  if (data.calibrationMode) drawCalibrationGrid(c, top, height);

  // Extra headroom before the first line — real check stock has its own
  // pre-printed security band ("THE FACE OF THIS CHECK IS PRINTED
  // GREEN...") a short way into the check section; measured directly off
  // a physical print the user supplied 2026-07-13, it sits ~1-10pt into
  // this section, so starting content at +36 (not +20) keeps the company
  // name/address/check number clear of it with real margin (~14pt,
  // verified against the measured band position), not just whatever
  // margin fell out of the section-height math incidentally. The two
  // gaps right below it are tightened (22->14, 24->20) to claw back most
  // of that added push before the flow reaches the memo/signature row,
  // which otherwise collides with the independently bottom-anchored
  // "Void after 90 days"/MICR row.
  let y = top + 36;

  c.text(L, y, data.clientName, { size: 11, bold: true });
  c.text(R, y, data.checkNumber || "", { size: 12, bold: true, align: "right" });
  y += 13;
  if (data.clientAddress) {
    const [addrLine1, addrLine2] = splitAddressTwoLines(data.clientAddress);
    c.text(L, y, addrLine1, { size: 9, color: MUTED });
    if (addrLine2) { y += 10; c.text(L, y, addrLine2, { size: 9, color: MUTED }); }
  }
  y += 14;

  c.text(R - 90 + (o.dateX || 0), y + (o.dateY || 0), "Date:", { size: 9 });
  c.line(R - 65 + (o.dateX || 0), y + 2 + (o.dateY || 0), R + (o.dateX || 0), y + 2 + (o.dateY || 0));
  c.text(R + (o.dateX || 0), y + (o.dateY || 0), fmtDate(data.payDate), { size: 9, align: "right" });
  if (data.calibrationMode) c.crosshair(R + (o.dateX || 0), y + (o.dateY || 0), "DATE");
  y += 20;

  c.text(L + (o.payeeX || 0), y + (o.payeeY || 0), "PAY TO THE ORDER OF", { size: 7, color: MUTED });
  c.line(L + 100 + (o.payeeX || 0), y + 2 + (o.payeeY || 0), R - 100 + (o.payeeX || 0), y + 2 + (o.payeeY || 0));
  c.text(L + 108 + (o.payeeX || 0), y + (o.payeeY || 0), data.employeeName, { size: 10 });
  if (data.calibrationMode) c.crosshair(L + 108 + (o.payeeX || 0), y + (o.payeeY || 0), "PAYEE");
  c.text(R - 96 + (o.amountX || 0), y + (o.amountY || 0), "$", { size: 11, bold: true });
  c.rect(R - 90 + (o.amountX || 0), y - 12 + (o.amountY || 0), 90, 16, INK, 1);
  c.text(R - 6 + (o.amountX || 0), y + (o.amountY || 0), money(data.netCurrent), { size: 10, bold: true, align: "right" });
  if (data.calibrationMode) c.crosshair(R - 90 + (o.amountX || 0), y + (o.amountY || 0), "AMOUNT");
  y += 28;

  c.text(L + (o.amountX || 0), y + (o.amountY || 0), amountToWords(data.netCurrent), { size: 10 });
  c.line(L + 4 + (o.amountX || 0), y + 3 + (o.amountY || 0), R - 4 + (o.amountX || 0), y + 3 + (o.amountY || 0));
  y += 24;

  if (data.bankName) { c.text(L, y, data.bankName, { size: 8, color: MUTED }); y += 14; }

  // MEMO (left) and Authorized Signature (right) sit on the same row and
  // are the pair most directly compared side by side, so both underlines
  // are the same 180pt length — previously memo was 174pt vs signature's
  // 180pt, which read as visibly mismatched per user feedback 2026-07-13.
  const LINE_LEN = 180;
  const signatureY = y + 22 + (o.signatureY || 0);
  c.text(L + (o.memoX || 0), y + 20 + (o.memoY || 0), "MEMO", { size: 7, color: MUTED });
  c.line(L + 36 + (o.memoX || 0), y + 22 + (o.memoY || 0), L + 36 + LINE_LEN + (o.memoX || 0), y + 22 + (o.memoY || 0));
  c.text(L + 40 + (o.memoX || 0), y + 20 + (o.memoY || 0), data.memo || "", { size: 8, color: MUTED });
  if (data.calibrationMode) c.crosshair(L + (o.memoX || 0), y + 20 + (o.memoY || 0), "MEMO");

  c.line(R - LINE_LEN + (o.signatureX || 0), signatureY, R + (o.signatureX || 0), signatureY);
  c.text(R + (o.signatureX || 0), signatureY + 10, "Authorized Signature", { size: 7, color: MUTED, align: "right" });
  if (data.calibrationMode) c.crosshair(R - LINE_LEN + (o.signatureX || 0), signatureY, "SIGNATURE");

  y = top + height - 54;
  c.text(L, y, "Void after 90 days", { size: 7, color: MUTED });

  // Real E-13B MICR line, centered horizontally inside the check border box,
  // sitting on the same baseline as "Void after 90 days" (just above the
  // box's bottom edge) rather than below it in the footer clear-band — see
  // module doc comment for the font and field-layout spec this follows.
  const micrLine = buildMicrLine(data.routingNumber, data.accountNumber, data.checkNumber);
  const micrSize = 12;
  const micrWidth = micrFont.widthOfTextAtSize(micrLine, micrSize);
  const micrX = (PAGE_W - micrWidth) / 2 + (o.micrXOffset || 0);
  const micrYFromTop = top + height - 54 + (o.micrYOffset || 0);
  page.drawText(micrLine, { x: micrX, y: PAGE_H - micrYFromTop, size: micrSize, font: micrFont, color: INK });
  if (data.calibrationMode) c.crosshair(micrX, micrYFromTop, "MICR");
}

export async function generatePaycheckPdf(data: PaycheckPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const micrFont = await doc.embedFont(loadMicrFontBytes(), { subset: true });
  const c = new Cursor(page, font, bold, PAGE_H);

  // Section heights measured directly off the client's blank check stock
  // (2026-07-13 reference: top stub 10cm, middle stub 9cm, check 9cm — the
  // check gets whatever's left of the 11" page rather than a hardcoded 9cm
  // so rounding error lands in the check's own margin, not a gap/overlap
  // against the pre-printed stock below it).
  const CM = 28.3465;
  const stub1Height = 10 * CM;
  const stub2Height = 9 * CM;
  drawStub(c, 0, stub1Height, data);
  drawStub(c, stub1Height, stub2Height, data);
  drawCheck(c, stub1Height + stub2Height, PAGE_H - stub1Height - stub2Height, data, page, micrFont);

  if (data.calibrationMode) {
    page.drawRectangle({ x: 0, y: PAGE_H - 20, width: PAGE_W, height: 20, color: rgb(0.85, 0.1, 0.1) });
    page.drawText(
      "MICR CALIBRATION SHEET — print on real check stock, compare red crosshairs to the stock's pre-printed lines, adjust Check Settings X/Y offsets by the difference.",
      { x: 10, y: PAGE_H - 14, size: 8, font: bold, color: rgb(1, 1, 1) }
    );
  }

  return doc.save();
}
