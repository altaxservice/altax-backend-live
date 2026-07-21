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
interface HaccpPlanDetail extends HaccpPlanRow {
  street_address: string | null; zip_code: string | null; phone: string | null; email: string | null;
  contact_person: string | null; license_number: string | null;
  selected_menu_items: string[]; selected_equipment: string[]; rendered_body: string;
}

const JURISDICTIONS = ["Baltimore City", "Baltimore County"];

const EMPTY_FORM = {
  planId: "" as string, businessName: "", businessTypeKey: "", jurisdiction: "Baltimore City",
  street: "", city: "", zip: "", phone: "", email: "", contactPerson: "", licenseNumber: "", clientId: "",
};

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
  const [selectedMenu, setSelectedMenu] = useState<Set<string>>(new Set());
  const [selectedEquipment, setSelectedEquipment] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null);

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

  function toggleMenu(key: string) {
    setSelectedMenu((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  }
  function toggleEquipment(key: string) {
    setSelectedEquipment((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  }

  function loadPlanIntoForm(plan: HaccpPlanDetail) {
    setForm({
      planId: plan.plan_id, businessName: plan.business_name, businessTypeKey: plan.business_type_key,
      jurisdiction: plan.jurisdiction, street: plan.street_address || "", city: plan.city || "", zip: plan.zip_code || "",
      phone: plan.phone || "", email: plan.email || "", contactPerson: plan.contact_person || "",
      licenseNumber: plan.license_number || "", clientId: plan.client_id || "",
    });
    setSelectedMenu(new Set(plan.selected_menu_items || []));
    setSelectedEquipment(new Set(plan.selected_equipment || []));
    setSavedPlanId(plan.plan_id);
    setTab("generate");
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
      selectedMenuItems: Array.from(selectedMenu), selectedEquipment: Array.from(selectedEquipment),
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
    setSelectedMenu(new Set());
    setSelectedEquipment(new Set());
    setSavedPlanId(null);
    setError(null);
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
                      <td style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-sm" onClick={() => reopenForRenewal(p.plan_id)}>Open / Renew</button>
                        <button className="btn btn-sm" onClick={() => viewFile(`/haccp/plans/${p.plan_id}/pdf`)}>View PDF</button>
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

          <div className="form-section-title">Menu Items</div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Check every item this business sells or serves — only checked items appear on the printed plan.</p>
          {menuCategoriesToShow.map((cat) => (
            <div key={cat.category} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{cat.category}</div>
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

          <div className="form-section-title">Equipment</div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Check every piece of equipment on site.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginBottom: 16 }}>
            {options?.equipmentItems.map((item) => (
              <label key={item.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={selectedEquipment.has(item.key)} onChange={() => toggleEquipment(item.key)} />
                {item.label}
              </label>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : form.planId ? "Save & Regenerate" : "Generate Plan"}</button>
            {savedPlanId && (
              <>
                <button type="button" className="btn" onClick={() => viewFile(`/haccp/plans/${savedPlanId}/pdf`)}>View PDF</button>
                <button type="button" className="btn" onClick={() => downloadFile(`/haccp/plans/${savedPlanId}/pdf`, `HACCP_${savedPlanId}.pdf`)}>Download PDF</button>
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
