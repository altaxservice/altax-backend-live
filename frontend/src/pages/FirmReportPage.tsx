import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, downloadFile, viewFile, printFile, buildFilename } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import type { Client } from "../api/types";

/**
 * Firm-wide health metrics for AL TAX SERVICE itself — not a client report.
 * Used to live inside Reports' "Financial Overview" tab behind an "All
 * Clients (Firm-Wide)" dropdown option, which staff kept missing because
 * that whole page reads as "pick a client, see their numbers." Pulled out
 * into its own nav item/page so it's discoverable on its own rather than
 * hidden inside a client-scoped page. Backed by the same GET /reports/
 * firm-insights and GET /reports/csv/firm-insights routes as before — no
 * backend change, this is purely a frontend relocation.
 */
interface FirmInsights {
  revenueByServiceType: { serviceType: string; revenue: number; pctOfTotal: number }[];
  clientConcentration: { clientId: string; clientName: string; revenue: number; pctOfTotal: number }[];
  concentrationRisk: { top5Pct: number; top10Pct: number };
  mdOnTimeFilingRate: { onTime: number; late: number; missing: number; filedPendingPayment: number; notYetDue: number; total: number; pct: number | null };
  filingCompliance: {
    onTime: number; late: number; missing: number; notYetDue: number; total: number; pct: number | null;
    byServiceLine: { serviceLine: string; onTime: number; late: number; missing: number; pct: number | null }[];
  };
  estimateWinRate: { won: number; lost: number; stillOpen: number; totalCreated: number; winRatePct: number | null };
  clientGrowth: { monthly: { month: string; newClients: number; likelyBulkImport: boolean }[]; activeClientCountNow: number; note: string };
  staffUtilization: { email: string; name: string; totalHours: number; billableHours: number; billablePct: number; approvedHours: number }[];
}

interface FirmHealthScore {
  score: number;
  band: "Green" | "Yellow" | "Red";
  components: { label: string; points: number; maxPoints: number; detail: string }[];
}

const BAND_COLOR: Record<string, string> = { Green: "var(--teal)", Yellow: "#b8860b", Red: "var(--red)" };

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00";
}

