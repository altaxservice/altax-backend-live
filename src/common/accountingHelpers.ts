import { query, queryOne, type DbClient } from "../config/db";
import { normalizeText } from "./assignment";
import { decryptTolerant } from "./encryption";

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
  excludePaycheckId?: string,
  // Social Security's wage base applies to social_security_wages, not
  // federal_taxable_wages — the two differ whenever there's a pre-tax
  // retirement deduction (which reduces federal taxable wages but not SS
  // wages). FUTA/SUTA correctly use the default here since their base really
  // is federal/state taxable wages.
  wageColumn: "federal_taxable_wages" | "social_security_wages" = "federal_taxable_wages"
): Promise<number> {
  if (wageCap === null || !payDate) return wagesThisCheck;
  // getUTCFullYear(), not getFullYear() — `new Date("YYYY-MM-DD")` parses as
  // UTC midnight, so reading it back with a local-timezone getter can shift a
  // Dec 31/Jan 1 pay date into the wrong year in any timezone behind UTC.
  // Currently masked (no TZ is set anywhere in this deployment), but matches
  // the same fix already applied in mdFiling.ts (ACC-016, hard audit 2026-08-13).
  const year = new Date(payDate).getUTCFullYear();
  if (!Number.isFinite(year)) return wagesThisCheck;

  const row = await queryOne<any>(
    `SELECT COALESCE(SUM(${wageColumn}), 0) AS ytd
     FROM altax.v3_paychecks
     WHERE client_id = $1 AND employee = $2 AND EXTRACT(YEAR FROM pay_date) = $3
       AND lower(status) <> 'void'` + (excludePaycheckId ? ` AND paycheck_id <> $4` : ``),
    excludePaycheckId ? [clientId, employeeName, year, excludePaycheckId] : [clientId, employeeName, year]
  );
  const ytdBefore = Number(row?.ytd || 0);
  const remaining = Math.max(0, wageCap - ytdBefore);
  return Math.min(wagesThisCheck, remaining);
}

/**
 * The mirror image of capWagesToAnnualLimit: instead of capping a wage-
 * limited tax at a CEILING, this returns how much of this paycheck's wages
 * fall ABOVE a threshold — for Additional Medicare Tax, the extra 0.9% that
 * applies only once an employee's YTD Medicare wages cross $200,000 (IRC
 * §3101(b)(2), employer-withholding-only rule: a flat $200k trigger
 * regardless of filing status, unlike the employee's own eventual Form 8959
 * reconciliation). Hard Audit finding, 2026-08-27: this tier didn't exist
 * anywhere in the real payroll engine at all — every paycheck withheld
 * Medicare at a flat 1.45% no matter how high wages went.
 *
 * Only the portion of THIS check's wages that pushes cumulative YTD wages
 * past the threshold is returned — the overlap between [ytdBefore, ytdAfter]
 * and [threshold, infinity).
 */
