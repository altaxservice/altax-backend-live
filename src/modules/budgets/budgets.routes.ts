import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";

/**
 * Budget vs. actual — a client-scoped monthly target per COA account (Income/COGS/
 * Expense only; budgeting a balance-sheet account like Cash or Accounts Payable
 * isn't a meaningful concept the way a P&L account is). Actuals are computed live
 * from v3_gl_entries, the same source every other Accounting report already reads,
 * rather than duplicated/cached anywhere.
 */
export const budgetsRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

const BUDGETABLE_TYPES = ["Income", "COGS", "Expense"];

budgetsRouter.get("/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const year = Number(req.query.year) || new Date().getFullYear();

  const accounts = await query<any>(
    `SELECT account_name, account_type FROM altax.v3_coa WHERE active = true AND account_type = ANY($1::text[]) ORDER BY account_type, account_name`,
    [BUDGETABLE_TYPES]
  );

  const budgetRows = await query<any>(
    `SELECT account_name, month, amount FROM altax.v3_budgets WHERE client_id = $1 AND year = $2`,
    [clientId, year]
  );

  const actualRows = await query<any>(
    `SELECT account, EXTRACT(MONTH FROM entry_date)::int AS month, COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit
       FROM altax.v3_gl_entries
      WHERE client_id = $1 AND EXTRACT(YEAR FROM entry_date) = $2
      GROUP BY account, month`,
    [clientId, year]
  );
  const typeByAccount = new Map<string, string>(accounts.map((a: any) => [a.account_name, a.account_type]));
  const actuals = actualRows
    .filter((r: any) => typeByAccount.has(r.account))
    .map((r: any) => {
      const isIncome = typeByAccount.get(r.account) === "Income";
      const amount = isIncome ? Number(r.credit) - Number(r.debit) : Number(r.debit) - Number(r.credit);
      return { accountName: r.account, month: r.month, amount: Math.round(amount * 100) / 100 };
    });

  res.json({
    year,
    accounts: accounts.map((a: any) => ({ accountName: a.account_name, accountType: a.account_type })),
    budgets: budgetRows.map((b: any) => ({ accountName: b.account_name, month: b.month, amount: Number(b.amount) })),
    actuals,
  });
}));

/** Bulk save — replaces every budget row for this client+year with the posted set (upsert per row, 0-amount rows are skipped/deleted rather than stored, keeping the table free of clutter). */
budgetsRouter.post("/:clientId", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const client = await queryOne<any>(`SELECT client_id FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const body = req.body || {};
  const year = Number(body.year);
  const entries: { accountName?: string; month?: number; amount?: number }[] = Array.isArray(body.entries) ? body.entries : [];
  if (!Number.isFinite(year)) return res.status(400).json({ error: "A valid year is required." });

  let saved = 0;
  for (const e of entries) {
    const accountName = String(e.accountName || "").trim();
    const month = Number(e.month);
    const amount = Number(e.amount);
    if (!accountName || !Number.isInteger(month) || month < 1 || month > 12) continue;

    if (!Number.isFinite(amount) || amount === 0) {
      await query(`DELETE FROM altax.v3_budgets WHERE client_id = $1 AND account_name = $2 AND year = $3 AND month = $4`, [clientId, accountName, year, month]);
      continue;
    }
    await query(
      `INSERT INTO altax.v3_budgets (budget_id, client_id, account_name, year, month, amount)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (client_id, account_name, year, month) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now()`,
      [`BUD-${idSuffix()}`, clientId, accountName, year, month, Math.round(amount * 100) / 100]
    );
    saved++;
  }

  await logAudit("Accounting", "SAVE_BUDGET", clientId, "Year", "", String(year), `Budget for ${year} saved (${saved} entries) by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true, saved });
}));
