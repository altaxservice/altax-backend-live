import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Client } from "../api/types";
import type { TaskRule, PortalUser } from "../api/types2";
import { clientMatchesRule } from "../utils/ruleMatch";
import { useToast } from "./Toast";

interface PreviewResult {
  wouldCreate: number;
  wouldSkip: number;
  results: { clientId: string; clientName: string; action: "create" | "skip" }[];
}

/** Mirrors legacy's "Create Batch Tasks" modal — reachable from both the Tasks toolbar and each Rules row's "Run Batch" button. */
export function CreateBatchTasksModal({ rules, initialRuleId, onClose, onDone }: { rules: TaskRule[]; initialRuleId?: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [ruleId, setRuleId] = useState(initialRuleId || rules[0]?.rule_id || "");
  const [clients, setClients] = useState<Client[]>([]);
  const [staffOptions, setStaffOptions] = useState<string[]>([]);
  const [addClientId, setAddClientId] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [salesTaxFilter, setSalesTaxFilter] = useState("all");
  const [payrollFilter, setPayrollFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [periodLabel, setPeriodLabel] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [staffDueDate, setStaffDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ clients: Client[] }>("/clients").then((res) => setClients(res.clients)).catch(() => {});
    api.get<{ users: PortalUser[] }>("/users")
      .then((res) => setStaffOptions(Array.from(new Set(res.users.filter((u) => ["admin", "staff"].includes(u.role) && u.active).map((u) => u.name))).sort()))
      .catch(() => {});
  }, []);

  const rule = rules.find((r) => r.rule_id === ruleId) || null;

  const salesTaxOptions = useMemo(() => Array.from(new Set(clients.map((c) => c.sales_tax_frequency).filter(Boolean))) as string[], [clients]);
  const payrollOptions = useMemo(() => Array.from(new Set(clients.map((c) => c.payroll_frequency).filter(Boolean))) as string[], [clients]);

  const visibleClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (statusFilter !== "all" && String(c.status || "") !== statusFilter) return false;
      if (salesTaxFilter !== "all" && String(c.sales_tax_frequency || "") !== salesTaxFilter) return false;
      if (payrollFilter !== "all" && String(c.payroll_frequency || "") !== payrollFilter) return false;
      if (q && ![c.client_name, c.client_id].some((v) => String(v || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [clients, search, statusFilter, salesTaxFilter, payrollFilter]);

  function toggle(clientId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(clientId) ? next.delete(clientId) : next.add(clientId);
      return next;
    });
    setPreview(null);
  }

  function selectVisible() {
    setSelected((prev) => new Set([...prev, ...visibleClients.map((c) => c.client_id)]));
    setPreview(null);
  }
  function selectMatchingRule() {
    const matched = visibleClients.filter((c) => clientMatchesRule(c, rule)).map((c) => c.client_id);
    setSelected((prev) => new Set([...prev, ...matched]));
    setPreview(null);
  }
  function selectAllActive() {
    const active = clients.filter((c) => String(c.status || "").toLowerCase() === "active").map((c) => c.client_id);
    setSelected(new Set(active));
    setPreview(null);
  }
  function clearSelection() {
    setSelected(new Set());
    setPreview(null);
  }
  function addClient() {
    if (addClientId) { setSelected((prev) => new Set(prev).add(addClientId)); setAddClientId(""); setPreview(null); }
  }

  async function handlePreview() {
    if (!ruleId || !periodLabel || !dueDate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<PreviewResult>(`/rules/${ruleId}/batch`, {
        dryRun: true, periodLabel, periodStart, periodEnd, dueDate, staffDueDate, assignedTo, notes,
        clientIds: selected.size > 0 ? Array.from(selected) : undefined,
      });
      setPreview(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not preview this batch.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    if (!ruleId || !preview) return;
    if (!confirm(`Create ${preview.wouldCreate} task(s)? This can't be easily undone in bulk.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ created: number; skipped: number }>(`/rules/${ruleId}/batch`, {
        periodLabel, periodStart, periodEnd, dueDate, staffDueDate, assignedTo, notes,
        clientIds: selected.size > 0 ? Array.from(selected) : undefined,
      });
      toast(`Batch created: ${res.created} task(s), ${res.skipped} skipped.`);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not run this batch.");
    } finally {
      setBusy(false);
    }
  }

  const canPreview = Boolean(ruleId && periodLabel && dueDate);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 720, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Create Batch Tasks</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        {error && <div className="error-banner">{error}</div>}

        <div className="field">
          <label>Rule</label>
          <select value={ruleId} onChange={(e) => { setRuleId(e.target.value); setPreview(null); }}>
            {rules.map((r) => (
              <option key={r.rule_id} value={r.rule_id}>
                {r.rule_id} - {r.task_type}{r.trigger_column ? ` (${r.trigger_column} ${r.trigger_value})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="form-section-title">Clients</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <select value={addClientId} onChange={(e) => setAddClientId(e.target.value)} style={{ flex: 1, minWidth: 180 }}>
            <option value="">Add a client…</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
          </select>
          <button type="button" className="btn btn-sm" onClick={addClient}>Add Selected Client</button>
          <input placeholder="Search name, ID…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 140, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)" }} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All Status</option>
            <option>Active</option><option>Inactive</option><option>Archived</option>
          </select>
          <select value={salesTaxFilter} onChange={(e) => setSalesTaxFilter(e.target.value)}>
            <option value="all">All Sales Tax</option>
            {salesTaxOptions.map((o) => <option key={o}>{o}</option>)}
          </select>
          <select value={payrollFilter} onChange={(e) => setPayrollFilter(e.target.value)}>
            <option value="all">All Payroll</option>
            {payrollOptions.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="btn btn-sm" onClick={selectVisible}>Select Visible</button>
          <button type="button" className="btn btn-sm" onClick={selectMatchingRule}>Select Matching Rule</button>
          <button type="button" className="btn btn-sm" onClick={selectAllActive}>Select All Active</button>
          <button type="button" className="btn btn-sm" onClick={clearSelection}>Clear</button>
          <span className="muted" style={{ fontSize: 12 }}>{selected.size} selected | {visibleClients.length} visible</span>
        </div>
        <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, marginBottom: 16 }}>
          {visibleClients.map((c) => {
            const matches = clientMatchesRule(c, rule);
            return (
              <label key={c.client_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--line)", fontSize: 12.5, cursor: "pointer" }}>
                <input type="checkbox" checked={selected.has(c.client_id)} onChange={() => toggle(c.client_id)} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{c.client_name}</div>
                  <div className="muted" style={{ display: "flex", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
                    <span>{c.client_id}</span>
                    <span>{c.status || "—"}</span>
                    <span>SALES {c.sales_tax_frequency || "N/A"}</span>
                    <span>PAYROLL {c.payroll_frequency || "N/A"}</span>
                    <span style={matches ? { color: "var(--teal)", fontWeight: 800 } : undefined}>{matches ? "RULE MATCH" : "MANUAL"}</span>
                  </div>
                </div>
              </label>
            );
          })}
          {visibleClients.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No clients match these filters.</p>}
        </div>

        <div className="form-grid">
          <div className="field"><label>Period Label</label><input value={periodLabel} onChange={(e) => { setPeriodLabel(e.target.value); setPreview(null); }} placeholder="e.g. June 2026" /></div>
          <div className="field"><label>Agency Due Date</label><input type="date" value={dueDate} onChange={(e) => { setDueDate(e.target.value); setPreview(null); }} /></div>
          <div className="field"><label>Period Start</label><input type="date" value={periodStart} onChange={(e) => { setPeriodStart(e.target.value); setPreview(null); }} /></div>
          <div className="field"><label>Period End</label><input type="date" value={periodEnd} onChange={(e) => { setPeriodEnd(e.target.value); setPreview(null); }} /></div>
          <div className="field">
            <label>Assigned To</label>
            <select value={assignedTo} onChange={(e) => { setAssignedTo(e.target.value); setPreview(null); }}>
              <option value="">Use client default staff</option>
              {staffOptions.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div className="field"><label>Staff Due Date</label><input type="date" value={staffDueDate} onChange={(e) => { setStaffDueDate(e.target.value); setPreview(null); }} /></div>
        </div>
        <div className="field"><label>Notes</label><textarea rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); setPreview(null); }} /></div>

        <p className="muted" style={{ fontSize: 12.5 }}>
          {selected.size} selected client(s). {preview
            ? <>Will create <strong>{preview.wouldCreate}</strong> task(s). <strong>{preview.wouldSkip}</strong> duplicate task(s) will be skipped.</>
            : "Review the batch first. Tasks are not posted until you click Post Batch Tasks, so Cancel stays available if something looks wrong."}
          {" "}Assigned to: {assignedTo || "each client's assigned staff"}.
        </p>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!canPreview || busy} onClick={handlePreview}>{busy && !preview ? "Reviewing…" : "Review Batch"}</button>
          {preview && <button type="button" className="btn btn-primary" disabled={busy || preview.wouldCreate === 0} onClick={handleCommit}>{busy ? "Posting…" : "Post Batch Tasks"}</button>}
        </div>
      </div>
    </div>
  );
}
