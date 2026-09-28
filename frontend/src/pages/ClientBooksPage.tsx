import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { CoaAccount } from "../api/types2";
import { useAuth } from "../auth/AuthContext";
import { useLanguage, Num } from "../context/LanguageContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmProvider";

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function monthStartStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

interface SalesCategory { category_id: string; category_name: string; state: string | null }
type DraftStatus = "Pending" | "Approved" | "Dismissed";
interface SalesDraft {
  draft_id: string; sale_date: string;
  category_lines: { categoryId: string; categoryName: string; taxableAmount: number | string }[];
  gross_sales: number | string; computedTax: number | string; notes: string | null; status: DraftStatus;
}
interface PurchaseDraft {
  draft_id: string; purchase_date: string; vendor_name: string | null; description: string | null;
  account: string; amount: number | string; paid_by_card: boolean; notes: string | null; status: DraftStatus;
}

const TABS = ["sales", "purchases", "pl"] as const;
type Tab = (typeof TABS)[number];

function StatusPill({ status, t }: { status: DraftStatus; t: (k: string) => string }) {
  const style =
    status === "Approved" ? { background: "var(--green-soft)", color: "var(--green)" }
    : status === "Dismissed" ? { background: "var(--surface)", color: "var(--muted)" }
    : { background: "var(--amber-soft)", color: "var(--amber)" };
  const key = status === "Approved" ? "books.status.approved" : status === "Dismissed" ? "books.status.dismissed" : "books.status.pending";
  return <span style={{ ...style, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>{t(key)}</span>;
}

export function ClientBooksPage() {
  const { user } = useAuth();
  const { t, dir } = useLanguage();
  const clientId = user?.clientId || "";
  const [tab, setTab] = useState<Tab>("sales");
  const [categories, setCategories] = useState<SalesCategory[]>([]);
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [vendors, setVendors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function loadOptions() {
    if (!clientId) return;
    api.get<{ categories: SalesCategory[]; accounts: CoaAccount[]; vendors: string[] }>(`/accounting/client-books/options?clientId=${clientId}`)
      .then((r) => { setCategories(r.categories); setAccounts(r.accounts); setVendors(r.vendors); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your books."));
  }
  useEffect(loadOptions, [clientId]);

  if (error) return <ErrorBanner error={error} />;

  return (
    <div dir={dir}>
      <p className="muted" style={{ margin: "0 0 20px", maxWidth: 760 }}>{t("books.intro")}</p>
      <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)", marginBottom: 20, flexWrap: "wrap" }}>
        {TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            role="tab"
            aria-selected={tab === tb}
            onClick={() => setTab(tb)}
            style={{
              padding: "10px 16px", fontSize: 14, fontWeight: 500, cursor: "pointer", border: "none", font: "inherit", background: "transparent",
              color: tab === tb ? "var(--ink)" : "var(--muted)",
              borderBottom: tab === tb ? "2px solid var(--teal)" : "2px solid transparent",
            }}
          >
            {t(tb === "sales" ? "books.tab.sales" : tb === "purchases" ? "books.tab.purchases" : "books.tab.pl")}
          </button>
        ))}
      </div>
      {tab === "sales" && <DailySalesTab clientId={clientId} categories={categories} />}
      {tab === "purchases" && <PurchasesTab clientId={clientId} accounts={accounts} vendors={vendors} onVendorAdded={loadOptions} />}
      {tab === "pl" && <MyPLTab clientId={clientId} />}
    </div>
  );
}

function DailySalesTab({ clientId, categories }: { clientId: string; categories: SalesCategory[] }) {
  const { t, dir } = useLanguage();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [saleDate, setSaleDate] = useState(todayStr());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<{ totalTax: number; grossSales: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<SalesDraft[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  function loadDrafts() {
    if (!clientId) return;
    api.get<{ drafts: SalesDraft[] }>(`/accounting/client-books/sales-drafts?clientId=${clientId}`).then((r) => setDrafts(r.drafts)).catch(() => {});
  }
  useEffect(loadDrafts, [clientId]);

  const categoryLines = useMemo(
    () => Object.entries(amounts).filter(([, v]) => Number(v) > 0).map(([categoryId, v]) => ({ categoryId, taxableAmount: Number(v) })),
    [amounts]
  );
  const categoryLinesKey = JSON.stringify(categoryLines);

  useEffect(() => {
    if (!clientId || categoryLines.length === 0) { setPreview(null); return; }
    const timer = setTimeout(() => {
      api.post<{ totalTax: number; grossSales: number }>("/accounting/client-books/sales-preview", { clientId, categoryLines })
        .then(setPreview).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, categoryLinesKey]);

  function resetForm() {
    setAmounts({});
    setNotes("");
    setPreview(null);
    setEditingId(null);
    setSaleDate(todayStr());
  }

  function startEdit(d: SalesDraft) {
    setEditingId(d.draft_id);
    setSaleDate(d.sale_date.slice(0, 10));
    setNotes(d.notes || "");
    const next: Record<string, string> = {};
    for (const l of d.category_lines) next[l.categoryId] = String(l.taxableAmount);
    setAmounts(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSave(confirmDuplicate = false) {
    if (categoryLines.length === 0) { setError(t("books.sales.needAmount")); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = { clientId, saleDate, categoryLines, notes, confirmDuplicate };
      if (editingId) await api.patch(`/accounting/client-books/sales-drafts/${editingId}`, payload);
      else await api.post("/accounting/client-books/sales-drafts", payload);
      toast(t("books.common.save"));
      resetForm();
      loadDrafts();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && (err.body as any)?.duplicate) {
        const ok = await confirmDialog({ message: t("books.sales.duplicateConfirm") });
        setSaving(false);
        if (ok) return handleSave(true);
        return;
      }
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(d: SalesDraft) {
    const ok = await confirmDialog({ message: t("books.common.deleteConfirm"), danger: true });
    if (!ok) return;
    try {
      await api.post(`/accounting/client-books/sales-drafts/${d.draft_id}/delete`, {});
      loadDrafts();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not delete.");
    }
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div className="command-panel">
        <div className="command-panel-header"><h2 className="command-panel-title">{t("books.tab.sales")}</h2></div>
        <div style={{ padding: 16 }}>
          {error && <ErrorBanner error={error} />}
          <div className="field" style={{ maxWidth: 220, marginBottom: 14 }}>
            <label htmlFor="cb-sale-date">{t("books.sales.dateLabel")}</label>
            <input id="cb-sale-date" type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th scope="col">{t("books.sales.categoryCol")}</th><th scope="col" style={{ textAlign: dir === "rtl" ? "left" : "right" }}>{t("books.sales.amountCol")}</th></tr></thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.category_id}>
                    <td>{c.category_name}</td>
                    <td>
                      <input
                        type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00"
                        value={amounts[c.category_id] || ""}
                        onChange={(e) => setAmounts((a) => ({ ...a, [c.category_id]: e.target.value }))}
                        style={{ textAlign: dir === "rtl" ? "left" : "right", maxWidth: 140 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="field" style={{ marginTop: 14, marginBottom: 14 }}>
            <label htmlFor="cb-sale-notes">{t("books.sales.notesLabel")}</label>
            <input id="cb-sale-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {preview && (
            <div className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
              {t("books.sales.grossTotal")}: <strong><Num>{fmtMoney(preview.grossSales)}</Num></strong>
              {" · "}{t("books.sales.estimatedTax")}: <strong><Num>{fmtMoney(preview.totalTax)}</Num></strong>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => handleSave(false)}>
              {saving ? t("books.sales.saving") : t("books.sales.save")}
            </button>
            {editingId && <button type="button" className="btn" onClick={resetForm}>{t("books.common.cancel")}</button>}
          </div>
        </div>
      </div>

      <div className="command-panel">
        <div className="command-panel-header"><h2 className="command-panel-title">{t("books.sales.recentTitle")}</h2></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">{t("books.sales.dateLabel")}</th><th scope="col" style={{ textAlign: dir === "rtl" ? "left" : "right" }}>{t("books.sales.grossTotal")}</th><th scope="col"></th><th scope="col"></th></tr></thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.draft_id}>
                  <td><Num>{d.sale_date.slice(0, 10)}</Num></td>
                  <td style={{ textAlign: dir === "rtl" ? "left" : "right" }}><Num>{fmtMoney(d.gross_sales)}</Num></td>
                  <td><StatusPill status={d.status} t={t} /></td>
                  <td>
                    {d.status === "Pending" && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="button" className="btn btn-sm" onClick={() => startEdit(d)}>{t("books.common.edit")}</button>
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDelete(d)}>{t("books.common.delete")}</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {drafts.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>{t("books.sales.noEntries")}</p>}
      </div>
    </div>
  );
}

function PurchasesTab({ clientId, accounts, vendors, onVendorAdded }: { clientId: string; accounts: CoaAccount[]; vendors: string[]; onVendorAdded: () => void }) {
  const { t, dir } = useLanguage();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [purchaseDate, setPurchaseDate] = useState(todayStr());
  const [vendorName, setVendorName] = useState("");
  const [description, setDescription] = useState("");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [paidByCard, setPaidByCard] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<PurchaseDraft[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  function loadDrafts() {
    if (!clientId) return;
    api.get<{ drafts: PurchaseDraft[] }>(`/accounting/client-books/purchase-drafts?clientId=${clientId}`).then((r) => setDrafts(r.drafts)).catch(() => {});
  }
  useEffect(loadDrafts, [clientId]);

  function resetForm() {
    setPurchaseDate(todayStr());
    setVendorName("");
    setDescription("");
    setAccount("");
    setAmount("");
    setPaidByCard(false);
    setNotes("");
    setEditingId(null);
  }

  function startEdit(d: PurchaseDraft) {
    setEditingId(d.draft_id);
    setPurchaseDate(d.purchase_date.slice(0, 10));
    setVendorName(d.vendor_name || "");
    setDescription(d.description || "");
    setAccount(d.account);
    setAmount(String(d.amount));
    setPaidByCard(d.paid_by_card);
    setNotes(d.notes || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSave() {
    if (!account) { setError(t("books.purchases.needAccount")); return; }
    if (!Number(amount) || Number(amount) <= 0) { setError(t("books.purchases.needAmount")); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = { clientId, purchaseDate, vendorName, description, account, amount: Number(amount), paidByCard, notes };
      if (editingId) await api.patch(`/accounting/client-books/purchase-drafts/${editingId}`, payload);
      else await api.post("/accounting/client-books/purchase-drafts", payload);
      toast(t("books.common.save"));
      resetForm();
      loadDrafts();
      onVendorAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(d: PurchaseDraft) {
    const ok = await confirmDialog({ message: t("books.common.deleteConfirm"), danger: true });
    if (!ok) return;
    try {
      await api.post(`/accounting/client-books/purchase-drafts/${d.draft_id}/delete`, {});
      loadDrafts();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not delete.");
    }
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div className="command-panel">
        <div className="command-panel-header"><h2 className="command-panel-title">{t("books.tab.purchases")}</h2></div>
        <div style={{ padding: 16 }}>
          {error && <ErrorBanner error={error} />}
          <datalist id="cb-vendor-list">
            {vendors.map((v) => <option key={v} value={v} />)}
          </datalist>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="cb-p-date">{t("books.purchases.dateLabel")}</label>
              <input id="cb-p-date" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="cb-p-vendor">{t("books.purchases.vendorLabel")}</label>
              <input id="cb-p-vendor" list="cb-vendor-list" placeholder={t("books.purchases.vendorPlaceholder")} value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="cb-p-account">{t("books.purchases.accountLabel")}</label>
              <select id="cb-p-account" value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="">—</option>
                {accounts.map((a) => <option key={a.account_id} value={a.account_name}>{a.account_name}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="cb-p-amount">{t("books.purchases.amountLabel")}</label>
              <input id="cb-p-amount" type="number" step="0.01" min="0" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor="cb-p-desc">{t("books.purchases.descriptionLabel")}</label>
            <input id="cb-p-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 13 }}>
            <input type="checkbox" checked={paidByCard} onChange={(e) => setPaidByCard(e.target.checked)} />
            {t("books.purchases.paidByCard")}
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? t("books.purchases.saving") : t("books.purchases.save")}
            </button>
            {editingId && <button type="button" className="btn" onClick={resetForm}>{t("books.common.cancel")}</button>}
          </div>
        </div>
      </div>

      <div className="command-panel">
        <div className="command-panel-header"><h2 className="command-panel-title">{t("books.purchases.recentTitle")}</h2></div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">{t("books.purchases.dateLabel")}</th>
                <th scope="col">{t("books.purchases.vendorLabel")}</th>
                <th scope="col">{t("books.purchases.accountLabel")}</th>
                <th scope="col" style={{ textAlign: dir === "rtl" ? "left" : "right" }}>{t("books.purchases.amountLabel")}</th>
                <th scope="col"></th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.draft_id}>
                  <td><Num>{d.purchase_date.slice(0, 10)}</Num></td>
                  <td>{d.vendor_name || "—"}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{d.account}</td>
                  <td style={{ textAlign: dir === "rtl" ? "left" : "right" }}><Num>{fmtMoney(d.amount)}</Num></td>
                  <td><StatusPill status={d.status} t={t} /></td>
                  <td>
                    {d.status === "Pending" && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="button" className="btn btn-sm" onClick={() => startEdit(d)}>{t("books.common.edit")}</button>
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDelete(d)}>{t("books.common.delete")}</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {drafts.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>{t("books.purchases.noEntries")}</p>}
      </div>
    </div>
  );
}

function MyPLTab({ clientId }: { clientId: string }) {
  const { t, dir } = useLanguage();
  const [from, setFrom] = useState(monthStartStr());
  const [to, setTo] = useState(todayStr());
  const [data, setData] = useState<{
    totalIncome: number; totalExpenses: number; netIncome: number;
    expensesByAccount: { account: string; amount: number }[];
    pendingSalesCount: number; pendingPurchasesCount: number;
  } | null>(null);

  useEffect(() => {
    if (!clientId) return;
    api.get<typeof data>(`/accounting/client-books/pl-preview?clientId=${clientId}&from=${from}&to=${to}`).then(setData).catch(() => {});
  }, [clientId, from, to]);

  return (
    <div className="command-panel" id="cb-pl-print-area">
      <div className="command-panel-header">
        <h2 className="command-panel-title">{t("books.pl.title")}</h2>
        <button type="button" className="btn btn-sm" onClick={() => window.print()}>{t("books.common.print")}</button>
      </div>
      <div style={{ padding: 16 }}>
        <p className="muted" style={{ fontSize: 12, marginBottom: 14 }}>{t("books.pl.disclaimer")}</p>
        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="cb-pl-from">{t("books.pl.fromLabel")}</label>
            <input id="cb-pl-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="cb-pl-to">{t("books.pl.toLabel")}</label>
            <input id="cb-pl-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        {data && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--line)" }}>
              <span>{t("books.pl.income")}{data.pendingSalesCount > 0 ? ` (${data.pendingSalesCount} ${t("books.pl.pendingNote")})` : ""}</span>
              <strong><Num>{fmtMoney(data.totalIncome)}</Num></strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--line)" }}>
              <span>{t("books.pl.expenses")}{data.pendingPurchasesCount > 0 ? ` (${data.pendingPurchasesCount} ${t("books.pl.pendingNote")})` : ""}</span>
              <strong><Num>{fmtMoney(data.totalExpenses)}</Num></strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", fontWeight: 800, color: "var(--teal)" }}>
              <span>{t("books.pl.netIncome")}</span>
              <strong><Num>{fmtMoney(data.netIncome)}</Num></strong>
            </div>
            {data.expensesByAccount.length > 0 && (
              <div className="table-scroll" style={{ marginTop: 16 }}>
                <table>
                  <thead><tr><th scope="col">{t("books.purchases.accountLabel")}</th><th scope="col" style={{ textAlign: dir === "rtl" ? "left" : "right" }}>{t("books.purchases.amountLabel")}</th></tr></thead>
                  <tbody>
                    {data.expensesByAccount.map((r) => (
                      <tr key={r.account}><td>{r.account}</td><td style={{ textAlign: dir === "rtl" ? "left" : "right" }}><Num>{fmtMoney(r.amount)}</Num></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
