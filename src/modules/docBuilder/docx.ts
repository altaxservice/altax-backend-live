/**
 * Word (.docx) edition of a Document Builder document: the same rendered text as the PDF, laid out like a legal document —
 * centered title, numbered clauses in bold, signature lines kept together, "Page X of Y" in the footer. Arabic paragraphs are set
 * right-to-left (Word shapes Arabic itself, which the server's PDF writer cannot), and "English + Arabic" documents start the Arabic
 * edition on a new page. Editable, so staff or an attorney can adjust it before it is signed.
 */
import { AlignmentType, Document, Footer, Packer, PageBreak, PageNumber, Paragraph, TextRun } from "docx";

const FONT = "Times New Roman";
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const HEADING = /^\d+\.\s+[A-Z؀-ۿ][A-Z؀-ۿ0-9 &,'\/()\-،]+$/;
const ROLE_LINE = /^[A-Z][A-Z ()'\/&.,-]{2,}(:.*)?$/;
const SIZE = 24; // 12 pt, in half-points

export interface DocxSigner { role: string; name: string; status: string; signedAt: string | null }
export interface DocxInput { title: string; body: string; footerNote?: string; signers?: DocxSigner[] }

function runs(text: string, o: { bold?: boolean; size?: number; rtl?: boolean }): TextRun[] {
  const size = o.size ?? SIZE;
  const base = { font: { ascii: FONT, hAnsi: FONT, cs: FONT, eastAsia: FONT }, size, sizeComplexScript: size, bold: o.bold, boldComplexScript: o.bold, rightToLeft: o.rtl };
  // English sub-clauses such as "A. BANKING. At any bank…" get their label in bold.
  const m = !o.rtl && !o.bold ? /^([A-Z]\.\s+[A-Z][A-Z ,&'-]+\.)(\s.*)$/.exec(text) : null;
  if (m) return [new TextRun({ ...base, text: m[1], bold: true, boldComplexScript: true }), new TextRun({ ...base, text: m[2] })];
  return [new TextRun({ ...base, text })];
}

export async function buildDocumentDocx(input: DocxInput): Promise<Buffer> {
  const children: Paragraph[] = [];
  const lines = input.body.replace(/\r/g, "").split("\n");
  let blankRun = 0;
  let first = true;
  let prevSignature = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { blankRun += 1; continue; }
    const rtl = ARABIC_RE.test(line);
    const newEdition = !first && blankRun >= 2 && rtl;
    const isTitle = first || newEdition;
    const isSignature = /_{6,}/.test(line);
    const isHeading = !isTitle && HEADING.test(line);
    const isRole = !isTitle && !isSignature && !isHeading && !rtl && line.length < 90 && ROLE_LINE.test(line);
    const align = isTitle ? AlignmentType.CENTER : isSignature || isRole || isHeading ? (rtl ? AlignmentType.START : AlignmentType.LEFT) : AlignmentType.JUSTIFIED;
    children.push(new Paragraph({
      pageBreakBefore: newEdition,
      bidirectional: rtl,
      alignment: align,
      keepNext: isTitle || isHeading || isRole,
      keepLines: true,
      spacing: { before: isTitle ? 0 : isHeading ? 280 : isSignature && !prevSignature ? 360 : blankRun > 0 ? 160 : 0, after: isTitle ? 240 : isSignature ? 120 : 120, line: 276 },
      children: runs(line, { bold: isTitle || isHeading || isRole, size: isTitle ? 32 : SIZE, rtl }),
    }));
    prevSignature = isSignature;
    blankRun = 0; first = false;
  }

  if (input.signers?.length) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: runs("SIGNATURE RECORD", { bold: true, size: 28 }) }));
    for (const s of input.signers) {
      const when = s.signedAt ? new Date(s.signedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";
      children.push(new Paragraph({ spacing: { after: 120 }, children: runs(`${s.role}: ${s.name} — ${s.status}${when ? `, ${when}` : ""}`, { size: 22 }) }));
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
            ...(input.footerNote ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [small(input.footerNote, 15)] })] : []),
          ],
        }),
      },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}
