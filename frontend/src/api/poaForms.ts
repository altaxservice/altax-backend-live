/** Shared types for Tools → IRS/MD Authorization filings (Form 2848, Form 8821, MD Form 548). */

export interface PoaRepresentative {
  name: string;
  firmName?: string;
  address: string;
  ptin?: string;
  cafNumber?: string;
  phone?: string;
  fax?: string;
  email?: string;
  sendCopies?: boolean;
  designation?: string;
  jurisdiction?: string;
  licenseNumber?: string;
}

export interface PoaTaxMatter {
  description: string;
  taxForm?: string;
  years?: string;
}

export interface PoaFiling {
  filing_id: string;
  client_id: string;
  form_type: "2848" | "8821" | "548";
  representatives: PoaRepresentative[];
  tax_matters: PoaTaxMatter[];
  retain_prior: boolean;
  notes: string | null;
  status: "Draft" | "Signed" | "Submitted" | "Void";
  signed_at: string | null;
  signer_name: string | null;
  signer_title: string | null;
  submitted_via: string | null;
  submitted_at: string | null;
  submitted_note: string | null;
  created_at: string;
}

export interface PoaRepresentativeOption {
  user_id: string;
  name: string;
  email: string;
  phone: string | null;
  ptin: string | null;
  caf_number: string | null;
}

export const FORM_LABELS: Record<string, string> = {
  "2848": "IRS Form 2848 — POA & Declaration of Representative",
  "8821": "IRS Form 8821 — Tax Information Authorization",
  "548": "Maryland Form 548 — Power of Attorney",
};

export const SUBMIT_VIA_OPTIONS = ["Mail", "Fax", "IRS Online Portal", "Hand-Delivered"];

export const STATUS_COLOR: Record<string, string> = {
  Draft: "var(--muted)",
  Signed: "var(--teal)",
  Submitted: "var(--green)",
  Void: "var(--red)",
};
