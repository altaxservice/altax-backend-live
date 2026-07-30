import { Router, Response } from "express";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { lookupSalesTaxRate } from "../../common/taxRates";

/**
 * Tools → Calculators.
 *
 * Quick one-off math staff reach for without opening a real invoice or
 * payroll record — the sale amount goes in, the answer comes out. The sales
 * tax calculator draws its rate from the exact same v3_tax_rates lookup the
 * invoice editor's "Automatic Calculation" option uses (see
 * ../../common/taxRates), so a rate change the firm makes there is
 * immediately reflected here too, with no second place to keep in sync.
 *
 * The quarterly-estimate (safe harbor) calculator needs no server data at
 * all — it's pure arithmetic on numbers the user types in — so it lives
 * entirely in the frontend (CalculatorsPage.tsx) with no route here.
 */
export const calculatorsRouter = Router();

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

calculatorsRouter.get("/sales-tax", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const state = String(req.query.state || "").trim() || null;
  const amount = num(req.query.amount);
  const rate = await lookupSalesTaxRate(state);
  const taxAmount = Math.round(amount * (rate / 100) * 100) / 100;
  const total = Math.round((amount + taxAmount) * 100) / 100;
  res.json({ state, amount, rate, taxAmount, total });
}));
