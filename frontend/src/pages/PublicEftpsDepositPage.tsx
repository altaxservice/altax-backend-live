import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError, resolveFileUrl } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { PublicPageShell } from "../components/PublicPageShell";

interface PublicEftpsEmployeeLine {
  employee_name: string; federal_income_tax: number; social_security: number; medicare: number; subtotal: number;
}
interface PublicEftpsDeposit {
  deposit_id: string; client_name: string; period_start: string; period_end: string; due_date: string;
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
function toUtcCompact(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
/** Matches src/common/calendarLinks.ts's buildGoogleCalendarUrl exactly — kept
 * as a small standalone copy here since the frontend can't import backend code. */
function googleCalendarUrl(dueDate: string, clientName: string, totalAmount: number, periodLabel: string): string | null {
  const start = new Date(`${String(dueDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `EFTPS Federal Tax Deposit Due — ${clientName}`,
    dates: `${toUtcCompact(start.toISOString())}/${toUtcCompact(end.toISOString())}`,
    details: `Federal tax deposit of ${money(totalAmount)} due for ${periodLabel}. Pay on EFTPS's website.`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
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

  const periodLabel = `${fmtDate(deposit.period_start)} – ${fmtDate(deposit.period_end)}`;
  const calendarUrl = deposit.due_date ? googleCalendarUrl(deposit.due_date, deposit.client_name, deposit.total_amount, periodLabel) : null;

  return (
    <PublicPageShell>
      <div style={pageStyle}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12,
          borderLeft: "4px solid var(--teal)", paddingLeft: 16, marginBottom: 4,
        }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: "var(--teal)", fontWeight: 700 }}>{deposit.client_name}</div>
            <h1 style={{ fontSize: 24, margin: "4px 0 0", fontWeight: 800, letterSpacing: -0.3 }}>Federal Tax Deposit Report</h1>
            <p className="muted" style={{ fontSize: 13.5, margin: "6px 0 0" }}>Period {periodLabel}</p>
          </div>
          <a className="btn" href={resolveFileUrl(`/public/eftps-deposits/${token}/pdf`)} target="_blank" rel="noopener noreferrer">Download PDF</a>
        </div>

        <div className="card" style={{ marginTop: 20, marginBottom: 20, overflow: "hidden", padding: 0 }}>
          <div style={{ background: "var(--surface-2, #f0f7f6)", padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--muted)", fontWeight: 700, marginBottom: 4 }}>Total Federal Deposit</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "var(--teal)" }}>{money(deposit.total_amount)}</div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 18px" }}>
            <span className="muted">Filed Date</span>
            <span style={{ textAlign: "right" }}>{fmtDate(deposit.filing_date)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 18px" }}>
            <span className="muted">Due Date</span>
            <span style={{ textAlign: "right" }}>{fmtDate(deposit.due_date)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 18px" }}>
            <span className="muted">Payment Date</span>
            <span style={{ textAlign: "right" }}>{deposit.payment_date ? fmtDate(deposit.payment_date) : <span className="muted">Pending</span>}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 18px", borderTop: "1px solid var(--line)" }}>
            <span className="muted">Federal Income Tax</span>
            <span style={{ textAlign: "right" }}>{money(deposit.federal_income_tax_total)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 18px" }}>
            <span className="muted">Social Security</span>
            <span style={{ textAlign: "right" }}>{money(deposit.social_security_total)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 18px" }}>
            <span className="muted">Medicare</span>
            <span style={{ textAlign: "right" }}>{money(deposit.medicare_total)}</span>
          </div>
        </div>

        {calendarUrl && (
          <a href={calendarUrl} target="_blank" rel="noopener noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 20, padding: "8px 16px",
              borderRadius: 8, background: "var(--teal)", color: "#fff", fontSize: 13, fontWeight: 700, textDecoration: "none",
            }}>
            📅 Add Due Date to Calendar
          </a>
        )}

        <h2 style={{ fontSize: 15, margin: "0 0 8px", fontWeight: 700 }}>By Employee</h2>
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
          <div className="card" style={{ borderColor: "var(--teal)", background: "var(--surface-2, #f0f7f6)" }}>
            <strong style={{ color: "var(--teal)" }}>✓ Acknowledged</strong>
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
