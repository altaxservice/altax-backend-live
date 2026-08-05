import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { RefreshCw, Download } from "lucide-react";
import { api, ApiError, downloadFile, viewFile } from "../api/client";
import type { TaxRate, CoaAccount, Employee } from "../api/types2";
import type { Client } from "../api/types";
import { useSelectedClient } from "../context/SelectedClientContext";
import { fmtDateOnly as fmtDate } from "../utils/date";
import type { PaymentMethod } from "../api/types2";
import { StatusBadge } from "../components/StatusBadge";
import { US_STATES, PAYROLL_FREQS } from "../utils/clientOptions";
import { AddressFields } from "../components/AddressFields";
import { ErrorBanner } from "../components/ErrorBanner";
import { FileDropInput } from "../components/FileDropInput";
import { fileToBase64 } from "../utils/file";
import { ActionMenu, type ActionMenuOption } from "../components/ActionMenu";
import { useAuth } from "../auth/AuthContext";
import type { MdFilingResult } from "../api/calculators";
import { CALCULATOR_TO_SALES_INPUT_KEY } from "./CalculatorsPage";
import { useConfirm, usePrompt, useNotify } from "../components/ConfirmProvider";
import { exportCsv } from "../components/FilterBar";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

const TABS = ["Sales", "Payroll", "Employees", "Import", "Contractors", "Manual JE", "GL", "Paychecks", "Month-End", "Budget", "Bank Rec", "Check Settings", "Year-End", "Tax Rates", "COA"] as const;
type Tab = (typeof TABS)[number];
const CLIENT_SCOPED_TABS: Tab[] = ["Sales", "Payroll", "Employees", "Import", "Contractors", "Manual JE", "GL", "Paychecks", "Month-End", "Budget", "Bank Rec", "Check Settings", "Year-End"];

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

export function AccountingPage() {
  const { clientId: globalClientId, setSelectedClient } = useSelectedClient();
  const [searchParams] = useSearchParams();
  // ?tab=<name> lets other pages deep-link a specific tab — the Sales & Tax
  // report rows point here, and without this they would all land on Sales.
  const [tab, setTab] = useState<Tab>(() => {
    const wanted = searchParams.get("tab");
    return (TABS as readonly string[]).includes(wanted || "") ? (wanted as Tab) : "Sales";
  });
  const [clients, setClients] = useState<Client[]>([]);
  // ?client= wins over the globally selected client: links from reports and
  // profile pages point at a specific client's books, and landing on a
  // different client's ledger would be quietly wrong.
  const [clientId, setClientId] = useState(searchParams.get("client") || globalClientId || "");

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
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
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

      <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)", marginBottom: 20, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            style={{
              padding: "10px 16px", fontSize: 14, fontWeight: 500, cursor: "pointer", border: "none", font: "inherit", background: "transparent",
              color: tab === t ? "var(--ink)" : "var(--muted)",
              borderBottom: tab === t ? "2px solid var(--teal)" : "2px solid transparent",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {needsClient && !clientId && <p className="muted">Pick a client above to work in their books.</p>}
      {tab === "Sales" && clientId && <SalesTab clientId={clientId} clientState={client?.state} />}
      {tab === "Payroll" && clientId && <PayrollTab clientId={clientId} clientState={client?.state} />}
      {tab === "Employees" && clientId && <EmployeesTab clientId={clientId} clientState={client?.state} />}
      {tab === "Import" && clientId && <ImportTab clientId={clientId} />}
      {tab === "Contractors" && clientId && <ContractorsTab clientId={clientId} clientState={client?.state} />}
      {tab === "Manual JE" && clientId && <ManualJeTab clientId={clientId} />}
      {tab === "GL" && clientId && (
        <GlTab clientId={clientId} initialRef={searchParams.get("ref")} initialAccount={searchParams.get("account")} />
      )}
      {tab === "Paychecks" && clientId && <PaychecksTab clientId={clientId} />}
      {tab === "Month-End" && clientId && <MonthEndTab clientId={clientId} />}
      {tab === "Budget" && clientId && <BudgetTab clientId={clientId} />}
      {tab === "Bank Rec" && clientId && <BankRecTab clientId={clientId} />}
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
interface SalesPreviewLine { categoryId: string; categoryName: string; taxableAmount: number; rate: number; taxAmount: number }
interface SalesPreview { totalTaxDue: number; lines: SalesPreviewLine[] }
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
            <select aria-label={i === 0 ? undefined : `Category, row ${i + 1}`} value={line.categoryId} onChange={(e) => updateLine(i, { categoryId: e.target.value })}>
              <option value="">Select a category…</option>
              {sorted.map((c) => <option key={c.category_id} value={c.category_id}>{c.category_name}{c.state ? ` (${c.state})` : ""}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            {i === 0 && <label>Taxable Amount</label>}
            <input type="number" step="0.01" aria-label={i === 0 ? undefined : `Taxable amount, row ${i + 1}`} value={line.taxableAmount} onChange={(e) => updateLine(i, { taxableAmount: e.target.value })} />
          </div>
          <button type="button" className="btn btn-sm" disabled={lines.length <= 1} onClick={() => removeLine(i)} aria-label={`Remove row ${i + 1}`}>✕</button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => setLines((prev) => [...prev, { ...EMPTY_SALES_LINE }])}>+ Add Category</button>
    </div>
  );
}

const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Sales-tax filing periods staff actually work in. "All time" is deliberately
 * included so an empty period is never mistaken for missing data.
 */
const PERIOD_PRESETS: { label: string; range: () => { start: string; end: string } }[] = [
  { label: "This month", range: () => { const n = new Date(); return { start: isoDate(new Date(n.getFullYear(), n.getMonth(), 1)), end: isoDate(new Date(n.getFullYear(), n.getMonth() + 1, 0)) }; } },
  { label: "Last month", range: () => { const n = new Date(); return { start: isoDate(new Date(n.getFullYear(), n.getMonth() - 1, 1)), end: isoDate(new Date(n.getFullYear(), n.getMonth(), 0)) }; } },
  { label: "This quarter", range: () => { const n = new Date(); const q = Math.floor(n.getMonth() / 3); return { start: isoDate(new Date(n.getFullYear(), q * 3, 1)), end: isoDate(new Date(n.getFullYear(), q * 3 + 3, 0)) }; } },
  { label: "Last quarter", range: () => { const n = new Date(); const q = Math.floor(n.getMonth() / 3) - 1; return { start: isoDate(new Date(n.getFullYear(), q * 3, 1)), end: isoDate(new Date(n.getFullYear(), q * 3 + 3, 0)) }; } },
  { label: "This year", range: () => { const n = new Date(); return { start: isoDate(new Date(n.getFullYear(), 0, 1)), end: isoDate(new Date(n.getFullYear(), 11, 31)) }; } },
  { label: "All time", range: () => ({ start: "", end: "" }) },
];

