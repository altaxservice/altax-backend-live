/**
 * The firm's canonical list of service lines, plus the built-in engagement-letter
 * text for each — mirrors templates.routes.ts's BUILT_IN/override pattern exactly:
 * this content is the code-level fallback; saving a template with the same
 * service_key in v3_contract_templates overrides it (see resolveContractTemplate
 * in contracts.routes.ts), so wording can be tightened without a deploy.
 *
 * Every generated contract is SERVICE-SPECIFIC SCOPE (this file, varies per
 * service) + GENERAL_TERMS (this file, shared, appended once) — kept as two
 * pieces rather than a dozen duplicated copies of the boilerplate so a change to
 * the shared liability/e-sign/governing-law language only has to happen once.
 * Each piece is English followed by an Arabic edition after a divider line
 * ("النسخة العربية — Arabic Translation"); contracts.routes.ts joins them as
 * scope EN + general terms EN, then scope AR + general terms AR.
 *
 * Placeholders filled by contracts.routes.ts: {{clientName}}, {{firmName}},
 * {{effectiveDate}}, {{feeAmount}} (English fee line), {{feeAmountAr}} (the
 * same line with an Arabic fallback phrase), {{authorizedFilings}} (poa_release).
 *
 * Standard of this file (fifth audit pass, 2026-10-15): every legal statement
 * is checked against the primary text (Maryland Code, eCFR, IRS publications),
 * promises only what the firm really does (the app has a WISP; the firm never
 * holds client money), and is true whatever credentials the staff hold. It is
 * standard-form template language; the firm is not a law firm (Bus. Occ. & Prof.
 * §10-101(h), §10-601), and none of these documents gives legal advice.
 */

export interface FirmService {
  key: string;
  label: string;
  /**
   * Kept for label lookups (existing clients/contracts still reference this
   * key) but no longer offered when checking NEW services on a client — split
   * into personal_tax_prep/business_tax_prep instead. Never remove a key or
   * repoint it once clients have data against it; just stop offering it.
   */
  legacy?: boolean;
}

export const FIRM_SERVICES: FirmService[] = [
  { key: "tax_prep", label: "Tax Preparation", legacy: true },
  { key: "personal_tax_prep", label: "Personal Tax Preparation" },
  { key: "business_tax_prep", label: "Business Tax Preparation" },
  { key: "bookkeeping", label: "Bookkeeping & Accounting" },
  { key: "payroll", label: "Payroll Services" },
  { key: "payroll_processing", label: "Payroll Processing" },
  { key: "form_941_filing", label: "Federal Payroll Tax (941) Filing" },
  { key: "md_withholding_filing", label: "State Withholding Filing" },
  { key: "w2_1099_prep", label: "W-2 / 1099 Preparation" },
  { key: "md_ui_filing", label: "State Unemployment Insurance Filing" },
  { key: "eftps_setup", label: "Federal Tax Deposit Setup (EFTPS)" },
  { key: "sales_tax", label: "Sales Tax & Business Compliance" },
  { key: "sales_use_tax_filing", label: "Sales & Use Tax Filing" },
  { key: "annual_report_filing", label: "Annual Report Filing" },
  { key: "notice_resolution", label: "IRS/State Notice Resolution" },
  { key: "formation", label: "Business Formation & Registered Agent" },
  { key: "business_transfer", label: "Business Transfer Documents (Bill of Sale, Amendments, etc.)" },
  { key: "permits_licenses", label: "Business Licenses & Permits (Health, Use & Occupancy, Trader's, Tobacco)" },
  { key: "snap_retailer_application", label: "SNAP Retailer Application" },
  { key: "immigration", label: "Immigration Form Typing & Translation" },
  { key: "consulting", label: "Other Consulting & Administrative Services" },
];

export const SERVICE_LABEL: Record<string, string> = Object.fromEntries(FIRM_SERVICES.map((s) => [s.key, s.label]));

/**
 * Auto-derives the legacy single-select Service Type label from the granular
 * Services Provided checkboxes, so the two can never drift out of sync again.
 * Before this, service_type was a fully independent, manually-set column —
 * confirmed live 2026-08-22 that 78 of 152 active clients were labeled "Full
 * Service" while missing most of the services actually checked (one had
 * zero services checked at all). service_type is no longer accepted as a
 * standalone field on client create/update (see UPDATABLE_FIELDS in
 * clients.routes.ts) — it's recomputed here whenever `services` changes.
 * Mirror of frontend/src/utils/clientOptions.ts's deriveServiceType (kept in
 * sync manually, same convention as FIRM_SERVICES/SERVICE_TYPES above it).
 */
export function deriveServiceType(services: string[] | null | undefined): string | null {
  const keys = services || [];
  if (keys.length === 0) return null;
  const hasBookkeeping = keys.includes("bookkeeping");
  const hasPayroll = keys.includes("payroll");
  const hasSalesTax = keys.includes("sales_tax");
  const hasTaxPrep = keys.includes("business_tax_prep") || keys.includes("personal_tax_prep") || keys.includes("tax_prep");
  const hasPermits = keys.includes("permits_licenses");
  const hasConsulting = keys.includes("consulting");
  const corePillars = [hasBookkeeping, hasPayroll, hasSalesTax, hasTaxPrep].filter(Boolean).length;

  if (corePillars >= 3) return "Full Service";
  if (corePillars === 1 && !hasPermits && !hasConsulting) {
    if (hasBookkeeping) return "Bookkeeping Only";
    if (hasPayroll) return "Payroll Only";
    if (hasSalesTax) return "Sales Tax Only";
    return "Tax Only";
  }
  if (corePillars === 0 && hasPermits && !hasConsulting) return "Permits & Licensing Only";
  if (corePillars === 0 && hasConsulting && !hasPermits) return "Consulting";
  return "Custom";
}

/**
 * Services that involve applying to a government agency on the client's
 * behalf — formation filings, permits/licenses, and SNAP retailer
 * authorization. Checking any of these auto-generates the Authorization to
 * Act and Release of Information alongside the ordinary engagement letter
 * (see POA_RELEASE_SERVICE_KEY below), because these are exactly the
 * agencies that won't discuss an application with anyone but the owner
 * unless the owner has put it in writing that AL TAX is authorized to act
 * and to receive that information.
 */
export const POA_COVERED_SERVICE_KEYS = ["formation", "permits_licenses", "snap_retailer_application"];

/** What each covered service authorizes, in the plain language the actual agency deals in — used to build the per-client checklist in the POA body. */
const POA_FILING_DESCRIPTIONS: Record<string, string> = {
  formation: "Articles of Incorporation/Organization and related state formation filings (e.g., EIN application)",
  permits_licenses: "Health Department permit, Certificate of Occupancy/Use & Occupancy Permit, Trader's License, and related business licenses/permits",
  snap_retailer_application: "SNAP (EBT) Retailer Authorization Application with the U.S. Department of Agriculture, Food and Nutrition Service",
};

/**
 * Builds the numbered checklist substituted into {{authorizedFilings}} on the
 * POA — only the filings this specific client actually checked, never a
 * blanket grant for work that isn't happening. Returns null (skip
 * generation entirely) if the client has none of the covered services.
 */
export function buildAuthorizedFilingsList(clientServiceKeys: string[]): string | null {
  const lines = POA_COVERED_SERVICE_KEYS
    .filter((k) => clientServiceKeys.includes(k))
    .map((k, i) => `   ${i + 1}. ${POA_FILING_DESCRIPTIONS[k]}`);
  return lines.length ? lines.join("\n") : null;
}

/**
 * Appended to every generated contract after the service-specific scope section.
 * Its own service_key ("general_terms") makes it editable through the same
 * override mechanism as everything else in this file.
 */
export const GENERAL_TERMS_KEY = "general_terms";
export const GENERAL_TERMS_TITLE = "General Terms & Conditions";

/**
 * Not a FIRM_SERVICES entry — never appears in the "Services Provided"
 * checklist a client is engaged for, and is never picked manually. It's a
 * supporting document, auto-generated alongside the engagement letter the
 * moment a client is checked for one of POA_COVERED_SERVICE_KEYS above (see
 * autoGenerateContracts in clients.routes.ts). Kept as its own named
 * constant, not folded into FIRM_SERVICES, so the two concepts — "what the
 * client is engaged for" vs. "documents the system generates on its own" —
 * can't get confused with each other later.
 */
