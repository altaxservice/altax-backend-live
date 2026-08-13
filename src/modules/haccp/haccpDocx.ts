/**
 * HACCP Plan — editable Word (.docx) version, built to match the firm's own
 * real, previously-hand-prepared HACCP plans (reviewed a real completed
 * plan before writing this) rather than inventing a new look: running
 * header (business name + address + rule) and "N | Page" footer on every
 * page; a gray title banner on the cover; Menu as a bordered single-column
 * table with gray category-header rows; plain bold-italic headings (no
 * shading) for "Menu:" and "Equipment List:"; gray banners for the lettered
 * A/B/C/D sections and each CCP "Process" sub-header; a real 4-column CCP
 * table (CCP & Equipment / Monitoring / Corrective Action / Verification)
 * built from the same label-prefixed lines haccpPdf.ts already renders as
 * text; Equipment List as a plain bullet list (not a table — the real
 * sample doesn't table it, so this doesn't either). Reuses haccpPdf.ts's
 * HaccpPdfData untouched — same data, no schema change, meant as an
 * editable companion to (not a replacement for) the existing PDF.
 */
import {
  AlignmentType, BorderStyle, Document, Footer, Header, LevelFormat, PageBreak, PageNumber, Packer, Paragraph,
  ShadingType, Table, TableCell, TableRow, TabStopType, TextRun, WidthType,
} from "docx";
import type { HaccpPdfData, HaccpMenuGroup, HaccpEquipmentLine } from "./haccpPdf";

const FONT = "Calibri";
// Warm neutral palette — cream/tan banners with a terracotta accent, instead
// of the real sample's flat gray, per explicit user request for something
// "cozier." Still reads as an official document (same layout/structure),
// just warmer than plain gray-on-white.
const BANNER_FILL = "F2E3CC";
const ACCENT = "A8582E";
const MUTED = "8A7A68";
const RULE_COLOR = "D9C4A3";
const WATERMARK_COLOR = "D8C6AA";

const PAGE_WIDTH = 12240;
const PAGE_HEIGHT = 15840;
const MARGIN = 1080;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2; // 10080

const CCP_LABEL_RE = /^(CCP & EQUIPMENT|MONITORING|CORRECTIVE ACTION|VERIFICATION):\s*(.*)$/;
const SECTION_HEADER_RE = /^[A-Z][A-Z0-9 &().,/'-]{3,}$/;
const LEAD_IN_RE = /^(\d+\.\s*)?([A-Z][A-Za-z0-9 &/'-]{2,50}[.:])\s+(.+)$/;
const CCP_FIELD_ORDER = ["CCP & EQUIPMENT", "MONITORING", "CORRECTIVE ACTION", "VERIFICATION"];
const CCP_COLUMN_LABELS = ["CCP Procedures & Equipment", "Monitoring", "Corrective Action", "Verification"];
const CCP_COL_WIDTHS = [2520, 2520, 2520, 2520];

const KEEP_UPPER = new Set(["CCP", "HACCP"]);
const LOWER_WORDS = new Set(["of", "and", "for", "the", "with", "or", "a", "an"]);

/** ALLCAPS section headers in the stored template text ("A. PRIORITY ASSESSMENT INFORMATION") become Title Case banners, matching the real sample's own casing. */
function titleCase(line: string): string {
  return line
    .toLowerCase()
    .split(" ")
    .map((w, i) => {
      const bare = w.replace(/[^a-z]/gi, "").toUpperCase();
      if (KEEP_UPPER.has(bare)) return w.toUpperCase();
      if (i > 0 && LOWER_WORDS.has(w)) return w;
      return w.replace(/^([a-z])/, (m) => m.toUpperCase());
    })
    .join(" ");
}

function formatAddressLine(data: HaccpPdfData): string {
  return [data.streetAddress, data.city, data.state, data.zipCode].filter(Boolean).join(", ");
}

function buildHeader(businessName: string, addressLine: string): Header {
  return new Header({
    children: [
      new Paragraph({
        spacing: { after: 20 },
        children: [new TextRun({ text: businessName.toUpperCase(), bold: true, font: FONT, size: 30 })],
      }),
      new Paragraph({
        spacing: { after: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE_COLOR, space: 4 } },
        children: [new TextRun({ text: addressLine, font: FONT, size: 22, color: MUTED })],
      }),
      // Straight (non-diagonal) watermark line — repeats on every page since
      // it lives in the Header. A true rotated watermark like the PDF's needs
      // a rendered image, which this app has no raster-image pipeline for;
      // this is the agreed stand-in.
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: `PREPARED FOR ${businessName.toUpperCase()} — INTERNAL WORKING COPY`, italics: true, font: FONT, size: 14, color: WATERMARK_COLOR })],
      }),
    ],
  });
}

