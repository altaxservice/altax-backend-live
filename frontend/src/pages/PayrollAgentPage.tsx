import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { usePrompt, useNotify, useConfirm } from "../components/ConfirmProvider";
import { fmtDateOnly } from "../utils/date";

interface Schedule {
  payroll_schedule_id: string; client_id: string; client_name: string; employee_id: string; employee_name: string;
  frequency: string; next_pay_date: string; lead_days: number; status: string;
  /** next_pay_date minus lead_days — the date the sweep actually starts drafting this schedule.
   * "Next pay date" alone reads as "you'll see a draft by then," which isn't true — nothing
   * appears until this earlier date, and "Run Agent Now" before it correctly does nothing. */
  drafts_from: string;
}

/** One enrolled employee's row — just two states, On and Off (collapsing
 * what used to be three states with four buttons). Turning Off always uses
 * the "pause" backend action, so there is exactly one way back: Turn On.
 * A schedule archived before this simplified UI shipped still shows as Off
 * and still turns back on the same way. */
function ScheduleRow({ schedule, onChanged }: { schedule: Schedule; onChanged: () => void }) {
  const navigate = useNavigate();
  const notify = useNotify();
  const confirmDialog = useConfirm();
  const [busy, setBusy] = useState(false);
  const isOn = schedule.status === "Active";

  async function handleToggle() {
    if (isOn) {
      const ok = await confirmDialog({
        message: `Turn off Auto-Draft Payroll for ${schedule.employee_name}? It will stop drafting new paychecks until you turn it back on — nothing already drafted is affected.`,
        confirmLabel: "Turn Off",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await api.post(`/accounting/payroll-agent/schedules/${schedule.payroll_schedule_id}/${isOn ? "pause" : "resume"}`, {});
      onChanged();
      await notify(isOn
        ? `Turned off. ${schedule.employee_name} won't be drafted again until you turn this back on.`
        : `Turned on. ${schedule.employee_name} will be drafted again ahead of their next payday.`);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not update this schedule.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ minWidth: 180 }}>
        <button type="button" className="ghost-button btn-sm" style={{ border: "none", padding: 0, background: "none", fontWeight: 700, color: "var(--ink)" }} onClick={() => navigate(`/employees/${schedule.employee_id}`)}>
          {schedule.employee_name}
        </button>
        <div className="muted" style={{ fontSize: 12 }}>{schedule.frequency}</div>
      </div>
      <span className={`status-pill ${isOn ? "status-green" : "status-gray"}`}>{isOn ? "On" : "Off"}</span>
      {isOn && (
        <span className="muted" style={{ fontSize: 12.5 }}>
          Pay date {fmtDateOnly(schedule.next_pay_date)} — {schedule.drafts_from <= new Date().toISOString().slice(0, 10) ? "due to draft now" : `drafts starting ${fmtDateOnly(schedule.drafts_from)}`}
        </span>
      )}
      <div style={{ flex: 1 }} />
      <button type="button" className={`btn btn-sm ${isOn ? "" : "btn-primary"}`} disabled={busy} onClick={handleToggle}>
        {busy ? "Saving…" : isOn ? "Turn Off" : "Turn On"}
      </button>
    </div>
  );
}

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

/** Most recently CLOSED calendar month, e.g. run in September returns August 1–31 — matches ensureEftpsStaffTasks' own "most recently closed period" convention. */
function lastFullMonth(): { start: string; end: string } {
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth(); // 0-indexed; m-1 is last month
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}
/** Most recently closed calendar quarter — same "closed period" convention as lastFullMonth, one quarter granularity. */
function lastFullQuarter(): { year: number; quarter: 1 | 2 | 3 | 4; start: string; end: string } {
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth(); // 0-indexed
  const currentQuarter0 = Math.floor(m / 3); // 0-3
  let quarter0 = currentQuarter0 - 1, year = y;
  if (quarter0 < 0) { quarter0 = 3; year -= 1; }
  const startMonth0 = quarter0 * 3;
  const start = new Date(Date.UTC(year, startMonth0, 1));
  const end = new Date(Date.UTC(year, startMonth0 + 3, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { year, quarter: (quarter0 + 1) as 1 | 2 | 3 | 4, start: iso(start), end: iso(end) };
}

interface QboPendingRow { clientId: string; clientName: string; [key: string]: any }
interface BulkConfirmResult { succeeded: number; failed: number; results: { clientId: string; ok: boolean; error?: string }[] }

/**
 * One "Confirm QBO Filed" bulk-confirm section — reused for EFTPS Deposits,
 * Form 941, and MD UI. QBO already filed and paid these for its clients;
 * staff are confirming a batch happened correctly, not filing anything
 * themselves. Checked by default (matches the firm's stated preference: one
 * click confirms the whole list, uncheck an exception before confirming).
 * Mirrors the Pending Drafts checkbox/select/bulk-approve pattern above.
 */
function QboConfirmSection({
  title, periodLabel, fetchList, amountKey, amountLabel, warnKey, warnLabel, confirmBulk,
}: {
  title: string;
  periodLabel: string;
  fetchList: () => Promise<{ clients: QboPendingRow[] }>;
  amountKey: string;
  amountLabel: string;
  warnKey?: string;
  warnLabel?: string;
  confirmBulk: (clientIds: string[], filedDate: string) => Promise<BulkConfirmResult>;
}) {
  const notify = useNotify();
  const [rows, setRows] = useState<QboPendingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filedDate, setFiledDate] = useState(new Date().toISOString().slice(0, 10));
  const [confirming, setConfirming] = useState(false);
  const [lastErrors, setLastErrors] = useState<{ clientId: string; clientName: string; error: string }[]>([]);

  function load() {
    setError(null);
    fetchList()
      .then((r) => { setRows(r.clients); setSelected(new Set(r.clients.map((c) => c.clientId))); setLastErrors([]); })
      .catch((err) => setError(err instanceof ApiError ? err.message : `Could not load ${title}.`));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  function toggle(clientId: string) {
    setSelected((s) => { const next = new Set(s); next.has(clientId) ? next.delete(clientId) : next.add(clientId); return next; });
  }

  async function handleConfirmAll() {
    if (!selected.size) return;
    setConfirming(true);
    try {
      const res = await confirmBulk(Array.from(selected), filedDate);
      const byId = new Map((rows || []).map((r) => [r.clientId, r.clientName]));
      setLastErrors(res.results.filter((r) => !r.ok).map((r) => ({ clientId: r.clientId, clientName: byId.get(r.clientId) || r.clientId, error: r.error || "Could not confirm." })));
      await notify(`${res.succeeded} confirmed${res.failed ? `, ${res.failed} need attention (see below)` : ""}.`);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : `Could not confirm the selected ${title.toLowerCase()}.`);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="command-panel" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <div>
          <h2 className="command-panel-title">{title} — Confirm QBO Filed</h2>
          <div className="command-panel-note">{periodLabel} · QuickBooks Online files and pays these itself — confirm each one went through.</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor={`qbo-filed-date-${title}`} style={{ fontSize: 11 }}>Filing Date</label>
            <input id={`qbo-filed-date-${title}`} type="date" value={filedDate} onChange={(e) => setFiledDate(e.target.value)} style={{ padding: "4px 6px" }} />
          </div>
          <button type="button" className="btn btn-primary" disabled={confirming || !selected.size} onClick={handleConfirmAll}>
            {confirming ? "Confirming…" : `Confirm All Selected (${selected.size})`}
          </button>
        </div>
      </div>

      {error && <div style={{ padding: 16 }}><ErrorBanner error={error} /></div>}

      {!rows ? (
        <p className="muted" style={{ padding: 16, margin: 0 }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted" style={{ padding: 16, margin: 0 }}>No QBO clients pending for {periodLabel.toLowerCase()} — either already confirmed, or nothing due yet.</p>
      ) : (
        <div>
          {rows.map((r) => {
            const warn = warnKey && !r[warnKey];
            return (
              <div key={r.clientId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--line)" }}>
                <input type="checkbox" checked={selected.has(r.clientId)} onChange={() => toggle(r.clientId)} aria-label={`Select ${r.clientName}`} />
                <div style={{ fontWeight: 600 }}>{r.clientName}</div>
                <div style={{ flex: 1 }} />
                <div style={{ textAlign: "right" }}>{amountLabel} {fmtMoney(r[amountKey])}</div>
                {warn && <span className="status-pill status-amber" title={warnLabel}>{warnLabel}</span>}
              </div>
            );
          })}
        </div>
      )}

      {lastErrors.length > 0 && (
        <div style={{ padding: 16, borderTop: "1px solid var(--line)" }}>
          <p className="muted" style={{ fontSize: 12.5, margin: "0 0 8px", color: "var(--red)" }}>These need attention — they weren't confirmed:</p>
          {lastErrors.map((e) => (
            <div key={e.clientId} style={{ fontSize: 12.5, marginBottom: 4 }}><strong>{e.clientName}</strong> — {e.error}</div>
          ))}
        </div>
      )}
    </div>
  );
}

interface DraftPreview {
  gross: number; federalTaxableWages: number; totalDeductions: number; employeeTaxes: number; netPay: number; totalCost: number;
  regularHours: number; regularRate: number;
}

interface Draft {
  payroll_draft_id: string; client_id: string; client_name: string; employee_id: string; employee_name: string;
  pay_date: string; status: string; staff_overrides: Record<string, any> | null;
  preview: DraftPreview | null; previewError: string | null;
}

function DraftRow({ draft, selected, onToggleSelect, onChanged }: { draft: Draft; selected: boolean; onToggleSelect: () => void; onChanged: () => void }) {
  const navigate = useNavigate();
  const notify = useNotify();
  const promptFor = usePrompt();
  const [editing, setEditing] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({
    regularHours: draft.staff_overrides?.regularHours ?? "", regularRate: draft.staff_overrides?.regularRate ?? "",
    grossWages: draft.staff_overrides?.grossWages ?? "",
  });
  const [livePreview, setLivePreview] = useState<DraftPreview | null>(draft.preview);
  const [previewError, setPreviewError] = useState<string | null>(draft.previewError);
  const [busy, setBusy] = useState(false);

  // Debounced live preview while editing — identical shape to the manual
  // payroll form's own preview effect (AccountingPage.tsx's PayrollTab),
  // reusing the same read-only route rather than duplicating the math.
  useEffect(() => {
    if (!editing) return;
    const handle = setTimeout(() => {
      api.post<DraftPreview>("/accounting/payroll/preview", {
        clientId: draft.client_id, employee: draft.employee_name, payDate: draft.pay_date,
        regularHours: overrides.regularHours, regularRate: overrides.regularRate, grossWages: overrides.grossWages,
      })
        .then((res) => { setLivePreview(res); setPreviewError(null); })
        .catch((err) => setPreviewError(err instanceof ApiError ? err.message : "Could not calculate a preview."));
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, overrides.regularHours, overrides.regularRate, overrides.grossWages]);

  function overridesPayload() {
    const body: Record<string, any> = {};
    if (overrides.regularHours !== "") body.regularHours = overrides.regularHours;
    if (overrides.regularRate !== "") body.regularRate = overrides.regularRate;
    if (overrides.grossWages !== "") body.grossWages = overrides.grossWages;
    return body;
  }

  async function handleApprove() {
    setBusy(true);
    try {
      await api.post(`/accounting/payroll-agent/drafts/${draft.payroll_draft_id}/approve`, { overrides: editing ? overridesPayload() : undefined });
      onChanged();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not approve this draft.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDismiss() {
    const reason = await promptFor({ message: `Dismiss the ${fmtDateOnly(draft.pay_date)} draft for ${draft.employee_name}? You can add a note for why (optional).`, placeholder: "Reason (optional)" });
    if (reason === null) return;
    setBusy(true);
    try {
      await api.post(`/accounting/payroll-agent/drafts/${draft.payroll_draft_id}/dismiss`, { reason: reason || undefined });
      onChanged();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not dismiss this draft.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`Select ${draft.employee_name}'s draft`} />
        <div style={{ minWidth: 180 }}>
          <div style={{ fontWeight: 700 }}>
            <button type="button" className="ghost-button btn-sm" style={{ border: "none", padding: 0, background: "none", fontWeight: 700, color: "var(--ink)" }} onClick={() => navigate(`/employees/${draft.employee_id}`)}>
              {draft.employee_name}
            </button>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>Pay date {fmtDateOnly(draft.pay_date)}</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="ghost-button btn-sm" disabled={busy} onClick={() => setEditing((e) => !e)}>{editing ? "Cancel Edit" : "Edit"}</button>
          <button type="button" className="ghost-button btn-sm" disabled={busy} onClick={handleDismiss}>Dismiss</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={handleApprove}>{busy ? "…" : "Approve"}</button>
        </div>
      </div>

      {editing && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10, marginTop: 12, maxWidth: 480 }}>
          <div className="field" style={{ margin: 0 }}><label htmlFor={`payroll-agent-hours-${draft.payroll_draft_id}`}>Hours</label><input id={`payroll-agent-hours-${draft.payroll_draft_id}`} type="number" value={overrides.regularHours} onChange={(e) => setOverrides((o) => ({ ...o, regularHours: e.target.value }))} /></div>
          <div className="field" style={{ margin: 0 }}><label htmlFor={`payroll-agent-rate-${draft.payroll_draft_id}`}>Rate</label><input id={`payroll-agent-rate-${draft.payroll_draft_id}`} type="number" step="0.01" value={overrides.regularRate} onChange={(e) => setOverrides((o) => ({ ...o, regularRate: e.target.value }))} /></div>
          <div className="field" style={{ margin: 0 }}><label htmlFor={`payroll-agent-gross-${draft.payroll_draft_id}`}>Gross Override</label><input id={`payroll-agent-gross-${draft.payroll_draft_id}`} type="number" step="0.01" value={overrides.grossWages} onChange={(e) => setOverrides((o) => ({ ...o, grossWages: e.target.value }))} /></div>
        </div>
      )}

      {previewError && <p className="muted" style={{ fontSize: 12, color: "var(--red)", marginTop: 8 }}>{previewError}</p>}
      {livePreview && !previewError && (
        <div className="metric-grid" style={{ marginTop: 10, gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
          <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Gross</div><div className="metric-value">{fmtMoney(livePreview.gross)}</div></div>
          <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Deductions</div><div className="metric-value">{fmtMoney(livePreview.totalDeductions)}</div></div>
          <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Net Pay</div><div className="metric-value" style={{ color: "var(--teal)" }}>{fmtMoney(livePreview.netPay)}</div></div>
          <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Employer Cost</div><div className="metric-value">{fmtMoney(livePreview.totalCost)}</div></div>
        </div>
      )}
    </div>
  );
}

/**
 * The review screen the Payroll Agent's dashboard card links to. Every draft
 * here is a Pending row in v3_payroll_drafts — none of them are real
 * paychecks yet. Approve calls the same backend path (createSinglePaycheck)
 * the manual entry form and batch route already use; Dismiss just marks the
 * draft aside with no paycheck/GL effect at all.
 */
export function PayrollAgentPage() {
  const navigate = useNavigate();
  const notify = useNotify();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);
  const [autoRunEnabled, setAutoRunEnabled] = useState<boolean | null>(null);
  const [togglingAutoRun, setTogglingAutoRun] = useState(false);
  const [showOff, setShowOff] = useState(false);

  function load() {
    api.get<{ drafts: Draft[] }>("/accounting/payroll-agent/drafts?status=Pending")
      .then((res) => { setDrafts(res.drafts); setSelected(new Set()); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load pending drafts."));
  }
  useEffect(load, []);

  function loadSchedules() {
    api.get<{ schedules: Schedule[] }>("/accounting/payroll-agent/schedules")
      .then((res) => setSchedules(res.schedules))
      .catch(() => setSchedules([]));
  }
  useEffect(loadSchedules, []);

  useEffect(() => {
    api.get<{ autoRunEnabled: boolean }>("/accounting/payroll-agent/settings")
      .then((res) => setAutoRunEnabled(res.autoRunEnabled))
      .catch(() => setAutoRunEnabled(true));
  }, []);

  async function handleToggleAutoRun() {
    if (autoRunEnabled === null || togglingAutoRun) return;
    const next = !autoRunEnabled;
    setTogglingAutoRun(true);
    try {
      await api.post("/accounting/payroll-agent/settings", { autoRunEnabled: next });
      setAutoRunEnabled(next);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not update the Auto Payroll setting.");
    } finally {
      setTogglingAutoRun(false);
    }
  }

  async function handleRun() {
    setRunning(true);
    try {
      const res = await api.post<{ created: any[]; skipped: number; errors: string[] }>("/accounting/payroll-agent/run", {});
      await notify(`Payroll Agent ran: ${res.created.length} new draft${res.created.length === 1 ? "" : "s"}, ${res.skipped} already up to date${res.errors.length ? `, ${res.errors.length} skipped with issues` : ""}.`);
      load();
      loadSchedules();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not run the Payroll Agent.");
    } finally {
      setRunning(false);
    }
  }

  async function handleApproveBulk() {
    if (!selected.size) return;
    setBulkApproving(true);
    try {
      const res = await api.post<{ succeeded: number; failed: number; results: any[] }>("/accounting/payroll-agent/drafts/approve-bulk", { draftIds: Array.from(selected) });
      await notify(`${res.succeeded} approved${res.failed ? `, ${res.failed} failed` : ""}.`);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not approve the selected drafts.");
    } finally {
      setBulkApproving(false);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, Draft[]>();
    for (const d of drafts || []) {
      const key = d.client_name || d.client_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return Array.from(map.entries());
  }, [drafts]);

  const onSchedules = useMemo(() => (schedules || []).filter((s) => s.status === "Active"), [schedules]);
  const eftpsPeriod = useMemo(() => lastFullMonth(), []);
  const quarterPeriod = useMemo(() => lastFullQuarter(), []);
  const offSchedules = useMemo(() => (schedules || []).filter((s) => s.status !== "Active"), [schedules]);

  if (error) return <ErrorBanner error={error} />;
  if (!drafts) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 4 }}>
        <div>
          <div className="topbar-eyebrow">Payroll Agent</div>
          <h1 style={{ margin: 0 }}>Auto Payroll is {autoRunEnabled === null ? "…" : autoRunEnabled ? "On" : "Off"}</h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {selected.size > 0 && (
            <button type="button" className="btn btn-primary" disabled={bulkApproving} onClick={handleApproveBulk}>
              {bulkApproving ? "Approving…" : `Approve Selected (${selected.size})`}
            </button>
          )}
          <button type="button" className="ghost-button" disabled={running} onClick={handleRun}>
            {running ? "Running…" : "Run Agent Now"}
          </button>
        </div>
      </div>
      <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
        A few days before each payday, a draft paycheck shows up below for review — nothing is ever posted without an explicit Approve click.
        {" "}
        {autoRunEnabled !== null && (
          <button
            type="button"
            className="ghost-button btn-sm"
            style={{ border: "none", padding: 0, background: "none", fontSize: 13, color: "var(--teal)" }}
            disabled={togglingAutoRun}
            onClick={handleToggleAutoRun}
            title="Only pauses the automatic nightly drafting run — Run Agent Now and existing schedules are unaffected."
          >
            {togglingAutoRun ? "Saving…" : autoRunEnabled ? "Turn off automatic nightly drafting" : "Turn on automatic nightly drafting"}
          </button>
        )}
      </p>

      <div className="command-panel" style={{ margin: "20px 0" }}>
        <div className="command-panel-header">
          <div>
            <h2 className="command-panel-title">Enrolled Employees</h2>
            <div className="command-panel-note">Who Auto Payroll drafts pay for, and how often.</div>
          </div>
          {schedules && schedules.length > 0 && (
            <button type="button" className="btn btn-sm" onClick={() => navigate("/accounting?tab=Payroll")}>Enroll More →</button>
          )}
        </div>
        {!schedules ? (
          <p className="muted" style={{ padding: 16, margin: 0 }}>Loading…</p>
        ) : schedules.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 24px" }}>
            <p className="muted" style={{ margin: "0 0 16px" }}>
              You haven't enrolled any employees in Auto Payroll yet. Open a client under Accounting → Payroll → Payroll Agent to turn employees on.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => navigate("/accounting?tab=Payroll")}>Go to Accounting →</button>
          </div>
        ) : (
          <>
            {onSchedules.map((s) => <ScheduleRow key={s.payroll_schedule_id} schedule={s} onChanged={loadSchedules} />)}
            {onSchedules.length === 0 && (
              <p className="muted" style={{ padding: 16, margin: 0 }}>Everyone enrolled is currently turned off.</p>
            )}
            {offSchedules.length > 0 && (
              <div style={{ borderTop: "1px solid var(--line)" }}>
                <button
                  type="button"
                  className="ghost-button btn-sm"
                  style={{ margin: 16 }}
                  aria-expanded={showOff}
                  onClick={() => setShowOff((v) => !v)}
                >
                  {showOff ? "Hide" : "Show"} off ({offSchedules.length})
                </button>
                {showOff && offSchedules.map((s) => <ScheduleRow key={s.payroll_schedule_id} schedule={s} onChanged={loadSchedules} />)}
              </div>
            )}
          </>
        )}
      </div>

      <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Pending Drafts</h2>

      {drafts.length === 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No pending drafts right now. Drafts appear here automatically as each enrolled employee nears their next payday, or click "Run Agent Now" to check immediately.
          </p>
        </div>
      )}

      {grouped.map(([clientName, clientDrafts]) => (
        <div key={clientName} className="command-panel" style={{ marginBottom: 16 }}>
          <div className="command-panel-header">
            <h2 className="command-panel-title">{clientName}</h2>
            <div className="command-panel-note">{clientDrafts.length} draft{clientDrafts.length === 1 ? "" : "s"}</div>
          </div>
          <div>
            {clientDrafts.map((draft) => (
              <DraftRow
                key={draft.payroll_draft_id}
                draft={draft}
                selected={selected.has(draft.payroll_draft_id)}
                onToggleSelect={() => setSelected((s) => { const next = new Set(s); next.has(draft.payroll_draft_id) ? next.delete(draft.payroll_draft_id) : next.add(draft.payroll_draft_id); return next; })}
                onChanged={load}
              />
            ))}
          </div>
        </div>
      ))}

      <h2 style={{ fontSize: 15, margin: "28px 0 10px" }}>Confirm QBO Filed</h2>
      <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
        For clients on QuickBooks Online, QBO deposits and files these itself — nobody here needs to prepare or file them manually. These lists are just the firm's own record that each one actually went through.
      </p>
      <QboConfirmSection
        title="EFTPS Deposits"
        periodLabel={`${fmtDateOnly(eftpsPeriod.start)} – ${fmtDateOnly(eftpsPeriod.end)}`}
        fetchList={() => api.get<{ clients: QboPendingRow[] }>(`/eftps-deposits/qbo-pending?periodStart=${eftpsPeriod.start}&periodEnd=${eftpsPeriod.end}`)}
        amountKey="totalAmount" amountLabel="Deposit"
        warnKey="paycheckCount" warnLabel="No imported payroll data"
        confirmBulk={(clientIds, filedDate) => api.post<BulkConfirmResult>("/eftps-deposits/bulk-mark-filed", {
          clientIds, periodStart: eftpsPeriod.start, periodEnd: eftpsPeriod.end, dueDate: filedDate, filingDate: filedDate,
        })}
      />
      <QboConfirmSection
        title="Form 941"
        periodLabel={`Q${quarterPeriod.quarter} ${quarterPeriod.year}`}
        fetchList={() => api.get<{ clients: QboPendingRow[] }>(`/form941-filings/qbo-pending?year=${quarterPeriod.year}&quarter=${quarterPeriod.quarter}`)}
        amountKey="balanceDue" amountLabel="Balance Due"
        confirmBulk={(clientIds, filedDate) => api.post<BulkConfirmResult>("/form941-filings/bulk-mark-filed", {
          clientIds, year: quarterPeriod.year, quarter: quarterPeriod.quarter, filedDate,
        })}
      />
      <QboConfirmSection
        title="MD UI"
        periodLabel={`Q${quarterPeriod.quarter} ${quarterPeriod.year}`}
        fetchList={() => api.get<{ clients: QboPendingRow[] }>(`/md-ui-filings/qbo-pending?periodStart=${quarterPeriod.start}&periodEnd=${quarterPeriod.end}`)}
        amountKey="suggestedAmount" amountLabel="Amount"
        confirmBulk={(clientIds, filedDate) => api.post<BulkConfirmResult>("/md-ui-filings/bulk-mark-filed", {
          clientIds, periodStart: quarterPeriod.start, periodEnd: quarterPeriod.end, filedDate,
        })}
      />
    </div>
  );
}
