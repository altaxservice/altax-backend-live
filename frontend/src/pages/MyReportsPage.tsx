import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, CalendarClock, FileText, FolderArchive, Landmark, Lock, Printer, Receipt, Users, Wallet, Download, Eye, type LucideIcon } from "lucide-react";
import { api, ApiError, downloadFile, printFile, viewFile } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useSelectedBusiness } from "../context/SelectedBusinessContext";
import { useLanguage, Num } from "../context/LanguageContext";
import { useNotify } from "../components/ConfirmProvider";
import { DateInput } from "../components/DateInput";
import { ErrorBanner } from "../components/ErrorBanner";
import { fmtMoney } from "../utils/clientFlags";
import { fmtDateOnly as fmtDate, daysUntil } from "../utils/date";

interface Overview {
  clientId: string; pendingEntries?: number; lastApprovedAt?: string | null;
  available: { financialStatements: boolean; salesTax: boolean; payroll: boolean };
  trend: { label: string; from: string; income: number; expenses: number }[];
  ytd: { income: number; expenses: number; net: number; topExpenses: { account: string; amount: number }[] } | null;
  salesTaxPaidYtd: number; salesTaxFilingsYtd: number;
}
interface KeyDate { title: string; period: string; dueDate: string; filedDate: string | null }
interface FirmDoc { upload_id: string; file_name: string; uploaded_at: string; direction: string; hidden_from_client: boolean; notes: string | null }

const DOC_CATS: { key: string; test: RegExp }[] = [
  { key: "tax", test: /(1120|1065|1040|tax return|return|8879|k-?1)/i },
  { key: "w2", test: /(w-?2|w-?3|1099|1096)/i },
  { key: "fin", test: /(financial|statement|p&l|profit|balance)/i },
  { key: "filing", test: /(941|940|annual report|sales tax|withholding|form|filing|confirmation)/i },
];
const docCat = (name: string) => DOC_CATS.find((c) => c.test.test(name))?.key || "other";

