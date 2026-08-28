import { Fragment, useEffect, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, downloadFile, viewFile, printFile, openAnyFile, downloadAnyFile, printAnyFile, buildFilename } from "../api/client";
import type { Employee, DocumentUpload } from "../api/types2";
import { useAuth } from "../auth/AuthContext";
import { AddressFields } from "../components/AddressFields";
import { ErrorBanner } from "../components/ErrorBanner";
import { UploadToPortalModal } from "../components/UploadToPortalModal";
import { RequestDocumentModal } from "../components/RequestDocumentModal";
import { StatusBadge } from "../components/StatusBadge";
import { BackLink } from "../components/BackLink";
import { PrevNextNav } from "../components/PrevNextNav";
import { getAdjacentIds } from "../utils/listNav";
import { useToast } from "../components/Toast";
import { useConfirm, usePrompt, useNotify } from "../components/ConfirmProvider";
import { fmtDateOnly, fmtDateTime } from "../utils/date";
import type { DocumentRequest } from "../api/types2";
import type { GovFormFiling } from "../api/govForms";
import { GOV_FORM_LABELS, GOV_SUBMIT_VIA_OPTIONS, GOV_STATUS_COLOR } from "../api/govForms";
import { GenerateW4Modal } from "../components/GenerateW4Modal";
import { GenerateW9Modal } from "../components/GenerateW9Modal";
import { PAYROLL_FREQS, FEDERAL_FILING_STATUSES, MD_FILING_STATUSES, MD_COUNTIES } from "../utils/clientOptions";
import { DetailField } from "../components/DetailCard";

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

interface SensitiveFields {
  ssn: string | null; ein: string | null; tin: string | null; address: string | null;
  streetAddress: string | null; city: string | null; state: string | null; zipCode: string | null;
  federalFilingStatus: string | null; stateFilingStatus: string | null; w9Status: string | null;
  county: string | null; mdExemptions: number | string | null;
  stateExemptions: number | string | null; ageBlindExemptions: number | string | null;
  tinVerificationStatus: string | null; vendorClassification: string | null; contractorPaymentType: string | null;
  fixedProjectAmount: number | string | null; is1099Eligible: boolean; paymentMethod: string | null;
  directDeposit: boolean; paymentBankName: string | null; paymentRoutingNumber: string | null;
  paymentAccountNumber: string | null; paymentAccountType: string | null;
}

const SENSITIVE_FORM_DEFAULTS = {
  ssn: "", ein: "", tin: "", address: "", streetAddress: "", city: "", state: "", zipCode: "",
  federalFilingStatus: "", stateFilingStatus: "", county: "", mdExemptions: "",
  stateExemptions: "", ageBlindExemptions: "",
  w9Status: "", tinVerificationStatus: "", vendorClassification: "", contractorPaymentType: "",
  fixedProjectAmount: "", is1099Eligible: false, paymentMethod: "", directDeposit: false,
  paymentBankName: "", paymentRoutingNumber: "", paymentAccountNumber: "", paymentAccountType: "",
};

const EMPLOYEE_TABS = ["Profile", "Sensitive Info", "Documents", "Tax Documents"] as const;
type EmployeeTab = (typeof EMPLOYEE_TABS)[number];

interface PayrollSchedule {
  payroll_schedule_id: string; frequency: string; anchor_date: string; next_pay_date: string;
  lead_days: number; status: "Active" | "Paused" | "Archived"; drafts_from: string;
}

/** Same eligibility rule the backend enforces (both at schedule-creation and
 * again at sweep time) — mirrored here so the toggle can be shown disabled
 * with an explanation, rather than letting staff try and then bounce off a
 * 400. The backend is still the real gate; this is UX, not validation. */
function payrollAgentIneligibleReason(employee: Employee): string | null {
  const status = String(employee.status || "Active").trim().toLowerCase();
  if (["inactive", "archived", "deleted"].includes(status)) return "This employee is not active.";
  const workerType = String(employee.worker_type || "").toLowerCase();
  if (workerType.includes("contractor")) return "Contractors aren't eligible — the Payroll Agent only drafts employee paychecks.";
  const hasGross = Number(employee.default_gross_wages) > 0;
  const hasHourly = Number(employee.pay_rate) > 0 && Number(employee.default_hours) > 0;
  if (!hasGross && !hasHourly) return "Set a Default Gross Wages amount, or both Pay Rate and Default Hours, above to enable this.";
  return null;
}

