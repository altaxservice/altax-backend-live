import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Client } from "../api/types";
import type { PortalUser } from "../api/types2";
import { StatusBadge } from "../components/StatusBadge";
import { useSelectedClient } from "../context/SelectedClientContext";
import { useAuth } from "../auth/AuthContext";
import { ActionMenu, type ActionMenuOption } from "../components/ActionMenu";
import { FilterBar, exportCsv } from "../components/FilterBar";
import { useToast } from "../components/Toast";
import { US_STATES, ENTITY_TYPES, SERVICE_TYPES, FIRM_SERVICES, FREQ_OPTIONS, PAYROLL_FREQS, RETURN_TYPES, LANGUAGES, CONTACT_PREFS } from "../utils/clientOptions";
import { AddressFields } from "../components/AddressFields";

const EMPTY_CLIENT_FORM = {
  clientName: "", status: "Active", clientType: "Business", entityType: "", state: "", serviceType: "", services: [] as string[],
  salesTaxFrequency: "", payrollEnabled: false, payrollFrequency: "", payrollSystem: "", eftpsEnabled: false,
  mdWithholdingFrequency: "", mduiEnabled: false, mdAnnualReportEnabled: false, businessReturnType: "", w21099Enabled: false,
  assignedTo: "", email: "", phone: "", streetAddress: "", city: "", zipCode: "",
  preferredLanguage: "English", smsAllowed: false, emailAllowed: true, preferredContact: "Email",
  ein: "", stateTaxId: "", secretaryOfStateId: "", companyContactName: "", companyContactTitle: "", companyContactSsn: "", individualSsn: "", notes: "",
};

const QUICK_TABS: { key: string; label: string; test: (c: Client) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "active", label: "Active", test: (c) => String(c.status || "").toLowerCase() === "active" },
  { key: "business", label: "Business", test: (c) => String(c.client_type || "").toLowerCase() === "business" },
  { key: "individual", label: "Individual", test: (c) => String(c.client_type || "").toLowerCase() === "individual" },
  { key: "payroll", label: "Payroll", test: (c) => Boolean(c.payroll_enabled) },
  { key: "salestax", label: "Sales Tax", test: (c) => Boolean(c.sales_tax_frequency) && String(c.sales_tax_frequency).toLowerCase() !== "n/a" },
  { key: "portal", label: "Portal", test: (c) => Boolean(c.portal_enabled) },
];

type SortKey = "client_name" | "client_type" | "assigned_to" | "status";

function maskedSsnDisplay(v: unknown): string {
  const s = String(v || "").trim();
  return s || "";
}

function responsibleCell(c: Client): { primary: string; secondary: string; empty: boolean } {
  const isBusiness = String(c.client_type || c.entity_type || "").toLowerCase() !== "individual";
  if (isBusiness) {
    const name = String(c.company_contact_name || "").trim();
    const ssn = maskedSsnDisplay(c.company_contact_ssn);
    if (!name) return { primary: "Not assigned", secondary: "", empty: true };
    return { primary: name, secondary: ssn || "SSN not on file", empty: false };
  }
  const ssn = maskedSsnDisplay(c.individual_ssn);
  return { primary: "Individual", secondary: ssn || "SSN not on file", empty: false };
}

