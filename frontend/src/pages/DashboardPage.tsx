import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, downloadFile, viewFile, openAnyFile, buildFilename } from "../api/client";
import type { Client, Task } from "../api/types";
import type { DocumentRequest, Invoice } from "../api/types2";
import { useAuth } from "../auth/AuthContext";
import { StatusBadge } from "../components/StatusBadge";
import { ActionMenu } from "../components/ActionMenu";
import { FilterBar, exportCsv } from "../components/FilterBar";
import { useToast } from "../components/Toast";
import { usePrompt, useNotify } from "../components/ConfirmProvider";
import { fmtDateOnly as fmtDate, daysUntil } from "../utils/date";
import { TASK_STATUSES, isOpenTask, isOverdue, isDueWeek, isWaiting, DueLabel, TaskFileCell, taskActionOptions, TASK_QUICK_ACTIONS, TASK_QUICK_ACTION_ICON } from "../components/TaskCells";
import { RequestDocumentModal } from "../components/RequestDocumentModal";
import { useLanguage, Num } from "../context/LanguageContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { SinceLastLoginBanner } from "../components/SinceLastLoginBanner";
import { useSelectedClient } from "../context/SelectedClientContext";
import { GOV_FORM_LABELS } from "../api/govForms";
import type { GovFormType } from "../api/govForms";

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

