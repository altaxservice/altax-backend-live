import { useMemo } from "react";
import { Banknote, CreditCard, HandHeart } from "lucide-react";

export const NON_TAXABLE_CATEGORY = "CAT-NON-TAXABLE";

/** amounts = sales typed at each tax rate; nonTax = non-taxable sales typed in the block. The block total is their sum — never typed. */
export interface BlockState { nonTax: string; amounts: Record<string, string> }
export interface BlocksState { cash: BlockState; card: BlockState; snap: string }
export interface BlockCategory { category_id: string; category_name: string }
export interface BlocksPreview {
  totalTax?: number; totalTaxDue?: number; grossSales?: number | null;
  perBlock?: { cash: { tax: number; collected: number; nonTaxable: number; lineTax?: Record<string, number> }; card: { tax: number; collected: number; nonTaxable: number; lineTax?: Record<string, number> }; snap: { collected: number } } | null;
}
export interface BlocksLabels {
  date?: string; cash: string; card: string; snap: string; total: string; taxableAt: string; nonTaxable: string; tax: string; collected: string;
  snapNote: string; sameMix: string; totalSales: string; salesTax: string; toCollect: string; hint: string;
  salesCol?: string; taxCol?: string; nonTaxableRow?: string;
}
export const BLOCK_LABELS_EN: BlocksLabels = {
  cash: "Cash sales", card: "Card sales", snap: "SNAP / EBT sales", total: "Total", taxableAt: "Of that, taxable at:", nonTaxable: "Not taxable (calculated)",
  tax: "Sales tax (calculated)", collected: "Collected", snapNote: "SNAP / EBT purchases aren't taxable — just enter the total.", sameMix: "Use the same mix as cash",
  totalSales: "Total sales", salesTax: "Sales tax", toCollect: "Total to collect",
  hint: "Enter each way customers paid. Type the sales at each tax rate — the tax and the totals are calculated for you.",
  salesCol: "Sales", taxCol: "Tax", nonTaxableRow: "Non-taxable sales",
};

const num = (v: string | undefined) => Number(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const emptyBlocks = (): BlocksState => ({ cash: { nonTax: "", amounts: {} }, card: { nonTax: "", amounts: {} }, snap: "" });
const blockTotal = (b: BlockState) => r2(num(b.nonTax) + Object.values(b.amounts).reduce((s, v) => s + num(v), 0));

export function blocksToPayload(s: BlocksState) {
  const lines = (b: BlockState) => Object.entries(b.amounts).filter(([, v]) => num(v) > 0).map(([categoryId, v]) => ({ categoryId, taxableAmount: num(v) }));
  return { cash: { total: blockTotal(s.cash), lines: lines(s.cash) }, card: { total: blockTotal(s.card), lines: lines(s.card) }, snap: num(s.snap) };
}
export function hasAmounts(s: BlocksState): boolean { return blockTotal(s.cash) > 0 || blockTotal(s.card) > 0 || num(s.snap) > 0; }

/** Rebuilds the editor state from a saved entry's blocks. */
export function stateFromBlocks(b: any): BlocksState {
  const blk = (x: any): BlockState => {
    const lines = (x?.lines || []) as { categoryId: string; taxableAmount: number }[];
    const nonTax = r2((Number(x?.total) || 0) - lines.reduce((t, l) => t + (Number(l.taxableAmount) || 0), 0));
    return { nonTax: nonTax > 0 ? String(nonTax) : "", amounts: Object.fromEntries(lines.map((l) => [l.categoryId, String(l.taxableAmount)])) };
  };
  return { cash: blk(b?.cash), card: blk(b?.card), snap: b?.snap ? String(b.snap) : "" };
}
/** An older entry that only has category lines (no Cash/Card/SNAP breakdown): everything goes into Cash so it can be re-split. */
export function stateFromLegacyLines(lines: { categoryId?: string; category_id?: string; taxableAmount?: number | string; taxable_amount?: number | string }[]): BlocksState {
  const amounts: Record<string, string> = {}; let nonTax = 0;
  for (const l of lines) {
    const id = String(l.categoryId ?? l.category_id ?? ""); const amt = Number(l.taxableAmount ?? l.taxable_amount) || 0;
    if (!id || !amt) continue;
    if (id !== NON_TAXABLE_CATEGORY) amounts[id] = String(amt); else nonTax += amt;
  }
  return { cash: { nonTax: nonTax ? String(r2(nonTax)) : "", amounts }, card: { nonTax: "", amounts: {} }, snap: "" };
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
  const totalSales = r2(blockTotal(value.cash) + blockTotal(value.card) + num(value.snap));
  const tax = preview ? Number(preview.totalTax ?? preview.totalTaxDue ?? 0) : 0;

  const copyMix = () => {
    const ct = blockTotal(value.cash), kt = blockTotal(value.card);
    if (ct <= 0 || kt <= 0) return;
    const amounts: Record<string, string> = {};
    for (const [id, v] of Object.entries(value.cash.amounts)) if (num(v) > 0) amounts[id] = String(r2((num(v) / ct) * kt));
    setBlock("card", { amounts, nonTax: num(value.cash.nonTax) > 0 ? String(r2((num(value.cash.nonTax) / ct) * kt)) : "" });
  };

  const renderBlock = (k: "cash" | "card", title: string, Icon: typeof Banknote) => {
    const b = value[k]; const total = blockTotal(b); const pb = preview?.perBlock?.[k];
    const salesCol = labels.salesCol || "Sales", taxCol = labels.taxCol || "Tax";
    const cell = (v: string, onCh: (x: string) => void, aria: string) => (
      <input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" aria-label={aria} value={v} onChange={(e) => onCh(e.target.value)} />
    );
    return (
      <section className={`sb-card ${k}`} aria-label={title}>
        <header><Icon size={16} aria-hidden="true" /><h3>{title}</h3></header>
        <div className="sb-row sb-head"><span></span><span>{salesCol}</span><span>{taxCol}</span></div>
        {taxable.map((c) => {
          const has = num(b.amounts[c.category_id]) > 0;
          return (
            <label key={c.category_id} className="sb-row"><span>{c.category_name}</span>
              {cell(b.amounts[c.category_id] || "", (x) => setAmount(k, c.category_id, x), `${title} — ${c.category_name}`)}
              <b className="sb-rowtax" dir="ltr">{has ? money(pb?.lineTax?.[c.category_id] ?? 0) : "—"}</b>
            </label>
          );
        })}
        <label className="sb-row"><span>{labels.nonTaxableRow || "Non-taxable sales"}</span>
          {cell(b.nonTax, (x) => setBlock(k, { nonTax: x }), `${title} — ${labels.nonTaxableRow || "Non-taxable sales"}`)}
          <b className="sb-rowtax" dir="ltr">—</b>
        </label>
        <div className="sb-row sb-sum"><span>{labels.total}</span><b dir="ltr">{money(total)}</b><b dir="ltr">{money(pb ? pb.tax : 0)}</b></div>
        <div className="sb-calc strong"><span>{labels.collected}</span><b dir="ltr">{money(pb ? pb.collected : total)}</b></div>
        {k === "card" && blockTotal(value.cash) > 0 && total > 0 && Object.values(value.cash.amounts).some((v) => num(v) > 0) && (
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
          <label className="sb-total">{labels.snap}<input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" value={value.snap} onChange={(e) => onChange({ ...value, snap: e.target.value })} /></label>
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
