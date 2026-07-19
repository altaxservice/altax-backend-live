import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, downloadFile, viewFile } from "../api/client";
import type { Client } from "../api/types";
import type { VaultSecret, PaymentMethod, PortalUser } from "../api/types2";
import { useAuth } from "../auth/AuthContext";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/Toast";
import { US_STATES, ENTITY_TYPES, SERVICE_TYPES, FREQ_OPTIONS, PAYROLL_FREQS, RETURN_TYPES, LANGUAGES, CONTACT_PREFS } from "../utils/clientOptions";
import { AddressFields } from "../components/AddressFields";

type FieldKind = "text" | "select" | "checkbox" | "textarea";
interface FieldConfig { key: string; apiKey: string; label: string; kind: FieldKind; options?: string[] }

const EDIT_SECTIONS: { title: string; fields: FieldConfig[] }[] = [
  {
    title: "Client Identity",
    fields: [
      { key: "status", apiKey: "status", label: "Active?", kind: "select", options: ["Active", "Inactive", "Archived"] },
      { key: "client_name", apiKey: "clientName", label: "Client Name", kind: "text" },
      { key: "client_type", apiKey: "clientType", label: "Client Type", kind: "select", options: ["Business", "Individual"] },
      { key: "entity_type", apiKey: "entityType", label: "Entity Type", kind: "select", options: ENTITY_TYPES },
      { key: "state", apiKey: "state", label: "State", kind: "select", options: US_STATES },
      { key: "service_type", apiKey: "serviceType", label: "Service Type", kind: "select", options: SERVICE_TYPES },
    ],
  },
  {
    title: "Services & Compliance",
    fields: [
      { key: "sales_tax_frequency", apiKey: "salesTaxFrequency", label: "Sales Tax Frequency", kind: "select", options: FREQ_OPTIONS },
      { key: "payroll_enabled", apiKey: "payrollEnabled", label: "Payroll Enabled", kind: "checkbox" },
      { key: "payroll_frequency", apiKey: "payrollFrequency", label: "Payroll Frequency", kind: "select", options: PAYROLL_FREQS },
      { key: "payroll_system", apiKey: "payrollSystem", label: "Payroll System", kind: "text" },
      { key: "eftps_enabled", apiKey: "eftpsEnabled", label: "EFTPS Enabled", kind: "checkbox" },
      { key: "md_withholding_frequency", apiKey: "mdWithholdingFrequency", label: "MD Withholding Frequency", kind: "select", options: FREQ_OPTIONS },
      { key: "mdui_enabled", apiKey: "mduiEnabled", label: "MD UI Enabled", kind: "checkbox" },
      { key: "md_annual_report_enabled", apiKey: "mdAnnualReportEnabled", label: "MD Annual Report Enabled", kind: "checkbox" },
      { key: "business_return_type", apiKey: "businessReturnType", label: "Business Return Type", kind: "select", options: RETURN_TYPES },
      { key: "w21099_enabled", apiKey: "w21099Enabled", label: "W-2 / 1099 Enabled", kind: "checkbox" },
    ],
  },
  {
    title: "Contact & Assignment",
    fields: [
      { key: "assigned_to", apiKey: "assignedTo", label: "Assigned To", kind: "select" },
      { key: "email", apiKey: "email", label: "Email", kind: "text" },
      { key: "phone", apiKey: "phone", label: "Phone", kind: "text" },
      { key: "preferred_language", apiKey: "preferredLanguage", label: "Preferred Language", kind: "select", options: LANGUAGES },
      { key: "preferred_contact", apiKey: "preferredContact", label: "Preferred Contact", kind: "select", options: CONTACT_PREFS },
      { key: "sms_allowed", apiKey: "smsAllowed", label: "SMS Enabled", kind: "checkbox" },
      { key: "email_allowed", apiKey: "emailAllowed", label: "Email Enabled", kind: "checkbox" },
    ],
  },
  {
    title: "Tax IDs & Responsible Party",
    fields: [
      { key: "ein", apiKey: "ein", label: "EIN", kind: "text" },
      { key: "individual_ssn", apiKey: "individualSsn", label: "Individual SS No.", kind: "text" },
      { key: "state_tax_id", apiKey: "stateTaxId", label: "State Tax ID", kind: "text" },
      { key: "secretary_of_state_id", apiKey: "secretaryOfStateId", label: "Secretary of State ID", kind: "text" },
      { key: "company_contact_name", apiKey: "companyContactName", label: "Responsible Party / Company Contact", kind: "text" },
      { key: "company_contact_title", apiKey: "companyContactTitle", label: "Contact Title", kind: "text" },
      { key: "company_contact_ssn", apiKey: "companyContactSsn", label: "Contact SS No.", kind: "text" },
      { key: "notes", apiKey: "notes", label: "Notes", kind: "textarea" },
    ],
  },
];
const ALL_FIELDS = EDIT_SECTIONS.flatMap((s) => s.fields);

