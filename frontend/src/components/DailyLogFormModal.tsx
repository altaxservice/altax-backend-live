import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { Client, Task } from "../api/types";
import { ErrorBanner } from "./ErrorBanner";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface FirmServiceOption { key: string; label: string }

const CATEGORY_SUGGESTIONS = ["Call", "Filing", "Research", "Meeting", "Admin", "General"];

/**
 * Standalone Daily Log create/edit form, extracted from DailyLogPage so any
 * page can launch it pre-filled and cross-link an entry to a client/task —
 * Task Detail's "+ Log Work" action and Notes' "+ Log Work" row action reuse
 * this exact same form, alongside Daily Log's own inline New/Edit. Passing
 * no initial props at all reproduces a completely blank, unconnected entry —
 * every cross-link here is additive, never required.
 */
export function DailyLogFormModal({
  logId, initialClientId, initialTaskId, initialBody, initialCategory, initialServices,
  initialLoggedAt, initialTimeSpentHours, initialTimeSpentMinutes, onClose, onDone,
}: {
  logId?: string;
  initialClientId?: string; initialTaskId?: string; initialBody?: string; initialCategory?: string;
  initialServices?: string[]; initialLoggedAt?: string; initialTimeSpentHours?: string; initialTimeSpentMinutes?: string;
  onClose: () => void; onDone: () => void;
}) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  const [clients, setClients] = useState<Client[]>([]);
  const [serviceOptions, setServiceOptions] = useState<FirmServiceOption[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [formTasks, setFormTasks] = useState<Task[]>([]);

  const [body, setBody] = useState(initialBody || "");
  const [clientIds, setClientIds] = useState<string[]>(initialClientId ? [initialClientId] : []);
  const [taskId, setTaskId] = useState(initialTaskId || "");
  const [category, setCategory] = useState(initialCategory || "");
  const [services, setServices] = useState<string[]>(initialServices || []);
  const [loggedAt, setLoggedAt] = useState(initialLoggedAt || "");
  const [timeSpentHours, setTimeSpentHours] = useState(initialTimeSpentHours || "");
  const [timeSpentMinutes, setTimeSpentMinutes] = useState(initialTimeSpentMinutes || "");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => { api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => {}); }, []);
  useEffect(() => { api.get<{ services: FirmServiceOption[] }>("/daily-log/services").then((r) => setServiceOptions(r.services)).catch(() => {}); }, []);

  // The task picker only makes sense with exactly one client picked — a
  // task belongs to one client, so it's disabled the moment a 2nd client is
  // added and cleared whenever the selection changes away from a single one.
  useEffect(() => {
    if (clientIds.length !== 1) { setFormTasks([]); return; }
    api.get<{ tasks: Task[] }>(`/tasks?clientId=${encodeURIComponent(clientIds[0])}&status=all`)
      .then((r) => setFormTasks(r.tasks))
      .catch(() => setFormTasks([]));
  }, [clientIds]);

  function toggleClient(clientId: string) {
    setClientIds((prev) => {
      const has = prev.includes(clientId);
      const next = has ? prev.filter((id) => id !== clientId) : [...prev, clientId];
      if (next.length !== 1) setTaskId("");
      return next;
    });
  }

  function toggleService(key: string) {
    setServices((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  const filteredClientOptions = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.client_name.toLowerCase().includes(q));
  }, [clients, clientSearch]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) { setSaveError("Describe what you worked on."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        body: body.trim(), clientIds, taskId: taskId || undefined,
        category: category.trim() || undefined, services, loggedAt: loggedAt || undefined,
        timeSpentHours: timeSpentHours || undefined, timeSpentMinutes: timeSpentMinutes || undefined,
      };
      if (logId) {
        // Editing stays single-client (see dailyLog.routes.ts) — send just the one id, if any.
        await api.post(`/daily-log/${logId}/edit`, { ...payload, clientId: clientIds[0] || undefined });
      } else {
        await api.post("/daily-log", payload);
      }
      onDone();
      onClose();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save this entry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="daily-log-form-title" style={{ width: "min(640px, 94vw)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="daily-log-form-title">{logId ? "Edit Entry" : "Log Work"}</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {saveError && <ErrorBanner error={saveError} />}
          <div className="field">
            <label htmlFor="dl-body">What did you work on, and what did you do about it?</label>
            <textarea id="dl-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="e.g. Filed sales tax for these clients — all confirmed on the state portal, no balance due." />
          </div>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "1 1 260px", maxWidth: 320 }}>
              <label htmlFor="dl-client-search">Client(s) (optional — pick as many as apply)</label>
              <input
                id="dl-client-search"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Search clients…"
                style={{ marginBottom: 4 }}
              />
              {clientIds.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                  {clientIds.map((id) => {
                    const c = clients.find((cl) => cl.client_id === id);
                    return (
                      <span key={id} className="status-pill status-gray" style={{ fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {c?.client_name || id}
                        <button type="button" onClick={() => toggleClient(id)} aria-label={`Remove ${c?.client_name || id}`} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, fontWeight: 800 }}>×</button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div style={{ maxHeight: 150, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 6, padding: 4 }}>
                {filteredClientOptions.length === 0 && <p className="muted" style={{ fontSize: 11.5, margin: 4 }}>No matches.</p>}
                {filteredClientOptions.slice(0, 200).map((c) => (
                  <label key={c.client_id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "3px 4px", cursor: "pointer" }}>
                    <input type="checkbox" checked={clientIds.includes(c.client_id)} onChange={() => toggleClient(c.client_id)} />
                    {c.client_name}
                  </label>
                ))}
              </div>
            </div>

            <div className="field" style={{ flex: "1 1 260px", maxWidth: 320 }}>
              <label>Service(s) (optional — pick as many as apply)</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", border: "1px solid var(--line)", borderRadius: 6, padding: 8, maxHeight: 150, overflowY: "auto" }}>
                {serviceOptions.map((s) => (
                  <label key={s.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", flex: "1 1 140px" }}>
                    <input type="checkbox" checked={services.includes(s.key)} onChange={() => toggleService(s.key)} />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "1 1 200px" }}>
              <label htmlFor="dl-when">Date &amp; time</label>
              <input id="dl-when" type="datetime-local" value={loggedAt} onChange={(e) => setLoggedAt(e.target.value)} />
              <span className="muted" style={{ fontSize: 10.5 }}>Blank = right now</span>
            </div>
            <div className="field" style={{ flex: "1 1 200px" }}>
              <label htmlFor="dl-task">Task (optional)</label>
              <select id="dl-task" value={taskId} onChange={(e) => setTaskId(e.target.value)} disabled={clientIds.length !== 1}>
                <option value="">
                  {clientIds.length === 1 ? "No specific task" : clientIds.length === 0 ? "Pick a client first" : "Pick just one client to link a task"}
                </option>
                {formTasks.map((t) => <option key={t.task_id} value={t.task_id}>{t.task_name}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: "1 1 150px" }}>
              <label htmlFor="dl-category">Category (optional)</label>
              <input id="dl-category" list="dl-category-list" value={category} onChange={(e) => setCategory(e.target.value)} />
              <datalist id="dl-category-list">
                {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="field" style={{ flex: "1 1 170px" }}>
              <label htmlFor="dl-hours">Time spent (optional)</label>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input id="dl-hours" type="number" min="0" step="1" placeholder="hrs" value={timeSpentHours} onChange={(e) => setTimeSpentHours(e.target.value)} style={{ width: 56 }} />
                <span className="muted" style={{ fontSize: 12 }}>h</span>
                <input id="dl-minutes" type="number" min="0" max="59" step="5" placeholder="min" value={timeSpentMinutes} onChange={(e) => setTimeSpentMinutes(e.target.value)} style={{ width: 56 }} />
                <span className="muted" style={{ fontSize: 12 }}>m</span>
              </div>
              <span className="muted" style={{ fontSize: 10.5 }}>For your own awareness — not billing. Use Time Tracking for billable hours.</span>
            </div>
          </div>
          {clientIds.length > 1 && (
            <p className="muted" style={{ fontSize: 11, margin: 0 }}>
              This will create {clientIds.length} separate entries — one per client, all sharing this same text, services, and time.
            </p>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : logId ? "Save Changes" : "Save Entry"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
