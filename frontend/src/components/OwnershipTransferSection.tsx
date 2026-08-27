import { useEffect, useState } from "react";
import { api, ApiError, downloadFile, viewFile, printFile, buildFilename } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "./Toast";
import { useConfirm, useNotify } from "./ConfirmProvider";
import { fmtDateOnly, fmtDateTime } from "../utils/date";
import { US_STATES, ASSET_ALLOCATION_CATEGORIES } from "../utils/clientOptions";
import { StepProgress, type StepProgressStep } from "./StepProgress";
import type { GovFormFiling } from "../api/govForms";

interface AssetAllocationLine {
  category: string;
  description: string | null;
  amount: number;
}

interface OwnershipTransfer {
  transfer_id: string;
  seller_name: string;
  seller_title: string | null;
  buyer_name: string;
  buyer_title: string | null;
  buyer_ssn: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  buyer_street_address: string | null;
  buyer_city: string | null;
  buyer_state: string | null;
  buyer_zip_code: string | null;
  effective_date: string | null;
  sale_price: number | null;
  assets_included: string | null;
  asset_allocations: AssetAllocationLine[] | null;
  liabilities_included: string | null;
  additional_terms: string | null;
  include_bill_of_sale: boolean;
  gov_form_8822b_filing_id: string | null;
  gov_form_cra_filing_id: string | null;
  gov_form_amendment_filing_id: string | null;
  gov_form_dissolution_filing_id: string | null;
  md_amendment_task_id: string | null;
  created_by: string | null;
  created_at: string;
  /** Set once "Apply New Owner to Client Profile" has been run for this transfer — see POST .../apply-new-owner. Null until then. */
  applied_to_profile_at: string | null;
  applied_by: string | null;
}

/** Row shape while being edited in the form — amount stays a string so the input can be empty mid-typing, parsed to a number only on submit. */
interface AllocationRow {
  category: string;
  description: string;
  amount: string;
}

/** MD Articles of Dissolution's "FIFTH" director/trustee rows — same single-address-line shape as the real PDF's own fields (see mdDissolution.ts), up to 4 rows. */
interface DirectorOrTrustee { name: string; address: string }
const EMPTY_DIRECTOR: DirectorOrTrustee = { name: "", address: "" };

/** Widened identity fields this wizard reads for read-only display (Step 1) and smart defaults (Step 3) — same GET /gov-forms/client/:id/identity endpoint GenerateGovFormModal.tsx already uses, widened in Phase 1 of this same overhaul. */
interface ClientIdentityLite {
  client_id: string;
  entity_type: string | null;
  dba_name: string | null;
  street_address: string | null; city: string | null; state: string | null; zip_code: string | null;
  secretary_of_state_id: string | null;
  cra_registration_number: string | null;
}

interface FirmProfileLite { firmName: string; street: string; city: string; state: string; zipCode: string; phone: string; email: string }

interface WizardMeta {
  mdAmendCorpTypes: string[];
  mdAmendCorpApprovalMethods: string[];
  mdDissolutionApprovalManners: string[];
}

/** Which real MD Articles of Amendment generator applies to a client's entity_type — mirrors ENTITY_TYPE_TO_AMENDMENT_KIND in ownershipTransfer.routes.ts exactly, so Step 3's UI never promises a document the backend can't actually produce. */
const ENTITY_TYPE_TO_AMENDMENT_KIND: Record<string, "LLC" | "CORP"> = {
  LLC: "LLC", "C-Corp": "CORP", "S-Corp": "CORP", Nonprofit: "CORP",
};

const WIZARD_STEPS: StepProgressStep[] = [
  { n: 1, label: "Transaction Basics", desc: "Seller, buyer, sale terms" },
  { n: 2, label: "Asset Allocation", desc: "Itemize the purchase price" },
  { n: 3, label: "What Needs Filing?", desc: "Pick documents, fill gaps" },
  { n: 4, label: "Generate & Review", desc: "Create everything at once" },
];

const EMPTY_FORM = {
  sellerName: "", sellerTitle: "",
  buyerName: "", buyerTitle: "", buyerSsn: "", buyerEmail: "", buyerPhone: "",
  buyerStreetAddress: "", buyerCity: "", buyerState: "", buyerZipCode: "",
  effectiveDate: "", salePrice: "",
  assetsIncluded: "", liabilitiesIncluded: "", additionalTerms: "",
  includeBillOfSale: true, include8822b: true, includeCra: true,
  includeAmendment: true, isDissolving: false, includeDissolution: false,
  assetAllocations: [] as AllocationRow[],
};

const EMPTY_AMENDMENT = {
  amendmentText: "", corpTypeBefore: "Stock", approvalMethod: "", newResidentAgentName: "",
  returnAddressLine1: "", returnAddressLine2: "", returnAddressLine3: "",
  attestedByName: "", attestedByTitle: "", signedByName: "", signedByTitle: "",
};

const EMPTY_DISSOLUTION = {
  sdatId: "", saveSdatIdToProfile: false,
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
};

