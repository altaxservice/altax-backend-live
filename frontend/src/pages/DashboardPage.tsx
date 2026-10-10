import { PickUpWhereYouLeftOff } from "../components/WorkTrail";
import { FirmPulse } from "../components/FirmPulse";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, downloadFile, viewFile, printFile, openAnyFile, buildFilename } from "../api/client";
import type { Client, Task, Appointment } from "../api/types";
import type { DocumentRequest, Invoice, WebOptions } from "../api/types2";
import { useAuth } from "../auth/AuthContext";
import { useSelectedBusiness } from "../context/SelectedBusinessContext";
import { StatusBadge } from "../components/StatusBadge";
import { ActionMenu } from "../components/ActionMenu";
import { FilterBar, exportCsv } from "../components/FilterBar";
import { useToast } from "../components/Toast";
import { usePrompt, useNotify } from "../components/ConfirmProvider";
import { fmtDateOnly as fmtDate, daysUntil, fmtCheckedAt } from "../utils/date";
import { TASK_STATUSES, statusOptionsForTaskType, isOpenTask, isOverdue, isDueToday, isDueWeek, isWaiting, DueLabel, TaskFileCell, taskActionOptions, TASK_QUICK_ACTIONS, TASK_QUICK_ACTION_ICON } from "../components/TaskCells";
import { obligationAccountingTab } from "../utils/obligationTasks";
import { RequestDocumentModal } from "../components/RequestDocumentModal";
import { useLanguage, Num } from "../context/LanguageContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { SinceLastLoginBanner } from "../components/SinceLastLoginBanner";
import { useSelectedClient } from "../context/SelectedClientContext";
import { GOV_FORM_LABELS } from "../api/govForms";
import type { GovFormType, GovFormFiling } from "../api/govForms";
import { useStickyState } from "../utils/listState";
import { AlertTriangle, Building2, CalendarClock, ClipboardCheck, FileWarning, FolderInput, Landmark, MessageSquare, TrendingUp, Wallet, type LucideIcon } from "lucide-react";

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

interface AccountNotice {
  flagId: string | null;
  labelEn: string;
  labelAr: string;
  note: string | null;
  details: string | null;
  amount: number | null;
  dueDate: string | null;
  color: "red" | "green" | "amber";
}

interface ClientTaxRow {
  task_id: string; task_name: string; agency_due_date: string | null; paid_date: string | null;
  payment_amount: string | number | null; confirmation_number: string | null; status: string;
}

interface MyAppointment {
  appointmentId: string; title: string; startTime: string; endTime: string;
  location: string | null; status: string; appointmentTypeName: string | null; manageUrl: string | null;
}

function fmtApptWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function CommandPanel({ title, note, action, children, critical = false }: { title: React.ReactNode; note: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; critical?: boolean }) {
  return (
    <div className={`command-panel${critical ? " command-panel-critical" : ""}`}>
      <div className="command-panel-header">
        <div>
          <h2 className="command-panel-title">{title}</h2>
          <div className="command-panel-note">{note}</div>
        </div>
        {action}
      </div>
      <div>{children}</div>
    </div>
  );
}

/**
 * UX-008: "Waiting / Pending" tasks have no due date pressure of their own —
 * they're blocked on someone else (client, agency) — so nothing on the
 * dashboard signaled when one had actually been sitting untouched for weeks
 * vs. just entered that status yesterday. updated_at is the best available
 * proxy for "last touched" (any edit bumps it, not just a status change, but
 * there's no separate status-transition timestamp on v3_tasks to use
 * instead). 7/21 day thresholds mirror the amber/red staleness convention
 * used for AR aging and the stale-document-request Fix Center check.
 */
function staleDaysBadge(updatedAt: string | null): { days: number; className: string } | null {
  if (!updatedAt) return null;
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000);
  if (days < 7) return null;
  return { days, className: days >= 21 ? "status-red" : "status-amber" };
}

function TaskRows({ tasks, empty, statusEditable = true, showStaleness = false, onChanged }: { tasks: Task[]; empty: string; statusEditable?: boolean; showStaleness?: boolean; onChanged?: () => void }) {
  const navigate = useNavigate();
  const promptFor = usePrompt();
  const notify = useNotify();
  const { user } = useAuth();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [requestDocTask, setRequestDocTask] = useState<Task | null>(null);
  const [options, setOptions] = useState<WebOptions | null>(null);
  useEffect(() => { if (statusEditable) api.get<WebOptions>("/system/options").then(setOptions).catch(() => {}); }, [statusEditable]);

  if (!tasks.length) return <p className="muted" style={{ padding: 16 }}>{empty}</p>;

  async function handleStatusChange(taskId: string, status: string) {
    setSavingId(taskId);
    try {
      await api.patch(`/tasks/${taskId}`, { status });
      onChanged?.();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not update status.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleAction(task: Task, action: string) {
    if (action === "review-task" || action === "task-history") return navigate(`/tasks/${task.task_id}`);
    if (action === "task-message") return navigate(`/tasks/${task.task_id}?open=message`);
    if (action === "task-note") return navigate(`/tasks/${task.task_id}?open=note`);
    if (action === "edit-task") return navigate(`/tasks/${task.task_id}?open=edit`);
    if (action === "task-file") return navigate(`/tasks/${task.task_id}?open=files`);
    if (action === "request-doc") return setRequestDocTask(task);
    if (action === "void-task") {
      const reason = await promptFor({ title: "Void task", message: "Reason for voiding this task?" });
      if (reason === null) return;
      try {
        await api.post(`/tasks/${task.task_id}/void`, { reason });
        onChanged?.();
      } catch (err) {
        await notify(err instanceof ApiError ? err.message : "Could not void this task.");
      }
    }
    if (action === "delete-task") {
      const confirmValue = await promptFor({
        title: "Permanently delete task",
        message: `"${task.task_name}" — this cannot be undone. Type DELETE TASK to confirm.`,
        placeholder: "DELETE TASK",
      });
      if (confirmValue === null) return;
      try {
        await api.post(`/tasks/${task.task_id}/delete`, { confirm: confirmValue });
        onChanged?.();
      } catch (err) {
        await notify(err instanceof ApiError ? err.message : "Could not delete this task.");
      }
    }
  }

  return (
    <div className="work-card-list">
      {tasks.map((t) => {
        const stale = showStaleness ? staleDaysBadge(t.updated_at) : null;
        return (
        <article className="work-card" key={t.task_id} onClick={() => navigate(`/tasks/${t.task_id}`)} style={{ cursor: "pointer" }} tabIndex={0} role="button" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/tasks/${t.task_id}`); } }}>
          <div className="work-card-main">
            <div className="work-card-title">{t.task_name || t.service_line || "Task"}</div>
            <div className="work-card-client muted">{t.client_name}</div>
            <div className="work-card-meta">
              <span>{t.service_line || "Service"}</span>
              <span>Due {fmtDate(t.agency_due_date) || "Not set"}</span>
              <span>{t.assigned_to || "Unassigned"}</span>
              {stale && <span className={`status-pill ${stale.className}`}>Untouched {stale.days}d</span>}
            </div>
          </div>
          <div className="work-card-side">
            <DueLabel task={t} />
            {statusEditable && user?.role !== "client" ? (
              <select
                className="inline-select task-status"
                value={t.status || "Not Started"}
                disabled={savingId === t.task_id}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => handleStatusChange(t.task_id, e.target.value)}
              >
                {statusOptionsForTaskType(options?.taskStatusesWithType, t.service_line).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <StatusBadge status={t.status} />
            )}
            <TaskFileCell task={t} />
            <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6 }}>
              {user?.role !== "client" && TASK_QUICK_ACTIONS.map((a) => {
                const Icon = TASK_QUICK_ACTION_ICON[a.value];
                return (
                  <button key={a.value} type="button" className="btn btn-sm" onClick={() => handleAction(t, a.value)}>
                    {Icon && <Icon size={13} strokeWidth={2} aria-hidden="true" />}
                    {a.label}
                  </button>
                );
              })}
              {user?.role !== "client" && t.client_id && obligationAccountingTab(t) && (
                <button type="button" className="btn btn-sm" onClick={() => navigate(`/accounting?client=${encodeURIComponent(t.client_id!)}&tab=${encodeURIComponent(obligationAccountingTab(t)!)}`)}>
                  Finish in Accounting
                </button>
              )}
              <ActionMenu options={taskActionOptions(user?.role)} onSelect={(action) => handleAction(t, action)} />
            </div>
          </div>
        </article>
        );
      })}
      {requestDocTask && (
        <RequestDocumentModal
          clientId={requestDocTask.client_id}
          clientName={requestDocTask.client_name}
          taskId={requestDocTask.task_id}
          onClose={() => setRequestDocTask(null)}
          onDone={() => onChanged?.()}
        />
      )}
    </div>
  );
}

/** Mirrors legacy's commandAttentionList(): a compact row (title/client/due + a single pill), not the full action card — used for the narrow "Needs Attention" side panel. */
function AttentionRows({ tasks, empty }: { tasks: Task[]; empty: string }) {
  const navigate = useNavigate();
  if (!tasks.length) return <p className="muted" style={{ padding: 16 }}>{empty}</p>;
  return (
    <div className="attention-list">
      {tasks.map((t) => (
        <div className="attention-item" key={t.task_id} onClick={() => navigate(`/tasks/${t.task_id}`)} tabIndex={0} role="button" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/tasks/${t.task_id}`); } }}>
          <div className="attention-main">
            <div className="attention-title">{t.task_name || t.service_line || "Task"}</div>
            <div className="attention-meta">
              <span>{t.client_name}</span>
              <span>{fmtDate(t.agency_due_date) || "No due date"}</span>
            </div>
          </div>
          <DueLabel task={t} />
        </div>
      ))}
    </div>
  );
}

