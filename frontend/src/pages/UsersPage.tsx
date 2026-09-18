import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { EmployeeOption, PortalUser, WebOptions } from "../api/types2";
import { FilterBar, exportCsv } from "../components/FilterBar";
import { ErrorBanner } from "../components/ErrorBanner";
import { useConfirm, usePrompt, useNotify } from "../components/ConfirmProvider";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { StaffScheduleEditor } from "../components/StaffScheduleEditor";
import { US_STATES } from "../utils/clientOptions";

const EMPTY_FORM = {
  userId: "", email: "", name: "", role: "Staff", phone: "", active: true,
  assignedClientId: "", assignedEmployeeId: "", reminderPreference: "Email", bookablePublicly: true, hourlyRate: "",
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
  if (status === "Invite Expired" || status === "Inactive") return "var(--red)";
  if (status === "Needs Invite" || status === "Temp Password") return "var(--teal)";
  return undefined;
}

export function UsersPage() {
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();
  const notify = useNotify();
  const [users, setUsers] = useState<PortalUser[] | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[] | null>(null);
  const [options, setOptions] = useState<WebOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  // Direct owner request, 2026-09-16: "Add User" used to drop straight into one
  // flat form with a 4-option Role dropdown (Admin/Staff/Client/Employee) — the
  // exact "Staff" (firm hire) vs "Employee" (a CLIENT's own worker) mix-up this
  // was built to prevent. Now the first click is a plain Firm/Client fork, and
  // only the roles that make sense for that fork ever appear. null = show the
  // fork; "edit" = editing an existing user, skip the fork and show every role
  // like before (changing an existing account's category isn't this flow's job).
  const [createCategory, setCreateCategory] = useState<"firm" | "client" | "edit" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [inviteInfo, setInviteInfo] = useState<{ userId: string; inviteLink?: string; inviteToken?: string; temporaryPassword?: string; note?: string; inviteEmailed?: boolean; inviteEmailError?: string; email?: string } | null>(null);
  const [preparerEdit, setPreparerEdit] = useState<{ userId: string; name: string; ptin: string; cafNumber: string } | null>(null);
  const [preparerSaving, setPreparerSaving] = useState(false);
  const [preparerError, setPreparerError] = useState<string | null>(null);
  const [scheduleEdit, setScheduleEdit] = useState<{ userId: string; name: string } | null>(null);
  const [rateEdit, setRateEdit] = useState<{ userId: string; name: string; hourlyRate: string } | null>(null);
  const [rateSaving, setRateSaving] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [payrollLinkEdit, setPayrollLinkEdit] = useState<{ userId: string; name: string; state: string } | null>(null);
  const [payrollLinkSaving, setPayrollLinkSaving] = useState(false);
  const [payrollLinkError, setPayrollLinkError] = useState<string | null>(null);

  useEscapeToClose(() => setPreparerEdit(null), Boolean(preparerEdit));
  const preparerPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(preparerPanelRef, Boolean(preparerEdit));
  useEscapeToClose(() => setRateEdit(null), Boolean(rateEdit));
  const ratePanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(ratePanelRef, Boolean(rateEdit));
  useEscapeToClose(() => setPayrollLinkEdit(null), Boolean(payrollLinkEdit));
  const payrollLinkPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(payrollLinkPanelRef, Boolean(payrollLinkEdit));

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
      reminderPreference: u.reminder_preference || "Email", bookablePublicly: u.bookable_publicly,
      hourlyRate: u.hourly_rate != null ? String(u.hourly_rate) : "",
    });
    setShowForm(true);
    setCreateCategory("edit");
    setInviteInfo(null);
    setSaveError(null);
  }

  function startCreate() {
    setForm(EMPTY_FORM);
    setShowForm(true);
    setCreateCategory(null);
    setInviteInfo(null);
    setSaveError(null);
  }

  function chooseCategory(category: "firm" | "client") {
    setCreateCategory(category);
    setForm((f) => ({ ...f, role: category === "firm" ? "Staff" : "Client" }));
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
    const ok = await confirmDialog({ title: "Deactivate user", message: "Deactivate this portal user?", confirmLabel: "Deactivate", danger: true });
    if (!ok) return;
    try {
      const result = await api.post<{ openAssignedTasks: number; assignedActiveClients: number }>(`/users/${userId}/deactivate`, {});
      load();
      // Deactivating never reassigns their open work — this is the one moment
      // an admin can actually act on it, so surface what's still theirs instead
      // of leaving it invisible until someone notices later.
      if (result.openAssignedTasks > 0 || result.assignedActiveClients > 0) {
        const parts: string[] = [];
        if (result.openAssignedTasks > 0) parts.push(`${result.openAssignedTasks} open task${result.openAssignedTasks === 1 ? "" : "s"}`);
        if (result.assignedActiveClients > 0) parts.push(`${result.assignedActiveClients} active client${result.assignedActiveClients === 1 ? "" : "s"}`);
        await notify(`This user still has ${parts.join(" and ")} assigned to them. Reassign these from the Tasks and Clients pages.`);
      }
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not deactivate this user.");
    }
  }

  async function handleSavePreparerInfo(e: FormEvent) {
    e.preventDefault();
    if (!preparerEdit) return;
    setPreparerSaving(true);
    setPreparerError(null);
    try {
      await api.post(`/users/${preparerEdit.userId}/preparer-info`, { ptin: preparerEdit.ptin, cafNumber: preparerEdit.cafNumber });
      setPreparerEdit(null);
      load();
    } catch (err) {
      setPreparerError(err instanceof ApiError ? err.message : "Could not save this preparer info.");
    } finally {
      setPreparerSaving(false);
    }
  }

  function openScheduleEdit(u: PortalUser) {
    setScheduleEdit({ userId: u.user_id, name: u.name });
  }

  async function handleSaveRate(e: FormEvent) {
    e.preventDefault();
    if (!rateEdit) return;
    setRateSaving(true);
    setRateError(null);
    try {
      await api.post(`/users/${rateEdit.userId}/hourly-rate`, { hourlyRate: rateEdit.hourlyRate.trim() || undefined });
      setRateEdit(null);
      load();
    } catch (err) {
      setRateError(err instanceof ApiError ? err.message : "Could not save this rate.");
    } finally {
      setRateSaving(false);
    }
  }

  async function handleSavePayrollLink(e: FormEvent) {
    e.preventDefault();
    if (!payrollLinkEdit) return;
    setPayrollLinkSaving(true);
    setPayrollLinkError(null);
    try {
      await api.post(`/users/${payrollLinkEdit.userId}/link-payroll`, { state: payrollLinkEdit.state.trim() });
      setPayrollLinkEdit(null);
      load();
    } catch (err) {
      setPayrollLinkError(err instanceof ApiError ? err.message : "Could not link this person to payroll.");
    } finally {
      setPayrollLinkSaving(false);
    }
  }

  async function handleAction(userId: string, action: string) {
    if (!action) return;
    try {
      if (action === "resend-invite") {
        const res = await api.post<{ userId: string; inviteLink?: string; generatedNewToken: boolean; inviteEmailed?: boolean; inviteEmailError?: string }>(`/users/${userId}/resend-invite`, {});
        setInviteInfo({ ...res, note: res.generatedNewToken ? "A new invite link was issued." : "The existing invite link is still valid." });
      } else if (action === "reset-invite") {
        const ok = await confirmDialog({ title: "Reset invite", message: "This clears their current password and they must set a new one." });
        if (!ok) return;
        const res = await api.post<{ userId: string; inviteLink?: string; inviteEmailed?: boolean; inviteEmailError?: string }>(`/users/${userId}/reset-invite`, {});
        setInviteInfo({ ...res, note: "Password was cleared." });
      } else if (action === "temp-password") {
        const res = await api.post<{ userId: string; temporaryPassword: string }>(`/users/${userId}/temporary-password`, {});
        setInviteInfo({ ...res, note: "Share this temporary password. They'll be asked to change it after signing in." });
      } else if (action === "reset-2fa") {
        // The recovery path for a lost/replaced phone. Safe because 2FA is
        // mandatory: clearing it forces fresh enrollment at the next sign-in
        // rather than leaving the account with password-only access.
        const ok = await confirmDialog({ title: "Reset two-factor authentication", message: "Their current authenticator will stop working and they'll be asked to set up a new one the next time they sign in." });
        if (!ok) return;
        await api.post(`/users/${userId}/2fa/reset`, {});
        await notify("Two-factor authentication reset. The user will set up a new authenticator at their next sign-in.");
      }
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not complete this action.");
    }
  }

  async function handleDelete(userId: string, name: string) {
    const confirmValue = await promptFor({
      title: "Permanently delete user",
      message: `"${name}" — this cannot be undone. Type DELETE USER to confirm.`,
      placeholder: "DELETE USER",
    });
    if (confirmValue === null) return;
    try {
      await api.post(`/users/${userId}/delete`, { confirm: confirmValue });
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this user.");
    }
  }

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users || []).filter((u) => {
      if (roleFilter !== "all" && u.role.toLowerCase() !== roleFilter.toLowerCase()) return false;
      if (statusFilter === "Active" && !u.active) return false;
      if (statusFilter === "Inactive" && u.active) return false;
      if (q && ![u.name, u.email, u.role].some((v) => String(v || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [users, roleFilter, statusFilter, search]);

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
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={startCreate}>Add User</button>
      </div>

      <div className="portal-banner" style={{ marginBottom: 16 }}>
        <div className="topbar-eyebrow">Users &amp; Access Center</div>
        <h2>Users & Access Control</h2>
        <p>Create portal users, send setup invites, reset tokens, issue temporary passwords, and review account access from one place.</p>
      </div>

      <div className="card" style={{ marginBottom: 16, borderColor: "var(--teal)", fontSize: 13 }}>
        Invite email sends a setup token. Temporary passwords force password change after login. Client and employee users should be tied to the correct record before saving.
      </div>

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Name, email, role…" }}
        selects={[
          { label: "Role", value: roleFilter, options: ROLE_FILTER_OPTIONS, onChange: setRoleFilter },
          { label: "Status", value: statusFilter, options: STATUS_FILTER_OPTIONS, onChange: setStatusFilter },
        ]}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        onExportCsv={handleExport}
      />

      {error && <ErrorBanner error={error} />}

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

      {preparerEdit && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setPreparerEdit(null))(); }}>
          <div ref={preparerPanelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="ptin-caf-title" style={{ width: "min(380px, 100%)" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="ptin-caf-title">PTIN / CAF — {preparerEdit.name}</h2>
              <button className="btn btn-sm" onClick={() => setPreparerEdit(null)}>Close</button>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
              {preparerEdit.name} can also set this themselves from their own account menu — use this only if they
              haven't yet.
            </p>
            <form onSubmit={handleSavePreparerInfo}>
              {preparerError && <ErrorBanner error={preparerError} />}
              <div className="field">
                <label htmlFor="pi-ptin">PTIN</label>
                <input id="pi-ptin" placeholder="P12345678" value={preparerEdit.ptin} onChange={(e) => setPreparerEdit((p) => p && { ...p, ptin: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="pi-caf">CAF Number</label>
                <input id="pi-caf" value={preparerEdit.cafNumber} onChange={(e) => setPreparerEdit((p) => p && { ...p, cafNumber: e.target.value })} />
              </div>
              <button type="submit" className="btn btn-primary" disabled={preparerSaving}>{preparerSaving ? "Saving…" : "Save"}</button>
            </form>
          </div>
        </div>
      )}

      {rateEdit && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setRateEdit(null))(); }}>
          <div ref={ratePanelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="rate-title" style={{ width: "min(380px, 100%)" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="rate-title">Hourly Rate — {rateEdit.name}</h2>
              <button className="btn btn-sm" onClick={() => setRateEdit(null)}>Close</button>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
              What the firm pays {rateEdit.name} per hour worked — shown as estimated pay on Time Tracking's Hours by Staff.
              Separate from any client-billable rate, and only visible to admins.
            </p>
            <form onSubmit={handleSaveRate}>
              {rateError && <ErrorBanner error={rateError} />}
              <div className="field">
                <label htmlFor="rt-rate">Rate/hr</label>
                <input id="rt-rate" type="number" step="0.01" min="0" placeholder="Leave blank to hide estimated pay" value={rateEdit.hourlyRate} onChange={(e) => setRateEdit((r) => r && { ...r, hourlyRate: e.target.value })} />
              </div>
              <button type="submit" className="btn btn-primary" disabled={rateSaving}>{rateSaving ? "Saving…" : "Save"}</button>
            </form>
          </div>
        </div>
      )}

      {payrollLinkEdit && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (() => setPayrollLinkEdit(null))(); }}>
          <div ref={payrollLinkPanelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="payroll-link-title" style={{ width: "min(420px, 100%)" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="payroll-link-title">Link to Payroll — {payrollLinkEdit.name}</h2>
              <button className="btn btn-sm" onClick={() => setPayrollLinkEdit(null)}>Close</button>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
              Creates a bare payroll employee record for {payrollLinkEdit.name} under the firm's own client account, so Time
              Tracking's hours can export into a real paycheck. Just name and state for now — SSN, W-4, and address still
              need to be filled in from that employee's own page before their first real paycheck.
            </p>
            <form onSubmit={handleSavePayrollLink}>
              {payrollLinkError && <ErrorBanner error={payrollLinkError} />}
              <div className="field">
                <label htmlFor="pl-state">Work State</label>
                <select id="pl-state" value={payrollLinkEdit.state} onChange={(e) => setPayrollLinkEdit((p) => p && { ...p, state: e.target.value })}>
                  {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <button type="submit" className="btn btn-primary" disabled={payrollLinkSaving}>{payrollLinkSaving ? "Linking…" : "Link to Payroll"}</button>
            </form>
          </div>
        </div>
      )}

      {scheduleEdit && (
        <StaffScheduleEditor userId={scheduleEdit.userId} name={scheduleEdit.name} onClose={() => setScheduleEdit(null)} onSaved={load} />
      )}

      {showForm && createCategory === null && (
        <div className="card" style={{ maxWidth: 480, marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>New User</h2>
          <p className="muted" style={{ fontSize: 12.5, margin: "0 0 16px" }}>Who is this account for?</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button" onClick={() => chooseCategory("firm")}
              style={{
                flex: "1 1 180px", padding: "16px 14px", textAlign: "left", cursor: "pointer",
                background: "var(--teal-soft)", border: "1px solid var(--teal)", borderLeft: "4px solid var(--teal)", borderRadius: 8,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--teal)" }}>Firm User</div>
              <div className="muted" style={{ fontSize: 12 }}>Someone who works AT AL TAX SERVICE — Admin or Staff.</div>
            </button>
            <button
              type="button" onClick={() => chooseCategory("client")}
              style={{
                flex: "1 1 180px", padding: "16px 14px", textAlign: "left", cursor: "pointer",
                background: "var(--blue-soft)", border: "1px solid var(--blue)", borderLeft: "4px solid var(--blue)", borderRadius: 8,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--blue)" }}>Client User</div>
              <div className="muted" style={{ fontSize: 12 }}>A client business's own login, or a login for one of their employees.</div>
            </button>
          </div>
          <button type="button" className="btn" style={{ marginTop: 14 }} onClick={() => setShowForm(false)}>Cancel</button>
        </div>
      )}

      {showForm && createCategory !== null && (
        <form onSubmit={handleSave} className="card" style={{ maxWidth: 480, marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            {createCategory !== "edit" && (
              <button type="button" className="btn btn-sm" onClick={() => setCreateCategory(null)}>&larr; Back</button>
            )}
            <h2 style={{ fontSize: 15, margin: 0 }}>
              {form.userId ? "Edit User" : createCategory === "firm" ? "New Firm User" : "New Client User"}
            </h2>
          </div>
          {saveError && <ErrorBanner error={saveError} />}
          <div className="field">
            <label htmlFor="u-id">User ID</label>
            <input id="u-id" disabled value={form.userId || "Auto"} style={{ color: "var(--muted)" }} />
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
              {(createCategory === "edit" || createCategory === "firm") && <option value="Admin">Admin — firm owner/manager</option>}
              {(createCategory === "edit" || createCategory === "firm") && <option value="Staff">Staff — a person you hire to work at the firm</option>}
              {(createCategory === "edit" || createCategory === "client") && <option value="Client">Client — a business the firm serves</option>}
              {(createCategory === "edit" || createCategory === "client") && <option value="Employee">Employee — belongs to a CLIENT, not the firm</option>}
            </select>
            {/* Direct owner concern, 2026-09-16: "Staff" (a firm hire) and
                "Employee" (a client business's own worker, e.g. their payroll
                self-service login) sound alike but are unrelated — the Firm/Client
                fork above keeps them from ever appearing in the same dropdown, and
                this confirms it again once a role is picked, before Save is even
                reachable. */}
            {form.role === "Staff" && (
              <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                This creates a firm team member's own login (Users &amp; Access, task assignment, etc.) — for hiring a new employee of AL TAX SERVICE.
              </p>
            )}
            {form.role === "Employee" && (
              <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                This creates a payroll/document self-service login for someone who works for one of your CLIENTS — not a firm hire. If you're adding a new staff member to AL TAX SERVICE itself, pick "Staff" instead.
              </p>
            )}
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
              <option value="None">None</option>
            </select>
          </div>
          <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input id="u-active" type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} style={{ width: "auto" }} />
            <label htmlFor="u-active" style={{ textTransform: "none", fontSize: 13 }}>Active</label>
          </div>
          {(form.role === "Admin" || form.role === "Staff") && (
            <div className="field">
              <label htmlFor="u-hourly-rate">Hourly Work Rate</label>
              <input
                id="u-hourly-rate" type="number" step="0.01" min="0" placeholder="Leave blank to hide estimated pay"
                value={form.hourlyRate} onChange={(e) => setForm((f) => ({ ...f, hourlyRate: e.target.value }))}
              />
              <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                What the firm pays this person per hour — shown as estimated/gross pay on Time Tracking. Separate from any
                client-billable rate, and only visible to admins.
              </p>
            </div>
          )}
          {(form.role === "Admin" || form.role === "Staff") && (
            <div className="field">
              <div style={{ flexDirection: "row", alignItems: "center", gap: 8, display: "flex" }}>
                <input
                  id="u-bookable" type="checkbox" checked={form.bookablePublicly}
                  onChange={(e) => setForm((f) => ({ ...f, bookablePublicly: e.target.checked }))} style={{ width: "auto" }}
                />
                <label htmlFor="u-bookable" style={{ textTransform: "none", fontSize: 13 }}>Bookable on the public appointment scheduler</label>
              </div>
              <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                Uncheck this for a shared/system login (like a general firm inbox account) that isn't a real person a client should be able to "meet with."
              </p>
            </div>
          )}
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
          <UserGroup
            title="Firm Users (Admin & Staff)" users={filteredUsers.filter((u) => ["admin", "staff"].includes(u.role.toLowerCase()))}
            onEdit={startEdit} onDeactivate={handleDeactivate} onAction={handleAction} onDelete={handleDelete}
            onEditPreparer={(u) => setPreparerEdit({ userId: u.user_id, name: u.name, ptin: u.ptin || "", cafNumber: u.caf_number || "" })}
            onEditSchedule={openScheduleEdit}
            onEditRate={(u) => setRateEdit({ userId: u.user_id, name: u.name, hourlyRate: u.hourly_rate != null ? String(u.hourly_rate) : "" })}
            onLinkPayroll={(u) => setPayrollLinkEdit({ userId: u.user_id, name: u.name, state: "MD" })}
          />
          <UserGroup title="Client Users (Portal Access)" users={filteredUsers.filter((u) => u.role.toLowerCase() === "client")} onEdit={startEdit} onDeactivate={handleDeactivate} onAction={handleAction} onDelete={handleDelete} />
          <UserGroup title="Employee Users (Belong to a Client, Not the Firm)" users={filteredUsers.filter((u) => u.role.toLowerCase() === "employee")} onEdit={startEdit} onDeactivate={handleDeactivate} onAction={handleAction} onDelete={handleDelete} />
        </div>
      )}
    </div>
  );
}

function UserGroup({ title, users, onEdit, onDeactivate, onAction, onDelete, onEditPreparer, onEditSchedule, onEditRate, onLinkPayroll }: { title: string; users: PortalUser[]; onEdit: (u: PortalUser) => void; onDeactivate: (id: string) => void; onAction: (id: string, action: string) => void; onDelete: (id: string, name: string) => void; onEditPreparer?: (u: PortalUser) => void; onEditSchedule?: (u: PortalUser) => void; onEditRate?: (u: PortalUser) => void; onLinkPayroll?: (u: PortalUser) => void }) {
  if (users.length === 0) return null;
  return (
    <div className="command-panel">
      <div className="command-panel-header"><h2 className="command-panel-title">{title}</h2><div className="command-panel-note">{users.length} users</div></div>
      <div style={{ overflowX: "auto" }}>
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {/* Email sits under Name and Assignment under Role — as 10 columns
                  this ran off the right edge at 100% zoom. */}
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              <th scope="col">Invite</th>
              <th scope="col">Last Login</th>
              <th scope="col">Active</th>
              <th scope="col">Open</th>
              <th scope="col">Overdue</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const status = inviteStatus(u);
              return (
                <tr key={u.user_id}>
                  <td onClick={() => onEdit(u)}>
                    <div>{u.name}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{u.email}</div>
                  </td>
                  <td onClick={() => onEdit(u)}>
                    <span className="badge">{u.role}</span>
                    <div className="muted" style={{ fontSize: 11 }}>{u.assignment_label || "Firm-wide"}</div>
                  </td>
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
                        else if (v === "preparer-info") onEditPreparer?.(u);
                        else if (v === "schedule") onEditSchedule?.(u);
                        else if (v === "hourly-rate") onEditRate?.(u);
                        else if (v === "link-payroll") onLinkPayroll?.(u);
                        else onAction(u.user_id, v);
                      }}
                      style={{ padding: "5px 8px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", fontSize: 12 }}
                    >
                      <option value="">Actions…</option>
                      <option value="resend-invite">Resend Invite</option>
                      <option value="reset-invite">Reset Invite</option>
                      <option value="temp-password">Set Temporary Password</option>
                      <option value="reset-2fa">Reset 2FA (lost phone)</option>
                      {/* Firm users only (this action isn't offered on the Client/Employee
                          groups, which don't pass onEditPreparer) — PTIN/CAF are IRS
                          preparer credentials, meaningless for a client or employee portal
                          account. Each admin/staff can also set their own from the account
                          menu (top right) without needing this admin path at all. */}
                      {onEditPreparer && <option value="preparer-info">Edit PTIN / CAF Number</option>}
                      {/* Firm users only, same reasoning — a client/employee portal account never takes appointments. */}
                      {onEditSchedule && <option value="schedule">Working Hours</option>}
                      {/* Firm users only — compensation, meaningless for a client/employee portal account. Admin-only, unlike PTIN/CAF above; this isn't something the person sets for themselves. */}
                      {onEditRate && <option value="hourly-rate">Hourly Rate</option>}
                      {/* Firm users only — one-time setup so Time Tracking can export their hours into a real paycheck. A no-op once already linked. */}
                      {onLinkPayroll && <option value="link-payroll">{u.payroll_employee_id ? "Linked to Payroll ✓" : "Link to Payroll"}</option>}
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
    </div>
  );
}
