import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { useToast } from "./Toast";
import { useNotify } from "./ConfirmProvider";
import { ErrorBanner } from "./ErrorBanner";

interface AppointmentType {
  appointmentTypeId: string;
  name: string;
  durationMinutes: number;
  active: boolean;
  sortOrder: number;
}

interface DayHours {
  startHour: number | null;
  endHour: number | null;
}

interface AppointmentSettings {
  bookableWeekdays: { mon: boolean; tue: boolean; wed: boolean; thu: boolean; fri: boolean; sat: boolean; sun: boolean };
  slotMinutes: number;
  gapMinutes: number;
  businessStartHour: number;
  businessEndHour: number;
  dayHours: { mon: DayHours; tue: DayHours; wed: DayHours; thu: DayHours; fri: DayHours; sat: DayHours; sun: DayHours };
  maxDaysAhead: number;
  reminderLeadMinutes: number[];
  staffReminderChannel: "email" | "sms" | "both";
  clientReminderChannel: "email" | "sms" | "both";
  locationName: string;
  locationAddress: string;
  locationMapUrl: string;
  policyMessageEn: string;
  policyMessageAr: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

const WEEKDAYS: { key: keyof AppointmentSettings["bookableWeekdays"]; label: string }[] = [
  { key: "mon", label: "Mon" }, { key: "tue", label: "Tue" }, { key: "wed", label: "Wed" }, { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" }, { key: "sat", label: "Sat" }, { key: "sun", label: "Sun" },
];
const SLOT_OPTIONS = [15, 20, 30, 45, 60, 90, 120];
const GAP_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60];
// Mirrors REMINDER_LEAD_PRESETS in src/common/appointmentSettings.ts — the backend
// is the source of truth (its DB CHECK constraint enforces this exact list); this
// copy only drives which checkboxes render.
const REMINDER_LEAD_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 10080, label: "1 week before" },
  { minutes: 4320, label: "3 days before" },
  { minutes: 1440, label: "1 day before" },
  { minutes: 720, label: "12 hours before" },
  { minutes: 240, label: "4 hours before" },
  { minutes: 120, label: "2 hours before" },
  { minutes: 60, label: "1 hour before" },
];
const CHANNEL_OPTIONS: { value: AppointmentSettings["staffReminderChannel"]; label: string }[] = [
  { value: "email", label: "Email only" },
  { value: "sms", label: "SMS only" },
  { value: "both", label: "Email + SMS" },
];
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);

