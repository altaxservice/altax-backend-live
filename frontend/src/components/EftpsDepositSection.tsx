import { Fragment, useEffect, useState } from "react";
import { api, ApiError, viewFile, printFile, downloadFile, buildFilename } from "../api/client";
import { fileToBase64 } from "../utils/file";
import { FileDropInput } from "./FileDropInput";
import { ErrorBanner } from "./ErrorBanner";
import { useToast } from "./Toast";
import { useConfirm } from "./ConfirmProvider";

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
interface EftpsMonthReview {
  monthKey: string; periodStart: string; periodEnd: string; label: string;
  paycheckCount: number; computation: EftpsComputation | null; hasReconciliationReference: boolean;
  existingDeposit: EftpsDepositHistoryRow | null;
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
  const confirmDialog = useConfirm();
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

  // --- Review & File: any period, one row per calendar month touched ---
  const [periodStart, setPeriodStart] = useState(firstOfMonth(1));
  const [periodEnd, setPeriodEnd] = useState(lastOfMonth(1));
  const [reviewing, setReviewing] = useState(false);
  const [months, setMonths] = useState<EftpsMonthReview[] | null>(null);
  // Keyed by monthKey — each month row needs its own independently-editable Filing/Due date pair.
  const [monthInputs, setMonthInputs] = useState<Record<string, { filingDate: string; dueDate: string }>>({});
  const [filingBusy, setFilingBusy] = useState<string | null>(null); // `${monthKey}:close` | `${monthKey}:send`

