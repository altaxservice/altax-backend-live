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

// ---------------------------------------------------------------------------
// The wording of the Bill of Sale — built ONCE here and rendered by both the PDF
// (below) and the Word file (billOfSaleDocx.ts), so the two can never drift apart.
// ---------------------------------------------------------------------------
export type BosBlock =
  | { type: "heading"; text: string }
  | { type: "para"; text: string; bold?: boolean }
  /** The itemized Form 8594 schedule: the renderer draws `intro` and then its own table. */
  | { type: "allocation"; intro: string };

export function bosSubtitle(kind: EntityKind): string {
  return kind === "LLC" ? "(Sale of Business, Including LLC Membership Interest)" : kind === "Corp" ? "(Sale of Business Assets)" : "(Sale of Business Ownership Interest)";
}

/** "Liabilities: None" is a common entry; it must not become the whole section. */
function isNoneAnswer(v: string | null | undefined): boolean {
  return /^(none|no|nil|n\/?a|nothing|0)\.?$/i.test(String(v || "").trim());
}

export function businessLabelFor(data: BillOfSaleData, kind: EntityKind, state: string): string {
  return kind === "LLC"
    ? `${data.businessName}, a ${state} limited liability company`
    : kind === "Corp"
    ? `${data.businessName}, a ${state} corporation`
    : data.businessName;
}

