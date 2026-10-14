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
      { title: "The company", questions: [text("companyName", "LLC name", { prefill: "clientName", required: true }), state({ id: "formedIn", label: "State where the LLC is formed" } as Partial<Question>), date("formationDate", "Date formed", { required: true }), text("address", "Principal address", { prefill: "clientAddress", required: true }), text("purpose", "Business purpose", { default: "any lawful business" }), effective()] },
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
  /* ─────────────── Real estate ─────────────── */
  {
    key: "property_sale_residential", title: "Residential Property Sale Agreement", category: REAL_ESTATE,
    description: "A seller and buyer agree on the sale of a home, condo or other residential property: price, deposit, financing, inspection and closing.",
    reviewNote: "Have a real-estate attorney or title company review this before signing. Maryland sellers of most residential property must give the buyer the state's Residential Property Disclosure or Disclaimer Statement, and homes built before 1978 need the federal lead-paint disclosure — attach them.",
    steps: [
      { title: "Seller and buyer", questions: [text("seller", "Seller(s) — full legal name(s)", { required: true }), text("sellerAddress", "Seller's address"), text("buyer", "Buyer(s) — full legal name(s)", { required: true }), text("buyerAddress", "Buyer's address"), effective(), state()] },
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
        pick("disclosureType", "Seller's Maryland disclosure", [["disclosure", "Residential Property Disclosure Statement"], ["disclaimer", "Residential Property Disclaimer Statement"], ["exempt", "Not required for this sale"]], { required: true, default: "disclosure" }),
        pick("closingCosts", "Closing costs are paid", [["split", "Split equally"], ["buyer", "By the buyer"], ["seller", "By the seller"]], { default: "split", required: true }),
        yesno("preYear78", "The home was built before 1978"), yesno("asIs", "The buyer accepts the property as-is after inspection", { default: false })] },
    ],
    body: `RESIDENTIAL PROPERTY SALE AGREEMENT

This Agreement is made on {{effectiveDate}} between {{seller}}{{#if sellerAddress}} of {{sellerAddress}}{{/if}} ("Seller") and {{buyer}}{{#if buyerAddress}} of {{buyerAddress}}{{/if}} ("Buyer").

1. THE PROPERTY
Seller agrees to sell and Buyer agrees to buy the residential property at {{propertyAddress}}, {{county}} County{{#if parcelId}}, tax account {{parcelId}}{{/if}}{{#if idNumbers}}, {{idNumbers}}{{/if}} (the "Property"){{#if legalDescription}}, described as:
{{legalDescription}}{{/if}}.
Included: {{included}}
{{#if excluded}}Excluded: {{excluded}}
{{/if}}
2. PRICE AND DEPOSIT
The purchase price is {{price}}. Buyer pays an earnest-money deposit of {{deposit}} to be held by {{depositHolder}} and credited to the price at closing. The balance is paid at closing in certified funds or by wire transfer.

3. FINANCING
{{#if financing=cash}}Buyer is paying cash. This Agreement does not depend on any loan, and Buyer will show proof of funds within 5 days of signing.{{/if}}{{#if financing=mortgage}}Buyer will apply for a mortgage loan of {{loanAmount}} and will pursue it in good faith. If Buyer cannot obtain loan approval within {{loanDays}} days after signing, despite good-faith effort, Buyer may cancel by written notice and the deposit is returned.{{/if}}{{#if financing=seller}}Seller will finance part of the price on these terms: {{sellerFinanceTerms}} The terms will be put in a promissory note and a mortgage or deed of trust signed at closing.{{/if}}

4. INSPECTION AND CONDITION
{{#if inspectionDays}}Buyer may have the Property inspected within {{inspectionDays}} days after signing. If the inspection shows a problem Buyer is not willing to accept, Buyer may cancel by written notice within that period and the deposit is returned, or the parties may agree in writing on repairs or a price change. If Buyer does not cancel in time, Buyer accepts the Property's condition.{{else}}Buyer has chosen not to inspect before closing.{{/if}} {{#if asIs}}The Property is sold as-is, without warranty as to its condition, except as stated in this Agreement and required by law.{{/if}}

{{#if appraisalContingency}}5. APPRAISAL
This Agreement depends on the Property appraising at or above the purchase price. If it appraises lower, the parties may agree on a lower price; otherwise Buyer may cancel and the deposit is returned.

{{/if}}{{#if saleContingency}}6. BUYER'S OTHER HOME
This Agreement depends on Buyer selling another property and closing on that sale by the closing date below.

{{/if}}7. TITLE
At closing Seller delivers {{#if deedType=general}}a general warranty deed{{else}}a special warranty deed{{/if}} conveying good and merchantable title, free of liens and claims other than those Buyer agrees to accept. {{#if titleCompany}}{{titleCompany}} will act as settlement agent and provide the title search. {{/if}}If a title problem cannot be fixed before closing, Buyer may cancel and the deposit is returned.

8. CLOSING, POSSESSION AND COSTS
Closing takes place {{#if closingMode=date}}on {{closingDate}}{{else}}within {{closingDays}} days after the conditions in this Agreement that protect Buyer have been met or waived{{/if}}. Buyer takes possession {{#if possession=closing}}at closing{{else}}on {{possessionDate}}{{/if}}, with the Property clean and in the condition it was in at the inspection, normal wear excepted. Transfer and recordation taxes are paid {{#if transferTaxes=split}}equally by Buyer and Seller{{/if}}{{#if transferTaxes=buyer}}by Buyer{{/if}}{{#if transferTaxes=seller}}by Seller{{/if}}. All other closing costs, including recording fees, title search and insurance, survey and loan charges, are paid {{#if closingCosts=split}}equally by Buyer and Seller{{/if}}{{#if closingCosts=buyer}}by Buyer{{/if}}{{#if closingCosts=seller}}by Seller{{/if}}. Property taxes, water and sewer charges and any association fees are adjusted as of the closing date.

9. DISCLOSURES
Seller will give Buyer the disclosures the law requires for this sale. {{#if disclosureType=disclosure}}Seller will deliver the Maryland Residential Property Disclosure Statement, completed to the best of Seller's knowledge.{{/if}}{{#if disclosureType=disclaimer}}Seller will deliver the Maryland Residential Property Disclaimer Statement, stating that Seller makes no representations about the Property's condition and Buyer is relying on Buyer's own inspection.{{/if}}{{#if disclosureType=exempt}}The parties state that no Maryland residential disclosure or disclaimer statement is required for this sale.{{/if}}{{#if preYear78}} Because the home was built before 1978, Seller will give Buyer the federal lead-based paint disclosure and the opportunity to test for lead-based paint.{{/if}}

10. RISK OF LOSS
Seller bears the risk of loss or damage to the Property until closing. If the Property is substantially damaged before closing, Buyer may cancel and the deposit is returned.

11. DEFAULT
If Buyer defaults, Seller may keep the deposit as Seller's sole remedy unless the law allows more. If Seller defaults, Buyer may recover the deposit and pursue the remedies the law allows, including asking a court to require the sale.

{{#if brokerUsed}}0. BROKERS AND COMMISSION
{{#if brokerName}}{{brokerName}} acted as agent in this sale. {{/if}}The real-estate commission is paid by {{#if commissionPaidBy=seller}}Seller{{/if}}{{#if commissionPaidBy=buyer}}Buyer{{/if}}{{#if commissionPaidBy=split}}Buyer and Seller equally{{/if}} at closing. Each party will protect the other from any other broker's claim based on that party's own dealings.{{else}}0. BROKERS AND COMMISSION
Each party states that it has not used a real-estate broker or agent in this transaction, and each will protect the other from any commission claim based on that party's own dealings. This promise continues after closing.{{/if}}

{{#if hoa}}0. ASSOCIATION
The Property is in an association. Seller will give Buyer the association's governing documents, current fees and any resale information the law requires, and Buyer may cancel within the period the law allows after receiving them. Association fees and assessments are adjusted as of the closing date.

{{/if}}0. REPORTING TO THE IRS
Buyer and Seller will give the settlement agent the information needed to file the report the Internal Revenue Code requires for real-estate sales (Form 1099-S). This promise continues after closing.

12. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}. Notices must be in writing and sent to the addresses above. Time is of the essence. This Agreement binds the parties and their heirs, representatives and permitted assigns, and may be signed in counterparts, including electronically, which together form one agreement.

SELLER: {{seller}}
Signature: ______________________________   Date: ______________

BUYER: {{buyer}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "property_sale_commercial", title: "Commercial Property Sale Agreement", category: REAL_ESTATE,
    description: "A seller and buyer agree on the sale of a commercial building or land: price, due-diligence period, tenants, zoning, environmental and closing.",
    reviewNote: "Commercial sales carry large tax, zoning, environmental and lease consequences — have a real-estate attorney review this, and a title company handle the closing.",
    steps: [
      { title: "Seller and buyer", questions: [text("seller", "Seller — full legal name", { required: true }), text("sellerAddress", "Seller's address"), text("buyer", "Buyer — full legal name", { required: true }), text("buyerAddress", "Buyer's address"), effective(), state()] },
      { title: "The property", questions: [text("propertyAddress", "Property address", { required: true }), text("county", "County", { required: true }), text("parcelId", "Tax account / parcel number"), text("idNumbers", "Ward / section / block / lot (Baltimore City) or other property ID"), area("legalDescription", "Legal description (from the deed)"),
        text("use", "Current use", { required: true, placeholder: "e.g. Retail store with upstairs apartment" }), text("zoning", "Zoning (if known)"),
        area("included", "Included with the sale", { default: "The land, the building and improvements, fixtures attached to them, and the personal property listed below." }), area("personalProperty", "Equipment, inventory or other personal property included"), area("excluded", "Items the seller keeps")] },
      { title: "Tenants", questions: [yesno("tenants", "Part of the property is leased to tenants"), area("tenantList", "Tenants, rents and lease end dates", { showIf: { id: "tenants", equals: true }, required: true, placeholder: "e.g. Unit A — Corner Deli LLC, $3,200/month, ends June 30, 2028" }), yesno("assumeLeases", "The buyer takes over the existing leases and deposits", { showIf: { id: "tenants", equals: true }, default: true })] },
      { title: "Price and due diligence", questions: [money("price", "Purchase price", { required: true }), money("deposit", "Earnest-money deposit", { required: true }), text("depositHolder", "Deposit held by", { required: true, placeholder: "Title company or escrow agent" }),
        pick("financing", "How will the buyer pay?", [["cash", "Cash — no financing"], ["mortgage", "A commercial loan"], ["seller", "Financing from the seller"]], { required: true, default: "mortgage" }),
        money("loanAmount", "Loan amount", { showIf: { id: "financing", equals: "mortgage" }, required: true }), num("loanDays", "Days to get loan approval", { showIf: { id: "financing", equals: "mortgage" }, default: "45", required: true }), text("sellerFinanceTerms", "Seller-financing terms", { showIf: { id: "financing", equals: "seller" }, required: true }),
        num("dueDiligenceDays", "Due-diligence period (days)", { default: "30", required: true }), yesno("environmental", "Buyer may order an environmental assessment", { default: true }), yesno("exchange1031", "Seller or buyer may complete the sale as part of a 1031 exchange"),
        pick("closingMode", "Closing happens", [["date", "On a set date"], ["days", "Within a number of days after the buyer's conditions are met"]], { required: true, default: "date" }), date("closingDate", "Closing date", { showIf: { id: "closingMode", equals: "date" }, required: true }), num("closingDays", "Days after the conditions are met", { showIf: { id: "closingMode", equals: "days" }, default: "30", required: true }),
        pick("deedType", "Deed", [["special", "Special warranty deed"], ["general", "General warranty deed"]], { required: true, default: "special" }),
        pick("transferTaxes", "Transfer and recordation taxes are paid", [["split", "Split equally"], ["buyer", "By the buyer"], ["seller", "By the seller"]], { required: true, default: "split" }),
        yesno("brokerUsed", "A real-estate agent or broker was used"), text("brokerName", "Agent / brokerage", { showIf: { id: "brokerUsed", equals: true } }), pick("commissionPaidBy", "Commission is paid by", [["seller", "The seller"], ["buyer", "The buyer"], ["split", "Split between them"]], { showIf: { id: "brokerUsed", equals: true }, default: "seller" }),
        yesno("hoa", "The property is in a homeowners', condominium or similar association"),
        text("titleCompany", "Title company or settlement agent"), pick("closingCosts", "Closing costs are paid", [["split", "Split equally"], ["buyer", "By the buyer"], ["seller", "By the seller"]], { default: "split", required: true })] },
    ],
    body: `COMMERCIAL PROPERTY SALE AGREEMENT

