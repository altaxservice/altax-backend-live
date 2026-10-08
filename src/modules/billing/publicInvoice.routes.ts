/**
 * Public, no-login invoice view — the "share link" destination. Deliberately has no
 * requireAuth: the whole point is a client can open it without a portal account, the
 * same way a QuickBooks share link works. Access is gated entirely by knowing the
 * opaque share_token (24 random bytes, effectively unguessable) rather than by
 * identity — scoped to exactly one invoice, read-only, no mutation routes exist here.
 */
import { getFirmProfile } from "../../common/firmProfile";
import { recordInvoiceView } from "../../common/invoiceEvents";
import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { query, queryOne } from "../../config/db";
import { asyncHandler } from "../../common/asyncHandler";
import { publicBaseUrl } from "../../common/publicUrl";
import { rateLimit } from "../../common/rateLimit";
import { buildInvoicePdf } from "./billing.routes";
import { isStripeConfigured, createInvoiceCheckout, settleStripePaymentIfPaid, StripeNotConfiguredError } from "./stripePayments";

export const publicInvoiceRouter = Router();

// Token entropy (24 random bytes) already makes brute-forcing impractical — this is
// defense in depth, matching the dedicated limiters on the other public share-link
// routers (publicContact, publicAppointments' manageLimiter) rather than relying
// solely on the blanket api-general limiter every route already sits behind.
const invoiceLimiter = rateLimit({ name: "public-invoice", windowMs: 15 * 60 * 1000, max: 30 });

async function findByToken(token: string) {
  return queryOne<any>(`SELECT * FROM altax.v3_invoices WHERE share_token = $1`, [token]);
}

publicInvoiceRouter.get("/:token", invoiceLimiter, asyncHandler(async (req: Request, res: Response) => {
  let invoice = await findByToken(req.params.token);
  if (!invoice) return res.status(404).json({ error: "This link is invalid or has expired." });

  // Self-healing card-payment check: if a Stripe checkout was started for this
  // invoice and it is paid, record it now — this is what turns the post-payment
  // redirect (or any later visit) into the payment actually landing in the books.
  if (await settleStripePaymentIfPaid(invoice).catch(() => false)) {
    invoice = await findByToken(req.params.token);
  }

  const items = await query<any>(`SELECT * FROM altax.v3_invoice_line_items WHERE invoice_id = $1 ORDER BY line_no ASC`, [invoice.invoice_id]);

  // "Opened by the client" — skipped for link-preview bots (email scanners, chat unfurlers) and for staff previewing
  // the page (the app adds ?preview=1 on its own Copy Share Link / View buttons).
  const ua = String(req.headers["user-agent"] || "");
  const isBot = !ua || /bot|crawl|spider|preview|slurp|facebookexternalhit|whatsapp|telegram|skypeuri|outlook|microsoft|barracuda|proofpoint|mimecast|curl|wget|python|node-fetch|axios/i.test(ua);
  // A signed-in staff member opening the link is previewing it, not the client.
  let staffPreview = false;
  const bearer = String(req.headers.authorization || "");
  if (bearer.startsWith("Bearer ")) {
    try {
      const v = jwt.verify(bearer.slice(7), process.env.JWT_SECRET as string) as { role?: string };
      staffPreview = ["admin", "staff"].includes(String(v.role || "").toLowerCase());
    } catch { /* expired or invalid token: treat as an anonymous visitor */ }
  }
  if (!isBot && !staffPreview && req.query.preview !== "1" && Number(invoice.balance_due) >= 0 && String(invoice.status || "").toLowerCase() !== "void") {
    await recordInvoiceView(invoice.invoice_id);
  }

  res.json({
    invoice: {
      invoice_id: invoice.invoice_id, invoice_date: invoice.invoice_date, due_date: invoice.due_date,
      description: invoice.description, total_amount: invoice.total_amount, amount_paid: invoice.amount_paid,
      balance_due: invoice.balance_due, status: invoice.status, terms: invoice.terms, bill_to: invoice.bill_to,
      payment_instructions: invoice.payment_instructions, card_payment_link: invoice.card_payment_link || null, client_note: invoice.client_note,
      subtotal_amount: invoice.subtotal_amount, discount_amount: invoice.discount_amount,
      sales_tax_amount: invoice.sales_tax_amount, shipping_amount: invoice.shipping_amount,
      lineItems: items,
    },
    // The Pay button only renders when Stripe is actually connected — a button
    // that errors "not configured" at a CLIENT is worse than no button.
    cardPaymentsEnabled: isStripeConfigured(),
    // The firm's Zelle phone number, shown with the payment instructions ("Zelle by phone number: …").
    zellePhone: (await getFirmProfile()).zellePhone || null,
  });
}));

/**
 * Starts a Stripe hosted checkout for this invoice's balance. Unauthenticated
 * like the rest of this router — gated by the share token, and the only thing
 * it can do is send money TO the firm for exactly this invoice.
 */
publicInvoiceRouter.post("/:token/checkout", invoiceLimiter, asyncHandler(async (req: Request, res: Response) => {
  const invoice = await findByToken(req.params.token);
  if (!invoice) return res.status(404).json({ error: "This link is invalid or has expired." });
  if (Number(invoice.balance_due) <= 0) return res.status(400).json({ error: "This invoice is already paid — thank you!" });

  const base = publicBaseUrl(req);
  if (!base) return res.status(500).json({ error: "Could not determine this site's address for the payment redirect." });

  try {
    const { url } = await createInvoiceCheckout(invoice, req.params.token, base);
    res.json({ url });
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) return res.status(503).json({ error: err.message });
    throw err;
  }
}));

publicInvoiceRouter.get("/:token/print", invoiceLimiter, asyncHandler(async (req: Request, res: Response) => {
  const invoice = await findByToken(req.params.token);
  if (!invoice) return res.status(404).json({ error: "This link is invalid or has expired." });

  const built = await buildInvoicePdf(invoice.invoice_id);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="Invoice_${invoice.invoice_id}.pdf"`);
  res.send(Buffer.from(built!.pdfBytes));
}));
