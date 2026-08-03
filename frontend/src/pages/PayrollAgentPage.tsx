import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { usePrompt, useNotify, useConfirm } from "../components/ConfirmProvider";
import { fmtDateOnly } from "../utils/date";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { Client } from "../api/types";

const SCHEDULE_FREQUENCIES = ["Weekly", "Biweekly", "Semimonthly", "Monthly"] as const;

interface PickerEmployee {
  employee_id: string; employee_name: string; status: string; worker_type: string | null;
  default_gross_wages: string | number | null; pay_rate: string | number | null; default_hours: string | number | null;
}

/** Same eligibility rule the backend enforces — mirrored here so ineligible
 * employees show a reason instead of just being silently absent from the list. */
function ineligibleReasonFor(e: PickerEmployee): string | null {
  if (String(e.status || "Active").toLowerCase() !== "active") return "not active";
  if (String(e.worker_type || "").toLowerCase().includes("contractor")) return "contractor, not eligible";
  const hasGross = Number(e.default_gross_wages) > 0;
  const hasHourly = Number(e.pay_rate) > 0 && Number(e.default_hours) > 0;
  if (!hasGross && !hasHourly) return "needs Default Gross Wages or Pay Rate + Default Hours set first";
  return null;
}

interface CompanyEnrollState {
  expanded: boolean;
  frequency: string;
  anchorDate: string;
  employees: PickerEmployee[] | null;
  selected: Set<string>;
}

function emptyCompanyState(): CompanyEnrollState {
  return { expanded: false, frequency: "Biweekly", anchorDate: "", employees: null, selected: new Set() };
}

/**
 * "Select Employees for Auto Payroll" — organized by company first: each
 * client is its own expandable section rather than a dropdown you must pick
 * before any employee ever shows up. Open a company, pick its pay schedule,
 * check whoever should be on it. Multiple companies can be open and
 * enrolled in the same visit, each keeping its own frequency/next-payday
 * since two client companies essentially never share a payday.
 */
