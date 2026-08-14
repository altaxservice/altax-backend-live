import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, viewFile, downloadFile, printFile, fetchAuthedBlob, buildFilename } from "../api/client";
import type { Client } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useConfirm, useNotify } from "../components/ConfirmProvider";
import { useSelectedClient } from "../context/SelectedClientContext";
import { CLIENT_MESSAGE_HANDOFF_KEY } from "./CommunicationsPage";
import { ErrorBanner } from "../components/ErrorBanner";
import { SummaryTable, type SummaryTableSection } from "../components/SummaryTable";
import type { MdFilingResult } from "../api/calculators";

const TABS = ["Financial Overview", "AR Aging", "P&L", "Balance Sheet", "Trial Balance", "Sales & Tax", "Payroll", "Employee", "Client Message", "Sales, Tax & Payroll Report"] as const;
type Tab = (typeof TABS)[number];

/** Sentinel clientId value meaning "no single client — aggregate across the whole
 * firm." Only meaningful on the Financial Overview tab; every other tab needs a
 * real client and falls back to the "pick a client" empty state if this leaks in
 * (see the tab-change effect below, which clears it when leaving that tab). */
const FIRM_WIDE = "__FIRM_WIDE__";

/** Groups the flat 10-tab strip into labeled clusters — a flat row this long wrapped
 * unpredictably and gave no visual signal it was still one control. */
const TAB_GROUPS: { label: string; tabs: Tab[] }[] = [
  { label: "Financials", tabs: ["Financial Overview", "P&L", "Balance Sheet", "Trial Balance", "AR Aging"] },
  { label: "Compliance & Payroll", tabs: ["Sales & Tax", "Payroll", "Employee"] },
  { label: "Client-Facing", tabs: ["Client Message", "Sales, Tax & Payroll Report"] },
];

/** Maps each client-scoped tab to its backend PDF path segment (reports.routes.ts /reports/pdf/:segment/:clientId) — null where no PDF exists. Financial Overview is per-client like the rest despite its name (renamed from "Firm Overview" for exactly that reason — it always required picking a client); AR Aging is the one genuinely firm-wide tab here. Both have their own PDF/CSV buttons instead of using this map. */
const REPORT_PDF_SEGMENT: Record<Tab, string | null> = {
  // Trial Balance is an on-screen integrity check, not a client deliverable — no PDF.
  "Financial Overview": null, "AR Aging": null, "P&L": "pl", "Balance Sheet": "balance-sheet", "Trial Balance": null,
  "Sales & Tax": "sales-tax", "Payroll": "payroll", "Employee": "employee", "Client Message": "client-message",
  "Sales, Tax & Payroll Report": "sales-tax-payroll",
};
/** Same idea for CSV exports — only the ledger-backed tabs have raw rows worth exporting. */
const REPORT_CSV_SEGMENT: Partial<Record<Tab, string>> = { "P&L": "gl", "Balance Sheet": "gl", "Trial Balance": "trial-balance", "Sales & Tax": "sales-tax", "Payroll": "payroll", "Employee": "employee" };

/**
 * Bilingual report names for the "Email Report"/"Text Report" quick-send buttons —
 * generic "here's your X" subject/body, not the full templated content the Client
 * Message tab already sends (that tab keeps its own "Open Communications to Send"
 * flow instead of these buttons, since it already builds real bilingual content).
 */
const REPORT_TITLES: Partial<Record<Tab, { en: string; ar: string }>> = {
  "Financial Overview": { en: "Financial Overview", ar: "نظرة عامة مالية" },
  "P&L": { en: "Profit & Loss Statement", ar: "قائمة الأرباح والخسائر" },
  "Balance Sheet": { en: "Balance Sheet", ar: "الميزانية العمومية" },
  "Sales & Tax": { en: "Sales Tax Report", ar: "تقرير ضريبة المبيعات" },
  "Payroll": { en: "Payroll Report", ar: "تقرير الرواتب" },
  "Employee": { en: "Employee Report", ar: "تقرير الموظفين" },
  "Sales, Tax & Payroll Report": { en: "Sales, Tax & Payroll Report", ar: "تقرير المبيعات والضرائب والرواتب" },
};

