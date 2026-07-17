import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { exportCsv } from "../components/FilterBar";

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

  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 16 }}>
        <button className="btn" onClick={load}>Refresh</button>
        <button className="btn" onClick={handleExport}>Export CSV</button>
      </div>

      <div className="metric-grid" style={{ marginBottom: 16 }}>
        <div className="metric"><div className="metric-label">Active Users</div><div className="metric-value">{data.summary.activeUsers}</div><div className="metric-note">{data.summary.totalUsers} visible records</div></div>
        <div className="metric"><div className="metric-label">Locked Accounts</div><div className="metric-value">{data.summary.lockedAccounts}</div><div className="metric-note">15 minute lock after failed sign-ins</div></div>
        <div className="metric"><div className="metric-label">Needs Setup</div><div className="metric-value">{data.summary.needsSetup}</div><div className="metric-note">invite, reset, or password setup required</div></div>
        <div className="metric"><div className="metric-label">MFA</div><div className="metric-value" style={{ fontSize: 18 }}>Email</div><div className="metric-note">code challenge after password</div></div>
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

      <div className="command-panel" style={{ marginBottom: 16 }}>
        <div className="command-panel-header"><h2 className="command-panel-title">Portal User Security</h2><div className="command-panel-note">{data.users.length} users</div></div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Password</th><th>MFA</th><th>Storage</th><th>Failed</th><th>Locked Until</th><th>Last Login</th><th>Active</th></tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.userId}>
                  <td>{u.name}</td>
                  <td className="muted">{u.email}</td>
                  <td className="muted">{u.role}</td>
                  <td>{u.passwordStatus}</td>
                  <td className="muted">Email Code</td>
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

      <div className="command-panel">
        <div className="command-panel-header"><h2 className="command-panel-title">Recent Login / Security Events</h2><div className="command-panel-note">{data.events.length} events</div></div>
        <table>
          <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Record</th><th>Note</th></tr></thead>
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
        {data.events.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No security events yet.</p>}
      </div>
    </div>
  );
}
