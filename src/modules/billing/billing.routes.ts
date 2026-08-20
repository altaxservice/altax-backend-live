import { Router, Response } from "express";
import crypto from "crypto";
import { query, queryOne, withTransaction, type DbClient } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient, getUserAliases } from "../../common/assignment";
import { resolvePaymentMethod, postInvoiceTotalGl, postInvoicePaymentGl } from "../../common/accountingHelpers";
import { composeAddress } from "../../common/address";
import { lookupSalesTaxRate } from "../../common/taxRates";
import { encryptValue } from "../../common/encryption";
import { reserveIdempotencyKey, saveIdempotencyResponse } from "../../common/idempotency";

/**
 * Billing module — Phase 5. Covers invoices, payments, and recurring billing. Ported
 * from alTaxPortalCreateInvoice, alTaxPortalUpdateInvoice, alTaxPortalVoidInvoice,
 * alTaxPortalRecordPayment, v3ReverseInvoicePayment, alTaxPortalSaveRecurringBilling,
 * alTaxPortalArchiveRecurringBilling, alTaxPortalRunRecurringBilling, and the
 * access-control helper alTaxV5PortalInvoiceAllowed_. Payment Methods now lives in
 * its own module (src/modules/paymentMethods) since it needed field-level encryption,
 * not because it's less related.
 *
 * Deliberately NOT ported:
 * - alTaxPortalDeleteInvoice: hard row delete, confirm-text-gated but still
 *   irreversible on financial records — void is the safe, reversible substitute,
 *   same reasoning as every other hard-delete skipped this session.
 *
 * alTaxPortalSendInvoice and the AutoSendInvoice branch of recurring billing (both
 * previously skipped for lack of email infra) are now built: POST /invoices/:id/send
 * (email via Resend, SMS/WhatsApp via Twilio — see ../../common/notifications.ts) and
 * the auto-send step inside POST /recurring/run. Each provider is independently
 * gated on its own env vars and fails per-channel with a clear "not configured"
 * message rather than blocking the others or crashing the request.
 *
 * "Run recurring billing" is a MANUAL-TRIGGER endpoint (POST /billing/recurring/run),
 * not a scheduled job — legacy's alTaxPortalRunRecurringBilling was itself designed
 * to be safely callable on demand (it's idempotent: alTaxV5InvoiceSourceExists_ stops
 * it from double-invoicing the same period) or from a trigger; this backend has no
 * cron/scheduler, so it's exposed as something staff (or a real scheduler, later) can
 * call. AutoCollectPayment is rejected outright, exactly like legacy ("This module
 * only auto-creates invoices") — no payment processor is wired up here.
 *
 * One intentional deviation from legacy: alTaxPortalRecordPayment (the portal/API path)
 * does not cap AmountPaid at TotalAmount — only the older sheet-UI path
 * (v3RecordInvoicePayment) rejects a payment that would push AmountPaid over the
 * invoice total. Allowing the portal to silently record more payment than an invoice
 * is worth looks like a defect, not an intended feature (per plan rule #1, defects are
 * the one case "preserve existing behavior" doesn't apply to) — this port enforces the
 * cap the way the sheet UI already does.
 */
export const billingRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}
function nextInvoiceId(): string {
  return `INV-${idSuffix()}`;
}
function nextPaymentId(): string {
  return `PAY-${idSuffix()}`;
}

function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** v3_invoices has no client_name column of its own — routes that only load the invoice row (void, payments, reverse, patch) need this for GL posting. */
async function getClientName(clientId: string): Promise<string> {
  const row = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  return row?.client_name || "";
}

/**
 * Mirrors alTaxV5PortalInvoiceAllowed_: used to gate mutations (edit/void/record
 * payment) AND the single-invoice view route below, for every role except client
 * (which has its own explicit clientId-match check at each call site instead).
 * Employees are explicitly excluded here rather than falling through to
 * canAccessClient — that helper treats "employee" like "client" (matches their
 * own linked clientId), which is correct for an employee viewing their OWN
 * paystub, but wrong here: an employee has no billing relationship with the
 * firm at all, only their employer does, and previously fell through to being
 * granted read access to their employer's invoices if they had/guessed a
 * specific invoice ID (caught live, along with the same info being needlessly
 * exposed on the frontend — see Layout.tsx/App.tsx's billing nav/route fixes).
 */
async function canMutateInvoice(user: NonNullable<AuthedRequest["user"]>, invoice: any): Promise<boolean> {
  if (user.role === "admin") return true;
  if (user.role === "client" || user.role === "employee") return false;
  return canAccessClient(user, invoice.client_id);
}

/**
 * Paid/Void are terminal — canMutateInvoice only checks role/access, never status, so
 * without this a Paid or Void invoice's total/line items/amount-paid could be silently
 * rewritten with no ledger cross-check to catch the discrepancy (the GL postings in
 * postInvoiceTotalGl/postInvoicePaymentGl above are keyed to the delta at edit time, so
 * they'd still balance individually, but the invoice's own historical record — what a
 * client was actually billed and told they'd paid — would no longer match what was
 * originally issued). Mirrors isPaycheckLockedForEdit's same "create a corrected one
 * instead" rule for locked paychecks.
 */
const INVOICE_LOCKED_STATUSES = ["paid", "void"];
function isInvoiceLockedForEdit(invoice: any): boolean {
  return INVOICE_LOCKED_STATUSES.includes(String(invoice?.status || "").trim().toLowerCase());
}

interface LineItemInput {
  serviceDate?: string; productId?: string; productName?: string; description?: string;
  quantity?: number; rate?: number; taxable?: boolean;
}

// lookupSalesTaxRate (best-effort rate for the "Automatic Calculation" option on the
// line-item invoice editor) now lives in ../../common/taxRates — shared with the
// standalone sales tax calculator so both draw from the exact same v3_tax_rates lookup.

/**
 * Only the aggregate total was ever checked (total <= 0) — a negative quantity or
 * rate could hide inside a positive-total invoice (e.g. two lines, one legitimate,
 * one negative, netting to a plausible-looking total) since computeInvoiceTotals
 * just sums whatever it's given. Called before computeInvoiceTotals at every
 * caller that accepts caller-supplied line items.
 */
function validateLineItems(lineItems: LineItemInput[]): string | null {
  for (const li of lineItems) {
    if (Number(li.quantity ?? 1) < 0) return "Line item quantity cannot be negative.";
    if (money(li.rate) < 0) return "Line item rate cannot be negative.";
  }
  return null;
}

/** Shared subtotal/tax/total math for both create and edit — one line-item invoice contract. */
function computeInvoiceTotals(lineItems: LineItemInput[], opts: { discountPercent: number; discountAmount: number; salesTaxRate: number; shippingAmount: number }) {
  const normalized = lineItems.map((li) => ({
    ...li,
    quantity: Number(li.quantity ?? 1) || 1,
    rate: money(li.rate),
    taxable: li.taxable !== false,
  }));
  const lineAmounts = normalized.map((li) => money(li.quantity * li.rate));
  const subtotal = money(lineAmounts.reduce((s, a) => s + a, 0));
  const taxableSubtotal = money(normalized.reduce((s, li, i) => s + (li.taxable ? lineAmounts[i] : 0), 0));
  const discountAmount = opts.discountPercent > 0 ? money(subtotal * (opts.discountPercent / 100)) : money(opts.discountAmount);
  const salesTaxAmount = money(taxableSubtotal * (opts.salesTaxRate / 100));
  const total = money(subtotal - discountAmount + salesTaxAmount + money(opts.shippingAmount));
  return { normalized, lineAmounts, subtotal, taxableSubtotal, discountAmount, salesTaxAmount, total };
}

async function replaceLineItems(invoiceId: string, normalized: LineItemInput[], lineAmounts: number[]) {
  await query(`DELETE FROM altax.v3_invoice_line_items WHERE invoice_id = $1`, [invoiceId]);
  let lineNo = 0;
  for (const li of normalized) {
    lineNo++;
    await query(
      `INSERT INTO altax.v3_invoice_line_items
         (line_item_id, invoice_id, line_no, service_date, product_id, product_name, description, quantity, rate, amount, taxable)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        `LI-${idSuffix()}-${lineNo}`, invoiceId, lineNo, String(li.serviceDate || "").trim() || null,
        String(li.productId || "").trim() || null, String(li.productName || "").trim() || null,
        String(li.description || "").trim() || null, li.quantity, li.rate, lineAmounts[lineNo - 1], li.taxable,
      ]
    );
  }
}

/**
 * Create an invoice — ported from alTaxPortalCreateInvoice, extended with line-item
 * invoicing (see module doc comment: legacy stored one description + one total per
 * invoice; this app now supports a QuickBooks-style itemized invoice at the user's
 * request). Client and employee roles are blocked; staff must have access to the
 * target client. Passing a `lineItems` array computes subtotal/tax/total server-side;
 * omitting it falls back to the old single totalAmount path for callers that don't
 * need line items (e.g. internal scripts).
 */
billingRouter.post("/invoices", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const clientId = String(body.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "clientId is required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }

  const client = await queryOne<any>(`SELECT client_id, client_name, state, address, email, phone, client_type FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const invoiceId = nextInvoiceId();
  const invoiceDate = String(body.invoiceDate || "").trim() || null;
  const dueDate = String(body.dueDate || "").trim() || invoiceDate;
  const lineItems: LineItemInput[] = Array.isArray(body.lineItems) ? body.lineItems : [];

  let total: number, subtotal: number, taxableSubtotal: number, discountAmount: number, salesTaxAmount: number, salesTaxRate: number;
  let normalized: LineItemInput[] = [];
  let lineAmounts: number[] = [];

  if (lineItems.length > 0) {
    const lineItemError = validateLineItems(lineItems);
    if (lineItemError) return res.status(400).json({ error: lineItemError });
    salesTaxRate = body.autoTax ? await lookupSalesTaxRate(client.state) : money(body.salesTaxRate);
    const computed = computeInvoiceTotals(lineItems, {
      discountPercent: money(body.discountPercent), discountAmount: money(body.discountAmount),
      salesTaxRate, shippingAmount: money(body.shippingAmount),
    });
    ({ subtotal, taxableSubtotal, discountAmount, salesTaxAmount, total, normalized, lineAmounts } = computed);
    if (total <= 0) return res.status(400).json({ error: "Invoice total must be greater than zero." });
  } else {
    total = money(body.totalAmount ?? body.amount);
    if (total <= 0) return res.status(400).json({ error: "Invoice amount must be greater than zero." });
    subtotal = total; taxableSubtotal = 0; discountAmount = 0; salesTaxAmount = 0; salesTaxRate = 0;
  }

  const paid = money(body.amountPaid);
  const deposit = money(body.depositAmount);
  const balance = Math.max(0, total - paid - deposit);
  const status = String(body.status || (balance <= 0 ? "Paid" : paid + deposit > 0 ? "Partial" : "Unpaid")).trim();
  const description = String(body.description || "Service invoice").trim();
  const billTo = String(body.billTo || client.address || "").trim() || null;
  const shipToStreet = String(body.shipToStreet || "").trim() || null;
  const shipToCity = String(body.shipToCity || "").trim() || null;
  const shipToState = String(body.shipToState || "").trim() || null;
  const shipToZip = String(body.shipToZip || "").trim() || null;
  const shipToStructured = [shipToStreet, shipToCity, shipToState, shipToZip].some(Boolean);
  const shipTo = shipToStructured
    ? composeAddress({ street: shipToStreet, city: shipToCity, state: shipToState, zip: shipToZip })
    : (String(body.shipTo || body.billTo || client.address || "").trim() || null);

  await withTransaction(async (db) => {
    await db.query(
      `INSERT INTO altax.v3_invoices
         (invoice_id, client_id, invoice_date, due_date, description, total_amount, amount_paid,
          balance_due, status, pdf_link, terms, customer_type, bill_to, ship_to, ship_from,
          payment_instructions, client_note, internal_note, subtotal_amount, discount_percent,
          discount_amount, taxable_subtotal, sales_tax_rate, sales_tax_amount, shipping_amount,
          deposit_amount, ship_via, shipping_date, tracking_number, source_system, source_record_id,
          ship_to_street, ship_to_city, ship_to_state, ship_to_zip)
       VALUES ($1,$2,COALESCE($3,now()),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,'Node Web App',$1,$30,$31,$32,$33)`,
      [
        invoiceId, clientId, invoiceDate, dueDate, description, total, paid, balance, status,
        String(body.pdfLink || "").trim() || null, String(body.terms || "").trim() || null,
        String(body.customerType || client.client_type || "").trim() || null, billTo, shipTo,
        String(body.shipFrom || "").trim() || null, String(body.paymentInstructions || "").trim() || null,
        String(body.clientNote || "").trim() || null, String(body.internalNote || "").trim() || null,
        subtotal, money(body.discountPercent) || null, discountAmount || null, taxableSubtotal || null,
        salesTaxRate || null, salesTaxAmount || null, money(body.shippingAmount) || null, deposit || null,
        String(body.shipVia || "").trim() || null, String(body.shippingDate || "").trim() || null,
        String(body.trackingNumber || "").trim() || null,
        shipToStreet, shipToCity, shipToState, shipToZip,
      ]
    );

    // Dr Accounts Receivable / Cr Sales Revenue for the full invoice — then, if any
    // amount is already paid/deposited as of creation (the caller front-loaded it
    // instead of using the separate record-payment endpoint), also post the cash
    // side so AR still nets down to the real balance due.
    await postInvoiceTotalGl(clientId, client.client_name, invoiceId, invoiceDate, total, db);
    if (paid + deposit > 0) {
      await postInvoicePaymentGl(clientId, client.client_name, invoiceId, invoiceDate, paid + deposit, false, db);
    }
  });

  if (normalized.length > 0) await replaceLineItems(invoiceId, normalized, lineAmounts);

  await logAudit("Billing", "CREATE_INVOICE", invoiceId, "", "", String(total), `Invoice created by ${req.user!.email}.`, req.user!.email);

  res.status(201).json({ ok: true, invoiceId, totalAmount: total, amountPaid: paid, balanceDue: balance, status });
}));

