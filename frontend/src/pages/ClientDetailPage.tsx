import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, downloadFile, viewFile, printFile, openAnyFile, downloadAnyFile, printAnyFile, buildFilename } from "../api/client";
import type { Client, Task } from "../api/types";
import type { VaultSecret, PaymentMethod, PortalUser, DocumentUpload, DocumentRequest, Communication, Invoice } from "../api/types2";
import { BackLink } from "../components/BackLink";
import { PrevNextNav } from "../components/PrevNextNav";
import { getAdjacentIds } from "../utils/listNav";
import { DraftRestoreBanner } from "../components/DraftRestoreBanner";
import { useFormDraft } from "../hooks/useFormDraft";
import { UploadFileModal } from "../components/UploadFileModal";
import { ChangePortalEmailModal } from "../components/ChangePortalEmailModal";
import { RequestDocumentModal } from "../components/RequestDocumentModal";
import { ClientMessages } from "./CommunicationsPage";
import { useAuth } from "../auth/AuthContext";
import { StatusBadge, colorClassFor } from "../components/StatusBadge";
import { useToast } from "../components/Toast";
import { useConfirm, usePrompt, useNotify } from "../components/ConfirmProvider";
import { US_STATES, ENTITY_TYPES, deriveServiceType, INDUSTRY_CATEGORIES, FIRM_SERVICES, servicesForClientType, FREQ_OPTIONS, PAYROLL_FREQS, PAYROLL_PROVIDERS, RETURN_TYPES, LANGUAGES, CONTACT_PREFS, POA_COVERED_SERVICE_KEYS, POA_RELEASE_SERVICE_KEY, POA_RELEASE_LABEL, REFERRAL_SOURCES } from "../utils/clientOptions";
import { AddressFields } from "../components/AddressFields";
import { ActionMenu } from "../components/ActionMenu";
import { TASK_STATUSES, DueLabel, taskActionOptions, TASK_QUICK_ACTIONS, TASK_QUICK_ACTION_ICON } from "../components/TaskCells";
import { fmtDateOnly, fmtDateTime } from "../utils/date";
import type { ClientContract } from "../api/types";
import { ContractBodyText } from "../components/ContractBodyText";
import { ErrorBanner } from "../components/ErrorBanner";
import type { PoaFiling } from "../api/poaForms";
import { FORM_LABELS, SUBMIT_VIA_OPTIONS, STATUS_COLOR } from "../api/poaForms";
import { GeneratePoaFormModal } from "../components/GeneratePoaFormModal";
import type { GovFormFiling, ClientGovFormType } from "../api/govForms";
import { GOV_FORM_LABELS, GOV_SUBMIT_VIA_OPTIONS, GOV_STATUS_COLOR } from "../api/govForms";
import { GenerateGovFormModal } from "../components/GenerateGovFormModal";
import { LabelChips, LabelPicker, useEntityLabel } from "../components/Labels";
import { ClientAtAGlance } from "../components/ClientAtAGlance";
import { ClientSwotSection } from "../components/ClientSwotSection";
import { OwnershipTransferSection } from "../components/OwnershipTransferSection";
import { Building2, MapPin, FileText, UserRound, Briefcase, ClipboardList, StickyNote, PanelLeftClose, PanelLeft } from "lucide-react";

type FieldKind = "text" | "select" | "multiselect" | "checkbox" | "textarea" | "date";
/** hidden: called with the live edit form — lets a field disappear based on Client Type or Services Provided, same "show info for the related service" behavior as the Add Client form. */
interface FieldConfig { key: string; apiKey: string; label: string; kind: FieldKind; options?: string[]; hidden?: (form: Record<string, any>) => boolean; suggestions?: string[] }

const hasService = (form: Record<string, any>, key: string) => Array.isArray(form.services) && form.services.includes(key);
const isBusiness = (form: Record<string, any>) => form.clientType !== "Individual";
const hasContact = (form: Record<string, any>) => Boolean(String(form.email || "").trim() || String(form.phone || "").trim());
const filled = (v: unknown) => Boolean(v) && v !== "N/A";

const PROFILE_CARD_WIDTH_MIN = 360;
const PROFILE_CARD_WIDTH_MAX = 900;
const PROFILE_CARD_WIDTH_KEY = "altax_client_profile_card_width";
const clampProfileCardWidth = (n: number) => Math.min(PROFILE_CARD_WIDTH_MAX, Math.max(PROFILE_CARD_WIDTH_MIN, n));

const EDIT_FORM_WIDTH_MIN = 700;
const EDIT_FORM_WIDTH_MAX = 1600;
const EDIT_FORM_WIDTH_KEY = "altax_client_edit_form_width";
const clampEditFormWidth = (n: number) => Math.min(EDIT_FORM_WIDTH_MAX, Math.max(EDIT_FORM_WIDTH_MIN, n));
// "Services Provided" is a brand-new field — almost every existing client has
// services=[] until someone opens and re-saves them, even if they've had real
// payroll/sales-tax/tax-prep settings configured for years. Gating a whole
// section on the service checkbox ALONE (or on a single bundled proxy like
// payrollEnabled) would hide real data: confirmed against production — 1-6
// real clients each have EFTPS/MD UI/W-2-1099/MD Withholding set to a real
// value while payroll_enabled is false, and 2 clients have an Entity Type set
// despite not being flagged Business. So every field below checks its OWN
// existing value individually, not a section-level bundle — a field only
// disappears if it has neither a matching service checked NOR any value on
// file, never if it's carrying real data that just hasn't been reflected in
// the new Services Provided list yet.
const showPayrollFrequency = (f: Record<string, any>) => hasService(f, "payroll") || Boolean(f.payrollEnabled) || filled(f.payrollFrequency);
const showPayrollSystem = (f: Record<string, any>) => hasService(f, "payroll") || Boolean(f.payrollEnabled) || filled(f.payrollSystem);
const showMdWithholding = (f: Record<string, any>) => hasService(f, "payroll") || Boolean(f.payrollEnabled) || filled(f.mdWithholdingFrequency);
const showEftps = (f: Record<string, any>) => hasService(f, "payroll") || Boolean(f.payrollEnabled) || Boolean(f.eftpsEnabled);
const showMdui = (f: Record<string, any>) => hasService(f, "payroll") || Boolean(f.payrollEnabled) || Boolean(f.mduiEnabled);
const showW21099 = (f: Record<string, any>) => hasService(f, "payroll") || Boolean(f.payrollEnabled) || Boolean(f.w21099Enabled);
const showSalesTaxDetails = (f: Record<string, any>) => hasService(f, "sales_tax") || filled(f.salesTaxFrequency);
const showTaxPrepDetails = (f: Record<string, any>) => hasService(f, "tax_prep") || filled(f.businessReturnType);
const showMdAnnualReport = (f: Record<string, any>) => isBusiness(f) || Boolean(f.mdAnnualReportEnabled);
const showEntityType = (f: Record<string, any>) => isBusiness(f) || filled(f.entityType);

// Same 7-card shape and order as the Add Client wizard (ClientsListPage.tsx)
// — Payroll/Sales Tax/Tax Prep/Business Compliance nest inside "Services
// Provided" via nestedIn, exactly like the Add Client form nests them, so a
// client's profile no longer looks like a different, older app than the
// form used to create it.
const EDIT_SECTIONS: { title: string; fields: FieldConfig[]; nestedIn?: string }[] = [
  {
    title: "Client Identity",
    fields: [
      { key: "client_name", apiKey: "clientName", label: "Client Name", kind: "text" },
      { key: "dba_name", apiKey: "dbaName", label: "DBA / Trade Name", kind: "text", hidden: (f) => !isBusiness(f) },
      { key: "client_type", apiKey: "clientType", label: "Client Type", kind: "select", options: ["Business", "Individual"] },
      { key: "status", apiKey: "status", label: "Active?", kind: "select", options: ["Active", "Inactive", "Archived"] },
      { key: "entity_type", apiKey: "entityType", label: "Entity Type", kind: "select", options: ENTITY_TYPES, hidden: (f) => !showEntityType(f) },
      { key: "date_of_formation", apiKey: "dateOfFormation", label: "Date of Formation", kind: "date", hidden: (f) => !isBusiness(f) },
      { key: "state", apiKey: "state", label: "State", kind: "select", options: US_STATES },
      // Service Type is NOT editable here — it's auto-derived from the Services
      // Provided checkboxes below (see the "Client Identity" custom-render block
      // further down) and just displayed for reference. Used to be its own
      // independently-set dropdown; confirmed live 2026-08-22 that 78 of 152
      // active clients were labeled "Full Service" while missing most of what
      // was actually checked, because nothing ever kept the two in sync.
      { key: "industry_category", apiKey: "industryCategory", label: "Industry", kind: "text", suggestions: INDUSTRY_CATEGORIES },
    ],
  },
  {
    title: "Contact & Address",
    fields: [
      { key: "email", apiKey: "email", label: "Email", kind: "text" },
      { key: "phone", apiKey: "phone", label: "Phone", kind: "text" },
      { key: "preferred_contact", apiKey: "preferredContact", label: "Preferred Contact", kind: "multiselect", options: CONTACT_PREFS, hidden: (f) => !hasContact(f) },
      { key: "preferred_language", apiKey: "preferredLanguage", label: "Preferred Language", kind: "select", options: LANGUAGES },
      { key: "sms_allowed", apiKey: "smsAllowed", label: "SMS Enabled", kind: "checkbox", hidden: (f) => !hasContact(f) },
      { key: "email_allowed", apiKey: "emailAllowed", label: "Email Enabled", kind: "checkbox", hidden: (f) => !hasContact(f) },
      { key: "referral_source", apiKey: "referralSource", label: "Referral Source", kind: "text", suggestions: REFERRAL_SOURCES },
    ],
  },
  {
    title: "Business Tax IDs",
    fields: [
      { key: "state_tax_id", apiKey: "stateTaxId", label: "State Tax ID", kind: "text" },
      { key: "individual_ssn", apiKey: "individualSsn", label: "Individual SS No.", kind: "text", hidden: (f) => isBusiness(f) },
      { key: "ein", apiKey: "ein", label: "EIN", kind: "text", hidden: (f) => !isBusiness(f) },
      { key: "secretary_of_state_id", apiKey: "secretaryOfStateId", label: "Secretary of State ID (SDAT)", kind: "text", hidden: (f) => !isBusiness(f) },
      { key: "cra_registration_number", apiKey: "craRegistrationNumber", label: "CRA / Central Registration No.", kind: "text", hidden: (f) => !isBusiness(f) },
      // Employer-specific MD Unemployment Insurance account number + this
      // client's own experience-rated UI tax rate (varies per employer) —
      // grouped here with the other business tax IDs, not under Payroll
      // Details, since that's where staff actually look for it. Saving
      // mdUiTaxRate also syncs a client-scoped SUTA override into
      // v3_tax_rates server-side — see clients.routes.ts's
      // syncMdUiTaxRateOverride — so payroll calc picks up the real rate
      // automatically instead of the firm-wide default. Visible for every
      // business client, not gated behind "MD UI Enabled", so it's there to
      // fill in regardless of whether that checkbox has been set yet.
      { key: "md_ui_employer_id", apiKey: "mdUiEmployerId", label: "MD UI Employer ID", kind: "text", hidden: (f) => !isBusiness(f) },
      { key: "md_ui_tax_rate", apiKey: "mdUiTaxRate", label: "MD UI Tax Rate (%)", kind: "text", hidden: (f) => !isBusiness(f) },
    ],
  },
  {
    title: "Owner / Responsible Party",
    fields: [
      { key: "company_contact_name", apiKey: "companyContactName", label: "Owner Name", kind: "text", hidden: (f) => !isBusiness(f) },
      { key: "company_contact_title", apiKey: "companyContactTitle", label: "Owner Title", kind: "text", hidden: (f) => !isBusiness(f) },
      { key: "company_contact_ssn", apiKey: "companyContactSsn", label: "Owner SS No.", kind: "text", hidden: (f) => !isBusiness(f) },
      { key: "company_contact_email", apiKey: "companyContactEmail", label: "Owner Email", kind: "text", hidden: (f) => !isBusiness(f) },
      { key: "company_contact_phone", apiKey: "companyContactPhone", label: "Owner Phone", kind: "text", hidden: (f) => !isBusiness(f) },
    ],
  },
  {
    // No FieldConfig entries — rendered as a special-cased checklist below
    // (multi-select doesn't fit the FieldKind union), same pattern AddressFields
    // uses for the "Contact & Address" section. Payroll/Sales Tax/Tax Prep/
    // Business Compliance render as nested sub-cards inside this one (see
    // nestedIn below), matching how the Add Client wizard nests them.
    title: "Services Provided",
    fields: [],
  },
  {
    title: "Payroll Details",
    nestedIn: "Services Provided",
    fields: [
      { key: "payroll_frequency", apiKey: "payrollFrequency", label: "Payroll Frequency", kind: "select", options: PAYROLL_FREQS, hidden: (f) => !showPayrollFrequency(f) },
      { key: "payroll_system", apiKey: "payrollSystem", label: "Payroll Provider", kind: "select", options: PAYROLL_PROVIDERS, hidden: (f) => !showPayrollSystem(f) },
      { key: "md_withholding_frequency", apiKey: "mdWithholdingFrequency", label: "MD Withholding Frequency", kind: "select", options: FREQ_OPTIONS, hidden: (f) => !showMdWithholding(f) },
      // Optional, explicitly staff-entered — NOT the same as Date of Formation.
      // A client can be formed before actually registering for/enrolling in a
      // given obligation. Leave blank if unknown: nothing changes (existing
      // fallback logic keeps working), but a real date here stops the
      // Compliance Timeline/Account Flags from treating periods before this
      // date as "missing." See sql/102_obligation_registered_since.sql.
      { key: "md_withholding_registered_since", apiKey: "mdWithholdingRegisteredSince", label: "MD Withholding Registered Since", kind: "date", hidden: (f) => !showMdWithholding(f) },
      { key: "eftps_enabled", apiKey: "eftpsEnabled", label: "EFTPS Enabled", kind: "checkbox", hidden: (f) => !showEftps(f) },
      { key: "eftps_registered_since", apiKey: "eftpsRegisteredSince", label: "EFTPS Registered Since", kind: "date", hidden: (f) => !showEftps(f) },
      { key: "mdui_enabled", apiKey: "mduiEnabled", label: "MD UI Enabled", kind: "checkbox", hidden: (f) => !showMdui(f) },
      { key: "mdui_registered_since", apiKey: "mduiRegisteredSince", label: "MD UI Registered Since", kind: "date", hidden: (f) => !showMdui(f) },
      { key: "w21099_enabled", apiKey: "w21099Enabled", label: "W-2 / 1099 Enabled", kind: "checkbox", hidden: (f) => !showW21099(f) },
    ],
  },
  {
    title: "Sales Tax Details",
    nestedIn: "Services Provided",
    fields: [
      { key: "sales_tax_frequency", apiKey: "salesTaxFrequency", label: "Sales Tax Frequency", kind: "select", options: FREQ_OPTIONS, hidden: (f) => !showSalesTaxDetails(f) },
      // Not a real client column — read/written specially (see load()'s
      // post-loop override and handleSave) since it only matters the moment
      // Sales Tax Frequency is actually being changed. Maryland reassigns a
      // client's frequency effective a specific date, not "as of whenever
      // staff happens to click Save," so this has to be a value staff can
      // set explicitly rather than always just "today."
      { key: "sales_tax_frequency_effective_date", apiKey: "salesTaxFrequencyEffectiveDate", label: "Frequency Effective Date", kind: "date", hidden: (f) => !showSalesTaxDetails(f) },
      // Different from Frequency Effective Date above (which tracks when the
      // CURRENT frequency began, and can change over time as MD reassigns
      // it) — this is the one-time fact of when the sales tax obligation
      // itself first existed. Optional; leave blank if unknown. See
      // sql/102_obligation_registered_since.sql.
      { key: "sales_tax_registered_since", apiKey: "salesTaxRegisteredSince", label: "Registered Since", kind: "date", hidden: (f) => !showSalesTaxDetails(f) },
    ],
  },
  {
    title: "Tax Preparation Details",
    nestedIn: "Services Provided",
    fields: [
      { key: "business_return_type", apiKey: "businessReturnType", label: "Business Return Type", kind: "select", options: RETURN_TYPES, hidden: (f) => !showTaxPrepDetails(f) },
    ],
  },
  {
    title: "Business Compliance",
    nestedIn: "Services Provided",
    fields: [
      { key: "md_annual_report_enabled", apiKey: "mdAnnualReportEnabled", label: "MD Annual Report Enabled", kind: "checkbox", hidden: (f) => !showMdAnnualReport(f) },
    ],
  },
  {
    title: "Assignment & Forms",
    fields: [
      { key: "assigned_to", apiKey: "assignedTo", label: "Assigned To", kind: "select" },
    ],
  },
  {
    title: "Notes",
    fields: [
      { key: "notes", apiKey: "notes", label: "Notes", kind: "textarea" },
    ],
  },
];
const ALL_FIELDS = EDIT_SECTIONS.flatMap((s) => s.fields);

const DETAIL_TABS = ["At a Glance", "SWOT Analysis", "Profile", "Compliance", "Responsible Party", "Account", "Activity Timeline", "Task Notes", "Tasks", "Documents", "Communications", "Billing", "Tax Payments", "Contracts", "Gov Forms", "Notices", "Tax Return Production", "Permits & Compliance", "Vault & Payment Methods", "Tax Forms"] as const;
type DetailTab = (typeof DETAIL_TABS)[number];
// Every client/employee can see their own basic profile & compliance info;
// the remaining tabs are internal staff tooling (task pipeline, contract
// drafting, vault secrets, payment method management, employer tax forms).
const STAFF_ONLY_TABS: DetailTab[] = ["At a Glance", "SWOT Analysis", "Activity Timeline", "Task Notes", "Tasks", "Documents", "Communications", "Billing", "Tax Payments", "Contracts", "Gov Forms", "Notices", "Tax Return Production", "Vault & Payment Methods", "Tax Forms"];

interface ClientSummary { openTasks: number; openRequests: number; openInvoices: number; balanceDue: number; employeesCount: number }

interface ClientFlag {
  flagId: string | null;
  flagType: "BalancePastDue" | "AgencyPastDue" | "SalesTaxFilingDue" | "SalesTaxBalanceDue" | "PayrollCadenceGap" | "BookkeepingStale" | "MissingComplianceTask" | "Credit" | "Custom";
  amount: number | null;
  note: string | null;
  color: "red" | "green" | "amber";
  createdAt: string | null;
  createdBy: string | null;
  resolvable: boolean;
  linkTaskId?: string;
  linkUrl?: string;
  category?: string | null;
  details?: string | null;
  dueDate?: string | null;
}
interface ComplianceScoreComponent { label: string; points: number; maxPoints: number; detail: string }
interface ClientComplianceScore { score: number; band: "Green" | "Yellow" | "Red"; components: ComplianceScoreComponent[]; currentlyOverdueCount: number }
interface TimelinePeriod { periodLabel: string; dueDate: string; status: "onTime" | "late" | "missing" | "notYetDue"; filedDate: string | null }
interface ComplianceTimelineLane { obligationType: string; periods: TimelinePeriod[] }
interface ClientFlagsResponse { flags: ClientFlag[]; complianceScore: ClientComplianceScore | null; complianceTimeline: ComplianceTimelineLane[] }

/** Turns bare URLs in freeform notes into clickable links, matching legacy's linkified notes field. */
function linkifyNotes(text: string): ReactNode[] {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={i} href={part} target="_blank" rel="noreferrer">{part}</a>
      : <span key={i}>{part}</span>
  );
}

