import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError, viewFile, downloadFile } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { AddressFields } from "../components/AddressFields";
import type { Client } from "../api/types";

interface BusinessType { key: string; label: string; riskPriority: "High" | "Moderate"; hasCookStep: boolean; hasHotHolding: boolean; description: string }
interface ChecklistItem { key: string; label: string }
interface ChecklistCategory { category: string; items: ChecklistItem[] }
interface HaccpOptions { businessTypes: BusinessType[]; menuCategories: ChecklistCategory[]; equipmentItems: ChecklistItem[] }
interface HaccpPlanRow {
  plan_id: string; client_id: string | null; business_name: string; business_type_key: string;
  jurisdiction: string; city: string | null; state: string | null; created_by: string | null;
  created_at: string; updated_at: string;
}
interface EquipmentSelection { key: string; label: string; quantity: number }
interface CertifiedFoodManager { name: string; idNumber: string; expirationDate: string }
interface CountyPermitData {
  facilityId?: string; cateringServiceProvided?: boolean; cateringId?: string; facilityClassification?: string;
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
  useAndOccupancyNumber?: string; permitsApplied?: string[]; facilityTypeOverride?: string;
  county?: CountyPermitData;
}
interface HaccpPlanDetail extends HaccpPlanRow {
  street_address: string | null; zip_code: string | null; phone: string | null; email: string | null;
  contact_person: string | null; license_number: string | null;
  selected_menu_items: string[]; selected_equipment: EquipmentSelection[]; rendered_body: string;
  license_application_data: LicenseApplicationData | null;
}

const JURISDICTIONS = ["Baltimore City", "Baltimore County"];

const EMPTY_FORM = {
  planId: "" as string, businessName: "", businessTypeKey: "", jurisdiction: "Baltimore City",
  street: "", city: "", zip: "", phone: "", email: "", contactPerson: "", licenseNumber: "", clientId: "",
};

