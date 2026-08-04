import Stripe from "stripe";
import { query, queryOne, withTransaction } from "../../config/db";
import { logAudit } from "../../common/audit";

/**
 * Card payment on the public invoice link, via Stripe Checkout.
 *
 * Stripe's HOSTED checkout page is used on purpose: the card number is typed on
 * stripe.com, never on this app, which keeps this codebase entirely out of PCI
 * card-data scope. We create a Checkout Session for the invoice's balance, send
 * the client to Stripe, and Stripe sends them back to the same share link.
 *
 * Recording is pull-based, not webhook-based: whenever the public invoice is
 * loaded (including the post-payment redirect), we ask Stripe for the session's
 * status server-side and record the payment if it is paid. That trades webhook
 * setup friction (an endpoint + signing secret to configure in the dashboard)
 * for a self-healing check — a client who pays and closes the tab is recorded
 * the next time anyone opens the invoice. Verification always happens
 * server-to-Stripe with the secret key, so a client cannot forge "I paid" by
 * editing a URL.
 *
 * Gated on STRIPE_SECRET_KEY exactly like email (Resend) and SMS (Twilio):
 * absent key = feature dark, clear message, nothing breaks.
 */

export class StripeNotConfiguredError extends Error {}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new StripeNotConfiguredError(
      "Card payments are not connected yet — add STRIPE_SECRET_KEY to the backend environment to enable them."
    );
  }
  return new Stripe(key);
}

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

/** Creates a hosted-checkout session for the invoice's open balance and remembers its id on the invoice. */
export async function createInvoiceCheckout(invoice: any, shareToken: string, baseUrl: string): Promise<{ url: string }> {
  const stripe = stripeClient();
  const balance = money(invoice.balance_due ?? invoice.total_amount);
  if (balance <= 0) throw new Error("This invoice has no balance due.");

  const publicUrl = `${baseUrl}/public/invoice/${shareToken}`;
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: Math.round(balance * 100),
        product_data: {
          name: `Invoice ${invoice.invoice_id}`,
          description: String(invoice.description || "").slice(0, 200) || undefined,
        },
      },
    }],
    metadata: { invoice_id: String(invoice.invoice_id) },
    success_url: `${publicUrl}?paid=1`,
    cancel_url: publicUrl,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");

  await query(`UPDATE altax.v3_invoices SET stripe_session_id = $2, updated_at = now() WHERE invoice_id = $1`,
    [invoice.invoice_id, session.id]);
  return { url: session.url };
}

/**
 * If the invoice's remembered checkout session is paid and not yet recorded,
 * records the payment and settles the invoice. Idempotent: the session id is
 * the payment's confirmation number, and an existing payment with that
 * confirmation short-circuits — loading the page twice can never double-pay.
 * Returns true when a new payment was recorded.
 */
export async function settleStripePaymentIfPaid(invoice: any): Promise<boolean> {
  if (!isStripeConfigured()) return false;
  if (!invoice.stripe_session_id) return false;
  if (money(invoice.balance_due) <= 0) return false;

  const already = await queryOne<any>(
    `SELECT 1 FROM altax.v3_payments WHERE confirmation_number = $1`, [invoice.stripe_session_id]
  );
  if (already) return false;

  const stripe = stripeClient();
  const session = await stripe.checkout.sessions.retrieve(invoice.stripe_session_id);
  if (session.payment_status !== "paid") return false;
  if (session.metadata?.invoice_id !== String(invoice.invoice_id)) return false;

  const amount = money((session.amount_total ?? 0) / 100);
  const paymentId = `PMT-STRIPE-${Date.now()}`;
  let recorded = false;
  let newPaid = 0, balance = 0, status = "";

  await withTransaction(async (db) => {
    // Lock the invoice row and re-check idempotency under it — the public
    // invoice link can be loaded (or "back"-button-reloaded) more than once
    // right after a successful payment, and the plain checks above raced past
    // each other on separate connections; this makes the whole
    // check-then-insert-then-update sequence atomic per invoice, closing both
    // the double-record risk and the same amount_paid lost-update pattern
    // already fixed in POST /invoices/:invoiceId/payments.
    const locked = await db.query<any>(`SELECT amount_paid, total_amount FROM altax.v3_invoices WHERE invoice_id = $1 FOR UPDATE`, [invoice.invoice_id]);
    if (!locked.length) return;
    const stillUnrecorded = await db.query<any>(`SELECT 1 FROM altax.v3_payments WHERE confirmation_number = $1`, [invoice.stripe_session_id]);
    if (stillUnrecorded.length) return;

    const total = money(locked[0].total_amount);
    newPaid = money(Number(locked[0].amount_paid || 0) + amount);
    balance = Math.max(0, money(total - newPaid));
    status = balance <= 0 ? "Paid" : "Partial";

    await db.query(
      `INSERT INTO altax.v3_payments
         (payment_id, invoice_id, task_id, client_id, payment_date, expected_amount, actual_amount, method,
          confirmation_number, notes, status, reversal_reason, source_system, source_record_id)
       VALUES ($1,$2,NULL,$3,now(),$4,$5,'Card (Stripe)',$6,$7,'Active','','Stripe Checkout',$1)`,
      [paymentId, invoice.invoice_id, invoice.client_id, money(invoice.balance_due), amount,
        invoice.stripe_session_id, `Paid online via the invoice share link.`]
    );
    await db.query(
      `UPDATE altax.v3_invoices SET amount_paid = $2, balance_due = $3, status = $4, updated_at = now() WHERE invoice_id = $1`,
      [invoice.invoice_id, newPaid, balance, status]
    );
    recorded = true;
  });
  if (!recorded) return false;

  await logAudit("Billing", "STRIPE_PAYMENT", paymentId, "Invoice", invoice.invoice_id, String(amount),
    `Card payment of $${amount.toFixed(2)} received via Stripe Checkout for invoice ${invoice.invoice_id} (${status}).`,
    "Stripe Checkout");
  return true;
}
