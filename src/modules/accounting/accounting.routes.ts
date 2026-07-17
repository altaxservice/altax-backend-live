import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient, normalizeText } from "../../common/assignment";
import { lookupRate, lookupWageCap, capWagesToAnnualLimit, money, rateValue, appendGl, resolvePaymentMethod, postPayrollGl, decryptTolerant } from "../../common/accountingHelpers";
import { encryptValue } from "../../common/encryption";
import { provisionEmployeePortalUser } from "../../common/portalUserProvisioning";
import { composeAddress } from "../../common/address";
import { monthEndRouter } from "./monthEndChecklist";

/**
 * Accounting module — Phase 7. Tax Rates and Chart of Accounts are pure reference
 * data (ported from alTaxPortalSaveTaxRate / alTaxPortalSaveCOAAccount, no money
 * computed). Sales Input, Payroll Input/Paychecks, Contractor Payments, and Manual JE
 * DO compute/post money — ported faithfully from alTaxPortalSaveSalesInput,
 * alTaxPortalSavePayrollInput, alTaxPortalSaveContractorPayment, and
 * alTaxPortalSaveManualJE after reviewing each formula directly:
 *
 * - Sales Input: TotalTaxDue is `amount * rate`, rate from lookupRate() (the same
 *   configurable v3_tax_rates lookup used everywhere) — simple multiplication, not
 *   bracket logic. Verified the exact rate IDs (ST6, ST12, VAPE20, RATE60) already
 *   exist with real values in production.
 * - Payroll: alTaxV5CalculatePaycheck_ is a FLAT-RATE estimate (wages * configurable
 *   rate), not IRS bracket withholding — and every computed figure (gross, federal,
 *   state) can be overridden by a caller-supplied value, exactly like legacy. Staff
 *   entering real numbers from their actual payroll processor is the expected path;
 *   the formula is a fallback default, not an authoritative tax calculation.
 * - Contractor Payments: no calculation at all — a dollar amount plus two GL lines.
 * - Manual JE: pure double-entry validation (debits must equal credits), no money is
 *   computed, only checked for balance.
 *
 * This is a faithful 1:1 transcription of already-in-production formulas, not new
 * calculation logic being invented — the plan's "no test fixtures" caution is about
 * not guessing at correctness for logic no one has verified; these formulas are
 * exactly what your business has been running on already. I have NOT independently
 * re-derived or verified the tax math itself (e.g. whether 0.025116 is the right
 * federal rate) — that's a business/compliance question, not a transcription one.
 *
 * alTaxPortalMarkPaycheckPrinted is folded into GET /paychecks/:id/print itself — the
 * print action marks the check Printed rather than needing a separate manual toggle.
 * Still not ported: alTaxPortalDeleteAccountingRecord (generic hard-delete-by-table
 * name endpoint — risky in kind and in shape, skipped like every other ungated hard
 * delete this session).
 */
export const accountingRouter = Router();
accountingRouter.use("/month-end", monthEndRouter);

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
}

const PAYCHECK_LOCKED_STATUSES = ["printed", "finalized", "void", "reversed", "deleted", "paid", "issued", "processed"];

/**
 * Mirrors alTaxV5PaycheckLockedForEdit_ (Code.gs:12214): a paycheck is locked
 * once it's been printed or moved past "created" — the previous port only
 * blocked "void", missing every other terminal status legacy also locks
 * (Printed/Paid/Issued/etc.), plus the printed_at-set check entirely.
 */
function isPaycheckLockedForEdit(check: any): boolean {
  const status = String(check?.status || "").trim().toLowerCase();
  return Boolean(String(check?.printed_at || "").trim()) || PAYCHECK_LOCKED_STATUSES.includes(status);
}

/**
 * Short, sequential per-client fallback check number (1001, 1002, ...) used
 * when a caller doesn't supply one. Previously fell back to the full
 * generated paycheckId (e.g. "CHK-20260625224721-870") — harmless as a
 * database key, but a real check number that long makes the printed MICR
 * line absurdly wide once it's embedded there (caught by printing an actual
 * paycheck onto real check stock and comparing against a real bank check).
 */
async function nextCheckNumber(clientId: string): Promise<string> {
  const row = await queryOne<any>(
    `SELECT COUNT(*)::int AS count FROM altax.v3_paychecks WHERE client_id = $1`,
    [clientId]
  );
  return String(1001 + (row?.count || 0));
}

/**
 * Create or update a tax rate — ported from alTaxPortalSaveTaxRate. Admin-only in
 * legacy (alTaxV5RequirePortalUser_(email, true)). Upserts by rateId when given, else
 * derives one from RateType (uppercased/underscored), else falls back to a generated
 * id; matches an existing row of the same scope+client when no explicit id is given.
 */
accountingRouter.post("/tax-rates", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const rateType = String(body.rateType || "").trim();
  if (!rateType) return res.status(400).json({ error: "Rate type is required." });

  const rawScope = normalizeText(body.scope);
  const isGlobalScope = rawScope.includes("global") || rawScope.includes("all client");
  const scope = !isGlobalScope && rawScope.includes("client") ? "Client" : "Global";
  const clientId = scope === "Client" ? String(body.clientId || "").trim() : "";
  if (scope === "Client" && !clientId) {
    return res.status(400).json({ error: "Choose the client for this client-specific tax rate." });
  }

  let clientName = "";
  if (clientId) {
    const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
    clientName = client ? String(client.client_name || "") : String(body.clientName || "").trim();
  }

  let rateId = String(body.rateId || "").trim();
  if (!rateId) {
    const derived = rateType.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    rateId = derived || `RATE-${idSuffix()}`;
  }
  const targetState = String(body.state || "").trim();

  // Match on the SAME tuple the DB's uq_v3_tax_rates_rate_scope_client_state unique
  // index enforces (rate_id, scope, client_id, state) — matching on rate_id alone
  // (the pre-Stage-0 behavior) would find a Global row for a DIFFERENT state and
  // silently overwrite it instead of creating a new state-scoped row.
  const existing = await queryOne<any>(
    `SELECT * FROM altax.v3_tax_rates
      WHERE rate_id = $1 AND COALESCE(state, '') = $4
        AND (($2 = 'Client' AND client_id = $3) OR ($2 = 'Global' AND (client_id IS NULL OR client_id = '')))`,
    [rateId, scope, clientId, targetState]
  );

  const fields = {
    scope, client_id: clientId || null, client_name: clientName || null, rate_type: rateType,
    rate: rateValue(body.rate), employee_employer: String(body.employeeEmployer || "").trim() || null,
    wage_cap: String(body.wageCap || "").trim() || null, state: targetState || null,
    active: body.active === undefined ? true : Boolean(body.active), notes: String(body.notes || "").trim() || null,
  };

  if (existing) {
    // Keyed off the surrogate tax_rate_row_id, not rate_id — rate_id is no longer
    // unique (multiple state/client rows can share it by design), so an UPDATE
    // keyed only by rate_id would silently overwrite every row sharing that code.
    await query(
      `UPDATE altax.v3_tax_rates SET scope=$2, client_id=$3, client_name=$4, rate_type=$5, rate=$6,
         employee_employer=$7, wage_cap=$8, state=$9, active=$10, notes=$11, updated_at = now()
       WHERE tax_rate_row_id = $1`,
      [existing.tax_rate_row_id, ...Object.values(fields)]
    );
    await logAudit("Accounting", "EDIT_TAX_RATE", rateId, "Rate", String(existing.rate ?? ""), String(fields.rate),
      `Tax rate edited by ${req.user!.email}.`, req.user!.email);
  } else {
    await query(
      `INSERT INTO altax.v3_tax_rates (rate_id, scope, client_id, client_name, rate_type, rate, employee_employer, wage_cap, state, active, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [rateId, ...Object.values(fields)]
    );
    await logAudit("Accounting", "CREATE_TAX_RATE", rateId, "", "", String(fields.rate),
      `Tax rate created by ${req.user!.email}.`, req.user!.email);
  }

  res.json({ ok: true, rateId });
}));

/** List tax rates — admin/staff read (reference/config data, not per-client sensitive). */
accountingRouter.get("/tax-rates", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query(`SELECT * FROM altax.v3_tax_rates ORDER BY rate_type ASC`);
  res.json({ taxRates: rows });
}));

/**
 * Deactivate a tax rate — substitute for alTaxPortalDeleteTaxRate, which is a hard row
 * delete with no confirm gate. Sets active=false instead, same reasoning as every
 * other hard-delete skipped this session; v3_tax_rates already has an active column
 * to support this.
 */
// Keyed off tax_rate_row_id (the surrogate PK), not rate_id — rate_id is no longer
// unique (multiple state/client-scoped rows can share it by design since the Stage 0
// PK migration), so scoping by rate_id alone would flip every row sharing that code
// (e.g. deactivating PA's STATE rate would also deactivate MD's, DC's, VA's).
accountingRouter.post("/tax-rates/:rowId/deactivate", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { rowId } = req.params;
  const old = await queryOne<any>(`SELECT rate_id, active FROM altax.v3_tax_rates WHERE tax_rate_row_id = $1`, [rowId]);
  if (!old) return res.status(404).json({ error: "Tax rate not found." });

  await query(`UPDATE altax.v3_tax_rates SET active = false, updated_at = now() WHERE tax_rate_row_id = $1`, [rowId]);
  await logAudit("Accounting", "DEACTIVATE_TAX_RATE", old.rate_id, "Active", String(old.active), "false",
    `Tax rate deactivated by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, rateId: old.rate_id });
}));

/** Reactivate a previously deactivated tax rate — the missing counterpart to /deactivate. */
accountingRouter.post("/tax-rates/:rowId/activate", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { rowId } = req.params;
  const old = await queryOne<any>(`SELECT rate_id, active FROM altax.v3_tax_rates WHERE tax_rate_row_id = $1`, [rowId]);
  if (!old) return res.status(404).json({ error: "Tax rate not found." });

  await query(`UPDATE altax.v3_tax_rates SET active = true, updated_at = now() WHERE tax_rate_row_id = $1`, [rowId]);
  await logAudit("Accounting", "ACTIVATE_TAX_RATE", old.rate_id, "Active", String(old.active), "true",
    `Tax rate activated by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, rateId: old.rate_id });
}));

/**
 * Create or update a chart-of-accounts entry — ported from alTaxPortalSaveCOAAccount.
 * Admin-only. Upserts by accountId when given, else generates one.
 */
accountingRouter.post("/coa", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const accountName = String(body.accountName || "").trim();
  if (!accountName) return res.status(400).json({ error: "Account name is required." });

  const accountId = String(body.accountId || "").trim() || `ACCT-${idSuffix()}`;
  const existing = await queryOne<any>(`SELECT account_id FROM altax.v3_coa WHERE account_id = $1`, [accountId]);

  const fields = {
    account_name: accountName, account_type: String(body.accountType || "Expense").trim(),
    detail_type: String(body.detailType || "").trim() || null,
    normal_balance: String(body.normalBalance || "Debit").trim(),
    active: body.active === undefined ? true : Boolean(body.active),
    notes: String(body.notes || "").trim() || null,
    description: String(body.description || body.notes || "").trim() || null,
    opening_balance: money(body.openingBalance), current_balance: money(body.currentBalance),
    sub_account_of: String(body.subAccountOf || "").trim() || null, tax_line: String(body.taxLine || "").trim() || null,
  };

  if (existing) {
    await query(
      `UPDATE altax.v3_coa SET account_name=$2, account_type=$3, detail_type=$4, normal_balance=$5, active=$6,
         notes=$7, description=$8, opening_balance=$9, current_balance=$10, sub_account_of=$11, tax_line=$12,
         updated_at = now()
       WHERE account_id = $1`,
      [accountId, ...Object.values(fields)]
    );
    await logAudit("Accounting", "EDIT_COA", accountId, "", "", accountName, `COA account edited by ${req.user!.email}.`, req.user!.email);
  } else {
    await query(
      `INSERT INTO altax.v3_coa
         (account_id, account_name, account_type, detail_type, normal_balance, active, notes, description,
          opening_balance, current_balance, sub_account_of, tax_line, source_system, source_record_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Node Web App',$1)`,
      [accountId, ...Object.values(fields)]
    );
    await logAudit("Accounting", "CREATE_COA", accountId, "", "", accountName, `COA account created by ${req.user!.email}.`, req.user!.email);
  }

  res.json({ ok: true, accountId });
}));

/**
 * Deactivate/reactivate a chart-of-accounts entry — COA previously had no delete or
 * deactivate route at all (weaker than Tax Rates, which at least had /deactivate).
 * Soft-toggle only, matching the same convention used everywhere else in this module.
 */