export const POA_RELEASE_SERVICE_KEY = "poa_release";
export const POA_RELEASE_TITLE = "Authorization to Act and Release of Information";
// Bilingual for the same reason as the immigration template: this block is
// appended to every contract, and most of the firm's clients read Arabic more
// comfortably than English — a liability/fees/e-sign-consent section they
// can't actually read isn't real informed consent for any service, not just
// immigration. Same section-by-section translation, same divider convention.
//
// Fifth audit pass (2026-10-15) — what changed and why (primary sources read verbatim):
//  - Late charge: Maryland Commercial Law §14-1315 lets any contract require a "late fee" (not interest) and caps
//    it only in a CONSUMER contract (the 1.5%-a-month option, 10-point bold disclosure, not before 15 days after the
//    bill). So the late fee is now a §14-1315 late fee for BUSINESS clients only; individuals pay none.
//  - Records: 31 CFR §10.28 (client records returned on request; a document the practitioner prepared may be held
//    only "pending the client's performance of its contractual obligation to pay fees"), 26 CFR §1.6107-1(a) (a
//    signing preparer must give the taxpayer a complete copy no later than when the return is presented for
//    signature), IRS Pub. 1345 (the e-file provider must give a complete copy). Clause 5 is written to be true
//    whatever credentials the staff hold.
//  - Liability cap / indemnity / jury waiver / claims period: kept for BUSINESS clients only. Maryland will not
//    enforce a release of "intentional harms or ... reckless, wanton, or gross" negligence or one resulting from
//    grossly unequal bargaining power (BJ's Wholesale Club v. Rosen, 435 Md. 714 (2013)); a contractual shortening
//    of limitations must be reasonable and is tested for one-sidedness (Ceccone v. Carroll Home Services, 454 Md. 680
//    (2017), which sent back a one-sided one-year clause). A pre-dispute jury waiver is enforceable if knowing and
//    intelligent, which turns on conspicuousness, comprehensibility and bargaining power (Walther v. Sovereign Bank,
//    386 Md. 412 (2005); see Bank of America v. Mitchell Living Trust, 822 F. Supp. 2d 505 (D. Md. 2011)); clause 14 is
//    for Business Clients, in capitals, in its own paragraph, with a plain-language sentence and an Arabic edition. So: carve-outs for gross negligence/fraud, a 12-month
//    fee cap, a two-year MUTUAL claims period.
//  - E-sign: Maryland UETA (Commercial Law §21-104(b)(3)) — in a standard-form contract the electronic term must be
//    "conspicuously displayed and separately consented to"; 15 USC §7001(c)(1) lists the consumer statements.
//  - Ongoing monthly services: clauses 9-10 (the firm's real engagements are month to month).
export const GENERAL_TERMS_BODY = `GENERAL TERMS & CONDITIONS

These General Terms are part of the agreement described above. "Client" and "Firm" have the meanings given in the service description above. "Individual Client" means a Client who is an individual and uses the services for personal, family or household purposes. Every other Client (a company, an organization, or an individual using the services for a business) is a "Business Client." If the service description above conflicts with these General Terms, the service description controls.

1. RELIANCE ON CLIENT INFORMATION. Firm relies on the accuracy and completeness of the information, documents and instructions Client provides, and does not audit or independently verify them. Firm will ask reasonable questions if information appears incorrect, inconsistent or incomplete, and Client agrees to answer them. Firm is not responsible for errors, penalties or losses resulting from incomplete, inaccurate or late information from Client.

2. NO GUARANTEE OF OUTCOME. Firm will perform the services using reasonable professional care. Firm does not guarantee any specific result, refund amount, filing outcome, approval or government processing time, and is not responsible for delays or decisions of the IRS, any state or local agency, or any other government body.

3. CLIENT RESPONSIBILITIES. Client agrees to provide requested documents and information on time, to review everything Firm prepares before it is signed, filed or relied on, and to tell Firm promptly about changes that may affect the services. Client is responsible for paying every tax, fee, penalty and interest charge owed to any government agency by its due date. Firm does not hold, receive or pay out Client's money, and does not pay any of Client's taxes from its own funds. A payment made through an online system (such as EFTPS or a state website) is made from Client's own bank account, either by Client or, only if Client has set this up for Firm and told Firm in writing, by Firm acting at Client's direction; Client must keep enough money in the account. Client keeps its own logins and passwords for IRS, state and bank systems, shares them only as needed for these services, and tells Firm right away if one changes or may have been compromised.

4. FEES & PAYMENT. Fees for this engagement are {{feeAmount}}. A fee shown per month ("/mo") is billed every month while the service continues. If the fee is shown as to be agreed separately, Firm and Client will agree on it in writing before Firm bills for the work. Invoices are due by the due date shown on the invoice or, if none is shown, within 15 days after the invoice date. Firm may pause new work while an invoice is overdue, but will tell Client in writing which deadlines are affected and will still return Client's records as stated in section 5. Government filing fees, penalties, interest and out-of-pocket costs are not included in Firm's fee. Fees for work already performed are not refundable; if Firm ends the engagement before doing work that Client paid for in advance, Firm refunds the part not earned.

LATE FEE AND COLLECTION COSTS — BUSINESS CLIENTS ONLY. If a Business Client has not paid an invoice within 30 days after the invoice date, Firm may charge a late fee of 1.5% of the past-due amount for each month (or part of a month) that it stays unpaid, counting from that 30th day. A late fee is charged only on unpaid fees, never on earlier late fees, and it is a late fee under Maryland Commercial Law section 14-1315, not interest. A Business Client also agrees to reimburse Firm's reasonable costs of collecting an overdue invoice, including reasonable attorney's fees actually incurred, to the extent a court finds them reasonable. Firm charges an Individual Client no late fee.

5. RECORDS AND WORK PRODUCT. (a) Firm will return Client's own records (the documents Client gave Firm, and any other records the law requires Firm to return) promptly on request, even if an invoice is unpaid; Firm may keep copies. (b) Where Firm signs a return as paid preparer, Firm gives Client a complete copy when the return is presented for signature, and a copy of what is filed, whether or not an invoice is unpaid. (c) Firm may hold back other finished work product that Firm prepared and has not yet delivered (for example a financial statement or a report) until the fee for that work is paid. Firm will not hold back anything if doing so would cause Client to miss a legal filing or payment deadline, or where the law or a government agency requires Firm to deliver it; in those cases Firm delivers it and Client still owes the fee.

6. LIMITATION OF LIABILITY — BUSINESS CLIENTS ONLY.
TO THE FULLEST EXTENT THE LAW ALLOWS, FIRM'S TOTAL LIABILITY TO A BUSINESS CLIENT ARISING OUT OF OR RELATING TO THIS ENGAGEMENT, WHETHER IN CONTRACT, NEGLIGENCE OR OTHERWISE, IS LIMITED TO THE FEES THE BUSINESS CLIENT PAID FIRM FOR THE SERVICE GIVING RISE TO THE CLAIM DURING THE 12 MONTHS BEFORE THE CLAIM AROSE, AND FIRM IS NOT LIABLE FOR INDIRECT, INCIDENTAL, CONSEQUENTIAL, SPECIAL OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS. THIS DOES NOT LIMIT LIABILITY FOR FRAUD, INTENTIONAL MISCONDUCT OR GROSS NEGLIGENCE, OR ANY LIABILITY THE LAW DOES NOT ALLOW TO BE LIMITED.

Firm will correct, at no extra fee, any error that Firm made in its own work. Nothing in these General Terms limits any right an Individual Client has under law.

7. INDEMNIFICATION — BUSINESS CLIENTS ONLY. A Business Client agrees to indemnify and hold Firm harmless from any third-party claim, and any assessment or penalty imposed by a government agency, together with the related expenses (including reasonable attorney's fees), that arises out of inaccurate, incomplete or late information the Business Client provides, or the Business Client's breach of this agreement, except to the extent caused by Firm's own negligence or willful misconduct.

8. CONFIDENTIALITY & DATA SECURITY. Firm keeps Client's information confidential and protects it with administrative, technical and physical safeguards under Firm's written information security program, as federal law (the FTC Safeguards Rule, 16 CFR Part 314) requires of tax preparers. Firm discloses Client's information only (a) as needed to perform the services, including to software, e-file, payment and secure-storage providers and to other U.S. preparers who help prepare or file Client's return, (b) as the law requires or a court orders, or (c) with Client's written consent. Information given to Firm to prepare an income tax return is used and disclosed only as federal law (Internal Revenue Code section 7216 and its regulations) allows; Firm asks for Client's separate written consent before sending it to a preparer outside the United States or using or disclosing it for any other purpose.

9. ONGOING (MONTHLY) SERVICES. A service that this agreement describes as ongoing, or that is billed monthly, starts on the effective date and continues month to month until it is ended under section 10. Firm bills monthly, and each invoice shows the services, the period and the due date. Firm may change a monthly fee or the scope of an ongoing service on 30 days' written notice; if Client does not agree, Client may end the service before the change takes effect, and the old fee applies until then. For each filing, Firm will tell Client the date by which it needs Client's information (the cutoff). Firm will make reasonable efforts to file on time, but information that arrives after the cutoff may result in a late filing, and any resulting penalties or interest are Client's responsibility. Firm may assign any qualified staff member to Client's account and may change who handles it; Firm remains responsible for the services. Client will tell Firm promptly about changes that affect the filings (for example a new employee, a closed or new location, a change of address, owners or bank account, or a new tax account or license). If Client stops sending information, Firm will tell Client in writing which filings are not being made, and is not responsible for filings it does not receive information for.

10. ENDING THE ENGAGEMENT. A one-time service ends when the work is finished. Either party may end any engagement by written notice (email counts if Client has agreed to electronic delivery). For an ongoing service the notice must be at least 30 days, so that filings in progress can be handed over; either party may end an engagement immediately by written notice if the other does not pay, does not cooperate, gives information the other reasonably believes is false, or asks for something unlawful. After the end date Firm stops new work, sends a final invoice for the work done up to the end date, and tells Client in writing which filings or payments fall due in the following 60 days and that Client or a new preparer must handle them. Firm will return Client's records (section 5) and, on Client's written request, send a copy of Client's file to Client's new preparer. Firm will withdraw as Client's representative or reporting agent with each agency where Firm is on file; an authorization that only Client can end (such as IRS Form 8821) stays on file until Client revokes it. Ending the engagement does not affect fees owed for work already performed, and Client remains responsible for deadlines that fall after the end date.

11. NO LEGAL OR INVESTMENT ADVICE. Firm is not a law firm and its staff do not act as lawyers. No service under this agreement includes legal advice, representing Client in court or before a government agency as Client's lawyer, preparing a document that transfers real estate or is filed in a court case, or personalized investment or financial-planning advice. Tax return preparation and the other tax services described above are not legal advice. Where a matter needs a lawyer or another licensed professional, Client should consult one. Firm does not claim a license or credential that its staff do not hold; on request Firm will state in writing which of its staff, if any, are licensed attorneys, certified public accountants or IRS enrolled agents.

12. FORCE MAJEURE. Neither party is responsible for a delay or failure to perform caused by events beyond that party's reasonable control, including government shutdowns, natural disasters, war, pandemic, or failure of third-party systems (such as IRS or state e-file systems) that neither Client nor Firm controls. This does not excuse a payment that is due.

13. ELECTRONIC SIGNATURE AND DELIVERY CONSENT (SEPARATE AND OPTIONAL). This section is separate from the rest of this agreement and is optional. Client does not have to sign or receive documents electronically; to use paper instead, Client tells Firm before signing, and Firm will provide a paper copy to sign by hand at no charge. By typing a name and ticking the box on the signing page, Client agrees that: (a) Client may sign this agreement and other documents for these services electronically, and an electronic signature has the same legal effect as a handwritten one; (b) Firm may send Client documents, invoices, returns, notices and other records about these services by email, text message link or Firm's secure client portal, and this consent covers all such records for as long as Firm provides services to Client; (c) Client may ask for any record on paper at any time at no charge, and may withdraw this consent at any time by written notice to Firm at no charge, after which Firm will use paper (records already sent electronically stay valid, and withdrawing does not end this agreement); (d) Client will tell Firm in writing if Client's email address or phone number changes; and (e) to receive and keep these records Client needs a device with internet access, a working email address, a current web browser and a program that opens and saves PDF files. Client confirms that Client was able to open and read this document in the form in which it was delivered.

14. GOVERNING LAW; COURTS; JURY. This agreement is governed by the laws of the State of Maryland, without regard to conflict-of-law principles. A Business Client and Firm agree that any lawsuit arising from this agreement will be brought exclusively in the state or federal courts located in Maryland. An Individual Client may sue in any court that has jurisdiction as the law allows.
A BUSINESS CLIENT AND FIRM EACH KNOWINGLY AND VOLUNTARILY WAIVE ANY RIGHT TO A TRIAL BY JURY IN ANY LAWSUIT ARISING OUT OF OR RELATING TO THIS AGREEMENT. THIS MEANS THAT IF EITHER OF US SUES THE OTHER IN COURT, A JUDGE, NOT A JURY, WILL DECIDE THE CASE.

15. TIME LIMIT FOR CLAIMS — BUSINESS CLIENTS ONLY. A Business Client and Firm must each bring any claim against the other arising out of this engagement within two (2) years after the claim accrues (for a claim for unpaid fees, after the invoice due date), even if a longer period would otherwise apply, except where the law does not allow that period to be shortened. For an Individual Client the time limits set by law apply.

16. NO THIRD-PARTY BENEFICIARIES; WHO SIGNS. This agreement is solely between Client and Firm. It creates no right or benefit for any other person or entity, including any owner, partner, investor, lender or affiliate of Client who is not a signing party. If more than one person signs as Client, each is responsible for the whole fee and each may ask Firm for the records. A person who signs for a company or other organization confirms that he or she has authority to sign for it.

17. ENTIRE AGREEMENT; CHANGES; SEPARATE PARTS. This agreement, together with the service description above and any authorization Client signs for these services, is the entire agreement between Client and Firm regarding the services described, and replaces any prior discussions. It may be changed only in writing signed (including electronically) by both parties, except for a fee or scope change made on notice under section 9. If a court finds any part of this agreement unenforceable, that part is limited to what the law allows and the rest stays in effect.

النسخة العربية — Arabic Translation

الشروط والأحكام العامة

تُعدّ هذه الشروط العامة جزءاً من الاتفاقية الموضحة أعلاه. ويكون لمصطلحي "العميل" و"الشركة" المعنى المحدد لهما في وصف الخدمة أعلاه. ويُقصد بـ"العميل الفرد" العميل الذي هو شخص طبيعي ويستخدم الخدمات لأغراض شخصية أو عائلية أو منزلية. أما كل عميل آخر (شركة أو منظمة أو فرد يستخدم الخدمات في عمل تجاري) فهو "عميل تجاري". وإذا تعارض وصف الخدمة أعلاه مع هذه الشروط العامة فإن وصف الخدمة هو الذي يسود.

1. الاعتماد على معلومات العميل. تعتمد الشركة على دقة واكتمال المعلومات والمستندات والتعليمات التي يقدّمها العميل، ولا تدقّق فيها ولا تتحقق منها بصورة مستقلة. وتطرح الشركة أسئلة معقولة إذا بدت المعلومات غير صحيحة أو غير متسقة أو ناقصة، ويوافق العميل على الإجابة عنها. ولا تتحمل الشركة مسؤولية أي أخطاء أو غرامات أو خسائر ناتجة عن معلومات ناقصة أو غير دقيقة أو متأخرة يقدّمها العميل.

2. لا ضمان للنتيجة. تؤدي الشركة الخدمات بعناية مهنية معقولة. ولا تضمن الشركة أي نتيجة محددة، أو مبلغ استرداد ضريبي، أو نتيجة تقديم، أو موافقة، أو مدة معالجة حكومية، ولا تتحمل مسؤولية أي تأخير أو قرار صادر عن مصلحة الضرائب الأمريكية (IRS) أو أي جهة حكومية في الولاية أو على المستوى المحلي أو أي جهة حكومية أخرى.

3. مسؤوليات العميل. يوافق العميل على تقديم المستندات والمعلومات المطلوبة في الوقت المحدد، وعلى مراجعة كل ما تعدّه الشركة قبل توقيعه أو تقديمه أو الاعتماد عليه، وعلى إبلاغ الشركة فوراً بأي تغييرات قد تؤثر على الخدمات. ويكون العميل مسؤولاً عن سداد كل ضريبة ورسم وغرامة وفائدة مستحقة لأي جهة حكومية في موعد استحقاقها. ولا تحتفظ الشركة بأموال العميل ولا تستلمها ولا تصرفها، ولا تدفع أياً من ضرائب العميل من أموالها الخاصة. وأي دفعة تتم عبر نظام إلكتروني (مثل EFTPS أو موقع إلكتروني حكومي في الولاية) تُسدَّد من الحساب المصرفي الخاص بالعميل، إما من العميل نفسه، أو من الشركة بتوجيه من العميل فقط إذا هيّأ العميل ذلك للشركة وأبلغها به كتابةً؛ ويجب على العميل أن يُبقي في الحساب رصيداً كافياً. ويحتفظ العميل بنفسه ببيانات الدخول وكلمات المرور الخاصة بأنظمة مصلحة الضرائب (IRS) وجهات الولاية والمصارف، ولا يشاركها إلا بالقدر اللازم لهذه الخدمات، ويبلغ الشركة فوراً إذا تغيّرت أو احتُمل أنها تعرّضت للاختراق.

4. الرسوم والدفع. رسوم هذا التعاقد هي {{feeAmountAr}}. والرسم المذكور "شهرياً" (/mo) يُفوتَر كل شهر ما دامت الخدمة مستمرة. وإذا ورد الرسم على أنه يُتفق عليه بشكل منفصل فإن الشركة والعميل يتفقان عليه كتابةً قبل أن تُصدر الشركة فاتورة عن العمل. تُستحق الفواتير في تاريخ الاستحقاق المذكور في الفاتورة، وإن لم يُذكر تاريخ ففي غضون 15 يوماً من تاريخ إصدارها. ويجوز للشركة إيقاف الأعمال الجديدة ما دامت هناك فاتورة متأخرة، على أن تبلغ العميل كتابةً بالمواعيد النهائية المتأثرة، وأن تسلّم سجلات العميل وفق البند 5. ولا تشمل رسوم الشركة الرسوم الحكومية للتقديم ولا الغرامات ولا الفوائد ولا المصروفات الفعلية. ورسوم العمل الذي تم إنجازه غير قابلة للاسترداد؛ وإذا أنهت الشركة التعاقد قبل أداء عمل دفع العميل مقابله مقدماً، فإنها ترد الجزء الذي لم تستحقه.

غرامة التأخير وتكاليف التحصيل — للعملاء التجاريين فقط. إذا لم يسدد العميل التجاري فاتورة خلال 30 يوماً من تاريخ إصدارها، جاز للشركة فرض غرامة تأخير قدرها 1.5% من المبلغ المتأخر عن كل شهر (أو جزء من شهر) يبقى فيه غير مسدد، ابتداءً من اليوم الثلاثين المذكور. وتُفرض غرامة التأخير على الرسوم غير المسددة فقط، ولا تُفرض أبداً على غرامات تأخير سابقة، وهي غرامة تأخير بموجب المادة 14-1315 من قانون التجارة في ولاية ماريلاند (Commercial Law) وليست فائدة. ويوافق العميل التجاري كذلك على سداد تكاليف التحصيل المعقولة التي تتكبدها الشركة عن أي فاتورة متأخرة، بما في ذلك أتعاب المحاماة المعقولة التي أُنفقت فعلاً، بالقدر الذي تراه المحكمة معقولاً. ولا تفرض الشركة أي غرامة تأخير على العميل الفرد.

5. السجلات ونواتج العمل. (أ) تُعيد الشركة إلى العميل سجلاته الخاصة (المستندات التي سلّمها للشركة وأي سجلات أخرى يوجب القانون على الشركة إعادتها) فور طلبه، حتى لو كانت هناك فاتورة غير مسددة، ولها أن تحتفظ بنسخ منها. (ب) حيثما توقّع الشركة إقراراً بصفتها معدّاً مأجوراً (paid preparer)، تسلّم العميل نسخة كاملة من الإقرار عند عرضه للتوقيع، ونسخة مما تم تقديمه، سواء كانت هناك فاتورة غير مسددة أم لا. (ج) يجوز للشركة حجب نواتج العمل المنجزة الأخرى التي أعدّتها ولم تسلّمها بعد (مثل قائمة مالية أو تقرير) إلى حين سداد رسوم ذلك العمل. ولا تحجب الشركة أي شيء إذا كان ذلك سيؤدي إلى تفويت العميل موعداً نهائياً قانونياً للتقديم أو الدفع، أو إذا أوجب القانون أو جهة حكومية تسليمه؛ وفي هذه الحالات تسلّمه الشركة ويبقى العميل مديناً بالرسم.

6. تحديد المسؤولية — للعملاء التجاريين فقط. إلى أقصى حد يسمح به القانون، تقتصر المسؤولية الإجمالية للشركة تجاه العميل التجاري الناشئة عن هذا التعاقد أو المتعلقة به، سواء بموجب العقد أو الإهمال أو غير ذلك، على الرسوم التي دفعها العميل التجاري للشركة عن الخدمة محل المطالبة خلال الأشهر الاثني عشر السابقة لنشوء المطالبة، ولا تتحمل الشركة مسؤولية الأضرار غير المباشرة أو العرضية أو التبعية أو الخاصة أو التأديبية، بما في ذلك خسارة الأرباح. ولا يحدّ ذلك من المسؤولية عن الاحتيال أو سوء التصرف المتعمد أو الإهمال الجسيم، ولا من أي مسؤولية لا يجيز القانون تحديدها.

تصحح الشركة، دون رسوم إضافية، أي خطأ ارتكبته في عملها هي. ولا يحدّ أي شيء في هذه الشروط العامة من أي حق للعميل الفرد بموجب القانون.

7. التعويض — للعملاء التجاريين فقط. يوافق العميل التجاري على تعويض الشركة وإبرائها من أي مطالبة من طرف ثالث، ومن أي تقدير ضريبي أو غرامة تفرضها جهة حكومية، ومن النفقات المتصلة بذلك (بما في ذلك أتعاب المحاماة المعقولة)، متى نشأت عن معلومات غير دقيقة أو ناقصة أو متأخرة يقدّمها العميل التجاري، أو عن إخلاله بهذا الاتفاق، إلا بالقدر الذي يكون سببه إهمال الشركة أو سوء تصرف متعمد منها.

8. السرية وأمن البيانات. تحافظ الشركة على سرية معلومات العميل وتحميها بضمانات إدارية وتقنية ومادية بموجب برنامجها المكتوب لأمن المعلومات، وفق ما يوجبه القانون الاتحادي (قاعدة الضمانات الصادرة عن لجنة التجارة الاتحادية FTC، 16 CFR Part 314) على معدّي الإقرارات الضريبية. ولا تفصح الشركة عن معلومات العميل إلا (أ) بالقدر اللازم لأداء الخدمات، بما في ذلك لمزوّدي البرمجيات والتقديم الإلكتروني والدفع والتخزين الآمن ولمعدّي إقرارات آخرين داخل الولايات المتحدة يساعدون في إعداد إقرار العميل أو تقديمه، أو (ب) وفق ما يقتضيه القانون أو تأمر به المحكمة، أو (ج) بموافقة كتابية من العميل. والمعلومات المقدَّمة لإعداد إقرار ضريبة الدخل لا تُستخدم ولا يُفصح عنها إلا بالقدر الذي يسمح به القانون الاتحادي (المادة 7216 من قانون الإيرادات الداخلية Internal Revenue Code ولوائحها)؛ وتطلب الشركة موافقة كتابية منفصلة من العميل قبل إرسالها إلى معدّ إقرارات خارج الولايات المتحدة أو استخدامها أو الإفصاح عنها لأي غرض آخر.

9. الخدمات المستمرة (الشهرية). الخدمة التي يصفها هذا الاتفاق بأنها مستمرة، أو التي تُفوتَر شهرياً، تبدأ في تاريخ السريان وتستمر شهراً بعد شهر إلى أن تنتهي وفق البند 10. وتُصدر الشركة فاتورة شهرية، تبيّن كل منها الخدمات والفترة وتاريخ الاستحقاق. ويجوز للشركة تعديل الرسم الشهري أو نطاق الخدمة المستمرة بإشعار كتابي قبل 30 يوماً؛ وإذا لم يوافق العميل فله إنهاء الخدمة قبل سريان التعديل، ويستمر العمل بالرسم القديم إلى ذلك الحين. وبالنسبة لكل تقديم، تُبلغ الشركة العميل بالتاريخ الذي تحتاج فيه إلى معلوماته (الموعد النهائي لاستلام المعلومات). وتبذل الشركة جهداً معقولاً للتقديم في الموعد، ولكن المعلومات التي تصل بعد ذلك الموعد قد تؤدي إلى تقديم متأخر، وتقع أي غرامات أو فوائد ناتجة عن ذلك على عاتق العميل. ويجوز للشركة تكليف أي موظف مؤهل بحساب العميل وتغيير من يتولاه، وتبقى الشركة مسؤولة عن الخدمات. ويبلغ العميل الشركة فوراً بالتغييرات التي تؤثر على التقديمات (مثل موظف جديد، أو فتح موقع أو إغلاقه، أو تغيير العنوان أو الملاك أو الحساب المصرفي، أو حساب ضريبي أو ترخيص جديد). وإذا توقف العميل عن إرسال المعلومات، تبلغه الشركة كتابةً بالتقديمات التي لا تتم، ولا تتحمل مسؤولية تقديمات لم تتلقَّ المعلومات اللازمة لها.

10. إنهاء التعاقد. الخدمة لمرة واحدة تنتهي بإنجاز العمل. ويجوز لأي من الطرفين إنهاء أي تعاقد بإشعار كتابي (ويُعدّ البريد الإلكتروني إشعاراً كتابياً إذا وافق العميل على التسليم الإلكتروني). وفي الخدمة المستمرة يجب ألا تقل مدة الإشعار عن 30 يوماً حتى يمكن تسليم التقديمات الجارية؛ ويجوز لأي من الطرفين إنهاء التعاقد فوراً بإشعار كتابي إذا لم يسدد الطرف الآخر ما عليه، أو لم يتعاون، أو قدّم معلومات يعتقد الطرف الأول بصورة معقولة أنها غير صحيحة، أو طلب أمراً غير مشروع. وبعد تاريخ الإنهاء توقف الشركة الأعمال الجديدة، وتصدر فاتورة نهائية عن العمل المنجز حتى تاريخ الإنهاء، وتبلغ العميل كتابةً بالتقديمات والمدفوعات المستحقة خلال الستين يوماً التالية وبأن على العميل أو معدّ جديد تولّيها. وتُعيد الشركة سجلات العميل (البند 5)، وترسل بناءً على طلب كتابي من العميل نسخة من ملفه إلى معدّه الجديد. وتنسحب الشركة بصفتها ممثلة للعميل أو وكيلة إبلاغ لديه لدى كل جهة مسجَّلة فيها؛ أما التفويض الذي لا يملك إنهاءه إلا العميل (مثل نموذج IRS Form 8821) فيبقى مسجلاً إلى أن يلغيه العميل. ولا يؤثر إنهاء التعاقد على الرسوم المستحقة عن العمل المنجز، ويظل العميل مسؤولاً عن المواعيد النهائية التي تقع بعد تاريخ الإنهاء.

11. لا استشارة قانونية أو استثمارية. الشركة ليست مكتباً قانونياً، وموظفوها لا يعملون كمحامين. ولا تشمل أي خدمة بموجب هذا الاتفاق استشارة قانونية، أو تمثيل العميل أمام محكمة أو جهة حكومية بصفة محامٍ عنه، أو إعداد مستند ينقل ملكية عقار أو يُودَع في قضية أمام المحكمة، أو استشارة استثمارية أو تخطيطاً مالياً شخصياً. وإعداد الإقرارات الضريبية والخدمات الضريبية الأخرى الموضحة أعلاه ليست استشارة قانونية. وإذا كان الأمر يتطلب محامياً أو مهنياً مرخصاً آخر، فعلى العميل استشارته. ولا تدّعي الشركة ترخيصاً أو صفة مهنية لا يحملها موظفوها؛ وبناءً على طلب العميل تبيّن الشركة كتابةً أيّاً من موظفيها، إن وُجد، محامٍ مرخص أو محاسب قانوني معتمد (CPA) أو وكيل ضرائب مسجَّل لدى مصلحة الضرائب (Enrolled Agent).

12. القوة القاهرة. لا يتحمل أي من الطرفين مسؤولية التأخير أو عدم الأداء الناتج عن أحداث خارجة عن السيطرة المعقولة لذلك الطرف، بما في ذلك إغلاق الحكومة، أو الكوارث الطبيعية، أو الحرب، أو الأوبئة، أو تعطّل أنظمة أطراف ثالثة (مثل أنظمة التقديم الإلكتروني الخاصة بمصلحة الضرائب أو الولاية) لا يسيطر عليها العميل ولا الشركة. ولا يُعفي ذلك من دفعة مستحقة.

13. الموافقة على التوقيع والتسليم الإلكترونيين (بند منفصل واختياري). هذا البند منفصل عن بقية الاتفاقية واختياري. فليس على العميل أن يوقّع المستندات أو يستلمها إلكترونياً؛ ولاستخدام الورق بدلاً من ذلك يُبلغ العميل الشركة قبل التوقيع، وتقدّم له الشركة نسخة ورقية ليوقّعها بخط يده دون مقابل. وبكتابة الاسم ووضع علامة في المربع في صفحة التوقيع، يوافق العميل على ما يلي: (أ) يجوز للعميل توقيع هذا الاتفاق وغيره من المستندات المتعلقة بهذه الخدمات إلكترونياً، وللتوقيع الإلكتروني نفس الأثر القانوني للتوقيع بخط اليد؛ (ب) يجوز للشركة أن ترسل إلى العميل المستندات والفواتير والإقرارات والإشعارات وغيرها من السجلات المتعلقة بهذه الخدمات بالبريد الإلكتروني أو برابط في رسالة نصية أو عبر بوابة العميل الآمنة لدى الشركة، وتشمل هذه الموافقة جميع هذه السجلات ما دامت الشركة تقدّم الخدمات للعميل؛ (ج) يجوز للعميل طلب أي سجل على الورق في أي وقت دون مقابل، كما يجوز له سحب هذه الموافقة في أي وقت بإشعار كتابي إلى الشركة دون مقابل، وعندها تستخدم الشركة الورق (وتبقى السجلات التي أُرسلت إلكترونياً سارية، ولا يُنهي سحب الموافقة هذا الاتفاق)؛ (د) يبلغ العميل الشركة كتابةً إذا تغيّر بريده الإلكتروني أو رقم هاتفه؛ (هـ) لاستلام هذه السجلات والاحتفاظ بها يحتاج العميل إلى جهاز متصل بالإنترنت وبريد إلكتروني فعّال ومتصفح حديث وبرنامج يفتح ملفات PDF ويحفظها. ويؤكد العميل أنه استطاع فتح هذا المستند وقراءته بالصيغة التي سُلّم بها.

14. القانون المُطبَّق والمحاكم وهيئة المحلفين. يخضع هذا الاتفاق لقوانين ولاية ماريلاند، بصرف النظر عن مبادئ تنازع القوانين. ويتفق العميل التجاري والشركة على أن أي دعوى تنشأ عن هذا الاتفاق تُرفع حصراً أمام المحاكم الحكومية أو الفيدرالية الواقعة في ولاية ماريلاند. ويجوز للعميل الفرد رفع دعواه أمام أي محكمة مختصة وفق ما يسمح به القانون. ويتنازل العميل التجاري والشركة، كل منهما عن علم وبمحض إرادته، عن أي حق في المحاكمة أمام هيئة محلفين في أي دعوى تنشأ عن هذا الاتفاق أو تتعلق به. ويعني ذلك أنه إذا رفع أحدنا دعوى على الآخر أمام المحكمة، فسيفصل فيها قاضٍ وليس هيئة محلفين.

15. المدة المحددة لتقديم المطالبات — للعملاء التجاريين فقط. يجب على العميل التجاري والشركة، كل تجاه الآخر، تقديم أي مطالبة ناشئة عن هذا التعاقد خلال سنتين (2) من نشوء المطالبة (وبالنسبة للمطالبة بالرسوم غير المسددة، من تاريخ استحقاق الفاتورة)، بصرف النظر عن أي مدة أطول قد ينص عليها القانون، إلا في الحالات التي لا يسمح فيها القانون بتقصير تلك المدة. أما العميل الفرد فتسري عليه المدد التي يحددها القانون.

16. عدم وجود مستفيدين من الغير؛ من يوقّع. هذا الاتفاق مقتصر على العميل والشركة فقط، ولا يُنشئ أي حق أو منفعة لأي شخص أو جهة أخرى، بما في ذلك أي مالك أو شريك أو مستثمر أو جهة إقراض أو جهة تابعة للعميل ليست طرفاً موقّعاً عليه. وإذا وقّع أكثر من شخص بصفة العميل فإن كلاً منهم مسؤول عن كامل الرسوم، ولكل منهم أن يطلب السجلات من الشركة. ومن يوقّع عن شركة أو منظمة يؤكد أنه مخوَّل بالتوقيع عنها.

17. الاتفاق الكامل؛ التعديل؛ استقلال الأحكام. يمثّل هذا الاتفاق، إلى جانب وصف الخدمة أعلاه وأي تفويض يوقّعه العميل لهذه الخدمات، الاتفاق الكامل بين العميل والشركة بشأن الخدمات الموضحة، ويحل محل أي مناقشات سابقة. ولا يجوز تعديله إلا كتابياً وموقعاً (بما في ذلك إلكترونياً) من الطرفين، باستثناء تعديل الرسوم أو النطاق الذي يتم بإشعار وفق البند 9. وإذا قضت محكمة بعدم نفاذ أي جزء من هذا الاتفاق، فيُقصر هذا الجزء على ما يجيزه القانون وتبقى بقية الأحكام سارية.`;


