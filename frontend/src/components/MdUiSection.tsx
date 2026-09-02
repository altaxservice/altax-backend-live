import { Fragment, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";
import { useToast } from "./Toast";
import { useConfirm } from "./ConfirmProvider";

interface MdUiFiling {
  client_id: string; period_start: string; period_end: string;
  filed_date: string; paid_date: string | null; amount: number;
  share_token: string | null; acknowledged_at: string | null; sent_at: string | null;
}
interface MdUiQuarterReview {
  periodStart: string; periodEnd: string; dueDate: string;
  suggestedAmount: number | null; existingFiling: MdUiFiling | null;
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
function periodLabel(periodStart: string): string {
  const { year, quarter } = quarterOf(periodStart);
  return `Q${quarter} ${year}`;
}
/** Same preset shape as EftpsDepositSection's PERIOD_PRESETS, adapted to quarters. */
const PERIOD_PRESETS = [
  { label: "This Quarter", range: () => { const { year, quarter } = quarterOf(todayStr()); return quarterBounds(year, quarter); } },
  { label: "Last Quarter", range: () => { const { year, quarter } = quarterOf(todayStr()); const py = quarter === 1 ? year - 1 : year; const pq = quarter === 1 ? 4 : quarter - 1; return quarterBounds(py, pq); } },
  { label: "Last 4 Quarters", range: () => { const { year, quarter } = quarterOf(todayStr()); const startQ = quarterBounds(year, quarter); const back = new Date(`${startQ.start}T00:00:00Z`); back.setUTCMonth(back.getUTCMonth() - 9); const b = quarterOf(back.toISOString().slice(0, 10)); return { start: quarterBounds(b.year, b.quarter).start, end: startQ.end }; } },
];

export function MdUiSection({ clientId }: { clientId: string }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [error, setError] = useState<string | null>(null);

  const initial = PERIOD_PRESETS[0].range();
  const [periodStart, setPeriodStart] = useState(initial.start);
  const [periodEnd, setPeriodEnd] = useState(initial.end);
  const [reviewing, setReviewing] = useState(false);
  const [quarters, setQuarters] = useState<MdUiQuarterReview[] | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [quarterInputs, setQuarterInputs] = useState<Record<string, { amount: string; filedDate: string; paidDate: string; notify: boolean }>>({});
  const [filingBusy, setFilingBusy] = useState<string | null>(null);

  const [history, setHistory] = useState<MdUiFiling[] | null>(null);
  function loadHistory() {
    api.get<{ filings: MdUiFiling[] }>(`/md-ui-filings?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => setHistory(r.filings.map((f) => ({ ...f, period_end: f.period_end.slice(0, 10) }))))
      .catch(() => setHistory([]));
  }
  useEffect(loadHistory, [clientId]);
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");

  const [payingKey, setPayingKey] = useState<string | null>(null);
  const [payingDate, setPayingDate] = useState(todayStr());
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [showClientColumn, setShowClientColumn] = useState(true);
  // History used to render fully open all the time. It now starts
  // collapsed behind a one-click "Show (N)" toggle, same pattern as
  // EFTPS Deposits' "Imported Data" section.
  const [showHistory, setShowHistory] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ filedDate: "", paidDate: "", amount: "" });

  function applyPreset(p: (typeof PERIOD_PRESETS)[number]) {
    const r = p.range();
    setPeriodStart(r.start); setPeriodEnd(r.end); setQuarters(null);
  }

  async function handleReview() {
    setReviewing(true);
    setError(null);
    try {
      const res = await api.get<{ quarters: MdUiQuarterReview[] }>(
        `/md-ui-filings/review?clientId=${encodeURIComponent(clientId)}&periodStart=${periodStart}&periodEnd=${periodEnd}`
      );
      setQuarters(res.quarters);
      const inputs: typeof quarterInputs = {};
      for (const q of res.quarters) {
        if (!q.existingFiling) inputs[q.periodEnd] = { amount: (q.suggestedAmount ?? 0).toFixed(2), filedDate: "", paidDate: "", notify: true };
      }
      setQuarterInputs((prev) => ({ ...prev, ...inputs }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this period.");
    } finally {
      setReviewing(false);
    }
  }

  async function handleMarkFiled(q: MdUiQuarterReview) {
    const input = quarterInputs[q.periodEnd];
    if (!input?.filedDate) return;
    setFilingBusy(q.periodEnd);
    try {
      await api.post("/md-ui-filings/mark-filed", {
        clientId, periodStart: q.periodStart, periodEnd: q.periodEnd,
        filedDate: input.filedDate, amount: Number(input.amount), paidDate: input.paidDate || undefined, notify: input.notify,
      });
      toast(input.notify ? "Filed and confirmation sent to the client." : "Filed.");
      handleReview();
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not mark this MD UI filing filed.");
    } finally {
      setFilingBusy(null);
    }
  }

  async function handleRecordPayment(f: MdUiFiling) {
    setRowBusy(`${f.period_end}:pay`);
    try {
      await api.post(`/md-ui-filings/${clientId}/${f.period_end}/record-payment`, { paidDate: payingDate });
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
  async function handleSendConfirmation(f: MdUiFiling) {
    setRowBusy(`${f.period_end}:send`);
    try {
      await api.post(`/md-ui-filings/${clientId}/${f.period_end}/send`, {});
      toast("Filing confirmation sent.");
      handleReview();
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send this confirmation.");
    } finally {
      setRowBusy(null);
    }
  }

  async function handleUndo(f: MdUiFiling) {
    const ok = await confirmDialog({
      title: "Delete this MD UI filing", message: `Removes the record for ${periodLabel(f.period_start)} entirely — it can be filed again from scratch afterward.`, confirmLabel: "Delete", danger: true,
    });
    if (!ok) return;
    setRowBusy(`${f.period_end}:undo`);
    try {
      await api.post(`/md-ui-filings/${clientId}/${f.period_end}/unmark`, {});
      toast("Deleted.");
      handleReview();
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete this filing.");
    } finally {
      setRowBusy(null);
    }
  }

  function startEdit(f: MdUiFiling) {
    setEditingKey(f.period_end);
    setEditForm({ filedDate: f.filed_date.slice(0, 10), paidDate: f.paid_date ? f.paid_date.slice(0, 10) : "", amount: String(f.amount) });
  }

  /** Corrects an already-filed quarter's filed date / paid date / amount — for when the real number on Maryland's BEACON portal ends up different from what was entered here. */
  async function handleSaveEdit(f: MdUiFiling) {
    if (!editForm.filedDate || !editForm.amount) return;
    setRowBusy(`${f.period_end}:edit`);
    try {
      await api.post(`/md-ui-filings/${clientId}/${f.period_end}/edit`, {
        filedDate: editForm.filedDate, paidDate: editForm.paidDate || undefined, amount: Number(editForm.amount),
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

  /** Shared row — reused for an already-filed quarter inside Review & File AND in the standalone History list below, same pattern as EftpsDepositSection's renderDepositRow. */
  function renderFilingRow(f: MdUiFiling) {
    return (
      <Fragment key={f.period_end}>
        <tr>
          <td>{periodLabel(f.period_start)}</td>
          <td>{fmtDate(f.filed_date)}</td>
          <td style={{ textAlign: "right" }}>{money(f.amount)}</td>
          <td>{f.paid_date ? <span style={{ color: "var(--teal)", fontWeight: 600 }}>Paid {fmtDate(f.paid_date)}</span> : <span className="muted">Payment pending</span>}</td>
          {showClientColumn && <td>{f.acknowledged_at ? <span style={{ color: "var(--teal)" }}>✓ Client confirmed</span> : <span className="muted">Awaiting client confirmation</span>}</td>}
          <td>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {!f.paid_date && (
                <button className="btn btn-sm" onClick={() => { setPayingKey(f.period_end); setPayingDate(todayStr()); }}>Record Payment</button>
              )}
              {!f.sent_at && (
                <button className="btn btn-sm" disabled={rowBusy === `${f.period_end}:send`} onClick={() => handleSendConfirmation(f)}>{rowBusy === `${f.period_end}:send` ? "…" : "Send"}</button>
              )}
              <button className="btn btn-sm" onClick={() => startEdit(f)}>Edit</button>
              <button className="btn btn-sm btn-danger" disabled={rowBusy === `${f.period_end}:undo`} onClick={() => handleUndo(f)}>{rowBusy === `${f.period_end}:undo` ? "…" : "Delete"}</button>
            </div>
          </td>
        </tr>
        {editingKey === f.period_end && (
          <tr>
            <td colSpan={showClientColumn ? 6 : 5} style={{ background: "var(--surface-2, #f8fafb)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", padding: "8px 0", flexWrap: "wrap" }}>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="mdui-edit-filed">Filed Date</label>
                  <input id="mdui-edit-filed" type="date" value={editForm.filedDate} onChange={(e) => setEditForm((s) => ({ ...s, filedDate: e.target.value }))} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="mdui-edit-paid">Payment Date <span className="muted">(optional)</span></label>
                  <input id="mdui-edit-paid" type="date" value={editForm.paidDate} onChange={(e) => setEditForm((s) => ({ ...s, paidDate: e.target.value }))} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="mdui-edit-amount">Amount</label>
                  <input id="mdui-edit-amount" type="number" step="0.01" min="0" value={editForm.amount} onChange={(e) => setEditForm((s) => ({ ...s, amount: e.target.value }))} style={{ maxWidth: 120 }} />
                </div>
                <button className="btn btn-primary btn-sm" disabled={rowBusy === `${f.period_end}:edit` || !editForm.filedDate || !editForm.amount} onClick={() => handleSaveEdit(f)}>
                  {rowBusy === `${f.period_end}:edit` ? "Saving…" : "Save"}
                </button>
                <button className="btn btn-sm" onClick={() => setEditingKey(null)}>Cancel</button>
              </div>
            </td>
          </tr>
        )}
        {payingKey === f.period_end && (
          <tr>
            <td colSpan={showClientColumn ? 6 : 5} style={{ background: "var(--surface-2, #f8fafb)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", padding: "8px 0" }}>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="mdui-pay-date">Payment Date</label>
                  <input id="mdui-pay-date" type="date" value={payingDate} onChange={(e) => setPayingDate(e.target.value)} />
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
        Pick a date range and review — a range spanning more than one quarter shows one row per quarter, same as EFTPS Deposits.
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
          <div className="field"><label htmlFor="mdui-period-start">Period Start</label><input id="mdui-period-start" type="date" value={periodStart} onChange={(e) => { setPeriodStart(e.target.value); setQuarters(null); }} /></div>
          <div className="field"><label htmlFor="mdui-period-end">Period End</label><input id="mdui-period-end" type="date" value={periodEnd} onChange={(e) => { setPeriodEnd(e.target.value); setQuarters(null); }} /></div>
        </div>
        <button className="btn btn-primary" onClick={handleReview} disabled={reviewing} style={{ marginTop: 4 }}>
          {reviewing ? "Loading…" : "Review This Period"}
        </button>
      </div>

      {quarters && (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Quarter</th><th style={{ textAlign: "right" }}>Amount</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {quarters.map((q) => {
                  const isExpanded = expandedKey === q.periodEnd;
                  const statusLabel = q.existingFiling ? "Filed" : "Not filed";
                  const totalDisplay = q.existingFiling ? money(q.existingFiling.amount) : money(q.suggestedAmount);
                  return (
                    <Fragment key={q.periodEnd}>
                      <tr onClick={() => setExpandedKey(isExpanded ? null : q.periodEnd)} style={{ cursor: "pointer" }}>
                        <td>{periodLabel(q.periodStart)}</td>
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
                                  <thead><tr><th>Quarter</th><th>Filed</th><th style={{ textAlign: "right" }}>Amount</th><th>Payment</th>{showClientColumn && <th>Client</th>}<th></th></tr></thead>
                                  <tbody>{renderFilingRow(q.existingFiling)}</tbody>
                                </table>
                              </div>
                            ) : (
                              <>
                                <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
                                  Suggested amount (from recorded payroll): {money(q.suggestedAmount)}. MD's real Contribution Report may include adjustments this doesn't capture — confirm before filing.
                                </p>
                                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                                  <div className="field" style={{ margin: 0, maxWidth: 130 }}>
                                    <label htmlFor={`mdui-amt-${q.periodEnd}`}>Amount</label>
                                    <input id={`mdui-amt-${q.periodEnd}`} type="number" step="0.01" min="0"
                                      value={quarterInputs[q.periodEnd]?.amount ?? ""}
                                      onChange={(e) => setQuarterInputs((p) => ({ ...p, [q.periodEnd]: { ...p[q.periodEnd], amount: e.target.value } }))} />
                                  </div>
                                  <div className="field" style={{ margin: 0, maxWidth: 170 }}>
                                    <label htmlFor={`mdui-filed-${q.periodEnd}`}>Filed Date</label>
                                    <input id={`mdui-filed-${q.periodEnd}`} type="date"
                                      value={quarterInputs[q.periodEnd]?.filedDate ?? ""}
                                      onChange={(e) => setQuarterInputs((p) => ({ ...p, [q.periodEnd]: { ...p[q.periodEnd], filedDate: e.target.value } }))} />
                                  </div>
                                  <div className="field" style={{ margin: 0, maxWidth: 170 }}>
                                    <label htmlFor={`mdui-paid-${q.periodEnd}`}>Payment Date (optional)</label>
                                    <input id={`mdui-paid-${q.periodEnd}`} type="date"
                                      value={quarterInputs[q.periodEnd]?.paidDate ?? ""}
                                      onChange={(e) => setQuarterInputs((p) => ({ ...p, [q.periodEnd]: { ...p[q.periodEnd], paidDate: e.target.value } }))} />
                                  </div>
                                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 10 }}>
                                    <input type="checkbox" checked={quarterInputs[q.periodEnd]?.notify ?? true}
                                      onChange={(e) => setQuarterInputs((p) => ({ ...p, [q.periodEnd]: { ...p[q.periodEnd], notify: e.target.checked } }))} />
                                    Notify client
                                  </label>
                                </div>
                                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                                  <button className="btn btn-primary" disabled={filingBusy !== null || !quarterInputs[q.periodEnd]?.filedDate} onClick={() => handleMarkFiled(q)}>
                                    {filingBusy === q.periodEnd ? "Filing…" : "Mark Filed"}
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
                {!quarters.length && <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 16 }}>No quarters in this range.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowHistory((v) => !v)}
        style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", padding: 0, border: "none", background: "none", cursor: "pointer", textDecoration: "underline", color: "inherit", font: "inherit", display: "block" }}
      >
        History ({(history || []).length})
      </button>
      {showHistory && (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }} className="muted">
              <input type="checkbox" checked={showClientColumn} onChange={(e) => setShowClientColumn(e.target.checked)} />
              Show Client column
            </label>
            <input type="date" value={historyDateFrom} onChange={(e) => setHistoryDateFrom(e.target.value)} style={{ padding: "4px 6px" }} />
            <span className="muted">to</span>
            <input type="date" value={historyDateTo} onChange={(e) => setHistoryDateTo(e.target.value)} style={{ padding: "4px 6px" }} />
            {(historyDateFrom || historyDateTo) && (
              <button type="button" className="ghost-button" onClick={() => { setHistoryDateFrom(""); setHistoryDateTo(""); }}>All time</button>
            )}
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Quarter</th><th>Filed</th><th style={{ textAlign: "right" }}>Amount</th><th>Payment</th>{showClientColumn && <th>Client</th>}<th></th></tr></thead>
                <tbody>
                  {(history || [])
                    .filter((f) => (!historyDateFrom || f.period_start >= historyDateFrom) && (!historyDateTo || f.period_end <= historyDateTo))
                    .map((f) => renderFilingRow(f))}
                  {history && !history.length && (
                    <tr><td colSpan={showClientColumn ? 6 : 5} className="muted" style={{ textAlign: "center", padding: 20 }}>No MD UI filings recorded yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
