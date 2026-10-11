const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface TenderLabels { title: string; hint: string; card: string; ebt: string; cash: string; over: string; total: string }
export const TENDER_LABELS_EN: TenderLabels = {
  title: "How was it paid?", hint: "Optional. Leave blank if it was all cash. Card and EBT money reaches the bank later, so we track it until the deposit.",
  card: "Credit / debit card", ebt: "EBT / SNAP", cash: "Cash (the rest)", over: "Card + EBT is more than the total collected.", total: "Total collected (sales + tax)",
};

/**
 * "How was it paid?" for a day's sales: card and EBT/SNAP amounts, with cash shown as whatever is left of the total
 * collected (sales + tax). Used by the client's Daily Sales form and the staff Add / Edit Sale forms.
 */
export function TenderSplit({ total, card, ebt, onChange, labels = TENDER_LABELS_EN, dir }: {
  total: number; card: string; ebt: string; onChange: (v: { card: string; ebt: string }) => void; labels?: TenderLabels; dir?: "ltr" | "rtl";
}) {
  const c = Number(card) || 0, e = Number(ebt) || 0;
  const cash = r2(total - c - e);
  const over = cash < -0.005;
  return (
    <fieldset className="tender-split" dir={dir}>
      <legend>{labels.title}</legend>
      <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>{labels.hint}</p>
      <div className="tender-grid">
        <label>{labels.card}<input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" value={card} onChange={(ev) => onChange({ card: ev.target.value, ebt })} /></label>
        <label>{labels.ebt}<input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" value={ebt} onChange={(ev) => onChange({ card, ebt: ev.target.value })} /></label>
        <div className={`tender-cash${over ? " bad" : ""}`}><small>{labels.cash}</small><b dir="ltr">{money(Math.max(cash, 0))}</b></div>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{labels.total}: <strong dir="ltr">{money(r2(total))}</strong></div>
      {over && <div className="tender-warn">{labels.over}</div>}
    </fieldset>
  );
}