accountingRouter.post("/coa/:accountId/deactivate", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { accountId } = req.params;
  const old = await queryOne<any>(`SELECT account_id, active FROM altax.v3_coa WHERE account_id = $1`, [accountId]);
  if (!old) return res.status(404).json({ error: "Account not found." });

  await query(`UPDATE altax.v3_coa SET active = false, updated_at = now() WHERE account_id = $1`, [accountId]);
  await logAudit("Accounting", "DEACTIVATE_COA", accountId, "Active", String(old.active), "false",
    `COA account deactivated by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, accountId });
}));

accountingRouter.post("/coa/:accountId/activate", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { accountId } = req.params;
  const old = await queryOne<any>(`SELECT account_id, active FROM altax.v3_coa WHERE account_id = $1`, [accountId]);
  if (!old) return res.status(404).json({ error: "Account not found." });

  await query(`UPDATE altax.v3_coa SET active = true, updated_at = now() WHERE account_id = $1`, [accountId]);
  await logAudit("Accounting", "ACTIVATE_COA", accountId, "Active", String(old.active), "true",
    `COA account activated by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, accountId });
}));

/** List chart-of-accounts entries — admin/staff read. */
accountingRouter.get("/coa", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query(`SELECT * FROM altax.v3_coa ORDER BY account_name ASC`);
  res.json({ accounts: rows });
}));

/**
 * Record a sale — ported from alTaxPortalSaveSalesInput. Computes TotalTaxDue from
 * configurable rates and auto-posts three GL lines (Cash debit, Sales Revenue
 * credit, Sales Tax Payable credit), exactly matching legacy.
 */
/**
 * List active sales-tax categories, optionally filtered to a state. Advisory
 * filtering only — the Sales tab uses this to suggest/pre-select relevant
 * categories for a client's state, never to restrict what a preparer can enter
 * (see v3_sales_tax_categories's schema comment and v3_clients.industry_category's).
 */
accountingRouter.get("/sales-categories", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const state = String(req.query.state || "").trim();
  const rows = state
    ? await query(`SELECT * FROM altax.v3_sales_tax_categories WHERE active = true AND (state = $1 OR state IS NULL) ORDER BY display_order, category_name`, [state])
    : await query(`SELECT * FROM altax.v3_sales_tax_categories WHERE active = true ORDER BY display_order, category_name`);
  res.json({ categories: rows });
}));

interface SalesCategoryLineInput { categoryId: string; taxableAmount: number | string }

/**
 * Resolves each category-line's rate via the category's own default_rate_id, reusing
 * lookupRate's existing state-aware precedence (client override > state match >
 * universal/global > 0 if truly nothing is configured for this category yet — 0, not a
 * guessed percentage, since fabricating a tax rate would be actively harmful). Shared
 * by POST /sales, POST /sales/preview, and PATCH /sales/:saleId so the three can never
 * compute different numbers for the same inputs.
 */
async function computeCategoryLinesTax(rawLines: SalesCategoryLineInput[], clientId: string, clientState?: string | null) {
  const categoryIds = rawLines.map((l) => String(l.categoryId || "").trim()).filter(Boolean);
  const categories = categoryIds.length
    ? await query<any>(`SELECT * FROM altax.v3_sales_tax_categories WHERE category_id = ANY($1::text[])`, [categoryIds])
    : [];
  const categoryMap = new Map(categories.map((c: any) => [c.category_id, c]));

  const lines: { categoryId: string; categoryName: string; taxableAmount: number; rate: number; taxAmount: number }[] = [];
  let totalTax = 0;
  for (const raw of rawLines) {
    const categoryId = String(raw.categoryId || "").trim();
    const taxableAmount = money(raw.taxableAmount);
    if (!categoryId || taxableAmount === 0) continue;
    const category = categoryMap.get(categoryId);
    if (!category) throw new Error(`Unknown sales tax category: ${categoryId}`);
    const rate = category.default_rate_id
      ? await lookupRate(category.default_rate_id, 0, clientId, clientState || undefined)
      : 0;
    const taxAmount = money(taxableAmount * rate);
    lines.push({ categoryId, categoryName: category.category_name, taxableAmount, rate, taxAmount });
    totalTax += taxAmount;
  }
  return { lines, totalTax: money(totalTax) };
}

accountingRouter.post("/sales", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const clientId = String(body.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "Client is required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT client_id, client_name, state FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const rawLines: SalesCategoryLineInput[] = Array.isArray(body.categoryLines) ? body.categoryLines : [];
  const adjustments = money(body.adjustments);
  let computed: Awaited<ReturnType<typeof computeCategoryLinesTax>>;
  try {
    computed = await computeCategoryLinesTax(rawLines, clientId, client.state);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid category lines." });
  }
  const totalTax = money(computed.totalTax + adjustments);

  const saleId = `SALE-${idSuffix()}`;
  const grossSales = money(body.grossSales);
  await query(
    `INSERT INTO altax.v3_sales_input
       (sale_id, client_id, client_name, sale_date, gross_sales, adjustments, payment_date, total_tax_due, notes,
        source_system, source_record_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Node Web App',$1)`,
    [saleId, client.client_id, client.client_name, String(body.saleDate || "").trim() || null, grossSales,
      adjustments, String(body.paymentDate || "").trim() || null, totalTax, String(body.notes || "").trim() || null]
  );
  for (const line of computed.lines) {
    await query(
      `INSERT INTO altax.v3_sales_input_lines (line_id, sale_id, category_id, taxable_amount, tax_rate_used, tax_amount)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [`SLINE-${idSuffix()}`, saleId, line.categoryId, line.taxableAmount, line.rate, line.taxAmount]
    );
  }

  await appendGl(client.client_id, client.client_name, {
    entryDate: body.saleDate, ref: saleId, description: "Sales receipt / tax collected",
    account: "Cash", debit: money(grossSales + totalTax), credit: 0, source: "Sales Input",
  });
  await appendGl(client.client_id, client.client_name, {
    entryDate: body.saleDate, ref: saleId, description: "Sales revenue",
    account: "Sales Revenue", debit: 0, credit: grossSales, source: "Sales Input",
  });
  await appendGl(client.client_id, client.client_name, {
    entryDate: body.saleDate, ref: saleId, description: "Sales tax payable",
    account: "Sales Tax Payable", debit: 0, credit: totalTax, source: "Sales Input",
  });

  await logAudit("Accounting", "CREATE_SALES_INPUT", saleId, "", "", String(totalTax),
    `Sales input created by ${req.user!.email}.`, req.user!.email);

  res.status(201).json({ ok: true, saleId, totalTaxDue: totalTax, lines: computed.lines });
}));

/**
 * Preview the tax total for not-yet-saved sales input — same formula/rate lookups as
 * POST /sales, but read-only (no insert, no GL posting). Powers the live "Estimated
 * Tax" calculation strip on the Sales tab so the rate math shown to the user can never
 * drift from what actually gets saved.
 */
accountingRouter.post("/sales/preview", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const clientId = String(body.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "Client is required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT state FROM altax.v3_clients WHERE client_id = $1`, [clientId]);

  const rawLines: SalesCategoryLineInput[] = Array.isArray(body.categoryLines) ? body.categoryLines : [];
  const adjustments = money(body.adjustments);
  let computed: Awaited<ReturnType<typeof computeCategoryLinesTax>>;
  try {
    computed = await computeCategoryLinesTax(rawLines, clientId, client?.state);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid category lines." });
  }

  res.json({ totalTaxDue: money(computed.totalTax + adjustments), lines: computed.lines });
}));

/** List a client's sales input records (with category line items nested) — admin/staff, client-scoped. */
accountingRouter.get("/sales/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const rows = await query<any>(`SELECT * FROM altax.v3_sales_input WHERE client_id = $1 ORDER BY sale_date DESC NULLS LAST`, [clientId]);
  const saleIds = rows.map((r) => r.sale_id);
  const lineRows = saleIds.length
    ? await query<any>(
        `SELECT l.*, c.category_name FROM altax.v3_sales_input_lines l
         JOIN altax.v3_sales_tax_categories c ON c.category_id = l.category_id
         WHERE l.sale_id = ANY($1::text[]) ORDER BY c.display_order`,
        [saleIds]
      )
    : [];
  const linesBySale = new Map<string, any[]>();
  for (const l of lineRows) {
    if (!linesBySale.has(l.sale_id)) linesBySale.set(l.sale_id, []);
    linesBySale.get(l.sale_id)!.push(l);
  }
  const sales = rows.map((r) => ({ ...r, lines: linesBySale.get(r.sale_id) || [] }));
  res.json({ sales });
}));

/**
 * Edit a sales input record — same rate/formula logic as create. Since the
 * original creation posted 3 GL lines keyed to this sale's ref, an edit
 * deletes those lines and reposts fresh ones with the recalculated amounts
 * rather than leaving stale GL entries from the pre-edit numbers behind. Category
 * lines are fully replaced (delete + reinsert) rather than diffed, same pattern.
 */
accountingRouter.patch("/sales/:saleId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { saleId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_sales_input WHERE sale_id = $1`, [saleId]);
  if (!existing) return res.status(404).json({ error: "Sales record not found." });
  if (!(await canAccessClient(req.user!, existing.client_id))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }

  const body = req.body || {};
  const clientId = existing.client_id;
  const client = await queryOne<any>(`SELECT state FROM altax.v3_clients WHERE client_id = $1`, [clientId]);

  let rawLines: SalesCategoryLineInput[];
  if (Array.isArray(body.categoryLines)) {
    rawLines = body.categoryLines;
  } else {
    const existingLines = await query<any>(`SELECT category_id, taxable_amount FROM altax.v3_sales_input_lines WHERE sale_id = $1`, [saleId]);
    rawLines = existingLines.map((l) => ({ categoryId: l.category_id, taxableAmount: l.taxable_amount }));
  }
  const adjustments = body.adjustments !== undefined ? money(body.adjustments) : Number(existing.adjustments);
  const grossSales = body.grossSales !== undefined ? money(body.grossSales) : Number(existing.gross_sales);
  const saleDate = body.saleDate !== undefined ? (String(body.saleDate).trim() || null) : existing.sale_date;
  const paymentDate = body.paymentDate !== undefined ? (String(body.paymentDate).trim() || null) : existing.payment_date;
  const notes = body.notes !== undefined ? (String(body.notes).trim() || null) : existing.notes;

  let computed: Awaited<ReturnType<typeof computeCategoryLinesTax>>;
  try {
    computed = await computeCategoryLinesTax(rawLines, clientId, client?.state);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid category lines." });
  }
  const totalTax = money(computed.totalTax + adjustments);

  await query(
    `UPDATE altax.v3_sales_input SET sale_date=$2, gross_sales=$3, adjustments=$4, payment_date=$5, total_tax_due=$6, notes=$7
     WHERE sale_id = $1`,
    [saleId, saleDate, grossSales, adjustments, paymentDate, totalTax, notes]
  );
  await query(`DELETE FROM altax.v3_sales_input_lines WHERE sale_id = $1`, [saleId]);
  for (const line of computed.lines) {
    await query(
      `INSERT INTO altax.v3_sales_input_lines (line_id, sale_id, category_id, taxable_amount, tax_rate_used, tax_amount)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [`SLINE-${idSuffix()}`, saleId, line.categoryId, line.taxableAmount, line.rate, line.taxAmount]
    );
  }

  await query(`DELETE FROM altax.v3_gl_entries WHERE ref = $1 AND source = 'Sales Input'`, [saleId]);
  await appendGl(existing.client_id, existing.client_name, {
    entryDate: saleDate, ref: saleId, description: "Sales receipt / tax collected",
    account: "Cash", debit: money(grossSales + totalTax), credit: 0, source: "Sales Input",
  });
  await appendGl(existing.client_id, existing.client_name, {
    entryDate: saleDate, ref: saleId, description: "Sales revenue",
    account: "Sales Revenue", debit: 0, credit: grossSales, source: "Sales Input",
  });
  await appendGl(existing.client_id, existing.client_name, {
    entryDate: saleDate, ref: saleId, description: "Sales tax payable",
    account: "Sales Tax Payable", debit: 0, credit: totalTax, source: "Sales Input",
  });

  await logAudit("Accounting", "EDIT_SALES_INPUT", saleId, "TotalTaxDue", String(existing.total_tax_due ?? ""), String(totalTax),
    `Sales input edited by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, saleId, totalTaxDue: totalTax, lines: computed.lines });
}));

/**
 * Record payroll for one pay period — ported from alTaxPortalSavePayrollInput.
 * Requires an active, non-contractor employee profile (same guard legacy uses to
 * keep contractors out of the payroll workflow). Computes pay/withholding via the
 * flat-rate formula (see module doc comment), writes both a Payroll Input record and
 * a Paycheck record, and posts GL entries for wages and employer taxes.
 */
/**
 * Flat-rate paycheck calculation — mirrors alTaxV5CalculatePaycheck_ exactly. Shared by
 * POST /payroll (persists) and POST /payroll/preview (read-only, same math for a live
 * on-screen preview) so the two can never drift apart.
 */
