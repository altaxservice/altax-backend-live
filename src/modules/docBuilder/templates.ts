import type { DocTemplate, Question } from "./engine";

/**
 * The Document Builder's library. Each entry is data only — questions and wording — so adding a document never needs new code.
 * The wording is a plain-language starting template for the firm's own use, written to be reviewed (and edited) before it is relied on.
 */
const text = (id: string, label: string, o: Partial<Question> = {}): Question => ({ id, label, type: "text", ...o });
const area = (id: string, label: string, o: Partial<Question> = {}): Question => ({ id, label, type: "textarea", ...o });
const date = (id: string, label: string, o: Partial<Question> = {}): Question => ({ id, label, type: "date", ...o });
const money = (id: string, label: string, o: Partial<Question> = {}): Question => ({ id, label, type: "money", ...o });
const num = (id: string, label: string, o: Partial<Question> = {}): Question => ({ id, label, type: "number", ...o });
const yesno = (id: string, label: string, o: Partial<Question> = {}): Question => ({ id, label, type: "yesno", ...o });
const pick = (id: string, label: string, options: [string, string][], o: Partial<Question> = {}): Question => ({ id, label, type: "select", options: options.map(([value, label]) => ({ value, label })), ...o });
const list = (id: string, label: string, fields: Question[], o: Partial<Question> = {}): Question => ({ id, label, type: "list", fields, ...o });
const state = (o: Partial<Question> = {}) => text("state", "Governing law — state", { default: "Maryland", required: true, ...o });
const effective = () => date("effectiveDate", "Date of this document", { prefill: "today", required: true });
const SIGN = (...names: string[]) => names.map((n) => `${n}\n\nSignature: ______________________________   Date: ______________\nPrinted name: ${""}`).join("\n\n");

const CLIENT_SERVICE = "Client services";
const BUSINESS = "Business formation & ownership";
const EMPLOYMENT = "Employment & payroll";
const LENDING = "Lending, lease & general";
const FAMILY = "Family & personal";
const REAL_ESTATE = "Real estate";