This Agreement is made on {{effectiveDate}} between {{seller}}{{#if sellerAddress}} of {{sellerAddress}}{{/if}} ("Seller") and {{buyer}}{{#if buyerAddress}} of {{buyerAddress}}{{/if}} ("Buyer").

1. THE PROPERTY
Seller agrees to sell and Buyer agrees to buy the commercial property at {{propertyAddress}}, {{county}} County{{#if parcelId}}, tax account {{parcelId}}{{/if}}{{#if idNumbers}}, {{idNumbers}}{{/if}} (the "Property"){{#if legalDescription}}, described as:
{{legalDescription}}{{/if}}.
Current use: {{use}}.{{#if zoning}} Zoning: {{zoning}}.{{/if}}
Included: {{included}}
{{#if personalProperty}}Personal property included: {{personalProperty}}
{{/if}}{{#if excluded}}Excluded: {{excluded}}
{{/if}}
2. PRICE AND DEPOSIT
The purchase price is {{price}}. Buyer pays an earnest-money deposit of {{deposit}} to be held by {{depositHolder}} and credited to the price at closing. The balance is paid at closing in certified funds or by wire transfer.

3. FINANCING
{{#if financing=cash}}Buyer is paying cash. This Agreement does not depend on financing, and Buyer will show proof of funds within 5 days of signing.{{/if}}{{#if financing=mortgage}}Buyer will apply for a commercial loan of {{loanAmount}} and pursue it in good faith. If Buyer cannot obtain loan approval within {{loanDays}} days after signing despite good-faith effort, Buyer may cancel by written notice and the deposit is returned.{{/if}}{{#if financing=seller}}Seller will finance part of the price on these terms: {{sellerFinanceTerms}} The terms will be put in a promissory note and a mortgage or deed of trust signed at closing.{{/if}}

4. DUE DILIGENCE
For {{dueDiligenceDays}} days after signing, Buyer may inspect the Property and its records, including leases, income and expense statements, permits, surveys and the title commitment. Seller will provide these on request and give Buyer reasonable access. {{#if environmental}}Buyer may order an environmental assessment at Buyer's cost. {{/if}}If Buyer is not satisfied for any reason, Buyer may cancel by written notice before the period ends and the deposit is returned. If Buyer does not cancel in time, Buyer accepts the Property's condition and the deposit becomes at risk under the Default section.

{{#if tenants}}5. TENANTS AND LEASES
The Property is leased to the following tenants: {{tenantList}} Seller states that the leases are in effect, the rents shown are correct, and no tenant is more than 30 days late except as disclosed in writing. {{#if assumeLeases}}At closing Buyer takes over the leases and the security deposits, which Seller transfers or credits to Buyer, and rents and expenses are adjusted as of the closing date.{{else}}Seller will give each tenant the notices the leases and the law require.{{/if}}

{{/if}}6. TITLE AND SURVEY
At closing Seller delivers {{#if deedType=general}}a general warranty deed{{else}}a special warranty deed{{/if}} conveying good and merchantable title, free of liens and claims other than those Buyer agrees to accept. {{#if titleCompany}}{{titleCompany}} will act as settlement agent and provide the title search. {{/if}}If a title problem cannot be fixed before closing, Buyer may cancel and the deposit is returned.

7. SELLER'S STATEMENTS
Seller states that, to Seller's knowledge, there are no pending lawsuits, condemnation proceedings or unpaid assessments affecting the Property, no violations of law have been received in writing that have not been fixed, and Seller has disclosed all known environmental problems.

8. CLOSING AND COSTS
Closing takes place {{#if closingMode=date}}on {{closingDate}}{{else}}within {{closingDays}} days after due diligence and the other conditions in this Agreement that protect Buyer have been met or waived{{/if}}, and Buyer takes possession then, free of occupants other than the tenants listed. Transfer and recordation taxes are paid {{#if transferTaxes=split}}equally by Buyer and Seller{{/if}}{{#if transferTaxes=buyer}}by Buyer{{/if}}{{#if transferTaxes=seller}}by Seller{{/if}}. All other closing costs, including recording fees, title search and insurance, survey and loan charges, are paid {{#if closingCosts=split}}equally by Buyer and Seller{{/if}}{{#if closingCosts=buyer}}by Buyer{{/if}}{{#if closingCosts=seller}}by Seller{{/if}}. Property taxes, utilities, rents and operating expenses are adjusted as of the closing date.{{#if exchange1031}} Each party will reasonably cooperate if the other wishes to complete the sale as part of a tax-deferred exchange, at no added cost or delay to the cooperating party.{{/if}}

9. RISK OF LOSS
Seller bears the risk of loss or damage to the Property until closing. If the Property is substantially damaged or taken before closing, Buyer may cancel and the deposit is returned.

10. DEFAULT
If Buyer defaults, Seller may keep the deposit as Seller's sole remedy unless the law allows more. If Seller defaults, Buyer may recover the deposit and pursue the remedies the law allows, including asking a court to require the sale.

{{#if brokerUsed}}0. BROKERS AND COMMISSION
{{#if brokerName}}{{brokerName}} acted as agent in this sale. {{/if}}The real-estate commission is paid by {{#if commissionPaidBy=seller}}Seller{{/if}}{{#if commissionPaidBy=buyer}}Buyer{{/if}}{{#if commissionPaidBy=split}}Buyer and Seller equally{{/if}} at closing. Each party will protect the other from any other broker's claim based on that party's own dealings.{{else}}0. BROKERS AND COMMISSION
Each party states that it has not used a real-estate broker or agent in this transaction, and each will protect the other from any commission claim based on that party's own dealings. This promise continues after closing.{{/if}}

{{#if hoa}}0. ASSOCIATION
The Property is in an association. Seller will give Buyer the association's governing documents, current fees and any resale information the law requires, and Buyer may cancel within the period the law allows after receiving them. Association fees and assessments are adjusted as of the closing date.

{{/if}}0. REPORTING TO THE IRS
Buyer and Seller will give the settlement agent the information needed to file the report the Internal Revenue Code requires for real-estate sales (Form 1099-S). This promise continues after closing.

11. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}. Notices must be in writing and sent to the addresses above. Time is of the essence. This Agreement binds the parties and their heirs, representatives and permitted assigns, and may be signed in counterparts, including electronically, which together form one agreement. Buyer may assign this Agreement only with Seller's written consent.

SELLER: {{seller}}
Signature: ______________________________   Date: ______________

BUYER: {{buyer}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "lease_residential", title: "Residential Lease Agreement", category: REAL_ESTATE,
    description: "A landlord rents a home or apartment to one or more tenants: term, rent, deposit, rules, repairs and move-out.",
    reviewNote: "Check current Maryland and local rules before using it: the security deposit may not exceed two months' rent, a late fee may not exceed 5% of the monthly rent, most rental properties need a city or county rental license, and homes built before 1978 have lead-paint registration and disclosure duties. Have an attorney review it.",
    steps: [
      { title: "Landlord and tenants", questions: [text("landlord", "Landlord (owner or manager)", { required: true }), text("landlordAddress", "Landlord's address for notices"), text("landlordPhone", "Landlord's phone"),
        list("tenants", "Tenants who sign the lease", [text("name", "Full name", { required: true })], { required: true, addLabel: "Add a tenant" }), text("occupants", "Other people who will live there (names, optional)"), effective(), state()] },
      { title: "The home", questions: [text("propertyAddress", "Address (include unit number)", { required: true }), text("county", "County or city", { required: true }),
        pick("homeType", "Type of home", [["house", "House"], ["apartment", "Apartment"], ["condo", "Condominium"], ["room", "Room in a shared home"]], { required: true, default: "apartment" }),
        text("licenseNumber", "Rental license / registration number (if required where it is)"), yesno("preYear78", "The home was built before 1978"),
        area("included", "Appliances and furnishings included", { placeholder: "e.g. Refrigerator, stove, dishwasher, washer and dryer" }), text("parking", "Parking", { placeholder: "e.g. One assigned space" })] },
      { title: "Term and rent", questions: [
        pick("termType", "Lease type", [["fixed", "Fixed term (set start and end)"], ["monthly", "Month to month"]], { required: true, default: "fixed" }),
        date("startDate", "Starts", { required: true }), date("endDate", "Ends", { showIf: { id: "termType", equals: "fixed" }, required: true }),
        num("noticeDays", "Days' written notice to end a month-to-month tenancy", { showIf: { id: "termType", equals: "monthly" }, default: "60", required: true }),
        money("rent", "Monthly rent", { required: true }), num("rentDay", "Rent is due on day", { default: "1", required: true }), num("graceDays", "Days before rent is late", { default: "5", required: true }),
        yesno("lateFee", "Charge a late fee"), money("lateFeeAmount", "Late fee", { showIf: { id: "lateFee", equals: true }, required: true, help: "Maryland caps a residential late fee at 5% of the monthly rent." }),
        text("payHow", "How rent is paid", { default: "Check, money order or bank transfer to the landlord's address or account" }),
        money("deposit", "Security deposit", { required: true, help: "Maryland caps the deposit at two months' rent." })] },
      { title: "Rules", questions: [
        pick("utilities", "Utilities", [["tenant", "Tenant pays all utilities"], ["landlord", "Landlord pays all utilities"], ["split", "As listed below"]], { required: true, default: "tenant" }), text("utilitiesNote", "Which utilities, and who pays", { showIf: { id: "utilities", equals: "split" }, required: true }),
        yesno("pets", "Pets are allowed"), text("petTerms", "Which pets, and any pet fee or deposit", { showIf: { id: "pets", equals: true }, required: true }),
        yesno("noSmoking", "No smoking anywhere in the home", { default: true }), num("entryHours", "Hours' notice before the landlord enters", { default: "24", required: true }),
        yesno("subletAllowed", "Tenant may sublet or take roommates only with written consent", { default: true }),
      ] },
    ],
    body: `RESIDENTIAL LEASE AGREEMENT

This Lease is made on {{effectiveDate}} between {{landlord}}{{#if landlordAddress}}, {{landlordAddress}}{{/if}}{{#if landlordPhone}}, phone {{landlordPhone}}{{/if}} ("Landlord"), and the following tenant(s), together "Tenant":
{{#list tenants}}• {{name}}
{{/list}}
1. THE HOME
Landlord rents to Tenant the {{homeType}} at {{propertyAddress}}, {{county}} (the "Home"){{#if parking}}, with {{parking}}{{/if}}.{{#if included}} Included: {{included}}.{{/if}}{{#if occupants}} Other permitted occupants: {{occupants}}.{{/if}} Only the people named in this Lease may live in the Home.{{#if licenseNumber}} Rental license / registration: {{licenseNumber}}.{{/if}}

2. TERM
{{#if termType=fixed}}This Lease runs from {{startDate}} to {{endDate}}. It ends on that date unless the parties sign a new lease or extension.{{else}}This tenancy begins on {{startDate}} and continues month to month. Either party may end it by giving at least {{noticeDays}} days' written notice before the end of a rental month.{{/if}}

3. RENT
Tenant pays {{rent}} per month, due on day {{rentDay}} of each month, by {{payHow}}. {{#if lateFee}}Rent not received within {{graceDays}} days after the due date is subject to a late fee of {{lateFeeAmount}}. {{/if}}Landlord may not charge more than the law allows for late payment.

4. SECURITY DEPOSIT
Tenant pays a security deposit of {{deposit}}. Landlord holds it as the law requires and returns it, with an itemized list of any deductions for unpaid rent or damage beyond normal wear, within 45 days after the Lease ends and Tenant has moved out and given a forwarding address. Tenant may ask in writing, at least 15 days before moving out, to be present when Landlord inspects the Home. The deposit is not a limit on what Tenant owes.

5. UTILITIES
{{#if utilities=tenant}}Tenant pays all utilities for the Home.{{/if}}{{#if utilities=landlord}}Landlord pays all utilities for the Home.{{/if}}{{#if utilities=split}}{{utilitiesNote}}{{/if}}

6. USE AND RULES
Tenant uses the Home only as a private home, obeys the law and any building or association rules, and keeps the Home clean and free of nuisance. {{#if noSmoking}}Smoking is not allowed anywhere in the Home. {{/if}}{{#if pets}}Pets are allowed on these terms: {{petTerms}}. {{else}}No pets are allowed without Landlord's written consent. {{/if}}{{#if subletAllowed}}Tenant may not sublet, assign or take in roommates without Landlord's written consent.{{/if}}

7. REPAIRS AND CONDITION
Landlord keeps the Home fit to live in and repairs problems Tenant reports in writing, except those caused by Tenant or Tenant's guests. Tenant tells Landlord promptly about leaks, pests, broken heat or other problems, and pays for damage caused by Tenant or guests. Tenant makes no alterations, locks or paint changes without Landlord's written consent.

8. LANDLORD'S ENTRY
Landlord may enter the Home to inspect, repair or show it after giving at least {{entryHours}} hours' notice, except in an emergency.

{{#if preYear78}}9. LEAD-BASED PAINT
The Home was built before 1978. Landlord has given Tenant the federal lead-based paint disclosure and the lead hazard pamphlet, and will meet the lead registration, inspection and notice requirements that apply to the Home.

{{/if}}10. INSURANCE AND LIABILITY
Landlord is not responsible for loss of Tenant's belongings unless caused by Landlord's negligence. Tenant is encouraged to carry renter's insurance.

11. DEFAULT AND ENDING EARLY
If Tenant does not pay rent when due or breaks another term, Landlord may give the written notice the law requires and then pursue the remedies the law allows, including ending the tenancy through the court. If Tenant leaves early, Tenant remains responsible for rent until the Home is re-rented or the Lease ends, but Landlord will make reasonable efforts to re-rent it.

12. MOVING OUT
At the end of the tenancy Tenant returns all keys, removes belongings, and leaves the Home clean and in the condition it was in at move-in, normal wear excepted.

13. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by Landlord and Tenant, and is governed by the laws of the State of {{state}}. Notices must be in writing and delivered to the addresses above or to the Home. If any part is not enforceable, the rest remains in effect.

LANDLORD: {{landlord}}
Signature: ______________________________   Date: ______________

{{#list tenants}}TENANT: {{name}}
Signature: ______________________________   Date: ______________

{{/list}}`,
  },
  {
    key: "lease_commercial", title: "Commercial Lease Agreement", category: REAL_ESTATE,
    description: "A full commercial lease for a store, office or warehouse: rent and increases, who pays taxes and upkeep, improvements, insurance, default and renewal.",
    reviewNote: "A commercial lease can bind the parties for years and for large sums. Have an attorney review it before signing — especially the rent type (gross vs. net), personal guarantee, renewal and default sections.",
    steps: [
      { title: "Parties", questions: [text("landlord", "Landlord", { required: true }), text("landlordAddress", "Landlord's address for notices"), text("tenant", "Tenant (business name)", { prefill: "clientName", required: true }), text("tenantAddress", "Tenant's address for notices", { prefill: "clientAddress" }), effective(), state()] },
      { title: "The space and its use", questions: [text("premises", "Address of the space (include suite)", { required: true }), text("county", "County or city", { required: true }), text("size", "Size", { placeholder: "e.g. About 2,400 square feet" }),
        text("use", "Permitted use", { required: true, placeholder: "e.g. Retail convenience store and deli" }), text("parkingText", "Parking and common areas included", { placeholder: "e.g. Six reserved spaces and shared loading area" }), yesno("signage", "Tenant may install its own sign, subject to law and landlord's approval", { default: true })] },
      { title: "Term and rent", questions: [
        date("startDate", "Lease starts", { required: true }), date("endDate", "Lease ends", { required: true }), money("rent", "Monthly base rent", { required: true }), num("rentDay", "Rent due on day", { default: "1", required: true }), num("graceDays", "Days before rent is late", { default: "5", required: true }),
        num("increasePercent", "Rent increases each year by (%, 0 for none)", { default: "3", required: true }),
        pick("rentType", "Who pays property taxes, insurance and common-area costs?", [["gross", "Landlord pays them (gross lease)"], ["nnn", "Tenant pays its share on top of rent (triple net)"], ["modified", "Shared as listed below (modified gross)"]], { required: true, default: "gross" }),
        text("costNote", "How costs are shared", { showIf: { id: "rentType", equals: "modified" }, required: true }), num("sharePercent", "Tenant's share of the building's costs (%)", { showIf: { id: "rentType", equals: "nnn" }, default: "100", required: true }),
        money("deposit", "Security deposit", { required: true }), yesno("lateFee", "Charge a late fee"), money("lateFeeAmount", "Late fee", { showIf: { id: "lateFee", equals: true }, required: true }),
        yesno("renewal", "Tenant has the option to renew"), text("renewalTerms", "Renewal terms", { showIf: { id: "renewal", equals: true }, required: true, placeholder: "e.g. One 3-year renewal, 6 months' notice, rent at market" }),
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

This Lease is made on {{effectiveDate}} between {{landlord}}{{#if landlordAddress}}, {{landlordAddress}}{{/if}} ("Landlord") and {{tenant}}{{#if tenantAddress}}, {{tenantAddress}}{{/if}} ("Tenant").

1. PREMISES
Landlord leases to Tenant the space at {{premises}}, {{county}}{{#if size}} ({{size}}){{/if}} (the "Premises"){{#if parkingText}}, together with {{parkingText}}{{/if}}.

2. USE
Tenant will use the Premises only for {{use}}, in compliance with all laws and with every license and permit the use requires, and will not create a nuisance or a hazard.{{#if signage}} Tenant may install a sign with Landlord's written approval, which will not be unreasonably withheld, at Tenant's cost and in compliance with local law; Tenant removes it and repairs any damage at the end of the Lease.{{/if}}

3. TERM
The Lease runs from {{startDate}} to {{endDate}}.{{#if renewal}} Renewal: {{renewalTerms}}.{{/if}}

4. RENT
Tenant pays base rent of {{rent}} per month, due on day {{rentDay}} of each month. {{#if increasePercent}}Each year on the anniversary of the start date, base rent increases by {{increasePercent}}% of the rent in effect. {{/if}}Rent not received within {{graceDays}} days after the due date is {{#if lateFee}}subject to a late fee of {{lateFeeAmount}} and {{/if}}late; Landlord may also charge interest at the highest rate the law allows on unpaid amounts.

5. TAXES, INSURANCE AND COMMON-AREA COSTS
{{#if rentType=gross}}Landlord pays property taxes, building insurance and common-area costs; they are included in the rent.{{/if}}{{#if rentType=nnn}}In addition to base rent, Tenant pays {{sharePercent}}% of the building's property taxes, building insurance and common-area maintenance costs, in monthly estimates adjusted after each year ends. Landlord shows Tenant the records on request.{{/if}}{{#if rentType=modified}}Property taxes, building insurance and common-area costs are shared as follows: {{costNote}}{{/if}}

6. SECURITY DEPOSIT
Tenant pays a security deposit of {{deposit}}, held by Landlord and returned within 45 days after the Lease ends and Tenant has surrendered the Premises, less amounts needed for unpaid rent or for damage beyond normal wear.

7. UTILITIES
{{#if utilities=tenant}}Tenant pays all utilities for the Premises.{{/if}}{{#if utilities=landlord}}Landlord pays all utilities for the Premises.{{/if}}{{#if utilities=split}}{{utilitiesNote}}{{/if}}

8. REPAIRS AND MAINTENANCE
{{#if repairs=standard}}Landlord repairs and maintains the roof, structure, foundation and building systems serving the Premises, except damage caused by Tenant. Tenant keeps the inside of the Premises clean and in good repair, including fixtures, windows, doors and Tenant's equipment.{{else}}Tenant repairs and maintains the entire Premises, including the roof, structure and building systems serving them, except for the cost of replacing major structural elements, which Landlord bears.{{/if}}

9. ALTERATIONS
Tenant makes no structural changes or alterations without Landlord's written consent. Improvements Tenant makes become Landlord's property at the end of the Lease unless the parties agree otherwise in writing, and Tenant keeps the Premises free of liens for work Tenant orders.

10. INSURANCE AND INDEMNITY
Tenant carries commercial general liability insurance of at least {{liabilityAmount}} per occurrence, naming Landlord as an additional insured, plus insurance on Tenant's own property, and gives Landlord proof on request. Tenant protects Landlord from claims arising from Tenant's use of the Premises, except those caused by Landlord's negligence.

11. DAMAGE AND CONDEMNATION
If the Premises are damaged and cannot be used, rent is reduced until they are repaired; if repairs would take more than 120 days, either party may end the Lease by written notice. If a government takes all or a substantial part of the Premises, the Lease ends on the date of the taking.

12. ASSIGNMENT AND SUBLETTING
Tenant may not assign this Lease or sublet any part of the Premises without Landlord's written consent, which will not be unreasonably withheld. A transfer of control of Tenant counts as an assignment. Tenant stays responsible after an assignment unless Landlord releases it in writing.

13. LANDLORD'S ENTRY
Landlord may enter the Premises at reasonable times on reasonable notice to inspect, repair or show it to buyers, lenders or new tenants, and at any time in an emergency.

14. DEFAULT AND REMEDIES
Tenant is in default if it does not pay rent within 10 days after written notice, or breaks another term and does not fix it within 30 days after written notice. Landlord may then end the Lease or Tenant's right to possession, re-enter as the law allows, and recover unpaid rent, damages and reasonable collection and legal costs, giving credit for amounts received from re-renting. Landlord defaults if it does not fix a failure within 30 days after written notice from Tenant.

15. SUBORDINATION AND ESTOPPEL
This Lease is subject to any mortgage on the building, provided the lender agrees not to disturb Tenant while Tenant is not in default. Within 15 days of a request, each party will confirm in writing the Lease's terms and whether any default exists.

16. END OF LEASE AND HOLDING OVER
At the end of the Lease Tenant returns the Premises clean and in good condition, normal wear and approved alterations excepted, and removes its own property. If Tenant stays after the end date without a new written lease, rent is {{holdoverPercent}}% of the last monthly rent, prorated by day, and the tenancy continues month to month.

{{#if guarantee}}17. GUARANTEE
{{guarantor}} personally guarantees that Tenant will pay all rent and perform all obligations under this Lease, and signs below to confirm it. Landlord need not first pursue Tenant before asking the guarantor to pay.

{{/if}}{{#if brokerUsed}}18. BROKER
{{brokerName}} acted in this Lease. Each party will protect the other from any other broker's claim based on its own dealings.

{{/if}}19. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, binds their heirs, successors and permitted assigns, and is governed by the laws of the State of {{state}}. Notices must be in writing and delivered to the addresses above. Time is of the essence. If any part is not enforceable, the rest remains in effect. This Lease may be signed in counterparts, including electronically.

LANDLORD: {{landlord}}
Signature: ______________________________   Date: ______________

TENANT: {{tenant}}
Signature: ______________________________   Date: ______________
{{#if guarantee}}
GUARANTOR: {{guarantor}}
Signature: ______________________________   Date: ______________
{{/if}}`,
  },
  /* ─────────────── Batch 7: powers, sales and transfers ─────────────── */
  {
    key: "general_poa", title: "Power of Attorney", category: FAMILY,
    description: "Lets someone you trust handle your money, tax, property or business matters for you — general or limited, with or without a start condition. Follows the layout of Maryland's statutory financial power of attorney.",
    reviewNote: "Maryland requires a power of attorney to be signed by the principal, acknowledged before a notary, and signed by two or more adult witnesses (the notary may be one of them) — Estates and Trusts Article §17-110. A bank, title company or the IRS may still ask for its own form; for the IRS or the Comptroller use 2848 / 8821 / MD 548. To sell or mortgage real estate, use the limited statutory form and record it in the county land records. Have a Maryland attorney review before use.",
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
        yesno("gifts", "The agent may make gifts from my property", { default: false }),
        pick("giftLimit", "Limit on gifts", [["annual", "Up to the federal annual gift-tax exclusion for each person each year"], ["amount", "Up to a total amount I set"]], { showIf: { id: "gifts", equals: true }, required: true, default: "annual" }),
        money("giftAmount", "Total amount of gifts allowed", { showIf: { id: "giftLimit", equals: "amount" }, required: true }),
        yesno("paid", "The agent may be paid a reasonable fee for the work", { default: false }),
      ] },
      { title: "When it starts and ends", questions: [
        pick("startsWhen", "Starts", [["now", "As soon as I sign"], ["incapacity", "Only if a doctor confirms I cannot manage my own affairs"]], { required: true, default: "now" }),
        yesno("durable", "It stays in effect if I become unable to manage my affairs", { default: true }),
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
{{/if}}{{else}}The Agent may act for me only in these matters: {{limitedPowers}}{{/if}}

3. GIFTS AND COMPENSATION
{{#if gifts}}The Agent may make gifts from my property, {{#if giftLimit=annual}}up to the federal annual gift-tax exclusion for each person each year{{else}}up to {{giftAmount}} in total{{/if}}.{{else}}The Agent may not make gifts from my property.{{/if}} {{#if paid}}The Agent may be paid a reasonable fee for the work, and repaid reasonable expenses.{{else}}The Agent will not be paid but may be repaid reasonable expenses.{{/if}}

4. WHEN IT STARTS AND HOW LONG IT LASTS
{{#if startsWhen=now}}This power starts when I sign it.{{else}}This power starts only when a licensed doctor confirms in writing that I cannot manage my own affairs.{{/if}} {{#if durable}}It is a durable power of attorney: it stays in effect if I later become disabled or unable to manage my affairs.{{else}}It ends if I become disabled or unable to manage my affairs.{{/if}} {{#if endDate}}It ends on {{endDate}}, or earlier if I revoke it in writing or I die.{{else}}It lasts until I revoke it in writing or I die.{{/if}}

5. THE AGENT'S DUTIES
The Agent must act in good faith and only within the powers given here; act loyally for my benefit and avoid conflicts of interest; act with care, competence and diligence; keep my property separate from the Agent's own; keep records of every transaction; and give me, my guardian or my personal representative an account when asked. The Agent is not liable if the value of my property goes down without a breach of these duties.

6. REVOCATION, COPIES AND RELIANCE
I may revoke this power at any time by written notice to the Agent. A copy of this document is as good as the original. A person who relies on this document in good faith may keep relying on it until they receive written notice that it has ended. This document is governed by the laws of the State of {{state}}.

PRINCIPAL: {{principal}}
Signature: ______________________________   Date: ______________

AGENT (accepting): {{agent}}
Signature: ______________________________   Date: ______________

ATTESTATION OF WITNESSES
Each of us is an adult. The Principal declared this document to be their power of attorney and signed it (or directed another to sign it for them) in our presence. The Principal appeared to be of sound mind and under no duress, fraud or undue influence. Each of us signed in the presence of the Principal and of each other.

Witness 1: {{witness1}}
Address: {{witness1Address}}
Signature: ______________________________   Date: ______________

Witness 2: {{witness2}}
Address: {{witness2Address}}
Signature: ______________________________   Date: ______________

ACKNOWLEDGMENT BEFORE A NOTARY
State of Maryland, County of {{county}}
On ______________, before me, the undersigned notary public, personally appeared {{principal}}, known to me or satisfactorily proven to be the person who signed this document, and acknowledged that they signed it voluntarily for the purposes stated in it.
Notary public signature and seal: ______________________________
My commission expires: ______________`,
  },
  {
    key: "business_sale_agreement", title: "Sale of a Business Agreement", category: BUSINESS,
    description: "Selling or buying a whole store or business — price, what is included, inventory, lease, licenses and what the seller must not do after the sale.",
    reviewNote: "Before closing, ask the Maryland Comptroller for a tax clearance: a buyer can be held responsible for the seller's unpaid sales tax. Tobacco, lottery, alcohol and food licenses usually do not transfer — the buyer must apply in their own name.",
    steps: [
      { title: "Parties and business", questions: [text("seller", "Seller", { required: true }), text("sellerAddress", "Seller's address"), text("buyer", "Buyer", { required: true }), text("buyerAddress", "Buyer's address"), text("businessName", "Business name", { required: true }), text("businessAddress", "Business address", { required: true }), text("businessKind", "What the business does", { placeholder: "e.g. Convenience store selling groceries, tobacco and lottery" }), effective(), state()] },
      { title: "Price and payment", questions: [
        money("price", "Total price", { required: true }), money("deposit", "Deposit paid now", { default: "0" }),
        pick("payment", "Payment of the rest", [["closing", "All in cash at closing"], ["financed", "Part paid later by the Buyer in installments"]], { required: true, default: "closing" }),
        money("financedAmount", "Amount paid later", { showIf: { id: "payment", equals: "financed" }, required: true }), num("financedMonths", "Number of monthly payments", { showIf: { id: "payment", equals: "financed" }, required: true }),
        date("closingDate", "Closing date", { required: true }),
        pick("inventory", "Inventory (stock)", [["included", "Included in the price"], ["atcost", "Counted on closing day and paid for separately at cost"]], { required: true, default: "atcost" }),
      ] },
      { title: "What is included", questions: [
        area("equipment", "Equipment, fixtures and other assets included", { placeholder: "e.g. Shelving, coolers, cash registers, signs, security cameras" }),
        yesno("leaseTransfer", "The Buyer takes over the Seller's lease of the premises", { default: true }),
        text("landlord", "Landlord", { showIf: { id: "leaseTransfer", equals: true } }),
        area("licenses", "Licenses and permits to transfer or re-apply for", { placeholder: "e.g. Tobacco license, lottery agent, health permit, alcohol license" }),
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
The Seller sells and the Buyer buys the business known as {{businessName}}, located at {{businessAddress}}{{#if businessKind}} ({{businessKind}}){{/if}}, together with its name, customer goodwill, telephone numbers and records, and the assets listed here: {{#if equipment}}{{equipment}}{{else}}the equipment and fixtures at the premises on the date of this agreement{{/if}}.

2. PRICE
The total price is {{price}}. A deposit of {{deposit}} is paid now and counts toward the price. {{#if payment=closing}}The rest is paid in cash at closing.{{else}}At closing the Buyer pays the rest except {{financedAmount}}, which the Buyer pays to the Seller in {{financedMonths}} equal monthly payments after closing, under a separate signed note.{{/if}}

3. INVENTORY
{{#if inventory=included}}The stock on hand at closing is included in the price.{{else}}The stock on hand is counted by both parties on closing day and the Buyer pays the Seller for it at the Seller's cost, in addition to the price above.{{/if}}

4. CLOSING
The sale closes on {{closingDate}}. At closing the Seller hands over the keys, the assets and the records, and signs a bill of sale. The Buyer takes over the business from that time.

5. DEBTS AND TAXES
The Seller stays responsible for all debts, wages, taxes and bills of the business up to the closing date, including any sales tax and payroll tax, and will give the Buyer proof that they are paid or that a tax clearance has been obtained. The Buyer is responsible for the business after closing.

6. LEASE AND LICENSES
{{#if leaseTransfer}}The Seller will assign the lease of the premises to the Buyer{{#if landlord}} with the written consent of {{landlord}}{{/if}}, and this sale depends on that consent.{{else}}The premises are not part of this sale.{{/if}} {{#if licenses}}The following licenses and permits are handled as the law requires, and the Seller will cooperate: {{licenses}}.{{/if}}

7. SELLER'S PROMISES
The Seller states that the Seller owns the assets free of liens, that the information given to the Buyer about sales and expenses is true to the best of the Seller's knowledge, and that no lawsuit or government action is pending against the business except as told to the Buyer in writing.

8. AFTER THE SALE
{{#if helpDays}}For {{helpDays}} days after closing the Seller will help the Buyer with the changeover at no extra charge. {{/if}}{{#if nonCompete}}For {{noCompeteYears}} years after closing the Seller will not own, run or work for a similar business within {{noCompeteMiles}} miles of the premises, and will not seek the business's customers or staff for such a business.{{/if}}

9. GENERAL
This is the whole agreement. It may be changed only in writing signed by both parties, binds their heirs and successors, and is governed by the laws of the State of {{state}}. If a term cannot be enforced the rest stays in force.

SELLER: {{seller}}
Signature: ______________________________   Date: ______________

BUYER: {{buyer}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "ownership_transfer", title: "Membership Interest / Share Transfer Agreement", category: BUSINESS,
    description: "One owner transfers all or part of their ownership in an LLC or corporation to another person.",
    reviewNote: "Check the company's own operating agreement or bylaws: other owners may have to consent or have a first right to buy. Update the company records and tell the tax preparer about the change.",
    steps: [
      { title: "Company and people", questions: [text("company", "Company name", { prefill: "clientName", required: true }), pick("entityType", "The company is", [["llc", "An LLC (membership interest)"], ["corp", "A corporation (shares of stock)"]], { required: true, default: "llc" }), text("assignor", "Owner transferring (Transferor)", { required: true }), text("assignee", "Person receiving (Transferee)", { required: true }), text("assigneeAddress", "Transferee's address"), text("companySigner", "Person who signs for the company", { required: true }), effective(), state()] },
      { title: "Terms", questions: [
        num("percent", "Ownership transferred (%)", { required: true }), money("price", "Price (0 if a gift)", { required: true, default: "0" }),
        text("payWhen", "How and when it is paid", { placeholder: "e.g. In full by bank transfer on the date above" }),
        yesno("othersConsent", "The other owners have agreed in writing", { default: true }),
        yesno("steppingDown", "The Transferor also resigns as manager / officer", { default: false }),
      ] },
    ],
    body: `{{#if entityType=llc}}MEMBERSHIP INTEREST TRANSFER AGREEMENT{{else}}SHARE TRANSFER AGREEMENT{{/if}}

Date: {{effectiveDate}}

1. THE TRANSFER
{{assignor}} ("Transferor") transfers to {{assignee}}{{#if assigneeAddress}} of {{assigneeAddress}}{{/if}} ("Transferee") {{percent}}% of the {{#if entityType=llc}}membership interest{{else}}shares{{/if}} in {{company}} ("Company"), including the matching share of profits, losses, distributions and voting rights, from the date above.

2. PRICE
{{#if price}}The Transferee pays the Transferor {{price}}{{#if payWhen}}: {{payWhen}}{{/if}}.{{else}}This transfer is a gift and no price is paid.{{/if}}

3. THE TRANSFEROR'S PROMISES
The Transferor owns what is transferred free of any lien or claim, has the right to transfer it, and is not aware of any claim against the Company that has not been told to the Transferee.

4. CONSENT
{{#if othersConsent}}All other owners of the Company have agreed in writing to this transfer and to the Transferee becoming an owner.{{else}}This transfer is subject to any consent or first right of purchase required by the Company's own agreement, and takes effect only once it is obtained.{{/if}} The Transferee agrees to be bound by the Company's operating agreement or bylaws.

5. THE COMPANY
The Company accepts the transfer, will record it in its books and update its ownership records, and the Transferee will be treated as the owner of the percentage above from the date of this agreement. {{#if steppingDown}}The Transferor resigns as manager and officer of the Company on the same date.{{/if}}

6. TAXES
Profits and losses for the year are shared between the Transferor and the Transferee in proportion to the time each held the interest, unless the Company's tax preparer advises otherwise in writing.

7. GENERAL
This is the whole agreement on this subject, may be changed only in writing signed by all who sign below, and is governed by the laws of the State of {{state}}.

TRANSFEROR: {{assignor}}
Signature: ______________________________   Date: ______________

TRANSFEREE: {{assignee}}
Signature: ______________________________   Date: ______________

COMPANY: {{company}}, by {{companySigner}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "personal_guaranty", title: "Personal Guaranty", category: LENDING,
    description: "A person promises to pay a business debt personally if the business does not.",
    reviewNote: "A guarantor can lose personal property if the business cannot pay. Read the loan or lease this guaranty supports before signing.",
    steps: [
      { title: "Parties", questions: [text("guarantor", "Guarantor (the person promising)", { required: true }), text("guarantorAddress", "Guarantor's address"), text("creditor", "Creditor (who is owed)", { required: true }), text("borrower", "Business or person whose debt is guaranteed", { prefill: "clientName", required: true }), effective(), state()] },
      { title: "What is guaranteed", questions: [
        area("obligation", "The debt or obligation", { required: true, placeholder: "e.g. The loan of $50,000 dated June 1, 2026, or all rent due under the lease of the store at 12 Main St" }),
        pick("limit", "How much is guaranteed", [["all", "Everything owed under the obligation"], ["capped", "Up to a fixed amount"]], { required: true, default: "all" }),
        money("cap", "The most the Guarantor will pay", { showIf: { id: "limit", equals: "capped" }, required: true }),
      ] },
    ],
    body: `PERSONAL GUARANTY

Date: {{effectiveDate}}

1. THE GUARANTY
{{guarantor}}{{#if guarantorAddress}} of {{guarantorAddress}}{{/if}} ("Guarantor") personally and unconditionally guarantees to {{creditor}} ("Creditor") the full and on-time payment of the following obligation of {{borrower}} ("Borrower"): {{obligation}}

2. HOW MUCH
{{#if limit=all}}The Guarantor is responsible for everything the Borrower owes under that obligation, including interest, fees and the Creditor's reasonable costs of collecting.{{else}}The Guarantor is responsible up to {{cap}} plus the Creditor's reasonable costs of collecting from the Guarantor.{{/if}}

3. NATURE OF THE PROMISE
This is a guaranty of payment, not only of collection: if the Borrower does not pay when due, the Creditor may demand payment from the Guarantor without first suing the Borrower or using any security. The guaranty continues until the obligation is paid in full, even if the Creditor extends time, changes the terms with the Borrower, or accepts partial payments. It also continues if the Borrower's business changes owner, name or form.

4. WHAT THE GUARANTOR GIVES UP
The Guarantor waives notice of default and demand, and the right to require the Creditor to pursue the Borrower first. If the Guarantor pays, the Guarantor takes the Creditor's place against the Borrower only after the Creditor has been paid in full.

5. GENERAL
This guaranty binds the Guarantor's heirs and estate, may be changed only in writing signed by the Guarantor and the Creditor, and is governed by the laws of the State of {{state}}. If a term cannot be enforced the rest stays in force.

GUARANTOR: {{guarantor}}
Signature: ______________________________   Date: ______________

CREDITOR (accepting): {{creditor}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "non_compete", title: "Non-Competition and Non-Solicitation Agreement", category: EMPLOYMENT,
    description: "A person promises not to compete with the business or take its customers or staff, for a limited time and area.",
    reviewNote: "Maryland does not allow non-compete promises for lower-paid workers and courts cut back terms that are too broad. Keep the time and area reasonable and have a lawyer confirm the current wage limit.",
    steps: [
      { title: "Parties", questions: [text("company", "Company", { prefill: "clientName", required: true }), text("person", "Person making the promise", { required: true }), text("personAddress", "Their address"), pick("relation", "That person is", [["employee", "An employee"], ["contractor", "An independent contractor"], ["seller", "The seller of the business"]], { required: true, default: "employee" }), effective(), state()] },
      { title: "The promise", questions: [
        area("activity", "The competing activity", { required: true, placeholder: "e.g. Owning or working for a convenience store or smoke shop" }),
        num("months", "For how many months after the relationship ends", { required: true, default: "12" }), num("miles", "Within how many miles of the company's location", { required: true, default: "5" }),
        yesno("customers", "Not to take the company's customers or suppliers", { default: true }),
        yesno("staff", "Not to hire or recruit the company's staff", { default: true }),
        yesno("confidential", "Keep the company's business information confidential", { default: true }),
      ] },
    ],
    body: `NON-COMPETITION AND NON-SOLICITATION AGREEMENT

Date: {{effectiveDate}}

This agreement is between {{company}} ("Company") and {{person}}{{#if personAddress}} of {{personAddress}}{{/if}} ("{{#if relation=employee}}Employee{{/if}}{{#if relation=contractor}}Contractor{{/if}}{{#if relation=seller}}Seller{{/if}}"), who is called "the Person" below.

1. NON-COMPETITION
For {{months}} months after {{#if relation=seller}}the sale of the business{{else}}the Person's work for the Company ends, for any reason,{{/if}} the Person will not, within {{miles}} miles of the Company's location, own, run, or work for a business engaged in: {{activity}}.

{{#if customers}}2. CUSTOMERS AND SUPPLIERS
During the same period the Person will not seek the Company's customers or suppliers to move their business away from the Company.

{{/if}}{{#if staff}}3. STAFF
During the same period the Person will not hire, or encourage to leave, anyone who works for the Company.

{{/if}}{{#if confidential}}4. CONFIDENTIAL INFORMATION
The Person will keep the Company's private business information (customer and supplier lists, prices, costs, financial records and methods) confidential and will not use it for anyone else, during and after the relationship.

{{/if}}5. FAIRNESS
The Person agrees the limits above are reasonable to protect the Company's legitimate business interests. If a court finds any limit too broad, it may reduce it to what is reasonable rather than cancel it.

6. REMEDIES
If the Person breaks this agreement the Company may ask a court to order them to stop, in addition to any other remedy, and the Person pays the Company's reasonable costs of enforcing it if the Company wins.

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
    steps: [
      { title: "The lease", questions: [text("landlord", "Landlord", { required: true }), text("tenant", "Tenant", { prefill: "clientName", required: true }), text("premises", "Premises address", { required: true }), date("leaseDate", "Date of the original lease", { required: true }), effective(), state()] },
      { title: "What changes", questions: [
        yesno("extend", "Extend the lease term", { default: true }), date("newEnd", "New ending date", { showIf: { id: "extend", equals: true }, required: true }),
        yesno("rentChange", "Change the rent", { default: false }), money("newRent", "New monthly rent", { showIf: { id: "rentChange", equals: true }, required: true }), date("rentFrom", "New rent starts on", { showIf: { id: "rentChange", equals: true }, required: true }),
        area("other", "Any other change", { placeholder: "e.g. Tenant may add a sign at the front of the building" }),
      ] },
    ],
    body: `LEASE AMENDMENT

Date: {{effectiveDate}}

This amendment is between {{landlord}} ("Landlord") and {{tenant}} ("Tenant") and changes the lease dated {{leaseDate}} for the premises at {{premises}} ("the Lease").

{{#if extend}}1. TERM
The Lease term is extended and now ends on {{newEnd}}, unless ended earlier under the Lease.

{{/if}}{{#if rentChange}}2. RENT
Beginning {{rentFrom}}, the monthly rent is {{newRent}}, payable on the same dates and in the same way as before.

{{/if}}{{#if other}}3. OTHER CHANGES
{{other}}

{{/if}}4. NOTHING ELSE CHANGES
All other terms of the Lease stay in full force. If this amendment and the Lease disagree, this amendment controls. This amendment is governed by the laws of the State of {{state}} and may be signed in copies, including electronically.

LANDLORD: {{landlord}}
Signature: ______________________________   Date: ______________

TENANT: {{tenant}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "gift_letter", title: "Gift Letter", category: FAMILY,
    description: "States that money given to someone — usually for a home purchase — is a gift and does not have to be repaid.",
    reviewNote: "A mortgage lender may require its own form, the donor's bank statement showing the funds, and proof of the transfer. Large gifts can have gift-tax filing rules; ask the tax preparer.",
    steps: [
      { title: "People", questions: [text("donor", "Donor (person giving the gift)", { required: true }), text("donorAddress", "Donor's address"), text("donorPhone", "Donor's phone"), text("recipient", "Recipient (person receiving it)", { prefill: "clientName", required: true }), text("relationship", "Donor's relationship to the Recipient", { required: true, placeholder: "e.g. Father, Sister, Friend" }), effective()] },
      { title: "The gift", questions: [
        money("amount", "Amount of the gift", { required: true }), date("giftDate", "Date given or to be given"),
        pick("purpose", "What it is for", [["home", "A down payment or closing costs on a home"], ["other", "Another purpose"]], { required: true, default: "home" }),
        text("property", "Address of the home being bought", { showIf: { id: "purpose", equals: "home" } }), text("lender", "Mortgage lender (if known)", { showIf: { id: "purpose", equals: "home" } }),
        text("source", "Where the money comes from", { placeholder: "e.g. The Donor's savings account at ABC Bank" }),
      ] },
    ],
    body: `GIFT LETTER

Date: {{effectiveDate}}

I, {{donor}}{{#if donorAddress}} of {{donorAddress}}{{/if}}{{#if donorPhone}} (telephone {{donorPhone}}){{/if}}, the Donor, state:

1. I am giving {{recipient}}, my {{relationship}}, the sum of {{amount}}{{#if giftDate}} on or about {{giftDate}}{{/if}}.

2. This is a gift. I do not expect it to be repaid in money, property or services, now or in the future, and no loan is involved.

3. {{#if purpose=home}}The gift is to help with the down payment or closing costs for the purchase of the home at {{property}}{{#if lender}}, financed by {{lender}}{{/if}}.{{else}}The gift is for the Recipient's own use.{{/if}}

4. {{#if source}}The money comes from {{source}}.{{else}}The money comes from my own funds.{{/if}} It does not come from the seller, a real estate agent, a builder, or anyone else who has an interest in the sale of the home.

5. I understand that I may be asked to give my bank records to show where the money came from.

DONOR: {{donor}}
Signature: ______________________________   Date: ______________

RECIPIENT (acknowledging): {{recipient}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "business_poa", title: "Business Power of Attorney (Operations, Banking & Tax)", category: BUSINESS,
    description: "A business gives a trusted person authority to run daily operations, handle bank accounts, and deal with tax and government matters — each power can be switched on or off.",
    reviewNote: "Banks usually insist on their own authorization form and a company resolution as well — bring this document, the Articles / EIN letter and a corporate resolution (also in this builder). Sign in front of a notary. For dealing with the IRS or the Maryland Comptroller, the official forms (2848 / 8821 / MD 548) are still needed.",
    steps: [
      { title: "The business and the agent", questions: [text("company", "Business giving the authority", { prefill: "clientName", required: true }), text("companyAddress", "Business address", { prefill: "clientAddress" }), text("owner", "Owner / officer signing for the business", { required: true }), text("ownerTitle", "Their title", { required: true, placeholder: "e.g. Owner, Managing Member, President" }), text("agent", "Person receiving the authority (agent)", { required: true }), text("agentAddress", "Agent's address"), effective(), state()] },
      { title: "Bank accounts", description: "Switch off anything the agent should not do.", questions: [
        yesno("bank", "Banking powers", { default: true }),
        text("banks", "Which banks", { showIf: { id: "bank", equals: true }, placeholder: "Leave empty for any bank or credit union" }),
        yesno("openClose", "Open and close accounts", { showIf: { id: "bank", equals: true }, default: true }),
        yesno("limitWithdraw", "Limit what the agent may withdraw or transfer in one transaction", { showIf: { id: "bank", equals: true }, default: false }),
        money("withdrawLimit", "Highest single withdrawal or transfer", { showIf: { id: "limitWithdraw", equals: true }, required: true }),
      ] },
      { title: "Operations, tax and licenses", questions: [
        yesno("operations", "Run daily operations — purchases, vendors, inventory, contracts, point-of-sale and merchant accounts", { default: true }),
        yesno("staff", "Hire, supervise, pay and let go of employees, and run payroll", { default: true }),
        yesno("tax", "Tax matters — prepare, sign and file sales tax, payroll tax and income tax returns, pay taxes, receive notices and deal with tax offices", { default: true }),
        yesno("licenses", "Apply for, renew, change and close licenses and permits", { default: true }),
        yesno("borrow", "Borrow money, sign loans or credit applications for the business", { default: false }),
        yesno("property", "Buy, sell or lease property or major equipment for the business", { default: false }),
        yesno("ownership", "Sell the business, change who owns it, or add / remove owners", { default: false }),
        yesno("giveAway", "Give away or donate the business's money or property", { default: false }),
        yesno("approval", "Anything above a set amount needs the owner's written approval first", { default: false }),
        money("approvalAmount", "Approval is needed above", { showIf: { id: "approval", equals: true }, required: true }),
      ] },
      { title: "How long", questions: [date("endDate", "Ends on (leave empty until cancelled)"), text("witness1", "First witness (printed name)"), text("witness2", "Second witness (printed name)")] },
    ],
    body: `BUSINESS POWER OF ATTORNEY

Date: {{effectiveDate}}

1. APPOINTMENT
{{company}}{{#if companyAddress}}, of {{companyAddress}},{{/if}} (the "Business"), acting through {{owner}}, its {{ownerTitle}}, appoints {{agent}}{{#if agentAddress}} of {{agentAddress}}{{/if}} ("Agent") as its attorney-in-fact to act for the Business and sign in its name in the matters listed below. {{owner}} confirms having the authority to give this power on behalf of the Business.

2. POWERS GIVEN
{{#if bank}}A. BANKING. {{#if banks}}At {{banks}}{{else}}At any bank or credit union{{/if}}, the Agent may{{#if openClose}} open and close accounts,{{/if}} deposit and withdraw money, write, sign and endorse checks, make transfers, wires and electronic payments, use and manage online banking and debit or credit cards of the Business, get statements and records, and sign the bank's forms and signature cards.{{#if limitWithdraw}} The Agent may not withdraw or transfer more than {{withdrawLimit}} in any one transaction.{{/if}}

{{/if}}{{#if operations}}B. DAILY OPERATIONS. The Agent may run the day-to-day business: buy goods and supplies, deal with vendors and customers, set up and use point-of-sale and merchant accounts, sign ordinary contracts and orders, manage inventory and premises, and keep the books and records.

{{/if}}{{#if staff}}C. STAFF AND PAYROLL. The Agent may hire, supervise, pay and end the employment of staff, and run payroll, including payroll deposits and filings.

{{/if}}{{#if tax}}D. TAX AND GOVERNMENT MATTERS. The Agent may prepare, sign and file the Business's sales tax, payroll tax and income tax returns, pay taxes, receive notices and correspondence, and deal with federal, state and local tax offices on the Business's behalf, to the extent the law accepts this document for that purpose.

{{/if}}{{#if licenses}}E. LICENSES AND PERMITS. The Agent may apply for, renew, change and close licenses and permits of the Business.

{{/if}}{{#if borrow}}F. BORROWING. The Agent may borrow money for the Business and sign loan and credit documents in its name.

{{/if}}{{#if property}}G. PROPERTY. The Agent may buy, sell or lease property and major equipment for the Business.

{{/if}}{{#if ownership}}H. SALE AND OWNERSHIP. The Agent may sell the Business or its assets, change who owns the Business, and add or remove owners, and sign the papers needed to do so.

{{/if}}{{#if giveAway}}I. GIFTS. The Agent may give away or donate the Business's money or property.

{{/if}}3. LIMITS
{{#if approval}}For any single purchase, payment, contract or commitment above {{approvalAmount}}, the Agent must first get the written approval of {{owner}} or another owner of the Business. {{/if}}{{#if ownership}}{{else}}The Agent may not sell the Business or change who owns it, and may not add or remove owners. {{/if}}{{#if giveAway}}{{else}}The Agent may not give away the Business's money or property. {{/if}}No power is given beyond those listed above.

4. DUTIES
The Agent must act in the Business's best interest, keep its money separate from the Agent's own, keep records of what is done, and give the owners an account whenever they ask. The owners may inspect all accounts and records at any time.

5. HOW LONG IT LASTS
This power starts when signed. {{#if endDate}}It ends on {{endDate}}, or earlier if{{else}}It lasts until{{/if}} the Business cancels it in writing. Cancelling must be given in writing to the Agent and to each bank or office relying on this document. People who rely on it in good faith are protected until they receive written notice that it has ended.

6. GENERAL
A copy of this document is as good as the original. It is governed by the laws of the State of {{state}}.

BUSINESS: {{company}}
By: {{owner}}, {{ownerTitle}}
Signature: ______________________________   Date: ______________

AGENT (accepting): {{agent}}
Signature: ______________________________   Date: ______________

WITNESSES
1. {{witness1}}   Signature: ______________________________
2. {{witness2}}   Signature: ______________________________

NOTARY: signed and sworn before me on ______________  Notary signature and seal: ______________________________`,
  },
  {
    key: "limited_poa_filings", title: "Limited Power of Attorney — Licenses, Permits & State Tax Filings", category: CLIENT_SERVICE,
    description: "A business names the firm to obtain its licenses, permits and records and to file its Maryland sales/use and withholding tax — only for the matters ticked, nothing more. Based on the firm's own POA template.",
    reviewNote: "This gives the firm authority to deal with offices for the business, but the Comptroller and the IRS still require their own authorization forms to act on tax accounts (Maryland Form 548, IRS 2848 / 8821). Some offices ask for a notarized power, so the notary block is on by default. Have a Maryland attorney review before use.",
    steps: [
      { title: "The business", questions: [
        text("principal", "Business giving the authority", { prefill: "clientName", required: true }),
        text("entityDesc", "Kind of business", { placeholder: "e.g. a Maryland limited liability company" }),
        text("principalAddress", "Business street address", { prefill: "clientAddress", required: true }),
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
        date("endDate", "Ends on (leave empty to continue until revoked)"),
        yesno("notarize", "Include a notary acknowledgment", { default: true }),
        text("county", "County where it is signed", { showIf: { id: "notarize", equals: true }, placeholder: "e.g. Baltimore City" }),
        effective(), state(),
      ] },
    ],
    body: `LIMITED POWER OF ATTORNEY
Licenses, Permits and State Tax Filings

Date: {{effectiveDate}}

1. APPOINTMENT
{{principal}}{{#if entityDesc}}, {{entityDesc}},{{/if}} with street address {{principalAddress}} (the "Principal"), acting through {{signerName}}, its {{signerTitle}}, grants a limited and specific power of attorney to {{firmName}}{{#if firmAddress}}, {{firmAddress}},{{/if}} represented by {{rep1}}{{#if rep2}} and {{rep2}}{{/if}} (each an "Attorney-in-Fact", together the "Attorneys-in-Fact"). {{signerName}} confirms having the authority to give this power on behalf of the Principal.

2. POWERS GIVEN
The Attorneys-in-Fact may act for the Principal, and deal with the offices concerned, only for these purposes:
{{#if pSales}}• Obtain, renew, amend or close the Principal's Sales and Use Tax license.
{{/if}}{{#if pArticles}}• Obtain copies of the Principal's Articles of Incorporation / Organization and other business records from the State Department of Assessments and Taxation.
{{/if}}{{#if pEbt}}• Apply for or maintain the Principal's EBT / SNAP permit.
{{/if}}{{#if pFile}}• Prepare and file the Principal's Maryland sales and use tax and withholding tax returns and make the related payments.
{{/if}}{{#if pOccupancy}}• Apply for and obtain a new occupancy permit from the relevant authorities.
{{/if}}{{#if pTobacco}}• Apply for, renew or amend the Principal's tobacco / cigarette retail license.
{{/if}}{{#if pHealth}}• Apply for and maintain the Principal's health department or food service permit.
{{/if}}{{#if pLocal}}• Apply for, renew or amend the Principal's local business, trader's and other county or city licenses.
{{/if}}{{#if pAnnual}}• File the Principal's annual report and personal property return with the State Department of Assessments and Taxation.
{{/if}}{{#if pUI}}• Handle the Principal's Maryland unemployment insurance account matters.
{{/if}}{{#if other}}• {{other}}
{{/if}}The Attorneys-in-Fact may also handle all related communications for the Principal and do the incidental acts reasonably needed to carry out these purposes.

3. SIGNING
{{#if signDocs}}The Attorneys-in-Fact may sign applications, forms, agreements and letters in the Principal's name, but only as needed for the purposes in Section 2.{{else}}The Attorneys-in-Fact may prepare and submit documents for the Principal but may not sign them in the Principal's name.{{/if}}

4. LIMITS
This power does not include the power to sell or mortgage the business or its property, borrow money, open or close bank accounts, sign checks or withdraw funds, change the ownership of the business, make gifts, or sign any contract other than those needed for the purposes in Section 2. Taxes and fees are paid only from funds the Principal provides.

5. DUTIES
The Attorneys-in-Fact accept this appointment on these terms and will act in the Principal's best interest and only within these powers, keep records of what they do, give the Principal copies of every filing, license, permit and notice, and keep the Principal's information confidential, using it only for these purposes.

6. WHEN IT STARTS AND ENDS
This power takes effect when it is signed {{#if endDate}}and ends on {{endDate}}{{else}}and stays in effect until the Principal ends it{{/if}}. The Principal may revoke it at any time by written notice to the Attorneys-in-Fact. When they receive that notice they will stop acting and promptly return all documents, funds and property belonging to the Principal. An Attorney-in-Fact may resign by written notice to the Principal.

7. COPIES AND RELIANCE
A copy of this document is as good as the original. An office or person who relies on it in good faith may keep relying on it until they receive written notice that it has ended.

8. GOVERNING LAW
This power of attorney is governed by the laws of the State of {{state}}.

PRINCIPAL: {{principal}}
By: {{signerName}}, {{signerTitle}}
Signature: ______________________________   Date: ______________

ACCEPTANCE OF APPOINTMENT
I, {{rep1}}, the Attorney-in-Fact named above, accept this appointment in accordance with the foregoing instrument.
{{firmName}}{{#if firmAddress}}, {{firmAddress}}{{/if}}{{#if rep1Phone}}, {{rep1Phone}}{{/if}}{{#if firmEmail}}, {{firmEmail}}{{/if}}
Signature: ______________________________   Date: ______________

{{#if rep2}}I, {{rep2}}, the Attorney-in-Fact named above, accept this appointment in accordance with the foregoing instrument.
{{firmName}}{{#if firmAddress}}, {{firmAddress}}{{/if}}{{#if rep2Phone}}, {{rep2Phone}}{{/if}}{{#if firmEmail}}, {{firmEmail}}{{/if}}
Signature: ______________________________   Date: ______________

{{/if}}{{#if notarize}}ACKNOWLEDGMENT BEFORE A NOTARY
State of Maryland, County of {{county}}
On ______________, before me, the undersigned notary public, personally appeared {{signerName}}, known to me or satisfactorily proven to be the person who signed this document for {{principal}}, and acknowledged that they signed it voluntarily for the purposes stated in it, with authority to do so.
Notary public signature and seal: ______________________________
My commission expires: ______________{{/if}}`,
  },
];

export function getDocTemplate(key: string): DocTemplate | undefined { return DOC_TEMPLATES.find((t) => t.key === key); }
