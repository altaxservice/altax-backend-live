/**
 * How safe each document is to hand to a client without a lawyer's review, as judged in the fourth audit (see legal-research/).
 *   READY  — routine use is fine once the facts are filled in correctly.
 *   CARE   — usable, but only if staff follow the short checklist or the matter is small and simple.
 *   LAWYER — high-stakes or legally intricate: a good first draft, but do not use it for a high-value or contested matter without a lawyer.
 * Shown as a badge in the library and as a "Before you use this document" box in the wizard.
 */
export type ReadinessLevel = "READY" | "CARE" | "LAWYER";
export interface Readiness { level: ReadinessLevel; why: string; triggers: string[]; checklist: string[] }

export const READINESS: Record<string, Readiness> = {
  "fee_agreement": {
    "level": "READY",
    "why": "Routine tax and bookkeeping fee contract; fees are flat, monthly or hourly, never a share of a refund.",
    "triggers": [
      "The client asks for a cap on the firm's liability, arbitration or a shorter time to sue.",
      "The client wants a fee that depends on the refund or result.",
      "The client is a large company or agency that sends its own contract."
    ],
    "checklist": [
      "List the services and tax year in plain words.",
      "Check the fee type and amount match what you quoted.",
      "If interest on overdue invoices is on, keep it at 0.5% a month (the form blocks more than 0.67%).",
      "Have the client initial the electronic-delivery section, or switch it off.",
      "Give the client a signed copy."
    ]
  },
  "engagement_letter": {
    "level": "READY",
    "why": "Standard scope-of-work letter that matches the IRS practice rules for tax preparers.",
    "triggers": [
      "Two people (for example spouses) whose interests may conflict, such as a divorce.",
      "The work includes speaking for the client in front of the IRS or Comptroller beyond preparing a return.",
      "An audit, review or financial statement engagement."
    ],
    "checklist": [
      "Describe the work and list what is not included.",
      "Put every covered person in the client name; each one signs.",
      "Fill in the fee exactly as quoted.",
      "Initial or switch off the electronic-delivery section.",
      "Give the client a signed copy."
    ]
  },
  "authorization_release": {
    "level": "CARE",
    "why": "Releasing income tax return information without a valid signed consent can break federal law, so the steps must be followed exactly.",
    "triggers": [
      "The recipient is outside the United States.",
      "The client says the firm made signing a condition of getting the return done.",
      "The client wants a release with no end date or for 'everything'."
    ],
    "checklist": [
      "Fill in every blank before the client signs, never after.",
      "Leave the income-tax-return switch on if anything came from an income tax return.",
      "Print the form alone, 12-point type or larger (the PDF and Word file already are).",
      "Both spouses sign on a joint return.",
      "Give the client a copy and release nothing until it is signed and dated."
    ]
  },
  "termination_of_services": {
    "level": "READY",
    "why": "Plain ending letter; the real risk is missed deadlines and old authorizations, which the checklist covers.",
    "triggers": [
      "A filing deadline falls within 30 days and the client has no other preparer.",
      "The client disputes fees or says the firm made an error.",
      "The firm holds an open IRS notice or audit for the client."
    ],
    "checklist": [
      "List every open deadline in the next 60 days in the open-items box.",
      "On the same day, send the IRS a Form 2848 withdrawal copy marked WITHDRAW; withdraw from Maryland Form 548 and unemployment-insurance access.",
      "Leave the reason empty unless the owner decides otherwise.",
      "Send by hand or certified mail and keep the receipt.",
      "Return the client's records when asked, even if a balance is unpaid."
    ]
  },
  "document_request_letter": {
    "level": "READY",
    "why": "A simple request letter with no legal commitment beyond a deadline warning.",
    "triggers": [
      "The client has ignored several requests and a filing deadline is close.",
      "The request is part of an IRS or state audit."
    ],
    "checklist": [
      "Name each document and year.",
      "Give a date at least 10 days away.",
      "Add the firm contact (phone or email).",
      "Do not ask for Social Security or bank numbers by email."
    ]
  },
  "demand_letter": {
    "level": "CARE",
    "why": "Safe for a simple unpaid business invoice; threats or personal debts can create liability for the sender.",
    "triggers": [
      "The amount is over $5,000 or the debtor disputes it.",
      "The debt became due more than 3 years ago.",
      "The creditor wants to say it will sue, or the debtor is in bankruptcy.",
      "Anyone other than the creditor (including the firm) would send it for a personal or household debt."
    ],
    "checklist": [
      "The creditor signs it, in the creditor's own name.",
      "Check the amount and original due date against the invoice and attach the invoice.",
      "Leave 'legal action may follow' off unless the creditor really intends to sue within 3 years.",
      "Switch on the personal-debt option for a home or personal debt.",
      "Send by certified mail and keep the receipt."
    ]
  },
  "payment_agreement": {
    "level": "CARE",
    "why": "Fine for a small, recent balance owed to the signer; old or personal debts and bigger amounts need more care.",
    "triggers": [
      "The oldest part of the debt is more than 3 years old.",
      "The amount is over $5,000.",
      "The debtor disputes the debt, is in bankruptcy, or the creditor is not the one who is owed.",
      "A co-signer, guarantor or collateral is involved."
    ],
    "checklist": [
      "Check the total against the creditor's records.",
      "Make sure the installments add up so the last payment is not a big surprise.",
      "For a personal or household debt, switch on that option and confirm it is under 3 years old.",
      "Keep any late fee to 5% of the installment.",
      "Both sides sign and the debtor gets a signed copy."
    ]
  },
  "tax_preparer_disclosure": {
    "level": "CARE",
    "why": "A short statutory disclosure; it is only safe if every fact about the preparer is true and it is given before any work starts.",
    "triggers": [
      "The preparer is a CPA, enrolled agent or attorney (this form is not for them).",
      "The preparer is not registered with the State Board.",
      "Work on the return has already started."
    ],
    "checklist": [
      "One disclosure per preparer, handed over at the first meeting before any work.",
      "List only exams that were taken AND passed.",
      "Keep the signed copy in the client file.",
      "Make sure the same information is on the firm website.",
      "Check whether the Maryland law was extended before July 1, 2027."
    ]
  },
  "client_privacy_notice": {
    "level": "READY",
    "why": "The government's model privacy form with the firm's facts filled in; safe as long as the firm really shares information only for the allowed reasons.",
    "triggers": [
      "The firm starts sharing client information for any new reason (selling it, marketing by others, an affiliate company).",
      "The firm has an affiliate company (the form will not save).",
      "The firm wants to add sections to the form (the model form allows only those shown)."
    ],
    "checklist": [
      "Give it to every individual client for personal return work, at engagement, in writing.",
      "Have the client sign the receipt line (or confirm receipt in the portal) and keep it in the client file.",
      "Do not rely on a sign in the office, an oral explanation or the website page alone.",
      "No yearly notice is needed while sharing stays within the allowed reasons.",
      "Compare once with the CFPB sample model form before the first printing."
    ]
  },
  "ein_closure_letter": {
    "level": "READY",
    "why": "A short letter whose conditions are easy to check; the IRS simply refuses if returns are missing.",
    "triggers": [
      "The company only sold its assets and still exists.",
      "Final returns or taxes are still outstanding.",
      "The entity must also be dissolved with the State."
    ],
    "checklist": [
      "Answer 'all returns filed and taxes paid' Yes only if true.",
      "Use the exact legal name and the EIN from the IRS notice.",
      "Enclose a copy of the CP 575 or 147C notice if you have it.",
      "An owner or officer signs; mail to Cincinnati, OH 45999.",
      "Keep a copy, the mail receipt and the IRS reply."
    ]
  },
  "ach_authorization": {
    "level": "CARE",
    "why": "Safe if bank numbers are handled by hand on paper and the customer's cancel and notice rights are respected.",
    "triggers": [
      "The debit repays a loan or installment plan.",
      "The customer or bank is outside the United States.",
      "The amount changes a lot from month to month and the account is personal.",
      "The customer disputes a debit or says it was not authorized."
    ],
    "checklist": [
      "Sign on paper; the customer writes the routing and account numbers by hand.",
      "Never email or type the full bank numbers into the system.",
      "Check the amount, first date and cancel contact.",
      "Give the customer a signed copy; for a personal account, keep any returned-debit fee at $35 or less.",
      "Keep the signed copy locked up for 2 years after it ends."
    ]
  },
  "general_poa": {
    "level": "LAWYER",
    "why": "A general power over a person's money and property; strict Maryland signing rules and banks may refuse it.",
    "triggers": [
      "The client wants the agent to sell or mortgage a home or other real property",
      "Gifts, borrowing, or a start only on incapacity are ticked, or the estate is large",
      "A business, trust or inheritance is involved, or family members disagree",
      "The client may be unable to understand the document, or signs outside Maryland or by video"
    ],
    "checklist": [
      "Sign on paper, in Maryland, in front of a notary and two adult witnesses",
      "The agent and backup agent are never the witnesses",
      "Read every ticked power back to the client; untick what was not asked for",
      "Do not tell a bank it must accept this form; if it refuses, use Maryland's statutory form",
      "Record the original if real property is involved"
    ]
  },
  "business_poa": {
    "level": "CARE",
    "why": "Gives an agent bank and operating power; safe when powers are narrow and the signer clearly has authority.",
    "triggers": [
      "Borrowing, property, sale or ownership change, or gifts are ticked",
      "The business has several owners and no written resolution exists",
      "The agent is not an employee or family member the owner knows well, and no dollar limit is set",
      "The client is a sole proprietor (use the personal power of attorney instead)"
    ],
    "checklist": [
      "Confirm the signer is an owner, managing member or officer who may appoint an agent",
      "Attach a written resolution if there is more than one owner",
      "Untick every power the agent does not need",
      "Set a withdrawal limit and an approval amount unless the agent is an owner",
      "Bring the Articles, EIN letter and resolution for the bank; it may want its own form"
    ]
  },
  "limited_poa_filings": {
    "level": "READY",
    "why": "The firm's own routine paper: narrow, no access to money, and offices with their own forms still need them.",
    "triggers": [
      "An office refuses it and demands its own form that the owner will not sign",
      "The client asks the firm to sign something that an owner or officer must sign personally"
    ],
    "checklist": [
      "Tick only what this client needs",
      "Also get Maryland Form 548, the unemployment-insurance form, the SNAP representative letter or IRS Form 2848 signed where those offices apply",
      "The owner or officer signs the SDAT annual report and any form that calls for an owner or officer",
      "Sole proprietor: turn on the switch and use two adult witnesses",
      "Check the firm phone numbers and email printed on the form are current"
    ]
  },
  "gift_letter": {
    "level": "READY",
    "why": "A short, standard lender document; the main risk is the lender rejecting it, not liability.",
    "triggers": [
      "The donor is the seller, builder, agent or anyone with an interest in the sale",
      "The donor is not a relative, partner or close family-like friend",
      "The gift is for an investment property"
    ],
    "checklist": [
      "Ask the lender first; some insist on their own form",
      "Confirm the donor is someone the lender accepts and has no interest in the sale",
      "Keep the donor's bank statement and the wire, check or deposit record",
      "Write only the last 4 digits of any account",
      "Gift above $19,000 to one person in 2026: tell the donor to ask the tax preparer about Form 709"
    ]
  },
  "affidavit_general": {
    "level": "CARE",
    "why": "A sworn statement: simple to produce, but the signer faces perjury if any fact is wrong.",
    "triggers": [
      "It will be filed in a lawsuit, a summary-judgment motion or other court case",
      "It concerns immigration, custody, or accuses another person of wrongdoing",
      "An agency or bank supplies its own affidavit form",
      "The signer cannot read English well"
    ],
    "checklist": [
      "The signer signs and dates only in front of the notary; never pre-sign",
      "Only facts the client gave; staff add nothing",
      "Choose personal knowledge for anything going to a court",
      "Each statement is something the signer saw or did, not an opinion or hearsay",
      "Notary checks photo ID and completes the jurat"
    ]
  },
  "child_travel_consent": {
    "level": "CARE",
    "why": "Useful and low-risk when both parents agree; wrong tool if the family is in a custody dispute.",
    "triggers": [
      "A custody dispute, a court order limiting travel, or a parent who objects or cannot be reached",
      "The child is moving abroad, or the trip is one-way or very long",
      "The signer is a guardian rather than a parent",
      "The destination or airline requires an apostille, a translation, or its own form"
    ],
    "checklist": [
      "If the child travels with another adult or alone, both parents sign",
      "Each parent signs in front of a notary and brings photo ID",
      "Check passport numbers and travel dates against the tickets",
      "For sole custody or a deceased parent, attach the court order or death certificate",
      "Check the destination country's and the airline's rules before the trip"
    ]
  },
  "employment_verification_letter": {
    "level": "READY",
    "why": "A one-page letter of facts; safe if the employee has asked for it and nothing extra is said.",
    "triggers": [
      "The employee has not asked for or allowed the letter",
      "A lender or agency asks for reasons for leaving, discipline, health or immigration details"
    ],
    "checklist": [
      "Keep the employee's written request",
      "Check job title, start date and hours against payroll records",
      "Include pay only if the employee asked, and say before or after taxes",
      "Never include a Social Security number or date of birth",
      "Signed by the owner or an officer, with a working phone number"
    ]
  },
  "resignation_letter": {
    "level": "READY",
    "why": "A short neutral letter that needs no approval; nothing in it creates new obligations.",
    "triggers": [
      "The employee is leaving over unpaid wages, harassment, discrimination, a safety problem, or because they were pushed out",
      "The employee has a contract with a notice period or a non-compete"
    ],
    "checklist": [
      "Keep it short and neutral; no complaints",
      "Give the notice the job normally expects, often two weeks",
      "Last day of work is on or after the letter date",
      "Add a mailing address for the final pay and tax forms if it has changed",
      "Keep a signed or emailed copy and note the delivery date"
    ]
  },
  "llc_operating_agreement": {
    "level": "CARE",
    "why": "Thorough, current draft for a small multi-member LLC; safe when the facts and the tax choice are right, but it creates long-term rights between owners.",
    "triggers": [
      "More than four members, or any member is a company or a trust.",
      "Members are paid or share profit in unequal ways, or put in real estate or more than about $50,000.",
      "A member lives outside Maryland, or the members already disagree.",
      "Choosing S corporation when any member is not an individual."
    ],
    "checklist": [
      "Ownership percentages total 100 and names and capital amounts match the bank records.",
      "Tax choice matches the IRS record: S corporation only if Form 2553 was accepted or is being filed.",
      "Manager-run LLC: ask whether the SDAT articles say members are not agents.",
      "Tell the members: equal votes can deadlock, and a member who wants out has no right to be bought out.",
      "Licenses, lease and loans: list who must be told when owners change."
    ]
  },
  "partnership_agreement": {
    "level": "LAWYER",
    "why": "Each partner is personally liable for all business debts; an LLC is usually the safer structure and the audit and buyout terms are intricate.",
    "triggers": [
      "More than three partners, or a partner is a company or a trust.",
      "Real estate, a franchise or an alcohol or lottery license is in the partnership's name.",
      "Partners put in very unequal capital, or a partner lives outside Maryland.",
      "The partners have not been told they are personally liable for all debts."
    ],
    "checklist": [
      "Explain unlimited personal liability and offer an LLC instead; the business name must not end in LLC, Inc. or Corp.",
      "Profit shares total 100 and capital amounts are right.",
      "The notice period and buyout choice are explained to every partner.",
      "Register the trade name with SDAT if it is not the partners' own names.",
      "List licenses, lease and loans that need notice when a partner changes."
    ]
  },
  "profit_sharing_agreement": {
    "level": "CARE",
    "why": "Short and safe as a side agreement that follows ownership; the main risk is an S corporation paying owners unequally.",
    "triggers": [
      "Any owner is to receive more than their ownership share, or a preferred return.",
      "S corporation with any unequal or early payment to one owner.",
      "Investors or lenders limit distributions."
    ],
    "checklist": [
      "Percentages total 100 and match the operating agreement, partnership agreement or share ownership.",
      "Business type is correct (LLC, S corporation, C corporation, partnership).",
      "Read the business's own governing document: it controls if it conflicts.",
      "Name an accountant other than the firm to settle number disputes if the firm keeps the books.",
      "Payment method and days after close are realistic."
    ]
  },
  "single_member_llc_agreement": {
    "level": "READY",
    "why": "One owner, short, and follows the Maryland LLC Act on death and incapacity; ordinary risks only.",
    "triggers": [
      "Anyone else owns any part of the LLC (use the LLC Operating Agreement).",
      "The LLC owns real estate or holds an alcohol or lottery license.",
      "A lender or landlord requires its own form."
    ],
    "checklist": [
      "Exactly one owner, and the formation date matches the SDAT record.",
      "The 'who takes over' name is someone the owner chose; blank follows the default.",
      "The owner's will and power of attorney match the plan.",
      "The LLC is a Maryland LLC; otherwise have the wording checked.",
      "Tell the owner to talk to the tax preparer before any S corporation election."
    ]
  },
  "corporate_resolution": {
    "level": "READY",
    "why": "A routine record of a decision; the risk is only ticking boxes that are not true or using the wrong deciding body.",
    "triggers": [
      "Shareholders or members sign by fewer than all.",
      "It sells the business or major assets, changes the charter, or merges.",
      "The only director or manager is the interested person."
    ],
    "checklist": [
      "Deciding body matches the company (board or shareholders for a corporation; members or manager for an LLC).",
      "'Every person signs' is ticked only if every voter signs; tick quorum only if it was present.",
      "Dividend box: ticked only if the board checked the company can pay its debts afterward.",
      "Bonus, loan or lease with an owner: fill in the interested-person boxes.",
      "A bank may insist on its own form; have an officer sign the certificate."
    ]
  },
  "annual_meeting_minutes": {
    "level": "READY",
    "why": "A simple record of what happened; safe if staff tick only what really took place.",
    "triggers": [
      "A director or officer is removed, or the vote is disputed.",
      "Shares are issued or bought back.",
      "An S corporation pays owners unequal amounts."
    ],
    "checklist": [
      "The company is a corporation (an LLC should use a Company Resolution).",
      "Quorum, notice, approvals and reviews are ticked only if they really happened.",
      "Share counts are filled in only if known; represented shares are not more than shares entitled to vote.",
      "Pay and dividends appear only for a board meeting; a dividend needs the board's solvency check.",
      "The secretary and chair read and sign."
    ]
  },
  "ownership_transfer": {
    "level": "LAWYER",
    "why": "Moves ownership of a possibly licensed business; licenses, S status, other owners' rights and filings can each undo the deal.",
    "triggers": [
      "The company holds a tobacco, alcohol, lottery or SNAP license, or owns real estate.",
      "The price is over about $25,000, is paid over time, or the transfer is a gift of real value.",
      "Another owner objects, the Transferor is in a divorce, or either side lives outside Maryland.",
      "S corporation and the new owner is not clearly an eligible individual."
    ],
    "checklist": [
      "Read the operating agreement or bylaws for consent and first-refusal rights; tick consent only if signed.",
      "Leave the price blank only for a gift.",
      "Percent before minus percent transferred equals percent kept.",
      "Call each licensing agency before signing.",
      "Ask the tax preparer about S status, year-end split and Form 8822-B."
    ]
  },
  "personal_guaranty": {
    "level": "CARE",
    "why": "Fine for a clearly described small debt; the guarantor puts personal assets at risk, so the document must match the loan or lease.",
    "triggers": [
      "Amount over about $25,000, or it supports a mortgage, a bank loan or a multi-year lease (use the lender's form).",
      "The guarantor is a spouse or relative who is not an owner.",
      "A dispute already exists."
    ],
    "checklist": [
      "The guarantor has read the loan or lease and understands they can lose personal property.",
      "The debt is described exactly: date, amount and document name; consider a cap.",
      "Consumer loan: switch on the box and hand over the detached Notice to Cosigner before signing.",
      "Signed by hand; no seal box on a consumer guaranty.",
      "Give the guarantor a signed copy."
    ]
  },
  "non_compete": {
    "level": "LAWYER",
    "why": "Maryland voids no-competes for lower-paid workers, and enforcement of the rest depends on facts; a wrong form gives false comfort.",
    "triggers": [
      "The worker earns more than $22.50 an hour, or the person is selling a business.",
      "A licensed health-care worker or veterinarian.",
      "The person lives outside Maryland, or you want to enforce it against someone who already left.",
      "An employee signs without a raise or bonus."
    ],
    "checklist": [
      "Answer the pay question honestly; at $22.50 an hour or less choose 'No' and the no-compete part drops out.",
      "Use 'Not applicable' only for the seller of a business, and enter the sale date.",
      "An existing employee gets something new in return, written in the box.",
      "Do not label a real employee as a contractor.",
      "Keep months and miles modest and the activity narrow."
    ]
  },
  "business_bill_of_sale": {
    "level": "CARE",
    "why": "Safe for a small asset sale if the bulk-transfer notice, licences and tax steps are followed in the right order.",
    "triggers": [
      "Price over $100,000, or the seller owes sales tax, payroll tax or large debts",
      "An alcohol licence, real estate or a lease with a personal guarantee is part of the deal",
      "The Comptroller or a creditor sends a claim, or the buyer cannot show the 10-day notice went out",
      "Seller or buyer lives outside Maryland, or the seller is a company being dissolved"
    ],
    "checklist": [
      "Bulk-transfer notice sent by certified mail at least 10 days before any payment or possession; tick 'already sent' only with proof",
      "Seller's creditor list signed and sworn before a notary",
      "Seller asked the Comptroller for a written sales-tax account statement",
      "Buyer applied for its own licences (tobacco, lottery, SNAP, health, sales tax, alcohol); no restricted stock moves first",
      "Vehicles have their own title transfer; the price split is agreed for IRS Form 8594"
    ]
  },
  "business_sale_agreement": {
    "level": "LAWYER",
    "why": "Selling a whole store involves bulk-transfer, licences, the lease, tax and a non-compete; a good first draft, not a finished deal.",
    "triggers": [
      "Price over $100,000, or any seller financing with personal guarantees",
      "Alcohol licence, real estate, or a lease the landlord will not clearly consent to",
      "The seller owes taxes or creditors, or the Comptroller files a claim",
      "Seller or buyer is out of state, a trust or estate, or the deal is contested"
    ],
    "checklist": [
      "Bulk-transfer notice, creditor list and tax holdback handled before any money is released",
      "Deposit held by a lawyer or escrow agent, not paid to the seller",
      "Landlord's written consent to the lease assignment, with no rent overdue",
      "Buyer's own licences applied for early; nothing restricted changes hands before approval",
      "Price split (equipment, inventory, goodwill, non-compete) agreed with the tax preparer"
    ]
  },
  "letter_of_intent": {
    "level": "READY",
    "why": "Non-binding outline of a deal; the only binding parts are confidentiality, the optional exclusive period and costs.",
    "triggers": [
      "Either side wants the price or other terms to be binding",
      "An exclusive period longer than 60 days, or a large non-refundable payment with the letter",
      "Real estate or an alcohol licence is part of the deal"
    ],
    "checklist": [
      "Both sides understand the letter does not oblige them to sell or buy",
      "Exclusive period switched on only if the seller really agrees to it",
      "Assets, price and closing date match what the parties actually said",
      "Licences, landlord consent and the bulk-transfer notice are planned early"
    ]
  },
  "sales_agreement": {
    "level": "CARE",
    "why": "Fine for ordinary equipment or stock sales; consumer buyers, vehicles and remedy limits need the checklist.",
    "triggers": [
      "Price over $25,000, or goods that are dangerous or regulated",
      "A consumer buying a used vehicle (over 6 model years old and 60,000 miles) or any limit on a consumer's remedies",
      "Goods shipped abroad, or the buyer or seller is out of state",
      "Seller is selling on credit or wants a lien on the goods"
    ],
    "checklist": [
      "Consumer-sale question answered correctly; if yes, 'as is' and refund-only limits are not used",
      "Goods described exactly (model, serial numbers, quantities)",
      "Vehicle, boat or trailer: title signed over, odometer statement done, MVA form attached if required",
      "Sales tax choice matches the buyer's exemption certificate, if any",
      "Delivery place and date, and who pays shipping, filled in"
    ]
  },
  "termination_of_purchase": {
    "level": "CARE",
    "why": "Cancelling a sale is simple if money, goods and filings are all dealt with; gaps there cause the disputes.",
    "triggers": [
      "The buyer already took over the business, paid rent or ran it",
      "A bulk-transfer notice, licence application or lease assignment was already filed",
      "A deposit is held by a broker or escrow agent who has not agreed in writing",
      "The seller keeps more than a modest part of what was paid"
    ],
    "checklist": [
      "Refund or kept amount, and the date, filled in correctly",
      "Goods, keys and papers to be returned listed exactly",
      "Each filing to undo listed in the optional box (licences, lease, Comptroller and creditor notice)",
      "Deposit holder named and has confirmed the release in writing",
      "Both parties understand the release covers all claims about the sale except fraud"
    ]
  },
  "termination_agreement": {
    "level": "READY",
    "why": "Ends a named contract on agreed terms; routine once the contract and any payment are described exactly.",
    "triggers": [
      "The contract is a lease, a loan, an employment contract or involves real estate",
      "A lien, licence or public filing was made because of the contract",
      "Money is still disputed, or one side is not sure what it is giving up"
    ],
    "checklist": [
      "Contract named exactly, with its title and date",
      "Everything owed is settled; amount, payer and due date correct if there is a settlement payment",
      "Anything that must continue (confidentiality, return of property) listed",
      "Guarantor named so that person signs too",
      "Both parties signed and each has a copy"
    ]
  },
  "property_sale_residential": {
    "level": "LAWYER",
    "why": "Selling a home: statutory notices, disclosure rights, deposit rules and tax withholding; it needs a title company or real-estate lawyer.",
    "triggers": [
      "Any home sale unless a title company or real-estate lawyer handles the closing",
      "Seller financing, ground rent, a condominium or HOA, or a home built before 1978",
      "Seller is a non-resident, a company, a trust or an estate, or owners are divorcing",
      "Estate, foreclosure or other exempt sale, or the buyer or seller is a minor",
      "A lawyer or title company prepares the deed and settlement — Maryland treats preparing an instrument that affects title to real estate as practicing law (Business Occupations and Professions §10-101(h))."
    ],
    "checklist": [
      "Maryland disclosure or disclaimer statement given to the buyer and signed for before the contract",
      "Every owner on the deed signs (both spouses if they own together)",
      "All last-step questions answered: tax status, condo or HOA, well, pre-1978, county",
      "Deposit holder, closing date and title company named",
      "Lead-paint papers attached for a pre-1978 home; condo or HOA papers delivered on time"
    ]
  },
  "property_sale_commercial": {
    "level": "LAWYER",
    "why": "A commercial building sale has large money, tenant, zoning and environmental risks; use as a first draft with a lawyer and title company.",
    "triggers": [
      "Any sale over $250,000, or any property with tenants",
      "Seller financing, a 1031 exchange, or an environmental concern (gas station, dry cleaner, industrial)",
      "Zoning or a permit the buyer needs is uncertain",
      "Seller or buyer is a company whose authority has not been checked, or is out of state",
      "A lawyer or title company prepares the deed and settlement — Maryland treats preparing an instrument that affects title to real estate as practicing law (Business Occupations and Professions §10-101(h))."
    ],
    "checklist": [
      "Tenant list, rents, deposits and lease end dates complete and checked against the leases",
      "Due-diligence days, intended use and zoning filled in",
      "Every owner signs; companies sign through an officer with a title and proof of authority",
      "Deposit holder and title company named; wire details confirmed by telephone",
      "Business, licences and inventory handled in a separate Sale of a Business Agreement"
    ]
  },
  "lease_termination_agreement": {
    "level": "READY",
    "why": "Ends a lease by agreement; routine once every tenant signs and the deposit rules for a home are followed.",
    "triggers": [
      "The tenant is leaving because of abuse, military orders or a dispute with the landlord",
      "The tenant refuses to leave or the landlord wants to force the tenant out",
      "A large deposit is in dispute, or a lender or other owner must also agree"
    ],
    "checklist": [
      "Every tenant on the lease is named and signs; guarantor signs too",
      "Home or business lease chosen correctly",
      "End date, final payment and deposit treatment filled in",
      "Home: the tenant's new mailing address is written down",
      "Keys returned and a move-out inspection date agreed"
    ]
  },
  "lease_residential": {
    "level": "CARE",
    "why": "Landlord duties are strict (deposit, entry, lead, attachments). The form covers them if staff attach and fill in the papers.",
    "triggers": [
      "Subsidized or Section 8 housing, or a city or county with rent rules or a license you have not checked",
      "Home built before 1978 where lead hazards are known, or a child under 6 lives there",
      "The tenant already has a lawyer, or there is a dispute, eviction or unpaid-rent claim",
      "Home partly used as a shop or office (mixed use)"
    ],
    "checklist": [
      "Current Maryland Tenants' Bill of Rights is uploaded in settings (new edition each October 1) and prints with the lease",
      "Hand the tenant the State mold pamphlet at signing",
      "Pre-1978 answer is correct; MDE lead papers given and the inspection certificate number and date written in",
      "Deposit is no more than one month's rent and the signed deposit receipt goes to the tenant",
      "Rental license number, landlord phone and all tenant names are filled in"
    ]
  },
  "lease_commercial": {
    "level": "LAWYER",
    "why": "Multi-year, high-dollar contract. Rent type, guarantee, renewal and default choices carry real risk. A good first draft.",
    "triggers": [
      "Total rent over the term above about $250,000, or a term over 5 years",
      "An owner personally guarantees the lease",
      "The term with renewals can pass 7 years (recording rule) or the landlord brings its own lease",
      "The space needs a build-out, or a tobacco, alcohol, lottery or food license tied to the location"
    ],
    "checklist": [
      "Rent type (who pays taxes, insurance, common areas), yearly increase and deposit match the deal the client agreed",
      "Renewal terms say how the new rent is set (not just 'market rent')",
      "Address, suite and legal description match the deed or tax record",
      "Tenant's licenses and permits are in the tenant's own name",
      "Guarantor, if any, has been told in plain words that they owe all rent for the whole term"
    ]
  },
  "commercial_lease_short": {
    "level": "CARE",
    "why": "Fine for a small space and a short term. Larger or longer deals need the full lease or a lawyer.",
    "triggers": [
      "Term over about 3 years, or rent over about $5,000 a month",
      "An owner personally guarantees the lease",
      "Term with renewals can pass 7 years (memorandum must be recorded)",
      "The landlord has its own lease form, or the tenant will build out the space"
    ],
    "checklist": [
      "Taxes and building insurance: who pays is chosen correctly",
      "Start, end, rent, deposit and renewal match the deal",
      "Use clause matches what the business really does, and licenses are in the tenant's name",
      "Both sides' notice addresses are filled in",
      "Company signers are officers with a title"
    ]
  },
  "commercial_sublease": {
    "level": "CARE",
    "why": "Depends entirely on the master lease and the landlord's written consent. Safe if both are in hand.",
    "triggers": [
      "The master lease bans subletting or the landlord will not sign the consent page",
      "The master lease is in default, or ends within a few months",
      "The sublease runs to the last day of the master lease with renewals, or past 7 years",
      "A personal guarantee or a large deposit is part of the deal"
    ],
    "checklist": [
      "Read the master lease; copy attached to the sublease",
      "Landlord signed the consent page BEFORE the subtenant moves in",
      "Sublease end date is on or before the master lease end date (enter that date)",
      "Rent, who is paid and utilities match the master lease",
      "Subtenant holds its own licenses (a sublease does not transfer them)"
    ]
  },
  "lease_amendment": {
    "level": "CARE",
    "why": "Simple for a business extension. For a home, rent-increase notice, deposit and lead rules apply.",
    "triggers": [
      "Home lease where the landlord has not yet given the written rent-increase notice",
      "Original lease is missing, unsigned or unclear",
      "The change is large (a new use, a big rent jump, a change of tenant)",
      "Business lease extended so the total term with renewals passes 7 years"
    ],
    "checklist": [
      "At least one change is filled in (turn off Extend if only the rent changes)",
      "Home or business is chosen correctly",
      "Original lease date and premises address match the original lease exactly",
      "Home: notice date entered, new rent starts after 90 days (fixed term) or 60 days (month to month), deposit still no more than one month's rent",
      "Guarantor and every tenant sign"
    ]
  },
  "promissory_note": {
    "level": "CARE",
    "why": "Routine for a simple loan. Interest limits and the loan statement are the traps.",
    "triggers": [
      "Interest above 8% a year on a loan to a person, or a business loan of $15,000 or less",
      "The note is secured by real estate or by the borrower's home",
      "The lender makes loans often (more than three a year) or the loan is over about $50,000",
      "The borrower is a consumer or a family member and the amount is large"
    ],
    "checklist": [
      "Rate is 8% or less unless the borrower is a corporation or the loan is a business loan over $15,000",
      "Finance-charge box filled in for an interest-bearing loan, and a copy given to the borrower BEFORE signing",
      "Number of payments x payment amount agrees with the amount borrowed and the dates",
      "Both parties sign; use a separate document for any mortgage or vehicle lien",
      "Related-party loan with low interest: tell the tax preparer"
    ]
  },
  "loan_agreement": {
    "level": "CARE",
    "why": "Sound for a straightforward private loan. Rate limits, the loan statement and security need care.",
    "triggers": [
      "Amount over about $100,000, or secured by real estate or the borrower's home",
      "Interest above 8% a year to an individual, or the lender regularly lends",
      "A guarantor or co-signer is needed",
      "The borrower is a consumer, or a party is outside Maryland"
    ],
    "checklist": [
      "Rate 8% or less unless the borrower is a corporation or it is a business loan over $15,000",
      "Finance-charge box filled in (loan statement) and given to the borrower BEFORE signing, if the loan is not exempt",
      "Every borrower is listed with an address; each is responsible for the whole loan",
      "Payments, first date, final date and funding date agree",
      "Collateral, if any, is described by serial number or VIN"
    ]
  },
  "shareholder_loan_agreement": {
    "level": "READY",
    "why": "Routine owner loan that the firm handles every day. Facts and the interest rate are what matter.",
    "triggers": [],
    "checklist": [
      "Direction is correct (owner to company, or company to owner)",
      "Rate is at or above the IRS applicable federal rate, or no-interest is confirmed by the tax preparer",
      "Approval by the other owners or the board is named",
      "Company keeps a written record of every advance and repayment",
      "Company to owner: loan statement filled in and given before signing"
    ]
  },
  "nda_mutual": {
    "level": "READY",
    "why": "Short, balanced and standard. It includes the required whistleblower paragraph.",
    "triggers": [],
    "checklist": [
      "Purpose line describes the real reason for sharing",
      "Both parties' full legal names and addresses are correct",
      "Confidentiality period fits the information (default 3 years)",
      "Do not use it to share a client's tax return information (needs the client's own consent)",
      "Both parties sign"
    ]
  },
  "offer_letter": {
    "level": "READY",
    "why": "Plain at-will offer that also gives the written notices Maryland requires at hiring; risks are ordinary.",
    "triggers": [
      "Employee is under 18",
      "Offer promises commission, equity, severance or a fixed term",
      "Work is done outside Maryland",
      "Offer includes a non-compete"
    ],
    "checklist": [
      "Pay is at least $15.00 an hour (or the county minimum) and the regular payday is filled in",
      "Count employees (part-time and seasonal included) before choosing paid or unpaid sick leave",
      "Do not call a salaried job exempt from overtime unless its duties qualify",
      "Give the employee the State's sick-leave notice and collect Forms W-4, MW507 and I-9",
      "Keep a signed copy"
    ]
  },
  "contractor_agreement": {
    "level": "CARE",
    "why": "Sound contract, but calling someone a contractor does not make them one; the facts decide.",
    "triggers": [
      "Construction or landscaping work done through a business entity",
      "The person works your regular shifts at your store or under your supervision",
      "Large contract (for example over $25,000)",
      "The contractor will create software, designs or other work your client must own outright"
    ],
    "checklist": [
      "Tick the Independence boxes only if they are true; if most are not, use the Employment Agreement",
      "Get a signed Form W-9 before the first payment",
      "File Form 1099-NEC once payments reach $2,000 in a year",
      "Write down the insurance and licenses the work needs",
      "Construction or landscaping: tick that box and hand over Maryland's classification notice in English and Spanish"
    ]
  },
  "employment_termination_letter": {
    "level": "READY",
    "why": "Neutral separation letter with the legally required final-pay and benefits statements; the risk is the decision, not the letter.",
    "triggers": [
      "Employee recently complained about pay, safety or discrimination",
      "Employee took protected leave, was hurt, is pregnant or has a pending claim",
      "Employee has a written contract or a union",
      "Several people are laid off at the same time"
    ],
    "checklist": [
      "Final-pay date is no later than the day the employee would have been paid had employment continued",
      "No deduction for unreturned property without a signed written authorization",
      "Keep any reason short and neutral; never mention leave, injury, pay complaints or medical matters",
      "Send the plan's own notice if the employee has group health coverage",
      "Give a copy to the employee and keep one"
    ]
  },
  "employment_contract": {
    "level": "CARE",
    "why": "Fuller at-will agreement; its promises (leave, insurance, pay terms) bind the client, so the facts must be right.",
    "triggers": [
      "Employee is under 18 or works outside Maryland",
      "Manager with equity, profit share, severance or a fixed term",
      "Anyone asks for a non-compete or commission/bonus formula",
      "The business has no workers' compensation insurance"
    ],
    "checklist": [
      "Pay is at least the minimum wage and the regular payday is filled in",
      "Count employees before choosing paid or unpaid sick leave",
      "Confirm the business really carries workers' compensation insurance (Labor and Employment Article section 9-402)",
      "Do not mark a salaried job exempt from overtime unless its duties qualify",
      "Keep non-compete, bonus and equity wording out of the Additional terms box"
    ]
  },
  "employee_warning_letter": {
    "level": "CARE",
    "why": "The form is safe; the danger is what staff write in it, because discipline after protected activity can be retaliation.",
    "triggers": [
      "Employee recently complained, asked for leave or an accommodation, was hurt or is pregnant",
      "Employee has a written contract or a union",
      "Final warning that will probably lead to firing",
      "The issue involves harassment or discrimination"
    ],
    "checklist": [
      "Dates and facts only, no opinions or guesses about motives",
      "The issue does not involve sick or safe leave, an injury, a pay complaint or pay talk, or medical information",
      "Follow the handbook's discipline steps if it has any",
      "Give the employee a copy and keep one",
      "If the employee refuses to sign, a witness notes it on the form"
    ]
  },
  "workplace_incident_report": {
    "level": "READY",
    "why": "An internal record only; it does not replace the MOSH, insurer and Workers' Compensation Commission reports.",
    "triggers": [
      "Someone died or was seriously hurt",
      "A customer or visitor makes a claim against the business",
      "A government inspector asks for the report"
    ],
    "checklist": [
      "Complete it the same day, facts only, no guesses about fault",
      "Employee died, hospitalized, lost a limb or an eye: call MOSH (8 hours for a death, 24 hours for the rest)",
      "Employee injury: tell the workers' compensation insurer at once",
      "Keep it in a separate incident file, not the personnel file",
      "Take photographs and write down witness names"
    ]
  },
  "service_agreement": {
    "level": "CARE",
    "why": "Balanced general services contract; fine for small, simple jobs, not for home improvement or high-risk work.",
    "triggers": [
      "Home improvement for a homeowner (Maryland Home Improvement Law needs terms this form lacks)",
      "Large contract (for example over $25,000)",
      "Provider will handle your client's tax or customer data",
      "Work that could injure someone (food, security, equipment, vehicles)"
    ],
    "checklist": [
      "Decide which side your client is; leave the liability-cap box off if your client is the customer",
      "The Services box states exactly what is done, by when, and what the price covers",
      "Get the provider's license and insurance if the work needs them, and a Form W-9 before paying",
      "Check the provider is truly independent; if not, use the Employment Agreement",
      "Construction or landscaping: tick that box and give the State's classification notice"
    ]
  },
  "consulting_agreement": {
    "level": "CARE",
    "why": "Balanced consulting contract; fine for ordinary business advice, but not where a professional license or serious loss is involved.",
    "triggers": [
      "The advice is legal, medical, engineering or financial",
      "Construction or landscaping work through a business entity",
      "Large fee (for example over $25,000)",
      "Consultant will see customer or tax data"
    ],
    "checklist": [
      "Decide which side your client is; leave the liability-cap box off if your client is the Company",
      "The Work box states exactly what is delivered; fee and invoice dates are clear",
      "Get a Form W-9 before paying; file Form 1099-NEC once payments reach $2,000 in a year",
      "Check the consultant is truly independent; if not, use the Employment Agreement",
      "Ask whether the advice needs a Maryland license"
    ]
  }
};
