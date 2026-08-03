import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { useToast } from "./Toast";
import { ErrorBanner } from "./ErrorBanner";

interface DayHours {
  startHour: number | null;
  endHour: number | null;
}

interface AppointmentSettings {
  bookableWeekdays: { mon: boolean; tue: boolean; wed: boolean; thu: boolean; fri: boolean; sat: boolean; sun: boolean };
  slotMinutes: number;
  businessStartHour: number;
  businessEndHour: number;
  dayHours: { mon: DayHours; tue: DayHours; wed: DayHours; thu: DayHours; fri: DayHours; sat: DayHours; sun: DayHours };
  maxDaysAhead: number;
  reminderLeadMinutes: number[];
  staffReminderChannel: "email" | "sms" | "both";
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
// Mirrors REMINDER_LEAD_PRESETS in src/common/appointmentSettings.ts — the backend
// is the source of truth (its DB CHECK constraint enforces this exact list); this
// copy only drives which checkboxes render.
const REMINDER_LEAD_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 10080, label: "1 week before" },
  { minutes: 4320, label: "3 days before" },
  { minutes: 1440, label: "1 day before" },
  { minutes: 240, label: "4 hours before" },
  { minutes: 60, label: "1 hour before" },
];
const STAFF_CHANNEL_OPTIONS: { value: AppointmentSettings["staffReminderChannel"]; label: string }[] = [
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
 * Calendar Settings (admin-only) — controls what the public /book page and the
 * "+ New Appointment" default offer: which weekdays are bookable, business
 * hours, slot length, how far ahead someone can book, the office
 * location/map link, and the bilingual policy text appended to every
 * confirmation/reminder (see appointments.routes.ts's notifyAppointment).
 */
export function CalendarSettingsPanel() {
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save calendar settings.");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return error ? <ErrorBanner error={error} /> : <div className="spinner-wrap">Loading…</div>;

  return (
    <form onSubmit={handleSubmit} className="card" style={{ maxWidth: 640, padding: 20 }}>
      {error && <ErrorBanner error={error} />}
      <p className="muted" style={{ marginTop: 0, marginBottom: 16, fontSize: 13 }}>
        Controls the public "Book a Consultation" page, the SMS/WhatsApp greeting link, and every appointment
        confirmation/reminder — which days and hours are bookable, how long a slot is, the office location, and the
        policy text that gets appended in English and Arabic.
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

      <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div className="field">
          <label htmlFor="cal-slot-minutes">Slot Length</label>
          <select id="cal-slot-minutes" value={settings.slotMinutes} onChange={(e) => setSettings((s) => s && { ...s, slotMinutes: Number(e.target.value) })}>
            {SLOT_OPTIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
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
          Choose when the client (email/SMS) and the assigned staff member + every admin get reminded ahead of an
          appointment — pick any combination. The assigned staff and admins always get the same schedule as the
          client; their channel (email/SMS/both) is set separately below.
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
          <label style={{ fontSize: 12.5, fontWeight: 600 }}>Staff/Admin Reminder Channel</label>
          <p className="muted" style={{ margin: "2px 0 8px", fontSize: 12 }}>
            SMS only reaches staff/admins who have a phone number on their user account — anyone without one still gets email.
          </p>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {STAFF_CHANNEL_OPTIONS.map((o) => (
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
