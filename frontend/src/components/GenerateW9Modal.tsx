import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import type { GovFormsMeta } from "../api/govForms";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface EmployeeIdentity {
  employee_id: string; employee_name: string; ssn: string | null; ein: string | null;
  street_address: string | null; city: string | null; state: string | null; zip_code: string | null;
}

/** Generates Form W-9 for one contractor — collected by the firm/client as the payer, never sent to the IRS. Same lifecycle and layout as GenerateW4Modal, W-9's own fields (see GenerateGovFormModal's client-scoped W-9 section, which this mirrors). */
export function GenerateW9Modal({ employeeId, onClose, onDone }: { employeeId: string; onClose: () => void; onDone: () => void }) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const [meta, setMeta] = useState<GovFormsMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [taxClassification, setTaxClassification] = useState("Individual/Sole Proprietor");
  const [llcTaxClassificationCode, setLlcTaxClassificationCode] = useState("");
  const [otherClassificationText, setOtherClassificationText] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("MD");
  const [zip, setZip] = useState("");
  const [ssn, setSsn] = useState("");
  const [ein, setEin] = useState("");

  useEffect(() => {
    Promise.all([
      api.get<GovFormsMeta>("/gov-forms/meta"),
      api.get<{ employee: EmployeeIdentity }>(`/gov-forms/employee/${employeeId}/identity`),
    ])
      .then(([m, res]) => {
        setMeta(m);
        setName(res.employee.employee_name || "");
        setAddress(res.employee.street_address || "");
        setCity(res.employee.city || "");
        setState(res.employee.state || "MD");
        setZip(res.employee.zip_code || "");
        setSsn(res.employee.ssn || "");
        setEin(res.employee.ein || "");
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Could not load form options."));
  }, [employeeId]);

  async function handleSubmit() {
    setSaveError(null);
    if (!name.trim()) { setSaveError("Name is required."); return; }
    setSaving(true);
    try {
      await api.post(`/gov-forms/employee/${employeeId}`, {
        formType: "W9",
        formData: {
          name, businessName: businessName || undefined, taxClassification,
          llcTaxClassificationCode: llcTaxClassificationCode || undefined,
          otherClassificationText: otherClassificationText || undefined,
          address, city, state, zip, ssn: ssn || undefined, ein: ein || undefined,
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
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="generate-w9-title" style={{ maxWidth: 620, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="generate-w9-title">Generate Form W-9</h2>
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
                <label htmlFor="w9-name">Name</label>
                <input id="w9-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="w9-business-name">Business name <span className="muted">(if different)</span></label>
                <input id="w9-business-name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="w9-tax-classification">Federal tax classification</label>
              <select id="w9-tax-classification" value={taxClassification} onChange={(e) => setTaxClassification(e.target.value)}>
                {meta.w9TaxClassifications.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {taxClassification === "LLC" && (
              <div className="field" style={{ maxWidth: 200 }}>
                <label htmlFor="w9-llc-code">LLC tax classification (C, S, or P)</label>
                <input id="w9-llc-code" maxLength={1} value={llcTaxClassificationCode} onChange={(e) => setLlcTaxClassificationCode(e.target.value.toUpperCase())} />
              </div>
            )}
            {taxClassification === "Other" && (
              <div className="field">
                <label htmlFor="w9-other-classification">Describe</label>
                <input id="w9-other-classification" value={otherClassificationText} onChange={(e) => setOtherClassificationText(e.target.value)} />
              </div>
            )}
            <div className="field">
              <label htmlFor="w9-address">Address</label>
              <input id="w9-address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="w9-city">City</label>
                <input id="w9-city" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="w9-state">State</label>
                <input id="w9-state" value={state} onChange={(e) => setState(e.target.value)} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="w9-zip">ZIP</label>
                <input id="w9-zip" value={zip} onChange={(e) => setZip(e.target.value)} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="w9-ssn">SSN <span className="muted">(if applicable)</span></label>
                <input id="w9-ssn" autoComplete="off" data-no-suggest value={ssn} onChange={(e) => setSsn(e.target.value)} placeholder="XXX-XX-XXXX" />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="w9-ein">EIN <span className="muted">(if applicable)</span></label>
                <input id="w9-ein" autoComplete="off" data-no-suggest value={ein} onChange={(e) => setEin(e.target.value)} placeholder="XX-XXXXXXX" />
              </div>
            </div>

            <p className="muted" style={{ fontSize: 12, margin: "12px 0 10px" }}>
              This form isn't valid until signed — Preview, print, and get a wet signature; keep the signed copy on file (a W-9 is never sent to the IRS).
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
