import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, viewFile, downloadFile, printFile, buildFilename } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";

/**
 * AR Aging — firm-wide, not per-client. Moved here from the Reports page
 * (direct owner request, 2026-08-26) after screenshots showed a "selected
 * client" panel pinned next to this report, which is about every client's
 * balance, not one — confusing since it looked tied to whichever client had
 * been clicked elsewhere. Firm Report is a page of exclusively firm-wide
 * sections, so there's no client-panel ambiguity here at all.
 */
interface ArAgingRow {
  clientId: string; clientName: string;
  current: number; d1_30: number; d31_60: number; d61_90: number; d90Plus: number; total: number;
}
interface ArAgingData {
  asOf: string;
  rows: ArAgingRow[];
  totals: { current: number; d1_30: number; d31_60: number; d61_90: number; d90Plus: number; total: number };
}

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return `$${(Number.isFinite(n) ? n : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ArAgingReport() {
  const navigate = useNavigate();
  const [data, setData] = useState<ArAgingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    setError(null);
    api.get<ArAgingData>("/reports/ar-aging")
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load AR aging."));
  }
  useEffect(load, []);

  async function handlePrint(mode: "view" | "download" | "print") {
    setBusy(mode);
    try {
      if (mode === "view") await viewFile("/reports/pdf/ar-aging");
      else if (mode === "print") await printFile("/reports/pdf/ar-aging");
      else await downloadFile("/reports/pdf/ar-aging", buildFilename(["AR Aging", data?.asOf], "pdf"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate the PDF.");
    } finally {
      setBusy(null);
    }
  }

  async function handleCsv(format: "csv" | "xlsx" = "csv") {
    setBusy(format);
    try {
      await downloadFile(`/reports/csv/ar-aging?format=${format}`, buildFilename(["AR Aging", data?.asOf], format));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not export the data.");
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorBanner error={error} />;
  if (!data) return <div className="spinner-wrap">Loading…</div>;

  return (
    <>
      <div className="command-panel" style={{ marginBottom: 16 }}>
        <div className="command-panel-header" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 className="command-panel-title">AR Aging</h2>
            <div className="command-panel-note">Open invoice balances by client, as of {data.asOf}.</div>
          </div>
          <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => handlePrint("view")}>
              {busy === "view" ? "Opening…" : "Preview / Print"}
            </button>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => handlePrint("download")}>
              {busy === "download" ? "Generating…" : "Download PDF"}
            </button>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => handlePrint("print")}>
              {busy === "print" ? "Printing…" : "Print PDF"}
            </button>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => handleCsv("csv")}>
              {busy === "csv" ? "Exporting…" : "Export CSV"}
            </button>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => handleCsv("xlsx")}>
              {busy === "xlsx" ? "Exporting…" : "Export Excel"}
            </button>
          </div>
        </div>
      </div>

      <div className="metric-grid" style={{ marginBottom: 20 }}>
        <div className="metric"><div className="metric-label">Total Outstanding</div><div className="metric-value">{fmtMoney(data.totals.total)}</div></div>
        <div className="metric"><div className="metric-label">Current</div><div className="metric-value">{fmtMoney(data.totals.current)}</div></div>
        <div className="metric"><div className="metric-label">31-90 Days</div><div className="metric-value">{fmtMoney(data.totals.d31_60 + data.totals.d61_90)}</div></div>
        <div className="metric"><div className="metric-label">90+ Days</div><div className="metric-value">{fmtMoney(data.totals.d90Plus)}</div></div>
      </div>

      <div className="command-panel">
        <div className="command-panel-header">
          <h2 className="command-panel-title">Clients With A Balance ({data.rows.length})</h2>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col" style={{ textAlign: "right" }}>Current</th>
                <th scope="col" style={{ textAlign: "right" }}>1-30</th>
                <th scope="col" style={{ textAlign: "right" }}>31-60</th>
                <th scope="col" style={{ textAlign: "right" }}>61-90</th>
                <th scope="col" style={{ textAlign: "right" }}>90+</th>
                <th scope="col" style={{ textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.clientId} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => navigate(`/clients/${r.clientId}?tab=Billing`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/clients/${r.clientId}?tab=Billing`); } }}>
                  <td>{r.clientName}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(r.current)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(r.d1_30)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(r.d31_60)}</td>
                  <td style={{ textAlign: "right", color: r.d61_90 > 0 ? "var(--amber)" : undefined }}>{fmtMoney(r.d61_90)}</td>
                  <td style={{ textAlign: "right", color: r.d90Plus > 0 ? "var(--red)" : undefined }}>{fmtMoney(r.d90Plus)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtMoney(r.total)}</td>
                </tr>
              ))}
              {!data.rows.length && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>No open balances — every invoice is paid or void.</td></tr>
              )}
            </tbody>
            {data.rows.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700 }}>
                  <td>Total</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(data.totals.current)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(data.totals.d1_30)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(data.totals.d31_60)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(data.totals.d61_90)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(data.totals.d90Plus)}</td>
                  <td style={{ textAlign: "right" }}>{fmtMoney(data.totals.total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}
