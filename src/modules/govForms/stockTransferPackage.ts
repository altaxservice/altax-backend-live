/**
 * Stock Transfer Package — editable Word (.docx) set for the sale of 100% of a Maryland corporation's stock
 * (change of stockholders), built from an Ownership Transfer's sellers/buyers/price plus the corporation facts
 * captured on the wizard (SDAT ID, stock vs. close corporation, shares, par value, officers, resident agent).
 *
 * A change of stockholders is made by transferring shares — NOT by filing Articles of Amendment (those change the
 * charter itself: name, authorized stock, purpose). The only SDAT filing a stock sale normally needs is the
 * Resolution to Change Principal Office or Resident Agent, when the resident agent changes; this package includes
 * the information for that resolution.
 *
 * Contents, in signing order:
 *   cover/summary, 1 Stock Purchase Agreement (notarized), 2 Stock Power and Assignment (one per seller),
 *   3 Resignation (one per outgoing officer/director), 4 Unanimous Written Consent, 5 Resolution to Change
 *   Resident Agent (only when the agent changes), 6 Stock Transfer Ledger, 7 Closing Checklist (internal).
 *
 * The signed pages (1-6) carry no preparer branding: they are agreements between the parties. The cover says the
 * package was prepared from information the parties supplied and is not legal advice, and the internal checklist
 * (marked "not part of the signed documents") is the only place the firm is named.
 */
import {
  AlignmentType, BorderStyle, Document, Footer, Packer, PageBreak, PageNumber, Paragraph, ShadingType, Table, TableCell,
  TableRow, TabStopType, TextRun, WidthType,
} from "docx";

export interface StockParty {
  name: string;
  address?: string | null;
  /** Shares sold (sellers) or received (buyers). */
  shares: number;
}

export interface StockPackageInput {
  corporationName: string;
  sdatId: string;
  /** "Close" = Maryland close corporation that elected to have no board of directors. */
  corpKind: "Stock" | "Close";
  sharesIssued: number;
  /** Par value per share as typed, e.g. "1" or "0.01". */
  parValue: string;
  taxStatus: "" | "C" | "S";
  ein?: string | null;
  principalOffice: string;
  /** Certificate number(s) being cancelled, as typed. Blank prints a fill-in line. */
  certificateNumbers: string;
  /** Who the stock was first issued to, when that is not the (single) seller — the ledger then shows the earlier transfer too, so the chain of title is complete. */
  originalHolder: string;
  /** When the original holder transferred to the seller, as typed (e.g. "January 2025"). */
  originalHolderTransferDate: string;
  sellers: StockParty[];
  buyers: StockParty[];
  effectiveDate: string | null;
  purchasePrice: number | null;
  paymentTerms: string;
  officers: { president: string; vicePresident: string; secretary: string; treasurer: string };
  /** Directors elected by the new stockholders — ignored for a close corporation without a board. */
  directors: string[];
  residentAgent: { change: boolean; name: string; address: string };
  landlordConsentRequired: "" | "Yes" | "No";
  /** The preparer line for the internal checklist only, e.g. "AL Tax Service, Baltimore, MD · (443) 555-0100". */
  internalFirmLine: string;
}

export interface ShareMove { seller: StockParty; buyer: StockParty; shares: number }

/** Matches sellers' shares to buyers' shares in order, so every Stock Power, the ledger and the consent show the same numbers. */
export function allocateShares(sellers: StockParty[], buyers: StockParty[]): ShareMove[] {
  const remaining = buyers.map((b) => b.shares);
  const moves: ShareMove[] = [];
  for (const seller of sellers) {
    let left = seller.shares;
    for (let i = 0; i < buyers.length && left > 0; i++) {
      const take = Math.min(left, remaining[i]);
      if (take > 0) {
        moves.push({ seller, buyer: buyers[i], shares: take });
        remaining[i] -= take;
        left -= take;
      }
    }
  }
  return moves;
}

/** Returns an error message when the share counts can't support a 100% sale, else null. */
export function validateStockPackage(input: StockPackageInput): string | null {
  if (!input.sdatId.trim()) return "Enter the corporation's SDAT ID.";
  if (!Number.isInteger(input.sharesIssued) || input.sharesIssued <= 0) return "Enter the total shares issued (a whole number).";
  const sold = input.sellers.reduce((s, p) => s + (p.shares || 0), 0);
  const bought = input.buyers.reduce((s, p) => s + (p.shares || 0), 0);
  if (input.sellers.some((p) => !Number.isInteger(p.shares) || p.shares <= 0)) return "Enter the number of shares each seller is selling.";
  if (input.buyers.some((p) => !Number.isInteger(p.shares) || p.shares <= 0)) return "Enter the number of shares each buyer is receiving.";
  if (sold !== input.sharesIssued) return `The sellers' shares add up to ${sold.toLocaleString("en-US")}, but ${input.sharesIssued.toLocaleString("en-US")} shares are issued. This package covers a sale of 100% of the stock — if more than one person was ever listed as an owner, add them as a seller.`;
  if (bought !== sold) return `The buyers' shares add up to ${bought.toLocaleString("en-US")}, but the sellers are selling ${sold.toLocaleString("en-US")}.`;
  return null;
}

// ---------- formatting helpers ----------

