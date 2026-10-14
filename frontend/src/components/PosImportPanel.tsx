import { useEffect, useMemo, useState } from "react";
import { FileUp } from "lucide-react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { DateInput } from "./DateInput";
import { FileDropInput } from "./FileDropInput";
import { NON_TAXABLE_CATEGORY, stateFromBlocks, type BlocksState } from "./SalesBlocksEditor";
import { fileToBase64 } from "../utils/file";

interface Cat { category_id: string; category_name: string }
interface Parsed {
  from: string | null; to: string | null; taxable: { rate: number; amount: number; categoryId: string | null }[];
  nonTaxable: number; cash: number; card: number; ebt: number; taxCollected: number | null; warnings: string[];
}
interface Allocation {
  blocks: { cash: { total: number; lines: { categoryId: string; taxableAmount: number }[] }; card: { total: number; lines: { categoryId: string; taxableAmount: number }[] }; snap: number };
  diff: number; warnings: string[]; computedTax: number; taxCollected: number; suggestedAdjustment: number;
}
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v: string) => Number(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Fills the Sales Input from a POS report (Clover): upload the Sales Overview + Taxes PDFs, or type the six totals the report shows.
 * Either way the numbers land in the same boxes; the app splits them into Cash / Card / SNAP, works out the tax, and fills the form
 * below for review. Nothing is saved until the Sales Input's own Save button is pressed.
 */
export function PosImportPanel({ clientId, categories, onFill, onClose }: {
  clientId: string; categories: Cat[]; onClose: () => void;
  onFill: (v: { saleDate: string; blocks: BlocksState; adjustments: string; notes: string }) => void;
}) {
  const { user } = useAuth();
  const [smart, setSmart] = useState<{ keyConfigured: boolean; enabled: boolean } | null>(null);
  useEffect(() => { api.get<{ keyConfigured: boolean; enabled: boolean }>("/sales-input-import/pos/settings").then(setSmart).catch(() => setSmart(null)); }, []);
  async function toggleSmart(enabled: boolean) {
    try { await api.put("/sales-input-import/pos/settings", { enabled }); setSmart((s) => (s ? { ...s, enabled } : s)); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not change this setting."); }
  }
  const taxableCats = useMemo(() => categories.filter((c) => c.category_id !== NON_TAXABLE_CATEGORY), [categories]);
  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [taxable, setTaxable] = useState<Record<string, string>>({});
  const [nonTax, setNonTax] = useState(""); const [cash, setCash] = useState(""); const [card, setCard] = useState(""); const [ebt, setEbt] = useState(""); const [tax, setTax] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState<Allocation | null>(null);
  const [busy, setBusy] = useState(false);

  const taxableTotal = r2(Object.values(taxable).reduce((s, v) => s + num(v), 0));
  const pretax = r2(taxableTotal + num(nonTax));
  const expected = r2(pretax + num(tax));
  const actual = r2(num(cash) + num(card) + num(ebt));
  const diff = r2(actual - expected);
  const ready = pretax > 0 && actual > 0 && to;

  async function readPdfs() {
    setReading(true); setError(null); setFilled(null);
    try {
      const payload = await Promise.all(files.map(async (f) => ({ name: f.name, fileBase64: await fileToBase64(f) })));
      const r = await api.post<{ summary: Parsed }>("/sales-input-import/pos/parse", { clientId, files: payload });
      const s = r.summary;
      setFrom(s.from || ""); setTo(s.to || "");
      const t: Record<string, string> = {};
      for (const x of s.taxable) if (x.categoryId) t[x.categoryId] = String(x.amount);
      setTaxable(t); setNonTax(s.nonTaxable ? String(s.nonTaxable) : ""); setCash(s.cash ? String(s.cash) : ""); setCard(s.card ? String(s.card) : ""); setEbt(s.ebt ? String(s.ebt) : ""); setTax(s.taxCollected !== null ? String(s.taxCollected) : "");
      setNotes(s.warnings);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not read these files."); } finally { setReading(false); }
  }

  async function fill() {
    setBusy(true); setError(null);
    try {
      const a = await api.post<Allocation>("/sales-input-import/pos/allocate", {
        clientId, taxable: Object.entries(taxable).map(([categoryId, amount]) => ({ categoryId, amount: num(amount) })), nonTaxable: num(nonTax), cash: num(cash), card: num(card), ebt: num(ebt), taxCollected: num(tax),
      });
      setFilled(a);
      onFill({
        saleDate: to,
        blocks: stateFromBlocks(a.blocks),
        adjustments: Math.abs(a.suggestedAdjustment) >= 0.005 ? String(a.suggestedAdjustment) : "",
        notes: `POS report ${from || to} to ${to}. Collected per POS: ${money(actual)} (cash ${money(num(cash))}, card ${money(num(card))}, EBT ${money(num(ebt))}); sales tax collected ${money(num(tax))}.`,
      });
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not fill the Sales Input."); } finally { setBusy(false); }
  }

  const box = (label: string, value: string, set: (v: string) => void, hint?: string) => (
    <label className="field" style={{ margin: 0 }}>{label}
      <input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => set(e.target.value)} />
      {hint && <span className="muted" style={{ fontSize: 11.5 }}>{hint}</span>}
    </label>
  );

  return (
    <div className="command-panel">
      <div className="command-panel-header">
        <div><h3 className="command-panel-title" style={{ display: "flex", gap: 8, alignItems: "center" }}><FileUp size={16} aria-hidden="true" /> Import a POS report (Clover)</h3>
          <div className="command-panel-note">Upload the Sales Overview and Taxes reports (PDF or picture) — or type the totals — and the Sales Input below is filled in for you. Nothing is saved until you press Save.</div></div>
        <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
      </div>
      <div style={{ padding: 16, display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <b style={{ fontSize: 13 }}>Option 1 — upload the reports (PDF, screenshot or photo)</b>
          <div className="tender-warn" style={{ fontSize: 12.5, background: smart?.enabled ? "var(--green-soft, #e8f6ee)" : undefined }}>
            {smart?.enabled ? <>🧠 <b>Smart reading is ON</b> — photos and screenshots, even tilted or crumpled ones, are read by Claude and checked against the report's own totals.</> : <>📷 Photos are read with basic text recognition, which is unreliable on tilted or crumpled receipts.{smart && !smart.keyConfigured && " Smart reading (Claude) isn't set up on the server yet — it needs an Anthropic API key added as ANTHROPIC_API_KEY."}</>}
            {user?.role === "admin" && smart?.keyConfigured && (
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 6 }}>
                <input type="checkbox" checked={smart.enabled} onChange={(e) => toggleSmart(e.target.checked)} style={{ marginTop: 3 }} />
                <span>Use Claude to read report photos. <span className="muted">The picture (a sales report: business name, address and totals — no SSNs or bank details) is sent to Anthropic's API only when you upload it here, and only the numbers are kept. Switch off any time.</span></span>
              </label>
            )}
          </div>
          <FileDropInput files={files} onFilesChange={setFiles} accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hint="The Clover Sales Overview and the Taxes report — PDFs, screenshots or phone photos. Pictures are read by text recognition, so always check the green “ties out” line before saving." />
          <div><button type="button" className="btn btn-sm btn-primary" disabled={reading || files.length === 0} onClick={readPdfs}>{reading ? "Reading…" : "Read the report"}</button></div>
        </div>

        <div style={{ display: "grid", gap: 10, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <b style={{ fontSize: 13 }}>Option 2 — the numbers (filled in by option 1, or type them from the report)</b>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
            <label className="field" style={{ margin: 0 }}>Report starts<DateInput value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="field" style={{ margin: 0 }}>Report ends <span className="muted">(sale date)</span><DateInput value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>From the <b>Taxes</b> report — sales before tax:</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
            {taxableCats.map((c) => box(c.category_name, taxable[c.category_id] || "", (v) => setTaxable((t) => ({ ...t, [c.category_id]: v }))))}
            {box("Not taxable", nonTax, setNonTax, "No Tax + Tax Removed lines added together")}
            {box("Sales tax collected", tax, setTax, "Net of refunds")}
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>From the <b>Sales Overview</b> — collected, tax included:</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
            {box("Cash", cash, setCash)}
            {box("Card", card, setCard, "Debit + Credit added together")}
            {box("EBT / SNAP", ebt, setEbt)}
          </div>
          {pretax > 0 && (
            <div className="tender-warn" style={{ background: Math.abs(diff) <= 1 ? "var(--green-soft, #e8f6ee)" : undefined }}>
              Sales {money(pretax)} + tax {money(num(tax))} = <b>{money(expected)}</b> · paid {money(actual)} ·{" "}
              {Math.abs(diff) <= 1 ? <b>✓ ties out{Math.abs(diff) >= 0.005 ? ` (off by ${money(Math.abs(diff))})` : ""}</b> : <b style={{ color: "var(--red)" }}>⚠ off by {money(Math.abs(diff))} — check the numbers</b>}
            </div>
          )}
        </div>

        {notes.map((n, i) => <div key={i} className="tender-warn">{n}</div>)}
        {error && <div className="tender-warn" style={{ color: "var(--red)" }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="btn btn-primary" disabled={busy || !ready} onClick={fill}>{busy ? "Filling…" : "Fill the Sales Input"}</button>
          {!ready && <span className="muted" style={{ fontSize: 12 }}>Needs the report end date, the sales and what was collected.</span>}
        </div>
        {filled && (
          <div className="tender-warn" style={{ background: "var(--green-soft, #e8f6ee)" }}>
            ✓ The Sales Input below is filled in: Cash {money(filled.blocks.cash.total)}, Card {money(filled.blocks.card.total)}, SNAP / EBT {money(filled.blocks.snap)}.
            {Math.abs(filled.suggestedAdjustment) >= 0.005 && <> The POS collected {money(filled.taxCollected)} in tax and 6% of the taxable sales is {money(filled.computedTax)}, so an adjustment of <b>{money(filled.suggestedAdjustment)}</b> was added so tax due matches what was really collected.</>} Review it, then press <b>Save Sales Input</b>.
            {filled.warnings.map((w, i) => <div key={i} style={{ color: "var(--red)" }}>⚠ {w}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