/** Matches haccpPdf.ts's footer exactly: business name + page number on one line, then the same COMAR/exclusive-use notice below it. */
function buildFooter(businessName: string, jurisdiction: string): Footer {
  const notice = `Prepared in accordance with Maryland COMAR 10.15.03 and ${jurisdiction} Health Department HACCP Guidelines. Prepared exclusively for ${businessName} — not for use by any other business.`;
  return new Footer({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }],
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: RULE_COLOR, space: 4 } },
        children: [
          new TextRun({ text: `${businessName} — HACCP Plan`, bold: true, font: FONT, size: 16 }),
          new TextRun({ text: "\t", font: FONT, size: 16 }),
          new TextRun({ children: ["Page ", PageNumber.CURRENT], font: FONT, size: 16, color: MUTED }),
        ],
      }),
      new Paragraph({
        spacing: { before: 40 },
        children: [new TextRun({ text: notice, font: FONT, size: 14, color: MUTED })],
      }),
    ],
  });
}

/** Full-width gray banner used for the cover title and every A/B/C/D + Process sub-header — the real sample's signature look. */
function banner(text: string, opts: { subtitle?: string; centered?: boolean; size?: number } = {}): Table {
  const align = opts.centered ? AlignmentType.CENTER : AlignmentType.LEFT;
  const paras: Paragraph[] = [
    new Paragraph({
      alignment: align,
      children: [new TextRun({ text, bold: true, italics: true, font: FONT, size: opts.size ?? 24, color: ACCENT })],
    }),
  ];
  if (opts.subtitle) {
    paras.push(new Paragraph({
      alignment: align,
      spacing: { before: 60 },
      children: [new TextRun({ text: opts.subtitle, italics: true, font: FONT, size: 18, color: "6B5B49" })],
    }));
  }
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: BANNER_FILL },
            margins: { top: 140, bottom: 140, left: 180, right: 180 },
            children: paras,
          }),
        ],
      }),
    ],
  });
}

/** Plain bold-italic heading with no shading — "Menu:" and "Equipment List:" in the real sample aren't banners, just headings. */
function plainHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 120, after: 160 },
    children: [new TextRun({ text, bold: true, italics: true, font: FONT, size: 26, color: ACCENT })],
  });
}

function contactLine(label: string, value?: string | null): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
    children: [
      new TextRun({ text: `${label}: `, font: FONT, size: 18, color: MUTED, bold: true }),
      new TextRun({ text: value || "—", font: FONT, size: 18, bold: true }),
    ],
  });
}

function pageBreak(): Paragraph {
  return new Paragraph({ children: [new PageBreak()] });
}

