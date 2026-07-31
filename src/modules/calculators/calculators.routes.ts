import { Router, Response } from "express";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { computeSalesTaxLines, listSalesTaxCategories, SalesTaxLineInput } from "../../common/taxRates";
import { computeMdFiling } from "../../common/mdFiling";

/**
 * Tools → Calculators.
 *
 * Quick one-off math staff reach for without opening a real invoice or
 * payroll record. The sales tax calculator adopts the exact same process as
 * Accounting → Sales Input: pick a state, then add one or more
 * category + taxable-amount lines (General, Vape, Alcohol, a local
 * jurisdiction add-on, etc. — see listSalesTaxCategories/
 * computeSalesTaxLines in ../../common/taxRates), computed with the same
 * lookupRate precedence Sales Input itself uses, so a rate change the firm
 * makes there is immediately reflected here too. States with no Fee
 * Schedule categories configured fall back to a single published general
 * rate "category" so the same line-item UI still works.
 *
 * The quarterly-estimate (safe harbor) calculator needs no server data at
 * all — it's pure arithmetic on numbers the user types in — so it lives
 * entirely in the frontend (CalculatorsPage.tsx) with no route here.
 */
export const calculatorsRouter = Router();

calculatorsRouter.get("/sales-tax-categories", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const state = String(req.query.state || "").trim() || null;
  const categories = await listSalesTaxCategories(state);
  res.json({ categories });
}));

calculatorsRouter.post("/sales-tax-preview", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const state = String(req.body?.state || "").trim() || null;
  const rawLines: SalesTaxLineInput[] = Array.isArray(req.body?.lines) ? req.body.lines : [];
  const { lines, totalTaxableAmount, totalTax } = await computeSalesTaxLines(state, rawLines);
  const grandTotal = Math.round((totalTaxableAmount + totalTax) * 100) / 100;
  res.json({ state, lines, totalTaxableAmount, totalTax, grandTotal });
}));

/**
 * Maryland Form 202 Line 18 (timely discount) / Line 37 (late penalty +
 * interest) — see ../../common/mdFiling for the exact formulas, sourced
 * from the Comptroller's own 2026 Form 202 instructions.
 */
calculatorsRouter.get("/md-filing", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const taxDue = Number(req.query.taxDue);
  const dueDate = String(req.query.dueDate || "").trim();
  const paidDate = String(req.query.paidDate || "").trim();
  if (!Number.isFinite(taxDue) || taxDue < 0) return res.status(400).json({ error: "Enter the tax due amount." });
  if (!dueDate || !paidDate) return res.status(400).json({ error: "Enter both the due date and the filing/payment date." });
  res.json(await computeMdFiling(taxDue, dueDate, paidDate));
}));
