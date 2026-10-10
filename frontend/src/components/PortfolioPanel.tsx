import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useLanguage, Num } from "../context/LanguageContext";
import { useSelectedBusiness } from "../context/SelectedBusinessContext";
import { fmtMoney } from "../utils/clientFlags";
import { fmtDateOnly as fmtDate } from "../utils/date";

interface Biz {
  clientId: string; clientName: string; attention: number;
  needs: { docs: number; docsOverdue: number; waiting: number; noticesRed: number; noticesAmber: number; topNotice: { labelEn: string; labelAr: string; color: "red" | "amber" | "green" } | null };
  money: { invoiceBalance: number; invoiceCount: number; invoiceOverdue: number; taxDue: number; taxCount: number; taxOverdue: number };
  nextDeadline: { date: string; name: string; days: number | null } | null;
  books: { lastSaleDate: string | null; salesGapDays: number | null; pendingCount: number; monthNet: number | null; monthIncome: number | null; monthExpenses: number | null };
}

const fill = (s: string, vars: Record<string, string>) => Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), s);

/**
 * "All my businesses" — for an owner with several businesses on one login: combined totals up top, then one card per
 * business sorted by what needs attention first. Switching is one click and keeps the owner on the dashboard.
 */
export function PortfolioPanel() {
  const { t, lang, dir } = useLanguage();
  const navigate = useNavigate();
  const { clientId: activeId, setSelectedBusiness } = useSelectedBusiness();
  const [rows, setRows] = useState<Biz[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<{ businesses: Biz[] }>("/portfolio/mine").then((r) => { if (!cancelled) setRows(r.businesses); }).catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, []);

  if (!rows || rows.length < 2) return null;

  const sorted = [...rows].sort((a, b) => b.attention - a.attention || a.clientName.localeCompare(b.clientName));
  const combinedNet = rows.reduce((s, b) => s + (b.books.monthNet || 0), 0);
  const combinedOwed = rows.reduce((s, b) => s + b.money.invoiceBalance + b.money.taxDue, 0);
  const needing = rows.filter((b) => b.attention > 0).length;
  const unlogged = rows.filter((b) => (b.books.salesGapDays ?? 0) > 3).length;
  const monthName = new Date().toLocaleDateString(lang === "ar" ? "ar" : undefined, { month: "long" });

  function switchTo(b: Biz, then?: string) {
    setSelectedBusiness(b.clientId, b.clientName);
    if (then) navigate(then);
    else window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <section className="pf" dir={dir} aria-label={t("pf.title")}>
      <div className="pf-head">
        <h2>{t("pf.title")}</h2>
        <span>{fill(t("pf.count"), { n: String(rows.length) })}</span>
      </div>
      <div className="pf-totals">
        <div><small>{fill(t("pf.combinedNet"), { month: monthName })}</small><b className={combinedNet < 0 ? "neg" : ""}><Num>{fmtMoney(combinedNet)}</Num></b></div>
        <div><small>{t("pf.totalOwed")}</small><b><Num>{fmtMoney(combinedOwed)}</Num></b></div>
        <div><small>{t("pf.needAttention")}</small><b className={needing ? "warn" : "ok"}><Num>{needing}</Num> <span>/ <Num>{rows.length}</Num></span></b></div>
        <div><small>{t("pf.salesBehind")}</small><b className={unlogged ? "warn" : "ok"}><Num>{unlogged}</Num></b></div>
      </div>
      <div className="pf-grid">
        {sorted.map((b) => {
          const isActive = b.clientId === activeId;
          const chips: { text: string; tone: "red" | "amber" | "blue" }[] = [];
          if (b.needs.topNotice && b.needs.topNotice.color !== "green") chips.push({ text: lang === "ar" ? b.needs.topNotice.labelAr : b.needs.topNotice.labelEn, tone: b.needs.topNotice.color === "red" ? "red" : "amber" });
          if (b.needs.docs > 0) chips.push({ text: fill(t("pf.docs"), { n: String(b.needs.docs) }), tone: b.needs.docsOverdue ? "red" : "amber" });
          const overdueMoney = b.money.invoiceOverdue + b.money.taxOverdue;
          if (overdueMoney > 0) chips.push({ text: fill(t("pf.overdue"), { n: String(overdueMoney) }), tone: "red" });
          else if (b.money.invoiceCount + b.money.taxCount > 0) chips.push({ text: fill(t("pf.unpaid"), { n: String(b.money.invoiceCount + b.money.taxCount) }), tone: "amber" });
          if (b.needs.waiting > 0) chips.push({ text: fill(t("pf.waiting"), { n: String(b.needs.waiting) }), tone: "amber" });
          if ((b.books.salesGapDays ?? 0) > 3) chips.push({ text: fill(t("pf.salesGap"), { n: String(b.books.salesGapDays) }), tone: "blue" });
          const dl = b.nextDeadline;
          const dlText = dl ? (dl.days === null ? "" : dl.days < 0 ? fill(t("dash.overdueDays"), { n: String(-dl.days) }) : dl.days === 0 ? t("dash.dueToday") : fill(t("dash.daysLeft"), { n: String(dl.days) })) : "";
          return (
            <article key={b.clientId} className={`pf-card${isActive ? " active" : ""}${b.attention === 0 ? " calm" : ""}`}>
              <header>
                <h3>{b.clientName}</h3>
                {isActive && <span className="pf-viewing">{t("pf.viewing")}</span>}
              </header>
              <div className="pf-chips">
                {chips.length === 0 ? <span className="pf-chip green">{t("pf.allSet")}</span> : chips.slice(0, 4).map((c, i) => <span key={i} className={`pf-chip ${c.tone}`}>{c.text}</span>)}
              </div>
              <dl className="pf-facts">
                <div><dt>{fill(t("pf.netMonth"), { month: monthName })}</dt><dd className={(b.books.monthNet ?? 0) < 0 ? "neg" : ""}><Num>{b.books.monthNet === null ? "—" : fmtMoney(b.books.monthNet)}</Num></dd></div>
                <div><dt>{t("pf.owes")}</dt><dd><Num>{fmtMoney(b.money.invoiceBalance + b.money.taxDue)}</Num></dd></div>
              </dl>
              {dl && <div className="pf-deadline"><span>{dl.name}</span><b><Num>{fmtDate(dl.date)}</Num>{dlText ? ` · ${dlText}` : ""}</b></div>}
              <footer>
                {isActive
                  ? <button type="button" className="ghost-button btn-sm" onClick={() => navigate("/my-books")}>{t("pf.openBooks")}</button>
                  : <button type="button" className="action-button btn-sm" onClick={() => switchTo(b)}>{t("pf.switch")}</button>}
                {!isActive && <button type="button" className="ghost-button btn-sm" onClick={() => switchTo(b, "/my-books")}>{t("pf.openBooks")}</button>}
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}
