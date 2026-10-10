import { DateInput } from "./DateInput";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";
import { useConfirm, usePrompt, useNotify } from "./ConfirmProvider";

interface PeriodRow {
  start: string; end: string; dueDate: string; targetFilingDate: string;
  taxDue: number; onTime: boolean; penalty: number; interest: number; monthsLate: number; balanceDue: number;
  latePenaltyComputed: boolean;
  filedDate: string; paidDate: string; markedFiledDate: string | null; markedPaidDate: string | null;
  acknowledgedAt: string | null; sentAt: string | null;
}
interface Breakdown { periods: PeriodRow[]; totals: { taxDue: number; penalty: number; interest: number; balanceDue: number } }
interface StateInfo {
  state: string; isHome: boolean; employees: number; withheld: number; supportedState: boolean;
  frequency: string | null; frequencyConfirmed: boolean; supportedFrequencies: string[];
}
interface Meta {
  state: string; homeState?: string; isHome?: boolean; frequency: string | null; frequencyRaw: string | null; supported: boolean;
  agency: string; formName: string | null; hasLateCharges: boolean; supportedFrequencies: string[];
}
interface ExcludedRow { start: string; end: string; reason: string | null; excludedBy: string | null; excludedAt: string }

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function money(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}
function todayStr(): string { return new Date().toISOString().slice(0, 10); }
function yearBounds(year: number): { from: string; to: string } { return { from: `${year}-01-01`, to: `${year}-12-31` }; }

const PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  { label: "This year", range: () => yearBounds(new Date().getFullYear()) },
  { label: "Last year", range: () => yearBounds(new Date().getFullYear() - 1) },
  {
    label: "Last 12 months",
    range: () => {
      const end = new Date(); const start = new Date(end.getFullYear(), end.getMonth() - 11, 1);
      return { from: start.toISOString().slice(0, 10), to: todayStr() };
    },
  },
];

/**
 * Withholding — employer state income tax filing tracker, run the same way as
 * the sales tax filing table: periods from the client's withholding frequency,
 * the amount withheld from recorded paychecks, a due date and target filing
 * date per period, penalty/interest where the state's rules are built, then
 * Mark Filed / Record Payment / Send confirmation / Edit / Delete, plus a
 * History and an Excluded list. See src/common/withholdingFiling.ts.
 */
