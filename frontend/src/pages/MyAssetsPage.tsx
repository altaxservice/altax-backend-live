import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Hourglass, Landmark, Package, Plus, Trash2, TrendingDown, Wallet } from "lucide-react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useSelectedBusiness } from "../context/SelectedBusinessContext";
import { useLanguage, Num } from "../context/LanguageContext";
import { useConfirm, useNotify } from "../components/ConfirmProvider";
import { useToast } from "../components/Toast";
import { DateInput } from "../components/DateInput";
import { ErrorBanner } from "../components/ErrorBanner";
import { fmtMoney } from "../utils/clientFlags";
import { fmtDateOnly as fmtDate } from "../utils/date";

interface Asset { assetId: string; name: string; category: string; purchaseDate: string; cost: number; usefulLifeYears: number | null; method: string; status: string; disposedDate: string | null; accumulatedDepreciation: number; bookValue: number }
interface Draft { draftId: string; name: string; category: string; purchaseDate: string; cost: number; vendor: string | null; notes: string | null; status: string; submittedAt: string; dismissedReason: string | null }
interface AssetsData { assets: Asset[]; drafts: Draft[]; categories: string[]; totals: { cost: number; accumulatedDepreciation: number; bookValue: number; count: number } }

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export function MyAssetsPage() {
  const { user } = useAuth();
  const { t, dir } = useLanguage();
  const toast = useToast();
  const notify = useNotify();
  const confirmDialog = useConfirm();
  const { clientId: businessId, clientName } = useSelectedBusiness();
  const clientId = businessId || user?.clientId || "";
  const [data, setData] = useState<AssetsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ assetName: "", category: "Equipment", purchaseDate: todayIso(), cost: "", vendorName: "", notes: "" });

  const load = useCallback(() => {
    if (!clientId) return;
    setError(null);
    api.get<AssetsData>(`/client-portal/assets?clientId=${encodeURIComponent(clientId)}`).then(setData).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load your assets."));
  }, [clientId]);
  useEffect(() => { setData(null); load(); }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/client-portal/assets/drafts", { clientId, ...form });
      toast(t("as.sent"));
      setForm({ assetName: "", category: "Equipment", purchaseDate: todayIso(), cost: "", vendorName: "", notes: "" });
      setShowForm(false);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : t("as.saveFail"));
    } finally { setSaving(false); }
  }

  async function remove(d: Draft) {
    const ok = await confirmDialog({ title: t("as.removeTitle"), message: d.name, confirmLabel: t("as.remove"), danger: true });
    if (!ok) return;
    try { await api.post(`/client-portal/assets/drafts/${d.draftId}/delete`, {}); load(); }
    catch (err) { await notify(err instanceof ApiError ? err.message : t("as.saveFail")); }
  }

  if (error) return <ErrorBanner error={error} />;
  if (!data) return <div className="spinner-wrap">{t("books.common.loading")}</div>;

  const pending = data.drafts.filter((d) => d.status === "Pending");
  const dismissed = data.drafts.filter((d) => d.status === "Dismissed");
  const kpi = (Icon: typeof Wallet, tone: string, label: string, value: string, note: string) => (
    <div className="cc-kpi" style={{ cursor: "default" }}><span className={`cc-kpi-icon act-tone-${tone}`}><Icon size={20} aria-hidden="true" /></span><span><div className="cc-kpi-label">{label}</div><div className="cc-kpi-value"><Num>{value}</Num></div><div className="cc-kpi-note">{note}</div></span></div>
  );

  return (
    <div dir={dir}>
      <div className="cc-hero">
        <div>
          <div className="cc-date" style={{ marginBottom: 2 }}>{clientName || user?.clientName}</div>
          <h1 className="cc-hello" style={{ fontSize: 24 }}>{t("as.title")}</h1>
          <div className="cc-date" style={{ maxWidth: 640 }}>{t("as.intro")}</div>
        </div>
        <div className="cc-chips">
          {pending.length > 0 && <span className="cc-chip amber"><Num>{pending.length}</Num> {t("as.pendingChip")}</span>}
          <button type="button" className="action-button" onClick={() => setShowForm((v) => !v)}><Plus size={14} aria-hidden="true" /> {t("as.add")}</button>
        </div>
      </div>

      <div className="cc-kpis">
        {kpi(Package, "teal", t("as.kpi.count"), String(data.totals.count), t("as.kpi.countNote"))}
        {kpi(Wallet, "blue", t("as.kpi.cost"), fmtMoney(data.totals.cost), t("as.kpi.costNote"))}
        {kpi(TrendingDown, "amber", t("as.kpi.dep"), fmtMoney(data.totals.accumulatedDepreciation), t("as.kpi.depNote"))}
        {kpi(Landmark, "green", t("as.kpi.book"), fmtMoney(data.totals.bookValue), t("as.kpi.bookNote"))}
      </div>

      {showForm && (
        <form className="command-panel" style={{ marginBottom: 14 }} onSubmit={submit}>
          <div className="command-panel-header"><div><h2 className="command-panel-title">{t("as.formTitle")}</h2><div className="command-panel-note">{t("as.formNote")}</div></div></div>
          <div className="as-form">
            <div className="field"><label htmlFor="as-name">{t("as.f.name")}</label><input id="as-name" required value={form.assetName} onChange={(e) => setForm({ ...form, assetName: e.target.value })} placeholder={t("as.f.namePh")} /></div>
            <div className="field"><label htmlFor="as-cat">{t("as.f.category")}</label>
              <select id="as-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{data.categories.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div className="field"><label>{t("as.f.date")}</label><DateInput value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} /></div>
            <div className="field"><label htmlFor="as-cost">{t("as.f.cost")}</label><input id="as-cost" required inputMode="decimal" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} placeholder="0.00" /></div>
            <div className="field"><label htmlFor="as-vendor">{t("as.f.vendor")}</label><input id="as-vendor" value={form.vendorName} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="as-notes">{t("as.f.notes")}</label><textarea id="as-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <div style={{ display: "flex", gap: 8, padding: "0 16px 16px" }}>
            <button type="submit" className="action-button" disabled={saving}>{saving ? t("as.sending") : t("as.send")}</button>
            <button type="button" className="ghost-button" onClick={() => setShowForm(false)}>{t("as.cancel")}</button>
          </div>
        </form>
      )}

      {pending.length > 0 && (
        <section className="command-panel" style={{ marginBottom: 14 }}>
          <div className="command-panel-header"><div><h2 className="command-panel-title"><Hourglass size={14} aria-hidden="true" /> {t("as.pendingTitle")}</h2><div className="command-panel-note">{t("as.pendingNote")}</div></div></div>
          <div className="work-card-list">
            {pending.map((d) => (
              <article className="work-card" key={d.draftId}>
                <div className="work-card-main">
                  <div className="work-card-title">{d.name}</div>
                  <div className="work-card-meta"><span>{d.category}</span><span><Num>{fmtDate(d.purchaseDate)}</Num></span><span><Num>{fmtMoney(d.cost)}</Num></span>{d.vendor && <span>{d.vendor}</span>}</div>
                </div>
                <div className="work-card-side">
                  <span className="status-pill status-amber">{t("as.status.review")}</span>
                  <button type="button" className="icon-button" aria-label={t("as.remove")} title={t("as.remove")} onClick={() => remove(d)}><Trash2 size={15} /></button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="command-panel">
        <div className="command-panel-header"><div><h2 className="command-panel-title">{t("as.listTitle")}</h2><div className="command-panel-note"><Num>{data.assets.length}</Num> {t("as.onRecord")}</div></div></div>
        {data.assets.length === 0 ? (
          <div style={{ padding: 20 }}><p className="muted" style={{ margin: "0 0 10px" }}>{t("as.empty")}</p><button type="button" className="ghost-button" onClick={() => setShowForm(true)}>{t("as.add")}</button></div>
        ) : (
          <div className="table-scroll card-table">
            <table>
              <thead><tr><th scope="col">{t("as.col.asset")}</th><th scope="col">{t("as.f.category")}</th><th scope="col">{t("as.f.date")}</th><th scope="col" style={{ textAlign: "end" }}>{t("as.kpi.cost")}</th><th scope="col" style={{ textAlign: "end" }}>{t("as.kpi.dep")}</th><th scope="col" style={{ textAlign: "end" }}>{t("as.kpi.book")}</th><th scope="col">{t("as.col.status")}</th></tr></thead>
              <tbody>
                {data.assets.map((a) => (
                  <tr key={a.assetId}>
                    <td><b>{a.name}</b>{a.usefulLifeYears ? <div className="muted" style={{ fontSize: 11.5 }}>{a.method} · <Num>{a.usefulLifeYears}</Num> {t("as.years")}</div> : null}</td>
                    <td className="muted">{a.category}</td>
                    <td className="muted"><Num>{fmtDate(a.purchaseDate)}</Num></td>
                    <td style={{ textAlign: "end" }}><Num>{fmtMoney(a.cost)}</Num></td>
                    <td style={{ textAlign: "end" }} className="muted"><Num>{fmtMoney(a.accumulatedDepreciation)}</Num></td>
                    <td style={{ textAlign: "end" }}><b><Num>{fmtMoney(a.bookValue)}</Num></b></td>
                    <td>{a.status === "Disposed" ? <span className="status-pill status-grey">{t("as.status.disposed")}{a.disposedDate ? ` · ${fmtDate(a.disposedDate)}` : ""}</span> : <span className="status-pill status-green">{t("as.status.active")}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {dismissed.length > 0 && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
          {t("as.dismissed")} {dismissed.map((d) => `${d.name}${d.dismissedReason ? ` (${d.dismissedReason})` : ""}`).join("; ")}
        </p>
      )}
    </div>
  );
}
