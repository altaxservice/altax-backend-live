import { query, queryOne } from "../config/db";

/**
 * Sales tax rate lookup shared by invoicing (billing.routes.ts) and the sales
 * tax calculator (calculators.routes.ts) — one source of truth for "what rate
 * applies to this state," reusing v3_tax_rates (matching an active,
 * firm-wide row whose rate_type mentions "sales" for the given state,
 * falling back to a state-less/national row, else 0). Not a full
 * multi-jurisdiction tax engine; a manual rate override always wins wherever
 * this is called from.
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
 * points), used only as a last-resort fallback when the state has neither a
 * Fee Schedule sales tax category (see listSalesTaxCategories below) nor a
 * legacy ILIKE '%sales%' rate row. This is the base state-level rate only —
 * it does not include county/city/district surtaxes, so it's a starting
 * point, not a quote. AK/DE/MT/NH/OR genuinely have no statewide general
 * sales tax (0 here is real, not missing data).
 */
export const STATE_BASE_SALES_TAX_RATES: Record<string, number> = {
  AL: 4, AK: 0, AZ: 5.6, AR: 6.5, CA: 7.25, CO: 2.9, CT: 6.35, DE: 0, DC: 6,
  FL: 6, GA: 4, HI: 4, ID: 6, IL: 6.25, IN: 7, IA: 6, KS: 6.5, KY: 6, LA: 4.45,
  ME: 5.5, MD: 6, MA: 6.25, MI: 6, MN: 6.875, MS: 7, MO: 4.225, MT: 0, NE: 5.5,
  NV: 6.85, NH: 0, NJ: 6.625, NM: 4.875, NY: 4, NC: 4.75, ND: 5, OH: 5.75,
  OK: 4.5, OR: 0, PA: 6, RI: 7, SC: 6, SD: 4.2, TN: 7, TX: 6.25, UT: 4.85,
  VT: 6, VA: 4.3, WA: 6.5, WV: 6, WI: 5, WY: 4,
};

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
 * state" — a single flat per-state rate (the old approach here) hides all of
 * this, which is exactly what a firm employee flagged when the Calculators
 * tool only ever showed one number per state.
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
  const rows = await query<any>(
    `SELECT c.category_id, c.category_name, c.filing_box_label, r.rate
     FROM altax.v3_sales_tax_categories c
     JOIN altax.v3_tax_rates r ON r.rate_id = c.default_rate_id AND (r.client_id IS NULL OR r.client_id = '')
     WHERE c.active = true AND c.state = $1
     ORDER BY c.display_order ASC, c.category_name ASC`,
    [state.toUpperCase()]
  );
  return rows.map((r) => ({
    categoryId: r.category_id,
    categoryName: r.category_name,
    rate: (Number(r.rate) || 0) * 100,
    filingBoxLabel: r.filing_box_label || null,
  }));
}

export interface SalesTaxLookupResult {
  rate: number;
  /**
   * "category" = a specific Fee Schedule sales tax category (General, Vape,
   * Alcohol, a local jurisdiction add-on, etc.); "firm" = an older-style
   * rate_type ILIKE '%sales%' row with no formal category; "published" =
   * STATE_BASE_SALES_TAX_RATES.
   */
  source: "category" | "firm" | "published";
  categoryName?: string;
}

/**
 * Resolves the rate to use for a state (and optionally a specific Fee
 * Schedule category within it): an explicit categoryId wins if it belongs to
 * this state; otherwise the state's lowest-display_order category (its
 * "General" rate, by Fee Schedule convention) is used as the default;
 * otherwise falls back to the legacy ILIKE '%sales%' row, then to
 * STATE_BASE_SALES_TAX_RATES. Used only by the Calculators tool —
 * billing.routes.ts intentionally keeps using the DB-only, category-blind
 * lookupSalesTaxRate above so invoices never silently pick up a rate the
 * firm didn't explicitly wire up for that purpose.
 */
export async function resolveSalesTaxRate(state: string | null, categoryId?: string | null): Promise<SalesTaxLookupResult> {
  const upper = state ? state.toUpperCase() : null;
  if (upper && categoryId) {
    const row = await queryOne<any>(
      `SELECT c.category_name, r.rate
       FROM altax.v3_sales_tax_categories c
       JOIN altax.v3_tax_rates r ON r.rate_id = c.default_rate_id AND (r.client_id IS NULL OR r.client_id = '')
       WHERE c.active = true AND c.state = $1 AND c.category_id = $2`,
      [upper, categoryId]
    );
    if (row) return { rate: (Number(row.rate) || 0) * 100, source: "category", categoryName: row.category_name };
  }
  if (upper) {
    const defaultCategory = await queryOne<any>(
      `SELECT c.category_name, r.rate
       FROM altax.v3_sales_tax_categories c
       JOIN altax.v3_tax_rates r ON r.rate_id = c.default_rate_id AND (r.client_id IS NULL OR r.client_id = '')
       WHERE c.active = true AND c.state = $1
       ORDER BY c.display_order ASC, c.category_name ASC LIMIT 1`,
      [upper]
    );
    if (defaultCategory) return { rate: (Number(defaultCategory.rate) || 0) * 100, source: "category", categoryName: defaultCategory.category_name };
  }
  const stateRow = upper
    ? await queryOne<any>(`SELECT rate FROM altax.v3_tax_rates WHERE active = true AND (client_id IS NULL OR client_id = '') AND rate_type ILIKE '%sales%' AND state = $1 ORDER BY updated_at DESC LIMIT 1`, [upper])
    : null;
  if (stateRow) return { rate: (Number(stateRow.rate) || 0) * 100, source: "firm" };
  const nationalRow = await queryOne<any>(`SELECT rate FROM altax.v3_tax_rates WHERE active = true AND (client_id IS NULL OR client_id = '') AND rate_type ILIKE '%sales%' AND (state IS NULL OR state = '') ORDER BY updated_at DESC LIMIT 1`);
  if (nationalRow) return { rate: (Number(nationalRow.rate) || 0) * 100, source: "firm" };
  const published = upper && upper in STATE_BASE_SALES_TAX_RATES ? STATE_BASE_SALES_TAX_RATES[upper] : 0;
  return { rate: published, source: "published" };
}
