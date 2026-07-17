import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { TaskRule, TaskBatch, WebOptions } from "../api/types2";
import { useToast } from "../components/Toast";
import { CreateBatchTasksModal } from "../components/CreateBatchTasksModal";

const TRIGGER_COLUMNS = [
  "SalesTaxFrequency", "PayrollFrequency", "PayrollEnabled", "EFTPSEnabled", "MDWithholdingFrequency",
  "MDUIEnabled", "MDAnnualReportEnabled", "BusinessReturnType", "ClientType", "ServiceType", "Status",
];
const FREQUENCIES = ["One-Time", "Weekly", "Monthly", "Quarterly", "Semiannual", "Annual"];

const EMPTY_RULE_FORM = {
  ruleId: "", taskType: "", triggerColumn: "", triggerValue: "", frequency: "Monthly",
  paymentRequired: false, requiresFiling: true, dueDay: "", warningDays: "14,7,3",
  portalName: "", portalUrl: "", active: true, notes: "",
};

export function RulesPage() {
  const toast = useToast();
  const [rules, setRules] = useState<TaskRule[] | null>(null);
  const [batches, setBatches] = useState<TaskBatch[] | null>(null);
  const [options, setOptions] = useState<WebOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_RULE_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [batchRuleId, setBatchRuleId] = useState<string | null>(null);
  const [showBatchModal, setShowBatchModal] = useState(false);

  function load() {
    Promise.all([
      api.get<{ rules: TaskRule[] }>("/rules"),
      api.get<{ batches: TaskBatch[] }>("/rules/batches"),
    ]).then(([r, b]) => { setRules(r.rules); setBatches(b.batches); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load rules."));
  }
  useEffect(load, []);
  useEffect(() => { api.get<WebOptions>("/system/options").then(setOptions).catch(() => {}); }, []);

  function startCreate() {
    setForm(EMPTY_RULE_FORM);
    setSaveError(null);
    setShowForm(true);
  }

  function startEdit(r: TaskRule) {
    setForm({
      ruleId: r.rule_id, taskType: r.task_type || "", triggerColumn: String(r.trigger_column || ""),
      triggerValue: String(r.trigger_value || ""), frequency: String(r.frequency || "Monthly"),
      paymentRequired: Boolean(r.payment_required), requiresFiling: r.requires_filing !== false,
      dueDay: String(r.due_day || ""), warningDays: String(r.warning_days || "14,7,3"),
      portalName: String(r.portal_name || ""), portalUrl: String(r.portal_url || ""),
      active: r.active !== false, notes: String(r.notes || ""),
    });
    setSaveError(null);
    setShowForm(true);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await api.post("/rules", form);
      setShowForm(false);
      toast(form.ruleId ? "Rule updated." : "Rule created.");
      load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save this rule.");
    } finally {
      setSaving(false);
    }
  }

  function openBatchModal(ruleId?: string) {
    setBatchRuleId(ruleId || null);
    setShowBatchModal(true);
  }

  const filteredRules = useMemo(() => {
    if (!rules) return [];
    const q = search.trim().toLowerCase();
    return rules.filter((r) => {
      if (activeFilter === "yes" && !r.active) return false;
      if (activeFilter === "no" && r.active) return false;
      if (q && ![r.task_type, r.rule_id, r.trigger_column, r.trigger_value].some((v) => String(v || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rules, search, activeFilter]);

  return (
    <div>
      <div className="portal-banner" style={{ marginBottom: 20 }}>
        <div className="topbar-eyebrow">Automation Rules</div>
        <h2>Task Rules</h2>
        <p>Use rules to create batch work for clients with the same service, frequency, and filing/payment requirements.</p>
      </div>
      {error && <div className="error-banner">{error}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 10 }}>
          <input placeholder="Search rules…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", width: 200 }} />
          <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}>
            <option value="all">All</option><option value="yes">Active</option><option value="no">Inactive</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => openBatchModal()}>Create Batch Tasks</button>
          <button className="btn btn-primary" onClick={startCreate}>Add Rule</button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="card" style={{ maxWidth: 560, marginBottom: 24 }}>
          {saveError && <div className="error-banner">{saveError}</div>}
          <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>{form.ruleId ? `Edit ${form.ruleId}` : "New Rule"}</h2>
          <div className="form-grid">
            <div className="field">
              <label>Task Type</label>
              <select required value={form.taskType} onChange={(e) => setForm((f) => ({ ...f, taskType: e.target.value }))}>
                <option value="">Choose…</option>
                {form.taskType && !(options?.taskTypes || []).includes(form.taskType) && <option value={form.taskType}>{form.taskType}</option>}
                {(options?.taskTypes || []).map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Frequency</label>
              <select value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}>
                {FREQUENCIES.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Trigger Column</label>
              <select value={form.triggerColumn} onChange={(e) => setForm((f) => ({ ...f, triggerColumn: e.target.value }))}>
                <option value="">Manual selection (no auto-trigger)</option>
                {TRIGGER_COLUMNS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="field"><label>Trigger Value</label><input value={form.triggerValue} onChange={(e) => setForm((f) => ({ ...f, triggerValue: e.target.value }))} placeholder="e.g. Monthly" disabled={!form.triggerColumn} /></div>
            <div className="field"><label>Due Day</label><input value={form.dueDay} onChange={(e) => setForm((f) => ({ ...f, dueDay: e.target.value }))} placeholder="1–31" /></div>
            <div className="field"><label>Warning Days</label><input value={form.warningDays} onChange={(e) => setForm((f) => ({ ...f, warningDays: e.target.value }))} placeholder="14,7,3" /></div>
            <div className="field"><label>Portal Name</label><input value={form.portalName} onChange={(e) => setForm((f) => ({ ...f, portalName: e.target.value }))} /></div>
            <div className="field"><label>Portal URL</label><input value={form.portalUrl} onChange={(e) => setForm((f) => ({ ...f, portalUrl: e.target.value }))} /></div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 22 }}>
              <input type="checkbox" checked={form.paymentRequired} onChange={(e) => setForm((f) => ({ ...f, paymentRequired: e.target.checked }))} />
              Payment required
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 22 }}>
              <input type="checkbox" checked={form.requiresFiling} onChange={(e) => setForm((f) => ({ ...f, requiresFiling: e.target.checked }))} />
              Requires filing
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 22 }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
              Active
            </label>
          </div>
          <div className="field"><label>Notes</label><textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : form.ruleId ? "Save Rule" : "Create Rule"}</button>
            <button type="button" className="btn" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {rules && (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px 8px" }}>
            <h2 style={{ fontSize: 15, margin: 0 }}>Task Rules</h2>
            <span className="muted" style={{ fontSize: 12 }}>{filteredRules.length} rules</span>
          </div>
          <table>
            <thead><tr><th>Rule</th><th>Task Type</th><th>Trigger</th><th>Frequency</th><th>Portal</th><th>Warnings</th><th>Active</th><th>Actions</th></tr></thead>
            <tbody>
              {filteredRules.map((r) => (
                <tr key={r.rule_id}>
                  <td className="muted">{r.rule_id}</td>
                  <td>{r.task_type}</td>
                  <td className="muted">{r.trigger_column ? `${r.trigger_column} = ${r.trigger_value}` : "Manual selection"}</td>
                  <td className="muted">{r.frequency}</td>
                  <td className="muted">{String(r.portal_name || "—")}</td>
                  <td className="muted">{String(r.warning_days || "—")}</td>
                  <td><span className={`status-pill ${r.active ? "status-green" : "status-gray"}`}>{r.active ? "Active" : "Inactive"}</span></td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-sm" onClick={() => startEdit(r)}>Edit Rule</button>
                    {r.active && <button className="btn btn-sm btn-primary" onClick={() => openBatchModal(r.rule_id)}>Run Batch</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredRules.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No rules match.</p>}
        </div>
      )}

      {batches && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <h2 style={{ fontSize: 15, margin: 0, padding: "16px 20px 8px" }}>Recent Batches</h2>
          <table>
            <thead><tr><th>Task Type</th><th>Period</th><th>Created</th><th>Created By</th><th>Count</th></tr></thead>
            <tbody>
              {batches.slice(0, 15).map((b) => (
                <tr key={b.batch_id}>
                  <td>{b.task_type}</td>
                  <td className="muted">{b.period_label}</td>
                  <td className="muted">{b.created_at ? new Date(b.created_at).toLocaleDateString() : "—"}</td>
                  <td className="muted">{b.created_by || "—"}</td>
                  <td>{b.task_count} created, {b.skipped_count} skipped</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showBatchModal && rules && (
        rules.length > 0 ? (
          <CreateBatchTasksModal rules={rules} initialRuleId={batchRuleId || undefined} onClose={() => setShowBatchModal(false)} onDone={() => load()} />
        ) : (
          <div className="modal-overlay" onClick={() => setShowBatchModal(false)}>
            <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header"><h2>Create Batch Tasks</h2><button className="btn btn-sm" onClick={() => setShowBatchModal(false)}>Close</button></div>
              <p className="muted">Add a rule first, then run a batch from it.</p>
            </div>
          </div>
        )
      )}
    </div>
  );
}
