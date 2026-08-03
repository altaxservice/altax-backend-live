import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Client } from "../api/types";
import { ErrorBanner } from "./ErrorBanner";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor((total % (24 * 60)) / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Book an appointment — with an existing client (pulls their email/phone
 * automatically) or a brand-new contact by name/email/phone. Confirms by
 * email+SMS on save when Notify is on, and a day-before reminder goes out
 * automatically (see appointments.routes.ts's hourly cron). Default start/end
 * time follows Calendar Settings (business start hour + slot length) rather
 * than a hardcoded guess.
 */
export function NewAppointmentModal({ clients, defaultDate, onClose, onDone }: {
  clients: Client[]; defaultDate?: string; onClose: () => void; onDone: () => void;
}) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const today = defaultDate || new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    title: "", clientId: "", contactName: "", contactEmail: "", contactPhone: "",
    date: today, startTime: "09:00", endTime: "10:00", location: "", notes: "", assignedTo: "", notifyClient: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ businessStartHour: number; slotMinutes: number }>("/appointment-settings")
      .then((s) => {
        const start = `${String(s.businessStartHour).padStart(2, "0")}:00`;
        setForm((f) => ({ ...f, startTime: start, endTime: addMinutes(start, s.slotMinutes) }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedClient = clients.find((c) => c.client_id === form.clientId);

  async function handleSubmit() {
    if (!form.title.trim()) return setError("Title is required.");
    if (!form.date || !form.startTime || !form.endTime) return setError("Date, start time, and end time are required.");
    const startTime = new Date(`${form.date}T${form.startTime}`).toISOString();
    const endTime = new Date(`${form.date}T${form.endTime}`).toISOString();
    if (new Date(endTime) < new Date(startTime)) return setError("End time can't be before start time.");
    setSaving(true);
    setError(null);
    try {
      await api.post("/appointments", {
        title: form.title.trim(), clientId: form.clientId || undefined,
        contactName: form.contactName.trim() || undefined, contactEmail: form.contactEmail.trim() || undefined,
        contactPhone: form.contactPhone.trim() || undefined, startTime, endTime,
        location: form.location.trim() || undefined, notes: form.notes.trim() || undefined,
        assignedTo: form.assignedTo.trim() || undefined, notifyClient: form.notifyClient,
      });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create this appointment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="new-appointment-title" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2 id="new-appointment-title">New Appointment</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        {error && <ErrorBanner error={error} />}
        <div className="field">
          <label>Title</label>
          <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Tax review" />
        </div>
        <div className="field">
          <label>Client (optional)</label>
          <select value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}>
            <option value="">No client — new contact</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
          </select>
        </div>
        {!form.clientId && (
          <div className="form-grid">
            <div className="field"><label>Contact Name</label><input value={form.contactName} onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))} /></div>
            <div className="field"><label>Contact Email</label><input type="email" value={form.contactEmail} onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))} /></div>
            <div className="field"><label>Contact Phone</label><input value={form.contactPhone} onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))} /></div>
          </div>
        )}
        {selectedClient && (
          <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>
            Confirmation goes to {selectedClient.email || "no email on file"}{selectedClient.phone ? ` / ${selectedClient.phone}` : ""}.
          </p>
        )}
        <div className="form-grid">
          <div className="field"><label>Date</label><input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></div>
          <div className="field"><label>Start Time</label><input type="time" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} /></div>
          <div className="field"><label>End Time</label><input type="time" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} /></div>
          <div className="field"><label>Location (optional)</label><input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Office, video call, etc." /></div>
          <div className="field"><label>Assigned Staff (optional)</label><input value={form.assignedTo} onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))} /></div>
          <div className="field">
            <label>Notify</label>
            <select value={form.notifyClient ? "yes" : "no"} onChange={(e) => setForm((f) => ({ ...f, notifyClient: e.target.value === "yes" }))}>
              <option value="yes">Email + SMS confirmation &amp; reminder</option>
              <option value="no">No — internal only</option>
            </select>
          </div>
        </div>
        <div className="field"><label>Notes</label><textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSubmit}>{saving ? "Saving…" : "Book Appointment"}</button>
        </div>
      </div>
    </div>
  );
}
