import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface ActivityEvent {
  loggedAt: string;
  userEmail: string;
  module: string;
  action: string;
  note: string | null;
}

interface ActivitySinceLogin {
  since: string | null;
  count: number;
  truncated: boolean;
  events: ActivityEvent[];
}

function fmtDateTime(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Turns a logAudit() action code like "CREATE_TASK" into "Create task". */
function fmtAction(action: string): string {
  const words = action.toLowerCase().split("_");
  return words.length === 0 ? action : words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? " " + words.slice(1).join(" ") : "");
}

/**
 * A single "N updates since your last login" line, clickable to expand the
 * full What/Where/When/Who list — the system-wide counterpart to the client
 * panel's own Recent Notes feed, for "what did I miss while I was away."
 * Uses previous_login (the login BEFORE this session), not last_login, since
 * last_login is already overwritten by the time this component mounts.
 */
export function SinceLastLoginBanner() {
  const [data, setData] = useState<ActivitySinceLogin | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    api.get<ActivitySinceLogin>("/system/activity-since-login").then(setData).catch(() => setData(null));
  }, []);

  if (!data || !data.since || data.count === 0) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      <button type="button" className="link-button" onClick={() => setShowModal(true)}>
        {data.count} update{data.count === 1 ? "" : "s"} since your last login ({fmtDateTime(data.since)}) — click to view details
      </button>
      {showModal && <SinceLastLoginModal data={data} onClose={() => setShowModal(false)} />}
    </div>
  );
}

function SinceLastLoginModal({ data, onClose }: { data: ActivitySinceLogin; onClose: () => void }) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="since-last-login-title" style={{ maxWidth: 640, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <h3 id="since-last-login-title" style={{ marginTop: 0 }}>What happened since your last login</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>Since {fmtDateTime(data.since as string)} — {data.count} update{data.count === 1 ? "" : "s"}{data.truncated ? " (showing the most recent 200)" : ""}.</p>
        <div style={{ maxHeight: "60vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {data.events.map((e, i) => (
            <div key={i} style={{ background: "var(--panel, rgba(127,127,127,0.06))", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px" }}>
              <div style={{ fontSize: 12.5 }}>
                <span className="badge" title="What" style={{ minHeight: 0, padding: "2px 7px", fontSize: 10, marginRight: 4, verticalAlign: "middle" }}>{fmtAction(e.action)}</span>
                <span className="badge" title="Where" style={{ minHeight: 0, padding: "2px 7px", fontSize: 10, marginRight: 6, verticalAlign: "middle", background: "var(--paper)", border: "1px solid var(--line)", color: "var(--muted)" }}>{e.module}</span>
                {e.note || ""}
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                Who: {e.userEmail} · When: {fmtDateTime(e.loggedAt)}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, textAlign: "right" }}>
          <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
