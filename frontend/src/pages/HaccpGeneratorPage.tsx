import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError, viewFile, downloadFile, printFile } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { useConfirm, useNotify } from "../components/ConfirmProvider";
import { AddressFields } from "../components/AddressFields";
import type { Client } from "../api/types";
import { ErrorBanner } from "../components/ErrorBanner";

interface BusinessType { key: string; label: string; riskPriority: "High" | "Moderate" | "Low"; hasCookStep: boolean; hasHotHolding: boolean; description: string; priorityReason?: string }
interface RiskSignals { hotMenu: string[]; preparedColdMenu: string[]; cookingEquipment: string[]; hotHoldingEquipment: string[]; coldPrepEquipment: string[]; microwaveEquipment: string[] }
interface DocumentRequirement { component?: HaccpPlanComponent; label: string; status: "required" | "not_required" | "if_applicable"; why: string }
interface DocumentRequirements {
  riskPriority: "High" | "Moderate" | "Low"; priorityReason: string; documents: DocumentRequirement[];
  attachments: string[]; relatedApprovals: string[]; defaultComponents: HaccpPlanComponent[]; fees: string[];
}
interface ChecklistItem { key: string; label: string }
interface ChecklistCategory { category: string; items: ChecklistItem[] }
interface HaccpOptions { businessTypes: BusinessType[]; menuCategories: ChecklistCategory[]; equipmentItems: ChecklistItem[]; customMenuItems: string[]; riskSignals?: RiskSignals }
/** Which document(s) a plan wants — see haccp.routes.ts's HACCP_PLAN_COMPONENTS. */
type HaccpPlanComponent = "haccp_plan" | "menu_equipment" | "license_application" | "plan_review";
const HACCP_PLAN_COMPONENTS: { key: HaccpPlanComponent; label: string; description: string }[] = [
  { key: "haccp_plan", label: "HACCP Plan", description: "Full food-safety plan with CCP tables — requires a business type." },
  { key: "menu_equipment", label: "Menu & Equipment List", description: "Standalone checklist, no CCP plan required." },
  { key: "license_application", label: "License Application", description: "This jurisdiction's food license / permit application." },
  { key: "plan_review", label: "Plan Review Application", description: "This jurisdiction's plan-review submission form." },
];
interface HaccpPlanRow {
  plan_id: string; client_id: string | null; business_name: string; business_type_key: string;
  jurisdiction: string; city: string | null; state: string | null; created_by: string | null;
  created_at: string; updated_at: string; components: HaccpPlanComponent[];
}
interface EquipmentSelection { key: string; label: string; quantity: number }
interface CertifiedFoodManager { name: string; idNumber: string; expirationDate: string }
interface CountyPermitData {
  facilityId?: string; applicationType?: string; buildingPermit?: "yes" | "no"; cateringServiceProvided?: boolean; cateringId?: string; facilityClassification?: string;
  numberOfSeats?: string; waterService?: string; sewageDisposal?: string; majorMenuChanges?: boolean;
  certifiedFoodManagers?: CertifiedFoodManager[];
  daysOfOperation?: string; hoursOfOperation?: string; numberOfEmployees?: string;
  residentAgentName?: string; residentAgentPhone?: string; sendCorrespondenceTo?: "trade" | "owner";
}
interface LicenseApplicationData {
  officerTitle?: string; tradeName?: string;
  ownerHomeStreet?: string; ownerHomeCity?: string; ownerHomeZip?: string; ownerHomePhone?: string;
  mailingAddress?: string;
  wasteHaulerOption?: "under3" | "contract" | "smallHauler"; smallHaulerLicenseNumber?: string;
  sellsTobacco?: boolean; tobaccoLicenseNumber?: string;
  ownerEntityType?: "Incorporated" | "LLC" | "Other";
  useAndOccupancyNumber?: string; fireDeptPermitNumber?: string; permitsApplied?: string[]; facilityTypeOverride?: string;
  county?: CountyPermitData;
}
interface HaccpPlanDetail extends HaccpPlanRow {
  street_address: string | null; zip_code: string | null; phone: string | null; email: string | null;
  contact_person: string | null; license_number: string | null; officer_owner_name: string | null;
  selected_menu_items: string[]; selected_equipment: EquipmentSelection[]; rendered_body: string | null;
  license_application_data: LicenseApplicationData | null;
}

const JURISDICTIONS = ["Baltimore City", "Baltimore County"];

