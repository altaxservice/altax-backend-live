import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";
import { useToast } from "./Toast";
import { useConfirm } from "./ConfirmProvider";

interface MdUiFiling {
  client_id: string; period_start: string; period_end: string;
  filed_date: string; paid_date: string | null; amount: number;
  share_token: string | null; acknowledged_at: string | null;
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
function quarterPeriod(year: number, quarter: number): { start: string; end: string } {
  const qStartMonth0 = (quarter - 1) * 3;
  const qEndMonth0 = qStartMonth0 + 2;
  const lastDay = new Date(Date.UTC(year, qEndMonth0 + 1, 0)).getUTCDate();
  return { start: `${year}-${pad2(qStartMonth0 + 1)}-01`, end: `${year}-${pad2(qEndMonth0 + 1)}-${pad2(lastDay)}` };
}
/** MD's real, fixed statutory deadline — the 24th of the month after quarter-end, matching TR-009's rule config (due_day=24), same convention as mdFiling.ts's mdDueDateForPeriod being a hardcoded statutory fact. */
function mdUiDueDate(year: number, quarter: number): string {
  const qEndMonth0 = quarter * 3 - 1;
  const dueMonth0 = qEndMonth0 === 11 ? 0 : qEndMonth0 + 1;
  const dueYear = qEndMonth0 === 11 ? year + 1 : year;
  return `${dueYear}-${pad2(dueMonth0 + 1)}-24`;
}

export function MdUiSection({ clientId }: { clientId: string }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [filings, setFilings] = useState<MdUiFiling[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [filedDate, setFiledDate] = useState("");
  const [amount, setAmount] = useState("");
  const [suggestedAmount, setSuggestedAmount] = useState<number | null>(null);
  const [paidDate, setPaidDate] = useState("");
  const [notify, setNotify] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [recordPaymentDates, setRecordPaymentDates] = useState<Record<string, string>>({});

  function load() {
    setLoading(true);
    api.get<{ filings: MdUiFiling[] }>(`/md-ui-filings?clientId=${clientId}`)
      .then((r) => setFilings(r.filings))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load MD UI filings."))
      .finally(() => setLoading(false));
  }
  useEffect(load, [clientId]);

  useEffect(() => {
    const { start, end } = quarterPeriod(year, quarter);
    api.get<{ suggestedAmount: number }>(`/md-ui-filings/suggested-amount?clientId=${clientId}&periodStart=${start}&periodEnd=${end}`)
      .then((r) => { setSuggestedAmount(r.suggestedAmount); setAmount(r.suggestedAmount.toFixed(2)); })
      .catch(() => setSuggestedAmount(null));
  }, [clientId, year, quarter]);

  const period = quarterPeriod(year, quarter);
  const periodLabel = `Q${quarter} ${year}`;
  const alreadyFiled = filings.some((f) => f.period_end === period.end);

  async function handleMarkFiled() {
    if (!filedDate) return;
    setSubmitting(true);
    try {
      await api.post("/md-ui-filings/mark-filed", {
        clientId, periodStart: period.start, periodEnd: period.end,
        filedDate, amount: Number(amount), paidDate: paidDate || undefined,
        dueDate: mdUiDueDate(year, quarter), notify,
      });
      toast(notify ? "Filed and confirmation sent to the client." : "Filed.");
      setFiledDate(""); setPaidDate("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not mark this MD UI filing filed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecordPayment(f: MdUiFiling) {
    const date = recordPaymentDates[f.period_end];
    if (!date) return;
    try {
      await api.post(`/md-ui-filings/${clientId}/${f.period_end}/record-payment`, { paidDate: date });
      toast("Payment recorded.");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record this payment.");
    }
  }

  async function handleUnmark(f: MdUiFiling) {
    const ok = await confirmDialog({
      title: "Undo this MD UI filing", message: `Removes the record for ${f.period_start.slice(0, 10)} – ${f.period_end.slice(0, 10)} entirely — it can be filed again from scratch afterward.`, confirmLabel: "Undo",
    });
    if (!ok) return;
    try {
      await api.post(`/md-ui-filings/${clientId}/${f.period_end}/unmark`, {});
      toast("Undone.");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not undo this filing.");
    }
  }

  return (
    <div>
      <ErrorBanner error={error} />
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Mark Filed</h3>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ maxWidth: 110 }}>
            <label>Year</label>
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())} />
          </div>
          <div className="field" style={{ maxWidth: 100 }}>
            <label>Quarter</label>
            <select value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
              <option value={1}>Q1</option><option value={2}>Q2</option><option value={3}>Q3</option><option value={4}>Q4</option>
            </select>
          </div>
          <div className="field" style={{ maxWidth: 170 }}>
            <label>Filed Date</label>
            <input type="date" value={filedDate} onChange={(e) => setFiledDate(e.target.value)} />
          </div>
          <div className="field" style={{ maxWidth: 130 }}>
            <label>Amount</label>
            <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field" style={{ maxWidth: 170 }}>
            <label>Payment Date (optional)</label>
            <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 10 }}>
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify client
          </label>
          <button type="button" className="btn btn-primary" disabled={submitting || !filedDate} onClick={handleMarkFiled} style={{ marginBottom: 10 }}>
            {alreadyFiled ? "Re-file" : "Mark Filed"}
          </button>
        </div>
        {suggestedAmount !== null && (
          <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
            Suggested amount for {periodLabel} (from recorded payroll): {money(suggestedAmount)}. MD's real Contribution Report may include adjustments this doesn't capture — confirm before filing.
          </p>
        )}
        {alreadyFiled && <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>{periodLabel} has already been filed — this will update the existing record.</p>}
      </div>

      <h3>History</h3>
      {loading ? <p className="muted">Loading…</p> : filings.length === 0 ? <p className="muted">No MD UI filings yet.</p> : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Period</th><th>Filed</th><th>Amount</th><th>Payment</th><th>Client</th><th></th></tr></thead>
              <tbody>
                {filings.map((f) => (
                  <tr key={f.period_end}>
                    <td>{fmtDate(f.period_start)} – {fmtDate(f.period_end)}</td>
                    <td>{fmtDate(f.filed_date)}</td>
                    <td>{money(f.amount)}</td>
                    <td>
                      {f.paid_date ? fmtDate(f.paid_date) : (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input type="date" style={{ padding: "4px 6px", fontSize: 12.5 }}
                            value={recordPaymentDates[f.period_end] || ""}
                            onChange={(e) => setRecordPaymentDates((prev) => ({ ...prev, [f.period_end]: e.target.value }))} />
                          <button type="button" className="btn btn-sm btn-primary" disabled={!recordPaymentDates[f.period_end]} onClick={() => handleRecordPayment(f)}>Record</button>
                        </div>
                      )}
                    </td>
                    <td>{f.acknowledged_at ? <span style={{ color: "var(--teal)" }}>✓ Acknowledged</span> : <span className="muted">Pending</span>}</td>
                    <td><button type="button" className="btn btn-sm" onClick={() => handleUnmark(f)}>Undo</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
