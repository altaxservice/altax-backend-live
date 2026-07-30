import { Router, Response } from "express";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { listSalesTaxCategories, resolveSalesTaxRate } from "../../common/taxRates";

/**
 * Tools → Calculators.
 *
 * Quick one-off math staff reach for without opening a real invoice or
 * payroll record — the sale amount goes in, the answer comes out. The sales
 * tax calculator mirrors the firm's own Fee Schedule sales tax categories for
 * a state (General, Vape, Alcohol, a local jurisdiction add-on, etc. — see
 * listSalesTaxCategories/resolveSalesTaxRate in ../../common/taxRates), the
 * same category list the Accounting → Sales Input screen uses, so a rate
 * change the firm makes there is immediately reflected here too. Falls back
 * to each state's published general rate when the firm hasn't configured any
 * categories for that state.
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

calculatorsRouter.get("/sales-tax-categories", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const state = String(req.query.state || "").trim() || null;
  const categories = await listSalesTaxCategories(state);
  res.json({ categories });
}));

calculatorsRouter.get("/sales-tax", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const state = String(req.query.state || "").trim() || null;
  const amount = num(req.query.amount);
  const categoryId = String(req.query.categoryId || "").trim() || null;
  const { rate, source, categoryName } = await resolveSalesTaxRate(state, categoryId);
  const taxAmount = Math.round(amount * (rate / 100) * 100) / 100;
  const total = Math.round((amount + taxAmount) * 100) / 100;
  res.json({ state, amount, rate, source, categoryName: categoryName || null, taxAmount, total });
}));
