/** Shared types for Tools → Calculators. */

export interface SalesTaxCategory {
  categoryId: string;
  categoryName: string;
  rate: number;
  filingBoxLabel: string | null;
}

export interface SalesTaxResult {
  state: string | null;
  amount: number;
  rate: number;
  /** "category" = a specific Fee Schedule sales tax category; "firm" = an older un-categorized firm rate; "published" = the state's general published rate (no local surtax). */
  source: "category" | "firm" | "published";
  categoryName: string | null;
  taxAmount: number;
  total: number;
}