export function EmployeeDetailPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const notify = useNotify();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canEdit = user?.role === "admin" || user?.role === "staff";

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Deep-linked from the Employees & Contractors list's own "Edit" action
  // (/employees/:id?edit=1) — Edit moved out of this page's header, same move
  // already made for Archive/Delete, so the list is where every lifecycle
  // action for an employee now starts.
  const [editing, setEditing] = useState(searchParams.get("edit") === "1");
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);

  const [sensitive, setSensitive] = useState<SensitiveFields | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [editingSensitive, setEditingSensitive] = useState(false);
  const [sensitiveForm, setSensitiveForm] = useState(SENSITIVE_FORM_DEFAULTS);
  const [sensitiveSaving, setSensitiveSaving] = useState(false);
  const [sensitiveError, setSensitiveError] = useState<string | null>(null);
  // Init from ?tab= so BackLink's history-back (and deep links) land on the same
  // tab the user was on, not always Profile.
  const [tab, setTab] = useState<EmployeeTab>(() => {
    const param = searchParams.get("tab");
    return (EMPLOYEE_TABS as readonly string[]).includes(param || "") ? (param as EmployeeTab) : "Profile";
  });

  function load() {
    if (!employeeId) return;
    api.get<{ employee: Employee }>(`/accounting/employees/${employeeId}/profile`)
      .then((res) => {
        setEmployee(res.employee);
        setForm({
          employeeName: res.employee.employee_name, email: res.employee.email || "", phone: res.employee.phone || "",
          workerType: res.employee.worker_type || "Employee", payType: res.employee.pay_type || "Hourly",
          payRate: String(res.employee.pay_rate ?? ""), defaultHours: String(res.employee.default_hours ?? ""),
          defaultGrossWages: String(res.employee.default_gross_wages ?? ""), payFrequency: res.employee.pay_frequency || "",
          serviceCategory: res.employee.service_category || "",
        });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this profile."));
  }
  useEffect(load, [employeeId]);

  const isContractor = String(employee?.worker_type || "").toLowerCase().includes("contractor");

  // Auto-Draft Payroll is view-only here — turning it on/off and enrolling
  // new employees both happen under Accounting → Payroll → Payroll Agent for
  // this employee's client, so staff manage it from the same place they run
  // that client's payroll rather than from every employee's own profile.
  const [schedule, setSchedule] = useState<PayrollSchedule | null>(null);
  const [scheduleLoaded, setScheduleLoaded] = useState(false);

  function loadSchedule() {
    if (!employeeId) return;
    api.get<{ schedule: PayrollSchedule | null }>(`/accounting/payroll-agent/schedules/${employeeId}`)
      .then((res) => {
        setSchedule(res.schedule);
        setScheduleLoaded(true);
      })
      .catch(() => setScheduleLoaded(true));
  }
  useEffect(loadSchedule, [employeeId]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!employee) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.post("/accounting/employees", { employeeId: employee.employee_id, clientId: employee.client_id, ...form });
      setEditing(false);
      load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus() {
    if (!employee) return;
    const nextStatus = String(employee.status || "").toLowerCase() === "active" ? "Inactive" : "Active";
    setStatusSaving(true);
    try {
      await api.post(`/accounting/employees/${employee.employee_id}/status`, { status: nextStatus });
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not change this profile's status.");
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleReveal() {
    if (!employee) return;
    setRevealing(true);
    try {
      const res = await api.get<SensitiveFields>(`/accounting/employees/${employee.employee_id}/sensitive`);
      setSensitive(res);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not decrypt this profile's sensitive fields.");
    } finally {
      setRevealing(false);
    }
  }

  function startEditSensitive() {
    setSensitiveForm({
      ssn: sensitive?.ssn || "", ein: sensitive?.ein || "", tin: sensitive?.tin || "", address: sensitive?.address || "",
      streetAddress: sensitive?.streetAddress || "", city: sensitive?.city || "", state: sensitive?.state || "", zipCode: sensitive?.zipCode || "",
      federalFilingStatus: sensitive?.federalFilingStatus || "", stateFilingStatus: sensitive?.stateFilingStatus || "",
      county: sensitive?.county || "", mdExemptions: String(sensitive?.mdExemptions ?? ""),
      stateExemptions: String(sensitive?.stateExemptions ?? ""), ageBlindExemptions: String(sensitive?.ageBlindExemptions ?? ""),
      w9Status: sensitive?.w9Status || "", tinVerificationStatus: sensitive?.tinVerificationStatus || "",
      vendorClassification: sensitive?.vendorClassification || "", contractorPaymentType: sensitive?.contractorPaymentType || "",
      fixedProjectAmount: String(sensitive?.fixedProjectAmount ?? ""), is1099Eligible: Boolean(sensitive?.is1099Eligible),
      paymentMethod: sensitive?.paymentMethod || "", directDeposit: Boolean(sensitive?.directDeposit),
      paymentBankName: sensitive?.paymentBankName || "", paymentRoutingNumber: sensitive?.paymentRoutingNumber || "",
      paymentAccountNumber: sensitive?.paymentAccountNumber || "", paymentAccountType: sensitive?.paymentAccountType || "",
    });
    setEditingSensitive(true);
  }

  async function handleSaveSensitive(e: FormEvent) {
    e.preventDefault();
    if (!employee) return;
    setSensitiveSaving(true);
    setSensitiveError(null);
    try {
      await api.patch(`/accounting/employees/${employee.employee_id}/sensitive`, sensitiveForm);
      setEditingSensitive(false);
      setSensitive(null);
      load();
    } catch (err) {
      setSensitiveError(err instanceof ApiError ? err.message : "Could not save changes.");
    } finally {
      setSensitiveSaving(false);
    }
  }

  if (error) return <ErrorBanner error={error} />;
  if (!employee) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center" }}>
        <BackLink
          fallback={`/accounting?client=${employee.client_id}&tab=${isContractor ? "Contractors" : "Employees"}`}
          fallbackLabel={isContractor ? "Contractors" : "Employees"}
        />
        <PrevNextNav basePath="/employees" {...getAdjacentIds("employees", employeeId)} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", margin: "8px 0 24px", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>{employee.employee_name}</h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="muted">{employee.worker_type || "Employee"} · {employee.status}</span>
            <Link to={`/clients/${employee.client_id}`} className="muted">{employee.client_name as string}</Link>
          </div>
        </div>
      </div>

      <div role="tablist" style={{ display: "flex", gap: 4, alignItems: "center", borderBottom: "1px solid var(--line)", marginBottom: 20, flexWrap: "wrap" }}>
        {EMPLOYEE_TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => { setTab(t); setSearchParams({ tab: t }, { replace: true }); }}
            style={{
              padding: "10px 16px", fontSize: 14, fontWeight: 500, cursor: "pointer", border: "none", font: "inherit", background: "transparent",
              color: tab === t ? "var(--ink)" : "var(--muted)",
              borderBottom: tab === t ? "2px solid var(--teal)" : "2px solid transparent",
            }}
          >
            {t}
          </button>
        ))}
        {canEdit && String(employee.status || "").toLowerCase() !== "archived" && (
          <button className="btn btn-sm" disabled={statusSaving} onClick={handleToggleStatus} style={{ marginLeft: 4 }}>
            {statusSaving ? "Saving…" : String(employee.status || "").toLowerCase() === "active" ? "Set Inactive" : "Set Active"}
          </button>
        )}
      </div>

      {tab === "Profile" && (
        editing ? (
          <form onSubmit={handleSave} className="card" style={{ maxWidth: 560, marginBottom: 20 }}>
            {saveError && <ErrorBanner error={saveError} />}
            <div className="field"><label htmlFor="emp-name">Name</label><input id="emp-name" required value={form.employeeName} onChange={(e) => setForm((f) => ({ ...f, employeeName: e.target.value }))} /></div>
            <div className="field">
              <label htmlFor="emp-worker-type">Worker Type</label>
              <select
                id="emp-worker-type"
                value={form.workerType}
                onChange={(e) => {
                  const workerType = e.target.value;
                  // A contractor is always paid 1099; an employee never is — keep
                  // Pay Type from silently drifting out of sync with Worker Type
                  // (this let a W-2 employee get saved as a 1099 payee before).
                  setForm((f) => ({ ...f, workerType, payType: workerType === "Contractor" ? "1099" : (f.payType === "1099" ? "Hourly" : f.payType) }));
                }}
              >
                <option>Employee</option>
                <option>Contractor</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="emp-pay-type">Pay Type</label>
              <select id="emp-pay-type" value={form.payType} onChange={(e) => setForm((f) => ({ ...f, payType: e.target.value }))}>
                {form.workerType === "Contractor" ? <option>1099</option> : <><option>Hourly</option><option>Salary</option></>}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field"><label htmlFor="emp-pay-rate">Pay Rate</label><input id="emp-pay-rate" type="number" step="0.01" value={form.payRate} onChange={(e) => setForm((f) => ({ ...f, payRate: e.target.value }))} /></div>
              <div className="field"><label htmlFor="emp-default-hours">Default Hours</label><input id="emp-default-hours" type="number" value={form.defaultHours} onChange={(e) => setForm((f) => ({ ...f, defaultHours: e.target.value }))} /></div>
            </div>
            <div className="field"><label htmlFor="emp-default-gross-wages">Default Gross Wages</label><input id="emp-default-gross-wages" type="number" step="0.01" value={form.defaultGrossWages} onChange={(e) => setForm((f) => ({ ...f, defaultGrossWages: e.target.value }))} /></div>
            <div className="field">
              <label htmlFor="emp-pay-frequency">Pay Frequency (drives withholding calculation)</label>
              <select id="emp-pay-frequency" value={form.payFrequency} onChange={(e) => setForm((f) => ({ ...f, payFrequency: e.target.value }))}>
                <option value="">Select…</option>
                {PAYROLL_FREQS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            {form.workerType === "Contractor" && (
              <div className="field"><label htmlFor="emp-service-category">Service Category</label><input id="emp-service-category" value={form.serviceCategory} onChange={(e) => setForm((f) => ({ ...f, serviceCategory: e.target.value }))} /></div>
            )}
            <div className="field"><label htmlFor="emp-email">Email</label><input id="emp-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
            <div className="field"><label htmlFor="emp-phone">Phone</label><input id="emp-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
              <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <div className="card" style={{ maxWidth: 560, marginBottom: 20 }}>
            {canEdit && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
                <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>
              </div>
            )}
            {/* The basics repeat the header on purpose — this card is what gets
                read (and screenshotted) as "the profile", so it must stand alone. */}
            <div className="detail-field-grid">
              <DetailField label="Name" value={employee.employee_name} />
              <DetailField label="Worker Type" value={employee.worker_type || "Employee"} />
              <DetailField label="Status" value={employee.status} />
              <DetailField label="Client" value={employee.client_name as string} />
              <DetailField label="Home State (payroll)" value={(employee as any).state} />
              <DetailField label="Pay Type" value={employee.pay_type} />
              <DetailField label="Pay Rate" value={fmtMoney(employee.pay_rate)} />
              <DetailField label="Default Hours" value={employee.default_hours != null ? String(employee.default_hours) : null} />
              <DetailField label="Default Gross Wages" value={fmtMoney(employee.default_gross_wages)} />
              <DetailField label="Pay Frequency" value={employee.pay_frequency} />
              {isContractor && <DetailField label="Service Category" value={employee.service_category} />}
              <DetailField label="Email" value={employee.email} />
              <DetailField label="Phone" value={employee.phone} />
            </div>
          </div>
        )
      )}

      {tab === "Profile" && scheduleLoaded && canEdit && (
        <div className="card" style={{ maxWidth: 560, marginBottom: 20 }}>
          <div className="command-panel-header" style={{ padding: 0, marginBottom: 12, borderBottom: "none" }}>
            <div>
              <h2 className="command-panel-title" style={{ fontSize: 15 }}>Auto-Draft Payroll</h2>
              <div className="command-panel-note">
                A few days before each payday, a draft paycheck shows up for staff to review and approve — nothing is ever posted without an explicit Approve click.
              </div>
            </div>
          </div>
          {(() => {
            if (!schedule) {
              return (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="status-pill status-gray">Not enrolled</span>
                  </div>
                  <Link to={`/accounting?client=${employee.client_id}&tab=Payroll`} className="btn btn-sm" style={{ marginTop: 10, display: "inline-block" }}>Turn on under Accounting → Payroll →</Link>
                </>
              );
            }
            const isOn = schedule.status === "Active";
            const ineligibleReason = employee ? payrollAgentIneligibleReason(employee) : null;
            return (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span className={`status-pill ${isOn ? "status-green" : "status-gray"}`}>{isOn ? "On" : "Off"}</span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {schedule.frequency} · payday {fmtDateOnly(schedule.next_pay_date)}
                    {isOn && (schedule.drafts_from <= new Date().toISOString().slice(0, 10)
                      ? " · draft ready on the next run"
                      : ` · draft appears ${fmtDateOnly(schedule.drafts_from)}`)}
                  </span>
                </div>
                {ineligibleReason && isOn && (
                  <p className="muted" style={{ fontSize: 12, color: "var(--amber)", marginTop: 6 }}>{ineligibleReason} The agent will skip this employee until this is resolved.</p>
                )}
                <Link to={`/accounting?client=${employee.client_id}&tab=Payroll`} className="muted" style={{ display: "inline-block", marginTop: 8, fontSize: 13 }}>Manage under Accounting → Payroll →</Link>
              </>
            );
          })()}
        </div>
      )}

      {tab === "Sensitive Info" && (
        <div className="card" style={{ maxWidth: 560 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ fontSize: 15, margin: 0 }}>Sensitive Info (SSN/EIN/TIN, bank, W-9)</h2>
            {isAdmin && !editingSensitive && <button className="btn btn-sm" onClick={sensitive ? startEditSensitive : handleReveal} disabled={revealing}>{revealing ? "Decrypting…" : sensitive ? "Edit" : "Reveal & Edit"}</button>}
          </div>
          <p className="muted" style={{ marginBottom: 12 }}>SSN/EIN/TIN and bank account numbers are encrypted; only admins can reveal or edit them.</p>
          {!isAdmin && (
            <div className="detail-field-grid">
              <DetailField label="W-9 Status" value={employee.w9_status as string | undefined} />
              <DetailField label="1099 Eligible" value={employee.is_1099_eligible ? "Yes" : "No"} />
              <DetailField label="Bank Account" value={employee.bank_last4 ? `****${employee.bank_last4}` : null} />
            </div>
          )}
          {isAdmin && !sensitive && !editingSensitive && (
            <div className="detail-field-grid">
              <DetailField label="W-9 Status" value={employee.w9_status as string | undefined} />
              <DetailField label="1099 Eligible" value={employee.is_1099_eligible ? "Yes" : "No"} />
              <DetailField label="Bank Account" value={employee.bank_last4 ? `****${employee.bank_last4}` : null} />
            </div>
          )}
          {isAdmin && sensitive && !editingSensitive && (
            <div className="detail-field-grid">
              <DetailField label="SSN" value={sensitive.ssn} />
              <DetailField label="EIN" value={sensitive.ein} />
              <DetailField label="TIN" value={sensitive.tin} />
              <DetailField label="Street Address" value={sensitive.streetAddress || sensitive.address} />
              <DetailField label="City" value={sensitive.city} />
              <DetailField label="Home State (drives state withholding/SUTA)" value={sensitive.state} />
              <DetailField label="ZIP" value={sensitive.zipCode} />
              <DetailField label="Federal Filing Status" value={sensitive.federalFilingStatus} />
              <DetailField label="State Filing Status" value={sensitive.stateFilingStatus} />
              <DetailField label="Maryland County" value={sensitive.county} />
              <DetailField label="MD Exemptions (Form MW507)" value={sensitive.mdExemptions != null && sensitive.mdExemptions !== "" ? String(sensitive.mdExemptions) : null} />
              <DetailField label="State Exemptions (VA-4 / DC / DE)" value={sensitive.stateExemptions != null && sensitive.stateExemptions !== "" ? String(sensitive.stateExemptions) : null} />
              <DetailField label="VA Age 65+/Blind Exemptions" value={sensitive.ageBlindExemptions != null && sensitive.ageBlindExemptions !== "" ? String(sensitive.ageBlindExemptions) : null} />
              <DetailField label="W-9 Status" value={sensitive.w9Status} />
              <DetailField label="TIN Verification" value={sensitive.tinVerificationStatus} />
              <DetailField label="Vendor Classification" value={sensitive.vendorClassification} />
              <DetailField label="Contractor Payment Type" value={sensitive.contractorPaymentType} />
              <DetailField label="Fixed Project Amount" value={sensitive.fixedProjectAmount != null ? fmtMoney(sensitive.fixedProjectAmount) : null} />
              <DetailField label="1099 Eligible" value={sensitive.is1099Eligible ? "Yes" : "No"} />
              <DetailField label="Payment Method" value={sensitive.paymentMethod} />
              <DetailField label="Direct Deposit" value={sensitive.directDeposit ? "Yes" : "No"} />
              <DetailField label="Bank Name" value={sensitive.paymentBankName} />
              <DetailField label="Routing Number" value={sensitive.paymentRoutingNumber} />
              <DetailField label="Account Number" value={sensitive.paymentAccountNumber} />
              <DetailField label="Account Type" value={sensitive.paymentAccountType} />
            </div>
          )}
          {isAdmin && editingSensitive && (
            <form onSubmit={handleSaveSensitive}>
              {sensitiveError && <ErrorBanner error={sensitiveError} />}
              <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>Leave SSN/EIN/TIN or bank fields blank to keep the values already on file — only fill them in to replace them.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field"><label htmlFor="emp-sensitive-ssn">SSN (leave blank to keep current)</label><input id="emp-sensitive-ssn" value={sensitiveForm.ssn} onChange={(e) => setSensitiveForm((f) => ({ ...f, ssn: e.target.value }))} /></div>
                <div className="field"><label htmlFor="emp-sensitive-ein">EIN (leave blank to keep current)</label><input id="emp-sensitive-ein" value={sensitiveForm.ein} onChange={(e) => setSensitiveForm((f) => ({ ...f, ein: e.target.value }))} /></div>
              </div>
              <div className="field"><label htmlFor="emp-sensitive-tin">TIN (leave blank to keep current)</label><input id="emp-sensitive-tin" value={sensitiveForm.tin} onChange={(e) => setSensitiveForm((f) => ({ ...f, tin: e.target.value }))} /></div>
              <AddressFields
                idPrefix="emp-detail"
                value={{ street: sensitiveForm.streetAddress, city: sensitiveForm.city, state: sensitiveForm.state, zip: sensitiveForm.zipCode }}
                onChange={(patch) => setSensitiveForm((f) => ({
                  ...f,
                  streetAddress: patch.street ?? f.streetAddress,
                  city: patch.city ?? f.city,
                  zipCode: patch.zip ?? f.zipCode,
                  state: patch.state ?? f.state,
                }))}
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field">
                  <label htmlFor="emp-sensitive-federal-filing-status">Federal Filing Status (drives federal withholding)</label>
                  <select id="emp-sensitive-federal-filing-status" value={sensitiveForm.federalFilingStatus} onChange={(e) => setSensitiveForm((f) => ({ ...f, federalFilingStatus: e.target.value }))}>
                    <option value="">Select…</option>
                    {FEDERAL_FILING_STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="emp-sensitive-state-filing-status">State Filing Status (drives MD/DE withholding)</label>
                  <select id="emp-sensitive-state-filing-status" value={sensitiveForm.stateFilingStatus} onChange={(e) => setSensitiveForm((f) => ({ ...f, stateFilingStatus: e.target.value }))}>
                    <option value="">Select…</option>
                    {MD_FILING_STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              {String(sensitiveForm.state || "").trim().toUpperCase() === "MD" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="field">
                    <label htmlFor="emp-sensitive-county">Maryland County (drives local withholding)</label>
                    <select id="emp-sensitive-county" value={sensitiveForm.county} onChange={(e) => setSensitiveForm((f) => ({ ...f, county: e.target.value }))}>
                      <option value="">Select…</option>
                      {MD_COUNTIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="emp-sensitive-md-exemptions">MD Exemptions (Form MW507)</label>
                    <input id="emp-sensitive-md-exemptions" type="number" min="0" step="1" value={sensitiveForm.mdExemptions} onChange={(e) => setSensitiveForm((f) => ({ ...f, mdExemptions: e.target.value }))} placeholder="0" />
                  </div>
                </div>
              )}
              {String(sensitiveForm.state || "").trim().toUpperCase() === "VA" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="field">
                    <label htmlFor="emp-sensitive-va-exemptions">VA Exemptions (Form VA-4, personal + dependents)</label>
                    <input id="emp-sensitive-va-exemptions" type="number" min="0" step="1" value={sensitiveForm.stateExemptions} onChange={(e) => setSensitiveForm((f) => ({ ...f, stateExemptions: e.target.value }))} placeholder="0" />
                  </div>
                  <div className="field">
                    <label htmlFor="emp-sensitive-va-age-blind">VA Age 65+/Blind Exemptions (Form VA-4)</label>
                    <input id="emp-sensitive-va-age-blind" type="number" min="0" step="1" value={sensitiveForm.ageBlindExemptions} onChange={(e) => setSensitiveForm((f) => ({ ...f, ageBlindExemptions: e.target.value }))} placeholder="0" />
                  </div>
                </div>
              )}
              {String(sensitiveForm.state || "").trim().toUpperCase() === "DC" && (
                <div className="field">
                  <label htmlFor="emp-sensitive-dc-dependents">DC Dependents (drives DC withholding)</label>
                  <input id="emp-sensitive-dc-dependents" type="number" min="0" step="1" value={sensitiveForm.stateExemptions} onChange={(e) => setSensitiveForm((f) => ({ ...f, stateExemptions: e.target.value }))} placeholder="0" />
                </div>
              )}
              {String(sensitiveForm.state || "").trim().toUpperCase() === "DE" && (
                <div className="field">
                  <label htmlFor="emp-sensitive-de-exemptions">DE Exemptions ($110 credit each, drives DE withholding)</label>
                  <input id="emp-sensitive-de-exemptions" type="number" min="0" step="1" value={sensitiveForm.stateExemptions} onChange={(e) => setSensitiveForm((f) => ({ ...f, stateExemptions: e.target.value }))} placeholder="0" />
                </div>
              )}
              <div className="field"><label htmlFor="emp-sensitive-w9-status">W-9 Status</label><input id="emp-sensitive-w9-status" value={sensitiveForm.w9Status} onChange={(e) => setSensitiveForm((f) => ({ ...f, w9Status: e.target.value }))} placeholder="e.g. Received, Pending" /></div>
              {isContractor && (
                <>
                  <div className="field"><label htmlFor="emp-sensitive-tin-verification">TIN Verification Status</label><input id="emp-sensitive-tin-verification" value={sensitiveForm.tinVerificationStatus} onChange={(e) => setSensitiveForm((f) => ({ ...f, tinVerificationStatus: e.target.value }))} /></div>
                  <div className="field"><label htmlFor="emp-sensitive-vendor-classification">Vendor Classification</label><input id="emp-sensitive-vendor-classification" value={sensitiveForm.vendorClassification} onChange={(e) => setSensitiveForm((f) => ({ ...f, vendorClassification: e.target.value }))} /></div>
                  <div className="field"><label htmlFor="emp-sensitive-contractor-payment-type">Contractor Payment Type</label><input id="emp-sensitive-contractor-payment-type" value={sensitiveForm.contractorPaymentType} onChange={(e) => setSensitiveForm((f) => ({ ...f, contractorPaymentType: e.target.value }))} /></div>
                  <div className="field"><label htmlFor="emp-sensitive-fixed-project-amount">Fixed Project Amount</label><input id="emp-sensitive-fixed-project-amount" type="number" step="0.01" value={sensitiveForm.fixedProjectAmount} onChange={(e) => setSensitiveForm((f) => ({ ...f, fixedProjectAmount: e.target.value }))} /></div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, margin: "8px 0" }}>
                    <input type="checkbox" checked={sensitiveForm.is1099Eligible} onChange={(e) => setSensitiveForm((f) => ({ ...f, is1099Eligible: e.target.checked }))} />
                    1099 Eligible
                  </label>
                </>
              )}
              <div className="field"><label htmlFor="emp-sensitive-payment-method">Payment Method</label><input id="emp-sensitive-payment-method" value={sensitiveForm.paymentMethod} onChange={(e) => setSensitiveForm((f) => ({ ...f, paymentMethod: e.target.value }))} placeholder="e.g. Direct Deposit, Check" /></div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, margin: "8px 0" }}>
                <input type="checkbox" checked={sensitiveForm.directDeposit} onChange={(e) => setSensitiveForm((f) => ({ ...f, directDeposit: e.target.checked }))} />
                Direct Deposit
              </label>
              <div className="field"><label htmlFor="emp-sensitive-bank-name">Bank Name</label><input id="emp-sensitive-bank-name" value={sensitiveForm.paymentBankName} onChange={(e) => setSensitiveForm((f) => ({ ...f, paymentBankName: e.target.value }))} /></div>
              <div className="field"><label htmlFor="emp-sensitive-routing-number">Routing Number</label><input id="emp-sensitive-routing-number" value={sensitiveForm.paymentRoutingNumber} onChange={(e) => setSensitiveForm((f) => ({ ...f, paymentRoutingNumber: e.target.value }))} placeholder="Leave blank to keep current" /></div>
              <div className="field"><label htmlFor="emp-sensitive-account-number">Account Number</label><input id="emp-sensitive-account-number" value={sensitiveForm.paymentAccountNumber} onChange={(e) => setSensitiveForm((f) => ({ ...f, paymentAccountNumber: e.target.value }))} placeholder="Leave blank to keep current" /></div>
              <div className="field"><label htmlFor="emp-sensitive-account-type">Account Type</label><input id="emp-sensitive-account-type" value={sensitiveForm.paymentAccountType} onChange={(e) => setSensitiveForm((f) => ({ ...f, paymentAccountType: e.target.value }))} placeholder="Checking / Savings" /></div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button type="submit" className="btn btn-primary" disabled={sensitiveSaving}>{sensitiveSaving ? "Saving…" : "Save changes"}</button>
                <button type="button" className="btn" onClick={() => setEditingSensitive(false)}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}

      {tab === "Documents" && canEdit && (
        <EmployeeDocumentsSection
          employeeId={employee.employee_id} employeeName={employee.employee_name}
          clientId={employee.client_id as string} clientName={employee.client_name as string}
        />
      )}

      {tab === "Tax Documents" && canEdit && (
        <>
          <TaxDocumentsSection employeeId={employee.employee_id} employeeName={employee.employee_name} isContractor={isContractor} />
          <div style={{ marginTop: 16 }}>
            {isContractor
              ? <EmployeeGovFormSection employeeId={employee.employee_id} employeeName={employee.employee_name} formType="W9" title="Form W-9" />
              : <EmployeeGovFormSection employeeId={employee.employee_id} employeeName={employee.employee_name} formType="W4" title="Form W-4" />}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Every real tax form this employee/contractor has — one row per year they
 * actually have payroll/payment history for (via GET .../tax-years), not a bare
 * year-number box the user has to guess into. Replaces the old header's Tax Year
 * + View/Download W-2 cluster, which sat unlabeled next to unrelated buttons.
 */
function TaxDocumentsSection({ employeeId, employeeName, isContractor }: { employeeId: string; employeeName: string; isContractor: boolean }) {
  const notify = useNotify();
  const [years, setYears] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyYear, setBusyYear] = useState<string | null>(null);

  function load() {
    api.get<{ years: number[] }>(`/accounting/employees/${employeeId}/tax-years`)
      .then((res) => setYears(res.years))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this employee's tax years."));
  }
  useEffect(load, [employeeId]);

  const formLabel = isContractor ? "1099-NEC" : "W-2";
  function formPath(year: number) {
    return isContractor
      ? `/accounting/tax-forms/1099nec/${employeeId}?year=${year}`
      : `/accounting/tax-forms/w2/${employeeId}?year=${year}`;
  }

  async function handleView(year: number) {
    setBusyYear(`view-${year}`);
    try {
      await viewFile(formPath(year));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not generate this tax form.");
    } finally {
      setBusyYear(null);
    }
  }
  async function handleDownload(year: number) {
    setBusyYear(`download-${year}`);
    try {
      const filename = buildFilename([employeeName, isContractor ? "Form 1099-NEC" : "Form W-2", String(year)], "pdf");
      await downloadFile(formPath(year), filename);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not generate this tax form.");
    } finally {
      setBusyYear(null);
    }
  }
  async function handlePrint(year: number) {
    setBusyYear(`print-${year}`);
    try {
      await printFile(formPath(year));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not generate this tax form.");
    } finally {
      setBusyYear(null);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 560, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
        <strong style={{ fontSize: 14 }}>Tax Documents</strong>
        <p className="muted" style={{ fontSize: 12, margin: "2px 0 0" }}>Every year {employeeName} has real payroll/payment history for — {formLabel} is generated fresh each time from that year's records.</p>
      </div>
      {error && <div style={{ padding: 16 }}><ErrorBanner error={error} /></div>}
      {!years ? (
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>Loading…</p>
      ) : years.length === 0 ? (
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>No {String(new Date().getFullYear())}-or-earlier payroll/payment history yet — nothing to generate a {formLabel} from.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">Year</th><th scope="col">Action</th></tr></thead>
            <tbody>
              {years.map((year) => (
                <tr key={year}>
                  <td>{year}</td>
                  <td style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="link-button" disabled={busyYear === `view-${year}`} onClick={() => handleView(year)}>
                      {busyYear === `view-${year}` ? "Generating…" : `View ${formLabel}`}
                    </button>
                    <button type="button" className="link-button" disabled={busyYear === `download-${year}`} onClick={() => handleDownload(year)}>
                      {busyYear === `download-${year}` ? "Generating…" : "Download"}
                    </button>
                    <button type="button" className="link-button" disabled={busyYear === `print-${year}`} onClick={() => handlePrint(year)}>
                      {busyYear === `print-${year}` ? "Printing…" : "Print"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Form W-4 or W-9 — the employee/contractor's own withholding certificate or
 * TIN certification, kept on file with their employer/payer. Never sent to
 * the IRS (unlike W-2/1099 above, which report to the agency), so "Mark
 * Submitted" here just means "filed away," not "mailed somewhere."
 *
 * Two ways to get a signature: staff fills it out and records an in-person
 * wet-ink signature ("Sign Now" — unchanged, existing flow), or staff sends
 * a mostly-blank draft to the person's own portal for them to complete and
 * electronically sign themselves ("Send to employee to sign" — new; see
 * govForms.routes.ts's /employee/:employeeId/send and /my/:filingId/sign).
 */
function EmployeeGovFormSection({ employeeId, employeeName, formType, title }: { employeeId: string; employeeName: string; formType: "W4" | "W9"; title: string }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();
  const notify = useNotify();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [filings, setFilings] = useState<GovFormFiling[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [signInPersonFor, setSignInPersonFor] = useState<string | null>(null);
  const [signInPersonForm, setSignInPersonForm] = useState({ signerName: "", signerTitle: "" });
  const [submitFor, setSubmitFor] = useState<string | null>(null);
  const [submitForm, setSubmitForm] = useState({ submittedVia: GOV_SUBMIT_VIA_OPTIONS[0], submittedNote: "" });

  function load() {
    api.get<{ filings: GovFormFiling[] }>(`/gov-forms/employee/${employeeId}`)
      .then((res) => setFilings(res.filings.filter((f) => f.form_type === formType)))
      .catch((err) => setError(err instanceof ApiError ? err.message : `Could not load ${title} filings.`));
  }
  useEffect(load, [employeeId, formType]);

  // A filing signed via the employee-portal e-sign flow has its real signed PDF
  // (with the typed signature actually burned onto it) stored as a document —
  // GET /:filingId/pdf only ever regenerates an unsigned copy from form_data, so
  // it's wrong for those. A filing signed the old in-person way has no stored
  // document at all (nothing to overlay a signature onto), so it still uses the
  // regenerate route.
  async function handlePdf(f: GovFormFiling, mode: "view" | "download" | "print") {
    setBusy(`pdf-${f.filing_id}`);
    try {
      const path = f.attached_upload_id ? `/documents/uploads/${f.attached_upload_id}/download` : `/gov-forms/${f.filing_id}/pdf`;
      if (mode === "view") await viewFile(path);
      else if (mode === "print") await printFile(path);
      else await downloadFile(path, buildFilename([employeeName, formType === "W4" ? "Form W-4" : "Form W-9"], "pdf"));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not open this form's PDF.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSend() {
    setSending(true);
    try {
      await api.post(`/gov-forms/employee/${employeeId}/send`, { formType });
      toast(`${title} sent — they can now fill it in and sign from their own portal.`);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not send this form.");
    } finally {
      setSending(false);
    }
  }

  function openSignInPerson(f: GovFormFiling) {
    setSignInPersonForm({ signerName: "", signerTitle: "" });
    setSignInPersonFor(signInPersonFor === f.filing_id ? null : f.filing_id);
  }

  async function handleSignInPerson(f: GovFormFiling) {
    setBusy(`signip-${f.filing_id}`);
    try {
      await api.post(`/gov-forms/${f.filing_id}/sign`, signInPersonForm);
      toast("Recorded as signed.");
      setSignInPersonFor(null);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not record this signature.");
    } finally {
      setBusy(null);
    }
  }

  function openSubmit(f: GovFormFiling) {
    setSubmitForm({ submittedVia: GOV_SUBMIT_VIA_OPTIONS[0], submittedNote: "" });
    setSubmitFor(submitFor === f.filing_id ? null : f.filing_id);
  }

  async function handleSubmitted(f: GovFormFiling) {
    setBusy(`submit-${f.filing_id}`);
    try {
      await api.post(`/gov-forms/${f.filing_id}/submit`, submitForm);
      toast("Marked submitted.");
      setSubmitFor(null);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not mark this submitted.");
    } finally {
      setBusy(null);
    }
  }

  async function handleVoid(f: GovFormFiling) {
    const reason = await promptFor({ title: "Void filing", message: `Reason for voiding ${GOV_FORM_LABELS[f.form_type]}?` });
    if (reason === null) return;
    setBusy(`void-${f.filing_id}`);
    try {
      await api.post(`/gov-forms/${f.filing_id}/void`, { reason });
      toast("Filing voided.");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not void this filing.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(f: GovFormFiling) {
    const ok = await confirmDialog({ title: "Delete draft", message: `Delete this draft ${title}? This can't be undone.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    setBusy(`delete-${f.filing_id}`);
    try {
      await api.post(`/gov-forms/${f.filing_id}/delete`, {});
      toast("Draft filing deleted.");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this filing.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 620, padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="btn btn-sm" disabled={sending} onClick={handleSend}>
            {sending ? "Sending…" : "Send to employee to sign"}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setGenerating(true)}>+ Generate {title.replace("Form ", "")}</button>
        </div>
      </div>

      {error && <ErrorBanner error={error} style={{ margin: 16 }} />}

      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Status</th><th scope="col">Signed</th><th scope="col">Submitted</th><th scope="col">Action</th></tr></thead>
          <tbody>
            {(filings || []).map((f) => (
              <Fragment key={f.filing_id}>
                <tr>
                  <td>
                    <span style={{ color: GOV_STATUS_COLOR[f.status] || "inherit", fontWeight: 700, fontSize: 12 }}>{f.status}</span>
                    {f.status === "Draft" && f.sent_to_employee_at && (
                      <div className="muted" style={{ fontSize: 11 }}>Sent {fmtDateTime(f.sent_to_employee_at)} — awaiting their signature</div>
                    )}
                  </td>
                  <td className="muted">
                    {f.signer_name ? `${f.signer_name}${f.signed_at ? ` · ${fmtDateTime(f.signed_at)}` : ""}` : "—"}
                  </td>
                  <td className="muted">
                    {f.submitted_via ? `${f.submitted_via}${f.submitted_at ? ` · ${fmtDateTime(f.submitted_at)}` : ""}` : "—"}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {!(f.status === "Draft" && f.sent_to_employee_at) && (
                        <>
                          <button type="button" className="btn btn-sm" disabled={busy === `pdf-${f.filing_id}`} onClick={() => handlePdf(f, "view")}>View PDF</button>
                          <button type="button" className="btn btn-sm" disabled={busy === `pdf-${f.filing_id}`} onClick={() => handlePdf(f, "download")}>Download</button>
                          <button type="button" className="btn btn-sm" disabled={busy === `pdf-${f.filing_id}`} onClick={() => handlePdf(f, "print")}>Print</button>
                        </>
                      )}
                      {f.status === "Draft" && !f.sent_to_employee_at && (
                        <button type="button" className="btn btn-sm" disabled={busy === `signip-${f.filing_id}`} onClick={() => openSignInPerson(f)}>Sign Now</button>
                      )}
                      {f.status === "Signed" && (
                        <>
                          <button type="button" className="btn btn-sm" disabled={busy === `pdf-${f.filing_id}`} onClick={() => handlePdf(f, "view")}>View PDF</button>
                          <button type="button" className="btn btn-sm" disabled={busy === `pdf-${f.filing_id}`} onClick={() => handlePdf(f, "download")}>Download</button>
                          <button type="button" className="btn btn-sm" disabled={busy === `pdf-${f.filing_id}`} onClick={() => handlePdf(f, "print")}>Print</button>
                          <button type="button" className="btn btn-sm" disabled={busy === `submit-${f.filing_id}`} onClick={() => openSubmit(f)}>Mark Filed</button>
                        </>
                      )}
                      {isAdmin && f.status !== "Void" && (
                        <button type="button" className="btn btn-sm btn-danger" disabled={busy === `void-${f.filing_id}`} onClick={() => handleVoid(f)}>Void</button>
                      )}
                      {isAdmin && f.status === "Draft" && (
                        <button type="button" className="btn btn-sm btn-danger" disabled={busy === `delete-${f.filing_id}`} onClick={() => handleDelete(f)}>Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
                {signInPersonFor === f.filing_id && (
                  <tr>
                    <td colSpan={4} style={{ background: "var(--surface)" }}>
                      <div style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                        <div className="field" style={{ maxWidth: 220 }}>
                          <label htmlFor={`emp-gov-signer-name-${f.filing_id}`}>Signer's Full Legal Name</label>
                          <input id={`emp-gov-signer-name-${f.filing_id}`} value={signInPersonForm.signerName} onChange={(e) => setSignInPersonForm((s) => ({ ...s, signerName: e.target.value }))} />
                        </div>
                        <div className="field" style={{ maxWidth: 160 }}>
                          <label htmlFor={`emp-gov-signer-title-${f.filing_id}`}>Title (optional)</label>
                          <input id={`emp-gov-signer-title-${f.filing_id}`} value={signInPersonForm.signerTitle} onChange={(e) => setSignInPersonForm((s) => ({ ...s, signerTitle: e.target.value }))} />
                        </div>
                        <button
                          type="button" className="btn btn-primary btn-sm"
                          disabled={busy === `signip-${f.filing_id}` || !signInPersonForm.signerName.trim()}
                          onClick={() => handleSignInPerson(f)}
                        >
                          {busy === `signip-${f.filing_id}` ? "Recording…" : "Confirm Signed"}
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setSignInPersonFor(null)}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                )}
                {submitFor === f.filing_id && (
                  <tr>
                    <td colSpan={4} style={{ background: "var(--surface)" }}>
                      <div style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                        <div className="field" style={{ maxWidth: 200 }}>
                          <label htmlFor={`emp-gov-submitted-via-${f.filing_id}`}>Status</label>
                          <select id={`emp-gov-submitted-via-${f.filing_id}`} value={submitForm.submittedVia} onChange={(e) => setSubmitForm((s) => ({ ...s, submittedVia: e.target.value }))}>
                            {GOV_SUBMIT_VIA_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </div>
                        <div className="field" style={{ maxWidth: 260 }}>
                          <label htmlFor={`emp-gov-submitted-note-${f.filing_id}`}>Note (optional)</label>
                          <input id={`emp-gov-submitted-note-${f.filing_id}`} value={submitForm.submittedNote} onChange={(e) => setSubmitForm((s) => ({ ...s, submittedNote: e.target.value }))} />
                        </div>
                        <button type="button" className="btn btn-primary btn-sm" disabled={busy === `submit-${f.filing_id}`} onClick={() => handleSubmitted(f)}>
                          {busy === `submit-${f.filing_id}` ? "Saving…" : "Confirm"}
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setSubmitFor(null)}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {filings && filings.length === 0 && (
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>No {title} on file yet.</p>
      )}

      {generating && formType === "W4" && (
        <GenerateW4Modal employeeId={employeeId} onClose={() => setGenerating(false)} onDone={load} />
      )}
      {generating && formType === "W9" && (
        <GenerateW9Modal employeeId={employeeId} onClose={() => setGenerating(false)} onDone={load} />
      )}
    </div>
  );
}

/**
 * This employee's own documents — belongs entirely to them, no client picker, no
 * "which portal" question. Mirrors ClientDocumentsSection on the client profile: the
 * record you're looking at owns its own file exchange. Answers the exact confusion
 * flagged live with the old "Upload to Employee Portal" flow (pick a client, then
 * pick an employee from THAT client, from a page that has nothing to do with either) —
 * here the employee is already fixed, so sending them a file is one button.
 */
function EmployeeDocumentsSection({ employeeId, employeeName, clientId, clientName }: { employeeId: string; employeeName: string; clientId: string; clientName: string }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const [uploads, setUploads] = useState<DocumentUpload[] | null>(null);
  const [requests, setRequests] = useState<DocumentRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  function load() {
    api.get<{ uploads: DocumentUpload[] }>("/documents/uploads")
      .then((r) => setUploads(r.uploads.filter((u) => u.employee_id === employeeId && u.status !== "Removed")))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load this employee's documents."));
    api.get<{ requests: DocumentRequest[] }>("/documents/requests")
      .then((r) => setRequests(r.requests.filter((q) => q.employee_id === employeeId)))
      .catch(() => setRequests([]));
  }
  useEffect(load, [employeeId]);

  const openRequests = (requests || []).filter((r) => !["closed", "completed", "void", "archived"].includes(String(r.status || "").toLowerCase()));

  const active = (uploads || []).filter((u) => !u.hidden_from_staff);
  const archived = (uploads || []).filter((u) => u.hidden_from_staff);

  async function handleRevoke(uploadId: string) {
    const ok = await confirmDialog({
      title: "Revoke file",
      message: `It will disappear from ${employeeName}'s portal too, not just from here. If you just want to clean up this list without affecting them, use Archive instead.`,
      confirmLabel: "Revoke",
      danger: true,
    });
    if (!ok) return;
    setRemovingId(uploadId);
    try {
      await api.post(`/documents/uploads/${uploadId}/remove`, {});
      toast("File revoked.");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not revoke this file.");
    } finally {
      setRemovingId(null);
    }
  }
  async function handleArchive(uploadId: string) {
    setArchivingId(uploadId);
    try {
      await api.post(`/documents/uploads/${uploadId}/archive`, {});
      toast(`Archived — ${employeeName} still sees this file.`);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not archive this file.");
    } finally {
      setArchivingId(null);
    }
  }
  async function handleUnarchive(uploadId: string) {
    setArchivingId(uploadId);
    try {
      await api.post(`/documents/uploads/${uploadId}/unarchive`, {});
      toast("Unarchived.");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not unarchive this file.");
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <>
    <div className="card" style={{ maxWidth: 560, marginBottom: 20, padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", gap: 8 }}>
        <div>
          <strong style={{ fontSize: 14 }}>Files</strong>
          <p className="muted" style={{ fontSize: 12, margin: "2px 0 0" }}>Files sent straight to {employeeName}'s own portal (W-2s, ID copies, etc).</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setUploadOpen(true)}>Send File to Employee</button>
          <button type="button" className="btn btn-sm" onClick={() => setRequestOpen(true)}>Request Document</button>
        </div>
      </div>
      {error && <div style={{ padding: 16 }}><ErrorBanner error={error} /></div>}
      {!uploads ? (
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>Loading…</p>
      ) : active.length === 0 && archived.length === 0 ? (
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>No files shared with this employee yet.</p>
      ) : (
        <div style={{ padding: "4px 16px 12px" }}>
          {active.map((u) => (
            <div key={u.upload_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
              <div>
                <button type="button" className="link-button" style={{ fontWeight: 600 }} onClick={() => openAnyFile(u.file_url)}>{u.file_name}</button>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{u.uploaded_at ? fmtDateTime(u.uploaded_at) : "—"} · {u.uploaded_by || "—"}</div>
                {u.notes && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{u.notes}</div>}
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button type="button" className="link-button" onClick={() => downloadAnyFile(u.file_url, u.file_name)}>Download</button>
                <button type="button" className="link-button" onClick={() => printAnyFile(u.file_url)}>Print</button>
                <button type="button" className="link-button" disabled={archivingId === u.upload_id} onClick={() => handleArchive(u.upload_id)}>{archivingId === u.upload_id ? "…" : "Archive"}</button>
                <button type="button" className="link-button" style={{ color: "var(--red)" }} disabled={removingId === u.upload_id} onClick={() => handleRevoke(u.upload_id)}>{removingId === u.upload_id ? "…" : "Revoke"}</button>
              </div>
            </div>
          ))}
          {archived.map((u) => (
            <div key={u.upload_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 13, opacity: 0.6 }}>
              <div>
                <button type="button" className="link-button" style={{ fontWeight: 600 }} onClick={() => openAnyFile(u.file_url)}>{u.file_name}</button>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Archived — still visible to {employeeName}</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button type="button" className="link-button" onClick={() => downloadAnyFile(u.file_url, u.file_name)}>Download</button>
                <button type="button" className="link-button" onClick={() => printAnyFile(u.file_url)}>Print</button>
                <button type="button" className="link-button" disabled={archivingId === u.upload_id} onClick={() => handleUnarchive(u.upload_id)}>{archivingId === u.upload_id ? "…" : "Unarchive"}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>

    <div className="card" style={{ maxWidth: 560, padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
        <strong style={{ fontSize: 14 }}>Open Requests</strong>
        <span className="muted" style={{ fontSize: 12 }}>{requests ? `${openRequests.length} open` : "Loading…"}</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Requested Item</th><th scope="col">Due</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {openRequests.map((r) => (
              <tr key={r.request_id}>
                <td><Link to={`/documents/${r.request_id}`}>{r.requested_item || "—"}</Link></td>
                <td className="muted">{r.due_from_client ? fmtDateOnly(r.due_from_client) : "—"}</td>
                <td><StatusBadge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {requests && openRequests.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>Nothing outstanding from this employee.</p>}
    </div>

    {uploadOpen && (
      <UploadToPortalModal mode="employee" lockedEmployeeId={employeeId} lockedEmployeeName={employeeName} onClose={() => setUploadOpen(false)} onDone={load} />
    )}
    {requestOpen && (
      <RequestDocumentModal clientId={clientId} clientName={clientName} employeeId={employeeId} employeeName={employeeName} onClose={() => setRequestOpen(false)} onDone={load} />
    )}
    </>
  );
}

