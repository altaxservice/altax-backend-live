import { Fragment, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";
import { useToast } from "./Toast";
import { useConfirm } from "./ConfirmProvider";

interface AnnualReportFiling {
  client_id: string; period_start: string; period_end: string;
  filed_date: string; paid_date: string | null; amount: number;
  share_token: string | null; acknowledged_at: string | null; sent_at: string | null;
}
interface AnnualReportYearReview {
  periodStart: string; periodEnd: string; reportYear: number;
  dueDate: string; suggestedAmount: number | null; existingFiling: AnnualReportFiling | null;
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
function todayStr(): string { return new Date().toISOString().slice(0, 10); }
const PERIOD_PRESETS = [
  { label: "This Year", range: () => { const y = new Date().getFullYear(); return { start: `${y}-01-01`, end: `${y}-12-31` }; } },
  { label: "Last Year", range: () => { const y = new Date().getFullYear() - 1; return { start: `${y}-01-01`, end: `${y}-12-31` }; } },
  { label: "Last 3 Years", range: () => { const y = new Date().getFullYear(); return { start: `${y - 2}-01-01`, end: `${y}-12-31` }; } },
];

export function AnnualReportSection({ clientId }: { clientId: string }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [error, setError] = useState<string | null>(null);

  const initial = PERIOD_PRESETS[0].range();
  const [periodStart, setPeriodStart] = useState(initial.start);
  const [periodEnd, setPeriodEnd] = useState(initial.end);
  const [reviewing, setReviewing] = useState(false);
  const [years, setYears] = useState<AnnualReportYearReview[] | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [yearInputs, setYearInputs] = useState<Record<string, { amount: string; filedDate: string; paidDate: string; notify: boolean }>>({});
  const [filingBusy, setFilingBusy] = useState<string | null>(null);

  const [history, setHistory] = useState<AnnualReportFiling[] | null>(null);
  function loadHistory() {
    api.get<{ filings: AnnualReportFiling[] }>(`/annual-report-filings?clientId=${clientId}`)
      .then((r) => setHistory(r.filings.map((f) => ({ ...f, period_end: f.period_end.slice(0, 10) }))))
      .catch(() => setHistory([]));
  }
  useEffect(loadHistory, [clientId]);
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");

  const [payingKey, setPayingKey] = useState<string | null>(null);
  const [payingDate, setPayingDate] = useState(todayStr());
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  function applyPreset(p: (typeof PERIOD_PRESETS)[number]) {
    const r = p.range();
    setPeriodStart(r.start); setPeriodEnd(r.end); setYears(null);
  }

  async function handleReview() {
    setReviewing(true);
    setError(null);
    try {
      const res = await api.get<{ years: AnnualReportYearReview[] }>(
        `/annual-report-filings/review?clientId=${clientId}&periodStart=${periodStart}&periodEnd=${periodEnd}`
      );
      setYears(res.years);
      const inputs: typeof yearInputs = {};
      for (const y of res.years) {
        if (!y.existingFiling) inputs[y.periodEnd] = { amount: (y.suggestedAmount ?? 75).toFixed(2), filedDate: "", paidDate: "", notify: true };
      }
      setYearInputs((prev) => ({ ...prev, ...inputs }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this period.");
    } finally {
      setReviewing(false);
    }
  }

  async function handleMarkFiled(y: AnnualReportYearReview) {
    const input = yearInputs[y.periodEnd];
    if (!input?.filedDate) return;
    setFilingBusy(y.periodEnd);
    try {
      await api.post("/annual-report-filings/mark-filed", {
        clientId, periodStart: y.periodStart, periodEnd: y.periodEnd,
        filedDate: input.filedDate, amount: Number(input.amount), paidDate: input.paidDate || undefined, notify: input.notify,
      });
      toast(input.notify ? "Filed and confirmation sent to the client." : "Filed.");
      handleReview();
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not mark this Annual Report filed.");
    } finally {
      setFilingBusy(null);
    }
  }

  async function handleRecordPayment(f: AnnualReportFiling) {
    setRowBusy(`${f.period_end}:pay`);
    try {
      await api.post(`/annual-report-filings/${clientId}/${f.period_end}/record-payment`, { paidDate: payingDate });
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
  async function handleSendConfirmation(f: AnnualReportFiling) {
    setRowBusy(`${f.period_end}:send`);
    try {
      await api.post(`/annual-report-filings/${clientId}/${f.period_end}/send`, {});
      toast("Filing confirmation sent.");
      handleReview();
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send this confirmation.");
    } finally {
      setRowBusy(null);
    }
  }

  async function handleUndo(f: AnnualReportFiling) {
    const ok = await confirmDialog({
      title: "Undo this Annual Report filing", message: `Removes the record for ${f.period_start.slice(0, 4)} entirely — it can be filed again from scratch afterward.`, confirmLabel: "Undo",
    });
    if (!ok) return;
    setRowBusy(`${f.period_end}:undo`);
    try {
      await api.post(`/annual-report-filings/${clientId}/${f.period_end}/unmark`, {});
      toast("Undone.");
      handleReview();
      loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not undo this filing.");
    } finally {
      setRowBusy(null);
    }
  }

  function renderFilingRow(f: AnnualReportFiling) {
    return (
      <Fragment key={f.period_end}>
        <tr>
          <td>{f.period_start.slice(0, 4)}</td>
          <td>{fmtDate(f.filed_date)}</td>
          <td style={{ textAlign: "right" }}>{money(f.amount)}</td>
          <td>{f.paid_date ? <span style={{ color: "var(--teal)", fontWeight: 600 }}>Paid {fmtDate(f.paid_date)}</span> : <span className="muted">Payment pending</span>}</td>
          <td>{f.acknowledged_at ? <span style={{ color: "var(--teal)" }}>✓ Client confirmed</span> : <span className="muted">Awaiting client confirmation</span>}</td>
          <td>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {!f.paid_date && (
                <button className="btn btn-sm" onClick={() => { setPayingKey(f.period_end); setPayingDate(todayStr()); }}>Record Payment</button>
              )}
              {!f.sent_at && (
                <button className="btn btn-sm" disabled={rowBusy === `${f.period_end}:send`} onClick={() => handleSendConfirmation(f)}>{rowBusy === `${f.period_end}:send` ? "…" : "Send"}</button>
              )}
              <button className="btn btn-sm btn-danger" disabled={rowBusy === `${f.period_end}:undo`} onClick={() => handleUndo(f)}>{rowBusy === `${f.period_end}:undo` ? "…" : "Undo"}</button>
            </div>
          </td>
        </tr>
        {payingKey === f.period_end && (
          <tr>
            <td colSpan={6} style={{ background: "var(--surface-2, #f8fafb)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", padding: "8px 0" }}>
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="ar-pay-date">Payment Date</label>
                  <input id="ar-pay-date" type="date" value={payingDate} onChange={(e) => setPayingDate(e.target.value)} />
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
        Pick a date range and review — a range spanning more than one year shows one row per report year, same as EFTPS Deposits.
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
          <div className="field"><label htmlFor="ar-period-start">Period Start</label><input id="ar-period-start" type="date" value={periodStart} onChange={(e) => { setPeriodStart(e.target.value); setYears(null); }} /></div>
          <div className="field"><label htmlFor="ar-period-end">Period End</label><input id="ar-period-end" type="date" value={periodEnd} onChange={(e) => { setPeriodEnd(e.target.value); setYears(null); }} /></div>
        </div>
        <button className="btn btn-primary" onClick={handleReview} disabled={reviewing} style={{ marginTop: 4 }}>
          {reviewing ? "Loading…" : "Review This Period"}
        </button>
      </div>

      {years && (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Year</th><th style={{ textAlign: "right" }}>Amount</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {years.map((y) => {
                  const isExpanded = expandedKey === y.periodEnd;
                  const statusLabel = y.existingFiling ? "Filed" : "Not filed";
                  const totalDisplay = y.existingFiling ? money(y.existingFiling.amount) : money(y.suggestedAmount);
                  return (
                    <Fragment key={y.periodEnd}>
                      <tr onClick={() => setExpandedKey(isExpanded ? null : y.periodEnd)} style={{ cursor: "pointer" }}>
                        <td>{y.reportYear}</td>
                        <td style={{ textAlign: "right" }}>{totalDisplay}</td>
                        <td>{statusLabel}</td>
                        <td style={{ textAlign: "right" }}>{isExpanded ? "▲" : "▼"}</td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={4} style={{ background: "var(--surface-2, #f8fafb)", padding: 16 }}>
                            {y.existingFiling ? (
                              <div className="table-scroll">
                                <table>
                                  <thead><tr><th>Year</th><th>Filed</th><th style={{ textAlign: "right" }}>Amount</th><th>Payment</th><th>Client</th><th></th></tr></thead>
                                  <tbody>{renderFilingRow(y.existingFiling)}</tbody>
                                </table>
                              </div>
                            ) : (
                              <>
                                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                                  <div className="field" style={{ margin: 0, maxWidth: 130 }}>
                                    <label htmlFor={`ar-amt-${y.periodEnd}`}>Amount</label>
                                    <input id={`ar-amt-${y.periodEnd}`} type="number" step="0.01" min="0"
                                      value={yearInputs[y.periodEnd]?.amount ?? ""}
                                      onChange={(e) => setYearInputs((p) => ({ ...p, [y.periodEnd]: { ...p[y.periodEnd], amount: e.target.value } }))} />
                                  </div>
                                  <div className="field" style={{ margin: 0, maxWidth: 170 }}>
                                    <label htmlFor={`ar-filed-${y.periodEnd}`}>Filed Date</label>
                                    <input id={`ar-filed-${y.periodEnd}`} type="date"
                                      value={yearInputs[y.periodEnd]?.filedDate ?? ""}
                                      onChange={(e) => setYearInputs((p) => ({ ...p, [y.periodEnd]: { ...p[y.periodEnd], filedDate: e.target.value } }))} />
                                  </div>
                                  <div className="field" style={{ margin: 0, maxWidth: 170 }}>
                                    <label htmlFor={`ar-paid-${y.periodEnd}`}>Payment Date (optional)</label>
                                    <input id={`ar-paid-${y.periodEnd}`} type="date"
                                      value={yearInputs[y.periodEnd]?.paidDate ?? ""}
                                      onChange={(e) => setYearInputs((p) => ({ ...p, [y.periodEnd]: { ...p[y.periodEnd], paidDate: e.target.value } }))} />
                                  </div>
                                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 10 }}>
                                    <input type="checkbox" checked={yearInputs[y.periodEnd]?.notify ?? true}
                                      onChange={(e) => setYearInputs((p) => ({ ...p, [y.periodEnd]: { ...p[y.periodEnd], notify: e.target.checked } }))} />
                                    Notify client
                                  </label>
                                </div>
                                <p className="muted" style={{ fontSize: 12.5, margin: "8px 0" }}>Due {fmtDate(y.dueDate)}.</p>
                                <button className="btn btn-primary" disabled={filingBusy !== null || !yearInputs[y.periodEnd]?.filedDate} onClick={() => handleMarkFiled(y)}>
                                  {filingBusy === y.periodEnd ? "Filing…" : "Mark Filed"}
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {!years.length && <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 16 }}>No years in this range.</td></tr>}
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
            <thead><tr><th>Year</th><th>Filed</th><th style={{ textAlign: "right" }}>Amount</th><th>Payment</th><th>Client</th><th></th></tr></thead>
            <tbody>
              {(history || [])
                .filter((f) => (!historyDateFrom || f.period_start >= historyDateFrom) && (!historyDateTo || f.period_end <= historyDateTo))
                .map((f) => renderFilingRow(f))}
              {history && !history.length && (
                <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 20 }}>No Annual Report filings recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