async function calculatePaycheck(clientId: string, employeeName: string, employee: any, body: any, clientState?: string | null) {
  // The employee's own work-state takes precedence over the employer client's state
  // for STATE/SUTA — usually the same (most employees work at their employer's
  // location), but the employee's own address is the more accurate source when set.
  const payrollState = employee.state || clientState;
  const regularHours = money(body.regularHours ?? employee.default_hours);
  const regularRate = money(body.regularRate ?? employee.pay_rate);
  let regularPay = regularHours && regularRate ? regularHours * regularRate : 0;
  const overtimeHours = money(body.overtimeHours);
  const overtimeRate = body.overtimeRate === undefined || body.overtimeRate === ""
    ? (regularRate ? regularRate * 1.5 : 0) : money(body.overtimeRate);
  const overtimePay = overtimeHours * overtimeRate;
  const bonusPay = money(body.bonusPay);
  const commissionPay = money(body.commissionPay);
  const otherTaxablePay = money(body.otherTaxablePay);
  const nonTaxableReimbursement = money(body.nonTaxableReimbursement);
  const otherEarnings = overtimePay + bonusPay + commissionPay + otherTaxablePay;
  let gross = regularPay + otherEarnings;
  if (body.grossWages !== undefined && body.grossWages !== "" && money(body.grossWages) > 0) {
    gross = money(body.grossWages);
    regularPay = Math.max(0, gross - otherEarnings);
  }
  if (!gross) {
    gross = money(employee.default_gross_wages);
    regularPay = gross;
  }

  const preTaxRetirement = money(body.preTaxRetirement);
  const preTaxHealth = money(body.preTaxHealth);
  const preTaxHsaFsa = money(body.preTaxHsaFsa);
  const postTaxDeduction = money(body.postTaxDeduction);
  const garnishment = money(body.garnishment);
  const otherDeduction = money(body.otherDeduction);
  const totalPreTaxDeductions = preTaxRetirement + preTaxHealth + preTaxHsaFsa;
  const totalPostTaxDeductions = postTaxDeduction + garnishment + otherDeduction;
  const totalDeductions = totalPreTaxDeductions + totalPostTaxDeductions;
  const federalTaxableWages = Math.max(0, gross - totalPreTaxDeductions);
  const socialSecurityWages = Math.max(0, gross - preTaxHealth - preTaxHsaFsa);
  const medicareWages = socialSecurityWages;
  const stateTaxableWages = federalTaxableWages;

  const payDate = String(body.payDate || "").trim() || null;

  const federal = body.federalWithholding === undefined || body.federalWithholding === ""
    ? money(federalTaxableWages * (await lookupRate("FIT", 0.025116, clientId))) : money(body.federalWithholding);
  const state = body.stateTax === undefined || body.stateTax === ""
    ? money(stateTaxableWages * (await lookupRate("STATE", 0.03, clientId, payrollState || undefined))) : money(body.stateTax);
  const ssEe = money(socialSecurityWages * (await lookupRate("SS_EE", 0.062, clientId)));
  const medEe = money(medicareWages * (await lookupRate("MED_EE", 0.0145, clientId)));
  const ssEr = money(socialSecurityWages * (await lookupRate("SS_ER", 0.062, clientId)));
  const medEr = money(medicareWages * (await lookupRate("MED_ER", 0.0145, clientId)));
  // FUTA only applies to an employee's first $7,000 (or whatever the configured wage_cap is)
  // of wages per calendar year — capWagesToAnnualLimit stops this paycheck from taxing wages
  // past that limit, based on what's already been paid at this client this year. SUTA has the
  // same kind of annual wage-base cap, just state-specific instead of a flat federal number —
  // lookupWageCap/lookupRate now resolve SUTA's rate and cap against payrollState — the
  // employee's own work-state if set, else falling back to the client's state (falling back
  // to defaultCap=null/uncapped, not another state's number, if this state has no row configured
  // yet — see accountingHelpers.ts's isUniversalState doc comment). stateTaxableWages is always
  // kept equal to federalTaxableWages above, so reusing the same YTD lookup is correct here too.
  const futaWageCap = await lookupWageCap("FUTA", 7000, clientId);
  const futaTaxableWages = await capWagesToAnnualLimit(clientId, employeeName, payDate, federalTaxableWages, futaWageCap);
  const futa = money(futaTaxableWages * (await lookupRate("FUTA", 0.006, clientId)));
  const sutaWageCap = await lookupWageCap("SUTA", null, clientId, payrollState || undefined);
  const sutaTaxableWages = await capWagesToAnnualLimit(clientId, employeeName, payDate, stateTaxableWages, sutaWageCap);
  const suta = money(sutaTaxableWages * (await lookupRate("SUTA", 0.025, clientId, payrollState || undefined)));
  const employeeTaxes = money(ssEe + medEe + federal + state);
  const employerTaxes = money(ssEr + medEr + futa + suta);
  const netPay = money(gross + nonTaxableReimbursement - totalDeductions - employeeTaxes);
  const totalCost = money(gross + nonTaxableReimbursement + employerTaxes);

  return {
    regularHours, regularRate, regularPay, overtimeHours, overtimeRate, overtimePay, bonusPay, commissionPay,
    otherTaxablePay, nonTaxableReimbursement, otherEarnings, gross,
    preTaxRetirement, preTaxHealth, preTaxHsaFsa, postTaxDeduction, garnishment, otherDeduction,
    totalPreTaxDeductions, totalPostTaxDeductions, totalDeductions,
    federalTaxableWages, socialSecurityWages, medicareWages, stateTaxableWages, payDate,
    federal, state, ssEe, medEe, ssEr, medEr, futa, suta, employeeTaxes, employerTaxes, netPay, totalCost,
  };
}

accountingRouter.post("/payroll/preview", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const clientId = String(body.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "Client is required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const employeeName = String(body.employee || "").trim();
  if (!employeeName) return res.status(400).json({ error: "Employee name is required." });
  const employee = await queryOne<any>(
    `SELECT * FROM altax.v3_employees WHERE client_id = $1 AND lower(employee_name) = lower($2)`,
    [clientId, employeeName]
  );
  if (!employee) return res.status(400).json({ error: "Payroll requires an active employee profile." });
  const client = await queryOne<any>(`SELECT state FROM altax.v3_clients WHERE client_id = $1`, [clientId]);

  const calc = await calculatePaycheck(clientId, employeeName, employee, body, client?.state);
  res.json(calc);
}));

accountingRouter.post("/payroll", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const clientId = String(body.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "Client is required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT client_id, client_name, state FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const employeeName = String(body.employee || "").trim();
  if (!employeeName) return res.status(400).json({ error: "Employee name is required." });

  const employee = await queryOne<any>(
    `SELECT * FROM altax.v3_employees WHERE client_id = $1 AND lower(employee_name) = lower($2)`,
    [clientId, employeeName]
  );
  if (!employee) return res.status(400).json({ error: "Payroll requires an active employee profile. Use the Contractors/1099 workflow for contractors." });
  const employeeStatus = String(employee.status || "Active").trim().toLowerCase();
  if (["inactive", "archived", "deleted", "no", "false"].includes(employeeStatus)) {
    return res.status(400).json({ error: "This worker is not active for payroll." });
  }
  const workerSignal = [employee.worker_type, employee.form_type, body.payType].join(" ").toLowerCase();
  if (workerSignal.includes("contractor") || workerSignal.includes("1099")) {
    return res.status(400).json({ error: "Contractors cannot be paid through payroll. Use the Contractors/1099 workflow instead." });
  }

  const calc = await calculatePaycheck(clientId, employeeName, employee, body, client.state);
  const {
    regularHours, regularRate, regularPay, gross, payDate,
    overtimeHours, overtimeRate, overtimePay, bonusPay, commissionPay, otherTaxablePay, nonTaxableReimbursement,
    preTaxRetirement, preTaxHealth, preTaxHsaFsa, postTaxDeduction, garnishment, otherDeduction,
    totalPreTaxDeductions, totalPostTaxDeductions, totalDeductions,
    federalTaxableWages, socialSecurityWages, medicareWages, stateTaxableWages,
    federal, state, ssEe, medEe, ssEr, medEr, futa, suta,
    employeeTaxes, employerTaxes, netPay, totalCost,
  } = calc;

  const payrollInputId = `PAYIN-${idSuffix()}`;
  const paycheckId = `CHK-${idSuffix()}`;
  const checkNumber = String(body.checkNumber || "").trim() || await nextCheckNumber(clientId);
  const payType = String(body.payType || employee.pay_type || "").trim() || null;
  const paymentMethod = await resolvePaymentMethod(clientId, "payroll", body.paymentMethodId);
  const common = [
    payDate, employeeName, gross, String(body.payPeriodStart || "").trim() || null,
    String(body.payPeriodEnd || "").trim() || null, checkNumber, regularHours, regularRate, payType,
  ];

  await query(
    `INSERT INTO altax.v3_payroll_input
       (payroll_input_id, client_id, client_name, pay_date, employee, gross_wages, federal_withholding,
        state_tax, notes, source_system, source_record_id, pay_period_start, pay_period_end, check_number,
        hours, rate, pay_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Node Web App',$1,$10,$11,$12,$13,$14,$15)`,
    [payrollInputId, client.client_id, client.client_name, payDate, employeeName, gross, federal, state,
      String(body.notes || "").trim() || null, String(body.payPeriodStart || "").trim() || null,
      String(body.payPeriodEnd || "").trim() || null, checkNumber, regularHours, regularRate, payType]
  );

  await query(
    `INSERT INTO altax.v3_paychecks
       (paycheck_id, client_id, client_name, pay_date, employee, gross_wages, social_security_ee, medicare_ee,
        federal_withholding, state_tax, employee_taxes, net_pay, social_security_er, medicare_er, futa, suta,
        employer_taxes, total_cost, status, source_system, source_record_id, pay_period_start, pay_period_end,
        check_number, hours, rate, pay_type, employee_ssn, employee_address,
        federal_taxable_wages, social_security_wages, medicare_wages, state_taxable_wages,
        payment_method_id, payment_method, payment_bank_name, payment_routing_number, payment_account_number,
        payment_account_type, payment_bank_last4,
        regular_hours, regular_rate, regular_pay, overtime_hours, overtime_rate, overtime_pay,
        bonus_pay, commission_pay, other_taxable_pay, non_taxable_reimbursement,
        pre_tax_retirement, pre_tax_health, pre_tax_hsa_fsa, post_tax_deduction, garnishment, other_deduction,
        total_pre_tax_deductions, total_post_tax_deductions, total_deductions)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'Created','Node Web App',$1,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,
             $38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56)`,
    [paycheckId, client.client_id, client.client_name, payDate, employeeName, gross, ssEe, medEe, federal, state,
      employeeTaxes, netPay, ssEr, medEr, futa, suta, employerTaxes, totalCost,
      String(body.payPeriodStart || "").trim() || null, String(body.payPeriodEnd || "").trim() || null,
      checkNumber, regularHours, regularRate, payType, employee.ssn ? decryptTolerant(employee.ssn) : null, employee.address || null,
      federalTaxableWages, socialSecurityWages, medicareWages, stateTaxableWages,
      paymentMethod?.paymentMethodId || null, paymentMethod?.methodName || null, paymentMethod?.bankName || null,
      paymentMethod?.routingNumber || null, paymentMethod?.accountNumber || null, paymentMethod?.accountType || null,
      paymentMethod?.bankLast4 || null,
      regularHours || null, regularRate || null, regularPay || null, overtimeHours || null, overtimeRate || null, overtimePay || null,
      bonusPay || null, commissionPay || null, otherTaxablePay || null, nonTaxableReimbursement || null,
      preTaxRetirement || null, preTaxHealth || null, preTaxHsaFsa || null, postTaxDeduction || null, garnishment || null, otherDeduction || null,
      totalPreTaxDeductions || null, totalPostTaxDeductions || null, totalDeductions || null]
  );

  await postPayrollGl(client.client_id, client.client_name, paycheckId, payDate, {
    gross, nonTaxableReimbursement, netPay, totalDeductions, employerTaxes, employeeTaxes,
  });

  await logAudit("Accounting", "CREATE_PAYROLL", payrollInputId, "", "", String(gross),
    `Payroll recorded by ${req.user!.email}.`, req.user!.email);

  res.status(201).json({ ok: true, payrollInputId, paycheckId, gross, netPay, employeeTaxes, employerTaxes });
}));

/**
 * The logged-in employee's own paycheck history — powers the Employee Portal's
 * Command Center paystub card, which previously had no data source at all
 * (backend paycheck rows existed but nothing exposed them to the employee who
 * earned them). Registered before /paychecks/:clientId below so "mine" isn't
 * swallowed by that route's :clientId param. Deliberately excludes bank/SSN
 * fields — an employee sees their own gross/taxes/net, not payment account
 * numbers, matching the masked view legacy shows on the employee paystub list.
 */
accountingRouter.get("/paychecks/mine", requireAuth, requireRole("employee"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) return res.json({ paychecks: [] });
  const employee = await queryOne<any>(`SELECT client_id, employee_name FROM altax.v3_employees WHERE employee_id = $1`, [employeeId]);
  if (!employee) return res.json({ paychecks: [] });

  const rows = await query<any>(
    `SELECT paycheck_id, pay_date, employee, client_name, gross_wages, employee_taxes, net_pay, employer_taxes, total_cost,
            pay_period_start, pay_period_end, check_number, status, printed_at
       FROM altax.v3_paychecks
      WHERE client_id = $1 AND lower(employee) = lower($2) AND lower(status) <> 'void'
      ORDER BY pay_date DESC NULLS LAST`,
    [employee.client_id, employee.employee_name]
  );
  res.json({ paychecks: rows });
}));