const FONT = "Calibri";
const TEAL = "0B6B6B";
const CONTENT_WIDTH = 10080;

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function wordsUnder1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} hundred`); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "")); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(" ");
}
export function numberToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n === 0) return "zero";
  const chunks: [number, string][] = [[1_000_000_000, "billion"], [1_000_000, "million"], [1_000, "thousand"], [1, ""]];
  const out: string[] = [];
  let rest = Math.floor(n);
  for (const [size, label] of chunks) {
    if (rest >= size) {
      const q = Math.floor(rest / size);
      out.push(`${wordsUnder1000(q)}${label ? ` ${label}` : ""}`);
      rest %= size;
    }
  }
  return out.join(" ");
}
const shareCount = (n: number) => `${numberToWords(n)} (${n.toLocaleString("en-US")})`;
const sharesWord = (n: number) => (n === 1 ? "share" : "shares");

function pct(shares: number, total: number): string {
  const v = (shares / total) * 100;
  return `${Number.isInteger(v) ? v : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return "____________________";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "____________________";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "$____________________";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function joinNames(names: string[]): string {
  const n = names.map((x) => x.trim()).filter(Boolean);
  if (n.length <= 1) return n[0] || "";
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  return `${n.slice(0, -1).join(", ")}, and ${n[n.length - 1]}`;
}
/** "A; B; and C" — for party lists whose items already contain commas (names with addresses). */
function joinSemi(items: string[]): string {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]}; and ${items[1]}`;
  return `${items.slice(0, -1).join("; ")}; and ${items[items.length - 1]}`;
}
const BLANK = "____________________";
const orBlank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : BLANK);

// ---------- docx building blocks ----------

const run = (text: string, o: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {}) =>
  new TextRun({ text, font: FONT, size: o.size ?? 21, bold: o.bold, color: o.color, italics: o.italics });

function h1(text: string, sub?: string): Paragraph[] {
  const out = [new Paragraph({
    keepNext: true, spacing: { before: 0, after: 60 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: TEAL, space: 4 } },
    children: [run(text, { bold: true, size: 30, color: TEAL })],
  })];
  if (sub) out.push(new Paragraph({ keepNext: true, spacing: { after: 160 }, children: [run(sub, { size: 19, color: "6B6B6B" })] }));
  return out;
}
const h2 = (text: string) => new Paragraph({ keepNext: true, spacing: { before: 220, after: 80 }, children: [run(text, { bold: true, color: TEAL })] });
const p = (text: string, o: { bold?: boolean; keepNext?: boolean; after?: number; italics?: boolean; size?: number; color?: string } = {}) => new Paragraph({
  keepNext: o.keepNext, keepLines: true, spacing: { after: o.after ?? 150 }, alignment: AlignmentType.JUSTIFIED,
  children: [run(text, { bold: o.bold, italics: o.italics, size: o.size, color: o.color })],
});
const centered = (text: string, o: { bold?: boolean; size?: number } = {}) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [run(text, o)] });
const bullet = (text: string) => new Paragraph({ keepLines: true, spacing: { after: 70 }, indent: { left: 360, hanging: 260 }, children: [run("•  "), run(text)] });
const checkItem = (text: string) => new Paragraph({ keepLines: true, spacing: { after: 70 }, indent: { left: 460, hanging: 460 }, children: [run("[   ]  "), run(text)] });
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

function sigBlock(label: string, printName: string, opts: { title?: string } = {}): Paragraph[] {
  return [
    new Paragraph({ keepNext: true, spacing: { before: 300, after: 20 }, children: [run(label, { bold: true, size: 19, color: "6B6B6B" })] }),
    new Paragraph({ keepNext: true, spacing: { before: 260, after: 30 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "222222", space: 1 } }, children: [run(" ")] }),
    new Paragraph({
      keepNext: true, spacing: { after: 40 }, tabStops: [{ type: TabStopType.LEFT, position: 6400 }],
      children: [run("Signature", { size: 18, color: "6B6B6B" }), run("\tDate: ____________________", { size: 19 })],
    }),
    new Paragraph({ spacing: { after: 120 }, children: [run("Print Name: ", { bold: true }), run(printName), ...(opts.title ? [run(`   (${opts.title})`, { color: "6B6B6B" })] : [])] }),
  ];
}

function cell(text: string, width: number, o: { bold?: boolean; header?: boolean; align?: typeof AlignmentType[keyof typeof AlignmentType]; span?: number } = {}): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA }, columnSpan: o.span,
    shading: o.header ? { type: ShadingType.CLEAR, fill: TEAL } : undefined,
    margins: { top: 50, bottom: 50, left: 90, right: 90 },
    children: [new Paragraph({ alignment: o.align, children: [run(text, { bold: o.bold || o.header, size: o.header ? 18 : 20, color: o.header ? "FFFFFF" : undefined })] })],
  });
}
function grid(headers: string[], rows: string[][], widths: number[], rightCols: number[] = []): Table {
  const total = widths.reduce((a, b) => a + b, 0);
  const scale = CONTENT_WIDTH / total;
  const w = widths.map((x) => Math.round(x * scale));
  return new Table({
    width: { size: w.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: w,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((hd, i) => cell(hd, w[i], { header: true, align: rightCols.includes(i) ? AlignmentType.RIGHT : undefined })) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, w[i], { align: rightCols.includes(i) ? AlignmentType.RIGHT : undefined })) })),
    ],
  });
}
function kv(rows: [string, string][]): Table {
  const w = [3200, 6880];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: w,
    rows: rows.map(([k, v]) => new TableRow({ cantSplit: true, children: [cell(k, w[0], { bold: true }), cell(v, w[1])] })),
  });
}
const spacer = () => new Paragraph({ spacing: { after: 120 }, children: [run(" ", { size: 10 })] });

function notary(names: string): Paragraph[] {
  return [
    h2("Acknowledgment"),
    p("STATE OF MARYLAND", { bold: true, after: 60 }),
    p("CITY/COUNTY OF ______________________________, to wit:", { after: 120 }),
    p(`I HEREBY CERTIFY that on this ______ day of ______________, 20____, before me, the undersigned Notary Public of the State of Maryland, personally appeared ${names}, known to me (or satisfactorily proven) to be the person(s) whose name(s) are subscribed to the foregoing instrument, and acknowledged that they executed the same for the purposes therein contained.`),
    p("WITNESS my hand and Notarial Seal."),
    new Paragraph({ keepNext: true, spacing: { before: 360, after: 30 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "222222", space: 1 } }, indent: { right: 5200 }, children: [run(" ")] }),
    p("Notary Public", { after: 60 }),
    p("Printed Name: ______________________________", { after: 60 }),
    p("My Commission Expires: ____________________"),
  ];
}

// ---------- the package ----------

export async function generateStockTransferPackageDocx(input: StockPackageInput): Promise<Buffer> {
  const err = validateStockPackage(input);
  if (err) throw new Error(err);

  const corp = input.corporationName;
  const sdat = input.sdatId.trim();
  const close = input.corpKind === "Close";
  const corpKindText = close ? "Maryland close corporation" : "Maryland corporation";
  const total = input.sharesIssued;
  const sellers = input.sellers;
  const buyers = input.buyers;
  const oneSeller = sellers.length === 1;
  const oneBuyer = buyers.length === 1;
  const moves = allocateShares(sellers, buyers);
  const eff = fmtDate(input.effectiveDate);
  const effBlank = input.effectiveDate ? eff : "[EFFECTIVE DATE]";
  const price = fmtMoney(input.purchasePrice);
  const par = input.parValue.trim() ? `$${input.parValue.trim().replace(/^\$/, "")} par value` : "no stated par value";
  const sellerNames = sellers.map((s) => s.name);
  const buyerNames = buyers.map((b) => b.name);
  const allNames = joinNames([...sellerNames, ...buyerNames]);
  const certs = input.certificateNumbers.trim();
  const officers = {
    president: orBlank(input.officers.president || buyers[0].name),
    vicePresident: input.officers.vicePresident.trim(),
    secretary: orBlank(input.officers.secretary || buyers[0].name),
    treasurer: orBlank(input.officers.treasurer || buyers[0].name),
  };
  const directors = (input.directors.length ? input.directors : buyerNames).filter((d) => d.trim());
  const newAgent = input.residentAgent.name.trim() || buyers[0].name;
  const newAgentAddress = input.residentAgent.address.trim() || buyers[0].address || input.principalOffice;
  const outgoingAgent = sellers[0].name;

  const S = (one: string, many: string) => (oneSeller ? one : many);
  const B = (one: string, many: string) => (oneBuyer ? one : many);
  const sellerTerm = S("Seller", "Sellers");
  const holdersText = oneBuyer ? `${buyers[0].name}, who owns ${shareCount(total)} shares (100%)` : buyers.map((b) => `${b.name} (${b.shares.toLocaleString("en-US")} ${sharesWord(b.shares)}, ${pct(b.shares, total)})`).join("; ");

  const kids: (Paragraph | Table)[] = [];

  // ===== Cover + summary =====
  kids.push(...h1("STOCK TRANSFER PACKAGE", `${corp} — change of stockholders of a ${corpKindText}`));
  kids.push(kv([
    ["Corporation", corp],
    ["SDAT ID", sdat],
    ["Corporation type", close ? "Maryland close corporation (no board of directors)" : "Maryland stock corporation (board of directors)"],
    ["Shares issued and transferred", `${total.toLocaleString("en-US")} shares of common stock, ${par}`],
    ["Principal office", orBlank(input.principalOffice)],
    ...sellers.map((s, i): [string, string] => [`Seller${oneSeller ? "" : ` ${i + 1}`} (${pct(s.shares, total)})`, `${s.name}${s.address ? `, ${s.address}` : ""} — ${s.shares.toLocaleString("en-US")} ${sharesWord(s.shares)}`]),
    ...buyers.map((b, i): [string, string] => [`Buyer${oneBuyer ? "" : ` ${i + 1}`} (${pct(b.shares, total)})`, `${b.name}${b.address ? `, ${b.address}` : ""} — ${b.shares.toLocaleString("en-US")} ${sharesWord(b.shares)}`]),
    ["Purchase price", input.purchasePrice != null ? price : "$[PURCHASE PRICE]"],
    ["Effective date", input.effectiveDate ? eff : "[EFFECTIVE DATE]"],
    ...(input.residentAgent.change ? [["New resident agent", `${newAgent}, ${orBlank(newAgentAddress)}`] as [string, string]] : []),
  ]));
  kids.push(spacer());
  kids.push(p("Contents: 1. Stock Purchase Agreement · 2. Stock Power and Assignment · 3. Resignation of " + (close ? "Outgoing Officer" : "Outgoing Officer and Director") + " · 4. Unanimous Written Consent" + (input.residentAgent.change ? " · 5. Resolution to Change Resident Agent (SDAT filing)" : "") + " · " + (input.residentAgent.change ? "6" : "5") + ". Stock Transfer Ledger · " + (input.residentAgent.change ? "7" : "6") + ". Closing Checklist", { size: 19 }));
  kids.push(h2("Important"));
  kids.push(p("A change of stockholders in a Maryland corporation is made by transferring shares, not by filing Articles of Amendment. Articles of Amendment are filed with SDAT only if the charter itself changes (name, authorized stock, purpose).", { size: 20 }));
  kids.push(p("This package was prepared from information supplied by the parties. It is a set of forms, not legal, tax, or accounting advice, and no one preparing it is acting as an attorney for any party. Each party is encouraged to have these documents reviewed by an attorney of his or her choice before signing.", { size: 20 }));
  kids.push(h2("Before signing"));
  kids.push(bullet(`Fill in any remaining blanks (purchase price, payment terms, effective date, certificate numbers) on every page where they appear.`));
  kids.push(bullet(`Confirm the corporation's name and SDAT ID exactly as they appear in SDAT's records, and that the stock ledger or organizational documents show ${total.toLocaleString("en-US")} shares issued.`));
  kids.push(bullet("If anyone other than the sellers listed was ever identified as an owner (SDAT annual reports, bank records, licenses, tax returns), add that person as a seller so every possible interest is conveyed."));
  kids.push(bullet("Type every name exactly as it appears on the person's government ID."));
  kids.push(bullet("Sign the Stock Purchase Agreement before a notary. Collect the original stock certificate(s), mark them CANCELLED, and issue new certificate(s) to the buyer(s)."));
  kids.push(bullet("Keep all signed originals in the corporate minute book."));

  // ===== 1. Stock Purchase Agreement =====
  kids.push(pageBreak());
  kids.push(...h1("1. Stock Purchase Agreement", `${corp} · SDAT ID ${sdat}`));
  kids.push(p(`This Stock Purchase Agreement (the "Agreement") is made and entered into as of ${effBlank} (the "Effective Date"), by and between:`));
  kids.push(p(`${S("SELLER", "SELLERS")}: ${joinSemi(sellers.map((s) => `${s.name}, of ${orBlank(s.address)}`))} (${oneSeller ? 'the "Seller"' : 'each a "Seller" and together the "Sellers"'}); and`));
  kids.push(p(`${B("BUYER", "BUYERS")}: ${joinSemi(buyers.map((b) => `${b.name}, of ${orBlank(b.address)}`))} (${oneBuyer ? 'the "Buyer"' : 'each a "Buyer" and together the "Buyers"'}).`));
  let n = 1;
  kids.push(h2(`${n++}. The Corporation`));
  kids.push(p(`${corp} is a ${corpKindText}, SDAT ID ${sdat} (the "Corporation"), with its principal office at ${orBlank(input.principalOffice)}. The Corporation has ${shareCount(total)} shares of common stock, ${par}, issued and outstanding (the "Shares").`));
  kids.push(h2(`${n++}. Sale and Purchase of Shares`));
  kids.push(p(`For the consideration stated below, each Seller sells, assigns, and transfers to ${oneBuyer ? "the Buyer" : "the Buyers"} all Shares and all other equity, ownership, or economic interest in the Corporation held by such Seller of record or otherwise, or that such Seller may be deemed to hold or claim, so that ${oneSeller ? "the Seller conveys" : "together the Sellers convey"} one hundred percent (100%) of the issued and outstanding Shares. The Shares are transferred as follows:`, { keepNext: true }));
  kids.push(grid(["Buyer", "Shares received", "Percentage"], [...buyers.map((b) => [b.name, b.shares.toLocaleString("en-US"), pct(b.shares, total)]), ["TOTAL", total.toLocaleString("en-US"), "100%"]], [5000, 2400, 2400], [1, 2]));
  kids.push(spacer());
  kids.push(p(oneBuyer
    ? `Upon closing, ${buyers[0].name} shall be the sole stockholder of the Corporation, owning ${shareCount(total)} shares (100%), and ${oneSeller ? "the Seller" : "each Seller"} shall hold no further interest in the Corporation.`
    : `Upon closing, the Buyers shall be the sole stockholders of the Corporation in the percentages stated above, and ${oneSeller ? "the Seller" : "each Seller"} shall hold no further interest in the Corporation.`));
  if (close) {
    kids.push(h2(`${n++}. Close Corporation Consent`));
    kids.push(p(`${oneSeller ? "The Seller, as the" : "The Sellers, as all of the"} stockholder${oneSeller ? "" : "s"} of the Corporation, consent${oneSeller ? "s" : ""} to this transfer for purposes of the restrictions on transfer of stock of a Maryland close corporation, and waive${oneSeller ? "s" : ""} any notice or right of first refusal.`));
  }
  kids.push(h2(`${n++}. Purchase Price`));
  kids.push(p(`The total purchase price for the Shares is ${input.purchasePrice != null ? price : "$[PURCHASE PRICE]"} (the "Purchase Price"), payable by ${oneBuyer ? "the Buyer" : "the Buyers"} to ${oneSeller ? "the Seller" : "the Sellers"} as follows: ${input.paymentTerms.trim() || "[PAYMENT TERMS]"}. ${oneSeller ? "The Seller acknowledges" : "Each Seller acknowledges"} receipt of ${oneSeller ? "the" : "his or her share of the"} Purchase Price upon payment in full.`));
  if (!oneSeller) {
    kids.push(h2(`${n++}. Prior Ownership Records`));
    kids.push(p("Each person who has been identified in any public filing, license, bank record, or tax record as an owner, stockholder, or officer of the Corporation joins in this Agreement as a Seller, whether or not that identification was accurate, to convey any and all interest he or she holds or may claim in the Corporation, and waives any future claim to an ownership or economic interest in the Corporation."));
  }
  kids.push(h2(`${n++}. Closing Deliveries`));
  kids.push(p(`At closing, ${oneSeller ? "the Seller" : "the Sellers"} shall deliver: (a) the original stock certificate(s) for the Shares, or an affidavit of lost certificate; (b) an executed Stock Power and Assignment from ${oneSeller ? "the Seller" : "each Seller"}; (c) the written resignation of ${oneSeller ? "the Seller" : "each Seller"} from all ${close ? "officer" : "director and officer"} positions and as resident agent; and (d) the Corporation's minute book, stock ledger, seal (if any), and business records.`));
  kids.push(h2(`${n++}. ${S("Seller's", "Sellers'")} Representations and Warranties`));
  kids.push(p(`${oneSeller ? "The Seller represents and warrants" : "Each Seller represents and warrants"} that: (a) ${oneSeller ? "the Seller is the sole owner of the Shares and" : "the Seller is an owner of the Shares sold by him or her and"} has full right and authority to sell them; (b) the Shares are fully paid and are free and clear of all liens, security interests, pledges, options, and claims; (c) there are no outstanding options, warrants, or agreements to issue additional shares; and (d) except as disclosed to ${oneBuyer ? "the Buyer" : "the Buyers"} in writing, the Corporation has no unpaid taxes, debts, judgments, or pending lawsuits.`));
  kids.push(h2(`${n++}. ${B("Buyer's", "Buyers'")} Acknowledgment`));
  kids.push(p(`${oneBuyer ? "The Buyer acknowledges" : "Each Buyer acknowledges"} that he or she has had the opportunity to inspect the Corporation's business, books, inventory, licenses, and lease, and is purchasing the Shares for his or her own account. Except for the warranties stated in this Agreement, the Shares and the Corporation's assets are transferred "AS IS, WHERE IS," and ${oneSeller ? "the Seller makes" : "the Sellers make"} no other warranty, express or implied.`));
  kids.push(h2(`${n++}. Liabilities Before Closing`));
  kids.push(p(`${oneSeller ? "The Seller remains" : "The Sellers remain"} solely responsible for, and shall indemnify and hold ${oneBuyer ? "the Buyer" : "the Buyers"} and the Corporation harmless from, all debts, taxes (including sales and use, withholding, and tobacco taxes), obligations, and liabilities of the Corporation arising before the Effective Date, unless otherwise agreed in writing.`));
  kids.push(h2(`${n++}. Lease and Third-Party Consents`));
  kids.push(p(`The parties acknowledge that the transfer may require the consent of the Corporation's landlord, lenders, or licensing authorities${input.landlordConsentRequired === "Yes" ? "; the landlord's consent has been identified as required for this transfer" : ""}. ${oneSeller ? "The Seller shall" : "The Sellers shall"} cooperate in obtaining such consents. Any future transfer of Shares remains subject to the transfer restrictions of the Corporation's lease, if any.`));
  kids.push(h2(`${n++}. Tax Matters`));
  kids.push(p(`${input.taxStatus === "S" ? "The Corporation has elected S corporation status, and" : "If the Corporation has elected S corporation status,"} ${oneBuyer ? "the Buyer represents" : "each Buyer represents"} that he or she is eligible to be an S corporation shareholder. Income and losses for the tax year of the transfer shall be allocated between ${oneSeller ? "the Seller" : "the Sellers"} and ${oneBuyer ? "the Buyer" : "the Buyers"} as required by law or as the parties agree in writing with their tax preparer.`));
  kids.push(h2(`${n++}. Further Assurances`));
  kids.push(p("Each party shall sign any additional documents and take any further actions reasonably necessary to complete the transfer, including filings with the Maryland State Department of Assessments and Taxation, the Comptroller of Maryland, the Internal Revenue Service, banks, and licensing agencies."));
  kids.push(h2(`${n++}. General Provisions`));
  kids.push(p("This Agreement is governed by the laws of the State of Maryland, is binding on the parties and their heirs, successors, and assigns, and is the entire agreement of the parties on this subject. If any provision is held unenforceable, the remaining provisions remain in effect. It may be signed in counterparts. Nothing in this document constitutes legal, tax, or accounting advice to any party."));
  kids.push(p("IN WITNESS WHEREOF, the parties have signed this Agreement as of the Effective Date.", { keepNext: true }));
  sellers.forEach((s, i) => kids.push(...sigBlock(oneSeller ? "SELLER" : `SELLER ${i + 1}`, s.name)));
  buyers.forEach((b, i) => kids.push(...sigBlock(`${oneBuyer ? "BUYER" : `BUYER ${i + 1}`} (${pct(b.shares, total)})`, b.name)));
  kids.push(...notary(allNames || BLANK));

  // ===== 2. Stock Power and Assignment — one per seller =====
  sellers.forEach((s, si) => {
    kids.push(pageBreak());
    kids.push(...h1("2. Stock Power and Assignment", oneSeller ? `${corp} · SDAT ID ${sdat}` : `${corp} · SDAT ID ${sdat} · Seller ${si + 1} of ${sellers.length}`));
    const mine = moves.filter((m) => m.seller === s);
    kids.push(p(`FOR VALUE RECEIVED, the undersigned, ${s.name} ("Assignor"), hereby sells, assigns, and transfers unto:`, { keepNext: true }));
    kids.push(grid(["Assignee", "Number of shares", "Percentage of Corporation"], mine.map((m) => [`${m.buyer.name}${m.buyer.address ? `, ${m.buyer.address}` : ""}`, m.shares.toLocaleString("en-US"), pct(m.shares, total)]), [5600, 2000, 2400], [1, 2]));
    kids.push(spacer());
    kids.push(p(`being ${s.shares === total ? "all" : `${shareCount(s.shares)}`} of the shares of common stock, ${par}, of ${corp}, a ${corpKindText} (SDAT ID ${sdat}) (the "Corporation"), standing in the name of the Assignor on the books of the Corporation, represented by Certificate No(s). ${certs || "[____]"}, together with any other interest the Assignor holds or may claim in the Corporation. The Assignor irrevocably appoints the Secretary of the Corporation as attorney-in-fact to transfer the shares on the books of the Corporation, with full power of substitution.`));
    kids.push(p(`Date: ${effBlank}`));
    kids.push(...sigBlock("ASSIGNOR", s.name));
    kids.push(...sigBlock("WITNESS", BLANK));
  });

  // ===== 3. Resignations — one per outgoing officer/director =====
  sellers.forEach((s, si) => {
    kids.push(pageBreak());
    kids.push(...h1(`3. Resignation of ${close ? "Outgoing Officer" : "Director and Officer"}`, oneSeller ? `${corp} · SDAT ID ${sdat}` : `${corp} · SDAT ID ${sdat} · ${si + 1} of ${sellers.length}`));
    kids.push(p(`To the ${close ? "Stockholders" : "Board of Directors and Stockholders"} of ${corp} (SDAT ID ${sdat}):`));
    kids.push(p(`I, ${s.name}, hereby resign from every position I hold with the Corporation, including the following, effective as of ${effBlank}:`, { keepNext: true }));
    const positions = [...(close ? [] : ["Director"]), "President", "Vice President", "Secretary", "Treasurer", "Resident Agent", "Other: ____________________"];
    positions.forEach((x) => kids.push(checkItem(x)));
    kids.push(spacer());
    kids.push(p("I confirm that I have no claim against the Corporation for compensation, fees, or reimbursement except as stated here: [NONE / DESCRIBE]. I agree to return all corporate records, keys, bank cards, and property, and to cooperate in removing my name from bank accounts, licenses, and government records."));
    kids.push(...sigBlock(close ? "RESIGNING OFFICER" : "RESIGNING DIRECTOR / OFFICER", s.name));
  });

  // ===== 4. Unanimous Written Consent =====
  kids.push(pageBreak());
  kids.push(...h1(close ? "4. Unanimous Written Consent of the Stockholders" : "4. Unanimous Written Consent of the Stockholders and Board of Directors", `In lieu of a meeting · ${corp} · SDAT ID ${sdat}`));
  kids.push(p(close
    ? `The undersigned, being all of the stockholders of ${corp}, a Maryland close corporation that has elected to have no board of directors (the "Corporation"), acting by unanimous written consent without a meeting as permitted by the Maryland General Corporation Law, adopt the following resolutions, effective as of ${effBlank}:`
    : `The undersigned, being all of the stockholders and all of the directors of ${corp}, a Maryland corporation (the "Corporation"), acting by unanimous written consent without a meeting as permitted by the Maryland General Corporation Law, adopt the following resolutions, effective as of ${effBlank}:`));
  kids.push(h2("Transfer of Shares"));
  kids.push(p(`RESOLVED, that the transfer of ${shareCount(total)} shares of the Corporation's common stock, being 100% of the issued and outstanding stock, from ${joinNames(sellerNames)} to ${buyers.map((b) => `${b.name} (${b.shares.toLocaleString("en-US")} ${sharesWord(b.shares)}, ${pct(b.shares, total)})`).join(" and ")} under the Stock Purchase Agreement dated ${effBlank} is approved; that Certificate No(s). ${certs || "[____]"} are cancelled; and that new Certificate No(s). [____] are issued ${oneBuyer ? `to ${buyers[0].name} for ${shareCount(total)} shares` : "to the Buyers in the amounts stated"}.`));
  kids.push(h2(oneSeller ? "Resignation" : "Resignations"));
  kids.push(p(`RESOLVED, that the ${oneSeller ? "resignation" : "resignations"} of ${joinNames(sellerNames)} from all ${close ? "officer" : "director and officer"} positions and as Resident Agent ${oneSeller ? "is" : "are"} accepted.`));
  if (!close) {
    kids.push(h2("Election of Directors"));
    kids.push(p(`RESOLVED, that ${directors.length ? joinNames(directors) : "[DIRECTOR NAME(S)]"} ${directors.length === 1 ? "is" : "are"} elected as ${directors.length === 1 ? "the director" : "directors"} of the Corporation to serve until ${directors.length === 1 ? "his or her" : "their"} successors are elected and qualify.`));
  }
  kids.push(h2("Election of Officers"));
  kids.push(grid(["Office", "Name"], [
    ["President", officers.president],
    ...(input.officers.vicePresident.trim() ? [["Vice President", input.officers.vicePresident.trim()]] : []),
    ["Secretary", officers.secretary],
    ["Treasurer", officers.treasurer],
  ], [3000, 7000]));
  kids.push(spacer());
  if (input.residentAgent.change) {
    kids.push(h2("Resident Agent and Principal Office"));
    kids.push(p(`RESOLVED, that ${newAgent}, of ${orBlank(newAgentAddress)}, is designated as the Resident Agent of the Corporation in place of ${outgoingAgent}; that the principal office remains at ${orBlank(input.principalOffice)}; and that the officers are authorized to sign and file the Resolution to Change Principal Office or Resident Agent with the Maryland State Department of Assessments and Taxation.`));
  }
  kids.push(h2("Banking and Filings"));
  const signers = joinNames(unique([officers.president, officers.secretary, officers.treasurer].filter((x) => x !== BLANK)));
  kids.push(p(`RESOLVED, that ${signers || "[AUTHORIZED SIGNERS]"} ${signers && /,| and /.test(signers) ? "are" : "is"} the sole authorized signer${/,| and /.test(signers) ? "s" : ""} on all bank accounts of the Corporation, and ${joinNames(sellerNames)} ${oneSeller ? "is" : "are"} removed as ${oneSeller ? "a signer" : "signers"}; and that the officers are authorized to sign and file all documents needed to carry out these resolutions, including with SDAT, the Comptroller of Maryland, the IRS, the landlord, and licensing agencies.`));
  kids.push(h2(oneBuyer ? "Stockholder" : "Stockholders"));
  buyers.forEach((b, i) => kids.push(...sigBlock(`${oneBuyer ? "SOLE STOCKHOLDER" : `STOCKHOLDER ${i + 1}`} (${b.shares.toLocaleString("en-US")} ${sharesWord(b.shares)}, ${pct(b.shares, total)})`, b.name)));
  if (!close) {
    kids.push(h2(directors.length === 1 ? "Director" : "Directors"));
    (directors.length ? directors : [BLANK]).forEach((d, i) => kids.push(...sigBlock(directors.length > 1 ? `DIRECTOR ${i + 1}` : "DIRECTOR", d)));
  }
  kids.push(h2("Acknowledged by the outgoing stockholder" + (oneSeller ? "" : "s")));
  sellers.forEach((s) => kids.push(...sigBlock("OUTGOING", s.name)));

  // ===== 5. Resolution to Change Resident Agent =====
  let docNo = 5;
  if (input.residentAgent.change) {
    kids.push(pageBreak());
    kids.push(...h1("5. Resolution to Change Resident Agent", "For filing with the Maryland State Department of Assessments and Taxation"));
    kids.push(p(`The ${close ? "stockholders" : "stockholders and directors"} of ${corp}, a Maryland corporation, SDAT ID ${sdat}, passed the following resolution:`));
    kids.push(p(`Change of principal office: No change (remains ${orBlank(input.principalOffice)})`, { bold: true }));
    kids.push(p("Change of resident agent:", { bold: true, after: 60 }));
    kids.push(p(`The name of the new resident agent is ${newAgent}, whose address is ${orBlank(newAgentAddress)}, an individual who is a citizen of Maryland and resides in Maryland.`));
    kids.push(p(`This resident agent replaces ${outgoingAgent}${sellers[0].address ? `, ${sellers[0].address}` : ""}.`));
    kids.push(p("I certify under penalties of perjury that the foregoing is true."));
    kids.push(...sigBlock("PRESIDENT / AUTHORIZED PERSON", officers.president, { title: "President" }));
    kids.push(...sigBlock("SECRETARY / ATTEST", officers.secretary, { title: "Secretary" }));
    kids.push(p("I hereby consent to my designation in this document as resident agent for this corporation.", { keepNext: true }));
    kids.push(...sigBlock("RESIDENT AGENT", newAgent));
    kids.push(p("Filing note: use SDAT's current \"Resolution to Change Principal Office or Resident Agent\" form, or file online through Maryland Business Express, with the information above. The exact corporation name and SDAT ID must match SDAT records.", { italics: true, size: 19, color: "6B6B6B" }));
    docNo = 6;
  }

  // ===== Stock Transfer Ledger =====
  kids.push(pageBreak());
  kids.push(...h1(`${docNo}. Stock Transfer Ledger`, `${corp} · SDAT ID ${sdat} · Authorized and issued: ${total.toLocaleString("en-US")} shares, ${par}`));
  const holderBalances = buyers.map((b) => `${b.name}: ${b.shares.toLocaleString("en-US")}`).join("; ");
  kids.push(grid(["Date", "Cert. No.", "From", "To", "Shares", "Cert. cancelled", "Holder balance"], [
    ...(input.originalHolder.trim() && sellers.length === 1 && input.originalHolder.trim().toLowerCase() !== sellers[0].name.trim().toLowerCase()
      ? [
          ["[____]", "[____]", "Corporation (original issue)", input.originalHolder.trim(), total.toLocaleString("en-US"), "", `${input.originalHolder.trim()}: ${total.toLocaleString("en-US")}`],
          [input.originalHolderTransferDate.trim() || "[____]", certs || "[____]", input.originalHolder.trim(), sellers[0].name, total.toLocaleString("en-US"), "[____]", `${sellers[0].name}: ${total.toLocaleString("en-US")}`],
        ]
      : sellers.map((s) => ["[____]", certs || "[____]", "Corporation (original issue)", s.name, s.shares.toLocaleString("en-US"), "", `${s.name}: ${s.shares.toLocaleString("en-US")}`])),
    ...moves.map((m) => [effBlank, "[____]", m.seller.name, m.buyer.name, m.shares.toLocaleString("en-US"), certs || "[____]", `${m.buyer.name}: ${m.shares.toLocaleString("en-US")}`]),
  ], [1100, 900, 1900, 1900, 900, 1100, 2200], [4]));
  kids.push(spacer());
  kids.push(p(`Holders after the transfer: ${holderBalances}.`, { size: 19 }));
  kids.push(p("Certified correct by the Secretary of the Corporation:", { keepNext: true }));
  kids.push(...sigBlock("SECRETARY", officers.secretary));

  // ===== Closing checklist (internal) =====
  docNo += 1;
  kids.push(pageBreak());
  kids.push(...h1(`${docNo}. Closing Checklist`, `${corp} · SDAT ID ${sdat}`));
  kids.push(p(`Internal working paper${input.internalFirmLine ? ` · ${input.internalFirmLine}` : ""} · Not part of the signed documents`, { italics: true, size: 19, color: "6B6B6B" }));
  kids.push(h2("At signing"));
  kids.push(checkItem("Purchase price, payment terms, and effective date filled in on every page"));
  kids.push(checkItem(`Stock Purchase Agreement signed by ${oneSeller && oneBuyer ? "both parties" : "all sellers and all buyers"} and notarized`));
  kids.push(checkItem("Stock Power(s), Resignation(s), and Unanimous Written Consent signed"));
  kids.push(checkItem(`Original certificate(s) collected and marked CANCELLED; new certificate(s) issued: ${oneBuyer ? `${buyers[0].name} — ${total.toLocaleString("en-US")} shares` : buyers.map((b) => `${b.name} — ${b.shares.toLocaleString("en-US")} shares`).join("; ")}`));
  kids.push(checkItem("Stock ledger updated and signed by the Secretary; originals placed in the minute book; copies to each party"));
  if (input.originalHolder.trim() && sellers.length === 1 && input.originalHolder.trim().toLowerCase() !== sellers[0].name.trim().toLowerCase()) {
    kids.push(checkItem(`Chain of title: signed stock power or other proof of the transfer from ${input.originalHolder.trim()} to ${sellers[0].name} is in the minute book (if not, have ${input.originalHolder.trim()} sign a stock power or join this agreement as a seller)`));
  }
  kids.push(h2("Maryland SDAT"));
  if (input.residentAgent.change) kids.push(checkItem(`Resolution to Change Resident Agent filed, signed by ${newAgent} as the new resident agent`));
  else kids.push(checkItem("Resident agent unchanged — confirm the current resident agent is still willing and able to serve"));
  kids.push(checkItem("No Articles of Amendment needed unless the charter itself changes (name, authorized stock, purpose)"));
  kids.push(checkItem(`Next Annual Report / Personal Property Return lists ${joinNames(unique([officers.president, officers.secretary, officers.treasurer].filter((x) => x !== BLANK))) || "the new officers"}`));
  kids.push(h2("IRS"));
  kids.push(checkItem(`Form 8822-B (change of responsible party) filed within 60 days, naming ${buyers[0].name} as responsible party`));
  kids.push(checkItem(input.taxStatus === "S" ? "S corporation: confirm every new stockholder is eligible; allocate income for the year of transfer (per-share/per-day or closing-of-books election)" : "If S corporation: confirm every new stockholder is eligible; allocate income for the year of transfer"));
  kids.push(checkItem("Payroll accounts, Forms 941/940, and EFTPS updated with the new officers and signers"));
  kids.push(h2("Comptroller of Maryland and licenses"));
  kids.push(checkItem("Combined registration (sales and use, withholding) updated with the new officer/owner information"));
  kids.push(checkItem("Business licenses (trader's, tobacco, vape, food, etc.): confirm with each issuing agency whether the change in ownership needs a new license or an update"));
  kids.push(checkItem("Sellers' pre-closing tax balances confirmed paid or allocated to the sellers under the Liabilities section"));
  kids.push(h2("Banks, landlord, and vendors"));
  kids.push(checkItem(input.landlordConsentRequired === "Yes" ? "Landlord consent obtained (required for this transfer); lease assignment or estoppel signed if required" : "Landlord consent: confirm whether the lease requires it; obtain it if so"));
  kids.push(checkItem(`Bank signature cards updated; ${joinNames(sellerNames)} removed`));
  kids.push(checkItem("Merchant processor, insurance, utilities, and suppliers updated"));
  kids.push(spacer());
  kids.push(grid(["Item", "Date completed", "Completed by"], ["Package signed", "Notarized", "SDAT filing", "IRS 8822-B", "Comptroller / licenses"].map((x) => [x, "", ""]), [4000, 3000, 3000]));

  const doc = new Document({
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }],
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: "999999", space: 4 } },
            children: [run(`${corp} — Stock Transfer Package`, { size: 16, color: "6B6B6B" }), run("\t", { size: 16 }), new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: "6B6B6B" })],
          })],
        }),
      },
      children: kids,
    }],
  });
  return Packer.toBuffer(doc);
}

function unique(list: string[]): string[] {
  return Array.from(new Set(list));
}
