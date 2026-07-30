import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import type { GovFormsMeta, ClientGovFormType } from "../api/govForms";

interface ClientIdentity {
  client_id: string; client_name: string; entity_type: string | null;
  ein: string | null; individual_ssn: string | null;
  street_address: string | null; city: string | null; state: string | null; zip_code: string | null;
  company_contact_name: string | null; company_contact_title: string | null; company_contact_ssn: string | null;
  secretary_of_state_id: string | null; phone: string | null;
}

function combinedAddress(identity: ClientIdentity | null): string {
  if (!identity) return "";
  return [identity.street_address, [identity.city, identity.state, identity.zip_code].filter(Boolean).join(", ")]
    .filter(Boolean).join(", ");
}

interface Shareholder { name: string; address: string; idNumber: string; sharesOwned: string; dateAcquired: string; taxYearEnd: string }
const EMPTY_SHAREHOLDER: Shareholder = { name: "", address: "", idNumber: "", sharesOwned: "", dateAcquired: "", taxYearEnd: "" };

/**
 * Generates one of the client-level government forms (SS-4, 2553, W-9,
 * 8332). Unlike the POA forms modal (one shared taxpayer/representatives
 * shape across all three forms it covers), these four forms have almost
 * nothing in common — the fields shown change entirely based on which form
 * is selected. Preview/Print/Download only, no e-sign: every one of these is
 * physical-signature-only, same rule as every other government form and
 * client contract in this app.
 */
