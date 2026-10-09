import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export interface TrailEvent { at: string; by: string | null; kind: string; label: string; detail?: string; page?: "client" | "accounting"; tab?: string; count?: number }
export interface WorkTrailData { events: TrailEvent[]; sinceVisit: string | null; me: string }

/** Loads the automatic work trail for a client and records this visit (so "since you were last here" works next time). */
export function useWorkTrail(clientId: string | undefined, refreshKey?: unknown): WorkTrailData | null {
  const [data, setData] = useState<WorkTrailData | null>(null);
  useEffect(() => {
    if (!clientId) return;
    let live = true;
    // visit=1 only on the first load for this client in this page session; later refreshes don't move the "last visit" marker.
    api.get<WorkTrailData>(`/clients/${clientId}/work-trail?visit=1`)
      .then((r) => { if (live) setData(r); })
      .catch(() => { if (live) setData(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, refreshKey]);
  return data;
}

export function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function who(by: string | null, me: string): string {
  if (!by) return "";
  if (by.toLowerCase() === me) return "you";
  return by.includes("@") ? by.split("@")[0] : by;
}

function line(e: TrailEvent, me: string): string {
  const w = who(e.by, me);
  return `${e.label}${e.detail ? ` — ${e.detail}` : ""}${w ? ` · by ${w}` : ""} · ${ago(e.at)}`;
}

/** Top-of-page card: the latest things done on this client, with a divider where this staff member's previous visit ended. */
export function WorkTrailCard({ trail, onOpen }: { trail: WorkTrailData | null; onOpen: (e: TrailEvent) => void }) {
  const [open, setOpen] = useState(false);
  if (!trail || trail.events.length === 0) return null;
  const { events, sinceVisit, me } = trail;
  const shown = open ? events.slice(0, 15) : events.slice(0, 3);
  const newCount = sinceVisit ? events.filter((e) => new Date(e.at) > new Date(sinceVisit) && (e.by || "").toLowerCase() !== me).length : 0;
  let dividerShown = false;
  return (
    <div className="card" style={{ margin: "0 0 14px", padding: "10px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>Where you left off</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          {sinceVisit ? `Your last visit: ${new Date(sinceVisit).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "First visit recorded"}
          {newCount > 0 ? ` · ${newCount} change${newCount === 1 ? "" : "s"} by others since` : ""}
        </span>
      </div>
      <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, fontSize: 13 }}>
        {shown.map((e, i) => {
          const isNew = sinceVisit ? new Date(e.at) > new Date(sinceVisit) : false;
          const showDivider = sinceVisit && !dividerShown && !isNew;
          if (showDivider) dividerShown = true;
          return (
            <li key={`${e.at}-${i}`}>
              {showDivider && <div className="muted" style={{ fontSize: 11, margin: "4px 0", borderTop: "1px dashed var(--line)", paddingTop: 3 }}>— your previous visit ended here —</div>}
              <div style={{ padding: "2px 0", display: "flex", gap: 6, alignItems: "baseline" }}>
                <span style={{ color: isNew ? "var(--teal)" : "var(--muted)" }} aria-hidden="true">●</span>
                {e.tab ? (
                  <button type="button" className="link-button" style={{ textAlign: "left", fontSize: 13 }} onClick={() => onOpen(e)}>{line(e, me)}</button>
                ) : <span>{line(e, me)}</span>}
              </div>
            </li>
          );
        })}
      </ul>
      {events.length > 3 && (
        <button type="button" className="link-button" style={{ fontSize: 12, marginTop: 4 }} onClick={() => setOpen((o) => !o)}>{open ? "Show less" : `Show ${Math.min(events.length, 15) - 3} more`}</button>
      )}
    </div>
  );
}

/** One line at the top of a tab: the last thing done on this page. Renders nothing when nothing has happened there. */
export function LastDoneHere({ trail, page, tab }: { trail: WorkTrailData | null; page: "client" | "accounting"; tab: string }) {
  if (!trail) return null;
  const e = trail.events.find((x) => x.page === page && x.tab === tab);
  if (!e) return null;
  return (
    <div className="muted" style={{ fontSize: 12.5, margin: "0 0 10px" }}>
      <strong style={{ color: "var(--ink)" }}>Last done here:</strong> {line(e, trail.me)}
    </div>
  );
}

interface RecentWorkItem { clientId: string; clientName: string; status: string | null; lastVisitAt: string; latest: TrailEvent | null }

/** Command Center list: the clients you worked on most recently and the last thing done on each — click to pick up there. */
export function PickUpWhereYouLeftOff({ onOpen }: { onOpen: (clientId: string, e: TrailEvent | null) => void }) {
  const [items, setItems] = useState<RecentWorkItem[] | null>(null);
  const { user } = useAuth();
  const me = (user?.email || "").toLowerCase();
  useEffect(() => {
    api.get<{ items: RecentWorkItem[] }>("/clients/recent-work").then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  if (!items || items.length === 0) return null;
  return (
    <div className="card" style={{ margin: "0 0 14px", padding: "10px 14px" }}>
      <strong style={{ fontSize: 13 }}>Pick up where you left off</strong>
      <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, fontSize: 13 }}>
        {items.map((it) => (
          <li key={it.clientId} style={{ padding: "3px 0" }}>
            <button type="button" className="link-button" style={{ textAlign: "left", fontSize: 13, fontWeight: 600 }} onClick={() => onOpen(it.clientId, it.latest)}>{it.clientName}</button>
            <span className="muted"> — {it.latest ? line(it.latest, me) : `visited ${ago(it.lastVisitAt)}`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface LastActivity { at: string; by: string | null; label: string; detail?: string; page?: "client" | "accounting"; tab?: string }

/** Loads the latest activity of every client the caller can see (one request), keyed by client id. */
export function useClientLastActivity(): { activity: Record<string, LastActivity>; me: string } {
  const [state, setState] = useState<{ activity: Record<string, LastActivity>; me: string }>({ activity: {}, me: "" });
  useEffect(() => {
    api.get<{ activity: Record<string, LastActivity>; me: string }>("/clients/last-activity").then(setState).catch(() => {});
  }, []);
  return state;
}

/** Loads the latest activity of each task id shown on the page. */
export function useTaskLastActivity(taskIds: string[]): { activity: Record<string, LastActivity>; me: string } {
  const [state, setState] = useState<{ activity: Record<string, LastActivity>; me: string }>({ activity: {}, me: "" });
  const key = taskIds.join(",");
  useEffect(() => {
    if (!key) return;
    let live = true;
    api.get<{ activity: Record<string, LastActivity>; me: string }>(`/clients/task-activity?ids=${encodeURIComponent(key)}`).then((r) => { if (live) setState(r); }).catch(() => {});
    return () => { live = false; };
  }, [key]);
  return state;
}

/** Table cell: what was last done, by whom and when — so the list itself shows where work stopped. */
export function LastActivityCell({ a, me, fallbackAt }: { a?: LastActivity; me: string; fallbackAt?: unknown }) {
  if (!a) {
    if (!fallbackAt) return <span className="muted">—</span>;
    return <span className="muted">{new Date(fallbackAt as string).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>;
  }
  const w = who(a.by, me);
  return (
    <div title={`${new Date(a.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}${w ? ` · by ${w}` : ""}`}>
      <div className="cell-primary" style={{ fontSize: 12.5 }}>{a.label}</div>
      <div className="cell-sub">{[a.detail, w ? `by ${w}` : "", ago(a.at)].filter(Boolean).join(" · ")}</div>
    </div>
  );
}

interface PageActivityItem { at: string; by: string | null; label: string; clientId: string | null; clientName: string | null; link: string | null }

/**
 * The strip at the top of a main page: the latest thing done on this page's records (by anyone), and the latest thing
 * you did here — so on coming back the first thing you see is where work stopped. Staff/admin pages only.
 */
export function PageActivityBanner({ page }: { page: "clients" | "tasks" | "invoices" | "documents" | "estimates" | "communications" | "notes" | "rules" | "labels" | "calendar" | "permits" | "timetracking" | "users" }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const allowed = user?.role === "admin" || user?.role === "staff";
  const [data, setData] = useState<{ latest: PageActivityItem | null; mine: PageActivityItem | null; me: string } | null>(null);
  useEffect(() => {
    if (!allowed) return;
    api.get<{ latest: PageActivityItem | null; mine: PageActivityItem | null; me: string }>(`/clients/page-activity?page=${page}`).then(setData).catch(() => {});
  }, [page, allowed]);
  if (!allowed || !data || (!data.latest && !data.mine)) return null;
  const render = (title: string, a: PageActivityItem | null) => {
    if (!a) return null;
    const w = who(a.by, data.me);
    return (
      <div style={{ minWidth: 0 }}>
        <span className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em" }}>{title}</span>
        <div style={{ fontSize: 13 }}>
          {a.link ? (
            <button type="button" className="link-button" style={{ textAlign: "left", fontSize: 13, fontWeight: 600 }} onClick={() => navigate(a.link as string)}>{a.label}</button>
          ) : <strong>{a.label}</strong>}
          <span className="muted"> {a.clientName ? `· ${a.clientName} ` : ""}{w ? `· by ${w} ` : ""}· {ago(a.at)}</span>
        </div>
      </div>
    );
  };
  return (
    <div className="card" style={{ margin: "0 0 14px", padding: "8px 14px", display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }} role="status" aria-label="Last activity on this page">
      {render("Last activity on this page", data.latest)}
      {data.mine && data.mine.at !== data.latest?.at && render("Your last", data.mine)}
    </div>
  );
}
