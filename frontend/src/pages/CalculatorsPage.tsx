import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import type { SalesTaxCategory, SalesTaxPreviewResult } from "../api/calculators";
import { US_STATES } from "../utils/clientOptions";

const money = (n: number | null | undefined): string =>
  `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Tools → Calculators.
 *
 * Two quick one-off tools that don't need a real record behind them: sales
 * tax on a single sale, and a quarterly estimated-tax safe-harbor split.
 * Neither writes anything to the database — punch in numbers, read an
 * answer, move on.
 */
export function CalculatorsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Calculators</h1>
      <p className="muted" style={{ margin: "0 0 16px", fontSize: 13 }}>
        Quick math for the counter — nothing here is saved.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
        <SalesTaxCalculator />
        <SafeHarborCalculator />
      </div>
    </div>
  );
}

interface SalesTaxLine { id: number; categoryId: string; taxableAmount: string }
let salesTaxLineSeq = 0;
const emptySalesTaxLine = (): SalesTaxLine => ({ id: ++salesTaxLineSeq, categoryId: "", taxableAmount: "" });

/**
 * Adopts the exact same "Sales by Category" process as Accounting → Sales
 * Input: pick a state, then a repeatable list of category + taxable-amount
 * lines (e.g. $500 General + $200 Vape + $50 Alcohol, each its own line),
 * computed via the same lookupRate precedence Sales Input itself uses — see
 * computeSalesTaxLines in ../../src/common/taxRates.ts.
 */
function SalesTaxCalculator() {
  const [state, setState] = useState("MD");
  const [categories, setCategories] = useState<SalesTaxCategory[]>([]);
  const [lines, setLines] = useState<SalesTaxLine[]>([emptySalesTaxLine()]);
  const [result, setResult] = useState<SalesTaxPreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Categories are per-state (General, Vape, Alcohol, a local jurisdiction
  // add-on, etc.) — reload whenever the state changes, and reset the lines
  // so switching states doesn't carry over a category that may not exist
  // there.
  useEffect(() => {
    api.get<{ categories: SalesTaxCategory[] }>(`/calculators/sales-tax-categories?state=${encodeURIComponent(state)}`)
      .then((res) => setCategories(res.categories))
      .catch(() => setCategories([]));
    setLines([emptySalesTaxLine()]);
  }, [state]);

  function updateLine(id: number, patch: Partial<SalesTaxLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function removeLine(id: number) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  useEffect(() => {
    const payloadLines = lines
      .filter((l) => l.categoryId && Number(l.taxableAmount) > 0)
      .map((l) => ({ categoryId: l.categoryId, taxableAmount: Number(l.taxableAmount) }));
    if (payloadLines.length === 0) { setResult(null); return; }
    setLoading(true);
    const t = setTimeout(() => {
      api.post<SalesTaxPreviewResult>("/calculators/sales-tax-preview", { state, lines: payloadLines })
        .then((res) => { setResult(res); setError(null); })
        .catch((err) => setError(err instanceof ApiError ? err.message : "Could not calculate tax."))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, JSON.stringify(lines)]);

  return (
    <div className="card">
      <h2 style={{ fontSize: 15, marginTop: 0 }}>Sales Tax</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>
        Same process as Accounting → Sales Input: pick a state, then add a category and taxable
        amount for each type of sale — General, Vape, Alcohol, a local jurisdiction add-on, etc.
      </p>

      {error && <ErrorBanner error={error} />}

      <div className="field" style={{ margin: 0 }}>
        <label htmlFor="stc-state">State</label>
        <select id="stc-state" value={state} onChange={(e) => setState(e.target.value)}>
          {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", margin: "0 0 6px" }}>
          Sales by Category
        </div>
        {lines.map((line, i) => (
          <div key={line.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr auto", gap: 8, alignItems: "end", marginBottom: 8 }}>
            <div className="field" style={{ margin: 0 }}>
              {i === 0 && <label>Category</label>}
              <select value={line.categoryId} onChange={(e) => updateLine(line.id, { categoryId: e.target.value })}>
                <option value="">Select a category…</option>
                {categories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.categoryName}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              {i === 0 && <label>Taxable Amount</label>}
              <input type="number" step="0.01" min="0" placeholder="0.00" value={line.taxableAmount}
                onChange={(e) => updateLine(line.id, { taxableAmount: e.target.value })} />
            </div>
            <button type="button" className="btn btn-sm" disabled={lines.length <= 1} onClick={() => removeLine(line.id)}>✕</button>
          </div>
        ))}
        <button type="button" className="btn btn-sm" onClick={() => setLines((prev) => [...prev, emptySalesTaxLine()])}>+ Add Category</button>
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
        {loading ? (
          <p className="muted" style={{ fontSize: 13 }}>Calculating…</p>
        ) : result && result.lines.length > 0 ? (
          <>
            {result.lines.map((l) => (
              <Row key={l.categoryId} label={`${l.categoryName} — ${money(l.taxableAmount)} @ ${l.rate}%`} value={money(l.taxAmount)} />
            ))}
            <Row label="Taxable amount" value={money(result.totalTaxableAmount)} />
            <Row label="Total tax" value={money(result.totalTax)} bold />
            <Row label="Grand total" value={money(result.grandTotal)} bold />
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>Pick a category and enter an amount for at least one line.</p>
        )}
      </div>
    </div>
  );
}

const SAFE_HARBOR_THRESHOLD = 150000;
const SAFE_HARBOR_THRESHOLD_MFS = 75000;

function SafeHarborCalculator() {
  const [priorYearTax, setPriorYearTax] = useState("");
  const [priorYearAgi, setPriorYearAgi] = useState("");
  const [mfs, setMfs] = useState(false);
  const [currentYearTax, setCurrentYearTax] = useState("");
  const [alreadyPaid, setAlreadyPaid] = useState("");
  const [quartersLeft, setQuartersLeft] = useState("4");

  const priorTax = Number(priorYearTax) || 0;
  const agi = Number(priorYearAgi) || 0;
  const threshold = mfs ? SAFE_HARBOR_THRESHOLD_MFS : SAFE_HARBOR_THRESHOLD;
  const safeHarborPercent = agi > threshold ? 110 : 100;
  const fromPriorYear = priorTax * (safeHarborPercent / 100);
  const currentTax = Number(currentYearTax) || 0;
  const fromCurrentYear = currentYearTax ? currentTax * 0.9 : null;
  const requiredAnnual = fromCurrentYear !== null ? Math.min(fromPriorYear, fromCurrentYear) : fromPriorYear;
  const paid = Number(alreadyPaid) || 0;
  const remaining = Math.max(requiredAnnual - paid, 0);
  const quarters = Number(quartersLeft) || 1;
  const perQuarter = remaining / quarters;
  const hasInput = priorYearTax.trim().length > 0;

  return (
    <div className="card">
      <h2 style={{ fontSize: 15, marginTop: 0 }}>Quarterly Estimated Tax — Safe Harbor</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>
        Pay at least this much and the IRS's underpayment penalty generally doesn't apply,
        regardless of what's actually owed at filing time.
      </p>

      <div className="field" style={{ margin: 0 }}>
        <label htmlFor="sh-prior-tax">Prior year total tax (Form 1040, line 22 or equivalent)</label>
        <input id="sh-prior-tax" type="number" step="0.01" min="0" placeholder="0.00"
          value={priorYearTax} onChange={(e) => setPriorYearTax(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="sh-prior-agi">Prior year AGI</label>
          <input id="sh-prior-agi" type="number" step="0.01" min="0" placeholder="0.00"
            value={priorYearAgi} onChange={(e) => setPriorYearAgi(e.target.value)} />
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, paddingBottom: 8, whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={mfs} onChange={(e) => setMfs(e.target.checked)} />
          Married filing separately
        </label>
      </div>

      <div className="field">
        <label htmlFor="sh-current-tax">This year's projected total tax <span className="muted">(optional)</span></label>
        <input id="sh-current-tax" type="number" step="0.01" min="0" placeholder="Leave blank to use prior-year safe harbor only"
          value={currentYearTax} onChange={(e) => setCurrentYearTax(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="sh-paid">Already paid this year <span className="muted">(withholding + estimates)</span></label>
          <input id="sh-paid" type="number" step="0.01" min="0" placeholder="0.00"
            value={alreadyPaid} onChange={(e) => setAlreadyPaid(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="sh-quarters">Payments remaining this year</label>
          <select id="sh-quarters" value={quartersLeft} onChange={(e) => setQuartersLeft(e.target.value)}>
            <option value="4">4</option>
            <option value="3">3</option>
            <option value="2">2</option>
            <option value="1">1</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
        {hasInput ? (
          <>
            <Row label={`Safe harbor (${safeHarborPercent}% of prior year)`} value={money(fromPriorYear)} />
            {fromCurrentYear !== null && <Row label="90% of this year's projected tax" value={money(fromCurrentYear)} />}
            <Row label="Required annual payment" value={money(requiredAnnual)} bold />
            <Row label="Already paid" value={`− ${money(paid)}`} />
            <Row label="Remaining balance" value={money(remaining)} bold />
            <Row label={`Per remaining payment (÷${quarters})`} value={money(perQuarter)} bold />
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>Enter last year's total tax to get started.</p>
        )}
      </div>

      <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>
        Standard IRS safe-harbor rule: pay the smaller of 100% of last year's tax (110% if
        prior-year AGI was over ${SAFE_HARBOR_THRESHOLD.toLocaleString()}, ${SAFE_HARBOR_THRESHOLD_MFS.toLocaleString()} if married filing
        separately) or 90% of this year's actual tax. This estimates the safe-harbor floor,
        not the exact amount owed — and doesn't include Maryland's separate state estimated
        payments. Confirm current-year due dates on the tax calendar before sending a payment.
      </p>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", gap: 16, padding: "6px 0",
      borderBottom: "1px solid var(--line)", fontWeight: bold ? 700 : 400,
    }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13 }}>{value}</span>
    </div>
  );
}
