import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import { usePrompt, useNotify } from "./ConfirmProvider";
import { fmtDateOnly } from "../utils/date";

interface DraftPreview { wouldCreate: number; wouldSkip: number }
interface TaskBatchDraft {
  task_batch_draft_id: string; rule_id: string; task_type: string; frequency: string | null;
  period_label: string; due_date: string; matched_client_count: number; status: string;
  staff_overrides: Record<string, any> | null;
  preview: DraftPreview | null; previewError: string | null;
}
interface AgentSummary { active: boolean; ruleCount: number; pendingCount: number; rangeLabel: string | null; autoRunEnabled: boolean }

function DraftRow({ draft, selected, onToggleSelect, onChanged }: { draft: TaskBatchDraft; selected: boolean; onToggleSelect: () => void; onChanged: () => void }) {
  const notify = useNotify();
  const promptFor = usePrompt();
  const [editing, setEditing] = useState(false);
  const [assignedTo, setAssignedTo] = useState(String(draft.staff_overrides?.assignedTo ?? ""));
  const [notes, setNotes] = useState(String(draft.staff_overrides?.notes ?? ""));
  const [busy, setBusy] = useState(false);

  async function saveOverrides() {
    await api.patch(`/rules/batch-drafts/${draft.task_batch_draft_id}`, { overrides: { assignedTo: assignedTo || undefined, notes: notes || undefined } });
  }

  async function handleApprove() {
    setBusy(true);
    try {
      if (editing) await saveOverrides();
      await api.post(`/rules/batch-drafts/${draft.task_batch_draft_id}/approve`, {});
      onChanged();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not approve this draft.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDismiss() {
    const reason = await promptFor({ message: `Dismiss the ${draft.period_label} batch for ${draft.task_type}? You can add a note for why (optional).`, placeholder: "Reason (optional)" });
    if (reason === null) return;
    setBusy(true);
    try {
      await api.post(`/rules/batch-drafts/${draft.task_batch_draft_id}/dismiss`, { reason: reason || undefined });
      onChanged();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not dismiss this draft.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`Select the ${draft.period_label} batch for ${draft.task_type}`} />
        <div style={{ minWidth: 200 }}>
          <div style={{ fontWeight: 700 }}>{draft.task_type}</div>
          <div className="muted" style={{ fontSize: 12 }}>{draft.period_label} · Due {fmtDateOnly(draft.due_date)}</div>
        </div>
        <div className="muted" style={{ fontSize: 12.5 }}>
          {draft.previewError
            ? draft.previewError
            : draft.preview
              ? <>Will create <strong>{draft.preview.wouldCreate}</strong> task(s), skip <strong>{draft.preview.wouldSkip}</strong> duplicate(s)</>
              : `${draft.matched_client_count} client(s) matched when drafted`}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="ghost-button btn-sm" disabled={busy} onClick={() => setEditing((e) => !e)}>{editing ? "Cancel Edit" : "Edit"}</button>
          <button type="button" className="ghost-button btn-sm" disabled={busy} onClick={handleDismiss}>Dismiss</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy || Boolean(draft.previewError)} onClick={handleApprove}>{busy ? "…" : "Approve"}</button>
        </div>
      </div>

      {editing && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 12, maxWidth: 480 }}>
          <div className="field" style={{ margin: 0 }}><label htmlFor={`tra-assigned-${draft.task_batch_draft_id}`}>Assigned To</label><input id={`tra-assigned-${draft.task_batch_draft_id}`} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="Each client's assigned staff" /></div>
          <div className="field" style={{ margin: 0 }}><label htmlFor={`tra-notes-${draft.task_batch_draft_id}`}>Notes</label><input id={`tra-notes-${draft.task_batch_draft_id}`} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
      )}
    </div>
  );
}

/**
 * The Task Rules Agent's review screen — every draft here is a Pending row
 * in v3_task_batch_drafts, none of them real tasks yet. Approve calls the
 * same POST /rules/:ruleId/batch logic (via the shared runRuleBatch on the
 * backend) the manual Create Batch Tasks flow already uses, matched fresh
 * against whichever clients the rule matches right now; Dismiss just marks
 * the draft aside with nothing created. Embedded directly in the Rules page
 * rather than a separate route, since it's tightly bound to the rules list
 * right above it.
 */