/** Every numbered section of the Bill of Sale, in order, after the "by and between" lines. */
export function buildBillOfSaleBlocks(input: BillOfSaleData): BosBlock[] {
  const data: BillOfSaleData = { ...input, businessAddress: tidyAddress(input.businessAddress) };
  const kind = entityKindFor(data.entityType);
  const state = legalState(data.state);
  const businessLabel = businessLabelFor(data, kind, state);
  const parties = billOfSaleParties(data);
  const isLlc = kind === "LLC";
  const price = fmtMoney(data.salePrice);
  const allocations = (data.assetAllocations || []).filter((a) => a && a.category && Number.isFinite(a.amount) && a.amount > 0);
  const hasExtra = !!data.additionalTerms?.trim();
  const noLiabilityText = isNoneAnswer(data.liabilitiesIncluded) || !data.liabilitiesIncluded?.trim();

  // Section order; each key gets its number so the cross-references below are always right.
  const keys: string[] = [
    "business", "sale", "assets", "excluded", "price", ...(isLlc ? [] : ["tax"]), "licenses", "bulk",
    "liabilities", ...(hasExtra ? ["extra"] : []), "warranties", "asis", "general",
  ];
  const no = (k: string) => keys.indexOf(k) + 1;
  const sec = (k: string, title: string): BosBlock => ({ type: "heading", text: `${no(k)}. ${title}` });
  const P = (text: string, bold = false): BosBlock => ({ type: "para", text, bold });
  const out: BosBlock[] = [];

  // 1
  out.push(sec("business", "PARTIES AND BUSINESS"));
  out.push(P(
    `This Bill of Sale concerns the business known as ${data.businessName}` +
    `${data.businessAddress ? `, operated at ${data.businessAddress}` : ""}${data.ein ? ` (EIN ${data.ein})` : ""} (the "Business"). ` +
    `The date written at the top of this Bill of Sale is the "Effective Date", except as Section ${no("bulk")} moves it.`
  ));

  // 2
  if (isLlc) {
    out.push(sec("sale", "SALE OF MEMBERSHIP INTEREST"));
    out.push(P(
      `For and in consideration of the Purchase Price in Section ${no("price")}, the sufficiency of which is hereby acknowledged, ` +
      `Seller sells, assigns, transfers and conveys to Buyer, and Buyer's successors and assigns, all of Seller's right, ` +
      `title and interest in and to ${businessLabel} (the "Company"), including one hundred percent (100%) of the membership interest in the ` +
      `Company (the "Interest"). Seller also sells to Buyer any asset used in the Business that Seller owns personally. The assets that the Company owns ` +
      `and uses in the Business, together with any asset Seller owns personally, are described in Section ${no("assets")} (the "Assets"). ` +
      `The Company's own assets stay the Company's property; Buyer acquires them by acquiring the Interest. ${llcClosingSentence(data)}`
    ));
    out.push(P(
      `${parties.sellers.length > 1 ? "The Sellers state that together they are all of the members of the Company and, with" : "Seller states that Seller is the only member of the Company and, with"} this signature, ` +
      `${parties.sellers.length > 1 ? "consent" : "consents"} to ${parties.buyers.length > 1 ? "each Buyer" : "Buyer"} being admitted as a member of the Company on the Effective Date. ` +
      `The parties state that this sale and admission are permitted by the Company's operating agreement or approved by all of its members ` +
      `(Corporations and Associations Article, Section 4A-604). They will sign any consent or amendment to the operating agreement that the Company needs to show the new ownership.`
    ));
  } else if (kind === "Corp") {
    out.push(sec("sale", "SALE OF BUSINESS ASSETS"));
    out.push(P(
      `For and in consideration of the Purchase Price in Section ${no("price")}, the sufficiency of which is hereby acknowledged, ` +
      `Seller (${businessLabel}) sells, transfers, conveys and delivers to Buyer all of Seller's right, title and interest in and to the ` +
      `assets of the Business described in Section ${no("assets")} (collectively, the "Assets"). Seller states that the sale has been approved as ` +
      `its charter, its bylaws and Maryland law require (for a sale of all or substantially all of its assets that usually means its board of directors and its stockholders).`
    ));
  } else {
    out.push(sec("sale", "SALE OF OWNERSHIP INTEREST"));
    out.push(P(
      `For and in consideration of the Purchase Price in Section ${no("price")}, and other good and valuable consideration, the receipt and ` +
      `sufficiency of which is hereby acknowledged, Seller sells, transfers, assigns and conveys to Buyer all of ` +
      `Seller's right, title and interest in and to the Business, including the assets described in Section ${no("assets")} (collectively, the "Assets"). ` +
      `If Seller is a partnership, Seller states that all of the partners have approved this sale.`
    ));
  }

  // 3
  out.push(sec("assets", "ASSETS INCLUDED" + (allocations.length > 0 ? " — ALLOCATION OF PURCHASE PRICE" : "")));
  if (allocations.length > 0) {
    out.push({
      type: "allocation",
      intro: "The Purchase Price is allocated among the assets of the Business as follows, for purposes of IRC Section 1060 and each party's Form 8594 (Asset Acquisition Statement). " +
        "Each party will report the sale consistently with this allocation unless the law requires otherwise:",
    });
  } else {
    out.push(P(data.assetsIncluded?.trim() || "No specific assets were itemized for this transfer beyond the ownership interest described above; the parties should attach a schedule of included assets if one exists."));
  }
  out.push(P(
    "If the Purchase Price depends on an inventory count, the parties will count the inventory together on or just before the Effective Date, both will sign the count, and the signed count is part of this Bill of Sale."
  ));

  // 4
  out.push(sec("excluded", isLlc ? "WHAT STAYS WITH THE COMPANY; REAL ESTATE AND VEHICLES" : "ITEMS NOT INCLUDED; REAL ESTATE AND VEHICLES"));
  if (isLlc) {
    out.push(P(
      "The Company keeps its cash, bank accounts, accounts receivable, tax refunds, licenses, permits, tax registrations, lease and contracts, unless the parties agree in writing to take any of them out of the Company before the Effective Date. " +
      "This Bill of Sale does not transfer any land or building out of the Company. A motor vehicle titled in the Company's name stays titled in the Company's name."
    ));
  } else {
    out.push(P(
      "Unless listed in Section " + no("assets") + ", the Assets do not include cash, bank accounts, accounts receivable, tax refunds, lottery tickets or lottery sales money, or Seller's personal items. " +
      "This Bill of Sale does not transfer any land, building or lease: a deed or a lease assignment (signed by the right parties, and with the landlord's consent if the lease requires it) is a separate paper."
    ));
  }
  out.push(P(
    "This Bill of Sale does not by itself transfer a motor vehicle. A vehicle needs its own signed title assignment and odometer statement filed with the Maryland Motor Vehicle Administration, and the parties will complete them at the same time."
  ));

  // 5
  out.push(sec("price", "PURCHASE PRICE AND PAYMENT"));
  out.push(P(
    `The total purchase price for ${isLlc ? "the Interest and the Assets" : "the Assets"} is ${price} (the "Purchase Price"). Buyer pays it to Seller on the Effective Date in cash, by cashier's check or by bank transfer, ` +
    `unless the parties have signed a different written payment schedule. Seller acknowledges receipt of the part of the Purchase Price paid on or before the Effective Date. ` +
    `Any unpaid balance is owed under that written schedule; this Bill of Sale does not by itself give Seller a security interest in the Assets, and it does not give Buyer more time to pay than the schedule allows.`
  ));

  // 6 (asset sales only)
  if (!isLlc) {
    out.push(sec("tax", "SALES AND USE TAX"));
    out.push(P(
      "Maryland sales and use tax may be due on the part of the Purchase Price that is for tangible personal property such as equipment, furniture, fixtures and display cases (Tax-General Article, Title 11). " +
      "Unless the parties agree otherwise in writing, Buyer is responsible for the tax on its purchase and pays it either to Seller (who pays it over) or directly to the Comptroller of Maryland, in the way the Comptroller requires. " +
      "Tax is not due on goodwill and other intangible assets, and inventory that Buyer will resell in the form it receives is not taxed when Buyer gives Seller a signed resale certificate. " +
      "The parties use the allocation in Section " + no("assets") + " (or, if there is none, a schedule they both sign) for this purpose."
    ));
  }

  // licenses
  out.push(sec("licenses", "LICENSES, PERMITS AND RESTRICTED PRODUCTS"));
  if (isLlc) {
    out.push(P(
      "The Company keeps its own licenses, permits and tax registrations, and this Bill of Sale does not assign any of them. A change of owners, members or responsible party must be reported to each issuing agency as that agency requires, and some changes need a new application or approval " +
      "(for example, a Maryland Lottery license ends on a change of ownership and an alcoholic beverage license needs the licensing board's approval). " +
      "Seller will not hand over cigarettes, tobacco products, vapor products, alcoholic beverages or lottery tickets to a person who does not hold the license needed for them."
    ));
  } else {
    out.push(P(
      "This is a sale of assets only. No license, permit or tax registration of Seller is transferred, including tobacco, alcohol, lottery, SNAP/EBT, health and sales-tax registrations; Buyer applies for its own in Buyer's own name. " +
      "A tobacco or vapor retail license cannot be assigned, a change of ownership ends a Maryland Lottery license, an alcoholic beverage license moves only with the licensing board's approval and a bulk transfer permit, " +
      "and a SNAP authorization, a health permit and a sales-tax license do not transfer. A trader's license can move with the stock-in-trade and the place of business. " +
      "Seller will not hand over cigarettes, tobacco products, vapor products, alcoholic beverages or lottery tickets before Buyer holds the license needed for them, and Seller stays responsible for lottery tickets, equipment and sales money until the Lottery approves a new license."
    ));
  }

  // bulk transfer
  out.push(sec("bulk", isLlc ? "BULK-TRANSFER LAW" : "BULK-TRANSFER NOTICE, TAX HOLDBACK AND CLOSING DATE"));
  if (isLlc) {
    out.push(P(
      "The Company keeps its own inventory and assets, so this sale of the Interest does not itself transfer the Company's inventory. " +
      "If a major part of the Company's inventory, or an asset or inventory that Seller owns personally, is moved to Buyer or to another person, Maryland's bulk-transfer law (Commercial Law Article, Title 6, and Tax-General Article, Sections 11-505 and 13-802) applies and the parties will follow it."
    ));
  } else {
    out.push(P(
      "If this sale transfers a major part of the inventory of a business whose principal business is selling goods from stock (a store, deli, restaurant or seller of alcoholic beverages), it is a bulk transfer under Maryland law " +
      "(Commercial Law Article, Section 6-102). If the law is not followed, the transfer is ineffective against Seller's creditors, and Buyer can be personally liable to the State for Seller's unpaid sales and use tax (Tax-General Article, Section 13-802). " +
      "The parties will follow it whether or not they are sure it applies:"
    ));
    out.push(P(
      "(a) Seller gives Buyer a list of all of its creditors, signed and sworn to or affirmed, with their names, business addresses and the amounts owed when known, and the names of everyone Seller knows asserts a claim against it, even if disputed. Seller is responsible for the list being complete and accurate. " +
      "(b) The list of Assets in this Bill of Sale (or a schedule the parties attach) is the schedule of the property. Buyer keeps the list and the schedule for six months after the transfer and lets any creditor inspect and copy them, or files them with the clerk of the circuit court. " +
      "(c) At least 10 days before Buyer takes possession or pays, whichever is first, Buyer delivers in person or sends by registered or certified mail a notice of the transfer to the Comptroller of Maryland (whether or not Seller lists the Comptroller as a creditor), to the creditors on Seller's list, and to everyone else Buyer knows holds or asserts a claim against Seller " +
      "(Commercial Law Article, Sections 6-105 and 6-107; Tax-General Article, Section 11-505). " +
      "(d) Buyer applies the Purchase Price, as far as needed, to the debts on the list or filed in writing at the address in the notice within 30 days after it was mailed, holds back a disputed amount until the dispute is settled, and pays creditors in proportion if the price is not enough (Section 6-106). " +
      "If the Comptroller files a claim for Seller's unpaid sales and use tax, Buyer withholds the amount of the claim from what it pays Seller and pays it to the Comptroller (Section 11-505(c)). " +
      "(e) Seller will ask the Comptroller for a written statement of the status of its sales and use tax account and give Buyer a copy."
    ));
    out.push(P(
      "If the notice in paragraph (c) has not been delivered or mailed at least 10 days before the Effective Date written at the top of this Bill of Sale, the Effective Date moves to the 10th day after the notice is delivered or mailed. " +
      "Until then Buyer does not take possession of the Assets or pay for them, ownership does not pass, and Seller keeps the Assets and runs the Business at its own risk."
    ));
    out.push(P(
      "Employees and unemployment insurance: a person who acquires a business or a substantial part of its assets gives the Maryland Department of Labor written notice by certified mail, return receipt requested, at least 10 days before the acquisition. " +
      "If Buyer does not, and Seller owes unpaid unemployment insurance contributions, the acquisition is void as to the Secretary of Labor (Labor and Employment Article, Section 8-633). Buyer will give the notice."
    ));
  }

  // liabilities
  out.push(sec("liabilities", "LIABILITIES"));
  const payClause = `Each party will pay what it is responsible for, and will reimburse the other for losses caused by not paying it, after written notice from the other and a reasonable chance to pay or contest the claim.`;
  if (isLlc) {
    out.push(P(noLiabilityText
      ? `The Company remains responsible to its creditors for its own debts. As between the parties, Seller is responsible for the debts, taxes and obligations of the Company that arose before the Effective Date and that Seller did not disclose to Buyer in writing ` +
        `(including sales and use tax, withholding tax and tobacco or alcohol tax for periods before the Effective Date); Buyer is responsible for the debts the Company incurs after the Effective Date and for those Seller disclosed in writing. ${payClause}`
      : `The Company remains responsible to its creditors for its own debts. These debts, leases and obligations were disclosed to Buyer and stay with the Company, and Buyer is responsible for them as the Company's owner: ${data.liabilitiesIncluded!.trim()} ` +
        `As between the parties, Seller is responsible for the debts, taxes and obligations of the Company that arose before the Effective Date and that Seller did not disclose to Buyer in writing. ${payClause}`
    ));
  } else {
    out.push(P(noLiabilityText
      ? `Buyer takes on none of Seller's debts. Seller remains responsible for the debts, taxes and obligations of Seller or the Business that arose before the Effective Date ` +
        `(including sales and use tax, withholding tax and tobacco or alcohol tax for periods before the Effective Date), except any that the parties list in writing as taken on by Buyer. ${payClause}`
      : `Buyer takes on the following debts, leases and obligations of the Business, and no others: ${data.liabilitiesIncluded!.trim()} ` +
        `Seller remains responsible for all other debts, taxes and obligations of Seller or the Business that arose before the Effective Date. ${payClause}`
    ));
  }

  if (hasExtra) {
    out.push(sec("extra", "ADDITIONAL CLAUSE(S) / TERMS"));
    for (const para of data.additionalTerms!.trim().split(/\n+/)) out.push(P(para));
    out.push(P("If a term above conflicts with a printed term of this Bill of Sale, the term above controls."));
  }

  // warranties
  out.push(sec("warranties", "WARRANTIES"));
  out.push(P(
    `Seller states and warrants that: (a) Seller is the lawful owner of ${isLlc ? "the Interest and the Assets it sells" : "the Assets it sells"}, and has full right, power and authority to sell and transfer them (and, if Seller is a company, ` +
    `all approvals its governing documents and the law require for this sale have been obtained); (b) they are free and clear of all liens, security interests, encumbrances and claims of any kind, except as disclosed to Buyer in writing; ` +
    `(c) Seller will warrant and defend title to them against the lawful claims and demands of all persons; and (d) to Seller's knowledge, the written information Seller gave Buyer about the Business, its inventory and its debts is true and not misleading.`
  ));
  out.push(P(
    "Buyer states that Buyer has looked at the Assets and the Business records as fully as it wished, has the money to pay the Purchase Price, and, if Buyer is a company, is authorized to sign and carry out this Bill of Sale."
  ));

  // as-is, conspicuous
  out.push(sec("asis", "CONDITION OF ASSETS — AS IS"));
  out.push(P(
    `EXCEPT FOR THE WARRANTIES IN SECTION ${no("warranties")}, THE ${isLlc ? "INTEREST AND THE ASSETS ARE" : "ASSETS ARE"} SOLD "AS IS, WHERE IS." SELLER MAKES NO OTHER WARRANTY, EXPRESS OR IMPLIED, ` +
    `INCLUDING ANY WARRANTY OF MERCHANTABILITY OR OF FITNESS FOR A PARTICULAR PURPOSE.`,
    true
  ));

  // general
  out.push(sec("general", "GENERAL PROVISIONS"));
  out.push(P(
    "Each party agrees to sign any additional documents and to take any further actions reasonably necessary to carry out this Bill of Sale. " +
    `This Bill of Sale is governed by the laws of ${stateClause(state)}. It may be signed in counterparts, and each is an original. If any term cannot be enforced, the rest stays in force. ` +
    "It binds and benefits the parties and their respective heirs, successors and assigns."
  ));
  out.push(P(
    "This is a standard form completed from information the parties supplied. No one who helped prepare it is acting as an attorney for either party or gives legal, tax or accounting advice to either party about it, " +
    "and each party is free to have a lawyer review it before signing."
  ));
  return out;
}

