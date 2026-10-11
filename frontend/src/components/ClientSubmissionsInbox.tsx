import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Package, Receipt, ShoppingCart, TriangleAlert } from "lucide-react";
import { api, ApiError } from "../api/client";
import { useConfirm, useNotify, usePrompt } from "./ConfirmProvider";
import { ago } from "./WorkTrail";
import { fmtDateOnly as fmtDate } from "../utils/date";
import { useToast } from "./Toast";
import { TenderSplit } from "./TenderSplit";

export interface PendingSubmission {
  kind: "sales" | "purchase" | "asset"; draftId: string; clientId: string; clientName: string; date: string; amount: number; tax: number;
  notes: string | null; submittedAt: string; submittedBy: string | null; anomaly: boolean; averageGross: number | null;
  vendor?: string | null; account?: string; description?: string | null; receiptCount?: number; tenderCard?: number; tenderEbt?: number;
}
export interface PendingSubmissions { items: PendingSubmission[]; counts: { sales: number; purchases: number; assets?: number; total: number; clients: number } }

const money = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const path = (k: PendingSubmission["kind"]) => (k === "sales" ? "sales-drafts" : "purchase-drafts");
const ASSET_LIFE: Record<string, number> = { Equipment: 7, "Furniture & Fixtures": 7, Vehicle: 5, "Computer / Electronics": 5, "Leasehold Improvements": 15, Other: 5 };

