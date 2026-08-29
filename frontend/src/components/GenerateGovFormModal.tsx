import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import type { GovFormsMeta, ClientGovFormType } from "../api/govForms";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useFormDraft } from "../hooks/useFormDraft";
import { DraftRestoreBanner } from "../components/DraftRestoreBanner";
import { useToast } from "../components/Toast";

interface ClientIdentity {
  client_id: string; client_name: string; entity_type: string | null;
  ein: string | null; individual_ssn: string | null;
  street_address: string | null; city: string | null; state: string | null; zip_code: string | null;
  company_contact_name: string | null; company_contact_title: string | null; company_contact_ssn: string | null;
  company_contact_email: string | null; company_contact_phone: string | null;
  company_contact_street_address: string | null; company_contact_city: string | null;
  company_contact_state: string | null; company_contact_zip_code: string | null;
  secretary_of_state_id: string | null; phone: string | null; email: string | null;
  date_of_formation: string | null; dba_name: string | null; industry_category: string | null; payroll_enabled: boolean;
  cra_registration_number: string | null; md_ui_employer_id: string | null; md_ui_tax_rate: number | null;
  referral_source: string | null; sales_tax_frequency: string | null;
}

/** "ABDULSAMAD ALMABARI" -> ["ABDULSAMAD", "ALMABARI"] — first word is the first name, everything else is the last name. Same heuristic used elsewhere in this app for splitting a single stored contact-name field into a form's separate first/last boxes; staff can always correct it before generating. */
function splitName(full: string | null | undefined): { first: string; last: string } {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: "", last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

// Maps this app's own client.entity_type vocabulary (clientOptions.ts's
// ENTITY_TYPES) onto SS4_ENTITY_TYPES' distinct IRS-form wording — a direct
// assignment would silently show blank (no matching <option>), the same
// class of casing/vocabulary mismatch bug already fixed elsewhere in this
// app (see PAYROLL_FREQS/FREQ_OPTIONS comments in clientOptions.ts).
// Individual/Partnership deliberately unmapped: an SS-4 is filed on the
// client's own timeline for those, and "Individual" has no real SS4
// equivalent (a sole proprietor's SSN, not an EIN application, in most
// cases) — safer to leave the form's existing default than guess wrong.
const SS4_ENTITY_TYPE_MAP: Record<string, string> = {
  "LLC": "LLC", "C-Corp": "Corporation", "S-Corp": "S Corporation",
  "Sole Proprietorship": "Sole Proprietor", "Nonprofit": "Other Nonprofit", "Partnership": "Partnership",
};

function combinedAddress(identity: ClientIdentity | null): string {
  if (!identity) return "";
  return [identity.street_address, [identity.city, identity.state, identity.zip_code].filter(Boolean).join(", ")]
    .filter(Boolean).join(", ");
}

interface Shareholder { name: string; address: string; idNumber: string; sharesOwned: string; dateAcquired: string; taxYearEnd: string }
const EMPTY_SHAREHOLDER: Shareholder = { name: "", address: "", idNumber: "", sharesOwned: "", dateAcquired: "", taxYearEnd: "" };

/** MD Articles of Dissolution's "FIFTH" director/trustee rows — same single-address-line shape as the real PDF's own fields, up to 4 rows. */
interface DirectorOrTrustee { name: string; address: string }
const EMPTY_DIRECTOR: DirectorOrTrustee = { name: "", address: "" };

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
  const toast = useToast();
  // Closing this modal (Cancel, the overlay, or Escape — none of which ask
  // "are you sure") used to mean losing everything typed, with zero
  // feedback that anything had happened. Now that the form autosaves,
  // closing is no longer destructive — but it still LOOKS the same to
  // someone watching it vanish, so this toast closes that gap: confirms a
  // draft actually exists to come back to, without adding a blocking
  // confirm dialog in front of the 95% of closes that are intentional.
  const hasSavedDraftRef = useRef(false);
  function handleClose() {
    if (hasSavedDraftRef.current) toast("Draft saved — reopen this form to restore it.");
    onClose();
  }
  useEscapeToClose(handleClose);
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
    // isLlc must start in sync with entityType's own default ("LLC") — the
    // entity-type <select>'s onChange keeps them in sync once touched, but if
    // staff leave the dropdown on its default (already-selected) value, onChange
    // never fires, and isLlc:false previously contradicted entityType:"LLC" —
    // checking "No" for Line 8a and hiding the LLC-member-count field on a
    // filing that IS for an LLC.
    isLlc: true, llcMemberCount: "", llcOrganizedInUs: true,
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
    // Informational only — not a field on the real CRA PDF (which is
    // inherently a new-registration form). Tracked here so staff can see
    // an existing Maryland Central Registration Number on file before
    // deciding whether this filing is a fresh registration or an update,
    // and so that choice is recorded on the filing itself.
    existingCraNumber: "", registrationAction: "new" as "new" | "update",
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

  // Maryland Articles of Amendment (LLC) state
  const [mdAmendLlc, setMdAmendLlc] = useState({
    llcName: "", amendmentText: "", newResidentAgentName: "",
  });

  // Maryland Articles of Amendment (Corporation) state
  const [mdAmendCorp, setMdAmendCorp] = useState({
    corpTypeBefore: "", corpName: "", amendmentText: "", approvalMethod: "",
    attestedByName: "", attestedByTitle: "", signedByName: "", signedByTitle: "",
    returnAddressLine1: "", returnAddressLine2: "", returnAddressLine3: "",
  });

  // Maryland Articles of Dissolution state
  const [mdDissolution, setMdDissolution] = useState({
    corpName: "", sdatId: "",
    principalOfficeAddress: "", residentAgentName: "", residentAgentAddress: "",
    approvalManner: "", otherMannerText: "",
    creditorNotice: "No known creditors" as "Mailed to known creditors" | "No known creditors",
    creditorNoticeMailedDate: "",
    effectiveDateType: "immediate" as "immediate" | "future",
    futureEffectiveDate: "",
    additionalProvisions: "",
    attestedByName: "", attestedByTitle: "", signedByName: "", signedByTitle: "",
    residentAgentConsentSignerName: "",
    presidentName: "", presidentAddress: "",
    treasurerName: "", treasurerAddress: "",
    secretaryName: "", secretaryAddress: "",
    otherOfficerName: "", otherOfficerAddress: "",
  });
  const [directors, setDirectors] = useState<DirectorOrTrustee[]>([{ ...EMPTY_DIRECTOR }]);
  function addDirector() {
    setDirectors((prev) => (prev.length >= 4 ? prev : [...prev, { ...EMPTY_DIRECTOR }]));
  }
  function patchDirector(i: number, patch: Partial<DirectorOrTrustee>) {
    setDirectors((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  }

  // Autosave — this modal has 140+ possible fields across the 6 form types,
  // the single biggest place in the app where an accidental tab close/reload
  // used to mean retyping everything. Keyed so editing an existing Draft has
  // its own slot (independent of form type, which is locked while editing),
  // and creating fresh has one slot per client+form-type (switching the Form
  // dropdown doesn't clobber whatever was typed under a different type).
  const draftFormKey = isEditing ? `gov-form-edit:${editingFiling!.filing_id}` : `gov-form:${clientId}:${formType}`;
  const { pendingDraft, draftChecked, saveDraft, clearDraft, dismissPendingDraft } = useFormDraft<{
    formType: ClientGovFormType; craGeneratePoa: boolean;
    ss4: typeof ss4; f2553: typeof f2553; shareholders: Shareholder[]; w9: typeof w9;
    cra: typeof cra; f8822b: typeof f8822b; f8832: typeof f8832;
    mdAmendLlc: typeof mdAmendLlc; mdAmendCorp: typeof mdAmendCorp;
    mdDissolution: typeof mdDissolution; directors: DirectorOrTrustee[];
  }>(draftFormKey);

  function restoreDraft() {
    if (!pendingDraft) return;
    const d = pendingDraft.data;
    setFormType(d.formType);
    setCraGeneratePoa(d.craGeneratePoa);
    setSs4(d.ss4);
    setF2553(d.f2553);
    setShareholders(d.shareholders);
    setW9(d.w9);
    setCra(d.cra);
    setF8822b(d.f8822b);
    setF8832(d.f8832);
    setMdAmendLlc(d.mdAmendLlc);
    setMdAmendCorp(d.mdAmendCorp);
    setMdDissolution(d.mdDissolution);
    setDirectors(d.directors);
    dismissPendingDraft();
  }

  // Only autosaves once the draft-check round trip has resolved AND there's
  // no pending draft still awaiting a Restore/Discard choice — otherwise the
  // freshly-prefilled (non-draft) state would silently overwrite the very
  // draft this effect exists to protect, before the user ever saw it.
  useEffect(() => {
    if (!draftChecked || pendingDraft) return;
    saveDraft({ formType, craGeneratePoa, ss4, f2553, shareholders, w9, cra, f8822b, f8832, mdAmendLlc, mdAmendCorp, mdDissolution, directors });
    hasSavedDraftRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftChecked, pendingDraft, formType, craGeneratePoa, ss4, f2553, shareholders, w9, cra, f8822b, f8832, mdAmendLlc, mdAmendCorp, mdDissolution, directors]);

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
          if (editingFiling.form_type === "MD_AMEND_LLC") setMdAmendLlc((f) => ({ ...f, ...d }));
          if (editingFiling.form_type === "MD_AMEND_CORP") setMdAmendCorp((f) => ({ ...f, ...d }));
          if (editingFiling.form_type === "MD_DISSOLUTION") {
            // form_data stores officers as a nested { president?, treasurer?, secretary?, other? }
            // object (see mdDissolution.ts's MdDissolutionData) — this modal's own state keeps
            // them as flat presidentName/presidentAddress-style fields instead, so unpack rather
            // than spread, or a saved Draft's officers would silently vanish on reopen.
            const o = d.officers || {};
            setMdDissolution((f) => ({
              ...f, ...d,
              presidentName: o.president?.name || "", presidentAddress: o.president?.address || "",
              treasurerName: o.treasurer?.name || "", treasurerAddress: o.treasurer?.address || "",
              secretaryName: o.secretary?.name || "", secretaryAddress: o.secretary?.address || "",
              otherOfficerName: o.other?.name || "", otherOfficerAddress: o.other?.address || "",
              effectiveDateType: d.effectiveDate === "immediate" ? "immediate" : "future",
              futureEffectiveDate: d.effectiveDate && d.effectiveDate !== "immediate" ? d.effectiveDate : "",
            }));
            if (Array.isArray(d.directors) && d.directors.length) setDirectors(d.directors);
          }
          return;
        }

        const addr = combinedAddress(res.client);
        const formationDate = res.client.date_of_formation ? String(res.client.date_of_formation).slice(0, 10) : "";
        setF2553((f) => ({
          ...f, corporationName: res.client.client_name, corporationAddress: addr, ein: res.client.ein || "",
          stateIncorporated: res.client.state || "", officerName: res.client.company_contact_name || "",
          officerTitle: res.client.company_contact_title || "",
          // Prefilled from the client's own formation date on file — the
          // exact value this field needs, previously always left blank for
          // manual re-entry even though it already existed on the profile.
          dateIncorporated: formationDate,
        }));
        setW9((f) => ({
          ...f, name: res.client.client_name, address: res.client.street_address || "",
          city: res.client.city || "", state: res.client.state || "MD", zip: res.client.zip_code || "",
          ein: res.client.ein || "", ssn: res.client.individual_ssn || "",
        }));
        const mappedSs4EntityType = res.client.entity_type ? SS4_ENTITY_TYPE_MAP[res.client.entity_type] : undefined;
        setSs4((f) => ({
          ...f, legalName: res.client.client_name, mailingAddress: addr, county: "", state: res.client.state || "MD",
          responsiblePartyName: res.client.company_contact_name || "", responsiblePartyId: res.client.company_contact_ssn || "",
          applicantName: res.client.company_contact_name || "", applicantTitle: res.client.company_contact_title || "",
          dateBusinessStarted: formationDate,
          tradeName: res.client.dba_name || "",
          ...(mappedSs4EntityType ? { entityType: mappedSs4EntityType, isLlc: mappedSs4EntityType === "LLC" } : {}),
        }));
        const officer = splitName(res.client.company_contact_name);
        setCra((f) => ({
          ...f,
          fein: res.client.ein || "", ssn: res.client.individual_ssn || "",
          // Prefilled from the client's own Secretary of State ID (SDAT) on
          // file — still editable, since the number on this specific filing
          // can occasionally differ (a fresh registration, a correction).
          datEntityId: res.client.secretary_of_state_id || "",
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
          // The officer/responsible-party's own address, not the business
          // address — these are genuinely different people/places on most
          // filings. Falls back to the business address only when the
          // contact's own address isn't on file.
          officerStreet: res.client.company_contact_street_address || res.client.street_address || "",
          officerCity: res.client.company_contact_city || res.client.city || "",
          officerState: res.client.company_contact_state || res.client.state || "MD",
          officerZip: res.client.company_contact_zip_code || res.client.zip_code || "",
          officerPhone: res.client.company_contact_phone || res.client.phone || "",
          // Business activity prefilled from the client's own on-file
          // industry description — still just a starting point, staff can
          // refine the wording for this specific filing.
          businessActivity: res.client.industry_category || "",
          // A client already running payroll almost certainly needs the
          // Employer Withholding tax account registered — pre-checked, but
          // every other tax type stays unchecked for staff to add.
          taxTypes: res.client.payroll_enabled ? ["Employer withholding tax"] : [],
          // A CRA number already on the client profile means Maryland has
          // already assigned one — default to "update" so staff don't
          // accidentally file this as a brand-new registration.
          existingCraNumber: res.client.cra_registration_number || "",
          registrationAction: res.client.cra_registration_number ? "update" : "new",
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
        setMdAmendLlc((f) => ({ ...f, llcName: res.client.client_name }));
        // "Return address of filing party" (6) is this firm's own address, not
        // the client's — SDAT mails the stamped/approved copy back to whoever
        // filed it, which is this firm when we're preparing the amendment.
        setMdAmendCorp((f) => ({
          ...f, corpName: res.client.client_name,
          returnAddressLine1: firm.firmName || "",
          returnAddressLine2: firm.street || "",
          returnAddressLine3: [firm.city, [firm.state, firm.zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
        }));
        setMdDissolution((f) => ({
          ...f, corpName: res.client.client_name,
          sdatId: res.client.secretary_of_state_id || "",
          principalOfficeAddress: addr,
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
    if (formType === "8832") {
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
    if (formType === "MD_AMEND_LLC") {
      if (!mdAmendLlc.llcName.trim()) { setSaveError("LLC name is required."); return null; }
      if (!mdAmendLlc.amendmentText.trim()) { setSaveError("The amendment text is required."); return null; }
      return { ...mdAmendLlc };
    }
    if (formType === "MD_AMEND_CORP") {
      if (!mdAmendCorp.corpTypeBefore) { setSaveError("Corporation type is required."); return null; }
      if (!mdAmendCorp.corpName.trim()) { setSaveError("Corporation name is required."); return null; }
      if (!mdAmendCorp.amendmentText.trim()) { setSaveError("The amendment text is required."); return null; }
      if (!mdAmendCorp.approvalMethod) { setSaveError("Select how this amendment was approved."); return null; }
      return { ...mdAmendCorp };
    }
    // MD_DISSOLUTION
    if (!mdDissolution.corpName.trim()) { setSaveError("Corporation name is required."); return null; }
    if (!mdDissolution.principalOfficeAddress.trim()) { setSaveError("Principal office address is required."); return null; }
    if (!mdDissolution.residentAgentName.trim() || !mdDissolution.residentAgentAddress.trim()) {
      setSaveError("Resident agent name and address are required.");
      return null;
    }
    const cleanDirectors = directors.filter((d) => d.name.trim());
    if (!cleanDirectors.length) { setSaveError("Add at least one director or trustee."); return null; }
    if (!mdDissolution.approvalManner) { setSaveError("Select the manner of approval (SEVENTH)."); return null; }
    if (mdDissolution.effectiveDateType === "future" && !mdDissolution.futureEffectiveDate.trim()) {
      setSaveError("Enter the future effective date (NINTH), or switch back to immediate.");
      return null;
    }
    const officers: Record<string, { name: string; address: string }> = {};
    if (mdDissolution.presidentName.trim()) officers.president = { name: mdDissolution.presidentName, address: mdDissolution.presidentAddress };
    if (mdDissolution.treasurerName.trim()) officers.treasurer = { name: mdDissolution.treasurerName, address: mdDissolution.treasurerAddress };
    if (mdDissolution.secretaryName.trim()) officers.secretary = { name: mdDissolution.secretaryName, address: mdDissolution.secretaryAddress };
    if (mdDissolution.otherOfficerName.trim()) officers.other = { name: mdDissolution.otherOfficerName, address: mdDissolution.otherOfficerAddress };
    return {
      ...mdDissolution,
      directors: cleanDirectors,
      officers,
      effectiveDate: mdDissolution.effectiveDateType === "immediate" ? "immediate" : mdDissolution.futureEffectiveDate,
    };
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
      }
      clearDraft();
      // Best-effort, separate request — a failure here shouldn't undo the CRA
      // filing that already succeeded; the checkbox is a convenience, not a
      // transaction. Staff can always create the POA by hand from the POA
      // Filings section if this second call fails. Available on edit too —
      // there's no stored link between a CRA filing and any POA it
      // generated, so this is the only way to generate a replacement after
      // the original was deleted (or wasn't requested the first time).
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
      onDone();
      onClose();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : `Could not ${isEditing ? "save" : "create"} this filing.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="generate-gov-form-title" style={{ maxWidth: 680, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="generate-gov-form-title">{isEditing ? "Edit Draft Filing" : "Generate Government Form"}</h2>
          <button className="btn btn-sm" onClick={handleClose}>Close</button>
        </div>

        {loadError && <ErrorBanner error={loadError} />}
        {!meta || !identity || !firmProfile ? (
          <p className="muted">Loading…</p>
        ) : (
          <div>
            {pendingDraft && (
              <DraftRestoreBanner updatedAt={pendingDraft.updatedAt} onRestore={restoreDraft} onDiscard={() => { clearDraft(); dismissPendingDraft(); }} />
            )}
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
                    <input id="gf-ss4-responsible-party-id" autoComplete="off" data-no-suggest value={ss4.responsiblePartyId} onChange={(e) => setSs4({ ...ss4, responsiblePartyId: e.target.value })} />
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
                        <input placeholder="SSN or EIN" autoComplete="off" data-no-suggest value={s.idNumber} onChange={(e) => patchShareholder(i, { idNumber: e.target.value })} />
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
                    <input id="gf-w9-ssn" autoComplete="off" data-no-suggest value={w9.ssn} onChange={(e) => setW9({ ...w9, ssn: e.target.value })} placeholder="XXX-XX-XXXX" />
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

                <div className="field" style={{ margin: "0 0 14px" }}>
                  <label>Registration type</label>
                  <div style={{ display: "flex", gap: 16, fontSize: 13, alignItems: "center" }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="radio" name="gf-cra-reg-action" checked={cra.registrationAction === "new"} onChange={() => setCra({ ...cra, registrationAction: "new" })} />
                      New registration
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="radio" name="gf-cra-reg-action" checked={cra.registrationAction === "update"} onChange={() => setCra({ ...cra, registrationAction: "update" })} />
                      Update existing registration
                    </label>
                  </div>
                  {cra.registrationAction === "update" && (
                    <div className="field" style={{ margin: "8px 0 0" }}>
                      <label htmlFor="gf-cra-existing-number">Existing Maryland Central Registration Number</label>
                      <input
                        id="gf-cra-existing-number"
                        value={cra.existingCraNumber}
                        onChange={(e) => setCra({ ...cra, existingCraNumber: e.target.value })}
                        placeholder="Not yet on file — enter it here if you have it"
                      />
                      <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                        The real CRA form is a new-registration document and has no field for this — it's tracked here for
                        our own records only. Once Maryland responds with a number, save it to the client's profile from
                        the filing's status once this is Submitted.
                      </p>
                    </div>
                  )}
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, margin: "0 0 14px", padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
                  <input
                    type="checkbox"
                    checked={craGeneratePoa}
                    onChange={(e) => {
                      setCraGeneratePoa(e.target.checked);
                      if (e.target.checked) setCra((f) => ({ ...f, poaAttached: true }));
                    }}
                  />
                  {isEditing
                    ? `Also generate a new Maryland Form 548 (Power of Attorney), authorizing ${firmProfile.firmName} to handle this registration — creates a fresh Draft filing in the POA Filings section. Use this if the original POA was deleted or wasn't generated the first time; checking this again does not affect any POA already on file.`
                    : `Also generate a Maryland Form 548 (Power of Attorney), authorizing ${firmProfile.firmName} to handle this registration with the Comptroller — creates a second Draft filing alongside this one, in the POA Filings section.`}
                </label>
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
                    <input id="gf-cra-ssn" autoComplete="off" data-no-suggest value={cra.ssn} onChange={(e) => setCra({ ...cra, ssn: e.target.value })} />
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
                    <input aria-label="Officer SSN" placeholder="SSN" autoComplete="off" data-no-suggest value={cra.officerSsn} onChange={(e) => setCra({ ...cra, officerSsn: e.target.value })} />
                    <input aria-label="Officer telephone" placeholder="Telephone" value={cra.officerPhone} onChange={(e) => setCra({ ...cra, officerPhone: e.target.value })} />
                  </div>
                </div>
                {/* This is the responsible party's OWN home address (form Section B), not the
                    business address above — pre-filled from the business address as a starting
                    point only, since the two are frequently different and the form previously
                    had no way to view or correct it. */}
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="gf-cra-officer-street">Officer's home address</label>
                  <input id="gf-cra-officer-street" placeholder="Street address" value={cra.officerStreet} onChange={(e) => setCra({ ...cra, officerStreet: e.target.value })} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
                  <div className="field" style={{ margin: 0 }}><label htmlFor="gf-cra-officer-city">City</label><input id="gf-cra-officer-city" value={cra.officerCity} onChange={(e) => setCra({ ...cra, officerCity: e.target.value })} /></div>
                  <div className="field" style={{ margin: 0 }}><label htmlFor="gf-cra-officer-state">State</label><input id="gf-cra-officer-state" value={cra.officerState} onChange={(e) => setCra({ ...cra, officerState: e.target.value })} /></div>
                  <div className="field" style={{ margin: 0 }}><label htmlFor="gf-cra-officer-zip">ZIP</label><input id="gf-cra-officer-zip" value={cra.officerZip} onChange={(e) => setCra({ ...cra, officerZip: e.target.value })} /></div>
                </div>

                <div className="field" style={{ marginTop: 6 }}>
                  <label htmlFor="gf-cra-mailing-street1">Mailing address <span className="muted">(only if different from the physical location above — otherwise leave blank)</span></label>
                  <input id="gf-cra-mailing-street1" placeholder="Street address — Line 1" value={cra.mailingStreet1} onChange={(e) => setCra({ ...cra, mailingStreet1: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <input aria-label="Mailing address — Line 2 (optional)" placeholder="Street address — Line 2 (optional)" value={cra.mailingStreet2} onChange={(e) => setCra({ ...cra, mailingStreet2: e.target.value })} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
                  <div className="field" style={{ margin: 0 }}><label htmlFor="gf-cra-mailing-city">City</label><input id="gf-cra-mailing-city" value={cra.mailingCity} onChange={(e) => setCra({ ...cra, mailingCity: e.target.value })} /></div>
                  <div className="field" style={{ margin: 0 }}><label htmlFor="gf-cra-mailing-state">State</label><input id="gf-cra-mailing-state" value={cra.mailingState} onChange={(e) => setCra({ ...cra, mailingState: e.target.value })} /></div>
                  <div className="field" style={{ margin: 0 }}><label htmlFor="gf-cra-mailing-zip">ZIP</label><input id="gf-cra-mailing-zip" value={cra.mailingZip} onChange={(e) => setCra({ ...cra, mailingZip: e.target.value })} /></div>
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
                    <input id="gf-8822b-new-rp-id" autoComplete="off" data-no-suggest value={f8822b.newResponsiblePartyId} onChange={(e) => setF8822b({ ...f8822b, newResponsiblePartyId: e.target.value })} />
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

            {formType === "MD_AMEND_LLC" && (
              <div>
                <p className="muted" style={{ fontSize: 12 }}>
                  Maryland SDAT's Articles of Amendment for a Limited Liability Company — must be approved by unanimous
                  consent of the members. Both signature lines are physical-signature-only and are not filled in by this app.
                </p>
                <div className="field">
                  <label htmlFor="gf-mdallc-name">Full name of the LLC</label>
                  <input id="gf-mdallc-name" value={mdAmendLlc.llcName} onChange={(e) => setMdAmendLlc({ ...mdAmendLlc, llcName: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="gf-mdallc-text">The Charter of the LLC is hereby amended as follows</label>
                  <textarea id="gf-mdallc-text" rows={5} value={mdAmendLlc.amendmentText} onChange={(e) => setMdAmendLlc({ ...mdAmendLlc, amendmentText: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="gf-mdallc-new-agent">New resident agent's name <span className="muted">(only if this amendment appoints a NEW resident agent — leave blank if the current one continues to serve)</span></label>
                  <input id="gf-mdallc-new-agent" value={mdAmendLlc.newResidentAgentName} onChange={(e) => setMdAmendLlc({ ...mdAmendLlc, newResidentAgentName: e.target.value })} />
                  {mdAmendLlc.newResidentAgentName.trim() && (
                    <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                      A physical signature is required on the "Signature required only for new resident agents" line before
                      filing — this app records the name for context only, it can't fill that line in.
                    </p>
                  )}
                </div>
              </div>
            )}

            {formType === "MD_AMEND_CORP" && (
              <div>
                <p className="muted" style={{ fontSize: 12 }}>
                  Maryland SDAT's Articles of Amendment for a Corporation. Two different officers must sign (Attested by /
                  Signed by) unless this is a close or professional services corporation — both lines are
                  physical-signature-only and are not filled in by this app.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-mdacorp-type">Corporation type <span className="muted">(prior to this amendment)</span></label>
                    <select id="gf-mdacorp-type" value={mdAmendCorp.corpTypeBefore} onChange={(e) => setMdAmendCorp({ ...mdAmendCorp, corpTypeBefore: e.target.value })}>
                      <option value="">Select…</option>
                      {meta.mdAmendCorpTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-mdacorp-name">Exact name of the corporation <span className="muted">(as on file with SDAT)</span></label>
                    <input id="gf-mdacorp-name" value={mdAmendCorp.corpName} onChange={(e) => setMdAmendCorp({ ...mdAmendCorp, corpName: e.target.value })} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="gf-mdacorp-text">The charter of the corporation shall be and hereby is amended as follows</label>
                  <textarea id="gf-mdacorp-text" rows={5} value={mdAmendCorp.amendmentText} onChange={(e) => setMdAmendCorp({ ...mdAmendCorp, amendmentText: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="gf-mdacorp-approval">This amendment has been approved by</label>
                  <select id="gf-mdacorp-approval" value={mdAmendCorp.approvalMethod} onChange={(e) => setMdAmendCorp({ ...mdAmendCorp, approvalMethod: e.target.value })}>
                    <option value="">Select…</option>
                    {meta.mdAmendCorpApprovalMethods.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-mdacorp-attested-name">Attested to by <span className="muted">(name — informational only, wet-signed by hand)</span></label>
                    <input id="gf-mdacorp-attested-name" value={mdAmendCorp.attestedByName} onChange={(e) => setMdAmendCorp({ ...mdAmendCorp, attestedByName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-mdacorp-attested-title">Title</label>
                    <input id="gf-mdacorp-attested-title" value={mdAmendCorp.attestedByTitle} onChange={(e) => setMdAmendCorp({ ...mdAmendCorp, attestedByTitle: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-mdacorp-signed-name">Signed by <span className="muted">(different person unless close/professional corp)</span></label>
                    <input id="gf-mdacorp-signed-name" value={mdAmendCorp.signedByName} onChange={(e) => setMdAmendCorp({ ...mdAmendCorp, signedByName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-mdacorp-signed-title">Title</label>
                    <input id="gf-mdacorp-signed-title" value={mdAmendCorp.signedByTitle} onChange={(e) => setMdAmendCorp({ ...mdAmendCorp, signedByTitle: e.target.value })} />
                  </div>
                </div>
                <div className="field" style={{ marginTop: 6 }}>
                  <label htmlFor="gf-mdacorp-return1">Return address of filing party</label>
                  <input id="gf-mdacorp-return1" placeholder="Line 1" value={mdAmendCorp.returnAddressLine1} onChange={(e) => setMdAmendCorp({ ...mdAmendCorp, returnAddressLine1: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <input aria-label="Return address — Line 2" placeholder="Line 2" value={mdAmendCorp.returnAddressLine2} onChange={(e) => setMdAmendCorp({ ...mdAmendCorp, returnAddressLine2: e.target.value })} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <input aria-label="Return address — Line 3" placeholder="Line 3" value={mdAmendCorp.returnAddressLine3} onChange={(e) => setMdAmendCorp({ ...mdAmendCorp, returnAddressLine3: e.target.value })} />
                </div>
              </div>
            )}

            {formType === "MD_DISSOLUTION" && (
              <div>
                <p className="muted" style={{ fontSize: 12 }}>
                  Maryland SDAT's Articles of Dissolution — ends the existence of a Maryland domestic corporation. Both
                  certification signature blocks and the resident agent's consent are physical-signature-only and are not
                  filled in by this app.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-mddis-name">FIRST — Full name of the corporation <span className="muted">(as listed in SDAT's record)</span></label>
                    <input id="gf-mddis-name" value={mdDissolution.corpName} onChange={(e) => setMdDissolution({ ...mdDissolution, corpName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-mddis-sdat-id">SDAT ID <span className="muted">(if available)</span></label>
                    <input id="gf-mddis-sdat-id" value={mdDissolution.sdatId} onChange={(e) => setMdDissolution({ ...mdDissolution, sdatId: e.target.value })} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="gf-mddis-principal-office">SECOND — Principal office address <span className="muted">(including city, state &amp; zip code)</span></label>
                  <input id="gf-mddis-principal-office" value={mdDissolution.principalOfficeAddress} onChange={(e) => setMdDissolution({ ...mdDissolution, principalOfficeAddress: e.target.value })} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-mddis-agent-name">THIRD — Resident agent's full name <span className="muted">(serving 1 year after dissolution)</span></label>
                    <input id="gf-mddis-agent-name" value={mdDissolution.residentAgentName} onChange={(e) => setMdDissolution({ ...mdDissolution, residentAgentName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-mddis-agent-address">FOURTH — Resident agent's Maryland address</label>
                    <input id="gf-mddis-agent-address" value={mdDissolution.residentAgentAddress} onChange={(e) => setMdDissolution({ ...mdDissolution, residentAgentAddress: e.target.value })} />
                  </div>
                </div>

                <div className="field" style={{ marginTop: 12 }}>
                  <label>FIFTH — Directors or trustees <span className="muted">(up to 4; at least 1 required — 4 required if a religious corporation)</span></label>
                  {directors.map((d, i) => (
                    <div key={i} className="card" style={{ marginBottom: 8, padding: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <strong style={{ fontSize: 12.5 }}>Director/Trustee {i + 1}</strong>
                        {directors.length > 1 && (
                          <button type="button" className="link-button" style={{ color: "var(--red)" }}
                            onClick={() => setDirectors((prev) => prev.filter((_, j) => j !== i))}>Remove</button>
                        )}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <input placeholder="Name" value={d.name} onChange={(e) => patchDirector(i, { name: e.target.value })} />
                        <input placeholder="Address (including city, state & zip)" value={d.address} onChange={(e) => patchDirector(i, { address: e.target.value })} />
                      </div>
                    </div>
                  ))}
                  {directors.length < 4 && <button type="button" className="btn btn-sm" onClick={addDirector}>+ Add Director/Trustee</button>}
                </div>

                <div className="field" style={{ marginTop: 12 }}>
                  <label>SIXTH — Officers <span className="muted">(President, Treasurer, and Secretary requested to avoid rejection, even if the same person holds more than one role)</span></label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <input placeholder="President — Name" value={mdDissolution.presidentName} onChange={(e) => setMdDissolution({ ...mdDissolution, presidentName: e.target.value })} />
                    <input placeholder="President — Address" value={mdDissolution.presidentAddress} onChange={(e) => setMdDissolution({ ...mdDissolution, presidentAddress: e.target.value })} />
                    <input placeholder="Treasurer — Name" value={mdDissolution.treasurerName} onChange={(e) => setMdDissolution({ ...mdDissolution, treasurerName: e.target.value })} />
                    <input placeholder="Treasurer — Address" value={mdDissolution.treasurerAddress} onChange={(e) => setMdDissolution({ ...mdDissolution, treasurerAddress: e.target.value })} />
                    <input placeholder="Secretary — Name" value={mdDissolution.secretaryName} onChange={(e) => setMdDissolution({ ...mdDissolution, secretaryName: e.target.value })} />
                    <input placeholder="Secretary — Address" value={mdDissolution.secretaryAddress} onChange={(e) => setMdDissolution({ ...mdDissolution, secretaryAddress: e.target.value })} />
                    <input placeholder="Other Officer — Name (optional)" value={mdDissolution.otherOfficerName} onChange={(e) => setMdDissolution({ ...mdDissolution, otherOfficerName: e.target.value })} />
                    <input placeholder="Other Officer — Address" value={mdDissolution.otherOfficerAddress} onChange={(e) => setMdDissolution({ ...mdDissolution, otherOfficerAddress: e.target.value })} />
                  </div>
                </div>

                <div className="field" style={{ marginTop: 12 }}>
                  <label htmlFor="gf-mddis-approval-manner">SEVENTH — Manner of approval <span className="muted">(check one)</span></label>
                  <select id="gf-mddis-approval-manner" value={mdDissolution.approvalManner} onChange={(e) => setMdDissolution({ ...mdDissolution, approvalManner: e.target.value })}>
                    <option value="">Select…</option>
                    {meta.mdDissolutionApprovalManners.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  {mdDissolution.approvalManner === meta.mdDissolutionApprovalManners[meta.mdDissolutionApprovalManners.length - 1] && (
                    <input aria-label="Other manner not specified above — describe" placeholder="Describe the other manner of approval" style={{ marginTop: 6 }}
                      value={mdDissolution.otherMannerText} onChange={(e) => setMdDissolution({ ...mdDissolution, otherMannerText: e.target.value })} />
                  )}
                </div>

                <div className="field" style={{ marginTop: 6 }}>
                  <label>EIGHTH — Creditor notice <span className="muted">(check one)</span></label>
                  <div style={{ display: "flex", gap: 16, fontSize: 13, alignItems: "center" }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="radio" name="gf-mddis-creditor" checked={mdDissolution.creditorNotice === "Mailed to known creditors"} onChange={() => setMdDissolution({ ...mdDissolution, creditorNotice: "Mailed to known creditors" })} />
                      Notice mailed to all known creditors
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="radio" name="gf-mddis-creditor" checked={mdDissolution.creditorNotice === "No known creditors"} onChange={() => setMdDissolution({ ...mdDissolution, creditorNotice: "No known creditors" })} />
                      No known creditors
                    </label>
                  </div>
                  {mdDissolution.creditorNotice === "Mailed to known creditors" && (
                    <input type="date" style={{ marginTop: 6, maxWidth: 200 }} aria-label="Date notice was mailed" value={mdDissolution.creditorNoticeMailedDate} onChange={(e) => setMdDissolution({ ...mdDissolution, creditorNoticeMailedDate: e.target.value })} />
                  )}
                </div>

                <div className="field" style={{ marginTop: 6 }}>
                  <label>NINTH — Effective date</label>
                  <div style={{ display: "flex", gap: 16, fontSize: 13, alignItems: "center" }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="radio" name="gf-mddis-effective" checked={mdDissolution.effectiveDateType === "immediate"} onChange={() => setMdDissolution({ ...mdDissolution, effectiveDateType: "immediate" })} />
                      Effective upon the filing date <span className="muted">(the form's own default)</span>
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="radio" name="gf-mddis-effective" checked={mdDissolution.effectiveDateType === "future"} onChange={() => setMdDissolution({ ...mdDissolution, effectiveDateType: "future" })} />
                      A future date <span className="muted">(≤30 days after filing)</span>
                    </label>
                  </div>
                  {mdDissolution.effectiveDateType === "future" && (
                    <input type="date" style={{ marginTop: 6, maxWidth: 200 }} aria-label="Future effective date" value={mdDissolution.futureEffectiveDate} onChange={(e) => setMdDissolution({ ...mdDissolution, futureEffectiveDate: e.target.value })} />
                  )}
                </div>

                <div className="field">
                  <label htmlFor="gf-mddis-tenth">TENTH — Additional provisions <span className="muted">(optional)</span></label>
                  <input id="gf-mddis-tenth" value={mdDissolution.additionalProvisions} onChange={(e) => setMdDissolution({ ...mdDissolution, additionalProvisions: e.target.value })} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-mddis-attested-name">Attested by <span className="muted">(name — informational only, wet-signed by hand)</span></label>
                    <input id="gf-mddis-attested-name" value={mdDissolution.attestedByName} onChange={(e) => setMdDissolution({ ...mdDissolution, attestedByName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-mddis-attested-title">Title</label>
                    <input id="gf-mddis-attested-title" value={mdDissolution.attestedByTitle} onChange={(e) => setMdDissolution({ ...mdDissolution, attestedByTitle: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-mddis-signed-name">Signed by <span className="muted">(different person unless close/professional corp)</span></label>
                    <input id="gf-mddis-signed-name" value={mdDissolution.signedByName} onChange={(e) => setMdDissolution({ ...mdDissolution, signedByName: e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="gf-mddis-signed-title">Title</label>
                    <input id="gf-mddis-signed-title" value={mdDissolution.signedByTitle} onChange={(e) => setMdDissolution({ ...mdDissolution, signedByTitle: e.target.value })} />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="gf-mddis-agent-consent">Resident agent's consent — full name &amp; title of person signing <span className="muted">(only if the resident agent is itself an MD LLC or corporation, not an individual)</span></label>
                  <input id="gf-mddis-agent-consent" value={mdDissolution.residentAgentConsentSignerName} onChange={(e) => setMdDissolution({ ...mdDissolution, residentAgentConsentSignerName: e.target.value })} />
                </div>
              </div>
            )}

            <p className="muted" style={{ fontSize: 12, margin: "14px 0 10px" }}>
              This form must be signed by hand — Preview, print, and get a wet signature; the app tracks when it's signed and how it was actually sent.
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn" onClick={handleClose}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSubmit}>{saving ? "Generating…" : "Generate"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
