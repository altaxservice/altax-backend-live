import { Router, Response } from "express";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { computeSalesTaxLines, listSalesTaxCategories, SalesTaxLineInput } from "../../common/taxRates";
import { computeMdFiling, mdFilingTargetDate } from "../../common/mdFiling";
import { logAudit } from "../../common/audit";
import type { CalculatorSalesTaxPdfData } from "../accounting/reportsPdf";

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

/**
 * Shared by /sales-tax-pdf and /sales-tax-email so the two can never
 * disagree on what they're rendering/sending — same category math as
 * /sales-tax-preview, plus the MD filing block when the state is MD and
 * both dates are supplied.
 */
async function buildCalculatorPdfData(body: any): Promise<CalculatorSalesTaxPdfData> {
  const state = String(body?.state || "").trim() || "—";
  const rawLines: SalesTaxLineInput[] = Array.isArray(body?.lines) ? body.lines : [];
  const { lines, totalTaxableAmount, totalTax } = await computeSalesTaxLines(state, rawLines);
  const grandTotal = Math.round((totalTaxableAmount + totalTax) * 100) / 100;
  const taxableOnlyAmount = Math.round(lines.filter((l) => l.rate > 0).reduce((s, l) => s + l.taxableAmount, 0) * 100) / 100;

  let mdFiling: CalculatorSalesTaxPdfData["mdFiling"] = null;
  const dueDate = String(body?.mdDueDate || "").trim();
  const paidDate = String(body?.mdPaidDate || "").trim();
  if (state.toUpperCase() === "MD" && totalTax > 0 && dueDate && paidDate) {
    const result = await computeMdFiling(totalTax, dueDate, paidDate);
    mdFiling = {
      dueDate, targetFilingDate: mdFilingTargetDate(dueDate), paidDate, onTime: result.onTime, discount: result.discount, penalty: result.penalty,
      interest: result.interest, interestRateMonthly: result.interestRateMonthly, monthsLate: result.monthsLate,
      balanceDue: result.balanceDue,
    };
  }

  return {
    state,
    lines: lines.map((l) => ({ categoryName: l.categoryName, taxableAmount: l.taxableAmount, rate: l.rate, taxAmount: l.taxAmount })),
    totalTaxableAmount, taxableOnlyAmount, totalTax, grandTotal, mdFiling,
  };
}

calculatorsRouter.post("/sales-tax-pdf", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const data = await buildCalculatorPdfData(req.body);
  const { generateCalculatorSalesTaxPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generateCalculatorSalesTaxPdf(data);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="SalesTaxCalculation_${data.state}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

/**
 * Emails the same PDF to an address typed directly into the calculator —
 * unlike Reports' "Email Report" this has no client record to send through
 * /communications (the calculator isn't tied to one), so it calls sendEmail
 * directly. SMS/WhatsApp aren't offered here for the same reason they were
 * pulled from Reports: Twilio isn't connected in this environment.
 */
calculatorsRouter.post("/sales-tax-email", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const to = String(req.body?.to || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: "Enter a valid email address." });

  const data = await buildCalculatorPdfData(req.body);
  const { generateCalculatorSalesTaxPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generateCalculatorSalesTaxPdf(data);
  const { sendEmail, NotConfiguredError } = await import("../../common/notifications");
  const { wrapEmailHtml } = await import("../../common/emailTemplate");

  const html = await wrapEmailHtml(
    `<p>Please find attached the sales tax calculation for ${data.state}.</p>` +
    `<p>Total tax: $${data.totalTax.toFixed(2)}${data.mdFiling ? ` &middot; Balance due: $${data.mdFiling.balanceDue.toFixed(2)}` : ""}</p>`,
    req
  );

  try {
    await sendEmail({
      to, subject: `Sales Tax Calculation — ${data.state}`, html,
      attachments: [{ filename: `SalesTaxCalculation_${data.state}.pdf`, content: Buffer.from(pdfBytes), contentType: "application/pdf" }],
    });
  } catch (err) {
    if (err instanceof NotConfiguredError) return res.status(400).json({ error: err.message });
    throw err;
  }

  await logAudit("Calculators", "EMAIL_SALES_TAX_CALCULATION", data.state, "To", "", to, `Sales tax calculation emailed to ${to} by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));
