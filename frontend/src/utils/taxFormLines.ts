/**
 * Maps the P&L's expense accounts onto the actual numbered deduction lines of
 * whichever tax form the client will file (Schedule C, 1120, 1120-S, 1065),
 * so the on-screen P&L can be viewed in the same line format as the return
 * instead of only the generic Income/COGS/Expenses grouping.
 *
 * This is a preview aid, not a computed return — account-to-line mapping is
 * necessarily a simplification (real returns attach supporting statements for
 * "Other deductions"/"Other expenses" that this can't reconstruct), and Form
 * 1120's bottom line in particular stops short of the NOL/special-deduction
 * adjustments that produce actual taxable income (see its `disclaimer`).
 */

export type DeductionCategory =
  | "advertising" | "car_truck" | "commissions_fees" | "contract_labor" | "depletion"
  | "depreciation" | "employee_benefits" | "insurance" | "interest" | "legal_professional"
  | "office_expense" | "pension_profit_sharing" | "rents" | "repairs_maintenance" | "supplies"
  | "taxes_licenses" | "travel" | "meals" | "utilities" | "wages_salaries" | "compensation_officers"
  | "bad_debts" | "guaranteed_payments" | "charitable_contributions" | "other";

/**
 * This firm's chart of accounts (v3_coa) is a single fixed, shared list
 * across every client — see GET /accounting/coa — so an exact name-keyed
 * map is far more reliable here than fuzzy keyword guessing. Anything not
 * listed (a custom/future account) falls through to FALLBACK_KEYWORDS, then
 * to "other" if nothing matches, same as how these forms themselves handle
 * an expense with no dedicated line: bucket it into the catch-all.
 */
const ACCOUNT_CATEGORY: Record<string, DeductionCategory> = {
  "Accounting": "legal_professional",
  "Advertising and Marketing": "advertising",
  "Alarm System-Security": "other",
  "Auto Expense": "car_truck",
  "Automobile and Truck Expense": "car_truck",
  "Bad debts": "bad_debts",
  "Bank Fees": "other",
  "Compensation of officers": "compensation_officers",
  "Contract Labor": "contract_labor",
  "Depreciation Expense": "depreciation",
  "Dues and Subscriptions": "other",
  "Employee Expense Reimbursements": "other",
  "IT & Internet Services": "office_expense",
  "Independent Contractor": "contract_labor",
  "Insurance Expense": "insurance",
  "Interest Expense": "interest",
  "Janitorial": "other",
  "Laundry and Cleaning": "other",
  "Licenses and Permits": "taxes_licenses",
  "Meals": "meals",
  "Merchant Processing Fees": "other",
  "Office Expense": "office_expense",
  "Payroll Expense": "wages_salaries",
  "Payroll Tax Expense": "taxes_licenses",
  "Payroll Tax Expense - Federal (941)": "taxes_licenses",
  "Payroll Tax Expense - State Unemployment": "taxes_licenses",
  "Postage and Delivery": "office_expense",
  "Professional Fees": "legal_professional",
  "Rent Expense": "rents",
  "Repairs and Maintenance": "repairs_maintenance",
  "Salaries and wages": "wages_salaries",
  "Sales Tax included in the gross income": "taxes_licenses",
  "Security Guard": "other",
  "Software & Subscriptions": "office_expense",
  "State Taxes - Maryland": "taxes_licenses",
  "State Taxes - Virginia": "taxes_licenses",
  "Supplies": "supplies",
  "Taxes and Licenses": "taxes_licenses",
  "Telephone and Internet": "utilities",
  "Travel": "travel",
  "Uncategorized Expense": "other",
  "Utilities": "utilities",
  "Utilities - Electric": "utilities",
  "Utilities - Internet & Cable": "utilities",
  "Waste Removal": "other",
  "Water": "utilities",
};

const FALLBACK_KEYWORDS: [RegExp, DeductionCategory][] = [
  [/compensation.*officer/i, "compensation_officers"],
  [/guaranteed payment/i, "guaranteed_payments"],
  [/contract(or)? labor|independent contractor/i, "contract_labor"],
  [/wage|salary|salaries|payroll(?! tax)/i, "wages_salaries"],
  [/bad debt/i, "bad_debts"],
  [/repair|maintenance/i, "repairs_maintenance"],
  [/\brent\b/i, "rents"],
  [/depreciation|amortization/i, "depreciation"],
  [/depletion/i, "depletion"],
  [/pension|profit.sharing|retirement|401/i, "pension_profit_sharing"],
  [/employee benefit/i, "employee_benefits"],
  [/insurance/i, "insurance"],
  [/legal|professional|accounting|accountant/i, "legal_professional"],
  [/office/i, "office_expense"],
  [/auto|vehicle|car and truck|truck expense/i, "car_truck"],
  [/commission/i, "commissions_fees"],
  [/supplies/i, "supplies"],
  [/travel/i, "travel"],
  [/\bmeals?\b/i, "meals"],
  [/utilit|electric|water|telephone|internet|cable/i, "utilities"],
  [/charit|donation/i, "charitable_contributions"],
  [/advertis|marketing/i, "advertising"],
  [/tax|license|permit/i, "taxes_licenses"],
  [/interest/i, "interest"],
];