/**
 * Time-and-materials billing: roll every unbilled, billable, Approved time entry
 * for a client into one new invoice — one line item per entry (service_date =
 * entry_date, rate = the entry's own hourly_rate, quantity = hours). Only
 * Approved entries qualify (not merely Submitted) since a submitted-but-not-yet-
 * reviewed entry could still be edited or rejected; billing it first would mean
 * un-billing it later. Reuses the exact same computeInvoiceTotals/replaceLineItems/
 * postInvoiceTotalGl path POST /invoices already uses, so a time-based invoice is
 * indistinguishable from one built by hand in the line-item editor.
 */
/** Whether a client has unbilled, Approved, billable time worth invoicing — powers the "Create Invoice from Unbilled Time" button on the client's Billing tab without exposing the full per-staff time-tracking list (a separate, more restricted module). */
billingRouter.get("/invoices/from-time/preview", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.query.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "clientId is required." });
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const row = await queryOne<any>(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(hours * COALESCE(hourly_rate,0)), 0) AS amount
       FROM altax.v3_time_entries
      WHERE client_id = $1 AND billable = true AND billed = false AND status = 'Approved'`,
    [clientId]
  );
  res.json({ count: Number(row?.count || 0), amount: Number(row?.amount || 0) });
}));

billingRouter.post("/invoices/from-time", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.body?.clientId || req.query.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "clientId is required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT client_id, client_name, state, address, client_type FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const entries = await query<any>(
    `SELECT * FROM altax.v3_time_entries
      WHERE client_id = $1 AND billable = true AND billed = false AND status = 'Approved'
      ORDER BY entry_date ASC`,
    [clientId]
  );
  if (!entries.length) return res.status(400).json({ error: "No approved, unbilled billable time for this client." });
  if (entries.some((e: any) => !(Number(e.hourly_rate) > 0))) {
    return res.status(400).json({ error: "Every billable entry needs an hourly rate before it can be invoiced." });
  }

  // entry_date comes back from pg as a JS Date object (DATE column) — stringifying it
  // directly (via String()/template literals) produces "...GMT-0400 (...)", which
  // Postgres then rejects trying to parse it back as a date. Format explicitly instead.
  const lineItems: LineItemInput[] = entries.map((e: any) => ({
    serviceDate: e.entry_date instanceof Date ? e.entry_date.toISOString().slice(0, 10) : String(e.entry_date).slice(0, 10),
    description: e.description || `Time — ${e.user_email}`,
    quantity: Number(e.hours), rate: Number(e.hourly_rate), taxable: false,
  }));
  const { normalized, lineAmounts, subtotal, taxableSubtotal, salesTaxAmount, total } = computeInvoiceTotals(
    lineItems, { discountPercent: 0, discountAmount: 0, salesTaxRate: 0, shippingAmount: 0 }
  );

  const invoiceId = nextInvoiceId();
  const invoiceDate = new Date().toISOString().slice(0, 10);

  await withTransaction(async (db) => {
    await db.query(
      `INSERT INTO altax.v3_invoices
         (invoice_id, client_id, invoice_date, due_date, description, total_amount, amount_paid,
          balance_due, status, customer_type, bill_to, subtotal_amount, taxable_subtotal,
          sales_tax_amount, source_system, source_record_id)
       VALUES ($1,$2,$3,$3,$4,$5,0,$5,'Unpaid',$6,$7,$8,$9,$10,'Node Web App',$1)`,
      [
        invoiceId, clientId, invoiceDate, `Time & materials — ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`,
        total, String(client.client_type || "").trim() || null, client.address || null,
        subtotal, taxableSubtotal || null, salesTaxAmount || null,
      ]
    );
    await postInvoiceTotalGl(clientId, client.client_name, invoiceId, invoiceDate, total, db);
    await db.query(
      `UPDATE altax.v3_time_entries SET billed = true, invoice_id = $2, updated_at = now() WHERE time_entry_id = ANY($1::text[])`,
      [entries.map((e: any) => e.time_entry_id), invoiceId]
    );
  });

  await replaceLineItems(invoiceId, normalized, lineAmounts);

  await logAudit("Billing", "CREATE_INVOICE_FROM_TIME", invoiceId, "", "", String(total),
    `Invoice created from ${entries.length} time entries by ${req.user!.email}.`, req.user!.email);

  res.status(201).json({ ok: true, invoiceId, totalAmount: total, entryCount: entries.length });
}));

/**
 * List invoices — admin sees all; client sees only their own client's invoices
 * (viewing is allowed for client role even though editing is not — the legacy access
 * helper only gates mutations); staff/general see invoices for clients they have task
 * access to; employee sees none (not surfaced to that role anywhere in legacy billing).
 */
billingRouter.get("/invoices", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const role = req.user!.role;

  if (role === "admin") {
    const rows = await query(`SELECT * FROM altax.v3_invoices ORDER BY invoice_date DESC NULLS LAST`);
    return res.json({ invoices: rows });
  }
  if (role === "client") {
    const rows = await query(`SELECT * FROM altax.v3_invoices WHERE client_id = $1 ORDER BY invoice_date DESC NULLS LAST`, [req.user!.clientId]);
    return res.json({ invoices: rows });
  }
  if (role === "employee") {
    return res.json({ invoices: [] });
  }

  const aliases = await getUserAliases(req.user!.email);
  const rows = await query(
    `SELECT * FROM altax.v3_invoices
      WHERE client_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($1::text[]))
      ORDER BY invoice_date DESC NULLS LAST`,
    [Array.from(aliases)]
  );
  res.json({ invoices: rows });
}));

/** Single invoice — client may view their own; admin/staff scoped via canMutateInvoice. */
billingRouter.get("/invoices/:invoiceId", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await queryOne<any>(`SELECT * FROM altax.v3_invoices WHERE invoice_id = $1`, [req.params.invoiceId]);
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });

  const role = req.user!.role;
  const allowed = role === "client" ? invoice.client_id === req.user!.clientId : await canMutateInvoice(req.user!, invoice);
  if (!allowed) return res.status(403).json({ error: "You do not have access to this invoice." });

  const lineItems = await query(`SELECT * FROM altax.v3_invoice_line_items WHERE invoice_id = $1 ORDER BY line_no ASC`, [req.params.invoiceId]);
  res.json({ invoice: { ...invoice, lineItems } });
}));

/** Payments recorded against one invoice — same visibility rule as the invoice itself. */
billingRouter.get("/invoices/:invoiceId/payments", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await queryOne<any>(`SELECT * FROM altax.v3_invoices WHERE invoice_id = $1`, [req.params.invoiceId]);
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });

  const role = req.user!.role;
  const allowed = role === "client" ? invoice.client_id === req.user!.clientId : await canMutateInvoice(req.user!, invoice);
  if (!allowed) return res.status(403).json({ error: "You do not have access to this invoice." });

  const rows = await query<any>(`SELECT * FROM altax.v3_payments WHERE invoice_id = $1 ORDER BY payment_date DESC NULLS LAST`, [req.params.invoiceId]);
  // Reachable by the client role for their own invoice — never send full bank
  // routing/account numbers (or ciphertext of them) down to any portal.
  const payments = rows.map(({ payment_routing_number, payment_account_number, ...rest }) => rest);
  res.json({ payments });
}));

/**
 * Shared PDF builder — used by the authenticated print route, the public share-link
 * print route, and the email-send route (as an attachment), so all three always
 * render byte-identical output instead of drifting apart.
 */
export async function buildInvoicePdf(invoiceId: string): Promise<{ invoice: any; client: any; pdfBytes: Uint8Array } | null> {
  const invoice = await queryOne<any>(`SELECT * FROM altax.v3_invoices WHERE invoice_id = $1`, [invoiceId]);
  if (!invoice) return null;
  const client = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [invoice.client_id]);
  const payments = await query<any>(`SELECT * FROM altax.v3_payments WHERE invoice_id = $1 AND lower(status) <> 'reversed' ORDER BY payment_date ASC NULLS LAST`, [invoiceId]);
  const lineItems = await query<any>(
    `SELECT li.*, ps.category AS product_category FROM altax.v3_invoice_line_items li
       LEFT JOIN altax.v3_products_services ps ON ps.product_id = li.product_id
      WHERE li.invoice_id = $1 ORDER BY li.line_no ASC`,
    [invoiceId]
  );

  const { generateInvoicePdf } = await import("./invoicePdf");
  const pdfBytes = await generateInvoicePdf({
    invoiceId: invoice.invoice_id, invoiceDate: invoice.invoice_date, dueDate: invoice.due_date,
    description: invoice.description, totalAmount: Number(invoice.total_amount), amountPaid: Number(invoice.amount_paid),
    balanceDue: Number(invoice.balance_due), status: invoice.status,
    clientName: client?.client_name || invoice.client_id, clientAddress: client?.address || null,
    clientEmail: client?.email || null, clientPhone: client?.phone || null,
    payments: payments.map((p) => ({ paymentDate: p.payment_date, actualAmount: Number(p.actual_amount), method: p.method })),
    terms: invoice.terms, billTo: invoice.bill_to, shipTo: invoice.ship_to, paymentInstructions: invoice.payment_instructions, clientNote: invoice.client_note,
    shipVia: invoice.ship_via, shippingDate: invoice.shipping_date, trackingNumber: invoice.tracking_number,
    lineItems: lineItems.map((li) => ({
      serviceDate: li.service_date, productName: li.product_name, productCategory: li.product_category, description: li.description,
      quantity: Number(li.quantity), rate: Number(li.rate), amount: Number(li.amount), taxable: li.taxable !== false,
    })),
    subtotalAmount: invoice.subtotal_amount != null ? Number(invoice.subtotal_amount) : null,
    discountAmount: invoice.discount_amount != null ? Number(invoice.discount_amount) : null,
    salesTaxAmount: invoice.sales_tax_amount != null ? Number(invoice.sales_tax_amount) : null,
    shippingAmount: invoice.shipping_amount != null ? Number(invoice.shipping_amount) : null,
    depositAmount: invoice.deposit_amount != null ? Number(invoice.deposit_amount) : null,
  });
  return { invoice, client, pdfBytes };
}

/** Invoice PDF — see invoicePdf.ts. Same visibility rule as viewing the invoice itself. */
billingRouter.get("/invoices/:invoiceId/print", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await queryOne<any>(`SELECT * FROM altax.v3_invoices WHERE invoice_id = $1`, [req.params.invoiceId]);
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });

  const role = req.user!.role;
  const allowed = role === "client" ? invoice.client_id === req.user!.clientId : await canMutateInvoice(req.user!, invoice);
  if (!allowed) return res.status(403).json({ error: "You do not have access to this invoice." });

  const built = await buildInvoicePdf(req.params.invoiceId);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="Invoice_${invoice.invoice_id}.pdf"`);
  res.send(Buffer.from(built!.pdfBytes));
}));

