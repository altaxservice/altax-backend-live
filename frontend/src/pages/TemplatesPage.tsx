import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface TemplateRow {
  templateId: string | null;
  name: string;
  category: string;
  subject: string;
  active: boolean;
  source: string;
}
interface TemplateDetail {
  template_name?: string;
  category: string;
  subject: string;
  message_english: string | null;
  message_arabic: string | null;
  active: boolean;
  notes?: string | null;
}

export function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [search, setSearch] = useState("");

  function load() {
    api.get<{ templates: TemplateRow[] }>("/templates")
      .then((res) => setTemplates(res.templates))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load templates."));
  }
  useEffect(load, []);

  const q = search.trim().toLowerCase();
  const filteredTemplates = (templates || []).filter((t) =>
    !q || [t.name, t.subject, t.category].some((v) => String(v || "").toLowerCase().includes(q))
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
        <input placeholder="Search templates…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", width: 240 }} />
        <button className="btn btn-primary" onClick={() => setShowNewForm((v) => !v)}>{showNewForm ? "Cancel" : "Add Template"}</button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {showNewForm && <TemplateForm onSaved={() => { setShowNewForm(false); load(); }} onCancel={() => setShowNewForm(false)} />}
      {editing && <TemplateForm templateName={editing} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />}

      <div className="command-panel">
        <div className="command-panel-header">
          <div>
            <h2 className="command-panel-title">Message Templates</h2>
            <div className="command-panel-note">All reusable communication templates used by the app.</div>
          </div>
          {templates && <div className="command-panel-note">{templates.length} template(s)</div>}
        </div>
        <p className="muted" style={{ padding: "0 16px 16px" }}>
          Edit a built-in template to override it. The Communications Center will use the saved subject, English text, and Arabic text.
        </p>
        {!templates && !error && <div className="spinner-wrap">Loading…</div>}
        {templates && (
          <div className="table-scroll">
          <table>
            <thead><tr><th>Template</th><th>Category</th><th>Subject</th><th>Active</th><th>Source</th><th></th></tr></thead>
            <tbody>
              {filteredTemplates.map((t) => (
                <tr key={t.name}>
                  <td>{t.name}</td>
                  <td className="muted">{t.category}</td>
                  <td className="muted">{t.subject}</td>
                  <td>{t.active ? "Yes" : "No"}</td>
                  <td className="muted">{t.source}</td>
                  <td><button className="btn btn-sm" onClick={() => setEditing(t.name)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        <ContractTemplatesPanel />
      </div>
    </div>
  );
}

interface ContractTemplateRow { serviceKey: string; title: string; body: string; active: boolean; source: string }

/**
 * Admin-only editor for the contract/engagement-letter wording used by the
 * Contracts section on a client's profile — same built-in-default + override
 * pattern as Message Templates above (see contracts.routes.ts resolveContractTemplate),
 * so the firm can tighten legal language after an attorney review without a
 * code deploy. Deliberately admin-only (requireRole("admin") server-side too) —
 * this wording is what protects the firm, unlike message templates which staff
 * can also touch.
 */
function ContractTemplatesPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [templates, setTemplates] = useState<ContractTemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  function load() {
    api.get<{ templates: ContractTemplateRow[] }>("/contracts/templates")
      .then((res) => setTemplates(res.templates))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load contract templates."));
  }
  useEffect(load, []);

  return (
    <div className="command-panel">
      <div className="command-panel-header">
        <div>
          <h2 className="command-panel-title">Contract Templates</h2>
          <div className="command-panel-note">Engagement-letter wording used when generating a contract from a client's Services Provided.</div>
        </div>
        {templates && <div className="command-panel-note">{templates.length} template(s)</div>}
      </div>
      <p className="muted" style={{ padding: "0 16px 16px" }}>
        {isAdmin
          ? "Edit a template to override its wording. Contracts already generated keep their original text even after an override is saved — only new contracts use the updated wording."
          : "Only Admin can edit contract wording. Contact an administrator to change this text."}
      </p>
      {error && <div className="error-banner" style={{ margin: "0 16px 16px" }}>{error}</div>}

      {editing && <ContractTemplateForm serviceKey={editing} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />}

      {!templates && !error && <div className="spinner-wrap">Loading…</div>}
      {templates && (
        <div className="table-scroll">
        <table>
          <thead><tr><th>Template</th><th>Service Key</th><th>Active</th><th>Source</th><th></th></tr></thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.serviceKey}>
                <td>{t.title}</td>
                <td className="muted">{t.serviceKey}</td>
                <td>{t.active ? "Yes" : "No"}</td>
                <td className="muted">{t.source}</td>
                <td>{isAdmin && <button className="btn btn-sm" onClick={() => setEditing(t.serviceKey)}>Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

function ContractTemplateForm({ serviceKey, onSaved, onCancel }: { serviceKey: string; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ title: "", body: "", active: true, notes: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ template: ContractTemplateRow & { notes?: string } }>(`/contracts/templates/${encodeURIComponent(serviceKey)}`)
      .then((res) => setForm({ title: res.template.title, body: res.template.body, active: res.template.active, notes: res.template.notes || "" }))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this template."))
      .finally(() => setLoading(false));
  }, [serviceKey]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/contracts/templates", { serviceKey, ...form });
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
      <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Edit: {serviceKey}</h2>
      {error && <div className="error-banner">{error}</div>}
      <div className="field"><label>Title</label><input required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></div>
      <div className="field">
        <label>Body</label>
        <textarea rows={16} style={{ fontFamily: "monospace", fontSize: 12.5 }} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
        <div className="field-hint muted" style={{ fontSize: 11, marginTop: 4 }}>
          Placeholders: {"{{clientName}}"}, {"{{firmName}}"}, {"{{effectiveDate}}"}, {"{{feeAmount}}"} (already includes the fee description, e.g. "$400.00 (per month)").
        </div>
      </div>
      <div className="field"><label>Internal Notes</label><textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Not shown to clients" /></div>
      <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <input id="ctpl-active" type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} style={{ width: "auto" }} />
        <label htmlFor="ctpl-active" style={{ textTransform: "none", fontSize: 13 }}>Active</label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function TemplateForm({ templateName, onSaved, onCancel }: { templateName?: string; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({ templateName: templateName || "", category: "Communications", subject: "", messageEnglish: "", messageArabic: "", active: true, notes: "" });
  const [loading, setLoading] = useState(!!templateName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!templateName) return;
    api.get<{ template: TemplateDetail }>(`/templates/${encodeURIComponent(templateName)}`)
      .then((res) => {
        setForm({
          templateName: templateName, category: res.template.category || "Communications", subject: res.template.subject || "",
          messageEnglish: res.template.message_english || "", messageArabic: res.template.message_arabic || "",
          active: res.template.active, notes: res.template.notes || "",
        });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this template."))
      .finally(() => setLoading(false));
  }, [templateName]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/templates", form);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this template.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="card" style={{ marginBottom: 20 }}><div className="spinner-wrap">Loading…</div></div>;

  return (
    <form onSubmit={handleSubmit} className="card" style={{ maxWidth: 560, marginBottom: 20 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>{templateName ? `Edit: ${templateName}` : "New Template"}</h2>
      {error && <div className="error-banner">{error}</div>}
      <div className="field">
        <label>Template Name</label>
        <input required disabled={!!templateName} value={form.templateName} onChange={(e) => setForm((f) => ({ ...f, templateName: e.target.value }))} />
      </div>
      <div className="field"><label>Category</label><input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} /></div>
      <div className="field"><label>Subject</label><input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} /></div>
      <div className="field"><label>English Message</label><textarea rows={3} value={form.messageEnglish} onChange={(e) => setForm((f) => ({ ...f, messageEnglish: e.target.value }))} /></div>
      <div className="field"><label>Arabic Message</label><textarea rows={3} dir="rtl" value={form.messageArabic} onChange={(e) => setForm((f) => ({ ...f, messageArabic: e.target.value }))} /></div>
      <div className="field"><label>Notes</label><textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Internal notes about this template (not shown to clients)" /></div>
      <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <input id="tpl-active" type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} style={{ width: "auto" }} />
        <label htmlFor="tpl-active" style={{ textTransform: "none", fontSize: 13 }}>Active</label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
