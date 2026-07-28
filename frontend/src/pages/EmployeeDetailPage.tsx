import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, downloadFile, viewFile, openAnyFile, downloadAnyFile } from "../api/client";
import type { Employee, DocumentUpload } from "../api/types2";
import { useAuth } from "../auth/AuthContext";
import { AddressFields } from "../components/AddressFields";
import { ErrorBanner } from "../components/ErrorBanner";
import { UploadToPortalModal } from "../components/UploadToPortalModal";
import { RequestDocumentModal } from "../components/RequestDocumentModal";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/Toast";
import { fmtDateOnly } from "../utils/date";
import type { DocumentRequest } from "../api/types2";

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

interface SensitiveFields {
  ssn: string | null; ein: string | null; tin: string | null; address: string | null;
  streetAddress: string | null; city: string | null; state: string | null; zipCode: string | null;
  federalFilingStatus: string | null; stateFilingStatus: string | null; w9Status: string | null;
  tinVerificationStatus: string | null; vendorClassification: string | null; contractorPaymentType: string | null;
  fixedProjectAmount: number | string | null; is1099Eligible: boolean; paymentMethod: string | null;
  directDeposit: boolean; paymentBankName: string | null; paymentRoutingNumber: string | null;
  paymentAccountNumber: string | null; paymentAccountType: string | null;
}

const SENSITIVE_FORM_DEFAULTS = {
  ssn: "", ein: "", tin: "", address: "", streetAddress: "", city: "", state: "", zipCode: "",
  federalFilingStatus: "", stateFilingStatus: "",
  w9Status: "", tinVerificationStatus: "", vendorClassification: "", contractorPaymentType: "",
  fixedProjectAmount: "", is1099Eligible: false, paymentMethod: "", directDeposit: false,
  paymentBankName: "", paymentRoutingNumber: "", paymentAccountNumber: "", paymentAccountType: "",
};

const EMPLOYEE_TABS = ["Profile", "Sensitive Info", "Documents", "Tax Documents"] as const;
type EmployeeTab = (typeof EMPLOYEE_TABS)[number];

