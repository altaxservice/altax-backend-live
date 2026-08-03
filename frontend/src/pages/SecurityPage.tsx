import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Download } from "lucide-react";
import { api, ApiError, resolveFileUrl, getAuthToken } from "../api/client";
import { exportCsv } from "../components/FilterBar";
import { ErrorBanner } from "../components/ErrorBanner";
import { FileDropInput } from "../components/FileDropInput";

interface SecurityUser {
  userId: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  passwordStatus: string;
  passwordStorage: string;
  failedLoginCount: number;
  lockedUntil: string | null;
  lastLogin: string | null;
}
interface SecurityEvent {
  logged_at: string;
  user_email: string;
  action: string;
  record_id: string;
  note: string;
}
interface SecurityOverview {
  summary: { activeUsers: number; lockedAccounts: number; needsSetup: number; totalUsers: number };
  users: SecurityUser[];
  events: SecurityEvent[];
}

function fmtDate(v: string | null): string {
  return v ? new Date(v).toLocaleString() : "Never";
}
function fmtLockedUntil(v: string | null): string {
  return v ? new Date(v).toLocaleString() : "No";
}

export function SecurityPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<SecurityOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<SecurityOverview>("/system/security")
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load security data."));
  }

  useEffect(load, []);

  function handleExport() {
    if (!data) return;
    exportCsv("security.csv", [
      { key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "role", label: "Role" },
      { key: "passwordStatus", label: "Password" }, { key: "passwordStorage", label: "Storage" },
      { key: "failedLoginCount", label: "Failed" }, { key: "lockedUntil", label: "Locked Until" },
      { key: "lastLogin", label: "Last Login" }, { key: "active", label: "Active" },
    ], data.users as unknown as Record<string, unknown>[]);
  }

  if (error) return <ErrorBanner error={error} onRetry={load} />;
  if (!data) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 16 }}>
        <button className="ghost-button" onClick={load}><RefreshCw size={13} strokeWidth={2} aria-hidden="true" />Refresh</button>
        <button className="ghost-button" onClick={handleExport}><Download size={13} strokeWidth={2} aria-hidden="true" />Export CSV</button>
      </div>

      <div className="metric-grid" style={{ marginBottom: 16 }}>
        <div className="metric" style={{ cursor: "pointer" }} role="button" tabIndex={0} onClick={() => navigate("/users")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/users"); } }}><div className="metric-label">Active Users</div><div className="metric-value">{data.summary.activeUsers}</div><div className="metric-note">{data.summary.totalUsers} visible records</div></div>
        <div className="metric" style={{ cursor: "pointer" }} role="button" tabIndex={0} onClick={() => navigate("/users")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/users"); } }}><div className="metric-label">Locked Accounts</div><div className="metric-value">{data.summary.lockedAccounts}</div><div className="metric-note">15 minute lock after failed sign-ins</div></div>
        <div className="metric" style={{ cursor: "pointer" }} role="button" tabIndex={0} onClick={() => navigate("/users")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/users"); } }}><div className="metric-label">Needs Setup</div><div className="metric-value">{data.summary.needsSetup}</div><div className="metric-note">invite, reset, or password setup required</div></div>
        <div className="metric"><div className="metric-label">MFA</div><div className="metric-value" style={{ fontSize: 18 }}>Required</div><div className="metric-note">Admin/Staff: authenticator app · Client/Employee: emailed code</div></div>
      </div>

      <div className="command-panel" style={{ marginBottom: 16 }}>
        <div className="command-panel-header">
          <div>
            <div className="topbar-eyebrow">Security Foundation</div>
            <h2 className="command-panel-title">Portal Security Center</h2>
            <div className="command-panel-note">Review portal account readiness, failed sign-ins, lockouts, and recent security audit events.</div>
          </div>
        </div>
        <p className="muted" style={{ padding: 16 }}>
          Sensitive values stay out of browser data. This page shows status only — not password hashes, salts, invite tokens, vault payloads, portal passwords, PINs, SSNs, or bank account values.
        </p>
        <div style={{ padding: "0 16px 16px", display: "grid", gap: 6, fontSize: 13 }}>
          <div style={{ display: "flex", gap: 8 }}><strong style={{ minWidth: 170 }}>IRS Pub. 4557 access controls</strong><span className="muted">Password, MFA, role-based portals</span></div>
          <div style={{ display: "flex", gap: 8 }}><strong style={{ minWidth: 170 }}>Password storage</strong><span className="muted">Current means salted/versioned storage; legacy upgrades after successful login</span></div>
          <div style={{ display: "flex", gap: 8 }}><strong style={{ minWidth: 170 }}>Lockout policy</strong><span className="muted">5 failed password attempts, 15 minute lock</span></div>
          <div style={{ display: "flex", gap: 8 }}><strong style={{ minWidth: 170 }}>Vault controls</strong><span className="muted">Client secrets excluded from normal data loads and exports</span></div>
        </div>
      </div>

      <BackupSection />

      <div className="command-panel" style={{ marginBottom: 16 }}>
        <div className="command-panel-header"><h2 className="command-panel-title">Portal User Security</h2><div className="command-panel-note">{data.users.length} users</div></div>
        <div style={{ overflowX: "auto" }}>
          <div className="table-scroll">
          <table>
            <thead>
              <tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Password</th><th scope="col">MFA</th><th scope="col">Storage</th><th scope="col">Failed</th><th scope="col">Locked Until</th><th scope="col">Last Login</th><th scope="col">Active</th></tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                // Account management (reset, role, unlock) lives on Users & Access —
                // the row takes you straight to it rather than dead-ending here.
                <tr key={u.userId} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => navigate("/users")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/users"); } }}>
                  <td>{u.name}</td>
                  <td className="muted">{u.email}</td>
                  <td className="muted">{u.role}</td>
                  <td>{u.passwordStatus}</td>
                  {/* Mirrors the server policy in auth.routes.ts: firm-side roles
                      use an authenticator app, client-facing roles get a mailed code. */}
                  <td className="muted">
                    {["admin", "staff"].includes(u.role.toLowerCase()) ? "Authenticator app" : "Email code"}
                  </td>
                  <td className="muted">{u.passwordStorage}</td>
                  <td className="muted">{u.failedLoginCount}</td>
                  <td className="muted">{fmtLockedUntil(u.lockedUntil)}</td>
                  <td className="muted">{fmtDate(u.lastLogin)}</td>
                  <td>{u.active ? "Active" : "Inactive"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      <div className="command-panel">
        <div className="command-panel-header"><h2 className="command-panel-title">Recent Login / Security Events</h2><div className="command-panel-note">{data.events.length} events</div></div>
        <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Time</th><th scope="col">User</th><th scope="col">Action</th><th scope="col">Record</th><th scope="col">Note</th></tr></thead>
          <tbody>
            {data.events.map((e, i) => (
              <tr key={i}>
                <td className="muted">{fmtDate(e.logged_at)}</td>
                <td className="muted">{e.user_email}</td>
                <td>{e.action}</td>
                <td className="muted">{e.record_id}</td>
                <td className="muted">{e.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {data.events.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No security events yet.</p>}
      </div>
    </div>
  );
}

interface BackupSummary {
  tableCount: number;
  totalRows: number;
  databaseSize: string;
  tables: { table: string; rows: number }[];
}

/**
 * Self-service full-data backup.
 *
 * The hosting provider's free tier keeps only about 24 hours of point-in-time
 * history, and the accounting module performs real hard deletes — so a mistake
 * noticed days later cannot be recovered from the provider alone. This gives
 * the firm a copy it holds itself, with no retention limit.
 */
function BackupSection() {
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDownload, setLastDownload] = useState<string | null>(
    () => localStorage.getItem("altax_last_backup") || null
  );

  useEffect(() => {
    api.get<BackupSummary>("/system/backup/summary").then(setSummary).catch(() => setSummary(null));
  }, []);

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      // Plain fetch rather than the JSON api helper: this response is a file
      // attachment, and parsing ~9MB of JSON just to re-serialise it would be
      // wasteful. resolveFileUrl applies the same API base the api client uses —
      // without it this hits the Vite dev server instead of the API and silently
      // returns the HTML shell (which is exactly what it did the first time).
      const res = await fetch(resolveFileUrl("/system/backup/export"), {
        headers: { Authorization: `Bearer ${getAuthToken() || ""}` },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Export failed.");
      const blob = await res.blob();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `altax-nexus-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      const now = new Date().toISOString();
      localStorage.setItem("altax_last_backup", now);
      setLastDownload(now);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message || "Could not download the backup.");
    } finally {
      setDownloading(false);
    }
  }

  const staleDays = lastDownload
    ? Math.floor((Date.now() - new Date(lastDownload).getTime()) / 86400000)
    : null;

  return (
    <div className="command-panel" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <div>
          <h2 className="command-panel-title">Backup &amp; Restore</h2>
          <div className="command-panel-note">
            Download a complete copy of every record — clients, tasks, invoices, accounting, documents and settings.
          </div>
        </div>
      </div>

      <div style={{ padding: 16 }}>
        {error && <ErrorBanner error={error} />}

        {summary && (
          <div className="metric-grid" style={{ marginBottom: 14 }}>
            <div className="metric"><div className="metric-label">Tables</div><div className="metric-value">{summary.tableCount}</div></div>
            <div className="metric"><div className="metric-label">Records</div><div className="metric-value">{summary.totalRows.toLocaleString()}</div></div>
            <div className="metric"><div className="metric-label">Database Size</div><div className="metric-value">{summary.databaseSize}</div></div>
          </div>
        )}

        {(staleDays === null || staleDays >= 7) && (
          <div className="error-banner" style={{ fontSize: 12.5 }}>
            {staleDays === null
              ? "No backup has been downloaded from this browser yet. Take one now and save it somewhere outside the app."
              : `Your last backup from this browser was ${staleDays} days ago. Weekly is a sensible minimum.`}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={handleDownload} disabled={downloading}>
            {downloading ? "Preparing backup…" : "Download Full Backup"}
          </button>
          <EmailBackupNowButton />
          {lastDownload && (
            <span className="muted" style={{ fontSize: 12 }}>
              Last downloaded {new Date(lastDownload).toLocaleString()}
            </span>
          )}
        </div>

        <p className="muted" style={{ fontSize: 11.5, marginTop: 10, marginBottom: 0 }}>
          <strong>Automatic backup is on:</strong> every Sunday at 6:00 AM an encrypted copy is emailed to each admin.
          The attachment cannot be read without the server's backup key — to restore one, just upload it below; the
          server unlocks it automatically.
        </p>

        <p className="muted" style={{ fontSize: 11.5, marginTop: 12, marginBottom: 0 }}>
          The file contains everything, including encrypted vault entries and client tax identifiers — it is only as
          safe as wherever you store it. Keep it somewhere access-controlled (not a shared drive), and keep more than
          one dated copy. Every download is recorded in the audit log.
        </p>

        <RestoreControls onRestored={() => api.get<BackupSummary>("/system/backup/summary").then(setSummary).catch(() => {})} />
      </div>
    </div>
  );
}

function EmailBackupNowButton() {
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function handleSend() {
    setSending(true);
    setNote(null);
    try {
      const res = await api.post<{ sentTo: string[]; totalRows: number; sizeKb: number }>("/system/backup/email-now", {});
      setNote(`Sent to ${res.sentTo.join(", ")} (${res.totalRows.toLocaleString()} records, ${res.sizeKb} KB encrypted).`);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Could not send the backup email.");
    } finally {
      setSending(false);
    }
  }
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" className="btn" onClick={handleSend} disabled={sending}>
        {sending ? "Sending…" : "Email Me a Backup Now"}
      </button>
      {note && <span className="muted" style={{ fontSize: 12 }}>{note}</span>}
    </span>
  );
}

/**
 * Restore is deliberately a multi-step gauntlet: pick the file, read what it
 * actually contains, then type RESTORE. It replaces every record in the
 * database, so a mis-click must never be enough to trigger it.
 */
function RestoreControls({ onRestored }: { onRestored: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ encrypted: boolean; exportedAt: string | null; tableCount: number; totalRows: number } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function handlePick(f: File | null) {
    setFile(f);
    setPreview(null);
    setConfirmText("");
    setError(null);
    setResult(null);
    if (!f) return;
    const text = await f.text();
    // Weekly email attachments are encrypted; the browser can't show their
    // contents, only the server can — the confirm step still applies in full.
    if (text.startsWith("ALTAXBK1")) {
      setPreview({ encrypted: true, exportedAt: null, tableCount: 0, totalRows: 0 });
      return;
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed?.schema !== "altax" || typeof parsed?.data !== "object") {
        setError("That file is not an AL TAX Nexus backup export. Use a file downloaded from Download Full Backup.");
        setFile(null);
        return;
      }
      setPreview({
        encrypted: false,
        exportedAt: parsed.exportedAt || null,
        tableCount: Number(parsed.tableCount) || Object.keys(parsed.data).length,
        totalRows: Number(parsed.totalRows) || 0,
      });
    } catch {
      setError("That file could not be read as a backup — it is not valid JSON.");
      setFile(null);
    }
  }

  async function handleRestore() {
    if (!file) return;
    setRestoring(true);
    setError(null);
    try {
      const res = await fetch(resolveFileUrl(`/system/backup/restore?confirm=${encodeURIComponent(confirmText.trim())}`), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("altax_token") || ""}`,
          "Content-Type": "text/plain",
        },
        body: await file.text(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Restore failed — no data was changed.");
      setResult(
        `Restored ${data.totalRows.toLocaleString()} records across ${data.tablesRestored} tables` +
        (data.backupDate ? ` from the backup taken ${new Date(data.backupDate).toLocaleString()}.` : ".") +
        " Reload the page to see the restored data."
      );
      setFile(null);
      setPreview(null);
      setConfirmText("");
      onRestored();
    } catch (err) {
      setError((err as Error).message || "Could not restore from this file.");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div style={{ borderTop: "1px solid var(--line)", marginTop: 16, paddingTop: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Restore from a backup file</div>
      <p className="muted" style={{ fontSize: 11.5, marginTop: 0 }}>
        Replaces <strong>everything</strong> — every client, task, invoice, paycheck, user account and setting —
        with the contents of the file. Anything entered after the backup was taken is lost. Download a fresh backup
        of the current data first, so you can undo the restore itself. The restore is all-or-nothing: if it fails
        part-way, nothing is changed.
      </p>

      {error && <ErrorBanner error={error} />}
      {result && (
        <div className="card" style={{ borderColor: "var(--teal)", marginBottom: 10, fontSize: 13 }}>{result}</div>
      )}

      <div style={{ marginBottom: 10 }}>
        <FileDropInput file={file} onChange={handlePick} accept="application/json,.json,.enc" />
      </div>

      {preview && (
        <div className="card" style={{ marginBottom: 10, fontSize: 13 }}>
          {preview.encrypted ? (
            <div><strong>Encrypted weekly backup</strong> — the server will unlock and validate it during the restore.</div>
          ) : (
            <>
              <div><strong>Backup taken:</strong> {preview.exportedAt ? new Date(preview.exportedAt).toLocaleString() : "unknown"}</div>
              <div><strong>Contents:</strong> {preview.totalRows.toLocaleString()} records across {preview.tableCount} tables</div>
            </>
          )}
          <div className="field" style={{ marginTop: 10, maxWidth: 320 }}>
            <label htmlFor="security-restore-confirm">Type RESTORE to confirm replacing all current data</label>
            <input id="security-restore-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESTORE" />
          </div>
          <button
            type="button"
            className="btn btn-danger"
            disabled={restoring || confirmText.trim() !== "RESTORE"}
            onClick={handleRestore}
          >
            {restoring ? "Restoring…" : "Replace All Data With This Backup"}
          </button>
        </div>
      )}
    </div>
  );
}
