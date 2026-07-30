/** Shared types for Tools → Calculators. */

export interface SalesTaxResult {
  state: string | null;
  amount: number;
  rate: number;
  taxAmount: number;
  total: number;
}