/** Same compact shape as AttentionRows, for document requests (UX-016) — mirrors it deliberately rather than generalizing both into one shared component, since Task and DocumentRequest don't share a due-date field name or a DueLabel-compatible shape. */
function AttentionDocRows({ docs, empty }: { docs: DocumentRequest[]; empty: string }) {
  const navigate = useNavigate();
  if (!docs.length) return <p className="muted" style={{ padding: 16 }}>{empty}</p>;
  return (
    <div className="attention-list">
      {docs.map((d) => (
        <div className="attention-item" key={d.request_id} onClick={() => navigate(`/documents/${d.request_id}`)} tabIndex={0} role="button" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/documents/${d.request_id}`); } }}>
          <div className="attention-main">
            <div className="attention-title">{d.requested_item || "Document Request"}</div>
            <div className="attention-meta">
              <span>{d.client_name}</span>
              <span>{fmtDate(d.due_from_client) || "No due date"}</span>
            </div>
          </div>
          <StatusBadge status={d.status} />
        </div>
      ))}
    </div>
  );
}

function MiniKpis({ items }: { items: [string, string][] }) {
  return (
    <div className="command-mini-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", padding: 16, gap: 10 }}>
      {items.map(([label, value]) => (
        <div className="command-mini-kpi" key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span className="muted">{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

interface AtRiskClient {
  clientId: string;
  clientName: string;
  balancePastDue: number;
  agencyPastDueCount: number;
  agencyPastDueAmount: number;
  manualFlagCount: number;
  mdSalesTaxUnfiledPeriodEnd: string | null;
  mdSalesTaxUnfiledAmount: number;
  payrollGapNote: string | null;
  bookkeepingStaleDays: number | null;
  missingComplianceTaskCount: number;
}

/**
 * The Sales tab's initialFrom/initialTo query params (AccountingPage.tsx)
 * expect a real date range, but /clients/flags only ever gives us the
 * missing period's END date, not its start (the source query doesn't track
 * it — see clients.routes.ts). A year-wide lookback safely contains the
 * missing period regardless of the client's actual filing frequency
 * (monthly/quarterly/semiannual/annual), so the period the row is actually
 * about is guaranteed to be on screen rather than requiring a second click
 * to widen the date range after landing on the tab.
 */
function mdSalesTaxDeepLink(clientId: string, periodEnd: string): string {
  const end = new Date(`${periodEnd}T00:00:00Z`);
  const from = new Date(end);
  from.setUTCDate(from.getUTCDate() - 370);
  return `/accounting?client=${clientId}&tab=Sales&from=${from.toISOString().slice(0, 10)}&to=${periodEnd}`;
}

/**
 * UX-001 (hard audit 2026-08-13) — flags were previously visible only by
 * opening one client's own panel at a time; nothing showed which clients
 * across the whole firm had actually crossed into risk. Backed by
 * GET /clients/flags, a set of firm-wide GROUP BY queries (not one call per
 * client), so this loads in constant time regardless of client count.
 */
function AtRiskClientsPanel({ flags }: { flags?: AtRiskClient[] | null }) {
  const navigate = useNavigate();
  const { setSelectedClient } = useSelectedClient();
  const [fetched, setFetched] = useState<AtRiskClient[] | null>(null);
  const clients = flags !== undefined ? flags : fetched;

  useEffect(() => {
    if (flags !== undefined) return;
    let cancelled = false;
    api.get<{ clients: AtRiskClient[] }>("/clients/flags").then((res) => { if (!cancelled) setFetched(res.clients); }).catch(() => { if (!cancelled) setFetched([]); });
    return () => { cancelled = true; };
  }, [flags]);

  if (!clients || clients.length === 0) return null;

  // Land on the exact reason the row is showing, not just the client's
  // generic page — the unfiled-period case has a real destination (the Sales
  // tab, scoped to that period); everything else this panel can flag
  // (overdue balance, agency obligations, payroll/bookkeeping gaps, missing
  // compliance tasks, manual flags) renders in one place, Account Flags on
  // the At a Glance tab, so those go straight there via the #account-flags
  // anchor (see ClientDetailPage.tsx) instead of the bare client page.
  const go = (c: AtRiskClient) => {
    setSelectedClient(c.clientId, c.clientName);
    if (c.mdSalesTaxUnfiledPeriodEnd) return navigate(mdSalesTaxDeepLink(c.clientId, c.mdSalesTaxUnfiledPeriodEnd));
    navigate(`/clients/${c.clientId}#account-flags`);
  };

  const salesTaxUnfiledCount = clients.filter((c) => c.mdSalesTaxUnfiledPeriodEnd).length;

  return (
    <CommandPanel
      critical
      title="At-Risk Clients"
      note={`${clients.length} client${clients.length === 1 ? "" : "s"} with an open balance, agency obligation, unfiled MD sales tax, payroll/bookkeeping gap, or flag past due${salesTaxUnfiledCount > 0 ? ` — ${salesTaxUnfiledCount} missing a sales tax filing` : ""}`}
    >
      <div className="attention-list">
        {clients.slice(0, 8).map((c) => (
          <div className="attention-item" key={c.clientId} onClick={() => go(c)} tabIndex={0} role="button" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(c); } }}>
            <div className="attention-main">
              <div className="attention-title">{c.clientName}</div>
              <div className="attention-meta">
                {c.balancePastDue > 0 && <span>{fmtMoney(c.balancePastDue)} overdue balance</span>}
                {c.agencyPastDueCount > 0 && <span>{c.agencyPastDueCount} agency obligation{c.agencyPastDueCount === 1 ? "" : "s"} past due{c.agencyPastDueAmount > 0 ? ` (${fmtMoney(c.agencyPastDueAmount)})` : ""}</span>}
                {c.mdSalesTaxUnfiledPeriodEnd && <span className="status-pill status-red" style={{ fontSize: 11 }}>Sales tax not filed (period ending {fmtDate(c.mdSalesTaxUnfiledPeriodEnd)})</span>}
                {c.payrollGapNote && <span className="status-pill status-red" style={{ fontSize: 11 }}>Payroll gap — {c.payrollGapNote}</span>}
                {c.bookkeepingStaleDays !== null && <span className="status-pill status-amber" style={{ fontSize: 11 }}>Books stale ({c.bookkeepingStaleDays} days)</span>}
                {c.missingComplianceTaskCount > 0 && <span className="status-pill status-red" style={{ fontSize: 11 }}>{c.missingComplianceTaskCount} compliance task{c.missingComplianceTaskCount === 1 ? "" : "s"} not on file</span>}
                {c.manualFlagCount > 0 && <span>{c.manualFlagCount} open flag{c.manualFlagCount === 1 ? "" : "s"}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
      {clients.length > 8 && <p className="muted" style={{ padding: "8px 16px", fontSize: 12.5 }}>+{clients.length - 8} more at-risk client{clients.length - 8 === 1 ? "" : "s"} not shown.</p>}
    </CommandPanel>
  );
}

interface ManagementException {
  severity: "critical" | "warning";
  label: string;
  count: number;
  amount?: number;
  detail: string;
  link: string;
}

/**
 * "Management manages exceptions, not thousands of records" — one ranked
 * list at the very top of the Command Center instead of making the owner
 * scan every panel below to notice what's actually urgent. Backed by GET
 * /reports/management-exceptions (reports.routes.ts), which pulls together
 * AR aging, missed MD sales tax filings, overdue tasks, overdue invoices,
 * and MD portal verification staleness — signals that already exist as
 * separate panels on this page (At-Risk Clients, Missing Sales Tax
 * Filings, Verification Due) plus a couple of direct counts. This
 * supplements those panels rather than replacing them; it's the "read this
 * first" summary, they're still the "drill into it" detail.
 */
function ManagementExceptionsPanel() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ManagementException[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<{ items: ManagementException[] }>("/reports/management-exceptions")
      .then((res) => { if (!cancelled) setItems(res.items); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <CommandPanel
      critical={items.some((i) => i.severity === "critical")}
      title="Management Attention Required"
      note={`${items.length} item${items.length === 1 ? "" : "s"} across the firm need${items.length === 1 ? "s" : ""} a look`}
    >
      <div className="attention-list">
        {items.map((i) => (
          <div className="attention-item" key={i.label} onClick={() => navigate(i.link)} tabIndex={0} role="button" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(i.link); } }}>
            <div className="attention-main">
              <div className="attention-title">
                <span className={`status-pill ${i.severity === "critical" ? "status-red" : "status-amber"}`} style={{ fontSize: 11, marginRight: 6 }}>
                  {i.severity === "critical" ? "Critical" : "Attention"}
                </span>
                {i.count} {i.label}
              </div>
              <div className="attention-meta"><span>{i.detail}</span></div>
            </div>
          </div>
        ))}
      </div>
    </CommandPanel>
  );
}

/**
 * The direct answer to "tell me if I missed a client who was supposed to
 * file and I didn't — not by task, an actual flag" (owner request,
 * 2026-08-13). Separate panel from AtRiskClientsPanel (rather than folded
 * into it) because that panel caps at 8 rows ranked by dollars owed — a
 * client whose ONLY problem is an unfiled sales tax period, with no overdue
 * balance, would rank at the bottom and could get hidden behind "+N more."
 * This is verified against the real filed/paid record
 * (v3_md_filing_payments + actual sales data), not whether a Task Rules
 * Agent-generated "Sales Tax Filing" task happens to still be open — a task
 * can go unresolved, or get marked Completed without anyone actually having
 * filed, and neither would move this panel.
 */
function MissingSalesTaxFilingsPanel({ flags }: { flags?: AtRiskClient[] | null }) {
  const navigate = useNavigate();
  const [fetched, setFetched] = useState<AtRiskClient[] | null>(null);
  const clients = flags !== undefined ? (flags ? flags.filter((c) => c.mdSalesTaxUnfiledPeriodEnd) : null) : fetched;

  useEffect(() => {
    if (flags !== undefined) return;
    let cancelled = false;
    api.get<{ clients: AtRiskClient[] }>("/clients/flags")
      .then((res) => { if (!cancelled) setFetched(res.clients.filter((c) => c.mdSalesTaxUnfiledPeriodEnd)); })
      .catch(() => { if (!cancelled) setFetched([]); });
    return () => { cancelled = true; };
  }, [flags]);

  if (!clients || clients.length === 0) return null;
  const go = (c: AtRiskClient) => navigate(mdSalesTaxDeepLink(c.clientId, c.mdSalesTaxUnfiledPeriodEnd!));

  return (
    <CommandPanel
      critical
      title="Missing Sales Tax Filings"
      note={`${clients.length} client${clients.length === 1 ? "" : "s"} whose most recent MD Sales & Use Tax period hasn't been filed, verified against real filing records`}
    >
      <div className="attention-list">
        {clients.slice(0, 10).map((c) => (
          <div className="attention-item" key={c.clientId} onClick={() => go(c)} tabIndex={0} role="button" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(c); } }}>
            <div className="attention-main">
              <div className="attention-title">{c.clientName}</div>
              <div className="attention-meta">
                <span>Period ending {fmtDate(c.mdSalesTaxUnfiledPeriodEnd!)}</span>
                {c.mdSalesTaxUnfiledAmount > 0 && <span>{fmtMoney(c.mdSalesTaxUnfiledAmount)} balance due</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
      {clients.length > 10 && <p className="muted" style={{ padding: "8px 16px", fontSize: 12.5 }}>+{clients.length - 10} more not shown — see the Sales &amp; Tax report for the full list.</p>}
    </CommandPanel>
  );
}

interface VerificationDueClient {
  clientId: string; clientName: string;
  mdtaxconnectVerifiedAt: string | null; mdtaxconnectVerifiedBy: string | null;
  mdBusinessExpressVerifiedAt: string | null; mdBusinessExpressVerifiedBy: string | null;
}

/**
 * The direct answer to "I keep re-checking some clients on MDTAXCONNECT/MD
 * Business Express and missing others" — a real queue, oldest-checked-first
 * (backend already sorts it), instead of relying on memory for which MD
 * clients still need a look. Clicking a row selects that client so the
 * External Verification section in the sidebar (ClientContextPanel) is
 * right there with a "Mark Checked" button — no separate page needed.
 */
/**
 * "Don't miss it, be ready for it" (direct owner request, 2026-08-24) — the
 * existing email/SMS staff reminders (notifyAppointmentStaff) are easy to
 * miss in an inbox; this puts today's schedule on the one screen every
 * admin/staff account already opens first. Clicking a row goes straight to
 * the linked client's own profile — the same "be ready" idea behind the new
 * push notification's deep link — not just a bare time slot. Firm-wide (not
 * filtered to the viewer's own appointments): GET /appointments has no
 * per-staff scoping today, and seeing a colleague's schedule alongside your
 * own is useful context, not noise, on a shared calendar this small.
 */
function TodaysAppointmentsPanel() {
  const navigate = useNavigate();
  const { setSelectedClient } = useSelectedClient();
  const [appts, setAppts] = useState<Appointment[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
    api.get<{ appointments: Appointment[] }>(`/appointments?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
      .then((res) => { if (!cancelled) setAppts(res.appointments.filter((a) => a.status === "Scheduled")); })
      .catch(() => { if (!cancelled) setAppts([]); });
    return () => { cancelled = true; };
  }, []);

  if (!appts || appts.length === 0) return null;
  const sorted = [...appts].sort((a, b) => a.start_time.localeCompare(b.start_time));

  function go(a: Appointment) {
    if (a.client_id) { setSelectedClient(a.client_id, a.client_name); navigate(`/clients/${a.client_id}`); }
    else navigate("/calendar");
  }

  const now = Date.now();
  function isStartingSoon(a: Appointment): boolean {
    const mins = (new Date(a.start_time).getTime() - now) / 60000;
    return mins >= 0 && mins <= 30;
  }
  function fmtApptTime(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  return (
    <CommandPanel
      title="Today's Appointments"
      note={`${sorted.length} scheduled today — click one to open the client and get ready before it starts`}
      action={<Link to="/calendar" className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>View calendar →</Link>}
    >
      <div className="attention-list">
        {sorted.map((a) => (
          <div className="attention-item" key={a.appointment_id} onClick={() => go(a)} tabIndex={0} role="button" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(a); } }}>
            <div className="attention-main">
              <div className="attention-title">
                {isStartingSoon(a) && <span style={{ color: "var(--red)", fontWeight: 800 }}>● Starting soon — </span>}
                {fmtApptTime(a.start_time)} — {a.title || "Appointment"} with {a.client_name || a.contact_name || "a contact"}
              </div>
              <div className="attention-meta">
                {a.assigned_to && <span>Assigned: {a.assigned_to}</span>}
                {a.location && <span>{a.location}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </CommandPanel>
  );
}

function VerificationDuePanel() {
  const navigate = useNavigate();
  const { setSelectedClient } = useSelectedClient();
  const [clients, setClients] = useState<VerificationDueClient[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<{ clients: VerificationDueClient[] }>("/clients/verification-due")
      .then((res) => { if (!cancelled) setClients(res.clients); })
      .catch(() => { if (!cancelled) setClients([]); });
    return () => { cancelled = true; };
  }, []);

  if (!clients || clients.length === 0) return null;
  const go = (c: VerificationDueClient) => { setSelectedClient(c.clientId, c.clientName); navigate(`/clients/${c.clientId}`); };

  function staleLabel(at: string | null): string {
    return at ? fmtCheckedAt(at) : "never checked";
  }

  return (
    <CommandPanel
      title="MD Verification Due"
      note={`${clients.length} MD client${clients.length === 1 ? "" : "s"} whose MDTAXCONNECT or MD Business Express check is missing or over 30 days old, oldest first`}
    >
      <div className="attention-list">
        {clients.slice(0, 10).map((c) => (
          <div className="attention-item" key={c.clientId} onClick={() => go(c)} tabIndex={0} role="button" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(c); } }}>
            <div className="attention-main">
              <div className="attention-title">{c.clientName}</div>
              <div className="attention-meta">
                <span>MDTAXCONNECT: {staleLabel(c.mdtaxconnectVerifiedAt)}</span>
                <span>MD Business Express: {staleLabel(c.mdBusinessExpressVerifiedAt)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {clients.length > 10 && <p className="muted" style={{ padding: "8px 16px", fontSize: 12.5 }}>+{clients.length - 10} more not shown.</p>}
    </CommandPanel>
  );
}

interface PendingGovFormReview {
  filing_id: string;
  form_type: string;
  review_requested_by: string | null;
  review_requested_at: string | null;
  client_id: string | null;
  client_name: string | null;
  employee_id: string | null;
  employee_name: string | null;
}

/** TAX-004 — an admin's only way to discover a filing sent for review otherwise is opening each client one by one. */
function PendingFilingReviewsPanel() {
  const navigate = useNavigate();
  const { setSelectedClient } = useSelectedClient();
  const [filings, setFilings] = useState<PendingGovFormReview[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<{ filings: PendingGovFormReview[] }>("/gov-forms/pending-review").then((res) => { if (!cancelled) setFilings(res.filings); }).catch(() => { if (!cancelled) setFilings([]); });
    return () => { cancelled = true; };
  }, []);

  if (!filings || filings.length === 0) return null;

  const go = (f: PendingGovFormReview) => {
    if (f.client_id) { setSelectedClient(f.client_id, f.client_name || ""); navigate(`/clients/${f.client_id}`); }
    else if (f.employee_id) navigate(`/employees/${f.employee_id}`);
  };

  return (
    <CommandPanel title="Filing Reviews" note={`${filings.length} government form${filings.length === 1 ? "" : "s"} awaiting your approval before submission`}>
      <div className="attention-list">
        {filings.slice(0, 8).map((f) => (
          <div className="attention-item" key={f.filing_id} onClick={() => go(f)} tabIndex={0} role="button" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(f); } }}>
            <div className="attention-main">
              <div className="attention-title">{GOV_FORM_LABELS[f.form_type as GovFormType] || f.form_type}</div>
              <div className="attention-meta">
                <span>{f.client_name || f.employee_name || "—"}</span>
                <span>Requested by {f.review_requested_by || "—"}</span>
                {f.review_requested_at && <span>{fmtDate(f.review_requested_at)}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
      {filings.length > 8 && <p className="muted" style={{ padding: "8px 16px", fontSize: 12.5 }}>+{filings.length - 8} more not shown.</p>}
    </CommandPanel>
  );
}

function docActionOptions(role: string | undefined, hasFile: boolean) {
  const actions: { value: string; label: string }[] = [
    { value: "upload-doc", label: role === "client" ? "Upload Document" : "Upload / Share File" },
  ];
  if (role !== "client") actions.push({ value: "edit-doc", label: "Edit" });
  if (hasFile) actions.push({ value: "view-doc", label: "View File" }, { value: "open-doc", label: "Open File" });
  return actions;
}

/** UX-004: mirrors DocumentsListPage.tsx's isOverdue()/isDueSoon() — this panel had no urgency signal at all on the due date, just the plain string. */
function docUrgency(d: DocumentRequest): "overdue" | "due-soon" | null {
  if (!d.due_from_client || ["completed", "closed", "void"].includes(String(d.status || "").toLowerCase())) return null;
  const due = new Date(d.due_from_client);
  if (Number.isNaN(due.getTime())) return null;
  const days = (due.getTime() - Date.now()) / 86400000;
  if (days < 0) return "overdue";
  if (days <= 3) return "due-soon";
  return null;
}

function DocumentRows({ docs, empty }: { docs: DocumentRequest[]; empty: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  if (!docs.length) return <p className="muted" style={{ padding: 16 }}>{empty}</p>;

  function handleAction(d: DocumentRequest, action: string) {
    const url = d.first_file_url;
    if (action === "upload-doc" || action === "edit-doc") return navigate(`/documents/${d.request_id}`);
    if ((action === "view-doc" || action === "open-doc") && url) return void openAnyFile(url);
  }

  return (
    <div className="work-card-list">
      {docs.map((d) => {
        const fileCount = Number(d.file_count || 0);
        const urgency = docUrgency(d);
        return (
          <article className="work-card" key={d.request_id} onClick={() => navigate(`/documents/${d.request_id}`)} style={{ cursor: "pointer" }} tabIndex={0} role="button" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/documents/${d.request_id}`); } }}>
            <div className="work-card-main">
              <div className="work-card-title">{d.requested_item || "Document Request"}</div>
              <div className="work-card-client muted">{d.client_name}</div>
              <div className="work-card-meta">
                <span>Due {fmtDate(d.due_from_client) || "Not set"}</span>
                <span>{d.assigned_to || "Unassigned"}</span>
                <span>{fileCount ? `${fileCount} file(s)` : "No files"}</span>
                {urgency && <span className={`status-pill ${urgency === "overdue" ? "status-red" : "status-amber"}`}>{urgency === "overdue" ? "Overdue" : "Due soon"}</span>}
              </div>
            </div>
            <div className="work-card-side">
              <StatusBadge status={d.status} />
              <div onClick={(e) => e.stopPropagation()}>
                <ActionMenu options={docActionOptions(user?.role, fileCount > 0)} onSelect={(action) => handleAction(d, action)} />
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function invoiceActionOptions(role: string | undefined) {
  const actions = [
    { value: "view-invoice", label: "View Invoice" },
    { value: "view-invoice-pdf", label: "View Invoice PDF" },
    { value: "print-invoice", label: "Download Invoice PDF" },
    { value: "print-invoice-real", label: "Print Invoice PDF" },
    { value: "view-statement", label: "View Statement" },
    { value: "download-statement", label: "Download Statement" },
    { value: "print-statement", label: "Print Statement" },
  ];
  if (role === "admin") {
    actions.push({ value: "record-payment", label: "Record Payment" }, { value: "edit-invoice", label: "Edit Invoice" });
  }
  return actions;
}

function InvoiceRows({ invoices, empty, clientNames }: { invoices: Invoice[]; empty: string; clientNames: Map<string, string> }) {
  const navigate = useNavigate();
  const notify = useNotify();
  const { user } = useAuth();
  if (!invoices.length) return <p className="muted" style={{ padding: 16 }}>{empty}</p>;

  async function handleAction(i: Invoice, action: string) {
    if (action === "view-invoice") return navigate(`/billing/${i.invoice_id}`);
    if (action === "record-payment" || action === "edit-invoice") return navigate(`/billing/${i.invoice_id}`);
    if (action === "view-invoice-pdf") {
      try { await viewFile(`/billing/invoices/${i.invoice_id}/print`); }
      catch (err) { await notify(err instanceof ApiError ? err.message : "Could not open this invoice."); }
      return;
    }
    if (action === "print-invoice") {
      try { await downloadFile(`/billing/invoices/${i.invoice_id}/print`, buildFilename([clientNames.get(i.client_id), "Invoice", i.invoice_id], "pdf")); }
      catch (err) { await notify(err instanceof ApiError ? err.message : "Could not generate this invoice PDF."); }
      return;
    }
    if (action === "print-invoice-real") {
      try { await printFile(`/billing/invoices/${i.invoice_id}/print`); }
      catch (err) { await notify(err instanceof ApiError ? err.message : "Could not print this invoice."); }
      return;
    }
    if (action === "view-statement") {
      try { await viewFile(`/billing/clients/${i.client_id}/statement`); }
      catch (err) { await notify(err instanceof ApiError ? err.message : "Could not generate this statement."); }
      return;
    }
    if (action === "download-statement") {
      try { await downloadFile(`/billing/clients/${i.client_id}/statement`, buildFilename([clientNames.get(i.client_id), "Statement"], "pdf")); }
      catch (err) { await notify(err instanceof ApiError ? err.message : "Could not generate this statement."); }
      return;
    }
    if (action === "print-statement") {
      try { await printFile(`/billing/clients/${i.client_id}/statement`); }
      catch (err) { await notify(err instanceof ApiError ? err.message : "Could not print this statement."); }
    }
  }

  return (
    <div className="work-card-list">
      {invoices.map((i) => (
        <article className="work-card" key={i.invoice_id} onClick={() => navigate(`/billing/${i.invoice_id}`)} style={{ cursor: "pointer" }} tabIndex={0} role="button" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/billing/${i.invoice_id}`); } }}>
          <div className="work-card-main">
            <div className="work-card-title">{i.description || i.invoice_id}</div>
            <div className="work-card-client muted">{clientNames.get(i.client_id) || i.client_id}</div>
            <div className="work-card-meta">
              <span>{i.invoice_id}</span>
              <span>Due {fmtDate(i.due_date) || "Not set"}</span>
              <span>{fmtMoney(i.balance_due || i.total_amount)}</span>
            </div>
          </div>
          <div className="work-card-side">
            <StatusBadge status={i.status} />
            <div onClick={(e) => e.stopPropagation()}>
              <ActionMenu options={invoiceActionOptions(user?.role)} onSelect={(action) => handleAction(i, action)} />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { clientId: activeBusinessId } = useSelectedBusiness();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [docs, setDocs] = useState<DocumentRequest[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [taxRows, setTaxRows] = useState<ClientTaxRow[]>([]);
  const [appointments, setAppointments] = useState<MyAppointment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load(): Promise<void> {
    // A client login can be linked to several businesses now — everything
    // this dashboard shows for that role must follow whichever one is
    // currently selected in the header switcher, not always the login's
    // default business.
    const qs = user?.role === "client" && activeBusinessId ? `?clientId=${encodeURIComponent(activeBusinessId)}` : "";
    return Promise.all([
      api.get<{ tasks: Task[] }>("/tasks"),
      api.get<{ clients: Client[] }>("/clients").catch(() => ({ clients: [] })),
      api.get<{ requests: DocumentRequest[] }>(`/documents/requests${qs}`).catch(() => ({ requests: [] })),
      api.get<{ invoices: Invoice[] }>(`/billing/invoices${qs}`).catch(() => ({ invoices: [] })),
      api.get<{ rows: ClientTaxRow[] }>(`/billing/client-tax-payments${qs}`).catch(() => ({ rows: [] })),
      api.get<{ appointments: MyAppointment[] }>(`/appointments/mine${qs}`).catch(() => ({ appointments: [] })),
    ])
      .then(([t, c, d, i, tx, ap]) => { setTasks(t.tasks); setClients(c.clients); setDocs(d.requests); setInvoices(i.invoices); setTaxRows(tx.rows); setAppointments(ap.appointments); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load dashboard data."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [activeBusinessId]);

  if (error) return <ErrorBanner error={error} />;
  if (loading) return <div className="spinner-wrap">Loading…</div>;

  if (user?.role === "client") return <ClientCommand docs={docs} invoices={invoices} taxRows={taxRows} appointments={appointments} />;
  if (user?.role === "employee") return <EmployeeCommand />;
  // "What happened while I was away" only makes sense for roles that see
  // firm-wide/cross-client activity — clients and employees only ever see
  // their own record, so there's nothing for them to have missed.
  return (
    <>
      <SinceLastLoginBanner />
      {user?.role === "staff"
        ? <StaffCommand tasks={tasks} clients={clients} docs={docs} invoices={invoices} onChanged={load} />
        : <AdminCommand tasks={tasks} clients={clients} docs={docs} invoices={invoices} onChanged={load} />}
    </>
  );
}

interface NextAction { key: string; severity: "critical" | "high" | "normal"; title: string; meta: string; link: string; Icon: LucideIcon; score: number; kind: string }

/**
 * The ranked "do this next" list: the most urgent things across filings, tasks, money and reviews, in one place with one
 * click each — so the day starts from a short ordered list instead of scanning eight panels. Scored by how late/serious
 * each item is, and capped per kind so one type of work (say 24 overdue tasks) can't push everything else off the list.
 */
function buildNextActions(a: {
  tasks: Task[]; invoices: Invoice[]; docs: DocumentRequest[]; flags: AtRiskClient[] | null; reviews: PendingGovFormReview[] | null; clientNames: Map<string, string>;
}): NextAction[] {
  const out: NextAction[] = [];
  const late = (v: string | null | undefined) => { const d = daysUntil(v); return d === null ? 0 : Math.max(0, -d); };
  for (const c of a.flags || []) {
    if (!c.mdSalesTaxUnfiledPeriodEnd) continue;
    const days = late(c.mdSalesTaxUnfiledPeriodEnd);
    out.push({
      key: `f-${c.clientId}`, kind: "filing", severity: "critical", Icon: FileWarning, score: 100 + Math.min(days, 200),
      title: `File MD sales tax — ${c.clientName}`,
      meta: [`Period ending ${fmtDate(c.mdSalesTaxUnfiledPeriodEnd)}`, c.mdSalesTaxUnfiledAmount > 0 ? `${fmtMoney(c.mdSalesTaxUnfiledAmount)} due` : "", days > 0 ? `${days} days late` : ""].filter(Boolean).join(" · "),
      link: mdSalesTaxDeepLink(c.clientId, c.mdSalesTaxUnfiledPeriodEnd),
    });
  }
  for (const r of a.reviews || []) {
    out.push({
      key: `r-${r.filing_id}`, kind: "review", severity: "high", Icon: ClipboardCheck, score: 90,
      title: `Review ${GOV_FORM_LABELS[r.form_type as GovFormType] || r.form_type} — ${r.client_name || r.employee_name || "filing"}`,
      meta: `Waiting for your approval${r.review_requested_by ? ` · requested by ${r.review_requested_by}` : ""}`,
      link: r.client_id ? `/clients/${r.client_id}?tab=${encodeURIComponent("Gov Forms")}` : "/clients",
    });
  }
  for (const t of a.tasks.filter(isOpenTask)) {
    if (isDueToday(t)) {
      out.push({ key: `t-${t.task_id}`, kind: "task", severity: "high", Icon: CalendarClock, score: 85, title: `Due today: ${t.task_name} — ${t.client_name}`, meta: `${t.assigned_to || "Unassigned"} · ${t.status || "Open"}`, link: `/tasks/${t.task_id}` });
    } else if (isOverdue(t)) {
      const days = late(t.agency_due_date);
      out.push({ key: `t-${t.task_id}`, kind: "task", severity: days > 30 ? "critical" : "high", Icon: AlertTriangle, score: 80 + Math.min(days, 100) / 2, title: `${t.task_name} — ${t.client_name}`, meta: `Due ${fmtDate(t.agency_due_date)} · ${days} days overdue · ${t.assigned_to || "Unassigned"}`, link: `/tasks/${t.task_id}` });
    }
  }
  for (const i of a.invoices) {
    if (["paid", "void"].includes(String(i.status || "").toLowerCase())) continue;
    const days = late(i.due_date);
    if (days <= 0) continue;
    out.push({ key: `i-${i.invoice_id}`, kind: "money", severity: days > 60 ? "critical" : "high", Icon: Wallet, score: 70 + Math.min(days, 100) / 2, title: `Collect ${fmtMoney(i.balance_due)} — ${a.clientNames.get(i.client_id) || i.client_id}`, meta: `${i.invoice_id} · ${days} days past due`, link: `/billing/${i.invoice_id}` });
  }
  for (const d of a.docs) {
    if (!["received", "file uploaded", "ready for review"].includes(String(d.status || "").toLowerCase())) continue;
    out.push({ key: `d-${d.request_id}`, kind: "docs", severity: "normal", Icon: FolderInput, score: 60, title: `Review uploaded documents — ${d.client_name}`, meta: `${d.requested_item}`, link: `/documents/${d.request_id}` });
  }
  const perKind = new Map<string, number>();
  return out.sort((x, y) => y.score - x.score).filter((x) => { const n = perKind.get(x.kind) || 0; if (n >= 3) return false; perKind.set(x.kind, n + 1); return true; }).slice(0, 8);
}

const SNOOZE_KEY = "altax_next_snoozed";
function readSnoozed(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SNOOZE_KEY) || "{}") as Record<string, number>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(raw).filter(([, until]) => until > now));
  } catch { return {}; }
}

function NextActionsCard({ actions, loaded, title = "Do this next", note, emptyText = "Nothing urgent right now — you're all caught up. 🎉", goLabel = "Open →", sevLabels = { critical: "Critical", high: "Soon", normal: "Review" }, snoozable = false }: {
  actions: NextAction[]; loaded: boolean; title?: string; note?: string; emptyText?: string; goLabel?: string; sevLabels?: { critical: string; high: string; normal: string }; snoozable?: boolean;
}) {
  const navigate = useNavigate();
  const [snoozed, setSnoozed] = useState<Record<string, number>>(() => (snoozable ? readSnoozed() : {}));
  function snooze(key: string, hours: number) {
    const next = { ...readSnoozed(), [key]: Date.now() + hours * 3600_000 };
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    setSnoozed(next);
  }
  function clearSnoozes() {
    try { localStorage.removeItem(SNOOZE_KEY); } catch { /* private mode */ }
    setSnoozed({});
  }
  const visible = snoozable ? actions.filter((a) => !snoozed[a.key]) : actions;
  const hiddenCount = actions.length - visible.length;
  return (
    <section className="cc-next" aria-label={title}>
      <div className="cc-next-head"><h2>{title}</h2><span>{loaded ? (visible.length ? (note ?? `Top ${visible.length}, most urgent first`) : "") : "…"}</span></div>
      {loaded && visible.length === 0 && <p className="muted" style={{ padding: 20, margin: 0, textAlign: "center" }}>{hiddenCount ? "Everything left is snoozed." : emptyText}</p>}
      {visible.map((a) => (
        <div className="cc-next-wrap" key={a.key}>
          <button type="button" className="cc-next-row" onClick={() => navigate(a.link)}>
            <span className={`act-icon sm act-tone-${a.severity === "critical" ? "red" : a.severity === "high" ? "amber" : "blue"}`}><a.Icon size={15} aria-hidden="true" /></span>
            <span>
              <div className="cc-next-title"><span className={`cc-sev ${a.severity}`}>{sevLabels[a.severity]}</span>{a.title}</div>
              <div className="cc-next-meta">{a.meta}</div>
            </span>
            <span className="cc-next-go">{goLabel}</span>
          </button>
          {snoozable && <button type="button" className="cc-snooze" title="Hide this for 24 hours" aria-label={`Snooze: ${a.title}`} onClick={() => snooze(a.key, 24)}>Snooze</button>}
        </div>
      ))}
      {snoozable && hiddenCount > 0 && (
        <div className="cc-next-foot">{hiddenCount} snoozed for 24 hours · <button type="button" className="link-button" onClick={clearSnoozes}>Show them again</button></div>
      )}
    </section>
  );
}

function greeting(name: string): string {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const first = String(name || "").trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

function AdminCommand({ tasks, clients, docs, invoices, onChanged }: { tasks: Task[]; clients: Client[]; docs: DocumentRequest[]; invoices: Invoice[]; onChanged: () => Promise<void> }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const service = searchParams.get("service") || "all";
  const status = searchParams.get("status") || "all";
  const setService = (v: string) => setSearchParams((p) => { v === "all" ? p.delete("service") : p.set("service", v); return p; });
  const setStatus = (v: string) => setSearchParams((p) => { v === "all" ? p.delete("status") : p.set("status", v); return p; });
  const clientNames = new Map(clients.map((c) => [c.client_id, c.client_name]));
  // Loaded once here and shared with the panels below, so the ranked list, the tiles and the panels always agree.
  const [flags, setFlags] = useState<AtRiskClient[] | null>(null);
  const [reviews, setReviews] = useState<PendingGovFormReview[] | null>(null);
  const [tab, setTab] = useStickyState<"work" | "filings" | "money" | "clients">("cc.tab", "work");
  useEffect(() => {
    api.get<{ clients: AtRiskClient[] }>("/clients/flags").then((r) => setFlags(r.clients)).catch(() => setFlags([]));
    api.get<{ filings: PendingGovFormReview[] }>("/gov-forms/pending-review").then((r) => setReviews(r.filings)).catch(() => setReviews([]));
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onChanged();
      toast("Data refreshed.");
    } catch {
      toast("Could not refresh data.");
    } finally {
      setRefreshing(false);
    }
  }

  const serviceOptions = Array.from(new Set(tasks.map((t) => t.service_line).filter((s): s is string => !!s))).sort();
  const q = search.trim().toLowerCase();
  const filteredTasks = tasks
    .filter((t) => service === "all" || t.service_line === service)
    .filter((t) => status === "all" || String(t.status || "").toLowerCase() === status.toLowerCase())
    .filter((t) => !q || [t.task_name, t.client_name, t.assigned_to, t.service_line].some((v) => String(v || "").toLowerCase().includes(q)));

  const openTasks = filteredTasks.filter(isOpenTask);
  const overdue = openTasks.filter(isOverdue);
  const dueSoon = openTasks.filter(isDueWeek);
  const openDocs = docs.filter((d) => !["closed", "completed", "void", "archived"].includes(String(d.status || "").toLowerCase()));
  const unpaidInvoices = invoices.filter((i) => !["paid", "void"].includes(String(i.status || "").toLowerCase()));
  // "Unpaid Balance" alone conflates a $0-due-in-30-days invoice with one that's
  // genuinely late — the two carry very different urgency. This sub-count is the
  // same daysUntil(due_date) < 0 rule InvoicesListPage's own "Overdue Balance" tile
  // already uses, so the two screens agree on what "overdue" means.
  const overdueInvoices = unpaidInvoices.filter((i) => (daysUntil(i.due_date) ?? 0) < 0);
  // One ranked list instead of showing the same overdue tasks twice (once here, once
  // in a since-removed "Needs Attention" panel): overdue first, then due-soon, then
  // everything else — isOverdue/isDueSoon are mutually exclusive day-ranges, so this
  // never duplicates a task.
  const priorityTasks = [...overdue, ...dueSoon, ...openTasks.filter((t) => !isOverdue(t) && !isDueWeek(t))];
  // A firm with many clients on the same recurring compliance task (e.g. a
  // batch of "Sales Tax Filing" tasks all due the same day) otherwise fills
  // every one of this panel's slots with one task type, burying anything
  // else that's just as urgent. Cap how many of the same task name can
  // occupy the visible slice so the queue stays a mix, not a monoculture —
  // the true count is always still visible via "View all" / the alert strip
  // above, this only shapes what's SHOWN here.
  const MAX_SAME_NAME_IN_QUEUE = 3;
  const priorityQueueVisible: Task[] = [];
  let priorityQueueHiddenByCap = 0;
  {
    const nameCounts = new Map<string, number>();
    for (const t of priorityTasks) {
      if (priorityQueueVisible.length >= 12) { priorityQueueHiddenByCap++; continue; }
      const name = t.task_name || "Task";
      const count = nameCounts.get(name) || 0;
      if (count >= MAX_SAME_NAME_IN_QUEUE) { priorityQueueHiddenByCap++; continue; }
      priorityQueueVisible.push(t);
      nameCounts.set(name, count + 1);
    }
  }
  // Unassigned work has no one whose queue it shows up in — an admin is the
  // only role that can actually see it firm-wide, so surfacing it here is the
  // only way it doesn't just silently sit unclaimed.
  const unassigned = openTasks.filter((t) => !t.assigned_to || !t.assigned_to.trim());
  // UX-016: document requests carry assigned_to too, but this panel only ever
  // covered tasks — an unassigned document request was just as unclaimed and
  // just as invisible, with nowhere to surface it.
  const unassignedDocs = openDocs.filter((d) => !d.assigned_to || !d.assigned_to.trim());
  // UX-003: the only staff workload view before this was a single "Active Staff"
  // metric buried on TasksListPage, with the busiest person as a footnote — an
  // admin had no way to see the whole team's load at a glance. Built from the
  // full unfiltered open-task set (tasks.filter(isOpenTask)), not this page's own
  // search/service/status filters, so it reads as the real firm-wide picture
  // regardless of what the admin happens to be searching for right now.
  const staffLoad = (() => {
    const counts = new Map<string, number>();
    for (const t of tasks.filter(isOpenTask)) {
      const key = t.assigned_to || "Unassigned";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  })();
  const staffLoadMax = staffLoad.length ? staffLoad[0][1] : 0;

  const missingFilings = (flags || []).filter((c) => c.mdSalesTaxUnfiledPeriodEnd);
  const dueToday = openTasks.filter(isDueToday);
  const overdueMoney = overdueInvoices.reduce((sum, i) => sum + Number(i.balance_due || 0), 0);
  const receivedDocs = openDocs.filter((d) => ["received", "file uploaded", "ready for review"].includes(String(d.status || "").toLowerCase()));
  const needsReview = (reviews?.length || 0) + receivedDocs.length;
  const nextActions = buildNextActions({ tasks, invoices, docs, flags, reviews, clientNames });
  const allClear = overdue.length === 0 && missingFilings.length === 0 && overdueInvoices.length === 0 && (reviews?.length || 0) === 0;
  const kpi = (Icon: LucideIcon, tone: string, label: string, value: string, note: string, onClick: () => void) => (
    <button type="button" className="cc-kpi" onClick={onClick}>
      <span className={`cc-kpi-icon act-tone-${tone}`}><Icon size={20} aria-hidden="true" /></span>
      <span><div className="cc-kpi-label">{label}</div><div className="cc-kpi-value">{value}</div><div className="cc-kpi-note">{note}</div></span>
    </button>
  );
  const tabButton = (key: typeof tab, label: string, count: number, hot = false) => (
    <button type="button" role="tab" aria-selected={tab === key} className={`cc-tab${tab === key ? " on" : ""}`} onClick={() => setTab(key)}>
      {label}{count > 0 ? <span className={hot ? "hot" : ""}>{count}</span> : null}
    </button>
  );

  return (
    <div>
      <div className="cc-hero">
        <div>
          <h1 className="cc-hello">{greeting(user?.name || "")}</h1>
          <div className="cc-date">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>
        </div>
        <div className="cc-chips">
          {overdue.length > 0 && <button type="button" className="cc-chip red" onClick={() => navigate("/tasks")}>{overdue.length} overdue tasks</button>}
          {missingFilings.length > 0 && <button type="button" className="cc-chip red" onClick={() => setTab("filings")}>{missingFilings.length} missed sales-tax filings</button>}
          {overdueInvoices.length > 0 && <button type="button" className="cc-chip amber" onClick={() => setTab("money")}>{fmtMoney(overdueMoney)} overdue</button>}
          {(reviews?.length || 0) > 0 && <button type="button" className="cc-chip amber" onClick={() => setTab("filings")}>{reviews!.length} filing reviews</button>}
          {allClear && flags !== null && <span className="cc-chip green">All clear</span>}
          {user?.role === "admin" && <button className="action-button" type="button" onClick={() => navigate("/clients?new=1")}>Add Client</button>}
          <Link to="/suggestions" className="ghost-button">+ Suggest an Improvement</Link>
        </div>
      </div>

      <div className="cc-kpis">
        {kpi(AlertTriangle, overdue.length ? "red" : "green", "Overdue tasks", String(overdue.length), `of ${openTasks.length} open`, () => navigate("/tasks"))}
        {kpi(FileWarning, missingFilings.length ? "red" : "green", "Missed filings", String(missingFilings.length), "MD sales tax, unfiled", () => setTab("filings"))}
        {kpi(Wallet, overdueInvoices.length ? "amber" : "green", "Overdue money", fmtMoney(overdueMoney), `${overdueInvoices.length} invoice${overdueInvoices.length === 1 ? "" : "s"} · ${fmtMoney(unpaidInvoices.reduce((sum, i) => sum + Number(i.balance_due || 0), 0))} unpaid`, () => setTab("money"))}
        {kpi(CalendarClock, dueToday.length ? "amber" : "teal", "Due today", String(dueToday.length), `${dueSoon.length} due this week`, () => setTab("work"))}
        {kpi(ClipboardCheck, needsReview ? "blue" : "green", "Needs your review", String(needsReview), `${reviews?.length || 0} filings · ${receivedDocs.length} uploads`, () => setTab("filings"))}
      </div>

      {user?.role === "admin" && <FirmPulse />}

      <div className="cc-layout">
        <div>
          <NextActionsCard snoozable actions={nextActions} loaded={flags !== null && reviews !== null} />

          <div className="cc-tabs" role="tablist" aria-label="Command Center sections">
            {tabButton("work", "Work", openTasks.length, overdue.length > 0)}
            {tabButton("filings", "Filings & compliance", missingFilings.length + (reviews?.length || 0), missingFilings.length > 0)}
            {tabButton("money", "Money", unpaidInvoices.length, overdueInvoices.length > 0)}
            {tabButton("clients", "Clients at risk", (flags || []).length)}
          </div>

          {tab === "work" && (
            <div className="cc-stack">
              <FilterBar
                search={{ value: search, onChange: setSearch, placeholder: "Task, client, owner…" }}
                selects={[
                  { label: "Service", value: service, options: serviceOptions, onChange: setService },
                  { label: "Status", value: status, options: TASK_STATUSES, onChange: setStatus },
                ]}
                onRefresh={handleRefresh}
                refreshing={refreshing}
                onExportCsv={() => exportCsv("command-center-tasks.csv", [
                  { key: "task_name", label: "Task" }, { key: "client_name", label: "Client" }, { key: "service_line", label: "Service" },
                  { key: "status", label: "Status" }, { key: "assigned_to", label: "Assigned To" }, { key: "agency_due_date", label: "Due Date" },
                ], filteredTasks)}
              />
              <CommandPanel
                title="Priority Work Queue"
                note={`${openTasks.length} open, ranked by urgency${priorityQueueHiddenByCap > 0 ? ` — showing a mix; ${priorityQueueHiddenByCap} more of the same task types below` : ""}`}
                action={<Link to="/tasks" className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>View all →</Link>}
              >
                <TaskRows tasks={priorityQueueVisible} empty="No priority tasks." onChanged={onChanged} />
              </CommandPanel>
              {(unassigned.length > 0 || unassignedDocs.length > 0) && (
                <CommandPanel
                  title="Unassigned Work"
                  note={`${unassigned.length} task${unassigned.length === 1 ? "" : "s"}, ${unassignedDocs.length} document request${unassignedDocs.length === 1 ? "" : "s"} with no one on ${unassigned.length + unassignedDocs.length === 1 ? "it" : "them"}`}
                >
                  <AttentionRows tasks={unassigned.slice(0, 6)} empty="No unassigned tasks." />
                  {unassignedDocs.length > 0 && (
                    <div style={{ borderTop: "1px solid var(--line)" }}>
                      <AttentionDocRows docs={unassignedDocs.slice(0, 6)} empty="No unassigned document requests." />
                    </div>
                  )}
                </CommandPanel>
              )}
              <CommandPanel title="Document Requests" note={`${openDocs.length} open`} action={<Link to="/documents" className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>View all →</Link>}>
                <DocumentRows docs={openDocs.slice(0, 6)} empty="No open document requests." />
              </CommandPanel>
            </div>
          )}

          {tab === "filings" && (
            <div className="cc-stack">
              <ManagementExceptionsPanel />
              <MissingSalesTaxFilingsPanel flags={flags} />
              <PendingFilingReviewsPanel />
              <VerificationDuePanel />
              {missingFilings.length === 0 && (reviews?.length || 0) === 0 && <p className="muted" style={{ textAlign: "center", padding: 16 }}>No missed filings or reviews waiting.</p>}
            </div>
          )}

          {tab === "money" && (
            <div className="cc-stack">
              <CommandPanel title="Billing Watch" note={`${unpaidInvoices.length} unpaid · ${overdueInvoices.length} overdue`} action={<Link to="/billing" className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>View all →</Link>}>
                <InvoiceRows invoices={unpaidInvoices.slice(0, 12)} empty="No unpaid invoices." clientNames={clientNames} />
              </CommandPanel>
            </div>
          )}

          {tab === "clients" && (
            <div className="cc-stack">
              <AtRiskClientsPanel flags={flags} />
              {flags !== null && flags.length === 0 && <p className="muted" style={{ textAlign: "center", padding: 16 }}>No clients flagged at risk.</p>}
            </div>
          )}

          <details className="cc-automation">
            <summary>Automation &amp; agents</summary>
            <div className="command-grid command-grid-even">
              <PayrollAgentCard />
              <TaskRulesAgentCard />
            </div>
          </details>
        </div>

        <aside className="cc-rail" aria-label="Today">
          <TodaysAppointmentsPanel />
          <PickUpWhereYouLeftOff
            onOpen={(clientId, e) => {
              if (e?.page === "accounting") navigate(`/accounting?client=${clientId}&tab=${encodeURIComponent(e.tab || "Sales")}`);
              else navigate(`/clients/${clientId}${e?.tab ? `?tab=${encodeURIComponent(e.tab)}` : ""}`);
            }}
          />
          {staffLoad.length > 0 && (
            <CommandPanel title="Staff Load" note={`${staffLoad.length} people carrying open work`}>
              <div style={{ padding: "4px 16px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                {staffLoad.slice(0, 8).map(([name, count]) => (
                  <button
                    key={name}
                    type="button"
                    className="link-button"
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: 0 }}
                    onClick={() => navigate(`/tasks?staff=${encodeURIComponent(name)}`)}
                  >
                    <span style={{ flex: "0 0 110px", fontSize: 12.5, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                    <span style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--surface)", overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", borderRadius: 3, background: "var(--teal)", width: `${staffLoadMax ? Math.max(6, (count / staffLoadMax) * 100) : 0}%` }} />
                    </span>
                    <span className="muted" style={{ flex: "0 0 auto", fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>{count}</span>
                  </button>
                ))}
              </div>
            </CommandPanel>
          )}
        </aside>
      </div>
    </div>
  );
}

interface PayrollAgentSummary { active: boolean; scheduleCount: number; pendingCount: number; rangeLabel: string | null; autoRunEnabled: boolean }

/** Status widget for the Payroll Agent — an in-app automation (no external
 * AI involved) that drafts upcoming paychecks for employees on a recurring
 * schedule, ahead of time, for staff to review and approve. Every draft it
 * produces is a Pending row in v3_payroll_drafts, never a posted paycheck on
 * its own — this card only ever reports status and links to the review
 * screen where approval actually happens. */
function PayrollAgentCard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<PayrollAgentSummary | null>(null);

  useEffect(() => {
    api.get<PayrollAgentSummary>("/accounting/payroll-agent/summary").then(setSummary).catch(() => {});
  }, []);

  if (!summary) return null;

  return (
    <CommandPanel
      title="Payroll Agent"
      note={summary.active ? `${summary.scheduleCount} recurring schedule${summary.scheduleCount === 1 ? "" : "s"}` : "No recurring schedules set up yet"}
    >
      <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className={`status-pill ${summary.active ? "status-green" : "status-gray"}`}>{summary.active ? "Active" : "Inactive"}</span>
          <span className={`status-pill ${summary.autoRunEnabled ? "status-green" : "status-red"}`} title="The nightly automatic draft run — toggle it from the Payroll Agent page. Manual runs always work regardless of this setting.">
            Auto Payroll: {summary.autoRunEnabled ? "On" : "Off"}
          </span>
          {summary.pendingCount > 0 && summary.rangeLabel && (
            <span className="muted" style={{ fontSize: 12.5 }}>Collecting for {summary.rangeLabel}</span>
          )}
        </div>
        {summary.pendingCount === 0 && summary.active && (
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>No drafts pending right now.</p>
        )}
        <button type="button" className="btn btn-primary" onClick={() => navigate("/payroll-agent")}>
          {summary.pendingCount > 0 ? `View draft payroll (${summary.pendingCount})` : summary.active ? "Open Payroll Agent" : "Set up Auto Payroll"}
        </button>
      </div>
    </CommandPanel>
  );
}

interface TaskRulesAgentSummary { active: boolean; ruleCount: number; pendingCount: number; rangeLabel: string | null; autoRunEnabled: boolean }

/** Status widget for the Task Rules Agent — same in-app, no-external-AI
 * automation shape as the Payroll Agent, but for recurring compliance task
 * batches (sales tax filings, payroll deposits, etc.) instead of paychecks.
 * Every draft it produces is a Pending row in v3_task_batch_drafts, never a
 * real task on its own — this card only reports status and links to the
 * Rules page, where the review panel it's part of actually handles approval. */
function TaskRulesAgentCard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<TaskRulesAgentSummary | null>(null);

  useEffect(() => {
    api.get<TaskRulesAgentSummary>("/rules/agent/summary").then(setSummary).catch(() => {});
  }, []);

  if (!summary) return null;

  return (
    <CommandPanel
      title="Task Rules Agent"
      note={summary.active ? `${summary.ruleCount} active rule${summary.ruleCount === 1 ? "" : "s"}` : "No active rules set up yet"}
    >
      <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className={`status-pill ${summary.active ? "status-green" : "status-gray"}`}>{summary.active ? "Active" : "Inactive"}</span>
          <span className={`status-pill ${summary.autoRunEnabled ? "status-green" : "status-red"}`} title="The nightly automatic draft run — toggle it from the Rules page. Manual runs and Create Batch Tasks always work regardless of this setting.">
            Auto-Draft: {summary.autoRunEnabled ? "On" : "Off"}
          </span>
          {summary.pendingCount > 0 && summary.rangeLabel && (
            <span className="muted" style={{ fontSize: 12.5 }}>Due {summary.rangeLabel}</span>
          )}
        </div>
        {summary.pendingCount === 0 && summary.active && (
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>No draft batches pending right now.</p>
        )}
        <button type="button" className="btn btn-primary" onClick={() => navigate("/rules")}>
          {summary.pendingCount > 0 ? `View draft batches (${summary.pendingCount})` : "Open Rules"}
        </button>
      </div>
    </CommandPanel>
  );
}

function StaffCommand({ tasks, clients, docs, invoices, onChanged }: { tasks: Task[]; clients: Client[]; docs: DocumentRequest[]; invoices: Invoice[]; onChanged: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useStickyState<"work" | "waiting" | "docs" | "money">("cc.staff.tab", "work");
  const openTasks = tasks.filter(isOpenTask);
  const overdue = openTasks.filter(isOverdue);
  const dueToday = openTasks.filter(isDueToday);
  const dueSoon = openTasks.filter(isDueWeek);
  const waiting = openTasks.filter(isWaiting);
  // clients/docs/invoices are already scoped server-side to this staff member's assigned clients.
  const openDocs = docs.filter((d) => !["closed", "completed", "void", "archived"].includes(String(d.status || "").toLowerCase()));
  const receivedDocs = openDocs.filter((d) => ["received", "file uploaded", "ready for review"].includes(String(d.status || "").toLowerCase()));
  const unpaidInvoices = invoices.filter((i) => !["paid", "void"].includes(String(i.status || "").toLowerCase()));
  const overdueInvoices = unpaidInvoices.filter((i) => (daysUntil(i.due_date) ?? 0) < 0);
  const overdueMoney = overdueInvoices.reduce((sum, i) => sum + Number(i.balance_due || 0), 0);
  const clientNames = new Map(clients.map((c) => [c.client_id, c.client_name]));
  const nextActions = buildNextActions({ tasks, invoices, docs, flags: null, reviews: null, clientNames });
  const kpi = (Icon: LucideIcon, tone: string, label: string, value: string, note: string, onClick: () => void) => (
    <button type="button" className="cc-kpi" onClick={onClick}>
      <span className={`cc-kpi-icon act-tone-${tone}`}><Icon size={20} aria-hidden="true" /></span>
      <span><div className="cc-kpi-label">{label}</div><div className="cc-kpi-value">{value}</div><div className="cc-kpi-note">{note}</div></span>
    </button>
  );
  const tabButton = (key: typeof tab, label: string, count: number, hot = false) => (
    <button type="button" role="tab" aria-selected={tab === key} className={`cc-tab${tab === key ? " on" : ""}`} onClick={() => setTab(key)}>
      {label}{count > 0 ? <span className={hot ? "hot" : ""}>{count}</span> : null}
    </button>
  );

  return (
    <div>
      <div className="cc-hero">
        <div>
          <h1 className="cc-hello">{greeting(user?.name || "")}</h1>
          <div className="cc-date">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · Staff Portal</div>
        </div>
        <div className="cc-chips">
          {overdue.length > 0 && <button type="button" className="cc-chip red" onClick={() => navigate("/tasks")}>{overdue.length} overdue</button>}
          {dueToday.length > 0 && <button type="button" className="cc-chip amber" onClick={() => navigate("/tasks")}>{dueToday.length} due today</button>}
          {receivedDocs.length > 0 && <button type="button" className="cc-chip amber" onClick={() => setTab("docs")}>{receivedDocs.length} uploads to review</button>}
          {overdue.length === 0 && dueToday.length === 0 && <span className="cc-chip green">You're on track</span>}
          <Link to="/daily-log" className="ghost-button">Daily Log</Link>
          <Link to="/accounting" className="action-button">Client Workbooks</Link>
        </div>
      </div>

      <div className="cc-kpis">
        {kpi(AlertTriangle, overdue.length ? "red" : "green", "My overdue", String(overdue.length), `of ${openTasks.length} open tasks`, () => navigate("/tasks"))}
        {kpi(CalendarClock, dueToday.length ? "amber" : "teal", "Due today", String(dueToday.length), `${dueSoon.length} due this week`, () => navigate("/tasks"))}
        {kpi(ClipboardCheck, waiting.length ? "blue" : "green", "Waiting on others", String(waiting.length), "client, docs or pending", () => setTab("waiting"))}
        {kpi(FolderInput, receivedDocs.length ? "blue" : "green", "Uploads to review", String(receivedDocs.length), `${openDocs.length} open requests`, () => setTab("docs"))}
        {kpi(Wallet, overdueInvoices.length ? "amber" : "green", "Overdue money", fmtMoney(overdueMoney), `${clients.length} clients assigned to you`, () => setTab("money"))}
      </div>

      <div className="cc-layout">
        <div>
          <NextActionsCard snoozable actions={nextActions} loaded />
          <div className="cc-tabs" role="tablist" aria-label="Staff Command Center sections">
            {tabButton("work", "My work", openTasks.length, overdue.length > 0)}
            {tabButton("waiting", "Waiting", waiting.length)}
            {tabButton("docs", "Documents", openDocs.length)}
            {tabButton("money", "Billing", unpaidInvoices.length, overdueInvoices.length > 0)}
          </div>
          {tab === "work" && (
            <div className="cc-stack">
              <CommandPanel title="My Work Queue" note={`${openTasks.length} assigned open tasks`} action={<Link to="/tasks" className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>View all →</Link>}>
                <TaskRows tasks={openTasks.slice(0, 12)} empty="No assigned open tasks." onChanged={onChanged} />
              </CommandPanel>
            </div>
          )}
          {tab === "waiting" && (
            <div className="cc-stack">
              <CommandPanel title="Waiting / Pending" note={`${waiting.length} tasks`}>
                <TaskRows tasks={waiting.slice(0, 12)} empty="Nothing is waiting on anyone." showStaleness onChanged={onChanged} />
              </CommandPanel>
            </div>
          )}
          {tab === "docs" && (
            <div className="cc-stack">
              <CommandPanel title="Document Requests" note={`${openDocs.length} open`} action={<Link to="/documents" className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>View all →</Link>}>
                <DocumentRows docs={openDocs.slice(0, 10)} empty="No open document requests." />
              </CommandPanel>
            </div>
          )}
          {tab === "money" && (
            <div className="cc-stack">
              <CommandPanel title="Billing Watch" note={`${unpaidInvoices.length} unpaid · ${overdueInvoices.length} overdue`} action={<Link to="/billing" className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>View all →</Link>}>
                <InvoiceRows invoices={unpaidInvoices.slice(0, 12)} empty="No unpaid invoices." clientNames={clientNames} />
              </CommandPanel>
            </div>
          )}
        </div>
        <aside className="cc-rail" aria-label="Today">
          <TodaysAppointmentsPanel />
          <PickUpWhereYouLeftOff
            onOpen={(clientId, e) => {
              if (e?.page === "accounting") navigate(`/accounting?client=${clientId}&tab=${encodeURIComponent(e.tab || "Sales")}`);
              else navigate(`/clients/${clientId}${e?.tab ? `?tab=${encodeURIComponent(e.tab)}` : ""}`);
            }}
          />
        </aside>
      </div>
    </div>
  );
}

interface MyServiceTask {
  taskId: string;
  serviceLine: string | null;
  taskName: string | null;
  period: string | null;
  agencyDueDate: string | null;
  completedAt: string | null;
  label: string;
  tone: "open" | "waiting" | "review" | "done";
}

/** UX-010 — maps the backend's canonical English label to a translation key; see clientFriendlyStatus() in tasks.routes.ts. */
const SERVICE_STATUS_KEY: Record<string, string> = {
  "Completed": "task.status.completed",
  "Waiting on You": "task.status.waitingOnYou",
  "Submitted / Under Review": "task.status.submittedReview",
  "Not Started Yet": "task.status.notStarted",
  "In Progress": "task.status.inProgress",
};
const SERVICE_TONE_CLASS: Record<MyServiceTask["tone"], string> = {
  open: "status-blue", waiting: "status-amber", review: "status-teal", done: "status-green",
};

/** Read-only — no click-through (client role has no access to /tasks/:id) and no assigned-staff name, unlike the staff-facing TaskRows. */
function MyServicesRows({ tasks, empty }: { tasks: MyServiceTask[]; empty: string }) {
  const { t } = useLanguage();
  if (!tasks.length) return <p className="muted" style={{ padding: 16 }}>{empty}</p>;
  return (
    <div className="work-card-list">
      {tasks.map((task) => (
        <article className="work-card" key={task.taskId}>
          <div className="work-card-main">
            <div className="work-card-title">{task.taskName || task.serviceLine || "Service"}</div>
            <div className="work-card-meta">
              {task.serviceLine && <span>{task.serviceLine}</span>}
              {task.period && <span>{task.period}</span>}
              {task.completedAt ? (
                <span>{t("dashboard.client.completedLabel")} {fmtDate(task.completedAt)}</span>
              ) : (
                <span>{t("dashboard.client.dueLabel")} {fmtDate(task.agencyDueDate) || "—"}</span>
              )}
            </div>
          </div>
          <div className="work-card-side">
            <span className={`status-pill ${SERVICE_TONE_CLASS[task.tone]}`}>{t(SERVICE_STATUS_KEY[task.label] || "task.status.inProgress")}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function ClientCommand({ docs, invoices, taxRows, appointments }: { docs: DocumentRequest[]; invoices: Invoice[]; taxRows: ClientTaxRow[]; appointments: MyAppointment[] }) {
  const { user } = useAuth();
  const { clientId: activeBusinessId, clientName: activeBusinessName } = useSelectedBusiness();
  const navigate = useNavigate();
  const { t, dir, lang } = useLanguage();
  const [notices, setNotices] = useState<AccountNotice[]>([]);
  const [services, setServices] = useState<{ active: MyServiceTask[]; recentlyCompleted: MyServiceTask[] }>({ active: [], recentlyCompleted: [] });
  const [snap, setSnap] = useState<{ totalIncome: number; totalExpenses: number; netIncome: number; pendingSalesCount: number; pendingPurchasesCount: number } | null>(null);
  const [salesTax, setSalesTax] = useState<{ available: boolean; periodEnd?: string; dueDate?: string; totalEstimated?: number } | null>(null);
  const [salesStatus, setSalesStatus] = useState<{ lastSaleDate: string | null; pendingCount: number } | null>(null);
  useEffect(() => {
    const qs = activeBusinessId ? `?clientId=${encodeURIComponent(activeBusinessId)}` : "";
    api.get<{ notices: AccountNotice[] }>(`/clients/notices/mine${qs}`).then((res) => setNotices(res.notices)).catch(() => {});
    api.get<{ active: MyServiceTask[]; recentlyCompleted: MyServiceTask[] }>(`/tasks/mine${qs}`).then(setServices).catch(() => {});
    // Owner's-eye numbers from My Books. A client without books access (or a failed call) simply hides those tiles.
    const id = activeBusinessId || user?.clientId;
    setSnap(null); setSalesTax(null); setSalesStatus(null);
    if (id) {
      const d = new Date();
      const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
      const from = ymd(new Date(d.getFullYear(), d.getMonth(), 1));
      api.get<NonNullable<typeof snap>>(`/accounting/client-books/pl-preview?clientId=${encodeURIComponent(id)}&from=${from}&to=${ymd(d)}`).then(setSnap).catch(() => {});
      api.get<NonNullable<typeof salesTax>>(`/accounting/client-books/sales-tax-liability?clientId=${encodeURIComponent(id)}`).then(setSalesTax).catch(() => {});
      api.get<NonNullable<typeof salesStatus>>(`/accounting/client-books/sales-status?clientId=${encodeURIComponent(id)}`).then(setSalesStatus).catch(() => {});
    }
  }, [activeBusinessId]);
  const openDocs = docs.filter((d) => !["closed", "completed"].includes(String(d.status || "").toLowerCase()));
  const openInvoices = invoices.filter((i) => !["paid", "void"].includes(String(i.status || "").toLowerCase()));
  const unpaidTaxRows = taxRows.filter((r) => !r.paid_date);
  const balanceDue = openInvoices.reduce((sum, i) => sum + Number(i.balance_due || 0), 0);
  const taxDue = unpaidTaxRows.reduce((sum, r) => sum + Number(r.payment_amount || 0), 0);
  const activeId = activeBusinessId || user?.clientId;
  const clientNames = new Map(activeId ? [[activeId, activeBusinessName || user?.clientName || "My Account"]] as [string, string][] : []);
  const ui = (key: string, vars: Record<string, string> = {}) => Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), t(key));
  const late = (v: string | null | undefined) => { const d = daysUntil(v); return d === null ? 0 : Math.max(0, -d); };
  const UPLOADED = ["received", "file uploaded", "ready for review"];

  // "What we need from you" — everything blocked on the client, most urgent first.
  const needs: NextAction[] = [];
  for (const n of notices) {
    if (n.color === "green") continue;
    needs.push({
      key: `n-${n.flagId || n.labelEn}`, kind: "notice", severity: n.color === "red" ? "critical" : "high", Icon: FileWarning, score: n.color === "red" ? 100 : 80,
      title: lang === "ar" ? n.labelAr : n.labelEn,
      meta: [n.amount !== null ? fmtMoney(n.amount) : "", n.dueDate ? `${t("dashboard.client.dueLabel")} ${fmtDate(n.dueDate)}` : "", n.details || n.note || ""].filter(Boolean).join(" · "),
      link: "/communications",
    });
  }
  for (const d of openDocs) {
    if (UPLOADED.includes(String(d.status || "").toLowerCase())) continue;
    const days = late(d.due_from_client);
    needs.push({
      key: `d-${d.request_id}`, kind: "docs", severity: days > 0 ? "high" : "normal", Icon: FolderInput, score: 60 + Math.min(days, 40),
      title: ui("dash.uploadDoc", { item: d.requested_item }),
      meta: d.due_from_client ? `${t("dashboard.client.dueLabel")} ${fmtDate(d.due_from_client)}${days > 0 ? ` · ${days} ${t("dash.pastDue")}` : ""}` : "",
      link: `/documents/${d.request_id}`,
    });
  }
  for (const i of openInvoices) {
    const days = late(i.due_date);
    needs.push({
      key: `i-${i.invoice_id}`, kind: "money", severity: days > 30 ? "critical" : days > 0 ? "high" : "normal", Icon: Wallet, score: 65 + Math.min(days, 60) / 2,
      title: ui("dash.payInvoice", { id: i.invoice_id, amount: fmtMoney(i.balance_due) }),
      meta: i.due_date ? `${t("dashboard.client.dueLabel")} ${fmtDate(i.due_date)}${days > 0 ? ` · ${days} ${t("dash.pastDue")}` : ""}` : "",
      link: `/billing/${i.invoice_id}`,
    });
  }
  for (const r of unpaidTaxRows) {
    const days = late(r.agency_due_date);
    needs.push({
      key: `x-${r.task_id}`, kind: "tax", severity: days > 0 ? "high" : "normal", Icon: CalendarClock, score: 70 + Math.min(days, 60) / 2,
      title: `${r.task_name} — ${ui("dash.taxPaymentDue", { amount: fmtMoney(r.payment_amount || 0) })}`,
      meta: r.agency_due_date ? `${t("dashboard.client.dueLabel")} ${fmtDate(r.agency_due_date)}${days > 0 ? ` · ${days} ${t("dash.pastDue")}` : ""}` : "",
      link: "/billing",
    });
  }
  for (const sv of services.active.filter((x) => x.label === "Waiting on You")) {
    needs.push({
      key: `s-${sv.taskId}`, kind: "service", severity: "high", Icon: ClipboardCheck, score: 75,
      title: ui("dash.serviceWaiting", { service: sv.taskName || sv.serviceLine || "Service" }),
      meta: [sv.period, sv.agencyDueDate ? `${t("dashboard.client.dueLabel")} ${fmtDate(sv.agencyDueDate)}` : ""].filter(Boolean).join(" · "),
      link: "/communications",
    });
  }
  needs.sort((x, y) => y.score - x.score);
  const topNeeds = needs.slice(0, 8);
  const sevLabels = { critical: t("dash.sev.critical"), high: t("dash.sev.soon"), normal: t("dash.sev.review") };
  const inProgress = services.active.length;
  const kpi = (Icon: LucideIcon, tone: string, label: string, value: React.ReactNode, note: React.ReactNode, onClick: () => void) => (
    <button type="button" className="cc-kpi" onClick={onClick}>
      <span className={`cc-kpi-icon act-tone-${tone}`}><Icon size={20} aria-hidden="true" /></span>
      <span><div className="cc-kpi-label">{label}</div><div className="cc-kpi-value">{value}</div><div className="cc-kpi-note">{note}</div></span>
    </button>
  );
  const owed = balanceDue + taxDue;
  const todayYmd = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const loggedToday = salesStatus?.lastSaleDate === todayYmd;
  const daysSinceSale = salesStatus?.lastSaleDate ? Math.round((new Date(`${todayYmd}T00:00:00`).getTime() - new Date(`${salesStatus.lastSaleDate}T00:00:00`).getTime()) / 86400000) : null;
  const countdown = (due: string | null | undefined): { text: string; tone: "red" | "amber" | "green" | "blue" } | null => {
    const dd = daysUntil(due);
    if (dd === null) return null;
    if (dd < 0) return { text: ui("dash.overdueDays", { n: String(-dd) }), tone: "red" };
    if (dd === 0) return { text: t("dash.dueToday"), tone: "red" };
    return { text: ui("dash.daysLeft", { n: String(dd) }), tone: dd <= 7 ? "amber" : dd <= 30 ? "blue" : "green" };
  };
  // Everything with a date attached — services in progress and tax payments still owed — soonest first.
  const deadlines = [
    ...services.active.filter((x) => x.agencyDueDate).map((x) => ({ key: `s-${x.taskId}`, title: x.taskName || x.serviceLine || "Service", sub: [x.serviceLine, x.period].filter(Boolean).join(" · "), due: x.agencyDueDate })),
    ...unpaidTaxRows.filter((r) => r.agency_due_date && !services.active.some((x) => x.taskId === r.task_id)).map((r) => ({ key: `x-${r.task_id}`, title: r.task_name, sub: ui("dash.taxPaymentDue", { amount: fmtMoney(r.payment_amount || 0) }), due: r.agency_due_date })),
  ].sort((x, y) => String(x.due).localeCompare(String(y.due))).slice(0, 6);
  const showMoney = snap !== null;
  const monthName = new Date().toLocaleDateString(lang === "ar" ? "ar" : undefined, { month: "long" });
  const quick = (Icon: LucideIcon, label: string, sub: string, to: string, tone = "teal") => (
    <Link to={to} className="cc-quick">
      <span className={`cc-kpi-icon act-tone-${tone}`}><Icon size={18} aria-hidden="true" /></span>
      <span><b>{label}</b><small>{sub}</small></span>
    </Link>
  );

  return (
    <div dir={dir}>
      <div className="cc-hero">
        <div>
          <div className="cc-date" style={{ marginBottom: 2 }}>{t("dash.welcomeBack")}</div>
          <h1 className="cc-hello">{activeBusinessName || user?.clientName || t("dashboard.client.myAccount")}</h1>
          <div className="cc-date">{new Date().toLocaleDateString(lang === "ar" ? "ar" : undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>
        </div>
        <div className="cc-chips">
          {needs.length === 0 ? <span className="cc-chip green">{t("dash.allSet")}</span> : <span className="cc-chip amber">{ui("dash.itemsNeedYou", { n: String(needs.length) })}</span>}
        </div>
      </div>

      {/* The one habit that keeps the books right: log today's sales. */}
      <div className={`cc-sales-nudge${loggedToday ? " done" : ""}`}>
        <div>
          <b>{loggedToday ? t("dash.sales.doneToday") : t("dash.sales.logPrompt")}</b>
          <span>
            {salesStatus === null ? "" : salesStatus.lastSaleDate
              ? ui("dash.sales.last", { date: fmtDate(salesStatus.lastSaleDate), n: daysSinceSale && daysSinceSale > 0 ? ui("dash.sales.daysAgo", { n: String(daysSinceSale) }) : "" })
              : t("dash.sales.none")}
            {salesStatus && salesStatus.pendingCount > 0 ? ` · ${ui("dash.sales.pending", { n: String(salesStatus.pendingCount) })}` : ""}
          </span>
        </div>
        <Link to="/my-books" className="action-button">{loggedToday ? t("dash.sales.openBooks") : t("dash.quick.logSales")}</Link>
      </div>

      <div className="cc-kpis">
        {showMoney && kpi(TrendingUp, snap!.netIncome < 0 ? "red" : "green", ui("dash.kpi.netMonth", { month: monthName }), <Num>{fmtMoney(snap!.netIncome)}</Num>, <><Num>{fmtMoney(snap!.totalIncome)}</Num> {t("books.kpi.income")} · <Num>{fmtMoney(snap!.totalExpenses)}</Num> {t("books.kpi.expenses")}</>, () => navigate("/my-books"))}
        {salesTax?.available
          ? kpi(Landmark, "blue", t("dash.kpi.salesTaxOwed"), <Num>{fmtMoney(salesTax.totalEstimated || 0)}</Num>, salesTax.dueDate ? <>{t("dashboard.client.dueLabel")} <Num>{fmtDate(salesTax.dueDate)}</Num>{countdown(salesTax.dueDate) ? ` · ${countdown(salesTax.dueDate)!.text}` : ""}</> : t("books.kpi.estimate"), () => navigate("/my-books"))
          : null}
        {kpi(Wallet, owed > 0 ? "amber" : "green", t("dash.kpi.owed"), <Num>{fmtMoney(owed)}</Num>, <><Num>{openInvoices.length}</Num> {t("dashboard.client.openInvoicesLower")} · <Num>{unpaidTaxRows.length}</Num> {t("dashboard.client.taxDueLower")}</>, () => navigate("/billing"))}
        {kpi(FolderInput, openDocs.length ? "amber" : "green", t("dash.kpi.paperwork"), <Num>{openDocs.filter((d) => !UPLOADED.includes(String(d.status || "").toLowerCase())).length}</Num>, <><Num>{openDocs.length}</Num> {t("dashboard.visible")}</>, () => navigate("/documents"))}
        {!showMoney && kpi(ClipboardCheck, "blue", t("dash.kpi.inProgress"), <Num>{inProgress}</Num>, t("dashboard.client.myServicesNote"), () => document.getElementById("cc-client-services")?.scrollIntoView({ behavior: "smooth" }))}
      </div>

      <div className="cc-layout">
        <div>
          <NextActionsCard
            actions={topNeeds} loaded
            title={t("dash.needFromYou")} note={t("dash.needFromYouNote")} emptyText={t("dash.allSet")}
            goLabel={`${t("dash.open")} ${dir === "rtl" ? "←" : "→"}`} sevLabels={sevLabels}
          />

          {deadlines.length > 0 && (
            <div className="command-panel" style={{ marginBottom: 14 }}>
              <div className="command-panel-header">
                <div>
                  <h2 className="command-panel-title">{t("dash.coming")}</h2>
                  <div className="command-panel-note">{t("dash.comingNote")}</div>
                </div>
              </div>
              <div className="cc-deadlines">
                {deadlines.map((dl) => {
                  const c = countdown(dl.due);
                  return (
                    <div className="cc-deadline" key={dl.key}>
                      <div className="cc-deadline-date"><b><Num>{fmtDate(dl.due)}</Num></b></div>
                      <div className="cc-deadline-main"><b>{dl.title}</b>{dl.sub ? <small>{dl.sub}</small> : null}</div>
                      {c && <span className={`status-pill status-${c.tone}`}>{c.text}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div id="cc-client-services" className="command-panel" style={{ marginBottom: 14 }}>
            <div className="command-panel-header">
              <div>
                <h2 className="command-panel-title">{t("dashboard.client.myServices")}</h2>
                <div className="command-panel-note">{t("dashboard.client.myServicesNote")}</div>
              </div>
            </div>
            <MyServicesRows tasks={services.active} empty={t("dashboard.client.noServices")} />
            {services.recentlyCompleted.length > 0 && (
              <>
                <div className="command-panel-header" style={{ borderTop: "1px solid var(--line)" }}>
                  <div><h2 className="command-panel-title" style={{ fontSize: 13 }}>{t("dashboard.client.recentlyCompleted")}</h2></div>
                </div>
                <MyServicesRows tasks={services.recentlyCompleted} empty="" />
              </>
            )}
          </div>

          <div className="command-grid-even" style={{ display: "grid", gap: 14 }}>
            <CommandPanel title={t("dashboard.client.documentRequests")} note={<><Num>{openDocs.length}</Num> {t("dashboard.visible")}</>}>
              <DocumentRows docs={openDocs.slice(0, 10)} empty={t("dashboard.client.noDocs")} />
            </CommandPanel>
            <CommandPanel title={t("dashboard.client.openInvoices")} note={<><Num>{openInvoices.length}</Num> {t("dashboard.visible")}</>}>
              <InvoiceRows invoices={openInvoices.slice(0, 6)} empty={t("dashboard.client.noInvoices")} clientNames={clientNames} />
            </CommandPanel>
          </div>
        </div>

        <aside className="cc-rail" aria-label={t("dash.quick.title")}>
          <div className="command-panel">
            <div className="command-panel-header"><div><h2 className="command-panel-title">{t("dash.quick.title")}</h2></div></div>
            <div className="cc-quick-grid">
              {quick(ClipboardCheck, t("dash.quick.logSales"), t("dash.quick.logSalesSub"), "/my-books", "green")}
              {quick(FolderInput, t("dash.quick.upload"), t("dash.quick.uploadSub"), "/documents", "amber")}
              {quick(MessageSquare, t("dash.quick.message"), t("dash.quick.messageSub"), "/communications", "blue")}
              {quick(Wallet, t("dash.quick.invoices"), t("dash.quick.invoicesSub"), "/billing", "teal")}
              {quick(Building2, t("nav.myBusiness"), t("dash.quick.profileSub"), "/my-business", "teal")}
            </div>
          </div>
          <div className="command-panel">
            <div className="command-panel-header">
              <div>
                <h2 className="command-panel-title">{t("dashboard.client.upcomingAppointments")}</h2>
                <div className="command-panel-note"><Num>{appointments.length}</Num> {t("dashboard.visible")}</div>
              </div>
            </div>
            {appointments.length === 0 ? (
              <p className="muted" style={{ padding: 16, margin: 0 }}>{t("dash.kpi.none")}</p>
            ) : (
              <div className="work-card-list">
                {appointments.slice(0, 3).map((a) => (
                  <article className="work-card" key={a.appointmentId}>
                    <div className="work-card-main">
                      <div className="work-card-title">{a.appointmentTypeName || a.title}</div>
                      <div className="work-card-meta">
                        <span><Num>{fmtApptWhen(a.startTime)} ET</Num></span>
                        {a.location && <span>{a.location}</span>}
                      </div>
                    </div>
                    <div className="work-card-side">
                      {a.manageUrl && (
                        <a href={a.manageUrl} target="_blank" rel="noopener noreferrer" className="ghost-button btn-sm">
                          {t("dashboard.client.rescheduleOrCancel")}
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

interface MyPaycheck {
  paycheck_id: string;
  pay_date: string | null;
  client_name: string | null;
  gross_wages: number | string;
  employee_taxes: number | string;
  net_pay: number | string;
  employer_taxes: number | string;
  total_cost: number | string;
  pay_period_start: string | null;
  pay_period_end: string | null;
  check_number: string | null;
  status: string;
}

/** Mirrors legacy's Employee Latest Paystub card + paystub history — previously a "coming soon" placeholder with no data source at all. */
function EmployeeCommand() {
  const { user } = useAuth();
  const { t, dir } = useLanguage();
  const notify = useNotify();
  const [paychecks, setPaychecks] = useState<MyPaycheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [forms, setForms] = useState<GovFormFiling[] | null>(null);

  useEffect(() => {
    api.get<{ filings: GovFormFiling[] }>("/gov-forms/my").then((res) => setForms(res.filings)).catch(() => setForms([]));
    api.get<{ paychecks: MyPaycheck[] }>("/accounting/paychecks/mine")
      .then((res) => setPaychecks(res.paychecks))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your paystubs."));
  }, []);

  const latest = paychecks?.[0];

  async function handleView(p: MyPaycheck) {
    setBusy(`view:${p.paycheck_id}`);
    try {
      await viewFile(`/accounting/paychecks/${p.paycheck_id}/print`);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not open this paystub.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDownload(p: MyPaycheck) {
    setBusy(`download:${p.paycheck_id}`);
    try {
      await downloadFile(`/accounting/paychecks/${p.paycheck_id}/print`, buildFilename([p.client_name, "Paystub", p.pay_date ? fmtDate(p.pay_date) : null], "pdf"));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not download this paystub.");
    } finally {
      setBusy(null);
    }
  }

  async function handlePrint(p: MyPaycheck) {
    setBusy(`print:${p.paycheck_id}`);
    try {
      await printFile(`/accounting/paychecks/${p.paycheck_id}/print`);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not print this paystub.");
    } finally {
      setBusy(null);
    }
  }

  const year = String(new Date().getFullYear());
  const thisYear = (paychecks || []).filter((p) => (p.pay_date || "").slice(0, 4) === year);
  const sum = (rows: MyPaycheck[], k: "gross_wages" | "net_pay") => rows.reduce((acc, p) => acc + Number(p[k] || 0), 0);
  const waitingForms = (forms || []).filter((f) => f.status === "Draft");
  const needs: NextAction[] = waitingForms.map((f) => ({
    key: `form-${f.filing_id}`, kind: "form", severity: "high", Icon: FileWarning, score: 90,
    title: `${t("dash.employee.formWaiting")} — ${GOV_FORM_LABELS[f.form_type] || f.form_type}`,
    meta: t("dash.employee.openForms"), link: "/my-tax-forms",
  }));
  const kpi = (Icon: LucideIcon, tone: string, label: string, value: React.ReactNode, note: React.ReactNode, onClick?: () => void) => (
    <button type="button" className="cc-kpi" onClick={onClick} disabled={!onClick} style={onClick ? undefined : { cursor: "default" }}>
      <span className={`cc-kpi-icon act-tone-${tone}`}><Icon size={20} aria-hidden="true" /></span>
      <span><div className="cc-kpi-label">{label}</div><div className="cc-kpi-value">{value}</div><div className="cc-kpi-note">{note}</div></span>
    </button>
  );

  return (
    <div dir={dir}>
      <div className="cc-hero">
        <div>
          <div className="cc-date" style={{ marginBottom: 2 }}>{t("dashboard.employee.eyebrow")}</div>
          <h1 className="cc-hello">{t("dash.employee.hello")}, {user?.employeeName || user?.name || t("dashboard.employee.myPay")}</h1>
          <div className="cc-date">{user?.clientName || ""}{user?.employeeId ? <> · <Num>{user.employeeId}</Num></> : null}</div>
        </div>
        <div className="cc-chips">
          {waitingForms.length > 0 && <Link to="/my-tax-forms" className="cc-chip amber">{t("dash.employee.formWaiting")}</Link>}
          <Link to="/my-tax-forms" className="action-button">{t("dash.employee.openForms")}</Link>
          <Link to="/communications" className="ghost-button">{t("dashboard.messages")}</Link>
        </div>
      </div>

      <div className="cc-kpis">
        {kpi(Wallet, "green", t("dash.employee.latestNet"), latest ? <Num>{fmtMoney(latest.net_pay)}</Num> : "—", latest ? <Num>{fmtDate(latest.pay_date) || ""}</Num> : t("dashboard.employee.noPaystubs"))}
        {kpi(CalendarClock, "teal", t("dash.employee.ytdGross"), <Num>{fmtMoney(sum(thisYear, "gross_wages"))}</Num>, <Num>{year}</Num>)}
        {kpi(ClipboardCheck, "blue", t("dash.employee.ytdNet"), <Num>{fmtMoney(sum(thisYear, "net_pay"))}</Num>, <Num>{year}</Num>)}
        {kpi(FolderInput, "blue", t("dash.employee.stubsCount"), <Num>{paychecks?.length ?? 0}</Num>, t("dashboard.employee.onFile"))}
      </div>

      {needs.length > 0 && (
        <NextActionsCard
          actions={needs} loaded title={t("dash.needFromYou")} note={t("dash.needFromYouNote")}
          goLabel={`${t("dash.open")} ${dir === "rtl" ? "←" : "→"}`}
          sevLabels={{ critical: t("dash.sev.critical"), high: t("dash.sev.soon"), normal: t("dash.sev.review") }}
        />
      )}

      {latest && (
        <div className="command-panel" style={{ marginBottom: 14 }}>
          <div className="command-panel-header">
            <div>
              <h2 className="command-panel-title">{t("dashboard.employee.latestPaystub")}</h2>
              <div className="command-panel-note"><Num>{fmtDate(latest.pay_date) || "No date"}{latest.check_number ? ` · ${t("dashboard.employee.checkNum")}${latest.check_number}` : ""}</Num></div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="btn btn-sm" disabled={busy === `view:${latest.paycheck_id}`} onClick={() => handleView(latest)}>{t("dashboard.employee.view")}</button>
              <button type="button" className="btn btn-sm" disabled={busy === `download:${latest.paycheck_id}`} onClick={() => handleDownload(latest)}>{t("dashboard.employee.download")}</button>
            </div>
          </div>
          <MiniKpis items={[
            [t("dashboard.employee.gross"), fmtMoney(latest.gross_wages)],
            [t("dashboard.employee.employeeTaxes"), fmtMoney(latest.employee_taxes)],
            [t("dashboard.employee.netPay"), fmtMoney(latest.net_pay)],
            [t("dashboard.employee.employerCost"), fmtMoney(latest.total_cost)],
          ]} />
        </div>
      )}

      <div className="command-panel">
        <div className="command-panel-header">
          <div>
            <h2 className="command-panel-title">{t("dashboard.employee.paystubs")}</h2>
            <div className="command-panel-note"><Num>{paychecks?.length ?? 0}</Num> {t("dashboard.employee.onFile")}</div>
          </div>
        </div>
        {error && <ErrorBanner error={error} style={{ margin: 16 }} />}
        {!paychecks && !error && <p className="muted" style={{ padding: 16 }}>{t("common.loading")}</p>}
        {paychecks && paychecks.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>{t("dashboard.employee.noPaystubs")}</p>}
        {paychecks && paychecks.length > 0 && (
          <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">{t("dashboard.employee.payDate")}</th><th scope="col">{t("dashboard.employee.employer")}</th><th scope="col">{t("dashboard.employee.period")}</th><th scope="col">{t("dashboard.employee.gross")}</th><th scope="col">{t("dashboard.employee.taxes")}</th><th scope="col">{t("dashboard.employee.netPay")}</th><th scope="col">{t("dashboard.employee.status")}</th><th scope="col"></th></tr></thead>
            <tbody>
              {paychecks.map((p) => (
                <tr key={p.paycheck_id}>
                  <td><Num>{fmtDate(p.pay_date)}</Num></td>
                  <td className="muted">{p.client_name || "—"}</td>
                  <td className="muted"><Num>{p.pay_period_start && p.pay_period_end ? `${fmtDate(p.pay_period_start)} – ${fmtDate(p.pay_period_end)}` : "—"}</Num></td>
                  <td><Num>{fmtMoney(p.gross_wages)}</Num></td>
                  <td className="muted"><Num>{fmtMoney(p.employee_taxes)}</Num></td>
                  <td><Num>{fmtMoney(p.net_pay)}</Num></td>
                  <td><StatusBadge status={p.status} /></td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button type="button" className="btn btn-sm" disabled={busy === `view:${p.paycheck_id}`} onClick={() => handleView(p)}>
                      {busy === `view:${p.paycheck_id}` ? t("dashboard.employee.opening") : t("dashboard.employee.view")}
                    </button>
                    <button type="button" className="btn btn-sm" disabled={busy === `download:${p.paycheck_id}`} onClick={() => handleDownload(p)}>
                      {busy === `download:${p.paycheck_id}` ? t("dashboard.employee.downloading") : t("dashboard.employee.download")}
                    </button>
                    <button type="button" className="btn btn-sm" disabled={busy === `print:${p.paycheck_id}`} onClick={() => handlePrint(p)}>
                      {busy === `print:${p.paycheck_id}` ? t("dashboard.employee.printing") : t("dashboard.employee.print")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
