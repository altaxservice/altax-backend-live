import { ValidationError } from "./asyncHandler";

/**
 * Sales entry as three blocks: Cash, Card, SNAP/EBT.
 *   Cash and Card each have a total (sales before tax) and the part of it that was taxable at each rate; whatever isn't
 *   taxable is non-taxable. SNAP/EBT is a single number — SNAP purchases aren't taxable.
 * From the blocks we derive what the rest of the system already understands: one aggregated list of category lines (used
 * for sales tax and the filing math), and how much was collected by card and by SNAP (tax included), with cash as the rest.
 */
export const NON_TAXABLE_CATEGORY = "CAT-NON-TAXABLE";

export interface BlockLine { categoryId: string; taxableAmount: number }
export interface SalesBlocks { cash: { total: number; lines: BlockLine[] }; card: { total: number; lines: BlockLine[] }; snap: number }
export interface BlockTaxFn { (lines: BlockLine[]): Promise<{ lines: { categoryId: string; categoryName: string; taxableAmount: number; rate: number; taxAmount: number }[]; totalTax: number }> }

const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

function normBlock(raw: any): { total: number; lines: BlockLine[] } {
  const lines: BlockLine[] = [];
  for (const l of Array.isArray(raw?.lines) ? raw.lines : []) {
    const amount = r2(l?.taxableAmount);
    const categoryId = String(l?.categoryId || "").trim();
    if (categoryId && categoryId !== NON_TAXABLE_CATEGORY && amount > 0) lines.push({ categoryId, taxableAmount: amount });
  }
  return { total: r2(raw?.total), lines };
}

export function normalizeBlocks(raw: any): SalesBlocks {
  return { cash: normBlock(raw?.cash), card: normBlock(raw?.card), snap: r2(raw?.snap) };
}

export interface ResolvedBlocks {
  categoryLines: BlockLine[];
  gross: number; tax: number;
  tenderCard: number; tenderEbt: number;
  perBlock: {
    cash: { total: number; taxable: number; nonTaxable: number; tax: number; collected: number };
    card: { total: number; taxable: number; nonTaxable: number; tax: number; collected: number };
    snap: { total: number; collected: number };
  };
}

export async function resolveBlocks(blocks: SalesBlocks, taxFn: BlockTaxFn): Promise<ResolvedBlocks> {
  const per = async (label: string, b: { total: number; lines: BlockLine[] }) => {
    const taxable = r2(b.lines.reduce((s, l) => s + l.taxableAmount, 0));
    if (taxable > b.total + 0.005) throw new ValidationError(`${label}: the taxable amounts ($${taxable.toFixed(2)}) are more than the ${label.toLowerCase()} total ($${b.total.toFixed(2)}).`);
    const t = b.lines.length ? await taxFn(b.lines) : { lines: [], totalTax: 0 };
    return { total: b.total, taxable, nonTaxable: r2(b.total - taxable), tax: r2(t.totalTax), collected: r2(b.total + t.totalTax) };
  };
  const cash = await per("Cash sales", blocks.cash);
  const card = await per("Card sales", blocks.card);

  const byCat = new Map<string, number>();
  for (const l of [...blocks.cash.lines, ...blocks.card.lines]) byCat.set(l.categoryId, r2((byCat.get(l.categoryId) || 0) + l.taxableAmount));
  const nonTaxable = r2(cash.nonTaxable + card.nonTaxable + blocks.snap);
  const categoryLines: BlockLine[] = Array.from(byCat, ([categoryId, taxableAmount]) => ({ categoryId, taxableAmount }));
  if (nonTaxable > 0) categoryLines.push({ categoryId: NON_TAXABLE_CATEGORY, taxableAmount: nonTaxable });

  const gross = r2(cash.total + card.total + blocks.snap);
  return {
    categoryLines, gross, tax: r2(cash.tax + card.tax),
    // Collected by card = card sales + the tax on them; SNAP carries no tax. Cash is whatever remains of the total collected.
    tenderCard: card.collected, tenderEbt: blocks.snap,
    perBlock: { cash, card, snap: { total: blocks.snap, collected: blocks.snap } },
  };
}

export function hasAnyBlockAmount(b: SalesBlocks): boolean {
  return b.cash.total > 0 || b.card.total > 0 || b.snap > 0;
}
