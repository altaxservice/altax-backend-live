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
import { stateDisplayName } from "../../common/stateNames";
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

/** A co-seller or co-buyer beyond the first (the first are `sellerName` / `buyerName`). */
export interface BillOfSaleParty { name: string; title?: string | null; address?: string | null }

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
  /** Additional sellers/buyers on the same sale — the Bill of Sale lists and gets signed by all of them. */
  additionalSellers?: BillOfSaleParty[] | null;
  additionalBuyers?: BillOfSaleParty[] | null;
  effectiveDate?: string | null;
  salePrice?: number | null;
  assetsIncluded?: string | null;
  assetAllocations?: AssetAllocationLine[] | null;
  liabilitiesIncluded?: string | null;
  additionalTerms?: string | null;
  /** Drives entity-aware language (LLC membership interest / Corp asset sale / generic ownership interest) — same as billOfSaleDocx.ts, so the PDF and Word outputs of the same transfer say the same thing. */
  entityType?: string | null;
  state?: string | null;
}

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

// ---------------------------------------------------------------------------
// Wording helpers
// ---------------------------------------------------------------------------
const STATE_CODES = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","NW","SW","SE"]);
const KEEP_UPPER = new Set(["CEO", "CFO", "COO", "LLC", "LLP", "PO", "II", "III", "IV"]);