function SalesTab({ clientId, clientState }: { clientId: string; clientState?: string | null }) {
  const promptFor = usePrompt();
  const notify = useNotify();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
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
  const [viewing, setViewing] = useState<any | null>(null);
  const [salesPreview, setSalesPreview] = useState<SalesPreview | null>(null);
  const [editSalesPreview, setEditSalesPreview] = useState<SalesPreview | null>(null);
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { start, end };
  });
  const [mdPaidDate, setMdPaidDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [mdFiling, setMdFiling] = useState<{
    periods: (MdFilingResult & { start: string; end: string; dueDate: string })[];
    totals: { taxDue: number; discount: number; penalty: number; interest: number; balanceDue: number };
    frequencyUsed: string | null;
  } | null>(null);
  const [importedFromCalculator, setImportedFromCalculator] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  function load(): Promise<void> {
    return api.get<{ sales: any[] }>(`/accounting/sales/${clientId}`).then((r) => setSales(r.sales)).catch(() => {});
  }
  useEffect(() => { load(); }, [clientId]);
  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    const qs = clientState ? `?state=${encodeURIComponent(clientState)}` : "";
    api.get<{ categories: SalesTaxCategory[] }>(`/accounting/sales-categories${qs}`).then((r) => setCategories(r.categories)).catch(() => setCategories([]));
  }, [clientState]);

  // One-shot handoff from Calculators → "Convert to Sales Input" — prefill
  // the category lines it computed rather than writing a v3_sales_input row
  // directly from that client-agnostic tool, so the actual save still goes
  // through this form's own date entry and review. Cleared immediately so a
  // stale entry never resurfaces (a different client, a later visit here).
  useEffect(() => {
    const raw = sessionStorage.getItem(CALCULATOR_TO_SALES_INPUT_KEY);
    if (!raw) return;
    sessionStorage.removeItem(CALCULATOR_TO_SALES_INPUT_KEY);
    try {
      const payload = JSON.parse(raw) as { clientId: string; lines: { categoryId: string; taxableAmount: string }[] };
      if (payload.clientId !== clientId || !Array.isArray(payload.lines) || payload.lines.length === 0) return;
      setLines(payload.lines.map((l) => ({ categoryId: l.categoryId, taxableAmount: String(l.taxableAmount) })));
      setImportedFromCalculator(true);
      setShowCreate(true);
    } catch {
      // malformed handoff — ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const linesForPreview = (ls: SalesCategoryLine[]) => ls.filter((l) => l.categoryId && Number(l.taxableAmount) > 0).map((l) => ({ categoryId: l.categoryId, taxableAmount: Number(l.taxableAmount) }));

  // Gross Sales (Line 3) is derived from these same lines — including a
  // Non-Taxable line, since its amount still counts toward gross without
  // being taxed — instead of a separately typed figure that could drift out
  // of sync with what was actually entered below.
  useEffect(() => {
    const payloadLines = linesForPreview(lines);
    if (payloadLines.length === 0 && !Number(form.adjustments)) { setSalesPreview(null); setForm((f) => ({ ...f, grossSales: "" })); return; }
    const handle = setTimeout(() => {
      api.post<SalesPreview>("/accounting/sales/preview", {
        clientId, categoryLines: payloadLines, adjustments: Number(form.adjustments) || 0,
      }).then((r) => {
        setSalesPreview(r);
        const gross = r.lines.reduce((sum, l) => sum + l.taxableAmount, 0);
        setForm((f) => ({ ...f, grossSales: gross ? String(Math.round(gross * 100) / 100) : f.grossSales }));
      }).catch(() => setSalesPreview(null));
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, JSON.stringify(lines), form.adjustments]);

  // Same auto-computed Gross Sales as the create form above — editing a
  // sale's category lines used to leave the Gross Sales box exactly as it
  // was when Edit was opened, so changing a line's amount silently stopped
  // matching what was actually saved. Only runs while a sale is actually
  // being edited.
  useEffect(() => {
    if (!editing) { setEditSalesPreview(null); return; }
    const payloadLines = linesForPreview(editLines);
    if (payloadLines.length === 0 && !Number(editForm.adjustments)) { setEditSalesPreview(null); setEditForm((f) => ({ ...f, grossSales: "" })); return; }
    const handle = setTimeout(() => {
      api.post<SalesPreview>("/accounting/sales/preview", {
        clientId, categoryLines: payloadLines, adjustments: Number(editForm.adjustments) || 0,
      }).then((r) => {
        setEditSalesPreview(r);
        const gross = r.lines.reduce((sum, l) => sum + l.taxableAmount, 0);
        setEditForm((f) => ({ ...f, grossSales: gross ? String(Math.round(gross * 100) / 100) : f.grossSales }));
      }).catch(() => setEditSalesPreview(null));
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, clientId, JSON.stringify(editLines), editForm.adjustments]);

  const salesInPeriod = sales.filter((s) => {
    const d = s.sale_date ? String(s.sale_date).slice(0, 10) : null;
    if (!d) return false;
    return (!period.start || d >= period.start) && (!period.end || d <= period.end);
  });
  const periodLabel = !period.start && !period.end
    ? "all time"
    : `${fmtDate(period.start) || "the beginning"} – ${fmtDate(period.end) || "today"}`;
  const periodSales = salesInPeriod.reduce((sum, s) => sum + Number(s.gross_sales || 0), 0);
  const periodTax = salesInPeriod.reduce((sum, s) => sum + Number(s.total_tax_due || 0), 0);

  function handleExportCsv() {
    exportCsv(
      `sales-${clientId}.csv`,
      [
        { key: "sale_date", label: "Date" }, { key: "gross_sales", label: "Gross Sales" },
        { key: "total_tax_due", label: "Tax Due" }, { key: "payment_date", label: "Payment Date" }, { key: "notes", label: "Notes" },
      ],
      salesInPeriod as unknown as Record<string, unknown>[]
    );
  }
  // Per-category rollup for the period — previously the only category-level
  // visibility was re-opening each sale's Edit form one at a time; this answers
  // "how much did we collect in Vape tax this quarter" without that.
  const periodByCategory = (() => {
    const map = new Map<string, { categoryName: string; taxable: number; tax: number }>();
    for (const s of salesInPeriod) {
      for (const l of s.lines || []) {
        const key = l.category_id;
        const row = map.get(key) || { categoryName: l.category_name, taxable: 0, tax: 0 };
        row.taxable += Number(l.taxable_amount || 0);
        row.tax += Number(l.tax_amount || 0);
        map.set(key, row);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.tax - a.tax);
  })();

  // Maryland only — Form 202's timely-discount/late-penalty math (Lines
  // 17-20, 36-38), broken out per the client's REAL filing period (calendar
  // month/quarter/half/year, from their stored Sales Tax Frequency) rather
  // than one due date blended across whatever range is picked above — see
  // /reports/md-filing and src/common/mdFiling.ts's splitIntoMdFilingPeriods
  // doc comment for why. Deliberately hits the report-side endpoint, not
  // the client-agnostic /calculators/md-filing tool (no period/frequency
  // concept there).
  useEffect(() => {
    if (clientState !== "MD" || !period.start || !period.end) { setMdFiling(null); return; }
    const t = setTimeout(() => {
      api.get<{ mdFiling: typeof mdFiling }>(`/reports/md-filing/${clientId}?from=${period.start}&to=${period.end}&mdPaidDate=${mdPaidDate}`)
        .then((r) => setMdFiling(r.mdFiling))
        .catch(() => setMdFiling(null));
    }, 300);
    return () => clearTimeout(t);
  }, [clientId, clientState, period.start, period.end, mdPaidDate]);

  function handleClearForm() {
    setForm({ saleDate: "", grossSales: "", adjustments: "", paymentDate: "", notes: "" });
    setLines([{ ...EMPTY_SALES_LINE }]);
    setError(null);
    setImportedFromCalculator(false);
  }

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
      setImportedFromCalculator(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save sales input.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Deleting a sale also reverses the three GL lines it posted, so it needs a
   * heavier gate than the Edit button next to it — hence typed confirmation
   * rather than a plain OK/Cancel.
   */
  async function handleDeleteSale(sale: any) {
    const typed = await promptFor({
      title: "Delete sale",
      message: `${fmtDate(sale.sale_date)} for ${fmtMoney(sale.gross_sales)} — its sales revenue and sales tax payable entries will be reversed in the General Ledger. This cannot be undone. Type DELETE to confirm.`,
      placeholder: "DELETE",
    });
    if (typed === null) return;
    try {
      const res = await api.post<{ glLinesRemoved: number }>(`/accounting/sales/${sale.sale_id}/delete`, { confirm: typed });
      setViewing(null);
      setEditing(null);
      load();
      await notify(`Sale deleted. ${res.glLinesRemoved} general-ledger line(s) reversed.`);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this sale.");
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
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {showCreate && (
      <Panel
        title="Sales Input"
        note={clientState ? `${clientState} sales tax by category` : "Sales tax by category"}
        action={<button type="button" className="btn btn-sm" onClick={() => setShowCreate(false)}>Close</button>}
      >
        <form onSubmit={handleSubmit} style={{ padding: 16 }}>
          {importedFromCalculator && (
            <p className="muted" style={{ fontSize: 11.5, margin: "0 0 10px", padding: "6px 10px", background: "var(--line)", borderRadius: 6 }}>
              Category lines filled in from the Calculator — set the date, review, then save.
            </p>
          )}
          {error && <ErrorBanner error={error} />}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label htmlFor="acct-se-sale-date">Date</label><input id="acct-se-sale-date" type="date" value={form.saleDate} onChange={(e) => setForm((f) => ({ ...f, saleDate: e.target.value }))} /></div>
            <div className="field">
              <label>Gross Sales <span className="muted">(auto, from lines below)</span></label>
              <input type="number" step="0.01" value={form.grossSales} readOnly disabled style={{ background: "var(--line)", opacity: 0.7 }} />
            </div>
          </div>
          <CategoryLinesEditor lines={lines} setLines={setLines} categories={categories} clientState={clientState} />
          {salesPreview && salesPreview.lines.length > 0 && (
            <div style={{ marginTop: 8, marginBottom: 12, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
              {salesPreview.lines.map((l) => (
                <SalesRow key={l.categoryId} label={`${l.categoryName} — ${fmtMoney(l.taxableAmount)} @ ${(l.rate * 100).toFixed(2).replace(/\.?0+$/, "")}%`} value={fmtMoney(l.taxAmount)} />
              ))}
              <SalesRow label="Gross sales (Line 3)" value={fmtMoney(Number(form.grossSales) || 0)} />
              <SalesRow label="Taxable amount" value={fmtMoney(salesPreview.lines.filter((l) => l.rate > 0).reduce((s, l) => s + l.taxableAmount, 0))} />
              <SalesRow label="Total tax" value={fmtMoney(salesPreview.totalTaxDue)} bold />
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
            <div className="field"><label htmlFor="acct-se-adjustments">Adjustments</label><input id="acct-se-adjustments" type="number" step="0.01" value={form.adjustments} onChange={(e) => setForm((f) => ({ ...f, adjustments: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-payment-date">Payment Date</label><input id="acct-se-payment-date" type="date" value={form.paymentDate} onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))} /></div>
          </div>
          <div className="field"><label htmlFor="acct-se-notes">Notes</label><textarea id="acct-se-notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Sales Input"}</button>
            <button type="button" className="btn btn-sm" onClick={handleClearForm} disabled={saving}>Cancel / Clear</button>
          </div>
        </form>
      </Panel>
      )}
      <Panel
        title="Sales & Tax by Period"
        note={periodLabel}
        action={
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
            <input type="date" value={period.start} onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))} style={{ padding: "4px 6px" }} />
            <span className="muted">to</span>
            <input type="date" value={period.end} onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))} style={{ padding: "4px 6px" }} />
            <button type="button" className="ghost-button" disabled={refreshing} onClick={handleRefresh}><RefreshCw size={13} strokeWidth={2} aria-hidden="true" className={refreshing ? "icon-spin" : undefined} />{refreshing ? "Refreshing…" : "Refresh"}</button>
            <button type="button" className="ghost-button" onClick={handleExportCsv}><Download size={13} strokeWidth={2} aria-hidden="true" />Export CSV</button>
            {!showCreate && <button type="button" className="btn btn-sm btn-primary" onClick={() => setShowCreate(true)}>+ Add Sale</button>}
          </div>
        }
      >
        {/* One-click periods — the two raw date boxes alone meant picking a
            quarter was four fiddly interactions, and it was easy to end up on
            a range with no sales in it and read that as "the data is gone". */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "12px 16px 0" }}>
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`btn btn-sm${period.start === p.range().start && period.end === p.range().end ? " btn-primary" : ""}`}
              onClick={() => setPeriod(p.range())}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="metric-grid" style={{ margin: 16 }}>
          <div className="metric"><div className="metric-label">Rows This Period</div><div className="metric-value">{salesInPeriod.length}</div></div>
          <div className="metric"><div className="metric-label">Period Sales</div><div className="metric-value">{fmtMoney(periodSales)}</div></div>
          <div className="metric"><div className="metric-label">Period Tax</div><div className="metric-value">{fmtMoney(periodTax)}</div></div>
        </div>
        {periodByCategory.length > 0 && (
          <div style={{ margin: "0 16px 16px" }}>
            <div className="small-label" style={{ marginBottom: 6 }}>Tax Collected by Category (this period)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {periodByCategory.map((c) => (
                <div key={c.categoryName} className="card" style={{ padding: "6px 10px", fontSize: 12 }}>
                  <strong>{c.categoryName}</strong> · {fmtMoney(c.taxable)} taxed · <span className="muted">{fmtMoney(c.tax)} tax</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {clientState === "MD" && periodTax > 0 && (
          <div style={{ margin: "0 16px 16px" }}>
            <div className="small-label" style={{ marginBottom: 6 }}>Filing Discount / Late Penalty (Form 202)</div>

            {!period.start || !period.end ? (
              <p className="muted" style={{ fontSize: 12 }}>
                Pick a specific period above (not "All time") to see the filing due date and discount/penalty math.
              </p>
            ) : (
              <>
                <div className="field" style={{ maxWidth: 220, margin: "0 0 10px" }}>
                  <label>Filing / payment date</label>
                  <input type="date" value={mdPaidDate} onChange={(e) => setMdPaidDate(e.target.value)} style={{ padding: "4px 6px" }} />
                </div>

                {mdFiling && mdFiling.periods.length > 0 && !mdFiling.frequencyUsed && (
                  <p className="muted" style={{ fontSize: 11, margin: "0 0 10px", color: "var(--red)" }}>
                    Filing frequency isn't set on this client's profile, so this period is shown as one combined return.
                    Set Sales Tax Frequency on the client's profile for an accurate per-period breakdown.
                  </p>
                )}

                {mdFiling && mdFiling.periods.length === 1 && (
                  <>
                    <div style={{ marginBottom: 10 }}>
                      <div className="small-label" style={{ marginBottom: 2 }}>Return due date</div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{fmtDate(mdFiling.periods[0].dueDate)}</div>
                    </div>
                    <div style={{
                      display: "inline-block", padding: "3px 10px", borderRadius: 12, fontSize: 11.5, fontWeight: 700, marginBottom: 10,
                      background: mdFiling.periods[0].onTime ? "var(--green-soft)" : "var(--red-soft)",
                      color: mdFiling.periods[0].onTime ? "var(--green)" : "var(--red)",
                    }}>
                      {mdFiling.periods[0].onTime ? "✓ On time — eligible for the discount" : `⚠ Late — ${mdFiling.periods[0].monthsLate} month${mdFiling.periods[0].monthsLate === 1 ? "" : "s"} past due`}
                    </div>
                    <div className="metric-grid metric-grid-3">
                      {mdFiling.periods[0].onTime ? (
                        <>
                          <div className="metric"><div className="metric-label">Timely Discount</div><div className="metric-value">− {fmtMoney(mdFiling.periods[0].discount)}</div><div className="metric-note">Line 18</div></div>
                          <div className="metric"><div className="metric-label">Balance Due</div><div className="metric-value">{fmtMoney(mdFiling.periods[0].balanceDue)}</div><div className="metric-note">Line 20</div></div>
                        </>
                      ) : (
                        <>
                          <div className="metric"><div className="metric-label">Penalty — 10%</div><div className="metric-value">{fmtMoney(mdFiling.periods[0].penalty)}</div><div className="metric-note">Line 37a</div></div>
                          <div className="metric"><div className="metric-label">Interest</div><div className="metric-value">{fmtMoney(mdFiling.periods[0].interest)}</div><div className="metric-note">Line 37b</div></div>
                          <div className="metric"><div className="metric-label">Balance Due</div><div className="metric-value">{fmtMoney(mdFiling.periods[0].balanceDue)}</div><div className="metric-note">Line 38</div></div>
                        </>
                      )}
                    </div>
                  </>
                )}

                {mdFiling && mdFiling.periods.length > 1 && (
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
                          {mdFiling.periods.map((p) => (
                            <tr key={`${p.start}-${p.end}`}>
                              <td>{p.start} – {p.end}</td>
                              <td>{fmtDate(p.dueDate)}</td>
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
                      <div className="metric"><div className="metric-label">Total Discount</div><div className="metric-value">− {fmtMoney(mdFiling.totals.discount)}</div></div>
                      <div className="metric"><div className="metric-label">Total Penalty + Interest</div><div className="metric-value">{fmtMoney(mdFiling.totals.penalty + mdFiling.totals.interest)}</div></div>
                      <div className="metric"><div className="metric-label">Total Balance Due</div><div className="metric-value">{fmtMoney(mdFiling.totals.balanceDue)}</div></div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
        {viewing && (
          <div className="card" style={{ margin: 16 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <strong>Sale — {fmtDate(viewing.sale_date)}</strong>
              <button type="button" className="btn btn-sm" onClick={() => setViewing(null)}>Close</button>
            </div>
            <div className="metric-grid" style={{ margin: "10px 0" }}>
              <div className="metric"><div className="metric-label">Gross Sales</div><div className="metric-value" style={{ fontSize: 18 }}>{fmtMoney(viewing.gross_sales)}</div></div>
              <div className="metric"><div className="metric-label">Total Tax Due</div><div className="metric-value" style={{ fontSize: 18 }}>{fmtMoney(viewing.total_tax_due)}</div></div>
              <div className="metric"><div className="metric-label">Payment Date</div><div className="metric-value" style={{ fontSize: 18 }}>{fmtDate(viewing.payment_date) || "—"}</div></div>
            </div>
            <table>
              <thead><tr><th scope="col">Category</th><th scope="col">Taxable Amount</th><th scope="col">Rate</th><th scope="col">Tax Amount</th></tr></thead>
              <tbody>
                {(viewing.lines || []).map((l: any) => (
                  <tr key={l.line_id}>
                    <td>{l.category_name}</td>
                    <td>{fmtMoney(l.taxable_amount)}</td>
                    <td className="muted">{(Number(l.tax_rate_used) * 100).toFixed(2)}%</td>
                    <td>{fmtMoney(l.tax_amount)}</td>
                  </tr>
                ))}
                {(viewing.lines || []).length === 0 && <tr><td colSpan={4} className="muted">No category lines on this sale.</td></tr>}
              </tbody>
            </table>
            {viewing.adjustments != null && Number(viewing.adjustments) !== 0 && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Adjustments: {fmtMoney(viewing.adjustments)}</p>}
            {viewing.notes && <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{viewing.notes}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => { startEdit(viewing); setViewing(null); }}>Edit This Sale</button>
              {isAdmin && <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDeleteSale(viewing)}>Delete This Sale</button>}
            </div>
          </div>
        )}
        {editing && (
          <form onSubmit={handleSaveEdit} className="card" style={{ margin: 16 }}>
            <strong>Edit sales record — {fmtDate(editing.sale_date)}</strong>
            {editError && <ErrorBanner error={editError} />}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field"><label htmlFor="acct-se-edit-sale-date">Date</label><input id="acct-se-edit-sale-date" type="date" value={editForm.saleDate} onChange={(e) => setEditForm((f) => ({ ...f, saleDate: e.target.value }))} /></div>
              <div className="field">
                <label>Gross Sales <span className="muted">(auto, from lines below)</span></label>
                <input type="number" step="0.01" value={editForm.grossSales} readOnly disabled style={{ background: "var(--line)", opacity: 0.7 }} />
              </div>
            </div>
            <CategoryLinesEditor lines={editLines} setLines={setEditLines} categories={categories} clientState={clientState} />
            {editSalesPreview && editSalesPreview.lines.length > 0 && (
              <div style={{ marginTop: 8, marginBottom: 12, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
                {editSalesPreview.lines.map((l) => (
                  <SalesRow key={l.categoryId} label={`${l.categoryName} — ${fmtMoney(l.taxableAmount)} @ ${(l.rate * 100).toFixed(2).replace(/\.?0+$/, "")}%`} value={fmtMoney(l.taxAmount)} />
                ))}
                <SalesRow label="Gross sales (Line 3)" value={fmtMoney(Number(editForm.grossSales) || 0)} />
                <SalesRow label="Taxable amount" value={fmtMoney(editSalesPreview.lines.filter((l) => l.rate > 0).reduce((s, l) => s + l.taxableAmount, 0))} />
                <SalesRow label="Total tax" value={fmtMoney(editSalesPreview.totalTaxDue)} bold />
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
              <div className="field"><label htmlFor="acct-se-edit-adjustments">Adjustments</label><input id="acct-se-edit-adjustments" type="number" step="0.01" value={editForm.adjustments} onChange={(e) => setEditForm((f) => ({ ...f, adjustments: e.target.value }))} /></div>
              <div className="field"><label htmlFor="acct-se-edit-payment-date">Payment Date</label><input id="acct-se-edit-payment-date" type="date" value={editForm.paymentDate} onChange={(e) => setEditForm((f) => ({ ...f, paymentDate: e.target.value }))} /></div>
            </div>
            <div className="field"><label htmlFor="acct-se-edit-notes">Notes</label><textarea id="acct-se-edit-notes" value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} /></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={editSaving}>{editSaving ? "Saving…" : "Save & Recalculate"}</button>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        )}
        {/* The list used to show ALL sales while the totals above showed only the
            selected period — so a July period would read "$0.00" over a table of
            June rows. Both now describe the same period. */}
        <div className="scroll-list">
          <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">Date</th><th scope="col" style={{ textAlign: "right" }}>Gross</th><th scope="col" style={{ textAlign: "right" }}>Tax Due</th><th scope="col">Categories</th><th scope="col"></th></tr></thead>
            <tbody>
              {salesInPeriod.map((s) => (
                <tr key={s.sale_id} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => { setViewing(s); setEditing(null); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setViewing(s); setEditing(null); } }}>
                  <td>
                    <div>{fmtDate(s.sale_date)}</div>
                    {s.payment_date && <div className="muted" style={{ fontSize: 11 }}>Paid {fmtDate(s.payment_date)}</div>}
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(s.gross_sales)}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtMoney(s.total_tax_due)}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    <div>{(s.lines || []).map((l: any) => l.category_name).join(", ") || "—"}</div>
                    {s.notes && <div style={{ fontSize: 11 }}>{s.notes}</div>}
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6 }}>
                    <button type="button" className="btn btn-sm" onClick={() => { startEdit(s); setViewing(null); }}>Edit</button>
                    {isAdmin && <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDeleteSale(s)}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        {salesInPeriod.length === 0 && (
          <p className="muted" style={{ padding: 16, textAlign: "center" }}>
            {sales.length === 0
              ? "No sales recorded yet."
              : `No sales in ${periodLabel}. This client has ${sales.length} sale(s) on other dates — widen the period or pick "All time".`}
          </p>
        )}
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

/** Same label-left/value-right row the Calculators tool uses, so Sales Input's live breakdown looks and reads the same way. */
function SalesRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", gap: 16, padding: "6px 0",
      borderBottom: "1px solid var(--line)", fontWeight: bold ? 700 : 400,
    }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13 }}>{value}</span>
    </div>
  );
}

function PayrollTab({ clientId, clientState }: { clientId: string; clientState?: string | null }) {
  const promptFor = usePrompt();
  const notify = useNotify();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [viewingPayCheck, setViewingPayCheck] = useState<any | null>(null);
  // Edit/delete live here as well as on the Paychecks tab. Sending someone to
  // another tab to correct the row they are already looking at is the kind of
  // detour that gets a payroll mistake left uncorrected.
  const [editing, setEditing] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ payDate: "", regularHours: "", regularRate: "", grossWages: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const createFormRef = useRef<HTMLFormElement | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [paychecks, setPaychecks] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [showBatch, setShowBatch] = useState(false);
  const [showPayrollAgent, setShowPayrollAgent] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_PAYROLL_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<"employee" | "payDate" | null>(null);
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
    api.get<{ employees: Employee[] }>(`/accounting/employees/${clientId}`).then((r) => setEmployees(r.employees.filter((e) =>
      !String(e.worker_type || "").toLowerCase().includes("contractor") && String(e.status || "Active").toLowerCase() === "active"
    ))).catch(() => {});
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
    setInvalidField(null);
    // Paired with the top ErrorBanner (role="alert") — the field-level
    // highlight alone is silent to screen readers since nothing moves focus.
    if (!form.employee) { setInvalidField("employee"); setError("Select an employee."); return; }
    if (!form.payDate) { setInvalidField("payDate"); setError("Pay date is required."); return; }
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

  /** "Add" opens the Create Paycheck form — it stays closed by default so the
   * tab opens straight to the paycheck list, not a full-page form. */
  function startAdd() {
    setEditing(null);
    setResult(null);
    setError(null);
    setForm(EMPTY_PAYROLL_FORM);
    setShowCreate(true);
  }

  function startEdit(p: any) {
    setViewingPayCheck(null);
    setEditError(null);
    setEditing(p);
    setEditForm({
      payDate: p.pay_date ? String(p.pay_date).slice(0, 10) : "",
      regularHours: String(p.regular_hours ?? p.hours ?? ""),
      regularRate: String(p.regular_rate ?? p.rate ?? ""),
      // Left blank on purpose. Gross overrides hours × rate, so pre-filling it
      // meant changing the hours saved the new hours and kept the old pay.
      grossWages: "",
    });
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await api.patch(`/accounting/paychecks/${editing.paycheck_id}`, {
        payDate: editForm.payDate,
        regularHours: editForm.regularHours || undefined,
        regularRate: editForm.regularRate || undefined,
        grossWages: editForm.grossWages || undefined,
      });
      setEditing(null);
      load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Could not save changes.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete(p: any) {
    const typed = await promptFor({
      title: "Permanently delete paycheck",
      message: `${p.employee} on ${fmtDate(p.pay_date)} (net ${fmtMoney(p.net_pay)}) — its payroll journal entries will be removed too. This cannot be undone. Type DELETE PAYCHECK to confirm.`,
      placeholder: "DELETE PAYCHECK",
    });
    if (typed === null) return;
    setDeleting(p.paycheck_id);
    try {
      await api.post(`/accounting/paychecks/${p.paycheck_id}/delete`, { confirm: typed });
      if (viewingPayCheck?.paycheck_id === p.paycheck_id) setViewingPayCheck(null);
      if (editing?.paycheck_id === p.paycheck_id) setEditing(null);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this paycheck.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {showCreate && (
      <Panel
        title="Create Paycheck"
        note="Live preview updates as you type"
        action={<button type="button" className="btn btn-sm" onClick={() => setShowCreate(false)}>Close</button>}
      >
        <form ref={createFormRef} onSubmit={handleSubmit} style={{ padding: 16 }}>
          {error && <ErrorBanner error={error} />}
          {result && (
            <div className="card" style={{ marginBottom: 14, borderColor: "var(--teal)" }}>
              <strong>Paycheck created.</strong>
              <div style={{ marginTop: 6, fontSize: 13 }}>Gross {fmtMoney(result.gross)} · Employee taxes {fmtMoney(result.employeeTaxes)} · Net {fmtMoney(result.netPay)}</div>
            </div>
          )}

          <div className={`field ${invalidField === "employee" ? "invalid" : ""}`}>
            <label>Employee</label>
            <select
              aria-invalid={invalidField === "employee" ? "true" : undefined}
              value={form.employee}
              onChange={(e) => { setForm((f) => ({ ...f, employee: e.target.value })); if (invalidField === "employee") setInvalidField(null); }}
            >
              <option value="">Select an employee…</option>
              {employees.map((e) => <option key={e.employee_id} value={e.employee_name}>{e.employee_name}</option>)}
            </select>
            {invalidField === "employee" && <p className="field-error">Select an employee.</p>}
          </div>
          {employees.length === 0 && <p className="muted" style={{ marginTop: -6 }}>No active employees yet — add one under the Employees tab first.</p>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className={`field ${invalidField === "payDate" ? "invalid" : ""}`}>
              <label>Pay Date</label>
              <input
                type="date"
                aria-invalid={invalidField === "payDate" ? "true" : undefined}
                value={form.payDate}
                onChange={(e) => { setForm((f) => ({ ...f, payDate: e.target.value })); if (invalidField === "payDate") setInvalidField(null); }}
              />
              {invalidField === "payDate" && <p className="field-error">Pay date is required.</p>}
            </div>
            <div className="field">
              <label>Pay Type</label>
              <select value={form.payType} onChange={(e) => setForm((f) => ({ ...f, payType: e.target.value }))}>
                <option>Hourly</option><option>Salary</option><option>Other</option>
              </select>
            </div>
            <div className="field"><label htmlFor="acct-se-pay-period-start">Period Start</label><input id="acct-se-pay-period-start" type="date" value={form.payPeriodStart} onChange={(e) => setForm((f) => ({ ...f, payPeriodStart: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-pay-period-end">Period End</label><input id="acct-se-pay-period-end" type="date" value={form.payPeriodEnd} onChange={(e) => setForm((f) => ({ ...f, payPeriodEnd: e.target.value }))} /></div>
          </div>
          <div className="field"><label htmlFor="acct-se-check-number">Check Number (leave blank to auto-assign)</label><input id="acct-se-check-number" value={form.checkNumber} onChange={(e) => setForm((f) => ({ ...f, checkNumber: e.target.value }))} /></div>

          <SubLabel>Earnings</SubLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label htmlFor="acct-se-regular-hours">Regular Hours</label><input id="acct-se-regular-hours" type="number" step="0.01" value={form.regularHours} onChange={(e) => setForm((f) => ({ ...f, regularHours: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-regular-rate">Regular Rate</label><input id="acct-se-regular-rate" type="number" step="0.01" value={form.regularRate} onChange={(e) => setForm((f) => ({ ...f, regularRate: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-overtime-hours">Overtime Hours</label><input id="acct-se-overtime-hours" type="number" step="0.01" value={form.overtimeHours} onChange={(e) => setForm((f) => ({ ...f, overtimeHours: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-overtime-rate">Overtime Rate (defaults to 1.5×)</label><input id="acct-se-overtime-rate" type="number" step="0.01" value={form.overtimeRate} onChange={(e) => setForm((f) => ({ ...f, overtimeRate: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-bonus-pay">Bonus Pay</label><input id="acct-se-bonus-pay" type="number" step="0.01" value={form.bonusPay} onChange={(e) => setForm((f) => ({ ...f, bonusPay: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-commission-pay">Commission Pay</label><input id="acct-se-commission-pay" type="number" step="0.01" value={form.commissionPay} onChange={(e) => setForm((f) => ({ ...f, commissionPay: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-other-taxable-pay">Other Taxable Pay</label><input id="acct-se-other-taxable-pay" type="number" step="0.01" value={form.otherTaxablePay} onChange={(e) => setForm((f) => ({ ...f, otherTaxablePay: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-non-taxable-reimbursement">Non-taxable Reimbursement</label><input id="acct-se-non-taxable-reimbursement" type="number" step="0.01" value={form.nonTaxableReimbursement} onChange={(e) => setForm((f) => ({ ...f, nonTaxableReimbursement: e.target.value }))} /></div>
          </div>
          <div className="field"><label htmlFor="acct-se-gross-wages">Or Gross Wages (overrides all earnings above)</label><input id="acct-se-gross-wages" type="number" step="0.01" value={form.grossWages} onChange={(e) => setForm((f) => ({ ...f, grossWages: e.target.value }))} /></div>

          <SubLabel>Deductions</SubLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label htmlFor="acct-se-pre-tax-retirement">Pre-tax Retirement</label><input id="acct-se-pre-tax-retirement" type="number" step="0.01" value={form.preTaxRetirement} onChange={(e) => setForm((f) => ({ ...f, preTaxRetirement: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-pre-tax-health">Pre-tax Health</label><input id="acct-se-pre-tax-health" type="number" step="0.01" value={form.preTaxHealth} onChange={(e) => setForm((f) => ({ ...f, preTaxHealth: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-pre-tax-hsa-fsa">Pre-tax HSA/FSA</label><input id="acct-se-pre-tax-hsa-fsa" type="number" step="0.01" value={form.preTaxHsaFsa} onChange={(e) => setForm((f) => ({ ...f, preTaxHsaFsa: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-post-tax-deduction">Post-tax Deduction</label><input id="acct-se-post-tax-deduction" type="number" step="0.01" value={form.postTaxDeduction} onChange={(e) => setForm((f) => ({ ...f, postTaxDeduction: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-garnishment">Garnishment</label><input id="acct-se-garnishment" type="number" step="0.01" value={form.garnishment} onChange={(e) => setForm((f) => ({ ...f, garnishment: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-other-deduction">Other Deduction</label><input id="acct-se-other-deduction" type="number" step="0.01" value={form.otherDeduction} onChange={(e) => setForm((f) => ({ ...f, otherDeduction: e.target.value }))} /></div>
          </div>

          <SubLabel>Tax overrides (leave blank to auto-calculate)</SubLabel>
          <p style={{ background: "var(--amber-soft)", color: "var(--amber)", borderRadius: 6, padding: "8px 10px", fontSize: 12, margin: "0 0 10px", lineHeight: 1.4 }}>
            ⚠ Federal Withholding auto-calculates from the real 2026 IRS bracket tables, using the employee's own Pay
            Frequency and Federal Filing Status (set on their profile's Sensitive Info tab). State Withholding does
            the same with real 2026 Maryland state + county bracket tables when the employee works in MD — for any
            other work state it's still a flat-rate estimate. Both are simplified estimates (no Step 3/4 W-4
            adjustments, no MW507 exemptions beyond a flat count) — enter real figures from an actual payroll
            processor here whenever you have them.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label htmlFor="acct-se-federal-withholding">Federal Withholding</label><input id="acct-se-federal-withholding" type="number" step="0.01" value={form.federalWithholding} onChange={(e) => setForm((f) => ({ ...f, federalWithholding: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-state-tax">{clientState || "State"} Withholding</label><input id="acct-se-state-tax" type="number" step="0.01" value={form.stateTax} onChange={(e) => setForm((f) => ({ ...f, stateTax: e.target.value }))} /></div>
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
          <div className="field"><label htmlFor="acct-se-notes-2">Notes</label><textarea id="acct-se-notes-2" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>

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
      )}
      <Panel
        title="Recent Paychecks"
        note={`${paychecks.length} rows`}
        action={
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
            <input type="date" value={period.start} onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))} style={{ padding: "4px 6px" }} />
            <span className="muted">to</span>
            <input type="date" value={period.end} onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))} style={{ padding: "4px 6px" }} />
            <button type="button" className="btn btn-sm" onClick={() => setShowPayrollAgent(true)}>Payroll Agent</button>
            <button type="button" className="btn btn-sm" onClick={() => setShowBatch(true)}>Batch Create</button>
            {!showCreate && <button type="button" className="btn btn-sm btn-primary" onClick={startAdd}>+ Add Paycheck</button>}
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
        {editing && (
          <form onSubmit={handleSaveEdit} className="card" style={{ margin: 16 }}>
            <strong>Edit paycheck — {editing.employee} ({fmtDate(editing.pay_date)})</strong>
            <p className="muted" style={{ fontSize: 11.5, margin: "4px 0 10px" }}>
              Taxes, net pay and the payroll journal entries are recalculated from scratch when you save.
            </p>
            {editError && <ErrorBanner error={editError} />}
            <div className="field"><label htmlFor="acct-se-edit-pay-date">Pay Date</label><input id="acct-se-edit-pay-date" type="date" value={editForm.payDate} onChange={(e) => setEditForm((f) => ({ ...f, payDate: e.target.value }))} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field"><label htmlFor="acct-se-edit-regular-hours">Regular Hours</label><input id="acct-se-edit-regular-hours" type="number" step="0.01" value={editForm.regularHours} onChange={(e) => setEditForm((f) => ({ ...f, regularHours: e.target.value }))} /></div>
              <div className="field"><label htmlFor="acct-se-edit-regular-rate">Regular Rate</label><input id="acct-se-edit-regular-rate" type="number" step="0.01" value={editForm.regularRate} onChange={(e) => setEditForm((f) => ({ ...f, regularRate: e.target.value }))} /></div>
            </div>
            <div className="field"><label htmlFor="acct-se-edit-gross-wages">Or Gross Wages (leave blank to recalculate from hours × rate)</label><input id="acct-se-edit-gross-wages" type="number" step="0.01" value={editForm.grossWages} onChange={(e) => setEditForm((f) => ({ ...f, grossWages: e.target.value }))} /></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="submit" className="btn btn-primary" disabled={editSaving}>{editSaving ? "Saving…" : "Save & Recalculate"}</button>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
              {isAdmin && (
                <button type="button" className="btn btn-sm btn-danger" disabled={deleting === editing.paycheck_id} onClick={() => handleDelete(editing)}>
                  {deleting === editing.paycheck_id ? "Deleting…" : "Delete"}
                </button>
              )}
            </div>
          </form>
        )}
        {viewingPayCheck && (
          <div className="card" style={{ margin: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div>
                <strong>{viewingPayCheck.employee} — {fmtDate(viewingPayCheck.pay_date)}</strong>
                <div className="muted" style={{ fontSize: 12 }}>Check #{viewingPayCheck.check_number || "—"}</div>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => setViewingPayCheck(null)}>Close</button>
            </div>
            <div className="table-scroll" style={{ marginTop: 10 }}>
              <table>
                <tbody>
                  <tr><td>Gross wages</td><td style={{ textAlign: "right" }}>{fmtMoney(viewingPayCheck.gross_wages)}</td></tr>
                  <tr><td className="muted">Less employee taxes</td><td style={{ textAlign: "right" }} className="muted">−{fmtMoney(viewingPayCheck.employee_taxes)}</td></tr>
                  <tr><td className="muted" style={{ paddingLeft: 20, fontSize: 12.5 }}>Federal Withholding</td><td style={{ textAlign: "right", fontSize: 12.5 }} className="muted">−{fmtMoney(viewingPayCheck.federal_withholding)}</td></tr>
                  <tr><td className="muted" style={{ paddingLeft: 20, fontSize: 12.5 }}>State Tax</td><td style={{ textAlign: "right", fontSize: 12.5 }} className="muted">−{fmtMoney(viewingPayCheck.state_tax)}</td></tr>
                  <tr><td className="muted" style={{ paddingLeft: 20, fontSize: 12.5 }}>Social Security (EE)</td><td style={{ textAlign: "right", fontSize: 12.5 }} className="muted">−{fmtMoney(viewingPayCheck.social_security_ee)}</td></tr>
                  <tr><td className="muted" style={{ paddingLeft: 20, fontSize: 12.5 }}>Medicare (EE)</td><td style={{ textAlign: "right", fontSize: 12.5 }} className="muted">−{fmtMoney(viewingPayCheck.medicare_ee)}</td></tr>
                  <tr><td style={{ fontWeight: 700 }}>Net pay</td><td style={{ textAlign: "right", fontWeight: 700 }}>{fmtMoney(viewingPayCheck.net_pay)}</td></tr>
                  <tr><td className="muted">Employer taxes</td><td style={{ textAlign: "right" }} className="muted">{fmtMoney(viewingPayCheck.employer_taxes)}</td></tr>
                  <tr><td className="muted" style={{ paddingLeft: 20, fontSize: 12.5 }}>Social Security (ER)</td><td style={{ textAlign: "right", fontSize: 12.5 }} className="muted">{fmtMoney(viewingPayCheck.social_security_er)}</td></tr>
                  <tr><td className="muted" style={{ paddingLeft: 20, fontSize: 12.5 }}>Medicare (ER)</td><td style={{ textAlign: "right", fontSize: 12.5 }} className="muted">{fmtMoney(viewingPayCheck.medicare_er)}</td></tr>
                  <tr><td className="muted" style={{ paddingLeft: 20, fontSize: 12.5 }}>FUTA</td><td style={{ textAlign: "right", fontSize: 12.5 }} className="muted">{fmtMoney(viewingPayCheck.futa)}</td></tr>
                  <tr><td className="muted" style={{ paddingLeft: 20, fontSize: 12.5 }}>SUTA</td><td style={{ textAlign: "right", fontSize: 12.5 }} className="muted">{fmtMoney(viewingPayCheck.suta)}</td></tr>
                  <tr><td style={{ fontWeight: 700 }}>Total employer cost</td><td style={{ textAlign: "right", fontWeight: 700 }}>{fmtMoney(viewingPayCheck.total_cost)}</td></tr>
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-sm" onClick={() => startEdit(viewingPayCheck)}>Edit</button>
              {isAdmin && (
                <button type="button" className="btn btn-sm btn-danger" disabled={deleting === viewingPayCheck.paycheck_id} onClick={() => handleDelete(viewingPayCheck)}>
                  {deleting === viewingPayCheck.paycheck_id ? "Deleting…" : "Delete"}
                </button>
              )}
            </div>
            <p className="muted" style={{ fontSize: 11.5, marginTop: 8, marginBottom: 0 }}>
              The Paychecks tab prints the paystub for this record.
            </p>
          </div>
        )}
        <div className="scroll-list">
          <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">Pay Date</th><th scope="col">Employee</th><th scope="col" style={{ textAlign: "right" }}>Gross</th><th scope="col" style={{ textAlign: "right" }}>Net Pay</th><th scope="col"></th></tr></thead>
            <tbody>
              {/* This is a different table from the Paychecks tab's — it also
                  needs to open its record rather than being a dead list. */}
              {paychecksInPeriod.map((p) => (
                <tr key={p.paycheck_id} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => setViewingPayCheck(p)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setViewingPayCheck(p); } }}>
                  <td>{fmtDate(p.pay_date)}</td>
                  <td>{p.employee}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(p.gross_wages)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(p.net_pay)}</td>
                  {/* stopPropagation so acting on a row doesn't also open its
                      read-only card underneath the form that just appeared. */}
                  <td style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="btn btn-sm" onClick={() => startEdit(p)}>Edit</button>{" "}
                    {isAdmin && (
                      <button type="button" className="btn btn-sm btn-danger" disabled={deleting === p.paycheck_id} onClick={() => handleDelete(p)}>
                        {deleting === p.paycheck_id ? "…" : "Delete"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        {paychecksInPeriod.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No paychecks in this period.</p>}
      </Panel>
      {showBatch && (
        <BatchPayrollModal
          clientId={clientId}
          employees={employees}
          onClose={() => setShowBatch(false)}
          onDone={load}
        />
      )}
      {showPayrollAgent && (
        <PayrollAgentModal
          clientId={clientId}
          employees={employees}
          onClose={() => setShowPayrollAgent(false)}
        />
      )}
    </div>
  );
}

const PAYROLL_AGENT_FREQUENCIES = ["Weekly", "Biweekly", "Semimonthly", "Monthly"] as const;

interface PayrollAgentSchedule {
  payroll_schedule_id: string; client_id: string; employee_id: string; frequency: string;
  next_pay_date: string; lead_days: number; status: string; drafts_from: string;
}

/** Same eligibility rule the backend enforces, mirrored so an ineligible
 * employee shows why instead of just having a dead switch. */
function payrollAgentIneligibleReason(e: Employee): string | null {
  if (String(e.status || "Active").toLowerCase() !== "active") return "not active";
  const hasGross = Number(e.default_gross_wages) > 0;
  const hasHourly = Number(e.pay_rate) > 0 && Number(e.default_hours) > 0;
  if (!hasGross && !hasHourly) return "needs Default Gross Wages or Pay Rate + Default Hours set first";
  return null;
}

/**
 * Payroll Agent, scoped to the one company you're already looking at —
 * reached via Accounting → Payroll → Payroll Agent rather than a picker that
 * asks you to choose a company again. Every eligible employee gets a single
 * On/Off switch; flipping an employee On for the first time asks once for
 * their pay schedule (frequency + next payday), then behaves exactly like
 * every other On/Off switch from then on.
 */
function PayrollAgentModal({ clientId, employees, onClose }: { clientId: string; employees: Employee[]; onClose: () => void }) {
  const notify = useNotify();
  const confirmDialog = useConfirm();
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  useEscapeToClose(onClose, true);
  useFocusTrap(panelRef, true);

  const [schedules, setSchedules] = useState<Record<string, PayrollAgentSchedule> | null>(null);
  const [settingUpId, setSettingUpId] = useState<string | null>(null);
  const [setupFrequency, setSetupFrequency] = useState<string>("Biweekly");
  const [setupAnchorDate, setSetupAnchorDate] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<{ schedules: PayrollAgentSchedule[] }>("/accounting/payroll-agent/schedules")
      .then((res) => {
        const map: Record<string, PayrollAgentSchedule> = {};
        for (const s of res.schedules) if (s.client_id === clientId) map[s.employee_id] = s;
        setSchedules(map);
      })
      .catch(() => setSchedules({}));
  }
  useEffect(load, [clientId]);

  function startSetup(employeeId: string) {
    setError(null);
    setSetupFrequency("Biweekly");
    setSetupAnchorDate("");
    setSettingUpId(employeeId);
  }

  async function confirmSetup(employeeId: string) {
    if (!setupAnchorDate) { setError("Pick a next payday first."); return; }
    setBusyId(employeeId);
    setError(null);
    try {
      await api.post("/accounting/payroll-agent/schedules", { clientId, employeeId, frequency: setupFrequency, anchorDate: setupAnchorDate });
      setSettingUpId(null);
      load();
      await notify("Turned on. This employee will be drafted automatically ahead of their next payday.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not turn on Auto Payroll for this employee.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleExisting(schedule: PayrollAgentSchedule, employeeName: string) {
    const isOn = schedule.status === "Active";
    if (isOn) {
      const ok = await confirmDialog({
        message: `Turn off Auto-Draft Payroll for ${employeeName}? It will stop drafting new paychecks until you turn it back on — nothing already drafted is affected.`,
        confirmLabel: "Turn Off",
      });
      if (!ok) return;
    }
    setBusyId(schedule.employee_id);
    try {
      await api.post(`/accounting/payroll-agent/schedules/${schedule.payroll_schedule_id}/${isOn ? "pause" : "resume"}`, {});
      load();
      await notify(isOn
        ? `Turned off. ${employeeName} won't be drafted again until you turn this back on.`
        : `Turned on. ${employeeName} will be drafted again ahead of their next payday.`);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not update this schedule.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="payroll-agent-modal-title" style={{ maxWidth: 620, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2 id="payroll-agent-modal-title">Payroll Agent</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        {error && <ErrorBanner error={error} />}
        <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
          A few days before each payday, a draft paycheck is created for review — nothing is ever posted without an explicit Approve on the Payroll Agent page. Turn any employee On or Off below.
        </p>

        {employees.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>No employees on this client yet.</p>
        ) : schedules === null ? (
          <p className="muted" style={{ fontSize: 13 }}>Loading…</p>
        ) : (
          <div style={{ maxHeight: 440, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
            {employees.map((e) => {
              const schedule = schedules[e.employee_id];
              const isOn = schedule?.status === "Active";
              const reason = !schedule ? payrollAgentIneligibleReason(e) : null;
              const isSettingUp = settingUpId === e.employee_id;
              return (
                <div key={e.employee_id} style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700 }}>{e.employee_name}</div>
                      {schedule ? (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {schedule.frequency} — {isOn ? `pay date ${fmtDate(schedule.next_pay_date)}` : "off"}
                        </div>
                      ) : reason ? (
                        <div className="muted" style={{ fontSize: 12 }}>{reason}</div>
                      ) : null}
                    </div>
                    {schedule ? (
                      <>
                        <span className={`status-pill ${isOn ? "status-green" : "status-gray"}`}>{isOn ? "On" : "Off"}</span>
                        <button type="button" className={`btn btn-sm ${isOn ? "" : "btn-primary"}`} disabled={busyId === e.employee_id} onClick={() => toggleExisting(schedule, e.employee_name)}>
                          {busyId === e.employee_id ? "Saving…" : isOn ? "Turn Off" : "Turn On"}
                        </button>
                      </>
                    ) : reason ? (
                      <>
                        <span className="status-pill status-gray">Off</span>
                        <button type="button" className="btn btn-sm" onClick={() => navigate(`/employees/${e.employee_id}?edit=1`)}>Set Pay Info →</button>
                      </>
                    ) : (
                      <>
                        <span className="status-pill status-gray">Off</span>
                        <button type="button" className="btn btn-sm btn-primary" disabled={isSettingUp} onClick={() => startSetup(e.employee_id)}>Turn On →</button>
                      </>
                    )}
                  </div>

                  {isSettingUp && (
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginTop: 10, padding: 10, background: "var(--surface-2, #f7f7f5)", borderRadius: 6, border: "1px solid var(--teal)" }}>
                      <span className="muted" style={{ fontSize: 12, width: "100%" }}>One-time setup — pick a schedule, then Confirm to turn this employee on.</span>
                      <div className="field" style={{ margin: 0 }}>
                        <label htmlFor={`pa-setup-freq-${e.employee_id}`}>Pay schedule</label>
                        <select id={`pa-setup-freq-${e.employee_id}`} value={setupFrequency} onChange={(ev) => setSetupFrequency(ev.target.value)}>
                          {PAYROLL_AGENT_FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
                        </select>
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label htmlFor={`pa-setup-date-${e.employee_id}`}>Next payday</label>
                        <input id={`pa-setup-date-${e.employee_id}`} type="date" autoFocus value={setupAnchorDate} onChange={(ev) => setSetupAnchorDate(ev.target.value)} />
                      </div>
                      <button type="button" className="btn btn-sm btn-primary" disabled={busyId === e.employee_id} onClick={() => confirmSetup(e.employee_id)}>
                        {busyId === e.employee_id ? "Saving…" : "Confirm"}
                      </button>
                      <button type="button" className="ghost-button btn-sm" onClick={() => setSettingUpId(null)}>Cancel</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface BatchPayrollRow {
  key: string; employee: string; payDate: string; payPeriodStart: string; payPeriodEnd: string;
  regularHours: string; regularRate: string; grossWages: string;
}
type BatchPayrollResult = { ok: true; paycheckId: string; netPay: number } | { ok: false; error: string };

let batchRowSeq = 0;
function newBatchRow(employee: string, payDate: string, employees: Employee[]): BatchPayrollRow {
  const emp = employees.find((e) => e.employee_name === employee);
  return {
    key: `row-${++batchRowSeq}`, employee, payDate, payPeriodStart: "", payPeriodEnd: "",
    regularHours: emp?.default_hours ? String(emp.default_hours) : "",
    regularRate: emp?.pay_rate ? String(emp.pay_rate) : "",
    grossWages: emp?.default_gross_wages ? String(emp.default_gross_wages) : "",
  };
}

/**
 * Two ways into the same batch grid: pick several employees (one row each, same pay
 * date to start) for a normal payroll run, or pick one employee and add several period
 * rows (different pay dates) for catch-up/back pay. Either way every row stays
 * independently editable before submit — real payroll runs rarely have every employee
 * on identical hours. Each row is created via the same createSinglePaycheck the single
 * form uses (POST /accounting/payroll/batch), independently — one bad row doesn't block
 * the rest, and results are shown per row instead of an all-or-nothing outcome.
 */
function BatchPayrollModal({ clientId, employees, onClose, onDone }: { clientId: string; employees: Employee[]; onClose: () => void; onDone: () => void }) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const [mode, setMode] = useState<"employees" | "periods">("employees");
  const [sharedPayDate, setSharedPayDate] = useState("");
  const [periodsEmployee, setPeriodsEmployee] = useState("");
  const [rows, setRows] = useState<BatchPayrollRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, BatchPayrollResult> | null>(null);

  const activeEmployees = employees.filter((e) => !String(e.worker_type || "").toLowerCase().includes("contractor"));
  const selectedNames = new Set(mode === "employees" ? rows.map((r) => r.employee) : []);

  function toggleEmployee(name: string) {
    setResults(null);
    if (selectedNames.has(name)) {
      setRows((prev) => prev.filter((r) => r.employee !== name));
    } else {
      setRows((prev) => [...prev, newBatchRow(name, sharedPayDate, employees)]);
    }
  }

  function applySharedPayDate(value: string) {
    setSharedPayDate(value);
    setRows((prev) => prev.map((r) => ({ ...r, payDate: value })));
  }

  function addPeriodRow() {
    if (!periodsEmployee) return;
    setResults(null);
    const last = rows[rows.length - 1];
    const row = newBatchRow(periodsEmployee, "", employees);
    if (last) { row.regularHours = last.regularHours; row.regularRate = last.regularRate; row.grossWages = last.grossWages; }
    setRows((prev) => [...prev, row]);
  }

  function changeMode(next: "employees" | "periods") {
    setMode(next);
    setRows([]);
    setResults(null);
  }

  function changePeriodsEmployee(name: string) {
    setPeriodsEmployee(name);
    setRows((prev) => prev.map((r) => ({ ...r, employee: name })));
  }

  function updateRow(key: string, patch: Partial<BatchPayrollRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setResults(null);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
    setResults(null);
  }

  const canSubmit = rows.length > 0 && rows.every((r) => r.employee && r.payDate);

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ ok: boolean; succeeded: number; failed: number; results: any[] }>("/accounting/payroll/batch", {
        clientId,
        items: rows.map((r) => ({
          employee: r.employee, payDate: r.payDate,
          payPeriodStart: r.payPeriodStart || undefined, payPeriodEnd: r.payPeriodEnd || undefined,
          regularHours: r.regularHours || undefined, regularRate: r.regularRate || undefined,
          grossWages: r.grossWages || undefined,
        })),
      });
      const byIndex: Record<string, BatchPayrollResult> = {};
      res.results.forEach((r, i) => {
        byIndex[rows[i].key] = r.ok ? { ok: true, paycheckId: r.paycheckId, netPay: Number(r.netPay) || 0 } : { ok: false, error: r.error };
      });
      setResults(byIndex);
      onDone();
    } catch (err) {
      // A batch where every row failed still comes back with a real per-row
      // "results" array explaining why each one did — the backend just sends
      // it alongside a 400 instead of a 2xx, so it lands here instead of the
      // try block above. Render it the same way rather than only showing the
      // generic top-level message and throwing away exactly the detail
      // someone needs to fix their input and resubmit.
      const rowResults = err instanceof ApiError && err.body && typeof err.body === "object" ? (err.body as any).results : undefined;
      if (Array.isArray(rowResults)) {
        const byIndex: Record<string, BatchPayrollResult> = {};
        rowResults.forEach((r: any, i: number) => {
          byIndex[rows[i].key] = r.ok ? { ok: true, paycheckId: r.paycheckId, netPay: Number(r.netPay) || 0 } : { ok: false, error: r.error };
        });
        setResults(byIndex);
      } else {
        setError(err instanceof ApiError ? err.message : "Could not run this batch.");
      }
    } finally {
      setBusy(false);
    }
  }

  const succeededCount = results ? Object.values(results).filter((r) => r.ok).length : 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="batch-paychecks-title" style={{ maxWidth: 820, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="batch-paychecks-title">Batch Create Paychecks</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        {error && <ErrorBanner error={error} />}

        {!results && (
          <>
            <div className="btn-group" style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden", marginBottom: 14, width: "fit-content" }}>
              <button type="button" className="btn btn-sm" style={mode === "employees" ? { background: "var(--teal)", color: "#fff", border: "none", borderRadius: 0 } : { border: "none", borderRadius: 0 }} onClick={() => changeMode("employees")}>
                Multiple Employees
              </button>
              <button type="button" className="btn btn-sm" style={mode === "periods" ? { background: "var(--teal)", color: "#fff", border: "none", borderRadius: 0 } : { border: "none", borderRadius: 0 }} onClick={() => changeMode("periods")}>
                One Employee, Multiple Periods
              </button>
            </div>

            {mode === "employees" ? (
              <>
                <div className="field"><label htmlFor="acct-rr-shared-pay-date">Pay Date (applies to newly checked employees, still editable per row)</label><input id="acct-rr-shared-pay-date" type="date" value={sharedPayDate} onChange={(e) => applySharedPayDate(e.target.value)} /></div>
                <div className="form-section-title">Employees</div>
                <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, marginBottom: 14 }}>
                  {activeEmployees.map((e) => (
                    <label key={e.employee_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--line)", fontSize: 12.5, cursor: "pointer" }}>
                      <input type="checkbox" checked={selectedNames.has(e.employee_name)} onChange={() => toggleEmployee(e.employee_name)} />
                      <div style={{ flex: 1 }}>{e.employee_name}</div>
                    </label>
                  ))}
                  {activeEmployees.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No active employees on this client yet.</p>}
                </div>
              </>
            ) : (
              <>
                <div className="field">
                  <label>Employee</label>
                  <select value={periodsEmployee} onChange={(e) => changePeriodsEmployee(e.target.value)}>
                    <option value="">Select an employee…</option>
                    {activeEmployees.map((e) => <option key={e.employee_id} value={e.employee_name}>{e.employee_name}</option>)}
                  </select>
                </div>
                <button type="button" className="btn btn-sm" disabled={!periodsEmployee} onClick={addPeriodRow} style={{ marginBottom: 14 }}>+ Add Period</button>
              </>
            )}

            {rows.length > 0 && (
              <div className="table-scroll" style={{ marginBottom: 14 }}>
                <table>
                  <thead>
                    <tr>
                      {mode === "employees" ? <th scope="col">Employee</th> : <th scope="col">Pay Date</th>}
                      {mode === "employees" && <th scope="col">Pay Date</th>}
                      <th scope="col">Regular Hours</th><th scope="col">Regular Rate</th><th scope="col">Or Gross Wages</th><th scope="col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key}>
                        {mode === "employees" ? <td>{r.employee}</td> : (
                          <td><input type="date" value={r.payDate} onChange={(e) => updateRow(r.key, { payDate: e.target.value })} style={{ width: 130 }} /></td>
                        )}
                        {mode === "employees" && (
                          <td><input type="date" value={r.payDate} onChange={(e) => updateRow(r.key, { payDate: e.target.value })} style={{ width: 130 }} /></td>
                        )}
                        <td><input type="number" step="0.01" value={r.regularHours} onChange={(e) => updateRow(r.key, { regularHours: e.target.value })} style={{ width: 80 }} /></td>
                        <td><input type="number" step="0.01" value={r.regularRate} onChange={(e) => updateRow(r.key, { regularRate: e.target.value })} style={{ width: 80 }} /></td>
                        <td><input type="number" step="0.01" value={r.grossWages} onChange={(e) => updateRow(r.key, { grossWages: e.target.value })} style={{ width: 90 }} /></td>
                        <td>
                          {mode === "periods"
                            ? <button type="button" className="btn btn-sm" onClick={() => removeRow(r.key)}>✕</button>
                            : <button type="button" className="btn btn-sm" onClick={() => toggleEmployee(r.employee)}>✕</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted" style={{ fontSize: 12.5 }}>
              {rows.length === 0
                ? "Pick employees (or add periods) above to build the batch."
                : `${rows.length} paycheck(s) ready. Each row needs its own Pay Date. Taxes are calculated the same way as a single paycheck — leave Hours/Rate/Gross blank to record a zero-wage entry.`}
            </p>
          </>
        )}

        {results && (
          <>
            <p style={{ fontWeight: 700, marginBottom: 10 }}>{succeededCount} of {rows.length} paycheck(s) created.</p>
            <div className="table-scroll" style={{ marginBottom: 14 }}>
              <table>
                <thead><tr><th scope="col">Employee</th><th scope="col">Pay Date</th><th scope="col">Result</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const res = results[r.key];
                    return (
                      <tr key={r.key}>
                        <td>{r.employee}</td>
                        <td>{r.payDate}</td>
                        <td>{res?.ok ? <span style={{ color: "var(--teal)" }}>Created — net {fmtMoney(res.netPay)}</span> : <span style={{ color: "var(--red)" }}>{res?.error || "Failed"}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          {results ? (
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          ) : (
            <>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={!canSubmit || busy} onClick={handleSubmit}>
                {busy ? "Creating…" : `Create ${rows.length} Paycheck${rows.length === 1 ? "" : "s"}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type ImportPreviewRow = Record<string, any> & { action: "create" | "update" | "duplicate" };
interface ImportPreview { source: "qbo" | "drake"; kind: "employees" | "paychecks"; rows: ImportPreviewRow[] }
interface ImportResultRow { index: number; employeeName: string; ok: boolean; error?: string; created?: boolean; employeeId?: string; netPay?: number; payDate?: string }

const SOURCE_LABEL: Record<string, string> = { qbo: "QuickBooks Online", drake: "Drake Accounting" };
const ACTION_LABEL: Record<string, { text: string; color: string }> = {
  create: { text: "Will create", color: "var(--teal)" },
  update: { text: "Will update existing", color: "var(--muted)" },
  duplicate: { text: "Already exists — skip", color: "var(--red)" },
};

/**
 * Import employees + payroll history from a real QuickBooks Online or Drake
 * Accounting export — an alternative to typing them in one at a time. Auto-detects
 * which of the 4 supported report types was uploaded (see payrollImport/parsers.ts
 * for exactly what each format looks like; reverse-engineered from real sample
 * exports, not guessed). Employees are matched to existing records by name;
 * paychecks that would duplicate an existing one (same employee + pay date) are
 * flagged and skipped rather than silently double-posted.
 */
function ImportTab({ clientId }: { clientId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<ImportResultRow[] | null>(null);

  function reset() {
    setFile(null); setPreview(null); setResults(null); setError(null); setSelected(new Set());
  }

  async function handlePreview() {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const fileBase64 = await fileToBase64(file);
      const res = await api.post<ImportPreview>("/import/preview", { clientId, fileBase64 });
      setPreview(res);
      setSelected(new Set(res.rows.map((_, i) => i).filter((i) => res.rows[i].action !== "duplicate")));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not read this file.");
    } finally {
      setBusy(false);
    }
  }

  function toggleRow(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  function toggleAll() {
    if (!preview) return;
    setSelected((prev) => (prev.size === preview.rows.length ? new Set() : new Set(preview.rows.map((_, i) => i))));
  }

  async function handleCommit() {
    if (!preview) return;
    setBusy(true); setError(null);
    try {
      const rows = preview.rows.filter((_, i) => selected.has(i));
      const res = await api.post<{ results: ImportResultRow[] }>("/import/commit", { clientId, kind: preview.kind, rows });
      setResults(res.results);
    } catch (err) {
      // A fully-failed import still comes back with a real per-row "results"
      // array explaining why each one failed — the backend sends it alongside
      // a 400 instead of a 2xx when nothing succeeded, so it lands here
      // instead of the try block above. Render it the same way rather than
      // only showing the generic top-level message.
      const rowResults = err instanceof ApiError && err.body && typeof err.body === "object" ? (err.body as any).results : undefined;
      if (Array.isArray(rowResults)) {
        setResults(rowResults);
      } else {
        setError(err instanceof ApiError ? err.message : "Could not run this import.");
      }
    } finally {
      setBusy(false);
    }
  }

  const succeededCount = results ? results.filter((r) => r.ok).length : 0;

  return (
    <Panel
      title="Import from QuickBooks Online or Drake Accounting"
      note="Bring in employees and payroll history from a real export instead of typing them in one at a time."
    >
      <div style={{ padding: 16 }}>
        {error && <ErrorBanner error={error} />}

        {!preview && (
          <>
            <FileDropInput file={file} onChange={setFile} accept=".xls,.xlsx" hint="a QBO or Drake export (.xls/.xlsx)" />
            <p className="muted" style={{ fontSize: 12, margin: "10px 0 16px" }}>
              Supported reports — <strong>QuickBooks Online</strong>: Employee Details, Payroll Details.{" "}
              <strong>Drake Accounting</strong>: Employee Listing, Payroll Summary. The file is auto-detected; each import handles one report at a time.
            </p>
            <button type="button" className="btn btn-primary" disabled={!file || busy} onClick={handlePreview}>
              {busy ? "Reading…" : "Preview Import"}
            </button>
          </>
        )}

        {preview && !results && (
          <>
            <p style={{ marginBottom: 12 }}>
              Detected <strong>{SOURCE_LABEL[preview.source]}</strong> — {preview.kind === "employees" ? "Employees" : "Paychecks"} ({preview.rows.length} rows found).
            </p>
            <div className="table-scroll" style={{ marginBottom: 14 }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">
                      <input
                        type="checkbox"
                        aria-label={selected.size === preview.rows.length ? "Deselect all rows" : "Select all rows"}
                        checked={preview.rows.length > 0 && selected.size === preview.rows.length}
                        ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < preview.rows.length; }}
                        onChange={toggleAll}
                      />
                    </th>
                    {preview.kind === "employees" ? (
                      <>
                        <th scope="col">Employee</th><th scope="col">Contact</th><th scope="col">Address</th><th scope="col">Pay Rate</th><th scope="col">Status</th>
                      </>
                    ) : (
                      <>
                        <th scope="col">Employee</th><th scope="col">Pay Date</th><th scope="col">Gross</th><th scope="col">Fed WH</th><th scope="col">State WH</th><th scope="col">Status</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i} style={{ opacity: row.action === "duplicate" ? 0.6 : 1 }}>
                      <td><input type="checkbox" checked={selected.has(i)} onChange={() => toggleRow(i)} /></td>
                      {preview.kind === "employees" ? (
                        <>
                          <td>{row.employeeName}</td>
                          <td>{[row.email, row.phone].filter(Boolean).join(" · ") || "—"}</td>
                          <td>{[row.streetAddress, row.city, row.state].filter(Boolean).join(", ") || "—"}</td>
                          <td>{row.payRate ? `$${row.payRate}/${row.payType === "Salary" ? "yr" : "hr"}` : "—"}</td>
                        </>
                      ) : (
                        <>
                          <td>{row.employeeName}</td>
                          <td>{row.payDate}</td>
                          <td>{row.grossWages != null ? fmtMoney(row.grossWages) : "—"}</td>
                          <td>{row.federalWithholding != null ? fmtMoney(row.federalWithholding) : "—"}</td>
                          <td>{row.stateTax != null ? fmtMoney(row.stateTax) : "—"}</td>
                        </>
                      )}
                      <td style={{ color: ACTION_LABEL[row.action]?.color, fontSize: 12, fontWeight: 600 }}>{ACTION_LABEL[row.action]?.text || row.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
              {selected.size} of {preview.rows.length} row(s) selected.
              {preview.kind === "paychecks" && " Gross wages and Federal/State withholding come from the source file exactly; Social Security, Medicare, FUTA, and SUTA are recalculated using AL TAX Nexus's own rates and this client's year-to-date wages, so annual wage caps stay accurate going forward."}
              {preview.kind === "employees" && " Only the last 4 digits of SSN are ever present in an export — the full number isn't recoverable from it and will need to be entered separately if needed."}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn" onClick={reset}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={selected.size === 0 || busy} onClick={handleCommit}>
                {busy ? "Importing…" : `Import ${selected.size} Row${selected.size === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}

        {results && (
          <>
            <p style={{ fontWeight: 700, marginBottom: 10 }}>{succeededCount} of {results.length} row(s) imported.</p>
            <div className="table-scroll" style={{ marginBottom: 14 }}>
              <table>
                <thead><tr><th scope="col">Employee</th><th scope="col">Result</th></tr></thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i}>
                      <td>{r.employeeName}{r.payDate ? ` — ${r.payDate}` : ""}</td>
                      <td>
                        {r.ok
                          ? <span style={{ color: "var(--teal)" }}>{r.created === false ? "Updated" : "Created"}{r.netPay != null ? ` — net ${fmtMoney(r.netPay)}` : ""}</span>
                          : <span style={{ color: "var(--red)" }}>{r.error || "Failed"}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="btn btn-primary" onClick={reset}>Import Another File</button>
          </>
        )}
      </div>
    </Panel>
  );
}

/**
 * Shared by the Employees tab and Contractors tab — each renders this locked to
 * its own worker type instead of one combined table where you couldn't tell
 * who was who without reading the Type column.
 */
function WorkerProfilesSection({ clientId, clientState, workerType, onWorkersChanged }: { clientId: string; clientState?: string | null; workerType: "Employee" | "Contractor"; onWorkersChanged?: () => void }) {
  const navigate = useNavigate();
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();
  const notify = useNotify();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isContractorTab = workerType === "Contractor";
  const [workers, setWorkers] = useState<Employee[]>([]);
  const [showForm, setShowForm] = useState(false);
  const EMPTY_FORM = { employeeName: "", email: "", phone: "", payType: isContractorTab ? "1099" : "Hourly", payRate: "", defaultHours: "", defaultGrossWages: "", payFrequency: "", serviceCategory: "", grantPortalAccess: false, streetAddress: "", city: "", zipCode: "", state: clientState || "" };
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear()));
  const [printing, setPrinting] = useState<string | null>(null);
  const [viewingForm, setViewingForm] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<{ email: string; link?: string; emailed?: boolean } | null>(null);

  const formLabel = isContractorTab ? "1099-NEC" : "W-2";
  function taxFormPath(emp: Employee) {
    return isContractorTab
      ? `/accounting/tax-forms/1099nec/${emp.employee_id}?year=${taxYear}`
      : `/accounting/tax-forms/w2/${emp.employee_id}?year=${taxYear}`;
  }

  async function handleViewForm(emp: Employee) {
    setViewingForm(emp.employee_id);
    try {
      await viewFile(taxFormPath(emp));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : `Could not generate this ${formLabel}.`);
    } finally {
      setViewingForm(null);
    }
  }

  async function handlePrintForm(emp: Employee) {
    setPrinting(emp.employee_id);
    try {
      await downloadFile(taxFormPath(emp), `${isContractorTab ? "1099NEC" : "W2"}_${taxYear}_${emp.employee_name.replace(/\s+/g, "_")}.pdf`);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : `Could not generate this ${formLabel}.`);
    } finally {
      setPrinting(null);
    }
  }

  async function handleArchive(emp: Employee) {
    const ok = await confirmDialog({ title: "Archive worker", message: `Archive ${emp.employee_name}? Past payroll/1099 history is kept, but they'll drop off active lists.`, confirmLabel: "Archive", danger: true });
    if (!ok) return;
    try {
      await api.post(`/accounting/employees/${emp.employee_id}/archive`, {});
      load();
      onWorkersChanged?.();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not archive this profile.");
    }
  }

  async function handleDelete(emp: Employee) {
    const confirmValue = await promptFor({
      title: "Permanently delete worker",
      message: `"${emp.employee_name}" — this cannot be undone and only works if they have no payroll/1099 history. Type DELETE EMPLOYEE to confirm.`,
      placeholder: "DELETE EMPLOYEE",
    });
    if (confirmValue === null) return;
    try {
      await api.post(`/accounting/employees/${emp.employee_id}/delete`, { confirm: confirmValue });
      load();
      onWorkersChanged?.();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this profile.");
    }
  }

  function workerActionOptions(emp: Employee): ActionMenuOption[] {
    const opts: ActionMenuOption[] = [
      { value: "edit", label: "Edit" },
      { value: "view-form", label: `View ${formLabel}` },
      { value: "download-form", label: `Download ${formLabel}` },
    ];
    if (String(emp.status || "").toLowerCase() !== "archived") opts.push({ value: "archive", label: "Archive" });
    if (isAdmin) opts.push({ value: "delete", label: "Delete" });
    return opts;
  }

  async function handleWorkerAction(emp: Employee, action: string) {
    if (action === "edit") return navigate(`/employees/${emp.employee_id}?edit=1`);
    if (action === "view-form") return handleViewForm(emp);
    if (action === "download-form") return handlePrintForm(emp);
    if (action === "archive") return handleArchive(emp);
    if (action === "delete") return handleDelete(emp);
  }

  function load() {
    api.get<{ employees: Employee[] }>(`/accounting/employees/${clientId}`)
      .then((r) => setWorkers(r.employees.filter((e) => String(e.worker_type || "").toLowerCase().includes("contractor") === isContractorTab)))
      .catch(() => {});
  }
  useEffect(load, [clientId, workerType]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setInviteResult(null);
    try {
      const res = await api.post<{ inviteLink?: string; inviteEmailed?: boolean; employeeId: string }>("/accounting/employees", { clientId, ...form, workerType, payRate: Number(form.payRate) || 0, defaultHours: Number(form.defaultHours) || undefined, defaultGrossWages: Number(form.defaultGrossWages) || 0 });
      if (form.streetAddress.trim() || form.city.trim() || form.zipCode.trim() || form.state.trim()) {
        await api.patch(`/accounting/employees/${res.employeeId}/sensitive`, {
          streetAddress: form.streetAddress.trim(), city: form.city.trim(), zipCode: form.zipCode.trim(), state: form.state.trim(),
        });
      }
      if (res.inviteLink || res.inviteEmailed) setInviteResult({ email: form.email.trim(), link: res.inviteLink, emailed: res.inviteEmailed });
      setShowForm(false);
      setForm(EMPTY_FORM);
      load();
      onWorkersChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn btn-primary" style={{ marginBottom: 16 }} onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : `Add ${workerType}`}</button>
      {inviteResult && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--teal)" }}>
          {inviteResult.emailed ? (
            <>Portal access granted — invite emailed to {inviteResult.email}.</>
          ) : (
            <>Portal access granted. Email not sent — send this invite link to the employee yourself: <code style={{ wordBreak: "break-all" }}>{inviteResult.link}</code></>
          )}
        </div>
      )}
      {showForm && (
        <form onSubmit={handleSubmit} className="card" style={{ maxWidth: 460, marginBottom: 20 }}>
          {error && <ErrorBanner error={error} />}
          <div className="field"><label htmlFor="acct-l-employee-name">Name</label><input id="acct-l-employee-name" required value={form.employeeName} onChange={(e) => setForm((f) => ({ ...f, employeeName: e.target.value }))} /></div>
          <div className="field">
            <label htmlFor="acct-l-pay-type">Pay Type</label>
            <select id="acct-l-pay-type" value={form.payType} onChange={(e) => setForm((f) => ({ ...f, payType: e.target.value }))}>
              {isContractorTab ? <option>1099</option> : <><option>Hourly</option><option>Salary</option></>}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label htmlFor="acct-l-pay-rate">Pay Rate</label><input id="acct-l-pay-rate" type="number" step="0.01" value={form.payRate} onChange={(e) => setForm((f) => ({ ...f, payRate: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-l-default-hours">Default Hours</label><input id="acct-l-default-hours" type="number" value={form.defaultHours} onChange={(e) => setForm((f) => ({ ...f, defaultHours: e.target.value }))} /></div>
          </div>
          <div className="field"><label htmlFor="acct-l-default-gross-wages">Default Gross Wages</label><input id="acct-l-default-gross-wages" type="number" step="0.01" value={form.defaultGrossWages} onChange={(e) => setForm((f) => ({ ...f, defaultGrossWages: e.target.value }))} /></div>
          <div className="field">
            <label>Pay Frequency (drives withholding calculation)</label>
            <select value={form.payFrequency} onChange={(e) => setForm((f) => ({ ...f, payFrequency: e.target.value }))}>
              <option value="">Select…</option>
              {PAYROLL_FREQS.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          {isContractorTab && (
            <div className="field"><label htmlFor="acct-l-service-category">Service Category</label><input id="acct-l-service-category" value={form.serviceCategory} onChange={(e) => setForm((f) => ({ ...f, serviceCategory: e.target.value }))} placeholder="e.g. Contract Labor" /></div>
          )}
          <div className="field"><label htmlFor="acct-l-email">Email</label><input id="acct-l-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
          <div className="field"><label htmlFor="acct-l-phone">Phone</label><input id="acct-l-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
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
          {!isContractorTab && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, margin: "8px 0 12px" }}>
              <input type="checkbox" checked={form.grantPortalAccess} onChange={(e) => setForm((f) => ({ ...f, grantPortalAccess: e.target.checked }))} />
              Grant employee portal access (requires an email above)
            </label>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </form>
      )}
      <Panel
        title={isContractorTab ? "Contractors" : "Employees"}
        note={`${workers.length} profiles`}
        action={
          <div className="field" style={{ margin: 0 }}>
            <label>Tax Year</label>
            <input type="number" value={taxYear} onChange={(e) => setTaxYear(e.target.value)} style={{ width: 90 }} />
          </div>
        }
      >
        <div className="table-scroll card-table">
        <table>
          <thead><tr><th scope="col">Name</th><th scope="col">Pay Type</th><th scope="col">State</th><th scope="col">Rate</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
          <tbody>
            {workers.map((e) => (
              <tr key={e.employee_id} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => navigate(`/employees/${e.employee_id}`)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); navigate(`/employees/${e.employee_id}`); } }}>
                <td data-label="Name"><Link to={`/employees/${e.employee_id}`} style={{ fontWeight: 600 }}>{e.employee_name}</Link></td>
                <td className="muted" data-label="Pay Type">{e.pay_type || "—"}</td>
                <td className="muted" data-label="State">{e.state || "—"}</td>
                <td data-label="Rate">{fmtMoney(e.pay_rate)}</td>
                <td className="muted" data-label="Status">{e.status}</td>
                <td data-label="Action" onClick={(ev) => ev.stopPropagation()}>
                  <ActionMenu
                    options={workerActionOptions(e)}
                    disabled={viewingForm === e.employee_id || printing === e.employee_id}
                    onSelect={(action) => handleWorkerAction(e, action)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {workers.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No {isContractorTab ? "contractors" : "employees"} added yet.</p>}
        <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>Click a name to open their profile and send them a file. {formLabel}, Archive, and Delete are in the Actions menu.</p>
      </Panel>
    </div>
  );
}

function EmployeesTab({ clientId, clientState }: { clientId: string; clientState?: string | null }) {
  return <WorkerProfilesSection clientId={clientId} clientState={clientState} workerType="Employee" />;
}

const EMPTY_CONTRACTOR_PAYMENT_FORM = {
  contractorId: "", amount: "", paymentDate: "", method: "Check", paymentMethodId: "",
  checkNumber: "", confirmationNumber: "", expenseCategory: "", eligible1099: true, memo: "",
};
const CONTRACTOR_PAYMENT_METHODS = ["Check", "ACH", "Zelle", "Cash", "Card", "Other"];

function ContractorsTab({ clientId, clientState }: { clientId: string; clientState?: string | null }) {
  const notify = useNotify();
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
      await notify(err instanceof ApiError ? err.message : "Could not generate this 1099-NEC.");
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
      await notify(err instanceof ApiError ? err.message : "Could not generate this 1099-NEC.");
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
    // Stacked, not side-by-side: the payment history needs ~620px and only got
    // 476 as the right half of a two-column grid, so it was cut off at 100%
    // zoom no matter how few columns it had.
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      <WorkerProfilesSection clientId={clientId} clientState={clientState} workerType="Contractor" onWorkersChanged={load} />
      <Panel title="Record Contractor Payment">
        <form onSubmit={handleSubmit} style={{ padding: 16 }}>
          {error && <ErrorBanner error={error} />}
          <div className="field">
            <label htmlFor="acct-se-contractor">Contractor</label>
            <select id="acct-se-contractor" required value={form.contractorId} onChange={(e) => setForm((f) => ({ ...f, contractorId: e.target.value }))}>
              <option value="">Select a contractor…</option>
              {contractors.map((c) => <option key={c.employee_id} value={c.employee_id}>{c.employee_name}</option>)}
            </select>
          </div>
          {contractors.length === 0 && <p className="muted" style={{ marginTop: -6 }}>No contractor profiles yet — use "Add Contractor" above first.</p>}
          <div className="field"><label htmlFor="acct-se-amount">Amount</label><input id="acct-se-amount" type="number" step="0.01" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></div>
          <div className="field"><label htmlFor="acct-se-payment-date-2">Payment Date</label><input id="acct-se-payment-date-2" type="date" required value={form.paymentDate} onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label htmlFor="acct-se-method">Method</label><select id="acct-se-method" value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>{CONTRACTOR_PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
            <div className="field">
              <label htmlFor="acct-se-1099-eligible">1099 Eligible</label>
              <select id="acct-se-1099-eligible" value={form.eligible1099 ? "yes" : "no"} onChange={(e) => setForm((f) => ({ ...f, eligible1099: e.target.value === "yes" }))}>
                <option value="yes">Yes</option><option value="no">No</option>
              </select>
            </div>
            <div className="field"><label htmlFor="acct-se-check-number-2">Check #</label><input id="acct-se-check-number-2" value={form.checkNumber} onChange={(e) => setForm((f) => ({ ...f, checkNumber: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-confirmation-number">Confirmation #</label><input id="acct-se-confirmation-number" value={form.confirmationNumber} onChange={(e) => setForm((f) => ({ ...f, confirmationNumber: e.target.value }))} /></div>
          </div>
          <div className="field">
            <label htmlFor="acct-se-payment-profile">Payment Profile (bank info for the check)</label>
            <select id="acct-se-payment-profile" value={form.paymentMethodId} onChange={(e) => setForm((f) => ({ ...f, paymentMethodId: e.target.value }))}>
              <option value="">No bank profile — free-text method only</option>
              {paymentMethods.map((m) => <option key={m.payment_method_id} value={m.payment_method_id}>{m.method_name} ({m.method_type})</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="acct-se-expense-category">Expense Category</label><input id="acct-se-expense-category" value={form.expenseCategory} onChange={(e) => setForm((f) => ({ ...f, expenseCategory: e.target.value }))} placeholder="e.g. Contract Labor" /></div>
          <div className="field"><label htmlFor="acct-se-memo">Memo</label><input id="acct-se-memo" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} /></div>
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
            {editError && <ErrorBanner error={editError} />}
            <div className="field"><label htmlFor="acct-se-edit-amount">Amount</label><input id="acct-se-edit-amount" type="number" step="0.01" required value={editForm.amount} onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-edit-payment-date-2">Payment Date</label><input id="acct-se-edit-payment-date-2" type="date" required value={editForm.paymentDate} onChange={(e) => setEditForm((f) => ({ ...f, paymentDate: e.target.value }))} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field"><label htmlFor="acct-se-edit-method">Method</label><select id="acct-se-edit-method" value={editForm.method} onChange={(e) => setEditForm((f) => ({ ...f, method: e.target.value }))}>{CONTRACTOR_PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
              <div className="field">
                <label htmlFor="acct-se-edit-1099-eligible">1099 Eligible</label>
                <select id="acct-se-edit-1099-eligible" value={editForm.eligible1099 ? "yes" : "no"} onChange={(e) => setEditForm((f) => ({ ...f, eligible1099: e.target.value === "yes" }))}>
                  <option value="yes">Yes</option><option value="no">No</option>
                </select>
              </div>
              <div className="field"><label htmlFor="acct-se-edit-check-number">Check #</label><input id="acct-se-edit-check-number" value={editForm.checkNumber} onChange={(e) => setEditForm((f) => ({ ...f, checkNumber: e.target.value }))} /></div>
              <div className="field"><label htmlFor="acct-se-edit-confirmation-number">Confirmation #</label><input id="acct-se-edit-confirmation-number" value={editForm.confirmationNumber} onChange={(e) => setEditForm((f) => ({ ...f, confirmationNumber: e.target.value }))} /></div>
            </div>
            <div className="field">
              <label htmlFor="acct-se-edit-payment-profile">Payment Profile</label>
              <select id="acct-se-edit-payment-profile" value={editForm.paymentMethodId} onChange={(e) => setEditForm((f) => ({ ...f, paymentMethodId: e.target.value }))}>
                <option value="">No bank profile — free-text method only</option>
                {paymentMethods.map((m) => <option key={m.payment_method_id} value={m.payment_method_id}>{m.method_name} ({m.method_type})</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="acct-se-edit-expense-category">Expense Category</label><input id="acct-se-edit-expense-category" value={editForm.expenseCategory} onChange={(e) => setEditForm((f) => ({ ...f, expenseCategory: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-edit-memo">Memo</label><input id="acct-se-edit-memo" value={editForm.memo} onChange={(e) => setEditForm((f) => ({ ...f, memo: e.target.value }))} /></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={editSaving}>{editSaving ? "Saving…" : "Save & Recalculate"}</button>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        )}
        <div className="scroll-list">
          <div className="table-scroll">
          <table>
            {/* Method/Category/1099/Memo used to be four separate columns and ran
                ~145px past the panel edge; they now ride under their subject. */}
            <thead><tr><th scope="col">Date</th><th scope="col">Contractor</th><th scope="col" style={{ textAlign: "right" }}>Amount</th><th scope="col"></th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.contractor_payment_id} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => setViewing(p)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setViewing(p); } }}>
                  <td>
                    <div>{fmtDate(p.payment_date)}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{p.method}</div>
                  </td>
                  <td>
                    <div>{p.contractor_name}</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {p.expense_category || "Uncategorized"}
                      {p.is_1099_eligible ? " · 1099" : ""}
                    </div>
                    {p.memo && <div className="muted" style={{ fontSize: 11 }}>{p.memo}</div>}
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(p.amount)}</td>
                  <td style={{ display: "flex", gap: 6 }} onClick={(ev) => ev.stopPropagation()}>
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
              <label htmlFor="acct-se-nec-contractor">Contractor</label>
              <select id="acct-se-nec-contractor" required value={necContractorId} onChange={(e) => setNecContractorId(e.target.value)}>
                <option value="">Select a contractor…</option>
                {contractors.map((c) => <option key={c.employee_id} value={c.employee_id}>{c.employee_name}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="acct-se-nec-year">Tax Year</label>
              <input id="acct-se-nec-year" type="number" value={necYear} onChange={(e) => setNecYear(e.target.value)} style={{ width: 90 }} />
            </div>
            <button type="button" className="btn" disabled={viewingNec || !necContractorId} onClick={handleViewNec}>{viewingNec ? "Generating…" : "View 1099-NEC"}</button>
            <button type="submit" className="btn btn-primary" disabled={printingNec || !necContractorId}>{printingNec ? "Generating…" : "Download 1099-NEC"}</button>
          </form>
        </Panel>
      </div>
    </div>
  );
}

/** Sum one side of a journal entry — used for both the list total and the balance check. */
function jeTotal(entry: any, side: "debit" | "credit"): number {
  return (entry?.lines || []).reduce((sum: number, l: any) => sum + Number(l[side] || 0), 0);
}

function ManualJeTab({ clientId }: { clientId: string }) {
  const promptFor = usePrompt();
  const notify = useNotify();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [lines, setLines] = useState([{ account: "", debit: "", credit: "", memo: "" }, { account: "", debit: "", credit: "", memo: "" }]);
  const [viewingJe, setViewingJe] = useState<any | null>(null);
  const [replacingJeId, setReplacingJeId] = useState<string | null>(null);
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

  /**
   * Journal entries delete whole, never line-by-line: a half-deleted entry would
   * leave the ledger permanently out of balance.
   */
  async function handleDeleteJe(entry: any) {
    const typed = await promptFor({
      title: "Delete journal entry",
      message: `${entry.ref || entry.journalEntryId} dated ${fmtDate(entry.entryDate)} — all ${entry.lines.length} line(s) and their general-ledger postings will be removed. This cannot be undone. Type DELETE to confirm.`,
      placeholder: "DELETE",
    });
    if (typed === null) return;
    try {
      const res = await api.post<{ linesRemoved: number; glLinesRemoved: number }>(
        `/accounting/journal-entries/${entry.journalEntryId}/delete`, { confirm: typed }
      );
      setViewingJe(null);
      loadHistory();
      await notify(`Journal entry deleted — ${res.linesRemoved} line(s), ${res.glLinesRemoved} general-ledger line(s) reversed.`);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this journal entry.");
    }
  }

  /**
   * Edits by replacement: the entry's lines are loaded back into the form, and
   * saving posts the corrected entry then removes the original.
   *
   * There is no update route for journal entries, and adding one would mean
   * reconciling changed/added/removed lines against their GL postings — a lot
   * of moving parts for something post-then-remove achieves exactly. The new
   * entry is created BEFORE the old one is deleted, so a failure mid-way leaves
   * the original intact rather than losing both.
   */
  function startEditJe(entry: any) {
    setEntryDate(entry.entryDate ? String(entry.entryDate).slice(0, 10) : "");
    setRef(entry.ref || "");
    setDescription(entry.description || "");
    setNotes("");
    setLines(
      (entry.lines || []).map((l: any) => ({
        account: l.account || "",
        debit: Number(l.debit) ? String(l.debit) : "",
        credit: Number(l.credit) ? String(l.credit) : "",
        memo: l.notes || "",
      }))
    );
    setReplacingJeId(entry.journalEntryId);
    setViewingJe(null);
    setError(null);
    setSuccess(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEditJe() {
    setReplacingJeId(null);
    setLines([{ account: "", debit: "", credit: "", memo: "" }, { account: "", debit: "", credit: "", memo: "" }]);
    setDescription("");
    setRef("");
    setNotes("");
  }

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
      if (replacingJeId) {
        // Only now that the replacement exists is it safe to drop the original.
        await api.post(`/accounting/journal-entries/${replacingJeId}/delete`, { confirm: "DELETE" });
        setReplacingJeId(null);
        setSuccess(`Journal entry replaced — ${res.jeId} posted and the previous version removed.`);
      } else {
        setSuccess(`Journal entry ${res.jeId} posted (${res.lines} lines).`);
      }
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
    // Stacked for the same reason as Contractors: the entry history and its
    // expanded detail card need the full width, not a ~366px column.
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      <Panel title={replacingJeId ? "Edit Journal Entry" : "Manual Journal Entry"} note={replacingJeId ? "Saving replaces the original entry" : "Debits must equal credits"}>
        <form onSubmit={handleSubmit} style={{ padding: 16 }}>
          {replacingJeId && (
            <div className="card" style={{ marginBottom: 14, borderColor: "var(--teal)", fontSize: 13 }}>
              Editing <strong>{replacingJeId}</strong>. Saving posts the corrected entry and removes the original.{" "}
              <button type="button" className="btn btn-sm" style={{ marginLeft: 8 }} onClick={cancelEditJe}>Cancel edit</button>
            </div>
          )}
          {error && <ErrorBanner error={error} />}
          {success && <div className="card" style={{ marginBottom: 14, borderColor: "var(--teal)" }}>{success}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 4 }}>
            <div className="field"><label htmlFor="acct-cej-entry-date">Entry Date</label><input id="acct-cej-entry-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div>
            <div className="field"><label htmlFor="acct-cej-ref">Reference</label><input id="acct-cej-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Auto if left blank" /></div>
            <div className="field"><label htmlFor="acct-cej-description">Description</label><input id="acct-cej-description" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <div className="field"><label htmlFor="acct-cej-notes">Notes</label><input id="acct-cej-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Falls back to per-line memo" /></div>
          </div>
          {lines.map((line, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1.5fr auto", gap: 8, marginBottom: 8, alignItems: "end" }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Account</label>
                <select required value={line.account} onChange={(e) => updateLine(i, { account: e.target.value })}>
                  <option value="">Choose…</option>
                  {line.account && !accounts.some((a) => a.active && a.account_name === line.account) && (
                    <option value={line.account}>{line.account} (Inactive)</option>
                  )}
                  {accounts.filter((a) => a.active).map((a) => <option key={a.account_id} value={a.account_name}>{a.account_name}</option>)}
                </select>
              </div>
              {/* A line with both Debit and Credit filled isn't a real entry — it's
                  a self-canceling no-op that still passes the overall balance
                  check. Typing one clears the other so a line can only ever be
                  one side of the entry. */}
              <div className="field" style={{ margin: 0 }}><label>Debit</label><input type="number" step="0.01" value={line.debit} onChange={(e) => updateLine(i, { debit: e.target.value, credit: e.target.value ? "" : line.credit })} /></div>
              <div className="field" style={{ margin: 0 }}><label>Credit</label><input type="number" step="0.01" value={line.credit} onChange={(e) => updateLine(i, { credit: e.target.value, debit: e.target.value ? "" : line.debit })} /></div>
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
        {/* Row click opens the full entry, matching how Sales rows behave. */}
        {viewingJe && (
          <div className="card" style={{ margin: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div>
                <strong>Journal Entry — {fmtDate(viewingJe.entryDate)}</strong>
                <div className="muted" style={{ fontSize: 12 }}>
                  {viewingJe.ref || viewingJe.journalEntryId}{viewingJe.description ? ` · ${viewingJe.description}` : ""}
                </div>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => setViewingJe(null)}>Close</button>
            </div>
            <div className="table-scroll" style={{ marginTop: 10 }}>
              <table>
                <thead><tr><th scope="col">Account</th><th scope="col" style={{ textAlign: "right" }}>Debit</th><th scope="col" style={{ textAlign: "right" }}>Credit</th><th scope="col">Memo</th></tr></thead>
                <tbody>
                  {viewingJe.lines.map((l: any, idx: number) => (
                    <tr key={idx}>
                      <td>{l.account}</td>
                      <td style={{ textAlign: "right" }}>{Number(l.debit) ? fmtMoney(l.debit) : "—"}</td>
                      <td style={{ textAlign: "right" }}>{Number(l.credit) ? fmtMoney(l.credit) : "—"}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{l.notes || "—"}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ fontWeight: 700 }}>Total</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtMoney(jeTotal(viewingJe, "debit"))}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtMoney(jeTotal(viewingJe, "credit"))}</td>
                    <td className="muted" style={{ fontSize: 11 }}>
                      {Math.abs(jeTotal(viewingJe, "debit") - jeTotal(viewingJe, "credit")) < 0.005 ? "In balance" : "OUT OF BALANCE"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {isAdmin ? (
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => startEditJe(viewingJe)}>
                Edit This Entry
              </button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDeleteJe(viewingJe)}>
                Delete This Entry
              </button>
              </div>
            ) : (
              // Editing/deleting a manual JE deletes-then-reposts under the hood, and
              // that delete step is admin-only server-side — a staff user hitting this
              // would post the replacement, then 403 on removing the original, leaving
              // a duplicate posting live. Hidden here rather than left to fail partway.
              <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>Only an admin can edit or delete a posted entry.</p>
            )}
          </div>
        )}
        <div className="scroll-list">
          <div className="table-scroll">
          <table>
            {/* This panel is the narrow half of a two-column grid, so Ref and the
                line count ride under their neighbours rather than owning columns. */}
            <thead><tr><th scope="col">Date</th><th scope="col">Entry</th><th scope="col" style={{ textAlign: "right" }}>Total</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.journalEntryId} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => setViewingJe(e)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setViewingJe(e); } }}>
                  <td>
                    <div>{fmtDate(e.entryDate)}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{e.lines.length} line(s)</div>
                  </td>
                  <td>
                    <div>{e.description || "—"}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{e.ref || e.journalEntryId}</div>
                  </td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(jeTotal(e, "debit"))}</td>
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

function GlTab({ clientId, initialRef, initialAccount }: { clientId: string; initialRef?: string | null; initialAccount?: string | null }) {
  const [entries, setEntries] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [viewingRef, setViewingRef] = useState<string | null>(initialRef || null);
  const [viewingRefLines, setViewingRefLines] = useState<any[] | null>(null);
  const [accountFilter, setAccountFilter] = useState(initialAccount || "");
  // Deep links (Trial Balance rows) must not have their target hidden by the
  // default this-month window — the entry they point at can be any age.
  const [period, setPeriod] = useState(() => {
    if (initialRef || initialAccount) return { start: "", end: "" };
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { start, end };
  });

  const [allAccounts, setAllAccounts] = useState<string[]>([]);

  function loadEntries(): Promise<void> {
    const params = new URLSearchParams();
    if (period.start) params.set("start", period.start);
    if (period.end) params.set("end", period.end);
    if (accountFilter) params.set("account", accountFilter);
    const qs = params.toString();
    return api.get<{ glEntries: any[] }>(`/accounting/gl/${clientId}${qs ? `?${qs}` : ""}`).then((r) => setEntries(r.glEntries)).catch(() => {});
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadEntries(); }, [clientId, period.start, period.end, accountFilter]);
  // Every account the client has ever posted to, independent of the visible
  // period, so the filter dropdown doesn't shrink to "only what happened
  // this month" once the GL fetch itself became period-scoped.
  useEffect(() => {
    api.get<{ accounts: CoaAccount[] }>("/accounting/coa").then((r) => setAllAccounts([...new Set(r.accounts.map((a) => a.account_name))].sort())).catch(() => {});
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await loadEntries();
    } finally {
      setRefreshing(false);
    }
  }

  const accounts = allAccounts;
  const filtered = entries;

  function handleExportCsv() {
    exportCsv(
      `gl-${clientId}.csv`,
      [
        { key: "entry_date", label: "Date" }, { key: "ref", label: "Ref" }, { key: "account", label: "Account" },
        { key: "description", label: "Description" }, { key: "debit", label: "Debit" }, { key: "credit", label: "Credit" },
        { key: "source", label: "Source" },
      ],
      filtered as unknown as Record<string, unknown>[]
    );
  }
  // Every line of the entry the user clicked — fetched fresh by ref rather than
  // read from the (possibly account-filtered) `entries` list above, so a
  // multi-line entry can't show as short a leg or two just because the current
  // Account filter happens to exclude one of its accounts. See the backend's
  // GET /gl/:clientId?ref= handling for why this ignores the active filters.
  useEffect(() => {
    if (!viewingRef) { setViewingRefLines(null); return; }
    api.get<{ glEntries: any[] }>(`/accounting/gl/${clientId}?ref=${encodeURIComponent(viewingRef)}`)
      .then((r) => setViewingRefLines(r.glEntries))
      .catch(() => setViewingRefLines([]));
  }, [clientId, viewingRef]);
  const refLines = viewingRefLines || [];
  const refDebit = refLines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
  const refCredit = refLines.reduce((sum, l) => sum + Number(l.credit || 0), 0);

  const totalDebit = filtered.reduce((s, g) => s + Number(g.debit || 0), 0);
  const totalCredit = filtered.reduce((s, g) => s + Number(g.credit || 0), 0);

  return (
    <Panel
      title="General Ledger"
      note={`${filtered.length} entries${filtered.length >= 2000 ? " (capped — narrow the date range to see more)" : ""}`}
      action={
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
          <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} style={{ padding: "4px 6px", maxWidth: 180 }}>
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input type="date" value={period.start} onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))} style={{ padding: "4px 6px" }} />
          <span className="muted">to</span>
          <input type="date" value={period.end} onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))} style={{ padding: "4px 6px" }} />
          <button type="button" className="ghost-button" disabled={refreshing} onClick={handleRefresh}><RefreshCw size={13} strokeWidth={2} aria-hidden="true" className={refreshing ? "icon-spin" : undefined} />{refreshing ? "Refreshing…" : "Refresh"}</button>
          <button type="button" className="ghost-button" onClick={handleExportCsv}><Download size={13} strokeWidth={2} aria-hidden="true" />Export CSV</button>
        </div>
      }
    >
      <div className="metric-grid" style={{ margin: 16 }}>
        <div className="metric"><div className="metric-label">Debits</div><div className="metric-value">{fmtMoney(totalDebit)}</div></div>
        <div className="metric"><div className="metric-label">Credits</div><div className="metric-value">{fmtMoney(totalCredit)}</div></div>
        <div className="metric">
          <div className="metric-label">Difference</div>
          <div className="metric-value" style={{ color: Math.abs(totalDebit - totalCredit) < 0.01 ? undefined : "var(--red)" }}>{fmtMoney(Math.abs(totalDebit - totalCredit))}</div>
        </div>
      </div>
      {/* Clicking any line opens the WHOLE entry it belongs to, not just that
          line. A ledger row on its own is half a story — the useful question is
          always "what did this posting actually do", which means every line
          sharing the ref, and whether they balance. */}
      {viewingRef && (
        <div className="card" style={{ margin: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div>
              <strong>Journal Entry — {viewingRef}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {refLines[0]?.source} · {fmtDate(refLines[0]?.entry_date)} · {refLines.length} line(s)
              </div>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => setViewingRef(null)}>Close</button>
          </div>
          {viewingRefLines === null ? (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Loading…</p>
          ) : (
            <>
              <div className="table-scroll" style={{ marginTop: 10 }}>
                <table>
                  <thead><tr><th scope="col">Account</th><th scope="col">Description</th><th scope="col" style={{ textAlign: "right" }}>Debit</th><th scope="col" style={{ textAlign: "right" }}>Credit</th></tr></thead>
                  <tbody>
                    {refLines.map((l, i) => (
                      <tr key={l.gl_entry_id || i}>
                        <td>{l.account}</td>
                        <td className="muted" style={{ fontSize: 12 }}>{l.description}</td>
                        <td style={{ textAlign: "right" }}>{Number(l.debit) ? fmtMoney(l.debit) : "—"}</td>
                        <td style={{ textAlign: "right" }}>{Number(l.credit) ? fmtMoney(l.credit) : "—"}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ fontWeight: 700 }}>Total</td>
                      <td />
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtMoney(refDebit)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtMoney(refCredit)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p
                className="muted"
                style={{ fontSize: 12, marginTop: 8, color: Math.abs(refDebit - refCredit) < 0.005 ? undefined : "var(--red)", fontWeight: Math.abs(refDebit - refCredit) < 0.005 ? undefined : 700 }}
              >
                {Math.abs(refDebit - refCredit) < 0.005
                  ? "This entry balances."
                  : `OUT OF BALANCE by ${fmtMoney(Math.abs(refDebit - refCredit))} — see Reports → Trial Balance.`}
              </p>
            </>
          )}
        </div>
      )}
      <div className="table-scroll">
      <table>
        <thead><tr><th scope="col">Date</th><th scope="col">Ref</th><th scope="col">Account</th><th scope="col">Description</th><th scope="col" style={{ textAlign: "right" }}>Debit</th><th scope="col" style={{ textAlign: "right" }}>Credit</th><th scope="col">Source</th></tr></thead>
        <tbody>
          {filtered.slice(0, 60).map((g, i) => (
            <tr
              key={g.gl_entry_id || i}
              style={{ cursor: "pointer" }}
              tabIndex={0}
              onClick={() => setViewingRef(g.ref || null)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setViewingRef(g.ref || null); } }}
            >
              <td>{fmtDate(g.entry_date)}</td>
              <td className="muted">{g.ref || "—"}</td>
              <td>{g.account}</td>
              <td className="muted">{g.description}</td>
              <td style={{ textAlign: "right" }}>{Number(g.debit) ? fmtMoney(g.debit) : "—"}</td>
              <td style={{ textAlign: "right" }}>{Number(g.credit) ? fmtMoney(g.credit) : "—"}</td>
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
  const promptFor = usePrompt();
  const notify = useNotify();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [viewingCheck, setViewingCheck] = useState<any | null>(null);
  const [paychecks, setPaychecks] = useState<any[]>([]);
  const [printing, setPrinting] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ payDate: "", regularHours: "", regularRate: "", grossWages: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Defaults to the last 90 days rather than a client's entire payroll
  // history — widen or clear either box to see further back.
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return { start, end: "" };
  });

  function load() {
    const params = new URLSearchParams();
    if (period.start) params.set("start", period.start);
    if (period.end) params.set("end", period.end);
    const qs = params.toString();
    api.get<{ paychecks: any[] }>(`/accounting/paychecks/${clientId}${qs ? `?${qs}` : ""}`).then((r) => setPaychecks(r.paychecks)).catch(() => {});
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [clientId, period.start, period.end]);

  async function handleView(p: any) {
    setViewing(p.paycheck_id);
    try {
      await viewFile(`/accounting/paychecks/${p.paycheck_id}/print`);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not generate this paycheck.");
    } finally {
      setViewing(null);
    }
  }

  async function handlePrint(p: any) {
    setPrinting(p.paycheck_id);
    try {
      await downloadFile(`/accounting/paychecks/${p.paycheck_id}/print`, `Paycheck_${p.check_number || p.paycheck_id}.pdf`);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not generate this paycheck.");
    } finally {
      setPrinting(null);
    }
  }

  async function handleDelete(p: any) {
    const confirmValue = await promptFor({
      title: "Permanently delete paycheck",
      message: `${p.employee} (${fmtDate(p.pay_date)}) — this cannot be undone. Type DELETE PAYCHECK to confirm.`,
      placeholder: "DELETE PAYCHECK",
    });
    if (confirmValue === null) return;
    setDeleting(p.paycheck_id);
    try {
      await api.post(`/accounting/paychecks/${p.paycheck_id}/delete`, { confirm: confirmValue });
      if (viewingCheck?.paycheck_id === p.paycheck_id) setViewingCheck(null);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this paycheck.");
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
      // See the Payroll tab's startEdit — pre-filling this silently defeated
      // every hours/rate edit, because gross always wins over hours × rate.
      grossWages: "",
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
    <Panel
      title="Paychecks"
      note={`${paychecks.length} row${paychecks.length === 1 ? "" : "s"}${!period.start && !period.end ? "" : " in range — widen the dates to see more"}`}
      action={
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
          <input type="date" value={period.start} onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))} style={{ padding: "4px 6px" }} />
          <span className="muted">to</span>
          <input type="date" value={period.end} onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))} style={{ padding: "4px 6px" }} />
          {(period.start || period.end) && <button type="button" className="ghost-button" onClick={() => setPeriod({ start: "", end: "" })}>All time</button>}
        </div>
      }
    >
      {editing && (
        <form onSubmit={handleSaveEdit} className="card" style={{ margin: 16, maxWidth: 460 }}>
          <strong>Edit paycheck — {editing.employee}</strong>
          {error && <ErrorBanner error={error} />}
          <div className="field"><label htmlFor="acct-se-edit-pay-date-2">Pay Date</label><input id="acct-se-edit-pay-date-2" type="date" value={editForm.payDate} onChange={(e) => setEditForm((f) => ({ ...f, payDate: e.target.value }))} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label htmlFor="acct-se-edit-regular-hours-2">Regular Hours</label><input id="acct-se-edit-regular-hours-2" type="number" step="0.01" value={editForm.regularHours} onChange={(e) => setEditForm((f) => ({ ...f, regularHours: e.target.value }))} /></div>
            <div className="field"><label htmlFor="acct-se-edit-regular-rate-2">Regular Rate</label><input id="acct-se-edit-regular-rate-2" type="number" step="0.01" value={editForm.regularRate} onChange={(e) => setEditForm((f) => ({ ...f, regularRate: e.target.value }))} /></div>
          </div>
          <div className="field"><label htmlFor="acct-se-edit-gross-wages-2">Or Gross Wages (leave blank to recalculate from hours × rate)</label><input id="acct-se-edit-gross-wages-2" type="number" step="0.01" value={editForm.grossWages} onChange={(e) => setEditForm((f) => ({ ...f, grossWages: e.target.value }))} /></div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save & Recalculate"}</button>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
      {/* This card lived inside <table> before <thead>, which is invalid markup —
          the browser hoists it out and decides where it lands. It belongs here. */}
      {viewingCheck && (
            <div className="card" style={{ margin: 16 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div>
                  <strong>{viewingCheck.employee} — {fmtDate(viewingCheck.pay_date)}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Check #{viewingCheck.check_number || "—"} ·{" "}
                    {viewingCheck.pay_period_start || viewingCheck.pay_period_end
                      ? `${fmtDate(viewingCheck.pay_period_start)} – ${fmtDate(viewingCheck.pay_period_end)}`
                      : "No period recorded"}
                  </div>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => setViewingCheck(null)}>Close</button>
              </div>
              <div className="metric-grid" style={{ margin: "12px 0" }}>
                <div className="metric"><div className="metric-label">Gross Wages</div><div className="metric-value" style={{ fontSize: 18 }}>{fmtMoney(viewingCheck.gross_wages)}</div></div>
                <div className="metric"><div className="metric-label">Employee Taxes</div><div className="metric-value" style={{ fontSize: 18 }}>{fmtMoney(viewingCheck.employee_taxes)}</div></div>
                <div className="metric"><div className="metric-label">Net Pay</div><div className="metric-value" style={{ fontSize: 18 }}>{fmtMoney(viewingCheck.net_pay)}</div></div>
              </div>
              <div className="table-scroll">
                <table>
                  <tbody>
                    <tr><td>Gross wages</td><td style={{ textAlign: "right" }}>{fmtMoney(viewingCheck.gross_wages)}</td></tr>
                    <tr><td className="muted">Less employee taxes withheld</td><td style={{ textAlign: "right" }} className="muted">−{fmtMoney(viewingCheck.employee_taxes)}</td></tr>
                    <tr><td className="muted" style={{ paddingLeft: 20, fontSize: 12.5 }}>Federal Withholding</td><td style={{ textAlign: "right", fontSize: 12.5 }} className="muted">−{fmtMoney(viewingCheck.federal_withholding)}</td></tr>
                    <tr><td className="muted" style={{ paddingLeft: 20, fontSize: 12.5 }}>State Tax</td><td style={{ textAlign: "right", fontSize: 12.5 }} className="muted">−{fmtMoney(viewingCheck.state_tax)}</td></tr>
                    <tr><td className="muted" style={{ paddingLeft: 20, fontSize: 12.5 }}>Social Security (EE)</td><td style={{ textAlign: "right", fontSize: 12.5 }} className="muted">−{fmtMoney(viewingCheck.social_security_ee)}</td></tr>
                    <tr><td className="muted" style={{ paddingLeft: 20, fontSize: 12.5 }}>Medicare (EE)</td><td style={{ textAlign: "right", fontSize: 12.5 }} className="muted">−{fmtMoney(viewingCheck.medicare_ee)}</td></tr>
                    {Number(viewingCheck.total_deductions) > 0 && (
                      <tr><td className="muted">Less other deductions</td><td style={{ textAlign: "right" }} className="muted">−{fmtMoney(viewingCheck.total_deductions)}</td></tr>
                    )}
                    <tr><td style={{ fontWeight: 700 }}>Net pay to employee</td><td style={{ textAlign: "right", fontWeight: 700 }}>{fmtMoney(viewingCheck.net_pay)}</td></tr>
                    <tr><td className="muted">Employer taxes (firm cost, not withheld)</td><td style={{ textAlign: "right" }} className="muted">{fmtMoney(viewingCheck.employer_taxes)}</td></tr>
                    <tr><td className="muted" style={{ paddingLeft: 20, fontSize: 12.5 }}>Social Security (ER)</td><td style={{ textAlign: "right", fontSize: 12.5 }} className="muted">{fmtMoney(viewingCheck.social_security_er)}</td></tr>
                    <tr><td className="muted" style={{ paddingLeft: 20, fontSize: 12.5 }}>Medicare (ER)</td><td style={{ textAlign: "right", fontSize: 12.5 }} className="muted">{fmtMoney(viewingCheck.medicare_er)}</td></tr>
                    <tr><td className="muted" style={{ paddingLeft: 20, fontSize: 12.5 }}>FUTA</td><td style={{ textAlign: "right", fontSize: 12.5 }} className="muted">{fmtMoney(viewingCheck.futa)}</td></tr>
                    <tr><td className="muted" style={{ paddingLeft: 20, fontSize: 12.5 }}>SUTA</td><td style={{ textAlign: "right", fontSize: 12.5 }} className="muted">{fmtMoney(viewingCheck.suta)}</td></tr>
                    <tr><td style={{ fontWeight: 700 }}>Total cost to employer</td><td style={{ textAlign: "right", fontWeight: 700 }}>{fmtMoney(viewingCheck.total_cost)}</td></tr>
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button type="button" className="btn btn-sm" onClick={() => handleView(viewingCheck)}>View Paystub</button>
                <button type="button" className="btn btn-sm" onClick={() => { startEdit(viewingCheck); setViewingCheck(null); }}>Edit</button>
                {isAdmin && (
                  <button type="button" className="btn btn-sm btn-danger" disabled={deleting === viewingCheck.paycheck_id} onClick={() => handleDelete(viewingCheck)}>
                    {deleting === viewingCheck.paycheck_id ? "Deleting…" : "Delete"}
                  </button>
                )}
              </div>
            </div>
          )}
      <div className="scroll-list">
        <div className="table-scroll">
        <table>
          {/* Period/check#/employer-side figures are stacked under their subject —
              as 11 columns this ran past the right edge at 100% zoom. */}
          <thead><tr><th scope="col">Pay Date</th><th scope="col">Employee</th><th scope="col" style={{ textAlign: "right" }}>Gross</th><th scope="col" style={{ textAlign: "right" }}>Net Pay</th><th scope="col">Status</th><th scope="col"></th></tr></thead>
          <tbody>
            {paychecks.map((p) => (
              <tr key={p.paycheck_id} style={{ cursor: "pointer" }} tabIndex={0} role="button" onClick={() => setViewingCheck(p)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setViewingCheck(p); } }}>
                <td>
                  <div>{fmtDate(p.pay_date)}</div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {p.pay_period_start || p.pay_period_end ? `${fmtDate(p.pay_period_start)} – ${fmtDate(p.pay_period_end)}` : "No period"}
                  </div>
                </td>
                <td>
                  <div>{p.employee}</div>
                  <div className="muted" style={{ fontSize: 11 }}>Check #{p.check_number || "—"}</div>
                </td>
                <td style={{ textAlign: "right" }}>
                  <div>{fmtMoney(p.gross_wages)}</div>
                  <div className="muted" style={{ fontSize: 11 }}>−{fmtMoney(p.employee_taxes)} tax</div>
                </td>
                <td style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 600 }}>{fmtMoney(p.net_pay)}</div>
                  <div className="muted" style={{ fontSize: 11 }}>Cost {fmtMoney(p.total_cost)}</div>
                </td>
                <td><StatusBadge status={p.status || "Created"} /></td>
                {/* Row opens the detail card; these do their own thing instead. */}
                <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="btn btn-sm" disabled={viewing === p.paycheck_id} onClick={() => handleView(p)}>
                    {viewing === p.paycheck_id ? "Generating…" : "View"}
                  </button>
                  <button type="button" className="btn btn-sm" disabled={printing === p.paycheck_id} onClick={() => handlePrint(p)}>
                    {printing === p.paycheck_id ? "Generating…" : "Download"}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => startEdit(p)}>Edit</button>
                  {isAdmin && (
                    <button type="button" className="btn btn-sm btn-danger" disabled={deleting === p.paycheck_id} onClick={() => handleDelete(p)}>
                      {deleting === p.paycheck_id ? "Deleting…" : "Delete"}
                    </button>
                  )}
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
  updated_at: string | null;
  updated_by: string | null;
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
  const notify = useNotify();
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
      await notify(err instanceof ApiError ? err.message : "Could not update this item.");
    } finally {
      setSaving(null);
    }
  }

  async function saveNotes(item: MonthEndItem, notes: string) {
    if (notes === (item.notes || "")) return;
    setItems((prev) => prev && prev.map((i) => (i.item_name === item.item_name ? { ...i, notes } : i)));
    try {
      await api.post(`/accounting/month-end/${clientId}/items`, { period, itemName: item.item_name, category: item.category, status: item.status, notes });
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not save this note.");
      load();
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
      {error && <ErrorBanner error={error} style={{ margin: 16 }} />}
      {!items && !error && <div className="spinner-wrap">Loading…</div>}
      {items && (
        <div className="table-scroll">
        <table>
          <thead><tr><th scope="col"></th><th scope="col">Item</th><th scope="col">Category</th><th scope="col">Notes</th><th scope="col">Completed By</th><th scope="col">Completed At</th></tr></thead>
          <tbody>
            {items.map((item) => {
              const isDone = item.status.toLowerCase() === "done";
              return (
                <tr key={item.item_name} style={{ opacity: saving === item.item_name ? 0.6 : 1 }}>
                  <td><input type="checkbox" checked={isDone} disabled={saving === item.item_name} onChange={() => toggleItem(item)} /></td>
                  <td style={{ textDecoration: isDone ? "line-through" : "none" }}>{item.item_name}</td>
                  <td className="muted">{item.category || "—"}</td>
                  <td>
                    <input
                      aria-label={`Notes for ${item.item_name}`}
                      defaultValue={item.notes || ""}
                      key={item.notes || ""}
                      placeholder="Add a note…"
                      style={{ fontSize: 12.5, width: "100%", minWidth: 140 }}
                      onBlur={(e) => saveNotes(item, e.target.value.trim())}
                    />
                  </td>
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
  const notify = useNotify();
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
      await notify(err instanceof ApiError ? err.message : "Could not generate the calibration sheet.");
    } finally {
      setCalibrationBusy(null);
    }
  }

  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setSaved(false);
    setLoadError(null);
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
    }).catch((err) => {
      // A failed load used to silently leave the form at its blank default —
      // indistinguishable from "this client has no check settings yet". Save
      // was still enabled, so clicking it would upsert blanks over whatever
      // calibration was actually on file. Surface the failure and block
      // saving until a reload actually succeeds.
      setLoadError(err instanceof ApiError ? err.message : "Could not load check settings.");
    });
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
      <Panel title="Check Settings" note={settings?.updated_at ? `Last updated ${fmtDate(settings.updated_at)}${settings.updated_by ? ` by ${settings.updated_by}` : ""}` : "No calibration saved yet for this client"}>
        <form onSubmit={handleSubmit} style={{ padding: 16 }}>
          {loadError && <ErrorBanner error={loadError} />}
          {error && <ErrorBanner error={error} />}
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
            <div className="field"><label htmlFor="acct-cst-paper-stock">Paper Stock</label><input id="acct-cst-paper-stock" value={form.paperStock} onChange={(e) => setForm((f) => ({ ...f, paperStock: e.target.value }))} placeholder="e.g. Deluxe 3-per-page" /></div>
          </div>
          {CHECK_SETTING_FIELD_PAIRS.map(([label, xKey, yKey]) => (
            <div key={label} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field"><label>{label} X</label><input type="number" step="0.1" value={form[xKey]} onChange={(e) => setForm((f) => ({ ...f, [xKey]: e.target.value }))} /></div>
              <div className="field"><label>{label} Y</label><input type="number" step="0.1" value={form[yKey]} onChange={(e) => setForm((f) => ({ ...f, [yKey]: e.target.value }))} /></div>
            </div>
          ))}
          <div className="field"><label htmlFor="acct-cst-notes">Notes</label><textarea id="acct-cst-notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          <button type="submit" className="btn btn-primary" disabled={saving || !!loadError} title={loadError ? "Fix the load error above before saving" : undefined}>{saving ? "Saving…" : "Save Check Settings"}</button>
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
  const notify = useNotify();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [data, setData] = useState<{ clientIssues: string[]; employees: YearEndEmployeeRow[]; contractors: YearEndContractorRow[]; mdWithholdingSummary: { total: number; employeeCount: number } } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form941Quarter, setForm941Quarter] = useState(() => String(Math.floor(new Date().getMonth() / 3) + 1));

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
      await notify(err instanceof ApiError ? err.message : "Could not generate this form.");
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
        {error && <ErrorBanner error={error} style={{ margin: 16 }} />}
        {!loading && data && (
          <div style={{ padding: 16 }}>
            {data.clientIssues.length > 0 && (
              <div className="error-banner" style={{ marginBottom: 16 }}>
                {data.clientIssues.map((i) => <div key={i}>{i}</div>)}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" className="btn" disabled={busy !== null} onClick={() => handlePrintForm(`/accounting/tax-forms/w3/${clientId}?year=${year}`, `W3_${year}_${clientId}.pdf`, "w3")}>
                {busy === "w3" ? "Generating…" : "Print W-3 Summary"}
              </button>
              <button type="button" className="btn" disabled={busy !== null} onClick={() => handlePrintForm(`/accounting/tax-forms/1096/${clientId}?year=${year}`, `1096_${year}_${clientId}.pdf`, "1096")}>
                {busy === "1096" ? "Generating…" : "Print 1096 Summary"}
              </button>
              <button type="button" className="btn" disabled={busy !== null} onClick={() => handlePrintForm(`/accounting/tax-forms/940/${clientId}?year=${year}`, `940_${year}_${clientId}.pdf`, "940")} title="Annual FUTA return">
                {busy === "940" ? "Generating…" : "Print Form 940"}
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button type="button" className="btn" disabled={busy !== null} onClick={() => handlePrintForm(`/accounting/tax-forms/941/${clientId}?year=${year}&quarter=${form941Quarter}`, `941_${year}Q${form941Quarter}_${clientId}.pdf`, "941")} title="Quarterly federal tax return">
                  {busy === "941" ? "Generating…" : `Print Form 941 (Q${form941Quarter})`}
                </button>
                <select aria-label="Form 941 quarter" value={form941Quarter} onChange={(e) => setForm941Quarter(e.target.value)} style={{ width: 70 }}>
                  <option value="1">Q1</option>
                  <option value="2">Q2</option>
                  <option value="3">Q3</option>
                  <option value="4">Q4</option>
                </select>
              </div>
            </div>

            <div className="command-panel-header" style={{ padding: 0, marginBottom: 8 }}>
              <h2 className="command-panel-title" style={{ fontSize: 15 }}>W-2 Review ({data.employees.length})</h2>
            </div>
            <div className="scroll-list" style={{ marginBottom: 20 }}>
              <div className="table-scroll">
              <table>
                <thead><tr><th scope="col">Employee</th><th scope="col">SSN</th><th scope="col">Wages</th><th scope="col">Fed Tax</th><th scope="col">MD Tax</th><th scope="col">Status</th><th scope="col">Review Issues</th><th scope="col"></th></tr></thead>
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
                        <button type="button" className="btn btn-sm" disabled={busy !== null || e.status !== "Ready"} title={e.status !== "Ready" ? "Resolve the review issues listed for this employee before printing their W-2." : undefined} onClick={() => handlePrintForm(`/accounting/tax-forms/w2/${e.employeeId}?year=${year}`, `W2_${year}_${e.employeeName.replace(/\s+/g, "_")}.pdf`, e.employeeId)}>
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
                <thead><tr><th scope="col">Contractor</th><th scope="col">TIN</th><th scope="col">NEC (Box 1a)</th><th scope="col">Status</th><th scope="col">Review Issues</th><th scope="col"></th></tr></thead>
                <tbody>
                  {data.contractors.map((c) => (
                    <tr key={c.contractorId}>
                      <td>{c.contractorName}</td>
                      <td className="muted">{c.tinOnFile ? "On file" : "Missing"}</td>
                      <td>{fmtMoney(c.nec)}</td>
                      <td><StatusBadge status={c.status} /></td>
                      <td className="muted" style={{ fontSize: 11 }}>{c.issues.length > 0 ? c.issues.join("; ") : "—"}</td>
                      <td>
                        <button type="button" className="btn btn-sm" disabled={busy !== null || c.status !== "Ready"} title={c.status !== "Ready" ? "Resolve the review issues listed for this contractor before printing their 1099-NEC." : undefined} onClick={() => handlePrintForm(`/accounting/tax-forms/1099nec/${c.contractorId}?year=${year}`, `1099NEC_${year}_${c.contractorName.replace(/\s+/g, "_")}.pdf`, c.contractorId)}>
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

const TAX_RATE_FORM_DEFAULTS = { rowId: "", rateId: "", rateType: "", rate: "", scope: "Global", clientId: "", employeeEmployer: "", wageCap: "", state: "", notes: "", active: true };

function TaxRatesTab() {
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [rates, setRates] = useState<TaxRate[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(TAX_RATE_FORM_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rateSearch, setRateSearch] = useState("");
  const [showInactiveRates, setShowInactiveRates] = useState(false);

  function load() {
    api.get<{ taxRates: TaxRate[] }>("/accounting/tax-rates").then((r) => setRates(r.taxRates)).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load tax rates."));
  }
  useEffect(load, []);

  const visibleRates = useMemo<TaxRate[]>(() => {
    if (!rates) return [];
    const q = rateSearch.trim().toLowerCase();
    return rates.filter((r) => {
      if (!showInactiveRates && !r.active) return false;
      if (!q) return true;
      return [r.rate_id, r.rate_type, r.state, r.client_name, r.notes, r.employee_employer]
        .some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [rates, rateSearch, showInactiveRates]);
  useEffect(() => {
    api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients))
      // Previously silent — a failed load left the Client dropdown (required
      // for a Client-scoped rate) permanently empty with no indication why.
      .catch((e) => notify(e instanceof ApiError ? e.message : "Could not load the client list — the Client dropdown below will be empty."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startCreate() {
    setForm(TAX_RATE_FORM_DEFAULTS);
    setShowForm(true);
    setSaveError(null);
  }
  function startEdit(r: TaxRate) {
    setForm({
      rowId: String(r.tax_rate_row_id || ""),
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
    const ok = await confirmDialog({ title: "Deactivate tax rate", message: "Deactivate this tax rate?" });
    if (!ok) return;
    await api.post(`/accounting/tax-rates/${rowId}/deactivate`, {}).catch((e) => notify(e.message));
    load();
  }
  async function handleActivate(rowId: string) {
    await api.post(`/accounting/tax-rates/${rowId}/activate`, {}).catch((e) => notify(e.message));
    load();
  }

  return (
    <div>
      {isAdmin && (
        <button className="btn btn-primary" style={{ marginBottom: 16 }} onClick={() => (showForm ? setShowForm(false) : startCreate())}>{showForm ? "Cancel" : "New Rate"}</button>
      )}
      {error && <ErrorBanner error={error} />}
      {showForm && isAdmin && (
        <form onSubmit={handleSave} className="card" style={{ maxWidth: 420, marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>{form.rateId ? `Edit ${form.rateId}` : "New Rate"}</h2>
          {saveError && <ErrorBanner error={saveError} />}
          <div className="field"><label htmlFor="acct-se-rate-type">Rate Type</label><input id="acct-se-rate-type" required value={form.rateType} onChange={(e) => setForm((f) => ({ ...f, rateType: e.target.value }))} placeholder="e.g. Sales Tax 6" /></div>
          <div className="field"><label htmlFor="acct-se-rate">Rate (decimal, e.g. 0.06 = 6%)</label><input id="acct-se-rate" type="number" step="0.0001" required value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} /></div>
          <div className="field"><label htmlFor="acct-se-scope">Scope</label><select id="acct-se-scope" value={form.scope} onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value, clientId: e.target.value === "Global" ? "" : f.clientId }))}><option>Global</option><option>Client</option></select></div>
          {form.scope === "Client" && (
            <div className="field">
              <label>Client</label>
              <select required value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}>
                <option value="">Choose a client…</option>
                {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
              </select>
            </div>
          )}
          <div className="field"><label htmlFor="acct-se-employee-employer">Side</label><select id="acct-se-employee-employer" value={form.employeeEmployer} onChange={(e) => setForm((f) => ({ ...f, employeeEmployer: e.target.value }))}><option value="">—</option><option value="Employee">Employee</option><option value="Employer">Employer</option><option value="Both">Both</option></select></div>
          <div className="field"><label htmlFor="acct-se-wage-cap">Wage Cap</label><input id="acct-se-wage-cap" type="number" step="0.01" value={form.wageCap} onChange={(e) => setForm((f) => ({ ...f, wageCap: e.target.value }))} /></div>
          <div className="field">
            <label>State</label>
            <select value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}>
              <option value="">Select…</option>
              {/* US = federal-level rates (FUTA, Social Security, Medicare), which
                  aren't tied to any one state — kept as an explicit option since
                  several seeded rates already use it. */}
              <option value="US">US (federal)</option>
              {US_STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="acct-se-notes-3">Notes</label><textarea id="acct-se-notes-3" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </form>
      )}
      {rates && (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <input placeholder="Search rate, type, state…" value={rateSearch} onChange={(e) => setRateSearch(e.target.value)} style={{ maxWidth: 240 }} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
              <input type="checkbox" checked={showInactiveRates} onChange={(e) => setShowInactiveRates(e.target.checked)} />
              Show inactive
            </label>
            <div className="muted" style={{ fontSize: 12 }}>{visibleRates.length} of {rates.length} rates</div>
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {/* Was 11 separate columns, which ran off the right edge at 100% zoom
                once the client panel is open. Related facts are now stacked in one
                cell each, so the whole table fits without scrolling sideways. */}
            <div className="table-scroll">
            <table>
              <thead><tr><th scope="col">Rate</th><th scope="col">Applies To</th><th scope="col" style={{ textAlign: "right" }}>Rate</th><th scope="col">Payroll Side</th>{isAdmin && <th scope="col"></th>}</tr></thead>
              <tbody>
                {visibleRates.map((r) => (
                  <tr key={r.tax_rate_row_id || r.rate_id} style={r.active ? undefined : { opacity: 0.55 }}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.rate_type}</div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {r.rate_id}
                        {!r.active && " · Inactive"}
                      </div>
                      {r.notes && <div className="muted" style={{ fontSize: 11 }}>{r.notes}</div>}
                    </td>
                    <td>
                      <div>{r.state === "US" ? "US (federal)" : r.state || "Any state"}</div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {r.scope === "Client" ? (r.client_name || "One client") : "All clients"}
                      </div>
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{(Number(r.rate) * 100).toFixed(2)}%</td>
                    <td>
                      <div>{r.employee_employer || "—"}</div>
                      {r.wage_cap != null && r.wage_cap !== "" && (
                        <div className="muted" style={{ fontSize: 11 }}>Cap {fmtMoney(r.wage_cap)}</div>
                      )}
                    </td>
                    {isAdmin && (
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className="btn btn-sm" onClick={() => startEdit(r)}>Edit</button>{" "}
                        {r.active
                          ? <button className="btn btn-sm" onClick={() => handleDeactivate(String(r.tax_rate_row_id))}>Deactivate</button>
                          : <button className="btn btn-sm" onClick={() => handleActivate(String(r.tax_rate_row_id))}>Activate</button>}
                      </td>
                    )}
                  </tr>
                ))}
                {visibleRates.length === 0 && (
                  <tr><td colSpan={isAdmin ? 5 : 4} className="muted" style={{ textAlign: "center", padding: 20 }}>No rates match that search.</td></tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}

      <SalesCategoriesSection />
    </div>
  );
}

interface SalesTaxCategoryRow {
  category_id: string; category_name: string; state: string | null; default_rate_id: string | null;
  rate_percent: number | string | null; filing_box_label: string | null; display_order: number; active: boolean; notes: string | null;
}

const CATEGORY_FORM_DEFAULTS = {
  categoryId: "", categoryName: "", state: "", ratePercent: "", filingBoxLabel: "", displayOrder: "100", notes: "", active: true,
};

/**
 * Sales Tax Categories — what Sales Input actually shows to pick from. This used
 * to require staff to first create a separate Tax Rate (picked from a 30-row list
 * mixed in with FUTA/SUTA/Medicare/withholding rates that have nothing to do with
 * sales tax) and then link it here by ID — flagged directly by the user as
 * confusing. Now the rate is just a plain "6" (for 6%) typed straight into this
 * one form; the backend auto-creates/updates a dedicated 1:1 tax rate behind the
 * scenes (category_id doubles as its rate_id), so there's exactly one thing to
 * fill out and nothing to look up. Tax Rates above stays as-is for payroll/
 * withholding rates, which this doesn't touch.
 */
function SalesCategoriesSection() {
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [categories, setCategories] = useState<SalesTaxCategoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(CATEGORY_FORM_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function load() {
    api.get<{ categories: SalesTaxCategoryRow[] }>("/accounting/sales-categories/all")
      .then((r) => setCategories(r.categories))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load sales tax categories."));
  }
  useEffect(load, []);

  function startCreate() {
    setForm(CATEGORY_FORM_DEFAULTS);
    setShowForm(true);
    setSaveError(null);
  }
  function startEdit(c: SalesTaxCategoryRow) {
    setForm({
      categoryId: c.category_id, categoryName: c.category_name, state: c.state || "",
      ratePercent: c.rate_percent != null ? String(Number(c.rate_percent) * 100) : "",
      filingBoxLabel: c.filing_box_label || "",
      displayOrder: String(c.display_order ?? 100), notes: c.notes || "", active: c.active,
    });
    setShowForm(true);
    setSaveError(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await api.post("/accounting/sales-categories", { ...form, ratePercent: Number(form.ratePercent), displayOrder: Number(form.displayOrder) || 100 });
      setShowForm(false);
      setForm(CATEGORY_FORM_DEFAULTS);
      load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save this category.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(categoryId: string) {
    const ok = await confirmDialog({ title: "Deactivate category", message: "It will stop appearing in Sales Input." });
    if (!ok) return;
    await api.post(`/accounting/sales-categories/${categoryId}/deactivate`, {}).catch((e) => notify(e.message));
    load();
  }
  async function handleActivate(categoryId: string) {
    await api.post(`/accounting/sales-categories/${categoryId}/activate`, {}).catch((e) => notify(e.message));
    load();
  }
  async function handleDelete(categoryId: string, categoryName: string) {
    const ok = await confirmDialog({ title: "Permanently delete category", message: `"${categoryName}" — this cannot be undone.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.post(`/accounting/sales-categories/${categoryId}/delete`, {});
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this category.");
    }
  }

  return (
    <div style={{ marginTop: 32 }}>
      <div className="command-panel-header" style={{ padding: 0, marginBottom: 12 }}>
        <div>
          <h2 className="command-panel-title" style={{ fontSize: 15 }}>Sales Tax Categories</h2>
          <p className="muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
            This is what shows up on Sales Input — name it, set the rate, done. (Tax Rates above is for payroll/withholding rates only.)
          </p>
        </div>
        {isAdmin && (
          <button type="button" className="btn btn-primary" onClick={() => (showForm ? setShowForm(false) : startCreate())}>{showForm ? "Cancel" : "New Category"}</button>
        )}
      </div>
      {error && <ErrorBanner error={error} />}
      {showForm && isAdmin && (
        <form onSubmit={handleSave} className="card" style={{ maxWidth: 420, marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>{form.categoryId ? `Edit ${form.categoryName}` : "New Category"}</h2>
          {saveError && <ErrorBanner error={saveError} />}
          <div className="field"><label htmlFor="acct-se-category-name">Category Name</label><input id="acct-se-category-name" required value={form.categoryName} onChange={(e) => setForm((f) => ({ ...f, categoryName: e.target.value }))} placeholder="e.g. Prepared Food" /></div>
          <div className="field"><label htmlFor="acct-se-rate-percent">Tax Rate (%)</label><input id="acct-se-rate-percent" required type="number" step="0.01" min="0" value={form.ratePercent} onChange={(e) => setForm((f) => ({ ...f, ratePercent: e.target.value }))} placeholder="e.g. 6 for 6%" /></div>
          <div className="field">
            <label>State <span className="muted">(blank = any state)</span></label>
            <select value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}>
              <option value="">Any state</option>
              {US_STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="acct-se-filing-box-label">Filing Box Label <span className="muted">(optional)</span></label><input id="acct-se-filing-box-label" value={form.filingBoxLabel} onChange={(e) => setForm((f) => ({ ...f, filingBoxLabel: e.target.value }))} /></div>
          <div className="field"><label htmlFor="acct-se-display-order">Display Order</label><input id="acct-se-display-order" type="number" value={form.displayOrder} onChange={(e) => setForm((f) => ({ ...f, displayOrder: e.target.value }))} /></div>
          <div className="field"><label htmlFor="acct-se-notes-4">Notes</label><textarea id="acct-se-notes-4" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </form>
      )}
      {categories && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <div className="table-scroll">
            <table>
              <thead><tr><th scope="col">Category</th><th scope="col">State</th><th scope="col">Rate</th><th scope="col">Order</th><th scope="col">Active</th>{isAdmin && <th scope="col"></th>}</tr></thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.category_id}>
                    <td>{c.category_name}</td>
                    <td className="muted">{c.state || "Any"}</td>
                    <td>{c.rate_percent != null ? `${(Number(c.rate_percent) * 100).toFixed(2)}%` : "—"}</td>
                    <td className="muted">{c.display_order}</td>
                    <td>{c.active ? "Yes" : "No"}</td>
                    {isAdmin && (
                      <td style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-sm" onClick={() => startEdit(c)}>Edit</button>
                        {c.active ? <button className="btn btn-sm" onClick={() => handleDeactivate(c.category_id)}>Deactivate</button> : <button className="btn btn-sm" onClick={() => handleActivate(c.category_id)}>Activate</button>}
                        <button className="btn btn-sm btn-danger" onClick={() => handleDelete(c.category_id, c.category_name)}>Delete</button>
                      </td>
                    )}
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

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface BudgetAccountRow { accountName: string; accountType: string }
interface BudgetEntry { accountName: string; month: number; amount: number }
interface BudgetData { year: number; accounts: BudgetAccountRow[]; budgets: BudgetEntry[]; actuals: BudgetEntry[] }

/**
 * Budget vs. actual — a spreadsheet-style entry grid (accounts × 12 months) plus,
 * toggled by View, the same data read back as budget/actual/variance so the two
 * live on one tab rather than splitting entry and reporting across pages. Every
 * Income/COGS/Expense account in the chart of accounts gets a row automatically —
 * budgeting a balance-sheet account (Cash, Accounts Payable) isn't meaningful the
 * way a P&L account is, so those types are excluded server-side.
 */
function BudgetTab({ clientId }: { clientId: string }) {
  const notify = useNotify();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<BudgetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grid, setGrid] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<"Entry" | "Variance">("Entry");

  function key(accountName: string, month: number) {
    return `${accountName}::${month}`;
  }

  function load() {
    setError(null);
    api.get<BudgetData>(`/budgets/${clientId}?year=${year}`)
      .then((res) => {
        setData(res);
        const g: Record<string, string> = {};
        for (const b of res.budgets) g[key(b.accountName, b.month)] = String(b.amount);
        setGrid(g);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the budget."));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [clientId, year]);

  async function handleSave() {
    if (!data) return;
    setSaving(true);
    try {
      const entries = data.accounts.flatMap((a) =>
        MONTH_LABELS.map((_, i) => ({ accountName: a.accountName, month: i + 1, amount: Number(grid[key(a.accountName, i + 1)]) || 0 }))
      );
      await api.post(`/budgets/${clientId}`, { year, entries });
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not save the budget.");
    } finally {
      setSaving(false);
    }
  }

  const actualsByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of data?.actuals || []) map.set(key(a.accountName, a.month), a.amount);
    return map;
  }, [data]);

  if (error) return <ErrorBanner error={error} />;
  if (!data) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div>
      <div className="card" style={{ padding: 12, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div className="field" style={{ margin: 0, maxWidth: 100 }}>
            <label>Year</label>
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["Entry", "Variance"] as const).map((v) => (
              <button key={v} className={`btn btn-sm ${view === v ? "btn-primary" : ""}`} onClick={() => setView(v)}>{v}</button>
            ))}
          </div>
        </div>
        {view === "Entry" && isAdmin && <button className="btn btn-primary btn-sm" disabled={saving} onClick={handleSave}>{saving ? "Saving…" : "Save Budget"}</button>}
      </div>

      {!data.accounts.length && <p className="muted">No Income/COGS/Expense accounts in the chart of accounts yet — add some on the COA tab first.</p>}

      {data.accounts.length > 0 && view === "Entry" && (
        <div className="card table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Account</th>
                {MONTH_LABELS.map((m) => <th scope="col" key={m} style={{ textAlign: "right" }}>{m}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.accountName}>
                  <td>{a.accountName}<div className="muted" style={{ fontSize: 11 }}>{a.accountType}</div></td>
                  {MONTH_LABELS.map((_, i) => (
                    <td key={i} style={{ padding: 2 }}>
                      <input
                        type="number" step="0.01"
                        disabled={!isAdmin}
                        style={{ width: 80, textAlign: "right", padding: "4px 6px" }}
                        value={grid[key(a.accountName, i + 1)] ?? ""}
                        onChange={(e) => setGrid((prev) => ({ ...prev, [key(a.accountName, i + 1)]: e.target.value }))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.accounts.length > 0 && view === "Variance" && (
        <div className="card table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Account</th>
                {MONTH_LABELS.map((m) => <th scope="col" key={m} style={{ textAlign: "right" }}>{m}</th>)}
                <th scope="col" style={{ textAlign: "right" }}>Year Total</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => {
                // For Income, exceeding the target is favorable (teal); for
                // COGS/Expense, exceeding the target is unfavorable (red) — the
                // same +/- variance number means the opposite thing depending
                // on account type, so the color has to follow accountType, not
                // just the sign of the variance.
                const isIncome = a.accountType === "Income";
                let yearBudget = 0, yearActual = 0;
                return (
                  <tr key={a.accountName}>
                    <td>{a.accountName}</td>
                    {MONTH_LABELS.map((_, i) => {
                      const budget = Number(grid[key(a.accountName, i + 1)]) || 0;
                      const actual = actualsByKey.get(key(a.accountName, i + 1)) || 0;
                      yearBudget += budget; yearActual += actual;
                      const variance = actual - budget;
                      const pct = budget !== 0 ? (variance / budget) * 100 : actual !== 0 ? 100 : 0;
                      const favorable = isIncome ? variance >= 0 : variance <= 0;
                      return (
                        <td key={i} style={{ textAlign: "right", fontSize: 11 }}>
                          {budget === 0 && actual === 0 ? <span className="muted">—</span> : (
                            <>
                              <div>{fmtMoney(actual)}</div>
                              <div style={{ color: variance === 0 ? undefined : favorable ? "var(--teal)" : "var(--red)" }}>
                                {variance >= 0 ? "+" : ""}{fmtMoney(variance)} ({pct >= 0 ? "+" : ""}{pct.toFixed(0)}%)
                              </div>
                            </>
                          )}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: "right", fontWeight: 700 }}>
                      <div>{fmtMoney(yearActual)}</div>
                      <div className="muted" style={{ fontSize: 11 }}>vs {fmtMoney(yearBudget)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 11, padding: "8px 12px" }}>Teal = favorable variance (more income or less expense than budgeted). Red = unfavorable.</p>
        </div>
      )}
    </div>
  );
}

interface BankLine { line_id: string; statement_date: string; description: string | null; amount: number; matched_gl_entry_id: string | null; matched_gl_description: string | null; matched_gl_date: string | null; je_draft_id: string | null; je_draft_status: string | null }
interface GlCandidate { gl_entry_id: string; entry_date: string; description: string | null; ref: string | null; amount: number }
interface BankRecData { bankLines: BankLine[]; glCandidates: GlCandidate[]; bookBalance: number; clearedBalance: number }
interface JeDraft { je_draft_id: string; bank_line_id: string; statement_date: string; description: string | null; amount: number; suggested_account: string | null; matched_rule_text: string | null }
interface ReadyToReconcileRow { draftId: string; bankLineId: string; glEntryId: string; amount: number; description: string | null; jeRef: string }
interface JeRule { rule_id: string; match_text: string; account_name: string; active: boolean }

/**
 * Manual bank reconciliation — upload the bank's own CSV/Excel statement export,
 * then match each line to an existing GL entry (or, for a transaction nothing was
 * ever recorded for — a bank fee, say — create the missing GL entry directly from
 * the bank line). Two-column layout: unmatched bank lines on the left, unmatched
 * GL entries for the same account on the right; select one of each and Match.
 */
function BankRecTab({ clientId }: { clientId: string }) {
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const promptFor = usePrompt();
  const [accounts, setAccounts] = useState<CoaAccount[] | null>(null);
  const [accountName, setAccountName] = useState("");
  const [data, setData] = useState<BankRecData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedBankLine, setSelectedBankLine] = useState<string | null>(null);
  const [selectedGl, setSelectedGl] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [offsetAccount, setOffsetAccount] = useState("");
  const [autoMatching, setAutoMatching] = useState(false);
  const [showMatched, setShowMatched] = useState(false);
  // Book Balance and Cleared Balance are both scoped to this same cutoff —
  // reconcile "as of" a real bank statement date, same as reconciling
  // against a paper statement. Defaults to today.
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));

  // Bank Rec Agent: Stage 1 (draft review) and Stage 2 (reconcile confirmation).
  const [drafts, setDrafts] = useState<JeDraft[] | null>(null);
  const [readyToReconcile, setReadyToReconcile] = useState<ReadyToReconcileRow[] | null>(null);
  const [rules, setRules] = useState<JeRule[] | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [draftAccountEdits, setDraftAccountEdits] = useState<Record<string, string>>({});
  const [rememberRuleFor, setRememberRuleFor] = useState<string | null>(null);
  const [ruleMatchTextEdits, setRuleMatchTextEdits] = useState<Record<string, string>>({});
  const [selectedDrafts, setSelectedDrafts] = useState<Set<string>>(new Set());
  const [approvingDraft, setApprovingDraft] = useState<string | null>(null);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [dismissingDraft, setDismissingDraft] = useState<string | null>(null);
  const [confirmingMatch, setConfirmingMatch] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [newRule, setNewRule] = useState({ matchText: "", accountName: "" });
  const [savingRule, setSavingRule] = useState(false);

  useEffect(() => {
    api.get<{ accounts: CoaAccount[] }>("/accounting/coa")
      .then((r) => {
        const assets = r.accounts.filter((a) => a.account_type === "Asset" && a.active);
        setAccounts(r.accounts);
        if (!accountName && assets.length) setAccountName(assets[0].account_name);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function load() {
    if (!accountName) return;
    setError(null);
    const qs = new URLSearchParams({ accountName });
    if (asOf) qs.set("asOf", asOf);
    api.get<BankRecData>(`/bank-rec/${clientId}?${qs.toString()}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load bank reconciliation."));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [clientId, accountName, asOf]);

  function loadDrafts() {
    if (!accountName) return;
    api.get<{ drafts: JeDraft[] }>(`/bank-rec/${clientId}/je-drafts?status=Pending&accountName=${encodeURIComponent(accountName)}`)
      .then((r) => setDrafts(r.drafts))
      .catch(() => setDrafts([]));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadDrafts, [clientId, accountName]);

  function loadReadyToReconcile() {
    if (!accountName) return;
    api.get<{ ready: ReadyToReconcileRow[] }>(`/bank-rec/${clientId}/ready-to-reconcile?accountName=${encodeURIComponent(accountName)}`)
      .then((r) => setReadyToReconcile(r.ready))
      .catch(() => setReadyToReconcile([]));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadReadyToReconcile, [clientId, accountName]);

  function loadRules() {
    api.get<{ rules: JeRule[] }>(`/bank-rec/${clientId}/je-rules`)
      .then((r) => setRules(r.rules))
      .catch(() => setRules([]));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadRules, [clientId]);

  async function handleUpload() {
    if (!file || !accountName) return;
    setUploading(true); setError(null);
    try {
      const fileBase64 = await fileToBase64(file);
      const res = await api.post<{ inserted: number; skippedDuplicates: number }>("/bank-rec/upload", { clientId, accountName, fileBase64 });
      setFile(null);
      load();
      loadDrafts();
      const dupeNote = res.skippedDuplicates ? ` ${res.skippedDuplicates} line(s) matched an existing entry and were skipped.` : "";
      await notify(`Imported ${res.inserted} statement line(s) — review the suggested journal entries below before approving.${dupeNote}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not read this statement file.");
    } finally {
      setUploading(false);
    }
  }

  async function handleApproveDraft(draftId: string) {
    setApprovingDraft(draftId);
    try {
      const overrideAccount = draftAccountEdits[draftId];
      const remember = rememberRuleFor === draftId;
      await api.post(`/bank-rec/je-drafts/${draftId}/approve`, {
        overrides: overrideAccount ? { account: overrideAccount } : undefined,
        rememberAsRule: remember,
        ruleMatchText: remember ? ruleMatchTextEdits[draftId] : undefined,
      });
      setRememberRuleFor(null);
      loadDrafts(); loadReadyToReconcile(); load(); if (remember) loadRules();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not approve this draft.");
    } finally {
      setApprovingDraft(null);
    }
  }

  async function handleBulkApproveDrafts() {
    if (!selectedDrafts.size) return;
    setBulkApproving(true);
    try {
      const res = await api.post<{ results: { draftId: string; ok: boolean; error?: string }[] }>(
        "/bank-rec/je-drafts/approve-bulk", { draftIds: Array.from(selectedDrafts) }
      );
      const failed = res.results.filter((r) => !r.ok);
      setSelectedDrafts(new Set());
      loadDrafts(); loadReadyToReconcile(); load();
      if (failed.length) await notify(`${res.results.length - failed.length} approved. ${failed.length} could not be approved: ${failed.map((f) => f.error).join("; ")}`);
      else await notify(`Approved ${res.results.length} draft(s).`);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not approve the selected drafts.");
    } finally {
      setBulkApproving(false);
    }
  }

  async function handleDismissDraft(draftId: string) {
    const reason = await promptFor({ title: "Dismiss suggested entry", message: "Why doesn't this need a journal entry? (optional)" });
    if (reason === null) return;
    setDismissingDraft(draftId);
    try {
      await api.post(`/bank-rec/je-drafts/${draftId}/dismiss`, { reason });
      loadDrafts(); load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not dismiss this draft.");
    } finally {
      setDismissingDraft(null);
    }
  }

  async function handleConfirmReconcile(row: ReadyToReconcileRow) {
    setConfirmingMatch(row.draftId);
    try {
      await api.post(`/bank-rec/${row.bankLineId}/match`, { glEntryId: row.glEntryId });
      loadReadyToReconcile(); load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not confirm this reconciliation.");
    } finally {
      setConfirmingMatch(null);
    }
  }

  async function handleConfirmAllReconcile() {
    if (!readyToReconcile?.length) return;
    setConfirmingAll(true);
    try {
      for (const row of readyToReconcile) {
        await api.post(`/bank-rec/${row.bankLineId}/match`, { glEntryId: row.glEntryId }).catch(() => {});
      }
      loadReadyToReconcile(); load();
    } finally {
      setConfirmingAll(false);
    }
  }

  async function handleAddRule() {
    if (!newRule.matchText.trim() || !newRule.accountName) return;
    setSavingRule(true);
    try {
      await api.post("/bank-rec/je-rules", { clientId, matchText: newRule.matchText.trim(), accountName: newRule.accountName });
      setNewRule({ matchText: "", accountName: "" });
      loadRules();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not save this rule.");
    } finally {
      setSavingRule(false);
    }
  }

  async function handleToggleRule(rule: JeRule) {
    try {
      await api.post(`/bank-rec/je-rules/${rule.rule_id}`, { active: !rule.active });
      loadRules();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not update this rule.");
    }
  }

  async function handleMatch() {
    if (!selectedBankLine || !selectedGl) return;
    setMatching(true);
    try {
      await api.post(`/bank-rec/${selectedBankLine}/match`, { glEntryId: selectedGl });
      setSelectedBankLine(null); setSelectedGl(null);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not match these.");
    } finally {
      setMatching(false);
    }
  }

  async function handleCreateEntry(lineId: string) {
    if (!offsetAccount) return;
    setMatching(true);
    try {
      await api.post(`/bank-rec/${lineId}/create-entry`, { offsetAccount });
      setCreatingFor(null); setOffsetAccount("");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not create this entry.");
    } finally {
      setMatching(false);
    }
  }

  async function handleAutoMatch() {
    if (!accountName) return;
    setAutoMatching(true);
    try {
      const res = await api.post<{ matched: number; remaining: number }>(
        `/bank-rec/${clientId}/auto-match?accountName=${encodeURIComponent(accountName)}`, {}
      );
      load();
      await notify(res.matched
        ? `Auto-matched ${res.matched} line(s) by exact amount + nearest date. ${res.remaining} line(s) still need a manual look.`
        : "No exact amount matches were found — everything unmatched needs a manual look.");
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not auto-match.");
    } finally {
      setAutoMatching(false);
    }
  }

  async function handleDeleteLine(lineId: string) {
    const ok = await confirmDialog({ title: "Delete bank statement line", message: "If it's matched, the GL entry stays — it just becomes unmatched again.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.post(`/bank-rec/${lineId}/delete`, {});
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this line.");
    }
  }

  // Undoing a mis-click used to mean deleting the whole bank statement line —
  // permanently destroying the record of that transaction instead of just
  // reversing the match. Unmatch (the backend route already existed) puts
  // both sides back in their respective unmatched lists with nothing lost.
  async function handleUnmatch(lineId: string) {
    const ok = await confirmDialog({ title: "Unmatch", message: "This bank line and its matched GL entry both go back to Unmatched." });
    if (!ok) return;
    try {
      await api.post(`/bank-rec/${lineId}/unmatch`, {});
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not unmatch this line.");
    }
  }

  const assetAccounts = (accounts || []).filter((a) => a.account_type === "Asset" && a.active);
  const nonBankAccounts = (accounts || []).filter((a) => a.active);
  const difference = data ? Math.round((data.bookBalance - data.clearedBalance) * 100) / 100 : 0;
  const unmatchedBank = data ? data.bankLines.filter((b) => !b.matched_gl_entry_id) : [];
  const unmatchedGl = data ? data.glCandidates : [];
  const unmatchedBankTotal = unmatchedBank.reduce((s, b) => s + b.amount, 0);
  const unmatchedGlTotal = unmatchedGl.reduce((s, g) => s + g.amount, 0);

  return (
    <div>
      <div className="card" style={{ padding: 12, marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field" style={{ margin: 0, minWidth: 220 }}>
          <label>Bank / Cash Account</label>
          <select value={accountName} onChange={(e) => setAccountName(e.target.value)}>
            {assetAccounts.map((a) => <option key={a.account_id} value={a.account_name}>{a.account_name}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="acct-bankrec-as-of">Reconcile As Of</label>
          <input id="acct-bankrec-as-of" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <FileDropInput file={file} onChange={setFile} accept=".csv,.xls,.xlsx,.pdf" hint="your bank's own statement export (.csv/.xls/.xlsx/.pdf)" />
        </div>
        <button className="btn btn-primary" disabled={!file || uploading} onClick={handleUpload}>{uploading ? "Uploading…" : "Upload Statement"}</button>
        <button className="btn" disabled={!data?.bankLines.some((b) => !b.matched_gl_entry_id) || autoMatching} onClick={handleAutoMatch} title="Matches by exact amount + nearest date, within 10 days — not a guess.">
          {autoMatching ? "Auto-Matching…" : "Auto-Match"}
        </button>
      </div>

      {error && <ErrorBanner error={error} />}

      {!!drafts?.length && (
        <div className="card" style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <strong style={{ fontSize: 13 }}>Suggested Journal Entries ({drafts.length})</strong>
            <button className="btn btn-sm btn-primary" disabled={!selectedDrafts.size || bulkApproving} onClick={handleBulkApproveDrafts}>
              {bulkApproving ? "Approving…" : `Approve Selected (${selectedDrafts.size})`}
            </button>
          </div>
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            {drafts.map((d) => {
              const account = draftAccountEdits[d.je_draft_id] ?? d.suggested_account ?? "";
              return (
                <div key={d.je_draft_id} style={{ padding: "8px 14px", borderBottom: "1px solid var(--line)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <input type="checkbox" style={{ marginTop: 4 }} checked={selectedDrafts.has(d.je_draft_id)}
                        onChange={(e) => setSelectedDrafts((s) => { const next = new Set(s); if (e.target.checked) next.add(d.je_draft_id); else next.delete(d.je_draft_id); return next; })} />
                      <div>
                        <div style={{ fontSize: 13 }}>{d.description || "—"}</div>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {fmtDate(d.statement_date)}{d.matched_rule_text ? ` · suggested from rule "${d.matched_rule_text}"` : d.suggested_account ? "" : " · no rule matched — pick a category"}
                        </div>
                      </div>
                    </div>
                    <span style={{ fontWeight: 700 }}>{fmtMoney(d.amount)}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                    <select style={{ minWidth: 200 }} value={account} onChange={(e) => setDraftAccountEdits((m) => ({ ...m, [d.je_draft_id]: e.target.value }))}>
                      <option value="">Category…</option>
                      {nonBankAccounts.map((a) => <option key={a.account_id} value={a.account_name}>{a.account_name}</option>)}
                    </select>
                    <button className="btn btn-sm btn-primary" disabled={!account || approvingDraft === d.je_draft_id} onClick={() => handleApproveDraft(d.je_draft_id)}>
                      {approvingDraft === d.je_draft_id ? "Approving…" : "Approve"}
                    </button>
                    <button className="btn btn-sm" disabled={dismissingDraft === d.je_draft_id} onClick={() => handleDismissDraft(d.je_draft_id)}>Dismiss</button>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                      <input type="checkbox" checked={rememberRuleFor === d.je_draft_id}
                        onChange={(e) => setRememberRuleFor(e.target.checked ? d.je_draft_id : null)} />
                      Remember this categorization
                    </label>
                    {rememberRuleFor === d.je_draft_id && (
                      <input placeholder="Match text (e.g. a vendor name)" style={{ minWidth: 160 }}
                        value={ruleMatchTextEdits[d.je_draft_id] ?? d.description ?? ""}
                        onChange={(e) => setRuleMatchTextEdits((m) => ({ ...m, [d.je_draft_id]: e.target.value }))} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!!readyToReconcile?.length && (
        <div className="card" style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <strong style={{ fontSize: 13 }}>Ready to Reconcile ({readyToReconcile.length})</strong>
            <button className="btn btn-sm btn-primary" disabled={confirmingAll} onClick={handleConfirmAllReconcile}>{confirmingAll ? "Confirming…" : "Confirm All"}</button>
          </div>
          <p className="muted" style={{ fontSize: 12, padding: "6px 14px 0" }}>These journal entries were approved and posted — confirm each one clears against the bank line it came from.</p>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {readyToReconcile.map((r) => (
              <div key={r.draftId} style={{ padding: "8px 14px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13 }}>{r.description || "—"}</div>
                  <div className="muted" style={{ fontSize: 11 }}>Journal entry {r.jeRef}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 700 }}>{fmtMoney(r.amount)}</span>
                  <button className="btn btn-sm btn-primary" disabled={confirmingMatch === r.draftId} onClick={() => handleConfirmReconcile(r)}>
                    {confirmingMatch === r.draftId ? "Confirming…" : "Confirm Match"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
        <div
          style={{ padding: "10px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
          onClick={() => setShowRules((v) => !v)}
          tabIndex={0}
          role="button"
          aria-expanded={showRules}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowRules((v) => !v); } }}
        >
          <span>Categorization Rules ({(rules || []).filter((r) => r.active).length} active)</span>
          <span className="muted" aria-hidden="true">{showRules ? "▾" : "▸"}</span>
        </div>
        {showRules && (
          <div style={{ borderTop: "1px solid var(--line)" }}>
            <div style={{ padding: "8px 14px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid var(--line)" }}>
              <input placeholder="If description contains…" style={{ minWidth: 160 }} value={newRule.matchText} onChange={(e) => setNewRule((f) => ({ ...f, matchText: e.target.value }))} />
              <span className="muted">→</span>
              <select style={{ minWidth: 200 }} value={newRule.accountName} onChange={(e) => setNewRule((f) => ({ ...f, accountName: e.target.value }))}>
                <option value="">Suggest account…</option>
                {nonBankAccounts.map((a) => <option key={a.account_id} value={a.account_name}>{a.account_name}</option>)}
              </select>
              <button className="btn btn-sm btn-primary" disabled={!newRule.matchText.trim() || !newRule.accountName || savingRule} onClick={handleAddRule}>
                {savingRule ? "Saving…" : "Add Rule"}
              </button>
            </div>
            <div style={{ maxHeight: 240, overflowY: "auto" }}>
              {(rules || []).map((r) => (
                <div key={r.rule_id} style={{ padding: "8px 14px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, opacity: r.active ? 1 : 0.5 }}>
                  <div style={{ fontSize: 13 }}>"{r.match_text}" <span className="muted">→</span> {r.account_name}</div>
                  <button className="btn btn-sm" onClick={() => handleToggleRule(r)}>{r.active ? "Deactivate" : "Reactivate"}</button>
                </div>
              ))}
              {!rules?.length && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No rules yet — add one above so future uploads categorize themselves.</p>}
            </div>
          </div>
        )}
      </div>

      {data && (
        <div className="metric-grid" style={{ marginBottom: 16 }}>
          <div className="metric"><div className="metric-label">Book Balance (as of {fmtDate(asOf)})</div><div className="metric-value">{fmtMoney(data.bookBalance)}</div></div>
          <div className="metric"><div className="metric-label">Cleared Balance (matched)</div><div className="metric-value">{fmtMoney(data.clearedBalance)}</div></div>
          <div className="metric">
            <div className="metric-label">Difference</div>
            <div className="metric-value" style={{ color: Math.abs(difference) < 0.01 ? "var(--teal)" : "var(--red)" }}>{fmtMoney(difference)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Unmatched Bank Lines</div>
            <div className="metric-value" style={{ fontSize: 18 }}>{unmatchedBank.length} · {fmtMoney(unmatchedBankTotal)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Unmatched GL Entries</div>
            <div className="metric-value" style={{ fontSize: 18 }}>{unmatchedGl.length} · {fmtMoney(unmatchedGlTotal)}</div>
          </div>
        </div>
      )}
      {data && Math.abs(difference) >= 0.01 && (
        <p className="muted" style={{ fontSize: 12, margin: "-8px 0 16px" }}>
          Difference should equal the net of everything below still unmatched as of this date — match or create an entry for each one until it's $0.00.
        </p>
      )}

      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", fontWeight: 700, fontSize: 13 }}>
              Bank Lines ({data.bankLines.filter((b) => !b.matched_gl_entry_id).length} unmatched)
            </div>
            <div style={{ maxHeight: 480, overflowY: "auto" }}>
              {data.bankLines.filter((b) => !b.matched_gl_entry_id).map((b) => (
                <div key={b.line_id}>
                  <div
                    onClick={() => setSelectedBankLine(b.line_id === selectedBankLine ? null : b.line_id)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedBankLine(b.line_id === selectedBankLine ? null : b.line_id); } }}
                    style={{
                      padding: "8px 14px", borderBottom: "1px solid var(--line)", cursor: "pointer",
                      background: selectedBankLine === b.line_id ? "var(--surface-2, #f0fdfa)" : undefined,
                      display: "flex", justifyContent: "space-between", gap: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13 }}>{b.description || "—"}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{b.statement_date}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <span style={{ fontWeight: 700 }}>{fmtMoney(b.amount)}</span>
                      <div style={{ display: "flex", gap: 4 }}>
                        {b.je_draft_status && b.je_draft_status !== "Dismissed" ? (
                          <span className="muted" style={{ fontSize: 11 }} title="This line already has a suggested or approved journal entry — see Suggested Journal Entries / Ready to Reconcile below.">
                            {b.je_draft_status === "Pending" ? "Suggested below" : "Approved — ready to reconcile"}
                          </span>
                        ) : (
                          <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setCreatingFor(creatingFor === b.line_id ? null : b.line_id); }}>
                            {creatingFor === b.line_id ? "Cancel" : "New Entry"}
                          </button>
                        )}
                        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); handleDeleteLine(b.line_id); }}>Delete</button>
                      </div>
                    </div>
                  </div>
                  {creatingFor === b.line_id && (
                    <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--line)", display: "flex", gap: 8, alignItems: "center" }}>
                      <select style={{ flex: 1 }} value={offsetAccount} onChange={(e) => setOffsetAccount(e.target.value)}>
                        <option value="">Offset account…</option>
                        {nonBankAccounts.map((a) => <option key={a.account_id} value={a.account_name}>{a.account_name}</option>)}
                      </select>
                      <button className="btn btn-sm btn-primary" disabled={!offsetAccount || matching} onClick={() => handleCreateEntry(b.line_id)}>Create</button>
                    </div>
                  )}
                </div>
              ))}
              {!data.bankLines.filter((b) => !b.matched_gl_entry_id).length && <p className="muted" style={{ padding: 16, textAlign: "center" }}>Nothing unmatched.</p>}
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", fontWeight: 700, fontSize: 13 }}>
              GL Entries ({data.glCandidates.length} unmatched)
            </div>
            <div style={{ maxHeight: 480, overflowY: "auto" }}>
              {data.glCandidates.map((g) => (
                <div
                  key={g.gl_entry_id}
                  onClick={() => setSelectedGl(g.gl_entry_id === selectedGl ? null : g.gl_entry_id)}
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedGl(g.gl_entry_id === selectedGl ? null : g.gl_entry_id); } }}
                  style={{
                    padding: "8px 14px", borderBottom: "1px solid var(--line)", cursor: "pointer",
                    background: selectedGl === g.gl_entry_id ? "var(--surface-2, #f0fdfa)" : undefined,
                    display: "flex", justifyContent: "space-between", gap: 8,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13 }}>{g.description || g.ref || "—"}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{fmtDate(g.entry_date)}</div>
                  </div>
                  <span style={{ fontWeight: 700 }}>{fmtMoney(g.amount)}</span>
                </div>
              ))}
              {!data.glCandidates.length && <p className="muted" style={{ padding: 16, textAlign: "center" }}>Nothing unmatched.</p>}
            </div>
          </div>
        </div>
      )}

      {data && (
        <div className="card" style={{ marginTop: 12, padding: 0, overflow: "hidden" }}>
          <div
            style={{ padding: "10px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            onClick={() => setShowMatched((v) => !v)}
            tabIndex={0}
            role="button"
            aria-expanded={showMatched}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowMatched((v) => !v); } }}
          >
            <span>Matched ({data.bankLines.filter((b) => b.matched_gl_entry_id).length})</span>
            <span className="muted" aria-hidden="true">{showMatched ? "▾" : "▸"}</span>
          </div>
          {showMatched && (
            <div style={{ maxHeight: 320, overflowY: "auto", borderTop: "1px solid var(--line)" }}>
              {data.bankLines.filter((b) => b.matched_gl_entry_id).map((b) => (
                <div key={b.line_id} style={{ padding: "8px 14px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13 }}>{b.description || "—"} <span className="muted">→</span> {b.matched_gl_description || "—"}</div>
                    <div className="muted" style={{ fontSize: 11 }}>Bank: {fmtDate(b.statement_date)}{b.matched_gl_date ? ` · GL: ${fmtDate(b.matched_gl_date)}` : ""}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontWeight: 700 }}>{fmtMoney(b.amount)}</span>
                    <button className="btn btn-sm" onClick={() => handleUnmatch(b.line_id)}>Unmatch</button>
                  </div>
                </div>
              ))}
              {!data.bankLines.some((b) => b.matched_gl_entry_id) && <p className="muted" style={{ padding: 16, textAlign: "center" }}>Nothing matched yet.</p>}
            </div>
          )}
        </div>
      )}

      {selectedBankLine && selectedGl && (() => {
        const bankAmount = data?.bankLines.find((b) => b.line_id === selectedBankLine)?.amount;
        const glAmount = data?.glCandidates.find((g) => g.gl_entry_id === selectedGl)?.amount;
        const amountsMismatch = bankAmount != null && glAmount != null
          && Math.round(Number(bankAmount) * 100) !== Math.round(Number(glAmount) * 100);
        return (
          <div className="card" style={{ marginTop: 12, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            {amountsMismatch ? (
              <span style={{ color: "var(--red)" }}>
                These don't match — bank line is {fmtMoney(bankAmount)}, GL entry is {fmtMoney(glAmount)}. Pick a different pair, or use "New Entry" if nothing in the GL matches this bank line.
              </span>
            ) : (
              <span>Match the selected bank line to the selected GL entry?</span>
            )}
            <button className="btn btn-primary btn-sm" disabled={matching || amountsMismatch} onClick={handleMatch}>{matching ? "Matching…" : "Match"}</button>
          </div>
        );
      })()}
    </div>
  );
}

function CoaTab() {
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
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
      await notify(err instanceof ApiError ? err.message : "Could not save this account.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(accountId: string) {
    const ok = await confirmDialog({ title: "Deactivate account", message: "Deactivate this account?" });
    if (!ok) return;
    await api.post(`/accounting/coa/${accountId}/deactivate`, {}).catch((e) => notify(e.message));
    load();
  }
  async function handleActivate(accountId: string) {
    await api.post(`/accounting/coa/${accountId}/activate`, {}).catch((e) => notify(e.message));
    load();
  }

  return (
    <div>
      {isAdmin && (
        <button className="btn btn-primary" style={{ marginBottom: 16 }} onClick={() => (showForm ? setShowForm(false) : startCreate())}>{showForm ? "Cancel" : "New Account"}</button>
      )}
      {error && <ErrorBanner error={error} />}
      {showForm && isAdmin && (
        <form onSubmit={handleSave} className="card" style={{ maxWidth: 420, marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>{form.accountId ? `Edit ${form.accountId}` : "New Account"}</h2>
          <div className="field"><label htmlFor="acct-se-account-name">Account Name</label><input id="acct-se-account-name" required value={form.accountName} onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))} /></div>
          <div className="field"><label htmlFor="acct-se-account-type">Account Type</label><select id="acct-se-account-type" value={form.accountType} onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value }))}><option>Asset</option><option>Liability</option><option>Equity</option><option>Revenue</option><option>Expense</option><option>COGS</option></select></div>
          <div className="field"><label htmlFor="acct-se-detail-type">Detail Type</label><input id="acct-se-detail-type" value={form.detailType} onChange={(e) => setForm((f) => ({ ...f, detailType: e.target.value }))} placeholder="e.g. Checking, Accounts Receivable" /></div>
          <div className="field"><label htmlFor="acct-se-normal-balance">Normal Balance</label><select id="acct-se-normal-balance" value={form.normalBalance} onChange={(e) => setForm((f) => ({ ...f, normalBalance: e.target.value }))}><option>Debit</option><option>Credit</option></select></div>
          <div className="field"><label htmlFor="acct-se-opening-balance">Opening Balance</label><input id="acct-se-opening-balance" type="number" step="0.01" value={form.openingBalance} onChange={(e) => setForm((f) => ({ ...f, openingBalance: e.target.value }))} /></div>
          <div className="field"><label htmlFor="acct-se-sub-account-of">Sub-account Of</label><input id="acct-se-sub-account-of" value={form.subAccountOf} onChange={(e) => setForm((f) => ({ ...f, subAccountOf: e.target.value }))} placeholder="Parent account name (optional)" /></div>
          <div className="field"><label htmlFor="acct-se-tax-line">Tax Line</label><input id="acct-se-tax-line" value={form.taxLine} onChange={(e) => setForm((f) => ({ ...f, taxLine: e.target.value }))} /></div>
          <div className="field"><label htmlFor="acct-se-notes-5">Notes</label><textarea id="acct-se-notes-5" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </form>
      )}
      {accounts && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <div className="table-scroll">
            <table>
              <thead><tr><th scope="col">Account #</th><th scope="col">Account</th><th scope="col">Type</th><th scope="col">Detail Type</th><th scope="col">Normal Balance</th><th scope="col">Balance</th><th scope="col">Active</th>{isAdmin && <th scope="col"></th>}</tr></thead>
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
                    {isAdmin && (
                      <td style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-sm" onClick={() => startEdit(a)}>Edit</button>
                        {a.active ? <button className="btn btn-sm" onClick={() => handleDeactivate(a.account_id)}>Deactivate</button> : <button className="btn btn-sm" onClick={() => handleActivate(a.account_id)}>Activate</button>}
                      </td>
                    )}
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
