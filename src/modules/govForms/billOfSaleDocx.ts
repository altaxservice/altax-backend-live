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
import { getFirmProfile } from "../../common/firmProfile";
import { classForCategory, type BillOfSaleData } from "./billOfSale";

export type EntityKind = "LLC" | "Corp" | "Generic";

export function entityKindFor(entityType: string | null | undefined): EntityKind {
  const t = String(entityType || "").trim();
  if (t === "LLC") return "LLC";
  if (t === "C-Corp" || t === "S-Corp") return "Corp";
  return "Generic";
}

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
    spacing: { before: 240, after: 80 },
    children: [new TextRun({ text, bold: true, font: FONT, size: 21, color: "0B6B6B" })],
  });
}
function body(text: string, opts: { bold?: boolean } = {}): Paragraph {
  return new Paragraph({
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
    spacing: { before: 320, after: 40 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "222222", space: 1 } },
    children: [new TextRun({ text: " ", font: FONT, size: 21 })],
  });
}
function labelLine(label: string, value: string): Paragraph {
  return new Paragraph({
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

/** One acknowledgment covering both signers — both parties appear before the same notary together, not two separate notarizations. */
function notaryBlock(sellerName: string, buyerName: string, state: string): Paragraph[] {
  const seller = sellerName || "____________________";
  const buyer = buyerName || "____________________";
  return [
    new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: "Acknowledgment", bold: true, font: FONT, size: 21 })] }),
    body(`STATE OF ${state.toUpperCase()}`),
    body("CITY/COUNTY OF ______________________, to wit:"),
    body(
      `I HEREBY CERTIFY that on this ______ day of ______________, 20____, before me, the undersigned Notary Public ` +
      `of the State of ${state}, personally appeared ${seller} and ${buyer}, known to me (or satisfactorily proven) to be the ` +
      `persons whose names are subscribed to the foregoing Bill of Sale, and acknowledged that they executed the same for the purposes therein contained.`
    ),
    body("WITNESS my hand and Notarial Seal."),
    signatureLine(),
    body("Notary Public"),
    labelLine("Printed Name", "____________________________"),
    labelLine("My Commission Expires", "___________________"),
  ];
}