export function classifyDeduction(accountName: string): DeductionCategory {
  const exact = ACCOUNT_CATEGORY[accountName];
  if (exact) return exact;
  for (const [re, cat] of FALLBACK_KEYWORDS) if (re.test(accountName)) return cat;
  return "other";
}

export interface TaxLine {
  lineNo: string;
  label: string;
  categories: DeductionCategory[];
}

export interface TaxFormDef {
  key: string;
  label: string;
  incomeLine: string;
  cogsLine: string;
  grossProfitLine: string;
  deductionLines: TaxLine[];
  totalDeductionsLine: string;
  netIncomeLine: string;
  disclaimer?: string;
}

export const TAX_FORMS: Record<string, TaxFormDef> = {
  ScheduleC: {
    key: "ScheduleC",
    label: "Schedule C (Form 1040)",
    incomeLine: "Line 1 — Gross receipts or sales",
    cogsLine: "Line 4 — Cost of goods sold",
    grossProfitLine: "Line 5 — Gross profit",
    deductionLines: [
      { lineNo: "8", label: "Advertising", categories: ["advertising"] },
      { lineNo: "9", label: "Car and truck expenses", categories: ["car_truck"] },
      { lineNo: "10", label: "Commissions and fees", categories: ["commissions_fees"] },
      { lineNo: "11", label: "Contract labor", categories: ["contract_labor"] },
      { lineNo: "12", label: "Depletion", categories: ["depletion"] },
      { lineNo: "13", label: "Depreciation and section 179 expense", categories: ["depreciation"] },
      { lineNo: "14", label: "Employee benefit programs", categories: ["employee_benefits"] },
      { lineNo: "15", label: "Insurance (other than health)", categories: ["insurance"] },
      { lineNo: "16", label: "Interest", categories: ["interest"] },
      { lineNo: "17", label: "Legal and professional services", categories: ["legal_professional"] },
      { lineNo: "18", label: "Office expense", categories: ["office_expense"] },
      { lineNo: "19", label: "Pension and profit-sharing plans", categories: ["pension_profit_sharing"] },
      { lineNo: "20", label: "Rent or lease", categories: ["rents"] },
      { lineNo: "21", label: "Repairs and maintenance", categories: ["repairs_maintenance"] },
      { lineNo: "22", label: "Supplies", categories: ["supplies"] },
      { lineNo: "23", label: "Taxes and licenses", categories: ["taxes_licenses"] },
      { lineNo: "24a", label: "Travel", categories: ["travel"] },
      { lineNo: "24b", label: "Deductible meals", categories: ["meals"] },
      { lineNo: "25", label: "Utilities", categories: ["utilities"] },
      { lineNo: "26", label: "Wages", categories: ["wages_salaries"] },
      { lineNo: "27a", label: "Other expenses", categories: ["other", "bad_debts", "compensation_officers", "guaranteed_payments", "charitable_contributions"] },
    ],
    totalDeductionsLine: "Line 28 — Total expenses",
    netIncomeLine: "Line 31 — Net profit or (loss)",
  },
  "1120": {
    key: "1120",
    label: "Form 1120 (C-Corp)",
    incomeLine: "Line 1c — Gross receipts less returns/allowances",
    cogsLine: "Line 2 — Cost of goods sold",
    grossProfitLine: "Line 3 — Gross profit",
    deductionLines: [
      { lineNo: "12", label: "Compensation of officers", categories: ["compensation_officers"] },
      { lineNo: "13", label: "Salaries and wages", categories: ["wages_salaries", "contract_labor"] },
      { lineNo: "14", label: "Repairs and maintenance", categories: ["repairs_maintenance"] },
      { lineNo: "15", label: "Bad debts", categories: ["bad_debts"] },
      { lineNo: "16", label: "Rents", categories: ["rents"] },
      { lineNo: "17", label: "Taxes and licenses", categories: ["taxes_licenses"] },
      { lineNo: "18", label: "Interest expense", categories: ["interest"] },
      { lineNo: "19", label: "Charitable contributions", categories: ["charitable_contributions"] },
      { lineNo: "20", label: "Depreciation", categories: ["depreciation"] },
      { lineNo: "21", label: "Depletion", categories: ["depletion"] },
      { lineNo: "22", label: "Advertising", categories: ["advertising"] },
      { lineNo: "23", label: "Pension, profit-sharing plans", categories: ["pension_profit_sharing"] },
      { lineNo: "24", label: "Employee benefit programs", categories: ["employee_benefits"] },
      { lineNo: "26", label: "Other deductions", categories: ["other", "insurance", "legal_professional", "office_expense", "car_truck", "commissions_fees", "supplies", "travel", "meals", "utilities", "guaranteed_payments"] },
    ],
    totalDeductionsLine: "Line 27 — Total deductions",
    netIncomeLine: "Line 28 — Taxable income before NOL deduction and special deductions",
    disclaimer: "Line 28 reflects book income only — it does not include the NOL deduction (Line 29a) or special deductions (Line 29b) that determine the actual Line 30 taxable income.",
  },
  "1120-S": {
    key: "1120-S",
    label: "Form 1120-S (S-Corp)",
    incomeLine: "Line 1c — Gross receipts less returns/allowances",
    cogsLine: "Line 2 — Cost of goods sold",
    grossProfitLine: "Line 3 — Gross profit",
    deductionLines: [
      { lineNo: "7", label: "Compensation of officers", categories: ["compensation_officers"] },
      { lineNo: "8", label: "Salaries and wages", categories: ["wages_salaries", "contract_labor"] },
      { lineNo: "9", label: "Repairs and maintenance", categories: ["repairs_maintenance"] },
      { lineNo: "10", label: "Bad debts", categories: ["bad_debts"] },
      { lineNo: "11", label: "Rents", categories: ["rents"] },
      { lineNo: "12", label: "Taxes and licenses", categories: ["taxes_licenses"] },
      { lineNo: "13", label: "Interest", categories: ["interest"] },
      { lineNo: "14", label: "Depreciation", categories: ["depreciation"] },
      { lineNo: "15", label: "Depletion", categories: ["depletion"] },
      { lineNo: "16", label: "Advertising", categories: ["advertising"] },
      { lineNo: "17", label: "Pension, profit-sharing, etc. plans", categories: ["pension_profit_sharing"] },
      { lineNo: "18", label: "Employee benefit programs", categories: ["employee_benefits"] },
      { lineNo: "19", label: "Other deductions", categories: ["other", "insurance", "legal_professional", "office_expense", "car_truck", "commissions_fees", "supplies", "travel", "meals", "utilities", "charitable_contributions", "guaranteed_payments"] },
    ],
    totalDeductionsLine: "Line 20 — Total deductions",
    netIncomeLine: "Line 21 — Ordinary business income (loss)",
  },
  "1065": {
    key: "1065",
    label: "Form 1065 (Partnership)",
    incomeLine: "Line 1c — Gross receipts less returns/allowances",
    cogsLine: "Line 2 — Cost of goods sold",
    grossProfitLine: "Line 3 — Gross profit",
    deductionLines: [
      { lineNo: "9", label: "Salaries and wages (other than to partners)", categories: ["wages_salaries", "contract_labor"] },
      { lineNo: "10", label: "Guaranteed payments to partners", categories: ["guaranteed_payments"] },
      { lineNo: "11", label: "Repairs and maintenance", categories: ["repairs_maintenance"] },
      { lineNo: "12", label: "Bad debts", categories: ["bad_debts"] },
      { lineNo: "13", label: "Rent", categories: ["rents"] },
      { lineNo: "14", label: "Taxes and licenses", categories: ["taxes_licenses"] },
      { lineNo: "15", label: "Interest expense", categories: ["interest"] },
      { lineNo: "16", label: "Depreciation", categories: ["depreciation"] },
      { lineNo: "17", label: "Depletion", categories: ["depletion"] },
      { lineNo: "18", label: "Retirement plans, etc.", categories: ["pension_profit_sharing"] },
      { lineNo: "19", label: "Employee benefit programs", categories: ["employee_benefits"] },
      { lineNo: "20", label: "Other deductions", categories: ["other", "insurance", "legal_professional", "office_expense", "car_truck", "commissions_fees", "supplies", "travel", "meals", "utilities", "charitable_contributions", "advertising", "compensation_officers"] },
    ],
    totalDeductionsLine: "Line 21 — Total deductions",
    netIncomeLine: "Line 22 — Ordinary business income (loss)",
  },
};

export function defaultTaxFormFor(entityType: string | null | undefined): string {
  switch (entityType) {
    case "S-Corp": return "1120-S";
    case "C-Corp": return "1120";
    case "Partnership": return "1065";
    case "Sole Proprietorship":
    case "Individual":
      return "ScheduleC";
    default:
      // LLC (ambiguous — could file any of the four ways), Nonprofit (none of
      // these forms apply), and anything blank/unrecognized all land here;
      // the "View as" picker lets the preparer choose explicitly.
      return "Standard";
  }
}
