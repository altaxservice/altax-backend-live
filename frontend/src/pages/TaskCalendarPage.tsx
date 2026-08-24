import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Task, Appointment, Client } from "../api/types";
import { ErrorBanner } from "../components/ErrorBanner";
import { StatusBadge } from "../components/StatusBadge";
import { isOpenTask, isOverdue, isDueWeek } from "../components/TaskCells";
import { NewAppointmentModal } from "../components/NewAppointmentModal";
import { CalendarSettingsPanel } from "../components/CalendarSettingsPanel";
import { useAuth } from "../auth/AuthContext";
import { useConfirm, useNotify } from "../components/ConfirmProvider";
import { useSelectedClient } from "../context/SelectedClientContext";
import { computeAppointmentTiming, pickMostRelevantAppointment, type AppointmentPhase } from "../utils/appointmentTiming";

/**
 * Practice Management: calendar + staff capacity — task due dates (from the same
 * task list Tasks already loads) plotted alongside appointments (its own module,
 * appointments.routes.ts) on one month grid. Capacity groups by the raw
 * assigned_to string, matching TasksListPage.tsx's own staffLoadCounts (no alias
 * resolution there either — this stays consistent with that existing behavior).
 * Settings (admin-only) controls the public booking rules — see
 * CalendarSettingsPanel.tsx.
 */
