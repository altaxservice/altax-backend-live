import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { Building2, MapPin, FileText, UserRound, Briefcase, ClipboardList, StickyNote, PanelLeftClose, PanelLeft } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { Client } from "../api/types";
import type { PortalUser } from "../api/types2";
import { StatusBadge } from "../components/StatusBadge";
import { useSelectedClient } from "../context/SelectedClientContext";
import { useAuth } from "../auth/AuthContext";
import { ActionMenu, type ActionMenuOption } from "../components/ActionMenu";
import { FilterBar, exportCsv } from "../components/FilterBar";
import { useToast } from "../components/Toast";
import { useConfirm, useNotify } from "../components/ConfirmProvider";
import { UploadFileModal } from "../components/UploadFileModal";
import { useStickyState } from "../utils/listState";
import { saveListOrder } from "../utils/listNav";
import { RequestDocumentModal } from "../components/RequestDocumentModal";
import { US_STATES, ENTITY_TYPES, SERVICE_TYPES, deriveServiceType, INDUSTRY_CATEGORIES, servicesForClientType, FREQ_OPTIONS, PAYROLL_FREQS, PAYROLL_PROVIDERS, RETURN_TYPES, LANGUAGES, CONTACT_PREFS, REFERRAL_SOURCES } from "../utils/clientOptions";
import { AddressFields } from "../components/AddressFields";
import { ErrorBanner } from "../components/ErrorBanner";
import { DraftRestoreBanner } from "../components/DraftRestoreBanner";
import { useFormDraft } from "../hooks/useFormDraft";
import { LabelChips, LabelPicker, useEntityLabels } from "../components/Labels";

const EMPTY_CLIENT_FORM = {
  clientName: "", dbaName: "", status: "Active", clientType: "Business", entityType: "", dateOfFormation: "", state: "", industryCategory: "", services: [] as string[],
  salesTaxFrequency: "", salesTaxRegisteredSince: "", payrollEnabled: false, payrollFrequency: "", payrollSystem: "", eftpsEnabled: false, eftpsRegisteredSince: "",
  mdWithholdingFrequency: "", mdWithholdingRegisteredSince: "", mduiEnabled: false, mduiRegisteredSince: "", mdUiEmployerId: "", mdUiTaxRate: "", mdAnnualReportEnabled: false, businessReturnType: "", w21099Enabled: false,
  assignedTo: "", email: "", phone: "", streetAddress: "", city: "", zipCode: "",
  preferredLanguage: "English", smsAllowed: false, emailAllowed: true, preferredContact: "Email",
  ein: "", stateTaxId: "", secretaryOfStateId: "", craRegistrationNumber: "", companyContactName: "", companyContactTitle: "", companyContactSsn: "",
  companyContactEmail: "", companyContactPhone: "", individualSsn: "", notes: "", referralSource: "",
  companyContactStreetAddress: "", companyContactCity: "", companyContactState: "", companyContactZipCode: "",
};

// Shape accepted from an external entry point that wants to open this page's
// Add Client form pre-seeded — currently only Pipeline's "Skip Pipeline — Add
// as Client" shortcut (PipelinePage.tsx's NewProspectModal), passed via
// router navigation state (not the URL — keeps contact PII out of the query
// string/history) alongside the existing `?new=1` param that already opens
// this form for any external caller.
export type ClientFormPrefill = Partial<typeof EMPTY_CLIENT_FORM>;

const QUICK_TABS: { key: string; label: string; test: (c: Client) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "active", label: "Active", test: (c) => String(c.status || "").toLowerCase() === "active" },
  { key: "business", label: "Business", test: (c) => String(c.client_type || "").toLowerCase() === "business" },
  { key: "individual", label: "Individual", test: (c) => String(c.client_type || "").toLowerCase() === "individual" },
  { key: "payroll", label: "Payroll", test: (c) => Boolean(c.payroll_enabled) },
  { key: "salestax", label: "Sales Tax", test: (c) => Boolean(c.sales_tax_frequency) && String(c.sales_tax_frequency).toLowerCase() !== "n/a" },
  { key: "portal", label: "Portal", test: (c) => Boolean(c.portal_enabled) },
];

type SortKey = "client_name" | "client_type" | "assigned_to" | "status";

function maskedSsnDisplay(v: unknown): string {
  const s = String(v || "").trim();
  return s || "";
}

function responsibleCell(c: Client): { primary: string; secondary: string; empty: boolean } {
  const isBusiness = String(c.client_type || c.entity_type || "").toLowerCase() !== "individual";
  if (isBusiness) {
    const name = String(c.company_contact_name || "").trim();
    const ssn = maskedSsnDisplay(c.company_contact_ssn);
    if (!name) return { primary: "Not assigned", secondary: "", empty: true };
    return { primary: name, secondary: ssn || "SSN not on file", empty: false };
  }
  const ssn = maskedSsnDisplay(c.individual_ssn);
  return { primary: "Individual", secondary: ssn || "SSN not on file", empty: false };
}

/**
 * Collapses the old Service/Sales Tax/Payroll columns into one compact cell —
 * each of those 3 columns was blank ("—"/"N/A") for a large share of 141
 * rows, so showing them as 3 always-present columns was mostly noise. One
 * lead badge (what kind of engagement this is) plus a single muted detail
 * line — not three stacked same-color pills, which is what actually made
 * this column (and every row it sat in) feel dense: three ~24px pills per
 * row versus one pill and one line of text.
 */
function complianceInfo(c: Client): { lead: string | null; detail: string } {
  const lead = c.service_type || null;
  const details: string[] = [];
  if (c.sales_tax_frequency && String(c.sales_tax_frequency).toLowerCase() !== "n/a") {
    details.push(`Sales Tax: ${c.sales_tax_frequency}`);
  }
  if (c.payroll_enabled) {
    details.push(`Payroll${c.payroll_frequency ? `: ${c.payroll_frequency}` : ""}`);
  }
  return { lead, detail: details.join(" · ") };
}

