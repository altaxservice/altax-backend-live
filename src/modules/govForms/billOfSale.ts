/**
 * Bill of Sale — hand-drawn from scratch (pdf-lib primitives), same
 * self-contained approach as contractPdf.ts/invoicePdf.ts/reportsPdf.ts.
 * Not a government form (no agency template to fill), so it lives alongside
 * the gov-form generators rather than inside that module — it's part of the
 * same Ownership Transfer package but generated fresh from stored terms on
 * every download, never stored as a file. Standard operating-business bill
 * of sale structure: identifies seller/buyer/business, states consideration
 * and what's included, an as-is disclaimer, governing law, and signature
 * blocks for both parties — deliberately does NOT capture an electronic
 * signature (unlike contracts.routes.ts's click-to-sign flow), since this
 * changes legal ownership and belongs on a wet-ink or notarized original,
 * same conservative rule this app already applies to every IRS/state form.
 *
 * When the transfer carries itemized asset allocations, Section 3 renders a
 * real IRC Section 1060 / Form 8594-style allocation schedule (category,
 * description, amount, and that category's Form 8594 asset class) instead
 * of one freeform paragraph — see ASSET_ALLOCATION_CLASS below and
 * ASSET_ALLOCATION_CATEGORIES in frontend/src/utils/clientOptions.ts, which
 * this must stay in sync with. Multi-page aware (see ensureSpace/newPage)
 * since an itemized schedule can run well past one page.
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
const TEAL_TINT = rgb(0.93, 0.97, 0.97);
const L = 48, R = PAGE_W - 48;
const BOTTOM_MARGIN = 64;

export interface AssetAllocationLine {
  category: string;
  description?: string | null;
  amount: number;
}

/**
 * IRC Section 1060 / Form 8594 asset classes — Class I (cash) and Class II
 * (actively traded securities) are included for completeness even though a
 * small-business sale rarely uses them; everything else here is the
 * realistic set for a firm like this one's client base (delis, smoke shops,
 * convenience stores). "Other" and any custom-typed category intentionally
 * fall through to "—" rather than guessing a class.
 */
export const ASSET_ALLOCATION_CLASS: Record<string, string> = {
  "Cash": "Class I",
  "Marketable Securities / CDs": "Class II",
  "Accounts Receivable": "Class III",
  "Inventory / Stock in Trade": "Class IV",
  "Equipment & Machinery": "Class V",
  "Furniture & Fixtures": "Class V",
  "Vehicles": "Class V",
  "Real Property / Leasehold Improvements": "Class V",
  "Covenant Not to Compete": "Class VI",
  "Customer List / Customer Relationships": "Class VI",
  "Trade Name / Business Name": "Class VI",
  "Licenses & Permits": "Class VI",
  "Goodwill": "Class VII",
};
export function classForCategory(category: string): string {
  return ASSET_ALLOCATION_CLASS[category] || "—";
}

export interface BillOfSaleData {
  clientId: string;
  businessName: string;
  ein?: string | null;
  businessAddress?: string | null;
  sellerName: string;
  sellerTitle?: string | null;
  buyerName: string;
  buyerTitle?: string | null;
  buyerAddress?: string | null;
  effectiveDate?: string | null;
  salePrice?: number | null;
  assetsIncluded?: string | null;
  assetAllocations?: AssetAllocationLine[] | null;
  liabilitiesIncluded?: string | null;
  additionalTerms?: string | null;
}

function fmtDate(v: unknown): string {
  if (!v) return "________________";
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return "________________";
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}
function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "________________";
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

