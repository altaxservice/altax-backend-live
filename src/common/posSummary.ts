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