/**
 * Send an invoice by email/SMS/WhatsApp — built at the user's explicit request
 * (previously deferred; see module doc comment history). Each requested channel is
 * attempted independently and its own success/failure is returned, so one missing
 * provider (e.g. Twilio not configured) doesn't block the others (e.g. email still
 * sends). Requires "view before send": the frontend always shows the same PDF via
 * GET /invoices/:id/print before this route can be reached.
 */
/**
 * Branded HTML body for outbound invoice emails — the staff-typed message on top,
 * a small invoice-summary card, and a "PDF attached" note, all inside the same
 * wrapEmailHtml shell (dark header + firm footer) the reminder emails use. Built
 * at the user's request so the email around the invoice looks as professional as
 * the invoice PDF itself. Shared by the manual send route and recurring auto-send.
 */
async function invoiceEmailHtml(opts: {
  message: string; invoiceId: string; invoiceDate: string | null; dueDate: string | null; balanceDue: number; req?: AuthedRequest;
}): Promise<string> {
  const { wrapEmailHtml } = await import("../../common/emailTemplate");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmtDate = (v: string | null) => {
    if (!v) return "—";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "—" : `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
  };
  const row = (label: string, labelAr: string, value: string, boldValue = false) => `
    <tr>
      <td style="padding:6px 0; color:#6b7280; font-size:13px;">${label} <bdi dir="rtl" style="color:#9ca3af;">/ ${labelAr}</bdi></td>
      <td align="right" style="padding:6px 0; font-size:13px; ${boldValue ? "font-weight:700; font-size:15px;" : ""}">${value}</td>
    </tr>`;
  const body = `
    <p style="margin:0 0 18px;">${esc(opts.message).replace(/\n/g, "<br/>")}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#f8fafb; border:1px solid #e5e7eb; border-left:3px solid #0f766e; border-radius:6px; margin:0 0 18px;">
      <tr><td style="padding:14px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${row("Invoice #", "رقم الفاتورة", esc(opts.invoiceId))}
          ${row("Invoice Date", "تاريخ الفاتورة", fmtDate(opts.invoiceDate))}
          ${row("Due Date", "تاريخ الاستحقاق", fmtDate(opts.dueDate))}
          ${row("Balance Due", "الرصيد المستحق", `$${Number(opts.balanceDue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, true)}
        </table>
      </td></tr>
    </table>
    <p style="margin:0; color:#6b7280; font-size:12.5px;">The full invoice is attached to this email as a PDF. <bdi dir="rtl">الفاتورة الكاملة مرفقة بهذه الرسالة بصيغة PDF.</bdi></p>`;
  return wrapEmailHtml(body, opts.req);
}

/**
 * No "payment received" confirmation existed anywhere — recording a manual
 * payment or a Sales Receipt updated the invoice and posted the GL entry,
 * but the client was never told their payment actually landed. Same
 * building blocks as invoiceEmailHtml above (bilingual EN/AR, same visual
 * shape) so it reads as part of the same system, not a bolted-on extra.
 */
async function paymentReceiptEmailHtml(opts: {
  invoiceId: string; paymentDate: string | null; amount: number; method: string; balanceDue: number; req?: AuthedRequest;
}): Promise<string> {
  const { wrapEmailHtml } = await import("../../common/emailTemplate");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmtDate = (v: string | null) => {
    if (!v) return "—";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "—" : `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
  };
  const money2 = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const row = (label: string, labelAr: string, value: string, boldValue = false) => `
    <tr>
      <td style="padding:6px 0; color:#6b7280; font-size:13px;">${label} <bdi dir="rtl" style="color:#9ca3af;">/ ${labelAr}</bdi></td>
      <td align="right" style="padding:6px 0; font-size:13px; ${boldValue ? "font-weight:700; font-size:15px;" : ""}">${value}</td>
    </tr>`;
  const body = `
    <p style="margin:0 0 18px;">Thank you — we've received your payment. <bdi dir="rtl" style="color:#9ca3af;">/ شكراً — تم استلام دفعتك.</bdi></p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#f8fafb; border:1px solid #e5e7eb; border-left:3px solid #0f766e; border-radius:6px; margin:0 0 18px;">
      <tr><td style="padding:14px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${row("Invoice #", "رقم الفاتورة", esc(opts.invoiceId))}
          ${row("Payment Date", "تاريخ الدفع", fmtDate(opts.paymentDate))}
          ${row("Amount Received", "المبلغ المستلم", money2(opts.amount), true)}
          ${row("Method", "طريقة الدفع", esc(opts.method))}
          ${row("Remaining Balance", "الرصيد المتبقي", money2(opts.balanceDue))}
        </table>
      </td></tr>
    </table>
    <p style="margin:0; color:#6b7280; font-size:12.5px;">${opts.balanceDue > 0 ? "This is a partial payment — the balance above is still outstanding." : "This invoice is now paid in full."} <bdi dir="rtl">${opts.balanceDue > 0 ? "هذه دفعة جزئية — الرصيد أعلاه لا يزال مستحقاً." : "تم دفع هذه الفاتورة بالكامل."}</bdi></p>`;
  return wrapEmailHtml(body, opts.req);
}

billingRouter.post("/invoices/:invoiceId/send", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await queryOne<any>(`SELECT * FROM altax.v3_invoices WHERE invoice_id = $1`, [req.params.invoiceId]);
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });
  if (!(await canMutateInvoice(req.user!, invoice))) {
    return res.status(403).json({ error: "You do not have access to this invoice." });
  }

  const body = req.body || {};
  const channels: string[] = Array.isArray(body.channels) ? body.channels : [];
  if (channels.length === 0) return res.status(400).json({ error: "Select at least one channel to send with." });

  const { sendEmail, sendSms, sendWhatsApp, parseEmailList } = await import("../../common/notifications");
  const built = await buildInvoicePdf(req.params.invoiceId);
  const subject = String(body.subject || `Invoice ${invoice.invoice_id} from AL Tax Service`).trim();
  const message = String(body.message || `Please find invoice ${invoice.invoice_id} attached. Total due: $${Number(invoice.balance_due).toFixed(2)}.`).trim();
  const cc = parseEmailList(body.cc);
  const bcc = parseEmailList(body.bcc);

  const clientName = await getClientName(invoice.client_id);
  const results: { channel: string; ok: boolean; error?: string }[] = [];
  for (const channel of channels) {
    let ok = false, error: string | undefined, providerMessageId: string | null = null, sentTo = "";
    try {
      if (channel === "email") {
        sentTo = String(body.email || "").trim();
        if (!sentTo) throw new Error("No email address provided.");
        const result = await sendEmail({
          to: sentTo, cc, bcc, subject,
          html: await invoiceEmailHtml({
            message, invoiceId: invoice.invoice_id, invoiceDate: invoice.invoice_date,
            dueDate: invoice.due_date, balanceDue: Number(invoice.balance_due), req,
          }),
          attachments: [{ filename: `Invoice_${invoice.invoice_id}.pdf`, content: Buffer.from(built!.pdfBytes) }],
        });
        providerMessageId = result.providerMessageId;
      } else if (channel === "sms") {
        sentTo = String(body.phone || "").trim();
        if (!sentTo) throw new Error("No phone number provided.");
        const result = await sendSms({ to: sentTo, body: message });
        providerMessageId = result.providerMessageId;
      } else if (channel === "whatsapp") {
        sentTo = String(body.phone || "").trim();
        if (!sentTo) throw new Error("No phone number provided.");
        const result = await sendWhatsApp({ to: sentTo, body: message });
        providerMessageId = result.providerMessageId;
      } else {
        throw new Error(`Unknown channel "${channel}".`);
      }
      ok = true;
    } catch (err: any) {
      error = err?.message || "Send failed.";
    }
    results.push({ channel, ok, error });

    // Previously this send never wrote a v3_communications row — it only
    // reached the audit log below, which has no client_id, so the client's
    // Activity Timeline never showed "we sent you this invoice" at all.
    await query(
      `INSERT INTO altax.v3_communications
         (communication_id, client_id, client_name, related_task_id, direction, channel, subject,
          message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id, provider_message_id)
       VALUES ($1,$2,$3,NULL,'Outbound',$4,$5,$6,'',$7,$8,now(),$9,'Invoice',$1,$10)`,
      [`COM-${idSuffix()}`, invoice.client_id, clientName, channel, subject, message, sentTo || null,
        req.user!.email, ok ? "Saved + Sent" : `Saved — ${error}`, providerMessageId]
    );
  }

  const summary = results.map((r) => `${r.channel}: ${r.ok ? "sent" : `failed (${r.error})`}`).join("; ");
  await logAudit("Billing", "SEND_INVOICE", invoice.invoice_id, "", "", summary, `Invoice send attempted by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, results });
}));

/**
 * Manual "Send Reminder" — separate from the automatic one-time reminder
 * (reminders.routes.ts's runReminders, which fires once per invoice 3 days
 * past due). Staff can send one anytime regardless of whether the automatic
 * one already fired, at one of two tones: a plain "Reminder" or an "[Urgent]"
 * one with a red accent banner (matching dashboardAlerts.ts's own [Urgent]
 * subject-prefix convention and ClientSwotSection.tsx's red urgent-pill
 * styling). Logs under its own PAYREM-MANUAL-* source_record_id so it never
 * collides with, or gets blocked by, the automatic reminder's PAYREM-{invoiceId} key.
 */
billingRouter.post("/invoices/:invoiceId/send-reminder", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await queryOne<any>(`SELECT * FROM altax.v3_invoices WHERE invoice_id = $1`, [req.params.invoiceId]);
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });
  if (!(await canMutateInvoice(req.user!, invoice))) {
    return res.status(403).json({ error: "You do not have access to this invoice." });
  }
  if (Number(invoice.balance_due) <= 0) return res.status(400).json({ error: "This invoice has no balance due." });

  const urgency = String(req.body?.urgency || "reminder").trim();
  if (!["reminder", "urgent"].includes(urgency)) {
    return res.status(400).json({ error: `urgency must be "reminder" or "urgent".` });
  }

  const client = await queryOne<any>(`SELECT client_id, client_name, email FROM altax.v3_clients WHERE client_id = $1`, [invoice.client_id]);
  if (!client?.email) return res.status(400).json({ error: "This client has no email address on file." });

  const { resolveTemplate } = await import("../templates/templates.routes");
  const resolved = await resolveTemplate("Payment Reminder", invoice.client_id, "", "", {
    balanceDue: `$${Number(invoice.balance_due).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  });
  if (!resolved) return res.status(500).json({ error: "The Payment Reminder template is not available." });

  const { sendEmail, NotConfiguredError } = await import("../../common/notifications");
  const { wrapEmailHtml } = await import("../../common/emailTemplate");
  const { escapeHtml } = await import("../../common/html");
  const subject = urgency === "urgent" ? `[Urgent] ${resolved.subject}` : resolved.subject;
  const urgentBanner = urgency === "urgent"
    ? `<div style="background:#fdecea;color:#7a1f1f;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-weight:700;font-size:13px;">⚠ Urgent — action needed</div>`
    : "";
  const html = await wrapEmailHtml(`${urgentBanner}<p style="margin:0;">${escapeHtml(resolved.message_english).replace(/\n/g, "<br>")}</p>`, req);

  let sent = false;
  let sendError: string | undefined;
  let providerMessageId: string | null = null;
  try {
    const result = await sendEmail({ to: client.email, subject, html });
    providerMessageId = result.providerMessageId;
    sent = true;
  } catch (err: any) {
    sendError = err instanceof NotConfiguredError ? err.message : (err?.message || "Send failed.");
  }

  const status = sent ? "Saved + Sent" : `Saved — ${sendError}`;
  const sourceRecordId = `PAYREM-MANUAL-${invoice.invoice_id}-${Date.now()}`;
  await query(
    `INSERT INTO altax.v3_communications
       (communication_id, client_id, client_name, related_task_id, direction, channel, subject,
        message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id, provider_message_id)
     VALUES ($1,$2,$3,NULL,'Outbound','Email',$4,$5,$6,$7,$8,now(),$9,'Reminders',$10,$11)`,
    [`COM-${idSuffix()}`, invoice.client_id, client.client_name || null, subject,
      resolved.message_english, resolved.message_arabic, client.email, req.user!.email, status, sourceRecordId, providerMessageId]
  );
  await logAudit("Billing", "SEND_PAYMENT_REMINDER", invoice.invoice_id, "", "", urgency,
    `${urgency === "urgent" ? "Urgent" : "Payment"} reminder sent by ${req.user!.email}.`, req.user!.email);

  if (!sent) return res.status(502).json({ ok: false, error: sendError });
  res.json({ ok: true });
}));

/**
 * Get-or-create a public share link for an invoice — no payment processor or email
 * required, just an opaque token that unlocks read-only access to this one invoice
 * via GET /public/invoices/:token (see publicInvoice.routes.ts), matching how
 * QuickBooks' "Copy link" button works. Token never expires or rotates automatically;
 * voiding/deleting isn't possible for invoices (only Void), so the link stays valid
 * until an admin/staff member re-requests a fresh one (not yet built as a separate
 * "revoke" action — regenerating isn't supported today, only lazy first-creation).
 */
billingRouter.post("/invoices/:invoiceId/share", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await queryOne<any>(`SELECT * FROM altax.v3_invoices WHERE invoice_id = $1`, [req.params.invoiceId]);
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });
  if (!(await canMutateInvoice(req.user!, invoice))) {
    return res.status(403).json({ error: "You do not have access to this invoice." });
  }

  if (invoice.share_token) return res.json({ ok: true, shareToken: invoice.share_token });

  const { randomBytes } = await import("crypto");
  const shareToken = randomBytes(24).toString("hex");
  await query(`UPDATE altax.v3_invoices SET share_token = $2, updated_at = now() WHERE invoice_id = $1`, [req.params.invoiceId, shareToken]);
  await logAudit("Billing", "CREATE_SHARE_LINK", invoice.invoice_id, "", "", shareToken, `Share link created by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, shareToken });
}));

