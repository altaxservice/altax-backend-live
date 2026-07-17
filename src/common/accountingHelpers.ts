import { query, queryOne } from "../config/db";
import { normalizeText } from "./assignment";
import { decryptValue } from "./encryption";

/**
 * A row's `state` column is "universal" (applies regardless of the caller's target
 * state) when it's blank or "US" — the marker used for genuinely federal rates
 * (FIT/FUTA/SS/MED) that don't vary by state. Any real state abbreviation ("MD",
 * "PA", ...) restricts that row to callers whose resolved state matches exactly.
 */
function isUniversalState(state: unknown): boolean {
  const s = normalizeText(state);
  return !s || s === "us";
}

/**
 * Mirrors alTaxV5Rate_: looks up a configurable rate by RateID (v3_tax_rates.rate_id).
 * Precedence: client-specific override > state match > universal/global default >
 * the caller-supplied defaultRate if nothing active matches at all. Shared by every
 * module that computes money from a rate (Sales Input, Payroll).
 *
 * `state` is optional and should be the caller's resolved target state (e.g.
 * client.state for payroll) — omit it to fall back to pre-state-aware behavior
 * (client override > universal/global only), which existing callers that don't pass
 * a state continue to get unchanged.
 */
export async function lookupRate(rateId: string, defaultRate: number, clientId?: string, state?: string): Promise<number> {
  const rows = await query<any>(
    `SELECT rate, scope, client_id, state FROM altax.v3_tax_rates WHERE rate_id = $1 AND active = true`,
    [rateId]
  );
  let stateRate: number | null = null;
  let globalRate: number | null = null;
  const targetClientId = String(clientId || "").trim();
  const targetState = normalizeText(state);

  for (const row of rows) {
    const rate = Number(row.rate);
    if (!Number.isFinite(rate)) continue;
    const scope = normalizeText(row.scope);
    const rowClientId = String(row.client_id || "").trim();
    const isExplicitGlobal = scope.includes("global") || scope.includes("all client");
    const isClientRate = !!rowClientId || (!isExplicitGlobal && scope.includes("client"));
    if (targetClientId && isClientRate && rowClientId === targetClientId) return rate;
    if (isClientRate) continue;
    if (isUniversalState(row.state)) {
      if (globalRate === null) globalRate = rate;
    } else if (targetState && normalizeText(row.state) === targetState) {
      if (stateRate === null) stateRate = rate;
    }
  }
  if (stateRate !== null) return stateRate;
  return globalRate === null ? defaultRate : globalRate;
}

/**
 * Same override precedence as lookupRate (client > state > universal/global >
 * defaultCap), but for v3_tax_rates.wage_cap — the annual per-employee wage
 * ceiling above which a rate (FUTA, SS, SUTA) no longer applies. Returns null if
 * the matched row has no cap (e.g. FIT, Medicare), meaning "uncapped." A state-
 * specific cap deliberately does NOT fall back to a different state's cap or to a
 * universal row — if this state's real wage base isn't configured yet, the safer
 * behavior is uncapped (via defaultCap) rather than silently applying another
 * state's number.
 */
export async function lookupWageCap(rateId: string, defaultCap: number | null, clientId?: string, state?: string): Promise<number | null> {
  const rows = await query<any>(
    `SELECT wage_cap, scope, client_id, state FROM altax.v3_tax_rates WHERE rate_id = $1 AND active = true`,
    [rateId]
  );
  let stateCap: number | null | undefined = undefined;
  let globalCap: number | null | undefined = undefined;
  const targetClientId = String(clientId || "").trim();
  const targetState = normalizeText(state);

  for (const row of rows) {
    const scope = normalizeText(row.scope);
    const rowClientId = String(row.client_id || "").trim();
    const isExplicitGlobal = scope.includes("global") || scope.includes("all client");
    const isClientRate = !!rowClientId || (!isExplicitGlobal && scope.includes("client"));
    const cap = row.wage_cap === null || row.wage_cap === undefined ? null : Number(row.wage_cap);
    if (targetClientId && isClientRate && rowClientId === targetClientId) return cap;
    if (isClientRate) continue;
    if (isUniversalState(row.state)) {
      if (globalCap === undefined) globalCap = cap;
    } else if (targetState && normalizeText(row.state) === targetState) {
      if (stateCap === undefined) stateCap = cap;
    }
  }
  if (stateCap !== undefined) return stateCap;
  return globalCap === undefined ? defaultCap : globalCap;
}

