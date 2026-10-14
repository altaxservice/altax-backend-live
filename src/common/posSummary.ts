/**
 * POS period summaries (Clover and similar): turns the few totals a point-of-sale report gives for a month into the
 * Cash / Card / SNAP blocks the Sales Input already understands, so nothing is split or calculated by hand.
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface PosInput {
  /** Sales at each taxable rate, before tax. */
  taxable: { categoryId: string; amount: number }[];
  /** Everything sold that carries no tax (No Tax + Tax Removed lines, EBT items…), before tax. */
  nonTaxable: number;
  /** Amounts COLLECTED by each way of paying (tax included, as POS tender reports show them). */
  cash: number; card: number; ebt: number;
  /** Sales tax actually collected, net of refunds. */
  taxCollected: number;
}
export interface PosBlocks { cash: { total: number; lines: { categoryId: string; taxableAmount: number }[] }; card: { total: number; lines: { categoryId: string; taxableAmount: number }[] }; snap: number }

export function allocatePos(i: PosInput): { blocks: PosBlocks; pretax: number; collected: number; expected: number; diff: number; warnings: string[] } {
  const warnings: string[] = [];
  const taxableTotal = r2(i.taxable.reduce((s, t) => s + t.amount, 0));
  const pretax = r2(taxableTotal + i.nonTaxable);
  const snap = r2(Math.max(i.ebt, 0));
  if (snap > i.nonTaxable + 0.005) warnings.push(`EBT collected ($${snap.toFixed(2)}) is more than the non-taxable sales ($${r2(i.nonTaxable).toFixed(2)}) — check the Taxes report.`);
  const pre = r2(pretax - snap); // sales paid by cash or card, before tax
  const C = r2(i.cash + i.card);
  const expected = r2(pre + i.taxCollected);
  const diff = r2(C - expected);
  if (Math.abs(diff) > 1) warnings.push(`Cash + card collected ($${C.toFixed(2)}) differs from sales + tax ($${expected.toFixed(2)}) by $${Math.abs(diff).toFixed(2)}. Check the numbers before saving.`);

  const f = C > 0 ? i.cash / C : 1; // cash's share of what was collected by cash or card
  const cashPre = C > 0 ? Math.max(0, r2(i.cash - i.taxCollected * f)) : pre;
  const cardPre = r2(pre - cashPre);
  // Taxable sales follow the same split as the money, capped to what each block actually holds.
  const lines = i.taxable.filter((t) => t.amount > 0).map((t) => ({ categoryId: t.categoryId, amount: t.amount, cash: r2(t.amount * f) }));
  let cashTaxable = r2(lines.reduce((s, l) => s + l.cash, 0));
  if (cashTaxable > cashPre) { const k = cashPre / cashTaxable; lines.forEach((l) => { l.cash = r2(l.cash * k); }); cashTaxable = r2(lines.reduce((s, l) => s + l.cash, 0)); }
  const cardLines = lines.map((l) => ({ categoryId: l.categoryId, taxableAmount: r2(l.amount - l.cash) })).filter((l) => l.taxableAmount > 0);
  const cardTaxable = r2(cardLines.reduce((s, l) => s + l.taxableAmount, 0));
  if (cardTaxable > cardPre + 0.005) warnings.push("The taxable sales don't fit in the card total — check the card amount.");
  return {
    blocks: { cash: { total: cashPre, lines: lines.map((l) => ({ categoryId: l.categoryId, taxableAmount: l.cash })).filter((l) => l.taxableAmount > 0) }, card: { total: cardPre, lines: cardLines }, snap },
    pretax, collected: C + snap, expected: r2(expected + snap), diff, warnings,
  };
}

