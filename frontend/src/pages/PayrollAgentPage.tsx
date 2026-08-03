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

/** One schedule row on the Payroll Agent page's "Recurring Schedules" list —
 * this is the ONE place staff can see and change Pause/Resume/Archive for
 * every employee's schedule, so archiving one never looks like it vanished:
 * it just moves into the collapsed "Archived" group below, still visible and
 * still reversible via Reactivate. Enabling a NEW schedule still happens from
 * the employee's own profile (that's where pay rate/frequency context
 * lives) — this list is for managing schedules that already exist. */
function ScheduleRow({ schedule, onChanged }: { schedule: Schedule; onChanged: () => void }) {
  const navigate = useNavigate();
  const notify = useNotify();
  const confirmDialog = useConfirm();
  const [busy, setBusy] = useState(false);

  async function doAction(action: "pause" | "resume" | "archive", successMessage: string) {
    setBusy(true);
    try {
      await api.post(`/accounting/payroll-agent/schedules/${schedule.payroll_schedule_id}/${action}`, {});
      await notify(successMessage);
      onChanged();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not update this schedule.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePause() {
    const ok = await confirmDialog({
      message: `Pause the Payroll Agent for ${schedule.employee_name}? It will stop drafting new paychecks until you resume it — nothing already drafted is affected.`,
      confirmLabel: "Pause",
    });
    if (ok) await doAction("pause", `Paused. ${schedule.employee_name} won't be drafted again until you resume this schedule.`);
  }

  async function handleArchive() {
    const ok = await confirmDialog({
      message: `Archive the Payroll Agent schedule for ${schedule.employee_name}? It will stop drafting new paychecks. It stays visible here under "Archived" and you can reactivate it any time — nothing is deleted.`,
      confirmLabel: "Archive",
    });
    if (ok) await doAction("archive", `Archived. ${schedule.employee_name}'s schedule moved to the Archived list below — reactivate it any time from there.`);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ minWidth: 180 }}>
        <button type="button" className="ghost-button btn-sm" style={{ border: "none", padding: 0, background: "none", fontWeight: 700, color: "var(--ink)" }} onClick={() => navigate(`/employees/${schedule.employee_id}`)}>
          {schedule.employee_name}
        </button>
        <div className="muted" style={{ fontSize: 12 }}>{schedule.frequency}</div>
      </div>
      <span className={`status-pill ${schedule.status === "Active" ? "status-green" : schedule.status === "Paused" ? "status-amber" : "status-gray"}`}>{schedule.status}</span>
      {schedule.status !== "Archived" && (
        <span className="muted" style={{ fontSize: 12.5 }}>
          Pay date {fmtDateOnly(schedule.next_pay_date)} — {schedule.drafts_from <= new Date().toISOString().slice(0, 10) ? "due to draft now" : `drafts starting ${fmtDateOnly(schedule.drafts_from)}`}
        </span>
      )}
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", gap: 8 }}>
        {schedule.status === "Active" && (
          <button type="button" className="ghost-button btn-sm" disabled={busy} onClick={handlePause}>Pause</button>
        )}
        {schedule.status === "Paused" && (
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => doAction("resume", `Resumed. ${schedule.employee_name} will be drafted again ahead of their next pay date.`)}>Resume</button>
        )}
        {schedule.status === "Archived" ? (
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => doAction("resume", `Reactivated. ${schedule.employee_name} will be drafted again ahead of their next pay date.`)}>Reactivate</button>
        ) : (
          <button type="button" className="ghost-button btn-sm" disabled={busy} onClick={handleArchive}>Archive</button>
        )}
      </div>
    </div>
  );
}

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
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
  const notify = useNotify();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);
  const [autoRunEnabled, setAutoRunEnabled] = useState<boolean | null>(null);
  const [togglingAutoRun, setTogglingAutoRun] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

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

  const liveSchedules = useMemo(() => (schedules || []).filter((s) => s.status !== "Archived"), [schedules]);
  const archivedSchedules = useMemo(() => (schedules || []).filter((s) => s.status === "Archived"), [schedules]);

  if (error) return <ErrorBanner error={error} />;
  if (!drafts) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Payroll Agent — Draft Payroll</h1>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            These are drafts only — nothing here is a real paycheck or posted to the ledger until you approve it.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {autoRunEnabled !== null && (
            <button
              type="button"
              className={`status-pill ${autoRunEnabled ? "status-green" : "status-red"}`}
              style={{ border: "none", cursor: togglingAutoRun ? "wait" : "pointer" }}
              aria-pressed={autoRunEnabled}
              disabled={togglingAutoRun}
              onClick={handleToggleAutoRun}
              title="The nightly automatic draft run. Turning this off does not affect Run Agent Now or existing schedules — it only pauses the 6:15AM automatic sweep."
            >
              Auto Payroll: {autoRunEnabled ? "On" : "Off"}
            </button>
          )}
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

      <div className="command-panel" style={{ marginBottom: 20 }}>
        <div className="command-panel-header">
          <div>
            <h2 className="command-panel-title">Recurring Schedules</h2>
            <div className="command-panel-note">
              Who the agent drafts pay for, and how often. Enable a new one from that employee's own profile page (Profile tab) — this list is for managing schedules that already exist.
            </div>
          </div>
        </div>
        {!schedules ? (
          <p className="muted" style={{ padding: 16, margin: 0 }}>Loading…</p>
        ) : liveSchedules.length === 0 ? (
          <p className="muted" style={{ padding: 16, margin: 0 }}>
            No schedules yet. Open an employee's profile and use the "Recurring Payroll Agent" section there to enable one.
          </p>
        ) : (
          <div>
            {liveSchedules.map((s) => <ScheduleRow key={s.payroll_schedule_id} schedule={s} onChanged={loadSchedules} />)}
          </div>
        )}
        {archivedSchedules.length > 0 && (
          <div style={{ borderTop: "1px solid var(--line)" }}>
            <button
              type="button"
              className="ghost-button btn-sm"
              style={{ margin: 16 }}
              aria-expanded={showArchived}
              onClick={() => setShowArchived((v) => !v)}
            >
              {showArchived ? "Hide" : "Show"} archived ({archivedSchedules.length})
            </button>
            {showArchived && archivedSchedules.map((s) => <ScheduleRow key={s.payroll_schedule_id} schedule={s} onChanged={loadSchedules} />)}
          </div>
        )}
      </div>

      <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Pending Drafts</h2>

      {drafts.length === 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No pending drafts right now. Drafts appear here automatically as each schedule above nears its next pay date, or click "Run Agent Now" to check immediately.
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
    </div>
  );
}
