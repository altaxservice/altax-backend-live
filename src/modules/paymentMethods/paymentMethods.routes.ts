import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { encryptValue } from "../../common/encryption";
import { decryptTolerant } from "../../common/accountingHelpers";

/**
 * Payment Methods module — Phase 5, previously deferred. Ported from
 * alTaxPortalSavePaymentMethod / alTaxPortalDeletePaymentMethod. Admin/staff only
 * (alTaxV5RequireFirmUser_), scoped to clients the caller can access.
 *
 * Security improvement over legacy, not a literal port: legacy stores AccountNumber
 * and RoutingNumber as PLAIN TEXT in the sheet. This backend encrypts both fields
 * server-side (src/common/encryption.ts — the same envelope encryption built for the
 * Secure Vault) before they ever reach Postgres; only the last-4 digits are ever
 * stored or returned in plaintext, matching what the legacy UI already displays.
 * Storing full bank account/routing numbers in plaintext is exactly the kind of
 * technical defect the plan's rule #1 carves out ("preserve behavior unless a defect
 * is found") — this isn't a behavior change users would notice, just closing a real
 * exposure the legacy system had.
 *
 * "Credit Card" is deliberately a reference-only record — brand, cardholder name,
 * last 4 digits, expiry month/year — never a full card number, and never a CVV under
 * any circumstances (a PCI-DSS rule with no exceptions, not a style choice). This
 * backend has no payment processor to tokenize a real card, so storing the full PAN
 * would put the business in PCI-DSS scope for no operational benefit; the user chose
 * this reference-only approach explicitly when asked (2026-07-11) rather than storing
 * the full number encrypted (which remains an option only once a real processor is
 * connected) or removing the Credit Card type outright.
 */
export const paymentMethodsRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
}

function onlyDigits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

function requiresBankDetails(methodType: string): boolean {
  return ["ach", "check", "direct deposit", "wire"].includes(methodType.trim().toLowerCase());
}
function isCardType(methodType: string): boolean {
  return methodType.trim().toLowerCase() === "credit card";
}
const CARD_BRANDS = ["Visa", "Mastercard", "American Express", "Discover", "Other"];

/** Strips encrypted fields from a row before it's ever sent to a client — last4_hint is the only account-number-derived value that leaves this backend. */
function toSafeRow(row: any) {
  const { account_number, routing_number, ...safe } = row;
  return safe;
}

/**
 * Create or update a payment method — ported from alTaxPortalSavePaymentMethod.
 * Account/routing numbers are encrypted before storage (see module doc comment).
 */
