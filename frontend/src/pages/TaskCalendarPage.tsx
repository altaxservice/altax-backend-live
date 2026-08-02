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

export function TaskCalendarPage() {
  const navigate = useNavigate();
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
    if (!confirm("Cancel this appointment?")) return;
    try {
      await api.post(`/appointments/${id}/cancel`, {});
      loadAppointments();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not cancel this appointment.");
    }
  }
  async function handleDeleteAppointment(id: string) {
    if (!confirm("Delete this appointment? This can't be undone.")) return;
    try {
      await api.post(`/appointments/${id}/delete`, {});
      loadAppointments();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not delete this appointment.");
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
          <div className="card" style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px" }}>
            <button className="btn btn-sm" onClick={() => setCursor(new Date(year, month - 1, 1))}>← Prev</button>
            <div style={{ fontWeight: 700 }}>{firstOfMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-sm" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }}>Today</button>
              <button className="btn btn-sm" onClick={() => setCursor(new Date(year, month + 1, 1))}>Next →</button>
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
                    onClick={() => setSelectedDay(hasContent ? key : key)}
                    style={{
                      minHeight: 64, borderRadius: 8, padding: 6, cursor: "pointer",
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
                      {dayAppts.length > 0 && (
                        <span className="status-pill" style={{ fontSize: 10, background: "var(--purple-bg, #ede9fe)", color: "var(--purple, #6d28d9)" }}>
                          {dayAppts.length} appt{dayAppts.length === 1 ? "" : "s"}
                        </span>
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
                      <thead><tr><th>Time</th><th>Title</th><th>With</th><th>Assigned</th><th>Status</th><th></th></tr></thead>
                      <tbody>
                        {selectedAppts.map((a) => (
                          <tr key={a.appointment_id}>
                            <td>{fmtApptTime(a)}</td>
                            <td>{a.title}</td>
                            <td>{a.client_name || a.contact_name || "—"}</td>
                            <td>{a.assigned_to || "—"}</td>
                            <td><StatusBadge status={a.status} /></td>
                            <td>
                              <div style={{ display: "flex", gap: 4 }}>
                                {a.status === "Scheduled" && <button className="btn btn-sm" onClick={() => handleCancelAppointment(a.appointment_id)}>Cancel</button>}
                                <button className="btn btn-sm" onClick={() => handleDeleteAppointment(a.appointment_id)}>Delete</button>
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
                      <thead><tr><th>Client</th><th>Task</th><th>Owner</th><th>Status</th></tr></thead>
                      <tbody>
                        {selectedTasks.map((t) => (
                          <tr key={t.task_id} style={{ cursor: "pointer" }} onClick={() => navigate(`/tasks/${t.task_id}`)}>
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
                  <th>Staff</th>
                  <th style={{ textAlign: "right" }}>Open Tasks</th>
                  <th style={{ textAlign: "right" }}>Overdue</th>
                  <th style={{ textAlign: "right" }}>Due This Week</th>
                </tr>
              </thead>
              <tbody>
                {capacityRows.map((r) => (
                  <tr key={r.staff}>
                    <td>{r.staff}</td>
                    <td style={{ textAlign: "right" }}>{r.open}</td>
                    <td style={{ textAlign: "right", color: r.overdue > 0 ? "var(--red, #b91c1c)" : undefined, fontWeight: r.overdue > 0 ? 700 : 400 }}>{r.overdue}</td>
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

      {view === "Settings" && isAdmin && <CalendarSettingsPanel />}

      {showNewAppt && (
        <NewAppointmentModal
          clients={clients}
          defaultDate={selectedDay || undefined}
          onClose={() => setShowNewAppt(false)}
          onDone={loadAppointments}
        />
      )}
    </div>
  );
}