export async function wagesAboveAnnualThreshold(
  clientId: string,
  employeeName: string,
  payDate: string | null,
  wagesThisCheck: number,
  threshold: number,
  excludePaycheckId?: string,
  wageColumn: "federal_taxable_wages" | "social_security_wages" | "medicare_wages" = "medicare_wages"
): Promise<number> {
  if (!payDate) return 0;
  const year = new Date(payDate).getUTCFullYear();
  if (!Number.isFinite(year)) return 0;

  const row = await queryOne<any>(
    `SELECT COALESCE(SUM(${wageColumn}), 0) AS ytd
     FROM altax.v3_paychecks
     WHERE client_id = $1 AND employee = $2 AND EXTRACT(YEAR FROM pay_date) = $3
       AND lower(status) <> 'void'` + (excludePaycheckId ? ` AND paycheck_id <> $4` : ``),
    excludePaycheckId ? [clientId, employeeName, year, excludePaycheckId] : [clientId, employeeName, year]
  );
  const ytdBefore = Number(row?.ytd || 0);
  const ytdAfter = ytdBefore + wagesThisCheck;
  return Math.max(0, ytdAfter - Math.max(threshold, ytdBefore));
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

// decryptTolerant moved to ./encryption (it's a generic envelope-shape check, not
// specific to payment fields) — re-exported here since accounting.routes.ts and
// paymentMethods.routes.ts already import it from this module.
export { decryptTolerant } from "./encryption";

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

/**
 * Mirrors alTaxV5AppendGl_: posts one GL entry row for a client. Pass `db` (from
 * withTransaction) when this call is one of several related writes that must all
 * succeed or all roll back together — e.g. every line of a multi-line payroll entry
 * (see postPayrollGl). Defaults to the plain pool for single-line, standalone posts.
 */
export async function appendGl(clientId: string, clientName: string, entry: GlEntryInput, db: DbClient = { query, queryOne }): Promise<string> {
  const glEntryId = `GL-${idSuffix()}`;
  await db.query(
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
 *
 * Two safeguards added after a batch of imported legacy paychecks turned up
 * permanently out of balance (missing their Payroll Tax Expense debit line —
 * see the Trial Balance "how to fix" investigation): (1) the invariant is
 * checked BEFORE any row is written, so a bad `calc` throws instead of posting
 * partial/unbalanced lines; (2) pass `db` (from withTransaction) so the 4-5
 * INSERTs commit or roll back together — a mid-sequence failure can no longer
 * leave a half-posted entry the way independent pool.query() calls could.
 */
export async function postPayrollGl(
  clientId: string, clientName: string, paycheckId: string, payDate: string | null, calc: PayrollGlInput, db: DbClient = { query, queryOne }
): Promise<void> {
  const totalDebits = money(calc.gross + calc.nonTaxableReimbursement + calc.employerTaxes);
  const totalCredits = money(calc.netPay + calc.totalDeductions + calc.employeeTaxes + calc.employerTaxes);
  if (Math.abs(totalDebits - totalCredits) > 0.005) {
    throw new Error(
      `Refusing to post an unbalanced payroll GL entry for ${paycheckId}: debits ${totalDebits} vs credits ${totalCredits}. ` +
      `This means the paycheck's own numbers don't add up (net pay + deductions + taxes should equal gross + reimbursement + employer taxes) — fix the paycheck's figures rather than the posting.`
    );
  }

  await appendGl(clientId, clientName, {
    entryDate: payDate, ref: paycheckId, description: "Payroll wages", account: "Payroll Expense",
    debit: money(calc.gross + calc.nonTaxableReimbursement), credit: 0, source: "Payroll",
  }, db);
  await appendGl(clientId, clientName, {
    entryDate: payDate, ref: paycheckId, description: "Net pay liability/cash", account: "Cash",
    debit: 0, credit: calc.netPay, source: "Payroll",
  }, db);
  if (calc.totalDeductions) {
    await appendGl(clientId, clientName, {
      entryDate: payDate, ref: paycheckId, description: "Employee payroll deductions payable", account: "Payroll Deduction Payable",
      debit: 0, credit: calc.totalDeductions, source: "Payroll",
    }, db);
  }
  await appendGl(clientId, clientName, {
    entryDate: payDate, ref: paycheckId, description: "Employer payroll taxes", account: "Payroll Tax Expense",
    debit: calc.employerTaxes, credit: 0, source: "Payroll",
  }, db);
  await appendGl(clientId, clientName, {
    entryDate: payDate, ref: paycheckId, description: "Payroll tax payable", account: "Payroll Tax Payable",
    debit: 0, credit: money(calc.employeeTaxes + calc.employerTaxes), source: "Payroll",
  }, db);
}

/**
 * Posts Dr Accounts Receivable / Cr Sales Revenue for the (possibly negative) change
 * in an invoice's total — pass `delta = total` on create (0 → total), or
 * `newTotal - oldTotal` on a re-total edit, or `-balanceDue` to write off whatever's
 * still outstanding when an invoice is voided (the already-paid portion, if any, was
 * already posted correctly by postInvoicePaymentGl and is left untouched — void only
 * reverses the unpaid remainder, not cash actually received). A negative delta posts
 * the reverse direction (Dr Revenue / Cr AR). No-op for delta === 0, so a plain
 * metadata edit that doesn't change the total posts nothing.
 *
 * Billing previously had zero GL postings at all — invoices, payments, and voids
 * never touched v3_gl_entries, so the Trial Balance/P&L were structurally blind to
 * billed revenue and receivables. This and postInvoicePaymentGl below close that gap.
 */
export async function postInvoiceTotalGl(
  clientId: string, clientName: string, invoiceId: string, invoiceDate: string | Date | null, delta: number, db: DbClient = { query, queryOne }
): Promise<void> {
  const amount = money(delta);
  if (amount === 0) return;
  const description = amount > 0 ? "Invoice issued" : "Invoice total reduced";
  const abs = Math.abs(amount);
  await appendGl(clientId, clientName, {
    entryDate: invoiceDate, ref: invoiceId, description, account: "Accounts Receivable",
    debit: amount > 0 ? abs : 0, credit: amount > 0 ? 0 : abs, source: "Billing",
  }, db);
  await appendGl(clientId, clientName, {
    entryDate: invoiceDate, ref: invoiceId, description, account: "Sales Revenue",
    debit: amount > 0 ? 0 : abs, credit: amount > 0 ? abs : 0, source: "Billing",
  }, db);
}

/**
 * Posts Dr Cash / Cr Accounts Receivable for a payment recorded against an invoice
 * (or the reverse direction, when `reversed` is true, for a payment reversal). See
 * postInvoiceTotalGl above for why this exists.
 */
export async function postInvoicePaymentGl(
  clientId: string, clientName: string, ref: string, paymentDate: string | Date | null, amount: number, reversed: boolean, db: DbClient = { query, queryOne }
): Promise<void> {
  const amt = money(Math.abs(amount));
  if (amt === 0) return;
  const description = reversed ? "Invoice payment reversed" : "Invoice payment received";
  await appendGl(clientId, clientName, {
    entryDate: paymentDate, ref, description, account: "Cash",
    debit: reversed ? 0 : amt, credit: reversed ? amt : 0, source: "Billing",
  }, db);
  await appendGl(clientId, clientName, {
    entryDate: paymentDate, ref, description, account: "Accounts Receivable",
    debit: reversed ? amt : 0, credit: reversed ? 0 : amt, source: "Billing",
  }, db);
}
