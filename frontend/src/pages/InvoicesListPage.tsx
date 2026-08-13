import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, downloadFile, viewFile, buildFilename } from "../api/client";
import type { Invoice, Payment, RecurringBilling } from "../api/types2";
import type { Client } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useLanguage, Num } from "../context/LanguageContext";
import { StatusBadge } from "../components/StatusBadge";
import { ActionMenu } from "../components/ActionMenu";
import { FilterBar, exportCsv, activeViewDates } from "../components/FilterBar";
import { useToast } from "../components/Toast";
import { useSelectedClient } from "../context/SelectedClientContext";
import { fmtDateOnly as fmtDate, daysUntil } from "../utils/date";
import { InvoiceEditorModal } from "../components/InvoiceEditorModal";
import { AddRecurringModal } from "../components/AddRecurringModal";
import { MANUAL_PROFILE, PaymentProfileField } from "../components/PaymentProfileField";
import { ErrorBanner } from "../components/ErrorBanner";
import { useConfirm, usePrompt, useNotify } from "../components/ConfirmProvider";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

export { MANUAL_PROFILE, PaymentProfileField } from "../components/PaymentProfileField";

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

export const METHODS = ["Cash", "Check", "Zelle", "Card", "ACH", "Wire", "Other"];
export const ACCOUNT_TYPES = ["Checking", "Savings"];
export const INVOICE_STATUSES = ["Unpaid", "Partial", "Paid", "Void"];

interface TaxRow {
  task_id: string; task_name: string; client_id: string; client_name: string;
  agency_due_date: string | null; paid_date: string | null; payment_amount: string | number | null;
  confirmation_number: string | null; status: string; assigned_to: string | null;
}

