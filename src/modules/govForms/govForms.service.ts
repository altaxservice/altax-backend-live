/**
 * Aggregates the government-form generators — each form's own field-mapping
 * work lives in its own file (form2553.ts, w9.ts, form8332.ts, w4.ts, ss4.ts)
 * since they share almost no fields with each other (unlike the three POA
 * forms, which all fill out the same taxpayer/representatives/tax-matters
 * shape — see poaForms.service.ts). This file just plays the same
 * dispatcher role poaForms.service.ts's generatePoaForm does, so the routes
 * layer never needs to know which module a given form_type's generator
 * actually lives in.
 */
import { generateForm2553, type Form2553Data } from "./form2553";
import { generateW9, type W9Data } from "./w9";
import { generateForm8332, type Form8332Data } from "./form8332";
import { generateW4, type W4Data } from "./w4";
import { generateSs4, type Ss4Data } from "./ss4";
import { generateCra, type CraData } from "./cra";

export type { Form2553Data, Form2553Shareholder } from "./form2553";
export { FORM2553_TAX_YEAR_TYPES } from "./form2553";
export type { W9Data } from "./w9";
export { W9_TAX_CLASSIFICATIONS } from "./w9";
export type { Form8332Data, Form8332Part, Form8332PartI } from "./form8332";
export type { W4Data } from "./w4";
export { W4_FILING_STATUSES } from "./w4";
export type { Ss4Data } from "./ss4";
export { SS4_ENTITY_TYPES, SS4_REASONS, SS4_ACTIVITIES } from "./ss4";
export type { CraData } from "./cra";
export { CRA_REASONS, CRA_TAX_TYPES, CRA_OWNERSHIP_TYPES } from "./cra";

/** Client-level forms — attached to v3_gov_form_filings.client_id. */
export const CLIENT_GOV_FORM_TYPES = ["SS4", "2553", "W9", "8332", "CRA"] as const;
/** Employee-level forms — attached to v3_gov_form_filings.employee_id. W-4 (withholding election) and W-9 (TIN certification for a contractor) are both kept on file with the employer/payer, never sent to the IRS. */
export const EMPLOYEE_GOV_FORM_TYPES = ["W4", "W9"] as const;

export type GovFormType = (typeof CLIENT_GOV_FORM_TYPES)[number] | (typeof EMPLOYEE_GOV_FORM_TYPES)[number];

export async function generateGovForm(formType: string, formData: any): Promise<Uint8Array> {
  switch (formType) {
    case "SS4": return generateSs4(formData as Ss4Data);
    case "2553": return generateForm2553(formData as Form2553Data);
    case "W9": return generateW9(formData as W9Data);
    case "8332": return generateForm8332(formData as Form8332Data);
    case "W4": return generateW4(formData as W4Data);
    case "CRA": return generateCra(formData as CraData);
    default: throw new Error(`Unknown government form type: ${formType}`);
  }
}