/**
 * Statement of Account PDF — every invoice for a client (optionally bounded
 * by ?start=&end= on invoice_date) with a running total-outstanding summary.
 * Same visibility rule as the invoice list: client sees only their own,
 * staff need canAccessClient, admin unrestricted.
 */
billingRouter.get("/clients/:clientId/statement", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  const role = req.user!.role;
  // Employees see no billing/financial data anywhere else in this module (see
  // GET /invoices above) — canAccessClient's employee branch only checks
  // clientId match, which would otherwise hand an employee their employer's
  // full Statement of Account. Deny explicitly rather than falling through.
  if (role === "employee") return res.status(403).json({ error: "You do not have access to this client." });
  const allowed = role === "client" ? clientId === req.user!.clientId : await canAccessClient(req.user!, clientId);
  if (!allowed) return res.status(403).json({ error: "You do not have access to this client." });

  const client = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const start = String(req.query.start || "").trim();
  const end = String(req.query.end || "").trim();
  const conditions = [`client_id = $1`, `status <> 'Void'`];
  const params: any[] = [clientId];
  if (start) { params.push(start); conditions.push(`invoice_date >= $${params.length}::timestamptz`); }
  if (end) { params.push(end); conditions.push(`invoice_date <= $${params.length}::timestamptz`); }

  const invoices = await query<any>(
    `SELECT * FROM altax.v3_invoices WHERE ${conditions.join(" AND ")} ORDER BY invoice_date ASC NULLS LAST`,
    params
  );

  const rangeLabel = start || end ? `${start ? new Date(start).toLocaleDateString() : "…"} – ${end ? new Date(end).toLocaleDateString() : "…"}` : "All Activity";

  const { generateStatementPdf } = await import("./statementPdf");
  const pdfBytes = await generateStatementPdf({
    clientName: client.client_name, clientAddress: client.address || null, clientEmail: client.email || null,
    rangeLabel,
    invoices: invoices.map((inv) => ({
      invoiceId: inv.invoice_id, invoiceDate: inv.invoice_date, description: inv.description,
      totalAmount: Number(inv.total_amount), amountPaid: Number(inv.amount_paid), balanceDue: Number(inv.balance_due),
      status: inv.status,
    })),
  });

  // Mirrors v3LogAudit_('Billing', 'STATEMENT', ...) in legacy's v3GenerateStatementOfAccount —
  // legacy also saved the PDF to Drive and returned a fileUrl; this app streams the PDF
  // directly to the browser instead (no file-storage provider wired up yet), but every
  // generation is still recorded so "who pulled a statement for this client, when" has
  // a real history instead of leaving no trace at all.
  const statementId = `STM-${idSuffix()}`;
  await logAudit("Billing", "STATEMENT", statementId, "ClientID", "", clientId,
    `Statement of account generated for ${client.client_name}.`, req.user!.email);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="Statement_${clientId}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

/**
 * Edit an invoice — ported from alTaxPortalUpdateInvoice: recomputes balance/status
 * from total/paid the same way legacy does, rather than a plain field patch. Client
 * role blocked entirely ("Client portal cannot edit invoices.").
 */
billingRouter.patch("/invoices/:invoiceId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await queryOne<any>(`SELECT * FROM altax.v3_invoices WHERE invoice_id = $1`, [req.params.invoiceId]);
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });
  if (!(await canMutateInvoice(req.user!, invoice))) {
    return res.status(403).json({ error: "You do not have access to this invoice." });
  }
  if (isInvoiceLockedForEdit(invoice)) {
    return res.status(400).json({ error: "Paid or void invoices cannot be edited. Reverse the payment or issue a new invoice instead." });
  }

  const body = req.body || {};
  const lineItems: LineItemInput[] = Array.isArray(body.lineItems) ? body.lineItems : [];
  let subtotal: number | null = null, taxableSubtotal: number | null = null, discountAmount: number | null = null,
    salesTaxAmount: number | null = null, salesTaxRate: number | null = null, normalized: LineItemInput[] = [], lineAmounts: number[] = [];
  let lineItemTotal: number | null = null;

  if (lineItems.length > 0) {
    const lineItemError = validateLineItems(lineItems);
    if (lineItemError) return res.status(400).json({ error: lineItemError });
    const client = await queryOne<any>(`SELECT state FROM altax.v3_clients WHERE client_id = $1`, [invoice.client_id]);
    salesTaxRate = body.autoTax ? await lookupSalesTaxRate(client?.state || null) : money(body.salesTaxRate);
    const computed = computeInvoiceTotals(lineItems, {
      discountPercent: money(body.discountPercent), discountAmount: money(body.discountAmount),
      salesTaxRate, shippingAmount: money(body.shippingAmount),
    });
    ({ subtotal, taxableSubtotal, discountAmount, salesTaxAmount, total: lineItemTotal, normalized, lineAmounts } = computed);
  }

  const shipToStreet = Object.prototype.hasOwnProperty.call(body, "shipToStreet") ? String(body.shipToStreet || "").trim() || null : invoice.ship_to_street;
  const shipToCity = Object.prototype.hasOwnProperty.call(body, "shipToCity") ? String(body.shipToCity || "").trim() || null : invoice.ship_to_city;
  const shipToState = Object.prototype.hasOwnProperty.call(body, "shipToState") ? String(body.shipToState || "").trim() || null : invoice.ship_to_state;
  const shipToZip = Object.prototype.hasOwnProperty.call(body, "shipToZip") ? String(body.shipToZip || "").trim() || null : invoice.ship_to_zip;
  const shipToStructuredTouched = ["shipToStreet", "shipToCity", "shipToState", "shipToZip"].some((k) => Object.prototype.hasOwnProperty.call(body, k));
  // Explicit `shipTo` free text wins over recomposing from structured parts; otherwise
  // recompose only when a structured part actually changed, else COALESCE keeps the
  // existing ship_to untouched (same "don't wipe on an unrelated field edit" rule).
  const shipToComposed = !Object.prototype.hasOwnProperty.call(body, "shipTo") && shipToStructuredTouched
    ? composeAddress({ street: shipToStreet, city: shipToCity, state: shipToState, zip: shipToZip })
    : (String(body.shipTo || "").trim() || null);

  let total = 0, paid = 0, balance = 0, status = "";
  let validationError: string | null = null;

  await withTransaction(async (db) => {
    // Lock the invoice row and recompute against THIS read, not the one taken
    // before the transaction started — a concurrent edit/payment/reversal landing
    // between that first read and this write used to be silently lost (its GL
    // delta computed against stale before/after numbers), the same lost-update
    // race already closed on the payments/reversal routes.
    const locked = (await db.query<any>(
      `SELECT total_amount, amount_paid, deposit_amount, status FROM altax.v3_invoices WHERE invoice_id = $1 FOR UPDATE`,
      [req.params.invoiceId]
    ))[0];
    const oldTotal = money(locked.total_amount);
    const oldPaid = money(locked.amount_paid);

    total = lineItemTotal !== null ? lineItemTotal : (body.totalAmount !== undefined ? money(body.totalAmount) : oldTotal);
    if (total <= 0) { validationError = "Invoice total must be greater than zero."; return; }

    // amountPaid is deliberately no longer settable via this route (it used to
    // accept any body.amountPaid with no matching v3_payments row, letting the
    // "trusted" summary column desync from the payments ledger it's supposed to
    // summarize) — the only two ways amount_paid can move now are a real payment/
    // reversal recorded elsewhere, or the explicit status-transition guard below.
    paid = oldPaid;
    const deposit = body.depositAmount !== undefined ? money(body.depositAmount) : money(locked.deposit_amount);
    balance = body.balanceDue !== undefined ? money(body.balanceDue) : Math.max(0, total - paid - deposit);
    status = String(body.status || locked.status || (balance <= 0 ? "Paid" : paid + deposit > 0 ? "Partial" : "Unpaid")).trim();

    /**
     * Status-transition guard — ported from v3UpdateInvoiceStatus, which the
     * generic edit route previously skipped entirely (a caller could set
     * status="Partial" with no actual partial payment on file, or set a
     * status without the corresponding paid/balance amounts snapping to it).
     * Only applies when the caller is explicitly changing status; a plain
     * field edit that doesn't touch status is unaffected.
     */
    if (body.status !== undefined) {
      const statusUpper = status.toUpperCase();
      if (statusUpper === "PAID") {
        paid = total;
        balance = 0;
      } else if (statusUpper === "UNPAID" || statusUpper === "OPEN") {
        paid = 0;
        balance = total;
      } else if (statusUpper === "VOID") {
        paid = 0;
        balance = 0;
      } else if (statusUpper === "PARTIAL") {
        if (paid <= 0 || paid >= total) {
          validationError = "Record a partial payment before setting this invoice to Partial.";
          return;
        }
        balance = total - paid;
      }
    }

    await db.query(
      `UPDATE altax.v3_invoices SET
         invoice_date = COALESCE($2, invoice_date), due_date = COALESCE($3, due_date),
         description = COALESCE($4, description), total_amount = $5, amount_paid = $6,
         balance_due = $7, status = $8, pdf_link = COALESCE($9, pdf_link),
         terms = COALESCE($10, terms), customer_type = COALESCE($11, customer_type),
         bill_to = COALESCE($12, bill_to), ship_to = COALESCE($13, ship_to), ship_from = COALESCE($14, ship_from),
         payment_instructions = COALESCE($15, payment_instructions), client_note = COALESCE($16, client_note),
         internal_note = COALESCE($17, internal_note), subtotal_amount = COALESCE($18, subtotal_amount),
         discount_percent = COALESCE($19, discount_percent), discount_amount = COALESCE($20, discount_amount),
         taxable_subtotal = COALESCE($21, taxable_subtotal), sales_tax_rate = COALESCE($22, sales_tax_rate),
         sales_tax_amount = COALESCE($23, sales_tax_amount), shipping_amount = COALESCE($24, shipping_amount),
         deposit_amount = $25, ship_via = COALESCE($26, ship_via), shipping_date = COALESCE($27, shipping_date),
         tracking_number = COALESCE($28, tracking_number),
         ship_to_street = $29, ship_to_city = $30, ship_to_state = $31, ship_to_zip = $32, updated_at = now()
       WHERE invoice_id = $1`,
      [
        req.params.invoiceId, String(body.invoiceDate || "").trim() || null, String(body.dueDate || "").trim() || null,
        String(body.description || "").trim() || null, total, paid, balance, status, String(body.pdfLink || "").trim() || null,
        String(body.terms || "").trim() || null, String(body.customerType || "").trim() || null,
        String(body.billTo || "").trim() || null, shipToComposed, String(body.shipFrom || "").trim() || null,
        String(body.paymentInstructions || "").trim() || null, String(body.clientNote || "").trim() || null,
        String(body.internalNote || "").trim() || null, subtotal, body.discountPercent !== undefined ? money(body.discountPercent) : null,
        discountAmount, taxableSubtotal, salesTaxRate, salesTaxAmount,
        body.shippingAmount !== undefined ? money(body.shippingAmount) : null, deposit,
        String(body.shipVia || "").trim() || null, String(body.shippingDate || "").trim() || null,
        String(body.trackingNumber || "").trim() || null,
        shipToStreet, shipToCity, shipToState, shipToZip,
      ]
    );

    // Re-total and amount-paid edits are real money movements that must reach the
    // ledger too, not just the invoices table — post only the delta from what was
    // there before, so a plain metadata edit (no total/paid change) posts nothing.
    if (total !== oldTotal || paid !== oldPaid) {
      const clientName = await getClientName(invoice.client_id);
      const entryDate = String(body.invoiceDate || "").trim() || invoice.invoice_date;
      if (total !== oldTotal) {
        await postInvoiceTotalGl(invoice.client_id, clientName, req.params.invoiceId, entryDate, total - oldTotal, db);
      }
      if (paid !== oldPaid) {
        const paidDelta = paid - oldPaid;
        await postInvoicePaymentGl(invoice.client_id, clientName, req.params.invoiceId, entryDate, paidDelta, paidDelta < 0, db);
      }
    }
  });

  if (validationError) return res.status(400).json({ error: validationError });

  if (normalized.length > 0) await replaceLineItems(req.params.invoiceId, normalized, lineAmounts);

  await logAudit("Billing", "EDIT_INVOICE", req.params.invoiceId, "", "", status, "Invoice edited from web app.", req.user!.email);

  res.json({ ok: true, invoiceId: req.params.invoiceId, totalAmount: total, amountPaid: paid, balanceDue: balance, status });
}));

