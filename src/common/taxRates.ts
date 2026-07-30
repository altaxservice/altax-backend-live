import { query, queryOne } from "../config/db";
import { lookupRate } from "./accountingHelpers";

/**
 * Sales tax rate lookup used only by invoicing (billing.routes.ts) — matches
 * an active, firm-wide v3_tax_rates row whose rate_type mentions "sales" for
 * the given state, falling back to a state-less/national row, else 0. Not a
 * full multi-jurisdiction tax engine; a manual rate override always wins
 * wherever this is called from. The Calculators tool no longer uses this —
 * see computeSalesTaxLines below, which mirrors Accounting → Sales Input's
 * real per-category rate model instead of one flat number per state.
 *
 * Must filter to client_id IS NULL — v3_tax_rates also holds Client-scoped
 * rows (a specific client's local jurisdiction add-on, e.g. one client's
 * Allegheny County, PA surtax), and without this filter that one client's
 * override was leaking out as if it were every other client's general state
 * rate. (Can't additionally require scope = 'Global': the original seed
 * rows, e.g. Maryland's, predate the scope column and have scope IS NULL —
 * client_id IS NULL alone correctly separates firm-wide rows from
 * Client-scoped ones regardless of when the row was created.)
 *
 * v3_tax_rates.rate is stored as a fraction (e.g. 0.06 for 6%, per the Sales
 * Input convention `amount * rate`), but callers work in percentage points
 * (e.g. 6), so the fraction is scaled up by 100 here.
 */
export async function lookupSalesTaxRate(state: string | null): Promise<number> {
  const stateRow = state
    ? await queryOne<any>(`SELECT rate FROM altax.v3_tax_rates WHERE active = true AND (client_id IS NULL OR client_id = '') AND rate_type ILIKE '%sales%' AND state = $1 ORDER BY updated_at DESC LIMIT 1`, [state])
    : null;
  if (stateRow) return (Number(stateRow.rate) || 0) * 100;
  const nationalRow = await queryOne<any>(`SELECT rate FROM altax.v3_tax_rates WHERE active = true AND (client_id IS NULL OR client_id = '') AND rate_type ILIKE '%sales%' AND (state IS NULL OR state = '') ORDER BY updated_at DESC LIMIT 1`);
  return nationalRow ? (Number(nationalRow.rate) || 0) * 100 : 0;
}

/**
 * Each state's published general/statewide sales tax rate (percentage
 * points), used as the Calculators tool's synthetic category (see
 * PUBLISHED_RATE_CATEGORY_ID below) when a state has no Fee Schedule sales
 * tax categories configured at all. This is the base state-level rate
 * only — it does not include county/city/district surtaxes, so it's a
 * starting point, not a quote. AK/DE/MT/NH/OR genuinely have no statewide
 * general sales tax (0 here is real, not missing data).
 */
export const STATE_BASE_SALES_TAX_RATES: Record<string, number> = {
  AL: 4, AK: 0, AZ: 5.6, AR: 6.5, CA: 7.25, CO: 2.9, CT: 6.35, DE: 0, DC: 6,
  FL: 6, GA: 4, HI: 4, ID: 6, IL: 6.25, IN: 7, IA: 6, KS: 6.5, KY: 6, LA: 4.45,
  ME: 5.5, MD: 6, MA: 6.25, MI: 6, MN: 6.875, MS: 7, MO: 4.225, MT: 0, NE: 5.5,
  NV: 6.85, NH: 0, NJ: 6.625, NM: 4.875, NY: 4, NC: 4.75, ND: 5, OH: 5.75,
  OK: 4.5, OR: 0, PA: 6, RI: 7, SC: 6, SD: 4.2, TN: 7, TX: 6.25, UT: 4.85,
  VT: 6, VA: 4.3, WA: 6.5, WV: 6, WI: 5, WY: 4,
};

/**
 * A synthetic category id the Calculators tool hands back when a state has
 * no real v3_sales_tax_categories rows at all, so the same "pick a category,
 * enter an amount, add another line" UI works for every state uniformly
 * instead of needing a separate no-categories code path.
 */
export const PUBLISHED_RATE_CATEGORY_ID = "PUBLISHED-GENERAL";

export interface SalesTaxCategory {
  categoryId: string;
  categoryName: string;
  /** Percentage points (e.g. 6 for 6%). */
  rate: number;
  filingBoxLabel: string | null;
}

/**
 * The firm's own Fee Schedule sales tax categories for a state — e.g.
 * Maryland has General (6%), Special/Alcohol (12%), Vape (20%), a 60% Rate
 * Category, and Prepared Food, all as distinct v3_sales_tax_categories rows
 * each linked 1:1 to their own v3_tax_rates row via default_rate_id. This is
 * the real source of truth for "what does this firm actually charge in this
 * state" — a single flat per-state rate (the Calculators tool's first pass)
 * hides all of this. Mirrors GET /accounting/sales-categories's own filter
 * exactly (state match OR state IS NULL, for any state-independent
 * categories), so the two screens can never show a different list for the
 * same state. Falls back to a single synthetic "published rate" category
 * when the firm hasn't configured any real ones for this state, so the
 * calculator's line-item UI never has to special-case "no categories."
 *
 * The rate JOIN below deliberately does NOT require r.scope = 'Global' —
 * Maryland's General (ST6) and Special/Alcohol (ST12) rows predate the scope
 * column and have scope IS NULL, so requiring 'Global' silently dropped both
 * of them from every category list. client_id IS NULL is the correct,
 * scope-column-independent way to mean "firm-wide, not one client's
 * override" (see lookupSalesTaxRate's comment above for the original case
 * this was learned from).
 */