export function ClientsListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { setSelectedClient } = useSelectedClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [clients, setClients] = useState<Client[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [statusFilter, setStatusFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [quickTab, setQuickTab] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("client_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showForm, setShowForm] = useState(searchParams.get("new") === "1");
  const [form, setForm] = useState(EMPTY_CLIENT_FORM);
  const [createPortalNow, setCreatePortalNow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [inviteInfo, setInviteInfo] = useState<{ clientName: string; inviteLink?: string } | null>(null);
  const [staffOptions, setStaffOptions] = useState<string[]>([]);

  const canCreate = user?.role === "admin" || user?.role === "staff";
  const isAdmin = user?.role === "admin";

  function load(): Promise<void> {
    return api.get<{ clients: Client[] }>("/clients")
      .then((res) => setClients(res.clients))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load clients."));
  }

  useEffect(() => {
    if (!canCreate) return;
    api.get<{ users: PortalUser[] }>("/users")
      .then((res) => setStaffOptions(Array.from(new Set(res.users.filter((u) => ["admin", "staff"].includes(String(u.role || "").toLowerCase()) && u.active).map((u) => u.name))).sort()))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreate]);

  useEffect(() => { load(); }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
      toast("Data refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.post<{ clientId: string }>("/clients", form);
      setShowForm(false);
      let invite: { clientName: string; inviteLink?: string } | null = null;
      if (createPortalNow && form.email) {
        try {
          const inv = await api.post<{ inviteLink?: string }>("/users", {
            role: "client", assignedClientId: res.clientId, email: form.email, name: form.clientName,
          });
          invite = { clientName: form.clientName, inviteLink: inv.inviteLink };
        } catch {
          invite = { clientName: form.clientName };
        }
      }
      setForm(EMPTY_CLIENT_FORM);
      setCreatePortalNow(false);
      setSearchParams({});
      await load();
      if (invite) setInviteInfo(invite);
      toast("Client created.");
      setSelectedClient(res.clientId, form.clientName);
      navigate(`/clients/${res.clientId}`);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not create this client.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAction(c: Client, action: string) {
    if (action === "profile") { setSelectedClient(c.client_id, c.client_name); navigate(`/clients/${c.client_id}`); return; }
    if (action === "create-task") { navigate(`/tasks?new=1&clientId=${c.client_id}`); return; }
    if (action === "request-document") { navigate(`/documents?new=1&clientId=${c.client_id}`); return; }
    if (action === "upload-document") { navigate(`/documents?new=1&clientId=${c.client_id}&uploadNow=1`); return; }
    if (action === "review-documents") { navigate(`/documents?clientId=${c.client_id}`); return; }
    if (action === "secure-vault") { setSelectedClient(c.client_id, c.client_name); navigate(`/clients/${c.client_id}#vault`); return; }
    if (action === "edit") { setSelectedClient(c.client_id, c.client_name); navigate(`/clients/${c.client_id}?edit=1`); return; }
    if (action === "send-invite") {
      try {
        const res = await api.post<{ inviteLink?: string }>("/users", {
          role: "client", assignedClientId: c.client_id, email: c.email, name: c.client_name,
        });
        setInviteInfo({ clientName: c.client_name, inviteLink: res.inviteLink });
        toast(`Invite created for ${c.client_name}.`);
      } catch (err) {
        alert(err instanceof ApiError ? err.message : "Could not create a portal invite.");
      }
      return;
    }
    if (action === "archive") {
      if (!confirm(`Archive ${c.client_name}? This disables their portal and deactivates their portal users.`)) return;
      try {
        await api.post(`/clients/${c.client_id}/archive`, {});
        toast(`${c.client_name} archived.`);
        load();
      } catch (err) {
        alert(err instanceof ApiError ? err.message : "Could not archive this client.");
      }
    }
  }

  function actionOptions(_c: Client): ActionMenuOption[] {
    const opts: ActionMenuOption[] = [
      { value: "profile", label: "Profile" },
      { value: "create-task", label: "Create Task" },
      { value: "request-document", label: "Request Document" },
      { value: "upload-document", label: "Upload Document" },
      { value: "review-documents", label: "Review Documents" },
    ];
    if (isAdmin) opts.push({ value: "secure-vault", label: "Secure Vault" });
    if (isAdmin) opts.push({ value: "send-invite", label: "Send Portal Invitation" });
    opts.push({ value: "edit", label: "Edit Client" });
    if (isAdmin) opts.push({ value: "archive", label: "Archive Client" });
    return opts;
  }

  const owners = useMemo(() => Array.from(new Set((clients || []).map((c) => c.assigned_to).filter(Boolean))) as string[], [clients]);
  const types = useMemo(() => Array.from(new Set((clients || []).map((c) => c.client_type).filter(Boolean))) as string[], [clients]);
  const services = useMemo(() => Array.from(new Set((clients || []).map((c) => c.service_type).filter(Boolean))) as string[], [clients]);
  const statuses = useMemo(() => Array.from(new Set((clients || []).map((c) => c.status).filter(Boolean))) as string[], [clients]);

  const filtered = useMemo(() => {
    if (!clients) return [];
    const q = search.trim().toLowerCase();
    let rows = clients.filter((c) => {
      if (statusFilter !== "all" && String(c.status || "") !== statusFilter) return false;
      if (ownerFilter !== "all" && String(c.assigned_to || "") !== ownerFilter) return false;
      if (typeFilter !== "all" && String(c.client_type || "") !== typeFilter) return false;
      if (serviceFilter !== "all" && String(c.service_type || "") !== serviceFilter) return false;
      const tab = QUICK_TABS.find((t) => t.key === quickTab);
      if (tab && !tab.test(c)) return false;
      if (q && ![c.client_name, c.client_id, c.email, c.phone, c.assigned_to].some((v) => String(v || "").toLowerCase().includes(q))) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      const av = String(a[sortKey] || "").toLowerCase();
      const bv = String(b[sortKey] || "").toLowerCase();
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [clients, search, statusFilter, ownerFilter, typeFilter, serviceFilter, quickTab, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function sortArrow(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  function handleExport() {
    exportCsv(
      "clients.csv",
      [
        { key: "client_id", label: "Client ID" }, { key: "client_name", label: "Client Name" },
        { key: "client_type", label: "Type" }, { key: "entity_type", label: "Entity Type" },
        { key: "email", label: "Email" }, { key: "phone", label: "Phone" },
        { key: "assigned_to", label: "Owner" }, { key: "service_type", label: "Service" },
        { key: "sales_tax_frequency", label: "Sales Tax Frequency" }, { key: "payroll_frequency", label: "Payroll Frequency" },
        { key: "status", label: "Status" }, { key: "portal_enabled", label: "Portal" },
      ],
      filtered as unknown as Record<string, unknown>[]
    );
  }

  const tableTitle = isAdmin ? "Client Master" : "My Client List";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Clients</h1>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", width: 260 }}
          />
          {canCreate && <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Add Client"}</button>}
        </div>
      </div>

      <FilterBar
        selects={[
          { label: "Status", value: statusFilter, options: statuses, onChange: setStatusFilter },
          { label: "Owner", value: ownerFilter, options: owners, onChange: setOwnerFilter },
          { label: "Type", value: typeFilter, options: types, onChange: setTypeFilter },
          { label: "Service", value: serviceFilter, options: services, onChange: setServiceFilter },
        ]}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        onExportCsv={handleExport}
      />
      <div className="quick-tabs" style={{ margin: "10px 0 16px" }}>
        {QUICK_TABS.map((t) => (
          <button key={t.key} type="button" className={`quick-tab ${quickTab === t.key ? "active" : ""}`} onClick={() => setQuickTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {inviteInfo && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--teal)" }}>
          <strong>Portal invite created for {inviteInfo.clientName}.</strong> No email was sent (this backend has no
          email service yet) — copy this and send it to them yourself:
          <div style={{ marginTop: 8, wordBreak: "break-all", fontFamily: "monospace", fontSize: 12 }}>
            {inviteInfo.inviteLink || "Invite already existed; open Portal Access to resend it."}
          </div>
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setInviteInfo(null)}>Dismiss</button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ maxWidth: 640, marginBottom: 24 }}>
          {saveError && <div className="error-banner">{saveError}</div>}

          <div className="form-section-title">Client Identity</div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="nc-status">Active?</label>
              <select id="nc-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                <option>Active</option><option>Inactive</option><option>Archived</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="nc-name">Client Name</label>
              <input id="nc-name" required value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} />
              <div className="field-hint muted" style={{ fontSize: 11, marginTop: 4 }}>Client ID will be auto-assigned when you save.</div>
            </div>
            <div className="field">
              <label htmlFor="nc-ctype">Client Type</label>
              <select id="nc-ctype" value={form.clientType} onChange={(e) => setForm((f) => ({ ...f, clientType: e.target.value }))}>
                <option>Business</option><option>Individual</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="nc-etype">Entity Type</label>
              <select id="nc-etype" value={form.entityType} onChange={(e) => setForm((f) => ({ ...f, entityType: e.target.value }))}>
                <option value="">Select…</option>
                {ENTITY_TYPES.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="nc-state">State</label>
              <select id="nc-state" value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}>
                <option value="">Select…</option>
                {US_STATES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="nc-service">Service Type</label>
              <select id="nc-service" value={form.serviceType} onChange={(e) => setForm((f) => ({ ...f, serviceType: e.target.value }))}>
                <option value="">Select…</option>
                {SERVICE_TYPES.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div className="form-section-title">Services Provided</div>
          <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
            Select every service this client is engaged for — the client's profile will suggest the matching contract for each one.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", marginBottom: 16 }}>
            {FIRM_SERVICES.map((s) => (
              <label key={s.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={form.services.includes(s.key)}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    services: e.target.checked ? [...f.services, s.key] : f.services.filter((k) => k !== s.key),
                  }))}
                />
                {s.label}
              </label>
            ))}
          </div>

          <div className="form-section-title">Services &amp; Compliance</div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="nc-stf">Sales Tax Frequency</label>
              <select id="nc-stf" value={form.salesTaxFrequency} onChange={(e) => setForm((f) => ({ ...f, salesTaxFrequency: e.target.value }))}>
                <option value="">Select…</option>
                {FREQ_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 22 }}>
              <input type="checkbox" checked={form.payrollEnabled} onChange={(e) => setForm((f) => ({ ...f, payrollEnabled: e.target.checked }))} />
              Payroll enabled
            </label>
            <div className="field">
              <label htmlFor="nc-pf">Payroll Frequency</label>
              <select id="nc-pf" value={form.payrollFrequency} onChange={(e) => setForm((f) => ({ ...f, payrollFrequency: e.target.value }))}>
                <option value="">Select…</option>
                {PAYROLL_FREQS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="nc-psys">Payroll System</label><input id="nc-psys" value={form.payrollSystem} onChange={(e) => setForm((f) => ({ ...f, payrollSystem: e.target.value }))} placeholder="e.g. Gusto, ADP, Manual" /></div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 22 }}>
              <input type="checkbox" checked={form.eftpsEnabled} onChange={(e) => setForm((f) => ({ ...f, eftpsEnabled: e.target.checked }))} />
              EFTPS enabled
            </label>
            <div className="field">
              <label htmlFor="nc-mdw">MD Withholding Frequency</label>
              <select id="nc-mdw" value={form.mdWithholdingFrequency} onChange={(e) => setForm((f) => ({ ...f, mdWithholdingFrequency: e.target.value }))}>
                <option value="">Select…</option>
                {FREQ_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 22 }}>
              <input type="checkbox" checked={form.mduiEnabled} onChange={(e) => setForm((f) => ({ ...f, mduiEnabled: e.target.checked }))} />
              MD UI enabled
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 22 }}>
              <input type="checkbox" checked={form.mdAnnualReportEnabled} onChange={(e) => setForm((f) => ({ ...f, mdAnnualReportEnabled: e.target.checked }))} />
              MD Annual Report enabled
            </label>
            <div className="field">
              <label htmlFor="nc-brt">Business Return Type</label>
              <select id="nc-brt" value={form.businessReturnType} onChange={(e) => setForm((f) => ({ ...f, businessReturnType: e.target.value }))}>
                <option value="">Select…</option>
                {RETURN_TYPES.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 22 }}>
              <input type="checkbox" checked={form.w21099Enabled} onChange={(e) => setForm((f) => ({ ...f, w21099Enabled: e.target.checked }))} />
              W-2 / 1099 enabled
            </label>
          </div>

          <div className="form-section-title">Contact &amp; Assignment</div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="nc-assigned">Assigned To</label>
              <select id="nc-assigned" value={form.assignedTo} onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))}>
                <option value="">Unassigned</option>
                {staffOptions.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="nc-email">Email</label><input id="nc-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
            <div className="field"><label htmlFor="nc-phone">Phone</label><input id="nc-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
            <div className="field">
              <label htmlFor="nc-lang">Preferred Language</label>
              <select id="nc-lang" value={form.preferredLanguage} onChange={(e) => setForm((f) => ({ ...f, preferredLanguage: e.target.value }))}>
                {LANGUAGES.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="nc-pref">Preferred Contact</label>
              <select id="nc-pref" value={form.preferredContact} onChange={(e) => setForm((f) => ({ ...f, preferredContact: e.target.value }))}>
                {CONTACT_PREFS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 22 }}>
              <input type="checkbox" checked={form.smsAllowed} onChange={(e) => setForm((f) => ({ ...f, smsAllowed: e.target.checked }))} />
              SMS enabled
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 22 }}>
              <input type="checkbox" checked={form.emailAllowed} onChange={(e) => setForm((f) => ({ ...f, emailAllowed: e.target.checked }))} />
              Email enabled
            </label>
          </div>
          <AddressFields
            idPrefix="nc"
            showStateField={false}
            value={{ street: form.streetAddress, city: form.city, state: form.state, zip: form.zipCode }}
            onChange={(patch) => setForm((f) => ({
              ...f,
              streetAddress: patch.street ?? f.streetAddress,
              city: patch.city ?? f.city,
              zipCode: patch.zip ?? f.zipCode,
              state: patch.state ?? f.state,
            }))}
          />

          <div className="form-section-title">Tax IDs &amp; Responsible Party</div>
          <div className="form-grid">
            <div className="field"><label htmlFor="nc-ein">EIN</label><input id="nc-ein" value={form.ein} onChange={(e) => setForm((f) => ({ ...f, ein: e.target.value }))} /></div>
            <div className="field"><label htmlFor="nc-ssn">Individual SS No.</label><input id="nc-ssn" value={form.individualSsn} onChange={(e) => setForm((f) => ({ ...f, individualSsn: e.target.value }))} /></div>
            <div className="field"><label htmlFor="nc-sti">State Tax ID</label><input id="nc-sti" value={form.stateTaxId} onChange={(e) => setForm((f) => ({ ...f, stateTaxId: e.target.value }))} /></div>
            <div className="field"><label htmlFor="nc-sos">Secretary of State ID</label><input id="nc-sos" value={form.secretaryOfStateId} onChange={(e) => setForm((f) => ({ ...f, secretaryOfStateId: e.target.value }))} /></div>
            <div className="field"><label htmlFor="nc-cc">Responsible Party / Company Contact</label><input id="nc-cc" value={form.companyContactName} onChange={(e) => setForm((f) => ({ ...f, companyContactName: e.target.value }))} /></div>
            <div className="field"><label htmlFor="nc-cct">Contact Title</label><input id="nc-cct" value={form.companyContactTitle} onChange={(e) => setForm((f) => ({ ...f, companyContactTitle: e.target.value }))} /></div>
            <div className="field"><label htmlFor="nc-ccs">Contact SS No.</label><input id="nc-ccs" value={form.companyContactSsn} onChange={(e) => setForm((f) => ({ ...f, companyContactSsn: e.target.value }))} /></div>
          </div>
          <div className="field"><label htmlFor="nc-notes">Notes</label><textarea id="nc-notes" rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 14 }}>
            <input type="checkbox" checked={createPortalNow} onChange={(e) => setCreatePortalNow(e.target.checked)} disabled={!form.email} />
            Create portal user now {!form.email && <span className="muted">(requires an email address)</span>}
          </label>

          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Creating…" : "Create Client"}</button>
        </form>
      )}

      {!clients && !error && <div className="spinner-wrap">Loading clients…</div>}

      {clients && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ fontSize: 14 }}>{tableTitle}</strong>
            <span className="muted" style={{ fontSize: 12 }}>{filtered.length} of {clients.length} clients</span>
          </div>
          <div style={{ overflowX: "auto" }}>
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggleSort("client_name")}>Client{sortArrow("client_name")}</th>
                <th className="sortable" onClick={() => toggleSort("client_type")}>Type{sortArrow("client_type")}</th>
                <th>Contact</th>
                <th>Responsible</th>
                <th className="sortable" onClick={() => toggleSort("assigned_to")}>Owner{sortArrow("assigned_to")}</th>
                <th>Service</th>
                <th>Sales Tax</th>
                <th>Payroll</th>
                <th className="sortable" onClick={() => toggleSort("status")}>Status{sortArrow("status")}</th>
                <th>Portal</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const resp = responsibleCell(c);
                return (
                  <tr key={c.client_id} onClick={() => { setSelectedClient(c.client_id, c.client_name); navigate(`/clients/${c.client_id}`); }}>
                    <td>
                      <div className="cell-primary">{c.client_name}</div>
                      <div className="cell-sub">{c.client_id}</div>
                    </td>
                    <td>
                      <div className="cell-primary">{c.client_type || "—"}</div>
                      <div className="cell-sub">{c.entity_type || ""}</div>
                    </td>
                    <td>
                      {c.email ? <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()} className="cell-primary">{c.email}</a> : <div className="cell-primary muted">—</div>}
                      <div className="cell-sub">{c.phone || ""}</div>
                    </td>
                    <td>
                      <div className={resp.empty ? "cell-primary muted" : "cell-primary"}>{resp.primary}</div>
                      {resp.secondary && <div className="cell-sub">{resp.secondary}</div>}
                    </td>
                    <td className="muted">{c.assigned_to || "—"}</td>
                    <td className="muted">{c.service_type || "—"}</td>
                    <td className="muted">{c.sales_tax_frequency || "—"}</td>
                    <td className="muted">{c.payroll_enabled ? (c.payroll_frequency || "Enabled") : "N/A"}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td className="muted">{c.portal_enabled ? "Yes" : "No"}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <ActionMenu options={actionOptions(c)} onSelect={(action) => handleAction(c, action)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          </div>
          {filtered.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No clients match.</p>}
        </div>
      )}
    </div>
  );
}
