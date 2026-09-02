import { Fragment, useEffect, useState } from "react";
import { api, ApiError, viewFile, downloadFile } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";
import { useToast } from "./Toast";
import { useConfirm } from "./ConfirmProvider";

interface Form941Filing {
  client_id: string; period_start: string; period_end: string; quarter: number;
  filed_date: string; paid_date: string | null;
  gross_liability: number; eftps_deposits_applied: number; balance_due: number;
  share_token: string | null; acknowledged_at: string | null; sent_at: string | null;
}
interface Form941QuarterTotals {
  employeeCount: number; wages: number; federalWithholding: number;
  socialSecurityWages: number; medicareWages: number; grossLiability: number;
  eftpsDepositsApplied: number; balanceDue: number;
}
interface Form941QuarterReview {
  periodStart: string; periodEnd: string; quarter: number; year: number;
  dueDate: string; totals: Form941QuarterTotals | null; existingFiling: Form941Filing | null;
}

function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function money(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}
function pad2(n: number): string { return String(n).padStart(2, "0"); }
function todayStr(): string { return new Date().toISOString().slice(0, 10); }
function quarterOf(dateStr: string): { year: number; quarter: number } {
  const [y, m] = dateStr.split("-").map(Number);
  return { year: y, quarter: Math.floor((m - 1) / 3) + 1 };
}
function quarterBounds(year: number, quarter: number): { start: string; end: string } {
  const qStartMonth0 = (quarter - 1) * 3;
  const lastDay = new Date(Date.UTC(year, qStartMonth0 + 3, 0)).getUTCDate();
  return { start: `${year}-${pad2(qStartMonth0 + 1)}-01`, end: `${year}-${pad2(qStartMonth0 + 3)}-${pad2(lastDay)}` };
}
const PERIOD_PRESETS = [
  { label: "This Quarter", range: () => { const { year, quarter } = quarterOf(todayStr()); return quarterBounds(year, quarter); } },
  { label: "Last Quarter", range: () => { const { year, quarter } = quarterOf(todayStr()); const py = quarter === 1 ? year - 1 : year; const pq = quarter === 1 ? 4 : quarter - 1; return quarterBounds(py, pq); } },
  { label: "Last 4 Quarters", range: () => { const { year, quarter } = quarterOf(todayStr()); const startQ = quarterBounds(year, quarter); const back = new Date(`${startQ.start}T00:00:00Z`); back.setUTCMonth(back.getUTCMonth() - 9); const b = quarterOf(back.toISOString().slice(0, 10)); return { start: quarterBounds(b.year, b.quarter).start, end: startQ.end }; } },
];

