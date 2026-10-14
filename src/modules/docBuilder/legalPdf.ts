/**
 * Draws a Document Builder text as a clean legal document (English / Latin script): one-inch margins, centered title, bold clause
 * headings, and an uncrowded signing section — real signature lines with the label underneath, a boxed notary acknowledgment with a
 * seal area. Arabic lines cannot be drawn by the server's PDF writer, so Arabic paragraphs are skipped with a one-line note (the Word
 * file and the printable page carry Arabic).
 */
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import { pdfSafeText } from "../../common/pdfText";
import { parseBlocks, type FormItem } from "./layout";

const W = 612, H = 792, ML = 72, MR = 72, TOP = 72, BOTTOM = 80;
const TW = W - ML - MR;
const INK = rgb(0.09, 0.09, 0.09), GRAY = rgb(0.4, 0.4, 0.4), RULE = rgb(0.2, 0.2, 0.2), BOXLINE = rgb(0.55, 0.55, 0.55), BOXFILL = rgb(0.975, 0.975, 0.975);

export interface LegalDrawResult { page: PDFPage; y: number; pageNum: number; newPage: () => PDFPage }

export function drawLegalBody(doc: PDFDocument, font: PDFFont, bold: PDFFont, body: string, onNewPage?: (page: PDFPage, n: number) => void): LegalDrawResult {
  let page = doc.addPage([W, H]); let y = TOP; let pageNum = 1;
  onNewPage?.(page, 1);
  const newPage = () => { page = doc.addPage([W, H]); y = TOP; pageNum += 1; onNewPage?.(page, pageNum); return page; };
  const ensure = (h: number) => { if (y + h > H - BOTTOM) newPage(); };
  const wrap = (text: string, f: PDFFont, size: number, width: number): string[] => {
    const words = pdfSafeText(text).split(" "); const out: string[] = []; let cur = "";
    for (const w of words) { const cand = cur ? `${cur} ${w}` : w; if (f.widthOfTextAtSize(cand, size) > width && cur) { out.push(cur); cur = w; } else cur = cand; }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  };
  const BLANK_W = 92;
  type Tok = { w: string; blank: boolean };
  const tokenWidth = (t: Tok, f: PDFFont, size: number) => (t.blank ? BLANK_W : f.widthOfTextAtSize(t.w, size));
  /** Like wrap(), but an underscore run becomes a drawn blank line of fixed width. */
  const wrapRich = (raw: string, f: PDFFont, size: number, width: number): Tok[][] => {
    const toks: Tok[] = pdfSafeText(raw).split(/\s+/).filter(Boolean).map((w) => ({ w, blank: /^_{4,}[,.;:)]*$/.test(w) }));
    const space = f.widthOfTextAtSize(" ", size) * (f === bold ? 1.3 : 1); const out: Tok[][] = []; let cur: Tok[] = []; let cw = 0;
    for (const t of toks) { const tw = tokenWidth(t, f, size); if (cur.length && cw + space + tw > width) { out.push(cur); cur = []; cw = 0; } cw += (cur.length ? space : 0) + tw; cur.push(t); }
    if (cur.length) out.push(cur);
    return out.length ? out : [[]];
  };
  const text = (t: string, x: number, yy: number, f: PDFFont, size: number, color = INK) => page.drawText(pdfSafeText(t), { x, y: H - yy, size, font: f, color });
  const line = (x1: number, yy: number, x2: number, th = 0.8, color = RULE, dash?: number[]) => page.drawLine({ start: { x: x1, y: H - yy }, end: { x: x2, y: H - yy }, thickness: th, color, ...(dash ? { dashArray: dash } : {}) });
  const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
  let arabicNote = false;
  const skipArabic = () => { if (arabicNote) return; arabicNote = true; ensure(24); text("[The Arabic edition is in the Word file and the printable version.]", ML, y + 10, font, 8.5, GRAY); y += 22; };

  /** Draws (or, when dry, only measures) one signing form. Returns its height. */
  const drawForm = (items: FormItem[], x: number, width: number, dry: boolean, startY: number): number => {
    let yy = startY;
    for (const it of items) {
      if (it.k === "text") {
        const f = it.bold ? bold : font;
        for (const ln of wrapRich(it.text, f, 10.5, width)) {
          if (!dry) {
            let cx = x; const sp = f.widthOfTextAtSize(" ", 10.5) * (it.bold ? 1.3 : 1);
            for (const t of ln) {
              if (t.blank) { line(cx, yy + 11, cx + BLANK_W, 0.7); const trail = t.w.replace(/^_+/, ""); if (trail) text(trail, cx + BLANK_W, yy + 10, f, 10.5); cx += BLANK_W + (trail ? f.widthOfTextAtSize(trail, 10.5) : 0) + sp; }
              else { text(t.w, cx, yy + 10, f, 10.5); cx += f.widthOfTextAtSize(t.w, 10.5) + sp; }
            }
          }
          yy += 15;
        }
        yy += 1;
      } else {
        if (it.caption) { if (!dry) text(it.caption, x, yy + 10, font, 10.5); yy += 15; }
        yy += 24; // room to sign
        const n = it.fields.length; const gap = 18;
        const weights = it.fields.map((f) => (/signature|seal|التوقيع|ختم/i.test(f.label) ? 2.3 : /date|التاريخ/i.test(f.label) ? 1 : 1.5));
        const sum = weights.reduce((a, b) => a + b, 0); const avail = width - gap * (n - 1);
        let cx = x;
        it.fields.forEach((f, i) => {
          const fw = (avail * weights[i]) / sum;
          if (!dry) { line(cx, yy, cx + fw); const lab = `${f.label}${i === n - 1 && it.note ? ` ${it.note}` : ""}`.trim(); if (lab) text(lab, cx, yy + 10.5, font, 8.5, GRAY); }
          cx += fw + gap;
        });
        yy += 17;
      }
    }
    return yy - startY;
  };

  const blocks = parseBlocks(body);
  let formsSeen = 0, titled = false, lastTitle = "";
  const formHeight = (b: (typeof blocks)[number] | undefined) => (b && b.t === "form" ? drawForm(b.items, ML, TW, true, 0) + 40 : 0);
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (b.t === "break") { newPage(); continue; }
    if ("rtl" in b && b.rtl) { skipArabic(); continue; }
    if (b.t === "title") {
      lastTitle = b.text; ensure(60); for (const ln of wrap(b.text, bold, 15.5, TW)) { text(ln, ML + (TW - bold.widthOfTextAtSize(pdfSafeText(ln), 15.5)) / 2, y + 15, bold, 15.5); y += 21; }
      if (blocks[bi + 1] && blocks[bi + 1].t === "subtitle") { y += 6; titled = true; continue; } y += 4; line(ML + TW * 0.35, y, ML + TW * 0.65, 0.6, GRAY); y += 18; titled = true; continue;
    }
    if (b.t === "subheading") {
      // keep the heading with the paragraph under it and the start of the form after that
      const n1 = blocks[bi + 1], n2 = blocks[bi + 2];
      const paraH = n1 && n1.t === "para" ? wrap(n1.text, font, 11, TW).length * 15 + 5 : 0;
      ensure(36 + paraH + Math.min(formHeight(n1 && n1.t === "form" ? n1 : n2), 80)); y += 10; text(pdfSafeText(b.text), ML, y + 11, bold, 10.5); y += 19; continue; }
    if (b.t === "subtitle") { y -= 8; for (const ln of wrap(b.text, font, 11.5, TW)) { text(ln, ML + (TW - font.widthOfTextAtSize(pdfSafeText(ln), 11.5)) / 2, y + 12, font, 11.5, GRAY); y += 16; } y += 6; line(ML + TW * 0.35, y, ML + TW * 0.65, 0.6, GRAY); y += 18; continue; }
    if (b.t === "heading") {
      // keep the heading together with the first lines of the paragraph under it
      const nx = blocks[bi + 1]; const nl = nx && (nx.t === "para" || nx.t === "bullet") ? wrap(nx.text, font, 11, TW).length : 0;
      ensure(9 + 19 + Math.min(Math.max(nl, 1), 3) * 15 + 6); y += 9; text(pdfSafeText(b.text), ML, y + 11, bold, 11); y += 19; continue; }
    if (b.t === "bullet") { const ls = wrap(b.text, font, 11, TW - 24); ensure(ls.length * 15 + 4); page.drawCircle({ x: ML + 11, y: H - (y + 7.2), size: 1.7, color: INK }); for (const ln of ls) { text(ln, ML + 24, y + 11, font, 11); y += 15; } y += 3; continue; }
    if (b.t === "para") { const ls = wrap(b.text, font, 11, TW); const nx = blocks[bi + 1]; ensure(Math.min(ls.length, 3) * 15 + 4 + (nx && nx.t === "form" ? Math.min(formHeight(nx), 150) + ls.length * 15 : 0)); for (const ln of ls) { ensure(16); text(ln, ML, y + 11, font, 11); y += 15; } y += 5; continue; }
    // signing form / notary acknowledgment
    formsSeen += 1;
    if (formsSeen === 1) {
      // keep the whole signing section (every party's block) together on one page when it fits
      let group = 0;
      for (let j = bi; j < blocks.length && blocks[j].t === "form" && !(blocks[j] as any).notary; j++) group += drawForm((blocks[j] as any).items, ML, TW, true, 0) + 18;
      ensure(Math.min(group + 50, 560)); y += 16;
      if (!b.notary) { const lab = "SIGNATURES"; text(lab, ML + (TW - bold.widthOfTextAtSize(lab, 10.5)) / 2, y + 10, bold, 10.5); y += 16; line(ML, y, ML + TW, 0.6, GRAY); y += 4; if (lastTitle) { const sp = `Signature page — ${lastTitle}`; const w2 = font.widthOfTextAtSize(pdfSafeText(sp), 8.5); text(sp, ML + (TW - Math.min(w2, TW)) / 2, y + 11, font, 8.5, GRAY); y += 14; } }
    }
    if (b.notary) {
      const pad = 16, sealW = 96;
      const textItems = b.items.filter((i) => i.k !== "row"), rowItems = b.items.filter((i) => i.k === "row");
      const innerW = TW - pad * 2;
      const hText = drawForm(textItems, ML + pad, innerW, true, 0);
      const hRows = drawForm(rowItems, ML + pad, innerW - sealW - 18, true, 0);
      const boxH = pad * 2 + hText + 6 + Math.max(hRows, 100);
      ensure(boxH + 10); y += 10;
      page.drawRectangle({ x: ML, y: H - y - boxH, width: TW, height: boxH, color: BOXFILL, borderColor: BOXLINE, borderWidth: 0.8 });
      let yy = y + pad;
      // title (first text item) in bold, rest as text
      const tItems = textItems.map((it, i) => (i === 0 && it.k === "text" ? { ...it, bold: true } : it)) as FormItem[];
      yy += drawForm(tItems, ML + pad, innerW, false, yy) + 6;
      drawForm(rowItems, ML + pad, innerW - sealW - 18, false, yy);
      const sx = ML + TW - pad - sealW;
      page.drawRectangle({ x: sx, y: H - (yy + 100), width: sealW, height: 100, borderColor: BOXLINE, borderWidth: 0.8, borderDashArray: [3, 3] });
      text("Seal", sx + sealW / 2 - 8, yy + 56, font, 9, BOXLINE);
      y += boxH + 14; continue;
    }
    const h = drawForm(b.items, ML, TW, true, 0);
    ensure(h + 14); y += 12;
    drawForm(b.items, ML, TW, false, y); y += h + 4;
  }
  void titled;
  return { page, y, pageNum, newPage };
}