/** A value typed in ALL CAPS ("OWNER", "610 N EUTAW APT B") reads like a form fill-in on a legal document; make it normal case. Mixed-case input is left exactly as typed. */
export function tidyCaps(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (!t) return null;
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase()
    .replace(/(^|[^a-z0-9'])([a-z])/g, (_m, a, b) => a + b.toUpperCase())
    .replace(/\b([A-Za-z]{2,4})\b/g, (w) => (KEEP_UPPER.has(w.toUpperCase()) || STATE_CODES.has(w.toUpperCase()) ? w.toUpperCase() : w))
    .replace(/(\d)(St|Nd|Rd|Th)\b/g, (_m, d, suf) => d + suf.toLowerCase());
}

/** A street address in normal case with "City, ST 12345" punctuation ("BALTIMORE, MD, 21201" -> "Baltimore, MD 21201"). */
export function tidyAddress(v: string | null | undefined): string | null {
  if (v === null || v === undefined || !String(v).trim()) return null;
  const joined = String(v).split(",").map((seg) => tidyCaps(seg) || "").filter(Boolean).join(", ");
  return joined.replace(/,\s*([A-Z]{2}),\s*(\d{5}(?:-\d{4})?)\b/g, ", $1 $2");
}

/** "Maryland" for "MD"; a full name stays as is. */
export function legalState(state: string | null | undefined): string {
  const raw = String(state || "").trim();
  return stateDisplayName(raw) ?? (raw || "Maryland");
}
/** "the State of Maryland" / "the District of Columbia". */
export function stateClause(state: string): string {
  return state === "District of Columbia" ? "the District of Columbia" : `the State of ${state}`;
}
/** "STATE OF MARYLAND" caption above a notary acknowledgment. */
export function stateCaption(state: string): string {
  return state === "District of Columbia" ? "DISTRICT OF COLUMBIA" : `STATE OF ${state.toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Several sellers and/or buyers — shared by the PDF and Word versions so both
// say the same thing. "Seller" and "Buyer" stay the defined terms; with more
// than one person each means all of them, individually and together.
// ---------------------------------------------------------------------------
export function billOfSaleParties(data: BillOfSaleData): { sellers: BillOfSaleParty[]; buyers: BillOfSaleParty[] } {
  const clean = (list?: BillOfSaleParty[] | null) => (list || []).filter((p) => p && String(p.name || "").trim());
  return {
    sellers: [{ name: data.sellerName, title: data.sellerTitle }, ...clean(data.additionalSellers)].map((p) => ({ ...p, title: tidyCaps(p.title) })),
    buyers: [{ name: data.buyerName, title: data.buyerTitle, address: data.buyerAddress }, ...clean(data.additionalBuyers)].map((p) => ({ ...p, title: tidyCaps(p.title), address: tidyAddress(p.address) })),
  };
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]}; and ${items[1]}`;
  return `${items.slice(0, -1).join("; ")}; and ${items[items.length - 1]}`;
}

/** "A, B and C" — for the notary acknowledgment. */
export function joinNames(names: string[]): string {
  const n = names.map((x) => String(x || "").trim()).filter(Boolean);
  if (n.length <= 1) return n[0] || "";
  return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

const COLLECTIVE = ", which term means each of them individually and all of them together";

export function describeSellers(data: BillOfSaleData, kind: string, businessLabel: string): string {
  const { sellers } = billOfSaleParties(data);
  const plural = sellers.length > 1;
  if (kind === "Corp") {
    const items = sellers.map((p) => `${p.name}${p.title ? `, its ${p.title}` : ", its authorized officer"}`);
    return `${joinList(items)}, on behalf of ${businessLabel} ("Seller")`;
  }
  const items = sellers.map((p) => `${p.name}${p.title ? `, ${p.title}` : ""}`);
  // A title that already says "Owner"/"Member" makes a trailing ", owner of …" redundant.
  const titled = sellers.every((p) => /owner|member/i.test(p.title || ""));
  return `${joinList(items)} ("Seller"${plural ? COLLECTIVE : ""})${kind === "LLC" && !titled ? `, ${plural ? "owners" : "owner"} of ${businessLabel}` : ""}`;
}

export function describeBuyers(data: BillOfSaleData): string {
  const { buyers } = billOfSaleParties(data);
  const items = buyers.map((p) => `${p.name}${p.title ? `, ${p.title}` : ""}${p.address ? `, of ${p.address}` : ""}`);
  return `${joinList(items)} ("Buyer"${buyers.length > 1 ? COLLECTIVE : ""})`;
}

/** Closing sentence of the LLC membership-interest section. */
export function llcClosingSentence(data: BillOfSaleData): string {
  const { sellers, buyers } = billOfSaleParties(data);
  return `Upon execution of this Bill of Sale, ${buyers.length > 1
    ? "the persons named as Buyer shall together be the sole members of the Company, holding the membership interest in the proportions they have agreed among themselves"
    : "Buyer shall be the sole member of the Company"}, and ${sellers.length > 1 ? "each person named as Seller withdraws as a member" : "Seller withdraws as a member"}.`;
}

export async function generateBillOfSalePdf(input: BillOfSaleData): Promise<Uint8Array> {
  const data: BillOfSaleData = { ...input, businessAddress: tidyAddress(input.businessAddress) };
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let c = new Cursor(page, font, bold, PAGE_H);
  let y = 48;
  const maxWidth = R - L;

  let pageNum = 1;
  const footer = () => {
    c.text(L, PAGE_H - 28, `${data.businessName} — Bill of Sale`, { size: 7.5, color: MUTED });
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

  // The agreement is between the parties: it carries no preparer branding (no firm name, logo, or "prepared by" line).
  c.rect(0, 0, PAGE_W, 6, TEAL);
  c.text(L, y, "BILL OF SALE", { size: 16, bold: true });
  y += 15;
  const kind = entityKindFor(data.entityType);
  const state = legalState(data.state);
  const businessLabel = kind === "LLC"
    ? `${data.businessName}, a ${state} limited liability company`
    : kind === "Corp"
    ? `${data.businessName}, a ${state} corporation`
    : data.businessName;
  c.text(L, y, kind === "LLC" ? "(Sale of Business, Including LLC Membership Interest)" : kind === "Corp" ? "(Sale of Business Assets)" : "(Sale of Business Ownership Interest)", { size: 8.5, color: MUTED });
  y += 11;
  c.line(L, y, R, y, INK, 1.25);
  y += 20;

  c.rect(L, y, R - L, 44, TEAL_TINT);
  c.text(L + 12, y + 17, `Business: ${data.businessName}${data.ein ? `  (EIN ${data.ein})` : ""}`, { size: 10.5, bold: true });
  c.text(L + 12, y + 33, data.businessAddress || "", { size: 9, color: MUTED });
  c.text(R - 12, y + 17, `Effective Date: ${fmtDate(data.effectiveDate)}`, { size: 9.5, align: "right" });
  c.text(R - 12, y + 33, `Purchase Price: ${fmtMoney(data.salePrice)}`, { size: 9.5, bold: true, color: TEAL, align: "right" });
  y += 62;

  // A heading is drawn together with the first paragraph under it, so it can never end a page on its own.
  let pendingHeading: string | null = null;
  const paragraph = (text: string, size = 9.5) => {
    const rawLines = text.split("\n");
    if (pendingHeading !== null) {
      const first = wrapText(rawLines[0], font, size, maxWidth);
      ensureSpace(16 + first.length * 13 + 8);
      c.text(L, y, pendingHeading, { size: 10.5, bold: true, color: TEAL });
      y += 16;
      pendingHeading = null;
    }
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
    pendingHeading = text;
  };

  const parties = billOfSaleParties(data);
  const sellerDesc = describeSellers(data, kind, businessLabel);
  const buyerDesc = describeBuyers(data);
  paragraph(`This Bill of Sale is made and entered into as of ${fmtDate(data.effectiveDate)}, by and between:`);
  paragraph(`${parties.sellers.length > 1 ? "SELLERS" : "SELLER"}: ${sellerDesc}; and`);
  paragraph(`${parties.buyers.length > 1 ? "BUYERS" : "BUYER"}: ${buyerDesc}.`);

  let n = 1;
  heading(`${n++}. PARTIES AND BUSINESS`);
  paragraph(
    `This Bill of Sale concerns the business known as ${data.businessName}` +
    `${data.businessAddress ? `, operated at ${data.businessAddress}` : ""}${data.ein ? ` (EIN ${data.ein})` : ""} (the "Business").`
  );

  if (kind === "LLC") {
    heading(`${n++}. SALE OF MEMBERSHIP INTEREST`);
    paragraph(
      `For and in consideration of ${fmtMoney(data.salePrice)}, the sufficiency of which is hereby acknowledged and which is payable as provided in the "Purchase Price and Payment" section below, ` +
      `Seller does hereby sell, assign, transfer, and convey to Buyer, and Buyer's successors and assigns, all of Seller's right, ` +
      `title, and interest in and to ${businessLabel}, including one hundred percent (100%) of the membership interest in the ` +
      `Company, together with all of the assets of the Business described in Section 3 below (collectively, the "Assets"). ${llcClosingSentence(data)}`
    );
  } else if (kind === "Corp") {
    heading(`${n++}. SALE OF BUSINESS ASSETS`);
    paragraph(
      `For and in consideration of ${fmtMoney(data.salePrice)}, the sufficiency of which is hereby acknowledged and which is payable as provided in the "Purchase Price and Payment" section below, ` +
      `Seller does hereby sell, transfer, convey, and deliver to Buyer all of Seller's right, title, and interest in and to ` +
      `${businessLabel}, including the assets described in Section 3 below (collectively, the "Assets").`
    );
  } else {
    heading(`${n++}. SALE OF OWNERSHIP INTEREST`);
    paragraph(
      `For and in consideration of ${fmtMoney(data.salePrice)}, and other good and valuable consideration, the receipt and ` +
      `sufficiency of which is hereby acknowledged, Seller does hereby sell, transfer, assign, and convey to Buyer all of ` +
      `Seller's right, title, and interest in and to the Business, including the assets described in Section 3 below (collectively, the "Assets"), effective as of the date above.`
    );
  }

  const allocations = (data.assetAllocations || []).filter((a) => a && a.category && Number.isFinite(a.amount) && a.amount > 0);

  heading(`${n++}. ASSETS INCLUDED` + (allocations.length > 0 ? " — ALLOCATION OF PURCHASE PRICE" : ""));
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
    paragraph(data.assetsIncluded?.trim() || "No specific assets were itemized for this transfer beyond the ownership interest described above; the parties should attach a schedule of included assets if one exists.");
  }

  heading(`${n++}. PURCHASE PRICE AND PAYMENT`);
  paragraph(
    `The total purchase price for ${kind === "LLC" ? "the membership interest and the Assets" : "the Assets"} is ${fmtMoney(data.salePrice)}, payable by Buyer to Seller as agreed between the ` +
    `parties. Seller acknowledges receipt of the purchase price upon payment in full.`
  );

  heading(`${n++}. LIABILITIES`);
  paragraph(data.liabilitiesIncluded?.trim() || "Seller remains solely responsible for, and shall indemnify and hold Buyer harmless from, any debts, obligations, or liabilities of the Seller or of the Business arising prior to the effective date of this Bill of Sale, unless otherwise agreed in writing by the parties.");

  if (data.additionalTerms?.trim()) {
    heading(`${n++}. ADDITIONAL CLAUSE(S) / TERMS`);
    paragraph(data.additionalTerms.trim());
  }

  heading(`${n++}. SELLER'S WARRANTIES`);
  paragraph(
    `Seller warrants and represents that: (a) Seller is the lawful owner of the ownership interest and the Assets, and has ` +
    `full right, power, and authority to sell and transfer the same; (b) the ownership interest and the Assets are free and ` +
    `clear of all liens, security interests, encumbrances, and claims of any kind, except as disclosed to Buyer in writing; ` +
    `and (c) Seller will warrant and defend title to the ownership interest and the Assets against the lawful claims and ` +
    `demands of all persons.`
  );

  heading(`${n++}. CONDITION OF ASSETS`);
  paragraph(
    `Except for the warranty of title set forth above, the Assets are sold in their present condition, "AS IS, WHERE IS," ` +
    `and Seller makes no other warranty, express or implied, including any warranty of merchantability or fitness for a ` +
    `particular purpose.`
  );

  heading(`${n++}. FURTHER ASSURANCES`);
  paragraph(
    "Each party agrees to execute and deliver any additional documents and to take any further actions reasonably " +
    "necessary to carry out the intent of this Bill of Sale."
  );

  heading(`${n++}. GOVERNING LAW`);
  paragraph(`This Bill of Sale shall be governed by and construed in accordance with the laws of ${stateClause(state)}.`);

  heading(`${n++}. BINDING EFFECT`);
  paragraph(
    "This Bill of Sale shall be binding upon and shall inure to the benefit of the parties and their respective heirs, " +
    "successors, and assigns. Nothing in this document constitutes legal, tax, or accounting advice to either party."
  );

  // The closing sentence travels with the first signature block instead of ending a page on its own.
  ensureSpace(240);
  paragraph("IN WITNESS WHEREOF, the parties have executed this Bill of Sale as of the date first written above.");

  // Signature block — every seller and every buyer signs; keep each party's block whole and push to a new page rather than split.
  ensureSpace(190);
  y += 12;
  c.line(L, y, R, y, INK, 1);
  y += 22;
  const signers: { role: "SELLER" | "BUYER"; party: BillOfSaleParty; label: string }[] = [
    ...parties.sellers.map((party, i) => ({ role: "SELLER" as const, party, label: parties.sellers.length > 1 ? `SELLER ${i + 1}` : "SELLER" })),
    ...parties.buyers.map((party, i) => ({ role: "BUYER" as const, party, label: parties.buyers.length > 1 ? `BUYER ${i + 1}` : "BUYER" })),
  ];
  signers.forEach((sg, idx) => {
    if (idx > 0) { ensureSpace(90); y += 36; }
    const corpSeller = kind === "Corp" && sg.role === "SELLER";
    c.text(L, y, corpSeller ? `${sg.label}: ${data.businessName}` : sg.label, { size: 9, bold: true, color: MUTED });
    y += 20;
    c.text(L, y, "Signature: __________________________________", { size: 10 });
    c.text(R, y, "Date: ______________", { size: 10, align: "right" });
    y += 22;
    c.text(L, y, corpSeller ? `By: ${sg.party.name}, ${sg.party.title || "Authorized Officer"}` : `Print Name: ${sg.party.name}`, { size: 10 });
  });

  // One notary acknowledgment covering both signers together, not a separate
  // notarization per party — same convention as billOfSaleDocx.ts's notaryBlock.
  ensureSpace(290); // the whole acknowledgment, notary lines included, stays on one page
  y += 30;
  heading("Acknowledgment");
  paragraph(stateCaption(state));
  paragraph("CITY/COUNTY OF ______________________, to wit:");
  paragraph(
    `I HEREBY CERTIFY that on this ______ day of ______________, 20____, before me, the undersigned Notary Public ` +
    `of ${stateClause(state)}, personally appeared ${joinNames([...parties.sellers, ...parties.buyers].map((p) => p.name)) || "____________________"}, known to me (or satisfactorily proven) to be the persons whose names are ` +
    `subscribed to the foregoing Bill of Sale, and acknowledged that they executed the same for the purposes therein contained.`
  );
  paragraph("WITNESS my hand and Notarial Seal.");
  ensureSpace(60);
  y += 10;
  c.line(L, y, L + 220, y, INK, 1);
  y += 16;
  c.text(L, y, "Notary Public", { size: 10 });
  y += 22;
  c.text(L, y, "Printed Name: ____________________________", { size: 10 });
  y += 20;
  c.text(L, y, "My Commission Expires: ___________________", { size: 10 });

  footer();

  return doc.save();
}
