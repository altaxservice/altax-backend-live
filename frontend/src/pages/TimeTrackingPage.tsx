import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { StatusBadge } from "../components/StatusBadge";
import { useConfirm, useNotify } from "../components/ConfirmProvider";
import { useToast } from "../components/Toast";
import { FilterBar, exportCsv, activeViewDates } from "../components/FilterBar";
import { useStickyState } from "../utils/listState";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

// A punch left open this long is very unlikely to be a real still-working
// shift — almost always someone forgot to tap out. Flagged, not auto-closed:
// only an admin closing it (Force Clock Out) should ever decide the actual
// end time, since guessing one would record the wrong hours.
const FORGOT_CLOCKOUT_HOURS = 10;

interface TimeEntry {
  time_entry_id: string;
  user_email: string;
  user_name: string | null;
  entry_date: string;
  client_id: string | null;
  client_name: string | null;
  hours: string | number;
  description: string | null;
  status: string;
  billable: boolean;
  hourly_rate: string | number | null;
  billed: boolean;
  invoice_id: string | null;
}

interface OpenPunch { punch_id: string; user_id: string; name: string; clock_in_at: string; device_label: string | null }

const money = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

function elapsed(sinceIso: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - new Date(sinceIso).getTime());
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Live "who's in / who's out" board — admin-only, same GET /kiosk/open-punches
 * data KioskSettingsPage's plain "Force Clock Out" list already used, just
 * surfaced here with real presence and a live clock instead of buried in the
 * kiosk admin console.
 */