/* ───────────── Reading a Clover "Sales Overview" / "Taxes" report (text extracted from the PDF) ───────────── */
export interface CloverTaxSection { name: string; rate: number; applicable: number; collected: number; refunded: number; net: number }
export interface CloverParse {
  from: string | null; to: string | null;
  taxSections: CloverTaxSection[];
  overview: { gross: number | null; refunds: number | null; net: number | null; taxes: number | null; collected: number | null };
  tenders: { debit: number; credit: number; ebt: number; cash: number; other: { name: string; amount: number }[] };
  foundOverview: boolean; foundTaxes: boolean; warnings: string[];
  totalApplicable: number | null;
  /** Self-checks on the numbers (do the payment types add up to the amount collected? do the tax sections add up to the report's own total?). Used to pick the best reading of a picture and to warn. */
  checks: { name: string; ok: boolean }[];
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
const AMT = /\(?-?\$?\(?[\d,]*\d\.\d{2}\)?/g;
const num = (tok: string) => { const neg = /^\(|^-|\(\$|-\$/.test(tok) || /\)$/.test(tok) && tok.includes("("); const n = Number(tok.replace(/[^0-9.]/g, "")); return neg ? -n : n; };
const amounts = (line: string) => (line.match(AMT) || []).map(num);
const BRANDS = /^(visa|mastercard|master card|discover|american express|amex|diners|jcb|union ?pay|interac)\b/i;

export function parseCloverText(text: string): CloverParse {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const out: CloverParse = { from: null, to: null, taxSections: [], overview: { gross: null, refunds: null, net: null, taxes: null, collected: null }, tenders: { debit: 0, credit: 0, ebt: 0, cash: 0, other: [] }, foundOverview: false, foundTaxes: false, warnings: [], totalApplicable: null, checks: [] };
  const joined = lines.join(" ");
  const pm = /([A-Za-z]{3})[a-z]* (\d{1,2}),?\s*(\d{4})[^-–]{0,40}[-–]\s*([A-Za-z]{3})[a-z]* (\d{1,2}),?\s*(\d{4})/.exec(joined);
  if (pm && MONTHS[pm[1].toLowerCase()] && MONTHS[pm[4].toLowerCase()]) {
    out.from = `${pm[3]}-${MONTHS[pm[1].toLowerCase()]}-${pm[2].padStart(2, "0")}`; out.to = `${pm[6]}-${MONTHS[pm[4].toLowerCase()]}-${pm[5].padStart(2, "0")}`;
  }

  // Taxes report: a heading like "Sales Tax (6%)" followed by Applicable Sales / Amount Collected / Amount Refunded / Net Amount.
  let cur: CloverTaxSection | null = null; let inTaxes = false; let totalSec: CloverTaxSection | null = null;
  for (const l of lines) {
    const head = /^(.+?)\s*\((\d+(?:\.\d+)?)\s*%\)\s*$/.exec(l);
    if (head && amounts(l).length === 0) { cur = { name: head[1].trim(), rate: Number(head[2]), applicable: 0, collected: 0, refunded: 0, net: 0 }; out.taxSections.push(cur); inTaxes = true; continue; }
    if (!cur) continue;
    if (/^total\b/i.test(l) && amounts(l).length === 0) { cur = { name: "__total__", rate: -1, applicable: 0, collected: 0, refunded: 0, net: 0 }; totalSec = cur; continue; }
    const a = amounts(l)[0];
    if (a === undefined) continue;
    if (/^applicable sales/i.test(l)) cur.applicable = a;
    else if (/^amount collected/i.test(l)) cur.collected = a;
    else if (/^amount refunded/i.test(l)) cur.refunded = a;
    else if (/^net amount/i.test(l)) cur.net = a;
  }
  // The report's own "Total" block is a cross-check, not a tax rate.
  if (totalSec) { out.totalApplicable = totalSec.applicable || null; out.taxSections = out.taxSections.filter((x) => x !== totalSec); }
  out.foundTaxes = inTaxes && out.taxSections.some((s) => s.applicable !== 0);

  // Sales Overview: summary lines, then the tender types (first occurrence of each name; indented card-brand lines are skipped).
  let inTender = false; const seen = new Set<string>();
  for (const l of lines) {
    if (/sales by tender type/i.test(l)) { inTender = true; out.foundOverview = true; continue; }
    if (/total cash deposit|sales by employee|sales by item|discounts/i.test(l)) inTender = false;
    const a = amounts(l)[0];
    if (!inTender) {
      if (a === undefined) continue;
      if (/^gross sales/i.test(l) && out.overview.gross === null) { out.overview.gross = a; out.foundOverview = true; }
      else if (/^refunds?\b/i.test(l) && out.overview.refunds === null) out.overview.refunds = a;
      else if (/^net sales/i.test(l) && out.overview.net === null) out.overview.net = a;
      else if (/^taxes( & fees)?\b/i.test(l) && out.overview.taxes === null) out.overview.taxes = a;
      else if (/^amount collected/i.test(l) && out.overview.collected === null && !out.taxSections.length) out.overview.collected = a;
      else if (/^amount collected/i.test(l) && out.overview.collected === null && out.foundOverview) out.overview.collected = a;
      continue;
    }
    if (a === undefined) continue;
    const name = /^([A-Za-z][A-Za-z &/.'-]*?)\s*(?:\(\d+\))?\s+\(?-?\$/.exec(l)?.[1]?.trim();
    if (!name || BRANDS.test(name) || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    if (/^debit/i.test(name)) out.tenders.debit = a; else if (/^credit/i.test(name)) out.tenders.credit = a; else if (/^ebt|snap/i.test(name)) out.tenders.ebt = a; else if (/^cash$/i.test(name)) out.tenders.cash = a;
    else out.tenders.other.push({ name, amount: a });
  }
  finalizeClover(out);
  return out;
}

/** Self-checks and warnings for a parsed report — shared by the text reader and the picture (Claude) reader. */
export function finalizeClover(out: CloverParse): CloverParse {
  out.checks = []; const t = out.tenders; const tenderSum = r2(t.debit + t.credit + t.ebt + t.cash + t.other.reduce((s, o) => s + o.amount, 0));
  if (out.overview.collected !== null && tenderSum > 0) out.checks.push({ name: "payment types add up to the amount collected", ok: Math.abs(tenderSum - out.overview.collected) <= 0.02 });
  if (out.totalApplicable !== null && out.taxSections.length) out.checks.push({ name: "tax sections add up to the report's total", ok: Math.abs(r2(out.taxSections.reduce((s, x) => s + x.applicable, 0)) - out.totalApplicable) <= 0.02 });
  for (const sec of out.taxSections) if (sec.collected || sec.refunded || sec.net) out.checks.push({ name: `${sec.name}: collected less refunded equals net`, ok: Math.abs(r2(sec.collected + sec.refunded) - sec.net) <= 0.02 });
  for (const c of out.checks) if (!c.ok) out.warnings.push(`Doesn't add up: ${c.name}. A number may have been misread — check it against the report.`);
  if (!out.foundOverview && !out.foundTaxes) out.warnings.push("This doesn't look like a Clover Sales Overview or Taxes report.");
  if (out.tenders.other.length) out.warnings.push(`Other ways of paying were found (${out.tenders.other.map((o) => `${o.name} $${o.amount.toFixed(2)}`).join(", ")}) — they are not included; add them to Cash or Card if they belong there.`);
  return out;
}

/** Combines the parsed reports into the single set of numbers the form shows. */
export interface CloverSummary { from: string | null; to: string | null; taxable: { rate: number; amount: number; name: string }[]; nonTaxable: number; cash: number; card: number; ebt: number; taxCollected: number | null; warnings: string[]; foundOverview: boolean; foundTaxes: boolean; collectedPerReport: number | null; totalApplicable: number | null }

export function summarizeClover(parsed: CloverParse[]): CloverSummary {
  const warnings = parsed.flatMap((p) => p.warnings);
  const sections = parsed.flatMap((p) => p.taxSections);
  const byRate = new Map<number, { rate: number; amount: number; name: string }>();
  let nonTaxable = 0;
  for (const s of sections) {
    if (s.rate > 0) { const e = byRate.get(s.rate) || { rate: s.rate, amount: 0, name: s.name }; e.amount = r2(e.amount + s.applicable); byRate.set(s.rate, e); }
    else nonTaxable = r2(nonTaxable + s.applicable);
  }
  const t = parsed.reduce((acc, p) => ({ debit: acc.debit || p.tenders.debit, credit: acc.credit || p.tenders.credit, ebt: acc.ebt || p.tenders.ebt, cash: acc.cash || p.tenders.cash }), { debit: 0, credit: 0, ebt: 0, cash: 0 });
  const ovTax = parsed.map((p) => p.overview.taxes).find((x) => x !== null && x !== undefined) ?? null;
  const secTax = sections.length ? r2(sections.reduce((s, x) => s + (x.net || x.collected + x.refunded), 0)) : null;
  if (ovTax !== null && secTax !== null && Math.abs(ovTax - secTax) > 1) warnings.push(`The tax collected reads $${ovTax.toFixed(2)} on the Sales Overview but $${secTax.toFixed(2)} on the Taxes report — check which is right.`);
  const from = parsed.map((p) => p.from).find(Boolean) || null, to = parsed.map((p) => p.to).find(Boolean) || null;
  if (!parsed.some((p) => p.foundTaxes)) warnings.push("The Taxes report wasn't included, so the taxable and non-taxable sales are blank — add that PDF or type them in.");
  if (!parsed.some((p) => p.foundOverview)) warnings.push("The Sales Overview wasn't included, so how customers paid (cash / card / EBT) is blank — add that PDF or type it in.");
  return { from, to, taxable: Array.from(byRate.values()), nonTaxable, cash: t.cash, card: r2(t.debit + t.credit), ebt: t.ebt, taxCollected: ovTax ?? secTax, warnings, foundOverview: parsed.some((p) => p.foundOverview), foundTaxes: parsed.some((p) => p.foundTaxes),
    collectedPerReport: parsed.map((p) => p.overview.collected).find((x) => x !== null && x !== undefined) ?? null, totalApplicable: parsed.map((p) => p.totalApplicable).find((x) => x !== null && x !== undefined) ?? null };
}

