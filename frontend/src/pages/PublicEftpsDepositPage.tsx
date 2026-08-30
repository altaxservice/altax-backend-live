import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError, resolveFileUrl } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { PublicPageShell } from "../components/PublicPageShell";

interface PublicEftpsEmployeeLine {
  employee_name: string; federal_income_tax: number; social_security: number; medicare: number; subtotal: number;
}
interface PublicEftpsDeposit {
  deposit_id: string; client_name: string; period_start: string; period_end: string;
  filing_date: string; payment_date: string;
  federal_income_tax_total: number; social_security_total: number; medicare_total: number; total_amount: number;
  acknowledged_at: string | null; employees: PublicEftpsEmployeeLine[];
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
 * Public, no-login EFTPS deposit report view + acknowledge — the destination of
 * the "View & Acknowledge Report" link in the Save & Send email. Same shape as
 * PublicContractPage: gated by the opaque token in the URL, no app chrome.
 */
export function PublicEftpsDepositPage() {
  const { token } = useParams<{ token: string }>();
  const [deposit, setDeposit] = useState<PublicEftpsDeposit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);

  function load() {
    if (!token) return;
    api.get<{ deposit: PublicEftpsDeposit }>(`/public/eftps-deposits/${token}`)
      .then((r) => setDeposit(r.deposit))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this report."));
  }
  useEffect(load, [token]);

  async function handleAcknowledge() {
    if (!token) return;
    setAcknowledging(true);
    try {
      await api.post(`/public/eftps-deposits/${token}/acknowledge`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record your acknowledgement.");
    } finally {
      setAcknowledging(false);
    }
  }

  const pageStyle = { maxWidth: 720, margin: "40px auto", padding: "0 20px", fontFamily: "inherit" };

  if (error) return <PublicPageShell><div style={pageStyle}><ErrorBanner error={error} /></div></PublicPageShell>;
  if (!deposit) return <PublicPageShell><div style={pageStyle}><div className="spinner-wrap">Loading…</div></div></PublicPageShell>;

  return (
    <PublicPageShell>
      <div style={pageStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: "var(--muted)" }}>{deposit.client_name}</div>
            <h1 style={{ fontSize: 22, margin: "4px 0 0" }}>Federal Tax Deposit Report</h1>
          </div>
          <a className="btn" href={resolveFileUrl(`/public/eftps-deposits/${token}/pdf`)} target="_blank" rel="noopener noreferrer">Download PDF</a>
        </div>
        <p className="muted" style={{ fontSize: 13, margin: "8px 0 20px" }}>
          Period {fmtDate(deposit.period_start)} – {fmtDate(deposit.period_end)}
        </p>

        <div className="card" style={{ marginBottom: 20 }}>
          <table style={{ width: "100%" }}>
            <tbody>
              <tr><td className="muted">Filed Date</td><td style={{ textAlign: "right" }}>{fmtDate(deposit.filing_date)}</td></tr>
              <tr><td className="muted">Payment Date</td><td style={{ textAlign: "right" }}>{fmtDate(deposit.payment_date)}</td></tr>
              <tr><td className="muted">Federal Income Tax</td><td style={{ textAlign: "right" }}>{money(deposit.federal_income_tax_total)}</td></tr>
              <tr><td className="muted">Social Security</td><td style={{ textAlign: "right" }}>{money(deposit.social_security_total)}</td></tr>
              <tr><td className="muted">Medicare</td><td style={{ textAlign: "right" }}>{money(deposit.medicare_total)}</td></tr>
              <tr><td style={{ fontWeight: 700 }}>Total Federal Deposit</td><td style={{ textAlign: "right", fontWeight: 700 }}>{money(deposit.total_amount)}</td></tr>
            </tbody>
          </table>
        </div>

        <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>By Employee</h2>
        <div className="card" style={{ marginBottom: 20, padding: 0, overflow: "hidden" }}>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Employee</th><th style={{ textAlign: "right" }}>Federal Income Tax</th><th style={{ textAlign: "right" }}>Social Security</th><th style={{ textAlign: "right" }}>Medicare</th><th style={{ textAlign: "right" }}>Total</th></tr></thead>
              <tbody>
                {deposit.employees.map((e, i) => (
                  <tr key={i}>
                    <td>{e.employee_name}</td>
                    <td style={{ textAlign: "right" }}>{money(e.federal_income_tax)}</td>
                    <td style={{ textAlign: "right" }}>{money(e.social_security)}</td>
                    <td style={{ textAlign: "right" }}>{money(e.medicare)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{money(e.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="muted" style={{ fontSize: 12.5, marginBottom: 20 }}>
          This report covers federal deposit amounts only — state withholding and unemployment insurance are covered separately in your quarterly payroll report.
        </p>

        {deposit.acknowledged_at ? (
          <div className="card" style={{ borderColor: "var(--teal)" }}>
            <strong>Acknowledged.</strong>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>You confirmed receipt of this report.</div>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={handleAcknowledge} disabled={acknowledging}>
            {acknowledging ? "Recording…" : "Acknowledge This Report"}
          </button>
        )}
      </div>
    </PublicPageShell>
  );
}
