import { useEffect, useMemo, useState } from "react";
import { api, ApiError, viewFile, downloadFile, printFile } from "../api/client";
import type { CoaAccount } from "../api/types2";
import { useAuth } from "../auth/AuthContext";
import { useSelectedBusiness } from "../context/SelectedBusinessContext";
import { useLanguage, Num } from "../context/LanguageContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { useToast } from "../components/Toast";
import { useConfirm, usePrompt } from "../components/ConfirmProvider";
import { fileToBase64, MAX_UPLOAD_BYTES } from "../utils/file";

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}
// toISOString() is UTC — from ~8pm EDT / 7pm EST onward it's already
// tomorrow in UTC, so a client logging end-of-day sales in the evening
// would have silently defaulted to the wrong date. Local date components
// instead, matching monthStartStr() below.
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  receipt_count?: number;
}
interface PurchaseTemplate {
  template_id: string; name: string; account: string; vendor_name: string | null;
  default_amount: number | string | null; paid_by_card: boolean; notes: string | null;
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
  const { clientId: businessId } = useSelectedBusiness();
  const clientId = businessId || user?.clientId || "";
  const [tab, setTab] = useState<Tab>("sales");
  const [categories, setCategories] = useState<SalesCategory[]>([]);
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [vendors, setVendors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  function loadOptions() {
    if (!clientId) return;
    setError(null);
    api.get<{ categories: SalesCategory[]; accounts: CoaAccount[]; vendors: string[] }>(`/accounting/client-books/options?clientId=${clientId}`)
      .then((r) => { setCategories(r.categories); setAccounts(r.accounts); setVendors(r.vendors); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your books."))
      .finally(() => setLoaded(true));
  }
  useEffect(loadOptions, [clientId]);

  if (error) return <ErrorBanner error={error} />;
  if (!loaded) return <div className="spinner-wrap">{t("books.common.loading")}</div>;

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
  const { t } = useLanguage();
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
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [draftsError, setDraftsError] = useState(false);

  function loadDrafts() {
    if (!clientId) return;
    setDraftsLoading(true);
    setDraftsError(false);
    api.get<{ drafts: SalesDraft[] }>(`/accounting/client-books/sales-drafts?clientId=${clientId}`)
      .then((r) => setDrafts(r.drafts))
      .catch(() => setDraftsError(true))
      .finally(() => setDraftsLoading(false));
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
      toast(t("books.common.saved"));
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
              <thead><tr><th scope="col">{t("books.sales.categoryCol")}</th><th scope="col" style={{ textAlign: "right" }}>{t("books.sales.amountCol")}</th></tr></thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.category_id}>
                    <td>{c.category_name}</td>
                    <td>
                      <input
                        type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00"
                        aria-label={`${c.category_name} — ${t("books.sales.amountCol")}`}
                        value={amounts[c.category_id] || ""}
                        onChange={(e) => setAmounts((a) => ({ ...a, [c.category_id]: e.target.value }))}
                        style={{ textAlign: "right", maxWidth: 140 }}
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
        {draftsLoading && <div className="spinner-wrap">{t("books.common.loading")}</div>}
        {!draftsLoading && draftsError && (
          <div style={{ padding: 16, textAlign: "center" }}>
            <p className="muted" style={{ marginBottom: 8 }}>{t("books.common.loadError")}</p>
            <button type="button" className="btn btn-sm" onClick={loadDrafts}>{t("books.common.retry")}</button>
          </div>
        )}
        {!draftsLoading && !draftsError && (
          <div className="table-scroll card-table">
            <table>
              <thead><tr><th scope="col">{t("books.sales.dateLabel")}</th><th scope="col" style={{ textAlign: "right" }}>{t("books.sales.grossTotal")}</th><th scope="col"></th><th scope="col"></th></tr></thead>
              <tbody>
                {drafts.map((d) => (
                  <tr key={d.draft_id}>
                    <td data-label={t("books.sales.dateLabel")}><Num>{d.sale_date.slice(0, 10)}</Num></td>
                    <td data-label={t("books.sales.grossTotal")} style={{ textAlign: "right" }}><Num>{fmtMoney(d.gross_sales)}</Num></td>
                    <td data-label={t("books.status.pending")}><StatusPill status={d.status} t={t} /></td>
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
        )}
        {!draftsLoading && !draftsError && drafts.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>{t("books.sales.noEntries")}</p>}
      </div>
    </div>
  );
}

function PurchasesTab({ clientId, accounts, vendors, onVendorAdded }: { clientId: string; accounts: CoaAccount[]; vendors: string[]; onVendorAdded: () => void }) {
  const { t } = useLanguage();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();
  const [purchaseDate, setPurchaseDate] = useState(todayStr());
  const [vendorName, setVendorName] = useState("");
  const [description, setDescription] = useState("");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [paidByCard, setPaidByCard] = useState(false);
  const [notes, setNotes] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<PurchaseDraft[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [draftsError, setDraftsError] = useState(false);
  const [templates, setTemplates] = useState<PurchaseTemplate[]>([]);
  const [savingTemplate, setSavingTemplate] = useState(false);

  function loadDrafts() {
    if (!clientId) return;
    setDraftsLoading(true);
    setDraftsError(false);
    api.get<{ drafts: PurchaseDraft[] }>(`/accounting/client-books/purchase-drafts?clientId=${clientId}`)
      .then((r) => setDrafts(r.drafts))
      .catch(() => setDraftsError(true))
      .finally(() => setDraftsLoading(false));
  }
  useEffect(loadDrafts, [clientId]);

  function loadTemplates() {
    if (!clientId) return;
    api.get<{ templates: PurchaseTemplate[] }>(`/accounting/client-books/purchase-templates?clientId=${clientId}`)
      .then((r) => setTemplates(r.templates))
      .catch(() => {});
  }
  useEffect(loadTemplates, [clientId]);

  function applyTemplate(templateId: string) {
    const tpl = templates.find((t) => t.template_id === templateId);
    if (!tpl) return;
    setAccount(tpl.account);
    setVendorName(tpl.vendor_name || "");
    setAmount(tpl.default_amount != null ? String(tpl.default_amount) : "");
    setPaidByCard(tpl.paid_by_card);
    setNotes(tpl.notes || "");
  }

  async function handleSaveTemplate() {
    if (!account) { toast(t("books.purchases.needAccount")); return; }
    const name = await promptFor({ message: t("books.purchases.templateNamePrompt"), defaultValue: vendorName || account });
    if (!name || !name.trim()) return;
    setSavingTemplate(true);
    try {
      await api.post("/accounting/client-books/purchase-templates", {
        clientId, name: name.trim(), account, vendorName, defaultAmount: amount ? Number(amount) : undefined, paidByCard, notes,
      });
      toast(t("books.purchases.templateSaved"));
      loadTemplates();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not save this template.");
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleDeleteTemplate(templateId: string) {
    const ok = await confirmDialog({ message: t("books.common.deleteConfirm"), danger: true });
    if (!ok) return;
    try {
      await api.post(`/accounting/client-books/purchase-templates/${templateId}/delete`, {});
      loadTemplates();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not delete this template.");
    }
  }

  function resetForm() {
    setPurchaseDate(todayStr());
    setVendorName("");
    setDescription("");
    setAccount("");
    setAmount("");
    setPaidByCard(false);
    setNotes("");
    setReceiptFile(null);
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
      let draftId = editingId;
      if (editingId) await api.patch(`/accounting/client-books/purchase-drafts/${editingId}`, payload);
      else {
        const created = await api.post<{ ok: boolean; draftId: string }>("/accounting/client-books/purchase-drafts", payload);
        draftId = created.draftId;
      }
      if (receiptFile && draftId) {
        try {
          const fileData = await fileToBase64(receiptFile);
          await api.post("/documents/uploads", { purchaseDraftId: draftId, fileData, fileName: receiptFile.name, mimeType: receiptFile.type });
        } catch (err) {
          toast(err instanceof ApiError ? err.message : t("books.purchases.receiptUploadFailed"));
        }
      }
      toast(t("books.common.saved"));
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

  async function viewReceipt(draftId: string) {
    try {
      const res = await api.get<{ uploads: { upload_id: string }[] }>(`/documents/uploads?purchaseDraftId=${draftId}`);
      const latest = res.uploads[0];
      if (!latest) { toast(t("books.purchases.noReceipt")); return; }
      await viewFile(`/documents/uploads/${latest.upload_id}/download`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not open the receipt.");
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
          {templates.length > 0 && (
            <div className="field" style={{ maxWidth: 340, marginBottom: 14 }}>
              <label htmlFor="cb-p-template">{t("books.purchases.templateLabel")}</label>
              <div style={{ display: "flex", gap: 6 }}>
                <select id="cb-p-template" defaultValue="" onChange={(e) => { if (e.target.value) { applyTemplate(e.target.value); e.target.value = ""; } }}>
                  <option value="">{t("books.purchases.templatePlaceholder")}</option>
                  {templates.map((tpl) => <option key={tpl.template_id} value={tpl.template_id}>{tpl.name}</option>)}
                </select>
              </div>
            </div>
          )}
          <div className="form-grid" style={{ marginBottom: 12 }}>
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
                <option value="">{t("books.purchases.accountPlaceholder")}</option>
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
          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="cb-p-receipt">{t("books.purchases.receiptLabel")}</label>
            <input
              id="cb-p-receipt"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                if (file && file.size > MAX_UPLOAD_BYTES) {
                  toast(t("books.purchases.receiptTooLarge"));
                  e.target.value = "";
                  return;
                }
                setReceiptFile(file);
              }}
            />
            {receiptFile && <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{receiptFile.name}</p>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? t("books.purchases.saving") : t("books.purchases.save")}
            </button>
            <button type="button" className="btn" disabled={savingTemplate} onClick={handleSaveTemplate}>
              {t("books.purchases.saveAsTemplate")}
            </button>
            {editingId && <button type="button" className="btn" onClick={resetForm}>{t("books.common.cancel")}</button>}
          </div>
        </div>
      </div>

      {templates.length > 0 && (
        <div className="command-panel">
          <div className="command-panel-header"><h2 className="command-panel-title">{t("books.purchases.templatesTitle")}</h2></div>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {templates.map((tpl) => (
              <div key={tpl.template_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                <span>{tpl.name} <span className="muted">— {tpl.account}{tpl.default_amount != null ? ` · ${fmtMoney(tpl.default_amount)}` : ""}</span></span>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDeleteTemplate(tpl.template_id)}>{t("books.common.delete")}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="command-panel">
        <div className="command-panel-header"><h2 className="command-panel-title">{t("books.purchases.recentTitle")}</h2></div>
        {draftsLoading && <div className="spinner-wrap">{t("books.common.loading")}</div>}
        {!draftsLoading && draftsError && (
          <div style={{ padding: 16, textAlign: "center" }}>
            <p className="muted" style={{ marginBottom: 8 }}>{t("books.common.loadError")}</p>
            <button type="button" className="btn btn-sm" onClick={loadDrafts}>{t("books.common.retry")}</button>
          </div>
        )}
        {!draftsLoading && !draftsError && (
          <div className="table-scroll card-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t("books.purchases.dateLabel")}</th>
                  <th scope="col">{t("books.purchases.vendorLabel")}</th>
                  <th scope="col">{t("books.purchases.accountLabel")}</th>
                  <th scope="col" style={{ textAlign: "right" }}>{t("books.purchases.amountLabel")}</th>
                  <th scope="col"></th>
                  <th scope="col"></th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d) => (
                  <tr key={d.draft_id}>
                    <td data-label={t("books.purchases.dateLabel")}><Num>{d.purchase_date.slice(0, 10)}</Num></td>
                    <td data-label={t("books.purchases.vendorLabel")}>{d.vendor_name || "—"}</td>
                    <td data-label={t("books.purchases.accountLabel")} className="muted">{d.account}</td>
                    <td data-label={t("books.purchases.amountLabel")} style={{ textAlign: "right" }}><Num>{fmtMoney(d.amount)}</Num></td>
                    <td data-label={t("books.status.pending")}><StatusPill status={d.status} t={t} /></td>
                    <td>
                      {!!d.receipt_count && (
                        <button type="button" className="btn btn-sm" onClick={() => viewReceipt(d.draft_id)}>📎 {d.receipt_count}</button>
                      )}
                    </td>
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
        )}
        {!draftsLoading && !draftsError && drafts.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>{t("books.purchases.noEntries")}</p>}
      </div>
    </div>
  );
}

function MyPLTab({ clientId }: { clientId: string }) {
  const { t } = useLanguage();
  const toast = useToast();
  const [from, setFrom] = useState(monthStartStr());
  const [to, setTo] = useState(todayStr());
  const [data, setData] = useState<{
    totalIncome: number; totalExpenses: number; netIncome: number;
    expensesByAccount: { account: string; amount: number }[];
    pendingSalesCount: number; pendingPurchasesCount: number;
  } | null>(null);
  const [plLoading, setPlLoading] = useState(true);
  const [plError, setPlError] = useState(false);
  const [taxLiability, setTaxLiability] = useState<{
    available: boolean; periodEnd?: string; dueDate?: string;
    postedTax?: number; pendingTax?: number; totalEstimated?: number; pendingIsEstimate?: boolean;
  } | null>(null);

  function loadPl() {
    if (!clientId) return;
    setPlLoading(true);
    setPlError(false);
    api.get<typeof data>(`/accounting/client-books/pl-preview?clientId=${clientId}&from=${from}&to=${to}`)
      .then(setData)
      .catch(() => setPlError(true))
      .finally(() => setPlLoading(false));
  }
  useEffect(loadPl, [clientId, from, to]);

  useEffect(() => {
    if (!clientId) return;
    api.get<typeof taxLiability>(`/accounting/client-books/sales-tax-liability?clientId=${clientId}`)
      .then(setTaxLiability)
      .catch(() => setTaxLiability(null));
  }, [clientId]);

  const pdfPath = `/accounting/client-books/pl-pdf?clientId=${clientId}&from=${from}&to=${to}`;
  async function handleViewPdf() {
    try { await viewFile(pdfPath); } catch (err) { toast(err instanceof ApiError ? err.message : "Could not open the PDF."); }
  }
  async function handleDownloadPdf() {
    try { await downloadFile(pdfPath, "income-expenses.pdf"); } catch (err) { toast(err instanceof ApiError ? err.message : "Could not download the PDF."); }
  }
  async function handlePrintPdf() {
    try { await printFile(pdfPath); } catch (err) { toast(err instanceof ApiError ? err.message : "Could not print the PDF."); }
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {taxLiability?.available && (
        <div className="command-panel">
          <div className="command-panel-header"><h2 className="command-panel-title">{t("books.taxLiability.title")}</h2></div>
          <div style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
              <span>{t("books.taxLiability.posted")}</span>
              <strong><Num>{fmtMoney(taxLiability.postedTax)}</Num></strong>
            </div>
            {!!taxLiability.pendingTax && taxLiability.pendingTax > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                <span>{t("books.taxLiability.pending")}</span>
                <strong><Num>{fmtMoney(taxLiability.pendingTax)}</Num></strong>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--line)", fontWeight: 800, color: "var(--teal)" }}>
              <span>{t("books.taxLiability.total")} {taxLiability.dueDate ? `(${t("books.taxLiability.dueBy")} ${taxLiability.dueDate})` : ""}</span>
              <strong><Num>{fmtMoney(taxLiability.totalEstimated)}</Num></strong>
            </div>
            {taxLiability.pendingIsEstimate && (
              <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>{t("books.taxLiability.pendingNote")}</p>
            )}
          </div>
        </div>
      )}
    <div className="command-panel">
      <div className="command-panel-header">
        <h2 className="command-panel-title">{t("books.pl.title")}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-sm" onClick={handleViewPdf}>{t("books.common.viewPdf")}</button>
          <button type="button" className="btn btn-sm" onClick={handleDownloadPdf}>{t("books.common.downloadPdf")}</button>
          <button type="button" className="btn btn-sm" onClick={handlePrintPdf}>{t("books.common.print")}</button>
        </div>
      </div>
      <div style={{ padding: 16 }}>
        <p className="muted" style={{ marginBottom: 14 }}>{t("books.pl.disclaimer")}</p>
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
        {plLoading && <div className="spinner-wrap">{t("books.common.loading")}</div>}
        {!plLoading && plError && (
          <div style={{ padding: 16, textAlign: "center" }}>
            <p className="muted" style={{ marginBottom: 8 }}>{t("books.common.loadError")}</p>
            <button type="button" className="btn btn-sm" onClick={loadPl}>{t("books.common.retry")}</button>
          </div>
        )}
        {!plLoading && !plError && data && (
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
              <div className="table-scroll card-table" style={{ marginTop: 16 }}>
                <table>
                  <thead><tr><th scope="col">{t("books.purchases.accountLabel")}</th><th scope="col" style={{ textAlign: "right" }}>{t("books.purchases.amountLabel")}</th></tr></thead>
                  <tbody>
                    {data.expensesByAccount.map((r) => (
                      <tr key={r.account}><td data-label={t("books.purchases.accountLabel")}>{r.account}</td><td data-label={t("books.purchases.amountLabel")} style={{ textAlign: "right" }}><Num>{fmtMoney(r.amount)}</Num></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
    </div>
  );
}