// Shared tax-return terms (used by the three tax-preparation engagements) — English, then the same text in Arabic.
// Sources: IRS Pub. 1345 (the e-file provider gives the taxpayer a complete copy; the taxpayer signs the e-file
// authorization), 26 CFR §1.6107-1(a) (copy of the return no later than when it is presented for signature),
// 31 CFR §10.31 (no endorsing a refund check / no directing a refund into the preparer's account), 31 CFR §10.3
// (who may practise before the IRS: attorneys, CPAs, enrolled agents, enrolled retirement plan agents) and §10.7(c)
// (limited representation by an individual's own family / employees only).
const TAX_RETURN_TERMS_EN = `RETURN SIGNATURE, E-FILE AND COPIES. Firm's preparer signs each return as paid preparer where the law requires. Firm will ask Client to sign the return, or the IRS e-file signature authorization that applies (such as Form 8879), only after the return is complete and Client has reviewed it, and Firm will transmit an e-filed return only after Client has signed. Firm gives Client a complete copy of each return when it is presented for signature.

TAX DUE AND REFUNDS. Filing an extension does not extend the time to pay. Client pays any balance due by the original due date; Firm does not pay Client's taxes. A federal refund check issued to Client must be endorsed by Client; Firm may not endorse it and will not direct or accept a refund into an account Firm owns or controls. A refund paid by direct deposit goes only to a bank account in Client's own name, and the account details cannot be changed after the return is accepted.

AUDITS AND NOTICES. Representation before the IRS or a state agency in connection with an audit, notice or examination is not included. It is a separate engagement with a separate written fee that does not depend on the result. Only an attorney, certified public accountant or enrolled agent (or another person the agency allows) can represent Client before the IRS in an audit or collection matter; before taking on any representation, Firm will tell Client in writing who will act and will require Client to sign the agency's authorization form (IRS Form 2848, or Maryland Comptroller Form 548). Client will send Firm promptly any notice Client receives about a return Firm prepared.`;

const TAX_RETURN_TERMS_AR = `توقيع الإقرار والتقديم الإلكتروني والنسخ. يوقّع معدّ الشركة كل إقرار بصفته معدّاً مأجوراً (paid preparer) حيثما يوجب القانون ذلك. وتطلب الشركة من العميل التوقيع على الإقرار، أو على تفويض التوقيع للتقديم الإلكتروني المعمول به لدى مصلحة الضرائب (IRS) (مثل النموذج 8879)، بعد اكتمال الإقرار ومراجعة العميل له فقط، ولا ترسل إقراراً إلكترونياً إلا بعد توقيع العميل. وتسلّم الشركة العميل نسخة كاملة من كل إقرار عند عرضه للتوقيع.

الضريبة المستحقة والمبالغ المستردة. لا يمدّ طلب التمديد مهلة السداد. ويسدد العميل أي رصيد مستحق في الموعد الأصلي؛ ولا تدفع الشركة ضرائب العميل. وشيك الاسترداد الاتحادي الصادر باسم العميل يجب أن يظهّره العميل بنفسه؛ ولا يجوز للشركة تظهيره، ولن توجّه أي مبلغ مسترد إلى حساب تملكه الشركة أو تتحكم فيه ولن تقبله فيه. والمبلغ المسترد بالإيداع المباشر يُودَع فقط في حساب مصرفي باسم العميل نفسه، ولا يمكن تغيير بيانات الحساب بعد قبول الإقرار.

عمليات التدقيق والإشعارات. التمثيل أمام مصلحة الضرائب (IRS) أو جهة حكومية في الولاية فيما يتعلق بتدقيق أو إشعار أو فحص غير مشمول بهذا الاتفاق، وهو تعاقد منفصل برسم مكتوب منفصل لا يتوقف على النتيجة. ولا يجوز تمثيل العميل أمام مصلحة الضرائب (IRS) في تدقيق أو تحصيل إلا من محامٍ أو محاسب قانوني معتمد (CPA) أو وكيل ضرائب مسجَّل (Enrolled Agent) (أو شخص آخر تسمح له الجهة بذلك)؛ وقبل قبول أي تمثيل تبلغ الشركة العميل كتابةً بمن سيتولاه وتطلب من العميل توقيع نموذج التفويض الخاص بالجهة (نموذج IRS Form 2848 أو نموذج Maryland Comptroller Form 548). ويرسل العميل إلى الشركة فوراً أي إشعار يتلقاه بشأن إقرار أعدّته.`;