paymentMethodsRouter.post("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const clientId = String(body.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "Client is required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const methodName = String(body.methodName || "").trim();
  if (!methodName) return res.status(400).json({ error: "Method name is required." });

  const methodType = String(body.methodType || "ACH").trim();
  const accountNumber = String(body.accountNumber || "").trim();
  const confirmAccountNumber = String(body.confirmAccountNumber || "").trim();
  const routingNumber = String(body.routingNumber || "").trim();
  const bankName = String(body.bankName || "").trim();

  if ((accountNumber || confirmAccountNumber) && onlyDigits(accountNumber) !== onlyDigits(confirmAccountNumber)) {
    return res.status(400).json({ error: "Account number confirmation does not match." });
  }
  const paymentMethodIdForLookup = String(body.paymentMethodId || "").trim();
  const existingForValidation = paymentMethodIdForLookup
    ? await queryOne<any>(`SELECT * FROM altax.v3_payment_methods WHERE payment_method_id = $1`, [paymentMethodIdForLookup])
    : null;
  // A blank routing/account field is only an error on a brand-new bank-type row;
  // editing an existing one (e.g. just to flip a default-for flag) can leave them
  // blank and keep whatever's already stored — see the fallback below.
  if (requiresBankDetails(methodType)) {
    if (!bankName && !existingForValidation?.bank_name) return res.status(400).json({ error: "Bank name is required for check/ACH payment methods." });
    if (onlyDigits(routingNumber).length !== 9 && !existingForValidation?.routing_number) return res.status(400).json({ error: "Routing number must be 9 digits." });
    if (!onlyDigits(accountNumber) && !existingForValidation?.account_number) return res.status(400).json({ error: "Account number is required." });
  }

  // Reference-only card fields — see module doc comment. A full card number or CVV is
  // never accepted here under any field name, by design, not merely unused.
  const cardBrand = String(body.cardBrand || "").trim();
  const cardholderName = String(body.cardholderName || "").trim();
  const cardLast4 = onlyDigits(body.cardLast4).slice(-4);
  const cardExpMonth = Number(body.cardExpMonth) || null;
  const cardExpYear = Number(body.cardExpYear) || null;
  if (isCardType(methodType)) {
    if (cardBrand && !CARD_BRANDS.includes(cardBrand)) return res.status(400).json({ error: "Unrecognized card brand." });
    if (cardLast4 && cardLast4.length !== 4) return res.status(400).json({ error: "Card last 4 digits must be exactly 4 digits." });
    if (cardExpMonth && (cardExpMonth < 1 || cardExpMonth > 12)) return res.status(400).json({ error: "Card expiry month must be 1-12." });
  }

  const paymentMethodId = paymentMethodIdForLookup || `PM-${idSuffix()}`;
  const existing = existingForValidation;
  const bankLast4 = String(body.bankLast4 || "").trim() || onlyDigits(accountNumber).slice(-4) || (existing ? existing.bank_last4 : null);
  const phone = String(body.phone || "").trim() || null;
  const defaultForPayroll = body.defaultForPayroll === undefined ? false : Boolean(body.defaultForPayroll);
  const defaultForInvoices = body.defaultForInvoices === undefined ? false : Boolean(body.defaultForInvoices);

  // Editing (e.g. just to flip a default-for flag) doesn't require re-entering the
  // account/routing numbers — falling through to null here would silently wipe them,
  // so an untouched field on an existing row keeps its current encrypted value.
  const fields = [
    clientId, client.client_name, methodName, methodType, bankName || (existing ? existing.bank_name : null),
    routingNumber ? encryptValue(routingNumber) : (existing ? existing.routing_number : null),
    accountNumber ? encryptValue(accountNumber) : (existing ? existing.account_number : null),
    String(body.accountType || "").trim() || (existing ? existing.account_type : null), bankLast4, phone,
    cardBrand || null, cardholderName || null, cardLast4 || null, cardExpMonth, cardExpYear,
    body.useForPayroll === undefined ? true : Boolean(body.useForPayroll),
    body.useForInvoices === undefined ? true : Boolean(body.useForInvoices),
    defaultForPayroll, defaultForInvoices,
    String(body.status || "Active").trim(), String(body.notes || "").trim() || null,
  ];

  if (existing) {
    await query(
      `UPDATE altax.v3_payment_methods SET
         client_id=$2, client_name=$3, method_name=$4, method_type=$5, bank_name=$6, routing_number=$7,
         account_number=$8, account_type=$9, bank_last4=$10, phone=$11, card_brand=$12, cardholder_name=$13,
         card_last4=$14, card_exp_month=$15, card_exp_year=$16, use_for_payroll=$17, use_for_invoices=$18,
         default_for_payroll=$19, default_for_invoices=$20, status=$21, notes=$22, updated_at=now()
       WHERE payment_method_id=$1`,
      [paymentMethodId, ...fields]
    );
  } else {
    const columns = ["payment_method_id", "client_id", "client_name", "method_name", "method_type", "bank_name",
      "routing_number", "account_number", "account_type", "bank_last4", "phone", "card_brand", "cardholder_name",
      "card_last4", "card_exp_month", "card_exp_year", "use_for_payroll", "use_for_invoices",
      "default_for_payroll", "default_for_invoices", "status", "notes", "source_system", "source_record_id"];
    const values = [paymentMethodId, ...fields, "Node Web App", paymentMethodId];
    await query(`INSERT INTO altax.v3_payment_methods (${columns.join(", ")}) VALUES (${values.map((_, i) => `$${i + 1}`).join(", ")})`, values);
  }

  // Mirrors alTaxV5EnforcePaymentMethodDefaults_: clear the other default flags for this client if this one was just made default.
  if (defaultForPayroll) await query(`UPDATE altax.v3_payment_methods SET default_for_payroll = false WHERE client_id = $1 AND payment_method_id <> $2`, [clientId, paymentMethodId]);
  if (defaultForInvoices) await query(`UPDATE altax.v3_payment_methods SET default_for_invoices = false WHERE client_id = $1 AND payment_method_id <> $2`, [clientId, paymentMethodId]);

  await logAudit("Accounting", "SAVE_PAYMENT_METHOD", paymentMethodId, "ClientID", "", clientId,
    `Payment method saved by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, paymentMethodId });
}));

/** List a client's payment methods — never returns account/routing numbers, encrypted or otherwise. */
paymentMethodsRouter.get("/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const rows = await query<any>(`SELECT * FROM altax.v3_payment_methods WHERE client_id = $1 ORDER BY method_name ASC`, [clientId]);
  res.json({ paymentMethods: rows.map(toSafeRow) });
}));

/**
 * Reveal one payment method's decrypted account/routing numbers — separate,
 * individually auditable action, same philosophy as the Vault's reveal route.
 */
paymentMethodsRouter.get("/:clientId/:paymentMethodId/reveal", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, paymentMethodId } = req.params;
  const row = await queryOne<any>(`SELECT * FROM altax.v3_payment_methods WHERE payment_method_id = $1 AND client_id = $2`, [paymentMethodId, clientId]);
  if (!row) return res.status(404).json({ error: "Payment method not found." });

  const accountNumber = row.account_number ? decryptTolerant(row.account_number) : null;
  const routingNumber = row.routing_number ? decryptTolerant(row.routing_number) : null;

  await logAudit("Accounting", "REVEAL_PAYMENT_METHOD", paymentMethodId, "", "", "",
    `Payment method details revealed by ${req.user!.email}.`, req.user!.email);

  res.json({ paymentMethodId, accountNumber, routingNumber });
}));

/** Hard delete — ported from alTaxPortalDeletePaymentMethod. Legacy does hard-delete this one; unlike client/task/invoice hard-deletes, there's no financial history dependent on a payment method row surviving (payments/paychecks store their own snapshot of bank details at time of payment), so this is safe to port as-is. */
paymentMethodsRouter.post("/:clientId/:paymentMethodId/delete", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, paymentMethodId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const row = await queryOne<any>(`SELECT payment_method_id FROM altax.v3_payment_methods WHERE payment_method_id = $1 AND client_id = $2`, [paymentMethodId, clientId]);
  if (!row) return res.status(404).json({ error: "Payment method not found." });

  await query(`DELETE FROM altax.v3_payment_methods WHERE payment_method_id = $1 AND client_id = $2`, [paymentMethodId, clientId]);
  await logAudit("Accounting", "DELETE_PAYMENT_METHOD", paymentMethodId, "PaymentMethodID", paymentMethodId, "",
    `Payment method deleted by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, paymentMethodId });
}));