export function GenerateGovFormModal({ clientId, defaultFormType, onClose, onDone }: {
  clientId: string;
  defaultFormType?: ClientGovFormType;
  onClose: () => void;
  onDone: () => void;
}) {
  const [meta, setMeta] = useState<GovFormsMeta | null>(null);
  const [identity, setIdentity] = useState<ClientIdentity | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formType, setFormType] = useState<ClientGovFormType>(defaultFormType || "SS4");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Form SS-4 state
  const [ss4, setSs4] = useState({
    legalName: "", tradeName: "", careOf: "", mailingAddress: "", physicalAddress: "", county: "", state: "MD",
    responsiblePartyName: "", responsiblePartyId: "",
    isLlc: false, llcMemberCount: "", llcOrganizedInUs: true,
    entityType: "LLC", incorporationState: "",
    reasonForApplying: "Started new business", reasonOther: "",
    dateBusinessStarted: "", closingMonth: "December",
    employeesAgricultural: "", employeesHousehold: "", employeesOther: "", firstWageDate: "",
    principalActivity: "Retail", principalActivityOther: "", principalMerchandise: "",
    appliedBefore: false,
    applicantName: "", applicantTitle: "", applicantPhone: "",
  });

  // Form 2553 state
  const [f2553, setF2553] = useState({
    corporationName: "", corporationAddress: "", ein: "", dateIncorporated: "", stateIncorporated: "",
    electionEffectiveDate: "", taxYearType: "Calendar Year", fiscalYearEndMonth: "",
    officerName: "", officerTitle: "", officerPhone: "",
  });
  const [shareholders, setShareholders] = useState<Shareholder[]>([{ ...EMPTY_SHAREHOLDER }]);

  // Form W-9 state
  const [w9, setW9] = useState({
    name: "", businessName: "", taxClassification: "Individual/Sole Proprietor",
    llcTaxClassificationCode: "", otherClassificationText: "",
    address: "", city: "", state: "MD", zip: "", ssn: "", ein: "",
  });

  // Form 8332 state
  const [f8332, setF8332] = useState({
    noncustodialParentName: "", noncustodialParentSsn: "", custodialParentSsn: "",
    releaseCurrentYear: true, partIChildNames: "", partITaxYear: String(new Date().getFullYear()),
    releaseFutureYears: false, partIIChildNames: "", partIIYears: "",
    revokeRelease: false, partIIIChildNames: "", partIIIYears: "",
  });

  useEffect(() => {
    Promise.all([
      api.get<GovFormsMeta>("/gov-forms/meta"),
      api.get<{ client: ClientIdentity }>(`/gov-forms/client/${clientId}/identity`),
    ])
      .then(([m, res]) => {
        setMeta(m);
        setIdentity(res.client);
        const addr = combinedAddress(res.client);
        setF2553((f) => ({
          ...f, corporationName: res.client.client_name, corporationAddress: addr, ein: res.client.ein || "",
          stateIncorporated: res.client.state || "", officerName: res.client.company_contact_name || "",
          officerTitle: res.client.company_contact_title || "",
        }));
        setW9((f) => ({
          ...f, name: res.client.client_name, address: res.client.street_address || "",
          city: res.client.city || "", state: res.client.state || "MD", zip: res.client.zip_code || "",
          ein: res.client.ein || "", ssn: res.client.individual_ssn || "",
        }));
        setSs4((f) => ({
          ...f, legalName: res.client.client_name, mailingAddress: addr, county: "", state: res.client.state || "MD",
          responsiblePartyName: res.client.company_contact_name || "", responsiblePartyId: res.client.company_contact_ssn || "",
          applicantName: res.client.company_contact_name || "", applicantTitle: res.client.company_contact_title || "",
        }));
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Could not load form options."));
  }, [clientId]);

  function addShareholder() {
    setShareholders((prev) => (prev.length >= 4 ? prev : [...prev, { ...EMPTY_SHAREHOLDER }]));
  }
  function patchShareholder(i: number, patch: Partial<Shareholder>) {
    setShareholders((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  function buildFormData(): Record<string, any> | null {
    if (formType === "SS4") {
      if (!ss4.legalName.trim()) { setSaveError("Legal name is required."); return null; }
      if (!ss4.responsiblePartyName.trim()) { setSaveError("Responsible party name is required."); return null; }
      return { ...ss4 };
    }
    if (formType === "2553") {
      if (!f2553.corporationName.trim()) { setSaveError("Corporation name is required."); return null; }
      const cleanShareholders = shareholders.filter((s) => s.name.trim());
      if (!cleanShareholders.length) { setSaveError("Add at least one shareholder."); return null; }
      return { ...f2553, shareholders: cleanShareholders };
    }
    if (formType === "W9") {
      if (!w9.name.trim()) { setSaveError("Name is required."); return null; }
      return { ...w9 };
    }
    // 8332
    if (!f8332.noncustodialParentName.trim()) { setSaveError("Noncustodial parent's name is required."); return null; }
    if (!f8332.releaseCurrentYear && !f8332.releaseFutureYears && !f8332.revokeRelease) {
      setSaveError("Choose at least one part of the form to fill out (current year, future years, or a revocation).");
      return null;
    }
    const data: Record<string, any> = {
      noncustodialParentName: f8332.noncustodialParentName,
      noncustodialParentSsn: f8332.noncustodialParentSsn || undefined,
      custodialParentSsn: f8332.custodialParentSsn || undefined,
    };
    if (f8332.releaseCurrentYear) data.partI = { childNames: f8332.partIChildNames, taxYear: f8332.partITaxYear };
    if (f8332.releaseFutureYears) data.partII = { childNames: f8332.partIIChildNames, years: f8332.partIIYears };
    if (f8332.revokeRelease) data.partIII = { childNames: f8332.partIIIChildNames, years: f8332.partIIIYears };
    return data;
  }

  async function handleSubmit() {
    setSaveError(null);
    const formData = buildFormData();
    if (!formData) return;
    setSaving(true);
    try {
      await api.post(`/gov-forms/client/${clientId}`, { formType, formData });
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
      <div className="modal-panel" style={{ maxWidth: 680, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Generate Government Form</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>

        {loadError && <ErrorBanner error={loadError} />}
        {!meta || !identity ? (
          <p className="muted">Loading…</p>
        ) : (
          <div>
            {saveError && <ErrorBanner error={saveError} />}

            <div className="field">
              <label htmlFor="gf-type">Form</label>
              <select id="gf-type" value={formType} onChange={(e) => setFormType(e.target.value as ClientGovFormType)}>
                {meta.clientFormTypes.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>

            {formType === "SS4" && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Legal name of entity</label>
                    <input value={ss4.legalName} onChange={(e) => setSs4({ ...ss4, legalName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Trade name / DBA <span className="muted">(optional)</span></label>
                    <input value={ss4.tradeName} onChange={(e) => setSs4({ ...ss4, tradeName: e.target.value })} />
                  </div>
                </div>
                <div className="field">
                  <label>Mailing address</label>
                  <input value={ss4.mailingAddress} onChange={(e) => setSs4({ ...ss4, mailingAddress: e.target.value })} placeholder="Street, City, State ZIP" />
                </div>
                <div className="field">
                  <label>Physical address <span className="muted">(if different from mailing)</span></label>
                  <input value={ss4.physicalAddress} onChange={(e) => setSs4({ ...ss4, physicalAddress: e.target.value })} placeholder="Street, City, State ZIP" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>County</label>
                    <input value={ss4.county} onChange={(e) => setSs4({ ...ss4, county: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>State</label>
                    <input value={ss4.state} onChange={(e) => setSs4({ ...ss4, state: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Responsible party name</label>
                    <input value={ss4.responsiblePartyName} onChange={(e) => setSs4({ ...ss4, responsiblePartyName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Responsible party SSN/ITIN/EIN</label>
                    <input value={ss4.responsiblePartyId} onChange={(e) => setSs4({ ...ss4, responsiblePartyId: e.target.value })} />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Entity type</label>
                    <select value={ss4.entityType} onChange={(e) => setSs4({ ...ss4, entityType: e.target.value, isLlc: e.target.value === "LLC" })}>
                      {meta.ss4EntityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  {ss4.isLlc && (
                    <div className="field" style={{ margin: 0 }}>
                      <label>Number of LLC members</label>
                      <input value={ss4.llcMemberCount} onChange={(e) => setSs4({ ...ss4, llcMemberCount: e.target.value })} placeholder="e.g. 1" />
                    </div>
                  )}
                  {(ss4.entityType === "Corporation" || ss4.entityType === "S Corporation") && (
                    <div className="field" style={{ margin: 0 }}>
                      <label>State/country of incorporation</label>
                      <input value={ss4.incorporationState} onChange={(e) => setSs4({ ...ss4, incorporationState: e.target.value })} />
                    </div>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Reason for applying</label>
                    <select value={ss4.reasonForApplying} onChange={(e) => setSs4({ ...ss4, reasonForApplying: e.target.value })}>
                      {meta.ss4Reasons.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  {ss4.reasonForApplying !== "Hired employees" && ss4.reasonForApplying !== "Purchased going business" && (
                    <div className="field" style={{ margin: 0 }}>
                      <label>Specify</label>
                      <input value={ss4.reasonOther} onChange={(e) => setSs4({ ...ss4, reasonOther: e.target.value })} />
                    </div>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Date business started</label>
                    <input type="date" value={ss4.dateBusinessStarted} onChange={(e) => setSs4({ ...ss4, dateBusinessStarted: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Closing month of accounting year</label>
                    <input value={ss4.closingMonth} onChange={(e) => setSs4({ ...ss4, closingMonth: e.target.value })} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Employees — Agricultural</label>
                    <input value={ss4.employeesAgricultural} onChange={(e) => setSs4({ ...ss4, employeesAgricultural: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Employees — Household</label>
                    <input value={ss4.employeesHousehold} onChange={(e) => setSs4({ ...ss4, employeesHousehold: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Employees — Other</label>
                    <input value={ss4.employeesOther} onChange={(e) => setSs4({ ...ss4, employeesOther: e.target.value })} />
                  </div>
                </div>
                <div className="field" style={{ maxWidth: 220 }}>
                  <label>First date wages paid</label>
                  <input type="date" value={ss4.firstWageDate} onChange={(e) => setSs4({ ...ss4, firstWageDate: e.target.value })} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Principal activity</label>
                    <select value={ss4.principalActivity} onChange={(e) => setSs4({ ...ss4, principalActivity: e.target.value })}>
                      {meta.ss4Activities.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  {ss4.principalActivity === "Other" && (
                    <div className="field" style={{ margin: 0 }}>
                      <label>Specify</label>
                      <input value={ss4.principalActivityOther} onChange={(e) => setSs4({ ...ss4, principalActivityOther: e.target.value })} />
                    </div>
                  )}
                </div>
                <div className="field">
                  <label>Principal line of merchandise/services</label>
                  <input value={ss4.principalMerchandise} onChange={(e) => setSs4({ ...ss4, principalMerchandise: e.target.value })} />
                </div>

                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, margin: "6px 0" }}>
                  <input type="checkbox" checked={ss4.appliedBefore} onChange={(e) => setSs4({ ...ss4, appliedBefore: e.target.checked })} />
                  This entity has applied for an EIN before
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 6 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Applicant name</label>
                    <input value={ss4.applicantName} onChange={(e) => setSs4({ ...ss4, applicantName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Applicant title</label>
                    <input value={ss4.applicantTitle} onChange={(e) => setSs4({ ...ss4, applicantTitle: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Applicant phone</label>
                    <input value={ss4.applicantPhone} onChange={(e) => setSs4({ ...ss4, applicantPhone: e.target.value })} />
                  </div>
                </div>
              </div>
            )}

            {formType === "2553" && (
              <div>
                <div className="field">
                  <label>Corporation name</label>
                  <input value={f2553.corporationName} onChange={(e) => setF2553({ ...f2553, corporationName: e.target.value })} />
                </div>
                <div className="field">
                  <label>Address</label>
                  <input value={f2553.corporationAddress} onChange={(e) => setF2553({ ...f2553, corporationAddress: e.target.value })} placeholder="Street, City, State ZIP" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>EIN</label>
                    <input value={f2553.ein} onChange={(e) => setF2553({ ...f2553, ein: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Date incorporated</label>
                    <input type="date" value={f2553.dateIncorporated} onChange={(e) => setF2553({ ...f2553, dateIncorporated: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>State incorporated</label>
                    <input value={f2553.stateIncorporated} onChange={(e) => setF2553({ ...f2553, stateIncorporated: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Election effective date</label>
                    <input type="date" value={f2553.electionEffectiveDate} onChange={(e) => setF2553({ ...f2553, electionEffectiveDate: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Selected tax year</label>
                    <select value={f2553.taxYearType} onChange={(e) => setF2553({ ...f2553, taxYearType: e.target.value })}>
                      {meta.form2553TaxYearTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  {f2553.taxYearType === "Fiscal Year" && (
                    <div className="field" style={{ margin: 0 }}>
                      <label>Fiscal year ending (month/day)</label>
                      <input value={f2553.fiscalYearEndMonth} onChange={(e) => setF2553({ ...f2553, fiscalYearEndMonth: e.target.value })} placeholder="e.g. June 30" />
                    </div>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Officer name</label>
                    <input value={f2553.officerName} onChange={(e) => setF2553({ ...f2553, officerName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Officer title</label>
                    <input value={f2553.officerTitle} onChange={(e) => setF2553({ ...f2553, officerTitle: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Officer phone</label>
                    <input value={f2553.officerPhone} onChange={(e) => setF2553({ ...f2553, officerPhone: e.target.value })} />
                  </div>
                </div>

                <div className="field" style={{ marginTop: 12 }}>
                  <label>Shareholders <span className="muted">(up to 4)</span></label>
                  {shareholders.map((s, i) => (
                    <div key={i} className="card" style={{ marginBottom: 8, padding: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <strong style={{ fontSize: 12.5 }}>Shareholder {i + 1}</strong>
                        {shareholders.length > 1 && (
                          <button type="button" className="link-button" style={{ color: "var(--danger, #cf222e)" }}
                            onClick={() => setShareholders((prev) => prev.filter((_, j) => j !== i))}>Remove</button>
                        )}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <input placeholder="Name" value={s.name} onChange={(e) => patchShareholder(i, { name: e.target.value })} />
                        <input placeholder="Address" value={s.address} onChange={(e) => patchShareholder(i, { address: e.target.value })} />
                        <input placeholder="SSN or EIN" value={s.idNumber} onChange={(e) => patchShareholder(i, { idNumber: e.target.value })} />
                        <input placeholder="Shares owned" value={s.sharesOwned} onChange={(e) => patchShareholder(i, { sharesOwned: e.target.value })} />
                        <input placeholder="Date(s) acquired" value={s.dateAcquired} onChange={(e) => patchShareholder(i, { dateAcquired: e.target.value })} />
                        <input placeholder="Tax year ends (month/day)" value={s.taxYearEnd} onChange={(e) => patchShareholder(i, { taxYearEnd: e.target.value })} />
                      </div>
                    </div>
                  ))}
                  {shareholders.length < 4 && <button type="button" className="btn btn-sm" onClick={addShareholder}>+ Add Shareholder</button>}
                </div>
              </div>
            )}

            {formType === "W9" && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Name</label>
                    <input value={w9.name} onChange={(e) => setW9({ ...w9, name: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Business name <span className="muted">(if different)</span></label>
                    <input value={w9.businessName} onChange={(e) => setW9({ ...w9, businessName: e.target.value })} />
                  </div>
                </div>
                <div className="field">
                  <label>Federal tax classification</label>
                  <select value={w9.taxClassification} onChange={(e) => setW9({ ...w9, taxClassification: e.target.value })}>
                    {meta.w9TaxClassifications.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {w9.taxClassification === "LLC" && (
                  <div className="field" style={{ maxWidth: 200 }}>
                    <label>LLC tax classification (C, S, or P)</label>
                    <input maxLength={1} value={w9.llcTaxClassificationCode} onChange={(e) => setW9({ ...w9, llcTaxClassificationCode: e.target.value.toUpperCase() })} />
                  </div>
                )}
                {w9.taxClassification === "Other" && (
                  <div className="field">
                    <label>Describe</label>
                    <input value={w9.otherClassificationText} onChange={(e) => setW9({ ...w9, otherClassificationText: e.target.value })} />
                  </div>
                )}
                <div className="field">
                  <label>Address</label>
                  <input value={w9.address} onChange={(e) => setW9({ ...w9, address: e.target.value })} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>City</label>
                    <input value={w9.city} onChange={(e) => setW9({ ...w9, city: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>State</label>
                    <input value={w9.state} onChange={(e) => setW9({ ...w9, state: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>ZIP</label>
                    <input value={w9.zip} onChange={(e) => setW9({ ...w9, zip: e.target.value })} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>SSN <span className="muted">(if applicable)</span></label>
                    <input value={w9.ssn} onChange={(e) => setW9({ ...w9, ssn: e.target.value })} placeholder="XXX-XX-XXXX" />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>EIN <span className="muted">(if applicable)</span></label>
                    <input value={w9.ein} onChange={(e) => setW9({ ...w9, ein: e.target.value })} placeholder="XX-XXXXXXX" />
                  </div>
                </div>
              </div>
            )}

            {formType === "8332" && (
              <div>
                <p className="muted" style={{ fontSize: 12 }}>For releasing (or revoking) a claim to a child's dependency exemption between two parents — not tied to this client's own business info.</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Noncustodial parent's name</label>
                    <input value={f8332.noncustodialParentName} onChange={(e) => setF8332({ ...f8332, noncustodialParentName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Noncustodial parent's SSN</label>
                    <input value={f8332.noncustodialParentSsn} onChange={(e) => setF8332({ ...f8332, noncustodialParentSsn: e.target.value })} />
                  </div>
                </div>
                <div className="field" style={{ maxWidth: 260 }}>
                  <label>Custodial parent's SSN <span className="muted">(the signer)</span></label>
                  <input value={f8332.custodialParentSsn} onChange={(e) => setF8332({ ...f8332, custodialParentSsn: e.target.value })} />
                </div>

                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, margin: "10px 0 4px" }}>
                  <input type="checkbox" checked={f8332.releaseCurrentYear} onChange={(e) => setF8332({ ...f8332, releaseCurrentYear: e.target.checked })} />
                  Part I — Release for the current tax year
                </label>
                {f8332.releaseCurrentYear && (
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, marginLeft: 22 }}>
                    <input placeholder="Child name(s)" value={f8332.partIChildNames} onChange={(e) => setF8332({ ...f8332, partIChildNames: e.target.value })} />
                    <input placeholder="Tax year" value={f8332.partITaxYear} onChange={(e) => setF8332({ ...f8332, partITaxYear: e.target.value })} />
                  </div>
                )}

                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, margin: "10px 0 4px" }}>
                  <input type="checkbox" checked={f8332.releaseFutureYears} onChange={(e) => setF8332({ ...f8332, releaseFutureYears: e.target.checked })} />
                  Part II — Release for future tax years
                </label>
                {f8332.releaseFutureYears && (
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, marginLeft: 22 }}>
                    <input placeholder="Child name(s)" value={f8332.partIIChildNames} onChange={(e) => setF8332({ ...f8332, partIIChildNames: e.target.value })} />
                    <input placeholder="e.g. 2027 through 2030" value={f8332.partIIYears} onChange={(e) => setF8332({ ...f8332, partIIYears: e.target.value })} />
                  </div>
                )}

                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, margin: "10px 0 4px" }}>
                  <input type="checkbox" checked={f8332.revokeRelease} onChange={(e) => setF8332({ ...f8332, revokeRelease: e.target.checked })} />
                  Part III — Revoke a prior release
                </label>
                {f8332.revokeRelease && (
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, marginLeft: 22 }}>
                    <input placeholder="Child name(s)" value={f8332.partIIIChildNames} onChange={(e) => setF8332({ ...f8332, partIIIChildNames: e.target.value })} />
                    <input placeholder="Years being revoked" value={f8332.partIIIYears} onChange={(e) => setF8332({ ...f8332, partIIIYears: e.target.value })} />
                  </div>
                )}
              </div>
            )}

            <p className="muted" style={{ fontSize: 12, margin: "14px 0 10px" }}>
              This form must be signed by hand — Preview, print, and get a wet signature; the app tracks when it's signed and how it was actually sent.
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
