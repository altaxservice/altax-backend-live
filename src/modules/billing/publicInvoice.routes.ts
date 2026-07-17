/**
 * Public, no-login invoice view — the "share link" destination. Deliberately has no
 * requireAuth: the whole point is a client can open it without a portal account, the
 * same way a QuickBooks share link works. Access is gated entirely by knowing the
 * opaque share_token (24 random bytes, effectively unguessable) rather than by
 * identity — scoped to exactly one invoice, read-only, no mutation routes exist here.
 */
import { Router, Request, Response } from "express";
import { query, queryOne } from "../../config/db";
import { asyncHandler } from "../../common/asyncHandler";
import { buildInvoicePdf } from "./billing.routes";

export const publicInvoiceRouter = Router();

async function findByToken(token: string) {
  return queryOne<any>(`SELECT * FROM altax.v3_invoices WHERE share_token = $1`, [token]);
}

publicInvoiceRouter.get("/:token", asyncHandler(async (req: Request, res: Response) => {
  const invoice = await findByToken(req.params.token);
  if (!invoice) return res.status(404).json({ error: "This link is invalid or has expired." });

  const items = await query<any>(`SELECT * FROM altax.v3_invoice_line_items WHERE invoice_id = $1 ORDER BY line_no ASC`, [invoice.invoice_id]);

  res.json({
    invoice: {
      invoice_id: invoice.invoice_id, invoice_date: invoice.invoice_date, due_date: invoice.due_date,
      description: invoice.description, total_amount: invoice.total_amount, amount_paid: invoice.amount_paid,
      balance_due: invoice.balance_due, status: invoice.status, terms: invoice.terms, bill_to: invoice.bill_to,
      payment_instructions: invoice.payment_instructions, client_note: invoice.client_note,
      subtotal_amount: invoice.subtotal_amount, discount_amount: invoice.discount_amount,
      sales_tax_amount: invoice.sales_tax_amount, shipping_amount: invoice.shipping_amount,
      lineItems: items,
    },
  });
}));

publicInvoiceRouter.get("/:token/print", asyncHandler(async (req: Request, res: Response) => {
  const invoice = await findByToken(req.params.token);
  if (!invoice) return res.status(404).json({ error: "This link is invalid or has expired." });

  const built = await buildInvoicePdf(invoice.invoice_id);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="Invoice_${invoice.invoice_id}.pdf"`);
  res.send(Buffer.from(built!.pdfBytes));
}));
