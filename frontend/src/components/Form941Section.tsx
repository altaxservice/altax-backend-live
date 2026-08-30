import { useEffect, useState } from "react";
import { api, ApiError, viewFile, downloadFile } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";
import { useToast } from "./Toast";
import { useConfirm } from "./ConfirmProvider";

interface Form941Filing {
  client_id: string; period_start: string; period_end: string; quarter: number;
  filed_date: string; paid_date: string | null;
  gross_liability: number; eftps_deposits_applied: number; balance_due: number;
  share_token: string | null; acknowledged_at: string | null;
}
interface Form941Preview {
  employeeCount: number; wages: number; federalWithholding: number;
  socialSecurityWages: number; medicareWages: number; grossLiability: number;
  eftpsDepositsApplied: number; balanceDue: number; periodStart: string; periodEnd: string; dueDate: string;
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

export function Form941Section({ clientId }: { clientId: string }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [filings, setFilings] = useState<Form941Filing[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [preview, setPreview] = useState<Form941Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [filedDate, setFiledDate] = useState("");
  const [paidDate, setPaidDate] = useState("");
  const [notify, setNotify] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [recordPaymentDates, setRecordPaymentDates] = useState<Record<string, string>>({});

  function load() {
    setLoading(true);
    api.get<{ filings: Form941Filing[] }>(`/form941-filings?clientId=${clientId}`)
      // period_end comes back as a full ISO datetime (Postgres DATE columns
      // serialize via Date.toJSON()) — normalized to YYYY-MM-DD here, once,
      // so every downstream use (URL paths, the recordPaymentDates map key,
      // the alreadyFiled equality check) works with a clean date string.
      .then((r) => setFilings(r.filings.map((f) => ({ ...f, period_end: f.period_end.slice(0, 10) }))))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load Form 941 filings."))
      .finally(() => setLoading(false));
  }
  useEffect(load, [clientId]);

  useEffect(() => {
    setPreviewLoading(true);
    api.get<Form941Preview>(`/form941-filings/preview?clientId=${clientId}&year=${year}&quarter=${quarter}`)
      .then(setPreview)
      .catch(() => setPreview(null))
      .finally(() => setPreviewLoading(false));
  }, [clientId, year, quarter]);

  const period = preview ? { start: preview.periodStart, end: preview.periodEnd } : null;
  const alreadyFiled = period ? filings.some((f) => f.period_end === period.end) : false;

  async function handleMarkFiled() {
    if (!filedDate) return;
    setSubmitting(true);
    try {
      await api.post("/form941-filings/mark-filed", { clientId, year, quarter, filedDate, paidDate: paidDate || undefined, notify });
      toast(notify ? "Filed and confirmation sent to the client." : "Filed.");
      setFiledDate(""); setPaidDate("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not mark this Form 941 filed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecordPayment(f: Form941Filing) {
    const date = recordPaymentDates[f.period_end];
    if (!date) return;
    try {
      await api.post(`/form941-filings/${clientId}/${f.period_end}/record-payment`, { paidDate: date });
      toast("Payment recorded.");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record this payment.");
    }
  }

  async function handleUnmark(f: Form941Filing) {
    const ok = await confirmDialog({
      title: "Undo this Form 941 filing", message: `Removes the record for Q${f.quarter} entirely — it can be filed again from scratch afterward.`, confirmLabel: "Undo",
    });
    if (!ok) return;
    try {
      await api.post(`/form941-filings/${clientId}/${f.period_end}/unmark`, {});
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
        <h3 style={{ marginTop: 0 }}>Review &amp; File</h3>
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
        </div>

        {previewLoading ? <p className="muted" style={{ marginTop: 12 }}>Loading…</p> : preview && (
          <div style={{ marginTop: 14 }}>
            <table style={{ width: "100%", maxWidth: 480 }}>
              <tbody>
                <tr><td className="muted" style={{ padding: "4px 0" }}>Employees</td><td style={{ textAlign: "right" }}>{preview.employeeCount}</td></tr>
                <tr><td className="muted" style={{ padding: "4px 0" }}>Wages</td><td style={{ textAlign: "right" }}>{money(preview.wages)}</td></tr>
                <tr><td className="muted" style={{ padding: "4px 0" }}>Gross Liability (withholding + SS + Medicare)</td><td style={{ textAlign: "right" }}>{money(preview.grossLiability)}</td></tr>
                <tr><td className="muted" style={{ padding: "4px 0" }}>EFTPS Deposits Applied</td><td style={{ textAlign: "right" }}>−{money(preview.eftpsDepositsApplied)}</td></tr>
                <tr style={{ borderTop: "1px solid var(--line)" }}><td style={{ padding: "4px 0", fontWeight: 700 }}>Balance Due</td><td style={{ textAlign: "right", fontWeight: 700 }}>{money(preview.balanceDue)}</td></tr>
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>Due {fmtDate(preview.dueDate)}. {alreadyFiled ? "This quarter has already been filed — filing again will update the existing record." : ""}</p>
          </div>
        )}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 14 }}>
          <div className="field" style={{ maxWidth: 170 }}>
            <label>Filed Date</label>
            <input type="date" value={filedDate} onChange={(e) => setFiledDate(e.target.value)} />
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
      </div>

      <h3>History</h3>
      {loading ? <p className="muted">Loading…</p> : filings.length === 0 ? <p className="muted">No Form 941 filings yet.</p> : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Quarter</th><th>Filed</th><th>Balance Due</th><th>Payment</th><th>Client</th><th></th></tr></thead>
              <tbody>
                {filings.map((f) => (
                  <tr key={f.period_end}>
                    <td>Q{f.quarter} {f.period_start.slice(0, 4)}</td>
                    <td>{fmtDate(f.filed_date)}</td>
                    <td>{money(f.balance_due)}</td>
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
                    <td style={{ display: "flex", gap: 6 }}>
                      <button type="button" className="btn btn-sm" onClick={() => viewFile(`/form941-filings/${clientId}/${f.period_end}/pdf`)}>View</button>
                      <button type="button" className="btn btn-sm" onClick={() => downloadFile(`/form941-filings/${clientId}/${f.period_end}/pdf`, `941_Q${f.quarter}_${f.period_start.slice(0, 4)}.pdf`)}>PDF</button>
                      <button type="button" className="btn btn-sm" onClick={() => handleUnmark(f)}>Undo</button>
                    </td>
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
