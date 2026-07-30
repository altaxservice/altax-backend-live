import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import type { SalesTaxResult } from "../api/calculators";
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

function SalesTaxCalculator() {
  const [state, setState] = useState("MD");
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<SalesTaxResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const amt = Number(amount);
    if (!state || !amount || !Number.isFinite(amt) || amt < 0) { setResult(null); return; }
    setLoading(true);
    const t = setTimeout(() => {
      api.get<SalesTaxResult>(`/calculators/sales-tax?state=${encodeURIComponent(state)}&amount=${amt}`)
        .then((res) => { setResult(res); setError(null); })
        .catch((err) => setError(err instanceof ApiError ? err.message : "Could not look up this rate."))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [state, amount]);

  return (
    <div className="card">
      <h2 style={{ fontSize: 15, marginTop: 0 }}>Sales Tax</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>
        Uses a Fee Schedule rate if the firm has set one for this state (the same rate an
        invoice's "Automatic Calculation" would use); otherwise falls back to that state's
        published general sales tax rate.
      </p>

      {error && <ErrorBanner error={error} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="stc-state">State</label>
          <select id="stc-state" value={state} onChange={(e) => setState(e.target.value)}>
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="stc-amount">Sale amount</label>
          <input id="stc-amount" type="number" step="0.01" min="0" placeholder="0.00"
            value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
        {loading ? (
          <p className="muted" style={{ fontSize: 13 }}>Calculating…</p>
        ) : result ? (
          <>
            <Row label={`Rate for ${result.state}`} value={`${result.rate}%`} />
            <Row label="Sale amount" value={money(result.amount)} />
            <Row label="Sales tax" value={money(result.taxAmount)} />
            <Row label="Total" value={money(result.total)} bold />
            {result.source === "firm" ? (
              <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                Firm rate from Fee Schedule &amp; Tax Rates.
              </p>
            ) : result.rate === 0 ? (
              <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                {result.state} has no general state sales tax.
              </p>
            ) : (
              <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                {result.state}'s published general state rate — no Fee Schedule entry is on file
                for this state, and this doesn't include county/city surtaxes. Add a Fee Schedule
                rate for exact jurisdiction pricing.
              </p>
            )}
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>Enter a state and amount.</p>
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