export const DOC_TEMPLATES: DocTemplate[] = [
  /* ─────────────── Client services ─────────────── */
  {
    key: "fee_agreement", title: "Fee Agreement", category: CLIENT_SERVICE,
    description: "Spells out what the firm will do, what it costs and when it is paid.",
    reviewNote: "A tax practitioner must return a client's records on request even if a fee is unpaid (31 CFR §10.28), so this agreement says so. Keep late charges within what Maryland law allows. Have an attorney review before use.",
    steps: [
      { title: "Parties", questions: [text("clientName", "Client name", { prefill: "clientName", required: true }), text("clientAddress", "Client address", { prefill: "clientAddress" }), text("firmName", "Firm name", { prefill: "firmName", required: true }), effective()] },
      { title: "Services", questions: [area("services", "Services covered", { required: true, placeholder: "e.g. Monthly bookkeeping, sales tax filings and payroll filings" }), text("period", "Period or tax year covered", { placeholder: "e.g. Calendar year 2026" })] },
      { title: "Fees", questions: [
        pick("feeType", "How are fees charged?", [["flat", "One flat fee"], ["monthly", "A monthly fee"], ["hourly", "By the hour"]], { required: true, default: "flat" }),
        money("amount", "Amount", { required: true, help: "The flat fee, the monthly fee, or the hourly rate." }),
        num("dueDays", "Invoices are due within (days)", { default: "15", required: true }),
        yesno("retainer", "Is a retainer or deposit required up front?"),
        money("retainerAmount", "Retainer amount", { showIf: { id: "retainer", equals: true }, required: true }),
        yesno("lateFee", "Charge interest on overdue invoices?"),
        num("lateFeePercent", "Interest on overdue invoices (% per month)", { showIf: { id: "lateFee", equals: true }, default: "1.5", required: true }),
        state(),
      ] },
    ],
    body: `FEE AGREEMENT

This Fee Agreement is made on {{effectiveDate}} between {{firmName}} ("the Firm") and {{clientName}}{{#if clientAddress}}, of {{clientAddress}}{{/if}} ("the Client").

1. SERVICES
The Firm will provide the following services{{#if period}} for {{period}}{{/if}}:
{{services}}
Services not listed above are outside this agreement and will be quoted separately.

2. FEES
{{#if feeType=flat}}The Client will pay a flat fee of {{amount}} for the services above.{{/if}}{{#if feeType=monthly}}The Client will pay a fee of {{amount}} per month for the services above. This agreement continues month to month until it is ended under Section 5, and a change in the monthly fee needs 30 days' written notice.{{/if}}{{#if feeType=hourly}}The Client will pay {{amount}} per hour for time spent on the services above, billed as the work is done.{{/if}}
{{#if retainer}}A retainer of {{retainerAmount}} is due before work begins and will be applied to the Firm's invoices. Any part not used when the work ends will be refunded to the Client.{{/if}}
Government filing fees, penalties and interest, and out-of-pocket costs are not included in the fee and are paid by the Client. The Firm does not guarantee any result, refund or outcome with any tax authority.{{#if feeType=flat}} A flat fee is invoiced when the work is delivered unless the Firm states otherwise in writing.{{/if}}

3. PAYMENT
Invoices are due within {{dueDays}} days of the invoice date.{{#if lateFee}} Balances unpaid after the due date bear simple (non-compounded) interest at {{lateFeePercent}}% per month, but never more than the maximum rate the law allows.{{/if}} The Firm may pause new work while an invoice is overdue, but will tell the Client in writing which filing deadlines are affected and will still return the Client's records on request.

4. CLIENT RESPONSIBILITIES
The Client will provide complete and accurate records and information promptly, and is responsible for the accuracy of what the Client supplies.

5. TERMINATION AND RECORDS
Either party may end this agreement by ten (10) days' written notice. The Client remains responsible for fees and costs for work performed up to the end date. The Firm will return the Client's own records on request, whether or not an invoice is unpaid. If the Firm pauses or ends work, it will tell the Client in writing which filing deadlines are affected, and the Firm is not responsible for penalties or interest that result.

6. GENERAL AND GOVERNING LAW
This is the entire agreement about these services and may be changed only in writing signed by both parties. If any part is held invalid, the rest stays in effect. The Firm will keep the Client's information confidential and will disclose it only as the Client authorizes in writing or the law requires. This agreement is governed by the laws of the State of {{state}}.

Client: {{clientName}}
Printed name and title: ______________________________
Signature: ______________________________   Date: ______________

For {{firmName}}
Printed name and title: ______________________________
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "engagement_letter", title: "Engagement Letter", category: CLIENT_SERVICE,
    description: "A custom-scope letter confirming what the firm will and will not do for a client.",
    reviewNote: "Representation before the IRS or the Comptroller of Maryland needs the official forms (IRS 2848; Maryland 548) — this letter says so. Have an attorney review before use.",
    steps: [
      { title: "Engagement", questions: [text("clientName", "Client name", { prefill: "clientName", required: true }), text("firmName", "Firm name", { prefill: "firmName", required: true }), effective(),
        area("scope", "What the firm will do", { required: true }), area("exclusions", "What is not included", { placeholder: "e.g. Audit or review services, legal advice, representation before the IRS unless separately authorized" }),
        text("period", "Period or tax year", { placeholder: "e.g. Tax year 2025" })] },
      { title: "Terms", questions: [
        pick("term", "How long does this engagement last?", [["completion", "Until the work is finished"], ["ongoing", "Ongoing until either side ends it"], ["fixed", "Until a set date"]], { required: true, default: "completion" }),
        date("endDate", "End date", { showIf: { id: "term", equals: "fixed" }, required: true }),
        text("feeSummary", "Fees (as agreed)", { required: true, placeholder: "e.g. $450 flat fee, billed on completion" }),
        text("contact", "Firm contact for this engagement"),
        state(),
      ] },
    ],
    body: `{{effectiveDate}}

{{clientName}}

Re: Engagement for professional services{{#if period}} — {{period}}{{/if}}

Dear {{clientName}},

Thank you for choosing {{firmName}}. This letter confirms the work we will do for you and the terms of our engagement.

WHAT WE WILL DO
{{scope}}

WHAT IS NOT INCLUDED
{{#if exclusions}}{{exclusions}} {{/if}}Work not described above is not included.

YOUR RESPONSIBILITIES
You agree to give us complete, accurate and timely information and records, to review the work we prepare before it is filed or relied on, and to tell us promptly about changes that affect it. We rely on the information you provide and do not audit or independently verify it. You are responsible for the final content of anything filed in your name and for any tax, penalty or interest. We cannot guarantee any refund or result, and we do not give legal advice. Representation before the IRS or the Comptroller of Maryland is not included unless we agree in writing and you sign the official form (IRS Form 2848 / Maryland Form 548). We keep your information confidential and release it only with your written consent or as the law requires.

FEES
{{feeSummary}} Invoices are due within 15 days unless we agree otherwise in writing.

DURATION
{{#if term=completion}}This engagement ends when the work described above is finished.{{/if}}{{#if term=ongoing}}This engagement continues until either of us ends it by written notice.{{/if}}{{#if term=fixed}}This engagement ends on {{endDate}} unless we agree in writing to extend it.{{/if}}

ENDING THE ENGAGEMENT
Either of us may end this engagement by written notice. When it ends, or when the work is finished, we have no duty to update our work or to monitor deadlines, law changes or filings unless we agree in writing. We will return your records on request, whether or not our invoices are paid.

GOVERNING LAW
This engagement is governed by the laws of the State of {{state}}.

If this correctly states our agreement, please sign and return a copy.{{#if contact}} Questions can be directed to {{contact}}.{{/if}}

Sincerely,
{{firmName}}
By: ______________________________   Name and title: ______________________________

Agreed and accepted:
{{clientName}}
Printed name and title (if signing for a business): ______________________________
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "authorization_release", title: "Authorization to Release Information", category: CLIENT_SERVICE,
    description: "Lets the firm share specific client records with a named person or company. (For IRS or Maryland tax representation use the 2848 / 8821 / 548 tools.)",
    reviewNote: "For tax-return information this works as a consent under IRC §7216 (26 CFR §301.7216-3): it must name the preparer, taxpayer, purpose, recipient and information, and be signed and dated BEFORE anything is released. For individual (Form 1040) filers the IRS also prescribes specific consent wording (Rev. Proc. 2013-14) — have an attorney or the IRS text confirm it. It is not an IRS 2848/8821 or Maryland Form 548.",
    steps: [
      { title: "Who and what", questions: [text("clientName", "Client name", { prefill: "clientName", required: true }), text("firmName", "Firm name", { prefill: "firmName", required: true }), effective(),
        text("recipient", "Share information with (person or company)", { required: true }), text("recipientAddress", "Their address or email"),
        area("information", "Information that may be shared", { required: true, placeholder: "e.g. Tax returns and financial statements for 2024 and 2025" }),
        area("purpose", "Purpose", { required: true, placeholder: "e.g. Loan application with First Bank" }),
        pick("duration", "How long does this authorization last?", [["date", "Until a date"], ["onetime", "One time only"], ["revoked", "Until I cancel it in writing"]], { required: true, default: "date" }),
        date("expires", "Expires on (must be after the date I sign)", { showIf: { id: "duration", equals: "date" }, required: true })] },
    ],
    body: `AUTHORIZATION TO RELEASE INFORMATION

Prepared: {{effectiveDate}}

I, {{clientName}}, authorize {{firmName}} to release the information described below to:

{{recipient}}{{#if recipientAddress}}
{{recipientAddress}}{{/if}}

INFORMATION THAT MAY BE SHARED
{{information}}

PURPOSE
{{purpose}}

DURATION
{{#if duration=date}}This authorization takes effect on the date I sign it below and expires on {{expires}}.{{/if}}{{#if duration=onetime}}This authorization takes effect on the date I sign it below and covers a single release of the information above, made within 90 days of the date I sign.{{/if}}{{#if duration=revoked}}This authorization takes effect on the date I sign it below and stays in force until I cancel it by written notice to {{firmName}}.{{/if}}

I understand that I may cancel this authorization at any time by written notice to {{firmName}}, except for information already released. I am not required to sign this authorization, and {{firmName}} will not refuse to prepare my tax return because I decline. If no end date is stated, this consent is valid for one year from the date I sign. I will receive a copy. If I believe my tax return information has been disclosed or used improperly, I may contact the Treasury Inspector General for Tax Administration (TIGTA) at 1-800-366-4484. This authorization covers only the information listed above and does not include my Social Security number or EIN unless listed. The recipient should not pass the information on without my permission. {{firmName}} is not responsible for how the recipient uses the information after it is released. This authorization does not allow {{firmName}} to act on my behalf before any tax authority.

{{clientName}}
Printed name and title (if signing for a business): ______________________________
Signature: ______________________________   Date: ______________
Spouse (joint return only): Signature: ______________________________   Date: ______________`,
  },
  {
    key: "termination_of_services", title: "Termination of Services Letter", category: CLIENT_SERVICE,
    description: "Formally ends the working relationship with a client and sets out what happens to records and balances.",
    reviewNote: "Keep the reason empty unless your attorney advises otherwise. A tax practitioner must return client records on request even if a balance is unpaid (31 CFR §10.28). Withdrawing from an IRS 2848, a Maryland Form 548 or other authorizations is stated in the letter — also do it with each office.",
    steps: [
      { title: "Details", questions: [text("clientName", "Client name", { prefill: "clientName", required: true }), text("firmName", "Firm name", { prefill: "firmName", required: true }), effective(),
        pick("endedBy", "Who is ending the relationship?", [["firm", "The firm"], ["client", "The client"]], { required: true, default: "firm" }),
        date("lastDay", "Last day of service", { required: true }),
        text("reason", "Reason (optional — leave empty unless your attorney advises)"),
        yesno("balance", "Is there an unpaid balance?"), money("balanceAmount", "Balance owed", { showIf: { id: "balance", equals: true }, required: true }),
        yesno("records", "Are the client's records being returned with this letter?", { default: true }),
        area("pending", "Work still open or deadlines the client should know about", { placeholder: "e.g. The Q3 sales tax return is due October 20; the client must file it or engage another preparer." })] },
    ],
    body: `{{effectiveDate}}

{{clientName}}

Re: Ending of services

Dear {{clientName}},

{{#if endedBy=firm}}{{firmName}} is ending its professional services for you effective {{lastDay}}.{{else}}This confirms that you have ended your engagement with {{firmName}} effective {{lastDay}}.{{/if}}{{#if reason}} {{reason}}{{/if}}

After {{lastDay}} we will no longer prepare, file or monitor anything on your behalf, including tax filings, payroll filings, reports or payments.

AUTHORIZATIONS
Effective {{lastDay}} we withdraw as your representative on every power of attorney and account access we hold for you (including IRS Form 2848/8821, Maryland Comptroller Form 548 and Maryland unemployment insurance access). Until you file new authorizations and update your contact details with each agency, notices may still be sent to us.

{{#if pending}}OPEN ITEMS AND DEADLINES
{{pending}}
Missing these dates may cause penalties; please consider engaging another preparer now.

{{/if}}{{#if balance}}OUTSTANDING BALANCE
Our records show an unpaid balance of {{balanceAmount}}, which remains due.

{{/if}}RECORDS
{{#if records}}Your records are returned with this letter. Please keep them; you are responsible for retaining copies as required by law.{{else}}Please contact us to arrange the return of your records.{{/if}} Your records belong to you, and we will return them on request whether or not any balance is paid.

We appreciate the opportunity to have served you.

Sincerely,

______________________________
{{firmName}}
Name and title: ______________________________
Sent by: ☐ hand delivery   ☐ certified mail   ☐ email on ______________`,
  },
  {
    key: "document_request_letter", title: "Document Request Letter", category: CLIENT_SERVICE,
    description: "A clear list of the documents a client still needs to send, with a due date.",
    steps: [
      { title: "Request", questions: [text("clientName", "Client name", { prefill: "clientName", required: true }), text("firmName", "Firm name", { prefill: "firmName", required: true }), effective(),
        text("purpose", "What the documents are needed for", { required: true, placeholder: "e.g. your 2025 tax return" }), date("dueDate", "Please send by", { required: true }),
        list("items", "Documents needed", [text("doc", "Document", { required: true }), text("note", "Note (optional)")], { required: true, addLabel: "Add a document" }),
        text("how", "How to send them", { default: "Please upload them to your secure client portal under Documents. Please do not email Social Security numbers, bank account numbers or full tax forms; if you cannot use the portal, call us and we will arrange another secure way." }),
        text("contact", "Firm contact (phone or email)")] },
    ],
    body: `{{effectiveDate}}

{{clientName}}

Re: Documents needed for {{purpose}}

Dear {{clientName}},

To complete {{purpose}}, we need the following from you by {{dueDate}}:

{{#list items}}{{n}}. {{doc}}{{#if note}} — {{note}}{{/if}}
{{/list}}
{{how}}

If any item does not apply, or you are not sure what we mean, please tell us and we will help. If we do not receive these by {{dueDate}}, we may not be able to file on time. We will then prepare only from what we have, or file an extension where possible, and you remain responsible for any penalty or interest.

Thank you,

Signature: ______________________________
{{firmName}}{{#if contact}}
Contact: {{contact}}{{/if}}`,
  },

  /* ─────────────── Business formation & ownership ─────────────── */
  {
    key: "llc_operating_agreement", title: "LLC Operating Agreement", category: BUSINESS,
    description: "Sets out who owns an LLC with two or more members, how it is run, how profits are shared, what happens on a death or a sale, and how an owner can leave.",
    reviewNote: "Have an attorney review an operating agreement before the members sign it. Points to confirm with an attorney or the tax preparer: (1) For a manager-managed LLC, ask whether the articles of organization on file with the State Department of Assessments and Taxation should also say that members are not agents of the company. (2) An S corporation election must be filed with the IRS on time (Form 2553) and every member must be eligible; an S corporation cannot give members different distribution or liquidation rights. (3) Partnerships and S corporations generally must use a December 31 year-end. (4) Check whether any license, lease or loan needs notice or consent when ownership changes. (5) The percentages are not checked by the software — make sure they total 100.",
    steps: [
      { title: "The company", questions: [text("companyName", "LLC name", { prefill: "clientName", required: true }), state({ id: "formedIn", label: "State where the LLC is formed" } as Partial<Question>), date("formationDate", "Date formed", { required: true }), text("address", "Principal address", { prefill: "clientAddress", required: true }), text("purpose", "Business purpose", { default: "any lawful business" }), effective()] },
      { title: "Members", questions: [list("members", "Members (owners) — percentages should total 100", [text("name", "Name (person or company)", { required: true }), text("address", "Address"), money("contribution", "Capital contributed", { required: true }), num("percent", "Ownership %", { required: true })], { required: true, minItems: 2, addLabel: "Add a member" })] },
      { title: "How it runs", questions: [
        pick("management", "Who manages the LLC?", [["members", "All members together (member-managed)"], ["manager", "A named manager (manager-managed)"]], { required: true, default: "members" }),
        text("manager", "Manager's name", { showIf: { id: "management", equals: "manager" }, required: true }),
        pick("taxClass", "How is the LLC taxed?", [["partnership", "Partnership (two or more members)"], ["scorp", "S corporation"]], { required: true, default: "partnership", help: "For a one-owner LLC use the Single-Member LLC Operating Agreement instead." }),
        text("partnershipRep", "Partnership representative for IRS audits (a member)", { showIf: { id: "taxClass", equals: "partnership" }, help: "Leave blank and the agreement says the members will appoint one." }),
        pick("distributions", "How are profits shared?", [["percent", "In proportion to ownership percentages"], ["equal", "Equally"]], { required: true, default: "percent", showIf: { id: "taxClass", equals: "partnership" }, help: "An S corporation must always share in proportion to ownership." }),
        text("fiscalYear", "Fiscal year ends", { default: "December 31", help: "Partnerships and S corporations generally must use December 31 — confirm with the tax preparer before changing it." }),
        yesno("consentToTransfer", "Require the other members' consent before an interest is sold or transferred?", { default: true }),
        num("noticeDays", "Days of written notice to withdraw or sell", { required: true, default: "60" }),
        num("buyDays", "Days the other members have to decide whether to buy", { required: true, default: "30" }),
        num("payMonths", "Longest period (months) for paying the buyout price in installments", { required: true, default: "24" }),
        state(),
      ] },
    ],
    body: `OPERATING AGREEMENT OF {{companyName}}

This Operating Agreement is made on {{effectiveDate}} by the members listed below for {{companyName}} (the "Company"), a limited liability company formed under the laws of {{formedIn}} on {{formationDate}} by filing its articles of organization.

1. FORMATION AND PURPOSE
The Company's principal office is {{address}}. Its purpose is {{purpose}}. The Company continues until dissolved under this Agreement.

2. MEMBERS, CAPITAL AND OWNERSHIP
{{#list members}}{{n}}. {{name}}{{#if address}}, {{address}}{{/if}} — capital contribution {{contribution}}; ownership {{percent}}%
{{/list}}
The ownership percentages above are intended to total 100%. No member is required to contribute more capital unless all members agree. A member's ownership percentage changes only by written agreement of all members.

3. MANAGEMENT
{{#if management=members}}The Company is managed by its members. Ordinary decisions are made by members holding a majority of ownership percentages; if the members are equally divided, the matter is not approved. The members, by that majority, decide who may open accounts and sign checks for the Company. Selling the business, admitting a new member, borrowing beyond ordinary needs, or amending this Agreement requires every member's written consent.{{/if}}{{#if management=manager}}The Company is managed by {{manager}} as manager, who may make ordinary decisions, open bank accounts and sign for the Company. The manager serves until removed by members holding a majority of ownership percentages. Members, as members, have no authority to bind the Company. Selling the business, admitting a new member, borrowing beyond ordinary needs, or amending this Agreement requires every member's written consent.{{/if}}

4. TAX TREATMENT AND DISTRIBUTIONS
{{#if taxClass=partnership}}The Company is taxed as a partnership for federal income tax purposes. Tax allocations follow the members' capital accounts. {{#if partnershipRep}}{{partnershipRep}} is the partnership representative for federal tax audits.{{else}}The members will appoint one member as the partnership representative for federal tax audits.{{/if}} If the Company has the cash, it will try to distribute each year enough for the members to pay tax on the income allocated to them.{{/if}}{{#if taxClass=scorp}}The Company has elected, or will elect, by timely filing IRS Form 2553, to be taxed as an S corporation for federal income tax purposes. Each member confirms that the member is eligible to hold an interest in an S corporation and will not transfer an interest to anyone who is not. Nothing in this Agreement gives any member different rights to distributions or liquidation proceeds.{{/if}} Profits and losses are allocated, and distributions are made, {{#if taxClass=scorp}}in proportion to the members' ownership percentages{{else}}{{#if distributions=equal}}equally among the members{{else}}in proportion to the members' ownership percentages{{/if}}{{/if}}. Distributions are made at times {{#if management=manager}}the manager decides{{else}}the members decide by majority{{/if}}, from cash not needed for the business, and are not made if the Company could not then pay its debts as they come due. The Company's fiscal year ends {{fiscalYear}}. Books and records are kept at the principal office and are open to every member.

5. TRANSFERS AND WITHDRAWAL
{{#if consentToTransfer}}No member may sell or transfer an interest without the written consent of the other members. {{else}}A member may transfer an interest only after following the procedure in this section. {{/if}}A member who wishes to withdraw or sell must give the other members written notice of at least {{noticeDays}} day(s). The other members may, within {{buyDays}} day(s) after receiving the notice, buy the interest in proportion to their ownership percentages (or as they agree among themselves) at a fair value agreed by the members or, if they do not agree within that time, set by an independent appraiser chosen and paid for by the Company. The buyers pay the price within 90 days, or in equal monthly installments over up to {{payMonths}} month(s) if they prefer. {{#if consentToTransfer}}If the other members do not buy, the interest may be sold to another person only with their written consent.{{else}}If the other members do not buy, the member may sell the interest to another person, but not on terms better than those offered to the members.{{/if}} A member who withdraws and whose interest is not bought stops being a member and keeps only the right to receive distributions on that interest. Anyone who acquires an interest and is not already a member receives only the right to distributions until all other members admit that person in writing.

6. DEATH, INCAPACITY OR BANKRUPTCY OF A MEMBER
If a member dies, is declared incompetent or becomes bankrupt, that member (or the member's estate or representative) keeps only the right to receive that member's share of distributions and does not become a member or vote unless all remaining members admit that person in writing. The remaining members may buy the interest within 90 days after the event on the price and payment terms in the section on transfers and withdrawal. The Company continues and is not dissolved.

7. DISSOLUTION
The Company dissolves on the written agreement of all members, by a court order, or as required by law. After debts (including loans from members) are paid, remaining assets are first returned to the members in proportion to their unreturned capital contributions, and the balance is distributed {{#if taxClass=scorp}}in proportion to ownership percentages{{else}}{{#if distributions=equal}}equally among the members{{else}}in proportion to ownership percentages{{/if}}{{/if}}.

8. LIABILITY AND INDEMNITY
Members are not personally liable for the Company's debts solely because they are members. The Company will indemnify members for acts done in good faith for the Company, but not for fraud, willful misconduct or gross negligence, and only out of the Company's assets.

9. GENERAL
This Agreement is the members' entire agreement on its subject, may be amended only in writing signed by all members, and is governed by the laws of the State of {{state}}. If a term cannot be enforced, the rest stays in force.

MEMBERS
{{#list members}}{{name}}
Signature: ______________________________   Date: ______________
If this member is a company — By: ______________________________   Name: ______________________________   Title: ______________________________

{{/list}}`,
  },
  {
    key: "partnership_agreement", title: "General Partnership Agreement", category: BUSINESS,
    description: "Defines how partners share capital, profits, decisions and authority, what happens if a partner leaves or dies, and how the partnership winds up.",
    reviewNote: "Have an attorney review before signing. A general partnership can make each partner personally responsible for the business's debts. Confirm with an attorney or the tax preparer: (1) a partnership using a name other than its partners' own names may need a trade-name certificate filed with the State Department of Assessments and Taxation; (2) whether the withdrawal-notice wording is enforceable as written — the law lets a partner withdraw at any time; (3) how partners who work in the business are paid and taxed (guaranteed payments, self-employment tax). The profit-share percentages are not checked by the software — make sure they total 100.",
    steps: [
      { title: "Business", questions: [text("businessName", "Partnership name", { prefill: "clientName", required: true }), text("address", "Business address", { prefill: "clientAddress" }), text("purpose", "What the business does", { required: true }), effective(), state()] },
      { title: "Partners", questions: [list("partners", "Partners — shares should total 100", [text("name", "Name", { required: true }), text("address", "Address"), money("capital", "Capital contributed", { required: true }), num("share", "Profit & loss share %", { required: true })], { minItems: 2, required: true, addLabel: "Add a partner" }), area("partnerDuties", "What each partner does / time each gives to the business", { placeholder: "e.g. Ali runs the store full-time; Omar handles bookkeeping part-time" })] },
      { title: "Terms", questions: [
        pick("decisions", "How are decisions made?", [["majority", "Majority of profit shares"], ["unanimous", "All partners must agree"]], { required: true, default: "majority" }),
        money("authorityLimit", "Largest contract, lease or loan one partner may sign alone", { help: "Leave blank to require the decision rule above for every lease, loan or large contract." }),
        pick("draws", "Partner draws", [["none", "No regular draws"], ["monthly", "Monthly draws agreed by the partners"]], { default: "none" }),
        yesno("competeBan", "Partners may not run a competing business while they are partners", { default: true }),
        text("partnerRep", "Partnership representative for IRS audits (a partner)", { help: "Leave blank and the agreement says the partners will appoint one." }),
        num("noticeDays", "Days of written notice a withdrawing partner should give", { default: "90", required: true }),
        yesno("buyout", "Remaining partners may buy out a departing partner's interest", { default: true }),
      ] },
    ],
    body: `GENERAL PARTNERSHIP AGREEMENT

This Agreement is made on {{effectiveDate}} among the partners listed below to carry on business as {{businessName}}{{#if address}} at {{address}}{{/if}}. The partnership continues until it is ended under this Agreement.

1. PURPOSE
The partnership's business is: {{purpose}}.{{#if partnerDuties}} Each partner's role and time commitment: {{partnerDuties}}{{/if}}

2. PARTNERS, CAPITAL AND SHARES
{{#list partners}}{{n}}. {{name}}{{#if address}}, {{address}}{{/if}} — capital {{capital}}; shares {{share}}% of profits and losses
{{/list}}
The shares above are intended to total 100%. During the life of the partnership, capital is not repaid and no interest is paid on it unless the partners agree in writing. Each partner's capital account is credited with the partner's contributions and share of profits, and charged with the partner's draws and share of losses.

3. PROFITS, LOSSES AND DRAWS
Profits and losses are shared according to the percentages above. {{#if draws=monthly}}Partners may take monthly draws in amounts the partners agree, which are charged against their share of profits.{{else}}No partner takes regular draws unless the partners agree.{{/if}} A partner is paid for work only as the partners agree in writing.

4. MANAGEMENT AND AUTHORITY
Each partner may take part in managing the business. {{#if decisions=majority}}Decisions are made by partners holding a majority of the profit shares; if the partners are equally divided, the matter is not approved.{{else}}Decisions require the agreement of every partner.{{/if}} Borrowing outside the ordinary course, selling the business, or admitting a partner requires every partner's written consent. {{#if authorityLimit}}No partner may alone sign a contract, lease or loan above {{authorityLimit}}, or hire or dismiss staff.{{else}}No partner may sign a lease or loan, or hire or dismiss staff, without the consent required in this section.{{/if}} The partners understand that, in a general partnership, each partner can be personally responsible for the partnership's debts. {{#if competeBan}}While a partner, no partner will own, run or work for a competing business without the other partners' written consent.{{/if}}

5. BOOKS, RECORDS AND TAXES
Accurate books are kept at the business address and are open to every partner. The partnership files a partnership tax return each year and gives each partner a statement of that partner's share of income. {{#if partnerRep}}{{partnerRep}} is the partnership representative for federal tax audits.{{else}}The partners will appoint one partner as the partnership representative for federal tax audits.{{/if}} Payments to a partner for work are treated as the partnership's tax preparer advises.

6. WITHDRAWAL
A partner may withdraw at any time by written notice. A partner who gives less than {{noticeDays}} day(s) of notice is responsible for the partnership's losses caused by the shorter notice. {{#if buyout}}The remaining partners may, within 30 days after the withdrawal, buy the departing partner's interest at a fair value agreed by the partners or, if they do not agree within that time, set by an independent appraiser chosen and paid for by the partnership. The price is paid within 90 days. A departing partner stays responsible for debts incurred before leaving, and the partners will tell the partnership's banks, landlords and suppliers of the withdrawal.{{else}}The partnership then winds up unless the remaining partners agree to continue and settle with the departing partner.{{/if}}

7. DEATH OF A PARTNER
If a partner dies, the partnership continues unless the remaining partners decide to wind up. {{#if buyout}}The estate receives the fair value of the interest, set and paid as described in the section on withdrawal, and does not become a partner unless all remaining partners agree in writing.{{else}}The estate receives the fair value of the interest within 12 months, and does not become a partner unless all remaining partners agree in writing.{{/if}}

8. DISSOLUTION
The partnership dissolves by agreement of all partners or as required by law. After debts (including loans from partners) are paid, each partner is repaid capital and receives profit shares in accordance with that partner's capital account. A partner whose account is negative must pay the shortfall in proportion to the partner's share of losses.

9. GENERAL
This Agreement is the partners' entire agreement, may be changed only in writing signed by all partners, and is governed by the laws of the State of {{state}}. If a term cannot be enforced, the rest stays in force.

PARTNERS
{{#list partners}}{{name}}
Signature: ______________________________   Date: ______________
If this partner is a company — By: ______________________________   Name: ______________________________   Title: ______________________________

{{/list}}`,
  },
  {
    key: "profit_sharing_agreement", title: "Owner Profit-Sharing Agreement", category: BUSINESS,
    description: "How the owners of one business split profit, how often, what is held back, and what happens when an owner leaves. Matches the 'Profit split' tool in the client portal.",
    reviewNote: "This agreement sits on top of the business's own governing documents (operating agreement, partnership agreement or bylaws) and does not replace them. For an LLC or partnership, profit shares should match what those documents say. For an S corporation, profit must be paid in proportion to share ownership — a different split can put the S election at risk. Owners are taxed on their share of a pass-through business's income whether or not it is paid out. If the firm is also the business's accountant, the owners should name someone else to settle disputes. The percentages are not checked by the software — make sure they total 100.",
    steps: [
      { title: "Business and owners", questions: [text("businessName", "Business name", { prefill: "clientName", required: true }),
        pick("entityType", "The business is", [["llc", "An LLC"], ["scorp", "An S corporation"], ["corp", "A C corporation"], ["partnership", "A partnership"], ["other", "Something else"]], { required: true, default: "llc" }),
        effective(), state(),
        list("owners", "Owners and their share of profit — should total 100", [text("name", "Name", { required: true }), num("percent", "Share %", { required: true })], { minItems: 2, required: true, addLabel: "Add an owner" })] },
      { title: "Rules", questions: [
        pick("frequency", "Profit is divided", [["weekly", "Weekly"], ["monthly", "Monthly"], ["quarterly", "Quarterly"]], { required: true, default: "monthly" }),
        num("reserve", "Keep this % of profit in the business as a reserve (leave blank for none)"),
        pick("basis", "Profit means", [["net", "Net income after all business expenses, including any taxes the business itself owes"], ["cash", "Cash left after expenses are paid"]], { required: true, default: "net" }),
        num("payDays", "Days after the period's books are closed to pay owners", { required: true, default: "30" }),
        yesno("shareLoss", "Losses are shared in the same percentages", { default: true }),
        text("method", "How owners are paid", { default: "bank transfer" }),
        text("reviewer", "Accountant who settles disputes about the numbers", { help: "Leave blank to say an independent CPA chosen by all the owners." }),
      ] },
    ],
    body: `OWNER PROFIT-SHARING AGREEMENT

This Agreement is made on {{effectiveDate}} among the owners of {{businessName}} (the "Business"), which is {{#if entityType=llc}}a limited liability company{{/if}}{{#if entityType=scorp}}an S corporation{{/if}}{{#if entityType=corp}}a C corporation{{/if}}{{#if entityType=partnership}}a partnership{{/if}}{{#if entityType=other}}a business{{/if}}.

1. OWNERS AND SHARES
{{#list owners}}{{n}}. {{name}} — {{percent}}% of profit
{{/list}}
The shares above are intended to total 100%.

2. WHAT IS PROFIT
Profit means {{#if basis=net}}net income after all business expenses, including any taxes the Business itself owes,{{else}}the cash left after the Business's expenses have been paid,{{/if}} as shown in the Business's books for the period. This Agreement does not set wages; an owner who works in the Business is paid for that work separately, as the owners agree in writing.

3. WHEN AND HOW PROFIT IS PAID
Profit is divided {{#if frequency=weekly}}weekly{{/if}}{{#if frequency=monthly}}monthly{{/if}}{{#if frequency=quarterly}}quarterly{{/if}}. {{#if reserve}}Before dividing, {{reserve}}% of the profit stays in the Business as a reserve; the reserve is released only by decision of owners holding a majority of the shares. {{/if}}Profit is paid only to the extent the Business has cash left after paying its current obligations (including payroll, sales and withholding taxes and loan payments) and setting aside any reserve. Each owner is paid by {{method}} within {{payDays}} day(s) after the period's books are closed. The Business may pay owners extra cash to help cover their personal income tax on the Business's income. No owner is promised any amount of profit.

4. LOSSES
{{#if shareLoss}}Losses are shared by the owners in the same percentages.{{else}}Losses are handled as the owners agree in writing.{{/if}}

5. RECORDS AND DISPUTES
The Business keeps its books accurately and gives every owner access to them. Disputes about the numbers are first discussed by the owners and, if unresolved, reviewed by {{#if reviewer}}{{reviewer}}{{else}}an independent certified public accountant chosen by all the owners{{/if}}, whose written finding on the numbers is final unless an owner shows a mistake.

6. AN OWNER WHO LEAVES OR DIES
If an owner leaves or dies, that owner's share of profit stops on that date. Profit earned up to that date is paid in the normal way, and the share does not pass to anyone else unless the Business's own governing documents say so.

7. RELATIONSHIP TO OTHER DOCUMENTS
This Agreement does not change the Business's operating agreement, partnership agreement or bylaws; if they conflict with it, those documents control.{{#if entityType=scorp}} Because the Business is an S corporation, profit is paid only in proportion to share ownership.{{/if}}

8. CHANGES
This Agreement continues until the owners end it in writing. It may be changed only in writing signed by all owners, and is governed by the laws of the State of {{state}}.

OWNERS
{{#list owners}}{{name}}
Signature: ______________________________   Date: ______________

{{/list}}`,
  },
  {
    key: "business_bill_of_sale", title: "Bill of Sale — Business Assets", category: BUSINESS,
    description: "Records the sale of a business's assets from one party to another and transfers them to the buyer.",
    reviewNote: "A business sale can have licensing, tax and lease consequences — have these confirmed before signing. Confirm with an attorney or the tax preparer: (1) the Maryland bulk-transfer rules (notice to creditors and to the Comptroller at least 10 days before the buyer takes possession or pays, and a sworn list of creditors) — a buyer who skips them can be held responsible for the seller's unpaid sales tax; (2) sales tax on equipment and fixtures bought with the business; (3) IRS Form 8594 (both sides report how the price is split among the assets); (4) sales tax, tobacco, alcohol, lottery and health licenses usually must be applied for by the buyer in the buyer's own name; (5) vehicles need their own title transfer. If the Seller is paid in installments, consider a separate promissory note.",
    steps: [
      { title: "Parties", questions: [text("seller", "Seller", { required: true }), text("sellerAddress", "Seller's address"), text("buyer", "Buyer", { required: true }), text("buyerAddress", "Buyer's address"), text("businessName", "Business being sold", { prefill: "clientName", required: true }), effective(), state()] },
      { title: "The sale", questions: [
        area("assets", "Assets included", { required: true, placeholder: "e.g. Inventory, fixtures, equipment, customer lists, trade name, lease rights" }),
        area("excluded", "Assets or items not included"),
        money("price", "Purchase price", { required: true }),
        pick("payment", "How is it paid?", [["full", "In full at signing"], ["installments", "In installments"]], { required: true, default: "full" }),
        text("installmentTerms", "Installment terms", { showIf: { id: "payment", equals: "installments" }, required: true, placeholder: "e.g. $5,000 down, then $1,000 on the 1st of each month for 20 months" }),
        yesno("liabilities", "Buyer takes on the business's existing debts"), area("liabilityList", "Debts the buyer takes on", { showIf: { id: "liabilities", equals: true }, required: true }),
      ] },
    ],
    body: `BILL OF SALE

On {{effectiveDate}}, {{seller}}{{#if sellerAddress}} of {{sellerAddress}}{{/if}} ("Seller") sells to {{buyer}}{{#if buyerAddress}} of {{buyerAddress}}{{/if}} ("Buyer") the assets of the business known as {{businessName}}.

1. ASSETS SOLD
{{assets}}
The assets sold include the business's goodwill, trade name, telephone numbers and records. They do not include cash, bank accounts, accounts receivable, tax refunds, lottery funds or the Seller's personal items, unless listed above.
{{#if excluded}}
EXCLUDED
{{excluded}}
{{/if}}
Any motor vehicle included needs its own signed title transfer, which the parties will complete.

2. PRICE AND PAYMENT
The purchase price is {{price}}. {{#if payment=full}}It is paid in full at signing.{{else}}It is paid as follows: {{installmentTerms}}{{/if}}
{{#if payment=installments}}Until the price is paid in full, the Seller keeps a security interest in the assets, and the Buyer allows the Seller to file a financing statement with the State Department of Assessments and Taxation. If any installment is more than 10 days late, the Seller may declare the whole balance due.
{{/if}}The price is divided among the assets as stated in a schedule both parties sign, which both use for their tax filings; if there is no signed schedule, they will divide it as their tax preparers agree.

3. DEBTS
{{#if liabilities}}Buyer takes on the following business debts: {{liabilityList}} All other debts of the business remain Seller's responsibility.{{else}}Buyer does not take on any debts of the business; all debts incurred before the sale date remain Seller's responsibility.{{/if}} Each party will pay the debts it is responsible for and protect the other from claims on them.

4. BULK-TRANSFER NOTICE
If this sale is a bulk transfer under Maryland Commercial Law, Title 6, Subtitle 1, the Seller will give the Buyer a creditor list signed under oath and a schedule of the property, and the Buyer will send the required notice to the Comptroller of Maryland and to the Seller's creditors at least 10 days before the Buyer takes possession or pays, whichever is first. The Buyer may keep back from the price any amount the Comptroller claims for the Seller's unpaid sales and use tax and pay it to the Comptroller.

5. SELLER'S STATEMENTS
Seller states that Seller owns the assets, has the right to sell them (and, if Seller is a company, that the person signing is authorized to sign for it), and that they are free of liens and claims except as disclosed in writing. The assets are sold as-is except for these statements.

6. GENERAL
This Bill of Sale is governed by the laws of the State of {{state}}. If a term cannot be enforced, the rest stays in force.

SELLER: {{seller}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

BUYER: {{buyer}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________`,
  },

  /* ─────────────── Employment & payroll ─────────────── */
  {
    key: "offer_letter", title: "Offer of Employment Letter", category: EMPLOYMENT,
    description: "Offers a position with pay, schedule and start date, and states that employment is at will.",
    reviewNote: "Maryland requires written notice at hiring of the rate of pay, regular paydays and leave benefits (Labor & Employment §3-504). Pay at least every two weeks or twice a month; monthly pay is lawful only for administrative, executive or professional employees (§3-502). Never set pay below the Maryland minimum wage. Have an attorney review before use.",
    steps: [
      { title: "Position", questions: [text("employer", "Employer", { prefill: "clientName", required: true }), text("employee", "Employee name", { required: true }), text("employeeAddress", "Employee address"), effective(),
        text("position", "Job title", { required: true }), text("supervisor", "Reports to"), date("startDate", "Start date", { required: true }), text("location", "Work location", { prefill: "clientAddress" })] },
      { title: "Pay and schedule", questions: [
        pick("payType", "Pay is", [["hourly", "Hourly"], ["salary", "Salary"]], { required: true, default: "hourly" }),
        money("rate", "Hourly rate or annual salary", { required: true, help: "Must not be below the Maryland minimum wage." }),
        text("schedule", "Expected schedule", { placeholder: "e.g. 40 hours per week, Monday–Friday" }),
        pick("payFrequency", "Paid", [["weekly", "Weekly"], ["biweekly", "Every two weeks"], ["semimonthly", "Twice a month"], ["monthly", "Monthly"]], { default: "biweekly", required: true }),
        area("benefits", "Benefits or other terms (optional)"),
        date("replyBy", "Please reply by", { required: true }),
        state(),
      ] },
    ],
    body: `{{effectiveDate}}

{{employee}}{{#if employeeAddress}}
{{employeeAddress}}{{/if}}

Dear {{employee}},

{{employer}} is pleased to offer you the position of {{position}}{{#if supervisor}}, reporting to {{supervisor}}{{/if}}, starting {{startDate}}{{#if location}} at {{location}}{{/if}}.

PAY
You will be paid {{#if payType=hourly}}{{rate}} per hour{{else}}a salary of {{rate}} per year{{/if}}, {{#if payFrequency=weekly}}every week{{/if}}{{#if payFrequency=biweekly}}every two weeks{{/if}}{{#if payFrequency=semimonthly}}twice each month{{/if}}{{#if payFrequency=monthly}}once a month{{/if}}, on {{employer}}'s regular paydays, less required tax withholding and any deductions you authorize in writing. {{employer}} will give you at least one pay period's notice before it changes your payday or lowers your rate of pay.{{#if schedule}} Your expected schedule is {{schedule}}.{{/if}} {{#if payType=hourly}}Hours over 40 in a workweek are paid at overtime rates as the law requires.{{else}}A salary alone does not make a position exempt from overtime. Unless {{employer}} tells you in writing that your position is exempt, you will be paid overtime for hours over 40 in a workweek as the law requires.{{/if}}
{{#if benefits}}
BENEFITS AND OTHER TERMS
{{benefits}}
{{/if}}
LEAVE
You will earn paid sick and safe leave as Maryland law requires, and {{employer}} will give you the State's written notice about it. Any vacation or other paid leave, and whether unused leave is paid when employment ends, is stated above or in {{employer}}'s written leave policy.

AT-WILL EMPLOYMENT
Your employment is at will. Either you or {{employer}} may end it at any time, with or without cause or notice. This letter is not a contract for any fixed period. No one other than the owner can change this at-will relationship, and only in a signed writing. This letter replaces any earlier oral statements about your job.

BEFORE YOU START
By your first day you must complete Form W-4 and Section 1 of Form I-9. Within three business days after you start, you must show {{employer}} original documents of your own choice, from the Form I-9 lists of acceptable documents, proving your identity and your authorization to work in the United States. This offer depends on completing these items.

This letter is governed by the laws of the State of {{state}}. To accept, sign below and return it by {{replyBy}}; this offer ends if it is not accepted by then.

Sincerely,
{{employer}}
Signature: ______________________________   Date: ______________

I accept this offer:
{{employee}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "contractor_agreement", title: "Independent Contractor Agreement", category: EMPLOYMENT,
    description: "Sets out services, pay and the independent-contractor relationship (not an employee).",
    reviewNote: "Calling someone a contractor does not make them one. Under Maryland's unemployment-insurance test (Labor & Employment §8-205) and the IRS test, a person who works your shifts, at your store, under your direction is an employee. If that describes the person, use the Employment Agreement instead. Tick only the independence facts that are TRUE. Have an attorney review before use.",
    steps: [
      { title: "Parties", questions: [text("company", "Company", { prefill: "clientName", required: true }), text("companyAddress", "Company address", { prefill: "clientAddress" }), text("contractor", "Contractor name", { required: true }), text("contractorAddress", "Contractor address"), effective(), state()] },
      { title: "Independence check", description: "These facts decide whether the person is really a contractor. Tick only what is true. If most are not ticked, this person is probably an employee.", questions: [
        yesno("indBusiness", "Contractor runs their own business and has, or is free to take, other customers"),
        yesno("indSchedule", "Contractor decides their own schedule and methods; the Company controls only the result"),
        yesno("indTools", "Contractor uses their own tools and may use helpers at their own cost"),
        yesno("indAway", "The work is done away from the Company's premises, or is not part of the Company's usual day-to-day business"),
        yesno("indInsurance", "Contractor carries their own insurance and workers' compensation coverage where the law requires"),
      ] },
      { title: "Work and pay", questions: [
        area("services", "Services to be performed", { required: true }),
        date("startDate", "Start date", { required: true }), yesno("hasEnd", "The work has an end date"), date("endDate", "End date", { showIf: { id: "hasEnd", equals: true }, required: true }),
        pick("feeType", "Contractor is paid", [["fixed", "A fixed fee for the project"], ["hourly", "By the hour"]], { required: true, default: "fixed" }),
        money("fee", "Fixed fee, or hourly rate", { required: true }), num("payDays", "Invoices paid within (days)", { default: "30", required: true }),
        yesno("confidential", "Contractor keeps the company's information confidential", { default: true }),
        yesno("ownsWork", "The company owns the work the contractor produces", { default: true }),
      ] },
    ],
    body: `INDEPENDENT CONTRACTOR AGREEMENT

This Agreement is made on {{effectiveDate}} between {{company}}{{#if companyAddress}}, {{companyAddress}}{{/if}} ("Company") and {{contractor}}{{#if contractorAddress}}, {{contractorAddress}}{{/if}} ("Contractor").

1. SERVICES
Contractor will perform the following services: {{services}}

2. TERM
Work begins on {{startDate}}{{#if hasEnd}} and ends on {{endDate}}, unless ended earlier under this Agreement{{else}} and continues until either party ends it as described in this Agreement{{/if}}.

3. PAYMENT
Company will pay Contractor {{#if feeType=fixed}}a fixed fee of {{fee}} for the services{{else}}{{fee}} per hour for time worked{{/if}}. Contractor will send invoices{{#if feeType=hourly}} listing the dates and hours worked{{/if}} and Company will pay each within {{payDays}} days of receiving it.

4. INDEPENDENT CONTRACTOR
Contractor is an independent contractor, not an employee. {{#if indBusiness}}Contractor runs their own business and has other customers or is free to take them. {{/if}}{{#if indSchedule}}Contractor sets their own schedule and methods; Company controls the result of the work, not the means. {{/if}}{{#if indTools}}Contractor supplies their own tools and may use helpers at their own cost. {{/if}}{{#if indAway}}The work is done away from Company's premises or outside Company's usual day-to-day business. {{/if}}{{#if indInsurance}}Contractor carries any insurance and workers' compensation coverage the law requires for Contractor and Contractor's helpers. {{/if}}Contractor has no authority to bind Company. Company will not withhold taxes or provide benefits. Contractor is responsible for their own taxes, insurance and licenses, and will provide a completed Form W-9; Company will report payments on Form 1099-NEC where required.

{{#if confidential}}5. CONFIDENTIALITY
Contractor will keep Company's non-public business, client and financial information confidential and use it only for this work, during and after this Agreement. Nothing in this Agreement stops Contractor from reporting a possible violation of law to a government agency. Under 18 U.S.C. § 1833(b), an individual is not liable under any trade-secret law for disclosing a trade secret in confidence to a government official or an attorney solely to report or investigate a suspected violation of law, or in a sealed court filing.

{{/if}}{{#if ownsWork}}6. OWNERSHIP OF WORK
Contractor assigns to Company all rights in the work Contractor creates specifically for Company under this Agreement, effective when Company has paid for it. Contractor keeps rights in Contractor's own pre-existing tools and materials and gives Company a license to use any of them built into the work.

{{/if}}7. ENDING THE AGREEMENT
Either party may end this Agreement on 14 days' written notice, or immediately if the other party materially breaks it. Company pays for work completed up to the end date; for a fixed fee, the part of the fee that matches the work completed.

8. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}. If any part of it cannot be enforced, the rest stays in force.

COMPANY: {{company}}
Signature: ______________________________   Date: ______________

CONTRACTOR: {{contractor}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "employment_termination_letter", title: "Employment Separation Letter", category: EMPLOYMENT,
    description: "Confirms the end of employment, final pay and the return of company property.",
    reviewNote: "Maryland requires final wages to be paid no later than the regular payday that would have applied had employment continued (Labor & Employment §3-505). Earned vacation counts as wages unless a written policy given at hiring says otherwise. Keep any reason short and neutral. A layoff of many employees can trigger Maryland's notice rules — check first. Have an attorney review before using this for a firing.",
    steps: [
      { title: "Separation", questions: [text("employer", "Employer", { prefill: "clientName", required: true }), text("employee", "Employee name", { required: true }), effective(),
        pick("type", "Type of separation", [["resignation", "Employee resigned"], ["termination", "Employer ended employment"], ["layoff", "Layoff"]], { required: true }),
        date("lastDay", "Last day of work", { required: true }), text("reason", "Reason (optional)", { help: "Leave empty unless needed; one neutral fact only. It is not printed for a termination." }),
        date("finalPayDate", "Final paycheck will be paid on", { required: true, help: "No later than the employee's next regular payday." }),
        yesno("accruedPay", "Final pay includes unused paid time off", { default: false }),
        yesno("property", "Employee must return company property", { default: true }), text("propertyList", "Property to return", { showIf: { id: "property", equals: true }, placeholder: "e.g. Keys, uniform, laptop" }),
        text("contact", "Contact for questions or records")] },
    ],
    body: `{{effectiveDate}}

{{employee}}

Re: End of employment

Dear {{employee}},

{{#if type=resignation}}This letter confirms that {{employer}} has accepted your resignation. Your last day of work is {{lastDay}}.{{/if}}{{#if type=termination}}This letter confirms that your employment with {{employer}} ends on {{lastDay}}.{{/if}}{{#if type=layoff}}This letter confirms that your position with {{employer}} is being eliminated and your last day of work is {{lastDay}}.{{/if}}{{#if reason}}{{#if !type=termination}} {{reason}}{{/if}}{{/if}}

FINAL PAY
Your final paycheck, covering all wages earned through {{lastDay}}{{#if accruedPay}} and unused paid time off{{/if}}, less required withholdings, will be paid on or before {{finalPayDate}}, which is no later than the regular payday that would have applied had your employment continued.{{#if !accruedPay}} Unused vacation or paid time off is paid only as stated in {{employer}}'s written leave policy.{{/if}}

{{#if property}}COMPANY PROPERTY
Please return the following on or before your last day: {{#if propertyList}}{{propertyList}}{{else}}all company property in your possession{{/if}}.

{{/if}}UNEMPLOYMENT INSURANCE
You may be able to apply for unemployment insurance benefits with the Maryland Department of Labor. The State decides eligibility.

TAX FORMS AND RECORDS
Your Form W-2 will be sent to the address we have on file, so please keep it up to date with us.{{#if contact}} Questions can be sent to {{contact}}.{{/if}}

Sincerely,
{{employer}}
By: ______________________________   Date: ______________

Received by employee (receipt only, not agreement):
{{employee}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "employment_verification_letter", title: "Employment Verification Letter", category: EMPLOYMENT,
    description: "Confirms that a person works (or worked) for the business — for a landlord, lender or agency.",
    reviewNote: "Release employment or pay information only with the employee's written request or permission. State facts only — never the reason for leaving, discipline, medical or immigration information.",
    steps: [
      { title: "Details", questions: [text("employer", "Employer", { prefill: "clientName", required: true }), text("employerAddress", "Employer address", { prefill: "clientAddress" }), text("employee", "Employee name", { required: true }), effective(),
        pick("authorized", "The employee asked for or allowed this letter in writing", [["yes", "Yes — I have their written request"], ["no", "No"]], { required: true }),
        text("position", "Job title", { required: true }), date("startDate", "Employed since", { required: true }),
        yesno("current", "Still employed", { default: true }), date("endDate", "Employment ended", { showIf: { id: "current", equals: false }, required: true }),
        pick("status", "Status", [["fulltime", "Full-time"], ["parttime", "Part-time"], ["seasonal", "Seasonal"]], { default: "fulltime", required: true }),
        yesno("includePay", "Include pay information", { default: false }), money("pay", "Pay amount", { showIf: { id: "includePay", equals: true }, required: true }),
        pick("payPer", "Per", [["hour", "Hour"], ["week", "Week"], ["month", "Month"], ["year", "Year"]], { showIf: { id: "includePay", equals: true }, default: "year" }),
        text("signerName", "Signed by (name)", { required: true }), text("signerTitle", "Their title", { required: true }), text("phone", "Phone for verification", { prefill: "clientPhone", required: true })] },
    ],
    body: `{{effectiveDate}}

To whom it may concern:

This letter confirms that {{employee}} {{#if current}}is employed{{else}}was employed{{/if}} by {{employer}} as a {{#if status=fulltime}}full-time{{/if}}{{#if status=parttime}}part-time{{/if}}{{#if status=seasonal}}seasonal{{/if}} {{position}}, {{#if current}}since {{startDate}}{{else}}from {{startDate}} to {{endDate}}{{/if}}.

{{#if includePay}}{{employee}}'s pay {{#if current}}is{{else}}was{{/if}} {{pay}} per {{#if payPer=hour}}hour{{/if}}{{#if payPer=week}}week{{/if}}{{#if payPer=month}}month{{/if}}{{#if payPer=year}}year{{/if}}.

{{/if}}{{#if authorized=yes}}This letter is based on {{employer}}'s records as of the date above and is provided at the employee's written request. It states only the facts listed above.{{else}}[DO NOT SEND — there is no written request or permission from the employee.]{{/if}} To verify, please call {{phone}}.

Sincerely,

Signature: ______________________________
{{signerName}}, {{signerTitle}}
{{employer}}{{#if employerAddress}}
{{employerAddress}}{{/if}}`,
  },

  /* ─────────────── Lending, lease & general ─────────────── */
  {
    key: "promissory_note", title: "Promissory Note", category: LENDING,
    description: "A written promise to repay a loan, with interest, payments and what happens if payments are missed.",
    reviewNote: "Maryland limits interest and fees on loans — generally 8% a year on a written loan, with exceptions for some corporate and large commercial loans — so confirm the rate with an attorney before signing. Real estate or a vehicle as security needs a separate recorded document. If the lender makes loans as a business, licensing rules may apply. A below-market loan between related people or companies can create taxable imputed interest (IRC §7872) — ask the tax preparer. Check that the number of payments, the first payment date and the final due date agree.",
    steps: [
      { title: "Parties", questions: [text("lender", "Lender", { required: true }), text("lenderAddress", "Lender's address"), text("borrower", "Borrower", { required: true }), text("borrowerAddress", "Borrower's address"), effective(), state()] },
      { title: "Loan", questions: [
        money("principal", "Amount borrowed", { required: true }),
        num("rate", "Annual interest rate (%)", { required: true, default: "0", help: "Enter 0 for no interest. Maryland limits interest on many loans (generally 8% a year on a written loan; some corporate and large commercial loans are exempt). Confirm the rate with the attorney before using more than 8%." }),
        pick("schedule", "Repayment", [["monthly", "Equal monthly payments"], ["lump", "One payment on the due date"]], { required: true, default: "monthly" }),
        num("months", "Number of monthly payments", { showIf: { id: "schedule", equals: "monthly" }, required: true }),
        money("paymentAmount", "Amount of each monthly payment", { showIf: { id: "schedule", equals: "monthly" }, required: true, help: "Principal plus interest, spread over the payments. Ask the firm to calculate it if there is interest." }),
        date("firstPayment", "First payment due", { showIf: { id: "schedule", equals: "monthly" }, required: true }),
        date("dueDate", "Final due date", { required: true, help: "For monthly payments this is the date of the last payment." }),
        yesno("lateFee", "Charge a late fee"), money("lateFeeAmount", "Late fee", { showIf: { id: "lateFee", equals: true }, required: true }),
        yesno("secured", "The loan is secured by property"), text("collateral", "Describe the property", { showIf: { id: "secured", equals: true }, required: true }),
        yesno("prepay", "Borrower may repay early without penalty", { default: true }),
      ] },
    ],
    body: `PROMISSORY NOTE

Date: {{effectiveDate}}
Principal: {{principal}}

1. PROMISE TO PAY
For value received, {{borrower}}{{#if borrowerAddress}} of {{borrowerAddress}}{{/if}} ("Borrower") promises to pay {{lender}}{{#if lenderAddress}} of {{lenderAddress}}{{/if}} ("Lender") {{principal}}{{#if rate}}, with simple interest at {{rate}}% per year (365-day year) on the unpaid balance{{else}}, without interest{{/if}}. Interest and fees together will never exceed the maximum the law allows; any excess is applied to principal or refunded to Borrower.

2. PAYMENTS
{{#if schedule=monthly}}Borrower will pay {{months}} monthly installments of {{paymentAmount}} each, on the same day of each month beginning {{firstPayment}}, and will pay all remaining principal{{#if rate}} and interest{{/if}} on {{dueDate}} (the "Maturity Date").{{else}}Borrower will pay the full principal{{#if rate}} and accrued interest{{/if}} in one payment on {{dueDate}} (the "Maturity Date").{{/if}} Payments are made by check or bank transfer to Lender{{#if lenderAddress}} at {{lenderAddress}}{{/if}}, or as Lender later directs in writing. Each payment is applied first to costs and late fees, then {{#if rate}}to interest, then {{/if}}to principal.

3. LATE PAYMENT AND DEFAULT
{{#if lateFee}}If a payment is received more than 10 days after its due date, Borrower will pay a one-time late fee of {{lateFeeAmount}} for that payment. {{/if}}Each of the following is a default: (a) a payment is not made within 10 days after Lender gives written notice that it is past due; (b) the whole balance is not paid on the Maturity Date; (c) Borrower becomes insolvent or files for bankruptcy; {{#if secured}}(d) Borrower gives Lender false information in connection with this note; or (e) the collateral is lost, damaged beyond use, or transferred without Lender's written consent.{{else}}or (d) Borrower gives Lender false information in connection with this note.{{/if}} On default, Lender may declare the whole unpaid balance due immediately.

4. PREPAYMENT
{{#if prepay}}Borrower may pay all or part of the balance early at any time without penalty.{{else}}Early payment requires Lender's written consent.{{/if}}

{{#if secured}}5. SECURITY
To secure this note, Borrower grants Lender a security interest in: {{collateral}}, and authorizes Lender to file financing statements. Real property and titled vehicles require a separate recorded document. If Borrower defaults, Lender may exercise the rights the law gives a secured lender.

{{/if}}6. COSTS AND GENERAL TERMS
If Borrower defaults, Borrower pays Lender's reasonable costs of collection, including attorney's fees actually incurred, to the extent the law allows. Borrower waives presentment, demand and protest. If more than one person signs as Borrower, each is responsible for the whole debt. Notices must be in writing and sent to the parties' addresses in this note or to a new address given in writing. If any term cannot be enforced, the rest stays in force. This note may be changed only in writing signed by both parties and is governed by the laws of the State of {{state}}.

BORROWER: {{borrower}}
Signature: ______________________________   Date: ______________
Printed name: ______________________   Title (if a company): ______________

LENDER: {{lender}}
Signature: ______________________________   Date: ______________
Printed name: ______________________   Title (if a company): ______________`,
  },
  {
    key: "nda_mutual", title: "Mutual Non-Disclosure Agreement", category: LENDING,
    description: "Two parties agree to keep each other's confidential information private.",
    reviewNote: "Choose a confidentiality period that fits the information; trade secrets stay protected as long as they remain secret. If one party is an individual contractor or consultant, confirm the wording with an attorney. Agreements like this cannot stop a person from reporting a suspected legal violation to the government.",
    steps: [
      { title: "Parties", questions: [text("partyA", "First party", { prefill: "clientName", required: true }), text("partyAAddress", "First party's address", { prefill: "clientAddress" }), text("partyB", "Second party", { required: true }), text("partyBAddress", "Second party's address"), effective(), state()] },
      { title: "Terms", questions: [area("purpose", "Why information is being shared", { required: true, placeholder: "e.g. Discussing a possible purchase of the business" }), num("years", "Confidentiality lasts (years)", { default: "3", required: true, help: "Counted from the last time information is shared. Trade secrets stay protected as long as they remain secret." })] },
    ],
    body: `MUTUAL NON-DISCLOSURE AGREEMENT

This Agreement is made on {{effectiveDate}} between {{partyA}}{{#if partyAAddress}}, {{partyAAddress}}{{/if}}, and {{partyB}}{{#if partyBAddress}}, {{partyBAddress}}{{/if}} (each a "Party").

1. PURPOSE
The Parties will share confidential information for this purpose: {{purpose}} (the "Purpose").

2. CONFIDENTIAL INFORMATION
"Confidential Information" is non-public information one Party gives the other, in any form, that is marked confidential or that a reasonable person would understand to be confidential, including financial, customer, pricing and business-plan information. A Party's "Representatives" are its owners, employees, lawyers, accountants, lenders and other advisors who need the information for the Purpose.

3. WHAT EACH PARTY AGREES TO DO
The receiving Party will use the Confidential Information only for the Purpose, keep it as secure as its own confidential information (and at least with reasonable care), and share it only with its Representatives who need it for the Purpose and are bound to keep it confidential. Each Party is responsible for any breach by its Representatives. A Party will tell the other promptly if it learns of an unauthorized use or disclosure.

4. WHAT IS NOT COVERED
This Agreement does not cover information that is or becomes public without a breach, was already known to the receiving Party, was independently developed, or was received lawfully from someone else. A Party may disclose information when the law requires, after giving prompt notice where allowed.

5. TERM AND RETURN OF INFORMATION
These obligations last {{years}} years after the later of the date of this Agreement and the date of the last disclosure; for information that is a trade secret, they last as long as it remains one. On request, each Party will return or destroy the other's Confidential Information, except copies it must keep by law or in routine backups, which stay confidential.

6. OWNERSHIP AND NO OBLIGATION
All Confidential Information stays the property of the Party that discloses it, and no license is granted. Neither Party must enter any transaction, and information is provided as is, without warranty.

7. REMEDIES AND GENERAL
Because a breach could cause harm money cannot fix, a Party may ask a court for an order stopping a breach. In a lawsuit to enforce this Agreement, the winning Party may recover its reasonable attorney's fees, to the extent the law allows. Any lawsuit must be brought in the courts of the State of {{state}}. Nothing in this Agreement prevents a person from confidentially disclosing a trade secret to a government official or an attorney solely to report or investigate a suspected violation of law. This is the Parties' entire agreement on its subject, may be changed only in writing signed by both, may be signed in counterparts and electronically, and is governed by the laws of the State of {{state}}. If a term cannot be enforced, the rest stays in force.

{{partyA}}
Signature: ______________________________   Date: ______________
Printed name: ______________________   Title (if a company): ______________

{{partyB}}
Signature: ______________________________   Date: ______________
Printed name: ______________________   Title (if a company): ______________`,
  },
  {
    key: "commercial_lease_short", title: "Short-Form Commercial Lease", category: LENDING,
    description: "A plain, short lease for a store or office: rent, term, deposit, taxes and the main rules.",
    reviewNote: "Commercial leases carry long-term obligations — have an attorney review it before signing, especially for longer terms. This short form is meant for small spaces and short terms; for a longer or larger lease use the full Commercial Lease Agreement. If the term including renewals is over seven years, sign and record a memorandum of lease (confirm with an attorney). Companies must sign through an officer with a title.",
    steps: [
      { title: "Parties and space", questions: [text("landlord", "Landlord", { required: true }), text("landlordAddress", "Landlord's address for notices", { required: true }), text("tenant", "Tenant", { prefill: "clientName", required: true }), text("tenantAddress", "Tenant's address for notices", { prefill: "clientAddress", required: true }), text("premises", "Address of the space", { required: true }), text("use", "Permitted use", { required: true, placeholder: "e.g. Retail convenience store" }), effective(), state()] },
      { title: "Term and rent", questions: [
        date("startDate", "Lease starts", { required: true }), date("endDate", "Lease ends", { required: true }), money("rent", "Monthly rent", { required: true }), num("rentDay", "Rent due on day of the month", { default: "1", required: true }), num("graceDays", "Days before rent is late", { default: "5", required: true }),
        money("deposit", "Security deposit", { required: true }), yesno("lateFee", "Charge a late fee"), money("lateFeeAmount", "Late fee", { showIf: { id: "lateFee", equals: true }, required: true }),
        pick("taxesBy", "Who pays property taxes and building insurance?", [["landlord", "Landlord"], ["tenant", "Tenant"]], { required: true, default: "landlord" }),
        pick("utilities", "Utilities", [["tenant", "Tenant pays all utilities"], ["landlord", "Landlord pays all utilities"], ["split", "As listed below"]], { required: true, default: "tenant" }),
        text("utilitiesNote", "Which utilities, and who pays", { showIf: { id: "utilities", equals: "split" }, required: true }),
        money("liabilityAmount", "Tenant's liability insurance (minimum per occurrence)", { default: "1000000", required: true }),
        yesno("renewal", "Tenant may renew for another term"), text("renewalTerms", "Renewal terms", { showIf: { id: "renewal", equals: true }, required: true, placeholder: "e.g. One 3-year renewal, 6 months' notice, rent increased by 3% a year" }),
        yesno("guarantee", "Someone personally guarantees the tenant's obligations"), text("guarantor", "Guarantor's name", { showIf: { id: "guarantee", equals: true }, required: true }),
      ] },
    ],
    body: `COMMERCIAL LEASE

This Lease is made on {{effectiveDate}} between {{landlord}}, {{landlordAddress}} ("Landlord") and {{tenant}}, {{tenantAddress}} ("Tenant").

1. PREMISES AND USE
Landlord leases to Tenant the space at {{premises}} (the "Premises"). Tenant will use it only for {{use}} and in compliance with all laws and required licenses. Landlord does not promise that zoning or any law allows Tenant's use; Tenant is responsible for confirming this and for every license and permit its business needs.

2. TERM
The Lease runs from {{startDate}} to {{endDate}}.{{#if renewal}} Renewal: {{renewalTerms}}.{{/if}} If the term, including any renewal, is longer than seven years, the parties will sign a memorandum of lease that either of them may record.

3. RENT
Tenant pays {{rent}} per month, due on day {{rentDay}} of each month. Rent not received within {{graceDays}} days after the due date is late{{#if lateFee}} and subject to a late fee of {{lateFeeAmount}}{{/if}}.

4. SECURITY DEPOSIT
Tenant pays a security deposit of {{deposit}}, held by Landlord and returned within 45 days after the Lease ends and Tenant has surrendered the Premises, less amounts needed for unpaid rent or damage beyond normal wear.

5. TAXES AND BUILDING INSURANCE
{{#if taxesBy=landlord}}Landlord pays the property taxes and the insurance on the building.{{else}}Tenant pays the property taxes and the insurance on the building, or repays Landlord for them within 30 days after Landlord's written request.{{/if}}

6. UTILITIES
{{#if utilities=tenant}}Tenant pays all utilities for the Premises.{{/if}}{{#if utilities=landlord}}Landlord pays all utilities for the Premises.{{/if}}{{#if utilities=split}}{{utilitiesNote}}{{/if}}

7. MAINTENANCE AND ALTERATIONS
Tenant keeps the Premises clean and in good condition and may not make structural changes without Landlord's written consent. Landlord is responsible for the roof, structure and building systems unless damage is caused by Tenant. Landlord may enter the Premises at reasonable times on reasonable notice to inspect or repair, and at any time in an emergency.

8. INSURANCE AND LIABILITY
Tenant carries commercial general liability insurance of at least {{liabilityAmount}} per occurrence, naming Landlord as an additional insured, plus insurance on its own property. Tenant protects Landlord from claims arising from Tenant's use of the Premises, except those caused by Landlord's negligence.

9. DAMAGE
If the Premises are damaged and cannot be used, rent is reduced until they are repaired. If repairs would take more than 120 days, either party may end the Lease by written notice.

10. DEFAULT
If Tenant does not pay rent within 10 days after written notice, or breaks another term and does not fix it within 30 days after written notice, Landlord may end the Lease and recover what the law allows.

11. ASSIGNMENT
Tenant may not assign this Lease or sublet without Landlord's written consent, which will not be unreasonably withheld.

12. END OF LEASE AND HOLDING OVER
At the end of the Lease Tenant returns the Premises clean and in good condition, normal wear excepted. If Tenant stays after the end date without a new written lease, Tenant is a holdover tenant and this is not a renewal: rent is 150% of the last monthly rent, prorated by day, and Landlord may recover possession.

{{#if guarantee}}13. GUARANTEE
{{guarantor}} personally and unconditionally guarantees that Tenant will pay all rent and perform all obligations under this Lease, as amended or renewed, and signs below to confirm it. The guarantee continues despite any change to the Lease or any delay by Landlord, and Landlord need not first pursue Tenant.

{{/if}}14. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}. Notices must be in writing and delivered to the addresses above. Each person who signs for a company states that he or she is authorized to do so.

LANDLORD: {{landlord}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

TENANT: {{tenant}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________
{{#if guarantee}}
GUARANTOR: {{guarantor}}
Signature: ______________________________   Date: ______________
{{/if}}`,
  },
  /* ─────────────── Batch 2: chosen from the LawDepot catalogue for this firm's work ─────────────── */
  {
    key: "single_member_llc_agreement", title: "Single-Member LLC Operating Agreement", category: BUSINESS,
    description: "For an LLC with one owner: ownership, management, taxes, adding a second owner, and what happens if the owner dies or cannot act.",
    reviewNote: "A short agreement helps keep the LLC separate from its owner. Have an attorney review it if the LLC owns significant property or has lenders. Confirm with an attorney: (1) how the successor named in the death clause is admitted and whether the owner's will or trust should also leave the interest to that person; (2) the effect of an S corporation election on the LLC's tax treatment — talk to the tax preparer before filing one; (3) if a second owner is ever added, replace this agreement with a multi-member operating agreement.",
    steps: [
      { title: "The company", questions: [text("companyName", "LLC name", { prefill: "clientName", required: true }), text("formedIn", "State where the LLC is formed", { default: "Maryland", required: true }), date("formationDate", "Date formed", { required: true }), text("address", "Principal address", { prefill: "clientAddress", required: true }), text("purpose", "Business purpose", { default: "any lawful business" }), effective()] },
      { title: "The owner", questions: [text("member", "Owner (member) name", { required: true }), text("memberAddress", "Owner's address"), money("contribution", "Capital contributed", { required: true }), text("successor", "Who takes over if the owner dies or cannot act", { placeholder: "Name — leave blank to follow state law" }), state()] },
    ],
    body: `SINGLE-MEMBER LLC OPERATING AGREEMENT OF {{companyName}}

This Operating Agreement is made on {{effectiveDate}} by {{member}}{{#if memberAddress}} of {{memberAddress}}{{/if}} (the "Member") for {{companyName}} (the "Company"), a limited liability company formed in {{formedIn}} on {{formationDate}}.

1. FORMATION AND PURPOSE
The Company's principal office is {{address}}. Its purpose is {{purpose}}. The Company continues until the Member ends it.

2. OWNERSHIP AND CAPITAL
The Member owns 100% of the Company and has contributed {{contribution}} in capital. The Member may contribute additional funds or take distributions at any time, and the Company records each as a capital contribution or distribution — not as pay or as a loan unless documented as a loan. A distribution is not made if the Company could not then pay its debts as they come due.

3. MANAGEMENT
The Member manages the Company and may act and sign on its behalf, open accounts, hire people and make every decision for the Company.

4. SEPARATE FROM THE OWNER
The Company keeps its own bank accounts and books, and the Member does not mix personal and Company funds. The Company signs contracts in its own name, and the Member signs for it as "Member" or "Manager", not in a personal capacity. The Member is not personally liable for the Company's debts solely because they are the Member. This Agreement is for the Member and the Company only; no creditor or other person may enforce it.

5. TAXES
The Company is a disregarded entity for federal income tax purposes, so its income and expenses are reported on the Member's own return, unless the Member elects in writing and files with the IRS for the Company to be taxed differently (for example as an S corporation). The Member should talk to the tax preparer before making any election.

6. ADDING ANOTHER MEMBER
The Company may admit another member only by a written amendment signed by the Member. When another member is admitted, this Agreement must be replaced by a multi-member operating agreement and the Company's tax treatment must be reviewed with the tax preparer.

7. DEATH OR INCAPACITY
{{#if successor}}If the Member dies, {{successor}} is admitted as the sole member of the Company at that moment, if {{successor}} accepts, and the Company continues without dissolving; if {{successor}} does not accept, the Member's personal representative may be admitted instead. If the Member is incapacitated, {{successor}} may manage the Company only as far as the Member's power of attorney or a court order allows.{{else}}If the Member dies, the Member's personal representative may be admitted as the member and continue the Company or wind it up, as state law allows. If the Member is incapacitated, the Company's affairs are handled as state law provides.{{/if}}

8. GENERAL
The Member may amend this Agreement at any time in writing. If a term cannot be enforced, the rest stays in force. This Agreement is governed by the laws of the State of {{state}}.

MEMBER
{{member}}
Signature: ______________________________   Date: ______________
If the Member is a trust or a company — By: ______________________________   Name: ______________________________   Title: ______________________________`,
  },
  {
    key: "corporate_resolution", title: "Company Resolution (Corporation or LLC)", category: BUSINESS,
    description: "Records a decision of a corporation's directors or shareholders, or of an LLC's members or manager — opening a bank account, borrowing, signing a lease, paying a bonus.",
    reviewNote: "Banks and agencies often insist on their own resolution form and on a certificate signed by an officer. For a corporation, action without a meeting needs the written consent of every director (or, for shareholders, every shareholder unless the charter allows less) and the consent is kept with the minutes. For an LLC, check what the operating agreement requires. If a signer has a personal interest in the decision (a bonus, loan or lease with the owner), confirm with an attorney how to document it.",
    steps: [
      { title: "The company", questions: [text("corporation", "Company or corporation name", { prefill: "clientName", required: true }), text("incorporatedIn", "State where it was formed", { default: "Maryland", required: true }), effective(),
        pick("actingBody", "Decision made by", [["directors", "The board of directors (corporation)"], ["shareholders", "The shareholders (corporation)"], ["members", "The members (LLC)"], ["manager", "The manager (LLC)"]], { required: true, default: "directors" }),
        pick("how", "Adopted", [["meeting", "At a meeting"], ["writing", "By written consent, without a meeting"]], { required: true, default: "writing" }),
        date("meetingDate", "Date of the meeting", { showIf: { id: "how", equals: "meeting" } }),
        yesno("quorumPresent", "A quorum was present at the meeting", { showIf: { id: "how", equals: "meeting" }, default: false }),
        num("votesFor", "Votes in favor", { showIf: { id: "how", equals: "meeting" } }),
        num("votesAgainst", "Votes against", { showIf: { id: "how", equals: "meeting" } }),
        yesno("allSign", "Every person entitled to vote is signing below", { showIf: { id: "how", equals: "writing" }, default: false })] },
      { title: "The decision", questions: [text("subject", "Subject", { required: true, placeholder: "e.g. Authority to open a business bank account" }),
        area("resolved", "What is decided", { required: true, placeholder: "e.g. the corporation is authorized to open an account at First Bank, and the President may sign all documents needed." }),
        text("authorizedPerson", "Person authorized to carry it out", { placeholder: "e.g. Ali Hassan, President" }),
        yesno("interested", "A person signing or carrying this out has a personal interest in it (for example a bonus, loan or lease with the owner)", { default: false }),
        text("interestedPerson", "Who has the interest", { showIf: { id: "interested", equals: true }, required: true }),
        list("signers", "People approving", [text("name", "Name", { required: true }), text("role", "Title (optional)")], { required: true, addLabel: "Add a person" })] },
    ],
    body: `{{corporation}}
({{#if actingBody=directors}}a corporation{{/if}}{{#if actingBody=shareholders}}a corporation{{/if}}{{#if actingBody=members}}a limited liability company{{/if}}{{#if actingBody=manager}}a limited liability company{{/if}} formed under the laws of the State of {{incorporatedIn}})

{{#if actingBody=directors}}RESOLUTION OF THE BOARD OF DIRECTORS{{/if}}{{#if actingBody=shareholders}}RESOLUTION OF THE SHAREHOLDERS{{/if}}{{#if actingBody=members}}RESOLUTION OF THE MEMBERS{{/if}}{{#if actingBody=manager}}RESOLUTION OF THE MANAGER{{/if}}

Subject: {{subject}}
Date: {{effectiveDate}}

{{#if actingBody=manager}}The undersigned, being the manager of {{corporation}}, adopts the following resolution in writing:{{else}}{{#if how=meeting}}At a meeting{{#if meetingDate}} held on {{meetingDate}}{{/if}}, the {{#if actingBody=directors}}directors{{/if}}{{#if actingBody=shareholders}}shareholders{{/if}}{{#if actingBody=members}}members{{/if}} of {{corporation}} adopted the following resolution{{#if quorumPresent}}, a quorum being present{{/if}}{{#if votesFor}}, by a vote of {{votesFor}} in favor{{#if votesAgainst}} and {{votesAgainst}} against{{/if}}{{/if}}:{{else}}The undersigned {{#if actingBody=directors}}directors{{/if}}{{#if actingBody=shareholders}}shareholders{{/if}}{{#if actingBody=members}}members{{/if}} of {{corporation}} consent to and adopt the following resolution without a meeting. This consent takes effect only when it is signed by every {{#if actingBody=directors}}director{{/if}}{{#if actingBody=shareholders}}shareholder{{/if}}{{#if actingBody=members}}member{{/if}} entitled to vote{{#if !actingBody=directors}} (or by the number the company's governing documents allow){{/if}}{{#if allSign}}, and every one of them has signed below{{/if}}, and it will be filed with the company's records:{{/if}}{{/if}}

RESOLVED, that {{resolved}}

{{#if authorizedPerson}}FURTHER RESOLVED, that {{authorizedPerson}} is authorized to take every action and sign every document needed to carry out this resolution, and any such action already taken within the scope of this resolution is approved and confirmed.

{{/if}}{{#if interested}}The interest of {{interestedPerson}} in this matter was disclosed to the {{#if actingBody=directors}}board{{/if}}{{#if actingBody=shareholders}}shareholders{{/if}}{{#if actingBody=members}}members{{/if}}{{#if actingBody=manager}}members{{/if}} and is known to them.

{{/if}}This resolution is to be kept with the company's records.{{#if actingBody=members}} If a signer is a company, it signs through an authorized person whose name and title are written next to its signature.{{/if}}

{{#list signers}}{{name}}{{#if role}}, {{role}}{{/if}}
Signature: ______________________________   Date: ______________

{{/list}}{{#if how=meeting}}{{#if !actingBody=manager}}CERTIFICATE
I, ______________________________, the ______________________________ of {{corporation}}, certify that the above is a true copy of a resolution adopted{{#if meetingDate}} on {{meetingDate}}{{/if}} and that it has not been changed or withdrawn.
Signature: ______________________________   Date: ______________{{/if}}{{/if}}`,
  },
  {
    key: "annual_meeting_minutes", title: "Minutes of Annual Meeting", category: BUSINESS,
    description: "A record of a corporation's yearly meeting — attendance, directors elected, officers named, reports reviewed and any pay or distributions decided.",
    reviewNote: "For corporations. An LLC has no yearly-meeting requirement under this form — use a Company Resolution or written consent instead. Corporations are expected to hold a yearly shareholder meeting to elect directors, and shareholders can act by unanimous written consent instead; confirm what your bylaws require. Only fill in the quorum, share-count and notice questions if they are true — the minutes repeat exactly what you enter. Confirm the filing deadlines for the corporation's yearly state and tax filings with the tax preparer.",
    steps: [
      { title: "Meeting", questions: [text("corporation", "Corporation name", { prefill: "clientName", required: true }), date("meetingDate", "Date of meeting", { required: true }), text("place", "Place (or 'by phone / video')", { required: true }), text("chair", "Chairperson", { required: true }), text("secretary", "Secretary (took the minutes)", { required: true }),
        pick("who", "Meeting of", [["shareholders", "Shareholders"], ["directors", "Directors"], ["both", "Shareholders and directors"]], { required: true, default: "both" }),
        pick("notice", "Notice of the meeting", [["skip", "Do not say anything about notice"], ["given", "Notice was given as the bylaws require"], ["waived", "Notice was waived in writing"]], { required: true, default: "skip" }),
        yesno("quorumPresent", "A quorum was present", { default: false }),
        num("sharesOutstanding", "Shares entitled to vote (shareholder meetings)"), num("sharesRepresented", "Shares present in person or by proxy (shareholder meetings)")] },
      { title: "Business", questions: [
        list("attendees", "Present", [text("name", "Name", { required: true }), text("capacity", "Shareholder / director / officer")], { required: true, addLabel: "Add a person" }),
        list("directors", "Directors elected or re-elected (shareholder meetings)", [text("name", "Name", { required: true })], { addLabel: "Add a director" }),
        list("officers", "Officers appointed (director meetings)", [text("name", "Name", { required: true }), text("office", "Office", { required: true, placeholder: "President, Secretary, Treasurer" })], { addLabel: "Add an officer" }),
        yesno("priorMinutes", "The minutes of the last meeting were approved", { default: false }),
        yesno("financials", "Financial statements for the past year were reviewed", { default: true }), yesno("taxReturns", "The tax filings for the year were reviewed", { default: true }),
        yesno("filings", "The officers were directed to make the corporation's required yearly state and tax filings", { default: false }),
        yesno("ratify", "The acts of the directors and officers during the year were approved", { default: false }),
        area("compDist", "Officer pay, dividends or distributions decided"),
        area("otherBusiness", "Other business discussed or decided"),
      ] },
    ],
    body: `MINUTES OF THE ANNUAL MEETING
{{corporation}}

A meeting of the {{#if who=shareholders}}shareholders{{/if}}{{#if who=directors}}directors{{/if}}{{#if who=both}}shareholders and directors{{/if}} of {{corporation}} was held on {{meetingDate}} at {{place}}.

PRESENT
{{#list attendees}}• {{name}}{{#if capacity}} ({{capacity}}){{/if}}
{{/list}}
{{chair}} acted as chairperson and {{secretary}} acted as secretary. The chairperson called the meeting to order.{{#if quorumPresent}} The chairperson noted that a quorum was present.{{/if}}{{#if !who=directors}}{{#if sharesRepresented}} Holders of {{sharesRepresented}}{{#if sharesOutstanding}} of the {{sharesOutstanding}}{{/if}} shares entitled to vote were present in person or by proxy.{{/if}}{{/if}}{{#if notice=given}} Notice of the meeting was given as the bylaws require.{{/if}}{{#if notice=waived}} Notice of the meeting was waived in writing.{{/if}}

{{#if !who=directors}}{{#if directors}}1. DIRECTORS
The following were elected to serve as directors until the next annual meeting and until their successors are elected:
{{#list directors}}• {{name}}
{{/list}}

{{/if}}{{/if}}{{#if !who=shareholders}}{{#if officers}}2. OFFICERS
The directors appointed these officers:
{{#list officers}}• {{name}} — {{office}}
{{/list}}

{{/if}}{{/if}}3. REPORTS
{{#if priorMinutes}}The minutes of the last meeting were approved. {{/if}}{{#if financials}}The financial statements for the past year were presented and reviewed.{{else}}No financial statements were presented.{{/if}} {{#if taxReturns}}The corporation's tax filings for the year were reviewed.{{else}}The tax filings for the year were not reviewed at this meeting.{{/if}}{{#if filings}} The officers were directed to make the corporation's required yearly state and tax filings.{{/if}}

{{#if ratify}}4. ACTS OF DIRECTORS AND OFFICERS
The acts of the directors and officers on behalf of the corporation during the past year were approved.

{{/if}}{{#if compDist}}5. PAY AND DISTRIBUTIONS
{{compDist}}

{{/if}}{{#if otherBusiness}}6. OTHER BUSINESS
{{otherBusiness}}

{{/if}}There being no further business, the meeting was adjourned.

Secretary: {{secretary}}
Signature: ______________________________   Date: ______________

Chairperson: {{chair}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "shareholder_loan_agreement", title: "Owner / Shareholder Loan Agreement", category: LENDING,
    description: "Documents money an owner lends to their own business (or the business lends to an owner) so it is a loan, not income or equity.",
    reviewNote: "Documenting an owner loan matters for tax: without a written agreement, real repayments and a fair interest rate it can be treated as capital, pay or a distribution. Interest below the IRS applicable federal rate (AFR) can create taxable imputed interest (IRC §7872) when the loans between the owner and the business total more than $10,000 — ask the tax preparer for the AFR and keep the books and repayments consistent with this agreement. A loan from a company to its owner can be treated as a distribution or pay; for an S corporation also ask about basis. The other owners or the board should approve it. Confirm any rate above 8% and any security terms with an attorney.",
    steps: [
      { title: "Parties", questions: [text("company", "Business", { prefill: "clientName", required: true }), text("owner", "Owner / shareholder", { required: true }), pick("direction", "Who is lending?", [["toBusiness", "The owner lends money to the business"], ["toOwner", "The business lends money to the owner"]], { required: true, default: "toBusiness" }),
        text("companySigner", "Person signing for the business", { required: true, help: "Often the same person as the owner, signing in a business role." }), text("companyTitle", "Their title", { required: true, placeholder: "e.g. Managing Member, President" }),
        text("approvedBy", "Who approved this loan for the business", { required: true, placeholder: "e.g. the other members, or the board of directors" }), effective(), state()] },
      { title: "Loan", questions: [money("principal", "Amount", { required: true }),
        num("rate", "Annual interest rate (%)", { required: true, help: "Choose a rate at least equal to the IRS applicable federal rate (AFR) for the loan's term in the month the loan is made; the tax preparer can look it up (the IRS publishes it monthly). Total loans of $10,000 or less between the owner and the business are generally exempt, but confirm that with the tax preparer. Enter 0 only if you have confirmed that no interest is acceptable." }),
        pick("schedule", "Repayment", [["monthly", "Monthly payments"], ["demand", "Repayable on demand"], ["date", "One payment on a date"]], { required: true, default: "monthly" }),
        num("months", "Number of monthly payments", { showIf: { id: "schedule", equals: "monthly" }, required: true }),
        money("paymentAmount", "Amount of each monthly payment", { showIf: { id: "schedule", equals: "monthly" }, required: true }),
        date("firstPayment", "First payment due", { showIf: { id: "schedule", equals: "monthly" }, required: true }),
        date("repayBy", "Repay by", { showIf: { id: "schedule", equals: "date" }, required: true }),
        yesno("secured", "Secured by property"), text("collateral", "Property pledged", { showIf: { id: "secured", equals: true }, required: true })] },
    ],
    body: `{{#if direction=toBusiness}}SHAREHOLDER LOAN AGREEMENT{{else}}LOAN FROM COMPANY TO OWNER{{/if}}

This Agreement is made on {{effectiveDate}} between {{company}} (the "Company") and {{owner}} (the "Owner").

1. THE LOAN
{{#if direction=toBusiness}}The Owner lends the Company {{principal}}. The Company records this as a loan from the Owner and not as capital, income or pay.{{else}}The Company lends the Owner {{principal}}. The Company records this as a loan receivable and not as pay or a distribution.{{/if}}

2. INTEREST
{{#if rate}}Interest accrues at {{rate}}% per year, as simple interest on the unpaid balance, and is paid as part of the repayment described below.{{else}}No interest is charged on this loan.{{/if}}

3. REPAYMENT
{{#if schedule=monthly}}The loan is repaid in {{months}} equal monthly payments of {{paymentAmount}}, each covering principal{{#if rate}} and interest{{/if}}, on the same day of each month beginning {{firstPayment}}.{{/if}}{{#if schedule=demand}}The loan is repayable within 30 days after written demand by the party that made the loan.{{/if}}{{#if schedule=date}}The loan{{#if rate}}, with accrued interest,{{/if}} is repaid in full by {{repayBy}}.{{/if}} The party that received the loan may repay all or part of it early at any time without penalty. The Company keeps a written record of all advances and repayments.

4. DEFAULT
If a payment is not made within 10 days after written notice that it is past due, or the party that received the loan becomes insolvent or files for bankruptcy, the party that made the loan may declare the whole unpaid balance due immediately.

{{#if secured}}5. SECURITY
To secure repayment, {{#if direction=toBusiness}}the Company grants the Owner{{else}}the Owner grants the Company{{/if}} a security interest in: {{collateral}}.{{#if direction=toBusiness}} The Owner will sign a subordination agreement if the Company's bank or another lender reasonably requires one.{{/if}}

{{/if}}6. INTENT AND APPROVAL
The parties intend this to be a genuine loan that will be repaid. {{approvedBy}} approved this loan for the Company. {{#if direction=toBusiness}}While any balance is unpaid, the Company will not make distributions to owners that would impair its ability to repay this loan.{{else}}The Company will not forgive any part of this loan except by a written decision recorded in its records.{{/if}}

7. GENERAL
Notices must be in writing. This Agreement is the parties' entire agreement on this loan, may be changed only in writing signed by both parties, and is governed by the laws of the State of {{state}}. If any term cannot be enforced, the rest stays in force.

COMPANY: {{company}}
Signature: ______________________________   Date: ______________
Printed name: {{companySigner}}   Title: {{companyTitle}}

OWNER: {{owner}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "payment_agreement", title: "Payment Plan Agreement", category: LENDING,
    description: "An agreed schedule for paying an overdue balance in installments — for invoices, rent or a debt.",
    reviewNote: "If the person owing the money is an individual and the balance is for personal or household services, Maryland late-fee and debt-collection rules can apply — keep late fees reasonable and confirm with an attorney. A tax practitioner must return client records on request even when fees are unpaid (31 CFR §10.28), so the pause option says so. By signing, the debtor acknowledges the debt; ask an attorney whether that extends the time limit for suing on it. Check that the installments add up to the balance by the final date.",
    steps: [
      { title: "Parties", questions: [text("creditor", "Owed to", { prefill: "firmName", required: true }), text("debtor", "Owed by", { prefill: "clientName", required: true }), effective(), state()] },
      { title: "The plan", questions: [text("reason", "What the balance is for", { required: true, placeholder: "e.g. Unpaid invoices for bookkeeping services" }), money("total", "Total owed", { required: true }), money("down", "Paid on the date of the agreement (optional)"),
        money("installment", "Installment amount", { required: true }), pick("frequency", "Paid", [["weekly", "Every week"], ["biweekly", "Every two weeks"], ["monthly", "Every month"]], { required: true, default: "monthly" }), date("firstDue", "First installment due", { required: true }),
        date("finalDue", "Balance paid in full by", { required: true, help: "The last installment is whatever remains, due by this date." }),
        yesno("lateFee", "Charge a late fee"), money("lateFeeAmount", "Late fee", { showIf: { id: "lateFee", equals: true }, required: true }),
        yesno("pauseWork", "New work may be paused if a payment is missed", { default: false })] },
    ],
    body: `PAYMENT PLAN AGREEMENT

This Agreement is made on {{effectiveDate}} between {{creditor}} ("Creditor") and {{debtor}} ("Debtor").

1. THE BALANCE
Debtor owes Creditor {{total}} for: {{reason}}. Debtor acknowledges that the balance is correct and due.

2. PAYMENT PLAN
{{#if down}}On the date of this Agreement Debtor pays {{down}}. {{/if}}Debtor will pay {{installment}} {{#if frequency=weekly}}every week{{/if}}{{#if frequency=biweekly}}every two weeks{{/if}}{{#if frequency=monthly}}every month{{/if}}, starting {{firstDue}}. The last installment is the entire remaining balance and is due no later than {{finalDue}}. Debtor may pay more at any time. No interest accrues under this plan unless Debtor defaults. Payments are made by check or bank transfer to Creditor, or as Creditor directs in writing.

3. MISSED PAYMENTS
{{#if lateFee}}If a payment is received more than 7 days after its due date, Debtor will pay a one-time late fee of {{lateFeeAmount}} for that payment. {{/if}}If a payment is more than 14 days late and Debtor has not paid it within 7 days after Creditor's written notice, Creditor may declare the whole remaining balance due at once. If that happens, any interest or fees that the original agreement or the law allows may be added to the unpaid balance.{{#if pauseWork}} Creditor may also pause new work until the account is current, but will return Debtor's records on request and will not delay any filing that has a legal deadline.{{/if}}

4. GENERAL
If Debtor defaults, Debtor also pays Creditor's reasonable costs of collection, including attorney's fees actually incurred, to the extent the law allows. This Agreement does not cancel the debt or waive any of Creditor's rights if Debtor defaults, and accepting a late payment is not a waiver. When the balance is paid in full, Creditor will confirm in writing that it is paid. Notices must be in writing. This Agreement may be changed only in writing signed by both and is governed by the laws of the State of {{state}}.

DEBTOR: {{debtor}}
Signature: ______________________________   Date: ______________
Printed name: ______________________   Title (if a company): ______________

CREDITOR: {{creditor}}
Signature: ______________________________   Date: ______________
Printed name: ______________________   Title (if a company): ______________`,
  },
  {
    key: "employment_contract", title: "Employment Agreement", category: EMPLOYMENT,
    description: "A fuller written agreement than an offer letter: duties, pay, hours, confidentiality and how employment can end.",
    reviewNote: "Maryland requires written notice at hiring of pay rate, regular paydays and leave (Labor & Employment §3-504), final pay by the next regular payday (§3-505), and pay at least every two weeks or twice a month (§3-502). This agreement has no non-compete; Maryland voids non-competes for lower-wage workers (§3-716) — use the separate Non-Competition agreement only after checking. Have an attorney review before use.",
    steps: [
      { title: "Parties and role", questions: [text("employer", "Employer", { prefill: "clientName", required: true }), text("employerAddress", "Employer address", { prefill: "clientAddress" }), text("employee", "Employee", { required: true }), text("employeeAddress", "Employee address"), effective(), text("position", "Position", { required: true }), area("duties", "Main duties", { required: true }), date("startDate", "Start date", { required: true }), state()] },
      { title: "Pay and terms", questions: [pick("payType", "Pay", [["hourly", "Hourly"], ["salary", "Salary"]], { required: true, default: "hourly" }), money("rate", "Hourly rate or annual salary", { required: true, help: "Must not be below the Maryland minimum wage." }), pick("payFrequency", "Paid", [["weekly", "Weekly"], ["biweekly", "Every two weeks"], ["semimonthly", "Twice a month"], ["monthly", "Monthly"]], { default: "biweekly", required: true }),
        text("hours", "Expected hours", { placeholder: "e.g. 40 hours a week" }), yesno("hasProbation", "Include an introductory period", { default: true }), num("probation", "Introductory period (days)", { default: "90", showIf: { id: "hasProbation", equals: true }, required: true }), num("noticeDays", "Notice to resign (days)", { default: "14", required: true }),
        yesno("confidential", "Employee keeps business information confidential", { default: true }), area("benefits", "Benefits, vacation or other terms")] },
    ],
    body: `EMPLOYMENT AGREEMENT

This Agreement is made on {{effectiveDate}} between {{employer}}{{#if employerAddress}}, {{employerAddress}}{{/if}} ("Employer") and {{employee}}{{#if employeeAddress}}, {{employeeAddress}}{{/if}} ("Employee").

1. POSITION AND DUTIES
Employer employs Employee as {{position}} beginning {{startDate}}. Duties include: {{duties}} Employee will also perform other reasonable duties Employer assigns. Employment depends on Employee completing Form W-4 and Form I-9 as the law requires.

2. PAY
Employee is paid {{#if payType=hourly}}{{rate}} per hour{{else}}a salary of {{rate}} per year{{/if}}, {{#if payFrequency=weekly}}every week{{/if}}{{#if payFrequency=biweekly}}every two weeks{{/if}}{{#if payFrequency=semimonthly}}twice each month{{/if}}{{#if payFrequency=monthly}}once a month{{/if}}, on Employer's regular paydays, less required tax withholding and deductions Employee authorizes in writing.{{#if hours}} Expected hours: {{hours}}.{{/if}} Employer will give Employee at least one pay period's notice before changing the payday or lowering the rate of pay. {{#if payType=hourly}}Hours over 40 in a workweek are paid at overtime rates as the law requires.{{else}}A salary alone does not make a position exempt from overtime; unless Employer states in writing that the position is exempt, hours over 40 in a workweek are paid at overtime rates as the law requires.{{/if}}

{{#if hasProbation}}3. INTRODUCTORY PERIOD
The first {{probation}} days are an introductory period for both sides to decide whether the job is a good fit. Finishing this period does not change the at-will nature of employment described in this Agreement.

{{/if}}4. {{#if benefits}}BENEFITS, LEAVE AND OTHER TERMS{{else}}BENEFITS AND LEAVE{{/if}}
{{#if benefits}}{{benefits}}{{else}}Employee receives the benefits Employer offers to its employees under its policies, which Employer may change.{{/if}} Employee earns paid sick and safe leave as Maryland law requires. Whether unused vacation or other paid leave is paid when employment ends is stated in Employer's written leave policy.

{{#if confidential}}5. CONFIDENTIALITY
Employee will not share or use Employer's non-public business, customer or financial information except for Employer's business, during or after employment. Nothing in this Agreement stops Employee from discussing wages or working conditions with coworkers or others where the law protects that, or from reporting a possible violation of law to a government agency. Under 18 U.S.C. § 1833(b), an individual is not liable under any trade-secret law for disclosing a trade secret in confidence to a government official or an attorney solely to report or investigate a suspected violation of law, or in a sealed court filing.

{{/if}}6. AT-WILL EMPLOYMENT AND NOTICE
Employment is at will: either party may end it at any time. Employee agrees to give {{noticeDays}} days' notice of resignation where possible; Employer may accept an earlier last day, and Employee is paid only for hours actually worked. On leaving, Employee returns all Employer property, and Employer pays all wages earned through the last day worked no later than the regular payday that would have applied had employment continued.

7. GENERAL
Employer carries workers' compensation insurance as Maryland law requires. Work Employee creates for Employer in the job belongs to Employer. This is the parties' entire agreement, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}. If any part of it cannot be enforced, the rest stays in force.

EMPLOYER: {{employer}}
Signature: ______________________________   Date: ______________

EMPLOYEE: {{employee}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "employee_warning_letter", title: "Employee Warning Letter", category: EMPLOYMENT,
    description: "A written warning that records what happened, what is expected, and the consequence of it happening again.",
    reviewNote: "Keep to dates and facts. Do not mention medical conditions, leave, pay complaints, injury reports, talking with coworkers about pay, religion, nationality or other protected activity — discipline that follows such things can be treated as retaliation. Have an attorney review before using it for a final warning.",
    steps: [
      { title: "Details", questions: [text("employer", "Employer", { prefill: "clientName", required: true }), text("employee", "Employee", { required: true }), effective(), pick("level", "Warning level", [["verbal", "Written record of a verbal warning"], ["first", "First written warning"], ["final", "Final written warning"]], { required: true, default: "first" }),
        date("incidentDate", "Date of the issue", { required: true }), area("issue", "What happened (dates and facts only)", { required: true, help: "No medical, leave, pay-complaint or other protected matters." }), area("expectation", "What is expected from now on", { required: true }),
        yesno("priorWarnings", "There were earlier warnings about this"), text("priorDates", "Dates of earlier warnings", { showIf: { id: "priorWarnings", equals: true } }),
        text("managerName", "Issued by (name)", { required: true }), text("managerTitle", "Their title", { required: true })] },
    ],
    body: `{{effectiveDate}}

{{employee}}

Re: {{#if level=verbal}}Record of verbal warning{{/if}}{{#if level=first}}First written warning{{/if}}{{#if level=final}}Final written warning{{/if}}

Dear {{employee}},

This letter {{#if level=verbal}}records a verbal warning given to you{{else}}is a written warning to you{{/if}} about the following issue on {{incidentDate}}:

{{issue}}

{{#if priorWarnings}}You were previously warned about this on {{priorDates}}.

{{/if}}WHAT IS EXPECTED
{{expectation}}

{{#if level=final}}This is a final written warning. Further problems of this kind may lead to ending your employment.{{else}}If this issue continues or happens again, further disciplinary action may follow, up to and including ending your employment.{{/if}} This letter does not change the at-will nature of your employment: {{employer}} may end employment at any time, with or without prior warnings.

If you disagree with anything in this letter, you may add your comments in writing. Signing below shows you received this letter; it does not mean you agree with it. This letter was explained to me in a language I understand.

Issued by: {{managerName}}, {{managerTitle}}
{{employer}}
Signature: ______________________________   Date: ______________

Employee: {{employee}}
Signature: ______________________________   Date: ______________
If the employee declined to sign: declined on ______________ in the presence of ______________________`,
  },
  {
    key: "resignation_letter", title: "Resignation Letter", category: EMPLOYMENT,
    description: "A person gives notice that they are leaving their job.",
    steps: [
      { title: "Details", questions: [text("employee", "Employee name", { required: true }), text("employer", "Employer", { prefill: "clientName", required: true }), text("addressee", "Addressed to (name and title)"), effective(), text("position", "Position"), date("lastDay", "Last day of work", { required: true }), text("reason", "Reason (optional)", { help: "Keep it neutral and short." }), yesno("transition", "Offer to help with the handover", { default: true })] },
    ],
    body: `{{effectiveDate}}

{{#if addressee}}{{addressee}}
{{/if}}{{employer}}

Re: Resignation{{#if position}} — {{position}}{{/if}}

Dear {{#if addressee}}{{addressee}}{{else}}Sir or Madam{{/if}},

I am resigning from my position{{#if position}} as {{position}}{{/if}} with {{employer}}. My last day of work will be {{lastDay}}.{{#if reason}} {{reason}}{{/if}}

{{#if transition}}I will gladly help make the handover smooth and train a replacement before I leave. {{/if}}I understand my final pay is due by the regular payday after my last day; please tell me how unused leave is treated under your policy. Please send my final pay and my tax forms to my address on file.

Thank you for the opportunity.

Sincerely,
{{employee}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "service_agreement", title: "Service Agreement", category: LENDING,
    description: "A general agreement for one business to provide services to another — scope, price, timing and rules.",
    reviewNote: "Confirm the limit-of-liability and late-interest wording with an attorney. If the provider will handle the customer's tax or personal information, add a data-security term and get any separate consent that tax-return rules require (IRC §7216). Whether someone is a true independent contractor depends on the facts (Maryland Labor & Employment §8-205 and IRS rules), not only on this wording.",
    steps: [
      { title: "Parties", questions: [text("provider", "Service provider", { required: true }), text("providerAddress", "Provider's address"), text("customer", "Customer", { prefill: "clientName", required: true }), text("customerAddress", "Customer's address", { prefill: "clientAddress" }), effective(), state()] },
      { title: "Services and price", questions: [area("services", "Services", { required: true }), date("startDate", "Starts", { required: true }), yesno("hasEnd", "Fixed end date"), date("endDate", "Ends", { showIf: { id: "hasEnd", equals: true }, required: true }),
        pick("priceType", "Price", [["fixed", "A fixed price"], ["hourly", "Hourly"], ["monthly", "Monthly"]], { required: true, default: "fixed" }), money("price", "Amount", { required: true }),
        text("fixedSchedule", "When the fixed price is invoiced", { showIf: { id: "priceType", equals: "fixed" }, placeholder: "e.g. 50% when work starts and 50% when it is finished" }),
        money("hourlyCap", "Most the provider may bill without the customer's written approval (optional)", { showIf: { id: "priceType", equals: "hourly" } }),
        num("payDays", "Invoices paid within (days)", { default: "30", required: true }),
        yesno("warranty", "Provider will fix errors in the work at no charge", { default: true }), yesno("insurance", "Provider carries liability insurance"), money("insuranceAmount", "Coverage amount (optional)", { showIf: { id: "insurance", equals: true } })] },
    ],
    body: `SERVICE AGREEMENT

This Agreement is made on {{effectiveDate}} between {{provider}}{{#if providerAddress}}, {{providerAddress}}{{/if}} ("Provider") and {{customer}}{{#if customerAddress}}, {{customerAddress}}{{/if}} ("Customer").

1. SERVICES
Provider will perform these services for Customer: {{services}}

2. TERM
Services start on {{startDate}}{{#if hasEnd}} and end on {{endDate}}{{else}} and continue until either party ends this Agreement on 30 days' written notice{{/if}}.

3. PRICE AND PAYMENT
Customer will pay Provider {{#if priceType=fixed}}a fixed price of {{price}}{{/if}}{{#if priceType=hourly}}{{price}} per hour{{/if}}{{#if priceType=monthly}}{{price}} per month{{/if}}. {{#if priceType=fixed}}{{#if fixedSchedule}}The fixed price is invoiced {{fixedSchedule}}. {{/if}}{{/if}}{{#if priceType=hourly}}{{#if hourlyCap}}Provider will not bill more than {{hourlyCap}} without Customer's written approval. {{/if}}{{/if}}Provider will invoice Customer and Customer will pay within {{payDays}} days of each invoice. Amounts unpaid after the due date accrue interest at 1% per month, or the maximum the law allows if less. Prices do not include any sales or similar tax that applies to the services; Customer pays it.

4. QUALITY OF WORK
Provider will perform the services in a professional manner.{{#if warranty}} Provider will correct errors in the services at no extra charge if Customer reports them within 30 days of the work being done. This correction is Customer's only remedy for errors in the services.{{/if}}{{#if insurance}} Provider carries liability insurance{{#if insuranceAmount}} of at least {{insuranceAmount}}{{/if}} for the services and will give Customer proof of it on request.{{/if}}

5. OWNERSHIP OF WORK
Customer owns the final deliverables once they are paid for. Provider keeps its own tools, templates and know-how.

6. LIMIT OF LIABILITY
Provider's total liability under this Agreement is limited to the fees Customer paid for the services that gave rise to the claim, and neither party is liable to the other for indirect or consequential losses. This does not limit any liability that the law does not allow to be limited.

7. INDEPENDENT PARTIES
Provider is an independent contractor and not Customer's employee. Provider decides how the work is done, uses its own tools, has no authority to bind Customer, and receives no employee benefits. Provider is responsible for its own taxes, insurance and workers.

8. CONFIDENTIALITY
Each party will keep the other's non-public business information confidential, use it only for this Agreement, and return or destroy it on request, during and after this Agreement. This does not cover information that is public through no fault of the receiving party, was already known to it, or must be disclosed by law.

9. ENDING THE AGREEMENT
Either party may end this Agreement if the other materially breaks it and does not fix the problem within 15 days of written notice. Customer pays for services performed up to the date the Agreement ends.

10. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, and may not be assigned without the other party's written consent. Notices must be in writing. If a term cannot be enforced, the rest stays in force. This Agreement may be signed electronically and is governed by the laws of the State of {{state}}.

PROVIDER: {{provider}}
Signature: ______________________________   Date: ______________
Printed name: ______________________   Title (if a company): ______________

CUSTOMER: {{customer}}
Signature: ______________________________   Date: ______________
Printed name: ______________________   Title (if a company): ______________`,
  },
  {
    key: "consulting_agreement", title: "Consulting Agreement", category: LENDING,
    description: "A consultant gives advice or expertise to a business for an agreed fee.",
    reviewNote: "Whether a consultant is truly independent depends on the facts (control, own business, other clients — Maryland Labor & Employment §8-205 and IRS rules), not only on this wording. Get a Form W-9 from the consultant before paying. Confirm the work-product assignment and confidentiality wording with an attorney.",
    steps: [
      { title: "Parties", questions: [text("client", "Company", { prefill: "clientName", required: true }), text("clientAddress", "Company address", { prefill: "clientAddress" }), text("consultant", "Consultant", { required: true }), text("consultantAddress", "Consultant's address"), effective(), state()] },
      { title: "Work", questions: [area("scope", "What the consultant will do", { required: true }), date("startDate", "Start date", { required: true }), yesno("hasEnd", "Fixed end date"), date("endDate", "End date", { showIf: { id: "hasEnd", equals: true }, required: true }),
        pick("feeType", "Fee", [["fixed", "Fixed fee"], ["hourly", "Hourly"], ["monthly", "Monthly retainer"]], { required: true, default: "hourly" }), money("fee", "Amount", { required: true }),
        text("feeSchedule", "When the fixed fee is invoiced", { showIf: { id: "feeType", equals: "fixed" }, placeholder: "e.g. half when work starts and half when it is finished" }),
        num("payDays", "Invoices paid within (days)", { default: "30", required: true }),
        yesno("expenses", "Company reimburses approved expenses", { default: true }), yesno("confidential", "Consultant keeps information confidential", { default: true })] },
    ],
    body: `CONSULTING AGREEMENT

This Agreement is made on {{effectiveDate}} between {{client}}{{#if clientAddress}}, {{clientAddress}}{{/if}} ("Company") and {{consultant}}{{#if consultantAddress}}, {{consultantAddress}}{{/if}} ("Consultant").

1. SERVICES
Consultant will provide the following consulting services: {{scope}}

2. TERM
Services begin {{startDate}}{{#if hasEnd}} and end {{endDate}}{{else}} and continue until either party gives 30 days' written notice{{/if}}.

3. FEES
Company will pay Consultant {{#if feeType=fixed}}a fixed fee of {{fee}}{{#if feeSchedule}}, invoiced {{feeSchedule}}{{/if}}{{/if}}{{#if feeType=hourly}}{{fee}} per hour{{/if}}{{#if feeType=monthly}}{{fee}} per month{{/if}}, payable within {{payDays}} days of each invoice.{{#if feeType=hourly}} Invoices will show the hours worked.{{/if}}{{#if expenses}} Company reimburses reasonable expenses it approves in advance and that Consultant documents.{{/if}}

4. INDEPENDENT CONSULTANT
Consultant is an independent contractor, controls how the work is done, uses their own tools, may work for others, has no authority to bind Company, receives no employee benefits, and is responsible for their own taxes and insurance. Before the first payment Consultant will give Company a completed Form W-9. Company will report payments on Form 1099-NEC where required.

5. WORK PRODUCT
Consultant assigns to Company all rights in the deliverables created for Company under this Agreement, once Company pays for them, and will sign any further papers needed for this.

6. NO GUARANTEE OF RESULTS
Consultant will give advice and services with professional care but does not guarantee any result. Company makes the final decisions and is responsible for them.

{{#if confidential}}7. CONFIDENTIALITY
Consultant will keep Company's non-public information confidential, use it only for this work, and return or destroy it on request, during and after this Agreement. This does not cover information that is public through no fault of Consultant, was already known to Consultant, or must be disclosed by law. Nothing in this Agreement prevents Consultant from confidentially disclosing a trade secret to a government official or an attorney solely to report or investigate a suspected violation of law.

{{/if}}8. ENDING THE AGREEMENT
Either party may end this Agreement on 30 days' written notice, or sooner if the other materially breaks it and does not fix the problem within 15 days of written notice. When it ends, Company pays for services performed through the end date and, for a fixed fee, a fair share of the fee for the work done. The provisions on work product{{#if confidential}} and confidentiality{{/if}} continue after this Agreement ends.

9. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, and may not be assigned without the other party's written consent. Notices must be in writing. If a term cannot be enforced, the rest stays in force. This Agreement may be signed electronically and is governed by the laws of the State of {{state}}.

COMPANY: {{client}}
Signature: ______________________________   Date: ______________
Printed name: ______________________   Title (if a company): ______________

CONSULTANT: {{consultant}}
Signature: ______________________________   Date: ______________
Printed name: ______________________   Title (if a company): ______________`,
  },
  {
    key: "demand_letter", title: "Payment Demand Letter", category: LENDING,
    description: "A formal request for payment of an overdue amount, with a deadline.",
    reviewNote: "Send this in the creditor's own name, signed by the creditor — not in the firm's name. Debt-collection rules (the federal FDCPA and Maryland's Consumer Debt Collection Act and Collection Agency Licensing Act) can apply to personal or household debts and to anyone collecting for someone else; confirm with an attorney before sending a letter on a client's behalf. Do not threaten anything the creditor does not intend to do. Include only interest and fees the agreement or the law allows, and attach the invoice.",
    steps: [
      { title: "Details", questions: [text("sender", "From (your business)", { prefill: "clientName", required: true }), text("senderTitle", "Signer's title", { placeholder: "e.g. Owner" }), text("senderAddress", "Your address", { prefill: "clientAddress" }), text("senderContact", "Phone or email for replies", { required: true }), text("recipient", "To (who owes the money)", { required: true }), text("recipientAddress", "Their address"), effective(),
        text("deliveryMethod", "Sent by (optional)", { placeholder: "e.g. certified mail and email" }),
        text("reference", "Invoice or agreement it relates to", { required: true, placeholder: "e.g. Invoice 1042 dated August 3, 2026" }), date("dueDate", "Date it was originally due (optional)"), money("amount", "Amount owed", { required: true }), date("deadline", "Pay by", { required: true, help: "Allow at least 10 days from the date of the letter." }), text("howToPay", "How to pay", { placeholder: "e.g. Check payable to the business, or bank transfer" }),
        yesno("consumerDebt", "The debt is for personal, family or household purposes (not business)", { help: "Tick this for a personal or household debt. Debt-collection rules apply more strictly to these debts — send the letter in the creditor's own name, not the firm's, and have an attorney review it." }),
        yesno("interest", "Say that interest or fees may be added"), yesno("legal", "Say that legal action may follow if unpaid", { default: true })] },
    ],
    body: `{{sender}}{{#if senderAddress}}
{{senderAddress}}{{/if}}

{{effectiveDate}}{{#if deliveryMethod}}

Sent by {{deliveryMethod}}{{/if}}

{{recipient}}{{#if recipientAddress}}
{{recipientAddress}}{{/if}}

Re: Demand for payment — {{reference}}

Dear {{recipient}},

Our records show that {{amount}} remains unpaid on {{reference}}{{#if dueDate}}, which was due on {{dueDate}}{{/if}}, and the payment is overdue. Please pay the full amount by {{deadline}}.{{#if howToPay}} Payment may be made as follows: {{howToPay}}.{{/if}}

{{#if interest}}Interest and fees that our agreement or the law allows may be added to the balance if it is not paid by that date; if so, we will show you how they were calculated. {{/if}}{{#if legal}}If we do not receive payment or hear from you by {{deadline}}, we may pursue the remedies available to us, which may include filing a lawsuit for the balance plus any interest, costs and attorney's fees that our agreement or the law allows.{{else}}If you believe this is wrong, or you would like to arrange a payment plan, please contact us before {{deadline}}.{{/if}}{{#if consumerDebt}} If you disagree with any part of this amount, please tell us in writing and send any documents that support your position, and we will review them.{{/if}}

If you have already paid, please send us the payment details so we can correct our records. You can reach us at {{senderContact}}. This letter does not waive any of our rights.

Sincerely,

Signature: ______________________________
{{sender}}
{{#if senderTitle}}{{senderTitle}}{{else}}Title: ______________{{/if}}`,
  },
  {
    key: "lease_termination_agreement", title: "Lease Termination Agreement", category: LENDING,
    description: "Landlord and tenant agree to end a lease early — move-out date, keys, deposit, final payments and release.",
    reviewNote: "For a home, Maryland's security-deposit rules still apply even though the lease ends by agreement: the landlord must send an itemized list of any deductions and return the rest within 45 days, and the tenant cannot give up those rights (Real Property Article 8-203). A business landlord may choose to keep the deposit, but only to the extent the lease allows. If a guarantor signed the lease, the guarantor is released only if the guarantor signs this agreement too. Not checked by the app: that the end date is after the date of signing. Companies must sign through an officer with a title.",
    steps: [
      { title: "Lease", questions: [text("landlord", "Landlord", { required: true }), text("tenant", "Tenant", { prefill: "clientName", required: true }), text("premises", "Space being leased", { required: true }), date("leaseDate", "Date of the original lease", { required: true }),
        pick("leaseKind", "The lease is for", [["residential", "A home (where the tenant lives)"], ["commercial", "A business space"]], { required: true }), text("guarantor", "Guarantor of the lease (if any)", { help: "Leave blank if nobody guaranteed the lease." }), effective(), state()] },
      { title: "Ending it", questions: [date("endDate", "Lease ends on", { required: true }), money("deposit", "Security deposit held", { default: "0" }), pick("depositTreatment", "The deposit will be", [["return", "Returned in full"], ["deduct", "Returned less amounts owed"], ["keep", "Kept by the landlord (business leases only)"]], { default: "return", required: true }),
        money("finalPayment", "Final payment from tenant (0 if none)", { default: "0" }), yesno("restore", "Tenant leaves the space clean and in its original condition", { default: true }), yesno("release", "Each side releases the other from further lease claims", { default: true })] },
    ],
    body: `LEASE TERMINATION AGREEMENT

This Agreement is made on {{effectiveDate}} between {{landlord}} ("Landlord") and {{tenant}} ("Tenant") about the lease dated {{leaseDate}} for {{premises}} (the "Lease"). Both parties agree to it voluntarily.

1. EARLY END OF LEASE
Landlord and Tenant agree that the Lease ends on {{endDate}}, and Tenant will give up the space and return all keys by that date.

2. RENT AND PAYMENTS
Tenant pays all rent and other charges due under the Lease up to {{endDate}}.{{#if finalPayment}} Tenant also pays {{finalPayment}} as a final payment to Landlord on or before {{endDate}}.{{/if}} Tenant states that it has not assigned or sublet the Lease or the space.

3. SECURITY DEPOSIT
{{#if deposit}}Landlord holds a security deposit of {{deposit}}. {{#if leaseKind=residential}}Within 45 days after {{endDate}}, Landlord will mail Tenant, by first-class mail, {{#if depositTreatment=return}}the deposit in full, with any interest due{{else}}an itemized list of any deductions for unpaid rent or damage beyond normal wear, with their actual costs, and the rest of the deposit with any interest due{{/if}}. This Agreement does not give up any of Tenant's rights under Maryland's security-deposit law.{{else}}{{#if depositTreatment=keep}}The deposit will be kept by Landlord.{{else}}Within 30 days after {{endDate}}, the deposit will be {{#if depositTreatment=return}}returned to Tenant in full{{else}}returned to Tenant less any amounts owed and any damage beyond normal wear{{/if}}.{{/if}}{{/if}}{{else}}No security deposit is being held.{{/if}}

4. SURRENDER
Tenant returns all keys on {{endDate}}. If Tenant stays longer, rent under the Lease continues for each extra day and Landlord may recover possession. Belongings left in the space after {{endDate}} are treated as abandoned.{{#if guarantor}} {{guarantor}} (the guarantor) is released from the Lease only by signing this Agreement below.{{/if}}

{{#if restore}}5. CONDITION OF THE SPACE
Tenant leaves the space clean, free of Tenant's belongings, and in the condition required by the Lease, normal wear excepted.

{{/if}}{{#if release}}6. RELEASE
Once Tenant has given up the space and paid what this Agreement requires, each party releases the other from claims under the Lease, except the obligations in this Agreement, Tenant's rights to the security deposit, damage that was not apparent at move-out, charges still to be settled, and claims made by other people.

{{/if}}7. GENERAL
This Agreement is the parties' entire agreement about ending the Lease, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}. Each person who signs for a company states that he or she is authorized to do so.

LANDLORD: {{landlord}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

TENANT: {{tenant}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________
{{#if guarantor}}
GUARANTOR: {{guarantor}}
Signature: ______________________________   Date: ______________
{{/if}}`,
  },
  {
    key: "workplace_incident_report", title: "Workplace Incident Report", category: EMPLOYMENT,
    description: "A record of an accident or incident at work — who, what, when, and what was done afterwards.",
    reviewNote: "Report a death to Maryland OSHA (MOSH) within 8 hours, and an in-patient hospitalization, amputation or loss of an eye within 24 hours. If an employee loses more than 3 days of work from an injury, the employer's report to the Workers' Compensation Commission is due within 10 days (Labor & Employment §9-707). Tell your insurance carrier. Keep medical details out of the general personnel file.",
    steps: [
      { title: "The incident", questions: [text("business", "Business", { prefill: "clientName", required: true }), date("incidentDate", "Date of incident", { required: true }), text("incidentTime", "Time", { placeholder: "e.g. About 3:30 PM" }), text("location", "Where it happened", { required: true }),
        text("person", "Person involved", { required: true }), pick("personType", "That person is", [["employee", "An employee"], ["customer", "A customer"], ["contractor", "A contractor"], ["visitor", "A visitor"]], { default: "employee" }), text("position", "Their position"), area("description", "What happened", { required: true }), text("witnesses", "Witnesses (names)")] },
      { title: "Injury and follow-up", questions: [yesno("injury", "Someone was injured"), area("injuryDetails", "Injury and body part", { showIf: { id: "injury", equals: true }, required: true }), yesno("medical", "Medical treatment was given", { showIf: { id: "injury", equals: true } }), text("treatment", "Treatment and where", { showIf: { id: "medical", equals: true } }),
        yesno("reportedMosh", "Reported to Maryland OSHA (MOSH)", { showIf: { id: "injury", equals: true } }), yesno("reportedCarrier", "Reported to the workers' compensation insurance carrier", { showIf: { id: "injury", equals: true } }),
        area("actions", "What was done afterwards / to prevent it happening again"), text("reportedBy", "Report completed by (name and title)", { required: true }), date("reportDate", "Date completed", { prefill: "today", required: true })] },
    ],
    body: `WORKPLACE INCIDENT REPORT
{{business}}

Date of incident: {{incidentDate}}{{#if incidentTime}}   Time: {{incidentTime}}{{/if}}
Location: {{location}}
Person involved: {{person}}{{#if position}} ({{position}}){{/if}}, {{#if personType=employee}}an employee{{/if}}{{#if personType=customer}}a customer{{/if}}{{#if personType=contractor}}a contractor{{/if}}{{#if personType=visitor}}a visitor{{/if}}
{{#if witnesses}}Witnesses: {{witnesses}}{{/if}}

WHAT HAPPENED
{{description}}

INJURY
{{#if injury}}Injury reported: {{injuryDetails}}
{{#if medical}}Medical treatment: {{treatment}}{{else}}No medical treatment was given at the time.{{/if}}
Reported to Maryland OSHA (MOSH): {{#if reportedMosh}}Yes{{else}}No{{/if}}   Reported to the workers' compensation carrier: {{#if reportedCarrier}}Yes{{else}}No{{/if}}{{else}}No injury was reported at the time of this report.{{/if}}

{{#if actions}}ACTIONS TAKEN
{{actions}}

{{/if}}This report records the facts known on the date it was completed and is not an admission of fault.

Report completed by: {{reportedBy}}   Date: {{reportDate}}
Signature: ______________________________

Person involved: {{person}}
Signing shows the person has read this report, not that they agree with it.
Signature: ______________________________   Date: ______________
If the person declined or was unable to sign: ______________________`,
  },
  {
    key: "affidavit_general", title: "Affidavit", category: LENDING,
    description: "A sworn written statement of facts, signed in front of a notary.",
    reviewNote: "An affidavit only counts once it is signed in front of a notary public. Leave both dates and the notary section blank until then. For a Maryland court filing, ask the attorney which form of statement the court rule requires (Maryland Rule 1-304 lists the accepted forms). Use personal knowledge for facts the signer saw or did; use the other choice only for facts the signer believes from what others told them. The Arabic edition is for the signer's understanding — a court will want an English version signed, and a signer who does not read English may need an interpreter's statement.",
    steps: [
      { title: "Statement", questions: [text("affiant", "Person making the statement", { required: true }), text("address", "Their address", { required: true }), text("docTitle", "Title of the affidavit (optional)", { placeholder: "e.g. Affidavit of Residence" }), text("county", "County or Baltimore City where you will sign before the notary", { required: true }), state({ id: "stateName", label: "State" } as Partial<Question>),
        pick("knowledgeBasis", "The facts are based on", [["personal", "The signer's own personal knowledge"], ["belief", "Knowledge, information and belief"]], { required: true, default: "personal" }),
        list("facts", "Statements of fact", [area("fact", "Statement", { required: true })], { required: true, addLabel: "Add a statement" })] },
    ],
    body: `AFFIDAVIT{{#if docTitle}}
{{docTitle}}{{/if}}

State of {{stateName}}
City/County of {{county}}

I, {{affiant}}, of {{address}}, being sworn, state that I am over 18 years of age and competent to make this affidavit, and that:

{{#list facts}}{{n}}. {{fact}}

{{/list}}{{#if knowledgeBasis=personal}}I solemnly swear or affirm under the penalties of perjury, upon personal knowledge, that the statements above are true.{{else}}I solemnly swear or affirm under the penalties of perjury that the statements above are true to the best of my knowledge, information and belief.{{/if}}

{{affiant}}
Signature: ______________________________   Date: ______________

Subscribed and sworn to before me on ______________, 20____, by {{affiant}}, who is personally known to me or satisfactorily proved to be the person who signed.

Notary Public: ______________________________
Printed name: ______________________________
County or city of appointment: ______________________________
My commission expires: ______________
(Seal)`,
  },
  /* ─────────────── Family & personal ─────────────── */
  {
    key: "child_travel_consent", title: "Minor Travel Consent", category: FAMILY,
    description: "A parent or guardian gives permission for a child to travel with another adult, with one parent, or alone — for airlines, border officers and hotels.",
    reviewNote: "Sign in front of a notary (the notary may attach their own certificate in place of the one printed here). Airlines, border officers and destination countries have their own rules — some want a specific form, an apostille or a translation — so check the destination's embassy or consulate before the trip, and carry the original with the child's passport, a copy of each signer's ID, and the child's birth certificate. Border officers generally ask for a note from the parent who is not travelling, and from both parents if the child travels with neither; if there is a court order or a custody dispute, bring the order. Confirm with an attorney whether a non-parent adult can legally approve medical treatment abroad. Not checked by the app: each child's passport number, if the trip is international.",
    steps: [
      { title: "Parent or guardian", questions: [text("parent", "Parent or legal guardian who is signing", { required: true }), text("parentAddress", "Address", { required: true }), text("parentPhone", "Phone", { required: true }), text("parentEmail", "Email"),
        yesno("secondParent", "A second parent or guardian also signs this consent"), text("parent2", "Second parent or guardian", { showIf: { id: "secondParent", equals: true }, required: true }), text("parent2Phone", "Second parent or guardian's phone", { showIf: { id: "secondParent", equals: true }, required: true }),
        pick("noSecondReason", "About the child's other parent", [["travelling", "The other parent is the one travelling with the child"], ["sole", "I have sole legal custody"], ["deceased", "The other parent is deceased"], ["none", "The child has no other legal parent"], ["informed", "The other parent knows about the trip but is not signing"]], { showIf: { id: "secondParent", equals: false }, required: true }),
        effective()] },
      { title: "The child", questions: [list("children", "Child or children travelling", [text("name", "Full name (as on the passport)", { required: true }), date("dob", "Date of birth", { required: true }), text("passport", "Passport number (needed for international trips)"), text("nationality", "Passport country")], { required: true, addLabel: "Add a child" })] },
      { title: "The trip", questions: [
        pick("travellingWith", "The child is travelling", [["adult", "With another adult"], ["alone", "Alone (for example an unaccompanied-minor flight)"], ["parent", "With one parent only (the parent signing here is not travelling)"]], { required: true, default: "adult" }),
        text("adult", "Travelling adult's name", { showIf: { id: "travellingWith", equals: "adult" }, required: true }), text("adultRelation", "Relationship to the child", { showIf: { id: "travellingWith", equals: "adult" }, required: true }), text("adultAddress", "Travelling adult's address", { showIf: { id: "travellingWith", equals: "adult" }, required: true }), text("adultPhone", "Travelling adult's phone", { showIf: { id: "travellingWith", equals: "adult" }, required: true }), text("adultPassport", "Travelling adult's passport number", { showIf: { id: "travellingWith", equals: "adult" } }),
        text("travellingParent", "Name of the parent who is travelling with the child", { showIf: { id: "travellingWith", equals: "parent" }, required: true }), text("travellingParentPhone", "That parent's phone", { showIf: { id: "travellingWith", equals: "parent" } }),
        text("meetingPerson", "Person meeting the child on arrival", { showIf: { id: "travellingWith", equals: "alone" }, required: true }), text("meetingPhone", "Their phone", { showIf: { id: "travellingWith", equals: "alone" } }),
        text("destination", "Destination (city and country)", { required: true }), date("departure", "Leaving on", { required: true }), date("returning", "Returning on", { required: true }), text("purpose", "Purpose", { placeholder: "e.g. Family visit, vacation, school trip" }), text("staying", "Where the child will stay", { placeholder: "Address or hotel" }), text("flight", "Flight or travel details (optional)", { placeholder: "Airline, flight numbers" }),
        yesno("medical", "The adult in charge may approve emergency medical treatment", { default: true }), text("allergies", "Allergies or medicines (optional)"), text("insurance", "Health insurance details (optional)"),
      ] },
    ],
    body: `MINOR TRAVEL CONSENT

Prepared on {{effectiveDate}}

{{#if secondParent}}We, {{parent}} and {{parent2}}, of {{parentAddress}}, are each a parent or legal guardian{{else}}I, {{parent}}, of {{parentAddress}}, am a parent or legal guardian{{/if}} of the child or children named below. {{#if secondParent}}We have{{else}}I have{{/if}} the legal authority to give this consent, and no court order or agreement limits this travel. {{#if secondParent}}We give{{else}}I give{{/if}} permission for the child to travel as described.

{{#if !secondParent}}{{#if noSecondReason=sole}}OTHER PARENT
I have sole legal custody of the child, and no one else's consent is needed for this trip.

{{/if}}{{#if noSecondReason=deceased}}OTHER PARENT
The child's other parent is deceased.

{{/if}}{{#if noSecondReason=none}}OTHER PARENT
The child has no other legal parent.

{{/if}}{{#if noSecondReason=informed}}OTHER PARENT
The child's other parent knows about this trip.

{{/if}}{{/if}}CHILD
{{#list children}}{{n}}. {{name}} — born {{dob}}{{#if passport}} — passport {{passport}}{{#if nationality}} ({{nationality}}){{/if}}{{/if}}
{{/list}}
TRIP
Destination: {{destination}}
Leaving: {{departure}}    Returning: {{returning}}
{{#if purpose}}Purpose: {{purpose}}
{{/if}}{{#if staying}}Staying at: {{staying}}
{{/if}}{{#if flight}}Travel details: {{flight}}
{{/if}}{{#if travellingWith=adult}}Travelling with: {{adult}} ({{adultRelation}}), of {{adultAddress}}, phone {{adultPhone}}{{#if adultPassport}}, passport {{adultPassport}}{{/if}}{{/if}}{{#if travellingWith=alone}}The child is travelling alone and will be met on arrival by {{meetingPerson}}{{#if meetingPhone}}, phone {{meetingPhone}}{{/if}}.{{/if}}{{#if travellingWith=parent}}The child is travelling with {{travellingParent}}, the child's parent{{#if travellingParentPhone}}, phone {{travellingParentPhone}}{{/if}}. The person or people signing this consent are not travelling with the child and consent to this trip.{{/if}}

{{#if medical}}MEDICAL CARE
If the child needs emergency medical treatment, {{#if secondParent}}we authorize{{else}}I authorize{{/if}} {{#if travellingWith=adult}}{{adult}}{{/if}}{{#if travellingWith=parent}}{{travellingParent}}{{/if}}{{#if travellingWith=alone}}the adult in charge of the child{{/if}} to consent to it on {{#if secondParent}}our{{else}}my{{/if}} behalf. Any doctor or hospital may rely on this authorization.{{#if allergies}} Allergies or medicines: {{allergies}}.{{/if}}{{#if insurance}} Health insurance: {{insurance}}.{{/if}}

{{/if}}CONTACT AND VALIDITY
{{parent}} can be reached at {{parentPhone}}{{#if parentEmail}} or {{parentEmail}}{{/if}}{{#if secondParent}}; {{parent2}} can be reached at {{parent2Phone}}{{/if}}. The child and the person travelling with or meeting the child may show this document to airlines, border and immigration officers, hotels and medical staff. This consent is valid only from {{departure}} to {{returning}}, and any person who signed it may cancel it by written notice.

{{parent}}
Signature: ______________________________   Date: ______________
{{#if secondParent}}
{{parent2}}
Signature: ______________________________   Date: ______________
{{/if}}
NOTARY ACKNOWLEDGMENT
State of ______________________   County of ______________________
On ______________, before me, a Notary Public, personally appeared the person or people who signed this consent, who proved their identity to me with satisfactory identification and signed it in my presence.
Notary Public (printed name): ______________________________
Signature: ______________________________   Commission expires: ______________`,
  },
  /* ─────────────── Real estate ─────────────── */
  {
    key: "property_sale_residential", title: "Residential Property Sale Agreement", category: REAL_ESTATE,
    description: "A seller and buyer agree on the sale of a home, condo or other residential property: price, deposit, financing, inspection, Maryland notices and closing.",
    reviewNote: "Have a real-estate attorney or title company review this before signing. Before the buyer signs, the seller must give the buyer the Maryland Residential Property Disclosure or Disclaimer Statement (if the buyer gets it late, the buyer can rescind), and homes built before 1978 need the signed federal lead-paint disclosure and EPA pamphlet attached. Attach the separate Critical Area notice sheet and the buyer's signed disclosure receipt. The Maryland Notices section (transfer/recordation tax sharing, Critical Area, homestead credit) and the withholding wording are in plain words: check them against the current statute (Real Property Article 14-117, 10-702, Tax-General 10-912) and the current MREC / local board addenda, which may require exact wording and extra local or new-law notices (for example the flood-risk statement starting July 2027). Confirm with an attorney: seller-financing rules, whether the 'exempt' choice really applies, and whether this buyer's lender or county adds its own notices. Not yet checked by the app: the loan amount against the price, and that the closing date is after the loan-approval period.",
    steps: [
      { title: "Seller and buyer", questions: [text("seller", "Seller(s) — full legal name(s)", { required: true }), text("sellerAddress", "Seller's address (for notices)", { required: true }), text("buyer", "Buyer(s) — full legal name(s)", { required: true }), text("buyerAddress", "Buyer's address (for notices)", { required: true }), effective(), state()] },
      { title: "The property", questions: [text("propertyAddress", "Property address", { required: true }), text("county", "County", { required: true }), text("parcelId", "Tax account / parcel number"), text("idNumbers", "Ward / section / block / lot (Baltimore City) or other property ID"), area("legalDescription", "Legal description (from the deed)"),
        area("included", "Items that stay with the property", { default: "All fixtures and attached items, including built-in appliances, heating and cooling equipment, plumbing and lighting fixtures, window coverings and fencing." }), area("excluded", "Items the seller keeps")] },
      { title: "Price and payment", questions: [money("price", "Purchase price", { required: true }), money("deposit", "Earnest-money deposit", { required: true }), text("depositHolder", "Deposit held by", { required: true, placeholder: "Title company or escrow agent" }),
        pick("financing", "How will the buyer pay?", [["cash", "Cash — no financing"], ["mortgage", "A mortgage loan"], ["seller", "Financing from the seller"]], { required: true, default: "mortgage" }),
        money("loanAmount", "Loan amount", { showIf: { id: "financing", equals: "mortgage" }, required: true }), num("loanDays", "Days for the buyer to get loan approval", { showIf: { id: "financing", equals: "mortgage" }, default: "30", required: true }),
        text("sellerFinanceTerms", "Seller-financing terms", { showIf: { id: "financing", equals: "seller" }, required: true, placeholder: "Amount, interest rate, term, payment schedule" })] },
      { title: "Inspection and closing", questions: [num("inspectionDays", "Days for the buyer to inspect (0 for none)", { default: "10", required: true }), yesno("appraisalContingency", "The sale depends on the property appraising at or above the price"), yesno("saleContingency", "The sale depends on the buyer selling another home"),
        pick("closingMode", "Closing happens", [["date", "On a set date"], ["days", "Within a number of days after the buyer's conditions are met"]], { required: true, default: "date" }), date("closingDate", "Closing date", { showIf: { id: "closingMode", equals: "date" }, required: true }), num("closingDays", "Days after the conditions are met", { showIf: { id: "closingMode", equals: "days" }, default: "30", required: true }),
        pick("deedType", "Deed", [["special", "Special warranty deed"], ["general", "General warranty deed"]], { required: true, default: "special" }),
        pick("transferTaxes", "Transfer and recordation taxes are paid", [["split", "Split equally"], ["buyer", "By the buyer"], ["seller", "By the seller"]], { required: true, default: "split" }),
        yesno("brokerUsed", "A real-estate agent or broker was used"), text("brokerName", "Agent / brokerage", { showIf: { id: "brokerUsed", equals: true } }), pick("commissionPaidBy", "Commission is paid by", [["seller", "The seller"], ["buyer", "The buyer"], ["split", "Split between them"]], { showIf: { id: "brokerUsed", equals: true }, default: "seller" }),
        yesno("hoa", "The property is in a homeowners', condominium or similar association"),
        pick("possession", "Buyer takes possession", [["closing", "At closing"], ["date", "On a set date"]], { required: true, default: "closing" }), date("possessionDate", "Possession date", { showIf: { id: "possession", equals: "date" }, required: true }), text("titleCompany", "Title company or settlement agent"),
        pick("disclosureType", "Seller's Maryland disclosure", [["disclosure", "Residential Property Disclosure Statement"], ["disclaimer", "Residential Property Disclaimer Statement"], ["exempt", "Not required — an exempt sale (for example new, estate or foreclosure)"]], { required: true, default: "disclosure" }),
        text("exemptReason", "Why no disclosure statement is required", { showIf: { id: "disclosureType", equals: "exempt" }, required: true, placeholder: "e.g. it is a sale by the personal representative of an estate", help: "Maryland exempts only certain sales (for example a home never lived in, a lender's sale after foreclosure, court or fiduciary sales). Ask the title company or an attorney before choosing this." }),
        pick("closingCosts", "Closing costs are paid", [["split", "Split equally"], ["buyer", "By the buyer"], ["seller", "By the seller"]], { default: "split", required: true }),
        pick("preYear78", "Was the home built before 1978?", [["yes", "Yes — built before 1978"], ["no", "No — built in 1978 or later"]], { required: true, help: "If you do not know, check the tax records or ask the seller. Pre-1978 homes need the federal lead-paint papers." }),
        yesno("asIs", "The buyer accepts the property as-is after inspection", { default: false })] },
    ],
    body: `RESIDENTIAL PROPERTY SALE AGREEMENT

This Agreement is made on {{effectiveDate}} between {{seller}} of {{sellerAddress}} ("Seller") and {{buyer}} of {{buyerAddress}} ("Buyer").

1. THE PROPERTY
Seller agrees to sell and Buyer agrees to buy the residential property at {{propertyAddress}}, {{county}} County{{#if parcelId}}, tax account {{parcelId}}{{/if}}{{#if idNumbers}}, {{idNumbers}}{{/if}} (the "Property"){{#if legalDescription}}, described as:
{{legalDescription}}{{/if}}.
Included: {{included}}
{{#if excluded}}Excluded: {{excluded}}
{{/if}}
2. PRICE AND DEPOSIT
The purchase price is {{price}}. Buyer pays an earnest-money deposit of {{deposit}} to {{depositHolder}} within 2 business days after both parties sign this Agreement. The holder keeps the deposit in escrow and releases it only as this Agreement provides, on the written agreement of both parties, or by court order; if the parties disagree about who is entitled to it, the holder may keep it until the disagreement is resolved or pay it into court. The deposit is credited to the price at closing. The balance is paid at closing in certified funds or by wire transfer.

3. FINANCING
{{#if financing=cash}}Buyer is paying cash. This Agreement does not depend on any loan, and Buyer will show proof of funds within 5 days after signing.{{/if}}{{#if financing=mortgage}}Buyer will apply for a mortgage loan of {{loanAmount}} within 5 days after signing, will pursue it in good faith, and will give Seller a copy of the lender's decision. If Buyer cannot obtain loan approval within {{loanDays}} days after signing, despite good-faith effort, Buyer may cancel by written notice given no later than the last day of that period, and the deposit is returned. If Buyer does not give that notice in time, this financing condition is waived.{{/if}}{{#if financing=seller}}Seller will finance part of the price on these terms: {{sellerFinanceTerms}}
The terms will be put in a promissory note and a mortgage or deed of trust signed at closing.{{/if}}

4. INSPECTION AND CONDITION
{{#if inspectionDays}}Buyer may have the Property inspected within {{inspectionDays}} days after signing. If the inspection shows a problem Buyer is not willing to accept, Buyer may cancel by written notice given within that period and the deposit is returned, or the parties may agree in writing on repairs or a price change. If Buyer does not cancel in time, Buyer accepts the Property's condition.{{else}}Buyer has chosen not to inspect before closing.{{/if}}{{#if asIs}} The Property is sold as-is, without warranty as to its condition, except as stated in this Agreement and as the law requires.{{/if}}

{{#if appraisalContingency}}5. APPRAISAL
This Agreement depends on the Property appraising at or above the purchase price. If it appraises lower, the parties may agree in writing on a lower price; otherwise Buyer may cancel by written notice given within 5 days after Buyer receives the appraisal, and in any case before closing, and the deposit is returned. If Buyer does not give that notice in time, this condition is waived.

{{/if}}{{#if saleContingency}}6. BUYER'S OTHER HOME
This Agreement depends on Buyer selling another property and closing on that sale before closing under this Agreement. If that sale has not closed by the time set for closing here, Buyer may cancel by written notice given within 3 days after that time, and the deposit is returned; otherwise this condition is waived.

{{/if}}7. TITLE
At closing Seller delivers {{#if deedType=general}}a general warranty deed{{else}}a special warranty deed{{/if}} conveying good and merchantable title (title that a title insurer will insure at regular rates), free of liens and claims other than those Buyer agrees to accept. {{#if titleCompany}}{{titleCompany}} will act as settlement agent and provide the title search. {{/if}}If a title problem cannot be fixed before closing, Buyer may cancel and the deposit is returned.

8. CLOSING, POSSESSION AND COSTS
Closing takes place {{#if closingMode=date}}on {{closingDate}}{{else}}within {{closingDays}} days after the conditions in this Agreement that protect Buyer have been met or waived{{/if}}. Buyer takes possession {{#if possession=closing}}at closing{{else}}on {{possessionDate}}{{/if}}. Seller delivers the Property vacant and free of tenants and other occupants, broom-clean, in the same condition as when this Agreement was signed (normal wear excepted), with the heating, cooling, plumbing and electrical systems in working order. Buyer may walk through the Property within 48 hours before closing.{{#if possession=date}} Until Buyer takes possession, Seller stays responsible for the Property's upkeep, utilities and insurance.{{/if}} Transfer and recordation taxes are paid {{#if transferTaxes=split}}equally by Buyer and Seller{{/if}}{{#if transferTaxes=buyer}}by Buyer{{/if}}{{#if transferTaxes=seller}}by Seller{{/if}}. All other closing costs, including recording fees, title search and insurance, survey and loan charges, are paid {{#if closingCosts=split}}equally by Buyer and Seller{{/if}}{{#if closingCosts=buyer}}by Buyer{{/if}}{{#if closingCosts=seller}}by Seller{{/if}}. Property taxes, water and sewer charges and any association fees are adjusted as of the closing date.

9. DISCLOSURES
Seller will give Buyer the disclosures the law requires for this sale. {{#if disclosureType=disclosure}}Buyer acknowledges receiving the Maryland Residential Property Disclosure Statement, completed to the best of Seller's knowledge, before signing this Agreement (Buyer's initials: ________  date: ______________).{{/if}}{{#if disclosureType=disclaimer}}Buyer acknowledges receiving the Maryland Residential Property Disclaimer Statement before signing this Agreement (Buyer's initials: ________  date: ______________). In it Seller discloses any latent defects Seller actually knows about that a careful visual inspection would not reveal and that threaten the health or safety of the people living there, makes no other statement about the Property's condition, and Buyer takes the Property as-is, with all defects including latent defects, except as this Agreement provides.{{/if}}{{#if disclosureType=exempt}}The parties state that no Maryland disclosure or disclaimer statement is required for this sale because {{exemptReason}}.{{/if}}{{#if preYear78=yes}} Because the home was built before 1978, Seller has given or will give Buyer, before Buyer is bound by this Agreement, the EPA pamphlet "Protect Your Family From Lead in Your Home" and a signed Lead-Based Paint Disclosure (the federal Lead Warning Statement, Seller's disclosure of any known lead-based paint or hazards, and a list of any lead records), which is attached and part of this Agreement. Buyer has 10 days after signing, unless the parties agree otherwise in writing or Buyer waives it, to test the Property for lead-based paint and lead-based paint hazards, and may cancel by written notice and receive the deposit back if the test shows hazards Buyer is not willing to accept.{{/if}}

10. MARYLAND NOTICES
(a) TRANSFER AND RECORDATION TAXES ARE PAID AS STATED IN THE CLOSING, POSSESSION AND COSTS SECTION OF THIS AGREEMENT. UNLESS THE PARTIES AGREE OTHERWISE, MARYLAND LAW PROVIDES THAT THEY ARE SHARED EQUALLY BETWEEN BUYER AND SELLER.
(b) THE PROPERTY MAY BE LOCATED IN THE CHESAPEAKE AND ATLANTIC COASTAL BAYS CRITICAL AREA, GENERALLY THE LAND WITHIN 1,000 FEET OF TIDAL WATERS OR TIDAL WETLANDS, WHERE SPECIAL LAND-USE RULES MAY APPLY. A SEPARATE NOTICE SHEET IS ATTACHED.
(c) IF BUYER WILL LIVE IN THE PROPERTY AS BUYER'S PRINCIPAL RESIDENCE, BUYER MAY QUALIFY FOR THE MARYLAND HOMESTEAD PROPERTY TAX CREDIT. INFORMATION IS AVAILABLE FROM THE STATE DEPARTMENT OF ASSESSMENTS AND TAXATION.
(d) Buyer should ask the county planning and zoning office about current and planned land uses, public facilities and school plans that may affect the Property.
Buyer's initials: ________

11. RISK OF LOSS
Seller bears the risk of loss or damage to the Property until closing. If the Property is substantially damaged before closing, Buyer may cancel and the deposit is returned. Until closing Seller will keep the Property in its present condition and will not lease it, sell it again or place any new lien on it without Buyer's written consent.

12. DEFAULT
If either party fails to do what this Agreement requires, the other party will give written notice, and the party in default has 5 days after the notice to fix it before the other party may use a remedy. If Buyer defaults and does not fix it, Seller may keep the deposit as Seller's sole remedy unless the law allows more. If Seller defaults and does not fix it, Buyer may recover the deposit and pursue the remedies the law allows, including asking a court to require the sale.

{{#if brokerUsed}}0. BROKERS AND COMMISSION
{{#if brokerName}}{{brokerName}} acted as agent in this sale. {{/if}}The real-estate commission is paid by {{#if commissionPaidBy=seller}}Seller{{/if}}{{#if commissionPaidBy=buyer}}Buyer{{/if}}{{#if commissionPaidBy=split}}Buyer and Seller equally{{/if}} at closing. Each party will protect the other from any other broker's claim based on that party's own dealings.{{else}}0. BROKERS AND COMMISSION
Each party states that it has not used a real-estate broker or agent in this transaction, and each will protect the other from any commission claim based on that party's own dealings. This promise continues after closing.{{/if}}

{{#if hoa}}0. ASSOCIATION
The Property is in an association. Seller will give Buyer the association's governing documents, current fees and any resale information the law requires, and Buyer may cancel within the period the law allows after receiving them. Association fees and assessments are adjusted as of the closing date.

{{/if}}0. TAX WITHHOLDING AND REPORTING
If Seller is not a Maryland resident, or is a foreign person for federal tax purposes, the settlement agent may withhold from Seller's proceeds the amounts Maryland and federal law require, and Seller will sign the certifications and forms needed. Buyer and Seller will also give the settlement agent the information needed to file the report the Internal Revenue Code requires for real-estate sales (Form 1099-S). These promises continue after closing.

13. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}. Notices must be in writing and sent to the addresses above. Time is of the essence. Buyer may not assign this Agreement without Seller's written consent. If any part of this Agreement is not enforceable, the rest remains in effect. This Agreement binds the parties and their heirs, representatives and permitted assigns, and may be signed in counterparts, including electronically, which together form one agreement.

SELLER: {{seller}}
Signature: ______________________________   Date: ______________

BUYER: {{buyer}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "property_sale_commercial", title: "Commercial Property Sale Agreement", category: REAL_ESTATE,
    description: "A seller and buyer agree on the sale of a commercial building or land: price, due-diligence period, tenants, zoning, environmental, closing deliveries and closing.",
    reviewNote: "Commercial sales carry large tax, zoning, environmental and lease consequences — have a real-estate attorney review this, and a title company handle the closing. This agreement sells real property and the personal property you list; it does not sell a business or transfer licenses (tobacco, alcohol, sales-tax) — a store sale usually needs a separate business sale agreement and the buyer's own licenses; confirm any bulk-sale or tax-clearance steps with an attorney. If part of the property is a home or apartment, Maryland's residential disclosure statement and contract notices may also apply (Real Property Article 10-702 and 14-117): check the current statute and MREC addenda. Withholding wording is in plain words: check it against Tax-General 10-912 and federal FIRPTA rules. Confirm with an attorney: whether the environmental assessment you order meets the standard needed for any federal liability protection, and the seller-statement survival period you chose. The buyer's and seller's company officers must sign with their titles; collect authority documents for the title company.",
    steps: [
      { title: "Seller and buyer", questions: [text("seller", "Seller — full legal name", { required: true }), text("sellerAddress", "Seller's address (for notices)", { required: true }), text("buyer", "Buyer — full legal name", { required: true }), text("buyerAddress", "Buyer's address (for notices)", { required: true }), effective(), state()] },
      { title: "The property", questions: [text("propertyAddress", "Property address", { required: true }), text("county", "County", { required: true }), text("parcelId", "Tax account / parcel number"), text("idNumbers", "Ward / section / block / lot (Baltimore City) or other property ID"), area("legalDescription", "Legal description (from the deed)"),
        text("use", "Current use", { required: true, placeholder: "e.g. Retail store with upstairs apartment" }), text("zoning", "Zoning (if known)"), text("intendedUse", "The use the buyer plans (optional)", { placeholder: "e.g. Convenience store and deli", help: "If filled in, the buyer may cancel during due diligence if zoning or permits will not allow it." }),
        yesno("dwellings", "Part of the property is a home or apartment"),
        area("included", "Included with the sale", { default: "The land, the building and improvements, and fixtures attached to them." }), area("personalProperty", "Equipment, inventory or other personal property included"), area("excluded", "Items the seller keeps")] },
      { title: "Tenants", questions: [yesno("tenants", "Part of the property is leased to tenants"), area("tenantList", "Tenants, rents and lease end dates", { showIf: { id: "tenants", equals: true }, required: true, placeholder: "e.g. Unit A — Corner Deli LLC, $3,200/month, ends June 30, 2028" }), yesno("assumeLeases", "The buyer takes over the existing leases and deposits", { showIf: { id: "tenants", equals: true }, default: true })] },
      { title: "Price and due diligence", questions: [money("price", "Purchase price", { required: true }), money("deposit", "Earnest-money deposit", { required: true }), text("depositHolder", "Deposit held by", { required: true, placeholder: "Title company or escrow agent" }),
        pick("financing", "How will the buyer pay?", [["cash", "Cash — no financing"], ["mortgage", "A commercial loan"], ["seller", "Financing from the seller"]], { required: true, default: "mortgage" }),
        money("loanAmount", "Loan amount", { showIf: { id: "financing", equals: "mortgage" }, required: true }), num("loanDays", "Days to get loan approval", { showIf: { id: "financing", equals: "mortgage" }, default: "45", required: true }), text("sellerFinanceTerms", "Seller-financing terms", { showIf: { id: "financing", equals: "seller" }, required: true }),
        num("dueDiligenceDays", "Due-diligence period (days)", { default: "30", required: true }), yesno("environmental", "Buyer may order an environmental assessment", { default: true }), yesno("exchange1031", "Seller or buyer may complete the sale as part of a 1031 exchange"),
        num("survivalMonths", "Months the seller's statements stay in force after closing (0 for none)", { default: "12", required: true }),
        pick("closingMode", "Closing happens", [["date", "On a set date"], ["days", "Within a number of days after the buyer's conditions are met"]], { required: true, default: "date" }), date("closingDate", "Closing date", { showIf: { id: "closingMode", equals: "date" }, required: true }), num("closingDays", "Days after the conditions are met", { showIf: { id: "closingMode", equals: "days" }, default: "30", required: true }),
        pick("deedType", "Deed", [["special", "Special warranty deed"], ["general", "General warranty deed"]], { required: true, default: "special" }),
        pick("transferTaxes", "Transfer and recordation taxes are paid", [["split", "Split equally"], ["buyer", "By the buyer"], ["seller", "By the seller"]], { required: true, default: "split" }),
        yesno("brokerUsed", "A real-estate agent or broker was used"), text("brokerName", "Agent / brokerage", { showIf: { id: "brokerUsed", equals: true } }), pick("commissionPaidBy", "Commission is paid by", [["seller", "The seller"], ["buyer", "The buyer"], ["split", "Split between them"]], { showIf: { id: "brokerUsed", equals: true }, default: "seller" }),
        yesno("hoa", "The property is in a homeowners', condominium or similar association"),
        text("titleCompany", "Title company or settlement agent"), pick("closingCosts", "Closing costs are paid", [["split", "Split equally"], ["buyer", "By the buyer"], ["seller", "By the seller"]], { default: "split", required: true })] },
    ],
    body: `COMMERCIAL PROPERTY SALE AGREEMENT

This Agreement is made on {{effectiveDate}} between {{seller}} of {{sellerAddress}} ("Seller") and {{buyer}} of {{buyerAddress}} ("Buyer").

1. THE PROPERTY
Seller agrees to sell and Buyer agrees to buy the commercial property at {{propertyAddress}}, {{county}} County{{#if parcelId}}, tax account {{parcelId}}{{/if}}{{#if idNumbers}}, {{idNumbers}}{{/if}} (the "Property"){{#if legalDescription}}, described as:
{{legalDescription}}{{/if}}.
Current use: {{use}}.{{#if zoning}} Zoning: {{zoning}}.{{/if}}
Included: {{included}}
{{#if personalProperty}}Personal property included: {{personalProperty}}
The personal property is sold by bill of sale, free of liens, at no added price.
{{/if}}{{#if excluded}}Excluded: {{excluded}}
{{/if}}This Agreement covers the real property and the personal property listed only. It does not transfer any business, license or permit (including tobacco, alcohol and sales-tax licenses); Buyer obtains those in Buyer's own name.

2. PRICE AND DEPOSIT
The purchase price is {{price}}. Buyer pays an earnest-money deposit of {{deposit}} to {{depositHolder}} within 2 business days after both parties sign this Agreement. The holder keeps the deposit in escrow and releases it only as this Agreement provides, on the written agreement of both parties, or by court order; if the parties disagree about who is entitled to it, the holder may keep it until the disagreement is resolved or pay it into court. The deposit is credited to the price at closing. The balance is paid at closing in certified funds or by wire transfer.

3. FINANCING
{{#if financing=cash}}Buyer is paying cash. This Agreement does not depend on financing, and Buyer will show proof of funds within 5 days after signing.{{/if}}{{#if financing=mortgage}}Buyer will apply for a commercial loan of {{loanAmount}} within 5 days after signing, will pursue it in good faith, and will give Seller a copy of the lender's decision. If Buyer cannot obtain loan approval within {{loanDays}} days after signing despite good-faith effort, Buyer may cancel by written notice given no later than the last day of that period, and the deposit is returned. If Buyer does not give that notice in time, this financing condition is waived.{{/if}}{{#if financing=seller}}Seller will finance part of the price on these terms: {{sellerFinanceTerms}}
The terms will be put in a promissory note and a mortgage or deed of trust signed at closing.{{/if}}

4. DUE DILIGENCE
The due-diligence period is {{dueDiligenceDays}} days. It starts on the later of the day both parties sign and the day Seller has delivered the leases, rent roll, income and expense statements, permits, surveys, environmental reports and service contracts in Seller's possession. During that period Buyer may inspect the Property and its records, including those papers and the title commitment, and Seller will give Buyer reasonable access and answer reasonable requests. {{#if environmental}}Buyer may order an environmental assessment at Buyer's cost. {{/if}}{{#if intendedUse}}Buyer plans to use the Property for {{intendedUse}}. Buyer may also cancel during this period if zoning or required permits will not allow that use. {{/if}}If Buyer is not satisfied for any reason, Buyer may cancel by written notice before the period ends and the deposit is returned. If Buyer does not cancel in time, Buyer accepts the Property's condition (the Property is sold as-is except as this Agreement states) and the deposit is at risk under the Default section.

{{#if tenants}}5. TENANTS AND LEASES
The Property is leased to the following tenants: {{tenantList}} Seller states that the leases are in effect, the rents shown are correct, and no tenant is more than 30 days late except as disclosed in writing. {{#if assumeLeases}}At closing Buyer takes over the leases. Seller hands over every tenant's security deposit and prepaid rent with a written accounting (or credits Buyer for them), and until that is done Seller stays responsible to the tenants for their deposits. Rents and expenses are adjusted as of the closing date. Before closing Seller will ask each tenant to sign a statement confirming its lease, rent and deposit, and will give Buyer the signed statements.{{else}}Seller will give each tenant the notices the leases and the law require.{{/if}}

{{/if}}{{#if dwellings}}6. HOMES ON THE PROPERTY
Because part of the Property is a home or apartment, Seller will give Buyer, to the extent the law requires, the Maryland Residential Property Disclosure or Disclaimer Statement and the other notices Maryland law requires in residential sales, and, if any dwelling was built before 1978, the federal lead-based paint disclosure and the opportunity to test for lead-based paint.

{{/if}}7. TITLE AND SURVEY
At closing Seller delivers {{#if deedType=general}}a general warranty deed{{else}}a special warranty deed{{/if}} conveying good and merchantable title (title that a title insurer will insure at regular rates), free of liens and claims other than those Buyer agrees to accept. {{#if titleCompany}}{{titleCompany}} will act as settlement agent and provide the title search. {{/if}}If a title problem cannot be fixed before closing, Buyer may cancel and the deposit is returned.

8. SELLER'S STATEMENTS
Seller states that, to Seller's knowledge, there are no pending lawsuits, condemnation proceedings or unpaid assessments affecting the Property, no violation notices have been received in writing that have not been fixed, and Seller has disclosed all known environmental problems. "To Seller's knowledge" means the actual knowledge of Seller (for a company, of its owner or manager). These statements are true when this Agreement is signed and at closing. {{#if survivalMonths}}They remain in force for {{survivalMonths}} months after closing.{{else}}They do not remain in force after closing.{{/if}} Until closing Seller will operate the Property as it has been operated, and will not sign or change any lease, place any new lien on the Property or make any new contract binding the Property without Buyer's written consent.

9. CLOSING, DELIVERIES AND COSTS
Closing takes place {{#if closingMode=date}}on {{closingDate}}{{else}}within {{closingDays}} days after due diligence and the other conditions in this Agreement that protect Buyer have been met or waived{{/if}}, and Buyer takes possession then, free of occupants other than the tenants listed. At closing Seller delivers the deed, a bill of sale for any personal property, {{#if tenants}}an assignment of the leases, {{/if}}proof of Seller's authority to sell, and the certifications needed for tax withholding; Buyer delivers the balance of the price and proof of Buyer's authority to buy. Transfer and recordation taxes are paid {{#if transferTaxes=split}}equally by Buyer and Seller{{/if}}{{#if transferTaxes=buyer}}by Buyer{{/if}}{{#if transferTaxes=seller}}by Seller{{/if}}. All other closing costs, including recording fees, title search and insurance, survey and loan charges, are paid {{#if closingCosts=split}}equally by Buyer and Seller{{/if}}{{#if closingCosts=buyer}}by Buyer{{/if}}{{#if closingCosts=seller}}by Seller{{/if}}. Property taxes, utilities, rents and operating expenses are adjusted as of the closing date.{{#if exchange1031}} Each party will reasonably cooperate if the other wishes to complete the sale as part of a tax-deferred exchange, at no added cost or delay to the cooperating party.{{/if}}

10. RISK OF LOSS
Seller bears the risk of loss or damage to the Property until closing. If the Property is substantially damaged or taken before closing, Buyer may cancel and the deposit is returned.

11. DEFAULT
If either party fails to do what this Agreement requires, the other party will give written notice, and the party in default has 5 days after the notice to fix it before the other party may use a remedy. If Buyer defaults and does not fix it, Seller may keep the deposit as Seller's sole remedy unless the law allows more. If Seller defaults and does not fix it, Buyer may recover the deposit and pursue the remedies the law allows, including asking a court to require the sale.

{{#if brokerUsed}}0. BROKERS AND COMMISSION
{{#if brokerName}}{{brokerName}} acted as agent in this sale. {{/if}}The real-estate commission is paid by {{#if commissionPaidBy=seller}}Seller{{/if}}{{#if commissionPaidBy=buyer}}Buyer{{/if}}{{#if commissionPaidBy=split}}Buyer and Seller equally{{/if}} at closing. Each party will protect the other from any other broker's claim based on that party's own dealings.{{else}}0. BROKERS AND COMMISSION
Each party states that it has not used a real-estate broker or agent in this transaction, and each will protect the other from any commission claim based on that party's own dealings. This promise continues after closing.{{/if}}

{{#if hoa}}0. ASSOCIATION
The Property is in an association. Seller will give Buyer the association's governing documents, current fees and any resale information the law requires, and Buyer may cancel within the period the law allows after receiving them. Association fees and assessments are adjusted as of the closing date.

{{/if}}0. TAX WITHHOLDING AND REPORTING
If Seller is not a Maryland resident, or is a foreign person for federal tax purposes, the settlement agent may withhold from Seller's proceeds the amounts Maryland and federal law require, and Seller will sign the certifications and forms needed. Buyer and Seller will also give the settlement agent the information needed to file the report the Internal Revenue Code requires for real-estate sales (Form 1099-S). These promises continue after closing.

12. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}. Notices must be in writing and sent to the addresses above. Time is of the essence. This Agreement binds the parties and their heirs, representatives, successors and permitted assigns, and may be signed in counterparts, including electronically, which together form one agreement. If any part is not enforceable, the rest remains in effect. Buyer may assign this Agreement only with Seller's written consent. Each person who signs for a company states that he or she is authorized to do so.

SELLER: {{seller}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

BUYER: {{buyer}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________`,
  },
  {
    key: "lease_residential", title: "Residential Lease Agreement", category: REAL_ESTATE,
    description: "A landlord rents a home or apartment to one or more tenants: term, rent, deposit, rules, repairs, lead-paint notices and move-out.",
    reviewNote: "Check current Maryland and local rules before using it: the security deposit may not exceed one month's rent (Real Property Article 8-203), a late fee may not exceed 5% of the unpaid rent (8-208), the lease must be given with a copy of the current Maryland Tenants' Bill of Rights attached, most rental properties need a city or county rental license, and homes built before 1978 need the lead registration, lead inspection certificate, EPA pamphlet and Maryland Notice of Tenant's Rights given on or before move-in, plus the federal Lead Warning Statement. The security-deposit wording and the notice periods are in plain words: check them against the current statute. Confirm with an attorney: whether the 60-day landlord notice also applies when a fixed term simply expires, whether a monthly pet charge is allowed, and your local license rules (for example Baltimore City). Not checked by the app: that the deposit is no more than one month's rent and that any late fee is no more than 5% of the rent. Have an attorney review it.",
    steps: [
      { title: "Landlord and tenants", questions: [text("landlord", "Landlord (owner or manager)", { required: true }), text("landlordAddress", "Landlord's address for notices", { required: true }), text("landlordPhone", "Landlord's phone", { required: true }),
        list("tenants", "Tenants who sign the lease", [text("name", "Full name", { required: true })], { required: true, addLabel: "Add a tenant" }), text("occupants", "Other people who will live there (names, optional)"), effective(), state()] },
      { title: "The home", questions: [text("propertyAddress", "Address (include unit number)", { required: true }), text("county", "County or city", { required: true }),
        pick("homeType", "Type of home", [["house", "House"], ["apartment", "Apartment"], ["condo", "Condominium"], ["room", "Room in a shared home"]], { required: true, default: "apartment" }),
        text("licenseNumber", "Rental license / registration number", { required: true, placeholder: "Write N/A only if none is required where the home is" }),
        pick("preYear78", "Was the home built before 1978?", [["yes", "Yes — built before 1978"], ["no", "No — built in 1978 or later"]], { required: true, help: "If you do not know, check the tax records. Pre-1978 homes need Maryland lead registration, a lead certificate and the lead papers on or before move-in." }),
        area("included", "Appliances and furnishings included", { placeholder: "e.g. Refrigerator, stove, dishwasher, washer and dryer" }), text("parking", "Parking", { placeholder: "e.g. One assigned space" })] },
      { title: "Term and rent", questions: [
        pick("termType", "Lease type", [["fixed", "Fixed term (set start and end)"], ["monthly", "Month to month"]], { required: true, default: "fixed" }),
        date("startDate", "Starts", { required: true }), date("endDate", "Ends", { showIf: { id: "termType", equals: "fixed" }, required: true }),
        money("rent", "Monthly rent", { required: true }), num("rentDay", "Rent is due on day", { default: "1", required: true }), num("graceDays", "Days before rent is late", { default: "5", required: true }),
        yesno("lateFee", "Charge a late fee"), money("lateFeeAmount", "Late fee", { showIf: { id: "lateFee", equals: true }, required: true, help: "Maryland caps a residential late fee at 5% of the unpaid rent. Enter no more than that." }),
        text("payHow", "How rent is paid", { default: "Check, money order or bank transfer to the landlord's address or account" }),
        money("deposit", "Security deposit", { required: true, help: "Maryland caps the deposit at one month's rent. Enter no more than the monthly rent." })] },
      { title: "Rules", questions: [
        pick("utilities", "Utilities", [["tenant", "Tenant pays all utilities"], ["landlord", "Landlord pays all utilities"], ["split", "As listed below"]], { required: true, default: "tenant" }), text("utilitiesNote", "Which utilities, and who pays", { showIf: { id: "utilities", equals: "split" }, required: true, placeholder: "Name heat, gas, electricity, and water and sewer separately" }),
        yesno("pets", "Pets are allowed"), text("petTerms", "Which pets, and any rules", { showIf: { id: "pets", equals: true }, required: true, help: "Do not add a pet deposit or fee here: Maryland limits what a landlord may require to start a lease to the security deposit and the first month's rent." }),
        yesno("noSmoking", "No smoking anywhere in the home", { default: true }), num("entryHours", "Hours' notice before the landlord enters", { default: "24", required: true }),
        yesno("subletAllowed", "Tenant may sublet or take roommates with the landlord's written consent (switch off to forbid it completely)", { default: true }),
      ] },
    ],
    body: `RESIDENTIAL LEASE AGREEMENT

This Lease is made on {{effectiveDate}} between {{landlord}}, {{landlordAddress}}, phone {{landlordPhone}} ("Landlord"), and the following tenant(s), together "Tenant":
{{#list tenants}}• {{name}}
{{/list}}
1. THE HOME
Landlord rents to Tenant the {{#if homeType=house}}house{{/if}}{{#if homeType=apartment}}apartment{{/if}}{{#if homeType=condo}}condominium unit{{/if}}{{#if homeType=room}}room in a shared home{{/if}} at {{propertyAddress}}, {{county}} (the "Home"){{#if parking}}, with {{parking}}{{/if}}.{{#if included}} Included: {{included}}.{{/if}}{{#if occupants}} Other permitted occupants: {{occupants}}.{{/if}} Only the people named in this Lease may live in the Home. Rental license / registration: {{licenseNumber}}. Each person who signs as Tenant is responsible, together with the others, for the whole rent and all of Tenant's other duties.

2. TERM
{{#if termType=fixed}}This Lease runs from {{startDate}} to {{endDate}}. If Landlord does not intend to renew it, Landlord will give Tenant at least 60 days' written notice before the end date. If Tenant stays after the end date with Landlord's consent, the tenancy continues month to month on the same terms, unless the parties sign a new lease or extension.{{else}}This tenancy begins on {{startDate}} and continues month to month. Landlord may end it by giving at least 60 days' written notice, and Tenant may end it by giving at least 30 days' written notice, in each case before the end of a rental month.{{/if}}

3. RENT
Tenant pays {{rent}} per month, due on day {{rentDay}} of each month, by {{payHow}}. {{#if lateFee}}Rent not received within {{graceDays}} days after the due date is subject to a late fee of {{lateFeeAmount}}, which will never be more than 5% of the unpaid rent. {{/if}}Landlord may not charge more than the law allows for late payment. To start this Lease Tenant pays only the first month's rent and the security deposit; no other payment is required to move in.

4. SECURITY DEPOSIT
Tenant pays a security deposit of {{deposit}}, which is not more than one month's rent. Landlord keeps it in a federally insured Maryland account used only for security deposits and pays Tenant the simple interest Maryland law requires. This section is Landlord's receipt for the deposit. Tenant's rights are:
(a) Within 15 days after moving in, Tenant may ask Landlord by certified mail to inspect the Home with Tenant present and list any existing damage.
(b) To be present at the move-out inspection, Tenant sends Landlord a certified-mail notice at least 15 days before moving, stating the move date and the new address. Landlord will inspect within 5 days before or after that date and tell Tenant the inspection date in writing.
(c) Within 45 days after the tenancy ends, Landlord will mail Tenant, by first-class mail, an itemized list of any deductions with their actual costs, and return the rest of the deposit.
(d) A landlord who does not follow the security-deposit law may owe Tenant up to three times the amount wrongly withheld, plus reasonable attorney's fees.
The deposit may be used only for unpaid rent, damage beyond normal wear, and other breaches of this Lease. It is not a limit on what Tenant owes.

5. UTILITIES
{{#if utilities=tenant}}Tenant pays all utilities for the Home, including heat, gas, electricity, water and sewer.{{/if}}{{#if utilities=landlord}}Landlord pays all utilities for the Home, including heat, gas, electricity, water and sewer.{{/if}}{{#if utilities=split}}{{utilitiesNote}}{{/if}}

6. CONDITION AND LANDLORD'S DUTIES
Landlord is providing the Home in a habitable condition. Who pays for heat, gas, electricity and water is stated in the Utilities section. Landlord keeps the heating, plumbing, wiring and structure of the Home in working order and makes repairs as the Repairs section says. A copy of the current Maryland Tenants' Bill of Rights is attached, and Tenant confirms receiving it.

7. USE AND RULES
Tenant uses the Home only as a private home, obeys the law and any building or association rules, and keeps the Home clean and free of nuisance. {{#if noSmoking}}Smoking is not allowed anywhere in the Home. {{/if}}{{#if pets}}Pets are allowed on these terms: {{petTerms}}. {{else}}No pets are allowed without Landlord's written consent. {{/if}}Tenant may not sublet, assign or take in roommates {{#if subletAllowed}}without Landlord's written consent{{else}}under any circumstances{{/if}}.

8. REPAIRS AND CONDITION
Landlord repairs problems Tenant reports in writing, except those caused by Tenant or Tenant's guests. Tenant tells Landlord promptly about leaks, pests, broken heat or other problems, and pays for damage caused by Tenant or guests. Tenant makes no alterations, locks or paint changes without Landlord's written consent.

9. LANDLORD'S ENTRY
Landlord may enter the Home to inspect, repair or show it after giving at least {{entryHours}} hours' notice, except in an emergency.

{{#if preYear78=yes}}10. LEAD-BASED PAINT
The Home was built before 1978. Landlord has registered it with the Maryland Department of the Environment and, on or before move-in, has given Tenant the federal lead-based paint disclosure and Lead Warning Statement, the EPA pamphlet on lead, the Maryland Notice of Tenant's Rights and a copy of the current lead inspection certificate (certificate no. ______________). Tenant confirms receiving them. Landlord will meet the lead inspection and notice requirements that apply to the Home each time it is re-rented.

{{/if}}11. INSURANCE AND LIABILITY
Landlord is not responsible for loss of Tenant's belongings unless caused by Landlord's negligence. Tenant is encouraged to carry renter's insurance.

12. DEFAULT AND ENDING EARLY
If Tenant does not pay rent when due or breaks another term, Landlord may give the written notice, and the time to pay or fix it, that Maryland law requires and then pursue the remedies the law allows, including ending the tenancy through the court. If Tenant leaves early, Tenant remains responsible for rent until the Home is re-rented or the Lease ends, but Landlord will make reasonable efforts to re-rent it.

13. MOVING OUT
At the end of the tenancy Tenant returns all keys, removes belongings, and leaves the Home clean and in the condition it was in at move-in, normal wear excepted.

14. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by Landlord and Tenant, and is governed by the laws of the State of {{state}}. Notices must be in writing and delivered to the addresses above or to the Home, and notices and legal papers for Landlord may be delivered to Landlord's address above. Nothing in this Lease waives any right or remedy Tenant has under Maryland law. If any part is not enforceable, the rest remains in effect.

LANDLORD: {{landlord}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

{{#list tenants}}TENANT: {{name}}
Signature: ______________________________   Date: ______________

{{/list}}`,
  },
  {
    key: "lease_commercial", title: "Commercial Lease Agreement", category: REAL_ESTATE,
    description: "A full commercial lease for a store, office or warehouse: rent and increases, who pays taxes and upkeep, improvements, insurance, default, guarantee and renewal.",
    reviewNote: "A commercial lease can bind the parties for years and for large sums. Have an attorney review it before signing — especially the rent type (gross vs. net), personal guarantee, renewal and default sections. A renewal written as 'rent at market' needs a way to set that rent. If the term including renewals is over seven years the memorandum of lease should be signed and recorded (Real Property Article 3-101 — confirm with an attorney). Confirm with an attorney: the late-interest rate you choose, how licenses for tobacco or alcohol affect the use clause, and any local licensing rules. Companies must sign through an officer with a title; collect authority documents for both sides.",
    steps: [
      { title: "Parties", questions: [text("landlord", "Landlord", { required: true }), text("landlordAddress", "Landlord's address for notices", { required: true }), text("tenant", "Tenant (business name)", { prefill: "clientName", required: true }), text("tenantAddress", "Tenant's address for notices", { prefill: "clientAddress", required: true }), effective(), state()] },
      { title: "The space and its use", questions: [text("premises", "Address of the space (include suite)", { required: true }), text("county", "County or city", { required: true }), text("size", "Size", { placeholder: "e.g. About 2,400 square feet" }),
        text("use", "Permitted use", { required: true, placeholder: "e.g. Retail convenience store and deli" }), text("parkingText", "Parking and common areas included", { placeholder: "e.g. Six reserved spaces and shared loading area" }), yesno("signage", "Tenant may install its own sign, subject to law and landlord's approval", { default: true })] },
      { title: "Term and rent", questions: [
        date("startDate", "Lease starts", { required: true }), date("endDate", "Lease ends", { required: true }), money("rent", "Monthly base rent", { required: true }), num("rentDay", "Rent due on day", { default: "1", required: true }), num("graceDays", "Days before rent is late", { default: "5", required: true }),
        num("increasePercent", "Rent increases each year by (%, 0 for none)", { default: "3", required: true }),
        num("interestPercent", "Interest on unpaid amounts (% per year, 0 for none)", { default: "6", required: true, help: "The lease says never more than the law allows. Ask an attorney if you want a higher rate." }),
        pick("rentType", "Who pays property taxes, insurance and common-area costs?", [["gross", "Landlord pays them (gross lease)"], ["nnn", "Tenant pays its share on top of rent (triple net)"], ["modified", "Shared as listed below (modified gross)"]], { required: true, default: "gross" }),
        text("costNote", "How costs are shared", { showIf: { id: "rentType", equals: "modified" }, required: true }), num("sharePercent", "Tenant's share of the building's costs (%)", { showIf: { id: "rentType", equals: "nnn" }, default: "100", required: true }),
        money("deposit", "Security deposit", { required: true }), yesno("lateFee", "Charge a late fee"), money("lateFeeAmount", "Late fee", { showIf: { id: "lateFee", equals: true }, required: true }),
        yesno("renewal", "Tenant has the option to renew"), text("renewalTerms", "Renewal terms", { showIf: { id: "renewal", equals: true }, required: true, placeholder: "e.g. One 3-year renewal, 6 months' notice, rent increased by 3% a year" }),
      ] },
      { title: "Upkeep, insurance, guarantee", questions: [
        pick("utilities", "Utilities", [["tenant", "Tenant pays all utilities"], ["landlord", "Landlord pays all utilities"], ["split", "As listed below"]], { required: true, default: "tenant" }), text("utilitiesNote", "Which utilities, and who pays", { showIf: { id: "utilities", equals: "split" }, required: true }),
        pick("repairs", "Repairs", [["standard", "Landlord: roof, structure and building systems. Tenant: everything inside the space"], ["tenantAll", "Tenant repairs and maintains the whole space"]], { required: true, default: "standard" }),
        money("liabilityAmount", "Tenant's liability insurance (minimum per occurrence)", { default: "1000000", required: true }),
        num("holdoverPercent", "Rent if tenant stays past the end date (% of the last rent)", { default: "150", required: true }),
        yesno("guarantee", "Someone personally guarantees the tenant's obligations"), text("guarantor", "Guarantor's name", { showIf: { id: "guarantee", equals: true }, required: true }),
        yesno("brokerUsed", "A real-estate broker was involved"), text("brokerName", "Broker / brokerage and who pays the commission", { showIf: { id: "brokerUsed", equals: true } }),
      ] },
    ],
    body: `COMMERCIAL LEASE AGREEMENT

This Lease is made on {{effectiveDate}} between {{landlord}}, {{landlordAddress}} ("Landlord") and {{tenant}}, {{tenantAddress}} ("Tenant").

1. PREMISES
Landlord leases to Tenant the space at {{premises}}, {{county}}{{#if size}} ({{size}}){{/if}} (the "Premises"){{#if parkingText}}, together with {{parkingText}}{{/if}}.

2. USE
Tenant will use the Premises only for {{use}}, in compliance with all laws and with every license and permit the use requires, and will not create a nuisance or a hazard.{{#if signage}} Tenant may install a sign with Landlord's written approval, which will not be unreasonably withheld, at Tenant's cost and in compliance with local law; Tenant removes it and repairs any damage at the end of the Lease.{{/if}}

3. CONDITION, LICENSES AND QUIET USE
Landlord delivers the Premises in their present condition, and Tenant has the quiet use of them as long as Tenant is not in default. Landlord does not promise that zoning or any other law allows Tenant's use; Tenant is responsible for confirming this and for obtaining every license and permit its business needs, including tobacco, alcohol and sales-tax licenses. Tenant is responsible for accessibility (ADA) requirements inside the Premises and for its own work; Landlord is responsible for the common areas. Tenant will not use or store hazardous materials except ordinary retail products, and will pay for any contamination it causes.

4. TERM
The Lease runs from {{startDate}} to {{endDate}}.{{#if renewal}} Renewal: {{renewalTerms}}.{{/if}} If the term, including any renewal, is longer than seven years, the parties will sign a memorandum of lease that either of them may record in the land records.

5. RENT
Tenant pays base rent of {{rent}} per month, due on day {{rentDay}} of each month. {{#if increasePercent}}Each year on the anniversary of the start date, base rent increases by {{increasePercent}}% of the rent in effect. {{/if}}Rent not received within {{graceDays}} days after the due date is {{#if lateFee}}subject to a late fee of {{lateFeeAmount}} and {{/if}}late.{{#if interestPercent}} Unpaid amounts also bear simple interest at {{interestPercent}}% per year from the due date, but never more than the law allows.{{/if}}

6. TAXES, INSURANCE AND COMMON-AREA COSTS
{{#if rentType=gross}}Landlord pays property taxes, building insurance and common-area costs; they are included in the rent.{{/if}}{{#if rentType=nnn}}In addition to base rent, Tenant pays {{sharePercent}}% of the building's property taxes, building insurance and common-area maintenance costs, in monthly estimates adjusted after each year ends. Landlord gives Tenant a written statement of the actual costs within 120 days after each year ends, any difference is paid or credited within 30 days, and Landlord shows Tenant the records on request.{{/if}}{{#if rentType=modified}}Property taxes, building insurance and common-area costs are shared as follows: {{costNote}}{{/if}}

7. SECURITY DEPOSIT
Tenant pays a security deposit of {{deposit}}, held by Landlord and returned within 45 days after the Lease ends and Tenant has surrendered the Premises, less amounts needed for unpaid rent or for damage beyond normal wear. The deposit is not a limit on what Tenant owes.

8. UTILITIES
{{#if utilities=tenant}}Tenant pays all utilities for the Premises.{{/if}}{{#if utilities=landlord}}Landlord pays all utilities for the Premises.{{/if}}{{#if utilities=split}}{{utilitiesNote}}{{/if}}

9. REPAIRS AND MAINTENANCE
{{#if repairs=standard}}Landlord repairs and maintains the roof, structure, foundation and building systems serving the Premises, except damage caused by Tenant. Tenant keeps the inside of the Premises clean and in good repair, including fixtures, windows, doors and Tenant's equipment.{{else}}Tenant repairs and maintains the entire Premises, including the roof, structure and building systems serving them, except for the cost of replacing major structural elements, which Landlord bears.{{/if}}

10. ALTERATIONS
Tenant makes no structural changes or alterations without Landlord's written consent. Improvements Tenant makes become Landlord's property at the end of the Lease unless the parties agree otherwise in writing, and Tenant keeps the Premises free of liens for work Tenant orders.

11. INSURANCE AND INDEMNITY
Tenant carries commercial general liability insurance of at least {{liabilityAmount}} per occurrence, naming Landlord as an additional insured, plus insurance on Tenant's own property, and gives Landlord proof on request. Tenant protects Landlord from claims arising from Tenant's use of the Premises, except those caused by Landlord's negligence. Each party waives claims against the other for loss that its own property insurance covers, to the extent its insurer allows this.

12. DAMAGE AND CONDEMNATION
If the Premises are damaged and cannot be used, rent is reduced until they are repaired. Landlord will repair the damage within 120 days if insurance money is available; if repairs would take more than 120 days or the insurance money is not available, either party may end the Lease by written notice. If a government takes all or a substantial part of the Premises, the Lease ends on the date of the taking.

13. ASSIGNMENT AND SUBLETTING
Tenant may not assign this Lease or sublet any part of the Premises without Landlord's written consent, which will not be unreasonably withheld. A transfer of control of Tenant counts as an assignment. Tenant stays responsible after an assignment unless Landlord releases it in writing.

14. LANDLORD'S ENTRY
Landlord may enter the Premises at reasonable times on reasonable notice to inspect, repair or show it to buyers, lenders or new tenants, and at any time in an emergency.

15. DEFAULT AND REMEDIES
Tenant is in default if it does not pay rent within 10 days after written notice, or breaks another term and does not fix it within 30 days after written notice. Landlord may then end the Lease or Tenant's right to possession, re-enter as the law allows, and recover unpaid rent, damages and reasonable collection and legal costs, giving credit for amounts received from re-renting. Landlord defaults if it does not fix a failure within 30 days after written notice from Tenant.

16. SUBORDINATION AND ESTOPPEL
This Lease is subject to any mortgage on the building, provided the lender agrees not to disturb Tenant while Tenant is not in default. Within 15 days of a request, each party will confirm in writing the Lease's terms and whether any default exists.

17. END OF LEASE AND HOLDING OVER
At the end of the Lease Tenant returns the Premises clean and in good condition, normal wear and approved alterations excepted, and removes its own property. If Tenant stays after the end date without a new written lease, Tenant is a holdover tenant and this is not a renewal: rent is {{holdoverPercent}}% of the last monthly rent, prorated by day, Tenant owes Landlord's resulting damages, and Landlord may recover possession.

{{#if guarantee}}18. GUARANTEE
{{guarantor}} personally and unconditionally guarantees that Tenant will pay all rent and perform all obligations under this Lease, as amended or renewed, and signs below to confirm it. The guarantee continues despite any change to the Lease, any release of Tenant or any delay by Landlord. Guarantor gives up any right to notice and any defense available to a guarantor, Landlord need not first pursue Tenant, and Guarantor will pay Landlord's reasonable costs of collecting from Guarantor.

{{/if}}{{#if brokerUsed}}19. BROKER
{{brokerName}} acted in this Lease. Each party will protect the other from any other broker's claim based on its own dealings.

{{/if}}20. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, binds their heirs, successors and permitted assigns, and is governed by the laws of the State of {{state}}. Notices must be in writing and delivered to the addresses above. Time is of the essence. If any part is not enforceable, the rest remains in effect. This Lease may be signed in counterparts, including electronically. Each person who signs for a company states that he or she is authorized to do so.

LANDLORD: {{landlord}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

TENANT: {{tenant}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________
{{#if guarantee}}
GUARANTOR: {{guarantor}}
Signature: ______________________________   Date: ______________
{{/if}}`,
  },
  /* ─────────────── Batch 7: powers, sales and transfers ─────────────── */
  {
    key: "general_poa", title: "Power of Attorney", category: FAMILY,
    description: "Lets someone you trust handle your money, tax, property or business matters for you — general or limited, with or without a start condition. Follows the layout of Maryland's statutory financial power of attorney.",
    reviewNote: "Maryland requires a power of attorney to be signed by the principal (or by someone else at the principal's direction and in the principal's presence), acknowledged before a notary, and signed by two or more adult witnesses (the notary may be one of them) — Estates and Trusts Article §17-110. The witnesses should not be the agent. For the IRS use Form 2848 / 8821; the Maryland Comptroller accepts only its own Form 548 (it no longer accepts 2848 / 8821). A bank or title company may still ask for its own form. To sell or mortgage real estate, use the limited statutory form and record it in the county land records. Confirm with an attorney: (1) the 'copy is as good as the original' and good-faith reliance wording, which is standard but was not checked against a Maryland statute; (2) who may certify incapacity for a power that starts only on incapacity (Estates and Trusts §17-111 refers to a physician or licensed psychologist, or a person you name); (3) whether gifts should be allowed at all. Have a Maryland attorney review before use.",
    steps: [
      { title: "People", questions: [text("principal", "Person giving the power (you)", { prefill: "clientName", required: true }), text("principalAddress", "Their address", { prefill: "clientAddress" }), text("principalPhone", "Their telephone", { prefill: "clientPhone" }), text("agent", "Person receiving the power (agent)", { required: true }), text("agentAddress", "Agent's address"), yesno("hasSuccessor", "Name a backup agent in case the first cannot act"), text("successor", "Backup agent", { showIf: { id: "hasSuccessor", equals: true }, required: true }), effective(), state()] },
      { title: "What the agent may do", questions: [
        pick("powerType", "Kind of power", [["general", "General — the subjects I tick below"], ["limited", "Limited — only the matters I list"]], { required: true, default: "general" }),
        area("limitedPowers", "The matters the agent may handle", { showIf: { id: "powerType", equals: "limited" }, required: true, placeholder: "e.g. Sign the sale papers for the property at 12 Main St, and collect the proceeds" }),
        yesno("sReal", "Real property — buy, sell, lease, mortgage and manage", { showIf: { id: "powerType", equals: "general" }, default: true }),
        yesno("sPersonal", "Tangible personal property — vehicles, boats, belongings", { showIf: { id: "powerType", equals: "general" }, default: true }),
        yesno("sStocks", "Stocks, bonds and investment accounts", { showIf: { id: "powerType", equals: "general" }, default: true }),
        yesno("sBanks", "Banks and financial institutions — accounts, deposits, withdrawals, checks, safe deposit boxes", { showIf: { id: "powerType", equals: "general" }, default: true }),
        yesno("sInsurance", "Insurance and annuities", { showIf: { id: "powerType", equals: "general" }, default: true }),
        yesno("sClaims", "Claims and lawsuits", { showIf: { id: "powerType", equals: "general" }, default: true }),
        yesno("sBenefits", "Government benefits — Social Security, Medicare, Medicaid, veterans", { showIf: { id: "powerType", equals: "general" }, default: true }),
        yesno("sRetirement", "Retirement plans", { showIf: { id: "powerType", equals: "general" }, default: true }),
        yesno("sTaxes", "Taxes — returns, refunds, payments, notices", { showIf: { id: "powerType", equals: "general" }, default: true }),
        yesno("sBusiness", "Business interests and operations", { showIf: { id: "powerType", equals: "general" }, default: true }),
        yesno("sDigital", "Digital assets and online accounts", { showIf: { id: "powerType", equals: "general" }, default: true }),
        yesno("gifts", "The agent may make gifts from my property", { showIf: { id: "powerType", equals: "general" }, default: false }),
        pick("giftLimit", "Limit on gifts", [["annual", "Up to the federal annual gift-tax exclusion for each person each year"], ["amount", "Up to a total amount I set"]], { showIf: { id: "gifts", equals: true }, required: true, default: "annual" }),
        money("giftAmount", "Total amount of gifts allowed", { showIf: { id: "giftLimit", equals: "amount" }, required: true }),
        text("giftException", "Agent (or a person the agent must support) who may also receive gifts — leave empty for none", { showIf: { id: "gifts", equals: true }, placeholder: "e.g. my daughter, Sara Ali" }),
        yesno("paid", "The agent may be paid a reasonable fee for the work", { default: false }),
        yesno("revokePrior", "This replaces and cancels my earlier powers of attorney about the same matters", { default: false }),
      ] },
      { title: "When it starts and ends", questions: [
        pick("startsWhen", "Starts", [["now", "As soon as I sign"], ["incapacity", "Only if a physician or licensed psychologist confirms I cannot manage my own affairs"]], { required: true, default: "now" }),
        text("certifier", "Person I name to decide that I cannot manage my affairs (optional)", { showIf: { id: "startsWhen", equals: "incapacity" }, placeholder: "e.g. my physician, Dr. Jane Smith" }),
        yesno("durable", "It stays in effect if I become unable to manage my affairs", { showIf: { id: "startsWhen", equals: "now" }, default: true }),
        date("endDate", "Ends on (leave empty for no end date)"),
      ] },
      { title: "Witnesses and notary", questions: [text("county", "County where it is signed", { placeholder: "e.g. Baltimore County" }), text("witness1", "First witness (printed name)"), text("witness1Address", "First witness's address"), text("witness2", "Second witness (printed name)"), text("witness2Address", "Second witness's address")] },
    ],
    body: `POWER OF ATTORNEY

Date: {{effectiveDate}}

1. APPOINTMENT
I, {{principal}}{{#if principalAddress}} of {{principalAddress}}{{/if}}{{#if principalPhone}}, telephone {{principalPhone}}{{/if}} ("Principal"), appoint {{agent}}{{#if agentAddress}} of {{agentAddress}}{{/if}} ("Agent") to act for me as my attorney-in-fact.{{#if hasSuccessor}} If {{agent}} dies, resigns, or cannot or will not act, I appoint {{successor}} in their place.{{/if}}

2. POWERS
{{#if powerType=general}}The Agent may act for me in these matters, and in each of them may do anything I could do for myself, sign and deliver documents in my name, and deal with any person, bank or government office:
{{#if sReal}}• Real property: buy, sell, exchange, lease, mortgage and manage real property and sign deeds and settlement papers.
{{/if}}{{#if sPersonal}}• Tangible personal property: buy, sell, insure, store and manage vehicles, boats and belongings.
{{/if}}{{#if sStocks}}• Stocks, bonds and investments: buy, sell, vote and manage them and the accounts that hold them.
{{/if}}{{#if sBanks}}• Banks and financial institutions: open, close and manage accounts, deposit and withdraw money, write and endorse checks, make transfers, and use safe deposit boxes.
{{/if}}{{#if sInsurance}}• Insurance and annuities: buy, change, borrow against and cancel policies and collect benefits.
{{/if}}{{#if sClaims}}• Claims and lawsuits: start, defend and settle claims and hire lawyers.
{{/if}}{{#if sBenefits}}• Government benefits: apply for and manage Social Security, Medicare, Medicaid and other public benefits.
{{/if}}{{#if sRetirement}}• Retirement plans: contribute to, withdraw from, roll over and manage retirement accounts.
{{/if}}{{#if sTaxes}}• Taxes: prepare, sign and file returns, pay taxes, claim refunds, receive notices and deal with tax offices, to the extent the law accepts this document for that purpose.
{{/if}}{{#if sBusiness}}• Business interests: run, buy, sell and manage my business interests and sign contracts for them.
{{/if}}{{#if sDigital}}• Digital assets: manage my online accounts, electronic records and digital property as the law allows.
{{/if}}{{#if !sReal}}{{#if !sPersonal}}{{#if !sStocks}}{{#if !sBanks}}{{#if !sInsurance}}{{#if !sClaims}}{{#if !sBenefits}}{{#if !sRetirement}}{{#if !sTaxes}}{{#if !sBusiness}}{{#if !sDigital}}• No subject has been selected, so this document gives the Agent no power until it is corrected and signed again.
{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{else}}The Agent may act for me only in these matters: {{limitedPowers}}{{/if}}

3. GIFTS AND COMPENSATION
{{#if powerType=general}}{{#if gifts}}The Agent may make gifts from my property, {{#if giftLimit=annual}}up to the federal annual gift-tax exclusion for each person each year{{else}}up to {{giftAmount}} in total{{/if}}. {{#if giftException}}Gifts to the Agent, or to anyone the Agent is legally required to support, are not allowed except to {{giftException}}.{{else}}Gifts to the Agent, or to anyone the Agent is legally required to support, are not allowed.{{/if}}{{else}}The Agent may not make gifts from my property.{{/if}}{{else}}The Agent may not make gifts from my property.{{/if}} {{#if paid}}The Agent may be paid a reasonable fee for the work, and repaid reasonable expenses.{{else}}The Agent will not be paid but may be repaid reasonable expenses.{{/if}}

4. WHEN IT STARTS AND HOW LONG IT LASTS
{{#if startsWhen=now}}This power starts when I sign it.{{else}}This power starts only when {{#if certifier}}{{certifier}} (or, if that person cannot or will not act, a physician or licensed psychologist){{else}}a physician or licensed psychologist{{/if}} confirms in writing that I cannot manage my own affairs.{{/if}} {{#if startsWhen=incapacity}}It is a durable power of attorney: once it starts, it stays in effect while I am unable to manage my affairs.{{else}}{{#if durable}}It is a durable power of attorney: it stays in effect if I later become disabled or unable to manage my affairs.{{else}}It ends if I become disabled or unable to manage my affairs.{{/if}}{{/if}} {{#if endDate}}It ends on {{endDate}}, or earlier if I revoke it in writing or I die.{{else}}It lasts until I revoke it in writing or I die.{{/if}}

5. THE AGENT'S DUTIES
The Agent must act in good faith and only within the powers given here; act according to my reasonable expectations if they are known, and otherwise in my best interest; act loyally for my benefit and avoid conflicts of interest; act with care, competence and diligence; keep my property separate from the Agent's own; keep records of every transaction; and give me, my guardian or my personal representative an account when asked. The Agent is not liable if the value of my property goes down without a breach of these duties.

6. OTHER TERMS
This document does not give the Agent power to make health-care decisions. {{#if revokePrior}}This document replaces and cancels my earlier powers of attorney about the same matters.{{else}}This document does not cancel any other power of attorney I have signed.{{/if}} When signing for me, the Agent must sign my name, followed by "by" and the Agent's own name, as attorney-in-fact. If the Agent is my spouse, the Agent's authority also ends if an action for divorce, annulment or legal separation is filed.

7. REVOCATION, COPIES AND RELIANCE
I may revoke this power at any time by written notice to the Agent and to every bank or office that has been given this document. A copy of this document is as good as the original. A person who relies on this document in good faith may keep relying on it until they receive written notice that it has ended. This document is governed by the laws of the State of {{state}}.

PRINCIPAL: {{principal}}
Signature: ______________________________   Date: ______________

Signed for the Principal, at the Principal's direction and in the Principal's presence, by: ______________________________ (only if the Principal cannot sign)

AGENT (accepting): {{agent}}
Signature: ______________________________   Date: ______________

ATTESTATION OF WITNESSES
Each of us is an adult, and neither of us is the Agent. The Principal declared this document to be their power of attorney and signed it (or directed another to sign it for them) in our presence. The Principal appeared to be of sound mind and under no duress, fraud or undue influence. Each of us signed in the presence of the Principal and of each other.

Witness 1: {{#if witness1}}{{witness1}}{{else}}______________________________{{/if}}
Address: {{#if witness1Address}}{{witness1Address}}{{else}}______________________________{{/if}}
Signature: ______________________________   Date: ______________

Witness 2: {{#if witness2}}{{witness2}}{{else}}______________________________{{/if}}
Address: {{#if witness2Address}}{{witness2Address}}{{else}}______________________________{{/if}}
Signature: ______________________________   Date: ______________

ACKNOWLEDGMENT BEFORE A NOTARY
State of Maryland, County of {{#if county}}{{county}}{{else}}______________{{/if}}
On ______________, before me, the undersigned notary public, personally appeared {{principal}}, known to me or satisfactorily proven to be the person who signed this document, and acknowledged that they signed it voluntarily for the purposes stated in it.
Notary public signature and seal: ______________________________
Printed name: ______________________________
My commission expires: ______________`,
  },
  {
    key: "business_sale_agreement", title: "Sale of a Business Agreement", category: BUSINESS,
    description: "Selling or buying a whole store or business — price, what is included, inventory, lease, licenses, closing conditions and what the seller must not do after the sale.",
    reviewNote: "Have an attorney review this before signing. Confirm with an attorney or the tax preparer: (1) Maryland bulk-transfer rules — notice to creditors and the Comptroller at least 10 days before the buyer takes possession or pays, a sworn creditor list, and the buyer's duty to hold back the Comptroller's claim; a buyer who skips them can be held responsible for the seller's unpaid sales tax; (2) sales tax on equipment and fixtures bought with the business; (3) IRS Form 8594 and how the price is split; (4) licenses — tobacco, alcohol, lottery, health and sales-tax registrations usually do not transfer and the buyer must apply in the buyer's own name, sometimes well before closing; no tobacco or lottery stock should change hands before the buyer is licensed; (5) whether the seller's promise not to compete is reasonable for this business and place, and whether it is affected by the seller working for the buyer after closing; (6) employee, payroll and unemployment-insurance accounts; (7) vehicles need their own title transfer.",
    steps: [
      { title: "Parties and business", questions: [text("seller", "Seller", { required: true }), text("sellerAddress", "Seller's address"), text("buyer", "Buyer", { required: true }), text("buyerAddress", "Buyer's address"), text("businessName", "Business name", { required: true }), text("businessAddress", "Business address", { required: true }), text("businessKind", "What the business does", { placeholder: "e.g. Convenience store selling groceries, tobacco and lottery" }), effective(), state()] },
      { title: "Price and payment", questions: [
        money("price", "Total price", { required: true }), money("deposit", "Deposit paid now (leave blank if none)"),
        pick("payment", "Payment of the rest", [["closing", "All in cash at closing"], ["financed", "Part paid later by the Buyer in installments"]], { required: true, default: "closing" }),
        money("financedAmount", "Amount paid later", { showIf: { id: "payment", equals: "financed" }, required: true }), num("financedMonths", "Number of monthly payments", { showIf: { id: "payment", equals: "financed" }, required: true }),
        num("financedRate", "Yearly interest rate on the amount paid later (%, leave blank for none)", { showIf: { id: "payment", equals: "financed" } }),
        yesno("buyerGuaranty", "The Buyer's owners personally guarantee the amount paid later", { showIf: { id: "payment", equals: "financed" }, default: false }),
        date("closingDate", "Closing date", { required: true }),
        pick("inventory", "Inventory (stock)", [["included", "Included in the price"], ["atcost", "Counted on closing day and paid for separately at cost"]], { required: true, default: "atcost" }),
      ] },
      { title: "What is included", questions: [
        area("equipment", "Equipment, fixtures and other assets included", { placeholder: "e.g. Shelving, coolers, cash registers, signs, security cameras" }),
        yesno("leaseTransfer", "The Buyer takes over the Seller's lease of the premises", { default: true }),
        text("landlord", "Landlord", { showIf: { id: "leaseTransfer", equals: true } }),
        area("licenses", "Licenses and permits the Buyer must obtain in the Buyer's own name", { placeholder: "e.g. Tobacco license, lottery agent, health permit, alcohol license, sales tax registration" }),
      ] },
      { title: "After the sale", questions: [
        yesno("nonCompete", "The Seller will not open a competing business nearby", { default: true }),
        num("noCompeteYears", "For how many years", { showIf: { id: "nonCompete", equals: true }, default: "3", required: true }),
        num("noCompeteMiles", "Within how many miles", { showIf: { id: "nonCompete", equals: true }, default: "3", required: true }),
        num("helpDays", "Days the Seller will help the Buyer with the changeover", { default: "14" }),
      ] },
    ],
    body: `AGREEMENT FOR THE SALE OF A BUSINESS

Date: {{effectiveDate}}

This agreement is between {{seller}}{{#if sellerAddress}} of {{sellerAddress}}{{/if}} ("Seller") and {{buyer}}{{#if buyerAddress}} of {{buyerAddress}}{{/if}} ("Buyer").

1. THE BUSINESS
The Seller sells and the Buyer buys the business known as {{businessName}}, located at {{businessAddress}}{{#if businessKind}} ({{businessKind}}){{/if}}, together with its name, customer goodwill, telephone numbers and records, and the assets listed here: {{#if equipment}}{{equipment}}{{else}}the equipment and fixtures at the premises on the date of this agreement{{/if}}. The sale does not include cash, bank accounts, accounts receivable, tax refunds, lottery funds or the Seller's personal items. Any motor vehicle included needs its own signed title transfer, which the parties will complete.

2. PRICE
The total price is {{price}}. {{#if deposit}}A deposit of {{deposit}} is paid now and counts toward the price.{{else}}No deposit is paid at signing.{{/if}} {{#if payment=closing}}The rest is paid in cash at closing.{{else}}At closing the Buyer pays the rest except {{financedAmount}}, which the Buyer pays to the Seller in {{financedMonths}} equal monthly payment(s) after closing{{#if financedRate}}, with interest at {{financedRate}}% a year{{/if}}, under a separate signed note. The note is secured by the business's assets and inventory, may be paid early, and becomes fully due if any payment is more than 10 days late.{{#if buyerGuaranty}} The Buyer's owners personally guarantee the note.{{/if}}{{/if}}

3. INVENTORY
{{#if inventory=included}}The stock on hand at closing is included in the price.{{else}}The stock on hand is counted by both parties on closing day, with the count signed by both, and the Buyer pays the Seller for it, in addition to the price above, at the cost shown on the Seller's supplier invoices. Damaged, expired and unsaleable items are not counted.{{/if}} Lottery tickets, gift cards and goods held on consignment are not inventory of the Seller and are not sold.

4. PRICE ALLOCATION
The price is divided among the assets as stated in a schedule both parties sign, which both use for their tax filings; if there is no signed schedule, they will divide it as their tax preparers agree.

5. CLOSING
The sale closes on {{closingDate}}. At closing the Seller hands over the keys, the assets and the records, signs a bill of sale{{#if leaseTransfer}} and an assignment of the lease{{/if}}, and delivers releases of any liens on the assets. Rent, utilities and prepaid expenses are divided as of the closing date. The Seller bears the risk of loss until closing. The Buyer takes over the business from that time.

6. CONDITIONS TO CLOSING AND DEPOSIT
The Buyer's duty to close depends on {{#if leaseTransfer}}the landlord's written consent to the lease assignment, {{/if}}the Buyer obtaining in its own name the licenses and permits it needs to run the business, and the bulk-transfer notice period described below having passed. If a condition is not met by the closing date through no fault of the Buyer, either party may cancel this agreement{{#if deposit}} and the Seller returns the deposit within 5 days{{/if}}. {{#if deposit}}If the Buyer fails to close when the conditions are met, the Seller keeps the deposit. If the Seller fails to close, the Buyer is refunded the deposit and may claim damages.{{else}}If either party fails to close when the conditions are met, the other party may claim damages.{{/if}}

7. BULK-TRANSFER NOTICE AND TAX HOLDBACK
If this sale is a bulk transfer under Maryland Commercial Law, Title 6, Subtitle 1, the Seller will give the Buyer, at least 15 days before closing, a creditor list signed under oath and a schedule of the property. The Buyer will mail the creditor notice to the listed creditors and to the Comptroller of Maryland at least 10 days before the Buyer takes possession or pays, whichever is first. The Buyer may keep from the closing payment any amount the Comptroller claims for the Seller's unpaid sales and use tax and pay it to the Comptroller; the balance is paid to the Seller when the claim is released or paid.

8. DEBTS AND TAXES
The Seller stays responsible for all debts, wages, taxes and bills of the business up to the closing date, including any sales tax and payroll tax, and will give the Buyer proof that they are paid. The Buyer decides which employees to hire and is responsible for the business after closing.

9. LEASE AND LICENSES
{{#if leaseTransfer}}The Seller will assign the lease of the premises to the Buyer{{#if landlord}} with the written consent of {{landlord}}{{/if}}, and this sale depends on that consent.{{else}}The premises are not part of this sale, and the Buyer is responsible for arranging its own right to use them.{{/if}} The Buyer will apply in its own name for every license and permit needed to run the business{{#if licenses}}, including: {{licenses}}{{/if}}. The Seller will cooperate, will settle all lottery, tax and permit accounts up to closing, and will not transfer cigarettes, tobacco products or lottery tickets to the Buyer until the Buyer holds the license required for them.

10. SELLER'S PROMISES
The Seller states that the Seller owns the assets free of liens, that the information given to the Buyer about sales and expenses is true to the best of the Seller's knowledge, that the business's taxes and licenses are in good standing, and that no lawsuit or government action is pending against the business except as told to the Buyer in writing. If the Seller is a company, the person signing is authorized to sign for it. The Seller will cover the Buyer's losses caused by a statement in this section being untrue.

11. AFTER THE SALE
{{#if helpDays}}For {{helpDays}} day(s) after closing the Seller will help the Buyer with the changeover at no extra charge. {{/if}}{{#if nonCompete}}For {{noCompeteYears}} year(s) after closing the Seller will not own, run or work for a similar business within {{noCompeteMiles}} mile(s) of the premises, and will not seek the business's customers or staff for such a business. The Seller agrees these limits are reasonable and are a material part of the price; if a court finds a limit too broad, it applies to the extent the law allows.{{/if}}

12. GENERAL
This is the whole agreement. It may be changed only in writing signed by both parties, binds their heirs and successors, and is governed by the laws of the State of {{state}}. If a term cannot be enforced the rest stays in force.

SELLER: {{seller}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

BUYER: {{buyer}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________`,
  },
  {
    key: "ownership_transfer", title: "Membership Interest / Share Transfer Agreement", category: BUSINESS,
    description: "One owner transfers all or part of their ownership in an LLC or corporation to another person, for a price or as a gift.",
    reviewNote: "Check the company's own operating agreement or bylaws: other owners may have to consent or have a first right to buy. Update the company records and tell the tax preparer about the change. Confirm with an attorney or the tax preparer: (1) an S corporation can lose its S status if shares go to someone who is not an eligible shareholder; (2) a change in the number of LLC members can change how the LLC is taxed; (3) how profit and loss for the year is divided between the old and new owner; (4) whether a gift needs a gift tax return; (5) whether licenses (alcohol, tobacco, lottery, health), the lease or loans need notice or consent when ownership changes — some count a transfer of an interest as a change of ownership. Attach the other owners' written consent if the agreement requires it.",
    steps: [
      { title: "Company and people", questions: [text("company", "Company name", { prefill: "clientName", required: true }), pick("entityType", "The company is", [["llc", "An LLC (membership interest)"], ["corp", "A corporation (shares of stock)"]], { required: true, default: "llc" }), text("assignor", "Owner transferring (Transferor)", { required: true }), text("assignee", "Person receiving (Transferee)", { required: true }), text("assigneeAddress", "Transferee's address"), text("companySigner", "Person who signs for the company", { required: true }), text("companySignerTitle", "That person's title", { placeholder: "e.g. Manager, President" }), effective(), state()] },
      { title: "Terms", questions: [
        num("percent", "Ownership transferred (% of the whole company)", { required: true }),
        num("remaining", "Transferor's ownership after the transfer (%)"),
        text("shareDetails", "Number of shares and certificate numbers", { showIf: { id: "entityType", equals: "corp" } }),
        money("price", "Price (leave blank if a gift)"),
        text("payWhen", "How and when it is paid", { placeholder: "e.g. In full by bank transfer on the date above" }),
        yesno("othersConsent", "The other owners have agreed in writing", { default: false }),
        list("consenters", "Other owners who consent (they sign below)", [text("name", "Name", { required: true })], { addLabel: "Add an owner" }),
        yesno("releaseGuaranty", "Transferor is to be released from personal guaranties of the company's debts", { default: false }),
        yesno("steppingDown", "The Transferor also resigns as manager / officer", { default: false }),
      ] },
    ],
    body: `{{#if entityType=llc}}MEMBERSHIP INTEREST TRANSFER AGREEMENT{{else}}SHARE TRANSFER AGREEMENT{{/if}}

Date: {{effectiveDate}}

1. THE TRANSFER
{{assignor}} ("Transferor") transfers to {{assignee}}{{#if assigneeAddress}} of {{assigneeAddress}}{{/if}} ("Transferee") {{percent}}% of all the {{#if entityType=llc}}membership interests{{else}}shares{{/if}} in {{company}} ("Company"), including the matching share of profits, losses, distributions and voting rights, from the date above{{#if remaining}}, leaving the Transferor with {{remaining}}%{{/if}}.{{#if entityType=corp}}{{#if shareDetails}} Shares transferred: {{shareDetails}}.{{/if}}{{/if}} At signing the Transferor delivers {{#if entityType=llc}}any membership certificate and a signed assignment{{else}}the stock certificate(s), endorsed, or a signed stock power{{/if}}.

2. {{#if price}}PRICE{{else}}GIFT{{/if}}
{{#if price}}The Transferee pays the Transferor {{price}}{{#if payWhen}}: {{payWhen}}{{/if}}.{{else}}This transfer is a gift and no price is paid. The parties understand that a gift may need a gift tax return and that the Transferee may take over the Transferor's tax basis, and they will ask the tax preparer.{{/if}}

3. THE TRANSFEROR'S PROMISES
The Transferor owns what is transferred free of any lien or claim, has not transferred or pledged it to anyone else, has the right to transfer it, and is not aware of any claim against the Company that has not been told to the Transferee. The Transferee is acquiring it for the Transferee's own account and has had the chance to review the Company's records.

4. CONSENT AND ADMISSION
{{#if othersConsent}}All other owners of the Company have agreed in writing to this transfer and to the Transferee becoming an owner; they sign below.{{else}}This transfer is subject to any consent or first right of purchase required by the Company's own agreement, and takes effect only once it is obtained.{{/if}} The Transferee agrees to be bound by the Company's operating agreement or bylaws.{{#if entityType=llc}} The Transferee is admitted as a member of the Company on the date above. If the Transferor has transferred the whole interest, the Transferor ceases to be a member.{{/if}}

5. APPROVALS
The Transferor and the Company will give any notice to, and obtain any approval from, licensing agencies, the landlord and lenders that is required for this transfer. This transfer takes effect only when those required approvals have been obtained.

6. THE COMPANY
The Company accepts the transfer, will record it in its books and update its ownership records, and the Transferee will be treated as the owner of the percentage above from the date of this agreement. {{#if steppingDown}}The Transferor resigns as manager and officer of the Company on the same date. {{/if}}{{#if releaseGuaranty}}The Transferee will ask the Company's lenders and landlord to release the Transferor from any personal guaranty of the Company's debts and will protect the Transferor against claims under those guaranties.{{/if}}

7. TAXES
Profits and losses for the year are divided between the Transferor and the Transferee as the Company's tax preparer determines under the tax rules, and both accept that division.

8. GENERAL
This is the whole agreement on this subject, may be changed only in writing signed by all who sign below, and is governed by the laws of the State of {{state}}. If a term cannot be enforced, the rest stays in force.

TRANSFEROR: {{assignor}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

TRANSFEREE: {{assignee}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

COMPANY: {{company}}
By: {{companySigner}}{{#if companySignerTitle}}, {{companySignerTitle}}{{/if}}
Signature: ______________________________   Date: ______________
{{#if consenters}}
CONSENT OF THE OTHER OWNERS
The undersigned owners consent to this transfer.
{{#list consenters}}{{name}}
Signature: ______________________________   Date: ______________

{{/list}}{{/if}}`,
  },
  {
    key: "personal_guaranty", title: "Personal Guaranty", category: LENDING,
    description: "A person promises to pay a business debt personally if the business does not.",
    reviewNote: "A guarantor can lose personal property if the business cannot pay. Read the loan or lease this guaranty supports before signing. A bank or other lender should not require a spouse to sign merely because of marriage (Regulation B, 12 CFR §1002.7(d)). Waivers of a guarantor's defenses are only as strong as Maryland courts will enforce them — confirm with an attorney. Describe the loan or lease with its date, amount and the document name so there is no doubt what is guaranteed.",
    steps: [
      { title: "Parties", questions: [text("guarantor", "Guarantor (the person promising)", { required: true }), text("guarantorAddress", "Guarantor's address"), text("creditor", "Creditor (who is owed)", { required: true }), text("borrower", "Business or person whose debt is guaranteed", { prefill: "clientName", required: true }), effective(), state()] },
      { title: "What is guaranteed", questions: [
        area("obligation", "The debt or obligation", { required: true, placeholder: "e.g. The loan of $50,000 dated June 1, 2026 under the loan agreement between the Creditor and the Borrower, or all rent due under the lease of the store at 12 Main St dated May 1, 2026" }),
        pick("limit", "How much is guaranteed", [["all", "Everything owed under the obligation"], ["capped", "Up to a fixed amount"]], { required: true, default: "all" }),
        money("cap", "The most the Guarantor will pay (principal and interest)", { showIf: { id: "limit", equals: "capped" }, required: true }),
      ] },
    ],
    body: `PERSONAL GUARANTY

Date: {{effectiveDate}}

1. THE GUARANTY
In consideration of {{creditor}} ("Creditor") extending or continuing credit to {{borrower}} ("Borrower"), and for other value received, {{guarantor}}{{#if guarantorAddress}} of {{guarantorAddress}}{{/if}} ("Guarantor") personally and unconditionally guarantees to the Creditor the full and on-time payment of the following obligation of the Borrower (the "Obligation"): {{obligation}}

2. HOW MUCH
{{#if limit=all}}The Guarantor is responsible for everything the Borrower owes under the Obligation, including interest, fees and the Creditor's reasonable costs of collecting, including attorney's fees.{{else}}The Guarantor is responsible for up to {{cap}} of principal and interest owed under the Obligation, plus the Creditor's reasonable costs of collecting from the Guarantor, including attorney's fees.{{/if}}

3. NATURE OF THE PROMISE
This is a guaranty of payment, not only of collection: if the Borrower does not pay when due, the Creditor may demand payment from the Guarantor without first suing the Borrower or using any security, and the Guarantor will pay within 10 days after the Creditor's written demand. The guaranty continues until the Obligation is paid in full, even if the Creditor extends time, changes the terms with the Borrower, or accepts partial payments. It also continues if the Borrower's business changes owner, name or form.

4. WHAT THE GUARANTOR GIVES UP
The Guarantor waives notice of default, demand, presentment and protest, and the right to require the Creditor to pursue the Borrower or any collateral first. The Guarantor's obligation is not reduced or ended by the Borrower's bankruptcy or discharge, any defect or unenforceability of the Obligation, any release or impairment of collateral or of another guarantor, or any lack of authority of the Borrower. If a payment to the Creditor is later returned or set aside, this guaranty is reinstated. Until the Creditor is paid in full, the Guarantor waives rights of subrogation, reimbursement and contribution against the Borrower.

5. GENERAL
The Guarantor confirms that the Guarantor has received and read the documents that create the Obligation. This guaranty binds the Guarantor's heirs and estate, benefits the Creditor's successors and assigns, may be changed only in writing signed by the Guarantor and the Creditor, and is governed by the laws of the State of {{state}}. Notices must be in writing. If more than one person signs as Guarantor, each is liable for the whole amount. If a term cannot be enforced the rest stays in force.

GUARANTOR: {{guarantor}}
Signature: ______________________________   Date: ______________

CREDITOR (accepting): {{creditor}}
Signature: ______________________________   Date: ______________
Printed name: ______________________   Title (if a company): ______________`,
  },
  {
    key: "non_compete", title: "Non-Competition and Non-Solicitation Agreement", category: EMPLOYMENT,
    description: "A person promises not to compete with the business or take its customers or staff, for a limited time and area.",
    reviewNote: "Maryland makes a non-compete void for an employee who earns no more than 150% of the State minimum wage (Labor & Employment §3-716) — which covers most store cashiers and stock staff — and for certain health-care and veterinary workers. Confirm the pay level before using it for an employee; keep the time and area reasonable. Have a Maryland attorney review before use.",
    steps: [
      { title: "Parties", questions: [text("company", "Company", { prefill: "clientName", required: true }), text("person", "Person making the promise", { required: true }), text("personAddress", "Their address"), pick("relation", "That person is", [["employee", "An employee"], ["contractor", "An independent contractor"], ["seller", "The seller of the business"]], { required: true, default: "employee" }),
        pick("aboveLimit", "Does the employee earn MORE than 150% of the Maryland minimum wage?", [["yes", "Yes — I have checked the current limit"], ["no", "No, or not sure"]], { showIf: { id: "relation", equals: "employee" }, required: true, help: "At the $15 minimum wage, 150% is $22.50 an hour (about $46,800 a year). Confirm the current figure." }),
        effective(), state()] },
      { title: "The promise", questions: [
        text("locationAddress", "Company location the area is measured from", { required: true, placeholder: "e.g. 1241 N Decker Ave, Baltimore MD 21213" }),
        area("activity", "The competing activity", { required: true, placeholder: "e.g. Owning or running a convenience store or smoke shop" }),
        num("months", "For how many months after the relationship ends", { required: true, default: "12" }), num("miles", "Within how many miles", { required: true, default: "5" }),
        yesno("customers", "Not to take the company's customers or suppliers", { default: true }),
        yesno("staff", "Not to hire or recruit the company's staff", { default: true }),
        yesno("confidential", "Keep the company's business information confidential", { default: true }),
      ] },
    ],
    body: `NON-COMPETITION AND NON-SOLICITATION AGREEMENT

Date: {{effectiveDate}}

This agreement is between {{company}} ("Company") and {{person}}{{#if personAddress}} of {{personAddress}}{{/if}} (the "Person"). In exchange for {{#if relation=seller}}the purchase price Company paid for the business{{else}}employment or engagement by Company, pay, and access to its confidential information{{/if}}, the Person agrees as follows.

1. NON-COMPETITION
{{#if aboveLimit=no}}This section does not apply to the Person: Maryland law (Md. Code, Lab. & Empl. § 3-716) does not allow a promise not to compete for a worker at this pay level. The sections below stay in force.{{else}}For {{months}} months after {{#if relation=seller}}the sale of the business{{else}}the Person's work for the Company ends for any reason{{/if}}, the Person will not, within {{miles}} miles of {{locationAddress}}, own (other than holding less than 2% of a public company), run, or work in a role similar to the Person's role for a business engaged in: {{activity}}.{{/if}}

{{#if customers}}2. CUSTOMERS AND SUPPLIERS
During the same period the Person will not seek customers or suppliers of the Company with whom the Person dealt, or about whom the Person learned confidential information, during the last 12 months of the relationship, to move their business away from the Company.

{{/if}}{{#if staff}}3. STAFF
During the same period the Person will not hire, or encourage to leave, anyone who worked for the Company during the last 6 months of the relationship.

{{/if}}{{#if confidential}}4. CONFIDENTIAL INFORMATION
The Person will keep the Company's private business information (customer and supplier lists, prices, costs, financial records and methods) confidential and will not use it for anyone else, during and after the relationship. Nothing in this agreement stops the Person from reporting a possible violation of law to a government agency. Under 18 U.S.C. § 1833(b), an individual is not liable under any trade-secret law for disclosing a trade secret in confidence to a government official or an attorney solely to report or investigate a suspected violation of law, or in a sealed court filing.

{{/if}}5. FAIRNESS AND SEPARATE SECTIONS
The Person agrees the limits above are reasonable to protect the Company's legitimate business interests. If a court finds any limit too broad, it may reduce it to what is reasonable. Each section stands on its own: if one cannot be enforced, the others stay in force.

6. REMEDIES
If a party breaks this agreement the other may ask a court to order them to stop, in addition to any other remedy. The winning party recovers its reasonable costs of enforcing this agreement.

7. GENERAL
This is the whole agreement on this subject, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}.

COMPANY: {{company}}
Signature: ______________________________   Date: ______________

PERSON: {{person}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "lease_amendment", title: "Lease Amendment / Renewal", category: REAL_ESTATE,
    description: "Extends a lease, changes the rent, or changes other terms, while everything else stays as in the original lease.",
    reviewNote: "Use this only if at least one change below is filled in; an amendment with no change is meaningless (the app does not check this yet). If the lease has a guarantor, the guarantor should sign too. If there are several tenants, add each one below. For a home built before 1978, re-deliver the lead-paint materials Maryland requires, and keep the security deposit within the legal limit if the rent goes up (Real Property Article 8-203; MDE rules) — confirm with an attorney. A landlord's rent-increase notice rules are separate from this agreement.",
    steps: [
      { title: "The lease", questions: [text("landlord", "Landlord", { required: true }), text("tenant", "Tenant", { prefill: "clientName", required: true }), list("otherTenants", "Other tenants who also sign (if any)", [text("name", "Full name", { required: true })], { addLabel: "Add a tenant" }), text("guarantor", "Guarantor of the lease (if any)"), text("premises", "Premises address", { required: true }), date("leaseDate", "Date of the original lease", { required: true }), effective(), state()] },
      { title: "What changes", questions: [
        yesno("extend", "Extend the lease term", { default: true }), date("newEnd", "New ending date", { showIf: { id: "extend", equals: true }, required: true }),
        yesno("rentChange", "Change the rent", { default: false }), money("newRent", "New monthly rent", { showIf: { id: "rentChange", equals: true }, required: true }), date("rentFrom", "New rent starts on", { showIf: { id: "rentChange", equals: true }, required: true }),
        area("other", "Any other change", { placeholder: "e.g. Tenant may add a sign at the front of the building" }),
      ] },
    ],
    body: `LEASE AMENDMENT

Date: {{effectiveDate}}

This amendment is between {{landlord}} ("Landlord") and {{tenant}}{{#list otherTenants}}, {{name}}{{/list}} ("Tenant") and changes the lease dated {{leaseDate}} for the premises at {{premises}}, as that lease may already have been amended ("the Lease").

{{#if extend}}1. TERM
The Lease term is extended and now ends on {{newEnd}}, unless ended earlier under the Lease.

{{/if}}{{#if rentChange}}2. RENT
Beginning {{rentFrom}}, the monthly rent is {{newRent}}, payable on the same dates and in the same way as before.

{{/if}}{{#if other}}3. OTHER CHANGES
{{other}}

{{/if}}4. NOTHING ELSE CHANGES
All other terms of the Lease stay in full force. If this amendment and the Lease disagree, this amendment controls. Each party confirms that the Lease is in effect and that, to its knowledge, the other party is not in default. The security deposit now held stays with the Lease.{{#if guarantor}} {{guarantor}} consents to this amendment and confirms that the guarantee of the Lease continues for the Lease as amended.{{/if}} This amendment is governed by the laws of the State of {{state}} and may be signed in copies, including electronically. Each person who signs for a company states that he or she is authorized to do so.

LANDLORD: {{landlord}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

TENANT: {{tenant}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

{{#list otherTenants}}TENANT: {{name}}
Signature: ______________________________   Date: ______________

{{/list}}{{#if guarantor}}GUARANTOR: {{guarantor}}
Signature: ______________________________   Date: ______________
{{/if}}`,
  },
  {
    key: "gift_letter", title: "Gift Letter", category: FAMILY,
    description: "States that money given to someone — usually for a home purchase — is a gift and does not have to be repaid, with the details a mortgage lender asks for.",
    reviewNote: "A mortgage lender may require its own form, the donor's bank statement showing the funds, and proof of the transfer (wire, check or deposit record). Lenders usually accept gifts only from relatives or people in a family-like relationship, and not from anyone with an interest in the sale — a friend or the seller is often not accepted, so check with the lender first. Gifts above the federal annual exclusion may require the donor to file a gift tax return (Form 709); ask the tax preparer for the current amount. The recipient does not pay gift tax.",
    steps: [
      { title: "People", questions: [text("donor", "Donor (person giving the gift)", { required: true }), text("donorAddress", "Donor's address", { required: true }), text("donorPhone", "Donor's phone", { required: true }), text("recipient", "Recipient (person receiving it)", { prefill: "clientName", required: true }), text("recipientAddress", "Recipient's address"),
        text("relationship", "Donor's relationship to the Recipient", { required: true, placeholder: "e.g. Father, Sister, Fiancé" }),
        pick("relationType", "The Donor is", [["family", "A relative — by blood, marriage, adoption or legal guardianship"], ["partner", "The Recipient's spouse, domestic partner or fiancé(e)"], ["familylike", "Someone in a long-standing family-like relationship with the Recipient"], ["other", "Someone else"]], { required: true }), effective()] },
      { title: "The gift", questions: [
        money("amount", "Amount of the gift", { required: true }), date("giftDate", "Date the gift was paid or will be paid", { required: true }),
        text("transferMethod", "How it is paid", { required: true, placeholder: "e.g. Wire from the Donor's account at ABC Bank to the Recipient's account" }),
        pick("purpose", "What it is for", [["home", "A down payment or closing costs on a home"], ["other", "Another purpose"]], { required: true, default: "home" }),
        text("property", "Address of the home being bought", { showIf: { id: "purpose", equals: "home" }, required: true }), text("lender", "Mortgage lender (if known)", { showIf: { id: "purpose", equals: "home" } }),
        text("source", "Where the money comes from", { placeholder: "e.g. The Donor's savings account at ABC Bank" }),
      ] },
    ],
    body: `GIFT LETTER

Date: {{effectiveDate}}

I, {{donor}}, of {{donorAddress}}, telephone {{donorPhone}}, the Donor, state:

1. I am giving {{recipient}}{{#if recipientAddress}}, of {{recipientAddress}}{{/if}} (the "Recipient"), my {{relationship}}, the sum of {{amount}}. The gift is paid, or will be paid, on {{giftDate}} by {{transferMethod}}.

2. This is a gift. I do not expect it to be repaid in money, property or services, now or in the future, and no loan is involved.

3. {{#if purpose=home}}The gift is to help with the down payment or closing costs for the purchase of the home at {{property}}{{#if lender}}, financed by {{lender}}{{/if}}.{{else}}The gift is for the Recipient's own use.{{/if}}

4. {{#if source}}The money comes from {{source}}.{{else}}The money comes from my own funds.{{/if}} It is not borrowed, and it gives me no lien or claim on the Recipient's property.{{#if purpose=home}} I have no interest in the sale or financing of the home, and I am not connected with the builder, the seller, the real estate agent or any other party to the transaction.{{/if}}

5. {{#if relationType=family}}I am related to the Recipient by blood, marriage, adoption or legal guardianship.{{/if}}{{#if relationType=partner}}I am the Recipient's spouse, domestic partner or fiancé(e).{{/if}}{{#if relationType=familylike}}I have a long-standing family-like relationship with the Recipient.{{/if}}{{#if relationType=other}}My relationship to the Recipient is as stated above.{{/if}}

6. I understand that I may be asked to give my bank records to show where the money came from, and that a federal gift tax return (Form 709) may be required of me if my gifts to the Recipient in a year are more than the annual exclusion. Any gift tax is my responsibility, not the Recipient's.

DONOR: {{donor}}
Signature: ______________________________   Date: ______________

RECIPIENT (acknowledging that this is a gift and will not be repaid): {{recipient}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "business_poa", title: "Business Power of Attorney (Operations, Banking & Tax)", category: BUSINESS,
    description: "A business gives a trusted person authority to run daily operations, handle bank accounts, and deal with tax and government matters — each power can be switched on or off.",
    reviewNote: "Banks usually insist on their own authorization form and a company resolution as well — bring this document, the Articles / EIN letter and a corporate resolution (also in this builder). Sign in front of a notary. This is for a business that is a separate legal entity (LLC, corporation, partnership); if the owner is a sole proprietor, use the personal Power of Attorney instead. A corporation's income tax return must be signed by an authorized officer (26 CFR 1.6062-1) — this document does not change that. For the IRS use Form 2848 / 8821; the Maryland Comptroller accepts only its own Form 548. Whether a Maryland tobacco, lottery or alcohol licence can be handled by an agent at all: confirm with an attorney. Whether a bank or the county will accept the 'copy is as good as the original' and good-faith reliance wording for a business power: confirm with an attorney. Have a Maryland attorney review before use.",
    steps: [
      { title: "The business and the agent", questions: [
        text("company", "Business giving the authority", { prefill: "clientName", required: true }),
        text("companyAddress", "Business address", { prefill: "clientAddress" }),
        pick("entityType", "Kind of business", [["llc", "Limited liability company (LLC)"], ["corp", "Corporation"], ["partnership", "Partnership"], ["other", "Other business entity"]], { required: true, default: "llc" }),
        text("formedIn", "State where it is formed", { default: "Maryland" }),
        text("einLast4", "EIN — last 4 digits only", { placeholder: "e.g. 1234" }),
        text("owner", "Owner / officer signing for the business", { required: true }),
        text("ownerTitle", "Their title", { required: true, placeholder: "e.g. Managing Member, President" }),
        text("agent", "Person receiving the authority (agent)", { required: true }),
        text("agentAddress", "Agent's address"),
        effective(), state(),
      ] },
      { title: "Bank accounts", description: "Switch off anything the agent should not do.", questions: [
        yesno("bank", "Banking powers", { default: true }),
        text("banks", "Which banks", { showIf: { id: "bank", equals: true }, required: true, placeholder: "e.g. Bank of America, Baltimore branch" }),
        yesno("openClose", "Open and close accounts", { showIf: { id: "bank", equals: true }, default: true }),
        yesno("limitWithdraw", "Limit what the agent may withdraw or transfer in one transaction", { showIf: { id: "bank", equals: true }, default: true }),
        money("withdrawLimit", "Highest single withdrawal or transfer", { showIf: { id: "limitWithdraw", equals: true }, required: true }),
      ] },
      { title: "Operations, tax and licenses", questions: [
        yesno("operations", "Run daily operations — purchases, vendors, inventory, contracts, point-of-sale and merchant accounts", { default: true }),
        yesno("staff", "Hire, supervise, pay and let go of employees, and run payroll", { default: true }),
        yesno("tax", "Tax matters — prepare and file sales tax, payroll tax and income tax returns, pay taxes, receive notices and deal with tax offices", { default: true }),
        yesno("licenses", "Apply for, renew, change and close licenses and permits", { default: true }),
        yesno("borrow", "Borrow money, sign loans or credit applications for the business (owner approves each loan)", { default: false }),
        yesno("property", "Buy, sell or lease property or major equipment for the business (owner approves each deal)", { default: false }),
        yesno("ownership", "Sell the business, change who owns it, or add / remove owners (owner approves each step)", { default: false }),
        yesno("giveAway", "Give away or donate the business's money or property (owner approves each gift)", { default: false }),
        yesno("approval", "Anything above a set amount needs the owner's written approval first", { default: false }),
        money("approvalAmount", "Approval is needed above", { showIf: { id: "approval", equals: true }, required: true }),
      ] },
      { title: "How long, witnesses and notary", questions: [
        date("endDate", "Ends on (leave empty until cancelled)"),
        text("county", "County where it is signed", { placeholder: "e.g. Baltimore County" }),
        text("witness1", "First witness (printed name, optional)"),
        text("witness2", "Second witness (printed name, optional)"),
      ] },
    ],
    body: `BUSINESS POWER OF ATTORNEY

Date: {{effectiveDate}}

1. APPOINTMENT
{{company}}{{#if companyAddress}}, of {{companyAddress}}{{/if}}, {{#if entityType=llc}}a limited liability company{{/if}}{{#if entityType=corp}}a corporation{{/if}}{{#if entityType=partnership}}a partnership{{/if}}{{#if entityType=other}}a business entity{{/if}}{{#if formedIn}} formed in {{formedIn}}{{/if}}{{#if einLast4}} (EIN ending {{einLast4}}){{/if}} (the "Business"), acting through {{owner}}, its {{ownerTitle}}, appoints {{agent}}{{#if agentAddress}} of {{agentAddress}}{{/if}} ("Agent") as its attorney-in-fact to act for the Business and sign in its name in the matters listed below. {{owner}} confirms that this power is authorized by the Business's governing documents and, where required, by a resolution of its members or directors, and will give a copy of that resolution to any bank on request.

2. POWERS GIVEN
{{#if bank}}A. BANKING. {{#if banks}}At {{banks}}{{else}}At any bank or credit union{{/if}}, the Agent may{{#if openClose}} open and close accounts,{{/if}} deposit and withdraw money, write, sign and endorse checks, make transfers, wires and electronic payments, use and manage online banking and debit or credit cards of the Business, get statements and records, and sign the bank's forms and signature cards.{{#if limitWithdraw}} The Agent may not withdraw or transfer more than {{withdrawLimit}} in any one transaction.{{/if}}

{{/if}}{{#if operations}}B. DAILY OPERATIONS. The Agent may run the day-to-day business: buy goods and supplies, deal with vendors and customers, set up and use point-of-sale and merchant accounts, sign ordinary contracts and orders, manage inventory and premises, and keep the books and records.

{{/if}}{{#if staff}}C. STAFF AND PAYROLL. The Agent may hire, supervise, pay and end the employment of staff, and run payroll, including payroll deposits and filings.

{{/if}}{{#if tax}}D. TAX AND GOVERNMENT MATTERS. The Agent may prepare and file the Business's sales tax, payroll tax and income tax returns, sign them where the law allows an agent to sign, pay taxes, receive notices and correspondence, and deal with federal, state and local tax offices on the Business's behalf. This power does not let the Agent sign any return that the law requires an owner or officer to sign. For the Comptroller of Maryland the Business will also sign Maryland Form 548, and for the IRS Form 2848, naming the Agent; this document alone is not enough.

{{/if}}{{#if licenses}}E. LICENSES AND PERMITS. The Agent may apply for, renew, change and close licenses and permits of the Business.

{{/if}}{{#if borrow}}F. BORROWING. The Agent may borrow money for the Business and sign loan and credit documents in its name, but only with the written approval of {{owner}} or another owner of the Business for each loan.

{{/if}}{{#if property}}G. PROPERTY. The Agent may buy, sell or lease property and major equipment for the Business, but only with the written approval of {{owner}} or another owner of the Business for each transaction.

{{/if}}{{#if ownership}}H. SALE AND OWNERSHIP. The Agent may sell the Business or its assets, change who owns the Business, and add or remove owners, and sign the papers needed to do so, but only with the written approval of {{owner}} or another owner of the Business for each step.

{{/if}}{{#if giveAway}}I. GIFTS. The Agent may give away or donate the Business's money or property, but only with the written approval of {{owner}} or another owner of the Business for each gift.

{{/if}}{{#if !bank}}{{#if !operations}}{{#if !staff}}{{#if !tax}}{{#if !licenses}}{{#if !borrow}}{{#if !property}}{{#if !ownership}}{{#if !giveAway}}No power has been selected, so this document gives the Agent no authority until it is corrected and signed again.

{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}3. LIMITS
{{#if approval}}For any single purchase, payment, contract or commitment above {{approvalAmount}}, the Agent must first get the written approval of {{owner}} or another owner of the Business. {{/if}}{{#if bank}}{{#if limitWithdraw}}{{#if approval}}Where both the bank limit and the approval amount apply, the lower one controls. {{/if}}{{/if}}{{/if}}{{#if ownership}}{{else}}The Agent may not sell the Business or change who owns it, and may not add or remove owners. {{/if}}{{#if giveAway}}{{else}}The Agent may not give away the Business's money or property. {{/if}}No power is given beyond those listed above.

4. DUTIES
The Agent must act in the Business's best interest, keep its money separate from the Agent's own, keep records of what is done, and give the owners an account whenever they ask. The owners may inspect all accounts and records at any time. The Agent may not pay or benefit the Agent or the Agent's relatives from the Business except wages the owner has approved, may not hand this authority to anyone else, and must sign as "the Business, by the Agent, as attorney-in-fact". The Agent receives no pay for this authority unless the owner agrees in writing.

5. HOW LONG IT LASTS
This power starts when signed. {{#if endDate}}It ends on {{endDate}}, or earlier if the Business cancels it in writing.{{else}}It lasts until the Business cancels it in writing.{{/if}} It also ends automatically if the Agent stops working for the Business, or if the Business is sold or dissolved. Notice of cancellation must be given in writing to the Agent and to each bank or office relying on this document. The Agent may resign by written notice to the Business. People who rely on it in good faith are protected until they receive written notice that it has ended.

6. GENERAL
A copy of this document is as good as the original. It is governed by the laws of the State of {{state}}.

BUSINESS: {{company}}
By: {{owner}}, {{ownerTitle}}
Signature: ______________________________   Date: ______________

AGENT (accepting): {{agent}}
Signature: ______________________________   Date: ______________

WITNESSES (optional)
Each witness is an adult and was present when {{owner}} signed.
Witness 1: {{#if witness1}}{{witness1}}{{else}}______________{{/if}}   Signature: ______________________________
Witness 2: {{#if witness2}}{{witness2}}{{else}}______________{{/if}}   Signature: ______________________________

ACKNOWLEDGMENT BEFORE A NOTARY
State of Maryland, County of {{#if county}}{{county}}{{else}}______________{{/if}}
On ______________, before me, the undersigned notary public, personally appeared {{owner}}, known to me or satisfactorily proven to be the person who signed this document, who acknowledged being the {{ownerTitle}} of {{company}} and that, with authority to do so, they signed it voluntarily for that business.
Notary public signature and seal: ______________________________
Printed name: ______________________________
My commission expires: ______________`,
  },
  {
    key: "limited_poa_filings", title: "Limited Power of Attorney — Licenses, Permits & State Tax Filings", category: CLIENT_SERVICE,
    description: "A business names the firm to obtain its licenses, permits and records and to file its Maryland sales/use and withholding tax — only for the matters ticked, nothing more. Based on the firm's own POA template.",
    reviewNote: "This gives the firm authority to deal with offices for the business, but offices still require their own forms: the Maryland Comptroller accepts only its own Form 548 for tax accounts (the IRS uses Form 2848 / 8821), and the Maryland Division of Unemployment Insurance has its own employer power-of-attorney form filed through its portal. Some offices ask for a notarized power, so the notary block is always included. Confirm with an attorney, before relying on this for them: (1) whether the USDA SNAP/EBT retailer application and the State Department of Assessments and Taxation annual report must be signed by the owner or officer personally; (2) whether the county and the health department accept an agent applying for an occupancy or food permit; (3) whether this power is valid beyond one year for a given office. The telephone numbers and e-mail address pre-filled below are the firm's own — check they are current. Have a Maryland attorney review before use.",
    steps: [
      { title: "The business", questions: [
        text("principal", "Business giving the authority", { prefill: "clientName", required: true }),
        text("entityDesc", "Kind of business", { placeholder: "e.g. a Maryland limited liability company" }),
        text("principalAddress", "Business street address", { prefill: "clientAddress", required: true }),
        text("acctRef", "Account / license numbers covered (last 4 digits only)", { placeholder: "e.g. Sales tax account ending 1234; tobacco license ending 5678" }),
        text("signerName", "Owner / officer signing for the business", { required: true }),
        text("signerTitle", "Their title", { required: true, default: "Owner", placeholder: "e.g. Owner, Managing Member, President" }),
      ] },
      { title: "The firm (Attorney-in-Fact)", questions: [
        text("firmName", "Firm", { prefill: "firmName", required: true }), text("firmAddress", "Firm address", { prefill: "firmAddress" }), text("firmEmail", "Firm email", { default: "altax70@gmail.com" }),
        text("rep1", "First representative", { required: true, default: "MR. ABDULSAMAD ALMABARI" }), text("rep1Phone", "Their telephone", { default: "+1 (443) 825-8804" }),
        text("rep2", "Second representative (optional)", { default: "MR. HESHAM A. ALMABARI" }), text("rep2Phone", "Their telephone", { default: "+1 (443) 835-4492" }),
      ] },
      { title: "What the firm may do", description: "Tick only what this client needs.", questions: [
        yesno("pSales", "Obtain, renew, amend or close the Sales and Use Tax license", { default: true }),
        yesno("pArticles", "Obtain copies of the Articles of Incorporation / Organization and other business records (State Department of Assessments and Taxation)", { default: true }),
        yesno("pEbt", "Apply for or maintain the EBT / SNAP permit", { default: true }),
        yesno("pFile", "File Maryland sales and use tax and withholding tax returns and make the payments", { default: true }),
        yesno("pOccupancy", "Apply for and obtain a new occupancy permit", { default: true }),
        yesno("pTobacco", "Tobacco / cigarette retail license — apply, renew or amend", { default: false }),
        yesno("pHealth", "Health department or food service permit", { default: false }),
        yesno("pLocal", "Local business, trader's and other county or city licenses", { default: false }),
        yesno("pAnnual", "Annual report and personal property return with the State Department of Assessments and Taxation", { default: false }),
        yesno("pUI", "Maryland unemployment insurance account matters", { default: false }),
        area("other", "Anything else (one matter per line)"),
        yesno("signDocs", "The firm may sign applications, forms and letters in the business's name, only as needed for the matters above", { default: true }),
      ] },
      { title: "Term and signing", questions: [
        date("endDate", "Ends on (leave empty — it then ends one year after it is signed)"),
        text("county", "County where it is signed (for the notary)", { placeholder: "e.g. Baltimore City" }),
        effective(), state(),
      ] },
    ],
    body: `LIMITED POWER OF ATTORNEY
Licenses, Permits and State Tax Filings

Date: {{effectiveDate}}

1. APPOINTMENT
{{principal}}{{#if entityDesc}}, {{entityDesc}},{{/if}} with street address {{principalAddress}} (the "Principal"), acting through {{signerName}}, its {{signerTitle}}, grants a limited and specific power of attorney to {{firmName}}{{#if firmAddress}}, {{firmAddress}}{{/if}} (the "Attorney-in-Fact"), which may act through its representatives {{rep1}}{{#if rep2}} and {{rep2}}, either of whom may act for it{{/if}}. {{signerName}} confirms having the authority to give this power on behalf of the Principal.

2. POWERS GIVEN
The Attorney-in-Fact may act for the Principal, and deal with the offices concerned, only for these purposes:
{{#if pSales}}• Obtain, renew, amend or close the Principal's Sales and Use Tax license.
{{/if}}{{#if pArticles}}• Obtain copies of the Principal's Articles of Incorporation / Organization and other business records from the State Department of Assessments and Taxation.
{{/if}}{{#if pEbt}}• Apply for or maintain the Principal's EBT / SNAP permit.
{{/if}}{{#if pFile}}• Prepare and file the Principal's Maryland sales and use tax and withholding tax returns and make the related payments.
{{/if}}{{#if pOccupancy}}• Apply for and obtain a new occupancy permit from the relevant authorities.
{{/if}}{{#if pTobacco}}• Apply for, renew or amend the Principal's tobacco / cigarette retail license.
{{/if}}{{#if pHealth}}• Apply for and maintain the Principal's health department or food service permit.
{{/if}}{{#if pLocal}}• Apply for, renew or amend the Principal's local business, trader's and other county or city licenses.
{{/if}}{{#if pAnnual}}• File the Principal's annual report and personal property return with the State Department of Assessments and Taxation.
{{/if}}{{#if pUI}}• Handle the Principal's Maryland unemployment insurance account matters, using the Division's own authorization form where it requires one.
{{/if}}{{#if other}}• {{other}}
{{/if}}{{#if !pSales}}{{#if !pArticles}}{{#if !pEbt}}{{#if !pFile}}{{#if !pOccupancy}}{{#if !pTobacco}}{{#if !pHealth}}{{#if !pLocal}}{{#if !pAnnual}}{{#if !pUI}}{{#if !other}}• No purpose has been selected, so this document gives the Attorney-in-Fact no power until it is corrected and signed again.
{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{#if acctRef}}Accounts and licenses covered (last four digits only): {{acctRef}}.
{{/if}}The Attorney-in-Fact may also handle all related communications for the Principal and do the incidental acts reasonably needed to carry out these purposes.

3. SIGNING
{{#if signDocs}}The Attorney-in-Fact may sign applications, forms, agreements and letters in the Principal's name, but only as needed for the purposes in Section 2.{{else}}The Attorney-in-Fact may prepare and submit documents for the Principal but may not sign them in the Principal's name.{{/if}}

4. LIMITS
This power does not include the power to sell or mortgage the business or its property, borrow money, open or close bank accounts, sign checks or withdraw funds, change the ownership of the business, make gifts, or sign any contract other than those needed for the purposes in Section 2. Taxes and fees are paid only by the Principal's own payment authorization (an electronic debit the Principal approves or a check the Principal signs); the Attorney-in-Fact never holds the Principal's funds or bank login.

5. OFFICIAL FORMS
Some offices accept only their own authorization form (for example Maryland Comptroller Form 548, the Maryland Division of Unemployment Insurance power of attorney form, or IRS Form 2848). The Principal will sign those forms when asked, and for each such office its form governs. This document does not replace them.

6. PRINCIPAL'S RESPONSIBILITIES
The Principal will give accurate and complete information, remains responsible for the taxes, fees, penalties and interest of the business, and will personally sign any application or return that the law or the office requires an owner or officer to sign.

7. DUTIES
The Attorney-in-Fact accepts this appointment on these terms and will act in the Principal's best interest and only within these powers, keep records of what it does, give the Principal copies of every filing, license, permit and notice, and keep the Principal's information confidential, using it only for these purposes.

8. WHEN IT STARTS AND ENDS
This power takes effect when it is signed and ends {{#if endDate}}on {{endDate}}{{else}}one year after the date it is signed{{/if}}, or earlier when the Attorney-in-Fact's engagement for the Principal ends. The Principal may revoke it at any time by written notice to the Attorney-in-Fact. When it receives that notice it will stop acting and promptly return all documents, funds and property belonging to the Principal. The Attorney-in-Fact may resign by written notice to the Principal.

9. COPIES AND RELIANCE
A copy of this document is as good as the original. An office or person who relies on it in good faith may keep relying on it until they receive written notice that it has ended.

10. GOVERNING LAW
This power of attorney is governed by the laws of the State of {{state}}.

PRINCIPAL: {{principal}}
By: {{signerName}}, {{signerTitle}}
Signature: ______________________________   Date: ______________

ACCEPTANCE OF APPOINTMENT
I, {{rep1}}, sign for {{firmName}} as its authorized representative and accept this appointment in accordance with the foregoing instrument.
{{firmName}}{{#if firmAddress}}, {{firmAddress}}{{/if}}{{#if rep1Phone}}, {{rep1Phone}}{{/if}}{{#if firmEmail}}, {{firmEmail}}{{/if}}
Signature: ______________________________   Date: ______________
{{#if rep2}}
I, {{rep2}}, sign for {{firmName}} as its authorized representative and accept this appointment in accordance with the foregoing instrument.
{{firmName}}{{#if firmAddress}}, {{firmAddress}}{{/if}}{{#if rep2Phone}}, {{rep2Phone}}{{/if}}{{#if firmEmail}}, {{firmEmail}}{{/if}}
Signature: ______________________________   Date: ______________
{{/if}}
ACKNOWLEDGMENT BEFORE A NOTARY
State of Maryland, County of {{#if county}}{{county}}{{else}}______________{{/if}}
On ______________, before me, the undersigned notary public, personally appeared {{signerName}}, known to me or satisfactorily proven to be the person who signed this document for {{principal}}, and acknowledged that they signed it voluntarily for the purposes stated in it, with authority to do so.
Notary public signature and seal: ______________________________
Printed name: ______________________________
My commission expires: ______________`,
  },
];

export function getDocTemplate(key: string): DocTemplate | undefined { return DOC_TEMPLATES.find((t) => t.key === key); }