function EnrollAutoPayrollModal({ alreadyEnrolledIds, onClose, onEnrolled }: { alreadyEnrolledIds: Set<string>; onClose: () => void; onEnrolled: () => void }) {
  const notify = useNotify();
  const panelRef = useRef<HTMLDivElement>(null);
  useEscapeToClose(onClose, true);
  useFocusTrap(panelRef, true);

  const [clients, setClients] = useState<Client[] | null>(null);
  const [companies, setCompanies] = useState<Record<string, CompanyEnrollState>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => setClients([]));
  }, []);

  function companyState(clientId: string): CompanyEnrollState {
    return companies[clientId] || emptyCompanyState();
  }

  function updateCompany(clientId: string, patch: Partial<CompanyEnrollState>) {
    setCompanies((prev) => ({ ...prev, [clientId]: { ...companyState(clientId), ...patch } }));
  }

  function toggleExpand(clientId: string) {
    const current = companyState(clientId);
    const nextExpanded = !current.expanded;
    updateCompany(clientId, { expanded: nextExpanded });
    if (nextExpanded && current.employees === null) {
      api.get<{ employees: PickerEmployee[] }>(`/accounting/employees/${clientId}`)
        .then((res) => updateCompany(clientId, { employees: res.employees }))
        .catch(() => updateCompany(clientId, { employees: [] }));
    }
  }

  function toggleEmployee(clientId: string, employeeId: string) {
    const current = companyState(clientId);
    const next = new Set(current.selected);
    next.has(employeeId) ? next.delete(employeeId) : next.add(employeeId);
    updateCompany(clientId, { selected: next });
  }

  const totalSelected = Object.values(companies).reduce((sum, c) => sum + c.selected.size, 0);
  const missingAnchorDate = Object.values(companies).some((c) => c.selected.size > 0 && !c.anchorDate);

  async function handleSubmit() {
    if (!totalSelected || missingAnchorDate) return;
    setSubmitting(true);
    setError(null);
    try {
      const entries = Object.entries(companies).filter(([, c]) => c.selected.size > 0);
      const results = await Promise.all(entries.map(([clientId, c]) =>
        api.post<{ succeeded: number; failed: number; results: { employeeId: string; ok: boolean; error?: string }[] }>(
          "/accounting/payroll-agent/schedules/bulk",
          { clientId, employeeIds: Array.from(c.selected), frequency: c.frequency, anchorDate: c.anchorDate }
        ).catch((err) => ({
          succeeded: 0, failed: c.selected.size,
          results: [{ employeeId: "", ok: false, error: err instanceof ApiError ? err.message : "Request failed." }],
        }))
      ));
      const succeeded = results.reduce((s, r) => s + r.succeeded, 0);
      const failed = results.reduce((s, r) => s + r.failed, 0);
      const failMessages = results.flatMap((r) => r.results.filter((x) => !x.ok).map((x) => x.error)).filter(Boolean);
      onEnrolled();
      onClose();
      await notify(failed
        ? `Enrolled ${succeeded} of ${totalSelected}. ${failed} couldn't be enrolled: ${failMessages.join(" ")}`
        : `Enrolled ${succeeded} employee${succeeded === 1 ? "" : "s"} in Auto-Draft Payroll.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not enroll these employees.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="enroll-auto-payroll-title" style={{ maxWidth: 640, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2 id="enroll-auto-payroll-title">Select Employees for Auto Payroll</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        {error && <ErrorBanner error={error} />}
        <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
          Open a company below to set its pay schedule and pick which employees to enroll. You can enroll employees from more than one company in the same visit.
        </p>

        {!clients ? (
          <p className="muted" style={{ fontSize: 13 }}>Loading…</p>
        ) : clients.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>No clients found.</p>
        ) : (
          <div style={{ maxHeight: 440, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
            {clients.map((c) => {
              const state = companyState(c.client_id);
              const eligible = (state.employees || []).filter((e) => !alreadyEnrolledIds.has(e.employee_id) && !ineligibleReasonFor(e));
              const alreadyEnrolled = (state.employees || []).filter((e) => alreadyEnrolledIds.has(e.employee_id));
              const ineligible = (state.employees || []).filter((e) => !alreadyEnrolledIds.has(e.employee_id) && ineligibleReasonFor(e));
              return (
                <div key={c.client_id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <button
                    type="button"
                    onClick={() => toggleExpand(c.client_id)}
                    aria-expanded={state.expanded}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "12px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
                  >
                    <span style={{ fontSize: 11, display: "inline-block", transform: state.expanded ? "rotate(90deg)" : "none", transition: "transform 0.1s" }}>▶</span>
                    <span style={{ fontWeight: 700, flex: 1 }}>{c.client_name}</span>
                    {state.selected.size > 0 && <span className="status-pill status-green">{state.selected.size} selected</span>}
                  </button>

                  {state.expanded && (
                    <div style={{ padding: "0 14px 14px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
                        <div className="field" style={{ margin: 0 }}>
                          <label htmlFor={`enroll-frequency-${c.client_id}`}>Pay schedule</label>
                          <select id={`enroll-frequency-${c.client_id}`} value={state.frequency} onChange={(e) => updateCompany(c.client_id, { frequency: e.target.value })}>
                            {SCHEDULE_FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
                          </select>
                        </div>
                        <div className="field" style={{ margin: 0 }}>
                          <label htmlFor={`enroll-anchor-date-${c.client_id}`}>Next payday</label>
                          <input id={`enroll-anchor-date-${c.client_id}`} type="date" value={state.anchorDate} onChange={(e) => updateCompany(c.client_id, { anchorDate: e.target.value })} />
                        </div>
                      </div>

                      {state.employees === null ? (
                        <p className="muted" style={{ fontSize: 13 }}>Loading employees…</p>
                      ) : eligible.length === 0 && alreadyEnrolled.length === 0 && ineligible.length === 0 ? (
                        <p className="muted" style={{ fontSize: 13 }}>No employees found for this client.</p>
                      ) : (
                        <div style={{ border: "1px solid var(--line)", borderRadius: 8 }}>
                          {eligible.map((e) => (
                            <label key={e.employee_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: "1px solid var(--line)", cursor: "pointer" }}>
                              <input type="checkbox" checked={state.selected.has(e.employee_id)} onChange={() => toggleEmployee(c.client_id, e.employee_id)} />
                              {e.employee_name}
                            </label>
                          ))}
                          {alreadyEnrolled.map((e) => (
                            <div key={e.employee_id} className="muted" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                              <input type="checkbox" checked disabled />
                              {e.employee_name} — already enrolled
                            </div>
                          ))}
                          {ineligible.map((e) => (
                            <div key={e.employee_id} className="muted" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                              <input type="checkbox" disabled />
                              {e.employee_name} — {ineligibleReasonFor(e)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 16 }}>
          {missingAnchorDate && totalSelected > 0 && <span className="muted" style={{ fontSize: 12.5, marginRight: "auto" }}>Set a next payday for each company you're enrolling.</span>}
          <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={submitting || !totalSelected || missingAnchorDate} onClick={handleSubmit}>
            {submitting ? "Enrolling…" : `Enroll${totalSelected ? ` ${totalSelected}` : ""} Employee${totalSelected === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const [showOff, setShowOff] = useState(false);
  const [showEnrollModal, setShowEnrollModal] = useState(false);

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
  const offSchedules = useMemo(() => (schedules || []).filter((s) => s.status !== "Active"), [schedules]);
  const enrolledIds = useMemo(() => new Set((schedules || []).map((s) => s.employee_id)), [schedules]);

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
            <button type="button" className="btn btn-sm" onClick={() => setShowEnrollModal(true)}>+ Enroll More</button>
          )}
        </div>
        {!schedules ? (
          <p className="muted" style={{ padding: 16, margin: 0 }}>Loading…</p>
        ) : schedules.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 24px" }}>
            <p className="muted" style={{ margin: "0 0 16px" }}>
              You haven't enrolled any employees in Auto Payroll yet. Adding employees lets you pay them automatically.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => setShowEnrollModal(true)}>Select Employees for Auto Payroll</button>
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

      {showEnrollModal && (
        <EnrollAutoPayrollModal
          alreadyEnrolledIds={enrolledIds}
          onClose={() => setShowEnrollModal(false)}
          onEnrolled={loadSchedules}
        />
      )}
    </div>
  );
}
