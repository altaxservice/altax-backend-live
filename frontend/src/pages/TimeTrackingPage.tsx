import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { StatusBadge } from "../components/StatusBadge";
import type { Client } from "../api/types";

interface TimeEntry {
  time_entry_id: string;
  user_email: string;
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

const money = (n: number | string | null | undefined) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Staff time tracking, with an optional billable rate per entry so approved
 * hours can be rolled into a real client invoice (see the "Create Invoice
 * from Unbilled Time" button on ClientDetailPage.tsx's Billing tab, which
 * bills whatever's Approved+billable+unbilled here). No frontend page existed
 * for the time-tracking backend before this — entries were reachable only via
 * direct API calls.
 */
export function TimeTrackingPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState("");

  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [clientId, setClientId] = useState("");
  const [hours, setHours] = useState("");
  const [description, setDescription] = useState("");
  const [billable, setBillable] = useState(false);
  const [hourlyRate, setHourlyRate] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function load() {
    const qs = isAdmin && userFilter ? `?userEmail=${encodeURIComponent(userFilter)}` : "";
    api.get<{ timeEntries: TimeEntry[] }>(`/time-tracking/entries${qs}`)
      .then((res) => setEntries(res.timeEntries))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load time entries."));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [userFilter]);
  useEffect(() => { api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => {}); }, []);

  async function handleSubmit() {
    setFormError(null);
    const h = Number(hours);
    if (!entryDate) return setFormError("Date is required.");
    if (!Number.isFinite(h) || h <= 0) return setFormError("Hours must be a positive number.");
    if (billable && (!Number(hourlyRate) || Number(hourlyRate) <= 0)) return setFormError("Enter an hourly rate for billable time.");
    setSaving(true);
    try {
      await api.post("/time-tracking/entries", {
        entryDate, clientId: clientId || undefined, hours: h, description: description.trim() || undefined,
        billable: billable && Boolean(clientId), hourlyRate: billable ? Number(hourlyRate) : undefined,
      });
      setHours(""); setDescription(""); setBillable(false); setHourlyRate("");
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
      alert(err instanceof ApiError ? err.message : "Could not update this entry.");
    }
  }

  if (error) return <ErrorBanner error={error} />;

  const totalHours = (entries || []).reduce((s, e) => s + Number(e.hours), 0);
  const billableUnbilled = (entries || []).filter((e) => e.billable && !e.billed && e.status === "Approved");

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Time Tracking</h1>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Log hours against a client to bill them for it, or leave the client blank for internal time.
        </p>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Date</label>
          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0, minWidth: 200 }}>
          <label>Client (optional)</label>
          <select value={clientId} onChange={(e) => { setClientId(e.target.value); if (!e.target.value) setBillable(false); }}>
            <option value="">Internal / no client</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0, maxWidth: 100 }}>
          <label>Hours</label>
          <input type="number" step="0.25" min="0" value={hours} onChange={(e) => setHours(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0, flex: 1, minWidth: 200 }}>
          <label>Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What did you work on?" />
        </div>
        {clientId && (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
              Billable
            </label>
            {billable && (
              <div className="field" style={{ margin: 0, maxWidth: 120 }}>
                <label>Rate/hr</label>
                <input type="number" step="0.01" min="0" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
              </div>
            )}
          </>
        )}
        <button className="btn btn-primary" disabled={saving} onClick={handleSubmit}>{saving ? "Saving…" : "Log Time"}</button>
      </div>
      {formError && <ErrorBanner error={formError} />}

      <div className="metric-grid" style={{ marginBottom: 16 }}>
        <div className="metric"><div className="metric-label">Total Hours Shown</div><div className="metric-value">{totalHours.toFixed(2)}</div></div>
        <div className="metric"><div className="metric-label">Approved, Unbilled &amp; Billable</div><div className="metric-value">{billableUnbilled.length}</div></div>
      </div>

      {isAdmin && (
        <div className="field" style={{ maxWidth: 260, marginBottom: 12 }}>
          <label>Filter by Staff Email</label>
          <input value={userFilter} onChange={(e) => setUserFilter(e.target.value)} placeholder="Leave blank for everyone" />
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                {isAdmin && <th>Staff</th>}
                <th>Client</th>
                <th style={{ textAlign: "right" }}>Hours</th>
                <th>Description</th>
                <th style={{ textAlign: "right" }}>Rate</th>
                <th>Status</th>
                <th>Billed</th>
                {isAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {(entries || []).map((e) => (
                <tr key={e.time_entry_id}>
                  <td>{e.entry_date}</td>
                  {isAdmin && <td className="muted" style={{ fontSize: 12 }}>{e.user_email}</td>}
                  <td>{e.client_name || <span className="muted">—</span>}</td>
                  <td style={{ textAlign: "right" }}>{Number(e.hours).toFixed(2)}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{e.description || "—"}</td>
                  <td style={{ textAlign: "right" }}>{e.billable ? money(e.hourly_rate) : "—"}</td>
                  <td><StatusBadge status={e.status} /></td>
                  <td>{e.billed ? <span className="muted" style={{ fontSize: 12 }}>On {e.invoice_id}</span> : e.billable ? "Unbilled" : "—"}</td>
                  {isAdmin && (
                    <td>
                      {e.status === "Submitted" && (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="btn btn-sm" onClick={() => handleDecision(e.time_entry_id, "approve")}>Approve</button>
                          <button className="btn btn-sm" onClick={() => handleDecision(e.time_entry_id, "reject")}>Reject</button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {!entries?.length && (
                <tr><td colSpan={isAdmin ? 9 : 7} className="muted" style={{ textAlign: "center", padding: 24 }}>No time entries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
