import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Receipt, ShoppingCart, TriangleAlert } from "lucide-react";
import { api, ApiError } from "../api/client";
import { useConfirm, useNotify, usePrompt } from "./ConfirmProvider";
import { ago } from "./WorkTrail";
import { fmtDateOnly as fmtDate } from "../utils/date";
import { useToast } from "./Toast";

export interface PendingSubmission {
  kind: "sales" | "purchase"; draftId: string; clientId: string; clientName: string; date: string; amount: number; tax: number;
  notes: string | null; submittedAt: string; submittedBy: string | null; anomaly: boolean; averageGross: number | null;
  vendor?: string | null; account?: string; description?: string | null; receiptCount?: number;
}
export interface PendingSubmissions { items: PendingSubmission[]; counts: { sales: number; purchases: number; total: number; clients: number } }

const money = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const path = (k: PendingSubmission["kind"]) => (k === "sales" ? "sales-drafts" : "purchase-drafts");

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
      await api.post(`/accounting/client-books/${path(it.kind)}/${it.draftId}/approve`, {});
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
      await api.post(`/accounting/client-books/${path(it.kind)}/${it.draftId}/dismiss`, { reason });
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
        return (
          <section className="cs-group" key={clientId}>
            <header>
              <div>
                <button type="button" className="cs-client" onClick={() => navigate(`/clients/${clientId}`)}>{rows[0].clientName}</button>
                <span className="cs-sub">{rows.length} waiting · {money(total)}</span>
              </div>
              <div className="cs-head-actions">
                <button type="button" className="ghost-button btn-sm" onClick={() => navigate(`/accounting?client=${clientId}&tab=${encodeURIComponent("Client Submissions")}`)}>Review &amp; edit</button>
                {rows.length > 1 && <button type="button" className="action-button btn-sm" disabled={busy === clientId} onClick={() => approveAll(clientId, rows)}>Approve all ({rows.length})</button>}
              </div>
            </header>
            {rows.map((it) => (
              <div className="cs-row" key={it.draftId}>
                <span className={`cs-icon ${it.kind}`}>{it.kind === "sales" ? <Receipt size={16} aria-hidden="true" /> : <ShoppingCart size={16} aria-hidden="true" />}</span>
                <div className="cs-main">
                  <div className="cs-title">
                    {it.kind === "sales" ? "Daily sales" : "Expense"} · {fmtDate(it.date)}
                    {it.anomaly && <span className="cs-flag" title={it.averageGross !== null ? `Recent daily average ${money(it.averageGross)}` : ""}><TriangleAlert size={12} aria-hidden="true" /> Unusual</span>}
                  </div>
                  <div className="cs-meta">
                    {it.kind === "purchase" && (it.vendor || it.account) ? `${[it.vendor, it.account].filter(Boolean).join(" · ")} · ` : ""}
                    {it.kind === "sales" && it.tax > 0 ? `Sales tax ${money(it.tax)} · ` : ""}
                    {it.kind === "purchase" && (it.receiptCount || 0) > 0 ? `${it.receiptCount} receipt(s) · ` : ""}
                    submitted {ago(it.submittedAt)}{it.submittedBy ? ` by ${it.submittedBy.split("@")[0]}` : ""}
                    {it.notes ? ` · “${it.notes}”` : ""}
                  </div>
                </div>
                <div className="cs-amount">{money(it.amount)}</div>
                <div className="cs-actions">
                  <button type="button" className="action-button btn-sm" disabled={busy === it.draftId} onClick={() => approve(it)}>Approve</button>
                  <button type="button" className="ghost-button btn-sm" disabled={busy === it.draftId} onClick={() => dismiss(it)}>Dismiss</button>
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
