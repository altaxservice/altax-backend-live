import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface ActivityEvent {
  loggedAt: string;
  userEmail: string;
  module: string;
  action: string;
  note: string | null;
  recordId: string | null;
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

// record_id's meaning depends on module AND action — logAudit() callers don't
// use one consistent ID scheme per module (e.g. Billing's record_id is an
// invoice_id for CREATE_INVOICE but a payment_id for RECORD_PAYMENT). Actions
// listed here are the ones confirmed to carry the ID a detail route expects;
// anything else in that module falls back to the module's list/section page
// instead of guessing and risking a broken link.
const CLIENT_ID_ACTIONS = new Set(["LOG_ACTIVITY", "DELETE_ACTIVITY", "SWOT_FINDINGS_SWEEP"]);
const EMPLOYEE_NON_ID_ACTIONS = new Set(["IMPORT"]);
const INVOICE_ID_ACTIONS = new Set(["CREATE_INVOICE", "CREATE_INVOICE_FROM_TIME", "EDIT_INVOICE", "VOID_INVOICE", "DELETE_INVOICE", "SEND_INVOICE", "CREATE_SHARE_LINK", "CREATE_SALES_RECEIPT"]);

/** Where a given event should take you — a specific record when the module/action
 * pairing is known to carry that record's real ID, otherwise that module's own
 * section page so the click is still useful instead of a dead link. Returns null
 * only for modules with no corresponding page at all. */
function hrefForEvent(e: ActivityEvent): string | null {
  switch (e.module) {
    case "Tasks": return e.recordId ? `/tasks/${e.recordId}` : "/tasks";
    case "Clients": return e.recordId && !CLIENT_ID_ACTIONS.has(e.action) ? `/clients/${e.recordId}` : "/clients";
    case "Employees": return e.recordId && !EMPLOYEE_NON_ID_ACTIONS.has(e.action) ? `/employees/${e.recordId}` : "/accounting";
    case "Contractors": return "/accounting";
    case "Billing": return e.recordId && INVOICE_ID_ACTIONS.has(e.action) ? `/billing/${e.recordId}` : "/billing";
    case "Documents": return "/documents";
    case "Communications": return "/communications";
    case "Calendar": return "/calendar";
    case "Time Tracking": return "/time-tracking";
    case "Templates": return "/templates";
    case "Rules": return "/rules";
    case "Haccp": return "/haccp";
    case "Reports": return "/reports";
    case "Calculators": return "/calculators";
    case "Checklists": return "/document-checklists";
    case "Firm Portals": return "/firm-portals";
    case "Labels": return "/labels";
    case "Staff": return "/users";
    case "Accounting": return "/accounting";
    case "Settings": return "/firm-settings";
    // No corresponding page to land on for these — leave unclickable rather
    // than send someone to a page that has nothing to do with the event.
    case "Contracts": case "Leave": case "Reminders": case "Secure Vault": case "Tools": default:
      return null;
  }
}

/**
 * A single "N updates since your last login" strip, clickable to expand the
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
    <>
      <button type="button" className="info-strip" onClick={() => setShowModal(true)}>
        <strong>{data.count}</strong> update{data.count === 1 ? "" : "s"} since your last login ({fmtDateTime(data.since)}) — click to view details
      </button>
      {showModal && <SinceLastLoginModal data={data} onClose={() => setShowModal(false)} />}
    </>
  );
}

function SinceLastLoginModal({ data, onClose }: { data: ActivitySinceLogin; onClose: () => void }) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const navigate = useNavigate();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="since-last-login-title" style={{ maxWidth: 640, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <h3 id="since-last-login-title" style={{ marginTop: 0 }}>What happened since your last login</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>Since {fmtDateTime(data.since as string)} — {data.count} update{data.count === 1 ? "" : "s"}{data.truncated ? " (showing the most recent 200)" : ""}.</p>
        <div style={{ maxHeight: "60vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {data.events.map((e, i) => {
            const href = hrefForEvent(e);
            const rowContent = (
              <>
                <div style={{ fontSize: 12.5 }}>
                  <span className="badge" title="What" style={{ minHeight: 0, padding: "2px 7px", fontSize: 10, marginRight: 4, verticalAlign: "middle" }}>{fmtAction(e.action)}</span>
                  <span className="badge" title="Where" style={{ minHeight: 0, padding: "2px 7px", fontSize: 10, marginRight: 6, verticalAlign: "middle", background: "var(--paper)", border: "1px solid var(--line)", color: "var(--muted)" }}>{e.module}</span>
                  {e.note || ""}
                </div>
                <div className="muted" style={{ fontSize: 11 }}>
                  Who: {e.userEmail} · When: {fmtDateTime(e.loggedAt)}
                </div>
              </>
            );
            const rowStyle = { background: "var(--panel, rgba(127,127,127,0.06))", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px" } as const;
            return href ? (
              <button
                key={i}
                type="button"
                onClick={() => { onClose(); navigate(href); }}
                style={{ ...rowStyle, display: "block", width: "100%", textAlign: "left", cursor: "pointer", font: "inherit" }}
              >
                {rowContent}
              </button>
            ) : (
              <div key={i} style={rowStyle}>{rowContent}</div>
            );
          })}
        </div>
        <div style={{ marginTop: 12, textAlign: "right" }}>
          <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
