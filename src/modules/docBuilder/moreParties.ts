/**
 * Documents where one side of the deal can be more than one person or company (co-owners, spouses, joint borrowers, two partners
 * selling together ...). For each such role the wizard adds an optional "Other X who also sign" list next to the main party field,
 * and the finished document gets an ADDITIONAL SIGNATURES page that names each extra party, says each is bound together with the others
 * and also alone, and gives each a signature block. They also appear as signers for e-signing and on the notary pages.
 * Templates that already have their own list for a side (members, partners, borrowers, tenants, co-landlords ...) are not listed here.
 * The list question id is `more_<nameId>`.
 */
export interface MoreParty { nameId: string; role: string; roleAr: string; plural?: string; pluralAr?: string }

const CLIENT: MoreParty = { nameId: "clientName", role: "Client", roleAr: "العميل", plural: "clients" };
const SELLER: MoreParty = { nameId: "seller", role: "Seller", roleAr: "البائع", plural: "sellers" };
const BUYER: MoreParty = { nameId: "buyer", role: "Buyer", roleAr: "المشتري", plural: "buyers" };
const GUARANTOR: MoreParty = { nameId: "guarantor", role: "Guarantor", roleAr: "الكفيل", plural: "guarantors" };

export const MORE_PARTIES: Record<string, MoreParty[]> = {
  fee_agreement: [CLIENT],
  engagement_letter: [CLIENT],
  authorization_release: [CLIENT],
  business_bill_of_sale: [SELLER, BUYER],
  contractor_agreement: [{ nameId: "company", role: "Company", roleAr: "الشركة", plural: "companies" }, { nameId: "contractor", role: "Contractor", roleAr: "المقاول", plural: "contractors" }],
  demand_letter: [{ nameId: "sender", role: "Sender", roleAr: "المرسِل", plural: "senders" }],
  promissory_note: [{ nameId: "borrower", role: "Borrower", roleAr: "المقترض", plural: "borrowers" }, { nameId: "lender", role: "Lender", roleAr: "المقرِض", plural: "lenders" }],
  nda_mutual: [{ nameId: "partyA", role: "First party", roleAr: "الطرف الأول", plural: "people or companies on the first side" }, { nameId: "partyB", role: "Second party", roleAr: "الطرف الثاني", plural: "people or companies on the second side" }],
  shareholder_loan_agreement: [{ nameId: "owner", role: "Owner", roleAr: "المالك", plural: "owners (lenders)" }],
  payment_agreement: [{ nameId: "debtor", role: "Debtor", roleAr: "المدين", plural: "debtors" }, { nameId: "creditor", role: "Creditor", roleAr: "الدائن", plural: "creditors" }],
  service_agreement: [{ nameId: "provider", role: "Provider", roleAr: "مقدّم الخدمة", plural: "providers" }, { nameId: "customer", role: "Customer", roleAr: "العميل", plural: "customers" }],
  consulting_agreement: [{ nameId: "client", role: "Company", roleAr: "الشركة", plural: "companies" }, { nameId: "consultant", role: "Consultant", roleAr: "المستشار", plural: "consultants" }],
  loan_agreement: [{ nameId: "lender", role: "Lender", roleAr: "المقرِض", plural: "lenders" }],
  letter_of_intent: [{ nameId: "purchaser", role: "Purchaser", roleAr: "المشتري", plural: "purchasers" }, SELLER],
  sales_agreement: [SELLER, BUYER],
  termination_agreement: [{ nameId: "partyA", role: "First party", roleAr: "الطرف الأول", plural: "people or companies on the first side" }, { nameId: "partyB", role: "Second party", roleAr: "الطرف الثاني", plural: "people or companies on the second side" }, GUARANTOR],
  termination_of_purchase: [SELLER, BUYER],
  commercial_sublease: [{ nameId: "subtenant", role: "Subtenant", roleAr: "المستأجر من الباطن", plural: "subtenants" }, GUARANTOR, { nameId: "landlord", role: "Landlord (consent)", roleAr: "المؤجِّر (الموافقة)", plural: "landlords (who consent)" }],
  lease_residential: [{ nameId: "masterOwner", role: "Owner (consent)", roleAr: "المالك (الموافقة)", plural: "owners (who consent)" }],
  lease_commercial: [GUARANTOR],
  commercial_lease_short: [GUARANTOR],
  lease_termination_agreement: [GUARANTOR],
  lease_amendment: [GUARANTOR],
  property_sale_residential: [SELLER, BUYER],
  property_sale_commercial: [SELLER, BUYER],
  business_sale_agreement: [SELLER, BUYER],
  business_poa: [{ nameId: "owner", role: "Owner (for the business)", roleAr: "المالك (عن النشاط)", plural: "owners" }],
  general_poa: [{ nameId: "principal", role: "Principal", roleAr: "الموكِّل", plural: "principals" }],
  ownership_transfer: [{ nameId: "assignor", role: "Transferor", roleAr: "المتنازِل", plural: "transferors" }, { nameId: "assignee", role: "Transferee", roleAr: "المتنازَل إليه", plural: "transferees" }],
  personal_guaranty: [GUARANTOR, { nameId: "creditor", role: "Creditor", roleAr: "الدائن", plural: "creditors" }],
  gift_letter: [{ nameId: "donor", role: "Donor", roleAr: "الواهب", plural: "donors" }, { nameId: "recipient", role: "Recipient", roleAr: "الموهوب له", plural: "recipients" }],
  ach_authorization: [{ nameId: "customer", role: "Customer", roleAr: "صاحب الحساب", plural: "account holders" }],
};

export const moreListId = (nameId: string) => `more_${nameId}`;

/** The extra people or companies named for one role, in order. */
export function extraNames(answers: Record<string, any>, p: MoreParty): string[] {
  const rows = answers[moreListId(p.nameId)];
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => String((r && r.name) || "").trim()).filter(Boolean);
}