/** List a client's paychecks — admin/staff, client-scoped. */
accountingRouter.get("/paychecks/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const rows = await query(`SELECT * FROM altax.v3_paychecks WHERE client_id = $1 ORDER BY pay_date DESC NULLS LAST`, [clientId]);
  res.json({ paychecks: rows });
}));

/**
 * Edit a paycheck — re-runs the same flat-rate calculation as /payroll
 * (see module doc comment) against the caller's overrides, updates the
 * paycheck row, and reposts its 3 GL lines. The twin v3_payroll_input row
 * from the original create isn't touched: nothing in this API links the two
 * records (no shared id), and payroll_input has no GET/detail route of its
 * own — it's an internal write-only audit trail, not something this edit
 * needs to keep in sync.
 */
accountingRouter.patch("/paychecks/:paycheckId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { paycheckId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_paychecks WHERE paycheck_id = $1`, [paycheckId]);
  if (!existing) return res.status(404).json({ error: "Paycheck not found." });
  if (!(await canAccessClient(req.user!, existing.client_id))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  if (isPaycheckLockedForEdit(existing)) {
    return res.status(400).json({ error: "Printed or finalized paychecks cannot be edited. Create a corrected paycheck instead." });
  }

  const body = req.body || {};
  const clientId = existing.client_id;
  const clientForState = await queryOne<any>(`SELECT state FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  const clientState = clientForState?.state || undefined;
  const employeeForState = await queryOne<any>(
    `SELECT state FROM altax.v3_employees WHERE client_id = $1 AND lower(employee_name) = lower($2)`,
    [clientId, existing.employee]
  );
  const payrollState = employeeForState?.state || clientState;

  const regularHours = body.regularHours !== undefined ? money(body.regularHours) : Number(existing.regular_hours || existing.hours || 0);
  const regularRate = body.regularRate !== undefined ? money(body.regularRate) : Number(existing.regular_rate || existing.rate || 0);
  let regularPay = regularHours && regularRate ? regularHours * regularRate : 0;
  const overtimeHours = body.overtimeHours !== undefined ? money(body.overtimeHours) : Number(existing.overtime_hours || 0);
  const overtimeRate = body.overtimeRate !== undefined ? money(body.overtimeRate) : Number(existing.overtime_rate || (regularRate ? regularRate * 1.5 : 0));
  const overtimePay = overtimeHours * overtimeRate;
  const bonusPay = body.bonusPay !== undefined ? money(body.bonusPay) : Number(existing.bonus_pay || 0);
  const commissionPay = body.commissionPay !== undefined ? money(body.commissionPay) : Number(existing.commission_pay || 0);
  const otherTaxablePay = body.otherTaxablePay !== undefined ? money(body.otherTaxablePay) : Number(existing.other_taxable_pay || 0);
  const nonTaxableReimbursement = body.nonTaxableReimbursement !== undefined ? money(body.nonTaxableReimbursement) : Number(existing.non_taxable_reimbursement || 0);
  const otherEarnings = overtimePay + bonusPay + commissionPay + otherTaxablePay;
  let gross = regularPay + otherEarnings;
  if (body.grossWages !== undefined && body.grossWages !== "" && money(body.grossWages) > 0) {
    gross = money(body.grossWages);
    regularPay = Math.max(0, gross - otherEarnings);
  } else if (body.grossWages === undefined) {
    gross = Number(existing.gross_wages) || gross;
  }

  const preTaxRetirement = body.preTaxRetirement !== undefined ? money(body.preTaxRetirement) : Number(existing.pre_tax_retirement || 0);
  const preTaxHealth = body.preTaxHealth !== undefined ? money(body.preTaxHealth) : Number(existing.pre_tax_health || 0);
  const preTaxHsaFsa = body.preTaxHsaFsa !== undefined ? money(body.preTaxHsaFsa) : Number(existing.pre_tax_hsa_fsa || 0);
  const postTaxDeduction = body.postTaxDeduction !== undefined ? money(body.postTaxDeduction) : Number(existing.post_tax_deduction || 0);
  const garnishment = body.garnishment !== undefined ? money(body.garnishment) : Number(existing.garnishment || 0);
  const otherDeduction = body.otherDeduction !== undefined ? money(body.otherDeduction) : Number(existing.other_deduction || 0);
  const totalPreTaxDeductions = preTaxRetirement + preTaxHealth + preTaxHsaFsa;
  const totalPostTaxDeductions = postTaxDeduction + garnishment + otherDeduction;
  const totalDeductions = totalPreTaxDeductions + totalPostTaxDeductions;
  const federalTaxableWages = Math.max(0, gross - totalPreTaxDeductions);
  const socialSecurityWages = Math.max(0, gross - preTaxHealth - preTaxHsaFsa);
  const medicareWages = socialSecurityWages;
  const stateTaxableWages = federalTaxableWages;

  const payDate = body.payDate !== undefined ? (String(body.payDate).trim() || null) : existing.pay_date;

  const federal = body.federalWithholding !== undefined && body.federalWithholding !== ""
    ? money(body.federalWithholding) : Number(existing.federal_withholding) || money(federalTaxableWages * (await lookupRate("FIT", 0.025116, clientId)));
  const state = body.stateTax !== undefined && body.stateTax !== ""
    ? money(body.stateTax) : Number(existing.state_tax) || money(stateTaxableWages * (await lookupRate("STATE", 0.03, clientId, payrollState)));
  const ssEe = money(socialSecurityWages * (await lookupRate("SS_EE", 0.062, clientId)));
  const medEe = money(medicareWages * (await lookupRate("MED_EE", 0.0145, clientId)));
  const ssEr = money(socialSecurityWages * (await lookupRate("SS_ER", 0.062, clientId)));
  const medEr = money(medicareWages * (await lookupRate("MED_ER", 0.0145, clientId)));
  // Same $7,000-style annual wage cap as the create route above — excludes this
  // paycheck's own prior (pre-edit) contribution from the YTD lookup, so editing
  // a paycheck doesn't double-count it against its own cap.
  const futaWageCap = await lookupWageCap("FUTA", 7000, clientId);
  const futaTaxableWages = await capWagesToAnnualLimit(clientId, existing.employee, payDate, federalTaxableWages, futaWageCap, paycheckId);
  const futa = money(futaTaxableWages * (await lookupRate("FUTA", 0.006, clientId)));
  const sutaWageCap = await lookupWageCap("SUTA", null, clientId, payrollState);
  const sutaTaxableWages = await capWagesToAnnualLimit(clientId, existing.employee, payDate, stateTaxableWages, sutaWageCap, paycheckId);
  const suta = money(sutaTaxableWages * (await lookupRate("SUTA", 0.025, clientId, payrollState)));
  const employeeTaxes = money(ssEe + medEe + federal + state);
  const employerTaxes = money(ssEr + medEr + futa + suta);
  const netPay = money(gross + nonTaxableReimbursement - totalDeductions - employeeTaxes);
  const totalCost = money(gross + nonTaxableReimbursement + employerTaxes);

  await query(
    `UPDATE altax.v3_paychecks SET pay_date=$2, gross_wages=$3, social_security_ee=$4, medicare_ee=$5,
       federal_withholding=$6, state_tax=$7, employee_taxes=$8, net_pay=$9, social_security_er=$10,
       medicare_er=$11, futa=$12, suta=$13, employer_taxes=$14, total_cost=$15, hours=$16, rate=$17,
       federal_taxable_wages=$18, social_security_wages=$19, medicare_wages=$20, state_taxable_wages=$21
     WHERE paycheck_id = $1`,
    [paycheckId, payDate, gross, ssEe, medEe, federal, state, employeeTaxes, netPay, ssEr, medEr, futa, suta,
      employerTaxes, totalCost, regularHours, regularRate, federalTaxableWages, socialSecurityWages, medicareWages, stateTaxableWages]
  );

  await query(`DELETE FROM altax.v3_gl_entries WHERE ref = $1 AND source = 'Payroll'`, [paycheckId]);
  await postPayrollGl(existing.client_id, existing.client_name, paycheckId, payDate, {
    gross, nonTaxableReimbursement, netPay, totalDeductions, employerTaxes, employeeTaxes,
  });

  await logAudit("Accounting", "EDIT_PAYCHECK", paycheckId, "GrossWages", String(existing.gross_wages ?? ""), String(gross),
    `Paycheck edited by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, paycheckId, gross, netPay, employeeTaxes, employerTaxes });
}));

/**
 * Paycheck stub + check PDF for one paycheck — see paycheckPdf.ts module doc
 * comment for layout notes and the MICR-line caveat. YTD figures sum every
 * paycheck for that employee/client in the same calendar year up to and
 * including this pay date (so printing an earlier paycheck shows YTD as of
 * that date, not the full-year total).
 *
 * Employees may view/download their own paystub this way (powers the "View"
 * action on the Employee Portal's Paystubs list) — canAccessClient() only
 * confirms they belong to the paycheck's client, so an extra check below
 * confirms the paycheck is actually theirs, not a coworker's at the same
 * employer. Viewing doesn't flip the check to "Printed" the way a real
 * staff/admin print does — that status only reflects the physical check run.
 */
accountingRouter.get("/paychecks/:paycheckId/print", requireAuth, requireRole("admin", "staff", "employee"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { paycheckId } = req.params;
  const paycheck = await queryOne<any>(`SELECT * FROM altax.v3_paychecks WHERE paycheck_id = $1`, [paycheckId]);
  if (!paycheck) return res.status(404).json({ error: "Paycheck not found." });
  if (!(await canAccessClient(req.user!, paycheck.client_id))) {
    return res.status(403).json({ error: "You do not have access to this paycheck." });
  }
  if (req.user!.role === "employee") {
    const employee = await queryOne<any>(`SELECT employee_name FROM altax.v3_employees WHERE employee_id = $1`, [req.user!.employeeId]);
    if (!employee || employee.employee_name.toLowerCase() !== String(paycheck.employee || "").toLowerCase()) {
      return res.status(403).json({ error: "You do not have access to this paycheck." });
    }
  }
  const client = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [paycheck.client_id]);

  const ytd = await queryOne<any>(
    `SELECT
       COALESCE(SUM(gross_wages), 0) AS gross,
       COALESCE(SUM(federal_withholding), 0) AS federal,
       COALESCE(SUM(social_security_ee), 0) AS ss,
       COALESCE(SUM(medicare_ee), 0) AS medicare,
       COALESCE(SUM(state_tax), 0) AS state,
       COALESCE(SUM(net_pay), 0) AS net
     FROM altax.v3_paychecks
     WHERE employee = $1 AND client_id = $2 AND lower(status) <> 'void'
       AND EXTRACT(YEAR FROM pay_date) = EXTRACT(YEAR FROM $3::timestamptz)
       AND pay_date <= $3::timestamptz`,
    [paycheck.employee, paycheck.client_id, paycheck.pay_date]
  );

  const checkSettings = await queryOne<any>(`SELECT * FROM altax.v3_check_settings WHERE client_id = $1`, [paycheck.client_id]);

  const { generatePaycheckPdf } = await import("./paycheckPdf");
  const pdfBytes = await generatePaycheckPdf({
    clientName: client?.client_name || paycheck.client_name, clientAddress: client?.address || null,
    clientPhone: client?.phone || null, employerEin: client?.ein || null,
    employeeName: paycheck.employee, employeeSsn: paycheck.employee_ssn, employeeAddress: paycheck.employee_address,
    checkNumber: paycheck.check_number, payDate: paycheck.pay_date,
    payPeriodStart: paycheck.pay_period_start, payPeriodEnd: paycheck.pay_period_end,
    payType: paycheck.pay_type, rate: Number(paycheck.regular_rate || paycheck.rate || 0),
    hours: Number(paycheck.regular_hours || paycheck.hours || 0),
    grossCurrent: Number(paycheck.gross_wages), grossYtd: Number(ytd.gross),
    federalCurrent: Number(paycheck.federal_withholding), federalYtd: Number(ytd.federal),
    ssCurrent: Number(paycheck.social_security_ee), ssYtd: Number(ytd.ss),
    medicareCurrent: Number(paycheck.medicare_ee), medicareYtd: Number(ytd.medicare),
    stateCurrent: Number(paycheck.state_tax), stateYtd: Number(ytd.state),
    netCurrent: Number(paycheck.net_pay), netYtd: Number(ytd.net),
    bankName: paycheck.payment_bank_name, bankLast4: paycheck.payment_bank_last4,
    routingNumber: paycheck.payment_routing_number, accountNumber: paycheck.payment_account_number,
    memo: `${paycheck.pay_type || "Payroll"} wages`,
    checkOffsets: checkSettings ? {
      dateX: Number(checkSettings.date_x || 0), dateY: Number(checkSettings.date_y || 0),
      payeeX: Number(checkSettings.payee_x || 0), payeeY: Number(checkSettings.payee_y || 0),
      amountX: Number(checkSettings.amount_x || 0), amountY: Number(checkSettings.amount_y || 0),
      memoX: Number(checkSettings.memo_x || 0), memoY: Number(checkSettings.memo_y || 0),
      signatureX: Number(checkSettings.signature_x || 0), signatureY: Number(checkSettings.signature_y || 0),
      micrXOffset: Number(checkSettings.micrx_offset || 0), micrYOffset: Number(checkSettings.micry_offset || 0),
    } : undefined,
  });

  /** Ported behavior for alTaxPortalMarkPaycheckPrinted: the print action itself marks the check printed, not a separate manual toggle — only for staff/admin printing the physical check, not an employee viewing their own paystub. */
  if (req.user!.role !== "employee" && String(paycheck.status || "").toLowerCase() !== "void") {
    await query(`UPDATE altax.v3_paychecks SET status = 'Printed', printed_at = COALESCE(printed_at, now()) WHERE paycheck_id = $1`, [paycheckId]);
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="Paycheck_${paycheck.check_number || paycheckId}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

/**
 * Permanently delete a paycheck — reverses its 3 posted GL lines (same
 * ref/source pair the edit route clears) and removes the row. Blocked once
 * isPaycheckLockedForEdit() trips (printed, paid, void, etc.) since a check
 * that already left the system needs a void for the paper trail, not a
 * delete. No hard-delete-by-default policy exception: admin-only, typed
 * confirmation required, matching the DELETE USER / DELETE DOCUMENT pattern.
 */
accountingRouter.post("/paychecks/:paycheckId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { paycheckId } = req.params;
  if (String((req.body || {}).confirm || "").trim() !== "DELETE PAYCHECK") {
    return res.status(400).json({ error: 'Type "DELETE PAYCHECK" to confirm this permanent action.' });
  }
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_paychecks WHERE paycheck_id = $1`, [paycheckId]);
  if (!existing) return res.status(404).json({ error: "Paycheck not found." });
  if (!(await canAccessClient(req.user!, existing.client_id))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  if (isPaycheckLockedForEdit(existing)) {
    return res.status(400).json({ error: "Printed or finalized paychecks cannot be deleted. Void it instead." });
  }

  await query(`DELETE FROM altax.v3_gl_entries WHERE ref = $1 AND source = 'Payroll'`, [paycheckId]);
  await query(`DELETE FROM altax.v3_paychecks WHERE paycheck_id = $1`, [paycheckId]);

  await logAudit("Accounting", "DELETE_PAYCHECK", paycheckId, "Employee", existing.employee || "", "",
    `Paycheck permanently deleted by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true, paycheckId });
}));

