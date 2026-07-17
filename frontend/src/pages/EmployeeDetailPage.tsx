import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, downloadFile, viewFile } from "../api/client";
import type { Employee } from "../api/types2";
import { useAuth } from "../auth/AuthContext";
import { AddressFields } from "../components/AddressFields";

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

export function EmployeeDetailPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canEdit = user?.role === "admin" || user?.role === "staff";

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear()));

  const [sensitive, setSensitive] = useState<SensitiveFields | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [editingSensitive, setEditingSensitive] = useState(false);
  const [sensitiveForm, setSensitiveForm] = useState(SENSITIVE_FORM_DEFAULTS);
  const [sensitiveSaving, setSensitiveSaving] = useState(false);
  const [sensitiveError, setSensitiveError] = useState<string | null>(null);

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

  async function handleArchive() {
    if (!employee) return;
    if (!confirm(`Archive ${employee.employee_name}? Past payroll/1099 history is kept, but they'll drop off active lists.`)) return;
    try {
      await api.post(`/accounting/employees/${employee.employee_id}/archive`, {});
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not archive this profile.");
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

  async function handleDelete() {
    if (!employee) return;
    const confirmValue = prompt(`Permanently delete "${employee.employee_name}"? This cannot be undone and only works if they have no payroll/1099 history. Type DELETE EMPLOYEE to confirm.`);
    if (confirmValue === null) return;
    setDeleting(true);
    try {
      await api.post(`/accounting/employees/${employee.employee_id}/delete`, { confirm: confirmValue });
      navigate(`/accounting?client=${employee.client_id}&tab=Employees`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not delete this profile.");
    } finally {
      setDeleting(false);
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

  function taxFormPath() {
    return isContractor
      ? `/accounting/tax-forms/1099nec/${employee!.employee_id}?year=${taxYear}`
      : `/accounting/tax-forms/w2/${employee!.employee_id}?year=${taxYear}`;
  }

  async function handleViewForm() {
    if (!employee) return;
    setViewing(true);
    try {
      await viewFile(taxFormPath());
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this tax form.");
    } finally {
      setViewing(false);
    }
  }

  async function handlePrint() {
    if (!employee) return;
    setPrinting(true);
    try {
      const filename = isContractor
        ? `1099NEC_${taxYear}_${employee.employee_name.replace(/\s+/g, "_")}.pdf`
        : `W2_${taxYear}_${employee.employee_name.replace(/\s+/g, "_")}.pdf`;
      await downloadFile(taxFormPath(), filename);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this tax form.");
    } finally {
      setPrinting(false);
    }
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!employee) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div>
      <Link to={`/accounting?client=${employee.client_id}&tab=Employees`} className="muted">← Employees & Contractors</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", margin: "8px 0 24px", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>{employee.employee_name}</h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="muted">{employee.worker_type || "Employee"} · {employee.status}</span>
            <Link to={`/clients/${employee.client_id}`} className="muted">{employee.client_name as string}</Link>
          </div>
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div className="field" style={{ margin: 0 }}>
              <input type="number" value={taxYear} onChange={(e) => setTaxYear(e.target.value)} style={{ width: 80 }} />
            </div>
            <button className="btn" disabled={viewing} onClick={handleViewForm}>
              {viewing ? "Generating…" : isContractor ? "View 1099-NEC" : "View W-2"}
            </button>
            <button className="btn" disabled={printing} onClick={handlePrint}>
              {printing ? "Generating…" : isContractor ? "Download 1099-NEC" : "Download W-2"}
            </button>
            {String(employee.status || "").toLowerCase() !== "archived" && (
              <button className="btn" disabled={statusSaving} onClick={handleToggleStatus}>
                {statusSaving ? "Saving…" : String(employee.status || "").toLowerCase() === "active" ? "Set Inactive" : "Set Active"}
              </button>
            )}
            {!editing && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
            {String(employee.status || "").toLowerCase() !== "archived" && (
              <button className="btn btn-danger" onClick={handleArchive}>Archive</button>
            )}
            {isAdmin && (
              <button className="btn btn-danger" disabled={deleting} onClick={handleDelete}>{deleting ? "Deleting…" : "Delete"}</button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <form onSubmit={handleSave} className="card" style={{ maxWidth: 560, marginBottom: 20 }}>
          {saveError && <div className="error-banner">{saveError}</div>}
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
          <DetailRow label="Pay Type" value={employee.pay_type} />
          <DetailRow label="Pay Rate" value={fmtMoney(employee.pay_rate)} />
          <DetailRow label="Default Hours" value={employee.default_hours != null ? String(employee.default_hours) : null} />
          <DetailRow label="Default Gross Wages" value={fmtMoney(employee.default_gross_wages)} />
          <DetailRow label="Pay Frequency" value={employee.pay_frequency} />
          {isContractor && <DetailRow label="Service Category" value={employee.service_category} />}
          <DetailRow label="Email" value={employee.email} />
          <DetailRow label="Phone" value={employee.phone} />
        </div>
      )}

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
            {sensitiveError && <div className="error-banner">{sensitiveError}</div>}
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
    </div>
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
