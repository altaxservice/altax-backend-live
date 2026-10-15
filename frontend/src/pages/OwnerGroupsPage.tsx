import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { useConfirm, useNotify } from "../components/ConfirmProvider";
import { useToast } from "../components/Toast";
import type { RelReason } from "../components/RelatedCompanies";

/**
 * Owner groups (admin): confirm which companies share an owner. "Suggested" lists clusters the system found from owner/company phone,
 * email and name — tick the companies that really belong together, name the group and confirm, or dismiss the suggestion.
 * "Confirmed" lists the groups already made.
 */
interface SugClient { clientId: string; clientName: string; status: string | null; ownerName: string | null; groupName: string | null }
interface Suggestion { reasons: RelReason[]; clients: SugClient[] }
interface Group { groupId: string; groupName: string; members: { clientId: string; clientName: string; status: string | null }[] }
interface Overview { groups: Group[]; suggestions: Suggestion[] }

function SuggestionCard({ s, onDone }: { s: Suggestion; onDone: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(s.clients.map((c) => c.clientId)));
  const defaultName = s.clients.map((c) => c.ownerName).find((n) => n && n.trim()) || "";
  const [name, setName] = useState(defaultName ? `${defaultName.trim()} — companies` : "");
  const [busy, setBusy] = useState(false);
  const notify = useNotify(); const toast = useToast(); const confirm = useConfirm();
  const chosen = s.clients.filter((c) => picked.has(c.clientId));

  async function confirmGroup() {
    setBusy(true);
    try {
      await api.post("/client-groups/confirm", { clientId: chosen[0].clientId, otherIds: chosen.slice(1).map((c) => c.clientId), groupName: name.trim() || undefined });
      toast("Owner group saved."); onDone();
    } catch (e) { await notify(e instanceof ApiError ? e.message : "Could not save the group."); } finally { setBusy(false); }
  }
  async function dismissAll() {
    if (!(await confirm({ title: "These are not the same owner?", message: "The system will stop suggesting these companies together.", confirmLabel: "Not related" }))) return;
    setBusy(true);
    try {
      const ids = s.clients.map((c) => c.clientId);
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) await api.post("/client-groups/dismiss", { clientId: ids[i], otherId: ids[j] });
      toast("Dismissed."); onDone();
    } catch (e) { await notify(e instanceof ApiError ? e.message : "Could not dismiss."); } finally { setBusy(false); }
  }
  return (
    <div className="card og-card">
      <div className="rc-chips">{s.reasons.map((r, i) => <span key={i} className={`rc-chip w${r.weight}`}>{r.kind}: {r.value}</span>)}</div>
      <div className="og-list">
        {s.clients.map((c) => (
          <label key={c.clientId}>
            <input type="checkbox" checked={picked.has(c.clientId)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(c.clientId); else n.delete(c.clientId); return n; })} />
            <Link to={`/clients/${c.clientId}`}>{c.clientName}</Link>
            <span className="muted" style={{ fontSize: 12 }}>{c.ownerName ? `owner: ${c.ownerName}` : "no owner on file"}{c.status ? ` · ${c.status}` : ""}{c.groupName ? ` · already in “${c.groupName}”` : ""}</span>
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input aria-label="Group name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name (e.g. the owner's name)" style={{ flex: "1 1 220px", maxWidth: 340 }} />
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || chosen.length < 2} onClick={confirmGroup}>Confirm as one owner ({chosen.length})</button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={dismissAll}>Not related</button>
      </div>
    </div>
  );
}

export function OwnerGroupsPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notify = useNotify(); const toast = useToast(); const confirm = useConfirm();
  const load = useCallback(() => { api.get<Overview>("/client-groups/overview").then(setData).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load owner groups.")); }, []);
  useEffect(load, [load]);

  async function rename(g: Group) {
    const name = window.prompt("Name this owner group", g.groupName);
    if (!name || !name.trim()) return;
    try { await api.patch(`/client-groups/${g.groupId}`, { groupName: name.trim() }); toast("Renamed."); load(); } catch (e) { await notify(e instanceof ApiError ? e.message : "Could not rename."); }
  }
  async function removeMember(g: Group, clientId: string, clientName: string) {
    if (!(await confirm({ title: "Remove from the group?", message: clientName, confirmLabel: "Remove", danger: true }))) return;
    try { await api.delete(`/client-groups/${g.groupId}/members/${encodeURIComponent(clientId)}`); toast("Removed."); load(); } catch (e) { await notify(e instanceof ApiError ? e.message : "Could not remove."); }
  }

  if (error) return <ErrorBanner error={error} />;
  if (!data) return <div className="spinner-wrap">Loading…</div>;
  return (
    <div>
      <p className="muted" style={{ maxWidth: 760 }}>
        Companies that belong to the same owner. The system suggests them from the owner’s and the company’s phone, email and name; nothing is linked until you confirm.
        Confirmed groups show up in each company’s side panel and in search.
      </p>

      <h2 style={{ fontSize: 17, margin: "18px 0 8px" }}>Suggested ({data.suggestions.length})</h2>
      {data.suggestions.length === 0 && <p className="muted">Nothing left to review.</p>}
      {data.suggestions.map((s, i) => <SuggestionCard key={s.clients.map((c) => c.clientId).join("|") + i} s={s} onDone={load} />)}

      <h2 style={{ fontSize: 17, margin: "22px 0 8px" }}>Confirmed groups ({data.groups.length})</h2>
      {data.groups.length === 0 && <p className="muted">No confirmed groups yet.</p>}
      {data.groups.map((g) => (
        <div key={g.groupId} className="card og-card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong>{g.groupName}</strong><button type="button" className="pnote-link" onClick={() => rename(g)}>Rename</button></div>
          <div className="og-list">
            {g.members.map((m) => (
              <div key={m.clientId} className="rc-row">
                <Link to={`/clients/${m.clientId}`} className="rc-name">{m.clientName}</Link>
                <span className="muted rc-status">{m.status || ""}</span>
                <button type="button" className="rc-x" aria-label={`Remove ${m.clientName}`} onClick={() => removeMember(g, m.clientId, m.clientName)}>×</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