export function TaskRulesAgentPanel({ onBatchCreated }: { onBatchCreated: () => void }) {
  const notify = useNotify();
  const [drafts, setDrafts] = useState<TaskBatchDraft[] | null>(null);
  const [summary, setSummary] = useState<AgentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);
  const [togglingAutoRun, setTogglingAutoRun] = useState(false);

  function load() {
    api.get<{ drafts: TaskBatchDraft[] }>("/rules/batch-drafts?status=Pending")
      .then((res) => { setDrafts(res.drafts); setSelected(new Set()); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load pending batches."));
  }
  function loadSummary() {
    api.get<AgentSummary>("/rules/agent/summary").then(setSummary).catch(() => {});
  }
  useEffect(() => { load(); loadSummary(); }, []);

  function refreshAll() { load(); loadSummary(); onBatchCreated(); }

  async function handleToggleAutoRun() {
    if (!summary || togglingAutoRun) return;
    const next = !summary.autoRunEnabled;
    setTogglingAutoRun(true);
    try {
      await api.post("/rules/agent/settings", { autoRunEnabled: next });
      setSummary((s) => (s ? { ...s, autoRunEnabled: next } : s));
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not update the auto-run setting.");
    } finally {
      setTogglingAutoRun(false);
    }
  }

  async function handleRun() {
    setRunning(true);
    try {
      const res = await api.post<{ created: any[]; skipped: number; errors: string[] }>("/rules/agent/run", {});
      await notify(`Task Rules Agent ran: ${res.created.length} new batch draft${res.created.length === 1 ? "" : "s"}, ${res.skipped} not due yet or already drafted.`);
      load();
      loadSummary();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not run the Task Rules Agent.");
    } finally {
      setRunning(false);
    }
  }

  async function handleApproveBulk() {
    if (!selected.size) return;
    setBulkApproving(true);
    try {
      const res = await api.post<{ succeeded: number; failed: number; results: any[] }>("/rules/batch-drafts/approve-bulk", { draftIds: Array.from(selected) });
      await notify(`${res.succeeded} approved${res.failed ? `, ${res.failed} failed` : ""}.`);
      refreshAll();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not approve the selected batches.");
    } finally {
      setBulkApproving(false);
    }
  }

  const sortedDrafts = useMemo(() => [...(drafts || [])].sort((a, b) => a.due_date.localeCompare(b.due_date)), [drafts]);

  if (error) return <p className="muted" style={{ fontSize: 13, color: "var(--red)" }}>{error}</p>;

  return (
    <div className="command-panel" style={{ marginBottom: 24 }}>
      <div className="command-panel-header">
        <div>
          <h2 className="command-panel-title">Task Rules Agent {summary && <span className={`status-pill ${summary.autoRunEnabled ? "status-green" : "status-gray"}`} style={{ marginLeft: 8 }}>{summary.autoRunEnabled ? "Auto-Draft On" : "Auto-Draft Off"}</span>}</h2>
          <div className="command-panel-note">
            Ahead of each rule's next due date, a draft batch shows up below for review — nothing is created until you Approve it.
            {summary && (
              <>
                {" "}
                <button type="button" className="ghost-button btn-sm" style={{ border: "none", padding: 0, background: "none", fontSize: 12.5, color: "var(--teal)" }} disabled={togglingAutoRun} onClick={handleToggleAutoRun} title="Only pauses the automatic nightly run — Run Agent Now and Create Batch Tasks are unaffected.">
                  {togglingAutoRun ? "Saving…" : summary.autoRunEnabled ? "Turn off automatic nightly drafting" : "Turn on automatic nightly drafting"}
                </button>
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {selected.size > 0 && (
            <button type="button" className="btn btn-primary" disabled={bulkApproving} onClick={handleApproveBulk}>
              {bulkApproving ? "Approving…" : `Approve Selected (${selected.size})`}
            </button>
          )}
          <button type="button" className="ghost-button" disabled={running} onClick={handleRun}>{running ? "Running…" : "Run Agent Now"}</button>
        </div>
      </div>

      {!drafts ? (
        <p className="muted" style={{ padding: 16, margin: 0 }}>Loading…</p>
      ) : drafts.length === 0 ? (
        <p className="muted" style={{ padding: 16, margin: 0 }}>
          No pending batches right now. Drafts appear here automatically as each rule nears its next due date, or click "Run Agent Now" to check immediately.
        </p>
      ) : (
        sortedDrafts.map((draft) => (
          <DraftRow
            key={draft.task_batch_draft_id}
            draft={draft}
            selected={selected.has(draft.task_batch_draft_id)}
            onToggleSelect={() => setSelected((s) => { const next = new Set(s); next.has(draft.task_batch_draft_id) ? next.delete(draft.task_batch_draft_id) : next.add(draft.task_batch_draft_id); return next; })}
            onChanged={refreshAll}
          />
        ))
      )}
    </div>
  );
}
