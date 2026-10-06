import { CompanyCheckBanner, companyCheckNeedsConfirm, type CompanyCheckInfo } from "./CompanyCheckBanner";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { fileToBase64 } from "../utils/file";
import { FileDropInput } from "./FileDropInput";
import { ErrorBanner } from "./ErrorBanner";
import { ObligationPeriodsSection } from "./ObligationPeriodsSection";
import { useToast } from "./Toast";
import { useConfirm } from "./ConfirmProvider";
import type { Employee } from "../api/types2";

interface PaycheckPreviewRow {
  employeeName: string; payDate: string; checkNumber?: string;
  federalWithheld?: number; socialSecurityWithheld?: number; medicareWithheld?: number;
  action: "create" | "duplicate";
}
interface TaxLiabilityPreview {
  companyCheck?: CompanyCheckInfo;
  range: { start: string; end: string };
  summary: { federalIncomeTax: number; socialSecurity: number; medicare: number; total941: number };
  action: "create" | "duplicate";
  overlaps?: { range_start: string; range_end: string; total_941: number }[];
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
const stepTitle: React.CSSProperties = { fontSize: 15, fontWeight: 700, margin: "8px 0 10px" };


export function EftpsDepositSection({ clientId, clientName, onSwitchClient }: { clientId: string; clientName: string; onSwitchClient: (id: string) => void }) {
  const [wagesConfirmed, setWagesConfirmed] = useState(false);
  const [taxLiabConfirmed, setTaxLiabConfirmed] = useState(false);
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [error, setError] = useState<string | null>(null);

  // --- Import: Payroll Wages ---
  const [paycheckFile, setPaycheckFile] = useState<File | null>(null);
  const [paycheckPreview, setPaycheckPreview] = useState<{ rows: PaycheckPreviewRow[]; newCount: number; duplicateCount: number; companyCheck?: CompanyCheckInfo } | null>(null);
  const [paycheckBusy, setPaycheckBusy] = useState<"preview" | "import" | null>(null);

  // --- Import: Tax Liability ---
  const [taxLiabilityFile, setTaxLiabilityFile] = useState<File | null>(null);
  const [taxLiabilityPreview, setTaxLiabilityPreview] = useState<TaxLiabilityPreview | null>(null);
  const [taxLiabilityBusy, setTaxLiabilityBusy] = useState<"preview" | "import" | null>(null);

  // --- Imported data: raw rows, so staff can inspect and clean up an import
  // themselves (e.g. duplicates from before the database gained a unique
  // constraint) instead of it requiring a direct DB fix every time. ---
  const [showImportedData, setShowImportedData] = useState(true);
  const [importedPaychecks, setImportedPaychecks] = useState<ImportedPaycheckRow[] | null>(null);
  const [importedSnapshots, setImportedSnapshots] = useState<ImportedTaxLiabilityRow[] | null>(null);
  const [importedRowBusy, setImportedRowBusy] = useState<string | null>(null);
  const [importedPaycheckSearch, setImportedPaycheckSearch] = useState("");
  const [importedPaycheckDateFrom, setImportedPaycheckDateFrom] = useState("");
  const [importedPaycheckDateTo, setImportedPaycheckDateTo] = useState("");

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
  // Tells the Step 3 table to reload whenever the imported data underneath it changes.
  const [importTick, setImportTick] = useState(0);
  useEffect(() => { setImportTick((t) => t + 1); }, [importedPaychecks, importedSnapshots]);

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

  async function handlePaycheckPreview() {
    if (!paycheckFile) return;
    setError(null);
    setPaycheckBusy("preview");
    try {
      const fileBase64 = await fileToBase64(paycheckFile);
      const res = await api.post<{ rows: PaycheckPreviewRow[]; newCount: number; duplicateCount: number; companyCheck?: CompanyCheckInfo }>(
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
      const res = await api.post<{ created: number; skipped: number }>("/eftps-deposits/import/payroll-wages/commit", {
        clientId, rows: paycheckPreview.rows, detectedCompanyName: paycheckPreview.companyCheck?.detectedName ?? null, confirmMismatch: wagesConfirmed,
      });
      toast(`Imported ${res.created} paycheck(s)${res.skipped ? `, ${res.skipped} already on file` : ""}.`);
      setPaycheckFile(null);
      setPaycheckPreview(null);
      setWagesConfirmed(false);
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
        summary: taxLiabilityPreview.summary, detectedCompanyName: taxLiabilityPreview.companyCheck?.detectedName ?? null, confirmMismatch: taxLiabConfirmed,
      });
      toast(taxLiabilityPreview.action === "duplicate" ? "Tax Liability snapshot updated." : "Tax Liability snapshot imported.");
      loadImportedData();
      setTaxLiabilityFile(null);
      setTaxLiabilityPreview(null);
      setTaxLiabConfirmed(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not import this snapshot.");
    } finally {
      setTaxLiabilityBusy(null);
    }
  }

  // --- Totals + duplicate/overlap checks shown under the tables ---
  const sumCents = (vals: unknown[]) => Math.round(vals.reduce<number>((a, v) => a + (Number(v) || 0) * 100, 0)) / 100;
  const visiblePaychecks = (importedPaychecks || []).filter((r) => {
    const q = importedPaycheckSearch.trim().toLowerCase();
    if (q && !([r.employee_name, fmtDate(r.pay_date), r.check_number].some((v) => String(v || "").toLowerCase().includes(q)))) return false;
    if (importedPaycheckDateFrom && r.pay_date < importedPaycheckDateFrom) return false;
    if (importedPaycheckDateTo && r.pay_date > importedPaycheckDateTo) return false;
    return true;
  });
  const normName = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // Same person + same pay date more than once is a likely double import.
  const paycheckDupCount = new Map<string, number>();
  for (const r of importedPaychecks || []) {
    const k = `${normName(r.employee_name)}|${r.pay_date.slice(0, 10)}`;
    paycheckDupCount.set(k, (paycheckDupCount.get(k) || 0) + 1);
  }
  const dupPaycheckKeys = new Set([...paycheckDupCount.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  // Two Tax Liability snapshots whose date ranges overlap would double-count if added together.
  const overlappingSnapshotIds = new Set<string>();
  const snaps = importedSnapshots || [];
  for (let i = 0; i < snaps.length; i++) {
    for (let j = i + 1; j < snaps.length; j++) {
      const a = snaps[i], b = snaps[j];
      if (a.range_start.slice(0, 10) <= b.range_end.slice(0, 10) && b.range_start.slice(0, 10) <= a.range_end.slice(0, 10)) {
        overlappingSnapshotIds.add(a.id); overlappingSnapshotIds.add(b.id);
      }
    }
  }
  // Does each snapshot agree with the imported paychecks that fall inside its own date range?
  // A deposit is the employee's federal tax plus the employee AND employer share of Soc. Sec. and Medicare.
  const snapshotCheck = (r: ImportedTaxLiabilityRow) => {
    const inRange = (importedPaychecks || []).filter((c) => c.pay_date.slice(0, 10) >= r.range_start.slice(0, 10) && c.pay_date.slice(0, 10) <= r.range_end.slice(0, 10));
    const expected = sumCents(inRange.map((c) => Number(c.federal_withheld) + 2 * Number(c.social_security_withheld) + 2 * Number(c.medicare_withheld)));
    const diff = Math.round((Number(r.total_941) - expected) * 100) / 100;
    return { count: inRange.length, expected, diff, ok: inRange.length > 0 && Math.abs(diff) <= 2 };
  };

  return (
    <div>
      <p className="muted" style={{ fontSize: 13, maxWidth: 680, marginBottom: 16 }}>
        Three steps: bring in Drake's two reports, confirm they agree, then file by month.
      </p>
      {error && <ErrorBanner error={error} />}

      <h3 style={stepTitle}>Step 1 — Import from Drake</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, marginBottom: 16, alignItems: "start" }}>
      <div className="card">
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>Payroll Wages</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>One row per paycheck: federal tax, Soc. Sec. and Medicare withheld from the employee.</div>
        <FileDropInput file={paycheckFile} onChange={(f) => { setPaycheckFile(f); setPaycheckPreview(null); }} accept=".xls,.xlsx" hint="Drake report — any period" />
        {!paycheckPreview ? (
          <button className="btn btn-primary" onClick={handlePaycheckPreview} disabled={!paycheckFile || paycheckBusy !== null} style={{ marginTop: 8 }}>
            {paycheckBusy === "preview" ? "Processing…" : "Preview"}
          </button>
        ) : (
          <div style={{ marginTop: 8 }}>
            <CompanyCheckBanner check={paycheckPreview.companyCheck} clientName={clientName} confirmed={wagesConfirmed} onConfirmedChange={setWagesConfirmed}
              onSwitchClient={(id) => { setPaycheckFile(null); setPaycheckPreview(null); setWagesConfirmed(false); onSwitchClient(id); }} />
            <p className="muted" style={{ fontSize: 13 }}>
              {paycheckPreview.newCount} new paycheck(s){paycheckPreview.duplicateCount ? `, ${paycheckPreview.duplicateCount} already on file — those will be skipped automatically` : ""}.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={handlePaycheckImport} disabled={paycheckBusy !== null || companyCheckNeedsConfirm(paycheckPreview.companyCheck, wagesConfirmed)}>
                {paycheckBusy === "import" ? "Importing…" : "Import"}
              </button>
              <button className="btn" onClick={() => { setPaycheckFile(null); setPaycheckPreview(null); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>Tax Liability by Check Date</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Drake's own total for a date range, used to double-check the paychecks. Employee and employer shares combined.</div>
        <FileDropInput file={taxLiabilityFile} onChange={(f) => { setTaxLiabilityFile(f); setTaxLiabilityPreview(null); }} accept=".xls,.xlsx" hint="Drake report — any period" />
        {!taxLiabilityPreview ? (
          <button className="btn btn-primary" onClick={handleTaxLiabilityPreview} disabled={!taxLiabilityFile || taxLiabilityBusy !== null} style={{ marginTop: 8 }}>
            {taxLiabilityBusy === "preview" ? "Processing…" : "Preview"}
          </button>
        ) : (
          <div style={{ marginTop: 8 }}>
            <CompanyCheckBanner check={taxLiabilityPreview.companyCheck} clientName={clientName} confirmed={taxLiabConfirmed} onConfirmedChange={setTaxLiabConfirmed}
              onSwitchClient={(id) => { setTaxLiabilityFile(null); setTaxLiabilityPreview(null); setTaxLiabConfirmed(false); onSwitchClient(id); }} />
            <p className="muted" style={{ fontSize: 13 }}>
              Covers {fmtDate(taxLiabilityPreview.range.start)} – {fmtDate(taxLiabilityPreview.range.end)} · Federal Deposit Total {money(taxLiabilityPreview.summary.total941)}
              {taxLiabilityPreview.action === "duplicate" ? " · a snapshot for this exact range already exists — importing will refresh it with these numbers" : ""}.
            </p>
            {!!taxLiabilityPreview.overlaps?.length && (
              <div className="card" style={{ borderColor: "var(--amber)", padding: 10, marginBottom: 8 }}>
                <strong style={{ color: "var(--amber)" }}>Overlaps an existing snapshot</strong>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                  This file covers days that are already in: {taxLiabilityPreview.overlaps.map((o) => `${fmtDate(o.range_start)} – ${fmtDate(o.range_end)} (${money(o.total_941)})`).join("; ")}.
                  Don't add them together — after importing, delete whichever one you don't need.
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={handleTaxLiabilityImport} disabled={taxLiabilityBusy !== null || companyCheckNeedsConfirm(taxLiabilityPreview.companyCheck, taxLiabConfirmed)}>
                {taxLiabilityBusy === "import" ? "Importing…" : taxLiabilityPreview.action === "duplicate" ? "Update" : "Import"}
              </button>
              <button className="btn" onClick={() => { setTaxLiabilityFile(null); setTaxLiabilityPreview(null); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      </div>

      <button type="button" onClick={() => setShowImportedData((v) => !v)} style={{ ...stepTitle, background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden="true" style={{ fontSize: 11 }}>{showImportedData ? "▼" : "▶"}</span>
        Step 2 — Check what's imported
        <span className="muted" style={{ fontWeight: 400, fontSize: 12.5 }}>
          {importedPaychecks?.length || 0} paycheck{importedPaychecks?.length === 1 ? "" : "s"} · {importedSnapshots?.length || 0} snapshot{importedSnapshots?.length === 1 ? "" : "s"}
          {(dupPaycheckKeys.size + overlappingSnapshotIds.size > 0 || snaps.some((r) => !snapshotCheck(r).ok)) && <span style={{ color: "var(--amber)", fontWeight: 600 }}> · needs attention</span>}
        </span>
      </button>
      {showImportedData && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}><strong>Paychecks</strong> ({importedPaychecks?.length || 0}) — delete any wrong or duplicate row.</p>
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
                <thead>
                  <tr>
                    <th rowSpan={2}>Employee</th><th rowSpan={2}>Pay Date</th><th rowSpan={2}>Check #</th>
                    <th rowSpan={2} style={{ textAlign: "right" }}>Federal Tax</th>
                    <th colSpan={2} style={{ textAlign: "center" }}>Social Security</th>
                    <th colSpan={2} style={{ textAlign: "center" }}>Medicare</th>
                    <th rowSpan={2} style={{ textAlign: "right" }} title="Federal + 2 × Soc. Sec. + 2 × Medicare">Deposit Total</th>
                    <th rowSpan={2}></th>
                  </tr>
                  <tr>
                    <th style={{ textAlign: "right" }}>Employee</th><th style={{ textAlign: "right" }}>Employer</th>
                    <th style={{ textAlign: "right" }}>Employee</th><th style={{ textAlign: "right" }}>Employer</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePaychecks
                    .map((r) => (
                    <tr key={r.id}>
                      <td>
                        {employeeIdByName[r.employee_name]
                          ? <Link to={`/employees/${employeeIdByName[r.employee_name]}`}>{r.employee_name}</Link>
                          : r.employee_name}
                        {dupPaycheckKeys.has(`${normName(r.employee_name)}|${r.pay_date.slice(0, 10)}`) && (
                          <span title="Another imported paycheck has the same employee and pay date — check for a double import." style={{ marginLeft: 6, color: "var(--amber)", fontWeight: 600, fontSize: 11.5 }}>⚠ Possible duplicate</span>
                        )}
                      </td>
                      <td>{fmtDate(r.pay_date)}</td>
                      <td>{r.check_number || "—"}</td>
                      <td style={{ textAlign: "right" }}>{money(r.federal_withheld)}</td>
                      <td style={{ textAlign: "right" }}>{money(r.social_security_withheld)}</td>
                      <td style={{ textAlign: "right" }} className="muted">{money(r.social_security_withheld)}</td>
                      <td style={{ textAlign: "right" }}>{money(r.medicare_withheld)}</td>
                      <td style={{ textAlign: "right" }} className="muted">{money(r.medicare_withheld)}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{money(Number(r.federal_withheld) + 2 * Number(r.social_security_withheld) + 2 * Number(r.medicare_withheld))}</td>
                      <td style={{ textAlign: "right" }}>
                        <button className="btn btn-sm btn-danger" disabled={importedRowBusy === r.id} onClick={() => handleDeletePaycheckRow(r)}>
                          {importedRowBusy === r.id ? "…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {importedPaychecks && !importedPaychecks.length && (
                    <tr><td colSpan={10} className="muted" style={{ textAlign: "center", padding: 16 }}>No paychecks imported yet.</td></tr>
                  )}
                </tbody>
                {visiblePaychecks.length > 0 && (
                  <tfoot>
                    <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border, #d0d7de)" }}>
                      <td colSpan={3}>Total ({visiblePaychecks.length} paycheck{visiblePaychecks.length === 1 ? "" : "s"}{visiblePaychecks.length !== (importedPaychecks || []).length ? ", filtered" : ""})</td>
                      <td style={{ textAlign: "right" }}>{money(sumCents(visiblePaychecks.map((r) => r.federal_withheld)))}</td>
                      <td style={{ textAlign: "right" }}>{money(sumCents(visiblePaychecks.map((r) => r.social_security_withheld)))}</td>
                      <td style={{ textAlign: "right" }}>{money(sumCents(visiblePaychecks.map((r) => r.social_security_withheld)))}</td>
                      <td style={{ textAlign: "right" }}>{money(sumCents(visiblePaychecks.map((r) => r.medicare_withheld)))}</td>
                      <td style={{ textAlign: "right" }}>{money(sumCents(visiblePaychecks.map((r) => r.medicare_withheld)))}</td>
                      <td style={{ textAlign: "right" }}>{money(sumCents(visiblePaychecks.map((r) => Number(r.federal_withheld) + 2 * Number(r.social_security_withheld) + 2 * Number(r.medicare_withheld))))}</td>
                      <td></td>
                    </tr>
                    <tr>
                      <td colSpan={10} className="muted" style={{ fontSize: 12, padding: "6px 10px", fontWeight: 400 }}>
                        Deposit Total = Federal Tax + Soc. Sec. (employee + employer) + Medicare (employee + employer). The employer's share equals the employee's, so only the employee amounts come from Drake's paycheck file.
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <p className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}><strong>Tax Liability snapshots</strong> ({importedSnapshots?.length || 0}) — Drake's own totals, to compare against the paychecks above.</p>
          <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Range</th><th style={{ textAlign: "right" }}>Federal Tax</th><th style={{ textAlign: "right" }} title="Employee + employer">Soc. Sec. (both)</th><th style={{ textAlign: "right" }} title="Employee + employer">Medicare (both)</th><th style={{ textAlign: "right" }}>Deposit Total</th><th>Matches paychecks?</th><th></th></tr></thead>
                <tbody>
                  {(importedSnapshots || []).map((r) => (
                    <tr key={r.id}>
                      <td>
                        {fmtDate(r.range_start)} – {fmtDate(r.range_end)}
                        {overlappingSnapshotIds.has(r.id) && (
                          <span title="This date range overlaps another imported snapshot. Don't add them together — delete the one you don't need." style={{ marginLeft: 6, color: "var(--amber)", fontWeight: 600, fontSize: 11.5 }}>⚠ Overlaps another snapshot</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>{money(r.federal_income_tax)}</td>
                      <td style={{ textAlign: "right" }}>{money(r.social_security)}</td>
                      <td style={{ textAlign: "right" }}>{money(r.medicare)}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{money(r.total_941)}</td>
                      <td style={{ fontSize: 12 }}>
                        {(() => {
                          const c = snapshotCheck(r);
                          if (!c.count) return <span className="muted">No paychecks imported in this range</span>;
                          return c.ok
                            ? <span style={{ color: "var(--teal)", fontWeight: 600 }} title="Drake rounds each tax on the period's total wages; adding up each paycheck's withholding can land a few cents away.">
                                ✓ Matches the {c.count} paycheck{c.count === 1 ? "" : "s"} ({money(c.expected)}){Math.abs(c.diff) > 0.004 ? ` — ${money(Math.abs(c.diff))} rounding` : ""}
                              </span>
                            : <span style={{ color: "var(--red)", fontWeight: 600 }} title="Drake's total and the imported paychecks disagree — one of them may be for the wrong client or period.">✗ Paychecks add up to {money(c.expected)} ({money(Math.abs(c.diff))} {c.diff > 0 ? "less" : "more"})</span>;
                        })()}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button className="btn btn-sm btn-danger" disabled={importedRowBusy === r.id} onClick={() => handleDeleteSnapshotRow(r)}>
                          {importedRowBusy === r.id ? "…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {importedSnapshots && !importedSnapshots.length && (
                    <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 16 }}>No Tax Liability snapshots imported yet.</td></tr>
                  )}
                </tbody>
                {snaps.length > 0 && (
                  <tfoot>
                    {overlappingSnapshotIds.size > 0 ? (
                      <tr><td colSpan={7} style={{ color: "var(--amber)", fontSize: 12.5, padding: 10 }}>
                        No total shown — some snapshot date ranges overlap, so adding them would double-count. Delete the overlapping one you don't need.
                      </td></tr>
                    ) : (
                      <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border, #d0d7de)" }}>
                        <td>Total ({snaps.length} snapshot{snaps.length === 1 ? "" : "s"})</td>
                        <td style={{ textAlign: "right" }}>{money(sumCents(snaps.map((r) => r.federal_income_tax)))}</td>
                        <td style={{ textAlign: "right" }}>{money(sumCents(snaps.map((r) => r.social_security)))}</td>
                        <td style={{ textAlign: "right" }}>{money(sumCents(snaps.map((r) => r.medicare)))}</td>
                        <td style={{ textAlign: "right" }}>{money(sumCents(snaps.map((r) => r.total_941)))}</td>
                        <td></td><td></td>
                      </tr>
                    )}
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      <h3 style={stepTitle}>Step 3 — File the deposits</h3>
      <ObligationPeriodsSection clientId={clientId} kind="eftps" refreshKey={importTick} />
    </div>
  );
}
