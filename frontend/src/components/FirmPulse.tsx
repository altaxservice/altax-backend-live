import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarCheck, CalendarClock, ChevronDown, Radio, Users } from "lucide-react";
import { api } from "../api/client";
import { ago } from "./WorkTrail";
import { useStickyState } from "../utils/listState";

interface LastAction { label: string; detail: string | null; clientId: string | null; clientName: string | null; link: string | null; at: string }
interface TeamMember {
  userId: string; name: string; email: string; role: string; presence: "active" | "recent" | "today" | "away"; lastLogin: string | null;
  openTasks: number; overdueTasks: number; dueToday: number; appointmentsToday: number; hoursToday: number; logEntriesToday: number; logMinutesToday: number;
  lastAction: LastAction | null; lastClient: { clientId: string; clientName: string; at: string } | null;
}
interface ScheduleItem {
  id: string; title: string; clientId: string | null; clientName: string | null; startTime: string; endTime: string; location: string | null;
  assignedTo: string | null; assignedName: string | null; status: string; day: "today" | "later"; confirmed: boolean; confirmationRequested: boolean; confirmedAt: string | null;
}
interface FeedItem extends LastAction { by: string; byName: string; isClient: boolean }
interface Pulse {
  generatedAt: string; team: TeamMember[]; feed: FeedItem[];
  schedule: { today: number; confirmedToday: number; awaitingConfirmationToday: number; upcoming: number; cancelled: number; items: ScheduleItem[] };
}

