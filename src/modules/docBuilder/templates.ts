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
    reviewNote: "A tax practitioner must return a client's records on request even if a fee is unpaid (31 CFR §10.28), so this agreement says so; the records covered are the client's own documents and other records the federal rule requires (the firm's own unpaid work product is not promised). Fees here are flat, monthly or hourly — never based on the size of a refund (Circular 230 §10.27 limits contingent fees). Interest on overdue invoices now defaults to 0.5% a month (6% a year, Maryland's legal rate when a contract is silent, Commercial Law §12-102); Maryland caps interest on loans and some credit (§12-103) and the rules for individuals may be stricter, so confirm any higher rate with an attorney before charging it — personal tax-return clients are consumers. Added: e-file signature and error-notice duties of the client, refund checks, electronic delivery, file retention (the firm must keep a copy or list of each return for at least 3 years), notices, electronic signature and an additional-terms box. Not included on purpose: a cap on the firm's liability and a shortened time to sue — ask an attorney. Have an attorney review before use.",
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
        num("lateFeePercent", "Interest on overdue invoices (% per month)", { showIf: { id: "lateFee", equals: true }, default: "0.5", required: true, help: "0.5% a month is 6% a year, Maryland's legal rate. Do not go above 2% a month; for an individual client check the limit with an attorney first." }),
        state(),
      ] },
      { title: "Other terms", questions: [
        num("retentionYears", "Years the firm keeps the client's file after the work ends", { default: "7", help: "The firm must keep a copy or list of each return it prepares for at least 3 years. Leave blank to say 'the period required by law and the firm's records policy'." }),
        area("additionalTerms", "Additional terms (optional)", { placeholder: "e.g. Busy-season delivery dates, rush fees, or who the contact person is" }),
      ] },
    ],
    body: `FEE AGREEMENT

This Fee Agreement is made on {{effectiveDate}} between {{firmName}} ("the Firm") and {{clientName}}{{#if clientAddress}}, of {{clientAddress}}{{/if}} ("the Client").

1. SERVICES
The Firm will provide the following services{{#if period}} for {{period}}{{/if}}:
{{services}}
Services not listed above are outside this agreement and will be quoted separately.

2. FEES
{{#if feeType=flat}}The Client will pay a flat fee of {{amount}} for the services above.{{/if}}{{#if feeType=monthly}}The Client will pay a fee of {{amount}} per month for the services above. This agreement continues month to month until it is ended as described in the section on termination and records, and a change in the monthly fee needs 30 days' written notice.{{/if}}{{#if feeType=hourly}}The Client will pay {{amount}} per hour for time spent on the services above, billed as the work is done.{{/if}}
{{#if retainer}}A retainer of {{retainerAmount}} is due before work begins and will be applied to the Firm's invoices. Any part not used when the work ends will be refunded to the Client.{{/if}}
Government filing fees, penalties and interest, and out-of-pocket costs are not included in the fee and are paid by the Client. The fee is not based on the size of any refund or tax saving. The Firm does not guarantee any result, refund or outcome with any tax authority.{{#if feeType=flat}} A flat fee is invoiced when the work is delivered unless the Firm states otherwise in writing.{{/if}}

3. PAYMENT
Invoices are due within {{dueDays}} days of the invoice date.{{#if lateFee}} Balances unpaid after the due date bear simple (non-compounded) interest at {{lateFeePercent}}% per month, but never more than the maximum rate the law allows.{{/if}} The Firm may pause new work while an invoice is overdue, but will tell the Client in writing which filing deadlines are affected and will still return the Client's records on request.

4. CLIENT RESPONSIBILITIES
The Client will provide complete and accurate records and information promptly, and is responsible for the accuracy of what the Client supplies. The Firm relies on that information and does not audit or independently verify it. The Client will review each return or report before it is signed or filed and, for an electronically filed return, will sign the IRS e-file authorization before the Firm sends it. If the Firm learns of an error or omission in an earlier filing, it will promptly tell the Client and explain the consequences, and the Client decides how to correct it. A refund check issued to the Client by a tax authority must be endorsed and deposited by the Client; the Firm may not do so.

5. TERMINATION AND RECORDS
Either party may end this agreement by ten (10) days' written notice. The Client remains responsible for fees and costs for work performed up to the end date. The Firm will return the Client's own records on request, whether or not an invoice is unpaid; this covers the documents the Client gave the Firm and any other records that federal tax-practice rules require the Firm to return. If the Firm pauses or ends work because of an unpaid invoice or missing information, it will tell the Client in writing which filing deadlines are affected, and the Firm is not responsible for penalties or interest that result from that pause or ending.

6. FILE RETENTION AND ELECTRONIC DELIVERY
The Client should keep the originals of all source documents. The Firm will keep its file for {{#if retentionYears}}{{retentionYears|year}}{{else}}the period the law and the Firm's records policy require{{/if}} after the work ends (or longer if the law requires) and may then securely destroy it. The Firm may send documents, invoices and notices by email or through its secure client portal unless the Client asks in writing for paper.

{{#if additionalTerms}}7. ADDITIONAL TERMS
{{additionalTerms}}

{{/if}}8. GENERAL AND GOVERNING LAW
This is the entire agreement about these services and may be changed only in writing signed by both parties. Neither party may transfer it to someone else without the other's written consent. Notices must be in writing and may be delivered by hand, by mail or by email to the address the other party last gave. If a disagreement arises, the parties will first try in good faith to resolve it by discussion; this does not stop either party from going to court. If any part is held invalid, the rest stays in effect. This agreement may be signed electronically and in counterparts, and each copy is an original. The Firm will keep the Client's information confidential and will disclose it only as the Client authorizes in writing or the law requires. This agreement is governed by the laws of the State of {{state}}.

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
    reviewNote: "Representation before the IRS or the Comptroller of Maryland needs the official forms (IRS 2848; Maryland 548) — this letter says so. Added in this review: e-file signature before transmission, the firm's duty to tell the client of an error or omission it learns of (Circular 230 §10.21), a joint-client sentence (spouses — the firm must explain any conflict and get written consent, §10.29), refund checks (§10.31), electronic delivery and file retention. If the letter covers more than one person, name them all in the client name. Have an attorney review before use.",
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
You agree to give us complete, accurate and timely information and records, to review the work we prepare before it is signed, filed or relied on (for an electronically filed return, you will sign the IRS e-file authorization before we send it), and to tell us promptly about changes that affect it. We rely on the information you provide and do not audit or independently verify it. You are responsible for the final content of anything filed in your name and for any tax, penalty or interest. If we learn of an error or omission in an earlier filing, we will tell you promptly and explain the consequences; how to correct it is your decision. If this letter is addressed to more than one person, each of you is responsible for the information and the fees, and each of you may ask us for the records; if your interests may differ, we will explain this and ask for your written consent before we continue.

WHAT WE CANNOT PROMISE
We cannot guarantee any refund or result, and we do not give legal advice. We cannot endorse or deposit a refund check issued to you. Representation before the IRS or the Comptroller of Maryland is not included unless we agree in writing and you sign the official form (IRS Form 2848 / Maryland Form 548).

CONFIDENTIALITY, RECORDS AND ELECTRONIC DELIVERY
We keep your information confidential and release it only with your written consent or as the law requires. We may send documents and messages by email or through our secure client portal unless you ask us in writing for paper. Please keep your original source documents. We keep our file for the period the law and our records policy require and may then securely destroy it.

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
    reviewNote: "For tax-return information this works as a consent under IRC §7216 (26 CFR §301.7216-3): it must name the preparer, taxpayer, purpose, recipient and the specific information, and be signed and dated BEFORE anything is released; services cannot be made to depend on it. For Form 1040 filers Rev. Proc. 2013-14 also prescribes required statements (federal law may not protect the information after release; not required to sign; one-year default; TIGTA contact) and a paper form of letter-size paper in at least 12-point type containing only this authorization, with no blanks left to fill after signing — the statements were added in this review from the IRS text, but compare them word for word with Rev. Proc. 2013-14 §5.04 before relying on them. Not covered: disclosure to someone OUTSIDE the United States (extra statements are required) and electronic signing (Rev. Proc. 2013-14 §6). The information box must be specific — do not write 'all records'. It is not an IRS 2848/8821 or Maryland Form 548. Have an attorney review before use.",
    steps: [
      { title: "Who and what", questions: [text("clientName", "Client name", { prefill: "clientName", required: true }), text("firmName", "Firm name", { prefill: "firmName", required: true }), effective(),
        text("recipient", "Share information with (person or company)", { required: true }), text("recipientAddress", "Their address or email"),
        area("information", "Information that may be shared", { required: true, placeholder: "e.g. Tax returns and financial statements for 2024 and 2025", help: "Be specific: name each kind of record and the years. Do not write 'everything' or 'all records'." }),
        area("purpose", "Purpose", { required: true, placeholder: "e.g. Loan application with First Bank" }),
        pick("duration", "How long does this authorization last?", [["date", "Until a date"], ["onetime", "One time only"], ["revoked", "Until I cancel it in writing"]], { required: true, default: "date" }),
        date("expires", "Expires on (must be after the date I sign)", { showIf: { id: "duration", equals: "date" }, required: true })] },
    ],
    body: `AUTHORIZATION TO RELEASE INFORMATION

Prepared: {{effectiveDate}}

Federal law requires {{firmName}} to give you this consent form. Unless the law allows it, {{firmName}} cannot disclose your tax return information to anyone else for any purpose other than preparing and filing your tax return without your consent.

I, {{clientName}}, authorize {{firmName}} to release the information described below to:

{{recipient}}{{#if recipientAddress}}
{{recipientAddress}}{{/if}}

INFORMATION THAT MAY BE SHARED
{{information}}

PURPOSE
{{purpose}}

DURATION
{{#if duration=date}}This authorization takes effect on the date I sign it below and expires on {{expires}}.{{/if}}{{#if duration=onetime}}This authorization takes effect on the date I sign it below and covers a single release of the information above, made within 90 days of the date I sign.{{/if}}{{#if duration=revoked}}This authorization takes effect on the date I sign it below and stays in force until I cancel it by written notice to {{firmName}}.{{/if}}

IMPORTANT STATEMENTS
If I consent, federal law may not protect my tax return information from further use or distribution. I am not required to sign this authorization to receive {{firmName}}'s tax return preparation services, and if {{firmName}} made its services depend on my signing, this consent would not be valid. {{firmName}} will not release anything before I have signed and dated this form. I may cancel this authorization at any time by written notice to {{firmName}}, except for information already released. If no end date is stated, this consent is valid for one year from the date I sign. I will receive a copy. If I believe my tax return information has been disclosed or used improperly in a manner unauthorized by law or without my permission, I may contact the Treasury Inspector General for Tax Administration (TIGTA) by telephone at 1-800-366-4484 or by email at complaints@tigta.treas.gov. This authorization covers only the information listed above and does not include my Social Security number or EIN unless listed. I ask that the recipient not pass the information on without my permission. {{firmName}} is not responsible for how the recipient uses the information after it is released. This authorization does not allow {{firmName}} to act on my behalf before any tax authority.

{{clientName}}
Printed name and title (if signing for a business): ______________________________
Signature: ______________________________   Date: ______________
Spouse (joint return only): Signature: ______________________________   Date: ______________`,
  },
  {
    key: "termination_of_services", title: "Termination of Services Letter", category: CLIENT_SERVICE,
    description: "Formally ends the working relationship with a client and sets out what happens to records and balances.",
    reviewNote: "Keep the reason empty unless your attorney advises otherwise. A tax practitioner must return client records on request even if a balance is unpaid (31 CFR §10.28). Withdrawing from an IRS 2848, a Maryland Form 548 or other authorizations is stated in the letter — also do it with each office (for the IRS, send the withdrawal in writing). Added in this review: a promise to forward any notice the firm still receives, and what the firm keeps and what the client may ask for. Check any open filing deadline before sending, especially if the firm is the one ending the relationship.",
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
Effective {{lastDay}} we withdraw as your representative on every power of attorney we hold for you, and we end every other authorization and account access we hold for you (including IRS Form 2848/8821, Maryland Comptroller Form 548 and Maryland unemployment insurance access). Until you file new authorizations and update your contact details with each agency, notices may still be sent to us; if we receive one, we will send it to you promptly.

{{#if pending}}OPEN ITEMS AND DEADLINES
{{pending}}
Missing these dates may cause penalties; please consider engaging another preparer now.

{{/if}}{{#if balance}}OUTSTANDING BALANCE
Our records show an unpaid balance of {{balanceAmount}}, which remains due.

{{/if}}RECORDS
{{#if records}}Your records are returned with this letter. Please keep them; you are responsible for retaining copies as required by law.{{else}}Please contact us to arrange the return of your records.{{/if}} Your records belong to you, and we will return them on request whether or not any balance is paid. You may also ask us for another copy of any return we prepared and delivered to you. We keep our own file for the period the law and our records policy require and may then securely destroy it.

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
{{#if how}}{{how}} {{/if}}Please send copies and keep your originals.

If any item does not apply, or you are not sure what we mean, please tell us and we will help. If we do not receive these by {{dueDate}}, we may not be able to file on time, and we may have to pause the work or file an extension where possible. An extension gives more time to file, not more time to pay, and you remain responsible for any penalty or interest.

Thank you,

Signature: ______________________________
{{firmName}}{{#if contact}}
Contact: {{contact}}{{/if}}`,
  },

  /* ─────────────── Business formation & ownership ─────────────── */
  {
    key: "llc_operating_agreement", title: "LLC Operating Agreement", category: BUSINESS,
    description: "Sets out who owns an LLC with two or more members, how it is run, who signs for the business, how members are paid, how profits are shared, what happens on a death or a sale, and how an owner can leave.",
    reviewNote: "Have an attorney review an operating agreement before the members sign it. Points to confirm with an attorney or the tax preparer: (1) For a manager-managed LLC, the limit on members' authority protects the Company against outsiders only if the articles of organization on file with the State Department of Assessments and Taxation also say that members are not agents (Maryland LLC Act §4A-401) — ask whether to amend the articles. In a member-managed LLC every member can bind the Company in its usual business. (2) An S corporation election must be filed with the IRS on time (Form 2553) and every member must be an eligible owner (an individual, or certain trusts and estates — not a company or partnership). An S corporation must give every member identical rights to distributions and to liquidation proceeds, so unequal buyout terms, payback of capital first or any special payout can put the election at risk (Treas. Reg. §1.1361-1(l)). (3) Partnerships and S corporations generally must use a December 31 year-end. (4) Licenses (tobacco, lottery, alcohol, SNAP, health), the lease and any loan may need notice or consent when ownership changes. (5) The percentages are not checked by the software — make sure they total 100. (6) The optional non-competition promise between members must be reasonable in time and area; an attorney should confirm it. (7) Under Maryland's default rule a member may withdraw on six months' written notice unless the agreement says otherwise (§4A-605); this agreement sets its own notice period and buyout rules instead — confirm that is what the members want. (8) The partnership-tax clauses (capital accounts, partnership representative, sharing of audit tax) are a starting point for the tax preparer. (9) Two members with equal votes can deadlock; the agreement offers mediation but no tie-breaker. (10) Improved using a LawDepot-style sample; its 'treated as a corporation' tax clause, its automatic five-year non-compete and its one-vote-per-member rule were not copied as fixed terms — they are choices here. Confirm with an attorney that the optional removal-of-a-member clause, the buyout valuation (including goodwill) and the member-authority wording fit the Maryland LLC Act and the members' wishes. If the spouses of married members should be bound by the transfer and buyout rules, switch on the spouse consent page.",
    steps: [
      { title: "The company", questions: [text("companyName", "LLC name", { prefill: "clientName", required: true }), state({ id: "formedIn", label: "State where the LLC is formed", prefill: "stateName" } as Partial<Question>), date("formationDate", "Date formed", { required: true, prefill: "formationDate" }), text("address", "Principal address", { prefill: "clientAddress", required: true }), text("purpose", "Business purpose", { default: "any lawful business" }), effective(),
        date("asOf", "Effective as of (leave empty if the same as the date above)", { help: "Use this when the business started earlier and the members are putting their agreement in writing now." }),
        yesno("replaces", "This replaces any earlier operating agreement or understanding among the members", { default: true })] },
      { title: "Members", questions: [list("members", "Members (owners) — percentages should total 100", [text("name", "Name (person or company)", { required: true }), text("address", "Address"), money("contribution", "Capital contributed", { required: true }), num("percent", "Ownership %", { required: true })], { required: true, minItems: 2, addLabel: "Add a member" })] },
      { title: "How it runs", questions: [
        pick("management", "Who manages the LLC?", [["members", "All members together (member-managed)"], ["manager", "A named manager (manager-managed)"]], { required: true, default: "members" }),
        text("manager", "Manager's name", { showIf: { id: "management", equals: "manager" }, required: true }),
        pick("bankAuth", "Who may open bank accounts and sign checks?", [["majority", "Whoever the members choose, by majority"], ["any", "Any one member"], ["all", "Every member must sign"]], { required: true, default: "majority", showIf: { id: "management", equals: "members" } }),
        pick("memberWork", "Members who work in the business", [["paid", "Are paid for their work, as the members decide"], ["unpaid", "Are not paid — they receive distributions only"]], { required: true, default: "paid" }),
        yesno("competeBan", "Members may not own or run a competing business nearby while they are members and for 12 months after (within 5 miles)", { default: false }),
        yesno("licensed", "The business holds licenses or permits that must be reported when owners change (for example tobacco, lottery, alcohol or health permits)", { default: true }),
        pick("taxClass", "How is the LLC taxed?", [["partnership", "Partnership (two or more members)"], ["scorp", "S corporation"]], { required: true, default: "partnership", help: "For a one-owner LLC use the Single-Member LLC Operating Agreement instead. An S corporation can only have eligible owners (individuals, certain trusts and estates) — not companies." }),
        text("partnershipRep", "Partnership representative for IRS audits (a member)", { showIf: { id: "taxClass", equals: "partnership" }, help: "Leave blank and the agreement says the members will appoint one." }),
        pick("distributions", "How are profits shared?", [["percent", "In proportion to ownership percentages"], ["equal", "Equally"]], { required: true, default: "percent", showIf: { id: "taxClass", equals: "partnership" }, help: "An S corporation must always share in proportion to ownership." }),
        text("fiscalYear", "Fiscal year ends", { default: "December 31", help: "Partnerships and S corporations generally must use December 31 — confirm with the tax preparer before changing it." }),
        yesno("consentToTransfer", "Require the other members' consent before an interest is sold or transferred?", { default: true }),
        num("noticeDays", "Days of written notice to withdraw or sell", { required: true, default: "60" }),
        num("buyDays", "Days the other members have to decide whether to buy", { required: true, default: "30" }),
        num("payMonths", "Longest period (months) for paying the buyout price in installments", { required: true, default: "24" }),
        yesno("mediation", "Disagreements go to mediation before any lawsuit", { default: true }),
        state(),
      ] },
      { title: "Rules between members", questions: [
        pick("voting", "How do members vote?", [["percent", "In proportion to ownership percentages"], ["equal", "One vote per member"]], { required: true, default: "percent", help: "With two members who each hold 50% (or one vote each) no decision can pass without both." }),
        num("meetingDays", "Days of written notice for a members' meeting", { required: true, default: "5" }),
        yesno("expulsion", "The other members may remove a member for serious misconduct or an uncured breach", { default: true }),
        yesno("goodwill", "Include goodwill (name, reputation, customers) when valuing an interest that is bought out", { default: true }),
        yesno("audit", "Any member may ask for an annual audit at the Company's cost (once a year)", { default: false }),
        yesno("lifeInsurance", "The Company may buy life insurance on the members to fund a buyout", { default: false }),
        yesno("spouseConsent", "Add a page for the spouses of married members to sign, agreeing to the transfer and buyout rules", { default: false }),
        area("extraClauses", "Any additional terms the members want (optional)", { placeholder: "e.g. Ali may buy Omar's share at a set price after five years" }),
      ] },
    ],
    body: `OPERATING AGREEMENT OF {{companyName}}
(a {{formedIn}} limited liability company)

This Operating Agreement is made on {{effectiveDate}}{{#if asOf}} and is effective as of {{asOf}}{{/if}} by the members listed below for {{companyName}} (the "Company"), a limited liability company formed under the laws of {{formedIn}} on {{formationDate}} by filing its articles of organization.{{#if replaces}} This Agreement replaces any earlier operating agreement or understanding among the members about the Company.{{/if}}

1. FORMATION, NAME AND PURPOSE
The members form the Company as a limited liability company under the laws of {{formedIn}}. Its name is {{companyName}}. Its principal office is {{address}}, or another place the members choose. Its purpose is {{purpose}}. The Company continues until dissolved under this Agreement or the law. The Company keeps a registered (resident) agent in {{formedIn}} as the law requires, and files its yearly report and pays its fees on time to stay in good standing. The members' rights and duties are those the {{formedIn}} limited liability company law gives them, except where this Agreement provides differently and the law allows it.

2. MEMBERS, CAPITAL AND OWNERSHIP
The members, their capital contributions and their ownership percentages are:
{{#list members}}• {{name}}{{#if address}}, {{address}}{{/if}} — capital contribution {{contribution}}; ownership {{percent}}%
{{/list}}
The ownership percentages above are intended to total 100%. A member's ownership percentage changes only by written agreement of all members, or by a transfer, buyout or admission made under this Agreement. Each member's interest in the Company is personal property.
Each member makes the capital contribution listed above when it is due. The Company keeps a capital account for each member, credited with the member's contributions and share of profits and charged with the member's distributions and share of losses. No member is required to contribute more capital unless all members agree, and no interest is paid on capital. A member may not take back any capital without the written consent of all the other members. A member who does not make a promised contribution when due must pay it in cash when the other members ask in writing, and the Company keeps every other remedy the law gives it.

3. MANAGEMENT AND VOTING
In this Agreement a "Majority" means {{#if voting=equal}}more than half of the members, each member having one vote{{else}}members holding more than half of the ownership percentages{{/if}}.
{{#if management=members}}The Company is managed by its members. Each member may act for the Company in its ordinary business, but ordinary decisions are made by a Majority; if the members are equally divided, the matter is not approved. {{#if bankAuth=majority}}The members, by a Majority, decide who may open accounts and sign checks for the Company.{{/if}}{{#if bankAuth=any}}Any one member may open accounts and sign checks for the Company.{{/if}}{{#if bankAuth=all}}Opening or closing an account and every check requires the signature of every member.{{/if}} The limits in this Agreement bind the members among themselves; an outsider who does not know of them can still hold the Company to a member's act in its usual business.{{/if}}{{#if management=manager}}The Company is managed by {{manager}} as manager, who may make ordinary decisions, open bank accounts and sign for the Company. The manager serves until removed by a Majority. Among the members, members as members have no authority to bind the Company; this limit protects the Company against outsiders only if the Company's articles of organization also say that members are not agents.{{/if}} The matters listed in the section on actions needing every member's consent are never decided by a Majority alone.{{#if mediation}} A deadlock that the members cannot settle is a disagreement under the section on disagreements.{{/if}}
Any member may call a meeting of the members on at least {{meetingDays|day}} written notice to the others. Members may attend by phone or video if everyone can hear and speak to one another at the same time. A meeting may act only if members holding a Majority are present. Regular meetings are held only when needed. The members may also decide a matter without a meeting by a written consent signed by the members whose approval it needs. Each member will give the Company the time and attention the members reasonably decide the business needs.

4. WORK, PAY AND LOANS
{{#if memberWork=paid}}Members who work in the business are paid for their work as {{#if management=manager}}the manager decides{{else}}the members decide by a Majority{{/if}}, and that pay is a business expense separate from distributions. {{#if taxClass=scorp}}A member who works in the business is paid reasonable wages through payroll.{{else}}For tax purposes, pay to a working member is generally treated as a guaranteed payment, not wages, unless the tax preparer advises otherwise.{{/if}}{{/if}}{{#if memberWork=unpaid}}Members are not paid for their work for the Company unless all members agree in writing; their return comes from distributions.{{/if}} A member may lend money to the Company only with the written consent of the other members. Money a member advances beyond the agreed capital is a loan, not capital: it does not increase the member's ownership or vote, it is repaid with interest at a rate the members agree, and it is repaid before distributions are made.

{{#if competeBan}}5. NON-COMPETITION
While a member, and for 12 months after ceasing to be a member, a member will not own or run a business that competes with the Company within 5 miles of its principal office, unless the other members agree in writing. The members agree this limit is reasonable; if a court finds it too broad, the court may narrow it as far as needed to enforce it. This section does not stop a member from owning a small passive investment in a public company.

{{/if}}6. TAX TREATMENT AND DISTRIBUTIONS
{{#if taxClass=partnership}}The Company is taxed as a partnership for federal income tax purposes. The Company's tax preparer keeps the members' capital accounts and makes the tax allocations the Internal Revenue Code and its regulations require, and each member will report income and loss on the member's own return the same way. {{#if partnershipRep}}{{partnershipRep}} is the partnership representative for federal tax audits.{{else}}The members will appoint one member as the partnership representative for federal tax audits.{{/if}} The representative will keep the members informed of any audit and of any settlement, and the members agree to be bound by the representative's actions as federal law provides. Any tax, interest or penalty the Company must pay under the federal centralized partnership audit rules for a tax year is borne by the persons who were members in that year, in proportion to their interests then, even if they have since left; this duty continues after a member leaves. If the Company has the cash, it will try to distribute each year enough for the members to pay tax on the income allocated to them.{{/if}}{{#if taxClass=scorp}}The Company has elected, or will elect, by timely filing IRS Form 2553, to be taxed as an S corporation for federal income tax purposes. Each member confirms that the member is eligible to hold an interest in an S corporation (a company or partnership, or a person who is neither a U.S. citizen nor a U.S. resident, generally is not) and will not transfer an interest to anyone who is not. Nothing in this Agreement gives any member different rights to distributions or liquidation proceeds.{{/if}}
Profits and losses are allocated, and distributions are made, {{#if taxClass=scorp}}in proportion to the members' ownership percentages{{else}}{{#if distributions=equal}}equally among the members{{else}}in proportion to the members' ownership percentages{{/if}}{{/if}}. No member has priority over another. Distributions are made at times {{#if management=manager}}the manager decides{{else}}the members decide by a Majority{{/if}}, from cash not needed for the business, and are not made if, after the distribution, the Company could not pay its debts as they come due or its total assets would be less than its total liabilities.
The Company's fiscal year ends {{fiscalYear}}. The Company's accountant prepares its tax returns. Each member receives a Schedule K-1 each year as soon as the return is ready, and no later than the date federal law requires, and is responsible for the member's own taxes.

7. BANKING, RECORDS AND REPORTS
Company funds are kept in accounts in the Company's name, are never mixed with the money of any member or other person, and are withdrawn only by the people authorized under this Agreement. The Company keeps accurate books on a consistent basis suited to the business, and they are open to every member at reasonable times. It also keeps:
• information on the status of the business and its financial condition;
• its federal, state and local tax returns for each year;
• each member's name, last known address and the date the member joined;
• this Agreement, the articles of organization and every amendment; and
• the cash, property and services each member contributed, and any contribution promised for the future.
Any member may, at the member's own cost, get a copy of these records within a reasonable time for any purpose related to being a member. Within 90 days after each fiscal year ends the Company gives every member an annual report with the year's income statement, balance sheet, cash flow statement and a breakdown of the profit or loss belonging to each member, and it gives each member a copy of the Company's tax return when it is filed.{{#if audit}} Any member may ask for an audit of the books by an accounting firm acceptable to all the members, at the Company's cost, but no more than once for any fiscal year.{{/if}}

8. TRANSFERS AND WITHDRAWAL
{{#if consentToTransfer}}No member may sell or transfer an interest without the written consent of the other members. {{else}}A member may transfer an interest only after following the procedure in this section. {{/if}}A member who wishes to withdraw or sell must give the other members written notice of at least {{noticeDays|day}} and must act in good faith to limit any harm to the others. This notice period and this section replace any longer notice period or other withdrawal right the law would otherwise give. A withdrawal does not end the Company.
The other members may buy the interest, in proportion to their ownership percentages or as they agree among themselves, by telling the member in writing, within {{buyDays|day}} after receiving the notice, that they will buy. The price is the fair value of the interest on the date of the notice: the amount the member would receive if the Company sold all its assets for their fair market value, paid its debts and distributed the rest as the section on dissolution provides. The member and the buyers try to agree on that value within 30 days after the buyers give their answer; if they do not, it is set by an independent appraiser chosen by the member and the buyers together (or, if they cannot agree on one within 10 days, each side names an appraiser and those two choose a third, whose appraisal is final), and the Company pays the appraiser. If the member has a genuine written offer from an outsider, the price is the lower of that offer and the appraised value. {{#if goodwill}}The value includes the goodwill of the business (its name, reputation and customer base).{{else}}The value does not include goodwill (the business's name, reputation or customer base) unless it appears on the Company's books.{{/if}} The buyers pay the price within 90 days after it is fixed, or in equal monthly installments over up to {{payMonths|month}} if they prefer; unpaid installments bear simple interest at a reasonable rate the parties agree, and if an installment is more than 30 days late after written notice, the whole balance is due at once. {{#if consentToTransfer}}If the other members do not buy, the interest may be sold to another person only with their written consent.{{else}}If the other members do not buy, the member may sell the interest to another person, but not on terms better than those offered to the members.{{/if}}
A member who withdraws and whose interest is not bought stops being a member and keeps only the right to receive distributions on that interest; no member is entitled to be paid the value of an interest on withdrawing except as this section provides. Anyone who acquires an interest and is not already a member receives only the right to distributions until all other members admit that person in writing. A person who gets an interest by court order, divorce, bankruptcy or other operation of law gets only the right to distributions and never becomes a member or gains any vote or management right.{{#if taxClass=scorp}} No interest may be transferred to a person who is not eligible to hold an interest in an S corporation, and a transfer that would end the Company's S corporation status is not permitted.{{/if}} A member who leaves is responsible only for Company obligations from the time the person was a member, and the Company will promptly give the notices and make the changes in its records and with agencies that the law requires. The Company keeps the exclusive right to use its name and brands.{{#if licensed}}
The Company holds licenses and permits that must be reported to, or approved by, the agency that issued them when an owner, member or manager changes. No new member is admitted and no interest is transferred until those notices have been given and any required approval has been obtained, and the Company will give the notices promptly after a member withdraws, is removed or dies.{{/if}}

9. DEATH, INCAPACITY OR BANKRUPTCY OF A MEMBER
If a member dies, is declared incompetent or becomes bankrupt, that member (or the member's estate or representative) keeps only the right to receive that member's share of distributions and does not become a member or vote unless all remaining members admit that person in writing. The remaining members may buy the interest within 90 days after the event at the price, and on the payment terms, in the section on transfers and withdrawal, valued as of the date of the event.{{#if lifeInsurance}} The Company may buy insurance on the life of any member with that member's written consent, and each member will cooperate in getting it; the proceeds are used first to pay for a buyout under this Agreement.{{/if}} The Company continues and is not dissolved.

{{#if expulsion}}10. REMOVAL OF A MEMBER
All of the other members may, by written decision, remove a member who commits fraud or a serious breach of a duty to the Company, is convicted of or pleads guilty to a felony or a crime of dishonesty, breaks this Agreement and does not fix it within 30 days after written notice, is subject to a judgment that could reasonably harm the Company's reputation or put its assets at risk, or acts in a way that makes it not reasonably practicable to carry on the business with that member. The member is told in writing of the reason and may answer before the decision. A removed member is treated as having withdrawn and keeps only the right to distributions on the interest until it is bought: the other members may buy the interest as the section on transfers and withdrawal provides, counting the date of the removal decision as the date of the notice, and the Company may also recover damages for harm the member caused by a malicious or criminal act or a breach of this Agreement. The Company continues.

{{/if}}11. ACTS A MEMBER MAY NOT DO
No member may:
• do anything against this Agreement;
• do anything that would make it impossible to carry on the Company's ordinary business;
• bind or obligate the Company in any matter outside its purpose;
• confess a judgment against the Company; or
• give anyone who is not a member the authority to act for the Company, except in writing approved under this Agreement.
{{#if expulsion}}A violation is a ground for removal under the section on removal of a member.{{else}}A violation is a breach of this Agreement.{{/if}}

12. ACTIONS NEEDING EVERY MEMBER'S CONSENT
These actions need the written consent of every member:
• selling, transferring or giving away Company property outside the ordinary course, or using it as collateral for a loan;
• releasing any claim of the Company except for payment in full;
• borrowing beyond ordinary business needs;
• admitting a new member;
• selling the business, or merging or converting the Company;
• changing the Company's purpose;
• changing how profits, losses or distributions are shared;
• filing a bankruptcy case for the Company or assigning its property for the benefit of creditors;
• dissolving the Company; and
• amending this Agreement.
All Company property stays in the name of the Company. No member owns any Company property individually.

13. DISSOLUTION
The Company dissolves on the written agreement of all members, by a court order, or as required by law. After the Company's affairs are wound up, its assets are used in this order: first to creditors other than members; then to loans from members; then {{#if taxClass=scorp}}to the members in proportion to their ownership percentages{{else}}to the members in proportion to, and up to, the positive balances of their capital accounts, and any balance {{#if distributions=equal}}equally among the members{{else}}in proportion to ownership percentages{{/if}}{{/if}}.

14. LIABILITY, INDEMNITY AND INSURANCE
Members are not personally liable for the Company's debts solely because they are members. The Company will indemnify members for acts done in good faith for the Company, but not for fraud, willful misconduct or gross negligence, and only out of the Company's assets. A member is not liable to the Company or another member for a mistake or error of judgment, or for an act or omission believed in good faith to be within the member's authority, but is liable for gross negligence, intentional wrongdoing and knowing violations of the law. A member is excused from a duty under this Agreement while a force majeure event (for example a flood, fire, war or other unforeseen event outside the member's control) prevents it, if the member tells the other members and takes all reasonable steps to carry out the duty and limit the effects. The Company may buy liability insurance protecting its members, employees and agents for acts done in good faith for the Company.

{{#if mediation}}15. DISAGREEMENTS
If the members disagree about this Agreement or the Company, they will first try to settle it by talking in good faith and then, if that does not work, by mediation with a neutral mediator they choose together, sharing the cost equally, before anyone starts a lawsuit. Any member may still ask a court to act quickly where waiting would cause serious harm. The members submit to the courts of the State of {{state}} to enforce this Agreement.

{{/if}}{{#if extraClauses}}16. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}17. GENERAL
This Agreement is the members' entire agreement on its subject; anything said or promised during the negotiations that is not written in it has no effect. It may be amended only in writing signed by all members and is governed by the laws of the State of {{state}}{{#if !mediation}}, and the members submit to the courts of that State to enforce it{{/if}}. It binds the members' heirs, executors, successors and permitted assigns. Notices must be in writing and are treated as delivered when handed over or delivered by courier, or seven days after being mailed with postage paid, to the member's address in this Agreement or another address the member gives in writing. Time is of the essence. This Agreement may be signed in counterparts, including electronically, and each member will sign any further document needed to carry it out. Headings are for convenience only, the singular includes the plural, and any gender includes every gender. If a term cannot be enforced, a court may narrow it as far as needed to make it enforceable, and the rest stays in force. The rights and remedies in this Agreement are in addition to those the law gives.

18. DEFINITIONS
"Capital contribution" means the cash, property or services a member contributes to the Company. "Member's interest" means all of a member's rights in the Company, including the right to share in profits, to a share of the assets on dissolution, to vote and to take part in management. "Operation of law" means a right or duty the law imposes without the person's act or agreement, such as a bankruptcy, a divorce or an assignment for the benefit of creditors.

MEMBERS
{{#list members}}{{name}}
Signature: ______________________________   Date: ______________
If this member is a company — By: ______________________________   Name: ______________________________   Title: ______________________________

{{/list}}{{#if spouseConsent}}[page break]
SPOUSE'S CONSENT
(for a married member)

I am the spouse of a member of {{companyName}}. I have read this Operating Agreement. I agree that any interest I have or may have in my spouse's membership interest, including through marriage, separation or divorce, is subject to this Agreement, including its limits on transfer and its buyout rules, and that I receive only the rights this Agreement gives to a person who holds the right to distributions. I understand that I may talk to my own lawyer before signing.

{{#list members}}Spouse of {{name}} (leave blank if not married)
Printed name: ______________________________
Signature: ______________________________   Date: ______________

{{/list}}{{/if}}`,
  },
  {
    key: "partnership_agreement", title: "General Partnership Agreement", category: BUSINESS,
    description: "Defines how partners share capital, profits, decisions and authority, what happens if a partner leaves or dies, and how the partnership winds up.",
    reviewNote: "Have an attorney review before signing. In a general partnership each partner can be personally responsible for ALL of the business's debts, not only the partner's share. Confirm with an attorney or the tax preparer: (1) a partnership using a name other than its partners' own names may need a trade-name certificate filed with the State Department of Assessments and Taxation; (2) the law lets a partner withdraw at any time, and in a partnership at will a partner's notice of withdrawal can by itself end the partnership (Maryland Corporations and Associations Article §§9A-601, 9A-801) — this agreement lets the remaining partners buy the departing partner out and continue, and makes a short notice a breach that costs only actual losses, but confirm the wording is enforceable as written; (3) how partners who work in the business are paid and taxed (guaranteed payments, self-employment tax); (4) the buyout price is the amount the partner would receive if the assets were sold at fair market value and the partnership wound up — an attorney or valuer should confirm it fits the partners' wishes; (5) licenses (tobacco, lottery, alcohol, SNAP, health), the lease and any loan may need notice or consent when partners change. The profit-share percentages are not checked by the software — make sure they total 100. A partnership agreement is for a general partnership: a business whose name ends in LLC or Corp is not a general partnership, so if the owners formed an LLC use the LLC Operating Agreement instead. Improved using a LawDepot-style sample; its automatic three-month notice and 'withdrawal dissolves the partnership' rule, its one-vote-per-partner rule and its 'all financial decisions need every partner' rule were not copied as fixed terms — they are choices here. The optional operating-partner clause moves responsibility between the partners only; a government agency or creditor can still collect from the partnership or any partner, and a SNAP, tobacco or lottery license may have its own rules about who may operate under it — ask an attorney. Limits on one partner's authority bind the partners among themselves, but an outsider who does not know of them can still hold the partnership to a partner's act in its ordinary business. Switch on the spouse consent page if the spouses of married partners should be bound by the withdrawal and buyout rules.",
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
      { title: "Rules between partners", questions: [
        date("startDate", "The partnership begins on (optional — leave empty if the date of this document)"),
        pick("voting", "How is a vote counted?", [["shares", "In proportion to profit shares"], ["equal", "One vote per partner"]], { required: true, default: "shares", help: "With two partners who each hold 50% (or one vote each) no decision can pass without both." }),
        pick("workPay", "Pay for partners' work", [["agreed", "Only as the partners agree in writing"], ["none", "No partner is paid — only expenses are repaid"]], { required: true, default: "agreed" }),
        yesno("expulsion", "The other partners may remove a partner for serious misconduct or an uncured breach", { default: true }),
        yesno("goodwill", "Include goodwill (name, reputation, customers) when valuing an interest that is bought out", { default: true }),
        yesno("audit", "Any partner may ask for an annual audit at the partnership's cost (once a year)", { default: false }),
        yesno("lifeInsurance", "The partnership may buy life insurance on the partners to fund a buyout", { default: false }),
        yesno("electOut", "Elect out of the federal centralized partnership audit rules each year it is possible", { default: false, help: "Only possible when the partnership has 100 or fewer partners and every partner is an individual, an estate, or a C or S corporation (an S corporation partner's shareholders count toward the 100). A trust, another partnership or an LLC taxed as a partnership rules it out — confirm with the tax preparer." }),
        yesno("licensed", "The business holds licenses or permits that must be reported when partners change (for example tobacco, lottery, alcohol, SNAP or health permits)", { default: true }),
        yesno("operatingPartner", "One partner alone runs the daily operations and answers for violations, fines and the business's licenses"), text("operatingPartnerName", "Operating partner", { showIf: { id: "operatingPartner", equals: true }, required: true }), text("licenses", "Licenses and permits covered", { showIf: { id: "operatingPartner", equals: true }, required: true, default: "SNAP, tobacco, lottery and other licenses and permits" }),
        yesno("mediation", "Disagreements go to mediation before any lawsuit", { default: true }),
        yesno("spouseConsent", "Add a page for the spouses of married partners to sign, agreeing to the withdrawal and buyout rules", { default: false }),
        area("extraClauses", "Any additional terms the partners want (optional)", { placeholder: "e.g. Salah buys out Omar's share on a set date for a set price" }),
      ] },
    ],
    body: `GENERAL PARTNERSHIP AGREEMENT

This Agreement is made on {{effectiveDate}} among the partners listed below, who agree to carry on business together as a general partnership under the laws of {{state}}.

1. FORMATION, NAME AND PURPOSE
The partners form a general partnership (the "Partnership"). Its firm name is {{businessName}}{{#if address}} and its principal office is {{address}}, or another place the partners choose{{/if}}. Its business is: {{purpose}}. The Partnership begins {{#if startDate}}on {{startDate}}{{else}}on the date of this Agreement{{/if}} and continues until it is ended under this Agreement. The partners' rights and duties are those the {{state}} partnership law gives them, except where this Agreement provides differently and the law allows it.{{#if partnerDuties}} Each partner's role and time commitment: {{partnerDuties}}{{/if}}

2. PARTNERS, CAPITAL AND SHARES
{{#list partners}}{{n}}. {{name}}{{#if address}}, {{address}}{{/if}} — capital {{capital}}; shares {{share}}% of profits and losses
{{/list}}
The shares above are intended to total 100%. Each partner contributes the capital listed above by the date of this Agreement unless the partners agree otherwise in writing. No partner is required to contribute more. When the Partnership needs more capital, each partner may contribute in proportion to the partner's share; if a partner cannot or will not do so within a reasonable time, the other partners may contribute the amount in default in proportion to their shares. Additional capital does not change anyone's share of profits unless all partners agree in writing.
Money a partner advances beyond the agreed capital is a loan, not capital: it does not increase the partner's share or vote, it is repaid with interest at a rate the partners agree, and it is repaid before distributions to partners. A partner may not take back any capital without the written consent of the other partners, and no interest is paid on capital. The Partnership keeps a capital account for each partner, credited with the partner's contributions and share of profits and charged with the partner's draws and share of losses.

3. PROFITS, LOSSES AND PAY
Profits and losses are shared according to the percentages above. {{#if draws=monthly}}Partners may take monthly draws in amounts the partners agree, which are charged against their share of profits.{{else}}No partner takes regular draws unless the partners agree.{{/if}} {{#if workPay=none}}No partner is paid for services to the Partnership, except for repayment of expenses directly related to its business.{{else}}A partner is paid for work only as the partners agree in writing.{{/if}}

4. MANAGEMENT, VOTING AND AUTHORITY
In this Agreement a "Majority" means {{#if voting=equal}}more than half of the partners, each partner having one vote{{else}}partners holding more than half of the profit shares{{/if}}. Each partner may take part in managing the business. {{#if decisions=majority}}Decisions are made by a Majority; if the partners are equally divided, the matter is not approved.{{else}}Decisions require the agreement of every partner.{{/if}} Borrowing outside the ordinary course, selling the business, or admitting a partner requires every partner's written consent. {{#if authorityLimit}}Each partner may sign ordinary contracts for the Partnership, but no partner may alone sign a contract, lease or loan above {{authorityLimit}}, or hire or dismiss staff.{{else}}Each partner may sign ordinary contracts for the Partnership, but no partner may sign a lease or loan, or hire or dismiss staff, without the consent required in this section.{{/if}} These limits bind the partners among themselves; a person who deals with a partner without knowing of them can still hold the Partnership to the partner's act in its ordinary business. The partners understand that, in a general partnership, each partner can be personally responsible for all of the partnership's debts, not only the partner's own share.
Regular meetings are held only when needed. Any partner may call a special meeting by giving all partners reasonable notice, and the meeting is limited to the matter it was called for. Meetings are held at a time and place that are reasonable for all partners. The partners may also decide a matter without a meeting by a written consent signed by the partners whose approval it needs.

5. DUTIES OF THE PARTNERS
Each partner will give the Partnership the time and attention a Majority reasonably decides the business needs, will act in good faith toward the other partners, and must fully disclose to all partners any possible conflict of interest. {{#if competeBan}}No partner will, directly or indirectly, carry on a business that competes with the Partnership, or take part in a transaction that conflicts with its interests, without the other partners' written consent. {{/if}}Each partner must account to the Partnership for any benefit the partner gets, without the other partners' consent, from a transaction concerning the Partnership or from using its property, name or business connections. This duty continues after the Partnership has been dissolved until its affairs are completely wound up.

6. BANKING, BOOKS, TAXES AND REPORTS
Partnership funds are kept in accounts in the Partnership's name and are never mixed with the money of any partner or other person. Accurate books are kept at the business address on a consistent basis suited to the business and are open to every partner at reasonable times. The fiscal year ends on December 31. Within 90 days after each year ends, the Partnership gives every partner an annual report with an income statement, a balance sheet, a cash flow statement and a breakdown of the profit or loss belonging to each partner, and it gives each partner a copy of the Partnership's tax return and the statement of that partner's share when they are ready, no later than the date federal law requires.{{#if audit}} Any partner may ask for an audit of the books by an accounting firm acceptable to all the partners, at the Partnership's cost, but no more than once for any fiscal year.{{/if}}
The Partnership files a partnership tax return each year and gives each partner a statement of that partner's share of income. {{#if electOut}}The Partnership will elect out of the federal centralized partnership audit rules under Internal Revenue Code section 6221(b) in each year it is eligible, by making the election on its timely filed return and listing each partner's name and taxpayer identification number, and will notify the partners of the election as the regulations require. {{/if}}{{#if partnerRep}}{{partnerRep}} is the partnership representative for federal tax audits.{{else}}The partners will appoint one partner as the partnership representative for federal tax audits.{{/if}} The representative will keep the partners informed of any audit and of any settlement, and each partner agrees to be bound by the representative's actions as federal law provides. Any tax, interest or penalty the Partnership must pay under the federal centralized partnership audit rules for a tax year is borne by the persons who were partners in that year, in proportion to their shares then, even if they have since left. Payments to a partner for work are treated as the partnership's tax preparer advises.

7. NEW PARTNERS
A new partner may be admitted only by the written agreement of all the existing partners. A new partner agrees in writing to be bound by this Agreement and its amendments, and receives the share the existing partners decide.

{{#if licensed}}8. LICENSES AND PERMITS
The Partnership holds licenses and permits that must be reported to, or approved by, the agency that issued them when a partner or owner changes. The Partnership will give those notices and obtain any required approval before a new partner is admitted, and will give the notices promptly after a partner withdraws, is removed or dies. No new partner is admitted until the required approval has been obtained.

{{/if}}9. WITHDRAWAL AND VALUE OF A SHARE
A partner may withdraw at any time by written notice, and must act in good faith to limit any harm to the others. A partner who gives less than {{noticeDays|day}} of notice is responsible for the Partnership's actual losses caused by the shorter notice. {{#if buyout}}The remaining partners may, by telling the departing partner in writing within 30 days after the withdrawal, buy the departing partner's interest at its fair value, and the Partnership continues. The price is paid within 90 days after it is fixed. A departing partner stays responsible for debts incurred before leaving, and the partners will tell the Partnership's banks, landlords and suppliers of the withdrawal and give any notice the law requires.{{else}}The Partnership then winds up unless the remaining partners agree to continue and settle with the departing partner. A departing partner stays responsible for debts incurred before leaving, and the partners will tell the Partnership's banks, landlords and suppliers and give any notice the law requires.{{/if}}
A partner's interest is valued as of the date of withdrawal (or death): it is the amount the partner would receive if the Partnership sold all its assets for their fair market value, paid its debts and distributed the rest as the section on dissolution provides, less anything the partner owes the Partnership. The partners try to agree on that value within 30 days; if they do not, it is set by an independent appraiser chosen by the departing partner (or the partner's estate) and the remaining partners together (or, if they cannot agree on one within 10 days, each side names an appraiser and those two choose a third, whose appraisal is final), and the Partnership pays the appraiser. {{#if goodwill}}The value includes the goodwill of the business (its name, reputation and customer base).{{else}}The value does not include goodwill (the business's name, reputation or customer base) unless it appears on the Partnership's books.{{/if}} If a partner's interest is passed to someone by court order, divorce, bankruptcy or other operation of law, that person gets only the right to the partner's share of money and does not become a partner or gain any vote.

10. DEATH, INCAPACITY OR REMOVAL OF A PARTNER
If a partner dies or becomes incapacitated, the partnership continues unless the remaining partners decide to wind up. {{#if buyout}}The partner's estate or representative receives the fair value of the interest, set and paid as described in the section on withdrawal, and does not become a partner unless all remaining partners agree in writing.{{else}}The estate or representative receives the fair value of the interest, set as described in the section on withdrawal, within 12 months, and does not become a partner unless all remaining partners agree in writing.{{/if}}{{#if lifeInsurance}} The Partnership may buy insurance on the life of any partner with that partner's written consent, and each partner will cooperate in getting it; the proceeds are used first to pay for a buyout under this Agreement.{{/if}}
{{#if expulsion}}All of the other partners may, by written decision, remove a partner who commits fraud or a serious breach of duty, is convicted of or pleads guilty to a felony or a crime of dishonesty, breaks this Agreement and does not fix it within 30 days after written notice, does something that could reasonably harm the partnership's reputation, or acts in a way that makes it not reasonably practicable to carry on the business with that partner. The partner is told the reason in writing and may answer before the decision. A removed partner is treated as having withdrawn, with the date of the removal decision counted as the date of withdrawal, and the Partnership may also recover damages for harm caused by a malicious or criminal act or a breach of this Agreement.{{/if}}

11. ACTS A PARTNER MAY NOT DO
No partner may:
• do anything against this Agreement;
• do anything that would make it impossible to carry on the ordinary business of the Partnership;
• bind or obligate the Partnership in any matter outside its purpose;
• confess a judgment against the Partnership; or
• give anyone who is not a partner the authority to act for the Partnership, except in writing approved under this Agreement.
{{#if expulsion}}A violation is a ground for removal of the partner.{{else}}A violation is a breach of this Agreement.{{/if}}

12. DISSOLUTION
The partnership dissolves by agreement of all partners or as required by law. All Partnership property stays in the name of the Partnership, and no partner owns any of it individually. After debts to outsiders are paid, and then loans from partners, the remaining assets are distributed to the partners in proportion to, and up to, the positive balances of their capital accounts, and any balance according to their profit shares. A partner whose capital account is negative after losses are allocated must pay the Partnership the amount needed to cover the partner's share of its debts and losses.

13. LIABILITY, INDEMNITY AND INSURANCE
The Partnership will indemnify each partner for acts done in good faith for the Partnership, but not for gross negligence, willful misconduct or a breach of this Agreement, and only out of the Partnership's assets. A partner is not liable to the Partnership or another partner for a mistake or error of judgment, or for an act or omission done in good faith and believed to be within the partner's authority, but is liable for gross negligence, intentional wrongdoing and knowing violations of the law. A partner is excused from a duty under this Agreement while a force majeure event (for example a flood, fire, war or other unforeseen event outside the partner's control) prevents it, if the partner tells the others and takes reasonable steps to carry out the duty and limit the effects. The Partnership may buy liability insurance protecting its partners, employees and agents for acts done in good faith for the Partnership.

{{#if operatingPartner}}14. OPERATING PARTNER
From the date of this Agreement, {{operatingPartnerName}} is solely responsible for the daily operation of the business. {{operatingPartnerName}} is responsible for any violations, fines or penalties arising from the operation of the business from that date and will repay the Partnership and the other partners any such amounts they pay, keeps the business in good standing, makes sure it complies with all federal, state and local laws and regulations, and makes sure its {{licenses}} are not used in connection with any illegal transaction or any violation of the rules of the program or agency that issued them. This section allocates responsibility between the partners only; it does not limit what a government agency or creditor may collect from the Partnership or from any partner.

{{/if}}{{#if mediation}}15. DISAGREEMENTS
If a dispute about this Agreement between partners, or between a partner and the Partnership, is not settled by formal discussion within 14 days after it arises, the partners will first submit it to a mediator, a neutral person chosen by them together, before anyone starts a lawsuit. The mediator's decision is not binding. The cost of mediation is shared equally. Any partner may still ask a court to act quickly where waiting would cause serious harm.

{{/if}}{{#if extraClauses}}16. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}17. GENERAL
This Agreement is the partners' entire agreement; anything said or promised during the negotiations that is not written in it has no effect. It may be changed only in writing signed by all partners, is governed by the laws of the State of {{state}}, and the partners submit to the courts of that State to enforce it. It binds the partners' heirs, executors, successors and permitted assigns. Notices must be in writing and are treated as delivered when handed over or delivered by courier, or seven days after being mailed with postage paid, to the partner's address in this Agreement or another address the partner gives in writing. Time is of the essence. This Agreement may be signed in counterparts, including electronically, and each partner will sign any further document needed to carry it out. Headings are for convenience only, the singular includes the plural, and any gender includes every gender. If a term cannot be enforced, a court may narrow it as far as needed to make it enforceable, and the rest stays in force. The rights and remedies in this Agreement are in addition to those the law gives.

18. DEFINITIONS
"Capital" means the cash or property a partner contributes to the Partnership. "Operation of law" means a right or duty the law imposes without the person's act or agreement, such as a bankruptcy, a divorce or an assignment for the benefit of creditors.

PARTNERS
{{#list partners}}{{name}}
Signature: ______________________________   Date: ______________
If this partner is a company — By: ______________________________   Name: ______________________________   Title: ______________________________

{{/list}}{{#if spouseConsent}}[page break]
SPOUSE'S CONSENT
(for a married partner)

I am the spouse of a partner in {{businessName}}. I have read this Partnership Agreement. I agree that any interest I have or may have in my spouse's partnership interest, including through marriage, separation or divorce, is subject to this Agreement, including its withdrawal and buyout rules, and that I receive only the rights this Agreement gives to a person who holds the right to the partner's share of money. I understand that I may talk to my own lawyer before signing.

{{#list partners}}Spouse of {{name}} (leave blank if not married)
Printed name: ______________________________
Signature: ______________________________   Date: ______________

{{/list}}{{/if}}`,
  },
  {
    key: "profit_sharing_agreement", title: "Owner Profit-Sharing Agreement", category: BUSINESS,
    description: "How the owners of one business split profit, how often, what is held back, and what happens when an owner leaves. Matches the 'Profit split' tool in the client portal.",
    reviewNote: "This agreement sits on top of the business's own governing documents (operating agreement, partnership agreement or bylaws) and does not replace them. For an LLC or partnership, profit shares should match what those documents say. For an S corporation, profit must be paid in proportion to share ownership — a different split, or an agreement that gives some owners different rights, can put the S election at risk (Treas. Reg. §1.1361-1(l)); this agreement says the shares must match the share ownership. For a corporation, payments to owners are dividends that only the board of directors can declare. Owners are taxed on their share of a pass-through business's income whether or not it is paid out. If the firm is also the business's accountant, the owners should name someone else to settle disputes. The percentages are not checked by the software — make sure they total 100.",
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
        area("extraClauses", "Any additional terms the owners want (optional)"),
      ] },
    ],
    body: `OWNER PROFIT-SHARING AGREEMENT

This Agreement is made on {{effectiveDate}} among the owners of {{businessName}} (the "Business"), which is {{#if entityType=llc}}a limited liability company{{/if}}{{#if entityType=scorp}}an S corporation{{/if}}{{#if entityType=corp}}a C corporation{{/if}}{{#if entityType=partnership}}a partnership{{/if}}{{#if entityType=other}}a business{{/if}}.

1. OWNERS AND SHARES
{{#list owners}}{{n}}. {{name}} — {{percent}}% of profit
{{/list}}
The shares above are intended to total 100%.{{#if entityType=scorp}} They must equal each owner's percentage of the Business's shares, and nothing in this Agreement gives any owner rights to distributions or liquidation proceeds that differ from the rights the shares carry.{{/if}}{{#if entityType=corp}} They are intended to equal each owner's percentage of the Business's shares.{{/if}}

2. WHAT IS PROFIT
Profit means {{#if basis=net}}net income after all business expenses, including any taxes the Business itself owes,{{else}}the cash left after the Business's expenses have been paid,{{/if}} as shown in the Business's books for the period. This Agreement does not set wages; an owner who works in the Business is paid for that work separately, as the owners agree in writing.

3. WHEN AND HOW PROFIT IS PAID
Profit is divided {{#if frequency=weekly}}weekly{{/if}}{{#if frequency=monthly}}monthly{{/if}}{{#if frequency=quarterly}}quarterly{{/if}}. {{#if reserve}}Before dividing, {{reserve}}% of the profit stays in the Business as a reserve; the reserve is released only by decision of owners holding a majority of the shares. {{/if}}Profit is paid only to the extent the Business has cash left after paying its current obligations (including payroll, sales and withholding taxes and loan payments) and setting aside any reserve. No payment is made if, after it, the Business could not pay its debts as they come due or its total assets would be less than its total liabilities, or if the law or the Business's governing documents forbid it.{{#if entityType=scorp}} Payments to the owners of a corporation are dividends or distributions declared by its board of directors as the law and its bylaws require, and the owners will vote their shares and sign the resolutions needed to approve the payments this Agreement calls for.{{/if}}{{#if entityType=corp}} Payments to the owners of a corporation are dividends declared by its board of directors as the law and its bylaws require, and the owners will vote their shares and sign the resolutions needed to approve the payments this Agreement calls for.{{/if}} Each owner is paid by {{method}} within {{payDays|day}} after the period's books are closed. The Business may also pay owners extra cash, in the same proportions, to help cover their personal income tax on the Business's income. No owner is promised any amount of profit.

4. LOSSES
{{#if shareLoss}}Losses are shared by the owners in the same percentages.{{else}}Losses are handled as the owners agree in writing.{{/if}}

5. RECORDS AND DISPUTES
The Business keeps its books accurately and gives every owner access to them. Disputes about the numbers are first discussed by the owners and, if unresolved, reviewed by {{#if reviewer}}{{reviewer}}{{else}}an independent certified public accountant chosen by all the owners{{/if}}, whose written finding on the numbers is final unless an owner shows a mistake.

6. AN OWNER WHO LEAVES OR DIES
If a person stops being an owner of the Business (by a sale or buyout, death or otherwise), that person's share of profit for later periods stops on that date. Profit earned up to that date, counted by the days of the period the person was an owner, is paid in the normal way, and the share does not pass to anyone else unless the Business's own governing documents say so. An owner who stops working in the Business but still owns an interest keeps the owner's share.

7. RELATIONSHIP TO OTHER DOCUMENTS
This Agreement does not change the Business's operating agreement, partnership agreement or bylaws; if they conflict with it, those documents control.{{#if entityType=scorp}} Because the Business is an S corporation, profit is paid only in proportion to share ownership.{{/if}}

{{#if extraClauses}}8. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}9. CHANGES AND GENERAL
This Agreement continues until the owners end it in writing. It is the owners' entire agreement about how profit is shared, may be changed only in writing signed by all owners, and is governed by the laws of the State of {{state}}. If a term cannot be enforced, the rest stays in force. It may be signed in counterparts, including electronically.

OWNERS
{{#list owners}}{{name}}
Signature: ______________________________   Date: ______________
If this owner is a company — By: ______________________________   Name: ______________________________   Title: ______________________________

{{/list}}`,
  },
  {
    key: "business_bill_of_sale", title: "Bill of Sale — Business Assets", category: BUSINESS,
    description: "Records the sale of a business's assets from one party to another and transfers them to the buyer.",
    reviewNote: "A business sale can have licensing, tax and lease consequences — have these confirmed before signing. Confirm with an attorney or the tax preparer: (1) the Maryland bulk-transfer rules (Commercial Law Title 6, Subtitle 1; Tax-General §11-505): they apply when a major part of the inventory of a business that sells goods from stock (a store, deli, restaurant) is sold; the buyer sends notice to the Comptroller and the creditors at least 10 days before taking possession or paying, keeps the sworn creditor list for six months, and must hold back what the Comptroller claims for the seller's unpaid sales and use tax — a buyer who skips this can be personally liable for that tax (Tax-General §13-802). If the notice has not been sent yet, do not sign until the 10 days have run, or plan the signing date around it; (2) sales tax on equipment, fixtures and some other items bought with the business (inventory bought for resale is generally handled with a resale certificate); (3) IRS Form 8594 (both sides report how the price is split among the assets); (4) tobacco, alcohol, lottery, SNAP/EBT, health and sales-tax registrations do not transfer — the buyer applies in the buyer's own name (a lottery license ends on a change of ownership, COMAR 36.02.03.15; alcohol licenses need the local licensing board's approval); (5) vehicles need their own title transfer. If the Seller is paid in installments, consider a separate promissory note. Added in this version: the bulk-notice status question, the no-license-transfer sentence, sales tax, Form 8594 and an additional-terms box.",
    steps: [
      { title: "Parties", questions: [text("seller", "Seller", { required: true }), text("sellerAddress", "Seller's address"), text("buyer", "Buyer", { required: true }), text("buyerAddress", "Buyer's address"), text("businessName", "Business being sold", { prefill: "clientName", required: true }), effective(), state()] },
      { title: "The sale", questions: [
        area("assets", "Assets included", { required: true, placeholder: "e.g. Inventory, fixtures, equipment, customer lists, trade name, lease rights" }),
        area("excluded", "Assets or items not included"),
        money("price", "Purchase price", { required: true }),
        pick("payment", "How is it paid?", [["full", "In full at signing"], ["installments", "In installments"]], { required: true, default: "full" }),
        text("installmentTerms", "Installment terms", { showIf: { id: "payment", equals: "installments" }, required: true, placeholder: "e.g. $5,000 down, then $1,000 on the 1st of each month for 20 months" }),
        yesno("liabilities", "Buyer takes on the business's existing debts"), area("liabilityList", "Debts the buyer takes on", { showIf: { id: "liabilities", equals: true }, required: true }),
        yesno("bulkNoticeSent", "The bulk-transfer notice to the Comptroller and creditors was already sent at least 10 days ago", { default: false, help: "Applies to a store, deli, restaurant or similar business that sells goods from stock. If you are unsure, leave this off — the document then says the Buyer will send the notice before taking possession or paying." }),
        area("extraClauses", "Any additional terms (optional)"),
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
Any motor vehicle included needs its own signed title transfer, which the parties will complete. This is a sale of assets only: no license, permit or tax registration of the Seller is transferred (including tobacco, alcohol, lottery, SNAP/EBT, health and sales-tax registrations). The Buyer applies for its own in the Buyer's own name, and the Seller will not hand over cigarettes, tobacco products, alcoholic beverages or lottery tickets before the Buyer holds the license needed for them.

2. PRICE AND PAYMENT
The purchase price is {{price}}. {{#if payment=full}}It is paid in full at signing.{{else}}It is paid as follows: {{installmentTerms}}{{/if}}
{{#if payment=installments}}Until the price is paid in full, the Seller keeps a security interest in the assets, and the Buyer allows the Seller to file a financing statement with the State Department of Assessments and Taxation. If any installment is more than 10 days late, the Seller may declare the whole balance due.
{{/if}}The price is divided among the assets as stated in a schedule both parties sign, which both use for their tax filings, including IRS Form 8594 when it is required; if there is no signed schedule, they will divide it as their tax preparers agree. The Buyer also pays any Maryland sales and use tax due because of this sale.

3. DEBTS
{{#if liabilities}}Buyer takes on the following business debts: {{liabilityList}} All other debts of the business remain Seller's responsibility.{{else}}Buyer does not take on any debts of the business; all debts incurred before the sale date remain Seller's responsibility.{{/if}} Each party will pay the debts it is responsible for and protect the other from claims on them.

4. BULK-TRANSFER NOTICE
If this sale is a bulk transfer under Maryland Commercial Law, Title 6, Subtitle 1 (a sale of a major part of the inventory of a business that sells goods from stock, such as a store or restaurant), the Seller will give the Buyer a creditor list signed under oath and a schedule of the property, and the Buyer will keep them for six months or file them with the circuit court clerk. {{#if bulkNoticeSent}}The Buyer states that it sent the required notice to the Comptroller of Maryland and to the Seller's creditors, by personal delivery or registered or certified mail, at least 10 days before the date of this Bill of Sale.{{else}}The Buyer will send the required notice to the Comptroller of Maryland and to the Seller's creditors, by personal delivery or registered or certified mail, at least 10 days before the Buyer takes possession or pays, whichever is first, and neither will happen before then.{{/if}} The Buyer may keep back from the price any amount the Comptroller claims for the Seller's unpaid sales and use tax and pay it to the Comptroller; any balance is paid to the Seller when the claim is paid or released in writing.

5. SELLER'S STATEMENTS
Seller states that Seller owns the assets, has the right to sell them (and, if Seller is a company, that the person signing is authorized to sign for it), and that they are free of liens and claims except as disclosed in writing. The assets are sold as-is except for these statements.

{{#if extraClauses}}6. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}6. GENERAL
This Bill of Sale is governed by the laws of the State of {{state}}. The Seller will sign any further papers needed to complete the transfer. This Bill of Sale may be signed in counterparts, including electronically. If a term cannot be enforced, the rest stays in force.

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
    reviewNote: "Maryland requires written notice at hiring of the rate of pay, the regular paydays and leave benefits (Labor & Employment §3-504); this letter can serve as that notice if you fill in the payday. The employer must give at least one pay period's notice before changing a payday or lowering pay, and must give a pay statement every pay period. Pay at least every two weeks or twice a month; only administrative, executive or professional employees may be paid less often (§3-502). Never pay below the Maryland minimum wage ($15.00 an hour statewide; some counties, such as Montgomery, Howard and Prince George's, set higher rates). A job posting must show the wage range and a general description of benefits, and the employer may not ask for or rely on the applicant's pay history (§3-304.2). Report the new hire to the Maryland New Hire Registry within 20 days. Form I-9: Section 1 is the employee's by the first day and Section 2 is the employer's within 3 business days; never tell the employee which documents to show. Have an attorney review before use.",
    steps: [
      { title: "Position", questions: [text("employer", "Employer", { prefill: "clientName", required: true }), text("employee", "Employee name", { required: true }), text("employeeAddress", "Employee address"), effective(),
        text("position", "Job title", { required: true }), text("supervisor", "Reports to"), date("startDate", "Start date", { required: true }), text("location", "Work location", { prefill: "clientAddress" })] },
      { title: "Pay and schedule", questions: [
        pick("payType", "Pay is", [["hourly", "Hourly"], ["salary", "Salary"]], { required: true, default: "hourly" }),
        money("rate", "Hourly rate or annual salary", { required: true, help: "Must not be below the Maryland minimum wage ($15.00 an hour statewide; some counties set a higher rate)." }),
        text("schedule", "Expected schedule", { placeholder: "e.g. 40 hours per week, Monday–Friday" }),
        pick("payFrequency", "Paid", [["weekly", "Weekly"], ["biweekly", "Every two weeks"], ["semimonthly", "Twice a month"], ["monthly", "Monthly"]], { default: "biweekly", required: true, help: "Monthly pay is lawful only for administrative, executive or professional employees." }),
        text("payday", "Regular payday (optional)", { placeholder: "e.g. every other Friday", help: "Maryland requires telling the employee the regular paydays at hiring. Naming the day here covers that." }),
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
You will be paid {{#if payType=hourly}}{{rate}} per hour{{else}}a salary of {{rate}} per year{{/if}}, {{#if payFrequency=weekly}}every week{{/if}}{{#if payFrequency=biweekly}}every two weeks{{/if}}{{#if payFrequency=semimonthly}}twice each month{{/if}}{{#if payFrequency=monthly}}once a month{{/if}}, on {{employer}}'s regular paydays{{#if payday}} ({{payday}}){{/if}}, less required tax withholding and any deductions you authorize in writing. {{employer}} will give you at least one pay period's notice before it changes your payday or lowers your rate of pay.{{#if schedule}} Your expected schedule is {{schedule}}.{{/if}} {{#if payType=hourly}}Hours over 40 in a workweek are paid at overtime rates as the law requires.{{else}}A salary alone does not make a position exempt from overtime. Unless {{employer}} tells you in writing that your position is exempt, you will be paid overtime for hours over 40 in a workweek as the law requires.{{/if}}
{{#if benefits}}
BENEFITS AND OTHER TERMS
{{benefits}}
{{/if}}
LEAVE
You will earn sick and safe leave as Maryland law requires (paid leave if {{employer}} has 15 or more employees, unpaid leave if it has fewer), and {{employer}} will give you the State's written notice about it. Any vacation or other paid leave, and whether unused leave is paid when employment ends, is stated above or in {{employer}}'s written leave policy.

AT-WILL EMPLOYMENT
Your employment is at will. Either you or {{employer}} may end it at any time, with or without cause or notice. This letter is not a contract for any fixed period. No one other than the owner can change this at-will relationship, and only in a signed writing. This letter replaces any earlier oral statements about your job.

BEFORE YOU START
By your first day, please complete Form W-4, Maryland Form MW507 (both for tax withholding) and Section 1 of Form I-9. Within three business days after you start, you must show {{employer}} original documents of your own choice, from the Form I-9 lists of acceptable documents, proving your identity and your authorization to work in the United States. Your employment depends on completing Form I-9 as federal law requires.

This letter is governed by the laws of the State of {{state}}. To accept, sign below and return it by {{replyBy}}; this offer ends if it is not accepted by then.

Sincerely,
{{employer}}
Printed name and title: ______________________________
Signature: ______________________________   Date: ______________

I accept this offer:
{{employee}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "contractor_agreement", title: "Independent Contractor Agreement", category: EMPLOYMENT,
    description: "Sets out services, pay and the independent-contractor relationship (not an employee).",
    reviewNote: "Calling someone a contractor does not make them one. Under Maryland's unemployment-insurance test (Labor & Employment §8-205) and the IRS test, a person who works your shifts, at your store, under your direction is an employee. If that describes the person, use the Employment Agreement instead. Maryland's Workplace Fraud Act (§§3-901 to 3-903) applies only to construction and landscaping services and presumes a worker there is an employee unless a strict three-part test is met; get advice before using this agreement for that kind of work. Tick only the independence facts that are TRUE. Get a Form W-9 before the first payment; for payments made after 2025, a Form 1099-NEC is required once payments to one contractor reach $2,000 in the year. Added in this version: expenses, helpers, responsibility for claims, return of materials, notices, assignment, electronic signature, an optional mediation step and a free-text box for additional terms. Have an attorney review before use.",
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
        yesno("mediation", "Try mediation before going to court", { default: false, help: "Mediation is a meeting with a neutral person who helps the parties settle. It is not binding." }),
        area("additionalTerms", "Additional terms (optional)", { placeholder: "Anything else the parties have agreed, e.g. a deadline for delivery, a place where the work is done" }),
      ] },
    ],
    body: `INDEPENDENT CONTRACTOR AGREEMENT

This Agreement is made on {{effectiveDate}} between {{company}}{{#if companyAddress}}, {{companyAddress}}{{/if}} ("Company") and {{contractor}}{{#if contractorAddress}}, {{contractorAddress}}{{/if}} ("Contractor").

1. SERVICES
Contractor will perform the following services: {{services}}

2. TERM
Work begins on {{startDate}}{{#if hasEnd}} and ends on {{endDate}}, unless ended earlier under this Agreement{{else}} and continues until either party ends it as described in this Agreement{{/if}}.

3. PAYMENT
Company will pay Contractor {{#if feeType=fixed}}a fixed fee of {{fee}} for the services{{else}}{{fee}} per hour for time worked{{/if}}. Contractor will send invoices{{#if feeType=hourly}} listing the dates and hours worked{{/if}} and Company will pay each within {{payDays}} days of receiving it. Contractor pays Contractor's own expenses unless Company agrees in writing in advance to reimburse them.

4. INDEPENDENT CONTRACTOR
Contractor is an independent contractor, not an employee. {{#if indBusiness}}Contractor runs their own business and has other customers or is free to take them. {{/if}}{{#if indSchedule}}Contractor sets their own schedule and methods; Company controls the result of the work, not the means. {{/if}}{{#if indTools}}Contractor supplies their own tools and may use helpers at their own cost. {{/if}}{{#if indAway}}The work is done away from Company's premises or outside Company's usual day-to-day business. {{/if}}{{#if indInsurance}}Contractor carries any insurance and workers' compensation coverage the law requires for Contractor and Contractor's helpers. {{/if}}Any helpers Contractor uses are Contractor's responsibility, not Company's. Contractor has no authority to bind Company. Company will not withhold taxes or provide benefits, except that Company may withhold where the law requires it (for example, if Contractor does not provide a Form W-9). Contractor is responsible for their own taxes, insurance and licenses, and will provide a completed Form W-9 before the first payment; Company will report payments on Form 1099-NEC where required.

{{#if confidential}}5. CONFIDENTIALITY
Contractor will keep Company's non-public business, client and financial information confidential and use it only for this work, during and after this Agreement. Nothing in this Agreement stops Contractor from reporting a possible violation of law to a government agency. Under 18 U.S.C. § 1833(b), an individual is not liable under any trade-secret law for disclosing a trade secret in confidence to a government official or an attorney solely to report or investigate a suspected violation of law, or in a sealed court filing.

{{/if}}{{#if ownsWork}}6. OWNERSHIP OF WORK
Contractor assigns to Company all rights in the work Contractor creates specifically for Company under this Agreement, effective when Company has paid for it. Contractor promises that the work is Contractor's own or properly licensed and, to Contractor's knowledge, does not infringe anyone else's rights. Contractor keeps rights in Contractor's own pre-existing tools and materials and gives Company a license to use any of them built into the work.

{{/if}}7. ENDING THE AGREEMENT
Either party may end this Agreement on 14 days' written notice, or immediately if the other party materially breaks it. Company pays for work completed up to the end date; for a fixed fee, the part of the fee that matches the work completed. When the Agreement ends, Contractor returns Company's property, records and materials.

8. RESPONSIBILITY FOR CLAIMS
Each party is responsible for claims, losses and costs caused by its own negligence or misconduct. Contractor is also responsible for claims by Contractor's helpers, and for taxes, penalties and insurance that the law requires of Contractor.

9. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}. If any part of it cannot be enforced, the rest stays in force. Notices must be in writing and sent to the party's address at the top of this Agreement, or to a new address the party gives in writing. Neither party may assign this Agreement without the other's written consent. The sections on payment, confidentiality, ownership of work and responsibility for claims continue after this Agreement ends. This Agreement may be signed in copies, including electronically, and all copies together are one agreement.{{#if mediation}} Before going to court (other than to stop misuse of confidential information), the parties will try in good faith to settle a dispute through mediation and will share the mediator's fee equally.{{/if}}

{{#if additionalTerms}}10. ADDITIONAL TERMS
{{additionalTerms}}

{{/if}}COMPANY: {{company}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

CONTRACTOR: {{contractor}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________`,
  },
  {
    key: "employment_termination_letter", title: "Employment Separation Letter", category: EMPLOYMENT,
    description: "Confirms the end of employment, final pay and the return of company property.",
    reviewNote: "Maryland requires final wages to be paid no later than the regular payday that would have applied had employment continued (Labor & Employment §3-505). Unused leave must be paid unless the employer has a written policy that says it is not paid out and told the employee of its leave benefits at hiring (§3-505(b), §3-504). Do not take a deduction from final pay for unreturned property unless the employee authorized it in writing or the law allows it (§3-503). Keep any reason short and neutral, and never mention leave, an injury or workers' compensation claim, a pay complaint, medical information or immigration status. If the State later sends a request for separation information, answer it by the date on the form. If the employee is in a group health plan, tick the health coverage question and send the plan notice separately. A layoff of many employees can trigger Maryland's notice rules — check first. Have an attorney review before using this for a firing.",
    steps: [
      { title: "Separation", questions: [text("employer", "Employer", { prefill: "clientName", required: true }), text("employee", "Employee name", { required: true }), effective(),
        pick("type", "Type of separation", [["resignation", "Employee resigned"], ["termination", "Employer ended employment"], ["layoff", "Layoff"]], { required: true }),
        date("lastDay", "Last day of work", { required: true }), text("reason", "Reason (optional)", { help: "Leave empty unless needed; one neutral fact only. It is not printed for a termination." }),
        date("finalPayDate", "Final paycheck will be paid on", { required: true, help: "No later than the employee's next regular payday." }),
        yesno("accruedPay", "Final pay includes unused paid time off", { default: false }),
        yesno("property", "Employee must return company property", { default: true }), text("propertyList", "Property to return", { showIf: { id: "property", equals: true }, placeholder: "e.g. Keys, uniform, laptop" }),
        yesno("healthPlan", "Employee is enrolled in the company's group health plan", { default: false }),
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

{{/if}}{{#if healthPlan}}HEALTH COVERAGE
Your coverage under {{employer}}'s group health plan ends as the plan's terms provide. You will receive separate written information about any right you may have to continue that coverage.

{{/if}}UNEMPLOYMENT INSURANCE
You may be able to apply for unemployment insurance benefits with the Maryland Department of Labor. The State decides eligibility.

TAX FORMS AND RECORDS
Your Form W-2 will be sent to the address we have on file, so please keep it up to date with us.{{#if contact}} Questions can be sent to {{contact}}.{{/if}}

Sincerely,
{{employer}}
Printed name and title: ______________________________
By: ______________________________   Date: ______________

Received by employee (receipt only, not agreement):
{{employee}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "employment_verification_letter", title: "Employment Verification Letter", category: EMPLOYMENT,
    description: "Confirms that a person works (or worked) for the business — for a landlord, lender or agency.",
    reviewNote: "Release employment or pay information only with the employee's written request or permission, and keep a copy of that request. State facts only — never the reason for leaving, discipline, medical, immigration or family information, and never a Social Security number or date of birth. Include pay only if the employee asked for it, and say clearly whether it is before or after taxes. The letter says it is not a promise of continued employment, so a lender does not read it as one. If a lender sends its own form or asks for more, answer only what the employee has allowed.",
    steps: [
      { title: "Details", questions: [text("employer", "Employer", { prefill: "clientName", required: true }), text("employerAddress", "Employer address", { prefill: "clientAddress" }), text("employee", "Employee name", { required: true }), text("addressee", "Addressed to (lender, landlord or agency — optional)"), text("purpose", "What the letter is for (optional)", { placeholder: "e.g. a loan application, an apartment application" }), effective(),
        pick("authorized", "The employee asked for or allowed this letter in writing", [["yes", "Yes — I have their written request"], ["no", "No"]], { required: true }),
        text("position", "Job title", { required: true }), date("startDate", "Employed since", { required: true }),
        yesno("current", "Still employed", { default: true }), date("endDate", "Employment ended", { showIf: { id: "current", equals: false }, required: true }),
        pick("status", "Status", [["fulltime", "Full-time"], ["parttime", "Part-time"], ["seasonal", "Seasonal"]], { default: "fulltime", required: true }), num("hours", "Hours worked per week (optional)"),
        yesno("includePay", "Include pay information", { default: false }), money("pay", "Pay amount", { showIf: { id: "includePay", equals: true }, required: true }),
        pick("payPer", "Per", [["hour", "Hour"], ["week", "Week"], ["month", "Month"], ["year", "Year"]], { showIf: { id: "includePay", equals: true }, default: "year" }),
        pick("payBasis", "The pay amount is", [["gross", "Before taxes (gross)"], ["net", "After taxes (net)"]], { showIf: { id: "includePay", equals: true }, default: "gross" }),
        text("signerName", "Signed by (name)", { required: true, prefill: "ownerName" }), text("signerTitle", "Their title", { required: true, prefill: "ownerTitle" }), text("phone", "Phone for verification", { prefill: "clientPhone", required: true }), text("email", "Email for verification (optional)")] },
    ],
    body: `{{effectiveDate}}

Re: Verification of Employment{{#if purpose}} for {{purpose}}{{/if}}

{{#if addressee}}To {{addressee}}:{{else}}To whom it may concern:{{/if}}

This letter confirms that {{employee}} {{#if current}}is employed{{else}}was employed{{/if}} by {{employer}} as a {{#if status=fulltime}}full-time{{/if}}{{#if status=parttime}}part-time{{/if}}{{#if status=seasonal}}seasonal{{/if}} {{position}}, {{#if current}}since {{startDate}}{{else}}from {{startDate}} to {{endDate}}{{/if}}.{{#if hours}} {{employee}} {{#if current}}works{{else}}worked{{/if}} {{hours|hour}} per week.{{/if}}

{{#if includePay}}{{employee}}'s pay {{#if current}}is{{else}}was{{/if}} {{pay}} per {{#if payPer=hour}}hour{{/if}}{{#if payPer=week}}week{{/if}}{{#if payPer=month}}month{{/if}}{{#if payPer=year}}year{{/if}}, {{#if payBasis=net}}after taxes{{else}}before taxes{{/if}}.

{{/if}}{{#if authorized=yes}}This letter is based on {{employer}}'s records as of the date above and is provided at the employee's written request. It states only the facts listed above{{#if current}} and is not a promise of continued employment or future pay{{/if}}.{{else}}[DO NOT SEND — there is no written request or permission from the employee.]{{/if}} To verify, please call {{phone}}{{#if email}} or write to {{email}}{{/if}}.

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
    reviewNote: "Maryland generally limits interest on a written loan to 8% a year, and the borrower must sign a writing that states the rate (Commercial Law §12-103). There are exceptions — for example loans to corporations and some commercial loans over $15,000 — and a higher rate for an individual borrower can require a lender's license, so confirm the rate with an attorney before using more than 8%. A late fee is safest at no more than the greater of $2 or 5% of the late payment, charged only once the payment is at least 15 days late (Commercial Law §12-105); a larger fee can be counted as interest. This note deliberately has no confession-of-judgment clause — do not add one (federal rules ban it in consumer loans, 16 CFR §444.2). If the borrower is an individual borrowing for personal or household use, or the lender makes loans as a business, consumer-credit disclosure and licensing rules may apply, and Maryland may cap collection attorney's fees in consumer credit. Real estate as security needs a separate recorded mortgage or deed of trust, and a lien on a vehicle or boat must be noted on its title. A lender who takes business or personal property as security should file a financing statement with the right state office (for a company organized in Maryland or an individual who lives in Maryland, SDAT — otherwise the filing goes where the company is organized or the individual lives). A below-market loan between related people or companies can create taxable imputed interest (IRC §7872) — ask the tax preparer. The time limit for suing on an unpaid note is short — ask an attorney. Check that the number of payments, the first payment date and the final due date agree.",
    steps: [
      { title: "Parties", questions: [text("lender", "Lender", { required: true }), text("lenderAddress", "Lender's address"), text("borrower", "Borrower", { required: true }), text("borrowerAddress", "Borrower's address"), effective(), state()] },
      { title: "Loan", questions: [
        money("principal", "Amount borrowed", { required: true }),
        num("rate", "Annual interest rate (%)", { required: true, default: "0", help: "Enter 0 for no interest. Maryland generally limits interest on a written loan to 8% a year (Commercial Law §12-103); loans to corporations and some commercial loans over $15,000 are exempt, and higher rates can require a lender's license. Confirm the rate with the attorney before using more than 8%. If the loan is between related people or companies and the rate is below the IRS applicable federal rate, ask the tax preparer about imputed interest." }),
        pick("schedule", "Repayment", [["monthly", "Equal monthly payments"], ["lump", "One payment on the due date"]], { required: true, default: "monthly" }),
        num("months", "Number of monthly payments", { showIf: { id: "schedule", equals: "monthly" }, required: true }),
        money("paymentAmount", "Amount of each monthly payment", { showIf: { id: "schedule", equals: "monthly" }, required: true, help: "Principal plus interest, spread over the payments. Ask the firm to calculate it if there is interest." }),
        date("firstPayment", "First payment due", { showIf: { id: "schedule", equals: "monthly" }, required: true }),
        date("dueDate", "Final due date", { required: true, help: "For monthly payments this is the date of the last payment." }),
        yesno("lateFee", "Charge a late fee"), money("lateFeeAmount", "Late fee", { showIf: { id: "lateFee", equals: true }, required: true, help: "Charged once, only if a payment is more than 15 days late. To stay clearly within Maryland's rule for loans that have a rate limit, keep it to no more than the greater of $2 or 5% of the late payment." }),
        yesno("secured", "The loan is secured by property"), text("collateral", "Describe the property", { showIf: { id: "secured", equals: true }, required: true, help: "Be specific — make, model and serial or VIN numbers, not just \"all equipment\"." }),
        yesno("prepay", "Borrower may repay early without penalty", { default: true }),
        area("extraClauses", "Any additional terms (optional)"),
      ] },
    ],
    body: `PROMISSORY NOTE

Date: {{effectiveDate}}
Principal: {{principal}}

1. PROMISE TO PAY
For value received, {{borrower}}{{#if borrowerAddress}} of {{borrowerAddress}}{{/if}} ("Borrower") promises to pay {{lender}}{{#if lenderAddress}} of {{lenderAddress}}{{/if}} ("Lender") {{principal}}{{#if rate}}, with simple interest at {{rate}}% per year (365-day year) on the unpaid balance{{else}}, without interest{{/if}}. Interest and fees together will never exceed the maximum the law allows; any excess is applied to principal or refunded to Borrower.

2. PAYMENTS
{{#if schedule=monthly}}Borrower will pay {{months}} monthly installments of {{paymentAmount}} each, on the same day of each month beginning {{firstPayment}}, and will pay all remaining principal{{#if rate}} and interest{{/if}} on {{dueDate}} (the "Maturity Date").{{else}}Borrower will pay the full principal{{#if rate}} and accrued interest{{/if}} in one payment on {{dueDate}} (the "Maturity Date").{{/if}} Payments are made by check or bank transfer to Lender{{#if lenderAddress}} at {{lenderAddress}}{{/if}}, or as Lender later directs in writing. If a due date falls on a Saturday, Sunday or legal holiday, the payment is due on the next business day. Each payment is applied first to costs and late fees, then {{#if rate}}to interest, then {{/if}}to principal.

3. LATE PAYMENT AND DEFAULT
{{#if lateFee}}If a payment is received more than 15 days after its due date, Borrower will pay a one-time late fee of {{lateFeeAmount}} for that payment, but never more than the law allows. {{/if}}Each of the following is a default: (a) a payment is not made within 10 days after Lender gives written notice that it is past due; (b) the whole balance is not paid on the Maturity Date; (c) Borrower becomes insolvent or files for bankruptcy; {{#if secured}}(d) Borrower gives Lender false information in connection with this note; or (e) the collateral is lost, damaged beyond use, or transferred without Lender's written consent.{{else}}or (d) Borrower gives Lender false information in connection with this note.{{/if}} On default, Lender may declare the whole unpaid balance due immediately by written notice to Borrower.

4. PREPAYMENT
{{#if prepay}}Borrower may pay all or part of the balance early at any time without penalty.{{else}}Early payment requires Lender's written consent.{{/if}}

{{#if secured}}5. SECURITY
To secure this note, Borrower grants Lender a security interest in: {{collateral}}, and authorizes Lender to file financing statements. Borrower will keep the collateral in good repair, insured against loss where that is reasonable, and free of other liens, and will not sell or move it without Lender's written consent. A mortgage or deed of trust on real property needs a separate recorded document, and a lien on a titled vehicle or boat must be noted on its title. If Borrower defaults, Lender may exercise the rights the law gives a secured lender.

{{/if}}6. COSTS AND GENERAL TERMS
If Borrower defaults, Borrower pays Lender's reasonable costs of collection, including attorney's fees actually incurred, to the extent the law allows. Borrower waives presentment, demand and protest. If more than one person signs as Borrower, each is responsible for the whole debt. Notices must be in writing and sent to the parties' addresses in this note or to a new address given in writing. Delay or leniency by Lender is not a waiver of any right. Lender may transfer this note; Borrower may not transfer this note or Borrower's duties under it without Lender's written consent. This note binds Borrower's heirs, estate and successors. If any term cannot be enforced, the rest stays in force. This note may be changed only in writing signed by both parties and is governed by the laws of the State of {{state}}.

{{#if extraClauses}}7. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}BORROWER: {{borrower}}
Signature: ______________________________   Date: ______________
Printed name: ______________________   Title (if a company): ______________

LENDER: {{lender}}
Signature: ______________________________   Date: ______________
Printed name: ______________________   Title (if a company): ______________`,
  },
  {
    key: "nda_mutual", title: "Mutual Non-Disclosure Agreement", category: LENDING,
    description: "Two parties agree to keep each other's confidential information private.",
    reviewNote: "Choose a confidentiality period that fits the information; trade secrets stay protected as long as they remain secret (Maryland Uniform Trade Secrets Act, Commercial Law §11-1201 and following, and the federal Defend Trade Secrets Act). The reporting-and-immunity notice in 18 U.S.C. §1833(b) is included because the federal act requires it in any agreement with an employee, contractor or consultant who handles confidential information; do not delete it. This form has no \"residual knowledge\" clause (letting people use what they remember) — add one only on an attorney's advice. It is not a non-compete, and it cannot stop anyone from reporting a suspected legal violation to the government. If one party is an individual contractor or consultant, or tax-return information is involved (IRC §7216), confirm the wording with an attorney. Check that the purpose describes the real reason for sharing, because information used for any other purpose is a breach.",
    steps: [
      { title: "Parties", questions: [text("partyA", "First party", { prefill: "clientName", required: true }), text("partyAAddress", "First party's address", { prefill: "clientAddress" }), text("partyB", "Second party", { required: true }), text("partyBAddress", "Second party's address"), effective(), state()] },
      { title: "Terms", questions: [area("purpose", "Why information is being shared", { required: true, placeholder: "e.g. Discussing a possible purchase of the business" }), num("years", "Confidentiality lasts (years)", { default: "3", required: true, help: "Counted from the last time information is shared; use at least 1. Trade secrets stay protected as long as they remain secret." }),
        area("extraClauses", "Any additional terms (optional)")] },
    ],
    body: `MUTUAL NON-DISCLOSURE AGREEMENT

This Agreement is made on {{effectiveDate}} between {{partyA}}{{#if partyAAddress}}, {{partyAAddress}}{{/if}}, and {{partyB}}{{#if partyBAddress}}, {{partyBAddress}}{{/if}} (each a "Party").

1. PURPOSE
The Parties will share confidential information for this purpose: {{purpose}} (the "Purpose").

2. CONFIDENTIAL INFORMATION
"Confidential Information" is non-public information one Party gives the other, in any form (written, electronic, spoken or by inspection), that is marked confidential or that a reasonable person would understand to be confidential, including financial, tax, customer, pricing, personal and business-plan information. A Party's "Representatives" are its owners, employees, lawyers, accountants, lenders and other advisors who need the information for the Purpose.

3. WHAT EACH PARTY AGREES TO DO
The receiving Party will use the Confidential Information only for the Purpose, keep it as secure as its own confidential information (and at least with reasonable care), and share it only with its Representatives who need it for the Purpose and are bound to keep it confidential. Each Party is responsible for any breach by its Representatives. A Party will tell the other promptly if it learns of an unauthorized use or disclosure.

4. WHAT IS NOT COVERED
This Agreement does not cover information that the receiving Party can show is or becomes public without a breach, was already known to it, was independently developed by it, or was received lawfully from someone else who was free to share it. A Party may disclose information when a law, court order or government agency requires it, after giving the other Party prompt written notice where the law allows, and only to the extent required.

5. TERM AND RETURN OF INFORMATION
These obligations last {{years|year}} after the later of the date of this Agreement and the date of the last disclosure; for information that is a trade secret, they last as long as it remains one. On request, each Party will return or destroy the other's Confidential Information, except copies it must keep by law or in routine backups, which stay confidential.

6. OWNERSHIP AND NO OBLIGATION
All Confidential Information stays the property of the Party that discloses it, and no license is granted. Neither Party must enter any transaction, and information is provided as is, without warranty.

7. REMEDIES
Because a breach could cause harm money cannot fix, a Party may ask a court for an order stopping a breach, in addition to any other remedy. In a lawsuit to enforce this Agreement, the winning Party may recover its reasonable attorney's fees, to the extent the law allows. Any lawsuit must be brought in the courts of the State of {{state}}.

8. PROTECTED DISCLOSURES
Nothing in this Agreement prevents a person from reporting a suspected violation of law to a government agency, taking part in a government investigation, or discussing or disclosing information about unlawful acts in the workplace, to the extent the law protects that. Under the federal Defend Trade Secrets Act (18 U.S.C. §1833(b)), an individual is not criminally or civilly liable under any federal or state trade secret law for disclosing a trade secret (a) in confidence to a federal, state or local government official, or to an attorney, solely to report or investigate a suspected violation of law, or (b) in a complaint or other document filed in a lawsuit or other proceeding, if the filing is made under seal. An individual who sues an employer for retaliation for reporting a suspected violation may also disclose the trade secret to the individual's attorney and use it in the court case, if the individual files any document containing it under seal and does not disclose it except by court order.

{{#if extraClauses}}9. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}10. GENERAL
This is the Parties' entire agreement on its subject and may be changed only in writing signed by both. Neither Party may assign it without the other's written consent, and it binds and benefits the Parties' successors and permitted assigns. Notices must be in writing and sent to the addresses above or to a new address given in writing. Delay in enforcing a right is not a waiver of it. This Agreement may be signed in counterparts and electronically, and is governed by the laws of the State of {{state}}. If a term cannot be enforced, the rest stays in force.

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
    reviewNote: "Commercial leases carry long-term obligations — have an attorney review it before signing, especially for longer terms. This short form is meant for small spaces and short terms; for a longer or larger lease use the full Commercial Lease Agreement. Maryland (Real Property Article 3-101) requires a lease, or a memorandum of lease signed by every party, to be recorded if the first term or any single renewal term is longer than seven years — this form promises a memorandum in that case; an unrecorded lease is still valid between the parties, but record it to protect the tenant against later buyers and lenders (confirm with an attorney). Maryland's residential-lease protections (deposit cap, 5% late-fee cap, entry notice) do not apply to a business lease, so the late fee and deposit are for the parties to agree. A landlord who wants the tenant out when a fixed term ends may need to give 60 days' written notice before it ends (Real Property Article 8-402) — confirm with an attorney. Companies must sign through an officer with a title.",
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
        area("extraClauses", "Any additional terms (optional)"),
      ] },
    ],
    body: `COMMERCIAL LEASE

This Lease is made on {{effectiveDate}} between {{landlord}}, {{landlordAddress}} ("Landlord") and {{tenant}}, {{tenantAddress}} ("Tenant").

1. PREMISES AND USE
Landlord leases to Tenant the space at {{premises}} (the "Premises"). Tenant will use it only for {{use}} and in compliance with all laws and required licenses. Landlord does not promise that zoning or any law allows Tenant's use; Tenant is responsible for confirming this and for every license and permit its business needs.

2. TERM
The Lease runs from {{startDate}} to {{endDate}}.{{#if renewal}} Renewal: {{renewalTerms}}.{{/if}} If the first term or any renewal term is longer than seven years, the parties will sign a memorandum of lease that either of them may record.

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
If Tenant does not pay rent within 10 days after written notice, or breaks another term and does not fix it within 30 days after written notice, Landlord may end the Lease, retake possession by the lawful procedures available under the law, and recover what the law allows.

11. ASSIGNMENT
Tenant may not assign this Lease or sublet without Landlord's written consent, which will not be unreasonably withheld.

12. END OF LEASE AND HOLDING OVER
At the end of the Lease Tenant returns the Premises clean and in good condition, normal wear excepted. If Tenant stays after the end date without a new written lease, Tenant is a holdover tenant and this is not a renewal: rent is 150% of the last monthly rent, prorated by day, and Landlord may recover possession.

{{#if guarantee}}13. GUARANTEE
{{guarantor}} personally and unconditionally guarantees that Tenant will pay all rent and perform all obligations under this Lease, as amended or renewed, and signs below to confirm it. The guarantee continues despite any change to the Lease or any delay by Landlord, and Landlord need not first pursue Tenant.

{{/if}}{{#if extraClauses}}14. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}15. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}. Notices must be in writing and delivered to the addresses above. If any part is not enforceable, the rest remains in effect. This Lease may be signed in counterparts, including electronically. Each person who signs for a company states that he or she is authorized to do so.

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
    reviewNote: "A short agreement helps keep the LLC separate from its owner. Have an attorney review it if the LLC owns significant property or has lenders. Confirm with an attorney: (1) how the successor named in the death clause is admitted and whether the owner's will or trust should also leave the interest to that person — under the Maryland LLC Act an LLC with no members for 90 days dissolves unless a successor agrees to continue it and is admitted (§4A-902), so name a successor and keep the will or trust consistent; (2) the effect of an S corporation election on the LLC's tax treatment — talk to the tax preparer before filing one; (3) if a second owner is ever added, replace this agreement with a multi-member operating agreement; (4) licenses (tobacco, lottery, alcohol, SNAP, health), the lease and any loan may need notice or consent if the owner changes, including on the owner's death.",
    steps: [
      { title: "The company", questions: [text("companyName", "LLC name", { prefill: "clientName", required: true }), text("formedIn", "State where the LLC is formed", { default: "Maryland", required: true, prefill: "stateName" }), date("formationDate", "Date formed", { required: true, prefill: "formationDate" }), text("address", "Principal address", { prefill: "clientAddress", required: true }), text("purpose", "Business purpose", { default: "any lawful business" }), effective()] },
      { title: "The owner", questions: [text("member", "Owner (member) name", { required: true, prefill: "ownerName" }), text("memberAddress", "Owner's address"), money("contribution", "Capital contributed", { required: true }), text("successor", "Who takes over if the owner dies or cannot act", { placeholder: "Name — leave blank to follow state law" }), state()] },
    ],
    body: `SINGLE-MEMBER LLC OPERATING AGREEMENT OF {{companyName}}

This Operating Agreement is made on {{effectiveDate}} by {{member}}{{#if memberAddress}} of {{memberAddress}}{{/if}} (the "Member") for {{companyName}} (the "Company"), a limited liability company formed in {{formedIn}} on {{formationDate}}.

1. FORMATION AND PURPOSE
The Company's principal office is {{address}}. Its purpose is {{purpose}}. The Company continues until the Member ends it. The Company keeps a registered (resident) agent in {{formedIn}} as the law requires, and files its yearly report and pays its fees on time to stay in good standing.

2. OWNERSHIP AND CAPITAL
The Member owns 100% of the Company and has contributed {{contribution}} in capital. The Member may contribute additional funds or take distributions at any time, and the Company records each as a capital contribution or distribution — not as pay or as a loan unless documented as a loan. A distribution is not made if, after it, the Company could not pay its debts as they come due or its total assets would be less than its total liabilities.

3. MANAGEMENT
The Member manages the Company and may act and sign on its behalf, open accounts, hire people and make every decision for the Company.

4. SEPARATE FROM THE OWNER
The Company keeps its own bank accounts and books, and the Member does not mix personal and Company funds. The Company signs contracts in its own name, and the Member signs for it as "Member" or "Manager", not in a personal capacity. The Member is not personally liable for the Company's debts solely because they are the Member. This Agreement is for the Member and the Company only; no creditor or other person may enforce it.

5. TAXES
The Company is a disregarded entity for federal income tax purposes, so its income and expenses are reported on the Member's own return, unless the Member elects in writing and files with the IRS for the Company to be taxed differently (for example as an S corporation). The Company is still treated as a separate business for payroll taxes, so it uses its own tax number for employees. The Member should talk to the tax preparer before making any election.

6. ADDING ANOTHER MEMBER
The Company may admit another member only by a written amendment signed by the Member. When another member is admitted, this Agreement must be replaced by a multi-member operating agreement and the Company's tax treatment must be reviewed with the tax preparer. The Company will first give any notice to, and obtain any approval from, the agencies that issued its licenses and permits, its landlord and its lenders that a change of owner requires.

7. DEATH OR INCAPACITY
{{#if successor}}If the Member dies, {{successor}} is admitted as the sole member of the Company at that moment, if {{successor}} accepts, and the Company continues without dissolving; if {{successor}} does not accept, the Member's personal representative may be admitted instead. If the Member is incapacitated, {{successor}} may manage the Company only as far as the Member's power of attorney or a court order allows.{{else}}If the Member dies, the Member's personal representative may be admitted as the member and continue the Company or wind it up, as state law allows. If the Member is incapacitated, the Company's affairs are handled as state law provides.{{/if}} The person who takes over will give the notices, and seek the approvals, that a change of owner requires from the agencies that issued the Company's licenses and permits, its landlord and its lenders.

8. GENERAL
This is the entire operating agreement of the Company. The Member may amend it at any time in writing. If a term cannot be enforced, the rest stays in force. This Agreement is governed by the laws of the State of {{state}}.

MEMBER
{{member}}
Signature: ______________________________   Date: ______________
If the Member is a trust or a company — By: ______________________________   Name: ______________________________   Title: ______________________________`,
  },
  {
    key: "corporate_resolution", title: "Company Resolution (Corporation or LLC)", category: BUSINESS,
    description: "Records a decision of a corporation's directors or shareholders, or of an LLC's members or manager — opening a bank account, borrowing, signing a lease, paying a bonus.",
    reviewNote: "Banks and agencies often insist on their own resolution form and on a certificate signed by an officer; the certificate at the end is for that. For a Maryland corporation, action without a meeting needs the written consent of every director (§2-408) and, for shareholders, every shareholder unless the charter allows less — if less than all sign, the corporation must notify the others within 10 days (§2-505). A meeting resolution needs a quorum, so do not use the meeting wording if a quorum was not present. For an LLC, check what the operating agreement requires. If a signer has a personal interest in the decision (a bonus, loan or lease with the owner), the decision should be approved by the disinterested directors or members and be fair and reasonable to the company (see §2-419 for corporations) — confirm with an attorney how to document it.",
    steps: [
      { title: "The company", questions: [text("corporation", "Company or corporation name", { prefill: "clientName", required: true }), text("incorporatedIn", "State where it was formed", { default: "Maryland", required: true, prefill: "stateName" }), effective(),
        pick("actingBody", "Decision made by", [["directors", "The board of directors (corporation)"], ["shareholders", "The shareholders (corporation)"], ["members", "The members (LLC)"], ["manager", "The manager (LLC)"]], { required: true, default: "directors" }),
        pick("how", "Adopted", [["meeting", "At a meeting"], ["writing", "By written consent, without a meeting"]], { required: true, default: "writing", help: "Not used when the manager decides alone. Use a meeting only if a quorum was present." }),
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

{{#if actingBody=manager}}The undersigned, being the manager of {{corporation}}, adopts the following resolution in writing:{{else}}{{#if how=meeting}}At a meeting{{#if meetingDate}} held on {{meetingDate}}{{/if}}, the {{#if actingBody=directors}}directors{{/if}}{{#if actingBody=shareholders}}shareholders{{/if}}{{#if actingBody=members}}members{{/if}} of {{corporation}} adopted the following resolution{{#if quorumPresent}}, a quorum being present{{/if}}{{#if votesFor}}, by a vote of {{votesFor}} in favor{{#if votesAgainst}} and {{votesAgainst}} against{{/if}}{{/if}}:{{else}}The undersigned {{#if actingBody=directors}}directors{{/if}}{{#if actingBody=shareholders}}shareholders{{/if}}{{#if actingBody=members}}members{{/if}} of {{corporation}} consent to and adopt the following resolution without a meeting. This consent takes effect only when it is signed by every {{#if actingBody=directors}}director{{/if}}{{#if actingBody=shareholders}}shareholder{{/if}}{{#if actingBody=members}}member{{/if}} entitled to vote{{#if !actingBody=directors}} (or by the number the company's governing documents allow{{#if actingBody=shareholders}}, in which case the company will promptly notify each shareholder who did not sign, as the law requires{{/if}}){{/if}}{{#if allSign}}, and every one of them has signed below{{/if}}, and it will be filed with the company's records:{{/if}}{{/if}}

RESOLVED, that {{resolved}}

{{#if authorizedPerson}}FURTHER RESOLVED, that {{authorizedPerson}} is authorized to take every action and sign every document needed to carry out this resolution, and any such action already taken within the scope of this resolution is approved and confirmed.

{{/if}}{{#if interested}}The interest of {{interestedPerson}} in this matter was disclosed to the {{#if actingBody=directors}}board{{/if}}{{#if actingBody=shareholders}}shareholders{{/if}}{{#if actingBody=members}}members{{/if}}{{#if actingBody=manager}}members{{/if}} and is known to them, and this action is approved knowing of that interest and as fair and reasonable to the company.

{{/if}}This resolution is to be kept with the company's records.{{#if actingBody=members}} If a signer is a company, it signs through an authorized person whose name and title are written next to its signature.{{/if}}

{{#list signers}}{{name}}{{#if role}}, {{role}}{{/if}}
Signature: ______________________________   Date: ______________

{{/list}}CERTIFICATE
I, ______________________________, the ______________________________ of {{corporation}}, certify that the above is a true copy of a resolution adopted{{#if meetingDate}} on {{meetingDate}}{{else}} on {{effectiveDate}}{{/if}} and that it has not been changed or withdrawn.
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "annual_meeting_minutes", title: "Minutes of Annual Meeting", category: BUSINESS,
    description: "A record of a corporation's yearly meeting — attendance, directors elected, officers named, reports reviewed and any pay or distributions decided.",
    reviewNote: "For corporations. An LLC has no yearly-meeting requirement under this form — use a Company Resolution or written consent instead. A Maryland corporation is expected to hold a yearly stockholder meeting to elect directors, although missing one does not end the corporation or void its acts (Corporations and Associations Article §2-501); shareholders can act by unanimous written consent instead, and a one-owner corporation usually records its yearly decisions that way. Confirm what your bylaws require. Only fill in the quorum, share-count and notice questions if they are true — the minutes repeat exactly what you enter. Shareholders elect directors; directors appoint officers, set officer pay and declare dividends, so record pay and dividends only for a meeting of the directors (or of both). Officer pay in an S corporation must be reasonable, and S corporation distributions must be paid in proportion to shares. Confirm the filing deadlines for the corporation's yearly state and tax filings with the tax preparer.",
    steps: [
      { title: "Meeting", questions: [text("corporation", "Corporation name", { prefill: "clientName", required: true }), date("meetingDate", "Date of meeting", { required: true }), text("place", "Place (or 'by phone / video')", { required: true }), text("chair", "Chairperson", { required: true }), text("secretary", "Secretary (took the minutes)", { required: true }),
        pick("who", "Meeting of", [["shareholders", "Shareholders"], ["directors", "Directors"], ["both", "Shareholders and directors"]], { required: true, default: "both" }),
        pick("notice", "Notice of the meeting", [["skip", "Do not say anything about notice"], ["given", "Notice was given as the bylaws require"], ["waived", "Notice was waived in writing"]], { required: true, default: "skip" }),
        yesno("quorumPresent", "A quorum was present", { default: false, help: "Tick this only if it is true. Nothing decided at a meeting without a quorum is valid." }),
        num("sharesOutstanding", "Shares entitled to vote (shareholder meetings)"), num("sharesRepresented", "Shares present in person or by proxy (shareholder meetings)", { help: "Cannot be more than the shares entitled to vote." })] },
      { title: "Business", questions: [
        list("attendees", "Present", [text("name", "Name", { required: true }), text("capacity", "Shareholder / director / officer")], { required: true, addLabel: "Add a person" }),
        list("directors", "Directors elected or re-elected (shareholder meetings)", [text("name", "Name", { required: true })], { addLabel: "Add a director" }),
        list("officers", "Officers appointed (director meetings)", [text("name", "Name", { required: true }), text("office", "Office", { required: true, placeholder: "President, Secretary, Treasurer" })], { addLabel: "Add an officer" }),
        yesno("priorMinutes", "The minutes of the last meeting were approved", { default: false }),
        yesno("financials", "Financial statements for the past year were reviewed", { default: true }), yesno("taxReturns", "The tax filings for the year were reviewed", { default: true }),
        yesno("filings", "The officers were directed to make the corporation's required yearly state and tax filings", { default: false }),
        yesno("ratify", "The acts of the directors and officers during the year were approved", { default: false }),
        area("compDist", "Officer pay, dividends or distributions decided", { help: "Directors set officer pay and declare dividends — use this box for a meeting of the directors (or of both)." }),
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
    reviewNote: "Documenting an owner loan matters for tax: without a written agreement, real repayments and a fair interest rate it can be treated as capital, pay or a distribution. Interest below the IRS applicable federal rate (AFR) can create taxable imputed interest (IRC §7872) when the loans between the owner and the business total more than $10,000 — ask the tax preparer for the AFR (a demand loan uses the short-term rate, which changes) and keep the books and repayments consistent with this agreement. Interest owed to an owner may not be deductible by the business until it is actually paid (IRC §267), and a business that pays an individual owner $10 or more of interest may need to issue Form 1099-INT — ask the tax preparer. A loan from a company to its owner can be treated as a distribution or pay, and forgiving it can create taxable income; for an S corporation also ask about basis, and an LLC or corporation should check that the loan does not leave the company unable to pay its debts. The other owners or the board should approve it. A loan to a corporation is exempt from Maryland's 8% interest limit, but that exemption may not cover an LLC or a loan to an individual (Commercial Law §12-103) — confirm any rate above 8% and any security terms with an attorney.",
    steps: [
      { title: "Parties", questions: [text("company", "Business", { prefill: "clientName", required: true }), text("owner", "Owner / shareholder", { required: true, prefill: "ownerName" }), pick("direction", "Who is lending?", [["toBusiness", "The owner lends money to the business"], ["toOwner", "The business lends money to the owner"]], { required: true, default: "toBusiness" }),
        text("companySigner", "Person signing for the business", { required: true, help: "Often the same person as the owner, signing in a business role." }), text("companyTitle", "Their title", { required: true, placeholder: "e.g. Managing Member, President" }),
        text("approvedBy", "Who approved this loan for the business", { required: true, placeholder: "e.g. the other members, or the board of directors" }), effective(), state()] },
      { title: "Loan", questions: [money("principal", "Amount", { required: true }),
        num("rate", "Annual interest rate (%)", { required: true, help: "Choose a rate at least equal to the IRS applicable federal rate (AFR) for the loan's term in the month the loan is made (for a loan repayable on demand, the short-term rate, which changes); the tax preparer can look it up (the IRS publishes it monthly). Total loans of $10,000 or less between the owner and the business are generally exempt, but confirm that with the tax preparer. Enter 0 only if you have confirmed that no interest is acceptable." }),
        pick("schedule", "Repayment", [["monthly", "Monthly payments"], ["demand", "Repayable on demand"], ["date", "One payment on a date"]], { required: true, default: "monthly" }),
        num("months", "Number of monthly payments", { showIf: { id: "schedule", equals: "monthly" }, required: true }),
        money("paymentAmount", "Amount of each monthly payment", { showIf: { id: "schedule", equals: "monthly" }, required: true }),
        date("firstPayment", "First payment due", { showIf: { id: "schedule", equals: "monthly" }, required: true }),
        date("repayBy", "Repay by", { showIf: { id: "schedule", equals: "date" }, required: true }),
        yesno("secured", "Secured by property"), text("collateral", "Property pledged", { showIf: { id: "secured", equals: true }, required: true, help: "Be specific — for example serial numbers — not just \"all assets\". Have an attorney confirm security terms." }),
        area("extraClauses", "Any additional terms (optional)")] },
    ],
    body: `{{#if direction=toBusiness}}SHAREHOLDER LOAN AGREEMENT{{else}}LOAN FROM COMPANY TO OWNER{{/if}}

This Agreement is made on {{effectiveDate}} between {{company}} (the "Company") and {{owner}} (the "Owner").

1. THE LOAN
{{#if direction=toBusiness}}The Owner lends the Company {{principal}}. The Company records this as a loan from the Owner and not as capital, income or pay.{{else}}The Company lends the Owner {{principal}}. The Company records this as a loan receivable and not as pay or a distribution.{{/if}}

2. INTEREST
{{#if rate}}Interest accrues at {{rate}}% per year, as simple interest on the unpaid balance, and is paid as part of the repayment described below.{{else}}No interest is charged on this loan.{{/if}} Interest and fees together will never exceed the maximum the law allows; any excess is applied to principal or refunded.

3. REPAYMENT
{{#if schedule=monthly}}The loan is repaid in {{months}} equal monthly payments of {{paymentAmount}}, each covering principal{{#if rate}} and interest{{/if}}, on the same day of each month beginning {{firstPayment}}.{{/if}}{{#if schedule=demand}}The loan is repayable within 30 days after written demand by the party that made the loan.{{/if}}{{#if schedule=date}}The loan{{#if rate}}, with accrued interest,{{/if}} is repaid in full by {{repayBy}}.{{/if}} The party that received the loan may repay all or part of it early at any time without penalty. The Company keeps a written record of all advances and repayments.

4. DEFAULT
If a payment is not made within 10 days after written notice that it is past due, or the party that received the loan becomes insolvent or files for bankruptcy, the party that made the loan may declare the whole unpaid balance due immediately by written notice.

{{#if secured}}5. SECURITY
To secure repayment, {{#if direction=toBusiness}}the Company grants the Owner{{else}}the Owner grants the Company{{/if}} a security interest in: {{collateral}}, and authorizes the other party to file financing statements.

{{/if}}6. INTENT, APPROVAL AND RECORDS
The parties intend this to be a genuine loan that will be repaid, and each will record and report the loan and any interest on its books and tax returns consistently with this Agreement. {{approvedBy}} approved this loan for the Company. {{#if direction=toBusiness}}While any balance is unpaid, the Company will not make distributions to owners that would impair its ability to repay this loan. The Owner will sign a subordination agreement if the Company's bank or another lender reasonably requires one.{{else}}The Company will not forgive any part of this loan except by a written decision recorded in its records.{{/if}}

{{#if extraClauses}}7. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}8. GENERAL
Notices must be in writing. This Agreement binds and benefits the parties' heirs, executors and successors, but neither party may transfer it without the other's written consent. Delay in enforcing a right is not a waiver of it. Each person who signs for the Company states that he or she is authorized to do so. This Agreement is the parties' entire agreement on this loan, may be changed only in writing signed by both parties, may be signed in counterparts, including electronically, and is governed by the laws of the State of {{state}}. If any term cannot be enforced, the rest stays in force.

COMPANY: {{company}}
Signature: ______________________________   Date: ______________
Printed name: {{companySigner}}   Title: {{companyTitle}}

OWNER: {{owner}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "payment_agreement", title: "Payment Plan Agreement", category: LENDING,
    description: "An agreed schedule for paying an overdue balance in installments — for invoices, rent or a debt.",
    reviewNote: "If the person owing the money is an individual and the balance is for personal or household purposes (including a home's rent or an individual's tax-return fees), Maryland's Consumer Debt Collection Act applies even to the original creditor (Commercial Law §14-202, which also adopts the federal collection-conduct rules): tick the personal-debt switch, keep any late fee reasonable, and confirm with an attorney. For overdue home rent a late fee may not exceed 5% of the monthly rent (Real Property §8-208). A tax practitioner must return client records on request even when fees are unpaid (31 CFR §10.28), so the pause option says so. Time limits: the general limit to sue on a contract debt is 3 years (Courts & Judicial Proceedings §5-101). For a consumer debt, Maryland bars suing after the limit has run and says a later payment, promise or acknowledgment does not revive it (CJP §5-1202) — do not use this plan on an old personal debt to try to restart the clock; whether signing it affects a business debt's time limit is a question for an attorney. Check that the installments add up to the balance by the final date (not checked by the software). Have an attorney review before use.",
    steps: [
      { title: "Parties", questions: [text("creditor", "Owed to", { prefill: "firmName", required: true }), text("debtor", "Owed by", { prefill: "clientName", required: true }), effective(), state()] },
      { title: "The plan", questions: [text("reason", "What the balance is for", { required: true, placeholder: "e.g. Unpaid invoices for bookkeeping services" }), money("total", "Total owed", { required: true }), money("down", "Paid on the date of the agreement (optional)"),
        money("installment", "Installment amount", { required: true }), pick("frequency", "Paid", [["weekly", "Every week"], ["biweekly", "Every two weeks"], ["monthly", "Every month"]], { required: true, default: "monthly" }), date("firstDue", "First installment due", { required: true }),
        date("finalDue", "Balance paid in full by", { required: true, help: "The last installment is whatever remains, due by this date." }),
        yesno("consumerDebt", "The debt is personal, family or household (an individual's non-business debt, or home rent)", { help: "Tick this for any non-business debt owed by an individual. It adds the protections Maryland law expects and removes nothing." }),
        yesno("lateFee", "Charge a late fee"), money("lateFeeAmount", "Late fee", { showIf: { id: "lateFee", equals: true }, required: true, help: "Keep it small. For home rent it may not exceed 5% of the monthly rent." }),
        yesno("pauseWork", "New work may be paused if a payment is missed", { default: false }),
        area("additionalTerms", "Additional terms (optional)", { placeholder: "e.g. Payment by automatic bank debit, or a named co-signer's obligation" })] },
    ],
    body: `PAYMENT PLAN AGREEMENT

This Agreement is made on {{effectiveDate}} between {{creditor}} ("Creditor") and {{debtor}} ("Debtor").

1. THE BALANCE
Debtor owes Creditor {{total}} for: {{reason}}. Debtor acknowledges that the balance is correct and due.

2. PAYMENT PLAN
{{#if down}}On the date of this Agreement Debtor pays {{down}}. {{/if}}Debtor will pay {{installment}} {{#if frequency=weekly}}every week{{/if}}{{#if frequency=biweekly}}every two weeks{{/if}}{{#if frequency=monthly}}every month{{/if}}, starting {{firstDue}}. The last installment is the entire remaining balance and is due no later than {{finalDue}}. Debtor may pay more at any time without penalty. Each payment is applied to the unpaid balance, and Creditor will give a receipt or statement of the balance on request. No interest accrues under this plan unless Debtor defaults. Payments are made by check or bank transfer to Creditor, or as Creditor directs in writing.

3. MISSED PAYMENTS
{{#if lateFee}}If a payment is received more than 7 days after its due date, Debtor will pay a one-time late fee of {{lateFeeAmount}} for that payment. {{/if}}If a payment is more than 14 days late and Debtor has not paid it within 7 days after Creditor's written notice, Creditor may declare the whole remaining balance due at once. If that happens, any interest or fees that the original agreement or the law allows may be added to the unpaid balance, and Creditor will show Debtor in writing how they were calculated.{{#if pauseWork}} Creditor may also pause new work until the account is current, but will return Debtor's records on request and will not delay any filing that has a legal deadline.{{/if}}

{{#if consumerDebt}}4. PERSONAL AND HOUSEHOLD DEBTS
Creditor will not add any interest, fee or cost that is not stated in this Agreement or allowed by law. If Debtor believes the balance or any charge is wrong, Debtor may tell Creditor in writing, and Creditor will review it and answer in writing.

{{/if}}{{#if additionalTerms}}5. ADDITIONAL TERMS
{{additionalTerms}}

{{/if}}6. GENERAL
If Debtor defaults, Debtor also pays Creditor's reasonable costs of collection, including attorney's fees actually incurred, to the extent the law allows. This Agreement does not cancel the debt or waive any of Creditor's rights if Debtor defaults, and accepting a late payment is not a waiver. When the balance is paid in full, Creditor will confirm in writing that it is paid. Notices must be in writing and may be delivered by hand, by mail or by email to the address the other party last gave. This Agreement is the parties' entire agreement about this plan and may be changed only in writing signed by both. If any part cannot be enforced, the rest stays in force. It may be signed electronically and in counterparts, and each copy is an original. It is governed by the laws of the State of {{state}}.

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
    reviewNote: "Maryland requires written notice at hiring of pay rate, regular paydays and leave (Labor & Employment §3-504), a pay statement every pay period, one pay period's notice before lowering pay or changing a payday, final pay by the next regular payday (§3-505), and pay at least every two weeks or twice a month (§3-502; only administrative, executive or professional employees may be paid less often). Pay must be at least the Maryland minimum wage ($15.00 an hour statewide; some counties set more). This agreement has no non-compete; Maryland voids non-competes for workers paid up to 150% of the State minimum wage and for certain health-care and veterinary workers (§3-716) — use the separate Non-Competition agreement only after checking. Added in this version: payday line, company policies (handbook) clause, lawful deductions for unreturned property, assignment of work product, notices, electronic signature and a free-text box for additional terms. Have an attorney review before use.",
    steps: [
      { title: "Parties and role", questions: [text("employer", "Employer", { prefill: "clientName", required: true }), text("employerAddress", "Employer address", { prefill: "clientAddress" }), text("employee", "Employee", { required: true }), text("employeeAddress", "Employee address"), effective(), text("position", "Position", { required: true }), area("duties", "Main duties", { required: true }), date("startDate", "Start date", { required: true }), state()] },
      { title: "Pay and terms", questions: [pick("payType", "Pay", [["hourly", "Hourly"], ["salary", "Salary"]], { required: true, default: "hourly" }), money("rate", "Hourly rate or annual salary", { required: true, help: "Must not be below the Maryland minimum wage ($15.00 an hour statewide; some counties set a higher rate)." }), pick("payFrequency", "Paid", [["weekly", "Weekly"], ["biweekly", "Every two weeks"], ["semimonthly", "Twice a month"], ["monthly", "Monthly"]], { default: "biweekly", required: true, help: "Monthly pay is lawful only for administrative, executive or professional employees." }),
        text("payday", "Regular payday (optional)", { placeholder: "e.g. every other Friday", help: "Maryland requires telling the employee the regular paydays at hiring. Naming the day here covers that." }),
        text("hours", "Expected hours", { placeholder: "e.g. 40 hours a week" }), yesno("hasProbation", "Include an introductory period", { default: true }), num("probation", "Introductory period (days)", { default: "90", showIf: { id: "hasProbation", equals: true }, required: true }), num("noticeDays", "Notice to resign (days)", { default: "14", required: true }),
        yesno("confidential", "Employee keeps business information confidential", { default: true }), area("benefits", "Benefits, vacation or other terms"),
        area("additionalTerms", "Additional terms (optional)", { placeholder: "Anything else the parties have agreed, e.g. uniform, tools, a bonus or commission plan" })] },
    ],
    body: `EMPLOYMENT AGREEMENT

This Agreement is made on {{effectiveDate}} between {{employer}}{{#if employerAddress}}, {{employerAddress}}{{/if}} ("Employer") and {{employee}}{{#if employeeAddress}}, {{employeeAddress}}{{/if}} ("Employee").

1. POSITION AND DUTIES
Employer employs Employee as {{position}} beginning {{startDate}}. Duties include: {{duties}} Employee will also perform other reasonable duties Employer assigns. Employee will complete Form W-4 and Maryland Form MW507 by the first day of work, and employment depends on Employee completing Form I-9 as federal law requires.

2. PAY
Employee is paid {{#if payType=hourly}}{{rate}} per hour{{else}}a salary of {{rate}} per year{{/if}}, {{#if payFrequency=weekly}}every week{{/if}}{{#if payFrequency=biweekly}}every two weeks{{/if}}{{#if payFrequency=semimonthly}}twice each month{{/if}}{{#if payFrequency=monthly}}once a month{{/if}}, on Employer's regular paydays{{#if payday}} ({{payday}}){{/if}}, less required tax withholding and deductions Employee authorizes in writing.{{#if hours}} Expected hours: {{hours}}.{{/if}} Employer will give Employee at least one pay period's notice before changing the payday or lowering the rate of pay. {{#if payType=hourly}}Hours over 40 in a workweek are paid at overtime rates as the law requires.{{else}}A salary alone does not make a position exempt from overtime; unless Employer states in writing that the position is exempt, hours over 40 in a workweek are paid at overtime rates as the law requires.{{/if}}

{{#if hasProbation}}3. INTRODUCTORY PERIOD
The first {{probation}} days are an introductory period for both sides to decide whether the job is a good fit. Finishing this period does not change the at-will nature of employment described in this Agreement.

{{/if}}4. {{#if benefits}}BENEFITS, LEAVE AND OTHER TERMS{{else}}BENEFITS AND LEAVE{{/if}}
{{#if benefits}}{{benefits}}{{else}}Employee receives the benefits Employer offers to its employees under its policies, which Employer may change.{{/if}} Employee earns sick and safe leave as Maryland law requires (paid leave if Employer has 15 or more employees, unpaid leave if it has fewer). Whether unused vacation or other paid leave is paid when employment ends is stated in Employer's written leave policy.

{{#if confidential}}5. CONFIDENTIALITY
Employee will not share or use Employer's non-public business, customer or financial information except for Employer's business, during or after employment. Nothing in this Agreement stops Employee from discussing wages or working conditions with coworkers or others where the law protects that, or from reporting a possible violation of law to a government agency. Under 18 U.S.C. § 1833(b), an individual is not liable under any trade-secret law for disclosing a trade secret in confidence to a government official or an attorney solely to report or investigate a suspected violation of law, or in a sealed court filing.

{{/if}}6. AT-WILL EMPLOYMENT AND NOTICE
Employment is at will: either party may end it at any time. Employee agrees to give {{noticeDays}} days' notice of resignation where possible; Employer may accept an earlier last day, and Employee is paid for work actually performed through that day. On leaving, Employee returns all Employer property, and Employer pays all wages earned through the last day worked no later than the regular payday that would have applied had employment continued. Employer will not deduct the value of unreturned property from Employee's pay unless Employee has authorized the deduction in writing or the law allows it.

7. COMPANY POLICIES
Employer may adopt and change written policies, such as a handbook. Policies are guidelines and are not a contract or a promise of any procedure or of continued employment. If a policy and this Agreement disagree, this Agreement controls on the terms it covers.

8. GENERAL
Employer carries workers' compensation insurance as Maryland law requires. Work Employee creates for Employer in the job belongs to Employer, and Employee assigns to Employer any rights in it that do not already belong to Employer. This is the parties' entire agreement, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}. If any part of it cannot be enforced, the rest stays in force. Notices must be in writing and sent to the other party's address at the top of this Agreement or a new address given in writing. Employee may not assign this Agreement; Employer may assign it to a successor to the business. The sections on confidentiality and ownership of work continue after employment ends. This Agreement may be signed in copies, including electronically, and all copies together are one agreement.

{{#if additionalTerms}}9. ADDITIONAL TERMS
{{additionalTerms}}

{{/if}}EMPLOYER: {{employer}}
Printed name and title: ______________________________
Signature: ______________________________   Date: ______________

EMPLOYEE: {{employee}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "employee_warning_letter", title: "Employee Warning Letter", category: EMPLOYMENT,
    description: "A written warning that records what happened, what is expected, and the consequence of it happening again.",
    reviewNote: "Keep to dates and facts. Do not mention medical conditions, leave, pay complaints, injury reports, talking with coworkers about pay, religion, nationality or other protected activity — discipline that follows such things can be treated as retaliation. If you have a handbook with steps of progressive discipline, follow it, or the employee may argue it is a promise; this letter says the employer may skip steps. Give the employee a copy and keep a copy. Have an attorney review before using it for a final warning.",
    steps: [
      { title: "Details", questions: [text("employer", "Employer", { prefill: "clientName", required: true }), text("employee", "Employee", { required: true }), effective(), pick("level", "Warning level", [["verbal", "Written record of a verbal warning"], ["first", "First written warning"], ["final", "Final written warning"]], { required: true, default: "first" }),
        date("incidentDate", "Date of the issue", { required: true }), area("issue", "What happened (dates and facts only)", { required: true, help: "No medical, leave, pay-complaint or other protected matters." }), area("expectation", "What is expected from now on", { required: true }),
        yesno("priorWarnings", "There were earlier warnings about this"), text("priorDates", "Dates of earlier warnings", { showIf: { id: "priorWarnings", equals: true } }),
        text("managerName", "Issued by (name)", { required: true, prefill: "ownerName" }), text("managerTitle", "Their title", { required: true, prefill: "ownerTitle" })] },
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

{{#if level=final}}This is a final written warning. Further problems of this kind may lead to ending your employment.{{else}}If this issue continues or happens again, further disciplinary action may follow, up to and including ending your employment.{{/if}} This letter does not change the at-will nature of your employment: {{employer}} may end employment at any time, with or without prior warnings, and may skip any step of its disciplinary process.

Nothing in this letter limits your right to discuss your pay or working conditions with coworkers, or to raise a concern with a government agency, and you will not be disciplined for doing so. If you disagree with anything in this letter, you may add your comments in writing. A copy of this letter will be kept in your personnel file. Signing below shows you received this letter; it does not mean you agree with it. This letter was explained to me in a language I understand.

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
    reviewNote: "Keep it short and neutral. A resignation does not need the employer's approval, but give the notice the job normally expects (often two weeks). The employer must pay all wages earned through the last day by the next regular payday (Labor & Employment §3-505). If you are leaving because of unpaid wages, harassment, discrimination or a safety problem, speak to an attorney before sending — do not put accusations in this letter. Keep a signed or emailed copy.",
    steps: [
      { title: "Details", questions: [text("employee", "Employee name", { required: true }), text("employer", "Employer", { prefill: "clientName", required: true }), text("addressee", "Addressed to (name and title)"), effective(), text("position", "Position"), date("lastDay", "Last day of work", { required: true }), text("reason", "Reason (optional)", { help: "Keep it neutral and short." }), yesno("transition", "Offer to help with the handover", { default: true }), yesno("returnProperty", "Promise to return company property by the last day", { default: true })] },
    ],
    body: `{{effectiveDate}}

{{#if addressee}}{{addressee}}
{{/if}}{{employer}}

Re: Resignation{{#if position}} — {{position}}{{/if}}

Dear {{#if addressee}}{{addressee}}{{else}}Sir or Madam{{/if}},

I am resigning from my position{{#if position}} as {{position}}{{/if}} with {{employer}}. My last day of work will be {{lastDay}}.{{#if reason}} {{reason}}{{/if}}

{{#if transition}}I will gladly help make the handover smooth and train a replacement before I leave. {{/if}}{{#if returnProperty}}I will return all {{employer}} property in my possession on or before my last day. {{/if}}I understand my final pay is due by the regular payday after my last day; please tell me how unused leave is treated under your policy. Please send my final pay and my tax forms to my address on file.

Thank you for the opportunity.

Sincerely,
{{employee}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "service_agreement", title: "Service Agreement", category: LENDING,
    description: "A general agreement for one business to provide services to another — scope, price, timing and rules.",
    reviewNote: "Confirm the limit-of-liability, indemnity and late-interest wording with an attorney. Late interest defaults to 0.5% a month (6% a year); Maryland limits interest on loans and unpaid balances owed by individuals, so confirm any higher rate. If the provider will handle the customer's tax or personal information, add a data-security term and get any separate consent that tax-return rules require (IRC §7216). Whether someone is a true independent contractor depends on the facts (Maryland Labor & Employment §8-205 for unemployment insurance, workers' compensation law, and IRS rules), not only on this wording; in construction and landscaping, Maryland's Workplace Fraud Act (Labor & Employment Title 3, Subtitle 9) presumes employment and requires written notice of classification. The IRS requires Form 1099-NEC when a business pays an individual or partnership $2,000 or more in a year for services paid in 2026 or later ($600 before that) — get a Form W-9 first. Some trades (for example home improvement, electrical, plumbing) need a Maryland license. The ownership clause assigns the finished work to the customer once paid; it does not make the work a \"work made for hire\".",
    steps: [
      { title: "Parties", questions: [text("provider", "Service provider", { required: true }), text("providerAddress", "Provider's address"), text("customer", "Customer", { prefill: "clientName", required: true }), text("customerAddress", "Customer's address", { prefill: "clientAddress" }), effective(), state()] },
      { title: "Services and price", questions: [area("services", "Services", { required: true }), date("startDate", "Starts", { required: true }), yesno("hasEnd", "Fixed end date"), date("endDate", "Ends", { showIf: { id: "hasEnd", equals: true }, required: true }),
        yesno("earlyEnd", "Either party may end the agreement early on 30 days' written notice", { showIf: { id: "hasEnd", equals: true }, default: true }),
        pick("priceType", "Price", [["fixed", "A fixed price"], ["hourly", "Hourly"], ["monthly", "Monthly"]], { required: true, default: "fixed" }), money("price", "Amount", { required: true }),
        text("fixedSchedule", "When the fixed price is invoiced", { showIf: { id: "priceType", equals: "fixed" }, placeholder: "e.g. 50% when work starts and 50% when it is finished" }),
        money("hourlyCap", "Most the provider may bill without the customer's written approval (optional)", { showIf: { id: "priceType", equals: "hourly" } }),
        num("payDays", "Invoices paid within (days)", { default: "30", required: true }),
        num("lateRate", "Interest on overdue invoices (% per month; 0 for none)", { default: "0.5", help: "0.5% a month is 6% a year. Maryland limits interest on loans and on balances owed by individuals, so confirm any higher rate with an attorney." }),
        yesno("warranty", "Provider will fix errors in the work at no charge", { default: true }), yesno("insurance", "Provider carries liability insurance"), money("insuranceAmount", "Coverage amount (optional)", { showIf: { id: "insurance", equals: true } })] },
      { title: "Other terms", questions: [
        yesno("indemnity", "Each party covers the other against third-party claims it causes", { default: false, help: "A mutual clause: each party pays for third-party claims caused by its own negligence, willful misconduct or breach." }),
        yesno("mediation", "Try mediation before going to court", { default: false }),
        area("extraClauses", "Any additional terms (optional)")] },
    ],
    body: `SERVICE AGREEMENT

This Agreement is made on {{effectiveDate}} between {{provider}}{{#if providerAddress}}, {{providerAddress}}{{/if}} ("Provider") and {{customer}}{{#if customerAddress}}, {{customerAddress}}{{/if}} ("Customer").

1. SERVICES
Provider will perform these services for Customer: {{services}} Customer will give Provider, on time, the information, access and decisions Provider reasonably needs. Any change to the services or the price must be agreed in writing, and Provider need not start extra work until the change is agreed.

2. TERM
Services start on {{startDate}}{{#if hasEnd}} and end on {{endDate}}{{#if earlyEnd}}, unless either party ends this Agreement earlier on 30 days' written notice{{/if}}{{else}} and continue until either party ends this Agreement on 30 days' written notice{{/if}}.

3. PRICE AND PAYMENT
Customer will pay Provider {{#if priceType=fixed}}a fixed price of {{price}}{{/if}}{{#if priceType=hourly}}{{price}} per hour{{/if}}{{#if priceType=monthly}}{{price}} per month{{/if}}. {{#if priceType=fixed}}{{#if fixedSchedule}}The fixed price is invoiced {{fixedSchedule}}. {{/if}}{{/if}}{{#if priceType=hourly}}{{#if hourlyCap}}Provider will not bill more than {{hourlyCap}} without Customer's written approval. {{/if}}{{/if}}Provider will invoice Customer and Customer will pay within {{payDays|day}} of each invoice. If Customer disputes part of an invoice in good faith, Customer will tell Provider in writing before the due date and pay the undisputed part on time. {{#if lateRate}}Amounts unpaid after the due date bear simple interest at {{lateRate}}% per month, but never more than the maximum rate the law allows. {{/if}}Prices do not include any sales or similar tax that applies to the services; Customer pays it.

4. QUALITY OF WORK
Provider will perform the services in a professional manner, and holds and will keep every license and permit its services require.{{#if warranty}} Provider will correct errors in the services at no extra charge if Customer reports them within 30 days of the work being done. This correction is Customer's only remedy for errors in the services.{{/if}}{{#if insurance}} Provider carries liability insurance{{#if insuranceAmount}} of at least {{insuranceAmount}}{{/if}} for the services and will give Customer proof of it on request.{{/if}}

5. OWNERSHIP OF WORK
Once Customer has paid for them in full, Provider assigns to Customer its rights in the final deliverables created specifically for Customer. Provider keeps its own tools, templates, software and know-how, including anything it had before or develops separately, and gives Customer a non-exclusive license to use any of them that are built into the deliverables, for Customer's own business.

6. LIMIT OF LIABILITY
Provider's total liability under this Agreement is limited to the fees Customer paid for the services that gave rise to the claim, and neither party is liable to the other for indirect or consequential losses. This does not limit any liability that the law does not allow to be limited{{#if indemnity}}, or a party's duty to indemnify under the section on indemnity{{/if}}.

{{#if indemnity}}7. INDEMNITY
Each party will defend the other party against, and pay the losses from, a third party's claim to the extent the claim is caused by the first party's negligence, willful misconduct or breach of this Agreement. The party asking for protection must give prompt written notice of the claim and reasonable help, and the party giving protection controls the defense but may not settle in a way that binds the other party without its consent.

{{/if}}8. INDEPENDENT PARTIES
Provider is an independent contractor and not Customer's employee or partner. Provider decides how and when the work is done, uses its own tools, may work for others, has no authority to bind Customer, and receives no employee benefits. Provider is responsible for its own taxes, licenses and insurance, and for any workers it uses, including paying them, withholding taxes and carrying workers' compensation insurance where the law requires. Provider will give Customer a completed Form W-9 on request, and Customer will report payments to Provider on Form 1099 where the law requires.

9. CONFIDENTIALITY
Each party will keep the other's non-public business information confidential, use it only for this Agreement, and return or destroy it on request, during and after this Agreement. This does not cover information that is public through no fault of the receiving party, was already known to it, or must be disclosed by law. Nothing in this Agreement prevents a person from confidentially disclosing a trade secret to a government official or an attorney solely to report or investigate a suspected violation of law, or from reporting a suspected violation of law to a government agency.

10. ENDING THE AGREEMENT
Either party may end this Agreement if the other materially breaks it and does not fix the problem within 15 days of written notice. Customer pays for services performed up to the date the Agreement ends{{#if priceType=fixed}} and a fair share of the fixed price for the work done{{/if}}. Provisions that by their nature are meant to continue (such as those on payment, ownership of work, limit of liability and confidentiality) continue after this Agreement ends.

{{#if mediation}}11. DISPUTES
If a dispute arises, the parties will first try in good faith to settle it by talking, and then by mediation with a mediator they both accept, sharing the mediator's fee equally, before either starts a lawsuit. This does not prevent either party from asking a court for urgent protection of confidential information or ownership rights.

{{/if}}{{#if extraClauses}}12. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}13. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, and may not be assigned without the other party's written consent. Notices must be in writing and sent to the addresses above or to a new address given in writing. Delay in enforcing a right is not a waiver of it. If a term cannot be enforced, the rest stays in force. This Agreement may be signed in counterparts and electronically, and is governed by the laws of the State of {{state}}, whose courts may settle any dispute under it.

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
    reviewNote: "Whether a consultant is truly independent depends on the facts (control, own business, other clients — Maryland Labor & Employment §8-205 for unemployment insurance, workers' compensation law, and IRS rules), not only on this wording; in construction and landscaping, Maryland's Workplace Fraud Act (Labor & Employment Title 3, Subtitle 9) presumes employment and requires written notice of classification. Get a Form W-9 from the consultant before paying. The IRS requires Form 1099-NEC when a business pays an individual or partnership $2,000 or more in a year for services paid in 2026 or later ($600 before that). Confirm the work-product assignment, confidentiality, limit-of-liability and indemnity wording with an attorney. The work-product clause is an assignment, not a \"work made for hire\" clause, which the Copyright Act allows for only a few kinds of work. Late interest defaults to 0.5% a month (6% a year); confirm any higher rate. Maryland professional licenses apply to some advice (for example legal, engineering or home-improvement work) — this form does not authorize unlicensed practice.",
    steps: [
      { title: "Parties", questions: [text("client", "Company", { prefill: "clientName", required: true }), text("clientAddress", "Company address", { prefill: "clientAddress" }), text("consultant", "Consultant", { required: true }), text("consultantAddress", "Consultant's address"), effective(), state()] },
      { title: "Work", questions: [area("scope", "What the consultant will do", { required: true }), date("startDate", "Start date", { required: true }), yesno("hasEnd", "Fixed end date"), date("endDate", "End date", { showIf: { id: "hasEnd", equals: true }, required: true }),
        pick("feeType", "Fee", [["fixed", "Fixed fee"], ["hourly", "Hourly"], ["monthly", "Monthly retainer"]], { required: true, default: "hourly" }), money("fee", "Amount", { required: true }),
        text("feeSchedule", "When the fixed fee is invoiced", { showIf: { id: "feeType", equals: "fixed" }, placeholder: "e.g. half when work starts and half when it is finished" }),
        num("payDays", "Invoices paid within (days)", { default: "30", required: true }),
        num("lateRate", "Interest on overdue invoices (% per month; 0 for none)", { default: "0.5", help: "0.5% a month is 6% a year. Maryland limits interest on loans and on balances owed by individuals, so confirm any higher rate with an attorney." }),
        yesno("expenses", "Company reimburses approved expenses", { default: true }), yesno("confidential", "Consultant keeps information confidential", { default: true })] },
      { title: "Other terms", questions: [
        yesno("limitLiability", "Limit the consultant's liability to the fees paid", { default: true }),
        yesno("indemnity", "Each party covers the other against third-party claims it causes", { default: false, help: "A mutual clause: each party pays for third-party claims caused by its own negligence, willful misconduct or breach." }),
        yesno("mediation", "Try mediation before going to court", { default: false }),
        area("extraClauses", "Any additional terms (optional)")] },
    ],
    body: `CONSULTING AGREEMENT

This Agreement is made on {{effectiveDate}} between {{client}}{{#if clientAddress}}, {{clientAddress}}{{/if}} ("Company") and {{consultant}}{{#if consultantAddress}}, {{consultantAddress}}{{/if}} ("Consultant").

1. SERVICES
Consultant will provide the following consulting services: {{scope}} Company will give Consultant, on time, the information, access and decisions Consultant reasonably needs. Any change to the services must be agreed in writing.

2. TERM
Services begin {{startDate}}{{#if hasEnd}} and end {{endDate}}{{else}} and continue until either party gives 30 days' written notice{{/if}}.

3. FEES
Company will pay Consultant {{#if feeType=fixed}}a fixed fee of {{fee}}{{#if feeSchedule}}, invoiced {{feeSchedule}}{{/if}}{{/if}}{{#if feeType=hourly}}{{fee}} per hour{{/if}}{{#if feeType=monthly}}{{fee}} per month{{/if}}, payable within {{payDays|day}} of each invoice.{{#if feeType=hourly}} Invoices will show the hours worked.{{/if}}{{#if expenses}} Company reimburses reasonable expenses it approves in advance and that Consultant documents.{{/if}} If Company disputes part of an invoice in good faith, it will tell Consultant in writing before the due date and pay the undisputed part on time.{{#if lateRate}} Amounts unpaid after the due date bear simple interest at {{lateRate}}% per month, but never more than the maximum rate the law allows.{{/if}}

4. INDEPENDENT CONSULTANT
Consultant is an independent contractor and not Company's employee or partner, controls how and when the work is done, uses their own tools, may work for others, has no authority to bind Company, receives no employee benefits, and is responsible for their own taxes, licenses and insurance, and for any workers they use, including paying them, withholding taxes and carrying workers' compensation insurance where the law requires. Before the first payment Consultant will give Company a completed Form W-9. Company will report payments on Form 1099-NEC where the law requires.

5. WORK PRODUCT
Once Company pays for them, Consultant assigns to Company all rights in the deliverables created for Company under this Agreement, and will sign any further papers needed for this. Consultant keeps its own tools, methods, know-how and anything it had before or develops separately, and gives Company a non-exclusive license to use any of them that are built into the deliverables, for Company's own business. Consultant will not include another person's confidential information or protected material in the deliverables without permission.

6. NO GUARANTEE OF RESULTS
Consultant will give advice and services with professional care but does not guarantee any result. Company makes the final decisions and is responsible for them.

{{#if confidential}}7. CONFIDENTIALITY
Consultant will keep Company's non-public information confidential, use it only for this work, and return or destroy it on request, during and after this Agreement. This does not cover information that is public through no fault of Consultant, was already known to Consultant, or must be disclosed by law. Nothing in this Agreement prevents Consultant from reporting a suspected violation of law to a government agency, or from confidentially disclosing a trade secret to a government official or an attorney solely to report or investigate a suspected violation of law. Under the federal Defend Trade Secrets Act (18 U.S.C. §1833(b)), an individual is not criminally or civilly liable under any federal or state trade secret law for disclosing a trade secret in confidence to a government official or an attorney solely to report or investigate a suspected violation of law, or in a complaint or other document filed under seal in a lawsuit or other proceeding.

{{/if}}{{#if limitLiability}}8. LIMIT OF LIABILITY
Consultant's total liability under this Agreement is limited to the fees Company paid for the services that gave rise to the claim, and neither party is liable to the other for indirect or consequential losses. This does not limit any liability that the law does not allow to be limited{{#if indemnity}}, or a party's duty to indemnify under the section on indemnity{{/if}}.

{{/if}}{{#if indemnity}}9. INDEMNITY
Each party will defend the other party against, and pay the losses from, a third party's claim to the extent the claim is caused by the first party's negligence, willful misconduct or breach of this Agreement. The party asking for protection must give prompt written notice of the claim and reasonable help, and the party giving protection controls the defense but may not settle in a way that binds the other party without its consent.

{{/if}}10. ENDING THE AGREEMENT
Either party may end this Agreement on 30 days' written notice, or sooner if the other materially breaks it and does not fix the problem within 15 days of written notice. When it ends, Company pays for services performed through the end date and, for a fixed fee, a fair share of the fee for the work done. Provisions that by their nature are meant to continue (such as those on payment, work product, limit of liability and confidentiality) continue after this Agreement ends.

{{#if mediation}}11. DISPUTES
If a dispute arises, the parties will first try in good faith to settle it by talking, and then by mediation with a mediator they both accept, sharing the mediator's fee equally, before either starts a lawsuit. This does not prevent either party from asking a court for urgent protection of confidential information or ownership rights.

{{/if}}{{#if extraClauses}}12. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}13. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, and may not be assigned without the other party's written consent. Notices must be in writing and sent to the addresses above or to a new address given in writing. Delay in enforcing a right is not a waiver of it. If a term cannot be enforced, the rest stays in force. This Agreement may be signed in counterparts and electronically, and is governed by the laws of the State of {{state}}, whose courts may settle any dispute under it.

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
    reviewNote: "Send this in the creditor's own name, signed by the creditor — not in the firm's name. Debt-collection rules can apply: the federal FDCPA covers people collecting a personal or household debt for someone else, and Maryland's Consumer Debt Collection Act reaches creditors collecting their own consumer debts (it forbids, among other things, threatening a right the collector knows does not exist, and it adopts the federal collection-conduct rules — Commercial Law §14-202); collecting consumer claims for another person also needs a Maryland collection-agency licence. Confirm with an attorney before sending a letter on a client's behalf or for a personal debt. Do not threaten anything the creditor does not intend to do, and never mention a lawsuit on a debt older than 3 years (the general Maryland limit to sue on a contract, Courts & Judicial Proceedings §5-101; for consumer debts suing after it runs is barred, CJP §5-1202). Include only interest and fees the agreement or the law allows, and attach the invoice. This letter does not give the written debt-validation notice the federal rules require of a third-party collector — an attorney should supply that if it applies.",
    steps: [
      { title: "Details", questions: [text("sender", "From (your business)", { prefill: "clientName", required: true }), text("senderTitle", "Signer's title", { placeholder: "e.g. Owner", prefill: "ownerTitle" }), text("senderAddress", "Your address", { prefill: "clientAddress" }), text("senderContact", "Phone or email for replies", { required: true }), text("recipient", "To (who owes the money)", { required: true }), text("recipientAddress", "Their address"), effective(),
        text("deliveryMethod", "Sent by (optional)", { placeholder: "e.g. certified mail and email" }),
        text("reference", "Invoice or agreement it relates to", { required: true, placeholder: "e.g. Invoice 1042 dated August 3, 2026" }), date("dueDate", "Date it was originally due (optional)"), money("amount", "Amount owed", { required: true }), date("deadline", "Pay by", { required: true, help: "Allow at least 10 days from the date of the letter." }), text("howToPay", "How to pay", { placeholder: "e.g. Check payable to the business, or bank transfer", help: "Write it as a phrase without a final period; the letter adds one." }),
        yesno("consumerDebt", "The debt is for personal, family or household purposes (not business)", { help: "Tick this for a personal or household debt. Debt-collection rules apply more strictly to these debts — send the letter in the creditor's own name, not the firm's, and have an attorney review it." }),
        yesno("enclosed", "Enclose a copy of the invoice or statement", { default: true }),
        yesno("interest", "Say that interest or fees may be added"), yesno("legal", "Say that legal action may follow if unpaid", { default: true, help: "Tick only if the creditor really may sue and the debt is less than 3 years past due." })] },
    ],
    body: `{{sender}}{{#if senderAddress}}
{{senderAddress}}{{/if}}

{{effectiveDate}}{{#if deliveryMethod}}

Sent by {{deliveryMethod}}{{/if}}

{{recipient}}{{#if recipientAddress}}
{{recipientAddress}}{{/if}}

Re: Demand for payment — {{reference}}

Dear {{recipient}},

Our records show that {{amount}} remains unpaid on {{reference}}{{#if dueDate}}, which was due on {{dueDate}}{{/if}}, and the payment is overdue. Please pay the full amount by {{deadline}}.{{#if howToPay}} Payment may be made as follows: {{howToPay}}.{{/if}}{{#if enclosed}} A copy of the supporting invoice or statement is enclosed.{{/if}}

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
    reviewNote: "For a home, Maryland's security-deposit rules still apply even though the lease ends by agreement: the landlord must send an itemized list of any deductions and return the rest, with interest, within 45 days after the tenancy ends, and the tenant cannot give up those rights (Real Property Article 8-203, which cannot be waived). The tenant is entitled to be present at the move-out inspection if the tenant gives the landlord certified-mail notice at least 15 days before moving, so give the landlord the new mailing address below and, if the move date is less than 15 days away, have the landlord agree in writing to the inspection date. A landlord cannot retake a home without a court order unless the tenant has actually left (8-216). A business landlord may choose to keep the deposit, but only to the extent the lease allows. If a guarantor signed the lease, the guarantor should sign this agreement too, to consent to it. A tenant who ends a home lease early because of abuse or military orders has separate statutory rights. Not checked by the app: that the end date is after the date of signing. Companies must sign through an officer with a title.",
    steps: [
      { title: "Lease", questions: [text("landlord", "Landlord", { required: true }), text("tenant", "Tenant", { prefill: "clientName", required: true }), text("premises", "Space being leased", { required: true }), date("leaseDate", "Date of the original lease", { required: true }),
        pick("leaseKind", "The lease is for", [["residential", "A home (where the tenant lives)"], ["commercial", "A business space"]], { required: true }), text("guarantor", "Guarantor of the lease (if any)", { help: "Leave blank if nobody guaranteed the lease." }), effective(), state()] },
      { title: "Ending it", questions: [date("endDate", "Lease ends on", { required: true }), money("deposit", "Security deposit held", { default: "0" }), pick("depositTreatment", "The deposit will be", [["return", "Returned in full"], ["deduct", "Returned less amounts owed"], ["keep", "Kept by the landlord (business leases only)"]], { default: "return", required: true }),
        text("forwardingAddress", "Tenant's mailing address after moving out (optional)", { help: "Where the landlord sends the deposit and the list of deductions. If left empty, the tenant's last known address is used." }),
        money("finalPayment", "Final payment from tenant (0 if none)", { default: "0" }), yesno("restore", "Tenant leaves the space clean and in the condition the lease requires", { default: true }), yesno("release", "Each side releases the other from further lease claims", { default: true }),
        area("extraClauses", "Any additional terms (optional)")] },
    ],
    body: `LEASE TERMINATION AGREEMENT

This Agreement is made on {{effectiveDate}} between {{landlord}} ("Landlord") and {{tenant}} ("Tenant") about the lease dated {{leaseDate}} for {{premises}} (the "Lease"). Both parties agree to it voluntarily.

1. EARLY END OF LEASE
Landlord and Tenant agree that the Lease ends on {{endDate}}, and Tenant will give up the space and return all keys by that date.

2. RENT AND PAYMENTS
Tenant pays all rent and other charges due under the Lease up to {{endDate}}.{{#if finalPayment}} Tenant also pays {{finalPayment}} as a final payment to Landlord on or before {{endDate}}.{{/if}} Tenant states that it has not assigned or sublet the Lease or the space.

3. SECURITY DEPOSIT
{{#if deposit}}Landlord holds a security deposit of {{deposit}}. {{#if leaseKind=residential}}Landlord will inspect the space within 5 days before or after {{endDate}}, will tell Tenant the inspection date in writing, and Tenant may be present if Tenant gives Landlord the notice the law requires or Landlord agrees in writing. Within 45 days after {{endDate}}, Landlord will mail Tenant, by first-class mail{{#if forwardingAddress}} to {{forwardingAddress}}{{else}} to Tenant's last known address{{/if}}, {{#if depositTreatment=return}}the deposit in full, with any interest due{{else}}an itemized list of any deductions for unpaid rent or damage beyond normal wear, with their actual costs, and the rest of the deposit with any interest due{{/if}}. This Agreement does not give up any of Tenant's rights under Maryland's security-deposit law.{{else}}{{#if depositTreatment=keep}}The deposit will be kept by Landlord.{{else}}Within 30 days after {{endDate}}, the deposit will be {{#if depositTreatment=return}}returned to Tenant in full{{else}}returned to Tenant less any amounts owed and any damage beyond normal wear{{/if}}{{#if forwardingAddress}}, sent to {{forwardingAddress}}{{/if}}.{{/if}}{{/if}}{{else}}No security deposit is being held.{{/if}}

4. SURRENDER
Tenant returns all keys on {{endDate}}. If Tenant stays longer, rent under the Lease continues for each extra day and Landlord may recover possession through the court. Belongings left in the space after {{endDate}} may be treated as abandoned to the extent the law allows.{{#if guarantor}} {{guarantor}} (the guarantor) signs this Agreement below to consent to it. The guarantee of the Lease continues for any amount Tenant still owes under the Lease or this Agreement until it is paid, and ends once Tenant has given up the space and paid what this Agreement requires.{{/if}}

{{#if restore}}5. CONDITION OF THE SPACE
Tenant leaves the space clean, free of Tenant's belongings, and in the condition required by the Lease, normal wear excepted.

{{/if}}{{#if release}}6. RELEASE
Once Tenant has given up the space and paid what this Agreement requires, each party releases the other from claims under the Lease, except the obligations in this Agreement, Tenant's rights to the security deposit, rights that cannot be waived by law, damage that was not apparent at move-out, charges still to be settled, and claims made by other people.

{{/if}}{{#if extraClauses}}7. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}8. GENERAL
This Agreement is the parties' entire agreement about ending the Lease, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}. It may be signed in counterparts, including electronically. Each person who signs for a company states that he or she is authorized to do so.

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
    reviewNote: "If an employee dies, tell Maryland OSHA (MOSH) within 8 hours (also within 8 hours if three or more employees are hospitalized, per MOSH guidance); if an employee is admitted to a hospital, has an amputation or loses an eye, within 24 hours (MOSH 410-527-4499; after hours 1-888-257-6674; federal rule 29 CFR §1904.39). If an employee loses more than 3 days of work from an injury or dies, the employer's report to the Workers' Compensation Commission is due within 10 days after the employer learns of it (Labor & Employment §9-707); the claim itself is made by the employee. Tell your insurance carrier — workers' compensation for an employee, general liability for a customer or visitor. Employers with more than 10 employees generally must also keep OSHA injury logs and complete OSHA Form 301 within 7 days of a recordable case; this report is not those forms. Keep medical details out of the general personnel file. Take photographs and write down witness names right away.",
    steps: [
      { title: "The incident", questions: [text("business", "Business", { prefill: "clientName", required: true }), date("incidentDate", "Date of incident", { required: true }), text("incidentTime", "Time", { placeholder: "e.g. About 3:30 PM" }), text("location", "Where it happened", { required: true }),
        text("person", "Person involved", { required: true }), pick("personType", "That person is", [["employee", "An employee"], ["customer", "A customer"], ["contractor", "A contractor"], ["visitor", "A visitor"]], { default: "employee" }), text("position", "Their position"), area("description", "What happened", { required: true }), text("witnesses", "Witnesses (names)")] },
      { title: "Injury and follow-up", questions: [yesno("injury", "Someone was injured"), area("injuryDetails", "Injury and body part", { showIf: { id: "injury", equals: true }, required: true }), yesno("medical", "Medical treatment was given", { showIf: { id: "injury", equals: true } }), text("treatment", "Treatment and where", { showIf: { id: "medical", equals: true } }),
        date("knownDate", "Date the business first learned of the injury", { showIf: { id: "injury", equals: true }, help: "The 10-day workers' compensation report runs from this date." }),
        yesno("reportedMosh", "Reported to Maryland OSHA (MOSH) — only for an employee who died, was hospitalized, lost a limb or lost an eye", { showIf: { id: "injury", equals: true } }), yesno("reportedCarrier", "Reported to the insurance carrier (workers' compensation for an employee, general liability for anyone else)", { showIf: { id: "injury", equals: true } }),
        area("actions", "What was done afterwards / to prevent it happening again"), text("reportedBy", "Report completed by (name and title)", { required: true, prefill: "ownerNameTitle" }), date("reportDate", "Date completed", { prefill: "today", required: true })] },
    ],
    body: `WORKPLACE INCIDENT REPORT
{{business}}
Confidential: contains injury information. Keep it in a separate incident file, not the general personnel file.

Date of incident: {{incidentDate}}{{#if incidentTime}}   Time: {{incidentTime}}{{/if}}
Location: {{location}}
Person involved: {{person}}{{#if position}} ({{position}}){{/if}}, {{#if personType=employee}}an employee{{/if}}{{#if personType=customer}}a customer{{/if}}{{#if personType=contractor}}a contractor{{/if}}{{#if personType=visitor}}a visitor{{/if}}
{{#if witnesses}}Witnesses: {{witnesses}}{{/if}}

WHAT HAPPENED
{{description}}

INJURY
{{#if injury}}Injury reported: {{injuryDetails}}
{{#if medical}}Medical treatment: {{treatment}}{{else}}No medical treatment was given at the time.{{/if}}
{{#if knownDate}}The business first learned of the injury on {{knownDate}}.
{{/if}}{{#if personType=employee}}Reported to Maryland OSHA (MOSH): {{#if reportedMosh}}Yes{{else}}No{{/if}}   Reported to the workers' compensation carrier: {{#if reportedCarrier}}Yes{{else}}No{{/if}}{{else}}Reported to the insurance carrier: {{#if reportedCarrier}}Yes{{else}}No{{/if}}{{/if}}{{else}}No injury was reported at the time of this report.{{/if}}

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
    reviewNote: "For a Maryland court filing, Maryland Rule 1-304 (as amended 2020, checked in the Court of Appeals' rules order) lets the statement be made either (a) before an officer who administers the oath or affirmation and certifies that in writing, or (b) simply by signing one of two set sentences: 'I solemnly affirm under the penalties of perjury that the contents of this document are true to the best of my knowledge, information, and belief' (general) or '...and upon personal knowledge that the contents of this document are true' (personal knowledge). This document uses those sentences exactly and also has a notary section, so it satisfies either route. Use personal knowledge only for facts the signer saw or did; use the other choice for facts the signer believes from what others told them. If any part of the statements is not from personal knowledge, choose the general sentence. A summary-judgment affidavit has further requirements in Rule 2-501. A notary section only counts when the signer signs in front of the notary: leave the signature, date and notary section blank until then. For federal courts a different sentence is used (28 U.S.C. §1746) — not built here. Other offices (a bank, an agency, a school) may want their own form or a notary. The Arabic edition is for the signer's understanding — a court will want an English version signed, and a signer who does not read English may need an interpreter's statement. Free-text additional terms are deliberately not offered on an affidavit.",
    steps: [
      { title: "Statement", questions: [text("affiant", "Person making the statement", { required: true }), text("address", "Their address", { required: true }), text("docTitle", "Title of the affidavit (optional)", { placeholder: "e.g. Affidavit of Residence" }), text("county", "County or Baltimore City where you will sign before the notary", { required: true }), state({ id: "stateName", label: "State" } as Partial<Question>),
        pick("knowledgeBasis", "The facts are based on", [["personal", "The signer's own personal knowledge"], ["belief", "Knowledge, information and belief"]], { required: true, default: "personal" }),
        list("facts", "Statements of fact", [area("fact", "Statement", { required: true })], { required: true, addLabel: "Add a statement" })] },
    ],
    body: `AFFIDAVIT{{#if docTitle}}
{{docTitle}}{{/if}}

State of {{stateName}}
City/County of {{county}}

I, {{affiant}}, of {{address}}, state that I am over 18 years of age and competent to make this affidavit, and that:

{{#list facts}}{{n}}. {{fact}}

{{/list}}{{#if knowledgeBasis=personal}}I solemnly affirm under the penalties of perjury and upon personal knowledge that the contents of this document are true.{{else}}I solemnly affirm under the penalties of perjury that the contents of this document are true to the best of my knowledge, information, and belief.{{/if}}

{{affiant}}
Signature: ______________________________   Date: ______________

Sworn or affirmed and subscribed before me on ______________, 20____, by {{affiant}}, who is personally known to me or satisfactorily proved to be the person who signed, and who took the oath or affirmation above.

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
    reviewNote: "Sign in front of a notary (the notary may attach their own certificate in place of the one printed here). A notarized letter is practice, not a US legal requirement: the State Department says the United States does not require proof of both parents' permission for a child to travel abroad, and CBP's help page says a child needs the same entry documents an adult would. But many destination countries, airlines (unaccompanied-minor services have their own forms), some hotels and some border officers do ask for one, and some countries want an apostille (in Maryland, issued by the Secretary of State), a translation or the other parent's own signature. Check the destination's embassy or consulate and the airline before the trip. Carry the original with the child's passport and birth certificate and a copy of each signer's photo ID. Officers commonly ask a parent travelling alone with a child for a note from the other parent, and ask for both parents' consent if the child travels with neither; if you choose 'sole custody' or 'deceased', carry the custody order or death certificate. This form is not suitable if there is a custody dispute or a court order restricting travel — see an attorney first (international child-abduction rules, including the Hague Convention, may apply). Medical care: I found no Maryland statute that lets a parent hand general medical-consent power to another adult (Health-General §20-105 covers only a relative in informal kinship care who files a state affidavit), so a hospital may still refuse — UNVERIFIED; confirm with an attorney. Not checked by the app: each child's passport number and expiry date, if the trip is international. Free-text additional terms are deliberately not offered on a consent form.",
    steps: [
      { title: "Parent or guardian", questions: [text("parent", "Parent or legal guardian who is signing", { required: true }), text("parentAddress", "Address", { required: true }), text("parentPhone", "Phone", { required: true }), text("parentEmail", "Email"),
        yesno("secondParent", "A second parent or guardian also signs this consent"), text("parent2", "Second parent or guardian", { showIf: { id: "secondParent", equals: true }, required: true }), text("parent2Phone", "Second parent or guardian's phone", { showIf: { id: "secondParent", equals: true }, required: true }),
        pick("noSecondReason", "About the child's other parent", [["travelling", "The other parent is the one travelling with the child"], ["sole", "I have sole legal custody"], ["deceased", "The other parent is deceased"], ["none", "The child has no other legal parent"], ["informed", "The other parent knows about the trip but is not signing"]], { showIf: { id: "secondParent", equals: false }, required: true, help: "Border officers and some countries want the other parent's signed consent; 'knows about the trip' may not be enough." }),
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
If the child needs emergency medical treatment, {{#if secondParent}}we authorize{{else}}I authorize{{/if}} {{#if travellingWith=adult}}{{adult}}{{/if}}{{#if travellingWith=parent}}{{travellingParent}}{{/if}}{{#if travellingWith=alone}}the adult in charge of the child{{/if}} to consent to it on {{#if secondParent}}our{{else}}my{{/if}} behalf. {{#if secondParent}}We ask{{else}}I ask{{/if}} any doctor or hospital to accept this authorization.{{#if allergies}} Allergies or medicines: {{allergies}}.{{/if}}{{#if insurance}} Health insurance: {{insurance}}.{{/if}}

{{/if}}CONTACT AND VALIDITY
{{parent}} can be reached at {{parentPhone}}{{#if parentEmail}} or {{parentEmail}}{{/if}}{{#if secondParent}}; {{parent2}} can be reached at {{parent2Phone}}{{/if}}. The child and the person travelling with or meeting the child may show this document to airlines, border and immigration officers, hotels and medical staff. This consent is valid only from {{departure}} to {{returning}} (and for any later return that a delay beyond the traveller's control, such as a cancelled flight, makes necessary), and any person who signed it may cancel it by written notice.

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
    reviewNote: "Have a real-estate attorney or title company review this before signing. Before the buyer signs, the seller must give the buyer the Maryland Residential Property Disclosure or Disclaimer Statement (Real Property §10-702; if it comes late the buyer can rescind within 5 days after receiving it, and that right cannot be waived). The statement does not apply to some sales, such as a never-occupied new home, a lender's foreclosure sale, court or fiduciary sales, or unimproved land. Homes built before 1978 need the signed federal lead-paint disclosure and EPA pamphlet attached. Real Property §14-117 requires conspicuous notices in the contract; this form includes the transfer/recordation-tax statement, the Critical Area notice, the military-installation noise notice (not required in seven counties) and the homestead tax credit statement. The homestead statute also asks for the website address of the State's homestead document: the form points to dat.maryland.gov — add the exact page address from the Department of Assessments and Taxation (UNVERIFIED). A condominium resale (§11-135, 7-day cancellation) and a homeowners-association resale (§11B-106, 5-day cancellation) each need their own statutory notice in the contract in conspicuous type, or the seller may not be able to enforce the contract — attach the current statutory notice or addendum. New-home sales, deferred water and sewer charges, and some counties have more required notices in §14-117, and a flood-risk disclosure form becomes required for sales from July 1, 2027 (2026 law, Real Property §10-716 — UNVERIFIED section number); check the current MREC / local board addenda. Maryland has no statutory cap on a forfeited deposit: a deposit kept as agreed damages is enforced only if it is a reasonable estimate of the seller's loss. Tax withholding on a non-resident seller is collected when the deed is recorded (Tax-General §10-912). Confirm with an attorney: seller-financing rules, whether the 'exempt' choice really applies, ground rent, and whether this buyer's lender or county adds its own notices. Not yet checked by the app: the loan amount against the price, and that the closing date is after the loan-approval period.",
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
        pick("hoaType", "What kind of association?", [["condo", "Condominium (council of unit owners)"], ["hoa", "Homeowners association / community"], ["other", "Cooperative or other"]], { showIf: { id: "hoa", equals: true }, default: "hoa", help: "Maryland gives the buyer a statutory right to cancel after receiving the association papers: 7 days for a condominium, 5 days for a homeowners association. Attach the current statutory notice." }),
        pick("possession", "Buyer takes possession", [["closing", "At closing"], ["date", "On a set date"]], { required: true, default: "closing" }), date("possessionDate", "Possession date", { showIf: { id: "possession", equals: "date" }, required: true }), text("titleCompany", "Title company or settlement agent"),
        pick("disclosureType", "Seller's Maryland disclosure", [["disclosure", "Residential Property Disclosure Statement"], ["disclaimer", "Residential Property Disclaimer Statement"], ["exempt", "Not required — an exempt sale (for example new, estate or foreclosure)"]], { required: true, default: "disclosure" }),
        text("exemptReason", "Why no disclosure statement is required", { showIf: { id: "disclosureType", equals: "exempt" }, required: true, placeholder: "e.g. it is a sale by the personal representative of an estate", help: "Maryland exempts only certain sales (for example a never-occupied new home, a lender's sale after foreclosure, sheriff, tax or court sales, transfers by a personal representative or other fiduciary, transfers exempt from transfer tax, a property to be demolished or converted to non-residential use, and unimproved land). Ask the title company or an attorney before choosing this." }),
        pick("closingCosts", "Closing costs are paid", [["split", "Split equally"], ["buyer", "By the buyer"], ["seller", "By the seller"]], { default: "split", required: true }),
        pick("preYear78", "Was the home built before 1978?", [["yes", "Yes — built before 1978"], ["no", "No — built in 1978 or later"]], { required: true, help: "If you do not know, check the tax records or ask the seller. Pre-1978 homes need the federal lead-paint papers." }),
        yesno("asIs", "The buyer accepts the property as-is after inspection", { default: false }),
        pick("buyerDefault", "If the buyer defaults, the seller", [["deposit", "Keeps the deposit as the seller's only remedy (agreed damages)"], ["damages", "Keeps the deposit toward its losses and may also claim actual damages"]], { default: "deposit", help: "Maryland courts enforce a kept deposit only if it is a reasonable estimate of the seller's loss, so keep the deposit modest." }),
        area("extraClauses", "Any additional terms (optional)")] },
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
Seller will give Buyer the disclosures the law requires for this sale. {{#if disclosureType=disclosure}}Buyer acknowledges receiving the Maryland Residential Property Disclosure Statement, completed to the best of Seller's knowledge, before signing this Agreement (Buyer's initials: ________  date: ______________).{{/if}}{{#if disclosureType=disclaimer}}Buyer acknowledges receiving the Maryland Residential Property Disclaimer Statement before signing this Agreement (Buyer's initials: ________  date: ______________). In it Seller discloses any latent defects Seller actually knows about that a careful visual inspection would not reveal and that threaten the health or safety of the people living there, makes no other statement about the Property's condition, and Buyer takes the Property as-is, with all defects including latent defects, except as this Agreement provides.{{/if}}{{#if disclosureType=exempt}}The parties state that no Maryland disclosure or disclaimer statement is required for this sale because {{exemptReason}}.{{/if}}{{#if !disclosureType=exempt}} If Buyer did not receive the statement before signing this Agreement, Buyer may rescind as Maryland law provides, and that right cannot be waived in this Agreement.{{/if}}{{#if preYear78=yes}} Because the home was built before 1978, Seller has given or will give Buyer, before Buyer is bound by this Agreement, the EPA pamphlet "Protect Your Family From Lead in Your Home" and a signed Lead-Based Paint Disclosure (the federal Lead Warning Statement, Seller's disclosure of any known lead-based paint or hazards, and a list of any lead records), which is attached and part of this Agreement. Buyer has 10 days after signing, unless the parties agree otherwise in writing or Buyer waives it, to test the Property for lead-based paint and lead-based paint hazards, and may cancel by written notice and receive the deposit back if the test shows hazards Buyer is not willing to accept.{{/if}}

10. MARYLAND NOTICES
(a) SECTION 14-104 OF THE REAL PROPERTY ARTICLE OF THE ANNOTATED CODE OF MARYLAND PROVIDES THAT, UNLESS OTHERWISE NEGOTIATED IN THE CONTRACT OR PROVIDED BY STATE OR LOCAL LAW, THE COST OF ANY RECORDATION TAX OR ANY STATE OR LOCAL TRANSFER TAX SHALL BE SHARED EQUALLY BETWEEN THE BUYER AND SELLER. IN THIS AGREEMENT THE PARTIES HAVE AGREED THAT THESE TAXES ARE PAID AS STATED IN THE CLOSING, POSSESSION AND COSTS SECTION.
(b) NOTICE TO BUYER CONCERNING THE CHESAPEAKE AND ATLANTIC COASTAL BAYS CRITICAL AREA: BUYER IS ADVISED THAT ALL OR A PORTION OF THE PROPERTY MAY BE LOCATED IN THE "CRITICAL AREA" OF THE CHESAPEAKE AND ATLANTIC COASTAL BAYS, AND THAT ADDITIONAL ZONING, LAND USE, AND RESOURCE PROTECTION REGULATIONS APPLY IN THIS AREA. THE "CRITICAL AREA" GENERALLY CONSISTS OF ALL LAND AND WATER AREAS WITHIN 1,000 FEET BEYOND THE LANDWARD BOUNDARIES OF STATE OR PRIVATE WETLANDS, THE CHESAPEAKE BAY, THE ATLANTIC COASTAL BAYS, AND ALL OF THEIR TIDAL TRIBUTARIES. THE "CRITICAL AREA" ALSO INCLUDES THE WATERS OF AND LANDS UNDER THE CHESAPEAKE BAY, THE ATLANTIC COASTAL BAYS, AND ALL OF THEIR TIDAL TRIBUTARIES TO THE HEAD OF TIDE. FOR INFORMATION AS TO WHETHER THE PROPERTY IS LOCATED WITHIN THE CRITICAL AREA, BUYER MAY CONTACT THE LOCAL DEPARTMENT OF PLANNING AND ZONING, WHICH MAINTAINS MAPS SHOWING THE EXTENT OF THE CRITICAL AREA IN THE JURISDICTION. ALLEGANY, CARROLL, FREDERICK, GARRETT, HOWARD, MONTGOMERY, AND WASHINGTON COUNTIES DO NOT INCLUDE LAND LOCATED IN THE CRITICAL AREA.
(c) BUYER IS ADVISED THAT THE PROPERTY MAY BE LOCATED NEAR A MILITARY INSTALLATION THAT CONDUCTS FLIGHT OPERATIONS, MUNITIONS TESTING, OR MILITARY OPERATIONS THAT MAY RESULT IN HIGH NOISE LEVELS. (This notice is not required in Allegany, Carroll, Frederick, Garrett, Howard, Montgomery or Washington County.)
(d) IF YOU PLAN TO LIVE IN THIS HOME AS YOUR PRINCIPAL RESIDENCE, YOU MAY QUALIFY FOR THE HOMESTEAD PROPERTY TAX CREDIT. THE HOMESTEAD PROPERTY TAX CREDIT MAY SIGNIFICANTLY REDUCE THE AMOUNT OF PROPERTY TAXES YOU OWE. The State Department of Assessments and Taxation publishes a document about the credit and how to apply on its website (dat.maryland.gov), and the settlement agent gives it to Buyer at closing.
(e) Buyer should ask the county planning and zoning office about current and planned land uses, public facilities and school plans that may affect the Property.
Buyer's initials: ________

11. RISK OF LOSS
Seller bears the risk of loss or damage to the Property until closing. If the Property is substantially damaged before closing, Buyer may cancel and the deposit is returned. Until closing Seller will keep the Property in its present condition and will not lease it, sell it again or place any new lien on it without Buyer's written consent.

12. DEFAULT
If either party fails to do what this Agreement requires, the other party will give written notice, and the party in default has 5 days after the notice to fix it before the other party may use a remedy. If Buyer defaults and does not fix it, {{#if buyerDefault=damages}}Seller may keep the deposit toward Seller's losses and may also claim any further actual damages the law allows.{{else}}Seller may keep the deposit as agreed damages and as Seller's only remedy; the parties agree that the deposit is a reasonable estimate of Seller's loss, which would be hard to calculate, and not a penalty.{{/if}} If Seller defaults and does not fix it, Buyer may recover the deposit and pursue the remedies the law allows, including asking a court to require the sale.

{{#if brokerUsed}}0. BROKERS AND COMMISSION
{{#if brokerName}}{{brokerName}} acted as agent in this sale. {{/if}}The real-estate commission is paid by {{#if commissionPaidBy=seller}}Seller{{/if}}{{#if commissionPaidBy=buyer}}Buyer{{/if}}{{#if commissionPaidBy=split}}Buyer and Seller equally{{/if}} at closing. Each party will protect the other from any other broker's claim based on that party's own dealings.{{else}}0. BROKERS AND COMMISSION
Each party states that it has not used a real-estate broker or agent in this transaction, and each will protect the other from any commission claim based on that party's own dealings. This promise continues after closing.{{/if}}

{{#if hoa}}0. ASSOCIATION
The Property is in {{#if hoaType=condo}}a condominium{{else}}{{#if hoaType=other}}a cooperative or other association{{else}}a homeowners association or similar community{{/if}}{{/if}}. {{#if hoaType=condo}}Seller will give Buyer the condominium declaration, bylaws, rules and regulations, the council of unit owners' certificate and the other documents and notices that Maryland law requires for a condominium resale (Real Property Article section 11-135), within the time the law requires. Buyer may cancel this Agreement in writing, without giving a reason, within 7 days after receiving all of them and receive the deposit back; Buyer's right ends if Buyer goes to closing, and it cannot be waived in this Agreement. The statutory notice about these rights is attached to this Agreement in conspicuous type, as the law requires; a condominium resale contract may not be enforceable without it.{{else}}{{#if hoaType=other}}Seller will give Buyer the association's governing documents, current fees and any resale information the law requires, and Buyer may cancel within the period the law allows after receiving them.{{else}}Seller will give Buyer in writing, on or before signing this Agreement or within 20 calendar days after, the association disclosures that Maryland law requires (Real Property Article section 11B-106): the monthly fee and the fees charged in the prior year and whether any are unpaid, the name of the association's manager, any known judgments or lawsuits against the association and any claims or violation notices against the lot, and the association's governing documents. If Buyer receives them less than 5 calendar days before signing, Buyer may cancel in writing, without giving a reason, within 5 calendar days after receiving them and receive the deposit back (Seller may keep the cost of copying the documents, up to $100, unless Buyer returns them). The statutory notice about these rights is attached in conspicuous type, as the law requires.{{/if}}{{/if}} Association fees and assessments are adjusted as of the closing date.

{{/if}}0. TAX WITHHOLDING AND REPORTING
At or before closing Seller will sign the certifications the settlement agent needs: that Seller is a Maryland resident or that the Property is Seller's principal residence (or a Comptroller certificate showing that no Maryland tax is due), and that Seller is not a foreign person for federal tax purposes. If Seller is not a Maryland resident and no exemption applies, Maryland collects withholding tax on the sale when the deed is presented for recording (Tax-General section 10-912), and it is paid out of Seller's proceeds. If Seller is a foreign person, federal law (Internal Revenue Code section 1445) requires Buyer to withhold part of the price unless an exception applies. Buyer and Seller will also give the settlement agent the information needed to file the report the Internal Revenue Code requires for real-estate sales (Form 1099-S). These promises continue after closing.

{{#if extraClauses}}13. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}13. GENERAL
This is the parties' entire agreement, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}. Notices must be in writing and sent to the addresses above. Time is of the essence. Buyer may not assign this Agreement without Seller's written consent. If any part of this Agreement is not enforceable, the rest remains in effect. This Agreement binds the parties and their heirs, representatives and permitted assigns, and may be signed in counterparts, including electronically, which together form one agreement.

SELLER: {{seller}}
Signature: ______________________________   Date: ______________

BUYER: {{buyer}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "property_sale_commercial", title: "Commercial Property Sale Agreement", category: REAL_ESTATE,
    description: "A seller and buyer agree on the sale of a commercial building or land: price, due-diligence period, tenants, zoning, environmental, closing deliveries and closing.",
    reviewNote: "Commercial sales carry large tax, zoning, environmental and lease consequences — have a real-estate attorney review this, and a title company handle the closing. This agreement sells real property and the personal property you list; it does not sell a business or transfer licenses (tobacco, alcohol, lottery, sales-tax). A store sale usually needs a separate Sale of a Business Agreement and the buyer's own licenses; if the sale includes a business's inventory, Maryland's bulk-transfer rules (Commercial Law Title 6, Subtitle 1; Tax-General §11-505) may apply — confirm with an attorney. If part of the property is a home or apartment, Maryland's residential disclosure statement and contract notices may also apply (Real Property §10-702 covers four or fewer dwelling units; §14-117 notices): check the current statute and MREC addenda. The Critical Area notice (§14-117) is in the contract for every sale; agricultural land, new homes and some counties have more required notices. Withholding on a non-resident seller is collected when the deed is recorded (Tax-General §10-912; federal FIRPTA withholding also applies to foreign sellers) — check the current rules. Maryland has no statutory cap on a forfeited deposit: a deposit kept as agreed damages is enforced only if it is a reasonable estimate of the seller's loss, so keep the deposit modest. Confirm with an attorney: whether the environmental assessment you order meets the standard needed for any federal liability protection, and the seller-statement survival period you chose. The buyer's and seller's company officers must sign with their titles; collect authority documents for the title company.",
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
        text("titleCompany", "Title company or settlement agent"), pick("closingCosts", "Closing costs are paid", [["split", "Split equally"], ["buyer", "By the buyer"], ["seller", "By the seller"]], { default: "split", required: true }),
        pick("buyerDefault", "If the buyer defaults, the seller", [["deposit", "Keeps the deposit as the seller's only remedy (agreed damages)"], ["damages", "Keeps the deposit toward its losses and may also claim actual damages"]], { default: "deposit", help: "Maryland courts enforce a kept deposit only if it is a reasonable estimate of the seller's loss, so keep the deposit modest." }),
        area("extraClauses", "Any additional terms (optional)")] },
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
Because part of the Property is a home or apartment, Seller will give Buyer, to the extent the law requires, the Maryland Residential Property Disclosure or Disclaimer Statement (which covers residential property with four or fewer dwelling units, Real Property Article section 10-702) and the other notices Maryland law requires in residential sales, and, if any dwelling was built before 1978, the federal lead-based paint disclosure and the opportunity to test for lead-based paint. The residential notices of Real Property Article section 14-117 are in the section on Maryland notices below.

{{/if}}7. TITLE AND SURVEY
At closing Seller delivers {{#if deedType=general}}a general warranty deed{{else}}a special warranty deed{{/if}} conveying good and merchantable title (title that a title insurer will insure at regular rates), free of liens and claims other than those Buyer agrees to accept. {{#if titleCompany}}{{titleCompany}} will act as settlement agent and provide the title search. {{/if}}If a title problem cannot be fixed before closing, Buyer may cancel and the deposit is returned.

8. SELLER'S STATEMENTS
Seller states that, to Seller's knowledge, there are no pending lawsuits, condemnation proceedings or unpaid assessments affecting the Property, no violation notices have been received in writing that have not been fixed, and Seller has disclosed all known environmental problems. "To Seller's knowledge" means the actual knowledge of Seller (for a company, of its owner or manager). These statements are true when this Agreement is signed and at closing. {{#if survivalMonths}}They remain in force for {{survivalMonths}} months after closing.{{else}}They do not remain in force after closing.{{/if}} Until closing Seller will operate the Property as it has been operated, and will not sign or change any lease, place any new lien on the Property or make any new contract binding the Property without Buyer's written consent.

9. CLOSING, DELIVERIES AND COSTS
Closing takes place {{#if closingMode=date}}on {{closingDate}}{{else}}within {{closingDays}} days after due diligence and the other conditions in this Agreement that protect Buyer have been met or waived{{/if}}, and Buyer takes possession then, free of occupants other than the tenants listed. At closing Seller delivers the deed, a bill of sale for any personal property, {{#if tenants}}an assignment of the leases, {{/if}}proof of Seller's authority to sell, and the certifications needed for tax withholding; Buyer delivers the balance of the price and proof of Buyer's authority to buy. Transfer and recordation taxes are paid {{#if transferTaxes=split}}equally by Buyer and Seller{{/if}}{{#if transferTaxes=buyer}}by Buyer{{/if}}{{#if transferTaxes=seller}}by Seller{{/if}}. All other closing costs, including recording fees, title search and insurance, survey and loan charges, are paid {{#if closingCosts=split}}equally by Buyer and Seller{{/if}}{{#if closingCosts=buyer}}by Buyer{{/if}}{{#if closingCosts=seller}}by Seller{{/if}}. Property taxes, utilities, rents and operating expenses are adjusted as of the closing date.{{#if exchange1031}} Each party will reasonably cooperate if the other wishes to complete the sale as part of a tax-deferred exchange, at no added cost or delay to the cooperating party.{{/if}}

10. RISK OF LOSS
Seller bears the risk of loss or damage to the Property until closing. If the Property is substantially damaged or taken before closing, Buyer may cancel and the deposit is returned.

11. DEFAULT
If either party fails to do what this Agreement requires, the other party will give written notice, and the party in default has 5 days after the notice to fix it before the other party may use a remedy. If Buyer defaults and does not fix it, {{#if buyerDefault=damages}}Seller may keep the deposit toward Seller's losses and may also claim any further actual damages the law allows.{{else}}Seller may keep the deposit as agreed damages and as Seller's only remedy; the parties agree that the deposit is a reasonable estimate of Seller's loss, which would be hard to calculate, and not a penalty.{{/if}} If Seller defaults and does not fix it, Buyer may recover the deposit and pursue the remedies the law allows, including asking a court to require the sale.

0. MARYLAND NOTICES
(a) NOTICE TO BUYER CONCERNING THE CHESAPEAKE AND ATLANTIC COASTAL BAYS CRITICAL AREA: BUYER IS ADVISED THAT ALL OR A PORTION OF THE PROPERTY MAY BE LOCATED IN THE "CRITICAL AREA" OF THE CHESAPEAKE AND ATLANTIC COASTAL BAYS, AND THAT ADDITIONAL ZONING, LAND USE, AND RESOURCE PROTECTION REGULATIONS APPLY IN THIS AREA. THE "CRITICAL AREA" GENERALLY CONSISTS OF ALL LAND AND WATER AREAS WITHIN 1,000 FEET BEYOND THE LANDWARD BOUNDARIES OF STATE OR PRIVATE WETLANDS, THE CHESAPEAKE BAY, THE ATLANTIC COASTAL BAYS, AND ALL OF THEIR TIDAL TRIBUTARIES. THE "CRITICAL AREA" ALSO INCLUDES THE WATERS OF AND LANDS UNDER THE CHESAPEAKE BAY, THE ATLANTIC COASTAL BAYS, AND ALL OF THEIR TIDAL TRIBUTARIES TO THE HEAD OF TIDE. FOR INFORMATION AS TO WHETHER THE PROPERTY IS LOCATED WITHIN THE CRITICAL AREA, BUYER MAY CONTACT THE LOCAL DEPARTMENT OF PLANNING AND ZONING, WHICH MAINTAINS MAPS SHOWING THE EXTENT OF THE CRITICAL AREA IN THE JURISDICTION. ALLEGANY, CARROLL, FREDERICK, GARRETT, HOWARD, MONTGOMERY, AND WASHINGTON COUNTIES DO NOT INCLUDE LAND LOCATED IN THE CRITICAL AREA.
{{#if dwellings}}(b) SECTION 14-104 OF THE REAL PROPERTY ARTICLE OF THE ANNOTATED CODE OF MARYLAND PROVIDES THAT, UNLESS OTHERWISE NEGOTIATED IN THE CONTRACT OR PROVIDED BY STATE OR LOCAL LAW, THE COST OF ANY RECORDATION TAX OR ANY STATE OR LOCAL TRANSFER TAX SHALL BE SHARED EQUALLY BETWEEN THE BUYER AND SELLER.
(c) BUYER IS ADVISED THAT THE PROPERTY MAY BE LOCATED NEAR A MILITARY INSTALLATION THAT CONDUCTS FLIGHT OPERATIONS, MUNITIONS TESTING, OR MILITARY OPERATIONS THAT MAY RESULT IN HIGH NOISE LEVELS. (This notice is not required in Allegany, Carroll, Frederick, Garrett, Howard, Montgomery or Washington County.)
(d) IF YOU PLAN TO LIVE IN THIS HOME AS YOUR PRINCIPAL RESIDENCE, YOU MAY QUALIFY FOR THE HOMESTEAD PROPERTY TAX CREDIT. THE HOMESTEAD PROPERTY TAX CREDIT MAY SIGNIFICANTLY REDUCE THE AMOUNT OF PROPERTY TAXES YOU OWE. The State Department of Assessments and Taxation publishes a document about the credit and how to apply on its website (dat.maryland.gov), and the settlement agent gives it to Buyer at closing.
{{/if}}Buyer should ask the county planning and zoning office about current and planned land uses, zoning, public facilities and other plans that may affect the Property.
Buyer's initials: ________

{{#if brokerUsed}}0. BROKERS AND COMMISSION
{{#if brokerName}}{{brokerName}} acted as agent in this sale. {{/if}}The real-estate commission is paid by {{#if commissionPaidBy=seller}}Seller{{/if}}{{#if commissionPaidBy=buyer}}Buyer{{/if}}{{#if commissionPaidBy=split}}Buyer and Seller equally{{/if}} at closing. Each party will protect the other from any other broker's claim based on that party's own dealings.{{else}}0. BROKERS AND COMMISSION
Each party states that it has not used a real-estate broker or agent in this transaction, and each will protect the other from any commission claim based on that party's own dealings. This promise continues after closing.{{/if}}

{{#if hoa}}0. ASSOCIATION
The Property is in an association. Seller will give Buyer the association's governing documents, current fees and any resale information the law requires, and, if the law gives Buyer a right to cancel after receiving them, Buyer may use it within the period the law allows. Association fees and assessments are adjusted as of the closing date.

{{/if}}0. TAX WITHHOLDING AND REPORTING
At or before closing Seller will sign the certifications the settlement agent needs: that Seller is a Maryland resident individual or a Maryland resident entity (formed under Maryland law or registered with the State Department of Assessments and Taxation), or a Comptroller certificate showing that no Maryland tax is due, and that Seller is not a foreign person for federal tax purposes. If Seller is a nonresident individual or entity and no exemption applies, Maryland collects withholding tax on the sale when the deed is presented for recording (Tax-General section 10-912), and it is paid out of Seller's proceeds. If Seller is a foreign person, federal law (Internal Revenue Code section 1445) requires Buyer to withhold part of the price unless an exception applies. Buyer and Seller will also give the settlement agent the information needed to file the report the Internal Revenue Code requires for real-estate sales (Form 1099-S). These promises continue after closing.

{{#if extraClauses}}12. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}12. GENERAL
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
    description: "A landlord rents a home or apartment to one or more tenants: term, rent, deposit, rules, repairs, lead-paint notices and move-out — with a signed security-deposit receipt and, for older homes, a lead-paint disclosure page attached.",
    reviewNote: "Check current Maryland and local rules before using it. Built in: a security deposit of no more than one month's rent (Real Property Article 8-203), a deposit receipt that lists the tenant's rights (8-203.1), a late fee of no more than 5% of the unpaid rent (8-208), a statement that the home is habitable and safe, the current Maryland Tenants' Bill of Rights attached (8-208), at least 24 hours' written notice before the landlord enters and entry only Monday to Saturday between 7 a.m. and 7 p.m. (8-221, in force since October 1, 2025), 60 days' landlord notice and 30 days' tenant notice to end a tenancy (8-402), no lock-outs or utility cut-offs (8-216), and no extra deposit or fee for an assistance animal. The app attaches the Tenants' Bill of Rights to the PDF only if the firm has uploaded the current edition in the standard-attachments settings (the state reissues it each October 1; the edition dated October 1, 2026 is the current one) — it is NOT added to Word downloads, so attach a printed copy by hand in that case. Most rental homes need a city or county rental license. Homes built before 1978 need Maryland lead registration with MDE, a lead inspection certificate for each new occupancy, the EPA pamphlet and the Maryland Notice of Tenant's Rights on or before move-in, plus the federal lead disclosure attached here — keep the signed disclosure at least 3 years. Confirm with an attorney: whether a returned-payment fee (keep it at or below $35), a monthly pet charge, the mutual attorney's-fee clause or the mediation clause is appropriate; your local license and lead rules (for example Baltimore City or Montgomery County); and whether any lead exemption applies. Binding arbitration, confession of judgment and a jury-trial waiver are deliberately not included — Maryland does not allow some of them in a residential lease. Not checked by the app: that the deposit is no more than one month's rent, that any late fee is no more than 5% of the rent, and that the entry notice is at least 24 hours. Have an attorney review it.",
    steps: [
      { title: "Landlord and tenants", questions: [text("landlord", "Landlord (owner or manager)", { required: true }), text("landlordAddress", "Landlord's address for notices", { required: true }), text("landlordPhone", "Landlord's phone", { required: true }), text("landlordEmail", "Landlord's email (optional)"),
        text("landlordAgent", "Agent who may receive notices and legal papers for the Landlord (name and address, optional)", { help: "Maryland leases must give contact information for the landlord or an agent authorized to receive notices and legal papers. Leave empty if the landlord receives them at the address above." }),
        list("tenants", "Tenants who sign the lease", [text("name", "Full name", { required: true })], { required: true, addLabel: "Add a tenant" }), text("tenantPhone", "Tenant's phone (optional)"), text("tenantEmail", "Tenant's email (optional)"), text("occupants", "Other people who will live there (names, optional)"), effective(), state()] },
      { title: "The home", questions: [text("propertyAddress", "Address (include unit number)", { required: true }), text("county", "County or city", { required: true }),
        pick("homeType", "Type of home", [["house", "House"], ["apartment", "Apartment"], ["condo", "Condominium"], ["room", "Room in a shared home"]], { required: true, default: "apartment" }),
        text("licenseNumber", "Rental license / registration number", { required: true, placeholder: "Write N/A only if none is required where the home is" }),
        pick("preYear78", "Was the home built before 1978?", [["yes", "Yes — built before 1978"], ["no", "No — built in 1978 or later"]], { required: true, help: "If you do not know, check the tax records. Pre-1978 homes need Maryland lead registration, a lead certificate and the lead papers on or before move-in." }),
        pick("leadKnown", "Landlord's knowledge of lead-based paint or lead hazards", [["none", "Landlord has no knowledge of any"], ["known", "Landlord knows of lead-based paint or lead hazards"]], { showIf: { id: "preYear78", equals: "yes" }, required: true }),
        area("leadKnownDetails", "What is known (location and condition)", { showIf: { id: "leadKnown", equals: "known" }, required: true }),
        pick("leadRecords", "Lead records and reports about the home", [["none", "Landlord has none"], ["provided", "Landlord has some and is giving copies to the tenant"]], { showIf: { id: "preYear78", equals: "yes" }, required: true }),
        text("leadRecordsList", "List the records or reports given", { showIf: { id: "leadRecords", equals: "provided" }, required: true }),
        text("leadAgent", "Property manager or agent who handles this rental (optional)", { showIf: { id: "preYear78", equals: "yes" }, help: "If an agent is involved, the federal lead form needs the agent's acknowledgment and signature. Leave empty if the landlord handles the rental personally." }),
        area("included", "Appliances and furnishings included", { placeholder: "e.g. Refrigerator, stove, dishwasher, washer and dryer" }), text("parking", "Parking", { placeholder: "e.g. One assigned space" })] },
      { title: "Term and rent", questions: [
        pick("termType", "Lease type", [["fixed", "Fixed term (set start and end)"], ["monthly", "Month to month"]], { required: true, default: "fixed" }),
        date("startDate", "Starts", { required: true }), date("endDate", "Ends", { showIf: { id: "termType", equals: "fixed" }, required: true }), date("possessionDate", "Tenant may move in earlier, on (optional)", { help: "Use this if the tenant gets the keys before the lease start date." }),
        money("rent", "Monthly rent", { required: true }), num("rentDay", "Rent is due on day", { default: "1", required: true }), num("graceDays", "Days before rent is late", { default: "5", required: true }),
        yesno("lateFee", "Charge a late fee"), money("lateFeeAmount", "Late fee", { showIf: { id: "lateFee", equals: true }, required: true, help: "Maryland caps a residential late fee at 5% of the unpaid rent. If the tenant pays part of the rent, the fee can be only 5% of the part still unpaid; the lease says so. Enter no more than 5% of the monthly rent." }),
        money("nsfFee", "Fee for a payment returned unpaid by the bank (optional)", { help: "Leave empty for none. Keep it at or below $35 (the figure Maryland's bad-check law uses) and confirm with an attorney before charging one." }),
        text("payHow", "How rent is paid", { default: "Check, money order or bank transfer to the landlord's address or account" }),
        money("deposit", "Security deposit", { required: true, help: "Maryland caps the deposit at one month's rent. Enter no more than the monthly rent." })] },
      { title: "Rules", questions: [
        pick("utilities", "Utilities", [["tenant", "Tenant pays all utilities"], ["landlord", "Landlord pays all utilities"], ["split", "As listed below"]], { required: true, default: "tenant" }), text("utilitiesNote", "Which utilities, and who pays", { showIf: { id: "utilities", equals: "split" }, required: true, placeholder: "Name heat, gas, electricity, and water and sewer separately", help: "If the tenant pays the landlord a share of a building bill, say how the share is worked out." }),
        yesno("pets", "Pets are allowed"), text("petTerms", "Which pets, and any rules", { showIf: { id: "pets", equals: true }, required: true, help: "Do not add a pet deposit or fee here: Maryland limits what a landlord may require to start a lease to the security deposit and the first month's rent, and any pet deposit counts toward the one-month deposit cap." }),
        yesno("noSmoking", "No smoking or vaping anywhere in the home", { default: true }), yesno("guestsLimit", "No guest may stay longer than 7 days without the landlord's written consent", { default: true }),
        pick("yardCare", "Yard and snow", [["none", "Not applicable"], ["tenant", "Tenant keeps the yard tidy and clears snow and ice from the tenant's area"], ["landlord", "Landlord keeps the yard and clears snow and ice"]], { required: true, default: "none" }),
        yesno("rentersInsurance", "Tenant must carry renter's liability insurance", { default: false }), yesno("absenceInspection", "Tenant arranges a check if the home will be empty for 4 days or more", { default: false }),
        yesno("moveInReport", "Landlord and tenant sign a written condition report at move-in and move-out", { default: true }),
        num("entryHours", "Hours' written notice before the landlord enters (24 or more)", { default: "24", required: true, help: "Maryland requires at least 24 hours' written notice (Real Property Article 8-221) and allows entry only Monday to Saturday, 7 a.m. to 7 p.m., except in an emergency. Enter 24 or more." }),
        yesno("subletAllowed", "Tenant may sublet or take roommates with the landlord's written consent (switch off to forbid it completely)", { default: true }),
        yesno("mediation", "Disagreements go to mediation before court (court is still available where the law gives that right)", { default: false }), yesno("attorneyFees", "The winner of a court case about this lease recovers reasonable attorney's fees, to the extent the law allows", { default: false }),
        area("extraClauses", "Additional clauses (optional — one per line)", { placeholder: "e.g. Tenant opens the gas and electric accounts in Tenant's own name before move-in" }),
      ] },
    ],
    body: `RESIDENTIAL LEASE AGREEMENT

This Lease is made on {{effectiveDate}} between {{landlord}}, {{landlordAddress}}, phone {{landlordPhone}}{{#if landlordEmail}}, email {{landlordEmail}}{{/if}} ("Landlord"), and the following tenant(s), together "Tenant":
{{#list tenants}}• {{name}}
{{/list}}
1. THE HOME
Landlord rents to Tenant the {{#if homeType=house}}house{{/if}}{{#if homeType=apartment}}apartment{{/if}}{{#if homeType=condo}}condominium unit{{/if}}{{#if homeType=room}}room in a shared home{{/if}} at {{propertyAddress}}, {{county}} (the "Home"){{#if parking}}, with {{parking}}{{/if}}.{{#if included}} Included: {{included}}.{{/if}}{{#if occupants}} Other permitted occupants: {{occupants}}.{{/if}} Only the people named in this Lease may live in the Home.{{#if guestsLimit}} No guest may stay longer than 7 days without Landlord's written consent.{{/if}} Rental license / registration: {{licenseNumber}}. Each person who signs as Tenant is responsible, together with the others, for the whole rent and all of Tenant's other duties.

2. TERM
{{#if termType=fixed}}This Lease runs from {{startDate}} to {{endDate}}. If Landlord does not intend to renew it, Landlord will give Tenant at least 60 days' written notice before the end date. If Tenant stays after the end date with Landlord's consent, the tenancy continues month to month on the same terms, unless the parties sign a new lease or extension.{{else}}This tenancy begins on {{startDate}} and continues month to month. Landlord may end it by giving at least 60 days' written notice, and Tenant may end it by giving at least 30 days' written notice, in each case before the end of a rental month.{{/if}}{{#if possessionDate}} Tenant may take possession of the Home on {{possessionDate}}; the rent for the term begins on {{startDate}}.{{/if}}

3. RENT
Tenant pays {{rent}} per month, due on day {{rentDay}} of each month, by {{payHow}}. Landlord gives Tenant a receipt for any rent paid in cash, and for any other payment when Tenant asks for one. {{#if lateFee}}Rent not received within {{graceDays}} days after the due date is subject to a late fee of {{lateFeeAmount}} or, if less, 5% of the rent that is still unpaid. {{/if}}Landlord may not charge more than the law allows for late payment.{{#if nsfFee}} A fee of {{nsfFee}} applies to a payment that the bank returns unpaid.{{/if}} Landlord may raise the rent only after giving the notice the law requires, and the new rent starts only after that notice period ends; Tenant is not required to accept a rent-increase notice electronically. To start this Lease Tenant pays only the first month's rent and the security deposit; no other payment is required to move in.

4. SECURITY DEPOSIT
Tenant pays a security deposit of {{deposit}}, which is not more than one month's rent. Landlord keeps it in a federally insured Maryland account used only for security deposits and pays Tenant the simple interest Maryland law requires. A signed receipt for the deposit is attached to this Lease. Tenant's rights are:
(a) Within 15 days after moving in, Tenant may ask Landlord by certified mail to inspect the Home with Tenant present and list any existing damage.
(b) To be present at the move-out inspection, Tenant sends Landlord a certified-mail notice at least 15 days before moving, stating the move date and the new address. Landlord will inspect within 5 days before or after that date and tell Tenant the inspection date in writing.
(c) Within 45 days after the tenancy ends, Landlord will mail Tenant, by first-class mail, an itemized list of any deductions with their actual costs, and return the rest of the deposit.
(d) A landlord who does not follow the security-deposit law may owe Tenant up to three times the amount wrongly withheld, plus reasonable attorney's fees.
(e) If Tenant is evicted or leaves before the Lease ends, Tenant must mail Landlord a written request for the deposit within 45 days after leaving, and Landlord then responds as the security-deposit law requires.
The deposit may be used only for unpaid rent, damage beyond normal wear, and other breaches of this Lease. It is not a limit on what Tenant owes.

5. UTILITIES
{{#if utilities=tenant}}Tenant pays all utilities for the Home, including heat, gas, electricity, water and sewer.{{/if}}{{#if utilities=landlord}}Landlord pays all utilities for the Home, including heat, gas, electricity, water and sewer.{{/if}}{{#if utilities=split}}{{utilitiesNote}} If Tenant pays Landlord any part of a utility bill, Landlord will give Tenant copies of the bills, or the yearly cost statement Maryland law requires, and will explain how Tenant's share is worked out.{{/if}}

6. CONDITION AND LANDLORD'S DUTIES
Landlord is providing the Home in a habitable and safe condition, fit for human habitation. Who pays for heat, gas, electricity and water is stated in the Utilities section. Landlord keeps the heating, plumbing, wiring and structure of the Home in working order and makes repairs as the Repairs section says. A copy of the current Maryland Tenants' Bill of Rights is attached, and Tenant confirms receiving it.{{#if moveInReport}} At the start and at the end of the tenancy, Landlord and Tenant will complete, sign and date a written condition report of the Home.{{/if}}

7. USE AND RULES
Tenant uses the Home only as a private home, obeys the law and any building or association rules, and keeps the Home clean and free of nuisance. Tenant does not carry on any illegal activity at the Home and follows Landlord's reasonable written rules about the Home that are given to Tenant. {{#if noSmoking}}Smoking and vaping are not allowed anywhere in the Home, and Tenant will not allow guests to smoke or vape there. {{/if}}{{#if pets}}Pets are allowed on these terms: {{petTerms}}. {{else}}No pets are allowed without Landlord's written consent. {{/if}}A service animal or other assistance animal that Tenant needs because of a disability is not a pet: Landlord will consider any request for one as the fair housing laws require and will not charge an extra deposit or fee for it, although Tenant remains responsible for damage it causes. Tenant may not sublet, assign or take in roommates {{#if subletAllowed}}without Landlord's written consent{{else}}under any circumstances{{/if}}.

8. REPAIRS AND CONDITION
Landlord repairs problems Tenant reports in writing, except those caused by Tenant or Tenant's guests. Tenant tells Landlord promptly about leaks, pests, broken heat or other problems, and pays for damage caused by Tenant or guests. Both parties will take reasonable steps to prevent moisture and mold; Tenant tells Landlord in writing promptly about any moisture or visible mold, and Landlord responds promptly and follows the mold assessment and repair time limits in Maryland law. Landlord provides working smoke alarms and, where the law requires, carbon monoxide alarms; Tenant does not disable or remove them and tells Landlord promptly if one does not work. Without Landlord's written consent Tenant will not paint or wallpaper, put more than two small picture hooks in any one wall, add or remove walls, install a waterbed, add wiring or heating units, put up signs, or change the locks.{{#if yardCare=tenant}} Tenant keeps the yard assigned to the Home clean and tidy, including routine lawn care and trash removal, and clears snow and ice from that area and its walkways.{{/if}}{{#if yardCare=landlord}} Landlord keeps the yard tidy and clears snow and ice from the yard and its walkways.{{/if}}{{#if absenceInspection}} If the Home will be empty for 4 days or more, Tenant will arrange for someone to check it regularly and will give Landlord that person's name and phone number.{{/if}}

9. LANDLORD'S ENTRY
Landlord may enter the Home to make repairs or improvements, to inspect it, to show it to prospective buyers, lenders, tenants or contractors, or to protect the Home, after giving Tenant written notice at least {{entryHours}} hours in advance (Maryland law requires at least 24) that states the date, the approximate time and the purpose of the entry. Entry is allowed only Monday through Saturday between 7 a.m. and 7 p.m., unless Tenant agrees in writing to another time or to shorter notice. In an emergency Landlord may enter without notice to protect people or property. Tenant gives Landlord access to make repairs. During the last 30 days of the tenancy Landlord may show the Home to prospective tenants on the same notice and put up a "for rent" sign.

{{#if preYear78=yes}}10. LEAD-BASED PAINT
The Home was built before 1978. Landlord has registered it with the Maryland Department of the Environment (unless it is certified lead-free) and, on or before move-in, has given Tenant the Lead-Based Paint Disclosure attached to this Lease, the federal Lead Warning Statement, the EPA pamphlet on lead, the Maryland Notice of Tenant's Rights and a copy of the current lead inspection certificate (certificate no. ______________). Tenant confirms receiving them. Tenant will tell Landlord promptly in writing about any chipping, peeling or flaking paint. Landlord will meet the lead inspection and notice requirements that apply to the Home each time it is re-rented, and will give Tenant the lead notices again when the law requires during the tenancy.

{{/if}}11. INSURANCE AND LIABILITY
Landlord is not responsible for loss of Tenant's belongings unless caused by Landlord's negligence. {{#if rentersInsurance}}Tenant will carry renter's liability insurance for the Home and give Landlord proof of it on request.{{else}}Tenant is encouraged to carry renter's insurance.{{/if}}

12. DEFAULT AND ENDING EARLY
If Tenant does not pay rent when due or breaks another term, Landlord may give the written notice, and the time to pay or fix it, that Maryland law requires and then pursue the remedies the law allows, including ending the tenancy through the court. Landlord will recover possession only through the court process the law requires, and will not lock Tenant out, shut off utilities or services, or remove Tenant's belongings to make Tenant leave. If Tenant leaves early, Tenant remains responsible for rent until the Home is re-rented or the Lease ends, but Landlord will make reasonable efforts to re-rent it. Nothing in this Lease limits any right Tenant has by law to end the tenancy early, for example as a victim of abuse or as a service member with qualifying military orders.

13. MOVING OUT
At the end of the tenancy Tenant returns all keys, removes belongings, and leaves the Home clean and in the condition it was in at move-in, normal wear excepted.

{{#if mediation}}14. DISAGREEMENTS
If Landlord and Tenant disagree about this Lease, they will first try to settle it by talking and then by mediation with a neutral mediator they both accept, sharing the cost equally. This does not stop either party from going to court where the law gives that right, including to collect rent or recover possession.

{{/if}}{{#if attorneyFees}}15. ATTORNEY'S FEES
In a court case about this Lease, the party who wins recovers reasonable attorney's fees from the other party, to the extent the law allows. This applies equally to Landlord and Tenant.

{{/if}}{{#if extraClauses}}16. ADDITIONAL CLAUSES
{{extraClauses}}

{{/if}}17. NOTICES AND GENERAL
This is the parties' entire agreement, may be changed only in writing signed by Landlord and Tenant, and is governed by the laws of the State of {{state}}. Notices must be in writing and delivered to the addresses above or to the Home. Notices and legal papers for Landlord may be delivered to Landlord's address above{{#if landlordAgent}}, or to Landlord's agent, {{landlordAgent}}, who is authorized to receive them for Landlord{{/if}}.{{#if tenantPhone}} Tenant may also be reached at {{tenantPhone}}.{{/if}}{{#if tenantEmail}} Tenant's email is {{tenantEmail}}.{{/if}} Landlord will not retaliate against Tenant for using Tenant's legal rights. Nothing in this Lease waives any right or remedy Tenant has under Maryland law, and if a term conflicts with Maryland law, the law controls. This Lease may be signed in counterparts, including electronically. If any part is not enforceable, the rest remains in effect.

LANDLORD: {{landlord}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

{{#list tenants}}TENANT: {{name}}
Signature: ______________________________   Date: ______________

{{/list}}ACKNOWLEDGMENT OF RECEIPT
Tenant acknowledges receiving a copy of this Lease signed by both parties on ______________{{#if termType=fixed}}, and understands that after the end date the tenancy continues month to month unless it is ended by notice as this Lease says{{/if}}.
Tenant: ______________________________   Date: ______________

[page break]
RECEIPT FOR SECURITY DEPOSIT
(Maryland)

Property: {{propertyAddress}}, {{county}}
Landlord: {{landlord}}
Received from:
{{#list tenants}}• {{name}}
{{/list}}
Landlord acknowledges receiving a security deposit of {{deposit}} from Tenant for the Home. The deposit is not more than one month's rent. Landlord will hold it in a federally insured Maryland account used only for security deposits. Tenant's rights under the Maryland security-deposit law (Real Property Article, sections 8-203 and 8-203.1) include:
(a) the right to have Landlord inspect the Home with Tenant present and list any existing damage, if Tenant asks by certified mail within 15 days after moving in;
(b) the right to be present at the end-of-tenancy inspection, if Tenant gives Landlord notice by certified mail at least 15 days before moving, stating the date of moving and the new address;
(c) the right to have Landlord carry out that inspection within 5 days before or after the move date and to be told the inspection date in writing;
(d) the right to receive, by first-class mail within 45 days after the tenancy ends, an itemized list of any deductions with their actual costs, and the unused part of the deposit with the interest due; and
(e) the right to recover up to three times the amount wrongly withheld, plus reasonable attorney's fees, if Landlord does not follow the security-deposit law.

Received by Landlord or property manager: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________
{{#if preYear78=yes}}
[page break]
LEAD-BASED PAINT DISCLOSURE
(Housing built before 1978)

Property: {{propertyAddress}}, {{county}}
Landlord: {{landlord}}

LEAD WARNING STATEMENT
Housing built before 1978 may contain lead-based paint. Lead from paint, paint chips, and dust can pose health hazards if not managed properly. Lead exposure is especially harmful to young children and pregnant women. Before renting pre-1978 housing, lessors must disclose the presence of known lead-based paint and/or lead-based paint hazards in the dwelling. Lessees must also receive a federally approved pamphlet on lead poisoning prevention.

LANDLORD'S DISCLOSURE
(a) Presence of lead-based paint and/or lead-based paint hazards: {{#if leadKnown=known}}Landlord knows of lead-based paint and/or lead-based paint hazards in the Home. {{leadKnownDetails}}{{else}}Landlord has no knowledge of lead-based paint and/or lead-based paint hazards in the Home.{{/if}}
(b) Records and reports: {{#if leadRecords=provided}}Landlord has given Tenant copies of all available records and reports about lead-based paint and/or lead-based paint hazards in the Home: {{leadRecordsList}}.{{else}}Landlord has no records or reports about lead-based paint and/or lead-based paint hazards in the Home.{{/if}}

TENANT'S ACKNOWLEDGMENT
Tenant has received the information listed above, including any records and reports, and the pamphlet Protect Your Family From Lead in Your Home (or an equivalent pamphlet approved by the EPA).

{{#if leadAgent}}AGENT'S ACKNOWLEDGMENT
{{leadAgent}} (the "Agent") has informed Landlord of Landlord's duties under 42 U.S.C. 4852d and is aware of the Agent's responsibility to make sure those duties are carried out.

{{/if}}CERTIFICATION OF ACCURACY
Landlord{{#if leadAgent}}, Agent{{/if}} and Tenant have reviewed the information above and certify, to the best of their knowledge, that the information they have provided is true and accurate.

Landlord: {{landlord}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

{{#if leadAgent}}Agent: {{leadAgent}}
Signature: ______________________________   Date: ______________

{{/if}}{{#list tenants}}Tenant: {{name}}
Signature: ______________________________   Date: ______________

{{/list}}{{/if}}`,
  },
  {
    key: "lease_commercial", title: "Commercial Lease Agreement", category: REAL_ESTATE,
    description: "A full commercial lease for a store, office or warehouse: definitions, rent and yearly increases, who pays taxes, insurance and common-area costs, operating rules, improvements, insurance, transfer or sale of the business, default, guarantee and renewal.",
    reviewNote: "A commercial lease can bind the parties for years and for large sums. Have an attorney review it before signing — especially the rent type (gross vs. net), the exclusive-use promise, personal guarantee, renewal and default sections. A renewal written as 'rent at market' needs a way to set that rent. Recording: Maryland (Real Property Article 3-101) requires a lease to be recorded, or a memorandum of lease signed by every party to be recorded, if the first term or any single renewal term is longer than seven years; this lease promises a memorandum in that case. An unrecorded lease is still valid between the parties and against anyone who knows of it or sees the tenant in occupancy, but record it to protect the tenant against later buyers and lenders — confirm with an attorney. Written with Maryland in mind and checked against a LawDepot-style sample; these parts of that sample were deliberately NOT copied because they are risky or unclear under Maryland law, so ask an attorney before adding them: (1) 'distress' — seizing and selling the tenant's goods without notice or court process; (2) forcible re-entry and removal of the tenant by the landlord's own hands (this lease says possession is retaken only by lawful procedures); (3) a fixed formula of liquidated damages for the rest of the term (a penalty if too high); (4) a receiver who runs the tenant's business; (5) making the tenant insure the building's structure. Maryland's residential-lease protections (deposit cap and interest, 5% late-fee cap, entry notice, Tenants' Bill of Rights) do not apply to a business lease. Confirm with an attorney: the late fee and the late-interest rate you choose (they stack), whether the landlord must try to re-rent after a default, how licenses for tobacco or alcohol affect the use clause, the notice periods you chose, whether the landlord needs advance notice (60 days under Real Property Article 8-402) before a fixed term ends if it wants the tenant out when the lease expires, and any local licensing rules. Companies must sign through an officer with a title; collect authority documents for both sides.",
    steps: [
      { title: "Parties", questions: [text("landlord", "Landlord", { required: true }), text("landlordAddress", "Landlord's address for notices", { required: true }), text("landlordPhone", "Landlord's telephone (optional)"), text("landlordEmail", "Landlord's email (optional)"), text("tenant", "Tenant (business name)", { prefill: "clientName", required: true }), text("tenantAddress", "Tenant's address for notices", { prefill: "clientAddress", required: true }), text("tenantPhone", "Tenant's telephone (optional)", { prefill: "clientPhone" }), text("tenantEmail", "Tenant's email (optional)"), effective(), state()] },
      { title: "The space and its use", questions: [text("premises", "Address of the space (include suite)", { required: true }), text("county", "County or city", { required: true }), text("size", "Size", { placeholder: "e.g. About 2,400 square feet" }),
        text("use", "Permitted use", { required: true, placeholder: "e.g. Retail convenience store and deli" }), text("parkingText", "Parking and common areas included", { placeholder: "e.g. Six reserved spaces and shared loading area — leave empty if no parking is reserved" }),
        yesno("exclusive", "Landlord promises not to rent other space in the building to a competing business (exclusive use)"), text("exclusiveFor", "The main business that is protected", { showIf: { id: "exclusive", equals: true }, required: true, placeholder: "e.g. a grocery, convenience store or deli" }),
        yesno("keepOpen", "Tenant must keep the business open and operating during the Lease"), text("hours", "Days and hours the business must be open (optional)", { showIf: { id: "keepOpen", equals: true }, placeholder: "e.g. Monday to Saturday, 8 a.m. to 9 p.m." }),
        yesno("signage", "Tenant may install its own sign, subject to law and landlord's approval", { default: true })] },
      { title: "Term and rent", questions: [
        date("startDate", "Lease starts", { required: true }), date("possessionDate", "Tenant may take the space earlier, on (optional)", { help: "To set up before opening. All terms apply from that date except that base rent starts on the date the Lease starts." }), date("endDate", "Lease ends", { required: true }), money("rent", "Monthly base rent", { required: true }), num("rentDay", "Rent due on day", { default: "1", required: true }), num("graceDays", "Days before rent is late", { default: "5", required: true }),
        num("increasePercent", "Rent increases each year by (%, 0 for none)", { default: "3", required: true }),
        num("interestPercent", "Interest on unpaid amounts (% per year, 0 for none)", { default: "6", required: true, help: "The lease says never more than the law allows. Ask an attorney if you want a higher rate. If you also charge a late fee, the two add up." }),
        pick("rentType", "Who pays property taxes, insurance and common-area costs?", [["gross", "Landlord pays them (gross lease)"], ["nnn", "Tenant pays its share on top of rent (triple net)"], ["modified", "Shared as listed below (modified gross)"]], { required: true, default: "gross" }),
        text("costNote", "How costs are shared", { showIf: { id: "rentType", equals: "modified" }, required: true }), num("sharePercent", "Tenant's share of the building's costs (%)", { showIf: { id: "rentType", equals: "nnn" }, default: "100", required: true, help: "The space's floor area divided by the floor area of all rentable space in the building." }),
        money("deposit", "Security deposit", { required: true }), yesno("lateFee", "Charge a late fee"), money("lateFeeAmount", "Late fee", { showIf: { id: "lateFee", equals: true }, required: true }),
        yesno("renewal", "Tenant has the option to renew"), text("renewalTerms", "Renewal terms", { showIf: { id: "renewal", equals: true }, required: true, placeholder: "e.g. One 3-year renewal, 6 months' notice, rent increased by 3% a year" }),
      ] },
      { title: "Upkeep, insurance, default", questions: [
        pick("utilities", "Utilities", [["tenant", "Tenant pays all utilities"], ["landlord", "Landlord pays all utilities"], ["split", "As listed below"]], { required: true, default: "tenant" }), text("utilitiesNote", "Which utilities, and who pays", { showIf: { id: "utilities", equals: "split" }, required: true }),
        pick("repairs", "Repairs", [["standard", "Landlord: roof, structure and building systems. Tenant: everything inside the space"], ["tenantAll", "Tenant repairs and maintains the whole space"]], { required: true, default: "standard" }),
        money("liabilityAmount", "Tenant's liability insurance (minimum per occurrence)", { default: "1000000", required: true }),
        num("payNoticeDays", "Days after written notice before unpaid rent is a default", { default: "10", required: true }), num("fixDays", "Days to fix any other breach after written notice", { default: "30", required: true }), num("entryHours", "Hours' notice before the landlord enters (except in an emergency)", { default: "24", required: true }),
        num("holdoverPercent", "Rent if tenant stays past the end date without permission (% of the last rent)", { default: "150", required: true }),
        yesno("affiliateTransfer", "Tenant may transfer the Lease to its own parent, subsidiary or affiliate without consent", { default: false }),
        yesno("guarantee", "Someone personally guarantees the tenant's obligations"), text("guarantor", "Guarantor's name", { showIf: { id: "guarantee", equals: true }, required: true }),
        yesno("brokerUsed", "A real-estate broker was involved"), text("brokerName", "Broker / brokerage and who pays the commission", { showIf: { id: "brokerUsed", equals: true } }),
        area("extraClauses", "Any additional terms (optional)", { placeholder: "e.g. Landlord will install a new storefront door before the Lease starts" }),
      ] },
    ],
    body: `COMMERCIAL LEASE AGREEMENT

This Lease is made on {{effectiveDate}} between {{landlord}}, {{landlordAddress}}{{#if landlordPhone}}, telephone {{landlordPhone}}{{/if}}{{#if landlordEmail}}, email {{landlordEmail}}{{/if}} ("Landlord") and {{tenant}}, {{tenantAddress}}{{#if tenantPhone}}, telephone {{tenantPhone}}{{/if}}{{#if tenantEmail}}, email {{tenantEmail}}{{/if}} ("Tenant"). In return for the promises in this Lease, which each of them accepts as fair payment, Landlord and Tenant (the "Parties") agree as follows.

1. DEFINITIONS
"Building" means the building at {{premises}}, {{county}}, and the land it stands on, with its improvements and facilities. "Base Rent" is the monthly rent set out in the Rent section. "Additional Rent" means every amount Tenant owes under this Lease other than Base Rent, whether or not it is called Additional Rent. "Rent" means Base Rent and Additional Rent together. "Common Areas" means the parts of the Building and land that Landlord does not lease to one particular tenant and keeps for use by all tenants and their customers, such as entrances, hallways, restrooms, parking areas, driveways, walkways, loading areas, landscaped areas, roofs, exterior walls and the shared mechanical, electrical and security equipment.

2. PREMISES
Landlord leases to Tenant the space at {{premises}}, {{county}}{{#if size}} ({{size}}){{/if}} (the "Premises"). Tenant and its customers may use the Common Areas together with Landlord and the other tenants, subject to the rules in this Lease. {{#if parkingText}}Tenant also has {{parkingText}}.{{else}}No parking is reserved for Tenant.{{/if}}{{#if exclusive}} While Tenant is using the Premises for the permitted use and is not in default, Landlord will not lease other space in the Building to a business whose main business is {{exclusiveFor}}.{{/if}}

3. USE AND OPERATION
Tenant will use the Premises only for {{use}}, in compliance with all laws, with the rules of Landlord's insurers, and with every license and permit the use requires, and will not create a nuisance, make unreasonable noise, carry on any illegal activity, or keep anything on the Premises that is dangerous, flammable or explosive or that a responsible insurer would treat as hazardous. {{#if keepOpen}}Tenant will open the whole of the Premises to the public, stocked and staffed, when the Lease begins and will keep the business open and operating throughout the Lease{{#if hours}} (required hours: {{hours}}){{/if}}. {{/if}}Tenant will obey the reasonable written rules Landlord posts for the use and care of the Building, the parking areas and the Common Areas, and will tell Landlord promptly of any damage or any situation that may seriously interfere with the use of the Premises.{{#if signage}} Tenant may install a sign with Landlord's written approval, which will not be unreasonably withheld, at Tenant's cost and in compliance with local law; Tenant removes it and repairs any damage at the end of the Lease.{{/if}}

4. CONDITION, LICENSES AND QUIET USE
Landlord delivers the Premises in their present condition, and Tenant has the quiet use of them as long as Tenant pays the Rent and keeps the other promises in this Lease. Landlord does not promise that zoning or any other law allows Tenant's use; Tenant is responsible for confirming this and for obtaining every license and permit its business needs, including tobacco, alcohol and sales-tax licenses. Tenant is responsible for accessibility (ADA) requirements inside the Premises and for its own work; Landlord is responsible for the Common Areas. Tenant will not use or store hazardous materials except ordinary retail products, and will pay for any contamination it causes.

5. TERM
The Lease runs from {{startDate}} to {{endDate}}.{{#if possessionDate}} Tenant may take possession of the Premises on {{possessionDate}} to prepare them for business; all terms of this Lease apply from that date, except that Base Rent starts on {{startDate}}.{{/if}}{{#if renewal}} Renewal: {{renewalTerms}}.{{/if}} If the first term or any renewal term is longer than seven years, the Parties will sign a memorandum of lease that either of them may record in the land records, and either Party may ask the other to sign one at any time. If Tenant stays after the end date with Landlord's written consent, a month-to-month tenancy begins on the same terms as this Lease, and either party may end it by giving the other at least 30 days' written notice (or any longer notice the law requires).

6. RENT
Tenant pays base rent of {{rent}} per month, due on day {{rentDay}} of each month, without set-off or deduction except as this Lease expressly allows (for example after damage to the Premises). {{#if increasePercent}}Each year on the anniversary of the start date, base rent increases by {{increasePercent}}% of the rent in effect. {{/if}}Rent not received within {{graceDays}} days after the due date is {{#if lateFee}}subject to a late fee of {{lateFeeAmount}} and {{/if}}late.{{#if interestPercent}} Unpaid amounts also bear simple interest at {{interestPercent}}% per year from the due date, but never more than the law allows.{{/if}} Landlord's acceptance of less than the full amount due is not a waiver of the rest and does not limit Landlord's remedies. Every amount Tenant owes under this Lease is Additional Rent, and Landlord may collect it in the same way as unpaid Base Rent.

7. TAXES, INSURANCE AND COMMON-AREA COSTS
{{#if rentType=gross}}Landlord pays property taxes, building insurance and common-area costs; they are included in the rent.{{/if}}{{#if rentType=nnn}}In addition to base rent, Tenant pays {{sharePercent}}% (its "Proportionate Share") of the Building's property taxes, building insurance and the costs of operating, maintaining and repairing the Building and the Common Areas, in monthly estimates adjusted after each year ends. Landlord may estimate these costs for the coming year and give Tenant a written breakdown; Tenant pays one-twelfth of the estimate with each month's Base Rent. Landlord gives Tenant a written statement of the actual costs within 120 days after each year ends; Tenant pays any shortfall within 30 days, or Landlord credits or refunds any overpayment (after deducting rent then overdue), and Landlord shows Tenant the records on request.{{/if}}{{#if rentType=modified}}Property taxes, building insurance and common-area costs are shared as follows: {{costNote}}{{/if}}{{#if !rentType=gross}} These costs do not include Landlord's mortgage payments or depreciation; capital replacements and structural repairs; leasing, advertising and management costs that are not part of actually operating or maintaining the Building; amounts Landlord recovers from insurers or under warranties; costs caused by Landlord's or its agents' negligence or willful acts; repairs for the account of one other tenant or for vacant space; or amounts another tenant pays directly.{{/if}} Tenant also pays, when due, all taxes, license fees and charges on Tenant's own business, equipment, inventory and improvements.

8. SECURITY DEPOSIT
Tenant pays a security deposit of {{deposit}} when the Lease is signed. Landlord holds it without interest unless the law requires interest, and returns it within 45 days after the Lease ends and Tenant has surrendered the Premises, less amounts needed for unpaid rent or for damage beyond normal wear, with a written list of the deductions. Tenant may not use the deposit as payment of Rent. The deposit is not a limit on what Tenant owes.

9. UTILITIES
{{#if utilities=tenant}}Tenant pays all utilities for the Premises.{{/if}}{{#if utilities=landlord}}Landlord pays all utilities for the Premises.{{/if}}{{#if utilities=split}}{{utilitiesNote}}{{/if}}

10. REPAIRS AND MAINTENANCE
{{#if repairs=standard}}Landlord repairs and maintains the roof, structure, foundation and building systems serving the Premises, except damage caused by Tenant. Tenant keeps the inside of the Premises clean and in good repair, including fixtures, windows, doors and Tenant's equipment.{{else}}Tenant repairs and maintains the entire Premises, including the roof, structure and building systems serving them, except for the cost of replacing major structural elements, which Landlord bears.{{/if}}

11. ALTERATIONS
Tenant obtains Landlord's written consent, which will not be unreasonably withheld for ordinary work, before it paints or redecorates in a way that significantly changes the appearance of the Premises; adds or removes walls or makes any structural change; changes the heat or power used or adds wiring or heating units; installs equipment or machinery that affects the Building's systems; or puts up any antenna, satellite dish or outside sign. Improvements Tenant makes become Landlord's property at the end of the Lease unless the parties agree otherwise in writing, and Tenant keeps the Premises free of liens for work Tenant orders.

12. INSURANCE AND INDEMNITY
Landlord does not insure Tenant's property or business, and is not responsible for loss of or damage to them; Tenant should insure its own inventory, equipment, improvements and business income. Tenant carries commercial general liability insurance of at least {{liabilityAmount}} per occurrence, naming Landlord as an additional insured, plus insurance on Tenant's own property, and gives Landlord proof on request. Tenant is not responsible for insuring Landlord's own contents or furnishings. Tenant protects Landlord from claims arising from Tenant's use of the Premises, except those caused by Landlord's negligence. Each party waives claims against the other for loss that its own property insurance covers, to the extent its insurer allows this.

13. DAMAGE AND CONDEMNATION
If the Premises are damaged and cannot be used, rent is reduced until they are repaired. Landlord will repair the damage within 120 days if insurance money is available; if repairs would take more than 120 days or the insurance money is not available, either party may end the Lease by written notice. If a government takes all or a substantial part of the Premises, the Lease ends on the date of the taking. Tenant may claim a separate award for its own property, fixtures it paid for and moving costs, but not for the value of the rest of the Lease term.

14. ASSIGNMENT, SUBLETTING AND SALE OF THE BUSINESS
Tenant may not assign this Lease, sublet any part of the Premises, or let anyone else occupy them without Landlord's written consent, which will not be unreasonably withheld if the proposed transfer complies with this Lease.{{#if affiliateTransfer}} Tenant may transfer the Lease to its own parent, subsidiary or affiliate without consent if it first tells Landlord in writing.{{/if}} A transfer of control of Tenant counts as an assignment, and so does a transfer by operation of law. A sale of Tenant's business or its assets needs Landlord's written consent too, which will not be unreasonably withheld if Tenant and the buyer show Landlord that the buyer will keep performing this Lease. Tenant stays responsible after any transfer unless Landlord releases it in writing. If the Lease is assigned or the Premises are sublet, Landlord may collect rent directly from the assignee or subtenant and apply it to the rent owed. Consent to one transfer is not consent to a later one.

15. LANDLORD'S ENTRY
Landlord and its agents may enter the Premises at reasonable times to inspect, repair or show them to buyers, lenders or new tenants. Except in an emergency, Landlord gives Tenant {{entryHours}} hours' notice before entering.

16. DEFAULT AND REMEDIES
Tenant is in default if it does not pay Rent within {{payNoticeDays}} days after written notice, or breaks another term and does not fix it within {{fixDays}} days after written notice. Landlord may then end the Lease or Tenant's right to possession and retake possession by the lawful procedures available under the law, and recover unpaid rent, damages and reasonable collection and legal costs, giving credit for amounts received from re-renting. Landlord may re-rent the Premises for a term shorter or longer than the rest of this Lease and on reasonable terms, and Tenant remains liable for any shortfall. Tenant property left on the Premises after the Lease ends or Tenant is removed may be stored at Tenant's cost or disposed of as the law allows, and any proceeds are applied to what Tenant owes. If Tenant abandons the Premises, Landlord may enter and re-rent them as Tenant's agent, and Tenant remains liable for the Rent. Landlord defaults if it does not fix a failure within {{fixDays}} days after written notice from Tenant. The provisions about money owed and about the consequences of ending the Lease continue after it ends.

17. SUBORDINATION AND ESTOPPEL
This Lease is subject to any mortgage on the Building, provided the lender agrees not to disturb Tenant while Tenant is not in default. Within 15 days of a request, Tenant will sign a reasonable subordination, non-disturbance and attornment agreement with a lender, and each party will confirm in writing the Lease's terms and whether any default exists.

18. END OF LEASE AND HOLDING OVER
At the end of the Lease Tenant returns the Premises clean and in as good condition as when it received them, normal wear, damage by the elements and approved alterations excepted, and removes its own property. If Tenant stays after the end date without Landlord's written consent and without a new written lease, Tenant is a holdover tenant and this is not a renewal or a tenancy from year to year: rent is {{holdoverPercent}}% of the last monthly rent, prorated by day, all other terms still apply, Tenant owes Landlord's resulting damages, and Landlord may recover possession.

{{#if guarantee}}19. GUARANTEE
{{guarantor}} personally and unconditionally guarantees that Tenant will pay all rent and perform all obligations under this Lease, as amended or renewed, and signs below to confirm it. The guarantee continues despite any change to the Lease, any release of Tenant or any delay by Landlord. Guarantor gives up any right to notice and any defense available to a guarantor, Landlord need not first pursue Tenant, and Guarantor will pay Landlord's reasonable costs of collecting from Guarantor.

{{/if}}{{#if brokerUsed}}20. BROKER
{{brokerName}} acted in this Lease. Each party will protect the other from any other broker's claim based on its own dealings.

{{/if}}{{#if extraClauses}}21. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}22. GENERAL
This is the parties' entire agreement. Anything said or promised before this Lease is not binding unless it is written in it, and Landlord gives no warranty that is not written in it. It may be changed only in writing signed by both, binds their heirs, successors and permitted assigns, and is governed by the laws of the State of {{state}}, whose courts may settle any dispute about it. If this Lease conflicts with a {{state}} law that cannot be changed by agreement, that law applies and this Lease is treated as changed to the extent needed. If there is more than one Tenant, each is jointly and severally liable for all Tenant's obligations. A party's waiver of one breach is not a waiver of any later breach. Notices must be in writing and delivered personally, by courier, or by certified or registered mail to the addresses above, or to another address a party gives in writing. Time is of the essence. If any part is not enforceable, the rest remains in effect. This Lease may be signed in counterparts, including electronically. Each person who signs for a company states that he or she is authorized to do so.

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
  {
    key: "commercial_sublease", title: "Commercial Sublease Agreement", category: REAL_ESTATE,
    description: "A business tenant rents all or part of its space to another business: ties the sublease to the master lease, sets rent and who is paid, insurance, default, and includes the landlord's consent page.",
    reviewNote: "A sublease sits under the master lease: read the master lease first, because most commercial leases forbid subletting without the landlord's written consent and may limit the use, the term and the rent. This document includes a landlord consent page — get it signed before the subtenant moves in. The sublandlord stays responsible to the landlord for the master lease even after the sublease, and the sublease cannot outlast the master lease (this document says it ends when the master lease ends unless the landlord agrees in writing to keep the subtenant). The sublease term must not run past the master lease. Attach a copy of the master lease. If the master lease is for a term over seven years, check with an attorney whether the sublease should be recorded too (Real Property Article 3-101). Written with Maryland in mind and checked against a LawDepot-style sample; these parts of that sample were not copied because they are risky or unclear: ending all duties automatically when the master lease ends (this document ends the sublease but keeps money already owed), a mandatory loser-pays attorney's-fee rule (it is an option here), and re-entry by the landlord's own hands (this document says possession is retaken only by lawful procedures). Added after review: rent for part of the premises is the same share of the master rent by floor area, holdover rent, and an optional confirmation by the landlord on the consent page that the master lease is in force and no default is known (a landlord may strike it). Confirm with an attorney: the default notice periods, the personal guarantee, tobacco, alcohol or lottery licenses (the subtenant must hold its own — a sublease does not transfer a license), and any local rental license. Companies must sign through an officer with a title.",
    steps: [
      { title: "Parties and master lease", questions: [text("sublandlord", "Sublandlord (the tenant who is subletting)", { required: true }), text("sublandlordAddress", "Sublandlord's address for notices", { required: true }), text("subtenant", "Subtenant (the new occupant)", { prefill: "clientName", required: true }), text("subtenantAddress", "Subtenant's address for notices", { prefill: "clientAddress", required: true }), text("landlord", "Landlord under the master lease", { required: true }), date("masterLeaseDate", "Date of the master lease", { required: true }), text("premises", "Address of the premises (include suite)", { required: true }), effective(), state()] },
      { title: "The space and the term", questions: [
        pick("scope", "What is sublet?", [["all", "All of the premises"], ["part", "Part of the premises"]], { required: true, default: "all" }), text("partDesc", "Describe the part sublet", { showIf: { id: "scope", equals: "part" }, required: true, placeholder: "e.g. The front retail room and the storage room on the first floor" }),
        date("startDate", "Sublease starts", { required: true }), date("endDate", "Sublease ends", { required: true, help: "Not later than the end of the master lease." }),
        text("use", "Permitted use (leave empty to use whatever the master lease allows)", { placeholder: "e.g. Retail convenience store" }),
      ] },
      { title: "Rent and costs", questions: [
        pick("rentBasis", "Rent", [["same", "The same rent the master lease requires"], ["amount", "A different monthly rent set here"]], { required: true, default: "same" }), money("rent", "Monthly rent", { showIf: { id: "rentBasis", equals: "amount" }, required: true }),
        num("rentDay", "Rent due on day", { default: "1", required: true }), num("graceDays", "Days before rent is late", { default: "5", required: true }),
        pick("payTo", "Who is the rent paid to?", [["landlord", "The Subtenant pays the landlord directly"], ["sublandlord", "The Subtenant pays the Sublandlord, who pays the landlord"]], { required: true, default: "sublandlord" }), text("payHow", "How it is paid (optional)", { placeholder: "e.g. By Zelle to the landlord's account, or by check" }),
        yesno("lateFee", "Charge a late fee"), money("lateFeeAmount", "Late fee", { showIf: { id: "lateFee", equals: true }, required: true }), money("nsfFee", "Fee for a returned check or payment (optional)", { default: "25" }),
        money("deposit", "Security deposit paid to the Sublandlord (optional)"),
        pick("utilities", "Utilities and other charges", [["subtenant", "The Subtenant pays all utilities and charges the master lease makes the Sublandlord pay"], ["split", "As listed below"]], { required: true, default: "subtenant" }), text("utilitiesNote", "Which charges, and who pays", { showIf: { id: "utilities", equals: "split" }, required: true }),
      ] },
      { title: "Insurance, default and extras", questions: [
        money("liabilityAmount", "Subtenant's liability insurance (minimum per occurrence)", { default: "1000000", required: true }),
        num("payNoticeDays", "Days after written notice before unpaid rent is a default", { default: "10", required: true }), num("fixDays", "Days to fix any other breach after written notice", { default: "30", required: true }), num("entryHours", "Hours' notice before the sublandlord or landlord enters (except in an emergency)", { default: "24", required: true }),
        num("holdoverPercent", "Rent if the subtenant stays past the end date without permission (% of the last rent)", { default: "150", required: true }),
        yesno("landlordEstoppel", "The landlord's consent page also confirms that the master lease is in force and that no default is known", { default: true }),
        yesno("attorneyFees", "In a lawsuit about this sublease the losing party pays the winner's reasonable attorney's fees and court costs", { default: false }),
        yesno("guarantee", "Someone personally guarantees the subtenant's obligations"), text("guarantor", "Guarantor's name", { showIf: { id: "guarantee", equals: true }, required: true }),
        area("extraClauses", "Any additional terms (optional)"),
      ] },
    ],
    body: `COMMERCIAL SUBLEASE AGREEMENT

This Sublease is made on {{effectiveDate}} between {{sublandlord}}, {{sublandlordAddress}} ("Sublandlord") and {{subtenant}}, {{subtenantAddress}} ("Subtenant").

1. BACKGROUND AND MASTER LEASE
The Sublandlord rents the premises at {{premises}} (the "Premises") from {{landlord}} (the "Landlord") under a lease dated {{masterLeaseDate}} (the "Master Lease"). The Sublandlord wishes to sublet {{#if scope=part}}part of the Premises, described as {{partDesc}}{{else}}all of the Premises{{/if}} (the "Subleased Premises") to the Subtenant, and the Subtenant wishes to take it, on these terms. The Sublandlord has given the Subtenant a copy of the Master Lease, which the parties will attach to this Sublease. This Sublease is subject to the Master Lease; if the two conflict, the Master Lease controls unless this Sublease clearly says otherwise.

2. TERM
The term of this Sublease runs from {{startDate}} to {{endDate}} (the "Term"), at 12:00 noon on each date. The Term will not run past the end of the Master Lease.

3. LANDLORD'S CONSENT
This Sublease is not binding on either party until both have signed and delivered it and the Landlord has consented to it in writing on the consent page at the end. The Landlord's consent does not release the Sublandlord from the Master Lease.

4. RENT
{{#if rentBasis=same}}The Subtenant pays rent in the same amount, on the same dates and on the same terms as the Master Lease requires for the Subleased Premises{{#if scope=part}}, which is the same share of the Master Lease rent as the Subleased Premises bear to the whole of the Premises by floor area{{/if}}.{{else}}The Subtenant pays rent of {{rent}} per month, due on day {{rentDay}} of each month, without set-off or deduction.{{/if}} {{#if payTo=landlord}}The Subtenant pays the rent directly to the Landlord{{#if payHow}} ({{payHow}}){{/if}}, and each payment counts as payment under this Sublease.{{else}}The Subtenant pays the rent to the Sublandlord{{#if payHow}} ({{payHow}}){{/if}}, who passes on to the Landlord what the Master Lease requires.{{/if}} Rent not received within {{graceDays}} days after the due date is {{#if lateFee}}subject to a late fee of {{lateFeeAmount}} and {{/if}}late.{{#if nsfFee}} The Subtenant pays {{nsfFee}} for each check or payment returned by its bank.{{/if}} All sums the Subtenant owes under this Sublease are additional rent and may be collected like unpaid rent.

{{#if deposit}}5. SECURITY DEPOSIT
The Subtenant pays the Sublandlord a security deposit of {{deposit}} when this Sublease is signed. The Sublandlord holds it, without interest unless the law requires it, and returns it within 45 days after the Term ends and the Subtenant has given the Subleased Premises back, less amounts needed for unpaid rent or for damage beyond normal wear, with a written list of deductions. It is separate from any deposit under the Master Lease and is not a limit on what the Subtenant owes.

{{/if}}6. USE
The Subtenant and its employees and agents will use the Subleased Premises only for {{#if use}}{{use}}, which must also be allowed by the Master Lease{{else}}a purpose the Master Lease permits{{/if}}, will comply with every law and with every license and permit the use requires (the Subtenant must hold its own licenses; a sublease does not transfer a license), and will not do anything that would break the Master Lease.

7. THE MASTER LEASE
From {{startDate}} until the Term ends, the Subtenant will perform every duty of the Sublandlord under the Master Lease that applies to the Subleased Premises, except that rent is paid as set out above. As to the Subtenant, the Sublandlord has the rights and remedies the Landlord has against the Sublandlord under the Master Lease. The Sublandlord stays responsible to the Landlord for the Master Lease. The Sublandlord states that the Master Lease is in force and unchanged and that, to its knowledge, neither the Sublandlord nor the Landlord is in default under it. The Sublandlord will not change or end the Master Lease, or give up any of its rights under it, in a way that harms the Subtenant, without the Subtenant's written consent, and will promptly give the Subtenant a copy of any notice the Landlord sends about the Subleased Premises. If the Master Lease ends early because of the Subtenant's default, the Subtenant is liable for the resulting loss; if it ends because of the Sublandlord's default or act, the Sublandlord is liable to the Subtenant for the Subtenant's resulting loss. This Sublease ends when the Master Lease ends, unless the Landlord agrees in writing to keep the Subtenant as a direct tenant; ending it does not cancel money already owed.

8. UTILITIES AND OTHER CHARGES
{{#if utilities=subtenant}}The Subtenant pays all utilities and other charges for the Subleased Premises that the Master Lease makes the Sublandlord pay, during the Term.{{else}}{{utilitiesNote}}{{/if}}

9. CARE, REPAIRS AND SURRENDER
The Subtenant keeps the Subleased Premises clean and in good condition, reports needed repairs and maintenance problems at once to both the Sublandlord and the Landlord, and is liable to the Sublandlord and the Landlord for damage done to the Subleased Premises, their contents or the building by the Subtenant or its employees, customers and guests. At the end of the Term the Subtenant gives back the Subleased Premises, and any furniture and decoration in them, in as good a condition as at the start, normal wear and damage by the elements excepted. Improvements left on the Subleased Premises at the end stay with the Sublandlord, free of any lien. If the Subtenant stays after the Term without the Sublandlord's written consent, the Subtenant pays rent at {{holdoverPercent}}% of the last monthly rent, prorated by day, and is liable to the Sublandlord for any holdover rent, charges and damages the Landlord claims under the Master Lease because of the Subtenant's staying.

10. ALTERATIONS
The Subtenant may make alterations and improvements only with the prior written consent of the Sublandlord and, where the Master Lease requires it, the Landlord. The work must comply with all building laws, and the Subtenant keeps the Subleased Premises free of liens for work or materials it orders.

11. INSURANCE AND INDEMNITY
The Subtenant, at its own cost, carries the kinds of insurance the Master Lease requires of the Sublandlord, with commercial general liability of at least {{liabilityAmount}} per occurrence, naming the Sublandlord and the Landlord as additional insureds, and gives both proof of it when the policy is issued and each time it is renewed. The Subtenant protects the Sublandlord and the Landlord from claims arising from the Subtenant's use of the Subleased Premises, except those caused by their negligence.

12. TAXES
The Subtenant pays all license, privilege, excise and other taxes assessed on its business, on the Subleased Premises during the Term to the extent the Master Lease makes the Sublandlord pay them, and on any personal property on the Subleased Premises, and will avoid late fees and penalties.

13. ENTRY
The Sublandlord and the Landlord may enter the Subleased Premises on {{entryHours}} hours' notice to inspect them, maintain them or make repairs they are responsible for, and at any time in an emergency.

14. DEFAULT
The Subtenant is in default if:
• it does not pay rent when due and does not pay within {{payNoticeDays}} days after written notice;
• it does not perform another duty under this Sublease or the Master Lease and does not fix it within {{fixDays}} days after written notice;
• it becomes insolvent or bankrupt, makes an assignment for the benefit of creditors, or a receiver is appointed for its affairs;
• it abandons the Subleased Premises or any part of them;
• it uses the Subleased Premises for an unpermitted or illegal purpose; or
• the Subleased Premises are damaged by fire or other casualty caused by the Subtenant's negligence or willful act, or that of its employees, agents or guests.

15. REMEDIES
If the Subtenant is in default, the Sublandlord may end this Sublease after the longer of the notice this Sublease, the Master Lease or the law requires; do what the Subtenant failed to do and charge the Subtenant for it; retake possession of the Subleased Premises by the lawful procedures available under the law; and recover unpaid rent, damages and reasonable collection costs, giving credit for amounts received from re-renting. Using one remedy does not prevent using any other, and the remedies in the Master Lease and the law are also available.

16. ASSIGNMENT AND FURTHER SUBLETTING
The Subtenant will not assign this Sublease or sublet or transfer any part of the Subleased Premises without the prior written consent of both the Sublandlord and the Landlord.

17. NOTICES
Notices must be in writing and delivered personally, by courier, or by certified or registered mail, to the Sublandlord at {{sublandlordAddress}} and to the Subtenant at {{subtenantAddress}}, or to another address a party gives in writing.

{{#if attorneyFees}}18. ATTORNEY'S FEES
In a lawsuit about this Sublease, the losing party pays the winning party's reasonable attorney's fees and court costs as the court decides.

{{/if}}{{#if guarantee}}19. GUARANTEE
{{guarantor}} personally and unconditionally guarantees that the Subtenant will pay the rent and perform all its duties under this Sublease, as extended or changed, and signs below to confirm it. The guarantee continues despite any change, release of the Subtenant or delay by the Sublandlord, and the Sublandlord need not first pursue the Subtenant.

{{/if}}{{#if extraClauses}}20. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}21. GENERAL
This Sublease is the whole agreement of the parties and may be changed only in writing signed by them and, where the Master Lease requires, consented to by the Landlord. It binds the parties' heirs, successors and permitted assigns and is governed by the laws of the State of {{state}}, whose courts may settle any dispute about it. If it conflicts with a {{state}} law that cannot be changed by agreement, that law applies and this Sublease is treated as changed to the extent needed. If there is more than one Subtenant, each is jointly and severally liable. The Sublandlord and the Subtenant are not agents of each other and are not partners. Time is of the essence. If a term cannot be enforced, the rest stays in force. This Sublease may be signed in counterparts, including electronically. Headings are for convenience only, the singular includes the plural, and any gender includes every gender. Each person who signs for a company states that he or she is authorized to do so, and each signer acknowledges receiving a signed copy.

SUBLANDLORD: {{sublandlord}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

SUBTENANT: {{subtenant}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________
{{#if guarantee}}
GUARANTOR: {{guarantor}}
Signature: ______________________________   Date: ______________
{{/if}}
[page break]
CONSENT OF LANDLORD TO SUBLEASE
The undersigned is the landlord under the lease dated {{masterLeaseDate}} for the premises at {{premises}}, and consents to the Sublease above between {{sublandlord}} and {{subtenant}}. This consent does not release {{sublandlord}} from its duties under that lease, and it is not consent to any further assignment or subletting.{{#if landlordEstoppel}} The landlord confirms that the lease is in force, that it has not been changed except as the copy attached to the Sublease shows, and that, to the landlord's knowledge, no default exists under it.{{/if}} The landlord will send both the Sublandlord and the Subtenant notice of any breach by the Subtenant of the lease.

LANDLORD: {{landlord}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________`,
  },
  {
    key: "loan_agreement", title: "Loan Agreement", category: LENDING,
    description: "A lender gives a loan to one or more borrowers: the amount, interest, repayment dates, early payment, default, costs, and optional security and notary pages.",
    reviewNote: "Maryland generally limits interest on a written loan to 8% a year, and the borrower must sign a writing that states the rate (Commercial Law §12-103). There are exceptions — for example loans to corporations and some commercial loans over $15,000 — and a higher rate for an individual borrower can require a lender's license, so confirm the rate with an attorney before using more than 8%. A late fee is safest at no more than the greater of $2 or 5% of the late payment, charged only once the payment is at least 15 days late (Commercial Law §12-105); a larger fee can be counted as interest. This agreement deliberately has no confession-of-judgment clause — do not add one (federal rules ban it in consumer loans, 16 CFR §444.2). If a borrower is an individual borrowing for personal or household use, or the lender makes loans as a business, federal Truth in Lending disclosures, Maryland consumer-credit and licensing rules, and limits on collection attorney's fees may apply. Real estate as security needs a separate recorded mortgage or deed of trust, and a lien on a vehicle or boat must be noted on its title; for other property the lender should file a financing statement with the right state office (for a company organized in Maryland or an individual who lives in Maryland, SDAT — otherwise the filing goes where the company is organized or the individual lives). A below-market loan between related people or companies can create taxable imputed interest (IRC §7872) — ask the tax preparer. Check that the number of payments, the first payment date and the final due date agree. This agreement covers the lender's promise to lend and the borrower's promise to repay; use the Promissory Note when only a signed promise to pay is needed, and keep the interest, late-fee and default terms the same if you use both. The notary pages are optional; they help prove who signed. Written with Maryland in mind.",
    steps: [
      { title: "Parties", questions: [text("lender", "Lender", { required: true }), text("lenderAddress", "Lender's address", { required: true }), list("borrowers", "Borrowers — each is responsible for the whole loan", [text("name", "Name", { required: true }), text("address", "Address")], { required: true, minItems: 1, addLabel: "Add a borrower" }), effective(), state()] },
      { title: "The loan", questions: [
        money("principal", "Amount of the loan", { required: true }), date("fundingDate", "Lender provides the money on", { required: true }), text("purpose", "What the money is for (optional)", { placeholder: "e.g. Buying equipment for the store" }),
        num("rate", "Annual interest rate (%)", { required: true, default: "0", help: "Enter 0 for no interest. Maryland generally limits interest on a written loan to 8% a year (Commercial Law §12-103); loans to corporations and some commercial loans over $15,000 are exempt, and higher rates can require a lender's license. Confirm the rate with the attorney before using more than 8%. If the loan is between related people or companies and the rate is below the IRS applicable federal rate, ask the tax preparer about imputed interest." }),
        pick("schedule", "Repayment", [["monthly", "Equal monthly payments"], ["lump", "One payment on the due date"]], { required: true, default: "monthly" }),
        num("months", "Number of monthly payments", { showIf: { id: "schedule", equals: "monthly" }, required: true }), money("paymentAmount", "Amount of each monthly payment", { showIf: { id: "schedule", equals: "monthly" }, required: true, help: "Principal plus interest, spread over the payments." }),
        date("firstPayment", "First payment due", { showIf: { id: "schedule", equals: "monthly" }, required: true }), date("dueDate", "Final due date", { required: true, help: "For monthly payments this is the date of the last payment; any balance is due then." }),
        yesno("prepay", "Borrower may repay early without penalty", { default: true }), yesno("lateFee", "Charge a late fee"), money("lateFeeAmount", "Late fee", { showIf: { id: "lateFee", equals: true }, required: true, help: "Charged once, only if a payment is more than 15 days late. To stay clearly within Maryland's rule for loans that have a rate limit, keep it to no more than the greater of $2 or 5% of the late payment." }), num("graceDays", "Days after written notice before a missed payment is a default", { default: "10", required: true }),
        yesno("secured", "The loan is secured by property"), text("collateral", "Describe the property", { showIf: { id: "secured", equals: true }, required: true, help: "Be specific — make, model and serial or VIN numbers, not just \"all equipment\"." }),
        yesno("notary", "Add notary acknowledgment pages for the lender and the borrowers", { default: false }),
        area("extraClauses", "Any additional terms (optional)"),
      ] },
    ],
    body: `LOAN AGREEMENT

Date: {{effectiveDate}}

This agreement is between {{lender}}, {{lenderAddress}} ("Lender") and the following (together "Borrower"):
{{#list borrowers}}• {{name}}{{#if address}}, {{address}}{{/if}}
{{/list}}
1. THE LOAN
On {{fundingDate}} Lender lends Borrower {{principal}}{{#if purpose}} for {{purpose}}{{/if}} (the "Loan"), and Borrower promises to repay it to Lender{{#if rate}} with simple interest at {{rate}}% per year (365-day year) on the unpaid balance{{else}} without interest{{/if}}, as this agreement says. Interest and fees together will never exceed the maximum the law allows; any excess is applied to principal or refunded to Borrower. If more than one person signs as Borrower, each is jointly and severally liable to Lender for the whole Loan.

2. REPAYMENT
{{#if schedule=monthly}}Borrower will pay {{months}} monthly installments of {{paymentAmount}} each, on the same day of each month beginning {{firstPayment}}, and will pay everything still owing on {{dueDate}} (the "Maturity Date").{{else}}Borrower will pay the full principal{{#if rate}} and accrued interest{{/if}} in one payment on {{dueDate}} (the "Maturity Date").{{/if}} Payments are made by check or bank transfer to Lender at the address above, or as Lender later directs in writing. If a due date falls on a Saturday, Sunday or legal holiday, the payment is due on the next business day. Each payment is applied first to costs and late fees, then {{#if rate}}to interest, then {{/if}}to principal. {{#if prepay}}Borrower may pay all or part of the balance early at any time, without bonus or penalty, while not in default.{{else}}Early payment requires Lender's written consent.{{/if}}

3. LATE PAYMENT AND DEFAULT
{{#if lateFee}}If a payment is received more than 15 days after its due date, Borrower will pay a one-time late fee of {{lateFeeAmount}} for that payment, but never more than the law allows. {{/if}}Each of the following is a default: (a) a payment is not made within {{graceDays|day}} after Lender gives written notice that it is past due; (b) the whole balance is not paid on the Maturity Date; (c) a Borrower becomes insolvent or files for bankruptcy; or (d) a Borrower gives Lender false information in connection with this agreement{{#if secured}}; or (e) the collateral is lost, damaged beyond use, or transferred without Lender's written consent{{/if}}. On default, Lender may declare the whole unpaid balance due immediately by written notice to Borrower.

{{#if secured}}4. SECURITY
To secure the Loan, Borrower grants Lender a security interest in: {{collateral}}, and authorizes Lender to file financing statements. Borrower will keep the collateral in good repair, insured against loss where that is reasonable, and free of other liens, and will not sell or move it without Lender's written consent. A mortgage or deed of trust on real property needs a separate recorded document, and a lien on a titled vehicle or boat must be noted on its title. If Borrower defaults, Lender may use the rights the law gives a secured lender.

{{/if}}5. COSTS
If Borrower defaults, Borrower pays Lender's reasonable costs of collection, including attorney's fees actually incurred, to the extent the law allows. Those costs are added to the balance and are due when Lender asks for them. Borrower waives presentment for payment, notice of non-payment, protest and notice of protest.

6. BORROWER'S STATEMENTS
Each Borrower states that all information given to Lender in connection with this agreement is true and complete, and that signing this agreement and repaying the Loan does not break any other agreement or law that binds the Borrower.

{{#if extraClauses}}7. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}8. GENERAL
This agreement binds and benefits the parties' heirs, executors, successors and permitted assigns. Lender may transfer this agreement and its rights; Borrower may not transfer its rights or duties without Lender's written consent. Delay or leniency by Lender is not a waiver of any right. It is the whole agreement of the parties and may be changed only in writing signed by Lender and Borrower. Notices must be in writing and sent to the parties' addresses in this agreement or to a new address given in writing. If a term cannot be enforced, a court may narrow it as far as needed and the rest stays in force. Headings are for convenience only, and the singular includes the plural. This agreement may be signed in counterparts, including electronically, and is governed by the laws of the State of {{state}}.

LENDER: {{lender}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

{{#list borrowers}}BORROWER: {{name}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

{{/list}}{{#if notary}}[page break]
NOTARY ACKNOWLEDGMENT — LENDER
State of ______________, County of ______________
On ______________, before me, the undersigned notary public, personally appeared {{lender}} (or, if a company, the authorized person who signed for it), known to me or satisfactorily proven to be the person who signed this agreement, and acknowledged that they signed it voluntarily for the purposes stated in it.
Notary public signature and seal: ______________________________
Printed name: ______________________________
My commission expires: ______________

[page break]
NOTARY ACKNOWLEDGMENT — BORROWER
State of ______________, County of ______________
On ______________, before me, the undersigned notary public, personally appeared the borrower or borrowers who signed this agreement (or, for a company, the authorized person who signed for it), known to me or satisfactorily proven to be the persons who signed it, and acknowledged that they signed it voluntarily for the purposes stated in it.
Notary public signature and seal: ______________________________
Printed name: ______________________________
My commission expires: ______________{{/if}}`,
  },
  {
    key: "letter_of_intent", title: "Letter of Intent to Buy a Business", category: BUSINESS,
    description: "A short, non-binding letter that records the basic terms before a purchase agreement is written — the business, the assets, the price, the target closing date and what each side expects.",
    reviewNote: "A letter of intent is meant to be non-binding on the sale itself: only the purchase agreement, once signed, binds the parties. Two optional parts, confidentiality and an exclusive negotiating period, DO bind the parties if you choose them (so do the general terms, such as each side paying its own costs) — an attorney should confirm the wording. The price and terms here are expectations; the purchase agreement can change them. Licenses (tobacco, alcohol, lottery, SNAP/EBT, health) do not transfer to a buyer and the buyer applies in its own name — for example a Maryland lottery license ends when ownership changes (COMAR 36.02.03.15) — so plan the licensing steps early. If the business sells goods from stock, Maryland's bulk-transfer rules (Commercial Law Title 6 Subtitle 1; Tax-General §11-505) require notice to the Comptroller and the creditors at least 10 days before the buyer takes possession or pays, and the landlord's consent to a lease assignment should be planned early too. Improved using a LawDepot-style sample; this version also states that neither side must continue the talks, that the buyer's duty to buy would depend on a satisfactory review of the business, and that the confidentiality promise survives the letter.",
    steps: [
      { title: "Parties and business", questions: [text("purchaser", "Purchaser (buyer)", { required: true }), text("purchaserAddress", "Purchaser's address"), text("seller", "Seller", { required: true }), text("sellerAddress", "Seller's address"), yesno("sellerCompany", "The Seller is a company (corporation or LLC)"), text("businessName", "Business name", { required: true }), text("businessAddress", "Business address", { required: true }), text("businessKind", "What the business does", { required: true, placeholder: "e.g. Tobacco store" }), effective(), state()] },
      { title: "The deal", questions: [
        area("assets", "Assets to be sold", { required: true, placeholder: "e.g. Equipment and fixtures, inventory, goodwill and the business name, telephone numbers" }),
        money("price", "Proposed price", { required: true }), date("closingDate", "Target closing date", { required: true }), money("deposit", "Deposit the Purchaser expects to pay when the purchase agreement is signed (optional)"),
        pick("inventory", "Inventory (stock)", [["included", "Included in the price"], ["atcost", "Counted on closing day and paid for separately at cost"]], { required: true, default: "atcost" }),
        yesno("leaseTransfer", "The Purchaser will take over the Seller's lease of the premises", { default: true }), text("landlord", "Landlord", { showIf: { id: "leaseTransfer", equals: true } }),
        area("licenses", "Licenses and permits the Purchaser will apply for in its own name", { placeholder: "e.g. Tobacco license, lottery agent, SNAP/EBT, health permit, sales tax registration" }),
        yesno("nonCompete", "The Seller will agree not to open a competing business nearby", { default: true }), num("noCompeteYears", "For how many years", { showIf: { id: "nonCompete", equals: true }, default: "3", required: true }), num("noCompeteMiles", "Within how many miles", { showIf: { id: "nonCompete", equals: true }, default: "3", required: true }),
      ] },
      { title: "Binding parts and expiry", questions: [
        yesno("confidential", "Both sides must keep the talks confidential (this part is binding)", { default: true }),
        yesno("exclusive", "The Seller will not negotiate the sale with anyone else for a set time (this part is binding)", { default: false }), num("exclusiveDays", "Number of days", { showIf: { id: "exclusive", equals: true }, default: "30", required: true }),
        date("expiresOn", "This letter expires if no purchase agreement is signed by (optional)"),
      ] },
    ],
    body: `LETTER OF INTENT

Date: {{effectiveDate}}

This letter of intent is between {{purchaser}}{{#if purchaserAddress}}, {{purchaserAddress}},{{/if}} ("Purchaser") and {{seller}}{{#if sellerAddress}}, {{sellerAddress}},{{/if}} ("Seller").

1. BACKGROUND
The Seller {{#if sellerCompany}}is a company that {{/if}}carries on the business of {{businessKind}} under the name {{businessName}} at {{businessAddress}} (the "Business"). The Seller owns and wishes to sell certain assets of the Business (the "Assets") to the Purchaser, and the Purchaser wishes to buy them. This letter sets out the basic terms the parties expect to use in a future business purchase agreement. The terms are not complete; others may be added, and these may be changed or dropped.

2. NOT A BINDING AGREEMENT
Except for the sections marked as binding and the section on general terms, this letter does not create a binding agreement and cannot be enforced. Only the future purchase agreement, once signed by both parties, will bind them, and its terms replace the terms of this letter. Neither party has to continue the talks or sign a purchase agreement. {{#if exclusive}}Subject to the exclusive negotiating period below, the{{else}}The{{/if}} parties are not prevented from negotiating with other people about the same subject.

3. THE ASSETS
The Assets are: {{assets}}. The sale will not include cash, bank accounts, accounts receivable, tax refunds, lottery funds or the Seller's personal items. This will be a sale of assets only: the Seller's own company, tax identification numbers and registrations stay with the Seller.

4. PRICE AND CLOSING
The Purchaser expects to pay {{price}} for the Assets{{#if deposit}}, including a deposit of {{deposit}} paid when the purchase agreement is signed{{/if}}, with closing on or about {{closingDate}}. {{#if inventory=included}}Inventory on hand at closing would be included in the price.{{else}}Inventory on hand would be counted on closing day and paid for separately at cost.{{/if}}

5. EXPECTED TERMS
The parties expect the purchase agreement to include the Seller's usual statements, including that at closing the Assets are free of liens, claims and rights of others, except those paid off from the price at closing, and that the Purchaser may decline to close if the Seller's statements are not true on the closing date.{{#if leaseTransfer}} The sale would depend on the landlord{{#if landlord}}, {{landlord}},{{/if}} consenting in writing to assign the lease to the Purchaser.{{/if}} The Purchaser will apply, in its own name, for the licenses and permits it needs to run the Business{{#if licenses}}, including: {{licenses}}{{/if}}. The Purchaser's duty to buy would also depend on a satisfactory review of the Business's books, records, lease, licenses and debts. The parties will follow Maryland's bulk-transfer notice rules (including the notice to the Comptroller and any tax holdback they require) and will plan the licensing steps early, because licenses do not transfer and the Purchaser's own licenses may take time to issue.{{#if nonCompete}} The Seller would agree not to run or work for a competing business within {{noCompeteMiles|mile}} of the Business for {{noCompeteYears|year}} after closing.{{/if}}

{{#if confidential}}6. CONFIDENTIALITY (BINDING)
Each party will keep confidential the existence and terms of this letter and everything it learns about the other party or the Business during the talks that is not public, will use it only to evaluate and carry out the proposed sale, and may share it only with its advisers who need it and agree to the same duty. If no sale happens, each party returns or destroys the other's papers on request. This duty continues after this letter ends or expires.

{{/if}}{{#if exclusive}}7. EXCLUSIVE NEGOTIATING PERIOD (BINDING)
For {{exclusiveDays|day}} after both parties sign this letter, the Seller will not offer the Business or the Assets for sale to anyone else, negotiate their sale with anyone else, or accept another offer for them.

{{/if}}8. GENERAL
This letter is governed by the laws of the State of {{state}}. {{#if expiresOn}}This letter ends on {{expiresOn}} if the parties have not signed a purchase agreement by then. {{/if}}Each party pays its own costs of the talks and of this letter. It may be signed in counterparts, including electronically. Each person who signs for a company states that he or she is authorized to do so.

PURCHASER: {{purchaser}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

SELLER: {{seller}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________`,
  },
  {
    key: "sales_agreement", title: "Sales Agreement (Goods)", category: BUSINESS,
    description: "A seller sells goods — equipment, stock, vehicles or other items — to a buyer: price and tax, payment, delivery, risk of loss, warranties, title, inspection, claims and remedies.",
    reviewNote: "This is for selling goods between businesses or private parties. If the buyer is a consumer buying for personal, family or household use, switch on the consumer question: Maryland law (Commercial Law §2-316.1) makes any language that tries to exclude the implied warranties or limit the consumer's remedies for them unenforceable (a narrow exception for some older, high-mileage titled vehicles sold with the State's prescribed notice is NOT handled by this form), so for consumer sales the 'as is' option and the refund-only limit are not used. For sales between businesses the form excludes the implied warranties in capital letters and names merchantability, as Commercial Law §2-316 requires; an attorney should confirm this for the deal, and a limit on remedies can fail if it leaves the buyer with no real remedy (§2-719). A vehicle, boat or other titled item needs its own signed title transfer, and the buyer normally pays the titling tax and fees to the Motor Vehicle Administration. For selling a whole business use the Sale of a Business Agreement. Sales tax: Maryland generally taxes sales of goods; the buyer pays it unless it has a valid exemption certificate. Written under the Maryland Uniform Commercial Code (Commercial Law Title 2) and checked against a LawDepot-style sample; its clause that limits the buyer's only remedy to the price and its one-sided cancellation right are options here.",
    steps: [
      { title: "Parties and goods", questions: [text("seller", "Seller", { required: true }), text("sellerAddress", "Seller's address", { required: true }), text("buyer", "Buyer", { prefill: "clientName", required: true }), text("buyerAddress", "Buyer's address", { prefill: "clientAddress", required: true }), area("goods", "The goods being sold", { required: true, placeholder: "e.g. Two refrigerated display coolers, serial numbers ..., and one cash register" }), effective(), state()] },
      { title: "Price, payment and delivery", questions: [
        money("price", "Price", { required: true }),
        pick("tax", "Sales tax", [["buyer", "The Buyer pays any sales tax on top of the price"], ["included", "The price already includes sales tax"], ["exempt", "The Buyer gives a valid exemption certificate — no tax is charged"]], { required: true, default: "buyer" }),
        pick("payment", "Payment", [["delivery", "All at delivery"], ["advance", "All before delivery"], ["deposit", "A deposit now and the rest at delivery"]], { required: true, default: "delivery" }), money("deposit", "Deposit", { showIf: { id: "payment", equals: "deposit" }, required: true }),
        pick("delivery", "Delivery", [["pickup", "The Buyer picks the goods up"], ["seller", "The Seller delivers the goods"], ["carrier", "The Seller ships the goods by carrier"]], { required: true, default: "pickup" }), text("deliveryPlace", "Place of pickup or delivery", { required: true }), date("deliveryDate", "Delivery date (optional)"),
        pick("freight", "Shipping cost", [["buyer", "The Buyer pays shipping"], ["seller", "The Seller pays shipping"]], { showIf: { id: "delivery", equals: "carrier" }, default: "buyer" }),
      ] },
      { title: "Warranties and risk", questions: [
        yesno("consumerSale", "The Buyer is buying for personal, family or household use (a consumer sale)", { default: false, help: "If yes, the document keeps all of the Buyer's legal warranties and remedies, and the 'as is' choice and the refund-only limit are not used." }),
        pick("warranty", "Condition of the goods", [["asis", "Sold 'as is' — no promise about condition"], ["described", "The Seller promises the goods match this description and belong to the Seller free of liens"]], { required: true, default: "described", help: "Not used for a consumer sale — a consumer keeps the legal warranties." }),
        pick("title", "When ownership passes to the Buyer", [["delivery", "On delivery"], ["payment", "When the Buyer has paid in full"]], { required: true, default: "delivery" }),
        yesno("securityInterest", "The Seller keeps a security interest in the goods until paid in full", { default: false }),
        num("claimDays", "Days after delivery to report a problem", { default: "10", required: true }),
        yesno("limitRemedy", "The Buyer's only remedy for a defect is a refund of the price (plus shipping paid)", { default: false, help: "Not used for a consumer sale. Between businesses, a court may ignore the limit if it leaves the Buyer without a real remedy." }),
        area("extraClauses", "Any additional terms (optional)"),
      ] },
    ],
    body: `SALES AGREEMENT

This agreement is made on {{effectiveDate}} between {{seller}}, {{sellerAddress}} ("Seller") and {{buyer}}, {{buyerAddress}} ("Buyer").

1. THE GOODS
The Seller sells and the Buyer buys the following (the "Goods"): {{goods}}.

2. PRICE AND TAX
The price is {{price}}. {{#if tax=buyer}}The Buyer also pays any sales, use, excise or similar tax on the sale, unless it gives the Seller a tax exemption certificate acceptable to the taxing authority.{{/if}}{{#if tax=included}}The price includes sales tax. If the Buyer gives the Seller a valid tax exemption certificate, the tax is taken off the price.{{/if}}{{#if tax=exempt}}The Buyer has given, or will give before delivery, a valid tax exemption certificate acceptable to the taxing authority, and no sales tax is charged. If the certificate is not accepted, the Buyer pays the tax.{{/if}}

3. PAYMENT
{{#if payment=delivery}}The Buyer pays the full price when it receives the Goods, or when the Seller hands over any title document or signed bill of sale for them, whichever is first.{{/if}}{{#if payment=advance}}The Buyer pays the full price before delivery, and the Seller delivers once it has been paid.{{/if}}{{#if payment=deposit}}The Buyer pays a deposit of {{deposit}} when this agreement is signed and the rest of the price when it receives the Goods, or when the Seller hands over any title document or signed bill of sale, whichever is first.{{/if}}

4. DELIVERY
{{#if delivery=pickup}}The Buyer will pick up the Goods at {{deliveryPlace}}{{#if deliveryDate}} on {{deliveryDate}}{{/if}}, and the Goods are received by the Buyer when they are loaded.{{/if}}{{#if delivery=seller}}The Seller will deliver the Goods to {{deliveryPlace}}{{#if deliveryDate}} on {{deliveryDate}}{{/if}}, and the Goods are received by the Buyer when they are delivered there.{{/if}}{{#if delivery=carrier}}The Seller will ship the Goods by carrier to {{deliveryPlace}}{{#if deliveryDate}} to arrive by {{deliveryDate}}{{/if}}, and the Goods are received by the Buyer when they are delivered there. {{#if freight=seller}}The Seller pays the shipping cost.{{else}}The Buyer pays the shipping cost.{{/if}}{{/if}}

5. RISK OF LOSS AND INSURANCE
The risk of loss of or damage to the Goods passes to the Buyer {{#if delivery=carrier}}when the Seller hands them to the carrier{{else}}when the Buyer receives them{{/if}}. Until the price is paid in full the Buyer, at its own cost, keeps the Goods insured for the benefit of both parties from the time the risk passes.

6. CONDITION AND WARRANTY
{{#if consumerSale}}The Buyer is buying the Goods for personal, family or household use. The Seller promises that the Goods match the description in this agreement, that the Seller owns them and that they are free of liens and claims of others. Nothing in this agreement excludes or limits any warranty or remedy that Maryland law gives a consumer, including the implied warranties of merchantability and of fitness for a particular purpose where they apply.{{else}}{{#if warranty=asis}}THE GOODS ARE SOLD "AS IS". THE SELLER MAKES NO WARRANTY, EXPRESS OR IMPLIED, INCLUDING ANY IMPLIED WARRANTY OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. The Seller states that it owns the Goods and has the right to sell them. This does not affect any manufacturer's warranty that passes with the Goods. The Buyer has had the chance to inspect the Goods or have them inspected and accepts them in their present condition.{{else}}The Seller promises that the Goods match the description in this agreement, that the Seller owns them, and that they are free of liens and claims of others. APART FROM THAT PROMISE AND ANY MANUFACTURER'S WARRANTY THAT PASSES WITH THE GOODS, THE SELLER MAKES NO WARRANTY, EXPRESS OR IMPLIED, INCLUDING ANY IMPLIED WARRANTY OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. The Buyer has relied on its own inspection and not on any statement about how the Goods will perform.{{/if}}{{/if}}

7. TITLE
{{#if title=delivery}}Ownership of the Goods passes to the Buyer on delivery.{{else}}Ownership of the Goods passes to the Buyer when the Buyer has paid the full price.{{/if}} The Seller will give the Buyer any document of title or signed bill of sale needed to show the transfer. For a vehicle, trailer, boat or other titled item, the Seller signs over the title at delivery and the Buyer pays the title, registration and excise taxes and fees.{{#if securityInterest}} The Seller keeps a security interest in the Goods until the price is paid in full and may file the papers the law requires to protect it.{{/if}}

8. INSPECTION AND CLAIMS
The Buyer inspects the Goods when they are delivered. If the Buyer does not tell the Seller in writing about a problem, with details, within {{claimDays|day}} after delivery, the Buyer is treated as having accepted the Goods, except for defects that could not have been found by a reasonable inspection. A refund does not include the cost of delivery, installation or removal, which the Buyer bears.

9. DELAY AND FAILURE TO DELIVER
The Seller is not liable for delay or failure to deliver caused by events outside its control, such as labor disputes, shortages of transport or material, fire or accident. If delivery is prevented for more than one month after the date of this agreement, the Seller may end this agreement by written notice with a full refund of everything the Buyer has paid. In every other case, if the Seller does not deliver on time, the Buyer may give written notice, and if the failure is not fixed within 7 days after the notice is received, the Buyer may end this agreement and receive a full refund.

10. REMEDIES AND CANCELLATION
{{#if limitRemedy}}{{#if !consumerSale}}The Buyer's only remedy for defective Goods or any other cause of loss is a refund of the price of the Goods concerned, plus any shipping charges the Buyer actually paid, to the extent the law allows. {{/if}}{{/if}}The Seller may cancel this agreement if the Buyer does not pay when due or becomes insolvent or bankrupt, and in that case the Seller keeps any deposit only to the extent of its actual loss.

{{#if extraClauses}}11. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}12. GENERAL
This agreement is the parties' whole agreement and may be changed only in writing signed by both. The Buyer may not assign it without the Seller's written consent. It binds the parties' heirs, successors and permitted assigns, and is governed by the laws of the State of {{state}}, including the Maryland Uniform Commercial Code; the courts of that State may settle any dispute. Notices must be in writing and delivered by hand or sent by registered or certified mail to the addresses above; mailed notice is treated as received on the third business day after mailing. Time is of the essence. If a term cannot be enforced, the rest stays in force. {{#if !consumerSale}}The Buyer states that it has relied on its own inspection and not on any promise not written here. {{/if}}This agreement may be signed in counterparts, including electronically.

SELLER: {{seller}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

BUYER: {{buyer}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________`,
  },
  {
    key: "termination_agreement", title: "Contract Termination Agreement", category: LENDING,
    description: "Two parties agree to end a contract they signed — when it ends, what is still owed or returned, a mutual release and what continues. For a lease use the Lease Termination Agreement.",
    reviewNote: "A mutual release gives up claims, so make sure everything that is owed is settled first and no claim that you want to keep is covered. This agreement ends only the contract named in it; it does not cancel a government license, a lease with a third party or a registration — those need their own steps. If someone guaranteed the contract, name the guarantor in the optional question: the guarantor then signs and the guaranty ends with the contract. If a lien, security interest or public filing was made for the contract, the agreement requires its holder to release it or file a termination within 20 days after signing and payment (a secured party can also be required to file a termination once nothing is owed — have an attorney confirm the steps for this contract). For ending a home or store lease use the Lease Termination Agreement, and for cancelling a sale use the Termination of Purchase Agreement. Improved using a LawDepot-style sample.",
    steps: [
      { title: "Parties and contract", questions: [text("partyA", "First party", { required: true }), text("partyAAddress", "First party's address"), text("partyB", "Second party", { required: true }), text("partyBAddress", "Second party's address"), text("contract", "The contract being ended", { required: true, placeholder: "e.g. The agreement to lease 1500 N Washington St, Baltimore MD 21213" }), date("contractDate", "Date of that contract", { required: true }), text("reason", "Reason (optional)"), effective(), state()] },
      { title: "How it ends", questions: [
        pick("endsOn", "The contract ends", [["signing", "When both parties sign this agreement"], ["date", "On a date set here"]], { required: true, default: "signing" }), date("endDate", "End date", { showIf: { id: "endsOn", equals: "date" }, required: true }),
        pick("money", "Money and property", [["none", "Nothing more is owed by either party"], ["payment", "One party makes a settlement payment"]], { required: true, default: "none" }),
        text("payer", "Who pays", { showIf: { id: "money", equals: "payment" }, required: true }), money("amount", "Amount", { showIf: { id: "money", equals: "payment" }, required: true }), date("payBy", "Pay by", { showIf: { id: "money", equals: "payment" }, required: true }),
        area("returnItems", "Property, keys, papers or equipment to be returned (optional)", { placeholder: "e.g. Keys, signs and equipment returned by June 30" }),
        yesno("release", "Each party releases the other from claims about the contract", { default: true }),
        text("survives", "Duties that continue after the contract ends (optional)", { placeholder: "e.g. Confidentiality and the non-competition promise" }),
        text("guarantor", "Guarantor of the contract (optional)", { help: "If someone guaranteed the contract, name them: they sign below and their guaranty ends with the contract (except for any payment this agreement requires)." }),
        yesno("confidential", "Keep the terms of this agreement confidential", { default: true }),
      ] },
    ],
    body: `CONTRACT TERMINATION AGREEMENT

Date: {{effectiveDate}}

This agreement is between {{partyA}}{{#if partyAAddress}}, {{partyAAddress}},{{/if}} and {{partyB}}{{#if partyBAddress}}, {{partyBAddress}},{{/if}} (together the "Parties").

1. BACKGROUND
The Parties are bound by the following contract (the "Contract") dated {{contractDate}}: {{contract}}. The Parties wish to end the Contract and settle what each owes the other under it{{#if reason}}, because {{reason}}{{/if}}.

2. TERMINATION
The Parties end and cancel the Contract {{#if endsOn=date}}effective {{endDate}}{{else}}effective when both of them have signed this agreement{{/if}}. After that date neither Party has any further duty under the Contract, except as this agreement says.

3. MONEY AND PROPERTY
{{#if money=none}}The Parties agree that everything each has given and received under the Contract is fair and settles the matter, and that no further money or other payment is owed by either of them under the Contract.{{else}}{{payer}} will pay {{amount}} on or before {{payBy}} as full settlement of everything owed under the Contract. Apart from that payment, no further money is owed by either Party under the Contract.{{/if}} If any lien, security interest or public filing was made because of the Contract, the Party that holds it will release it or file a termination of it within 20 days after this agreement is signed and any payment it requires has been made.{{#if returnItems}} Property and papers to be returned: {{returnItems}}{{/if}}

{{#if release}}4. RELEASE
Each Party releases the other, and its heirs, successors and assigns, from all claims, demands and liabilities, known or unknown, that it had in the past, has now or may later have arising out of the Contract, except for the duties in this agreement and any claim based on fraud or on a payment that this agreement requires. Each Party states that it has not transferred to anyone else any claim it is releasing.

{{/if}}{{#if survives}}5. DUTIES THAT CONTINUE
These duties continue after the Contract ends: {{survives}}.

{{/if}}{{#if confidential}}6. CONFIDENTIALITY
The Parties will keep the terms of this agreement and of the Contract, and any financial or business information about each other that is not already public, confidential, except where the law requires disclosure or a Party needs to tell its advisers, lenders or tax authorities.

{{/if}}{{#if guarantor}}7. GUARANTOR
{{guarantor}} signs this agreement to confirm the termination of the Contract. The guaranty of the Contract by {{guarantor}} ends with the Contract, except for any payment this agreement requires.

{{/if}}7. GENERAL
This is the Parties' whole agreement on its subject and may be changed only in writing signed by both. It binds their heirs, successors and permitted assigns and is governed by the laws of the State of {{state}}, whose courts may settle any dispute about it. Notices must be in writing and are treated as delivered when handed over or seven days after being mailed with postage paid to the address above. If a term cannot be enforced, the rest stays in force. This agreement may be signed in counterparts, including electronically. Each person who signs for a company states that he or she is authorized to do so.

{{partyA}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

{{partyB}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________
{{#if guarantor}}
GUARANTOR: {{guarantor}}
Signature: ______________________________   Date: ______________
{{/if}}`,
  },
  {
    key: "termination_of_purchase", title: "Termination of Purchase Agreement", category: BUSINESS,
    description: "A seller and a buyer cancel a sale they agreed to — a bill of sale or purchase agreement — and settle the refund, the return of what was handed over and a mutual release.",
    reviewNote: "A cancellation should say what happens to the money and the property, which the simple form often leaves out — fill in the refund and return sections. The document always includes a section that undoes what was done for the sale (license applications, lease assignment, bulk-transfer notices to the Comptroller and creditors, financing statements and liens, vehicle titles, any sales tax paid); use the optional box for anything specific to this sale. If any money is kept, state why — a deposit the seller keeps should be a fair amount for the seller's loss, not a penalty. If a broker, attorney or escrow agent holds the deposit, name them: a broker usually cannot release a deposit without both parties' written agreement, which this document provides. The release does not cover fraud. An attorney should confirm the release is right for this sale. For ending other contracts use the Contract Termination Agreement. Improved using a LawDepot-style sample.",
    steps: [
      { title: "The sale being cancelled", questions: [text("seller", "Seller", { required: true }), text("sellerAddress", "Seller's address"), text("buyer", "Buyer", { required: true }), text("buyerAddress", "Buyer's address"), text("agreementName", "Document being cancelled", { required: true, default: "Bill of Sale", placeholder: "e.g. Bill of Sale, Purchase Agreement" }), date("agreementDate", "Date of that document", { required: true }), area("itemSold", "What was to be sold", { required: true, placeholder: "e.g. The equipment, inventory and goodwill of the store at 604 Frenchtown Rd" }), text("reason", "Reason for cancelling (optional)", { placeholder: "e.g. The Buyer could not obtain the landlord's consent to the lease" }), effective(), state()] },
      { title: "Money and property", questions: [
        pick("money", "Money already paid", [["refund", "The Seller refunds what the Buyer paid"], ["keep", "The Seller keeps part or all of what was paid"], ["none", "Nothing was paid"]], { required: true, default: "refund" }),
        money("paidAmount", "Amount the Buyer paid (leave empty if nothing was paid)"), text("depositHolder", "Money held by an escrow agent, broker or attorney (optional)", { help: "If someone other than the Seller holds the Buyer's money, name them: they are told below to pay it out as this document says." }), money("refundAmount", "Amount refunded", { showIf: { id: "money", equals: "refund" }, required: true }), date("refundBy", "Refund paid by", { showIf: { id: "money", equals: "refund" }, required: true }),
        money("keepAmount", "Amount the Seller keeps", { showIf: { id: "money", equals: "keep" }, required: true }), text("keepReason", "Why the Seller keeps it", { showIf: { id: "money", equals: "keep" }, required: true }),
        yesno("handedOver", "The Buyer received keys, goods or papers that must be returned"), area("returnItems", "What is returned", { showIf: { id: "handedOver", equals: true }, required: true }), date("returnBy", "Returned by", { showIf: { id: "handedOver", equals: true }, required: true }),
        area("undoSteps", "Anything else that must be undone (optional)", { placeholder: "e.g. The Buyer withdraws its license applications; the Seller cancels the lease assignment request" }),
        yesno("confidential", "Keep the terms of this agreement confidential", { default: true }),
      ] },
    ],
    body: `TERMINATION OF PURCHASE AGREEMENT

Date: {{effectiveDate}}

This agreement is between {{seller}}{{#if sellerAddress}}, {{sellerAddress}},{{/if}} ("Seller") and {{buyer}}{{#if buyerAddress}}, {{buyerAddress}},{{/if}} ("Buyer"), together the "Parties".

1. BACKGROUND
The Seller and the Buyer signed a {{agreementName}} dated {{agreementDate}} (the "Agreement") under which the Seller agreed to sell and the Buyer agreed to buy: {{itemSold}}. The Parties now wish to cancel the Agreement{{#if reason}} because {{reason}}{{/if}}.

2. TERMINATION
The Parties terminate and cancel the Agreement effective when both of them have signed this document. Neither Party has any further duty under the Agreement except as this document says, and nothing more will be transferred under it. Anything already handed over is returned as this document says.

3. MONEY
{{#if money=refund}}{{#if paidAmount}}The Buyer paid the Seller {{paidAmount}} under the Agreement. {{/if}}The Seller will refund {{refundAmount}} to the Buyer on or before {{refundBy}}, by check or bank transfer.{{/if}}{{#if money=keep}}{{#if paidAmount}}The Buyer paid the Seller {{paidAmount}} under the Agreement. {{/if}}The Seller keeps {{keepAmount}} because {{keepReason}}{{#if paidAmount}}, and promptly refunds any balance of what the Buyer paid{{/if}}. The Parties agree that this amount is fair for the Seller's loss and is the Seller's only claim about the cancelled sale.{{/if}}{{#if money=none}}The Buyer has paid the Seller nothing under the Agreement, and no payment is owed by either Party.{{/if}} Apart from this section, no further money is owed by either Party under the Agreement.{{#if depositHolder}} The Parties jointly instruct {{depositHolder}}, who holds money paid for the sale, to pay it as this section says; this document is the written agreement of both Parties that allows it to be released.{{/if}}

{{#if handedOver}}4. RETURN OF PROPERTY
The Buyer will return the following to the Seller on or before {{returnBy}}, in the condition in which it was received, normal wear excepted: {{returnItems}}. The Seller will give back any document the Buyer signed for the sale.

{{/if}}5. UNDOING THE SALE
Each Party will promptly sign what is needed to undo the steps taken for the sale and will tell any agency, landlord, creditor or other person that was told of it. Where they apply, this includes withdrawing license, permit or registration applications; cancelling a request for the landlord's consent or an assignment of the lease (and returning any lease deposit or key); telling the Comptroller of Maryland and the Seller's creditors in writing that a bulk-transfer sale will not take place; ending any financing statement, lien or security interest filed for the sale; returning any signed-over vehicle title; and seeking a refund of any sales tax or transfer charge already paid.{{#if undoSteps}} Specifically: {{undoSteps}}{{/if}}

6. RELEASE
Each Party releases the other, and its heirs, successors and assigns, from all claims, demands and liabilities, known or unknown, that it had in the past, has now or may later have arising out of the Agreement, except for the duties in this document and any claim based on fraud. Each Party states that it has not transferred to anyone else any claim it is releasing.

{{#if confidential}}7. CONFIDENTIALITY
The Parties will keep the terms of this document and of the Agreement, and any financial or business information about each other that is not already public, confidential, except where the law requires disclosure or a Party needs to tell its advisers or tax authorities.

{{/if}}8. GENERAL
This is the Parties' whole agreement on its subject and may be changed only in writing signed by both. It binds their heirs, successors and permitted assigns and is governed by the laws of the State of {{state}}, whose courts may settle any dispute about it. If a term cannot be enforced, the rest stays in force. This document may be signed in counterparts, including electronically. Each person who signs for a company states that he or she is authorized to do so.

SELLER: {{seller}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

BUYER: {{buyer}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________`,
  },
  /* ─────────────── Batch 7: powers, sales and transfers ─────────────── */
  {
    key: "general_poa", title: "Power of Attorney", category: FAMILY,
    description: "Lets someone you trust handle your money, tax, property or business matters for you — general or limited, with or without a start condition. Follows the layout of Maryland's statutory financial power of attorney.",
    reviewNote: "Maryland (Estates and Trusts Article §17-110, checked on mgaleg.maryland.gov): the principal signs (or another person signs at the principal's express direction and in the principal's physical presence), the principal acknowledges it before a notary, and two or more adult witnesses sign in the presence of the principal and of each other; the notary may be one of the two witnesses. The statute does not say an agent cannot be a witness, but this form keeps the agent and any backup agent out of that role as a precaution. Remote or electronic signing has extra rules (a supervising Maryland attorney and a certification) that this form does not cover — sign on paper, in person. Also checked in Title 17: a power naming an agent is durable unless it says otherwise (§17-105); a photocopy or electronic copy has the same force as the original, but a court clerk may refuse to record a copy (§17-108); a spouse-agent's authority ends when a divorce, annulment or separation action is filed unless the power says otherwise (§17-112); agent duties (§17-113); the agent is unpaid unless the document provides pay (§17-114); the agent need not report unless asked and then has 30 days to answer (§17-102); a court-appointed guardian can end the power (§17-105). If the power starts only on incapacity and names nobody to decide, §17-111 lets a physician, licensed psychologist, attorney, judge or government official decide; this form instead names a physician or psychologist, or a person you name — that is your choice to make. To sell or transfer real property the power must be executed like a deed and recorded in the land records (Real Property Article §4-107) and the agent signs the deed as attorney-in-fact; a title company may insist on the Maryland statutory form. Title 17 does not cover health-care decisions or an agent's authority to sign a company's governing documents (§17-109), so the business subject here may not be enough to change an LLC operating agreement. A bank may still ask for its own form: §17-115 says other laws about financial institutions prevail, and the statute's must-accept rule and attorney's-fees penalty (§17-104) apply only to an acknowledged document substantially in the Maryland statutory form, which this layout follows but does not copy. For the IRS use Form 2848 / 8821; the Maryland Comptroller accepts only its own Form 548. Confirm with an attorney (not verified): (1) the good-faith-reliance wording for a document that is not the statutory form; (2) whether gifts should be allowed at all; (3) whether an agent may also be a witness. Have a Maryland attorney review before use.",
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
        yesno("sProfessionals", "Hire and pay professionals — accountants, attorneys, bookkeepers, care providers", { showIf: { id: "powerType", equals: "general" }, default: true }),
        yesno("sFamily", "Family support — pay living costs of me, my spouse and my dependent children", { showIf: { id: "powerType", equals: "general" }, default: false }),
        yesno("sTrust", "Move my property into a living (revocable) trust I have already created", { showIf: { id: "powerType", equals: "general" }, default: false }),
        yesno("sEstate", "Deal with trusts and estates I receive money from, including disclaiming an inheritance", { showIf: { id: "powerType", equals: "general" }, default: false }),
        yesno("sCharity", "Continue gifts to charities I have regularly supported", { showIf: { id: "powerType", equals: "general" }, default: false }),
        yesno("borrow", "The Agent may borrow money for me and give security for the loan", { showIf: { id: "powerType", equals: "general" }, default: false }),
        text("manageProperty", "A specific property the Agent manages for me (address) — optional", { showIf: { id: "powerType", equals: "general" }, placeholder: "e.g. 12 Main St, Baltimore, MD 21201" }),
        text("manageAccounts", "Specific bank accounts the Agent controls (bank and last 4 digits only) — optional", { showIf: { id: "powerType", equals: "general" }, placeholder: "e.g. Bank of America checking ending 1234" }),
        yesno("delegate", "The Agent may name someone else to carry out a specific task (the Agent stays responsible)", { showIf: { id: "powerType", equals: "general" }, default: false }),
        yesno("gifts", "The agent may make gifts from my property", { showIf: { id: "powerType", equals: "general" }, default: false }),
        pick("giftLimit", "Limit on gifts", [["annual", "Up to the federal annual gift-tax exclusion for each person each year"], ["amount", "Up to a total amount I set"]], { showIf: { id: "gifts", equals: true }, required: true, default: "annual" }),
        money("giftAmount", "Total amount of gifts allowed", { showIf: { id: "giftLimit", equals: "amount" }, required: true }),
        text("giftException", "Agent (or a person the agent must support) who may also receive gifts — leave empty for none", { showIf: { id: "gifts", equals: true }, placeholder: "e.g. my daughter, Sara Ali" }),
        yesno("paid", "The agent may be paid a reasonable fee for the work", { default: false }),
        yesno("revokePrior", "This replaces and cancels my earlier powers of attorney about the same matters", { default: false }),
        area("additional", "Special instructions or limits (optional)", { placeholder: "e.g. The Agent may not sell my home without my daughter's written approval", help: "Anything that narrows or adds to the powers above. If it conflicts with the powers above, these instructions win. Leave empty for none." }),
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
{{#if sReal}}• Real property: buy, sell, exchange, lease, mortgage and manage real property, collect rent, pay taxes and insurance, and sign deeds and settlement papers.
{{/if}}{{#if sPersonal}}• Tangible personal property: buy, sell, insure, store and manage vehicles, boats and belongings.
{{/if}}{{#if sStocks}}• Stocks, bonds and investments: buy, sell, vote and manage them and the accounts that hold them.
{{/if}}{{#if sBanks}}• Banks and financial institutions: open, close and manage accounts, deposit and withdraw money, write and endorse checks, make transfers, and use safe deposit boxes.
{{/if}}{{#if sInsurance}}• Insurance and annuities: buy, change, borrow against and cancel policies and collect benefits.
{{/if}}{{#if sClaims}}• Claims and lawsuits: start, defend and settle claims and hire lawyers.
{{/if}}{{#if sBenefits}}• Government benefits: apply for and manage Social Security, Medicare, Medicaid and other public benefits.
{{/if}}{{#if sRetirement}}• Retirement plans: contribute to, withdraw from, roll over and manage retirement accounts.
{{/if}}{{#if sTaxes}}• Taxes: prepare, sign and file returns, pay taxes, claim refunds, receive notices and deal with tax offices, to the extent the law accepts this document for that purpose; the IRS and the Maryland Comptroller may still require their own forms.
{{/if}}{{#if sBusiness}}• Business interests: run, buy, sell and manage my business interests and sign contracts for them. A company's own governing documents (such as an operating agreement) may also require that company's approval for what the Agent does.
{{/if}}{{#if sDigital}}• Digital assets: manage my online accounts, electronic records and digital property as the law allows.
{{/if}}{{#if sProfessionals}}• Professionals: hire and pay accountants, attorneys, bookkeepers, care providers and other professionals for my affairs, at reasonable pay.
{{/if}}{{#if sFamily}}• Family support: pay for the housing, food, clothing, medical care, education and other living costs of me, my spouse, my dependent children and others I am legally required to support.
{{/if}}{{#if sTrust}}• My living trust: transfer my property to the trustee of a revocable trust I have already created, if that trust exists when the transfer is made.
{{/if}}{{#if sEstate}}• Trusts and estates: act for me in any trust, estate or fund from which I may receive money, and disclaim an interest I would otherwise receive, but never in a way that sends the property to the Agent.
{{/if}}{{#if sCharity}}• Charity: continue gifts to charities I have regularly supported, in amounts that are reasonable for my means.
{{/if}}{{#if borrow}}• Borrowing: borrow money in my name from banks and other lenders and give security for the loan.
{{/if}}{{#if manageProperty}}• Specific property: manage the property at {{manageProperty}}, including collecting rent, making repairs, paying taxes, insurance and expenses, and taking lawful court action to collect unpaid rent or to remove tenants.
{{/if}}{{#if manageAccounts}}• Specific accounts: control my accounts at {{manageAccounts}}, including deposits, withdrawals, endorsing checks and getting statements.
{{/if}}{{#if !sReal}}{{#if !sPersonal}}{{#if !sStocks}}{{#if !sBanks}}{{#if !sInsurance}}{{#if !sClaims}}{{#if !sBenefits}}{{#if !sRetirement}}{{#if !sTaxes}}{{#if !sBusiness}}{{#if !sDigital}}{{#if !sProfessionals}}{{#if !sFamily}}{{#if !sTrust}}{{#if !sEstate}}{{#if !sCharity}}{{#if !manageProperty}}{{#if !manageAccounts}}• No subject has been selected, so this document gives the Agent no power until it is corrected and signed again.
{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{else}}The Agent may act for me only in these matters: {{limitedPowers}}{{/if}}

3. GIFTS AND COMPENSATION
{{#if powerType=general}}{{#if gifts}}The Agent may make gifts from my property, {{#if giftLimit=annual}}up to the federal annual gift-tax exclusion for each person each year{{else}}up to {{giftAmount}} in total{{/if}}. {{#if giftException}}Gifts to the Agent, or to anyone the Agent is legally required to support, are not allowed except to {{giftException}}.{{else}}Gifts to the Agent, or to anyone the Agent is legally required to support, are not allowed.{{/if}}{{else}}The Agent may not make gifts from my property.{{/if}}{{else}}The Agent may not make gifts from my property.{{/if}} {{#if paid}}The Agent may be paid a reasonable fee for the work, and repaid reasonable expenses.{{else}}The Agent will not be paid but may be repaid reasonable expenses.{{/if}}

4. WHEN IT STARTS AND HOW LONG IT LASTS
{{#if startsWhen=now}}This power starts when I sign it.{{else}}This power starts only when {{#if certifier}}{{certifier}} (or, if that person cannot or will not act, a physician or licensed psychologist){{else}}a physician or licensed psychologist{{/if}} confirms in writing that I cannot manage my own affairs.{{/if}} {{#if startsWhen=incapacity}}It is a durable power of attorney: once it starts, it stays in effect while I am unable to manage my affairs.{{else}}{{#if durable}}It is a durable power of attorney: it stays in effect if I later become disabled or unable to manage my affairs.{{else}}It ends if I become disabled or unable to manage my affairs.{{/if}}{{/if}} {{#if endDate}}It ends on {{endDate}}, or earlier if I revoke it in writing or I die.{{else}}It lasts until I revoke it in writing or I die.{{/if}} It also ends if the Agent dies, becomes unable to act or resigns{{#if hasSuccessor}} and my backup agent cannot or will not act{{else}} (I have named no backup agent){{/if}}. If a court appoints a guardian for my property, the Agent must account to the guardian, and the guardian may change or end this power.

5. THE AGENT'S DUTIES
The Agent must act in good faith and only within the powers given here; act according to my reasonable expectations if they are known, and otherwise in my best interest; act loyally for my benefit and avoid conflicts of interest; act with care, competence and diligence; keep my property separate from the Agent's own; keep records of every transaction; and, within 30 days after a written request, give me, my guardian or my personal representative an account of what has been done. The Agent is not liable if the value of my property goes down without a breach of these duties.

6. OTHER TERMS
This document does not give the Agent power to make health-care decisions. {{#if revokePrior}}This document replaces and cancels my earlier powers of attorney about the same matters.{{else}}This document does not cancel any other power of attorney I have signed.{{/if}} When signing for me, the Agent must sign my name, followed by "by" and the Agent's own name, as attorney-in-fact. The Agent may sign a bank's or other institution's own power-of-attorney, signature-card or agent-certification form in my name, but only for the powers given here. {{#if powerType=limited}}If the Agent will sell or transfer real property for me, this document must be recorded in the land records where the deed is recorded, and the Agent must sign the deed as my attorney-in-fact. {{else}}{{#if sReal}}To use the real property power to sell or transfer property, this document must be recorded in the land records where the deed is recorded, and the Agent must sign the deed as my attorney-in-fact. {{/if}}{{/if}}If the Agent is my spouse, the Agent's authority also ends if an action for divorce, annulment or legal separation is filed.

6. LIMITS ON THE AGENT
The Agent may not use my property for the Agent's own benefit, except for the pay and repayment of expenses allowed above; may not name the Agent or the Agent's estate as beneficiary of any insurance policy, retirement plan or trust of mine unless the Agent is already a beneficiary; may not make, change or cancel my will; and may not mix my money with the Agent's own. {{#if delegate}}The Agent may name another person to carry out a specific task but remains responsible for that person's acts.{{else}}The Agent may not delegate the Agent's authority to anyone else, except to hire professionals as allowed above.{{/if}} The Agent will act in line with the laws of the State of {{state}}.

{{#if additional}}7. SPECIAL INSTRUCTIONS
{{additional}} If these instructions conflict with the powers above, these instructions control.

{{/if}}7. REVOCATION, COPIES AND RELIANCE
I may revoke this power at any time by written notice to the Agent and to every bank or office that has been given this document. A copy of this document is as good as the original. I ask every bank, office and person dealing with the Agent to accept this document, and I agree that a person who relies on it in good faith may keep relying on it until they receive written notice that it has ended. This document is governed by the laws of the State of {{state}}. If any part of it is held invalid, the rest stays in effect.

PRINCIPAL'S ACKNOWLEDGMENT
I have read this document and understand its nature and effect. I am an adult. I am signing it voluntarily.

PRINCIPAL: {{principal}}
Signature: ______________________________   Date: ______________

Signed for the Principal, at the Principal's direction and in the Principal's presence, by: ______________________________ (only if the Principal cannot sign)

AGENT (accepting the duties above): {{agent}}
Signature: ______________________________   Date: ______________

ATTESTATION OF WITNESSES
Each of us is an adult, and neither of us is the Agent{{#if hasSuccessor}} or the backup agent{{/if}}. The Principal declared this document to be their power of attorney and signed it (or directed another to sign it for them) in our presence. The Principal appeared to be of sound mind and under no duress, fraud or undue influence. Each of us signed in the presence of the Principal and of each other.

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
    reviewNote: "Have an attorney review this before signing. Confirm with an attorney or the tax preparer: (1) Maryland bulk-transfer rules (Commercial Law Title 6, Subtitle 1; Tax-General §§11-505 and 13-802): they apply when a major part of the inventory of a store, restaurant or similar business that sells goods from stock is sold. The buyer keeps the sworn creditor list for six months, sends the notice to the Comptroller and the creditors at least 10 days before taking possession or paying anything (so name an attorney or escrow agent to hold the deposit), and must hold back what the Comptroller claims. A buyer who skips this can be personally liable for the seller's unpaid sales and use tax; (2) sales tax: equipment, fixtures and some other items bought with the business can be taxable — confirm with the Comptroller how and when it is paid; inventory bought for resale is generally handled with a resale certificate, and goodwill is generally not taxed; (3) IRS Form 8594 and how the price is split, including any amount paid for the non-compete; (4) licenses — tobacco, alcohol, lottery, SNAP/EBT, health and sales-tax registrations do not transfer and the buyer must apply in the buyer's own name, sometimes well before closing (a lottery license ends when ownership changes — COMAR 36.02.03.15; the local liquor board must approve a new alcohol licensee); no tobacco, alcohol or lottery stock should change hands before the buyer is licensed; (5) whether the seller's promise not to compete is reasonable for this business and place, and whether the seller's owner should also be bound personally (the optional owner line does that); (6) employee, payroll and unemployment-insurance accounts; (7) vehicles need their own title transfer; (8) a deposit the seller keeps is enforceable only if it is a reasonable estimate of the seller's loss, so keep the deposit modest. Improved using a LawDepot-style sample. Not copied from it: letting the buyer operate for a while under the seller's own licenses, permits or tax registrations (a license can be used only by the person it was issued to — the optional transition clause covers ordinary service accounts only), its fixed one-mile / 3-year non-compete, and its waiver of every defense to the non-compete. The statements, conditions, as-is clause and three-year claim period are choices — have an attorney confirm them for this deal.",
    steps: [
      { title: "Parties and business", questions: [text("seller", "Seller", { required: true }), text("sellerAddress", "Seller's address"), yesno("sellerCompany", "The Seller is a company (corporation or LLC)"), text("buyer", "Buyer", { required: true }), text("buyerAddress", "Buyer's address"), text("businessName", "Business name", { required: true }), text("businessAddress", "Business address", { required: true }), text("businessKind", "What the business does", { placeholder: "e.g. Convenience store selling groceries, tobacco and lottery" }), effective(), state()] },
      { title: "Price and payment", questions: [
        money("price", "Total price", { required: true }), money("deposit", "Deposit (leave blank if none)"), date("depositDate", "Deposit is due by (leave empty if paid at signing)", { showIf: { id: "deposit", notEmpty: true } }),
        text("depositHolder", "Deposit is held in trust by", { showIf: { id: "deposit", notEmpty: true }, required: true, placeholder: "e.g. the Buyer's attorney, or a title or escrow company", help: "Do not pay the deposit directly to the Seller before the 10-day bulk-transfer notice period has ended — name an attorney or escrow agent who holds it until closing." }),
        yesno("allocate", "Show how the price is divided between equipment, inventory and goodwill"), money("allocEquipment", "Equipment", { showIf: { id: "allocate", equals: true }, required: true }), money("allocInventory", "Inventory (stock)", { showIf: { id: "allocate", equals: true }, required: true }), money("allocGoodwill", "Goodwill", { showIf: { id: "allocate", equals: true }, required: true, help: "Equipment, inventory and goodwill (plus the non-compete amount, if any) should add up to the total price. If the inventory is paid for separately at cost, enter 0 for inventory. The software does not check the total." }),
        money("allocNonCompete", "Seller's promise not to compete (only if part of the price is for it)", { showIf: { id: "allocate", equals: true }, help: "Money paid for a non-compete is reported separately on Form 8594 and is ordinary income to the Seller — ask the tax preparer." }),
        money("salesTax", "Maryland sales tax on the equipment, paid by the Buyer (optional)", { help: "Usually 6% of the equipment value; confirm with the tax preparer. Inventory bought for resale and goodwill are generally not taxed this way." }),
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
        area("licenses", "Licenses and permits the Buyer must obtain in the Buyer's own name", { placeholder: "e.g. Tobacco license, lottery agent, SNAP/EBT, health permit, alcohol license, sales tax registration" }),
        yesno("transition", "The Buyer may keep using the Seller's ordinary service accounts (phone, utilities, suppliers, payment system) for a short time"), date("transitionEnd", "Until", { showIf: { id: "transition", equals: true }, required: true }),
      ] },
      { title: "After the sale", questions: [
        yesno("nonCompete", "The Seller will not open a competing business nearby", { default: true }),
        num("noCompeteYears", "For how many years", { showIf: { id: "nonCompete", equals: true }, default: "3", required: true }),
        num("noCompeteMiles", "Within how many miles", { showIf: { id: "nonCompete", equals: true }, default: "3", required: true }),
        text("sellerOwner", "Owner of the Seller company who also promises personally (optional)", { showIf: { id: "sellerCompany", equals: true }, help: "Recommended when the Seller is a company: the owner then personally agrees not to compete and to keep the deal confidential (whichever of those two you have switched on), and signs below. Leave blank if the owner will not sign." }),
        num("helpDays", "Days the Seller will help the Buyer with the changeover", { default: "14" }),
        pick("employees", "Seller's employees", [["choose", "The Buyer decides whom to hire"], ["none", "The Buyer takes over no employee — the Seller ends all employment at closing"]], { required: true, default: "choose" }),
        yesno("asIs", "The Buyer accepts the assets 'as is', apart from the Seller's written statements", { default: true }),
        num("claimYears", "Years after closing within which a claim on the statements must be notified", { required: true, default: "3" }),
        yesno("confidential", "Both parties keep the deal confidential", { default: true }),
        yesno("mediation", "Disputes go to mediation before any lawsuit", { default: false }),
        area("extraClauses", "Any additional terms (optional)"),
      ] },
    ],
    body: `AGREEMENT FOR THE SALE OF A BUSINESS

Date: {{effectiveDate}}

This agreement is between {{seller}}{{#if sellerAddress}} of {{sellerAddress}}{{/if}} ("Seller") and {{buyer}}{{#if buyerAddress}} of {{buyerAddress}}{{/if}} ("Buyer"), together the "Parties". The Seller carries on the business described below and wishes to sell certain assets of it (the "Assets") to the Buyer, and the Buyer wishes to buy them, on these terms.

1. THE BUSINESS AND THE ASSETS
The Seller sells and the Buyer buys the business known as {{businessName}}, located at {{businessAddress}}{{#if businessKind}} ({{businessKind}}){{/if}}, together with its name, customer goodwill, telephone numbers and records, and the assets listed here: {{#if equipment}}{{equipment}}{{else}}the equipment and fixtures at the premises on the date of this agreement{{/if}}. The sale does not include cash, bank accounts, accounts receivable, tax refunds, lottery funds or the Seller's personal items. Any motor vehicle included needs its own signed title transfer, which the parties will complete. This is a sale of assets only: the Seller's own company or legal entity, tax identification numbers, bank accounts and registrations stay with the Seller, and the Buyer will run the business under the Buyer's own entity, licenses, permits and registrations.

2. PRICE AND PAYMENT
The total price is {{price}}. {{#if deposit}}A deposit of {{deposit}} counts toward the price. It is paid {{#if depositDate}}on or before {{depositDate}}{{else}}now{{/if}}{{#if depositHolder}} to {{depositHolder}}, who holds it in trust and pays it to the Seller at closing, or returns or pays it as this agreement provides{{/if}}.{{else}}No deposit is paid at signing.{{/if}} {{#if payment=closing}}The rest is paid at closing.{{else}}At closing the Buyer pays the rest except {{financedAmount}}, which the Buyer pays to the Seller in {{financedMonths}} equal monthly payment(s) after closing{{#if financedRate}}, with interest at {{financedRate}}% a year{{/if}}, under a separate signed note. The note is secured by the business's assets and inventory, may be paid early, and becomes fully due if any payment is more than 10 days late.{{#if buyerGuaranty}} The Buyer's owners personally guarantee the note.{{/if}}{{/if}} Payment at closing is made by certified check, teller's check or electronic transfer; for a transfer the Seller gives the Buyer the bank details at least 5 business days before closing.
{{#if allocate}}The price is divided among the Assets as follows: equipment {{allocEquipment}}; inventory {{allocInventory}}; goodwill {{allocGoodwill}}{{#if nonCompete}}{{#if allocNonCompete}}; the Seller's promise not to compete {{allocNonCompete}}{{/if}}{{/if}}. {{else}}The price is divided among the Assets as stated in a schedule both parties sign; if there is no signed schedule, they will divide it as their tax preparers agree. {{/if}}Both parties will use that division in their tax filings, including IRS Form 8594, and will cooperate in filing any tax elections needed to give it effect. The Buyer pays the Maryland sales tax and any other tax or charge due because of the transfer of the Assets{{#if salesTax}} (estimated at {{salesTax}} on the equipment){{/if}}, in addition to the price. If the Buyer qualifies to buy the inventory for resale without sales tax, the Buyer gives the Seller a signed Maryland resale certificate at or before closing.

3. INVENTORY
{{#if inventory=included}}The stock on hand at closing is included in the price.{{else}}The stock on hand is counted by both parties on closing day, with the count signed by both, and the Buyer pays the Seller for it, in addition to the price above, at the cost shown on the Seller's supplier invoices. Damaged, expired and unsaleable items are not counted.{{/if}} Lottery tickets, gift cards and goods held on consignment are not inventory of the Seller and are not sold.

4. CLOSING
The sale closes on {{closingDate}}, at the Seller's office or another place and time the parties agree. At closing, once the Buyer has paid what is due then, the Seller hands over the keys, the Assets and the records, in the same condition as on the date of this agreement and free of liens and claims of others; signs a bill of sale{{#if leaseTransfer}} and an assignment of the lease{{/if}} and any other transfer papers that are needed; and delivers releases of any liens on the Assets. The Buyer may search the public records for liens against the Seller and the Assets; any lien found is paid off from the closing payment or released at or before closing, at the Seller's cost. The Seller will also help with any registration or filing with a public office that the transfer needs. Rent, utilities and prepaid expenses are divided as of the closing date. The Seller bears the risk of loss until closing. The Buyer takes over the business from that time.

5. CONDITIONS TO CLOSING AND DEPOSIT
The Buyer's duty to close depends on:
{{#if leaseTransfer}}• the landlord's written consent to the lease assignment, with a landlord's statement that no rent is overdue, no lease default exists and the amount of the security deposit held;
{{/if}}• the Buyer obtaining in its own name the licenses and permits it needs to run the business;
• the bulk-transfer notice period described below having passed;
• the Seller's statements in this agreement being true in all important respects on the closing date;
• no serious damage to or change in the Assets between signing and closing; and
• the Seller handing over the papers and information the Buyer needs to carry on the business in the Seller's place.
The Seller's duty to close depends on the Buyer's statements in this agreement being true in all important respects on the closing date, on the Buyer obtaining the licenses, permits and approvals it needs for the purchase, and on the Buyer signing and delivering the note, if there is one. A party may waive a condition meant for its own benefit. If a condition is not met by the closing date through no fault of the Buyer, either party may cancel this agreement{{#if deposit}} and the deposit is returned to the Buyer within 5 days{{/if}}. {{#if deposit}}If the Buyer fails to close when the conditions are met, the Seller keeps the deposit as agreed damages; the parties agree that this is a reasonable estimate of the Seller's loss, which would be hard to calculate, and not a penalty. If the Seller fails to close, the Buyer is refunded the deposit and may claim damages.{{else}}If either party fails to close when the conditions are met, the other party may claim damages.{{/if}}

6. BEFORE CLOSING
Until closing, the Seller will let the Buyer and its advisers look at the premises and at the business's books, records and accounts during normal business hours, to check the Seller's statements. The Seller will keep running the business in the ordinary way, keep it insured, and will not hire or dismiss staff or change anyone's pay or terms without the Buyer's written consent. The Seller will stop using the business name after closing, except to collect its receivables and to sell items that were not part of the sale.

7. BULK-TRANSFER NOTICE AND TAX HOLDBACK
If this sale is a bulk transfer under Maryland Commercial Law, Title 6, Subtitle 1 (a sale of a major part of the inventory of a business that sells goods from stock, such as a store or restaurant), the Seller will give the Buyer, at least 15 days before closing, a creditor list signed under oath and a schedule of the property, and the Buyer will keep them for six months or file them with the circuit court clerk. The Buyer will send the creditor notice, by personal delivery or registered or certified mail, to the Comptroller of Maryland, to the listed creditors and to anyone else the Buyer knows has a claim against the Seller, at least 10 days before the Buyer takes possession or pays, whichever is first. Because that period runs from the first payment, no deposit or other payment is released to the Seller, and the Buyer does not take possession, until the period has ended. The Buyer may keep from the closing payment any amount the Comptroller claims for the Seller's unpaid sales and use tax and pay it to the Comptroller; any balance is paid to the Seller when the claim is paid or released in writing.

8. DEBTS, TAXES AND CONTRACTS
The Buyer does not take on any debt or obligation of the Seller or of the business from before or on the closing date. The Seller stays responsible for all debts, wages, taxes and bills of the business up to the closing date, including any sales tax and payroll tax, will give the Buyer proof that they are paid, and will cover the Buyer's costs, losses and reasonable legal fees, including any tax claim, that come from the Seller's ownership or running of the business up to the closing date. This agreement does not transfer a contract with an outside party if the transfer would break that contract. The Buyer is responsible for making its own new contracts where an existing one cannot be transferred, and the Seller is not liable for loss caused by the Buyer's failure to do so.

9. LEASE, LICENSES AND ACCOUNTS
{{#if leaseTransfer}}The Seller will assign the lease of the premises to the Buyer{{#if landlord}} with the written consent of {{landlord}}{{/if}}, and this sale depends on that consent.{{else}}The premises are not part of this sale, and the Buyer is responsible for arranging its own right to use them.{{/if}} The Buyer will apply in its own name for every license and permit needed to run the business{{#if licenses}}, including: {{licenses}}{{/if}}. A license or permit can be used only by the person it was issued to. The Seller will cooperate, will settle all lottery, tax and permit accounts up to closing, and will not transfer cigarettes, tobacco products, alcoholic beverages or lottery tickets to the Buyer until the Buyer holds the license required for them. The Seller stays responsible to the Maryland Lottery for its lottery tickets, equipment and sales money until the Lottery has approved the change and issued the Buyer's license.{{#if transition}} To avoid an interruption, the Buyer may keep using the Seller's ordinary service accounts (such as telephone, utilities, supplier and payment-system accounts) until {{transitionEnd}}, at the Buyer's own cost. After that date the Seller may close or transfer them. This never lets the Buyer use any license, permit or tax registration of the Seller.{{/if}}

10. EMPLOYEES
{{#if employees=none}}The Buyer is not taking over any employee of the Seller. The Seller ends all employment at closing and pays everything owed to its employees up to and including the closing date, including pay, benefits, bonuses and accrued vacation, sick and other paid time off, and keeps all payroll tax, withholding and unemployment-insurance duties for that time.{{else}}The Buyer decides which of the Seller's employees to hire and is responsible for those it hires from closing. The Seller pays everything owed to its employees up to and including the closing date, including pay, benefits, bonuses and accrued vacation, sick and other paid time off, and keeps all payroll tax, withholding and unemployment-insurance duties for that time.{{/if}} The Seller will cover the Buyer's losses from any employment claim based on events on or before the closing date.

11. SELLER'S STATEMENTS
The Seller states that:
• the Seller has full authority to sign and carry out this agreement{{#if sellerCompany}}; the Seller is a company that is properly formed and in good standing, and its signing has been approved by all the company action needed{{/if}};
• the Seller owns the Assets with good and marketable title, free of liens, charges and claims of others, and is entitled to sell them;
• to the Seller's knowledge no claim is pending or threatened against the Assets or the Seller's title to them, and no contract binds the Assets except those disclosed to the Buyer in writing, none of which is in default;
• this sale will not unfairly harm any existing creditor, and the Seller will meet the Maryland bulk-transfer requirements by closing;
• no broker's commission or finder's fee is owed because of anything the Seller did;
• the Seller has filed all tax returns and paid all taxes the business owes, and has withheld and paid all taxes it must withhold, except amounts properly disputed and disclosed to the Buyer;
• the Seller is not bound by any pension plan or union agreement, and no claim by a current or former employee is pending or threatened;
• the Assets have been kept in the way usual for the business and are in good working order, and the Seller's insurance on them is in force;
• the business is run in line with the law, and the Seller holds the licenses and registrations it needs;
• the business does not, to the Seller's knowledge, infringe anyone's trademark, name or copyright, and the Buyer may keep using the business's software and records after closing;
• the Seller is a United States resident for tax purposes; and
• this agreement is binding on the Seller.
The Seller promises that each statement will still be true at closing. These statements are the Seller's only promises about the Assets and the business{{#if asIs}}. The Buyer has had the chance to inspect the Assets, the books and the business's accounts, regulatory approvals and liabilities, and accepts the Assets "as is, where is" in their present condition, with no promise about profit, suitability or fitness for any purpose beyond these statements{{/if}}.
The Seller's statements remain in effect after closing. The Buyer must give written notice of any claim based on them, with full details, within {{claimYears|year}} after closing, and a claim is reduced by anything the Buyer recovers or can recover from someone else, less the reasonable cost of recovering it.

12. BUYER'S STATEMENTS
The Buyer states that the Buyer has full authority to sign and carry out this agreement (and, if the Buyer is a company, is properly formed and its signing is approved); has the funds to pay the full price and its own expenses; owes no broker's commission or finder's fee because of anything the Buyer did; is a United States resident for tax purposes; knows of nothing untrue in the Seller's statements; and is bound by this agreement. These are the Buyer's only promises, are true at closing, remain in effect after closing, and a claim on them must be notified in writing to the Buyer within {{claimYears|year}} after closing.

13. AFTER THE SALE
{{#if helpDays}}For {{helpDays|day}} after closing the Seller will help the Buyer with the changeover at no extra charge. {{/if}}{{#if nonCompete}}For {{noCompeteYears|year}} after closing the Seller will not own, run or work for a similar business within {{noCompeteMiles|mile}} of the premises, will not lend money to, advise or let its name be used by such a business, and will not seek the business's customers or staff for such a business. The Seller agrees these limits are reasonable and are a material part of the price; if a court finds a limit too broad, it applies to the extent the law allows.{{/if}}{{#if sellerCompany}}{{#if sellerOwner}} {{sellerOwner}} (the "Owner"), who owns the Seller, also signs this agreement personally and gives, in the Owner's own name, the same promises as the Seller {{#if nonCompete}}about not competing{{#if confidential}} and {{/if}}{{/if}}{{#if confidential}}about confidentiality{{/if}}.{{/if}}{{/if}}

{{#if confidential}}14. CONFIDENTIALITY
Each party will keep confidential the terms of this agreement, the price, the identity of the parties and anything it learns about the other party that is not public. This does not cover information generally known in the industry, information that becomes public without fault of the party holding it, information created independently, or information received lawfully from an outsider. A party may share confidential information with its employees, agents and advisers who need it and who agree to the same duty. Each party covers the other's harm caused by its own people breaching this section. The duty continues after closing without time limit.

{{/if}}{{#if extraClauses}}15. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}16. GENERAL
This is the whole agreement; anything said or promised before it that is not written in it has no effect. It may be changed only in writing signed by both parties, binds their heirs, executors, successors and permitted assigns, and is governed by the laws of the State of {{state}}, whose courts may settle any dispute about it.{{#if mediation}} Before starting a lawsuit (other than to ask a court for urgent protection), the parties will try in good faith to settle a dispute by mediation with a neutral mediator they choose together, and will share the mediator's fee equally.{{/if}} A party may not assign this agreement without the other's written consent. Each party pays its own costs of this agreement. Notices must be in writing and are treated as delivered when handed over or delivered by courier, or seven days after being mailed with postage paid, to the party's address above or another address it gives in writing. A waiver of one right is not a waiver of any other. All rights and remedies are in addition to those the law gives. Time is of the essence. This agreement may be signed in counterparts, including electronically. Headings are for convenience only, the singular includes the plural, and any gender includes every gender. If a term cannot be enforced, a court may narrow it as far as needed, the parties will try in good faith to replace it with a valid term of nearly the same effect, and the rest stays in force.

SELLER: {{seller}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

BUYER: {{buyer}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________
{{#if sellerCompany}}{{#if sellerOwner}}
OWNER OF THE SELLER, PERSONALLY: {{sellerOwner}}
Signature: ______________________________   Date: ______________
{{/if}}{{/if}}`,
  },
  {
    key: "ownership_transfer", title: "Membership Interest / Share Transfer Agreement", category: BUSINESS,
    description: "One owner transfers all or part of their ownership in an LLC or corporation to another person, for a price or as a gift.",
    reviewNote: "Check the company's own operating agreement or bylaws: other owners may have to consent or have a first right to buy. Update the company records and tell the tax preparer about the change. Confirm with an attorney or the tax preparer: (1) an S corporation can lose its S status if shares go to someone who is not an eligible shareholder (an individual, or certain trusts and estates — not a company or partnership); (2) a change in the number of LLC members can change how the LLC is taxed (a one-owner LLC that adds an owner becomes a partnership for tax purposes); (3) how profit and loss for the year is divided between the old and new owner, and whether a Section 754 election should be made; (4) whether a gift needs a gift tax return; (5) whether licenses (alcohol, tobacco, lottery, SNAP, health), the lease or loans need notice or consent when ownership changes — some count a transfer of an interest as a change of ownership, and some require the new owner to apply in his or her own name; (6) a person who resigns as manager or officer is not automatically freed from responsibility for the company's unpaid payroll or sales taxes for the time the person was responsible; (7) a corporation's charter or bylaws may require a legend on the share certificate; (8) if the price is paid over time, attach a promissory note and decide whether the Transferor keeps a pledge of the interest until it is paid — this form does not contain security terms; (9) the Transferor's original percentage minus the percentage transferred should equal the percentage the Transferor keeps. Attach the other owners' written consent if the agreement requires it, and tell the IRS (Form 8822-B), the bank and the Comptroller of Maryland if the responsible party or signers change.",
    steps: [
      { title: "Company and people", questions: [text("company", "Company name", { prefill: "clientName", required: true }), pick("entityType", "The company is", [["llc", "An LLC (membership interest)"], ["corp", "A corporation (shares of stock)"]], { required: true, default: "llc" }), text("assignor", "Owner transferring (Transferor)", { required: true }), text("assignee", "Person receiving (Transferee)", { required: true }), text("assigneeAddress", "Transferee's address"), text("companySigner", "Person who signs for the company", { required: true }), text("companySignerTitle", "That person's title", { placeholder: "e.g. Manager, President" }), effective(), state()] },
      { title: "Terms", questions: [
        pick("taxStatus", "How is the company taxed?", [["unknown", "Not sure, or a C corporation"], ["partnership", "Partnership (LLC with two or more owners)"], ["scorp", "S corporation"], ["disregarded", "One-owner LLC (ignored for income tax)"]], { required: true, default: "unknown", help: "Ask the tax preparer if unsure. The last choice applies to an LLC only." }),
        num("before", "Transferor's ownership before the transfer (%)", { help: "Transferor's percentage before, minus the percentage transferred, should equal the percentage kept." }),
        num("percent", "Ownership transferred (% of the whole company)", { required: true }),
        num("remaining", "Transferor's ownership after the transfer (%)"),
        text("shareDetails", "Number of shares and certificate numbers", { showIf: { id: "entityType", equals: "corp" } }),
        money("price", "Price (leave blank if a gift)"),
        text("payWhen", "How and when it is paid", { placeholder: "e.g. In full by bank transfer on the date above" }),
        yesno("othersConsent", "The other owners have agreed in writing, and have given up any first right to buy", { default: false }),
        list("consenters", "Other owners who consent (they sign below)", [text("name", "Name", { required: true })], { addLabel: "Add an owner", showIf: { id: "othersConsent", equals: true }, required: true }),
        num("outsideDays", "If required approvals are not obtained within this many days, either side may cancel", { required: true, default: "90" }),
        yesno("releaseGuaranty", "Transferor is to be released from personal guaranties of the company's debts", { default: false }),
        yesno("steppingDown", "The Transferor also resigns as manager / officer / director", { default: false }),
        yesno("spouseConsent", "Add a line for the Transferor's spouse to sign (for a married Transferor)", { default: false }),
        area("extraTerms", "Any additional terms (optional)"),
      ] },
    ],
    body: `{{#if entityType=llc}}MEMBERSHIP INTEREST TRANSFER AGREEMENT{{else}}SHARE TRANSFER AGREEMENT{{/if}}

Date: {{effectiveDate}}

1. THE TRANSFER
{{assignor}} ("Transferor") transfers to {{assignee}}{{#if assigneeAddress}} of {{assigneeAddress}}{{/if}} ("Transferee") {{percent}}% of all the {{#if entityType=llc}}membership interests{{else}}shares{{/if}} in {{company}} ("Company"){{#if before}}, out of the {{before}}% the Transferor owned before this transfer{{/if}}, including the matching share of profits, losses, distributions and voting rights, from the Transfer Date{{#if remaining}}, leaving the Transferor with {{remaining}}%{{/if}}. The "Transfer Date" is the date above or, if later, the date all consents and approvals this agreement requires have been obtained.{{#if entityType=corp}}{{#if shareDetails}} Shares transferred: {{shareDetails}}.{{/if}}{{/if}} At signing the Transferor delivers {{#if entityType=llc}}any membership certificate and a signed assignment{{else}}the stock certificate(s), endorsed, or a signed stock power (or, for uncertificated shares, a signed transfer instruction){{/if}}.

2. {{#if price}}PRICE{{else}}GIFT{{/if}}
{{#if price}}The Transferee pays the Transferor {{price}}{{#if payWhen}}: {{payWhen}}{{/if}}.{{else}}This transfer is a gift and no price is paid. The parties understand that a gift may need a gift tax return and that the Transferee may take over the Transferor's tax basis, and they will ask the tax preparer.{{/if}}

3. STATEMENTS OF THE PARTIES
The Transferor owns what is transferred free of any lien or claim, has not transferred or pledged it to anyone else, has the right to transfer it, and is not aware of any claim against the Company that has not been told to the Transferee. The Transferee is acquiring it for the Transferee's own account and not to resell it, has had the chance to review the Company's records, and understands that the {{#if entityType=llc}}interest has{{else}}shares have{{/if}} not been registered under any securities law and may be resold only as the law and the Company's own agreement allow.

4. CONSENT AND ADMISSION
{{#if othersConsent}}All other owners of the Company have agreed in writing to this transfer and to the Transferee becoming an owner, and have given up any right of first refusal or purchase they have for it; they sign below.{{else}}This transfer is subject to any consent or first right of purchase required by the Company's own agreement, and takes effect only once it is obtained.{{/if}} The Transferee agrees to be bound by the Company's operating agreement or bylaws.{{#if entityType=llc}} The Transferee is admitted as a member of the Company on the Transfer Date. If the Transferor has transferred the whole interest, the Transferor ceases to be a member.{{/if}}

5. APPROVALS
The Transferor and the Company will give any notice to, and obtain any approval from, licensing agencies (for example tobacco, alcohol, lottery, SNAP and health permit offices), the landlord and lenders that is required for this transfer. This transfer takes effect only when those required approvals have been obtained. If they have not been obtained within {{outsideDays|day}} after the date above, either the Transferor or the Transferee may cancel this agreement by written notice, and anything paid under it is returned.

6. THE COMPANY
The Company accepts the transfer, will record it in its books and update its ownership records, and the Transferee will be treated as the owner of the percentage above from the Transfer Date. The Company will also make the changes in its records and with agencies that the transfer requires, such as bank signature cards, its registrations with the Comptroller of Maryland, the State Department of Assessments and Taxation where information on file changes, and the IRS if the responsible party changes. {{#if steppingDown}}The Transferor resigns as manager, officer and director of the Company on the Transfer Date. {{/if}}{{#if releaseGuaranty}}The Transferee will ask the Company's lenders and landlord to release the Transferor from any personal guaranty of the Company's debts and, until a release is given, will protect the Transferor against claims under those guaranties.{{/if}}

7. TAXES
Profits and losses for the year are divided between the Transferor and the Transferee as the Company's tax preparer determines under the tax rules, generally by the part of the year each owned the {{#if entityType=llc}}interest{{else}}shares{{/if}}, and both accept that division and will report it consistently.{{#if taxStatus=partnership}} The tax preparer will advise whether the Company should make an election under Internal Revenue Code section 754.{{/if}}{{#if taxStatus=scorp}} Because the Company is an S corporation, profit and loss are divided for each day each owned the {{#if entityType=llc}}interest{{else}}shares{{/if}} unless all affected owners agree in writing to close the books on the Transfer Date. The Transferee confirms that the Transferee is eligible to hold S corporation ownership (a company or partnership, or a person who is neither a U.S. citizen nor a U.S. resident, generally is not), and no transfer to an ineligible person is permitted.{{/if}}{{#if taxStatus=disregarded}} The parties understand that if this transfer leaves the Company with more than one owner, or with a different single owner, its income tax treatment changes, and the tax preparer will advise what must be filed.{{/if}}

{{#if extraTerms}}8. ADDITIONAL TERMS
{{extraTerms}}

{{/if}}9. GENERAL
This is the whole agreement on this subject, may be changed only in writing signed by all who sign below, and is governed by the laws of the State of {{state}}. If a term cannot be enforced, the rest stays in force. Each party will sign any further document needed to complete the transfer. This agreement binds the parties' heirs, successors and permitted assigns and may be signed in counterparts, including electronically.

TRANSFEROR: {{assignor}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________
{{#if spouseConsent}}
SPOUSE OF THE TRANSFEROR
The spouse consents to this transfer and will make no claim against the Company or the Transferee to what is transferred.
Printed name: ______________________________
Signature: ______________________________   Date: ______________
{{/if}}
TRANSFEREE: {{assignee}}
Signature: ______________________________   Date: ______________
If a company — By: ______________________________   Name: ______________________________   Title: ______________________________

COMPANY: {{company}}
By: {{companySigner}}{{#if companySignerTitle}}, {{companySignerTitle}}{{/if}}
Signature: ______________________________   Date: ______________
{{#if othersConsent}}{{#if consenters}}
CONSENT OF THE OTHER OWNERS
The undersigned owners consent to this transfer and to the Transferee becoming an owner, and give up any right of first refusal or purchase they have for this transfer.
{{#list consenters}}{{name}}
Signature: ______________________________   Date: ______________

{{/list}}{{/if}}{{/if}}`,
  },
  {
    key: "personal_guaranty", title: "Personal Guaranty", category: LENDING,
    description: "A person promises to pay a business debt personally if the business does not.",
    reviewNote: "A guarantor can lose personal property if the business cannot pay. Read the loan or lease this guaranty supports before signing. A bank or other lender should not require a spouse to sign merely because of marriage (Regulation B, 12 CFR §1002.7(d)). If the guaranteed debt is a consumer loan, the FTC Credit Practices Rule (16 CFR §444.3) requires the lender to give the guarantor a separate written \"Notice to Cosigner\" before the guarantor is bound — this form does not replace it. Waivers of a guarantor's defenses are only as strong as Maryland courts will enforce them — confirm with an attorney. Describe the loan or lease with its date, amount and the document name so there is no doubt what is guaranteed. For a lease or a line of credit, consider capping the amount and letting the guarantor end the guaranty for future credit (both are options below). Whether adding \"(SEAL)\" next to a signature lengthens the time limit for suing is a question for an attorney; this form does not add it.",
    steps: [
      { title: "Parties", questions: [text("guarantor", "Guarantor (the person promising)", { required: true }), text("guarantorAddress", "Guarantor's address"), text("creditor", "Creditor (who is owed)", { required: true }), text("borrower", "Business or person whose debt is guaranteed", { prefill: "clientName", required: true }), effective(), state()] },
      { title: "What is guaranteed", questions: [
        area("obligation", "The debt or obligation", { required: true, placeholder: "e.g. The loan of $50,000 dated June 1, 2026 under the loan agreement between the Creditor and the Borrower, or all rent due under the lease of the store at 12 Main St dated May 1, 2026" }),
        pick("limit", "How much is guaranteed", [["all", "Everything owed under the obligation"], ["capped", "Up to a fixed amount"]], { required: true, default: "all" }),
        money("cap", "The most the Guarantor will pay (principal and interest)", { showIf: { id: "limit", equals: "capped" }, required: true }),
        yesno("noIncrease", "The Guarantor is not responsible for a higher amount or interest rate the Guarantor has not agreed to in writing", { default: true }),
        yesno("revocable", "The Guarantor may end the guaranty for future credit by written notice", { default: false, help: "Useful for a lease or a line of credit. The Guarantor stays responsible for everything already owed or committed." }),
        area("extraClauses", "Any additional terms (optional)"),
      ] },
    ],
    body: `PERSONAL GUARANTY

Date: {{effectiveDate}}

1. THE GUARANTY
In consideration of {{creditor}} ("Creditor") extending or continuing credit to {{borrower}} ("Borrower"), and for other value received, {{guarantor}}{{#if guarantorAddress}} of {{guarantorAddress}}{{/if}} ("Guarantor") personally and unconditionally guarantees to the Creditor the full and on-time payment of the following obligation of the Borrower (the "Obligation"): {{obligation}}

2. HOW MUCH
{{#if limit=all}}The Guarantor is responsible for everything the Borrower owes under the Obligation, including interest, fees and the Creditor's reasonable costs of collecting, including attorney's fees.{{else}}The Guarantor is responsible for up to {{cap}} of principal and interest owed under the Obligation, plus the Creditor's reasonable costs of collecting from the Guarantor, including attorney's fees.{{/if}}

3. NATURE OF THE PROMISE
This is a guaranty of payment, not only of collection: if the Borrower does not pay when due, the Creditor may demand payment from the Guarantor without first suing the Borrower or using any security, and the Guarantor will pay within 10 days after the Creditor's written demand. The guaranty continues until the Obligation is paid in full, even if the Creditor extends time, renews the Obligation, changes its terms with the Borrower, or accepts partial payments{{#if noIncrease}}, but the Guarantor is not responsible for any increase in the amount borrowed or in the interest rate that the Guarantor has not agreed to in writing{{/if}}. It also continues if the Borrower's business changes owner, name or form. This guaranty covers only the Obligation described above and not any other debt of the Borrower.

{{#if revocable}}4. ENDING THE GUARANTY FOR FUTURE CREDIT
The Guarantor may end this guaranty for credit extended, and amounts that become owing, after the Creditor receives the Guarantor's written notice of ending. The Guarantor remains responsible for everything the Borrower owed, or the Creditor was already committed to provide, when the notice was received, together with interest and costs on it and renewals of it. Ending this guaranty does not affect any other guarantor.

{{/if}}5. WHAT THE GUARANTOR GIVES UP
The Guarantor waives notice of default, demand, presentment and protest, and the right to require the Creditor to pursue the Borrower or any collateral first. The Guarantor's obligation is not reduced or ended by the Borrower's bankruptcy or discharge, any defect or unenforceability of the Obligation, any release or impairment of collateral or of another guarantor, or any lack of authority of the Borrower. If a payment to the Creditor is later returned or set aside, this guaranty is reinstated. Until the Creditor is paid in full, the Guarantor waives rights of subrogation, reimbursement and contribution against the Borrower. The Guarantor is responsible for keeping informed about the Borrower's finances and the Creditor has no duty to report on them, but on the Guarantor's written request the Creditor will tell the Guarantor in writing the amount then owed under the Obligation and whether the Borrower is in default.

{{#if extraClauses}}6. ADDITIONAL TERMS
{{extraClauses}}

{{/if}}7. GENERAL
The Guarantor confirms that the Guarantor has received and read the documents that create the Obligation. This guaranty binds the Guarantor's heirs and estate, benefits the Creditor's successors and assigns, may be changed only in writing signed by the Guarantor and the Creditor, and is governed by the laws of the State of {{state}}, whose courts may settle any dispute under it. Notices must be in writing. Delay in enforcing a right is not a waiver of it. If more than one person signs as Guarantor, each is liable for the whole amount. This guaranty may be signed in counterparts, including electronically. If a term cannot be enforced the rest stays in force.

GUARANTOR: {{guarantor}}
Signature: ______________________________   Date: ______________

CREDITOR (accepting): {{creditor}}
Signature: ______________________________   Date: ______________
Printed name: ______________________   Title (if a company): ______________`,
  },
  {
    key: "non_compete", title: "Non-Competition and Non-Solicitation Agreement", category: EMPLOYMENT,
    description: "A person promises not to compete with the business or take its customers or staff, for a limited time and area.",
    reviewNote: "Maryland makes a non-compete void for a worker who earns no more than 150% of the State minimum wage (Labor & Employment §3-716) — which covers most store cashiers and stock staff — and for licensed health-care workers in direct patient care paid $350,000 or less and for veterinary workers. A promise about using client lists or other private client information is not covered by that rule. Confirm the pay level before using this for any worker; keep the time and area reasonable. Whether the customer and staff promises are allowed for a lower-paid worker is not settled here — ask the attorney. For a worker who is already employed, give something new in return (a raise, bonus or other benefit) and write it in the box provided. Have a Maryland attorney review before use.",
    steps: [
      { title: "Parties", questions: [text("company", "Company", { prefill: "clientName", required: true }), text("person", "Person making the promise", { required: true }), text("personAddress", "Their address"), pick("relation", "That person is", [["employee", "An employee"], ["contractor", "An independent contractor"], ["seller", "The seller of the business"]], { required: true, default: "employee" }),
        pick("aboveLimit", "Does the worker earn MORE than 150% of the Maryland minimum wage?", [["yes", "Yes — I have checked the current limit"], ["no", "No, or not sure"], ["na", "Not applicable — the person is the seller of a business"]], { required: true, help: "The State minimum wage is $15.00 an hour, so 150% is $22.50 an hour (about $46,800 a year for full-time work). Confirm the current figure. Choose \"Not applicable\" only for the seller of a business." }),
        text("consideration", "Something new given in return (optional)", { help: "For a worker already employed: a raise, bonus or other benefit given for signing, e.g. a $500 signing bonus." }),
        effective(), state()] },
      { title: "The promise", questions: [
        text("locationAddress", "Company location the area is measured from", { required: true, placeholder: "e.g. 1241 N Decker Ave, Baltimore MD 21213" }),
        area("activity", "The competing activity", { required: true, placeholder: "e.g. Owning or running a convenience store or smoke shop" }),
        num("months", "For how many months after the relationship ends", { required: true, default: "12" }), num("miles", "Within how many miles", { required: true, default: "5" }),
        yesno("customers", "Not to take the company's customers or suppliers", { default: true }),
        yesno("staff", "Not to hire or recruit the company's staff", { default: true }),
        yesno("confidential", "Keep the company's business information confidential", { default: true }),
        area("additionalTerms", "Additional terms (optional)", { placeholder: "Anything else the parties have agreed" }),
      ] },
    ],
    body: `NON-COMPETITION AND NON-SOLICITATION AGREEMENT

Date: {{effectiveDate}}

This agreement is between {{company}} ("Company") and {{person}}{{#if personAddress}} of {{personAddress}}{{/if}} (the "Person"). In exchange for {{#if relation=seller}}the purchase price Company paid for the business{{else}}employment or engagement by Company, pay, access to its confidential information{{#if consideration}} and {{consideration}}{{/if}}{{/if}}, the Person agrees as follows.

1. NON-COMPETITION
{{#if relation=seller}}For {{months}} months after the sale of the business, the Person will not, within {{miles}} miles of {{locationAddress}}, own (other than holding less than 2% of a public company), run, or work in a role similar to the Person's role for a business engaged in: {{activity}}.{{else}}{{#if aboveLimit=no}}This section does not apply to the Person: Maryland law (Md. Code, Lab. & Empl. § 3-716) does not allow a promise not to compete for a worker at this pay level. The sections below stay in force.{{else}}For {{months}} months after the Person's work for the Company ends for any reason, the Person will not, within {{miles}} miles of {{locationAddress}}, own (other than holding less than 2% of a public company), run, or work in a role similar to the Person's role for a business engaged in: {{activity}}.{{/if}}{{/if}}

{{#if customers}}2. CUSTOMERS AND SUPPLIERS
During the same period the Person will not seek customers or suppliers of the Company with whom the Person dealt, or about whom the Person learned confidential information, during the last 12 months of the relationship, to move their business away from the Company.

{{/if}}{{#if staff}}3. STAFF
During the same period the Person will not hire, or encourage to leave, anyone who worked for the Company during the last 6 months of the relationship.

{{/if}}{{#if confidential}}4. CONFIDENTIAL INFORMATION
The Person will keep the Company's private business information (customer and supplier lists, prices, costs, financial records and methods) confidential and will not use it for anyone else, during and after the relationship. Nothing in this agreement stops the Person from reporting a possible violation of law to a government agency. Under 18 U.S.C. § 1833(b), an individual is not liable under any trade-secret law for disclosing a trade secret in confidence to a government official or an attorney solely to report or investigate a suspected violation of law, or in a sealed court filing.

{{/if}}5. FAIRNESS AND SEPARATE SECTIONS
The Person agrees the limits above are reasonable to protect the Company's legitimate business interests, and confirms the Person has had the chance to ask questions and to get advice from a lawyer of the Person's choice before signing. If a court finds any limit too broad, it may reduce it to what is reasonable. Each section stands on its own: if one cannot be enforced, the others stay in force.

6. REMEDIES
If a party breaks this agreement the other may ask a court to order them to stop, in addition to any other remedy. The winning party recovers its reasonable costs of enforcing this agreement.

7. GENERAL
This is the whole agreement on this subject, may be changed only in writing signed by both, and is governed by the laws of the State of {{state}}. The Company may assign this agreement to a successor to its business; the Person may not assign it. This agreement may be signed in copies, including electronically, and all copies together are one agreement.

{{#if additionalTerms}}8. ADDITIONAL TERMS
{{additionalTerms}}

{{/if}}COMPANY: {{company}}
Printed name and title: ______________________________
Signature: ______________________________   Date: ______________

PERSON: {{person}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "lease_amendment", title: "Lease Amendment / Renewal", category: REAL_ESTATE,
    description: "Extends a lease, changes the rent, or changes other terms, while everything else stays as in the original lease.",
    reviewNote: "Use this only if at least one change below is filled in; an amendment with no change is meaningless (the app does not check this yet). Choose whether the lease is for a home or a business: for a home the amendment adds Maryland protections that cannot be waived. If the lease has a guarantor, the guarantor should sign too. If there are several tenants, add each one below. For a home: a rent increase needs the written notice Maryland requires (Real Property Article 8-209; the Tenants' Bill of Rights says 90 days in most cases) and may start only after that notice period; the security deposit may not be more than one month's rent after any change (8-203) and any added amount needs a written receipt; if the term is extended, give the tenant the current Maryland Tenants' Bill of Rights — the app attaches it only to the Residential Lease PDF, so print and attach it by hand. For a home built before 1978, ask an attorney whether the lead notices must be given again (Maryland also requires them periodically during a tenancy). For a business lease: if the term as extended is over seven years, record a memorandum of lease (Real Property Article 3-101). A landlord's rent-increase notice rules are separate from this agreement.",
    steps: [
      { title: "The lease", questions: [text("landlord", "Landlord", { required: true }), text("tenant", "Tenant", { prefill: "clientName", required: true }), list("otherTenants", "Other tenants who also sign (if any)", [text("name", "Full name", { required: true })], { addLabel: "Add a tenant" }), text("guarantor", "Guarantor of the lease (if any)"), text("premises", "Premises address", { required: true }), date("leaseDate", "Date of the original lease", { required: true }),
        pick("leaseKind", "The lease is for", [["residential", "A home (where the tenant lives)"], ["commercial", "A business space"]], { required: true, help: "A home lease carries Maryland protections that cannot be waived, so this changes some wording." }),
        num("amendmentNo", "This is amendment number", { default: "1", required: true, help: "Use 1 for the first change to the lease, 2 for the second, and so on." }), effective(), date("effectiveOn", "The changes take effect on (leave empty if the date of this document)"), state()] },
      { title: "What changes", questions: [
        yesno("extend", "Extend the lease term", { default: true }), date("newEnd", "New ending date", { showIf: { id: "extend", equals: true }, required: true }),
        yesno("rentChange", "Change the rent", { default: false }), money("newRent", "New monthly rent", { showIf: { id: "rentChange", equals: true }, required: true }), date("rentFrom", "New rent starts on", { showIf: { id: "rentChange", equals: true }, required: true, help: "For a home, not before the end of the notice period Maryland requires for a rent increase." }),
        yesno("depositChange", "Change the security deposit", { default: false }), money("newDeposit", "New security deposit", { showIf: { id: "depositChange", equals: true }, required: true, help: "For a home, not more than one month's rent (after any rent change)." }),
        text("useChange", "Change the permitted use to (optional)", { placeholder: "e.g. Retail convenience store and deli" }),
        area("other", "Any other change", { placeholder: "e.g. Tenant may add a sign at the front of the building" }),
      ] },
    ],
    body: `LEASE AMENDMENT

Date: {{effectiveDate}}

This amendment is between {{landlord}} ("Landlord") and {{tenant}}{{#list otherTenants}}, {{name}}{{/list}} ("Tenant") and changes the lease dated {{leaseDate}} for the premises at {{premises}}, as that lease may already have been amended ("the Lease"). This is amendment number {{amendmentNo}} to the Lease. The changes below take effect on {{#if effectiveOn}}{{effectiveOn}}{{else}}the date of this amendment{{/if}}.

{{#if extend}}1. TERM
The Lease term is extended and now ends on {{newEnd}}, unless ended earlier under the Lease.{{#if leaseKind=residential}} With this amendment Landlord gives Tenant a copy of the current Maryland Tenants' Bill of Rights, and Tenant confirms receiving it.{{/if}}{{#if leaseKind=commercial}} If the Lease term as extended is longer than seven years, the parties will sign a memorandum of lease that either of them may record in the land records.{{/if}}

{{/if}}{{#if rentChange}}2. RENT
Beginning {{rentFrom}}, the monthly rent is {{newRent}}, payable on the same dates and in the same way as before.{{#if leaseKind=residential}} The new rent does not start before the end of the notice period that Maryland law requires for a rent increase, and any late fee under the Lease stays within the legal limit of 5% of the unpaid rent.{{/if}}

{{/if}}{{#if depositChange}}2. SECURITY DEPOSIT
The security deposit is changed to {{newDeposit}}; any difference is paid to Landlord, or refunded to Tenant, within 30 days after this amendment takes effect.{{#if leaseKind=residential}} The security deposit may not be more than one month's rent. Landlord gives Tenant a written receipt for any added amount and holds the whole deposit as Maryland law requires, and Tenant keeps every right the security-deposit law gives.{{/if}}

{{/if}}{{#if useChange}}2. PERMITTED USE
The permitted use of the premises is changed to: {{useChange}}.

{{/if}}{{#if other}}3. OTHER CHANGES
{{other}}

{{/if}}4. NOTHING ELSE CHANGES
All other terms of the Lease stay in full force. This amendment is part of the Lease and is subject to it; words with capital letters that are not defined here have the meaning they have in the Lease. If this amendment and the Lease disagree, this amendment controls. Each party confirms that the Lease is in effect and that, to its knowledge, the other party is not in default. The security deposit now held stays with the Lease.{{#if guarantor}} {{guarantor}} consents to this amendment and confirms that the guarantee of the Lease continues for the Lease as amended.{{/if}}{{#if leaseKind=residential}} Nothing in this amendment waives any right Tenant has under Maryland law.{{/if}} This amendment is governed by the laws of the State of {{state}} and may be signed in copies, including electronically. Each person who signs for a company states that he or she is authorized to do so.

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
    reviewNote: "A mortgage lender may require its own form, the donor's bank statement showing the funds, and proof of the transfer (wire, check or deposit record). What lenders ask for (Fannie Mae Selling Guide B3-4.3-04, checked online; an older HUD letter for FHA loans): a letter signed by the donor (FHA also asks for the borrower's signature) that states the amount, says no repayment is expected, and gives the donor's name, address, telephone number and relationship to the borrower; a gift from a trust or estate must name it; the lender must see the money leave the donor's account and reach the borrower or the closing agent. Fannie Mae accepts relatives, a spouse or domestic partner (and that partner's relatives), a fiancé(e), a former relative, or someone with a long-standing family-like or mentorship relationship; it does not accept the builder, developer or real estate agent, or anyone affiliated with an interested party to the sale, and a seller only if an acceptable donor who is not affiliated with another interested party. Fannie Mae does not allow gifts for an investment property, and if the donor lives with the borrower and the gift is pooled with the borrower's own money for the minimum down payment, the donor must certify the shared residence. A friend or the seller is often not accepted, so check with the lender first. Freddie Mac and current FHA rules (HUD Handbook 4000.1) were not checked — UNVERIFIED. A gift of equity from a seller is a different document. A notary is generally not required unless the lender asks. A gift above the annual exclusion (IRS: $19,000 per person for 2026) may require the donor to file a gift tax return (Form 709); ask the tax preparer. The recipient does not pay gift tax.",
    steps: [
      { title: "People", questions: [text("donor", "Donor (person giving the gift)", { required: true }), text("donorAddress", "Donor's address", { required: true }), text("donorPhone", "Donor's phone", { required: true }), text("recipient", "Recipient (person receiving it)", { prefill: "clientName", required: true }), text("recipientAddress", "Recipient's address"),
        text("relationship", "Donor's relationship to the Recipient", { required: true, placeholder: "e.g. Father, Sister, Fiancé" }),
        pick("relationType", "The Donor is", [["family", "A relative — by blood, marriage, adoption or legal guardianship"], ["partner", "The Recipient's spouse, domestic partner or fiancé(e)"], ["familylike", "Someone in a long-standing family-like relationship with the Recipient"], ["other", "Someone else"]], { required: true, help: "Most lenders do not accept 'someone else' (a friend, co-worker or the seller). Ask the lender before using this letter." }), effective()] },
      { title: "The gift", questions: [
        money("amount", "Amount of the gift", { required: true }), date("giftDate", "Date the gift was paid or will be paid", { required: true }),
        text("transferMethod", "How it is paid", { required: true, placeholder: "e.g. Wire from the Donor's account at ABC Bank to the Recipient's account" }),
        pick("purpose", "What it is for", [["home", "A down payment or closing costs on a home"], ["other", "Another purpose"]], { required: true, default: "home" }),
        text("property", "Address of the home being bought", { showIf: { id: "purpose", equals: "home" }, required: true }), text("lender", "Mortgage lender (if known)", { showIf: { id: "purpose", equals: "home" } }),
        text("source", "Where the money comes from", { placeholder: "e.g. The Donor's savings account at ABC Bank", help: "If the money comes from a trust or an estate, name it here — lenders require that." }),
        text("donorAccount", "Account the money leaves (bank and last 4 digits only, optional)", { placeholder: "e.g. ABC Bank, account ending 1234", help: "Lenders trace the money from the donor's account to the recipient. Never write the full account number." }),
      ] },
    ],
    body: `GIFT LETTER

Date: {{effectiveDate}}

I, {{donor}}, of {{donorAddress}}, telephone {{donorPhone}}, the Donor, state:

1. I am giving {{recipient}}{{#if recipientAddress}}, of {{recipientAddress}}{{/if}} (the "Recipient"), my {{relationship}}, the sum of {{amount}}. The gift is paid, or will be paid, on {{giftDate}} by {{transferMethod}}.

2. This is a gift. It does not have to be repaid, and I do not expect it to be repaid in money, property or services, now or in the future. No loan is involved.

3. {{#if purpose=home}}The gift is to help with the down payment or closing costs for the purchase of the home at {{property}}{{#if lender}}, financed by {{lender}}{{/if}}.{{else}}The gift is for the Recipient's own use.{{/if}}

4. {{#if source}}The money comes from {{source}}{{#if donorAccount}} ({{donorAccount}}){{/if}}.{{else}}The money comes from my own funds{{#if donorAccount}} ({{donorAccount}}){{/if}}.{{/if}} It is not borrowed, and it gives me no lien or claim on the Recipient's property.{{#if purpose=home}} I have no interest in the sale or financing of the home, and I am not connected with the builder, the seller, the real estate agent or any other party to the transaction. None of the money came, directly or indirectly, from any of them or from anyone else with an interest in the sale or the loan.{{/if}}

5. {{#if relationType=family}}I am related to the Recipient by blood, marriage, adoption or legal guardianship.{{/if}}{{#if relationType=partner}}I am the Recipient's spouse, domestic partner or fiancé(e).{{/if}}{{#if relationType=familylike}}I have a long-standing family-like relationship with the Recipient.{{/if}}{{#if relationType=other}}My relationship to the Recipient is: {{relationship}}.{{/if}}

6. I understand that I may be asked to give my bank records to show where the money came from and that it left my account, and that a federal gift tax return (Form 709) may be required of me if my gifts to the Recipient in a year are more than the annual exclusion. Any gift tax is my responsibility, not the Recipient's.

DONOR: {{donor}}
Signature: ______________________________   Date: ______________

RECIPIENT (acknowledging that this is a gift and will not be repaid): {{recipient}}
Signature: ______________________________   Date: ______________`,
  },
  {
    key: "business_poa", title: "Business Power of Attorney (Operations, Banking & Tax)", category: BUSINESS,
    description: "A business gives a trusted person authority to run daily operations, handle bank accounts, and deal with tax and government matters — each power can be switched on or off.",
    reviewNote: "Banks usually insist on their own authorization form and a company resolution as well — bring this document, the Articles / EIN letter and a company resolution (this builder has a Company Resolution document that can name this person and these powers). Sign in front of a notary; the two witnesses are optional (see below). This is for a business that is a separate legal entity (LLC, corporation, partnership); if the owner is a sole proprietor, use the personal Power of Attorney instead. A corporation's income tax return must be signed by an authorized officer (26 CFR 1.6062-1) — this document does not change that. For the IRS use Form 2848 / 8821; the Maryland Comptroller accepts only its own Form 548. Maryland's power-of-attorney statute (Estates and Trusts Title 17, checked on mgaleg.maryland.gov) is written for an individual principal, and §17-109 says it does not cover powers to prepare, sign or file documents for an entity with a government body or other third party, powers found in an entity's governing documents, or authority to sign an entity's governing documents. So the statute's two-witness rule and its 'a copy is as good as the original' and 'must accept' rules most likely do not apply here; the copy and good-faith-reliance sentences are only a request and a promise by the business, and a bank or office may refuse them. An attorney should confirm this reading. The authority really comes from the company's own documents (operating agreement, bylaws, partnership agreement) and a resolution, so make sure they allow this appointment, and that any approval an owner or the other members must give is attached. Offices that issue licenses (tobacco, lottery, alcohol, SNAP/EBT) may require the owner or officer to sign personally — not checked for each office; confirm with an attorney. Have a Maryland attorney review before use.",
    steps: [
      { title: "The business and the agent", questions: [
        text("company", "Business giving the authority", { prefill: "clientName", required: true }),
        text("companyAddress", "Business address", { prefill: "clientAddress" }),
        pick("entityType", "Kind of business", [["llc", "Limited liability company (LLC)"], ["corp", "Corporation"], ["partnership", "Partnership"], ["other", "Other business entity"]], { required: true, default: "llc", prefill: "entityType" }),
        text("formedIn", "State where it is formed", { default: "Maryland", prefill: "stateName" }),
        text("einLast4", "EIN — last 4 digits only", { placeholder: "e.g. 1234", prefill: "einLast4" }),
        text("owner", "Owner / officer signing for the business", { required: true, prefill: "ownerName" }),
        text("ownerTitle", "Their title", { required: true, placeholder: "e.g. Managing Member, President", prefill: "ownerTitle" }),
        text("agent", "Person receiving the authority (agent)", { required: true }),
        text("agentAddress", "Agent's address"),
        yesno("resolution", "A written resolution or consent of the members / directors / partners approving this appointment is attached", { default: false, help: "Banks usually ask for it. Leave off unless it really exists and will be attached." }),
        effective(), state(),
      ] },
      { title: "Bank accounts", description: "Switch off anything the agent should not do.", questions: [
        yesno("bank", "Banking powers", { default: true }),
        text("banks", "Bank name(s) to mention (optional)", { showIf: { id: "bank", equals: true }, placeholder: "e.g. Bank of America", help: "Naming a bank does not limit the power — it still covers any other bank or credit union. Leave empty to name none." }),
        yesno("openClose", "Open and close accounts", { showIf: { id: "bank", equals: true }, default: true }),
        yesno("limitWithdraw", "Set a dollar limit for one withdrawal or transfer (leave off for no limit)", { showIf: { id: "bank", equals: true }, default: false }),
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
        area("additional", "Special instructions or limits (optional)", { placeholder: "e.g. The Agent may not hire anyone related to the Agent", help: "Anything that narrows or adds to the powers above. If it conflicts with the powers above, these instructions win. Leave empty for none." }),
      ] },
    ],
    body: `BUSINESS POWER OF ATTORNEY

Date: {{effectiveDate}}

1. APPOINTMENT
{{company}}{{#if companyAddress}}, of {{companyAddress}}{{/if}}, {{#if entityType=llc}}a limited liability company{{/if}}{{#if entityType=corp}}a corporation{{/if}}{{#if entityType=partnership}}a partnership{{/if}}{{#if entityType=other}}a business entity{{/if}}{{#if formedIn}} formed in {{formedIn}}{{/if}}{{#if einLast4}} (EIN ending {{einLast4}}){{/if}} (the "Business"), acting through {{owner}}, its {{ownerTitle}}, appoints {{agent}}{{#if agentAddress}} of {{agentAddress}}{{/if}} ("Agent") as its attorney-in-fact to act for the Business and sign in its name in the matters listed below. {{owner}} confirms that this power is authorized by the Business's governing documents and, where required, by a resolution of its members or directors, and will give a copy of that resolution to any bank on request.{{#if resolution}} A written resolution or consent approving this appointment is attached to this document.{{/if}}

2. POWERS GIVEN
{{#if bank}}A. BANKING. {{#if banks}}At {{banks}} and at any other bank or credit union{{else}}At any bank or credit union{{/if}}, the Agent may{{#if openClose}} open and close accounts,{{/if}} deposit and withdraw money, write, sign and endorse checks, make transfers, wires and electronic payments, use and manage online banking and debit or credit cards of the Business, get statements and records, and sign the bank's forms and signature cards.{{#if limitWithdraw}} The Agent may not withdraw or transfer more than {{withdrawLimit}} in any one transaction.{{/if}}

{{/if}}{{#if operations}}B. DAILY OPERATIONS. The Agent may run the day-to-day business: buy goods and supplies, deal with vendors and customers, set up and use point-of-sale and merchant accounts, sign ordinary contracts and orders, manage inventory and premises, and keep the books and records.

{{/if}}{{#if staff}}C. STAFF AND PAYROLL. The Agent may hire, supervise, pay and end the employment of staff, and run payroll, including payroll deposits and filings.

{{/if}}{{#if tax}}D. TAX AND GOVERNMENT MATTERS. The Agent may prepare and file the Business's sales tax, payroll tax and income tax returns, sign them where the law allows an agent to sign, pay taxes, receive notices and correspondence, and deal with federal, state and local tax offices on the Business's behalf. This power does not let the Agent sign any return that the law requires an owner or officer to sign. For the Comptroller of Maryland the Business will also sign Maryland Form 548, and for the IRS Form 2848, naming the Agent; this document alone is not enough.

{{/if}}{{#if licenses}}E. LICENSES AND PERMITS. The Agent may apply for, renew, change and close licenses and permits of the Business. Some licenses and permits (for example tobacco, lottery, alcohol and SNAP / EBT) may have to be signed by an owner or officer personally; where an office requires that, the Agent may prepare and submit the papers and the Business will sign them itself.

{{/if}}{{#if borrow}}F. BORROWING. The Agent may borrow money for the Business and sign loan and credit documents in its name, but only with the written approval of {{owner}} or another owner of the Business for each loan.

{{/if}}{{#if property}}G. PROPERTY. The Agent may buy, sell or lease property and major equipment for the Business, but only with the written approval of {{owner}} or another owner of the Business for each transaction.

{{/if}}{{#if ownership}}H. SALE AND OWNERSHIP. The Agent may sell the Business or its assets, change who owns the Business, and add or remove owners, and sign the papers needed to do so, but only with the written approval of {{owner}} or another owner of the Business for each step.

{{/if}}{{#if giveAway}}I. GIFTS. The Agent may give away or donate the Business's money or property, but only with the written approval of {{owner}} or another owner of the Business for each gift.

{{/if}}{{#if !bank}}{{#if !operations}}{{#if !staff}}{{#if !tax}}{{#if !licenses}}{{#if !borrow}}{{#if !property}}{{#if !ownership}}{{#if !giveAway}}No power has been selected, so this document gives the Agent no authority until it is corrected and signed again.

{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}3. LIMITS
{{#if approval}}For any single purchase, payment, contract or commitment above {{approvalAmount}}, the Agent must first get the written approval of {{owner}} or another owner of the Business. {{/if}}{{#if bank}}{{#if limitWithdraw}}{{#if approval}}Where both the bank limit and the approval amount apply, the lower one controls. {{/if}}{{/if}}{{/if}}{{#if ownership}}{{else}}The Agent may not sell the Business or change who owns it, and may not add or remove owners. {{/if}}{{#if giveAway}}{{else}}The Agent may not give away the Business's money or property. {{/if}}The Agent may not sign a personal guaranty for any owner, or act for any owner in the owner's personal name. No power is given beyond those listed above.

4. DUTIES
The Agent must act in the Business's best interest, keep its money separate from the Agent's own, keep records of what is done, and give the owners an account whenever they ask. The owners may inspect all accounts and records at any time. The Agent may not pay or benefit the Agent or the Agent's relatives from the Business except wages the owner has approved, may not hand this authority to anyone else, and must sign as "the Business, by the Agent, as attorney-in-fact". The Agent must follow the written instructions of {{owner}} or another owner of the Business and keep the Business's information confidential. The Agent receives no pay for this authority unless the owner agrees in writing, but the Business will repay reasonable expenses the Agent pays for it.

5. HOW LONG IT LASTS
This power starts when signed. {{#if endDate}}It ends on {{endDate}}, or earlier if the Business cancels it in writing.{{else}}It lasts until the Business cancels it in writing.{{/if}} It also ends automatically if the Agent stops working for the Business, or if the Business is sold or dissolved. Notice of cancellation must be given in writing to the Agent and to each bank or office relying on this document, and may be given by any owner or officer with authority to act for the Business. The Agent may resign by written notice to the Business. The Business agrees that a person who relies on this document in good faith may keep relying on it until they receive written notice that it has ended.

{{#if additional}}6. SPECIAL INSTRUCTIONS
{{additional}} If these instructions conflict with the powers above, these instructions control.

{{/if}}6. GENERAL
The Business asks that a copy of this document be accepted as the original. It is governed by the laws of the State of {{state}}.

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
    reviewNote: "This gives the firm authority to deal with offices for the business, but offices still require their own forms: the Maryland Comptroller accepts only its own Form 548 for tax accounts (the IRS uses Form 2848 / 8821), the Maryland Division of Unemployment Insurance has its own employer power-of-attorney form filed through its portal, and USDA Food and Nutrition Service (SNAP / EBT) has its own Letter of Representation form that the store owner signs. The State Department of Assessments and Taxation annual report / personal property return has a signature block for a corporate officer or principal and a separate block for the preparer, so the firm can prepare and submit it but an officer or principal should sign it (checked on the SDAT 2026 forms; online-filing rules not checked). Maryland's power-of-attorney statute (Estates and Trusts Title 17, checked on mgaleg.maryland.gov) does not cover powers to prepare, sign or file documents for an entity with a government body or powers on government-prescribed forms (§17-109), so its two-witness rule is not required for this document (an attorney should confirm); the notary block is included because some offices ask for a notarized power. For the same reason the copy and good-faith-reliance sentences are a request and a promise by the business, not a statute, and an office may refuse them. Confirm with an attorney, before relying on this for them: (1) whether the county and the health department accept an agent applying for an occupancy or food permit; (2) whether this power is valid beyond one year for a given office; (3) whether tobacco, lottery or alcohol licence applications may be filed by an agent (not checked). The firm's own telephone numbers and e-mail address pre-filled below should be checked for currency; whether to keep the named representatives pre-filled is a decision for the firm. Have a Maryland attorney review before use.",
    steps: [
      { title: "The business", questions: [
        text("principal", "Business giving the authority", { prefill: "clientName", required: true }),
        text("entityDesc", "Kind of business", { placeholder: "e.g. a Maryland limited liability company", prefill: "entityDesc" }),
        text("principalAddress", "Business street address", { prefill: "clientAddress", required: true }),
        text("acctRef", "Account / license numbers covered (last 4 digits only)", { placeholder: "e.g. Sales tax account ending 1234; tobacco license ending 5678" }),
        text("signerName", "Owner / officer signing for the business", { required: true, prefill: "ownerName" }),
        text("signerTitle", "Their title", { required: true, default: "Owner", placeholder: "e.g. Owner, Managing Member, President", prefill: "ownerTitle" }),
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
        area("additional", "Special instructions or limits (optional)", { placeholder: "e.g. The firm must send the Principal a copy of every filing before it is submitted", help: "Anything that narrows or adds to the powers above. If it conflicts with the powers above, these instructions win. Leave empty for none." }),
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
{{/if}}{{#if pEbt}}• Apply for or maintain the Principal's EBT / SNAP permit, using the forms the agency requires.
{{/if}}{{#if pFile}}• Prepare and file the Principal's Maryland sales and use tax and withholding tax returns and make the related payments.
{{/if}}{{#if pOccupancy}}• Apply for and obtain a new occupancy permit from the relevant authorities.
{{/if}}{{#if pTobacco}}• Apply for, renew or amend the Principal's tobacco / cigarette retail license.
{{/if}}{{#if pHealth}}• Apply for and maintain the Principal's health department or food service permit.
{{/if}}{{#if pLocal}}• Apply for, renew or amend the Principal's local business, trader's and other county or city licenses.
{{/if}}{{#if pAnnual}}• Prepare and submit the Principal's annual report and personal property return to the State Department of Assessments and Taxation; an officer or principal of the Principal signs the return where the form calls for it.
{{/if}}{{#if pUI}}• Handle the Principal's Maryland unemployment insurance account matters, using the Division's own authorization form where it requires one.
{{/if}}{{#if other}}• {{other}}
{{/if}}{{#if !pSales}}{{#if !pArticles}}{{#if !pEbt}}{{#if !pFile}}{{#if !pOccupancy}}{{#if !pTobacco}}{{#if !pHealth}}{{#if !pLocal}}{{#if !pAnnual}}{{#if !pUI}}{{#if !other}}• No purpose has been selected, so this document gives the Attorney-in-Fact no power until it is corrected and signed again.
{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}{{#if acctRef}}Accounts and licenses covered (last four digits only): {{acctRef}}.
{{/if}}The Attorney-in-Fact may also handle all related communications for the Principal and do the incidental acts reasonably needed to carry out these purposes.

3. SIGNING
{{#if signDocs}}The Attorney-in-Fact may sign applications, forms, agreements and letters in the Principal's name, but only as needed for the purposes in the section on powers given.{{else}}The Attorney-in-Fact may prepare and submit documents for the Principal but may not sign them in the Principal's name.{{/if}}

4. LIMITS
This power does not include the power to sell or mortgage the business or its property, borrow money, open or close bank accounts, sign checks or withdraw funds, change the ownership of the business, make gifts, or sign any contract other than those needed for the purposes in the section on powers given. The Attorney-in-Fact is not acting as the Principal's lawyer, and this document does not let it practice law or give legal advice. Taxes and fees are paid only by the Principal's own payment authorization (an electronic debit the Principal approves or a check the Principal signs); the Attorney-in-Fact never holds the Principal's funds or bank login.

{{#if additional}}5. SPECIAL INSTRUCTIONS
{{additional}} If these instructions conflict with the powers above, these instructions control.

{{/if}}5. OFFICIAL FORMS
Some offices accept only their own authorization form (for example Maryland Comptroller Form 548, the Maryland Division of Unemployment Insurance power of attorney form, the USDA Food and Nutrition Service Letter of Representation, or IRS Form 2848). The Principal will sign those forms when asked, and for each such office its form governs. This document does not replace them.

6. PRINCIPAL'S RESPONSIBILITIES
The Principal will give accurate and complete information, remains responsible for the taxes, fees, penalties and interest of the business, and will personally sign any application or return that the law or the office requires an owner or officer to sign.

7. DUTIES
The Attorney-in-Fact accepts this appointment on these terms and will act in the Principal's best interest and only within these powers, keep records of what it does, give the Principal copies of every filing, license, permit and notice, and keep the Principal's information confidential, using it only for these purposes. The firm's fees are set in its separate engagement letter or fee agreement, not by this document.

8. WHEN IT STARTS AND ENDS
This power takes effect when it is signed and ends {{#if endDate}}on {{endDate}}{{else}}one year after the date it is signed{{/if}}, or earlier when the Attorney-in-Fact's engagement for the Principal ends. The Principal may revoke it at any time by written notice to the Attorney-in-Fact. When it receives that notice it will stop acting and promptly return all documents, funds and property belonging to the Principal. The Attorney-in-Fact may resign by written notice to the Principal.

9. COPIES AND RELIANCE
The Principal asks every office to accept a copy of this document as the original. The Principal agrees that an office or person who relies on it in good faith may keep relying on it until they receive written notice that it has ended.

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

/**
 * Every document gets a last optional step — "Notary acknowledgment" — unless it already carries its own notary block (powers of attorney,
 * affidavit, and so on). When switched on, the engine adds one acknowledgment page per signer after the document (see engine.ts).
 */
const HAS_OWN_NOTARY = /NOTARY|ACKNOWLEDGMENT BEFORE/i;
for (const t of DOC_TEMPLATES) {
  if (HAS_OWN_NOTARY.test(t.body)) continue;
  t.steps.push({ title: "Notary (optional)", description: "Some banks, agencies and courts want a signature notarized. Add an acknowledgment page and the notary completes it when the signers sign in front of them.", questions: [
    yesno("notaryAck", "Add a notary acknowledgment page for the people who sign", { default: false, help: "A notary must watch each person sign, so sign on paper in front of the notary — not electronically from a distance." }),
    text("notaryCounty", "County where it will be notarized (optional)", { showIf: { id: "notaryAck", equals: true }, placeholder: "e.g. Baltimore County" }),
  ] });
}

export function getDocTemplate(key: string): DocTemplate | undefined { return DOC_TEMPLATES.find((t) => t.key === key); }
