/** Shared types for Tools → Calculators. */

export interface SalesTaxResult {
  state: string | null;
  amount: number;
  rate: number;
  /** "firm" = a rate the firm configured under Fee Schedule; "published" = the state's general published rate (no local surtax). */
  source: "firm" | "published";
  taxAmount: number;
  total: number;
}