interface ClientSummary { openTasks: number; openRequests: number; openInvoices: number; balanceDue: number; employeesCount: number }

/** Turns bare URLs in freeform notes into clickable links, matching legacy's linkified notes field. */
function linkifyNotes(text: string): ReactNode[] {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={i} href={part} target="_blank" rel="noreferrer">{part}</a>
      : <span key={i}>{part}</span>
  );
}

export function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [client, setClient] = useState<Client | null>(null);
  const [summary, setSummary] = useState<ClientSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(searchParams.get("edit") === "1");
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statementBusy, setStatementBusy] = useState<"view" | "download" | null>(null);
  const [inviteInfo, setInviteInfo] = useState<{ inviteLink?: string; inviteEmailed?: boolean; inviteEmailError?: string } | null>(null);
  const [staffOptions, setStaffOptions] = useState<string[]>([]);

  const canEdit = user?.role === "admin" || user?.role === "staff";
  const canArchive = user?.role === "admin";
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!canEdit) return;
    api.get<{ users: PortalUser[] }>("/users")
      .then((res) => setStaffOptions(Array.from(new Set(res.users.filter((u) => ["admin", "staff"].includes(String(u.role || "").toLowerCase()) && u.active).map((u) => u.name))).sort()))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  function load() {
    if (!clientId) return;
    api.get<{ client: Client }>(`/clients/${clientId}`)
      .then((res) => {
        setClient(res.client);
        const initial: Record<string, any> = {};
        for (const f of ALL_FIELDS) initial[f.apiKey] = f.kind === "checkbox" ? Boolean(res.client[f.key]) : String(res.client[f.key] ?? "");
        initial.streetAddress = String(res.client.street_address ?? "");
        initial.city = String(res.client.city ?? "");
        initial.zipCode = String(res.client.zip_code ?? "");
        setForm(initial);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this client."));
    api.get<ClientSummary>(`/clients/${clientId}/summary`).then(setSummary).catch(() => {});
  }

  useEffect(load, [clientId]);

  useEffect(() => {
    if (location.hash !== "#vault" || !client) return;
    const el = document.getElementById("vault-section");
    if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
  }, [location.hash, client]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!clientId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.patch(`/clients/${clientId}`, form);
      setEditing(false);
      setSearchParams({});
      toast("Client updated.");
      load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    if (!clientId || !client) return;
    if (!confirm(`Archive ${client.client_name}? This disables their portal and deactivates their portal users.`)) return;
    try {
      await api.post(`/clients/${clientId}/archive`, {});
      toast(`${client.client_name} archived.`);
      navigate("/clients");
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not archive this client.");
    }
  }

  async function handleInvite() {
    if (!client) return;
    if (!client.email) { alert("This client has no email on file. Add one before sending a portal invitation."); return; }
    try {
      const res = await api.post<{ inviteLink?: string; inviteEmailed?: boolean; inviteEmailError?: string }>("/users", {
        role: "client", assignedClientId: client.client_id, email: client.email, name: client.client_name,
      });
      setInviteInfo(res);
      toast(res.inviteEmailed ? "Portal invite emailed." : "Portal invite created.");
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not create a portal invite.");
    }
  }

  async function handleStatement(mode: "view" | "download") {
    if (!clientId || !client) return;
    setStatementBusy(mode);
    try {
      if (mode === "view") await viewFile(`/billing/clients/${clientId}/statement`);
      else await downloadFile(`/billing/clients/${clientId}/statement`, `Statement_${client.client_id}.pdf`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this statement.");
    } finally {
      setStatementBusy(null);
    }
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!client) return <div className="spinner-wrap">Loading…</div>;

  const isBusiness = String(client.client_type || client.entity_type || "").toLowerCase() !== "individual";

  return (
    <div>
      <Link to="/clients" className="muted">← All clients</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", margin: "8px 0 24px", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="muted" style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em" }}>{client.client_id}</div>
          <h1 style={{ fontSize: 22, margin: "2px 0 4px" }}>{client.client_name}</h1>
          <StatusBadge status={client.status} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" disabled={statementBusy !== null} onClick={() => handleStatement("view")}>{statementBusy === "view" ? "Opening…" : "View Statement"}</button>
          <button className="btn" disabled={statementBusy !== null} onClick={() => handleStatement("download")}>{statementBusy === "download" ? "Generating…" : "Print / Download PDF"}</button>
          {isAdmin && <button className="btn" onClick={handleInvite}>Send Portal Invitation</button>}
          {canEdit && !editing && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
          {canArchive && <button className="btn btn-danger" onClick={handleArchive}>Archive</button>}
        </div>
      </div>

      {inviteInfo && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--teal)" }}>
          <strong>Portal invite created for {client.client_name}.</strong>{" "}
          {inviteInfo.inviteEmailed ? (
            <>Emailed to {client.email}.</>
          ) : (
            <>{inviteInfo.inviteEmailError ? `Email not sent: ${inviteInfo.inviteEmailError}` : "Email not sent."} Copy this link and send it to them yourself:</>
          )}
          {!inviteInfo.inviteEmailed && (
            <div style={{ marginTop: 8, wordBreak: "break-all", fontFamily: "monospace", fontSize: 12 }}>
              {inviteInfo.inviteLink || "Invite already existed; open Portal Access to resend it."}
            </div>
          )}
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setInviteInfo(null)}>Dismiss</button>
        </div>
      )}

      {editing ? (
        <form onSubmit={handleSave} className="card" style={{ maxWidth: 640 }}>
          {saveError && <div className="error-banner">{saveError}</div>}
          {EDIT_SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="form-section-title">{section.title}</div>
              <div className="form-grid">
                {section.fields.map((f) => (
                  f.kind === "checkbox" ? (
                    <label key={f.apiKey} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 22 }}>
                      <input
                        type="checkbox"
                        checked={Boolean(form[f.apiKey])}
                        onChange={(e) => setForm((prev) => ({ ...prev, [f.apiKey]: e.target.checked }))}
                      />
                      {f.label}
                    </label>
                  ) : f.kind === "select" ? (
                    <div className="field" key={f.apiKey}>
                      <label htmlFor={f.apiKey}>{f.label}</label>
                      <select id={f.apiKey} value={form[f.apiKey] ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, [f.apiKey]: e.target.value }))}>
                        <option value="">{f.apiKey === "assignedTo" ? "Unassigned" : "Select…"}</option>
                        {f.apiKey === "assignedTo" && form[f.apiKey] && !staffOptions.includes(form[f.apiKey]) && (
                          <option value={form[f.apiKey]}>{form[f.apiKey]}</option>
                        )}
                        {(f.apiKey === "assignedTo" ? staffOptions : f.options || []).map((o) => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                  ) : f.kind === "textarea" ? (
                    <div className="field" style={{ gridColumn: "1 / -1" }} key={f.apiKey}>
                      <label htmlFor={f.apiKey}>{f.label}</label>
                      <textarea id={f.apiKey} rows={f.key === "notes" ? 3 : 2} value={form[f.apiKey] ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, [f.apiKey]: e.target.value }))} />
                    </div>
                  ) : (
                    <div className="field" key={f.apiKey}>
                      <label htmlFor={f.apiKey}>{f.label}</label>
                      <input id={f.apiKey} value={form[f.apiKey] ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, [f.apiKey]: e.target.value }))} />
                    </div>
                  )
                ))}
              </div>
              {section.title === "Contact & Assignment" && (
                <AddressFields
                  idPrefix="cd"
                  showStateField={false}
                  value={{ street: form.streetAddress ?? "", city: form.city ?? "", state: form.state ?? "", zip: form.zipCode ?? "" }}
                  onChange={(patch) => setForm((prev) => ({
                    ...prev,
                    streetAddress: patch.street ?? prev.streetAddress,
                    city: patch.city ?? prev.city,
                    zipCode: patch.zip ?? prev.zipCode,
                    state: patch.state ?? prev.state,
                  }))}
                />
              )}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
            <button type="button" className="btn" onClick={() => { setEditing(false); setSearchParams({}); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div className="card">
              <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Profile</h2>
              <DetailRow label="Client Type" value={client.client_type} />
              <DetailRow label="Entity Type" value={client.entity_type} />
              <DetailRow label="State" value={client.state} />
              <DetailRow label="Service Type" value={client.service_type} />
              <DetailRow label="Email" value={client.email} />
              <DetailRow label="Phone" value={client.phone} />
              <DetailRow label="Address" value={client.address as string | null} multiline />
              <DetailRow label="Assigned To (Owner)" value={client.assigned_to} />
              <DetailRow label="Preferred Contact" value={client.preferred_contact as string | null} />
              <DetailRow label="Preferred Language" value={client.preferred_language as string | null} />
              <DetailRow label="SMS Enabled" value={client.sms_allowed ? "Yes" : "No"} />
              <DetailRow label="Email Enabled" value={client.email_allowed ? "Yes" : "No"} />
              <DetailRow label="Portal Enabled" value={client.portal_enabled ? "Yes" : "No"} />
            </div>
            <div className="card">
              <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Compliance &amp; Tax IDs</h2>
              <p className="muted" style={{ marginBottom: 12 }}>
                {user?.role === "admin" ? "Shown in full — you are signed in as Admin." : "Sensitive fields are masked for your role."}
              </p>
              {isBusiness ? (
                <DetailRow label="EIN" value={client.ein as string | null} />
              ) : (
                <DetailRow label="Individual SSN" value={client.individual_ssn as string | null} />
              )}
              {isBusiness && <DetailRow label="State Tax ID" value={client.state_tax_id as string | null} />}
              {isBusiness && <DetailRow label="Secretary of State ID" value={client.secretary_of_state_id as string | null} />}
              <DetailRow label="Sales Tax Frequency" value={client.sales_tax_frequency as string | null} />
              <DetailRow label="Payroll Enabled" value={client.payroll_enabled ? "Yes" : "No"} />
              {Boolean(client.payroll_enabled) && <DetailRow label="Payroll Frequency" value={client.payroll_frequency as string | null} />}
              {Boolean(client.payroll_enabled) && <DetailRow label="Payroll System" value={client.payroll_system as string | null} />}
              <DetailRow label="EFTPS Enabled" value={client.eftps_enabled ? "Yes" : "No"} />
              <DetailRow label="MD Withholding Frequency" value={client.md_withholding_frequency as string | null} />
              <DetailRow label="MD UI Enabled" value={client.mdui_enabled ? "Yes" : "No"} />
              <DetailRow label="MD Annual Report Enabled" value={client.md_annual_report_enabled ? "Yes" : "No"} />
              <DetailRow label="Business Return Type" value={client.business_return_type as string | null} />
              <DetailRow label="W-2 / 1099 Enabled" value={client.w21099_enabled ? "Yes" : "No"} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 20 }}>
            <div className="card">
              <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Responsible Party</h2>
              {isBusiness ? (
                <>
                  <DetailRow label="Company Contact" value={client.company_contact_name as string | null} />
                  <DetailRow label="Title" value={client.company_contact_title as string | null} />
                  <DetailRow label="SS No." value={client.company_contact_ssn as string | null} />
                </>
              ) : (
                <p className="muted">Not applicable for individual clients.</p>
              )}
            </div>
            <div className="card">
              <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Account</h2>
              <DetailRow label="Open Tasks" value={summary ? String(summary.openTasks) : "—"} />
              <DetailRow label="Open Document Requests" value={summary ? String(summary.openRequests) : "—"} />
              <DetailRow label="Open Invoices" value={summary ? String(summary.openInvoices) : "—"} />
              <DetailRow label="Balance Due" value={summary ? `$${summary.balanceDue.toFixed(2)}` : "—"} />
              <DetailRow label="Employees" value={summary ? String(summary.employeesCount) : "—"} />
            </div>
          </div>

          {String(client.notes || "").trim() && (
            <div className="card" style={{ marginTop: 20 }}>
              <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Notes</h2>
              <p style={{ fontSize: 13, whiteSpace: "pre-wrap", margin: 0 }}>{linkifyNotes(String(client.notes))}</p>
            </div>
          )}
        </>
      )}

      {!editing && client && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 20 }} id="vault-section">
          {user?.role === "admin" && <VaultSection clientId={client.client_id} />}
          {(user?.role === "admin" || user?.role === "staff") && <PaymentMethodsSection clientId={client.client_id} />}
        </div>
      )}

      {!editing && client && (user?.role === "admin" || user?.role === "staff") && (
        <div style={{ marginTop: 20 }}>
          <EmployerTaxFormsSection clientId={client.client_id} />
        </div>
      )}
    </div>
  );
}

