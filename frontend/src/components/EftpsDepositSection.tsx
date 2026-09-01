import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, viewFile, printFile, downloadFile, buildFilename } from "../api/client";
import { fileToBase64 } from "../utils/file";
import { FileDropInput } from "./FileDropInput";
import { ErrorBanner } from "./ErrorBanner";
import { useToast } from "./Toast";
import { useConfirm } from "./ConfirmProvider";
import type { Employee } from "../api/types2";

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
  acknowledged_at: string | null;
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
interface ImportedPaycheckRow {
  id: string; employee_name: string; pay_date: string; check_number: string | null;
  federal_withheld: number; social_security_withheld: number; medicare_withheld: number; created_at: string;
}
interface ImportedTaxLiabilityRow {
  id: string; range_start: string; range_end: string;
  federal_income_tax: number; social_security: number; medicare: number; total_941: number;
  imported_by: string; imported_at: string;
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
  const [paycheckBusy, setPaycheckBusy] = useState<"preview" | "import" | null>(null);

  // --- Import: Tax Liability ---
  const [taxLiabilityFile, setTaxLiabilityFile] = useState<File | null>(null);
  const [taxLiabilityPreview, setTaxLiabilityPreview] = useState<TaxLiabilityPreview | null>(null);
  const [taxLiabilityBusy, setTaxLiabilityBusy] = useState<"preview" | "import" | null>(null);

  // --- Review & File: any period, one row per calendar month touched ---
  const [periodStart, setPeriodStart] = useState(firstOfMonth(1));
  const [periodEnd, setPeriodEnd] = useState(lastOfMonth(1));
  const [reviewing, setReviewing] = useState(false);
  const [months, setMonths] = useState<EftpsMonthReview[] | null>(null);
  // Keyed by monthKey — each month row needs its own independently-editable Filing/Due date pair.
  const [monthInputs, setMonthInputs] = useState<Record<string, { filingDate: string; dueDate: string }>>({});
  const [filingBusy, setFilingBusy] = useState<string | null>(null); // `${monthKey}:close` | `${monthKey}:send`
  // Only one month's detail is expanded at a time — a compact row list reads
  // far better than every month's full breakdown + filing form all open at
  // once, which repeats the same reconciliation disclaimer text on every card.
  const [expandedMonthKey, setExpandedMonthKey] = useState<string | null>(null);

