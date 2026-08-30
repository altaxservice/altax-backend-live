import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError, resolveFileUrl } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { PublicPageShell } from "../components/PublicPageShell";

interface PublicForm941Filing {
  client_name: string; period_start: string; period_end: string; quarter: number;
  filed_date: string; paid_date: string | null;
  gross_liability: number; eftps_deposits_applied: number; balance_due: number;
  acknowledged_at: string | null;
}

function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function money(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

/**
 * Public, no-login Form 941 filing view + acknowledge — the destination of
 * the "View & Acknowledge Report" link in the Save & Send email. Same shape
 * as PublicMdFilingPage/PublicEftpsDepositPage, including a real PDF link.
 */
export function PublicForm941Page() {
  const { token } = useParams<{ token: string }>();
  const [filing, setFiling] = useState<PublicForm941Filing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);

  function load() {
    if (!token) return;
    api.get<{ filing: PublicForm941Filing }>(`/public/form941/${token}`)
      .then((r) => setFiling(r.filing))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this filing."));
  }
  useEffect(load, [token]);

  async function handleAcknowledge() {
    if (!token) return;
    setAcknowledging(true);
    try {
      await api.post(`/public/form941/${token}/acknowledge`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record your acknowledgement.");
    } finally {
      setAcknowledging(false);
    }
  }

  const pageStyle = { maxWidth: 640, margin: "40px auto", padding: "0 20px", fontFamily: "inherit" };

  if (error) return <PublicPageShell><div style={pageStyle}><ErrorBanner error={error} /></div></PublicPageShell>;
  if (!filing) return <PublicPageShell><div style={pageStyle}><div className="spinner-wrap">Loading…</div></div></PublicPageShell>;

  return (
    <PublicPageShell>
      <div style={pageStyle}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12,
          borderLeft: "4px solid var(--teal)", paddingLeft: 16, marginBottom: 4,
        }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: "var(--teal)", fontWeight: 700 }}>{filing.client_name}</div>
            <h1 style={{ fontSize: 24, margin: "4px 0 0", fontWeight: 800, letterSpacing: -0.3 }}>Federal Payroll Tax (Form 941)</h1>
            <p className="muted" style={{ fontSize: 13.5, margin: "6px 0 0" }}>Q{filing.quarter} {String(filing.period_start).slice(0, 4)}</p>
          </div>
          <a className="btn" href={resolveFileUrl(`/public/form941/${token}/pdf`)} target="_blank" rel="noopener noreferrer">Download PDF</a>
        </div>

        <div className="card" style={{ marginTop: 20, marginBottom: 20, overflow: "hidden", padding: 0 }}>
          <div style={{ background: "var(--surface-2, #f0f7f6)", padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--muted)", fontWeight: 700, marginBottom: 4 }}>Balance Due</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "var(--teal)" }}>{money(filing.balance_due)}</div>
          </div>
          <table style={{ width: "100%" }}>
            <tbody>
              <tr><td className="muted" style={{ padding: "10px 18px" }}>Filed Date</td><td style={{ textAlign: "right", padding: "10px 18px" }}>{fmtDate(filing.filed_date)}</td></tr>
              <tr><td className="muted" style={{ padding: "10px 18px" }}>Payment Date</td><td style={{ textAlign: "right", padding: "10px 18px" }}>{filing.paid_date ? fmtDate(filing.paid_date) : <span className="muted">Pending</span>}</td></tr>
              <tr style={{ borderTop: "1px solid var(--line)" }}><td className="muted" style={{ padding: "10px 18px" }}>Gross Liability</td><td style={{ textAlign: "right", padding: "10px 18px" }}>{money(filing.gross_liability)}</td></tr>
              <tr><td className="muted" style={{ padding: "10px 18px" }}>EFTPS Deposits Applied</td><td style={{ textAlign: "right", padding: "10px 18px" }}>−{money(filing.eftps_deposits_applied)}</td></tr>
            </tbody>
          </table>
        </div>

        {filing.acknowledged_at ? (
          <div className="card" style={{ borderColor: "var(--teal)", background: "var(--surface-2, #f0f7f6)" }}>
            <strong style={{ color: "var(--teal)" }}>✓ Acknowledged</strong>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>You confirmed receipt of this filing.</div>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={handleAcknowledge} disabled={acknowledging}>
            {acknowledging ? "Recording…" : "Acknowledge This Filing"}
          </button>
        )}
      </div>
    </PublicPageShell>
  );
}