/**
 * Caps this paycheck's contribution to a wage-capped tax (FUTA, Social
 * Security) at what's left of the employee's annual limit, based on what
 * they've already been paid at this client so far this calendar year. Without
 * this, a rate like FUTA's 0.6% would keep applying to every paycheck all
 * year long instead of stopping once the employee crosses the $7,000 (or
 * whatever) annual wage base — see accounting.routes.ts payroll create/edit
 * routes, where this fixes exactly that bug (found while building Form 940,
 * which already implemented this cap correctly for the annual return itself,
 * just not for the paychecks/GL entries that feed into it).
 */
export async function capWagesToAnnualLimit(
  clientId: string,
  employeeName: string,
  payDate: string | null,
  wagesThisCheck: number,
  wageCap: number | null,
  excludePaycheckId?: string
): Promise<number> {
  if (wageCap === null || !payDate) return wagesThisCheck;
  const year = new Date(payDate).getFullYear();
  if (!Number.isFinite(year)) return wagesThisCheck;

  const row = await queryOne<any>(
    `SELECT COALESCE(SUM(federal_taxable_wages), 0) AS ytd
     FROM altax.v3_paychecks
     WHERE client_id = $1 AND employee = $2 AND EXTRACT(YEAR FROM pay_date) = $3
       AND lower(status) <> 'void'` + (excludePaycheckId ? ` AND paycheck_id <> $4` : ``),
    excludePaycheckId ? [clientId, employeeName, year, excludePaycheckId] : [clientId, employeeName, year]
  );
  const ytdBefore = Number(row?.ytd || 0);
  const remaining = Math.max(0, wageCap - ytdBefore);
  return Math.min(wagesThisCheck, remaining);
}

export function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/**
 * Rounds a tax RATE (a fraction like 0.0307 for 3.07%), not a dollar amount — reusing
 * money()'s 2-decimal rounding here would silently truncate any real-world rate needing
 * more precision (e.g. PA's 3.07%, or Medicare's 1.45% = 0.0145) down to whole percent.
 * Matches v3_tax_rates.rate's NUMERIC(9,6) column precision.
 */
export function rateValue(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0;
}

export interface GlEntryInput {
  entryDate?: string | Date | null;
  ref: string;
  description: string;
  account: string;
  debit: number;
  credit: number;
  source: string;
  notes?: string | null;
}

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
}

export interface PaymentMethodSnapshot {
  paymentMethodId: string;
  methodName: string;
  bankName: string | null;
  routingNumber: string | null;
  accountNumber: string | null;
  accountType: string | null;
  bankLast4: string | null;
}

/**
 * Decrypts a stored bank-field value, tolerating rows that predate this
 * column being encrypted (found live: a real payment method migrated from
 * the legacy sheet had a plain "98765430" in routing_number, which crashed
 * every route touching that client's default payment method — decryptValue
 * throws on anything that isn't the "v1:...:..." envelope format). Only the
 * specific case of "this was never encrypted" falls back to the raw value;
 * a value that HAS the v1 envelope shape but fails to actually decrypt
 * (wrong key, tampered data) still throws — that's a real integrity error,
 * not a legacy-data shape issue, and silently returning garbage there would
 * be worse than crashing.
 */
export function decryptTolerant(value: string): string {
  const parts = value.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") return value;
  return decryptValue(value);
}

function toSnapshot(row: any): PaymentMethodSnapshot {
  return {
    paymentMethodId: row.payment_method_id,
    methodName: row.method_name,
    bankName: row.bank_name || null,
    routingNumber: row.routing_number ? decryptTolerant(row.routing_number) : null,
    accountNumber: row.account_number ? decryptTolerant(row.account_number) : null,
    accountType: row.account_type || null,
    bankLast4: row.bank_last4 || null,
  };
}

