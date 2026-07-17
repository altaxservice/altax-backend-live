import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, downloadFile, viewFile } from "../api/client";
import type { TaxRate, CoaAccount, Employee } from "../api/types2";
import type { Client } from "../api/types";
import { useSelectedClient } from "../context/SelectedClientContext";
import { fmtDateOnly as fmtDate } from "../utils/date";
import type { PaymentMethod } from "../api/types2";
import { StatusBadge } from "../components/StatusBadge";
import { US_STATES } from "../utils/clientOptions";
import { AddressFields } from "../components/AddressFields";

const TABS = ["Sales", "Payroll", "Employees", "Contractors", "Manual JE", "GL", "Paychecks", "Month-End", "Check Settings", "Year-End", "Tax Rates", "COA"] as const;
type Tab = (typeof TABS)[number];
const CLIENT_SCOPED_TABS: Tab[] = ["Sales", "Payroll", "Employees", "Contractors", "Manual JE", "GL", "Paychecks", "Month-End", "Check Settings", "Year-End"];

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

export function AccountingPage() {
  const { clientId: globalClientId, setSelectedClient } = useSelectedClient();
  const [tab, setTab] = useState<Tab>("Sales");
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState(globalClientId || "");

  useEffect(() => {
    api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => {});
  }, []);

  const client = clients.find((c) => c.client_id === clientId);
  const needsClient = CLIENT_SCOPED_TABS.includes(tab);

  function handleClientChange(id: string) {
    setClientId(id);
    setSelectedClient(id || null, clients.find((c) => c.client_id === id)?.client_name);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Accounting</h1>
        <div className="field" style={{ maxWidth: 320, margin: 0 }}>
          <label htmlFor="acct-client">Client</label>
          <select id="acct-client" value={clientId} onChange={(e) => handleClientChange(e.target.value)}>
            <option value="">Select a client…</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
          </select>
        </div>
      </div>

      {client && (
        <div className="command-panel" style={{ marginBottom: 16 }}>
          <div className="command-panel-header">
            <div>
              <h2 className="command-panel-title">{client.client_name}</h2>
              <div className="command-panel-note">Client Accounting Workspace — sales input, payroll input, paychecks, and manual journal entries post directly to the general ledger.</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)", marginBottom: 20, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <div
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "10px 16px", fontSize: 14, fontWeight: 500, cursor: "pointer",
              color: tab === t ? "var(--ink)" : "var(--muted)",
              borderBottom: tab === t ? "2px solid var(--teal)" : "2px solid transparent",
            }}
          >
            {t}
          </div>
        ))}
      </div>

      {needsClient && !clientId && <p className="muted">Pick a client above to work in their books.</p>}
      {tab === "Sales" && clientId && <SalesTab clientId={clientId} clientState={client?.state} />}
      {tab === "Payroll" && clientId && <PayrollTab clientId={clientId} clientState={client?.state} />}
      {tab === "Employees" && clientId && <EmployeesTab clientId={clientId} clientState={client?.state} />}
      {tab === "Contractors" && clientId && <ContractorsTab clientId={clientId} />}
      {tab === "Manual JE" && clientId && <ManualJeTab clientId={clientId} />}
      {tab === "GL" && clientId && <GlTab clientId={clientId} />}
      {tab === "Paychecks" && clientId && <PaychecksTab clientId={clientId} />}
      {tab === "Month-End" && clientId && <MonthEndTab clientId={clientId} />}
      {tab === "Check Settings" && clientId && <CheckSettingsTab clientId={clientId} />}
      {tab === "Year-End" && clientId && <YearEndTab clientId={clientId} clientState={client?.state} />}
      {tab === "Tax Rates" && <TaxRatesTab />}
      {tab === "COA" && <CoaTab />}
    </div>
  );
}

function Panel({ title, note, action, children }: { title: string; note?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="command-panel" style={{ marginBottom: 20 }}>
      <div className="command-panel-header">
        <div><h2 className="command-panel-title">{title}</h2>{note && <div className="command-panel-note">{note}</div>}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

interface SalesTaxCategory { category_id: string; category_name: string; state: string | null; default_rate_id: string | null; display_order: number }
interface SalesCategoryLine { categoryId: string; taxableAmount: string }
const EMPTY_SALES_LINE: SalesCategoryLine = { categoryId: "", taxableAmount: "" };

/** Category dropdown sorted so the client's own state's categories appear first — advisory ordering only, every active category is always selectable. */
function sortCategoriesByRelevance(categories: SalesTaxCategory[], clientState?: string | null): SalesTaxCategory[] {
  return [...categories].sort((a, b) => {
    const aMatch = clientState && a.state === clientState ? 0 : 1;
    const bMatch = clientState && b.state === clientState ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
    return a.display_order - b.display_order;
  });
}

function CategoryLinesEditor({ lines, setLines, categories, clientState }: {
  lines: SalesCategoryLine[]; setLines: (fn: (lines: SalesCategoryLine[]) => SalesCategoryLine[]) => void;
  categories: SalesTaxCategory[]; clientState?: string | null;
}) {
  const sorted = sortCategoriesByRelevance(categories, clientState);
  function updateLine(i: number, patch: Partial<SalesCategoryLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }
  return (
    <div>
      <SubLabel>Sales by Category</SubLabel>
      {lines.map((line, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr auto", gap: 8, alignItems: "end", marginBottom: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            {i === 0 && <label>Category</label>}
            <select value={line.categoryId} onChange={(e) => updateLine(i, { categoryId: e.target.value })}>
              <option value="">Select a category…</option>
              {sorted.map((c) => <option key={c.category_id} value={c.category_id}>{c.category_name}{c.state ? ` (${c.state})` : ""}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            {i === 0 && <label>Taxable Amount</label>}
            <input type="number" step="0.01" value={line.taxableAmount} onChange={(e) => updateLine(i, { taxableAmount: e.target.value })} />
          </div>
          <button type="button" className="btn btn-sm" disabled={lines.length <= 1} onClick={() => removeLine(i)}>✕</button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => setLines((prev) => [...prev, { ...EMPTY_SALES_LINE }])}>+ Add Category</button>
    </div>
  );
}

function SalesTab({ clientId, clientState }: { clientId: string; clientState?: string | null }) {
  const [sales, setSales] = useState<any[]>([]);
  const [categories, setCategories] = useState<SalesTaxCategory[]>([]);
  const [form, setForm] = useState({ saleDate: "", grossSales: "", adjustments: "", paymentDate: "", notes: "" });
  const [lines, setLines] = useState<SalesCategoryLine[]>([{ ...EMPTY_SALES_LINE }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ saleDate: "", grossSales: "", adjustments: "", paymentDate: "", notes: "" });
  const [editLines, setEditLines] = useState<SalesCategoryLine[]>([{ ...EMPTY_SALES_LINE }]);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [estimatedTax, setEstimatedTax] = useState<number | null>(null);
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { start, end };
  });

  function load() {
    api.get<{ sales: any[] }>(`/accounting/sales/${clientId}`).then((r) => setSales(r.sales)).catch(() => {});
  }
  useEffect(load, [clientId]);
  useEffect(() => {
    const qs = clientState ? `?state=${encodeURIComponent(clientState)}` : "";
    api.get<{ categories: SalesTaxCategory[] }>(`/accounting/sales-categories${qs}`).then((r) => setCategories(r.categories)).catch(() => setCategories([]));
  }, [clientState]);

  const linesForPreview = (ls: SalesCategoryLine[]) => ls.filter((l) => l.categoryId && Number(l.taxableAmount) > 0).map((l) => ({ categoryId: l.categoryId, taxableAmount: Number(l.taxableAmount) }));

  useEffect(() => {
    const payloadLines = linesForPreview(lines);
    if (payloadLines.length === 0 && !Number(form.adjustments)) { setEstimatedTax(null); return; }
    const handle = setTimeout(() => {
      api.post<{ totalTaxDue: number }>("/accounting/sales/preview", {
        clientId, categoryLines: payloadLines, adjustments: Number(form.adjustments) || 0,
      }).then((r) => setEstimatedTax(r.totalTaxDue)).catch(() => setEstimatedTax(null));
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, JSON.stringify(lines), form.adjustments]);

  const salesInPeriod = sales.filter((s) => {
    const d = s.sale_date ? String(s.sale_date).slice(0, 10) : null;
    if (!d) return false;
    return (!period.start || d >= period.start) && (!period.end || d <= period.end);
  });
  const periodSales = salesInPeriod.reduce((sum, s) => sum + Number(s.gross_sales || 0), 0);
  const periodTax = salesInPeriod.reduce((sum, s) => sum + Number(s.total_tax_due || 0), 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/accounting/sales", {
        clientId, saleDate: form.saleDate, grossSales: Number(form.grossSales) || 0,
        categoryLines: linesForPreview(lines), adjustments: Number(form.adjustments) || 0,
        paymentDate: form.paymentDate, notes: form.notes,
      });
      setForm({ saleDate: "", grossSales: "", adjustments: "", paymentDate: "", notes: "" });
      setLines([{ ...EMPTY_SALES_LINE }]);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save sales input.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(s: any) {
    setEditing(s);
    setEditError(null);
    setEditForm({
      saleDate: s.sale_date ? String(s.sale_date).slice(0, 10) : "",
      grossSales: String(s.gross_sales ?? ""), adjustments: String(s.adjustments ?? ""),
      paymentDate: s.payment_date ? String(s.payment_date).slice(0, 10) : "", notes: s.notes || "",
    });
    const existingLines: SalesCategoryLine[] = (s.lines || []).map((l: any) => ({ categoryId: l.category_id, taxableAmount: String(l.taxable_amount ?? "") }));
    setEditLines(existingLines.length > 0 ? existingLines : [{ ...EMPTY_SALES_LINE }]);
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await api.patch(`/accounting/sales/${editing.sale_id}`, {
        saleDate: editForm.saleDate, grossSales: Number(editForm.grossSales) || 0,
        categoryLines: linesForPreview(editLines), adjustments: Number(editForm.adjustments) || 0,
        paymentDate: editForm.paymentDate, notes: editForm.notes,
      });
      setEditing(null);
      load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Could not save changes.");
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 16, alignItems: "start" }}>
      <Panel title="Sales Input" note={clientState ? `${clientState} sales tax by category` : "Sales tax by category"}>
        <form onSubmit={handleSubmit} style={{ padding: 16 }}>
          {error && <div className="error-banner">{error}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label>Date</label><input type="date" value={form.saleDate} onChange={(e) => setForm((f) => ({ ...f, saleDate: e.target.value }))} /></div>
            <div className="field"><label>Gross Sales</label><input type="number" step="0.01" value={form.grossSales} onChange={(e) => setForm((f) => ({ ...f, grossSales: e.target.value }))} /></div>
          </div>
          <CategoryLinesEditor lines={lines} setLines={setLines} categories={categories} clientState={clientState} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
            <div className="field"><label>Adjustments</label><input type="number" step="0.01" value={form.adjustments} onChange={(e) => setForm((f) => ({ ...f, adjustments: e.target.value }))} /></div>
            <div className="field"><label>Payment Date</label><input type="date" value={form.paymentDate} onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))} /></div>
          </div>
          <div className="field"><label>Notes</label><textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          {estimatedTax !== null && <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>Estimated Tax: <strong>{fmtMoney(estimatedTax)}</strong></p>}
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Sales Input"}</button>
        </form>
      </Panel>
      <Panel
        title="Recent Sales"
        note={`${sales.length} rows`}
        action={
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
            <input type="date" value={period.start} onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))} style={{ padding: "4px 6px" }} />
            <span className="muted">to</span>
            <input type="date" value={period.end} onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))} style={{ padding: "4px 6px" }} />
          </div>
        }
      >
        <div className="metric-grid" style={{ margin: 16 }}>
          <div className="metric"><div className="metric-label">Rows This Period</div><div className="metric-value">{salesInPeriod.length}</div></div>
          <div className="metric"><div className="metric-label">Period Sales</div><div className="metric-value">{fmtMoney(periodSales)}</div></div>
          <div className="metric"><div className="metric-label">Period Tax</div><div className="metric-value">{fmtMoney(periodTax)}</div></div>
        </div>
        {editing && (
          <form onSubmit={handleSaveEdit} className="card" style={{ margin: 16 }}>
            <strong>Edit sales record — {fmtDate(editing.sale_date)}</strong>
            {editError && <div className="error-banner">{editError}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field"><label>Date</label><input type="date" value={editForm.saleDate} onChange={(e) => setEditForm((f) => ({ ...f, saleDate: e.target.value }))} /></div>
              <div className="field"><label>Gross Sales</label><input type="number" step="0.01" value={editForm.grossSales} onChange={(e) => setEditForm((f) => ({ ...f, grossSales: e.target.value }))} /></div>
            </div>
            <CategoryLinesEditor lines={editLines} setLines={setEditLines} categories={categories} clientState={clientState} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
              <div className="field"><label>Adjustments</label><input type="number" step="0.01" value={editForm.adjustments} onChange={(e) => setEditForm((f) => ({ ...f, adjustments: e.target.value }))} /></div>
              <div className="field"><label>Payment Date</label><input type="date" value={editForm.paymentDate} onChange={(e) => setEditForm((f) => ({ ...f, paymentDate: e.target.value }))} /></div>
            </div>
            <div className="field"><label>Notes</label><textarea value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} /></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={editSaving}>{editSaving ? "Saving…" : "Save & Recalculate"}</button>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        )}
        <div className="scroll-list">
          <div className="table-scroll">
          <table>
            <thead><tr><th>Date</th><th>Gross</th><th>Categories</th><th>Tax Due</th><th>Payment</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.sale_id}>
                  <td>{fmtDate(s.sale_date)}</td>
                  <td>{fmtMoney(s.gross_sales)}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{(s.lines || []).map((l: any) => l.category_name).join(", ") || "—"}</td>
                  <td>{fmtMoney(s.total_tax_due)}</td>
                  <td className="muted">{fmtDate(s.payment_date)}</td>
                  <td className="muted">{s.notes || "—"}</td>
                  <td><button type="button" className="btn btn-sm" onClick={() => startEdit(s)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        {sales.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No sales recorded yet.</p>}
      </Panel>
    </div>
  );
}