/**
 * Void an invoice — ported from alTaxPortalVoidInvoice: soft status change
 * (Status=Void, BalanceDue zeroed), not a delete. Client role blocked.
 */
billingRouter.post("/invoices/:invoiceId/void", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await queryOne<any>(`SELECT * FROM altax.v3_invoices WHERE invoice_id = $1`, [req.params.invoiceId]);
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });
  if (!(await canMutateInvoice(req.user!, invoice))) {
    return res.status(403).json({ error: "You do not have access to this invoice." });
  }

  const reason = String((req.body || {}).reason || "Invoice voided from web app.");
  await withTransaction(async (db) => {
    // Lock the row and read the balance from THIS query, not the one taken
    // before the transaction started — a payment recorded concurrently between
    // that first read and this write would otherwise not be reflected in the
    // write-off amount, the same lost-update race already closed on payments/
    // reversal/the invoice-edit route above.
    const locked = (await db.query<any>(`SELECT balance_due FROM altax.v3_invoices WHERE invoice_id = $1 FOR UPDATE`, [req.params.invoiceId]))[0];
    const outstanding = money(locked.balance_due);

    await db.query(
      `UPDATE altax.v3_invoices SET status = 'Void', balance_due = 0, updated_at = now() WHERE invoice_id = $1`,
      [req.params.invoiceId]
    );
    // Write off only the still-outstanding balance — any portion already collected
    // was posted correctly by postInvoicePaymentGl when the payment was recorded
    // and stays untouched (voiding doesn't undo cash actually received; use a
    // payment reversal for that).
    if (outstanding !== 0) {
      const clientName = await getClientName(invoice.client_id);
      await postInvoiceTotalGl(invoice.client_id, clientName, req.params.invoiceId, invoice.invoice_date, -outstanding, db);
    }
  });
  await logAudit("Billing", "VOID_INVOICE", req.params.invoiceId, "Status", invoice.status || "", "Void", reason, req.user!.email);

  res.json({ ok: true, invoiceId: req.params.invoiceId, status: "Void" });
}));

/**
 * Permanently delete an invoice — the module doc comment above deliberately skipped
 * this (hard row delete, void was meant as the sole substitute), ported now at the
 * user's explicit request to clear test/junk invoices off the Billing page. Admin-only,
 * typed confirmation required, matching DELETE PAYCHECK / DELETE DOCUMENT / DELETE USER.
 * Blocked when a real payment references this invoice (v3_payments.invoice_id) — that
 * financial history needs the paper trail a void preserves, not a delete that would
 * orphan the payment row (ON DELETE SET NULL) with no invoice to point back to.
 * v3_invoice_line_items cascade-deletes; v3_recurring_billing.last_invoice_id nulls out.
 */