function CommandPanel({ title, note, action, children }: { title: React.ReactNode; note: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="command-panel">
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
                {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
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
}

/**
 * UX-001 (hard audit 2026-08-13) — flags were previously visible only by
 * opening one client's own panel at a time; nothing showed which clients
 * across the whole firm had actually crossed into risk. Backed by
 * GET /clients/flags, a set of firm-wide GROUP BY queries (not one call per
 * client), so this loads in constant time regardless of client count.
 */
function AtRiskClientsPanel() {
  const navigate = useNavigate();
  const { setSelectedClient } = useSelectedClient();
  const [clients, setClients] = useState<AtRiskClient[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<{ clients: AtRiskClient[] }>("/clients/flags").then((res) => { if (!cancelled) setClients(res.clients); }).catch(() => { if (!cancelled) setClients([]); });
    return () => { cancelled = true; };
  }, []);

  if (!clients || clients.length === 0) return null;

  const go = (c: AtRiskClient) => { setSelectedClient(c.clientId, c.clientName); navigate(`/clients/${c.clientId}`); };

  return (
    <CommandPanel title="At-Risk Clients" note={`${clients.length} client${clients.length === 1 ? "" : "s"} with an open balance, agency obligation, or flag past due`}>
      <div className="attention-list">
        {clients.slice(0, 8).map((c) => (
          <div className="attention-item" key={c.clientId} onClick={() => go(c)} tabIndex={0} role="button" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(c); } }}>
            <div className="attention-main">
              <div className="attention-title">{c.clientName}</div>
              <div className="attention-meta">
                {c.balancePastDue > 0 && <span>{fmtMoney(c.balancePastDue)} overdue balance</span>}
                {c.agencyPastDueCount > 0 && <span>{c.agencyPastDueCount} agency obligation{c.agencyPastDueCount === 1 ? "" : "s"} past due{c.agencyPastDueAmount > 0 ? ` (${fmtMoney(c.agencyPastDueAmount)})` : ""}</span>}
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
    { value: "view-statement", label: "View Statement" },
    { value: "download-statement", label: "Download Statement" },
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
    if (action === "view-statement") {
      try { await viewFile(`/billing/clients/${i.client_id}/statement`); }
      catch (err) { await notify(err instanceof ApiError ? err.message : "Could not generate this statement."); }
      return;
    }
    if (action === "download-statement") {
      try { await downloadFile(`/billing/clients/${i.client_id}/statement`, buildFilename([clientNames.get(i.client_id), "Statement"], "pdf")); }
      catch (err) { await notify(err instanceof ApiError ? err.message : "Could not generate this statement."); }
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
  const [tasks, setTasks] = useState<Task[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [docs, setDocs] = useState<DocumentRequest[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [taxRows, setTaxRows] = useState<ClientTaxRow[]>([]);
  const [appointments, setAppointments] = useState<MyAppointment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load(): Promise<void> {
    return Promise.all([
      api.get<{ tasks: Task[] }>("/tasks"),
      api.get<{ clients: Client[] }>("/clients").catch(() => ({ clients: [] })),
      api.get<{ requests: DocumentRequest[] }>("/documents/requests").catch(() => ({ requests: [] })),
      api.get<{ invoices: Invoice[] }>("/billing/invoices").catch(() => ({ invoices: [] })),
      api.get<{ rows: ClientTaxRow[] }>("/billing/client-tax-payments").catch(() => ({ rows: [] })),
      api.get<{ appointments: MyAppointment[] }>("/appointments/mine").catch(() => ({ appointments: [] })),
    ])
      .then(([t, c, d, i, tx, ap]) => { setTasks(t.tasks); setClients(c.clients); setDocs(d.requests); setInvoices(i.invoices); setTaxRows(tx.rows); setAppointments(ap.appointments); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load dashboard data."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

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
  const waiting = openTasks.filter(isWaiting);
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
  // Unassigned work has no one whose queue it shows up in — an admin is the
  // only role that can actually see it firm-wide, so surfacing it here is the
  // only way it doesn't just silently sit unclaimed.
  const unassigned = openTasks.filter((t) => !t.assigned_to || !t.assigned_to.trim());
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

  return (
    <div>
      {overdue.length > 0 && (
        <div className="alert-strip">
          <strong>{overdue.length}</strong> of {openTasks.length} open tasks are overdue.
        </div>
      )}
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
      >
        {user?.role === "admin" && <button className="action-button" type="button" onClick={() => navigate("/clients?new=1")}>Add Client</button>}
      </FilterBar>

      <div className="metric-grid" style={{ marginBottom: 16 }}>
        <button type="button" className="metric metric-clickable" onClick={() => navigate("/clients")}>
          <div className="metric-label">Active Clients</div>
          <div className="metric-value">{clients.filter((c) => String(c.status || "").toLowerCase() === "active").length}</div>
          <div className="metric-note">{clients.length} total records</div>
        </button>
        <button type="button" className={`metric metric-clickable${overdue.length > 0 ? " metric-critical" : ""}`} onClick={() => navigate("/tasks")}>
          <div className="metric-label">Open Tasks</div>
          <div className="metric-value">{openTasks.length}</div>
          <div className="metric-note">{overdue.length} overdue</div>
        </button>
        <button type="button" className={`metric metric-clickable${overdueInvoices.length > 0 ? " metric-critical" : ""}`} onClick={() => navigate("/billing")}>
          <div className="metric-label">Unpaid Balance</div>
          <div className="metric-value">{fmtMoney(unpaidInvoices.reduce((sum, i) => sum + Number(i.balance_due || 0), 0))}</div>
          <div className="metric-note">{overdueInvoices.length} overdue · {unpaidInvoices.length} total</div>
        </button>
        <button type="button" className="metric metric-clickable" onClick={() => navigate("/documents")}>
          <div className="metric-label">Open Requests</div>
          <div className="metric-value">{openDocs.length}</div>
          <div className="metric-note">{openDocs.length} document items</div>
        </button>
      </div>

      <div className="command-grid">
        <CommandPanel title="Priority Work Queue" note={`${openTasks.length} visible, ranked by urgency`} action={<Link to="/tasks" className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>View all →</Link>}>
          <TaskRows tasks={priorityTasks.slice(0, 12)} empty="No priority tasks." onChanged={onChanged} />
        </CommandPanel>
        <div className="command-stack">
          <AtRiskClientsPanel />
          <PendingFilingReviewsPanel />
          <CommandPanel title="Today Snapshot" note="Open work by condition">
            <MiniKpis items={[["Overdue", String(overdue.length)], ["Due Soon", String(dueSoon.length)], ["Waiting", String(waiting.length)], ["Open Tasks", String(openTasks.length)]]} />
          </CommandPanel>
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
                    <span style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--paper-2)", overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", borderRadius: 3, background: "var(--teal)", width: `${staffLoadMax ? Math.max(6, (count / staffLoadMax) * 100) : 0}%` }} />
                    </span>
                    <span className="muted" style={{ flex: "0 0 auto", fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>{count}</span>
                  </button>
                ))}
              </div>
            </CommandPanel>
          )}
          {unassigned.length > 0 && (
            <CommandPanel title="Unassigned Work" note={`${unassigned.length} open task${unassigned.length === 1 ? "" : "s"} with no one on it`}>
              <AttentionRows tasks={unassigned.slice(0, 6)} empty="No unassigned tasks." />
            </CommandPanel>
          )}
        </div>
      </div>

      <div className="command-grid command-grid-even" style={{ marginTop: 14 }}>
        <CommandPanel title="Document Requests" note={`${openDocs.length} visible`} action={<Link to="/documents" className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>View all →</Link>}>
          <DocumentRows docs={openDocs.slice(0, 6)} empty="No open document requests." />
        </CommandPanel>
        <CommandPanel title="Billing Watch" note={`${unpaidInvoices.length} visible`} action={<Link to="/billing" className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>View all →</Link>}>
          <InvoiceRows invoices={unpaidInvoices.slice(0, 8)} empty="No unpaid invoices." clientNames={clientNames} />
        </CommandPanel>
      </div>

      <div className="command-grid command-grid-even" style={{ marginTop: 14 }}>
        <PayrollAgentCard />
        <TaskRulesAgentCard />
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
  const openTasks = tasks.filter(isOpenTask);
  const overdue = openTasks.filter(isOverdue);
  const dueSoon = openTasks.filter(isDueWeek);
  const waiting = openTasks.filter(isWaiting);
  // clients/docs/invoices are already scoped server-side to this staff member's
  // assigned clients (same query the Clients/Documents/Billing pages use) —
  // this data was already being fetched by the shared load() above and simply
  // discarded before, so surfacing it here costs nothing extra.
  const openDocs = docs.filter((d) => !["closed", "completed", "void", "archived"].includes(String(d.status || "").toLowerCase()));
  const unpaidInvoices = invoices.filter((i) => !["paid", "void"].includes(String(i.status || "").toLowerCase()));
  const overdueInvoices = unpaidInvoices.filter((i) => (daysUntil(i.due_date) ?? 0) < 0);
  const clientNames = new Map(clients.map((c) => [c.client_id, c.client_name]));

  return (
    <div>
      <div className="portal-banner">
        <div>
          <div className="eyebrow" style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>Staff Portal</div>
          <h2>{user?.name || user?.email}</h2>
          <p>Assigned clients, open work, waiting items, and client messages are filtered to your staff profile.</p>
        </div>
        <div className="quick-actions">
          <Link to="/documents" className="ghost-button">Documents</Link>
          <Link to="/communications" className="ghost-button">Messages</Link>
          <Link to="/accounting" className="action-button">Client Workbooks</Link>
        </div>
      </div>

      <div className="metric-grid" style={{ marginBottom: 16 }}>
        <button type="button" className="metric metric-clickable" onClick={() => navigate("/clients")}>
          <div className="metric-label">My Clients</div>
          <div className="metric-value">{clients.length}</div>
          <div className="metric-note">assigned to you</div>
        </button>
        <button type="button" className={`metric metric-clickable${overdue.length > 0 ? " metric-critical" : ""}`} onClick={() => navigate("/tasks")}>
          <div className="metric-label">Open Tasks</div>
          <div className="metric-value">{openTasks.length}</div>
          <div className="metric-note">{overdue.length} overdue</div>
        </button>
        <button type="button" className={`metric metric-clickable${overdueInvoices.length > 0 ? " metric-critical" : ""}`} onClick={() => navigate("/billing")}>
          <div className="metric-label">Unpaid Balance</div>
          <div className="metric-value">{fmtMoney(unpaidInvoices.reduce((sum, i) => sum + Number(i.balance_due || 0), 0))}</div>
          <div className="metric-note">{overdueInvoices.length} overdue · {unpaidInvoices.length} total</div>
        </button>
        <button type="button" className="metric metric-clickable" onClick={() => navigate("/documents")}>
          <div className="metric-label">Open Requests</div>
          <div className="metric-value">{openDocs.length}</div>
          <div className="metric-note">document items</div>
        </button>
      </div>

      <div className="command-grid">
        <CommandPanel title="My Work Queue" note={`${openTasks.length} assigned open tasks`}>
          <TaskRows tasks={openTasks.slice(0, 12)} empty="No assigned open tasks." onChanged={onChanged} />
        </CommandPanel>
        <div className="command-stack">
          {/* Falls back to showing overdue tasks when nothing is due-soon, so this
              panel isn't just empty — but that must never happen under the
              unchanged "Due Soon" heading, or overdue work reads as routine. */}
          <CommandPanel title={dueSoon.length ? "Due Soon" : "Overdue"} note={`${(dueSoon.length || overdue.length)} visible`}>
            <AttentionRows tasks={(dueSoon.length ? dueSoon : overdue).slice(0, 6)} empty="No due-soon tasks." />
          </CommandPanel>
          <CommandPanel title="Waiting / Pending" note={`${waiting.length} visible`}>
            <TaskRows tasks={waiting.slice(0, 6)} empty="No waiting or pending tasks." showStaleness onChanged={onChanged} />
          </CommandPanel>
        </div>
      </div>

      <div className="command-grid command-grid-even" style={{ marginTop: 14 }}>
        <CommandPanel title="Document Requests" note={`${openDocs.length} visible`} action={<Link to="/documents" className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>View all →</Link>}>
          <DocumentRows docs={openDocs.slice(0, 6)} empty="No open document requests." />
        </CommandPanel>
        <CommandPanel title="Billing Watch" note={`${unpaidInvoices.length} visible`} action={<Link to="/billing" className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>View all →</Link>}>
          <InvoiceRows invoices={unpaidInvoices.slice(0, 8)} empty="No unpaid invoices." clientNames={clientNames} />
        </CommandPanel>
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
  const navigate = useNavigate();
  const { t, dir, lang } = useLanguage();
  const [notices, setNotices] = useState<AccountNotice[]>([]);
  const [services, setServices] = useState<{ active: MyServiceTask[]; recentlyCompleted: MyServiceTask[] }>({ active: [], recentlyCompleted: [] });
  useEffect(() => {
    api.get<{ notices: AccountNotice[] }>("/clients/notices/mine").then((res) => setNotices(res.notices)).catch(() => {});
    api.get<{ active: MyServiceTask[]; recentlyCompleted: MyServiceTask[] }>("/tasks/mine").then(setServices).catch(() => {});
  }, []);
  const openDocs = docs.filter((d) => !["closed", "completed"].includes(String(d.status || "").toLowerCase()));
  const openInvoices = invoices.filter((i) => !["paid", "void"].includes(String(i.status || "").toLowerCase()));
  const unpaidTaxRows = taxRows.filter((r) => !r.paid_date);
  const balanceDue = openInvoices.reduce((sum, i) => sum + Number(i.balance_due || 0), 0);
  const taxDue = unpaidTaxRows.reduce((sum, r) => sum + Number(r.payment_amount || 0), 0);
  const clientNames = new Map(user?.clientId ? [[user.clientId, user.clientName || "My Account"]] as [string, string][] : []);

  return (
    <div dir={dir}>
      <div className="portal-banner">
        <div>
          <div className="eyebrow" style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>{t("dashboard.client.eyebrow")}</div>
          <h2>{user?.clientName || t("dashboard.client.myAccount")}</h2>
          <p>{t("dashboard.client.intro")}</p>
        </div>
        <div className="quick-actions">
          <Link to="/documents" className="action-button">{t("dashboard.documents")}</Link>
          <Link to="/billing" className="ghost-button">{t("dashboard.billing")}</Link>
          <Link to="/communications" className="ghost-button">{t("dashboard.messages")}</Link>
          <Link to="/my-business" className="ghost-button">{t("nav.myBusiness")}</Link>
        </div>
      </div>

      {notices.length > 0 && (
        <div className="command-panel" style={{ marginBottom: 14 }}>
          <div className="command-panel-header">
            <div>
              <h2 className="command-panel-title">{t("dashboard.client.accountNotices")}</h2>
              <div className="command-panel-note">{t("dashboard.client.accountNoticesNote")}</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "0 4px 4px" }}>
            {notices.map((n, i) => (
              <div
                key={n.flagId || i}
                className={`status-pill status-${n.color}`}
                style={{ flexDirection: "column", alignItems: "flex-start", width: "100%", padding: "8px 12px", fontSize: 12.5 }}
              >
                <div style={{ fontWeight: 700 }}>
                  {lang === "ar" ? n.labelAr : n.labelEn}
                  {n.amount !== null && ` — ${fmtMoney(n.amount)}`}
                  {n.dueDate && ` — ${t("dashboard.client.dueLabel")} ${fmtDate(n.dueDate)}`}
                </div>
                {(n.details || n.note) && <div style={{ fontWeight: 400, opacity: 0.85, marginTop: 3 }}>{n.details || n.note}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="metric-grid metric-grid-3" style={{ marginBottom: 16 }}>
        <button type="button" className="metric metric-clickable" onClick={() => navigate("/documents")}>
          <div className="metric-label">{t("dashboard.client.documentRequests")}</div>
          <div className="metric-value"><Num>{openDocs.length}</Num></div>
          <div className="metric-note">{t("dashboard.visible")}</div>
        </button>
        <button type="button" className="metric metric-clickable" onClick={() => navigate("/billing")}>
          <div className="metric-label">{t("dashboard.client.balanceDue")}</div>
          <div className="metric-value"><Num>{fmtMoney(balanceDue)}</Num></div>
          <div className="metric-note"><Num>{openInvoices.length}</Num> {t("dashboard.client.openInvoicesLower")}</div>
        </button>
        <button type="button" className="metric metric-clickable" onClick={() => navigate("/billing")}>
          <div className="metric-label">{t("dashboard.client.taxDue")}</div>
          <div className="metric-value"><Num>{fmtMoney(taxDue)}</Num></div>
          <div className="metric-note"><Num>{unpaidTaxRows.length}</Num> {t("dashboard.client.taxDueLower")}</div>
        </button>
      </div>

      <div className="command-panel" style={{ marginBottom: 14 }}>
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

      {appointments.length > 0 && (
        <div className="command-panel" style={{ marginBottom: 14 }}>
          <div className="command-panel-header">
            <div>
              <h2 className="command-panel-title">{t("dashboard.client.upcomingAppointments")}</h2>
              <div className="command-panel-note"><Num>{appointments.length}</Num> {t("dashboard.visible")}</div>
            </div>
          </div>
          <div className="work-card-list">
            {appointments.slice(0, 3).map((a) => (
              <article className="work-card" key={a.appointmentId}>
                <div className="work-card-main">
                  <div className="work-card-title">{a.appointmentTypeName || a.title}</div>
                  <div className="work-card-meta">
                    <span>{fmtApptWhen(a.startTime)} ET</span>
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
        </div>
      )}

      <div className="command-grid-even" style={{ display: "grid", gap: 14 }}>
        <CommandPanel title={t("dashboard.client.documentRequests")} note={<><Num>{openDocs.length}</Num> {t("dashboard.visible")}</>}>
          <DocumentRows docs={openDocs.slice(0, 10)} empty={t("dashboard.client.noDocs")} />
        </CommandPanel>
        <CommandPanel title={t("dashboard.client.openInvoices")} note={<><Num>{openInvoices.length}</Num> {t("dashboard.visible")}</>}>
          <InvoiceRows invoices={openInvoices.slice(0, 6)} empty={t("dashboard.client.noInvoices")} clientNames={clientNames} />
        </CommandPanel>
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

  useEffect(() => {
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

  return (
    <div dir={dir}>
      <div className="portal-banner">
        <div>
          <div className="eyebrow" style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>{t("dashboard.employee.eyebrow")}</div>
          <h2>{user?.employeeName || user?.name || t("dashboard.employee.myPay")}</h2>
          <p>{t("dashboard.employee.intro")}</p>
        </div>
        <div className="quick-actions">
          <Link to="/communications" className="ghost-button">{t("dashboard.messages")}</Link>
        </div>
      </div>

      <div className="command-panel" style={{ marginBottom: 14 }}>
        <div className="command-panel-header">
          <div>
            <h2 className="command-panel-title">{t("dashboard.employee.profile")}</h2>
          </div>
        </div>
        <MiniKpis items={[
          [t("dashboard.employee.email"), user?.email || "—"],
          [t("dashboard.employee.employer"), user?.clientName || "—"],
          [t("dashboard.employee.employeeId"), user?.employeeId || "—"],
        ]} />
      </div>

      {latest && (
        <div className="command-panel" style={{ marginBottom: 14 }}>
          <div className="command-panel-header">
            <div>
              <h2 className="command-panel-title">{t("dashboard.employee.latestPaystub")}</h2>
              <div className="command-panel-note"><Num>{fmtDate(latest.pay_date) || "No date"}{latest.check_number ? ` · ${t("dashboard.employee.checkNum")}${latest.check_number}` : ""}</Num></div>
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
