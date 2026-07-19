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

/** True when a rule has real match criteria (as opposed to "Custom"/"Other" rules, which have no trigger_column and are always built manually, client by client). */
function ruleHasAutoMatch(rule: TaskRule | null): boolean {
  return Boolean(rule && String(rule.trigger_column || "").trim());
}

/** TR-005 sorts before TR-005A, TR-014 before TR-014Q, etc. — plain string sort puts TR-011 before TR-002, which makes a 19-row dropdown hard to scan. */
function ruleSortKey(ruleId: string): [number, string] {
  const m = ruleId.match(/^TR-(\d+)([A-Z]*)$/);
  return m ? [Number(m[1]), m[2]] : [Number.MAX_SAFE_INTEGER, ruleId];
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
  const [showAllClients, setShowAllClients] = useState(false);
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
      .then((res) => setStaffOptions(Array.from(new Set(res.users.filter((u) => ["admin", "staff"].includes(String(u.role || "").toLowerCase()) && u.active).map((u) => u.name))).sort()))
      .catch(() => {});
  }, []);

  const sortedRules = useMemo(() => [...rules].sort((a, b) => {
    const [an, as] = ruleSortKey(a.rule_id);
    const [bn, bs] = ruleSortKey(b.rule_id);
    return an !== bn ? an - bn : as.localeCompare(bs);
  }), [rules]);

  const rule = rules.find((r) => r.rule_id === ruleId) || null;
  const autoMatch = ruleHasAutoMatch(rule);
  const matchCount = useMemo(() => (rule ? clients.filter((c) => clientMatchesRule(c, rule)).length : 0), [clients, rule]);

  // Picking a rule re-selects clients from scratch: every client the rule's criteria matches, checked
  // and ready to go. Rules with no match criteria (Custom/Other) can't be auto-selected, so those fall
  // back to an empty selection with the full client list showing, same as before this rework.
  useEffect(() => {
    if (autoMatch) {
      setSelected(new Set(clients.filter((c) => clientMatchesRule(c, rule)).map((c) => c.client_id)));
      setShowAllClients(false);
    } else {
      setSelected(new Set());
      setShowAllClients(true);
    }
    setPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleId, clients]);

  const salesTaxOptions = useMemo(() => Array.from(new Set(clients.map((c) => c.sales_tax_frequency).filter(Boolean))) as string[], [clients]);
  const payrollOptions = useMemo(() => Array.from(new Set(clients.map((c) => c.payroll_frequency).filter(Boolean))) as string[], [clients]);

  const visibleClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = clients.filter((c) => {
      if (!showAllClients && !clientMatchesRule(c, rule)) return false;
      if (statusFilter !== "all" && String(c.status || "") !== statusFilter) return false;
      if (salesTaxFilter !== "all" && String(c.sales_tax_frequency || "") !== salesTaxFilter) return false;
      if (payrollFilter !== "all" && String(c.payroll_frequency || "") !== payrollFilter) return false;
      if (q && ![c.client_name, c.client_id].some((v) => String(v || "").toLowerCase().includes(q))) return false;
      return true;
    });
    // Selected clients bubble to the top so the batch is easy to review at a glance —
    // most useful in "All Clients" view, where selections would otherwise be scattered
    // alphabetically through the full list. Array.sort is stable, so alphabetical order
    // is preserved within the selected and unselected groups.
    return [...filtered].sort((a, b) => Number(selected.has(b.client_id)) - Number(selected.has(a.client_id)));
  }, [clients, search, statusFilter, salesTaxFilter, payrollFilter, showAllClients, rule, selected]);

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
  function resetToRuleMatches() {
    setSelected(new Set(clients.filter((c) => clientMatchesRule(c, rule)).map((c) => c.client_id)));
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
          <select value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
            {sortedRules.map((r) => (
              <option key={r.rule_id} value={r.rule_id}>
                {r.rule_id} - {r.task_type}{r.trigger_column ? ` (${r.trigger_column} ${r.trigger_value})` : ""}
              </option>
            ))}
          </select>
          {rule && (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
              {autoMatch
                ? <><strong style={{ color: "var(--teal)" }}>{matchCount} client{matchCount === 1 ? "" : "s"}</strong> match this rule and {matchCount === 1 ? "is" : "are"} already selected below.</>
                : "This rule (Custom/Other) has no auto-match criteria — pick clients manually below."}
            </p>
          )}
        </div>

        <div className="form-section-title">Clients</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
          {autoMatch && (
            <div className="btn-group" style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
              <button type="button" className="btn btn-sm" style={!showAllClients ? { background: "var(--teal)", color: "#fff", border: "none", borderRadius: 0 } : { border: "none", borderRadius: 0 }} onClick={() => setShowAllClients(false)}>
                Rule Matches ({matchCount})
              </button>
              <button type="button" className="btn btn-sm" style={showAllClients ? { background: "var(--teal)", color: "#fff", border: "none", borderRadius: 0 } : { border: "none", borderRadius: 0 }} onClick={() => setShowAllClients(true)}>
                All Clients ({clients.length})
              </button>
            </div>
          )}
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
        <div style={{ display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={addClientId} onChange={(e) => setAddClientId(e.target.value)} style={{ minWidth: 180 }}>
            <option value="">Add one more client…</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
          </select>
          <button type="button" className="btn btn-sm" onClick={addClient}>Add</button>
          <button type="button" className="btn btn-sm" onClick={selectVisible}>Select All Shown</button>
          {autoMatch && <button type="button" className="btn btn-sm" onClick={resetToRuleMatches}>Reset to Rule Matches</button>}
          <button type="button" className="btn btn-sm" onClick={clearSelection}>Clear Selection</button>
          <span className="muted" style={{ fontSize: 12 }}>{selected.size} selected | {visibleClients.length} shown</span>
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
                    {autoMatch && <span style={matches ? { color: "var(--teal)", fontWeight: 800 } : undefined}>{matches ? "RULE MATCH" : "MANUAL"}</span>}
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
        {!canPreview && !preview && (
          <p className="muted" style={{ fontSize: 12, color: "var(--danger, #b91c1c)" }}>
            Fill in {!periodLabel && "Period Label"}{!periodLabel && !dueDate && " and "}{!dueDate && "Agency Due Date"} to review this batch.
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!canPreview || busy} onClick={handlePreview}>{busy && !preview ? "Reviewing…" : "Review Batch"}</button>
          {preview && <button type="button" className="btn btn-primary" disabled={busy || preview.wouldCreate === 0} onClick={handleCommit}>{busy ? "Posting…" : "Post Batch Tasks"}</button>}
        </div>
      </div>
    </div>
  );
}