export function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();
  const notify = useNotify();
  const [searchParams, setSearchParams] = useSearchParams();
  const [client, setClient] = useState<Client | null>(null);
  const [summary, setSummary] = useState<ClientSummary | null>(null);
  const [flags, setFlags] = useState<ClientFlag[] | null>(null);
  const [complianceScore, setComplianceScore] = useState<ClientComplianceScore | null>(null);
  const [complianceTimeline, setComplianceTimeline] = useState<ComplianceTimelineLane[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [profilePdfBusy, setProfilePdfBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(searchParams.get("edit") === "1");
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [profileCardWidth, setProfileCardWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(PROFILE_CARD_WIDTH_KEY));
    return Number.isFinite(saved) && saved > 0 ? clampProfileCardWidth(saved) : 560;
  });
  const [resizingProfileCard, setResizingProfileCard] = useState(false);
  function startProfileCardResize(e: ReactMouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = profileCardWidth;
    setResizingProfileCard(true);
    function onMove(ev: MouseEvent) {
      setProfileCardWidth(clampProfileCardWidth(startWidth + (ev.clientX - startX)));
    }
    function onUp() {
      setResizingProfileCard(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setProfileCardWidth((w) => { localStorage.setItem(PROFILE_CARD_WIDTH_KEY, String(w)); return w; });
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }
  const [editFormWidth, setEditFormWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(EDIT_FORM_WIDTH_KEY));
    return Number.isFinite(saved) && saved > 0 ? clampEditFormWidth(saved) : 1180;
  });
  const [resizingEditForm, setResizingEditForm] = useState(false);
  function startEditFormResize(e: ReactMouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = editFormWidth;
    setResizingEditForm(true);
    function onMove(ev: MouseEvent) {
      setEditFormWidth(clampEditFormWidth(startWidth + (ev.clientX - startX)));
    }
    function onUp() {
      setResizingEditForm(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setEditFormWidth((w) => { localStorage.setItem(EDIT_FORM_WIDTH_KEY, String(w)); return w; });
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Edit form jump-nav — same sticky-nav + scroll-spy pattern as the Add
  // Client wizard (ClientsListPage.tsx), so a client's profile edit form
  // isn't a visually different, older-feeling app than the form used to
  // create it.
  const [activeEditSection, setActiveEditSection] = useState("Client Identity");
  const editSectionRefs = useRef<Record<string, HTMLElement | null>>({});
  function scrollToEditSection(title: string) {
    editSectionRefs.current[title]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // Same collapse toggle + storage key as the Add Client wizard — one shared
  // preference for "I want the extra body width" across both forms.
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem("altax_ac_wizard_nav_collapsed") === "1");
  function toggleNavCollapsed() {
    setNavCollapsed((v) => {
      const next = !v;
      localStorage.setItem("altax_ac_wizard_nav_collapsed", next ? "1" : "0");
      return next;
    });
  }
  useEffect(() => {
    if (!editing) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActiveEditSection(visible[0].target.getAttribute("data-section-title") || "");
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: [0, 0.25, 0.5, 1] }
    );
    Object.values(editSectionRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [editing, form.clientType]);

  // Autosave for the Edit Client form — only active while actually editing
  // (formKey null otherwise), so viewing a client's profile never checks or
  // writes a draft that isn't in use.
  const editClientDraftKey = editing && clientId ? `edit-client:${clientId}` : null;
  const { pendingDraft: pendingEditDraft, draftChecked: editDraftChecked, saveDraft: saveEditDraft, clearDraft: clearEditDraft, dismissPendingDraft: dismissEditDraft } = useFormDraft<Record<string, any>>(editClientDraftKey);
  useEffect(() => {
    if (!editDraftChecked || pendingEditDraft || !editClientDraftKey) return;
    saveEditDraft(form);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDraftChecked, pendingEditDraft, editClientDraftKey, form]);
  const [inviteInfo, setInviteInfo] = useState<{ inviteLink?: string; inviteEmailed?: boolean; inviteEmailError?: string } | null>(null);
  const [emailChangeOpen, setEmailChangeOpen] = useState(false);
  const [staffOptions, setStaffOptions] = useState<string[]>([]);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [taskSearch, setTaskSearch] = useState("");
  const [comms, setComms] = useState<Communication[] | null>(null);
  const [commSearch, setCommSearch] = useState("");
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("At a Glance");
  const [requestDocTask, setRequestDocTask] = useState<Task | null>(null);
  // Ownership Transfer wizard's Step 4 "Generate All" drafts new gov-form
  // filings (8822-B/CRA/Amendment/Dissolution) that GovFormsSection below
  // already loaded before they existed — bumping reloadKey forces a re-fetch,
  // and highlightFilingIds lets it visually flag exactly the rows the wizard
  // just created, so "Jump to Government Forms" lands somewhere obviously new.
  const [ownershipReloadKey, setOwnershipReloadKey] = useState(0);
  const [ownershipHighlightFilingIds, setOwnershipHighlightFilingIds] = useState<string[]>([]);

  const canEdit = user?.role === "admin" || user?.role === "staff";
  const isAdmin = user?.role === "admin";
  const { allLabels, labels: clientLabelList, assign: assignClientLabel, unassign: unassignClientLabel } = useEntityLabel("client", clientId);
  const canArchive = user?.role === "admin";
  const canSeeStaffTabs = user?.role === "admin" || user?.role === "staff";
  const visibleTabs = DETAIL_TABS.filter((t) => canSeeStaffTabs || !STAFF_ONLY_TABS.includes(t));

  // Lifted here (rather than fetched inside ClientAtAGlance) so the header's
  // overdue badge can render regardless of which tab is active, and so
  // ClientAtAGlance doesn't need its own duplicate fetch of the same response.
  // Named (not inline) so ClientAtAGlance can also call it directly — e.g. after
  // creating a task from a Missing Compliance Task gap, to make that gap's flag
  // disappear as soon as the real fix exists, not on the next full page load.
  function loadFlags() {
    if (!clientId || !canSeeStaffTabs) { setFlags(null); setComplianceScore(null); setComplianceTimeline([]); return; }
    api.get<ClientFlagsResponse>(`/clients/${clientId}/flags`)
      .then((r) => { setFlags(r.flags); setComplianceScore(r.complianceScore); setComplianceTimeline(r.complianceTimeline); })
      .catch(() => { setFlags(null); setComplianceScore(null); setComplianceTimeline([]); });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadFlags, [clientId, canSeeStaffTabs]);

  useEffect(() => {
    if (!canEdit) return;
    api.get<{ users: PortalUser[] }>("/users")
      .then((res) => setStaffOptions(Array.from(new Set(res.users.filter((u) => ["admin", "staff"].includes(String(u.role || "").toLowerCase()) && u.active).map((u) => u.name))).sort()))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  function load() {
    if (!clientId) return;
    api.get<{ client: Client }>(`/clients/${clientId}`)
      .then((res) => {
        setClient(res.client);
        const initial: Record<string, any> = {};
        for (const f of ALL_FIELDS) {
          initial[f.apiKey] = f.kind === "checkbox" ? Boolean(res.client[f.key])
            : f.kind === "date" ? String(res.client[f.key] ?? "").slice(0, 10)
            : String(res.client[f.key] ?? "");
        }
        initial.services = Array.isArray(res.client.services) ? res.client.services : [];
        // Not a real client field — only meaningful to the server when Sales
        // Tax Frequency is actually being changed (see handleSave). Defaulting
        // this to "today" used to mean every no-touch resave of an MD client
        // silently submitted today's date as an intentional date correction
        // (clients.routes.ts's dateIsCorrection path can't tell "staff typed
        // this" from "the form pre-filled it"), overwriting a real historical
        // effective_from with today — this is exactly how the 2026-08-18
        // frequency-history fix for 4 GUYS/USA MARKET/etc. got silently undone
        // minutes after being applied. Defaulting to the client's own current
        // effective_from instead means an untouched resave round-trips the
        // same date back (a true no-op); defaulting to "" when there's no
        // history row yet lets the backend's own first-ever-row sentinel
        // ("2000-01-01") actually engage instead of being permanently shadowed
        // by an always-present "today".
        initial.salesTaxFrequencyEffectiveDate = res.client.sales_tax_frequency_effective_from
          ? String(res.client.sales_tax_frequency_effective_from).slice(0, 10)
          : "";
        // Not in EDIT_SECTIONS (no visible checkbox — kept in sync with the
        // "Payroll Services" entry in Services Provided instead, see below).
        initial.payrollEnabled = Boolean(res.client.payroll_enabled);
        initial.streetAddress = String(res.client.street_address ?? "");
        initial.city = String(res.client.city ?? "");
        initial.zipCode = String(res.client.zip_code ?? "");
        initial.companyContactStreetAddress = String(res.client.company_contact_street_address ?? "");
        initial.companyContactCity = String(res.client.company_contact_city ?? "");
        initial.companyContactState = String(res.client.company_contact_state ?? "");
        initial.companyContactZipCode = String(res.client.company_contact_zip_code ?? "");
        setForm(initial);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this client."));
    api.get<ClientSummary>(`/clients/${clientId}/summary`).then(setSummary).catch(() => {});
  }

  useEffect(load, [clientId]);

  function loadTasks() {
    if (!clientId || !(user?.role === "admin" || user?.role === "staff")) return;
    api.get<{ tasks: Task[] }>("/tasks")
      .then((res) => setTasks(res.tasks.filter((t) => t.client_id === clientId)))
      .catch(() => setTasks([]));
  }

  useEffect(loadTasks, [clientId, user?.role]);

  function loadComms() {
    if (!clientId || !(user?.role === "admin" || user?.role === "staff")) return;
    api.get<{ communications: Communication[] }>("/communications")
      .then((res) => setComms(res.communications.filter((c) => c.client_id === clientId)))
      .catch(() => setComms([]));
  }

  useEffect(loadComms, [clientId, user?.role]);

  const filteredTasks = useMemo(() => {
    const q = taskSearch.trim().toLowerCase();
    if (!q) return tasks || [];
    return (tasks || []).filter((t) => [t.task_name, t.status, t.assigned_to, t.service_line].some((v) => String(v || "").toLowerCase().includes(q)));
  }, [tasks, taskSearch]);

  const filteredComms = useMemo(() => {
    const q = commSearch.trim().toLowerCase();
    if (!q) return comms || [];
    return (comms || []).filter((c) => [c.subject, c.channel, c.sent_to, c.message_english].some((v) => String(v || "").toLowerCase().includes(q)));
  }, [comms, commSearch]);

  async function handleTaskStatusChange(taskId: string, status: string) {
    setSavingStatusId(taskId);
    try {
      await api.patch(`/tasks/${taskId}`, { status });
      toast("Status updated.");
      loadTasks();
      api.get<ClientSummary>(`/clients/${clientId}/summary`).then(setSummary).catch(() => {});
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not update status.");
    } finally {
      setSavingStatusId(null);
    }
  }

  async function handleTaskAction(task: Task, action: string) {
    if (action === "review-task" || action === "task-history") return navigate(`/tasks/${task.task_id}`);
    if (action === "task-message") return navigate(`/tasks/${task.task_id}?open=message`);
    if (action === "task-note") return navigate(`/tasks/${task.task_id}?open=note`);
    if (action === "edit-task") return navigate(`/tasks/${task.task_id}?open=edit`);
    if (action === "task-file") return navigate(`/tasks/${task.task_id}?open=files`);
    if (action === "request-doc") return setRequestDocTask(task);
    if (action === "void-task") {
      const reason = await promptFor({ title: "Void task", message: "Reason for voiding this task?" });
      if (reason === null) return;
      try {
        await api.post(`/tasks/${task.task_id}/void`, { reason });
        toast("Task voided.");
        loadTasks();
      } catch (err) {
        await notify(err instanceof ApiError ? err.message : "Could not void this task.");
      }
    }
    if (action === "delete-task") {
      const confirmValue = await promptFor({
        title: "Permanently delete task",
        message: `"${task.task_name}" — this cannot be undone. Type DELETE TASK to confirm.`,
        placeholder: "DELETE TASK",
      });
      if (confirmValue === null) return;
      try {
        await api.post(`/tasks/${task.task_id}/delete`, { confirm: confirmValue });
        toast("Task deleted.");
        loadTasks();
      } catch (err) {
        await notify(err instanceof ApiError ? err.message : "Could not delete this task.");
      }
    }
  }

  useEffect(() => {
    if (location.hash !== "#vault" || !client) return;
    setTab("Vault & Payment Methods");
  }, [location.hash, client]);

  // Command Center's At-Risk Clients panel deep-links here (/clients/:id#account-flags)
  // instead of landing on the generic client page with no further context —
  // Account Flags already lives on the default "At a Glance" tab, so this just
  // scrolls to it once flags have loaded (flags fetch async inside
  // ClientAtAGlance, hence the short delay rather than scrolling immediately).
  useEffect(() => {
    if (location.hash !== "#account-flags" || !client || tab !== "At a Glance") return;
    const t = setTimeout(() => {
      document.getElementById("account-flags")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 400);
    return () => clearTimeout(t);
  }, [location.hash, client, tab]);

  // Lets other pages deep-link straight to a tab, e.g. Task Detail's
  // "All Client Documents" button -> /clients/:id?tab=Documents.
  const tabParam = searchParams.get("tab");
  // Paired with ?tab=Activity Timeline (see the Clients list "Add Note" action)
  // to land directly on that tab with the add-note form already open, matching
  // the Task Detail Activity Timeline's ?open=note pattern.
  const openParam = searchParams.get("open");
  // Paired with ?tab=Gov Forms (see the Clients list "Add Client" card's
  // quick-launch selects) — land on the Gov Forms tab with the matching
  // generator modal already open and pre-set to the chosen form type, so
  // staff aren't forced into a second manual "+ Generate…" click right
  // after creating the client.
  const openGovFormParams = searchParams.getAll("openGovForm");
  const openAuthFormParams = searchParams.getAll("openAuthForm");
  // GovFormsSection/PoaFilingsSection each guard their own auto-open with a
  // useRef so the modal opens exactly once per MOUNT — but nothing previously
  // cleared these two params from the URL, so navigating away and back (e.g.
  // browser Back) remounts this page with the same URL, the ref resets, and
  // the generator modal pops open again unprompted. Stripping them here, once,
  // right after they've been read into the consts above (so this render's
  // props to the child sections are unaffected), makes the auto-open a true
  // one-time action tied to the link that created it rather than to the URL.
  const strippedAutoOpenParams = useRef(false);
  useEffect(() => {
    // Gated on tab === "Gov Forms" (not just !client) so this only strips the
    // params AFTER the tabParam effect below has switched to that tab and
    // mounted GovFormsSection/PoaFilingsSection with the still-intact prop
    // value — stripping any earlier (e.g. as soon as client loads, before the
    // tab switch commits) would race the tab switch and could clear the
    // params before the child ever saw them, silently dropping the auto-open.
    if (strippedAutoOpenParams.current || tab !== "Gov Forms") return;
    if (!openGovFormParams.length && !openAuthFormParams.length) return;
    strippedAutoOpenParams.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete("openGovForm");
    next.delete("openAuthForm");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, searchParams, setSearchParams]);
  const appliedTabParam = useRef<string | null>(null);
  useEffect(() => {
    if (!tabParam || !client || appliedTabParam.current === tabParam) return;
    const match = DETAIL_TABS.find(
      (t) => t.toLowerCase() === tabParam.toLowerCase() && (canSeeStaffTabs || !STAFF_ONLY_TABS.includes(t)),
    );
    // Apply once per param value, so clicking a different tab afterwards sticks.
    appliedTabParam.current = tabParam;
    if (match) setTab(match);
  }, [tabParam, client, canSeeStaffTabs]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!clientId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.patch(`/clients/${clientId}`, form);
      clearEditDraft();
      setEditing(false);
      setSearchParams({});
      toast("Client updated.");
      load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    if (!clientId || !client) return;
    const ok = await confirmDialog({
      title: "Archive client",
      message: `Archive ${client.client_name}? This disables their portal and deactivates their portal users.`,
      confirmLabel: "Archive",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(`/clients/${clientId}/archive`, {});
      toast(`${client.client_name} archived.`);
      navigate("/clients");
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not archive this client.");
    }
  }

  async function handleInvite() {
    if (!client) return;
    if (!client.email) { await notify("This client has no email on file. Add one before sending a portal invitation."); return; }
    try {
      const res = await api.post<{ inviteLink?: string; inviteEmailed?: boolean; inviteEmailError?: string }>("/users", {
        role: "client", assignedClientId: client.client_id, email: client.email, name: client.client_name,
      });
      setInviteInfo(res);
      toast(res.inviteEmailed ? "Portal invite emailed." : "Portal invite created.");
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not create a portal invite.");
    }
  }

  /** Backs the View/Print/Download trio shown on both "At a Glance" and "Profile" — neither had a print/PDF option before, since the earlier downloadFile() audit only checked existing download buttons for a missing view/print pair, not screens with no download button at all. */
  async function handleProfilePdf(variant: "profile" | "at-a-glance", mode: "view" | "download" | "print") {
    if (!client) return;
    setProfilePdfBusy(`${variant}-${mode}`);
    try {
      const path = `/reports/pdf/client-profile/${client.client_id}?variant=${variant}`;
      const label = variant === "at-a-glance" ? "At a Glance" : "Client Profile";
      if (mode === "view") await viewFile(path);
      else if (mode === "print") await printFile(path);
      else await downloadFile(path, buildFilename([client.client_name, label], "pdf"));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not generate this PDF.");
    } finally {
      setProfilePdfBusy(null);
    }
  }

  if (error) return <ErrorBanner error={error} />;
  if (!client) return <div className="spinner-wrap">Loading…</div>;

  const isBusinessClient = String(client.client_type || client.entity_type || "").toLowerCase() !== "individual";

  return (
    <div>
      {/* A single "← All clients" link told you how to leave, not where you were —
          several tabs deep (say, Vault → Tax Payments) there was no trail back
          through the path itself. BackLink's history-aware "go back to my exact
          prior view" behavior is still genuinely useful and stays; this adds the
          structural Clients / [Name] / [Tab] trail alongside it. */}
      <nav aria-label="Breadcrumb" style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Link to="/clients" className="muted" style={{ textDecoration: "none" }}>Clients</Link>
        <span aria-hidden="true">/</span>
        <span>{client.client_name}</span>
        <span aria-hidden="true">/</span>
        <span style={{ color: "var(--ink)", fontWeight: 700 }}>{tab}</span>
      </nav>
      <div style={{ display: "flex", alignItems: "center" }}>
        <BackLink fallback="/clients" fallbackLabel="All clients" />
        <PrevNextNav basePath="/clients" {...getAdjacentIds("clients", clientId)} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", margin: "8px 0 24px", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="muted" style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em" }}>{client.client_id}</div>
          <h1 style={{ fontSize: 22, margin: "2px 0 4px" }}>{client.client_name}</h1>
          {String(client.dba_name || "").trim() && (
            <div className="muted" style={{ fontSize: 13, margin: "-2px 0 6px" }}>DBA: {client.dba_name as string}</div>
          )}
          <StatusBadge status={client.status} />
          {complianceScore && complianceScore.currentlyOverdueCount > 0 && (
            <span className="status-pill status-red" style={{ marginLeft: 6 }}>
              {complianceScore.currentlyOverdueCount} Overdue
            </span>
          )}
          <LabelChips labels={clientLabelList} onRemove={canEdit ? unassignClientLabel : undefined} />
          {canEdit && (
            <LabelPicker allLabels={allLabels} assignedIds={new Set(clientLabelList.map((l) => l.label_id))} onAdd={assignClientLabel} />
          )}
        </div>
      </div>

      {editing ? (
        <form onSubmit={handleSave} className="card resizable-card" style={{ width: editFormWidth, maxWidth: "100%" }}>
          <div
            className={`resizable-card-handle ${resizingEditForm ? "dragging" : ""}`}
            onMouseDown={startEditFormResize}
            title="Drag to resize"
          />
          {pendingEditDraft && (
            <DraftRestoreBanner
              updatedAt={pendingEditDraft.updatedAt}
              onRestore={() => { setForm(pendingEditDraft.data); dismissEditDraft(); }}
              onDiscard={() => { clearEditDraft(); dismissEditDraft(); }}
            />
          )}
          {saveError && <ErrorBanner error={saveError} />}
          {(() => {
            const renderEditField = (f: FieldConfig) => (
              f.kind === "checkbox" ? (
                <label key={f.apiKey} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 6 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(form[f.apiKey])}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.apiKey]: e.target.checked }))}
                  />
                  {f.label}
                </label>
              ) : f.kind === "select" ? (
                <div className="field" key={f.apiKey}>
                  <label htmlFor={f.apiKey}>{f.label}</label>
                  <select id={f.apiKey} value={form[f.apiKey] ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, [f.apiKey]: e.target.value }))}>
                    <option value="">{f.apiKey === "assignedTo" ? "Unassigned" : "Select…"}</option>
                    {f.apiKey === "assignedTo" && form[f.apiKey] && !staffOptions.includes(form[f.apiKey]) && (
                      <option value={form[f.apiKey]}>{form[f.apiKey]} (Inactive)</option>
                    )}
                    {(f.apiKey === "assignedTo" ? staffOptions : f.options || []).map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
              ) : f.kind === "multiselect" ? (
                // Stored as a single comma-joined string (e.g. "Email, SMS") in the
                // same plain-text column a single-select used — no schema change,
                // and nothing downstream parses this field strictly (real send-channel
                // gating already uses the separate smsAllowed/emailAllowed checkboxes).
                <div className="field" key={f.apiKey}>
                  <label>{f.label}</label>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6 }}>
                    {(f.options || []).map((o) => {
                      const selected = String(form[f.apiKey] || "").split(",").map((s) => s.trim()).filter(Boolean);
                      return (
                        <label key={o} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={selected.includes(o)}
                            onChange={(e) => setForm((prev) => {
                              const prevSelected = String(prev[f.apiKey] || "").split(",").map((s) => s.trim()).filter(Boolean);
                              const next = e.target.checked ? [...prevSelected, o] : prevSelected.filter((v) => v !== o);
                              return { ...prev, [f.apiKey]: next.join(", ") };
                            })}
                          />
                          {o}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : f.kind === "textarea" ? (
                <div className="field" style={{ gridColumn: "1 / -1" }} key={f.apiKey}>
                  <label htmlFor={f.apiKey}>{f.label}</label>
                  <textarea id={f.apiKey} rows={f.key === "notes" ? 3 : 2} value={form[f.apiKey] ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, [f.apiKey]: e.target.value }))} />
                </div>
              ) : f.kind === "date" ? (
                <div className="field" key={f.apiKey}>
                  <label htmlFor={f.apiKey}>{f.label}</label>
                  <input id={f.apiKey} type="date" value={form[f.apiKey] ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, [f.apiKey]: e.target.value }))} />
                </div>
              ) : (
                <div className="field" key={f.apiKey}>
                  <label htmlFor={f.apiKey}>{f.label}</label>
                  <input id={f.apiKey} list={f.suggestions ? `${f.apiKey}-list` : undefined} value={form[f.apiKey] ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, [f.apiKey]: e.target.value }))} />
                  {f.suggestions && (
                    <datalist id={`${f.apiKey}-list`}>
                      {f.suggestions.map((o) => <option key={o} value={o} />)}
                    </datalist>
                  )}
                </div>
              )
            );

            const EDIT_SECTION_ICONS: Record<string, typeof Building2> = {
              "Client Identity": Building2, "Contact & Address": MapPin, "Business Tax IDs": FileText,
              "Owner / Responsible Party": UserRound, "Services Provided": Briefcase,
              "Assignment & Forms": ClipboardList, "Notes": StickyNote,
            };
            const topLevelSections = EDIT_SECTIONS.filter((s) => !s.nestedIn);
            const sectionVisible = (section: (typeof EDIT_SECTIONS)[number]) => {
              const visibleFields = section.fields.filter((f) => !f.hidden || !f.hidden(form));
              return visibleFields.length > 0 || section.title === "Services Provided";
            };

            return (
              <div className={`ac-wizard${navCollapsed ? " nav-collapsed" : ""}`}>
                <nav className="ac-wizard-nav" aria-label="Client profile sections">
                  <button
                    type="button" className="ac-wizard-nav-toggle" onClick={toggleNavCollapsed}
                    title={navCollapsed ? "Show section list" : "Hide section list"}
                    aria-label={navCollapsed ? "Show section list" : "Hide section list"}
                  >
                    {navCollapsed ? <PanelLeft size={15} /> : <PanelLeftClose size={15} />}
                  </button>
                  <div className="ac-wizard-nav-links">
                    {topLevelSections.filter(sectionVisible).map((section) => {
                      const Icon = EDIT_SECTION_ICONS[section.title] || FileText;
                      return (
                        <button key={section.title} type="button" className={activeEditSection === section.title ? "active" : ""} onClick={() => scrollToEditSection(section.title)}>
                          <Icon size={15} /> {section.title}
                        </button>
                      );
                    })}
                  </div>
                </nav>
                <div className="ac-wizard-body">
                  {topLevelSections.map((section) => {
                    const visibleFields = section.fields.filter((f) => !f.hidden || !f.hidden(form));
                    // A section with nothing currently visible shouldn't render an
                    // empty card — only "Services Provided" is allowed to have zero
                    // FieldConfig entries (it renders its own checklist + nested
                    // sub-cards below instead).
                    if (visibleFields.length === 0 && section.title !== "Services Provided") return null;
                    const Icon = EDIT_SECTION_ICONS[section.title] || FileText;
                    return (
                      <section
                        key={section.title}
                        data-section-title={section.title}
                        ref={(el) => { editSectionRefs.current[section.title] = el; }}
                        className="ac-card"
                      >
                        <div className="ac-card-header"><Icon size={16} /><h3>{section.title}</h3></div>
                        {section.title === "Services Provided" && (
                          <>
                            <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
                              Select every service this client is engaged for — the Contracts section below will suggest the matching contract for each one.
                              {!isBusiness(form) && " Showing individual-relevant services only; switch Client Type to Business to see the rest."}
                            </p>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px 16px", marginBottom: 16 }}>
                              {servicesForClientType(form.clientType, form.services as string[] || []).map((s) => (
                                <label key={s.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                                  <input
                                    type="checkbox"
                                    checked={(form.services as string[] || []).includes(s.key)}
                                    onChange={(e) => setForm((prev) => {
                                      const services = e.target.checked
                                        ? [...(prev.services as string[] || []), s.key]
                                        : (prev.services as string[] || []).filter((k) => k !== s.key);
                                      return { ...prev, services, payrollEnabled: services.includes("payroll") };
                                    })}
                                  />
                                  {s.label}
                                </label>
                              ))}
                            </div>
                          </>
                        )}
                        <div className="form-grid-3">{visibleFields.map(renderEditField)}</div>
                        {section.title === "Client Identity" && (
                          <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
                            Service Type: <strong>{deriveServiceType(form.services as string[]) || "—"}</strong> (from the Services Provided checkboxes below, not set directly)
                          </p>
                        )}
                        {section.title === "Contact & Address" && (
                          <>
                            <div className="ac-subcard-title" style={{ marginTop: 14 }}>{isBusiness(form) ? "Business Address" : "Address"}</div>
                            <AddressFields
                              idPrefix="cd"
                              showStateField={false}
                              value={{ street: form.streetAddress ?? "", city: form.city ?? "", state: form.state ?? "", zip: form.zipCode ?? "" }}
                              onChange={(patch) => setForm((prev) => ({
                                ...prev,
                                streetAddress: patch.street ?? prev.streetAddress,
                                city: patch.city ?? prev.city,
                                zipCode: patch.zip ?? prev.zipCode,
                                state: patch.state ?? prev.state,
                              }))}
                            />
                          </>
                        )}
                        {section.title === "Owner / Responsible Party" && isBusiness(form) && (
                          <>
                            <div className="ac-subcard-title" style={{ marginTop: 14 }}>Owner Home Address</div>
                            <AddressFields
                              idPrefix="cd-rp"
                              value={{ street: form.companyContactStreetAddress ?? "", city: form.companyContactCity ?? "", state: form.companyContactState ?? "", zip: form.companyContactZipCode ?? "" }}
                              onChange={(patch) => setForm((prev) => ({
                                ...prev,
                                companyContactStreetAddress: patch.street ?? prev.companyContactStreetAddress,
                                companyContactCity: patch.city ?? prev.companyContactCity,
                                companyContactZipCode: patch.zip ?? prev.companyContactZipCode,
                                companyContactState: patch.state ?? prev.companyContactState,
                              }))}
                            />
                          </>
                        )}
                        {section.title === "Services Provided" && EDIT_SECTIONS.filter((s) => s.nestedIn === "Services Provided").map((nested) => {
                          const nestedVisible = nested.fields.filter((f) => !f.hidden || !f.hidden(form));
                          if (nestedVisible.length === 0) return null;
                          return (
                            <div className="ac-subcard" key={nested.title}>
                              <div className="ac-subcard-title">{nested.title}</div>
                              <div className="form-grid-3">{nestedVisible.map(renderEditField)}</div>
                            </div>
                          );
                        })}
                        {section.title === "Notes" && (
                          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                            <button type="submit" className={`btn btn-primary${saving ? " btn-loading" : ""}`} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
                            <button type="button" className="btn" onClick={() => { setEditing(false); setSearchParams({}); }}>Cancel</button>
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </form>
      ) : (
        <>
          <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--line)", marginBottom: 20, flexWrap: "wrap" }}>
            {visibleTabs.map((t) => (
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
          </div>

          {tab === "At a Glance" && canSeeStaffTabs && (
            <ClientAtAGlance
              clientId={client.client_id}
              summary={summary}
              flags={flags}
              complianceScore={complianceScore}
              complianceTimeline={complianceTimeline}
              onNavigateTab={(t) => { setTab(t as DetailTab); setSearchParams({ tab: t }, { replace: true }); }}
              onFlagsChanged={loadFlags}
              headerActions={
                <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  <button type="button" className="btn btn-sm" disabled={profilePdfBusy !== null} onClick={() => handleProfilePdf("at-a-glance", "view")}>{profilePdfBusy === "at-a-glance-view" ? "Opening…" : "View / Print PDF"}</button>
                  <button type="button" className="btn btn-sm" disabled={profilePdfBusy !== null} onClick={() => handleProfilePdf("at-a-glance", "print")}>{profilePdfBusy === "at-a-glance-print" ? "Printing…" : "Print"}</button>
                  <button type="button" className="btn btn-sm" disabled={profilePdfBusy !== null} onClick={() => handleProfilePdf("at-a-glance", "download")}>{profilePdfBusy === "at-a-glance-download" ? "Generating…" : "Download PDF"}</button>
                </div>
              }
            />
          )}

          {tab === "SWOT Analysis" && canSeeStaffTabs && (
            <ClientSwotSection clientId={client.client_id} clientName={client.client_name} />
          )}

          {tab === "Profile" && (
            <>
              {inviteInfo && (
                <div className="card" style={{ maxWidth: 560, marginBottom: 16, borderColor: "var(--teal)" }}>
                  <strong>Portal invite created for {client.client_name}.</strong>{" "}
                  {inviteInfo.inviteEmailed ? (
                    <>Emailed to {client.email}.</>
                  ) : (
                    <>{inviteInfo.inviteEmailError ? `Email not sent: ${inviteInfo.inviteEmailError}` : "Email not sent."} Copy this link and send it to them yourself:</>
                  )}
                  {!inviteInfo.inviteEmailed && (
                    <div style={{ marginTop: 8, wordBreak: "break-all", fontFamily: "monospace", fontSize: 12 }}>
                      {inviteInfo.inviteLink || "Invite already existed; open Users & Access to resend it."}
                    </div>
                  )}
                  <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setInviteInfo(null)}>Dismiss</button>
                </div>
              )}
              <div className="card resizable-card" style={{ width: profileCardWidth, maxWidth: "100%" }}>
                <div
                  className={`resizable-card-handle ${resizingProfileCard ? "dragging" : ""}`}
                  onMouseDown={startProfileCardResize}
                  title="Drag to resize"
                />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h2 style={{ fontSize: 15, margin: 0 }}>Profile</h2>
                  <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {canSeeStaffTabs && <button type="button" className="btn btn-sm" disabled={profilePdfBusy !== null} onClick={() => handleProfilePdf("profile", "view")}>{profilePdfBusy === "profile-view" ? "Opening…" : "View / Print PDF"}</button>}
                    {canSeeStaffTabs && <button type="button" className="btn btn-sm" disabled={profilePdfBusy !== null} onClick={() => handleProfilePdf("profile", "download")}>{profilePdfBusy === "profile-download" ? "Generating…" : "Download PDF"}</button>}
                    {isAdmin && <button className="btn btn-sm" onClick={handleInvite}>Send Portal Invitation</button>}
                    {isAdmin && <button className="btn btn-sm" onClick={() => setEmailChangeOpen(true)}>Change Sign-In Email</button>}
                    {canEdit && <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>}
                  </div>
                </div>
                <DetailRow label="Client Type" value={client.client_type} />
                <DetailRow label="Entity Type" value={client.entity_type} />
                <DetailRow label="Date of Formation" value={client.date_of_formation ? fmtDateOnly(client.date_of_formation) : null} />
                <DetailRow label="State" value={client.state} />
                <DetailRow label="Service Type" value={client.service_type} />
                <DetailRow
                  label="Services Provided"
                  value={(client.services && client.services.length > 0)
                    ? client.services.map((k) => FIRM_SERVICES.find((s) => s.key === k)?.label || k).join(", ")
                    : null}
                  multiline
                />
                <DetailRow label="Email" value={client.email} />
                <DetailRow label="Phone" value={client.phone} />
                <DetailRow label="Address" value={client.address as string | null} multiline />
                <DetailRow label="Assigned To (Owner)" value={client.assigned_to} />
                <DetailRow label="Preferred Contact" value={client.preferred_contact as string | null} />
                <DetailRow label="Preferred Language" value={client.preferred_language as string | null} />
                <DetailRow label="SMS Enabled" value={client.sms_allowed ? "Yes" : "No"} />
                <DetailRow label="Email Enabled" value={client.email_allowed ? "Yes" : "No"} />
                <DetailRow label="Portal Enabled" value={client.portal_enabled ? "Yes" : "No"} />
                <DetailRow label="Referral Source" value={client.referral_source as string | null} />
              </div>
              {String(client.notes || "").trim() && (
                <div className="card" style={{ maxWidth: 560, marginTop: 20 }}>
                  <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Notes</h2>
                  <p style={{ fontSize: 13, whiteSpace: "pre-wrap", margin: 0 }}>{linkifyNotes(String(client.notes))}</p>
                </div>
              )}
            </>
          )}

          {tab === "Compliance" && (
            <div className="card" style={{ maxWidth: 560 }}>
              <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Compliance &amp; Tax IDs</h2>
              <p className="muted" style={{ marginBottom: 12 }}>
                {user?.role === "admin" ? "Shown in full — you are signed in as Admin." : "Sensitive fields are masked for your role."}
              </p>
              {isBusinessClient ? (
                <DetailRow label="EIN" value={client.ein as string | null} />
              ) : (
                <DetailRow label="Individual SSN" value={client.individual_ssn as string | null} />
              )}
              {isBusinessClient && <DetailRow label="State Tax ID" value={client.state_tax_id as string | null} />}
              {isBusinessClient && <DetailRow label="Secretary of State ID (SDAT)" value={client.secretary_of_state_id as string | null} />}
              {isBusinessClient && <DetailRow label="CRA / Central Registration No." value={client.cra_registration_number as string | null} />}
              {isBusinessClient && <DetailRow label="MD UI Employer ID" value={client.md_ui_employer_id as string | null} />}
              {isBusinessClient && (
                <DetailRow label="MD UI Tax Rate" value={client.md_ui_tax_rate != null ? `${Number(client.md_ui_tax_rate)}%` : null} />
              )}
              <DetailRow
                label="Sales Tax Frequency"
                value={client.sales_tax_frequency
                  ? (client.sales_tax_frequency_effective_from
                      ? `${client.sales_tax_frequency} (effective since ${fmtDateOnly(client.sales_tax_frequency_effective_from)})`
                      : client.sales_tax_frequency)
                  : null}
              />
              <DetailRow label="Payroll Enabled" value={client.payroll_enabled ? "Yes" : "No"} />
              {Boolean(client.payroll_enabled) && <DetailRow label="Payroll Frequency" value={client.payroll_frequency as string | null} />}
              {Boolean(client.payroll_enabled) && <DetailRow label="Payroll Provider" value={client.payroll_system as string | null} />}
              <DetailRow label="EFTPS Enabled" value={client.eftps_enabled ? "Yes" : "No"} />
              <DetailRow label="MD Withholding Frequency" value={client.md_withholding_frequency as string | null} />
              <DetailRow label="MD UI Enabled" value={client.mdui_enabled ? "Yes" : "No"} />
              <DetailRow label="MD Annual Report Enabled" value={client.md_annual_report_enabled ? "Yes" : "No"} />
              <DetailRow label="Business Return Type" value={client.business_return_type as string | null} />
              <DetailRow label="W-2 / 1099 Enabled" value={client.w21099_enabled ? "Yes" : "No"} />
            </div>
          )}

          {tab === "Responsible Party" && (
            <div className="card" style={{ maxWidth: 560 }}>
              <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Responsible Party</h2>
              {isBusinessClient ? (
                <>
                  <DetailRow label="Owner Name" value={client.company_contact_name as string | null} />
                  <DetailRow label="Owner Title" value={client.company_contact_title as string | null} />
                  <DetailRow label="Owner SS No." value={client.company_contact_ssn as string | null} />
                  <DetailRow label="Owner Email" value={client.company_contact_email as string | null} />
                  <DetailRow label="Owner Phone" value={client.company_contact_phone as string | null} />
                  <DetailRow label="Owner Home Address" value={client.company_contact_address as string | null} multiline />
                </>
              ) : (
                <p className="muted">Not applicable for individual clients.</p>
              )}
            </div>
          )}

          {tab === "Account" && (
            <div className="card" style={{ maxWidth: 560 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2 style={{ fontSize: 15, margin: 0 }}>Account</h2>
                {canArchive && String(client.status || "").toLowerCase() !== "archived" && (
                  <button className="btn btn-sm btn-danger" onClick={handleArchive}>Archive</button>
                )}
              </div>
              <DetailRow label="Open Tasks" value={summary ? String(summary.openTasks) : "—"} />
              <DetailRow label="Open Document Requests" value={summary ? String(summary.openRequests) : "—"} />
              <DetailRow label="Open Invoices" value={summary ? String(summary.openInvoices) : "—"} />
              <DetailRow label="Balance Due" value={summary ? `$${summary.balanceDue.toFixed(2)}` : "—"} />
              <DetailRow label="Employees" value={summary ? String(summary.employeesCount) : "—"} />
            </div>
          )}

          {tab === "Tasks" && canSeeStaffTabs && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
                <strong style={{ fontSize: 14 }}>Tasks</strong>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="text" placeholder="Search tasks…" value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", width: 180 }} />
                  <span className="muted" style={{ fontSize: 12 }}>{tasks ? `${filteredTasks.length} of ${tasks.length} task(s)` : "Loading…"}</span>
                  <button type="button" className="btn btn-sm" onClick={() => navigate(`/tasks?new=1&clientId=${client.client_id}`)}>+ New Task</button>
                </div>
              </div>
              <div className="table-scroll">
              <table>
                <thead><tr><th scope="col">Task</th><th scope="col">Service</th><th scope="col">Due</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
                <tbody>
                  {filteredTasks.map((t) => (
                    <tr key={t.task_id}>
                      <td><Link to={`/tasks/${t.task_id}`}>{t.task_name}</Link></td>
                      <td className="muted">{t.service_line || "—"}</td>
                      <td className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>{fmtDateOnly(t.agency_due_date)} <DueLabel task={t} /></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select className={`inline-select ${colorClassFor(t.status || "Not Started")}`} value={t.status || "Not Started"} disabled={savingStatusId === t.task_id} onChange={(e) => handleTaskStatusChange(t.task_id, e.target.value)}>
                          {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          {user?.role !== "client" && TASK_QUICK_ACTIONS.map((a) => {
                            const Icon = TASK_QUICK_ACTION_ICON[a.value];
                            return (
                              <button key={a.value} type="button" className="btn btn-sm" onClick={() => handleTaskAction(t, a.value)}>
                                {Icon && <Icon size={13} strokeWidth={2} aria-hidden="true" />}
                                {a.label}
                              </button>
                            );
                          })}
                          <ActionMenu options={taskActionOptions(user?.role)} onSelect={(action) => handleTaskAction(t, action)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              {tasks && tasks.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No tasks for this client yet.</p>}
              {tasks && tasks.length > 0 && filteredTasks.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No tasks match "{taskSearch}".</p>}
            </div>
          )}

          {tab === "Documents" && canSeeStaffTabs && (
            <>
              <ClientChecklistSection clientId={client.client_id} />
              <ClientDocumentsSection clientId={client.client_id} clientName={client.client_name} />
            </>
          )}

          {tab === "Activity Timeline" && canSeeStaffTabs && (
            <ClientActivitySection clientId={client.client_id} autoOpen={openParam === "note"} />
          )}

          {tab === "Task Notes" && canSeeStaffTabs && (
            <ClientTaskNotesInboxSection clientId={client.client_id} />
          )}

          {tab === "Communications" && canSeeStaffTabs && (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                <input type="text" placeholder="Search message history…" value={commSearch} onChange={(e) => setCommSearch(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", width: 220 }} />
              </div>
              <ClientMessages client={client} messages={filteredComms} onSent={loadComms} />
            </>
          )}

          {tab === "Billing" && canSeeStaffTabs && (
            <ClientBillingSection clientId={client.client_id} clientName={client.client_name} />
          )}

          {tab === "Tax Payments" && canSeeStaffTabs && (
            <ClientTaxPaymentsSection clientId={client.client_id} />
          )}

          {tab === "Contracts" && canSeeStaffTabs && (
            <ContractsSection clientId={client.client_id} clientName={client.client_name} clientServices={client.services || []} />
          )}

          {tab === "Gov Forms" && canSeeStaffTabs && (
            <Fragment>
              <PoaFilingsSection clientId={client.client_id} clientName={client.client_name} autoOpenFormTypes={openAuthFormParams} />
              <div id="gov-forms-section" style={{ marginTop: 16 }}>
                <GovFormsSection
                  clientId={client.client_id} clientName={client.client_name} autoOpenFormTypes={openGovFormParams}
                  reloadKey={ownershipReloadKey} highlightFilingIds={ownershipHighlightFilingIds}
                />
              </div>
              <div style={{ marginTop: 16 }}>
                <OwnershipTransferSection
                  clientId={client.client_id}
                  clientName={client.client_name}
                  sellerNameDefault={(client.company_contact_name as string | null) || undefined}
                  sellerTitleDefault={(client.company_contact_title as string | null) || undefined}
                  onFilingsGenerated={(filingIds) => { setOwnershipHighlightFilingIds(filingIds); setOwnershipReloadKey((k) => k + 1); }}
                  onClientUpdated={load}
                />
              </div>
            </Fragment>
          )}

          {tab === "Notices" && canSeeStaffTabs && (
            <NoticesSection clientId={client.client_id} />
          )}

          {tab === "Tax Return Production" && canSeeStaffTabs && (
            <TaxReturnProductionSection clientId={client.client_id} defaultReturnType={client.business_return_type as string | null} />
          )}

          {tab === "Permits & Compliance" && canSeeStaffTabs && (
            <HealthPermitsSection clientId={client.client_id} />
          )}

          {tab === "Vault & Payment Methods" && canSeeStaffTabs && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }} id="vault-section">
              {user?.role === "admin" && <VaultSection clientId={client.client_id} />}
              <PaymentMethodsSection clientId={client.client_id} />
            </div>
          )}

          {tab === "Tax Forms" && canSeeStaffTabs && (
            <EmployerTaxFormsSection clientId={client.client_id} clientName={client.client_name} />
          )}
        </>
      )}

      {requestDocTask && (
        <RequestDocumentModal
          clientId={client.client_id}
          clientName={client.client_name}
          taskId={requestDocTask.task_id}
          onClose={() => setRequestDocTask(null)}
          onDone={loadTasks}
        />
      )}
      {emailChangeOpen && (
        <ChangePortalEmailModal
          clientId={client.client_id}
          clientName={client.client_name}
          contactEmail={client.email}
          onClose={() => setEmailChangeOpen(false)}
          onDone={load}
        />
      )}
    </div>
  );
}

const CONTRACT_STATUS_COLOR: Record<string, string> = {
  Draft: "var(--muted)", Sent: "var(--amber)", Signed: "var(--green)", Void: "var(--red)",
};

/**
 * Service-contract suggestions + generated contract list for this client. Every
 * service checked in "Services Provided" above that has no active (non-Void)
 * contract yet gets a "Generate Contract" prompt — this is the literal feature
 * request: "whenever we add a client the system should suggest the appropriate
 * contract based on the service we will provide." Generated contracts start as
 * Draft, move to Sent (emails the client a signing link) or Signed (client
 * e-signed via that link), and can be Voided but never hard-deleted, since these
 * are legal records.
 */
/**
 * Everything on file for this client, on the client's own profile — this is now the
 * primary place to manage a single client's documents (request, send, archive,
 * revoke), not just a read-only mirror of the global Documents page. That global page
 * used to be the only way to do any of this, meaning every action meant leaving
 * whichever client you were looking at — flagged directly as confusing, and it's why
 * the global page is now a firm-wide triage view only (see DocumentsListPage).
 *
 * "Files on File" deliberately excludes Internal/task-attached uploads (direction
 * "Internal", hidden_from_client=true) — those are staff's own working files for a
 * specific task, not something the client has or the client relationship "owns", and
 * mixing them in here is exactly the "same file listed twice, once Internal once
 * Firm to Client" confusion spotted live. Task attachments live on that task's own
 * page instead.
 */
function ClientDocumentsSection({ clientId, clientName }: { clientId: string; clientName: string }) {
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
  const [fileSearch, setFileSearch] = useState("");

  function load() {
    api.get<{ uploads: DocumentUpload[] }>("/documents/uploads")
      .then((r) => setUploads(r.uploads.filter((u) =>
        u.client_id === clientId && !u.employee_id
        && !["removed", "replaced"].includes(String(u.status || "").toLowerCase())
        && String(u.direction || "").toLowerCase() !== "internal"
      )))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load documents."));
    api.get<{ requests: DocumentRequest[] }>("/documents/requests")
      .then((r) => setRequests(r.requests.filter((q) => q.client_id === clientId)))
      .catch(() => setRequests([]));
  }
  useEffect(load, [clientId]);

  const openRequests = (requests || []).filter((r) => !["closed", "completed", "void", "archived"].includes(String(r.status || "").toLowerCase()));
  const fq = fileSearch.trim().toLowerCase();
  const searchedUploads = fq ? (uploads || []).filter((u) => [u.file_name, u.direction, (u as any).uploaded_by].some((v) => String(v || "").toLowerCase().includes(fq))) : (uploads || []);
  const activeUploads = searchedUploads.filter((u) => !u.hidden_from_staff);
  const archivedUploads = searchedUploads.filter((u) => u.hidden_from_staff);

  async function handleRevoke(uploadId: string) {
    const ok = await confirmDialog({ title: "Revoke file", message: `Revoke this file? It will disappear from ${clientName}'s portal too, not just from here. If you just want to clean up this list without affecting them, use Archive instead.`, confirmLabel: "Revoke", danger: true });
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
      toast(`Archived — ${clientName} still sees this file.`);
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

  function FileRow({ u, archived }: { u: DocumentUpload; archived: boolean }) {
    return (
      <tr style={archived ? { opacity: 0.6 } : undefined}>
        <td data-label="File">{u.file_name}{archived && <span className="muted" style={{ fontSize: 11 }}> (archived)</span>}</td>
        <td className="muted" data-label="Direction">{u.direction || "—"}</td>
        <td className="muted" data-label="Uploaded">{u.uploaded_at ? fmtDateTime(u.uploaded_at) : "—"}</td>
        <td className="muted" data-label="By">{String((u as any).uploaded_by || "—")}</td>
        <td data-label="Action" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="link-button" onClick={() => openAnyFile(u.file_url)}>Open</button>
          <button type="button" className="link-button" onClick={() => downloadAnyFile(u.file_url, u.file_name || "document")}>Download</button>
          <button type="button" className="link-button" onClick={() => printAnyFile(u.file_url)}>Print</button>
          {archived ? (
            <button type="button" className="link-button" disabled={archivingId === u.upload_id} onClick={() => handleUnarchive(u.upload_id)}>{archivingId === u.upload_id ? "…" : "Unarchive"}</button>
          ) : (
            <button type="button" className="link-button" disabled={archivingId === u.upload_id} onClick={() => handleArchive(u.upload_id)}>{archivingId === u.upload_id ? "…" : "Archive"}</button>
          )}
          <button type="button" className="link-button" style={{ color: "var(--red)" }} disabled={removingId === u.upload_id} onClick={() => handleRevoke(u.upload_id)}>{removingId === u.upload_id ? "…" : "Revoke"}</button>
        </td>
      </tr>
    );
  }

  return (
    <div>
      {error && <ErrorBanner error={error} />}

      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", gap: 8 }}>
          <strong style={{ fontSize: 14 }}>Files on File</strong>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input type="text" placeholder="Search files…" value={fileSearch} onChange={(e) => setFileSearch(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", width: 160 }} />
            <span className="muted" style={{ fontSize: 12 }}>{uploads ? `${searchedUploads.length} of ${uploads.length} file(s)` : "Loading…"}</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setUploadOpen(true)}>Send File to Client</button>
            <button type="button" className="btn btn-sm" onClick={() => setRequestOpen(true)}>Request Document</button>
          </div>
        </div>
        <div className="table-scroll card-table">
          <table>
            <thead><tr><th scope="col">File</th><th scope="col">Direction</th><th scope="col">Uploaded</th><th scope="col">By</th><th scope="col">Action</th></tr></thead>
            <tbody>
              {activeUploads.map((u) => <FileRow key={u.upload_id} u={u} archived={false} />)}
              {archivedUploads.map((u) => <FileRow key={u.upload_id} u={u} archived={true} />)}
            </tbody>
          </table>
        </div>
        {uploads && uploads.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No files on file for this client yet.</p>}
        {uploads && uploads.length > 0 && searchedUploads.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No files match "{fileSearch}".</p>}
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
          <strong style={{ fontSize: 14 }}>Open Requests</strong>
          <span className="muted" style={{ fontSize: 12 }}>{requests ? `${openRequests.length} open` : "Loading…"}</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">Requested Item</th><th scope="col">Due From Client</th><th scope="col">Status</th></tr></thead>
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
        {requests && openRequests.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>Nothing outstanding from this client.</p>}
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        Looking for what's outstanding across every client? <Link to="/documents">Open the firm-wide Documents queue →</Link>
      </p>

      {uploadOpen && (
        <UploadFileModal clientId={clientId} clientName={clientName} onClose={() => setUploadOpen(false)} onDone={load} />
      )}
      {requestOpen && (
        <RequestDocumentModal clientId={clientId} clientName={clientName} onClose={() => setRequestOpen(false)} onDone={load} />
      )}
    </div>
  );
}

interface ChecklistProgressRow {
  progress_id: string;
  client_id: string;
  item_id: string;
  document_name: string;
  checklist_name: string;
  checked: boolean;
  checked_at: string | null;
  checked_by: string | null;
  linked_upload_id: string | null;
  linked_file_name: string | null;
  linked_uploaded_at: string | null;
}

interface ChecklistAvailableUpload {
  upload_id: string;
  file_name: string;
  uploaded_at: string | null;
}

/**
 * Internal "did we collect everything we need" tracker — distinct from
 * Document Requests (which ask the client to upload something). Rows are
 * server-synced against whichever admin-managed templates currently match
 * this client's type/services every time this loads (see checklists.routes.ts's
 * syncAndLoadProgress), so nothing to "apply" manually here — check a service
 * on Profile, save, come back to Documents, the new checklist items are here.
 *
 * TAX-008 (Hard Audit, 2026-08-13) — checking an item can now optionally link
 * a real uploaded document as evidence (backend validates it belongs to this
 * client). Linking is optional, not required — some items really are
 * confirmed some other way — but when a matching upload exists, this closes
 * the gap where the checkbox and the client's actual Documents were two
 * totally disconnected systems.
 */
function ClientChecklistSection({ clientId }: { clientId: string }) {
  const notify = useNotify();
  const [rows, setRows] = useState<ChecklistProgressRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [linkingRow, setLinkingRow] = useState<ChecklistProgressRow | null>(null);
  const [availableUploads, setAvailableUploads] = useState<ChecklistAvailableUpload[] | null>(null);
  const [pickedUploadId, setPickedUploadId] = useState("");

  function load() {
    api.get<{ progress: ChecklistProgressRow[] }>(`/checklists/clients/${clientId}/checklist`)
      .then((res) => setRows(res.progress))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the document checklist."));
  }
  useEffect(load, [clientId]);

  async function doToggle(row: ChecklistProgressRow, linkedUploadId?: string) {
    setTogglingId(row.progress_id);
    try {
      const res = await api.post<{ checked: boolean; linkedUploadId: string | null }>(
        `/checklists/clients/${clientId}/checklist/${row.progress_id}/toggle`,
        linkedUploadId ? { linkedUploadId } : {}
      );
      setRows((prev) => (prev || []).map((r) => (r.progress_id === row.progress_id
        ? { ...r, checked: res.checked, linked_upload_id: res.linkedUploadId, linked_file_name: availableUploads?.find((u) => u.upload_id === res.linkedUploadId)?.file_name ?? (res.linkedUploadId ? r.linked_file_name : null) }
        : r)));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not update this item.");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleCheckboxChange(row: ChecklistProgressRow) {
    if (row.checked) {
      // Unchecking never needs a picker.
      await doToggle(row);
      return;
    }
    setLinkingRow(row);
    setPickedUploadId("");
    setAvailableUploads(null);
    try {
      const res = await api.get<{ uploads: ChecklistAvailableUpload[] }>(`/checklists/clients/${clientId}/available-uploads`);
      setAvailableUploads(res.uploads);
    } catch {
      setAvailableUploads([]);
    }
  }

  async function confirmLink() {
    if (!linkingRow) return;
    await doToggle(linkingRow, pickedUploadId || undefined);
    setLinkingRow(null);
  }

  if (error) return <div className="card" style={{ marginBottom: 16 }}><ErrorBanner error={error} /></div>;
  if (!rows) return null;
  if (!rows.length) return null; // no template matches this client's type/services — nothing to show

  const grouped = new Map<string, ChecklistProgressRow[]>();
  for (const r of rows) {
    const arr = grouped.get(r.checklist_name) || [];
    arr.push(r);
    grouped.set(r.checklist_name, arr);
  }
  const total = rows.length;
  const done = rows.filter((r) => r.checked).length;

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
        <strong style={{ fontSize: 14 }}>Document Checklist</strong>
        <span className="muted" style={{ fontSize: 12 }}>{done} / {total} collected</span>
      </div>
      {Array.from(grouped.entries()).map(([name, items]) => (
        <div key={name} style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)" }}>
          <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>{name}</div>
          {items.map((r) => (
            <div key={r.progress_id}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", opacity: togglingId === r.progress_id ? 0.6 : 1 }}>
                <input type="checkbox" checked={r.checked} disabled={togglingId === r.progress_id} onChange={() => handleCheckboxChange(r)} />
                <span style={{ textDecoration: r.checked ? "line-through" : "none", color: r.checked ? "var(--muted)" : "var(--ink)" }}>{r.document_name}</span>
                {r.checked && r.checked_by && <span className="muted" style={{ fontSize: 11 }}>— {r.checked_by}</span>}
                {r.checked && r.linked_file_name && <span className="badge" style={{ fontSize: 10 }}>{r.linked_file_name}</span>}
              </label>
              {linkingRow?.progress_id === r.progress_id && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0 8px 26px", flexWrap: "wrap" }}>
                  <select className="field" style={{ maxWidth: 260 }} value={pickedUploadId} onChange={(e) => setPickedUploadId(e.target.value)} disabled={!availableUploads}>
                    <option value="">{availableUploads ? "No document — mark by other means" : "Loading uploads…"}</option>
                    {(availableUploads || []).map((u) => (
                      <option key={u.upload_id} value={u.upload_id}>{u.file_name}</option>
                    ))}
                  </select>
                  <button type="button" className="btn btn-sm btn-primary" onClick={confirmLink} disabled={!availableUploads}>Mark Collected</button>
                  <button type="button" className="btn btn-sm" onClick={() => setLinkingRow(null)}>Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ContractsSection({ clientId, clientName, clientServices }: { clientId: string; clientName: string; clientServices: string[] }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();
  const notify = useNotify();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [contracts, setContracts] = useState<ClientContract[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [genForm, setGenForm] = useState({ feeAmount: "", feeDescription: "", effectiveDate: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<Record<string, string>>({});
  const [signInPersonFor, setSignInPersonFor] = useState<string | null>(null);
  const [signInPersonForm, setSignInPersonForm] = useState({ signerName: "", signerTitle: "" });
  const [contractSearch, setContractSearch] = useState("");

  function load() {
    api.get<{ contracts: ClientContract[] }>(`/contracts/client/${clientId}`)
      .then((res) => setContracts(res.contracts))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load contracts."));
  }
  useEffect(load, [clientId]);

  const activeServiceKeys = new Set((contracts || []).filter((c) => c.status !== "Void").map((c) => c.service_key));
  const suggested = clientServices.filter((k) => !activeServiceKeys.has(k));
  // poa_release isn't a FIRM_SERVICES entry (never manually checked), so it
  // can't come from clientServices — added here whenever the client has any
  // covered service and doesn't already have one on file. Normally this
  // generates automatically the moment the covered service is checked (see
  // autoGenerateContracts); this manual fallback covers a client who had the
  // service checked before this feature existed.
  if (clientServices.some((k) => POA_COVERED_SERVICE_KEYS.includes(k)) && !activeServiceKeys.has(POA_RELEASE_SERVICE_KEY)) {
    suggested.push(POA_RELEASE_SERVICE_KEY);
  }
  const pendingSignature = (contracts || []).filter((c) => c.status === "Draft" || c.status === "Sent");
  const cq = contractSearch.trim().toLowerCase();
  const filteredContracts = cq ? (contracts || []).filter((c) => [c.title, c.status, c.service_key].some((v) => String(v || "").toLowerCase().includes(cq))) : (contracts || []);

  async function handleGenerate(serviceKey: string) {
    setBusy(`gen-${serviceKey}`);
    try {
      await api.post(`/contracts/client/${clientId}`, {
        serviceKey,
        feeAmount: genForm.feeAmount || undefined,
        feeDescription: genForm.feeDescription || undefined,
        effectiveDate: genForm.effectiveDate || undefined,
      });
      toast("Contract drafted.");
      setGeneratingFor(null);
      setGenForm({ feeAmount: "", feeDescription: "", effectiveDate: new Date().toISOString().slice(0, 10) });
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not generate this contract.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSend(c: ClientContract) {
    setBusy(`send-${c.contract_id}`);
    try {
      const res = await api.post<{ shareToken: string; emailed: boolean; emailError?: string }>(`/contracts/${c.contract_id}/send`, {});
      toast(res.emailed ? "Contract sent — emailed to the client." : `Contract marked sent.${res.emailError ? " (Email not sent — copy the link instead.)" : ""}`);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not send this contract.");
    } finally {
      setBusy(null);
    }
  }

  function openSignInPerson(c: ClientContract) {
    setSignInPersonForm({ signerName: "", signerTitle: "" });
    setSignInPersonFor(signInPersonFor === c.contract_id ? null : c.contract_id);
  }

  async function handleSignInPerson(c: ClientContract) {
    setBusy(`signip-${c.contract_id}`);
    try {
      await api.post(`/contracts/${c.contract_id}/sign-in-person`, signInPersonForm);
      toast("Recorded as signed in person.");
      setSignInPersonFor(null);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not record this signature.");
    } finally {
      setBusy(null);
    }
  }

  function handleCopyLink(c: ClientContract) {
    if (!c.share_token) return;
    const link = `${window.location.origin}/public/contract/${c.share_token}`;
    navigator.clipboard.writeText(link);
    toast("Signing link copied.");
  }

  async function handleVoid(c: ClientContract) {
    const reason = await promptFor({ title: "Void contract", message: `Reason for voiding "${c.title}"?` });
    if (reason === null) return;
    setBusy(`void-${c.contract_id}`);
    try {
      await api.post(`/contracts/${c.contract_id}/void`, { reason });
      toast("Contract voided.");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not void this contract.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(c: ClientContract) {
    const ok = await confirmDialog({ title: "Delete draft contract", message: `Delete the draft "${c.title}"? This can't be undone.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    setBusy(`delete-${c.contract_id}`);
    try {
      await api.post(`/contracts/${c.contract_id}/delete`, {});
      toast("Draft contract deleted.");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this contract.");
    } finally {
      setBusy(null);
    }
  }

  async function handlePdf(contractId: string, mode: "view" | "download" | "print", title: string) {
    setBusy(`pdf-${contractId}`);
    try {
      if (mode === "view") await viewFile(`/contracts/${contractId}/pdf`);
      else if (mode === "print") await printFile(`/contracts/${contractId}/pdf`);
      else await downloadFile(`/contracts/${contractId}/pdf`, buildFilename([clientName, title], "pdf"));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not open this contract PDF.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * The "sign everything in one sitting" packet — every document still
   * awaiting a signature (engagement letter + Authorization to Act/Release,
   * generated together for these services) merged into one PDF, so staff
   * print or hand over one file instead of chasing the client through
   * separate documents across separate visits.
   */
  async function handlePacket(mode: "view" | "download" | "print") {
    setBusy("packet");
    try {
      if (mode === "view") await viewFile(`/contracts/client/${clientId}/packet`);
      else if (mode === "print") await printFile(`/contracts/client/${clientId}/packet`);
      else await downloadFile(`/contracts/client/${clientId}/packet`, buildFilename([clientName, "Signing Packet"], "pdf"));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not combine these documents.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Shows the actual contract text inline rather than just the PDF — the PDF
   * can't render Arabic (standard PDF fonts can't encode it; see contractPdf.ts),
   * so for the immigration template specifically this is the only way staff can
   * read the Arabic section before sending it to a client.
   */
  async function handlePreview(contractId: string) {
    if (previewId === contractId) { setPreviewId(null); return; }
    setPreviewId(contractId);
    if (previewText[contractId]) return;
    try {
      const res = await api.get<{ contract: { rendered_body: string } }>(`/contracts/${contractId}`);
      setPreviewText((prev) => ({ ...prev, [contractId]: res.contract.rendered_body }));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not load this contract's text.");
      setPreviewId(null);
    }
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
        <strong style={{ fontSize: 14 }}>Contracts</strong>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="text" placeholder="Search contracts…" value={contractSearch} onChange={(e) => setContractSearch(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", width: 160 }} />
          <span className="muted" style={{ fontSize: 12 }}>{contracts ? `${filteredContracts.length} of ${contracts.length} contract(s)` : "Loading…"}</span>
        </div>
      </div>

      {error && <ErrorBanner error={error} style={{ margin: 16 }} />}

      {suggested.length > 0 && (
        <div style={{ padding: 16, borderBottom: "1px solid var(--line)", background: "var(--surface)" }}>
          <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>Suggested — no contract on file yet</div>
          {suggested.map((key) => {
            const label = key === POA_RELEASE_SERVICE_KEY ? POA_RELEASE_LABEL : FIRM_SERVICES.find((s) => s.key === key)?.label || key;
            return (
              <div key={key} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13 }}>{label}</span>
                  <button type="button" className="btn btn-sm" onClick={() => setGeneratingFor(generatingFor === key ? null : key)}>
                    {generatingFor === key ? "Cancel" : "Generate Contract"}
                  </button>
                </div>
                {generatingFor === key && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "flex-end" }}>
                    <div className="field" style={{ maxWidth: 130 }}>
                      <label htmlFor={`cd-gen-fee-${key}`}>Fee</label>
                      <input id={`cd-gen-fee-${key}`} placeholder="e.g. 400" value={genForm.feeAmount} onChange={(e) => setGenForm((f) => ({ ...f, feeAmount: e.target.value }))} />
                    </div>
                    <div className="field" style={{ maxWidth: 160 }}>
                      <label htmlFor={`cd-gen-fee-note-${key}`}>Fee Note</label>
                      <input id={`cd-gen-fee-note-${key}`} placeholder="e.g. per month" value={genForm.feeDescription} onChange={(e) => setGenForm((f) => ({ ...f, feeDescription: e.target.value }))} />
                    </div>
                    <div className="field" style={{ maxWidth: 150 }}>
                      <label htmlFor={`cd-gen-effective-date-${key}`}>Effective Date</label>
                      <input id={`cd-gen-effective-date-${key}`} type="date" value={genForm.effectiveDate} onChange={(e) => setGenForm((f) => ({ ...f, effectiveDate: e.target.value }))} />
                    </div>
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy === `gen-${key}`} onClick={() => handleGenerate(key)}>
                      {busy === `gen-${key}` ? "Creating…" : "Create Draft"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pendingSignature.length > 1 && (
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {pendingSignature.length} documents still need a signature — combine them so the client only has to sign once.
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="btn btn-sm" disabled={busy === "packet"} onClick={() => handlePacket("view")}>Preview Packet</button>
            <button type="button" className="btn btn-sm" disabled={busy === "packet"} onClick={() => handlePacket("download")}>Download Packet</button>
            <button type="button" className="btn btn-sm" disabled={busy === "packet"} onClick={() => handlePacket("print")}>Print Packet</button>
          </div>
        </div>
      )}

      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Contract</th><th scope="col">Status</th><th scope="col">Effective</th><th scope="col">Signed</th><th scope="col">Action</th></tr></thead>
          <tbody>
            {filteredContracts.map((c) => (
              <Fragment key={c.contract_id}>
                <tr>
                  <td>{c.title}</td>
                  <td><span style={{ color: CONTRACT_STATUS_COLOR[c.status] || "inherit", fontWeight: 700, fontSize: 12 }}>{c.status}</span></td>
                  <td className="muted">{c.effective_date ? fmtDateTime(c.effective_date) : "—"}</td>
                  <td className="muted">
                    {c.signer_name
                      ? `${c.signer_name}${c.signed_at ? ` · ${fmtDateTime(c.signed_at)}` : ""}${c.signature_method === "In-Person" ? " · In Person" : ""}`
                      : "—"}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button type="button" className="btn btn-sm" onClick={() => handlePreview(c.contract_id)}>{previewId === c.contract_id ? "Hide Text" : "Preview"}</button>
                      <button type="button" className="btn btn-sm" disabled={busy === `pdf-${c.contract_id}`} onClick={() => handlePdf(c.contract_id, "view", c.title)}>View PDF</button>
                      <button type="button" className="btn btn-sm" disabled={busy === `pdf-${c.contract_id}`} onClick={() => handlePdf(c.contract_id, "download", c.title)}>Download</button>
                      <button type="button" className="btn btn-sm" disabled={busy === `pdf-${c.contract_id}`} onClick={() => handlePdf(c.contract_id, "print", c.title)}>Print</button>
                      {/* poa_release must be signed by hand (several of the agencies it covers
                          don't accept an e-signed version — see contractContent.ts) — no
                          electronic send/link option is offered for it, only Preview/PDF/
                          Sign In Person below, same as every other physically-signed document. */}
                      {c.service_key !== POA_RELEASE_SERVICE_KEY && c.status === "Draft" && (
                        <button type="button" className="btn btn-sm" disabled={busy === `send-${c.contract_id}`} onClick={() => handleSend(c)}>
                          {busy === `send-${c.contract_id}` ? "Sending…" : "Send to Client"}
                        </button>
                      )}
                      {c.service_key !== POA_RELEASE_SERVICE_KEY && c.status === "Sent" && (
                        <button type="button" className="btn btn-sm" disabled={busy === `send-${c.contract_id}`} onClick={() => handleSend(c)}>
                          {busy === `send-${c.contract_id}` ? "Sending…" : "Resend Email"}
                        </button>
                      )}
                      {c.service_key !== POA_RELEASE_SERVICE_KEY && (c.status === "Sent" || c.status === "Signed") && c.share_token && (
                        <button type="button" className="btn btn-sm" onClick={() => handleCopyLink(c)}>Copy Link</button>
                      )}
                      {(c.status === "Draft" || c.status === "Sent") && (
                        <button type="button" className="btn btn-sm" disabled={busy === `signip-${c.contract_id}`} onClick={() => openSignInPerson(c)}>
                          Sign Now (In Person)
                        </button>
                      )}
                      {c.status !== "Void" && c.status !== "Signed" && (
                        <button type="button" className="btn btn-sm btn-danger" disabled={busy === `void-${c.contract_id}`} onClick={() => handleVoid(c)}>Void</button>
                      )}
                      {isAdmin && c.status === "Draft" && (
                        <button type="button" className="btn btn-sm btn-danger" disabled={busy === `delete-${c.contract_id}`} onClick={() => handleDelete(c)}>Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
                {previewId === c.contract_id && (
                  <tr>
                    <td colSpan={5} style={{ background: "var(--surface)" }}>
                      {previewText[c.contract_id] ? (
                        // No inner scroll cap — same reasoning as PublicContractPage.tsx:
                        // the Arabic translation sits at the end of a long document and a
                        // capped box made it easy for staff to miss during a pre-send review.
                        <div style={{ padding: "12px 4px" }}>
                          <ContractBodyText text={previewText[c.contract_id]} style={{ fontSize: 12.5, lineHeight: 1.7 }} />
                        </div>
                      ) : (
                        <div className="spinner-wrap" style={{ padding: 16 }}>Loading…</div>
                      )}
                    </td>
                  </tr>
                )}
                {signInPersonFor === c.contract_id && (
                  <tr>
                    <td colSpan={5} style={{ background: "var(--surface)" }}>
                      <div style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                        <div className="field" style={{ maxWidth: 220 }}>
                          <label htmlFor={`cd-contract-signer-name-${c.contract_id}`}>Signer's Full Legal Name</label>
                          <input id={`cd-contract-signer-name-${c.contract_id}`} value={signInPersonForm.signerName} onChange={(e) => setSignInPersonForm((f) => ({ ...f, signerName: e.target.value }))} />
                        </div>
                        <div className="field" style={{ maxWidth: 160 }}>
                          <label htmlFor={`cd-contract-signer-title-${c.contract_id}`}>Title (optional)</label>
                          <input id={`cd-contract-signer-title-${c.contract_id}`} placeholder="e.g. Owner" value={signInPersonForm.signerTitle} onChange={(e) => setSignInPersonForm((f) => ({ ...f, signerTitle: e.target.value }))} />
                        </div>
                        <button
                          type="button" className="btn btn-primary btn-sm"
                          disabled={busy === `signip-${c.contract_id}` || !signInPersonForm.signerName.trim()}
                          onClick={() => handleSignInPerson(c)}
                        >
                          {busy === `signip-${c.contract_id}` ? "Recording…" : "Confirm Signed In Person"}
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setSignInPersonFor(null)}>Cancel</button>
                      </div>
                      <p className="muted" style={{ fontSize: 11.5, padding: "0 12px 12px" }}>
                        Use this only when the client physically signed a printed copy in the office. It records the signature the same as the electronic flow, but marks it "In Person" and logs which staff member entered it — there's no client IP/device trail for a paper signature.
                      </p>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {contracts && contracts.length === 0 && suggested.length === 0 && (
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>
          No services selected yet — edit this client and check off Services Provided to see suggested contracts.
        </p>
      )}
      {contracts && contracts.length > 0 && filteredContracts.length === 0 && (
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>No contracts match "{contractSearch}".</p>
      )}
    </div>
  );
}

/**
 * Government-form filings (IRS Form 2848, IRS Form 8821, MD Form 548) — each
 * row is a real fillable PDF generated from stored data, same physical-
 * signature-only model as ContractsSection above (see poaForms.service.ts):
 * no e-sign link is ever offered, only Preview/PDF/Sign In Person, plus a
 * Mark Submitted step recording how staff actually got it to the agency
 * (mail/fax/hand-delivered/IRS online portal) since this app has no live
 * filing integration with the IRS or Comptroller.
 */
function PoaFilingsSection({ clientId, clientName, autoOpenFormTypes }: { clientId: string; clientName: string; autoOpenFormTypes?: string[] }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();
  const notify = useNotify();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [filings, setFilings] = useState<PoaFiling[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [editingFiling, setEditingFiling] = useState<PoaFiling | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Deep-linked from the Clients list "Add Client" card's "Authorization
  // Form" quick-launch checkboxes — see the ?openAuthForm doc comment on
  // ClientDetailPage's useSearchParams block. Multiple types can be picked at
  // once, so this opens the generator modal once per selected type, one after
  // another (advanced in the modal's onClose below) — not just the first.
  // Ref-guarded so a later re-render doesn't restart the queue.
  const appliedAutoOpen = useRef(false);
  const [autoOpenQueue, setAutoOpenQueue] = useState<string[]>([]);
  const [autoOpenCurrent, setAutoOpenCurrent] = useState<string | null>(null);
  useEffect(() => {
    if (!autoOpenFormTypes || !autoOpenFormTypes.length || appliedAutoOpen.current) return;
    appliedAutoOpen.current = true;
    setAutoOpenCurrent(autoOpenFormTypes[0]);
    setAutoOpenQueue(autoOpenFormTypes.slice(1));
    setGenerating(true);
  }, [autoOpenFormTypes]);
  function advanceAutoOpenQueue() {
    if (autoOpenQueue.length) {
      setAutoOpenCurrent(autoOpenQueue[0]);
      setAutoOpenQueue((q) => q.slice(1));
    } else {
      setAutoOpenCurrent(null);
      setGenerating(false);
    }
  }
  const [signInPersonFor, setSignInPersonFor] = useState<string | null>(null);
  const [signInPersonForm, setSignInPersonForm] = useState({ signerName: "", signerTitle: "" });
  const [submitFor, setSubmitFor] = useState<string | null>(null);
  const [submitForm, setSubmitForm] = useState({ submittedVia: SUBMIT_VIA_OPTIONS[0], submittedNote: "" });
  const [filingSearch, setFilingSearch] = useState("");

  function load() {
    api.get<{ filings: PoaFiling[] }>(`/poa-forms/client/${clientId}`)
      .then((res) => setFilings(res.filings))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load authorization forms."));
  }
  useEffect(load, [clientId]);

  async function handlePdf(filingId: string, mode: "view" | "download" | "print", formType: string) {
    setBusy(`pdf-${filingId}`);
    try {
      if (mode === "view") await viewFile(`/poa-forms/${filingId}/pdf`);
      else if (mode === "print") await printFile(`/poa-forms/${filingId}/pdf`);
      else await downloadFile(`/poa-forms/${filingId}/pdf`, buildFilename([clientName, FORM_LABELS[formType] || formType], "pdf"));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not open this form's PDF.");
    } finally {
      setBusy(null);
    }
  }

  function openSignInPerson(f: PoaFiling) {
    setSignInPersonForm({ signerName: "", signerTitle: "" });
    setSignInPersonFor(signInPersonFor === f.filing_id ? null : f.filing_id);
  }

  async function handleSignInPerson(f: PoaFiling) {
    setBusy(`signip-${f.filing_id}`);
    try {
      await api.post(`/poa-forms/${f.filing_id}/sign`, signInPersonForm);
      toast("Recorded as signed in person.");
      setSignInPersonFor(null);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not record this signature.");
    } finally {
      setBusy(null);
    }
  }

  function openSubmit(f: PoaFiling) {
    setSubmitForm({ submittedVia: SUBMIT_VIA_OPTIONS[0], submittedNote: "" });
    setSubmitFor(submitFor === f.filing_id ? null : f.filing_id);
  }

  async function handleSubmitted(f: PoaFiling) {
    setBusy(`submit-${f.filing_id}`);
    try {
      await api.post(`/poa-forms/${f.filing_id}/submit`, submitForm);
      toast("Marked submitted.");
      setSubmitFor(null);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not mark this submitted.");
    } finally {
      setBusy(null);
    }
  }

  async function handleVoid(f: PoaFiling) {
    const reason = await promptFor({ title: "Void filing", message: `Reason for voiding ${FORM_LABELS[f.form_type]}?` });
    if (reason === null) return;
    setBusy(`void-${f.filing_id}`);
    try {
      await api.post(`/poa-forms/${f.filing_id}/void`, { reason });
      toast("Filing voided.");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not void this filing.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(f: PoaFiling) {
    const ok = await confirmDialog({ title: "Delete draft filing", message: `Delete this draft ${FORM_LABELS[f.form_type]}? This can't be undone.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    setBusy(`delete-${f.filing_id}`);
    try {
      await api.post(`/poa-forms/${f.filing_id}/delete`, {});
      toast("Draft filing deleted.");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this filing.");
    } finally {
      setBusy(null);
    }
  }

  const pq = filingSearch.trim().toLowerCase();
  const filteredFilings = pq
    ? (filings || []).filter((f) => [FORM_LABELS[f.form_type] || f.form_type, f.status, ...f.representatives.map((r) => r.name)].some((v) => String(v || "").toLowerCase().includes(pq)))
    : (filings || []);

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", gap: 8 }}>
        <strong style={{ fontSize: 14 }}>Authorization Forms (IRS / MD POA)</strong>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="text" placeholder="Search filings…" value={filingSearch} onChange={(e) => setFilingSearch(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", width: 160 }} />
          <button type="button" className="btn btn-sm" onClick={() => setGenerating(true)}>+ Generate Authorization Form</button>
        </div>
      </div>

      {error && <ErrorBanner error={error} style={{ margin: 16 }} />}

      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Form</th><th scope="col">Representative(s)</th><th scope="col">Status</th><th scope="col">Signed</th><th scope="col">Submitted</th><th scope="col">Action</th></tr></thead>
          <tbody>
            {filteredFilings.map((f) => (
              <Fragment key={f.filing_id}>
                <tr>
                  <td>{FORM_LABELS[f.form_type] || f.form_type}</td>
                  <td className="muted">{f.representatives.map((r) => r.name).join(", ") || "—"}</td>
                  <td><span style={{ color: STATUS_COLOR[f.status] || "inherit", fontWeight: 700, fontSize: 12 }}>{f.status}</span></td>
                  <td className="muted">
                    {f.signer_name ? `${f.signer_name}${f.signed_at ? ` · ${fmtDateTime(f.signed_at)}` : ""}` : "—"}
                  </td>
                  <td className="muted">
                    {f.submitted_via ? `${f.submitted_via}${f.submitted_at ? ` · ${fmtDateTime(f.submitted_at)}` : ""}` : "—"}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button type="button" className="btn btn-sm" disabled={busy === `pdf-${f.filing_id}`} onClick={() => handlePdf(f.filing_id, "view", f.form_type)}>View PDF</button>
                      <button type="button" className="btn btn-sm" disabled={busy === `pdf-${f.filing_id}`} onClick={() => handlePdf(f.filing_id, "download", f.form_type)}>Download</button>
                      <button type="button" className="btn btn-sm" disabled={busy === `pdf-${f.filing_id}`} onClick={() => handlePdf(f.filing_id, "print", f.form_type)}>Print</button>
                      {f.status === "Draft" && (
                        <button type="button" className="btn btn-sm" onClick={() => setEditingFiling(f)}>Edit</button>
                      )}
                      {f.status === "Draft" && (
                        <button type="button" className="btn btn-sm" disabled={busy === `signip-${f.filing_id}`} onClick={() => openSignInPerson(f)}>Sign Now (In Person)</button>
                      )}
                      {f.status === "Signed" && (
                        <button type="button" className="btn btn-sm" disabled={busy === `submit-${f.filing_id}`} onClick={() => openSubmit(f)}>Mark Submitted</button>
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
                    <td colSpan={6} style={{ background: "var(--surface)" }}>
                      <div style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                        <div className="field" style={{ maxWidth: 220 }}>
                          <label htmlFor={`cd-poa-signer-name-${f.filing_id}`}>Signer's Full Legal Name</label>
                          <input id={`cd-poa-signer-name-${f.filing_id}`} value={signInPersonForm.signerName} onChange={(e) => setSignInPersonForm((s) => ({ ...s, signerName: e.target.value }))} />
                        </div>
                        <div className="field" style={{ maxWidth: 160 }}>
                          <label htmlFor={`cd-poa-signer-title-${f.filing_id}`}>Title (optional)</label>
                          <input id={`cd-poa-signer-title-${f.filing_id}`} placeholder="e.g. Owner" value={signInPersonForm.signerTitle} onChange={(e) => setSignInPersonForm((s) => ({ ...s, signerTitle: e.target.value }))} />
                        </div>
                        <button
                          type="button" className="btn btn-primary btn-sm"
                          disabled={busy === `signip-${f.filing_id}` || !signInPersonForm.signerName.trim()}
                          onClick={() => handleSignInPerson(f)}
                        >
                          {busy === `signip-${f.filing_id}` ? "Recording…" : "Confirm Signed In Person"}
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setSignInPersonFor(null)}>Cancel</button>
                      </div>
                      <p className="muted" style={{ fontSize: 11.5, padding: "0 12px 12px" }}>
                        Use this only after the client physically signed a printed copy — there's no electronic signature option for this form.
                      </p>
                    </td>
                  </tr>
                )}
                {submitFor === f.filing_id && (
                  <tr>
                    <td colSpan={6} style={{ background: "var(--surface)" }}>
                      <div style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                        <div className="field" style={{ maxWidth: 200 }}>
                          <label htmlFor={`cd-poa-submitted-via-${f.filing_id}`}>Sent Via</label>
                          <select id={`cd-poa-submitted-via-${f.filing_id}`} value={submitForm.submittedVia} onChange={(e) => setSubmitForm((s) => ({ ...s, submittedVia: e.target.value }))}>
                            {SUBMIT_VIA_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </div>
                        <div className="field" style={{ maxWidth: 260 }}>
                          <label htmlFor={`cd-poa-submitted-note-${f.filing_id}`}>Note (optional)</label>
                          <input id={`cd-poa-submitted-note-${f.filing_id}`} value={submitForm.submittedNote} onChange={(e) => setSubmitForm((s) => ({ ...s, submittedNote: e.target.value }))} />
                        </div>
                        <button type="button" className="btn btn-primary btn-sm" disabled={busy === `submit-${f.filing_id}`} onClick={() => handleSubmitted(f)}>
                          {busy === `submit-${f.filing_id}` ? "Saving…" : "Confirm Submitted"}
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
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>
          No authorization forms on file yet — generate Form 2848, Form 8821, or MD Form 548 as needed.
        </p>
      )}
      {filings && filings.length > 0 && filteredFilings.length === 0 && (
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>No filings match "{filingSearch}".</p>
      )}

      {generating && (
        <GeneratePoaFormModal
          key={autoOpenCurrent || "manual"}
          clientId={clientId}
          defaultFormType={autoOpenCurrent || undefined}
          onClose={() => (autoOpenCurrent ? advanceAutoOpenQueue() : setGenerating(false))}
          onDone={load}
        />
      )}
      {editingFiling && (
        <GeneratePoaFormModal
          clientId={clientId}
          editingFiling={{
            filing_id: editingFiling.filing_id, form_type: editingFiling.form_type,
            representatives: editingFiling.representatives, tax_matters: editingFiling.tax_matters,
            retain_prior: editingFiling.retain_prior, notes: editingFiling.notes,
          }}
          onClose={() => setEditingFiling(null)}
          onDone={() => { setEditingFiling(null); load(); }}
        />
      )}
    </div>
  );
}

interface HaccpPlanRow {
  plan_id: string; client_id: string | null; business_name: string; business_type_key: string;
  jurisdiction: string; city: string | null; state: string | null; created_by: string | null;
  created_at: string; updated_at: string;
}

/**
 * Health Permit (HACCP) applications linked to this client — v3_haccp_plans
 * already has a real client_id FK (see haccp.routes.ts's GET /plans?clientId),
 * this section just surfaces it here instead of making staff go check the
 * separate Health Permits area for every client. No duplicate record: this
 * reads the same plan row the /haccp generator page edits, and "Open" deep-
 * links straight back into it via ?planId= rather than making staff search
 * for it again.
 */
interface NoticeRow {
  notice_id: string; client_id: string; agency: string; notice_type: string; tax_period: string | null;
  amount: number | null; received_date: string; response_deadline: string | null; assigned_to: string | null;
  status: string; response_filed_date: string | null; follow_up_date: string | null; resolution: string | null; notes: string | null;
}
const NOTICE_STATUSES = ["Open", "Response Filed", "Resolved"];
const EMPTY_NOTICE_FORM = {
  agency: "", noticeType: "", taxPeriod: "", amount: "", receivedDate: new Date().toISOString().slice(0, 10),
  responseDeadline: "", assignedTo: "", responseFiledDate: "", followUpDate: "", resolution: "", notes: "",
};

/** IRS/state notice tracking (Firm Command Center gap analysis, item #24) — backed by GET/POST/PATCH /clients/:clientId/notices (notices.routes.ts). */
function NoticesSection({ clientId }: { clientId: string }) {
  const notify = useNotify();
  const confirmDialog = useConfirm();
  const [notices, setNotices] = useState<NoticeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_NOTICE_FORM);
  const [notifyClient, setNotifyClient] = useState(false);
  const [saving, setSaving] = useState(false);

  function load() {
    api.get<{ notices: NoticeRow[] }>(`/clients/${clientId}/notices`)
      .then((res) => setNotices(res.notices))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load notices."));
  }
  useEffect(load, [clientId]);

  function startAdd() {
    setForm(EMPTY_NOTICE_FORM);
    setEditingId(null);
    setNotifyClient(false);
    setShowForm(true);
  }
  function startEdit(n: NoticeRow) {
    setForm({
      agency: n.agency, noticeType: n.notice_type, taxPeriod: n.tax_period || "", amount: n.amount != null ? String(n.amount) : "",
      receivedDate: n.received_date.slice(0, 10), responseDeadline: n.response_deadline ? n.response_deadline.slice(0, 10) : "",
      assignedTo: n.assigned_to || "", responseFiledDate: n.response_filed_date ? n.response_filed_date.slice(0, 10) : "",
      followUpDate: n.follow_up_date ? n.follow_up_date.slice(0, 10) : "", resolution: n.resolution || "", notes: n.notes || "",
    });
    setEditingId(n.notice_id);
    setNotifyClient(false);
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        agency: form.agency, noticeType: form.noticeType, taxPeriod: form.taxPeriod, amount: form.amount,
        receivedDate: form.receivedDate, responseDeadline: form.responseDeadline, assignedTo: form.assignedTo,
        responseFiledDate: form.responseFiledDate, followUpDate: form.followUpDate, resolution: form.resolution, notes: form.notes,
      };
      if (editingId) await api.patch(`/clients/${clientId}/notices/${editingId}`, payload);
      else await api.post(`/clients/${clientId}/notices`, { ...payload, notify: notifyClient });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this notice.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(n: NoticeRow, status: string) {
    try {
      await api.patch(`/clients/${clientId}/notices/${n.notice_id}`, { status });
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not update status.");
    }
  }

  async function handleDelete(n: NoticeRow) {
    const ok = await confirmDialog({ title: "Delete notice", message: `Delete this ${n.agency} — ${n.notice_type} notice? This can't be undone.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.post(`/clients/${clientId}/notices/${n.notice_id}/delete`, {});
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this notice.");
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="command-panel">
      <div className="command-panel-header">
        <h2 className="command-panel-title">Notices</h2>
        <div className="command-panel-note">IRS/state notices — track agency, type, period, amount, and the response deadline separately from the general task list.</div>
      </div>
      <div style={{ padding: "0 16px 16px" }}>
        {error && <ErrorBanner error={error} />}
        {!showForm && <button type="button" className="btn" onClick={startAdd}>+ Add Notice</button>}

        {showForm && (
          <form onSubmit={handleSubmit} className="card" style={{ marginTop: 12, padding: 16 }}>
            <div className="form-grid">
              <div className="field"><label htmlFor="notice-agency">Agency</label><input id="notice-agency" required value={form.agency} onChange={(e) => setForm({ ...form, agency: e.target.value })} placeholder="IRS, Comptroller of Maryland, ..." /></div>
              <div className="field"><label htmlFor="notice-type">Notice Type</label><input id="notice-type" required value={form.noticeType} onChange={(e) => setForm({ ...form, noticeType: e.target.value })} placeholder="CP2000, Balance Due, ..." /></div>
            </div>
            <div className="form-grid">
              <div className="field"><label htmlFor="notice-period">Tax Period</label><input id="notice-period" value={form.taxPeriod} onChange={(e) => setForm({ ...form, taxPeriod: e.target.value })} placeholder="2025, Q3 2026, ..." /></div>
              <div className="field"><label htmlFor="notice-amount">Amount</label><input id="notice-amount" type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            </div>
            <div className="form-grid">
              <div className="field"><label htmlFor="notice-received">Received Date</label><input id="notice-received" type="date" required value={form.receivedDate} onChange={(e) => setForm({ ...form, receivedDate: e.target.value })} /></div>
              <div className="field"><label htmlFor="notice-deadline">Response Deadline</label><input id="notice-deadline" type="date" value={form.responseDeadline} onChange={(e) => setForm({ ...form, responseDeadline: e.target.value })} /></div>
            </div>
            <div className="field"><label htmlFor="notice-assigned">Assigned To</label><input id="notice-assigned" value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} placeholder="Staff email" /></div>
            {editingId && (
              <div className="form-grid">
                <div className="field"><label htmlFor="notice-response-filed">Response Filed Date</label><input id="notice-response-filed" type="date" value={form.responseFiledDate} onChange={(e) => setForm({ ...form, responseFiledDate: e.target.value })} /></div>
                <div className="field"><label htmlFor="notice-followup">Follow-Up Date</label><input id="notice-followup" type="date" value={form.followUpDate} onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} /></div>
              </div>
            )}
            {editingId && <div className="field"><label htmlFor="notice-resolution">Resolution</label><textarea id="notice-resolution" rows={2} value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })} /></div>}
            <div className="field"><label htmlFor="notice-notes">Notes</label><textarea id="notice-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            {!editingId && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", marginBottom: 12 }}>
                <input type="checkbox" checked={notifyClient} onChange={(e) => setNotifyClient(e.target.checked)} />
                Notify client — email them that we've received this notice
              </label>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : editingId ? "Save Changes" : notifyClient ? "Save and Send" : "Save"}</button>
              <button type="button" className="btn" disabled={saving} onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        )}

        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th scope="col">Agency</th><th scope="col">Type</th><th scope="col">Period</th><th scope="col">Amount</th><th scope="col">Received</th><th scope="col">Deadline</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {notices === null && <tr><td colSpan={8} className="muted">Loading…</td></tr>}
              {notices !== null && notices.length === 0 && <tr><td colSpan={8} className="muted">No notices logged.</td></tr>}
              {notices?.map((n) => {
                const overdue = n.status !== "Resolved" && n.response_deadline && n.response_deadline.slice(0, 10) < today;
                return (
                  <tr key={n.notice_id}>
                    <td>{n.agency}</td>
                    <td>{n.notice_type}</td>
                    <td>{n.tax_period || "—"}</td>
                    <td>{n.amount != null ? `$${Number(n.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}</td>
                    <td>{fmtDateOnly(n.received_date)}</td>
                    <td style={{ color: overdue ? "var(--red)" : undefined, fontWeight: overdue ? 700 : undefined }}>{n.response_deadline ? fmtDateOnly(n.response_deadline) : "—"}{overdue ? " (overdue)" : ""}</td>
                    <td>
                      <select value={n.status} onChange={(e) => handleStatusChange(n, e.target.value)} style={{ fontSize: 12.5 }}>
                        {NOTICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td>
                      <button type="button" className="link-button" onClick={() => startEdit(n)}>Edit</button>
                      {" · "}
                      <button type="button" className="link-button" onClick={() => handleDelete(n)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface TaxReturnRow {
  tax_return_id: string; client_id: string; tax_year: number; return_type: string; status: string;
  preparer: string | null; reviewer: string | null; extension_filed: boolean; due_date: string | null;
  filed_date: string | null; accepted_date: string | null; rejection_reason: string | null; notes: string | null;
}
const TAX_RETURN_STATUSES = [
  "Not Started", "Documents Requested", "Documents Received", "In Preparation", "Missing Information",
  "Review", "Client Approval", "E-file Ready", "Filed", "Accepted", "Rejected", "Completed",
];
const EMPTY_TAX_RETURN_FORM = {
  taxYear: String(new Date().getFullYear() - 1), returnType: "", preparer: "", reviewer: "",
  extensionFiled: false, dueDate: "", notes: "",
};

/** Tax Return Production tracking (Firm Command Center gap analysis, item #8) — confirmed with the user this workflow was never tracked anywhere before. Backed by GET/POST/PATCH /clients/:clientId/tax-returns (taxReturns.routes.ts). */
function TaxReturnProductionSection({ clientId, defaultReturnType }: { clientId: string; defaultReturnType: string | null }) {
  const notify = useNotify();
  const confirmDialog = useConfirm();
  const [returns, setReturns] = useState<TaxReturnRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_TAX_RETURN_FORM, returnType: defaultReturnType && defaultReturnType !== "N/A" ? defaultReturnType : "" });
  const [saving, setSaving] = useState(false);

  function load() {
    api.get<{ taxReturns: TaxReturnRow[] }>(`/clients/${clientId}/tax-returns`)
      .then((res) => setReturns(res.taxReturns))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load tax returns."));
  }
  useEffect(load, [clientId]);

  function startAdd() {
    setForm({ ...EMPTY_TAX_RETURN_FORM, returnType: defaultReturnType && defaultReturnType !== "N/A" ? defaultReturnType : "" });
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post(`/clients/${clientId}/tax-returns`, {
        taxYear: Number(form.taxYear), returnType: form.returnType, preparer: form.preparer, reviewer: form.reviewer,
        extensionFiled: form.extensionFiled, dueDate: form.dueDate, notes: form.notes,
      });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start tracking this return.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(r: TaxReturnRow, status: string) {
    if (status === "Rejected" && !r.rejection_reason) {
      const reason = window.prompt("Rejection reason (required):");
      if (!reason || !reason.trim()) return;
      try {
        await api.patch(`/clients/${clientId}/tax-returns/${r.tax_return_id}`, { status, rejectionReason: reason.trim() });
        load();
      } catch (err) {
        await notify(err instanceof ApiError ? err.message : "Could not update status.");
      }
      return;
    }
    try {
      await api.patch(`/clients/${clientId}/tax-returns/${r.tax_return_id}`, { status });
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not update status.");
    }
  }

  async function handleDelete(r: TaxReturnRow) {
    const ok = await confirmDialog({ title: "Delete tax return tracking", message: `Delete tracking for the ${r.tax_year} ${r.return_type} return? This can't be undone.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.post(`/clients/${clientId}/tax-returns/${r.tax_return_id}/delete`, {});
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this return.");
    }
  }

  return (
    <div className="command-panel">
      <div className="command-panel-header">
        <h2 className="command-panel-title">Tax Return Production</h2>
        <div className="command-panel-note">One row per tax year — tracks the return through preparation, not just whether a generic task exists for it.</div>
      </div>
      <div style={{ padding: "0 16px 16px" }}>
        {error && <ErrorBanner error={error} />}
        {!showForm && <button type="button" className="btn" onClick={startAdd}>+ Start Tracking a Return</button>}

        {showForm && (
          <form onSubmit={handleSubmit} className="card" style={{ marginTop: 12, padding: 16 }}>
            <div className="form-grid">
              <div className="field"><label htmlFor="taxrtn-year">Tax Year</label><input id="taxrtn-year" type="number" required value={form.taxYear} onChange={(e) => setForm({ ...form, taxYear: e.target.value })} /></div>
              <div className="field">
                <label htmlFor="taxrtn-type">Return Type</label>
                <input id="taxrtn-type" list="taxrtn-type-options" required value={form.returnType} onChange={(e) => setForm({ ...form, returnType: e.target.value })} />
                <datalist id="taxrtn-type-options">{RETURN_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
              </div>
            </div>
            <div className="form-grid">
              <div className="field"><label htmlFor="taxrtn-preparer">Preparer</label><input id="taxrtn-preparer" value={form.preparer} onChange={(e) => setForm({ ...form, preparer: e.target.value })} placeholder="Staff email" /></div>
              <div className="field"><label htmlFor="taxrtn-reviewer">Reviewer</label><input id="taxrtn-reviewer" value={form.reviewer} onChange={(e) => setForm({ ...form, reviewer: e.target.value })} placeholder="Staff email" /></div>
            </div>
            <div className="form-grid">
              <div className="field"><label htmlFor="taxrtn-due">Due Date</label><input id="taxrtn-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></div>
              <div className="field" style={{ display: "flex", alignItems: "flex-end", paddingBottom: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={form.extensionFiled} onChange={(e) => setForm({ ...form, extensionFiled: e.target.checked })} /> Extension filed
                </label>
              </div>
            </div>
            <div className="field"><label htmlFor="taxrtn-notes">Notes</label><textarea id="taxrtn-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Start Tracking"}</button>
              <button type="button" className="btn" disabled={saving} onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        )}

        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th scope="col">Year</th><th scope="col">Type</th><th scope="col">Preparer</th><th scope="col">Reviewer</th><th scope="col">Due</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {returns === null && <tr><td colSpan={7} className="muted">Loading…</td></tr>}
              {returns !== null && returns.length === 0 && <tr><td colSpan={7} className="muted">No returns tracked yet.</td></tr>}
              {returns?.map((r) => (
                <tr key={r.tax_return_id}>
                  <td>{r.tax_year}</td>
                  <td>{r.return_type}{r.extension_filed ? " (ext.)" : ""}</td>
                  <td>{r.preparer || "—"}</td>
                  <td>{r.reviewer || "—"}</td>
                  <td>{r.due_date ? fmtDateOnly(r.due_date) : "—"}</td>
                  <td>
                    <select value={r.status} onChange={(e) => handleStatusChange(r, e.target.value)} style={{ fontSize: 12.5 }}>
                      {TAX_RETURN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {r.status === "Rejected" && r.rejection_reason && <div className="muted" style={{ fontSize: 11 }}>{r.rejection_reason}</div>}
                  </td>
                  <td><button type="button" className="link-button" onClick={() => handleDelete(r)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function HealthPermitsSection({ clientId }: { clientId: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const toast = useToast();
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const [plans, setPlans] = useState<HaccpPlanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typeLabels, setTypeLabels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    api.get<{ plans: HaccpPlanRow[] }>(`/haccp/plans?clientId=${encodeURIComponent(clientId)}`)
      .then((res) => setPlans(res.plans))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load health permit applications."));
  }
  useEffect(load, [clientId]);
  useEffect(() => {
    api.get<{ businessTypes: { key: string; label: string }[] }>("/haccp/options")
      .then((res) => setTypeLabels(Object.fromEntries(res.businessTypes.map((t) => [t.key, t.label]))))
      .catch(() => {});
  }, []);

  async function handleDelete(plan: HaccpPlanRow) {
    const ok = await confirmDialog({ title: "Delete health permit application", message: `Delete "${plan.business_name}"? This can't be undone.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    setBusy(plan.plan_id);
    try {
      await api.post(`/haccp/plans/${plan.plan_id}/delete`, {});
      toast("Health permit application deleted.");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this application.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", gap: 8 }}>
        <strong style={{ fontSize: 14 }}>Health Permit Applications</strong>
        <button type="button" className="btn btn-sm" onClick={() => navigate(`/haccp?clientId=${encodeURIComponent(clientId)}`)}>+ New Health Permit</button>
      </div>

      {error && <ErrorBanner error={error} style={{ margin: 16 }} />}

      {plans && plans.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">Business</th><th scope="col">Type</th><th scope="col">Jurisdiction</th><th scope="col">Last Updated</th><th scope="col">Action</th></tr></thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.plan_id}>
                  <td>{p.business_name}</td>
                  <td className="muted">{typeLabels[p.business_type_key] || p.business_type_key}</td>
                  <td className="muted">{[p.jurisdiction, p.city, p.state].filter(Boolean).join(", ") || "—"}</td>
                  <td className="muted">{new Date(p.updated_at).toLocaleDateString()}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button type="button" className="btn btn-sm" onClick={() => navigate(`/haccp?planId=${encodeURIComponent(p.plan_id)}`)}>Open</button>
                      {isAdmin && (
                        <button type="button" className="btn btn-sm" disabled={busy === p.plan_id} onClick={() => handleDelete(p)}>
                          {busy === p.plan_id ? "Deleting…" : "Delete"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {plans && plans.length === 0 && (
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>
          No health permit applications linked to this client yet.
        </p>
      )}
      <div style={{ padding: "10px 16px", borderTop: plans && plans.length > 0 ? "1px solid var(--line)" : undefined }}>
        <span className="muted" style={{ fontSize: 12 }}>
          Generated permit documents (HACCP plan, license application, plan review) are saved to this client's{" "}
          <button type="button" className="link-button" style={{ fontSize: 12 }} onClick={() => navigate(`/clients/${clientId}?tab=Documents`)}>Documents tab</button>.
        </span>
      </div>
    </div>
  );
}

/**
 * Form 2553 (S-Corp election), Form W-9 (TIN request), and Form 8832
 * (entity classification election) — same physical-signature-only lifecycle
 * as PoaFilingsSection just above (Draft → Signed → Submitted, or Void/
 * Delete while still Draft), just three forms that don't share a common data
 * shape with each other or with the POA forms, so they get their own section
 * and their own filing table rather than being folded into PoaFilingsSection.
 */
function GovFormsSection({ clientId, clientName, autoOpenFormTypes, reloadKey, highlightFilingIds }: {
  clientId: string; clientName: string; autoOpenFormTypes?: string[];
  /** Bump to force a re-fetch even though clientId hasn't changed — used by the Ownership Transfer wizard's Step 4 after it drafts new filings this section already loaded before they existed. */
  reloadKey?: number;
  /** filing_ids to visually flag (and scroll to) as "just generated" — same use case as reloadKey, see OwnershipTransferSection.tsx's onFilingsGenerated. */
  highlightFilingIds?: string[];
}) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();
  const notify = useNotify();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [filings, setFilings] = useState<GovFormFiling[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [editingFiling, setEditingFiling] = useState<GovFormFiling | null>(null);
  // See PoaFilingsSection's matching comment — same quick-launch deep link,
  // sequential queue so multiple selected form types each get their own
  // generator modal, one after another.
  const appliedAutoOpen = useRef(false);
  const [autoOpenQueue, setAutoOpenQueue] = useState<string[]>([]);
  const [autoOpenCurrent, setAutoOpenCurrent] = useState<string | null>(null);
  useEffect(() => {
    if (!autoOpenFormTypes || !autoOpenFormTypes.length || appliedAutoOpen.current) return;
    appliedAutoOpen.current = true;
    setAutoOpenCurrent(autoOpenFormTypes[0]);
    setAutoOpenQueue(autoOpenFormTypes.slice(1));
    setGenerating(true);
  }, [autoOpenFormTypes]);
  function advanceAutoOpenQueue() {
    if (autoOpenQueue.length) {
      setAutoOpenCurrent(autoOpenQueue[0]);
      setAutoOpenQueue((q) => q.slice(1));
    } else {
      setAutoOpenCurrent(null);
      setGenerating(false);
    }
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [signInPersonFor, setSignInPersonFor] = useState<string | null>(null);
  const [signInPersonForm, setSignInPersonForm] = useState({ signerName: "", signerTitle: "" });
  const [submitFor, setSubmitFor] = useState<string | null>(null);
  const [submitForm, setSubmitForm] = useState({ submittedVia: GOV_SUBMIT_VIA_OPTIONS[0], submittedNote: "" });
  const [filingSearch, setFilingSearch] = useState("");

  function load() {
    api.get<{ filings: GovFormFiling[] }>(`/gov-forms/client/${clientId}`)
      .then((res) => setFilings(res.filings))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load government forms."));
  }
  useEffect(load, [clientId, reloadKey]);

  const highlightSet = new Set(highlightFilingIds || []);
  useEffect(() => {
    if (!highlightFilingIds || !highlightFilingIds.length) return;
    // Wait a tick for the reloadKey-triggered fetch above to land the new
    // rows before trying to scroll to one of them.
    const t = setTimeout(() => {
      document.getElementById(`gov-filing-row-${highlightFilingIds[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightFilingIds]);

  async function handlePdf(filingId: string, mode: "view" | "download" | "print", formType: string) {
    setBusy(`pdf-${filingId}`);
    try {
      if (mode === "view") await viewFile(`/gov-forms/${filingId}/pdf`);
      else if (mode === "print") await printFile(`/gov-forms/${filingId}/pdf`);
      else await downloadFile(`/gov-forms/${filingId}/pdf`, buildFilename([clientName, GOV_FORM_LABELS[formType as ClientGovFormType] || formType], "pdf"));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not open this form's PDF.");
    } finally {
      setBusy(null);
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
      toast("Recorded as signed in person.");
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

  /** TAX-004 — optional maker-checker: filer's choice to route a Signed filing to an admin before Submit. */
  async function handleRequestReview(f: GovFormFiling) {
    setBusy(`review-req-${f.filing_id}`);
    try {
      await api.post(`/gov-forms/${f.filing_id}/request-review`, {});
      toast("Sent for admin review.");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not send this for review.");
    } finally {
      setBusy(null);
    }
  }

  async function handleReviewDecision(f: GovFormFiling, decision: "approved" | "rejected") {
    let note: string | null = null;
    if (decision === "rejected") {
      note = await promptFor({ title: "Reject filing", message: `What needs to change on ${GOV_FORM_LABELS[f.form_type]}?` });
      if (note === null) return;
    }
    setBusy(`review-${f.filing_id}`);
    try {
      await api.post(`/gov-forms/${f.filing_id}/review`, { decision, note });
      toast(decision === "approved" ? "Filing approved." : "Filing sent back to the preparer.");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not record this review decision.");
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

  /** Maryland only sends back a CRA/Central Registration Number after the state
      approves the filing — there's no webhook or lookup for it, so this is how
      staff record it once it arrives, closing the loop the CRA form's own
      "existing registration number" field started (see cra_registration_number
      on the client profile, read by every future CRA/tax filing that needs it). */
  async function handleSaveCraNumber(f: GovFormFiling) {
    const current = f.form_data?.existingCraNumber || "";
    const value = await promptFor({ title: "Save CRA registration number", message: "Maryland Central Registration Number, as returned by the state:", defaultValue: current });
    if (value === null) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(`cra-number-${f.filing_id}`);
    try {
      await api.patch(`/clients/${clientId}`, { craRegistrationNumber: trimmed });
      toast("Saved to the client's profile.");
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not save this to the client profile.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(f: GovFormFiling) {
    const ok = await confirmDialog({ title: "Delete draft filing", message: `Delete this draft ${GOV_FORM_LABELS[f.form_type]}? This can't be undone.`, confirmLabel: "Delete", danger: true });
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

  const gq = filingSearch.trim().toLowerCase();
  const filteredFilings = gq
    ? (filings || []).filter((f) => [GOV_FORM_LABELS[f.form_type] || f.form_type, f.status].some((v) => String(v || "").toLowerCase().includes(gq)))
    : (filings || []);

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", gap: 8 }}>
        <strong style={{ fontSize: 14 }}>Government Forms (SS-4 / 2553 / W-9 / 8832 / MD CRA)</strong>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="text" placeholder="Search forms…" value={filingSearch} onChange={(e) => setFilingSearch(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", width: 160 }} />
          <button type="button" className="btn btn-sm" onClick={() => setGenerating(true)}>+ Generate Government Form</button>
        </div>
      </div>

      {error && <ErrorBanner error={error} style={{ margin: 16 }} />}

      <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Form</th><th scope="col">Status</th><th scope="col">Signed</th><th scope="col">Submitted</th><th scope="col">Action</th></tr></thead>
          <tbody>
            {filteredFilings.map((f) => (
              <Fragment key={f.filing_id}>
                <tr id={`gov-filing-row-${f.filing_id}`} style={highlightSet.has(f.filing_id) ? { background: "var(--surface-2, #f8fafc)", boxShadow: "inset 3px 0 0 var(--teal)" } : undefined}>
                  <td>
                    {GOV_FORM_LABELS[f.form_type] || f.form_type}
                    {highlightSet.has(f.filing_id) && <span className="status-pill status-green" style={{ marginLeft: 6, fontSize: 10 }}>New</span>}
                  </td>
                  <td>
                    <span style={{ color: GOV_STATUS_COLOR[f.status] || "inherit", fontWeight: 700, fontSize: 12 }}>{f.status}</span>
                    {f.review_status === "pending_review" && (
                      <div className="status-pill status-amber" style={{ marginTop: 4, fontSize: 11 }} title={`Requested by ${f.review_requested_by || "—"}`}>Pending Review</div>
                    )}
                    {f.review_status === "rejected" && (
                      <div className="status-pill status-red" style={{ marginTop: 4, fontSize: 11 }} title={f.review_note || undefined}>Review Rejected</div>
                    )}
                    {f.review_status === "approved" && f.status !== "Submitted" && (
                      <div className="status-pill status-green" style={{ marginTop: 4, fontSize: 11 }}>Approved</div>
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
                      <button type="button" className="btn btn-sm" disabled={busy === `pdf-${f.filing_id}`} onClick={() => handlePdf(f.filing_id, "view", f.form_type)}>View PDF</button>
                      <button type="button" className="btn btn-sm" disabled={busy === `pdf-${f.filing_id}`} onClick={() => handlePdf(f.filing_id, "download", f.form_type)}>Download</button>
                      <button type="button" className="btn btn-sm" disabled={busy === `pdf-${f.filing_id}`} onClick={() => handlePdf(f.filing_id, "print", f.form_type)}>Print</button>
                      {f.status === "Draft" && (
                        <button type="button" className="btn btn-sm" onClick={() => setEditingFiling(f)}>Edit</button>
                      )}
                      {f.status === "Draft" && (
                        <button type="button" className="btn btn-sm" disabled={busy === `signip-${f.filing_id}`} onClick={() => openSignInPerson(f)}>Sign Now (In Person)</button>
                      )}
                      {f.status === "Signed" && f.review_status !== "pending_review" && (f.review_status !== "rejected" || isAdmin) && (
                        <button type="button" className="btn btn-sm" disabled={busy === `submit-${f.filing_id}`} onClick={() => openSubmit(f)}>Mark Submitted</button>
                      )}
                      {f.status === "Signed" && isAdmin && f.review_status === "pending_review" && (
                        <button type="button" className="btn btn-sm" disabled={busy === `submit-${f.filing_id}`} onClick={() => openSubmit(f)}>Approve &amp; Submit</button>
                      )}
                      {f.status === "Signed" && (!f.review_status || f.review_status === "rejected") && (
                        <button type="button" className="btn btn-sm" disabled={busy === `review-req-${f.filing_id}`} onClick={() => handleRequestReview(f)}>Send for Review</button>
                      )}
                      {isAdmin && f.review_status === "pending_review" && (
                        <>
                          <button type="button" className="btn btn-sm btn-primary" disabled={busy === `review-${f.filing_id}`} onClick={() => handleReviewDecision(f, "approved")}>Approve</button>
                          <button type="button" className="btn btn-sm" disabled={busy === `review-${f.filing_id}`} onClick={() => handleReviewDecision(f, "rejected")}>Reject</button>
                        </>
                      )}
                      {f.form_type === "CRA" && f.status === "Submitted" && (
                        <button type="button" className="btn btn-sm" disabled={busy === `cra-number-${f.filing_id}`} onClick={() => handleSaveCraNumber(f)} title="Once Maryland responds with a Central Registration Number, save it here to the client's profile">
                          Save Reg. Number
                        </button>
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
                    <td colSpan={5} style={{ background: "var(--surface)" }}>
                      <div style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                        <div className="field" style={{ maxWidth: 220 }}>
                          <label htmlFor={`cd-gf-signer-name-${f.filing_id}`}>Signer's Full Legal Name</label>
                          <input id={`cd-gf-signer-name-${f.filing_id}`} value={signInPersonForm.signerName} onChange={(e) => setSignInPersonForm((s) => ({ ...s, signerName: e.target.value }))} />
                        </div>
                        <div className="field" style={{ maxWidth: 160 }}>
                          <label htmlFor={`cd-gf-signer-title-${f.filing_id}`}>Title (optional)</label>
                          <input id={`cd-gf-signer-title-${f.filing_id}`} placeholder="e.g. Owner" value={signInPersonForm.signerTitle} onChange={(e) => setSignInPersonForm((s) => ({ ...s, signerTitle: e.target.value }))} />
                        </div>
                        <button
                          type="button" className="btn btn-primary btn-sm"
                          disabled={busy === `signip-${f.filing_id}` || !signInPersonForm.signerName.trim()}
                          onClick={() => handleSignInPerson(f)}
                        >
                          {busy === `signip-${f.filing_id}` ? "Recording…" : "Confirm Signed In Person"}
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setSignInPersonFor(null)}>Cancel</button>
                      </div>
                      <p className="muted" style={{ fontSize: 11.5, padding: "0 12px 12px" }}>
                        Use this only after the client physically signed a printed copy — there's no electronic signature option for this form.
                      </p>
                    </td>
                  </tr>
                )}
                {submitFor === f.filing_id && (
                  <tr>
                    <td colSpan={5} style={{ background: "var(--surface)" }}>
                      <div style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                        <div className="field" style={{ maxWidth: 200 }}>
                          <label htmlFor={`cd-gf-submitted-via-${f.filing_id}`}>Sent Via</label>
                          <select id={`cd-gf-submitted-via-${f.filing_id}`} value={submitForm.submittedVia} onChange={(e) => setSubmitForm((s) => ({ ...s, submittedVia: e.target.value }))}>
                            {GOV_SUBMIT_VIA_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </div>
                        <div className="field" style={{ maxWidth: 260 }}>
                          <label htmlFor={`cd-gf-submitted-note-${f.filing_id}`}>Note (optional)</label>
                          <input id={`cd-gf-submitted-note-${f.filing_id}`} value={submitForm.submittedNote} onChange={(e) => setSubmitForm((s) => ({ ...s, submittedNote: e.target.value }))} />
                        </div>
                        <button type="button" className="btn btn-primary btn-sm" disabled={busy === `submit-${f.filing_id}`} onClick={() => handleSubmitted(f)}>
                          {busy === `submit-${f.filing_id}` ? "Saving…" : "Confirm Submitted"}
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
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>
          No government forms on file yet — generate Form 2553, Form W-9, or Form 8832 as needed.
        </p>
      )}
      {filings && filings.length > 0 && filteredFilings.length === 0 && (
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>No forms match "{filingSearch}".</p>
      )}

      {generating && (
        <GenerateGovFormModal
          key={autoOpenCurrent || "manual"}
          clientId={clientId}
          defaultFormType={(autoOpenCurrent as ClientGovFormType) || undefined}
          onClose={() => (autoOpenCurrent ? advanceAutoOpenQueue() : setGenerating(false))}
          onDone={load}
        />
      )}
      {editingFiling && (
        <GenerateGovFormModal
          clientId={clientId}
          editingFiling={{ filing_id: editingFiling.filing_id, form_type: editingFiling.form_type as ClientGovFormType, form_data: editingFiling.form_data }}
          onClose={() => setEditingFiling(null)}
          onDone={() => { setEditingFiling(null); load(); }}
        />
      )}
    </div>
  );
}

/**
 * Employer-level tax forms (W-3, Form 1096, Form 940, Form 941) — unlike
 * W-2/1099-NEC (generated per employee/contractor on their own profile
 * page), these are filed once per employer per year (or per quarter, for
 * 941), summing totals across everyone that client paid, so they live here
 * on the client itself rather than on any one employee's page.
 */
function EmployerTaxFormsSection({ clientId, clientName }: { clientId: string; clientName: string }) {
  const notify = useNotify();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const currentQuarter = (Math.floor(new Date().getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(currentQuarter);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(form: "w3" | "1096" | "940" | "941", mode: "view" | "download" | "print") {
    const key = `${form}-${mode}`;
    setBusy(key);
    try {
      const q = form === "941" ? `&quarter=${quarter}` : "";
      const path = `/accounting/tax-forms/${form}/${clientId}?year=${encodeURIComponent(year)}${q}`;
      const filename = form === "941" ? buildFilename([clientName, "Form 941", `${year} Q${quarter}`], "pdf") : buildFilename([clientName, `Form ${form.toUpperCase()}`, year], "pdf");
      if (mode === "view") await viewFile(path);
      else if (mode === "print") await printFile(path);
      else await downloadFile(path, filename);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : `Could not generate this form.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Employer Tax Forms</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Filed once per employer, summing totals across every employee/contractor paid that period. W-3/1096 aren't
        needed if the underlying W-2s/1099-NECs were filed electronically. 940/941 leave a few lines blank where this
        system doesn't track the underlying data (deposits made, prior-quarter lookback liability, etc.) — review
        before filing.
      </p>
      <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
        <div className="field" style={{ maxWidth: 120 }}>
          <label htmlFor="taxFormYear">Tax Year</label>
          <input id="taxFormYear" value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
        <div className="field" style={{ maxWidth: 140 }}>
          <label htmlFor="taxFormQuarter">Quarter (for 941)</label>
          <select id="taxFormQuarter" value={quarter} onChange={(e) => setQuarter(Number(e.target.value) as 1 | 2 | 3 | 4)}>
            <option value={1}>Q1 (Jan-Mar)</option>
            <option value={2}>Q2 (Apr-Jun)</option>
            <option value={3}>Q3 (Jul-Sep)</option>
            <option value={4}>Q4 (Oct-Dec)</option>
          </select>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>W-3 (transmits W-2s to SSA)</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" disabled={busy !== null} onClick={() => run("w3", "view")}>{busy === "w3-view" ? "Opening…" : "View W-3"}</button>
            <button className="btn" disabled={busy !== null} onClick={() => run("w3", "download")}>{busy === "w3-download" ? "Generating…" : "Download W-3"}</button>
            <button className="btn" disabled={busy !== null} onClick={() => run("w3", "print")}>{busy === "w3-print" ? "Printing…" : "Print W-3"}</button>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Form 1096 (transmits 1099-NECs to IRS)</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" disabled={busy !== null} onClick={() => run("1096", "view")}>{busy === "1096-view" ? "Opening…" : "View 1096"}</button>
            <button className="btn" disabled={busy !== null} onClick={() => run("1096", "download")}>{busy === "1096-download" ? "Generating…" : "Download 1096"}</button>
            <button className="btn" disabled={busy !== null} onClick={() => run("1096", "print")}>{busy === "1096-print" ? "Printing…" : "Print 1096"}</button>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Form 940 (annual FUTA return)</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" disabled={busy !== null} onClick={() => run("940", "view")}>{busy === "940-view" ? "Opening…" : "View 940"}</button>
            <button className="btn" disabled={busy !== null} onClick={() => run("940", "download")}>{busy === "940-download" ? "Generating…" : "Download 940"}</button>
            <button className="btn" disabled={busy !== null} onClick={() => run("940", "print")}>{busy === "940-print" ? "Printing…" : "Print 940"}</button>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Form 941 (quarterly federal return)</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" disabled={busy !== null} onClick={() => run("941", "view")}>{busy === "941-view" ? "Opening…" : "View 941"}</button>
            <button className="btn" disabled={busy !== null} onClick={() => run("941", "download")}>{busy === "941-download" ? "Generating…" : "Download 941"}</button>
            <button className="btn" disabled={busy !== null} onClick={() => run("941", "print")}>{busy === "941-print" ? "Printing…" : "Print 941"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** How long a revealed secret stays on screen before auto-hiding — long enough to
 *  read and copy, short enough that it doesn't just sit exposed if the tab is left
 *  open. Refreshing the reveal restarts the clock. */
const VAULT_REVEAL_TIMEOUT_MS = 25_000;

interface VaultAccessLogEntry {
  id: number; logged_at: string; user_email: string; secret_id: string | null;
  category: string | null; action: string; result: string; note: string | null;
}

function VaultSection({ clientId }: { clientId: string }) {
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();
  const notify = useNotify();
  const [secrets, setSecrets] = useState<VaultSecret[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ category: "", label: "", agencyName: "", username: "", secret: "", confirmSecret: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const revealTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [showLog, setShowLog] = useState(false);
  const [log, setLog] = useState<VaultAccessLogEntry[] | null>(null);

  function load() {
    api.get<{ secrets: VaultSecret[] }>(`/vault/${clientId}`)
      .then((res) => setSecrets(res.secrets))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the vault."));
  }
  useEffect(load, [clientId]);
  // Timers are per-secret and only ever cleared/replaced on unmount — nothing here
  // depends on component state, so an empty cleanup-only effect is correct.
  useEffect(() => () => { Object.values(revealTimers.current).forEach(clearTimeout); }, []);

  function loadLog() {
    api.get<{ entries: VaultAccessLogEntry[] }>(`/vault/${clientId}/access-log`)
      .then((res) => setLog(res.entries))
      .catch(() => setLog([]));
  }
  function toggleLog() {
    const next = !showLog;
    setShowLog(next);
    if (next && !log) loadLog();
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    if (form.secret && form.secret !== form.confirmSecret) {
      setSaveError("Secret Value / Password and Confirm Password don't match.");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/vault/${clientId}`, editingId ? { ...form, secretId: editingId } : form);
      setShowForm(false);
      setEditingId(null);
      setForm({ category: "", label: "", agencyName: "", username: "", secret: "", confirmSecret: "" });
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not save this secret.");
    } finally {
      setSaving(false);
    }
  }

  function handleEditStart(s: VaultSecret) {
    setEditingId(s.secret_id);
    setSaveError(null);
    setForm({ category: s.category, label: s.label, agencyName: s.agency_name || "", username: s.username || "", secret: "", confirmSecret: "" });
    setShowForm(true);
  }

  function handleFormCancel() {
    setShowForm(false);
    setEditingId(null);
    setSaveError(null);
    setForm({ category: "", label: "", agencyName: "", username: "", secret: "", confirmSecret: "" });
  }

  async function handleReveal(secretId: string) {
    const reason = await promptFor({
      title: "Reveal secret",
      message: "Why are you revealing this secret? This is required and logged with this access.",
      placeholder: "e.g. Logging into MD Tax Connect for the client",
    });
    if (reason === null) return;
    try {
      const res = await api.get<{ secret: string }>(`/vault/${clientId}/${secretId}/reveal?reason=${encodeURIComponent(reason)}`);
      setRevealed((prev) => ({ ...prev, [secretId]: res.secret }));
      clearTimeout(revealTimers.current[secretId]);
      revealTimers.current[secretId] = setTimeout(() => {
        setRevealed((prev) => { const next = { ...prev }; delete next[secretId]; return next; });
      }, VAULT_REVEAL_TIMEOUT_MS);
      if (showLog) loadLog();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not decrypt this secret.");
    }
  }

  async function handleDelete(secretId: string) {
    const ok = await confirmDialog({
      title: "Delete vault item",
      message: "The encrypted value cannot be recovered afterward.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(`/vault/${clientId}/${secretId}/delete`, {});
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this item.");
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Secure Vault</h2>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-sm" onClick={toggleLog}>{showLog ? "Hide Access Log" : "Access Log"}</button>
          <button className="btn btn-sm" onClick={() => { if (showForm) { handleFormCancel(); } else { setEditingId(null); setSaveError(null); setForm({ category: "", label: "", agencyName: "", username: "", secret: "", confirmSecret: "" }); setShowForm(true); } }}>{showForm ? "Cancel" : "Add Secret"}</button>
        </div>
      </div>
      <p className="muted" style={{ marginBottom: 12 }}>
        Encrypted server-side. Every view is logged and requires a reason, and auto-hides after {VAULT_REVEAL_TIMEOUT_MS / 1000}s.
        Vault records are excluded from profiles, notes, exports, and statement PDFs.
      </p>
      {error && <ErrorBanner error={error} />}
      {showLog && (
        <div style={{ marginBottom: 16, borderBottom: "1px solid var(--line)", paddingBottom: 16 }}>
          {!log ? (
            <p className="muted" style={{ fontSize: 12.5 }}>Loading…</p>
          ) : log.length === 0 ? (
            <p className="muted" style={{ fontSize: 12.5 }}>No access recorded yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 6, maxHeight: 220, overflowY: "auto" }}>
              {log.map((entry) => (
                <div key={entry.id} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span>
                    <strong>{entry.action}</strong>{entry.category ? ` · ${entry.category}` : ""} — {entry.user_email}
                    {entry.note && <span className="muted"> ({entry.note})</span>}
                  </span>
                  <span className="muted" style={{ whiteSpace: "nowrap" }}>{new Date(entry.logged_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {showForm && (
        <form onSubmit={handleSave} autoComplete="off" style={{ marginBottom: 16, borderBottom: "1px solid var(--line)", paddingBottom: 16 }}>
          {saveError && <ErrorBanner error={saveError} />}
          <div className="field"><label htmlFor="cd-secret-category">Category</label><input id="cd-secret-category" required autoComplete="off" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. State Portal" /></div>
          <div className="field"><label htmlFor="cd-secret-label">Label</label><input id="cd-secret-label" required autoComplete="off" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. MD Tax Connect Login" /></div>
          <div className="field"><label htmlFor="cd-secret-agency-name">Agency Name</label><input id="cd-secret-agency-name" autoComplete="off" value={form.agencyName} onChange={(e) => setForm((f) => ({ ...f, agencyName: e.target.value }))} /></div>
          <div className="field"><label htmlFor="cd-secret-username">User ID / Username</label><input id="cd-secret-username" autoComplete="off" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} placeholder="e.g. the login username, not the password" /></div>
          <div className="field">
            <label htmlFor="cd-secret-value">Secret Value / Password</label>
            <input
              id="cd-secret-value"
              type="password"
              required={!editingId}
              autoComplete="new-password"
              value={form.secret}
              onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
              placeholder={editingId ? "Leave blank to keep the current value" : undefined}
            />
          </div>
          <div className={`field${form.confirmSecret && form.secret !== form.confirmSecret ? " invalid" : ""}`}>
            <label htmlFor="cd-secret-confirm">Confirm Password</label>
            <input
              id="cd-secret-confirm"
              type="password"
              required={!!form.secret}
              autoComplete="new-password"
              value={form.confirmSecret}
              onChange={(e) => setForm((f) => ({ ...f, confirmSecret: e.target.value }))}
              placeholder="Re-enter the value above"
            />
          </div>
          <button type="submit" className={`btn btn-primary${saving ? " btn-loading" : ""}`} disabled={saving}>{saving ? "Saving…" : editingId ? "Save Changes" : "Save Secret"}</button>
        </form>
      )}
      {secrets && secrets.length === 0 && <p className="muted">No secrets stored for this client.</p>}
      {secrets && secrets.map((s) => (
        <div key={s.secret_id} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>{s.label}</strong>
              <span className="muted"> · {s.category}</span>
              {s.username && <span className="muted"> · User ID: {s.username}</span>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-sm" onClick={() => handleReveal(s.secret_id)}>{revealed[s.secret_id] ? "Refresh" : "Reveal"}</button>
              <button className="btn btn-sm" onClick={() => handleEditStart(s)}>Edit</button>
              <button className="btn btn-sm btn-danger" onClick={() => handleDelete(s.secret_id)}>Delete</button>
            </div>
          </div>
          {revealed[s.secret_id] && (
            <div style={{ marginTop: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "monospace", background: "var(--surface)", padding: 8, borderRadius: 6 }}>
                <span>{revealed[s.secret_id]}</span>
                <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard.writeText(revealed[s.secret_id])}>Copy</button>
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>Hides automatically in {VAULT_REVEAL_TIMEOUT_MS / 1000}s.</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const BANK_TYPES = ["ACH", "Check", "Wire"];
const CARD_BRANDS = ["Visa", "Mastercard", "American Express", "Discover", "Other"];
const EXP_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const EXP_YEARS = Array.from({ length: 15 }, (_, i) => new Date().getFullYear() + i);

const PAYMENT_METHOD_FORM_DEFAULTS = {
  paymentMethodId: "", methodName: "", methodType: "ACH", bankName: "", routingNumber: "", accountNumber: "", confirmAccountNumber: "",
  phone: "", cardBrand: "Visa", cardholderName: "", cardLast4: "", cardExpMonth: "", cardExpYear: "",
  defaultForPayroll: false, defaultForInvoices: false,
};

function PaymentMethodsSection({ clientId }: { clientId: string }) {
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(PAYMENT_METHOD_FORM_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, { accountNumber: string | null; routingNumber: string | null }>>({});

  const isBankType = BANK_TYPES.includes(form.methodType);
  const isCardType = form.methodType === "Credit Card";

  function load() {
    api.get<{ paymentMethods: PaymentMethod[] }>(`/payment-methods/${clientId}`)
      .then((res) => setMethods(res.paymentMethods))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load payment methods."));
  }
  useEffect(load, [clientId]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/payment-methods", { ...form, clientId });
      setShowForm(false);
      setForm(PAYMENT_METHOD_FORM_DEFAULTS);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not save this payment method.");
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(m: PaymentMethod) {
    setForm({
      paymentMethodId: m.payment_method_id, methodName: m.method_name, methodType: m.method_type,
      bankName: "", routingNumber: "", accountNumber: "", confirmAccountNumber: "",
      phone: m.phone || "", cardBrand: m.card_brand || "Visa", cardholderName: m.cardholder_name || "",
      cardLast4: m.card_last4 || "", cardExpMonth: m.card_exp_month ? String(m.card_exp_month) : "",
      cardExpYear: m.card_exp_year ? String(m.card_exp_year) : "",
      defaultForPayroll: m.default_for_payroll, defaultForInvoices: m.default_for_invoices,
    });
    setShowForm(true);
  }

  async function handleDelete(paymentMethodId: string) {
    const ok = await confirmDialog({ title: "Delete payment method", message: "This can't be undone.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.post(`/payment-methods/${clientId}/${paymentMethodId}/delete`, {});
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this payment method.");
    }
  }

  async function handleReveal(paymentMethodId: string) {
    try {
      const res = await api.get<{ accountNumber: string | null; routingNumber: string | null }>(`/payment-methods/${clientId}/${paymentMethodId}/reveal`);
      setRevealed((prev) => ({ ...prev, [paymentMethodId]: res }));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not decrypt this payment method.");
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Payment Methods</h2>
        <button className="btn btn-sm" onClick={() => { setForm(PAYMENT_METHOD_FORM_DEFAULTS); setShowForm((v) => !v); }}>{showForm ? "Cancel" : "Add Method"}</button>
      </div>
      <p className="muted" style={{ marginBottom: 12 }}>Account/routing numbers are encrypted; only the last 4 digits are ever shown. Credit cards are stored as a reference only (brand, name, last 4, expiry) — never a full card number or CVV. Mark one method "Default for Payroll" so paychecks pick up its bank info automatically.</p>
      {error && <ErrorBanner error={error} />}
      {showForm && (
        <form onSubmit={handleSave} style={{ marginBottom: 16, borderBottom: "1px solid var(--line)", paddingBottom: 16 }}>
          {form.paymentMethodId && <strong style={{ display: "block", marginBottom: 8, fontSize: 13 }}>Editing {form.methodName}</strong>}
          <div className="field"><label htmlFor="cd-pm-method-name">Method Name</label><input id="cd-pm-method-name" required value={form.methodName} onChange={(e) => setForm((f) => ({ ...f, methodName: e.target.value }))} placeholder="e.g. Chase Checking" /></div>
          <div className="field"><label htmlFor="cd-pm-method-type">Type</label><select id="cd-pm-method-type" value={form.methodType} onChange={(e) => setForm((f) => ({ ...f, methodType: e.target.value }))}><option>ACH</option><option>Check</option><option>Wire</option><option>Credit Card</option></select></div>
          <div className="field"><label htmlFor="cd-pm-phone">Phone</label><input id="cd-pm-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="Contact for this payment method" /></div>
          {isBankType && (
            <>
              {form.paymentMethodId && <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>Leave bank fields blank to keep the numbers already on file — only fill them in to replace them.</p>}
              <div className="field"><label htmlFor="cd-pm-bank-name">Bank Name{form.paymentMethodId ? " (leave blank to keep current)" : ""}</label><input id="cd-pm-bank-name" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} /></div>
              <div className="field"><label htmlFor="cd-pm-routing-number">Routing Number{form.paymentMethodId ? " (leave blank to keep current)" : ""}</label><input id="cd-pm-routing-number" value={form.routingNumber} onChange={(e) => setForm((f) => ({ ...f, routingNumber: e.target.value }))} /></div>
              <div className="field"><label htmlFor="cd-pm-account-number">Account Number{form.paymentMethodId ? " (leave blank to keep current)" : ""}</label><input id="cd-pm-account-number" value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} /></div>
              <div className="field"><label htmlFor="cd-pm-confirm-account-number">Confirm Account Number</label><input id="cd-pm-confirm-account-number" value={form.confirmAccountNumber} onChange={(e) => setForm((f) => ({ ...f, confirmAccountNumber: e.target.value }))} /></div>
            </>
          )}
          {isCardType && (
            <>
              <div className="field"><label htmlFor="cd-pm-cardholder-name">Cardholder Name</label><input id="cd-pm-cardholder-name" value={form.cardholderName} onChange={(e) => setForm((f) => ({ ...f, cardholderName: e.target.value }))} /></div>
              <div className="field"><label htmlFor="cd-pm-card-brand">Card Brand</label><select id="cd-pm-card-brand" value={form.cardBrand} onChange={(e) => setForm((f) => ({ ...f, cardBrand: e.target.value }))}>{CARD_BRANDS.map((b) => <option key={b}>{b}</option>)}</select></div>
              <div className="field"><label htmlFor="cd-pm-card-last4">Last 4 Digits</label><input id="cd-pm-card-last4" value={form.cardLast4} maxLength={4} onChange={(e) => setForm((f) => ({ ...f, cardLast4: e.target.value.replace(/\D/g, "") }))} placeholder="1234" /></div>
              <div className="form-grid">
                <div className="field"><label htmlFor="cd-pm-card-exp-month">Expiry Month</label><select id="cd-pm-card-exp-month" value={form.cardExpMonth} onChange={(e) => setForm((f) => ({ ...f, cardExpMonth: e.target.value }))}><option value="">—</option>{EXP_MONTHS.map((m) => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}</select></div>
                <div className="field"><label htmlFor="cd-pm-card-exp-year">Expiry Year</label><select id="cd-pm-card-exp-year" value={form.cardExpYear} onChange={(e) => setForm((f) => ({ ...f, cardExpYear: e.target.value }))}><option value="">—</option>{EXP_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>No payment processor is connected, so this can't be charged from here — it's a reference for staff only. We never ask for or store the full card number or CVV.</p>
            </>
          )}
          <div style={{ display: "flex", gap: 16, margin: "4px 0 12px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={form.defaultForPayroll} onChange={(e) => setForm((f) => ({ ...f, defaultForPayroll: e.target.checked }))} />
              Default for Payroll
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={form.defaultForInvoices} onChange={(e) => setForm((f) => ({ ...f, defaultForInvoices: e.target.checked }))} />
              Default for Invoices
            </label>
          </div>
          <button type="submit" className={`btn btn-primary${saving ? " btn-loading" : ""}`} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </form>
      )}
      {methods && methods.length === 0 && <p className="muted">No payment methods on file.</p>}
      {methods && methods.map((m) => {
        const isBank = BANK_TYPES.includes(m.method_type);
        const isCard = m.method_type === "Credit Card";
        const rev = revealed[m.payment_method_id];
        return (
          <div key={m.payment_method_id} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong>{m.method_name}</strong>
                <span className="muted">
                  {" · "}{m.method_type}
                  {isCard
                    ? ` · ${m.card_brand || "Card"} ****${m.card_last4 || "----"}${m.card_exp_month && m.card_exp_year ? ` exp ${String(m.card_exp_month).padStart(2, "0")}/${m.card_exp_year}` : ""}`
                    : ` · ****${m.bank_last4 || "----"}`}
                  {m.phone ? ` · ${m.phone}` : ""}
                </span>
                {m.default_for_payroll && <span className="badge" style={{ marginLeft: 8 }}>Payroll default</span>}
                {m.default_for_invoices && <span className="badge" style={{ marginLeft: 8 }}>Invoice default</span>}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {isBank && isAdmin && <button className="btn btn-sm" onClick={() => handleReveal(m.payment_method_id)}>{rev ? "Refresh" : "Reveal"}</button>}
                <button className="btn btn-sm" onClick={() => handleEdit(m)}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(m.payment_method_id)}>Delete</button>
              </div>
            </div>
            {rev && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, fontFamily: "monospace", background: "var(--surface)", padding: 8, borderRadius: 6 }}>
                <span>Routing {rev.routingNumber || "—"} · Account {rev.accountNumber || "—"}</span>
                <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard.writeText(rev.accountNumber || "")}>Copy Account #</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DetailRow({ label, value, multiline }: { label: string; value: string | null | undefined; multiline?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13, gap: 12 }}>
      <span className="muted">{label}</span>
      <span style={{ textAlign: "right", whiteSpace: multiline ? "pre-wrap" : "normal" }}>{value || "—"}</span>
    </div>
  );
}

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

/**
 * Read-only — this client's own invoices. Creating invoices/sales receipts and
 * every real action (void, print, record payment) stays on the firm-wide
 * Billing page and the invoice's own detail page; this tab is purely "what's
 * on file for this client," same read-only-list-then-drill-in pattern as the
 * trimmed global Documents/Communications pages.
 */
function ClientBillingSection({ clientId, clientName }: { clientId: string; clientName: string }) {
  const navigate = useNavigate();
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [statementBusy, setStatementBusy] = useState<"view" | "download" | "print" | null>(null);
  const [unbilledTime, setUnbilledTime] = useState<{ count: number; amount: number } | null>(null);
  const [creatingFromTime, setCreatingFromTime] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState("");

  useEffect(() => {
    api.get<{ invoices: Invoice[] }>("/billing/invoices")
      .then((res) => setInvoices(res.invoices.filter((i) => i.client_id === clientId)))
      .catch(() => setInvoices([]));
  }, [clientId]);

  function loadUnbilledTime() {
    api.get<{ count: number; amount: number }>(`/billing/invoices/from-time/preview?clientId=${encodeURIComponent(clientId)}`)
      .then(setUnbilledTime)
      .catch(() => setUnbilledTime(null));
  }
  useEffect(loadUnbilledTime, [clientId]);

  async function handleCreateFromTime() {
    const ok = await confirmDialog({ title: "Create invoice from time", message: `Create an invoice for ${unbilledTime?.count} approved billable time ${unbilledTime?.count === 1 ? "entry" : "entries"} (${fmtMoney(unbilledTime?.amount)})?` });
    if (!ok) return;
    setCreatingFromTime(true);
    try {
      const res = await api.post<{ invoiceId: string }>("/billing/invoices/from-time", { clientId });
      navigate(`/billing/${res.invoiceId}`);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not create this invoice.");
    } finally {
      setCreatingFromTime(false);
    }
  }

  async function handleStatement(mode: "view" | "download" | "print") {
    setStatementBusy(mode);
    try {
      if (mode === "view") await viewFile(`/billing/clients/${clientId}/statement`);
      else if (mode === "print") await printFile(`/billing/clients/${clientId}/statement`);
      else await downloadFile(`/billing/clients/${clientId}/statement`, buildFilename([clientName, "Statement"], "pdf"));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not generate this statement.");
    } finally {
      setStatementBusy(null);
    }
  }

  const openBalance = (invoices || [])
    .filter((i) => !["paid", "void"].includes(String(i.status || "").toLowerCase()))
    .reduce((sum, i) => sum + Number(i.balance_due || 0), 0);
  const iq = invoiceSearch.trim().toLowerCase();
  const filteredInvoices = iq ? (invoices || []).filter((i) => [i.invoice_id, i.description, i.status].some((v) => String(v || "").toLowerCase().includes(iq))) : (invoices || []);

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", gap: 8 }}>
        <div>
          <strong style={{ fontSize: 14 }}>Billing</strong>
          <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{invoices ? `${filteredInvoices.length} of ${invoices.length}` : 0} invoice(s) · {fmtMoney(openBalance)} open balance</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="text" placeholder="Search invoices…" value={invoiceSearch} onChange={(e) => setInvoiceSearch(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", width: 160 }} />
          {Boolean(unbilledTime?.count) && (
            <button className="btn btn-sm btn-primary" disabled={creatingFromTime} onClick={handleCreateFromTime}>
              {creatingFromTime ? "Creating…" : `Create Invoice from Unbilled Time (${unbilledTime!.count}, ${fmtMoney(unbilledTime!.amount)})`}
            </button>
          )}
          <button className="btn btn-sm" disabled={statementBusy !== null} onClick={() => handleStatement("view")}>{statementBusy === "view" ? "Opening…" : "View Statement"}</button>
          <button className="btn btn-sm" disabled={statementBusy !== null} onClick={() => handleStatement("download")}>{statementBusy === "download" ? "Generating…" : "Download PDF"}</button>
          <button className="btn btn-sm" disabled={statementBusy !== null} onClick={() => handleStatement("print")}>{statementBusy === "print" ? "Printing…" : "Print Statement"}</button>
        </div>
      </div>
      {!invoices ? (
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>Loading…</p>
      ) : (
        <div className="table-scroll card-table">
          <table>
            <thead><tr><th scope="col">Invoice</th><th scope="col">Date</th><th scope="col">Due</th><th scope="col">Description</th><th scope="col">Amount</th><th scope="col">Balance</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {filteredInvoices.map((inv) => (
                <tr key={inv.invoice_id} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => navigate(`/billing/${inv.invoice_id}`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/billing/${inv.invoice_id}`); } }}>
                  <td data-label="Invoice">{inv.invoice_id}</td>
                  <td className="muted" data-label="Date">{fmtDateOnly(inv.invoice_date)}</td>
                  <td className="muted" data-label="Due">{fmtDateOnly(inv.due_date)}</td>
                  <td className="muted" data-label="Description">{inv.description}</td>
                  <td data-label="Amount">{fmtMoney(inv.total_amount)}</td>
                  <td data-label="Balance">{fmtMoney(inv.balance_due)}</td>
                  <td data-label="Status"><StatusBadge status={inv.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {invoices && invoices.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No invoices for this client yet.</p>}
      {invoices && invoices.length > 0 && filteredInvoices.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No invoices match "{invoiceSearch}".</p>}
      <p className="muted" style={{ fontSize: 12, margin: "10px 16px 12px" }}>
        Click a row to open the invoice. Looking to create an invoice or sales receipt? Use the firm-wide Billing page.
      </p>
    </div>
  );
}

interface ClientTaxRow {
  task_id: string; task_name: string; client_id: string; agency_due_date: string | null; paid_date: string | null;
  payment_amount: string | number | null; confirmation_number: string | null; status: string;
}

/** Read-only — same client-owed-tax-obligation data (payment_required tasks) as the firm-wide Billing page's Client Tax Payment Tracking panel, scoped to just this client. */
function ClientTaxPaymentsSection({ clientId }: { clientId: string }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ClientTaxRow[] | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get<{ rows: ClientTaxRow[] }>("/billing/client-tax-payments")
      .then((res) => setRows(res.rows.filter((r) => r.client_id === clientId)))
      .catch(() => setRows([]));
  }, [clientId]);

  const q = search.trim().toLowerCase();
  const filteredRows = q ? (rows || []).filter((r) => [r.task_name, r.status, r.confirmation_number, r.payment_amount].some((v) => String(v || "").toLowerCase().includes(q))) : (rows || []);

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", gap: 8 }}>
        <strong style={{ fontSize: 14 }}>Tax Payments</strong>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="text" placeholder="Search payments…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", width: 160 }} />
          <span className="muted" style={{ fontSize: 12 }}>{rows ? `${filteredRows.length} of ${rows.length}` : 0} row(s)</span>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "10px 16px 0" }}>
        Tax obligations this client owes agencies directly (sales tax, payroll tax deposits, etc.) — tracked from
        this client's own tasks, separate from AL TAX's own invoices to this client.
      </p>
      {!rows ? (
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>Loading…</p>
      ) : (
        <div className="table-scroll card-table">
          <table>
            <thead><tr><th scope="col">Payment / Due</th><th scope="col">Due / Paid</th><th scope="col">Expected</th><th scope="col">Paid</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.task_id} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => navigate(`/tasks/${r.task_id}`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/tasks/${r.task_id}`); } }}>
                  <td data-label="Payment / Due">{r.task_name}</td>
                  <td className="muted" data-label="Due / Paid">{fmtDateOnly(r.paid_date || r.agency_due_date)}</td>
                  <td data-label="Expected">{fmtMoney(r.payment_amount)}</td>
                  <td className="muted" data-label="Paid">{r.paid_date ? "Yes" : "No"}</td>
                  <td data-label="Status"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No tax payment tracking rows for this client yet.</p>}
      {rows && rows.length > 0 && filteredRows.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No payments match "{search}".</p>}
    </div>
  );
}

interface ActivityRow {
  id: string; type: string; note: string | null; occurred_at: string; logged_by: string | null; source: "log" | "communication";
}

// "Note" comes first and is the default selection — a general client note
// (preferences, account context, a heads-up for whoever works this client
// next) is the most common reason to open this form, distinct from logging
// a specific interaction.
const ACTIVITY_TYPES = ["Note", "Phone Call", "In-Person Meeting", "Video Call", "Voicemail", "Other"];

/**
 * Manually-logged interaction timeline ("Called about Q3 estimate," "In-person
 * meeting," etc.) merged with actual sent Communications, so staff have one combined
 * view of every touchpoint with this client instead of checking two places. Sits
 * above ClientMessages in the same Communications tab rather than its own tab —
 * these are two views of the same relationship history, not separate concerns.
 */
function ClientActivitySection({ clientId, autoOpen }: { clientId: string; autoOpen?: boolean }) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set once from the ?open=note deep link (e.g. the Clients list "Add Note"
  // action) — this section only mounts when the Notes tab is active, so the
  // initial value is enough; no need to react to autoOpen changing later.
  const [adding, setAdding] = useState(Boolean(autoOpen));
  const [activityType, setActivityType] = useState(ACTIVITY_TYPES[0]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  function load() {
    api.get<{ activity: ActivityRow[] }>(`/clients/${clientId}/activity`)
      .then((res) => setRows(res.activity))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load activity."));
  }
  useEffect(load, [clientId]);
  useEffect(() => {
    // Fire-and-forget: this tab is the one true "staff looked at the client's
    // notes" signal for the panel's Client Note unread counter — no need to
    // block the list render on it, and a failure here is a passive side
    // effect, not something worth surfacing as a user-facing error. The
    // panel is a separate mount with its own already-fetched counts, so a
    // window event is how it learns to refresh without a full client reselect.
    api.post(`/clients/${clientId}/activity/mark-read`, {})
      .then(() => window.dispatchEvent(new CustomEvent("altax:notes-read", { detail: { clientId } })))
      .catch(() => {});
  }, [clientId]);

  async function handleAdd() {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await api.post(`/clients/${clientId}/activity`, { activityType, note: note.trim() });
      setNote("");
      setAdding(false);
      toast("Logged.");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not log this activity.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: ActivityRow) {
    if (row.source !== "log") return;
    const ok = await confirmDialog({ title: "Delete activity entry", message: "Delete this activity entry?", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.post(`/clients/${clientId}/activity/${row.id}/delete`, {});
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this entry.");
    }
  }

  const q = search.trim().toLowerCase();
  const filteredRows = q ? (rows || []).filter((r) => [r.type, r.note, r.logged_by].some((v) => String(v || "").toLowerCase().includes(q))) : (rows || []);

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", gap: 8 }}>
        <strong style={{ fontSize: 14 }}>Activity Timeline</strong>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="text" placeholder="Search activity…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", width: 180 }} />
          <button type="button" className="btn btn-sm" onClick={() => setAdding((v) => !v)}>{adding ? "Cancel" : "+ Log Activity"}</button>
        </div>
      </div>
      {error && <div style={{ padding: 16 }}><ErrorBanner error={error} /></div>}
      {adding && (
        <div style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ margin: 0, maxWidth: 180 }}>
            <label htmlFor="cd-activity-type">Type</label>
            <select id="cd-activity-type" value={activityType} onChange={(e) => setActivityType(e.target.value)}>
              {ACTIVITY_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 220 }}>
            <label htmlFor="cd-activity-note">Note</label>
            <input id="cd-activity-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Prefers email over calls, or: Called about Q3 estimate" />
          </div>
          <button type="button" className="btn btn-primary btn-sm" disabled={saving || !note.trim()} onClick={handleAdd}>{saving ? "Saving…" : "Save"}</button>
        </div>
      )}
      {!rows ? (
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>No activity logged for this client yet.</p>
      ) : filteredRows.length === 0 ? (
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>No activity matches "{search}".</p>
      ) : (
        <div className="table-scroll card-table">
          <table>
            <thead><tr><th scope="col">When</th><th scope="col">Type</th><th scope="col">Note</th><th scope="col">By</th><th scope="col"></th></tr></thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id}>
                  <td className="muted" data-label="When">{new Date(r.occurred_at).toLocaleString()}</td>
                  <td data-label="Type">{r.type}{r.source === "communication" ? " (sent)" : ""}</td>
                  <td data-label="Note">{r.note || "—"}</td>
                  <td className="muted" data-label="By">{r.logged_by || "—"}</td>
                  <td>{r.source === "log" && <button type="button" className="link-button" onClick={() => handleDelete(r)}>Delete</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface TaskNoteRow {
  id: string; task_id: string; task_name: string; task_status: string;
  note: string | null; sent_at: string; sent_by: string | null; is_read: boolean;
}

/**
 * Cross-task inbox of Task Notes on this client's open tasks — the destination
 * for the panel's "Task Note" counter. Each row links into its own task's
 * Activity Timeline rather than duplicating the note-writing UI here; reading
 * a note happens there (that's what marks it read), not in this list.
 */
function ClientTaskNotesInboxSection({ clientId }: { clientId: string }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<TaskNoteRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ taskNotes: TaskNoteRow[] }>(`/clients/${clientId}/task-notes`)
      .then((res) => setRows(res.taskNotes))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load task notes."));
  }, [clientId]);

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
        <strong style={{ fontSize: 14 }}>Task Notes</strong>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
          Notes left on this client's open tasks — click through to a task's own Activity Timeline to read it.
        </div>
      </div>
      {error && <div style={{ padding: 16 }}><ErrorBanner error={error} /></div>}
      {!rows ? (
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted" style={{ padding: 16, textAlign: "center" }}>No task notes on this client's open tasks.</p>
      ) : (
        <div className="table-scroll card-table">
          <table>
            <thead><tr><th scope="col"></th><th scope="col">Task</th><th scope="col">Note</th><th scope="col">By</th><th scope="col">When</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={r.is_read ? undefined : { fontWeight: 700 }}>
                  <td>{!r.is_read && <span className="badge" style={{ minHeight: 0, padding: "2px 7px", fontSize: 10 }}>Unread</span>}</td>
                  <td data-label="Task">
                    <button type="button" className="link-button" onClick={() => navigate(`/tasks/${r.task_id}?open=note`)}>
                      {r.task_name || r.task_id}
                    </button>
                  </td>
                  <td data-label="Note">{r.note || "—"}</td>
                  <td className="muted" data-label="By">{r.sent_by || "—"}</td>
                  <td className="muted" data-label="When">{new Date(r.sent_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
