import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useLanguage, Num } from "../context/LanguageContext";
import { useSelectedBusiness } from "../context/SelectedBusinessContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { fmtMoney } from "../utils/clientFlags";

interface BusinessPl {
  clientId: string; clientName: string;
  totalIncome: number; totalExpenses: number; netIncome: number;
  trend: { label: string; income: number; expenses: number }[];
}

/** Tiny inline bar-pair sparkline — income vs. expenses per trailing month, no charting library needed for 6 data points. */
function TrendBars({ trend }: { trend: BusinessPl["trend"] }) {
  const max = Math.max(1, ...trend.flatMap((m) => [m.income, m.expenses]));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 56, marginTop: 10 }}>
      {trend.map((m) => (
        <div key={m.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 40, width: "100%", justifyContent: "center" }}>
            <div style={{ width: 6, height: `${Math.max(2, (m.income / max) * 40)}px`, background: "var(--teal)", borderRadius: 2 }} title={`Income: ${fmtMoney(m.income)}`} />
            <div style={{ width: 6, height: `${Math.max(2, (m.expenses / max) * 40)}px`, background: "var(--amber)", borderRadius: 2 }} title={`Expenses: ${fmtMoney(m.expenses)}`} />
          </div>
          <span className="muted" style={{ fontSize: 10 }}>{m.label}</span>
        </div>
      ))}
    </div>
  );
}

export function CrossBusinessDashboardPage() {
  const { t, dir } = useLanguage();
  const navigate = useNavigate();
  const { setSelectedBusiness } = useSelectedBusiness();
  const [businesses, setBusinesses] = useState<BusinessPl[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ businesses: BusinessPl[] }>("/accounting/client-books/cross-business-pl")
      .then((r) => setBusinesses(r.businesses))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your businesses."));
  }, []);

  function openBusiness(b: BusinessPl) {
    setSelectedBusiness(b.clientId, b.clientName);
    navigate("/my-books");
  }

  if (error) return <ErrorBanner error={error} />;
  if (!businesses) return <div className="spinner-wrap">{t("books.common.loading")}</div>;

  return (
    <div dir={dir}>
      <p className="muted" style={{ margin: "0 0 20px", maxWidth: 760 }}>{t("books.cross.intro")}</p>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
        {businesses.map((b) => (
          <div key={b.clientId} className="command-panel">
            <div className="command-panel-header"><h2 className="command-panel-title">{b.clientName}</h2></div>
            <div style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, color: "var(--teal)" }}>
                <span>{t("books.cross.netIncome")}</span>
                <strong><Num>{fmtMoney(b.netIncome)}</Num></strong>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {t("books.pl.income")}: <Num>{fmtMoney(b.totalIncome)}</Num> · {t("books.pl.expenses")}: <Num>{fmtMoney(b.totalExpenses)}</Num>
              </div>
              <TrendBars trend={b.trend} />
              <button type="button" className="btn btn-sm btn-primary" style={{ marginTop: 14, width: "100%" }} onClick={() => openBusiness(b)}>
                {t("books.cross.viewBooks")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
