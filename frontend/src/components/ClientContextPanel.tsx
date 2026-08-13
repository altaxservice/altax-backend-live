import { useEffect, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Client, Task } from "../api/types";
import type { WebOptions } from "../api/types2";
import { StatusBadge } from "./StatusBadge";
import { useSelectedClient } from "../context/SelectedClientContext";
import { useToast } from "./Toast";
import { useNotify } from "./ConfirmProvider";
import { NotifyClientFlagsModal } from "./NotifyClientFlagsModal";
import { type ClientFlag, fmtMoney, flagLabel } from "../utils/clientFlags";

const OPEN_TASK_STATUSES_EXCLUDE = ["completed", "closed", "void", "archived"];
const PANEL_WIDTH_MIN = 260;
const PANEL_WIDTH_MAX = 520;
const PANEL_WIDTH_KEY = "altax_client_panel_width";

function clampPanelWidth(n: number): number {
  return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, n));
}

interface Summary {
  openTasks: number;
  taskStatusBreakdown: { status: string; count: number }[];
  openRequests: number;
  openInvoices: number;
  balanceDue: number;
  employeesCount: number;
  documentsCount: number;
}

interface ActivityEntry {
  type: string;
  note: string | null;
  occurred_at: string;
  logged_by: string | null;
  source?: "log" | "communication";
}

/** Which part of the app an activity entry came from — the "where" of what/where/when/who. */
function whereForActivity(a: ActivityEntry): string {
  if (a.source === "communication") return "Communications";
  if (a.type.startsWith("Appointment")) return "Calendar";
  if (a.type.startsWith("Flag")) return "Flags";
  if (a.type.startsWith("Health Permit")) return "Health Permits";
  return "Notes";
}

