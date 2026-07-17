import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, downloadFile, viewFile, resolveFileUrl } from "../api/client";
import type { Client, Task } from "../api/types";
import type { DocumentRequest, Invoice } from "../api/types2";
import { useAuth } from "../auth/AuthContext";
import { StatusBadge } from "../components/StatusBadge";
import { ActionMenu } from "../components/ActionMenu";
import { FilterBar, exportCsv } from "../components/FilterBar";
import { useToast } from "../components/Toast";
import { fmtDateOnly as fmtDate } from "../utils/date";
import { TASK_STATUSES, isOpenTask, isOverdue, isDueSoon, isWaiting, DueLabel, TaskFileCell, taskActionOptions } from "../components/TaskCells";
import { useLanguage, Num } from "../context/LanguageContext";

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
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

function TaskRows({ tasks, empty, statusEditable = true, onChanged }: { tasks: Task[]; empty: string; statusEditable?: boolean; onChanged?: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [savingId, setSavingId] = useState<string | null>(null);

  if (!tasks.length) return <p className="muted" style={{ padding: 16 }}>{empty}</p>;

  async function handleStatusChange(taskId: string, status: string) {
    setSavingId(taskId);
    try {
      await api.patch(`/tasks/${taskId}`, { status });
      onChanged?.();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not update status.");
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
    if (action === "request-doc") return navigate(`/documents?clientId=${task.client_id}`);
    if (action === "void-task") {
      const reason = prompt("Reason for voiding this task?");
      if (reason === null) return;
      try {
        await api.post(`/tasks/${task.task_id}/void`, { reason });
        onChanged?.();
      } catch (err) {
        alert(err instanceof ApiError ? err.message : "Could not void this task.");
      }
    }
    if (action === "delete-task") {
      const confirm = prompt(`Permanently delete "${task.task_name}"? This cannot be undone. Type DELETE TASK to confirm.`);
      if (confirm === null) return;
      try {
        await api.post(`/tasks/${task.task_id}/delete`, { confirm });
        onChanged?.();
      } catch (err) {
        alert(err instanceof ApiError ? err.message : "Could not delete this task.");
      }
    }
  }

  return (
    <div className="work-card-list">
      {tasks.map((t) => (
        <article className="work-card" key={t.task_id} onClick={() => navigate(`/tasks/${t.task_id}`)} style={{ cursor: "pointer" }}>
          <div className="work-card-main">
            <div className="work-card-title">{t.task_name || t.service_line || "Task"}</div>
            <div className="work-card-client muted">{t.client_name}</div>
            <div className="work-card-meta">
              <span>{t.service_line || "Service"}</span>
              <span>Due {fmtDate(t.agency_due_date) || "Not set"}</span>
              <span>{t.assigned_to || "Unassigned"}</span>
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
            <div onClick={(e) => e.stopPropagation()}>
              <ActionMenu options={taskActionOptions(user?.role)} onSelect={(action) => handleAction(t, action)} />
            </div>
          </div>
        </article>
      ))}
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
        <div className="attention-item" key={t.task_id} onClick={() => navigate(`/tasks/${t.task_id}`)}>
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

function docActionOptions(role: string | undefined, hasFile: boolean) {
  const actions: { value: string; label: string }[] = [
    { value: "upload-doc", label: role === "client" ? "Upload Document" : "Upload / Share File" },
  ];
  if (role !== "client") actions.push({ value: "edit-doc", label: "Edit" });
  if (hasFile) actions.push({ value: "view-doc", label: "View File" }, { value: "open-doc", label: "Open File" });
  return actions;
}

function DocumentRows({ docs, empty }: { docs: DocumentRequest[]; empty: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  if (!docs.length) return <p className="muted" style={{ padding: 16 }}>{empty}</p>;

  function handleAction(d: DocumentRequest, action: string) {
    const url = d.first_file_url;
    if (action === "upload-doc" || action === "edit-doc") return navigate(`/documents/${d.request_id}`);
    if ((action === "view-doc" || action === "open-doc") && url) return window.open(resolveFileUrl(url), "_blank", "noopener,noreferrer");
  }

  return (
    <div className="work-card-list">
      {docs.map((d) => {
        const fileCount = Number(d.file_count || 0);
        return (
          <article className="work-card" key={d.request_id} onClick={() => navigate(`/documents/${d.request_id}`)} style={{ cursor: "pointer" }}>
            <div className="work-card-main">
              <div className="work-card-title">{d.requested_item || "Document Request"}</div>
              <div className="work-card-client muted">{d.client_name}</div>
              <div className="work-card-meta">
                <span>Due {fmtDate(d.due_from_client) || "Not set"}</span>
                <span>{d.assigned_to || "Unassigned"}</span>
                <span>{fileCount ? `${fileCount} file(s)` : "No files"}</span>
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
  const { user } = useAuth();
  if (!invoices.length) return <p className="muted" style={{ padding: 16 }}>{empty}</p>;

  async function handleAction(i: Invoice, action: string) {
    if (action === "view-invoice") return navigate(`/billing/${i.invoice_id}`);
    if (action === "record-payment" || action === "edit-invoice") return navigate(`/billing/${i.invoice_id}`);
    if (action === "view-invoice-pdf") {
      try { await viewFile(`/billing/invoices/${i.invoice_id}/print`); }
      catch (err) { alert(err instanceof ApiError ? err.message : "Could not open this invoice."); }
      return;
    }
    if (action === "print-invoice") {
      try { await downloadFile(`/billing/invoices/${i.invoice_id}/print`, `Invoice_${i.invoice_id}.pdf`); }
      catch (err) { alert(err instanceof ApiError ? err.message : "Could not generate this invoice PDF."); }
      return;
    }
    if (action === "view-statement") {
      try { await viewFile(`/billing/clients/${i.client_id}/statement`); }
      catch (err) { alert(err instanceof ApiError ? err.message : "Could not generate this statement."); }
      return;
    }
    if (action === "download-statement") {
      try { await downloadFile(`/billing/clients/${i.client_id}/statement`, `Statement_${i.client_id}.pdf`); }
      catch (err) { alert(err instanceof ApiError ? err.message : "Could not generate this statement."); }
    }
  }

  return (
    <div className="work-card-list">
      {invoices.map((i) => (
        <article className="work-card" key={i.invoice_id} onClick={() => navigate(`/billing/${i.invoice_id}`)} style={{ cursor: "pointer" }}>
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load(): Promise<void> {
    return Promise.all([
      api.get<{ tasks: Task[] }>("/tasks"),
      api.get<{ clients: Client[] }>("/clients").catch(() => ({ clients: [] })),
      api.get<{ requests: DocumentRequest[] }>("/documents/requests").catch(() => ({ requests: [] })),
      api.get<{ invoices: Invoice[] }>("/billing/invoices").catch(() => ({ invoices: [] })),
    ])
      .then(([t, c, d, i]) => { setTasks(t.tasks); setClients(c.clients); setDocs(d.requests); setInvoices(i.invoices); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load dashboard data."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  if (error) return <div className="error-banner">{error}</div>;
  if (loading) return <div className="spinner-wrap">Loading…</div>;

  if (user?.role === "client") return <ClientCommand docs={docs} invoices={invoices} />;
  if (user?.role === "staff") return <StaffCommand tasks={tasks} onChanged={load} />;
  if (user?.role === "employee") return <EmployeeCommand />;
  return <AdminCommand tasks={tasks} clients={clients} docs={docs} invoices={invoices} onChanged={load} />;
}

function AdminCommand({ tasks, clients, docs, invoices, onChanged }: { tasks: Task[]; clients: Client[]; docs: DocumentRequest[]; invoices: Invoice[]; onChanged: () => Promise<void> }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
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
  const filteredTasks = tasks
    .filter((t) => service === "all" || t.service_line === service)
    .filter((t) => status === "all" || String(t.status || "").toLowerCase() === status.toLowerCase());

  const openTasks = filteredTasks.filter(isOpenTask);
  const overdue = openTasks.filter(isOverdue);
  const dueSoon = openTasks.filter(isDueSoon);
  const waiting = openTasks.filter(isWaiting);
  const openDocs = docs.filter((d) => !["closed", "completed", "void", "archived"].includes(String(d.status || "").toLowerCase()));
  const unpaidInvoices = invoices.filter((i) => !["paid", "void"].includes(String(i.status || "").toLowerCase()));

  return (
    <div>
      <FilterBar
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
        <button type="button" className="metric metric-clickable" onClick={() => navigate("/tasks")}>
          <div className="metric-label">Open Tasks</div>
          <div className="metric-value">{openTasks.length}</div>
          <div className="metric-note">{overdue.length} overdue</div>
        </button>
        <button type="button" className="metric metric-clickable" onClick={() => navigate("/billing")}>
          <div className="metric-label">Unpaid Balance</div>
          <div className="metric-value">{fmtMoney(unpaidInvoices.reduce((sum, i) => sum + Number(i.balance_due || 0), 0))}</div>
          <div className="metric-note">{unpaidInvoices.length} invoices loaded</div>
        </button>
        <button type="button" className="metric metric-clickable" onClick={() => navigate("/documents")}>
          <div className="metric-label">Open Requests</div>
          <div className="metric-value">{openDocs.length}</div>
          <div className="metric-note">{openDocs.length} document items</div>
        </button>
      </div>

      <div className="command-grid">
        <CommandPanel title="Priority Work Queue" note={`${openTasks.length} visible`} action={<Link to="/tasks" className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>View all →</Link>}>
          <TaskRows tasks={openTasks.slice(0, 12)} empty="No priority tasks." onChanged={onChanged} />
        </CommandPanel>
        <div className="command-stack">
          <CommandPanel title="Today Snapshot" note="Open work by condition">
            <MiniKpis items={[["Overdue", String(overdue.length)], ["Due Soon", String(dueSoon.length)], ["Waiting", String(waiting.length)], ["Open Tasks", String(openTasks.length)]]} />
          </CommandPanel>
          <CommandPanel title="Needs Attention" note={`${Math.min(overdue.length + dueSoon.length, 6)} visible`}>
            <AttentionRows tasks={[...overdue, ...dueSoon].slice(0, 6)} empty="No urgent work right now." />
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

function StaffCommand({ tasks, onChanged }: { tasks: Task[]; onChanged: () => void }) {
  const { user } = useAuth();
  const openTasks = tasks.filter(isOpenTask);
  const overdue = openTasks.filter(isOverdue);
  const dueSoon = openTasks.filter(isDueSoon);
  const waiting = openTasks.filter(isWaiting);

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
      <div className="command-grid">
        <CommandPanel title="My Work Queue" note={`${openTasks.length} assigned open tasks`}>
          <TaskRows tasks={openTasks.slice(0, 12)} empty="No assigned open tasks." onChanged={onChanged} />
        </CommandPanel>
        <div className="command-stack">
          <CommandPanel title="Due Soon" note={`${(dueSoon.length || overdue.length)} visible`}>
            <AttentionRows tasks={(dueSoon.length ? dueSoon : overdue).slice(0, 6)} empty="No due-soon tasks." />
          </CommandPanel>
          <CommandPanel title="Waiting / Pending" note={`${waiting.length} visible`}>
            <TaskRows tasks={waiting.slice(0, 6)} empty="No waiting or pending tasks." onChanged={onChanged} />
          </CommandPanel>
        </div>
      </div>
    </div>
  );
}

function ClientCommand({ docs, invoices }: { docs: DocumentRequest[]; invoices: Invoice[] }) {
  const { user } = useAuth();
  const { t, dir } = useLanguage();
  const openDocs = docs.filter((d) => !["closed", "completed"].includes(String(d.status || "").toLowerCase()));
  const openInvoices = invoices.filter((i) => !["paid", "void"].includes(String(i.status || "").toLowerCase()));
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
        </div>
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
      alert(err instanceof ApiError ? err.message : "Could not open this paystub.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDownload(p: MyPaycheck) {
    setBusy(`download:${p.paycheck_id}`);
    try {
      await downloadFile(`/accounting/paychecks/${p.paycheck_id}/print`, `Paystub_${p.check_number || p.paycheck_id}.pdf`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not download this paystub.");
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
        {error && <div className="error-banner" style={{ margin: 16 }}>{error}</div>}
        {!paychecks && !error && <p className="muted" style={{ padding: 16 }}>{t("common.loading")}</p>}
        {paychecks && paychecks.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>{t("dashboard.employee.noPaystubs")}</p>}
        {paychecks && paychecks.length > 0 && (
          <table>
            <thead><tr><th>{t("dashboard.employee.payDate")}</th><th>{t("dashboard.employee.employer")}</th><th>{t("dashboard.employee.period")}</th><th>{t("dashboard.employee.gross")}</th><th>{t("dashboard.employee.taxes")}</th><th>{t("dashboard.employee.netPay")}</th><th>{t("dashboard.employee.status")}</th><th></th></tr></thead>
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
        )}
      </div>
    </div>
  );
}
