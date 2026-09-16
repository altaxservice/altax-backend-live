import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useRef } from "react";

interface DayHours { startHour: number | null; endHour: number | null }
export interface StaffSchedule {
  bookableWeekdays: Record<"sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat", boolean | null>;
  dayHours: Record<"sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat", DayHours>;
}
const SCHEDULE_WEEKDAYS: { key: keyof StaffSchedule["bookableWeekdays"]; label: string }[] = [
  { key: "mon", label: "Mon" }, { key: "tue", label: "Tue" }, { key: "wed", label: "Wed" }, { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" }, { key: "sat", label: "Sat" }, { key: "sun", label: "Sun" },
];
const SCHEDULE_HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);
function fmtScheduleHour(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:00 ${period}`;
}

/**
 * Per-staff Working Hours override modal — extracted 2026-09-16 from
 * UsersPage.tsx so it can be opened from two places (Users & Access, and
 * the Calendar Settings "Staff Availability" section) without duplicating
 * the load/save logic. Self-contained, matching CalendarSettingsPanel's
 * own AppointmentTypesManager pattern: fetches its own data, owns its own
 * save state, calls onSaved() (if given) so the caller can refresh its
 * list without this component needing to know how.
 */
export function StaffScheduleEditor({ userId, name, onClose, onSaved }: { userId: string; name: string; onClose: () => void; onSaved?: () => void }) {
  const [schedule, setSchedule] = useState<StaffSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);
  useEscapeToClose(onClose, true);

  useEffect(() => {
    api.get<{ schedule: StaffSchedule }>(`/users/${userId}/schedule`)
      .then((res) => setSchedule(res.schedule))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this person's schedule."));
  }, [userId]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!schedule) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(`/users/${userId}/schedule`, { schedule });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this schedule.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="schedule-title" style={{ width: "min(560px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="schedule-title">Working Hours — {name}</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
          Controls when {name} shows up as available for appointment booking. Every day uses the firm's default
          (set below on this Calendar Settings page) unless overridden here.
        </p>
        {error && <ErrorBanner error={error} />}
        {!schedule ? (
          <div className="spinner-wrap">Loading…</div>
        ) : (
          <form onSubmit={handleSave}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {SCHEDULE_WEEKDAYS.map((w) => {
                const bookableOverride = schedule.bookableWeekdays[w.key];
                const dh = schedule.dayHours[w.key];
                const isCustomHours = dh.startHour !== null && dh.endHour !== null;
                return (
                  <div key={w.key} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ width: 38, fontSize: 13, fontWeight: 600 }}>{w.label}</span>
                    <select
                      aria-label={`${w.label} bookable`}
                      value={bookableOverride === null ? "default" : bookableOverride ? "yes" : "no"}
                      onChange={(e) => {
                        const v = e.target.value === "default" ? null : e.target.value === "yes";
                        setSchedule((s) => s && { ...s, bookableWeekdays: { ...s.bookableWeekdays, [w.key]: v } });
                      }}
                      style={{ fontSize: 12.5 }}
                    >
                      <option value="default">Firm default</option>
                      <option value="yes">Works this day</option>
                      <option value="no">Not bookable</option>
                    </select>
                    {bookableOverride !== false && (
                      <>
                        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5 }}>
                          <input
                            type="checkbox"
                            checked={isCustomHours}
                            onChange={(e) => {
                              const nextHours: DayHours = e.target.checked ? { startHour: 9, endHour: 17 } : { startHour: null, endHour: null };
                              setSchedule((s) => s && { ...s, dayHours: { ...s.dayHours, [w.key]: nextHours } });
                            }}
                          />
                          Custom hours
                        </label>
                        {isCustomHours && (
                          <>
                            <select
                              aria-label={`${w.label} start time`}
                              value={dh.startHour ?? 9}
                              onChange={(e) => setSchedule((s) => s && { ...s, dayHours: { ...s.dayHours, [w.key]: { ...s.dayHours[w.key], startHour: Number(e.target.value) } } })}
                            >
                              {SCHEDULE_HOUR_OPTIONS.map((h) => <option key={h} value={h}>{fmtScheduleHour(h)}</option>)}
                            </select>
                            <span className="muted" style={{ fontSize: 12 }}>to</span>
                            <select
                              aria-label={`${w.label} end time`}
                              value={dh.endHour ?? 17}
                              onChange={(e) => setSchedule((s) => s && { ...s, dayHours: { ...s.dayHours, [w.key]: { ...s.dayHours[w.key], endHour: Number(e.target.value) } } })}
                            >
                              {SCHEDULE_HOUR_OPTIONS.map((h) => <option key={h} value={h}>{fmtScheduleHour(h)}</option>)}
                            </select>
                          </>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ marginTop: 14 }}>{saving ? "Saving…" : "Save"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
