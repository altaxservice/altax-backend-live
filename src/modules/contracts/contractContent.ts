/**
 * The firm's canonical list of service lines, plus the built-in engagement-letter
 * text for each — mirrors templates.routes.ts's BUILT_IN/override pattern exactly:
 * this content is the code-level fallback; saving a template with the same
 * service_key in v3_contract_templates overrides it (see resolveContractTemplate
 * in contracts.routes.ts), so wording can be tightened after an attorney review
 * without a deploy.
 *
 * Every generated contract is SERVICE-SPECIFIC SCOPE (this file, varies per
 * service) + GENERAL_TERMS (this file, shared, appended once) — kept as two
 * pieces rather than seven duplicated copies of the boilerplate so a change to
 * the shared liability/e-sign/governing-law language only has to happen once.
 *
 * This is drafted to be genuinely protective (liability caps, no-guarantee-of-
 * outcome language, reliance-on-client-information disclaimers, the mandatory
 * immigration non-attorney disclosure) but it is still template language, not
 * a substitute for a licensed attorney's review of the firm's actual risk
 * profile — flagged to the user at build time, worth repeating here in code.
 */

export interface FirmService {
  key: string;
  label: string;
}

export const FIRM_SERVICES: FirmService[] = [
  { key: "tax_prep", label: "Tax Preparation" },
  { key: "bookkeeping", label: "Bookkeeping & Accounting" },
  { key: "payroll", label: "Payroll Services" },
  { key: "sales_tax", label: "Sales Tax & Business Compliance" },
  { key: "formation", label: "Business Formation & Registered Agent" },
  { key: "immigration", label: "Immigration Document Preparation" },
  { key: "consulting", label: "Other Consulting & Administrative Services" },
];

export const SERVICE_LABEL: Record<string, string> = Object.fromEntries(FIRM_SERVICES.map((s) => [s.key, s.label]));

/**
 * Appended to every generated contract after the service-specific scope section.
 * Its own service_key ("general_terms") makes it editable through the same
 * override mechanism as everything else in this file.
 */
export const GENERAL_TERMS_KEY = "general_terms";
export const GENERAL_TERMS_TITLE = "General Terms & Conditions";
export const GENERAL_TERMS_BODY = `GENERAL TERMS & CONDITIONS

1. RELIANCE ON CLIENT INFORMATION. {{firmName}} will rely on the accuracy and completeness of the information, documents, and instructions Client provides. {{firmName}} does not independently verify or audit information supplied by Client and is not responsible for errors, penalties, or losses resulting from incomplete, inaccurate, or untimely information provided by Client.

2. NO GUARANTEE OF OUTCOME. {{firmName}} will perform the services described above using reasonable professional care. {{firmName}} does not guarantee any specific result, refund amount, filing outcome, approval, or government processing time, and is not responsible for delays or decisions made by the IRS, any state agency, or any other government body outside {{firmName}}'s control.

3. CLIENT RESPONSIBILITIES. Client agrees to provide requested documents and information in a timely manner, to review all documents and filings prepared on Client's behalf before they are submitted or relied upon, and to promptly notify {{firmName}} of any changes that may affect the services described above.

4. FEES & PAYMENT. Fees for this engagement are {{feeAmount}}. Fees are due as invoiced; {{firmName}} may suspend services for accounts with an outstanding balance. Fees already paid are non-refundable once the corresponding work has been performed.

5. LIMITATION OF LIABILITY. To the fullest extent permitted by law, {{firmName}}'s total liability arising out of or relating to this engagement, whether in contract, tort, or otherwise, is limited to the fees actually paid by Client for the specific service giving rise to the claim. In no event will {{firmName}} be liable for indirect, incidental, consequential, special, or punitive damages, including lost profits, even if advised of the possibility of such damages.

6. CONFIDENTIALITY & DATA SECURITY. {{firmName}} will maintain the confidentiality of Client's information consistent with applicable law and {{firmName}}'s written information security policy, and will not disclose it to third parties except as required to perform the services described above, as required by law, or with Client's consent.

7. TERM & TERMINATION. This engagement continues until the described services are completed or either party terminates it in writing. Termination does not affect fees owed for work already performed, and Client remains responsible for meeting any deadlines already in progress at the time of termination.

8. NO LEGAL OR INVESTMENT ADVICE. Unless the specific service described above expressly states otherwise, {{firmName}} is not a law firm and does not provide legal advice, and does not provide personalized investment or financial-planning advice. Client should consult a licensed attorney or financial advisor for matters requiring that expertise.

9. ELECTRONIC SIGNATURE CONSENT. Client agrees to conduct this transaction electronically and consents to sign this agreement using an electronic signature, which Client agrees has the same legal effect as a handwritten signature. Client may request a paper copy of this agreement at any time.

10. GOVERNING LAW. This agreement is governed by the laws of the State of Maryland, without regard to conflict-of-law principles, and any dispute arising from it will be resolved in a court of competent jurisdiction in Maryland.

11. ENTIRE AGREEMENT. This agreement, together with the service description above, is the entire agreement between Client and {{firmName}} regarding the services described, and supersedes any prior discussions. It may only be amended in writing signed (including electronically) by both parties.`;