export function ClientsListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { setSelectedClient } = useSelectedClient();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const [searchParams, setSearchParams] = useSearchParams();
  // Read once at mount — a prospect handed off from Pipeline's skip-Estimate
  // shortcut. Consumed only to seed initial state below; not re-read on
  // later renders, so toggling the form closed/open again afterward doesn't
  // keep re-applying it.
  const prospectPrefillRef = useRef<ClientFormPrefill | undefined>((location.state as { prefill?: ClientFormPrefill } | null)?.prefill);
  const [clients, setClients] = useState<Client[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // How the list is arranged sticks for the session (useStickyState), so opening a
  // client and pressing Back returns you to the list you left — same filters, same
  // sort, with the row you were working on still in it — instead of a default list
  // where that row may not appear at all.
  const [search, setSearch] = useStickyState("clients.search", searchParams.get("search") || "");
  // Inactive/Archived clients are noise on the page every staff member opens dozens of
  // times a day — default to Active only. Still fully reachable: the Status dropdown
  // includes every real status value, so switching back to "all"/"Inactive"/"Archived"
  // is one click away, nothing is hidden permanently.
  const [statusFilter, setStatusFilter] = useStickyState("clients.status", "Active");
  const [ownerFilter, setOwnerFilter] = useStickyState("clients.owner", "all");
  const [typeFilter, setTypeFilter] = useStickyState("clients.type", "all");
  const [serviceFilter, setServiceFilter] = useStickyState("clients.service", "all");
  const [payrollProviderFilter, setPayrollProviderFilter] = useStickyState("clients.payrollProvider", "all");
  const [labelFilter, setLabelFilter] = useStickyState("clients.label", "all");
  const [stateFilter, setStateFilter] = useStickyState("clients.state", "all");
  const [industryFilter, setIndustryFilter] = useStickyState("clients.industry", "all");
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [quickTab, setQuickTab] = useStickyState("clients.tab", "all");
  const [sortKey, setSortKey] = useStickyState<SortKey>("clients.sortKey", "client_name");
  const [sortDir, setSortDir] = useStickyState<"asc" | "desc">("clients.sortDir", "asc");
  const [showForm, setShowForm] = useState(searchParams.get("new") === "1" || Boolean(prospectPrefillRef.current));
  const [form, setForm] = useState(() => (prospectPrefillRef.current ? { ...EMPTY_CLIENT_FORM, ...prospectPrefillRef.current } : EMPTY_CLIENT_FORM));
  const [createPortalNow, setCreatePortalNow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [inviteInfo, setInviteInfo] = useState<{ clientName: string; email?: string; inviteLink?: string; inviteEmailed?: boolean; inviteEmailError?: string } | null>(null);
  const [uploadFor, setUploadFor] = useState<{ clientId: string; clientName: string } | null>(null);
  const [requestDocFor, setRequestDocFor] = useState<{ clientId: string; clientName: string } | null>(null);
  const [staffOptions, setStaffOptions] = useState<string[]>([]);
  // Quick-launch selects (Assignment & Forms section) — not part of the
  // client record itself, just which generator modal to jump straight into
  // right after this client is created. See handleCreate's navigate() call.
  const [quickGovForms, setQuickGovForms] = useState<string[]>([]);
  const [quickAuthForms, setQuickAuthForms] = useState<string[]>([]);
  const [govFormTypes, setGovFormTypes] = useState<{ value: string; label: string }[]>([]);
  const [authFormTypes, setAuthFormTypes] = useState<{ value: string; label: string }[]>([]);
  // Free-text escape for the fixed Services Provided list — the firm keeps hitting
  // engagements that don't map onto a predefined option, and previously the only
  // way to add one was a code change.
  const [customServices, setCustomServices] = useState<string[]>([]);
  const [newCustomService, setNewCustomService] = useState("");

  // Add Client jump-nav — sections register themselves in sectionRefs; clicking
  // a nav item scrolls to it, and an IntersectionObserver keeps the nav's
  // "active" highlight in sync with whatever section is actually in view, so
  // the long form (previously one continuous scroll with no orientation) reads
  // like a set of clearly labeled, jumpable stops instead.
  const [activeSection, setActiveSection] = useState("identity");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  function scrollToSection(key: string) {
    sectionRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // Collapse state persists across sessions (shared key with ClientDetailPage's
  // Edit form, same nav pattern) — staff who prefer the extra body width don't
  // have to re-collapse it every time they open the form.
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem("altax_ac_wizard_nav_collapsed") === "1");
  function toggleNavCollapsed() {
    setNavCollapsed((v) => {
      const next = !v;
      localStorage.setItem("altax_ac_wizard_nav_collapsed", next ? "1" : "0");
      return next;
    });
  }
  useEffect(() => {
    if (!showForm) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActiveSection(visible[0].target.id.replace("ac-", ""));
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: [0, 0.25, 0.5, 1] }
    );
    Object.values(sectionRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [showForm, form.clientType]);

  // Autosave — this is the form the "start typing and lose it all" complaint
  // was raised about. One shared slot ("add-client") is enough here: unlike
  // the gov-form/POA modals, there's only ever one Add Client flow open at a
  // time (it's an inline page section, not a stack of modals per record).
  const { pendingDraft: pendingClientDraft, draftChecked: clientDraftChecked, saveDraft: saveClientDraft, clearDraft: clearClientDraft, dismissPendingDraft: dismissClientDraft } = useFormDraft<{
    form: typeof EMPTY_CLIENT_FORM; createPortalNow: boolean; quickGovForms: string[]; quickAuthForms: string[];
    customServices: string[]; newCustomService: string;
  }>(showForm ? "add-client" : null);

  function restoreClientDraft() {
    if (!pendingClientDraft) return;
    const d = pendingClientDraft.data;
    setForm(d.form);
    setCreatePortalNow(d.createPortalNow);
    setQuickGovForms(d.quickGovForms);
    setQuickAuthForms(d.quickAuthForms);
    setCustomServices(d.customServices);
    setNewCustomService(d.newCustomService);
    dismissClientDraft();
  }

  useEffect(() => {
    if (!clientDraftChecked || pendingClientDraft) return;
    saveClientDraft({ form, createPortalNow, quickGovForms, quickAuthForms, customServices, newCustomService });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientDraftChecked, pendingClientDraft, form, createPortalNow, quickGovForms, quickAuthForms, customServices, newCustomService]);

  const canCreate = user?.role === "admin" || user?.role === "staff";
  const { allLabels, byEntity: clientLabels, assign: assignLabel, unassign: unassignLabel } = useEntityLabels("client");
  const isAdmin = user?.role === "admin";

  function load(): Promise<void> {
    return api.get<{ clients: Client[] }>("/clients")
      .then((res) => setClients(res.clients))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load clients."));
  }

  useEffect(() => {
    if (!canCreate) return;
    api.get<{ users: PortalUser[] }>("/users")
      .then((res) => setStaffOptions(Array.from(new Set(res.users.filter((u) => ["admin", "staff"].includes(String(u.role || "").toLowerCase()) && u.active).map((u) => u.name))).sort()))
      .catch(() => {});
    api.get<{ clientFormTypes: { value: string; label: string }[] }>("/gov-forms/meta")
      .then((res) => setGovFormTypes(res.clientFormTypes))
      .catch(() => {});
    api.get<{ formTypes: { value: string; label: string }[] }>("/poa-forms/meta")
      .then((res) => setAuthFormTypes(res.formTypes))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreate]);

  useEffect(() => { load(); }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
      toast("Data refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.clientName.trim()) {
      setNameError("Client name is required.");
      // Also surfaced through the top ErrorBanner (role="alert") — the
      // field-level message alone is silent to screen readers since nothing
      // moves focus to it.
      setSaveError("Client name is required.");
      return;
    }
    setNameError(null);
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.post<{ clientId: string }>("/clients", form);
      setShowForm(false);
      let invite: { clientName: string; email?: string; inviteLink?: string; inviteEmailed?: boolean; inviteEmailError?: string } | null = null;
      if (createPortalNow && form.email) {
        try {
          const inv = await api.post<{ inviteLink?: string; inviteEmailed?: boolean; inviteEmailError?: string }>("/users", {
            role: "client", assignedClientId: res.clientId, email: form.email, name: form.clientName,
          });
          invite = { clientName: form.clientName, email: form.email, inviteLink: inv.inviteLink, inviteEmailed: inv.inviteEmailed, inviteEmailError: inv.inviteEmailError };
        } catch {
          invite = { clientName: form.clientName, email: form.email };
        }
      }
      // Captured before the resets below clear them.
      const genParams = new URLSearchParams();
      quickGovForms.forEach((t) => genParams.append("openGovForm", t));
      quickAuthForms.forEach((t) => genParams.append("openAuthForm", t));
      if (quickGovForms.length || quickAuthForms.length) genParams.set("tab", "Gov Forms");

      setForm(EMPTY_CLIENT_FORM);
      setCreatePortalNow(false);
      setCustomServices([]);
      setNewCustomService("");
      setQuickGovForms([]);
      setQuickAuthForms([]);
      clearClientDraft();
      setSearchParams({});
      await load();
      if (invite) setInviteInfo(invite);
      toast("Client created.");
      setSelectedClient(res.clientId, form.clientName);
      navigate(genParams.toString() ? `/clients/${res.clientId}?${genParams.toString()}` : `/clients/${res.clientId}`);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not create this client.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAction(c: Client, action: string) {
    if (action === "profile") { setSelectedClient(c.client_id, c.client_name); navigate(`/clients/${c.client_id}`); return; }
    if (action === "create-task") { navigate(`/tasks?new=1&clientId=${c.client_id}`); return; }
    if (action === "request-document") { setRequestDocFor({ clientId: c.client_id, clientName: c.client_name }); return; }
    if (action === "upload-document") { setUploadFor({ clientId: c.client_id, clientName: c.client_name }); return; }
    if (action === "review-documents") { setSelectedClient(c.client_id, c.client_name); navigate(`/clients/${c.client_id}?tab=Documents`); return; }
    if (action === "secure-vault") { setSelectedClient(c.client_id, c.client_name); navigate(`/clients/${c.client_id}#vault`); return; }
    if (action === "edit") { setSelectedClient(c.client_id, c.client_name); navigate(`/clients/${c.client_id}?edit=1`); return; }
    if (action === "note") { setSelectedClient(c.client_id, c.client_name); navigate(`/clients/${c.client_id}?tab=${encodeURIComponent("Activity Timeline")}&open=note`); return; }
    if (action === "send-invite") {
      try {
        const res = await api.post<{ inviteLink?: string; inviteEmailed?: boolean; inviteEmailError?: string }>("/users", {
          role: "client", assignedClientId: c.client_id, email: c.email, name: c.client_name,
        });
        setInviteInfo({ clientName: c.client_name, email: c.email ?? undefined, inviteLink: res.inviteLink, inviteEmailed: res.inviteEmailed, inviteEmailError: res.inviteEmailError });
        toast(res.inviteEmailed ? `Invite emailed to ${c.client_name}.` : `Invite created for ${c.client_name}.`);
      } catch (err) {
        await notify(err instanceof ApiError ? err.message : "Could not create a portal invite.");
      }
      return;
    }
    if (action === "archive") {
      const ok = await confirmDialog({ title: "Archive client", message: `Archive ${c.client_name}? This disables their portal and deactivates their portal users.`, confirmLabel: "Archive", danger: true });
      if (!ok) return;
      try {
        await api.post(`/clients/${c.client_id}/archive`, {});
        toast(`${c.client_name} archived.`);
        load();
      } catch (err) {
        await notify(err instanceof ApiError ? err.message : "Could not archive this client.");
      }
    }
  }

  function actionOptions(_c: Client): ActionMenuOption[] {
    const opts: ActionMenuOption[] = [
      { value: "profile", label: "Profile" },
      { value: "create-task", label: "Create Task" },
      { value: "note", label: "Add Note" },
      { value: "request-document", label: "Request Document" },
      { value: "upload-document", label: "Send File to Client" },
      { value: "review-documents", label: "Review Documents" },
    ];
    if (isAdmin) opts.push({ value: "secure-vault", label: "Secure Vault" });
    if (isAdmin) opts.push({ value: "send-invite", label: "Send Portal Invitation" });
    opts.push({ value: "edit", label: "Edit Client" });
    if (isAdmin) opts.push({ value: "archive", label: "Archive Client" });
    return opts;
  }

  const owners = useMemo(() => Array.from(new Set((clients || []).map((c) => c.assigned_to).filter(Boolean))) as string[], [clients]);
  const types = useMemo(() => Array.from(new Set((clients || []).map((c) => c.client_type).filter(Boolean))) as string[], [clients]);
  // Union of the canonical list and whatever's actually stored — building this from
  // live data alone (the old behavior) silently hid any service type no client had
  // been assigned yet, so a newly added one could never be filtered on. The stored
  // half still matters for custom "Other" values typed on the form.
  const services = useMemo(
    () => Array.from(new Set([...SERVICE_TYPES, ...(clients || []).map((c) => c.service_type).filter(Boolean) as string[]])),
    [clients]
  );
  const payrollProviders = useMemo(
    () => Array.from(new Set([...PAYROLL_PROVIDERS, ...(clients || []).map((c) => c.payroll_system).filter(Boolean) as string[]])),
    [clients]
  );
  const statuses = useMemo(() => Array.from(new Set((clients || []).map((c) => c.status).filter(Boolean))) as string[], [clients]);
  const clientStates = useMemo(() => Array.from(new Set((clients || []).map((c) => c.state).filter(Boolean))) as string[], [clients]);
  const industries = useMemo(
    () => Array.from(new Set([...INDUSTRY_CATEGORIES, ...(clients || []).map((c) => c.industry_category).filter(Boolean) as string[]])),
    [clients]
  );
  // Label names, not label_ids, since that's what the FilterBar select renders
  // as both the option value and its display text — safe because label names
  // are firm-unique (sql/030_labels.sql: uq_v3_labels_name).
  const labelNames = useMemo(() => allLabels.map((l) => l.name).sort(), [allLabels]);

  const filtered = useMemo(() => {
    if (!clients) return [];
    const q = search.trim().toLowerCase();
    let rows = clients.filter((c) => {
      if (statusFilter !== "all" && String(c.status || "") !== statusFilter) return false;
      if (ownerFilter !== "all" && String(c.assigned_to || "") !== ownerFilter) return false;
      if (typeFilter !== "all" && String(c.client_type || "") !== typeFilter) return false;
      if (serviceFilter !== "all" && String(c.service_type || "") !== serviceFilter) return false;
      if (payrollProviderFilter !== "all" && String(c.payroll_system || "") !== payrollProviderFilter) return false;
      if (labelFilter !== "all" && !(clientLabels[c.client_id] || []).some((l) => l.name === labelFilter)) return false;
      if (stateFilter !== "all" && String(c.state || "") !== stateFilter) return false;
      if (industryFilter !== "all" && String(c.industry_category || "") !== industryFilter) return false;
      const tab = QUICK_TABS.find((t) => t.key === quickTab);
      if (tab && !tab.test(c)) return false;
      if (q && ![c.client_name, c.client_id, c.email, c.phone, c.assigned_to].some((v) => String(v || "").toLowerCase().includes(q))) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      const av = String(a[sortKey] || "").toLowerCase();
      const bv = String(b[sortKey] || "").toLowerCase();
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [clients, search, statusFilter, ownerFilter, typeFilter, serviceFilter, payrollProviderFilter, labelFilter, stateFilter, industryFilter, clientLabels, quickTab, sortKey, sortDir]);

  // Lets ClientDetailPage's Previous/Next paging step through whatever
  // filtered/sorted order is currently on screen — see utils/listNav.ts.
  useEffect(() => {
    saveListOrder("clients", filtered.map((c) => c.client_id));
  }, [filtered]);

  /**
   * The "report by category" part — counts within whatever's currently
   * filtered/searched, not the whole roster, so narrowing to e.g. "Active"
   * first and then opening this shows the breakdown of just active clients.
   * Grouped by the 4 dimensions a firm owner actually asked about: state,
   * industry, service type, and staff assignment.
   */
  const breakdowns = useMemo(() => {
    function groupBy(getKey: (c: Client) => string | null | undefined): { key: string; count: number }[] {
      const counts = new Map<string, number>();
      for (const c of filtered) {
        const key = getKey(c) || "(not set)";
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return Array.from(counts.entries()).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
    }
    return {
      byState: groupBy((c) => c.state),
      byIndustry: groupBy((c) => c.industry_category),
      byService: groupBy((c) => c.service_type),
      byOwner: groupBy((c) => c.assigned_to),
    };
  }, [filtered]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function sortArrow(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  function handleExport() {
    exportCsv(
      "clients.csv",
      [
        { key: "client_id", label: "Client ID" }, { key: "client_name", label: "Client Name" },
        { key: "client_type", label: "Type" }, { key: "entity_type", label: "Entity Type" },
        { key: "state", label: "State" }, { key: "industry_category", label: "Industry" },
        { key: "email", label: "Email" }, { key: "phone", label: "Phone" },
        { key: "assigned_to", label: "Owner" }, { key: "service_type", label: "Service" },
        { key: "sales_tax_frequency", label: "Sales Tax Frequency" }, { key: "payroll_frequency", label: "Payroll Frequency" },
        { key: "payroll_system", label: "Payroll Provider" },
        { key: "status", label: "Status" }, { key: "portal_enabled", label: "Portal" },
      ],
      filtered as unknown as Record<string, unknown>[]
    );
  }

  const tableTitle = isAdmin ? "Client Master" : "My Client List";

  return (
    <div>
      {canCreate && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Add Client"}</button>
        </div>
      )}

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Name, ID, email, phone…" }}
        selects={[
          { label: "Status", value: statusFilter, options: statuses, onChange: setStatusFilter },
          { label: "Owner", value: ownerFilter, options: owners, onChange: setOwnerFilter },
          { label: "Type", value: typeFilter, options: types, onChange: setTypeFilter },
          { label: "Service", value: serviceFilter, options: services, onChange: setServiceFilter },
          { label: "Payroll Provider", value: payrollProviderFilter, options: payrollProviders, onChange: setPayrollProviderFilter },
          { label: "Label", value: labelFilter, options: labelNames, onChange: setLabelFilter },
          { label: "State", value: stateFilter, options: clientStates, onChange: setStateFilter },
          { label: "Industry", value: industryFilter, options: industries, onChange: setIndustryFilter },
        ]}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        onExportCsv={handleExport}
      />
      <div className="quick-tabs" style={{ margin: "0 0 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {QUICK_TABS.map((t) => (
            <button key={t.key} type="button" className={`quick-tab ${quickTab === t.key ? "active" : ""}`} onClick={() => setQuickTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setShowBreakdown((v) => !v)}>
          {showBreakdown ? "Hide Breakdown" : "Show Breakdown by Category"}
        </button>
      </div>

      {/* The "report by category" view — counts within whatever's currently
          filtered above, across state/industry/service/owner. Reuses the
          filters instead of being a separate report, so "MD clients only,
          broken down by industry" is just: set the State filter, open this. */}
      {showBreakdown && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 10 }}>
            Breakdown of the {filtered.length} client{filtered.length === 1 ? "" : "s"} currently shown (adjust the filters above to narrow this)
          </div>
          <div className="metric-grid">
            {([
              { title: "By State", rows: breakdowns.byState },
              { title: "By Industry", rows: breakdowns.byIndustry },
              { title: "By Service Type", rows: breakdowns.byService },
              { title: "By Owner", rows: breakdowns.byOwner },
            ]).map(({ title, rows }) => (
              <div key={title}>
                <div className="small-label" style={{ marginBottom: 6 }}>{title}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 220, overflowY: "auto" }}>
                  {rows.map((r) => (
                    <div key={r.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, gap: 8 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.key}</span>
                      <span className="muted" style={{ flexShrink: 0 }}>{r.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <ErrorBanner error={error} />}

      {inviteInfo && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--teal)" }}>
          <strong>Portal invite created for {inviteInfo.clientName}.</strong>{" "}
          {inviteInfo.inviteEmailed ? (
            <>Emailed to {inviteInfo.email}.</>
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

      {uploadFor && (
        <UploadFileModal
          clientId={uploadFor.clientId}
          clientName={uploadFor.clientName}
          onClose={() => setUploadFor(null)}
          onDone={() => load()}
        />
      )}

      {requestDocFor && (
        <RequestDocumentModal
          clientId={requestDocFor.clientId}
          clientName={requestDocFor.clientName}
          onClose={() => setRequestDocFor(null)}
          onDone={() => load()}
        />
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ maxWidth: 1180, marginBottom: 24 }}>
          {pendingClientDraft && (
            <DraftRestoreBanner updatedAt={pendingClientDraft.updatedAt} onRestore={restoreClientDraft} onDiscard={() => { clearClientDraft(); dismissClientDraft(); }} />
          )}
          {saveError && <ErrorBanner error={saveError} />}

          <div className={`ac-wizard${navCollapsed ? " nav-collapsed" : ""}`}>
            <nav className="ac-wizard-nav" aria-label="Add Client sections">
              <button
                type="button" className="ac-wizard-nav-toggle" onClick={toggleNavCollapsed}
                title={navCollapsed ? "Show section list" : "Hide section list"}
                aria-label={navCollapsed ? "Show section list" : "Hide section list"}
              >
                {navCollapsed ? <PanelLeft size={15} /> : <PanelLeftClose size={15} />}
              </button>
              <div className="ac-wizard-nav-links">
                {[
                  { key: "identity", label: "Client Identity", icon: Building2 },
                  { key: "contact", label: "Contact & Address", icon: MapPin },
                  { key: "taxids", label: "Business Tax IDs", icon: FileText },
                  ...(form.clientType === "Business" ? [{ key: "owner", label: "Owner / Responsible Party", icon: UserRound }] : []),
                  { key: "services", label: "Services Provided", icon: Briefcase },
                  { key: "assignment", label: "Assignment & Forms", icon: ClipboardList },
                  { key: "notes", label: "Notes & Create", icon: StickyNote },
                ].map((item) => (
                  <button
                    key={item.key} type="button"
                    className={activeSection === item.key ? "active" : ""}
                    onClick={() => scrollToSection(item.key)}
                  >
                    <item.icon size={15} /> {item.label}
                  </button>
                ))}
              </div>
            </nav>

            <div className="ac-wizard-body">
              <section id="ac-identity" ref={(el) => { sectionRefs.current.identity = el; }} className="ac-card">
                <div className="ac-card-header"><Building2 size={16} /><h3>Client Identity</h3></div>
                <div className="form-grid-3">
                  <div className={`field ${nameError ? "invalid" : ""}`}>
                    <label htmlFor="nc-name">Client Name</label>
                    <input
                      id="nc-name"
                      aria-invalid={nameError ? "true" : undefined}
                      value={form.clientName}
                      onChange={(e) => { setForm((f) => ({ ...f, clientName: e.target.value })); if (nameError) setNameError(null); }}
                    />
                    {nameError ? (
                      <p className="field-error">{nameError}</p>
                    ) : (
                      <div className="field-hint muted" style={{ fontSize: 11, marginTop: 4 }}>
                        Client ID will be auto-assigned when you save. Include the legal suffix (LLC, Inc., etc.) here — it's what appears on every generated document.
                      </div>
                    )}
                  </div>
                  {form.clientType === "Business" && (
                    <div className="field">
                      <label htmlFor="nc-dba">DBA / Trade Name</label>
                      <input id="nc-dba" value={form.dbaName} onChange={(e) => setForm((f) => ({ ...f, dbaName: e.target.value }))} />
                    </div>
                  )}
                  <div className="field">
                    <label htmlFor="nc-ctype">Client Type</label>
                    <select
                      id="nc-ctype" value={form.clientType}
                      onChange={(e) => {
                        const clientType = e.target.value;
                        const allowed = new Set(servicesForClientType(clientType).map((s) => s.key));
                        setForm((f) => ({ ...f, clientType, services: f.services.filter((k) => allowed.has(k)) }));
                      }}
                    >
                      <option>Business</option><option>Individual</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="nc-status">Active?</label>
                    <select id="nc-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                      <option>Active</option><option>Inactive</option><option>Archived</option>
                    </select>
                  </div>
                  {form.clientType === "Business" && (
                    <div className="field">
                      <label htmlFor="nc-etype">Entity Type</label>
                      <select id="nc-etype" value={form.entityType} onChange={(e) => setForm((f) => ({ ...f, entityType: e.target.value }))}>
                        <option value="">Select…</option>
                        {ENTITY_TYPES.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                  )}
                  {form.clientType === "Business" && (
                    <div className="field">
                      <label htmlFor="nc-formation-date">Date of Formation</label>
                      <input id="nc-formation-date" type="date" value={form.dateOfFormation} onChange={(e) => setForm((f) => ({ ...f, dateOfFormation: e.target.value }))} />
                    </div>
                  )}
                  <div className="field">
                    <label htmlFor="nc-state">State</label>
                    <select id="nc-state" value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}>
                      <option value="">Select…</option>
                      {US_STATES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Service Type</label>
                    {/* Not editable here — auto-derived from the Services Provided checkboxes
                        below, so it can never drift out of sync with them (see
                        deriveServiceType in clientOptions.ts and the 2026-08-22 fix: 78 of 152
                        active clients were labeled "Full Service" while missing most of what
                        was actually checked, because this used to be its own independent field). */}
                    <div style={{ padding: "8px 0", fontSize: 13.5 }}>{deriveServiceType(form.services) || <span className="muted">Set once you check services below</span>}</div>
                  </div>
                  <div className="field">
                    <label htmlFor="nc-industry">Industry</label>
                    <input id="nc-industry" list="nc-industry-list" value={form.industryCategory} onChange={(e) => setForm((f) => ({ ...f, industryCategory: e.target.value }))} />
                    <datalist id="nc-industry-list">
                      {INDUSTRY_CATEGORIES.map((o) => <option key={o} value={o} />)}
                    </datalist>
                  </div>
                </div>
              </section>

              <section id="ac-contact" ref={(el) => { sectionRefs.current.contact = el; }} className="ac-card">
                <div className="ac-card-header"><MapPin size={16} /><h3>Contact & Address</h3></div>
                <div className="form-grid-3">
                  <div className="field"><label htmlFor="nc-email">Email</label><input id="nc-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
                  <div className="field"><label htmlFor="nc-phone">Phone</label><input id="nc-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
                  <div className="field">
                    <label htmlFor="nc-lang">Preferred Language</label>
                    <select id="nc-lang" value={form.preferredLanguage} onChange={(e) => setForm((f) => ({ ...f, preferredLanguage: e.target.value }))}>
                      {LANGUAGES.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="nc-referral">Referral Source</label>
                    <input id="nc-referral" list="nc-referral-list" value={form.referralSource} onChange={(e) => setForm((f) => ({ ...f, referralSource: e.target.value }))} />
                    <datalist id="nc-referral-list">
                      {REFERRAL_SOURCES.map((o) => <option key={o} value={o} />)}
                    </datalist>
                  </div>
                </div>
                <div className="form-grid-3" style={{ marginTop: 4 }}>
                  <div className="field">
                    <label>Preferred Contact</label>
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6 }}>
                      {CONTACT_PREFS.map((o) => {
                        const selected = form.preferredContact.split(",").map((s) => s.trim()).filter(Boolean);
                        return (
                          <label key={o} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                            <input
                              type="checkbox"
                              checked={selected.includes(o)}
                              onChange={(e) => setForm((f) => {
                                const prevSelected = f.preferredContact.split(",").map((s) => s.trim()).filter(Boolean);
                                const next = e.target.checked ? [...prevSelected, o] : prevSelected.filter((v) => v !== o);
                                return { ...f, preferredContact: next.join(", ") };
                              })}
                            />
                            {o}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 22 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <input type="checkbox" checked={form.smsAllowed} onChange={(e) => setForm((f) => ({ ...f, smsAllowed: e.target.checked }))} />
                      SMS enabled
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <input type="checkbox" checked={form.emailAllowed} onChange={(e) => setForm((f) => ({ ...f, emailAllowed: e.target.checked }))} />
                      Email enabled
                    </label>
                  </div>
                </div>
                <div className="ac-subcard-title" style={{ marginTop: 14 }}>{form.clientType === "Business" ? "Business Address" : "Address"}</div>
                <AddressFields
                  idPrefix="nc"
                  showStateField={false}
                  value={{ street: form.streetAddress, city: form.city, state: form.state, zip: form.zipCode }}
                  onChange={(patch) => setForm((f) => ({
                    ...f,
                    streetAddress: patch.street ?? f.streetAddress,
                    city: patch.city ?? f.city,
                    zipCode: patch.zip ?? f.zipCode,
                    state: patch.state ?? f.state,
                  }))}
                />
              </section>

              <section id="ac-taxids" ref={(el) => { sectionRefs.current.taxids = el; }} className="ac-card">
                <div className="ac-card-header"><FileText size={16} /><h3>Business Tax IDs</h3></div>
                <div className="form-grid-3">
                  <div className="field"><label htmlFor="nc-sti">State Tax ID</label><input id="nc-sti" value={form.stateTaxId} onChange={(e) => setForm((f) => ({ ...f, stateTaxId: e.target.value }))} /></div>
                  {form.clientType === "Individual" ? (
                    <div className="field"><label htmlFor="nc-ssn">Individual SS No.</label><input id="nc-ssn" value={form.individualSsn} onChange={(e) => setForm((f) => ({ ...f, individualSsn: e.target.value }))} /></div>
                  ) : (
                    <>
                      <div className="field"><label htmlFor="nc-ein">EIN</label><input id="nc-ein" value={form.ein} onChange={(e) => setForm((f) => ({ ...f, ein: e.target.value }))} /></div>
                      <div className="field"><label htmlFor="nc-sos">Secretary of State ID <span className="muted">(SDAT)</span></label><input id="nc-sos" value={form.secretaryOfStateId} onChange={(e) => setForm((f) => ({ ...f, secretaryOfStateId: e.target.value }))} /></div>
                      <div className="field">
                        <label htmlFor="nc-cra-number">CRA / Central Registration No. <span className="muted">(optional)</span></label>
                        <input id="nc-cra-number" value={form.craRegistrationNumber} onChange={(e) => setForm((f) => ({ ...f, craRegistrationNumber: e.target.value }))} placeholder="Issued by Maryland after CRA is approved" />
                      </div>
                      <div className="field">
                        <label htmlFor="nc-mdui-id">MD UI Employer ID <span className="muted">(optional)</span></label>
                        <input id="nc-mdui-id" value={form.mdUiEmployerId} onChange={(e) => setForm((f) => ({ ...f, mdUiEmployerId: e.target.value }))} placeholder="Assigned by MD Dept of Labor" />
                      </div>
                      <div className="field">
                        <label htmlFor="nc-mdui-rate">MD UI Tax Rate <span className="muted">(%, optional)</span></label>
                        <input id="nc-mdui-rate" type="number" step="0.01" min="0" max="20" value={form.mdUiTaxRate} onChange={(e) => setForm((f) => ({ ...f, mdUiTaxRate: e.target.value }))} placeholder="e.g. 2.60" />
                      </div>
                    </>
                  )}
                </div>
              </section>

              {/* This is the business owner / IRS "responsible party" — the actual
                  person, not a generic office contact — so every field here says
                  "Owner" up front. Its own section (name/title/SSN, then the
                  owner's own home address) rather than buried inside Tax IDs,
                  where "Contact SS No." previously read like some unrelated
                  office contact's SSN. */}
              {form.clientType === "Business" && (
                <section id="ac-owner" ref={(el) => { sectionRefs.current.owner = el; }} className="ac-card">
                  <div className="ac-card-header"><UserRound size={16} /><h3>Owner / Responsible Party</h3></div>
                  <div className="form-grid-3">
                    <div className="field"><label htmlFor="nc-cc">Owner Name</label><input id="nc-cc" value={form.companyContactName} onChange={(e) => setForm((f) => ({ ...f, companyContactName: e.target.value }))} /></div>
                    <div className="field"><label htmlFor="nc-cct">Owner Title</label><input id="nc-cct" value={form.companyContactTitle} onChange={(e) => setForm((f) => ({ ...f, companyContactTitle: e.target.value }))} /></div>
                    <div className="field"><label htmlFor="nc-ccs">Owner SS No.</label><input id="nc-ccs" value={form.companyContactSsn} onChange={(e) => setForm((f) => ({ ...f, companyContactSsn: e.target.value }))} /></div>
                    <div className="field">
                      <label htmlFor="nc-cce">Owner Email <span className="muted">(if different from company email)</span></label>
                      <input id="nc-cce" type="email" value={form.companyContactEmail} onChange={(e) => setForm((f) => ({ ...f, companyContactEmail: e.target.value }))} />
                    </div>
                    <div className="field">
                      <label htmlFor="nc-ccp">Owner Phone <span className="muted">(if different from company phone)</span></label>
                      <input id="nc-ccp" value={form.companyContactPhone} onChange={(e) => setForm((f) => ({ ...f, companyContactPhone: e.target.value }))} />
                    </div>
                  </div>
                  <div className="ac-subcard-title" style={{ marginTop: 14 }}>Owner Home Address</div>
                  <AddressFields
                    idPrefix="nc-rp"
                    value={{ street: form.companyContactStreetAddress, city: form.companyContactCity, state: form.companyContactState, zip: form.companyContactZipCode }}
                    onChange={(patch) => setForm((f) => ({
                      ...f,
                      companyContactStreetAddress: patch.street ?? f.companyContactStreetAddress,
                      companyContactCity: patch.city ?? f.companyContactCity,
                      companyContactZipCode: patch.zip ?? f.companyContactZipCode,
                      companyContactState: patch.state ?? f.companyContactState,
                    }))}
                  />
                </section>
              )}

              <section id="ac-services" ref={(el) => { sectionRefs.current.services = el; }} className="ac-card">
                <div className="ac-card-header"><Briefcase size={16} /><h3>Services Provided</h3></div>
                <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
                  Select every service this client is engaged for — the client's profile will suggest the matching contract for each one.
                  {form.clientType === "Individual" && " Showing individual-relevant services only; switch Client Type to Business to see the rest."}
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px 16px", marginBottom: 16 }}>
                  {servicesForClientType(form.clientType).map((s) => (
                    <label key={s.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={form.services.includes(s.key)}
                        onChange={(e) => setForm((f) => {
                          const services = e.target.checked ? [...f.services, s.key] : f.services.filter((k) => k !== s.key);
                          // "Payroll Services" checked here is the same fact as the
                          // payrollEnabled flag below — keep them in sync so checking
                          // the service is sufficient, without a second manual step.
                          return { ...f, services, payrollEnabled: services.includes("payroll") };
                        })}
                      />
                      {s.label}
                    </label>
                  ))}
                  {/* Custom services added on this form — stored in the same services[]
                      array as the built-in keys. They won't have an auto-generated
                      contract template (there's no pre-written text for a service the
                      firm just invented), which is expected, not a gap. */}
                  {customServices.map((label) => (
                    <label key={label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={form.services.includes(label)}
                        onChange={(e) => setForm((f) => ({
                          ...f,
                          services: e.target.checked ? [...f.services, label] : f.services.filter((k) => k !== label),
                        }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    placeholder="Add another service…"
                    value={newCustomService}
                    onChange={(e) => setNewCustomService(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      const label = newCustomService.trim();
                      if (!label || customServices.includes(label)) return;
                      setCustomServices((prev) => [...prev, label]);
                      setForm((f) => ({ ...f, services: [...f.services, label] }));
                      setNewCustomService("");
                    }}
                    style={{ maxWidth: 280 }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      const label = newCustomService.trim();
                      if (!label || customServices.includes(label)) return;
                      setCustomServices((prev) => [...prev, label]);
                      setForm((f) => ({ ...f, services: [...f.services, label] }));
                      setNewCustomService("");
                    }}
                  >
                    + Add Item
                  </button>
                </div>

                {/* These four sub-cards used to only appear once the matching
                    Services Provided checkbox was ticked. Always shown now —
                    staff often know a client needs payroll/sales tax/tax prep
                    up front and want to fill everything in on one pass,
                    matching how the client profile's own Edit form already
                    shows every field a client has data for regardless of
                    which services box is checked. */}
                <div className="ac-subcard">
                  <div className="ac-subcard-title">Payroll Details</div>
                  <div className="form-grid-3">
                    <div className="field">
                      <label htmlFor="nc-pf">Payroll Frequency</label>
                      <select id="nc-pf" value={form.payrollFrequency} onChange={(e) => setForm((f) => ({ ...f, payrollFrequency: e.target.value }))}>
                        <option value="">Select…</option>
                        {PAYROLL_FREQS.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="nc-psys">Payroll Provider</label>
                      <select id="nc-psys" value={form.payrollSystem} onChange={(e) => setForm((f) => ({ ...f, payrollSystem: e.target.value }))}>
                        <option value="">Select…</option>
                        {PAYROLL_PROVIDERS.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="nc-mdw">MD Withholding Frequency</label>
                      <select id="nc-mdw" value={form.mdWithholdingFrequency} onChange={(e) => setForm((f) => ({ ...f, mdWithholdingFrequency: e.target.value }))}>
                        <option value="">Select…</option>
                        {FREQ_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                    {/* Optional — when known, keeps the Compliance Timeline/Account
                        Flags from treating periods before this client actually had
                        the obligation as "missing". See sql/102_obligation_registered_since.sql. */}
                    <div className="field">
                      <label htmlFor="nc-mdw-reg">MD Withholding Registered Since</label>
                      <input id="nc-mdw-reg" type="date" value={form.mdWithholdingRegisteredSince} onChange={(e) => setForm((f) => ({ ...f, mdWithholdingRegisteredSince: e.target.value }))} />
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 6 }}>
                      <input type="checkbox" checked={form.eftpsEnabled} onChange={(e) => setForm((f) => ({ ...f, eftpsEnabled: e.target.checked }))} />
                      EFTPS enabled
                    </label>
                    <div className="field">
                      <label htmlFor="nc-eftps-reg">EFTPS Registered Since</label>
                      <input id="nc-eftps-reg" type="date" value={form.eftpsRegisteredSince} onChange={(e) => setForm((f) => ({ ...f, eftpsRegisteredSince: e.target.value }))} />
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 6 }}>
                      <input type="checkbox" checked={form.mduiEnabled} onChange={(e) => setForm((f) => ({ ...f, mduiEnabled: e.target.checked }))} />
                      MD UI enabled
                    </label>
                    <div className="field">
                      <label htmlFor="nc-mdui-reg">MD UI Registered Since</label>
                      <input id="nc-mdui-reg" type="date" value={form.mduiRegisteredSince} onChange={(e) => setForm((f) => ({ ...f, mduiRegisteredSince: e.target.value }))} />
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 6 }}>
                      <input type="checkbox" checked={form.w21099Enabled} onChange={(e) => setForm((f) => ({ ...f, w21099Enabled: e.target.checked }))} />
                      W-2 / 1099 enabled
                    </label>
                  </div>
                </div>

                <div className="ac-subcard">
                  <div className="ac-subcard-title">Sales Tax Details</div>
                  <div className="form-grid-3">
                    <div className="field">
                      <label htmlFor="nc-stf">Sales Tax Frequency</label>
                      <select id="nc-stf" value={form.salesTaxFrequency} onChange={(e) => setForm((f) => ({ ...f, salesTaxFrequency: e.target.value }))}>
                        <option value="">Select…</option>
                        {FREQ_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="nc-stf-reg">Registered Since</label>
                      <input id="nc-stf-reg" type="date" value={form.salesTaxRegisteredSince} onChange={(e) => setForm((f) => ({ ...f, salesTaxRegisteredSince: e.target.value }))} />
                    </div>
                  </div>
                </div>

                <div className="ac-subcard">
                  <div className="ac-subcard-title">Tax Preparation Details</div>
                  <div className="form-grid-3">
                    <div className="field">
                      <label htmlFor="nc-brt">Business Return Type</label>
                      <select id="nc-brt" value={form.businessReturnType} onChange={(e) => setForm((f) => ({ ...f, businessReturnType: e.target.value }))}>
                        <option value="">Select…</option>
                        {RETURN_TYPES.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {form.clientType === "Business" && (
                  <div className="ac-subcard">
                    <div className="ac-subcard-title">Business Compliance</div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 6 }}>
                      <input type="checkbox" checked={form.mdAnnualReportEnabled} onChange={(e) => setForm((f) => ({ ...f, mdAnnualReportEnabled: e.target.checked }))} />
                      MD Annual Report enabled
                    </label>
                  </div>
                )}
              </section>

              {/* Assigned To lives here, not under Contact — it's who at the firm
                  owns this client, not a way to reach the client, so grouping it
                  with Email/Phone read as the same kind of fact when it isn't.
                  The two generator selects are quick-launch shortcuts, not saved
                  client fields: picking one just reopens the Add Client flow's
                  result on the client's Gov Forms tab with that form's dialog
                  already open, via handleCreate's ?openGovForm/?openAuthForm. */}
              <section id="ac-assignment" ref={(el) => { sectionRefs.current.assignment = el; }} className="ac-card">
                <div className="ac-card-header"><ClipboardList size={16} /><h3>Assignment &amp; Forms</h3></div>
                <div className="form-grid-3">
                  <div className="field">
                    <label htmlFor="nc-assigned">Assigned To</label>
                    <select id="nc-assigned" value={form.assignedTo} onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))}>
                      <option value="">Unassigned</option>
                      {staffOptions.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Government Form <span className="muted">(optional — pick any that apply)</span></label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                      {govFormTypes.map((t) => (
                        <label key={t.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={quickGovForms.includes(t.value)}
                            onChange={(e) => setQuickGovForms((prev) => (e.target.checked ? [...prev, t.value] : prev.filter((v) => v !== t.value)))}
                          />
                          {t.label}
                        </label>
                      ))}
                    </div>
                    {quickGovForms.length > 0 && (
                      <div className="field-hint muted" style={{ fontSize: 11, marginTop: 4 }}>Opens the Generate Government Form dialog for each selected type, one after another, right after the client is created.</div>
                    )}
                  </div>
                  <div className="field">
                    <label>Generate Authorization Form <span className="muted">(optional — pick any that apply)</span></label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                      {authFormTypes.map((t) => (
                        <label key={t.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={quickAuthForms.includes(t.value)}
                            onChange={(e) => setQuickAuthForms((prev) => (e.target.checked ? [...prev, t.value] : prev.filter((v) => v !== t.value)))}
                          />
                          {t.label}
                        </label>
                      ))}
                    </div>
                    {quickAuthForms.length > 0 && (
                      <div className="field-hint muted" style={{ fontSize: 11, marginTop: 4 }}>Opens the Generate Authorization Form dialog for each selected type, one after another, right after the client is created.</div>
                    )}
                  </div>
                </div>
              </section>

              <section id="ac-notes" ref={(el) => { sectionRefs.current.notes = el; }} className="ac-card">
                <div className="ac-card-header"><StickyNote size={16} /><h3>Notes &amp; Create</h3></div>
                <div className="field"><label htmlFor="nc-notes">Notes</label><textarea id="nc-notes" rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>

                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 14 }}>
                  <input type="checkbox" checked={createPortalNow} onChange={(e) => setCreatePortalNow(e.target.checked)} disabled={!form.email} />
                  Create portal user now {!form.email && <span className="muted">(requires an email address)</span>}
                </label>

                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Creating…" : "Create Client"}</button>
              </section>
            </div>
          </div>
        </form>
      )}

      {!clients && !error && <div className="spinner-wrap">Loading clients…</div>}

      {clients && (
        /* No overflow:hidden (unlike most .card wrappers) — it would clip the
           sticky table header, since position:sticky's stick range is bound by
           the nearest ancestor whose overflow isn't visible. */
        <div className="card" style={{ padding: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ fontSize: 14 }}>{tableTitle}</strong>
            <span className="muted" style={{ fontSize: 12 }}>{filtered.length} of {clients.length} clients</span>
          </div>
          {/* No separate overflow:auto wrapper around .table-scroll — that div computed
              its own overflow-y to "auto" too (pairing a non-visible overflow-x with a
              default-visible overflow-y forces this per spec), becoming a second scroll
              container that broke the sticky header below exactly like .table-scroll
              itself used to before it got an explicit overflow-y:visible. */}
          <div className="table-scroll card-table no-h-scroll">
          <table>
            <thead>
              <tr>
                {/* Type folds under Client, Responsible under Contact, and Portal
                    under Status — as 9 columns this ran ~210px off the right edge
                    at 100% zoom with the client panel open. */}
                <th scope="col" className="sortable" tabIndex={0} role="button" onClick={() => toggleSort("client_name")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort("client_name"); } }}>Client{sortArrow("client_name")}</th>
                <th scope="col">Contact</th>
                <th scope="col" className="sortable" tabIndex={0} role="button" onClick={() => toggleSort("assigned_to")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort("assigned_to"); } }}>Owner{sortArrow("assigned_to")}</th>
                <th scope="col">Compliance</th>
                <th scope="col" className="sortable" tabIndex={0} role="button" onClick={() => toggleSort("status")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort("status"); } }}>Status{sortArrow("status")}</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const resp = responsibleCell(c);
                return (
                  <tr key={c.client_id} data-row-id={c.client_id} tabIndex={0} onClick={() => { setSelectedClient(c.client_id, c.client_name); navigate(`/clients/${c.client_id}`); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedClient(c.client_id, c.client_name); navigate(`/clients/${c.client_id}`); } }}>
                    <td>
                      {/* Wrapped in one div so the card-table mobile layout (which turns
                          each <td> into a flex row with the column label on the left)
                          sees a single flex item here instead of two, and the name/id
                          lines stack the way they do on desktop instead of sitting
                          side by side. */}
                      <div>
                        <div className="cell-primary">{c.client_name}</div>
                        <div className="cell-sub">
                          {c.client_id}
                          {c.client_type ? ` · ${c.client_type}` : ""}
                          {c.entity_type ? ` · ${c.entity_type}` : ""}
                        </div>
                        <LabelChips labels={clientLabels[c.client_id] || []} onRemove={(labelId) => unassignLabel(c.client_id, labelId)} />
                        <LabelPicker
                          allLabels={allLabels}
                          assignedIds={new Set((clientLabels[c.client_id] || []).map((l) => l.label_id))}
                          onAdd={(labelId) => assignLabel(c.client_id, labelId)}
                        />
                      </div>
                    </td>
                    <td data-label="Contact">
                      <div>
                        {c.email ? <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()} className="cell-primary">{c.email}</a> : <div className="cell-primary muted">—</div>}
                        <div className="cell-sub">{c.phone || ""}</div>
                        {!resp.empty && <div className="cell-sub">Resp: {resp.primary}{resp.secondary ? ` · ${resp.secondary}` : ""}</div>}
                      </div>
                    </td>
                    <td className="muted" data-label="Owner">{c.assigned_to || "—"}</td>
                    <td data-label="Compliance">
                      {(() => {
                        const { lead, detail } = complianceInfo(c);
                        if (!lead && !detail) return <span className="muted">—</span>;
                        return (
                          <div>
                            {lead && <span className="badge">{lead}</span>}
                            {detail && <div className="cell-sub">{detail}</div>}
                          </div>
                        );
                      })()}
                    </td>
                    <td data-label="Status">
                      <div>
                        <StatusBadge status={c.status} />
                        <div className="cell-sub">{c.portal_enabled ? "Portal on" : "No portal"}</div>
                      </div>
                    </td>
                    <td data-label="Actions" onClick={(e) => e.stopPropagation()}>
                      <ActionMenu options={actionOptions(c)} onSelect={(action) => handleAction(c, action)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          {filtered.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No clients match.</p>}
        </div>
      )}
    </div>
  );
}
