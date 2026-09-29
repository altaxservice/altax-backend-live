/**
 * Printable cover sheet for a client's document checklist — direct owner
 * request, 2026-09-29: "create Cover Letter sheet with check list of the
 * documents required for each one of those service, to be Auto generated...
 * on the check list add couple line empty." Meant to be stapled to the
 * front of a physical submission package (Health Permit, SNAP, etc.) so an
 * agency reviewer sees everything enclosed at a glance. Firm letterhead
 * (not client letterhead) since this is a letter FROM the firm, same
 * drawFirmHeader-shape convention as reportsPdf.ts's firm-wide reports —
 * duplicated locally rather than imported, matching this codebase's
 * per-module self-contained PDF drawing primitives (haccpPdf.ts,
 * licenseApplicationsPdf.ts each do the same).
 *
 * Always reflects one specific client's REAL checklist progress (checked
 * items render checked) — not a blank generic form. Pulls whatever the
 * per-client checklist tracker (checklists.routes.ts's syncAndLoadProgress)
 * already computed, so this can never drift from what staff sees on the
 * client's own Documents tab.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { getFirmProfile, type FirmProfile } from "../../common/firmProfile";
import { embedFirmLogo } from "../../common/pdfLogo";
import { pdfSafeText } from "../../common/pdfText";

const PAGE_W = 612;
const PAGE_H = 792;
const INK = rgb(0.09, 0.09, 0.09);
const MUTED = rgb(0.42, 0.42, 0.42);
const LINE = rgb(0.82, 0.82, 0.82);
const TEAL = rgb(0.043, 0.42, 0.42);

function fmtDate(v: unknown): string {
  const d = v ? new Date(v as string) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
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
  widthOf(str: string, opts: { size?: number; bold?: boolean } = {}): number {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const safe = pdfSafeText(str);
    return safe ? font.widthOfTextAtSize(safe, size) : 0;
  }
  line(x1: number, y1: number, x2: number, y2: number, color = LINE, thickness = 0.75) {
    this.page.drawLine({ start: { x: x1, y: this.top - y1 }, end: { x: x2, y: this.top - y2 }, thickness, color });
  }
  rect(x: number, y: number, w: number, h: number, color = TEAL) {
    this.page.drawRectangle({ x, y: this.top - y - h, width: w, height: h, color });
  }
}

function drawFirmLetterhead(page: PDFPage, c: Cursor, profile: FirmProfile, logo: Awaited<ReturnType<typeof embedFirmLogo>>): number {
  const L = 48, R = PAGE_W - 48;
  let y = 48;
  let textL = L;
  if (logo) {
    const logoH = 32;
    const logoW = (logo.width / logo.height) * logoH;
    page.drawImage(logo, { x: L, y: PAGE_H - y - logoH + 8, width: logoW, height: logoH });
    textL = L + logoW + 10;
  }
  c.text(textL, y, profile.firmName.toUpperCase(), { size: 16, bold: true, color: TEAL });
  c.text(R, y, "DOCUMENT CHECKLIST", { size: 14, bold: true, align: "right" });
  y += 16;
  for (const line of [profile.addressLine1, profile.addressLine2].filter((l) => l && l.trim())) {
    c.text(textL, y, line, { size: 9, color: MUTED });
    y += 11;
  }
  const contact = [profile.phone, profile.email].filter(Boolean).join(" · ");
  if (contact) { c.text(textL, y, contact, { size: 9, color: MUTED }); y += 11; }
  y += 6;
  c.line(L, y, R, y, INK, 1.25);
  return y + 24;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
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

function drawFooter(c: Cursor, profile: FirmProfile) {
  const L = 48, R = PAGE_W - 48;
  c.text(L, PAGE_H - 28, `Generated ${fmtDate(new Date())} — ${profile.firmName}`, { size: 8, color: MUTED });
  c.text(R, PAGE_H - 28, "Checklist status reflects this system as of the date above.", { size: 8, color: MUTED, align: "right" });
}

export interface ChecklistCoverLetterItem { documentName: string; checked: boolean }
export interface ChecklistCoverLetterData {
  clientName: string;
  clientAddress?: string | null;
  checklistName: string;
  items: ChecklistCoverLetterItem[];
  /** Overrides the default opening sentence ("The following documents are enclosed in support of this application:") — owner request, 2026-09-29: "Make this cover sheet editable." Falls back to the default when empty. */
  introText?: string | null;
  /**
   * A typed, saved note (owner request, 2026-09-29 — "Add Note, if you can
   * make it smart and better please do") — e.g. "Re-submission — previous
   * application denied for missing Pest Control Contract, now included" or
   * "Please expedite — client's grand opening is 10/15." Printed as its own
   * paragraph between the checklist and the blank lines, so anything worth
   * repeating across reprints is typed once instead of handwritten every time.
   */
  note?: string | null;
  /** Number of blank ruled lines at the end, for anything not on the standard list or not worth a saved note. Owner asked for "a couple" — defaults to 2 now that a typed note covers the main case. */
  blankLines?: number;
}