/**
 * Record a contractor payment — ported from alTaxPortalSaveContractorPayment. No
 * calculation: a dollar amount plus two GL lines (expense debit, cash credit).
 */
accountingRouter.post("/contractor-payments", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const clientId = String(body.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "Client is required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const contractorId = String(body.contractorId || "").trim();
  const contractor = contractorId
    ? await queryOne<any>(`SELECT * FROM altax.v3_employees WHERE employee_id = $1 AND client_id = $2`, [contractorId, clientId])
    : null;
  if (!contractor) return res.status(400).json({ error: "Contractor not found." });
  const contractorSignal = [contractor.worker_type, contractor.pay_type, contractor.form_type].join(" ").toLowerCase();
  if (!contractorSignal.includes("contractor") && !contractorSignal.includes("1099")) {
    return res.status(400).json({ error: "Selected worker is not marked as a contractor." });
  }

  const amount = money(body.amount);
  if (amount <= 0) return res.status(400).json({ error: "Contractor payment amount must be greater than zero." });

  const paymentId = `CPAY-${idSuffix()}`;
  const expenseCategory = String(body.expenseCategory || contractor.service_category || "Contract Labor").trim() || "Contract Labor";
  const paymentDate = String(body.paymentDate || "").trim() || null;
  const paymentMethod = await resolvePaymentMethod(clientId, "payroll", body.paymentMethodId);

  await query(
    `INSERT INTO altax.v3_contractor_payments
       (contractor_payment_id, client_id, client_name, contractor_id, contractor_name, payment_date, amount,
        method, payment_method_id, check_number, confirmation_number, expense_category, memo, is_1099_eligible, status,
        payment_bank_name, payment_routing_number, payment_account_number, payment_account_type, payment_bank_last4,
        source_system, source_record_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'Node Web App',$1)`,
    [paymentId, client.client_id, client.client_name, contractor.employee_id, contractor.employee_name, paymentDate,
      amount, String(body.method || "Check").trim(), paymentMethod?.paymentMethodId || String(body.paymentMethodId || "").trim() || null,
      String(body.checkNumber || "").trim() || null, String(body.confirmationNumber || "").trim() || null,
      expenseCategory, String(body.memo || "").trim() || null,
      body.eligible1099 === undefined ? true : Boolean(body.eligible1099), String(body.status || "Active").trim(),
      paymentMethod?.bankName || null, paymentMethod?.routingNumber || null, paymentMethod?.accountNumber || null,
      paymentMethod?.accountType || null, paymentMethod?.bankLast4 || null]
  );

  await appendGl(client.client_id, client.client_name, {
    entryDate: paymentDate, ref: paymentId, description: `Contractor payment - ${contractor.employee_name}`,
    account: expenseCategory, debit: amount, credit: 0, source: "Contractor Payment",
  });
  await appendGl(client.client_id, client.client_name, {
    entryDate: paymentDate, ref: paymentId, description: "Contractor payment cash/bank",
    account: "Cash", debit: 0, credit: amount, source: "Contractor Payment",
  });

  await logAudit("Contractors", "RECORD_PAYMENT", paymentId, "ContractorID", "", contractorId,
    `Contractor payment recorded by ${req.user!.email}.`, req.user!.email);

  res.status(201).json({ ok: true, contractorPaymentId: paymentId });
}));

/** List a client's contractor payments — admin/staff, client-scoped. */
accountingRouter.get("/contractor-payments/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const rows = await query(`SELECT * FROM altax.v3_contractor_payments WHERE client_id = $1 ORDER BY payment_date DESC NULLS LAST`, [clientId]);
  res.json({ contractorPayments: rows });
}));

/** Edit a contractor payment — reposts its 2 GL lines the same way the sales-input edit does. */
accountingRouter.patch("/contractor-payments/:contractorPaymentId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { contractorPaymentId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_contractor_payments WHERE contractor_payment_id = $1`, [contractorPaymentId]);
  if (!existing) return res.status(404).json({ error: "Contractor payment not found." });
  if (!(await canAccessClient(req.user!, existing.client_id))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }

  const body = req.body || {};
  const amount = body.amount !== undefined ? money(body.amount) : Number(existing.amount);
  if (amount <= 0) return res.status(400).json({ error: "Contractor payment amount must be greater than zero." });
  const paymentDate = body.paymentDate !== undefined ? (String(body.paymentDate).trim() || null) : existing.payment_date;
  const expenseCategory = body.expenseCategory !== undefined ? (String(body.expenseCategory).trim() || "Contract Labor") : existing.expense_category;
  const memo = body.memo !== undefined ? (String(body.memo).trim() || null) : existing.memo;
  const method = body.method !== undefined ? String(body.method).trim() : existing.method;
  const checkNumber = body.checkNumber !== undefined ? (String(body.checkNumber).trim() || null) : existing.check_number;
  const confirmationNumber = body.confirmationNumber !== undefined ? (String(body.confirmationNumber).trim() || null) : existing.confirmation_number;
  // eligible1099 mirrors the Tax Rates/COA "active" lesson: default to the existing value, not a
  // hardcoded default, so an edit that doesn't touch this field can't silently flip it.
  const eligible1099 = body.eligible1099 === undefined ? Boolean(existing.is_1099_eligible) : Boolean(body.eligible1099);
  const paymentMethod = body.paymentMethodId !== undefined ? await resolvePaymentMethod(existing.client_id, "payroll", body.paymentMethodId) : null;
  const paymentMethodId = body.paymentMethodId !== undefined ? (paymentMethod?.paymentMethodId || String(body.paymentMethodId || "").trim() || null) : existing.payment_method_id;
  const bankName = paymentMethod?.bankName ?? existing.payment_bank_name;
  const routingNumber = paymentMethod?.routingNumber ?? existing.payment_routing_number;
  const accountNumber = paymentMethod?.accountNumber ?? existing.payment_account_number;
  const accountType = paymentMethod?.accountType ?? existing.payment_account_type;
  const bankLast4 = paymentMethod?.bankLast4 ?? existing.payment_bank_last4;

  await query(
    `UPDATE altax.v3_contractor_payments SET payment_date=$2, amount=$3, expense_category=$4, memo=$5, method=$6, check_number=$7,
       confirmation_number=$8, is_1099_eligible=$9, payment_method_id=$10, payment_bank_name=$11, payment_routing_number=$12,
       payment_account_number=$13, payment_account_type=$14, payment_bank_last4=$15
     WHERE contractor_payment_id = $1`,
    [contractorPaymentId, paymentDate, amount, expenseCategory, memo, method, checkNumber,
      confirmationNumber, eligible1099, paymentMethodId, bankName, routingNumber, accountNumber, accountType, bankLast4]
  );

  await query(`DELETE FROM altax.v3_gl_entries WHERE ref = $1 AND source = 'Contractor Payment'`, [contractorPaymentId]);
  await appendGl(existing.client_id, existing.client_name, {
    entryDate: paymentDate, ref: contractorPaymentId, description: `Contractor payment - ${existing.contractor_name}`,
    account: expenseCategory, debit: amount, credit: 0, source: "Contractor Payment",
  });
  await appendGl(existing.client_id, existing.client_name, {
    entryDate: paymentDate, ref: contractorPaymentId, description: "Contractor payment cash/bank",
    account: "Cash", debit: 0, credit: amount, source: "Contractor Payment",
  });

  await logAudit("Contractors", "EDIT_PAYMENT", contractorPaymentId, "Amount", String(existing.amount ?? ""), String(amount),
    `Contractor payment edited by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, contractorPaymentId });
}));

/**
 * Post a manual journal entry — ported from alTaxPortalSaveManualJE. Pure
 * double-entry validation: at least two lines, debits must equal credits (to the
 * cent). No money is computed, only checked for balance.
 */
accountingRouter.post("/journal-entries", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const clientId = String(body.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "Client is required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const lines = rawLines
    .map((line: any) => ({
      account: String(line.account || "").trim(), debit: money(line.debit), credit: money(line.credit),
      memo: String(line.memo || "").trim(),
    }))
    .filter((line: any) => line.account && (line.debit || line.credit));

  if (lines.length < 2) return res.status(400).json({ error: "A journal entry needs at least two lines." });

  const totalDebit = money(lines.reduce((sum: number, l: any) => sum + l.debit, 0));
  const totalCredit = money(lines.reduce((sum: number, l: any) => sum + l.credit, 0));
  if (!totalDebit || !totalCredit) return res.status(400).json({ error: "Journal entry must include debit and credit lines." });
  if (Math.abs(totalDebit - totalCredit) > 0.009) {
    return res.status(400).json({ error: `Journal entry is out of balance. Debits: ${totalDebit.toFixed(2)}, credits: ${totalCredit.toFixed(2)}.` });
  }

  const jeId = `JE-${idSuffix()}`;
  const entryDate = String(body.entryDate || "").trim() || null;
  const ref = String(body.ref || jeId).trim();
  const description = String(body.description || "").trim() || null;
  const notes = String(body.notes || "").trim() || null;

  let firstLineId = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineId = `${jeId}-${i + 1}`;
    if (!firstLineId) firstLineId = lineId;
    await query(
      `INSERT INTO altax.v3_manual_je
         (jeid, client_id, client_name, entry_date, ref, description, account, debit, credit, notes,
          source_system, source_record_id, journal_entry_id, line_no)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Node Web App',$11,$11,$12)`,
      [lineId, client.client_id, client.client_name, entryDate, ref, description, line.account, line.debit,
        line.credit, line.memo || notes || description, jeId, i + 1]
    );
    await appendGl(client.client_id, client.client_name, {
      entryDate, ref, description: description || "Manual journal entry", account: line.account,
      debit: line.debit, credit: line.credit, source: "Manual JE", notes: line.memo || notes || description,
    });
  }

  await logAudit("Accounting", "CREATE_JE", jeId, "", "", "", "Manual journal entry created from web app.", req.user!.email);

  res.status(201).json({ ok: true, jeId, lines: lines.length, totalDebit, totalCredit });
}));

/**
 * Recent manual journal entries — grouped by journal_entry_id since v3_manual_je
 * stores one row per line. Powers the "Recent Manual Entries" history table that
 * previously didn't exist at all (create-only form, no way to see what was posted).
 */
accountingRouter.get("/journal-entries/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const rows = await query<any>(
    `SELECT jeid, entry_date, ref, description, account, debit, credit, notes, journal_entry_id, line_no
       FROM altax.v3_manual_je WHERE client_id = $1 ORDER BY journal_entry_id DESC, line_no ASC`,
    [clientId]
  );
  const byEntry = new Map<string, any>();
  for (const row of rows) {
    const key = row.journal_entry_id || row.jeid;
    if (!byEntry.has(key)) {
      byEntry.set(key, { journalEntryId: key, entryDate: row.entry_date, ref: row.ref, description: row.description, lines: [] });
    }
    byEntry.get(key).lines.push({ account: row.account, debit: row.debit, credit: row.credit, notes: row.notes });
  }
  res.json({ entries: Array.from(byEntry.values()) });
}));

