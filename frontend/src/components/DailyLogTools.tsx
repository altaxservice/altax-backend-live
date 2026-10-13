import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock, Sparkles, Users, Zap } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { Client } from "../api/types";
import { DateInput } from "./DateInput";
import { exportCsv } from "./FilterBar";
import { useToast } from "./Toast";

export interface LogLite { authorEmail: string; clientId: string | null; clientName: string | null; loggedAt: string; timeSpentMinutes: number | null }

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtMins = (m: number) => { const h = Math.floor(m / 60), r = m % 60; return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`; };

/** Four numbers that answer "how is my logging going": time today, entries today, clients touched, time this week — plus time per client for the week. */
export interface DraftedToday { mins: number; clients: number; entries: number; clientIds: string[] }
export function DayStats({ logs, me, drafted }: { logs: LogLite[]; me: string; drafted?: DraftedToday | null }) {
  const stats = useMemo(() => {
    const mine = logs.filter((l) => l.authorEmail.toLowerCase() === me);
    const today = dayKey(new Date());
    const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - 6);
    const todays = mine.filter((l) => dayKey(new Date(l.loggedAt)) === today);
    const week = mine.filter((l) => new Date(l.loggedAt) >= weekStart);
    const byClient = new Map<string, number>();
    for (const l of week) { const k = l.clientName || "General / internal"; byClient.set(k, (byClient.get(k) || 0) + (l.timeSpentMinutes || 0)); }
    return {
      todayMins: todays.reduce((s, l) => s + (l.timeSpentMinutes || 0), 0), todayCount: todays.length,
      todayClients: new Set(todays.map((l) => l.clientId).filter(Boolean)).size,
      weekMins: week.reduce((s, l) => s + (l.timeSpentMinutes || 0), 0), weekCount: week.length,
      top: Array.from(byClient, ([name, mins]) => ({ name, mins })).filter((x) => x.mins > 0).sort((a, b) => b.mins - a.mins).slice(0, 5),
    };
  }, [logs, me]);
  const max = Math.max(1, ...stats.top.map((t) => t.mins));
  // Work the app has already drafted for today (not saved yet) counts too — otherwise the boxes read 0 until you press Save.
  const d = drafted || { mins: 0, clients: 0, entries: 0, clientIds: [] };
  const savedClientIds = new Set(logs.filter((l) => l.authorEmail.toLowerCase() === me && dayKey(new Date(l.loggedAt)) === dayKey(new Date())).map((l) => l.clientId).filter(Boolean) as string[]);
  const clientsToday = new Set([...savedClientIds, ...d.clientIds]).size;
  const draftNote = (saved: string) => (d.entries > 0 ? `${saved} · ${d.entries} drafted, not saved yet` : saved);
  const tile = (Icon: typeof Clock, label: string, value: string, note: string) => (
    <div className="card" style={{ padding: "12px 16px", display: "flex", gap: 12, alignItems: "center" }}>
      <span className="act-icon act-tone-teal"><Icon size={18} aria-hidden="true" /></span>
      <div><div className="muted" style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div><div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>{value}</div><div className="muted" style={{ fontSize: 12 }}>{note}</div></div>
    </div>
  );
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
        {tile(Clock, "Time logged today", fmtMins(stats.todayMins + d.mins), draftNote(`${stats.todayCount} saved`))}
        {tile(Users, "Clients today", String(clientsToday), "worked on")}
        {tile(Zap, "Last 7 days", fmtMins(stats.weekMins + d.mins), draftNote(`${stats.weekCount} saved`))}
      </div>
      {stats.top.length > 0 && (
        <div className="card" style={{ marginTop: 12, padding: "12px 16px" }}>
          <div className="muted" style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Where your time went — last 7 days</div>
          {stats.top.map((t) => (
            <div key={t.name} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 220px) 1fr 60px", gap: 10, alignItems: "center", margin: "4px 0", fontSize: 13 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
              <span style={{ background: "var(--surface)", borderRadius: 4, height: 10, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${(t.mins / max) * 100}%`, background: "var(--teal)" }} /></span>
              <span className="muted" style={{ textAlign: "right" }}>{fmtMins(t.mins)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Draft { clientId: string; clientName: string; count: number; lines: string[]; firstAt: string; lastAt: string; suggestedMinutes: number }
interface Edit { body: string; minutes: string; checked: boolean }

/**
 * "Your day, drafted": everything the app already recorded under your name for a day, grouped per client in plain
 * English with an estimated time, ready to save into the log in one click. Review, tweak, save — no writing from memory.
 */
export function AutoDraftPanel({ onSaved, onDraftChange }: { onSaved: () => void; onDraftChange?: (d: DraftedToday | null) => void }) {
  const toast = useToast();
  const [date, setDate] = useState(() => dayKey(new Date()));
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prevDrafts = useRef<Map<string, Draft>>(new Map());
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  /** keep=true refreshes in place: new work is added and untouched rows are updated, but anything you already edited stays as you left it. */
  function load(d = date, keep = false) {
    if (keep) setRefreshing(true); else setDrafts(null);
    api.get<{ drafts: Draft[] }>(`/daily-log/auto-draft?date=${d}`)
      .then((r) => {
        r.drafts.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()); // latest activity on top
        setDrafts(r.drafts);
        const autoBody = (x: Draft) => x.lines.map((l) => `• ${l}`).join("\n");
        setEdits((cur) => {
          const next: Record<string, Edit> = {};
          for (const x of r.drafts) {
            const old = keep ? cur[x.clientId] : undefined;
            const was = prevDrafts.current.get(x.clientId);
            const untouched = old && was && old.body === autoBody(was) && old.minutes === String(was.suggestedMinutes);
            next[x.clientId] = old && !untouched ? old : { body: autoBody(x), minutes: String(x.suggestedMinutes), checked: old ? old.checked : true };
          }
          return next;
        });
        prevDrafts.current = new Map(r.drafts.map((x) => [x.clientId, x]));
        setUpdatedAt(new Date());
        setError(null);
      })
      .catch((err) => { setError(err instanceof ApiError ? err.message : "Could not build today's draft."); if (!keep) setDrafts([]); })
      .finally(() => setRefreshing(false));
  }
  useEffect(() => { load(date); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [date]);
  // The draft is built from what you've done so far, so a page left open goes stale: refresh when you come back to the tab and every couple of minutes.
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible" && !saving) load(date, true); };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    const t = window.setInterval(again, 120000);
    return () => { document.removeEventListener("visibilitychange", again); window.removeEventListener("focus", again); window.clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, saving]);

  const picked = (drafts || []).filter((d) => edits[d.clientId]?.checked);
  useEffect(() => {
    if (!onDraftChange) return;
    if (!drafts || date !== dayKey(new Date())) { onDraftChange(null); return; }
    onDraftChange({ mins: picked.reduce((t, d) => t + (Number(edits[d.clientId]?.minutes) || 0), 0), clients: picked.length, entries: picked.length, clientIds: picked.map((d) => d.clientId) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, edits, date]);
  async function saveAll() {
    setSaving(true); setError(null);
    try {
      for (const d of picked) {
        const e = edits[d.clientId];
        await api.post("/daily-log", { clientIds: [d.clientId], body: e.body.trim() || d.lines.join("; "), category: "Auto-logged", timeSpentMinutes: Number(e.minutes) || 0, loggedAt: d.lastAt });
      }
      toast(`Saved ${picked.length} log entr${picked.length === 1 ? "y" : "ies"}.`);
      onSaved();
      load(date, true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the log entries.");
    } finally { setSaving(false); }
  }
  const setEdit = (id: string, patch: Partial<Edit>) => setEdits((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86400000));

  return (
    <div className="command-panel" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <div>
          <h2 className="command-panel-title" style={{ display: "flex", alignItems: "center", gap: 8 }}><Sparkles size={17} aria-hidden="true" /> Your day, drafted for you</h2>
          <div className="command-panel-note">Built automatically from what you did in the app — review, adjust the time, and save.</div>
        </div>
      </div>
      <div style={{ padding: "12px 16px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid var(--line)" }}>
        <button type="button" className={`tpl-chip${date === today ? " on" : ""}`} onClick={() => setDate(today)}>Today</button>
        <button type="button" className={`tpl-chip${date === yesterday ? " on" : ""}`} onClick={() => setDate(yesterday)}>Yesterday</button>
        <div style={{ width: 150 }}><DateInput value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Pick a day" /></div>
        <button type="button" className="btn btn-sm" disabled={refreshing || saving} onClick={() => load(date, true)}>{refreshing ? "Refreshing…" : "Refresh"}</button>
        {updatedAt && <span className="muted" style={{ fontSize: 12 }}>Updated {updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
        <button type="button" className="btn btn-primary" style={{ marginLeft: "auto" }} disabled={saving || picked.length === 0} onClick={saveAll}>
          {saving ? "Saving…" : `Save ${picked.length} to my log`}
        </button>
      </div>
      {error && <p style={{ color: "var(--red)", padding: "8px 16px", margin: 0, fontSize: 13 }}>{error}</p>}
      {date === today && picked.length > 0 && new Date().getHours() >= 17 && (
        <div style={{ padding: "10px 16px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", background: "var(--amber-soft, #fff7e0)", borderBottom: "1px solid var(--line)" }}>
          <span style={{ fontSize: 13 }}><b>End of the day.</b> {picked.length} client{picked.length === 1 ? "" : "s"} of today's work {picked.length === 1 ? "isn't" : "aren't"} saved to your log yet.</span>
          <button type="button" className="btn btn-sm btn-primary" disabled={saving} onClick={saveAll}>{saving ? "Saving…" : "Save all now"}</button>
        </div>
      )}
      {!drafts && <div className="spinner-wrap">Looking at your day…</div>}
      {drafts && drafts.length === 0 && (
        <p className="muted" style={{ padding: 20, textAlign: "center", margin: 0 }}><CheckCircle2 size={16} aria-hidden="true" style={{ verticalAlign: "-3px", color: "var(--green)" }} /> Nothing new to log for this day — you're all caught up.</p>
      )}
      {drafts && drafts.length > 0 && (
        <div style={{ padding: 12, display: "grid", gap: 10 }}>
          {drafts.map((d) => {
            const e = edits[d.clientId];
            if (!e) return null;
            return (
              <div key={d.clientId} className="card" style={{ padding: "10px 14px", opacity: e.checked ? 1 : 0.55 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <input type="checkbox" checked={e.checked} onChange={(ev) => setEdit(d.clientId, { checked: ev.target.checked })} aria-label={`Include ${d.clientName}`} />
                  <strong style={{ fontSize: 14 }}>{d.clientName}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>{d.count} action{d.count === 1 ? "" : "s"} · {new Date(d.firstAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}{d.firstAt !== d.lastAt ? `–${new Date(d.lastAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}</span>
                  <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                    Minutes <input type="number" min={0} step={5} value={e.minutes} onChange={(ev) => setEdit(d.clientId, { minutes: ev.target.value })} style={{ width: 72, padding: "4px 6px" }} />
                  </label>
                </div>
                <textarea rows={Math.min(6, Math.max(2, d.lines.length))} value={e.body} onChange={(ev) => setEdit(d.clientId, { body: ev.target.value })} style={{ width: "100%", marginTop: 8, fontSize: 13 }} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One-line quick add: client, what you did, minutes — Enter to save. Replaces opening a form for the common case. */
export function QuickAddBar({ clients, onSaved }: { clients: Client[]; onSaved: () => void }) {
  const toast = useToast();
  const [clientId, setClientId] = useState("");
  const [text, setText] = useState("");
  const [mins, setMins] = useState("");
  const [saving, setSaving] = useState(false);
  async function add() {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await api.post("/daily-log", { clientIds: clientId ? [clientId] : [], body: text.trim(), timeSpentMinutes: Number(mins) || 0 });
      setText(""); setMins(""); toast("Logged."); onSaved();
    } catch (err) { toast(err instanceof ApiError ? err.message : "Could not save."); } finally { setSaving(false); }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void add(); }} style={{ display: "grid", gridTemplateColumns: "minmax(150px, 240px) minmax(220px, 1fr) 90px auto", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--line)", alignItems: "center" }}>
      <select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client"><option value="">General / internal</option>{clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}</select>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="What did you just do?  (press Enter to log)" aria-label="What you did" />
      <input type="number" min={0} step={5} value={mins} onChange={(e) => setMins(e.target.value)} placeholder="Min" aria-label="Minutes" />
      <button type="submit" className="btn btn-primary" disabled={saving || !text.trim()}>Log</button>
    </form>
  );
}


interface TeamPerson {
  email: string; name: string; role: string; savedEntries: number; savedMinutes: number; savedClients: number;
  unsavedClients: number; unsavedActions: number; unsavedMinutes: number; unsavedClientNames: string[]; lastActivity: string | null;
  timeTrackingMinutes?: number; timeMismatch?: boolean;
}

/** Admin only: what each person on the team did on a day — saved log entries, work the app recorded that they haven't saved yet, and when they were last active. */
export function TeamTodayPanel() {
  const [date, setDate] = useState(() => dayKey(new Date()));
  const [people, setPeople] = useState<TeamPerson[] | null>(null);
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);

  function load(d = date) {
    setLoading(true);
    api.get<{ people: TeamPerson[] }>(`/daily-log/team?date=${d}`).then((r) => setPeople(r.people)).catch(() => setPeople([])).finally(() => setLoading(false));
  }
  useEffect(() => { load(date); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [date]);
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible") load(date); };
    document.addEventListener("visibilitychange", again);
    const t = window.setInterval(again, 180000);
    return () => { document.removeEventListener("visibilitychange", again); window.clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86400000));
  const active = (people || []).filter((p) => p.savedEntries + p.unsavedActions > 0);
  const idle = (people || []).filter((p) => p.savedEntries + p.unsavedActions === 0);
  return (
    <div className="command-panel" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <div>
          <h2 className="command-panel-title" style={{ display: "flex", alignItems: "center", gap: 8 }}><Users size={17} aria-hidden="true" /> Team today</h2>
          <div className="command-panel-note">What each person did — saved log entries, plus work recorded in the app that isn't saved to their log yet. Only you see this.</div>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Show"}</button>
      </div>
      {open && (
        <>
          <ReminderSwitch />
          <div style={{ padding: "10px 16px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid var(--line)" }}>
            <button type="button" className={`tpl-chip${date === today ? " on" : ""}`} onClick={() => setDate(today)}>Today</button>
            <button type="button" className={`tpl-chip${date === yesterday ? " on" : ""}`} onClick={() => setDate(yesterday)}>Yesterday</button>
            <div style={{ width: 150 }}><DateInput value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Pick a day" /></div>
            <button type="button" className="btn btn-sm" disabled={loading} onClick={() => load(date)}>{loading ? "Refreshing…" : "Refresh"}</button>
          </div>
          {!people && <div className="spinner-wrap">Loading the team…</div>}
          {people && active.length === 0 && <p className="muted" style={{ padding: 16, margin: 0 }}>No recorded activity for this day.</p>}
          {active.length > 0 && (
            <div className="table-scroll">
              <table>
                <thead><tr><th scope="col">Person</th><th scope="col">Saved to log</th><th scope="col">Not saved yet</th><th scope="col">Time Tracking</th><th scope="col">Last activity</th></tr></thead>
                <tbody>
                  {active.map((p) => (
                    <tr key={p.email}>
                      <td><strong>{p.name}</strong><div className="muted" style={{ fontSize: 11.5 }}>{p.role === "admin" ? "Admin" : "Staff"}</div></td>
                      <td>{p.savedEntries > 0 ? <>{p.savedEntries} entr{p.savedEntries === 1 ? "y" : "ies"} · {p.savedClients} client{p.savedClients === 1 ? "" : "s"}{p.savedMinutes ? ` · ${fmtMins(p.savedMinutes)}` : ""}</> : <span className="muted">—</span>}</td>
                      <td>{p.unsavedActions > 0 ? <><b>{p.unsavedActions}</b> action{p.unsavedActions === 1 ? "" : "s"} on {p.unsavedClients} client{p.unsavedClients === 1 ? "" : "s"} · ~{fmtMins(p.unsavedMinutes)}<div className="muted" style={{ fontSize: 11.5 }}>{p.unsavedClientNames.join(", ")}{p.unsavedClients > p.unsavedClientNames.length ? "…" : ""}</div></> : <span className="muted">All saved</span>}</td>
                      <td>{p.timeTrackingMinutes ? fmtMins(p.timeTrackingMinutes) : <span className="muted">—</span>}{p.timeMismatch && <div style={{ fontSize: 11.5, color: "var(--red)", fontWeight: 700 }} title="Saved log time and Time Tracking differ by an hour or more (over 40%)">⚠ Doesn't match the log ({fmtMins(p.savedMinutes)})</div>}</td>
                      <td>{p.lastActivity ? new Date(p.lastActivity).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {idle.length > 0 && <p className="muted" style={{ padding: "8px 16px 12px", margin: 0, fontSize: 12.5 }}>No activity: {idle.map((p) => p.name).join(", ")}.</p>}
        </>
      )}
    </div>
  );
}


/** Master switch (default OFF) for the 5:30 PM weekday email that tells staff when recorded work isn't saved to their Daily Log yet. */
function ReminderSwitch() {
  const toast = useToast();
  const [st, setSt] = useState<{ enabled: boolean; staffCount: number; sendTime: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get<{ enabled: boolean; staffCount: number; sendTime: string }>("/daily-log/reminder-settings").then(setSt).catch(() => setSt(null)); }, []);
  if (!st) return null;
  async function toggle(v: boolean) {
    setBusy(true);
    try { await api.put("/daily-log/reminder-settings", { enabled: v }); setSt({ ...st!, enabled: v }); toast(v ? "Daily Log reminder is ON." : "Daily Log reminder is OFF."); }
    catch (err) { toast(err instanceof ApiError ? err.message : "Could not change the reminder."); }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true);
    try { const r = await api.post<{ sentTo: string; usedSample: boolean }>("/daily-log/reminder-test", {}); toast(`Test sent to ${r.sentTo}${r.usedSample ? " (sample data — you have nothing unsaved)" : ""}.`); }
    catch (err) { toast(err instanceof ApiError ? err.message : "Could not send the test."); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ padding: "10px 16px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid var(--line)", background: "var(--surface)" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={st.enabled} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
        <span><b>Email staff a reminder</b> when work is recorded but not saved to their log — {st.sendTime} ({st.staffCount} staff)</span>
      </label>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={test}>Send me a test</button>
    </div>
  );
}

interface WeeklyClientRow { clientId: string | null; clientName: string; logMinutes: number; entries: number; ttMinutes: number; mismatch: boolean }
interface WeeklyPerson { email: string; name: string; role: string; logMinutes: number; logEntries: number; ttMinutes: number; billableHours: number; billableAmount: number; billedAmount: number; mismatch: boolean; clients: WeeklyClientRow[] }
const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const mondayOf = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

/** Admin only: hours by person and client for a week (Mon–Sun) from saved Daily Log entries, beside Time Tracking hours and billable/billed amounts. */
export function WeeklyTotalsPanel() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const from = dayKey(weekStart);
  const to = dayKey(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6));
  const [people, setPeople] = useState<WeeklyPerson[] | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPeople(null);
    api.get<{ people: WeeklyPerson[] }>(`/daily-log/weekly-report?from=${from}&to=${to}`).then((r) => setPeople(r.people)).catch(() => setPeople([]));
  }, [open, from, to]);

  const shift = (weeks: number) => setWeekStart(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + weeks * 7));
  function exportRows() {
    const rows: Record<string, unknown>[] = [];
    for (const p of people || []) for (const c of p.clients) rows.push({ person: p.name, client: c.clientName, logHours: (c.logMinutes / 60).toFixed(2), entries: c.entries, ttHours: (c.ttMinutes / 60).toFixed(2), flag: c.mismatch ? "differs" : "" });
    exportCsv(`daily-log-week-${from}.csv`, [
      { key: "person", label: "Person" }, { key: "client", label: "Client" }, { key: "logHours", label: "Daily Log hours" }, { key: "entries", label: "Log entries" },
      { key: "ttHours", label: "Time Tracking hours" }, { key: "flag", label: "Log vs Time Tracking" },
    ], rows);
  }
  return (
    <div className="command-panel" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <div>
          <h2 className="command-panel-title" style={{ display: "flex", alignItems: "center", gap: 8 }}><Zap size={17} aria-hidden="true" /> Weekly totals</h2>
          <div className="command-panel-note">Hours by person and client from saved Daily Log entries, beside Time Tracking and what's billable — to compare what was done with what's billed.</div>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Show"}</button>
      </div>
      {open && (
        <>
          <div style={{ padding: "10px 16px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid var(--line)" }}>
            <button type="button" className="btn btn-sm" onClick={() => shift(-1)} aria-label="Previous week">‹</button>
            <b style={{ fontSize: 13 }}>{from} – {to}</b>
            <button type="button" className="btn btn-sm" onClick={() => shift(1)} aria-label="Next week">›</button>
            <button type="button" className="tpl-chip" onClick={() => setWeekStart(mondayOf(new Date()))}>This week</button>
            <button type="button" className="tpl-chip" onClick={() => setWeekStart(mondayOf(new Date(Date.now() - 7 * 86400000)))}>Last week</button>
            <button type="button" className="btn btn-sm" style={{ marginLeft: "auto" }} disabled={!people || people.length === 0} onClick={exportRows}>Export CSV</button>
          </div>
          {!people && <div className="spinner-wrap">Adding up the week…</div>}
          {people && people.length === 0 && <p className="muted" style={{ padding: 16, margin: 0 }}>No Daily Log or Time Tracking entries for this week.</p>}
          {people && people.length > 0 && (
            <div className="table-scroll">
              <table>
                <thead><tr><th scope="col">Person</th><th scope="col" style={{ textAlign: "right" }}>Daily Log</th><th scope="col" style={{ textAlign: "right" }}>Time Tracking</th><th scope="col" style={{ textAlign: "right" }}>Billable</th><th scope="col" style={{ textAlign: "right" }}>Billed</th><th scope="col"></th></tr></thead>
                <tbody>
                  {people.map((p) => (
                    <Fragment key={p.email}>
                      <tr>
                        <td><strong>{p.name}</strong><div className="muted" style={{ fontSize: 11.5 }}>{p.logEntries} entr{p.logEntries === 1 ? "y" : "ies"} · {p.clients.length} client{p.clients.length === 1 ? "" : "s"}</div></td>
                        <td style={{ textAlign: "right" }}>{fmtMins(p.logMinutes)}</td>
                        <td style={{ textAlign: "right" }}>{fmtMins(p.ttMinutes)}{p.mismatch && <div style={{ fontSize: 11.5, color: "var(--red)", fontWeight: 700 }}>⚠ differs</div>}</td>
                        <td style={{ textAlign: "right" }}>{p.billableHours ? `${p.billableHours}h · ${usd(p.billableAmount)}` : "—"}</td>
                        <td style={{ textAlign: "right" }}>{p.billedAmount ? usd(p.billedAmount) : "—"}</td>
                        <td><button type="button" className="btn btn-sm" onClick={() => setExpanded(expanded === p.email ? null : p.email)}>{expanded === p.email ? "Hide clients" : "By client"}</button></td>
                      </tr>
                      {expanded === p.email && p.clients.map((c) => (
                        <tr key={`${p.email}-${c.clientId || "g"}`} style={{ background: "var(--surface)" }}>
                          <td style={{ paddingLeft: 28 }} className="muted">{c.clientName}</td>
                          <td style={{ textAlign: "right" }}>{c.logMinutes ? fmtMins(c.logMinutes) : "—"}</td>
                          <td style={{ textAlign: "right" }}>{c.ttMinutes ? fmtMins(c.ttMinutes) : "—"}{c.mismatch && <span style={{ color: "var(--red)", fontWeight: 700 }}> ⚠</span>}</td>
                          <td colSpan={3}></td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