export async function generateChecklistCoverLetterPdf(data: ChecklistCoverLetterData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafeText(`${data.clientName} - ${data.checklistName} - Document Checklist`));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const c = new Cursor(page, font, bold, PAGE_H);
  c.rect(0, 0, PAGE_W, 6, TEAL);

  const profile = await getFirmProfile();
  const logo = await embedFirmLogo(doc, profile);
  let y = drawFirmLetterhead(page, c, profile, logo);

  const L = 48, R = PAGE_W - 48;
  c.text(R, y - 24, fmtDate(new Date()), { size: 10, color: MUTED, align: "right" });

  c.text(L, y, `RE: ${data.clientName.toUpperCase()} — ${data.checklistName}`, { size: 12, bold: true });
  y += 16;
  if (data.clientAddress) {
    for (const line of data.clientAddress.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean)) {
      c.text(L, y, line, { size: 9, color: MUTED });
      y += 11;
    }
  }
  y += 10;
  const introText = String(data.introText || "").trim() || "The following documents are enclosed in support of this application:";
  for (const line of wrapText(introText, font, 10, R - L)) {
    c.text(L, y, line, { size: 10 });
    y += 14;
  }
  y += 8;

  const boxSize = 10;
  for (const item of data.items) {
    // A checkbox: a bordered square, filled teal with a white "X" when
    // checked, plain white when not — drawn with the raw pdf-lib page
    // object (not the Cursor helper) since Cursor.rect always anchors from
    // the page's own top-left, and a filled+bordered square needs both a
    // fill and a separate stroke-only rectangle at the same spot.
    // Text is drawn at its BASELINE (y), with glyphs extending upward from
    // there — the box needs to extend upward from just below that baseline
    // too, not downward (which was landing it a full row below the text it
    // was meant to sit beside).
    const boxBottom = PAGE_H - y - 1.5;
    page.drawRectangle({ x: L, y: boxBottom, width: boxSize, height: boxSize, color: item.checked ? TEAL : rgb(1, 1, 1) });
    page.drawRectangle({ x: L, y: boxBottom, width: boxSize, height: boxSize, borderColor: INK, borderWidth: 1 });
    if (item.checked) {
      c.text(L + 2, y - 1, "X", { size: 8.5, bold: true, color: rgb(1, 1, 1) });
    }
    c.text(L + boxSize + 8, y - 1, item.documentName, { size: 10.5 });
    y += 20;
  }

  y += 10;
  const note = String(data.note || "").trim();
  if (note) {
    c.text(L, y, "Note:", { size: 9, bold: true, color: TEAL });
    y += 13;
    for (const line of wrapText(note, font, 10, R - L)) {
      c.text(L, y, line, { size: 10 });
      y += 14;
    }
    y += 10;
  }

  const blankLines = data.blankLines ?? 2;
  for (let i = 0; i < blankLines; i++) {
    c.line(L, y, R, y);
    y += 22;
  }

  drawFooter(c, profile);
  return doc.save();
}
