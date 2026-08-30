import { useEffect, useState, type FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { TaskRule, WebOptions } from "../api/types2";
import { useToast } from "../components/Toast";
import { usePrompt } from "../components/ConfirmProvider";
import { ErrorBanner } from "../components/ErrorBanner";
import { BackLink } from "../components/BackLink";
import { PAYROLL_PROVIDERS } from "../utils/clientOptions";

const TRIGGER_COLUMNS = [
  "SalesTaxFrequency", "PayrollFrequency", "PayrollSystem", "PayrollEnabled", "EFTPSEnabled", "MDWithholdingFrequency",
  "MDUIEnabled", "MDAnnualReportEnabled", "BusinessReturnType", "ClientType", "ServiceType", "Status",
];
const FREQUENCIES = ["One-Time", "Weekly", "Monthly", "Quarterly", "Semiannual", "Annual"];

function formFromRule(r: TaskRule) {
  return {
    ruleId: r.rule_id, taskType: r.task_type || "", triggerColumn: String(r.trigger_column || ""),
    triggerValue: String(r.trigger_value || ""), frequency: String(r.frequency || "Monthly"),
    paymentRequired: Boolean(r.payment_required), requiresFiling: r.requires_filing !== false,
    dueDay: String(r.due_day || ""), dueMonth: String(r.due_month || ""), warningDays: String(r.warning_days || "14,7,3"),
    portalName: String(r.portal_name || ""), portalUrl: String(r.portal_url || ""),
    active: r.active !== false, notes: String(r.notes || ""),
  };
}

/**
 * Rule Detail — clicking a row in Task Rules used to open an inline edit form
 * at the top of the LIST page, disconnected from the row you clicked (owner's
 * own words: "that confusing"). This is a real page instead, same pattern as
 * ClientDetailPage/EmployeeDetailPage: /rules/:ruleId, BackLink history-aware.
 */
export function RuleDetailPage() {
  const { ruleId } = useParams<{ ruleId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const promptFor = usePrompt();

  const [rule, setRule] = useState<TaskRule | null>(null);
  const [options, setOptions] = useState<WebOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ReturnType<typeof formFromRule> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  function load() {
    if (!ruleId) return;
    api.get<{ rule: TaskRule }>(`/rules/${encodeURIComponent(ruleId)}`)
      .then((r) => { setRule(r.rule); setForm(formFromRule(r.rule)); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this rule."));
  }
  useEffect(load, [ruleId]);
  useEffect(() => { api.get<WebOptions>("/system/options").then(setOptions).catch(() => {}); }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.post("/rules", form);
      toast("Rule updated.");
      load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save this rule.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!rule) return;
    const confirmValue = await promptFor({
      title: "Permanently delete rule",
      message: `"${rule.rule_id}" (${rule.task_type}) — this cannot be undone. Any pending or approved draft batch from this rule is deleted with it; historical batches already run from it keep their tasks but lose their link back to this rule. Type DELETE RULE to confirm.`,
      placeholder: "DELETE RULE",
    });
    if (confirmValue === null) return;
    setDeleting(true);
    try {
      await api.post(`/rules/${encodeURIComponent(rule.rule_id)}/delete`, { confirm: confirmValue });
      toast("Rule deleted.");
      navigate("/rules");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete this rule.");
      setDeleting(false);
    }
  }

  if (error) return <div><BackLink fallback="/rules" fallbackLabel="Task Rules" /><ErrorBanner error={error} /></div>;
  if (!rule || !form) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div>
      <div style={{ marginBottom: 12 }}><BackLink fallback="/rules" fallbackLabel="Task Rules" /></div>
      <div className="portal-banner" style={{ marginBottom: 20 }}>
        <div className="topbar-eyebrow">{rule.rule_id}</div>
        <h2>{rule.task_type}</h2>
        <p>
          {rule.trigger_column ? `${rule.trigger_column} = ${rule.trigger_value}` : "Manual selection (no auto-trigger)"} · {rule.frequency}
          {" · "}<span className={`status-pill ${rule.active ? "status-green" : "status-gray"}`}>{rule.active ? "Active" : "Inactive"}</span>
        </p>
      </div>

      <form onSubmit={handleSave} className="card" style={{ maxWidth: 560, marginBottom: 24 }}>
        {saveError && <ErrorBanner error={saveError} />}
        <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Edit {rule.rule_id}</h2>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="rule-task-type">Task Type</label>
            <select id="rule-task-type" required value={form.taskType} onChange={(e) => setForm((f) => f && ({ ...f, taskType: e.target.value }))}>
              <option value="">Choose…</option>
              {form.taskType && !(options?.taskTypes || []).includes(form.taskType) && <option value={form.taskType}>{form.taskType}</option>}
              {(options?.taskTypes || []).map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rule-frequency">Frequency</label>
            <select id="rule-frequency" value={form.frequency} onChange={(e) => setForm((f) => f && ({ ...f, frequency: e.target.value }))}>
              {FREQUENCIES.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rule-trigger-column">Trigger Column</label>
            <select id="rule-trigger-column" value={form.triggerColumn} onChange={(e) => setForm((f) => f && ({ ...f, triggerColumn: e.target.value }))}>
              <option value="">Manual selection (no auto-trigger)</option>
              {TRIGGER_COLUMNS.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rule-trigger-value">Trigger Value</label>
            {form.triggerColumn === "PayrollSystem" ? (
              <select id="rule-trigger-value" value={form.triggerValue} onChange={(e) => setForm((f) => f && ({ ...f, triggerValue: e.target.value }))}>
                <option value="">Choose…</option>
                {PAYROLL_PROVIDERS.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : (
              <input id="rule-trigger-value" value={form.triggerValue} onChange={(e) => setForm((f) => f && ({ ...f, triggerValue: e.target.value }))} placeholder="e.g. Monthly" disabled={!form.triggerColumn} />
            )}
          </div>
          <div className="field"><label htmlFor="rule-due-day">Due Day</label><input id="rule-due-day" value={form.dueDay} onChange={(e) => setForm((f) => f && ({ ...f, dueDay: e.target.value }))} placeholder="1–31" /></div>
          {(form.frequency === "Semiannual" || form.frequency === "Annual") && (
            <div className="field">
              <label htmlFor="rule-due-month">Due Month Offset</label>
              <input id="rule-due-month" value={form.dueMonth} onChange={(e) => setForm((f) => f && ({ ...f, dueMonth: e.target.value }))} placeholder="1" />
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>How many months after the period ends this is due (1 = due the next month, matching W-2s/1099s). Only used by the Task Rules Agent's auto-draft; leave blank for the default of 1.</p>
            </div>
          )}
          <div className="field"><label htmlFor="rule-warning-days">Warning Days</label><input id="rule-warning-days" value={form.warningDays} onChange={(e) => setForm((f) => f && ({ ...f, warningDays: e.target.value }))} placeholder="14,7,3" /></div>
          <div className="field"><label htmlFor="rule-portal-name">Portal Name</label><input id="rule-portal-name" value={form.portalName} onChange={(e) => setForm((f) => f && ({ ...f, portalName: e.target.value }))} /></div>
          <div className="field"><label htmlFor="rule-portal-url">Portal URL</label><input id="rule-portal-url" value={form.portalUrl} onChange={(e) => setForm((f) => f && ({ ...f, portalUrl: e.target.value }))} /></div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 22 }}>
            <input type="checkbox" checked={form.paymentRequired} onChange={(e) => setForm((f) => f && ({ ...f, paymentRequired: e.target.checked }))} />
            Payment required
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 22 }}>
            <input type="checkbox" checked={form.requiresFiling} onChange={(e) => setForm((f) => f && ({ ...f, requiresFiling: e.target.checked }))} />
            Requires filing
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 22 }}>
            <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => f && ({ ...f, active: e.target.checked }))} />
            Active
          </label>
        </div>
        <div className="field"><label htmlFor="rule-notes">Notes</label><textarea id="rule-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => f && ({ ...f, notes: e.target.value }))} /></div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "space-between" }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Rule"}</button>
          <button type="button" className="btn btn-danger" disabled={deleting} onClick={handleDelete}>{deleting ? "Deleting…" : "Delete Rule"}</button>
        </div>
      </form>
    </div>
  );
}
