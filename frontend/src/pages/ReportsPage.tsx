import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, viewFile, downloadFile } from "../api/client";
import type { Client } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useSelectedClient } from "../context/SelectedClientContext";
import { CLIENT_MESSAGE_HANDOFF_KEY } from "./CommunicationsPage";
import { ErrorBanner } from "../components/ErrorBanner";

const TABS = ["Firm Overview", "P&L", "Balance Sheet", "Trial Balance", "Sales & Tax", "Payroll", "Client Message"] as const;
type Tab = (typeof TABS)[number];

/** Maps each client-scoped tab to its backend PDF path segment (reports.routes.ts /reports/pdf/:segment/:clientId) — null where no PDF exists (Firm Overview). */
const REPORT_PDF_SEGMENT: Record<Tab, string | null> = {
  // Trial Balance is an on-screen integrity check, not a client deliverable — no PDF.
  "Firm Overview": null, "P&L": "pl", "Balance Sheet": "balance-sheet", "Trial Balance": null,
  "Sales & Tax": "sales-tax", "Payroll": "payroll", "Client Message": "client-message",
};
/** Same idea for CSV exports — only the ledger-backed tabs have raw rows worth exporting. */
const REPORT_CSV_SEGMENT: Partial<Record<Tab, string>> = { "P&L": "gl", "Balance Sheet": "gl", "Sales & Tax": "sales-tax", "Payroll": "payroll" };