billingRouter.post("/invoices/:invoiceId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { invoiceId } = req.params;
  if (String((req.body || {}).confirm || "").trim() !== "DELETE INVOICE") {
    return res.status(400).json({ error: 'Type "DELETE INVOICE" to confirm this permanent action.' });
  }
  const invoice = await queryOne<any>(`SELECT * FROM altax.v3_invoices WHERE invoice_id = $1`, [invoiceId]);
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });

  const paymentCount = await queryOne<{ count: string }>(`SELECT count(*) FROM altax.v3_payments WHERE invoice_id = $1`, [invoiceId]);
  if (Number(paymentCount?.count || 0) > 0) {
    return res.status(400).json({ error: "This invoice has payment history and cannot be deleted. Void it instead." });
  }

  await query(`DELETE FROM altax.v3_invoices WHERE invoice_id = $1`, [invoiceId]);
  await logAudit("Billing", "DELETE_INVOICE", invoiceId, "Status", invoice.status || "", "",
    `Invoice permanently deleted by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, invoiceId });
}));

/**
 * Record a payment against an invoice — ported from alTaxPortalRecordPayment, plus the
 * over-payment cap from v3RecordInvoicePayment (see module doc comment). Client role
 * blocked ("Client portal cannot record payments.").
 */
billingRouter.post("/invoices/:invoiceId/payments", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const invoice = await queryOne<any>(`SELECT * FROM altax.v3_invoices WHERE invoice_id = $1`, [req.params.invoiceId]);
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });
  if (!(await canMutateInvoice(req.user!, invoice))) {
    return res.status(403).json({ error: "You do not have access to this invoice." });
  }
  if (String(invoice.status || "").trim().toLowerCase() === "void") {
    return res.status(400).json({ error: "This invoice is void — nothing is owed on it." });
  }

  const body = req.body || {};
  const amount = money(body.actualAmount ?? body.amount);
  if (amount <= 0) return res.status(400).json({ error: "Payment amount must be greater than zero." });

  const total = money(invoice.total_amount);
  const paymentId = nextPaymentId();
  const paymentMethod = await resolvePaymentMethod(invoice.client_id, "invoices", body.paymentMethodId);
  const routingNumber = String(body.paymentRoutingNumber || "").trim() || paymentMethod?.routingNumber || "";
  const accountNumber = String(body.paymentAccountNumber || "").trim() || paymentMethod?.accountNumber || "";
  const bankLast4 = String(body.paymentBankLast4 || "").trim() || accountNumber.replace(/\D/g, "").slice(-4) || paymentMethod?.bankLast4 || "";

  const paymentDate = String(body.paymentDate || "").trim() || null;
  const idempotencyKey = String(body.idempotencyKey || "").trim() || null;
  let newPaid = 0, balance = 0, status = "";
  let overpay = false;
  let isDuplicate = false;
  let duplicateResponse: any = null;
  await withTransaction(async (db) => {
    // Lock the invoice row and recompute amount_paid from THIS read, not the
    // one taken before the transaction started — two concurrent/double-submitted
    // payments against the same invoice both used to read the same stale
    // amount_paid, both compute their own "new total" from it, and the second
    // UPDATE (an absolute write, not an increment) silently overwrote the
    // first payment's contribution even though both payment rows and both GL
    // postings existed. Locking here also makes the over-payment cap below
    // see the other payment's contribution instead of racing past it.
    const locked = await db.query<{ amount_paid: string }>(`SELECT amount_paid FROM altax.v3_invoices WHERE invoice_id = $1 FOR UPDATE`, [req.params.invoiceId]);
    const existingPaid = money(locked[0]?.amount_paid);
    newPaid = existingPaid + amount;
    if (newPaid > total) { overpay = true; return; }
    balance = Math.max(0, total - newPaid);
    status = balance <= 0 ? "Paid" : newPaid > 0 ? "Partial" : "Unpaid";

    // ACC-019 — reserved AFTER the overpay check (a rejected request never
    // consumes the key, so a legitimate resubmit with corrected data isn't
    // blocked) but still inside this same transaction as the insert below,
    // so reserving the key and creating the payment row are atomic together.
    if (idempotencyKey) {
      const { reserved, existingResponse } = await reserveIdempotencyKey(db, idempotencyKey, "billing.record-payment");
      if (!reserved) { isDuplicate = true; duplicateResponse = existingResponse; return; }
    }

    await db.query(
      `INSERT INTO altax.v3_payments
         (payment_id, invoice_id, task_id, client_id, payment_date, expected_amount, actual_amount, method,
          payment_method_id, payment_bank_name, payment_routing_number, payment_account_number,
          payment_account_type, payment_bank_last4, confirmation_number, notes, status, reversal_reason,
          source_system, source_record_id)
       VALUES ($1,$2,$3,$4,COALESCE($5,now()),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'Active','','Node Web App',$1)`,
      [
        paymentId, req.params.invoiceId, String(body.taskId || "").trim() || null, invoice.client_id,
        paymentDate, money(body.expectedAmount ?? invoice.balance_due ?? total), amount,
        String(body.method || "Manual").trim(), paymentMethod?.paymentMethodId || String(body.paymentMethodId || "").trim() || null,
        String(body.paymentBankName || "").trim() || paymentMethod?.bankName || null,
        routingNumber ? encryptValue(routingNumber) : null,
        accountNumber ? encryptValue(accountNumber) : null,
        String(body.paymentAccountType || "").trim() || paymentMethod?.accountType || null, bankLast4 || null,
        String(body.confirmationNumber || "").trim() || null, String(body.notes || "").trim() || null,
      ]
    );

    await db.query(
      `UPDATE altax.v3_invoices SET amount_paid = $2, balance_due = $3, status = $4, updated_at = now() WHERE invoice_id = $1`,
      [req.params.invoiceId, newPaid, balance, status]
    );

    const clientName = await getClientName(invoice.client_id);
    await postInvoicePaymentGl(invoice.client_id, clientName, paymentId, paymentDate || invoice.invoice_date, amount, false, db);

    if (idempotencyKey) {
      await saveIdempotencyResponse(db, idempotencyKey, "billing.record-payment",
        { ok: true, paymentId, invoiceId: req.params.invoiceId, amountPaid: newPaid, balanceDue: balance, status });
    }
  });
  // ACC-019 follow-up (found by independent review, 2026-08-13) — reserved=false
  // with no saved response shouldn't be reachable given reservation and save
  // happen in the same transaction, but if it ever is (e.g. another request's
  // transaction is still mid-flight), fail honestly instead of falling through
  // to a fabricated "success" built from local variables that were never
  // actually written to v3_payments.
  if (isDuplicate) {
    if (duplicateResponse) return res.status(200).json(duplicateResponse);
    return res.status(409).json({ error: "This payment submission is already being processed. Wait a moment, then check the invoice's payment history before retrying." });
  }
  if (overpay) return res.status(400).json({ error: "Payment exceeds invoice total." });

  await logAudit("Billing", "RECORD_PAYMENT", paymentId, "InvoiceID", "", req.params.invoiceId,
    `Payment recorded by ${req.user!.email}.`, req.user!.email);

  // Receipt email — best-effort by necessity (the payment itself is already
  // committed above; a failed receipt shouldn't undo a real payment), but
  // the failure is still logged to the audit trail instead of silently
  // swallowed, so "did the client get told" is answerable later.
  const clientForReceipt = invoice.client_id ? await queryOne<any>(`SELECT email FROM altax.v3_clients WHERE client_id = $1`, [invoice.client_id]) : null;
  if (clientForReceipt?.email) {
    try {
      const { sendEmail } = await import("../../common/notifications");
      await sendEmail({
        to: clientForReceipt.email,
        subject: `Payment received — Invoice ${req.params.invoiceId}`,
        html: await paymentReceiptEmailHtml({
          invoiceId: req.params.invoiceId, paymentDate: paymentDate || new Date().toISOString().slice(0, 10),
          amount, method: String(body.method || "Manual").trim(), balanceDue: balance, req,
        }),
      });
      await query(
        `INSERT INTO altax.v3_communications
           (communication_id, client_id, client_name, related_task_id, direction, channel, subject,
            message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id)
         VALUES ($1,$2,$3,NULL,'Outbound','email',$4,$5,'',$6,'System',now(),'Saved + Sent','Payment Receipt',$1)`,
        [`COM-${idSuffix()}`, invoice.client_id, await getClientName(invoice.client_id),
          `Payment received — Invoice ${req.params.invoiceId}`, `Payment of ${money(amount)} received.`, clientForReceipt.email]
      );
    } catch (err: any) {
      await logAudit("Billing", "PAYMENT_RECEIPT_EMAIL_FAILED", paymentId, "", "", err?.message || "Send failed",
        `Payment receipt email to ${clientForReceipt.email} failed for invoice ${req.params.invoiceId}: ${err?.message || "unknown error"}.`, "System");
    }
  }

  res.status(201).json({ ok: true, paymentId, invoiceId: req.params.invoiceId, amountPaid: newPaid, balanceDue: balance, status });
}));

/**
 * Sales Receipt — ported from alTaxPortalCreateSalesReceipt: creates a Paid
 * invoice and its matching payment row in one call, for a sale that's already
 * collected in full (vs. the normal invoice-then-payment two-step flow for
 * billing someone who'll pay later).
 */
billingRouter.post("/sales-receipt", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const clientId = String(body.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "clientId is required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT client_id FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const amount = money(body.amount ?? body.totalAmount);
  if (amount <= 0) return res.status(400).json({ error: "Sales receipt amount must be greater than zero." });

  const invoiceId = nextInvoiceId();
  const invoiceDate = String(body.date || "").trim() || null;
  const description = String(body.description || "Sales receipt").trim();
  const paymentId = nextPaymentId();
  const paymentMethod = await resolvePaymentMethod(clientId, "invoices", body.paymentMethodId);
  const routingNumber = String(body.paymentRoutingNumber || "").trim() || paymentMethod?.routingNumber || "";
  const accountNumber = String(body.paymentAccountNumber || "").trim() || paymentMethod?.accountNumber || "";
  const bankLast4 = String(body.paymentBankLast4 || "").trim() || accountNumber.replace(/\D/g, "").slice(-4) || paymentMethod?.bankLast4 || "";

  await withTransaction(async (db) => {
    await db.query(
      `INSERT INTO altax.v3_invoices
         (invoice_id, client_id, invoice_date, due_date, description, total_amount, amount_paid,
          balance_due, status, source_system, source_record_id)
       VALUES ($1,$2,COALESCE($3,now()),COALESCE($3,now()),$4,$5,$5,0,'Paid','Node Web App',$1)`,
      [invoiceId, clientId, invoiceDate, description, amount]
    );

    await db.query(
      `INSERT INTO altax.v3_payments
         (payment_id, invoice_id, client_id, payment_date, expected_amount, actual_amount, method,
          payment_method_id, payment_bank_name, payment_routing_number, payment_account_number,
          payment_account_type, payment_bank_last4, confirmation_number, notes, status, reversal_reason, source_system, source_record_id)
       VALUES ($1,$2,$3,COALESCE($4,now()),$5,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Active','','Node Web App',$1)`,
      [
        paymentId, invoiceId, clientId, invoiceDate, amount, String(body.method || "Manual").trim(),
        paymentMethod?.paymentMethodId || String(body.paymentMethodId || "").trim() || null,
        String(body.paymentBankName || "").trim() || paymentMethod?.bankName || null,
        routingNumber ? encryptValue(routingNumber) : null,
        accountNumber ? encryptValue(accountNumber) : null,
        String(body.paymentAccountType || "").trim() || paymentMethod?.accountType || null, bankLast4 || null,
        String(body.confirmationNumber || "").trim() || null, String(body.notes || "").trim() || null,
      ]
    );

    // Dr AR / Cr Revenue for the invoice, then Dr Cash / Cr AR for the same-instant
    // payment — nets to Dr Cash / Cr Revenue, correctly bypassing AR entirely since
    // this is money already in hand, not billed-and-awaited.
    const clientName = await getClientName(clientId);
    await postInvoiceTotalGl(clientId, clientName, invoiceId, invoiceDate, amount, db);
    await postInvoicePaymentGl(clientId, clientName, paymentId, invoiceDate, amount, false, db);
  });

  await logAudit("Billing", "CREATE_SALES_RECEIPT", invoiceId, "", "", String(amount),
    `Sales receipt created by ${req.user!.email}.`, req.user!.email);

  // Same best-effort receipt email as the regular payment-recording route above.
  const clientForReceipt = await queryOne<any>(`SELECT email FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (clientForReceipt?.email) {
    try {
      const { sendEmail } = await import("../../common/notifications");
      await sendEmail({
        to: clientForReceipt.email,
        subject: `Payment received — Invoice ${invoiceId}`,
        html: await paymentReceiptEmailHtml({
          invoiceId, paymentDate: invoiceDate || new Date().toISOString().slice(0, 10),
          amount, method: String(body.method || "Manual").trim(), balanceDue: 0, req,
        }),
      });
      await query(
        `INSERT INTO altax.v3_communications
           (communication_id, client_id, client_name, related_task_id, direction, channel, subject,
            message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id)
         VALUES ($1,$2,$3,NULL,'Outbound','email',$4,$5,'',$6,'System',now(),'Saved + Sent','Payment Receipt',$1)`,
        [`COM-${idSuffix()}`, clientId, await getClientName(clientId),
          `Payment received — Invoice ${invoiceId}`, `Payment of ${money(amount)} received.`, clientForReceipt.email]
      );
    } catch (err: any) {
      await logAudit("Billing", "PAYMENT_RECEIPT_EMAIL_FAILED", paymentId, "", "", err?.message || "Send failed",
        `Payment receipt email to ${clientForReceipt.email} failed for invoice ${invoiceId}: ${err?.message || "unknown error"}.`, "System");
    }
  }

  res.status(201).json({ ok: true, invoiceId, paymentId, amount });
}));

/**
 * Reverse a payment — ported from v3ReverseInvoicePayment: marks the payment
 * Status=Reversed (with a required reason), rolls the invoice's AmountPaid/BalanceDue/
 * Status back down accordingly. Not a delete — the original payment row stays, with
 * ReversalReason recorded, matching legacy's audit trail intent.
 */
billingRouter.post("/payments/:paymentId/reverse", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const reason = String((req.body || {}).reason || "").trim();
  if (!reason) return res.status(400).json({ error: "Reversal reason is required." });

  const payment = await queryOne<any>(`SELECT * FROM altax.v3_payments WHERE payment_id = $1`, [req.params.paymentId]);
  if (!payment) return res.status(404).json({ error: "Payment not found." });
  if (String(payment.status || "").toUpperCase() === "REVERSED") {
    return res.status(400).json({ error: "This payment has already been reversed." });
  }
  const paymentAmount = money(payment.actual_amount);
  if (paymentAmount <= 0) return res.status(400).json({ error: "Only positive active payments can be reversed." });

  const invoice = await queryOne<any>(`SELECT * FROM altax.v3_invoices WHERE invoice_id = $1`, [payment.invoice_id]);
  if (!invoice) return res.status(404).json({ error: "Matching invoice not found." });
  if (!(await canMutateInvoice(req.user!, invoice))) {
    return res.status(403).json({ error: "You do not have access to this invoice." });
  }

  const total = money(invoice.total_amount);
  const isVoidInvoice = String(invoice.status || "").trim().toLowerCase() === "void";
  let newPaid = 0, balance = 0, status = "";
  let alreadyReversed = false;
  await withTransaction(async (db) => {
    // Atomic claim first, same pattern as the Payroll/Bank Rec Agent draft
    // fixes — two concurrent reverse calls for the same payment (a
    // double-click) can no longer both pass the earlier status read and both
    // subtract this payment from the invoice / post a duplicate reversal GL
    // entry; only one UPDATE...WHERE status <> 'Reversed' can match the row.
    const claimed = await db.query(
      `UPDATE altax.v3_payments SET status = 'Reversed', reversal_reason = $2, updated_at = now() WHERE payment_id = $1 AND status <> 'Reversed' RETURNING payment_id`,
      [req.params.paymentId, reason]
    );
    if (!claimed.length) { alreadyReversed = true; return; }

    // Lock the invoice row and recompute from THIS read — same lost-update
    // risk as recording a payment (see POST /invoices/:invoiceId/payments).
    const locked = await db.query<{ amount_paid: string }>(`SELECT amount_paid FROM altax.v3_invoices WHERE invoice_id = $1 FOR UPDATE`, [payment.invoice_id]);
    const existingPaid = money(locked[0]?.amount_paid);
    newPaid = Math.max(0, existingPaid - paymentAmount);

    if (isVoidInvoice) {
      // A Void invoice's balance was already written off to 0 at void time and
      // must never be recomputed from payment history here — doing so is what
      // previously let a reversal silently "un-void" a canceled invoice back to
      // Paid/Partial/Unpaid while GL still carried the earlier write-off. Only
      // amount_paid (a historical record) is corrected; status/balance stay Void/0.
      balance = 0;
      status = "Void";
      await db.query(`UPDATE altax.v3_invoices SET amount_paid = $2, updated_at = now() WHERE invoice_id = $1`,
        [payment.invoice_id, newPaid]);
    } else {
      balance = Math.max(0, total - newPaid);
      status = balance <= 0 ? "Paid" : newPaid > 0 ? "Partial" : "Unpaid";
      await db.query(`UPDATE altax.v3_invoices SET amount_paid = $2, balance_due = $3, status = $4, updated_at = now() WHERE invoice_id = $1`,
        [payment.invoice_id, newPaid, balance, status]);
    }

    const clientName = await getClientName(invoice.client_id);
    await postInvoicePaymentGl(invoice.client_id, clientName, req.params.paymentId, payment.payment_date || invoice.invoice_date, paymentAmount, true, db);
  });
  if (alreadyReversed) return res.status(400).json({ error: "This payment has already been reversed." });

  await logAudit("Billing", "REVERSE_PAYMENT", payment.invoice_id, "AmountPaid", "", String(newPaid), reason, req.user!.email);

  res.json({ ok: true, invoiceId: payment.invoice_id, reversedPaymentId: req.params.paymentId, amountReversed: paymentAmount, amountPaid: newPaid, balanceDue: balance, status });
}));

/**
 * Calendar-date-only helper — deliberately UTC throughout (parse AND reconstruct),
 * not local time. These schedules only ever carry a plain YYYY-MM-DD, no time-of-day
 * meaning; mixing a UTC-parsed "2026-07-09" with local getFullYear/getMonth/getDate()
 * shifts the date back a day on any server whose local time is behind UTC (this app's
 * configured America/New_York zone included) — confirmed live via a test schedule
 * that stored 07-08 for a 07-09 input. Every date must go in and out via UTC getters
 * so parse and reconstruct agree.
 */
function dateOnly(value: unknown): Date {
  const parsed = value ? new Date(value as any) : new Date();
  const d = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function dateString(value: unknown): string {
  const d = dateOnly(value);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function addDays(value: unknown, days: number): Date {
  const d = dateOnly(value);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d;
}
/**
 * Mirrors alTaxV5NextRecurringDate_, extended with QBO-style "every N months" and
 * "on day X" controls (added at the user's request to match QuickBooks' recurring
 * invoice scheduling screen). intervalCount multiplies the step (e.g. Monthly + 2 =
 * every 2 months); repeatOnDay, when set, pins the resulting date's day-of-month
 * instead of drifting off whatever day the previous run happened to land on —
 * clamped to the target month's actual last day (e.g. day 31 in February -> 28/29).
 */
function nextRecurringDate(value: unknown, frequency: unknown, intervalCount?: number, repeatOnDay?: number | null): Date {
  const d = dateOnly(value);
  const key = String(frequency || "Monthly").trim().toLowerCase();
  const n = Math.max(1, Number(intervalCount) || 1);
  if (key === "weekly") d.setUTCDate(d.getUTCDate() + 7 * n);
  else if (key === "quarterly") d.setUTCMonth(d.getUTCMonth() + 3 * n);
  else if (["annual", "annually", "yearly"].includes(key)) d.setUTCFullYear(d.getUTCFullYear() + n);
  else d.setUTCMonth(d.getUTCMonth() + n);

  if (repeatOnDay && key !== "weekly") {
    const lastDayOfMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(Math.max(1, Math.trunc(repeatOnDay)), lastDayOfMonth));
  }
  return d;
}

/**
 * Create or update a recurring billing schedule — ported from
 * alTaxPortalSaveRecurringBilling. AutoCollectPayment is always forced to false: no
 * payment processor is connected, matching legacy's own explicit rejection of that flag.
 */
billingRouter.post("/recurring", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  if (String(body.autoCollectPayment || "").toLowerCase() === "true" || body.autoCollectPayment === true) {
    return res.status(400).json({ error: "Auto collection requires a connected payment processor. This module only auto-creates invoices." });
  }
  const clientId = String(body.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "Client is required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const amount = money(body.amount);
  if (amount <= 0) return res.status(400).json({ error: "Recurring billing amount must be greater than zero." });
  const description = String(body.description || "").trim();
  if (!description) return res.status(400).json({ error: "Description is required." });

  const recurringBillingId = String(body.recurringBillingId || "").trim() || `RB-${idSuffix()}`;
  const existing = await queryOne<any>(`SELECT recurring_billing_id FROM altax.v3_recurring_billing WHERE recurring_billing_id = $1`, [recurringBillingId]);
  const startDate = dateString(body.startDate);
  const nextRunDate = body.nextRunDate ? dateString(body.nextRunDate) : startDate;

  const fields = [
    client.client_id, client.client_name, description, amount, String(body.frequency || "Monthly").trim(),
    startDate, String(body.endDate || "").trim() || null, nextRunDate, Number(body.dueDays || 0),
    Math.max(1, Number(body.intervalCount) || 1), body.repeatOnDay ? Math.trunc(Number(body.repeatOnDay)) : null,
    String(body.paymentMethodId || "").trim() || null,
    body.autoCreateInvoice === undefined ? true : Boolean(body.autoCreateInvoice),
    body.autoSendInvoice === undefined ? false : Boolean(body.autoSendInvoice),
    false, String(body.status || "Active").trim(), String(body.notes || "").trim() || null,
  ];

  if (existing) {
    await query(
      `UPDATE altax.v3_recurring_billing SET
         client_id=$2, client_name=$3, description=$4, amount=$5, frequency=$6, start_date=$7, end_date=$8,
         next_run_date=$9, due_days=$10, interval_count=$11, repeat_on_day=$12, payment_method_id=$13,
         auto_create_invoice=$14, auto_send_invoice=$15, auto_collect_payment=$16, status=$17, notes=$18, updated_at=now()
       WHERE recurring_billing_id=$1`,
      [recurringBillingId, ...fields]
    );
    await logAudit("Billing", "SAVE_RECURRING_BILLING", recurringBillingId, "ClientID", "", clientId,
      `Recurring billing saved by ${req.user!.email}.`, req.user!.email);
  } else {
    const columns = ["recurring_billing_id", "client_id", "client_name", "description", "amount", "frequency",
      "start_date", "end_date", "next_run_date", "due_days", "interval_count", "repeat_on_day", "payment_method_id",
      "auto_create_invoice", "auto_send_invoice", "auto_collect_payment", "status", "notes", "source_system", "source_record_id"];
    const values = [recurringBillingId, ...fields, "Node Web App", recurringBillingId];
    await query(`INSERT INTO altax.v3_recurring_billing (${columns.join(", ")}) VALUES (${values.map((_, i) => `$${i + 1}`).join(", ")})`, values);
    await logAudit("Billing", "CREATE_RECURRING_BILLING", recurringBillingId, "ClientID", "", clientId,
      `Recurring billing saved by ${req.user!.email}.`, req.user!.email);
  }

  res.json({ ok: true, recurringBillingId });
}));

/** List recurring billing schedules — admin sees all, staff scoped to accessible clients. */
billingRouter.get("/recurring", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (req.user!.role === "admin") {
    const rows = await query(`SELECT * FROM altax.v3_recurring_billing ORDER BY next_run_date ASC NULLS LAST`);
    return res.json({ schedules: rows });
  }
  const aliases = await getUserAliases(req.user!.email);
  const rows = await query(
    `SELECT * FROM altax.v3_recurring_billing
      WHERE client_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($1::text[]))
      ORDER BY next_run_date ASC NULLS LAST`,
    [Array.from(aliases)]
  );
  res.json({ schedules: rows });
}));

/** Archive a recurring billing schedule — ported from alTaxPortalArchiveRecurringBilling. Soft (Status=Archived), stops future runs. */
billingRouter.post("/recurring/:recurringBillingId/archive", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { recurringBillingId } = req.params;
  const old = await queryOne<any>(`SELECT * FROM altax.v3_recurring_billing WHERE recurring_billing_id = $1`, [recurringBillingId]);
  if (!old) return res.status(404).json({ error: "Recurring billing schedule not found." });
  if (!(await canAccessClient(req.user!, old.client_id))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }

  await query(`UPDATE altax.v3_recurring_billing SET status = 'Archived', updated_at = now() WHERE recurring_billing_id = $1`, [recurringBillingId]);
  await logAudit("Billing", "ARCHIVE_RECURRING_BILLING", recurringBillingId, "Status", old.status || "", "Archived",
    `Recurring billing archived by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, recurringBillingId });
}));

