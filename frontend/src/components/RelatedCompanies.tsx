import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useSelectedClient } from "../context/SelectedClientContext";
import { useConfirm, useNotify } from "./ConfirmProvider";
import { useToast } from "./Toast";

/**
 * "Related companies" for the client side panel: the confirmed owner group this company belongs to, and companies that look like they
 * have the same owner (same owner phone / email / name, or the same company phone / email). Staff confirm ("Same owner") or dismiss
 * ("Not related") each suggestion; nothing is linked automatically.
 */
export interface RelReason { kind: string; value: string; weight: number }
interface Member { clientId: string; clientName: string; status: string | null }
interface Suggestion { clientId: string; clientName: string; status: string | null; score: number; reasons: RelReason[]; otherGroup: { groupId: string; groupName: string } | null }
interface Payload { group: { groupId: string; groupName: string; members: Member[]; hiddenCount: number } | null; suggestions: Suggestion[] }

export function RelatedCompanies({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const { setSelectedClient } = useSelectedClient();
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const notify = useNotify();
  const toast = useToast();

  const load = useCallback(() => {
    api.get<Payload>(`/client-groups/related/${encodeURIComponent(clientId)}`).then(setData).catch(() => setData(null));
  }, [clientId]);
  useEffect(() => { setData(null); load(); }, [load]);

  function open(c: { clientId: string; clientName: string }) {
    setSelectedClient(c.clientId, c.clientName);
    if (location.pathname.startsWith("/clients/")) navigate(`/clients/${c.clientId}`);
    else if (location.pathname.startsWith("/accounting")) navigate(`/accounting?client=${encodeURIComponent(c.clientId)}`);
  }
  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { await fn(); toast(done); load(); } catch (e) { await notify(e instanceof ApiError ? e.message : "That did not work."); } finally { setBusy(false); }
  }
  async function sameOwner(s: Suggestion) {
    if (s.otherGroup && !(await confirm({ title: "Merge owner groups?", message: `${s.clientName} is already in “${s.otherGroup.groupName}”. Confirming joins that whole group to this one.`, confirmLabel: "Merge" }))) return;
    await run(() => api.post("/client-groups/confirm", { clientId, otherIds: [s.clientId] }), "Linked as the same owner.");
  }
  const notRelated = (s: Suggestion) => run(() => api.post("/client-groups/dismiss", { clientId, otherId: s.clientId }), "Won't suggest that again.");
  async function remove(m: Member) {
    if (!data?.group || !(await confirm({ title: "Remove from the owner group?", message: `${m.clientName} will no longer be listed with these companies.`, confirmLabel: "Remove", danger: true }))) return;
    await run(() => api.delete(`/client-groups/${data.group!.groupId}/members/${encodeURIComponent(m.clientId)}`), "Removed from the group.");
  }
  async function rename() {
    if (!data?.group) return;
    const name = window.prompt("Name this owner group", data.group.groupName);
    if (!name || !name.trim()) return;
    await run(() => api.patch(`/client-groups/${data.group!.groupId}`, { groupName: name.trim() }), "Group renamed.");
  }

  if (!data || (!data.group && !data.suggestions.length)) return null;
  const others = (data.group?.members || []).filter((m) => m.clientId !== clientId);
  return (
    <div className="client-panel-section related-co">
      <div className="small-label">Related companies</div>
      {data.group && (
        <div className="rc-group">
          <div className="rc-group-head"><strong>{data.group.groupName}</strong><button type="button" className="pnote-link" onClick={rename}>Rename</button></div>
          {others.map((m) => (
            <div key={m.clientId} className="rc-row">
              <button type="button" className="rc-name" onClick={() => open(m)}>{m.clientName}</button>
              <span className="muted rc-status">{m.status || ""}</span>
              <button type="button" className="rc-x" aria-label={`Remove ${m.clientName} from the group`} disabled={busy} onClick={() => remove(m)}>×</button>
            </div>
          ))}
          {data.group.hiddenCount > 0 && <div className="muted rc-note">+{data.group.hiddenCount} more not assigned to you</div>}
        </div>
      )}
      {data.suggestions.length > 0 && (
        <div className="rc-suggest">
          <div className="muted rc-note">{data.group ? "Might also be the same owner:" : "These may have the same owner:"}</div>
          {data.suggestions.map((s) => (
            <div key={s.clientId} className="rc-sug">
              <button type="button" className="rc-name" onClick={() => open(s)}>{s.clientName}</button>
              <div className="rc-chips">{s.reasons.map((r, i) => <span key={i} className={`rc-chip w${r.weight}`} title={r.value}>{r.kind}</span>)}{s.otherGroup && <span className="rc-chip">in “{s.otherGroup.groupName}”</span>}</div>
              <div className="rc-actions">
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => sameOwner(s)}>Same owner</button>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => notRelated(s)}>Not related</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
