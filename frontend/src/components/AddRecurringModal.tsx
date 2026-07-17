import { useState } from "react";
import { api, ApiError } from "../api/client";
import type { Client } from "../api/types";
import type { RecurringBilling } from "../api/types2";
import { MANUAL_PROFILE, PaymentProfileField } from "./PaymentProfileField";
import { useToast } from "./Toast";

/**
 * Add/Edit Recurring Billing schedule. Shared by InvoicesListPage (Add Recurring
 * toolbar button, full editing) and InvoiceEditorModal's "Make Recurring" link
 * (prefilled from an existing invoice's client/description/amount, but with no
 * recurring_billing_id — so saving creates a new schedule rather than editing one).
 * `editing` is a Partial<RecurringBilling> for exactly that reason.
 */
export function AddRecurringModal({ clients, editing, onClose, onDone }: { clients: Client[]; editing?: Partial<RecurringBilling>; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    clientId: String(editing?.client_id || ""), description: String(editing?.description || ""), amount: String(editing?.amount ?? ""),
    frequency: String(editing?.frequency || "Monthly"), startDate: String(editing?.start_date || today).slice(0, 10),
    nextRunDate: String(editing?.next_run_date || today).slice(0, 10), endDate: editing?.end_date ? String(editing.end_date).slice(0, 10) : "",
    dueDays: String(editing?.due_days ?? "0"), intervalCount: String(editing?.interval_count ?? "1"),
    repeatOnDay: editing?.repeat_on_day ? String(editing.repeat_on_day) : "", paymentProfile: MANUAL_PROFILE,
    autoCreateInvoice: editing ? Boolean(editing.auto_create_invoice ?? true) : true, autoSendInvoice: editing ? Boolean(editing.auto_send_invoice) : false,
    status: String(editing?.status || "Active"), notes: String(editing?.notes || ""),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!form.clientId || !form.description.trim() || !form.amount) { setError("Client, Description, and Amount are required."); return; }
    setSaving(true);
    setError(null);
    try {
      await api.post("/billing/recurring", {
        recurringBillingId: editing?.recurring_billing_id, clientId: form.clientId, description: form.description,
        amount: Number(form.amount), frequency: form.frequency, startDate: form.startDate, nextRunDate: form.nextRunDate,
        endDate: form.endDate || undefined, dueDays: Number(form.dueDays) || 0,
        intervalCount: Number(form.intervalCount) || 1, repeatOnDay: form.repeatOnDay ? Number(form.repeatOnDay) : undefined,
        paymentMethodId: form.paymentProfile === MANUAL_PROFILE ? undefined : form.paymentProfile,
        autoCreateInvoice: form.autoCreateInvoice, autoSendInvoice: form.autoSendInvoice, status: form.status, notes: form.notes,
      });
      toast(editing?.recurring_billing_id ? "Schedule updated." : "Recurring billing schedule created.");
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this schedule.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>{editing?.recurring_billing_id ? "Edit Recurring Billing" : "Add Recurring Billing"}</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        {error && <div className="error-banner">{error}</div>}
        <div className="field"><label>Client</label><select value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}><option value="">Select a client…</option>{clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}</select></div>
        <div className="field"><label>Description</label><input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. Monthly bookkeeping service" /></div>
        <div className="form-grid">
          <div className="field"><label>Amount</label><input type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></div>
          <div className="field"><label>Frequency</label><select value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}><option>Weekly</option><option>Monthly</option><option>Quarterly</option><option>Annual</option></select></div>
          <div className="field"><label>Every number of {form.frequency === "Weekly" ? "weeks" : form.frequency === "Quarterly" ? "quarters" : form.frequency === "Annual" ? "years" : "months"}</label><input type="number" min="1" value={form.intervalCount} onChange={(e) => setForm((f) => ({ ...f, intervalCount: e.target.value }))} /></div>
          <div className="field"><label>On day (optional)</label><input type="number" min="1" max="31" placeholder="Same as start date" value={form.repeatOnDay} onChange={(e) => setForm((f) => ({ ...f, repeatOnDay: e.target.value }))} /></div>
          <div className="field"><label>Start Date</label><input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} /></div>
          <div className="field"><label>Next Run Date</label><input type="date" value={form.nextRunDate} onChange={(e) => setForm((f) => ({ ...f, nextRunDate: e.target.value }))} /></div>
          <div className="field"><label>End Date</label><input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} /></div>
          <div className="field"><label>Due Days</label><input type="number" min="0" value={form.dueDays} onChange={(e) => setForm((f) => ({ ...f, dueDays: e.target.value }))} /></div>
          <PaymentProfileField clientId={form.clientId} value={form.paymentProfile} onChange={(v) => setForm((f) => ({ ...f, paymentProfile: v }))} />
          <div className="field"><label>Auto Create Invoice</label><select value={form.autoCreateInvoice ? "yes" : "no"} onChange={(e) => setForm((f) => ({ ...f, autoCreateInvoice: e.target.value === "yes" }))}><option value="yes">Yes</option><option value="no">No</option></select></div>
          <div className="field"><label>Auto Send Invoice</label><select value={form.autoSendInvoice ? "yes" : "no"} onChange={(e) => setForm((f) => ({ ...f, autoSendInvoice: e.target.value === "yes" }))}><option value="no">No</option><option value="yes">Yes</option></select></div>
          <div className="field"><label>Status</label><select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}><option>Active</option><option>Paused</option><option>Archived</option></select></div>
        </div>
        <div className="field"><label>Notes</label><textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
        <p className="muted" style={{ fontSize: 12 }}>Auto Create makes invoices when you run due billing. Auto Send emails the invoice to the client's address on file when it's created (requires an email provider connected in the backend .env — shows a clear error in Run Due Billing results if not). Auto Collect is not enabled until a payment processor is connected.</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSubmit}>{saving ? "Saving…" : "Save Schedule"}</button>
        </div>
      </div>
    </div>
  );
}