export function WithholdingSection({ clientId }: { clientId: string }) {
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();
  const notify = useNotify();
  const initial = PRESETS[0].range();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [filedDate, setFiledDate] = useState(todayStr());
  const [paidDate, setPaidDate] = useState(todayStr());

  const [states, setStates] = useState<StateInfo[] | null>(null);
  const [workState, setWorkState] = useState<string | null>(null);
  const [freqDraft, setFreqDraft] = useState("");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [history, setHistory] = useState<PeriodRow[] | null>(null);
  const [excluded, setExcluded] = useState<ExcludedRow[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [showClientColumn, setShowClientColumn] = useState(true);

  const [busyEnd, setBusyEnd] = useState<string | null>(null);
  const [pickingEnd, setPickingEnd] = useState<string | null>(null);
  const [pickFiled, setPickFiled] = useState("");
  const [pickPaid, setPickPaid] = useState("");
  const [pickAmount, setPickAmount] = useState("");
  const [payingEnd, setPayingEnd] = useState<string | null>(null);
  const [payDate, setPayDate] = useState("");
  const [editingEnd, setEditingEnd] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ filedDate: "", paidDate: "", taxDue: "" });

  useEffect(() => { setFreqDraft(""); }, [workState]);
  const reload = () => setReloadKey((k) => k + 1);
  /** "state=XX" as a query fragment — prefix "&" to append to existing params, "?" to start them (then no trailing "&"). */
  function stateQ(prefix: "&" | "?", last = false): string {
    if (!workState) return prefix === "?" && last ? "" : "";
    return prefix === "&" ? `state=${workState}&` : `?state=${workState}`;
  }

  // Which states this client has withholding in (their own, plus any state an employee lives in).
  useEffect(() => {
    api.get<{ states: StateInfo[] }>(`/withholding-filings/${clientId}/states`)
      .then((r) => {
        setStates(r.states);
        setWorkState((cur) => (cur && r.states.some((x) => x.state === cur) ? cur : r.states[0]?.state ?? null));
      })
      .catch(() => setStates([]));
  }, [clientId, reloadKey]);

  useEffect(() => {
    if (states === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<{ meta: Meta; breakdown: Breakdown | null }>(
      `/withholding-filings/${clientId}?${stateQ("&")}from=${from}&to=${to}&filedDate=${filedDate}&paidDate=${paidDate}`
    )
      .then((r) => { if (!cancelled) { setMeta(r.meta); setBreakdown(r.breakdown); } })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load withholding periods."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, workState, states === null, from, to, filedDate, paidDate, reloadKey]);

  useEffect(() => {
    if (states === null) return;
    api.get<{ periods: PeriodRow[] }>(`/withholding-filings/${clientId}/history${stateQ("?", true)}`).then((r) => setHistory(r.periods)).catch(() => setHistory([]));
    api.get<{ excluded: ExcludedRow[] }>(`/withholding-filings/${clientId}/excluded-periods${stateQ("?", true)}`).then((r) => setExcluded(r.excluded)).catch(() => setExcluded([]));
  }, [clientId, workState, states === null, reloadKey]);

  async function run(end: string, work: () => Promise<void>, failure: string) {
    setBusyEnd(end);
    try { await work(); reload(); } catch (err) { await notify(err instanceof ApiError ? err.message : failure); } finally { setBusyEnd(null); }
  }

  async function handleMarkFiled(p: PeriodRow, sendConfirmation: boolean) {
    const ok = await confirmDialog({
      title: "Mark period filed?",
      message: `Confirm ${meta?.state} actually received this filing${pickPaid ? "/payment" : ""}. Period ${fmtDate(p.start)} through ${fmtDate(p.end)}, filed ${fmtDate(pickFiled)}${pickPaid ? `, paid ${fmtDate(pickPaid)}` : " (payment not yet made)"}, ${money(pickAmount)} withheld.${sendConfirmation ? " The client will be sent a filing confirmation." : ""}`,
      confirmLabel: sendConfirmation ? "Save and Send" : "Save and Close",
    });
    if (!ok) return;
    await run(p.end, async () => {
      const res = await api.post<{ notified?: boolean; noContact?: boolean }>(`/withholding-filings/${clientId}/mark-filed`, { state: workState,
        periodStart: p.start, periodEnd: p.end, filedDate: pickFiled, paidDate: pickPaid || undefined, taxDue: Number(pickAmount), notify: sendConfirmation,
      });
      setPickingEnd(null);
      if (sendConfirmation && res.notified === false) {
        await notify("Filed, but no confirmation could be sent — this client has no email or phone on file (or both are opted out). Add contact info on the client's profile, then use Send on this row to try again.");
      }
    }, "Could not mark this period filed.");
  }

  async function handleDelete(p: PeriodRow) {
    const ok = await confirmDialog({
      title: "Delete this filing",
      message: `Removes the filing record for ${fmtDate(p.start)} – ${fmtDate(p.end)} so it can be filed again from scratch.`,
      confirmLabel: "Delete", danger: true,
    });
    if (!ok) return;
    await run(p.end, async () => { await api.post(`/withholding-filings/${clientId}/unmark`, { state: workState, periodEnd: p.end }); }, "Could not delete this filing.");
  }

  async function handleExclude(p: PeriodRow) {
    const reason = await promptFor({
      title: "Exclude this period?",
      message: `${fmtDate(p.start)} through ${fmtDate(p.end)} will stop appearing here — use this when there was no actual filing obligation that period. You can restore it later from the "Excluded" list below. Optionally, say why:`,
      placeholder: "Reason (optional)",
      required: false,
    });
    if (reason === null) return;
    await run(p.end, async () => {
      await api.post(`/withholding-filings/${clientId}/exclude-period`, { state: workState, periodStart: p.start, periodEnd: p.end, reason: reason || undefined });
    }, "Could not exclude this period.");
  }

  function renderRow(p: PeriodRow) {
    const paidByNow = Boolean(p.markedPaidDate) && p.markedPaidDate!.slice(0, 10) <= todayStr();
    const busy = busyEnd === p.end;
    const showCharges = !(p.markedFiledDate && !paidByNow) && !p.onTime;
    return (
      <tr key={`${p.start}-${p.end}`}>
        <td>{fmtDate(p.start)} – {fmtDate(p.end)}</td>
        <td>{fmtDate(p.dueDate)}</td>
        <td className="muted">{fmtDate(p.targetFilingDate)}</td>
        <td>{money(p.taxDue)}</td>
        <td className={p.onTime && !p.markedFiledDate ? "muted" : ""} style={!p.onTime && !paidByNow ? { color: "var(--red)", fontWeight: 600 } : p.markedFiledDate && !paidByNow ? { color: "var(--amber)", fontWeight: 600 } : undefined}>
          {paidByNow ? <span style={{ color: "var(--teal)" }}>✓ Filed</span> : p.markedFiledDate ? (p.markedPaidDate ? "Filed — payment scheduled" : "Filed — payment pending") : p.onTime ? "On time" : `Late — ${p.monthsLate} mo`}
        </td>
        <td>{!meta?.hasLateCharges ? <span className="muted" title="Penalty isn't calculated for this state yet">n/a</span> : showCharges ? money(p.penalty) : "—"}</td>
        <td>{!meta?.hasLateCharges ? <span className="muted" title="Interest isn't calculated for this state yet">n/a</span> : showCharges ? money(p.interest) : "—"}</td>
        <td style={{ fontWeight: 700 }}>{money(p.balanceDue)}</td>
        {showClientColumn && <td>{p.acknowledgedAt ? <span style={{ color: "var(--teal)" }}>✓ Client confirmed</span> : <span className="muted">Awaiting client confirmation</span>}</td>}
        <td>
          {editingEnd === p.end ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 180 }}>
              <label style={{ fontSize: 11 }} htmlFor={`wh-edit-filed-${p.end}`}>Filed Date</label>
              <DateInput id={`wh-edit-filed-${p.end}`} value={editForm.filedDate} onChange={(e) => setEditForm((s) => ({ ...s, filedDate: e.target.value }))} style={{ padding: "2px 4px", fontSize: 11.5 }} />
              <label style={{ fontSize: 11 }} htmlFor={`wh-edit-paid-${p.end}`}>Payment Date (optional)</label>
              <DateInput id={`wh-edit-paid-${p.end}`} value={editForm.paidDate} onChange={(e) => setEditForm((s) => ({ ...s, paidDate: e.target.value }))} style={{ padding: "2px 4px", fontSize: 11.5 }} />
              <label style={{ fontSize: 11 }} htmlFor={`wh-edit-tax-${p.end}`}>Tax Withheld</label>
              <input id={`wh-edit-tax-${p.end}`} type="number" step="0.01" min="0" value={editForm.taxDue} onChange={(e) => setEditForm((s) => ({ ...s, taxDue: e.target.value }))} style={{ padding: "2px 4px", fontSize: 11.5 }} />
              <div style={{ display: "flex", gap: 4 }}>
                <button type="button" className="btn btn-sm btn-primary" disabled={busy || !editForm.filedDate || editForm.taxDue === ""} onClick={() => run(p.end, async () => {
                  await api.post(`/withholding-filings/${clientId}/edit`, { state: workState, periodEnd: p.end, filedDate: editForm.filedDate, paidDate: editForm.paidDate || undefined, taxDue: Number(editForm.taxDue) });
                  setEditingEnd(null);
                }, "Could not save this correction.")}>{busy ? "…" : "Save"}</button>
                <button type="button" className="btn btn-sm" onClick={() => setEditingEnd(null)}>Cancel</button>
              </div>
            </div>
          ) : p.markedFiledDate ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {!p.markedPaidDate && (payingEnd === p.end ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 160 }}>
                  <DateInput value={payDate} onChange={(e) => setPayDate(e.target.value)} title="Actual payment date" style={{ padding: "2px 4px", fontSize: 11.5 }} />
                  <div style={{ display: "flex", gap: 4 }}>
                    <button type="button" className="btn btn-sm btn-primary" disabled={busy || !payDate} onClick={() => run(p.end, async () => {
                      await api.post(`/withholding-filings/${clientId}/record-payment`, { state: workState, periodEnd: p.end, paidDate: payDate });
                      setPayingEnd(null);
                    }, "Could not record this payment.")}>{busy ? "…" : "Record"}</button>
                    <button type="button" className="btn btn-sm" onClick={() => setPayingEnd(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => { setPayingEnd(p.end); setPayDate(p.dueDate); }}>Record Payment</button>
              ))}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                {p.sentAt ? (
                  <span className="muted" style={{ fontSize: 11 }} title={`Confirmation sent ${fmtDate(p.sentAt)}`}>✓ Sent {fmtDate(p.sentAt)}</span>
                ) : (
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(p.end, async () => { await api.post(`/withholding-filings/${clientId}/send`, { state: workState, periodEnd: p.end }); }, "Could not send this confirmation.")}>{busy ? "…" : "Send"}</button>
                )}
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => { setEditingEnd(p.end); setEditForm({ filedDate: (p.markedFiledDate || "").slice(0, 10), paidDate: (p.markedPaidDate || "").slice(0, 10), taxDue: String(p.taxDue) }); }}>Edit</button>
                <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => handleDelete(p)}>Delete</button>
              </div>
            </div>
          ) : pickingEnd === p.end ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 190 }}>
              <label style={{ fontSize: 11 }}>Filed date</label>
              <DateInput value={pickFiled} onChange={(e) => setPickFiled(e.target.value)} style={{ padding: "2px 4px", fontSize: 11.5 }} />
              <label style={{ fontSize: 11 }}>Payment date (optional)</label>
              <DateInput value={pickPaid} onChange={(e) => setPickPaid(e.target.value)} style={{ padding: "2px 4px", fontSize: 11.5 }} />
              <label style={{ fontSize: 11 }}>Tax withheld</label>
              <input type="number" step="0.01" min="0" value={pickAmount} onChange={(e) => setPickAmount(e.target.value)} title="Pre-filled from recorded paychecks — correct it if the return differs" style={{ padding: "2px 4px", fontSize: 11.5 }} />
              <div style={{ display: "flex", gap: 4 }}>
                <button type="button" className="btn btn-sm" disabled={busy || !pickFiled || pickAmount === ""} onClick={() => handleMarkFiled(p, false)}>{busy ? "…" : "Save and Close"}</button>
                <button type="button" className="btn btn-sm btn-primary" disabled={busy || !pickFiled || pickAmount === ""} onClick={() => handleMarkFiled(p, true)}>{busy ? "…" : "Save and Send"}</button>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => setPickingEnd(null)}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-sm" disabled={busy} title="Enter this period's actual filed date (and payment date, if already paid)"
                onClick={() => { setPickingEnd(p.end); setPickFiled(p.dueDate); setPickPaid(""); setPickAmount(String(p.taxDue)); }}>Mark Filed</button>
              <button type="button" className="btn btn-sm btn-danger" disabled={busy} title="No actual obligation this period — exclude it. Restorable from the Excluded list below." onClick={() => handleExclude(p)}>{busy ? "…" : "Delete"}</button>
            </div>
          )}
        </td>
      </tr>
    );
  }

  /** Total row under a period table — sums exactly what the rows display
   * (late charges only count on rows that show them). */
  function renderTotalRow(rows: PeriodRow[]) {
    if (!rows.length) return null;
    const cents = (vals: number[]) => Math.round(vals.reduce((a, v) => a + (Number(v) || 0) * 100, 0)) / 100;
    const charged = (p: PeriodRow) => {
      const paidByNow = Boolean(p.markedPaidDate) && p.markedPaidDate!.slice(0, 10) <= todayStr();
      return !(p.markedFiledDate && !paidByNow) && !p.onTime;
    };
    const built = Boolean(meta?.hasLateCharges);
    return (
      <tfoot>
        <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border, #d0d7de)" }}>
          <td colSpan={3}>Total ({rows.length} period{rows.length === 1 ? "" : "s"})</td>
          <td>{money(cents(rows.map((p) => p.taxDue)))}</td>
          <td></td>
          <td>{built ? money(cents(rows.map((p) => (charged(p) ? p.penalty : 0)))) : <span className="muted">n/a</span>}</td>
          <td>{built ? money(cents(rows.map((p) => (charged(p) ? p.interest : 0)))) : <span className="muted">n/a</span>}</td>
          <td>{money(cents(rows.map((p) => p.balanceDue)))}</td>
          {showClientColumn && <td></td>}
          <td></td>
        </tr>
      </tfoot>
    );
  }

  const head = (
    <tr>
      <th>Period</th><th>Due Date</th><th>Target Filing Date</th><th>Tax Withheld</th><th>Status</th><th>Penalty</th><th>Interest</th><th>Balance Due</th>
      {showClientColumn && <th>Client</th>}<th>Filed</th>
    </tr>
  );

  return (
    <div>
      {error && <ErrorBanner error={error} />}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, margin: "0 0 4px" }}>Withholding Filing{meta ? ` — ${meta.state}` : ""}</h3>
        {meta && (
          <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
            {meta.agency}{meta.frequency ? ` · ${meta.frequency}` : ""}{meta.formName ? ` · ${meta.formName}` : ""}. The amount withheld comes from this client's recorded paychecks
            (only employees whose payroll state is {meta.state}). {meta.hasLateCharges ? "Late penalty and interest are calculated from the filed and payment dates." : `Penalty and interest aren't calculated for ${meta.state} yet — due dates, filing, payment and client confirmation are all tracked.`}
          </p>
        )}

        {states && states.length > 0 && (states.length > 1 || states.some((x) => !x.isHome)) && (
          <div style={{ margin: "0 0 12px" }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              An employee's home state decides whose income tax is withheld, so each state with employees needs its own withholding filings.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {states.map((st) => (
                <button key={st.state} type="button" onClick={() => setWorkState(st.state)}
                  style={{
                    padding: "8px 12px", borderRadius: 8, cursor: "pointer", font: "inherit", textAlign: "left",
                    border: workState === st.state ? "2px solid var(--teal)" : "1px solid var(--line)", background: workState === st.state ? "var(--surface-2, #f0f7f6)" : "transparent", color: "inherit",
                  }}>
                  <div style={{ fontWeight: 700 }}>{st.state}{st.isHome ? " · client's state" : ""}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>{st.employees} employee{st.employees === 1 ? "" : "s"} · {money(st.withheld)} withheld</div>
                  {!st.supportedState && <div style={{ fontSize: 11, color: "var(--red)" }}>Not built yet</div>}
                </button>
              ))}
            </div>
            {meta && !meta.isHome && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <label htmlFor="wh-state-freq" style={{ fontSize: 12.5 }}>{meta.state} filing frequency</label>
                <select id="wh-state-freq" value={freqDraft || meta.frequency || ""} onChange={(e) => setFreqDraft(e.target.value)} style={{ padding: "4px 6px" }}>
                  <option value="" disabled>Choose…</option>
                  {meta.supportedFrequencies.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <button type="button" className="btn btn-sm" disabled={!(freqDraft || meta.frequency)} onClick={async () => {
                  try {
                    await api.post(`/withholding-filings/${clientId}/state-frequency`, { state: meta.state, frequency: freqDraft || meta.frequency });
                    setFreqDraft(""); reload();
                  } catch (err) { await notify(err instanceof ApiError ? err.message : "Could not save this frequency."); }
                }}>Save</button>
                {states.find((x) => x.state === meta.state)?.frequencyConfirmed === false && (
                  <span className="muted" style={{ fontSize: 11.5 }}>Not set yet — showing the client's own frequency until you save one for {meta.state}.</span>
                )}
              </div>
            )}
          </div>
        )}

        {meta && !meta.supported ? (
          <p style={{ fontSize: 13, color: "var(--red)", margin: 0 }}>
            {meta.frequency === null
              ? "Set this client's Withholding Frequency on their profile (Payroll Details) to see their filing periods."
              : `${meta.state} doesn't have a ${meta.frequency.toLowerCase()} withholding schedule — change the client's Withholding Frequency to ${meta.supportedFrequencies.join(", ").toLowerCase()}.`}
          </p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              {PRESETS.map((pr) => <button key={pr.label} type="button" className="btn btn-sm" onClick={() => { const r = pr.range(); setFrom(r.from); setTo(r.to); }}>{pr.label}</button>)}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div className="field" style={{ maxWidth: 170, margin: 0 }}><label htmlFor="wh-from">From</label><DateInput id="wh-from" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="field" style={{ maxWidth: 170, margin: 0 }}><label htmlFor="wh-to">To</label><DateInput id="wh-to" value={to} onChange={(e) => setTo(e.target.value)} /></div>
              <div className="field" style={{ maxWidth: 170, margin: 0 }}><label htmlFor="wh-filed">Filing date</label><DateInput id="wh-filed" value={filedDate} onChange={(e) => setFiledDate(e.target.value)} /></div>
              <div className="field" style={{ maxWidth: 170, margin: 0 }}><label htmlFor="wh-paid">Payment date</label><DateInput id="wh-paid" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} /></div>
            </div>
            <p className="muted" style={{ fontSize: 11.5, margin: "6px 0 0" }}>Filing date and payment date are used to estimate late charges for periods not yet marked filed.</p>
          </>
        )}
      </div>

      {loading && <div className="spinner-wrap">Loading…</div>}

      {breakdown && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }} className="muted">
              <input type="checkbox" checked={showClientColumn} onChange={(e) => setShowClientColumn(e.target.checked)} /> Show Client column
            </label>
          </div>
          <div className="table-scroll">
            <table>
              <thead>{head}</thead>
              <tbody>
                {breakdown.periods.map((p) => renderRow(p))}
                {breakdown.periods.length === 0 && <tr><td colSpan={showClientColumn ? 10 : 9} className="muted" style={{ textAlign: "center", padding: 16 }}>No periods in this range.</td></tr>}
              </tbody>
              {renderTotalRow(breakdown.periods)}
            </table>
          </div>
          {breakdown.periods.length > 0 && (
            <div className="metric-grid metric-grid-2" style={{ marginTop: 12 }}>
              <div className="metric"><div className="metric-label">Total Penalty + Interest</div><div className="metric-value">{meta?.hasLateCharges ? money(breakdown.totals.penalty + breakdown.totals.interest) : "n/a"}</div></div>
              <div className="metric"><div className="metric-label">Total Balance Due</div><div className="metric-value">{money(breakdown.totals.balanceDue)}</div></div>
            </div>
          )}
        </div>
      )}

      <div style={{ margin: "0 0 16px" }}>
        <button type="button" className="small-label" onClick={() => setShowHistory((v) => !v)}
          style={{ margin: "0 0 6px", padding: 0, border: "none", background: "none", font: "inherit", color: "inherit", display: "block", cursor: "pointer", textDecoration: "underline" }}>
          History ({history?.length ?? 0})
        </button>
        {showHistory && (history === null ? <p className="muted" style={{ fontSize: 12.5 }}>Loading…</p> : history.length === 0 ? <p className="muted" style={{ fontSize: 12.5 }}>No withholding filings recorded yet.</p> : (
          <div className="table-scroll"><table><thead>{head}</thead><tbody>{history.map((p) => renderRow(p))}</tbody>{renderTotalRow(history)}</table></div>
        ))}
      </div>

      <div style={{ margin: "0 0 16px" }}>
        <button type="button" className="small-label" onClick={() => setShowExcluded((v) => !v)}
          style={{ margin: "0 0 6px", padding: 0, border: "none", background: "none", font: "inherit", color: "inherit", display: "block", cursor: "pointer", textDecoration: "underline" }}>
          Excluded ({excluded?.length ?? 0})
        </button>
        {showExcluded && (excluded === null ? <p className="muted" style={{ fontSize: 12.5 }}>Loading…</p> : excluded.length === 0 ? <p className="muted" style={{ fontSize: 12.5 }}>No periods excluded.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th scope="col">Period</th><th scope="col">Reason</th><th scope="col">Excluded</th><th scope="col"></th></tr></thead>
              <tbody>
                {excluded.map((p) => (
                  <tr key={p.end}>
                    <td>{fmtDate(p.start)} – {fmtDate(p.end)}</td>
                    <td className="muted">{p.reason || "—"}</td>
                    <td className="muted">{fmtDate(p.excludedAt)}{p.excludedBy ? ` by ${p.excludedBy}` : ""}</td>
                    <td><button type="button" className="btn btn-sm" disabled={busyEnd === p.end} onClick={() => run(p.end, async () => { await api.post(`/withholding-filings/${clientId}/restore-period`, { state: workState, periodEnd: p.end }); }, "Could not restore this period.")}>{busyEnd === p.end ? "…" : "Restore"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