/** Blob (a fetched PDF) -> base64, the shape /communications' attachment field expects. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

interface SalesTaxReport {
  byCategory: { categoryName: string; state: string | null; rate: number; taxableAmount: number; taxAmount: number }[];
  sales: { saleId: string; saleDate: string | null; grossSales: number; totalTaxDue: number; adjustments: number; nonTaxableSales: number; taxableSales: number }[];
  totals: { grossSales: number; taxDue: number; adjustments: number; saleCount: number };
  mdFiling: {
    periods: (MdFilingResult & { start: string; end: string; dueDate: string })[];
    totals: { taxDue: number; discount: number; penalty: number; interest: number; balanceDue: number };
    frequencyUsed: string | null;
    filedDate: string;
    paidDate: string;
  } | null;
}

interface ReportPaycheck {
  paycheck_id: string; pay_date: string | null; employee: string; gross_wages: number | string;
  employee_taxes: number | string; employer_taxes: number | string; net_pay: number | string; total_cost: number | string;
  federal_withholding: number | string; social_security_ee: number | string; social_security_er: number | string;
  medicare_ee: number | string; medicare_er: number | string; state_tax: number | string; suta: number | string; futa: number | string;
}

interface FirmSummary {
  months: { month: string; revenue: number; expenses: number; profit: number }[];
  totals: { revenue: number; expenses: number; profit: number };
  unpaidBalance: number;
  unpaidInvoiceCount: number;
  activeClientCount: number | null;
}

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00";
}

const INCOME_TYPES = ["Sales Revenue", "Income", "Revenue"];
const COGS_TYPES = ["COGS", "Cost of Goods Sold"];
const EXPENSE_HINTS = ["expense", "payroll tax", "office"];
// "bank" removed — the only account anywhere containing that substring is "Bank Fees"
// (an Expense account), which it was misclassifying as an asset. Must stay in sync
// with reports.routes.ts (guarded by src/tests/accountBucketing.test.ts).
const ASSET_HINTS = ["cash", "asset", "receivable"];
const LIABILITY_HINTS = ["payable", "liability", "tax payable"];
// Equity accounts (Owner Equity, Owner Draw, Retained Earnings, Opening Balance Equity,
// Owner Contributions, ...) have no bucket of their own without this — they fell into
// "other", which the P&L expense filter below treats as an expense fallback.
const EQUITY_HINTS = ["equity", "retained earnings", "owner draw", "owner contribution"];

type Bucket = "income" | "cogs" | "expense" | "asset" | "liability" | "equity" | "other";
const COA_TYPE_TO_BUCKET: Record<string, Bucket> = {
  Income: "income", Revenue: "income", COGS: "cogs", Expense: "expense",
  Asset: "asset", Liability: "liability", Equity: "equity",
};

export function ReportsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const notify = useNotify();
  const { clientId: globalClientId, setSelectedClient } = useSelectedClient();
  const [tab, setTab] = useState<Tab>("Financial Overview");
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState(globalClientId || "");
  const [from, setFrom] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [firmSummary, setFirmSummary] = useState<FirmSummary | null>(null);
  const [firmError, setFirmError] = useState<string | null>(null);
  const [paychecks, setPaychecks] = useState<ReportPaycheck[]>([]);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [employeeFilter, setEmployeeFilter] = useState(""); // "" = All Employees
  const [salesTaxReport, setSalesTaxReport] = useState<SalesTaxReport | null>(null);
  const [salesTaxLoading, setSalesTaxLoading] = useState(false);
  const [salesTaxError, setSalesTaxError] = useState<string | null>(null);
  // MD Form 202 discount/penalty/interest is computed "as of" a filing/payment
  // date — the return due date itself is fixed by the report's own period
  // (server-derived, not editable here), but when it was actually paid isn't
  // known ahead of time, so this defaults to today and staff can back-date it
  // to match the real filing.
  const [mdFiledDate, setMdFiledDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [mdPaidDate, setMdPaidDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [periodMessage, setPeriodMessage] = useState<{ subject: string; body: string; bodyArabic: string } | null>(null);
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reportBusy, setReportBusy] = useState<string | null>(null);
  const [reportCc, setReportCc] = useState("");
  const [summaryTable, setSummaryTable] = useState<SummaryTableSection[] | null>(null);
  const [summaryTableLoading, setSummaryTableLoading] = useState(false);
  const [summaryTableError, setSummaryTableError] = useState<string | null>(null);
  const [coaTypeByName, setCoaTypeByName] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => {});
  }, []);

  // The Chart of Accounts' own account_type is the authoritative source for
  // bucketFor() below — see backend reports.routes.ts's ensureCoaTypeCache for why
  // keyword-guessing on the account name alone (the old approach) isn't reliable.
  useEffect(() => {
    api.get<{ accounts: { account_name: string; account_type: string }[] }>("/accounting/coa")
      .then((r) => setCoaTypeByName(new Map(r.accounts.map((a) => [String(a.account_name || "").toLowerCase(), a.account_type]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (user?.role !== "admin" || tab !== "Financial Overview" || !clientId) return;
    setFirmSummary(null);
    setFirmError(null);
    const clientQuery = clientId === FIRM_WIDE ? "" : `&clientId=${encodeURIComponent(clientId)}`;
    api.get<FirmSummary>(`/reports/firm-summary?from=${from}&to=${to}${clientQuery}`)
      .then(setFirmSummary)
      .catch(() => setFirmError(clientId === FIRM_WIDE ? "Could not load the firm-wide overview." : "Could not load this client's overview."));
  }, [user, tab, clientId, from, to]);

  // FIRM_WIDE only makes sense on the Financial Overview tab. If the user picked
  // "All Clients" there and then switches to a client-scoped tab (P&L, Payroll,
  // etc.), fall back to whatever the app's globally-remembered client is (or
  // empty) rather than leaving an invalid sentinel selected.
  useEffect(() => {
    if (tab !== "Financial Overview" && clientId === FIRM_WIDE) {
      setClientId(globalClientId || "");
    }
  }, [tab, clientId, globalClientId]);

  useEffect(() => {
    if (!clientId || (tab !== "Payroll" && tab !== "Employee")) return;
    setPayrollLoading(true);
    api.get<{ paychecks: ReportPaycheck[] }>(`/accounting/paychecks/${clientId}`)
      .then((r) => setPaychecks(r.paychecks))
      .catch(() => setPaychecks([]))
      .finally(() => setPayrollLoading(false));
  }, [clientId, tab]);

  // Reset the employee drill-in whenever the client changes, so a stale employee name
  // from a different client's payroll doesn't silently carry over into this one.
  useEffect(() => { setEmployeeFilter(""); }, [clientId]);

  useEffect(() => {
    if (!clientId || tab !== "Sales & Tax") return;
    setSalesTaxLoading(true);
    setSalesTaxError(null);
    api.get<SalesTaxReport>(`/reports/sales-tax/${clientId}?from=${from}&to=${to}&mdFiledDate=${mdFiledDate}&mdPaidDate=${mdPaidDate}`)
      .then(setSalesTaxReport)
      .catch((err) => { setSalesTaxReport(null); setSalesTaxError(err instanceof ApiError ? err.message : "Could not load the sales & tax report."); })
      .finally(() => setSalesTaxLoading(false));
  }, [clientId, tab, from, to, mdFiledDate, mdPaidDate]);

  useEffect(() => {
    if (!clientId || tab !== "Client Message") return;
    setMessageLoading(true);
    setMessageError(null);
    setSaveStatus(null);
    api.get<{ template: { subject: string; message_english: string | null; message_arabic: string | null } }>(
      `/templates/${encodeURIComponent("Client Tax and Payroll Update")}?clientId=${encodeURIComponent(clientId)}&periodStart=${from}&periodEnd=${to}`
    )
      .then((r) => setPeriodMessage({ subject: r.template.subject, body: r.template.message_english || "", bodyArabic: r.template.message_arabic || "" }))
      .catch((err) => setMessageError(err instanceof ApiError ? err.message : "Could not generate this period's message."))
      .finally(() => setMessageLoading(false));
  }, [clientId, tab, from, to]);

  // Real bilingual structured table — same underlying figures as periodMessage above,
  // shared by the Client Message tab's on-screen table and the standalone Sales, Tax
  // & Payroll report tab.
  useEffect(() => {
    if (!clientId || (tab !== "Client Message" && tab !== "Sales, Tax & Payroll Report")) return;
    setSummaryTableLoading(true);
    setSummaryTableError(null);
    api.get<{ sections: SummaryTableSection[] }>(
      `/templates/period-summary-table/${encodeURIComponent(clientId)}?periodStart=${from}&periodEnd=${to}&mdFiledDate=${mdFiledDate}&mdPaidDate=${mdPaidDate}`
    )
      .then((r) => setSummaryTable(r.sections))
      .catch((err) => setSummaryTableError(err instanceof ApiError ? err.message : "Could not load this period's figures."))
      .finally(() => setSummaryTableLoading(false));
  }, [clientId, tab, from, to, mdFiledDate, mdPaidDate]);

  useEffect(() => {
    // FIRM_WIDE isn't a real client — every tab that actually reads `entries`/
    // `filtered` (P&L, Balance Sheet, etc.) requires a real client anyway, so
    // there's nothing here for Financial Overview's firm-wide mode to use.
    if (!clientId || clientId === FIRM_WIDE) return;
    setLoading(true);
    api.get<{ glEntries: any[] }>(`/accounting/gl/${clientId}`)
      .then((r) => setEntries(r.glEntries))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [clientId]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (!e.entry_date) return false;
      const d = String(e.entry_date).slice(0, 10);
      return d >= from && d <= to;
    });
  }, [entries, from, to]);

  const client = clients.find((c) => c.client_id === clientId);

  function bucketFor(account: string): Bucket {
    const a = String(account || "").toLowerCase();
    const coaType = coaTypeByName.get(a);
    const coaBucket = coaType ? COA_TYPE_TO_BUCKET[coaType] : undefined;
    if (coaBucket) return coaBucket;
    if (INCOME_TYPES.some((t) => a.includes(t.toLowerCase()))) return "income";
    if (COGS_TYPES.some((t) => a.includes(t.toLowerCase()))) return "cogs";
    if (LIABILITY_HINTS.some((t) => a.includes(t))) return "liability";
    if (ASSET_HINTS.some((t) => a.includes(t))) return "asset";
    if (EQUITY_HINTS.some((t) => a.includes(t))) return "equity";
    if (EXPENSE_HINTS.some((t) => a.includes(t))) return "expense";
    return "other";
  }

  const byAccount = useMemo(() => {
    const map = new Map<string, { debit: number; credit: number }>();
    for (const e of filtered) {
      const key = e.account || "Unclassified";
      const row = map.get(key) || { debit: 0, credit: 0 };
      row.debit += Number(e.debit) || 0;
      row.credit += Number(e.credit) || 0;
      map.set(key, row);
    }
    return map;
  }, [filtered]);

  // Assets/Liabilities are point-in-time balances (Balance Sheet "as of" `to`), not
  // period activity — unlike Income/COGS/Expense they must never be bounded by `from`,
  // or picking a short/recent window makes every account look like it has no history.
  // `entries` already holds the client's full unfiltered GL, so this only needs `to`.
  const cumulativeByAccount = useMemo(() => {
    const map = new Map<string, { debit: number; credit: number }>();
    for (const e of entries) {
      if (!e.entry_date || String(e.entry_date).slice(0, 10) > to) continue;
      const key = e.account || "Unclassified";
      const row = map.get(key) || { debit: 0, credit: 0 };
      row.debit += Number(e.debit) || 0;
      row.credit += Number(e.credit) || 0;
      map.set(key, row);
    }
    return map;
  }, [entries, to]);

  const income = Array.from(byAccount.entries()).filter(([acct]) => bucketFor(acct) === "income");
  const cogs = Array.from(byAccount.entries()).filter(([acct]) => bucketFor(acct) === "cogs");
  const expenses = Array.from(byAccount.entries()).filter(([acct]) => bucketFor(acct) === "expense" || bucketFor(acct) === "other");

  const totalIncome = income.reduce((s, [, v]) => s + (v.credit - v.debit), 0);
  const totalCogs = cogs.reduce((s, [, v]) => s + (v.debit - v.credit), 0);
  const totalExpenses = expenses.reduce((s, [, v]) => s + (v.debit - v.credit), 0);
  const grossProfit = totalIncome - totalCogs;
  const netIncome = grossProfit - totalExpenses;

  const salesTax = byAccount.get("Sales Tax Payable")?.credit || 0;
  const payrollGross = (byAccount.get("Payroll Expense")?.debit || 0);

  const assets = Array.from(cumulativeByAccount.entries()).filter(([acct]) => bucketFor(acct) === "asset");
  const liabilities = Array.from(cumulativeByAccount.entries()).filter(([acct]) => bucketFor(acct) === "liability");
  const totalAssets = assets.reduce((s, [, v]) => s + (v.debit - v.credit), 0);
  const totalLiabilities = liabilities.reduce((s, [, v]) => s + (v.credit - v.debit), 0);

  const filteredPaychecks = useMemo(() => {
    return paychecks.filter((p) => {
      if (!p.pay_date) return false;
      const d = String(p.pay_date).slice(0, 10);
      return d >= from && d <= to;
    });
  }, [paychecks, from, to]);

  const payrollSum = (col: keyof ReportPaycheck) => filteredPaychecks.reduce((s, p) => s + (Number(p[col]) || 0), 0);
  const payrollGrossWages = payrollSum("gross_wages");
  const payrollEmployeeTaxes = payrollSum("employee_taxes");
  const payrollEmployerTaxes = payrollSum("employer_taxes");
  const payrollNetPay = payrollSum("net_pay");
  const payrollTotalCost = payrollSum("total_cost");
  const payrollTaxRows: { label: string; employee: number; employer: number }[] = [
    { label: "Federal Withholding", employee: payrollSum("federal_withholding"), employer: 0 },
    { label: "Social Security", employee: payrollSum("social_security_ee"), employer: payrollSum("social_security_er") },
    { label: "Medicare", employee: payrollSum("medicare_ee"), employer: payrollSum("medicare_er") },
    { label: `${client?.state || "State"} Withholding`, employee: payrollSum("state_tax"), employer: 0 },
    { label: `${client?.state || "State"} Unemployment (SUTA)`, employee: 0, employer: payrollSum("suta") },
    { label: "Federal Unemployment (FUTA)", employee: 0, employer: payrollSum("futa") },
  ];
  const payrollTaxEmployeeTotal = payrollTaxRows.reduce((s, r) => s + r.employee, 0);
  const payrollTaxEmployerTotal = payrollTaxRows.reduce((s, r) => s + r.employer, 0);

  // Same period's paychecks as the Payroll tab, grouped by employee instead of left flat.
  const employeeNames = useMemo(() => {
    const seen = new Map<string, string>(); // lower(name) -> display name (first-seen casing)
    for (const p of filteredPaychecks) {
      const key = (p.employee || "").toLowerCase();
      if (key && !seen.has(key)) seen.set(key, p.employee);
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [filteredPaychecks]);

  const employeeSummaryRows = useMemo(() => {
    const byEmployee = new Map<string, { employee: string; checkCount: number; gross: number; eeTax: number; erTax: number; net: number; total: number }>();
    for (const p of filteredPaychecks) {
      const key = (p.employee || "").toLowerCase();
      const row = byEmployee.get(key) || { employee: p.employee, checkCount: 0, gross: 0, eeTax: 0, erTax: 0, net: 0, total: 0 };
      row.checkCount += 1;
      row.gross += Number(p.gross_wages) || 0;
      row.eeTax += Number(p.employee_taxes) || 0;
      row.erTax += Number(p.employer_taxes) || 0;
      row.net += Number(p.net_pay) || 0;
      row.total += Number(p.total_cost) || 0;
      byEmployee.set(key, row);
    }
    return Array.from(byEmployee.values()).sort((a, b) => a.employee.localeCompare(b.employee));
  }, [filteredPaychecks]);

  const employeePaychecks = useMemo(() => {
    if (!employeeFilter) return [];
    return filteredPaychecks.filter((p) => (p.employee || "").toLowerCase() === employeeFilter.toLowerCase());
  }, [filteredPaychecks, employeeFilter]);

  const employeeSum = (col: keyof ReportPaycheck) => employeePaychecks.reduce((s, p) => s + (Number(p[col]) || 0), 0);
  const employeeTaxRows: { label: string; employee: number; employer: number }[] = [
    { label: "Federal Withholding", employee: employeeSum("federal_withholding"), employer: 0 },
    { label: "Social Security", employee: employeeSum("social_security_ee"), employer: employeeSum("social_security_er") },
    { label: "Medicare", employee: employeeSum("medicare_ee"), employer: employeeSum("medicare_er") },
    { label: `${client?.state || "State"} Withholding`, employee: employeeSum("state_tax"), employer: 0 },
    { label: `${client?.state || "State"} Unemployment (SUTA)`, employee: 0, employer: employeeSum("suta") },
    { label: "Federal Unemployment (FUTA)", employee: 0, employer: employeeSum("futa") },
  ];

  function handleClientChange(id: string) {
    setClientId(id);
    // FIRM_WIDE isn't a real client — don't stomp the app's globally-remembered
    // "last selected client" (other pages like Accounting/Billing read that).
    if (id === FIRM_WIDE) return;
    setSelectedClient(id || null, clients.find((c) => c.client_id === id)?.client_name);
  }

  const isFirmWide = tab === "Financial Overview" && clientId === FIRM_WIDE;

  /** Firm Overview month row -> that month's P&L. `month` is "YYYY-MM". */
  function openMonthDetail(month: string) {
    const [y, m] = month.split("-").map(Number);
    if (!y || !m) return;
    const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    setFrom(start);
    setTo(end);
    setTab("P&L");
  }

  // Carries the Sales & Tax tab's editable "filing/payment date" into the PDF/
  // CSV/email of that same report (and the Sales, Tax & Payroll Report, which
  // shows the same MD discount/penalty/interest block) so what a preparer
  // downloads or sends matches what they were just looking at on screen —
  // rather than silently recomputing against "today" a second time.
  const mdPaidDateQuery = tab === "Sales & Tax" || tab === "Sales, Tax & Payroll Report" ? `&mdFiledDate=${mdFiledDate}&mdPaidDate=${mdPaidDate}` : "";

  async function handlePrintReport(mode: "view" | "download" | "print") {
    const segment = REPORT_PDF_SEGMENT[tab];
    if (!segment || !clientId) return;
    const key = `${segment}-${mode}`;
    setReportBusy(key);
    try {
      const employeeQuery = tab === "Employee" && employeeFilter ? `&employee=${encodeURIComponent(employeeFilter)}` : "";
      const path = `/reports/pdf/${segment}/${clientId}?from=${from}&to=${to}${employeeQuery}${mdPaidDateQuery}`;
      if (mode === "view") await viewFile(path);
      else if (mode === "print") await printFile(path);
      else await downloadFile(path, buildFilename([client?.client_name, tab, `${from} to ${to}`], "pdf"));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not generate this report.");
    } finally {
      setReportBusy(null);
    }
  }

  async function handleExportCsv(format: "csv" | "xlsx" = "csv") {
    const segment = REPORT_CSV_SEGMENT[tab];
    if (!segment || !clientId) return;
    setReportBusy(format);
    try {
      const employeeQuery = tab === "Employee" && employeeFilter ? `&employee=${encodeURIComponent(employeeFilter)}` : "";
      await downloadFile(`/reports/csv/${segment}/${clientId}?from=${from}&to=${to}${employeeQuery}${mdPaidDateQuery}&format=${format}`, buildFilename([client?.client_name, tab, `${from} to ${to}`], format));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not export this data.");
    } finally {
      setReportBusy(null);
    }
  }

  async function handleFirmOverviewPrint(mode: "view" | "download" | "print") {
    if (!clientId) return;
    const key = `firm-${mode}`;
    setReportBusy(key);
    try {
      const clientQuery = isFirmWide ? "" : `&clientId=${encodeURIComponent(clientId)}`;
      const path = `/reports/pdf/firm-overview?from=${from}&to=${to}${clientQuery}`;
      if (mode === "view") await viewFile(path);
      else if (mode === "print") await printFile(path);
      else await downloadFile(path, buildFilename([isFirmWide ? "Firm" : client?.client_name, "Firm Overview", `${from} to ${to}`], "pdf"));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not generate this report.");
    } finally {
      setReportBusy(null);
    }
  }

  async function handleFirmOverviewCsv(format: "csv" | "xlsx" = "csv") {
    if (!clientId) return;
    setReportBusy(`firm-${format}`);
    try {
      const clientQuery = isFirmWide ? "" : `&clientId=${encodeURIComponent(clientId)}`;
      await downloadFile(`/reports/csv/firm-overview?from=${from}&to=${to}${clientQuery}&format=${format}`, buildFilename([isFirmWide ? "Firm" : client?.client_name, "Firm Overview", `${from} to ${to}`], format));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not export this data.");
    } finally {
      setReportBusy(null);
    }
  }

  /**
   * "Email Report" — fetches the exact same PDF Preview/Print already generates,
   * then hands it to the same /communications send path the Communications page
   * uses. Email-only: SMS/WhatsApp aren't connected (no Twilio credentials), so a
   * "Text Report" button here would just fail every time — removed rather than
   * left as a button that silently doesn't work. Always sends to the currently
   * selected CLIENT's own email, not any individual employee, matching every
   * other report on this page.
   */
  async function handleSendReport() {
    if (!clientId || !client) return;
    const title = REPORT_TITLES[tab];
    if (!title) return;
    const sentTo = client.email;
    if (!sentTo) {
      await notify("This client has no email address on file.");
      return;
    }
    const isFirmOverview = tab === "Financial Overview";
    const key = `${isFirmOverview ? "firm" : REPORT_PDF_SEGMENT[tab]}-email`;
    setReportBusy(key);
    try {
      const employeeQuery = tab === "Employee" && employeeFilter ? `&employee=${encodeURIComponent(employeeFilter)}` : "";
      const path = isFirmOverview
        ? `/reports/pdf/firm-overview?from=${from}&to=${to}&clientId=${encodeURIComponent(clientId)}`
        : `/reports/pdf/${REPORT_PDF_SEGMENT[tab]}/${clientId}?from=${from}&to=${to}${employeeQuery}${mdPaidDateQuery}`;
      const contentBase64 = await blobToBase64(await fetchAuthedBlob(path));
      const periodLabel = `${from} – ${to}`;
      const periodLabelAr = `الفترة من ${from} إلى ${to}`;
      const cc = reportCc.split(/[,;]/).map((v) => v.trim()).filter((v) => v.includes("@"));
      const res = await api.post<{ sent?: boolean; sendError?: string }>("/communications", {
        clientId, subject: title.en, channel: "Email", sentTo, sendNow: true,
        messageEnglish: `Please find attached your ${title.en} for ${periodLabel}.`,
        messageArabic: `يرجى الاطلاع على ${title.ar} المرفق لـ ${periodLabelAr}.`,
        attachment: { filename: `${tab.replace(/[^A-Za-z0-9]+/g, "")}_${clientId}_${from}_${to}.pdf`, contentBase64, contentType: "application/pdf" },
        cc: cc.length ? cc : undefined,
      });
      if (res.sent) await notify(`${title.en} emailed to ${sentTo}${cc.length ? ` (cc: ${cc.join(", ")})` : ""}.`);
      else await notify(res.sendError ? `Could not send: ${res.sendError}` : "Could not send this report.");
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not send this report.");
    } finally {
      setReportBusy(null);
    }
  }

  async function handleSaveMessage() {
    if (!clientId || !periodMessage) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      await api.post("/communications", {
        clientId, subject: periodMessage.subject, messageEnglish: periodMessage.body, messageArabic: periodMessage.bodyArabic,
        channel: "Portal Note", sendNow: false,
      });
      setSaveStatus("Saved to client portal history.");
    } catch (err) {
      setSaveStatus(err instanceof ApiError ? err.message : "Could not save this message.");
    } finally {
      setSaving(false);
    }
  }

  function handleOpenToSend() {
    if (!clientId || !periodMessage || !client) return;
    sessionStorage.setItem(`${CLIENT_MESSAGE_HANDOFF_KEY}:${clientId}`, JSON.stringify({
      subject: periodMessage.subject, body: periodMessage.body, bodyArabic: periodMessage.bodyArabic, periodStart: from, periodEnd: to,
    }));
    navigate(`/clients/${clientId}?tab=Communications`);
  }

  // AR Aging is genuinely firm-wide (every client's name + balance, no per-client
  // scoping) — now admin-only on the backend too, matching /firm-summary's
  // precedent, so hide the tab for staff rather than showing them a 403.
  const visibleTabs = user?.role === "admin" ? TABS : TABS.filter((t) => t !== "Financial Overview" && t !== "AR Aging");

  return (
    <div>
      <div className="no-print" role="tablist" style={{ display: "flex", flexWrap: "wrap", gap: 24, borderBottom: "1px solid var(--line)", marginBottom: 20, paddingBottom: 6 }}>
        {TAB_GROUPS.map((group) => {
          const groupTabs = group.tabs.filter((t) => (visibleTabs as readonly Tab[]).includes(t));
          if (!groupTabs.length) return null;
          return (
            <div key={group.label}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>{group.label}</div>
              <div style={{ display: "flex", gap: 4 }}>
                {groupTabs.map((t) => (
                  <button
                    key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                    style={{ padding: "6px 12px", fontSize: 14, fontWeight: 500, cursor: "pointer", borderRadius: 8, border: "none", font: "inherit", color: tab === t ? "var(--ink)" : "var(--muted)", background: tab === t ? "var(--teal-soft)" : "transparent" }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {tab === "AR Aging" && <ArAgingTab />}

      {tab !== "AR Aging" && (
      <>
          <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <div className="field" style={{ maxWidth: 320, margin: 0 }}>
              <label htmlFor="rep-client">Client</label>
              <select id="rep-client" value={clientId} onChange={(e) => handleClientChange(e.target.value)}>
                <option value="">Select a client…</option>
                {tab === "Financial Overview" && <option value={FIRM_WIDE}>All Clients (Firm-Wide)</option>}
                {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "end" }}>
              <div className="field" style={{ margin: 0 }}><label htmlFor="rep-from">From</label><input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="field" style={{ margin: 0 }}><label htmlFor="rep-to">To</label><input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          </div>

          {!clientId && <p className="muted">Pick a client to generate their financial reports.</p>}

          {clientId && (client || isFirmWide) && (
            <>
              <div className="command-panel" style={{ marginBottom: 16 }}>
                <div className="command-panel-header" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <h2 className="command-panel-title">{isFirmWide ? "All Clients (Firm-Wide)" : client!.client_name}</h2>
                    <div className="command-panel-note">
                      {tab === "Financial Overview" ? `Revenue/expense trend from general-ledger activity, ${from} – ${to}.${isFirmWide && firmSummary?.activeClientCount != null ? ` ${firmSummary.activeClientCount} active client${firmSummary.activeClientCount === 1 ? "" : "s"}.` : ""}` : "Financial statements are generated from general-ledger activity for the selected period."}
                    </div>
                  </div>
                  {/* "Preview / Print" rather than the old "Print Report": this opens the
                      real generated PDF in a new tab, where it can be read first and printed
                      from the browser — it never printed directly, so the old label undersold
                      it as a preview step and the user asked for one explicitly. */}
                  {tab === "Financial Overview" ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handleFirmOverviewPrint("view")}>
                        {reportBusy === "firm-view" ? "Opening…" : "Preview / Print"}
                      </button>
                      <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handleFirmOverviewPrint("download")}>
                        {reportBusy === "firm-download" ? "Generating…" : "Download PDF"}
                      </button>
                      <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handleFirmOverviewPrint("print")}>
                        {reportBusy === "firm-print" ? "Printing…" : "Print PDF"}
                      </button>
                      <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handleFirmOverviewCsv("csv")}>
                        {reportBusy === "firm-csv" ? "Exporting…" : "Export CSV"}
                      </button>
                      <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handleFirmOverviewCsv("xlsx")}>
                        {reportBusy === "firm-xlsx" ? "Exporting…" : "Export Excel"}
                      </button>
                      {/* No single client to email a firm-wide roll-up to — Preview/Download/
                          CSV still work firm-wide since they don't need a recipient. */}
                      {!isFirmWide && (
                        <>
                          <input
                            type="text"
                            placeholder="CC (optional, comma-separated)"
                            value={reportCc}
                            onChange={(e) => setReportCc(e.target.value)}
                            style={{ width: 220, padding: "6px 8px", fontSize: 12.5 }}
                          />
                          <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handleSendReport()}>
                            {reportBusy === "firm-email" ? "Sending…" : "Email Report"}
                          </button>
                        </>
                      )}
                    </div>
                  ) : (REPORT_PDF_SEGMENT[tab] || REPORT_CSV_SEGMENT[tab]) && (
                    <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {REPORT_PDF_SEGMENT[tab] && (
                        <>
                          <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handlePrintReport("view")}>
                            {reportBusy === `${REPORT_PDF_SEGMENT[tab]}-view` ? "Opening…" : "Preview / Print (English)"}
                          </button>
                          <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handlePrintReport("download")}>
                            {reportBusy === `${REPORT_PDF_SEGMENT[tab]}-download` ? "Generating…" : "Download PDF (English)"}
                          </button>
                          <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handlePrintReport("print")}>
                            {reportBusy === `${REPORT_PDF_SEGMENT[tab]}-print` ? "Printing…" : "Print PDF (English)"}
                          </button>
                        </>
                      )}
                      {/* Browser-native print, not the server PDF — pdf-lib can't shape Arabic
                          text correctly, but the browser already renders the on-screen bilingual
                          table correctly, so printing that view (or "Save as PDF" from the print
                          dialog) is how a real English+Arabic printable/sendable copy is produced. */}
                      {(tab === "Client Message" || tab === "Sales, Tax & Payroll Report") && (
                        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
                          Print (English + Arabic)
                        </button>
                      )}
                      {REPORT_CSV_SEGMENT[tab] && (
                        <>
                          <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handleExportCsv("csv")}>
                            {reportBusy === "csv" ? "Exporting…" : "Export CSV"}
                          </button>
                          <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handleExportCsv("xlsx")}>
                            {reportBusy === "xlsx" ? "Exporting…" : "Export Excel"}
                          </button>
                        </>
                      )}
                      {/* Client Message already has its own real bilingual send (Save / Open
                          Communications to Send below) — these generic quick-send buttons would
                          just be a second, more generic way to do the same thing on that one tab.
                          Trial Balance has no PDF (see REPORT_PDF_SEGMENT) so there's nothing to email. */}
                      {tab !== "Client Message" && REPORT_PDF_SEGMENT[tab] && (
                        <>
                          <input
                            type="text"
                            placeholder="CC (optional, comma-separated)"
                            value={reportCc}
                            onChange={(e) => setReportCc(e.target.value)}
                            style={{ width: 220, padding: "6px 8px", fontSize: 12.5 }}
                          />
                          <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handleSendReport()}>
                            {reportBusy === `${REPORT_PDF_SEGMENT[tab]}-email` ? "Sending…" : "Email Report"}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {tab === "Financial Overview" && (
                <>
                  {firmError && <ErrorBanner error={firmError} />}
                  {!firmSummary && !firmError && <div className="spinner-wrap">Loading…</div>}
                  {firmSummary && (
                    <>
                      <div className="metric-grid" style={{ marginBottom: 20 }}>
                        {/* Revenue/Expenses/Net Profit normally drill into that ONE client's GL —
                            not meaningful firm-wide (no single client to open), so the click is
                            disabled in that mode rather than jumping to a broken/empty GL filter. */}
                        <div className="metric" style={isFirmWide ? undefined : { cursor: "pointer" }} role={isFirmWide ? undefined : "button"} tabIndex={isFirmWide ? undefined : 0} onClick={isFirmWide ? undefined : () => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=GL`)} onKeyDown={isFirmWide ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=GL`); } }}><div className="metric-label">Revenue</div><div className="metric-value">{fmtMoney(firmSummary.totals.revenue)}</div></div>
                        <div className="metric" style={isFirmWide ? undefined : { cursor: "pointer" }} role={isFirmWide ? undefined : "button"} tabIndex={isFirmWide ? undefined : 0} onClick={isFirmWide ? undefined : () => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=GL`)} onKeyDown={isFirmWide ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=GL`); } }}><div className="metric-label">Expenses</div><div className="metric-value">{fmtMoney(firmSummary.totals.expenses)}</div></div>
                        <div className="metric" style={isFirmWide ? undefined : { cursor: "pointer" }} role={isFirmWide ? undefined : "button"} tabIndex={isFirmWide ? undefined : 0} onClick={isFirmWide ? undefined : () => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=GL`)} onKeyDown={isFirmWide ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=GL`); } }}><div className="metric-label">Net Profit</div><div className="metric-value">{fmtMoney(firmSummary.totals.profit)}</div></div>
                        <div className="metric" style={{ cursor: "pointer" }} role="button" tabIndex={0} onClick={() => navigate("/billing")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/billing"); } }}><div className="metric-label">Unpaid Balance</div><div className="metric-value">{fmtMoney(firmSummary.unpaidBalance)}</div></div>
                        {isFirmWide && firmSummary.activeClientCount != null && (
                          <div className="metric"><div className="metric-label">Active Clients</div><div className="metric-value">{firmSummary.activeClientCount}</div></div>
                        )}
                      </div>
                      <div className="command-panel">
                        <div className="command-panel-header">
                          <h2 className="command-panel-title">Monthly Trend</h2>
                          <div className="command-panel-note">
                            {isFirmWide ? `Aggregated across every active client · ` : `Click a month to open its P&L · `}
                            {firmSummary.unpaidInvoiceCount} unpaid invoice{firmSummary.unpaidInvoiceCount === 1 ? "" : "s"}
                          </div>
                        </div>
                        <div className="table-scroll">
                        <table>
                          <thead><tr><th scope="col">Month</th><th scope="col">Revenue</th><th scope="col">Expenses</th><th scope="col">Profit</th></tr></thead>
                          <tbody>
                            {/* Clicking a month sets the period to that month and jumps to P&L —
                                the row's numbers are a roll-up, so "show me the detail behind
                                this" means the account-level statement for the same window. Not
                                meaningful firm-wide (no single client's P&L to open), so rows
                                aren't clickable in that mode. */}
                            {firmSummary.months.map((m) => (
                              <tr key={m.month} style={isFirmWide ? undefined : { cursor: "pointer" }} tabIndex={isFirmWide ? undefined : 0} onClick={isFirmWide ? undefined : () => openMonthDetail(m.month)} onKeyDown={isFirmWide ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openMonthDetail(m.month); } }}>
                                <td>{m.month}</td>
                                <td>{fmtMoney(m.revenue)}</td>
                                <td className="muted">{fmtMoney(m.expenses)}</td>
                                <td style={{ fontWeight: 700, color: m.profit >= 0 ? "var(--teal)" : "var(--red)" }}>{fmtMoney(m.profit)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}

              {loading && <div className="spinner-wrap">Loading…</div>}

              {!loading && tab === "P&L" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
              <div className="command-panel">
                <div className="command-panel-header"><h2 className="command-panel-title">Profit and Loss</h2><div className="command-panel-note">{from} – {to}</div></div>
                <div style={{ padding: 16 }}>
                  <SectionLabel>Income</SectionLabel>
                  {income.map(([acct, v]) => <Row key={acct} label={acct} value={fmtMoney(v.credit - v.debit)} />)}
                  <Row label="Total Income" value={fmtMoney(totalIncome)} bold />
                  <SectionLabel>Cost of Goods Sold</SectionLabel>
                  {cogs.length === 0 && <p className="muted" style={{ fontSize: 12, margin: "4px 0" }}>No activity in this section for the selected period.</p>}
                  {cogs.map(([acct, v]) => <Row key={acct} label={acct} value={fmtMoney(v.debit - v.credit)} />)}
                  <Row label="Total Cost of Goods Sold" value={fmtMoney(totalCogs)} bold />
                  <Row label="Gross Profit" value={fmtMoney(grossProfit)} bold />
                  <SectionLabel>Expenses</SectionLabel>
                  {expenses.map(([acct, v]) => <Row key={acct} label={acct} value={fmtMoney(v.debit - v.credit)} />)}
                  <Row label="Total Expenses" value={fmtMoney(totalExpenses)} bold />
                  <Row label="Net Income" value={fmtMoney(netIncome)} bold accent />
                </div>
              </div>
              <div className="command-panel">
                <div className="command-panel-header"><h2 className="command-panel-title">Period Snapshot</h2></div>
                <div className="metric-grid" style={{ padding: 16, gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
                  <div className="metric" style={{ boxShadow: "none", cursor: "pointer" }} role="button" tabIndex={0} onClick={() => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Sales`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Sales`); } }}><div className="metric-label">Sales Tax</div><div className="metric-value">{fmtMoney(salesTax)}</div></div>
                  <div className="metric" style={{ boxShadow: "none", cursor: "pointer" }} role="button" tabIndex={0} onClick={() => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Payroll`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Payroll`); } }}><div className="metric-label">Payroll Gross</div><div className="metric-value">{fmtMoney(payrollGross)}</div></div>
                  <div className="metric" style={{ boxShadow: "none", cursor: "pointer" }} role="button" tabIndex={0} onClick={() => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=GL`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=GL`); } }}><div className="metric-label">Net Income</div><div className="metric-value">{fmtMoney(netIncome)}</div></div>
                  <div className="metric" style={{ boxShadow: "none", cursor: "pointer" }} role="button" tabIndex={0} onClick={() => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=GL`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=GL`); } }}><div className="metric-label">GL Entries</div><div className="metric-value">{filtered.length}</div></div>
                </div>
                <div className="table-scroll">
                <table>
                  <thead><tr><th scope="col">Account</th><th scope="col">Debit</th><th scope="col">Credit</th></tr></thead>
                  <tbody>
                    {Array.from(byAccount.entries()).map(([acct, v]) => (
                      <tr key={acct}><td>{acct}</td><td>{fmtMoney(v.debit)}</td><td>{fmtMoney(v.credit)}</td></tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {!loading && tab === "Balance Sheet" && (
            <div className="command-panel">
              <div className="command-panel-header"><h2 className="command-panel-title">Balance Sheet</h2><div className="command-panel-note">As of {to}</div></div>
              <div style={{ padding: 16 }}>
                <SectionLabel>Assets</SectionLabel>
                {assets.map(([acct, v]) => <Row key={acct} label={acct} value={fmtMoney(v.debit - v.credit)} />)}
                <Row label="Total Assets" value={fmtMoney(totalAssets)} bold />
                <SectionLabel>Liabilities</SectionLabel>
                {liabilities.map(([acct, v]) => <Row key={acct} label={acct} value={fmtMoney(v.credit - v.debit)} />)}
                <Row label="Total Liabilities" value={fmtMoney(totalLiabilities)} bold />
                <Row label="Equity (Assets - Liabilities)" value={fmtMoney(totalAssets - totalLiabilities)} bold accent />
              </div>
            </div>
          )}

          {tab === "Trial Balance" && <TrialBalanceTab clientId={clientId} from={from} to={to} />}

          {tab === "Sales & Tax" && (
            <>
              {salesTaxError && <ErrorBanner error={salesTaxError} />}
              {salesTaxLoading && <div className="spinner-wrap">Loading…</div>}
              {!salesTaxLoading && salesTaxReport && (
                <>
                  <div className="metric-grid" style={{ marginBottom: 16 }}>
                    <div className="metric" style={{ cursor: "pointer" }} role="button" tabIndex={0} onClick={() => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Sales`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Sales`); } }}><div className="metric-label">Gross Sales</div><div className="metric-value">{fmtMoney(salesTaxReport.totals.grossSales)}</div></div>
                    <div className="metric" style={{ cursor: "pointer" }} role="button" tabIndex={0} onClick={() => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Sales`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Sales`); } }}><div className="metric-label">Total Tax Due</div><div className="metric-value">{fmtMoney(salesTaxReport.totals.taxDue)}</div></div>
                    <div className="metric" style={{ cursor: "pointer" }} role="button" tabIndex={0} onClick={() => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Sales`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Sales`); } }}><div className="metric-label">Adjustments</div><div className="metric-value">{fmtMoney(salesTaxReport.totals.adjustments)}</div></div>
                    <div className="metric" style={{ cursor: "pointer" }} role="button" tabIndex={0} onClick={() => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Sales`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Sales`); } }}><div className="metric-label">Sales Recorded</div><div className="metric-value">{salesTaxReport.totals.saleCount}</div></div>
                  </div>

                  <div className="command-panel" style={{ marginBottom: 16 }}>
                    <div className="command-panel-header">
                      <h2 className="command-panel-title">Tax by Category</h2>
                      <div className="command-panel-note">What each filing box needs</div>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead><tr><th scope="col">Category</th><th scope="col">State</th><th scope="col">Rate</th><th scope="col">Taxable Sales</th><th scope="col">Tax</th></tr></thead>
                        <tbody>
                          {/* Every row here is a real record elsewhere — categories
                              live in Accounting → Tax Rates, sales in the Sales tab. */}
                          {salesTaxReport.byCategory.map((c, i) => (
                            <tr
                              key={`${c.categoryName}-${i}`}
                              style={{ cursor: "pointer" }}
                              title={`Open ${c.categoryName} in Accounting → Tax Rates`}
                              tabIndex={0}
                              onClick={() => navigate(`/accounting?tab=${encodeURIComponent("Tax Rates")}`)}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?tab=${encodeURIComponent("Tax Rates")}`); } }}
                            >
                              <td>{c.categoryName}</td>
                              <td className="muted">{c.state || "Any"}</td>
                              <td className="muted">{(c.rate * 100).toFixed(2)}%</td>
                              <td>{fmtMoney(c.taxableAmount)}</td>
                              <td style={{ fontWeight: 700 }}>{fmtMoney(c.taxAmount)}</td>
                            </tr>
                          ))}
                          {salesTaxReport.byCategory.length === 0 && (
                            <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 16 }}>No categorized sales in this period.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {salesTaxReport.mdFiling && salesTaxReport.mdFiling.periods.length > 0 && (
                    <div className="command-panel" style={{ marginBottom: 16 }}>
                      <div className="command-panel-header">
                        <h2 className="command-panel-title">Filing Discount / Late Penalty (Form 202)</h2>
                        <div className="command-panel-note">
                          {salesTaxReport.mdFiling.periods.length === 1
                            ? `Return due ${salesTaxReport.mdFiling.periods[0].dueDate}`
                            : `${salesTaxReport.mdFiling.periods.length} filing periods (${salesTaxReport.mdFiling.frequencyUsed || "combined"})`}
                        </div>
                      </div>
                      <div style={{ padding: 16 }}>
                        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                          <div className="field" style={{ maxWidth: 220, margin: 0 }}>
                            <label htmlFor="rp-md-filed-date">Filing date</label>
                            <input id="rp-md-filed-date" type="date" value={mdFiledDate} onChange={(e) => setMdFiledDate(e.target.value)} />
                          </div>
                          <div className="field" style={{ maxWidth: 220, margin: 0 }}>
                            <label htmlFor="rp-md-paid-date">Payment date</label>
                            <input id="rp-md-paid-date" type="date" value={mdPaidDate} onChange={(e) => setMdPaidDate(e.target.value)} />
                          </div>
                        </div>
                        {!salesTaxReport.mdFiling.frequencyUsed && (
                          <p className="muted" style={{ fontSize: 11.5, margin: "0 0 12px", color: "var(--red)" }}>
                            Filing frequency isn't set on this client's profile, so the whole range above is shown as one combined period.
                            Set Sales Tax Frequency on the client's profile for an accurate per-period breakdown.
                          </p>
                        )}
                        {salesTaxReport.mdFiling.periods.length === 1 ? (
                          <>
                            <div className="metric-grid metric-grid-3">
                              {salesTaxReport.mdFiling.periods[0].onTime ? (
                                <>
                                  <div className="metric"><div className="metric-label">Timely Discount</div><div className="metric-value">− {fmtMoney(salesTaxReport.mdFiling.periods[0].discount)}</div><div className="metric-note">Line 18</div></div>
                                  <div className="metric"><div className="metric-label">Balance Due</div><div className="metric-value">{fmtMoney(salesTaxReport.mdFiling.periods[0].balanceDue)}</div><div className="metric-note">Line 20</div></div>
                                </>
                              ) : (
                                <>
                                  <div className="metric"><div className="metric-label">Late Penalty — 10%</div><div className="metric-value">{fmtMoney(salesTaxReport.mdFiling.periods[0].penalty)}</div><div className="metric-note">Line 37a</div></div>
                                  <div className="metric"><div className="metric-label">Interest — {salesTaxReport.mdFiling.periods[0].monthsLate} mo</div><div className="metric-value">{fmtMoney(salesTaxReport.mdFiling.periods[0].interest)}</div><div className="metric-note">Line 37b</div></div>
                                  <div className="metric"><div className="metric-label">Balance Due</div><div className="metric-value">{fmtMoney(salesTaxReport.mdFiling.periods[0].balanceDue)}</div><div className="metric-note">Line 38</div></div>
                                </>
                              )}
                            </div>
                            <p className="muted" style={{ fontSize: 11.5, margin: "10px 0 0" }}>
                              {salesTaxReport.mdFiling.periods[0].onTime
                                ? "Filed and paid on or before the due date — eligible for the timely discount."
                                : "Paid after the due date — no timely discount; penalty and interest apply instead."}
                            </p>
                          </>
                        ) : (
                          <>
                            <div className="table-scroll">
                              <table>
                                <thead>
                                  <tr>
                                    <th scope="col">Period</th><th scope="col">Due Date</th><th scope="col">Tax Due</th>
                                    <th scope="col">Status</th><th scope="col">Discount / Penalty</th><th scope="col">Interest</th><th scope="col">Balance Due</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {salesTaxReport.mdFiling.periods.map((p) => (
                                    <tr key={`${p.start}-${p.end}`}>
                                      <td>{p.start} – {p.end}</td>
                                      <td>{p.dueDate}</td>
                                      <td>{fmtMoney(p.taxDue)}</td>
                                      <td className={p.onTime ? "muted" : ""} style={p.onTime ? undefined : { color: "var(--red)", fontWeight: 600 }}>
                                        {p.onTime ? "On time" : `Late — ${p.monthsLate} mo`}
                                      </td>
                                      <td>{p.onTime ? `− ${fmtMoney(p.discount)}` : fmtMoney(p.penalty)}</td>
                                      <td>{p.onTime ? "—" : fmtMoney(p.interest)}</td>
                                      <td style={{ fontWeight: 700 }}>{fmtMoney(p.balanceDue)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="metric-grid metric-grid-3" style={{ marginTop: 12 }}>
                              <div className="metric"><div className="metric-label">Total Discount</div><div className="metric-value">− {fmtMoney(salesTaxReport.mdFiling.totals.discount)}</div></div>
                              <div className="metric"><div className="metric-label">Total Penalty + Interest</div><div className="metric-value">{fmtMoney(salesTaxReport.mdFiling.totals.penalty + salesTaxReport.mdFiling.totals.interest)}</div></div>
                              <div className="metric"><div className="metric-label">Total Balance Due</div><div className="metric-value">{fmtMoney(salesTaxReport.mdFiling.totals.balanceDue)}</div></div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="command-panel">
                    <div className="command-panel-header">
                      <h2 className="command-panel-title">Sales Recorded ({salesTaxReport.sales.length})</h2>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead><tr><th scope="col">Date</th><th scope="col">Gross Sales</th><th scope="col">Taxable Sales</th><th scope="col">Non-Taxable Sales</th><th scope="col">Adjustments</th><th scope="col">Tax Due</th></tr></thead>
                        <tbody>
                          {salesTaxReport.sales.map((s) => (
                            <tr
                              key={s.saleId}
                              style={{ cursor: "pointer" }}
                              title="Open this sale in Accounting → Sales"
                              tabIndex={0}
                              onClick={() => navigate(`/accounting?tab=${encodeURIComponent("Sales")}`)}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?tab=${encodeURIComponent("Sales")}`); } }}
                            >
                              <td>{s.saleDate ? String(s.saleDate).slice(0, 10) : "—"}</td>
                              <td>{fmtMoney(s.grossSales)}</td>
                              <td className="muted">{fmtMoney(s.taxableSales)}</td>
                              <td className="muted">{fmtMoney(s.nonTaxableSales)}</td>
                              <td className="muted">{fmtMoney(s.adjustments)}</td>
                              <td>{fmtMoney(s.totalTaxDue)}</td>
                            </tr>
                          ))}
                          {salesTaxReport.sales.length === 0 && (
                            <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 16 }}>No sales recorded in this period.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {payrollLoading && tab === "Payroll" && <div className="spinner-wrap">Loading…</div>}
          {!payrollLoading && tab === "Payroll" && (
            <>
              <div className="metric-grid" style={{ marginBottom: 16 }}>
                <div className="metric" style={{ cursor: "pointer" }} role="button" tabIndex={0} onClick={() => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Payroll`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Payroll`); } }}><div className="metric-label">Gross Wages</div><div className="metric-value">{fmtMoney(payrollGrossWages)}</div></div>
                <div className="metric" style={{ cursor: "pointer" }} role="button" tabIndex={0} onClick={() => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Paychecks`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Paychecks`); } }}><div className="metric-label">Checks</div><div className="metric-value">{filteredPaychecks.length}</div></div>
                <div className="metric" style={{ cursor: "pointer" }} role="button" tabIndex={0} onClick={() => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Paychecks`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Paychecks`); } }}><div className="metric-label">Employee Taxes</div><div className="metric-value">{fmtMoney(payrollEmployeeTaxes)}</div></div>
                <div className="metric" style={{ cursor: "pointer" }} role="button" tabIndex={0} onClick={() => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Paychecks`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Paychecks`); } }}><div className="metric-label">Employer Taxes</div><div className="metric-value">{fmtMoney(payrollEmployerTaxes)}</div></div>
                <div className="metric" style={{ cursor: "pointer" }} role="button" tabIndex={0} onClick={() => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Paychecks`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Paychecks`); } }}><div className="metric-label">Net Pay</div><div className="metric-value">{fmtMoney(payrollNetPay)}</div></div>
                <div className="metric" style={{ cursor: "pointer" }} role="button" tabIndex={0} onClick={() => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Paychecks`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Paychecks`); } }}><div className="metric-label">Total Payroll Cost</div><div className="metric-value">{fmtMoney(payrollTotalCost)}</div></div>
              </div>
              <div className="command-panel" style={{ marginBottom: 16 }}>
                <div className="command-panel-header"><h2 className="command-panel-title">Payroll Tax Summary</h2><div className="command-panel-note">{from} – {to}</div></div>
                <div className="table-scroll">
                <table>
                  <thead><tr><th scope="col">Tax</th><th scope="col">Employee</th><th scope="col">Employer</th><th scope="col">Total</th></tr></thead>
                  <tbody>
                    {payrollTaxRows.map((r) => (
                      <tr key={r.label}><td>{r.label}</td><td>{fmtMoney(r.employee)}</td><td>{fmtMoney(r.employer)}</td><td>{fmtMoney(r.employee + r.employer)}</td></tr>
                    ))}
                    <tr style={{ fontWeight: 800, borderTop: "1px solid var(--line)" }}>
                      <td>Total</td><td>{fmtMoney(payrollTaxEmployeeTotal)}</td><td>{fmtMoney(payrollTaxEmployerTotal)}</td><td>{fmtMoney(payrollTaxEmployeeTotal + payrollTaxEmployerTotal)}</td>
                    </tr>
                  </tbody>
                </table>
                </div>
              </div>
              <div className="command-panel">
                <div className="command-panel-header"><h2 className="command-panel-title">Checks</h2><div className="command-panel-note">{filteredPaychecks.length} in period</div></div>
                {filteredPaychecks.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No paychecks in this period.</p>}
                {filteredPaychecks.length > 0 && (
                  <div className="table-scroll">
                  <table>
                    <thead><tr><th scope="col">Date</th><th scope="col">Employee</th><th scope="col">Gross</th><th scope="col">Net</th></tr></thead>
                    <tbody>
                      {filteredPaychecks.map((p) => (
                        <tr
                          key={p.paycheck_id}
                          style={{ cursor: "pointer" }}
                          tabIndex={0}
                          onClick={() => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Paychecks`)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Paychecks`); } }}
                        ><td>{p.pay_date ? String(p.pay_date).slice(0, 10) : "—"}</td><td>{p.employee}</td><td>{fmtMoney(p.gross_wages)}</td><td>{fmtMoney(p.net_pay)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            </>
          )}

          {payrollLoading && tab === "Employee" && <div className="spinner-wrap">Loading…</div>}
          {!payrollLoading && tab === "Employee" && (
            <>
              <div className="command-panel" style={{ marginBottom: 16 }}>
                <div className="command-panel-header">
                  <h2 className="command-panel-title">Employee</h2>
                  <div className="field" style={{ margin: 0, minWidth: 220 }}>
                    <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
                      <option value="">All Employees</option>
                      {employeeNames.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {!employeeFilter && (
                <div className="command-panel">
                  <div className="command-panel-header"><h2 className="command-panel-title">Employees</h2><div className="command-panel-note">{employeeSummaryRows.length} in period — click a row to see that employee's detail</div></div>
                  {employeeSummaryRows.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No paychecks in this period.</p>}
                  {employeeSummaryRows.length > 0 && (
                    <div className="table-scroll">
                    <table>
                      <thead><tr><th scope="col">Employee</th><th scope="col">Checks</th><th scope="col">Gross</th><th scope="col">Employee Taxes</th><th scope="col">Employer Taxes</th><th scope="col">Net Pay</th><th scope="col">Total Cost</th></tr></thead>
                      <tbody>
                        {employeeSummaryRows.map((r) => (
                          <tr key={r.employee} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => setEmployeeFilter(r.employee)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEmployeeFilter(r.employee); } }}>
                            <td>{r.employee}</td><td>{r.checkCount}</td><td>{fmtMoney(r.gross)}</td><td>{fmtMoney(r.eeTax)}</td><td>{fmtMoney(r.erTax)}</td><td>{fmtMoney(r.net)}</td><td>{fmtMoney(r.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )}
                </div>
              )}

              {employeeFilter && (
                <>
                  <button type="button" className="btn" style={{ marginBottom: 16 }} onClick={() => setEmployeeFilter("")}>← All Employees</button>
                  <div className="metric-grid" style={{ marginBottom: 16 }}>
                    <div className="metric"><div className="metric-label">Gross Wages</div><div className="metric-value">{fmtMoney(employeeSum("gross_wages"))}</div></div>
                    <div className="metric"><div className="metric-label">Checks</div><div className="metric-value">{employeePaychecks.length}</div></div>
                    <div className="metric"><div className="metric-label">Employee Taxes</div><div className="metric-value">{fmtMoney(employeeSum("employee_taxes"))}</div></div>
                    <div className="metric"><div className="metric-label">Employer Taxes</div><div className="metric-value">{fmtMoney(employeeSum("employer_taxes"))}</div></div>
                    <div className="metric"><div className="metric-label">Net Pay</div><div className="metric-value">{fmtMoney(employeeSum("net_pay"))}</div></div>
                    <div className="metric"><div className="metric-label">Total Payroll Cost</div><div className="metric-value">{fmtMoney(employeeSum("total_cost"))}</div></div>
                  </div>
                  <div className="command-panel" style={{ marginBottom: 16 }}>
                    <div className="command-panel-header"><h2 className="command-panel-title">Payroll Tax Summary</h2><div className="command-panel-note">{from} – {to}</div></div>
                    <div className="table-scroll">
                    <table>
                      <thead><tr><th scope="col">Tax</th><th scope="col">Employee</th><th scope="col">Employer</th><th scope="col">Total</th></tr></thead>
                      <tbody>
                        {employeeTaxRows.map((r) => (
                          <tr key={r.label}><td>{r.label}</td><td>{fmtMoney(r.employee)}</td><td>{fmtMoney(r.employer)}</td><td>{fmtMoney(r.employee + r.employer)}</td></tr>
                        ))}
                        <tr style={{ fontWeight: 800, borderTop: "1px solid var(--line)" }}>
                          <td>Total</td><td>{fmtMoney(employeeTaxRows.reduce((s, r) => s + r.employee, 0))}</td><td>{fmtMoney(employeeTaxRows.reduce((s, r) => s + r.employer, 0))}</td>
                          <td>{fmtMoney(employeeTaxRows.reduce((s, r) => s + r.employee + r.employer, 0))}</td>
                        </tr>
                      </tbody>
                    </table>
                    </div>
                  </div>
                  <div className="command-panel">
                    <div className="command-panel-header"><h2 className="command-panel-title">Checks</h2><div className="command-panel-note">{employeePaychecks.length} in period</div></div>
                    {employeePaychecks.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No paychecks in this period.</p>}
                    {employeePaychecks.length > 0 && (
                      <div className="table-scroll">
                      <table>
                        <thead><tr><th scope="col">Date</th><th scope="col">Gross</th><th scope="col">Net</th></tr></thead>
                        <tbody>
                          {employeePaychecks.map((p) => (
                            <tr
                              key={p.paycheck_id}
                              style={{ cursor: "pointer" }}
                              tabIndex={0}
                              onClick={() => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Paychecks`)}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Paychecks`); } }}
                            ><td>{p.pay_date ? String(p.pay_date).slice(0, 10) : "—"}</td><td>{fmtMoney(p.gross_wages)}</td><td>{fmtMoney(p.net_pay)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {tab === "Client Message" && (
            <div className="command-panel">
              <div className="command-panel-header">
                <div>
                  <h2 className="command-panel-title">Client Message</h2>
                  <div className="command-panel-note">Real sales tax + payroll figures for {from} – {to}, merged into the same summary Communications uses. The downloadable PDF is English-only — see note below.</div>
                </div>
              </div>
              {(messageLoading || summaryTableLoading) && <div className="spinner-wrap">Loading…</div>}
              {messageError && <ErrorBanner error={messageError} style={{ margin: 16 }} />}
              {summaryTableError && <ErrorBanner error={summaryTableError} style={{ margin: 16 }} />}
              {!messageLoading && periodMessage && (
                <div style={{ padding: 16 }}>
                  <div className="field"><label htmlFor="rep-period-subject">Subject</label><input id="rep-period-subject" readOnly value={periodMessage.subject} /></div>
                  {!summaryTableLoading && summaryTable && (
                    <div style={{ margin: "12px 0 16px" }}>
                      <SummaryTable sections={summaryTable} />
                    </div>
                  )}
                  <p className="muted" style={{ fontSize: 11, marginBottom: 12 }}>
                    Print Report/Download PDF above renders the English text only — reliable Arabic PDF rendering needs proper right-to-left glyph shaping this app doesn't yet do. Emailed sends (via Open Communications to Send) use the full bilingual text.
                  </p>
                  {saveStatus && <p className="muted" style={{ fontSize: 12 }}>{saveStatus}</p>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="btn" disabled={saving} onClick={handleSaveMessage}>{saving ? "Saving…" : "Save Period Message"}</button>
                    <button type="button" className="btn btn-primary" onClick={handleOpenToSend}>Open Communications to Send</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "Sales, Tax & Payroll Report" && (
            <div className="command-panel">
              <div className="command-panel-header">
                <div>
                  <h2 className="command-panel-title">Sales, Tax &amp; Payroll Report</h2>
                  <div className="command-panel-note">{client?.client_name} — {from} – {to}. Same real figures as the Client Message tab, as a standalone bilingual report rather than a message to send. The downloadable PDF is English-only — see note below.</div>
                </div>
              </div>
              {summaryTableLoading && <div className="spinner-wrap">Loading…</div>}
              {summaryTableError && <ErrorBanner error={summaryTableError} style={{ margin: 16 }} />}
              {!summaryTableLoading && summaryTable && (
                <div style={{ padding: 16 }}>
                  <SummaryTable sections={summaryTable} />
                  <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>
                    Print Report/Download PDF above renders the English text only — reliable Arabic PDF rendering needs proper right-to-left glyph shaping this app doesn't yet do.
                  </p>
                </div>
              )}
            </div>
          )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", margin: "14px 0 4px" }}>{children}</div>;
}

function Row({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, fontWeight: bold ? 800 : 500, color: accent ? "var(--teal)" : "var(--ink)", borderTop: bold ? "1px solid var(--line)" : "none" }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}


interface TrialBalanceAccount {
  account: string;
  debits: number;
  credits: number;
  balance: number;
  lineCount: number;
}
interface TrialBalanceData {
  accounts: TrialBalanceAccount[];
  totals: { debits: number; credits: number; difference: number };
  inBalance: boolean;
  unbalancedEntries: { ref: string; source: string; debits: number; credits: number; difference: number }[];
}

/**
 * Trial balance — the check that the books actually balance.
 *
 * Nothing previously verified that debits equal credits, so a half-posted entry
 * would sit in the ledger indefinitely and surface first to a client's
 * accountant. This makes it a one-click answer, and names the exact source
 * document when something is off rather than just reporting a total.
 */
interface ArAgingRow {
  clientId: string; clientName: string;
  current: number; d1_30: number; d31_60: number; d61_90: number; d90Plus: number; total: number;
}
interface ArAgingData {
  asOf: string;
  rows: ArAgingRow[];
  totals: { current: number; d1_30: number; d31_60: number; d61_90: number; d90Plus: number; total: number };
}

/**
 * AR Aging — firm-wide, not per-client, so unlike every other tab on this page it
 * doesn't need the Client/From/To toolbar (ReportsPage hides that toolbar entirely
 * for this tab). Which clients owe the firm money and how overdue, bucketed off
 * each open invoice's due_date as of today.
 */
function ArAgingTab() {
  const navigate = useNavigate();
  const [data, setData] = useState<ArAgingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    setError(null);
    api.get<ArAgingData>("/reports/ar-aging")
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load AR aging."));
  }
  useEffect(load, []);

  async function handlePrint(mode: "view" | "download" | "print") {
    setBusy(mode);
    try {
      if (mode === "view") await viewFile("/reports/pdf/ar-aging");
      else if (mode === "print") await printFile("/reports/pdf/ar-aging");
      else await downloadFile("/reports/pdf/ar-aging", buildFilename(["AR Aging", data?.asOf], "pdf"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate the PDF.");
    } finally {
      setBusy(null);
    }
  }

  async function handleCsv(format: "csv" | "xlsx" = "csv") {
    setBusy(format);
    try {
      await downloadFile(`/reports/csv/ar-aging?format=${format}`, buildFilename(["AR Aging", data?.asOf], format));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not export the data.");
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorBanner error={error} />;
  if (!data) return <div className="spinner-wrap">Loading…</div>;

  return (
    <>
      <div className="command-panel" style={{ marginBottom: 16 }}>
        <div className="command-panel-header" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 className="command-panel-title">AR Aging</h2>
            <div className="command-panel-note">Open invoice balances by client, as of {data.asOf}.</div>
          </div>
          <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => handlePrint("view")}>
              {busy === "view" ? "Opening…" : "Preview / Print"}
            </button>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => handlePrint("download")}>
              {busy === "download" ? "Generating…" : "Download PDF"}
            </button>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => handlePrint("print")}>
              {busy === "print" ? "Printing…" : "Print PDF"}
            </button>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => handleCsv("csv")}>
              {busy === "csv" ? "Exporting…" : "Export CSV"}
            </button>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => handleCsv("xlsx")}>
              {busy === "xlsx" ? "Exporting…" : "Export Excel"}
            </button>
          </div>
        </div>
      </div>

      <div className="metric-grid" style={{ marginBottom: 20 }}>
        <div className="metric"><div className="metric-label">Total Outstanding</div><div className="metric-value">{fmtMoney(data.totals.total)}</div></div>
        <div className="metric"><div className="metric-label">Current</div><div className="metric-value">{fmtMoney(data.totals.current)}</div></div>
        <div className="metric"><div className="metric-label">31-90 Days</div><div className="metric-value">{fmtMoney(data.totals.d31_60 + data.totals.d61_90)}</div></div>
        <div className="metric"><div className="metric-label">90+ Days</div><div className="metric-value">{fmtMoney(data.totals.d90Plus)}</div></div>
      </div>

      <div className="command-panel">
        <div className="command-panel-header">
          <h2 className="command-panel-title">Clients With A Balance ({data.rows.length})</h2>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col" style={{ textAlign: "right" }}>Current</th>
                <th scope="col" style={{ textAlign: "right" }}>1-30</th>
                <th scope="col" style={{ textAlign: "right" }}>31-60</th>
                <th scope="col" style={{ textAlign: "right" }}>61-90</th>
                <th scope="col" style={{ textAlign: "right" }}>90+</th>
                <th scope="col" style={{ textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.clientId} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => navigate(`/clients/${r.clientId}?tab=Billing`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/clients/${r.clientId}?tab=Billing`); } }}>
                  <td>{r.clientName}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(r.current)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(r.d1_30)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(r.d31_60)}</td>
                  <td style={{ textAlign: "right", color: r.d61_90 > 0 ? "var(--amber)" : undefined }}>{fmtMoney(r.d61_90)}</td>
                  <td style={{ textAlign: "right", color: r.d90Plus > 0 ? "var(--red)" : undefined }}>{fmtMoney(r.d90Plus)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtMoney(r.total)}</td>
                </tr>
              ))}
              {!data.rows.length && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>No open balances — every invoice is paid or void.</td></tr>
              )}
            </tbody>
            {data.rows.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td>Total</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(data.totals.current)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(data.totals.d1_30)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(data.totals.d31_60)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(data.totals.d61_90)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(data.totals.d90Plus)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(data.totals.total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}

function TrialBalanceTab({ clientId, from, to }: { clientId: string; from: string; to: string }) {
  const navigate = useNavigate();
  const confirmDialog = useConfirm();
  const [data, setData] = useState<TrialBalanceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [wholeHistory, setWholeHistory] = useState(true);
  const [reposting, setReposting] = useState<string | null>(null);
  const [repostNote, setRepostNote] = useState<string | null>(null);

  function load() {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    const qs = wholeHistory ? "" : `?from=${from}&to=${to}`;
    api.get<TrialBalanceData>(`/reports/trial-balance/${clientId}${qs}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the trial balance."))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [clientId, from, to, wholeHistory]);

  function openInLedger(extra: string) {
    navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=GL${extra}`);
  }

  /**
   * Rebuilds a payroll entry's GL lines straight from the paycheck's already-stored
   * figures — POST /paychecks/:id/repost-gl, not the PATCH edit route, so this can
   * never recalculate against today's tax rates and silently change the paycheck's
   * own withholding numbers (that PATCH route re-runs the full rate lookup; this one
   * doesn't touch the paycheck row at all). This turns "one or more entries posted
   * only part of their lines" from a diagnosis into a button.
   */
  async function handleRepost(refId: string) {
    const ok = await confirmDialog({ title: "Repost ledger lines", message: `Repost all ledger lines for ${refId} from its paycheck? The paycheck itself is not changed.` });
    if (!ok) return;
    setReposting(refId);
    setRepostNote(null);
    try {
      await api.post(`/accounting/paychecks/${refId}/repost-gl`, {});
      setRepostNote(`Ledger lines for ${refId} were rebuilt from the paycheck.`);
      load();
    } catch (err) {
      setRepostNote(err instanceof ApiError
        ? `${refId}: ${err.message}`
        : `${refId}: could not repost — open it under Accounting → Paychecks instead.`);
    } finally {
      setReposting(null);
    }
  }

  if (!clientId) return <p className="muted" style={{ padding: 16 }}>Choose a client to run a trial balance.</p>;
  if (error) return <ErrorBanner error={error} />;
  if (loading || !data) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div className="command-panel">
      <div className="command-panel-header">
        <div>
          <h2 className="command-panel-title">Trial Balance</h2>
          <div className="command-panel-note">
            {wholeHistory ? "All general-ledger activity to date" : `${from} to ${to}`}
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
          <input type="checkbox" checked={wholeHistory} onChange={(e) => setWholeHistory(e.target.checked)} />
          Whole history
        </label>
      </div>

      <div style={{ padding: 16 }}>
        <div
          className="card"
          style={{
            padding: 14,
            marginBottom: 14,
            borderLeft: `4px solid ${data.inBalance ? "var(--teal)" : "var(--red)"}`,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
            {data.inBalance ? "In balance" : `Out of balance by ${fmtMoney(Math.abs(data.totals.difference))}`}
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            Debits {fmtMoney(data.totals.debits)} · Credits {fmtMoney(data.totals.credits)}
            {data.inBalance
              ? " — every entry's debits and credits agree."
              : " — one or more entries posted only part of their lines."}
          </div>
          {!data.inBalance && (
            <div style={{ fontSize: 12.5, marginTop: 10, lineHeight: 1.55 }}>
              <strong>How to fix:</strong> each entry listed below wrote some of its ledger lines but not all of them.
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                <li><strong>Payroll entries</strong> — click <em>Repost lines</em> on the row. The missing lines are rebuilt from the paycheck automatically. If the paycheck itself is test data you no longer want, delete it under Accounting → Payroll instead.</li>
                <li><strong>Manual journal entries</strong> — open the entry under Accounting → Manual JE, edit it, and save it with matching debit and credit totals (or delete it).</li>
                <li><strong>Sales entries</strong> — open the sale under Accounting → Sales, edit and re-save it, or delete it.</li>
              </ul>
              <div className="muted" style={{ marginTop: 6 }}>Click any row below to see its posted lines in the General Ledger. Re-run this report after each fix — the total updates immediately.</div>
            </div>
          )}
        </div>

        {repostNote && (
          <div className="card" style={{ marginBottom: 12, fontSize: 13, borderColor: "var(--teal)" }}>{repostNote}</div>
        )}

        {data.unbalancedEntries.length > 0 && (
          <>
            <SectionLabel>Entries that do not balance</SectionLabel>
            <div className="table-scroll" style={{ marginBottom: 16 }}>
              <table>
                <thead><tr><th scope="col">Reference</th><th scope="col">Source</th><th scope="col" style={{ textAlign: "right" }}>Debits</th><th scope="col" style={{ textAlign: "right" }}>Credits</th><th scope="col" style={{ textAlign: "right" }}>Difference</th><th scope="col"></th></tr></thead>
                <tbody>
                  {data.unbalancedEntries.map((e) => (
                    <tr key={e.ref} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => openInLedger(`&ref=${encodeURIComponent(e.ref)}`)} onKeyDown={(e2) => { if (e2.key === "Enter" || e2.key === " ") { e2.preventDefault(); openInLedger(`&ref=${encodeURIComponent(e.ref)}`); } }}>
                      <td><code style={{ fontSize: 12 }}>{e.ref}</code></td>
                      <td className="muted">{e.source}</td>
                      <td style={{ textAlign: "right" }}>{fmtMoney(e.debits)}</td>
                      <td style={{ textAlign: "right" }}>{fmtMoney(e.credits)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: "var(--red)" }}>{fmtMoney(e.difference)}</td>
                      <td style={{ whiteSpace: "nowrap" }} onClick={(ev) => ev.stopPropagation()}>
                        {String(e.source).toLowerCase() === "payroll" && (
                          <button type="button" className="btn btn-sm btn-primary" disabled={reposting === e.ref} onClick={() => handleRepost(e.ref)}>
                            {reposting === e.ref ? "Reposting…" : "Repost lines"}
                          </button>
                        )}{" "}
                        <button type="button" className="btn btn-sm" onClick={() => openInLedger(`&ref=${encodeURIComponent(e.ref)}`)}>View lines</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <SectionLabel>Accounts</SectionLabel>
        <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">Account</th><th scope="col" style={{ textAlign: "right" }}>Debits</th><th scope="col" style={{ textAlign: "right" }}>Credits</th><th scope="col" style={{ textAlign: "right" }}>Balance</th></tr></thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.account} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => openInLedger(`&account=${encodeURIComponent(a.account)}`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openInLedger(`&account=${encodeURIComponent(a.account)}`); } }}>
                  <td>
                    <div>{a.account}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{a.lineCount} line(s)</div>
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(a.debits)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(a.credits)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtMoney(a.balance)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 800 }}>Total</td>
                <td style={{ textAlign: "right", fontWeight: 800 }}>{fmtMoney(data.totals.debits)}</td>
                <td style={{ textAlign: "right", fontWeight: 800 }}>{fmtMoney(data.totals.credits)}</td>
                <td style={{ textAlign: "right", fontWeight: 800 }}>{fmtMoney(data.totals.difference)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {data.accounts.length === 0 && (
          <p className="muted" style={{ padding: 16, textAlign: "center" }}>No general-ledger activity for this client.</p>
        )}
      </div>
    </div>
  );
}
