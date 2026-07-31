import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, viewFilePost } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import type { MdFilingResult, SalesTaxCategory, SalesTaxPreviewResult } from "../api/calculators";
import type { Client } from "../api/types";
import { US_STATES } from "../utils/clientOptions";
import { useSelectedClient } from "../context/SelectedClientContext";

/** Handoff key Accounting → Sales Input reads on load to prefill its category lines — see AccountingPage.tsx's SalesTab. Session-scoped (not localStorage) so a stale handoff never survives past this browser tab/session. */
export const CALCULATOR_TO_SALES_INPUT_KEY = "altax_calculator_to_sales_input";

const money = (n: number | null | undefined): string =>
  `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Tools → Calculators.
 *
 * Two quick one-off tools that don't need a real record behind them: sales
 * tax (with, for Maryland, its Form 202 timely-discount/late-penalty math
 * built right into the same card, computed off the sales tax it just
 * calculated), and a quarterly estimated-tax safe-harbor split. Neither
 * writes anything to the database — punch in numbers, read an answer, move
 * on.
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
const todayIso = () => new Date().toISOString().slice(0, 10);
/** Maryland sales tax returns are due the 20th of the month following the reporting period — the 20th of this month if we haven't passed it yet, otherwise next month's 20th. A sensible default "next due date," not just today's date. */
const nextMdDueDate = () => {
  const now = new Date();
  const due = new Date(now.getFullYear(), now.getMonth(), 20);
  if (now.getDate() > 20) due.setMonth(due.getMonth() + 1);
  return due.toISOString().slice(0, 10);
};

/**
 * Adopts the exact same "Sales by Category" process as Accounting → Sales
 * Input: pick a state, then a repeatable list of category + taxable-amount
 * lines (e.g. $500 General + $200 Vape + $50 Alcohol, each its own line),
 * computed via the same lookupRate precedence Sales Input itself uses — see
 * computeSalesTaxLines in ../../src/common/taxRates.ts.
 *
 * For Maryland, the total tax this computes feeds straight into the same
 * card's Form 202 timely-discount/late-penalty math (Lines 17-20, 36-38) —
 * no need to re-type the tax due, just add the return's due date and the
 * actual filing/payment date. See computeMdFiling in
 * ../../src/common/mdFiling.ts.
 */
function SalesTaxCalculator() {
  const navigate = useNavigate();
  const { clientId: globalClientId } = useSelectedClient();
  const [state, setState] = useState("MD");
  const [categories, setCategories] = useState<SalesTaxCategory[]>([]);
  const [lines, setLines] = useState<SalesTaxLine[]>([emptySalesTaxLine()]);
  const [result, setResult] = useState<SalesTaxPreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [mdDueDate, setMdDueDate] = useState(nextMdDueDate());
  const [mdPaidDate, setMdPaidDate] = useState(todayIso());
  const [mdFiling, setMdFiling] = useState<MdFilingResult | null>(null);
  const [mdFilingLoading, setMdFilingLoading] = useState(false);

  const [pdfBusy, setPdfBusy] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);

  const [clients, setClients] = useState<Client[]>([]);
  const [convertClientId, setConvertClientId] = useState("");

  useEffect(() => {
    api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => {});
  }, []);
  // Defaults to whichever client is selected app-wide (the right-rail client
  // panel) so the common case — working one client's calculation, then
  // sending it to their books — needs no extra picking. Still overridable
  // here since the calculator itself is client-agnostic.
  useEffect(() => {
    if (globalClientId) setConvertClientId(globalClientId);
  }, [globalClientId]);

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

  // Maryland only — Form 202's discount/penalty math is specific to that
  // return, so it only makes sense once the sales tax above has produced a
  // real total for this state.
  useEffect(() => {
    if (state !== "MD" || !result || result.totalTax <= 0) { setMdFiling(null); return; }
    setMdFilingLoading(true);
    const t = setTimeout(() => {
      api.get<MdFilingResult>(`/calculators/md-filing?taxDue=${result.totalTax}&dueDate=${mdDueDate}&paidDate=${mdPaidDate}`)
        .then(setMdFiling)
        .catch(() => setMdFiling(null))
        .finally(() => setMdFilingLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [state, result, mdDueDate, mdPaidDate]);

  // Taxable amount excludes 0%-rate lines (the Non-Taxable category, or any
  // exempt category like PA's Grocery) — Gross sales (Line 3), by contrast,
  // is every line's amount added together, taxed or not, matching Form
  // 202's own definition. Both are derived from the same computed lines, so
  // adding a Non-Taxable line automatically raises gross without touching
  // the tax due — no separate manual "Gross Sales" figure to keep in sync.
  const taxableOnlyAmount = result ? result.lines.filter((l) => l.rate > 0).reduce((sum, l) => sum + l.taxableAmount, 0) : 0;

  function handleClear() {
    setLines([emptySalesTaxLine()]);
    setResult(null);
    setError(null);
    setMdDueDate(nextMdDueDate());
    setMdPaidDate(todayIso());
    setMdFiling(null);
    setEmailTo("");
    setEmailStatus(null);
  }

  function buildPayload() {
    return {
      state,
      lines: lines.filter((l) => l.categoryId && Number(l.taxableAmount) > 0).map((l) => ({ categoryId: l.categoryId, taxableAmount: Number(l.taxableAmount) })),
      mdDueDate: state === "MD" ? mdDueDate : undefined,
      mdPaidDate: state === "MD" ? mdPaidDate : undefined,
    };
  }

  async function handlePreviewPdf() {
    setPdfBusy(true);
    try {
      await viewFilePost("/calculators/sales-tax-pdf", buildPayload());
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not generate this PDF.");
    } finally {
      setPdfBusy(false);
    }
  }

  async function handleEmail() {
    if (!emailTo.trim()) return;
    setEmailBusy(true);
    setEmailStatus(null);
    try {
      await api.post("/calculators/sales-tax-email", { ...buildPayload(), to: emailTo.trim() });
      setEmailStatus(`Emailed to ${emailTo.trim()}.`);
    } catch (err) {
      setEmailStatus(err instanceof ApiError ? err.message : "Could not send this email.");
    } finally {
      setEmailBusy(false);
    }
  }

  /**
   * Hands the current category lines off to Accounting → Sales Input for a
   * real client, rather than writing a v3_sales_input row directly from this
   * client-agnostic tool — the calculator has no date field and no client
   * context of its own, so the actual save (with a real date, and a chance
   * to review before committing) still happens on the Sales Input form
   * itself. Session-scoped handoff, read once by SalesTab in
   * AccountingPage.tsx and then cleared.
   */
  function handleConvertToSalesInput() {
    if (!convertClientId) return;
    const payloadLines = lines
      .filter((l) => l.categoryId && Number(l.taxableAmount) > 0)
      .map((l) => ({ categoryId: l.categoryId, taxableAmount: l.taxableAmount }));
    if (payloadLines.length === 0) return;
    sessionStorage.setItem(CALCULATOR_TO_SALES_INPUT_KEY, JSON.stringify({ clientId: convertClientId, lines: payloadLines }));
    navigate(`/accounting?tab=Sales&client=${encodeURIComponent(convertClientId)}`);
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: 15, marginTop: 0 }}>Sales Tax</h2>
      <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>
        Same process as Accounting → Sales Input: pick a state, then add a category and taxable
        amount for each type of sale — General, Vape, Alcohol, a local jurisdiction add-on, or
        Non-Taxable Sales (SNAP/EBT, exempt items — still counts toward gross sales, just not taxed).
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
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-sm" onClick={() => setLines((prev) => [...prev, emptySalesTaxLine()])}>+ Add Category</button>
          <button type="button" className="btn btn-sm" onClick={handleClear}>Clear</button>
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
        {loading ? (
          <p className="muted" style={{ fontSize: 13 }}>Calculating…</p>
        ) : result && result.lines.length > 0 ? (
          <>
            {result.lines.map((l) => (
              <Row key={l.categoryId} label={`${l.categoryName} — ${money(l.taxableAmount)} @ ${l.rate}%`} value={money(l.taxAmount)} />
            ))}
            <Row label="Gross sales (Line 3)" value={money(result.totalTaxableAmount)} />
            <Row label="Taxable amount" value={money(taxableOnlyAmount)} />
            <Row label="Total tax" value={money(result.totalTax)} bold />
            <Row label="Grand total" value={money(result.grandTotal)} bold />
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>Pick a category and enter an amount for at least one line.</p>
        )}
      </div>

      {result && result.lines.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <button type="button" className="btn btn-sm" disabled={pdfBusy} onClick={handlePreviewPdf}>
              {pdfBusy ? "Opening…" : "Preview PDF"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            <div className="field" style={{ margin: 0, flex: 1, minWidth: 180 }}>
              <label htmlFor="stc-email-to">Email to</label>
              <input id="stc-email-to" type="email" placeholder="name@example.com" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} />
            </div>
            <button type="button" className="btn btn-sm" disabled={emailBusy || !emailTo.trim()} onClick={handleEmail}>
              {emailBusy ? "Sending…" : "Email"}
            </button>
          </div>
          {emailStatus && <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{emailStatus}</p>}

          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", margin: "0 0 6px" }}>
              Send to Sales Input
            </div>
            <p className="muted" style={{ fontSize: 11.5, marginTop: 0, marginBottom: 8 }}>
              Carries these category lines over to a real client's Sales Input — pick the client, review the date and details there, then save.
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
              <div className="field" style={{ margin: 0, flex: 1, minWidth: 180 }}>
                <label htmlFor="stc-convert-client">Client</label>
                <select id="stc-convert-client" value={convertClientId} onChange={(e) => setConvertClientId(e.target.value)}>
                  <option value="">Select a client…</option>
                  {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
                </select>
              </div>
              <button type="button" className="btn btn-sm" disabled={!convertClientId} onClick={handleConvertToSalesInput}>
                Convert to Sales Input
              </button>
            </div>
          </div>
        </div>
      )}

      {state === "MD" && result && result.totalTax > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", margin: "0 0 6px" }}>
            Filing Discount / Late Penalty (Form 202)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 4 }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="stc-md-due-date">Return due date</label>
              <input id="stc-md-due-date" type="date" value={mdDueDate} onChange={(e) => setMdDueDate(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="stc-md-paid-date">Filing / payment date</label>
              <input id="stc-md-paid-date" type="date" value={mdPaidDate} onChange={(e) => setMdPaidDate(e.target.value)} />
            </div>
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 0, marginBottom: 8 }}>
            MD sales tax returns are due the 20th of the month following the reporting period —
            paying on or before that date is on time, no penalty or interest.
          </p>
          {mdFilingLoading ? (
            <p className="muted" style={{ fontSize: 13 }}>Calculating…</p>
          ) : mdFiling ? (
            <>
              {mdFiling.onTime ? (
                <>
                  <Row label="Timely discount (Line 18)" value={`− ${money(mdFiling.discount)}`} />
                  <Row label="Balance due (Line 20)" value={money(mdFiling.balanceDue)} bold />
                </>
              ) : (
                <>
                  <Row label="Penalty — 10% (Line 37a)" value={money(mdFiling.penalty)} />
                  <Row label={`Interest — ${(mdFiling.interestRateMonthly * 100).toFixed(4)}% × ${mdFiling.monthsLate} mo (Line 37b)`} value={money(mdFiling.interest)} />
                  <Row label="Balance due (Line 38)" value={money(mdFiling.balanceDue)} bold />
                </>
              )}
              <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                {mdFiling.onTime
                  ? "Filed and paid on or before the due date — eligible for the timely discount."
                  : "Paid after the due date — no timely discount; penalty and interest apply instead. Rate republished by Maryland every January — verify it's still current for a return in a future year."}
              </p>
            </>
          ) : null}
        </div>
      )}
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
