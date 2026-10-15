/**
 * Bill of Sale — editable Word (.docx) version of billOfSale.ts's PDF, built
 * from the same stored transfer terms. Language is adapted per entity type
 * ("membership interest" for an LLC, "authorized officer" signature block for
 * a corporation, generic "ownership interest" otherwise) mirroring the firm's
 * own two real historical templates (a completed LLC sale and a completed
 * Inc. sale) rather than inventing boilerplate from scratch. Unlike the PDF
 * (fixed, download-and-print), this is meant to be opened and adjusted by
 * staff or an attorney before signing — same reason it stays a plain .docx
 * and not a fillable-field form.
 */
import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, PageNumber, Paragraph, ShadingType, Table, TableCell,
  TableRow, TabStopPosition, TabStopType, TextRun, WidthType,
} from "docx";
import { classForCategory, entityKindFor, billOfSaleParties, tidyAddress, legalState, stateCaption, describeSellers, describeBuyers, buildBillOfSaleBlocks, bosSubtitle, bosNotaryCertificate, bosWitnessLine, businessLabelFor, type BillOfSaleData, type EntityKind } from "./billOfSale";

export type { EntityKind };

function fmtDate(v: unknown): string {
  if (!v) return "________________";
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return "________________";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "________________";
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const FONT = "Calibri";

function heading(text: string): Paragraph {
  return new Paragraph({
    keepNext: true,
    spacing: { before: 240, after: 80 },
    children: [new TextRun({ text, bold: true, font: FONT, size: 21, color: "0B6B6B" })],
  });
}
function body(text: string, opts: { bold?: boolean; keepNext?: boolean } = {}): Paragraph {
  return new Paragraph({
    keepNext: opts.keepNext,
    keepLines: true,
    spacing: { after: 160 },
    alignment: AlignmentType.JUSTIFIED,
    children: [new TextRun({ text, font: FONT, size: 21, bold: opts.bold })],
  });
}
function centered(text: string, opts: { bold?: boolean; size?: number } = {}): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text, font: FONT, size: opts.size ?? 21, bold: opts.bold })],
  });
}
function signatureLine(): Paragraph {
  return new Paragraph({
    keepNext: true,
    spacing: { before: 320, after: 40 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "222222", space: 1 } },
    children: [new TextRun({ text: " ", font: FONT, size: 21 })],
  });
}
function labelLine(label: string, value: string): Paragraph {
  return new Paragraph({
    keepNext: true,
    spacing: { after: 60 },
    tabStops: [{ type: TabStopType.LEFT, position: 1600 }],
    children: [
      new TextRun({ text: `${label}:\t`, font: FONT, size: 21, bold: true }),
      new TextRun({ text: value, font: FONT, size: 21 }),
    ],
  });
}
function dateBlankLine(label = "Date"): Paragraph {
  return new Paragraph({
    spacing: { after: 260 },
    children: [new TextRun({ text: `${label}: ____________________`, font: FONT, size: 21 })],
  });
}

const ALLOC_COL_WIDTHS = [2520, 3528, 1512, 2520]; // Category / Description / Form 8594 Class / Amount, DXA, sums to the 10080 DXA content width below

function allocHeaderCell(text: string, width: number, align: typeof AlignmentType[keyof typeof AlignmentType] = AlignmentType.LEFT): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: "0B6B6B" },
    children: [new Paragraph({ alignment: align, children: [new TextRun({ text, font: FONT, size: 18, bold: true, color: "FFFFFF" })] })],
  });
}
function allocCell(text: string, width: number, align: typeof AlignmentType[keyof typeof AlignmentType] = AlignmentType.LEFT, opts: { bold?: boolean; columnSpan?: number } = {}): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: opts.columnSpan,
    children: [new Paragraph({ alignment: align, children: [new TextRun({ text, font: FONT, size: 20, bold: opts.bold })] })],
  });
}

/** Real IRC Section 1060 / Form 8594 itemized allocation schedule — replaces the freeform Section 3 paragraph when the transfer carries line-item allocations. */
function allocationTable(lines: { category: string; description?: string | null; amount: number }[]): Table {
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const rows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        allocHeaderCell("Category", ALLOC_COL_WIDTHS[0]),
        allocHeaderCell("Description", ALLOC_COL_WIDTHS[1]),
        allocHeaderCell("Form 8594 Class", ALLOC_COL_WIDTHS[2], AlignmentType.RIGHT),
        allocHeaderCell("Amount", ALLOC_COL_WIDTHS[3], AlignmentType.RIGHT),
      ],
    }),
    ...lines.map((l) => new TableRow({
      children: [
        allocCell(l.category, ALLOC_COL_WIDTHS[0]),
        allocCell(l.description || "", ALLOC_COL_WIDTHS[1]),
        allocCell(classForCategory(l.category), ALLOC_COL_WIDTHS[2], AlignmentType.RIGHT),
        allocCell(fmtMoney(l.amount), ALLOC_COL_WIDTHS[3], AlignmentType.RIGHT),
      ],
    })),
    new TableRow({
      children: [
        allocCell("Total Allocated Purchase Price", ALLOC_COL_WIDTHS[0] + ALLOC_COL_WIDTHS[1] + ALLOC_COL_WIDTHS[2], AlignmentType.RIGHT, { bold: true, columnSpan: 3 }),
        allocCell(fmtMoney(total), ALLOC_COL_WIDTHS[3], AlignmentType.RIGHT, { bold: true }),
      ],
    }),
  ];
  return new Table({ width: { size: ALLOC_COL_WIDTHS.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: ALLOC_COL_WIDTHS, rows });
}

