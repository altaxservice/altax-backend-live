/**
 * Word (.docx) edition of a Document Builder document: the same rendered text as the PDF, laid out like a legal document —
 * centered title, numbered clauses in bold, an uncrowded signing section (real signature lines with the label underneath, a boxed
 * notary acknowledgment with a seal area) and "Page X of Y" in the footer. Arabic paragraphs and tables are set right-to-left (Word
 * shapes Arabic itself, which the server's PDF writer cannot), and "English + Arabic" documents start the Arabic edition on a new page.
 * Editable, so staff or an attorney can adjust it before it is signed.
 */
import {
  AlignmentType, BorderStyle, Document, Footer, HeightRule, Packer, PageBreak, PageNumber, Paragraph, ShadingType, Table, TableCell, TableLayoutType,
  TableRow, TextRun, VerticalAlign, WidthType,
} from "docx";
import { parseBlocks, type Block, type FormItem } from "./layout";

const FONT = "Times New Roman";
const SIZE = 24; // 12 pt, in half-points
const FULL = 9360; // text width in DXA (6.5in)
const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const LINE = { style: BorderStyle.SINGLE, size: 6, color: "333333" };

export interface DocxSigner { role: string; name: string; status: string; signedAt: string | null }
export interface DocxInput { title: string; body: string; footerNote?: string; signers?: DocxSigner[] }

