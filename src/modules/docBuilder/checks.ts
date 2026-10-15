import type { Answers, Cond } from "./engine";
import { condMet } from "./engine";

/**
 * Machine checks that catch mistakes the questionnaire cannot (percentages that do not add up, an end date before the start date, a late fee
 * above what the law allows). They run on the live preview and again when a document is saved; a failed check blocks saving so a wrong
 * document is not created. Checks are kept apart from the template wording so they can be tuned without touching a document.
 */
export type Check =
  | { type: "sumEquals"; list: string; field: string; total: number; message: string; when?: Cond }
  | { type: "dateAfter"; later: string; earlier: string; message: string; when?: Cond }
  | { type: "atLeastOne"; ids: string[]; message: string; when?: Cond }
  | { type: "lte"; id: string; other: string; multiplier?: number; message: string; when?: Cond }
  | { type: "sumLte"; ids: string[]; other: string; message: string; when?: Cond }
  | { type: "dateNotBefore"; later: string; earlier: string; message: string; when?: Cond }
  | { type: "max"; id: string; value: number; message: string; when?: Cond }
  | { type: "min"; id: string; value: number; message: string; when?: Cond }
  | { type: "mustEqual"; id: string; value: string | boolean; message: string; when?: Cond }
  | { type: "sumFieldsEquals"; ids: string[]; other: string; message: string; when?: Cond };

const num = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(/[$,%\s]/g, ""));
  return String(v ?? "").trim() !== "" && Number.isFinite(n) ? n : null;
};
const iso = (v: unknown): string | null => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? "")); return m ? m[1] : null; };

export function runChecks(checks: Check[], answers: Answers): string[] {
  const out: string[] = [];
  for (const c of checks) {
    if (c.when && !condMet(c.when, answers)) continue;
    if (c.type === "sumEquals") {
      const rows = Array.isArray(answers[c.list]) ? (answers[c.list] as Answers[]) : [];
      const vals = rows.map((r) => num(r[c.field]));
      if (!rows.length || vals.some((v) => v === null)) continue; // missing values are reported as "still to fill in"
      const sum = (vals as number[]).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - c.total) > 0.011) out.push(`${c.message} (they add up to ${Math.round(sum * 100) / 100}, not ${c.total}).`);
    } else if (c.type === "dateAfter") {
      const a = iso(answers[c.later]); const b = iso(answers[c.earlier]);
      if (a && b && a <= b) out.push(c.message);
    } else if (c.type === "dateNotBefore") {
      const a = iso(answers[c.later]); const b = iso(answers[c.earlier]);
      if (a && b && a < b) out.push(c.message);
    } else if (c.type === "max") {
      const a = num(answers[c.id]);
      if (a !== null && a > c.value + 1e-9) out.push(c.message);
    } else if (c.type === "min") {
      const a = num(answers[c.id]);
      if (a !== null && a < c.value - 1e-9) out.push(c.message);
    } else if (c.type === "mustEqual") {
      if (String(answers[c.id] ?? "") !== String(c.value)) out.push(c.message);
    } else if (c.type === "sumFieldsEquals") {
      const b = num(answers[c.other]);
      // the first amount must be filled in; later ones may be left blank (counted as 0)
      const parts = c.ids.map((id, i) => { const v = num(answers[id]); return v === null && i > 0 ? 0 : v; });
      if (b !== null && parts.every((p) => p !== null) && Math.abs((parts as number[]).reduce((x, y) => x + y, 0) - b) > 0.011) out.push(c.message);
    } else if (c.type === "atLeastOne") {
      if (!c.ids.some((id) => Boolean(answers[id]))) out.push(c.message);
    } else if (c.type === "lte") {
      const a = num(answers[c.id]); const b = num(answers[c.other]);
      if (a !== null && b !== null && a > b * (c.multiplier ?? 1) + 0.005) out.push(c.message);
    } else if (c.type === "sumLte") {
      const b = num(answers[c.other]);
      const parts = c.ids.map((id) => num(answers[id]));
      if (b !== null && parts.every((p) => p !== null) && (parts as number[]).reduce((x, y) => x + y, 0) > b + 0.005) out.push(c.message);
    }
  }
  return out;
}

