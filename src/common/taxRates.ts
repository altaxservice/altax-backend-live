import { queryOne } from "../config/db";

/**
 * Sales tax rate lookup shared by invoicing (billing.routes.ts) and the sales
 * tax calculator (calculators.routes.ts) — one source of truth for "what rate
 * applies to this state," reusing v3_tax_rates (matching an active row whose
 * rate_type mentions "sales" for the given state, falling back to a
 * state-less/national row, else 0). Not a full multi-jurisdiction tax engine;
 * a manual rate override always wins wherever this is called from.
 *
 * v3_tax_rates.rate is stored as a fraction (e.g. 0.06 for 6%, per the Sales
 * Input convention `amount * rate`), but callers work in percentage points
 * (e.g. 6), so the fraction is scaled up by 100 here.
 */
export async function lookupSalesTaxRate(state: string | null): Promise<number> {
  const stateRow = state
    ? await queryOne<any>(`SELECT rate FROM altax.v3_tax_rates WHERE active = true AND rate_type ILIKE '%sales%' AND state = $1 ORDER BY updated_at DESC LIMIT 1`, [state])
    : null;
  if (stateRow) return (Number(stateRow.rate) || 0) * 100;
  const nationalRow = await queryOne<any>(`SELECT rate FROM altax.v3_tax_rates WHERE active = true AND rate_type ILIKE '%sales%' AND (state IS NULL OR state = '') ORDER BY updated_at DESC LIMIT 1`);
  return nationalRow ? (Number(nationalRow.rate) || 0) * 100 : 0;
}