export function InvoicesListPage() {
  const { user } = useAuth();
  const { t, dir } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const clientIdFilter = searchParams.get("clientId") || null;
  const toast = useToast();
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();
  const notify = useNotify();
  const { setSelectedClient } = useSelectedClient();

  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [schedules, setSchedules] = useState<RecurringBilling[] | null>(null);
  const [firmPayments, setFirmPayments] = useState<Payment[] | null>(null);
  const [taxRows, setTaxRows] = useState<TaxRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [period, setPeriod] = useState(activeViewDates());
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [showCreateInvoice, setShowCreateInvoice] = useState(false);
  const [showSalesReceipt, setShowSalesReceipt] = useState(false);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [recurringModal, setRecurringModal] = useState<{ editing?: Partial<RecurringBilling> } | null>(null);
  const [running, setRunning] = useState(false);

  const taxTrackingRef = useRef<HTMLDivElement>(null);
  const [statementClientId, setStatementClientId] = useState("");
  const [statementStart, setStatementStart] = useState("");
  const [statementEnd, setStatementEnd] = useState("");
  const [printingStatement, setPrintingStatement] = useState(false);
  const [viewingStatement, setViewingStatement] = useState(false);

  const canManage = user?.role === "admin" || user?.role === "staff";
  const isAdmin = user?.role === "admin";

  function loadInvoices(): Promise<void> {
    return api.get<{ invoices: Invoice[] }>("/billing/invoices").then((r) => setInvoices(r.invoices)).catch((err) => setError(err instanceof ApiError ? err.message : "Could not load invoices."));
  }
  function loadSchedules(): Promise<void> {
    return canManage ? api.get<{ schedules: RecurringBilling[] }>("/billing/recurring").then((r) => setSchedules(r.schedules)).catch(() => {}) : Promise.resolve();
  }
  function loadFirmPayments(): Promise<void> {
    if (!canManage) return Promise.resolve();
    const qs = `?start=${period.start}&end=${period.end}`;
    return api.get<{ payments: Payment[] }>(`/billing/payments${qs}`).then((r) => setFirmPayments(r.payments)).catch(() => {});
  }
  function loadTaxRows(): Promise<void> {
    if (user?.role === "employee") return Promise.resolve();
    const qs = canManage ? `?start=${period.start}&end=${period.end}` : "";
    return api.get<{ rows: TaxRow[] }>(`/billing/client-tax-payments${qs}`).then((r) => setTaxRows(r.rows)).catch(() => {});
  }
  function loadAll(): Promise<void> {
    return Promise.all([loadInvoices(), loadSchedules(), loadFirmPayments(), loadTaxRows()]).then(() => {});
  }

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { loadFirmPayments(); loadTaxRows(); }, [period.start, period.end]);
  useEffect(() => {
    if (canManage) api.get<{ clients: Client[] }>("/clients").then((res) => setClients(res.clients)).catch(() => {});
  }, [canManage]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await loadAll();
      toast("Data refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  function statementPath() {
    const params = new URLSearchParams();
    if (statementStart) params.set("start", statementStart);
    if (statementEnd) params.set("end", statementEnd);
    const qs = params.toString();
    return `/billing/clients/${statementClientId}/statement${qs ? `?${qs}` : ""}`;
  }

  async function handleViewStatement() {
    if (!statementClientId) return;
    setViewingStatement(true);
    try {
      await viewFile(statementPath());
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not generate this statement.");
    } finally {
      setViewingStatement(false);
    }
  }

  async function handlePrintStatement() {
    if (!statementClientId) return;
    setPrintingStatement(true);
    try {
      await downloadFile(statementPath(), buildFilename([clientName(statementClientId), "Statement"], "pdf"));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not generate this statement.");
    } finally {
      setPrintingStatement(false);
    }
  }

  async function handleRunDue() {
    setRunning(true);
    try {
      const res = await api.post<{ created: any[]; skipped: number; errors: string[] }>("/billing/recurring/run", {});
      const emailAttempts = res.created.filter((c) => c.emailSent || c.emailSkippedReason);
      const emailSent = emailAttempts.filter((c) => c.emailSent).length;
      const emailFailed = emailAttempts.length - emailSent;
      const emailSummary = emailAttempts.length ? ` ${emailSent} auto-email(s) sent${emailFailed ? `, ${emailFailed} failed` : ""}.` : "";
      toast(`Created ${res.created.length} invoice(s), skipped ${res.skipped}.${res.errors.length ? ` ${res.errors.length} error(s).` : ""}${emailSummary}`);
      loadAll();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not run recurring billing.");
    } finally {
      setRunning(false);
    }
  }

  async function handleVoid(invoiceId: string) {
    const ok = await confirmDialog({ title: "Void invoice", message: "This cannot be undone.", confirmLabel: "Void", danger: true });
    if (!ok) return;
    try {
      await api.post(`/billing/invoices/${invoiceId}/void`, {});
      toast("Invoice voided.");
      loadAll();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not void this invoice.");
    }
  }

  async function handleDelete(invoiceId: string) {
    const confirmValue = await promptFor({
      title: "Permanently delete invoice",
      message: `Invoice ${invoiceId} — this cannot be undone. Type DELETE INVOICE to confirm.`,
      placeholder: "DELETE INVOICE",
    });
    if (confirmValue === null) return;
    try {
      await api.post(`/billing/invoices/${invoiceId}/delete`, { confirm: confirmValue });
      toast("Invoice deleted.");
      loadAll();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this invoice.");
    }
  }

  async function handleArchiveSchedule(id: string) {
    const ok = await confirmDialog({ title: "Archive schedule", message: "It will stop creating future invoices.", confirmLabel: "Archive", danger: true });
    if (!ok) return;
    try {
      await api.post(`/billing/recurring/${id}/archive`, {});
      toast("Schedule archived.");
      loadSchedules();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not archive this schedule.");
    }
  }

  async function handleUseScheduleNow(id: string) {
    const ok = await confirmDialog({ title: "Create invoice now", message: "Create an invoice from this schedule right now?" });
    if (!ok) return;
    try {
      const res = await api.post<{ invoiceId: string }>(`/billing/recurring/${id}/run-now`, {});
      toast(`Invoice ${res.invoiceId} created.`);
      loadAll();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not run this schedule.");
    }
  }

  function handleDuplicateSchedule(s: RecurringBilling) {
    setRecurringModal({ editing: { ...s, recurring_billing_id: undefined, status: "Active" } });
  }

  async function handlePauseSchedule(id: string) {
    try {
      await api.post(`/billing/recurring/${id}/pause`, {});
      toast("Schedule paused.");
      loadSchedules();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not pause this schedule.");
    }
  }

  async function handleResumeSchedule(id: string) {
    try {
      await api.post(`/billing/recurring/${id}/resume`, {});
      toast("Schedule resumed.");
      loadSchedules();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not resume this schedule.");
    }
  }

  async function handleSkipNextDate(id: string) {
    const ok = await confirmDialog({ title: "Skip next occurrence", message: "No invoice will be created for that date." });
    if (!ok) return;
    try {
      await api.post(`/billing/recurring/${id}/skip`, {});
      toast("Next occurrence skipped.");
      loadSchedules();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not skip this schedule's next date.");
    }
  }

  async function handleDeleteSchedule(id: string) {
    const confirmValue = await promptFor({
      title: "Permanently delete schedule",
      message: "This cannot be undone. Type DELETE SCHEDULE to confirm.",
      placeholder: "DELETE SCHEDULE",
    });
    if (confirmValue === null) return;
    try {
      await api.post(`/billing/recurring/${id}/delete`, { confirm: confirmValue });
      toast("Schedule deleted.");
      loadSchedules();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this schedule.");
    }
  }

  const clientName = (id: string) => clients.find((c) => c.client_id === id)?.client_name || id;

  const filteredInvoices = useMemo(() => {
    if (!invoices) return [];
    let rows = invoices;
    if (clientIdFilter) rows = rows.filter((i) => i.client_id === clientIdFilter);
    if (statusFilter !== "all") rows = rows.filter((i) => i.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((i) => [i.invoice_id, clientName(i.client_id), i.description, i.total_amount].some((v) => String(v || "").toLowerCase().includes(q)));
    return rows;
  }, [invoices, clientIdFilter, statusFilter, search, clients]);

  const filteredSchedules = useMemo(() => {
    let rows = schedules || [];
    if (clientIdFilter) rows = rows.filter((s) => s.client_id === clientIdFilter);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((s) => [s.client_name, s.description, s.amount].some((v) => String(v || "").toLowerCase().includes(q)));
    return rows;
  }, [schedules, clientIdFilter, search]);

  const filteredFirmPayments = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return firmPayments || [];
    return (firmPayments || []).filter((p) => [p.payment_id, p.invoice_id, clientName(p.client_id as string), p.actual_amount].some((v) => String(v || "").toLowerCase().includes(q)));
  }, [firmPayments, search, clients]);

  // Shared by the KPI tile below AND the "Client Tax Payment Tracking" table
  // further down the page — the two used to compute this scoping separately
  // (the table used raw, unscoped `taxRows`), so the tile's count and the
  // table's own row count/contents could disagree while a client filter was
  // active. One computation, used in both places, so they can't drift apart.
  const scopedTaxRows = useMemo(
    () => (taxRows || []).filter((r) => !clientIdFilter || r.client_id === clientIdFilter),
    [taxRows, clientIdFilter]
  );

  const kpis = useMemo(() => {
    // Scoped to the same clientIdFilter as filteredInvoices/filteredFirmPayments
    // below the fold — otherwise these KPI tiles would show firm-wide totals
    // while the list under them shows only one client's rows, which reads as
    // the numbers not matching what's actually listed.
    const inv = (invoices || []).filter((i) => !clientIdFilter || i.client_id === clientIdFilter);
    const open = inv.filter((i) => !["paid", "void"].includes(String(i.status || "").toLowerCase()));
    const openBalance = open.reduce((sum, i) => sum + Number(i.balance_due || 0), 0);
    const overdue = open.filter((i) => (daysUntil(i.due_date) ?? 0) < 0);
    const overdueBalance = overdue.reduce((sum, i) => sum + Number(i.balance_due || 0), 0);
    const scopedFirmPayments = (firmPayments || []).filter((p) => !clientIdFilter || p.client_id === clientIdFilter);
    const paidThisPeriod = scopedFirmPayments.reduce((sum, p) => sum + Number(p.actual_amount || 0), 0);
    const unpaidTaxRows = scopedTaxRows.filter((r) => !r.paid_date);
    const clientTaxDue = unpaidTaxRows.reduce((sum, r) => sum + Number(r.payment_amount || 0), 0);
    return {
      openBalance, openCount: open.length,
      overdueBalance, overdueCount: overdue.length,
      paidThisPeriod, paidCount: scopedFirmPayments.length,
      clientTaxDue, taxCount: scopedTaxRows.length,
    };
  }, [invoices, firmPayments, scopedTaxRows, clientIdFilter]);

  function handleExport() {
    exportCsv("invoices.csv", [
      { key: "invoice_id", label: "Invoice" }, { key: "client_id", label: "Client" }, { key: "invoice_date", label: "Date" },
      { key: "due_date", label: "Due" }, { key: "description", label: "Description" }, { key: "total_amount", label: "Amount" },
      { key: "balance_due", label: "Balance" }, { key: "status", label: "Status" },
    ], filteredInvoices as unknown as Record<string, unknown>[]);
  }

  const ready = invoices !== null;

  return (
    <div dir={dir}>
      {/* No in-page h1 for any role — the topbar already reads "Billing"/"الفواتير". */}

      {clientIdFilter && (
        <div className="card" style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px" }}>
          <span>Showing invoices for <strong>{clientName(clientIdFilter)}</strong> only.</span>
          <button type="button" className="btn btn-sm" onClick={() => setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete("clientId"); return next; })}>Show all clients</button>
        </div>
      )}

      {canManage && (
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Invoice, client, description, amount…" }}
          selects={[{ label: "Status", value: statusFilter, options: INVOICE_STATUSES, onChange: setStatusFilter }]}
          period={{ start: period.start, end: period.end, onStartChange: (v) => setPeriod((p) => ({ ...p, start: v })), onEndChange: (v) => setPeriod((p) => ({ ...p, end: v })), onActiveView: () => setPeriod(activeViewDates()) }}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          onExportCsv={handleExport}
        />
      )}

      {error && <ErrorBanner error={error} style={{ marginTop: 12 }} />}

      {canManage && (
        <div className="portal-banner" style={{ margin: "16px 0" }}>
          <div className="topbar-eyebrow">Billing Workspace</div>
          <h2>Firm invoices and client tax payments</h2>
          <p>Firm invoices and invoice payments are separate from client tax payment tracking for the selected period.</p>
          <div className="quick-actions" style={{ marginTop: 12 }}>
            <button className="action-button" type="button" onClick={() => setShowCreateInvoice(true)}>Create Invoice</button>
            <button className="ghost-button" type="button" onClick={() => setShowSalesReceipt(true)}>Sales Receipt</button>
            <button className="ghost-button" type="button" onClick={() => setShowRecordPayment(true)}>Record Payment</button>
            <button className="ghost-button" type="button" onClick={() => setRecurringModal({})}>Add Recurring</button>
            <button className="ghost-button" type="button" disabled={running} onClick={handleRunDue}>{running ? "Running…" : "Run Due Billing"}</button>
          </div>
        </div>
      )}

      {canManage && (
        <div className="metric-grid" style={{ marginBottom: 20 }}>
          {/* Tiles filter the list below rather than being read-only totals —
              the number is only ever the start of the question "which ones?". */}
          <button type="button" className="metric metric-clickable" onClick={() => setStatusFilter("Sent")}>
            <div className="metric-label">Open Firm Balance</div>
            <div className="metric-value">{fmtMoney(kpis.openBalance)}</div>
            <div className="metric-note">{kpis.openCount} KPI invoice(s)</div>
          </button>
          <button type="button" className="metric metric-clickable" onClick={() => setStatusFilter("Overdue")}>
            <div className="metric-label">Overdue Balance</div>
            <div className="metric-value">{fmtMoney(kpis.overdueBalance)}</div>
            <div className="metric-note">firm invoices only</div>
          </button>
          <button type="button" className="metric metric-clickable" onClick={() => setStatusFilter("Paid")}>
            <div className="metric-label">Paid This Period</div>
            <div className="metric-value">{fmtMoney(kpis.paidThisPeriod)}</div>
            <div className="metric-note">{kpis.paidCount} firm payment(s)</div>
          </button>
          <button type="button" className="metric metric-clickable" onClick={() => taxTrackingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            <div className="metric-label">Client Tax Due</div>
            <div className="metric-value">{fmtMoney(kpis.clientTaxDue)}</div>
            <div className="metric-note">{kpis.taxCount} tax tracking row(s)</div>
          </button>
        </div>
      )}

      {canManage && (
        <div className="card" style={{ marginBottom: 20, padding: 16, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ margin: 0, minWidth: 200 }}>
            <label htmlFor="inv-list-statement-client">Statement of Account — Client</label>
            <select id="inv-list-statement-client" value={statementClientId} onChange={(e) => setStatementClientId(e.target.value)}>
              <option value="">Select a client…</option>
              {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}><label htmlFor="inv-list-statement-start">From</label><input id="inv-list-statement-start" type="date" value={statementStart} onChange={(e) => setStatementStart(e.target.value)} /></div>
          <div className="field" style={{ margin: 0 }}><label htmlFor="inv-list-statement-end">To</label><input id="inv-list-statement-end" type="date" value={statementEnd} onChange={(e) => setStatementEnd(e.target.value)} /></div>
          <button className="btn" disabled={!statementClientId || viewingStatement} onClick={handleViewStatement}>
            {viewingStatement ? "Generating…" : "View Statement"}
          </button>
          <button className="btn" disabled={!statementClientId || printingStatement} onClick={handlePrintStatement}>
            {printingStatement ? "Generating…" : "Download Statement"}
          </button>
        </div>
      )}

      {!ready && <div className="spinner-wrap">Loading…</div>}

      {ready && (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ fontSize: 14 }}>{canManage ? "Firm Invoices" : t("billing.client.yourInvoices")}</strong>
            <span className="muted" style={{ fontSize: 12 }}><Num>{filteredInvoices.length}</Num> {canManage ? "invoices" : t("billing.client.invoicesSuffix")}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
          <div className="table-scroll card-table">
          <table>
            <thead>
              <tr><th scope="col">{canManage ? "Invoice" : t("billing.client.colInvoice")}</th>{canManage && <th scope="col">Client</th>}<th scope="col">{canManage ? "Date" : t("billing.client.colDate")}</th><th scope="col">{canManage ? "Due" : t("billing.client.colDue")}</th><th scope="col">{canManage ? "Description" : t("billing.client.colDescription")}</th><th scope="col">{canManage ? "Amount" : t("billing.client.colAmount")}</th><th scope="col">{canManage ? "Balance" : t("billing.client.colBalance")}</th><th scope="col">{canManage ? "Status" : t("billing.client.colStatus")}</th>{canManage && <th scope="col">Action</th>}</tr>
            </thead>
            <tbody>
              {filteredInvoices.map((inv) => (
                <tr key={inv.invoice_id} data-row-id={inv.invoice_id} tabIndex={0} onClick={() => { setSelectedClient(inv.client_id, clientName(inv.client_id)); navigate(`/billing/${inv.invoice_id}`); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedClient(inv.client_id, clientName(inv.client_id)); navigate(`/billing/${inv.invoice_id}`); } }}>
                  <td>{inv.invoice_id}</td>
                  {canManage && <td className="muted" data-label="Client">{clientName(inv.client_id)}</td>}
                  <td className="muted" data-label={canManage ? "Date" : t("billing.client.colDate")}><Num>{fmtDate(inv.invoice_date)}</Num></td>
                  <td className="muted" data-label={canManage ? "Due" : t("billing.client.colDue")}><Num>{fmtDate(inv.due_date)}</Num></td>
                  <td className="muted" data-label={canManage ? "Description" : t("billing.client.colDescription")}>{inv.description}</td>
                  <td data-label={canManage ? "Amount" : t("billing.client.colAmount")}><Num>{fmtMoney(inv.total_amount)}</Num></td>
                  <td data-label={canManage ? "Balance" : t("billing.client.colBalance")}><Num>{fmtMoney(inv.balance_due)}</Num></td>
                  <td data-label={canManage ? "Status" : t("billing.client.colStatus")}><StatusBadge status={inv.status} /></td>
                  {canManage && (
                    <td data-label="" onClick={(e) => e.stopPropagation()}>
                      <ActionMenu
                        options={[
                          { value: "view", label: "View Invoice" },
                          { value: "view-pdf", label: "View PDF" },
                          { value: "print", label: "Download PDF" },
                          ...(inv.status !== "Void" ? [{ value: "void", label: "Void Invoice" }] : []),
                          ...(isAdmin ? [{ value: "delete", label: "Delete Invoice" }] : []),
                        ]}
                        onSelect={(action) => {
                          if (action === "view") navigate(`/billing/${inv.invoice_id}`);
                          if (action === "view-pdf") viewFile(`/billing/invoices/${inv.invoice_id}/print`).catch((err) => notify(err instanceof ApiError ? err.message : "Could not open this invoice."));
                          if (action === "print") downloadFile(`/billing/invoices/${inv.invoice_id}/print`, buildFilename([clientName(inv.client_id), "Invoice", inv.invoice_id], "pdf")).catch((err) => notify(err instanceof ApiError ? err.message : "Could not print this invoice."));
                          if (action === "void") handleVoid(inv.invoice_id);
                          if (action === "delete") handleDelete(inv.invoice_id);
                        }}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </div>
          {filteredInvoices.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>{canManage ? "No invoices match." : t("billing.client.noInvoices")}</p>}
        </div>
      )}

      {ready && !canManage && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ fontSize: 14 }}>{t("billing.client.taxTitle")}</strong>
            <span className="muted" style={{ fontSize: 12 }}><Num>{taxRows?.length ?? 0}</Num> {t("billing.client.rowsSuffix")}</span>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: "10px 16px 0" }}>
            {t("billing.client.taxIntro")}
          </p>
          {!taxRows ? (
            <p className="muted" style={{ padding: 16, textAlign: "center" }}>{t("billing.client.loading")}</p>
          ) : (
            <div className="table-scroll card-table">
              <table>
                <thead><tr><th scope="col">{t("billing.client.colPaymentDue")}</th><th scope="col">{t("billing.client.colDuePaid")}</th><th scope="col">{t("billing.client.colExpected")}</th><th scope="col">{t("billing.client.colPaid")}</th><th scope="col">{t("billing.client.colStatus")}</th></tr></thead>
                <tbody>
                  {taxRows.map((r) => (
                    <tr key={r.task_id} data-row-id={r.task_id}>
                      <td data-label={t("billing.client.colPaymentDue")}>{r.task_name}</td>
                      <td className="muted" data-label={t("billing.client.colDuePaid")}><Num>{fmtDate(r.paid_date || r.agency_due_date)}</Num></td>
                      <td data-label={t("billing.client.colExpected")}><Num>{fmtMoney(r.payment_amount)}</Num></td>
                      <td className="muted" data-label={t("billing.client.colPaid")}>{r.paid_date ? t("billing.client.yes") : t("billing.client.no")}</td>
                      <td data-label={t("billing.client.colStatus")}><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {taxRows && taxRows.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>{t("billing.client.noTaxRows")}</p>}
        </div>
      )}

      {canManage && schedules && (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ fontSize: 14 }}>Recurring Billing</strong>
            <span className="muted" style={{ fontSize: 12 }}>{filteredSchedules.length} schedule(s)</span>
          </div>
          <div style={{ overflowX: "auto" }}>
          <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">Client</th><th scope="col">Description</th><th scope="col">Amount</th><th scope="col">Frequency</th><th scope="col">Next Run</th><th scope="col">Due Days</th><th scope="col">Auto</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
            <tbody>
              {filteredSchedules.map((s) => (
                <tr key={s.recurring_billing_id} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => setRecurringModal({ editing: s })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setRecurringModal({ editing: s }); } }}>
                  <td>{s.client_name as string}</td>
                  <td className="muted">{s.description as string}</td>
                  <td>{fmtMoney(s.amount)}</td>
                  <td className="muted">{s.frequency as string}</td>
                  <td className="muted">{fmtDate(s.next_run_date as string)}</td>
                  <td className="muted">{String(s.due_days ?? "0")}</td>
                  <td className="muted">{s.auto_create_invoice ? "Invoice" : ""}{s.auto_create_invoice && s.auto_send_invoice ? " + " : ""}{s.auto_send_invoice ? "Email" : ""}{!s.auto_create_invoice && !s.auto_send_invoice ? "—" : ""}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td data-label="" onClick={(e) => e.stopPropagation()}>
                    <ActionMenu
                      options={[
                        { value: "edit", label: "Edit" },
                        { value: "use", label: "Use Now" },
                        { value: "duplicate", label: "Duplicate" },
                        s.status === "Paused" ? { value: "resume", label: "Resume" } : { value: "pause", label: "Pause" },
                        { value: "skip", label: "Skip Next Date" },
                        ...(s.status !== "Archived" ? [{ value: "archive", label: "Archive" }] : []),
                        ...(isAdmin ? [{ value: "delete", label: "Delete" }] : []),
                      ]}
                      onSelect={(action) => {
                        if (action === "edit") setRecurringModal({ editing: s });
                        if (action === "use") handleUseScheduleNow(s.recurring_billing_id);
                        if (action === "duplicate") handleDuplicateSchedule(s);
                        if (action === "pause") handlePauseSchedule(s.recurring_billing_id);
                        if (action === "resume") handleResumeSchedule(s.recurring_billing_id);
                        if (action === "skip") handleSkipNextDate(s.recurring_billing_id);
                        if (action === "archive") handleArchiveSchedule(s.recurring_billing_id);
                        if (action === "delete") handleDeleteSchedule(s.recurring_billing_id);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </div>
          {filteredSchedules.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>{schedules?.length ? "No schedules match." : "No recurring billing schedules yet."}</p>}
        </div>
      )}

      {canManage && (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ fontSize: 14 }}>Firm Invoice Payments</strong>
            <span className="muted" style={{ fontSize: 12 }}>{filteredFirmPayments.length} payment rows</span>
          </div>
          <div style={{ overflowX: "auto" }}>
          <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">Payment</th><th scope="col">Invoice</th><th scope="col">Client</th><th scope="col">Date</th><th scope="col">Amount</th><th scope="col">Method</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {filteredFirmPayments.map((p) => (
                <tr key={p.payment_id} data-row-id={p.payment_id} tabIndex={0} onClick={() => navigate(`/billing/${p.invoice_id}`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/billing/${p.invoice_id}`); } }}>
                  <td>{p.payment_id}</td>
                  <td className="muted">{p.invoice_id}</td>
                  <td className="muted">{clientName(p.client_id as string) }</td>
                  <td className="muted">{fmtDate(p.payment_date)}</td>
                  <td>{fmtMoney(p.actual_amount)}</td>
                  <td className="muted">{p.method}</td>
                  <td><StatusBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </div>
          {filteredFirmPayments.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>{(firmPayments || []).length ? "No payments match." : "No firm invoice payments for this period."}</p>}
        </div>
      )}

      {canManage && (
        <div ref={taxTrackingRef} className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ fontSize: 14 }}>Client Tax Payment Tracking</strong>
            <span className="muted" style={{ fontSize: 12 }}>{scopedTaxRows.length} tax payment rows</span>
          </div>
          <div style={{ overflowX: "auto" }}>
          <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">Payment / Due</th><th scope="col">Client</th><th scope="col">Related Task</th><th scope="col">Due / Paid</th><th scope="col">Expected</th><th scope="col">Paid</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {scopedTaxRows.map((r) => (
                <tr key={r.task_id} data-row-id={r.task_id} tabIndex={0} onClick={() => navigate(`/tasks/${r.task_id}`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/tasks/${r.task_id}`); } }}>
                  <td>{r.task_name}</td>
                  <td className="muted">{r.client_name}</td>
                  <td className="muted">{r.task_name}</td>
                  <td className="muted">{fmtDate(r.paid_date || r.agency_due_date)}</td>
                  <td>{fmtMoney(r.payment_amount)}</td>
                  <td className="muted">{r.paid_date ? "Yes" : "No"}</td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </div>
          {scopedTaxRows.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No client tax payment rows for this period.</p>}
        </div>
      )}

      {showCreateInvoice && <InvoiceEditorModal clients={clients} onClose={() => setShowCreateInvoice(false)} onDone={(invoiceId) => { loadAll(); navigate(`/billing/${invoiceId}`); }} />}
      {showSalesReceipt && <SalesReceiptModal clients={clients} onClose={() => setShowSalesReceipt(false)} onDone={loadAll} />}
      {showRecordPayment && <RecordPaymentShortcutModal invoices={invoices || []} clientName={clientName} onClose={() => setShowRecordPayment(false)} onDone={loadAll} />}
      {recurringModal && <AddRecurringModal clients={clients} editing={recurringModal.editing} onClose={() => setRecurringModal(null)} onDone={loadSchedules} />}
    </div>
  );
}

