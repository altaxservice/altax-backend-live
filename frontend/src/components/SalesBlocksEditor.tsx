import { useMemo } from "react";
import { Banknote, CreditCard, HandHeart } from "lucide-react";

export const NON_TAXABLE_CATEGORY = "CAT-NON-TAXABLE";

export interface BlockState { total: string; amounts: Record<string, string> }
export interface BlocksState { cash: BlockState; card: BlockState; snap: string }
export interface BlockCategory { category_id: string; category_name: string }
export interface BlocksPreview {
  totalTax?: number; totalTaxDue?: number; grossSales?: number | null;
  perBlock?: { cash: { tax: number; collected: number; nonTaxable: number; lineTax?: Record<string, number> }; card: { tax: number; collected: number; nonTaxable: number; lineTax?: Record<string, number> }; snap: { collected: number } } | null;
}
export interface BlocksLabels {
  date?: string; cash: string; card: string; snap: string; total: string; taxableAt: string; nonTaxable: string; tax: string; collected: string;
  snapNote: string; sameMix: string; totalSales: string; salesTax: string; toCollect: string; hint: string;
}
export const BLOCK_LABELS_EN: BlocksLabels = {
  cash: "Cash sales", card: "Card sales", snap: "SNAP / EBT sales", total: "Total", taxableAt: "Of that, taxable at:", nonTaxable: "Not taxable (calculated)",
  tax: "Sales tax (calculated)", collected: "Collected", snapNote: "SNAP / EBT purchases aren't taxable — just enter the total.", sameMix: "Use the same mix as cash",
  totalSales: "Total sales", salesTax: "Sales tax", toCollect: "Total to collect",
  hint: "Enter each way customers paid once. For cash and card, say how much of it was taxable at each rate — the rest is counted as not taxable.",
};