/** The notary's "I HEREBY CERTIFY" paragraph — shared by the PDF and Word versions. */
export function bosNotaryCertificate(data: BillOfSaleData): string {
  const kind = entityKindFor(data.entityType);
  const state = legalState(data.state);
  const parties = billOfSaleParties(data);
  const names = joinNames([...parties.sellers, ...parties.buyers].map((p) => p.name)) || "____________________";
  return `I HEREBY CERTIFY that on this ______ day of ______________, 20____, before me, the undersigned Notary Public ` +
    `of ${stateClause(state)}, personally appeared ${names}, known to me (or satisfactorily proven) to be the persons whose names are ` +
    `subscribed to the foregoing Bill of Sale, and acknowledged that they executed the same for the purposes therein contained` +
    `${kind === "Corp" ? `; and, as to ${data.businessName}, acknowledged that as its officer, being authorized to do so, he or she executed it on behalf of the corporation` : ""}.`;
}

export function bosWitnessLine(): string {
  return "A witness and a notary are optional. Use the lines below if a lender, the Motor Vehicle Administration or a licensing office asks for them.";
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
  const businessLabel = businessLabelFor(data, kind, state);
  c.text(L, y, bosSubtitle(kind), { size: 8.5, color: MUTED });
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
  const paragraph = (text: string, size = 9.5, isBold = false) => {
    const f = isBold ? bold : font;
    const rawLines = text.split("\n");
    if (pendingHeading !== null) {
      const first = wrapText(rawLines[0], f, size, maxWidth);
      ensureSpace(16 + first.length * 13 + 8);
      c.text(L, y, pendingHeading, { size: 10.5, bold: true, color: TEAL });
      y += 16;
      pendingHeading = null;
    }
    for (const rawLine of rawLines) {
      const wrapped = wrapText(rawLine, f, size, maxWidth);
      ensureSpace(wrapped.length * 13 + 8);
      for (const w of wrapped) {
        c.text(L, y, w, { size, bold: isBold });
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

  const allocations = (data.assetAllocations || []).filter((a) => a && a.category && Number.isFinite(a.amount) && a.amount > 0);
  for (const block of buildBillOfSaleBlocks(data)) {
    if (block.type === "heading") { heading(block.text); continue; }
    if (block.type === "para") { paragraph(block.text, 9.5, !!block.bold); continue; }
    // Itemized Form 8594 allocation schedule
    paragraph(block.intro, 9);
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
  }

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

  // Optional witness line.
  ensureSpace(110);
  y += 30;
  paragraph(bosWitnessLine(), 8.5);
  c.text(L, y, "Witness (optional): ______________________________", { size: 10 });
  c.text(R, y, "Date: ______________", { size: 10, align: "right" });
  y += 20;
  c.text(L, y, "Print Name: ______________________________", { size: 10 });
  y += 8;

  // One notary acknowledgment covering all signers together, not a separate
  // notarization per party — same convention as billOfSaleDocx.ts's notaryBlock.
  ensureSpace(290); // the whole acknowledgment, notary lines included, stays on one page
  y += 30;
  heading("Acknowledgment (optional)");
  paragraph(stateCaption(state));
  paragraph("CITY/COUNTY OF ______________________, to wit:");
  paragraph(bosNotaryCertificate(data));
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
