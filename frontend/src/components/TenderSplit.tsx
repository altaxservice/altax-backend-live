import { useState } from "react";

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface TenderLabels { title: string; optional: string; card: string; ebt: string; cash: string; ok: string; over: string; add?: string; hide?: string }
export const TENDER_LABELS_EN: TenderLabels = {
  title: "Paid by card or EBT?", optional: "Optional — leave blank if it was all cash.",
  card: "Card", ebt: "EBT / SNAP", cash: "Cash (calculated)", ok: "✓ Adds up", over: "Card + EBT is more than the total — please check.",
  add: "Some paid by card or EBT? Add details (optional)", hide: "Hide",
};

/**
 * One compact line under the sales total: how much of it was paid by card and by EBT/SNAP. Cash is calculated as the
 * rest, blank means all cash — so a cash-only client types nothing, and everyone else types at most two numbers.
 * Used by the client's Daily Sales form and the staff Add / Edit Sale forms.
 */
export function TenderSplit({ total, card, ebt, onChange, labels = TENDER_LABELS_EN, dir, collapsible = false, defaultOpen = false, onOpenChange }: {
  total: number; card: string; ebt: string; onChange: (v: { card: string; ebt: string }) => void; labels?: TenderLabels; dir?: "ltr" | "rtl";
  /** Collapsed to a single quiet link until the user wants it (cash-only clients never see the boxes). */
  collapsible?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const c = Number(card) || 0, e = Number(ebt) || 0;
  const touched = c > 0 || e > 0;
  const [open, setOpen] = useState(defaultOpen);
  const expanded = !collapsible || open || touched;
  const cash = r2(total - c - e);
  const over = total > 0 && cash < -0.005;
  const toggle = (v: boolean) => { setOpen(v); onOpenChange?.(v); };
  if (!expanded) {
    return (
      <div className="tender-collapsed" dir={dir}>
        <button type="button" className="link-button" onClick={() => toggle(true)}>＋ {labels.add || TENDER_LABELS_EN.add}</button>
      </div>
    );
  }
  return (
    <div className="tender-inline" dir={dir}>
      <div className="tender-q"><b>{labels.title}</b><small>{labels.optional}</small></div>
      <label>{labels.card}<input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" value={card} onChange={(ev) => onChange({ card: ev.target.value, ebt })} /></label>
      <label>{labels.ebt}<input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" value={ebt} onChange={(ev) => onChange({ card, ebt: ev.target.value })} /></label>
      <div className={`tender-cash${over ? " bad" : ""}`}><small>{labels.cash}</small><b dir="ltr">{money(Math.max(cash, 0))}</b></div>
      {touched && total > 0 && !over && <span className="tender-ok">{labels.ok}</span>}
      {collapsible && !touched && <button type="button" className="link-button tender-hide" onClick={() => toggle(false)}>{labels.hide || "Hide"}</button>}
      {over && <span className="tender-warn">{labels.over}</span>}
    </div>
  );
}
