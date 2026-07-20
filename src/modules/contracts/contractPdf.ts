/**
 * Contract / engagement-letter PDF — hand-drawn from scratch (pdf-lib primitives),
 * same self-contained approach as invoicePdf.ts/reportsPdf.ts/paycheckPdf.ts (each
 * of those defines its own local Cursor/newPage/wrapText rather than sharing one,
 * which this file follows for consistency). Renders the firm's letterhead, the
 * contract's rendered_body (already fully merged — see contracts.routes.ts), and a
 * signature block that adapts to Draft/Sent (blank signature lines, works for a
 * printed wet-signature copy) vs. Signed (the captured typed signature + audit
 * trail: timestamp and IP address, standard proof for a click-to-sign agreement).
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
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

function fmtDate(v: unknown): string {
  if (!v) return "";
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}
function fmtDateTime(v: unknown): string {
  if (!v) return "";
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return "";
  return `${fmtDate(d)} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}`;
}

export interface ContractPdfData {
  contractId: string;
  title: string;
  clientName: string;
  clientId: string;
  renderedBody: string;
  effectiveDate: string | null;
  status: string;
  signerName: string | null;
  signerTitle: string | null;
  signedAt: string | null;
  signerIp: string | null;
  signatureMethod: string;
  recordedBy: string | null;
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

function newPage(doc: PDFDocument, font: PDFFont, bold: PDFFont): { page: PDFPage; c: Cursor } {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const c = new Cursor(page, font, bold, PAGE_H);
  c.rect(0, 0, PAGE_W, 6, TEAL);
  return { page, c };
}

function drawFooter(c: Cursor, firmName: string, contractId: string, pageLabel: string) {
  c.text(48, PAGE_H - 28, `${firmName} — Contract ${contractId}`, { size: 8, color: MUTED });
  c.text(PAGE_W - 48, PAGE_H - 28, pageLabel, { size: 8, color: MUTED, align: "right" });
}

export async function generateContractPdf(data: ContractPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const profile: FirmProfile = await getFirmProfile();
  const logo = await embedFirmLogo(doc, profile);

  let { page, c } = newPage(doc, font, bold);
  const L = 48, R = PAGE_W - 48;
  let y = 48;
  let textL = L;
  if (logo) {
    const logoH = 30;
    const logoW = (logo.width / logo.height) * logoH;
    page.drawImage(logo, { x: L, y: PAGE_H - y - logoH + 6, width: logoW, height: logoH });
    textL = L + logoW + 10;
  }
  c.text(textL, y, profile.firmName.toUpperCase(), { size: 16, bold: true, color: TEAL });
  c.text(R, y, "SERVICE AGREEMENT", { size: 14, bold: true, align: "right" });
  y += 16;
  for (const line of [profile.addressLine1, profile.addressLine2].filter((l) => l && l.trim())) {
    c.text(textL, y, line, { size: 9, color: MUTED });
    y += 11;
  }
  y += 4;
  c.line(L, y, R, y, INK, 1.25);
  y += 22;

  // Contract identity box
  c.rect(L, y, R - L, 58, TEAL_TINT);
  c.text(L + 12, y + 18, data.title, { size: 13, bold: true });
  c.text(L + 12, y + 36, `Client: ${data.clientName}  (${data.clientId})`, { size: 9.5, color: MUTED });
  c.text(L + 12, y + 50, `Contract ID: ${data.contractId}`, { size: 8, color: MUTED });
  c.text(R - 12, y + 36, data.effectiveDate ? `Effective: ${fmtDate(data.effectiveDate)}` : "", { size: 9.5, color: MUTED, align: "right" });
  c.text(R - 12, y + 50, `Status: ${data.status}`, { size: 8, bold: true, color: TEAL, align: "right" });
  y += 76;

  drawFooter(c, profile.firmName, data.contractId, "Page 1");
  let pageNum = 1;
  const maxWidth = R - L;

  // Standard PDF fonts (Helvetica) can only encode WinAnsi characters — drawing
  // Arabic text with one throws ("WinAnsi cannot encode..."), confirmed directly
  // against pdf-lib before writing this. Rather than embedding a font (which
  // still wouldn't get real RTL/contextual letter shaping without more work — see
  // the same tradeoff already documented in reportsPdf.ts's Client Message PDF),
  // Arabic paragraphs are skipped here with a one-line English note; the full
  // Arabic text is untouched everywhere else (the public sign page, admin
  // preview) since those render plain Unicode HTML, not a drawn PDF glyph.
  let arabicNoteShown = false;
  const paragraphs = data.renderedBody.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  for (const para of paragraphs) {
    if (ARABIC_RE.test(para)) {
      if (!arabicNoteShown) {
        if (y > PAGE_H - 60) {
          pageNum += 1;
          ({ page, c } = newPage(doc, font, bold));
          y = 56;
          drawFooter(c, profile.firmName, data.contractId, `Page ${pageNum}`);
        }
        c.text(L, y, "[This agreement includes an Arabic-language translation — view it online or ask staff for a copy.]", { size: 8.5, color: MUTED });
        y += 18;
        arabicNoteShown = true;
      }
      continue;
    }
    const rawLines = para.split("\n");
    for (const rawLine of rawLines) {
      for (const wrapped of wrapText(rawLine, font, 9.5, maxWidth)) {
        if (y > PAGE_H - 60) {
          pageNum += 1;
          ({ page, c } = newPage(doc, font, bold));
          y = 56;
          drawFooter(c, profile.firmName, data.contractId, `Page ${pageNum}`);
        }
        c.text(L, y, wrapped, { size: 9.5 });
        y += 13;
      }
    }
    y += 9; // paragraph gap
  }

  // Signature block
  if (y > PAGE_H - 140) {
    pageNum += 1;
    ({ page, c } = newPage(doc, font, bold));
    y = 56;
    drawFooter(c, profile.firmName, data.contractId, `Page ${pageNum}`);
  }
  y += 10;
  c.line(L, y, R, y, INK, 1);
  y += 20;

  if (data.status === "Signed" && data.signerName) {
    const isInPerson = data.signatureMethod === "In-Person";
    c.text(L, y, isInPerson ? "SIGNED IN PERSON" : "ELECTRONICALLY SIGNED", { size: 10, bold: true, color: TEAL });
    y += 18;
    c.text(L, y, `Signed by: ${data.signerName}${data.signerTitle ? ` (${data.signerTitle})` : ""}`, { size: 10 });
    y += 15;
    c.text(L, y, `Date/Time: ${fmtDateTime(data.signedAt)}`, { size: 9, color: MUTED });
    y += 13;
    if (isInPerson) {
      // A wet-ink/paper signature witnessed in the office has no client IP/device
      // trail, and Section 9's electronic-signature consent language doesn't apply
      // to it — mislabeling this as "electronically signed" would misstate how the
      // agreement was actually executed.
      if (data.recordedBy) {
        c.text(L, y, `Recorded by: ${data.recordedBy}`, { size: 8, color: MUTED });
        y += 13;
      }
      c.text(L, y, "This signature was collected in person on a physical copy of this agreement, not electronically.", { size: 7.5, color: MUTED });
    } else {
      if (data.signerIp) {
        c.text(L, y, `IP Address on file: ${data.signerIp}`, { size: 8, color: MUTED });
        y += 13;
      }
      c.text(L, y, "This document was signed electronically. Client consented to conduct this transaction electronically per Section 9 (General Terms).", { size: 7.5, color: MUTED });
    }
  } else {
    c.text(L, y, "Client Signature: __________________________________", { size: 10 });
    c.text(R, y, "Date: ______________", { size: 10, align: "right" });
    y += 24;
    c.text(L, y, "Print Name: _________________________________________", { size: 10 });
  }

  return doc.save();
}