/** Pause a recurring billing schedule — like Archive but resumable; /recurring/run already skips "paused" same as "archived". */
billingRouter.post("/recurring/:recurringBillingId/pause", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { recurringBillingId } = req.params;
  const old = await queryOne<any>(`SELECT * FROM altax.v3_recurring_billing WHERE recurring_billing_id = $1`, [recurringBillingId]);
  if (!old) return res.status(404).json({ error: "Recurring billing schedule not found." });
  if (!(await canAccessClient(req.user!, old.client_id))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }

  await query(`UPDATE altax.v3_recurring_billing SET status = 'Paused', updated_at = now() WHERE recurring_billing_id = $1`, [recurringBillingId]);
  await logAudit("Billing", "PAUSE_RECURRING_BILLING", recurringBillingId, "Status", old.status || "", "Paused",
    `Recurring billing paused by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, recurringBillingId });
}));

/** Resume a paused recurring billing schedule back to Active. */
billingRouter.post("/recurring/:recurringBillingId/resume", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { recurringBillingId } = req.params;
  const old = await queryOne<any>(`SELECT * FROM altax.v3_recurring_billing WHERE recurring_billing_id = $1`, [recurringBillingId]);
  if (!old) return res.status(404).json({ error: "Recurring billing schedule not found." });
  if (!(await canAccessClient(req.user!, old.client_id))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }

  await query(`UPDATE altax.v3_recurring_billing SET status = 'Active', updated_at = now() WHERE recurring_billing_id = $1`, [recurringBillingId]);
  await logAudit("Billing", "RESUME_RECURRING_BILLING", recurringBillingId, "Status", old.status || "", "Active",
    `Recurring billing resumed by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, recurringBillingId });
}));

/** Advance a schedule to its next occurrence without creating an invoice for the current one — e.g. a client on hold for one period. */
billingRouter.post("/recurring/:recurringBillingId/skip", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { recurringBillingId } = req.params;
  const old = await queryOne<any>(`SELECT * FROM altax.v3_recurring_billing WHERE recurring_billing_id = $1`, [recurringBillingId]);
  if (!old) return res.status(404).json({ error: "Recurring billing schedule not found." });
  if (!(await canAccessClient(req.user!, old.client_id))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }

  const current = dateOnly(old.next_run_date || old.start_date || new Date());
  const next = nextRecurringDate(current, old.frequency, old.interval_count, old.repeat_on_day);
  await query(`UPDATE altax.v3_recurring_billing SET next_run_date = $2, updated_at = now() WHERE recurring_billing_id = $1`, [recurringBillingId, dateString(next)]);
  await logAudit("Billing", "SKIP_RECURRING_BILLING", recurringBillingId, "NextRunDate", dateString(current), dateString(next),
    `Next occurrence skipped by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, recurringBillingId, nextRunDate: dateString(next) });
}));

/**
 * Manually run ONE recurring billing schedule right now — creates its invoice
 * immediately regardless of whether next_run_date has arrived yet. Shares the bulk
 * /recurring/run route's idempotency guard (SourceSystem/SourceRecordID), so it
 * reports back the existing invoice instead of double-billing if that period was
 * already run (e.g. by the scheduled bulk run).
 */
billingRouter.post("/recurring/:recurringBillingId/run-now", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { recurringBillingId } = req.params;
  const schedule = await queryOne<any>(`SELECT * FROM altax.v3_recurring_billing WHERE recurring_billing_id = $1`, [recurringBillingId]);
  if (!schedule) return res.status(404).json({ error: "Recurring billing schedule not found." });
  if (!(await canAccessClient(req.user!, schedule.client_id))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const amount = money(schedule.amount);
  if (amount <= 0) return res.status(400).json({ error: "This schedule has no amount set." });

  const runDate = dateOnly(new Date());
  const runDateString = dateString(runDate);
  const nextRun = dateOnly(schedule.next_run_date || schedule.start_date || runDate);
  const sourceRecordId = `${schedule.recurring_billing_id}:${dateString(nextRun)}`;

  const invoiceId = `INV-${idSuffix()}`;
  const dueDate = dateString(addDays(runDate, schedule.due_days || 0));
  // The pre-check used to run as a plain SELECT before this transaction opened,
  // so two concurrent triggers for the same schedule/period (a double-click on
  // "Use Now", or this manual run overlapping the nightly cron sweep in
  // runRecurringBillingSweep below) could both pass it and both insert an
  // invoice + Dr AR/Cr Revenue GL posting for the same period. This advisory
  // lock — keyed the same way runRecurringBillingSweep locks below, so the two
  // paths serialize against EACH OTHER too, not just against themselves —
  // makes the re-check-then-insert atomic.
  try {
    await withTransaction(async (db) => {
      await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`recurring-billing:${sourceRecordId}`]);
      const existingInvoice = await db.queryOne<any>(
        `SELECT invoice_id FROM altax.v3_invoices WHERE source_system = 'Recurring Billing' AND source_record_id = $1 AND lower(status) <> 'void'`,
        [sourceRecordId]
      );
      if (existingInvoice) {
        throw new Error(`An invoice for this period already exists (${existingInvoice.invoice_id}).`);
      }
      await db.query(
        `INSERT INTO altax.v3_invoices
           (invoice_id, client_id, invoice_date, due_date, description, total_amount, amount_paid, balance_due,
            status, source_system, source_record_id)
         VALUES ($1,$2,$3,$4,$5,$6,0,$6,'Unpaid','Recurring Billing',$7)`,
        [invoiceId, schedule.client_id, runDateString, dueDate, schedule.description || "Recurring service invoice", amount, sourceRecordId]
      );
      // Every other invoice-creation path posts Dr AR / Cr Revenue immediately —
      // this one didn't, so every "Use Now" recurring invoice was invisible to
      // the GL/Trial Balance/P&L even though the invoice itself existed.
      await postInvoiceTotalGl(schedule.client_id, schedule.client_name, invoiceId, runDateString, amount, db);
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Could not run this recurring billing." });
  }
  await query(
    `UPDATE altax.v3_recurring_billing SET last_run_date=$2, last_invoice_id=$3, next_run_date=$4, updated_at=now() WHERE recurring_billing_id=$1`,
    [recurringBillingId, runDateString, invoiceId, dateString(nextRecurringDate(nextRun, schedule.frequency, schedule.interval_count, schedule.repeat_on_day))]
  );
  await logAudit("Billing", "RUN_RECURRING_BILLING", recurringBillingId, "InvoiceID", "", invoiceId,
    `Recurring invoice manually created (Use Now) by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, invoiceId, recurringBillingId });
}));