export const BUILT_IN_CONTRACT_TEMPLATES: { serviceKey: string; title: string; body: string }[] = [
  {
    serviceKey: "tax_prep",
    title: "Tax Preparation Engagement Letter",
    body: `TAX PREPARATION ENGAGEMENT LETTER

This letter confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for tax preparation services, effective {{effectiveDate}}.

SCOPE OF SERVICES. Firm will prepare Client's federal and applicable state income tax return(s) for the period specified, based on information and documents Client provides. Amended returns, returns for other periods, and returns for other people or entities are not included unless agreed in writing.

CLIENT RESPONSIBILITY FOR ACCURACY. Client is solely responsible for the accuracy and completeness of the information provided, including income, deductions and credits claimed. Client remains ultimately responsible for the contents of the filed return, even though Firm prepared it. Client should review the completed return carefully before signing or authorizing e-file.

${TAX_RETURN_TERMS_EN}

NO GUARANTEE OF REFUND OR AUDIT OUTCOME. Firm does not guarantee any specific refund amount, tax liability, or outcome if the return is selected for examination or audit by a taxing authority.

RECORD RETENTION. Client is responsible for retaining copies of all documents supporting items reported on the return, consistent with applicable record-retention requirements.

النسخة العربية — Arabic Translation

خطاب التعاقد لإعداد الإقرارات الضريبية

يؤكد هذا الخطاب شروط التعاقد بين {{clientName}} ("العميل") و{{firmName}} ("الشركة") لتقديم خدمات إعداد الإقرارات الضريبية، اعتباراً من {{effectiveDate}}.

نطاق الخدمات. تعدّ الشركة إقرار (إقرارات) ضريبة الدخل الاتحادية وإقرار (إقرارات) ضريبة الدخل المعمول بها في الولاية عن الفترة المحددة، استناداً إلى المعلومات والمستندات التي يقدّمها العميل. ولا تشمل الخدمات الإقرارات المعدَّلة، ولا الإقرارات عن فترات أخرى، ولا الإقرارات الخاصة بأشخاص أو جهات أخرى، ما لم يُتفق على ذلك كتابةً.

مسؤولية العميل عن الدقة. العميل هو المسؤول الوحيد عن دقة واكتمال المعلومات المقدَّمة، بما في ذلك الدخل والخصومات والائتمانات الضريبية المطالَب بها. ويظل العميل مسؤولاً في النهاية عن محتويات الإقرار المقدَّم، ولو أعدّته الشركة. وينبغي للعميل مراجعة الإقرار المكتمل بعناية قبل التوقيع عليه أو الإذن بتقديمه إلكترونياً.

${TAX_RETURN_TERMS_AR}

لا ضمان لمبلغ الاسترداد أو لنتيجة التدقيق. لا تضمن الشركة أي مبلغ استرداد أو التزام ضريبي محدد، ولا أي نتيجة في حال اختيار الإقرار للفحص أو التدقيق من جهة ضريبية.

الاحتفاظ بالسجلات. العميل مسؤول عن الاحتفاظ بنسخ من جميع المستندات المؤيدة للبنود الواردة في الإقرار، بما يتوافق مع متطلبات الاحتفاظ بالسجلات المعمول بها.`,
  },
  {
    serviceKey: "personal_tax_prep",
    title: "Personal Tax Preparation Engagement Letter",
    body: `PERSONAL TAX PREPARATION ENGAGEMENT LETTER

This letter confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for personal income tax preparation services, effective {{effectiveDate}}. Because this engagement is for Client's personal income tax, Client is an Individual Client under the General Terms.

SCOPE OF SERVICES. Firm will prepare Client's individual federal and applicable state and local income tax return(s) (Form 1040 and related schedules) for the period specified, based on information and documents Client provides. Amended returns, returns for other periods, and returns for other people are not included unless agreed in writing.

CLIENT RESPONSIBILITY FOR ACCURACY. Client is solely responsible for the accuracy and completeness of the information provided, including income, filing status, dependents, deductions and credits claimed. Client remains ultimately responsible for the contents of the filed return, even though Firm prepared it. Client should review the completed return carefully before signing or authorizing e-file.

PREPARER INFORMATION. Maryland law requires a registered individual tax preparer to give the customer certain information in writing before the work begins: the preparer's name, address and telephone number; that the preparer is not a certified public accountant, enrolled agent or tax attorney (where that is so); the services the preparer is qualified to provide; and the preparer's education and training, including examinations taken and successfully passed. The preparer gives it at the first meeting, before any work on the return begins, where Maryland law requires it. A registered preparer's fee may not depend on the amount of the refund or the result of the services, and Firm's fee for preparing a return does not. Firm will not ask Client to sign a return or an authorization before the preparation is complete.

${TAX_RETURN_TERMS_EN}

NO GUARANTEE OF REFUND OR AUDIT OUTCOME. Firm does not guarantee any specific refund amount, tax liability, or outcome if the return is selected for examination or audit by a taxing authority.

RECORD RETENTION. Client is responsible for retaining copies of all documents supporting items reported on the return, consistent with applicable record-retention requirements.

النسخة العربية — Arabic Translation

خطاب التعاقد لإعداد الإقرار الضريبي الشخصي

يؤكد هذا الخطاب شروط التعاقد بين {{clientName}} ("العميل") و{{firmName}} ("الشركة") لتقديم خدمات إعداد إقرار ضريبة الدخل الشخصي، اعتباراً من {{effectiveDate}}. ولما كان هذا التعاقد خاصاً بضريبة الدخل الشخصي للعميل، فإن العميل "عميل فرد" بموجب الشروط العامة.

نطاق الخدمات. تعدّ الشركة إقرار (إقرارات) ضريبة الدخل الاتحادية الفردية وإقرار (إقرارات) ضريبة الدخل المعمول بها في الولاية والمحلية (النموذج 1040 وجداوله المرتبطة) عن الفترة المحددة، استناداً إلى المعلومات والمستندات التي يقدّمها العميل. ولا تشمل الخدمات الإقرارات المعدَّلة، ولا الإقرارات عن فترات أخرى، ولا الإقرارات الخاصة بأشخاص آخرين، ما لم يُتفق على ذلك كتابةً.

مسؤولية العميل عن الدقة. العميل هو المسؤول الوحيد عن دقة واكتمال المعلومات المقدَّمة، بما في ذلك الدخل والحالة الضريبية والمعالون والخصومات والائتمانات الضريبية المطالَب بها. ويظل العميل مسؤولاً في النهاية عن محتويات الإقرار المقدَّم، ولو أعدّته الشركة. وينبغي للعميل مراجعة الإقرار المكتمل بعناية قبل التوقيع عليه أو الإذن بتقديمه إلكترونياً.

معلومات المعدّ. يوجب قانون ولاية ماريلاند على معدّ الإقرارات الضريبية الفردية المسجَّل أن يقدّم للعميل كتابةً، قبل بدء العمل، معلومات معينة هي: اسم المعدّ وعنوانه ورقم هاتفه؛ وكونه ليس محاسباً قانونياً معتمداً (CPA) ولا وكيل ضرائب مسجَّلاً (Enrolled Agent) ولا محامي ضرائب (حيثما كان ذلك صحيحاً)؛ والخدمات المؤهَّل لتقديمها؛ وتعليمه وتدريبه، بما في ذلك الاختبارات التي أدّاها واجتازها بنجاح. ويقدّمها المعدّ في أول لقاء مع العميل وقبل بدء أي عمل على الإقرار، حيثما يوجب قانون ماريلاند ذلك. ولا يجوز أن تتوقف أتعاب المعدّ المسجَّل على مبلغ الاسترداد أو على نتيجة الخدمات، ولا تتوقف أتعاب الشركة عن إعداد الإقرار على ذلك. ولن تطلب الشركة من العميل التوقيع على إقرار أو تفويض قبل اكتمال الإعداد.

${TAX_RETURN_TERMS_AR}

لا ضمان لمبلغ الاسترداد أو لنتيجة التدقيق. لا تضمن الشركة أي مبلغ استرداد أو التزام ضريبي محدد، ولا أي نتيجة في حال اختيار الإقرار للفحص أو التدقيق من جهة ضريبية.

الاحتفاظ بالسجلات. العميل مسؤول عن الاحتفاظ بنسخ من جميع المستندات المؤيدة للبنود الواردة في الإقرار، بما يتوافق مع متطلبات الاحتفاظ بالسجلات المعمول بها.`,
  },
  {
    serviceKey: "business_tax_prep",
    title: "Business Tax Preparation Engagement Letter",
    body: `BUSINESS TAX PREPARATION ENGAGEMENT LETTER

This letter confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for business income tax preparation services, effective {{effectiveDate}}.

SCOPE OF SERVICES. Firm will prepare Client's federal and applicable state business income tax return(s) (such as Form 1120, 1120-S, 1065, Schedule C, or 990, as applicable to Client's entity type) for the period specified, based on financial records and information Client provides. Amended returns, returns for other periods, and payroll, sales tax and annual-report filings are not included unless agreed in writing.

CLIENT RESPONSIBILITY FOR ACCURACY. Client is solely responsible for the accuracy and completeness of the financial information provided, including income, expenses and any owner/shareholder allocations. Client remains ultimately responsible for the contents of the filed return, even though Firm prepared it, and for distributing any resulting Schedule K-1s to owners or partners. Client should review the completed return carefully before an owner, partner or officer signs it or authorizes e-file.

RELIANCE ON CLIENT'S BOOKS. Unless Firm is separately engaged for bookkeeping services, Firm relies on the financial records Client provides (or Client's own bookkeeping system) as accurate and complete, and does not audit or independently verify those records.

${TAX_RETURN_TERMS_EN}

NO GUARANTEE OF REFUND OR AUDIT OUTCOME. Firm does not guarantee any specific refund amount, tax liability, or outcome if the return is selected for examination or audit by a taxing authority.

RECORD RETENTION. Client is responsible for retaining copies of all documents supporting items reported on the return, consistent with applicable record-retention requirements.

النسخة العربية — Arabic Translation

خطاب التعاقد لإعداد الإقرارات الضريبية للأعمال

يؤكد هذا الخطاب شروط التعاقد بين {{clientName}} ("العميل") و{{firmName}} ("الشركة") لتقديم خدمات إعداد إقرارات ضريبة الدخل على الأعمال، اعتباراً من {{effectiveDate}}.

نطاق الخدمات. تعدّ الشركة إقرار (إقرارات) ضريبة دخل الأعمال الاتحادية والمعمول بها في الولاية (مثل النموذج 1120 أو 1120-S أو 1065 أو الجدول C أو 990، بحسب نوع كيان العميل) عن الفترة المحددة، استناداً إلى السجلات المالية والمعلومات التي يقدّمها العميل. ولا تشمل الخدمات الإقرارات المعدَّلة، ولا الإقرارات عن فترات أخرى، ولا تقديمات الرواتب وضريبة المبيعات والتقرير السنوي، ما لم يُتفق على ذلك كتابةً.

مسؤولية العميل عن الدقة. العميل هو المسؤول الوحيد عن دقة واكتمال المعلومات المالية المقدَّمة، بما في ذلك الإيرادات والمصروفات وأي توزيعات على الملاك أو المساهمين. ويظل العميل مسؤولاً في النهاية عن محتويات الإقرار المقدَّم، ولو أعدّته الشركة، وعن توزيع النماذج K-1 الناتجة على الملاك أو الشركاء. وينبغي للعميل مراجعة الإقرار المكتمل بعناية قبل أن يوقّعه مالك أو شريك أو مسؤول أو يأذن بتقديمه إلكترونياً.

الاعتماد على دفاتر العميل. ما لم تكن الشركة متعاقدة بشكل منفصل على خدمات مسك الدفاتر، فإنها تعتمد على السجلات المالية التي يقدّمها العميل (أو نظام مسك الدفاتر الخاص به) بوصفها دقيقة وكاملة، ولا تدقّق فيها ولا تتحقق منها بصورة مستقلة.

${TAX_RETURN_TERMS_AR}

لا ضمان لمبلغ الاسترداد أو لنتيجة التدقيق. لا تضمن الشركة أي مبلغ استرداد أو التزام ضريبي محدد، ولا أي نتيجة في حال اختيار الإقرار للفحص أو التدقيق من جهة ضريبية.

الاحتفاظ بالسجلات. العميل مسؤول عن الاحتفاظ بنسخ من جميع المستندات المؤيدة للبنود الواردة في الإقرار، بما يتوافق مع متطلبات الاحتفاظ بالسجلات المعمول بها.`,
  },
  {
    serviceKey: "bookkeeping",
    title: "Bookkeeping & Accounting Services Agreement",
    body: `BOOKKEEPING & ACCOUNTING SERVICES AGREEMENT

This agreement confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for bookkeeping and accounting services, effective {{effectiveDate}}.

SCOPE OF SERVICES. Firm will record and organize Client's financial transactions, reconcile Client's bank and card accounts to the statements Client provides, and produce periodic financial reports (such as a profit-and-loss statement and balance sheet) based on records, statements and information Client provides. These are ongoing monthly services unless the fee description says the work is one-time.

MONTHLY CLOSE AND CUTOFFS. For each month, Client sends the bank and card statements, sales reports, bills, receipts and payroll reports by the date Firm sets. Firm completes the month's books and reports after it receives complete information; a report for a month that Client has not fully supplied is marked incomplete.

NOT INCLUDED. Tax return preparation, payroll, sales tax filing, and tax or financial advice are not part of this service unless Client has separately engaged Firm for them. Firm does not sign checks, make payments, or hold or move Client's money, and has no authority to bind Client.

CLIENT'S BOOKS. The books and records belong to Client. If the books are kept in Client's own accounting subscription, Client keeps it active and gives Firm access; if they are kept on Firm's software, Firm will give Client an export of the books on request. Client will review each month's reports and tell Firm promptly of any error.

NOT AN AUDIT, REVIEW, OR ATTESTATION. These services are bookkeeping services only. They are not an audit, review, or compilation performed under professional accounting or auditing standards, and no assurance or opinion is expressed on the resulting financial statements. Financial statements prepared under this engagement may not be suitable for third parties (such as lenders or investors) who require audited or reviewed financials.

CLIENT RESPONSIBILITY FOR SOURCE RECORDS. Client is responsible for providing complete and accurate source documents (bank and card statements, receipts, sales records, etc.) in a timely manner. Firm's work product reflects only the transactions and records Client provides; Firm is not responsible for errors resulting from missing, incomplete, or inaccurate source records.

النسخة العربية — Arabic Translation

اتفاقية خدمات مسك الدفاتر والمحاسبة

تؤكد هذه الاتفاقية شروط التعاقد بين {{clientName}} ("العميل") و{{firmName}} ("الشركة") لتقديم خدمات مسك الدفاتر والمحاسبة، اعتباراً من {{effectiveDate}}.

نطاق الخدمات. تسجّل الشركة المعاملات المالية للعميل وتنظّمها، وتطابق حسابات العميل المصرفية وحسابات بطاقاته مع الكشوف التي يقدّمها، وتعدّ تقارير مالية دورية (مثل قائمة الأرباح والخسائر والميزانية العمومية) استناداً إلى السجلات والكشوف والمعلومات التي يقدّمها العميل. وهذه خدمات شهرية مستمرة ما لم يذكر وصف الرسوم أن العمل لمرة واحدة.

الإقفال الشهري والمواعيد النهائية لاستلام المعلومات. عن كل شهر، يرسل العميل كشوف الحسابات المصرفية وكشوف البطاقات وتقارير المبيعات والفواتير والإيصالات وتقارير الرواتب في التاريخ الذي تحدده الشركة. وتنجز الشركة دفاتر الشهر وتقاريره بعد استلامها معلومات كاملة؛ ويُوضع على تقرير الشهر الذي لم يقدّم العميل معلوماته كاملة علامة "غير مكتمل".

ما لا تشمله الخدمة. لا تشمل هذه الخدمة إعداد الإقرارات الضريبية ولا الرواتب ولا تقديم إقرارات ضريبة المبيعات ولا الاستشارات الضريبية أو المالية، ما لم يتعاقد العميل مع الشركة عليها بشكل منفصل. ولا توقّع الشركة شيكات ولا تجري مدفوعات ولا تحتفظ بأموال العميل ولا تنقلها، وليس لها صلاحية إلزام العميل.

دفاتر العميل. الدفاتر والسجلات ملك للعميل. وإذا كانت الدفاتر محفوظة في اشتراك محاسبي خاص بالعميل فعليه إبقاؤه فعّالاً ومنح الشركة حق الدخول إليه؛ وإذا كانت محفوظة على برنامج الشركة فإن الشركة تسلّم العميل نسخة مصدَّرة من الدفاتر عند طلبه. ويراجع العميل تقارير كل شهر ويبلغ الشركة فوراً بأي خطأ.

ليست تدقيقاً ولا مراجعة ولا توثيقاً. هذه الخدمات هي خدمات مسك دفاتر فقط. وهي ليست تدقيقاً ولا مراجعة ولا تجميعاً (compilation) يتم وفق معايير المحاسبة أو التدقيق المهنية، ولا يُبدى أي تأكيد أو رأي بشأن القوائم المالية الناتجة. وقد لا تكون القوائم المالية المعدّة بموجب هذا التعاقد مناسبة لأطراف ثالثة (مثل جهات الإقراض أو المستثمرين) تشترط قوائم مالية مدققة أو مراجعة.

مسؤولية العميل عن المستندات المصدرية. العميل مسؤول عن تقديم مستندات مصدرية كاملة ودقيقة (كشوف الحسابات المصرفية وكشوف البطاقات والإيصالات وسجلات المبيعات وغيرها) في الوقت المناسب. ولا تعكس نواتج عمل الشركة إلا المعاملات والسجلات التي يقدّمها العميل؛ والشركة غير مسؤولة عن الأخطاء الناتجة عن سجلات مصدرية مفقودة أو ناقصة أو غير دقيقة.`,
  },
  {
    serviceKey: "payroll",
    title: "Payroll Services Agreement",
    body: `PAYROLL SERVICES AGREEMENT

This agreement confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for payroll and employer-filing services, effective {{effectiveDate}}.

SCOPE OF SERVICES. Firm provides the payroll and employer-filing services that Client has selected on its service list and fee schedule, and no others. Depending on that selection, they may include: (a) payroll processing: calculating gross-to-net pay, withholding and employer taxes from the hours, pay rates and employee information Client submits, and preparing pay statements and, where agreed, pay checks or direct-deposit files; (b) federal employment tax returns: Form 941 (quarterly), Form 940 (annual) and, if the IRS requires it, Form 944; (c) year-end wage reporting from the data Client submits: Forms W-2 and W-3 for employees and Forms 1099-NEC and 1096 for non-employee workers; (d) state income tax withholding returns and the year-end reconciliation for Maryland and, if Client is registered there, any other state or the District of Columbia; (e) quarterly unemployment-insurance contribution and wage reports for Maryland and any other state where Client is registered; (f) federal tax deposits: Firm calculates each deposit and its due date and tells Client, and Client makes the deposit through EFTPS unless Client has set up Firm's access and told Firm in writing to make it for Client; and (g) new-hire reports, only if Client asks Firm in writing and gives Firm the details before the deadline; otherwise new-hire reporting remains Client's duty.

NOT INCLUDED. Workers' compensation insurance, employee benefits and retirement plans, Form I-9, wage-and-hour compliance, wage garnishment and child-support orders, local taxes not named above, legal or human-resources advice, and the decision whether a worker is an employee or an independent contractor are not part of this service.

CLIENT REMAINS THE EMPLOYER OF RECORD. Client remains the employer of record for all employees at all times, and keeps final responsibility for compliance with wage-and-hour law, for classifying workers (employee or contractor), and for the accuracy of hours, pay rates and other data submitted to Firm. Firm does not become Client's employer or co-employer. Firm processes payroll from the data Client submits and is not responsible for errors resulting from inaccurate or late data.

DATA, CUTOFFS AND FUNDING. Client submits payroll data by the cutoff Firm sets for each pay period, and reviews and approves each payroll before it is released. Late data may cause a late or off-cycle payroll or filing, and any resulting penalties are Client's responsibility. Client keeps its bank account funded for net pay and for tax payments; penalties and fees caused by insufficient funds are Client's responsibility. Firm will set a year-end cutoff for corrections to wage data; a correction after the year-end forms are filed requires an amended form, which may be charged separately. Client will send Firm promptly any notice Client receives from the IRS or a state agency about a payroll account.

AUTHORIZATION TO FILE; REPORTING AGENT. Where Firm files federal employment tax returns for Client, Firm acts as Client's reporting agent under IRS Form 8655, and for state filings under that state's own authorization. Client agrees to sign these authorizations promptly upon request. Client keeps its own EFTPS and agency accounts and credentials, and Firm uses any access Client gives it only for the services in this agreement.

IMPORTANT TAX INFORMATION. You are responsible for the timely filing of employment tax returns and the timely payment of employment taxes for your employees, even if you have authorized a third party to file the returns and make the payments. Authorizing Firm does not relieve you of any liability that results from a failure to file or pay on time. The Internal Revenue Service recommends that you enroll in the U.S. Treasury Department's Electronic Federal Tax Payment System (EFTPS) at www.eftps.gov to monitor your account and make sure timely tax payments are being made. State tax agencies generally offer similar ways to verify tax payments; contact the state office directly for details. Firm will repeat this statement at least once each quarter while it provides these services.

النسخة العربية — Arabic Translation

اتفاقية خدمات الرواتب

تؤكد هذه الاتفاقية شروط التعاقد بين {{clientName}} ("العميل") و{{firmName}} ("الشركة") لتقديم خدمات الرواتب وتقديمات أصحاب العمل، اعتباراً من {{effectiveDate}}.

نطاق الخدمات. تقدّم الشركة خدمات الرواتب وتقديمات أصحاب العمل التي اختارها العميل في قائمة خدماته وجدول رسومه، ولا تقدّم غيرها. وبحسب ذلك الاختيار قد تشمل: (أ) معالجة الرواتب: احتساب الأجر الإجمالي والصافي والاستقطاعات وضرائب صاحب العمل من الساعات ومعدلات الأجور ومعلومات الموظفين التي يقدّمها العميل، وإعداد كشوف الرواتب، وعند الاتفاق إعداد شيكات الرواتب أو ملفات الإيداع المباشر؛ (ب) إقرارات ضرائب التوظيف الاتحادية: النموذج 941 (ربع سنوي) والنموذج 940 (سنوي) والنموذج 944 إذا اشترطته مصلحة الضرائب (IRS)؛ (ج) تقارير الأجور في نهاية السنة من البيانات التي يقدّمها العميل: النموذجان W-2 وW-3 للموظفين والنموذجان 1099-NEC و1096 للعاملين من غير الموظفين؛ (د) إقرارات استقطاع ضريبة الدخل في الولاية والتسوية السنوية لولاية ماريلاند، ولأي ولاية أخرى أو مقاطعة كولومبيا إذا كان العميل مسجَّلاً فيها؛ (هـ) تقارير الاشتراكات والأجور الفصلية الخاصة بتأمين البطالة لولاية ماريلاند ولأي ولاية أخرى يكون العميل مسجَّلاً فيها؛ (و) الإيداعات الضريبية الاتحادية: تحتسب الشركة كل إيداع وموعد استحقاقه وتبلغ العميل بهما، ويقوم العميل بالإيداع عبر نظام EFTPS ما لم يكن العميل قد هيّأ وصول الشركة وأبلغها كتابةً بأن تقوم بذلك نيابة عنه؛ (ز) تقارير الموظفين الجدد، فقط إذا طلب العميل ذلك من الشركة كتابةً وزوّدها بالتفاصيل قبل الموعد النهائي؛ وإلا فإن تقديم تقارير الموظفين الجدد يبقى من واجب العميل.

ما لا تشمله الخدمة. لا تشمل هذه الخدمة تأمين تعويضات العمال، ولا مزايا الموظفين وخطط التقاعد، ولا النموذج I-9، ولا الامتثال لقوانين الأجور والساعات، ولا أوامر الحجز على الأجور ونفقة الأطفال، ولا الضرائب المحلية غير المذكورة أعلاه، ولا الاستشارات القانونية أو استشارات الموارد البشرية، ولا قرار ما إذا كان العامل موظفاً أم مقاولاً مستقلاً.

العميل يظل صاحب العمل المسجَّل. يظل العميل صاحب العمل المسجَّل لجميع الموظفين في جميع الأوقات، ويحتفظ بالمسؤولية النهائية عن الامتثال لقوانين الأجور والساعات، وعن تصنيف العاملين (موظف أم مقاول)، وعن دقة الساعات ومعدلات الأجور وسائر البيانات المقدَّمة إلى الشركة. ولا تصبح الشركة صاحب عمل ولا شريكة في صاحب العمل للعميل. وتعالج الشركة الرواتب بناءً على البيانات التي يقدّمها العميل، وهي غير مسؤولة عن الأخطاء الناتجة عن بيانات غير دقيقة أو متأخرة.

البيانات والمواعيد النهائية والتمويل. يقدّم العميل بيانات الرواتب بحلول الموعد الذي تحدده الشركة لكل فترة دفع، ويراجع كل كشف رواتب ويوافق عليه قبل صرفه. وقد يؤدي تأخر البيانات إلى تأخر كشف الرواتب أو التقديم أو إلى كشف رواتب خارج الدورة، وتقع أي غرامات ناتجة عن ذلك على العميل. ويبقي العميل حسابه المصرفي ممولاً لصافي الرواتب والمدفوعات الضريبية؛ وتقع على العميل الغرامات والرسوم الناتجة عن نقص الرصيد. وتحدد الشركة موعداً نهائياً في نهاية السنة لتصحيح بيانات الأجور؛ وأي تصحيح بعد تقديم نماذج نهاية السنة يتطلب نموذجاً معدَّلاً، وقد يُحتسب بمقابل منفصل. ويرسل العميل إلى الشركة فوراً أي إشعار يتلقاه من مصلحة الضرائب (IRS) أو جهة حكومية في الولاية بشأن حساب الرواتب.

التفويض بالتقديم؛ وكيل الإبلاغ. حيثما تقدّم الشركة إقرارات ضرائب التوظيف الاتحادية نيابة عن العميل، تعمل بصفتها وكيل الإبلاغ للعميل (reporting agent) بموجب النموذج IRS Form 8655، وفي التقديمات الخاصة بالولاية بموجب تفويض الولاية نفسها. ويوافق العميل على توقيع هذه التفويضات فور طلبها. ويحتفظ العميل بنفسه بحساباته وبيانات دخوله لدى EFTPS والجهات الحكومية، ولا تستخدم الشركة أي صلاحية دخول يمنحها إياها العميل إلا في الخدمات الواردة في هذه الاتفاقية.

معلومات ضريبية هامة. أنتم مسؤولون عن تقديم إقرارات ضرائب التوظيف في موعدها وسداد ضرائب التوظيف الخاصة بموظفيكم في موعدها، حتى لو فوّضتم طرفاً ثالثاً بتقديم الإقرارات وإجراء المدفوعات. ولا يعفيكم تفويض الشركة من أي مسؤولية تنتج عن عدم التقديم أو السداد في الموعد. وتوصي مصلحة الضرائب الأمريكية (IRS) بأن تسجّلوا في نظام وزارة الخزانة الأمريكية للدفع الضريبي الاتحادي الإلكتروني (EFTPS) على الموقع www.eftps.gov لمتابعة حسابكم والتأكد من سداد المدفوعات الضريبية في موعدها. وتوفّر الجهات الضريبية في الولايات عموماً وسائل مماثلة للتحقق من المدفوعات الضريبية؛ فيرجى الاتصال بمكتب الولاية مباشرةً لمعرفة التفاصيل. وستكرر الشركة هذا الإشعار مرة واحدة على الأقل كل ربع سنة ما دامت تقدّم هذه الخدمات.`,
  },
  {
    serviceKey: "sales_tax",
    title: "Sales Tax & Business Compliance Agreement",
    body: `SALES TAX & BUSINESS COMPLIANCE AGREEMENT

This agreement confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for sales tax filing and related business compliance services, effective {{effectiveDate}}.

SCOPE OF SERVICES. Firm provides the services Client has selected on its service list and fee schedule, and no others. Depending on that selection, they may include: (a) calculating and filing Client's periodic sales and use tax returns, for the periods the tax agency assigns (for Maryland, the Comptroller of Maryland; for another state or the District of Columbia where Client is registered, that jurisdiction's tax agency), based on sales records, point-of-sale data and other information Client provides; (b) preparing and submitting Client's annual report and, if Client owns, leases or uses personal property, its personal property tax return, with the Maryland State Department of Assessments and Taxation (SDAT) or the equivalent office in the state where Client's entity is registered; and (c) other related state business-compliance filings, such as an address change or account closing, as agreed in writing.

NOT INCLUDED. Tobacco, cigarette, alcohol, fuel and other excise tax returns; business license and permit applications or renewals; local taxes; bookkeeping; payroll; and income tax returns are not part of this service unless Client has separately engaged Firm for them.

ANNUAL REPORT. SDAT sets the due date each year (it has been April 15, with an extension available on request). An officer or principal of Client signs the annual report and personal property return under penalty of perjury; Firm prepares it and is identified on it as the preparer. Client gives Firm the correct owners, officers, resident agent, principal office and personal property information in time, and tells Firm promptly if any of it changes. Firm does not pay Client's property tax bill.

CLIENT RESPONSIBILITY FOR UNDERLYING DATA. Client is responsible for the accuracy of the sales records provided, including the correct classification of taxable and exempt sales and the exemption certificates it holds. Firm relies on the data and classifications Client provides and is not responsible for penalties or assessments resulting from inaccurate or incomplete underlying sales data. Client keeps its sales tax license active, and tells Firm right away if it closes, sells or moves the business.

FILING DEADLINES; PAYMENT. Client agrees to provide sales data to Firm with enough time before each filing deadline for Firm to prepare and file the return. Data received after Firm's stated cutoff may result in a late filing, and any resulting penalties or interest are Client's responsibility. Firm files the return; Client pays the tax from its own bank account as the General Terms describe, and Firm does not hold or pay Client's tax money.

NOTICES AND REPRESENTATION. Client sends Firm promptly any notice it receives from a tax agency. Firm will read the notice with Client, help gather records, and help prepare a factual response for Client to review and sign. With Client's signed authorization on the agency's own form (for Maryland, Comptroller Form 548), Firm may also contact the agency about routine account matters such as account status, copies of filings, and correcting a filing. Firm does not represent Client at a hearing, appeal, or Tax Court or other court proceeding, does not argue legal positions, and does not represent Client before the IRS unless a person the IRS allows (an attorney, certified public accountant or enrolled agent) has been named to Client in writing and Client has signed IRS Form 2848. Any notice or representation work beyond the routine matters above is a separate engagement with a separate written fee that does not depend on the result.

النسخة العربية — Arabic Translation

اتفاقية ضريبة المبيعات والامتثال التجاري

تؤكد هذه الاتفاقية شروط التعاقد بين {{clientName}} ("العميل") و{{firmName}} ("الشركة") لتقديم خدمات تقديم إقرارات ضريبة المبيعات وخدمات الامتثال التجاري ذات الصلة، اعتباراً من {{effectiveDate}}.

نطاق الخدمات. تقدّم الشركة الخدمات التي اختارها العميل في قائمة خدماته وجدول رسومه، ولا تقدّم غيرها. وبحسب ذلك الاختيار قد تشمل: (أ) احتساب وتقديم إقرارات ضريبة المبيعات والاستخدام الدورية للعميل، عن الفترات التي تحددها الجهة الضريبية (في ولاية ماريلاند هي مكتب المراقب المالي Comptroller of Maryland، وفي أي ولاية أخرى أو مقاطعة كولومبيا يكون العميل مسجَّلاً فيها هي الجهة الضريبية لتلك الجهة)، استناداً إلى سجلات المبيعات وبيانات نقاط البيع وسائر المعلومات التي يقدّمها العميل؛ (ب) إعداد وتقديم التقرير السنوي للعميل، وإقرار ضريبة الممتلكات الشخصية إذا كان العميل يملك ممتلكات شخصية أو يستأجرها أو يستخدمها، إلى إدارة التقييمات والضرائب في ولاية ماريلاند (SDAT) أو الجهة المماثلة في الولاية التي سُجّل فيها كيان العميل؛ (ج) تقديمات الامتثال التجاري الأخرى ذات الصلة في الولاية، مثل تغيير العنوان أو إغلاق حساب، وفق ما يُتفق عليه كتابةً.

ما لا تشمله الخدمة. لا تشمل هذه الخدمة إقرارات ضرائب التبغ والسجائر والكحول والوقود وغيرها من ضرائب الاستهلاك الانتقائية، ولا طلبات أو تجديدات التراخيص والتصاريح التجارية، ولا الضرائب المحلية، ولا مسك الدفاتر، ولا الرواتب، ولا إقرارات ضريبة الدخل، ما لم يتعاقد العميل مع الشركة عليها بشكل منفصل.

التقرير السنوي. تحدد إدارة SDAT موعد الاستحقاق كل سنة (وكان 15 أبريل، مع إمكانية التمديد عند الطلب). ويوقّع مسؤول أو مالك رئيسي لدى العميل على التقرير السنوي وإقرار الممتلكات الشخصية تحت طائلة عقوبة شهادة الزور؛ وتعدّه الشركة ويُذكر اسمها فيه بصفتها معدّاً له. ويزوّد العميل الشركة في الوقت المناسب بالملاك والمسؤولين والوكيل المقيم والمقر الرئيسي ومعلومات الممتلكات الشخصية الصحيحة، ويبلغها فوراً بأي تغيير فيها. ولا تدفع الشركة فاتورة ضريبة ممتلكات العميل.

مسؤولية العميل عن البيانات الأساسية. العميل مسؤول عن دقة سجلات المبيعات المقدَّمة، بما في ذلك التصنيف الصحيح للمبيعات الخاضعة للضريبة والمعفاة وشهادات الإعفاء التي يحتفظ بها. وتعتمد الشركة على البيانات والتصنيفات التي يقدّمها العميل، وهي غير مسؤولة عن الغرامات أو التقديرات الناتجة عن بيانات مبيعات أساسية غير دقيقة أو ناقصة. ويُبقي العميل ترخيص ضريبة المبيعات الخاص به فعّالاً، ويبلغ الشركة فوراً إذا أغلق نشاطه أو باعه أو نقله.

مواعيد التقديم؛ الدفع. يوافق العميل على تقديم بيانات المبيعات إلى الشركة قبل كل موعد تقديم بوقت كافٍ لتعدّ الشركة الإقرار وتقدّمه. وقد تؤدي البيانات الواردة بعد الموعد النهائي الذي حددته الشركة إلى تقديم متأخر، وتقع أي غرامات أو فوائد ناتجة عن ذلك على العميل. وتقدّم الشركة الإقرار، ويسدد العميل الضريبة من حسابه المصرفي الخاص كما تبيّن الشروط العامة، ولا تحتفظ الشركة بأموال ضريبة العميل ولا تدفعها.

الإشعارات والتمثيل. يرسل العميل إلى الشركة فوراً أي إشعار يتلقاه من جهة ضريبية. وتقرأ الشركة الإشعار مع العميل، وتساعد في جمع السجلات، وتساعد في إعداد رد وقائعي ليراجعه العميل ويوقّعه. وبموجب تفويض موقَّع من العميل على نموذج الجهة نفسها (في ماريلاند هو نموذج Comptroller Form 548) يجوز للشركة أيضاً الاتصال بالجهة بشأن أمور الحساب الروتينية مثل حالة الحساب ونسخ الإقرارات المقدَّمة وتصحيح إقرار. ولا تمثّل الشركة العميل في جلسة استماع أو استئناف أو أمام محكمة الضرائب (Tax Court) أو أي إجراء قضائي آخر، ولا تعرض حججاً قانونية، ولا تمثّل العميل أمام مصلحة الضرائب (IRS) ما لم يكن شخص تسمح له المصلحة (محامٍ أو محاسب قانوني معتمد أو وكيل ضرائب مسجَّل) قد سُمّي للعميل كتابةً وقد وقّع العميل النموذج IRS Form 2848. وأي عمل في الإشعارات أو التمثيل يتجاوز الأمور الروتينية أعلاه هو تعاقد منفصل برسم مكتوب منفصل لا يتوقف على النتيجة.`,
  },
  {
    serviceKey: "formation",
    title: "Business Formation & Registered Agent Agreement",
    body: `BUSINESS FORMATION & REGISTERED AGENT AGREEMENT

This agreement confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for business formation and/or registered agent services, effective {{effectiveDate}}.

SCOPE OF SERVICES. Firm will complete the agency's own forms for the formation documents and related registrations (such as an EIN application) that Client requests, using the entity type, name and structure Client selects, and will submit them to the applicable state and/or federal agency. Where engaged as registered (resident) agent, Firm will accept legal and state correspondence for Client at the address on file and forward it to Client promptly. Client signs, or has an authorized person sign, anything the agency requires an owner, member, officer or incorporator to sign.

FILING SERVICE ONLY — NOT LEGAL OR TAX ADVICE ON ENTITY CHOICE. Firm's services are limited to preparing and filing the documents Client requests on standard forms. Firm does not provide legal advice on which entity type or structure is right for Client, does not draft custom legal terms, and does not prepare an operating agreement, bylaws or similar document unless Client separately asks for a standard form and chooses its terms. Client is encouraged to consult an attorney or CPA before making that decision if the choice is not straightforward.

STATE FEES SEPARATE. State filing fees, registered-agent fees for future years, and any franchise or annual-report fees are separate from Firm's service fee, are billed to Client directly or passed through, and are non-refundable once paid to the state.

REGISTERED AGENT — CLIENT RESPONSIBILITY TO RESPOND. If Firm serves as Client's registered agent, Client keeps Firm informed of its current address, email and telephone number, and is responsible for promptly reviewing and responding to any document Firm forwards, including time-sensitive legal notices such as a lawsuit. Firm's role is limited to accepting and forwarding documents; Firm does not evaluate their legal significance or advise Client how to respond. Firm may resign as registered agent as the law allows, after written notice to Client.

AUTHORIZATION. Where an agency will deal with Firm only if Client authorizes it in writing, Client signs the separate Authorization to Act and Release of Information; it covers only the filings listed in it.

النسخة العربية — Arabic Translation

اتفاقية تأسيس الأعمال والوكيل المسجَّل

تؤكد هذه الاتفاقية شروط التعاقد بين {{clientName}} ("العميل") و{{firmName}} ("الشركة") لتقديم خدمات تأسيس الأعمال و/أو الوكيل المسجَّل، اعتباراً من {{effectiveDate}}.

نطاق الخدمات. تعبّئ الشركة نماذج الجهة نفسها الخاصة بمستندات التأسيس والتسجيلات ذات الصلة (مثل طلب رقم تعريف صاحب العمل EIN) التي يطلبها العميل، مستخدمةً نوع الكيان والاسم والهيكل الذي يختاره العميل، وتقدّمها إلى الجهة المختصة في الولاية و/أو الجهة الاتحادية. وحيثما تُكلَّف الشركة بصفة الوكيل المسجَّل (المقيم)، فإنها تستلم المراسلات القانونية والحكومية الموجهة للعميل على العنوان المسجَّل لديها وتحيلها إليه فوراً. ويوقّع العميل، أو يكلّف شخصاً مخوّلاً بالتوقيع، على كل ما تشترط الجهة أن يوقّعه مالك أو عضو أو مسؤول أو مؤسِّس.

خدمة تقديم فقط — وليست استشارة قانونية أو ضريبية بشأن اختيار نوع الكيان. تقتصر خدمات الشركة على إعداد المستندات التي يطلبها العميل وتقديمها على نماذج معيارية. ولا تقدّم الشركة استشارة قانونية بشأن نوع الكيان أو الهيكل المناسب للعميل، ولا تصوغ شروطاً قانونية خاصة، ولا تعدّ اتفاقية تشغيل أو لوائح داخلية أو مستنداً مماثلاً ما لم يطلب العميل نموذجاً معيارياً منها بشكل منفصل ويختر شروطه بنفسه. ويُنصح العميل باستشارة محامٍ أو محاسب قانوني معتمد قبل اتخاذ هذا القرار إذا لم يكن الاختيار بسيطاً.

الرسوم الحكومية منفصلة. رسوم التقديم لدى الولاية، ورسوم الوكيل المسجَّل للسنوات اللاحقة، وأي رسوم امتياز أو تقرير سنوي، منفصلة عن رسوم خدمة الشركة، وتُفوتَر للعميل مباشرةً أو تُحمَّل عليه، وهي غير قابلة للاسترداد بمجرد دفعها للولاية.

الوكيل المسجَّل — مسؤولية العميل في الرد. إذا عملت الشركة وكيلاً مسجَّلاً للعميل، فإن العميل يبقي الشركة على اطلاع على عنوانه وبريده الإلكتروني ورقم هاتفه الحاليين، ويكون مسؤولاً عن مراجعة أي مستند تحيله الشركة والرد عليه فوراً، بما في ذلك الإشعارات القانونية العاجلة مثل الدعاوى القضائية. ويقتصر دور الشركة على استلام المستندات وإحالتها؛ ولا تقيّم الشركة أهميتها القانونية ولا تنصح العميل كيف يرد عليها. ويجوز للشركة التخلي عن صفة الوكيل المسجَّل وفق ما يسمح به القانون، بعد إشعار كتابي للعميل.

التفويض. حيثما لا تتعامل الجهة مع الشركة إلا بتفويض كتابي من العميل، يوقّع العميل "التفويض بالتصرف والإفصاح عن المعلومات" المنفصل؛ وهو يقتصر على التقديمات المذكورة فيه.`,
  },
  {
    serviceKey: "business_transfer",
    title: "Business Transfer Documents Agreement",
    body: `BUSINESS TRANSFER DOCUMENTS AGREEMENT

This agreement confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for business transfer document preparation services, effective {{effectiveDate}}.

SCOPE OF SERVICES. Firm will prepare, from standard forms, the business-transfer and ownership-change documents Client requests — which may include a Bill of Sale, an amendment to Articles of Organization/Incorporation, an assignment of interest, or a similar document reflecting a sale, purchase, or change of ownership of Client's business — based on the terms, price and parties Client provides and chooses, and will file any resulting amendment with the applicable state agency where requested.

DOCUMENT PREPARATION ONLY — NOT LEGAL ADVICE. Firm's services are limited to preparing, and where applicable filing, documents that reflect terms Client has already decided on. Firm does not negotiate the transaction, does not draft custom legal terms, and does not advise on purchase price, allocation of assets or liabilities, tax structuring of the sale, or other legal or business terms of the transfer, and does not represent either party's interests in the transaction. Firm does not prepare deeds, leases, or any other document that transfers or affects title to real estate, or any document for a court case. Selling or buying a business can trigger notice, tax, license and lease requirements (for example a notice to the Comptroller and to creditors before a bulk sale, and licenses that cannot be transferred); Firm does not decide which apply. Client is encouraged to consult an attorney before finalizing any business sale, purchase, or ownership change, particularly where liabilities, licenses, leases, or employees are involved.

CLIENT RESPONSIBILITY FOR ACCURACY. Client is solely responsible for the accuracy of all parties, terms, and figures provided for inclusion in the document, and for obtaining all necessary signatures, licenses, and third-party consents (such as landlord or lender approval) before relying on it.

STATE FEES SEPARATE. Any state filing fees for an amendment or related registration are separate from Firm's service fee and are Client's responsibility.

النسخة العربية — Arabic Translation

اتفاقية مستندات نقل ملكية الأعمال

تؤكد هذه الاتفاقية شروط التعاقد بين {{clientName}} ("العميل") و{{firmName}} ("الشركة") لتقديم خدمات إعداد مستندات نقل ملكية الأعمال، اعتباراً من {{effectiveDate}}.

نطاق الخدمات. تعدّ الشركة، من نماذج معيارية، مستندات نقل الأعمال وتغيير الملكية التي يطلبها العميل — وقد تشمل عقد بيع، أو تعديلاً على عقد التأسيس/شهادة التأسيس، أو تنازلاً عن حصة، أو مستنداً مماثلاً يعكس بيع نشاط العميل أو شراءه أو تغيير ملكيته — استناداً إلى الشروط والسعر والأطراف التي يقدّمها العميل ويختارها، وتقدّم أي تعديل ناتج إلى الجهة المختصة في الولاية متى طُلب ذلك.

إعداد مستندات فقط — وليس استشارة قانونية. تقتصر خدمات الشركة على إعداد المستندات، وتقديمها عند الاقتضاء، بما يعكس شروطاً سبق أن قررها العميل. ولا تتفاوض الشركة على الصفقة، ولا تصوغ شروطاً قانونية خاصة، ولا تقدّم المشورة بشأن السعر أو توزيع الأصول والالتزامات أو الهيكلة الضريبية للبيع أو غيرها من الشروط القانونية أو التجارية للنقل، ولا تمثّل مصالح أي من الطرفين في الصفقة. ولا تعدّ الشركة صكوك ملكية (deeds) ولا عقود إيجار ولا أي مستند آخر ينقل ملكية عقار أو يؤثر فيها، ولا أي مستند لقضية أمام المحكمة. وقد يستتبع بيع نشاط تجاري أو شراؤه متطلبات إشعار وضرائب وتراخيص وإيجار (مثل إشعار مكتب المراقب المالي Comptroller والدائنين قبل البيع الجملي bulk sale، وتراخيص لا يجوز نقلها)؛ ولا تحدد الشركة أيّاً منها ينطبق. ويُنصح العميل باستشارة محامٍ قبل إتمام أي بيع أو شراء لنشاط تجاري أو تغيير ملكيته، لا سيما عند وجود التزامات أو تراخيص أو عقود إيجار أو موظفين.

مسؤولية العميل عن الدقة. العميل هو المسؤول الوحيد عن دقة جميع الأطراف والشروط والأرقام التي يقدّمها لإدراجها في المستند، وعن الحصول على جميع التوقيعات والتراخيص وموافقات الأطراف الثالثة اللازمة (مثل موافقة المؤجّر أو الجهة المقرضة) قبل الاعتماد على المستند.

الرسوم الحكومية منفصلة. أي رسوم تقديم حكومية لتعديل أو تسجيل ذي صلة منفصلة عن رسوم خدمة الشركة، ويتحملها العميل.`,
  },
  {
    serviceKey: "permits_licenses",
    title: "Business Licenses & Permits Agreement",
    body: `BUSINESS LICENSES & PERMITS AGREEMENT

This agreement confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for business license and permit preparation services, effective {{effectiveDate}}.

SCOPE OF SERVICES. Firm will prepare and submit applications for the license(s) and/or permit(s) Client requests — which may include a health department food service permit, a use & occupancy permit, a trader's license, a tobacco license, or similar state or local licensing/permitting requirements — using the business information Client provides, and, where the issuing agency provides its own application form, will complete that agency's own form rather than a substitute document. The license or permit is issued to Client, not to Firm.

CLIENT RESPONSIBILITY FOR ACCURACY. Client is solely responsible for the accuracy and completeness of the business information, menu, equipment, and other details submitted with each application, and for confirming the resulting license or permit before relying on it. An owner or officer of Client signs any certification or declaration the agency requires an owner or officer to make, and Client attends any inspection.

NO GUARANTEE OF ISSUANCE OR TIMING. Firm does not guarantee that any license or permit will be approved, and is not responsible for a licensing agency's review time, inspection scheduling, additional-information requests, or fee assessments, all of which are outside Firm's control. Government filing fees and inspection fees are separate from Firm's service fee and are Client's responsibility. Firm does not represent Client at a licensing board hearing, appeal or court proceeding, and does not give legal advice about a denial or a violation.

RENEWAL IS A SEPARATE ENGAGEMENT UNLESS AGREED OTHERWISE. Unless the parties agree in writing to an ongoing renewal engagement, each license or permit application is a one-time engagement; Firm is not responsible for tracking or renewing a license or permit after it is issued unless separately engaged to do so. A license or permit generally cannot be sold or transferred to a new owner; Client must ask the issuing agency what is needed if the business changes hands.

AUTHORIZATION. Where the agency will deal with Firm only if Client authorizes it in writing, Client signs the separate Authorization to Act and Release of Information; it covers only the applications listed in it.

النسخة العربية — Arabic Translation

اتفاقية التراخيص والتصاريح التجارية

تؤكد هذه الاتفاقية شروط التعاقد بين {{clientName}} ("العميل") و{{firmName}} ("الشركة") لتقديم خدمات إعداد طلبات التراخيص والتصاريح التجارية، اعتباراً من {{effectiveDate}}.

نطاق الخدمات. تعدّ الشركة وتقدّم طلبات الترخيص و/أو التصريح التي يطلبها العميل — وقد تشمل تصريح خدمة الأغذية من إدارة الصحة، وتصريح الاستخدام والإشغال، وترخيص التاجر (trader's license)، وترخيص التبغ، أو متطلبات ترخيص وتصريح مماثلة على مستوى الولاية أو المحلية — باستخدام معلومات النشاط التي يقدّمها العميل، وحيثما توفّر الجهة المصدِرة نموذج طلب خاصاً بها فإن الشركة تعبّئ نموذج الجهة نفسه لا مستنداً بديلاً عنه. ويصدر الترخيص أو التصريح باسم العميل لا باسم الشركة.

مسؤولية العميل عن الدقة. العميل هو المسؤول الوحيد عن دقة واكتمال معلومات النشاط وقائمة الطعام والمعدات وغيرها من التفاصيل المقدَّمة مع كل طلب، وعن التحقق من الترخيص أو التصريح الناتج قبل الاعتماد عليه. ويوقّع مالك أو مسؤول لدى العميل أي إقرار أو تصريح تشترط الجهة أن يدلي به مالك أو مسؤول، ويحضر العميل أي معاينة.

لا ضمان للإصدار أو للمدة. لا تضمن الشركة الموافقة على أي ترخيص أو تصريح، وهي غير مسؤولة عن مدة مراجعة الجهة المرخِّصة، أو جدولة المعاينة، أو طلبات المعلومات الإضافية، أو تقدير الرسوم، وكلها خارجة عن سيطرتها. والرسوم الحكومية ورسوم المعاينة منفصلة عن رسوم خدمة الشركة ويتحملها العميل. ولا تمثّل الشركة العميل في جلسة استماع أمام هيئة ترخيص أو استئناف أو إجراء قضائي، ولا تقدّم استشارة قانونية بشأن رفض الطلب أو مخالفة.

التجديد تعاقد منفصل ما لم يُتفق على خلاف ذلك. ما لم يتفق الطرفان كتابةً على تعاقد مستمر للتجديد، يُعدّ كل طلب ترخيص أو تصريح تعاقداً لمرة واحدة؛ ولا تكون الشركة مسؤولة عن متابعة الترخيص أو التصريح أو تجديده بعد صدوره ما لم تُكلَّف بذلك بشكل منفصل. والترخيص أو التصريح لا يجوز عموماً بيعه ولا نقله إلى مالك جديد؛ وعلى العميل أن يسأل الجهة المصدِرة عمّا يلزم إذا تغيّرت ملكية النشاط.

التفويض. حيثما لا تتعامل الجهة مع الشركة إلا بتفويض كتابي من العميل، يوقّع العميل "التفويض بالتصرف والإفصاح عن المعلومات" المنفصل؛ وهو يقتصر على الطلبات المذكورة فيه.`,
  },
  {
    serviceKey: "snap_retailer_application",
    title: "SNAP Retailer Application Services Agreement",
    body: `SNAP RETAILER APPLICATION SERVICES AGREEMENT

This agreement confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for SNAP (Supplemental Nutrition Assistance Program) retailer authorization application services, effective {{effectiveDate}}.

SCOPE OF SERVICES. Firm will prepare Client's application to the U.S. Department of Agriculture, Food and Nutrition Service ("FNS"), to be authorized as a SNAP-accepting retailer, using the business information Client provides, and will submit it for Client. Where Client has signed the separate Authorization to Act and Release of Information, Firm will also handle related correspondence with FNS during the application process.

CLIENT RESPONSIBILITY FOR ACCURACY. Client is solely responsible for the accuracy and completeness of the business, ownership and inventory information submitted with the application, and for confirming the resulting authorization before relying on it. The application's certification must be made and signed by an owner or officer of Client personally; the information in it, including the owners' personal identifying numbers, is given under penalty of the law for false statements, and Firm does not make that certification for Client.

NO GUARANTEE OF AUTHORIZATION. Firm does not guarantee that FNS will approve Client's application. FNS eligibility criteria (such as stocking requirements and staple-food inventory) are determined solely by FNS, and Firm is not responsible for FNS's review time, site-visit scheduling, additional-information requests, or a denial of authorization.

EBT EQUIPMENT AND PROCESSOR SEPARATE. Obtaining and maintaining EBT point-of-sale equipment and a third-party payment processor relationship is Client's responsibility and is separate from this engagement unless otherwise agreed in writing.

ONGOING COMPLIANCE IS CLIENT'S RESPONSIBILITY. Once authorized, Client is solely responsible for complying with SNAP program rules on an ongoing basis, including accepting benefits only for eligible items and keeping accurate transaction records. An authorization belongs to the store and cannot be transferred to a new owner. Firm's engagement under this agreement ends once the application is submitted and a determination is received, unless separately engaged for renewal or compliance support. Firm does not represent Client in an FNS appeal, hearing or court proceeding and does not give legal advice about a denial, a charge letter or a disqualification.

النسخة العربية — Arabic Translation

اتفاقية خدمات طلب ترخيص تاجر برنامج SNAP

تؤكد هذه الاتفاقية شروط التعاقد بين {{clientName}} ("العميل") و{{firmName}} ("الشركة") لتقديم خدمات طلب ترخيص تاجر التجزئة في برنامج المساعدة الغذائية التكميلية (SNAP)، اعتباراً من {{effectiveDate}}.

نطاق الخدمات. تعدّ الشركة طلب العميل المقدَّم إلى وزارة الزراعة الأمريكية – دائرة الغذاء والتغذية ("FNS") للحصول على ترخيص بقبول مستفيدي برنامج SNAP بوصفه تاجر تجزئة، باستخدام معلومات النشاط التي يقدّمها العميل، وتقدّمه عن العميل. وحيثما يكون العميل قد وقّع "التفويض بالتصرف والإفصاح عن المعلومات" المنفصل، تتولى الشركة أيضاً المراسلات ذات الصلة مع FNS خلال مرحلة الطلب.

مسؤولية العميل عن الدقة. العميل هو المسؤول الوحيد عن دقة واكتمال معلومات النشاط والملكية والمخزون المقدَّمة مع الطلب، وعن التحقق من الترخيص الناتج قبل الاعتماد عليه. ويجب أن يدلي مالك أو مسؤول لدى العميل بإقرار الطلب ويوقّعه شخصياً؛ والمعلومات الواردة فيه، بما فيها أرقام التعريف الشخصية للملاك، تُقدَّم تحت طائلة القانون المتعلق بالإفادات الكاذبة، ولا تدلي الشركة بهذا الإقرار نيابةً عن العميل.

لا ضمان للترخيص. لا تضمن الشركة موافقة FNS على طلب العميل. فمعايير الأهلية لدى FNS (مثل متطلبات التخزين ومخزون المواد الغذائية الأساسية) تحددها FNS وحدها، والشركة غير مسؤولة عن مدة مراجعة FNS أو جدولة زيارة الموقع أو طلبات المعلومات الإضافية أو رفض الترخيص.

معدات EBT والمعالج منفصلان. الحصول على معدات نقاط البيع الخاصة بـ EBT والإبقاء عليها، وعلاقة العميل بجهة معالجة الدفع من طرف ثالث، من مسؤولية العميل وهي منفصلة عن هذا التعاقد ما لم يُتفق على خلاف ذلك كتابةً.

الامتثال المستمر من مسؤولية العميل. بعد صدور الترخيص يكون العميل وحده مسؤولاً عن الامتثال لقواعد برنامج SNAP بصورة مستمرة، بما في ذلك قبول المزايا للأصناف المؤهَّلة فقط والاحتفاظ بسجلات معاملات دقيقة. والترخيص يخص المتجر ولا يجوز نقله إلى مالك جديد. وينتهي تعاقد الشركة بموجب هذه الاتفاقية بتقديم الطلب واستلام القرار، ما لم تُكلَّف بشكل منفصل بالتجديد أو بدعم الامتثال. ولا تمثّل الشركة العميل في استئناف أو جلسة استماع أو إجراء قضائي أمام FNS، ولا تقدّم استشارة قانونية بشأن الرفض أو خطاب اتهام أو الاستبعاد من البرنامج.`,
  },
  {
    serviceKey: POA_RELEASE_SERVICE_KEY,
    title: POA_RELEASE_TITLE,
    // Generalized from the firm's own paper POA (a specific client's signed
    // Big Boys Carryout authorization) — tokenized so it works for any
    // client, and improved in two ways over that original: (1) the list of
    // what's authorized is a per-client CHECKLIST built from
    // buildAuthorizedFilingsList() below, from the client's own selected
    // services, rather than one fixed paragraph naming every filing type
    // whether or not that client actually needs it; (2) the release-of-
    // information clause (agencies may discuss the application and disclose
    // records to the Firm) is its own numbered clause instead of folded into
    // "handle all related communications," since that's the specific
    // language these agencies actually rely on before they'll talk to a
    // third party. Deliberately does NOT name individual staff as
    // attorneys-in-fact (the original named two people); the grant runs to
    // the Firm, exercised through whichever staff member is handling the
    // client, matching how every other engagement letter in this file is
    // written. Physical-signature-only — clause 7 below and the app itself
    // (no electronic e-sign option is offered for this document) both say so,
    // because several of the agencies this covers do not accept an
    // electronically signed version.
    //
    // Fifth audit pass: Maryland Estates & Trusts §17-109(b) — Title 17 does not apply to a power "created on a form
    // prescribed by a government ... agency", to a power to "prepare, execute, deliver, submit, or file, on behalf of an
    // entity ... a document ... with a government", or to a power of attorney "that states that it is not subject to
    // this title" (§17-109(b)(6)); so the two-witness-and-notary formality of §17-110 does not apply once clause 6 says
    // so. "Attorney-in-Fact" is the term the agencies use, so it stays, with a plain statement that it is not a
    // lawyer (Bus. Occ. & Prof. §10-101(h), §10-601). Bilingual (Arabic after the English), like every other contract.
    body: `AUTHORIZATION TO ACT AND RELEASE OF INFORMATION

BE IT ACKNOWLEDGED that on {{effectiveDate}}, {{clientName}} ("Principal") does hereby grant a limited and specific power of attorney and authorization to {{firmName}} ("Attorney-in-Fact") to act on Principal's behalf as follows. Attorney-in-Fact is not an attorney at law; it does not practice law and does not give legal advice, and nothing in this authorization authorizes it to.

1. AUTHORITY TO ACT. Attorney-in-Fact is authorized to prepare, submit, and follow up on the following application(s) and filing(s) on Principal's behalf, and to handle related communications with the issuing agency for that purpose:

{{authorizedFilings}}

Where an agency's form requires a certification or signature by an owner, officer or other principal of the business, that person signs it personally. Attorney-in-Fact signs only as preparer or agent where the agency's form allows it, and never signs, on Principal's behalf, a certification that the agency requires an owner or officer to make.

2. RELEASE OF INFORMATION. Principal authorizes each agency named or described above, and any other agency processing the filing(s) listed above, to discuss Principal's application, account, and filing status with Attorney-in-Fact, and to release related records and information to Attorney-in-Fact, to the same extent Principal could obtain that information directly.

3. SCOPE LIMITED TO THE ABOVE. This authorization is limited to the filing(s) listed above and such incidental acts as are reasonably required to complete them. It does not authorize Attorney-in-Fact to act on any other matter. It does not authorize Attorney-in-Fact to receive funds on Principal's behalf, to open or use Principal's bank account, to sign checks, to sell or mortgage property, to borrow money, to sign any other contract for Principal, or to represent Principal at a hearing, appeal or court proceeding.

4. AGENCY FORMS. Some agencies accept only their own form (for example IRS Form 2848 or 8821, or Maryland Comptroller Form 548, for tax accounts). If an agency requires its own form or a notarized signature, Attorney-in-Fact will tell Principal, and Principal will sign that form as well; this authorization does not replace it.

5. TERMINATION. This authorization remains in effect until the filing(s) listed above are completed or Principal revokes it in writing, whichever occurs first. Principal may revoke this authorization at any time by written notice to {{firmName}}; upon receipt, Attorney-in-Fact will cease all activity under this authorization and, upon request, will promptly return any of Principal's documents in its possession.

6. GOVERNING LAW. This authorization is governed by the laws of the State of Maryland. It is limited to the filings listed above, is not a general power of attorney, and states that it is not subject to Title 17 of the Estates and Trusts Article of the Maryland Code.

7. PHYSICAL SIGNATURE REQUIRED. This authorization must be signed by hand, in ink, by Principal. Several of the agencies named above do not accept an electronically signed version of this document; an electronic or typed signature does not satisfy this requirement.

By signing below, Principal confirms having read and understood this authorization (in English or in the Arabic translation below) and grants it as stated above. If Principal is a business, the person signing confirms that he or she is an owner or officer with authority to sign for it.

النسخة العربية — Arabic Translation

التفويض بالتصرف والإفصاح عن المعلومات

يُقرّ بأنه في تاريخ {{effectiveDate}}، يمنح {{clientName}} ("الموكِّل") {{firmName}} ("الوكيل") وكالةً وتفويضاً محدَّدين ومقيَّدين للتصرف نيابةً عن الموكِّل على النحو الآتي. والوكيل ليس محامياً، ولا يمارس المحاماة ولا يقدّم استشارات قانونية، وليس في هذا التفويض ما يخوّله ذلك.

1. سلطة التصرف. يُفوَّض الوكيل بإعداد الطلب (الطلبات) والتقديم (التقديمات) الآتية نيابةً عن الموكِّل وتقديمها ومتابعتها، وبإجراء الاتصالات ذات الصلة مع الجهة المصدِرة لهذا الغرض:

{{authorizedFilings}}

وحيثما يشترط نموذج الجهة إقراراً أو توقيعاً من مالك أو مسؤول أو شخص رئيسي في النشاط، فإن ذلك الشخص هو من يوقّعه شخصياً. ولا يوقّع الوكيل إلا بصفته معدّاً أو وكيلاً حيثما يسمح نموذج الجهة بذلك، ولا يوقّع أبداً نيابةً عن الموكِّل إقراراً تشترط الجهة أن يدلي به مالك أو مسؤول.

2. الإفصاح عن المعلومات. يأذن الموكِّل لكل جهة مذكورة أو موصوفة أعلاه، ولأي جهة أخرى تعالج التقديم (التقديمات) المذكورة أعلاه، بأن تناقش مع الوكيل طلب الموكِّل وحسابه وحالة تقديمه، وأن تفصح للوكيل عن السجلات والمعلومات ذات الصلة، بالقدر نفسه الذي يمكن للموكِّل أن يحصل به على تلك المعلومات مباشرةً.

3. النطاق مقتصر على ما سبق. يقتصر هذا التفويض على التقديم (التقديمات) المذكورة أعلاه وما يلزم عرَضاً بصورة معقولة لإتمامها. ولا يخوّل الوكيل التصرف في أي أمر آخر. ولا يخوّله استلام أموال نيابةً عن الموكِّل، ولا فتح الحساب المصرفي للموكِّل أو استخدامه، ولا توقيع شيكات، ولا بيع ممتلكات أو رهنها، ولا الاقتراض، ولا توقيع أي عقد آخر نيابةً عن الموكِّل، ولا تمثيل الموكِّل في جلسة استماع أو استئناف أو إجراء قضائي.

4. نماذج الجهات. تقبل بعض الجهات نموذجها الخاص فقط (مثل النموذج IRS Form 2848 أو 8821، أو نموذج Maryland Comptroller Form 548، للحسابات الضريبية). وإذا اشترطت جهة نموذجها الخاص أو توقيعاً موثَّقاً لدى كاتب عدل، فإن الوكيل يبلغ الموكِّل بذلك، ويوقّع الموكِّل ذلك النموذج أيضاً؛ ولا يحل هذا التفويض محله.

5. الإنهاء. يظل هذا التفويض ساري المفعول إلى أن يتم التقديم (التقديمات) المذكورة أعلاه أو يلغيه الموكِّل كتابةً، أيهما أسبق. ويجوز للموكِّل إلغاء هذا التفويض في أي وقت بإشعار كتابي إلى {{firmName}}؛ وعند استلام الإشعار يتوقف الوكيل عن كل نشاط بموجب هذا التفويض، ويعيد فوراً، عند الطلب، أي مستندات تخص الموكِّل في حوزته.

6. القانون المُطبَّق. يخضع هذا التفويض لقوانين ولاية ماريلاند. وهو مقتصر على التقديمات المذكورة أعلاه، وليس توكيلاً عاماً، وينصّ على أنه غير خاضع للباب 17 من مادة العقارات والوصايا (Estates and Trusts Article) من مدونة ولاية ماريلاند.

7. التوقيع بخط اليد مطلوب. يجب أن يوقّع الموكِّل هذا التفويض بخط يده وبالحبر. فعدد من الجهات المذكورة أعلاه لا تقبل نسخة موقّعة إلكترونياً من هذا المستند؛ والتوقيع الإلكتروني أو المكتوب بالحاسوب لا يستوفي هذا الشرط.

بالتوقيع أدناه، يؤكد الموكِّل أنه قرأ هذا التفويض وفهمه (بالإنجليزية أو بالترجمة العربية أعلاه) ويمنحه على النحو المبيَّن أعلاه. وإذا كان الموكِّل نشاطاً تجارياً، فإن الموقّع يؤكد أنه مالك أو مسؤول مخوَّل بالتوقيع عنه.`,
  },
  {
    serviceKey: "immigration",
    title: "Immigration Form Typing & Translation Agreement",
    // Bilingual by design: most of the firm's immigration clients read Arabic more
    // comfortably than English, and a disclosure the client can't actually read is
    // not real informed consent — the highest-risk sentence in this whole template
    // is "we are not attorneys," and that sentence has to land. The Arabic block
    // below is a full, independent translation of the scope + disclosure +
    // acknowledgment (not machine-translated placeholder text), appended after the
    // English original rather than interleaved, matching how the referral-email
    // template handles English/Arabic. The shared GENERAL_TERMS block below is
    // translated the same way for the same reason, so the fees/liability/e-sign
    // section every contract carries is equally readable, not just this one.
    //
    // Fifth audit pass: Maryland Commercial Law Title 14, Subtitle 33 (the immigration-consultant law), read verbatim.
    // §14-3301(e): "legal services" includes "providing forms ..., completing forms on behalf of an individual, filing
    // forms on behalf of an individual, advising an individual to file forms, or applying for a benefit on behalf of an
    // individual", while "secretarial services" are "writing, typing, or copying information as provided by an
    // individual" and translating into English. §14-3303: a consultant may not give legal advice or legal services, may
    // not collect any fee "for services not yet performed", and may not refuse to return documents at the client's
    // request. §14-3304: the written contract must itemize services and fees, state the right to consult an attorney and
    // the right to rescind within 72 hours, contain the two quoted statements "conspicuously ... in at least 12 point
    // type", be in English and each language the consultant provides services in, and a copy goes to the client on
    // signing; documents are returned even in a fee dispute. §14-3305: a sign with the first statement must be posted at
    // each place of business. §14-3302 exempts only attorneys, persons authorized under 8 CFR §292.1, recognized
    // nonprofits and law-school clinics — the firm is none of these (8 CFR §292.1(a)(3): a "reputable individual" must
    // appear "without direct or indirect renumeration"). So the scope is cut back to secretarial services; the firm no
    // longer files or submits an application. The two statements are alone in their own paragraphs so the PDF can print
    // them at 12 point (contractPdf.ts).
    body: `IMMIGRATION FORM TYPING & TRANSLATION AGREEMENT

This agreement confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for immigration document typing and translation services, effective {{effectiveDate}}. Client is an Individual Client under the General Terms.

{{firmName}} makes the following two statements, which Maryland law requires in this contract:

I am not an attorney licensed to practice law in Maryland, and may not provide legal forms, provide legal advice, or provide legal services.

I cannot accept a fee for referring a client to another person for services that I cannot or will not perform.

CLIENT'S RIGHTS. Client has the right to consult an attorney before signing this agreement. Client has the right to rescind (cancel) this agreement within 72 hours after signing it, by telling Firm in writing (email counts); if Client does, Firm returns every document Client gave Firm and refunds anything Client paid. Firm gives Client a copy of this agreement, in English and Arabic, when it is signed.

WHAT WE DO. Firm provides secretarial services only: (a) typing or copying into a form, word for word, the information Client gives Firm, on a form that Client has chosen and obtained from the agency; (b) translating Client's documents into English; and (c) copying Client's own supporting documents and putting them in the order Client chooses. Client reads the form, checks every answer, and signs it personally, and Client personally files it with the agency. Firm does not file, submit or mail an application for Client, does not apply for a benefit for Client, and does not communicate with an immigration agency for Client. Where a form asks who typed or translated it, Firm is listed truthfully as the person who typed or translated it.

IMPORTANT NOTICE — {{firmName}} IS NOT A LAW FIRM. {{firmName}} and its staff are NOT attorneys and are not authorized to practice law. {{firmName}} does NOT provide legal advice, does NOT provide or choose forms for Client, does NOT tell Client which immigration form, benefit, or status to apply for or whether to apply, does NOT evaluate the legal merits or likelihood of success of Client's case, does NOT represent Client before USCIS, any immigration court, or any other government body, and does not claim any title or credential that would qualify it to give legal advice. {{firmName}} does not claim to have special influence with any government agency. {{firmName}}'s help is limited to the secretarial services described above, strictly according to Client's own instructions and choices.

CLIENT DIRECTS THE FORM AND CONTENT. Client is solely responsible for deciding which application or petition to file, for obtaining the form, and for the accuracy of every fact stated in it. Firm may point out that required fields are blank or that supporting documents appear to be missing, but does not decide what Client should submit.

RECOMMENDATION TO CONSULT AN ATTORNEY. If Client's matter involves any legal complexity, prior immigration violations, criminal history, a denial, or anything Client is unsure how to answer, {{firmName}} strongly recommends Client consult a licensed immigration attorney, or a recognized nonprofit legal organization, before proceeding. Firm can give Client the contact details of a lawyer referral service or legal-aid organization on request, accepts no payment for any referral, and does not act as Client's legal representative.

ITEMIZED FEES; NO ADVANCE PAYMENT. Firm charges only the fees listed here: {{feeAmount}}. If that line says the fee is to be agreed separately, Firm will not start work until Firm and Client have signed a written list of each fee, and Firm will not charge a fee that is not on that list. Firm collects no fee for any service until that service has been performed. Government filing fees are paid by Client directly to the agency.

RETURN OF DOCUMENTS. Firm returns every document Client gave Firm, and every document Firm prepared for Client, whenever Client asks, even if there is a fee dispute. This replaces section 5 of the General Terms for this service. Nothing in this agreement limits any right Client has under Title 14, Subtitle 33 of the Maryland Commercial Law Article.

NO GUARANTEE OF APPROVAL. Firm does not guarantee that any application or petition will be approved, and is not responsible for USCIS or other government processing times, decisions, or delays, all of which are outside Firm's control.

ACKNOWLEDGMENT. By signing below, Client acknowledges having read and understood this notice (in English or in the Arabic translation below), confirms that Firm has not provided legal advice, and confirms that all information provided to Firm for inclusion on any form is true and complete to Client's own knowledge.

النسخة العربية — Arabic Translation

اتفاقية كتابة نماذج الهجرة وترجمة مستنداتها

تؤكد هذه الاتفاقية شروط التعاقد بين {{clientName}} ("العميل") و{{firmName}} ("الشركة") لتقديم خدمات كتابة مستندات الهجرة وترجمتها، اعتباراً من {{effectiveDate}}. والعميل "عميل فرد" بموجب الشروط العامة.

تدلي {{firmName}} بالإفادتين الآتيتين اللتين يوجب قانون ولاية ماريلاند إدراجهما في هذا العقد:

أنا لست محامياً مرخصاً بممارسة المحاماة في ولاية ماريلاند، ولا يجوز لي تقديم نماذج قانونية، ولا تقديم استشارات قانونية، ولا تقديم خدمات قانونية.

لا أستطيع قبول أي أجر مقابل إحالة عميل إلى شخص آخر لأداء خدمات لا أستطيع أداءها أو لا أنوي أداءها.

حقوق العميل. للعميل الحق في استشارة محامٍ قبل توقيع هذه الاتفاقية. وللعميل الحق في فسخ هذه الاتفاقية (إلغائها) خلال 72 ساعة من توقيعها، بإبلاغ الشركة كتابةً (ويُعدّ البريد الإلكتروني كتابةً)؛ وإذا فعل ذلك أعادت الشركة كل مستند سلّمه العميل لها وردّت كل ما دفعه. وتسلّم الشركة العميل نسخة من هذه الاتفاقية، بالإنجليزية والعربية، عند توقيعها.

ماذا نقدّم من خدمات. تقدّم الشركة خدمات السكرتارية فقط: (أ) كتابة المعلومات التي يقدّمها العميل للشركة، أو نسخها حرفياً، في نموذج اختاره العميل وحصل عليه من الجهة؛ (ب) ترجمة مستندات العميل إلى الإنجليزية؛ (ج) تصوير مستندات العميل الداعمة وترتيبها وفق ما يختاره العميل. ويقرأ العميل النموذج ويراجع كل إجابة ويوقّعه بنفسه، ويقدّمه العميل بنفسه إلى الجهة. ولا تقدّم الشركة طلباً ولا ترسله ولا تضعه في البريد عن العميل، ولا تتقدّم بطلب للحصول على منفعة نيابةً عنه، ولا تتواصل مع أي جهة هجرة نيابةً عنه. وحيثما يسأل النموذج عمّن كتبه أو ترجمه، يُذكر اسم الشركة بصدق بوصفها من كتب أو ترجم.

تنبيه هام — {{firmName}} ليست مكتباً قانونياً. إنّ {{firmName}} وموظفيها ليسوا محامين وغير مخوّلين بممارسة المحاماة. لا تقدّم {{firmName}} أي استشارة قانونية، ولا تقدّم النماذج للعميل ولا تختارها له، ولا تُخبر العميل بأي استمارة أو مصلحة هجرة أو وضع يجب التقدّم إليه أو ما إذا كان عليه التقدّم أصلاً، ولا تُقيّم الأسس القانونية لقضية العميل أو احتمالية نجاحها، ولا تُمثّل العميل أمام دائرة خدمات المواطنة والهجرة الأمريكية (USCIS) أو أي محكمة هجرة أو أي جهة حكومية أخرى، ولا تدّعي أي لقب أو صفة تؤهلها لتقديم استشارة قانونية. ولا تدّعي {{firmName}} أن لها نفوذاً خاصاً لدى أي جهة حكومية. وتقتصر مساعدة {{firmName}} على خدمات السكرتارية الموضحة أعلاه، وفقاً حصراً لتعليمات واختيارات العميل.

العميل هو من يحدّد نوع الطلب ومحتواه. العميل هو المسؤول الوحيد عن اختيار نوع الطلب أو الالتماس الذي سيتم تقديمه، وعن الحصول على النموذج، وعن دقة كل معلومة واردة فيه. يجوز لـ{{firmName}} الإشارة إلى الحقول الفارغة أو المستندات الداعمة التي يبدو أنها ناقصة، لكنها لا تقرر نيابة عن العميل ما يجب تقديمه.

التوصية باستشارة محامٍ. إذا كانت قضية العميل تنطوي على أي تعقيد قانوني، أو مخالفات هجرة سابقة، أو سجل جنائي، أو رفض سابق، أو أي أمر لا يعرف العميل كيفية الإجابة عنه، توصي {{firmName}} بشدة باستشارة محامي هجرة مرخّص، أو منظمة قانونية غير ربحية معترف بها، قبل المتابعة. ويمكن لـ{{firmName}} أن تزوّد العميل عند الطلب ببيانات الاتصال بخدمة إحالة محامين أو بمنظمة مساعدة قانونية، ولا تقبل أي مقابل عن أي إحالة، ولا تعمل كممثل قانوني للعميل.

الرسوم مفصّلة؛ ولا دفع مقدماً. لا تتقاضى الشركة إلا الرسوم المذكورة هنا: {{feeAmountAr}}. وإذا ورد في ذلك البند أن الرسم يُتفق عليه بشكل منفصل، فلن تبدأ الشركة العمل إلى أن توقّع الشركة والعميل قائمة مكتوبة بكل رسم، ولن تتقاضى الشركة أي رسم غير وارد في تلك القائمة. ولا تتقاضى الشركة أي رسم عن أي خدمة قبل أدائها. وتُدفع الرسوم الحكومية للتقديم من العميل مباشرةً إلى الجهة.

إعادة المستندات. تعيد الشركة كل مستند سلّمه العميل لها وكل مستند أعدّته للعميل متى طلب العميل ذلك، حتى في حال وجود خلاف على الرسوم. ويحل هذا محل البند 5 من الشروط العامة بالنسبة لهذه الخدمة. وليس في هذه الاتفاقية ما يحدّ من أي حق للعميل بموجب الباب 14، الفرع 33 من قانون التجارة (Commercial Law) في ولاية ماريلاند.

لا يوجد ضمان للموافقة. لا تضمن الشركة الموافقة على أي طلب أو التماس، وهي غير مسؤولة عن مدة معالجة دائرة USCIS أو أي جهة حكومية أخرى أو عن قراراتها أو تأخيراتها، فجميعها أمور خارجة عن سيطرة الشركة.

الإقرار. بالتوقيع أدناه، يُقرّ العميل بأنه قرأ هذا الإشعار وفهمه (بالإنجليزية أو بالترجمة العربية أعلاه)، ويؤكد أن {{firmName}} لم تقدّم له أي استشارة قانونية، ويؤكد أن جميع المعلومات المقدَّمة إلى {{firmName}} لإدراجها في أي استمارة صحيحة وكاملة على حد علمه.`,
  },
  {
    serviceKey: "consulting",
    title: "Consulting & Administrative Services Agreement",
    body: `CONSULTING & ADMINISTRATIVE SERVICES AGREEMENT

This agreement confirms the terms of the engagement between {{clientName}} ("Client") and {{firmName}} ("Firm") for the consulting and/or administrative services described below, effective {{effectiveDate}}.

SCOPE OF SERVICES. Firm will provide general business, administrative, or advisory support to Client as separately described or agreed between the parties in writing (email counts).

IRS AND STATE AUDIT, EXAMINATION AND NOTICE SUPPORT. If this engagement includes support with an IRS or state audit, examination or notice, Firm will help Client collect records, understand the notice (as general information, not legal advice), prepare factual explanations, and draft a response for Client to review and sign. Firm represents Client before the IRS or a state agency only through a person who is lawfully allowed to (for the IRS, an attorney, certified public accountant or enrolled agent; for the Comptroller of Maryland, a person it allows under its own rules), whom Firm will name to Client in writing before the representation begins, and only after Client signs the agency's authorization form (IRS Form 2848 or 8821, or Maryland Comptroller Form 548). A Firm staff member who is not so authorized may help prepare the materials and may attend a meeting only as Client's helper, not as Client's representative. Firm does not represent Client at an appeals conference, collection hearing, administrative hearing, or in Tax Court or any other court, and does not handle a criminal or fraud investigation. Firm's fee for this support is separate and does not depend on the result, and Firm does not promise any reduction of tax, penalties or interest.

INFORMATIONAL ONLY. Services under this agreement are advisory and informational in nature and are not a substitute for legal, investment, or other licensed professional advice. Where a matter requires legal, financial-planning, or other licensed expertise, Client should consult an appropriately licensed professional.

النسخة العربية — Arabic Translation

اتفاقية الخدمات الاستشارية والإدارية

تؤكد هذه الاتفاقية شروط التعاقد بين {{clientName}} ("العميل") و{{firmName}} ("الشركة") لتقديم الخدمات الاستشارية و/أو الإدارية الموضحة أدناه، اعتباراً من {{effectiveDate}}.

نطاق الخدمات. تقدّم الشركة للعميل دعماً عاماً في مجال الأعمال أو الإدارة أو المشورة وفق ما يُوصَف أو يُتفق عليه بين الطرفين بشكل منفصل كتابةً (ويُعدّ البريد الإلكتروني كتابةً).

دعم التدقيق والفحص والإشعارات الصادرة عن مصلحة الضرائب (IRS) أو الولاية. إذا كان هذا التعاقد يشمل دعماً في تدقيق أو فحص أو إشعار صادر عن مصلحة الضرائب (IRS) أو جهة في الولاية، فإن الشركة تساعد العميل في جمع السجلات وفهم الإشعار (بوصفه معلومات عامة لا استشارة قانونية)، وإعداد توضيحات وقائعية، وصياغة رد ليراجعه العميل ويوقّعه. ولا تمثّل الشركة العميل أمام مصلحة الضرائب (IRS) أو جهة في الولاية إلا من خلال شخص يجيز له القانون ذلك (أمام IRS: محامٍ أو محاسب قانوني معتمد أو وكيل ضرائب مسجَّل؛ وأمام مكتب المراقب المالي Comptroller في ماريلاند: شخص يسمح له المكتب بموجب قواعده)، تسمّيه الشركة للعميل كتابةً قبل بدء التمثيل، وبعد أن يوقّع العميل نموذج التفويض الخاص بالجهة (نموذج IRS Form 2848 أو 8821، أو نموذج Maryland Comptroller Form 548) فقط. وأي موظف في الشركة غير مخوَّل بذلك يجوز له المساعدة في إعداد المواد وحضور اجتماع بصفته مساعداً للعميل فقط لا ممثلاً له. ولا تمثّل الشركة العميل في مؤتمر استئناف أو جلسة تحصيل أو جلسة إدارية أو أمام محكمة الضرائب (Tax Court) أو أي محكمة أخرى، ولا تتولى تحقيقاً جنائياً أو تحقيقاً في احتيال. ورسوم الشركة عن هذا الدعم منفصلة ولا تتوقف على النتيجة، ولا تعد الشركة بأي تخفيض في الضريبة أو الغرامات أو الفوائد.

للإفادة المعلوماتية فقط. الخدمات بموجب هذه الاتفاقية استشارية ومعلوماتية بطبيعتها، وليست بديلاً عن الاستشارة القانونية أو الاستثمارية أو أي استشارة مهنية مرخّصة أخرى. وحيثما يتطلب الأمر خبرة قانونية أو تخطيطاً مالياً أو خبرة مرخّصة أخرى، فعلى العميل استشارة مهني مرخّص مناسب.`,
  },
];
