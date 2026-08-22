import Stripe from "stripe";
import { query, queryOne, withTransaction } from "../../config/db";
import { logAudit } from "../../common/audit";
import { alertAdmins } from "../../common/adminAlerts";
import { sendPaymentReceiptEmail } from "./billing.routes";

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
  let overpayBy = 0;

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
    // Unlike the manual payment path (which can simply refuse an over-cap amount
    // before any money changes hands), Stripe has already charged the card by the
    // time this runs — the checkout session was created for the balance due AT
    // LINK-CREATION TIME, so it can now exceed the invoice's current balance if
    // that balance dropped in the meantime (e.g. a manual payment landed first).
    // The payment must still be recorded in full (refusing to log real collected
    // cash would be worse), but an admin needs to know a refund may be owed.
    if (newPaid > total) overpayBy = money(newPaid - total);

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

  // Previously the one payment path with no client-facing confirmation at
  // all — a client paying by card got nothing telling them it landed. Same
  // receipt as a manually-recorded payment; no `req` available here (this
  // runs from both a page load and the unattended reconciliation sweep), so
  // the email renders with a text-only header instead of the firm logo —
  // a cosmetic tradeoff, not a functional one.
  await sendPaymentReceiptEmail({
    invoiceId: invoice.invoice_id, clientId: invoice.client_id, paymentId,
    paymentDate: new Date().toISOString().slice(0, 10), amount, method: "Card (Stripe)", balanceDue: balance,
  });

  if (overpayBy > 0) {
    await alertAdmins(
      `Stripe overpayment on invoice ${invoice.invoice_id}`,
      `A Stripe card payment of $${amount.toFixed(2)} for invoice ${invoice.invoice_id} exceeded the invoice total by $${overpayBy.toFixed(2)} — the balance had already dropped (likely a manual payment landed first) between when the checkout link was created and when the client paid. The full amount was recorded; a refund of the difference may be owed.`
    );
  }
  return true;
}

/**
 * ACC-012 (Hard Audit, 2026-08-13): settleStripePaymentIfPaid only ever ran
 * when the specific public share link was reloaded — a client who paid, then
 * closed the tab without ever bouncing back through the success_url (network
 * hiccup, closed the tab a beat early, cleared cookies before the redirect
 * landed), left their invoice "Unpaid" forever with the firm having no way to
 * find out short of manually reconciling the Stripe dashboard against the
 * invoice list. Periodic sweep closes that gap without a webhook — same
 * self-healing pull-based design as the per-request settle, just triggered on
 * a timer instead of a page load. Every invoice checked here reuses
 * settleStripePaymentIfPaid's own idempotency/locking, so running this
 * alongside a real page-load settle (or two overlapping sweeps) can't
 * double-record.
 */
export async function runStripeReconciliation(): Promise<{ checked: number; settled: number; failed: number }> {
  if (!isStripeConfigured()) return { checked: 0, settled: 0, failed: 0 };
  const invoices = await query<any>(
    `SELECT invoice_id, client_id, stripe_session_id, balance_due, total_amount FROM altax.v3_invoices
      WHERE stripe_session_id IS NOT NULL AND lower(status) NOT IN ('paid','void') AND balance_due > 0`
  );
  let settled = 0, failed = 0;
  const failedIds: string[] = [];
  for (const invoice of invoices) {
    try {
      if (await settleStripePaymentIfPaid(invoice)) settled++;
    } catch (err) {
      failed++;
      failedIds.push(invoice.invoice_id);
      // eslint-disable-next-line no-console
      console.error(`[runStripeReconciliation] failed for invoice ${invoice.invoice_id}:`, err);
    }
  }
  if (failed > 0) {
    await alertAdmins(
      "Stripe reconciliation: some invoices failed to check",
      `${failed} of ${invoices.length} invoice(s) with a pending Stripe checkout session failed to reconcile this run: ${failedIds.join(", ")}. Check the server logs for per-invoice errors (search "[runStripeReconciliation] failed for invoice").`
    );
  }
  return { checked: invoices.length, settled, failed };
}
