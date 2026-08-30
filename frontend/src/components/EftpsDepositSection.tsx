import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { fileToBase64 } from "../utils/file";
import { FileDropInput } from "./FileDropInput";
import { ErrorBanner } from "./ErrorBanner";
import { useToast } from "./Toast";

interface EftpsEmployeeBreakdown {
  employeeName: string; federalIncomeTax: number; socialSecurity: number; medicare: number; subtotal: number;
}
interface EftpsComputation {
  employees: EftpsEmployeeBreakdown[];
  federalIncomeTaxTotal: number; socialSecurityTotal: number; medicareTotal: number; totalAmount: number;
  drakeTotal941: number | null; reconciliationStatus: "Matched" | "Mismatch"; reconciliationDifference: number | null;
}
interface EftpsDepositHistoryRow {
  deposit_id: string; period_start: string; period_end: string; due_date: string;
  filing_date: string | null; payment_date: string | null; total_amount: number; status: string; reconciliation_status: string;
}

function money(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}
function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(`${v.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function lastDayOfMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}
function dateStr(year: number, month0: number, day: number): string {
  return new Date(Date.UTC(year, month0, day)).toISOString().slice(0, 10);
}

/** Derives period start/end (the full calendar month) and the EFTPS due date (the 15th of the following month) from a "YYYY-MM" month picker value — matches computeDuePeriod's own monthly convention (rules.routes.ts) so this workflow and the compliance calendar never disagree on what "due" means. */
function periodFromMonthValue(monthValue: string): { periodStart: string; periodEnd: string; dueDate: string; periodLabel: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(monthValue);
  if (!m) return null;
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  const periodStart = dateStr(year, month0, 1);
  const periodEnd = dateStr(year, month0, lastDayOfMonth(year, month0));
  const dueMonth0 = month0 === 11 ? 0 : month0 + 1;
  const dueYear = month0 === 11 ? year + 1 : year;
  const dueDate = dateStr(dueYear, dueMonth0, Math.min(15, lastDayOfMonth(dueYear, dueMonth0)));
  const periodLabel = new Date(Date.UTC(year, month0, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return { periodStart, periodEnd, dueDate, periodLabel };
}

/** Defaults to the most recently CLOSED calendar month — the period an EFTPS deposit would actually be due for right now. */
function defaultMonthValue(): string {
  const now = new Date();
  const prevMonth0 = now.getUTCMonth() === 0 ? 11 : now.getUTCMonth() - 1;
  const prevYear = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  return `${prevYear}-${String(prevMonth0 + 1).padStart(2, "0")}`;
}

export function EftpsDepositSection({ clientId }: { clientId: string }) {
  const toast = useToast();
  const [monthValue, setMonthValue] = useState(defaultMonthValue());
  const [taxLiabilityFile, setTaxLiabilityFile] = useState<File | null>(null);
  const [payrollWagesFile, setPayrollWagesFile] = useState<File | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [computation, setComputation] = useState<EftpsComputation | null>(null);
  const [filingDate, setFilingDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentDate, setPaymentDate] = useState("");
  const [saving, setSaving] = useState<"close" | "send" | null>(null);
  const [history, setHistory] = useState<EftpsDepositHistoryRow[] | null>(null);

  const period = periodFromMonthValue(monthValue);

  function loadHistory() {
    api.get<{ deposits: EftpsDepositHistoryRow[] }>(`/eftps-deposits?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => setHistory(r.deposits))
      .catch(() => setHistory([]));
  }
  useEffect(loadHistory, [clientId]);

  useEffect(() => {
    if (period && !paymentDate) setPaymentDate(period.dueDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period?.dueDate]);

  async function handlePreview() {
    if (!period) { setError("Select a period."); return; }
    if (!taxLiabilityFile || !payrollWagesFile) { setError("Both files are required."); return; }
    setError(null);
    setPreviewing(true);
    try {
      const [taxLiabilityFileBase64, payrollWagesFileBase64] = await Promise.all([
        fileToBase64(taxLiabilityFile), fileToBase64(payrollWagesFile),
      ]);
      const res = await api.post<{ computation: EftpsComputation }>("/eftps-deposits/preview", {
        clientId, taxLiabilityFileBase64, payrollWagesFileBase64,
      });
      setComputation(res.computation);
      setPaymentDate(period.dueDate);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not process these files.");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSave(action: "close" | "send") {
    if (!period || !computation) return;
    if (!filingDate || !paymentDate) { setError("Filing date and payment date are both required."); return; }
    setError(null);
    setSaving(action);
    try {
      await api.post("/eftps-deposits", {
        clientId, periodStart: period.periodStart, periodEnd: period.periodEnd, dueDate: period.dueDate,
        periodLabel: period.periodLabel, filingDate, paymentDate, action,
        employees: computation.employees, federalIncomeTaxTotal: computation.federalIncomeTaxTotal,
        socialSecurityTotal: computation.socialSecurityTotal, medicareTotal: computation.medicareTotal,
        totalAmount: computation.totalAmount, reconciliationStatus: computation.reconciliationStatus,
      });
      toast(action === "send" ? "Deposit saved and report sent to the client." : "Deposit saved.");
      setComputation(null);
      setTaxLiabilityFile(null);
      setPayrollWagesFile(null);
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this deposit.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <p className="muted" style={{ fontSize: 13, maxWidth: 640, marginBottom: 16 }}>
        Import Drake's "Tax Liability by Check Date" and "Payroll Wages" reports for a period to compute the exact
        federal (941) deposit — Federal Income Tax, Social Security, and Medicare only, never state withholding or
        unemployment insurance.
      </p>
      {error && <ErrorBanner error={error} />}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="eftps-month">Deposit Period</label>
            <input id="eftps-month" type="month" value={monthValue} onChange={(e) => { setMonthValue(e.target.value); setComputation(null); setPaymentDate(""); }} />
          </div>
          {period && (
            <div className="field">
              <label>Due Date</label>
              <input value={fmtDate(period.dueDate)} disabled />
            </div>
          )}
        </div>

        <div className="form-grid" style={{ marginTop: 4 }}>
          <div className="field">
            <label>Tax Liability by Check Date</label>
            <FileDropInput file={taxLiabilityFile} onChange={setTaxLiabilityFile} accept=".xls,.xlsx" hint="Drake report" />
          </div>
          <div className="field">
            <label>Payroll Wages</label>
            <FileDropInput file={payrollWagesFile} onChange={setPayrollWagesFile} accept=".xls,.xlsx" hint="Drake report" />
          </div>
        </div>

        <button className="btn btn-primary" onClick={handlePreview} disabled={previewing || !taxLiabilityFile || !payrollWagesFile} style={{ marginTop: 8 }}>
          {previewing ? "Processing…" : "Preview"}
        </button>
      </div>

      {computation && (
        <div className="card" style={{ marginBottom: 16 }}>
          {computation.reconciliationStatus === "Mismatch" ? (
            <div className="card" style={{ borderColor: "var(--red)", marginBottom: 12, padding: 10 }}>
              <strong style={{ color: "var(--red)" }}>Reconciliation mismatch</strong>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Computed total {money(computation.totalAmount)} vs. Drake's own 941 Total {money(computation.drakeTotal941)}
                {computation.reconciliationDifference !== null && ` (difference: ${money(Math.abs(computation.reconciliationDifference))})`}.
                Please review both files before saving.
              </div>
            </div>
          ) : (
            computation.drakeTotal941 !== null && (
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
                Reconciled against Drake's own 941 Total ({money(computation.drakeTotal941)}) — within normal rounding tolerance.
              </div>
            )
          )}

          <table style={{ width: "100%", marginBottom: 16 }}>
            <tbody>
              <tr><td className="muted">Federal Income Tax</td><td style={{ textAlign: "right" }}>{money(computation.federalIncomeTaxTotal)}</td></tr>
              <tr><td className="muted">Social Security</td><td style={{ textAlign: "right" }}>{money(computation.socialSecurityTotal)}</td></tr>
              <tr><td className="muted">Medicare</td><td style={{ textAlign: "right" }}>{money(computation.medicareTotal)}</td></tr>
              <tr><td style={{ fontWeight: 700 }}>Total Federal Deposit</td><td style={{ textAlign: "right", fontWeight: 700 }}>{money(computation.totalAmount)}</td></tr>
            </tbody>
          </table>

          <div className="table-scroll" style={{ marginBottom: 16 }}>
            <table>
              <thead><tr><th>Employee</th><th style={{ textAlign: "right" }}>Federal Income Tax</th><th style={{ textAlign: "right" }}>Social Security</th><th style={{ textAlign: "right" }}>Medicare</th><th style={{ textAlign: "right" }}>Total</th></tr></thead>
              <tbody>
                {computation.employees.map((e, i) => (
                  <tr key={i}>
                    <td>{e.employeeName}</td>
                    <td style={{ textAlign: "right" }}>{money(e.federalIncomeTax)}</td>
                    <td style={{ textAlign: "right" }}>{money(e.socialSecurity)}</td>
                    <td style={{ textAlign: "right" }}>{money(e.medicare)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{money(e.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
            Pay this amount on EFTPS's website, then record the dates below.
          </p>
          <div className="form-grid">
            <div className="field"><label htmlFor="eftps-filed">Filing Date</label><input id="eftps-filed" type="date" value={filingDate} onChange={(e) => setFilingDate(e.target.value)} /></div>
            <div className="field"><label htmlFor="eftps-paid">Payment Date</label><input id="eftps-paid" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn" onClick={() => handleSave("close")} disabled={saving !== null}>{saving === "close" ? "Saving…" : "Save and Close"}</button>
            <button className="btn btn-primary" onClick={() => handleSave("send")} disabled={saving !== null}>{saving === "send" ? "Saving…" : "Save and Send"}</button>
          </div>
        </div>
      )}

      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>History</h3>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Period</th><th>Due</th><th>Filed</th><th>Paid</th><th style={{ textAlign: "right" }}>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {(history || []).map((d) => (
                <tr key={d.deposit_id}>
                  <td>{fmtDate(d.period_start)} – {fmtDate(d.period_end)}</td>
                  <td>{fmtDate(d.due_date)}</td>
                  <td>{fmtDate(d.filing_date)}</td>
                  <td>{fmtDate(d.payment_date)}</td>
                  <td style={{ textAlign: "right" }}>{money(d.total_amount)}</td>
                  <td>{d.status}{d.reconciliation_status === "Mismatch" ? " (Mismatch)" : ""}</td>
                </tr>
              ))}
              {history && !history.length && (
                <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 20 }}>No EFTPS deposits recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
