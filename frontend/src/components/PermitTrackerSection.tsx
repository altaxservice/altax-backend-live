import { DateInput } from "./DateInput";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";
import { useToast } from "./Toast";
import { useNotify } from "./ConfirmProvider";

interface PermitRow {
  key: string; label: string; hint: string; number: string; status: string;
  issuedDate: string | null; expiresDate: string | null; notes: string;
}
interface Draft { status: string; number: string; issuedDate: string; expiresDate: string; notes: string }

const STATUS_COLOR: Record<string, string> = {
  "Not Started": "var(--muted, #6b7280)", Applied: "var(--amber)", Scheduled: "var(--amber)", Issued: "var(--teal)", "Not Required": "var(--muted, #6b7280)",
};

function toDraft(p: PermitRow): Draft {
  return { status: p.status, number: p.number, issuedDate: p.issuedDate || "", expiresDate: p.expiresDate || "", notes: p.notes || "" };
}

/**
 * The approvals a business needs at a location — zoning use permit, certificate of occupancy, fire inspection,
 * health permit, trader's and tobacco licenses — each with a status, number and dates. The numbers are the same
 * ones on the Profile's Licenses & Permits section and the ones the Health Permits generator fills in, so a
 * number typed here shows up there.
 */
export function PermitTrackerSection({ clientId }: { clientId: string }) {
  const toast = useToast();
  const notify = useNotify();
  const [rows, setRows] = useState<PermitRow[] | null>(null);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [taskOpen, setTaskOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    api.get<{ permits: PermitRow[]; statuses: string[]; fireInspectionTaskOpen: boolean }>(`/clients/${clientId}/permits`)
      .then((r) => {
        setRows(r.permits); setStatuses(r.statuses); setTaskOpen(r.fireInspectionTaskOpen);
        setDrafts(Object.fromEntries(r.permits.map((p) => [p.key, toDraft(p)])));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the permit tracker."));
  }
  useEffect(load, [clientId]);

  const dirty = (p: PermitRow) => JSON.stringify(drafts[p.key]) !== JSON.stringify(toDraft(p));
  const set = (key: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [key]: { ...d[key], ...patch } }));

  async function save(p: PermitRow) {
    const d = drafts[p.key];
    setBusy(p.key);
    try {
      await api.put(`/clients/${clientId}/permits/${p.key}`, { status: d.status, number: d.number, issuedDate: d.issuedDate || null, expiresDate: d.expiresDate || null, notes: d.notes });
      toast(`${p.label} saved.`);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not save this permit.");
    } finally { setBusy(null); }
  }

  async function createFireTask() {
    setBusy("task");
    try {
      const r = await api.post<{ created: boolean }>(`/clients/${clientId}/permits/fire-inspection-task`, {});
      toast(r.created ? "Task created: schedule the fire inspection." : "A fire inspection task is already open for this client.");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not create the task.");
    } finally { setBusy(null); }
  }

  const done = (rows || []).filter((p) => p.status === "Issued" || p.status === "Not Required").length;

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)", flexWrap: "wrap", gap: 8 }}>
        <strong style={{ fontSize: 14 }}>Permits &amp; Approvals</strong>
        {rows && <span className="muted" style={{ fontSize: 12 }}>{done} of {rows.length} issued or not required</span>}
      </div>
      {error && <ErrorBanner error={error} style={{ margin: 16 }} />}
      {!rows && !error && <p className="muted" style={{ padding: 16 }}>Loading…</p>}
      {rows && (
        <div className="table-scroll">
          <table>
            <thead><tr><th scope="col">Permit</th><th scope="col">Status</th><th scope="col">Number</th><th scope="col">Issued</th><th scope="col">Expires</th><th scope="col">Notes</th><th scope="col"></th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const d = drafts[p.key] || toDraft(p);
                return (
                  <tr key={p.key}>
                    <td style={{ minWidth: 220 }}>
                      <div style={{ fontWeight: 600 }}>{p.label}</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>{p.hint}</div>
                      {p.key === "fire_inspection" && d.status !== "Issued" && d.status !== "Not Required" && (
                        <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} disabled={busy === "task" || taskOpen} onClick={createFireTask}>
                          {taskOpen ? "✓ Task open" : busy === "task" ? "Creating…" : "Create “Schedule fire inspection” task"}
                        </button>
                      )}
                    </td>
                    <td>
                      <select aria-label={`${p.label} status`} value={d.status} onChange={(e) => set(p.key, { status: e.target.value })} style={{ color: STATUS_COLOR[d.status], fontWeight: 600 }}>
                        {statuses.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td><input aria-label={`${p.label} number`} value={d.number} onChange={(e) => set(p.key, { number: e.target.value })} style={{ minWidth: 150 }} placeholder="Permit / certificate #" /></td>
                    <td><DateInput aria-label={`${p.label} issued date`} value={d.issuedDate} onChange={(e) => set(p.key, { issuedDate: e.target.value })} /></td>
                    <td><DateInput aria-label={`${p.label} expiry date`} value={d.expiresDate} onChange={(e) => set(p.key, { expiresDate: e.target.value })} /></td>
                    <td><input aria-label={`${p.label} notes`} value={d.notes} onChange={(e) => set(p.key, { notes: e.target.value })} style={{ minWidth: 180 }} placeholder="e.g. no building inspection required" /></td>
                    <td>
                      <button type="button" className="btn btn-sm btn-primary" disabled={!dirty(p) || busy === p.key} onClick={() => save(p)}>{busy === p.key ? "Saving…" : "Save"}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: 11.5, margin: 0, padding: "8px 16px", borderTop: "1px solid var(--line)" }}>
        Numbers entered here are the same ones on the Profile (Licenses &amp; Permits) and are filled into the Health Permit application for this client.
      </p>
    </div>
  );
}
