import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { Bell, CalendarClock, ChevronDown, FileBarChart, HelpCircle, Mail, MessagesSquare, type LucideIcon } from "lucide-react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ErrorBanner } from "../components/ErrorBanner";

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

const CATEGORY_ORDER = ["Requests & Questions", "Reminders & Notices", "Appointments", "Reports", "General"];
function iconFor(category: string): LucideIcon {
  if (category === "Appointments") return CalendarClock;
  if (category === "Requests & Questions") return HelpCircle;
  if (category === "Reports") return FileBarChart;
  if (category === "Reminders & Notices") return Bell;
  if (category === "General") return MessagesSquare;
  return Mail;
}
/** Shows {{mergeTags}} in a subject as small chips so they read as placeholders, not literal text. */
function withTagChips(text: string) {
  return String(text || "").split(/(\{\{[^}]+\}\})/g).map((part, i) =>
    /^\{\{[^}]+\}\}$/.test(part) ? <code className="tpl-tag" key={i}>{part.slice(2, -2)}</code> : <span key={i}>{part}</span>
  );
}

/** A dialog over the page for the template editor: Escape or a click outside closes it, and the page behind keeps its scroll position. */
function EditorOverlay({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEscapeToClose(onClose);
  useFocusTrap(panelRef);
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-label={title} style={{ width: "min(760px, 94vw)", maxHeight: "92vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>{title}</h2><button type="button" className="btn btn-sm" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
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

  const [activeCategory, setActiveCategory] = useState("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const by = new Map<string, TemplateRow[]>();
    for (const t of filteredTemplates) { const c = t.category || "General"; if (!by.has(c)) by.set(c, []); by.get(c)!.push(t); }
    const rank = (c: string) => { const i = CATEGORY_ORDER.indexOf(c); return i === -1 ? 99 : i; };
    return Array.from(by, ([category, items]) => ({ category, items })).sort((a, b) => rank(a.category) - rank(b.category) || a.category.localeCompare(b.category));
  }, [filteredTemplates]);
  const visibleGroups = activeCategory === "all" ? groups : groups.filter((g) => g.category === activeCategory);
  function toggleGroup(c: string) { setCollapsed((prev) => { const n = new Set(prev); if (n.has(c)) n.delete(c); else n.add(c); return n; }); }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
        <input placeholder="Search templates…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", width: 240 }} />
        <button className="btn btn-primary" onClick={() => setShowNewForm((v) => !v)}>{showNewForm ? "Cancel" : "Add Template"}</button>
      </div>

      {error && <ErrorBanner error={error} />}

      {/* The editor opens over the page, not at the top of it — clicking Edit on a card far down the list used to put the form
          out of sight above the fold. */}
      {showNewForm && (
        <EditorOverlay title="New Template" onClose={() => setShowNewForm(false)}>
          <TemplateForm onSaved={() => { setShowNewForm(false); load(); }} onCancel={() => setShowNewForm(false)} />
        </EditorOverlay>
      )}
      {editing && (
        <EditorOverlay title={`Edit: ${editing}`} onClose={() => setEditing(null)}>
          <TemplateForm templateName={editing} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
        </EditorOverlay>
      )}

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
          <div style={{ padding: "0 16px 16px" }}>
            <div className="tpl-chips" role="tablist" aria-label="Filter by category">
              <button type="button" className={`tpl-chip${activeCategory === "all" ? " on" : ""}`} onClick={() => setActiveCategory("all")}>All <span>{filteredTemplates.length}</span></button>
              {groups.map((g) => (
                <button type="button" key={g.category} className={`tpl-chip${activeCategory === g.category ? " on" : ""}`} onClick={() => setActiveCategory(g.category)}>{g.category} <span>{g.items.length}</span></button>
              ))}
              <button type="button" className="link-button" style={{ marginLeft: "auto", fontSize: 12.5 }} onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(groups.map((g) => g.category)))}>{collapsed.size ? "Expand all" : "Collapse all"}</button>
            </div>
            {visibleGroups.length === 0 && <p className="muted" style={{ textAlign: "center", padding: 24 }}>No templates match.</p>}
            {visibleGroups.map((g) => {
              const Icon = iconFor(g.category);
              const isOpen = !collapsed.has(g.category);
              const customized = g.items.filter((t) => t.source !== "Built-in default").length;
              return (
                <section className="tpl-group" key={g.category}>
                  <button type="button" className="tpl-group-head" aria-expanded={isOpen} onClick={() => toggleGroup(g.category)}>
                    <span className="tpl-group-icon"><Icon size={17} aria-hidden="true" /></span>
                    <span className="tpl-group-title">{g.category}</span>
                    <span className="tpl-count">{g.items.length}</span>
                    {customized > 0 ? <span className="tpl-badge custom">{customized} customized</span> : null}
                    <ChevronDown size={16} aria-hidden="true" className="tpl-chev" />
                  </button>
                  {isOpen && (
                    <div className="tpl-grid">
                      {g.items.map((t) => (
                        <article className="tpl-card" key={t.name}>
                          <div className="tpl-card-top">
                            <h3 className="tpl-name">{t.name}</h3>
                            <button className="btn btn-sm" onClick={() => setEditing(t.name)}>Edit</button>
                          </div>
                          <p className="tpl-subject">{withTagChips(t.subject)}</p>
                          <div className="tpl-card-foot">
                            <span className={`tpl-badge ${t.source === "Built-in default" ? "builtin" : "custom"}`}>{t.source === "Built-in default" ? "Built-in" : t.source}</span>
                            {!t.active && <span className="tpl-badge off">Inactive</span>}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
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
      {error && <ErrorBanner error={error} style={{ margin: "0 16px 16px" }} />}

      {editing && (
        <EditorOverlay title={`Edit: ${editing}`} onClose={() => setEditing(null)}>
          <ContractTemplateForm serviceKey={editing} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
        </EditorOverlay>
      )}

      {!templates && !error && <div className="spinner-wrap">Loading…</div>}
      {templates && (
        <div className="table-scroll">
        <table>
          <thead><tr><th scope="col">Template</th><th scope="col">Service Key</th><th scope="col">Active</th><th scope="col">Source</th><th scope="col"></th></tr></thead>
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

  if (loading) return <div className="spinner-wrap">Loading…</div>;

  return (
    <form onSubmit={handleSubmit} style={{ padding: "4px 20px 20px" }}>
      {error && <ErrorBanner error={error} />}
      <div className="field"><label htmlFor="ctpl-title">Title</label><input id="ctpl-title" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></div>
      <div className="field">
        <label htmlFor="ctpl-body">Body</label>
        <textarea id="ctpl-body" rows={16} style={{ fontFamily: "monospace", fontSize: 12.5 }} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
        <div className="field-hint muted" style={{ fontSize: 11, marginTop: 4 }}>
          Placeholders: {"{{clientName}}"}, {"{{firmName}}"}, {"{{effectiveDate}}"}, {"{{feeAmount}}"} (already includes the fee description, e.g. "$400.00 (per month)").
        </div>
      </div>
      <div className="field"><label htmlFor="ctpl-notes">Internal Notes</label><textarea id="ctpl-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Not shown to clients" /></div>
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

  if (loading) return <div className="spinner-wrap">Loading…</div>;

  return (
    <form onSubmit={handleSubmit} style={{ padding: "4px 20px 20px" }}>
      {error && <ErrorBanner error={error} />}
      <div className="field">
        <label htmlFor="tpl-name">Template Name</label>
        <input id="tpl-name" required disabled={!!templateName} value={form.templateName} onChange={(e) => setForm((f) => ({ ...f, templateName: e.target.value }))} />
      </div>
      <div className="field"><label htmlFor="tpl-category">Category</label><input id="tpl-category" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} /></div>
      <div className="field"><label htmlFor="tpl-subject">Subject</label><input id="tpl-subject" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} /></div>
      <div className="field"><label htmlFor="tpl-message-english">English Message</label><textarea id="tpl-message-english" rows={3} value={form.messageEnglish} onChange={(e) => setForm((f) => ({ ...f, messageEnglish: e.target.value }))} /></div>
      <div className="field"><label htmlFor="tpl-message-arabic">Arabic Message</label><textarea id="tpl-message-arabic" rows={3} dir="rtl" value={form.messageArabic} onChange={(e) => setForm((f) => ({ ...f, messageArabic: e.target.value }))} /></div>
      <div className="field"><label htmlFor="tpl-notes">Notes</label><textarea id="tpl-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Internal notes about this template (not shown to clients)" /></div>
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
