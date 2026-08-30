import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";
import { useToast } from "./Toast";
import { useConfirm } from "./ConfirmProvider";

interface AnnualReportFiling {
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
/** MD's real, fixed statutory deadline (April 15 of the following year) — matches TR-007's rule config (due_day=15, due_month=4), same convention as mdFiling.ts's mdDueDateForPeriod being a hardcoded statutory fact rather than derived from an editable rule. */
function annualReportDueDate(reportYear: number): string {
  return `${reportYear + 1}-04-15`;
}

export function AnnualReportSection({ clientId }: { clientId: string }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [filings, setFilings] = useState<AnnualReportFiling[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [filedDate, setFiledDate] = useState("");
  const [amount, setAmount] = useState("75.00");
  const [paidDate, setPaidDate] = useState("");
  const [notify, setNotify] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [recordPaymentDates, setRecordPaymentDates] = useState<Record<string, string>>({});

  function load() {
    setLoading(true);
    api.get<{ filings: AnnualReportFiling[] }>(`/annual-report-filings?clientId=${clientId}`)
      .then((r) => setFilings(r.filings))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load Annual Report filings."))
      .finally(() => setLoading(false));
  }
  useEffect(load, [clientId]);

  const alreadyFiled = filings.some((f) => f.period_start.slice(0, 4) === String(year));

  async function handleMarkFiled() {
    if (!filedDate) return;
    setSubmitting(true);
    try {
      await api.post("/annual-report-filings/mark-filed", {
        clientId, periodStart: `${year}-01-01`, periodEnd: `${year}-12-31`,
        filedDate, amount: Number(amount), paidDate: paidDate || undefined,
        dueDate: annualReportDueDate(year), notify,
      });
      toast(notify ? "Filed and confirmation sent to the client." : "Filed.");
      setFiledDate(""); setPaidDate("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not mark this Annual Report filed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecordPayment(f: AnnualReportFiling) {
    const date = recordPaymentDates[f.period_end];
    if (!date) return;
    try {
      await api.post(`/annual-report-filings/${clientId}/${f.period_end}/record-payment`, { paidDate: date });
      toast("Payment recorded.");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record this payment.");
    }
  }

  async function handleUnmark(f: AnnualReportFiling) {
    const ok = await confirmDialog({
      title: "Undo this Annual Report filing", message: `Removes the record for ${f.period_start.slice(0, 4)} entirely — it can be filed again from scratch afterward.`, confirmLabel: "Undo",
    });
    if (!ok) return;
    try {
      await api.post(`/annual-report-filings/${clientId}/${f.period_end}/unmark`, {});
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
          <div className="field" style={{ maxWidth: 120 }}>
            <label>Report Year</label>
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || currentYear)} />
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
        {alreadyFiled && <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>{year} has already been filed — this will update the existing record.</p>}
      </div>

      <h3>History</h3>
      {loading ? <p className="muted">Loading…</p> : filings.length === 0 ? <p className="muted">No Annual Report filings yet.</p> : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Year</th><th>Filed</th><th>Amount</th><th>Payment</th><th>Client</th><th></th></tr></thead>
              <tbody>
                {filings.map((f) => (
                  <tr key={f.period_end}>
                    <td>{f.period_start.slice(0, 4)}</td>
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
