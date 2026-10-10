import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Client } from "../api/types";
import { StatusBadge } from "../components/StatusBadge";
import { FilterBar, exportCsv, activeViewDates } from "../components/FilterBar";
import { ErrorBanner } from "../components/ErrorBanner";
import { fmtDateOnly as fmtDate, daysUntil } from "../utils/date";
import { Pager } from "../components/Pager";
import { Wallet, AlertTriangle, CheckCircle2, ListChecks, type LucideIcon } from "lucide-react";

const PAGE_SIZE = 10;

interface TaxRow {
  task_id: string; task_name: string; client_id: string; client_name: string;
  agency_due_date: string | null; paid_date: string | null; payment_amount: string | number | null;
  confirmation_number: string | null; status: string; assigned_to: string | null;
}

const fmtMoney = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
};

/**
 * What clients owe tax agencies (sales tax, etc.) — split out from the Billing
 * page (2026-09-17), which is what the FIRM invoices clients for. Same
 * /billing/client-tax-payments data source, same v3_tasks(payment_required=true)
 * rows ClientDetailPage's own "Tax Payments" tab shows scoped to one client;
 * this is the firm-wide, every-client view of that same tracking.
 */
export function ClientTaxPaymentsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<TaxRow[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [period, setPeriod] = useState(() => ({
    start: searchParams.get("start") || activeViewDates().start,
    end: searchParams.get("end") || activeViewDates().end,
  }));
  const [clientFilter, setClientFilter] = useState(searchParams.get("clientId") || "");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [clientFilter, statusFilter, search, period.start, period.end]);

  function load(): Promise<void> {
    const qs = `?start=${period.start}&end=${period.end}`;
    return api.get<{ rows: TaxRow[] }>(`/billing/client-tax-payments${qs}`)
      .then((res) => setRows(res.rows))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load client tax payments."));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [period.start, period.end]);
  useEffect(() => { api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => {}); }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }

  const filtered = useMemo(() => {
    let r = rows || [];
    if (clientFilter) r = r.filter((row) => row.client_id === clientFilter);
    if (statusFilter !== "all") r = r.filter((row) => row.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((row) => [row.task_name, row.client_name, row.confirmation_number].some((v) => String(v || "").toLowerCase().includes(q)));
    return r;
  }, [rows, clientFilter, statusFilter, search]);

  const statusOptions = Array.from(new Set((rows || []).map((r) => r.status).filter(Boolean))) as string[];
  const unpaid = filtered.filter((r) => !r.paid_date);
  const dueTotal = unpaid.reduce((sum, r) => sum + Number(r.payment_amount || 0), 0);
  const overdue = unpaid.filter((r) => (daysUntil(r.agency_due_date) ?? 0) < 0);
  const overdueTotal = overdue.reduce((sum, r) => sum + Number(r.payment_amount || 0), 0);
  const paid = filtered.filter((r) => r.paid_date);
  const paidTotal = paid.reduce((sum, r) => sum + Number(r.payment_amount || 0), 0);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const kpi = (Icon: LucideIcon, tone: string, label: string, value: string, note: string) => (
    <div className="cc-kpi" style={{ cursor: "default" }}>
      <span className={`cc-kpi-icon act-tone-${tone}`}><Icon size={20} aria-hidden="true" /></span>
      <span><div className="cc-kpi-label">{label}</div><div className="cc-kpi-value">{value}</div><div className="cc-kpi-note">{note}</div></span>
    </div>
  );

  if (error) return <ErrorBanner error={error} />;

  return (
    <div>
      <p className="muted" style={{ margin: "0 0 16px", fontSize: 13 }}>
        Sales tax and other agency filings clients owe payment for — separate from what the firm invoices clients for
        (that's on <a href="/billing" onClick={(e) => { e.preventDefault(); navigate("/billing"); }}>Billing</a>).
      </p>

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Client, filing, confirmation #…" }}
        selects={[{ label: "Status", value: statusFilter, options: statusOptions, onChange: setStatusFilter }]}
        period={{ start: period.start, end: period.end, onStartChange: (v) => setPeriod((p) => ({ ...p, start: v })), onEndChange: (v) => setPeriod((p) => ({ ...p, end: v })), onActiveView: () => setPeriod(activeViewDates()) }}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        onExportCsv={() => exportCsv("client-tax-payments.csv", [
          { key: "client_name", label: "Client" }, { key: "task_name", label: "Filing" }, { key: "agency_due_date", label: "Due" },
          { key: "paid_date", label: "Paid" }, { key: "payment_amount", label: "Amount" }, { key: "status", label: "Status" },
        ], filtered as unknown as Record<string, unknown>[])}
      >
        <label className="filter-control" style={{ minWidth: 180 }}>
          Client
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
          </select>
        </label>
      </FilterBar>

      <div className="cc-kpis" style={{ margin: "16px 0 16px" }}>
        {kpi(Wallet, unpaid.length ? "amber" : "green", "Client tax due", fmtMoney(dueTotal), `${unpaid.length} unpaid`)}
        {kpi(AlertTriangle, overdue.length ? "red" : "green", "Past due", fmtMoney(overdueTotal), `${overdue.length} filing${overdue.length === 1 ? "" : "s"}`)}
        {kpi(CheckCircle2, "green", "Paid", fmtMoney(paidTotal), `${paid.length} filing${paid.length === 1 ? "" : "s"}`)}
        {kpi(ListChecks, "teal", "Rows shown", String(filtered.length), `of ${rows?.length ?? 0} total`)}
      </div>

      {rows === null && !error && <div className="spinner-wrap">Loading…</div>}

      {rows !== null && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ fontSize: 14 }}>Client Tax Payment Tracking</strong>
            <span className="muted" style={{ fontSize: 12 }}>{filtered.length} of {rows.length} rows</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Filing</th>
                  <th scope="col">Client</th>
                  <th scope="col">Due / Paid</th>
                  <th scope="col" style={{ textAlign: "right" }}>Expected</th>
                  <th scope="col">Paid</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.task_id} data-row-id={r.task_id} tabIndex={0} style={{ cursor: "pointer" }} onClick={() => navigate(`/tasks/${r.task_id}`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/tasks/${r.task_id}`); } }}>
                    <td>{r.task_name}</td>
                    <td className="muted">{r.client_name}</td>
                    <td className="muted">{fmtDate(r.paid_date || r.agency_due_date)}</td>
                    <td style={{ textAlign: "right" }}>{fmtMoney(r.payment_amount)}</td>
                    <td className="muted">{r.paid_date ? "Yes" : "No"}</td>
                    <td><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>{rows.length ? "No rows match." : "No client tax payment rows for this period."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager page={page} totalPages={totalPages} onPage={setPage} total={filtered.length} pageSize={PAGE_SIZE} />
        </div>
      )}
    </div>
  );
}
