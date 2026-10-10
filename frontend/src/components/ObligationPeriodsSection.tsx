import { DateInput } from "./DateInput";
import { useEffect, useState } from "react";
import { api, ApiError, viewFile } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";
import { useToast } from "./Toast";
import { useConfirm, usePrompt, useNotify } from "./ConfirmProvider";

export type ObligationKind = "ui" | "annual-report" | "form941" | "eftps";

interface PeriodRow {
  start: string; end: string; label: string; dueDate: string; targetFilingDate: string;
  amount: number; onTime: boolean; penalty: number; interest: number; monthsLate: number; balanceDue: number;
  lateChargesComputed: boolean;
  filedDate: string; paidDate: string; markedFiledDate: string | null; markedPaidDate: string | null;
  acknowledgedAt: string | null; sentAt: string | null; recordId: string | null; detail?: Record<string, number>;
}
interface Breakdown { periods: PeriodRow[]; totals: { amount: number; penalty: number; interest: number; balanceDue: number } }
interface Meta { kind: ObligationKind; state: string; applies: boolean; reason?: string; lateChargesBuilt: boolean }
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
const yearRange = (y: number) => ({ from: `${y}-01-01`, to: `${y}-12-31` });

interface KindConfig {
  title: (state: string) => string;
  blurb: (state: string) => string;
  amountHeader: string;
  /** Label for the amount the filing is for ("Contribution", "Fee"…). */
  amountWord: string;
  basePath: string;
  presets: { label: string; range: () => { from: string; to: string } }[];
  /** Mark-filed request body for a period. */
  markBody: (clientId: string, p: PeriodRow, v: { filed: string; paid: string; amount: string; notify: boolean }) => Record<string, unknown>;
  /** Whether the amount can be typed when marking filed (Form 941 recomputes it from payroll and EFTPS deposits). */
  amountEditableOnFile: boolean;
  editBody: (v: { filed: string; paid: string; amount: string }) => Record<string, unknown>;
  pdfPath?: (clientId: string, p: PeriodRow) => string;
  /** URL for a per-period action; filings addressed by id (EFTPS deposits) override this. */
  actionPath?: (action: "record-payment" | "send" | "edit" | "unmark", clientId: string, p: PeriodRow) => string;
  paymentBody?: (date: string) => Record<string, unknown>;
  /** What monthsLate counts for this filing. */
  lateUnit?: "mo" | "day";
}

