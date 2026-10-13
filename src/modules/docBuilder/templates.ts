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

export const DOC_TEMPLATES: DocTemplate[] = [
  /* ─────────────── Client services ─────────────── */
  {
    key: "fee_agreement", title: "Fee Agreement", category: CLIENT_SERVICE,
    description: "Spells out what the firm will do, what it costs and when it is paid.",
    steps: [
      { title: "Parties", questions: [text("clientName", "Client name", { prefill: "clientName", required: true }), text("clientAddress", "Client address", { prefill: "clientAddress" }), text("firmName", "Firm name", { prefill: "firmName", required: true }), effective()] },
      { title: "Services", questions: [area("services", "Services covered", { required: true, placeholder: "e.g. Monthly bookkeeping, sales tax filings and payroll filings" }), text("period", "Period or tax year covered", { placeholder: "e.g. Calendar year 2026" })] },
      { title: "Fees", questions: [
        pick("feeType", "How are fees charged?", [["flat", "One flat fee"], ["monthly", "A monthly fee"], ["hourly", "By the hour"]], { required: true, default: "flat" }),
        money("amount", "Amount", { required: true, help: "The flat fee, the monthly fee, or the hourly rate." }),
        num("dueDays", "Invoices are due within (days)", { default: "15", required: true }),
        yesno("retainer", "Is a retainer or deposit required up front?"),
        money("retainerAmount", "Retainer amount", { showIf: { id: "retainer", equals: true }, required: true }),
        yesno("lateFee", "Charge a late fee on overdue invoices?"),
        num("lateFeePercent", "Late fee (% per month)", { showIf: { id: "lateFee", equals: true }, default: "1.5", required: true }),
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
{{#if feeType=flat}}The Client will pay a flat fee of {{amount}} for the services above.{{/if}}{{#if feeType=monthly}}The Client will pay a fee of {{amount}} per month for the services above.{{/if}}{{#if feeType=hourly}}The Client will pay {{amount}} per hour for time spent on the services above, billed as the work is done.{{/if}}
{{#if retainer}}A retainer of {{retainerAmount}} is due before work begins and will be applied to the Firm's invoices.{{/if}}

3. PAYMENT
Invoices are due within {{dueDays}} days of the invoice date.{{#if lateFee}} Balances unpaid after the due date may be charged a late fee of {{lateFeePercent}}% per month.{{/if}} The Firm may pause work while an invoice is overdue.

4. CLIENT RESPONSIBILITIES
The Client will provide complete and accurate records and information promptly, and is responsible for the accuracy of what the Client supplies.

5. TERMINATION
Either party may end this agreement by written notice. The Client remains responsible for fees for work already performed.

6. GOVERNING LAW
This agreement is governed by the laws of the State of {{state}}.

Client: {{clientName}}
Signature: ______________________________   Date: ______________

For {{firmName}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "engagement_letter", title: "Engagement Letter", category: CLIENT_SERVICE,
    description: "A custom-scope letter confirming what the firm will and will not do for a client.",
    steps: [
      { title: "Engagement", questions: [text("clientName", "Client name", { prefill: "clientName", required: true }), text("firmName", "Firm name", { prefill: "firmName", required: true }), effective(),
        area("scope", "What the firm will do", { required: true }), area("exclusions", "What is not included", { placeholder: "e.g. Audit or review services, legal advice, representation before the IRS unless separately authorized" }),
        text("period", "Period or tax year", { placeholder: "e.g. Tax year 2025" })] },
      { title: "Terms", questions: [
        pick("term", "How long does this engagement last?", [["completion", "Until the work is finished"], ["ongoing", "Ongoing until either side ends it"], ["fixed", "Until a set date"]], { required: true, default: "completion" }),
        date("endDate", "End date", { showIf: { id: "term", equals: "fixed" }, required: true }),
        text("feeSummary", "Fees (as agreed)", { placeholder: "e.g. $450 flat fee, billed on completion" }),
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

{{#if exclusions}}WHAT IS NOT INCLUDED
{{exclusions}}

{{/if}}YOUR RESPONSIBILITIES
You agree to give us complete, accurate and timely information and records, to review the work we prepare before it is filed or relied on, and to tell us promptly about changes that affect it. We rely on the information you provide and do not audit or independently verify it.

FEES
{{#if feeSummary}}{{feeSummary}}{{else}}Our fees will be as quoted to you separately.{{/if}}

DURATION
{{#if term=completion}}This engagement ends when the work described above is finished.{{/if}}{{#if term=ongoing}}This engagement continues until either of us ends it by written notice.{{/if}}{{#if term=fixed}}This engagement ends on {{endDate}} unless we agree in writing to extend it.{{/if}}

GOVERNING LAW
This engagement is governed by the laws of the State of {{state}}.

If this correctly states our agreement, please sign and return a copy.{{#if contact}} Questions can be directed to {{contact}}.{{/if}}

Sincerely,
{{firmName}}

Agreed and accepted:
{{clientName}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "authorization_release", title: "Authorization to Release Information", category: CLIENT_SERVICE,
    description: "Lets the firm share specific client records with a named person or company. (For IRS or Maryland tax representation use the 2848 / 8821 / 548 tools.)",
    reviewNote: "This is not the IRS Form 2848/8821 or Maryland Form 548 — those must be on the official forms.",
    steps: [
      { title: "Who and what", questions: [text("clientName", "Client name", { prefill: "clientName", required: true }), text("firmName", "Firm name", { prefill: "firmName", required: true }), effective(),
        text("recipient", "Share information with (person or company)", { required: true }), text("recipientAddress", "Their address or email"),
        area("information", "Information that may be shared", { required: true, placeholder: "e.g. Tax returns and financial statements for 2024 and 2025" }),
        area("purpose", "Purpose", { required: true, placeholder: "e.g. Loan application with First Bank" }),
        pick("duration", "How long does this authorization last?", [["date", "Until a date"], ["onetime", "One time only"], ["revoked", "Until I cancel it in writing"]], { required: true, default: "date" }),
        date("expires", "Expires on", { showIf: { id: "duration", equals: "date" }, required: true })] },
    ],
    body: `AUTHORIZATION TO RELEASE INFORMATION

I, {{clientName}}, authorize {{firmName}} to release the information described below to:

{{recipient}}{{#if recipientAddress}}
{{recipientAddress}}{{/if}}

INFORMATION THAT MAY BE SHARED
{{information}}

PURPOSE
{{purpose}}

DURATION
{{#if duration=date}}This authorization is effective {{effectiveDate}} and expires on {{expires}}.{{/if}}{{#if duration=onetime}}This authorization is effective {{effectiveDate}} and covers a single release of the information above.{{/if}}{{#if duration=revoked}}This authorization is effective {{effectiveDate}} and stays in force until I cancel it by written notice to {{firmName}}.{{/if}}

I understand that I may cancel this authorization at any time by written notice, except for information already released. {{firmName}} is not responsible for how the recipient uses the information after it is released. This authorization does not allow {{firmName}} to act on my behalf before any tax authority.

{{clientName}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "termination_of_services", title: "Termination of Services Letter", category: CLIENT_SERVICE,
    description: "Formally ends the working relationship with a client and sets out what happens to records and balances.",
    steps: [
      { title: "Details", questions: [text("clientName", "Client name", { prefill: "clientName", required: true }), text("firmName", "Firm name", { prefill: "firmName", required: true }), effective(),
        pick("endedBy", "Who is ending the relationship?", [["firm", "The firm"], ["client", "The client"]], { required: true, default: "firm" }),
        date("lastDay", "Last day of service", { required: true }),
        text("reason", "Reason (optional)"),
        yesno("balance", "Is there an unpaid balance?"), money("balanceAmount", "Balance owed", { showIf: { id: "balance", equals: true }, required: true }),
        yesno("records", "Are the client's records being returned with this letter?", { default: true }),
        area("pending", "Work still open or deadlines the client should know about", { placeholder: "e.g. The Q3 sales tax return is due October 20; the client must file it or engage another preparer." })] },
    ],
    body: `{{effectiveDate}}

{{clientName}}

Re: Ending of services

Dear {{clientName}},

{{#if endedBy=firm}}{{firmName}} is ending its professional services for you effective {{lastDay}}.{{else}}This confirms that {{clientName}} has ended its engagement with {{firmName}} effective {{lastDay}}.{{/if}}{{#if reason}} {{reason}}{{/if}}

After {{lastDay}} we will no longer prepare, file or monitor anything on your behalf, including tax filings, payroll filings, reports or payments.

{{#if pending}}OPEN ITEMS AND DEADLINES
{{pending}}

{{/if}}{{#if balance}}OUTSTANDING BALANCE
Our records show an unpaid balance of {{balanceAmount}}, which remains due.

{{/if}}RECORDS
{{#if records}}Your records are returned with this letter. Please keep them; you are responsible for retaining copies as required by law.{{else}}Please contact us to arrange the return of your records.{{/if}}

We appreciate the opportunity to have served you.

Sincerely,
{{firmName}}`,
  },
  {
    key: "document_request_letter", title: "Document Request Letter", category: CLIENT_SERVICE,
    description: "A clear list of the documents a client still needs to send, with a due date.",
    steps: [
      { title: "Request", questions: [text("clientName", "Client name", { prefill: "clientName", required: true }), text("firmName", "Firm name", { prefill: "firmName", required: true }), effective(),
        text("purpose", "What the documents are needed for", { required: true, placeholder: "e.g. your 2025 tax return" }), date("dueDate", "Please send by", { required: true }),
        list("items", "Documents needed", [text("doc", "Document", { required: true }), text("note", "Note (optional)")], { required: true, addLabel: "Add a document" }),
        text("how", "How to send them", { default: "Upload them to your client portal under Documents, or email them to us." })] },
    ],
    body: `{{effectiveDate}}

{{clientName}}

Re: Documents needed for {{purpose}}

Dear {{clientName}},

To complete {{purpose}}, we need the following from you by {{dueDate}}:

{{#list items}}{{n}}. {{doc}}{{#if note}} — {{note}}{{/if}}
{{/list}}
{{how}}

If any item does not apply, or you are not sure what we mean, please tell us and we will help. Delays in sending these may delay your filing and could result in penalties or interest.

Thank you,
{{firmName}}`,
  },

  /* ─────────────── Business formation & ownership ─────────────── */
  {
    key: "llc_operating_agreement", title: "LLC Operating Agreement", category: BUSINESS,
    description: "Sets out who owns an LLC, how it is run, how profits are shared and how an owner can leave.",
    reviewNote: "Have an attorney review an operating agreement before the members sign it, especially for multi-member LLCs.",
    steps: [
      { title: "The company", questions: [text("companyName", "LLC name", { prefill: "clientName", required: true }), state({ id: "formedIn", label: "State where the LLC is formed" } as Partial<Question>), date("formationDate", "Date formed", { required: true }), text("address", "Principal address", { prefill: "clientAddress", required: true }), text("purpose", "Business purpose", { default: "any lawful business" })] },
      { title: "Members", questions: [list("members", "Members (owners)", [text("name", "Name", { required: true }), text("address", "Address"), money("contribution", "Capital contributed", { required: true }), num("percent", "Ownership %", { required: true })], { required: true, addLabel: "Add a member" })] },
      { title: "How it runs", questions: [
        pick("management", "Who manages the LLC?", [["members", "All members together (member-managed)"], ["manager", "A named manager (manager-managed)"]], { required: true, default: "members" }),
        text("manager", "Manager's name", { showIf: { id: "management", equals: "manager" }, required: true }),
        pick("taxClass", "How is the LLC taxed?", [["disregarded", "Single-member (disregarded entity)"], ["partnership", "Partnership"], ["scorp", "S corporation"]], { required: true, default: "partnership" }),
        pick("distributions", "How are profits shared?", [["percent", "In proportion to ownership percentages"], ["equal", "Equally"]], { required: true, default: "percent" }),
        text("fiscalYear", "Fiscal year ends", { default: "December 31" }),
        yesno("consentToTransfer", "Require the other members' consent before an interest is sold or transferred?", { default: true }),
        num("noticeDays", "Days of written notice to leave or sell", { default: "60", required: true }),
        state(),
      ] },
    ],
    body: `OPERATING AGREEMENT OF {{companyName}}

This Operating Agreement is made on {{effectiveDate}} by the members listed below for {{companyName}} (the "Company"), a limited liability company formed under the laws of {{formedIn}} on {{formationDate}}.

1. FORMATION AND PURPOSE
The Company's principal office is {{address}}. Its purpose is {{purpose}}. The Company continues until dissolved under this Agreement.

2. MEMBERS, CAPITAL AND OWNERSHIP
{{#list members}}{{n}}. {{name}}{{#if address}}, {{address}}{{/if}} — capital contribution {{contribution}}; ownership {{percent}}%
{{/list}}
No member is required to contribute more capital unless all members agree. A member's ownership percentage changes only by written agreement of all members.

3. MANAGEMENT
{{#if management=members}}The Company is managed by its members. Ordinary decisions are made by members holding a majority of ownership percentages. Selling the business, admitting a new member, borrowing beyond ordinary needs, or amending this Agreement requires every member's written consent.{{/if}}{{#if management=manager}}The Company is managed by {{manager}} as manager, who may make ordinary decisions. Selling the business, admitting a new member, borrowing beyond ordinary needs, or amending this Agreement requires every member's written consent.{{/if}}

4. TAX TREATMENT AND DISTRIBUTIONS
{{#if taxClass=disregarded}}The Company is a disregarded entity for federal income tax purposes.{{/if}}{{#if taxClass=partnership}}The Company is taxed as a partnership for federal income tax purposes.{{/if}}{{#if taxClass=scorp}}The Company has elected, or will elect, to be taxed as an S corporation for federal income tax purposes.{{/if}} Profits, losses and distributions are allocated {{#if distributions=percent}}in proportion to the members' ownership percentages{{else}}equally among the members{{/if}}. The Company's fiscal year ends {{fiscalYear}}. Books and records are kept at the principal office and are open to every member.

5. TRANSFERS AND WITHDRAWAL
{{#if consentToTransfer}}No member may sell or transfer an interest without the written consent of the other members. {{/if}}A member who wishes to leave or sell must give at least {{noticeDays}} days' written notice, and the other members have the first right to buy the interest at a fair value agreed by the members or, failing agreement, set by an independent appraiser.

6. DISSOLUTION
The Company dissolves on the written agreement of all members or as required by law. After debts are paid, remaining assets are distributed to the members according to their ownership percentages.

7. LIABILITY AND INDEMNITY
Members are not personally liable for the Company's debts solely because they are members. The Company will indemnify members for acts done in good faith for the Company.

8. GENERAL
This Agreement is the members' entire agreement on its subject, may be amended only in writing signed by all members, and is governed by the laws of the State of {{state}}.

MEMBERS
{{#list members}}{{name}}
Signature: ______________________________   Date: ______________

{{/list}}`,
  },
  {
    key: "partnership_agreement", title: "General Partnership Agreement", category: BUSINESS,
    description: "Defines how partners share capital, profits, decisions and what happens if a partner leaves.",
    reviewNote: "Have an attorney review before signing. A general partnership makes each partner personally liable for the business's debts.",
    steps: [
      { title: "Business", questions: [text("businessName", "Partnership name", { prefill: "clientName", required: true }), text("address", "Business address", { prefill: "clientAddress" }), text("purpose", "What the business does", { required: true }), effective(), state()] },
      { title: "Partners", questions: [list("partners", "Partners", [text("name", "Name", { required: true }), text("address", "Address"), money("capital", "Capital contributed", { required: true }), num("share", "Profit & loss share %", { required: true })], { minItems: 2, required: true, addLabel: "Add a partner" })] },
      { title: "Terms", questions: [
        pick("decisions", "How are decisions made?", [["majority", "Majority of profit shares"], ["unanimous", "All partners must agree"]], { required: true, default: "majority" }),
        pick("draws", "Partner draws", [["none", "No regular draws"], ["monthly", "Monthly draws agreed by the partners"]], { default: "none" }),
        num("noticeDays", "Days of written notice to withdraw", { default: "90", required: true }),
        yesno("buyout", "Remaining partners may buy out a departing partner's interest", { default: true }),
      ] },
    ],
    body: `GENERAL PARTNERSHIP AGREEMENT

This Agreement is made on {{effectiveDate}} among the partners listed below to carry on business as {{businessName}}{{#if address}} at {{address}}{{/if}}.

1. PURPOSE
The partnership's business is: {{purpose}}.

2. PARTNERS, CAPITAL AND SHARES
{{#list partners}}{{n}}. {{name}}{{#if address}}, {{address}}{{/if}} — capital {{capital}}; shares {{share}}% of profits and losses
{{/list}}
Capital is not repaid or paid interest unless the partners agree in writing.

3. PROFITS, LOSSES AND DRAWS
Profits and losses are shared according to the percentages above. {{#if draws=monthly}}Partners may take monthly draws in amounts the partners agree, which are charged against their share of profits.{{else}}No partner takes regular draws unless the partners agree.{{/if}}

4. MANAGEMENT
Each partner may take part in managing the business. {{#if decisions=majority}}Decisions are made by partners holding a majority of the profit shares.{{else}}Decisions require the agreement of every partner.{{/if}} Borrowing outside the ordinary course, selling the business, or admitting a partner requires every partner's written consent.

5. BOOKS AND RECORDS
Accurate books are kept at the business address, are open to every partner, and the partnership's tax return is prepared at the end of each year.

6. WITHDRAWAL AND DEATH
A partner may withdraw on {{noticeDays}} days' written notice. {{#if buyout}}The remaining partners may buy the departing partner's interest at a fair value agreed by them or, failing agreement, set by an independent appraiser.{{else}}The partnership then winds up unless the remaining partners agree to continue.{{/if}}

7. DISSOLUTION
The partnership dissolves by agreement of all partners or as required by law. After debts are paid, any remainder is distributed according to capital and profit shares.

8. GENERAL
This Agreement is the partners' entire agreement, may be changed only in writing signed by all partners, and is governed by the laws of the State of {{state}}.

PARTNERS
{{#list partners}}{{name}}
Signature: ______________________________   Date: ______________

{{/list}}`,
  },
  {
    key: "profit_sharing_agreement", title: "Owner Profit-Sharing Agreement", category: BUSINESS,
    description: "How the owners of one business split profit, how often, and what is held back. Matches the 'Profit split' tool in the client portal.",
    steps: [
      { title: "Business and owners", questions: [text("businessName", "Business name", { prefill: "clientName", required: true }), effective(), state(),
        list("owners", "Owners and their share of profit", [text("name", "Name", { required: true }), num("percent", "Share %", { required: true })], { minItems: 2, required: true, addLabel: "Add an owner" })] },
      { title: "Rules", questions: [
        pick("frequency", "Profit is divided", [["weekly", "Weekly"], ["monthly", "Monthly"], ["quarterly", "Quarterly"]], { required: true, default: "monthly" }),
        num("reserve", "Keep this % of profit in the business as a reserve", { default: "0" }),
        pick("basis", "Profit means", [["net", "Net income after all business expenses and taxes owed by the business"], ["cash", "Cash left after expenses are paid"]], { required: true, default: "net" }),
        yesno("shareLoss", "Losses are shared in the same percentages", { default: true }),
        text("method", "How owners are paid", { default: "Bank transfer" }),
      ] },
    ],
    body: `OWNER PROFIT-SHARING AGREEMENT

This Agreement is made on {{effectiveDate}} among the owners of {{businessName}} (the "Business").

1. OWNERS AND SHARES
{{#list owners}}{{n}}. {{name}} — {{percent}}% of profit
{{/list}}
The shares above total 100%.

2. WHAT IS PROFIT
Profit means {{#if basis=net}}net income after all business expenses and any taxes owed by the Business{{else}}the cash left after the Business's expenses have been paid{{/if}}, as shown in the Business's books for the period.

3. WHEN AND HOW PROFIT IS PAID
Profit is divided {{frequency}}. {{#if reserve}}Before dividing, {{reserve}}% of the profit stays in the Business as a reserve. {{/if}}Each owner is paid by {{method}} within a reasonable time after the period's books are closed.

4. LOSSES
{{#if shareLoss}}Losses are shared by the owners in the same percentages.{{else}}Losses are handled as the owners agree in writing.{{/if}}

5. RECORDS
The Business keeps its books accurately and gives every owner access to them. Disputes about the numbers are first discussed by the owners and, if unresolved, reviewed by the Business's accountant.

6. CHANGES
This Agreement may be changed only in writing signed by all owners, and is governed by the laws of the State of {{state}}.

OWNERS
{{#list owners}}{{name}}
Signature: ______________________________   Date: ______________

{{/list}}`,
  },
  {
    key: "business_bill_of_sale", title: "Bill of Sale — Business Assets", category: BUSINESS,
    description: "Records the sale of a business or its assets from one party to another.",
    reviewNote: "A business sale can have licensing, tax and lease consequences — have these confirmed before signing.",
    steps: [
      { title: "Parties", questions: [text("seller", "Seller", { required: true }), text("sellerAddress", "Seller's address"), text("buyer", "Buyer", { required: true }), text("buyerAddress", "Buyer's address"), text("businessName", "Business being sold", { prefill: "clientName", required: true }), effective(), state()] },
      { title: "The sale", questions: [
        area("assets", "Assets included", { required: true, placeholder: "e.g. Inventory, fixtures, equipment, customer lists, trade name, lease rights" }),
        area("excluded", "Assets or items not included"),
        money("price", "Purchase price", { required: true }),
        pick("payment", "How is it paid?", [["full", "In full at signing"], ["installments", "In installments"]], { required: true, default: "full" }),
        text("installmentTerms", "Installment terms", { showIf: { id: "payment", equals: "installments" }, required: true, placeholder: "e.g. $5,000 down, then $1,000 on the 1st of each month for 20 months" }),
        yesno("liabilities", "Buyer takes on the business's existing debts"), area("liabilityList", "Debts the buyer takes on", { showIf: { id: "liabilities", equals: true } }),
      ] },
    ],
    body: `BILL OF SALE

On {{effectiveDate}}, {{seller}}{{#if sellerAddress}} of {{sellerAddress}}{{/if}} ("Seller") sells to {{buyer}}{{#if buyerAddress}} of {{buyerAddress}}{{/if}} ("Buyer") the assets of the business known as {{businessName}}.

1. ASSETS SOLD
{{assets}}
{{#if excluded}}
EXCLUDED
{{excluded}}
{{/if}}
2. PRICE AND PAYMENT
The purchase price is {{price}}. {{#if payment=full}}It is paid in full at signing.{{else}}It is paid as follows: {{installmentTerms}}{{/if}}

3. DEBTS
{{#if liabilities}}Buyer takes on the following business debts: {{liabilityList}} All other debts of the business remain Seller's responsibility.{{else}}Buyer does not take on any debts of the business; all debts incurred before the sale date remain Seller's responsibility.{{/if}}

4. SELLER'S STATEMENTS
Seller states that Seller owns the assets, has the right to sell them, and that they are free of liens and claims except as disclosed in writing. The assets are sold as-is except for these statements.

5. GENERAL
This Bill of Sale is governed by the laws of the State of {{state}}.

SELLER: {{seller}}
Signature: ______________________________   Date: ______________

BUYER: {{buyer}}
Signature: ______________________________   Date: ______________`,
  },

  /* ─────────────── Employment & payroll ─────────────── */
  {
    key: "offer_letter", title: "Offer of Employment Letter", category: EMPLOYMENT,
    description: "Offers a position with pay, schedule and start date, and states that employment is at will.",
    steps: [
      { title: "Position", questions: [text("employer", "Employer", { prefill: "clientName", required: true }), text("employee", "Employee name", { required: true }), text("employeeAddress", "Employee address"), effective(),
        text("position", "Job title", { required: true }), text("supervisor", "Reports to"), date("startDate", "Start date", { required: true }), text("location", "Work location", { prefill: "clientAddress" })] },
      { title: "Pay and schedule", questions: [
        pick("payType", "Pay is", [["hourly", "Hourly"], ["salary", "Salary"]], { required: true, default: "hourly" }),
        money("rate", "Hourly rate or annual salary", { required: true }),
        text("schedule", "Expected schedule", { placeholder: "e.g. 40 hours per week, Monday–Friday" }),
        pick("payFrequency", "Paid", [["weekly", "Weekly"], ["biweekly", "Every two weeks"], ["semimonthly", "Twice a month"], ["monthly", "Monthly"]], { default: "biweekly" }),
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
You will be paid {{#if payType=hourly}}{{rate}} per hour{{else}}a salary of {{rate}} per year{{/if}}, {{payFrequency}}, less required tax withholding and any deductions you authorize in writing.{{#if schedule}} Your expected schedule is {{schedule}}.{{/if}}
{{#if benefits}}
BENEFITS AND OTHER TERMS
{{benefits}}
{{/if}}
AT-WILL EMPLOYMENT
Your employment is at will. Either you or {{employer}} may end it at any time, with or without cause or notice. This letter is not a contract for any fixed period.

BEFORE YOU START
You must complete Form W-4 and Form I-9 and give us documents showing your identity and authorization to work in the United States. This offer depends on completing those items.

This letter is governed by the laws of the State of {{state}}. To accept, sign below and return it by {{replyBy}}.

Sincerely,
{{employer}}

I accept this offer:
{{employee}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "contractor_agreement", title: "Independent Contractor Agreement", category: EMPLOYMENT,
    description: "Sets out services, pay and the independent-contractor relationship (not an employee).",
    reviewNote: "How the person actually works matters more than the label — confirm they meet the independent-contractor tests before relying on this.",
    steps: [
      { title: "Parties", questions: [text("company", "Company", { prefill: "clientName", required: true }), text("companyAddress", "Company address", { prefill: "clientAddress" }), text("contractor", "Contractor name", { required: true }), text("contractorAddress", "Contractor address"), effective(), state()] },
      { title: "Work and pay", questions: [
        area("services", "Services to be performed", { required: true }),
        date("startDate", "Start date", { required: true }), yesno("hasEnd", "The work has an end date"), date("endDate", "End date", { showIf: { id: "hasEnd", equals: true }, required: true }),
        pick("feeType", "Contractor is paid", [["fixed", "A fixed fee for the project"], ["hourly", "By the hour"]], { required: true, default: "fixed" }),
        money("fee", "Fee or hourly rate", { required: true }), num("payDays", "Invoices paid within (days)", { default: "30", required: true }),
        yesno("confidential", "Contractor keeps the company's information confidential", { default: true }),
        yesno("ownsWork", "The company owns the work the contractor produces", { default: true }),
      ] },
    ],
    body: `INDEPENDENT CONTRACTOR AGREEMENT

This Agreement is made on {{effectiveDate}} between {{company}}{{#if companyAddress}}, {{companyAddress}}{{/if}} ("Company") and {{contractor}}{{#if contractorAddress}}, {{contractorAddress}}{{/if}} ("Contractor").

1. SERVICES
Contractor will perform the following services: {{services}}

2. TERM
Work begins on {{startDate}}{{#if hasEnd}} and ends on {{endDate}}, unless ended earlier under this Agreement{{else}} and continues until either party ends it by written notice{{/if}}.

3. PAYMENT
Company will pay Contractor {{#if feeType=fixed}}a fixed fee of {{fee}} for the services{{else}}{{fee}} per hour for time worked{{/if}}. Contractor will send invoices and Company will pay each within {{payDays}} days of receiving it.

4. INDEPENDENT CONTRACTOR
Contractor is an independent contractor, not an employee. Contractor controls how and when the work is done, supplies their own tools, and may work for others. Company will not withhold taxes or provide benefits. Contractor is responsible for their own taxes, insurance and licenses, and will provide a completed Form W-9; Company will report payments on Form 1099-NEC where required.

{{#if confidential}}5. CONFIDENTIALITY
Contractor will keep Company's non-public business, client and financial information confidential and use it only for this work, during and after this Agreement.

{{/if}}{{#if ownsWork}}6. OWNERSHIP OF WORK
Work Contractor creates for Company under this Agreement belongs to Company once Company has paid for it.

{{/if}}7. ENDING THE AGREEMENT
Either party may end this Agreement on 14 days' written notice. Company pays for work performed up to the end date.

8. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}.

COMPANY: {{company}}
Signature: ______________________________   Date: ______________

CONTRACTOR: {{contractor}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "employment_termination_letter", title: "Employment Separation Letter", category: EMPLOYMENT,
    description: "Confirms the end of employment, final pay and the return of company property.",
    steps: [
      { title: "Separation", questions: [text("employer", "Employer", { prefill: "clientName", required: true }), text("employee", "Employee name", { required: true }), effective(),
        pick("type", "Type of separation", [["resignation", "Employee resigned"], ["termination", "Employer ended employment"], ["layoff", "Layoff"]], { required: true, default: "resignation" }),
        date("lastDay", "Last day of work", { required: true }), text("reason", "Reason (optional — keep it factual)"),
        date("finalPayDate", "Final paycheck will be paid on", { required: true }),
        yesno("accruedPay", "Final pay includes unused paid time off", { default: false }),
        yesno("property", "Employee must return company property", { default: true }), text("propertyList", "Property to return", { showIf: { id: "property", equals: true }, placeholder: "e.g. Keys, uniform, laptop" }),
        text("contact", "Contact for questions or records")] },
    ],
    body: `{{effectiveDate}}

{{employee}}

Re: End of employment

Dear {{employee}},

{{#if type=resignation}}This letter confirms that {{employer}} has accepted your resignation. Your last day of work is {{lastDay}}.{{/if}}{{#if type=termination}}This letter confirms that your employment with {{employer}} ends on {{lastDay}}.{{/if}}{{#if type=layoff}}This letter confirms that your position with {{employer}} is being eliminated and your last day of work is {{lastDay}}.{{/if}}{{#if reason}} {{reason}}{{/if}}

FINAL PAY
Your final paycheck, covering all wages earned through {{lastDay}}{{#if accruedPay}} and unused paid time off{{/if}}, less required withholdings, will be paid on {{finalPayDate}}.

{{#if property}}COMPANY PROPERTY
Please return the following on or before your last day: {{#if propertyList}}{{propertyList}}{{else}}all company property in your possession{{/if}}.

{{/if}}TAX FORMS AND RECORDS
Your Form W-2 will be sent to the address we have on file, so please keep it up to date with us.{{#if contact}} Questions can be sent to {{contact}}.{{/if}}

Sincerely,
{{employer}}`,
  },
  {
    key: "employment_verification_letter", title: "Employment Verification Letter", category: EMPLOYMENT,
    description: "Confirms that a person works (or worked) for the business — for a landlord, lender or agency.",
    steps: [
      { title: "Details", questions: [text("employer", "Employer", { prefill: "clientName", required: true }), text("employerAddress", "Employer address", { prefill: "clientAddress" }), text("employee", "Employee name", { required: true }), effective(),
        text("position", "Job title", { required: true }), date("startDate", "Employed since", { required: true }),
        yesno("current", "Still employed", { default: true }), date("endDate", "Employment ended", { showIf: { id: "current", equals: false }, required: true }),
        pick("status", "Status", [["fulltime", "Full-time"], ["parttime", "Part-time"], ["seasonal", "Seasonal"]], { default: "fulltime" }),
        yesno("includePay", "Include pay information", { default: false }), money("pay", "Pay amount", { showIf: { id: "includePay", equals: true }, required: true }),
        pick("payPer", "Per", [["hour", "Hour"], ["week", "Week"], ["month", "Month"], ["year", "Year"]], { showIf: { id: "includePay", equals: true }, default: "year" }),
        text("signer", "Signed by (name and title)", { required: true }), text("phone", "Phone for verification", { prefill: "clientPhone" })] },
    ],
    body: `{{effectiveDate}}

To whom it may concern:

This letter confirms that {{employee}} {{#if current}}is employed{{else}}was employed{{/if}} by {{employer}} as a {{status}} {{position}}, {{#if current}}since {{startDate}}{{else}}from {{startDate}} to {{endDate}}{{/if}}.

{{#if includePay}}{{employee}}'s pay is {{pay}} per {{payPer}}.

{{/if}}This information is provided at the employee's request. {{#if phone}}To verify, please call {{phone}}.{{/if}}

Sincerely,

{{signer}}
{{employer}}{{#if employerAddress}}
{{employerAddress}}{{/if}}`,
  },

  /* ─────────────── Lending, lease & general ─────────────── */
  {
    key: "promissory_note", title: "Promissory Note", category: LENDING,
    description: "A written promise to repay a loan, with interest, payments and what happens if payments are missed.",
    reviewNote: "Interest rates and fees on loans are limited by law; confirm the rate is allowed before signing.",
    steps: [
      { title: "Parties", questions: [text("lender", "Lender", { required: true }), text("lenderAddress", "Lender's address"), text("borrower", "Borrower", { required: true }), text("borrowerAddress", "Borrower's address"), effective(), state()] },
      { title: "Loan", questions: [
        money("principal", "Amount borrowed", { required: true }), num("rate", "Annual interest rate (%)", { required: true, default: "0" }),
        pick("schedule", "Repayment", [["monthly", "Equal monthly payments"], ["lump", "One payment on the due date"]], { required: true, default: "monthly" }),
        num("months", "Number of monthly payments", { showIf: { id: "schedule", equals: "monthly" }, required: true }), date("firstPayment", "First payment due", { showIf: { id: "schedule", equals: "monthly" }, required: true }),
        date("dueDate", "Final due date", { required: true }),
        yesno("lateFee", "Charge a late fee"), money("lateFeeAmount", "Late fee", { showIf: { id: "lateFee", equals: true }, required: true }),
        yesno("secured", "The loan is secured by property"), text("collateral", "Describe the property", { showIf: { id: "secured", equals: true }, required: true }),
        yesno("prepay", "Borrower may repay early without penalty", { default: true }),
      ] },
    ],
    body: `PROMISSORY NOTE

Date: {{effectiveDate}}
Principal: {{principal}}

1. PROMISE TO PAY
For value received, {{borrower}}{{#if borrowerAddress}} of {{borrowerAddress}}{{/if}} ("Borrower") promises to pay {{lender}}{{#if lenderAddress}} of {{lenderAddress}}{{/if}} ("Lender") {{principal}}, with interest at {{rate}}% per year on the unpaid balance.

2. PAYMENTS
{{#if schedule=monthly}}Borrower will make {{months}} equal monthly payments of principal and interest, beginning {{firstPayment}}, with the final payment due {{dueDate}}.{{else}}Borrower will pay the full principal and accrued interest in one payment on {{dueDate}}.{{/if}} Payments are applied first to interest, then to principal.

3. LATE PAYMENT
{{#if lateFee}}A payment more than 10 days late is subject to a late fee of {{lateFeeAmount}}. {{/if}}If any payment is more than 30 days late, Lender may declare the whole unpaid balance due immediately.

4. PREPAYMENT
{{#if prepay}}Borrower may pay all or part of the balance early at any time without penalty.{{else}}Early payment requires Lender's written consent.{{/if}}

{{#if secured}}5. SECURITY
This note is secured by: {{collateral}}. If Borrower defaults, Lender may exercise the rights the law gives a secured lender.

{{/if}}6. GENERAL
If Lender must collect this note, Borrower pays reasonable collection costs. This note is governed by the laws of the State of {{state}}.

BORROWER: {{borrower}}
Signature: ______________________________   Date: ______________

LENDER: {{lender}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "nda_mutual", title: "Mutual Non-Disclosure Agreement", category: LENDING,
    description: "Two parties agree to keep each other's confidential information private.",
    steps: [
      { title: "Parties", questions: [text("partyA", "First party", { prefill: "clientName", required: true }), text("partyAAddress", "First party's address", { prefill: "clientAddress" }), text("partyB", "Second party", { required: true }), text("partyBAddress", "Second party's address"), effective(), state()] },
      { title: "Terms", questions: [area("purpose", "Why information is being shared", { required: true, placeholder: "e.g. Discussing a possible purchase of the business" }), num("years", "Confidentiality lasts (years)", { default: "3", required: true })] },
    ],
    body: `MUTUAL NON-DISCLOSURE AGREEMENT

This Agreement is made on {{effectiveDate}} between {{partyA}}{{#if partyAAddress}}, {{partyAAddress}}{{/if}}, and {{partyB}}{{#if partyBAddress}}, {{partyBAddress}}{{/if}} (each a "Party").

1. PURPOSE
The Parties will share confidential information for this purpose: {{purpose}} (the "Purpose").

2. CONFIDENTIAL INFORMATION
"Confidential Information" is non-public information one Party gives the other, in any form, that is marked confidential or that a reasonable person would understand to be confidential, including financial, customer, pricing and business-plan information.

3. WHAT EACH PARTY AGREES TO DO
The receiving Party will use the Confidential Information only for the Purpose, keep it as secure as its own confidential information (and at least with reasonable care), and share it only with people who need it for the Purpose and are bound to keep it confidential.

4. WHAT IS NOT COVERED
This Agreement does not cover information that is or becomes public without a breach, was already known to the receiving Party, was independently developed, or was received lawfully from someone else. A Party may disclose information when the law requires, after giving prompt notice where allowed.

5. TERM
These obligations last {{years}} years from {{effectiveDate}}. On request, each Party will return or destroy the other's Confidential Information.

6. REMEDIES AND GENERAL
Because a breach could cause harm money cannot fix, a Party may ask a court for an order stopping a breach. This is the Parties' entire agreement on its subject, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}.

{{partyA}}
Signature: ______________________________   Date: ______________

{{partyB}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "commercial_lease_short", title: "Short-Form Commercial Lease", category: LENDING,
    description: "A plain, short lease for a store or office: rent, term, deposit and the main rules.",
    reviewNote: "Commercial leases carry long-term obligations — have an attorney review it before signing, especially for longer terms.",
    steps: [
      { title: "Parties and space", questions: [text("landlord", "Landlord", { required: true }), text("landlordAddress", "Landlord's address"), text("tenant", "Tenant", { prefill: "clientName", required: true }), text("premises", "Address of the space", { required: true }), text("use", "Permitted use", { required: true, placeholder: "e.g. Retail convenience store" }), effective(), state()] },
      { title: "Term and rent", questions: [
        date("startDate", "Lease starts", { required: true }), date("endDate", "Lease ends", { required: true }), money("rent", "Monthly rent", { required: true }), num("rentDay", "Rent due on day of the month", { default: "1", required: true }),
        money("deposit", "Security deposit", { required: true }), yesno("lateFee", "Charge a late fee"), money("lateFeeAmount", "Late fee", { showIf: { id: "lateFee", equals: true }, required: true }),
        pick("utilities", "Utilities", [["tenant", "Tenant pays all utilities"], ["landlord", "Landlord pays all utilities"], ["split", "As listed below"]], { required: true, default: "tenant" }),
        text("utilitiesNote", "Which utilities, and who pays", { showIf: { id: "utilities", equals: "split" } }),
        yesno("renewal", "Tenant may renew for another term"), text("renewalTerms", "Renewal terms", { showIf: { id: "renewal", equals: true }, placeholder: "e.g. One 3-year renewal at the then-current market rent" }),
      ] },
    ],
    body: `COMMERCIAL LEASE

This Lease is made on {{effectiveDate}} between {{landlord}}{{#if landlordAddress}}, {{landlordAddress}}{{/if}} ("Landlord") and {{tenant}} ("Tenant").

1. PREMISES AND USE
Landlord leases to Tenant the space at {{premises}} (the "Premises"). Tenant will use it only for {{use}} and in compliance with all laws and required licenses.

2. TERM
The Lease runs from {{startDate}} to {{endDate}}.{{#if renewal}} Renewal: {{renewalTerms}}{{/if}}

3. RENT
Tenant pays {{rent}} per month, due on day {{rentDay}} of each month. {{#if lateFee}}Rent more than 5 days late is subject to a late fee of {{lateFeeAmount}}. {{/if}}

4. SECURITY DEPOSIT
Tenant pays a security deposit of {{deposit}}, held by Landlord and returned within 30 days after the Lease ends, less amounts needed for unpaid rent or damage beyond normal wear.

5. UTILITIES
{{#if utilities=tenant}}Tenant pays all utilities for the Premises.{{/if}}{{#if utilities=landlord}}Landlord pays all utilities for the Premises.{{/if}}{{#if utilities=split}}{{utilitiesNote}}{{/if}}

6. MAINTENANCE AND ALTERATIONS
Tenant keeps the Premises clean and in good condition and may not make structural changes without Landlord's written consent. Landlord is responsible for the roof, structure and building systems unless damage is caused by Tenant.

7. INSURANCE AND LIABILITY
Tenant carries commercial general liability insurance and insurance on its own property, and indemnifies Landlord for claims arising from Tenant's use of the Premises.

8. DEFAULT
If Tenant does not pay rent within 10 days after written notice, or breaks another term and does not fix it within 30 days after written notice, Landlord may end the Lease and recover what the law allows.

9. ASSIGNMENT
Tenant may not assign this Lease or sublet without Landlord's written consent, which will not be unreasonably withheld.

10. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}.

LANDLORD: {{landlord}}
Signature: ______________________________   Date: ______________

TENANT: {{tenant}}
Signature: ______________________________   Date: ______________`,
  },
  /* ─────────────── Batch 2: chosen from the LawDepot catalogue for this firm's work ─────────────── */
  {
    key: "single_member_llc_agreement", title: "Single-Member LLC Operating Agreement", category: BUSINESS,
    description: "For an LLC with one owner: ownership, management, taxes, and what happens if the owner dies or sells.",
    reviewNote: "A short agreement helps keep the LLC separate from its owner. Have an attorney review it if the LLC owns significant property or has lenders.",
    steps: [
      { title: "The company", questions: [text("companyName", "LLC name", { prefill: "clientName", required: true }), text("formedIn", "State where the LLC is formed", { default: "Maryland", required: true }), date("formationDate", "Date formed", { required: true }), text("address", "Principal address", { prefill: "clientAddress", required: true }), text("purpose", "Business purpose", { default: "any lawful business" }), effective()] },
      { title: "The owner", questions: [text("member", "Owner (member) name", { required: true }), text("memberAddress", "Owner's address"), money("contribution", "Capital contributed", { required: true }), text("successor", "Who takes over if the owner dies or cannot act", { placeholder: "Name — leave blank to follow state law" }), state()] },
    ],
    body: `SINGLE-MEMBER LLC OPERATING AGREEMENT OF {{companyName}}

This Operating Agreement is made on {{effectiveDate}} by {{member}}{{#if memberAddress}} of {{memberAddress}}{{/if}} (the "Member") for {{companyName}} (the "Company"), a limited liability company formed in {{formedIn}} on {{formationDate}}.

1. FORMATION AND PURPOSE
The Company's principal office is {{address}}. Its purpose is {{purpose}}. The Company continues until the Member ends it.

2. OWNERSHIP AND CAPITAL
The Member owns 100% of the Company and has contributed {{contribution}} in capital. The Member may contribute or withdraw additional funds at any time, and the Company records each as a capital contribution or distribution — not as pay or as a loan unless documented as a loan.

3. MANAGEMENT
The Member manages the Company and may act and sign on its behalf, open accounts, hire people and make every decision for the Company.

4. SEPARATE FROM THE OWNER
The Company keeps its own bank accounts and books, and the Member does not mix personal and Company funds. The Company signs contracts in its own name. The Member is not personally liable for the Company's debts solely because they are the Member.

5. TAXES
The Company is a disregarded entity for federal income tax purposes, so its income and expenses are reported on the Member's own return unless the Member elects otherwise in writing.

6. DEATH OR INCAPACITY
{{#if successor}}If the Member dies or cannot act, {{successor}} may manage the Company and wind it up or continue it, to the extent the law allows.{{else}}If the Member dies or cannot act, the Company's affairs are handled as state law provides.{{/if}}

7. GENERAL
The Member may amend this Agreement at any time in writing. It is governed by the laws of the State of {{state}}.

MEMBER
{{member}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "corporate_resolution", title: "Corporate Resolution", category: BUSINESS,
    description: "Records a decision of the directors or shareholders — opening a bank account, borrowing, signing a lease, paying a bonus.",
    steps: [
      { title: "Corporation", questions: [text("corporation", "Corporation name", { prefill: "clientName", required: true }), text("incorporatedIn", "State of incorporation", { default: "Maryland", required: true }), effective(),
        pick("actingBody", "Decision made by", [["directors", "The board of directors"], ["shareholders", "The shareholders"]], { required: true, default: "directors" }), pick("how", "Adopted", [["meeting", "At a meeting"], ["writing", "By written consent, without a meeting"]], { required: true, default: "writing" })] },
      { title: "The decision", questions: [text("subject", "Subject", { required: true, placeholder: "e.g. Authority to open a business bank account" }),
        area("resolved", "What is decided", { required: true, placeholder: "e.g. The corporation is authorized to open an account at First Bank, and the President may sign all documents needed." }),
        text("authorizedPerson", "Person authorized to carry it out", { placeholder: "e.g. Ali Hassan, President" }),
        list("signers", "Directors or shareholders approving", [text("name", "Name", { required: true }), text("role", "Title (optional)")], { required: true, addLabel: "Add a person" })] },
    ],
    body: `{{corporation}}
(a corporation of the State of {{incorporatedIn}})

{{#if actingBody=directors}}RESOLUTION OF THE BOARD OF DIRECTORS{{else}}RESOLUTION OF THE SHAREHOLDERS{{/if}}

Subject: {{subject}}
Date: {{effectiveDate}}

{{#if how=meeting}}At a meeting duly held, the {{#if actingBody=directors}}directors{{else}}shareholders{{/if}} of {{corporation}} adopted the following resolution:{{else}}The undersigned, being all of the {{#if actingBody=directors}}directors{{else}}shareholders{{/if}} of {{corporation}}, consent to and adopt the following resolution without a meeting:{{/if}}

RESOLVED, that {{resolved}}

{{#if authorizedPerson}}FURTHER RESOLVED, that {{authorizedPerson}} is authorized to take every action and sign every document needed to carry out this resolution, and any such action already taken is approved and confirmed.

{{/if}}This resolution is to be kept with the corporation's records.

{{#list signers}}{{name}}{{#if role}}, {{role}}{{/if}}
Signature: ______________________________   Date: ______________

{{/list}}`,
  },
  {
    key: "annual_meeting_minutes", title: "Minutes of Annual Meeting", category: BUSINESS,
    description: "A simple record of a corporation's yearly meeting — directors elected, officers named, financials reviewed.",
    steps: [
      { title: "Meeting", questions: [text("corporation", "Corporation name", { prefill: "clientName", required: true }), date("meetingDate", "Date of meeting", { required: true }), text("place", "Place (or 'by phone / video')", { required: true }), text("chair", "Chairperson", { required: true }), text("secretary", "Secretary (took the minutes)", { required: true }),
        pick("who", "Meeting of", [["shareholders", "Shareholders"], ["directors", "Directors"], ["both", "Shareholders and directors"]], { required: true, default: "both" })] },
      { title: "Business", questions: [
        list("attendees", "Present", [text("name", "Name", { required: true }), text("capacity", "Shareholder / director / officer")], { required: true, addLabel: "Add a person" }),
        list("directors", "Directors elected or re-elected", [text("name", "Name", { required: true })], { required: true, addLabel: "Add a director" }),
        list("officers", "Officers appointed", [text("name", "Name", { required: true }), text("office", "Office", { required: true, placeholder: "President, Secretary, Treasurer" })], { addLabel: "Add an officer" }),
        yesno("financials", "Financial statements for the past year were reviewed", { default: true }), yesno("taxReturns", "The tax filings for the year were reviewed", { default: true }),
        area("otherBusiness", "Other business discussed or decided"),
      ] },
    ],
    body: `MINUTES OF THE ANNUAL MEETING
{{corporation}}

A meeting of the {{who}} of {{corporation}} was held on {{meetingDate}} at {{place}}.

PRESENT
{{#list attendees}}• {{name}}{{#if capacity}} ({{capacity}}){{/if}}
{{/list}}
{{chair}} acted as chairperson and {{secretary}} acted as secretary. The chairperson called the meeting to order, noted that a quorum was present, and confirmed that proper notice had been given or waived.

1. DIRECTORS
The following were elected to serve as directors until the next annual meeting and until their successors are elected:
{{#list directors}}• {{name}}
{{/list}}
{{#if officers}}2. OFFICERS
The directors appointed these officers:
{{#list officers}}• {{name}} — {{office}}
{{/list}}{{/if}}
3. REPORTS
{{#if financials}}The financial statements for the past year were presented and reviewed.{{/if}} {{#if taxReturns}}The corporation's tax filings for the year were reviewed.{{/if}}

{{#if otherBusiness}}4. OTHER BUSINESS
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
    reviewNote: "Documenting an owner loan matters for tax: without a written agreement and real repayments it can be treated as capital or as pay.",
    steps: [
      { title: "Parties", questions: [text("company", "Business", { prefill: "clientName", required: true }), text("owner", "Owner / shareholder", { required: true }), pick("direction", "Who is lending?", [["toBusiness", "The owner lends money to the business"], ["toOwner", "The business lends money to the owner"]], { required: true, default: "toBusiness" }), effective(), state()] },
      { title: "Loan", questions: [money("principal", "Amount", { required: true }), num("rate", "Annual interest rate (%)", { required: true, default: "0", help: "A 0% owner loan can have tax consequences — ask your tax preparer for the minimum rate." }),
        pick("schedule", "Repayment", [["monthly", "Monthly payments"], ["demand", "Repayable on demand"], ["date", "One payment on a date"]], { required: true, default: "monthly" }),
        num("months", "Number of monthly payments", { showIf: { id: "schedule", equals: "monthly" }, required: true }), date("repayBy", "Repay by", { showIf: { id: "schedule", equals: "date" }, required: true }),
        yesno("secured", "Secured by business assets"), text("collateral", "Assets", { showIf: { id: "secured", equals: true }, required: true })] },
    ],
    body: `{{#if direction=toBusiness}}SHAREHOLDER LOAN AGREEMENT{{else}}LOAN FROM COMPANY TO OWNER{{/if}}

This Agreement is made on {{effectiveDate}} between {{company}} (the "Company") and {{owner}} (the "Owner").

1. THE LOAN
{{#if direction=toBusiness}}The Owner lends the Company {{principal}}. The Company records this as a loan from the Owner and not as capital, income or pay.{{else}}The Company lends the Owner {{principal}}. The Company records this as a loan receivable and not as pay or a distribution.{{/if}}

2. INTEREST
Interest accrues at {{rate}}% per year on the unpaid balance.

3. REPAYMENT
{{#if schedule=monthly}}The loan is repaid in {{months}} equal monthly payments of principal and interest.{{/if}}{{#if schedule=demand}}The loan is repayable on demand with reasonable written notice.{{/if}}{{#if schedule=date}}The loan, with accrued interest, is repaid in full by {{repayBy}}.{{/if}} Payments are recorded in the Company's books when made.

{{#if secured}}4. SECURITY
The loan is secured by: {{collateral}}.

{{/if}}5. GENERAL
This Agreement may be changed only in writing signed by both parties and is governed by the laws of the State of {{state}}.

COMPANY: {{company}}
Signature: ______________________________   Date: ______________

OWNER: {{owner}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "payment_agreement", title: "Payment Plan Agreement", category: LENDING,
    description: "An agreed schedule for paying an overdue balance in installments — for invoices, rent or a debt.",
    steps: [
      { title: "Parties", questions: [text("creditor", "Owed to", { prefill: "firmName", required: true }), text("debtor", "Owed by", { prefill: "clientName", required: true }), effective(), state()] },
      { title: "The plan", questions: [text("reason", "What the balance is for", { required: true, placeholder: "e.g. Unpaid invoices for bookkeeping services" }), money("total", "Total owed", { required: true }), money("down", "Paid today (optional)"),
        money("installment", "Installment amount", { required: true }), pick("frequency", "Paid", [["weekly", "Every week"], ["biweekly", "Every two weeks"], ["monthly", "Every month"]], { required: true, default: "monthly" }), date("firstDue", "First installment due", { required: true }),
        yesno("lateFee", "Charge a late fee"), money("lateFeeAmount", "Late fee", { showIf: { id: "lateFee", equals: true }, required: true }),
        yesno("pauseWork", "Services may be paused if a payment is missed", { default: false })] },
    ],
    body: `PAYMENT PLAN AGREEMENT

This Agreement is made on {{effectiveDate}} between {{creditor}} ("Creditor") and {{debtor}} ("Debtor").

1. THE BALANCE
Debtor owes Creditor {{total}} for: {{reason}}. Debtor acknowledges the balance is correct and due.

2. PAYMENT PLAN
{{#if down}}Debtor pays {{down}} today. {{/if}}Debtor will pay {{installment}} {{frequency}}, starting {{firstDue}}, until the balance is paid in full. Debtor may pay more at any time.

3. MISSED PAYMENTS
{{#if lateFee}}A payment more than 7 days late is subject to a late fee of {{lateFeeAmount}}. {{/if}}If a payment is more than 14 days late, Creditor may declare the whole remaining balance due at once.{{#if pauseWork}} Creditor may also pause services until the account is current.{{/if}}

4. GENERAL
This Agreement does not cancel the debt or waive any of Creditor's rights if Debtor defaults. It may be changed only in writing signed by both and is governed by the laws of the State of {{state}}.

DEBTOR: {{debtor}}
Signature: ______________________________   Date: ______________

CREDITOR: {{creditor}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "employment_contract", title: "Employment Agreement", category: EMPLOYMENT,
    description: "A fuller written agreement than an offer letter: duties, pay, hours, confidentiality and how employment can end.",
    reviewNote: "Have an attorney review before using, especially any non-compete wording — Maryland limits non-competes for lower-wage workers.",
    steps: [
      { title: "Parties and role", questions: [text("employer", "Employer", { prefill: "clientName", required: true }), text("employerAddress", "Employer address", { prefill: "clientAddress" }), text("employee", "Employee", { required: true }), text("employeeAddress", "Employee address"), effective(), text("position", "Position", { required: true }), area("duties", "Main duties", { required: true }), date("startDate", "Start date", { required: true }), state()] },
      { title: "Pay and terms", questions: [pick("payType", "Pay", [["hourly", "Hourly"], ["salary", "Salary"]], { required: true, default: "hourly" }), money("rate", "Hourly rate or annual salary", { required: true }), pick("payFrequency", "Paid", [["weekly", "Weekly"], ["biweekly", "Every two weeks"], ["semimonthly", "Twice a month"], ["monthly", "Monthly"]], { default: "biweekly" }),
        text("hours", "Expected hours", { placeholder: "e.g. 40 hours a week" }), num("probation", "Introductory period (days, 0 for none)", { default: "90" }), num("noticeDays", "Notice to resign (days)", { default: "14", required: true }),
        yesno("confidential", "Employee keeps business information confidential", { default: true }), area("benefits", "Benefits, vacation or other terms")] },
    ],
    body: `EMPLOYMENT AGREEMENT

This Agreement is made on {{effectiveDate}} between {{employer}}{{#if employerAddress}}, {{employerAddress}}{{/if}} ("Employer") and {{employee}}{{#if employeeAddress}}, {{employeeAddress}}{{/if}} ("Employee").

1. POSITION AND DUTIES
Employer employs Employee as {{position}} beginning {{startDate}}. Duties include: {{duties}} Employee will also perform other reasonable duties Employer assigns.

2. PAY
Employee is paid {{#if payType=hourly}}{{rate}} per hour{{else}}a salary of {{rate}} per year{{/if}}, {{payFrequency}}, less required tax withholding and authorized deductions.{{#if hours}} Expected hours: {{hours}}.{{/if}} Hours over 40 in a workweek are paid at overtime rates where the law requires.

{{#if probation}}3. INTRODUCTORY PERIOD
The first {{probation}} days are an introductory period for both sides to decide whether the job is a good fit.

{{/if}}4. {{#if benefits}}BENEFITS AND OTHER TERMS{{else}}BENEFITS{{/if}}
{{#if benefits}}{{benefits}}{{else}}Employee receives the benefits Employer offers to its employees under its policies, which Employer may change.{{/if}}

{{#if confidential}}5. CONFIDENTIALITY
Employee will not share or use Employer's non-public business, customer or financial information except for Employer's business, during or after employment.

{{/if}}6. AT-WILL EMPLOYMENT AND NOTICE
Employment is at will: either party may end it at any time. Employee agrees to give {{noticeDays}} days' notice of resignation where possible. On leaving, Employee returns all Employer property and is paid all wages earned.

7. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}.

EMPLOYER: {{employer}}
Signature: ______________________________   Date: ______________

EMPLOYEE: {{employee}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "employee_warning_letter", title: "Employee Warning Letter", category: EMPLOYMENT,
    description: "A written warning that records what happened, what is expected, and the consequence of it happening again.",
    steps: [
      { title: "Details", questions: [text("employer", "Employer", { prefill: "clientName", required: true }), text("employee", "Employee", { required: true }), effective(), pick("level", "Warning level", [["verbal", "Written record of a verbal warning"], ["first", "First written warning"], ["final", "Final written warning"]], { required: true, default: "first" }),
        date("incidentDate", "Date of the issue", { required: true }), area("issue", "What happened (facts only)", { required: true }), area("expectation", "What is expected from now on", { required: true }),
        yesno("priorWarnings", "There were earlier warnings about this"), text("priorDates", "Dates of earlier warnings", { showIf: { id: "priorWarnings", equals: true } }),
        text("manager", "Issued by (name and title)", { required: true })] },
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

{{#if level=final}}This is a final written warning. Further problems of this kind may lead to ending your employment.{{else}}If this issue continues or happens again, further disciplinary action may follow, up to and including ending your employment.{{/if}}

If you disagree with anything in this letter, you may add your comments in writing. Signing below shows you received this letter; it does not mean you agree with it.

{{manager}}
{{employer}}

Employee: {{employee}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "resignation_letter", title: "Resignation Letter", category: EMPLOYMENT,
    description: "A person gives notice that they are leaving their job.",
    steps: [
      { title: "Details", questions: [text("employee", "Employee name", { required: true }), text("employer", "Employer", { prefill: "clientName", required: true }), text("addressee", "Addressed to (name and title)"), effective(), text("position", "Position"), date("lastDay", "Last day of work", { required: true }), text("reason", "Reason (optional)"), yesno("transition", "Offer to help with the handover", { default: true })] },
    ],
    body: `{{effectiveDate}}

{{#if addressee}}{{addressee}}
{{/if}}{{employer}}

Re: Resignation{{#if position}} — {{position}}{{/if}}

Dear {{#if addressee}}{{addressee}}{{else}}Sir or Madam{{/if}},

I am resigning from my position{{#if position}} as {{position}}{{/if}} with {{employer}}. My last day of work will be {{lastDay}}.{{#if reason}} {{reason}}{{/if}}

{{#if transition}}I will gladly help make the handover smooth and train a replacement before I leave. {{/if}}Please send my final pay and my tax forms to my address on file.

Thank you for the opportunity.

Sincerely,
{{employee}}
Signature: ______________________________`,
  },
  {
    key: "service_agreement", title: "Service Agreement", category: LENDING,
    description: "A general agreement for one business to provide services to another — scope, price, timing and rules.",
    steps: [
      { title: "Parties", questions: [text("provider", "Service provider", { required: true }), text("providerAddress", "Provider's address"), text("customer", "Customer", { prefill: "clientName", required: true }), text("customerAddress", "Customer's address", { prefill: "clientAddress" }), effective(), state()] },
      { title: "Services and price", questions: [area("services", "Services", { required: true }), date("startDate", "Starts", { required: true }), yesno("hasEnd", "Fixed end date"), date("endDate", "Ends", { showIf: { id: "hasEnd", equals: true }, required: true }),
        pick("priceType", "Price", [["fixed", "A fixed price"], ["hourly", "Hourly"], ["monthly", "Monthly"]], { required: true, default: "fixed" }), money("price", "Amount", { required: true }), num("payDays", "Invoices paid within (days)", { default: "30", required: true }),
        yesno("warranty", "Provider will fix errors in the work at no charge", { default: true }), yesno("insurance", "Provider carries liability insurance")] },
    ],
    body: `SERVICE AGREEMENT

This Agreement is made on {{effectiveDate}} between {{provider}}{{#if providerAddress}}, {{providerAddress}}{{/if}} ("Provider") and {{customer}}{{#if customerAddress}}, {{customerAddress}}{{/if}} ("Customer").

1. SERVICES
Provider will perform these services for Customer: {{services}}

2. TERM
Services start on {{startDate}}{{#if hasEnd}} and end on {{endDate}}{{else}} and continue until either party ends this Agreement on 30 days' written notice{{/if}}.

3. PRICE AND PAYMENT
Customer will pay Provider {{#if priceType=fixed}}a fixed price of {{price}}{{/if}}{{#if priceType=hourly}}{{price}} per hour{{/if}}{{#if priceType=monthly}}{{price}} per month{{/if}}. Provider will invoice Customer and Customer will pay within {{payDays}} days of each invoice.

4. QUALITY OF WORK
Provider will perform the services in a professional manner.{{#if warranty}} Provider will correct errors in the services at no extra charge if Customer reports them within 30 days of the work being done.{{/if}}{{#if insurance}} Provider carries liability insurance for the services.{{/if}}

5. INDEPENDENT PARTIES
Provider is an independent contractor and not Customer's employee. Provider is responsible for its own taxes and workers.

6. CONFIDENTIALITY
Each party will keep the other's non-public business information confidential.

7. ENDING THE AGREEMENT
Either party may end this Agreement if the other materially breaks it and does not fix the problem within 15 days of written notice. Customer pays for services performed up to the end date.

8. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}.

PROVIDER: {{provider}}
Signature: ______________________________   Date: ______________

CUSTOMER: {{customer}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "consulting_agreement", title: "Consulting Agreement", category: LENDING,
    description: "A consultant gives advice or expertise to a business for an agreed fee.",
    steps: [
      { title: "Parties", questions: [text("client", "Company", { prefill: "clientName", required: true }), text("clientAddress", "Company address", { prefill: "clientAddress" }), text("consultant", "Consultant", { required: true }), text("consultantAddress", "Consultant's address"), effective(), state()] },
      { title: "Work", questions: [area("scope", "What the consultant will do", { required: true }), date("startDate", "Start date", { required: true }), yesno("hasEnd", "Fixed end date"), date("endDate", "End date", { showIf: { id: "hasEnd", equals: true }, required: true }),
        pick("feeType", "Fee", [["fixed", "Fixed fee"], ["hourly", "Hourly"], ["monthly", "Monthly retainer"]], { required: true, default: "hourly" }), money("fee", "Amount", { required: true }), yesno("expenses", "Company reimburses approved expenses", { default: true }), yesno("confidential", "Consultant keeps information confidential", { default: true })] },
    ],
    body: `CONSULTING AGREEMENT

This Agreement is made on {{effectiveDate}} between {{client}}{{#if clientAddress}}, {{clientAddress}}{{/if}} ("Company") and {{consultant}}{{#if consultantAddress}}, {{consultantAddress}}{{/if}} ("Consultant").

1. SERVICES
Consultant will provide the following consulting services: {{scope}}

2. TERM
Services begin {{startDate}}{{#if hasEnd}} and end {{endDate}}{{else}} and continue until either party gives 30 days' written notice{{/if}}.

3. FEES
Company will pay Consultant {{#if feeType=fixed}}a fixed fee of {{fee}}{{/if}}{{#if feeType=hourly}}{{fee}} per hour{{/if}}{{#if feeType=monthly}}{{fee}} per month{{/if}}, payable within 30 days of each invoice.{{#if expenses}} Company reimburses reasonable expenses it approves in advance and that Consultant documents.{{/if}}

4. INDEPENDENT CONSULTANT
Consultant is an independent contractor, controls how the work is done, and is responsible for their own taxes and insurance. Company will report payments on Form 1099-NEC where required.

{{#if confidential}}5. CONFIDENTIALITY
Consultant will keep Company's non-public information confidential and use it only for this work, during and after this Agreement.

{{/if}}6. GENERAL
Either party may end this Agreement on 30 days' written notice. It is the parties' entire agreement, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}.

COMPANY: {{client}}
Signature: ______________________________   Date: ______________

CONSULTANT: {{consultant}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "demand_letter", title: "Payment Demand Letter", category: LENDING,
    description: "A formal request for payment of an overdue amount, with a deadline.",
    steps: [
      { title: "Details", questions: [text("sender", "From (your business)", { prefill: "clientName", required: true }), text("senderAddress", "Your address", { prefill: "clientAddress" }), text("recipient", "To (who owes the money)", { required: true }), text("recipientAddress", "Their address"), effective(),
        text("reference", "Invoice or agreement it relates to", { required: true, placeholder: "e.g. Invoice 1042 dated August 3, 2026" }), money("amount", "Amount owed", { required: true }), date("deadline", "Pay by", { required: true }), text("howToPay", "How to pay", { placeholder: "e.g. Check payable to the business, or bank transfer" }),
        yesno("interest", "Say that interest or fees may be added"), yesno("legal", "Say that legal action may follow if unpaid", { default: true })] },
    ],
    body: `{{effectiveDate}}

{{recipient}}{{#if recipientAddress}}
{{recipientAddress}}{{/if}}

Re: Demand for payment — {{reference}}

Dear {{recipient}},

Our records show that {{amount}} remains unpaid on {{reference}}, and the payment is overdue. Please pay the full amount by {{deadline}}.{{#if howToPay}} {{howToPay}}.{{/if}}

{{#if interest}}Interest and collection fees allowed by our agreement or by law may be added to the balance if it is not paid by that date. {{/if}}{{#if legal}}If we do not receive payment or hear from you by {{deadline}}, we may take further steps to collect, including legal action, without further notice.{{else}}If you believe this is wrong, or you would like to arrange a payment plan, please contact us before {{deadline}}.{{/if}}

If you have already paid, please send us the payment details so we can correct our records.

Sincerely,
{{sender}}{{#if senderAddress}}
{{senderAddress}}{{/if}}`,
  },
  {
    key: "lease_termination_agreement", title: "Lease Termination Agreement", category: LENDING,
    description: "Landlord and tenant agree to end a lease early — move-out date, deposit and any final payments.",
    steps: [
      { title: "Lease", questions: [text("landlord", "Landlord", { required: true }), text("tenant", "Tenant", { prefill: "clientName", required: true }), text("premises", "Space being leased", { required: true }), date("leaseDate", "Date of the original lease", { required: true }), effective(), state()] },
      { title: "Ending it", questions: [date("endDate", "Lease ends on", { required: true }), money("deposit", "Security deposit held", { default: "0" }), pick("depositTreatment", "The deposit will be", [["return", "Returned in full"], ["deduct", "Returned less amounts owed"], ["keep", "Kept by the landlord"]], { default: "return", required: true }),
        money("finalPayment", "Final payment from tenant (0 if none)", { default: "0" }), yesno("restore", "Tenant leaves the space clean and in its original condition", { default: true }), yesno("release", "Each side releases the other from further lease claims", { default: true })] },
    ],
    body: `LEASE TERMINATION AGREEMENT

This Agreement is made on {{effectiveDate}} between {{landlord}} ("Landlord") and {{tenant}} ("Tenant") about the lease dated {{leaseDate}} for {{premises}} (the "Lease").

1. EARLY END OF LEASE
Landlord and Tenant agree that the Lease ends on {{endDate}}, and Tenant will give up the space by that date.

2. RENT AND PAYMENTS
Tenant pays rent due up to {{endDate}}.{{#if finalPayment}} Tenant also pays {{finalPayment}} as a final payment to Landlord.{{/if}}

3. SECURITY DEPOSIT
{{#if deposit}}Landlord holds a deposit of {{deposit}}, which will be {{#if depositTreatment=return}}returned to Tenant in full{{/if}}{{#if depositTreatment=deduct}}returned to Tenant less any amounts owed and any damage beyond normal wear{{/if}}{{#if depositTreatment=keep}}kept by Landlord{{/if}} within 30 days after {{endDate}}.{{else}}No security deposit is being held.{{/if}}

{{#if restore}}4. CONDITION OF THE SPACE
Tenant leaves the space clean, free of Tenant's belongings, and in the condition required by the Lease, normal wear excepted.

{{/if}}{{#if release}}5. RELEASE
Once the terms above are met, each party releases the other from further claims under the Lease.

{{/if}}6. GENERAL
This Agreement is governed by the laws of the State of {{state}}.

LANDLORD: {{landlord}}
Signature: ______________________________   Date: ______________

TENANT: {{tenant}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "workplace_incident_report", title: "Workplace Incident Report", category: EMPLOYMENT,
    description: "A record of an accident or incident at work — who, what, when, and what was done afterwards.",
    reviewNote: "Serious injuries may need to be reported to Maryland OSHA or the workers' compensation carrier within set deadlines.",
    steps: [
      { title: "The incident", questions: [text("business", "Business", { prefill: "clientName", required: true }), date("incidentDate", "Date of incident", { required: true }), text("incidentTime", "Time", { placeholder: "e.g. About 3:30 PM" }), text("location", "Where it happened", { required: true }),
        text("person", "Person involved", { required: true }), text("position", "Their position"), area("description", "What happened", { required: true }), text("witnesses", "Witnesses (names)")] },
      { title: "Injury and follow-up", questions: [yesno("injury", "Someone was injured"), area("injuryDetails", "Injury and body part", { showIf: { id: "injury", equals: true }, required: true }), yesno("medical", "Medical treatment was given", { showIf: { id: "injury", equals: true } }), text("treatment", "Treatment and where", { showIf: { id: "medical", equals: true } }),
        area("actions", "What was done afterwards / to prevent it happening again"), text("reportedBy", "Report completed by (name and title)", { required: true }), date("reportDate", "Date completed", { prefill: "today", required: true })] },
    ],
    body: `WORKPLACE INCIDENT REPORT
{{business}}

Date of incident: {{incidentDate}}{{#if incidentTime}}   Time: {{incidentTime}}{{/if}}
Location: {{location}}
Person involved: {{person}}{{#if position}} ({{position}}){{/if}}
{{#if witnesses}}Witnesses: {{witnesses}}{{/if}}

WHAT HAPPENED
{{description}}

INJURY
{{#if injury}}Injury reported: {{injuryDetails}}
{{#if medical}}Medical treatment: {{treatment}}{{else}}No medical treatment was given at the time.{{/if}}{{else}}No injury was reported.{{/if}}

{{#if actions}}ACTIONS TAKEN
{{actions}}

{{/if}}Report completed by: {{reportedBy}}   Date: {{reportDate}}
Signature: ______________________________

Person involved: {{person}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "affidavit_general", title: "Affidavit", category: LENDING,
    description: "A sworn written statement of facts, signed in front of a notary.",
    reviewNote: "An affidavit only counts once it is signed in front of a notary public. Leave the notary section blank until then.",
    steps: [
      { title: "Statement", questions: [text("affiant", "Person making the statement", { required: true }), text("address", "Their address"), text("county", "County", { required: true }), state({ id: "stateName", label: "State" } as Partial<Question>), list("facts", "Statements of fact", [area("fact", "Statement", { required: true })], { required: true, addLabel: "Add a statement" }), effective()] },
    ],
    body: `AFFIDAVIT

State of {{stateName}}
County of {{county}}

I, {{affiant}}{{#if address}}, of {{address}}{{/if}}, being sworn, state:

{{#list facts}}{{n}}. {{fact}}

{{/list}}I swear or affirm that the statements above are true and correct to the best of my knowledge.

{{affiant}}
Signature: ______________________________   Date: {{effectiveDate}}

Subscribed and sworn to before me on ______________, 20____, by {{affiant}}.

Notary Public: ______________________________
My commission expires: ______________
(Seal)`,
  },
  /* ─────────────── Family & personal ─────────────── */
  {
    key: "child_travel_consent", title: "Minor Travel Consent", category: FAMILY,
    description: "A parent or guardian gives permission for a child to travel with another adult or alone — for airlines, border officers and hotels.",
    reviewNote: "Some countries and airlines want this notarized and carried with the child's passport and a copy of the parent's ID — check the destination's rules before the trip.",
    steps: [
      { title: "Parent or guardian", questions: [text("parent", "Parent or legal guardian", { required: true }), text("parentAddress", "Address"), text("parentPhone", "Phone", { required: true }), text("parentEmail", "Email"),
        yesno("secondParent", "A second parent or guardian also gives consent"), text("parent2", "Second parent or guardian", { showIf: { id: "secondParent", equals: true }, required: true }), effective()] },
      { title: "The child", questions: [list("children", "Child or children travelling", [text("name", "Full name", { required: true }), date("dob", "Date of birth", { required: true }), text("passport", "Passport number (optional)")], { required: true, addLabel: "Add a child" })] },
      { title: "The trip", questions: [
        pick("travellingWith", "The child is travelling", [["adult", "With another adult"], ["alone", "Alone (for example an unaccompanied-minor flight)"], ["parent", "With one parent only"]], { required: true, default: "adult" }),
        text("adult", "Travelling adult's name", { showIf: { id: "travellingWith", equals: "adult" }, required: true }), text("adultRelation", "Relationship to the child", { showIf: { id: "travellingWith", equals: "adult" } }), text("adultPhone", "Travelling adult's phone", { showIf: { id: "travellingWith", equals: "adult" } }),
        text("meetingPerson", "Person meeting the child on arrival", { showIf: { id: "travellingWith", equals: "alone" } }),
        text("destination", "Destination (city and country)", { required: true }), date("departure", "Leaving on", { required: true }), date("returning", "Returning on", { required: true }), text("purpose", "Purpose", { placeholder: "e.g. Family visit, vacation, school trip" }), text("staying", "Where the child will stay", { placeholder: "Address or hotel" }),
        yesno("medical", "The travelling adult may approve emergency medical treatment", { default: true }), text("insurance", "Health insurance details (optional)"),
      ] },
    ],
    body: `MINOR TRAVEL CONSENT

I, {{parent}}{{#if parentAddress}}, of {{parentAddress}}{{/if}}{{#if secondParent}}, and {{parent2}}{{/if}}, being the {{#if secondParent}}parents or legal guardians{{else}}parent or legal guardian{{/if}} of the child named below, give permission for the child to travel as described.

CHILD
{{#list children}}{{n}}. {{name}} — born {{dob}}{{#if passport}} — passport {{passport}}{{/if}}
{{/list}}
TRIP
Destination: {{destination}}
Leaving: {{departure}}    Returning: {{returning}}
{{#if purpose}}Purpose: {{purpose}}
{{/if}}{{#if staying}}Staying at: {{staying}}
{{/if}}{{#if travellingWith=adult}}Travelling with: {{adult}}{{#if adultRelation}} ({{adultRelation}}){{/if}}{{#if adultPhone}}, phone {{adultPhone}}{{/if}}{{/if}}{{#if travellingWith=alone}}The child is travelling alone and will be met on arrival by {{#if meetingPerson}}{{meetingPerson}}{{else}}the person named to the airline{{/if}}.{{/if}}{{#if travellingWith=parent}}The child is travelling with one parent; the other parent consents to this trip.{{/if}}

{{#if medical}}MEDICAL CARE
If the child needs emergency medical treatment, I authorize {{#if travellingWith=adult}}{{adult}}{{else}}the adult in charge of the child{{/if}} to consent to it on my behalf.{{#if insurance}} Health insurance: {{insurance}}.{{/if}}

{{/if}}I can be reached at {{parentPhone}}{{#if parentEmail}} or {{parentEmail}}{{/if}}. This consent is valid for the dates of this trip only.

{{parent}}
Signature: ______________________________   Date: {{effectiveDate}}
{{#if secondParent}}
{{parent2}}
Signature: ______________________________   Date: {{effectiveDate}}
{{/if}}
Notary (if required): Subscribed and sworn before me on ______________.
Notary Public: ______________________________   Commission expires: ______________`,
  },
];

export function getDocTemplate(key: string): DocTemplate | undefined { return DOC_TEMPLATES.find((t) => t.key === key); }
