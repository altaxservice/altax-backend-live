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
 * 8832, CRA, 8822-B). Unlike the POA forms modal (one shared taxpayer/
 * representatives shape across all three forms it covers), these forms have
 * almost nothing in common — the fields shown change entirely based on
 * which form is selected. Preview/Print/Download only, no e-sign: every one
 * of these is physical-signature-only, same rule as every other government
 * form and client contract in this app.
 */
interface FirmProfileLite { firmName: string; street: string; city: string; state: string; zipCode: string; phone: string; email: string }

export function GenerateGovFormModal({ clientId, defaultFormType, editingFiling, onClose, onDone }: {
  clientId: string;
  defaultFormType?: ClientGovFormType;
  /** Pass an existing Draft filing to edit it in place (PATCH) instead of creating a new one — form type is then locked to whatever the filing already is. */
  editingFiling?: { filing_id: string; form_type: ClientGovFormType; form_data: Record<string, any> };
  onClose: () => void;
  onDone: () => void;
}) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const isEditing = !!editingFiling;
  const [meta, setMeta] = useState<GovFormsMeta | null>(null);
  const [identity, setIdentity] = useState<ClientIdentity | null>(null);
  const [firmProfile, setFirmProfile] = useState<FirmProfileLite | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formType, setFormType] = useState<ClientGovFormType>(editingFiling?.form_type || defaultFormType || "SS4");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Only offered when creating a fresh CRA filing — see the CRA section below.
  const [craGeneratePoa, setCraGeneratePoa] = useState(false);

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
    firstSaleDateMd: "", firstWagesDateMd: "",
    poaAttached: false,
    officerLastName: "", officerFirstName: "", officerSsn: "", officerTitle: "",
    officerStreet: "", officerCity: "", officerState: "", officerZip: "", officerPhone: "",
    preparerName: "AL TAX SERVICE",
  });
  function toggleCraTaxType(t: string) {
    setCra((f) => ({ ...f, taxTypes: f.taxTypes.includes(t) ? f.taxTypes.filter((x) => x !== t) : [...f.taxTypes, t] }));
  }

  // Form 8822-B state
  const [f8822b, setF8822b] = useState({
    taxExemptOrg: false,
    affectsEmploymentReturns: false, affectsEmployeePlanReturns: false, affectsBusinessLocation: false,
    businessName: "", ein: "",
    oldMailingAddress: "", oldMailingForeignCountry: "", oldMailingForeignProvince: "", oldMailingForeignPostalCode: "",
    newMailingAddress: "", newMailingForeignCountry: "", newMailingForeignProvince: "", newMailingForeignPostalCode: "",
    newBusinessLocation: "", newBusinessLocationForeignCountry: "", newBusinessLocationForeignProvince: "", newBusinessLocationForeignPostalCode: "",
    newResponsiblePartyName: "", newResponsiblePartyId: "",
    daytimePhone: "", title: "",
  });

  // Form 8832 state
  const [f8832, setF8832] = useState({
    legalName: "", ein: "", street: "", cityStateZip: "",
    addressChange: false, lateReliefUnder200941: false, lateChangeReliefUnder201032: false,
    typeOfElection: "Initial classification by a newly-formed entity",
    priorElectionLast60Months: false, priorElectionWasInitialAtFormation: false,
    moreThanOneOwner: true,
    ownerName: "", ownerId: "",
    parentCorpName: "", parentCorpEin: "",
    entityType: "Domestic — partnership",
    foreignCountryOfOrganization: "", effectiveDate: "",
    contactNameTitle: "", contactPhone: "", signerTitle: "",
    lateReliefExplanation: "", lateReliefSignerTitle: "",
  });

  useEffect(() => {
    Promise.all([
      api.get<GovFormsMeta>("/gov-forms/meta"),
      api.get<{ client: ClientIdentity }>(`/gov-forms/client/${clientId}/identity`),
      api.get<FirmProfileLite>("/firm-settings"),
    ])
      .then(([m, res, firm]) => {
        setMeta(m);
        setIdentity(res.client);
        setFirmProfile(firm);

        // Editing an existing Draft: initialize every field from what's
        // already saved on the filing, not a fresh re-prefill from the
        // client record — the client's own data may have changed since this
        // filing was first created, and a filing is a snapshot, not a live view.
        if (editingFiling) {
          const d = editingFiling.form_data || {};
          if (editingFiling.form_type === "SS4") setSs4((f) => ({ ...f, ...d }));
          if (editingFiling.form_type === "2553") {
            setF2553((f) => ({ ...f, ...d }));
            if (Array.isArray(d.shareholders) && d.shareholders.length) setShareholders(d.shareholders);
          }
          if (editingFiling.form_type === "W9") setW9((f) => ({ ...f, ...d }));
          if (editingFiling.form_type === "CRA") setCra((f) => ({ ...f, ...d }));
          if (editingFiling.form_type === "8822B") setF8822b((f) => ({ ...f, ...d }));
          if (editingFiling.form_type === "8832") setF8832((f) => ({ ...f, ...d }));
          return;
        }

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
          fein: res.client.ein || "", ssn: res.client.individual_ssn || "",
          // SDAT Entity ID is deliberately never autofilled, even though the
          // client record has one on file (secretary_of_state_id) — the
          // number that belongs on this exact filing isn't always the same
          // as whatever's stored on the client profile (e.g. a fresh
          // registration, or a correction), so it's typed in by hand every
          // time rather than risk silently carrying over a stale/wrong ID.
          datEntityId: "",
          // Box 2a on the real form is "Legal FIRST name" — but for an
          // entity filing (the overwhelming majority of CRA use here) the
          // full legal business name goes entirely in 2a, with 2b left
          // blank, not split across the two boxes. See cra.ts's CraData
          // comment.
          legalFirstName: res.client.client_name,
          street1: res.client.street_address || "", city: res.client.city || "", state: res.client.state || "MD", zip: res.client.zip_code || "",
          phone: res.client.phone || "", email: res.client.email || "",
          officerFirstName: officer.first, officerLastName: officer.last, officerSsn: res.client.company_contact_ssn || "",
          officerTitle: res.client.company_contact_title || "",
          officerStreet: res.client.street_address || "", officerCity: res.client.city || "", officerState: res.client.state || "MD", officerZip: res.client.zip_code || "",
          officerPhone: res.client.company_contact_phone || res.client.phone || "",
        }));
        setF8822b((f) => ({
          ...f,
          businessName: res.client.client_name, ein: res.client.ein || "",
          // "Old" mailing address is genuinely the address on file today —
          // unlike CRA's SDAT Entity ID or this form's own "new" fields
          // below, prefilling this one doesn't risk carrying over stale
          // data, since the whole point of line 5 is what it USED to be.
          oldMailingAddress: addr,
          // Everything the form is reporting as a CHANGE (new address, new
          // business location, new responsible party) is deliberately left
          // blank rather than defaulted from the client record — same
          // reasoning as CRA's SDAT Entity ID.
        }));
        setF8832((f) => ({
          ...f,
          legalName: res.client.client_name, ein: res.client.ein || "",
          street: res.client.street_address || "",
          cityStateZip: [res.client.city, [res.client.state, res.client.zip_code].filter(Boolean).join(" ")].filter(Boolean).join(", "),
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
      if (!cra.legalFirstName.trim()) { setSaveError("Legal name is required."); return null; }
      if (!cra.street1.trim() || !cra.city.trim() || !cra.zip.trim()) { setSaveError("Physical business address is required."); return null; }
      if (cra.taxTypes.length === 0) { setSaveError("Select at least one tax account being requested."); return null; }
      return { ...cra };
    }
    if (formType === "8822B") {
      if (!f8822b.businessName.trim()) { setSaveError("Business name is required."); return null; }
      if (!f8822b.affectsEmploymentReturns && !f8822b.affectsEmployeePlanReturns && !f8822b.affectsBusinessLocation) {
        setSaveError("Check at least one box for what this change affects.");
        return null;
      }
      return { ...f8822b };
    }
    // 8832
    if (!f8832.legalName.trim()) { setSaveError("Name of the eligible entity is required."); return null; }
    if (!f8832.street.trim() || !f8832.cityStateZip.trim()) { setSaveError("Mailing address is required."); return null; }
    if (f8832.moreThanOneOwner && (f8832.entityType.includes("single owner"))) {
      setSaveError("Line 6's entity type says single owner, but line 3 says more than one owner — pick one.");
      return null;
    }
    if (f8832.lateReliefUnder200941 && !f8832.lateReliefExplanation.trim()) {
      setSaveError("Explain why the election wasn't filed on time (Part II, line 11) — required when late relief is checked.");
      return null;
    }
    return { ...f8832 };
  }

  async function handleSubmit() {
    setSaveError(null);
    const formData = buildFormData();
    if (!formData) return;
    setSaving(true);
    try {
      if (isEditing) {
        await api.patch(`/gov-forms/${editingFiling!.filing_id}`, { formData });
      } else {
        await api.post(`/gov-forms/client/${clientId}`, { formType, formData });
        // Best-effort, separate request — a failure here shouldn't undo the
        // CRA filing that already succeeded; the checkbox is a convenience,
        // not a transaction. Staff can always create the POA by hand from
        // the POA Filings section if this second call fails.
        if (formType === "CRA" && craGeneratePoa && firmProfile) {
          try {
            await api.post(`/poa-forms/client/${clientId}`, {
              formType: "548",
              representatives: [{
                name: firmProfile.firmName,
                address: [firmProfile.street, [firmProfile.city, firmProfile.state, firmProfile.zipCode].filter(Boolean).join(", ")].filter(Boolean).join(", "),
                phone: firmProfile.phone || undefined,
                email: firmProfile.email || undefined,
              }],
              taxMatters: [{ description: `Maryland business tax registration (${cra.taxTypes.join(", ") || "Combined Registration Application"})`, taxForm: "CRA" }],
              notes: "Auto-generated alongside the Maryland CRA filing for this registration.",
            });
          } catch {
            // Swallowed intentionally — see comment above.
          }
        }
      }
      onDone();
      onClose();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : `Could not ${isEditing ? "save" : "create"} this filing.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="generate-gov-form-title" style={{ maxWidth: 680, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="generate-gov-form-title">{isEditing ? "Edit Draft Filing" : "Generate Government Form"}</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>

        {loadError && <ErrorBanner error={loadError} />}
        {!meta || !identity || !firmProfile ? (
          <p className="muted">Loading…</p>
        ) : (
          <div>
            {saveError && <ErrorBanner error={saveError} />}

            <div className="field">
              <label htmlFor="gf-type">Form</label>
              {isEditing ? (
                <input id="gf-type" value={meta.clientFormTypes.find((f) => f.value === formType)?.label || formType} disabled readOnly />
              ) : (
                <select id="gf-type" value={formType} onChange={(e) => setFormType(e.target.value as ClientGovFormType)}>
                  {meta.clientFormTypes.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              )}
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
                {!isEditing && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, margin: "0 0 14px", padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
                    <input
                      type="checkbox"
                      checked={craGeneratePoa}
                      onChange={(e) => {
                        setCraGeneratePoa(e.target.checked);
                        if (e.target.checked) setCra((f) => ({ ...f, poaAttached: true }));
                      }}
                    />
                    Also generate a Maryland Form 548 (Power of Attorney), authorizing {firmProfile.firmName} to handle this
                    registration with the Comptroller — creates a second Draft filing alongside this one, in the POA Filings section.
                  </label>
                )}
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, margin: "0 0 14px", padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
                  <input type="checkbox" checked={cra.poaAttached} onChange={(e) => setCra({ ...cra, poaAttached: e.target.checked })} />
                  Check here if a power of attorney form is attached <span className="muted">(checks the CRA's own box — use this if a signed Form 548 is being filed alongside, whether generated above or already on hand)</span>
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-cra-legal-name">Legal name of entity <span className="muted">(Box 2a)</span></label>
                    <input id="gf-cra-legal-name" value={cra.legalFirstName} onChange={(e) => setCra({ ...cra, legalFirstName: e.target.value })} />
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
                    <label htmlFor="gf-cra-dat-entity-id">SDAT Entity ID <span className="muted">(enter manually)</span></label>
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

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-cra-first-sale-date">Date first sales made in Maryland <span className="muted">(MMDDYYYY, optional)</span></label>
                    <input id="gf-cra-first-sale-date" placeholder="MMDDYYYY" value={cra.firstSaleDateMd} onChange={(e) => setCra({ ...cra, firstSaleDateMd: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-cra-first-wages-date">Date first wages paid in Maryland subject to withholding <span className="muted">(MMDDYYYY, optional)</span></label>
                    <input id="gf-cra-first-wages-date" placeholder="MMDDYYYY" value={cra.firstWagesDateMd} onChange={(e) => setCra({ ...cra, firstWagesDateMd: e.target.value })} />
                  </div>
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

            {formType === "8822B" && (
              <div>
                <p className="muted" style={{ fontSize: 12 }}>
                  Notifies the IRS of a change to this business's mailing address, physical location, or responsible party.
                  Fill in only the line(s) that actually changed — leave the others blank.
                </p>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, margin: "0 0 10px", padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
                  <input type="checkbox" checked={f8822b.taxExemptOrg} onChange={(e) => setF8822b({ ...f8822b, taxExemptOrg: e.target.checked })} />
                  This is a tax-exempt organization
                </label>
                <div className="field">
                  <label>Check all boxes this change affects</label>
                  <div style={{ display: "grid", gap: 4 }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                      <input type="checkbox" checked={f8822b.affectsEmploymentReturns} onChange={(e) => setF8822b({ ...f8822b, affectsEmploymentReturns: e.target.checked })} />
                      Employment, excise, income, and other business returns (Forms 720, 940, 941, 990, 1041, 1065, 1120, etc.)
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                      <input type="checkbox" checked={f8822b.affectsEmployeePlanReturns} onChange={(e) => setF8822b({ ...f8822b, affectsEmployeePlanReturns: e.target.checked })} />
                      Employee plan returns (Forms 5500, 5500-EZ, etc.)
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                      <input type="checkbox" checked={f8822b.affectsBusinessLocation} onChange={(e) => setF8822b({ ...f8822b, affectsBusinessLocation: e.target.checked })} />
                      Business location
                    </label>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-8822b-business-name">Business name <span className="muted">(line 4a)</span></label>
                    <input id="gf-8822b-business-name" value={f8822b.businessName} onChange={(e) => setF8822b({ ...f8822b, businessName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-8822b-ein">EIN <span className="muted">(line 4b)</span></label>
                    <input id="gf-8822b-ein" value={f8822b.ein} onChange={(e) => setF8822b({ ...f8822b, ein: e.target.value })} />
                  </div>
                </div>

                <div className="field" style={{ marginTop: 6 }}>
                  <label htmlFor="gf-8822b-old-address">Old mailing address <span className="muted">(line 5 — leave blank if only the responsible party changed)</span></label>
                  <input id="gf-8822b-old-address" value={f8822b.oldMailingAddress} onChange={(e) => setF8822b({ ...f8822b, oldMailingAddress: e.target.value })} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <input aria-label="Old mailing address foreign country" placeholder="Foreign country name" value={f8822b.oldMailingForeignCountry} onChange={(e) => setF8822b({ ...f8822b, oldMailingForeignCountry: e.target.value })} />
                  <input aria-label="Old mailing address foreign province" placeholder="Foreign province/county" value={f8822b.oldMailingForeignProvince} onChange={(e) => setF8822b({ ...f8822b, oldMailingForeignProvince: e.target.value })} />
                  <input aria-label="Old mailing address foreign postal code" placeholder="Foreign postal code" value={f8822b.oldMailingForeignPostalCode} onChange={(e) => setF8822b({ ...f8822b, oldMailingForeignPostalCode: e.target.value })} />
                </div>

                <div className="field" style={{ marginTop: 10 }}>
                  <label htmlFor="gf-8822b-new-address">New mailing address <span className="muted">(line 6)</span></label>
                  <input id="gf-8822b-new-address" value={f8822b.newMailingAddress} onChange={(e) => setF8822b({ ...f8822b, newMailingAddress: e.target.value })} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <input aria-label="New mailing address foreign country" placeholder="Foreign country name" value={f8822b.newMailingForeignCountry} onChange={(e) => setF8822b({ ...f8822b, newMailingForeignCountry: e.target.value })} />
                  <input aria-label="New mailing address foreign province" placeholder="Foreign province/county" value={f8822b.newMailingForeignProvince} onChange={(e) => setF8822b({ ...f8822b, newMailingForeignProvince: e.target.value })} />
                  <input aria-label="New mailing address foreign postal code" placeholder="Foreign postal code" value={f8822b.newMailingForeignPostalCode} onChange={(e) => setF8822b({ ...f8822b, newMailingForeignPostalCode: e.target.value })} />
                </div>

                <div className="field" style={{ marginTop: 10 }}>
                  <label htmlFor="gf-8822b-new-location">New business location <span className="muted">(line 7)</span></label>
                  <input id="gf-8822b-new-location" value={f8822b.newBusinessLocation} onChange={(e) => setF8822b({ ...f8822b, newBusinessLocation: e.target.value })} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <input aria-label="New business location foreign country" placeholder="Foreign country name" value={f8822b.newBusinessLocationForeignCountry} onChange={(e) => setF8822b({ ...f8822b, newBusinessLocationForeignCountry: e.target.value })} />
                  <input aria-label="New business location foreign province" placeholder="Foreign province/county" value={f8822b.newBusinessLocationForeignProvince} onChange={(e) => setF8822b({ ...f8822b, newBusinessLocationForeignProvince: e.target.value })} />
                  <input aria-label="New business location foreign postal code" placeholder="Foreign postal code" value={f8822b.newBusinessLocationForeignPostalCode} onChange={(e) => setF8822b({ ...f8822b, newBusinessLocationForeignPostalCode: e.target.value })} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginTop: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-8822b-new-rp-name">New responsible party's name <span className="muted">(line 8)</span></label>
                    <input id="gf-8822b-new-rp-name" value={f8822b.newResponsiblePartyName} onChange={(e) => setF8822b({ ...f8822b, newResponsiblePartyName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-8822b-new-rp-id">New responsible party's SSN/ITIN/EIN <span className="muted">(line 9)</span></label>
                    <input id="gf-8822b-new-rp-id" value={f8822b.newResponsiblePartyId} onChange={(e) => setF8822b({ ...f8822b, newResponsiblePartyId: e.target.value })} />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-8822b-phone">Daytime telephone <span className="muted">(optional)</span></label>
                    <input id="gf-8822b-phone" value={f8822b.daytimePhone} onChange={(e) => setF8822b({ ...f8822b, daytimePhone: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-8822b-title">Title of signer <span className="muted">(officer, owner, general partner, etc.)</span></label>
                    <input id="gf-8822b-title" value={f8822b.title} onChange={(e) => setF8822b({ ...f8822b, title: e.target.value })} />
                  </div>
                </div>
              </div>
            )}

            {formType === "8832" && (
              <div>
                <p className="muted" style={{ fontSize: 12 }}>
                  Elects how this entity is classified for federal tax purposes — as a corporation, a partnership, or (single-owner only)
                  disregarded as a separate entity. Covers Part I in full; Part II (late-election relief) is only needed when that box below is checked.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-8832-legal-name">Name of eligible entity making election</label>
                    <input id="gf-8832-legal-name" value={f8832.legalName} onChange={(e) => setF8832({ ...f8832, legalName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-8832-ein">EIN</label>
                    <input id="gf-8832-ein" value={f8832.ein} onChange={(e) => setF8832({ ...f8832, ein: e.target.value })} />
                  </div>
                </div>
                <div className="field"><label htmlFor="gf-8832-street">Number, street, and room or suite no.</label><input id="gf-8832-street" value={f8832.street} onChange={(e) => setF8832({ ...f8832, street: e.target.value })} /></div>
                <div className="field"><label htmlFor="gf-8832-city-state-zip">City or town, state, and ZIP code</label><input id="gf-8832-city-state-zip" value={f8832.cityStateZip} onChange={(e) => setF8832({ ...f8832, cityStateZip: e.target.value })} /></div>

                <div className="field" style={{ marginTop: 6 }}>
                  <label>Check if:</label>
                  <div style={{ display: "grid", gap: 4 }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                      <input type="checkbox" checked={f8832.addressChange} onChange={(e) => setF8832({ ...f8832, addressChange: e.target.checked })} />
                      Address change
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                      <input type="checkbox" checked={f8832.lateReliefUnder200941} onChange={(e) => setF8832({ ...f8832, lateReliefUnder200941: e.target.checked })} />
                      Late classification relief sought under Revenue Procedure 2009-41
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                      <input type="checkbox" checked={f8832.lateChangeReliefUnder201032} onChange={(e) => setF8832({ ...f8832, lateChangeReliefUnder201032: e.target.checked })} />
                      Relief for a late change of entity classification election sought under Revenue Procedure 2010-32
                    </label>
                  </div>
                </div>

                <div className="field" style={{ marginTop: 6 }}>
                  <label htmlFor="gf-8832-type-of-election">Line 1 — Type of election</label>
                  <select id="gf-8832-type-of-election" value={f8832.typeOfElection} onChange={(e) => setF8832({ ...f8832, typeOfElection: e.target.value })}>
                    {meta.form8832TypeOfElection.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {f8832.typeOfElection === "Change in current classification" && (
                  <div style={{ marginLeft: 22 }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, margin: "4px 0" }}>
                      <input type="checkbox" checked={f8832.priorElectionLast60Months} onChange={(e) => setF8832({ ...f8832, priorElectionLast60Months: e.target.checked })} />
                      Line 2a — Entity previously filed an election with an effective date within the last 60 months
                    </label>
                    {f8832.priorElectionLast60Months && (
                      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, margin: "4px 0", marginLeft: 22 }}>
                        <input type="checkbox" checked={f8832.priorElectionWasInitialAtFormation} onChange={(e) => setF8832({ ...f8832, priorElectionWasInitialAtFormation: e.target.checked })} />
                        Line 2b — That prior election was an initial classification election effective on the date of formation
                      </label>
                    )}
                  </div>
                )}

                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, margin: "10px 0 4px" }}>
                  <input type="checkbox" checked={f8832.moreThanOneOwner} onChange={(e) => setF8832({ ...f8832, moreThanOneOwner: e.target.checked })} />
                  Line 3 — Does the eligible entity have more than one owner?
                </label>
                {!f8832.moreThanOneOwner && (
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginLeft: 22 }}>
                    <div className="field" style={{ margin: 0 }}>
                      <label htmlFor="gf-8832-owner-name">Line 4a — Name of owner</label>
                      <input id="gf-8832-owner-name" value={f8832.ownerName} onChange={(e) => setF8832({ ...f8832, ownerName: e.target.value })} />
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <label htmlFor="gf-8832-owner-id">Line 4b — Identifying number of owner</label>
                      <input id="gf-8832-owner-id" value={f8832.ownerId} onChange={(e) => setF8832({ ...f8832, ownerId: e.target.value })} />
                    </div>
                  </div>
                )}

                <div className="field" style={{ marginTop: 6 }}>
                  <label>Line 5 — If owned by one or more affiliated corporations filing a consolidated return <span className="muted">(optional)</span></label>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                    <input aria-label="Name of parent corporation" placeholder="Name of parent corporation" value={f8832.parentCorpName} onChange={(e) => setF8832({ ...f8832, parentCorpName: e.target.value })} />
                    <input aria-label="EIN of parent corporation" placeholder="EIN" value={f8832.parentCorpEin} onChange={(e) => setF8832({ ...f8832, parentCorpEin: e.target.value })} />
                  </div>
                </div>

                <div className="field" style={{ marginTop: 6 }}>
                  <label htmlFor="gf-8832-entity-type">Line 6 — Type of entity</label>
                  <select id="gf-8832-entity-type" value={f8832.entityType} onChange={(e) => setF8832({ ...f8832, entityType: e.target.value })}>
                    {meta.form8832EntityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {f8832.entityType.startsWith("Foreign") && (
                  <div className="field">
                    <label htmlFor="gf-8832-foreign-country">Line 7 — Foreign country of organization</label>
                    <input id="gf-8832-foreign-country" value={f8832.foreignCountryOfOrganization} onChange={(e) => setF8832({ ...f8832, foreignCountryOfOrganization: e.target.value })} />
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 10, marginTop: 6 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-8832-effective-date">Line 8 — Effective date <span className="muted">(month, day, year)</span></label>
                    <input id="gf-8832-effective-date" placeholder="MM/DD/YYYY" value={f8832.effectiveDate} onChange={(e) => setF8832({ ...f8832, effectiveDate: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-8832-contact-name-title">Line 9 — Contact person's name and title</label>
                    <input id="gf-8832-contact-name-title" value={f8832.contactNameTitle} onChange={(e) => setF8832({ ...f8832, contactNameTitle: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-8832-contact-phone">Line 10 — Contact phone</label>
                    <input id="gf-8832-contact-phone" value={f8832.contactPhone} onChange={(e) => setF8832({ ...f8832, contactPhone: e.target.value })} />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="gf-8832-signer-title">Consent statement — Title of first signer <span className="muted">(optional; Signature and Date are handwritten)</span></label>
                  <input id="gf-8832-signer-title" value={f8832.signerTitle} onChange={(e) => setF8832({ ...f8832, signerTitle: e.target.value })} />
                </div>

                {f8832.lateReliefUnder200941 && (
                  <>
                    <div className="field" style={{ marginTop: 10 }}>
                      <label htmlFor="gf-8832-late-relief-explanation">Part II, Line 11 — Explanation for why the election wasn't filed on time</label>
                      <textarea id="gf-8832-late-relief-explanation" rows={3} value={f8832.lateReliefExplanation} onChange={(e) => setF8832({ ...f8832, lateReliefExplanation: e.target.value })} />
                    </div>
                    <div className="field">
                      <label htmlFor="gf-8832-late-relief-signer-title">Part II consent statement — Title of first signer <span className="muted">(optional)</span></label>
                      <input id="gf-8832-late-relief-signer-title" value={f8832.lateReliefSignerTitle} onChange={(e) => setF8832({ ...f8832, lateReliefSignerTitle: e.target.value })} />
                    </div>
                  </>
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