const KINDS: Record<ObligationKind, KindConfig> = {
  eftps: {
    title: () => "Federal Payroll Tax Deposit (EFTPS)",
    blurb: () => "Monthly federal payroll tax deposit, due the 15th of the month after payroll. The amounts come from the imported Drake reports — and match Drake's Tax Liability report when one is imported for that exact month. Under each total are the Federal, Social Security and Medicare amounts (employee + employer) to type into the EFTPS website; click any amount to copy it. A late deposit adds the IRS failure-to-deposit penalty (2% / 5% / 10% by days late) and interest, counted from the payment date.",
    amountHeader: "Deposit", amountWord: "deposit", basePath: "/eftps-deposits",
    presets: [
      { label: "This year", range: () => yearRange(new Date().getFullYear()) },
      { label: "Last year", range: () => yearRange(new Date().getFullYear() - 1) },
      { label: "Last 12 months", range: () => { const e = new Date(); return { from: new Date(e.getFullYear(), e.getMonth() - 11, 1).toISOString().slice(0, 10), to: todayStr() }; } },
    ],
    markBody: (clientId, p, v) => ({
      clientId, periodStart: p.start, periodEnd: p.end, dueDate: p.dueDate, filingDate: v.filed, paymentDate: v.paid || undefined,
      totalAmount: Number(v.amount), notify: v.notify, periodLabel: p.label,
    }),
    amountEditableOnFile: true,
    editBody: (v) => ({ filingDate: v.filed, paymentDate: v.paid || "", totalAmount: Number(v.amount) }),
    pdfPath: (_clientId, p) => `/eftps-deposits/${p.recordId}/pdf`,
    actionPath: (action, _clientId, p) => `/eftps-deposits/${p.recordId}/${action}`,
    paymentBody: (date) => ({ paymentDate: date }),
    lateUnit: "day",
  },
  ui: {
    title: (st) => `${st} Unemployment Insurance Filing`,
    blurb: (st) => `Quarterly ${st} UI contribution and wage report. The amount is suggested from the SUTA recorded on this client's paychecks (only employees whose payroll state is ${st}) — correct it to match the report.`,
    amountHeader: "Contribution", amountWord: "contribution", basePath: "/md-ui-filings",
    presets: [
      { label: "This year", range: () => yearRange(new Date().getFullYear()) },
      { label: "Last year", range: () => yearRange(new Date().getFullYear() - 1) },
      { label: "Last 12 months", range: () => { const e = new Date(); return { from: new Date(e.getFullYear(), e.getMonth() - 11, 1).toISOString().slice(0, 10), to: todayStr() }; } },
    ],
    markBody: (clientId, p, v) => ({ clientId, periodStart: p.start, periodEnd: p.end, filedDate: v.filed, paidDate: v.paid || undefined, amount: Number(v.amount), notify: v.notify }),
    amountEditableOnFile: true,
    editBody: (v) => ({ filedDate: v.filed, paidDate: v.paid || undefined, amount: Number(v.amount) }),
  },
  "annual-report": {
    title: (st) => (st === "DC" ? "DC Biennial Report" : st === "VA" ? "Virginia Annual Registration" : st === "DE" ? `${st} Annual Report / Franchise Tax` : `${st} Annual Report`),
    blurb: (st) => (st === "DC" ? "DC's biennial report (every two years, due April 1) — the period list follows the client's formation date."
      : st === "MD" ? "Maryland Annual Report and Personal Property Return (Form 1), due April 15. The fee is what was actually paid to SDAT."
      : "The state's yearly business filing. Amounts are suggested starting points — enter what was actually paid."),
    amountHeader: "Fee", amountWord: "fee", basePath: "/annual-report-filings",
    presets: [
      { label: "Last 3 years", range: () => ({ from: `${new Date().getFullYear() - 2}-01-01`, to: `${new Date().getFullYear()}-12-31` }) },
      { label: "Last 5 years", range: () => ({ from: `${new Date().getFullYear() - 4}-01-01`, to: `${new Date().getFullYear()}-12-31` }) },
    ],
    markBody: (clientId, p, v) => ({ clientId, periodStart: p.start, periodEnd: p.end, filedDate: v.filed, paidDate: v.paid || undefined, amount: Number(v.amount), notify: v.notify }),
    amountEditableOnFile: true,
    editBody: (v) => ({ filedDate: v.filed, paidDate: v.paid || undefined, amount: Number(v.amount) }),
  },
  form941: {
    title: () => "Federal Payroll Tax (Form 941)",
    blurb: () => "Quarterly federal return. The balance due is the quarter's gross liability from recorded payroll less the EFTPS deposits recorded for it. Penalty and interest follow the IRS rules (failure-to-file/pay and the quarterly underpayment rate); failure-to-deposit penalties depend on each deposit's own timing and aren't included.",
    amountHeader: "Balance Due", amountWord: "balance due", basePath: "/form941-filings",
    presets: [
      { label: "This year", range: () => yearRange(new Date().getFullYear()) },
      { label: "Last year", range: () => yearRange(new Date().getFullYear() - 1) },
      { label: "Last 12 months", range: () => { const e = new Date(); return { from: new Date(e.getFullYear(), e.getMonth() - 11, 1).toISOString().slice(0, 10), to: todayStr() }; } },
    ],
    markBody: (clientId, p, v) => ({
      clientId, year: Number(p.start.slice(0, 4)), quarter: Math.floor((Number(p.start.slice(5, 7)) - 1) / 3) + 1,
      filedDate: v.filed, paidDate: v.paid || undefined, notify: v.notify,
    }),
    amountEditableOnFile: false,
    editBody: (v) => ({ filedDate: v.filed, paidDate: v.paid || undefined, balanceDue: Number(v.amount) }),
    pdfPath: (clientId, p) => `/form941-filings/${clientId}/${p.end}/pdf`,
  },
};