function SalesReceiptModal({ clients, onClose, onDone }: { clients: Client[]; onClose: () => void; onDone: () => void }) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    clientId: "", date: today, amount: "", description: "Sales receipt", paymentProfile: MANUAL_PROFILE, method: "Check",
    bankName: "", accountType: "", routingNumber: "", accountNumber: "", bankLast4: "", confirmationNumber: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!form.clientId || !form.amount) { setError("Client and Amount Received are required."); return; }
    setSaving(true);
    setError(null);
    try {
      await api.post("/billing/sales-receipt", {
        clientId: form.clientId, date: form.date, amount: Number(form.amount), description: form.description, method: form.method,
        paymentMethodId: form.paymentProfile === MANUAL_PROFILE ? undefined : form.paymentProfile,
        paymentBankName: form.bankName, paymentAccountType: form.accountType, paymentRoutingNumber: form.routingNumber,
        paymentAccountNumber: form.accountNumber, paymentBankLast4: form.bankLast4, confirmationNumber: form.confirmationNumber, notes: form.notes,
      });
      toast("Sales receipt created.");
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create this sales receipt.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="sales-receipt-title" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2 id="sales-receipt-title">Create Sales Receipt</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        {error && <ErrorBanner error={error} />}
        <div className="field"><label htmlFor="sr-client">Client</label><select id="sr-client" value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}><option value="">Select a client…</option>{clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}</select></div>
        <div className="form-grid">
          <div className="field"><label htmlFor="sr-date">Receipt Date</label><input id="sr-date" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></div>
          <div className="field"><label htmlFor="sr-amount">Amount Received</label><input id="sr-amount" type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></div>
        </div>
        <div className="field"><label htmlFor="sr-description">Description</label><input id="sr-description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
        <div className="form-grid">
          <PaymentProfileField clientId={form.clientId} value={form.paymentProfile} onChange={(v) => setForm((f) => ({ ...f, paymentProfile: v }))} />
          <div className="field"><label htmlFor="sr-method">Method</label><select id="sr-method" value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
        </div>
        {form.paymentProfile === MANUAL_PROFILE && (
          <div className="form-grid">
            <div className="field"><label htmlFor="sr-bank-name">Bank Name</label><input id="sr-bank-name" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} placeholder="Bank on file" /></div>
            <div className="field"><label htmlFor="sr-account-type">Account Type</label><select id="sr-account-type" value={form.accountType} onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value }))}><option value="">Select…</option>{ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div className="field"><label htmlFor="sr-routing-number">Routing Number</label><input id="sr-routing-number" value={form.routingNumber} onChange={(e) => setForm((f) => ({ ...f, routingNumber: e.target.value }))} /></div>
            <div className="field"><label htmlFor="sr-account-number">Account Number</label><input id="sr-account-number" value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} /></div>
            <div className="field"><label htmlFor="sr-bank-last4">Bank Last 4</label><input id="sr-bank-last4" value={form.bankLast4} onChange={(e) => setForm((f) => ({ ...f, bankLast4: e.target.value }))} maxLength={4} /></div>
            <div className="field"><label htmlFor="sr-confirmation-number">Confirmation #</label><input id="sr-confirmation-number" value={form.confirmationNumber} onChange={(e) => setForm((f) => ({ ...f, confirmationNumber: e.target.value }))} placeholder="Optional" /></div>
          </div>
        )}
        <div className="field"><label htmlFor="sr-notes">Notes</label><textarea id="sr-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
        <p className="muted" style={{ fontSize: 12 }}>Sales Receipt creates a paid firm invoice and matching payment record. It does not process cards or ACH.</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSubmit}>{saving ? "Saving…" : "Save Sales Receipt"}</button>
        </div>
      </div>
    </div>
  );
}