export async function generateBillOfSaleDocx(data: BillOfSaleData & { entityType?: string | null; state?: string | null }): Promise<Buffer> {
  const profile = await getFirmProfile();
  const kind = entityKindFor(data.entityType);
  const state = data.state || "Maryland";
  const businessLabel = kind === "LLC"
    ? `${data.businessName}, a ${state} limited liability company`
    : kind === "Corp"
    ? `${data.businessName}, a ${state} corporation`
    : data.businessName;

  const children: (Paragraph | Table)[] = [];
  const allocations = (data.assetAllocations || []).filter((a) => a && a.category && Number.isFinite(a.amount) && a.amount > 0);

  children.push(centered(profile.firmName.toUpperCase(), { bold: true, size: 18 }));
  children.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 40, before: 60 }, children: [new TextRun({ text: "BILL OF SALE", bold: true, font: FONT, size: 32 })] }));
  children.push(centered(kind === "LLC" ? "(Sale of Business, Including LLC Membership Interest)" : kind === "Corp" ? "(Sale of Business Assets)" : "(Sale of Business Ownership Interest)", { size: 19 }));

  children.push(
    body(
      `This Bill of Sale is made and entered into as of ${fmtDate(data.effectiveDate)}, by and between:`
    )
  );

  const sellerDesc = kind === "Corp"
    ? `${data.sellerName}${data.sellerTitle ? `, its ${data.sellerTitle}` : ", its authorized officer"}, on behalf of ${businessLabel} ("Seller")`
    : `${data.sellerName}${data.sellerTitle ? `, ${data.sellerTitle}` : ""} ("Seller")${kind === "LLC" ? `, owner of ${businessLabel}` : ""}`;
  const buyerDesc = `${data.buyerName}${data.buyerTitle ? `, ${data.buyerTitle}` : ""}${data.buyerAddress ? `, of ${data.buyerAddress}` : ""} ("Buyer")`;

  children.push(body(`SELLER: ${sellerDesc}; and`));
  children.push(body(`BUYER: ${buyerDesc}.`));

  let n = 1;

  children.push(heading(`${n++}. PARTIES AND BUSINESS`));
  children.push(body(
    `This Bill of Sale concerns the business known as ${data.businessName}` +
    `${data.businessAddress ? `, operated at ${data.businessAddress}` : ""}${data.ein ? ` (EIN ${data.ein})` : ""} (the "Business").`
  ));

  if (kind === "LLC") {
    children.push(heading(`${n++}. SALE OF MEMBERSHIP INTEREST`));
    children.push(body(
      `For and in consideration of ${fmtMoney(data.salePrice)}, the receipt and sufficiency of which is hereby acknowledged, ` +
      `Seller does hereby sell, assign, transfer, and convey to Buyer, and Buyer's successors and assigns, all of Seller's right, ` +
      `title, and interest in and to ${businessLabel}, including one hundred percent (100%) of the membership interest in the ` +
      `Company, together with all of the assets of the Business described in Section 3 below. Upon execution of this Bill of ` +
      `Sale, Buyer shall be the sole member of the Company, and Seller withdraws as a member.`
    ));
  } else {
    children.push(heading(`${n++}. SALE OF BUSINESS ASSETS`));
    children.push(body(
      `For and in consideration of ${fmtMoney(data.salePrice)}, the receipt and sufficiency of which is hereby acknowledged, ` +
      `Seller does hereby sell, transfer, convey, and deliver to Buyer all of Seller's right, title, and interest in and to ` +
      `${businessLabel}, including the assets described in Section 3 below (collectively, the "Assets").`
    ));
  }

  if (allocations.length > 0) {
    children.push(heading(`${n++}. ASSETS INCLUDED — ALLOCATION OF PURCHASE PRICE`));
    children.push(body(
      "The Purchase Price is allocated among the assets of the Business as follows, for purposes of IRC Section 1060 " +
      "and each party's Form 8594 (Asset Acquisition Statement):"
    ));
    children.push(allocationTable(allocations));
    children.push(new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: " ", font: FONT, size: 20 })] }));
  } else {
    children.push(heading(`${n++}. ASSETS INCLUDED`));
    children.push(body(
      data.assetsIncluded?.trim() ||
      "No specific assets were itemized for this transfer beyond the ownership interest described above; the parties should attach a schedule of included assets if one exists."
    ));
  }

  children.push(heading(`${n++}. PURCHASE PRICE AND PAYMENT`));
  children.push(body(
    `The total purchase price for the Assets is ${fmtMoney(data.salePrice)}, payable by Buyer to Seller as agreed between the ` +
    `parties, the receipt of which Seller acknowledges upon payment in full.`
  ));

  children.push(heading(`${n++}. LIABILITIES`));
  children.push(body(
    data.liabilitiesIncluded?.trim() ||
    "Seller remains solely responsible for, and shall indemnify and hold Buyer harmless from, any debts, obligations, or liabilities of the Seller or of the Business arising prior to the effective date of this Bill of Sale, unless otherwise agreed in writing by the parties."
  ));

  children.push(heading(`${n++}. SELLER'S WARRANTIES`));
  children.push(body(
    `Seller warrants and represents that: (a) Seller is the lawful owner of the ownership interest and the Assets, and has ` +
    `full right, power, and authority to sell and transfer the same; (b) the ownership interest and the Assets are free and ` +
    `clear of all liens, security interests, encumbrances, and claims of any kind, except as disclosed to Buyer in writing; ` +
    `and (c) Seller will warrant and defend title to the ownership interest and the Assets against the lawful claims and ` +
    `demands of all persons.`
  ));

  children.push(heading(`${n++}. CONDITION OF ASSETS`));
  children.push(body(
    `Except for the warranty of title set forth above, the Assets are sold in their present condition, "AS IS, WHERE IS," ` +
    `and Seller makes no other warranty, express or implied, including any warranty of merchantability or fitness for a ` +
    `particular purpose.`
  ));

  if (data.additionalTerms?.trim()) {
    children.push(heading(`${n++}. ADDITIONAL CLAUSE(S) / TERMS`));
    for (const para of data.additionalTerms.trim().split(/\n+/)) {
      children.push(body(para));
    }
  }

  children.push(heading(`${n++}. FURTHER ASSURANCES`));
  children.push(body(
    "Each party agrees to execute and deliver any additional documents and to take any further actions reasonably " +
    "necessary to carry out the intent of this Bill of Sale."
  ));

  children.push(heading(`${n++}. GOVERNING LAW`));
  children.push(body(`This Bill of Sale shall be governed by and construed in accordance with the laws of the State of ${state}.`));

  children.push(heading(`${n++}. BINDING EFFECT`));
  children.push(body(
    "This Bill of Sale shall be binding upon and shall inure to the benefit of the parties and their respective heirs, " +
    "successors, and assigns. Nothing in this document constitutes legal, tax, or accounting advice to either party."
  ));

  children.push(body("IN WITNESS WHEREOF, the parties have executed this Bill of Sale as of the date first written above."));

  // Signature blocks
  children.push(signatureLine());
  children.push(body(kind === "Corp" ? `SELLER: ${data.businessName}` : "SELLER — Signature", { bold: true }));
  if (kind === "Corp") children.push(labelLine("By", `${data.sellerName}, ${data.sellerTitle || "Authorized Officer"}`));
  else children.push(labelLine("Printed Name", data.sellerName));
  children.push(dateBlankLine());

  children.push(signatureLine());
  children.push(body("BUYER — Signature", { bold: true }));
  children.push(labelLine("Printed Name", data.buyerName));
  children.push(dateBlankLine());

  // One notary acknowledgment covering both signers together, not a separate notarization per party.
  children.push(...notaryBlock(data.sellerName, data.buyerName, state));

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
