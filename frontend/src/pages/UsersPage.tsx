import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { EmployeeOption, PortalUser, WebOptions } from "../api/types2";
import { FilterBar, exportCsv } from "../components/FilterBar";

const EMPTY_FORM = {
  userId: "", email: "", name: "", role: "Staff", phone: "", active: true,
  assignedClientId: "", assignedEmployeeId: "", reminderPreference: "Email",
};

const ROLE_FILTER_OPTIONS = ["Admin", "Staff", "Client", "Employee"];
const STATUS_FILTER_OPTIONS = ["Active", "Inactive"];

function inviteStatus(u: PortalUser): string {
  if (!u.active) return "Inactive";
  if (u.has_pending_invite) {
    if (u.invite_expires && new Date(u.invite_expires).getTime() < Date.now()) return "Invite Expired";
    return "Invited";
  }
  if (u.must_reset_password) return "Temp Password";
  if (u.last_login) return "Ready";
  return "Needs Invite";
}

function inviteStatusColor(status: string): string | undefined {
  if (status === "Invite Expired" || status === "Inactive") return "var(--danger, #cf222e)";
  if (status === "Needs Invite" || status === "Temp Password") return "var(--teal)";
  return undefined;
}

export function UsersPage() {
  const [users, setUsers] = useState<PortalUser[] | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[] | null>(null);
  const [options, setOptions] = useState<WebOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [inviteInfo, setInviteInfo] = useState<{ userId: string; inviteLink?: string; inviteToken?: string; temporaryPassword?: string; note?: string; inviteEmailed?: boolean; inviteEmailError?: string; email?: string } | null>(null);

  function load(): Promise<void> {
    return api.get<{ users: PortalUser[] }>("/users")
      .then((res) => setUsers(res.users))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load users."));
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { api.get<WebOptions>("/system/options").then(setOptions).catch(() => {}); }, []);
  useEffect(() => {
    api.get<{ employees: EmployeeOption[] }>("/accounting/employees").then((res) => setEmployees(res.employees)).catch(() => setEmployees([]));
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  function startEdit(u: PortalUser) {
    setForm({
      userId: u.user_id, email: u.email, name: u.name, role: u.role, phone: u.phone || "", active: u.active,
      assignedClientId: u.assigned_client_id || "", assignedEmployeeId: u.assigned_employee_id || "",
      reminderPreference: u.reminder_preference || "Email",
    });
    setShowForm(true);
    setInviteInfo(null);
    setSaveError(null);
  }

  function startCreate() {
    setForm(EMPTY_FORM);
    setShowForm(true);
    setInviteInfo(null);
    setSaveError(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (form.role === "Client" && !form.assignedClientId) {
      setSaveError("Choose which client this portal user belongs to.");
      return;
    }
    if (form.role === "Employee" && !form.assignedEmployeeId) {
      setSaveError("Choose which employee this portal user belongs to.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.post<{ userId: string; inviteLink?: string; inviteToken?: string; inviteEmailed?: boolean; inviteEmailError?: string }>("/users", form);
      setShowForm(false);
      if (res.inviteToken) setInviteInfo({ ...res, email: form.email });
      load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save this user.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(userId: string) {
    if (!confirm("Deactivate this portal user?")) return;
    try {
      await api.post(`/users/${userId}/deactivate`, {});
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not deactivate this user.");
    }
  }

  async function handleAction(userId: string, action: string) {
    if (!action) return;
    try {
      if (action === "resend-invite") {
        const res = await api.post<{ userId: string; inviteLink?: string; generatedNewToken: boolean; inviteEmailed?: boolean; inviteEmailError?: string }>(`/users/${userId}/resend-invite`, {});
        setInviteInfo({ ...res, note: res.generatedNewToken ? "A new invite link was issued." : "The existing invite link is still valid." });
      } else if (action === "reset-invite") {
        if (!confirm("Reset this user's invite? This clears their current password and they must set a new one.")) return;
        const res = await api.post<{ userId: string; inviteLink?: string; inviteEmailed?: boolean; inviteEmailError?: string }>(`/users/${userId}/reset-invite`, {});
        setInviteInfo({ ...res, note: "Password was cleared." });
      } else if (action === "temp-password") {
        const res = await api.post<{ userId: string; temporaryPassword: string }>(`/users/${userId}/temporary-password`, {});
        setInviteInfo({ ...res, note: "Share this temporary password. They'll be asked to change it after signing in." });
      }
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not complete this action.");
    }
  }

  async function handleDelete(userId: string, name: string) {
    const confirmValue = prompt(`Permanently delete "${name}"? This cannot be undone. Type DELETE USER to confirm.`);
    if (confirmValue === null) return;
    try {
      await api.post(`/users/${userId}/delete`, { confirm: confirmValue });
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not delete this user.");
    }
  }

  const filteredUsers = useMemo(() => {
    return (users || []).filter((u) => {
      if (roleFilter !== "all" && u.role.toLowerCase() !== roleFilter.toLowerCase()) return false;
      if (statusFilter === "Active" && !u.active) return false;
      if (statusFilter === "Inactive" && u.active) return false;
      return true;
    });
  }, [users, roleFilter, statusFilter]);

  function handleExport() {
    exportCsv("portal-users.csv", [
      { key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "role", label: "Role" },
      { key: "assignment_label", label: "Assignment" }, { key: "active", label: "Active" },
      { key: "open_count", label: "Open" }, { key: "overdue_count", label: "Overdue" },
    ], filteredUsers as unknown as Record<string, unknown>[]);
  }

  const employeeOptions = employees || [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Portal Access</h1>
        <button className="btn btn-primary" onClick={startCreate}>Add User</button>
      </div>

      <div className="portal-banner" style={{ marginBottom: 16 }}>
        <div className="topbar-eyebrow">Portal Access Center</div>
        <h2>Users & Access Control</h2>
        <p>Create portal users, send setup invites, reset tokens, issue temporary passwords, and review account access from one place.</p>
      </div>

      <div className="card" style={{ marginBottom: 16, borderColor: "var(--teal)", fontSize: 13 }}>
        Invite email sends a setup token. Temporary passwords force password change after login. Client and employee users should be tied to the correct record before saving.
      </div>

      <FilterBar
        selects={[
          { label: "Role", value: roleFilter, options: ROLE_FILTER_OPTIONS, onChange: setRoleFilter },
          { label: "Status", value: statusFilter, options: STATUS_FILTER_OPTIONS, onChange: setStatusFilter },
        ]}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        onExportCsv={handleExport}
      />

      {error && <div className="error-banner">{error}</div>}

      {inviteInfo && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--teal)" }}>
          <strong>{inviteInfo.note || `Invite created for ${inviteInfo.userId}.`}</strong>{" "}
          {inviteInfo.temporaryPassword ? (
            "Temporary passwords are never emailed — copy this and share it yourself:"
          ) : inviteInfo.inviteEmailed ? (
            `Emailed to ${inviteInfo.email || "the user"}.`
          ) : (
            <>{inviteInfo.inviteEmailError ? `Email not sent: ${inviteInfo.inviteEmailError}` : "Email not sent."} Copy this link and send it to them yourself:</>
          )}
          {(inviteInfo.temporaryPassword || !inviteInfo.inviteEmailed) && (
            <div style={{ marginTop: 8, wordBreak: "break-all", fontFamily: "monospace", fontSize: 12 }}>
              {inviteInfo.temporaryPassword
                ? `Temporary password: ${inviteInfo.temporaryPassword}`
                : inviteInfo.inviteLink || `Token: ${inviteInfo.inviteToken}`}
            </div>
          )}
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setInviteInfo(null)}>Dismiss</button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSave} className="card" style={{ maxWidth: 480, marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>{form.userId ? "Edit User" : "New User"}</h2>
          {saveError && <div className="error-banner">{saveError}</div>}
          <div className="field">
            <label htmlFor="u-id">User ID</label>
            <input id="u-id" disabled value={form.userId || "Auto"} style={{ color: "var(--muted, #6b7280)" }} />
          </div>
          <div className="field">
            <label htmlFor="u-name">Name</label>
            <input id="u-name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="u-email">Email</label>
            <input id="u-email" type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="u-role">Role</label>
            <select id="u-role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
              <option value="Admin">Admin</option>
              <option value="Staff">Staff</option>
              <option value="Client">Client</option>
              <option value="Employee">Employee</option>
            </select>
          </div>
          {form.role === "Client" && (
            <div className="field">
              <label htmlFor="u-client">Assigned Client</label>
              <select id="u-client" required value={form.assignedClientId} onChange={(e) => setForm((f) => ({ ...f, assignedClientId: e.target.value }))}>
                <option value="">Choose a client…</option>
                {(options?.clients || []).map((c) => <option key={c.clientId} value={c.clientId}>{c.clientName} ({c.clientId})</option>)}
              </select>
            </div>
          )}
          {form.role === "Employee" && (
            <div className="field">
              <label htmlFor="u-employee">Assigned Employee</label>
              <select id="u-employee" required value={form.assignedEmployeeId} onChange={(e) => setForm((f) => ({ ...f, assignedEmployeeId: e.target.value }))}>
                <option value="">Choose an employee…</option>
                {employeeOptions.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.employee_name} ({e.client_name})</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="u-phone">Phone</label>
            <input id="u-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="u-reminder">Reminder Preference</label>
            <select id="u-reminder" value={form.reminderPreference} onChange={(e) => setForm((f) => ({ ...f, reminderPreference: e.target.value }))}>
              <option value="Email">Email</option>
              <option value="SMS">SMS</option>
              <option value="Both">Both</option>
              <option value="None">None</option>
            </select>
          </div>
          <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input id="u-active" type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} style={{ width: "auto" }} />
            <label htmlFor="u-active" style={{ textTransform: "none", fontSize: 13 }}>Active</label>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>Saving a portal user does not send an invite by itself if one is already pending — use Resend Invite from the row Actions menu when you're ready.</p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            <button type="button" className="btn" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {!users && !error && <div className="spinner-wrap">Loading…</div>}

      {users && (
        <div style={{ display: "grid", gap: 16 }}>
          <UserGroup title="Firm Users" users={filteredUsers.filter((u) => ["admin", "staff"].includes(u.role.toLowerCase()))} onEdit={startEdit} onDeactivate={handleDeactivate} onAction={handleAction} onDelete={handleDelete} />
          <UserGroup title="Client Users" users={filteredUsers.filter((u) => u.role.toLowerCase() === "client")} onEdit={startEdit} onDeactivate={handleDeactivate} onAction={handleAction} onDelete={handleDelete} />
          <UserGroup title="Employee Users" users={filteredUsers.filter((u) => u.role.toLowerCase() === "employee")} onEdit={startEdit} onDeactivate={handleDeactivate} onAction={handleAction} onDelete={handleDelete} />
        </div>
      )}
    </div>
  );
}

function UserGroup({ title, users, onEdit, onDeactivate, onAction, onDelete }: { title: string; users: PortalUser[]; onEdit: (u: PortalUser) => void; onDeactivate: (id: string) => void; onAction: (id: string, action: string) => void; onDelete: (id: string, name: string) => void }) {
  if (users.length === 0) return null;
  return (
    <div className="command-panel">
      <div className="command-panel-header"><h2 className="command-panel-title">{title}</h2><div className="command-panel-note">{users.length} users</div></div>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Assignment</th>
              <th>Invite</th>
              <th>Last Login</th>
              <th>Active</th>
              <th>Open</th>
              <th>Overdue</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const status = inviteStatus(u);
              return (
                <tr key={u.user_id}>
                  <td onClick={() => onEdit(u)}>{u.name}</td>
                  <td className="muted" onClick={() => onEdit(u)}>{u.email}</td>
                  <td onClick={() => onEdit(u)}><span className="badge">{u.role}</span></td>
                  <td className="muted" onClick={() => onEdit(u)}>{u.assignment_label || "Firm-wide"}</td>
                  <td onClick={() => onEdit(u)} style={{ color: inviteStatusColor(status), fontWeight: inviteStatusColor(status) ? 600 : undefined }}>{status}</td>
                  <td className="muted" onClick={() => onEdit(u)}>{u.last_login ? new Date(u.last_login).toLocaleString() : "Never"}</td>
                  <td onClick={() => onEdit(u)}>{u.active ? "Yes" : "No"}</td>
                  <td className="muted" onClick={() => onEdit(u)}>{u.open_count ?? 0}</td>
                  <td className="muted" onClick={() => onEdit(u)}>{u.overdue_count ?? 0}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <select
                      value=""
                      onChange={(e) => {
                        const v = e.target.value;
                        e.target.value = "";
                        if (v === "delete-user") onDelete(u.user_id, u.name);
                        else onAction(u.user_id, v);
                      }}
                      style={{ padding: "5px 8px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", fontSize: 12 }}
                    >
                      <option value="">Actions…</option>
                      <option value="resend-invite">Resend Invite</option>
                      <option value="reset-invite">Reset Invite</option>
                      <option value="temp-password">Set Temporary Password</option>
                      <option value="delete-user">Delete User</option>
                    </select>
                    {u.active && <button className="btn btn-sm btn-danger" onClick={() => onDeactivate(u.user_id)}>Deactivate</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