export function FirmReportPage() {
  const navigate = useNavigate();
  const [from, setFrom] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [insights, setInsights] = useState<FirmInsights | null>(null);
  const [healthScore, setHealthScore] = useState<FirmHealthScore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    setInsights(null);
    setError(null);
    api.get<FirmInsights>(`/reports/firm-insights?from=${from}&to=${to}`)
      .then(setInsights)
      .catch(() => setError("Could not load the Firm Report."));
    setHealthScore(null);
    api.get<FirmHealthScore>(`/reports/firm-health-score?from=${from}&to=${to}`)
      .then(setHealthScore)
      .catch(() => {});
  }, [from, to]);

  async function handleExport(format: "csv" | "xlsx") {
    setExporting(format);
    try {
      await downloadFile(`/reports/csv/firm-insights?from=${from}&to=${to}&format=${format}`, buildFilename(["Firm Report", `${from} to ${to}`], format));
    } catch {
      setError("Could not export this data.");
    } finally {
      setExporting(null);
    }
  }

  async function handlePdf(mode: "view" | "download" | "print") {
    setExporting(`pdf-${mode}`);
    try {
      const path = `/reports/pdf/firm-insights?from=${from}&to=${to}`;
      if (mode === "view") await viewFile(path);
      else if (mode === "print") await printFile(path);
      else await downloadFile(path, buildFilename(["Firm Report", `${from} to ${to}`], "pdf"));
    } catch {
      setError("Could not generate the Firm Report PDF.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div>
      <p className="muted" style={{ marginBottom: 16, maxWidth: 720 }}>
        AL TAX SERVICE's own business health — not a client's numbers. Revenue mix, client concentration risk, filing
        compliance across every agency, estimate win rate, client growth, and staff utilization for the period below.
      </p>

      <div className="command-panel" style={{ marginBottom: 16 }}>
        <div className="command-panel-header" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="fr-from">From</label>
              <input id="fr-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="fr-to">To</label>
              <input id="fr-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" disabled={exporting !== null} onClick={() => handlePdf("view")}>
              {exporting === "pdf-view" ? "Opening…" : "View / Print"}
            </button>
            <button type="button" className="btn" disabled={exporting !== null} onClick={() => handlePdf("print")}>
              {exporting === "pdf-print" ? "Printing…" : "Print"}
            </button>
            <button type="button" className="btn" disabled={exporting !== null} onClick={() => handlePdf("download")}>
              {exporting === "pdf-download" ? "Generating…" : "Download PDF"}
            </button>
            <button type="button" className="btn" disabled={exporting !== null} onClick={() => handleExport("csv")}>
              {exporting === "csv" ? "Exporting…" : "Export CSV"}
            </button>
            <button type="button" className="btn" disabled={exporting !== null} onClick={() => handleExport("xlsx")}>
              {exporting === "xlsx" ? "Exporting…" : "Export Excel"}
            </button>
          </div>
        </div>
      </div>

      {healthScore && (
        <div className="command-panel" style={{ marginBottom: 16 }}>
          <div className="command-panel-header">
            <h2 className="command-panel-title">Firm Health Score</h2>
            <div className="command-panel-note">One composite number combining profitability, revenue trend, AR aging, filing compliance, overdue work, and staff utilization — always shown with the breakdown, never as a bare number.</div>
          </div>
          <div style={{ display: "flex", gap: 20, alignItems: "center", padding: "0 16px 16px", flexWrap: "wrap" }}>
            <div style={{ textAlign: "center", minWidth: 96 }}>
              <div style={{ fontSize: 40, fontWeight: 800, color: BAND_COLOR[healthScore.band] }}>{healthScore.score}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: BAND_COLOR[healthScore.band] }}>{healthScore.band.toUpperCase()}</div>
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <table>
                <tbody>
                  {healthScore.components.map((c) => (
                    <tr key={c.label}>
                      <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{c.label}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{c.points} / {c.maxPoints}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{c.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <ClientListingSection />

      {error && <ErrorBanner error={error} />}
      {!insights && !error && <div className="spinner-wrap">Loading Firm Report…</div>}

      {insights && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="command-panel">
            <div className="command-panel-header">
              <h2 className="command-panel-title">Revenue by Service Type</h2>
              <div className="command-panel-note">Grouped by each client's own Service Type — a client's revenue isn't split across sub-services</div>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th scope="col">Service Type</th><th scope="col">Revenue</th><th scope="col">% of Total</th></tr></thead>
                <tbody>
                  {insights.revenueByServiceType.map((r) => (
                    <tr key={r.serviceType}><td>{r.serviceType}</td><td>{fmtMoney(r.revenue)}</td><td>{r.pctOfTotal}%</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="command-panel">
            <div className="command-panel-header">
              <h2 className="command-panel-title">Client Concentration</h2>
              <div className="command-panel-note">
                Top 5: {insights.concentrationRisk.top5Pct}% of revenue &middot; Top 10: {insights.concentrationRisk.top10Pct}%
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th scope="col">Client</th><th scope="col">Revenue</th><th scope="col">% of Total</th></tr></thead>
                <tbody>
                  {insights.clientConcentration.map((c) => (
                    <tr key={c.clientId} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => navigate(`/clients/${c.clientId}`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/clients/${c.clientId}`); } }}>
                      <td>{c.clientName}</td><td>{fmtMoney(c.revenue)}</td><td>{c.pctOfTotal}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="command-panel">
            <div className="command-panel-header">
              <h2 className="command-panel-title">MD On-Time Filing Rate</h2>
              <div className="command-panel-note">Every MD sales tax period due in this window, across every MD client</div>
            </div>
            <div className="metric-grid" style={{ padding: 16, gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">On-Time Rate</div><div className="metric-value">{insights.mdOnTimeFilingRate.pct !== null ? `${insights.mdOnTimeFilingRate.pct}%` : "—"}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">On Time</div><div className="metric-value">{insights.mdOnTimeFilingRate.onTime}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Late</div><div className="metric-value" style={{ color: insights.mdOnTimeFilingRate.late > 0 ? "var(--red)" : undefined }}>{insights.mdOnTimeFilingRate.late}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Missing</div><div className="metric-value" style={{ color: insights.mdOnTimeFilingRate.missing > 0 ? "var(--red)" : undefined }}>{insights.mdOnTimeFilingRate.missing}</div></div>
            </div>
            <p className="muted" style={{ fontSize: 11, padding: "0 16px 12px" }}>
              {insights.mdOnTimeFilingRate.filedPendingPayment} filed with payment still pending, {insights.mdOnTimeFilingRate.notYetDue} not yet due — neither counts toward the rate above.
            </p>
          </div>

          <div className="command-panel">
            <div className="command-panel-header">
              <h2 className="command-panel-title">Firm-Wide Filing Compliance</h2>
              <div className="command-panel-note">Every task with an agency due date in this window — federal, other states, payroll, not just MD sales tax</div>
            </div>
            <div className="metric-grid" style={{ padding: 16, gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">On-Time Rate</div><div className="metric-value">{insights.filingCompliance.pct !== null ? `${insights.filingCompliance.pct}%` : "—"}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">On Time</div><div className="metric-value">{insights.filingCompliance.onTime}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Late</div><div className="metric-value" style={{ color: insights.filingCompliance.late > 0 ? "var(--red)" : undefined }}>{insights.filingCompliance.late}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Missing</div><div className="metric-value" style={{ color: insights.filingCompliance.missing > 0 ? "var(--red)" : undefined }}>{insights.filingCompliance.missing}</div></div>
            </div>
            {insights.filingCompliance.byServiceLine.length > 0 && (
              <div className="table-scroll">
                <table>
                  <thead><tr><th scope="col">Service Line</th><th scope="col">On-Time Rate</th><th scope="col">On Time</th><th scope="col">Late</th><th scope="col">Missing</th></tr></thead>
                  <tbody>
                    {insights.filingCompliance.byServiceLine.map((s) => (
                      <tr key={s.serviceLine}>
                        <td>{s.serviceLine}</td>
                        <td>{s.pct !== null ? `${s.pct}%` : "—"}</td>
                        <td>{s.onTime}</td>
                        <td style={{ color: s.late > 0 ? "var(--red)" : undefined }}>{s.late}</td>
                        <td style={{ color: s.missing > 0 ? "var(--red)" : undefined }}>{s.missing}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted" style={{ fontSize: 11, padding: "0 16px 12px" }}>
              {insights.filingCompliance.notYetDue} not yet due — doesn't count toward the rate above.
            </p>
          </div>

          <div className="command-panel">
            <div className="command-panel-header">
              <h2 className="command-panel-title">Estimate Win Rate</h2>
              <div className="command-panel-note">Of estimates that reached a decision (Approved or Declined) in this window</div>
            </div>
            <div className="metric-grid" style={{ padding: 16, gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Win Rate</div><div className="metric-value">{insights.estimateWinRate.winRatePct !== null ? `${insights.estimateWinRate.winRatePct}%` : "—"}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Won</div><div className="metric-value">{insights.estimateWinRate.won}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Lost</div><div className="metric-value">{insights.estimateWinRate.lost}</div></div>
              <div className="metric" style={{ boxShadow: "none" }}><div className="metric-label">Still Open</div><div className="metric-value">{insights.estimateWinRate.stillOpen}</div></div>
            </div>
          </div>

          <div className="command-panel">
            <div className="command-panel-header">
              <h2 className="command-panel-title">Client Growth</h2>
              <div className="command-panel-note">{insights.clientGrowth.activeClientCountNow} active clients today</div>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th scope="col">Month</th><th scope="col">New Clients</th></tr></thead>
                <tbody>
                  {insights.clientGrowth.monthly.map((m) => (
                    <tr key={m.month}>
                      <td>{m.month}</td>
                      <td>
                        {m.newClients}
                        {m.likelyBulkImport && (
                          <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>likely bulk import, not real growth</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 11, padding: "0 16px 12px" }}>{insights.clientGrowth.note}</p>
          </div>

          <div className="command-panel">
            <div className="command-panel-header">
              <h2 className="command-panel-title">Staff Utilization</h2>
              <div className="command-panel-note">Hours logged in Time Tracking for this window</div>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th scope="col">Staff</th><th scope="col">Total Hours</th><th scope="col">Billable Hours</th><th scope="col">Billable %</th></tr></thead>
                <tbody>
                  {insights.staffUtilization.length === 0 && (
                    <tr><td colSpan={4} className="muted">No time entries logged in this window.</td></tr>
                  )}
                  {insights.staffUtilization.map((s) => (
                    <tr key={s.email}>
                      <td>{s.name}</td><td>{s.totalHours}</td><td>{s.billableHours}</td><td>{s.billablePct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Client Listing / Client Detailed Listing — a printable firm-wide client
 * roster, modeled on a payroll platform's own "Reports" screen (Report
 * Group: Firm -> Client Listing / Client Detailed Listing): a client picker
 * with search + status filter, a Mask Federal ID toggle for the Detailed
 * variant (which is the only one that shows EIN at all), and the same
 * View/Print/Download trio every other PDF report in this app uses.
 */
function ClientListingSection() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [reportType, setReportType] = useState<"listing" | "detailed">("listing");
  const [maskEin, setMaskEin] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ clients: Client[] }>("/clients")
      .then((r) => {
        setClients(r.clients);
        setSelected(new Set(r.clients.filter((c) => String(c.status || "") === "Active").map((c) => c.client_id)));
      })
      .catch(() => {});
  }, []);

  const statuses = useMemo(() => Array.from(new Set(clients.map((c) => String(c.status || "")).filter(Boolean))).sort(), [clients]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (statusFilter !== "all" && String(c.status || "") !== statusFilter) return false;
      if (q && !c.client_name.toLowerCase().includes(q) && !c.client_id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [clients, search, statusFilter]);

  function toggleClient(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function pdfPath() {
    const detailed = reportType === "detailed" ? "1" : "0";
    const mask = maskEin ? "1" : "0";
    const clientIds = selected.size ? `&clientIds=${encodeURIComponent(Array.from(selected).join(","))}` : "";
    return `/reports/pdf/client-listing?detailed=${detailed}&maskEin=${mask}${clientIds}`;
  }

  const reportTitle = reportType === "detailed" ? "Client Detailed Listing" : "Client Listing";

  async function handleRun(mode: "view" | "download" | "print") {
    if (selected.size === 0) { setError("Select at least one client."); return; }
    setBusy(mode);
    setError(null);
    try {
      if (mode === "view") await viewFile(pdfPath());
      else if (mode === "print") await printFile(pdfPath());
      else await downloadFile(pdfPath(), buildFilename([reportTitle, new Date().toISOString().slice(0, 10)], "pdf"));
    } catch {
      setError(`Could not generate the ${reportTitle}.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="command-panel" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <h2 className="command-panel-title">Client Listing</h2>
        <div className="command-panel-note">A printable client roster — pick a report type, choose which clients to include, then view, print, or download.</div>
      </div>
      <div style={{ padding: "0 16px 16px" }}>
        {error && <ErrorBanner error={error} />}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 12px" }}>
          <button type="button" className={`btn btn-sm ${reportType === "listing" ? "btn-primary" : ""}`} onClick={() => setReportType("listing")}>Client Listing</button>
          <button type="button" className={`btn btn-sm ${reportType === "detailed" ? "btn-primary" : ""}`} onClick={() => setReportType("detailed")}>Client Detailed Listing</button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients…" style={{ maxWidth: 220 }} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ maxWidth: 150 }}>
            <option value="all">Any status</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set(filtered.map((c) => c.client_id)))}>Select shown ({filtered.length})</button>
          <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set(clients.map((c) => c.client_id)))}>Select all ({clients.length})</button>
          <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>

        <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 6, padding: 8, marginBottom: 12 }}>
          {filtered.map((c) => (
            <label key={c.client_id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 0" }}>
              <input type="checkbox" checked={selected.has(c.client_id)} onChange={() => toggleClient(c.client_id)} />
              {c.client_name} <span className="muted" style={{ fontSize: 11 }}>({c.client_id})</span>
            </label>
          ))}
          {filtered.length === 0 && <p className="muted" style={{ margin: 0 }}>No clients match.</p>}
        </div>

        {reportType === "detailed" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, margin: "0 0 12px" }}>
            <input type="checkbox" checked={maskEin} onChange={(e) => setMaskEin(e.target.checked)} />
            Mask Federal ID (show only the last 4 digits)
          </label>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn" disabled={busy !== null} onClick={() => handleRun("view")}>{busy === "view" ? "Opening…" : "View / Print"}</button>
          <button type="button" className="btn" disabled={busy !== null} onClick={() => handleRun("print")}>{busy === "print" ? "Printing…" : "Print"}</button>
          <button type="button" className="btn" disabled={busy !== null} onClick={() => handleRun("download")}>{busy === "download" ? "Generating…" : "Download PDF"}</button>
        </div>
        <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>{selected.size} client{selected.size === 1 ? "" : "s"} selected for the {reportTitle}.</p>
      </div>
    </div>
  );
}
