import { useEffect, useMemo, useRef, useState } from "react";
import { Receipt, Landmark, ClipboardCheck } from "lucide-react";
import { api, ApiError, fetchAuthedBlob } from "../api/client";
import { DateInput } from "./DateInput";
import { FileDropInput } from "./FileDropInput";
import { fileToBase64 } from "../utils/file";
import { NON_TAXABLE_CATEGORY, blocksToPayload, stateFromBlocks } from "./SalesBlocksEditor";
import { enterAsTab } from "../utils/enterAsTab";
import { useToast } from "./Toast";

interface Cat { category_id: string; category_name: string }
interface Allocation {
  blocks: { cash: { total: number; lines: { categoryId: string; taxableAmount: number }[] }; card: { total: number; lines: { categoryId: string; taxableAmount: number }[] }; snap: number };
  lines?: { categoryId: string; categoryName: string; taxableAmount: number; rate: number; taxAmount: number }[];
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
  // Many POS reports (Square, Toast…) list the tax collected at each rate rather than the sales; this mode works the sales out from the tax.
  const [taxMode, setTaxMode] = useState(false);
  const [uploads, setUploads] = useState<{ upload_id: string; file_name: string; uploaded_at: string }[]>([]);
  const [viewing, setViewing] = useState<{ id: string; name: string; url: string; isPdf: boolean } | null>(null);
  const [viewErr, setViewErr] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ uploads: { upload_id: string; file_name: string; uploaded_at: string }[] }>(`/documents/uploads?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => setUploads((r.uploads || []).filter((u) => /\.(png|jpe?g|webp|gif|pdf|heic)$/i.test(u.file_name)).slice(0, 12))).catch(() => setUploads([]));
  }, [clientId]);
  useEffect(() => () => { if (viewing) URL.revokeObjectURL(viewing.url); }, [viewing]);
  async function openUpload(u: { upload_id: string; file_name: string }) {
    setViewErr(null);
    try { const blob = await fetchAuthedBlob(`/documents/uploads/${u.upload_id}/download`); setViewing({ id: u.upload_id, name: u.file_name, url: URL.createObjectURL(blob), isPdf: /\.pdf$/i.test(u.file_name) }); }
    catch { setViewErr("Could not open that file."); }
  }
  const [reportFiles, setReportFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<{ ok: boolean; lines: string[] } | null>(null);
  interface ParsedPos { from: string | null; to: string | null; taxable: { rate: number; amount: number; name: string }[]; nonTaxable: number; cash: number; card: number; ebt: number; taxCollected: number | null; warnings: string[]; foundOverview: boolean; foundTaxes: boolean }
  /** Reads the PDF / Excel reports the POS exported and fills the boxes below — nothing is saved until Save is pressed. */
  async function readReports() {
    setReading(true); setReadNote(null); setError(null);
    try {
      const files = await Promise.all(reportFiles.map(async (f) => ({ fileName: f.name, fileBase64: await fileToBase64(f) })));
      const r = await api.post<ParsedPos>("/sales-input-import/pos/parse", { clientId, files });
      const lines: string[] = []; const next: Record<string, string> = {};
      setTaxMode(false);
      for (const t of r.taxable) {
        const cat = taxableCats.find((c) => rateOf(c) === t.rate);
        if (cat) next[cat.category_id] = String(t.amount); else lines.push(`No category at ${t.rate}% for this client — ${money(t.amount)} of "${t.name}" sales was NOT filled in. Add it by hand.`);
      }
      setTaxable(next); setNoTax(r.nonTaxable ? String(r.nonTaxable) : ""); setRemoved("");
      setTax(r.taxCollected != null ? String(r.taxCollected) : "");
      if (r.foundOverview) { setDebit(r.card ? String(r.card) : ""); setCredit(""); setEbt(r.ebt ? String(r.ebt) : ""); setCashTyped(r.cash ? String(r.cash) : ""); }
      if (r.to) setSaleDate(r.to);
      idem.current = null;
      lines.push(...r.warnings);
      setReadNote({ ok: true, lines: [`Filled from ${reportFiles.length === 1 ? "the file" : "the files"}${r.from && r.to ? ` (${r.from} to ${r.to})` : ""}. Check the numbers against the report, then Save.`, ...lines] });
    } catch (e) { setReadNote({ ok: false, lines: [e instanceof ApiError ? e.message : "Could not read the files."] }); } finally { setReading(false); }
  }
  const rateOf = (c: Cat) => Number(/\((\d+(?:\.\d+)?)\s*%\)/.exec(c.category_name)?.[1]) || 0;

  const salesFor = (c: Cat) => (taxMode && rateOf(c) > 0 ? r2(num(taxable[c.category_id] || "") / (rateOf(c) / 100)) : num(taxable[c.category_id] || ""));
  const taxableTotal = r2(taxableCats.reduce((s, c) => s + salesFor(c), 0));
  const typedTaxTotal = r2(taxableCats.reduce((s, c) => s + (taxMode && rateOf(c) > 0 ? num(taxable[c.category_id] || "") : 0), 0));
  const taxAmount = taxMode && tax === "" ? typedTaxTotal : num(tax);
  const nonTaxable = r2(num(noTax) + num(removed));
  const pretax = r2(taxableTotal + nonTaxable);
  const expected = r2(pretax + taxAmount);
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
        clientId, taxable: taxableCats.map((c) => ({ categoryId: c.category_id, amount: salesFor(c) })).filter((t) => t.amount > 0), nonTaxable, cash, card, ebt: num(ebt), taxCollected: taxAmount,
      }).then(setAlloc).catch(() => setAlloc(null));
    }, 350);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, JSON.stringify(taxable), taxMode, nonTaxable, cash, card, ebt, taxAmount]);

  async function save() {
    if (!alloc) return;
    setSaving(true); setError(null);
    try {
      if (!idem.current) idem.current = crypto.randomUUID();
      await api.post("/accounting/sales", {
        clientId, saleDate, grossSales: 0, blocks: blocksToPayload(stateFromBlocks(alloc.blocks)),
        adjustments: Math.abs(alloc.suggestedAdjustment) >= 0.005 ? alloc.suggestedAdjustment : 0,
        notes: `From POS reports: ${money(paid)} collected (cash ${money(cash)}, card ${money(card)}, EBT ${money(num(ebt))}); sales tax collected ${money(taxAmount)}.`,
        idempotencyKey: idem.current,
      });
      idem.current = null;
      toast(`${monthLabel(saleDate)} sales saved.`);
      setTaxable({}); setNoTax(""); setRemoved(""); setTax(""); setDebit(""); setCredit(""); setEbt(""); setCashTyped(""); setAlloc(null);
      onSaved();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not save."); } finally { setSaving(false); }
  }

  /** One labelled number box; type="number" so the phone keypad shows digits. */
  const field = (label: string, value: string, set: (v: string) => void, hint?: string) => (
    <label className="sb-total">{label}
      <input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => { set(e.target.value); idem.current = null; }} />
      {hint && <span className="muted" style={{ fontSize: 11.5, fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>{hint}</span>}
    </label>
  );
  const row = (label: string, value: string, set: (v: string) => void, right: string, aria: string) => (
    <label className="sb-row" key={aria}><span>{label}</span>
      <input type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" aria-label={aria} value={value} onChange={(e) => { set(e.target.value); idem.current = null; }} />
      <b className="sb-rowtax" dir="ltr">{right}</b>
    </label>
  );
  const lineOf = (id: string) => alloc?.lines?.find((l) => l.categoryId === id);
  const taxedLines = taxableCats.filter((c) => salesFor(c) > 0);
  const checkOk = pretax > 0 && Math.abs(diff) <= 1;

  return (
    <div className="command-panel">
      <div className="command-panel-header">
        <div><h3 className="command-panel-title" style={{ display: "flex", gap: 8, alignItems: "center" }}><Receipt size={16} aria-hidden="true" /> Enter a month from the POS reports</h3>
          <div className="command-panel-note">Type the numbers from the POS (Clover, Square, Toast…) — everything else is calculated, and the figures for the Sales Tax filing appear on the right.</div></div>
        <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
      </div>
      {uploads.length > 0 && (
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }}>
          <b>Reports they sent — open beside the form:</b>
          {uploads.map((u) => <button key={u.upload_id} type="button" className={`tpl-chip${viewing?.id === u.upload_id ? " on" : ""}`} onClick={() => openUpload(u)} title={new Date(u.uploaded_at).toLocaleDateString()}>{u.file_name.length > 28 ? `${u.file_name.slice(0, 26)}…` : u.file_name}</button>)}
          {viewing && <button type="button" className="btn btn-sm" onClick={() => setViewing(null)}>Hide</button>}
          {viewErr && <span style={{ color: "var(--red)" }}>{viewErr}</span>}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: viewing ? "minmax(0, 1fr) minmax(0, 1.4fr)" : "minmax(0, 1fr)", alignItems: "start" }} className="pos-split">
      {viewing && (
        <div style={{ padding: 12, position: "sticky", top: 8, maxHeight: "92vh", overflow: "auto", borderRight: "1px solid var(--line)" }}>
          {viewing.isPdf
            ? <iframe title={viewing.name} src={viewing.url} style={{ width: "100%", height: "80vh", border: 0 }} />
            : <a href={viewing.url} target="_blank" rel="noreferrer" title="Open full size"><img src={viewing.url} alt={viewing.name} style={{ width: "100%", height: "auto", display: "block" }} /></a>}
        </div>
      )}
      <form onKeyDown={enterAsTab} onSubmit={(e) => e.preventDefault()} style={{ padding: 16, display: "grid", gap: 14 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "end", justifyContent: "space-between" }}>
          <label className="field" style={{ margin: 0, width: 240 }}>Month — report ends on <DateInput value={saleDate} onChange={(e) => setSaleDate(e.target.value)} /></label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}><input type="checkbox" checked={taxMode} onChange={(e) => { setTaxMode(e.target.checked); setTaxable({}); }} /> My report shows tax amounts, not sales (Square, Toast…)</label>
        </div>

        <details open={reportFiles.length > 0 || undefined} className="muted" style={{ fontSize: 13 }}>
          <summary style={{ cursor: "pointer" }}>Have the PDF or Excel the POS exported? Read it instead of typing</summary>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <FileDropInput files={reportFiles} onFilesChange={setReportFiles} accept=".pdf,.xlsx,.xls,.csv" hint="Clover: the Taxes report, and the Sales Overview for how they paid. Up to 4 files. Photos and scanned PDFs can't be read — type those." />
            <div><button type="button" className="btn btn-sm" disabled={reading || !reportFiles.length} onClick={readReports}>{reading ? "Reading…" : "Read the report & fill the form"}</button></div>
            {readNote && <div className="tender-warn" style={{ color: readNote.ok ? undefined : "var(--red)" }}>{readNote.lines.map((l, i) => <div key={i}>{i > 0 && readNote.ok ? "⚠ " : ""}{l}</div>)}</div>}
          </div>
        </details>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 12, alignItems: "start" }}>
          <section className="sb-card cash" aria-label="Taxes report">
            <header><Receipt size={16} aria-hidden="true" /><h3>1 · Taxes report</h3></header>
            <div className="sb-row sb-head"><span></span><span>{taxMode ? "Tax collected" : "Sales"}</span><span>{taxMode ? "Sales" : "Tax"}</span></div>
            {taxableCats.map((c) => {
              const l = lineOf(c.category_id); const has = salesFor(c) > 0;
              const right = !has ? "—" : taxMode ? money(salesFor(c)) : money(l ? l.taxAmount : r2(salesFor(c) * rateOf(c) / 100));
              return row(taxMode && rateOf(c) > 0 ? `${c.category_name}` : c.category_name, taxable[c.category_id] || "", (v) => setTaxable((t) => ({ ...t, [c.category_id]: v })), right, `Taxes report — ${c.category_name}`);
            })}
            {row("No Tax (0%)", noTax, setNoTax, "—", "No Tax")}
            {row("Tax Removed (0%)", removed, setRemoved, "—", "Tax Removed")}
            <div className="sb-row sb-sum"><span>Total</span><b dir="ltr">{money(pretax)}</b><b dir="ltr">{money(alloc ? alloc.computedTax : 0)}</b></div>
            {field("Total tax collected (Net Amount)", tax, setTax, taxMode ? "Leave empty to add up the taxes above" : "From the Total block of the Taxes report")}
          </section>

          <section className="sb-card card" aria-label="Payments report">
            <header><Landmark size={16} aria-hidden="true" /><h3>2 · Payments report</h3></header>
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>How customers paid, tax included. Leave empty if you only have the Taxes report — it's entered as cash.</p>
            {field("Debit / card", debit, setDebit, "Or the one card total")}
            {field("Credit card (if listed separately)", credit, setCredit)}
            {field("EBT / SNAP", ebt, setEbt)}
            {field("Cash", cashTyped, setCashTyped, cashTyped === "" && expected > 0 ? `Calculated: ${money(cash)}` : undefined)}
            <div className="sb-calc strong"><span>Collected</span><b dir="ltr">{money(paid)}</b></div>
          </section>

          <section className="sb-card snap" aria-label="Figures for the Sales Tax filing" style={{ borderColor: checkOk ? "var(--green)" : undefined }}>
            <header><ClipboardCheck size={16} aria-hidden="true" /><h3>3 · For the Sales Tax filing</h3></header>
            {pretax <= 0 ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>Type the Taxes report numbers and the filing figures appear here.</p> : (<>
              {taxedLines.map((c) => { const l = lineOf(c.category_id); return (
                <div key={c.category_id} className="sb-calc"><span>{c.category_name}</span><b dir="ltr">{money(salesFor(c))}{l ? <span className="muted"> · tax {money(l.taxAmount)}</span> : null}</b></div>
              ); })}
              <div className="sb-calc"><span>Non-taxable sales</span><b dir="ltr">{money(nonTaxable)}</b></div>
              <div className="sb-calc strong"><span>Total sales</span><b dir="ltr">{money(pretax)}</b></div>
              {alloc && <div className="sb-calc"><span>Tax at the category rates</span><b dir="ltr">{money(alloc.computedTax)}</b></div>}
              {alloc && Math.abs(alloc.suggestedAdjustment) >= 0.005 && <div className="sb-calc"><span>Adjustment (POS rounding)</span><b dir="ltr">{money(alloc.suggestedAdjustment)}</b></div>}
              <div className="sb-calc strong" style={{ fontSize: 15 }}><span>Sales tax to report</span><b dir="ltr">{money(taxAmount)}</b></div>
              <div className="sb-calc"><span>Collected from customers</span><b dir="ltr">{money(expected)}</b></div>
              <div className={`sb-calc${checkOk ? "" : " bad"}`}><span>{checkOk ? "✓ Payments add up" : "⚠ Payments differ by"}</span><b dir="ltr">{checkOk ? (Math.abs(diff) >= 0.005 ? `off ${money(Math.abs(diff))}` : "") : money(Math.abs(diff))}</b></div>
              {alloc && <p className="muted" style={{ margin: 0, fontSize: 12 }}>Entered as Cash {money(alloc.blocks.cash.total)} · Card {money(alloc.blocks.card.total)} · SNAP/EBT {money(alloc.blocks.snap)}</p>}
            </>)}
          </section>
        </div>

        {alloc?.warnings.map((w, i) => <div key={i} className="tender-warn" style={{ color: "var(--red)" }}>⚠ {w}</div>)}
        {error && <div className="tender-warn" style={{ color: "var(--red)" }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" disabled={saving || !ready || !alloc} onClick={save}>{saving ? "Saving…" : `Save ${monthLabel(saleDate) || "sales"}`}</button>
          {!ready && pretax > 0 && <span className="muted" style={{ fontSize: 12 }}>The payments need to add up before you can save.</span>}
        </div>
      </form>
      </div>
    </div>
  );
}