export function EmployeeDetailPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const [searchParams] = useSearchParams();
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
  const [tab, setTab] = useState<EmployeeTab>("Profile");

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
      alert(err instanceof ApiError ? err.message : "Could not change this profile's status.");
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
      alert(err instanceof ApiError ? err.message : "Could not decrypt this profile's sensitive fields.");
    } finally {
      setRevealing(false);
    }
  }

  function startEditSensitive() {
    setSensitiveForm({
      ssn: sensitive?.ssn || "", ein: sensitive?.ein || "", tin: sensitive?.tin || "", address: sensitive?.address || "",
      streetAddress: sensitive?.streetAddress || "", city: sensitive?.city || "", state: sensitive?.state || "", zipCode: sensitive?.zipCode || "",
      federalFilingStatus: sensitive?.federalFilingStatus || "", stateFilingStatus: sensitive?.stateFilingStatus || "",
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
      <Link to={`/accounting?client=${employee.client_id}&tab=${isContractor ? "Contractors" : "Employees"}`} className="muted">← {isContractor ? "Contractors" : "Employees"}</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", margin: "8px 0 24px", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>{employee.employee_name}</h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="muted">{employee.worker_type || "Employee"} · {employee.status}</span>
            <Link to={`/clients/${employee.client_id}`} className="muted">{employee.client_name as string}</Link>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, alignItems: "center", borderBottom: "1px solid var(--line)", marginBottom: 20, flexWrap: "wrap" }}>
        {EMPLOYEE_TABS.map((t) => (
          <div
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "10px 16px", fontSize: 14, fontWeight: 500, cursor: "pointer",
              color: tab === t ? "var(--ink)" : "var(--muted)",
              borderBottom: tab === t ? "2px solid var(--teal)" : "2px solid transparent",
            }}
          >
            {t}
          </div>
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
            <div className="field"><label>Name</label><input required value={form.employeeName} onChange={(e) => setForm((f) => ({ ...f, employeeName: e.target.value }))} /></div>
            <div className="field"><label>Worker Type</label><select value={form.workerType} onChange={(e) => setForm((f) => ({ ...f, workerType: e.target.value }))}><option>Employee</option><option>Contractor</option></select></div>
            <div className="field"><label>Pay Type</label><select value={form.payType} onChange={(e) => setForm((f) => ({ ...f, payType: e.target.value }))}><option>Hourly</option><option>Salary</option><option>1099</option></select></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field"><label>Pay Rate</label><input type="number" step="0.01" value={form.payRate} onChange={(e) => setForm((f) => ({ ...f, payRate: e.target.value }))} /></div>
              <div className="field"><label>Default Hours</label><input type="number" value={form.defaultHours} onChange={(e) => setForm((f) => ({ ...f, defaultHours: e.target.value }))} /></div>
            </div>
            <div className="field"><label>Default Gross Wages</label><input type="number" step="0.01" value={form.defaultGrossWages} onChange={(e) => setForm((f) => ({ ...f, defaultGrossWages: e.target.value }))} /></div>
            <div className="field"><label>Pay Frequency</label><input value={form.payFrequency} onChange={(e) => setForm((f) => ({ ...f, payFrequency: e.target.value }))} placeholder="e.g. Weekly, Bi-Weekly" /></div>
            {form.workerType === "Contractor" && (
              <div className="field"><label>Service Category</label><input value={form.serviceCategory} onChange={(e) => setForm((f) => ({ ...f, serviceCategory: e.target.value }))} /></div>
            )}
            <div className="field"><label>Email</label><input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
            <div className="field"><label>Phone</label><input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
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
            <DetailRow label="Name" value={employee.employee_name} />
            <DetailRow label="Worker Type" value={employee.worker_type || "Employee"} />
            <DetailRow label="Status" value={employee.status} />
            <DetailRow label="Client" value={employee.client_name as string} />
            <DetailRow label="Home State (payroll)" value={(employee as any).state} />
            <DetailRow label="Pay Type" value={employee.pay_type} />
            <DetailRow label="Pay Rate" value={fmtMoney(employee.pay_rate)} />
            <DetailRow label="Default Hours" value={employee.default_hours != null ? String(employee.default_hours) : null} />
            <DetailRow label="Default Gross Wages" value={fmtMoney(employee.default_gross_wages)} />
            <DetailRow label="Pay Frequency" value={employee.pay_frequency} />
            {isContractor && <DetailRow label="Service Category" value={employee.service_category} />}
            <DetailRow label="Email" value={employee.email} />
            <DetailRow label="Phone" value={employee.phone} />
          </div>
        )
      )}

      {tab === "Sensitive Info" && (
        <div className="card" style={{ maxWidth: 560 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ fontSize: 15, margin: 0 }}>Sensitive Info (SSN/EIN/TIN, bank, W-9)</h2>
            {isAdmin && !editingSensitive && <button className="btn btn-sm" onClick={sensitive ? startEditSensitive : handleReveal} disabled={revealing}>{revealing ? "Decrypting…" : sensitive ? "Edit" : "Reveal & Edit"}</button>}
          </div>
          <p className="muted" style={{ marginBottom: 12 }}>SSN/EIN/TIN and bank account numbers are encrypted; only admins can reveal or edit them.</p>
          {!isAdmin && (
            <>
              <DetailRow label="W-9 Status" value={employee.w9_status as string | undefined} />
              <DetailRow label="1099 Eligible" value={employee.is_1099_eligible ? "Yes" : "No"} />
              <DetailRow label="Bank Account" value={employee.bank_last4 ? `****${employee.bank_last4}` : null} />
            </>
          )}
          {isAdmin && !sensitive && !editingSensitive && (
            <>
              <DetailRow label="W-9 Status" value={employee.w9_status as string | undefined} />
              <DetailRow label="1099 Eligible" value={employee.is_1099_eligible ? "Yes" : "No"} />
              <DetailRow label="Bank Account" value={employee.bank_last4 ? `****${employee.bank_last4}` : null} />
            </>
          )}
          {isAdmin && sensitive && !editingSensitive && (
            <>
              <DetailRow label="SSN" value={sensitive.ssn} />
              <DetailRow label="EIN" value={sensitive.ein} />
              <DetailRow label="TIN" value={sensitive.tin} />
              <DetailRow label="Street Address" value={sensitive.streetAddress || sensitive.address} />
              <DetailRow label="City" value={sensitive.city} />
              <DetailRow label="Home State (drives state withholding/SUTA)" value={sensitive.state} />
              <DetailRow label="ZIP" value={sensitive.zipCode} />
              <DetailRow label="Federal Filing Status" value={sensitive.federalFilingStatus} />
              <DetailRow label="State Filing Status" value={sensitive.stateFilingStatus} />
              <DetailRow label="W-9 Status" value={sensitive.w9Status} />
              <DetailRow label="TIN Verification" value={sensitive.tinVerificationStatus} />
              <DetailRow label="Vendor Classification" value={sensitive.vendorClassification} />
              <DetailRow label="Contractor Payment Type" value={sensitive.contractorPaymentType} />
              <DetailRow label="Fixed Project Amount" value={sensitive.fixedProjectAmount != null ? fmtMoney(sensitive.fixedProjectAmount) : null} />
              <DetailRow label="1099 Eligible" value={sensitive.is1099Eligible ? "Yes" : "No"} />
              <DetailRow label="Payment Method" value={sensitive.paymentMethod} />
              <DetailRow label="Direct Deposit" value={sensitive.directDeposit ? "Yes" : "No"} />
              <DetailRow label="Bank Name" value={sensitive.paymentBankName} />
              <DetailRow label="Routing Number" value={sensitive.paymentRoutingNumber} />
              <DetailRow label="Account Number" value={sensitive.paymentAccountNumber} />
              <DetailRow label="Account Type" value={sensitive.paymentAccountType} />
            </>
          )}
          {isAdmin && editingSensitive && (
            <form onSubmit={handleSaveSensitive}>
              {sensitiveError && <ErrorBanner error={sensitiveError} />}
              <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>Leave SSN/EIN/TIN or bank fields blank to keep the values already on file — only fill them in to replace them.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field"><label>SSN (leave blank to keep current)</label><input value={sensitiveForm.ssn} onChange={(e) => setSensitiveForm((f) => ({ ...f, ssn: e.target.value }))} /></div>
                <div className="field"><label>EIN (leave blank to keep current)</label><input value={sensitiveForm.ein} onChange={(e) => setSensitiveForm((f) => ({ ...f, ein: e.target.value }))} /></div>
              </div>
              <div className="field"><label>TIN (leave blank to keep current)</label><input value={sensitiveForm.tin} onChange={(e) => setSensitiveForm((f) => ({ ...f, tin: e.target.value }))} /></div>
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
                <div className="field"><label>Federal Filing Status</label><input value={sensitiveForm.federalFilingStatus} onChange={(e) => setSensitiveForm((f) => ({ ...f, federalFilingStatus: e.target.value }))} /></div>
                <div className="field"><label>State Filing Status</label><input value={sensitiveForm.stateFilingStatus} onChange={(e) => setSensitiveForm((f) => ({ ...f, stateFilingStatus: e.target.value }))} /></div>
              </div>
              <div className="field"><label>W-9 Status</label><input value={sensitiveForm.w9Status} onChange={(e) => setSensitiveForm((f) => ({ ...f, w9Status: e.target.value }))} placeholder="e.g. Received, Pending" /></div>
              {isContractor && (
                <>
                  <div className="field"><label>TIN Verification Status</label><input value={sensitiveForm.tinVerificationStatus} onChange={(e) => setSensitiveForm((f) => ({ ...f, tinVerificationStatus: e.target.value }))} /></div>
                  <div className="field"><label>Vendor Classification</label><input value={sensitiveForm.vendorClassification} onChange={(e) => setSensitiveForm((f) => ({ ...f, vendorClassification: e.target.value }))} /></div>
                  <div className="field"><label>Contractor Payment Type</label><input value={sensitiveForm.contractorPaymentType} onChange={(e) => setSensitiveForm((f) => ({ ...f, contractorPaymentType: e.target.value }))} /></div>
                  <div className="field"><label>Fixed Project Amount</label><input type="number" step="0.01" value={sensitiveForm.fixedProjectAmount} onChange={(e) => setSensitiveForm((f) => ({ ...f, fixedProjectAmount: e.target.value }))} /></div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, margin: "8px 0" }}>
                    <input type="checkbox" checked={sensitiveForm.is1099Eligible} onChange={(e) => setSensitiveForm((f) => ({ ...f, is1099Eligible: e.target.checked }))} />
                    1099 Eligible
                  </label>
                </>
              )}
              <div className="field"><label>Payment Method</label><input value={sensitiveForm.paymentMethod} onChange={(e) => setSensitiveForm((f) => ({ ...f, paymentMethod: e.target.value }))} placeholder="e.g. Direct Deposit, Check" /></div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, margin: "8px 0" }}>
                <input type="checkbox" checked={sensitiveForm.directDeposit} onChange={(e) => setSensitiveForm((f) => ({ ...f, directDeposit: e.target.checked }))} />
                Direct Deposit
              </label>
              <div className="field"><label>Bank Name</label><input value={sensitiveForm.paymentBankName} onChange={(e) => setSensitiveForm((f) => ({ ...f, paymentBankName: e.target.value }))} /></div>
              <div className="field"><label>Routing Number</label><input value={sensitiveForm.paymentRoutingNumber} onChange={(e) => setSensitiveForm((f) => ({ ...f, paymentRoutingNumber: e.target.value }))} placeholder="Leave blank to keep current" /></div>
              <div className="field"><label>Account Number</label><input value={sensitiveForm.paymentAccountNumber} onChange={(e) => setSensitiveForm((f) => ({ ...f, paymentAccountNumber: e.target.value }))} placeholder="Leave blank to keep current" /></div>
              <div className="field"><label>Account Type</label><input value={sensitiveForm.paymentAccountType} onChange={(e) => setSensitiveForm((f) => ({ ...f, paymentAccountType: e.target.value }))} placeholder="Checking / Savings" /></div>
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
        <TaxDocumentsSection employeeId={employee.employee_id} employeeName={employee.employee_name} isContractor={isContractor} />
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
      alert(err instanceof ApiError ? err.message : "Could not generate this tax form.");
    } finally {
      setBusyYear(null);
    }
  }
  async function handleDownload(year: number) {
    setBusyYear(`download-${year}`);
    try {
      const filename = `${isContractor ? "1099NEC" : "W2"}_${year}_${employeeName.replace(/\s+/g, "_")}.pdf`;
      await downloadFile(formPath(year), filename);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this tax form.");
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
            <thead><tr><th>Year</th><th>Action</th></tr></thead>
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
 * This employee's own documents — belongs entirely to them, no client picker, no
 * "which portal" question. Mirrors ClientDocumentsSection on the client profile: the
 * record you're looking at owns its own file exchange. Answers the exact confusion
 * flagged live with the old "Upload to Employee Portal" flow (pick a client, then
 * pick an employee from THAT client, from a page that has nothing to do with either) —
 * here the employee is already fixed, so sending them a file is one button.
 */
function EmployeeDocumentsSection({ employeeId, employeeName, clientId, clientName }: { employeeId: string; employeeName: string; clientId: string; clientName: string }) {
  const toast = useToast();
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
    if (!confirm(`Revoke this file? It will disappear from ${employeeName}'s portal too, not just from here. If you just want to clean up this list without affecting them, use Archive instead.`)) return;
    setRemovingId(uploadId);
    try {
      await api.post(`/documents/uploads/${uploadId}/remove`, {});
      toast("File revoked.");
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not revoke this file.");
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
      alert(err instanceof ApiError ? err.message : "Could not archive this file.");
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
      alert(err instanceof ApiError ? err.message : "Could not unarchive this file.");
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
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{u.uploaded_at ? fmtDateOnly(u.uploaded_at) : "—"} · {u.uploaded_by || "—"}</div>
                {u.notes && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{u.notes}</div>}
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button type="button" className="link-button" onClick={() => downloadAnyFile(u.file_url, u.file_name)}>Download</button>
                <button type="button" className="link-button" disabled={archivingId === u.upload_id} onClick={() => handleArchive(u.upload_id)}>{archivingId === u.upload_id ? "…" : "Archive"}</button>
                <button type="button" className="link-button" style={{ color: "var(--danger, #cf222e)" }} disabled={removingId === u.upload_id} onClick={() => handleRevoke(u.upload_id)}>{removingId === u.upload_id ? "…" : "Revoke"}</button>
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
          <thead><tr><th>Requested Item</th><th>Due</th><th>Status</th></tr></thead>
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

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13, gap: 16 }}>
      <span className="muted" style={{ flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right" }}>{value || "—"}</span>
    </div>
  );
}
