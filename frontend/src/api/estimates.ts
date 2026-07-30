/** Shared types for Tools → Fee Schedule and Estimates. */

export interface FeeItem {
  fee_item_id: string;
  name: string;
  category: "Government" | "Service";
  agency: string | null;
  jurisdiction: string;
  entity_types: string[];
  business_types: string[];
  speed: string | null;
  amount_kind: "fixed" | "percent";
  percent_rate: string;
  unit_cost: string;
  unit_price: string;
  default_qty: string;
  included: boolean;
  optional: boolean;
  statewide: boolean;
  creates_task: boolean;
  turnaround_days: string | null;
  notes: string | null;
  active: boolean;
  sort_order: number;
}

export interface EstimateLine {
  line_id?: string;
  fee_item_id?: string | null;
  description: string;
  category: "Government" | "Service";
  agency?: string | null;
  qty: number;
  unit_cost: number;
  unit_price: number;
  amount_kind?: "fixed" | "percent";
  percent_rate?: number;
  included?: boolean;
  payer?: "Firm" | "Client";
  remitted_at?: string | null;
  remitted_amount?: number | null;
  remittance_ref?: string | null;
}

export interface EstimateTotals {
  serviceTotal: number;
  governmentTotal: number;
  clientDirectTotal: number;
  subtotal: number;
  discount: number;
  discountPercent: number;
  taxRate: number;
  tax: number;
  total: number;
  deposit: number;
  balanceDue: number;
  agencyCost: number;
  passThroughMargin: number;
  unremitted: number;
}

export interface Estimate {
  estimate_id: string;
  estimate_number: string;
  status: string;
  business_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  entity_type: string | null;
  business_type: string | null;
  jurisdiction: string | null;
  speed: string;
  estimate_date: string;
  valid_until: string | null;
  prepared_by: string | null;
  discount_amount: string;
  discount_percent: string;
  tax_rate: string;
  deposit_amount: string;
  deposit_date: string | null;
  terms: string | null;
  internal_note: string | null;
  approved_at: string | null;
  approved_by: string | null;
  approval_method: string | null;
  client_id: string | null;
  invoice_id: string | null;
  converted_at: string | null;
  totals?: EstimateTotals;
  line_count?: number;
}

/**
 * Picker values. Entity types drive which state filing applies; business types
 * drive which permits apply. Both are matched against the catalog's own lists,
 * so adding a type here without a matching fee row simply produces no extra lines.
 */
export const ENTITY_TYPES = ["LLC", "Corporation", "S-Corp", "C-Corp", "Close Corporation", "Nonstock", "Sole Proprietor", "Partnership"];

export const BUSINESS_TYPES = [
  "Restaurant / Carryout",
  "Food Retail",
  "Retail Store",
  "Convenience Store",
  "Trucking",
  "Construction",
  "Home-Based",
  "Professional / Office",
  "Other",
];

export const SPEEDS = ["Standard", "Expedited", "Rush"];

export const ESTIMATE_STATUSES = ["Draft", "Sent", "Approved", "Declined", "Expired"];

export const money = (n: number | string | null | undefined): string =>
  `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