function allocationTotal(rows: AllocationRow[]): number {
  return Math.round(rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0) * 100) / 100;
}
function fmtMoney(v: number): string {
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function combinedClientAddress(identity: ClientIdentityLite | null): string {
  if (!identity) return "";
  return [identity.street_address, [identity.city, identity.state, identity.zip_code].filter(Boolean).join(", ")]
    .filter(Boolean).join(", ");
}
function maskCraNumber(v: string): string {
  const digits = v.replace(/\D/g, "");
  return digits.length >= 4 ? `•••${digits.slice(-4)}` : v;
}

/**
 * "Ownership Transfer" package — a step-by-step wizard that walks staff
 * through capturing a business sale (old owner -> new owner, effective
 * date, sale terms, asset allocation), choosing which documents this
 * specific transfer needs, filling in whatever those documents need that
 * isn't already on the client profile, and generating everything in one
 * shot: a Bill of Sale, a pre-filled Form 8822-B, a Maryland CRA update
 * (existing-number-aware — updates instead of re-registering when a CRA
 * number is already on file), a real MD Articles of Amendment (Corp or
 * LLC, auto-picked from the client's entity type), and — only when staff
 * flag the old entity as closing rather than amending — a real MD Articles
 * of Dissolution. The 8822-B/CRA/Amendment/Dissolution drafts intentionally
 * show up in the Government Forms section above, not here (Step 4 deep-
 * links into it) — this component only owns the transfer intake and the
 * Bill of Sale, since the other four already have a home.
 */
export function OwnershipTransferSection({ clientId, clientName, sellerNameDefault, sellerTitleDefault, onFilingsGenerated, onClientUpdated }: {
  clientId: string; clientName: string; sellerNameDefault?: string; sellerTitleDefault?: string;
  /** Called with every filing_id a successful "Generate All" created (8822-B/CRA/Amendment/Dissolution) so the page can scroll to and highlight them in the Government Forms section above — see ClientDetailPage.tsx's wiring of this alongside GovFormsSection's own highlightFilingIds/reloadKey props. */
  onFilingsGenerated?: (filingIds: string[]) => void;
  /** Called after a successful "Apply New Owner to Client Profile" so the parent page's own client record (company_contact_name/email/etc., shown elsewhere on this page) reloads and reflects the new owner without a manual refresh. */
  onClientUpdated?: () => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const toast = useToast();
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const [transfers, setTransfers] = useState<OwnershipTransfer[] | null>(null);
  const [identity, setIdentity] = useState<ClientIdentityLite | null>(null);
  const [meta, setMeta] = useState<WizardMeta | null>(null);
  const [firmProfile, setFirmProfile] = useState<FirmProfileLite | null>(null);
  /** This client's government-form filings (status only matters here) — used to gate "Apply New Owner to Client Profile" on every non-null linked filing being Submitted. Loaded independently of GovFormsSection above (which owns its own fetch/highlight state) so this gate stays correct even before that section has rendered/loaded. */
  const [filings, setFilings] = useState<GovFormFiling[] | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const [showWizard, setShowWizard] = useState(false);
  const [step, setStep] = useState(1);
  const [maxStepReached, setMaxStepReached] = useState(1);
  const [form, setForm] = useState(EMPTY_FORM);
  const [amendment, setAmendment] = useState(EMPTY_AMENDMENT);
  const [dissolution, setDissolution] = useState(EMPTY_DISSOLUTION);
  const [directors, setDirectors] = useState<DirectorOrTrustee[]>([{ ...EMPTY_DIRECTOR }]);
  const [stepError, setStepError] = useState<string | null>(null);

  const [editingTransfer, setEditingTransfer] = useState<OwnershipTransfer | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    transferId: string; created: Record<string, boolean>; skippedReasons: string[]; createdFilingIds: string[];
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    api.get<{ transfers: OwnershipTransfer[] }>(`/clients/${clientId}/ownership-transfers`)
      .then((res) => setTransfers(res.transfers))
      .catch(() => setTransfers([]));
  }
  useEffect(load, [clientId]);

  useEffect(() => {
    api.get<{ client: ClientIdentityLite }>(`/gov-forms/client/${clientId}/identity`).then((res) => setIdentity(res.client)).catch(() => setIdentity(null));
    api.get<WizardMeta>("/gov-forms/meta").then(setMeta).catch(() => setMeta(null));
    api.get<FirmProfileLite>("/firm-settings").then(setFirmProfile).catch(() => setFirmProfile(null));
  }, [clientId]);

  function loadFilings() {
    api.get<{ filings: GovFormFiling[] }>(`/gov-forms/client/${clientId}`).then((res) => setFilings(res.filings)).catch(() => setFilings([]));
  }
  useEffect(loadFilings, [clientId]);
  // GovFormsSection above owns its own separate fetch of this same list and
  // is where staff actually flip a filing to Signed/Submitted (Sign Now /
  // Mark Submitted) — this component has no direct signal when that
  // happens. A light poll keeps the "Apply New Owner" gate from going stale
  // for an entire page reload after staff finish that work elsewhere on the
  // page, without wiring a new cross-component callback through
  // ClientDetailPage just for this.
  useEffect(() => {
    const id = setInterval(loadFilings, 10000);
    return () => clearInterval(id);
  }, [clientId]);

  /**
   * "Apply New Owner to Client Profile" is only ever offered once every
   * NON-NULL linked filing (8822-B/CRA/Amendment/Dissolution) is Submitted.
   * md_amendment_task_id (the old plain-task fallback for entity types with
   * no real MD Amendment generator) is never gov-form-backed, so it's
   * deliberately excluded from this check — see the backend route's own
   * doc comment in ownershipTransfer.routes.ts for the same reasoning.
   * Returns a list of blocking reasons; empty means ready.
   */
  function applyBlockingReasons(t: OwnershipTransfer): string[] {
    if (t.applied_to_profile_at) return [`Already applied on ${fmtDateTime(t.applied_to_profile_at)}.`];
    if (!t.buyer_name?.trim()) return ["No buyer name on file."];
    if (filings === null) return ["Loading filing statuses…"];
    const linked: { label: string; id: string | null }[] = [
      { label: "Form 8822-B", id: t.gov_form_8822b_filing_id },
      { label: "Maryland CRA", id: t.gov_form_cra_filing_id },
      { label: "MD Articles of Amendment", id: t.gov_form_amendment_filing_id },
      { label: "MD Articles of Dissolution", id: t.gov_form_dissolution_filing_id },
    ];
    const reasons: string[] = [];
    for (const f of linked) {
      if (!f.id) continue;
      const filing = filings.find((x) => x.filing_id === f.id);
      if (!filing) reasons.push(`${f.label} filing not found.`);
      else if (filing.status !== "Submitted") reasons.push(`${f.label} is still ${filing.status}.`);
    }
    return reasons;
  }

  async function handleApplyNewOwner(t: OwnershipTransfer) {
    const amendmentWasTaskOnly = !t.gov_form_amendment_filing_id && !!t.md_amendment_task_id;
    // No second-admin approval is required to finalize a transfer (a
    // deliberate call — see ownershipTransfer.routes.ts's comment on this
    // route) — this app is used by a small admin team, and requiring a
    // DIFFERENT admin than whoever created/edited the transfer would be
    // disproportionate friction for the actual insider-risk it defends
    // against, when the full audit trail (who created, edited, and applied,
    // with timestamps) already gives after-the-fact accountability. What
    // this dialog adds instead is making sure whoever clicks Apply sees
    // who set this up, so a self-check happens before an irreversible action.
    const ok = await confirmDialog({
      title: "Apply New Owner to Client Profile",
      message:
        `This transfer was created by ${t.created_by || "an unknown user"}. Applying it will update ${clientName}'s Responsible Party contact info to ${t.buyer_name} (from ${t.buyer_email || "no email on file"}), ` +
        `deactivate the OLD owner's portal login and clear their password/2FA so it can no longer be used, and email a NEW portal invite to the new owner. ` +
        `This cannot be undone from here.` +
        (amendmentWasTaskOnly ? ` Note: the MD Articles of Amendment for this transfer was only tracked as a reminder task, not filed as a real form.` : ""),
      confirmLabel: "Apply New Owner", danger: true,
    });
    if (!ok) return;
    await submitApplyNewOwner(t, false);
  }

  async function submitApplyNewOwner(t: OwnershipTransfer, acknowledgeNoFilings: boolean) {
    setApplyingId(t.transfer_id);
    try {
      const res = await api.post<{
        ok: boolean; portalUserId: string; portalAction: "reprovisioned" | "created";
        inviteEmailed: boolean; inviteEmailError?: string; inviteLink?: string; amendmentWasTaskOnly: boolean;
      }>(`/clients/${clientId}/ownership-transfers/${t.transfer_id}/apply-new-owner`, { acknowledgeNoFilings });
      toast(
        `New owner applied. Portal login ${res.portalAction === "created" ? "created" : "transferred"} for ${t.buyer_name}` +
        (res.inviteEmailed ? " — invite emailed." : res.inviteLink ? " — invite email failed to send; share the invite link manually." : ".")
      );
      load();
      loadFilings();
      onClientUpdated?.();
    } catch (err) {
      // A 400 with requiresAcknowledgeNoFilings means this transfer has no
      // government filings attached at all — not an error to just show and
      // drop, but a real decision the admin needs to make explicitly rather
      // than the app finalizing it silently (Hard Audit finding, 2026-08-27).
      const body = err instanceof ApiError ? (err.body as { requiresAcknowledgeNoFilings?: boolean } | undefined) : undefined;
      if (body?.requiresAcknowledgeNoFilings && !acknowledgeNoFilings) {
        setApplyingId(null);
        const ack = await confirmDialog({
          title: "No Government Filings Attached",
          message:
            `${t.buyer_name}'s ownership transfer has no 8822-B, MD CRA, Amendment, or Dissolution filing attached. ` +
            `Only confirm if this was already filed elsewhere (or genuinely doesn't need any of these filings) — ` +
            `this will be noted on the audit trail.`,
          confirmLabel: "Confirm — Nothing Left to File", danger: true,
        });
        if (ack) await submitApplyNewOwner(t, true);
        return;
      }
      await notify(err instanceof ApiError ? err.message : "Could not apply the new owner.");
    } finally {
      setApplyingId(null);
    }
  }

  const referenceDataLoaded = !!identity && !!meta && !!firmProfile;
  const amendmentKind = identity?.entity_type ? ENTITY_TYPE_TO_AMENDMENT_KIND[identity.entity_type] : undefined;

  function openWizard() {
    setForm({
      ...EMPTY_FORM,
      sellerName: sellerNameDefault || "", sellerTitle: sellerTitleDefault || "",
      // Corp-like/LLC-like entity types get the real Amendment generator
      // pre-checked (same as today's "always on" default); anything else
      // still defaults to checked, since the fallback reminder task is
      // still a useful default action, just explained differently in Step 3.
    });
    setAmendment({
      ...EMPTY_AMENDMENT,
      corpTypeBefore: identity?.entity_type === "Nonprofit" ? "Nonstock" : "Stock",
      returnAddressLine1: firmProfile?.firmName || "",
      returnAddressLine2: firmProfile?.street || "",
      returnAddressLine3: firmProfile ? [firmProfile.city, [firmProfile.state, firmProfile.zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "",
    });
    setDissolution({
      ...EMPTY_DISSOLUTION,
      sdatId: identity?.secretary_of_state_id || "",
      principalOfficeAddress: combinedClientAddress(identity),
    });
    setDirectors([{ ...EMPTY_DIRECTOR }]);
    setStep(1);
    setMaxStepReached(1);
    setStepError(null);
    setSaveError(null);
    setLastResult(null);
    setShowWizard(true);
  }

  function closeWizard() {
    setShowWizard(false);
    setLastResult(null);
  }

  function openEditForm(t: OwnershipTransfer) {
    setEditingTransfer(t);
    setEditForm({
      sellerName: t.seller_name || "", sellerTitle: t.seller_title || "",
      buyerName: t.buyer_name || "", buyerTitle: t.buyer_title || "", buyerSsn: t.buyer_ssn || "",
      buyerEmail: t.buyer_email || "", buyerPhone: t.buyer_phone || "",
      buyerStreetAddress: t.buyer_street_address || "", buyerCity: t.buyer_city || "",
      buyerState: t.buyer_state || "", buyerZipCode: t.buyer_zip_code || "",
      effectiveDate: t.effective_date ? t.effective_date.slice(0, 10) : "", salePrice: t.sale_price !== null ? String(t.sale_price) : "",
      assetsIncluded: t.assets_included || "", liabilitiesIncluded: t.liabilities_included || "", additionalTerms: t.additional_terms || "",
      includeBillOfSale: t.include_bill_of_sale, include8822b: true, includeCra: true,
      includeAmendment: true, isDissolving: false, includeDissolution: false,
      assetAllocations: (t.asset_allocations || []).map((a) => ({ category: a.category, description: a.description || "", amount: String(a.amount) })),
    });
    setSaveError(null);
    setShowWizard(false);
  }

  function addAllocationRow(target: "wizard" | "edit") {
    const row = { category: ASSET_ALLOCATION_CATEGORIES[0], description: "", amount: "" };
    if (target === "wizard") setForm((f) => ({ ...f, assetAllocations: [...f.assetAllocations, row] }));
    else setEditForm((f) => ({ ...f, assetAllocations: [...f.assetAllocations, row] }));
  }
  function updateAllocationRow(target: "wizard" | "edit", index: number, patch: Partial<AllocationRow>) {
    const updater = (f: typeof EMPTY_FORM) => ({ ...f, assetAllocations: f.assetAllocations.map((r, i) => (i === index ? { ...r, ...patch } : r)) });
    if (target === "wizard") setForm(updater);
    else setEditForm(updater);
  }
  function removeAllocationRow(target: "wizard" | "edit", index: number) {
    const updater = (f: typeof EMPTY_FORM) => ({ ...f, assetAllocations: f.assetAllocations.filter((_, i) => i !== index) });
    if (target === "wizard") setForm(updater);
    else setEditForm(updater);
  }

  function addDirectorRow() {
    setDirectors((prev) => (prev.length >= 4 ? prev : [...prev, { ...EMPTY_DIRECTOR }]));
  }
  function patchDirectorRow(i: number, patch: Partial<DirectorOrTrustee>) {
    setDirectors((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  }
  function removeDirectorRow(i: number) {
    setDirectors((prev) => prev.filter((_, j) => j !== i));
  }

  function toggleIsDissolving(next: boolean) {
    setForm((f) => ({ ...f, isDissolving: next, includeDissolution: next, includeAmendment: next ? false : f.includeAmendment }));
  }

  const wizardAllocRows = form.assetAllocations.filter((r) => r.category.trim());
  const wizardAllocTotal = allocationTotal(wizardAllocRows);
  const editAllocRows = editForm.assetAllocations.filter((r) => r.category.trim());
  const editAllocTotal = allocationTotal(editAllocRows);

  function validateStep1(): string | null {
    if (!form.sellerName.trim()) return "Seller name is required.";
    if (!form.buyerName.trim()) return "Buyer name is required.";
    return null;
  }
  function validateStep2(): string | null {
    for (const r of wizardAllocRows) {
      if (!(Number(r.amount) > 0)) return `Enter a positive amount for the "${r.category}" allocation line, or remove it.`;
    }
    return null;
  }
  function validateStep3(): string | null {
    if (form.includeAmendment && amendmentKind) {
      if (!amendment.amendmentText.trim()) return "Describe the Articles of Amendment change (Step 3 — MD Articles of Amendment).";
      if (amendmentKind === "CORP" && !amendment.approvalMethod) return "Select how the amendment was approved (Step 3 — MD Articles of Amendment).";
    }
    if (form.isDissolving && form.includeDissolution) {
      if (!dissolution.principalOfficeAddress.trim()) return "Principal office address is required (Step 3 — MD Articles of Dissolution).";
      if (!dissolution.residentAgentName.trim() || !dissolution.residentAgentAddress.trim()) return "Resident agent name and address are required (Step 3 — MD Articles of Dissolution).";
      if (!directors.some((d) => d.name.trim())) return "Add at least one director or trustee (Step 3 — MD Articles of Dissolution).";
      if (!dissolution.approvalManner) return "Select the manner of approval (Step 3 — MD Articles of Dissolution).";
      if (dissolution.creditorNotice === "Mailed to known creditors" && !dissolution.creditorNoticeMailedDate.trim()) return "Enter the date creditors were notified, or switch to \"No known creditors\" (Step 3 — MD Articles of Dissolution).";
      if (dissolution.effectiveDateType === "future" && !dissolution.futureEffectiveDate.trim()) return "Enter the future effective date, or switch back to immediate (Step 3 — MD Articles of Dissolution).";
    }
    return null;
  }

  function goNext() {
    const err = step === 1 ? validateStep1() : step === 2 ? validateStep2() : step === 3 ? validateStep3() : null;
    if (err) { setStepError(err); return; }
    setStepError(null);
    const next = Math.min(4, step + 1);
    setStep(next);
    setMaxStepReached((m) => Math.max(m, next));
  }
  function goBack() {
    setStepError(null);
    setStep((s) => Math.max(1, s - 1));
  }
  function goToStep(n: number) {
    if (n > maxStepReached) return;
    setStepError(null);
    setStep(n);
  }

  async function handleGenerateAll() {
    const err = validateStep3();
    if (err) { setStepError(err); return; }
    setStepError(null);
    setSaving(true);
    setSaveError(null);
    const cleanDirectors = directors.filter((d) => d.name.trim());
    const officers: Record<string, { name: string; address: string }> = {};
    if (dissolution.presidentName.trim()) officers.president = { name: dissolution.presidentName, address: dissolution.presidentAddress };
    if (dissolution.treasurerName.trim()) officers.treasurer = { name: dissolution.treasurerName, address: dissolution.treasurerAddress };
    if (dissolution.secretaryName.trim()) officers.secretary = { name: dissolution.secretaryName, address: dissolution.secretaryAddress };
    if (dissolution.otherOfficerName.trim()) officers.other = { name: dissolution.otherOfficerName, address: dissolution.otherOfficerAddress };

    const payload = {
      ...form,
      assetAllocations: wizardAllocRows.map((r) => ({ category: r.category, description: r.description || null, amount: Number(r.amount) })),
      amendment: form.includeAmendment && amendmentKind ? {
        amendmentText: amendment.amendmentText,
        corpTypeBefore: amendment.corpTypeBefore,
        approvalMethod: amendment.approvalMethod,
        newResidentAgentName: amendment.newResidentAgentName || undefined,
        returnAddressLine1: amendment.returnAddressLine1 || undefined,
        returnAddressLine2: amendment.returnAddressLine2 || undefined,
        returnAddressLine3: amendment.returnAddressLine3 || undefined,
        attestedByName: amendment.attestedByName || undefined,
        attestedByTitle: amendment.attestedByTitle || undefined,
        signedByName: amendment.signedByName || undefined,
        signedByTitle: amendment.signedByTitle || undefined,
      } : undefined,
      dissolution: form.isDissolving && form.includeDissolution ? {
        sdatId: dissolution.sdatId || undefined,
        saveSdatIdToProfile: dissolution.saveSdatIdToProfile,
        principalOfficeAddress: dissolution.principalOfficeAddress,
        residentAgentName: dissolution.residentAgentName,
        residentAgentAddress: dissolution.residentAgentAddress,
        directors: cleanDirectors,
        officers,
        approvalManner: dissolution.approvalManner,
        otherMannerText: dissolution.otherMannerText || undefined,
        creditorNotice: dissolution.creditorNotice,
        creditorNoticeMailedDate: dissolution.creditorNoticeMailedDate || undefined,
        effectiveDate: dissolution.effectiveDateType === "immediate" ? "immediate" : dissolution.futureEffectiveDate,
        additionalProvisions: dissolution.additionalProvisions || undefined,
        attestedByName: dissolution.attestedByName || undefined,
        attestedByTitle: dissolution.attestedByTitle || undefined,
        signedByName: dissolution.signedByName || undefined,
        signedByTitle: dissolution.signedByTitle || undefined,
        residentAgentConsentSignerName: dissolution.residentAgentConsentSignerName || undefined,
      } : undefined,
    };
    try {
      const res = await api.post<{ transferId: string; created: Record<string, boolean>; skippedReasons: string[]; createdFilingIds: string[] }>(
        `/clients/${clientId}/ownership-transfers`, payload
      );
      setLastResult(res);
      toast("Ownership transfer package created.");
      load();
      loadFilings();
      if (res.createdFilingIds && res.createdFilingIds.length) onFilingsGenerated?.(res.createdFilingIds);
    } catch (err: any) {
      setSaveError(err?.message || "Could not create the transfer package.");
    } finally {
      setSaving(false);
    }
  }

  async function handleEditSubmit() {
    if (!editingTransfer) return;
    if (!editForm.sellerName.trim() || !editForm.buyerName.trim()) {
      setSaveError("Seller name and buyer name are required.");
      return;
    }
    for (const r of editAllocRows) {
      if (!(Number(r.amount) > 0)) {
        setSaveError(`Enter a positive amount for the "${r.category}" allocation line, or remove it.`);
        return;
      }
    }
    setSaving(true);
    setSaveError(null);
    const payload = {
      ...editForm,
      assetAllocations: editAllocRows.map((r) => ({ category: r.category, description: r.description || null, amount: Number(r.amount) })),
    };
    try {
      await api.patch(`/clients/${clientId}/ownership-transfers/${editingTransfer.transfer_id}`, payload);
      toast("Ownership transfer updated.");
      setEditingTransfer(null);
      load();
    } catch (err: any) {
      setSaveError(err?.message || "Could not save the transfer.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(t: OwnershipTransfer) {
    const ok = await confirmDialog({
      title: "Delete ownership transfer",
      message: `Delete the ${t.seller_name} → ${t.buyer_name} transfer? Any linked 8822-B/CRA/Amendment/Dissolution drafts still in Draft (and the MD Amendment task, if not yet started) will be removed too. This can't be undone.`,
      confirmLabel: "Delete", danger: true,
    });
    if (!ok) return;
    setBusyId(t.transfer_id);
    try {
      const res = await api.post<{ ok: boolean; left: string[] }>(`/clients/${clientId}/ownership-transfers/${t.transfer_id}/delete`, {});
      toast(res.left && res.left.length > 0 ? `Transfer deleted. ${res.left.join(" ")}` : "Transfer deleted.");
      load();
      // The 8822-B/CRA/Amendment/Dissolution drafts this delete just
      // cascaded into (still-Draft ones only, per the backend) are gone
      // from the Government Forms section above too — an empty array still
      // bumps its reloadKey so it re-fetches and drops those rows instead
      // of showing stale "New"-badged filings that no longer exist.
      onFilingsGenerated?.([]);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this transfer.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleViewBillOfSale(transferId: string) {
    try {
      await viewFile(`/clients/${clientId}/ownership-transfers/${transferId}/bill-of-sale.pdf`);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not open the Bill of Sale.");
    }
  }
  async function handleDownloadBillOfSale(transferId: string, buyerName: string) {
    await downloadFile(
      `/clients/${clientId}/ownership-transfers/${transferId}/bill-of-sale.pdf`,
      buildFilename([clientName, "Bill of Sale", buyerName], "pdf")
    );
  }
  async function handlePrintBillOfSale(transferId: string) {
    try {
      await printFile(`/clients/${clientId}/ownership-transfers/${transferId}/bill-of-sale.pdf`);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not print the Bill of Sale.");
    }
  }
  async function handleDownloadBillOfSaleDocx(transferId: string, buyerName: string) {
    await downloadFile(
      `/clients/${clientId}/ownership-transfers/${transferId}/bill-of-sale.docx`,
      buildFilename([clientName, "Bill of Sale", buyerName], "docx")
    );
  }

  function scrollToGovForms() {
    document.getElementById("gov-forms-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Ownership Transfer</h2>
        {!showWizard && !editingTransfer && (
          <button className="btn-primary" onClick={openWizard} disabled={!referenceDataLoaded} title={referenceDataLoaded ? undefined : "Loading client data…"}>
            Start Ownership Transfer
          </button>
        )}
      </div>
      <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 12.5 }}>
        A guided, 4-step wizard: capture the sale, itemize the allocation, pick which documents this transfer needs,
        then generate everything at once. The 8822-B, CRA, Amendment, and Dissolution drafts appear in Government Forms above.
      </p>

      {showWizard && (
        <div style={{ marginBottom: 16, border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
          <StepProgress steps={WIZARD_STEPS} current={step} maxReached={maxStepReached} onSelect={goToStep} />
          {stepError && <div className="error-banner" role="alert" style={{ marginBottom: 10 }}>{stepError}</div>}
          {saveError && <div className="error-banner" role="alert" style={{ marginBottom: 10 }}>{saveError}</div>}

          {step === 1 && (
            <div>
              <div className="form-section-title">From the Client Profile</div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "8px 12px", marginBottom: 14, fontSize: 12.5 }}>
                <div><strong>{clientName}</strong>{identity?.dba_name ? ` (DBA ${identity.dba_name})` : ""}</div>
                <div className="muted">{identity?.entity_type || "Entity type not set"} · {combinedClientAddress(identity) || "No address on file"}</div>
                <div className="muted" style={{ marginTop: 4 }}>From the client profile — edit there if wrong.</div>
              </div>

              <div className="form-section-title">Seller (current owner)</div>
              <div className="form-grid-3">
                <div className={`field${stepError && !form.sellerName.trim() ? " invalid" : ""}`}>
                  <label htmlFor="xfer-seller-name">Seller Name</label>
                  <input id="xfer-seller-name" required value={form.sellerName} onChange={(e) => setForm((f) => ({ ...f, sellerName: e.target.value }))} />
                </div>
                <div className="field"><label htmlFor="xfer-seller-title">Seller Title</label><input id="xfer-seller-title" value={form.sellerTitle} onChange={(e) => setForm((f) => ({ ...f, sellerTitle: e.target.value }))} /></div>
              </div>

              <div className="form-section-title">Buyer (new owner)</div>
              <div className="form-grid-3">
                <div className={`field${stepError && !form.buyerName.trim() ? " invalid" : ""}`}>
                  <label htmlFor="xfer-buyer-name">Buyer Name</label>
                  <input id="xfer-buyer-name" required value={form.buyerName} onChange={(e) => setForm((f) => ({ ...f, buyerName: e.target.value }))} />
                </div>
                <div className="field"><label htmlFor="xfer-buyer-title">Buyer Title</label><input id="xfer-buyer-title" value={form.buyerTitle} onChange={(e) => setForm((f) => ({ ...f, buyerTitle: e.target.value }))} placeholder="e.g. Member, President" /></div>
                <div className="field"><label htmlFor="xfer-buyer-ssn">Buyer SSN <span className="muted">(for 8822-B/CRA)</span></label><input id="xfer-buyer-ssn" value={form.buyerSsn} onChange={(e) => setForm((f) => ({ ...f, buyerSsn: e.target.value }))} /></div>
                <div className="field"><label htmlFor="xfer-buyer-email">Buyer Email</label><input id="xfer-buyer-email" type="email" value={form.buyerEmail} onChange={(e) => setForm((f) => ({ ...f, buyerEmail: e.target.value }))} /></div>
                <div className="field"><label htmlFor="xfer-buyer-phone">Buyer Phone</label><input id="xfer-buyer-phone" value={form.buyerPhone} onChange={(e) => setForm((f) => ({ ...f, buyerPhone: e.target.value }))} /></div>
              </div>
              <div className="form-grid-3">
                <div className="field"><label htmlFor="xfer-buyer-street">Buyer Street Address</label><input id="xfer-buyer-street" value={form.buyerStreetAddress} onChange={(e) => setForm((f) => ({ ...f, buyerStreetAddress: e.target.value }))} /></div>
                <div className="field"><label htmlFor="xfer-buyer-city">City</label><input id="xfer-buyer-city" value={form.buyerCity} onChange={(e) => setForm((f) => ({ ...f, buyerCity: e.target.value }))} /></div>
                <div className="field">
                  <label htmlFor="xfer-buyer-state">State</label>
                  <select id="xfer-buyer-state" value={form.buyerState} onChange={(e) => setForm((f) => ({ ...f, buyerState: e.target.value }))}>
                    <option value="">Select…</option>
                    {US_STATES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="field"><label htmlFor="xfer-buyer-zip">ZIP</label><input id="xfer-buyer-zip" value={form.buyerZipCode} onChange={(e) => setForm((f) => ({ ...f, buyerZipCode: e.target.value }))} /></div>
              </div>

              <div className="form-section-title">Sale Terms</div>
              <div className="form-grid-3">
                <div className="field"><label htmlFor="xfer-effective">Effective Date</label><input id="xfer-effective" type="date" value={form.effectiveDate} onChange={(e) => setForm((f) => ({ ...f, effectiveDate: e.target.value }))} /></div>
                <div className="field">
                  <label htmlFor="xfer-price">Sale Price</label>
                  {wizardAllocRows.length > 0 ? (
                    <input id="xfer-price" value={fmtMoney(wizardAllocTotal)} disabled title="Computed from the asset allocation in the next step" />
                  ) : (
                    <input id="xfer-price" type="number" step="0.01" min="0" value={form.salePrice} onChange={(e) => setForm((f) => ({ ...f, salePrice: e.target.value }))} />
                  )}
                </div>
              </div>
              <div className="field"><label htmlFor="xfer-assets">Assets Included <span className="muted">(used only if you don't itemize an allocation in the next step)</span></label><textarea id="xfer-assets" rows={2} value={form.assetsIncluded} onChange={(e) => setForm((f) => ({ ...f, assetsIncluded: e.target.value }))} placeholder="e.g. Equipment, inventory, goodwill, business name" /></div>
              <div className="field"><label htmlFor="xfer-liabilities">Liabilities Included</label><textarea id="xfer-liabilities" rows={2} value={form.liabilitiesIncluded} onChange={(e) => setForm((f) => ({ ...f, liabilitiesIncluded: e.target.value }))} placeholder="e.g. None; or specific debts/leases Buyer is assuming" /></div>
              <div className="field">
                <label htmlFor="xfer-terms">Additional Clause(s) / Information <span className="muted">(optional)</span></label>
                <textarea
                  id="xfer-terms" rows={4} value={form.additionalTerms}
                  onChange={(e) => setForm((f) => ({ ...f, additionalTerms: e.target.value }))}
                  placeholder="Anything else the Bill of Sale should say — a non-compete clause, a payment schedule, an indemnification clause, contingencies, etc."
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="form-section-title">Allocation of Purchase Price <span className="muted" style={{ fontWeight: 400 }}>(optional — itemize instead of one Sale Price)</span></div>
              <p className="muted" style={{ fontSize: 11.5, marginTop: 0, marginBottom: 8 }}>
                Each line gets its own category and price; the Sale Price from the previous step is then computed as their total, mirroring a real IRC §1060 / Form 8594 allocation schedule. Leave empty to use the plain "Assets Included" description from Step 1 instead.
              </p>
              {form.assetAllocations.length > 0 && (
                <div className="table-wrap" style={{ marginBottom: 8 }}>
                  <table>
                    <thead><tr><th>Category</th><th>Description</th><th>Amount</th><th></th></tr></thead>
                    <tbody>
                      {form.assetAllocations.map((row, i) => (
                        <tr key={i}>
                          <td>
                            <select value={row.category} onChange={(e) => updateAllocationRow("wizard", i, { category: e.target.value })} aria-label="Allocation category">
                              {ASSET_ALLOCATION_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                            </select>
                          </td>
                          <td>
                            <input value={row.description} onChange={(e) => updateAllocationRow("wizard", i, { description: e.target.value })} placeholder="Optional detail" aria-label="Allocation description" />
                          </td>
                          <td style={{ width: 130 }}>
                            <input type="number" step="0.01" min="0" value={row.amount} onChange={(e) => updateAllocationRow("wizard", i, { amount: e.target.value })} aria-label="Allocation amount" />
                          </td>
                          <td>
                            <button type="button" className="btn-secondary" onClick={() => removeAllocationRow("wizard", i)} aria-label="Remove this allocation line">✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <button type="button" className="btn-secondary" onClick={() => addAllocationRow("wizard")}>+ Add Allocation Line</button>
                {wizardAllocRows.length > 0 && <strong style={{ fontSize: 13 }}>Total Allocated: {fmtMoney(wizardAllocTotal)}</strong>}
              </div>
              {wizardAllocRows.length === 0 && (
                <p className="muted" style={{ fontSize: 12.5 }}>No allocation lines yet — the Bill of Sale will use Step 1's "Assets Included" description and Sale Price instead.</p>
              )}
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="form-section-title">Documents to Generate</div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginBottom: 10 }}>
                <input type="checkbox" checked={form.include8822b} onChange={(e) => setForm((f) => ({ ...f, include8822b: e.target.checked }))} />
                IRS Form 8822-B — Change of Responsible Party
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={form.includeCra} onChange={(e) => setForm((f) => ({ ...f, includeCra: e.target.checked }))} />
                Maryland CRA Update — Change of Entity
              </label>
              {form.includeCra && (
                <p className="muted" style={{ fontSize: 11.5, margin: "2px 0 10px 24px" }}>
                  {identity?.cra_registration_number
                    ? `Will file as an UPDATE using the Central Registration Number already on file (${maskCraNumber(identity.cra_registration_number)}).`
                    : "No Central Registration Number is on file for this client yet — will file as a NEW registration."}
                </p>
              )}

              <div style={{ borderTop: "1px solid var(--border)", margin: "10px 0" }} />
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700 }}>
                <input type="checkbox" checked={form.isDissolving} onChange={(e) => toggleIsDissolving(e.target.checked)} />
                Is the old entity being dissolved (not just amending)?
              </label>
              <p className="muted" style={{ fontSize: 11.5, margin: "2px 0 10px 24px" }}>
                Check this only when the transfer ends with the old entity closing entirely — otherwise leave unchecked and use the Amendment below.
              </p>

              {!form.isDissolving && (
                <>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                    <input type="checkbox" checked={form.includeAmendment} onChange={(e) => setForm((f) => ({ ...f, includeAmendment: e.target.checked }))} />
                    {amendmentKind === "LLC" ? "MD Articles of Amendment — Limited Liability Company"
                      : amendmentKind === "CORP" ? "MD Articles of Amendment — Corporation"
                      : "MD Amendment reminder task (SDAT)"}
                  </label>
                  {form.includeAmendment && !amendmentKind && (
                    <p className="muted" style={{ fontSize: 11.5, margin: "2px 0 10px 24px" }}>
                      No Maryland Articles of Amendment generator applies to entity type "{identity?.entity_type || "not set"}" — a reminder task will be created instead of a real filing.
                    </p>
                  )}
                  {form.includeAmendment && amendmentKind && (
                    <div style={{ marginLeft: 24, marginBottom: 12, paddingLeft: 10, borderLeft: "2px solid var(--border)" }}>
                      <div className={`field${stepError && !amendment.amendmentText.trim() ? " invalid" : ""}`}>
                        <label htmlFor="xfer-amend-text">Amendment Text — what's changing in the charter</label>
                        <textarea id="xfer-amend-text" rows={3} value={amendment.amendmentText} onChange={(e) => setAmendment((a) => ({ ...a, amendmentText: e.target.value }))} placeholder="e.g. Article FIRST is amended to reflect the new owner as sole member." />
                      </div>
                      {amendmentKind === "CORP" && (
                        <div className="form-grid-3">
                          <div className="field" style={{ margin: 0 }}>
                            <label htmlFor="xfer-amend-corp-type">Corporation Type (before this amendment)</label>
                            <select id="xfer-amend-corp-type" value={amendment.corpTypeBefore} onChange={(e) => setAmendment((a) => ({ ...a, corpTypeBefore: e.target.value }))}>
                              {(meta?.mdAmendCorpTypes || []).map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div className={`field${stepError && !amendment.approvalMethod ? " invalid" : ""}`} style={{ margin: 0 }}>
                            <label htmlFor="xfer-amend-approval">Approved By</label>
                            <select id="xfer-amend-approval" value={amendment.approvalMethod} onChange={(e) => setAmendment((a) => ({ ...a, approvalMethod: e.target.value }))}>
                              <option value="">Select…</option>
                              {(meta?.mdAmendCorpApprovalMethods || []).map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>
                        </div>
                      )}
                      {amendmentKind === "LLC" && (
                        <div className="field">
                          <label htmlFor="xfer-amend-new-agent">New Resident Agent Name <span className="muted">(only if this amendment appoints a NEW resident agent)</span></label>
                          <input id="xfer-amend-new-agent" value={amendment.newResidentAgentName} onChange={(e) => setAmendment((a) => ({ ...a, newResidentAgentName: e.target.value }))} />
                        </div>
                      )}
                      {amendmentKind === "CORP" && (
                        <div className="form-grid-3">
                          <div className="field" style={{ margin: 0 }}><label htmlFor="xfer-amend-ret1">Return Address — Line 1</label><input id="xfer-amend-ret1" value={amendment.returnAddressLine1} onChange={(e) => setAmendment((a) => ({ ...a, returnAddressLine1: e.target.value }))} /></div>
                          <div className="field" style={{ margin: 0 }}><label htmlFor="xfer-amend-ret2">Return Address — Line 2</label><input id="xfer-amend-ret2" value={amendment.returnAddressLine2} onChange={(e) => setAmendment((a) => ({ ...a, returnAddressLine2: e.target.value }))} /></div>
                          <div className="field" style={{ margin: 0 }}><label htmlFor="xfer-amend-ret3">Return Address — Line 3</label><input id="xfer-amend-ret3" value={amendment.returnAddressLine3} onChange={(e) => setAmendment((a) => ({ ...a, returnAddressLine3: e.target.value }))} /></div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {form.isDissolving && (
                <>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                    <input type="checkbox" checked={form.includeDissolution} onChange={(e) => setForm((f) => ({ ...f, includeDissolution: e.target.checked }))} />
                    MD Articles of Dissolution
                  </label>
                  {form.includeDissolution && (
                    <div style={{ marginLeft: 24, marginBottom: 12, paddingLeft: 10, borderLeft: "2px solid var(--border)" }}>
                      <div className="form-grid-3">
                        <div className="field" style={{ margin: 0 }}>
                          <label htmlFor="xfer-dis-sdat">SDAT ID <span className="muted">(optional)</span></label>
                          <input id="xfer-dis-sdat" value={dissolution.sdatId} onChange={(e) => setDissolution((d) => ({ ...d, sdatId: e.target.value }))} />
                        </div>
                      </div>
                      {dissolution.sdatId.trim() && !identity?.secretary_of_state_id && (
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, marginTop: -4, marginBottom: 8 }}>
                          <input type="checkbox" checked={dissolution.saveSdatIdToProfile} onChange={(e) => setDissolution((d) => ({ ...d, saveSdatIdToProfile: e.target.checked }))} />
                          Save this SDAT ID to the client profile (currently empty there)
                        </label>
                      )}
                      <div className={`field${stepError && !dissolution.principalOfficeAddress.trim() ? " invalid" : ""}`}>
                        <label htmlFor="xfer-dis-office">Principal Office Address</label>
                        <input id="xfer-dis-office" value={dissolution.principalOfficeAddress} onChange={(e) => setDissolution((d) => ({ ...d, principalOfficeAddress: e.target.value }))} />
                      </div>
                      <div className="form-grid-3">
                        <div className={`field${stepError && !dissolution.residentAgentName.trim() ? " invalid" : ""}`} style={{ margin: 0 }}>
                          <label htmlFor="xfer-dis-agent-name">Resident Agent Name</label>
                          <input id="xfer-dis-agent-name" value={dissolution.residentAgentName} onChange={(e) => setDissolution((d) => ({ ...d, residentAgentName: e.target.value }))} />
                        </div>
                        <div className={`field${stepError && !dissolution.residentAgentAddress.trim() ? " invalid" : ""}`} style={{ margin: 0 }}>
                          <label htmlFor="xfer-dis-agent-address">Resident Agent Address</label>
                          <input id="xfer-dis-agent-address" value={dissolution.residentAgentAddress} onChange={(e) => setDissolution((d) => ({ ...d, residentAgentAddress: e.target.value }))} />
                        </div>
                        <div className="field" style={{ margin: 0 }}>
                          <label htmlFor="xfer-dis-agent-consent">Resident Agent Consent Signer <span className="muted">(only if the agent is itself an MD LLC/corp)</span></label>
                          <input id="xfer-dis-agent-consent" value={dissolution.residentAgentConsentSignerName} onChange={(e) => setDissolution((d) => ({ ...d, residentAgentConsentSignerName: e.target.value }))} />
                        </div>
                      </div>

                      <div className="form-section-title" style={{ fontSize: 12.5 }}>Directors / Trustees <span className="muted" style={{ fontWeight: 400 }}>(up to 4)</span></div>
                      {directors.map((d, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 6 }}>
                          <div className="field" style={{ margin: 0, flex: 1 }}>
                            <label htmlFor={`xfer-dis-director-name-${i}`}>Name</label>
                            <input id={`xfer-dis-director-name-${i}`} value={d.name} onChange={(e) => patchDirectorRow(i, { name: e.target.value })} />
                          </div>
                          <div className="field" style={{ margin: 0, flex: 1 }}>
                            <label htmlFor={`xfer-dis-director-address-${i}`}>Address</label>
                            <input id={`xfer-dis-director-address-${i}`} value={d.address} onChange={(e) => patchDirectorRow(i, { address: e.target.value })} />
                          </div>
                          {directors.length > 1 && <button type="button" className="btn-secondary" onClick={() => removeDirectorRow(i)} aria-label="Remove this director/trustee">✕</button>}
                        </div>
                      ))}
                      {directors.length < 4 && <button type="button" className="btn-secondary" onClick={addDirectorRow} style={{ marginBottom: 12 }}>+ Add Director/Trustee</button>}

                      <div className="form-section-title" style={{ fontSize: 12.5 }}>Officers <span className="muted" style={{ fontWeight: 400 }}>(at least one recommended)</span></div>
                      <div className="form-grid-3">
                        <div className="field" style={{ margin: 0 }}><label htmlFor="xfer-dis-pres-name">President Name</label><input id="xfer-dis-pres-name" value={dissolution.presidentName} onChange={(e) => setDissolution((d) => ({ ...d, presidentName: e.target.value }))} /></div>
                        <div className="field" style={{ margin: 0 }}><label htmlFor="xfer-dis-pres-address">President Address</label><input id="xfer-dis-pres-address" value={dissolution.presidentAddress} onChange={(e) => setDissolution((d) => ({ ...d, presidentAddress: e.target.value }))} /></div>
                        <div />
                        <div className="field" style={{ margin: 0 }}><label htmlFor="xfer-dis-treas-name">Treasurer Name</label><input id="xfer-dis-treas-name" value={dissolution.treasurerName} onChange={(e) => setDissolution((d) => ({ ...d, treasurerName: e.target.value }))} /></div>
                        <div className="field" style={{ margin: 0 }}><label htmlFor="xfer-dis-treas-address">Treasurer Address</label><input id="xfer-dis-treas-address" value={dissolution.treasurerAddress} onChange={(e) => setDissolution((d) => ({ ...d, treasurerAddress: e.target.value }))} /></div>
                        <div />
                        <div className="field" style={{ margin: 0 }}><label htmlFor="xfer-dis-sec-name">Secretary Name</label><input id="xfer-dis-sec-name" value={dissolution.secretaryName} onChange={(e) => setDissolution((d) => ({ ...d, secretaryName: e.target.value }))} /></div>
                        <div className="field" style={{ margin: 0 }}><label htmlFor="xfer-dis-sec-address">Secretary Address</label><input id="xfer-dis-sec-address" value={dissolution.secretaryAddress} onChange={(e) => setDissolution((d) => ({ ...d, secretaryAddress: e.target.value }))} /></div>
                        <div />
                        <div className="field" style={{ margin: 0 }}><label htmlFor="xfer-dis-other-name">Other Officer Name</label><input id="xfer-dis-other-name" value={dissolution.otherOfficerName} onChange={(e) => setDissolution((d) => ({ ...d, otherOfficerName: e.target.value }))} /></div>
                        <div className="field" style={{ margin: 0 }}><label htmlFor="xfer-dis-other-address">Other Officer Address</label><input id="xfer-dis-other-address" value={dissolution.otherOfficerAddress} onChange={(e) => setDissolution((d) => ({ ...d, otherOfficerAddress: e.target.value }))} /></div>
                      </div>

                      <div className="form-grid-3" style={{ marginTop: 8 }}>
                        <div className={`field${stepError && !dissolution.approvalManner ? " invalid" : ""}`} style={{ gridColumn: "1 / -1" }}>
                          <label htmlFor="xfer-dis-manner">Manner of Approval</label>
                          <select id="xfer-dis-manner" value={dissolution.approvalManner} onChange={(e) => setDissolution((d) => ({ ...d, approvalManner: e.target.value }))}>
                            <option value="">Select…</option>
                            {(meta?.mdDissolutionApprovalManners || []).map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        {dissolution.approvalManner === (meta?.mdDissolutionApprovalManners || [])[8] && (
                          <div className="field" style={{ gridColumn: "1 / -1" }}>
                            <label htmlFor="xfer-dis-manner-other">Describe the "Other" manner of approval</label>
                            <input id="xfer-dis-manner-other" value={dissolution.otherMannerText} onChange={(e) => setDissolution((d) => ({ ...d, otherMannerText: e.target.value }))} />
                          </div>
                        )}
                      </div>

                      <div className="form-grid-3">
                        <div className="field" style={{ margin: 0 }}>
                          <label htmlFor="xfer-dis-creditor">Creditor Notice</label>
                          <select id="xfer-dis-creditor" value={dissolution.creditorNotice} onChange={(e) => setDissolution((d) => ({ ...d, creditorNotice: e.target.value as typeof dissolution.creditorNotice }))}>
                            <option value="No known creditors">No known creditors</option>
                            <option value="Mailed to known creditors">Mailed to known creditors</option>
                          </select>
                        </div>
                        {dissolution.creditorNotice === "Mailed to known creditors" && (
                          <div className={`field${stepError && !dissolution.creditorNoticeMailedDate.trim() ? " invalid" : ""}`} style={{ margin: 0 }}>
                            <label htmlFor="xfer-dis-creditor-date">Date Mailed</label>
                            <input id="xfer-dis-creditor-date" placeholder="MM/DD/YYYY" value={dissolution.creditorNoticeMailedDate} onChange={(e) => setDissolution((d) => ({ ...d, creditorNoticeMailedDate: e.target.value }))} />
                          </div>
                        )}
                        <div className="field" style={{ margin: 0 }}>
                          <label htmlFor="xfer-dis-effective">Effective Date</label>
                          <select id="xfer-dis-effective" value={dissolution.effectiveDateType} onChange={(e) => setDissolution((d) => ({ ...d, effectiveDateType: e.target.value as typeof dissolution.effectiveDateType }))}>
                            <option value="immediate">Immediate (on filing)</option>
                            <option value="future">A future date (≤30 days out)</option>
                          </select>
                        </div>
                        {dissolution.effectiveDateType === "future" && (
                          <div className={`field${stepError && !dissolution.futureEffectiveDate.trim() ? " invalid" : ""}`} style={{ margin: 0 }}>
                            <label htmlFor="xfer-dis-future-date">Future Effective Date</label>
                            <input id="xfer-dis-future-date" placeholder="MM/DD/YYYY" value={dissolution.futureEffectiveDate} onChange={(e) => setDissolution((d) => ({ ...d, futureEffectiveDate: e.target.value }))} />
                          </div>
                        )}
                      </div>
                      <div className="field">
                        <label htmlFor="xfer-dis-provisions">Additional Provisions <span className="muted">(optional)</span></label>
                        <textarea id="xfer-dis-provisions" rows={2} value={dissolution.additionalProvisions} onChange={(e) => setDissolution((d) => ({ ...d, additionalProvisions: e.target.value }))} />
                      </div>
                    </div>
                  )}
                </>
              )}

              <div style={{ borderTop: "1px solid var(--border)", margin: "10px 0" }} />
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={form.includeBillOfSale} onChange={(e) => setForm((f) => ({ ...f, includeBillOfSale: e.target.checked }))} />
                Bill of Sale (PDF + Word)
              </label>
            </div>
          )}

          {step === 4 && (
            <div>
              {!lastResult ? (
                <>
                  <div className="form-section-title">Ready to Generate</div>
                  <ul style={{ fontSize: 12.5, lineHeight: 1.9, margin: "0 0 14px", paddingLeft: 18 }}>
                    {form.includeBillOfSale && <li>Bill of Sale (PDF + Word) — for {form.sellerName || "the seller"} → {form.buyerName || "the buyer"}</li>}
                    {form.include8822b && <li>IRS Form 8822-B — Change of Responsible Party</li>}
                    {form.includeCra && <li>Maryland CRA — {identity?.cra_registration_number ? "Update" : "New Registration"}</li>}
                    {!form.isDissolving && form.includeAmendment && (
                      <li>MD Articles of Amendment{amendmentKind ? ` — ${amendmentKind === "LLC" ? "LLC" : "Corporation"}` : " reminder task (entity type not supported for auto-generation)"}</li>
                    )}
                    {form.isDissolving && form.includeDissolution && <li>MD Articles of Dissolution</li>}
                    {!form.includeBillOfSale && !form.include8822b && !form.includeCra && !form.includeAmendment && !(form.isDissolving && form.includeDissolution) && (
                      <li className="muted">Nothing selected — go back to Step 3 to pick at least one document.</li>
                    )}
                  </ul>
                  <button
                    type="button" className="btn-primary" disabled={saving}
                    onClick={handleGenerateAll}
                  >
                    {saving ? "Generating…" : "Generate All"}
                  </button>
                </>
              ) : (
                <div>
                  <div className="alert-strip" style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12.5 }}>
                      {lastResult.created.billOfSale && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                          <span>✓ Bill of Sale ready:</span>
                          <button className="btn-secondary" onClick={() => handleViewBillOfSale(lastResult.transferId)}>View PDF</button>
                          <button className="btn-secondary" onClick={() => handleDownloadBillOfSale(lastResult.transferId, form.buyerName)}>Download PDF</button>
                          <button className="btn-secondary" onClick={() => handlePrintBillOfSale(lastResult.transferId)}>Print</button>
                          <button className="btn-secondary" onClick={() => handleDownloadBillOfSaleDocx(lastResult.transferId, form.buyerName)}>Word (.docx)</button>
                        </div>
                      )}
                      {lastResult.created.form8822b && <div>✓ Form 8822-B drafted — see Government Forms above.</div>}
                      {lastResult.created.craUpdate && <div>✓ Maryland CRA drafted — see Government Forms above.</div>}
                      {lastResult.created.amendment && <div>✓ MD Articles of Amendment drafted — see Government Forms above.</div>}
                      {lastResult.created.mdAmendmentTask && <div>✓ Task created to file the MD Amendment with SDAT by hand.</div>}
                      {lastResult.created.dissolution && <div>✓ MD Articles of Dissolution drafted — see Government Forms above.</div>}
                      {lastResult.skippedReasons.map((r, i) => <div key={i} style={{ color: "var(--danger, #b23)" }}>⚠ {r}</div>)}
                      {lastResult.createdFilingIds.length > 0 && (
                        <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={scrollToGovForms}>
                          Jump to Government Forms ↓
                        </button>
                      )}
                    </div>
                  </div>
                  <button type="button" className="btn-primary" onClick={closeWizard}>Done</button>
                </div>
              )}
            </div>
          )}

          {!lastResult && (
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              {step > 1 && <button type="button" className="btn-secondary" onClick={goBack} disabled={saving}>Back</button>}
              {step < 4 && <button type="button" className="btn-primary" onClick={goNext}>Next</button>}
              <button type="button" className="btn-secondary" onClick={closeWizard} disabled={saving}>Cancel</button>
            </div>
          )}
        </div>
      )}

      {editingTransfer && (
        <div style={{ marginBottom: 16, border: "1px solid var(--border)", borderRadius: 8, padding: 14 }}>
          {saveError && <div className="error-banner" role="alert" style={{ marginBottom: 10 }}>{saveError}</div>}
          <div className="form-section-title">Documents to Generate</div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
            <input type="checkbox" checked={editForm.includeBillOfSale} onChange={(e) => setEditForm((f) => ({ ...f, includeBillOfSale: e.target.checked }))} />
            Bill of Sale (show its download buttons below)
          </label>
          <p className="muted" style={{ fontSize: 11.5, margin: "4px 0 0" }}>
            8822-B / CRA / MD Amendment / Dissolution were already decided when this package was created — edit those directly in Government Forms/Tasks if needed.
          </p>

          <div className="form-section-title">Seller (current owner)</div>
          <div className="form-grid-3">
            <div className="field"><label htmlFor="xfer-edit-seller-name">Seller Name</label><input id="xfer-edit-seller-name" required value={editForm.sellerName} onChange={(e) => setEditForm((f) => ({ ...f, sellerName: e.target.value }))} /></div>
            <div className="field"><label htmlFor="xfer-edit-seller-title">Seller Title</label><input id="xfer-edit-seller-title" value={editForm.sellerTitle} onChange={(e) => setEditForm((f) => ({ ...f, sellerTitle: e.target.value }))} /></div>
          </div>

          <div className="form-section-title">Buyer (new owner)</div>
          <div className="form-grid-3">
            <div className="field"><label htmlFor="xfer-edit-buyer-name">Buyer Name</label><input id="xfer-edit-buyer-name" required value={editForm.buyerName} onChange={(e) => setEditForm((f) => ({ ...f, buyerName: e.target.value }))} /></div>
            <div className="field"><label htmlFor="xfer-edit-buyer-title">Buyer Title</label><input id="xfer-edit-buyer-title" value={editForm.buyerTitle} onChange={(e) => setEditForm((f) => ({ ...f, buyerTitle: e.target.value }))} /></div>
            <div className="field"><label htmlFor="xfer-edit-buyer-ssn">Buyer SSN</label><input id="xfer-edit-buyer-ssn" value={editForm.buyerSsn} onChange={(e) => setEditForm((f) => ({ ...f, buyerSsn: e.target.value }))} /></div>
            <div className="field"><label htmlFor="xfer-edit-buyer-email">Buyer Email</label><input id="xfer-edit-buyer-email" type="email" value={editForm.buyerEmail} onChange={(e) => setEditForm((f) => ({ ...f, buyerEmail: e.target.value }))} /></div>
            <div className="field"><label htmlFor="xfer-edit-buyer-phone">Buyer Phone</label><input id="xfer-edit-buyer-phone" value={editForm.buyerPhone} onChange={(e) => setEditForm((f) => ({ ...f, buyerPhone: e.target.value }))} /></div>
          </div>
          <div className="form-grid-3">
            <div className="field"><label htmlFor="xfer-edit-buyer-street">Buyer Street Address</label><input id="xfer-edit-buyer-street" value={editForm.buyerStreetAddress} onChange={(e) => setEditForm((f) => ({ ...f, buyerStreetAddress: e.target.value }))} /></div>
            <div className="field"><label htmlFor="xfer-edit-buyer-city">City</label><input id="xfer-edit-buyer-city" value={editForm.buyerCity} onChange={(e) => setEditForm((f) => ({ ...f, buyerCity: e.target.value }))} /></div>
            <div className="field">
              <label htmlFor="xfer-edit-buyer-state">State</label>
              <select id="xfer-edit-buyer-state" value={editForm.buyerState} onChange={(e) => setEditForm((f) => ({ ...f, buyerState: e.target.value }))}>
                <option value="">Select…</option>
                {US_STATES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="field"><label htmlFor="xfer-edit-buyer-zip">ZIP</label><input id="xfer-edit-buyer-zip" value={editForm.buyerZipCode} onChange={(e) => setEditForm((f) => ({ ...f, buyerZipCode: e.target.value }))} /></div>
          </div>

          <div className="form-section-title">Sale Terms</div>
          <div className="form-grid-3">
            <div className="field"><label htmlFor="xfer-edit-effective">Effective Date</label><input id="xfer-edit-effective" type="date" value={editForm.effectiveDate} onChange={(e) => setEditForm((f) => ({ ...f, effectiveDate: e.target.value }))} /></div>
            <div className="field">
              <label htmlFor="xfer-edit-price">Sale Price</label>
              {editAllocRows.length > 0 ? (
                <input id="xfer-edit-price" value={fmtMoney(editAllocTotal)} disabled title="Computed from the asset allocation below" />
              ) : (
                <input id="xfer-edit-price" type="number" step="0.01" min="0" value={editForm.salePrice} onChange={(e) => setEditForm((f) => ({ ...f, salePrice: e.target.value }))} />
              )}
            </div>
          </div>

          <div className="form-section-title">Allocation of Purchase Price <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></div>
          {editForm.assetAllocations.length > 0 && (
            <div className="table-wrap" style={{ marginBottom: 8 }}>
              <table>
                <thead><tr><th>Category</th><th>Description</th><th>Amount</th><th></th></tr></thead>
                <tbody>
                  {editForm.assetAllocations.map((row, i) => (
                    <tr key={i}>
                      <td>
                        <select value={row.category} onChange={(e) => updateAllocationRow("edit", i, { category: e.target.value })} aria-label="Allocation category">
                          {ASSET_ALLOCATION_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                      </td>
                      <td><input value={row.description} onChange={(e) => updateAllocationRow("edit", i, { description: e.target.value })} placeholder="Optional detail" aria-label="Allocation description" /></td>
                      <td style={{ width: 130 }}><input type="number" step="0.01" min="0" value={row.amount} onChange={(e) => updateAllocationRow("edit", i, { amount: e.target.value })} aria-label="Allocation amount" /></td>
                      <td><button type="button" className="btn-secondary" onClick={() => removeAllocationRow("edit", i)} aria-label="Remove this allocation line">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <button type="button" className="btn-secondary" onClick={() => addAllocationRow("edit")}>+ Add Allocation Line</button>
            {editAllocRows.length > 0 && <strong style={{ fontSize: 13 }}>Total Allocated: {fmtMoney(editAllocTotal)}</strong>}
          </div>
          {editAllocRows.length === 0 && (
            <div className="field"><label htmlFor="xfer-edit-assets">Assets Included</label><textarea id="xfer-edit-assets" rows={2} value={editForm.assetsIncluded} onChange={(e) => setEditForm((f) => ({ ...f, assetsIncluded: e.target.value }))} /></div>
          )}
          <div className="field"><label htmlFor="xfer-edit-liabilities">Liabilities Included</label><textarea id="xfer-edit-liabilities" rows={2} value={editForm.liabilitiesIncluded} onChange={(e) => setEditForm((f) => ({ ...f, liabilitiesIncluded: e.target.value }))} /></div>
          <div className="field"><label htmlFor="xfer-edit-terms">Additional Clause(s) / Information <span className="muted">(optional)</span></label><textarea id="xfer-edit-terms" rows={4} value={editForm.additionalTerms} onChange={(e) => setEditForm((f) => ({ ...f, additionalTerms: e.target.value }))} /></div>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button type="button" className="btn-primary" disabled={saving} onClick={handleEditSubmit}>{saving ? "Saving…" : "Save Changes"}</button>
            <button type="button" className="btn-secondary" onClick={() => setEditingTransfer(null)} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}

      {transfers === null ? (
        <p className="muted">Loading…</p>
      ) : transfers.length === 0 ? (
        !showWizard && !editingTransfer && <p className="muted">No ownership transfers on file for this client yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Seller</th><th>Buyer</th><th>Effective Date</th><th>Sale Price</th><th>Created</th><th></th></tr>
            </thead>
            <tbody>
              {transfers.map((t) => {
                const blockingReasons = applyBlockingReasons(t);
                const applyReady = blockingReasons.length === 0;
                return (
                <tr key={t.transfer_id}>
                  <td>{t.seller_name}</td>
                  <td>{t.buyer_name}</td>
                  <td>{t.effective_date ? fmtDateOnly(t.effective_date) : "—"}</td>
                  <td>{t.sale_price != null ? `$${Number(t.sale_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}</td>
                  <td>{fmtDateOnly(t.created_at)}</td>
                  <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {t.include_bill_of_sale && (
                      <>
                        <button className="btn-secondary" onClick={() => handleViewBillOfSale(t.transfer_id)}>View PDF</button>
                        <button className="btn-secondary" onClick={() => handleDownloadBillOfSale(t.transfer_id, t.buyer_name)}>Download PDF</button>
                        <button className="btn-secondary" onClick={() => handlePrintBillOfSale(t.transfer_id)}>Print PDF</button>
                        <button className="btn-secondary" onClick={() => handleDownloadBillOfSaleDocx(t.transfer_id, t.buyer_name)}>Word (.docx)</button>
                      </>
                    )}
                    <button className="btn-secondary" onClick={() => openEditForm(t)} disabled={busyId === t.transfer_id}>Edit</button>
                    {isAdmin && (
                      <button className="btn-secondary" onClick={() => handleDelete(t)} disabled={busyId === t.transfer_id}>{busyId === t.transfer_id ? "Deleting…" : "Delete"}</button>
                    )}
                    {isAdmin && (
                      t.applied_to_profile_at ? (
                        <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
                          Applied on {fmtDateTime(t.applied_to_profile_at)}{t.applied_by ? ` by ${t.applied_by}` : ""}
                        </span>
                      ) : (
                        <button
                          className="btn-primary"
                          onClick={() => handleApplyNewOwner(t)}
                          disabled={!applyReady || applyingId === t.transfer_id}
                          title={applyReady ? "Update the client's contact info and transfer the portal login to the new owner" : blockingReasons.join(" ")}
                        >
                          {applyingId === t.transfer_id ? "Applying…" : "Apply New Owner to Client Profile"}
                        </button>
                      )
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
