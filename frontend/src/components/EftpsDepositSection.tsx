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
interface PaycheckPreviewRow {
  employeeName: string; payDate: string; checkNumber?: string;
  federalWithheld?: number; socialSecurityWithheld?: number; medicareWithheld?: number;
  action: "create" | "duplicate";
}
interface TaxLiabilityPreview {
  range: { start: string; end: string };
  summary: { federalIncomeTax: number; socialSecurity: number; medicare: number; total941: number };
  action: "create" | "duplicate";
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
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function firstOfMonth(monthsBack: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - monthsBack, 1);
  return d.toISOString().slice(0, 10);
}
function lastOfMonth(monthsBack: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - monthsBack + 1, 0);
  return d.toISOString().slice(0, 10);
}
/** Suggests the 15th of the month after periodEnd — EFTPS's standard monthly due date for these clients — still fully editable. */
function suggestDueDate(periodEnd: string): string {
  const d = new Date(`${periodEnd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  const due = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 15));
  return due.toISOString().slice(0, 10);
}

const PERIOD_PRESETS = [
  { label: "This month", start: () => firstOfMonth(0), end: () => lastOfMonth(0) },
  { label: "Last month", start: () => firstOfMonth(1), end: () => lastOfMonth(1) },
  { label: "Last 90 days", start: () => daysAgo(90), end: () => todayStr() },
];

export function EftpsDepositSection({ clientId }: { clientId: string }) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  // --- Import: Payroll Wages ---
  const [paycheckFile, setPaycheckFile] = useState<File | null>(null);
  const [paycheckPreview, setPaycheckPreview] = useState<{ rows: PaycheckPreviewRow[]; newCount: number; duplicateCount: number } | null>(null);
  const [paycheckIncludeDupes, setPaycheckIncludeDupes] = useState(false);
  const [paycheckBusy, setPaycheckBusy] = useState<"preview" | "import" | null>(null);

  // --- Import: Tax Liability ---
  const [taxLiabilityFile, setTaxLiabilityFile] = useState<File | null>(null);
  const [taxLiabilityPreview, setTaxLiabilityPreview] = useState<TaxLiabilityPreview | null>(null);
  const [taxLiabilityIncludeDupe, setTaxLiabilityIncludeDupe] = useState(false);
  const [taxLiabilityBusy, setTaxLiabilityBusy] = useState<"preview" | "import" | null>(null);

  // --- Review & Save: any period, computed live ---
  const [periodStart, setPeriodStart] = useState(firstOfMonth(1));
  const [periodEnd, setPeriodEnd] = useState(lastOfMonth(1));
  const [reviewing, setReviewing] = useState(false);
  const [computation, setComputation] = useState<EftpsComputation | null>(null);
  const [hasReconciliationReference, setHasReconciliationReference] = useState(false);
  const [paycheckCount, setPaycheckCount] = useState(0);
  const [dueDate, setDueDate] = useState(suggestDueDate(lastOfMonth(1)));
  const [filingDate, setFilingDate] = useState(todayStr());
  const [paymentDate, setPaymentDate] = useState(suggestDueDate(lastOfMonth(1)));
  const [saving, setSaving] = useState<"close" | "send" | null>(null);

  const [history, setHistory] = useState<EftpsDepositHistoryRow[] | null>(null);
  function loadHistory() {
    api.get<{ deposits: EftpsDepositHistoryRow[] }>(`/eftps-deposits?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => setHistory(r.deposits))
      .catch(() => setHistory([]));
  }
  useEffect(loadHistory, [clientId]);

  async function handlePaycheckPreview() {
    if (!paycheckFile) return;
    setError(null);
    setPaycheckBusy("preview");
    try {
      const fileBase64 = await fileToBase64(paycheckFile);
      const res = await api.post<{ rows: PaycheckPreviewRow[]; newCount: number; duplicateCount: number }>(
        "/eftps-deposits/import/payroll-wages/preview", { clientId, fileBase64 }
      );
      setPaycheckPreview(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not process this file.");
    } finally {
      setPaycheckBusy(null);
    }
  }

  async function handlePaycheckImport() {
    if (!paycheckPreview) return;
    setError(null);
    setPaycheckBusy("import");
    try {
      const rows = paycheckPreview.rows
        .filter((r) => r.action === "create" || paycheckIncludeDupes)
        .map((r) => ({ ...r, includeIfDuplicate: paycheckIncludeDupes }));
      const res = await api.post<{ created: number; skipped: number }>("/eftps-deposits/import/payroll-wages/commit", { clientId, rows });
      toast(`Imported ${res.created} paycheck(s)${res.skipped ? `, skipped ${res.skipped}` : ""}.`);
      setPaycheckFile(null);
      setPaycheckPreview(null);
      setPaycheckIncludeDupes(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not import these paychecks.");
    } finally {
      setPaycheckBusy(null);
    }
  }

  async function handleTaxLiabilityPreview() {
    if (!taxLiabilityFile) return;
    setError(null);
    setTaxLiabilityBusy("preview");
    try {
      const fileBase64 = await fileToBase64(taxLiabilityFile);
      const res = await api.post<TaxLiabilityPreview>("/eftps-deposits/import/tax-liability/preview", { clientId, fileBase64 });
      setTaxLiabilityPreview(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not process this file.");
    } finally {
      setTaxLiabilityBusy(null);
    }
  }

  async function handleTaxLiabilityImport() {
    if (!taxLiabilityPreview) return;
    setError(null);
    setTaxLiabilityBusy("import");
    try {
      await api.post("/eftps-deposits/import/tax-liability/commit", {
        clientId, rangeStart: taxLiabilityPreview.range.start, rangeEnd: taxLiabilityPreview.range.end,
        summary: taxLiabilityPreview.summary, includeIfDuplicate: taxLiabilityIncludeDupe,
      });
      toast("Tax Liability snapshot imported.");
      setTaxLiabilityFile(null);
      setTaxLiabilityPreview(null);
      setTaxLiabilityIncludeDupe(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not import this snapshot.");
    } finally {
      setTaxLiabilityBusy(null);
    }
  }

  async function handleReview() {
    if (!periodStart || !periodEnd) return;
    setError(null);
    setReviewing(true);
    try {
      const res = await api.get<{ computation: EftpsComputation | null; hasReconciliationReference: boolean; paycheckCount: number }>(
        `/eftps-deposits/review?clientId=${encodeURIComponent(clientId)}&periodStart=${periodStart}&periodEnd=${periodEnd}`
      );
      setComputation(res.computation);
      setHasReconciliationReference(res.hasReconciliationReference);
      setPaycheckCount(res.paycheckCount);
      if (!res.paycheckCount) setError(`No imported paychecks fall within ${periodStart} to ${periodEnd}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this period.");
    } finally {
      setReviewing(false);
    }
  }

  function applyPreset(preset: (typeof PERIOD_PRESETS)[number]) {
    const s = preset.start(), e = preset.end();
    setPeriodStart(s);
    setPeriodEnd(e);
    setDueDate(suggestDueDate(e));
    setPaymentDate(suggestDueDate(e));
    setComputation(null);
  }

  async function handleSave(action: "close" | "send") {
    if (!computation) return;
    if (!filingDate || !dueDate || !paymentDate) { setError("Filing date, due date, and payment date are all required."); return; }
    setError(null);
    setSaving(action);
    try {
      await api.post("/eftps-deposits", {
        clientId, periodStart, periodEnd, dueDate, filingDate, paymentDate, action,
        periodLabel: `${fmtDate(periodStart)} – ${fmtDate(periodEnd)}`,
      });
      toast(action === "send" ? "Deposit saved and report sent to the client." : "Deposit saved.");
      setComputation(null);
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this deposit.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <p className="muted" style={{ fontSize: 13, maxWidth: 680, marginBottom: 16 }}>
        Import Drake's "Payroll Wages" and "Tax Liability by Check Date" reports whenever you have them — any date
        range, no need to match a specific month. Then review and save by whatever period you choose below.
      </p>
      {error && <ErrorBanner error={error} />}

      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Import Payroll Wages</h3>
      <div className="card" style={{ marginBottom: 16 }}>
        <FileDropInput file={paycheckFile} onChange={(f) => { setPaycheckFile(f); setPaycheckPreview(null); }} accept=".xls,.xlsx" hint="Drake report — any period" />
        {!paycheckPreview ? (
          <button className="btn btn-primary" onClick={handlePaycheckPreview} disabled={!paycheckFile || paycheckBusy !== null} style={{ marginTop: 8 }}>
            {paycheckBusy === "preview" ? "Processing…" : "Preview"}
          </button>
        ) : (
          <div style={{ marginTop: 8 }}>
            <p className="muted" style={{ fontSize: 13 }}>
              {paycheckPreview.newCount} new paycheck(s){paycheckPreview.duplicateCount ? `, ${paycheckPreview.duplicateCount} already imported` : ""}.
            </p>
            {paycheckPreview.duplicateCount > 0 && (
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, marginBottom: 8 }}>
                <input type="checkbox" checked={paycheckIncludeDupes} onChange={(e) => setPaycheckIncludeDupes(e.target.checked)} />
                Import the already-imported ones again too
              </label>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={handlePaycheckImport} disabled={paycheckBusy !== null}>
                {paycheckBusy === "import" ? "Importing…" : "Import"}
              </button>
              <button className="btn" onClick={() => { setPaycheckFile(null); setPaycheckPreview(null); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Import Tax Liability by Check Date</h3>
      <div className="card" style={{ marginBottom: 16 }}>
        <FileDropInput file={taxLiabilityFile} onChange={(f) => { setTaxLiabilityFile(f); setTaxLiabilityPreview(null); }} accept=".xls,.xlsx" hint="Drake report — any period" />
        {!taxLiabilityPreview ? (
          <button className="btn btn-primary" onClick={handleTaxLiabilityPreview} disabled={!taxLiabilityFile || taxLiabilityBusy !== null} style={{ marginTop: 8 }}>
            {taxLiabilityBusy === "preview" ? "Processing…" : "Preview"}
          </button>
        ) : (
          <div style={{ marginTop: 8 }}>
            <p className="muted" style={{ fontSize: 13 }}>
              Covers {fmtDate(taxLiabilityPreview.range.start)} – {fmtDate(taxLiabilityPreview.range.end)} · Federal Deposit Total {money(taxLiabilityPreview.summary.total941)}
              {taxLiabilityPreview.action === "duplicate" ? " · already imported for this exact range" : ""}.
            </p>
            {taxLiabilityPreview.action === "duplicate" && (
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, marginBottom: 8 }}>
                <input type="checkbox" checked={taxLiabilityIncludeDupe} onChange={(e) => setTaxLiabilityIncludeDupe(e.target.checked)} />
                Import it again anyway
              </label>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={handleTaxLiabilityImport} disabled={taxLiabilityBusy !== null || (taxLiabilityPreview.action === "duplicate" && !taxLiabilityIncludeDupe)}>
                {taxLiabilityBusy === "import" ? "Importing…" : "Import"}
              </button>
              <button className="btn" onClick={() => { setTaxLiabilityFile(null); setTaxLiabilityPreview(null); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Review & Save</h3>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {PERIOD_PRESETS.map((p) => (
            <button key={p.label} type="button" className="btn btn-sm" onClick={() => applyPreset(p)}>{p.label}</button>
          ))}
        </div>
        <div className="form-grid">
          <div className="field"><label htmlFor="eftps-period-start">Period Start</label><input id="eftps-period-start" type="date" value={periodStart} onChange={(e) => { setPeriodStart(e.target.value); setComputation(null); }} /></div>
          <div className="field"><label htmlFor="eftps-period-end">Period End</label><input id="eftps-period-end" type="date" value={periodEnd} onChange={(e) => { const v = e.target.value; setPeriodEnd(v); setDueDate(suggestDueDate(v)); setPaymentDate(suggestDueDate(v)); setComputation(null); }} /></div>
        </div>
        <button className="btn btn-primary" onClick={handleReview} disabled={reviewing} style={{ marginTop: 4 }}>
          {reviewing ? "Loading…" : "Review This Period"}
        </button>
      </div>

      {computation && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{paycheckCount} paycheck(s) in this period.</p>
          {!hasReconciliationReference ? (
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
              No Tax Liability snapshot has been imported for this exact date range — the breakdown below is computed directly from imported paychecks.
            </p>
          ) : computation.reconciliationStatus === "Mismatch" ? (
            <div className="card" style={{ borderColor: "var(--red)", marginBottom: 12, padding: 10 }}>
              <strong style={{ color: "var(--red)" }}>Reconciliation mismatch</strong>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Computed total {money(computation.totalAmount)} vs. Drake's own 941 Total {money(computation.drakeTotal941)}
                {computation.reconciliationDifference !== null && ` (difference: ${money(Math.abs(computation.reconciliationDifference))})`}.
                Please review before saving.
              </div>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
              Reconciled against Drake's own 941 Total ({money(computation.drakeTotal941)}) — within normal rounding tolerance.
            </div>
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
            <div className="field"><label htmlFor="eftps-due">Due Date</label><input id="eftps-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
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