/**
 * Resolves the payment method snapshot to store on a paycheck/payment row:
 * the caller's explicit paymentMethodId if given and valid for this client,
 * otherwise the client's default for this usage (v3_payment_methods
 * default_for_payroll / default_for_invoices, set by paymentMethods.routes.ts).
 * Decrypts the stored account/routing numbers so the result can be written
 * as a plaintext snapshot, matching how a manually-entered value is already
 * stored on those tables.
 */
export async function resolvePaymentMethod(
  clientId: string,
  usage: "payroll" | "invoices",
  explicitPaymentMethodId?: string | null
): Promise<PaymentMethodSnapshot | null> {
  if (explicitPaymentMethodId) {
    const row = await queryOne<any>(
      `SELECT * FROM altax.v3_payment_methods WHERE payment_method_id = $1 AND client_id = $2`,
      [explicitPaymentMethodId, clientId]
    );
    if (row) return toSnapshot(row);
  }
  const column = usage === "payroll" ? "default_for_payroll" : "default_for_invoices";
  const row = await queryOne<any>(
    `SELECT * FROM altax.v3_payment_methods WHERE client_id = $1 AND ${column} = true AND status <> 'Inactive' LIMIT 1`,
    [clientId]
  );
  return row ? toSnapshot(row) : null;
}

/** Mirrors alTaxV5AppendGl_: posts one GL entry row for a client. */
export async function appendGl(clientId: string, clientName: string, entry: GlEntryInput): Promise<string> {
  const glEntryId = `GL-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_gl_entries
       (gl_entry_id, client_id, client_name, entry_date, ref, description, account, debit, credit,
        source, notes, source_system, source_record_id)
     VALUES ($1,$2,$3,COALESCE($4,now()),$5,$6,$7,$8,$9,$10,$11,'Node Web App',$5)`,
    [glEntryId, clientId, clientName, entry.entryDate || null, entry.ref, entry.description, entry.account,
      entry.debit, entry.credit, entry.source, entry.notes || null]
  );
  return glEntryId;
}

export interface PayrollGlInput {
  gross: number;
  nonTaxableReimbursement: number;
  netPay: number;
  totalDeductions: number;
  employerTaxes: number;
  employeeTaxes: number;
}

/**
 * Mirrors alTaxV5RepostPayrollGl_ (Code.gs:12253): a balanced 4-5 line payroll
 * entry that uses the Payroll Tax Payable / Payroll Deduction Payable liability
 * accounts, since payroll taxes and third-party deductions aren't paid out in
 * cash the same day as the paycheck — they accrue as a liability until remitted.
 * Debits: Payroll Expense (gross + reimbursement) + Payroll Tax Expense (employer taxes).
 * Credits: Cash (net pay only) + Payroll Deduction Payable (if any) + Payroll Tax Payable
 * (employee withholding + employer accrual). Debits always equal credits.
 */
export async function postPayrollGl(
  clientId: string, clientName: string, paycheckId: string, payDate: string | null, calc: PayrollGlInput
): Promise<void> {
  await appendGl(clientId, clientName, {
    entryDate: payDate, ref: paycheckId, description: "Payroll wages", account: "Payroll Expense",
    debit: money(calc.gross + calc.nonTaxableReimbursement), credit: 0, source: "Payroll",
  });
  await appendGl(clientId, clientName, {
    entryDate: payDate, ref: paycheckId, description: "Net pay liability/cash", account: "Cash",
    debit: 0, credit: calc.netPay, source: "Payroll",
  });
  if (calc.totalDeductions) {
    await appendGl(clientId, clientName, {
      entryDate: payDate, ref: paycheckId, description: "Employee payroll deductions payable", account: "Payroll Deduction Payable",
      debit: 0, credit: calc.totalDeductions, source: "Payroll",
    });
  }
  await appendGl(clientId, clientName, {
    entryDate: payDate, ref: paycheckId, description: "Employer payroll taxes", account: "Payroll Tax Expense",
    debit: calc.employerTaxes, credit: 0, source: "Payroll",
  });
  await appendGl(clientId, clientName, {
    entryDate: payDate, ref: paycheckId, description: "Payroll tax payable", account: "Payroll Tax Payable",
    debit: 0, credit: money(calc.employeeTaxes + calc.employerTaxes), source: "Payroll",
  });
}