/** A business name made safe for a file name, the same way the Download buttons do it. */
const fileBase = (name: string) => (name.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ") || "Business").slice(0, 120);
const licenseDocName = (jurisdiction: string) => (jurisdiction === "Baltimore County" ? "Food Service Permit Application" : "Food License Application");
const planReviewDocName = (jurisdiction: string) => (jurisdiction === "Baltimore County" ? "Plans Review Guide" : "Plan Review Application");

const EMPTY_FORM = {
  planId: "" as string, businessName: "", businessTypeKey: "", jurisdiction: "Baltimore City",
  street: "", city: "", zip: "", phone: "", email: "", contactPerson: "", licenseNumber: "", officerOwnerName: "", clientId: "",
};

const EMPTY_LICENSE_FORM: LicenseApplicationData = {
  officerTitle: "Owner", tradeName: "",
  ownerHomeStreet: "", ownerHomeCity: "", ownerHomeZip: "", ownerHomePhone: "",
  mailingAddress: "",
  wasteHaulerOption: "under3", smallHaulerLicenseNumber: "",
  sellsTobacco: false, tobaccoLicenseNumber: "",
  ownerEntityType: "LLC",
  useAndOccupancyNumber: "", fireDeptPermitNumber: "", permitsApplied: ["retailFood"], facilityTypeOverride: "",
  county: {
    facilityId: "", cateringServiceProvided: false, cateringId: "", facilityClassification: "",
    numberOfSeats: "", waterService: "Public", sewageDisposal: "Public", majorMenuChanges: false,
    certifiedFoodManagers: [], daysOfOperation: "", hoursOfOperation: "", numberOfEmployees: "",
    residentAgentName: "", residentAgentPhone: "", sendCorrespondenceTo: "trade",
  },
};

const PERMIT_OPTIONS: { key: string; label: string }[] = [
  { key: "useAndOccupancy", label: "Use and Occupancy" },
  { key: "zoning", label: "Zoning Permit Application" },
  { key: "building", label: "Building Permit with Plans" },
  { key: "occupancy", label: "Occupancy Permit Application" },
  { key: "liquor", label: "Liquor License Application" },
  { key: "retailFood", label: "Retail Food Permit Application" },
  { key: "dayCare", label: "Day Care License Application" },
];

/**
 * Standalone HACCP food-safety plan generator — not client-scoped (usable for
 * a brand-new business applying for its first health permit, not only
 * existing AL TAX clients). Business info + a business-type-gated master
 * menu/equipment checklist merge into the correct HACCP content and render
 * as a PDF via GET /haccp/plans/:planId/pdf. See src/modules/haccp/ on the
 * backend for the content/routing/PDF pieces this mirrors.
 */
export function HaccpGeneratorPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const toast = useToast();
  const confirmDialog = useConfirm();
  const notify = useNotify();

  const [searchParams] = useSearchParams();
  const [options, setOptions] = useState<HaccpOptions | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [tab, setTab] = useState<"generate" | "saved">("generate");

  const [form, setForm] = useState(EMPTY_FORM);
  const [licenseForm, setLicenseForm] = useState<LicenseApplicationData>(EMPTY_LICENSE_FORM);
  const [selectedMenu, setSelectedMenu] = useState<Set<string>>(new Set());
  const [selectedEquipment, setSelectedEquipment] = useState<EquipmentSelection[]>([]);
  const [customMenuInput, setCustomMenuInput] = useState("");
  const [customEquipmentInput, setCustomEquipmentInput] = useState("");
  const [showBulkMenuInput, setShowBulkMenuInput] = useState(false);
  const [bulkMenuInput, setBulkMenuInput] = useState("");
  const [copyFromPlanId, setCopyFromPlanId] = useState("");
  const [copyingItems, setCopyingItems] = useState(false);
  const [savedItemSearch, setSavedItemSearch] = useState("");
  // Which of the 4 buildable documents this plan wants — replaces the old
  // binary haccpOnly/full toggle, which could only gate the license/plan-
  // review section and had no way to express "just a Menu & Equipment list,
  // no CCP plan" (confirmed bug: staff couldn't build a standalone Menu &
  // Equipment list for a convenience store, since the old flow always
  // required a resolvable business type/CCP template). Defaults to the two
  // most common items, matching the old default experience.
  const [components, setComponents] = useState<Set<HaccpPlanComponent>>(new Set(["haccp_plan", "menu_equipment"]));
  function toggleComponent(key: HaccpPlanComponent) {
    setComponents((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  }
  const wantsHaccpPlan = components.has("haccp_plan");
  const wantsLicenseOrReview = components.has("license_application") || components.has("plan_review");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null);
  const [savingToDocuments, setSavingToDocuments] = useState(false);

  const [plans, setPlans] = useState<HaccpPlanRow[] | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get<HaccpOptions>("/haccp/options").then(setOptions).catch(() => {});
    api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => {});
    // Needed on the Generate tab too, not just Saved Plans — powers "Copy
    // Items From Another Plan" below, so every previously-built plan is a
    // reusable item list for the next similar business, not a one-off.
    loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadPlans() {
    api.get<{ plans: HaccpPlanRow[] }>(`/haccp/plans${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ""}`)
      .then((r) => setPlans(r.plans))
      .catch(() => setPlans([]));
  }
  useEffect(() => { if (tab === "saved") loadPlans(); }, [tab, search]);

  const businessType = options?.businessTypes.find((t) => t.key === form.businessTypeKey) || null;
  const downloadBaseName = (form.businessName.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ") || "Business").slice(0, 120);

  function toggleMenu(key: string) {
    setSelectedMenu((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  }
  function removeMenuItem(value: string) {
    setSelectedMenu((prev) => { const next = new Set(prev); next.delete(value); return next; });
  }
  function addCustomMenuItem() {
    const value = customMenuInput.trim();
    if (!value) return;
    setSelectedMenu((prev) => new Set(prev).add(value));
    setCustomMenuInput("");
  }
  const knownMenuKeys = useMemo(() => new Set((options?.menuCategories || []).flatMap((cat) => cat.items.map((i) => i.key))), [options]);
  const customMenuItems = Array.from(selectedMenu).filter((v) => !knownMenuKeys.has(v));
  function selectAllMenu() {
    setSelectedMenu((prev) => new Set([...prev, ...(options?.menuCategories || []).flatMap((cat) => cat.items.map((i) => i.key))]));
  }
  function selectAllMenuCategory(cat: { items: { key: string }[] }) {
    setSelectedMenu((prev) => new Set([...prev, ...cat.items.map((i) => i.key)]));
  }
  function clearAllMenu() {
    setSelectedMenu(new Set());
  }
  // Text copied out of a PDF menu drags along bullet characters (•●▪-*),
  // and a menu with prices stripped out (like a HACCP-only copy) often
  // leaves a bare trailing dash or period where the price used to be
  // ("Catfish – ", "Regular (2pc Toast)."). Left in, those become part of
  // the item name on the printed plan. Strip only leading list-marker
  // characters and a genuinely trailing dash/period — never touch a dash
  // in the middle of a word, so real hyphenated names survive untouched.
  function cleanPastedMenuLine(raw: string): string {
    return raw
      .replace(/^[\s]*[•●▪◦∙·*-]+\s*/, "")
      .replace(/\s*[–—-]+\s*$/, "")
      .replace(/[.\s]+$/, "")
      .trim();
  }
  // Real menu items (e.g. from a client's actual PDF menu) almost never match
  // the generic master checklist by name — the checklist is deliberately
  // broad categories, not a dish-name catalog. Pasting the whole list at
  // once, one item per line, is the realistic way to get every real menu
  // item onto the plan instead of typing each one into the single-item box.
  function addBulkMenuItems() {
    const lines = Array.from(new Set(
      bulkMenuInput.split(/\r?\n/).map(cleanPastedMenuLine).filter(Boolean)
    ));
    if (lines.length === 0) return;
    setSelectedMenu((prev) => new Set([...prev, ...lines]));
    setBulkMenuInput("");
    setShowBulkMenuInput(false);
  }

  /**
   * Pulls the menu + equipment selections from an already-saved plan into
   * the one being built now — the real fix for "another business has the
   * same menu": once ANY plan has its items entered, every plan after it
   * (a second location, a similar carryout, a franchise sibling) is a
   * one-click reuse instead of re-pasting or re-typing the same list again.
   * Adds to whatever's already selected here rather than replacing it, and
   * never touches business info/license fields — only items.
   */
  async function copyItemsFromPlan(planId: string) {
    if (!planId) return;
    setCopyingItems(true);
    try {
      const r = await api.get<{ plan: HaccpPlanDetail }>(`/haccp/plans/${planId}`);
      setSelectedMenu((prev) => new Set([...prev, ...(r.plan.selected_menu_items || [])]));
      setSelectedEquipment((prev) => {
        const existingKeys = new Set(prev.map((e) => e.key));
        const additions = (r.plan.selected_equipment || []).filter((e) => !existingKeys.has(e.key));
        return [...prev, ...additions];
      });
      toast(`Copied items from ${r.plan.business_name}.`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not load that plan's items.");
    } finally {
      setCopyingItems(false);
      setCopyFromPlanId("");
    }
  }

  function toggleEquipment(key: string, label: string) {
    setSelectedEquipment((prev) => prev.some((e) => e.key === key) ? prev.filter((e) => e.key !== key) : [...prev, { key, label, quantity: 1 }]);
  }
  function setEquipmentQuantity(key: string, quantity: number) {
    setSelectedEquipment((prev) => prev.map((e) => (e.key === key ? { ...e, quantity: Math.max(1, Math.floor(quantity) || 1) } : e)));
  }
  function removeEquipmentItem(key: string) {
    setSelectedEquipment((prev) => prev.filter((e) => e.key !== key));
  }
  function addCustomEquipmentItem() {
    const label = customEquipmentInput.trim();
    if (!label) return;
    setSelectedEquipment((prev) => [...prev, { key: `custom-${Date.now()}-${Math.floor(Math.random() * 1000)}`, label, quantity: 1 }]);
    setCustomEquipmentInput("");
  }
  const knownEquipmentKeys = useMemo(() => new Set((options?.equipmentItems || []).map((i) => i.key)), [options]);
  const customEquipmentItems = selectedEquipment.filter((e) => !knownEquipmentKeys.has(e.key));
  function selectAllEquipment() {
    setSelectedEquipment((prev) => {
      const existingKeys = new Set(prev.map((e) => e.key));
      const additions = (options?.equipmentItems || []).filter((i) => !existingKeys.has(i.key)).map((i) => ({ key: i.key, label: i.label, quantity: 1 }));
      return [...prev, ...additions];
    });
  }
  function clearAllEquipment() {
    setSelectedEquipment([]);
  }

  function addManager() {
    setLicenseForm((f) => ({ ...f, county: { ...f.county, certifiedFoodManagers: [...(f.county?.certifiedFoodManagers || []), { name: "", idNumber: "", expirationDate: "" }] } }));
  }
  function updateManager(index: number, patch: Partial<CertifiedFoodManager>) {
    setLicenseForm((f) => ({
      ...f,
      county: { ...f.county, certifiedFoodManagers: (f.county?.certifiedFoodManagers || []).map((m, i) => (i === index ? { ...m, ...patch } : m)) },
    }));
  }
  function removeManager(index: number) {
    setLicenseForm((f) => ({ ...f, county: { ...f.county, certifiedFoodManagers: (f.county?.certifiedFoodManagers || []).filter((_, i) => i !== index) } }));
  }

  function loadPlanIntoForm(plan: HaccpPlanDetail) {
    setForm({
      planId: plan.plan_id, businessName: plan.business_name, businessTypeKey: plan.business_type_key,
      jurisdiction: plan.jurisdiction, street: plan.street_address || "", city: plan.city || "", zip: plan.zip_code || "",
      phone: plan.phone || "", email: plan.email || "", contactPerson: plan.contact_person || "",
      licenseNumber: plan.license_number || "", officerOwnerName: plan.officer_owner_name || "", clientId: plan.client_id || "",
    });
    setSelectedMenu(new Set(plan.selected_menu_items || []));
    setSelectedEquipment(plan.selected_equipment || []);
    setLicenseForm({ ...EMPTY_LICENSE_FORM, ...(plan.license_application_data || {}), county: { ...EMPTY_LICENSE_FORM.county, ...(plan.license_application_data?.county || {}) } });
    setSavedPlanId(plan.plan_id);
    setTab("generate");
    setComponents(new Set(plan.components?.length ? plan.components : ["haccp_plan", "menu_equipment"]));
  }

  function togglePermit(key: string) {
    setLicenseForm((f) => {
      const set = new Set(f.permitsApplied || []);
      set.has(key) ? set.delete(key) : set.add(key);
      return { ...f, permitsApplied: Array.from(set) };
    });
  }

  function reopenForRenewal(planId: string) {
    api.get<{ plan: HaccpPlanDetail }>(`/haccp/plans/${planId}`)
      .then((r) => loadPlanIntoForm(r.plan))
      .catch((err) => toast(err instanceof ApiError ? err.message : "Could not load this plan."));
  }

  // Linking a client only ever set form.clientId — every business-info field
  // (name, address, phone, email, contact) stayed blank even though the
  // client record already has it, so staff had to retype it by hand for
  // every plan. This fills in whatever's still blank from the client's own
  // record; it never overwrites a field staff already typed (e.g. re-linking
  // an existing saved plan to a different client shouldn't wipe a
  // deliberately-edited phone number).
  // The linked client's record (permit numbers, owner info) — feeds the submission checklist below.
  const [clientProfile, setClientProfile] = useState<Record<string, any> | null>(null);
  useEffect(() => {
    if (!form.clientId) { setClientProfile(null); return; }
    let cancelled = false;
    api.get<{ client: Record<string, any> }>(`/clients/${encodeURIComponent(form.clientId)}`)
      .then((r) => { if (!cancelled) setClientProfile(r.client); })
      .catch(() => { if (!cancelled) setClientProfile(null); });
    return () => { cancelled = true; };
  }, [form.clientId]);

  // --- What this business needs: documents, fees and attachments for the chosen type + jurisdiction ---
  const [requirements, setRequirements] = useState<DocumentRequirements | null>(null);
  async function loadRequirements(typeKey: string, jurisdiction: string, buildingPermit: string = licenseForm.county?.buildingPermit || ""): Promise<DocumentRequirements | null> {
    if (!typeKey) { setRequirements(null); return null; }
    try {
      const r = await api.get<{ requirements: DocumentRequirements }>(`/haccp/requirements?businessTypeKey=${encodeURIComponent(typeKey)}&jurisdiction=${encodeURIComponent(jurisdiction)}&buildingPermit=${encodeURIComponent(buildingPermit)}`);
      setRequirements(r.requirements);
      return r.requirements;
    } catch { setRequirements(null); return null; }
  }
  // A saved plan opened for renewal keeps the documents it was saved with; only the card is refreshed.
  useEffect(() => { loadRequirements(form.businessTypeKey, form.jurisdiction); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [form.businessTypeKey, form.jurisdiction, licenseForm.county?.buildingPermit]);

  /** The user picked a business type or jurisdiction: pre-select exactly the documents that combination needs. */
  async function chooseTypeOrJurisdiction(typeKey: string, jurisdiction: string) {
    const req = await loadRequirements(typeKey, jurisdiction);
    if (req) setComponents(new Set(req.defaultComponents));
  }

  /**
   * Compares what is checked (foods, equipment) with the chosen type. A "No-Cook" store that ticks a fryer, or
   * a store with a deli case set to "packaged only", is a higher-risk operation than its type says — so the
   * documents (and the HACCP plan's wording) would be wrong. Offers the matching type.
   */
  const riskCheck = useMemo(() => {
    const sig = options?.riskSignals;
    const type = options?.businessTypes.find((t) => t.key === form.businessTypeKey);
    if (!sig || !type) return null;
    const equipKeys = new Set(selectedEquipment.map((e) => e.key));
    const hasAny = (list: string[], set: { has: (k: string) => boolean }) => list.some((k) => set.has(k));
    const hot = hasAny(sig.hotMenu, selectedMenu) || hasAny(sig.cookingEquipment, equipKeys);
    const hotHolding = hasAny(sig.hotHoldingEquipment, equipKeys);
    const cold = hasAny(sig.preparedColdMenu, selectedMenu) || hasAny(sig.coldPrepEquipment, equipKeys);
    const microwave = hasAny(sig.microwaveEquipment, equipKeys);
    let suggestKey: string | null = null;
    if (type.key === "convenience_grocery") suggestKey = hotHolding ? "grocery_hot_holding" : hot ? "convenience_hot_food" : cold ? "grocery_deli_cold_only" : null;
    else if (type.key === "grocery_deli_cold_only") suggestKey = hotHolding ? "grocery_hot_holding" : hot ? "grocery_deli_hot_food" : null;
    else if (!type.hasHotHolding && hotHolding) suggestKey = "grocery_hot_holding";
    const reasons: string[] = [];
    if (hot) reasons.push("hot food or cooking equipment is selected");
    if (hotHolding) reasons.push("a steam table or heated display is selected");
    if (cold && type.key === "convenience_grocery") reasons.push("cold food that is sliced, assembled or prepared on site is selected (deli case, slicer, prep table, sandwiches or salads)");
    return { suggestKey, suggestLabel: suggestKey ? options?.businessTypes.find((t) => t.key === suggestKey)?.label : undefined, reasons, microwave: microwave && type.riskPriority === "Low", type };
  }, [options, form.businessTypeKey, selectedMenu, selectedEquipment]);

  /**
   * "Before you submit": what a health department reviewer looks for, checked against what is on this form. TODO = you
   * must supply it, CHECK = look at it (it may be wrong), DONE = nothing to do.
   */
  const submissionChecklist = useMemo(() => {
    type Item = { level: "todo" | "check" | "done"; text: string; detail?: string };
    const items: Item[] = [];
    const type = options?.businessTypes.find((t) => t.key === form.businessTypeKey) || null;
    const isCounty = form.jurisdiction === "Baltimore County";
    const county = licenseForm.county || {};
    const equipKeys = new Set(selectedEquipment.map((e) => e.key));
    const REFRIGERATION = ["beverage_cooler_1door", "beverage_cooler_2door", "beverage_cooler_4door", "ice_cream_freezer", "walk_in_cooler", "walk_in_freezer", "reach_in_cooler", "deli_case", "sandwich_prep_table"];
    const NO_CUT_SHEET = ["shelves", "cash_register", "atm", "security_cameras", "sanitizer_buckets", "metal_stem_thermometer", "refrigerator_thermometers", "handwashing_sink", "restroom", "mop_sink", "3_compartment_sink"];
    const norm = (v: unknown) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const blank = (v: unknown) => !String(v ?? "").trim();
    const wants = (c: HaccpPlanComponent) => components.has(c);

    if (wants("license_application")) {
      items.push({ level: "todo", text: "Sign and date the application", detail: "The form says it must be signed by the owner/operator. Print it and have the owner sign and date it." });
      items.push({ level: "todo", text: "Attach payment", detail: isCounty ? "A check payable to “Baltimore County, Maryland” for the amount on the Fee Statement (the County fills in the amount)." : (requirements?.fees || []).join(" · ") + " Check or money order payable to “Director of Finance”." });
      if (isCounty) items.push({ level: "check", text: "Confirm this is the form the County wants for a new store", detail: "This PDF is footed “Permit Renewal Application 02/04/2010”. Ask Environmental Health Services (410-887-3663) whether a new facility files this form or a newer one." });
    }
    const cutSheetItems = selectedEquipment.filter((e) => !NO_CUT_SHEET.includes(e.key));
    if (cutSheetItems.length) {
      items.push({ level: "todo", text: "Equipment cut sheets", detail: `Manufacturer spec sheets showing NSF (or equivalent) approval for: ${cutSheetItems.map((e) => e.quantity > 1 ? `${e.label} (x${e.quantity})` : e.label).join(", ")}.` });
    } else {
      items.push({ level: "check", text: "Equipment list is empty", detail: "A reviewer expects the refrigeration and other equipment listed." });
    }
    if (clientProfile || form.clientId) {
      const coo = String(clientProfile?.use_and_occupancy_number || "").trim();
      const zoning = String(clientProfile?.zoning_use_permit_number || "").trim();
      items.push(coo
        ? { level: "todo", text: `Copy of the Certificate of Occupancy (${coo})`, detail: "Attach a copy; the number is on the client's profile." }
        : { level: "todo", text: "Copy of the Certificate of Occupancy", detail: "No number is on the client's profile yet — enter it on Permits & Compliance and attach a copy." });
      items.push(zoning
        ? { level: "todo", text: `Copy of the Zoning Use Permit (${zoning})`, detail: "Attach a copy; the number is on the client's profile." }
        : { level: "todo", text: "Copy of the Zoning Use Permit", detail: "No number is on the client's profile yet — enter it on Permits & Compliance and attach a copy." });
      if (!String(clientProfile?.fire_dept_permit_number || "").trim()) {
        items.push({ level: "check", text: "Fire Marshal inspection", detail: "No fire inspection or permit number yet. Use “Create Schedule fire inspection task” on the client's Permits & Compliance tab." });
      }
    }
    items.push({ level: "check", text: "Business name and address match the Certificate of Occupancy and Zoning Use Permit", detail: `This application says “${form.businessName}” at “${[form.street, form.city].filter(Boolean).join(", ")}”. A reviewer compares them letter for letter — including “131 1/2” versus “131.5”.` });

    if (wants("license_application") && isCounty) {
      const seats = String(county.numberOfSeats ?? "").trim();
      if (!seats) items.push({ level: "todo", text: "Number of seats", detail: "Enter 0 if customers cannot sit." });
      else if (type && !type.hasCookStep && !type.hasHotHolding && Number(seats) > 0) items.push({ level: "check", text: `Seats provided is “${seats}”`, detail: "A no-cook store normally has no seating. Enter 0 unless customers can sit." });
      if (blank(county.numberOfEmployees)) items.push({ level: "todo", text: "Number of employees" });
      if (blank(county.daysOfOperation) || blank(county.hoursOfOperation)) items.push({ level: "todo", text: "Days and hours of operation" });
      if (blank(licenseForm.ownerHomeStreet)) items.push({ level: "todo", text: "Owner's address" });
      else if (norm(licenseForm.ownerHomeStreet) === norm(form.street)) items.push({ level: "check", text: "Owner's address is the store's address", detail: "Confirm this is where the owner lives, not just the shop." });
    }
    if (selectedEquipment.some((e) => REFRIGERATION.includes(e.key)) && !equipKeys.has("refrigerator_thermometers")) {
      items.push({ level: "check", text: "Thermometers in the coolers and freezers", detail: "Every refrigeration unit needs one. Add “Thermometer in each refrigerator / freezer / cooler” to the equipment list once the owner confirms." });
    }
    if (!equipKeys.has("handwashing_sink") && !equipKeys.has("restroom")) {
      items.push({ level: "check", text: "Hand sink / restroom", detail: "The inspector checks handwashing facilities. Add the hand sink or restroom to the equipment list (and a mop/utility sink if there is one)." });
    }
    if (type?.riskPriority === "Low") {
      items.push({ level: "done", text: "No HACCP plan needed", detail: "Low priority — the priority assessment on the Menu & Equipment List is enough." });
      items.push({ level: "done", text: "No Certified Food Manager card needed (Baltimore County, Low priority)" });
    }
    return items;
  }, [options, form.businessTypeKey, form.jurisdiction, form.businessName, form.street, form.city, form.clientId, licenseForm, selectedEquipment, components, clientProfile, requirements]);

  /**
   * Fills blank License & Permit fields from what's already on this form: the contact person is the
   * owner's name, the business phone is the fallback owner phone, and the business type decides the
   * facility type (and "0" seats for a no-cook, no-seating store). Never overwrites anything typed.
   */
  function applyBusinessInfoDefaults(typeKey: string = form.businessTypeKey) {
    const bt = options?.businessTypes.find((t) => t.key === typeKey) || null;
    const previousLabel = options?.businessTypes.find((t) => t.key === form.businessTypeKey)?.label || "";
    setForm((f) => ({ ...f, officerOwnerName: f.officerOwnerName || f.contactPerson }));
    setLicenseForm((lf) => ({
      ...lf,
      ownerHomePhone: lf.ownerHomePhone || form.phone,
      // Follows the business type until someone types their own wording.
      facilityTypeOverride: !lf.facilityTypeOverride || lf.facilityTypeOverride === previousLabel ? (bt?.label || "") : lf.facilityTypeOverride,
      county: { ...lf.county, numberOfSeats: lf.county?.numberOfSeats || (bt && !bt.hasCookStep && !bt.hasHotHolding ? "0" : "") },
    }));
  }

  async function fillBlanks() {
    if (form.clientId) await prefillFromClient(form.clientId);
    applyBusinessInfoDefaults();
    toast(form.clientId ? "Filled the blank fields from the client's profile and the business info above." : "Filled the blank fields from the business info above.");
  }

  async function prefillFromClient(clientId: string) {
    const listed = clients.find((cl) => cl.client_id === clientId);
    if (!listed) { setForm((f) => ({ ...f, clientId })); return; }
    // The client list is a trimmed-down summary (no DBA, owner's home address, permit numbers, employee
    // count…), so the full record is read here — otherwise those fields could never be filled in.
    let c: any = listed;
    try {
      const full = await api.get<{ client: any }>(`/clients/${encodeURIComponent(clientId)}`);
      if (full?.client) c = { ...listed, ...full.client };
    } catch { /* fall back to the summary row */ }

    const entity = String(c.entity_type || "").trim();
    const ownerEntityType: LicenseApplicationData["ownerEntityType"] | undefined =
      !entity ? undefined : entity === "LLC" ? "LLC" : /corp|inc/i.test(entity) ? "Incorporated" : "Other";
    const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

    setForm((f) => ({
      ...f,
      clientId,
      businessName: f.businessName || c.client_name || "",
      street: f.street || text(c.street_address),
      city: f.city || text(c.city),
      zip: f.zip || text(c.zip_code),
      phone: f.phone || c.phone || "",
      email: f.email || c.email || "",
      contactPerson: f.contactPerson || c.company_contact_name || "",
      // The owner's legal name is the client's responsible party; the license number is the one already on the profile.
      officerOwnerName: f.officerOwnerName || text(c.company_contact_name) || f.contactPerson,
      licenseNumber: f.licenseNumber || text(c.health_permit_license_number),
    }));
    setLicenseForm((lf) => ({
      ...lf,
      officerTitle: !lf.officerTitle || lf.officerTitle === "Owner" ? (text(c.company_contact_title) || lf.officerTitle) : lf.officerTitle,
      tradeName: lf.tradeName || text(c.dba_name),
      ownerEntityType: lf.ownerEntityType === "LLC" && ownerEntityType ? ownerEntityType : lf.ownerEntityType,
      ownerHomeStreet: lf.ownerHomeStreet || text(c.company_contact_street_address),
      ownerHomeCity: lf.ownerHomeCity || text(c.company_contact_city),
      ownerHomeZip: lf.ownerHomeZip || text(c.company_contact_zip_code),
      ownerHomePhone: lf.ownerHomePhone || text(c.company_contact_phone) || text(c.phone) || form.phone,
      useAndOccupancyNumber: lf.useAndOccupancyNumber || text(c.use_and_occupancy_number),
      fireDeptPermitNumber: lf.fireDeptPermitNumber || text(c.fire_dept_permit_number),
      county: { ...lf.county, numberOfEmployees: lf.county?.numberOfEmployees || (c.estimated_employee_count ? String(c.estimated_employee_count) : "") },
    }));
  }

  // Deep link from the client's "Permits & Compliance" tab: ?planId=... opens
  // straight into that saved plan instead of making staff find it again in the
  // Saved Plans search; ?clientId=... (from "+ New Health Permit" on that same
  // tab) preselects AND prefills the client on a fresh form, once the client
  // list has actually loaded.
  useEffect(() => {
    const planId = searchParams.get("planId");
    const clientId = searchParams.get("clientId");
    if (planId) reopenForRenewal(planId);
    else if (clientId && clients.length > 0) prefillFromClient(clientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, clients]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.businessName.trim()) { setError("Business name is required."); return; }
    if (components.size === 0) { setError("Pick at least one item under \"What do you need?\"."); return; }
    if (wantsHaccpPlan && !form.businessTypeKey) { setError("Business type is required to generate a HACCP Plan."); return; }
    setSaving(true);
    setError(null);
    const payload = {
      businessName: form.businessName.trim(), businessTypeKey: form.businessTypeKey, jurisdiction: form.jurisdiction,
      streetAddress: form.street, city: form.city, state: "MD", zipCode: form.zip,
      phone: form.phone, email: form.email, contactPerson: form.contactPerson, licenseNumber: form.licenseNumber,
      officerOwnerName: form.officerOwnerName,
      clientId: form.clientId || null,
      selectedMenuItems: Array.from(selectedMenu), selectedEquipment,
      licenseApplicationData: licenseForm,
      components: Array.from(components),
    };
    try {
      if (form.planId) {
        await api.patch(`/haccp/plans/${form.planId}`, payload);
        setSavedPlanId(form.planId);
        toast("HACCP plan updated.");
      } else {
        const res = await api.post<{ ok: true; planId: string }>("/haccp/plans", payload);
        setForm((f) => ({ ...f, planId: res.planId }));
        setSavedPlanId(res.planId);
        toast("HACCP plan generated.");
      }
      // Any new custom items just saved to this plan were also just added to
      // the reusable library server-side — refetch so they're immediately
      // checkable in "Choose From Previously Added Items" without a reload.
      api.get<HaccpOptions>("/haccp/options").then(setOptions).catch(() => {});
      loadPlans();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this HACCP plan.");
    } finally {
      setSaving(false);
    }
  }

  function startNew() {
    setForm(EMPTY_FORM);
    setLicenseForm(EMPTY_LICENSE_FORM);
    setSelectedMenu(new Set());
    setSelectedEquipment([]);
    setSavedPlanId(null);
    setError(null);
    setComponents(new Set(["haccp_plan", "menu_equipment"]));
  }

  async function saveToDocuments(planId: string | null = savedPlanId) {
    if (!planId) return;
    setSavingToDocuments(true);
    setError(null);
    try {
      await api.post(`/haccp/plans/${planId}/save-to-documents`, {});
      toast("Saved to the client's Documents.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save to Documents.");
    } finally {
      setSavingToDocuments(false);
    }
  }

  async function handleDeletePlan(planId: string, businessName: string) {
    const ok = await confirmDialog({ title: "Delete HACCP plan", message: `Delete the saved plan for ${businessName}? This can't be undone.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.post(`/haccp/plans/${planId}/delete`, {});
      toast("Plan deleted.");
      loadPlans();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this plan.");
    }
  }

  const menuCategoriesToShow = useMemo(() => options?.menuCategories || [], [options]);

  return (
    <div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        Generate a business-specific HACCP food-safety plan, compliant with Maryland COMAR 10.15.03 and the applicable local health department. Not tied to an existing client — use this for a brand-new business's health permit application or an existing business's renewal.
      </p>

      <div className="quick-tabs" style={{ marginBottom: 16 }}>
        <button type="button" className={`quick-tab ${tab === "generate" ? "active" : ""}`} onClick={() => setTab("generate")}>Generate</button>
        <button type="button" className={`quick-tab ${tab === "saved" ? "active" : ""}`} onClick={() => setTab("saved")}>Saved Plans</button>
      </div>

      {tab === "saved" && (
        <div className="command-panel" style={{ marginBottom: 24 }}>
          <div className="command-panel-header">
            <div>
              <h2 className="command-panel-title">Saved HACCP Plans</h2>
              <div className="command-panel-note">Reopen a saved plan to reprint it as-is, or edit it for a permit renewal.</div>
            </div>
          </div>
          <div style={{ padding: "0 16px 12px" }}>
            <input placeholder="Search by business name…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", width: 260 }} />
          </div>
          {!plans && <div className="spinner-wrap">Loading…</div>}
          {plans && plans.length === 0 && <p className="muted" style={{ padding: "0 16px 16px" }}>No saved plans yet.</p>}
          {plans && plans.length > 0 && (
            <div className="table-scroll">
              <table>
                <thead><tr><th scope="col">Business</th><th scope="col">Type</th><th scope="col">Jurisdiction</th><th scope="col">Includes</th><th scope="col">Linked Client</th><th scope="col">Updated</th><th scope="col"></th></tr></thead>
                <tbody>
                  {plans.map((p) => {
                    const pc = new Set(p.components?.length ? p.components : ["haccp_plan", "menu_equipment"]);
                    return (
                    <tr key={p.plan_id}>
                      <td>{p.business_name}</td>
                      <td className="muted">{options?.businessTypes.find((t) => t.key === p.business_type_key)?.label || p.business_type_key}</td>
                      <td className="muted">{p.jurisdiction}</td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {HACCP_PLAN_COMPONENTS.filter((c) => pc.has(c.key)).map((c) => (
                            <span key={c.key} className="quick-tab active" style={{ fontSize: 10.5, padding: "2px 6px" }}>
                              {c.key === "license_application" ? licenseDocName(p.jurisdiction) : c.key === "plan_review" ? planReviewDocName(p.jurisdiction) : c.label}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="muted">{p.client_id || "—"}</td>
                      <td className="muted">{new Date(p.updated_at).toLocaleDateString()}</td>
                      <td>
                        {(() => {
                          const base = fileBase(p.business_name);
                          const docs: { show: boolean; label: string; path: string; name: string; docx?: string }[] = [
                            { show: pc.has("haccp_plan"), label: "HACCP Plan", path: `/haccp/plans/${p.plan_id}/pdf`, name: `${base} - HACCP Plan`, docx: `/haccp/plans/${p.plan_id}/docx` },
                            { show: pc.has("menu_equipment"), label: "Menu & Equipment List", path: `/haccp/plans/${p.plan_id}/pdf?only=menu_equipment`, name: `${base} - Menu & Equipment List`, docx: `/haccp/plans/${p.plan_id}/docx?only=menu_equipment` },
                            { show: pc.has("license_application"), label: licenseDocName(p.jurisdiction), path: `/haccp/plans/${p.plan_id}/license-pdf`, name: `${base} - ${licenseDocName(p.jurisdiction)}` },
                            { show: pc.has("plan_review"), label: planReviewDocName(p.jurisdiction), path: `/haccp/plans/${p.plan_id}/plan-review-pdf`, name: `${base} - ${planReviewDocName(p.jurisdiction)}` },
                          ];
                          return (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 380 }}>
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                <button className="btn btn-sm btn-primary" onClick={() => reopenForRenewal(p.plan_id)}>Open / Renew</button>
                                {p.client_id && <button className="btn btn-sm" onClick={() => saveToDocuments(p.plan_id)} disabled={savingToDocuments} title="Saves every document in this plan to the client's Documents tab, named by document.">Save to Documents</button>}
                                {isAdmin && <button className="btn btn-sm danger-button" onClick={() => handleDeletePlan(p.plan_id, p.business_name)}>Delete</button>}
                              </div>
                              {docs.filter((d) => d.show).map((d) => (
                                <div key={d.label} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                  <span className="muted" style={{ fontSize: 11.5, minWidth: 150 }}>{d.label}</span>
                                  <button className="btn btn-sm" onClick={() => viewFile(d.path, `${d.name}.pdf`)}>View</button>
                                  <button className="btn btn-sm" onClick={() => printFile(d.path)}>Print</button>
                                  <button className="btn btn-sm" onClick={() => downloadFile(d.path, `${d.name}.pdf`)}>Download PDF</button>
                                  {d.docx && <button className="btn btn-sm" onClick={() => downloadFile(d.docx!, `${d.name} (Editable).docx`)}>Word</button>}
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "generate" && (
        <form onSubmit={handleSubmit} className="card" style={{ marginBottom: 24 }}>
          {form.planId && (
            <div className="card" style={{ marginBottom: 16, borderColor: "var(--teal)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Editing saved plan {form.planId}.</span>
              <button type="button" className="btn btn-sm" onClick={startNew}>Start New Plan Instead</button>
            </div>
          )}
          {error && <ErrorBanner error={error} />}

          <div className="form-section-title">What do you need?</div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Check everything this business needs — build exactly the package required, nothing more.</p>
          <div className="hp-component-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 20 }}>
            {HACCP_PLAN_COMPONENTS.map((c) => {
              const checked = components.has(c.key);
              return (
                <label
                  key={c.key}
                  htmlFor={`hp-component-${c.key}`}
                  className="card"
                  style={{
                    display: "flex", gap: 10, alignItems: "flex-start", padding: 12, margin: 0, cursor: "pointer",
                    borderColor: checked ? "var(--teal)" : undefined, background: checked ? "var(--surface-2, #f0f7f6)" : undefined,
                  }}
                >
                  <input id={`hp-component-${c.key}`} type="checkbox" checked={checked} onChange={() => toggleComponent(c.key)} style={{ marginTop: 2, width: "auto" }} />
                  <span>
                    <span style={{ display: "block", fontWeight: 700, fontSize: 13.5 }}>{c.label}</span>
                    <span className="muted" style={{ fontSize: 11.5 }}>{c.description}</span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="form-section-title">Business Information</div>
          <div className="form-grid-3">
            <div className="field"><label htmlFor="hp-name">Business Name</label><input id="hp-name" required value={form.businessName} onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))} /></div>
            <div className="field">
              <label htmlFor="hp-type">Business Type{!wantsHaccpPlan && " (optional — for reference)"}</label>
              <select id="hp-type" required={wantsHaccpPlan} value={form.businessTypeKey} onChange={(e) => { setForm((f) => ({ ...f, businessTypeKey: e.target.value })); applyBusinessInfoDefaults(e.target.value); void chooseTypeOrJurisdiction(e.target.value, form.jurisdiction); }}>
                <option value="">Select…</option>
                {options?.businessTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="hp-juris">Jurisdiction</label>
              <select id="hp-juris" value={form.jurisdiction} onChange={(e) => { setForm((f) => ({ ...f, jurisdiction: e.target.value })); if (form.businessTypeKey) void chooseTypeOrJurisdiction(form.businessTypeKey, e.target.value); }}>
                {JURISDICTIONS.map((j) => <option key={j}>{j}</option>)}
              </select>
            </div>
          </div>
          {businessType && <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 12 }}>{businessType.description}</p>}

          {riskCheck && (riskCheck.reasons.length > 0 || riskCheck.microwave) && (
            <div className="card" style={{ borderColor: "var(--amber)", padding: 12, marginBottom: 12 }}>
              <strong style={{ color: "var(--amber)" }}>Check the business type</strong>
              {riskCheck.reasons.length > 0 && (
                <div style={{ fontSize: 12.5, marginTop: 4 }}>
                  You chose <strong>{riskCheck.type.label}</strong> ({riskCheck.type.riskPriority} priority), but {riskCheck.reasons.join(" and ")}. That is a riskier operation than this type describes, so the documents and HACCP wording would be wrong.
                  {riskCheck.suggestKey && riskCheck.suggestLabel && (
                    <div style={{ marginTop: 8 }}>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => { setForm((f) => ({ ...f, businessTypeKey: riskCheck.suggestKey! })); void chooseTypeOrJurisdiction(riskCheck.suggestKey!, form.jurisdiction); }}>
                        Switch to “{riskCheck.suggestLabel}”
                      </button>
                    </div>
                  )}
                </div>
              )}
              {riskCheck.microwave && (
                <div style={{ fontSize: 12.5, marginTop: riskCheck.reasons.length ? 8 : 4 }}>
                  <strong>Microwave:</strong> it doesn't change the rating on its own. If staff heat food for customers, this is a Moderate priority operation — choose a type with a cook step. If it is only for customers to use themselves, keep this type and tell the health department.
                </div>
              )}
            </div>
          )}

          {requirements && businessType && (
            <div className="card" style={{ padding: 14, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                <strong style={{ fontSize: 14 }}>What this business needs</strong>
                <span style={{
                  fontSize: 11.5, fontWeight: 700, padding: "2px 10px", borderRadius: 999, color: "#fff",
                  background: requirements.riskPriority === "Low" ? "var(--teal)" : requirements.riskPriority === "Moderate" ? "var(--amber)" : "var(--red)",
                }}>{requirements.riskPriority.toUpperCase()} PRIORITY</span>
                <span className="muted" style={{ fontSize: 11.5 }}>{form.jurisdiction} · the health department assigns the final level</span>
              </div>
              <p style={{ fontSize: 12.5, margin: "0 0 10px" }}>{requirements.priorityReason}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {requirements.documents.map((d) => (
                  <div key={d.label} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5 }}>
                    <span style={{
                      minWidth: 92, textAlign: "center", fontSize: 10.5, fontWeight: 700, padding: "2px 6px", borderRadius: 6,
                      background: d.status === "required" ? "rgba(11,107,107,.12)" : d.status === "not_required" ? "rgba(120,120,120,.15)" : "rgba(217,119,6,.15)",
                      color: d.status === "required" ? "var(--teal)" : d.status === "not_required" ? "var(--muted, #666)" : "var(--amber)",
                    }}>{d.status === "required" ? "REQUIRED" : d.status === "not_required" ? "NOT REQUIRED" : "IF APPLICABLE"}</span>
                    <span><strong>{d.label}</strong> — <span className="muted">{d.why}</span></span>
                  </div>
                ))}
              </div>
              {requirements.attachments.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 12.5 }}>
                  <strong>Gather and attach:</strong>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{requirements.attachments.map((a) => <li key={a}>{a}</li>)}</ul>
                </div>
              )}
              {requirements.fees.length > 0 && <p className="muted" style={{ fontSize: 11.5, margin: "8px 0 0" }}>{requirements.fees.join(" · ")}</p>}
              {form.jurisdiction === "Baltimore County" && (
                <div className="field" style={{ maxWidth: 420, marginTop: 10, marginBottom: 0 }}>
                  <label htmlFor="hp-building-permit">Does this work need a building permit?</label>
                  <select id="hp-building-permit" value={licenseForm.county?.buildingPermit || ""} onChange={(e) => {
                    const v = e.target.value as "" | "yes" | "no";
                    setLicenseForm((f) => ({ ...f, county: { ...f.county, buildingPermit: v || undefined } }));
                    void loadRequirements(form.businessTypeKey, form.jurisdiction, v).then((req) => { if (req) setComponents(new Set(req.defaultComponents)); });
                  }}>
                    <option value="">Not sure yet</option>
                    <option value="no">No — the County said no building inspections are required</option>
                    <option value="yes">Yes — construction, remodeling or alterations</option>
                  </select>
                </div>
              )}
              <p className="muted" style={{ fontSize: 11.5, margin: "6px 0 0" }}>Also needed outside the health department: {requirements.relatedApprovals.join("; ")}.</p>
              <div style={{ marginTop: 10 }}>
                <button type="button" className="btn btn-sm" onClick={() => setComponents(new Set(requirements.defaultComponents))}>Select the required documents</button>
              </div>
            </div>
          )}

          <AddressFields
            idPrefix="hp"
            showStateField={false}
            value={{ street: form.street, city: form.city, state: "MD", zip: form.zip }}
            onChange={(patch) => setForm((f) => ({ ...f, street: patch.street ?? f.street, city: patch.city ?? f.city, zip: patch.zip ?? f.zip }))}
          />
          <div className="form-grid-3">
            <div className="field"><label htmlFor="hp-phone">Phone</label><input id="hp-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
            <div className="field"><label htmlFor="hp-email">Email</label><input id="hp-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
            <div className="field"><label htmlFor="hp-contact">Contact Person</label><input id="hp-contact" value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))} /></div>
          </div>
          <div className="form-grid-3">
            <div className="field"><label htmlFor="hp-license">License / Permit #</label><input id="hp-license" value={form.licenseNumber} onChange={(e) => setForm((f) => ({ ...f, licenseNumber: e.target.value }))} placeholder="Optional" /></div>
            <div className="field">
              <label htmlFor="hp-client">Link to Existing Client (optional)</label>
              <select id="hp-client" value={form.clientId} onChange={(e) => prefillFromClient(e.target.value)}>
                <option value="">Not a client yet / no link</option>
                {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name} ({c.client_id})</option>)}
              </select>
            </div>
          </div>

          <div className="form-section-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Menu Items
            <button type="button" className="btn btn-sm" onClick={selectAllMenu} style={{ textTransform: "none", fontWeight: 400 }}>Select All</button>
            <button type="button" className="btn btn-sm" onClick={clearAllMenu} style={{ textTransform: "none", fontWeight: 400 }}>Clear All</button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Check every item this business sells or serves — only checked items appear on the printed plan. Not on the list? Type it below and add it.{" "}
            {wantsHaccpPlan && components.has("menu_equipment")
              ? "Feeds both the HACCP Plan's Menu/Equipment page and the standalone Menu & Equipment List."
              : wantsHaccpPlan
              ? "Feeds the HACCP Plan's Menu/Equipment page."
              : "This becomes your Menu & Equipment List's own document."}
          </p>
          {(plans || []).filter((p) => p.plan_id !== form.planId).length > 0 && (
            <div className="field" style={{ maxWidth: 340, marginBottom: 10 }}>
              <label htmlFor="hp-copy-plan">Copy Items From Another Plan (optional)</label>
              <select
                id="hp-copy-plan" value={copyFromPlanId} disabled={copyingItems}
                onChange={(e) => { const id = e.target.value; setCopyFromPlanId(id); if (id) copyItemsFromPlan(id); }}
              >
                <option value="">{copyingItems ? "Copying…" : "Choose a saved plan…"}</option>
                {(plans || []).filter((p) => p.plan_id !== form.planId).map((p) => (
                  <option key={p.plan_id} value={p.plan_id}>{p.business_name} ({p.plan_id})</option>
                ))}
              </select>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>Adds that plan's menu &amp; equipment to what's checked here — doesn't touch business info.</div>
            </div>
          )}
          {menuCategoriesToShow.map((cat) => (
            <div key={cat.category} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{cat.category}</span>
                <button type="button" onClick={() => selectAllMenuCategory(cat)} style={{ background: "none", border: "none", color: "var(--teal)", cursor: "pointer", padding: 0, fontSize: 11, textDecoration: "underline" }}>Select All {cat.category}</button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
                {cat.items.map((item) => (
                  <label key={item.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={selectedMenu.has(item.key)} onChange={() => toggleMenu(item.key)} />
                    {item.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
              Choose From Previously Added Items
              <span className="muted" style={{ fontWeight: 400 }}> — only applies to this plan, not the master checklist above</span>
            </div>
            {(options?.customMenuItems || []).length === 0 ? (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Empty for now — nothing's been typed or pasted into a plan yet. Every item you add below (single, pasted, or from Copy Items) is
                saved here automatically, so the next plan can just check it off instead of retyping it.
              </p>
            ) : (
              <>
                <input
                  value={savedItemSearch} onChange={(e) => setSavedItemSearch(e.target.value)}
                  placeholder="Search previously typed items…" style={{ maxWidth: 280, padding: "5px 9px", fontSize: 12.5, marginBottom: 6 }}
                />
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", maxHeight: 140, overflowY: "auto" }}>
                  {(options?.customMenuItems || [])
                    .filter((label) => label.toLowerCase().includes(savedItemSearch.trim().toLowerCase()))
                    .map((label) => (
                      <label key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                        <input type="checkbox" checked={selectedMenu.has(label)} onChange={() => toggleMenu(label)} />
                        {label}
                      </label>
                    ))}
                </div>
              </>
            )}
          </div>
          {customMenuItems.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Added Items</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
                {customMenuItems.map((value) => (
                  <span key={value} className="quick-tab active" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "3px 8px" }}>
                    {value}
                    <button type="button" onClick={() => removeMenuItem(value)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontSize: 13, lineHeight: 1 }} aria-label={`Remove ${value}`}>×</button>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input value={customMenuInput} onChange={(e) => setCustomMenuInput(e.target.value)} placeholder="e.g. Rotisserie Chicken" style={{ maxWidth: 240, padding: "6px 10px" }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomMenuItem(); } }} />
            <button type="button" className="btn btn-sm" onClick={addCustomMenuItem}>Add Item</button>
            <button type="button" className="btn btn-sm" onClick={() => setShowBulkMenuInput((v) => !v)} style={{ textTransform: "none", fontWeight: 400 }}>
              {showBulkMenuInput ? "Cancel paste" : "Paste Multiple Items…"}
            </button>
          </div>
          {showBulkMenuInput && (
            <div style={{ marginBottom: 16 }}>
              <p className="muted" style={{ fontSize: 12, margin: "0 0 6px" }}>
                Paste a whole menu or list — one item per line (copy straight from a menu doc). Each line becomes its own item on the plan.
              </p>
              <textarea
                value={bulkMenuInput} onChange={(e) => setBulkMenuInput(e.target.value)} rows={6}
                placeholder={"Chicken Over Rice\nLamb Gyro\nCatfish\n…"}
                style={{ width: "100%", maxWidth: 480, padding: "8px 10px", fontFamily: "inherit", fontSize: 13 }}
              />
              <div style={{ marginTop: 6 }}>
                <button type="button" className="btn btn-sm btn-primary" onClick={addBulkMenuItems} disabled={!bulkMenuInput.trim()}>
                  Add All Lines
                </button>
              </div>
            </div>
          )}

          <div className="form-section-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Equipment
            <button type="button" className="btn btn-sm" onClick={selectAllEquipment} style={{ textTransform: "none", fontWeight: 400 }}>Select All</button>
            <button type="button" className="btn btn-sm" onClick={clearAllEquipment} style={{ textTransform: "none", fontWeight: 400 }}>Clear All</button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Check every piece of equipment on site — set a quantity if there's more than one. Not on the list? Type it below and add it.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginBottom: 10 }}>
            {options?.equipmentItems.map((item) => {
              const selected = selectedEquipment.find((e) => e.key === item.key);
              return (
                <div key={item.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={Boolean(selected)} onChange={() => toggleEquipment(item.key, item.label)} />
                    {item.label}
                  </label>
                  {selected && (
                    <input type="number" min={1} value={selected.quantity} onChange={(e) => setEquipmentQuantity(item.key, Number(e.target.value))} style={{ width: 44, padding: "2px 4px", fontSize: 12 }} aria-label={`Quantity of ${item.label}`} />
                  )}
                </div>
              );
            })}
          </div>
          {customEquipmentItems.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Added Items</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
                {customEquipmentItems.map((item) => (
                  <div key={item.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <span>{item.label}</span>
                    <input type="number" min={1} value={item.quantity} onChange={(e) => setEquipmentQuantity(item.key, Number(e.target.value))} style={{ width: 44, padding: "2px 4px", fontSize: 12 }} aria-label={`Quantity of ${item.label}`} />
                    <button type="button" onClick={() => removeEquipmentItem(item.key)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1 }} aria-label={`Remove ${item.label}`}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input value={customEquipmentInput} onChange={(e) => setCustomEquipmentInput(e.target.value)} placeholder="e.g. Panini Press" style={{ maxWidth: 240, padding: "6px 10px" }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomEquipmentItem(); } }} />
            <button type="button" className="btn btn-sm" onClick={addCustomEquipmentItem}>Add Item</button>
          </div>

          {wantsLicenseOrReview && (
          <>
          <div className="form-section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>License &amp; Permit Applications</span>
            <button type="button" className="btn btn-sm" onClick={() => { void fillBlanks(); }}
              title="Fills only the fields that are still empty — owner name, DBA, owner's home address and phone, permit numbers, employee count, facility type — from this client's profile and the business info above.">
              ↻ Fill blanks from business info
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            {form.jurisdiction === "Baltimore County"
              ? "Fills the Baltimore County Food Service Facility Permit Application — together with the HACCP plan above and the Plans Review Submission Guide, this is the whole package. Baltimore County has no separate fillable \"Plan Review Application\"; its real process is to submit this permit application plus the plans/HACCP plan/equipment cut sheets to the office named in the guide."
              : "Fills the Baltimore City Food Facility License Application and Plan Review Application — together with the HACCP plan above, these three documents are the whole submission package."}
          </p>
          <div className="form-grid-3">
            <div className="field"><label htmlFor="hp-officer-name">Officer/Owner Name</label><input id="hp-officer-name" value={form.officerOwnerName} onChange={(e) => setForm((f) => ({ ...f, officerOwnerName: e.target.value }))} placeholder="Legal name — fills every form's Owner/Applicant field" /></div>
            <div className="field"><label htmlFor="hp-officer-title">Officer/Owner Title</label><input id="hp-officer-title" value={licenseForm.officerTitle} onChange={(e) => setLicenseForm((f) => ({ ...f, officerTitle: e.target.value }))} placeholder="e.g. Owner" /></div>
            <div className="field"><label htmlFor="hp-trade-name">Trade Name (DBA)</label><input id="hp-trade-name" value={licenseForm.tradeName} onChange={(e) => setLicenseForm((f) => ({ ...f, tradeName: e.target.value }))} placeholder="Optional" /></div>
          </div>
          <div className="form-grid-3">
            <div className="field">
              <label htmlFor="hp-entity-type">Owner Entity Type</label>
              <select id="hp-entity-type" value={licenseForm.ownerEntityType} onChange={(e) => setLicenseForm((f) => ({ ...f, ownerEntityType: e.target.value as LicenseApplicationData["ownerEntityType"] }))}>
                <option value="Incorporated">Incorporated</option>
                <option value="LLC">LLC</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
          <div className="form-grid-3">
            <div className="field"><label htmlFor="hp-owner-street">Owner's Home Address</label><input id="hp-owner-street" value={licenseForm.ownerHomeStreet} onChange={(e) => setLicenseForm((f) => ({ ...f, ownerHomeStreet: e.target.value }))} /></div>
            <div className="field"><label htmlFor="hp-owner-city">Owner's Home City</label><input id="hp-owner-city" value={licenseForm.ownerHomeCity} onChange={(e) => setLicenseForm((f) => ({ ...f, ownerHomeCity: e.target.value }))} /></div>
            <div className="field"><label htmlFor="hp-owner-zip">Owner's Home ZIP</label><input id="hp-owner-zip" value={licenseForm.ownerHomeZip} onChange={(e) => setLicenseForm((f) => ({ ...f, ownerHomeZip: e.target.value }))} /></div>
          </div>
          <div className="form-grid-3">
            <div className="field"><label htmlFor="hp-owner-phone">Owner's Home Phone</label><input id="hp-owner-phone" value={licenseForm.ownerHomePhone} onChange={(e) => setLicenseForm((f) => ({ ...f, ownerHomePhone: e.target.value }))} /></div>
            <div className="field"><label htmlFor="hp-mailing">Mailing Address (if different)</label><input id="hp-mailing" value={licenseForm.mailingAddress} onChange={(e) => setLicenseForm((f) => ({ ...f, mailingAddress: e.target.value }))} placeholder="Optional" /></div>
            <div className="field"><label htmlFor="hp-facility-type">Facility Type (Plan Review App)</label><input id="hp-facility-type" value={licenseForm.facilityTypeOverride} onChange={(e) => setLicenseForm((f) => ({ ...f, facilityTypeOverride: e.target.value }))} placeholder={businessType?.label || "Defaults to Business Type"} /></div>
          </div>
          <div className="form-grid-3">
            <div className="field">
              <label htmlFor="hp-uo-number">Use and Occupancy Number</label>
              <input id="hp-uo-number" value={licenseForm.useAndOccupancyNumber} onChange={(e) => setLicenseForm((f) => ({ ...f, useAndOccupancyNumber: e.target.value }))} placeholder="Optional" />
              {form.clientId && licenseForm.useAndOccupancyNumber && clients.find((c) => c.client_id === form.clientId)?.use_and_occupancy_number === licenseForm.useAndOccupancyNumber && (
                <div className="muted" style={{ fontSize: 11 }}>From client profile — editable here.</div>
              )}
            </div>
            <div className="field">
              <label htmlFor="hp-fire-permit">Fire Department Permit Number</label>
              <input id="hp-fire-permit" value={licenseForm.fireDeptPermitNumber} onChange={(e) => setLicenseForm((f) => ({ ...f, fireDeptPermitNumber: e.target.value }))} placeholder="Optional" />
              {form.clientId && licenseForm.fireDeptPermitNumber && clients.find((c) => c.client_id === form.clientId)?.fire_dept_permit_number === licenseForm.fireDeptPermitNumber && (
                <div className="muted" style={{ fontSize: 11 }}>From client profile — editable here.</div>
              )}
            </div>
          </div>

          {form.jurisdiction === "Baltimore City" && components.has("plan_review") && (
            <>
              <div className="field" style={{ marginBottom: 12 }}>
                <label>Waste Hauler Service</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="radio" name="hp-waste" checked={licenseForm.wasteHaulerOption === "under3"} onChange={() => setLicenseForm((f) => ({ ...f, wasteHaulerOption: "under3" }))} />
                    3 or fewer 32-gallon trash receptacles per week
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="radio" name="hp-waste" checked={licenseForm.wasteHaulerOption === "contract"} onChange={() => setLicenseForm((f) => ({ ...f, wasteHaulerOption: "contract" }))} />
                    More than 3, with a licensed waste hauler contract
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="radio" name="hp-waste" checked={licenseForm.wasteHaulerOption === "smallHauler"} onChange={() => setLicenseForm((f) => ({ ...f, wasteHaulerOption: "smallHauler" }))} />
                    More than 3, with a small hauler license
                    {licenseForm.wasteHaulerOption === "smallHauler" && (
                      <input value={licenseForm.smallHaulerLicenseNumber} onChange={(e) => setLicenseForm((f) => ({ ...f, smallHaulerLicenseNumber: e.target.value }))} placeholder="License #" style={{ marginLeft: 8, width: 140, padding: "3px 8px" }} />
                    )}
                  </label>
                </div>
              </div>

              <div className="field" style={{ marginBottom: 12 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, textTransform: "none", fontSize: 13 }}>
                  <input type="checkbox" checked={Boolean(licenseForm.sellsTobacco)} onChange={(e) => setLicenseForm((f) => ({ ...f, sellsTobacco: e.target.checked }))} style={{ width: "auto" }} />
                  This business sells tobacco/electronic smoking products
                </label>
                {licenseForm.sellsTobacco && (
                  <input value={licenseForm.tobaccoLicenseNumber} onChange={(e) => setLicenseForm((f) => ({ ...f, tobaccoLicenseNumber: e.target.value }))} placeholder="MD tobacco license # (if known)" style={{ marginTop: 6, maxWidth: 260 }} />
                )}
              </div>

              <div className="field" style={{ marginBottom: 16 }}>
                <label>Permits Applied For (Plan Review App)</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginTop: 6 }}>
                  {PERMIT_OPTIONS.map((p) => (
                    <label key={p.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input type="checkbox" checked={(licenseForm.permitsApplied || []).includes(p.key)} onChange={() => togglePermit(p.key)} />
                      {p.label}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {form.jurisdiction === "Baltimore County" && (
            <>
              <div className="form-grid-3">
                <div className="field">
                  <label htmlFor="hp-app-type">Type of Application</label>
                  <select id="hp-app-type" value={licenseForm.county?.applicationType || ""} onChange={(e) => setLicenseForm((f) => ({ ...f, county: { ...f.county, applicationType: e.target.value } }))}>
                    <option value="">{form.licenseNumber ? "Renewal (permit # on file)" : "New (no permit # yet)"}</option>
                    <option value="New">New</option>
                    <option value="Renewal">Renewal</option>
                    <option value="Change of Ownership">Change of Ownership</option>
                  </select>
                </div>
                <div className="field"><label htmlFor="hp-facility-class">Facility Classification</label><input id="hp-facility-class" value={licenseForm.county?.facilityClassification} onChange={(e) => setLicenseForm((f) => ({ ...f, county: { ...f.county, facilityClassification: e.target.value } }))} placeholder="e.g. Retail Food Store" /></div>
                <div className="field"><label htmlFor="hp-seats">Number of Seats Provided</label><input id="hp-seats" value={licenseForm.county?.numberOfSeats} onChange={(e) => setLicenseForm((f) => ({ ...f, county: { ...f.county, numberOfSeats: e.target.value } }))} placeholder="0 if none" /></div>
                <div className="field"><label htmlFor="hp-employees">No. of Employees</label><input id="hp-employees" value={licenseForm.county?.numberOfEmployees} onChange={(e) => setLicenseForm((f) => ({ ...f, county: { ...f.county, numberOfEmployees: e.target.value } }))} /></div>
              </div>
              <div className="form-grid-3">
                <div className="field"><label htmlFor="hp-water">Water Service</label><input id="hp-water" value={licenseForm.county?.waterService} onChange={(e) => setLicenseForm((f) => ({ ...f, county: { ...f.county, waterService: e.target.value } }))} placeholder="e.g. Public" /></div>
                <div className="field"><label htmlFor="hp-sewage">Sewage Disposal</label><input id="hp-sewage" value={licenseForm.county?.sewageDisposal} onChange={(e) => setLicenseForm((f) => ({ ...f, county: { ...f.county, sewageDisposal: e.target.value } }))} placeholder="e.g. Public" /></div>
                <div className="field"><label htmlFor="hp-days">Days of Operation</label><input id="hp-days" value={licenseForm.county?.daysOfOperation} onChange={(e) => setLicenseForm((f) => ({ ...f, county: { ...f.county, daysOfOperation: e.target.value } }))} placeholder="e.g. Mon–Sat" /></div>
              </div>
              <div className="form-grid-3">
                <div className="field"><label htmlFor="hp-hours">Hours of Operation</label><input id="hp-hours" value={licenseForm.county?.hoursOfOperation} onChange={(e) => setLicenseForm((f) => ({ ...f, county: { ...f.county, hoursOfOperation: e.target.value } }))} placeholder="e.g. 7am–9pm" /></div>
                <div className="field"><label htmlFor="hp-facility-type-county">Facility Type (Plans Review Guide)</label><input id="hp-facility-type-county" value={licenseForm.facilityTypeOverride} onChange={(e) => setLicenseForm((f) => ({ ...f, facilityTypeOverride: e.target.value }))} placeholder={businessType?.label || "Defaults to Business Type"} /></div>
                <div className="field">
                  <label htmlFor="hp-correspondence">Send Correspondence To</label>
                  <select id="hp-correspondence" value={licenseForm.county?.sendCorrespondenceTo} onChange={(e) => setLicenseForm((f) => ({ ...f, county: { ...f.county, sendCorrespondenceTo: e.target.value as CountyPermitData["sendCorrespondenceTo"] } }))}>
                    <option value="trade">Trade Name Address</option>
                    <option value="owner">Owner Address</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={Boolean(licenseForm.county?.cateringServiceProvided)} onChange={(e) => setLicenseForm((f) => ({ ...f, county: { ...f.county, cateringServiceProvided: e.target.checked } }))} />
                  Catering service provided
                </label>
                {licenseForm.county?.cateringServiceProvided && (
                  <input value={licenseForm.county?.cateringId} onChange={(e) => setLicenseForm((f) => ({ ...f, county: { ...f.county, cateringId: e.target.value } }))} placeholder="Catering ID #" style={{ width: 160, padding: "3px 8px" }} />
                )}
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={Boolean(licenseForm.county?.majorMenuChanges)} onChange={(e) => setLicenseForm((f) => ({ ...f, county: { ...f.county, majorMenuChanges: e.target.checked } }))} />
                  Major menu changes during the year
                </label>
              </div>

              <div className="field" style={{ marginBottom: 12 }}>
                <label>Certified Food Managers (Baltimore County ID)</label>
                {(licenseForm.county?.certifiedFoodManagers || []).map((mgr, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                    <input value={mgr.name} onChange={(e) => updateManager(i, { name: e.target.value })} placeholder="Name" style={{ flex: 2 }} />
                    <input value={mgr.idNumber} onChange={(e) => updateManager(i, { idNumber: e.target.value })} placeholder="County ID #" style={{ flex: 1 }} />
                    <input value={mgr.expirationDate} onChange={(e) => updateManager(i, { expirationDate: e.target.value })} placeholder="Expiration" style={{ flex: 1 }} />
                    <button type="button" className="btn btn-sm" onClick={() => removeManager(i)}>Remove</button>
                  </div>
                ))}
                <button type="button" className="btn btn-sm" onClick={addManager}>Add Manager</button>
              </div>

              <div className="form-grid-3" style={{ marginBottom: 16 }}>
                <div className="field"><label htmlFor="hp-resident-agent">Resident Agent (if out of state)</label><input id="hp-resident-agent" value={licenseForm.county?.residentAgentName} onChange={(e) => setLicenseForm((f) => ({ ...f, county: { ...f.county, residentAgentName: e.target.value } }))} placeholder="Optional" /></div>
                <div className="field"><label htmlFor="hp-resident-agent-phone">Resident Agent Phone</label><input id="hp-resident-agent-phone" value={licenseForm.county?.residentAgentPhone} onChange={(e) => setLicenseForm((f) => ({ ...f, county: { ...f.county, residentAgentPhone: e.target.value } }))} placeholder="Optional" /></div>
                <div className="field"><label htmlFor="hp-facility-id">Facility ID (if known)</label><input id="hp-facility-id" value={licenseForm.county?.facilityId} onChange={(e) => setLicenseForm((f) => ({ ...f, county: { ...f.county, facilityId: e.target.value } }))} placeholder="Assigned by the County" /></div>
              </div>
            </>
          )}
          </>
          )}

          {wantsLicenseOrReview && submissionChecklist.length > 0 && (
            <div className="card" style={{ padding: 14, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                <strong style={{ fontSize: 14 }}>Before you submit</strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  {submissionChecklist.filter((i) => i.level === "todo").length} to supply · {submissionChecklist.filter((i) => i.level === "check").length} to check · {submissionChecklist.filter((i) => i.level === "done").length} done
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {submissionChecklist.map((i, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5 }}>
                    <span style={{
                      minWidth: 70, textAlign: "center", fontSize: 10.5, fontWeight: 700, padding: "2px 6px", borderRadius: 6,
                      background: i.level === "todo" ? "rgba(220,38,38,.12)" : i.level === "check" ? "rgba(217,119,6,.15)" : "rgba(11,107,107,.12)",
                      color: i.level === "todo" ? "var(--red)" : i.level === "check" ? "var(--amber)" : "var(--teal)",
                    }}>{i.level === "todo" ? "TO SUPPLY" : i.level === "check" ? "CHECK" : "DONE"}</span>
                    <span><strong>{i.text}</strong>{i.detail && <> — <span className="muted">{i.detail}</span></>}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : form.planId ? "Save & Regenerate" : "Generate Plan"}</button>
            {savedPlanId && (
              <>
                {wantsHaccpPlan && (
                  <>
                    <span className="muted" style={{ fontSize: 12 }}>HACCP Plan:</span>
                    <button type="button" className="btn" onClick={() => viewFile(`/haccp/plans/${savedPlanId}/pdf`, `${downloadBaseName} - HACCP Plan.pdf`)}>HACCP Plan</button>
                    <button type="button" className="btn btn-sm" onClick={() => downloadFile(`/haccp/plans/${savedPlanId}/pdf`, `${downloadBaseName} - HACCP Plan.pdf`)}>Download</button>
                    <button type="button" className="btn btn-sm" onClick={() => downloadFile(`/haccp/plans/${savedPlanId}/docx`, `${downloadBaseName} - HACCP Plan (Editable).docx`)}>Download (Word)</button>
                    <button type="button" className="btn btn-sm" onClick={() => printFile(`/haccp/plans/${savedPlanId}/pdf`)}>Print</button>
                  </>
                )}
                {components.has("menu_equipment") && (
                  <>
                    <span className="muted" style={{ fontSize: 12 }}>Menu &amp; Equipment List:</span>
                    <button type="button" className="btn" onClick={() => viewFile(`/haccp/plans/${savedPlanId}/pdf?only=menu_equipment`, `${downloadBaseName} - Menu & Equipment List.pdf`)}>Menu &amp; Equipment List</button>
                    <button type="button" className="btn btn-sm" onClick={() => downloadFile(`/haccp/plans/${savedPlanId}/pdf?only=menu_equipment`, `${downloadBaseName} - Menu & Equipment List.pdf`)}>Download</button>
                    <button type="button" className="btn btn-sm" onClick={() => downloadFile(`/haccp/plans/${savedPlanId}/docx?only=menu_equipment`, `${downloadBaseName} - Menu & Equipment List (Editable).docx`)}>Download (Word)</button>
                    <button type="button" className="btn btn-sm" onClick={() => printFile(`/haccp/plans/${savedPlanId}/pdf?only=menu_equipment`)}>Print</button>
                  </>
                )}
                {components.has("license_application") && (
                  <>
                    <span className="muted" style={{ fontSize: 12 }}>{form.jurisdiction === "Baltimore County" ? "Permit Application:" : "License Application:"}</span>
                    <button type="button" className="btn" onClick={() => viewFile(`/haccp/plans/${savedPlanId}/license-pdf`, `${downloadBaseName} - ${licenseDocName(form.jurisdiction)}.pdf`)}>{form.jurisdiction === "Baltimore County" ? "Food Service Permit Application" : "Food License Application"}</button>
                    <button type="button" className="btn btn-sm" onClick={() => downloadFile(`/haccp/plans/${savedPlanId}/license-pdf`, `${downloadBaseName} - ${form.jurisdiction === "Baltimore County" ? "Food Service Permit Application" : "Food License Application"}.pdf`)}>{form.jurisdiction === "Baltimore County" ? "Download Permit App" : "Download License App"}</button>
                    <button type="button" className="btn btn-sm" onClick={() => printFile(`/haccp/plans/${savedPlanId}/license-pdf`)}>{form.jurisdiction === "Baltimore County" ? "Print Permit App" : "Print License App"}</button>
                  </>
                )}
                {components.has("plan_review") && (
                  <>
                    <span className="muted" style={{ fontSize: 12 }}>{form.jurisdiction === "Baltimore County" ? "Plans Review Guide:" : "Plan Review Application:"}</span>
                    <button type="button" className="btn" onClick={() => viewFile(`/haccp/plans/${savedPlanId}/plan-review-pdf`, `${downloadBaseName} - ${planReviewDocName(form.jurisdiction)}.pdf`)}>{form.jurisdiction === "Baltimore County" ? "Plans Review Guide" : "Plan Review Application"}</button>
                    <button type="button" className="btn btn-sm" onClick={() => downloadFile(`/haccp/plans/${savedPlanId}/plan-review-pdf`, `${downloadBaseName} - ${form.jurisdiction === "Baltimore County" ? "Plans Review Guide" : "Plan Review Application"}.pdf`)}>{form.jurisdiction === "Baltimore County" ? "Download Review Guide" : "Download Plan Review App"}</button>
                    <button type="button" className="btn btn-sm" onClick={() => printFile(`/haccp/plans/${savedPlanId}/plan-review-pdf`)}>{form.jurisdiction === "Baltimore County" ? "Print Review Guide" : "Print Plan Review App"}</button>
                  </>
                )}
                {form.clientId && (
                  <button type="button" className="btn btn-sm" onClick={() => saveToDocuments()} disabled={savingToDocuments}>{savingToDocuments ? "Saving…" : "Save to Documents"}</button>
                )}
              </>
            )}
          </div>
        </form>
      )}

      {isAdmin && <HaccpTemplatesPanel businessTypes={options?.businessTypes || []} />}
    </div>
  );
}

interface HaccpTemplateRow { businessTypeKey: string; title: string; body: string; active: boolean; source: string }

/** Admin-only CCP wording editor — mirrors ContractTemplatesPanel on TemplatesPage.tsx exactly, so HACCP content can be corrected without a deploy. */
function HaccpTemplatesPanel({ businessTypes }: { businessTypes: BusinessType[] }) {
  const [templates, setTemplates] = useState<HaccpTemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  function load() {
    api.get<{ templates: HaccpTemplateRow[] }>("/haccp/templates")
      .then((res) => setTemplates(res.templates))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load HACCP templates."));
  }
  useEffect(load, []);

  const labelFor = (key: string) => businessTypes.find((t) => t.key === key)?.label || key;

  return (
    <div className="command-panel" style={{ marginTop: 8 }}>
      <div className="command-panel-header">
        <div>
          <h2 className="command-panel-title">HACCP CCP Templates</h2>
          <div className="command-panel-note">The Critical Control Point wording used per business type. Edit to correct language without a deploy — already-generated plans keep their original text.</div>
        </div>
        {templates && <div className="command-panel-note">{templates.length} template(s)</div>}
      </div>
      {error && <ErrorBanner error={error} style={{ margin: "0 16px 16px" }} />}

      {editing && <HaccpTemplateForm businessTypeKey={editing} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />}

      {!templates && !error && <div className="spinner-wrap">Loading…</div>}
      {templates && (
        <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">Template</th><th scope="col">Business Type Key</th><th scope="col">Active</th><th scope="col">Source</th><th scope="col"></th></tr></thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.businessTypeKey}>
                  <td>{t.title}</td>
                  <td className="muted">{labelFor(t.businessTypeKey)}</td>
                  <td>{t.active ? "Yes" : "No"}</td>
                  <td className="muted">{t.source}</td>
                  <td><button className="btn btn-sm" onClick={() => setEditing(t.businessTypeKey)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HaccpTemplateForm({ businessTypeKey, onSaved, onCancel }: { businessTypeKey: string; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ title: "", body: "", active: true, notes: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ template: HaccpTemplateRow & { notes?: string } }>(`/haccp/templates/${encodeURIComponent(businessTypeKey)}`)
      .then((res) => setForm({ title: res.template.title, body: res.template.body, active: res.template.active, notes: res.template.notes || "" }))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this template."))
      .finally(() => setLoading(false));
  }, [businessTypeKey]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/haccp/templates", { businessTypeKey, ...form });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this template.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="card" style={{ margin: "0 16px 16px" }}><div className="spinner-wrap">Loading…</div></div>;

  return (
    <form onSubmit={handleSubmit} className="card" style={{ margin: "0 16px 16px" }}>
      <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Edit: {businessTypeKey}</h2>
      {error && <ErrorBanner error={error} />}
      <div className="field"><label htmlFor="htpl-title">Title</label><input id="htpl-title" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></div>
      <div className="field">
        <label htmlFor="htpl-body">Body</label>
        <textarea id="htpl-body" rows={20} style={{ fontFamily: "monospace", fontSize: 12.5 }} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
        <div className="field-hint muted" style={{ fontSize: 11, marginTop: 4 }}>
          Placeholders: {"{{businessName}}"}, {"{{jurisdiction}}"}, {"{{offPremisesClause}}"}.
        </div>
      </div>
      <div className="field"><label htmlFor="htpl-notes">Internal Notes</label><textarea id="htpl-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
      <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <input id="htpl-active" type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} style={{ width: "auto" }} />
        <label htmlFor="htpl-active" style={{ textTransform: "none", fontSize: 13 }}>Active</label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