function run(text: string, o: { bold?: boolean; size?: number; rtl?: boolean; color?: string } = {}): TextRun {
  const size = o.size ?? SIZE;
  return new TextRun({ text, font: { ascii: FONT, hAnsi: FONT, cs: FONT, eastAsia: FONT }, size, sizeComplexScript: size, bold: o.bold, boldComplexScript: o.bold, rightToLeft: o.rtl, color: o.color });
}
/** Text with English sub-clause labels ("A. BANKING.") in bold; underscore runs shown as lines. */
function textRuns(text: string, o: { bold?: boolean; size?: number; rtl?: boolean }): TextRun[] {
  const m = !o.rtl && !o.bold ? /^([A-Z]\.\s+[A-Z][A-Z ,&'-]+\.)(\s.*)$/.exec(text) : null;
  const parts = m ? [{ t: m[1], b: true }, { t: m[2], b: false }] : [{ t: text, b: Boolean(o.bold) }];
  return parts.flatMap((p) => p.t.split(/(_{4,})/).filter(Boolean).map((seg) => (/^_{4,}$/.test(seg) ? run("______________", { ...o, bold: false }) : run(seg, { ...o, bold: p.b }))));
}

function para(text: string, o: { bold?: boolean; size?: number; rtl?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; before?: number; after?: number; keepNext?: boolean; pageBreakBefore?: boolean; indent?: { left: number; hanging?: number } } = {}): Paragraph {
  return new Paragraph({
    pageBreakBefore: o.pageBreakBefore, bidirectional: o.rtl, keepNext: o.keepNext, keepLines: true,
    alignment: o.align ?? (o.rtl ? AlignmentType.START : AlignmentType.LEFT),
    spacing: { before: o.before ?? 0, after: o.after ?? 120, line: 276 }, indent: o.indent,
    children: textRuns(text, o),
  });
}

/** A signature row: a fixed-width table whose top row is the lines to write on and whose bottom row holds the small labels. */
function signatureRow(it: Extract<FormItem, { k: "row" }>, width: number, rtl: boolean): Table[] {
  const n = it.fields.length; const gap = 360;
  const weights = it.fields.map((f) => (/signature|seal|التوقيع|ختم/i.test(f.label) ? 2.3 : /date|التاريخ/i.test(f.label) ? 1 : 1.5));
  const sum = weights.reduce((a, b) => a + b, 0); const avail = width - gap * (n - 1);
  const widths: number[] = []; const cols: { w: number; gap: boolean }[] = [];
  it.fields.forEach((_, i) => { const w = Math.round((avail * weights[i]) / sum); cols.push({ w, gap: false }); if (i < n - 1) cols.push({ w: gap, gap: true }); });
  cols.forEach((c) => widths.push(c.w));
  const lineRow = new TableRow({ cantSplit: true, height: { value: 640, rule: HeightRule.ATLEAST }, children: cols.map((c) => new TableCell({ width: { size: c.w, type: WidthType.DXA }, borders: c.gap ? { top: NONE, bottom: NONE, left: NONE, right: NONE } : { top: NONE, left: NONE, right: NONE, bottom: LINE }, children: [new Paragraph({ children: [] })] })) });
  const labelRow = new TableRow({ cantSplit: true, children: cols.map((c, i) => { const fi = i / 2; const f = c.gap ? null : it.fields[fi]; const lab = f ? `${f.label}${fi === n - 1 && it.note ? ` ${it.note}` : ""}`.trim() : ""; return new TableCell({ width: { size: c.w, type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE }, children: [new Paragraph({ bidirectional: rtl, spacing: { before: 30, after: 0 }, children: lab ? [run(lab, { size: 17, color: "666666", rtl })] : [] })] }); }) });
  const out: Table[] = [];
  out.push(new Table({ width: { size: width, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, visuallyRightToLeft: rtl, borders: NO_BORDERS, rows: [lineRow, labelRow] }));
  return out;
}

function formChildren(items: FormItem[], width: number, rtl: boolean): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const it of items) {
    if (it.k === "text") out.push(para(it.text, { bold: it.bold, rtl, after: 40, keepNext: true, size: 22 }));
    else {
      if (it.caption) out.push(para(it.caption, { rtl, after: 0, keepNext: true, size: 22 }));
      out.push(...signatureRow(it, width, rtl));
      out.push(new Paragraph({ spacing: { after: 60 }, children: [] }));
    }
  }
  return out;
}

function notaryBox(items: FormItem[], rtl: boolean): Table {
  const innerW = FULL - 560; const sealW = 1800; const leftW = innerW - sealW - 240;
  const textItems = items.filter((i) => i.k !== "row").map((it, i) => (i === 0 && it.k === "text" ? { ...it, bold: true } : it)) as FormItem[];
  const rowItems = items.filter((i) => i.k === "row");
  const layout = new Table({
    width: { size: innerW, type: WidthType.DXA }, columnWidths: [leftW, 240, sealW], layout: TableLayoutType.FIXED, visuallyRightToLeft: rtl, borders: NO_BORDERS,
    rows: [new TableRow({ cantSplit: true, children: [
      new TableCell({ width: { size: leftW, type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE }, children: formChildren(rowItems, leftW, rtl) }),
      new TableCell({ width: { size: 240, type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE }, children: [new Paragraph({ children: [] })] }),
      new TableCell({ width: { size: sealW, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, borders: { top: { style: BorderStyle.DASHED, size: 6, color: "999999" }, bottom: { style: BorderStyle.DASHED, size: 6, color: "999999" }, left: { style: BorderStyle.DASHED, size: 6, color: "999999" }, right: { style: BorderStyle.DASHED, size: 6, color: "999999" } }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(rtl ? "الختم" : "Seal", { size: 18, color: "999999", rtl })] })] }),
    ] })],
  });
  const box = { style: BorderStyle.SINGLE, size: 6, color: "888888" };
  return new Table({
    width: { size: FULL, type: WidthType.DXA }, columnWidths: [FULL], layout: TableLayoutType.FIXED, visuallyRightToLeft: rtl,
    rows: [new TableRow({ cantSplit: true, children: [new TableCell({ width: { size: FULL, type: WidthType.DXA }, borders: { top: box, bottom: box, left: box, right: box }, shading: { type: ShadingType.CLEAR, fill: "F7F7F7", color: "auto" }, margins: { top: 200, bottom: 200, left: 280, right: 280 }, children: [...formChildren(textItems, innerW, rtl), layout, new Paragraph({ children: [] })] })] })],
  });
}