interface TaxRow { task_id: string; task_name: string; agency_due_date: string | null; paid_date: string | null; payment_amount: string | number | null; confirmation_number: string | null; status: string }

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
type PeriodKey = "thisMonth" | "lastMonth" | "thisQuarter" | "lastQuarter" | "thisYear" | "lastYear" | "custom";
function rangeFor(key: PeriodKey): { from: string; to: string } {
  const n = new Date(); const y = n.getFullYear(); const m = n.getMonth(); const q = Math.floor(m / 3);
  switch (key) {
    case "thisMonth": return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "lastMonth": return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "thisQuarter": return { from: iso(new Date(y, q * 3, 1)), to: iso(new Date(y, q * 3 + 3, 0)) };
    case "lastQuarter": return { from: iso(new Date(y, (q - 1) * 3, 1)), to: iso(new Date(y, q * 3, 0)) };
    case "lastYear": return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default: return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
}

function TrendChart({ trend, labels }: { trend: Overview["trend"]; labels: { income: string; expenses: string } }) {
  const max = Math.max(1, ...trend.flatMap((m) => [m.income, m.expenses]));
  const W = 640, H = 170, pl = 6, pb = 22, step = (W - pl) / trend.length, bw = Math.min(16, step / 2.6);
  return (
    <figure className="rp-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${labels.income} / ${labels.expenses}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={pl} x2={W} y1={(H - pb) * (1 - f)} y2={(H - pb) * (1 - f)} className="rp-grid" />)}
        {trend.map((m, i) => {
          const x = pl + i * step + step / 2;
          const hi = ((H - pb - 4) * m.income) / max, he = ((H - pb - 4) * m.expenses) / max;
          return (
            <g key={m.from}>
              <rect x={x - bw - 1} y={H - pb - hi} width={bw} height={Math.max(1, hi)} rx="2" className="rp-bar income"><title>{`${m.label}: ${labels.income} ${fmtMoney(m.income)}`}</title></rect>
              <rect x={x + 1} y={H - pb - he} width={bw} height={Math.max(1, he)} rx="2" className="rp-bar expenses"><title>{`${m.label}: ${labels.expenses} ${fmtMoney(m.expenses)}`}</title></rect>
              <text x={x} y={H - 6} textAnchor="middle" className="rp-axis">{m.label}</text>
            </g>
          );
        })}
      </svg>
      <figcaption><span className="rp-key income" /> {labels.income} <span className="rp-key expenses" style={{ marginInlineStart: 12 }} /> {labels.expenses}</figcaption>
    </figure>
  );
}

export function MyReportsPage() {
  const { user } = useAuth();
  const { t, dir, lang } = useLanguage();
  const notify = useNotify();
  const { clientId: businessId, clientName } = useSelectedBusiness();
  const clientId = businessId || user?.clientId || "";
  const [ov, setOv] = useState<Overview | null>(null);
  const [rows, setRows] = useState<TaxRow[]>([]);
  const [keyDates, setKeyDates] = useState<{ upcoming: KeyDate[]; filed: KeyDate[] } | null>(null);
  const [docs, setDocs] = useState<FirmDoc[]>([]);
  const [docYear, setDocYear] = useState<string>(String(new Date().getFullYear() - 1));
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodKey>("thisYear");
  const [custom, setCustom] = useState(rangeFor("thisMonth"));
  const { from, to } = period === "custom" ? custom : rangeFor(period);

  useEffect(() => {
    if (!clientId) return;
    setOv(null); setError(null);
    api.get<Overview>(`/client-portal/reports/overview?clientId=${encodeURIComponent(clientId)}`).then(setOv).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load your reports."));
    api.get<{ rows: TaxRow[] }>(`/billing/client-tax-payments?clientId=${encodeURIComponent(clientId)}`).then((r) => setRows(r.rows)).catch(() => setRows([]));
    api.get<{ upcoming: KeyDate[]; filed: KeyDate[] }>(`/client-portal/key-dates?clientId=${encodeURIComponent(clientId)}`).then(setKeyDates).catch(() => setKeyDates({ upcoming: [], filed: [] }));
    api.get<{ uploads: FirmDoc[] }>(`/documents/uploads?clientId=${encodeURIComponent(clientId)}`).then((r) => setDocs(r.uploads.filter((u) => u.direction === "Firm to Client" && !u.hidden_from_client))).catch(() => setDocs([]));
  }, [clientId]);

  const qs = `from=${from}&to=${to}`;
  const cards = useMemo(() => {
    const list: { key: string; Icon: LucideIcon; title: string; desc: string; path: string; file: string }[] = [
      { key: "mine", Icon: Wallet, title: t("rp.card.mine"), desc: t("rp.card.mineDesc"), path: `/accounting/client-books/pl-pdf?clientId=${clientId}&${qs}`, file: "income-expenses.pdf" },
    ];
    if (ov?.available.financialStatements) {
      list.push({ key: "pl", Icon: BarChart3, title: t("rp.card.pl"), desc: t("rp.card.plDesc"), path: `/reports/pdf/pl/${clientId}?${qs}`, file: "profit-and-loss.pdf" });
      list.push({ key: "bs", Icon: Landmark, title: t("rp.card.bs"), desc: t("rp.card.bsDesc"), path: `/reports/pdf/balance-sheet/${clientId}?${qs}`, file: "balance-sheet.pdf" });
    }
    if (ov?.available.salesTax) list.push({ key: "st", Icon: Receipt, title: t("rp.card.st"), desc: t("rp.card.stDesc"), path: `/reports/pdf/sales-tax/${clientId}?${qs}`, file: "sales-and-sales-tax.pdf" });
    if (ov?.available.payroll) list.push({ key: "pr", Icon: Users, title: t("rp.card.pr"), desc: t("rp.card.prDesc"), path: `/reports/pdf/payroll/${clientId}?${qs}`, file: "payroll-summary.pdf" });
    return list;
  }, [ov, clientId, qs, t]);

  async function run(fn: () => Promise<void>) {
    try { await fn(); } catch (err) { await notify(err instanceof ApiError ? err.message : t("rp.openFail")); }
  }

  if (error) return <ErrorBanner error={error} />;
  if (!ov) return <div className="spinner-wrap">{t("books.common.loading")}</div>;

  const periods: PeriodKey[] = ["thisMonth", "lastMonth", "thisQuarter", "lastQuarter", "thisYear", "lastYear", "custom"];
  const maxExp = Math.max(1, ...(ov.ytd?.topExpenses.map((e) => e.amount) || [1]));
  const docYears = Array.from(new Set(docs.map((d) => String(new Date(d.uploaded_at).getFullYear())))).sort().reverse();
  const yearDocs = docs.filter((d) => String(new Date(d.uploaded_at).getFullYear()) === docYear || new RegExp(`\\b${docYear}\\b`).test(d.file_name));
  const catOrder = ["tax", "w2", "fin", "filing", "other"];
  const grouped = catOrder.map((k) => ({ key: k, list: yearDocs.filter((d) => docCat(d.file_name) === k) })).filter((g) => g.list.length);
  async function downloadAll() { for (const d of yearDocs) { await run(() => downloadFile(`/documents/uploads/${d.upload_id}/download`, d.file_name)); } }

  return (
    <div dir={dir}>
      <div className="cc-hero">
        <div>
          <div className="cc-date" style={{ marginBottom: 2 }}>{clientName || user?.clientName}</div>
          <h1 className="cc-hello" style={{ fontSize: 24 }}>{t("rp.title")}</h1>
          <div className="cc-date" style={{ maxWidth: 640 }}>{t("rp.intro")}</div>
        </div>
      </div>

      {(ov.pendingEntries || 0) > 0 && (
        <div className="rp-note" role="note">{t("rp.pendingNote").replace("{n}", String(ov.pendingEntries))}{ov.lastApprovedAt ? ` ${t("rp.lastApproval").replace("{date}", fmtDate(ov.lastApprovedAt))}` : ""}</div>
      )}

      {ov.ytd && (
        <div className="cc-kpis">
          <div className="cc-kpi" style={{ cursor: "default" }}><span className="cc-kpi-icon act-tone-green"><Wallet size={20} aria-hidden="true" /></span><span><div className="cc-kpi-label">{t("books.kpi.income")}</div><div className="cc-kpi-value"><Num>{fmtMoney(ov.ytd.income)}</Num></div><div className="cc-kpi-note">{t("rp.ytd")}</div></span></div>
          <div className="cc-kpi" style={{ cursor: "default" }}><span className="cc-kpi-icon act-tone-amber"><Wallet size={20} aria-hidden="true" /></span><span><div className="cc-kpi-label">{t("books.kpi.expenses")}</div><div className="cc-kpi-value"><Num>{fmtMoney(ov.ytd.expenses)}</Num></div><div className="cc-kpi-note">{t("rp.ytd")}</div></span></div>
          <div className="cc-kpi" style={{ cursor: "default" }}><span className={`cc-kpi-icon act-tone-${ov.ytd.net < 0 ? "red" : "teal"}`}><BarChart3 size={20} aria-hidden="true" /></span><span><div className="cc-kpi-label">{t("books.kpi.net")}</div><div className="cc-kpi-value"><Num>{fmtMoney(ov.ytd.net)}</Num></div><div className="cc-kpi-note">{t("rp.ytd")}</div></span></div>
          <div className="cc-kpi" style={{ cursor: "default" }}><span className="cc-kpi-icon act-tone-blue"><Landmark size={20} aria-hidden="true" /></span><span><div className="cc-kpi-label">{t("rp.taxPaid")}</div><div className="cc-kpi-value"><Num>{fmtMoney(ov.salesTaxPaidYtd)}</Num></div><div className="cc-kpi-note"><Num>{ov.salesTaxFilingsYtd}</Num> {t("rp.filingsPaid")}</div></span></div>
        </div>
      )}

      <div className="cc-layout">
        <div>
          <section className="command-panel" style={{ marginBottom: 14 }}>
            <div className="command-panel-header"><div><h2 className="command-panel-title">{t("rp.trend")}</h2><div className="command-panel-note">{t("rp.trendNote")}</div></div></div>
            <div style={{ padding: "12px 16px 16px" }}><TrendChart trend={ov.trend} labels={{ income: t("books.kpi.income"), expenses: t("books.kpi.expenses") }} /></div>
          </section>

          <section className="command-panel" style={{ marginBottom: 14 }}>
            <div className="command-panel-header"><div><h2 className="command-panel-title">{t("rp.make")}</h2><div className="command-panel-note"><Num>{fmtDate(from)}</Num> – <Num>{fmtDate(to)}</Num></div></div></div>
            <div className="rp-periods">
              {periods.map((p) => <button key={p} type="button" className={`cc-tab${period === p ? " on" : ""}`} style={{ marginBottom: 0 }} onClick={() => setPeriod(p)}>{t(`rp.period.${p}`)}</button>)}
              {period === "custom" && (
                <span className="rp-custom">
                  <DateInput value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
                  <span>→</span>
                  <DateInput value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
                </span>
              )}
            </div>
            <div className="rp-cards">
              {cards.map((c) => (
                <article className="rp-card" key={c.key}>
                  <span className="cc-kpi-icon act-tone-teal"><c.Icon size={20} aria-hidden="true" /></span>
                  <div className="rp-card-main"><b>{c.title}</b><small>{c.desc}</small>{(c.key === "pl" || c.key === "bs" || c.key === "st" || c.key === "pr") && ov.lastApprovedAt && <small className="rp-asof">{t("rp.officialAsOf").replace("{date}", fmtDate(ov.lastApprovedAt))}</small>}</div>
                  <div className="rp-card-actions">
                    <button type="button" className="action-button btn-sm" onClick={() => run(() => viewFile(c.path))}><Eye size={13} aria-hidden="true" /> {t("rp.view")}</button>
                    <button type="button" className="ghost-button btn-sm" onClick={() => run(() => downloadFile(c.path, c.file))}><Download size={13} aria-hidden="true" /> {t("rp.download")}</button>
                    <button type="button" className="ghost-button btn-sm" onClick={() => run(() => printFile(c.path))}><Printer size={13} aria-hidden="true" /> {t("rp.print")}</button>
                  </div>
                </article>
              ))}
              {!ov.available.financialStatements && (
                <article className="rp-card locked">
                  <span className="cc-kpi-icon act-tone-grey"><Lock size={20} aria-hidden="true" /></span>
                  <div className="rp-card-main"><b>{t("rp.locked.title")}</b><small>{t("rp.locked.desc")}</small></div>
                </article>
              )}
            </div>
          </section>

          <section className="command-panel" style={{ marginBottom: 14 }}>
            <div className="command-panel-header"><div><h2 className="command-panel-title">{t("rp.taxHistory")}</h2><div className="command-panel-note">{t("rp.taxHistoryNote")}</div></div></div>
            {rows.length === 0 ? <p className="muted" style={{ padding: 16, margin: 0 }}>{t("rp.noTax")}</p> : (
              <div className="table-scroll">
                <table>
                  <thead><tr><th scope="col">{t("rp.col.filing")}</th><th scope="col">{t("dashboard.client.dueLabel")}</th><th scope="col">{t("rp.col.paid")}</th><th scope="col" style={{ textAlign: "end" }}>{t("rp.col.amount")}</th><th scope="col">{t("rp.col.confirmation")}</th></tr></thead>
                  <tbody>
                    {rows.slice(0, 12).map((r) => (
                      <tr key={r.task_id}>
                        <td>{r.task_name}</td>
                        <td className="muted"><Num>{fmtDate(r.agency_due_date) || "—"}</Num></td>
                        <td>{r.paid_date ? <span className="status-pill status-green"><Num>{fmtDate(r.paid_date)}</Num></span> : <span className="status-pill status-amber">{t("rp.unpaid")}</span>}</td>
                        <td style={{ textAlign: "end" }}><Num>{fmtMoney(r.payment_amount)}</Num></td>
                        <td className="muted"><Num>{r.confirmation_number || "—"}</Num></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="command-panel" style={{ marginBottom: 14 }}>
            <div className="command-panel-header">
              <div><h2 className="command-panel-title"><FolderArchive size={14} aria-hidden="true" /> {t("rp.yearEnd")}</h2><div className="command-panel-note">{t("rp.yearEndNote")}</div></div>
              {docYears.length > 0 && <select className="inline-select" value={docYear} onChange={(e) => setDocYear(e.target.value)} aria-label={t("rp.yearEnd")}>{Array.from(new Set([docYear, ...docYears])).sort().reverse().map((y) => <option key={y}>{y}</option>)}</select>}
            </div>
            {yearDocs.length === 0 ? <p className="muted" style={{ padding: 16, margin: 0 }}>{t("rp.yearEndEmpty")}</p> : (
              <div className="rp-folder">
                {grouped.map((g) => (
                  <div key={g.key}>
                    <div className="rp-folder-cat">{t(`rp.cat.${g.key}`)}</div>
                    {g.list.map((d) => (
                      <div className="rp-file" key={d.upload_id}>
                        <FileText size={15} aria-hidden="true" /><span title={d.file_name}>{d.file_name}</span><small><Num>{fmtDate(d.uploaded_at)}</Num></small>
                        <button type="button" className="ghost-button btn-sm" onClick={() => run(() => viewFile(`/documents/uploads/${d.upload_id}/download`))}>{t("rp.view")}</button>
                        <button type="button" className="ghost-button btn-sm" onClick={() => run(() => downloadFile(`/documents/uploads/${d.upload_id}/download`, d.file_name))}>{t("rp.download")}</button>
                      </div>
                    ))}
                  </div>
                ))}
                <div style={{ padding: "8px 16px 14px" }}><button type="button" className="action-button btn-sm" onClick={downloadAll}><Download size={13} aria-hidden="true" /> {t("rp.downloadAll")} (<Num>{yearDocs.length}</Num>)</button></div>
              </div>
            )}
          </section>
        </div>

        <aside className="cc-rail">
          <div className="command-panel">
            <div className="command-panel-header"><div><h2 className="command-panel-title"><CalendarClock size={14} aria-hidden="true" /> {t("rp.keyDates")}</h2><div className="command-panel-note">{t("rp.keyDatesNote")}</div></div></div>
            {!keyDates || keyDates.upcoming.length === 0
              ? <p className="muted" style={{ padding: 16, margin: 0 }}>{t("rp.noKeyDates")}</p>
              : <div className="rp-keydates">{keyDates.upcoming.map((k, i) => {
                  const dd = daysUntil(k.dueDate);
                  return (
                    <div key={i} className="rp-keydate">
                      <div><b>{k.title}</b><small>{k.period}</small></div>
                      <div className="rp-keydate-when"><Num>{fmtDate(k.dueDate)}</Num>{dd !== null && <span className={`status-pill status-${dd <= 7 ? "amber" : "blue"}`}>{dd === 0 ? t("dash.dueToday") : t("dash.daysLeft").replace("{n}", String(dd))}</span>}</div>
                    </div>
                  );
                })}</div>}
            {keyDates && keyDates.filed.length > 0 && <div className="rp-filed"><small>{t("rp.recentlyFiled")}</small>{keyDates.filed.slice(0, 3).map((k, i) => <div key={i}>✓ {k.title} · {k.period}</div>)}</div>}
          </div>
          {ov.ytd && ov.ytd.topExpenses.length > 0 && (
            <div className="command-panel">
              <div className="command-panel-header"><div><h2 className="command-panel-title">{t("rp.topExpenses")}</h2><div className="command-panel-note">{t("rp.ytd")}</div></div></div>
              <div className="rp-bars">
                {ov.ytd.topExpenses.map((e) => (
                  <div key={e.account} className="rp-hbar">
                    <div><span>{e.account}</span><b><Num>{fmtMoney(e.amount)}</Num></b></div>
                    <i style={{ width: `${Math.max(3, (e.amount / maxExp) * 100)}%` }} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="command-panel">
            <div className="command-panel-header"><div><h2 className="command-panel-title">{t("rp.more")}</h2></div></div>
            <Link to="/documents" className="cc-quick"><span className="cc-kpi-icon act-tone-amber"><FileText size={18} aria-hidden="true" /></span><span><b>{t("rp.docs")}</b><small>{t("rp.docsSub")}</small></span></Link>
            <Link to="/my-assets" className="cc-quick"><span className="cc-kpi-icon act-tone-blue"><Landmark size={18} aria-hidden="true" /></span><span><b>{t("nav.myAssets")}</b><small>{t("rp.assetsSub")}</small></span></Link>
            <Link to="/billing" className="cc-quick"><span className="cc-kpi-icon act-tone-teal"><Receipt size={18} aria-hidden="true" /></span><span><b>{t("dash.quick.invoices")}</b><small>{t("dash.quick.invoicesSub")}</small></span></Link>
          </div>
          <p className="muted" style={{ fontSize: 11.5, margin: "0 2px" }}>{lang === "ar" ? t("rp.disclaimer") : t("rp.disclaimer")}</p>
        </aside>
      </div>
    </div>
  );
}
