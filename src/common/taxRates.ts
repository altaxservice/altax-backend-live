import { queryOne } from "../config/db";

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
 * points), for states where the firm hasn't set up its own Fee Schedule
 * entry. This is the base state-level rate only — it does not include
 * county/city/district surtaxes (e.g. actual rates in CA or AL commonly run
 * several points higher locally), so it's a starting point, not a quote.
 * AK/DE/MT/NH/OR genuinely have no statewide general sales tax (0 here is
 * real, not missing data). Firm-entered Fee Schedule rates always win over
 * this table — see lookupSalesTaxRateWithSource below.
 */
export const STATE_BASE_SALES_TAX_RATES: Record<string, number> = {
  AL: 4, AK: 0, AZ: 5.6, AR: 6.5, CA: 7.25, CO: 2.9, CT: 6.35, DE: 0, DC: 6,
  FL: 6, GA: 4, HI: 4, ID: 6, IL: 6.25, IN: 7, IA: 6, KS: 6.5, KY: 6, LA: 4.45,
  ME: 5.5, MD: 6, MA: 6.25, MI: 6, MN: 6.875, MS: 7, MO: 4.225, MT: 0, NE: 5.5,
  NV: 6.85, NH: 0, NJ: 6.625, NM: 4.875, NY: 4, NC: 4.75, ND: 5, OH: 5.75,
  OK: 4.5, OR: 0, PA: 6, RI: 7, SC: 6, SD: 4.2, TN: 7, TX: 6.25, UT: 4.85,
  VT: 6, VA: 4.3, WA: 6.5, WV: 6, WI: 5, WY: 4,
};

export interface SalesTaxLookupResult {
  rate: number;
  /** "firm" = a Fee Schedule row the firm configured; "published" = this table's fallback. */
  source: "firm" | "published";
}

/**
 * Same lookup as lookupSalesTaxRate, but falls back to
 * STATE_BASE_SALES_TAX_RATES when the firm hasn't configured a rate for this
 * state, and reports which one was used. Used only by the Calculators tool —
 * billing.routes.ts intentionally keeps using the DB-only lookupSalesTaxRate
 * above so invoices never silently pick up a rate the firm didn't set.
 */
export async function lookupSalesTaxRateWithSource(state: string | null): Promise<SalesTaxLookupResult> {
  const upper = state ? state.toUpperCase() : null;
  const stateRow = upper
    ? await queryOne<any>(`SELECT rate FROM altax.v3_tax_rates WHERE active = true AND (client_id IS NULL OR client_id = '') AND rate_type ILIKE '%sales%' AND state = $1 ORDER BY updated_at DESC LIMIT 1`, [upper])
    : null;
  if (stateRow) return { rate: (Number(stateRow.rate) || 0) * 100, source: "firm" };
  const nationalRow = await queryOne<any>(`SELECT rate FROM altax.v3_tax_rates WHERE active = true AND (client_id IS NULL OR client_id = '') AND rate_type ILIKE '%sales%' AND (state IS NULL OR state = '') ORDER BY updated_at DESC LIMIT 1`);
  if (nationalRow) return { rate: (Number(nationalRow.rate) || 0) * 100, source: "firm" };
  const published = upper && upper in STATE_BASE_SALES_TAX_RATES ? STATE_BASE_SALES_TAX_RATES[upper] : 0;
  return { rate: published, source: "published" };
}