const EMPTY_PAYROLL_FORM = {
  employee: "", payDate: "", payPeriodStart: "", payPeriodEnd: "", checkNumber: "", payType: "Hourly",
  regularHours: "", regularRate: "", overtimeHours: "", overtimeRate: "", bonusPay: "", commissionPay: "",
  otherTaxablePay: "", nonTaxableReimbursement: "", grossWages: "",
  preTaxRetirement: "", preTaxHealth: "", preTaxHsaFsa: "", postTaxDeduction: "", garnishment: "", otherDeduction: "",
  federalWithholding: "", stateTax: "", paymentMethodId: "", notes: "",
};

function SubLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", margin: "14px 0 6px" }}>{children}</div>;
}

function PayrollTab({ clientId, clientState }: { clientId: string; clientState?: string | null }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [paychecks, setPaychecks] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [form, setForm] = useState(EMPTY_PAYROLL_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { start, end };
  });

  function load() {
    api.get<{ employees: Employee[] }>(`/accounting/employees/${clientId}`).then((r) => setEmployees(r.employees.filter((e) => !String(e.worker_type || "").toLowerCase().includes("contractor")))).catch(() => {});
    api.get<{ paychecks: any[] }>(`/accounting/paychecks/${clientId}`).then((r) => setPaychecks(r.paychecks)).catch(() => {});
    api.get<{ paymentMethods: PaymentMethod[] }>(`/payment-methods/${clientId}`).then((r) => setPaymentMethods(r.paymentMethods)).catch(() => setPaymentMethods([]));
  }
  useEffect(load, [clientId]);

  const payrollDefault = paymentMethods.find((m) => m.default_for_payroll);

  const previewPayload = {
    clientId, employee: form.employee,
    regularHours: form.regularHours || undefined, regularRate: form.regularRate || undefined,
    overtimeHours: form.overtimeHours || undefined, overtimeRate: form.overtimeRate || undefined,
    bonusPay: form.bonusPay || undefined, commissionPay: form.commissionPay || undefined,
    otherTaxablePay: form.otherTaxablePay || undefined, nonTaxableReimbursement: form.nonTaxableReimbursement || undefined,
    grossWages: form.grossWages || undefined,
    preTaxRetirement: form.preTaxRetirement || undefined, preTaxHealth: form.preTaxHealth || undefined,
    preTaxHsaFsa: form.preTaxHsaFsa || undefined, postTaxDeduction: form.postTaxDeduction || undefined,
    garnishment: form.garnishment || undefined, otherDeduction: form.otherDeduction || undefined,
    federalWithholding: form.federalWithholding || undefined, stateTax: form.stateTax || undefined,
  };
  const previewKey = JSON.stringify(previewPayload);

  useEffect(() => {
    if (!form.employee) { setPreview(null); setPreviewError(null); return; }
    const handle = setTimeout(() => {
      api.post<any>("/accounting/payroll/preview", previewPayload)
        .then((r) => { setPreview(r); setPreviewError(null); })
        .catch((err) => { setPreview(null); setPreviewError(err instanceof ApiError ? err.message : "Could not calculate a preview."); });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, previewKey]);

  const paychecksInPeriod = paychecks.filter((p) => {
    const d = p.pay_date ? String(p.pay_date).slice(0, 10) : null;
    if (!d) return false;
    return (!period.start || d >= period.start) && (!period.end || d <= period.end);
  });
  const periodGross = paychecksInPeriod.reduce((s, p) => s + Number(p.gross_wages || 0), 0);
  const periodNet = paychecksInPeriod.reduce((s, p) => s + Number(p.net_pay || 0), 0);
  const periodEmployeeTaxes = paychecksInPeriod.reduce((s, p) => s + Number(p.employee_taxes || 0), 0);
  const periodDeductions = paychecksInPeriod.reduce((s, p) => s + Number(p.total_deductions || 0), 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<any>("/accounting/payroll", {
        clientId, employee: form.employee, payDate: form.payDate,
        payPeriodStart: form.payPeriodStart || undefined, payPeriodEnd: form.payPeriodEnd || undefined,
        checkNumber: form.checkNumber || undefined, payType: form.payType || undefined,
        regularHours: form.regularHours || undefined, regularRate: form.regularRate || undefined,
        overtimeHours: form.overtimeHours || undefined, overtimeRate: form.overtimeRate || undefined,
        bonusPay: form.bonusPay || undefined, commissionPay: form.commissionPay || undefined,
        otherTaxablePay: form.otherTaxablePay || undefined, nonTaxableReimbursement: form.nonTaxableReimbursement || undefined,
        grossWages: form.grossWages || undefined,
        preTaxRetirement: form.preTaxRetirement || undefined, preTaxHealth: form.preTaxHealth || undefined,
        preTaxHsaFsa: form.preTaxHsaFsa || undefined, postTaxDeduction: form.postTaxDeduction || undefined,
        garnishment: form.garnishment || undefined, otherDeduction: form.otherDeduction || undefined,
        federalWithholding: form.federalWithholding || undefined, stateTax: form.stateTax || undefined,
        paymentMethodId: form.paymentMethodId || undefined, notes: form.notes || undefined,
      });
      setResult(res);
      setForm(EMPTY_PAYROLL_FORM);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record payroll.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 16, alignItems: "start" }}>
      <Panel title="Create Paycheck" note="Live preview updates as you type">
        <form onSubmit={handleSubmit} style={{ padding: 16 }}>
          {error && <div className="error-banner">{error}</div>}
          {result && (
            <div className="card" style={{ marginBottom: 14, borderColor: "var(--teal)" }}>
              <strong>Paycheck created.</strong>
              <div style={{ marginTop: 6, fontSize: 13 }}>Gross {fmtMoney(result.gross)} · Employee taxes {fmtMoney(result.employeeTaxes)} · Net {fmtMoney(result.netPay)}</div>
            </div>
          )}

          <div className="field">
            <label>Employee</label>
            <select required value={form.employee} onChange={(e) => setForm((f) => ({ ...f, employee: e.target.value }))}>
              <option value="">Select an employee…</option>
              {employees.map((e) => <option key={e.employee_id} value={e.employee_name}>{e.employee_name}</option>)}
            </select>
          </div>
          {employees.length === 0 && <p className="muted" style={{ marginTop: -6 }}>No active employees yet — add one under the Employees tab first.</p>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label>Pay Date</label><input type="date" required value={form.payDate} onChange={(e) => setForm((f) => ({ ...f, payDate: e.target.value }))} /></div>
            <div className="field">
              <label>Pay Type</label>
              <select value={form.payType} onChange={(e) => setForm((f) => ({ ...f, payType: e.target.value }))}>
                <option>Hourly</option><option>Salary</option><option>Other</option>
              </select>
            </div>
            <div className="field"><label>Period Start</label><input type="date" value={form.payPeriodStart} onChange={(e) => setForm((f) => ({ ...f, payPeriodStart: e.target.value }))} /></div>
            <div className="field"><label>Period End</label><input type="date" value={form.payPeriodEnd} onChange={(e) => setForm((f) => ({ ...f, payPeriodEnd: e.target.value }))} /></div>
          </div>
          <div className="field"><label>Check Number (leave blank to auto-assign)</label><input value={form.checkNumber} onChange={(e) => setForm((f) => ({ ...f, checkNumber: e.target.value }))} /></div>

          <SubLabel>Earnings</SubLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label>Regular Hours</label><input type="number" step="0.01" value={form.regularHours} onChange={(e) => setForm((f) => ({ ...f, regularHours: e.target.value }))} /></div>
            <div className="field"><label>Regular Rate</label><input type="number" step="0.01" value={form.regularRate} onChange={(e) => setForm((f) => ({ ...f, regularRate: e.target.value }))} /></div>
            <div className="field"><label>Overtime Hours</label><input type="number" step="0.01" value={form.overtimeHours} onChange={(e) => setForm((f) => ({ ...f, overtimeHours: e.target.value }))} /></div>
            <div className="field"><label>Overtime Rate (defaults to 1.5×)</label><input type="number" step="0.01" value={form.overtimeRate} onChange={(e) => setForm((f) => ({ ...f, overtimeRate: e.target.value }))} /></div>
            <div className="field"><label>Bonus Pay</label><input type="number" step="0.01" value={form.bonusPay} onChange={(e) => setForm((f) => ({ ...f, bonusPay: e.target.value }))} /></div>
            <div className="field"><label>Commission Pay</label><input type="number" step="0.01" value={form.commissionPay} onChange={(e) => setForm((f) => ({ ...f, commissionPay: e.target.value }))} /></div>
            <div className="field"><label>Other Taxable Pay</label><input type="number" step="0.01" value={form.otherTaxablePay} onChange={(e) => setForm((f) => ({ ...f, otherTaxablePay: e.target.value }))} /></div>
            <div className="field"><label>Non-taxable Reimbursement</label><input type="number" step="0.01" value={form.nonTaxableReimbursement} onChange={(e) => setForm((f) => ({ ...f, nonTaxableReimbursement: e.target.value }))} /></div>
          </div>
          <div className="field"><label>Or Gross Wages (overrides all earnings above)</label><input type="number" step="0.01" value={form.grossWages} onChange={(e) => setForm((f) => ({ ...f, grossWages: e.target.value }))} /></div>

          <SubLabel>Deductions</SubLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label>Pre-tax Retirement</label><input type="number" step="0.01" value={form.preTaxRetirement} onChange={(e) => setForm((f) => ({ ...f, preTaxRetirement: e.target.value }))} /></div>
            <div className="field"><label>Pre-tax Health</label><input type="number" step="0.01" value={form.preTaxHealth} onChange={(e) => setForm((f) => ({ ...f, preTaxHealth: e.target.value }))} /></div>
            <div className="field"><label>Pre-tax HSA/FSA</label><input type="number" step="0.01" value={form.preTaxHsaFsa} onChange={(e) => setForm((f) => ({ ...f, preTaxHsaFsa: e.target.value }))} /></div>
            <div className="field"><label>Post-tax Deduction</label><input type="number" step="0.01" value={form.postTaxDeduction} onChange={(e) => setForm((f) => ({ ...f, postTaxDeduction: e.target.value }))} /></div>
            <div className="field"><label>Garnishment</label><input type="number" step="0.01" value={form.garnishment} onChange={(e) => setForm((f) => ({ ...f, garnishment: e.target.value }))} /></div>
            <div className="field"><label>Other Deduction</label><input type="number" step="0.01" value={form.otherDeduction} onChange={(e) => setForm((f) => ({ ...f, otherDeduction: e.target.value }))} /></div>
          </div>

          <SubLabel>Tax overrides (leave blank to auto-calculate)</SubLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label>Federal Withholding</label><input type="number" step="0.01" value={form.federalWithholding} onChange={(e) => setForm((f) => ({ ...f, federalWithholding: e.target.value }))} /></div>
            <div className="field"><label>{clientState || "State"} Withholding</label><input type="number" step="0.01" value={form.stateTax} onChange={(e) => setForm((f) => ({ ...f, stateTax: e.target.value }))} /></div>
          </div>

          <SubLabel>Payment</SubLabel>
          <div className="field">
            <label>Payment Method (bank info for the check)</label>
            <select value={form.paymentMethodId} onChange={(e) => setForm((f) => ({ ...f, paymentMethodId: e.target.value }))}>
              <option value="">{payrollDefault ? `Use payroll default — ${payrollDefault.method_name}` : "No payroll default set — check will have no bank info"}</option>
              {paymentMethods.map((m) => <option key={m.payment_method_id} value={m.payment_method_id}>{m.method_name} ({m.method_type}){m.default_for_payroll ? " · default" : ""}</option>)}
            </select>
          </div>
          {!payrollDefault && paymentMethods.length === 0 && (
            <p className="muted" style={{ marginTop: -6, fontSize: 12 }}>This client has no payment methods on file — add one under Client Detail → Payment Methods first.</p>
          )}
          <div className="field"><label>Notes</label><textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>

          {previewError && <p className="muted" style={{ fontSize: 12, color: "var(--red)" }}>{previewError}</p>}
          {preview && (
            <div className="metric-grid" style={{ margin: "12px 0 16px", gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Gross</div><div className="metric-value">{fmtMoney(preview.gross)}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Taxable Wages</div><div className="metric-value">{fmtMoney(preview.federalTaxableWages)}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Deductions</div><div className="metric-value">{fmtMoney(preview.totalDeductions)}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Employee Taxes</div><div className="metric-value">{fmtMoney(preview.employeeTaxes)}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Net Pay</div><div className="metric-value" style={{ color: "var(--teal)" }}>{fmtMoney(preview.netPay)}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Total Cost</div><div className="metric-value">{fmtMoney(preview.totalCost)}</div></div>
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Calculating…" : "Create Paycheck"}</button>
        </form>
      </Panel>
      <Panel
        title="Recent Paychecks"
        note={`${paychecks.length} rows`}
        action={
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
            <input type="date" value={period.start} onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))} style={{ padding: "4px 6px" }} />
            <span className="muted">to</span>
            <input type="date" value={period.end} onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))} style={{ padding: "4px 6px" }} />
          </div>
        }
      >
        <div className="metric-grid" style={{ margin: 16 }}>
          <div className="metric"><div className="metric-label">Gross Wages</div><div className="metric-value">{fmtMoney(periodGross)}</div></div>
          <div className="metric"><div className="metric-label">Net Pay</div><div className="metric-value">{fmtMoney(periodNet)}</div></div>
          <div className="metric"><div className="metric-label">Employee Taxes</div><div className="metric-value">{fmtMoney(periodEmployeeTaxes)}</div></div>
          <div className="metric"><div className="metric-label">Deductions</div><div className="metric-value">{fmtMoney(periodDeductions)}</div></div>
          <div className="metric"><div className="metric-label">Checks</div><div className="metric-value">{paychecksInPeriod.length}</div></div>
        </div>
        <div className="scroll-list">
          <div className="table-scroll">
          <table>
            <thead><tr><th>Pay Date</th><th>Employee</th><th>Gross</th><th>Net Pay</th></tr></thead>
            <tbody>
              {paychecksInPeriod.map((p) => (
                <tr key={p.paycheck_id}>
                  <td>{fmtDate(p.pay_date)}</td>
                  <td>{p.employee}</td>
                  <td>{fmtMoney(p.gross_wages)}</td>
                  <td>{fmtMoney(p.net_pay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        {paychecksInPeriod.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No paychecks in this period.</p>}
      </Panel>
    </div>
  );
}

function EmployeesTab({ clientId, clientState }: { clientId: string; clientState?: string | null }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showForm, setShowForm] = useState(false);
  const EMPTY_EMPLOYEE_FORM = { employeeName: "", email: "", phone: "", workerType: "Employee", payType: "Hourly", payRate: "", defaultHours: "", defaultGrossWages: "", payFrequency: "", serviceCategory: "", grantPortalAccess: false, streetAddress: "", city: "", zipCode: "", state: clientState || "" };
  const [form, setForm] = useState(EMPTY_EMPLOYEE_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear()));
  const [printing, setPrinting] = useState<string | null>(null);
  const [viewingW2, setViewingW2] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<string | null>(null);

  async function handleViewW2(emp: Employee) {
    setViewingW2(emp.employee_id);
    try {
      await viewFile(`/accounting/tax-forms/w2/${emp.employee_id}?year=${taxYear}`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this W-2.");
    } finally {
      setViewingW2(null);
    }
  }

  async function handlePrintW2(emp: Employee) {
    setPrinting(emp.employee_id);
    try {
      await downloadFile(`/accounting/tax-forms/w2/${emp.employee_id}?year=${taxYear}`, `W2_${taxYear}_${emp.employee_name.replace(/\s+/g, "_")}.pdf`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this W-2.");
    } finally {
      setPrinting(null);
    }
  }

  async function handleArchive(emp: Employee) {
    if (!confirm(`Archive ${emp.employee_name}? Past payroll/1099 history is kept, but they'll drop off active lists.`)) return;
    try {
      await api.post(`/accounting/employees/${emp.employee_id}/archive`, {});
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not archive this profile.");
    }
  }

  function load() {
    api.get<{ employees: Employee[] }>(`/accounting/employees/${clientId}`).then((r) => setEmployees(r.employees)).catch(() => {});
  }
  useEffect(load, [clientId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setInviteResult(null);
    try {
      const res = await api.post<{ inviteLink?: string; employeeId: string }>("/accounting/employees", { clientId, ...form, payRate: Number(form.payRate) || 0, defaultHours: Number(form.defaultHours) || undefined, defaultGrossWages: Number(form.defaultGrossWages) || 0 });
      if (form.streetAddress.trim() || form.city.trim() || form.zipCode.trim() || form.state.trim()) {
        await api.patch(`/accounting/employees/${res.employeeId}/sensitive`, {
          streetAddress: form.streetAddress.trim(), city: form.city.trim(), zipCode: form.zipCode.trim(), state: form.state.trim(),
        });
      }
      if (res.inviteLink) setInviteResult(res.inviteLink);
      setShowForm(false);
      setForm(EMPTY_EMPLOYEE_FORM);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn btn-primary" style={{ marginBottom: 16 }} onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Add Employee"}</button>
      {inviteResult && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--teal)" }}>
          Portal access granted. Send this invite link to the employee: <code style={{ wordBreak: "break-all" }}>{inviteResult}</code>
        </div>
      )}
      {showForm && (
        <form onSubmit={handleSubmit} className="card" style={{ maxWidth: 460, marginBottom: 20 }}>
          {error && <div className="error-banner">{error}</div>}
          <div className="field"><label>Name</label><input required value={form.employeeName} onChange={(e) => setForm((f) => ({ ...f, employeeName: e.target.value }))} /></div>
          <div className="field"><label>Worker Type</label><select value={form.workerType} onChange={(e) => setForm((f) => ({ ...f, workerType: e.target.value }))}><option>Employee</option><option>Contractor</option></select></div>
          <div className="field"><label>Pay Type</label><select value={form.payType} onChange={(e) => setForm((f) => ({ ...f, payType: e.target.value }))}><option>Hourly</option><option>Salary</option><option>1099</option></select></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label>Pay Rate</label><input type="number" step="0.01" value={form.payRate} onChange={(e) => setForm((f) => ({ ...f, payRate: e.target.value }))} /></div>
            <div className="field"><label>Default Hours</label><input type="number" value={form.defaultHours} onChange={(e) => setForm((f) => ({ ...f, defaultHours: e.target.value }))} /></div>
          </div>
          <div className="field"><label>Default Gross Wages</label><input type="number" step="0.01" value={form.defaultGrossWages} onChange={(e) => setForm((f) => ({ ...f, defaultGrossWages: e.target.value }))} /></div>
          <div className="field"><label>Pay Frequency</label><input value={form.payFrequency} onChange={(e) => setForm((f) => ({ ...f, payFrequency: e.target.value }))} placeholder="e.g. Weekly, Bi-Weekly" /></div>
          {form.workerType === "Contractor" && (
            <div className="field"><label>Service Category</label><input value={form.serviceCategory} onChange={(e) => setForm((f) => ({ ...f, serviceCategory: e.target.value }))} placeholder="e.g. Contract Labor" /></div>
          )}
          <div className="field"><label>Email</label><input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
          <div className="field"><label>Phone</label><input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
          <AddressFields
            idPrefix="emp"
            showStateField={false}
            value={{ street: form.streetAddress, city: form.city, state: form.state, zip: form.zipCode }}
            onChange={(patch) => setForm((f) => ({
              ...f,
              streetAddress: patch.street ?? f.streetAddress,
              city: patch.city ?? f.city,
              zipCode: patch.zip ?? f.zipCode,
              state: patch.state ?? f.state,
            }))}
          />
          <div className="field">
            <label>Home State (drives state withholding/SUTA)</label>
            <select value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}>
              <option value="">Select state…</option>
              {US_STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          {form.workerType === "Employee" && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, margin: "8px 0 12px" }}>
              <input type="checkbox" checked={form.grantPortalAccess} onChange={(e) => setForm((f) => ({ ...f, grantPortalAccess: e.target.checked }))} />
              Grant employee portal access (requires an email above)
            </label>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </form>
      )}
      <Panel
        title="Employees & Contractors"
        note={`${employees.length} profiles`}
        action={
          <div className="field" style={{ margin: 0 }}>
            <label>Tax Year</label>
            <input type="number" value={taxYear} onChange={(e) => setTaxYear(e.target.value)} style={{ width: 90 }} />
          </div>
        }
      >
        <div className="table-scroll">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Pay Type</th><th>State</th><th>Rate</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {employees.map((e) => {
              const isContractor = String(e.worker_type || "").toLowerCase().includes("contractor");
              return (
                <tr key={e.employee_id}>
                  <td><Link to={`/employees/${e.employee_id}`}>{e.employee_name}</Link></td>
                  <td className="muted">{e.worker_type || "Employee"}</td>
                  <td className="muted">{e.pay_type || "—"}</td>
                  <td className="muted">{e.state || "—"}</td>
                  <td>{fmtMoney(e.pay_rate)}</td>
                  <td className="muted">{e.status}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <Link to={`/employees/${e.employee_id}`} className="btn btn-sm" style={{ textDecoration: "none" }}>Profile</Link>
                    {!isContractor && (
                      <>
                        <button type="button" className="btn btn-sm" disabled={viewingW2 === e.employee_id} onClick={() => handleViewW2(e)}>
                          {viewingW2 === e.employee_id ? "Generating…" : "View W-2"}
                        </button>
                        <button type="button" className="btn btn-sm" disabled={printing === e.employee_id} onClick={() => handlePrintW2(e)}>
                          {printing === e.employee_id ? "Generating…" : "Download W-2"}
                        </button>
                      </>
                    )}
                    {String(e.status || "").toLowerCase() !== "archived" && (
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => handleArchive(e)}>Archive</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {employees.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No employees or contractors added yet.</p>}
      </Panel>
    </div>
  );
}

const EMPTY_CONTRACTOR_PAYMENT_FORM = {
  contractorId: "", amount: "", paymentDate: "", method: "Check", paymentMethodId: "",
  checkNumber: "", confirmationNumber: "", expenseCategory: "", eligible1099: true, memo: "",
};
const CONTRACTOR_PAYMENT_METHODS = ["Check", "ACH", "Zelle", "Cash", "Card", "Other"];

function ContractorsTab({ clientId }: { clientId: string }) {
  const [contractors, setContractors] = useState<Employee[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [form, setForm] = useState(EMPTY_CONTRACTOR_PAYMENT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [necContractorId, setNecContractorId] = useState("");
  const [necYear, setNecYear] = useState(String(new Date().getFullYear()));
  const [printingNec, setPrintingNec] = useState(false);
  const [viewingNec, setViewingNec] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_CONTRACTOR_PAYMENT_FORM);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);

  async function handleViewNec() {
    if (!necContractorId) return;
    setViewingNec(true);
    try {
      await viewFile(`/accounting/tax-forms/1099nec/${necContractorId}?year=${necYear}`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this 1099-NEC.");
    } finally {
      setViewingNec(false);
    }
  }

  async function handlePrintNec(e: FormEvent) {
    e.preventDefault();
    if (!necContractorId) return;
    setPrintingNec(true);
    try {
      const contractor = contractors.find((c) => c.employee_id === necContractorId);
      await downloadFile(`/accounting/tax-forms/1099nec/${necContractorId}?year=${necYear}`, `1099NEC_${necYear}_${(contractor?.employee_name || necContractorId).replace(/\s+/g, "_")}.pdf`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this 1099-NEC.");
    } finally {
      setPrintingNec(false);
    }
  }

  function load() {
    api.get<{ employees: Employee[] }>(`/accounting/employees/${clientId}`).then((r) => setContractors(r.employees.filter((e) => String(e.worker_type || "").toLowerCase().includes("contractor")))).catch(() => {});
    api.get<{ contractorPayments: any[] }>(`/accounting/contractor-payments/${clientId}`).then((r) => setPayments(r.contractorPayments)).catch(() => {});
    api.get<{ paymentMethods: PaymentMethod[] }>(`/payment-methods/${clientId}`).then((r) => setPaymentMethods(r.paymentMethods)).catch(() => setPaymentMethods([]));
  }
  useEffect(load, [clientId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/accounting/contractor-payments", {
        clientId, contractorId: form.contractorId, amount: Number(form.amount) || 0, paymentDate: form.paymentDate,
        method: form.method, paymentMethodId: form.paymentMethodId || undefined,
        checkNumber: form.checkNumber || undefined, confirmationNumber: form.confirmationNumber || undefined,
        expenseCategory: form.expenseCategory, eligible1099: form.eligible1099, memo: form.memo,
      });
      setForm(EMPTY_CONTRACTOR_PAYMENT_FORM);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record this payment.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(p: any) {
    setEditing(p);
    setEditError(null);
    setEditForm({
      contractorId: p.contractor_id || "", amount: String(p.amount ?? ""), paymentDate: p.payment_date ? String(p.payment_date).slice(0, 10) : "",
      method: p.method || "Check", paymentMethodId: p.payment_method_id || "",
      checkNumber: p.check_number || "", confirmationNumber: p.confirmation_number || "",
      expenseCategory: p.expense_category || "", eligible1099: Boolean(p.is_1099_eligible), memo: p.memo || "",
    });
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await api.patch(`/accounting/contractor-payments/${editing.contractor_payment_id}`, {
        amount: Number(editForm.amount) || 0, paymentDate: editForm.paymentDate, method: editForm.method,
        paymentMethodId: editForm.paymentMethodId || undefined,
        checkNumber: editForm.checkNumber || undefined, confirmationNumber: editForm.confirmationNumber || undefined,
        expenseCategory: editForm.expenseCategory, eligible1099: editForm.eligible1099, memo: editForm.memo,
      });
      setEditing(null);
      load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Could not save changes.");
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 16, alignItems: "start" }}>
      <Panel title="Record Contractor Payment">
        <form onSubmit={handleSubmit} style={{ padding: 16 }}>
          {error && <div className="error-banner">{error}</div>}
          <div className="field">
            <label>Contractor</label>
            <select required value={form.contractorId} onChange={(e) => setForm((f) => ({ ...f, contractorId: e.target.value }))}>
              <option value="">Select a contractor…</option>
              {contractors.map((c) => <option key={c.employee_id} value={c.employee_id}>{c.employee_name}</option>)}
            </select>
          </div>
          {contractors.length === 0 && <p className="muted" style={{ marginTop: -6 }}>No contractor profiles yet — add one under the Employees tab (Worker Type: Contractor) first.</p>}
          <div className="field"><label>Amount</label><input type="number" step="0.01" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></div>
          <div className="field"><label>Payment Date</label><input type="date" value={form.paymentDate} onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label>Method</label><select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>{CONTRACTOR_PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
            <div className="field">
              <label>1099 Eligible</label>
              <select value={form.eligible1099 ? "yes" : "no"} onChange={(e) => setForm((f) => ({ ...f, eligible1099: e.target.value === "yes" }))}>
                <option value="yes">Yes</option><option value="no">No</option>
              </select>
            </div>
            <div className="field"><label>Check #</label><input value={form.checkNumber} onChange={(e) => setForm((f) => ({ ...f, checkNumber: e.target.value }))} /></div>
            <div className="field"><label>Confirmation #</label><input value={form.confirmationNumber} onChange={(e) => setForm((f) => ({ ...f, confirmationNumber: e.target.value }))} /></div>
          </div>
          <div className="field">
            <label>Payment Profile (bank info for the check)</label>
            <select value={form.paymentMethodId} onChange={(e) => setForm((f) => ({ ...f, paymentMethodId: e.target.value }))}>
              <option value="">No bank profile — free-text method only</option>
              {paymentMethods.map((m) => <option key={m.payment_method_id} value={m.payment_method_id}>{m.method_name} ({m.method_type})</option>)}
            </select>
          </div>
          <div className="field"><label>Expense Category</label><input value={form.expenseCategory} onChange={(e) => setForm((f) => ({ ...f, expenseCategory: e.target.value }))} placeholder="e.g. Contract Labor" /></div>
          <div className="field"><label>Memo</label><input value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} /></div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Record Payment"}</button>
        </form>
      </Panel>
      <Panel title="Recent Contractor Payments" note={`${payments.length} rows`}>
        {viewing && (
          <div className="card" style={{ margin: 16 }}>
            <strong>Payment — {viewing.contractor_name}</strong>
            <div style={{ marginTop: 8, fontSize: 13, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
              <div><span className="muted">Date:</span> {fmtDate(viewing.payment_date)}</div>
              <div><span className="muted">Amount:</span> {fmtMoney(viewing.amount)}</div>
              <div><span className="muted">Method:</span> {viewing.method || "—"}</div>
              <div><span className="muted">1099 Eligible:</span> {viewing.is_1099_eligible ? "Yes" : "No"}</div>
              <div><span className="muted">Check #:</span> {viewing.check_number || "—"}</div>
              <div><span className="muted">Confirmation #:</span> {viewing.confirmation_number || "—"}</div>
              <div><span className="muted">Category:</span> {viewing.expense_category || "—"}</div>
              <div><span className="muted">Status:</span> {viewing.status || "—"}</div>
              <div style={{ gridColumn: "1 / -1" }}><span className="muted">Memo:</span> {viewing.memo || "—"}</div>
            </div>
            <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setViewing(null)}>Close</button>
          </div>
        )}
        {editing && (
          <form onSubmit={handleSaveEdit} className="card" style={{ margin: 16 }}>
            <strong>Edit payment — {editing.contractor_name}</strong>
            {editError && <div className="error-banner">{editError}</div>}
            <div className="field"><label>Amount</label><input type="number" step="0.01" required value={editForm.amount} onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))} /></div>
            <div className="field"><label>Payment Date</label><input type="date" value={editForm.paymentDate} onChange={(e) => setEditForm((f) => ({ ...f, paymentDate: e.target.value }))} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field"><label>Method</label><select value={editForm.method} onChange={(e) => setEditForm((f) => ({ ...f, method: e.target.value }))}>{CONTRACTOR_PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
              <div className="field">
                <label>1099 Eligible</label>
                <select value={editForm.eligible1099 ? "yes" : "no"} onChange={(e) => setEditForm((f) => ({ ...f, eligible1099: e.target.value === "yes" }))}>
                  <option value="yes">Yes</option><option value="no">No</option>
                </select>
              </div>
              <div className="field"><label>Check #</label><input value={editForm.checkNumber} onChange={(e) => setEditForm((f) => ({ ...f, checkNumber: e.target.value }))} /></div>
              <div className="field"><label>Confirmation #</label><input value={editForm.confirmationNumber} onChange={(e) => setEditForm((f) => ({ ...f, confirmationNumber: e.target.value }))} /></div>
            </div>
            <div className="field">
              <label>Payment Profile</label>
              <select value={editForm.paymentMethodId} onChange={(e) => setEditForm((f) => ({ ...f, paymentMethodId: e.target.value }))}>
                <option value="">No bank profile — free-text method only</option>
                {paymentMethods.map((m) => <option key={m.payment_method_id} value={m.payment_method_id}>{m.method_name} ({m.method_type})</option>)}
              </select>
            </div>
            <div className="field"><label>Expense Category</label><input value={editForm.expenseCategory} onChange={(e) => setEditForm((f) => ({ ...f, expenseCategory: e.target.value }))} /></div>
            <div className="field"><label>Memo</label><input value={editForm.memo} onChange={(e) => setEditForm((f) => ({ ...f, memo: e.target.value }))} /></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={editSaving}>{editSaving ? "Saving…" : "Save & Recalculate"}</button>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        )}
        <div className="scroll-list">
          <div className="table-scroll">
          <table>
            <thead><tr><th>Date</th><th>Contractor</th><th>Amount</th><th>Method</th><th>Category</th><th>1099</th><th>Memo</th><th></th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.contractor_payment_id}>
                  <td>{fmtDate(p.payment_date)}</td>
                  <td>{p.contractor_name}</td>
                  <td>{fmtMoney(p.amount)}</td>
                  <td className="muted">{p.method}</td>
                  <td className="muted">{p.expense_category || "—"}</td>
                  <td className="muted">{p.is_1099_eligible ? "Yes" : "No"}</td>
                  <td className="muted">{p.memo || "—"}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button type="button" className="btn btn-sm" onClick={() => setViewing(p)}>View</button>
                    <button type="button" className="btn btn-sm" onClick={() => startEdit(p)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        {payments.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No contractor payments yet.</p>}
      </Panel>
      <div style={{ gridColumn: "1 / -1" }}>
        <Panel title="1099-NEC">
          <form onSubmit={handlePrintNec} style={{ padding: 16, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="field" style={{ margin: 0, minWidth: 220 }}>
              <label>Contractor</label>
              <select required value={necContractorId} onChange={(e) => setNecContractorId(e.target.value)}>
                <option value="">Select a contractor…</option>
                {contractors.map((c) => <option key={c.employee_id} value={c.employee_id}>{c.employee_name}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Tax Year</label>
              <input type="number" value={necYear} onChange={(e) => setNecYear(e.target.value)} style={{ width: 90 }} />
            </div>
            <button type="button" className="btn" disabled={viewingNec || !necContractorId} onClick={handleViewNec}>{viewingNec ? "Generating…" : "View 1099-NEC"}</button>
            <button type="submit" className="btn btn-primary" disabled={printingNec || !necContractorId}>{printingNec ? "Generating…" : "Download 1099-NEC"}</button>
          </form>
        </Panel>
      </div>
    </div>
  );
}

function ManualJeTab({ clientId }: { clientId: string }) {
  const [lines, setLines] = useState([{ account: "", debit: "", credit: "", memo: "" }, { account: "", debit: "", credit: "", memo: "" }]);
  const [entryDate, setEntryDate] = useState("");
  const [ref, setRef] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [entries, setEntries] = useState<any[]>([]);

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01;

  function updateLine(i: number, patch: Partial<{ account: string; debit: string; credit: string; memo: string }>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, idx) => idx !== i));
  }

  function loadHistory() {
    api.get<{ entries: any[] }>(`/accounting/journal-entries/${clientId}`).then((r) => setEntries(r.entries)).catch(() => {});
  }
  useEffect(() => {
    api.get<{ accounts: CoaAccount[] }>("/accounting/coa").then((r) => setAccounts(r.accounts)).catch(() => {});
  }, []);
  useEffect(loadHistory, [clientId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.post<any>("/accounting/journal-entries", {
        clientId, entryDate, ref, description, notes,
        lines: lines.map((l) => ({ account: l.account, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, memo: l.memo })),
      });
      setSuccess(`Journal entry ${res.jeId} posted (${res.lines} lines).`);
      setLines([{ account: "", debit: "", credit: "", memo: "" }, { account: "", debit: "", credit: "", memo: "" }]);
      setDescription("");
      setRef("");
      setNotes("");
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post this journal entry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, alignItems: "start" }}>
      <Panel title="Manual Journal Entry" note="Debits must equal credits">
        <form onSubmit={handleSubmit} style={{ padding: 16 }}>
          {error && <div className="error-banner">{error}</div>}
          {success && <div className="card" style={{ marginBottom: 14, borderColor: "var(--teal)" }}>{success}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 4 }}>
            <div className="field"><label>Entry Date</label><input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div>
            <div className="field"><label>Reference</label><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Auto if left blank" /></div>
            <div className="field"><label>Description</label><input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <div className="field"><label>Notes</label><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Falls back to per-line memo" /></div>
          </div>
          {lines.map((line, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1.5fr auto", gap: 8, marginBottom: 8, alignItems: "end" }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Account</label>
                <select required value={line.account} onChange={(e) => updateLine(i, { account: e.target.value })}>
                  <option value="">Choose…</option>
                  {accounts.map((a) => <option key={a.account_id} value={a.account_name}>{a.account_name}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}><label>Debit</label><input type="number" step="0.01" value={line.debit} onChange={(e) => updateLine(i, { debit: e.target.value })} /></div>
              <div className="field" style={{ margin: 0 }}><label>Credit</label><input type="number" step="0.01" value={line.credit} onChange={(e) => updateLine(i, { credit: e.target.value })} /></div>
              <div className="field" style={{ margin: 0 }}><label>Memo</label><input value={line.memo} onChange={(e) => updateLine(i, { memo: e.target.value })} /></div>
              {lines.length > 2 && <button type="button" className="btn btn-sm btn-danger" onClick={() => removeLine(i)} title="Remove line">✕</button>}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button type="button" className="btn btn-sm" onClick={() => setLines((ls) => [...ls, { account: "", debit: "", credit: "", memo: "" }])}>+ Add Line</button>
          </div>
          <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
            Debits {fmtMoney(totalDebit)} · Credits {fmtMoney(totalCredit)} · {balanced ? <span style={{ color: "var(--green)", fontWeight: 700 }}>Balanced</span> : <span style={{ color: "var(--red)", fontWeight: 700 }}>Out of balance</span>}
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving || !balanced}>{saving ? "Posting…" : "Post Journal Entry"}</button>
        </form>
      </Panel>
      <Panel title="Recent Manual Entries" note={`${entries.length} entries`}>
        <div className="scroll-list">
          <div className="table-scroll">
          <table>
            <thead><tr><th>Date</th><th>Ref</th><th>Description</th><th>Lines</th><th>Total</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.journalEntryId}>
                  <td>{fmtDate(e.entryDate)}</td>
                  <td className="muted">{e.ref || "—"}</td>
                  <td>{e.description || "—"}</td>
                  <td className="muted">
                    {e.lines.map((l: any, idx: number) => (
                      <div key={idx}>{l.account}: {l.debit > 0 ? `Dr ${fmtMoney(l.debit)}` : `Cr ${fmtMoney(l.credit)}`}</div>
                    ))}
                  </td>
                  <td>{fmtMoney(e.lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        {entries.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No manual entries posted yet.</p>}
      </Panel>
    </div>
  );
}

function GlTab({ clientId }: { clientId: string }) {
  const [entries, setEntries] = useState<any[]>([]);
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { start, end };
  });

  useEffect(() => {
    api.get<{ glEntries: any[] }>(`/accounting/gl/${clientId}`).then((r) => setEntries(r.glEntries)).catch(() => {});
  }, [clientId]);

  const filtered = entries.filter((g) => {
    const d = g.entry_date ? String(g.entry_date).slice(0, 10) : null;
    if (!d) return false;
    return (!period.start || d >= period.start) && (!period.end || d <= period.end);
  });
  const totalDebit = filtered.reduce((s, g) => s + Number(g.debit || 0), 0);
  const totalCredit = filtered.reduce((s, g) => s + Number(g.credit || 0), 0);

  return (
    <Panel
      title="General Ledger"
      note={`${filtered.length} of ${entries.length} entries`}
      action={
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
          <input type="date" value={period.start} onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))} style={{ padding: "4px 6px" }} />
          <span className="muted">to</span>
          <input type="date" value={period.end} onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))} style={{ padding: "4px 6px" }} />
        </div>
      }
    >
      <div className="metric-grid" style={{ margin: 16 }}>
        <div className="metric"><div className="metric-label">Debits</div><div className="metric-value">{fmtMoney(totalDebit)}</div></div>
        <div className="metric"><div className="metric-label">Credits</div><div className="metric-value">{fmtMoney(totalCredit)}</div></div>
        <div className="metric">
          <div className="metric-label">Difference</div>
          <div className="metric-value" style={{ color: Math.abs(totalDebit - totalCredit) < 0.01 ? undefined : "var(--danger, #cf222e)" }}>{fmtMoney(Math.abs(totalDebit - totalCredit))}</div>
        </div>
      </div>
      <div className="table-scroll">
      <table>
        <thead><tr><th>Date</th><th>Ref</th><th>Account</th><th>Description</th><th>Debit</th><th>Credit</th><th>Source</th></tr></thead>
        <tbody>
          {filtered.slice(0, 60).map((g, i) => (
            <tr key={g.gl_entry_id || i}>
              <td>{fmtDate(g.entry_date)}</td>
              <td className="muted">{g.ref || "—"}</td>
              <td>{g.account}</td>
              <td className="muted">{g.description}</td>
              <td>{Number(g.debit) ? fmtMoney(g.debit) : "—"}</td>
              <td>{Number(g.credit) ? fmtMoney(g.credit) : "—"}</td>
              <td className="muted">{g.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {filtered.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No GL activity in this period.</p>}
      {filtered.length > 60 && <p className="muted" style={{ padding: "0 16px 12px" }}>Showing most recent 60 of {filtered.length}.</p>}
    </Panel>
  );
}

function PaychecksTab({ clientId }: { clientId: string }) {
  const [paychecks, setPaychecks] = useState<any[]>([]);
  const [printing, setPrinting] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ payDate: "", regularHours: "", regularRate: "", grossWages: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<{ paychecks: any[] }>(`/accounting/paychecks/${clientId}`).then((r) => setPaychecks(r.paychecks)).catch(() => {});
  }
  useEffect(load, [clientId]);

  async function handleView(p: any) {
    setViewing(p.paycheck_id);
    try {
      await viewFile(`/accounting/paychecks/${p.paycheck_id}/print`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this paycheck.");
    } finally {
      setViewing(null);
    }
  }

  async function handlePrint(p: any) {
    setPrinting(p.paycheck_id);
    try {
      await downloadFile(`/accounting/paychecks/${p.paycheck_id}/print`, `Paycheck_${p.check_number || p.paycheck_id}.pdf`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this paycheck.");
    } finally {
      setPrinting(null);
    }
  }

  async function handleDelete(p: any) {
    const confirmValue = prompt(`Permanently delete this paycheck for ${p.employee} (${fmtDate(p.pay_date)})? This cannot be undone. Type DELETE PAYCHECK to confirm.`);
    if (confirmValue === null) return;
    setDeleting(p.paycheck_id);
    try {
      await api.post(`/accounting/paychecks/${p.paycheck_id}/delete`, { confirm: confirmValue });
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not delete this paycheck.");
    } finally {
      setDeleting(null);
    }
  }

  function startEdit(p: any) {
    setEditing(p);
    setError(null);
    setEditForm({
      payDate: p.pay_date ? String(p.pay_date).slice(0, 10) : "",
      regularHours: String(p.regular_hours ?? p.hours ?? ""),
      regularRate: String(p.regular_rate ?? p.rate ?? ""),
      grossWages: String(p.gross_wages ?? ""),
    });
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/accounting/paychecks/${editing.paycheck_id}`, {
        payDate: editForm.payDate, regularHours: editForm.regularHours || undefined,
        regularRate: editForm.regularRate || undefined, grossWages: editForm.grossWages || undefined,
      });
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title="Paychecks" note={`${paychecks.length} rows`}>
      {editing && (
        <form onSubmit={handleSaveEdit} className="card" style={{ margin: 16, maxWidth: 460 }}>
          <strong>Edit paycheck — {editing.employee}</strong>
          {error && <div className="error-banner">{error}</div>}
          <div className="field"><label>Pay Date</label><input type="date" value={editForm.payDate} onChange={(e) => setEditForm((f) => ({ ...f, payDate: e.target.value }))} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label>Regular Hours</label><input type="number" step="0.01" value={editForm.regularHours} onChange={(e) => setEditForm((f) => ({ ...f, regularHours: e.target.value }))} /></div>
            <div className="field"><label>Regular Rate</label><input type="number" step="0.01" value={editForm.regularRate} onChange={(e) => setEditForm((f) => ({ ...f, regularRate: e.target.value }))} /></div>
          </div>
          <div className="field"><label>Or Gross Wages (overrides hours × rate)</label><input type="number" step="0.01" value={editForm.grossWages} onChange={(e) => setEditForm((f) => ({ ...f, grossWages: e.target.value }))} /></div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save & Recalculate"}</button>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
      <div className="scroll-list">
        <div className="table-scroll">
        <table>
          <thead><tr><th>Pay Date</th><th>Period</th><th>Check #</th><th>Employee</th><th>Gross</th><th>Employee Taxes</th><th>Net Pay</th><th>Employer Taxes</th><th>Total Cost</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {paychecks.map((p) => (
              <tr key={p.paycheck_id}>
                <td>{fmtDate(p.pay_date)}</td>
                <td className="muted">{p.pay_period_start || p.pay_period_end ? `${fmtDate(p.pay_period_start)} – ${fmtDate(p.pay_period_end)}` : "—"}</td>
                <td className="muted">{p.check_number || "—"}</td>
                <td>{p.employee}</td>
                <td>{fmtMoney(p.gross_wages)}</td>
                <td className="muted">{fmtMoney(p.employee_taxes)}</td>
                <td>{fmtMoney(p.net_pay)}</td>
                <td className="muted">{fmtMoney(p.employer_taxes)}</td>
                <td className="muted">{fmtMoney(p.total_cost)}</td>
                <td><StatusBadge status={p.status || "Created"} /></td>
                <td style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="btn btn-sm" disabled={viewing === p.paycheck_id} onClick={() => handleView(p)}>
                    {viewing === p.paycheck_id ? "Generating…" : "View"}
                  </button>
                  <button type="button" className="btn btn-sm" disabled={printing === p.paycheck_id} onClick={() => handlePrint(p)}>
                    {printing === p.paycheck_id ? "Generating…" : "Download"}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => startEdit(p)}>Edit</button>
                  <button type="button" className="btn btn-sm btn-danger" disabled={deleting === p.paycheck_id} onClick={() => handleDelete(p)}>
                    {deleting === p.paycheck_id ? "Deleting…" : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      {paychecks.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No paychecks yet.</p>}
    </Panel>
  );
}

interface CheckSettings {
  setting_id: string;
  check_position: string | null;
  paper_stock: string | null;
  micrx_offset: number | null;
  micry_offset: number | null;
  date_x: number | null;
  date_y: number | null;
  payee_x: number | null;
  payee_y: number | null;
  amount_x: number | null;
  amount_y: number | null;
  memo_x: number | null;
  memo_y: number | null;
  signature_x: number | null;
  signature_y: number | null;
  notes: string | null;
}

const CHECK_SETTING_FIELD_PAIRS: [string, keyof typeof EMPTY_CHECK_FORM, keyof typeof EMPTY_CHECK_FORM][] = [
  ["MICR Line", "micrXOffset", "micrYOffset"],
  ["Date", "dateX", "dateY"],
  ["Payee", "payeeX", "payeeY"],
  ["Amount", "amountX", "amountY"],
  ["Memo", "memoX", "memoY"],
  ["Signature", "signatureX", "signatureY"],
];

const EMPTY_CHECK_FORM = {
  checkPosition: "Bottom", paperStock: "", notes: "",
  micrXOffset: "", micrYOffset: "", dateX: "", dateY: "", payeeX: "", payeeY: "",
  amountX: "", amountY: "", memoX: "", memoY: "", signatureX: "", signatureY: "",
};

interface MonthEndItem {
  checklist_item_id: string | null;
  item_name: string;
  category: string | null;
  status: string;
  completed_at: string | null;
  completed_by: string | null;
  notes: string | null;
}

function currentPeriodValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function MonthEndTab({ clientId }: { clientId: string }) {
  const [period, setPeriod] = useState(currentPeriodValue());
  const [items, setItems] = useState<MonthEndItem[] | null>(null);
  const [doneCount, setDoneCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  function load() {
    setItems(null);
    api.get<{ items: MonthEndItem[]; doneCount: number }>(`/accounting/month-end/${clientId}?period=${period}`)
      .then((r) => { setItems(r.items); setDoneCount(r.doneCount); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the month-end checklist."));
  }
  useEffect(load, [clientId, period]);

  async function toggleItem(item: MonthEndItem) {
    const nextStatus = item.status.toLowerCase() === "done" ? "Not Started" : "Done";
    setSaving(item.item_name);
    try {
      await api.post(`/accounting/month-end/${clientId}/items`, { period, itemName: item.item_name, category: item.category, status: nextStatus });
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not update this item.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Panel
      title="Month-End Close Checklist"
      note={items ? `${doneCount} of ${items.length} complete` : undefined}
      action={
        <div className="field" style={{ margin: 0 }}>
          <label>Period</label>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </div>
      }
    >
      {error && <div className="error-banner" style={{ margin: 16 }}>{error}</div>}
      {!items && !error && <div className="spinner-wrap">Loading…</div>}
      {items && (
        <div className="table-scroll">
        <table>
          <thead><tr><th></th><th>Item</th><th>Category</th><th>Completed By</th><th>Completed At</th></tr></thead>
          <tbody>
            {items.map((item) => {
              const isDone = item.status.toLowerCase() === "done";
              return (
                <tr key={item.item_name} style={{ opacity: saving === item.item_name ? 0.6 : 1 }}>
                  <td><input type="checkbox" checked={isDone} disabled={saving === item.item_name} onChange={() => toggleItem(item)} /></td>
                  <td style={{ textDecoration: isDone ? "line-through" : "none" }}>{item.item_name}</td>
                  <td className="muted">{item.category || "—"}</td>
                  <td className="muted">{item.completed_by || "—"}</td>
                  <td className="muted">{item.completed_at ? new Date(item.completed_at).toLocaleDateString() : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </Panel>
  );
}

/**
 * Live check-layout preview ("Check Designer") — approximate, not pixel-perfect.
 * Base coordinates mirror drawCheck()'s real formulas in paycheckPdf.ts (L=36,
 * R=576, same row-flow math), so field positions and how they respond to X/Y
 * offsets are directionally correct, but this doesn't replicate every
 * conditional (2-line address, bank name presence) that the real PDF does —
 * for a byte-accurate check, use "Print Calibration Sheet" below instead,
 * which reuses the exact same drawing code the real check uses.
 */
function CheckDesignerPreview({ form }: { form: typeof EMPTY_CHECK_FORM }) {
  const n = (v: string) => Number(v) || 0;
  const L = 36, R = 576, H = 255;
  const dateY = 63, payeeY = 83, memoY = 149 + 20, signatureY = 149 + 22, micrY = H - 54;
  return (
    <div>
      <svg viewBox={`0 0 612 ${H}`} style={{ width: "100%", background: "#fff", border: "1px solid var(--line)", borderRadius: 8 }}>
        <text x={L} y={20} fontSize="11" fontWeight="700" fill="#222">{"{Client Name}"}</text>
        <text x={R} y={20} fontSize="11" fontWeight="700" fill="#222" textAnchor="end">{"{Check #}"}</text>

        <text x={R - 90 + n(form.dateX)} y={dateY + n(form.dateY)} fontSize="9" fill="#333">Date:</text>
        <line x1={R - 65 + n(form.dateX)} y1={dateY + 2 + n(form.dateY)} x2={R + n(form.dateX)} y2={dateY + 2 + n(form.dateY)} stroke="#999" />

        <text x={L + n(form.payeeX)} y={payeeY + n(form.payeeY)} fontSize="7" fill="#999">PAY TO THE ORDER OF</text>
        <line x1={L + 100 + n(form.payeeX)} y1={payeeY + 2 + n(form.payeeY)} x2={R - 100 + n(form.payeeX)} y2={payeeY + 2 + n(form.payeeY)} stroke="#999" />
        <rect x={R - 90 + n(form.amountX)} y={payeeY - 12 + n(form.amountY)} width={90} height={16} fill="none" stroke="#222" />
        <text x={R - 6 + n(form.amountX)} y={payeeY + n(form.amountY)} fontSize="9" fontWeight="700" fill="#222" textAnchor="end">$0.00</text>

        <text x={L + n(form.memoX)} y={memoY + n(form.memoY)} fontSize="7" fill="#999">MEMO</text>
        <line x1={L + 36 + n(form.memoX)} y1={memoY + 2 + n(form.memoY)} x2={L + 36 + 180 + n(form.memoX)} y2={memoY + 2 + n(form.memoY)} stroke="#999" />

        <line x1={R - 180 + n(form.signatureX)} y1={signatureY + n(form.signatureY)} x2={R + n(form.signatureX)} y2={signatureY + n(form.signatureY)} stroke="#999" />
        <text x={R + n(form.signatureX)} y={signatureY + 10 + n(form.signatureY)} fontSize="7" fill="#999" textAnchor="end">Authorized Signature</text>

        <text x={306 + n(form.micrXOffset)} y={micrY + n(form.micrYOffset)} fontSize="11" fill="#222" textAnchor="middle" fontFamily="monospace">⑈0000⑈ ⑆000000000⑆ 0000000000⑈</text>
      </svg>
      <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>Approximate preview, updates as you type. For a byte-accurate layout on real check stock, use "Print Calibration Sheet" below.</p>
    </div>
  );
}

function CheckSettingsTab({ clientId }: { clientId: string }) {
  const [settings, setSettings] = useState<CheckSettings | null>(null);
  const [form, setForm] = useState({ ...EMPTY_CHECK_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [calibrationBusy, setCalibrationBusy] = useState<string | null>(null);

  async function handleCalibrationSheet(mode: "view" | "download") {
    const key = mode;
    setCalibrationBusy(key);
    try {
      const path = `/accounting/check-settings/${clientId}/calibration-sheet`;
      if (mode === "view") await viewFile(path);
      else await downloadFile(path, `MICR_Calibration_${clientId}.pdf`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate the calibration sheet.");
    } finally {
      setCalibrationBusy(null);
    }
  }

  useEffect(() => {
    setSaved(false);
    api.get<{ checkSettings: CheckSettings | null }>(`/accounting/check-settings/${clientId}`).then((r) => {
      setSettings(r.checkSettings);
      if (r.checkSettings) {
        const s = r.checkSettings;
        setForm({
          checkPosition: s.check_position || "Bottom", paperStock: s.paper_stock || "", notes: s.notes || "",
          micrXOffset: String(s.micrx_offset ?? ""), micrYOffset: String(s.micry_offset ?? ""),
          dateX: String(s.date_x ?? ""), dateY: String(s.date_y ?? ""),
          payeeX: String(s.payee_x ?? ""), payeeY: String(s.payee_y ?? ""),
          amountX: String(s.amount_x ?? ""), amountY: String(s.amount_y ?? ""),
          memoX: String(s.memo_x ?? ""), memoY: String(s.memo_y ?? ""),
          signatureX: String(s.signature_x ?? ""), signatureY: String(s.signature_y ?? ""),
        });
      } else {
        setForm({ ...EMPTY_CHECK_FORM });
      }
    }).catch(() => {});
  }, [clientId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.post("/accounting/check-settings", { clientId, ...form });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save check settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
      <Panel title="Check Settings" note={settings ? `Last updated ${settings.setting_id}` : "No calibration saved yet for this client"}>
        <form onSubmit={handleSubmit} style={{ padding: 16 }}>
          {error && <div className="error-banner">{error}</div>}
          {saved && <div className="card" style={{ marginBottom: 14, borderColor: "var(--teal)" }}>Check settings saved.</div>}
          <p className="muted" style={{ marginTop: -4 }}>
            X/Y offsets (in points) used when printing a paycheck onto this client's pre-printed check stock.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label>Check Position</label>
              <select value={form.checkPosition} onChange={(e) => setForm((f) => ({ ...f, checkPosition: e.target.value }))}>
                <option>Top</option><option>Middle</option><option>Bottom</option>
              </select>
            </div>
            <div className="field"><label>Paper Stock</label><input value={form.paperStock} onChange={(e) => setForm((f) => ({ ...f, paperStock: e.target.value }))} placeholder="e.g. Deluxe 3-per-page" /></div>
          </div>
          {CHECK_SETTING_FIELD_PAIRS.map(([label, xKey, yKey]) => (
            <div key={label} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field"><label>{label} X</label><input type="number" step="0.1" value={form[xKey]} onChange={(e) => setForm((f) => ({ ...f, [xKey]: e.target.value }))} /></div>
              <div className="field"><label>{label} Y</label><input type="number" step="0.1" value={form[yKey]} onChange={(e) => setForm((f) => ({ ...f, [yKey]: e.target.value }))} /></div>
            </div>
          ))}
          <div className="field"><label>Notes</label><textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Check Settings"}</button>
        </form>
      </Panel>
      <div>
        <Panel title="Check Designer" note="Live preview of your current offsets">
          <div style={{ padding: 16 }}>
            <CheckDesignerPreview form={form} />
          </div>
        </Panel>
        <Panel title="MICR Calibration" note="Printable alignment sample sheet">
          <div style={{ padding: 16 }}>
            <p className="muted" style={{ marginTop: 0 }}>
              Prints a sample check with a 1-inch reference grid and labeled crosshairs at every field position, using your saved offsets above. Print it on the client's actual blank check stock, compare the crosshairs to the stock's pre-printed lines, and adjust the offsets above by the difference.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn" disabled={calibrationBusy !== null} onClick={() => handleCalibrationSheet("view")}>
                {calibrationBusy === "view" ? "Generating…" : "View Calibration Sheet"}
              </button>
              <button type="button" className="btn" disabled={calibrationBusy !== null} onClick={() => handleCalibrationSheet("download")}>
                {calibrationBusy === "download" ? "Generating…" : "Download Calibration Sheet"}
              </button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

interface YearEndEmployeeRow { employeeId: string; employeeName: string; ssnOnFile: boolean; wages: number; fedTax: number; mdTax: number; status: string; issues: string[] }
interface YearEndContractorRow { contractorId: string; contractorName: string; tinOnFile: boolean; nec: number; status: string; issues: string[] }

function YearEndTab({ clientId, clientState }: { clientId: string; clientState?: string | null }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [data, setData] = useState<{ clientIssues: string[]; employees: YearEndEmployeeRow[]; contractors: YearEndContractorRow[]; mdWithholdingSummary: { total: number; employeeCount: number } } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    api.get<any>(`/accounting/year-end-review/${clientId}?year=${year}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the year-end review."))
      .finally(() => setLoading(false));
  }
  useEffect(load, [clientId, year]);

  async function handlePrintForm(path: string, filename: string, key: string) {
    setBusy(key);
    try {
      await downloadFile(path, filename);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this form.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <Panel
        title="Year-End Forms Review"
        note="Check every employee/contractor is ready before generating tax forms"
        action={
          <div className="field" style={{ margin: 0 }}>
            <label>Tax Year</label>
            <input type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 100 }} />
          </div>
        }
      >
        {loading && <div className="spinner-wrap">Loading…</div>}
        {error && <div className="error-banner" style={{ margin: 16 }}>{error}</div>}
        {!loading && data && (
          <div style={{ padding: 16 }}>
            {data.clientIssues.length > 0 && (
              <div className="error-banner" style={{ marginBottom: 16 }}>
                {data.clientIssues.map((i) => <div key={i}>{i}</div>)}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <button type="button" className="btn" disabled={busy !== null} onClick={() => handlePrintForm(`/accounting/tax-forms/w3/${clientId}?year=${year}`, `W3_${year}_${clientId}.pdf`, "w3")}>
                {busy === "w3" ? "Generating…" : "Print W-3 Summary"}
              </button>
              <button type="button" className="btn" disabled={busy !== null} onClick={() => handlePrintForm(`/accounting/tax-forms/1096/${clientId}?year=${year}`, `1096_${year}_${clientId}.pdf`, "1096")}>
                {busy === "1096" ? "Generating…" : "Print 1096 Summary"}
              </button>
            </div>

            <div className="command-panel-header" style={{ padding: 0, marginBottom: 8 }}>
              <h2 className="command-panel-title" style={{ fontSize: 15 }}>W-2 Review ({data.employees.length})</h2>
            </div>
            <div className="scroll-list" style={{ marginBottom: 20 }}>
              <div className="table-scroll">
              <table>
                <thead><tr><th>Employee</th><th>SSN</th><th>Wages</th><th>Fed Tax</th><th>MD Tax</th><th>Status</th><th>Review Issues</th><th></th></tr></thead>
                <tbody>
                  {data.employees.map((e) => (
                    <tr key={e.employeeId}>
                      <td>{e.employeeName}</td>
                      <td className="muted">{e.ssnOnFile ? "On file" : "Missing"}</td>
                      <td>{fmtMoney(e.wages)}</td>
                      <td className="muted">{fmtMoney(e.fedTax)}</td>
                      <td className="muted">{fmtMoney(e.mdTax)}</td>
                      <td><StatusBadge status={e.status} /></td>
                      <td className="muted" style={{ fontSize: 11 }}>{e.issues.length > 0 ? e.issues.join("; ") : "—"}</td>
                      <td>
                        <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => handlePrintForm(`/accounting/tax-forms/w2/${e.employeeId}?year=${year}`, `W2_${year}_${e.employeeName.replace(/\s+/g, "_")}.pdf`, e.employeeId)}>
                          {busy === e.employeeId ? "Generating…" : "Print W-2"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
            {data.employees.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No employees on file.</p>}

            <div className="command-panel-header" style={{ padding: 0, marginBottom: 8 }}>
              <h2 className="command-panel-title" style={{ fontSize: 15 }}>1099-NEC Review ({data.contractors.length})</h2>
            </div>
            <div className="scroll-list" style={{ marginBottom: 20 }}>
              <div className="table-scroll">
              <table>
                <thead><tr><th>Contractor</th><th>TIN</th><th>NEC (Box 1a)</th><th>Status</th><th>Review Issues</th><th></th></tr></thead>
                <tbody>
                  {data.contractors.map((c) => (
                    <tr key={c.contractorId}>
                      <td>{c.contractorName}</td>
                      <td className="muted">{c.tinOnFile ? "On file" : "Missing"}</td>
                      <td>{fmtMoney(c.nec)}</td>
                      <td><StatusBadge status={c.status} /></td>
                      <td className="muted" style={{ fontSize: 11 }}>{c.issues.length > 0 ? c.issues.join("; ") : "—"}</td>
                      <td>
                        <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => handlePrintForm(`/accounting/tax-forms/1099nec/${c.contractorId}?year=${year}`, `1099NEC_${year}_${c.contractorName.replace(/\s+/g, "_")}.pdf`, c.contractorId)}>
                          {busy === c.contractorId ? "Generating…" : "Print 1099-NEC"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
            {data.contractors.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No contractors on file.</p>}

            <div className="command-panel-header" style={{ padding: 0, marginBottom: 8 }}>
              <h2 className="command-panel-title" style={{ fontSize: 15 }}>{clientState || "State"} Withholding Summary</h2>
            </div>
            <div className="metric-grid">
              <div className="metric"><div className="metric-label">Total {clientState || "State"} Withholding</div><div className="metric-value">{fmtMoney(data.mdWithholdingSummary.total)}</div></div>
              <div className="metric"><div className="metric-label">Employees</div><div className="metric-value">{data.mdWithholdingSummary.employeeCount}</div></div>
            </div>
            <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
              {clientState === "MD"
                ? "This is an in-app total for reference, not a filled Maryland MW508 form — file that directly with the Comptroller of Maryland."
                : "This is an in-app total for reference, not an official state filing form — file directly with this state's revenue agency."}
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}

const TAX_RATE_FORM_DEFAULTS = { rateId: "", rateType: "", rate: "", scope: "Global", clientId: "", employeeEmployer: "", wageCap: "", state: "", notes: "", active: true };

function TaxRatesTab() {
  const [rates, setRates] = useState<TaxRate[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(TAX_RATE_FORM_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function load() {
    api.get<{ taxRates: TaxRate[] }>("/accounting/tax-rates").then((r) => setRates(r.taxRates)).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load tax rates."));
  }
  useEffect(load, []);
  useEffect(() => { api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => {}); }, []);

  function startCreate() {
    setForm(TAX_RATE_FORM_DEFAULTS);
    setShowForm(true);
    setSaveError(null);
  }
  function startEdit(r: TaxRate) {
    setForm({
      rateId: r.rate_id, rateType: r.rate_type, rate: String(r.rate ?? ""), scope: r.scope || "Global",
      clientId: r.client_id || "", employeeEmployer: r.employee_employer || "", wageCap: r.wage_cap != null ? String(r.wage_cap) : "",
      state: r.state || "", notes: r.notes || "", active: r.active,
    });
    setShowForm(true);
    setSaveError(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await api.post("/accounting/tax-rates", { ...form, rate: Number(form.rate) });
      setShowForm(false);
      setForm(TAX_RATE_FORM_DEFAULTS);
      load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save this rate.");
    } finally {
      setSaving(false);
    }
  }

  // rowId is tax_rate_row_id (the DB surrogate PK), NOT rate_id — rate_id can be
  // shared by multiple rows (one per state/client), so it can't identify a single row.
  async function handleDeactivate(rowId: string) {
    if (!confirm("Deactivate this tax rate?")) return;
    await api.post(`/accounting/tax-rates/${rowId}/deactivate`, {}).catch((e) => alert(e.message));
    load();
  }
  async function handleActivate(rowId: string) {
    await api.post(`/accounting/tax-rates/${rowId}/activate`, {}).catch((e) => alert(e.message));
    load();
  }

  return (
    <div>
      <button className="btn btn-primary" style={{ marginBottom: 16 }} onClick={() => (showForm ? setShowForm(false) : startCreate())}>{showForm ? "Cancel" : "New Rate"}</button>
      {error && <div className="error-banner">{error}</div>}
      {showForm && (
        <form onSubmit={handleSave} className="card" style={{ maxWidth: 420, marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>{form.rateId ? `Edit ${form.rateId}` : "New Rate"}</h2>
          {saveError && <div className="error-banner">{saveError}</div>}
          <div className="field"><label>Rate Type</label><input required value={form.rateType} onChange={(e) => setForm((f) => ({ ...f, rateType: e.target.value }))} placeholder="e.g. Sales Tax 6" /></div>
          <div className="field"><label>Rate (decimal, e.g. 0.06 = 6%)</label><input type="number" step="0.0001" required value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} /></div>
          <div className="field"><label>Scope</label><select value={form.scope} onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value, clientId: e.target.value === "Global" ? "" : f.clientId }))}><option>Global</option><option>Client</option></select></div>
          {form.scope === "Client" && (
            <div className="field">
              <label>Client</label>
              <select required value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}>
                <option value="">Choose a client…</option>
                {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
              </select>
            </div>
          )}
          <div className="field"><label>Side</label><select value={form.employeeEmployer} onChange={(e) => setForm((f) => ({ ...f, employeeEmployer: e.target.value }))}><option value="">—</option><option value="Employee">Employee</option><option value="Employer">Employer</option><option value="Both">Both</option></select></div>
          <div className="field"><label>Wage Cap</label><input type="number" step="0.01" value={form.wageCap} onChange={(e) => setForm((f) => ({ ...f, wageCap: e.target.value }))} /></div>
          <div className="field"><label>State</label><input value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} placeholder="e.g. MD" /></div>
          <div className="field"><label>Notes</label><textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </form>
      )}
      {rates && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <div className="table-scroll">
            <table>
              <thead><tr><th>Rate ID</th><th>Rate Type</th><th>Scope</th><th>Client</th><th>Rate</th><th>Side</th><th>Wage Cap</th><th>State</th><th>Notes</th><th>Active</th><th></th></tr></thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.tax_rate_row_id || r.rate_id}>
                    <td className="muted">{r.rate_id}</td>
                    <td>{r.rate_type}</td>
                    <td className="muted">{r.scope || "Global"}</td>
                    <td className="muted">{r.client_name || "—"}</td>
                    <td>{(Number(r.rate) * 100).toFixed(2)}%</td>
                    <td className="muted">{r.employee_employer || "—"}</td>
                    <td className="muted">{r.wage_cap != null && r.wage_cap !== "" ? fmtMoney(r.wage_cap) : "—"}</td>
                    <td className="muted">{r.state || "—"}</td>
                    <td className="muted">{r.notes || "—"}</td>
                    <td>{r.active ? "Yes" : "No"}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-sm" onClick={() => startEdit(r)}>Edit</button>
                      {r.active ? <button className="btn btn-sm" onClick={() => handleDeactivate(String(r.tax_rate_row_id))}>Deactivate</button> : <button className="btn btn-sm" onClick={() => handleActivate(String(r.tax_rate_row_id))}>Activate</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const COA_FORM_DEFAULTS = {
  accountId: "", accountName: "", accountType: "Expense", detailType: "", normalBalance: "Debit",
  openingBalance: "", subAccountOf: "", taxLine: "", notes: "", active: true,
};

function CoaTab() {
  const [accounts, setAccounts] = useState<CoaAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(COA_FORM_DEFAULTS);
  const [saving, setSaving] = useState(false);

  function load() {
    api.get<{ accounts: CoaAccount[] }>("/accounting/coa").then((r) => setAccounts(r.accounts)).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load chart of accounts."));
  }
  useEffect(load, []);

  function startCreate() {
    setForm(COA_FORM_DEFAULTS);
    setShowForm(true);
  }
  function startEdit(a: CoaAccount) {
    setForm({
      accountId: a.account_id, accountName: a.account_name, accountType: a.account_type, detailType: a.detail_type || "",
      normalBalance: a.normal_balance || "Debit", openingBalance: a.opening_balance != null ? String(a.opening_balance) : "",
      subAccountOf: a.sub_account_of || "", taxLine: a.tax_line || "", notes: a.notes || "", active: a.active,
    });
    setShowForm(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/accounting/coa", form);
      setShowForm(false);
      setForm(COA_FORM_DEFAULTS);
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not save this account.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(accountId: string) {
    if (!confirm("Deactivate this account?")) return;
    await api.post(`/accounting/coa/${accountId}/deactivate`, {}).catch((e) => alert(e.message));
    load();
  }
  async function handleActivate(accountId: string) {
    await api.post(`/accounting/coa/${accountId}/activate`, {}).catch((e) => alert(e.message));
    load();
  }

  return (
    <div>
      <button className="btn btn-primary" style={{ marginBottom: 16 }} onClick={() => (showForm ? setShowForm(false) : startCreate())}>{showForm ? "Cancel" : "New Account"}</button>
      {error && <div className="error-banner">{error}</div>}
      {showForm && (
        <form onSubmit={handleSave} className="card" style={{ maxWidth: 420, marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>{form.accountId ? `Edit ${form.accountId}` : "New Account"}</h2>
          <div className="field"><label>Account Name</label><input required value={form.accountName} onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))} /></div>
          <div className="field"><label>Account Type</label><select value={form.accountType} onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value }))}><option>Asset</option><option>Liability</option><option>Equity</option><option>Revenue</option><option>Expense</option><option>COGS</option></select></div>
          <div className="field"><label>Detail Type</label><input value={form.detailType} onChange={(e) => setForm((f) => ({ ...f, detailType: e.target.value }))} placeholder="e.g. Checking, Accounts Receivable" /></div>
          <div className="field"><label>Normal Balance</label><select value={form.normalBalance} onChange={(e) => setForm((f) => ({ ...f, normalBalance: e.target.value }))}><option>Debit</option><option>Credit</option></select></div>
          <div className="field"><label>Opening Balance</label><input type="number" step="0.01" value={form.openingBalance} onChange={(e) => setForm((f) => ({ ...f, openingBalance: e.target.value }))} /></div>
          <div className="field"><label>Sub-account Of</label><input value={form.subAccountOf} onChange={(e) => setForm((f) => ({ ...f, subAccountOf: e.target.value }))} placeholder="Parent account name (optional)" /></div>
          <div className="field"><label>Tax Line</label><input value={form.taxLine} onChange={(e) => setForm((f) => ({ ...f, taxLine: e.target.value }))} /></div>
          <div className="field"><label>Notes</label><textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </form>
      )}
      {accounts && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <div className="table-scroll">
            <table>
              <thead><tr><th>Account #</th><th>Account</th><th>Type</th><th>Detail Type</th><th>Normal Balance</th><th>Balance</th><th>Active</th><th></th></tr></thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.account_id}>
                    <td className="muted">{a.account_id}</td>
                    <td>{a.account_name}</td>
                    <td className="muted">{a.account_type}</td>
                    <td className="muted">{a.detail_type || "—"}</td>
                    <td className="muted">{a.normal_balance || "—"}</td>
                    <td>{a.current_balance != null ? fmtMoney(a.current_balance) : "—"}</td>
                    <td>{a.active ? "Yes" : "No"}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-sm" onClick={() => startEdit(a)}>Edit</button>
                      {a.active ? <button className="btn btn-sm" onClick={() => handleDeactivate(a.account_id)}>Deactivate</button> : <button className="btn btn-sm" onClick={() => handleActivate(a.account_id)}>Activate</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