function RecordPaymentShortcutModal({ invoices, clientName, onClose, onDone }: { invoices: Invoice[]; clientName: (id: string) => string; onClose: () => void; onDone: () => void }) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const openInvoices = invoices.filter((i) => !["paid", "void"].includes(String(i.status || "").toLowerCase()));
  const [form, setForm] = useState({
    invoiceId: "", paymentDate: today, amount: "", paymentProfile: MANUAL_PROFILE, method: "Check",
    bankName: "", accountType: "", routingNumber: "", accountNumber: "", bankLast4: "", confirmationNumber: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedInvoice = openInvoices.find((i) => i.invoice_id === form.invoiceId);

  async function handleSubmit() {
    if (!form.invoiceId || !form.amount) { setError("Invoice and Amount are required."); return; }
    setSaving(true);
    setError(null);
    try {
      await api.post(`/billing/invoices/${form.invoiceId}/payments`, {
        paymentDate: form.paymentDate, actualAmount: Number(form.amount), method: form.method,
        paymentMethodId: form.paymentProfile === MANUAL_PROFILE ? undefined : form.paymentProfile,
        paymentBankName: form.bankName, paymentAccountType: form.accountType, paymentRoutingNumber: form.routingNumber,
        paymentAccountNumber: form.accountNumber, paymentBankLast4: form.bankLast4, confirmationNumber: form.confirmationNumber,
        notes: form.notes,
      });
      toast("Payment recorded.");
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record this payment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="record-payment-title" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2 id="record-payment-title">Record Payment</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        {error && <ErrorBanner error={error} />}
        <div className="field">
          <label htmlFor="rp-invoice">Invoice</label>
          <select id="rp-invoice" value={form.invoiceId} onChange={(e) => setForm((f) => ({ ...f, invoiceId: e.target.value }))}>
            <option value="">Select an open invoice…</option>
            {openInvoices.map((i) => <option key={i.invoice_id} value={i.invoice_id}>{i.invoice_id} — {clientName(i.client_id)} — Balance {fmtMoney(i.balance_due)}</option>)}
          </select>
        </div>
        <div className="form-grid">
          <div className="field"><label htmlFor="rp-payment-date">Payment Date</label><input id="rp-payment-date" type="date" value={form.paymentDate} onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))} /></div>
          <div className="field"><label htmlFor="rp-amount">Amount</label><input id="rp-amount" type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder={selectedInvoice ? String(selectedInvoice.balance_due) : ""} /></div>
        </div>
        <div className="form-grid">
          <PaymentProfileField clientId={selectedInvoice?.client_id || ""} value={form.paymentProfile} onChange={(v) => setForm((f) => ({ ...f, paymentProfile: v }))} />
          <div className="field"><label htmlFor="rp-method">Method</label><select id="rp-method" value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
        </div>
        {form.paymentProfile === MANUAL_PROFILE && (
          <div className="form-grid">
            <div className="field"><label htmlFor="rp-bank-name">Bank Name</label><input id="rp-bank-name" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} /></div>
            <div className="field"><label htmlFor="rp-account-type">Account Type</label><select id="rp-account-type" value={form.accountType} onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value }))}><option value="">Select…</option>{ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div className="field"><label htmlFor="rp-routing-number">Routing Number</label><input id="rp-routing-number" value={form.routingNumber} onChange={(e) => setForm((f) => ({ ...f, routingNumber: e.target.value }))} /></div>
            <div className="field"><label htmlFor="rp-account-number">Account Number</label><input id="rp-account-number" value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} /></div>
            <div className="field"><label htmlFor="rp-bank-last4">Bank Last 4</label><input id="rp-bank-last4" value={form.bankLast4} onChange={(e) => setForm((f) => ({ ...f, bankLast4: e.target.value }))} maxLength={4} /></div>
            <div className="field"><label htmlFor="rp-confirmation-number">Confirmation #</label><input id="rp-confirmation-number" value={form.confirmationNumber} onChange={(e) => setForm((f) => ({ ...f, confirmationNumber: e.target.value }))} /></div>
          </div>
        )}
        <div className="field"><label htmlFor="rp-notes">Notes</label><textarea id="rp-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSubmit}>{saving ? "Saving…" : "Record Payment"}</button>
        </div>
      </div>
    </div>
  );
}

