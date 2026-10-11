import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import { useConfirm, useNotify } from "./ConfirmProvider";
import { useToast } from "./Toast";
import { fmtDateOnly as fmtDate } from "../utils/date";

interface Item { clearing_id: number; sale_id: string; tender: "card" | "ebt"; amount: number; sale_date: string }
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Match one bank deposit to the card / EBT sales it settles. Card and EBT sales wait in Undeposited Funds; pick the days
 * this deposit covers and the processor's fee is the difference (booked to Merchant Processing Fees). One balanced
 * entry clears those sales and reconciles the bank line.
 */
export function CardDepositPanel({ clientId, lineId, deposit, onDone, onCancel }: { clientId: string; lineId: string; deposit: number; onDone: () => void; onCancel: () => void }) {
  const notify = useNotify();
  const confirmDialog = useConfirm();
  const toast = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ items: Item[] }>(`/bank-rec/${clientId}/clearing`).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [clientId]);

  const covered = useMemo(() => Math.round((items || []).filter((i) => picked.has(i.clearing_id)).reduce((s, i) => s + i.amount, 0) * 100) / 100, [items, picked]);
  const fee = Math.round((covered - deposit) * 100) / 100;
  const pct = covered > 0 ? (fee / covered) * 100 : 0;

  // Suggest: oldest sales first, until they cover the deposit; accept only if the implied fee looks like a normal card fee.
  function suggest() {
    if (!items) return;
    let sum = 0; const ids = new Set<number>();
    for (const i of items) { ids.add(i.clearing_id); sum += i.amount; if (sum >= deposit) break; }
    const f = sum - deposit;
    if (sum >= deposit && f / sum <= 0.06) setPicked(ids);
    else { setPicked(new Set()); void notify("Couldn't find days that add up to this deposit within a normal fee. Tick the days manually."); }
  }

  async function submit(confirmLargeFee = false) {
    setBusy(true);
    try {
      const r = await api.post<{ covered: number; fee: number }>(`/bank-rec/${lineId}/deposit-entry`, { clearingIds: Array.from(picked), confirmLargeFee });
      toast(`Deposit matched — ${money(r.covered)} of card/EBT sales cleared, fee ${money(r.fee)}.`);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && (err.body as any)?.needsConfirm) {
        const ok = await confirmDialog({ title: "Larger than a normal fee", message: err.message, confirmLabel: "Book it as a fee" });
        setBusy(false);
        if (ok) return submit(true);
        return;
      }
      await notify(err instanceof ApiError ? err.message : "Could not match this deposit.");
    } finally { setBusy(false); }
  }

  return (
    <div className="cdp">
      <div className="cdp-head"><b>Card / EBT deposit</b><span className="muted">Pick the days' sales this {money(deposit)} deposit settles.</span><button type="button" className="ghost-button btn-sm" onClick={suggest}>Suggest</button></div>
      {items === null ? <p className="muted">Loading…</p> : items.length === 0 ? <p className="muted">No card or EBT sales are waiting for a deposit.</p> : (
        <div className="cdp-list">
          {items.map((i) => (
            <label key={i.clearing_id} className="cdp-row">
              <input type="checkbox" checked={picked.has(i.clearing_id)} onChange={() => setPicked((p) => { const n = new Set(p); n.has(i.clearing_id) ? n.delete(i.clearing_id) : n.add(i.clearing_id); return n; })} />
              <span>{fmtDate(i.sale_date)}</span><span className={`cdp-tag ${i.tender}`}>{i.tender === "card" ? "Card" : "EBT"}</span><b>{money(i.amount)}</b>
            </label>
          ))}
        </div>
      )}
      <div className="cdp-sum">
        <span>Selected sales <b>{money(covered)}</b></span><span>Deposit <b>{money(deposit)}</b></span>
        <span className={fee < -0.005 ? "bad" : ""}>Fee <b>{fee < -0.005 ? "—" : money(Math.max(fee, 0))}</b>{covered > 0 && fee >= 0 ? ` (${pct.toFixed(1)}%)` : ""}</span>
      </div>
      {fee < -0.005 && covered > 0 && <div className="tender-warn">The deposit is more than the selected sales — tick more days (or part of this deposit may be cash).</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="action-button btn-sm" disabled={busy || picked.size === 0 || fee < -0.005} onClick={() => submit(false)}>{busy ? "Matching…" : "Match deposit"}</button>
        <button type="button" className="ghost-button btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
