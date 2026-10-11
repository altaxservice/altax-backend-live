import { useState } from "react";

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface TenderLabels {
  title: string; explain: string; allCash: string; someCard: string; card: string; ebt: string; cash: string; total: string; ok: string; over: string; allCashNote: string;
}
export const TENDER_LABELS_EN: TenderLabels = {
  title: "How did customers pay?",
  explain: "Enter what customers paid by card and by EBT/SNAP (your register's end-of-day report shows these). Everything else counts as cash.",
  allCash: "All cash", someCard: "Cash + card / EBT",
  card: "Paid by credit / debit card", ebt: "Paid by EBT / SNAP", cash: "Paid in cash (calculated)", total: "Total to collect (sales + tax)",
  ok: "✓ Adds up", over: "Card + EBT is more than the total to collect — please check.", allCashNote: "Recorded as 100% cash.",
};

/**
 * Step 2 of a day's sales: how customers paid. Defaults to "All cash" (nothing to fill in); "Cash + card / EBT" reveals the
 * card and EBT boxes, with cash calculated as whatever is left of the total to collect. Used by the client's Daily Sales
 * form and the staff Add / Edit Sale forms.
 */
export function TenderSplit({ total, card, ebt, onChange, labels = TENDER_LABELS_EN, dir }: {
  total: number; card: string; ebt: string; onChange: (v: { card: string; ebt: string }) => void; labels?: TenderLabels; dir?: "ltr" | "rtl";
}) {
  const hasSplit = (Number(card) || 0) > 0 || (Number(ebt) || 0) > 0;
  const [open, setOpen] = useState(hasSplit);
  const showSplit = open || hasSplit;
  const c = Number(card) || 0, e = Number(ebt) || 0;
  const cash = r2(total - c - e);
  const over = total > 0 && cash < -0.005;
  return (
    <div className="tender-split" dir={dir}>
      <div className="tender-title">{labels.title}</div>
      <div className="tender-seg" role="radiogroup" aria-label={labels.title}>
        <button type="button" role="radio" aria-checked={!showSplit} className={!showSplit ? "on" : ""} onClick={() => { setOpen(false); onChange({ card: "", ebt: "" }); }}>{labels.allCash}</button>
        <button type="button" role="radio" aria-checked={showSplit} className={showSplit ? "on" : ""} onClick={() => setOpen(true)}>{labels.someCard}</button>
      </div>
      {!showSplit ? (
        <p className="muted tender-note">{labels.allCashNote}</p>
      ) : (
        <>
          <p className="muted tender-note">{labels.explain}</p>
          <div className="tender-grid">
            <label>{labels.card}<input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" value={card} onChange={(ev) => onChange({ card: ev.target.value, ebt })} /></label>
            <label>{labels.ebt}<input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" value={ebt} onChange={(ev) => onChange({ card, ebt: ev.target.value })} /></label>
            <div className={`tender-cash${over ? " bad" : ""}`}><small>{labels.cash}</small><b dir="ltr">{money(Math.max(cash, 0))}</b></div>
          </div>
          <div className="tender-check">
            <span>{labels.total}: <strong dir="ltr">{money(r2(total))}</strong></span>
            {total > 0 && !over && <span className="ok">{labels.ok}</span>}
            {over && <span className="tender-warn">{labels.over}</span>}
          </div>
        </>
      )}
    </div>
  );
}