export async function listSalesTaxCategories(state: string | null): Promise<SalesTaxCategory[]> {
  if (!state) return [];
  const upper = state.toUpperCase();
  const rows = await query<any>(
    `SELECT c.category_id, c.category_name, c.filing_box_label, r.rate
     FROM altax.v3_sales_tax_categories c
     JOIN altax.v3_tax_rates r ON r.rate_id = c.default_rate_id AND (r.client_id IS NULL OR r.client_id = '')
     WHERE c.active = true AND (c.state = $1 OR c.state IS NULL)
     ORDER BY c.display_order ASC, c.category_name ASC`,
    [upper]
  );
  const categories: SalesTaxCategory[] = rows.map((r) => ({
    categoryId: r.category_id,
    categoryName: r.category_name,
    rate: (Number(r.rate) || 0) * 100,
    filingBoxLabel: r.filing_box_label || null,
  }));
  if (categories.length > 0) return categories;
  const published = upper in STATE_BASE_SALES_TAX_RATES ? STATE_BASE_SALES_TAX_RATES[upper] : 0;
  return [{
    categoryId: PUBLISHED_RATE_CATEGORY_ID,
    categoryName: `General Sales — Published Rate (${published}%)`,
    rate: published,
    filingBoxLabel: null,
  }];
}

export interface SalesTaxLineInput {
  categoryId: string;
  taxableAmount: number;
}

export interface SalesTaxLineResult {
  categoryId: string;
  categoryName: string;
  taxableAmount: number;
  /** Percentage points (e.g. 6 for 6%). */
  rate: number;
  taxAmount: number;
}

/**
 * Computes tax for one or more category lines in a state — the same
 * "Sales by Category" pattern Accounting → Sales Input uses (a repeatable
 * category + taxable-amount editor, e.g. $500 General + $200 Vape + $50
 * Alcohol as three lines in one calculation), reusing the exact same
 * lookupRate precedence Sales Input's own computeCategoryLinesTax uses
 * (called with no clientId, since the Calculators tool isn't tied to one
 * client's account — client-specific overrides don't apply here). Unknown
 * or zero-amount lines are silently skipped rather than erroring, since this
 * is a live-typing UI where an in-progress line (category picked, amount not
 * yet entered) is the normal case, not a mistake.
 */
export async function computeSalesTaxLines(state: string | null, rawLines: SalesTaxLineInput[]): Promise<{
  lines: SalesTaxLineResult[];
  totalTaxableAmount: number;
  totalTax: number;
}> {
  const upper = state ? state.toUpperCase() : null;
  const categoryIds = rawLines
    .map((l) => String(l.categoryId || "").trim())
    .filter((id) => id && id !== PUBLISHED_RATE_CATEGORY_ID);
  const dbCategories = categoryIds.length
    ? await query<any>(`SELECT category_id, category_name, default_rate_id FROM altax.v3_sales_tax_categories WHERE category_id = ANY($1::text[])`, [categoryIds])
    : [];
  const categoryMap = new Map(dbCategories.map((c) => [c.category_id, c]));

  const lines: SalesTaxLineResult[] = [];
  let totalTaxableAmount = 0;
  let totalTax = 0;
  for (const raw of rawLines) {
    const categoryId = String(raw.categoryId || "").trim();
    const taxableAmount = Math.round((Number(raw.taxableAmount) || 0) * 100) / 100;
    if (!categoryId || taxableAmount <= 0) continue;

    let categoryName: string;
    let rate: number;
    if (categoryId === PUBLISHED_RATE_CATEGORY_ID) {
      const published = upper && upper in STATE_BASE_SALES_TAX_RATES ? STATE_BASE_SALES_TAX_RATES[upper] : 0;
      categoryName = `General Sales — Published Rate (${published}%)`;
      rate = published;
    } else {
      const category = categoryMap.get(categoryId);
      if (!category) continue;
      categoryName = category.category_name;
      rate = category.default_rate_id ? (await lookupRate(category.default_rate_id, 0, undefined, upper || undefined)) * 100 : 0;
    }

    const taxAmount = Math.round(taxableAmount * (rate / 100) * 100) / 100;
    lines.push({ categoryId, categoryName, taxableAmount, rate, taxAmount });
    totalTaxableAmount += taxableAmount;
    totalTax += taxAmount;
  }
  return {
    lines,
    totalTaxableAmount: Math.round(totalTaxableAmount * 100) / 100,
    totalTax: Math.round(totalTax * 100) / 100,
  };
}