/** Inline form for recording a client-reported asset: the reviewer picks the accounts and life; straight-line depreciation (use Accounting → Fixed Assets for MACRS / Section 179). */
function AssetRecordForm({ it, onDone, onCancel }: { it: PendingSubmission; onDone: () => void; onCancel: () => void }) {
  const notify = useNotify();
  const [accounts, setAccounts] = useState<string[]>([]);
  const [account, setAccount] = useState("Equipment");
  const [offset, setOffset] = useState("Cash");
  const [life, setLife] = useState(String(ASSET_LIFE[it.account || "Other"] || 5));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.get<{ accounts: { account_name: string; account_type: string }[] }>("/accounting/coa").then((r) => setAccounts(r.accounts.filter((a) => a.account_type === "Asset").map((a) => a.account_name))).catch(() => {});
  }, []);
  async function save() {
    setSaving(true);
    try {
      await api.post(`/client-portal/assets/drafts/${it.draftId}/approve`, { accountName: account, offsetAccount: offset, depreciationMethod: "Straight-Line", usefulLifeYears: Number(life) });
      onDone();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not record this asset.");
    } finally { setSaving(false); }
  }
  const options = Array.from(new Set(["Equipment", "Furniture & Fixtures", "Vehicles", "Computers & Electronics", "Leasehold Improvements", ...accounts]));
  return (
    <div className="cs-assetform">
      <label>Asset account<input list="cs-asset-accounts" value={account} onChange={(e) => setAccount(e.target.value)} /></label>
      <datalist id="cs-asset-accounts">{options.map((o) => <option key={o} value={o} />)}</datalist>
      <label>Paid from<input value={offset} onChange={(e) => setOffset(e.target.value)} /></label>
      <label>Useful life (years)<input type="number" min="1" value={life} onChange={(e) => setLife(e.target.value)} /></label>
      <div className="cs-actions">
        <button type="button" className="action-button btn-sm" disabled={saving} onClick={save}>{saving ? "Recording…" : "Record asset"}</button>
        <button type="button" className="ghost-button btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** Shared loader so the Command Center count, tab and inbox all read one source. */
export function usePendingSubmissions(refreshKey?: unknown): { data: PendingSubmissions | null; reload: () => void } {
  const [data, setData] = useState<PendingSubmissions | null>(null);
  const reload = useCallback(() => {
    api.get<PendingSubmissions>("/accounting/client-books/pending-submissions").then(setData).catch(() => setData({ items: [], counts: { sales: 0, purchases: 0, total: 0, clients: 0 } }));
  }, []);
  useEffect(() => { reload(); }, [reload, refreshKey]);
  return { data, reload };
}

/**
 * Firm-wide review inbox for what clients typed into My Books: every pending daily-sales and expense entry across all
 * clients, oldest first, grouped by client, with one-click Approve / Dismiss (and "Review & edit" for the full per-client
 * screen). Approving posts the entry to the books exactly as the Accounting → Client Submissions tab does.
 */
export function ClientSubmissionsInbox({ data, onChanged }: { data: PendingSubmissions | null; onChanged: () => void }) {
  const navigate = useNavigate();
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();
  const notify = useNotify();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [recording, setRecording] = useState<string | null>(null);
  // Card / EBT the reviewer fills in at approval (the client's own split is optional).
  const [tenderOpen, setTenderOpen] = useState<string | null>(null);
  const [tenderEdits, setTenderEdits] = useState<Record<string, { card: string; ebt: string }>>({});

  if (!data) return <p className="muted" style={{ padding: 16 }}>Loading client submissions…</p>;
  if (data.items.length === 0) {
    return <div className="cs-empty"><CheckCircle2 size={22} aria-hidden="true" /><div><b>Nothing waiting for review.</b><span>When a client logs sales or expenses in My Books, they appear here for approval.</span></div></div>;
  }

  const byClient = new Map<string, PendingSubmission[]>();
  for (const it of data.items) { if (!byClient.has(it.clientId)) byClient.set(it.clientId, []); byClient.get(it.clientId)!.push(it); }

  async function approve(it: PendingSubmission) {
    if (it.anomaly) {
      const ok = await confirmDialog({ title: "Unusual amount", message: `${it.clientName}'s ${money(it.amount)} is far from their recent daily average (${it.averageGross !== null ? money(it.averageGross) : "—"}). Approve anyway?`, confirmLabel: "Approve anyway" });
      if (!ok) return;
    }
    setBusy(it.draftId);
    try {
      const te = tenderEdits[it.draftId];
      await api.post(`/accounting/client-books/${path(it.kind)}/${it.draftId}/approve`, it.kind === "sales" && te ? { tenderCard: Number(te.card) || 0, tenderEbt: Number(te.ebt) || 0 } : {});
      toast(`Approved — ${it.clientName}, ${fmtDate(it.date)}.`);
      onChanged();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not approve this submission.");
    } finally { setBusy(null); }
  }

  async function dismiss(it: PendingSubmission) {
    const reason = await promptFor({ title: "Dismiss submission", message: "Why isn't this being used? (optional)", required: false });
    if (reason === null) return;
    setBusy(it.draftId);
    try {
      await api.post(it.kind === "asset" ? `/client-portal/assets/drafts/${it.draftId}/dismiss` : `/accounting/client-books/${path(it.kind)}/${it.draftId}/dismiss`, { reason });
      onChanged();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not dismiss this submission.");
    } finally { setBusy(null); }
  }

  async function approveAll(clientId: string, rows: PendingSubmission[]) {
    const flagged = rows.filter((r) => r.anomaly).length;
    const ok = await confirmDialog({
      title: "Approve all",
      message: `Approve ${rows.length} submission${rows.length === 1 ? "" : "s"} for ${rows[0].clientName}?${flagged ? ` ${flagged} look unusual compared with their recent average — review those individually if unsure.` : ""}`,
      confirmLabel: "Approve all",
    });
    if (!ok) return;
    setBusy(clientId);
    try {
      const sales = rows.filter((r) => r.kind === "sales").map((r) => r.draftId);
      const purchases = rows.filter((r) => r.kind === "purchase").map((r) => r.draftId);
      // Assets need accounts and a depreciation life, so they are recorded one at a time, never in bulk.
      const results: { ok: boolean; error?: string }[] = [];
      if (sales.length) results.push(...(await api.post<{ results: { ok: boolean; error?: string }[] }>("/accounting/client-books/sales-drafts/approve-bulk", { draftIds: sales })).results);
      if (purchases.length) results.push(...(await api.post<{ results: { ok: boolean; error?: string }[] }>("/accounting/client-books/purchase-drafts/approve-bulk", { draftIds: purchases })).results);
      const failed = results.filter((r) => !r.ok);
      toast(failed.length ? `${results.length - failed.length} approved, ${failed.length} could not be approved.` : `Approved ${results.length}.`);
      onChanged();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not approve these submissions.");
    } finally { setBusy(null); }
  }

  return (
    <div className="cs-list">
      {Array.from(byClient.entries()).map(([clientId, rows]) => {
        const total = rows.reduce((s, r) => s + r.amount, 0);
        const bulkable = rows.filter((r) => r.kind !== "asset");
        return (
          <section className="cs-group" key={clientId}>
            <header>
              <div>
                <button type="button" className="cs-client" onClick={() => navigate(`/clients/${clientId}`)}>{rows[0].clientName}</button>
                <span className="cs-sub">{rows.length} waiting · {money(total)}</span>
              </div>
              <div className="cs-head-actions">
                <button type="button" className="ghost-button btn-sm" onClick={() => navigate(`/accounting?client=${clientId}&tab=${encodeURIComponent("Client Submissions")}`)}>Review &amp; edit</button>
                {bulkable.length > 1 && <button type="button" className="action-button btn-sm" disabled={busy === clientId} onClick={() => approveAll(clientId, bulkable)}>Approve all ({bulkable.length})</button>}
              </div>
            </header>
            {rows.map((it) => (
              <div className="cs-row" key={it.draftId}>
                <span className={`cs-icon ${it.kind}`}>{it.kind === "sales" ? <Receipt size={16} aria-hidden="true" /> : it.kind === "asset" ? <Package size={16} aria-hidden="true" /> : <ShoppingCart size={16} aria-hidden="true" />}</span>
                <div className="cs-main">
                  <div className="cs-title">
                    {it.kind === "sales" ? "Daily sales" : it.kind === "asset" ? `Asset — ${it.description}` : "Expense"} · {fmtDate(it.date)}
                    {it.anomaly && <span className="cs-flag" title={it.averageGross !== null ? `Recent daily average ${money(it.averageGross)}` : ""}><TriangleAlert size={12} aria-hidden="true" /> Unusual</span>}
                  </div>
                  <div className="cs-meta">
                    {it.kind === "purchase" && (it.vendor || it.account) ? `${[it.vendor, it.account].filter(Boolean).join(" · ")} · ` : ""}
                    {it.kind === "sales" && it.tax > 0 ? `Sales tax ${money(it.tax)} · ` : ""}
                    {it.kind === "sales" && ((it.tenderCard || 0) > 0 || (it.tenderEbt || 0) > 0) ? `Paid: ${(it.tenderCard || 0) > 0 ? `card ${money(it.tenderCard!)}` : ""}${(it.tenderCard || 0) > 0 && (it.tenderEbt || 0) > 0 ? ", " : ""}${(it.tenderEbt || 0) > 0 ? `EBT ${money(it.tenderEbt!)}` : ""}, rest cash · ` : ""}
                    {it.kind === "purchase" && (it.receiptCount || 0) > 0 ? `${it.receiptCount} receipt(s) · ` : ""}
                    submitted {ago(it.submittedAt)}{it.submittedBy ? ` by ${it.submittedBy.split("@")[0]}` : ""}
                    {it.notes ? ` · “${it.notes}”` : ""}
                  </div>
                </div>
                <div className="cs-amount">{money(it.amount)}</div>
                <div className="cs-actions">
                  {it.kind === "sales" && <button type="button" className="ghost-button btn-sm" title="How was this day paid? (card / EBT)" onClick={() => { setTenderOpen(tenderOpen === it.draftId ? null : it.draftId); setTenderEdits((m) => m[it.draftId] ? m : { ...m, [it.draftId]: { card: it.tenderCard ? String(it.tenderCard) : "", ebt: it.tenderEbt ? String(it.tenderEbt) : "" } }); }}>Card / EBT</button>}
                  {it.kind === "asset"
                    ? <button type="button" className="action-button btn-sm" onClick={() => setRecording(recording === it.draftId ? null : it.draftId)}>Record…</button>
                    : <button type="button" className="action-button btn-sm" disabled={busy === it.draftId} onClick={() => approve(it)}>Approve</button>}
                  <button type="button" className="ghost-button btn-sm" disabled={busy === it.draftId} onClick={() => dismiss(it)}>Dismiss</button>
                </div>
                {tenderOpen === it.draftId && it.kind === "sales" && tenderEdits[it.draftId] && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <TenderSplit total={it.amount + it.tax} card={tenderEdits[it.draftId].card} ebt={tenderEdits[it.draftId].ebt} onChange={(v) => setTenderEdits((m) => ({ ...m, [it.draftId]: v }))} />
                  </div>
                )}
                {recording === it.draftId && it.kind === "asset" && (
                  <div style={{ gridColumn: "1 / -1" }}><AssetRecordForm it={it} onCancel={() => setRecording(null)} onDone={() => { setRecording(null); toast(`Recorded ${it.description}.`); onChanged(); }} /></div>
                )}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