const after = (later: string, earlier: string, message: string, when?: Cond): Check => ({ type: "dateAfter", later, earlier, message, when });
const notBefore = (later: string, earlier: string, message: string, when?: Cond): Check => ({ type: "dateNotBefore", later, earlier, message, when });
const lte = (id: string, other: string, message: string, multiplier = 1, when?: Cond): Check => ({ type: "lte", id, other, multiplier, message, when });
const ENDS = "The end date must be after the start date.";
const GENERAL_SUBJECTS = ["sReal", "sPersonal", "sStocks", "sBanks", "sInsurance", "sClaims", "sBenefits", "sRetirement", "sTaxes", "sBusiness", "sDigital", "sProfessionals", "sFamily", "sTrust", "sEstate", "sCharity", "manageProperty", "manageAccounts"];

/** Checks per document key. Every id here must be a question of that document (a test verifies it). */
export const CHECKS: Record<string, Check[]> = {
  ach_authorization: [{ type: "max", id: "returnFee", value: 35, message: "A fee for a returned debit may not be more than $35." }, after("endDate", "startDate", ENDS, { id: "billing", equals: "monthly" })],
  ein_closure_letter: [{ type: "mustEqual", id: "returnsFiled", value: "yes", message: "The IRS will not close the account until every required return is filed and every tax is paid — finish those first, then send this letter." }],
  client_privacy_notice: [{ type: "atLeastOne", ids: ["noAffiliates"], message: "The privacy notice text assumes no affiliates; change the notice before using it." }],
  fee_agreement: [{ type: "max", id: "lateFeePercent", value: 0.67, message: "Interest above 8% a year (0.67% a month) is not allowed here — Maryland limits interest on a written agreement to 8% (Commercial Law §12-103)." }],
  engagement_letter: [after("endDate", "effectiveDate", "The end date must be after the date of the letter.", { id: "term", equals: "fixed" })],
  authorization_release: [after("expires", "effectiveDate", "The expiry date must be after the date of the authorization.", { id: "duration", equals: "date" })],
  document_request_letter: [after("dueDate", "effectiveDate", "The due date must be after the date of the letter.")],
  demand_letter: [after("deadline", "effectiveDate", "The pay-by date must be after the date of the letter.")],
  payment_agreement: [lte("installment", "total", "An installment cannot be larger than the total owed."), lte("down", "total", "The payment made today cannot be larger than the total owed."), lte("lateFeeAmount", "installment", "A late fee cannot be more than 5% of an installment.", 0.05, { id: "lateFee", equals: true }), { type: "atLeastOne", ids: ["notTimeBarred"], message: "A personal debt older than three years cannot go on a payment plan — confirm it is not time-barred first.", when: { id: "consumerDebt", equals: true } }],
  offer_letter: [{ type: "min", id: "rate", value: 15, message: "Hourly pay cannot be below Maryland's $15.00 minimum wage (some counties require more).", when: { id: "payType", equals: "hourly" } }, after("replyBy", "effectiveDate", "The reply-by date must be after the date of the letter."), notBefore("startDate", "effectiveDate", "The start date should not be before the date of the letter.")],
  contractor_agreement: [after("endDate", "startDate", ENDS, { id: "hasEnd", equals: true })],
  employment_termination_letter: [notBefore("finalPayDate", "lastDay", "The final pay date cannot be before the last day of work.")],
  employment_verification_letter: [after("endDate", "startDate", "The employment end date must be after the start date.", { id: "current", equals: false })],
  employment_contract: [{ type: "min", id: "rate", value: 15, message: "Hourly pay cannot be below Maryland's $15.00 minimum wage (some counties require more).", when: { id: "payType", equals: "hourly" } }, notBefore("startDate", "effectiveDate", "The start date should not be before the date of the agreement.")],
  resignation_letter: [notBefore("lastDay", "effectiveDate", "The last day of work cannot be before the date of the letter.")],
  general_poa: [
    after("endDate", "effectiveDate", "The end date must be after the date of the power of attorney."),
    { type: "atLeastOne", ids: GENERAL_SUBJECTS, message: "Tick at least one subject the agent may handle, or the document gives the agent no authority.", when: { id: "powerType", equals: "general" } },
  ],
  business_poa: [
    after("endDate", "effectiveDate", "The end date must be after the date of the document."),
    { type: "atLeastOne", ids: ["bank", "operations", "staff", "tax", "licenses", "borrow", "property", "ownership", "giveAway"], message: "Turn on at least one power, or the document gives the agent no authority." },
  ],
  limited_poa_filings: [
    after("endDate", "effectiveDate", "The end date must be after the date of the document."),
    { type: "atLeastOne", ids: ["pSales", "pArticles", "pEbt", "pFile", "pOccupancy", "pTobacco", "pHealth", "pLocal", "pAnnual", "pUI", "other"], message: "Tick at least one purpose (or fill in \"Anything else\"), or the firm gets no authority." },
  ],
  child_travel_consent: [notBefore("returning", "departure", "The return date cannot be before the departure date.")],
  promissory_note: [after("dueDate", "effectiveDate", "The final due date must be after the date of the note."), notBefore("dueDate", "firstPayment", "The final due date cannot be before the first payment date.", { id: "schedule", equals: "monthly" })],
  loan_agreement: [after("dueDate", "fundingDate", "The final due date must be after the funding date."), after("firstPayment", "fundingDate", "The first payment must be after the funding date.", { id: "schedule", equals: "monthly" }), notBefore("dueDate", "firstPayment", "The final due date cannot be before the first payment date.", { id: "schedule", equals: "monthly" })],
  shareholder_loan_agreement: [after("repayBy", "effectiveDate", "The repayment date must be after the date of the agreement.", { id: "schedule", equals: "date" }), after("firstPayment", "effectiveDate", "The first payment must be after the date of the agreement.", { id: "schedule", equals: "monthly" })],
  service_agreement: [after("endDate", "startDate", ENDS, { id: "hasEnd", equals: true }), { type: "max", id: "lateRate", value: 0.66, message: "Late interest above 0.66% a month (8% a year) is not allowed here — Commercial Law §12-103(a)." }],
  consulting_agreement: [after("endDate", "startDate", ENDS, { id: "hasEnd", equals: true }), { type: "max", id: "lateRate", value: 0.66, message: "Late interest above 0.66% a month (8% a year) is not allowed here — Commercial Law §12-103(a)." }],
  lease_residential: [notBefore("masterLeaseEnd", "endDate", "The lease cannot end after the master lease ends."), { type: "min", id: "entryHours", value: 24, message: "A landlord must give at least 24 hours' written notice before entering a home (Real Property Article §8-221)." }, { type: "max", id: "nsfFee", value: 35, message: "A returned-payment fee may not be more than $35 (Commercial Law §15-802)." }, 
    lte("deposit", "rent", "A security deposit for a home may not be more than one month's rent (Real Property Article §8-203)."),
    lte("lateFeeAmount", "rent", "A late fee for a home may not be more than 5% of the monthly rent (Real Property Article §8-208).", 0.05, { id: "lateFee", equals: true }),
    after("endDate", "startDate", ENDS, { id: "termType", equals: "fixed" }),
  ],
  lease_commercial: [{ type: "max", id: "nsfFee", value: 35, message: "A returned-payment fee may not be more than $35 (Commercial Law §15-802)." }, after("endDate", "startDate", ENDS)],
  commercial_lease_short: [{ type: "max", id: "nsfFee", value: 35, message: "A returned-payment fee may not be more than $35 (Commercial Law §15-802)." }, after("endDate", "startDate", ENDS)],
  commercial_sublease: [{ type: "mustEqual", id: "residential", value: false, message: "This form is for business space only. A home needs the Residential Lease form with the sublease switch on (Maryland landlord-tenant rules, the lead-paint law and Baltimore City rental licensing apply to homes)." }, notBefore("masterLeaseEnd", "endDate", "The sublease cannot end after the master lease ends."), { type: "max", id: "nsfFee", value: 35, message: "A returned-payment fee may not be more than $35 (Commercial Law §15-802)." }, after("endDate", "startDate", ENDS)],
  lease_termination_agreement: [notBefore("endDate", "leaseDate", "The lease cannot end before the date of the original lease.")],
  lease_amendment: [{ type: "atLeastOne", ids: ["extend", "rentChange", "depositChange", "useChange", "other"], message: "Fill in at least one change — an amendment with no change does nothing." }, after("newEnd", "leaseDate", "The new end date must be after the date of the original lease.", { id: "extend", equals: true }), notBefore("rentFrom", "leaseDate", "The new rent cannot start before the date of the original lease.", { id: "rentChange", equals: true })],
  llc_operating_agreement: [{ type: "sumEquals", list: "members", field: "percent", total: 100, message: "The members' ownership percentages must total 100" }],
  partnership_agreement: [{ type: "sumEquals", list: "partners", field: "share", total: 100, message: "The partners' profit and loss shares must total 100" }],
  profit_sharing_agreement: [{ type: "sumEquals", list: "owners", field: "percent", total: 100, message: "The owners' profit shares must total 100" }],
  annual_meeting_minutes: [lte("sharesRepresented", "sharesOutstanding", "Shares represented cannot be more than the shares entitled to vote.")],
  ownership_transfer: [lte("percent", "before", "The percentage transferred cannot be more than the Transferor owned before the transfer.")],
  business_sale_agreement: [
    notBefore("closingDate", "effectiveDate", "The closing date cannot be before the date of the agreement."),
    { type: "sumLte", ids: ["deposit", "financedAmount"], other: "price", message: "The deposit plus the amount paid later cannot be more than the price.", when: { id: "payment", equals: "financed" } },
    notBefore("transitionEnd", "closingDate", "The service-account transition cannot end before the closing date.", { id: "transition", equals: true }),
    lte("deposit", "price", "The deposit cannot be more than the price."),
    lte("taxHoldback", "price", "The tax holdback cannot be more than the price."),
    lte("financedAmount", "price", "The amount paid later cannot be more than the price.", 1, { id: "payment", equals: "financed" }),
    { type: "sumFieldsEquals", ids: ["allocEquipment", "allocInventory", "allocGoodwill", "allocNonCompete"], other: "price", message: "The equipment, inventory and goodwill amounts must add up to the total price.", when: { id: "allocate", equals: true } },
  ],
  termination_agreement: [notBefore("effectiveDate", "contractDate", "This termination cannot be dated before the contract it ends."), after("endDate", "contractDate", "The end date must be after the contract date.", { id: "endsOn", equals: "date" })],
  property_sale_residential: [lte("deposit", "price", "The deposit cannot be more than the price."), lte("loanAmount", "price", "The loan cannot be more than the price."), notBefore("closingDate", "effectiveDate", "Closing cannot be before the date of the agreement.")],
  property_sale_commercial: [lte("deposit", "price", "The deposit cannot be more than the price."), lte("loanAmount", "price", "The loan cannot be more than the price."), notBefore("closingDate", "effectiveDate", "Closing cannot be before the date of the agreement.")],
  termination_of_purchase: [notBefore("effectiveDate", "agreementDate", "This cancellation cannot be dated before the agreement it cancels."), notBefore("refundBy", "effectiveDate", "The refund date cannot be before the date of this document.", { id: "money", equals: "refund" }), lte("refundAmount", "paidAmount", "The refund cannot be more than the amount the Buyer paid.", 1, { id: "money", equals: "refund" }), lte("keepAmount", "paidAmount", "The amount the Seller keeps cannot be more than the amount the Buyer paid.", 1, { id: "money", equals: "keep" })],
  sales_agreement: [lte("deposit", "price", "The deposit cannot be more than the price.", 1, { id: "payment", equals: "deposit" }), notBefore("deliveryDate", "effectiveDate", "Delivery cannot be before the date of the agreement.")],
  letter_of_intent: [lte("deposit", "price", "The deposit cannot be more than the price."), notBefore("closingDate", "effectiveDate", "The target closing date cannot be before the date of the letter."), after("expiresOn", "effectiveDate", "The expiry date must be after the date of the letter.")],
};

export function problemsFor(templateKey: string, answers: Answers): string[] {
  return runChecks(CHECKS[templateKey] || [], answers);
}