const EMPTY_LICENSE_FORM: LicenseApplicationData = {
  officerTitle: "Owner", tradeName: "",
  ownerHomeStreet: "", ownerHomeCity: "", ownerHomeZip: "", ownerHomePhone: "",
  mailingAddress: "",
  wasteHaulerOption: "under3", smallHaulerLicenseNumber: "",
  sellsTobacco: false, tobaccoLicenseNumber: "",
  ownerEntityType: "LLC",
  useAndOccupancyNumber: "", permitsApplied: ["retailFood"], facilityTypeOverride: "",
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

  const [options, setOptions] = useState<HaccpOptions | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [tab, setTab] = useState<"generate" | "saved">("generate");

  const [form, setForm] = useState(EMPTY_FORM);
  const [licenseForm, setLicenseForm] = useState<LicenseApplicationData>(EMPTY_LICENSE_FORM);
  const [selectedMenu, setSelectedMenu] = useState<Set<string>>(new Set());
  const [selectedEquipment, setSelectedEquipment] = useState<EquipmentSelection[]>([]);
  const [customMenuInput, setCustomMenuInput] = useState("");
  const [customEquipmentInput, setCustomEquipmentInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null);
  const [savingToDocuments, setSavingToDocuments] = useState(false);

  const [plans, setPlans] = useState<HaccpPlanRow[] | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get<HaccpOptions>("/haccp/options").then(setOptions).catch(() => {});
    api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => {});
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
      licenseNumber: plan.license_number || "", clientId: plan.client_id || "",
    });
    setSelectedMenu(new Set(plan.selected_menu_items || []));
    setSelectedEquipment(plan.selected_equipment || []);
    setLicenseForm({ ...EMPTY_LICENSE_FORM, ...(plan.license_application_data || {}), county: { ...EMPTY_LICENSE_FORM.county, ...(plan.license_application_data?.county || {}) } });
    setSavedPlanId(plan.plan_id);
    setTab("generate");
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.businessName.trim() || !form.businessTypeKey) { setError("Business name and business type are required."); return; }
    setSaving(true);
    setError(null);
    const payload = {
      businessName: form.businessName.trim(), businessTypeKey: form.businessTypeKey, jurisdiction: form.jurisdiction,
      streetAddress: form.street, city: form.city, state: "MD", zipCode: form.zip,
      phone: form.phone, email: form.email, contactPerson: form.contactPerson, licenseNumber: form.licenseNumber,
      clientId: form.clientId || null,
      selectedMenuItems: Array.from(selectedMenu), selectedEquipment,
      licenseApplicationData: licenseForm,
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

  const menuCategoriesToShow = useMemo(() => options?.menuCategories || [], [options]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>HACCP Plan Generator</h1>
      </div>
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
                <thead><tr><th>Business</th><th>Type</th><th>Jurisdiction</th><th>Linked Client</th><th>Updated</th><th></th></tr></thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.plan_id}>
                      <td>{p.business_name}</td>
                      <td className="muted">{options?.businessTypes.find((t) => t.key === p.business_type_key)?.label || p.business_type_key}</td>
                      <td className="muted">{p.jurisdiction}</td>
                      <td className="muted">{p.client_id || "—"}</td>
                      <td className="muted">{new Date(p.updated_at).toLocaleDateString()}</td>
                      <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="btn btn-sm" onClick={() => reopenForRenewal(p.plan_id)}>Open / Renew</button>
                        <button className="btn btn-sm" onClick={() => viewFile(`/haccp/plans/${p.plan_id}/pdf`)}>HACCP</button>
                        <button className="btn btn-sm" onClick={() => viewFile(`/haccp/plans/${p.plan_id}/license-pdf`)}>{p.jurisdiction === "Baltimore County" ? "Permit App" : "License App"}</button>
                        <button className="btn btn-sm" onClick={() => viewFile(`/haccp/plans/${p.plan_id}/plan-review-pdf`)}>{p.jurisdiction === "Baltimore County" ? "Review Guide" : "Plan Review App"}</button>
                        {p.client_id && (
                          <button className="btn btn-sm" onClick={() => saveToDocuments(p.plan_id)} disabled={savingToDocuments}>Save to Documents</button>
                        )}
                      </td>
                    </tr>
                  ))}
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
          {error && <div className="error-banner">{error}</div>}

          <div className="form-section-title">Business Information</div>
          <div className="form-grid-3">
            <div className="field"><label htmlFor="hp-name">Business Name</label><input id="hp-name" required value={form.businessName} onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))} /></div>
            <div className="field">
              <label htmlFor="hp-type">Business Type</label>
              <select id="hp-type" required value={form.businessTypeKey} onChange={(e) => setForm((f) => ({ ...f, businessTypeKey: e.target.value }))}>
                <option value="">Select…</option>
                {options?.businessTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="hp-juris">Jurisdiction</label>
              <select id="hp-juris" value={form.jurisdiction} onChange={(e) => setForm((f) => ({ ...f, jurisdiction: e.target.value }))}>
                {JURISDICTIONS.map((j) => <option key={j}>{j}</option>)}
              </select>
            </div>
          </div>
          {businessType && <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 12 }}>{businessType.description} Risk Priority: {businessType.riskPriority}.</p>}

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
              <select id="hp-client" value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}>
                <option value="">Not a client yet / no link</option>
                {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name} ({c.client_id})</option>)}
              </select>
            </div>
          </div>

          <div className="form-section-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Menu Items
            <button type="button" className="btn btn-sm" onClick={selectAllMenu} style={{ textTransform: "none", fontWeight: 400 }}>Select All</button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Check every item this business sells or serves — only checked items appear on the printed plan. Not on the list? Type it below and add it.</p>
          {menuCategoriesToShow.map((cat) => (
            <div key={cat.category} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{cat.category}</span>
                <button type="button" onClick={() => selectAllMenuCategory(cat)} style={{ background: "none", border: "none", color: "var(--accent, #0f766e)", cursor: "pointer", padding: 0, fontSize: 11, textDecoration: "underline" }}>Select All {cat.category}</button>
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
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input value={customMenuInput} onChange={(e) => setCustomMenuInput(e.target.value)} placeholder="e.g. Rotisserie Chicken" style={{ maxWidth: 240, padding: "6px 10px" }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomMenuItem(); } }} />
            <button type="button" className="btn btn-sm" onClick={addCustomMenuItem}>Add Item</button>
          </div>

          <div className="form-section-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Equipment
            <button type="button" className="btn btn-sm" onClick={selectAllEquipment} style={{ textTransform: "none", fontWeight: 400 }}>Select All</button>
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
                    <button type="button" onClick={() => removeEquipmentItem(item.key)} style={{ background: "none", border: "none", color: "var(--muted-fg, #6b7280)", cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1 }} aria-label={`Remove ${item.label}`}>×</button>
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

          <div className="form-section-title">License &amp; Permit Applications</div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            {form.jurisdiction === "Baltimore County"
              ? "Fills the Baltimore County Food Service Facility Permit Application — together with the HACCP plan above and the Plans Review Submission Guide, this is the whole package. Baltimore County has no separate fillable \"Plan Review Application\"; its real process is to submit this permit application plus the plans/HACCP plan/equipment cut sheets to the office named in the guide."
              : "Fills the Baltimore City Food Facility License Application and Plan Review Application — together with the HACCP plan above, these three documents are the whole submission package."}
          </p>
          <div className="form-grid-3">
            <div className="field"><label htmlFor="hp-officer-title">Officer/Owner Title</label><input id="hp-officer-title" value={licenseForm.officerTitle} onChange={(e) => setLicenseForm((f) => ({ ...f, officerTitle: e.target.value }))} placeholder="e.g. Owner" /></div>
            <div className="field"><label htmlFor="hp-trade-name">Trade Name (DBA)</label><input id="hp-trade-name" value={licenseForm.tradeName} onChange={(e) => setLicenseForm((f) => ({ ...f, tradeName: e.target.value }))} placeholder="Optional" /></div>
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

          {form.jurisdiction === "Baltimore City" && (
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
                <div className="field"><label htmlFor="hp-uo-number" style={{ textTransform: "none", fontSize: 12 }}>Use and Occupancy — Use Number</label><input id="hp-uo-number" value={licenseForm.useAndOccupancyNumber} onChange={(e) => setLicenseForm((f) => ({ ...f, useAndOccupancyNumber: e.target.value }))} placeholder="Optional" style={{ maxWidth: 260 }} /></div>
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

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : form.planId ? "Save & Regenerate" : "Generate Plan"}</button>
            {savedPlanId && (
              <>
                <span className="muted" style={{ fontSize: 12 }}>The whole package:</span>
                <button type="button" className="btn" onClick={() => viewFile(`/haccp/plans/${savedPlanId}/pdf`)}>HACCP Plan</button>
                <button type="button" className="btn" onClick={() => viewFile(`/haccp/plans/${savedPlanId}/license-pdf`)}>{form.jurisdiction === "Baltimore County" ? "Food Service Permit Application" : "Food License Application"}</button>
                <button type="button" className="btn" onClick={() => viewFile(`/haccp/plans/${savedPlanId}/plan-review-pdf`)}>{form.jurisdiction === "Baltimore County" ? "Plans Review Guide" : "Plan Review Application"}</button>
                <button type="button" className="btn btn-sm" onClick={() => downloadFile(`/haccp/plans/${savedPlanId}/pdf`, `${downloadBaseName} - HACCP Plan.pdf`)}>Download HACCP</button>
                <button type="button" className="btn btn-sm" onClick={() => downloadFile(`/haccp/plans/${savedPlanId}/license-pdf`, `${downloadBaseName} - ${form.jurisdiction === "Baltimore County" ? "Food Service Permit Application" : "Food License Application"}.pdf`)}>{form.jurisdiction === "Baltimore County" ? "Download Permit App" : "Download License App"}</button>
                <button type="button" className="btn btn-sm" onClick={() => downloadFile(`/haccp/plans/${savedPlanId}/plan-review-pdf`, `${downloadBaseName} - ${form.jurisdiction === "Baltimore County" ? "Plans Review Guide" : "Plan Review Application"}.pdf`)}>{form.jurisdiction === "Baltimore County" ? "Download Review Guide" : "Download Plan Review App"}</button>
                {form.clientId && (
                  <button type="button" className="btn btn-sm" onClick={saveToDocuments} disabled={savingToDocuments}>{savingToDocuments ? "Saving…" : "Save to Documents"}</button>
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
      {error && <div className="error-banner" style={{ margin: "0 16px 16px" }}>{error}</div>}

      {editing && <HaccpTemplateForm businessTypeKey={editing} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />}

      {!templates && !error && <div className="spinner-wrap">Loading…</div>}
      {templates && (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Template</th><th>Business Type Key</th><th>Active</th><th>Source</th><th></th></tr></thead>
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
      {error && <div className="error-banner">{error}</div>}
      <div className="field"><label>Title</label><input required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></div>
      <div className="field">
        <label>Body</label>
        <textarea rows={20} style={{ fontFamily: "monospace", fontSize: 12.5 }} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
        <div className="field-hint muted" style={{ fontSize: 11, marginTop: 4 }}>
          Placeholders: {"{{businessName}}"}, {"{{jurisdiction}}"}, {"{{offPremisesClause}}"}.
        </div>
      </div>
      <div className="field"><label>Internal Notes</label><textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
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