function ClockedInBoard() {
  const notify = useNotify();
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [punches, setPunches] = useState<OpenPunch[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  function load() {
    api.get<{ punches: OpenPunch[] }>("/kiosk/open-punches").then((r) => setPunches(r.punches)).catch(() => setPunches([]));
  }
  useEffect(() => {
    load();
    const poll = setInterval(load, 15000);
    return () => clearInterval(poll);
  }, []);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  async function handleForceClockOut(p: OpenPunch) {
    const ok = await confirmDialog({ title: "Clock out", message: `Close ${p.name}'s open punch right now? Their hours will be recorded up to this moment.`, confirmLabel: "Clock Out Now" });
    if (!ok) return;
    try {
      await api.post(`/kiosk/punches/${p.punch_id}/close`, { clockOutAt: new Date().toISOString() });
      toast(`${p.name} clocked out.`);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not close this punch.");
    }
  }

  const clockStr = new Date(now).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
  const stuckCount = (punches || []).filter((p) => (now - new Date(p.clock_in_at).getTime()) / 3600000 >= FORGOT_CLOCKOUT_HOURS).length;

  return (
    <div className="card" style={{ marginBottom: 16, overflow: "hidden", background: "linear-gradient(180deg, var(--teal-soft) 0%, var(--paper) 140px)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px 10px" }}>
        <div>
          <strong style={{ fontSize: 15 }}>Kiosk — Live Clock In / Out</strong>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {punches === null ? "Loading…" : punches.length === 0 ? "Everyone's clocked out." : `${punches.length} clocked in right now`}
            {stuckCount > 0 && <span style={{ color: "var(--amber)", fontWeight: 600 }}> · {stuckCount} may have forgotten to clock out</span>}
          </div>
        </div>
        <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 20, fontWeight: 600, color: "var(--teal)" }}>{clockStr}</div>
      </div>
      {punches && punches.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "4px 16px 16px" }}>
          {punches.map((p) => {
            const hoursIn = (now - new Date(p.clock_in_at).getTime()) / 3600000;
            const stuck = hoursIn >= FORGOT_CLOCKOUT_HOURS;
            return (
              <div key={p.punch_id} style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${stuck ? "var(--amber)" : "var(--line)"}`, borderRadius: 12, padding: "10px 12px", background: "var(--paper)", minWidth: 220 }}>
                <div style={{ position: "relative", width: 36, height: 36, borderRadius: "50%", background: stuck ? "var(--amber-soft)" : "var(--teal-soft)", color: stuck ? "var(--amber)" : "var(--teal)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                  {initials(p.name)}
                  <span style={{ position: "absolute", bottom: -1, right: -1, width: 10, height: 10, borderRadius: "50%", background: stuck ? "var(--amber)" : "var(--green)", border: "2px solid var(--paper)" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                  <div className="muted" style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>
                    since {new Date(p.clock_in_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · {elapsed(p.clock_in_at, now)}
                  </div>
                  {stuck && <div style={{ fontSize: 11, color: "var(--amber)", fontWeight: 600, marginTop: 1 }}>Forgot to clock out?</div>}
                </div>
                <button type="button" className="ghost-button btn-sm" onClick={() => handleForceClockOut(p)} title="Clock out now">Clock Out</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Staff time tracking: the live kiosk clock in/out board, plus the record of
 * every hour worked (kiosk-recorded and manually logged internal time alike).
 * Billable hours against a specific client are logged from that client's own
 * Billing tab instead (ClientDetailPage.tsx) — right next to "Create Invoice
 * from Unbilled Time", which is what actually consumes them — rather than
 * from a generic client dropdown here.
 */
export function TimeTrackingPage() {
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Sticky like every other list page — same reasoning: leaving this page and
  // coming back (or reloading) shouldn't lose the filter you had set up.
  const [search, setSearch] = useStickyState("timeTracking.search", "");
  const [statusFilter, setStatusFilter] = useStickyState("timeTracking.status", "all");
  const [billableFilter, setBillableFilter] = useStickyState("timeTracking.billable", "all");
  const [period, setPeriod] = useState(activeViewDates());

  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);

  function load(): Promise<void> {
    const qs = isAdmin && userFilter ? `?userEmail=${encodeURIComponent(userFilter)}` : "";
    return api.get<{ timeEntries: TimeEntry[] }>(`/time-tracking/entries${qs}`)
      .then((res) => setEntries(res.timeEntries))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load time entries."));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [userFilter]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
      toast("Data refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  const filtered = useMemo(() => {
    let rows = entries || [];
    if (period.start) rows = rows.filter((e) => e.entry_date >= period.start);
    if (period.end) rows = rows.filter((e) => e.entry_date <= period.end);
    if (statusFilter !== "all") rows = rows.filter((e) => String(e.status || "").toLowerCase() === statusFilter.toLowerCase());
    if (billableFilter === "billable") rows = rows.filter((e) => e.billable);
    if (billableFilter === "internal") rows = rows.filter((e) => !e.billable);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((e) => [e.description, e.client_name, e.user_name, e.user_email].some((v) => String(v || "").toLowerCase().includes(q)));
    return [...rows].sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  }, [entries, period, statusFilter, billableFilter, search]);

  const hoursByStaff = useMemo(() => {
    const totals = new Map<string, { email: string; name: string; hours: number }>();
    for (const e of filtered) {
      const key = e.user_email;
      const existing = totals.get(key);
      const hours = Number(e.hours) || 0;
      if (existing) existing.hours += hours;
      else totals.set(key, { email: key, name: e.user_name || e.user_email, hours });
    }
    return Array.from(totals.values()).sort((a, b) => b.hours - a.hours);
  }, [filtered]);

  async function handleSubmit() {
    setFormError(null);
    const h = Number(hours);
    if (!entryDate) return setFormError("Date is required.");
    if (!Number.isFinite(h) || h <= 0) return setFormError("Hours must be a positive number.");
    setSaving(true);
    try {
      await api.post("/time-tracking/entries", { entryDate, hours: h, description: description.trim() || undefined });
      setHours(""); setDescription("");
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not log this entry.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDecision(entryId: string, decision: "approve" | "reject") {
    try {
      await api.post(`/time-tracking/entries/${entryId}/${decision}`, {});
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not update this entry.");
    }
  }

  async function handleDelete(entryId: string) {
    const ok = await confirmDialog({ title: "Delete time entry", message: "Delete this time entry?", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.post(`/time-tracking/entries/${entryId}/delete`, {});
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not delete this entry.");
    }
  }

  if (error) return <ErrorBanner error={error} />;

  const totalHours = filtered.reduce((s, e) => s + Number(e.hours), 0);
  const billableUnbilled = filtered.filter((e) => e.billable && !e.billed && e.status === "Approved");
  const statusOptions = Array.from(new Set((entries || []).map((e) => e.status).filter(Boolean))) as string[];

  return (
    <div>
      {isAdmin && <ClockedInBoard />}

      <div style={{ marginBottom: 16 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Kiosk clock-ins/outs land here automatically. Use this to log internal time that isn't tied to a client —
          for billable client work, log it from that client's own Billing tab instead.
        </p>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="tt-entry-date">Date</label>
          <input id="tt-entry-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0, maxWidth: 100 }}>
          <label htmlFor="tt-hours">Hours</label>
          <input id="tt-hours" type="number" step="0.25" min="0" value={hours} onChange={(e) => setHours(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0, flex: 1, minWidth: 200 }}>
          <label htmlFor="tt-description">Description</label>
          <input id="tt-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What did you work on?" />
        </div>
        <button className="btn btn-primary" disabled={saving} onClick={handleSubmit}>{saving ? "Saving…" : "Log Time"}</button>
      </div>
      {formError && <ErrorBanner error={formError} />}

      {isAdmin && (
        <div className="field" style={{ maxWidth: 260, marginBottom: 12 }}>
          <label htmlFor="tt-user-filter">Filter by Staff Email</label>
          <input id="tt-user-filter" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} placeholder="Leave blank for everyone" />
        </div>
      )}

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Description, client, staff…" }}
        selects={[
          { label: "Status", value: statusFilter, options: statusOptions, onChange: setStatusFilter },
          { label: "Billable", value: billableFilter, options: ["billable", "internal"], onChange: setBillableFilter },
        ]}
        period={{ start: period.start, end: period.end, onStartChange: (v) => setPeriod((p) => ({ ...p, start: v })), onEndChange: (v) => setPeriod((p) => ({ ...p, end: v })), onActiveView: () => setPeriod(activeViewDates()) }}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        onExportCsv={() => exportCsv("time-entries.csv", [
          { key: "entry_date", label: "Date" }, { key: "user_email", label: "Staff" }, { key: "client_name", label: "Client" },
          { key: "hours", label: "Hours" }, { key: "description", label: "Description" }, { key: "hourly_rate", label: "Rate" },
          { key: "status", label: "Status" }, { key: "billed", label: "Billed" },
        ], filtered as unknown as Record<string, unknown>[])}
      />

      <div className="metric-grid" style={{ margin: "12px 0 16px" }}>
        <div className="metric"><div className="metric-label">Total Hours Shown</div><div className="metric-value">{totalHours.toFixed(2)}</div></div>
        <div className="metric"><div className="metric-label">Approved, Unbilled &amp; Billable</div><div className="metric-value">{billableUnbilled.length}</div></div>
      </div>

      {isAdmin && hoursByStaff.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <strong style={{ fontSize: 14 }}>Hours by Staff</strong>
          <div className="muted" style={{ fontSize: 12, margin: "2px 0 12px" }}>For the entries shown above.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {hoursByStaff.map((s) => (
              <div key={s.email} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 160, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
                <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--surface)", overflow: "hidden" }}>
                  <div style={{ width: `${hoursByStaff[0].hours > 0 ? (s.hours / hoursByStaff[0].hours) * 100 : 0}%`, height: "100%", background: "var(--teal)", borderRadius: 4 }} />
                </div>
                <div style={{ width: 56, textAlign: "right", fontSize: 12.5, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{s.hours.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {entries === null && !error && <div className="spinner-wrap">Loading time entries…</div>}

      {entries !== null && (
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
          <strong style={{ fontSize: 14 }}>Time Entries</strong>
          <span className="muted" style={{ fontSize: 12 }}>{filtered.length} of {entries.length} entries</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                {isAdmin && <th scope="col">Staff</th>}
                <th scope="col">Client</th>
                <th scope="col" style={{ textAlign: "right" }}>Hours</th>
                <th scope="col">Description</th>
                <th scope="col" style={{ textAlign: "right" }}>Rate</th>
                <th scope="col">Status</th>
                <th scope="col">Billed</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const isOwner = e.user_email === user?.email;
                const canDelete = !e.billed && (isAdmin || (isOwner && e.status === "Submitted"));
                return (
                  <tr key={e.time_entry_id}>
                    <td>{e.entry_date}</td>
                    {isAdmin && <td className="muted" style={{ fontSize: 12 }}>{e.user_name || e.user_email}</td>}
                    <td>{e.client_name || <span className="muted">—</span>}</td>
                    <td style={{ textAlign: "right" }}>{Number(e.hours).toFixed(2)}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{e.description || "—"}</td>
                    <td style={{ textAlign: "right" }}>{e.billable ? money(e.hourly_rate) : "—"}</td>
                    <td><StatusBadge status={e.status} /></td>
                    <td>{e.billed ? <span className="muted" style={{ fontSize: 12 }}>On {e.invoice_id}</span> : e.billable ? "Unbilled" : "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        {isAdmin && e.status === "Submitted" && (
                          <>
                            <button className="btn btn-sm" onClick={() => handleDecision(e.time_entry_id, "approve")}>Approve</button>
                            <button className="btn btn-sm" onClick={() => handleDecision(e.time_entry_id, "reject")}>Reject</button>
                          </>
                        )}
                        {canDelete && <button className="btn btn-sm" onClick={() => setEditingEntry(e)}>Edit</button>}
                        {canDelete && <button className="btn btn-sm" onClick={() => handleDelete(e.time_entry_id)}>Delete</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr><td colSpan={isAdmin ? 9 : 7} className="muted" style={{ textAlign: "center", padding: 24 }}>{entries?.length ? "No entries match." : "No time entries yet."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {editingEntry && (
        <EditTimeEntryModal
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onDone={() => { setEditingEntry(null); load(); }}
        />
      )}
    </div>
  );
}

function EditTimeEntryModal({ entry, onClose, onDone }: { entry: TimeEntry; onClose: () => void; onDone: () => void }) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const [entryDate, setEntryDate] = useState(entry.entry_date.slice(0, 10));
  const [hours, setHours] = useState(String(entry.hours));
  const [description, setDescription] = useState(entry.description || "");
  const [billable, setBillable] = useState(entry.billable);
  const [hourlyRate, setHourlyRate] = useState(entry.hourly_rate != null ? String(entry.hourly_rate) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) return setError("Hours must be a positive number.");
    if (entry.client_id && billable && (!Number(hourlyRate) || Number(hourlyRate) <= 0)) return setError("Enter an hourly rate for billable time.");
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/time-tracking/entries/${entry.time_entry_id}`, {
        entryDate, hours: h, description: description.trim() || undefined,
        billable: entry.client_id ? billable : undefined,
        hourlyRate: entry.client_id && billable ? Number(hourlyRate) : undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this entry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="edit-time-entry-title" style={{ width: "min(480px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2 id="edit-time-entry-title">Edit Time Entry</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
        {error && <ErrorBanner error={error} />}
        <div className="form-grid">
          <div className="field"><label htmlFor="ete-date">Date</label><input id="ete-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div>
          <div className="field"><label htmlFor="ete-hours">Hours</label><input id="ete-hours" type="number" step="0.25" min="0" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="ete-description">Description</label><input id="ete-description" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        {entry.client_id && (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
              Billable to {entry.client_name}
            </label>
            {billable && (
              <div className="field" style={{ maxWidth: 140 }}>
                <label htmlFor="ete-rate">Rate/hr</label>
                <input id="ete-rate" type="number" step="0.01" min="0" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
              </div>
            )}
          </>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