const PRESENCE_LABEL: Record<TeamMember["presence"], string> = { active: "Active now", recent: "Active recently", today: "Active earlier today", away: "Away" };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });
const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${m}m`);

/**
 * The firm at a glance, pinned at the top of the admin Command Center: who is working and what they did last,
 * who is booked on the calendar and whether the client confirmed, and the firm-wide activity feed. Refreshes
 * every minute; everything is derived from activity the app already records.
 */
export function FirmPulse() {
  const navigate = useNavigate();
  const [data, setData] = useState<Pulse | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useStickyState<boolean>("cc.pulse.open", true);

  useEffect(() => {
    let cancelled = false;
    const load = () => api.get<Pulse>("/firm-pulse").then((r) => { if (!cancelled) { setData(r); setError(false); } }).catch(() => { if (!cancelled) setError(true); });
    load();
    const id = window.setInterval(load, 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const activeNow = data?.team.filter((m) => m.presence === "active").length || 0;
  const sched = data?.schedule;
  const grouped = (sched?.items || []).reduce<Record<string, ScheduleItem[]>>((acc, a) => {
    const key = dayLabel(a.startTime);
    (acc[key] ||= []).push(a);
    return acc;
  }, {});
  const todayKey = dayLabel(new Date().toISOString());

  return (
    <section className="fp" aria-label="Firm at a glance">
      <button type="button" className="fp-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="fp-title"><Radio size={16} aria-hidden="true" /> Firm at a glance</span>
        <span className="fp-summary">
          {data ? <>
            <b>{activeNow}</b> active now · <b>{sched!.today}</b> appointment{sched!.today === 1 ? "" : "s"} today
            {sched!.today > 0 ? <> (<b>{sched!.confirmedToday}</b> confirmed)</> : null}
          </> : error ? "Could not load" : "Loading…"}
        </span>
        <ChevronDown size={16} aria-hidden="true" className={`fp-chev${open ? " open" : ""}`} />
      </button>

      {open && data && (
        <div className="fp-grid">
          {/* ── Team ── */}
          <div className="fp-card">
            <h3><Users size={14} aria-hidden="true" /> Team — who is on what</h3>
            {data.team.map((m) => (
              <div className="fp-person" key={m.userId}>
                <div className="fp-avatar" aria-hidden="true">{initials(m.name)}<span className={`fp-dot ${m.presence}`} /></div>
                <div className="fp-person-main">
                  <div className="fp-person-top">
                    <button type="button" className="fp-name" onClick={() => navigate(`/tasks?staff=${encodeURIComponent(m.name)}`)}>{m.name}</button>
                    <span className={`fp-presence ${m.presence}`}>{PRESENCE_LABEL[m.presence]}</span>
                  </div>
                  {m.lastAction ? (
                    <div className="fp-line">
                      <span className="fp-k">Last</span>
                      <span className="fp-v">
                        {m.lastAction.link ? <button type="button" className="fp-link" onClick={() => navigate(m.lastAction!.link!)}>{m.lastAction.label}{m.lastAction.detail ? ` — ${m.lastAction.detail}` : ""}</button> : <span>{m.lastAction.label}{m.lastAction.detail ? ` — ${m.lastAction.detail}` : ""}</span>}
                        {m.lastAction.clientName ? <> · {m.lastAction.clientName}</> : null} · <span className="muted">{ago(m.lastAction.at)}</span>
                      </span>
                    </div>
                  ) : <div className="fp-line muted">No recorded activity in 30 days</div>}
                  {m.lastClient && (
                    <div className="fp-line">
                      <span className="fp-k">Left off</span>
                      <span className="fp-v"><button type="button" className="fp-link" onClick={() => navigate(`/clients/${m.lastClient!.clientId}`)}>{m.lastClient.clientName}</button> · <span className="muted">{ago(m.lastClient.at)}</span></span>
                    </div>
                  )}
                  <div className="fp-stats">
                    <span title="Open tasks assigned">{m.openTasks} open</span>
                    {m.overdueTasks > 0 && <span className="bad" title="Overdue tasks">{m.overdueTasks} overdue</span>}
                    {m.dueToday > 0 && <span className="warn">{m.dueToday} due today</span>}
                    {m.appointmentsToday > 0 && <span>{m.appointmentsToday} appt{m.appointmentsToday === 1 ? "" : "s"} today</span>}
                    {m.hoursToday > 0 && <span>{m.hoursToday}h tracked</span>}
                    {m.logEntriesToday > 0 && <span>{m.logEntriesToday} log{m.logEntriesToday === 1 ? "" : "s"}{m.logMinutesToday ? ` · ${fmtMinutes(m.logMinutesToday)}` : ""}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ── Schedule ── */}
          <div className="fp-card">
            <h3><CalendarClock size={14} aria-hidden="true" /> Schedule — today &amp; next 2 days</h3>
            <div className="fp-pills">
              <span className="fp-pill">{sched!.today} today</span>
              <span className="fp-pill green">{sched!.confirmedToday} confirmed</span>
              <span className={`fp-pill ${sched!.awaitingConfirmationToday ? "amber" : ""}`}>{sched!.awaitingConfirmationToday} awaiting</span>
              <span className="fp-pill">{sched!.upcoming} coming up</span>
              {sched!.cancelled > 0 && <span className="fp-pill red">{sched!.cancelled} cancelled</span>}
            </div>
            {Object.keys(grouped).length === 0 && <p className="muted" style={{ margin: "14px 0 4px" }}>Nothing booked in the next 2 days.</p>}
            {Object.entries(grouped).map(([day, items]) => (
              <div key={day}>
                <div className="fp-day">{day === todayKey ? `Today · ${day}` : day}</div>
                {items.map((a) => (
                  <button type="button" key={a.id} className={`fp-appt${a.status === "Cancelled" ? " cancelled" : ""}`} onClick={() => navigate("/calendar")}>
                    <span className="fp-time">{hhmm(a.startTime)}</span>
                    <span className="fp-appt-main">
                      <span className="fp-appt-title">{a.clientName || "No client"} <span className="muted">· {a.title}</span></span>
                      <span className="fp-appt-sub">{a.assignedName ? `With ${a.assignedName}` : "Unassigned"}{a.location ? ` · ${a.location}` : ""}</span>
                    </span>
                    {a.status === "Cancelled"
                      ? <span className="fp-badge red">Cancelled</span>
                      : a.confirmed
                        ? <span className="fp-badge green" title={a.confirmedAt ? `Confirmed ${ago(a.confirmedAt)}` : ""}><CalendarCheck size={11} aria-hidden="true" /> Confirmed</span>
                        : <span className="fp-badge amber">{a.confirmationRequested ? "Awaiting reply" : "Not confirmed"}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* ── Live feed ── */}
          <div className="fp-card">
            <h3><Radio size={14} aria-hidden="true" /> Live activity — whole firm</h3>
            {data.feed.length === 0 && <p className="muted" style={{ margin: "14px 0 4px" }}>No activity in the last 3 days.</p>}
            <ul className="fp-feed">
              {data.feed.slice(0, 14).map((f, i) => (
                <li key={i} className={f.isClient ? "client" : ""}>
                  <div>
                    {f.link ? <button type="button" className="fp-link" onClick={() => navigate(f.link!)}>{f.label}</button> : <span className="fp-strong">{f.label}</span>}
                    {f.detail ? <span className="muted"> — {f.detail}</span> : null}
                  </div>
                  <div className="fp-feed-sub">{f.clientName ? <>{f.clientName} · </> : null}{f.byName} · {ago(f.at)}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
