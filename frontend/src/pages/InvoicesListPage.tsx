import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, downloadFile, viewFile } from "../api/client";
import type { Invoice, Payment, RecurringBilling } from "../api/types2";
import type { Client } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { StatusBadge } from "../components/StatusBadge";
import { ActionMenu } from "../components/ActionMenu";
import { FilterBar, exportCsv, activeViewDates } from "../components/FilterBar";
import { useToast } from "../components/Toast";
import { useSelectedClient } from "../context/SelectedClientContext";
import { fmtDateOnly as fmtDate, daysUntil } from "../utils/date";
import { InvoiceEditorModal } from "../components/InvoiceEditorModal";
import { AddRecurringModal } from "../components/AddRecurringModal";
import { MANUAL_PROFILE, PaymentProfileField } from "../components/PaymentProfileField";

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
  const navigate = useNavigate();
  const toast = useToast();
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

  const [showCreateInvoice, setShowCreateInvoice] = useState(false);
  const [showSalesReceipt, setShowSalesReceipt] = useState(false);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [recurringModal, setRecurringModal] = useState<{ editing?: RecurringBilling } | null>(null);
  const [running, setRunning] = useState(false);

  const [statementClientId, setStatementClientId] = useState("");
  const [statementStart, setStatementStart] = useState("");
  const [statementEnd, setStatementEnd] = useState("");
  const [printingStatement, setPrintingStatement] = useState(false);
  const [viewingStatement, setViewingStatement] = useState(false);

  const canManage = user?.role === "admin" || user?.role === "staff";

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
    if (!canManage) return Promise.resolve();
    const qs = `?start=${period.start}&end=${period.end}`;
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
      alert(err instanceof ApiError ? err.message : "Could not generate this statement.");
    } finally {
      setViewingStatement(false);
    }
  }

  async function handlePrintStatement() {
    if (!statementClientId) return;
    setPrintingStatement(true);
    try {
      await downloadFile(statementPath(), `Statement_${statementClientId}.pdf`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this statement.");
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
      alert(err instanceof ApiError ? err.message : "Could not run recurring billing.");
    } finally {
      setRunning(false);
    }
  }

  async function handleVoid(invoiceId: string) {
    if (!confirm("Void this invoice? This cannot be undone.")) return;
    try {
      await api.post(`/billing/invoices/${invoiceId}/void`, {});
      toast("Invoice voided.");
      loadAll();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not void this invoice.");
    }
  }

  async function handleArchiveSchedule(id: string) {
    if (!confirm("Archive this recurring billing schedule? It will stop creating future invoices.")) return;
    try {
      await api.post(`/billing/recurring/${id}/archive`, {});
      toast("Schedule archived.");
      loadSchedules();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not archive this schedule.");
    }
  }

  const clientName = (id: string) => clients.find((c) => c.client_id === id)?.client_name || id;

  const filteredInvoices = useMemo(() => {
    if (!invoices) return [];
    let rows = invoices;
    if (statusFilter !== "all") rows = rows.filter((i) => i.status === statusFilter);
    return rows;
  }, [invoices, statusFilter]);

  const kpis = useMemo(() => {
    const inv = invoices || [];
    const open = inv.filter((i) => !["paid", "void"].includes(String(i.status || "").toLowerCase()));
    const openBalance = open.reduce((sum, i) => sum + Number(i.balance_due || 0), 0);
    const overdue = open.filter((i) => (daysUntil(i.due_date) ?? 0) < 0);
    const overdueBalance = overdue.reduce((sum, i) => sum + Number(i.balance_due || 0), 0);
    const paidThisPeriod = (firmPayments || []).reduce((sum, p) => sum + Number(p.actual_amount || 0), 0);
    const unpaidTaxRows = (taxRows || []).filter((r) => !r.paid_date);
    const clientTaxDue = unpaidTaxRows.reduce((sum, r) => sum + Number(r.payment_amount || 0), 0);
    return {
      openBalance, openCount: open.length,
      overdueBalance, overdueCount: overdue.length,
      paidThisPeriod, paidCount: (firmPayments || []).length,
      clientTaxDue, taxCount: (taxRows || []).length,
    };
  }, [invoices, firmPayments, taxRows]);

  function handleExport() {
    exportCsv("invoices.csv", [
      { key: "invoice_id", label: "Invoice" }, { key: "client_id", label: "Client" }, { key: "invoice_date", label: "Date" },
      { key: "due_date", label: "Due" }, { key: "description", label: "Description" }, { key: "total_amount", label: "Amount" },
      { key: "balance_due", label: "Balance" }, { key: "status", label: "Status" },
    ], filteredInvoices as unknown as Record<string, unknown>[]);
  }

  const ready = invoices !== null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Billing</h1>
      </div>

      {canManage && (
        <FilterBar
          selects={[{ label: "Status", value: statusFilter, options: INVOICE_STATUSES, onChange: setStatusFilter }]}
          period={{ start: period.start, end: period.end, onStartChange: (v) => setPeriod((p) => ({ ...p, start: v })), onEndChange: (v) => setPeriod((p) => ({ ...p, end: v })), onActiveView: () => setPeriod(activeViewDates()) }}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          onExportCsv={handleExport}
        />
      )}

      {error && <div className="error-banner" style={{ marginTop: 12 }}>{error}</div>}

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
          <div className="metric">
            <div className="metric-label">Open Firm Balance</div>
            <div className="metric-value">{fmtMoney(kpis.openBalance)}</div>
            <div className="metric-note">{kpis.openCount} KPI invoice(s)</div>
          </div>
          <div className="metric">
            <div className="metric-label">Overdue Balance</div>
            <div className="metric-value">{fmtMoney(kpis.overdueBalance)}</div>
            <div className="metric-note">firm invoices only</div>
          </div>
          <div className="metric">
            <div className="metric-label">Paid This Period</div>
            <div className="metric-value">{fmtMoney(kpis.paidThisPeriod)}</div>
            <div className="metric-note">{kpis.paidCount} firm payment(s)</div>
          </div>
          <div className="metric">
            <div className="metric-label">Client Tax Due</div>
            <div className="metric-value">{fmtMoney(kpis.clientTaxDue)}</div>
            <div className="metric-note">{kpis.taxCount} tax tracking row(s)</div>
          </div>
        </div>
      )}

      {canManage && (
        <div className="card" style={{ marginBottom: 20, padding: 16, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ margin: 0, minWidth: 200 }}>
            <label>Statement of Account — Client</label>
            <select value={statementClientId} onChange={(e) => setStatementClientId(e.target.value)}>
              <option value="">Select a client…</option>
              {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}><label>From</label><input type="date" value={statementStart} onChange={(e) => setStatementStart(e.target.value)} /></div>
          <div className="field" style={{ margin: 0 }}><label>To</label><input type="date" value={statementEnd} onChange={(e) => setStatementEnd(e.target.value)} /></div>
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
            <strong style={{ fontSize: 14 }}>Firm Invoices</strong>
            <span className="muted" style={{ fontSize: 12 }}>{filteredInvoices.length} invoices</span>
          </div>
          <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr><th>Invoice</th><th>Client</th><th>Date</th><th>Due</th><th>Description</th><th>Amount</th><th>Balance</th><th>Status</th>{canManage && <th>Action</th>}</tr>
            </thead>
            <tbody>
              {filteredInvoices.map((inv) => (
                <tr key={inv.invoice_id} onClick={() => { setSelectedClient(inv.client_id, clientName(inv.client_id)); navigate(`/billing/${inv.invoice_id}`); }}>
                  <td>{inv.invoice_id}</td>
                  <td className="muted">{clientName(inv.client_id)}</td>
                  <td className="muted">{fmtDate(inv.invoice_date)}</td>
                  <td className="muted">{fmtDate(inv.due_date)}</td>
                  <td className="muted">{inv.description}</td>
                  <td>{fmtMoney(inv.total_amount)}</td>
                  <td>{fmtMoney(inv.balance_due)}</td>
                  <td><StatusBadge status={inv.status} /></td>
                  {canManage && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <ActionMenu
                        options={[
                          { value: "view", label: "View Invoice" },
                          { value: "view-pdf", label: "View PDF" },
                          { value: "print", label: "Download PDF" },
                          ...(inv.status !== "Void" ? [{ value: "void", label: "Void Invoice" }] : []),
                        ]}
                        onSelect={(action) => {
                          if (action === "view") navigate(`/billing/${inv.invoice_id}`);
                          if (action === "view-pdf") viewFile(`/billing/invoices/${inv.invoice_id}/print`).catch((err) => alert(err instanceof ApiError ? err.message : "Could not open this invoice."));
                          if (action === "print") downloadFile(`/billing/invoices/${inv.invoice_id}/print`, `Invoice_${inv.invoice_id}.pdf`).catch((err) => alert(err instanceof ApiError ? err.message : "Could not print this invoice."));
                          if (action === "void") handleVoid(inv.invoice_id);
                        }}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {filteredInvoices.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No invoices match.</p>}
        </div>
      )}

      {canManage && schedules && (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ fontSize: 14 }}>Recurring Billing</strong>
            <span className="muted" style={{ fontSize: 12 }}>{schedules.length} schedule(s)</span>
          </div>
          <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Client</th><th>Description</th><th>Amount</th><th>Frequency</th><th>Next Run</th><th>Due Days</th><th>Auto</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.recurring_billing_id}>
                  <td>{s.client_name as string}</td>
                  <td className="muted">{s.description as string}</td>
                  <td>{fmtMoney(s.amount)}</td>
                  <td className="muted">{s.frequency as string}</td>
                  <td className="muted">{fmtDate(s.next_run_date as string)}</td>
                  <td className="muted">{String(s.due_days ?? "0")}</td>
                  <td className="muted">{s.auto_create_invoice ? "Invoice" : ""}{s.auto_create_invoice && s.auto_send_invoice ? " + " : ""}{s.auto_send_invoice ? "Email" : ""}{!s.auto_create_invoice && !s.auto_send_invoice ? "—" : ""}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td style={{ display: "flex", gap: 6 }}>
                    {s.status !== "Archived" && <button className="btn btn-sm" onClick={() => setRecurringModal({ editing: s })}>Edit</button>}
                    {s.status !== "Archived" && <button className="btn btn-sm btn-danger" onClick={() => handleArchiveSchedule(s.recurring_billing_id)}>Archive</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {schedules.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No recurring billing schedules yet.</p>}
        </div>
      )}

      {canManage && (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ fontSize: 14 }}>Firm Invoice Payments</strong>
            <span className="muted" style={{ fontSize: 12 }}>{firmPayments?.length ?? 0} payment rows</span>
          </div>
          <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Payment</th><th>Invoice</th><th>Client</th><th>Date</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead>
            <tbody>
              {(firmPayments || []).map((p) => (
                <tr key={p.payment_id} onClick={() => navigate(`/billing/${p.invoice_id}`)}>
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
          {(firmPayments || []).length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No firm invoice payments for this period.</p>}
        </div>
      )}

      {canManage && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ fontSize: 14 }}>Client Tax Payment Tracking</strong>
            <span className="muted" style={{ fontSize: 12 }}>{taxRows?.length ?? 0} tax payment rows</span>
          </div>
          <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Payment / Due</th><th>Client</th><th>Related Task</th><th>Due / Paid</th><th>Expected</th><th>Paid</th><th>Status</th></tr></thead>
            <tbody>
              {(taxRows || []).map((r) => (
                <tr key={r.task_id} onClick={() => navigate(`/tasks/${r.task_id}`)}>
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
          {(taxRows || []).length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No client tax payment rows for this period.</p>}
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
      <div className="modal-panel" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>Create Sales Receipt</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        {error && <div className="error-banner">{error}</div>}
        <div className="field"><label>Client</label><select value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}><option value="">Select a client…</option>{clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}</select></div>
        <div className="form-grid">
          <div className="field"><label>Receipt Date</label><input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></div>
          <div className="field"><label>Amount Received</label><input type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></div>
        </div>
        <div className="field"><label>Description</label><input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
        <div className="form-grid">
          <PaymentProfileField clientId={form.clientId} value={form.paymentProfile} onChange={(v) => setForm((f) => ({ ...f, paymentProfile: v }))} />
          <div className="field"><label>Method</label><select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
        </div>
        {form.paymentProfile === MANUAL_PROFILE && (
          <div className="form-grid">
            <div className="field"><label>Bank Name</label><input value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} placeholder="Bank on file" /></div>
            <div className="field"><label>Account Type</label><select value={form.accountType} onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value }))}><option value="">Select…</option>{ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div className="field"><label>Routing Number</label><input value={form.routingNumber} onChange={(e) => setForm((f) => ({ ...f, routingNumber: e.target.value }))} /></div>
            <div className="field"><label>Account Number</label><input value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} /></div>
            <div className="field"><label>Bank Last 4</label><input value={form.bankLast4} onChange={(e) => setForm((f) => ({ ...f, bankLast4: e.target.value }))} maxLength={4} /></div>
            <div className="field"><label>Confirmation #</label><input value={form.confirmationNumber} onChange={(e) => setForm((f) => ({ ...f, confirmationNumber: e.target.value }))} placeholder="Optional" /></div>
          </div>
        )}
        <div className="field"><label>Notes</label><textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
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
      <div className="modal-panel" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>Record Payment</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        {error && <div className="error-banner">{error}</div>}
        <div className="field">
          <label>Invoice</label>
          <select value={form.invoiceId} onChange={(e) => setForm((f) => ({ ...f, invoiceId: e.target.value }))}>
            <option value="">Select an open invoice…</option>
            {openInvoices.map((i) => <option key={i.invoice_id} value={i.invoice_id}>{i.invoice_id} — {clientName(i.client_id)} — Balance {fmtMoney(i.balance_due)}</option>)}
          </select>
        </div>
        <div className="form-grid">
          <div className="field"><label>Payment Date</label><input type="date" value={form.paymentDate} onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))} /></div>
          <div className="field"><label>Amount</label><input type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder={selectedInvoice ? String(selectedInvoice.balance_due) : ""} /></div>
        </div>
        <div className="form-grid">
          <PaymentProfileField clientId={selectedInvoice?.client_id || ""} value={form.paymentProfile} onChange={(v) => setForm((f) => ({ ...f, paymentProfile: v }))} />
          <div className="field"><label>Method</label><select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
        </div>
        {form.paymentProfile === MANUAL_PROFILE && (
          <div className="form-grid">
            <div className="field"><label>Bank Name</label><input value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} /></div>
            <div className="field"><label>Account Type</label><select value={form.accountType} onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value }))}><option value="">Select…</option>{ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div className="field"><label>Routing Number</label><input value={form.routingNumber} onChange={(e) => setForm((f) => ({ ...f, routingNumber: e.target.value }))} /></div>
            <div className="field"><label>Account Number</label><input value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} /></div>
            <div className="field"><label>Bank Last 4</label><input value={form.bankLast4} onChange={(e) => setForm((f) => ({ ...f, bankLast4: e.target.value }))} maxLength={4} /></div>
            <div className="field"><label>Confirmation #</label><input value={form.confirmationNumber} onChange={(e) => setForm((f) => ({ ...f, confirmationNumber: e.target.value }))} /></div>
          </div>
        )}
        <div className="field"><label>Notes</label><textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSubmit}>{saving ? "Saving…" : "Record Payment"}</button>
        </div>
      </div>
    </div>
  );
}

