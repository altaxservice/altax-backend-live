import { useEffect, useMemo, useRef, useState } from "react";
import { Receipt } from "lucide-react";
import { api, ApiError } from "../api/client";
import { DateInput } from "./DateInput";
import { NON_TAXABLE_CATEGORY, blocksToPayload, stateFromBlocks } from "./SalesBlocksEditor";
import { enterAsTab } from "../utils/enterAsTab";
import { useToast } from "./Toast";

interface Cat { category_id: string; category_name: string }
interface Allocation {
  blocks: { cash: { total: number; lines: { categoryId: string; taxableAmount: number }[] }; card: { total: number; lines: { categoryId: string; taxableAmount: number }[] }; snap: number };
  diff: number; warnings: string[]; computedTax: number; taxCollected: number; suggestedAdjustment: number;
}
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v: string) => Number(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const lastDayOfPreviousMonth = () => { const n = new Date(); return iso(new Date(n.getFullYear(), n.getMonth(), 0)); };
const monthLabel = (isoDate: string) => (isoDate ? new Date(`${isoDate}T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "");

/**
 * Month-end entry straight from the POS reports (Clover "Taxes" + "Sales Overview"): type the numbers in the order they appear on the
 * receipts and press Save. Cash is worked out for you, the taxable sales are split between cash and card, and the check line shows
 * at once whether the numbers add up. One screen, one Save — no second form to review.
 */
export function PosEntryPanel({ clientId, categories, onSaved, onClose }: { clientId: string; categories: Cat[]; onSaved: () => void; onClose: () => void }) {
  const toast = useToast();
  const taxableCats = useMemo(() => categories.filter((c) => c.category_id !== NON_TAXABLE_CATEGORY), [categories]);
  const [saleDate, setSaleDate] = useState(lastDayOfPreviousMonth());
  const [taxable, setTaxable] = useState<Record<string, string>>({});
  const [noTax, setNoTax] = useState(""); const [removed, setRemoved] = useState(""); const [tax, setTax] = useState("");
  const [debit, setDebit] = useState(""); const [credit, setCredit] = useState(""); const [ebt, setEbt] = useState(""); const [cashTyped, setCashTyped] = useState("");
  const [alloc, setAlloc] = useState<Allocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const idem = useRef<string | null>(null);

  const taxableTotal = r2(Object.values(taxable).reduce((s, v) => s + num(v), 0));
  const nonTaxable = r2(num(noTax) + num(removed));
  const pretax = r2(taxableTotal + nonTaxable);
  const expected = r2(pretax + num(tax));
  const card = r2(num(debit) + num(credit));
  const cash = cashTyped !== "" ? num(cashTyped) : Math.max(0, r2(expected - card - num(ebt)));
  const paid = r2(cash + card + num(ebt));
  const diff = r2(paid - expected);
  const ready = pretax > 0 && saleDate && Math.abs(diff) <= 1;

  // Live preview of how it will be entered (the server does the split so the preview is exactly what gets saved).
  useEffect(() => {
    if (pretax <= 0) { setAlloc(null); return; }
    const t = window.setTimeout(() => {
      api.post<Allocation>("/sales-input-import/pos/allocate", {
        clientId, taxable: Object.entries(taxable).map(([categoryId, amount]) => ({ categoryId, amount: num(amount) })), nonTaxable, cash, card, ebt: num(ebt), taxCollected: num(tax),
      }).then(setAlloc).catch(() => setAlloc(null));
    }, 350);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, JSON.stringify(taxable), nonTaxable, cash, card, ebt, tax]);

  async function save() {
    if (!alloc) return;
    setSaving(true); setError(null);
    try {
      if (!idem.current) idem.current = crypto.randomUUID();
      await api.post("/accounting/sales", {
        clientId, saleDate, grossSales: 0, blocks: blocksToPayload(stateFromBlocks(alloc.blocks)),
        adjustments: Math.abs(alloc.suggestedAdjustment) >= 0.005 ? alloc.suggestedAdjustment : 0,
        notes: `From POS reports: ${money(paid)} collected (cash ${money(cash)}, card ${money(card)}, EBT ${money(num(ebt))}); sales tax collected ${money(num(tax))}.`,
        idempotencyKey: idem.current,
      });
      idem.current = null;
      toast(`${monthLabel(saleDate)} sales saved.`);
      setTaxable({}); setNoTax(""); setRemoved(""); setTax(""); setDebit(""); setCredit(""); setEbt(""); setCashTyped(""); setAlloc(null);
      onSaved();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not save."); } finally { setSaving(false); }
  }

  const box = (label: string, value: string, set: (v: string) => void, hint?: string) => (
    <label className="field" style={{ margin: 0 }}>{label}
      <input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => { set(e.target.value); idem.current = null; }} />
      {hint && <span className="muted" style={{ fontSize: 11.5 }}>{hint}</span>}
    </label>
  );
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 } as const;

  return (
    <div className="command-panel">
      <div className="command-panel-header">
        <div><h3 className="command-panel-title" style={{ display: "flex", gap: 8, alignItems: "center" }}><Receipt size={16} aria-hidden="true" /> Enter from the POS reports</h3>
          <div className="command-panel-note">Type the numbers as they appear on the Clover receipts. Cash is worked out for you; press Save when the check line is green.</div></div>
        <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
      </div>
      <form onKeyDown={enterAsTab} onSubmit={(e) => e.preventDefault()} style={{ padding: 16, display: "grid", gap: 12 }}>
        <label className="field" style={{ margin: 0, maxWidth: 260 }}>Month — report ends on <span className="muted">(becomes the sale date)</span><DateInput value={saleDate} onChange={(e) => setSaleDate(e.target.value)} /></label>

        <div className="muted" style={{ fontSize: 12.5 }}><b>Taxes report</b> — Applicable Sales for each heading</div>
        <div style={grid}>
          {taxableCats.map((c) => box(c.category_name, taxable[c.category_id] || "", (v) => setTaxable((t) => ({ ...t, [c.category_id]: v }))))}
          {box("No Tax (0%)", noTax, setNoTax)}
          {box("Tax Removed (0%)", removed, setRemoved, "Leave empty if the report has none")}
          {box("Total tax collected", tax, setTax, "“Net Amount” in the Total block")}
        </div>

        <div className="muted" style={{ fontSize: 12.5 }}><b>Sales Overview</b> — how customers paid <span>(leave empty if you only have the Taxes report — it's entered as cash)</span></div>
        <div style={grid}>
          {box("Debit Card", debit, setDebit)}
          {box("Credit Card", credit, setCredit)}
          {box("EBT", ebt, setEbt)}
          {box("Cash", cashTyped, setCashTyped, cashTyped === "" && expected > 0 ? `Calculated: ${money(cash)}` : "Typed from the report")}
        </div>

        {pretax > 0 && (
          <div className="tender-warn" style={{ background: Math.abs(diff) <= 1 ? "var(--green-soft, #e8f6ee)" : undefined }}>
            Sales {money(pretax)} + tax {money(num(tax))} = <b>{money(expected)}</b> · paid {money(paid)} ·{" "}
            {Math.abs(diff) <= 1 ? <b>✓ adds up{Math.abs(diff) >= 0.005 ? ` (off by ${money(Math.abs(diff))})` : ""}</b> : <b style={{ color: "var(--red)" }}>⚠ off by {money(Math.abs(diff))} — check the numbers</b>}
          </div>
        )}
        {alloc && (
          <div className="muted" style={{ fontSize: 13 }}>
            Will be entered as: Cash {money(alloc.blocks.cash.total)} · Card {money(alloc.blocks.card.total)} · SNAP / EBT {money(alloc.blocks.snap)}
            {Math.abs(alloc.suggestedAdjustment) >= 0.005 && <> · tax adjustment {money(alloc.suggestedAdjustment)} (so tax due = the {money(alloc.taxCollected)} Clover collected)</>}
          </div>
        )}
        {alloc?.warnings.map((w, i) => <div key={i} className="tender-warn" style={{ color: "var(--red)" }}>⚠ {w}</div>)}
        {error && <div className="tender-warn" style={{ color: "var(--red)" }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" disabled={saving || !ready || !alloc} onClick={save}>{saving ? "Saving…" : `Save ${monthLabel(saleDate) || "sales"}`}</button>
          {!ready && pretax > 0 && <span className="muted" style={{ fontSize: 12 }}>The numbers need to add up before you can save.</span>}
        </div>
      </form>
    </div>
  );
}