export function Form941Section({ clientId }: { clientId: string }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [error, setError] = useState<string | null>(null);

  const initial = PERIOD_PRESETS[0].range();
  const [periodStart, setPeriodStart] = useState(initial.start);
  const [periodEnd, setPeriodEnd] = useState(initial.end);
  const [reviewing, setReviewing] = useState(false);
  const [quarters, setQuarters] = useState<Form941QuarterReview[] | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [quarterInputs, setQuarterInputs] = useState<Record<string, { filedDate: string; paidDate: string; notify: boolean }>>({});
  const [filingBusy, setFilingBusy] = useState<string | null>(null);

  const [history, setHistory] = useState<Form941Filing[] | null>(null);
  function loadHistory() {
    api.get<{ filings: Form941Filing[] }>(`/form941-filings?clientId=${clientId}`)
      .then((r) => setHistory(r.filings.map((f) => ({ ...f, period_end: f.period_end.slice(0, 10) }))))
      .catch(() => setHistory([]));
  }
  useEffect(loadHistory, [clientId]);
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");

  const [payingKey, setPayingKey] = useState<string | null>(null);
  const [payingDate, setPayingDate] = useState(todayStr());
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ filedDate: "", paidDate: "", balanceDue: "" });
  const [showClientColumn, setShowClientColumn] = useState(true);

  function applyPreset(p: (typeof PERIOD_PRESETS)[number]) {
    const r = p.range();
    setPeriodStart(r.start); setPeriodEnd(r.end); setQuarters(null);
  }

  async function handleReview() {
    setReviewing(true);
    setError(null);
    try {
      const res = await api.get<{ quarters: Form941QuarterReview[] }>(
        `/form941-filings/review?clientId=${clientId}&periodStart=${periodStart}&periodEnd=${periodEnd}`
      );
      setQuarters(res.quarters);
      const inputs: typeof quarterInputs = {};
      for (const q of res.quarters) {
        if (!q.existingFiling) inputs[q.periodEnd] = { filedDate: "", paidDate: "", notify: true };
      }
      setQuarterInputs((prev) => ({ ...prev, ...inputs }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this period.");
    } finally {
      setReviewing(false);
    }
  }

  async function handleMarkFiled(q: Form941QuarterReview) {
    const input = quarterInputs[q.periodEnd];
    if (!input?.filedDate) return;
    setFilingBusy(q.periodEnd);
    try {
      await api.post("/form941-filings/mark-filed", { clientId, year: q.year, quarter: q.quarter, filedDate: input.filedDate, paidDate: input.paidDate || undefined, notify: input.notify });
      toast(input.notify ? "Filed and confirmation sent to the client." : "Filed.");
      handleReview();
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not mark this Form 941 filed.");
    } finally {
      setFilingBusy(null);
    }
  }

  async function handleRecordPayment(f: Form941Filing) {
    setRowBusy(`${f.period_end}:pay`);
    try {
      await api.post(`/form941-filings/${clientId}/${f.period_end}/record-payment`, { paidDate: payingDate });
      toast("Payment recorded.");
      setPayingKey(null);
      handleReview();
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record this payment.");
    } finally {
      setRowBusy(null);
    }
  }

  /** Independently (re-)sends the filing-confirmation email — same standalone action EFTPS Deposits already has, not just a one-time choice bundled into "Mark Filed." */
  async function handleSendConfirmation(f: Form941Filing) {
    setRowBusy(`${f.period_end}:send`);
    try {
      await api.post(`/form941-filings/${clientId}/${f.period_end}/send`, {});
      toast("Filing confirmation sent.");
      handleReview();
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send this confirmation.");
    } finally {
      setRowBusy(null);
    }
  }

  async function handleUndo(f: Form941Filing) {
    const ok = await confirmDialog({
      title: "Delete this Form 941 filing", message: `Removes the record for Q${f.quarter} entirely — it can be filed again from scratch afterward.`, confirmLabel: "Delete", danger: true,
    });
    if (!ok) return;
    setRowBusy(`${f.period_end}:undo`);
    try {
      await api.post(`/form941-filings/${clientId}/${f.period_end}/unmark`, {});
      toast("Deleted.");
      handleReview();
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete this filing.");
    } finally {
      setRowBusy(null);
    }
  }

  function startEdit(f: Form941Filing) {
    setEditingKey(f.period_end);
    setEditForm({ filedDate: f.filed_date.slice(0, 10), paidDate: f.paid_date ? f.paid_date.slice(0, 10) : "", balanceDue: String(f.balance_due) });
  }

  /** Corrects an already-filed quarter's filed date / paid date / balance due — for when the real number the IRS actually processed ends up different from what this app computed from stored paychecks. */
  async function handleSaveEdit(f: Form941Filing) {
    if (!editForm.filedDate || editForm.balanceDue === "") return;
    setRowBusy(`${f.period_end}:edit`);
    try {
      await api.post(`/form941-filings/${clientId}/${f.period_end}/edit`, {
        filedDate: editForm.filedDate, paidDate: editForm.paidDate || undefined, balanceDue: Number(editForm.balanceDue),
      });
      toast("Filing corrected.");
      setEditingKey(null);
      handleReview();
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this correction.");
    } finally {
      setRowBusy(null);
    }
  }

  function renderFilingRow(f: Form941Filing) {
    return (
      <Fragment key={f.period_end}>
        <tr>
          <td>Q{f.quarter} {f.period_start.slice(0, 4)}</td>
          <td>{fmtDate(f.filed_date)}</td>
          <td style={{ textAlign: "right" }}>{money(f.balance_due)}</td>
          <td>{f.paid_date ? <span style={{ color: "var(--teal)", fontWeight: 600 }}>Paid {fmtDate(f.paid_date)}</span> : <span className="muted">Payment pending</span>}</td>
          <td>{showClientColumn && (f.acknowledged_at ? <span style={{ color: "var(--teal)" }}>✓ Client confirmed</span> : <span className="muted">Awaiting client confirmation</span>)}</td>
          <td>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {!f.paid_date && (
                <button className="btn btn-sm" onClick={() => { setPayingKey(f.period_end); setPayingDate(todayStr()); }}>Record Payment</button>
              )}
              {!f.sent_at && (
                <button className="btn btn-sm" disabled={rowBusy === `${f.period_end}:send`} onClick={() => handleSendConfirmation(f)}>{rowBusy === `${f.period_end}:send` ? "…" : "Send"}</button>
              )}
              <button className="btn btn-sm" onClick={() => viewFile(`/form941-filings/${clientId}/${f.period_end}/pdf`)}>View</button>
              <button className="btn btn-sm" onClick={() => downloadFile(`/form941-filings/${clientId}/${f.period_end}/pdf`, `941_Q${f.quarter}_${f.period_start.slice(0, 4)}.pdf`)}>PDF</button>
              <button className="btn btn-sm" onClick={() => startEdit(f)}>Edit</button>
              <button className="btn btn-sm btn-danger" disabled={rowBusy === `${f.period_end}:undo`} onClick={() => handleUndo(f)}>{rowBusy === `${f.period_end}:undo` ? "…" : "Delete"}</button>
            </div>
          </td>
        </tr>
        {editingKey === f.period_end && (
          <tr>
            <td colSpan={6} style={{ background: "var(--surface-2, #f8fafb)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", padding: "8px 0", flexWrap: "wrap" }}>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="f941-edit-filed">Filed Date</label>
                  <input id="f941-edit-filed" type="date" value={editForm.filedDate} onChange={(e) => setEditForm((s) => ({ ...s, filedDate: e.target.value }))} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="f941-edit-paid">Payment Date <span className="muted">(optional)</span></label>
                  <input id="f941-edit-paid" type="date" value={editForm.paidDate} onChange={(e) => setEditForm((s) => ({ ...s, paidDate: e.target.value }))} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="f941-edit-balance">Balance Due</label>
                  <input id="f941-edit-balance" type="number" step="0.01" value={editForm.balanceDue} onChange={(e) => setEditForm((s) => ({ ...s, balanceDue: e.target.value }))} style={{ maxWidth: 120 }} />
                </div>
                <button className="btn btn-primary btn-sm" disabled={rowBusy === `${f.period_end}:edit` || !editForm.filedDate || editForm.balanceDue === ""} onClick={() => handleSaveEdit(f)}>
                  {rowBusy === `${f.period_end}:edit` ? "Saving…" : "Save"}
                </button>
                <button className="btn btn-sm" onClick={() => setEditingKey(null)}>Cancel</button>
              </div>
            </td>
          </tr>
        )}
        {payingKey === f.period_end && (
          <tr>
            <td colSpan={6} style={{ background: "var(--surface-2, #f8fafb)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", padding: "8px 0" }}>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="f941-pay-date">Payment Date</label>
                  <input id="f941-pay-date" type="date" value={payingDate} onChange={(e) => setPayingDate(e.target.value)} />
                </div>
                <button className="btn btn-primary btn-sm" disabled={rowBusy === `${f.period_end}:pay`} onClick={() => handleRecordPayment(f)}>
                  {rowBusy === `${f.period_end}:pay` ? "Saving…" : "Record Payment"}
                </button>
                <button className="btn btn-sm" onClick={() => setPayingKey(null)}>Cancel</button>
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
        Pick a date range and review — a range spanning more than one quarter shows one row per quarter, same as EFTPS Deposits. Amounts are always computed live from recorded paychecks and netted against EFTPS deposits, never staff-entered.
      </p>
      {error && <ErrorBanner error={error} />}

      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Review & File</h3>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {PERIOD_PRESETS.map((p) => (
            <button key={p.label} type="button" className="btn btn-sm" onClick={() => applyPreset(p)}>{p.label}</button>
          ))}
        </div>
        <div className="form-grid">
          <div className="field"><label htmlFor="f941-period-start">Period Start</label><input id="f941-period-start" type="date" value={periodStart} onChange={(e) => { setPeriodStart(e.target.value); setQuarters(null); }} /></div>
          <div className="field"><label htmlFor="f941-period-end">Period End</label><input id="f941-period-end" type="date" value={periodEnd} onChange={(e) => { setPeriodEnd(e.target.value); setQuarters(null); }} /></div>
        </div>
        <button className="btn btn-primary" onClick={handleReview} disabled={reviewing} style={{ marginTop: 4 }}>
          {reviewing ? "Loading…" : "Review This Period"}
        </button>
      </div>

      {quarters && (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Quarter</th><th style={{ textAlign: "right" }}>Balance Due</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {quarters.map((q) => {
                  const isExpanded = expandedKey === q.periodEnd;
                  const statusLabel = q.existingFiling ? "Filed" : "Not filed";
                  const totalDisplay = q.existingFiling ? money(q.existingFiling.balance_due) : q.totals ? money(q.totals.balanceDue) : "—";
                  return (
                    <Fragment key={q.periodEnd}>
                      <tr onClick={() => setExpandedKey(isExpanded ? null : q.periodEnd)} style={{ cursor: "pointer" }}>
                        <td>Q{q.quarter} {q.year}</td>
                        <td style={{ textAlign: "right" }}>{totalDisplay}</td>
                        <td>{statusLabel}</td>
                        <td style={{ textAlign: "right" }}>{isExpanded ? "▲" : "▼"}</td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={4} style={{ background: "var(--surface-2, #f8fafb)", padding: 16 }}>
                            {q.existingFiling ? (
                              <div className="table-scroll">
                                <table>
                                  <thead><tr><th>Quarter</th><th>Filed</th><th style={{ textAlign: "right" }}>Balance Due</th><th>Payment</th><th>Client{" "}<button type="button" className="ghost-button" style={{ fontSize: 11, fontWeight: 400, textTransform: "none" }} onClick={() => setShowClientColumn((v) => !v)}>({showClientColumn ? "Hide" : "View"})</button></th><th></th></tr></thead>
                                  <tbody>{renderFilingRow(q.existingFiling)}</tbody>
                                </table>
                              </div>
                            ) : q.totals ? (
                              <>
                                <table style={{ width: "100%", maxWidth: 480, marginBottom: 12 }}>
                                  <tbody>
                                    <tr><td className="muted" style={{ padding: "4px 0" }}>Employees</td><td style={{ textAlign: "right" }}>{q.totals.employeeCount}</td></tr>
                                    <tr><td className="muted" style={{ padding: "4px 0" }}>Wages</td><td style={{ textAlign: "right" }}>{money(q.totals.wages)}</td></tr>
                                    <tr><td className="muted" style={{ padding: "4px 0" }}>Gross Liability</td><td style={{ textAlign: "right" }}>{money(q.totals.grossLiability)}</td></tr>
                                    <tr><td className="muted" style={{ padding: "4px 0" }}>EFTPS Deposits Applied</td><td style={{ textAlign: "right" }}>−{money(q.totals.eftpsDepositsApplied)}</td></tr>
                                    <tr style={{ borderTop: "1px solid var(--line)" }}><td style={{ padding: "4px 0", fontWeight: 700 }}>Balance Due</td><td style={{ textAlign: "right", fontWeight: 700 }}>{money(q.totals.balanceDue)}</td></tr>
                                  </tbody>
                                </table>
                                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                                  <div className="field" style={{ margin: 0, maxWidth: 170 }}>
                                    <label htmlFor={`f941-filed-${q.periodEnd}`}>Filed Date</label>
                                    <input id={`f941-filed-${q.periodEnd}`} type="date"
                                      value={quarterInputs[q.periodEnd]?.filedDate ?? ""}
                                      onChange={(e) => setQuarterInputs((p) => ({ ...p, [q.periodEnd]: { ...p[q.periodEnd], filedDate: e.target.value } }))} />
                                  </div>
                                  <div className="field" style={{ margin: 0, maxWidth: 170 }}>
                                    <label htmlFor={`f941-paid-${q.periodEnd}`}>Payment Date (optional)</label>
                                    <input id={`f941-paid-${q.periodEnd}`} type="date"
                                      value={quarterInputs[q.periodEnd]?.paidDate ?? ""}
                                      onChange={(e) => setQuarterInputs((p) => ({ ...p, [q.periodEnd]: { ...p[q.periodEnd], paidDate: e.target.value } }))} />
                                  </div>
                                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 10 }}>
                                    <input type="checkbox" checked={quarterInputs[q.periodEnd]?.notify ?? true}
                                      onChange={(e) => setQuarterInputs((p) => ({ ...p, [q.periodEnd]: { ...p[q.periodEnd], notify: e.target.checked } }))} />
                                    Notify client
                                  </label>
                                </div>
                                <p className="muted" style={{ fontSize: 12.5, margin: "8px 0" }}>Due {fmtDate(q.dueDate)}.</p>
                                <button className="btn btn-primary" disabled={filingBusy !== null || !quarterInputs[q.periodEnd]?.filedDate} onClick={() => handleMarkFiled(q)}>
                                  {filingBusy === q.periodEnd ? "Filing…" : "Mark Filed"}
                                </button>
                              </>
                            ) : null}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {!quarters.length && <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 16 }}>No quarters in this range.</td></tr>}
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
            <thead><tr><th>Quarter</th><th>Filed</th><th style={{ textAlign: "right" }}>Balance Due</th><th>Payment</th><th>Client{" "}<button type="button" className="ghost-button" style={{ fontSize: 11, fontWeight: 400, textTransform: "none" }} onClick={() => setShowClientColumn((v) => !v)}>({showClientColumn ? "Hide" : "View"})</button></th><th></th></tr></thead>
            <tbody>
              {(history || [])
                .filter((f) => (!historyDateFrom || f.period_start >= historyDateFrom) && (!historyDateTo || f.period_end <= historyDateTo))
                .map((f) => renderFilingRow(f))}
              {history && !history.length && (
                <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 20 }}>No Form 941 filings recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