function fmtHour(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:00 ${period}`;
}

/**
 * The list of named durations a client picks on /book and staff pick when
 * creating an appointment (e.g. "Quick Question" 15 min, "Full Consultation"
 * 60 min) — see sql/036_appointment_types.sql. Kept as its own manager rather
 * than a plain list, since add/edit/deactivate each need their own small
 * form; a deactivated type stays visible (greyed) so its name is still
 * recognizable on appointments already booked under it.
 */
function AppointmentTypesManager() {
  const notify = useNotify();
  const [types, setTypes] = useState<AppointmentType[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDuration, setEditDuration] = useState(30);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDuration, setNewDuration] = useState(30);
  const [busy, setBusy] = useState(false);

  function load() {
    api.get<{ types: AppointmentType[] }>("/appointment-settings/types")
      .then((res) => setTypes(res.types))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load appointment types."));
  }
  useEffect(load, []);

  async function handleAdd() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await api.post("/appointment-settings/types", { name: newName.trim(), durationMinutes: newDuration });
      setNewName(""); setNewDuration(30); setAdding(false);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not add this appointment type.");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(t: AppointmentType) {
    setEditingId(t.appointmentTypeId); setEditName(t.name); setEditDuration(t.durationMinutes);
  }

  async function handleSaveEdit() {
    if (!editingId || !editName.trim()) return;
    setBusy(true);
    try {
      await api.patch(`/appointment-settings/types/${editingId}`, { name: editName.trim(), durationMinutes: editDuration });
      setEditingId(null);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not save this appointment type.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(t: AppointmentType) {
    setBusy(true);
    try {
      await api.patch(`/appointment-settings/types/${t.appointmentTypeId}`, { active: !t.active });
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not update this appointment type.");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="muted" style={{ fontSize: 13, color: "var(--red)" }}>{error}</p>;

  return (
    <div className="field">
      <label>Appointment Types</label>
      <p className="muted" style={{ margin: "0 0 8px", fontSize: 12.5 }}>
        The durations a client can choose from on the public booking page, and staff can pick from when scheduling internally — e.g. a
        short "Quick Question" alongside a longer "Full Consultation".
      </p>
      <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
        {!types ? (
          <div className="muted" style={{ padding: 12, fontSize: 13 }}>Loading…</div>
        ) : types.length === 0 ? (
          <div className="muted" style={{ padding: 12, fontSize: 13 }}>No appointment types yet — add one below.</div>
        ) : (
          types.map((t) => (
            <div key={t.appointmentTypeId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--line)", opacity: t.active ? 1 : 0.55 }}>
              {editingId === t.appointmentTypeId ? (
                <>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ flex: 1, minWidth: 0 }} aria-label="Type name" />
                  <select value={editDuration} onChange={(e) => setEditDuration(Number(e.target.value))} aria-label="Duration">
                    {SLOT_OPTIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
                  </select>
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={handleSaveEdit}>Save</button>
                  <button type="button" className="ghost-button btn-sm" disabled={busy} onClick={() => setEditingId(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{t.name}</span>
                  <span className="muted" style={{ fontSize: 12.5 }}>{t.durationMinutes} min</span>
                  {!t.active && <span className="status-pill status-gray" style={{ fontSize: 11 }}>Inactive</span>}
                  <button type="button" className="ghost-button btn-sm" disabled={busy} onClick={() => startEdit(t)}>Edit</button>
                  <button type="button" className="ghost-button btn-sm" disabled={busy} onClick={() => handleToggleActive(t)}>{t.active ? "Deactivate" : "Reactivate"}</button>
                </>
              )}
            </div>
          ))
        )}
        {adding ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px" }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Quick Question" style={{ flex: 1, minWidth: 0 }} aria-label="New type name" autoFocus />
            <select value={newDuration} onChange={(e) => setNewDuration(Number(e.target.value))} aria-label="New type duration">
              {SLOT_OPTIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy || !newName.trim()} onClick={handleAdd}>Add</button>
            <button type="button" className="ghost-button btn-sm" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>
          </div>
        ) : (
          <div style={{ padding: "8px 12px" }}>
            <button type="button" className="ghost-button btn-sm" onClick={() => setAdding(true)}>+ Add Appointment Type</button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Calendar Settings (admin-only) — controls what the public /book page and the
 * "+ New Appointment" default offer: which weekdays are bookable, business
 * hours, slot length, how far ahead someone can book, the office
 * location/map link, and the bilingual policy text appended to every
 * confirmation/reminder (see appointments.routes.ts's notifyAppointment).
 */
export function CalendarSettingsPanel({ onClose }: { onClose?: () => void } = {}) {
  const toast = useToast();
  const [settings, setSettings] = useState<AppointmentSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    api.get<AppointmentSettings>("/appointment-settings")
      .then(setSettings)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load calendar settings."));
  }
  useEffect(load, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.patch<AppointmentSettings>("/appointment-settings", settings);
      setSettings(res);
      toast("Calendar settings saved.");
      onClose?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save calendar settings.");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return error ? <ErrorBanner error={error} /> : <div className="spinner-wrap">Loading…</div>;

  return (
    <form onSubmit={handleSubmit} className="card" style={{ maxWidth: 640, padding: 20 }}>
      {onClose && (
        <button
          type="button"
          className="link-button"
          style={{ display: "block", marginBottom: 10, fontSize: 13 }}
          onClick={onClose}
        >
          ← Back to Calendar
        </button>
      )}
      {error && <ErrorBanner error={error} />}
      <p className="muted" style={{ marginTop: 0, marginBottom: 16, fontSize: 13 }}>
        Controls the public "Book a Consultation" page, the SMS/WhatsApp greeting link, and every appointment
        confirmation/reminder — which days and hours are bookable, the appointment durations someone can choose from,
        the office location, and the policy text that gets appended in English and Arabic.
      </p>

      <div className="field">
        <label>Bookable Days</label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {WEEKDAYS.map((w) => (
            <label key={w.key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={settings.bookableWeekdays[w.key]}
                onChange={(e) => setSettings((s) => s && { ...s, bookableWeekdays: { ...s.bookableWeekdays, [w.key]: e.target.checked } })}
              />
              {w.label}
            </label>
          ))}
        </div>
      </div>

      <AppointmentTypesManager />

      <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
        <div className="field">
          <label htmlFor="cal-slot-minutes">Time Grid <span className="muted" style={{ fontWeight: 400 }}>(spacing between start times)</span></label>
          <select id="cal-slot-minutes" value={settings.slotMinutes} onChange={(e) => setSettings((s) => s && { ...s, slotMinutes: Number(e.target.value) })}>
            {SLOT_OPTIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cal-gap-minutes">Gap Between Appointments</label>
          <select id="cal-gap-minutes" value={settings.gapMinutes} onChange={(e) => setSettings((s) => s && { ...s, gapMinutes: Number(e.target.value) })}>
            {GAP_OPTIONS.map((m) => <option key={m} value={m}>{m === 0 ? "No gap" : `${m} min`}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cal-start-hour">Default Start Time</label>
          <select id="cal-start-hour" value={settings.businessStartHour} onChange={(e) => setSettings((s) => s && { ...s, businessStartHour: Number(e.target.value) })}>
            {HOUR_OPTIONS.map((h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cal-end-hour">Default End Time</label>
          <select id="cal-end-hour" value={settings.businessEndHour} onChange={(e) => setSettings((s) => s && { ...s, businessEndHour: Number(e.target.value) })}>
            {HOUR_OPTIONS.map((h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Hours by Day</label>
        <p className="muted" style={{ margin: "0 0 8px", fontSize: 12.5 }}>
          Every bookable day uses the default hours above unless you set a different range for it — for example, closing early on Fridays.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {WEEKDAYS.map((w) => {
            const dh = settings.dayHours[w.key];
            const isCustom = dh.startHour !== null && dh.endHour !== null;
            const bookable = settings.bookableWeekdays[w.key];
            return (
              <div key={w.key} style={{ display: "flex", alignItems: "center", gap: 10, opacity: bookable ? 1 : 0.5 }}>
                <span style={{ width: 38, fontSize: 13, fontWeight: 600 }}>{w.label}</span>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5 }}>
                  <input
                    type="checkbox"
                    checked={isCustom}
                    disabled={!bookable}
                    onChange={(e) => setSettings((s) => {
                      if (!s) return s;
                      const nextHours: DayHours = e.target.checked
                        ? { startHour: s.businessStartHour, endHour: s.businessEndHour }
                        : { startHour: null, endHour: null };
                      return { ...s, dayHours: { ...s.dayHours, [w.key]: nextHours } };
                    })}
                  />
                  Custom hours
                </label>
                {isCustom && (
                  <>
                    <select
                      aria-label={`${w.label} start time`}
                      value={dh.startHour ?? settings.businessStartHour}
                      onChange={(e) => setSettings((s) => s && { ...s, dayHours: { ...s.dayHours, [w.key]: { ...s.dayHours[w.key], startHour: Number(e.target.value) } } })}
                    >
                      {HOUR_OPTIONS.map((h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
                    </select>
                    <span className="muted" style={{ fontSize: 12.5 }}>to</span>
                    <select
                      aria-label={`${w.label} end time`}
                      value={dh.endHour ?? settings.businessEndHour}
                      onChange={(e) => setSettings((s) => s && { ...s, dayHours: { ...s.dayHours, [w.key]: { ...s.dayHours[w.key], endHour: Number(e.target.value) } } })}
                    >
                      {HOUR_OPTIONS.map((h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
                    </select>
                  </>
                )}
                {!isCustom && <span className="muted" style={{ fontSize: 12.5 }}>Uses default hours{!bookable ? " (not bookable)" : ""}</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="field">
        <label htmlFor="cal-max-days-ahead">Booking Horizon (days ahead someone can book)</label>
        <input id="cal-max-days-ahead" type="number" min={1} max={365} value={settings.maxDaysAhead} onChange={(e) => setSettings((s) => s && { ...s, maxDaysAhead: Number(e.target.value) || 1 })} style={{ maxWidth: 120 }} />
      </div>

      <div className="field">
        <label>Reminders</label>
        <p className="muted" style={{ margin: "0 0 8px", fontSize: 12.5 }}>
          Choose when the client and the assigned staff member + every admin get reminded ahead of an appointment —
          pick any combination. Both the client and staff/admins get the same schedule; each side's channel
          (email/SMS/both) is set separately below.
        </p>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {REMINDER_LEAD_PRESETS.map((p) => (
            <label key={p.minutes} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={settings.reminderLeadMinutes.includes(p.minutes)}
                onChange={(e) => setSettings((s) => s && {
                  ...s,
                  reminderLeadMinutes: e.target.checked
                    ? [...s.reminderLeadMinutes, p.minutes]
                    : s.reminderLeadMinutes.filter((m) => m !== p.minutes),
                })}
              />
              {p.label}
            </label>
          ))}
        </div>
        {settings.reminderLeadMinutes.length === 0 && (
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>No reminders will be sent — check at least one above to re-enable them.</p>
        )}

        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600 }}>Client Reminder Channel</label>
          <p className="muted" style={{ margin: "2px 0 8px", fontSize: 12 }}>
            Applies to every client-facing appointment notice — confirmation, reminders, and cancellation — not just reminders.
          </p>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {CHANNEL_OPTIONS.map((o) => (
              <label key={o.value} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}>
                <input
                  type="radio"
                  name="client-reminder-channel"
                  checked={settings.clientReminderChannel === o.value}
                  onChange={() => setSettings((s) => s && { ...s, clientReminderChannel: o.value })}
                />
                {o.label}
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600 }}>Staff/Admin Reminder Channel</label>
          <p className="muted" style={{ margin: "2px 0 8px", fontSize: 12 }}>
            SMS only reaches staff/admins who have a phone number on their user account — anyone without one still gets email.
          </p>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {CHANNEL_OPTIONS.map((o) => (
              <label key={o.value} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}>
                <input
                  type="radio"
                  name="staff-reminder-channel"
                  checked={settings.staffReminderChannel === o.value}
                  onChange={() => setSettings((s) => s && { ...s, staffReminderChannel: o.value })}
                />
                {o.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="field"><label htmlFor="cal-location-name">Location Name</label><input id="cal-location-name" value={settings.locationName} onChange={(e) => setSettings((s) => s && { ...s, locationName: e.target.value })} /></div>
      <div className="field"><label htmlFor="cal-location-address">Location Address</label><input id="cal-location-address" value={settings.locationAddress} onChange={(e) => setSettings((s) => s && { ...s, locationAddress: e.target.value })} /></div>
      <div className="field">
        <label htmlFor="cal-location-map-url">Directions / Map Link (optional)</label>
        <input id="cal-location-map-url" value={settings.locationMapUrl} onChange={(e) => setSettings((s) => s && { ...s, locationMapUrl: e.target.value })} placeholder="https://maps.google.com/?cid=..." />
      </div>

      <div className="field">
        <label htmlFor="cal-policy-en">Policy Message — English</label>
        <textarea id="cal-policy-en" rows={8} value={settings.policyMessageEn} onChange={(e) => setSettings((s) => s && { ...s, policyMessageEn: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="cal-policy-ar">Policy Message — Arabic</label>
        <textarea id="cal-policy-ar" rows={8} dir="rtl" value={settings.policyMessageAr} onChange={(e) => setSettings((s) => s && { ...s, policyMessageAr: e.target.value })} />
      </div>

      <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Calendar Settings"}</button>

      {settings.updatedBy && settings.updatedAt && (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
          Last updated by {settings.updatedBy} on {new Date(settings.updatedAt).toLocaleString()}
        </div>
      )}
    </form>
  );
}
