/** Shared types for Tools → Calculators. */

export interface SalesTaxCategory {
  categoryId: string;
  categoryName: string;
  rate: number;
  filingBoxLabel: string | null;
}

export interface SalesTaxLineResult {
  categoryId: string;
  categoryName: string;
  taxableAmount: number;
  rate: number;
  taxAmount: number;
}

export interface SalesTaxPreviewResult {
  state: string | null;
  lines: SalesTaxLineResult[];
  totalTaxableAmount: number;
  totalTax: number;
  grandTotal: number;
}