interface SalesTaxReport {
  byCategory: { categoryName: string; state: string | null; rate: number; taxableAmount: number; taxAmount: number }[];
  sales: { saleId: string; saleDate: string | null; grossSales: number; totalTaxDue: number; adjustments: number }[];
  totals: { grossSales: number; taxDue: number; adjustments: number; saleCount: number };
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
const ASSET_HINTS = ["cash", "asset", "bank"];
const LIABILITY_HINTS = ["payable", "liability", "tax payable"];

export function ReportsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { clientId: globalClientId, setSelectedClient } = useSelectedClient();
  const [tab, setTab] = useState<Tab>("Firm Overview");
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
  const [salesTaxReport, setSalesTaxReport] = useState<SalesTaxReport | null>(null);
  const [salesTaxLoading, setSalesTaxLoading] = useState(false);
  const [salesTaxError, setSalesTaxError] = useState<string | null>(null);
  const [periodMessage, setPeriodMessage] = useState<{ subject: string; body: string; bodyArabic: string } | null>(null);
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reportBusy, setReportBusy] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => {});
  }, []);

  useEffect(() => {
    if (user?.role !== "admin" || tab !== "Firm Overview" || !clientId) return;
    setFirmSummary(null);
    setFirmError(null);
    api.get<FirmSummary>(`/reports/firm-summary?months=6&clientId=${encodeURIComponent(clientId)}`)
      .then(setFirmSummary)
      .catch(() => setFirmError("Could not load this client's overview."));
  }, [user, tab, clientId]);

  useEffect(() => {
    if (!clientId || tab !== "Payroll") return;
    setPayrollLoading(true);
    api.get<{ paychecks: ReportPaycheck[] }>(`/accounting/paychecks/${clientId}`)
      .then((r) => setPaychecks(r.paychecks))
      .catch(() => setPaychecks([]))
      .finally(() => setPayrollLoading(false));
  }, [clientId, tab]);

  useEffect(() => {
    if (!clientId || tab !== "Sales & Tax") return;
    setSalesTaxLoading(true);
    setSalesTaxError(null);
    api.get<SalesTaxReport>(`/reports/sales-tax/${clientId}?from=${from}&to=${to}`)
      .then(setSalesTaxReport)
      .catch((err) => { setSalesTaxReport(null); setSalesTaxError(err instanceof ApiError ? err.message : "Could not load the sales & tax report."); })
      .finally(() => setSalesTaxLoading(false));
  }, [clientId, tab, from, to]);

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

  useEffect(() => {
    if (!clientId) return;
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

  function bucketFor(account: string): "income" | "cogs" | "expense" | "asset" | "liability" | "other" {
    const a = String(account || "").toLowerCase();
    if (INCOME_TYPES.some((t) => a.includes(t.toLowerCase()))) return "income";
    if (COGS_TYPES.some((t) => a.includes(t.toLowerCase()))) return "cogs";
    if (LIABILITY_HINTS.some((t) => a.includes(t))) return "liability";
    if (ASSET_HINTS.some((t) => a.includes(t))) return "asset";
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

  const assets = Array.from(byAccount.entries()).filter(([acct]) => bucketFor(acct) === "asset");
  const liabilities = Array.from(byAccount.entries()).filter(([acct]) => bucketFor(acct) === "liability");
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

  function handleClientChange(id: string) {
    setClientId(id);
    setSelectedClient(id || null, clients.find((c) => c.client_id === id)?.client_name);
  }

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

  async function handlePrintReport(mode: "view" | "download") {
    const segment = REPORT_PDF_SEGMENT[tab];
    if (!segment || !clientId) return;
    const key = `${segment}-${mode}`;
    setReportBusy(key);
    try {
      const path = `/reports/pdf/${segment}/${clientId}?from=${from}&to=${to}`;
      if (mode === "view") await viewFile(path);
      else await downloadFile(path, `${tab.replace(/[^A-Za-z0-9]+/g, "")}_${clientId}_${from}_${to}.pdf`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this report.");
    } finally {
      setReportBusy(null);
    }
  }

  async function handleExportCsv() {
    const segment = REPORT_CSV_SEGMENT[tab];
    if (!segment || !clientId) return;
    setReportBusy("csv");
    try {
      await downloadFile(`/reports/csv/${segment}/${clientId}?from=${from}&to=${to}`, `${segment}_${clientId}_${from}_${to}.csv`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not export this data.");
    } finally {
      setReportBusy(null);
    }
  }

  async function handleFirmOverviewPrint(mode: "view" | "download") {
    if (!clientId) return;
    const key = `firm-${mode}`;
    setReportBusy(key);
    try {
      const path = `/reports/pdf/firm-overview?months=6&clientId=${encodeURIComponent(clientId)}`;
      if (mode === "view") await viewFile(path);
      else await downloadFile(path, `Overview_${clientId}_6mo.pdf`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this report.");
    } finally {
      setReportBusy(null);
    }
  }

  async function handleFirmOverviewCsv() {
    if (!clientId) return;
    setReportBusy("firm-csv");
    try {
      await downloadFile(`/reports/csv/firm-overview?months=6&clientId=${encodeURIComponent(clientId)}`, `Overview_${clientId}_6mo.csv`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not export this data.");
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
        clientId, subject: periodMessage.subject, messageEnglish: periodMessage.body,
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
      subject: periodMessage.subject, body: periodMessage.body, periodStart: from, periodEnd: to,
    }));
    setSelectedClient(clientId, client.client_name);
    navigate("/communications");
  }

  const visibleTabs = user?.role === "admin" ? TABS : TABS.filter((t) => t !== "Firm Overview");

  return (
    <div>
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)", marginBottom: 20 }}>
        {visibleTabs.map((t) => (
          <div key={t} onClick={() => setTab(t)} style={{ padding: "10px 16px", fontSize: 14, fontWeight: 500, cursor: "pointer", color: tab === t ? "var(--ink)" : "var(--muted)", borderBottom: tab === t ? "2px solid var(--teal)" : "2px solid transparent" }}>{t}</div>
        ))}
      </div>

      <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <div className="field" style={{ maxWidth: 320, margin: 0 }}>
              <label htmlFor="rep-client">Client</label>
              <select id="rep-client" value={clientId} onChange={(e) => handleClientChange(e.target.value)}>
                <option value="">Select a client…</option>
                {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "end" }}>
              <div className="field" style={{ margin: 0 }}><label>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="field" style={{ margin: 0 }}><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          </div>

          {!clientId && <p className="muted">Pick a client to generate their financial reports.</p>}

          {clientId && client && (
            <>
              <div className="command-panel" style={{ marginBottom: 16 }}>
                <div className="command-panel-header" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <h2 className="command-panel-title">{client.client_name}</h2>
                    <div className="command-panel-note">
                      {tab === "Firm Overview" ? "Revenue/expense trend from general-ledger activity, last 6 months." : "Financial statements are generated from general-ledger activity for the selected period."}
                    </div>
                  </div>
                  {/* "Preview / Print" rather than the old "Print Report": this opens the
                      real generated PDF in a new tab, where it can be read first and printed
                      from the browser — it never printed directly, so the old label undersold
                      it as a preview step and the user asked for one explicitly. */}
                  {tab === "Firm Overview" ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handleFirmOverviewPrint("view")}>
                        {reportBusy === "firm-view" ? "Opening…" : "Preview / Print"}
                      </button>
                      <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handleFirmOverviewPrint("download")}>
                        {reportBusy === "firm-download" ? "Generating…" : "Download PDF"}
                      </button>
                      <button type="button" className="btn" disabled={reportBusy !== null} onClick={handleFirmOverviewCsv}>
                        {reportBusy === "firm-csv" ? "Exporting…" : "Export CSV"}
                      </button>
                    </div>
                  ) : REPORT_PDF_SEGMENT[tab] && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handlePrintReport("view")}>
                        {reportBusy === `${REPORT_PDF_SEGMENT[tab]}-view` ? "Opening…" : "Preview / Print"}
                      </button>
                      <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handlePrintReport("download")}>
                        {reportBusy === `${REPORT_PDF_SEGMENT[tab]}-download` ? "Generating…" : "Download PDF"}
                      </button>
                      {REPORT_CSV_SEGMENT[tab] && (
                        <button type="button" className="btn" disabled={reportBusy !== null} onClick={handleExportCsv}>
                          {reportBusy === "csv" ? "Exporting…" : "Export CSV"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {tab === "Firm Overview" && (
                <>
                  {firmError && <ErrorBanner error={firmError} />}
                  {!firmSummary && !firmError && <div className="spinner-wrap">Loading…</div>}
                  {firmSummary && (
                    <>
                      <div className="metric-grid" style={{ marginBottom: 20 }}>
                        <div className="metric"><div className="metric-label">Revenue (6 mo)</div><div className="metric-value">{fmtMoney(firmSummary.totals.revenue)}</div></div>
                        <div className="metric"><div className="metric-label">Expenses (6 mo)</div><div className="metric-value">{fmtMoney(firmSummary.totals.expenses)}</div></div>
                        <div className="metric"><div className="metric-label">Net Profit (6 mo)</div><div className="metric-value">{fmtMoney(firmSummary.totals.profit)}</div></div>
                        <div className="metric"><div className="metric-label">Unpaid Balance</div><div className="metric-value">{fmtMoney(firmSummary.unpaidBalance)}</div></div>
                      </div>
                      <div className="command-panel">
                        <div className="command-panel-header">
                          <h2 className="command-panel-title">Monthly Trend</h2>
                          <div className="command-panel-note">Click a month to open its P&amp;L · {firmSummary.unpaidInvoiceCount} unpaid invoice{firmSummary.unpaidInvoiceCount === 1 ? "" : "s"}</div>
                        </div>
                        <div className="table-scroll">
                        <table>
                          <thead><tr><th>Month</th><th>Revenue</th><th>Expenses</th><th>Profit</th></tr></thead>
                          <tbody>
                            {/* Clicking a month sets the period to that month and jumps to P&L —
                                the row's numbers are a roll-up, so "show me the detail behind
                                this" means the account-level statement for the same window. */}
                            {firmSummary.months.map((m) => (
                              <tr key={m.month} style={{ cursor: "pointer" }} onClick={() => openMonthDetail(m.month)}>
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
                  <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Sales Tax</div><div className="metric-value">{fmtMoney(salesTax)}</div></div>
                  <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Payroll Gross</div><div className="metric-value">{fmtMoney(payrollGross)}</div></div>
                  <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Net Income</div><div className="metric-value">{fmtMoney(netIncome)}</div></div>
                  <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">GL Entries</div><div className="metric-value">{filtered.length}</div></div>
                </div>
                <div className="table-scroll">
                <table>
                  <thead><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead>
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
                    <div className="metric"><div className="metric-label">Gross Sales</div><div className="metric-value">{fmtMoney(salesTaxReport.totals.grossSales)}</div></div>
                    <div className="metric"><div className="metric-label">Total Tax Due</div><div className="metric-value">{fmtMoney(salesTaxReport.totals.taxDue)}</div></div>
                    <div className="metric"><div className="metric-label">Adjustments</div><div className="metric-value">{fmtMoney(salesTaxReport.totals.adjustments)}</div></div>
                    <div className="metric"><div className="metric-label">Sales Recorded</div><div className="metric-value">{salesTaxReport.totals.saleCount}</div></div>
                  </div>

                  <div className="command-panel" style={{ marginBottom: 16 }}>
                    <div className="command-panel-header">
                      <h2 className="command-panel-title">Tax by Category</h2>
                      <div className="command-panel-note">What each filing box needs</div>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead><tr><th>Category</th><th>State</th><th>Rate</th><th>Taxable Sales</th><th>Tax</th></tr></thead>
                        <tbody>
                          {/* Every row here is a real record elsewhere — categories
                              live in Accounting → Tax Rates, sales in the Sales tab. */}
                          {salesTaxReport.byCategory.map((c, i) => (
                            <tr
                              key={`${c.categoryName}-${i}`}
                              style={{ cursor: "pointer" }}
                              title={`Open ${c.categoryName} in Accounting → Tax Rates`}
                              onClick={() => navigate(`/accounting?tab=${encodeURIComponent("Tax Rates")}`)}
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

                  <div className="command-panel">
                    <div className="command-panel-header">
                      <h2 className="command-panel-title">Sales Recorded ({salesTaxReport.sales.length})</h2>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead><tr><th>Date</th><th>Gross Sales</th><th>Adjustments</th><th>Tax Due</th></tr></thead>
                        <tbody>
                          {salesTaxReport.sales.map((s) => (
                            <tr
                              key={s.saleId}
                              style={{ cursor: "pointer" }}
                              title="Open this sale in Accounting → Sales"
                              onClick={() => navigate(`/accounting?tab=${encodeURIComponent("Sales")}`)}
                            >
                              <td>{s.saleDate ? String(s.saleDate).slice(0, 10) : "—"}</td>
                              <td>{fmtMoney(s.grossSales)}</td>
                              <td className="muted">{fmtMoney(s.adjustments)}</td>
                              <td>{fmtMoney(s.totalTaxDue)}</td>
                            </tr>
                          ))}
                          {salesTaxReport.sales.length === 0 && (
                            <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 16 }}>No sales recorded in this period.</td></tr>
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
                <div className="metric"><div className="metric-label">Gross Wages</div><div className="metric-value">{fmtMoney(payrollGrossWages)}</div></div>
                <div className="metric"><div className="metric-label">Checks</div><div className="metric-value">{filteredPaychecks.length}</div></div>
                <div className="metric"><div className="metric-label">Employee Taxes</div><div className="metric-value">{fmtMoney(payrollEmployeeTaxes)}</div></div>
                <div className="metric"><div className="metric-label">Employer Taxes</div><div className="metric-value">{fmtMoney(payrollEmployerTaxes)}</div></div>
                <div className="metric"><div className="metric-label">Net Pay</div><div className="metric-value">{fmtMoney(payrollNetPay)}</div></div>
                <div className="metric"><div className="metric-label">Total Payroll Cost</div><div className="metric-value">{fmtMoney(payrollTotalCost)}</div></div>
              </div>
              <div className="command-panel" style={{ marginBottom: 16 }}>
                <div className="command-panel-header"><h2 className="command-panel-title">Payroll Tax Summary</h2><div className="command-panel-note">{from} – {to}</div></div>
                <div className="table-scroll">
                <table>
                  <thead><tr><th>Tax</th><th>Employee</th><th>Employer</th><th>Total</th></tr></thead>
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
                    <thead><tr><th>Date</th><th>Employee</th><th>Gross</th><th>Net</th></tr></thead>
                    <tbody>
                      {filteredPaychecks.map((p) => (
                        <tr
                          key={p.paycheck_id}
                          style={{ cursor: "pointer" }}
                          onClick={() => navigate(`/accounting?client=${encodeURIComponent(clientId)}&tab=Paychecks`)}
                        ><td>{p.pay_date ? String(p.pay_date).slice(0, 10) : "—"}</td><td>{p.employee}</td><td>{fmtMoney(p.gross_wages)}</td><td>{fmtMoney(p.net_pay)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
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
              {messageLoading && <div className="spinner-wrap">Loading…</div>}
              {messageError && <ErrorBanner error={messageError} style={{ margin: 16 }} />}
              {!messageLoading && periodMessage && (
                <div style={{ padding: 16 }}>
                  <div className="field"><label>Subject</label><input readOnly value={periodMessage.subject} /></div>
                  <div style={{ display: "grid", gridTemplateColumns: periodMessage.bodyArabic ? "1fr 1fr" : "1fr", gap: 16, margin: "12px 0 16px" }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6 }}>English</div>
                      <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 16, background: "#fff", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 420, overflowY: "auto" }}>
                        {periodMessage.body}
                      </div>
                    </div>
                    {periodMessage.bodyArabic && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6 }}>العربية (Arabic)</div>
                        <div dir="rtl" style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 16, background: "#fff", fontSize: 13, lineHeight: 1.8, whiteSpace: "pre-wrap", maxHeight: 420, overflowY: "auto", textAlign: "right" }}>
                          {periodMessage.bodyArabic}
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="muted" style={{ fontSize: 11, marginBottom: 12 }}>
                    Print Report/Download PDF above renders the English text only — reliable Arabic PDF rendering needs proper right-to-left glyph shaping this app doesn't yet do. Emailed/SMS/WhatsApp sends (via Open Communications to Send) use the full bilingual text shown here.
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
            </>
          )}
        </>
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
function TrialBalanceTab({ clientId, from, to }: { clientId: string; from: string; to: string }) {
  const navigate = useNavigate();
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
   * A paycheck's ledger lines are always rebuilt in full when the paycheck is
   * re-saved — so for a half-posted Payroll entry, an empty edit is a complete
   * repair. This turns "one or more entries posted only part of their lines"
   * from a diagnosis into a button.
   */
  async function handleRepost(refId: string) {
    if (!confirm(`Repost all ledger lines for ${refId} from its paycheck? The paycheck itself is not changed.`)) return;
    setReposting(refId);
    setRepostNote(null);
    try {
      await api.patch(`/accounting/paychecks/${refId}`, {});
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
            borderLeft: `4px solid ${data.inBalance ? "var(--teal, #2f7d6f)" : "#c0392b"}`,
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
                <thead><tr><th>Reference</th><th>Source</th><th style={{ textAlign: "right" }}>Debits</th><th style={{ textAlign: "right" }}>Credits</th><th style={{ textAlign: "right" }}>Difference</th><th></th></tr></thead>
                <tbody>
                  {data.unbalancedEntries.map((e) => (
                    <tr key={e.ref} style={{ cursor: "pointer" }} onClick={() => openInLedger(`&ref=${encodeURIComponent(e.ref)}`)}>
                      <td><code style={{ fontSize: 12 }}>{e.ref}</code></td>
                      <td className="muted">{e.source}</td>
                      <td style={{ textAlign: "right" }}>{fmtMoney(e.debits)}</td>
                      <td style={{ textAlign: "right" }}>{fmtMoney(e.credits)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: "#c0392b" }}>{fmtMoney(e.difference)}</td>
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
            <thead><tr><th>Account</th><th style={{ textAlign: "right" }}>Debits</th><th style={{ textAlign: "right" }}>Credits</th><th style={{ textAlign: "right" }}>Balance</th></tr></thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.account} style={{ cursor: "pointer" }} onClick={() => openInLedger(`&account=${encodeURIComponent(a.account)}`)}>
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
