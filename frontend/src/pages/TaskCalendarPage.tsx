import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Task } from "../api/types";
import { ErrorBanner } from "../components/ErrorBanner";
import { StatusBadge } from "../components/StatusBadge";
import { isOpenTask, isOverdue, isDueWeek } from "../components/TaskCells";

/**
 * Practice Management: calendar + staff capacity — two read-side views over the
 * same task list Tasks already loads (GET /tasks: admin gets every task, staff
 * gets their own), so no new backend route is needed. Calendar plots each open
 * task on its agency_due_date; Capacity groups by the raw assigned_to string,
 * matching TasksListPage.tsx's own staffLoadCounts (no alias resolution there
 * either — this stays consistent with that existing behavior).
 */
const VIEWS = ["Calendar", "Capacity"] as const;
type View = (typeof VIEWS)[number];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function taskDateKey(t: Task): string | null {
  if (!t.agency_due_date) return null;
  return String(t.agency_due_date).slice(0, 10);
}

export function TaskCalendarPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("Calendar");
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ tasks: Task[] }>("/tasks")
      .then((res) => setTasks(res.tasks))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load tasks."));
  }, []);

  const openTasks = useMemo(() => (tasks || []).filter(isOpenTask), [tasks]);

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

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Calendar</h1>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Open tasks plotted by due date, and who's carrying the most work.</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {VIEWS.map((v) => (
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
                const overdueCount = dayTasks.filter(isOverdue).length;
                const isToday = key === todayKey;
                const isSelected = key === selectedDay;
                return (
                  <div
                    key={i}
                    onClick={() => setSelectedDay(dayTasks.length ? key : null)}
                    style={{
                      minHeight: 64, borderRadius: 8, padding: 6, cursor: dayTasks.length ? "pointer" : "default",
                      border: isSelected ? "2px solid var(--teal)" : isToday ? "1px solid var(--teal)" : "1px solid var(--line)",
                      background: dayTasks.length ? "var(--surface-2, #f8fafc)" : "transparent",
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: isToday ? 800 : 500, color: isToday ? "var(--teal)" : undefined }}>{d.getDate()}</div>
                    {dayTasks.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <span className={`status-pill ${overdueCount > 0 ? "status-red" : "status-blue"}`} style={{ fontSize: 10 }}>
                          {dayTasks.length} due{overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {selectedDay && (
            <div className="command-panel">
              <div className="command-panel-header">
                <h2 className="command-panel-title">Due {new Date(`${selectedDay}T00:00:00`).toLocaleDateString()}</h2>
                <button className="btn btn-sm" onClick={() => setSelectedDay(null)}>Close</button>
              </div>
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
    </div>
  );
}