function fmtDateTime(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ClientContextPanel() {
  const { clientId, clientName, setSelectedClient, panelHidden, setPanelHidden } = useSelectedClient();
  const navigate = useNavigate();
  const toast = useToast();
  const notify = useNotify();
  const [client, setClient] = useState<Client | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [flags, setFlags] = useState<ClientFlag[] | null>(null);
  const [showAddFlag, setShowAddFlag] = useState(false);
  const [flagType, setFlagType] = useState<"Credit" | "Custom">("Custom");
  const [flagAmount, setFlagAmount] = useState("");
  const [flagNote, setFlagNote] = useState("");
  const [flagCategory, setFlagCategory] = useState("");
  const [flagCategoryOther, setFlagCategoryOther] = useState("");
  const [flagDetails, setFlagDetails] = useState("");
  const [flagDueDate, setFlagDueDate] = useState("");
  const [flagLinkTaskId, setFlagLinkTaskId] = useState("");
  const [flagShareWithClient, setFlagShareWithClient] = useState(false);
  const [savingFlag, setSavingFlag] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);
  const [options, setOptions] = useState<WebOptions | null>(null);
  const [optionsError, setOptionsError] = useState(false);
  const [clientTasks, setClientTasks] = useState<Task[]>([]);
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [recentActivity, setRecentActivity] = useState<ActivityEntry[] | null | undefined>(undefined);
  const [showAddNote, setShowAddNote] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [showFlagHistory, setShowFlagHistory] = useState(false);
  const [flagHistory, setFlagHistory] = useState<ClientFlag[] | null>(null);
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return Number.isFinite(saved) && saved > 0 ? clampPanelWidth(saved) : PANEL_WIDTH_MIN;
  });
  const [resizing, setResizing] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<{ clientNoteUnread: number; taskNoteUnread: number } | null>(null);

  function startResize(e: ReactMouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;
    setResizing(true);
    function onMove(ev: MouseEvent) {
      // Handle sits on the panel's LEFT edge, panel is flush against the
      // right side of the screen — dragging left (clientX decreasing) widens it.
      setPanelWidth(clampPanelWidth(startWidth + (startX - ev.clientX)));
    }
    function onUp() {
      setResizing(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setPanelWidth((w) => { localStorage.setItem(PANEL_WIDTH_KEY, String(w)); return w; });
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function loadOptions() {
    setOptionsError(false);
    api.get<WebOptions>("/system/options").then(setOptions).catch(() => setOptionsError(true));
  }
  useEffect(() => { loadOptions(); }, []);

  function loadFlags(id: string) {
    api.get<{ flags: ClientFlag[] }>(`/clients/${id}/flags`).then((res) => setFlags(res.flags)).catch(() => setFlags([]));
  }

  function loadRecentActivity(id: string) {
    api.get<{ activity: ActivityEntry[] }>(`/clients/${id}/activity?limit=5`)
      .then((res) => setRecentActivity(res.activity))
      .catch(() => setRecentActivity([]));
  }

  function loadUnreadCounts(id: string) {
    api.get<{ clientNoteUnread: number; taskNoteUnread: number }>(`/clients/${id}/unread-counts`)
      .then(setUnreadCounts)
      .catch(() => setUnreadCounts(null));
  }

  // This panel is a separate, persistent mount from the Client/Task Detail
  // pages — visiting a client's or task's Activity Timeline (which marks
  // things read there) wouldn't otherwise refresh the counts already sitting
  // in this panel's state until the client was reselected. Those pages
  // dispatch this event right after a successful mark-read call.
  useEffect(() => {
    function onNotesRead(e: Event) {
      const detail = (e as CustomEvent<{ clientId?: string }>).detail;
      if (clientId && detail?.clientId === clientId) loadUnreadCounts(clientId);
    }
    window.addEventListener("altax:notes-read", onNotesRead);
    return () => window.removeEventListener("altax:notes-read", onNotesRead);
  }, [clientId]);

  useEffect(() => {
    if (!clientId) {
      setClient(null);
      setSummary(null);
      setFlags(null);
      setClientTasks([]);
      setRecentActivity(undefined);
      setShowFlagHistory(false);
      setFlagHistory(null);
      setUnreadCounts(null);
      return;
    }
    let cancelled = false;
    setRecentActivity(undefined);
    setShowFlagHistory(false);
    setFlagHistory(null);
    loadUnreadCounts(clientId);
    api.get<{ client: Client }>(`/clients/${clientId}`).then((res) => { if (!cancelled) setClient(res.client); }).catch(() => { if (!cancelled) setClient(null); });
    api.get<Summary>(`/clients/${clientId}/summary`).then((res) => { if (!cancelled) setSummary(res); }).catch(() => { if (!cancelled) setSummary(null); });
    // Fast-review feed — a handful of the most recent client-level Notes/flag/
    // appointment events, same Activity Timeline shown in full on the Notes tab.
    // Task notes are excluded server-side (they live only on their own task).
    loadRecentActivity(clientId);
    // For the "link an existing task" picker on the flag form — this client's own
    // open tasks, so staff can point a flag at wherever it's actually being tracked
    // instead of typing a description with no connection to real work.
    api.get<{ tasks: Task[] }>("/tasks").then((res) => {
      if (cancelled) return;
      setClientTasks(res.tasks.filter((t) => t.client_id === clientId && !OPEN_TASK_STATUSES_EXCLUDE.includes(String(t.status || "").toLowerCase())));
    }).catch(() => { if (!cancelled) setClientTasks([]); });
    loadFlags(clientId);
    return () => { cancelled = true; };
  }, [clientId]);

  function resetFlagForm() {
    setFlagAmount(""); setFlagNote(""); setFlagCategory(""); setFlagCategoryOther("");
    setFlagDetails(""); setFlagDueDate(""); setFlagLinkTaskId(""); setFlagShareWithClient(false);
  }

  async function handleAddFlag(e: FormEvent) {
    e.preventDefault();
    if (!clientId) return;
    setFlagError(null);
    let categoryToSend = "";
    if (flagType === "Credit") {
      const n = Number(flagAmount);
      if (!Number.isFinite(n) || n <= 0) { setFlagError("Enter the credit amount."); return; }
    } else {
      categoryToSend = flagCategory === "Other" ? flagCategoryOther.trim() : flagCategory;
      if (!categoryToSend) { setFlagError("Choose what kind of flag this is."); return; }
    }
    setSavingFlag(true);
    try {
      await api.post(`/clients/${clientId}/flags`, {
        flagType,
        amount: flagAmount ? Number(flagAmount) : undefined,
        note: flagType === "Credit" ? (flagNote.trim() || undefined) : undefined,
        category: flagType === "Custom" ? categoryToSend : undefined,
        details: flagType === "Custom" ? (flagDetails.trim() || undefined) : undefined,
        dueDate: flagType === "Custom" ? (flagDueDate || undefined) : undefined,
        linkTaskId: flagType === "Custom" ? (flagLinkTaskId || undefined) : undefined,
        shareWithClient: flagShareWithClient,
      });
      setShowAddFlag(false);
      setFlagType("Custom");
      resetFlagForm();
      loadFlags(clientId);
      toast("Flag added.");
    } catch (err) {
      setFlagError(err instanceof ApiError ? err.message : "Could not add this flag.");
    } finally {
      setSavingFlag(false);
    }
  }

  async function handleAddNote(e: FormEvent) {
    e.preventDefault();
    if (!clientId) return;
    const note = noteText.trim();
    if (!note) { setNoteError("Enter a note."); return; }
    setNoteError(null);
    setSavingNote(true);
    try {
      await api.post(`/clients/${clientId}/activity`, { activityType: "Note", note });
      setShowAddNote(false);
      setNoteText("");
      loadRecentActivity(clientId);
      loadUnreadCounts(clientId);
      toast("Note added.");
    } catch (err) {
      setNoteError(err instanceof ApiError ? err.message : "Could not add this note.");
    } finally {
      setSavingNote(false);
    }
  }

  async function handleResolveFlag(flagId: string) {
    if (!clientId) return;
    try {
      await api.post(`/clients/${clientId}/flags/${flagId}/resolve`, {});
      loadFlags(clientId);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not resolve this flag.");
    }
  }

  async function handleToggleShare(flagId: string) {
    if (!clientId) return;
    try {
      await api.post(`/clients/${clientId}/flags/${flagId}/toggle-share`, {});
      loadFlags(clientId);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not update this flag.");
    }
  }

  function toggleFlagHistory() {
    if (!showFlagHistory && flagHistory === null && clientId) {
      api.get<{ flags: ClientFlag[] }>(`/clients/${clientId}/flags/history`)
        .then((res) => setFlagHistory(res.flags))
        .catch(() => setFlagHistory([]));
    }
    setShowFlagHistory((v) => !v);
  }

  if (!clientId) return null;

  // Hidden, but still selected — leave a way back in. Without this the ✕ was a
  // one-way door: the panel vanished and nothing on screen could bring it back.
  if (panelHidden) {
    return (
      <button
        type="button"
        className="client-panel-reopen"
        onClick={() => setPanelHidden(false)}
        title={`Show client panel — ${clientName || clientId}`}
      >
        <span aria-hidden="true">‹</span>
        <span className="client-panel-reopen-label">{clientName || clientId}</span>
      </button>
    );
  }

  const hasBalancePastDue = (flags || []).some((f) => f.flagType === "BalancePastDue");

  return (
    <aside className="client-panel" style={{ width: panelWidth }}>
      <div
        className={`client-panel-resize-handle ${resizing ? "dragging" : ""}`}
        onMouseDown={startResize}
        title="Drag to resize"
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4, gap: 6 }}>
        <div className="small-label" style={{ color: "var(--muted)" }}>{clientId}</div>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" className="btn btn-sm" onClick={() => setPanelHidden(true)} title="Hide this panel (keeps the client selected)">✕</button>
          <button type="button" className="btn btn-sm" onClick={() => setSelectedClient(null)} title="Clear the selected client">Clear</button>
        </div>
      </div>

      {!client && <div className="spinner-wrap" style={{ padding: 24 }}>Loading…</div>}

      {client && (
        <>
          <h2 style={{ fontSize: 17, margin: "0 0 8px" }}>
            <button type="button" onClick={() => navigate(`/clients/${client.client_id}`)} className="client-panel-name-link">{client.client_name}</button>
          </h2>

          {/* Fast in-panel review of what's recently happened with this client —
              Notes, flag events, appointments — without leaving the page.
              Click-through to the full Activity Timeline for everything else. */}
          {recentActivity !== undefined && (
            <div style={{ marginBottom: 10 }}>
              <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Recent Notes</div>
              {recentActivity === null || recentActivity.length === 0 ? (
                <div className="muted" style={{ fontSize: 12, padding: "6px 0" }}>No activity logged yet</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 4 }}>
                  {recentActivity.map((a) => (
                    <div
                      key={`${a.occurred_at}-${a.type}`}
                      style={{ background: "var(--panel, rgba(127,127,127,0.06))", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px" }}
                    >
                      <div style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span className="badge" title="What" style={{ minHeight: 0, padding: "2px 7px", fontSize: 10, marginRight: 4, verticalAlign: "middle" }}>{a.type}</span>
                        <span className="badge" title="Where" style={{ minHeight: 0, padding: "2px 7px", fontSize: 10, marginRight: 6, verticalAlign: "middle", background: "var(--paper)", border: "1px solid var(--line)", color: "var(--muted)" }}>{whereForActivity(a)}</span>
                        {a.note || ""}
                      </div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {a.logged_by ? `Who: ${a.logged_by} · ` : ""}When: {fmtDateTime(a.occurred_at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="btn btn-sm"
                style={{ background: "none", border: "none", color: "var(--accent, inherit)", textDecoration: "underline", padding: 0, cursor: "pointer", fontSize: 11.5 }}
                onClick={() => navigate(`/clients/${client.client_id}?tab=${encodeURIComponent("Activity Timeline")}`)}
              >
                View all →
              </button>
            </div>
          )}

          {/* Noticeable, colored account issues — separate from the freeform
              Activity Timeline because a note's "read" state says nothing
              about whether the underlying problem is actually fixed. Balance
              Past Due is computed live from real invoices and self-clears the
              moment it's paid; Credit/Custom are staff-entered and stay until
              explicitly resolved. */}
          {flags && flags.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              {flags.map((f) => (
                <div
                  key={f.flagId || f.linkTaskId || `${f.flagType}-${f.note}`}
                  className={`status-pill status-${f.color}`}
                  style={{ flexDirection: "column", alignItems: "flex-start", width: "100%", padding: "6px 10px", fontSize: 12 }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                    {f.linkTaskId || f.linkUrl ? (
                      <button
                        type="button"
                        onClick={() => navigate(f.linkTaskId ? `/tasks/${f.linkTaskId}` : f.linkUrl!)}
                        title="Open where this is tracked"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", font: "inherit", textAlign: "left", padding: 0, textDecoration: "underline", overflow: "hidden", textOverflow: "ellipsis" }}
                      >
                        {flagLabel(f)}
                      </button>
                    ) : (
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{flagLabel(f)}</span>
                    )}
                    {f.flagId && (
                      <button
                        type="button"
                        onClick={() => handleToggleShare(f.flagId!)}
                        title={f.shareWithClient ? "Included the next time you notify this client — click to hide it" : "Not shared with the client — click to include it in the next notification"}
                        aria-label={f.shareWithClient ? "Shared with client" : "Not shared with client"}
                        style={{ background: "none", border: f.shareWithClient ? "1px solid currentColor" : "1px dashed currentColor", borderRadius: 4, cursor: "pointer", color: "inherit", opacity: f.shareWithClient ? 1 : 0.55, padding: "0 4px", marginLeft: 6, flex: "0 0 auto", fontSize: 10, lineHeight: "14px" }}
                      >
                        {f.shareWithClient ? "Shared" : "Share?"}
                      </button>
                    )}
                    {f.resolvable && f.flagId && (
                      <button
                        type="button"
                        onClick={() => handleResolveFlag(f.flagId!)}
                        title="Resolve this flag"
                        aria-label="Resolve this flag"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontWeight: 800, padding: 0, marginLeft: 6, flex: "0 0 auto" }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {f.details && <div style={{ fontWeight: 400, opacity: 0.85, marginTop: 3, fontSize: 11.5 }}>{f.details}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Resolved flags vanish from the stack above the moment they're
              resolved — this is the only place to look back at them. */}
          <div style={{ marginBottom: 10 }}>
            <button type="button" className="btn btn-sm" onClick={toggleFlagHistory}>
              {showFlagHistory ? "Hide History ▲" : "View History ▾"}
            </button>
            {showFlagHistory && (
              flagHistory === null ? (
                <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Loading…</div>
              ) : flagHistory.length === 0 ? (
                <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>No resolved flags yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                  {flagHistory.map((f) => (
                    <div
                      key={f.key}
                      className="status-pill"
                      style={{ flexDirection: "column", alignItems: "flex-start", width: "100%", padding: "6px 10px", fontSize: 12, opacity: 0.7 }}
                    >
                      <span style={{ textDecoration: "line-through" }}>{flagLabel(f)}</span>
                      <span className="muted" style={{ fontSize: 10 }}>
                        Resolved {f.resolvedAt ? fmtDateTime(f.resolvedAt) : ""}{f.resolvedBy ? ` by ${f.resolvedBy}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>

          {!showAddFlag && !showAddNote ? (
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-sm" onClick={() => { setShowAddNote(true); setNoteError(null); }}>+ Client Note</button>
              <button type="button" className="btn btn-sm" onClick={() => { setShowAddFlag(true); setFlagError(null); }}>+ Flag</button>
              {flags && flags.length > 0 && (
                <button type="button" className="btn btn-sm" onClick={() => setShowNotifyModal(true)}>
                  Notify Client{flags.some((f) => f.shareWithClient) ? ` (${flags.filter((f) => f.shareWithClient).length})` : ""}
                </button>
              )}
            </div>
          ) : showAddNote ? (
            <form onSubmit={handleAddNote} style={{ marginBottom: 12, border: "1px solid var(--line)", borderRadius: 8, padding: 10, display: "grid", gap: 6 }}>
              {/* This panel is shown globally across Tasks/Documents/Billing/etc,
                  independent of whatever else is on screen — this note always
                  attaches to the client, never to a task. Task notes live on
                  the task's own Activity Timeline instead. */}
              <div className="muted" style={{ fontSize: 11, fontWeight: 600 }}>Note about {client.client_name}</div>
              {noteError && <div className="error-banner" role="alert" style={{ fontSize: 11.5, padding: "6px 8px" }}>{noteError}</div>}
              <textarea
                placeholder="Client note — general info, preferences, follow-up, anything worth remembering about this client"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={3}
                autoFocus
                style={{ fontSize: 12.5, resize: "vertical" }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button type="submit" className="btn btn-primary btn-sm" disabled={savingNote}>{savingNote ? "Saving…" : "Save Note"}</button>
                <button type="button" className="btn btn-sm" onClick={() => { setShowAddNote(false); setNoteError(null); setNoteText(""); }}>Cancel</button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleAddFlag} style={{ marginBottom: 12, border: "1px solid var(--line)", borderRadius: 8, padding: 10, display: "grid", gap: 6 }}>
              {flagError && <div className="error-banner" role="alert" style={{ fontSize: 11.5, padding: "6px 8px" }}>{flagError}</div>}
              <select value={flagType} onChange={(e) => setFlagType(e.target.value as "Credit" | "Custom")} style={{ fontSize: 12.5 }}>
                <option value="Custom">Something else…</option>
                <option value="Credit">Credit on account</option>
              </select>

              {flagType === "Credit" ? (
                <>
                  <input type="number" step="0.01" min="0" placeholder="Credit amount" value={flagAmount} onChange={(e) => setFlagAmount(e.target.value)} style={{ fontSize: 12.5 }} />
                  <input type="text" placeholder="Note (optional)" value={flagNote} onChange={(e) => setFlagNote(e.target.value)} style={{ fontSize: 12.5 }} />
                </>
              ) : (
                <>
                  {optionsError && !options ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--red)" }}>
                      Couldn't load flag categories.
                      <button type="button" className="ghost-button btn-sm" onClick={loadOptions}>Retry</button>
                    </div>
                  ) : (
                    <select value={flagCategory} onChange={(e) => setFlagCategory(e.target.value)} style={{ fontSize: 12.5 }} disabled={!options}>
                      <option value="">{options ? "What kind of flag is this?" : "Loading…"}</option>
                      {(options?.clientFlagCategories || []).map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                  {flagCategory === "Other" && (
                    <input type="text" placeholder="Describe it" value={flagCategoryOther} onChange={(e) => setFlagCategoryOther(e.target.value)} style={{ fontSize: 12.5 }} />
                  )}
                  <textarea
                    placeholder="Details — what year, what happened, anything staff should know"
                    value={flagDetails}
                    onChange={(e) => setFlagDetails(e.target.value)}
                    rows={2}
                    style={{ fontSize: 12.5, resize: "vertical" }}
                  />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <input type="number" step="0.01" placeholder="Amount (optional)" value={flagAmount} onChange={(e) => setFlagAmount(e.target.value)} style={{ fontSize: 12.5 }} />
                    <input type="date" title="Relevant date (optional)" value={flagDueDate} onChange={(e) => setFlagDueDate(e.target.value)} style={{ fontSize: 12.5 }} />
                  </div>
                  {clientTasks.length > 0 && (
                    <select value={flagLinkTaskId} onChange={(e) => setFlagLinkTaskId(e.target.value)} style={{ fontSize: 12.5 }} title="Link an open task, so staff know where to go to fix or track this">
                      <option value="">Link an open task (optional)…</option>
                      {clientTasks.map((t) => <option key={t.task_id} value={t.task_id}>{t.task_name}</option>)}
                    </select>
                  )}
                </>
              )}

              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                <input type="checkbox" checked={flagShareWithClient} onChange={(e) => setFlagShareWithClient(e.target.checked)} />
                Share with client — include this in the client's "Notify Client" email/SMS
              </label>

              <div style={{ display: "flex", gap: 6 }}>
                <button type="submit" className="btn btn-primary btn-sm" disabled={savingFlag}>{savingFlag ? "Saving…" : "Save Flag"}</button>
                <button type="button" className="btn btn-sm" onClick={() => { setShowAddFlag(false); setFlagError(null); resetFlagForm(); }}>Cancel</button>
              </div>
            </form>
          )}

          <div className="client-panel-section">
            <div className="small-label">Contact</div>
            <ClientRow label="Email" value={client.email} href={client.email ? `mailto:${client.email}` : undefined} />
            <ClientRow label="Phone" value={client.phone} href={client.phone ? `tel:${String(client.phone).replace(/[^\d+]/g, "")}` : undefined} />
          </div>

          <div className="client-panel-section">
            <div className="small-label">Compliance</div>
            <ClientRow label="Sales Tax" value={client.sales_tax_frequency as string | null} />
            <ClientRow label="Service" value={client.service_type} />
          </div>

          <div style={{ margin: "10px 0" }}>
            <StatusBadge status={client.status} />
          </div>

          {summary && (
            <div className="client-panel-section">
              <div className="small-label">Account</div>
              <ClientRow label="Open Tasks" value={String(summary.openTasks)} onClick={() => navigate(`/tasks?clientId=${client.client_id}`)} />
              {summary.taskStatusBreakdown.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "2px 0 8px" }}>
                  {summary.taskStatusBreakdown.map((s) => (
                    <button
                      key={s.status}
                      type="button"
                      className="client-panel-value-link"
                      style={{ fontSize: 11 }}
                      onClick={() => navigate(`/tasks?clientId=${client.client_id}&status=${encodeURIComponent(s.status)}`)}
                    >
                      {s.count} {s.status}
                    </button>
                  ))}
                </div>
              )}
              <ClientRow label="Requests" value={String(summary.openRequests)} onClick={() => navigate(`/clients/${client.client_id}?tab=Documents`)} />
              {/* Documents/Employees were already computed server-side but never
                  shown — "do we have their paperwork" is one of the first things
                  staff check, so it belongs here rather than a page away. */}
              <ClientRow label="Documents" value={String(summary.documentsCount)} onClick={() => navigate(`/clients/${client.client_id}?tab=Documents`)} />
              <ClientRow label="Employees" value={String(summary.employeesCount)} onClick={() => navigate(`/accounting?clientId=${client.client_id}`)} />
              <ClientRow label="Invoices" value={String(summary.openInvoices)} onClick={() => navigate(`/billing?clientId=${client.client_id}`)} />
              <ClientRow
                label="Balance"
                value={fmtMoney(summary.balanceDue)}
                onClick={() => navigate(`/billing?clientId=${client.client_id}`)}
                valueColor={hasBalancePastDue ? "var(--red)" : undefined}
              />
              <ClientRow
                label="Client Note"
                value={String(unreadCounts?.clientNoteUnread ?? 0)}
                onClick={() => navigate(`/clients/${client.client_id}?tab=${encodeURIComponent("Activity Timeline")}`)}
                valueColor={(unreadCounts?.clientNoteUnread ?? 0) > 0 ? "var(--red)" : undefined}
              />
              <ClientRow
                label="Task Note"
                value={String(unreadCounts?.taskNoteUnread ?? 0)}
                onClick={() => navigate(`/clients/${client.client_id}?tab=${encodeURIComponent("Task Notes")}`)}
                valueColor={(unreadCounts?.taskNoteUnread ?? 0) > 0 ? "var(--red)" : undefined}
              />
            </div>
          )}

          <div className="client-panel-section">
            <div className="small-label">Open</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <button type="button" className="btn btn-sm" onClick={() => navigate(`/clients/${client.client_id}?tab=Documents`)}>Documents</button>
              <button type="button" className="btn btn-sm" onClick={() => navigate(`/tasks?clientId=${client.client_id}`)}>Tasks</button>
              <button type="button" className="btn btn-sm" onClick={() => navigate(`/accounting?clientId=${client.client_id}`)}>Accounting</button>
              <button type="button" className="btn btn-sm" onClick={() => navigate(`/reports?clientId=${client.client_id}`)}>Reports</button>
            </div>
          </div>

          <div className="client-panel-section" style={{ borderBottom: "none" }}>
            <div className="muted" style={{ fontSize: 11 }}>
              {client.updated_at ? `Last updated ${new Date(client.updated_at).toLocaleDateString()}` : "Not yet updated"}
              {client.updated_by && ` by ${client.updated_by}`}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <button type="button" className="btn btn-sm" style={{ width: "100%" }} onClick={() => navigate(`/billing?clientId=${client.client_id}`)}>View Billing</button>
          </div>

          {showNotifyModal && (
            <NotifyClientFlagsModal
              clientId={client.client_id}
              clientName={client.client_name}
              clientEmail={client.email}
              clientPhone={client.phone}
              onClose={() => setShowNotifyModal(false)}
            />
          )}
        </>
      )}
    </aside>
  );
}

function ClientRow({ label, value, onClick, href, valueColor }: { label: string; value: string | null | undefined; onClick?: () => void; href?: string; valueColor?: string }) {
  const display = value || "—";
  const clickable = Boolean((onClick || href) && value);
  const rowInner = (
    <>
      <span>{label}</span>
      <span style={valueColor ? { color: valueColor, fontWeight: 800 } : undefined}>{display}</span>
    </>
  );
  // The whole row is the link/button when clickable — not just the value —
  // so the label reads as part of the hyperlink too, not a plain label next
  // to an unrelated-looking number.
  if (clickable && href) {
    return <a href={href} className="client-panel-row-link">{rowInner}</a>;
  }
  if (clickable && onClick) {
    return <button type="button" onClick={onClick} className="client-panel-row-link">{rowInner}</button>;
  }
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12.5 }}>
      <span className="muted">{label}</span>
      <span style={valueColor ? { color: valueColor, fontWeight: 800 } : undefined}>{display}</span>
    </div>
  );
}