const CONTENT_WIDTH_DXA = 10080; // 12240 page width - 1080 left/right margins, matches the Document's own page setup below

function buildFooter(businessName: string): Footer {
  return new Footer({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH_DXA }],
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: "999999", space: 4 } },
        children: [
          new TextRun({ text: `${businessName} — Bill of Sale`, font: FONT, size: 16, color: "6B6B6B" }),
          new TextRun({ text: "\t", font: FONT, size: 16 }),
          new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: "6B6B6B" }),
        ],
      }),
    ],
  });
}

/** One acknowledgment covering all signers — they appear before the same notary together, not as separate notarizations. */
function notaryBlock(data: BillOfSaleData, state: string): Paragraph[] {
  return [
    new Paragraph({ keepNext: true, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: "Acknowledgment (optional)", bold: true, font: FONT, size: 21 })] }),
    body(stateCaption(state), { keepNext: true }),
    body("CITY/COUNTY OF ______________________, to wit:", { keepNext: true }),
    body(bosNotaryCertificate(data), { keepNext: true }),
    body("WITNESS my hand and Notarial Seal.", { keepNext: true }),
    signatureLine(),
    body("Notary Public", { keepNext: true }),
    labelLine("Printed Name", "____________________________"),
    labelLine("My Commission Expires", "___________________"),
  ];
}

export async function generateBillOfSaleDocx(input: BillOfSaleData): Promise<Buffer> {
  const data: BillOfSaleData = { ...input, businessAddress: tidyAddress(input.businessAddress) };
  const kind = entityKindFor(data.entityType);
  const state = legalState(data.state);
  const businessLabel = businessLabelFor(data, kind, state);

  const children: (Paragraph | Table)[] = [];
  const allocations = (data.assetAllocations || []).filter((a) => a && a.category && Number.isFinite(a.amount) && a.amount > 0);

  children.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 40, before: 60 }, children: [new TextRun({ text: "BILL OF SALE", bold: true, font: FONT, size: 32 })] }));
  children.push(centered(bosSubtitle(kind), { size: 19 }));

  children.push(body(`This Bill of Sale is made and entered into as of ${fmtDate(data.effectiveDate)}, by and between:`));

  const parties = billOfSaleParties(data);
  const sellerDesc = describeSellers(data, kind, businessLabel);
  const buyerDesc = describeBuyers(data);

  children.push(body(`${parties.sellers.length > 1 ? "SELLERS" : "SELLER"}: ${sellerDesc}; and`));
  children.push(body(`${parties.buyers.length > 1 ? "BUYERS" : "BUYER"}: ${buyerDesc}.`));

  // The numbered sections come from the same builder the PDF uses, so the two outputs always say the same thing.
  for (const block of buildBillOfSaleBlocks(data)) {
    if (block.type === "heading") children.push(heading(block.text));
    else if (block.type === "para") children.push(body(block.text, { bold: block.bold }));
    else {
      children.push(body(block.intro, { keepNext: true }));
      children.push(allocationTable(allocations));
      children.push(new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: " ", font: FONT, size: 20 })] }));
    }
  }

  children.push(body("IN WITNESS WHEREOF, the parties have executed this Bill of Sale as of the date first written above.", { keepNext: true }));

  // Signature blocks — every seller and every buyer signs.
  parties.sellers.forEach((p, i) => {
    const label = parties.sellers.length > 1 ? `SELLER ${i + 1}` : "SELLER";
    children.push(signatureLine());
    children.push(body(kind === "Corp" ? `${label}: ${data.businessName}` : `${label} — Signature`, { bold: true, keepNext: true }));
    if (kind === "Corp") children.push(labelLine("By", `${p.name}, ${p.title || "Authorized Officer"}`));
    else children.push(labelLine("Printed Name", p.name));
    children.push(dateBlankLine());
  });
  parties.buyers.forEach((p, i) => {
    children.push(signatureLine());
    children.push(body(`${parties.buyers.length > 1 ? `BUYER ${i + 1}` : "BUYER"} — Signature`, { bold: true, keepNext: true }));
    children.push(labelLine("Printed Name", p.name));
    children.push(dateBlankLine());
  });

  // Optional witness, then the optional notary acknowledgment.
  children.push(body(bosWitnessLine(), { keepNext: true }));
  children.push(signatureLine());
  children.push(body("Witness (optional) — Signature", { bold: true, keepNext: true }));
  children.push(labelLine("Printed Name", "____________________________"));
  children.push(dateBlankLine());
  children.push(...notaryBlock(data, state));

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 },
          },
        },
        footers: { default: buildFooter(data.businessName) },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
