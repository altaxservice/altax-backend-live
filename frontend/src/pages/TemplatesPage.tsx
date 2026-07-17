import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";

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
        )}
      </div>
    </div>
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