  const [history, setHistory] = useState<EftpsDepositHistoryRow[] | null>(null);
  function loadHistory() {
    api.get<{ deposits: EftpsDepositHistoryRow[] }>(`/eftps-deposits?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => setHistory(r.deposits))
      .catch(() => setHistory([]));
  }
  useEffect(loadHistory, [clientId]);

  // --- Imported data: raw rows, so staff can inspect and clean up an import
  // themselves (e.g. duplicates from before the database gained a unique
  // constraint) instead of it requiring a direct DB fix every time. ---
  const [showImportedData, setShowImportedData] = useState(false);
  const [importedPaychecks, setImportedPaychecks] = useState<ImportedPaycheckRow[] | null>(null);
  const [importedSnapshots, setImportedSnapshots] = useState<ImportedTaxLiabilityRow[] | null>(null);
  const [importedRowBusy, setImportedRowBusy] = useState<string | null>(null);
  const [importedPaycheckSearch, setImportedPaycheckSearch] = useState("");
  const [importedPaycheckDateFrom, setImportedPaycheckDateFrom] = useState("");
  const [importedPaycheckDateTo, setImportedPaycheckDateTo] = useState("");
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");

  // Imported paychecks only carry a free-text employee name (no employee_id
  // — v3_eftps_paycheck_import has no such column) — this client-side name
  // lookup is how a row can still link to that employee's real profile page,
  // same data source the Employees tab itself uses (GET /accounting/employees).
  const [employeeIdByName, setEmployeeIdByName] = useState<Record<string, string>>({});
  useEffect(() => {
    api.get<{ employees: Employee[] }>(`/accounting/employees/${encodeURIComponent(clientId)}`)
      .then((r) => {
        const map: Record<string, string> = {};
        for (const e of r.employees) map[e.employee_name] = e.employee_id;
        setEmployeeIdByName(map);
      })
      .catch(() => setEmployeeIdByName({}));
  }, [clientId]);

  function loadImportedData() {
    api.get<{ rows: ImportedPaycheckRow[] }>(`/eftps-deposits/paycheck-import?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => setImportedPaychecks(r.rows)).catch(() => setImportedPaychecks([]));
    api.get<{ rows: ImportedTaxLiabilityRow[] }>(`/eftps-deposits/tax-liability-import?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => setImportedSnapshots(r.rows)).catch(() => setImportedSnapshots([]));
  }
  useEffect(loadImportedData, [clientId]);

  async function handleDeletePaycheckRow(row: ImportedPaycheckRow) {
    const ok = await confirmDialog({
      title: "Delete this imported paycheck?",
      message: `Removes ${row.employee_name}'s ${fmtDate(row.pay_date)} paycheck (check #${row.check_number || "—"}, ${money(row.federal_withheld)} federal) from the imported data used to compute EFTPS deposits. This does not affect any already-filed deposit — only permanently deletes this one raw import row, which cannot be undone (re-import the file if you need it back).`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setImportedRowBusy(row.id);
    try {
      await api.post(`/eftps-deposits/paycheck-import/${row.id}/delete`, {});
      loadImportedData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete this row.");
    } finally {
      setImportedRowBusy(null);
    }
  }

  async function handleClearAllPaychecks() {
    if (!importedPaychecks?.length) return;
    const ok = await confirmDialog({
      title: "Clear all imported paychecks?",
      message: `Deletes all ${importedPaychecks.length} imported paycheck row(s) for this client. This does not affect any already-filed EFTPS deposit — only the raw imported data used to compute new ones.`,
      confirmLabel: "Clear all",
    });
    if (!ok) return;
    setImportedRowBusy("clear-all-paychecks");
    try {
      await api.post(`/eftps-deposits/paycheck-import/clear`, { clientId });
      toast("Cleared.");
      loadImportedData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not clear these rows.");
    } finally {
      setImportedRowBusy(null);
    }
  }

  async function handleDeleteSnapshotRow(row: ImportedTaxLiabilityRow) {
    const ok = await confirmDialog({
      title: "Delete this Tax Liability snapshot?",
      message: `Removes the ${fmtDate(row.range_start)} – ${fmtDate(row.range_end)} snapshot (941 Total ${money(row.total_941)}), imported by ${row.imported_by}. This is only used as a reconciliation reference for that exact date range — deleting it does not affect any already-filed deposit, but this cannot be undone (re-import the file if you need it back).`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setImportedRowBusy(row.id);
    try {
      await api.post(`/eftps-deposits/tax-liability-import/${row.id}/delete`, {});
      loadImportedData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete this snapshot.");
    } finally {
      setImportedRowBusy(null);
    }
  }

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
    setError(null);
    setPaycheckBusy("import");
    try {
      // A true duplicate (same employee + pay date + check number) can never
      // actually be inserted twice — the database itself rejects it (sql/125)
      // — so it's always safe to send every previewed row, new or not.
      const res = await api.post<{ created: number; skipped: number }>("/eftps-deposits/import/payroll-wages/commit", { clientId, rows: paycheckPreview.rows });
      toast(`Imported ${res.created} paycheck(s)${res.skipped ? `, ${res.skipped} already on file` : ""}.`);
      setPaycheckFile(null);
      setPaycheckPreview(null);
      loadImportedData();
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
      // Re-importing the same range always refreshes that one snapshot in
      // place (sql/125's upsert) rather than creating a duplicate row.
      await api.post("/eftps-deposits/import/tax-liability/commit", {
        clientId, rangeStart: taxLiabilityPreview.range.start, rangeEnd: taxLiabilityPreview.range.end,
        summary: taxLiabilityPreview.summary,
      });
      toast(taxLiabilityPreview.action === "duplicate" ? "Tax Liability snapshot updated." : "Tax Liability snapshot imported.");
      loadImportedData();
      setTaxLiabilityFile(null);
      setTaxLiabilityPreview(null);
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
      setExpandedMonthKey(null);
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
          reconciliation_status: month.computation!.reconciliationStatus, acknowledged_at: null,
        },
      }) ?? null);
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not file this deposit.");
    } finally {
      setFilingBusy(null);
    }
  }

  /** Deletes this month's imported paychecks directly from the review row — a
   * shortcut for the same thing the "Imported Data" section's per-row/Clear
   * All actions already do, scoped to just this one month's date range. */
  async function handleDeleteMonthPaychecks(month: EftpsMonthReview) {
    const ok = await confirmDialog({
      title: "Delete this month's imported paychecks?",
      message: `Deletes all ${month.paycheckCount} imported paycheck(s) for ${month.label}. This does not affect any already-filed EFTPS deposit — only the raw imported data used to compute a new one.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setError(null);
    const busyKey = `${month.monthKey}:delete`;
    setFilingBusy(busyKey);
    try {
      await api.post("/eftps-deposits/paycheck-import/clear", { clientId, periodStart: month.periodStart, periodEnd: month.periodEnd });
      toast("Deleted.");
      setMonths((prev) => prev?.map((m) => m.monthKey !== month.monthKey ? m : { ...m, paycheckCount: 0, computation: null }) ?? null);
      loadImportedData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete these paychecks.");
    } finally {
      setFilingBusy(null);
    }
  }

  /** The Review & File month rows keep their own copy of `existingDeposit`
   * (fetched once when "Review This Period" ran) — a History-only refresh
   * left that copy stale, so a Review row kept showing "Record Payment"
   * (and the wrong PAID/status) even after the action had already succeeded
   * (confirmed live: History showed the real state correctly, the Review
   * row above it didn't). Patches both in lockstep instead of just one. */
  function patchMonthDeposit(depositId: string, patch: Partial<EftpsDepositHistoryRow> | null) {
    setMonths((prev) => prev?.map((m) => m.existingDeposit?.deposit_id !== depositId ? m : {
      ...m,
      existingDeposit: patch === null ? null : { ...m.existingDeposit!, ...patch },
    }) ?? null);
  }

  async function handleRecordPayment(depositId: string) {
    if (!payingDate) return;
    setError(null);
    setRowBusy(`${depositId}:pay`);
    try {
      await api.post(`/eftps-deposits/${depositId}/record-payment`, { paymentDate: payingDate });
      toast("Payment recorded.");
      setPayingDepositId(null);
      patchMonthDeposit(depositId, { payment_date: payingDate });
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
      if (res.sent) patchMonthDeposit(depositId, { status: "Sent" });
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
      patchMonthDeposit(row.deposit_id, null);
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
          <td>{d.payment_date ? <span style={{ color: "var(--teal)", fontWeight: 600 }}>Paid {fmtDate(d.payment_date)}</span> : <span className="muted">Pending</span>}</td>
          <td>{d.acknowledged_at ? <span style={{ color: "var(--teal)" }}>✓ Client confirmed</span> : <span className="muted">Awaiting client confirmation</span>}</td>
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
            <td colSpan={8} style={{ background: "var(--surface-2, #f8fafb)" }}>
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
              {paycheckPreview.newCount} new paycheck(s){paycheckPreview.duplicateCount ? `, ${paycheckPreview.duplicateCount} already on file — those will be skipped automatically` : ""}.
            </p>
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
              {taxLiabilityPreview.action === "duplicate" ? " · a snapshot for this exact range already exists — importing will refresh it with these numbers" : ""}.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={handleTaxLiabilityImport} disabled={taxLiabilityBusy !== null}>
                {taxLiabilityBusy === "import" ? "Importing…" : taxLiabilityPreview.action === "duplicate" ? "Update" : "Import"}
              </button>
              <button className="btn" onClick={() => { setTaxLiabilityFile(null); setTaxLiabilityPreview(null); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>Imported Data</h3>
        <button className="btn btn-sm" onClick={() => setShowImportedData((v) => !v)}>
          {showImportedData ? "Hide" : "Show"} ({(importedPaychecks?.length || 0) + (importedSnapshots?.length || 0)})
        </button>
      </div>
      {showImportedData && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Imported paychecks ({importedPaychecks?.length || 0}) — review and delete any wrong or duplicate rows directly.</p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input type="text" value={importedPaycheckSearch} onChange={(e) => setImportedPaycheckSearch(e.target.value)}
                placeholder="Search employee, date, check #…" style={{ padding: "4px 6px", maxWidth: 200 }} />
              <input type="date" value={importedPaycheckDateFrom} onChange={(e) => setImportedPaycheckDateFrom(e.target.value)} style={{ padding: "4px 6px" }} />
              <span className="muted">to</span>
              <input type="date" value={importedPaycheckDateTo} onChange={(e) => setImportedPaycheckDateTo(e.target.value)} style={{ padding: "4px 6px" }} />
              {(importedPaycheckDateFrom || importedPaycheckDateTo) && (
                <button type="button" className="ghost-button" onClick={() => { setImportedPaycheckDateFrom(""); setImportedPaycheckDateTo(""); }}>All time</button>
              )}
              {!!importedPaychecks?.length && (
                <button className="btn btn-sm btn-danger" disabled={importedRowBusy !== null} onClick={handleClearAllPaychecks}>
                  {importedRowBusy === "clear-all-paychecks" ? "Clearing…" : "Clear All"}
                </button>
              )}
            </div>
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
            <div className="table-scroll" style={{ maxHeight: 320, overflowY: "auto" }}>
              <table>
                <thead><tr><th>Employee</th><th>Pay Date</th><th>Check #</th><th style={{ textAlign: "right" }}>Federal</th><th style={{ textAlign: "right" }}>Soc. Sec.</th><th style={{ textAlign: "right" }}>Medicare</th><th></th></tr></thead>
                <tbody>
                  {(importedPaychecks || [])
                    .filter((r) => {
                      const q = importedPaycheckSearch.trim().toLowerCase();
                      if (q && !([r.employee_name, fmtDate(r.pay_date), r.check_number].some((v) => String(v || "").toLowerCase().includes(q)))) return false;
                      if (importedPaycheckDateFrom && r.pay_date < importedPaycheckDateFrom) return false;
                      if (importedPaycheckDateTo && r.pay_date > importedPaycheckDateTo) return false;
                      return true;
                    })
                    .map((r) => (
                    <tr key={r.id}>
                      <td>
                        {employeeIdByName[r.employee_name]
                          ? <Link to={`/employees/${employeeIdByName[r.employee_name]}`}>{r.employee_name}</Link>
                          : r.employee_name}
                      </td>
                      <td>{fmtDate(r.pay_date)}</td>
                      <td>{r.check_number || "—"}</td>
                      <td style={{ textAlign: "right" }}>{money(r.federal_withheld)}</td>
                      <td style={{ textAlign: "right" }}>{money(r.social_security_withheld)}</td>
                      <td style={{ textAlign: "right" }}>{money(r.medicare_withheld)}</td>
                      <td style={{ textAlign: "right" }}>
                        <button className="btn btn-sm btn-danger" disabled={importedRowBusy === r.id} onClick={() => handleDeletePaycheckRow(r)}>
                          {importedRowBusy === r.id ? "…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {importedPaychecks && !importedPaychecks.length && (
                    <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 16 }}>No paychecks imported yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>Imported Tax Liability snapshots ({importedSnapshots?.length || 0}).</p>
          <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Range</th><th style={{ textAlign: "right" }}>Federal</th><th style={{ textAlign: "right" }}>Soc. Sec.</th><th style={{ textAlign: "right" }}>Medicare</th><th style={{ textAlign: "right" }}>941 Total</th><th></th></tr></thead>
                <tbody>
                  {(importedSnapshots || []).map((r) => (
                    <tr key={r.id}>
                      <td>{fmtDate(r.range_start)} – {fmtDate(r.range_end)}</td>
                      <td style={{ textAlign: "right" }}>{money(r.federal_income_tax)}</td>
                      <td style={{ textAlign: "right" }}>{money(r.social_security)}</td>
                      <td style={{ textAlign: "right" }}>{money(r.medicare)}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{money(r.total_941)}</td>
                      <td style={{ textAlign: "right" }}>
                        <button className="btn btn-sm btn-danger" disabled={importedRowBusy === r.id} onClick={() => handleDeleteSnapshotRow(r)}>
                          {importedRowBusy === r.id ? "…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {importedSnapshots && !importedSnapshots.length && (
                    <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 16 }}>No Tax Liability snapshots imported yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

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

      {months && (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Period</th><th style={{ textAlign: "right" }}>Paychecks</th><th style={{ textAlign: "right" }}>Total</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {months.map((m) => {
                  const isExpanded = expandedMonthKey === m.monthKey;
                  const statusLabel = !m.paycheckCount ? "No paychecks" : m.existingDeposit ? m.existingDeposit.status : "Not filed";
                  const totalDisplay = m.existingDeposit ? money(m.existingDeposit.total_amount) : m.computation ? money(m.computation.totalAmount) : "—";
                  return (
                    <Fragment key={m.monthKey}>
                      <tr
                        onClick={() => setExpandedMonthKey(isExpanded ? null : m.monthKey)}
                        style={{ cursor: "pointer" }}
                      >
                        <td>{m.label}</td>
                        <td style={{ textAlign: "right" }}>{m.paycheckCount}</td>
                        <td style={{ textAlign: "right" }}>{totalDisplay}</td>
                        <td>{statusLabel}{m.existingDeposit?.reconciliation_status === "Mismatch" ? " (Mismatch)" : ""}</td>
                        <td style={{ textAlign: "right" }}>{isExpanded ? "▲" : "▼"}</td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={5} style={{ background: "var(--surface-2, #f8fafb)", padding: 16 }}>
                            {!m.paycheckCount ? (
                              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>No imported paychecks fall within this month.</p>
                            ) : m.existingDeposit ? (
                              <div className="table-scroll">
                                <table>
                                  <thead><tr><th>Period</th><th>Due</th><th>Filed</th><th>Paid</th><th>Client</th><th style={{ textAlign: "right" }}>Amount</th><th>Status</th><th></th></tr></thead>
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
                                  <button className="btn btn-danger" onClick={() => handleDeleteMonthPaychecks(m)} disabled={filingBusy !== null}>
                                    {filingBusy === `${m.monthKey}:delete` ? "Deleting…" : "Delete"}
                                  </button>
                                </div>
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>History</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" value={historyDateFrom} onChange={(e) => setHistoryDateFrom(e.target.value)} style={{ padding: "4px 6px" }} />
          <span className="muted">to</span>
          <input type="date" value={historyDateTo} onChange={(e) => setHistoryDateTo(e.target.value)} style={{ padding: "4px 6px" }} />
          {(historyDateFrom || historyDateTo) && (
            <button type="button" className="ghost-button" onClick={() => { setHistoryDateFrom(""); setHistoryDateTo(""); }}>All time</button>
          )}
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Period</th><th>Due</th><th>Filed</th><th>Paid</th><th>Client</th><th style={{ textAlign: "right" }}>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {(history || [])
                .filter((d) => (!historyDateFrom || d.period_start >= historyDateFrom) && (!historyDateTo || d.period_end <= historyDateTo))
                .map((d) => renderDepositRow(d))}
              {history && !history.length && (
                <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 20 }}>No EFTPS deposits recorded yet.</td></tr>
              )}
              {history && !!history.length && !(history || []).filter((d) => (!historyDateFrom || d.period_start >= historyDateFrom) && (!historyDateTo || d.period_end <= historyDateTo)).length && (
                <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 20 }}>No deposits in this date range.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