/** List every employee/contractor across all clients — admin-only. Powers the Assigned Employee picker on Portal Access's Add/Edit User form. */
accountingRouter.get("/employees", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query(
    `SELECT employee_id, employee_name, client_id, client_name FROM altax.v3_employees ORDER BY employee_name ASC`
  );
  res.json({ employees: rows });
}));

/** List a client's employee/contractor profiles — admin/staff, client-scoped. Payroll and Contractor Payments both depend on a profile existing here first. */
accountingRouter.get("/employees/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const rows = await query(
    `SELECT employee_id, employee_name, email, phone, pay_type, worker_type, form_type, status,
            default_gross_wages, pay_rate, default_hours, pay_frequency, service_category, address, state,
            street_address, city, zip_code
       FROM altax.v3_employees WHERE client_id = $1 ORDER BY employee_name ASC`,
    [clientId]
  );
  res.json({ employees: rows });
}));

/**
 * Create or update an employee/contractor profile — ported from alTaxPortalSaveEmployee.
 * Deliberately excludes SSN/bank fields from this endpoint's write surface; that
 * sensitive data belongs in the Vault/Payment Methods flows already built, not a
 * plaintext profile form.
 */
accountingRouter.post("/employees", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const clientId = String(body.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "Client is required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const employeeName = String(body.employeeName || "").trim();
  if (!employeeName) return res.status(400).json({ error: "Name is required." });

  const employeeId = String(body.employeeId || "").trim() || `EMP-${idSuffix()}`;
  const existing = await queryOne<any>(`SELECT employee_id FROM altax.v3_employees WHERE employee_id = $1`, [employeeId]);

  const fields = {
    client_id: client.client_id, client_name: client.client_name, employee_name: employeeName,
    email: String(body.email || "").trim() || null, phone: String(body.phone || "").trim() || null,
    pay_type: String(body.payType || "Hourly").trim(), worker_type: String(body.workerType || "Employee").trim(),
    form_type: String(body.formType || "").trim() || null, status: String(body.status || "Active").trim(),
    default_gross_wages: money(body.defaultGrossWages), pay_rate: money(body.payRate),
    default_hours: Number(body.defaultHours) || null, pay_frequency: String(body.payFrequency || "").trim() || null,
    service_category: String(body.serviceCategory || "").trim() || null,
  };

  if (existing) {
    await query(
      `UPDATE altax.v3_employees SET client_id=$2, client_name=$3, employee_name=$4, email=$5, phone=$6,
         pay_type=$7, worker_type=$8, form_type=$9, status=$10, default_gross_wages=$11, pay_rate=$12,
         default_hours=$13, pay_frequency=$14, service_category=$15, updated_at = now()
       WHERE employee_id = $1`,
      [employeeId, ...Object.values(fields)]
    );
    await logAudit("Employees", "EDIT", employeeId, "", "", employeeName, `Employee edited by ${req.user!.email}.`, req.user!.email);
  } else {
    await query(
      `INSERT INTO altax.v3_employees
         (employee_id, client_id, client_name, employee_name, email, phone, pay_type, worker_type, form_type,
          status, default_gross_wages, pay_rate, default_hours, pay_frequency, service_category,
          source_system, source_record_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'Node Web App',$1)`,
      [employeeId, ...Object.values(fields)]
    );
    await logAudit("Employees", "CREATE", employeeId, "", "", employeeName, `Employee created by ${req.user!.email}.`, req.user!.email);
  }

  let portalUser: { userId: string; inviteToken?: string; inviteLink?: string } | null = null;
  if (Boolean(body.grantPortalAccess)) {
    portalUser = await provisionEmployeePortalUser({ employeeId, employeeName, email: fields.email || "", clientId: client.client_id });
    if (portalUser) {
      await logAudit("Employees", "PORTAL_PROVISION", employeeId, "PortalUserID", "", portalUser.userId,
        `Employee portal access granted by ${req.user!.email}.`, req.user!.email);
    }
  }

  res.status(existing ? 200 : 201).json({
    ok: true, employeeId,
    portalUserId: portalUser?.userId, inviteToken: portalUser?.inviteToken, inviteLink: portalUser?.inviteLink,
  });
}));

/**
 * One employee/contractor's non-sensitive profile fields — powers the detail
 * page's read/edit view. Kept as its own route (not GET /employees/:employeeId,
 * which would collide with GET /employees/:clientId's single-segment shape)
 * and deliberately excludes SSN/bank/tax-ID fields — those stay behind the
 * admin-only /sensitive reveal route below, same split as Payment Methods.
 */
accountingRouter.get("/employees/:employeeId/profile", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { employeeId } = req.params;
  const employee = await queryOne<any>(
    `SELECT employee_id, client_id, client_name, employee_name, email, phone, pay_type, worker_type, form_type,
            status, default_gross_wages, pay_rate, default_hours, pay_frequency, service_category,
            w9_status, is_1099_eligible, bank_last4, created_at, updated_at
       FROM altax.v3_employees WHERE employee_id = $1`,
    [employeeId]
  );
  if (!employee) return res.status(404).json({ error: "Employee not found." });
  if (!(await canAccessClient(req.user!, employee.client_id))) {
    return res.status(403).json({ error: "You do not have access to this employee." });
  }
  res.json({ employee });
}));

/**
 * Archive an employee/contractor profile — soft delete only (sets status =
 * 'Archived'), consistent with the client-archive pattern: payroll/1099
 * history references employee_id directly, so a hard delete would orphan
 * every past paycheck/contractor-payment row.
 */
accountingRouter.post("/employees/:employeeId/archive", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { employeeId } = req.params;
  const employee = await queryOne<any>(`SELECT * FROM altax.v3_employees WHERE employee_id = $1`, [employeeId]);
  if (!employee) return res.status(404).json({ error: "Employee not found." });
  if (!(await canAccessClient(req.user!, employee.client_id))) {
    return res.status(403).json({ error: "You do not have access to this employee." });
  }

  await query(`UPDATE altax.v3_employees SET status = 'Archived', updated_at = now() WHERE employee_id = $1`, [employeeId]);
  await logAudit("Employees", "ARCHIVE", employeeId, "Status", employee.status || "", "Archived",
    `Employee archived by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, employeeId });
}));

/**
 * Toggle Active/Inactive without touching Archived — a lighter-weight status
 * flip than Archive (which is meant to be closer to "final", dropping the
 * profile off active pickers everywhere). Inactive still shows in lists,
 * just flagged, matching what "Active/Non-Active" means on a roster.
 */
accountingRouter.post("/employees/:employeeId/status", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { employeeId } = req.params;
  const status = String((req.body || {}).status || "").trim();
  if (!["Active", "Inactive"].includes(status)) return res.status(400).json({ error: "Status must be Active or Inactive." });

  const employee = await queryOne<any>(`SELECT * FROM altax.v3_employees WHERE employee_id = $1`, [employeeId]);
  if (!employee) return res.status(404).json({ error: "Employee not found." });
  if (!(await canAccessClient(req.user!, employee.client_id))) {
    return res.status(403).json({ error: "You do not have access to this employee." });
  }

  await query(`UPDATE altax.v3_employees SET status = $2, updated_at = now() WHERE employee_id = $1`, [employeeId, status]);
  await logAudit("Employees", "STATUS_CHANGE", employeeId, "Status", employee.status || "", status,
    `Employee status changed to ${status} by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, employeeId, status });
}));

/**
 * Permanently delete an employee/contractor profile — admin-only, typed
 * confirmation, matching the DELETE USER / DELETE PAYCHECK pattern used
 * elsewhere. Blocked if the profile has any contractor payments (a real
 * foreign key via contractor_id) or paychecks (matched by name — v3_paychecks
 * has no employee_id column, so this is best-effort but still catches the
 * common case) on file, since deleting those rows' only human-readable
 * anchor would make the firm's own payroll/1099 history unreadable. Archive
 * is the correct action once there's real payroll history; Delete is for
 * profiles created by mistake or that never had any activity.
 */
accountingRouter.post("/employees/:employeeId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { employeeId } = req.params;
  if (String((req.body || {}).confirm || "").trim() !== "DELETE EMPLOYEE") {
    return res.status(400).json({ error: 'Type "DELETE EMPLOYEE" to confirm this permanent action.' });
  }
  const employee = await queryOne<any>(`SELECT * FROM altax.v3_employees WHERE employee_id = $1`, [employeeId]);
  if (!employee) return res.status(404).json({ error: "Employee not found." });
  if (!(await canAccessClient(req.user!, employee.client_id))) {
    return res.status(403).json({ error: "You do not have access to this employee." });
  }

  const paymentCount = await queryOne<any>(`SELECT COUNT(*)::int AS n FROM altax.v3_contractor_payments WHERE contractor_id = $1`, [employeeId]);
  const paycheckCount = await queryOne<any>(`SELECT COUNT(*)::int AS n FROM altax.v3_paychecks WHERE client_id = $1 AND lower(employee) = lower($2)`, [employee.client_id, employee.employee_name]);
  if ((paymentCount?.n || 0) > 0 || (paycheckCount?.n || 0) > 0) {
    return res.status(400).json({ error: "This profile has payroll or contractor-payment history on file and can't be deleted. Archive it instead." });
  }

  await query(`DELETE FROM altax.v3_employees WHERE employee_id = $1`, [employeeId]);
  await logAudit("Employees", "DELETE", employeeId, "Name", employee.employee_name || "", "",
    `Employee permanently deleted by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, employeeId });
}));

/**
 * Save sensitive employee/contractor fields — SSN/EIN/TIN and bank routing/account
 * numbers, plus tax-filing/1099 metadata. Legacy's alTaxPortalSaveEmployee writes
 * all of this in plaintext on the same row as the profile basics. This app splits
 * it into its own endpoint (mirroring the Payment Methods module) so the tax-ID and
 * bank fields get encrypted at rest instead — closing the exact plaintext exposure
 * documented on POST /employees, while still giving every 1099/W-2 field legacy has
 * a real place to be written (previously nothing ever wrote SSN/address/TIN/W9
 * status here, even though payroll and W-2/1099 generation already read them).
 */
accountingRouter.patch("/employees/:employeeId/sensitive", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { employeeId } = req.params;
  const employee = await queryOne<any>(`SELECT * FROM altax.v3_employees WHERE employee_id = $1`, [employeeId]);
  if (!employee) return res.status(404).json({ error: "Employee not found." });
  if (!(await canAccessClient(req.user!, employee.client_id))) {
    return res.status(403).json({ error: "You do not have access to this employee." });
  }

  const body = req.body || {};
  const paymentAccountNumber = String(body.paymentAccountNumber || "").trim();
  const paymentBankName = String(body.paymentBankName || "").trim();
  const paymentRoutingNumber = String(body.paymentRoutingNumber || "").trim();
  const paymentAccountType = String(body.paymentAccountType || "").trim();
  // A blank SSN/EIN/TIN/bank field means "leave it as-is", not "erase it" — the
  // form intentionally never re-displays these decrypted values by default (only
  // on Reveal), so falling through to null on every save would silently wipe
  // real data the moment someone edits an unrelated field like W-9 status.
  const bankLast4 = paymentAccountNumber ? paymentAccountNumber.replace(/\D/g, "").slice(-4) || null : employee.bank_last4;

  const newState = String(body.state || "").trim() || employee.state;
  const newStreet = Object.prototype.hasOwnProperty.call(body, "streetAddress") ? String(body.streetAddress || "").trim() || null : employee.street_address;
  const newCity = Object.prototype.hasOwnProperty.call(body, "city") ? String(body.city || "").trim() || null : employee.city;
  const newZip = Object.prototype.hasOwnProperty.call(body, "zipCode") ? String(body.zipCode || "").trim() || null : employee.zip_code;
  // Explicitly-passed `address` wins (a caller intentionally overriding the composed
  // value); otherwise recompose from the structured parts whenever any changed, else
  // fall back to the existing value so an unrelated field edit can't silently wipe it.
  const newAddress = Object.prototype.hasOwnProperty.call(body, "address")
    ? String(body.address || "").trim() || null
    : ["streetAddress", "city", "zipCode"].some((k) => Object.prototype.hasOwnProperty.call(body, k))
      ? composeAddress({ street: newStreet, city: newCity, state: newState, zip: newZip })
      : employee.address;

  await query(
    `UPDATE altax.v3_employees SET
       ssn=$2, ein=$3, tin=$4, address=$5, federal_filing_status=$6, state_filing_status=$7,
       w9_status=$8, tin_verification_status=$9, vendor_classification=$10, contractor_payment_type=$11,
       fixed_project_amount=$12, is_1099_eligible=$13, payment_method=$14, direct_deposit=$15,
       payment_bank_name=$16, payment_routing_number=$17, payment_account_number=$18, payment_account_type=$19,
       payment_bank_last4=$20, bank_last4=$20, state=$21, street_address=$22, city=$23, zip_code=$24, updated_at = now()
     WHERE employee_id = $1`,
    [employeeId,
      String(body.ssn || "").trim() ? encryptValue(String(body.ssn).trim()) : employee.ssn,
      String(body.ein || "").trim() ? encryptValue(String(body.ein).trim()) : employee.ein,
      String(body.tin || "").trim() ? encryptValue(String(body.tin).trim()) : employee.tin,
      newAddress,
      String(body.federalFilingStatus || "").trim() || null,
      String(body.stateFilingStatus || "").trim() || null,
      String(body.w9Status || "").trim() || null,
      String(body.tinVerificationStatus || "").trim() || null,
      String(body.vendorClassification || "").trim() || null,
      String(body.contractorPaymentType || "").trim() || null,
      body.fixedProjectAmount !== undefined ? money(body.fixedProjectAmount) : null,
      body.is1099Eligible === undefined ? false : Boolean(body.is1099Eligible),
      String(body.paymentMethod || "").trim() || null,
      body.directDeposit === undefined ? false : Boolean(body.directDeposit),
      paymentBankName || employee.payment_bank_name,
      paymentRoutingNumber ? encryptValue(paymentRoutingNumber) : employee.payment_routing_number,
      paymentAccountNumber ? encryptValue(paymentAccountNumber) : employee.payment_account_number,
      paymentAccountType || employee.payment_account_type,
      bankLast4,
      newState, newStreet, newCity, newZip]
  );

  await logAudit("Employees", "EDIT_SENSITIVE", employeeId, "", "", "",
    `Sensitive employee fields updated by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, employeeId });
}));