const VIEWS = ["Calendar", "Capacity", "Settings"] as const;
type View = (typeof VIEWS)[number];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function taskDateKey(t: Task): string | null {
  if (!t.agency_due_date) return null;
  return String(t.agency_due_date).slice(0, 10);
}
function apptDateKey(a: Appointment): string {
  return new Date(a.start_time).toISOString().slice(0, 10);
}
function fmtApptTime(a: Appointment): string {
  return new Date(a.start_time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const PHASE_COLOR: Record<AppointmentPhase | "soon", { fg: string; bg: string }> = {
  before: { fg: "var(--teal)", bg: "var(--teal-soft)" },
  soon: { fg: "var(--amber)", bg: "var(--amber-soft)" },
  during: { fg: "var(--green)", bg: "var(--green-soft)" },
  after: { fg: "var(--muted)", bg: "var(--surface)" },
};

/**
 * Live "before / during / after" status for one appointment — a compact
 * inline badge for a table row. Ticks on its own (1s interval) rather than
 * depending on the parent re-rendering, so a whole table of these stays
 * accurate even if nothing else on the page changes for a while.
 */
function AppointmentTimingBadge({ appt }: { appt: Appointment }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (appt.status !== "Scheduled") return null;
  const timing = computeAppointmentTiming(appt.start_time, appt.end_time, now);
  const colorKey = timing.phase === "before" && timing.startingSoon ? "soon" : timing.phase;
  const { fg, bg } = PHASE_COLOR[colorKey];
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: fg, background: bg, borderRadius: 5, padding: "2px 7px", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      {timing.label}
    </span>
  );
}

/**
 * The "clock timer" (direct owner request, 2026-08-24): a single always-
 * visible, always-ticking card showing whichever appointment matters most
 * right now — in progress wins over merely upcoming, which wins over one
 * that just wrapped up (see pickMostRelevantAppointment). Self-fetches
 * today's appointments independent of whatever month the grid below happens
 * to be showing, so it stays live even while browsing a past/future month.
 * Clicking it goes straight to the client, same "be ready for it" idea as
 * the push notification and Command Center panel built alongside this.
 */
function LiveAppointmentClock() {
  const navigate = useNavigate();
  const { setSelectedClient } = useSelectedClient();
  const [todaysAppts, setTodaysAppts] = useState<Appointment[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const d = new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString();
    api.get<{ appointments: Appointment[] }>(`/appointments?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
      .then((res) => { if (!cancelled) setTodaysAppts(res.appointments.filter((a) => a.status === "Scheduled")); })
      .catch(() => { if (!cancelled) setTodaysAppts([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!todaysAppts || todaysAppts.length === 0) return null;
  const appt = pickMostRelevantAppointment(todaysAppts, now);
  if (!appt) return null;

  const timing = computeAppointmentTiming(appt.start_time, appt.end_time, now);
  const colorKey = timing.phase === "before" && timing.startingSoon ? "soon" : timing.phase;
  const { fg } = PHASE_COLOR[colorKey];
  const phaseWord = timing.phase === "before" ? "Up Next" : timing.phase === "during" ? "In Progress" : "Just Finished";

  function go() {
    if (appt!.client_id) { setSelectedClient(appt!.client_id, appt!.client_name); navigate(`/clients/${appt!.client_id}`); }
  }

  return (
    <div
      className="card"
      onClick={appt.client_id ? go : undefined}
      tabIndex={appt.client_id ? 0 : undefined}
      role={appt.client_id ? "button" : undefined}
      onKeyDown={appt.client_id ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } } : undefined}
      style={{
        marginBottom: 16, padding: "16px 20px", display: "flex", alignItems: "center", gap: 18,
        borderLeft: `4px solid ${fg}`, cursor: appt.client_id ? "pointer" : "default",
      }}
    >
      <div style={{ flexShrink: 0, textAlign: "center", minWidth: 118 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: fg, marginBottom: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
          {timing.phase === "during" && (
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: fg, display: "inline-block", animation: "pulse 1.4s ease-in-out infinite" }} />
          )}
          {phaseWord}
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "var(--ink)", lineHeight: 1.1 }}>
          {timing.durationText}
        </div>
        <div className="muted" style={{ fontSize: 10.5 }}>
          {timing.phase === "before" ? "until start" : timing.phase === "during" ? "remaining" : "ago"}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {appt.title || "Appointment"} {(appt.client_name || appt.contact_name) && <span className="muted" style={{ fontWeight: 500 }}>with {appt.client_name || appt.contact_name}</span>}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          {fmtApptTime(appt)} – {new Date(appt.end_time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          {appt.location ? ` · ${appt.location}` : ""}
          {appt.assigned_to ? ` · ${appt.assigned_to}` : ""}
        </div>
        {timing.phase === "during" && timing.progressPct !== null && (
          <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: "var(--line)", overflow: "hidden" }}>
            <div style={{ width: `${timing.progressPct}%`, height: "100%", background: fg, transition: "width 1s linear" }} />
          </div>
        )}
      </div>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }`}</style>
    </div>
  );
}

export function TaskCalendarPage() {
  const navigate = useNavigate();
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("Calendar");
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showNewAppt, setShowNewAppt] = useState(false);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [hoveredApptId, setHoveredApptId] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ tasks: Task[] }>("/tasks")
      .then((res) => setTasks(res.tasks))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load tasks."));
    api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => {});
  }, []);

  function loadAppointments() {
    const year = cursor.getFullYear(), month = cursor.getMonth();
    const start = new Date(year, month, 1).toISOString();
    const end = new Date(year, month + 1, 1).toISOString();
    api.get<{ appointments: Appointment[] }>(`/appointments?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
      .then((res) => setAppointments(res.appointments))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load appointments."));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadAppointments, [cursor]);

  const openTasks = useMemo(() => (tasks || []).filter(isOpenTask), [tasks]);
  const activeAppointments = useMemo(() => (appointments || []).filter((a) => a.status !== "Cancelled"), [appointments]);

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of openTasks) {
      const key = taskDateKey(t);
      if (!key) continue;
      const arr = map.get(key) || [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  }, [openTasks]);

  const apptsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of activeAppointments) {
      const key = apptDateKey(a);
      const arr = map.get(key) || [];
      arr.push(a);
      map.set(key, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.start_time.localeCompare(b.start_time));
    return map;
  }, [activeAppointments]);

  const capacityRows = useMemo(() => {
    const map = new Map<string, { open: number; overdue: number; dueWeek: number }>();
    for (const t of openTasks) {
      const key = t.assigned_to || "Unassigned";
      const row = map.get(key) || { open: 0, overdue: 0, dueWeek: 0 };
      row.open += 1;
      if (isOverdue(t)) row.overdue += 1;
      if (isDueWeek(t)) row.dueWeek += 1;
      map.set(key, row);
    }
    return Array.from(map.entries())
      .map(([staff, counts]) => ({ staff, ...counts }))
      .sort((a, b) => b.open - a.open);
  }, [openTasks]);

  async function handleCancelAppointment(id: string) {
    const ok = await confirmDialog({ title: "Cancel appointment", message: "Cancel this appointment?" });
    if (!ok) return;
    try {
      await api.post(`/appointments/${id}/cancel`, {});
      loadAppointments();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not cancel this appointment.");
    }
  }
  async function handleDeleteAppointment(id: string) {
    const ok = await confirmDialog({ title: "Delete appointment", message: "This can't be undone.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.post(`/appointments/${id}/delete`, {});
      loadAppointments();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this appointment.");
    }
  }

  if (error) return <ErrorBanner error={error} />;
  if (!tasks) return <div className="spinner-wrap">Loading…</div>;

  const year = cursor.getFullYear(), month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = ymd(new Date());
  const cells: (Date | null)[] = [
    ...Array.from({ length: startWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedTasks = selectedDay ? (byDay.get(selectedDay) || []) : [];
  const selectedAppts = selectedDay ? (apptsByDay.get(selectedDay) || []) : [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Open tasks and appointments, in one place, plus who's carrying the most work.</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {view === "Calendar" && <button className="btn btn-sm btn-primary" onClick={() => setShowNewAppt(true)}>+ New Appointment</button>}
          {VIEWS.filter((v) => v !== "Settings" || isAdmin).map((v) => (
            <button key={v} className={`btn btn-sm ${view === v ? "btn-primary" : ""}`} onClick={() => setView(v)}>{v}</button>
          ))}
        </div>
      </div>

      {view === "Calendar" && (
        <>
          <LiveAppointmentClock />

          <div className="card" style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px" }}>
            <button className="btn btn-sm" onClick={() => { setCursor(new Date(year, month - 1, 1)); setSelectedDay(null); }}>← Prev</button>
            <div style={{ fontWeight: 700 }}>{firstOfMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-sm" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); setSelectedDay(null); }}>Today</button>
              <button className="btn btn-sm" onClick={() => { setCursor(new Date(year, month + 1, 1)); setSelectedDay(null); }}>Next →</button>
            </div>
          </div>

          <div className="card" style={{ padding: 12, marginBottom: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 6 }}>
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="muted" style={{ fontSize: 11, fontWeight: 700, textAlign: "center" }}>{d}</div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
              {cells.map((d, i) => {
                if (!d) return <div key={i} />;
                const key = ymd(d);
                const dayTasks = byDay.get(key) || [];
                const dayAppts = apptsByDay.get(key) || [];
                const overdueCount = dayTasks.filter(isOverdue).length;
                const isToday = key === todayKey;
                const isSelected = key === selectedDay;
                const hasContent = dayTasks.length > 0 || dayAppts.length > 0;
                return (
                  <div
                    key={i}
                    onClick={() => setSelectedDay(key)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedDay(key); } }}
                    style={{
                      position: "relative", minHeight: 64, borderRadius: 8, padding: 6, cursor: "pointer",
                      border: isSelected ? "2px solid var(--teal)" : isToday ? "1px solid var(--teal)" : "1px solid var(--line)",
                      background: hasContent ? "var(--surface-2, #f8fafc)" : "transparent",
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: isToday ? 800 : 500, color: isToday ? "var(--teal)" : undefined }}>{d.getDate()}</div>
                    <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                      {dayTasks.length > 0 && (
                        <span className={`status-pill ${overdueCount > 0 ? "status-red" : "status-blue"}`} style={{ fontSize: 10 }}>
                          {dayTasks.length} due{overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}
                        </span>
                      )}
                      {/* One small chip per appointment (not an aggregate count) so each
                          can be hovered for a detail preview and clicked straight into its
                          own edit view — capped at 2 visible + overflow, since day cells are
                          only 64px tall and a busy day can easily have 5+ appointments. */}
                      {dayAppts.slice(0, 2).map((a) => {
                        const done = a.status !== "Scheduled";
                        const isHovered = hoveredApptId === a.appointment_id;
                        return (
                          <div
                            key={a.appointment_id}
                            onMouseEnter={() => setHoveredApptId(a.appointment_id)}
                            onMouseLeave={() => setHoveredApptId((id) => (id === a.appointment_id ? null : id))}
                            onClick={(e) => { e.stopPropagation(); setEditingAppt(a); }}
                            style={{
                              position: "relative", fontSize: 10, lineHeight: "14px", padding: "1px 5px", borderRadius: 4,
                              background: done ? "var(--green-soft)" : "var(--purple-soft)", color: done ? "var(--green)" : "var(--purple)",
                              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                            }}
                          >
                            {fmtApptTime(a)} {a.client_name || a.contact_name || a.title}
                            {isHovered && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 20, width: 220,
                                  background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8,
                                  boxShadow: "var(--shadow)", padding: "10px 12px", whiteSpace: "normal", color: "var(--ink)", cursor: "default",
                                }}
                              >
                                <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>{a.appointment_type_name || a.title}</div>
                                <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
                                  {fmtApptTime(a)} – {new Date(a.end_time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                                </div>
                                {(a.client_name || a.contact_name) && <div style={{ fontSize: 11, marginBottom: 2 }}><strong>With:</strong> {a.client_name || a.contact_name}</div>}
                                {a.assigned_to && <div style={{ fontSize: 11, marginBottom: 2 }}><strong>Assigned:</strong> {a.assigned_to}</div>}
                                {a.location && <div style={{ fontSize: 11, marginBottom: 2 }}><strong>Location:</strong> {a.location}</div>}
                                <div style={{ marginTop: 2, marginBottom: a.notes ? 4 : 0 }}><StatusBadge status={a.status} /></div>
                                {a.notes && <div className="muted" style={{ fontSize: 10.5 }}>{a.notes}</div>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {dayAppts.length > 2 && (
                        <span className="muted" style={{ fontSize: 10 }}>+{dayAppts.length - 2} more</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedDay && (
            <div className="command-panel">
              <div className="command-panel-header">
                <h2 className="command-panel-title">{new Date(`${selectedDay}T00:00:00`).toLocaleDateString()}</h2>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-sm btn-primary" onClick={() => setShowNewAppt(true)}>+ Appointment</button>
                  <button className="btn btn-sm" onClick={() => setSelectedDay(null)}>Close</button>
                </div>
              </div>

              {selectedAppts.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Appointments</div>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead><tr><th scope="col">Time</th><th scope="col">Title</th><th scope="col">With</th><th scope="col">Assigned</th><th scope="col">Status</th><th scope="col">Timing</th><th scope="col"></th></tr></thead>
                      <tbody>
                        {selectedAppts.map((a) => (
                          // Whole row opens the same edit/detail view as the "Edit" button —
                          // previously only that small button was clickable, unlike the Tasks
                          // Due table just below, whose entire row already opens its detail
                          // page. The action buttons stop propagation so clicking one of them
                          // still just does its own thing instead of also opening Edit.
                          <tr
                            key={a.appointment_id}
                            style={{ cursor: "pointer" }}
                            tabIndex={0}
                            onClick={() => setEditingAppt(a)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditingAppt(a); } }}
                          >
                            <td>{fmtApptTime(a)}</td>
                            <td>{a.title}</td>
                            <td>{a.client_name || a.contact_name || "—"}</td>
                            <td>{a.assigned_to || "—"}</td>
                            <td><StatusBadge status={a.status} /></td>
                            <td><AppointmentTimingBadge appt={a} /></td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <div style={{ display: "flex", gap: 4 }}>
                                {a.status === "Scheduled" && <button className="btn btn-sm" onClick={() => setEditingAppt(a)}>Edit</button>}
                                {a.status === "Scheduled" && <button className="btn btn-sm" onClick={() => handleCancelAppointment(a.appointment_id)}>Cancel</button>}
                                {isAdmin && <button className="btn btn-sm" onClick={() => handleDeleteAppointment(a.appointment_id)}>Delete</button>}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {selectedTasks.length > 0 && (
                <div>
                  <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Tasks Due</div>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead><tr><th scope="col">Client</th><th scope="col">Task</th><th scope="col">Owner</th><th scope="col">Status</th></tr></thead>
                      <tbody>
                        {selectedTasks.map((t) => (
                          <tr key={t.task_id} style={{ cursor: "pointer" }} tabIndex={0} onClick={() => navigate(`/tasks/${t.task_id}`)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/tasks/${t.task_id}`); } }}>
                            <td>{t.client_name}</td>
                            <td>{t.task_name}</td>
                            <td>{t.assigned_to || "Unassigned"}</td>
                            <td><StatusBadge status={t.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {!selectedAppts.length && !selectedTasks.length && (
                <p className="muted" style={{ padding: "8px 0" }}>Nothing scheduled this day.</p>
              )}
            </div>
          )}
        </>
      )}

      {view === "Capacity" && (
        <div className="command-panel">
          <div className="command-panel-header">
            <h2 className="command-panel-title">Staff Capacity</h2>
            <div className="command-panel-note">Open tasks by owner, as of today.</div>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Staff</th>
                  <th scope="col" style={{ textAlign: "right" }}>Open Tasks</th>
                  <th scope="col" style={{ textAlign: "right" }}>Overdue</th>
                  <th scope="col" style={{ textAlign: "right" }}>Due This Week</th>
                </tr>
              </thead>
              <tbody>
                {capacityRows.map((r) => (
                  <tr key={r.staff}>
                    <td>{r.staff}</td>
                    <td style={{ textAlign: "right" }}>{r.open}</td>
                    <td style={{ textAlign: "right", color: r.overdue > 0 ? "var(--red)" : undefined, fontWeight: r.overdue > 0 ? 700 : 400 }}>{r.overdue}</td>
                    <td style={{ textAlign: "right" }}>{r.dueWeek}</td>
                  </tr>
                ))}
                {!capacityRows.length && (
                  <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 24 }}>No open tasks.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "Settings" && isAdmin && <CalendarSettingsPanel onClose={() => setView("Calendar")} />}

      {showNewAppt && (
        <NewAppointmentModal
          clients={clients}
          defaultDate={selectedDay || undefined}
          onClose={() => setShowNewAppt(false)}
          onDone={loadAppointments}
        />
      )}
      {editingAppt && (
        <NewAppointmentModal
          clients={clients}
          appointment={editingAppt}
          onClose={() => setEditingAppt(null)}
          onDone={loadAppointments}
        />
      )}
    </div>
  );
}
