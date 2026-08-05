import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ErrorBanner } from "./ErrorBanner";

interface ClientSummary { openTasks: number; openRequests: number; openInvoices: number; balanceDue: number; employeesCount: number }

interface ClientFinancialSnapshot {
  totals: { revenue: number; expenses: number; profit: number };
  unpaidBalance: number;
  unpaidInvoiceCount: number;
  taxLiabilities: number;
}

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

/**
 * "At a Glance" — the first tab a staff member lands on when opening a
 * client, inspired by QuickBooks Online Accountant's own firm home
 * dashboard, but scoped to one client and built from this app's own AR/
 * invoice/task data (no QuickBooks bank-feed integration here). Two parts:
 *
 * - Operations tiles, restyled from the same `summary` ClientDetailPage.tsx
 *   already fetches for the "Account" tab's DetailRow list (no duplicate
 *   fetch — passed in as a prop) — visible to staff and admin alike.
 * - A Financial Snapshot, admin-only (matching the existing restriction on
 *   this exact data everywhere else in the app — Reports' "Financial
 *   Overview" and "AR Aging" tabs are both already admin-only), fetched
 *   from the new GET /reports/client-summary/:clientId route, which just
 *   wraps the existing computeFirmSummary with a client-scoped, staff-safe
 *   (well, admin-safe) auth check — no new SQL.
 */
export function ClientAtAGlance({ clientId, summary }: { clientId: string; summary: ClientSummary | null }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [financials, setFinancials] = useState<ClientFinancialSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) { setFinancials(null); return; }
    setLoading(true);
    setError(null);
    api.get<ClientFinancialSnapshot>(`/reports/client-summary/${clientId}`)
      .then(setFinancials)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the financial snapshot."))
      .finally(() => setLoading(false));
  }, [clientId, isAdmin]);

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Operations</h2>
        <div className="metric-grid">
          <div className="metric"><div className="metric-label">Open Tasks</div><div className="metric-value">{summary ? summary.openTasks : "—"}</div></div>
          <div className="metric"><div className="metric-label">Open Document Requests</div><div className="metric-value">{summary ? summary.openRequests : "—"}</div></div>
          <div className="metric"><div className="metric-label">Open Invoices</div><div className="metric-value">{summary ? summary.openInvoices : "—"}</div></div>
          <div className="metric"><div className="metric-label">Balance Due</div><div className="metric-value">{summary ? fmtMoney(summary.balanceDue) : "—"}</div></div>
          <div className="metric"><div className="metric-label">Employees</div><div className="metric-value">{summary ? summary.employeesCount : "—"}</div></div>
        </div>
      </div>

      {isAdmin && (
        <div className="card">
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Financial Snapshot</h2>
          {error && <ErrorBanner error={error} />}
          {loading && <div className="spinner-wrap">Loading…</div>}
          {!loading && financials && (
            <div className="metric-grid metric-grid-3">
              <div className="metric"><div className="metric-label">Revenue</div><div className="metric-value">{fmtMoney(financials.totals.revenue)}</div><div className="metric-note">Last 6 months</div></div>
              <div className="metric"><div className="metric-label">Expenses</div><div className="metric-value">{fmtMoney(financials.totals.expenses)}</div><div className="metric-note">Last 6 months</div></div>
              <div className="metric"><div className="metric-label">Net Profit</div><div className="metric-value">{fmtMoney(financials.totals.profit)}</div><div className="metric-note">Last 6 months</div></div>
              <div className="metric"><div className="metric-label">Unpaid Balance</div><div className="metric-value">{fmtMoney(financials.unpaidBalance)}</div><div className="metric-note">{financials.unpaidInvoiceCount} invoice{financials.unpaidInvoiceCount === 1 ? "" : "s"}</div></div>
              <div className="metric"><div className="metric-label">Tax Liabilities</div><div className="metric-value">{fmtMoney(financials.taxLiabilities)}</div><div className="metric-note">Sales/payroll tax payable, current balance</div></div>
            </div>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            For a longer or custom date range, see Reports → Financial Overview for this client.
          </p>
        </div>
      )}
    </div>
  );
}
