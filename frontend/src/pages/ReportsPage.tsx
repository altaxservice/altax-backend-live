import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, viewFile, downloadFile } from "../api/client";
import type { Client } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useSelectedClient } from "../context/SelectedClientContext";
import { CLIENT_MESSAGE_HANDOFF_KEY } from "./CommunicationsPage";

const TABS = ["Firm Overview", "P&L", "Balance Sheet", "Payroll", "Client Message"] as const;
type Tab = (typeof TABS)[number];

/** Maps each client-scoped tab to its backend PDF path segment (reports.routes.ts /reports/pdf/:segment/:clientId) — null where no PDF exists (Firm Overview). */
const REPORT_PDF_SEGMENT: Record<Tab, string | null> = {
  "Firm Overview": null, "P&L": "pl", "Balance Sheet": "balance-sheet", "Payroll": "payroll", "Client Message": "client-message",
};
/** Same idea for CSV exports — only the ledger-backed tabs have raw rows worth exporting. */
const REPORT_CSV_SEGMENT: Partial<Record<Tab, string>> = { "P&L": "gl", "Balance Sheet": "gl", "Payroll": "payroll" };

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
  activeClientCount: number;
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
    if (user?.role !== "admin" || tab !== "Firm Overview") return;
    api.get<FirmSummary>("/reports/firm-summary?months=6").then(setFirmSummary).catch(() => setFirmError("Could not load firm overview."));
  }, [user, tab]);

  useEffect(() => {
    if (!clientId || tab !== "Payroll") return;
    setPayrollLoading(true);
    api.get<{ paychecks: ReportPaycheck[] }>(`/accounting/paychecks/${clientId}`)
      .then((r) => setPaychecks(r.paychecks))
      .catch(() => setPaychecks([]))
      .finally(() => setPayrollLoading(false));
  }, [clientId, tab]);

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
    const key = `firm-${mode}`;
    setReportBusy(key);
    try {
      const path = "/reports/pdf/firm-overview?months=6";
      if (mode === "view") await viewFile(path);
      else await downloadFile(path, "FirmOverview_6mo.pdf");
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this report.");
    } finally {
      setReportBusy(null);
    }
  }

  async function handleFirmOverviewCsv() {
    setReportBusy("firm-csv");
    try {
      await downloadFile("/reports/csv/firm-overview?months=6", "FirmOverview_6mo.csv");
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

      {tab === "Firm Overview" && user?.role === "admin" && (
        <>
          {firmError && <div className="error-banner">{firmError}</div>}
          {!firmSummary && !firmError && <div className="spinner-wrap">Loading…</div>}
          {firmSummary && (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 12 }}>
                <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handleFirmOverviewPrint("view")}>
                  {reportBusy === "firm-view" ? "Opening…" : "Print Report"}
                </button>
                <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handleFirmOverviewPrint("download")}>
                  {reportBusy === "firm-download" ? "Generating…" : "Download PDF"}
                </button>
                <button type="button" className="btn" disabled={reportBusy !== null} onClick={handleFirmOverviewCsv}>
                  {reportBusy === "firm-csv" ? "Exporting…" : "Export CSV"}
                </button>
              </div>
              <div className="metric-grid" style={{ marginBottom: 20 }}>
                <div className="metric"><div className="metric-label">Revenue (6 mo)</div><div className="metric-value">{fmtMoney(firmSummary.totals.revenue)}</div></div>
                <div className="metric"><div className="metric-label">Expenses (6 mo)</div><div className="metric-value">{fmtMoney(firmSummary.totals.expenses)}</div></div>
                <div className="metric"><div className="metric-label">Net Profit (6 mo)</div><div className="metric-value">{fmtMoney(firmSummary.totals.profit)}</div></div>
                <div className="metric"><div className="metric-label">Unpaid Balance</div><div className="metric-value">{fmtMoney(firmSummary.unpaidBalance)}</div></div>
              </div>
              <div className="command-panel">
                <div className="command-panel-header">
                  <h2 className="command-panel-title">Monthly Trend</h2>
                  <div className="command-panel-note">{firmSummary.activeClientCount} active clients · {firmSummary.unpaidInvoiceCount} unpaid invoices</div>
                </div>
                <table>
                  <thead><tr><th>Month</th><th>Revenue</th><th>Expenses</th><th>Profit</th></tr></thead>
                  <tbody>
                    {firmSummary.months.map((m) => (
                      <tr key={m.month}>
                        <td>{m.month}</td>
                        <td>{fmtMoney(m.revenue)}</td>
                        <td className="muted">{fmtMoney(m.expenses)}</td>
                        <td style={{ fontWeight: 700, color: m.profit >= 0 ? "var(--teal)" : "var(--red)" }}>{fmtMoney(m.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {tab !== "Firm Overview" && (
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
                    <div className="command-panel-note">Financial statements are generated from general-ledger activity for the selected period.</div>
                  </div>
                  {REPORT_PDF_SEGMENT[tab] && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn" disabled={reportBusy !== null} onClick={() => handlePrintReport("view")}>
                        {reportBusy === `${REPORT_PDF_SEGMENT[tab]}-view` ? "Opening…" : "Print Report"}
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
              <div className="command-panel">
                <div className="command-panel-header"><h2 className="command-panel-title">Checks</h2><div className="command-panel-note">{filteredPaychecks.length} in period</div></div>
                {filteredPaychecks.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No paychecks in this period.</p>}
                {filteredPaychecks.length > 0 && (
                  <table>
                    <thead><tr><th>Date</th><th>Employee</th><th>Gross</th><th>Net</th></tr></thead>
                    <tbody>
                      {filteredPaychecks.map((p) => (
                        <tr key={p.paycheck_id}><td>{p.pay_date ? String(p.pay_date).slice(0, 10) : "—"}</td><td>{p.employee}</td><td>{fmtMoney(p.gross_wages)}</td><td>{fmtMoney(p.net_pay)}</td></tr>
                      ))}
                    </tbody>
                  </table>
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
              {messageError && <div className="error-banner" style={{ margin: 16 }}>{messageError}</div>}
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
