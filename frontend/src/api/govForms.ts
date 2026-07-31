/** Shared types for Tools → Government Forms (2553, W-9, 8332 on a client; W-4 on an employee). */

export type ClientGovFormType = "SS4" | "2553" | "W9" | "8332" | "CRA";
export type EmployeeGovFormType = "W4";
export type GovFormType = ClientGovFormType | EmployeeGovFormType;

export interface GovFormFiling {
  filing_id: string;
  client_id: string | null;
  employee_id: string | null;
  form_type: GovFormType;
  form_data: Record<string, any>;
  status: "Draft" | "Signed" | "Submitted" | "Void";
  signed_at: string | null;
  signer_name: string | null;
  signer_title: string | null;
  submitted_via: string | null;
  submitted_at: string | null;
  submitted_note: string | null;
  created_at: string;
}

export interface GovFormsMeta {
  clientFormTypes: { value: ClientGovFormType; label: string }[];
  employeeFormTypes: { value: EmployeeGovFormType; label: string }[];
  form2553TaxYearTypes: string[];
  w9TaxClassifications: string[];
  w4FilingStatuses: string[];
  ss4EntityTypes: string[];
  ss4Reasons: string[];
  ss4Activities: string[];
  craReasons: string[];
  craTaxTypes: string[];
  craOwnershipTypes: string[];
}

export const GOV_FORM_LABELS: Record<GovFormType, string> = {
  SS4: "IRS Form SS-4 — Application for Employer Identification Number",
  "2553": "IRS Form 2553 — Election by a Small Business Corporation",
  W9: "IRS Form W-9 — Request for Taxpayer Identification Number",
  "8332": "IRS Form 8332 — Release of Claim to Exemption for Child",
  W4: "IRS Form W-4 — Employee's Withholding Certificate",
  CRA: "Maryland Form CRA — Combined Registration Application",
};

export const GOV_SUBMIT_VIA_OPTIONS = ["Mail", "Fax", "IRS Online Portal", "Hand-Delivered", "Kept on File"];

export const GOV_STATUS_COLOR: Record<string, string> = {
  Draft: "var(--muted)",
  Signed: "var(--teal)",
  Submitted: "var(--good, #1a7f37)",
  Void: "var(--danger, #cf222e)",
};