/**
 * Employer-level tax forms (W-3, Form 1096, Form 940, Form 941) — unlike
 * W-2/1099-NEC (generated per employee/contractor on their own profile
 * page), these are filed once per employer per year (or per quarter, for
 * 941), summing totals across everyone that client paid, so they live here
 * on the client itself rather than on any one employee's page.
 */
function EmployerTaxFormsSection({ clientId }: { clientId: string }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const currentQuarter = (Math.floor(new Date().getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(currentQuarter);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(form: "w3" | "1096" | "940" | "941", mode: "view" | "download") {
    const key = `${form}-${mode}`;
    setBusy(key);
    try {
      const q = form === "941" ? `&quarter=${quarter}` : "";
      const path = `/accounting/tax-forms/${form}/${clientId}?year=${encodeURIComponent(year)}${q}`;
      const filename = form === "941" ? `941_${year}Q${quarter}_${clientId}.pdf` : `${form.toUpperCase()}_${year}_${clientId}.pdf`;
      if (mode === "view") await viewFile(path);
      else await downloadFile(path, filename);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : `Could not generate this form.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Employer Tax Forms</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Filed once per employer, summing totals across every employee/contractor paid that period. W-3/1096 aren't
        needed if the underlying W-2s/1099-NECs were filed electronically. 940/941 leave a few lines blank where this
        system doesn't track the underlying data (deposits made, prior-quarter lookback liability, etc.) — review
        before filing.
      </p>
      <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
        <div className="field" style={{ maxWidth: 120 }}>
          <label htmlFor="taxFormYear">Tax Year</label>
          <input id="taxFormYear" value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
        <div className="field" style={{ maxWidth: 140 }}>
          <label htmlFor="taxFormQuarter">Quarter (for 941)</label>
          <select id="taxFormQuarter" value={quarter} onChange={(e) => setQuarter(Number(e.target.value) as 1 | 2 | 3 | 4)}>
            <option value={1}>Q1 (Jan-Mar)</option>
            <option value={2}>Q2 (Apr-Jun)</option>
            <option value={3}>Q3 (Jul-Sep)</option>
            <option value={4}>Q4 (Oct-Dec)</option>
          </select>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>W-3 (transmits W-2s to SSA)</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" disabled={busy !== null} onClick={() => run("w3", "view")}>{busy === "w3-view" ? "Opening…" : "View W-3"}</button>
            <button className="btn" disabled={busy !== null} onClick={() => run("w3", "download")}>{busy === "w3-download" ? "Generating…" : "Download W-3"}</button>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Form 1096 (transmits 1099-NECs to IRS)</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" disabled={busy !== null} onClick={() => run("1096", "view")}>{busy === "1096-view" ? "Opening…" : "View 1096"}</button>
            <button className="btn" disabled={busy !== null} onClick={() => run("1096", "download")}>{busy === "1096-download" ? "Generating…" : "Download 1096"}</button>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Form 940 (annual FUTA return)</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" disabled={busy !== null} onClick={() => run("940", "view")}>{busy === "940-view" ? "Opening…" : "View 940"}</button>
            <button className="btn" disabled={busy !== null} onClick={() => run("940", "download")}>{busy === "940-download" ? "Generating…" : "Download 940"}</button>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Form 941 (quarterly federal return)</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" disabled={busy !== null} onClick={() => run("941", "view")}>{busy === "941-view" ? "Opening…" : "View 941"}</button>
            <button className="btn" disabled={busy !== null} onClick={() => run("941", "download")}>{busy === "941-download" ? "Generating…" : "Download 941"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function VaultSection({ clientId }: { clientId: string }) {
  const [secrets, setSecrets] = useState<VaultSecret[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ category: "", label: "", agencyName: "", secret: "" });
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  function load() {
    api.get<{ secrets: VaultSecret[] }>(`/vault/${clientId}`)
      .then((res) => setSecrets(res.secrets))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the vault."));
  }
  useEffect(load, [clientId]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/vault/${clientId}`, form);
      setShowForm(false);
      setForm({ category: "", label: "", agencyName: "", secret: "" });
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not save this secret.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReveal(secretId: string) {
    try {
      const res = await api.get<{ secret: string }>(`/vault/${clientId}/${secretId}/reveal`);
      setRevealed((prev) => ({ ...prev, [secretId]: res.secret }));
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not decrypt this secret.");
    }
  }

  async function handleDelete(secretId: string) {
    if (!confirm("Delete this vault item? The encrypted value cannot be recovered afterward.")) return;
    try {
      await api.post(`/vault/${clientId}/${secretId}/delete`, {});
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not delete this item.");
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Secure Vault</h2>
        <button className="btn btn-sm" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Add Secret"}</button>
      </div>
      <p className="muted" style={{ marginBottom: 12 }}>Encrypted server-side. Every view is logged. Vault records are excluded from profiles, notes, exports, and statement PDFs.</p>
      {error && <div className="error-banner">{error}</div>}
      {showForm && (
        <form onSubmit={handleSave} style={{ marginBottom: 16, borderBottom: "1px solid var(--line)", paddingBottom: 16 }}>
          <div className="field"><label>Category</label><input required value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. State Portal" /></div>
          <div className="field"><label>Label</label><input required value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. MD Tax Connect Login" /></div>
          <div className="field"><label>Agency Name</label><input value={form.agencyName} onChange={(e) => setForm((f) => ({ ...f, agencyName: e.target.value }))} /></div>
          <div className="field"><label>Secret Value</label><input type="password" required value={form.secret} onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))} /></div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Secret"}</button>
        </form>
      )}
      {secrets && secrets.length === 0 && <p className="muted">No secrets stored for this client.</p>}
      {secrets && secrets.map((s) => (
        <div key={s.secret_id} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>{s.label}</strong>
              <span className="muted"> · {s.category}</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-sm" onClick={() => handleReveal(s.secret_id)}>{revealed[s.secret_id] ? "Refresh" : "Reveal"}</button>
              <button className="btn btn-sm btn-danger" onClick={() => handleDelete(s.secret_id)}>Delete</button>
            </div>
          </div>
          {revealed[s.secret_id] && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, fontFamily: "monospace", background: "var(--surface)", padding: 8, borderRadius: 6 }}>
              <span>{revealed[s.secret_id]}</span>
              <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard.writeText(revealed[s.secret_id])}>Copy</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const BANK_TYPES = ["ACH", "Check", "Wire"];
const CARD_BRANDS = ["Visa", "Mastercard", "American Express", "Discover", "Other"];
const EXP_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const EXP_YEARS = Array.from({ length: 15 }, (_, i) => new Date().getFullYear() + i);

const PAYMENT_METHOD_FORM_DEFAULTS = {
  paymentMethodId: "", methodName: "", methodType: "ACH", bankName: "", routingNumber: "", accountNumber: "", confirmAccountNumber: "",
  phone: "", cardBrand: "Visa", cardholderName: "", cardLast4: "", cardExpMonth: "", cardExpYear: "",
  defaultForPayroll: false, defaultForInvoices: false,
};

function PaymentMethodsSection({ clientId }: { clientId: string }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(PAYMENT_METHOD_FORM_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, { accountNumber: string | null; routingNumber: string | null }>>({});

  const isBankType = BANK_TYPES.includes(form.methodType);
  const isCardType = form.methodType === "Credit Card";

  function load() {
    api.get<{ paymentMethods: PaymentMethod[] }>(`/payment-methods/${clientId}`)
      .then((res) => setMethods(res.paymentMethods))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load payment methods."));
  }
  useEffect(load, [clientId]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/payment-methods", { ...form, clientId });
      setShowForm(false);
      setForm(PAYMENT_METHOD_FORM_DEFAULTS);
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not save this payment method.");
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(m: PaymentMethod) {
    setForm({
      paymentMethodId: m.payment_method_id, methodName: m.method_name, methodType: m.method_type,
      bankName: "", routingNumber: "", accountNumber: "", confirmAccountNumber: "",
      phone: m.phone || "", cardBrand: m.card_brand || "Visa", cardholderName: m.cardholder_name || "",
      cardLast4: m.card_last4 || "", cardExpMonth: m.card_exp_month ? String(m.card_exp_month) : "",
      cardExpYear: m.card_exp_year ? String(m.card_exp_year) : "",
      defaultForPayroll: m.default_for_payroll, defaultForInvoices: m.default_for_invoices,
    });
    setShowForm(true);
  }

  async function handleDelete(paymentMethodId: string) {
    if (!confirm("Delete this payment method?")) return;
    try {
      await api.post(`/payment-methods/${clientId}/${paymentMethodId}/delete`, {});
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not delete this payment method.");
    }
  }

  async function handleReveal(paymentMethodId: string) {
    try {
      const res = await api.get<{ accountNumber: string | null; routingNumber: string | null }>(`/payment-methods/${clientId}/${paymentMethodId}/reveal`);
      setRevealed((prev) => ({ ...prev, [paymentMethodId]: res }));
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not decrypt this payment method.");
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Payment Methods</h2>
        <button className="btn btn-sm" onClick={() => { setForm(PAYMENT_METHOD_FORM_DEFAULTS); setShowForm((v) => !v); }}>{showForm ? "Cancel" : "Add Method"}</button>
      </div>
      <p className="muted" style={{ marginBottom: 12 }}>Account/routing numbers are encrypted; only the last 4 digits are ever shown. Credit cards are stored as a reference only (brand, name, last 4, expiry) — never a full card number or CVV. Mark one method "Default for Payroll" so paychecks pick up its bank info automatically.</p>
      {error && <div className="error-banner">{error}</div>}
      {showForm && (
        <form onSubmit={handleSave} style={{ marginBottom: 16, borderBottom: "1px solid var(--line)", paddingBottom: 16 }}>
          {form.paymentMethodId && <strong style={{ display: "block", marginBottom: 8, fontSize: 13 }}>Editing {form.methodName}</strong>}
          <div className="field"><label>Method Name</label><input required value={form.methodName} onChange={(e) => setForm((f) => ({ ...f, methodName: e.target.value }))} placeholder="e.g. Chase Checking" /></div>
          <div className="field"><label>Type</label><select value={form.methodType} onChange={(e) => setForm((f) => ({ ...f, methodType: e.target.value }))}><option>ACH</option><option>Check</option><option>Wire</option><option>Credit Card</option></select></div>
          <div className="field"><label>Phone</label><input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="Contact for this payment method" /></div>
          {isBankType && (
            <>
              {form.paymentMethodId && <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>Leave bank fields blank to keep the numbers already on file — only fill them in to replace them.</p>}
              <div className="field"><label>Bank Name{form.paymentMethodId ? " (leave blank to keep current)" : ""}</label><input value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} /></div>
              <div className="field"><label>Routing Number{form.paymentMethodId ? " (leave blank to keep current)" : ""}</label><input value={form.routingNumber} onChange={(e) => setForm((f) => ({ ...f, routingNumber: e.target.value }))} /></div>
              <div className="field"><label>Account Number{form.paymentMethodId ? " (leave blank to keep current)" : ""}</label><input value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} /></div>
              <div className="field"><label>Confirm Account Number</label><input value={form.confirmAccountNumber} onChange={(e) => setForm((f) => ({ ...f, confirmAccountNumber: e.target.value }))} /></div>
            </>
          )}
          {isCardType && (
            <>
              <div className="field"><label>Cardholder Name</label><input value={form.cardholderName} onChange={(e) => setForm((f) => ({ ...f, cardholderName: e.target.value }))} /></div>
              <div className="field"><label>Card Brand</label><select value={form.cardBrand} onChange={(e) => setForm((f) => ({ ...f, cardBrand: e.target.value }))}>{CARD_BRANDS.map((b) => <option key={b}>{b}</option>)}</select></div>
              <div className="field"><label>Last 4 Digits</label><input value={form.cardLast4} maxLength={4} onChange={(e) => setForm((f) => ({ ...f, cardLast4: e.target.value.replace(/\D/g, "") }))} placeholder="1234" /></div>
              <div className="form-grid">
                <div className="field"><label>Expiry Month</label><select value={form.cardExpMonth} onChange={(e) => setForm((f) => ({ ...f, cardExpMonth: e.target.value }))}><option value="">—</option>{EXP_MONTHS.map((m) => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}</select></div>
                <div className="field"><label>Expiry Year</label><select value={form.cardExpYear} onChange={(e) => setForm((f) => ({ ...f, cardExpYear: e.target.value }))}><option value="">—</option>{EXP_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>No payment processor is connected, so this can't be charged from here — it's a reference for staff only. We never ask for or store the full card number or CVV.</p>
            </>
          )}
          <div style={{ display: "flex", gap: 16, margin: "4px 0 12px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={form.defaultForPayroll} onChange={(e) => setForm((f) => ({ ...f, defaultForPayroll: e.target.checked }))} />
              Default for Payroll
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={form.defaultForInvoices} onChange={(e) => setForm((f) => ({ ...f, defaultForInvoices: e.target.checked }))} />
              Default for Invoices
            </label>
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </form>
      )}
      {methods && methods.length === 0 && <p className="muted">No payment methods on file.</p>}
      {methods && methods.map((m) => {
        const isBank = BANK_TYPES.includes(m.method_type);
        const isCard = m.method_type === "Credit Card";
        const rev = revealed[m.payment_method_id];
        return (
          <div key={m.payment_method_id} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong>{m.method_name}</strong>
                <span className="muted">
                  {" · "}{m.method_type}
                  {isCard
                    ? ` · ${m.card_brand || "Card"} ****${m.card_last4 || "----"}${m.card_exp_month && m.card_exp_year ? ` exp ${String(m.card_exp_month).padStart(2, "0")}/${m.card_exp_year}` : ""}`
                    : ` · ****${m.bank_last4 || "----"}`}
                  {m.phone ? ` · ${m.phone}` : ""}
                </span>
                {m.default_for_payroll && <span className="badge" style={{ marginLeft: 8 }}>Payroll default</span>}
                {m.default_for_invoices && <span className="badge" style={{ marginLeft: 8 }}>Invoice default</span>}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {isBank && isAdmin && <button className="btn btn-sm" onClick={() => handleReveal(m.payment_method_id)}>{rev ? "Refresh" : "Reveal"}</button>}
                <button className="btn btn-sm" onClick={() => handleEdit(m)}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(m.payment_method_id)}>Delete</button>
              </div>
            </div>
            {rev && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, fontFamily: "monospace", background: "var(--surface)", padding: 8, borderRadius: 6 }}>
                <span>Routing {rev.routingNumber || "—"} · Account {rev.accountNumber || "—"}</span>
                <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard.writeText(rev.accountNumber || "")}>Copy Account #</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DetailRow({ label, value, multiline }: { label: string; value: string | null | undefined; multiline?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13, gap: 12 }}>
      <span className="muted">{label}</span>
      <span style={{ textAlign: "right", whiteSpace: multiline ? "pre-wrap" : "normal" }}>{value || "—"}</span>
    </div>
  );
}
