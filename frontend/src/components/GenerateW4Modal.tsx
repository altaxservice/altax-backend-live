import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import type { GovFormsMeta } from "../api/govForms";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface EmployeeIdentity {
  employee_id: string; employee_name: string; ssn: string | null;
  street_address: string | null; city: string | null; state: string | null; zip_code: string | null;
  federal_filing_status: string | null;
}
interface EmployerIdentity { client_name: string; ein: string | null; street_address: string | null; city: string | null; state: string | null; zip_code: string | null }

/** Generates Form W-4 for one employee — kept on file with their employer, never sent to the IRS, so there's no "submit via" step beyond marking it signed (see GovFormsSection's shared lifecycle). */
export function GenerateW4Modal({ employeeId, onClose, onDone }: { employeeId: string; onClose: () => void; onDone: () => void }) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const [meta, setMeta] = useState<GovFormsMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("MD");
  const [zip, setZip] = useState("");
  const [ssn, setSsn] = useState("");
  const [filingStatus, setFilingStatus] = useState("Single or Married filing separately");
  const [multipleJobsCheckbox, setMultipleJobsCheckbox] = useState(false);
  const [qualifyingChildrenAmount, setQualifyingChildrenAmount] = useState("");
  const [otherDependentsAmount, setOtherDependentsAmount] = useState("");
  const [otherIncome, setOtherIncome] = useState("");
  const [deductions, setDeductions] = useState("");
  const [extraWithholding, setExtraWithholding] = useState("");
  const [employerName, setEmployerName] = useState("");
  const [employerAddress, setEmployerAddress] = useState("");
  const [firstDateOfEmployment, setFirstDateOfEmployment] = useState("");
  const [employerEin, setEmployerEin] = useState("");

  useEffect(() => {
    Promise.all([
      api.get<GovFormsMeta>("/gov-forms/meta"),
      api.get<{ employee: EmployeeIdentity; employer: EmployerIdentity | null }>(`/gov-forms/employee/${employeeId}/identity`),
    ])
      .then(([m, res]) => {
        setMeta(m);
        const [first, ...rest] = (res.employee.employee_name || "").split(" ");
        setFirstName(first || "");
        setLastName(rest.join(" "));
        setAddress(res.employee.street_address || "");
        setCity(res.employee.city || "");
        setState(res.employee.state || "MD");
        setZip(res.employee.zip_code || "");
        setSsn(res.employee.ssn || "");
        if (res.employee.federal_filing_status && m.w4FilingStatuses.includes(res.employee.federal_filing_status)) {
          setFilingStatus(res.employee.federal_filing_status);
        }
        if (res.employer) {
          setEmployerName(res.employer.client_name || "");
          setEmployerAddress([res.employer.street_address, [res.employer.city, res.employer.state, res.employer.zip_code].filter(Boolean).join(", ")].filter(Boolean).join(", "));
          setEmployerEin(res.employer.ein || "");
        }
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Could not load form options."));
  }, [employeeId]);

  async function handleSubmit() {
    setSaveError(null);
    if (!firstName.trim() || !lastName.trim()) { setSaveError("First and last name are required."); return; }
    setSaving(true);
    try {
      await api.post(`/gov-forms/employee/${employeeId}`, {
        formType: "W4",
        formData: {
          firstName, lastName, address, city, state, zip, ssn, filingStatus,
          multipleJobsCheckbox,
          qualifyingChildrenAmount: qualifyingChildrenAmount || undefined,
          otherDependentsAmount: otherDependentsAmount || undefined,
          otherIncome: otherIncome || undefined,
          deductions: deductions || undefined,
          extraWithholding: extraWithholding || undefined,
          employerName, employerAddress, firstDateOfEmployment: firstDateOfEmployment || undefined, employerEin,
        },
      });
      onDone();
      onClose();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not create this filing.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="generate-w4-title" style={{ maxWidth: 620, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="generate-w4-title">Generate Form W-4</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>

        {loadError && <ErrorBanner error={loadError} />}
        {!meta ? (
          <p className="muted">Loading…</p>
        ) : (
          <div>
            {saveError && <ErrorBanner error={saveError} />}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>First name</label>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Last name</label>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label>Address</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>City</label>
                <input value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>State</label>
                <input value={state} onChange={(e) => setState(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>ZIP</label>
                <input value={zip} onChange={(e) => setZip(e.target.value)} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>SSN</label>
                <input value={ssn} onChange={(e) => setSsn(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Filing status</label>
                <select value={filingStatus} onChange={(e) => setFilingStatus(e.target.value)}>
                  {meta.w4FilingStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, margin: "10px 0" }}>
              <input type="checkbox" checked={multipleJobsCheckbox} onChange={(e) => setMultipleJobsCheckbox(e.target.checked)} />
              Step 2 — There are only two jobs total (check this box)
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Step 3(a) — Qualifying children amount</label>
                <input type="number" step="0.01" value={qualifyingChildrenAmount} onChange={(e) => setQualifyingChildrenAmount(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Step 3(b) — Other dependents amount</label>
                <input type="number" step="0.01" value={otherDependentsAmount} onChange={(e) => setOtherDependentsAmount(e.target.value)} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>4(a) Other income</label>
                <input type="number" step="0.01" value={otherIncome} onChange={(e) => setOtherIncome(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>4(b) Deductions</label>
                <input type="number" step="0.01" value={deductions} onChange={(e) => setDeductions(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>4(c) Extra withholding</label>
                <input type="number" step="0.01" value={extraWithholding} onChange={(e) => setExtraWithholding(e.target.value)} />
              </div>
            </div>

            <div className="field" style={{ marginTop: 10 }}>
              <label>Employer name &amp; address</label>
              <input value={employerName} onChange={(e) => setEmployerName(e.target.value)} placeholder="Employer name" />
              <input style={{ marginTop: 6 }} value={employerAddress} onChange={(e) => setEmployerAddress(e.target.value)} placeholder="Employer address" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>First date of employment</label>
                <input type="date" value={firstDateOfEmployment} onChange={(e) => setFirstDateOfEmployment(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Employer EIN</label>
                <input value={employerEin} onChange={(e) => setEmployerEin(e.target.value)} />
              </div>
            </div>

            <p className="muted" style={{ fontSize: 12, margin: "12px 0 10px" }}>
              This form isn't valid until the employee signs it — Preview, print, and get a wet signature; keep the signed copy on file (a W-4 is never sent to the IRS).
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSubmit}>{saving ? "Generating…" : "Generate"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