/** Permanently delete a recurring billing schedule — admin-only, typed confirmation required, matching DELETE INVOICE / DELETE PAYCHECK / DELETE DOCUMENT. No other table references recurring_billing_id, so this is a clean hard delete; invoices this schedule already created are untouched. */
billingRouter.post("/recurring/:recurringBillingId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { recurringBillingId } = req.params;
  if (String((req.body || {}).confirm || "").trim() !== "DELETE SCHEDULE") {
    return res.status(400).json({ error: 'Type "DELETE SCHEDULE" to confirm this permanent action.' });
  }
  const old = await queryOne<any>(`SELECT * FROM altax.v3_recurring_billing WHERE recurring_billing_id = $1`, [recurringBillingId]);
  if (!old) return res.status(404).json({ error: "Recurring billing schedule not found." });

  await query(`DELETE FROM altax.v3_recurring_billing WHERE recurring_billing_id = $1`, [recurringBillingId]);
  await logAudit("Billing", "DELETE_RECURRING_BILLING", recurringBillingId, "Status", old.status || "", "",
    `Recurring billing schedule permanently deleted by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, recurringBillingId });
}));

/**
 * Run recurring billing — ported from alTaxPortalRunRecurringBilling. Manually
 * triggered (see module doc comment); idempotent per period via a
 * SourceSystem/SourceRecordID uniqueness check, so calling it twice for the same
 * date doesn't double-invoice. Creates one invoice per due, active schedule the
 * caller can access, advances NextRunDate, and — when the schedule's
 * auto_send_invoice flag is on and the client has an email on file — attempts a real
 * email send via notifications.ts. A failed/skipped send never fails the invoice
 * creation itself; each schedule's outcome (emailSent/emailSkippedReason) is reported
 * back in `created` so staff can see exactly what happened per client.
 */
/**
 * The actual recurring-billing sweep, extracted from the route below so both
 * the manual "Run Recurring Billing" button and the nightly cron (server.ts)
 * share one implementation instead of drifting. `actor` stands in for
 * req.user! — pass a role:"admin" actor for unattended/system runs so
 * canAccessClient sees every client, same as a real admin clicking the button.
 */
export async function runRecurringBillingSweep(
  actor: { email: string; role: string; clientId?: string },
  opts: { runDate?: string; clientId?: string; req?: AuthedRequest } = {}
): Promise<{ created: any[]; skipped: number; errors: string[] }> {
  const runDate = dateOnly(opts.runDate);
  const runDateString = dateString(runDate);
  const clientFilter = String(opts.clientId || "").trim();

  const schedules = await query<any>(`SELECT * FROM altax.v3_recurring_billing`);
  const created: any[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (const schedule of schedules) {
    const status = String(schedule.status || "Active").trim().toLowerCase();
    if (["archived", "inactive", "paused", "void", "no", "false"].includes(status)) { skipped++; continue; }
    if (schedule.auto_create_invoice === false) { skipped++; continue; }
    if (clientFilter && schedule.client_id !== clientFilter) { skipped++; continue; }
    if (!(await canAccessClient(actor, schedule.client_id))) { skipped++; continue; }

    const nextRun = dateOnly(schedule.next_run_date || schedule.start_date || runDate);
    if (nextRun.getTime() > runDate.getTime()) { skipped++; continue; }
    if (schedule.end_date && dateOnly(schedule.end_date).getTime() < runDate.getTime()) { skipped++; continue; }

    const amount = money(schedule.amount);
    if (amount <= 0) { errors.push(`${schedule.recurring_billing_id}: amount is missing.`); continue; }

    const sourceRecordId = `${schedule.recurring_billing_id}:${dateString(nextRun)}`;
    const invoiceId = `INV-${idSuffix()}`;
    const dueDate = dateString(addDays(runDate, schedule.due_days || 0));
    // The duplicate check used to run as a plain SELECT before this transaction
    // opened, so this nightly sweep overlapping a manual "Use Now" run (billing.ts
    // route above, which locks on the SAME key) — or two sweep runs somehow
    // overlapping — could both pass it and both create an invoice + GL posting for
    // the same schedule/period. The advisory lock makes the re-check-then-insert
    // atomic, and one bad/racing schedule reports its own error without blocking
    // the rest of the sweep, matching the amount<=0 handling just above.
    let existingInvoiceId: string | null = null;
    try {
      await withTransaction(async (db) => {
        await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`recurring-billing:${sourceRecordId}`]);
        const existingInvoice = await db.queryOne<any>(
          `SELECT invoice_id FROM altax.v3_invoices WHERE source_system = 'Recurring Billing' AND source_record_id = $1 AND lower(status) <> 'void'`,
          [sourceRecordId]
        );
        if (existingInvoice) { existingInvoiceId = existingInvoice.invoice_id; return; }
        await db.query(
          `INSERT INTO altax.v3_invoices
             (invoice_id, client_id, invoice_date, due_date, description, total_amount, amount_paid, balance_due,
              status, source_system, source_record_id)
           VALUES ($1,$2,$3,$4,$5,$6,0,$6,'Unpaid','Recurring Billing',$7)`,
          [invoiceId, schedule.client_id, runDateString, dueDate, schedule.description || "Recurring service invoice", amount, sourceRecordId]
        );
        // Same GL posting every other invoice-creation path already does — the
        // nightly sweep was silently skipping it, understating AR/revenue for
        // every recurring-billing client (see the second audit round's finding).
        await postInvoiceTotalGl(schedule.client_id, schedule.client_name, invoiceId, runDateString, amount, db);
      });
    } catch (err: any) {
      errors.push(`${schedule.recurring_billing_id}: ${err?.message || "Could not create this invoice."}`);
      continue;
    }
    if (existingInvoiceId) {
      await query(
        `UPDATE altax.v3_recurring_billing SET last_run_date=$2, last_invoice_id=$3, next_run_date=$4, updated_at=now() WHERE recurring_billing_id=$1`,
        [schedule.recurring_billing_id, runDateString, existingInvoiceId, dateString(nextRecurringDate(nextRun, schedule.frequency, schedule.interval_count, schedule.repeat_on_day))]
      );
      skipped++;
      continue;
    }
    await query(
      `UPDATE altax.v3_recurring_billing SET last_run_date=$2, last_invoice_id=$3, next_run_date=$4, updated_at=now() WHERE recurring_billing_id=$1`,
      [schedule.recurring_billing_id, runDateString, invoiceId, dateString(nextRecurringDate(nextRun, schedule.frequency, schedule.interval_count, schedule.repeat_on_day))]
    );
    await logAudit("Billing", "RUN_RECURRING_BILLING", schedule.recurring_billing_id, "InvoiceID", "", invoiceId,
      `Recurring invoice created by ${actor.email}.`, actor.email);

    let emailSent = false;
    let emailSkippedReason: string | null = null;
    if (schedule.auto_send_invoice) {
      const client = await queryOne<any>(`SELECT email FROM altax.v3_clients WHERE client_id = $1`, [schedule.client_id]);
      if (!client?.email) {
        emailSkippedReason = "Client has no email on file.";
      } else {
        try {
          const { sendEmail } = await import("../../common/notifications");
          const built = await buildInvoicePdf(invoiceId);
          await sendEmail({
            to: client.email, subject: `Invoice ${invoiceId} from AL Tax Service`,
            html: await invoiceEmailHtml({
              message: `Please find your recurring invoice attached. Total due: $${amount.toFixed(2)}.`,
              invoiceId, invoiceDate: runDateString, dueDate, balanceDue: amount, req: opts.req,
            }),
            attachments: [{ filename: `Invoice_${invoiceId}.pdf`, content: Buffer.from(built!.pdfBytes) }],
          });
          emailSent = true;
          await logAudit("Billing", "SEND_INVOICE", invoiceId, "", "", "email: sent (auto)", `Recurring auto-send by schedule ${schedule.recurring_billing_id}.`, actor.email);
        } catch (err: any) {
          emailSkippedReason = err?.message || "Send failed.";
        }
      }
    }

    created.push({ invoiceId, recurringBillingId: schedule.recurring_billing_id, clientId: schedule.client_id, amount, emailSent, emailSkippedReason });
  }

  return { created, skipped, errors };
}

billingRouter.post("/recurring/run", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const result = await runRecurringBillingSweep(req.user!, { runDate: body.runDate, clientId: body.clientId, req });
  res.json({ ok: true, ...result });
}));

/**
 * Firm Invoice Payments — every payment recorded against a firm invoice, across all
 * clients, for the "Firm Invoice Payments" panel on the Billing page. No direct legacy
 * route to port from (that panel reads straight off the v3_Payments sheet in the
 * original app) — this is the equivalent query against Postgres. Optional ?start=&end=
 * bounds payment_date, matching the page's period picker. Same visibility scoping as
 * the invoice list: admin sees all, staff/general scoped to clients they have task
 * access to, client/employee get none (this is firm-side bookkeeping, not something
 * either portal role has a legacy equivalent for viewing in aggregate).
 */
billingRouter.get("/payments", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const role = req.user!.role;
  if (role === "client" || role === "employee") return res.json({ payments: [] });

  const start = String(req.query.start || "").trim();
  const end = String(req.query.end || "").trim();
  const conditions: string[] = [`p.status <> 'Reversed'`];
  const params: any[] = [];
  if (start) { params.push(start); conditions.push(`p.payment_date >= $${params.length}::timestamptz`); }
  if (end) { params.push(end); conditions.push(`p.payment_date <= $${params.length}::timestamptz`); }

  let clientScope = "";
  if (role !== "admin") {
    const aliases = await getUserAliases(req.user!.email);
    params.push(Array.from(aliases));
    clientScope = ` AND p.client_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($${params.length}::text[]))`;
  }

  const rows = await query<any>(
    `SELECT p.*, c.client_name FROM altax.v3_payments p
       LEFT JOIN altax.v3_clients c ON c.client_id = p.client_id
      WHERE ${conditions.join(" AND ")}${clientScope}
      ORDER BY p.payment_date DESC NULLS LAST`,
    params
  );
  const payments = rows.map(({ payment_routing_number, payment_account_number, ...rest }) => rest);
  res.json({ payments });
}));

/**
 * Client Tax Payment Tracking — client-owed tax obligations (as opposed to firm
 * invoices, which is AL TAX billing the client for services). Legacy sources this
 * panel from tasks flagged PaymentRequired=true; ported the same way here rather than
 * inventing a new table, since that's the only place this data actually lives —
 * agency_due_date/paid_date/payment_amount/confirmation_number are already real
 * columns on v3_tasks. Optional ?start=&end= bounds agency_due_date. Same task-level
 * visibility scoping as the Tasks list.
 */
billingRouter.get("/client-tax-payments", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const role = req.user!.role;
  if (role === "employee") return res.json({ rows: [] });

  if (role === "client") {
    const rows = await query(
      `SELECT t.task_id, t.task_name, t.client_id, t.client_name, t.agency_due_date, t.paid_date,
              t.payment_amount, t.confirmation_number, t.status
         FROM altax.v3_tasks t
        WHERE t.payment_required = true AND t.client_id = $1
        ORDER BY t.agency_due_date ASC NULLS LAST`,
      [req.user!.clientId]
    );
    return res.json({ rows });
  }

  const start = String(req.query.start || "").trim();
  const end = String(req.query.end || "").trim();
  const conditions: string[] = [`t.payment_required = true`];
  const params: any[] = [];
  if (start) { params.push(start); conditions.push(`t.agency_due_date >= $${params.length}::timestamptz`); }
  if (end) { params.push(end); conditions.push(`t.agency_due_date <= $${params.length}::timestamptz`); }

  if (role !== "admin") {
    const aliases = await getUserAliases(req.user!.email);
    params.push(Array.from(aliases));
    conditions.push(`lower(t.assigned_to) = ANY($${params.length}::text[])`);
  }

  const rows = await query(
    `SELECT t.task_id, t.task_name, t.client_id, t.client_name, t.agency_due_date, t.paid_date,
            t.payment_amount, t.confirmation_number, t.status, t.assigned_to
       FROM altax.v3_tasks t
      WHERE ${conditions.join(" AND ")}
      ORDER BY t.agency_due_date ASC NULLS LAST`,
    params
  );
  res.json({ rows });
}));
