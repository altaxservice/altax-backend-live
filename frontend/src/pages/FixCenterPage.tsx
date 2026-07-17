import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface DiagnosticCheck {
  id: string;
  label: string;
  status: "ok" | "warning" | "critical";
  detail: string;
  fixAction?: "rotate-jwt-secret";
}

const STATUS_STYLE: Record<DiagnosticCheck["status"], { color: string; bg: string; label: string }> = {
  ok: { color: "var(--teal)", bg: "rgba(11,107,107,0.08)", label: "OK" },
  warning: { color: "#a5720a", bg: "rgba(165,114,10,0.1)", label: "Needs attention" },
  critical: { color: "var(--red)", bg: "rgba(196,60,60,0.1)", label: "Critical" },
};

function DiagnosticRow({ check, onFixed }: { check: DiagnosticCheck; onFixed: () => void }) {
  const style = STATUS_STYLE[check.status];
  const [rotating, setRotating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRotate() {
    const typed = window.prompt('This will sign everyone out immediately, including you. Type "ROTATE LOGIN KEY" to confirm.');
    if (typed !== "ROTATE LOGIN KEY") return;
    setRotating(true);
    setError(null);
    try {
      const res = await api.post<{ ok: boolean; message: string; envLineToSave: string; note: string }>("/system/diagnostics/rotate-jwt-secret", { confirm: typed });
      setResult(`${res.message}\n\nSave this line to your .env file:\n${res.envLineToSave}\n\n${res.note}`);
      onFixed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not rotate the key.");
    } finally {
      setRotating(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div style={{ padding: 16, borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999, color: style.color, background: style.bg }}>
              {style.label}
            </span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{check.label}</span>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{check.detail}</p>
        </div>
        {check.fixAction === "rotate-jwt-secret" && (
          <button type="button" className="btn" disabled={rotating} onClick={() => setConfirmOpen(true)}>
            {rotating ? "Rotating…" : "Fix Now"}
          </button>
        )}
      </div>
      {confirmOpen && (
        <div className="card" style={{ marginTop: 12, borderColor: "var(--red)" }}>
          <p style={{ marginTop: 0, fontSize: 13 }}>
            This immediately signs out every logged-in user, including you — everyone must log in again. Type <strong>ROTATE LOGIN KEY</strong> to confirm.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={rotating} onClick={handleRotate}>{rotating ? "Rotating…" : "I understand, rotate now"}</button>
            <button type="button" className="btn" onClick={() => setConfirmOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      {result && <pre className="card" style={{ marginTop: 12, whiteSpace: "pre-wrap", fontSize: 12, borderColor: "var(--teal)" }}>{result}</pre>}
      {error && <div className="error-banner" style={{ marginTop: 12 }}>{error}</div>}
    </div>
  );
}

export function FixCenterPage() {
  const { user } = useAuth();
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null);
  const [checksError, setChecksError] = useState<string | null>(null);
  const [tables, setTables] = useState<{ table: string; count: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);

  function loadDiagnostics() {
    api.get<{ checks: DiagnosticCheck[] }>("/system/diagnostics")
      .then((res) => setChecks(res.checks))
      .catch((err) => setChecksError(err instanceof ApiError ? err.message : "Could not run diagnostics."));
  }

  function load() {
    api.get<{ tables: { table: string; count: number }[] }>("/system/table-counts")
      .then((res) => setTables(res.tables))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load system check."));
  }

  useEffect(() => { loadDiagnostics(); load(); }, []);

  async function handleSeedDefaults() {
    setSeeding(true);
    setSeedResult(null);
    try {
      const res = await api.post<{ ratesCreated: number; accountsCreated: number; ratesSkipped: number; accountsSkipped: number }>("/system/seed-defaults", {});
      setSeedResult(`Created ${res.ratesCreated} tax rate(s) and ${res.accountsCreated} chart-of-accounts entr${res.accountsCreated === 1 ? "y" : "ies"} (${res.ratesSkipped} rates and ${res.accountsSkipped} accounts already existed and were left as-is).`);
      load();
    } catch (err) {
      setSeedResult(err instanceof ApiError ? err.message : "Could not seed default data.");
    } finally {
      setSeeding(false);
    }
  }

  const criticalCount = checks?.filter((c) => c.status === "critical").length || 0;
  const warningCount = checks?.filter((c) => c.status === "warning").length || 0;

  return (
    <div>
      <div className="portal-banner" style={{ marginBottom: 16 }}>
        <div className="topbar-eyebrow">Fix Center</div>
        <h2>System Health &amp; Self-Diagnostics</h2>
        <p>
          Plain-English checks of whether anything in the app is misconfigured or the data has drifted into a bad state —
          no technical knowledge needed to read this page. For anything not fixable here, see the Maintenance Manual
          (docs/MAINTENANCE_MANUAL.md in the project) or ask {user?.role === "admin" ? "your developer" : "an admin"} to look into it.
        </p>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button className="btn" onClick={() => { loadDiagnostics(); load(); }}>Refresh</button>
      </div>

      <div className="command-panel" style={{ marginBottom: 16 }}>
        <div className="command-panel-header">
          <div>
            <h2 className="command-panel-title">System Health Check</h2>
            <div className="command-panel-note">
              {checks
                ? criticalCount > 0
                  ? `${criticalCount} critical issue(s) need attention`
                  : warningCount > 0
                    ? `${warningCount} item(s) to review — nothing urgent`
                    : "Everything checks out"
                : "Running checks…"}
            </div>
          </div>
        </div>
        {checksError && <div className="error-banner" style={{ margin: 16 }}>{checksError}</div>}
        {!checks && !checksError && <div className="spinner-wrap">Running diagnostics…</div>}
        {checks && checks.map((c) => <DiagnosticRow key={c.id} check={c} onFixed={loadDiagnostics} />)}
      </div>

      <div className="command-panel" style={{ marginBottom: 16 }}>
        <div className="command-panel-header">
          <div>
            <h2 className="command-panel-title">Seed Default Setup Data</h2>
            <div className="command-panel-note">For a fresh deployment — safe to re-run, never overwrites existing rows.</div>
          </div>
        </div>
        <div style={{ padding: 16 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            Creates the default global tax rates (sales, payroll, FICA/FUTA/SUTA) and a standard chart of accounts if they
            don't already exist. Any rate or account you've already configured is left untouched.
          </p>
          {seedResult && <div className="card" style={{ marginBottom: 12, borderColor: "var(--teal)" }}>{seedResult}</div>}
          <button className="btn btn-primary" disabled={seeding} onClick={handleSeedDefaults}>{seeding ? "Seeding…" : "Seed Default Tax Rates & COA"}</button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {!tables && !error && <div className="spinner-wrap">Loading…</div>}
      {tables && (
        <div className="command-panel">
          <div className="command-panel-header"><h2 className="command-panel-title">Table Row Counts</h2><div className="command-panel-note">{tables.length} tables — useful when comparing before/after a data change</div></div>
          <table>
            <thead><tr><th>Table</th><th>Row Count</th></tr></thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.table}>
                  <td>{t.table}</td>
                  <td className="muted">{t.count.toLocaleString()} row(s)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
