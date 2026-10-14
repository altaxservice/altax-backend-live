import type { Answers } from "./engine";

/** Who normally signs each built document, taken from the answers (a role name + which answer holds the person's name, or a list of people). */
type Spec = { role: string; nameId?: string; listId?: string; listNameId?: string; onlyIf?: string };

const SPEC: Record<string, Spec[]> = {
  fee_agreement: [{ role: "Client", nameId: "clientName" }, { role: "Firm", nameId: "firmName" }],
  engagement_letter: [{ role: "Client", nameId: "clientName" }, { role: "Firm", nameId: "firmName" }],
  authorization_release: [{ role: "Client", nameId: "clientName" }],
  llc_operating_agreement: [{ role: "Member", listId: "members", listNameId: "name" }],
  partnership_agreement: [{ role: "Partner", listId: "partners", listNameId: "name" }],
  profit_sharing_agreement: [{ role: "Owner", listId: "owners", listNameId: "name" }],
  business_bill_of_sale: [{ role: "Seller", nameId: "seller" }, { role: "Buyer", nameId: "buyer" }],
  offer_letter: [{ role: "Employer", nameId: "employer" }, { role: "Employee", nameId: "employee" }],
  contractor_agreement: [{ role: "Company", nameId: "company" }, { role: "Contractor", nameId: "contractor" }],
  demand_letter: [{ role: "Sender", nameId: "sender" }],
  promissory_note: [{ role: "Borrower", nameId: "borrower" }, { role: "Lender", nameId: "lender" }],
  nda_mutual: [{ role: "First party", nameId: "partyA" }, { role: "Second party", nameId: "partyB" }],
  commercial_lease_short: [{ role: "Landlord", nameId: "landlord" }, { role: "Tenant", nameId: "tenant" }],
  single_member_llc_agreement: [{ role: "Member", nameId: "member" }],
  corporate_resolution: [{ role: "Approver", listId: "signers", listNameId: "name" }],
  annual_meeting_minutes: [{ role: "Chairperson", nameId: "chair" }, { role: "Secretary", nameId: "secretary" }],
  shareholder_loan_agreement: [{ role: "Company", nameId: "companySigner" }, { role: "Owner", nameId: "owner" }],
  payment_agreement: [{ role: "Debtor", nameId: "debtor" }, { role: "Creditor", nameId: "creditor" }],
  employment_contract: [{ role: "Employer", nameId: "employer" }, { role: "Employee", nameId: "employee" }],
  termination_of_services: [{ role: "Firm representative", nameId: "firmName" }],
  document_request_letter: [{ role: "Firm representative", nameId: "firmName" }],
  employee_warning_letter: [{ role: "Issuer", nameId: "managerName" }, { role: "Employee (received)", nameId: "employee" }],
  employment_termination_letter: [{ role: "Employer", nameId: "employer" }, { role: "Employee (received)", nameId: "employee" }],
  employment_verification_letter: [{ role: "Employer representative", nameId: "signerName" }],
  resignation_letter: [{ role: "Employee", nameId: "employee" }],
  service_agreement: [{ role: "Provider", nameId: "provider" }, { role: "Customer", nameId: "customer" }],
  consulting_agreement: [{ role: "Company", nameId: "client" }, { role: "Consultant", nameId: "consultant" }],
  lease_termination_agreement: [{ role: "Landlord", nameId: "landlord" }, { role: "Tenant", nameId: "tenant" }],
  workplace_incident_report: [{ role: "Person involved", nameId: "person" }],
  affidavit_general: [{ role: "Affiant", nameId: "affiant" }],
  child_travel_consent: [{ role: "Parent / guardian", nameId: "parent" }, { role: "Second parent / guardian", nameId: "parent2", onlyIf: "secondParent" }],
  lease_residential: [{ role: "Landlord", nameId: "landlord" }, { role: "Tenant", listId: "tenants", listNameId: "name" }],
  lease_commercial: [{ role: "Landlord", nameId: "landlord" }, { role: "Tenant", nameId: "tenant" }, { role: "Guarantor", nameId: "guarantor", onlyIf: "guarantee" }],
  property_sale_residential: [{ role: "Seller", nameId: "seller" }, { role: "Buyer", nameId: "buyer" }],
  property_sale_commercial: [{ role: "Seller", nameId: "seller" }, { role: "Buyer", nameId: "buyer" }],
  business_poa: [{ role: "Owner (for the business)", nameId: "owner" }, { role: "Agent", nameId: "agent" }],
  limited_poa_filings: [{ role: "Business (by its owner / officer)", nameId: "signerName" }, { role: "Attorney-in-Fact", nameId: "rep1" }, { role: "Attorney-in-Fact", nameId: "rep2", onlyIf: "rep2" }],
  general_poa: [{ role: "Principal", nameId: "principal" }, { role: "Agent", nameId: "agent" }],
  business_sale_agreement: [{ role: "Seller", nameId: "seller" }, { role: "Buyer", nameId: "buyer" }],
  ownership_transfer: [{ role: "Transferor", nameId: "assignor" }, { role: "Transferee", nameId: "assignee" }, { role: "Company", nameId: "companySigner" }],
  personal_guaranty: [{ role: "Guarantor", nameId: "guarantor" }, { role: "Creditor", nameId: "creditor" }],
  non_compete: [{ role: "Company", nameId: "company" }, { role: "Person", nameId: "person" }],
  lease_amendment: [{ role: "Landlord", nameId: "landlord" }, { role: "Tenant", nameId: "tenant" }],
  gift_letter: [{ role: "Donor", nameId: "donor" }, { role: "Recipient", nameId: "recipient" }],
};

/** These need a notary's own signature and seal; an electronic signature does not replace that. */
export const NEEDS_NOTARY = new Set(["affidavit_general", "child_travel_consent", "general_poa", "business_poa", "limited_poa_filings"]);

export function suggestSigners(templateKey: string, answers: Answers): { role: string; name: string }[] {
  const out: { role: string; name: string }[] = [];
  for (const s of SPEC[templateKey] || []) {
    if (s.onlyIf && !answers[s.onlyIf]) continue;
    if (s.listId) {
      const rows = Array.isArray(answers[s.listId]) ? (answers[s.listId] as Answers[]) : [];
      rows.forEach((r, i) => { const name = String(r[s.listNameId || "name"] || "").trim(); if (name) out.push({ role: rows.length > 1 ? `${s.role} ${i + 1}` : s.role, name }); });
    } else {
      const name = String(answers[s.nameId || ""] || "").trim();
      if (name) out.push({ role: s.role, name });
    }
  }
  return out;
}
