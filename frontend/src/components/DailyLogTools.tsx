import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock, Sparkles, Users, Zap } from "lucide-react";
import { api, ApiError } from "../api/client";
import type { Client } from "../api/types";
import { DateInput } from "./DateInput";
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
