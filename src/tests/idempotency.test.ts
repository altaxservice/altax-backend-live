/**
 * ACC-019/ACC-020 (Hard Audit, 2026-08-13) — regression coverage for the
 * idempotency-key protection added to payment recording and manual journal
 * entry posting. Same integration-test shape as moneyPaths.test.ts: hits the
 * real dev server + database with disposable, clearly-named records.
 *
 * Run with: npm test
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { pool, query, queryOne } from "../config/db";

dotenv.config();

const API = process.env.API_BASE || "http://localhost:4000";
const TEST_CLIENT = "C-1132"; // same disposable-data host moneyPaths.test.ts uses

let token = "";
let testInvoiceId = "";
const testJeIds: string[] = [];

function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
}

async function apiJson(path: string, init?: RequestInit): Promise<any> {
  const res = await api(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${body.error || JSON.stringify(body)}`);
  return body;
}

before(async () => {
  const secret = process.env.JWT_SECRET;
  assert.ok(secret, "JWT_SECRET must be set (load .env)");
  token = jwt.sign({ sub: "admin", role: "admin", email: "altax@almabarigroup.com" }, secret!, { expiresIn: "1h" });

  const health = await fetch(`${API}/health`).catch(() => null);
  assert.ok(health?.ok, `Dev server is not reachable at ${API} — start it first (npm run dev).`);

  const inv = await apiJson("/billing/invoices", {
    method: "POST",
    body: JSON.stringify({ clientId: TEST_CLIENT, description: "ZZ Idempotency Test Invoice", lineItems: [{ description: "Test line", quantity: 1, rate: 500 }] }),
  });
  testInvoiceId = inv.invoiceId;
  assert.ok(testInvoiceId, "test invoice was not created");
});

after(async () => {
  try {
    if (testInvoiceId) {
      await query(`DELETE FROM altax.v3_gl_entries WHERE ref = $1 OR ref IN (SELECT payment_id FROM altax.v3_payments WHERE invoice_id = $1)`, [testInvoiceId]).catch(() => {});
      await query(`DELETE FROM altax.v3_payments WHERE invoice_id = $1`, [testInvoiceId]).catch(() => {});
      await query(`DELETE FROM altax.v3_invoices WHERE invoice_id = $1`, [testInvoiceId]).catch(() => {});
    }
    for (const jeId of testJeIds) {
      await query(`DELETE FROM altax.v3_gl_entries WHERE ref = $1`, [jeId]).catch(() => {});
      await query(`DELETE FROM altax.v3_manual_je WHERE journal_entry_id = $1`, [jeId]).catch(() => {});
    }
    await query(`DELETE FROM altax.v3_idempotency_keys WHERE idempotency_key LIKE 'ZZ-IDEMPOTENCY-TEST-%'`).catch(() => {});
  } finally {
    await pool.end().catch(() => {});
  }
});

test("record payment: resubmitting the same idempotency key does not double-post", async () => {
  const key = `ZZ-IDEMPOTENCY-TEST-${crypto.randomUUID()}`;
  const body = JSON.stringify({ actualAmount: 200, method: "Check", idempotencyKey: key });

  const first = await apiJson(`/billing/invoices/${testInvoiceId}/payments`, { method: "POST", body });
  const second = await apiJson(`/billing/invoices/${testInvoiceId}/payments`, { method: "POST", body });

  assert.equal(second.paymentId, first.paymentId, "the duplicate submit must return the SAME paymentId, not create a new one");

  const payments = await query<any>(`SELECT payment_id FROM altax.v3_payments WHERE invoice_id = $1`, [testInvoiceId]);
  assert.equal(payments.length, 1, "only one payment row may exist after two identical submits");

  const invoice = await queryOne<any>(`SELECT amount_paid FROM altax.v3_invoices WHERE invoice_id = $1`, [testInvoiceId]);
  assert.equal(Number(invoice!.amount_paid), 200, "amount_paid must reflect ONE $200 payment, not two");
});

test("manual journal entry: resubmitting the same idempotency key does not double-post", async () => {
  const key = `ZZ-IDEMPOTENCY-TEST-${crypto.randomUUID()}`;
  const body = JSON.stringify({
    clientId: TEST_CLIENT, description: "ZZ Idempotency Test JE", idempotencyKey: key,
    lines: [{ account: "Cash", debit: 50, credit: 0 }, { account: "Owner's Equity", debit: 0, credit: 50 }],
  });

  const first = await apiJson("/accounting/journal-entries", { method: "POST", body });
  testJeIds.push(first.jeId);
  const second = await apiJson("/accounting/journal-entries", { method: "POST", body });

  assert.equal(second.jeId, first.jeId, "the duplicate submit must return the SAME jeId, not create a new entry");

  const lines = await query<any>(`SELECT debit, credit FROM altax.v3_gl_entries WHERE ref = $1`, [first.jeId]);
  const debits = lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
  const credits = lines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
  assert.equal(debits, 50, "GL must carry exactly one $50 debit posting, not two");
  assert.equal(credits, 50, "GL must carry exactly one $50 credit posting, not two");
});

test("manual journal entry: a fresh idempotency key still creates a genuinely new entry", async () => {
  const body1 = JSON.stringify({
    clientId: TEST_CLIENT, description: "ZZ Idempotency Test JE A", idempotencyKey: `ZZ-IDEMPOTENCY-TEST-${crypto.randomUUID()}`,
    lines: [{ account: "Cash", debit: 10, credit: 0 }, { account: "Owner's Equity", debit: 0, credit: 10 }],
  });
  const body2 = JSON.stringify({
    clientId: TEST_CLIENT, description: "ZZ Idempotency Test JE B", idempotencyKey: `ZZ-IDEMPOTENCY-TEST-${crypto.randomUUID()}`,
    lines: [{ account: "Cash", debit: 10, credit: 0 }, { account: "Owner's Equity", debit: 0, credit: 10 }],
  });
  const a = await apiJson("/accounting/journal-entries", { method: "POST", body: body1 });
  const b = await apiJson("/accounting/journal-entries", { method: "POST", body: body2 });
  testJeIds.push(a.jeId, b.jeId);
  assert.notEqual(a.jeId, b.jeId, "two distinct submissions (distinct keys) must never collapse into one entry");
});