/**
 * Reveal one employee/contractor's decrypted SSN/EIN/TIN and bank details —
 * admin-only, individually audited, same philosophy as the Vault and Payment
 * Methods reveal routes: separating "list has last-4 only" from "full value on
 * explicit request" so casual profile views never surface the raw tax ID.
 */
accountingRouter.get("/employees/:employeeId/sensitive", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { employeeId } = req.params;
  const employee = await queryOne<any>(`SELECT * FROM altax.v3_employees WHERE employee_id = $1`, [employeeId]);
  if (!employee) return res.status(404).json({ error: "Employee not found." });
  if (!(await canAccessClient(req.user!, employee.client_id))) {
    return res.status(403).json({ error: "You do not have access to this employee." });
  }

  await logAudit("Employees", "REVEAL_SENSITIVE", employeeId, "", "", "",
    `Sensitive employee fields revealed by ${req.user!.email}.`, req.user!.email);

  res.json({
    employeeId,
    ssn: employee.ssn ? decryptTolerant(employee.ssn) : null,
    ein: employee.ein ? decryptTolerant(employee.ein) : null,
    tin: employee.tin ? decryptTolerant(employee.tin) : null,
    address: employee.address || null,
    streetAddress: employee.street_address || null,
    city: employee.city || null,
    state: employee.state || null,
    zipCode: employee.zip_code || null,
    federalFilingStatus: employee.federal_filing_status || null,
    stateFilingStatus: employee.state_filing_status || null,
    w9Status: employee.w9_status || null,
    tinVerificationStatus: employee.tin_verification_status || null,
    vendorClassification: employee.vendor_classification || null,
    contractorPaymentType: employee.contractor_payment_type || null,
    fixedProjectAmount: employee.fixed_project_amount || null,
    is1099Eligible: employee.is_1099_eligible || false,
    paymentMethod: employee.payment_method || null,
    directDeposit: employee.direct_deposit || false,
    paymentBankName: employee.payment_bank_name || null,
    paymentRoutingNumber: employee.payment_routing_number ? decryptTolerant(employee.payment_routing_number) : null,
    paymentAccountNumber: employee.payment_account_number ? decryptTolerant(employee.payment_account_number) : null,
    paymentAccountType: employee.payment_account_type || null,
  });
}));

/** List a client's general-ledger entries — admin/staff, client-scoped. Read-only: GL rows are only ever written by the modules above (Sales, Payroll, Contractor Payments, Manual JE) that post them as a side effect. */
accountingRouter.get("/gl/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const rows = await query(`SELECT * FROM altax.v3_gl_entries WHERE client_id = $1 ORDER BY entry_date DESC NULLS LAST`, [clientId]);
  res.json({ glEntries: rows });
}));

/**
 * W-2 employee copies (Copy B / C / 2) for one employee/year — see w2.ts module
 * doc comment for why Copy A/D aren't offered. Sums that employee's paychecks
 * for the calendar year directly from v3_paychecks.
 */
accountingRouter.get("/tax-forms/w2/:employeeId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { employeeId } = req.params;
  const year = String(req.query.year || new Date().getFullYear()).trim();
  if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: "A valid 4-digit year is required." });

  const employee = await queryOne<any>(`SELECT * FROM altax.v3_employees WHERE employee_id = $1`, [employeeId]);
  if (!employee) return res.status(404).json({ error: "Employee not found." });
  if (!(await canAccessClient(req.user!, employee.client_id))) {
    return res.status(403).json({ error: "You do not have access to this employee." });
  }
  const client = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [employee.client_id]);
  if (!client) return res.status(404).json({ error: "Employer client not found." });

  const totals = await queryOne<any>(
    `SELECT
       COALESCE(SUM(federal_taxable_wages), 0) AS box1,
       COALESCE(SUM(federal_withholding), 0) AS box2,
       COALESCE(SUM(social_security_wages), 0) AS box3,
       COALESCE(SUM(social_security_ee), 0) AS box4,
       COALESCE(SUM(medicare_wages), 0) AS box5,
       COALESCE(SUM(medicare_ee), 0) AS box6,
       COALESCE(SUM(state_taxable_wages), 0) AS box16,
       COALESCE(SUM(state_tax), 0) AS box17
     FROM altax.v3_paychecks
     WHERE employee = $1 AND client_id = $2 AND EXTRACT(YEAR FROM pay_date) = $3::int
       AND lower(status) <> 'void'`,
    [employee.employee_name, employee.client_id, year]
  );

  const { generateW2EmployeeCopies } = await import("./w2");
  const pdfBytes = await generateW2EmployeeCopies({
    employerEin: client.ein, employerName: client.client_name, employerAddress: client.address,
    employeeSsn: employee.ssn ? decryptTolerant(employee.ssn) : null, employeeName: employee.employee_name, employeeAddress: employee.address,
    box1: Number(totals.box1), box2: Number(totals.box2), box3: Number(totals.box3),
    box4: Number(totals.box4), box5: Number(totals.box5), box6: Number(totals.box6),
    state: client.state, employerStateId: client.state_tax_id,
    box16: Number(totals.box16), box17: Number(totals.box17),
  });

  await logAudit("Accounting", "GENERATE_W2", employeeId, "Year", "", year, `W-2 generated by ${req.user!.email}.`, req.user!.email);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="W2_${year}_${employee.employee_name.replace(/\s+/g, "_")}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

/**
 * 1099-NEC recipient copies (Copy B / 2) for one contractor/year. Sums that
 * contractor's payments for the calendar year from v3_contractor_payments.
 */
accountingRouter.get("/tax-forms/1099nec/:contractorId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { contractorId } = req.params;
  const year = String(req.query.year || new Date().getFullYear()).trim();
  if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: "A valid 4-digit year is required." });

  const contractor = await queryOne<any>(`SELECT * FROM altax.v3_employees WHERE employee_id = $1`, [contractorId]);
  if (!contractor) return res.status(404).json({ error: "Contractor not found." });
  if (!(await canAccessClient(req.user!, contractor.client_id))) {
    return res.status(403).json({ error: "You do not have access to this contractor." });
  }
  const client = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [contractor.client_id]);
  if (!client) return res.status(404).json({ error: "Payer client not found." });

  const totals = await queryOne<any>(
    `SELECT COALESCE(SUM(amount), 0) AS box1a
     FROM altax.v3_contractor_payments
     WHERE contractor_id = $1 AND client_id = $2 AND EXTRACT(YEAR FROM payment_date) = $3::int
       AND lower(status) <> 'void'`,
    [contractorId, contractor.client_id, year]
  );

  const totalPaid = Number(totals.box1a);
  // $600 is the IRS reporting threshold, not a hard block — admin may have a valid reason
  // to generate below it (backup withholding applies regardless of amount, for example).

  const { generate1099NecCopies } = await import("./nec1099");
  const pdfBytes = await generate1099NecCopies({
    year, payerName: client.client_name, payerAddress: client.address, payerPhone: client.phone,
    payerTin: client.ein,
    recipientTin: decryptTolerant(contractor.tin || "") || decryptTolerant(contractor.ssn || "") || decryptTolerant(contractor.ein || "") || null,
    recipientName: contractor.employee_name, recipientAddress: contractor.address,
    box1a: totalPaid, box4: 0, state: client.state, stateTaxWithheld: 0,
    statePayerNo: client.state_tax_id, stateIncome: 0,
  });

  await logAudit("Accounting", "GENERATE_1099NEC", contractorId, "Year", "", year, `1099-NEC generated by ${req.user!.email}.`, req.user!.email);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="1099NEC_${year}_${contractor.employee_name.replace(/\s+/g, "_")}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

/**
 * Year-End Forms Review — readiness check for every employee's W-2 and every
 * contractor's 1099-NEC for the selected tax year, before actually generating
 * the forms below. Real computed wage/tax totals (same SUM queries the W-2/
 * 1099-NEC routes themselves use, not re-derived separately), plus plain-
 * English review-issue flags (missing SSN/TIN/address, no activity this
 * year) so a preparer catches data problems before printing/filing, matching
 * legacy's W-2/1099-NEC review tables. Maryland Withholding Summary is a
 * lightweight in-app total (not a filled official MW508 state form — that
 * form's exact field layout wasn't available to verify against, so it's not
 * fabricated here; the number is real, the presentation is just a summary
 * table rather than a state-form facsimile).
 */
accountingRouter.get("/year-end-review/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const year = String(req.query.year || new Date().getFullYear()).trim();
  if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: "A valid 4-digit year is required." });

  const client = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });
  const clientIssues: string[] = [];
  if (!client.ein) clientIssues.push("Employer EIN missing on client record");

  const employeeRows = await query<any>(
    `SELECT e.employee_id, e.employee_name, e.ssn, e.address,
       COALESCE(SUM(p.federal_taxable_wages), 0) AS wages,
       COALESCE(SUM(p.federal_withholding), 0) AS fed_tax,
       COALESCE(SUM(p.state_tax), 0) AS md_tax
     FROM altax.v3_employees e
     LEFT JOIN altax.v3_paychecks p ON p.employee = e.employee_name AND p.client_id = e.client_id
       AND EXTRACT(YEAR FROM p.pay_date) = $2::int AND lower(p.status) <> 'void'
     WHERE e.client_id = $1 AND lower(COALESCE(e.worker_type, 'Employee')) NOT LIKE '%contractor%'
     GROUP BY e.employee_id, e.employee_name, e.ssn, e.address
     ORDER BY e.employee_name`,
    [clientId, year]
  );
  const employees = employeeRows.map((e) => {
    const issues = [...clientIssues];
    if (!e.ssn) issues.push("SSN missing");
    if (!e.address) issues.push("Address missing");
    if (Number(e.wages) === 0) issues.push("No paychecks recorded for this year");
    return {
      employeeId: e.employee_id, employeeName: e.employee_name, ssnOnFile: Boolean(e.ssn),
      wages: Number(e.wages), fedTax: Number(e.fed_tax), mdTax: Number(e.md_tax),
      status: issues.length === 0 ? "Ready" : "Needs Review", issues,
    };
  });

  const contractorRows = await query<any>(
    `SELECT c.employee_id, c.employee_name, c.tin, c.ssn, c.ein, c.address,
       COALESCE(SUM(cp.amount), 0) AS nec
     FROM altax.v3_employees c
     LEFT JOIN altax.v3_contractor_payments cp ON cp.contractor_id = c.employee_id AND cp.client_id = c.client_id
       AND EXTRACT(YEAR FROM cp.payment_date) = $2::int AND lower(cp.status) <> 'void'
     WHERE c.client_id = $1 AND lower(COALESCE(c.worker_type, '')) LIKE '%contractor%'
     GROUP BY c.employee_id, c.employee_name, c.tin, c.ssn, c.ein, c.address
     ORDER BY c.employee_name`,
    [clientId, year]
  );
  const contractors = contractorRows.map((c) => {
    const issues = [...clientIssues];
    const hasTin = Boolean(c.tin || c.ssn || c.ein);
    if (!hasTin) issues.push("TIN/SSN/EIN missing");
    if (!c.address) issues.push("Address missing");
    const nec = Number(c.nec);
    if (nec === 0) issues.push("No payments recorded for this year");
    else if (nec < 600) issues.push("Below $600 — 1099 not required unless backup withholding applies");
    return {
      contractorId: c.employee_id, contractorName: c.employee_name, tinOnFile: hasTin,
      nec, status: issues.some((i) => !i.includes("Below $600")) ? "Needs Review" : (nec > 0 ? "Ready" : "Needs Review"), issues,
    };
  });

  const mdWithholdingTotal = employees.reduce((s, e) => s + e.mdTax, 0);

  res.json({ year, clientIssues, employees, contractors, mdWithholdingSummary: { total: mdWithholdingTotal, employeeCount: employees.length } });
}));