class Cursor {
  constructor(private page: PDFPage, private font: PDFFont, private bold: PDFFont, private top: number) {}
  text(x: number, yFromTop: number, str: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center" } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const safeStr = pdfSafeText(str);
    const width = font.widthOfTextAtSize(safeStr, size);
    const drawX = opts.align === "right" ? x - width : opts.align === "center" ? x - width / 2 : x;
    this.page.drawText(safeStr, { x: drawX, y: this.top - yFromTop, size, font, color: opts.color ?? INK });
  }
  line(x1: number, y1: number, x2: number, y2: number, color = LINE, thickness = 0.75) {
    this.page.drawLine({ start: { x: x1, y: this.top - y1 }, end: { x: x2, y: this.top - y2 }, thickness, color });
  }
  rect(x: number, y: number, w: number, h: number, color = TEAL) {
    this.page.drawRectangle({ x, y: this.top - y - h, width: w, height: h, color });
  }
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

export async function generateBillOfSalePdf(data: BillOfSaleData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const profile: FirmProfile = await getFirmProfile();
  const logo = await embedFirmLogo(doc, profile);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let c = new Cursor(page, font, bold, PAGE_H);
  let y = 48;
  const maxWidth = R - L;

  let pageNum = 1;
  const footer = () => {
    c.text(L, PAGE_H - 28, `${profile.firmName} — Prepared for ${data.businessName} (${data.clientId})`, { size: 7.5, color: MUTED });
    c.text(R, PAGE_H - 28, `Page ${pageNum}`, { size: 7.5, color: MUTED, align: "right" });
  };

  /** Starts a fresh page (continuation header, no logo/price box repeat) and resets y — called whenever the next block wouldn't fit above BOTTOM_MARGIN. */
  const newPage = () => {
    footer();
    pageNum += 1;
    page = doc.addPage([PAGE_W, PAGE_H]);
    c = new Cursor(page, font, bold, PAGE_H);
    c.rect(0, 0, PAGE_W, 6, TEAL);
    y = 40;
    c.text(L, y, `${data.businessName} — Bill of Sale (continued)`, { size: 9, color: MUTED });
    y += 22;
  };
  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_H - BOTTOM_MARGIN) newPage();
  };

  c.rect(0, 0, PAGE_W, 6, TEAL);
  let textL = L;
  if (logo) {
    const logoH = 30;
    const logoW = (logo.width / logo.height) * logoH;
    page.drawImage(logo, { x: L, y: PAGE_H - y - logoH + 6, width: logoW, height: logoH });
    textL = L + logoW + 10;
  }
  c.text(textL, y, profile.firmName.toUpperCase(), { size: 14, bold: true, color: TEAL });
  c.text(R, y, "BILL OF SALE", { size: 16, bold: true, align: "right" });
  y += 26;
  c.line(L, y, R, y, INK, 1.25);
  y += 20;

  c.rect(L, y, R - L, 44, TEAL_TINT);
  c.text(L + 12, y + 17, `Business: ${data.businessName}${data.ein ? `  (EIN ${data.ein})` : ""}`, { size: 10.5, bold: true });
  c.text(L + 12, y + 33, data.businessAddress || "", { size: 9, color: MUTED });
  c.text(R - 12, y + 17, `Effective Date: ${fmtDate(data.effectiveDate)}`, { size: 9.5, align: "right" });
  c.text(R - 12, y + 33, `Purchase Price: ${fmtMoney(data.salePrice)}`, { size: 9.5, bold: true, color: TEAL, align: "right" });
  y += 62;

  const paragraph = (text: string, size = 9.5) => {
    const rawLines = text.split("\n");
    for (const rawLine of rawLines) {
      const wrapped = wrapText(rawLine, font, size, maxWidth);
      ensureSpace(wrapped.length * 13 + 8);
      for (const w of wrapped) {
        c.text(L, y, w, { size });
        y += 13;
      }
    }
    y += 8;
  };
  const heading = (text: string) => {
    ensureSpace(20);
    c.text(L, y, text, { size: 10.5, bold: true, color: TEAL });
    y += 16;
  };

  heading("1. PARTIES");
  paragraph(
    `This Bill of Sale is made effective as of ${fmtDate(data.effectiveDate)}, by and between ` +
    `${data.sellerName}${data.sellerTitle ? `, ${data.sellerTitle}` : ""} ("Seller") and ` +
    `${data.buyerName}${data.buyerTitle ? `, ${data.buyerTitle}` : ""}${data.buyerAddress ? `, of ${data.buyerAddress}` : ""} ("Buyer"), ` +
    `regarding the ownership interest in ${data.businessName} (the "Business").`
  );

  heading("2. SALE OF OWNERSHIP INTEREST");
  paragraph(
    `For and in consideration of ${fmtMoney(data.salePrice)}, and other good and valuable consideration, the receipt and ` +
    `sufficiency of which is hereby acknowledged, Seller does hereby sell, transfer, assign, and convey to Buyer all of ` +
    `Seller's right, title, and interest in and to the Business, effective as of the date above.`
  );

  const allocations = (data.assetAllocations || []).filter((a) => a && a.category && Number.isFinite(a.amount) && a.amount > 0);

  heading("3. ASSETS INCLUDED" + (allocations.length > 0 ? " — ALLOCATION OF PURCHASE PRICE" : ""));
  if (allocations.length > 0) {
    paragraph(
      "The Purchase Price is allocated among the assets of the Business as follows, for purposes of IRC Section 1060 " +
      "and each party's Form 8594 (Asset Acquisition Statement):",
      9
    );
    const colCat = L, colDesc = L + 150, colClass = R - 100, colAmt = R;
    ensureSpace(22);
    c.text(colCat, y, "Category", { size: 8, bold: true, color: MUTED });
    c.text(colDesc, y, "Description", { size: 8, bold: true, color: MUTED });
    c.text(colClass, y, "Form 8594 Class", { size: 8, bold: true, color: MUTED, align: "right" });
    c.text(colAmt, y, "Amount", { size: 8, bold: true, color: MUTED, align: "right" });
    y += 6;
    c.line(L, y, R, y, INK, 0.75);
    y += 14;
    let total = 0;
    for (const a of allocations) {
      const descWrapped = wrapText(a.description || "", font, 9, colClass - colDesc - 10);
      const rowLines = Math.max(1, descWrapped.length);
      ensureSpace(rowLines * 12 + 4);
      c.text(colCat, y, a.category.slice(0, 26), { size: 9 });
      c.text(colClass, y, classForCategory(a.category), { size: 9, align: "right" });
      c.text(colAmt, y, fmtMoney(a.amount), { size: 9, align: "right" });
      if (descWrapped.length && descWrapped[0]) c.text(colDesc, y, descWrapped[0], { size: 9, color: MUTED });
      for (let i = 1; i < descWrapped.length; i++) {
        y += 12;
        c.text(colDesc, y, descWrapped[i], { size: 9, color: MUTED });
      }
      total += a.amount;
      y += 14;
    }
    y += 2;
    ensureSpace(20);
    c.line(L, y, R, y, INK, 1);
    y += 14;
    c.text(colCat, y, "Total Allocated Purchase Price", { size: 9.5, bold: true });
    c.text(colAmt, y, fmtMoney(total), { size: 9.5, bold: true, color: TEAL, align: "right" });
    y += 22;
  } else {
    paragraph(data.assetsIncluded?.trim() || "No specific assets were itemized for this transfer beyond the ownership interest described in Section 2.");
  }

  heading("4. LIABILITIES");
  paragraph(data.liabilitiesIncluded?.trim() || "No liabilities were itemized as assumed by Buyer as part of this transfer; the parties should confirm the treatment of any outstanding business debts, leases, or obligations separately.");

  let n = 5;
  if (data.additionalTerms?.trim()) {
    heading(`${n++}. ADDITIONAL CLAUSE(S) / TERMS`);
    paragraph(data.additionalTerms.trim());
  }

  heading(`${n++}. AS-IS; NO WARRANTIES`);
  paragraph(
    "Except as expressly stated in this Bill of Sale, Seller makes no warranties, express or implied, regarding the Business " +
    "being transferred, and Buyer accepts the ownership interest in its current condition. Nothing in this document constitutes " +
    "legal, tax, or accounting advice to either party."
  );

  heading(`${n++}. GOVERNING LAW`);
  paragraph("This Bill of Sale shall be governed by and construed in accordance with the laws of the State of Maryland.");

  // Signature block — keep both parties together, push to a new page rather than split.
  ensureSpace(190);
  y += 12;
  c.line(L, y, R, y, INK, 1);
  y += 22;
  c.text(L, y, "SELLER", { size: 9, bold: true, color: MUTED });
  y += 20;
  c.text(L, y, "Signature: __________________________________", { size: 10 });
  c.text(R, y, "Date: ______________", { size: 10, align: "right" });
  y += 22;
  c.text(L, y, `Print Name: ${data.sellerName}`, { size: 10 });
  y += 36;
  c.text(L, y, "BUYER", { size: 9, bold: true, color: MUTED });
  y += 20;
  c.text(L, y, "Signature: __________________________________", { size: 10 });
  c.text(R, y, "Date: ______________", { size: 10, align: "right" });
  y += 22;
  c.text(L, y, `Print Name: ${data.buyerName}`, { size: 10 });

  footer();

  return doc.save();
}