function menuTable(groups: HaccpMenuGroup[]): Table {
  const rows: TableRow[] = [];
  for (const g of groups) {
    rows.push(new TableRow({
      children: [new TableCell({
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: BANNER_FILL },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${g.category.toUpperCase()}:`, bold: true, font: FONT, size: 22, color: ACCENT })] })],
      })],
    }));
    for (const item of g.items) {
      rows.push(new TableRow({
        children: [new TableCell({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: item, bold: true, font: FONT, size: 21 })] })],
        })],
      }));
    }
  }
  if (!rows.length) {
    rows.push(new TableRow({
      children: [new TableCell({
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "(none selected)", italics: true, color: MUTED, font: FONT, size: 20 })] })],
      })],
    }));
  }
  return new Table({ width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: [CONTENT_WIDTH], rows });
}

const EQUIPMENT_BULLETS_REF = "haccpEquipmentBullets";

function equipmentParagraphs(equipment: HaccpEquipmentLine[]): Paragraph[] {
  if (!equipment.length) {
    return [new Paragraph({ children: [new TextRun({ text: "(none selected)", italics: true, color: MUTED, font: FONT, size: 20 })] })];
  }
  return equipment.map((item) => new Paragraph({
    numbering: { reference: EQUIPMENT_BULLETS_REF, level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text: `${item.label}${item.quantity > 1 ? ` (x${item.quantity})` : ""}`, italics: true, font: FONT, size: 21 })],
  }));
}

function ccpHeaderRow(): TableRow {
  return new TableRow({
    tableHeader: true,
    children: CCP_COLUMN_LABELS.map((label, i) => new TableCell({
      width: { size: CCP_COL_WIDTHS[i], type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: BANNER_FILL },
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: label, bold: true, font: FONT, size: 18, color: ACCENT })] })],
    })),
  });
}
function ccpDataRow(fields: Record<string, string>): TableRow {
  return new TableRow({
    children: CCP_FIELD_ORDER.map((key, i) => new TableCell({
      width: { size: CCP_COL_WIDTHS[i], type: WidthType.DXA },
      children: [new Paragraph({ children: [new TextRun({ text: fields[key] || "", italics: true, font: FONT, size: 18 })] })],
    })),
  });
}

function leadInParagraph(m: RegExpMatchArray): Paragraph {
  const [, numPrefix, lead, rest] = m;
  const runs: TextRun[] = [];
  if (numPrefix) runs.push(new TextRun({ text: numPrefix, font: FONT, size: 20 }));
  runs.push(new TextRun({ text: `${lead} `, bold: true, font: FONT, size: 20, color: ACCENT }));
  runs.push(new TextRun({ text: rest, font: FONT, size: 20 }));
  return new Paragraph({ spacing: { after: 140 }, alignment: AlignmentType.JUSTIFIED, children: runs });
}

function bodyParagraph(text: string): Paragraph {
  return new Paragraph({ spacing: { after: 140 }, alignment: AlignmentType.JUSTIFIED, children: [new TextRun({ text, font: FONT, size: 20 })] });
}

/**
 * Parses the plan's rendered_body — the same text haccpPdf.ts already draws
 * line-by-line with regex-matched CCP labels — into gray-banner section/
 * process headers, real 4-column CCP tables, and prose paragraphs. No new
 * data required: the template content already carries this structure
 * (see haccpContent.ts), the PDF just never turned it into an actual table.
 */
function renderBody(renderedBody: string): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  let openTable: TableRow[] | null = null;
  let rowFields: Record<string, string> = {};

  function flushRowFields() {
    if (!Object.keys(rowFields).length) return;
    if (!openTable) openTable = [ccpHeaderRow()];
    openTable.push(ccpDataRow(rowFields));
    rowFields = {};
  }
  /**
   * Moves any pending quad into the open table AND immediately pushes that
   * table into `out` — this must happen as soon as a non-quad line is seen,
   * not deferred to the next Process/Section boundary, or a one-off note
   * line right after a CCP quad (e.g. "CROSS-CONTAMINATION: ...") ends up
   * rendered *before* the table it was meant to follow, since it would sit
   * in `out` while the table was still waiting in the `openTable` buffer.
   */
  function flushPending() {
    flushRowFields();
    if (openTable && openTable.length > 1) out.push(new Table({ width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: CCP_COL_WIDTHS, rows: openTable }));
    openTable = null;
  }

  for (const rawLine of renderedBody.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const ccpMatch = line.match(CCP_LABEL_RE);
    if (ccpMatch) {
      rowFields[ccpMatch[1]] = ccpMatch[2];
      continue;
    }
    flushPending();

    if (/^Process\b/i.test(line)) {
      out.push(banner(line, { size: 20 }));
      continue;
    }
    if (SECTION_HEADER_RE.test(line) && line === line.toUpperCase()) {
      out.push(banner(titleCase(line)));
      continue;
    }
    const leadMatch = line.match(LEAD_IN_RE);
    out.push(leadMatch ? leadInParagraph(leadMatch) : bodyParagraph(line));
  }
  flushPending();
  return out;
}

export async function generateHaccpDocx(data: HaccpPdfData): Promise<Buffer> {
  const addressLine = formatAddressLine(data);
  const children: (Paragraph | Table)[] = [];

  // ---- Cover ----
  children.push(new Paragraph({ spacing: { before: 2400 }, children: [] }));
  children.push(banner("Hazard Analysis Critical Control Point (HACCP) Plan", {
    centered: true,
    size: 28,
    subtitle: `Prepared in accordance with Maryland COMAR 10.15.03 Food Service Facility Regulations and ${data.jurisdiction} Health Department HACCP Guidelines.`,
  }));
  children.push(new Paragraph({ spacing: { before: 4200 }, children: [] }));
  children.push(contactLine("CONTACT PERSON", data.contactPerson));
  children.push(contactLine("PHONE NUMBER", data.phone));
  children.push(contactLine("EMAIL", data.email));
  children.push(pageBreak());

  // ---- Menu ----
  children.push(plainHeading("Menu:"));
  children.push(menuTable(data.menuGroups));
  children.push(pageBreak());

  // ---- Body: A/B/C/D sections, Process sub-headers, CCP tables, training/signature text ----
  children.push(...renderBody(data.renderedBody));

  // ---- Equipment List (own page, plain bullets — matches the real sample) ----
  children.push(pageBreak());
  children.push(plainHeading("Equipment List:"));
  children.push(...equipmentParagraphs(data.equipment));

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: EQUIPMENT_BULLETS_REF,
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 360 } } } }],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
          },
        },
        headers: { default: buildHeader(data.businessName, addressLine) },
        footers: { default: buildFooter(data.businessName, data.jurisdiction) },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