/**
 * Period table for state UI, the annual/biennial report, and Form 941 — the
 * same process as Sales and Withholding: every period in the range with its due
 * date, target filing date, amount, status, penalty/interest and balance due,
 * then Mark Filed / Record Payment / Send / Edit / Delete plus History and
 * Excluded. The table comes from /obligation-periods; the actions use each
 * filing's own routes (which also close tasks, email the client, and schedule
 * payment reminders).
 */
export function ObligationPeriodsSection({ clientId, kind, refreshKey }: { clientId: string; kind: ObligationKind; refreshKey?: unknown }) {
  const cfg = KINDS[kind];
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();
  const notify = useNotify();
  const toast = useToast();
  const initial = cfg.presets[0].range();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [filedDate, setFiledDate] = useState(todayStr());
  const [paidDate, setPaidDate] = useState(todayStr());

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
  const [editForm, setEditForm] = useState({ filed: "", paid: "", amount: "" });

  const reload = () => setReloadKey((k) => k + 1);
  const periodsPath = `/obligation-periods/${kind}/${clientId}`;

  useEffect(() => {
    setFrom(cfg.presets[0].range().from);
    setTo(cfg.presets[0].range().to);
    setPickingEnd(null); setEditingEnd(null); setPayingEnd(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, clientId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<{ meta: Meta; breakdown: Breakdown | null }>(`${periodsPath}?from=${from}&to=${to}&filedDate=${filedDate}&paidDate=${paidDate}`)
      .then((r) => { if (!cancelled) { setMeta(r.meta); setBreakdown(r.breakdown); } })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load these periods."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [periodsPath, from, to, filedDate, paidDate, reloadKey, refreshKey]);

  useEffect(() => {
    api.get<{ periods: PeriodRow[] }>(`${periodsPath}/history`).then((r) => setHistory(r.periods)).catch(() => setHistory([]));
    api.get<{ excluded: ExcludedRow[] }>(`${periodsPath}/excluded-periods`).then((r) => setExcluded(r.excluded)).catch(() => setExcluded([]));
  }, [periodsPath, reloadKey, refreshKey]);

  const actionUrl = (action: "record-payment" | "send" | "edit" | "unmark", p: PeriodRow) =>
    cfg.actionPath ? cfg.actionPath(action, clientId, p) : `${cfg.basePath}/${clientId}/${p.end}/${action}`;

  /** An amount staff type into another website — click to copy the plain number. */
  function copyable(v: unknown, label?: string) {
    const plain = Number(v).toFixed(2);
    return (
      <button type="button" title={`Click to copy ${plain}`} onClick={() => {
        navigator.clipboard?.writeText(plain).then(() => toast(`Copied ${plain}`)).catch(() => toast("Could not copy — select the number instead."));
      }} style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "copy" }}>
        {label ? `${label} ` : ""}{money(v)}
      </button>
    );
  }

  async function run(end: string, work: () => Promise<void>, failure: string) {
    setBusyEnd(end);
    try { await work(); reload(); } catch (err) { await notify(err instanceof ApiError ? err.message : failure); } finally { setBusyEnd(null); }
  }

  async function handleMarkFiled(p: PeriodRow, sendConfirmation: boolean) {
    const ok = await confirmDialog({
      title: "Mark period filed?",
      message: `Confirm this was actually filed${pickPaid ? "/paid" : ""}. ${p.label}, filed ${fmtDate(pickFiled)}${pickPaid ? `, paid ${fmtDate(pickPaid)}` : " (payment not yet made)"}.${sendConfirmation ? " The client will be sent a filing confirmation." : ""}`,
      confirmLabel: sendConfirmation ? "Save and Send" : "Save and Close",
    });
    if (!ok) return;
    await run(p.end, async () => {
      const res = await api.post<{ notified?: boolean }>(`${cfg.basePath}/mark-filed`, cfg.markBody(clientId, p, { filed: pickFiled, paid: pickPaid, amount: pickAmount, notify: sendConfirmation }));
      setPickingEnd(null);
      if (sendConfirmation && res.notified === false) {
        await notify("Filed, but no confirmation could be sent — this client has no email or phone on file (or both are opted out). Add contact info on the client's profile, then use Send on this row to try again.");
      }
    }, "Could not mark this period filed.");
  }

  async function handleDelete(p: PeriodRow) {
    const ok = await confirmDialog({
      title: "Delete this filing",
      message: `Removes the filing record for ${p.label} so it can be filed again from scratch.`,
      confirmLabel: "Delete", danger: true,
    });
    if (!ok) return;
    await run(p.end, async () => { await api.post(actionUrl("unmark", p), {}); }, "Could not delete this filing.");
  }

  async function handleExclude(p: PeriodRow) {
    const reason = await promptFor({
      title: "Exclude this period?",
      message: `${p.label} will stop appearing here — use this when there was no actual filing obligation. You can restore it later from the "Excluded" list below. Optionally, say why:`,
      placeholder: "Reason (optional)", required: false,
    });
    if (reason === null) return;
    await run(p.end, async () => { await api.post(`${periodsPath}/exclude-period`, { periodStart: p.start, periodEnd: p.end, reason: reason || undefined }); }, "Could not exclude this period.");
  }

  function renderRow(p: PeriodRow) {
    const paidByNow = Boolean(p.markedPaidDate) && p.markedPaidDate!.slice(0, 10) <= todayStr();
    const busy = busyEnd === p.end;
    const showCharges = !(p.markedFiledDate && !paidByNow) && !p.onTime;
    const built = meta?.lateChargesBuilt ?? false;
    return (
      <tr key={`${p.start}-${p.end}`}>
        <td>{p.label}<div className="muted" style={{ fontSize: 11 }}>{fmtDate(p.start)} – {fmtDate(p.end)}</div></td>
        <td>{fmtDate(p.dueDate)}</td>
        <td className="muted">{fmtDate(p.targetFilingDate)}</td>
        <td>
          {money(p.amount)}
          {kind === "form941" && p.detail && !p.markedFiledDate && (
            <div className="muted" style={{ fontSize: 11 }}>Gross {money(p.detail.grossLiability)} − deposits {money(p.detail.eftpsDeposits)}</div>
          )}
          {kind === "eftps" && p.detail && (
            <div className="muted" style={{ fontSize: 11, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, marginTop: 2 }}>
              {copyable(p.detail.federalIncomeTax, "Federal")}
              {copyable(p.detail.socialSecurity, "Soc. Sec.")}
              {copyable(p.detail.medicare, "Medicare")}
              <span style={{ fontSize: 10.5, color: p.detail.basis === 0 ? "var(--amber)" : "var(--teal)" }}
                title={p.detail.basis === 0 ? "These come from adding up each paycheck's withholding, which can be a cent or two off Drake. Import this client's Payroll Wages file again (or that month's Tax Liability report) and they become exact." : "Same figures as Drake's Tax Liability report."}>
                {p.detail.basis === 2 ? "✓ Matches Drake's report" : p.detail.basis === 1 ? "✓ Exact — computed like Drake" : "From paychecks — may be cents off Drake"}
              </span>
              {p.markedFiledDate && Math.abs(p.detail.computedTotal - p.amount) > 0.005 && (
                <span style={{ color: "var(--amber)", fontWeight: 600 }} title="The filed amount differs from what the imported reports add up to now. Use Edit to correct the filed amount if the report is right.">
                  Reports now say {money(p.detail.computedTotal)}
                </span>
              )}
            </div>
          )}
        </td>
        <td className={p.onTime && !p.markedFiledDate ? "muted" : ""} style={!p.onTime && !paidByNow ? { color: "var(--red)", fontWeight: 600 } : p.markedFiledDate && !paidByNow ? { color: "var(--amber)", fontWeight: 600 } : undefined}>
          {paidByNow ? <span style={{ color: "var(--teal)" }}>✓ Filed</span> : p.markedFiledDate ? (p.markedPaidDate ? "Filed — payment scheduled" : "Filed — payment pending") : p.onTime ? "On time" : cfg.lateUnit === "day" ? `Late — ${p.monthsLate} day${p.monthsLate === 1 ? "" : "s"}` : `Late — ${p.monthsLate} mo`}
        </td>
        <td>{!built ? <span className="muted" title="Penalty isn't calculated for this yet">n/a</span> : showCharges ? money(p.penalty) : "—"}</td>
        <td>{!built ? <span className="muted" title="Interest isn't calculated for this yet">n/a</span> : showCharges ? money(p.interest) : "—"}</td>
        <td style={{ fontWeight: 700 }}>{money(p.balanceDue)}</td>
        {showClientColumn && <td>{p.acknowledgedAt ? <span style={{ color: "var(--teal)" }}>✓ Client confirmed</span> : <span className="muted">Awaiting client confirmation</span>}</td>}
        <td>
          {editingEnd === p.end ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 180 }}>
              <label style={{ fontSize: 11 }}>Filed Date</label>
              <DateInput value={editForm.filed} onChange={(e) => setEditForm((s) => ({ ...s, filed: e.target.value }))} style={{ padding: "2px 4px", fontSize: 11.5 }} />
              <label style={{ fontSize: 11 }}>Payment Date (optional)</label>
              <DateInput value={editForm.paid} onChange={(e) => setEditForm((s) => ({ ...s, paid: e.target.value }))} style={{ padding: "2px 4px", fontSize: 11.5 }} />
              <label style={{ fontSize: 11 }}>{cfg.amountHeader}</label>
              <input type="number" step="0.01" min="0" value={editForm.amount} onChange={(e) => setEditForm((s) => ({ ...s, amount: e.target.value }))} style={{ padding: "2px 4px", fontSize: 11.5 }} />
              <div style={{ display: "flex", gap: 4 }}>
                <button type="button" className="btn btn-sm btn-primary" disabled={busy || !editForm.filed || editForm.amount === ""} onClick={() => run(p.end, async () => {
                  await api.post(actionUrl("edit", p), cfg.editBody(editForm));
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
                      await api.post(actionUrl("record-payment", p), cfg.paymentBody ? cfg.paymentBody(payDate) : { paidDate: payDate });
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
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(p.end, async () => { await api.post(actionUrl("send", p), {}); }, "Could not send this confirmation.")}>{busy ? "…" : "Send"}</button>
                )}
                {cfg.pdfPath && <button type="button" className="btn btn-sm" onClick={() => viewFile(cfg.pdfPath!(clientId, p))}>PDF</button>}
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => { setEditingEnd(p.end); setEditForm({ filed: (p.markedFiledDate || "").slice(0, 10), paid: (p.markedPaidDate || "").slice(0, 10), amount: String(p.amount) }); }}>Edit</button>
                <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => handleDelete(p)}>Delete</button>
              </div>
            </div>
          ) : pickingEnd === p.end ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 190 }}>
              <label style={{ fontSize: 11 }}>Filed date</label>
              <DateInput value={pickFiled} onChange={(e) => setPickFiled(e.target.value)} style={{ padding: "2px 4px", fontSize: 11.5 }} />
              <label style={{ fontSize: 11 }}>Payment date (optional)</label>
              <DateInput value={pickPaid} onChange={(e) => setPickPaid(e.target.value)} style={{ padding: "2px 4px", fontSize: 11.5 }} />
              {cfg.amountEditableOnFile ? (
                <>
                  <label style={{ fontSize: 11 }}>{cfg.amountHeader}</label>
                  <input type="number" step="0.01" min="0" value={pickAmount} onChange={(e) => setPickAmount(e.target.value)} title="Pre-filled — correct it to match what was filed" style={{ padding: "2px 4px", fontSize: 11.5 }} />
                </>
              ) : (
                <div className="muted" style={{ fontSize: 11 }}>{cfg.amountHeader} {money(p.amount)} is taken from payroll and EFTPS deposits as of filing.</div>
              )}
              <div style={{ display: "flex", gap: 4 }}>
                <button type="button" className="btn btn-sm" disabled={busy || !pickFiled || (cfg.amountEditableOnFile && pickAmount === "")} onClick={() => handleMarkFiled(p, false)}>{busy ? "…" : "Save and Close"}</button>
                <button type="button" className="btn btn-sm btn-primary" disabled={busy || !pickFiled || (cfg.amountEditableOnFile && pickAmount === "")} onClick={() => handleMarkFiled(p, true)}>{busy ? "…" : "Save and Send"}</button>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => setPickingEnd(null)}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-sm" disabled={busy} title="Enter this period's actual filed date (and payment date, if already paid)"
                onClick={() => { setPickingEnd(p.end); setPickFiled(p.dueDate); setPickPaid(""); setPickAmount(String(p.amount)); }}>Mark Filed</button>
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
    const built = meta?.lateChargesBuilt ?? false;
    return (
      <tfoot>
        <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border, #d0d7de)" }}>
          <td colSpan={3}>Total ({rows.length} period{rows.length === 1 ? "" : "s"})</td>
          <td>{money(cents(rows.map((p) => p.amount)))}</td>
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
      <th>Period</th><th>Due Date</th><th>Target Filing Date</th><th>{cfg.amountHeader}</th><th>Status</th><th>Penalty</th><th>Interest</th><th>Balance Due</th>
      {showClientColumn && <th>Client</th>}<th>Filed</th>
    </tr>
  );

  return (
    <div>
      {error && <ErrorBanner error={error} />}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, margin: "0 0 4px" }}>{cfg.title(meta?.state ?? "")}</h3>
        <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
          {cfg.blurb(meta?.state ?? "")} {meta ? (meta.lateChargesBuilt ? "Late penalty and interest are calculated from the filed and payment dates." : "Penalty and interest aren't calculated here yet — due dates, filing, payment and client confirmation are all tracked.") : ""}
        </p>

        {meta && !meta.applies ? (
          <p style={{ fontSize: 13, color: "var(--red)", margin: 0 }}>{meta.reason}</p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              {cfg.presets.map((pr) => <button key={pr.label} type="button" className="btn btn-sm" onClick={() => { const r = pr.range(); setFrom(r.from); setTo(r.to); }}>{pr.label}</button>)}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div className="field" style={{ maxWidth: 170, margin: 0 }}><label htmlFor={`ob-from-${kind}`}>From</label><DateInput id={`ob-from-${kind}`} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="field" style={{ maxWidth: 170, margin: 0 }}><label htmlFor={`ob-to-${kind}`}>To</label><DateInput id={`ob-to-${kind}`} value={to} onChange={(e) => setTo(e.target.value)} /></div>
              <div className="field" style={{ maxWidth: 170, margin: 0 }}><label htmlFor={`ob-filed-${kind}`}>Filing date</label><DateInput id={`ob-filed-${kind}`} value={filedDate} onChange={(e) => setFiledDate(e.target.value)} /></div>
              <div className="field" style={{ maxWidth: 170, margin: 0 }}><label htmlFor={`ob-paid-${kind}`}>Payment date</label><DateInput id={`ob-paid-${kind}`} value={paidDate} onChange={(e) => setPaidDate(e.target.value)} /></div>
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
              <div className="metric"><div className="metric-label">Total Penalty + Interest</div><div className="metric-value">{meta?.lateChargesBuilt ? money(breakdown.totals.penalty + breakdown.totals.interest) : "n/a"}</div></div>
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
        {showHistory && (history === null ? <p className="muted" style={{ fontSize: 12.5 }}>Loading…</p> : history.length === 0 ? <p className="muted" style={{ fontSize: 12.5 }}>Nothing filed yet.</p> : (
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
                    <td><button type="button" className="btn btn-sm" disabled={busyEnd === p.end} onClick={() => run(p.end, async () => { await api.post(`${periodsPath}/restore-period`, { periodEnd: p.end }); }, "Could not restore this period.")}>{busyEnd === p.end ? "…" : "Restore"}</button></td>
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