export const BUILT_IN_CONTRACT_TEMPLATES: { serviceKey: string; title: string; body: string }[] = [
  {
    serviceKey: "tax_prep",
    title: "Tax Preparation Engagement Letter",
    body: `TAX PREPARATION ENGAGEMENT LETTER

This letter confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for tax preparation services, effective {{effectiveDate}}.

SCOPE OF SERVICES. Firm will prepare Client's federal and applicable state income tax return(s) for the period specified based on information and documents Client provides. Firm's preparer will sign the return as paid preparer where required by law.

CLIENT RESPONSIBILITY FOR ACCURACY. Client is solely responsible for the accuracy and completeness of the information provided, including income, deductions, and credits claimed. Client remains ultimately responsible for the contents of the filed return, even though Firm prepared it. Client should review the completed return carefully before signing or authorizing e-file.

NO GUARANTEE OF REFUND OR AUDIT OUTCOME. Firm does not guarantee any specific refund amount, tax liability, or outcome if the return is selected for examination or audit by a taxing authority. Representation before the IRS or a state agency in connection with an audit, notice, or examination is a separate engagement with a separate fee unless otherwise agreed in writing.

RECORD RETENTION. Client is responsible for retaining copies of all documents supporting items reported on the return, consistent with applicable record-retention requirements.`,
  },
  {
    serviceKey: "bookkeeping",
    title: "Bookkeeping & Accounting Services Agreement",
    body: `BOOKKEEPING & ACCOUNTING SERVICES AGREEMENT

This agreement confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for bookkeeping and accounting services, effective {{effectiveDate}}.

SCOPE OF SERVICES. Firm will record and organize Client's financial transactions and produce periodic financial reports (such as a profit-and-loss statement and balance sheet) based on records, statements, and information Client provides.

NOT AN AUDIT, REVIEW, OR ATTESTATION. These services are bookkeeping/compilation services only. They do not constitute an audit, review, or compilation engagement performed under professional accounting or auditing standards, and no assurance or opinion is expressed on the resulting financial statements. Financial statements prepared under this engagement may not be suitable for third parties (such as lenders or investors) who require audited or reviewed financials.

CLIENT RESPONSIBILITY FOR SOURCE RECORDS. Client is responsible for providing complete and accurate source documents (bank and card statements, receipts, sales records, etc.) in a timely manner. Firm's work product reflects only the transactions and records Client provides; Firm is not responsible for errors resulting from missing, incomplete, or inaccurate source records.`,
  },
  {
    serviceKey: "payroll",
    title: "Payroll Services Agreement",
    body: `PAYROLL SERVICES AGREEMENT

This agreement confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for payroll processing services, effective {{effectiveDate}}.

SCOPE OF SERVICES. Firm will process payroll and prepare related federal and state payroll tax filings for Client's employees based on wage, hour, and employee information Client provides, and where authorized, may file payroll tax forms on Client's behalf as Client's reporting agent.

CLIENT REMAINS THE EMPLOYER OF RECORD. Client remains the employer of record for all employees at all times and retains ultimate responsibility for compliance with wage-and-hour law, employee classification (employee vs. contractor), and the accuracy of hours, pay rates, and other data submitted to Firm. Firm processes payroll based on the data Client submits and is not responsible for errors resulting from inaccurate or late data.

TIMELY SUBMISSION REQUIRED. Client agrees to submit payroll data by the deadlines Firm communicates for each pay period. Late submissions may result in late or off-cycle payroll, and any resulting penalties are Client's responsibility.

AUTHORIZATION TO FILE. Where Firm files payroll tax forms on Client's behalf, Client agrees to sign any required reporting-agent authorization (such as IRS Form 8655) and the equivalent state-level authorization promptly upon request.`,
  },
  {
    serviceKey: "sales_tax",
    title: "Sales Tax & Business Compliance Agreement",
    body: `SALES TAX & BUSINESS COMPLIANCE AGREEMENT

This agreement confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for sales tax filing and related business compliance services, effective {{effectiveDate}}.

SCOPE OF SERVICES. Firm will calculate and file Client's periodic sales and use tax returns based on sales records, point-of-sale data, and other information Client provides, and may assist with related state business-compliance filings as agreed.

CLIENT RESPONSIBILITY FOR UNDERLYING DATA. Client is responsible for the accuracy of sales records provided, including the correct classification of taxable and exempt sales. Firm relies on the data and classifications Client provides and is not responsible for penalties or assessments resulting from inaccurate or incomplete underlying sales data.

FILING DEADLINES. Client agrees to provide sales data to Firm with enough time before each filing deadline for Firm to prepare and file the return. Data received after Firm's stated cutoff may result in a late filing, and any resulting penalties or interest are Client's responsibility.`,
  },
  {
    serviceKey: "formation",
    title: "Business Formation & Registered Agent Agreement",
    body: `BUSINESS FORMATION & REGISTERED AGENT AGREEMENT

This agreement confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for business formation and/or registered agent services, effective {{effectiveDate}}.

SCOPE OF SERVICES. Firm will prepare and file the formation documents and related registrations (such as EIN application) Client requests with the applicable state and/or federal agency, based on the entity type, name, and structure Client selects. Where engaged as registered agent, Firm will accept legal and state correspondence on Client's behalf at the address on file and forward it to Client promptly.

FILING SERVICE ONLY — NOT LEGAL OR TAX ADVICE ON ENTITY CHOICE. Firm's services are limited to preparing and filing the documents Client requests. Firm does not provide legal advice on which entity type or structure is right for Client; Client is encouraged to consult an attorney or CPA before making that decision if the choice is not straightforward.

STATE FEES SEPARATE. State filing fees, registered-agent fees for future years, and any franchise or annual-report fees are separate from Firm's service fee, are billed to Client directly or passed through, and are non-refundable once paid to the state.

REGISTERED AGENT — CLIENT RESPONSIBILITY TO RESPOND. If Firm serves as Client's registered agent, Client is responsible for promptly reviewing and responding to any document Firm forwards, including time-sensitive legal notices. Firm's role is limited to accepting and forwarding documents; Firm does not evaluate their legal significance.`,
  },
  {
    serviceKey: "immigration",
    title: "Immigration Document Preparation Agreement",
    body: `IMMIGRATION DOCUMENT PREPARATION AGREEMENT

This agreement confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for immigration document preparation services, effective {{effectiveDate}}.

IMPORTANT NOTICE — {{firmName}} IS NOT A LAW FIRM. {{firmName}} and its staff are NOT attorneys and are not authorized to practice law. {{firmName}} does NOT provide legal advice, does NOT tell Client which immigration form, benefit, or status to apply for, does NOT evaluate the legal merits or likelihood of success of Client's case, and does NOT represent Client before USCIS, any immigration court, or any other government body. {{firmName}} assists ONLY with the mechanical preparation of forms — typing, organizing, and submitting paperwork — strictly according to Client's own instructions and choices.

CLIENT DIRECTS THE FORM AND CONTENT. Client is solely responsible for deciding which application or petition to file and for the accuracy of every fact stated in it. Firm may point out that required fields are blank or that supporting documents appear to be missing, but does not decide what Client should submit.

RECOMMENDATION TO CONSULT AN ATTORNEY. If Client's matter involves any legal complexity, prior immigration violations, criminal history, a denial, or anything Client is unsure how to answer, {{firmName}} strongly recommends Client consult a licensed immigration attorney before proceeding. Firm can provide a referral on request but does not act as Client's legal representative.

NO GUARANTEE OF APPROVAL. Firm does not guarantee that any application or petition will be approved, and is not responsible for USCIS or other government processing times, decisions, or delays, all of which are outside Firm's control.

ACKNOWLEDGMENT. By signing below, Client acknowledges having read and understood this notice, confirms that Firm has not provided legal advice, and confirms that all information provided to Firm for inclusion on any form is true and complete to Client's own knowledge.`,
  },
  {
    serviceKey: "consulting",
    title: "Consulting & Administrative Services Agreement",
    body: `CONSULTING & ADMINISTRATIVE SERVICES AGREEMENT

This agreement confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for the consulting and/or administrative services described below, effective {{effectiveDate}}.

SCOPE OF SERVICES. Firm will provide general business, administrative, or advisory support to Client as separately described or agreed between the parties.

INFORMATIONAL ONLY. Services under this agreement are advisory and informational in nature and are not a substitute for legal, investment, or other licensed professional advice. Where a matter requires legal, financial-planning, or other licensed expertise, Client should consult an appropriately licensed professional.`,
  },
];