  const [history, setHistory] = useState<EftpsDepositHistoryRow[] | null>(null);
  function loadHistory() {
    api.get<{ deposits: EftpsDepositHistoryRow[] }>(`/eftps-deposits?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => setHistory(r.deposits))
      .catch(() => setHistory([]));
  }
  useEffect(loadHistory, [clientId]);

  // --- History row actions ---
  const [payingDepositId, setPayingDepositId] = useState<string | null>(null);
  const [payingDate, setPayingDate] = useState(todayStr());
  const [rowBusy, setRowBusy] = useState<string | null>(null); // `${depositId}:${action}`

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
    if (paycheckIncludeDupes) {
      const ok = await confirmDialog({
        title: "Import duplicates anyway?",
        message: `${paycheckPreview.duplicateCount} paycheck(s) already exist in this client's records. Importing them again will double the totals for those employees on those pay dates.`,
        confirmLabel: "Import anyway",
      });
      if (!ok) return;
    }
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
    if (taxLiabilityIncludeDupe) {
      const ok = await confirmDialog({
        title: "Import duplicate anyway?",
        message: `A Tax Liability snapshot for ${fmtDate(taxLiabilityPreview.range.start)} – ${fmtDate(taxLiabilityPreview.range.end)} was already imported. Importing it again will create a duplicate snapshot for this exact range.`,
        confirmLabel: "Import anyway",
      });
      if (!ok) return;
    }
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
      const res = await api.get<{ months: EftpsMonthReview[] }>(
        `/eftps-deposits/review?clientId=${encodeURIComponent(clientId)}&periodStart=${periodStart}&periodEnd=${periodEnd}`
      );
      setMonths(res.months);
      const inputs: Record<string, { filingDate: string; dueDate: string }> = {};
      for (const m of res.months) inputs[m.monthKey] = { filingDate: todayStr(), dueDate: suggestDueDate(m.periodEnd) };
      setMonthInputs(inputs);
      if (res.months.every((m) => !m.paycheckCount)) setError(`No imported paychecks fall within ${periodStart} to ${periodEnd}.`);
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
    setMonths(null);
  }

  async function handleMarkFiled(month: EftpsMonthReview, notify: boolean) {
    if (!month.computation) return;
    const inputs = monthInputs[month.monthKey];
    if (!inputs?.filingDate || !inputs?.dueDate) { setError("Filing date and due date are required."); return; }
    setError(null);
    const busyKey = `${month.monthKey}:${notify ? "send" : "close"}`;
    setFilingBusy(busyKey);
    try {
      const res = await api.post<{ depositId: string }>("/eftps-deposits/mark-filed", {
        clientId, periodStart: month.periodStart, periodEnd: month.periodEnd,
        dueDate: inputs.dueDate, filingDate: inputs.filingDate, notify, periodLabel: month.label,
      });
      toast(notify ? "Filed and report sent to the client." : "Filed.");
      setMonths((prev) => prev?.map((m) => m.monthKey !== month.monthKey ? m : {
        ...m,
        existingDeposit: {
          deposit_id: res.depositId, period_start: month.periodStart, period_end: month.periodEnd,
          due_date: inputs.dueDate, filing_date: inputs.filingDate, payment_date: null,
          total_amount: month.computation!.totalAmount, status: notify ? "Sent" : "Filed",
          reconciliation_status: month.computation!.reconciliationStatus,
        },
      }) ?? null);
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not file this deposit.");
    } finally {
      setFilingBusy(null);
    }
  }

  async function handleRecordPayment(depositId: string) {
    if (!payingDate) return;
    setError(null);
    setRowBusy(`${depositId}:pay`);
    try {
      await api.post(`/eftps-deposits/${depositId}/record-payment`, { paymentDate: payingDate });
      toast("Payment recorded.");
      setPayingDepositId(null);
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record this payment.");
    } finally {
      setRowBusy(null);
    }
  }

  async function handleSend(depositId: string) {
    setError(null);
    setRowBusy(`${depositId}:send`);
    try {
      const res = await api.post<{ sent: boolean }>(`/eftps-deposits/${depositId}/send`, {});
      toast(res.sent ? "Report sent to the client." : "Client has no email on file — nothing was sent.");
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send this report.");
    } finally {
      setRowBusy(null);
    }
  }

  async function handleUndo(row: EftpsDepositHistoryRow) {
    const ok = await confirmDialog({ title: "Undo this EFTPS deposit", message: `Removes the record for ${fmtDate(row.period_start)} – ${fmtDate(row.period_end)} entirely — the period can be filed again from scratch afterward.`, confirmLabel: "Undo" });
    if (!ok) return;
    setError(null);
    setRowBusy(`${row.deposit_id}:undo`);
    try {
      await api.post(`/eftps-deposits/${row.deposit_id}/unmark`, {});
      toast("Undone.");
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not undo this deposit.");
    } finally {
      setRowBusy(null);
    }
  }

  async function handlePreview(depositId: string) {
    try { await viewFile(`/eftps-deposits/${depositId}/pdf`); } catch (err) { toast(err instanceof ApiError ? err.message : "Could not open this PDF."); }
  }
  async function handlePrint(depositId: string) {
    try { await printFile(`/eftps-deposits/${depositId}/pdf`); } catch (err) { toast(err instanceof ApiError ? err.message : "Could not print this PDF."); }
  }
  async function handleDownload(depositId: string, row: EftpsDepositHistoryRow) {
    try { await downloadFile(`/eftps-deposits/${depositId}/pdf`, buildFilename(["EFTPS", fmtDate(row.period_start), fmtDate(row.period_end)], "pdf")); }
    catch (err) { toast(err instanceof ApiError ? err.message : "Could not download this PDF."); }
  }

  /** One deposit's action row, exactly as History always has — reused both for
   * History's own table and for an already-filed month bucket in Review & File,
   * so Preview/Print/Download/Record Payment/Send/Undo behave identically in
   * both places with zero duplicated JSX. */
  function renderDepositRow(d: EftpsDepositHistoryRow) {
    return (
      <Fragment key={d.deposit_id}>
        <tr>
          <td>{fmtDate(d.period_start)} – {fmtDate(d.period_end)}</td>
          <td>{fmtDate(d.due_date)}</td>
          <td>{fmtDate(d.filing_date)}</td>
          <td>{d.payment_date ? fmtDate(d.payment_date) : <span className="muted">Pending</span>}</td>
          <td style={{ textAlign: "right" }}>{money(d.total_amount)}</td>
          <td>{d.status}{d.reconciliation_status === "Mismatch" ? " (Mismatch)" : ""}</td>
          <td>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {!d.payment_date && (
                <button className="btn btn-sm" onClick={() => { setPayingDepositId(d.deposit_id); setPayingDate(todayStr()); }}>Record Payment</button>
              )}
              {d.status !== "Sent" && (
                <button className="btn btn-sm" disabled={rowBusy === `${d.deposit_id}:send`} onClick={() => handleSend(d.deposit_id)}>{rowBusy === `${d.deposit_id}:send` ? "…" : "Send"}</button>
              )}
              <button className="btn btn-sm" onClick={() => handlePreview(d.deposit_id)}>Preview</button>
              <button className="btn btn-sm" onClick={() => handlePrint(d.deposit_id)}>Print</button>
              <button className="btn btn-sm" onClick={() => handleDownload(d.deposit_id, d)}>Download</button>
              <button className="btn btn-sm btn-danger" disabled={rowBusy === `${d.deposit_id}:undo`} onClick={() => handleUndo(d)}>{rowBusy === `${d.deposit_id}:undo` ? "…" : "Undo"}</button>
            </div>
          </td>
        </tr>
        {payingDepositId === d.deposit_id && (
          <tr>
            <td colSpan={7} style={{ background: "var(--surface-2, #f8fafb)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", padding: "8px 0" }}>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="eftps-pay-date">Payment Date</label>
                  <input id="eftps-pay-date" type="date" value={payingDate} onChange={(e) => setPayingDate(e.target.value)} />
                </div>
                <button className="btn btn-primary btn-sm" disabled={rowBusy === `${d.deposit_id}:pay`} onClick={() => handleRecordPayment(d.deposit_id)}>
                  {rowBusy === `${d.deposit_id}:pay` ? "Saving…" : "Record Payment"}
                </button>
                <button className="btn btn-sm" onClick={() => setPayingDepositId(null)}>Cancel</button>
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  return (
    <div>
      <p className="muted" style={{ fontSize: 13, maxWidth: 680, marginBottom: 16 }}>
        Import Drake's "Payroll Wages" and "Tax Liability by Check Date" reports whenever you have them — any date
        range, no need to match a specific month. Then review and file by whatever period you choose below — a
        range spanning more than one month shows one row per calendar month.
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

      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Review & File</h3>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {PERIOD_PRESETS.map((p) => (
            <button key={p.label} type="button" className="btn btn-sm" onClick={() => applyPreset(p)}>{p.label}</button>
          ))}
        </div>
        <div className="form-grid">
          <div className="field"><label htmlFor="eftps-period-start">Period Start</label><input id="eftps-period-start" type="date" value={periodStart} onChange={(e) => { setPeriodStart(e.target.value); setMonths(null); }} /></div>
          <div className="field"><label htmlFor="eftps-period-end">Period End</label><input id="eftps-period-end" type="date" value={periodEnd} onChange={(e) => { setPeriodEnd(e.target.value); setMonths(null); }} /></div>
        </div>
        <button className="btn btn-primary" onClick={handleReview} disabled={reviewing} style={{ marginTop: 4 }}>
          {reviewing ? "Loading…" : "Review This Period"}
        </button>
      </div>

      {months && months.map((m) => (
        <div key={m.monthKey} className="card" style={{ marginBottom: 16 }}>
          <h4 style={{ margin: "0 0 8px" }}>{m.label}</h4>
          {!m.paycheckCount ? (
            <p className="muted" style={{ fontSize: 12.5 }}>No imported paychecks fall within this month.</p>
          ) : m.existingDeposit ? (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Period</th><th>Due</th><th>Filed</th><th>Paid</th><th style={{ textAlign: "right" }}>Amount</th><th>Status</th><th></th></tr></thead>
                <tbody>{renderDepositRow(m.existingDeposit)}</tbody>
              </table>
            </div>
          ) : (
            <>
              {!m.hasReconciliationReference ? (
                <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
                  No Tax Liability snapshot has been imported for this exact date range — the breakdown below is computed directly from imported paychecks.
                </p>
              ) : m.computation!.reconciliationStatus === "Mismatch" ? (
                <div className="card" style={{ borderColor: "var(--red)", marginBottom: 12, padding: 10 }}>
                  <strong style={{ color: "var(--red)" }}>Reconciliation mismatch</strong>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                    Computed total {money(m.computation!.totalAmount)} vs. Drake's own 941 Total {money(m.computation!.drakeTotal941)}
                    {m.computation!.reconciliationDifference !== null && ` (difference: ${money(Math.abs(m.computation!.reconciliationDifference))})`}.
                    Please review before filing.
                  </div>
                </div>
              ) : (
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
                  Reconciled against Drake's own 941 Total ({money(m.computation!.drakeTotal941)}) — within normal rounding tolerance.
                </div>
              )}

              <table style={{ width: "100%", marginBottom: 16 }}>
                <tbody>
                  <tr><td className="muted">Federal Income Tax</td><td style={{ textAlign: "right" }}>{money(m.computation!.federalIncomeTaxTotal)}</td></tr>
                  <tr><td className="muted">Social Security</td><td style={{ textAlign: "right" }}>{money(m.computation!.socialSecurityTotal)}</td></tr>
                  <tr><td className="muted">Medicare</td><td style={{ textAlign: "right" }}>{money(m.computation!.medicareTotal)}</td></tr>
                  <tr><td style={{ fontWeight: 700 }}>Total Federal Deposit</td><td style={{ textAlign: "right", fontWeight: 700 }}>{money(m.computation!.totalAmount)}</td></tr>
                </tbody>
              </table>

              <div className="table-scroll" style={{ marginBottom: 16 }}>
                <table>
                  <thead><tr><th>Employee</th><th style={{ textAlign: "right" }}>Federal Income Tax</th><th style={{ textAlign: "right" }}>Social Security</th><th style={{ textAlign: "right" }}>Medicare</th><th style={{ textAlign: "right" }}>Total</th></tr></thead>
                  <tbody>
                    {m.computation!.employees.map((e, i) => (
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
                Pay this amount on EFTPS's website. Once you've actually filed it, record the filing date below — you can
                record the payment date separately afterward, once it's confirmed.
              </p>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor={`eftps-filed-${m.monthKey}`}>Filing Date</label>
                  <input id={`eftps-filed-${m.monthKey}`} type="date" value={monthInputs[m.monthKey]?.filingDate || ""}
                    onChange={(e) => setMonthInputs((p) => ({ ...p, [m.monthKey]: { ...p[m.monthKey], filingDate: e.target.value } }))} />
                </div>
                <div className="field">
                  <label htmlFor={`eftps-due-${m.monthKey}`}>Due Date</label>
                  <input id={`eftps-due-${m.monthKey}`} type="date" value={monthInputs[m.monthKey]?.dueDate || ""}
                    onChange={(e) => setMonthInputs((p) => ({ ...p, [m.monthKey]: { ...p[m.monthKey], dueDate: e.target.value } }))} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="btn" onClick={() => handleMarkFiled(m, false)} disabled={filingBusy !== null}>
                  {filingBusy === `${m.monthKey}:close` ? "Filing…" : "Mark Filed"}
                </button>
                <button className="btn btn-primary" onClick={() => handleMarkFiled(m, true)} disabled={filingBusy !== null}>
                  {filingBusy === `${m.monthKey}:send` ? "Filing…" : "Mark Filed and Send"}
                </button>
              </div>
            </>
          )}
        </div>
      ))}

      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>History</h3>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Period</th><th>Due</th><th>Filed</th><th>Paid</th><th style={{ textAlign: "right" }}>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {(history || []).map((d) => renderDepositRow(d))}
              {history && !history.length && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 20 }}>No EFTPS deposits recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
