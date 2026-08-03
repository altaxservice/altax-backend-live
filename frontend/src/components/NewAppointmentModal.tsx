import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Client, Appointment } from "../api/types";
import type { PortalUser } from "../api/types2";
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

function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}
function toTimeInput(iso: string): string {
  return new Date(iso).toTimeString().slice(0, 5);
}

/**
 * Book an appointment — with an existing client (pulls their email/phone
 * automatically) or a brand-new contact by name/email/phone. Confirms by
 * email+SMS on save when Notify is on, and reminders go out automatically per
 * Calendar Settings (see appointments.routes.ts's hourly cron). Default
 * start/end time follows Calendar Settings (business start hour + slot
 * length) rather than a hardcoded guess.
 *
 * Also doubles as the Edit modal — pass `appointment` to pre-fill and PATCH
 * instead of POST. The backend's PATCH route only accepts title/time/
 * location/notes/assignedTo/notifyClient (not client/contact — who an
 * appointment is with isn't editable, only when/who's running it), so those
 * fields are shown read-only in edit mode instead of hidden, so it's clear
 * editing doesn't touch them.
 */
export function NewAppointmentModal({ clients, defaultDate, appointment, onClose, onDone }: {
  clients: Client[]; defaultDate?: string; appointment?: Appointment; onClose: () => void; onDone: () => void;
}) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const isEditing = !!appointment;
  const today = defaultDate || new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState(() => appointment ? {
    title: appointment.title, clientId: appointment.client_id || "",
    contactName: appointment.contact_name || "", contactEmail: appointment.contact_email || "", contactPhone: appointment.contact_phone || "",
    date: toDateInput(appointment.start_time), startTime: toTimeInput(appointment.start_time), endTime: toTimeInput(appointment.end_time),
    location: appointment.location || "", notes: appointment.notes || "", assignedTo: appointment.assigned_to || "", notifyClient: appointment.notify_client,
  } : {
    title: "", clientId: "", contactName: "", contactEmail: "", contactPhone: "",
    date: today, startTime: "09:00", endTime: "10:00", location: "", notes: "", assignedTo: "", notifyClient: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staffOptions, setStaffOptions] = useState<string[]>([]);

  useEffect(() => {
    api.get<{ users: PortalUser[] }>("/users")
      .then((res) => setStaffOptions(Array.from(new Set(res.users.filter((u) => ["admin", "staff"].includes(String(u.role || "").toLowerCase()) && u.active).map((u) => u.name))).sort()))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isEditing) return;
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
      if (isEditing) {
        await api.patch(`/appointments/${appointment!.appointment_id}`, {
          title: form.title.trim(), startTime, endTime,
          location: form.location.trim() || undefined, notes: form.notes.trim() || undefined,
          assignedTo: form.assignedTo || "", notifyClient: form.notifyClient,
        });
      } else {
        await api.post("/appointments", {
          title: form.title.trim(), clientId: form.clientId || undefined,
          contactName: form.contactName.trim() || undefined, contactEmail: form.contactEmail.trim() || undefined,
          contactPhone: form.contactPhone.trim() || undefined, startTime, endTime,
          location: form.location.trim() || undefined, notes: form.notes.trim() || undefined,
          assignedTo: form.assignedTo || undefined, notifyClient: form.notifyClient,
        });
      }
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not ${isEditing ? "save" : "create"} this appointment.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="new-appointment-title" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2 id="new-appointment-title">{isEditing ? "Edit Appointment" : "New Appointment"}</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        {error && <ErrorBanner error={error} />}
        <div className="field">
          <label htmlFor="appt-title">Title</label>
          <input id="appt-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Tax review" />
        </div>
        {isEditing ? (
          <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>
            With {appointment!.client_name || appointment!.contact_name || "—"} — who this is with can't be changed here; cancel and rebook to change the client/contact.
          </p>
        ) : (
          <div className="field">
            <label htmlFor="appt-client">Client (optional)</label>
            <select id="appt-client" value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}>
              <option value="">No client — new contact</option>
              {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
            </select>
          </div>
        )}
        {!isEditing && !form.clientId && (
          <div className="form-grid">
            <div className="field"><label htmlFor="appt-contact-name">Contact Name</label><input id="appt-contact-name" value={form.contactName} onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))} /></div>
            <div className="field"><label htmlFor="appt-contact-email">Contact Email</label><input id="appt-contact-email" type="email" value={form.contactEmail} onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))} /></div>
            <div className="field"><label htmlFor="appt-contact-phone">Contact Phone</label><input id="appt-contact-phone" value={form.contactPhone} onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))} /></div>
          </div>
        )}
        {!isEditing && selectedClient && (
          <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>
            Confirmation goes to {selectedClient.email || "no email on file"}{selectedClient.phone ? ` / ${selectedClient.phone}` : ""}.
          </p>
        )}
        <div className="form-grid">
          <div className="field"><label htmlFor="appt-date">Date</label><input id="appt-date" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></div>
          <div className="field"><label htmlFor="appt-start-time">Start Time</label><input id="appt-start-time" type="time" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} /></div>
          <div className="field"><label htmlFor="appt-end-time">End Time</label><input id="appt-end-time" type="time" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} /></div>
          <div className="field"><label htmlFor="appt-location">Location (optional)</label><input id="appt-location" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Office, video call, etc." /></div>
          <div className="field">
            <label htmlFor="appt-assigned-to">Assigned Staff</label>
            <select id="appt-assigned-to" value={form.assignedTo} onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))}>
              <option value="">Unassigned</option>
              {form.assignedTo && !staffOptions.includes(form.assignedTo) && (
                <option value={form.assignedTo}>{form.assignedTo} (Inactive)</option>
              )}
              {staffOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="appt-notify">Notify</label>
            <select id="appt-notify" value={form.notifyClient ? "yes" : "no"} onChange={(e) => setForm((f) => ({ ...f, notifyClient: e.target.value === "yes" }))}>
              <option value="yes">Email + SMS confirmation &amp; reminder</option>
              <option value="no">No — internal only</option>
            </select>
          </div>
        </div>
        <div className="field"><label htmlFor="appt-notes">Notes</label><textarea id="appt-notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSubmit}>{saving ? "Saving…" : isEditing ? "Save Changes" : "Book Appointment"}</button>
        </div>
      </div>
    </div>
  );
}
