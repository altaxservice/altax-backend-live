import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Client } from "../api/types";
import { useToast } from "./Toast";
import { useConfirm, useNotify } from "./ConfirmProvider";

/** Fix Center control for the monthly client summary email: master switch (off until previewed), preview any client's email, and send yourself a test copy. */
export function MonthlySummaryPanel() {
  const toast = useToast();
  const notify = useNotify();
  const confirmDialog = useConfirm();
  const [state, setState] = useState<{ enabled: boolean; eligibleClients: number } | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [preview, setPreview] = useState<{ to: string; subject: string; body: string; skipped: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get<{ enabled: boolean; eligibleClients: number }>("/client-portal/monthly-summary/settings").then(setState).catch(() => setState(null));
  useEffect(() => { load(); api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => {}); }, []);

  async function toggle() {
    if (!state) return;
    const next = !state.enabled;
    if (next) {
      const ok = await confirmDialog({ title: "Turn on monthly client summaries?", message: `On the 2nd of each month at 8:00 AM ET, about ${state.eligibleClients} clients with an email on file will receive last month's results, what's waiting on them and their next deadlines. Have you previewed it with "Send me a test"?`, confirmLabel: "Turn on" });
      if (!ok) return;
    }
    try { await api.post("/client-portal/monthly-summary/settings", { enabled: next }); toast(next ? "Monthly summaries are ON." : "Monthly summaries are OFF."); load(); }
    catch (err) { await notify(err instanceof ApiError ? err.message : "Could not change the setting."); }
  }

  async function doPreview() {
    if (!clientId) return;
    setBusy(true); setPreview(null);
    try { setPreview(await api.get(`/client-portal/monthly-summary/preview?clientId=${encodeURIComponent(clientId)}`)); }
    catch (err) { await notify(err instanceof ApiError ? err.message : "Could not build the preview."); }
    finally { setBusy(false); }
  }

  async function sendTest() {
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; sentTo: string; error?: string }>("/client-portal/monthly-summary/test", { clientId });
      if (r.ok) toast(`Test copy sent to ${r.sentTo}.`); else await notify(r.error || "The test email could not be sent.");
    } catch (err) { await notify(err instanceof ApiError ? err.message : "Could not send the test."); }
    finally { setBusy(false); }
  }

  return (
    <div className="command-panel" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <div>
          <h2 className="command-panel-title">Monthly Client Summary Email</h2>
          <div className="command-panel-note">The 2nd of each month, 8:00 AM ET — last month's results, what's waiting on the client, and their next deadlines (English + Arabic).</div>
        </div>
        {state && <button type="button" className={state.enabled ? "ghost-button" : "action-button"} onClick={toggle}>{state.enabled ? "Turn off" : "Turn on"}</button>}
      </div>
      <div style={{ padding: 16, display: "grid", gap: 12 }}>
        <div>
          Status: <strong style={{ color: state?.enabled ? "var(--green)" : "var(--amber)" }}>{state ? (state.enabled ? "ON" : "OFF — nothing is sent until you turn it on") : "…"}</strong>
          {state && <span className="muted"> · {state.eligibleClients} clients eligible (email on file, email allowed, portal on, "Monthly summary email" not turned off on the client)</span>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={clientId} onChange={(e) => { setClientId(e.target.value); setPreview(null); }} style={{ minWidth: 260 }}>
            <option value="">Pick a client to preview…</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
          </select>
          <button type="button" className="ghost-button" disabled={!clientId || busy} onClick={doPreview}>Preview</button>
          <button type="button" className="action-button" disabled={!clientId || busy} onClick={sendTest}>Send me a test</button>
        </div>
        {preview && (preview.skipped
          ? <p className="muted" style={{ margin: 0 }}>Nothing to report for this client this month, so no email would be sent.</p>
          : <div className="card" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}><div className="muted" style={{ marginBottom: 6 }}>To: {preview.to || "(no email on file)"} · Subject: {preview.subject}</div>{preview.body}</div>)}
      </div>
    </div>
  );
}