function blockChildren(blocks: Block[]): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  let forms = 0; let lastTitle = "";
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi]; const hasSub = blocks[bi + 1]?.t === "subtitle";
    switch (b.t) {
      case "break": forms = 0; break; // the next title carries the page break
      case "title": lastTitle = b.text; out.push(new Paragraph({ pageBreakBefore: out.length > 0, bidirectional: b.rtl, alignment: AlignmentType.CENTER, keepNext: true, spacing: { after: hasSub ? 60 : 280 }, border: hasSub ? undefined : { bottom: { style: BorderStyle.SINGLE, size: 4, color: "999999", space: 8 } }, children: [run(b.text, { bold: true, size: 32, rtl: b.rtl })] })); break;
      case "subtitle": out.push(new Paragraph({ bidirectional: b.rtl, alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: -120, after: 280 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "999999", space: 8 } }, children: [run(b.text, { size: 23, rtl: b.rtl, color: "555555" })] })); break;
      case "heading": out.push(para(b.text, { bold: true, rtl: b.rtl, before: 280, after: 100, keepNext: true })); break;
      case "subheading": out.push(para(b.text, { bold: true, size: 22, rtl: b.rtl, before: 240, after: 100, keepNext: true })); break;
      case "bullet": out.push(para(`•\t${b.text}`, { rtl: b.rtl, align: AlignmentType.JUSTIFIED, indent: { left: 540, hanging: 300 }, after: 80 })); break;
      case "para": out.push(para(b.text, { rtl: b.rtl, align: AlignmentType.JUSTIFIED })); break;
      case "table": {
        const ncol = Math.max(...b.rows.map((r) => r.length));
        const numeric = (c: number) => b.rows.slice(1).every((r) => /^[\s$\d,.%()\-–—]*$/.test(r[c] || ""));
        const lens = Array.from({ length: ncol }, (_, c) => Math.max(...b.rows.map((r) => Math.min(40, (r[c] || "").length)), 6));
        const sum = lens.reduce((a, x) => a + x, 0);
        const widths = lens.map((l) => Math.round((FULL * l) / sum)); widths[ncol - 1] = FULL - widths.slice(0, -1).reduce((a, x) => a + x, 0);
        const bd = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
        out.push(new Table({
          width: { size: FULL, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, visuallyRightToLeft: b.rtl,
          rows: b.rows.map((r, ri) => { const strong = ri === 0 || /^total/i.test(r[0] || ""); return new TableRow({ cantSplit: true, tableHeader: ri === 0, children: Array.from({ length: ncol }, (_, c) => new TableCell({
            width: { size: widths[c], type: WidthType.DXA }, borders: { top: bd, bottom: bd, left: bd, right: bd }, margins: { top: 60, bottom: 60, left: 100, right: 100 },
            shading: strong ? { type: ShadingType.CLEAR, fill: "F3F3F3", color: "auto" } : undefined,
            children: [para(r[c] || "", { bold: strong, rtl: b.rtl, size: 20, after: 0, align: numeric(c) && ri > 0 ? AlignmentType.RIGHT : (b.rtl ? AlignmentType.START : AlignmentType.LEFT) })],
          })) }); }),
        }));
        out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        break;
      }
      case "form":
        forms += 1;
        if (forms === 1 && !b.notary) out.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 360, after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "999999", space: 4 } }, children: [run(b.rtl ? "التوقيعات" : "SIGNATURES", { bold: true, size: 22, rtl: b.rtl })] }));
        if (forms === 1 && !b.notary && lastTitle) out.push(new Paragraph({ bidirectional: b.rtl, alignment: AlignmentType.CENTER, keepNext: true, spacing: { after: 60 }, children: [run(`${b.rtl ? "صفحة التوقيع —" : "Signature page —"} ${lastTitle}`, { size: 17, color: "666666", rtl: b.rtl })] }));
        if (b.notary) { out.push(new Paragraph({ spacing: { before: 240 }, children: [] })); out.push(notaryBox(b.items, b.rtl)); out.push(new Paragraph({ spacing: { after: 120 }, children: [] })); }
        else { out.push(new Paragraph({ spacing: { before: 160 }, keepNext: true, children: [] })); out.push(...formChildren(b.items, FULL, b.rtl)); }
        break;
    }
  }
  return out;
}

export async function buildDocumentDocx(input: DocxInput): Promise<Buffer> {
  const children: (Paragraph | Table)[] = blockChildren(parseBlocks(input.body));

  if (input.signers?.length) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [run("SIGNATURE RECORD", { bold: true, size: 28 })] }));
    for (const s of input.signers) {
      const when = s.signedAt ? new Date(s.signedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";
      children.push(para(`${s.role}: ${s.name} — ${s.status}${when ? `, ${when}` : ""}`, { size: 22 }));
    }
  }

  const small = (t: string, size = 18) => new TextRun({ text: t, font: FONT, size, color: "555555" });
  const doc = new Document({
    creator: "AL TAX Nexus",
    title: input.title,
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1300, left: 1440, right: 1440 } } },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({ alignment: AlignmentType.CENTER, children: [small("Page "), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: "555555" }), small(" of "), new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 18, color: "555555" })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [small(input.title.length > 90 ? `${input.title.slice(0, 88)}…` : input.title, 15)] }),
            ...(input.footerNote ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [small(input.footerNote, 15)] })] : []),
          ],
        }),
      },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}
