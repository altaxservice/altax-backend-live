import { useEffect, useMemo, useRef, useState } from "react";
import { Receipt } from "lucide-react";
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
        <div><h3 className="command-panel-title" style={{ display: "flex", gap: 8, alignItems: "center" }}><Receipt size={16} aria-hidden="true" /> Enter month from the POS reports</h3>
          <div className="command-panel-note">Works with any POS (Clover, Square, Toast…): type the monthly numbers from its sales / tax / payments report. Cash is worked out for you; press Save when the check line is green.</div></div>
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
      <div style={{ display: "grid", gridTemplateColumns: viewing ? "minmax(0, 1fr) minmax(0, 1.25fr)" : "minmax(0, 1fr)", alignItems: "start" }} className="pos-split">
      {viewing && (
        <div style={{ padding: 12, position: "sticky", top: 8, maxHeight: "92vh", overflow: "auto", borderRight: "1px solid var(--line)" }}>
          {viewing.isPdf
            ? <iframe title={viewing.name} src={viewing.url} style={{ width: "100%", height: "80vh", border: 0 }} />
            : <a href={viewing.url} target="_blank" rel="noreferrer" title="Open full size"><img src={viewing.url} alt={viewing.name} style={{ width: "100%", height: "auto", display: "block" }} /></a>}
        </div>
      )}
      <form onKeyDown={enterAsTab} onSubmit={(e) => e.preventDefault()} style={{ padding: 16, display: "grid", gap: 12 }}>
        <details open={reportFiles.length > 0 || undefined} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px" }}>
          <summary style={{ cursor: "pointer", fontSize: 13 }}><b>Have the PDF or Excel the POS exported?</b> Read it instead of typing</summary>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <FileDropInput files={reportFiles} onFilesChange={setReportFiles} accept=".pdf,.xlsx,.xls,.csv" hint="Clover: the Taxes report (and the Sales Overview for how they paid). Up to 4 files." />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-sm" disabled={reading || !reportFiles.length} onClick={readReports}>{reading ? "Reading…" : "Read the report & fill the form"}</button>
              <span className="muted" style={{ fontSize: 12 }}>Photos and scanned PDFs have no text — for those, type the numbers below.</span>
            </div>
            {readNote && <div className="tender-warn" style={{ color: readNote.ok ? undefined : "var(--red)" }}>{readNote.lines.map((l, i) => <div key={i}>{i > 0 && readNote.ok ? "⚠ " : ""}{l}</div>)}</div>}
          </div>
        </details>
        <label className="field" style={{ margin: 0, maxWidth: 260 }}>Month — report ends on <span className="muted">(becomes the sale date)</span><DateInput value={saleDate} onChange={(e) => setSaleDate(e.target.value)} /></label>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}><div className="muted" style={{ fontSize: 12.5 }}><b>Tax report</b> — {taxMode ? "tax collected at each rate (the sales are worked out from it)" : "sales before tax for each tax rate"}</div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}><input type="checkbox" checked={taxMode} onChange={(e) => { setTaxMode(e.target.checked); setTaxable({}); }} /> My report shows tax amounts, not sales (Square, Toast…)</label></div>
        <div style={grid}>
          {taxableCats.map((c) => box(taxMode && rateOf(c) > 0 ? `Tax collected at ${rateOf(c)}%` : c.category_name, taxable[c.category_id] || "", (v) => setTaxable((t) => ({ ...t, [c.category_id]: v })), taxMode && rateOf(c) > 0 && num(taxable[c.category_id] || "") > 0 ? `= ${money(salesFor(c))} of sales` : undefined))}
          {box("No Tax (0%)", noTax, setNoTax)}
          {box("Tax-exempt / removed (0%)", removed, setRemoved, "Leave empty if the report has none")}
          {box("Total tax collected", tax, setTax, taxMode ? "Leave empty to add up the taxes above" : "The month's tax total (Clover: “Net Amount” in the Total block)")}
        </div>

        <div className="muted" style={{ fontSize: 12.5 }}><b>Payments report</b> — how customers paid <span>(leave empty if you only have the Taxes report — it's entered as cash)</span></div>
        <div style={grid}>
          {box("Card (debit, or all cards)", debit, setDebit, "If the report shows one card total, type it here")}
          {box("Credit card (if listed separately)", credit, setCredit)}
          {box("EBT", ebt, setEbt)}
          {box("Cash", cashTyped, setCashTyped, cashTyped === "" && expected > 0 ? `Calculated: ${money(cash)}` : "Typed from the report")}
        </div>

        {pretax > 0 && (
          <div className="tender-warn" style={{ background: Math.abs(diff) <= 1 ? "var(--green-soft, #e8f6ee)" : undefined }}>
            Sales {money(pretax)} + tax {money(taxAmount)} = <b>{money(expected)}</b> · paid {money(paid)} ·{" "}
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
    </div>
  );
}