/**
 * W-3 (annual transmittal) — one per employer/year, summing that client's W-2
 * totals across every employee (worker_type = 'Employee') paid that calendar
 * year. Must accompany paper Copy A of each employee's W-2 when mailed to the
 * SSA; not needed at all if W-2s were filed electronically.
 */
accountingRouter.get("/tax-forms/w3/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  const year = String(req.query.year || new Date().getFullYear()).trim();
  if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: "A valid 4-digit year is required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const totals = await queryOne<any>(
    `SELECT
       COUNT(DISTINCT p.employee) AS w2_count,
       COALESCE(SUM(p.federal_taxable_wages), 0) AS box1,
       COALESCE(SUM(p.federal_withholding), 0) AS box2,
       COALESCE(SUM(p.social_security_wages), 0) AS box3,
       COALESCE(SUM(p.social_security_ee), 0) AS box4,
       COALESCE(SUM(p.medicare_wages), 0) AS box5,
       COALESCE(SUM(p.medicare_ee), 0) AS box6,
       COALESCE(SUM(p.state_taxable_wages), 0) AS box16,
       COALESCE(SUM(p.state_tax), 0) AS box17
     FROM altax.v3_paychecks p
     JOIN altax.v3_employees e ON e.employee_name = p.employee AND e.client_id = p.client_id
     WHERE p.client_id = $1 AND EXTRACT(YEAR FROM p.pay_date) = $2::int
       AND lower(p.status) <> 'void' AND lower(e.worker_type) = 'employee'`,
    [clientId, year]
  );

  const { generateW3 } = await import("./w3");
  const pdfBytes = await generateW3({
    employerEin: client.ein, employerName: client.client_name, employerAddress: client.address,
    totalW2Count: Number(totals.w2_count),
    box1: Number(totals.box1), box2: Number(totals.box2), box3: Number(totals.box3),
    box4: Number(totals.box4), box5: Number(totals.box5), box6: Number(totals.box6),
    state: client.state, employerStateId: client.state_tax_id,
    box16: Number(totals.box16), box17: Number(totals.box17),
    contactPerson: client.company_contact_name, telephone: client.phone, email: client.email,
  });

  await logAudit("Accounting", "GENERATE_W3", clientId, "Year", "", year, `W-3 generated by ${req.user!.email}.`, req.user!.email);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="W3_${year}_${client.client_name.replace(/\s+/g, "_")}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

/**
 * Form 1096 (annual transmittal for 1099-NEC) — one per client/year, summing
 * that client's 1099-NEC totals across every contractor paid that calendar
 * year. Must accompany paper Copy A of each contractor's 1099-NEC when
 * mailed to the IRS; not needed if 1099-NECs were filed electronically.
 */
accountingRouter.get("/tax-forms/1096/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  const year = String(req.query.year || new Date().getFullYear()).trim();
  if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: "A valid 4-digit year is required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const totals = await queryOne<any>(
    `SELECT
       COUNT(DISTINCT contractor_id) AS form_count,
       COALESCE(SUM(amount), 0) AS total_reported
     FROM altax.v3_contractor_payments
     WHERE client_id = $1 AND EXTRACT(YEAR FROM payment_date) = $2::int
       AND lower(status) <> 'void'`,
    [clientId, year]
  );

  const { generateForm1096 } = await import("./form1096");
  const pdfBytes = await generateForm1096({
    filerEin: client.ein, filerName: client.client_name, filerAddress: client.address, filerState: client.state,
    contactName: client.company_contact_name, contactPhone: client.phone, contactEmail: client.email,
    totalFormsFiled: Number(totals.form_count), totalAmountReported: Number(totals.total_reported),
  });

  await logAudit("Accounting", "GENERATE_1096", clientId, "Year", "", year, `Form 1096 generated by ${req.user!.email}.`, req.user!.email);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="1096_${year}_${client.client_name.replace(/\s+/g, "_")}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

/**
 * Form 940 (annual FUTA return) — one per employer/year. Recomputes taxable
 * wages per employee (capped at the $7,000 FUTA wage base) rather than
 * summing the per-paycheck `futa` column, which does not apply that cap —
 * see form940.ts module doc for why.
 */
accountingRouter.get("/tax-forms/940/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  const year = String(req.query.year || new Date().getFullYear()).trim();
  if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: "A valid 4-digit year is required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const wageRows = await query<any>(
    `SELECT p.employee, EXTRACT(QUARTER FROM p.pay_date)::int AS quarter, COALESCE(SUM(p.gross_wages), 0) AS wages
     FROM altax.v3_paychecks p
     JOIN altax.v3_employees e ON e.employee_name = p.employee AND e.client_id = p.client_id
     WHERE p.client_id = $1 AND EXTRACT(YEAR FROM p.pay_date) = $2::int
       AND lower(p.status) <> 'void' AND lower(e.worker_type) = 'employee'
     GROUP BY p.employee, EXTRACT(QUARTER FROM p.pay_date)`,
    [clientId, year]
  );

  const { generateForm940 } = await import("./form940");
  const futaRate = await lookupRate("FUTA", 0.006, clientId);
  const pdfBytes = await generateForm940({
    employerEin: client.ein, employerName: client.client_name, employerAddress: client.address, employerState: client.state,
    futaRate,
    quarterlyWages: wageRows.map((r: any) => ({ employee: r.employee, quarter: Number(r.quarter) as 1 | 2 | 3 | 4, wages: Number(r.wages) })),
    contactName: client.company_contact_name, contactPhone: client.phone,
  });

  await logAudit("Accounting", "GENERATE_940", clientId, "Year", "", year, `Form 940 generated by ${req.user!.email}.`, req.user!.email);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="940_${year}_${client.client_name.replace(/\s+/g, "_")}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

/**
 * Form 941 (quarterly federal tax return) — one per employer/quarter. See
 * form941.ts module doc for which lines are computed vs. deliberately left
 * blank (deposits, adjustments, and the monthly/semiweekly depositor
 * determination for quarters at or above $2,500 all require data this
 * system doesn't track).
 */
accountingRouter.get("/tax-forms/941/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  const year = String(req.query.year || new Date().getFullYear()).trim();
  const quarter = Number(req.query.quarter);
  if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: "A valid 4-digit year is required." });
  if (![1, 2, 3, 4].includes(quarter)) return res.status(400).json({ error: "A valid quarter (1-4) is required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const totals = await queryOne<any>(
    `SELECT
       COUNT(DISTINCT p.employee) AS employee_count,
       COALESCE(SUM(p.gross_wages), 0) AS wages,
       COALESCE(SUM(p.federal_withholding), 0) AS federal_withholding,
       COALESCE(SUM(p.social_security_wages), 0) AS ss_wages,
       COALESCE(SUM(p.medicare_wages), 0) AS medicare_wages
     FROM altax.v3_paychecks p
     JOIN altax.v3_employees e ON e.employee_name = p.employee AND e.client_id = p.client_id
     WHERE p.client_id = $1 AND EXTRACT(YEAR FROM p.pay_date) = $2::int AND EXTRACT(QUARTER FROM p.pay_date) = $3::int
       AND lower(p.status) <> 'void' AND lower(e.worker_type) = 'employee'`,
    [clientId, year, quarter]
  );

  const { generateForm941 } = await import("./form941");
  const pdfBytes = await generateForm941({
    employerEin: client.ein, employerName: client.client_name, employerAddress: client.address, employerState: client.state,
    quarter: quarter as 1 | 2 | 3 | 4,
    employeeCount: Number(totals.employee_count),
    wages: Number(totals.wages), federalWithholding: Number(totals.federal_withholding),
    socialSecurityWages: Number(totals.ss_wages), medicareWages: Number(totals.medicare_wages),
    contactName: client.company_contact_name, contactPhone: client.phone,
  });

  await logAudit("Accounting", "GENERATE_941", clientId, "Quarter", "", `${year} Q${quarter}`, `Form 941 generated by ${req.user!.email}.`, req.user!.email);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="941_${year}Q${quarter}_${client.client_name.replace(/\s+/g, "_")}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

/**
 * Check Settings (MICR calibration) — per-client x/y offsets used when
 * physically printing a paycheck onto pre-printed check stock, so the date/
 * payee/amount/memo/signature/MICR line land in the right spot for that
 * client's specific check stock. One row per client, upserted by clientId
 * (mirrors the payment-methods upsert-by-id pattern).
 */
accountingRouter.get("/check-settings/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const row = await queryOne<any>(`SELECT * FROM altax.v3_check_settings WHERE client_id = $1`, [clientId]);
  res.json({ checkSettings: row || null });
}));

/**
 * MICR Calibration sheet — a printable alignment sample sheet (legacy's
 * "MICR Calibration" tool). Deliberately reuses generatePaycheckPdf with
 * calibrationMode:true rather than a separate drawing routine, so the
 * printed crosshairs can never drift out of sync with what a real paycheck
 * actually prints — see paycheckPdf.ts's calibrationMode doc comment.
 */
accountingRouter.get("/check-settings/:clientId/calibration-sheet", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });
  const checkSettings = await queryOne<any>(`SELECT * FROM altax.v3_check_settings WHERE client_id = $1`, [clientId]);

  const { generatePaycheckPdf } = await import("./paycheckPdf");
  const pdfBytes = await generatePaycheckPdf({
    clientName: client.client_name, clientAddress: client.address || null, clientPhone: client.phone || null,
    employerEin: client.ein || null, employeeName: "SAMPLE — FOR CALIBRATION", employeeSsn: null, employeeAddress: null,
    checkNumber: "0000", payDate: new Date().toISOString().slice(0, 10), payPeriodStart: null, payPeriodEnd: null,
    payType: "Sample", rate: 0, hours: 0,
    grossCurrent: 0, grossYtd: 0, federalCurrent: 0, federalYtd: 0, ssCurrent: 0, ssYtd: 0,
    medicareCurrent: 0, medicareYtd: 0, stateCurrent: 0, stateYtd: 0, netCurrent: 0, netYtd: 0,
    bankName: "SAMPLE BANK", bankLast4: "0000", routingNumber: "000000000", accountNumber: "0000000000",
    memo: "Calibration sample", checkOffsets: checkSettings ? {
      dateX: Number(checkSettings.date_x || 0), dateY: Number(checkSettings.date_y || 0),
      payeeX: Number(checkSettings.payee_x || 0), payeeY: Number(checkSettings.payee_y || 0),
      amountX: Number(checkSettings.amount_x || 0), amountY: Number(checkSettings.amount_y || 0),
      memoX: Number(checkSettings.memo_x || 0), memoY: Number(checkSettings.memo_y || 0),
      signatureX: Number(checkSettings.signature_x || 0), signatureY: Number(checkSettings.signature_y || 0),
      micrXOffset: Number(checkSettings.micrx_offset || 0), micrYOffset: Number(checkSettings.micry_offset || 0),
    } : undefined,
    calibrationMode: true,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="MICR_Calibration_${clientId}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

/** camelCase body key -> exact v3_check_settings column (irregular: "micrx_offset" not "micr_x_offset"). */
const CHECK_SETTING_NUMERIC_FIELDS: Record<string, string> = {
  micrXOffset: "micrx_offset", micrYOffset: "micry_offset",
  dateX: "date_x", dateY: "date_y",
  payeeX: "payee_x", payeeY: "payee_y",
  amountX: "amount_x", amountY: "amount_y",
  memoX: "memo_x", memoY: "memo_y",
  signatureX: "signature_x", signatureY: "signature_y",
};

accountingRouter.post("/check-settings", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const clientId = String(body.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "Client is required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const existing = await queryOne<any>(`SELECT setting_id FROM altax.v3_check_settings WHERE client_id = $1`, [clientId]);
  const settingId = existing?.setting_id || `CHKSET-${idSuffix()}`;

  const numeric: Record<string, number> = {};
  for (const [key, column] of Object.entries(CHECK_SETTING_NUMERIC_FIELDS)) {
    numeric[column] = body[key] !== undefined && body[key] !== "" ? Number(body[key]) || 0 : 0;
  }

  const fields = {
    check_position: String(body.checkPosition || "Bottom").trim(),
    paper_stock: String(body.paperStock || "").trim() || null,
    ...numeric,
    notes: String(body.notes || "").trim() || null,
  };

  if (existing) {
    const setClause = Object.keys(fields).map((col, i) => `${col} = $${i + 3}`).join(", ");
    await query(
      `UPDATE altax.v3_check_settings SET ${setClause}, updated_at = now(), updated_by = $2 WHERE setting_id = $1`,
      [settingId, req.user!.email, ...Object.values(fields)]
    );
  } else {
    const columns = ["setting_id", "client_id", "client_name", ...Object.keys(fields), "updated_by", "source_system", "source_record_id"];
    const values = [settingId, clientId, client.client_name, ...Object.values(fields), req.user!.email, "Node Web App", settingId];
    await query(`INSERT INTO altax.v3_check_settings (${columns.join(", ")}) VALUES (${values.map((_, i) => `$${i + 1}`).join(", ")})`, values);
  }

  await logAudit("Accounting", "SAVE_CHECK_SETTINGS", settingId, "ClientID", "", clientId,
    `Check settings saved by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, settingId });
}));
