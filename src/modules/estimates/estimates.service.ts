import { query } from "../../config/db";

/**
 * The fee engine.
 *
 * It knows how fees COMBINE — a base filing, plus a speed surcharge, plus
 * per-copy charges, plus a percentage technology fee — but never what any of
 * them cost. Every amount comes from v3_fee_items, which the firm edits in the
 * app, because agency fees change and a quote that silently uses last year's
 * numbers is worse than no quote at all.
 */

export interface FeeItem {
  fee_item_id: string;
  name: string;
  category: string;
  agency: string | null;
  jurisdiction: string;
  entity_types: string[];
  business_types: string[];
  speed: string | null;
  amount_kind: string;
  percent_rate: string | number;
  unit_cost: string | number;
  unit_price: string | number;
  default_qty: string | number;
  included: boolean;
  optional: boolean;
  /** Applies to every jurisdiction in its state — how state filings reach county jobs. */
  statewide: boolean;
  /** Real work to be done, so converting the estimate opens a task for it. */
  creates_task: boolean;
  turnaround_days: string | null;
  notes: string | null;
  active: boolean;
  sort_order: number;
}

export interface EstimateLine {
  line_id?: string;
  fee_item_id?: string | null;
  sort_order?: number;
  description: string;
  category: string;
  agency?: string | null;
  qty: number;
  unit_cost: number;
  unit_price: number;
  amount_kind?: string;
  percent_rate?: number;
  included?: boolean;
  payer?: string;
  remitted_at?: string | null;
  remitted_amount?: number | null;
  remittance_ref?: string | null;
  creates_task?: boolean;
}

export interface EstimateTotals {
  /** What the client pays us for our own work. */
  serviceTotal: number;
  /** What the client pays us to hand on to agencies. */
  governmentTotal: number;
  /** Government fees the client is paying the agency directly — shown, not billed. */
  clientDirectTotal: number;
  subtotal: number;
  discount: number;
  taxRate: number;
  tax: number;
  total: number;
  deposit: number;
  balanceDue: number;
  /** What those agency fees actually cost us. */
  agencyCost: number;
  /** total charged for agency lines − what they cost = real margin on pass-throughs. */
  passThroughMargin: number;
  /** Collected for agencies but not yet proven remitted. */
  unremitted: number;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Empty applies-to list means "every one" — the common case, so it reads as no restriction. */
function appliesTo(list: unknown, value: string | null | undefined): boolean {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length === 0) return true;
  if (!value) return false;
  return arr.some((x) => String(x).toLowerCase() === String(value).toLowerCase());
}

/**
 * Picks the catalog rows that apply to a job. Speed is the subtle one: a row
 * with speed = NULL applies at any speed, while an 'Expedited' row is added ONLY
 * on an expedited job — which is how SDAT actually prices, and the reason a
 * hand-written quote so often misses the copy-expedite line.
 */
export async function feeItemsFor(opts: {
  entityType?: string | null;
  businessType?: string | null;
  jurisdiction?: string | null;
  speed?: string | null;
  includeOptional?: boolean;
}): Promise<FeeItem[]> {
  const rows = await query<FeeItem>(
    `SELECT * FROM altax.v3_fee_items WHERE active = TRUE ORDER BY sort_order ASC, name ASC`
  );
  return rows.filter((item) => {
    if (!opts.includeOptional && item.optional) return false;
    if (item.speed && String(item.speed).toLowerCase() !== String(opts.speed || "").toLowerCase()) return false;
    if (!appliesTo(item.entity_types, opts.entityType)) return false;
    if (!appliesTo(item.business_types, opts.businessType)) return false;
    // Jurisdictions are hierarchical, not flat. A state filing is owed on a
    // Baltimore City job just as much as a city permit is, so "statewide" rows
    // (SDAT) and "Any" rows (the firm's own services) always apply; everything
    // else has to name the job's own jurisdiction.
    if (item.statewide) return true;
    const j = String(item.jurisdiction || "").toLowerCase();
    if (j && j !== "any" && j !== String(opts.jurisdiction || "").toLowerCase()) return false;
    return true;
  });
}

/** Turns catalog rows into estimate lines, copying the amounts so a later fee change can't rewrite a sent estimate. */
export function linesFromFeeItems(items: FeeItem[]): EstimateLine[] {
  return items.map((item, i) => ({
    fee_item_id: item.fee_item_id,
    sort_order: i,
    description: item.name,
    category: item.category,
    agency: item.agency,
    qty: num(item.default_qty) || 1,
    unit_cost: num(item.unit_cost),
    unit_price: num(item.unit_price),
    amount_kind: item.amount_kind,
    percent_rate: num(item.percent_rate),
    included: Boolean(item.included),
    creates_task: Boolean(item.creates_task),
    payer: "Firm",
  }));
}

/** A line's cost/price, resolving percentage lines against the government subtotal. */
export function lineAmounts(line: EstimateLine, governmentBase: { cost: number; price: number }) {
  if (line.included) return { cost: 0, price: 0 };
  if (line.amount_kind === "percent") {
    const rate = num(line.percent_rate) / 100;
    return { cost: round2(governmentBase.cost * rate), price: round2(governmentBase.price * rate) };
  }
  const qty = num(line.qty) || 0;
  return { cost: round2(num(line.unit_cost) * qty), price: round2(num(line.unit_price) * qty) };
}

/**
 * Totals for an estimate.
 *
 * Two passes, because the technology fee is a percentage OF the other government
 * fees: fixed lines are summed first, then percentage lines are computed against
 * that base. Doing it in one pass would either miss the fee or apply it to itself.
 */
export function computeTotals(
  lines: EstimateLine[],
  opts: { discount?: number; taxRate?: number; deposit?: number }
): EstimateTotals {
  const billable = lines.filter((l) => (l.payer || "Firm") !== "Client");
  const clientDirect = lines.filter((l) => (l.payer || "Firm") === "Client");

  const fixedGov = billable.filter((l) => l.category === "Government" && l.amount_kind !== "percent");
  const base = fixedGov.reduce(
    (acc, l) => {
      const a = lineAmounts(l, { cost: 0, price: 0 });
      return { cost: acc.cost + a.cost, price: acc.price + a.price };
    },
    { cost: 0, price: 0 }
  );

  let serviceTotal = 0;
  let governmentTotal = 0;
  let agencyCost = 0;
  let unremitted = 0;

  for (const line of billable) {
    const a = lineAmounts(line, base);
    if (line.category === "Government") {
      governmentTotal += a.price;
      agencyCost += a.cost;
      if (!line.remitted_at) unremitted += a.cost;
    } else {
      serviceTotal += a.price;
    }
  }

  const clientDirectTotal = clientDirect.reduce((sum, l) => sum + lineAmounts(l, base).price, 0);

  const subtotal = round2(serviceTotal + governmentTotal);
  const discount = round2(num(opts.discount));
  const taxRate = num(opts.taxRate);
  const taxed = Math.max(subtotal - discount, 0);
  const tax = round2(taxed * (taxRate / 100));
  const total = round2(taxed + tax);
  const deposit = round2(num(opts.deposit));

  return {
    serviceTotal: round2(serviceTotal),
    governmentTotal: round2(governmentTotal),
    clientDirectTotal: round2(clientDirectTotal),
    subtotal,
    discount,
    taxRate,
    tax,
    total,
    deposit,
    balanceDue: round2(total - deposit),
    agencyCost: round2(agencyCost),
    passThroughMargin: round2(governmentTotal - agencyCost),
    unremitted: round2(unremitted),
  };
}
