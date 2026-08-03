import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import type { GovFormsMeta, ClientGovFormType } from "../api/govForms";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface ClientIdentity {
  client_id: string; client_name: string; entity_type: string | null;
  ein: string | null; individual_ssn: string | null;
  street_address: string | null; city: string | null; state: string | null; zip_code: string | null;
  company_contact_name: string | null; company_contact_title: string | null; company_contact_ssn: string | null;
  company_contact_email: string | null; company_contact_phone: string | null;
  secretary_of_state_id: string | null; phone: string | null; email: string | null;
}

/** "ABDULSAMAD ALMABARI" -> ["ABDULSAMAD", "ALMABARI"] — first word is the first name, everything else is the last name. Same heuristic used elsewhere in this app for splitting a single stored contact-name field into a form's separate first/last boxes; staff can always correct it before generating. */
function splitName(full: string | null | undefined): { first: string; last: string } {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: "", last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(" ") };
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
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
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

  // Maryland Form CRA state
  const [cra, setCra] = useState({
    fein: "", ssn: "", datEntityId: "", legalFirstName: "", legalLastName: "", tradeName: "",
    street1: "", street2: "", city: "", state: "MD", zip: "", county: "", phone: "", fax: "", email: "",
    mailingStreet1: "", mailingStreet2: "", mailingCity: "", mailingState: "", mailingZip: "",
    reason: "New Business", reasonOther: "",
    taxTypes: [] as string[],
    ownershipType: "Maryland corporation",
    naicsCode: "", businessActivity: "", productOrService: "",
    officerLastName: "", officerFirstName: "", officerSsn: "", officerTitle: "",
    officerStreet: "", officerCity: "", officerState: "", officerZip: "", officerPhone: "",
    preparerName: "AL TAX SERVICE",
  });
  function toggleCraTaxType(t: string) {
    setCra((f) => ({ ...f, taxTypes: f.taxTypes.includes(t) ? f.taxTypes.filter((x) => x !== t) : [...f.taxTypes, t] }));
  }

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
        const officer = splitName(res.client.company_contact_name);
        setCra((f) => ({
          ...f,
          fein: res.client.ein || "", ssn: res.client.individual_ssn || "", datEntityId: res.client.secretary_of_state_id || "",
          legalLastName: res.client.client_name,
          street1: res.client.street_address || "", city: res.client.city || "", state: res.client.state || "MD", zip: res.client.zip_code || "",
          phone: res.client.phone || "", email: res.client.email || "",
          officerFirstName: officer.first, officerLastName: officer.last, officerSsn: res.client.company_contact_ssn || "",
          officerTitle: res.client.company_contact_title || "",
          officerStreet: res.client.street_address || "", officerCity: res.client.city || "", officerState: res.client.state || "MD", officerZip: res.client.zip_code || "",
          officerPhone: res.client.company_contact_phone || res.client.phone || "",
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
    if (formType === "CRA") {
      if (!cra.legalLastName.trim()) { setSaveError("Legal name is required."); return null; }
      if (!cra.street1.trim() || !cra.city.trim() || !cra.zip.trim()) { setSaveError("Physical business address is required."); return null; }
      if (cra.taxTypes.length === 0) { setSaveError("Select at least one tax account being requested."); return null; }
      return { ...cra };
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
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="generate-gov-form-title" style={{ maxWidth: 680, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="generate-gov-form-title">Generate Government Form</h2>
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
                    <label htmlFor="gf-ss4-legal-name">Legal name of entity</label>
                    <input id="gf-ss4-legal-name" value={ss4.legalName} onChange={(e) => setSs4({ ...ss4, legalName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-ss4-trade-name">Trade name / DBA <span className="muted">(optional)</span></label>
                    <input id="gf-ss4-trade-name" value={ss4.tradeName} onChange={(e) => setSs4({ ...ss4, tradeName: e.target.value })} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="gf-ss4-mailing-address">Mailing address</label>
                  <input id="gf-ss4-mailing-address" value={ss4.mailingAddress} onChange={(e) => setSs4({ ...ss4, mailingAddress: e.target.value })} placeholder="Street, City, State ZIP" />
                </div>
                <div className="field">
                  <label htmlFor="gf-ss4-physical-address">Physical address <span className="muted">(if different from mailing)</span></label>
                  <input id="gf-ss4-physical-address" value={ss4.physicalAddress} onChange={(e) => setSs4({ ...ss4, physicalAddress: e.target.value })} placeholder="Street, City, State ZIP" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-ss4-county">County</label>
                    <input id="gf-ss4-county" value={ss4.county} onChange={(e) => setSs4({ ...ss4, county: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-ss4-state">State</label>
                    <input id="gf-ss4-state" value={ss4.state} onChange={(e) => setSs4({ ...ss4, state: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-ss4-responsible-party-name">Responsible party name</label>
                    <input id="gf-ss4-responsible-party-name" value={ss4.responsiblePartyName} onChange={(e) => setSs4({ ...ss4, responsiblePartyName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-ss4-responsible-party-id">Responsible party SSN/ITIN/EIN</label>
                    <input id="gf-ss4-responsible-party-id" value={ss4.responsiblePartyId} onChange={(e) => setSs4({ ...ss4, responsiblePartyId: e.target.value })} />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-ss4-entity-type">Entity type</label>
                    <select id="gf-ss4-entity-type" value={ss4.entityType} onChange={(e) => setSs4({ ...ss4, entityType: e.target.value, isLlc: e.target.value === "LLC" })}>
                      {meta.ss4EntityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  {ss4.isLlc && (
                    <div className="field" style={{ margin: 0 }}>
                      <label htmlFor="gf-ss4-llc-member-count">Number of LLC members</label>
                      <input id="gf-ss4-llc-member-count" value={ss4.llcMemberCount} onChange={(e) => setSs4({ ...ss4, llcMemberCount: e.target.value })} placeholder="e.g. 1" />
                    </div>
                  )}
                  {(ss4.entityType === "Corporation" || ss4.entityType === "S Corporation") && (
                    <div className="field" style={{ margin: 0 }}>
                      <label htmlFor="gf-ss4-incorporation-state">State/country of incorporation</label>
                      <input id="gf-ss4-incorporation-state" value={ss4.incorporationState} onChange={(e) => setSs4({ ...ss4, incorporationState: e.target.value })} />
                    </div>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-ss4-reason">Reason for applying</label>
                    <select id="gf-ss4-reason" value={ss4.reasonForApplying} onChange={(e) => setSs4({ ...ss4, reasonForApplying: e.target.value })}>
                      {meta.ss4Reasons.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  {ss4.reasonForApplying !== "Hired employees" && ss4.reasonForApplying !== "Purchased going business" && (
                    <div className="field" style={{ margin: 0 }}>
                      <label htmlFor="gf-ss4-reason-other">Specify</label>
                      <input id="gf-ss4-reason-other" value={ss4.reasonOther} onChange={(e) => setSs4({ ...ss4, reasonOther: e.target.value })} />
                    </div>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-ss4-date-started">Date business started</label>
                    <input id="gf-ss4-date-started" type="date" value={ss4.dateBusinessStarted} onChange={(e) => setSs4({ ...ss4, dateBusinessStarted: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-ss4-closing-month">Closing month of accounting year</label>
                    <input id="gf-ss4-closing-month" value={ss4.closingMonth} onChange={(e) => setSs4({ ...ss4, closingMonth: e.target.value })} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-ss4-employees-agricultural">Employees — Agricultural</label>
                    <input id="gf-ss4-employees-agricultural" value={ss4.employeesAgricultural} onChange={(e) => setSs4({ ...ss4, employeesAgricultural: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-ss4-employees-household">Employees — Household</label>
                    <input id="gf-ss4-employees-household" value={ss4.employeesHousehold} onChange={(e) => setSs4({ ...ss4, employeesHousehold: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-ss4-employees-other">Employees — Other</label>
                    <input id="gf-ss4-employees-other" value={ss4.employeesOther} onChange={(e) => setSs4({ ...ss4, employeesOther: e.target.value })} />
                  </div>
                </div>
                <div className="field" style={{ maxWidth: 220 }}>
                  <label htmlFor="gf-ss4-first-wage-date">First date wages paid</label>
                  <input id="gf-ss4-first-wage-date" type="date" value={ss4.firstWageDate} onChange={(e) => setSs4({ ...ss4, firstWageDate: e.target.value })} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-ss4-principal-activity">Principal activity</label>
                    <select id="gf-ss4-principal-activity" value={ss4.principalActivity} onChange={(e) => setSs4({ ...ss4, principalActivity: e.target.value })}>
                      {meta.ss4Activities.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  {ss4.principalActivity === "Other" && (
                    <div className="field" style={{ margin: 0 }}>
                      <label htmlFor="gf-ss4-principal-activity-other">Specify</label>
                      <input id="gf-ss4-principal-activity-other" value={ss4.principalActivityOther} onChange={(e) => setSs4({ ...ss4, principalActivityOther: e.target.value })} />
                    </div>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="gf-ss4-principal-merchandise">Principal line of merchandise/services</label>
                  <input id="gf-ss4-principal-merchandise" value={ss4.principalMerchandise} onChange={(e) => setSs4({ ...ss4, principalMerchandise: e.target.value })} />
                </div>

                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, margin: "6px 0" }}>
                  <input type="checkbox" checked={ss4.appliedBefore} onChange={(e) => setSs4({ ...ss4, appliedBefore: e.target.checked })} />
                  This entity has applied for an EIN before
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 6 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-ss4-applicant-name">Applicant name</label>
                    <input id="gf-ss4-applicant-name" value={ss4.applicantName} onChange={(e) => setSs4({ ...ss4, applicantName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-ss4-applicant-title">Applicant title</label>
                    <input id="gf-ss4-applicant-title" value={ss4.applicantTitle} onChange={(e) => setSs4({ ...ss4, applicantTitle: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-ss4-applicant-phone">Applicant phone</label>
                    <input id="gf-ss4-applicant-phone" value={ss4.applicantPhone} onChange={(e) => setSs4({ ...ss4, applicantPhone: e.target.value })} />
                  </div>
                </div>
              </div>
            )}

            {formType === "2553" && (
              <div>
                <div className="field">
                  <label htmlFor="gf-2553-corp-name">Corporation name</label>
                  <input id="gf-2553-corp-name" value={f2553.corporationName} onChange={(e) => setF2553({ ...f2553, corporationName: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="gf-2553-corp-address">Address</label>
                  <input id="gf-2553-corp-address" value={f2553.corporationAddress} onChange={(e) => setF2553({ ...f2553, corporationAddress: e.target.value })} placeholder="Street, City, State ZIP" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-2553-ein">EIN</label>
                    <input id="gf-2553-ein" value={f2553.ein} onChange={(e) => setF2553({ ...f2553, ein: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-2553-date-incorporated">Date incorporated</label>
                    <input id="gf-2553-date-incorporated" type="date" value={f2553.dateIncorporated} onChange={(e) => setF2553({ ...f2553, dateIncorporated: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-2553-state-incorporated">State incorporated</label>
                    <input id="gf-2553-state-incorporated" value={f2553.stateIncorporated} onChange={(e) => setF2553({ ...f2553, stateIncorporated: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-2553-election-date">Election effective date</label>
                    <input id="gf-2553-election-date" type="date" value={f2553.electionEffectiveDate} onChange={(e) => setF2553({ ...f2553, electionEffectiveDate: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-2553-tax-year-type">Selected tax year</label>
                    <select id="gf-2553-tax-year-type" value={f2553.taxYearType} onChange={(e) => setF2553({ ...f2553, taxYearType: e.target.value })}>
                      {meta.form2553TaxYearTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  {f2553.taxYearType === "Fiscal Year" && (
                    <div className="field" style={{ margin: 0 }}>
                      <label htmlFor="gf-2553-fiscal-year-end">Fiscal year ending (month/day)</label>
                      <input id="gf-2553-fiscal-year-end" value={f2553.fiscalYearEndMonth} onChange={(e) => setF2553({ ...f2553, fiscalYearEndMonth: e.target.value })} placeholder="e.g. June 30" />
                    </div>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-2553-officer-name">Officer name</label>
                    <input id="gf-2553-officer-name" value={f2553.officerName} onChange={(e) => setF2553({ ...f2553, officerName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-2553-officer-title">Officer title</label>
                    <input id="gf-2553-officer-title" value={f2553.officerTitle} onChange={(e) => setF2553({ ...f2553, officerTitle: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-2553-officer-phone">Officer phone</label>
                    <input id="gf-2553-officer-phone" value={f2553.officerPhone} onChange={(e) => setF2553({ ...f2553, officerPhone: e.target.value })} />
                  </div>
                </div>

                <div className="field" style={{ marginTop: 12 }}>
                  <label>Shareholders <span className="muted">(up to 4)</span></label>
                  {shareholders.map((s, i) => (
                    <div key={i} className="card" style={{ marginBottom: 8, padding: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <strong style={{ fontSize: 12.5 }}>Shareholder {i + 1}</strong>
                        {shareholders.length > 1 && (
                          <button type="button" className="link-button" style={{ color: "var(--red)" }}
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
                    <label htmlFor="gf-w9-name">Name</label>
                    <input id="gf-w9-name" value={w9.name} onChange={(e) => setW9({ ...w9, name: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-w9-business-name">Business name <span className="muted">(if different)</span></label>
                    <input id="gf-w9-business-name" value={w9.businessName} onChange={(e) => setW9({ ...w9, businessName: e.target.value })} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="gf-w9-tax-classification">Federal tax classification</label>
                  <select id="gf-w9-tax-classification" value={w9.taxClassification} onChange={(e) => setW9({ ...w9, taxClassification: e.target.value })}>
                    {meta.w9TaxClassifications.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {w9.taxClassification === "LLC" && (
                  <div className="field" style={{ maxWidth: 200 }}>
                    <label htmlFor="gf-w9-llc-code">LLC tax classification (C, S, or P)</label>
                    <input id="gf-w9-llc-code" maxLength={1} value={w9.llcTaxClassificationCode} onChange={(e) => setW9({ ...w9, llcTaxClassificationCode: e.target.value.toUpperCase() })} />
                  </div>
                )}
                {w9.taxClassification === "Other" && (
                  <div className="field">
                    <label htmlFor="gf-w9-other-classification">Describe</label>
                    <input id="gf-w9-other-classification" value={w9.otherClassificationText} onChange={(e) => setW9({ ...w9, otherClassificationText: e.target.value })} />
                  </div>
                )}
                <div className="field">
                  <label htmlFor="gf-w9-address">Address</label>
                  <input id="gf-w9-address" value={w9.address} onChange={(e) => setW9({ ...w9, address: e.target.value })} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-w9-city">City</label>
                    <input id="gf-w9-city" value={w9.city} onChange={(e) => setW9({ ...w9, city: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-w9-state">State</label>
                    <input id="gf-w9-state" value={w9.state} onChange={(e) => setW9({ ...w9, state: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-w9-zip">ZIP</label>
                    <input id="gf-w9-zip" value={w9.zip} onChange={(e) => setW9({ ...w9, zip: e.target.value })} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-w9-ssn">SSN <span className="muted">(if applicable)</span></label>
                    <input id="gf-w9-ssn" value={w9.ssn} onChange={(e) => setW9({ ...w9, ssn: e.target.value })} placeholder="XXX-XX-XXXX" />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-w9-ein">EIN <span className="muted">(if applicable)</span></label>
                    <input id="gf-w9-ein" value={w9.ein} onChange={(e) => setW9({ ...w9, ein: e.target.value })} placeholder="XX-XXXXXXX" />
                  </div>
                </div>
              </div>
            )}

            {formType === "CRA" && (
              <div>
                <p className="muted" style={{ fontSize: 12 }}>
                  Registers this business for Maryland tax accounts (sales &amp; use tax, employer withholding, etc.). Covers
                  Sections A/B/F of the real form — the detailed eligibility questions in Sections B(10-16)/C/D (alcohol,
                  tobacco, motor fuel, successor-employer history) are left for the preparer to complete by hand from the
                  form's own printed instructions, since they depend on facts this app doesn't track.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-cra-legal-name">Legal name of entity</label>
                    <input id="gf-cra-legal-name" value={cra.legalLastName} onChange={(e) => setCra({ ...cra, legalLastName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-cra-trade-name">Trade name <span className="muted">(optional)</span></label>
                    <input id="gf-cra-trade-name" value={cra.tradeName} onChange={(e) => setCra({ ...cra, tradeName: e.target.value })} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-cra-fein">FEIN</label>
                    <input id="gf-cra-fein" value={cra.fein} onChange={(e) => setCra({ ...cra, fein: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-cra-ssn">Responsible party SSN</label>
                    <input id="gf-cra-ssn" value={cra.ssn} onChange={(e) => setCra({ ...cra, ssn: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-cra-dat-entity-id">SDAT Entity ID</label>
                    <input id="gf-cra-dat-entity-id" value={cra.datEntityId} onChange={(e) => setCra({ ...cra, datEntityId: e.target.value })} />
                  </div>
                </div>

                <div className="field"><label htmlFor="gf-cra-street1">Street address — Line 1</label><input id="gf-cra-street1" value={cra.street1} onChange={(e) => setCra({ ...cra, street1: e.target.value })} /></div>
                <div className="field"><label htmlFor="gf-cra-street2">Street address — Line 2 <span className="muted">(optional)</span></label><input id="gf-cra-street2" value={cra.street2} onChange={(e) => setCra({ ...cra, street2: e.target.value })} /></div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}><label htmlFor="gf-cra-city">City</label><input id="gf-cra-city" value={cra.city} onChange={(e) => setCra({ ...cra, city: e.target.value })} /></div>
                  <div className="field" style={{ margin: 0 }}><label htmlFor="gf-cra-state">State</label><input id="gf-cra-state" value={cra.state} onChange={(e) => setCra({ ...cra, state: e.target.value })} /></div>
                  <div className="field" style={{ margin: 0 }}><label htmlFor="gf-cra-zip">ZIP</label><input id="gf-cra-zip" value={cra.zip} onChange={(e) => setCra({ ...cra, zip: e.target.value })} /></div>
                  <div className="field" style={{ margin: 0 }}><label htmlFor="gf-cra-county">County</label><input id="gf-cra-county" value={cra.county} onChange={(e) => setCra({ ...cra, county: e.target.value })} /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}><label htmlFor="gf-cra-phone">Telephone</label><input id="gf-cra-phone" value={cra.phone} onChange={(e) => setCra({ ...cra, phone: e.target.value })} /></div>
                  <div className="field" style={{ margin: 0 }}><label htmlFor="gf-cra-fax">Fax <span className="muted">(optional)</span></label><input id="gf-cra-fax" value={cra.fax} onChange={(e) => setCra({ ...cra, fax: e.target.value })} /></div>
                  <div className="field" style={{ margin: 0 }}><label htmlFor="gf-cra-email">Email</label><input id="gf-cra-email" value={cra.email} onChange={(e) => setCra({ ...cra, email: e.target.value })} /></div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-cra-reason">Reason for applying</label>
                    <select id="gf-cra-reason" value={cra.reason} onChange={(e) => setCra({ ...cra, reason: e.target.value })}>
                      {meta.craReasons.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-cra-ownership-type">Type of ownership</label>
                    <select id="gf-cra-ownership-type" value={cra.ownershipType} onChange={(e) => setCra({ ...cra, ownershipType: e.target.value })}>
                      {meta.craOwnershipTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                {cra.reason === "Other" && (
                  <div className="field"><label htmlFor="gf-cra-reason-other">Specify</label><input id="gf-cra-reason-other" value={cra.reasonOther} onChange={(e) => setCra({ ...cra, reasonOther: e.target.value })} /></div>
                )}

                <div className="field" style={{ marginTop: 6 }}>
                  <label>Tax accounts being requested</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
                    {meta.craTaxTypes.map((t) => (
                      <label key={t} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                        <input type="checkbox" checked={cra.taxTypes.includes(t)} onChange={() => toggleCraTaxType(t)} />
                        {t}
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 6 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-cra-naics-code">NAICS code <span className="muted">(6 digit, optional)</span></label>
                    <input id="gf-cra-naics-code" value={cra.naicsCode} onChange={(e) => setCra({ ...cra, naicsCode: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-cra-business-activity">Business activity</label>
                    <input id="gf-cra-business-activity" value={cra.businessActivity} onChange={(e) => setCra({ ...cra, businessActivity: e.target.value })} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="gf-cra-product-service">Product manufactured/sold or service performed</label>
                  <input id="gf-cra-product-service" value={cra.productOrService} onChange={(e) => setCra({ ...cra, productOrService: e.target.value })} />
                </div>

                <div className="field" style={{ marginTop: 6 }}>
                  <label htmlFor="gf-cra-officer-first-name">Owner / officer / responsible party</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    <input id="gf-cra-officer-first-name" placeholder="First name" value={cra.officerFirstName} onChange={(e) => setCra({ ...cra, officerFirstName: e.target.value })} />
                    <input aria-label="Officer last name" placeholder="Last name" value={cra.officerLastName} onChange={(e) => setCra({ ...cra, officerLastName: e.target.value })} />
                    <input aria-label="Officer title" placeholder="Title" value={cra.officerTitle} onChange={(e) => setCra({ ...cra, officerTitle: e.target.value })} />
                    <input aria-label="Officer SSN" placeholder="SSN" value={cra.officerSsn} onChange={(e) => setCra({ ...cra, officerSsn: e.target.value })} />
                    <input aria-label="Officer telephone" placeholder="Telephone" value={cra.officerPhone} onChange={(e) => setCra({ ...cra, officerPhone: e.target.value })} />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="gf-cra-preparer-name">Name of preparer <span className="muted">(if other than applicant)</span></label>
                  <input id="gf-cra-preparer-name" value={cra.preparerName} onChange={(e) => setCra({ ...cra, preparerName: e.target.value })} />
                </div>
              </div>
            )}

            {formType === "8332" && (
              <div>
                <p className="muted" style={{ fontSize: 12 }}>For releasing (or revoking) a claim to a child's dependency exemption between two parents — not tied to this client's own business info.</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-8332-noncustodial-name">Noncustodial parent's name</label>
                    <input id="gf-8332-noncustodial-name" value={f8332.noncustodialParentName} onChange={(e) => setF8332({ ...f8332, noncustodialParentName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-8332-noncustodial-ssn">Noncustodial parent's SSN</label>
                    <input id="gf-8332-noncustodial-ssn" value={f8332.noncustodialParentSsn} onChange={(e) => setF8332({ ...f8332, noncustodialParentSsn: e.target.value })} />
                  </div>
                </div>
                <div className="field" style={{ maxWidth: 260 }}>
                  <label htmlFor="gf-8332-custodial-ssn">Custodial parent's SSN <span className="muted">(the signer)</span></label>
                  <input id="gf-8332-custodial-ssn" value={f8332.custodialParentSsn} onChange={(e) => setF8332({ ...f8332, custodialParentSsn: e.target.value })} />
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
