import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";
import { useConfirm, useNotify } from "./ConfirmProvider";

/**
 * MD Annual Report — Overdue: firm-wide, every client, not one. Moved here
 * to Fix Center (direct owner request, 2026-08-26) from the Reports page,
 * where it sat confusingly alongside genuinely per-client tabs. Landed here
 * rather than next to ArAgingReport.tsx on Firm Report because its backend
 * routes are Staff+Admin (requireRole("admin","staff")), while Firm Report
 * is Admin-only — moving it there would have quietly cut Staff off from
 * clearing overdue filings, which is real, regular work for them; Fix
 * Center is the one other firm-wide, all-clients page both roles can reach.
 * Backs GET /clients/md-annual-report-overdue and POST
 * /clients/obligations/mark-done-bulk (clients.routes.ts), built to let
 * staff clear the ~118 clients whose MD Annual Report only just became
 * visible as overdue (see complianceCalendar.ts's computeUpcomingDeadlines
 * fix) — most were very likely filed the normal way outside this app and
 * just never had a completion recorded here.
 */
interface MdAnnualReportOverdueRow { clientId: string; clientName: string; dueDate: string }

export function MdAnnualReportOverdue() {
  const navigate = useNavigate();
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const [data, setData] = useState<MdAnnualReportOverdueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  function load() {
    setError(null);
    api.get<{ clients: MdAnnualReportOverdueRow[] }>("/clients/md-annual-report-overdue")
      .then((r) => { setData(r.clients); setSelected(new Set()); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load overdue MD Annual Reports."));
  }
  useEffect(load, []);

  function toggleSelected(clientId: string) {
    setSelected((prev) => { const next = new Set(prev); next.has(clientId) ? next.delete(clientId) : next.add(clientId); return next; });
  }
  function toggleSelectAll() {
    if (!data) return;
    setSelected((prev) => (prev.size === data.length ? new Set() : new Set(data.map((r) => r.clientId))));
  }

  async function handleMarkDone() {
    if (!data || selected.size === 0) return;
    const ok = await confirmDialog({
      title: "Mark MD Annual Report filed",
      message: `Mark ${selected.size} client(s)' MD Annual Report as filed? This only records that it was filed — only do this for clients you know actually filed it.`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const items = data.filter((r) => selected.has(r.clientId)).map((r) => ({ clientId: r.clientId, dueDate: r.dueDate, label: "MD Annual Report" }));
      const res = await api.post<{ ok: boolean; succeeded: number; failed: { clientId: string; error: string }[] }>(
        "/clients/obligations/mark-done-bulk", { source: "MD Annual Report", items }
      );
      if (res.failed.length) await notify(`${res.succeeded} marked filed. ${res.failed.length} could not be updated: ${res.failed.map((f) => f.clientId).join(", ")}.`);
      else await notify(`${res.succeeded} client(s) marked as filed.`);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not mark these as filed.");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBanner error={error} />;
  if (!data) return <div className="spinner-wrap">Loading…</div>;

  return (
    <>
      <div className="command-panel" style={{ marginBottom: 16 }}>
        <div className="command-panel-header" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 className="command-panel-title">MD Annual Report — Overdue</h2>
            <div className="command-panel-note">
              Clients with no recorded completion for their most recently due Maryland Annual Report (due April 15).
              Most of these were very likely filed the normal way outside this app — select the ones you know were filed and mark them below.
            </div>
          </div>
          {selected.size > 0 && (
            <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{selected.size} selected</span>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={handleMarkDone}>
                {busy ? "Marking…" : "Mark Filed"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="command-panel">
        <div className="command-panel-header">
          <h2 className="command-panel-title">Clients ({data.length})</h2>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col" style={{ width: 32 }}><input type="checkbox" checked={data.length > 0 && selected.size === data.length} onChange={toggleSelectAll} /></th>
                <th scope="col">Client</th>
                <th scope="col">Due Date</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.clientId} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => navigate(`/clients/${r.clientId}`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/clients/${r.clientId}`); } }}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(r.clientId)} onChange={() => toggleSelected(r.clientId)} /></td>
                  <td>{r.clientName}</td>
                  <td className="muted">{r.dueDate}</td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr><td colSpan={3} className="muted" style={{ textAlign: "center", padding: 24 }}>No overdue MD Annual Reports.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