const num = (v: string | undefined) => Number(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const emptyBlocks = (): BlocksState => ({ cash: { total: "", amounts: {} }, card: { total: "", amounts: {} }, snap: "" });

export function blocksToPayload(s: BlocksState) {
  const lines = (b: BlockState) => Object.entries(b.amounts).filter(([, v]) => num(v) > 0).map(([categoryId, v]) => ({ categoryId, taxableAmount: num(v) }));
  return { cash: { total: num(s.cash.total), lines: lines(s.cash) }, card: { total: num(s.card.total), lines: lines(s.card) }, snap: num(s.snap) };
}
export function hasAmounts(s: BlocksState): boolean { return num(s.cash.total) > 0 || num(s.card.total) > 0 || num(s.snap) > 0; }

/** Rebuilds the editor state from a saved entry's blocks. */
export function stateFromBlocks(b: any): BlocksState {
  const blk = (x: any): BlockState => ({ total: x?.total ? String(x.total) : "", amounts: Object.fromEntries((x?.lines || []).map((l: any) => [l.categoryId, String(l.taxableAmount)])) });
  return { cash: blk(b?.cash), card: blk(b?.card), snap: b?.snap ? String(b.snap) : "" };
}
/** An older entry that only has category lines (no Cash/Card/SNAP breakdown): everything goes into Cash so it can be re-split. */
export function stateFromLegacyLines(lines: { categoryId?: string; category_id?: string; taxableAmount?: number | string; taxable_amount?: number | string }[]): BlocksState {
  const amounts: Record<string, string> = {}; let total = 0;
  for (const l of lines) {
    const id = String(l.categoryId ?? l.category_id ?? ""); const amt = Number(l.taxableAmount ?? l.taxable_amount) || 0;
    if (!id || !amt) continue;
    total += amt;
    if (id !== NON_TAXABLE_CATEGORY) amounts[id] = String(amt);
  }
  return { cash: { total: total ? String(r2(total)) : "", amounts }, card: { total: "", amounts: {} }, snap: "" };
}

/**
 * The sales entry: three blocks — Cash, Card, SNAP/EBT — each typed once. Cash and Card take a total and how much of it was
 * taxable at each rate (the rest is not taxable); SNAP is one number (not taxable). A summary below adds the three up.
 * Used by the client's Daily Sales form and the staff Add / Edit Sale forms.
 */
export function SalesBlocksEditor({ categories, value, onChange, preview, error, labels = BLOCK_LABELS_EN, dir }: {
  categories: BlockCategory[]; value: BlocksState; onChange: (v: BlocksState) => void; preview?: BlocksPreview | null; error?: string | null; labels?: BlocksLabels; dir?: "ltr" | "rtl";
}) {
  const taxable = useMemo(() => categories.filter((c) => c.category_id !== NON_TAXABLE_CATEGORY), [categories]);
  const setBlock = (k: "cash" | "card", patch: Partial<BlockState>) => onChange({ ...value, [k]: { ...value[k], ...patch } });
  const setAmount = (k: "cash" | "card", id: string, v: string) => setBlock(k, { amounts: { ...value[k].amounts, [id]: v } });
  const taxableSum = (b: BlockState) => r2(Object.values(b.amounts).reduce((s, v) => s + num(v), 0));
  const totalSales = r2(num(value.cash.total) + num(value.card.total) + num(value.snap));
  const tax = preview ? Number(preview.totalTax ?? preview.totalTaxDue ?? 0) : 0;

  const copyMix = () => {
    const ct = num(value.cash.total), kt = num(value.card.total);
    if (ct <= 0 || kt <= 0) return;
    const amounts: Record<string, string> = {};
    for (const [id, v] of Object.entries(value.cash.amounts)) if (num(v) > 0) amounts[id] = String(r2((num(v) / ct) * kt));
    setBlock("card", { amounts });
  };

  const renderBlock = (k: "cash" | "card", title: string, Icon: typeof Banknote) => {
    const b = value[k]; const used = taxableSum(b); const rest = r2(num(b.total) - used);
    const over = rest < -0.005; const pb = preview?.perBlock?.[k];
    return (
      <section className={`sb-card ${k}`} aria-label={title}>
        <header><Icon size={16} aria-hidden="true" /><h3>{title}</h3></header>
        <label className="sb-total">{labels.total}<input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" value={b.total} onChange={(e) => setBlock(k, { total: e.target.value })} /></label>
        <div className="sb-sub">{labels.taxableAt}</div>
        {taxable.map((c) => (
          <label key={c.category_id} className="sb-row"><span>{c.category_name}</span>
            <b className="sb-rowtax" dir="ltr" title={labels.tax}>{num(b.amounts[c.category_id]) > 0 ? `+${money(pb?.lineTax?.[c.category_id] ?? 0)}` : ""}</b>
            <input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" aria-label={`${title} — ${c.category_name}`} value={b.amounts[c.category_id] || ""} onChange={(e) => setAmount(k, c.category_id, e.target.value)} />
          </label>
        ))}
        <div className={`sb-calc${over ? " bad" : ""}`}><span>{labels.nonTaxable}</span><b dir="ltr">{money(Math.max(rest, 0))}</b></div>
        <div className="sb-calc"><span>{labels.tax}</span><b dir="ltr">{money(pb ? pb.tax : 0)}</b></div>
        <div className="sb-calc strong"><span>{labels.collected}</span><b dir="ltr">{money(pb ? pb.collected : num(b.total))}</b></div>
        {k === "card" && num(value.cash.total) > 0 && num(b.total) > 0 && Object.values(value.cash.amounts).some((v) => num(v) > 0) && (
          <button type="button" className="link-button sb-copy" onClick={copyMix}>{labels.sameMix}</button>
        )}
      </section>
    );
  };

  return (
    <div className="sb" dir={dir}>
      <p className="muted sb-hint">{labels.hint}</p>
      <div className="sb-grid">
        {renderBlock("cash", labels.cash, Banknote)}
        {renderBlock("card", labels.card, CreditCard)}
        <section className="sb-card snap" aria-label={labels.snap}>
          <header><HandHeart size={16} aria-hidden="true" /><h3>{labels.snap}</h3></header>
          <label className="sb-total">{labels.total}<input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" value={value.snap} onChange={(e) => onChange({ ...value, snap: e.target.value })} /></label>
          <p className="muted sb-snapnote">{labels.snapNote}</p>
          <div className="sb-calc strong"><span>{labels.collected}</span><b dir="ltr">{money(num(value.snap))}</b></div>
        </section>
      </div>
      {error && <div className="tender-warn" style={{ marginTop: 8 }}>{error}</div>}
      <div className="sb-summary">
        <span>{labels.totalSales}: <b dir="ltr">{money(totalSales)}</b></span>
        <span>{labels.salesTax}: <b dir="ltr">{money(tax)}</b></span>
        <span>{labels.toCollect}: <b className="big" dir="ltr">{money(r2(totalSales + tax))}</b></span>
      </div>
    </div>
  );
}
