/**
 * Money-path test suite — the automated version of the manual verification
 * ritual every payroll/sales change has gone through by hand.
 *
 * Every bug this app has shipped in the money code was caught by a human
 * running these exact checks manually (the edit-hours-kept-old-pay bug, the
 * half-posted payroll GL entries). This file makes the machine run them.
 *
 * These are INTEGRATION tests: they need the dev server on :4000 (or API_BASE)
 * and hit the real database with clearly-named disposable records that are
 * removed in cleanup even when assertions fail. Read-only checks (sales
 * previews) use real clients; nothing here mutates real client data.
 *
 * Run with: npm test
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { pool, query, queryOne } from "../config/db";
import { encryptBackup, decryptBackup, isEncryptedBackup } from "../common/autoBackup";

dotenv.config();

const API = process.env.API_BASE || "http://localhost:4000";
const TEST_CLIENT = "C-1132"; // the firm's own MD record — same disposable-data host used by manual verification
const TEST_EMPLOYEE = "ZZ Money Path Test Employee";

let token = "";
let employeeId = "";
let paycheckId = "";

function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

async function apiJson(path: string, init?: RequestInit): Promise<any> {
  const res = await api(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${body.error || JSON.stringify(body)}`);
  return body;
}

const money = (n: number) => Math.round(n * 100) / 100;

before(async () => {
  const secret = process.env.JWT_SECRET;
  assert.ok(secret, "JWT_SECRET must be set (load .env)");
  token = jwt.sign({ sub: "admin", role: "admin", email: "altax@almabarigroup.com" }, secret!, { expiresIn: "1h" });

  const health = await fetch(`${API}/health`).catch(() => null);
  assert.ok(health?.ok, `Dev server is not reachable at ${API} — start it first (npm run dev).`);

  const created = await apiJson("/accounting/employees", {
    method: "POST",
    body: JSON.stringify({ clientId: TEST_CLIENT, employeeName: TEST_EMPLOYEE, workerType: "Employee", payType: "Hourly", payRate: "20" }),
  });
  employeeId = created.employeeId;
  assert.ok(employeeId, "test employee was not created");
});

after(async () => {
  // Cleanup must survive failed assertions — every branch swallows its own errors
  // so one failure can't strand test rows in the production database.
  try {
    const checks = await query<any>(`SELECT paycheck_id FROM altax.v3_paychecks WHERE employee = $1`, [TEST_EMPLOYEE]);
    for (const c of checks) {
      await query(`DELETE FROM altax.v3_gl_entries WHERE ref = $1`, [c.paycheck_id]).catch(() => {});
      await query(`DELETE FROM altax.v3_paychecks WHERE paycheck_id = $1`, [c.paycheck_id]).catch(() => {});
    }
    await query(`DELETE FROM altax.v3_payroll_input WHERE employee = $1`, [TEST_EMPLOYEE]).catch(() => {});
    if (employeeId) await query(`DELETE FROM altax.v3_employees WHERE employee_id = $1`, [employeeId]).catch(() => {});
    await query(
      `DELETE FROM altax.v3_audit_log WHERE record_id = $1 OR note ILIKE $2 OR new_value ILIKE $2`,
      [employeeId || "-", `%${TEST_EMPLOYEE}%`]
    ).catch(() => {});
  } finally {
    await pool.end().catch(() => {});
  }
});

test("paycheck create: taxes, net pay and GL all agree", async () => {
  const res = await apiJson("/accounting/payroll", {
    method: "POST",
    body: JSON.stringify({ clientId: TEST_CLIENT, employee: TEST_EMPLOYEE, payDate: "2026-07-20", regularHours: "10", regularRate: "20" }),
  });
  paycheckId = res.paycheckId;

  assert.equal(money(res.gross), 200, "10h x $20 must gross $200");
  const row = await queryOne<any>(`SELECT * FROM altax.v3_paychecks WHERE paycheck_id = $1`, [paycheckId]);
  assert.ok(row, "paycheck row must exist");

  // Statutory percentages: these are law, not configuration.
  assert.equal(Number(row.social_security_ee), money(Number(row.social_security_wages) * 0.062), "employee Social Security must be 6.2% of SS wages");
  assert.equal(Number(row.medicare_ee), money(Number(row.medicare_wages) * 0.0145), "employee Medicare must be 1.45% of Medicare wages");

  // Internal consistency: the row must not contradict itself.
  assert.equal(Number(row.net_pay), money(Number(row.gross_wages) - Number(row.total_deductions) - Number(row.employee_taxes)), "net = gross - deductions - employee taxes");
  assert.equal(Number(row.total_cost), money(Number(row.gross_wages) + Number(row.employer_taxes)), "total cost = gross + employer taxes");

  // The ledger must balance for this posting.
  const gl = await query<any>(`SELECT debit, credit FROM altax.v3_gl_entries WHERE ref = $1`, [paycheckId]);
  assert.ok(gl.length >= 3, "payroll must post at least 3 GL lines");
  const debits = money(gl.reduce((s, l) => s + Number(l.debit || 0), 0));
  const credits = money(gl.reduce((s, l) => s + Number(l.credit || 0), 0));
  assert.equal(debits, credits, `payroll GL out of balance: debits ${debits} vs credits ${credits}`);
});

test("paycheck edit: changing hours recalculates pay (regression: gross once stayed stale)", async () => {
  await apiJson(`/accounting/paychecks/${paycheckId}`, {
    method: "PATCH",
    body: JSON.stringify({ regularHours: "20" }),
  });
  const row = await queryOne<any>(`SELECT * FROM altax.v3_paychecks WHERE paycheck_id = $1`, [paycheckId]);
  assert.equal(Number(row.gross_wages), 400, "20h x $20 must re-gross to $400 — if this is 200, the stale-gross bug is back");
  assert.equal(Number(row.regular_hours), 20);
  assert.equal(Number(row.regular_pay), 400, "the earnings breakdown must be rewritten, not frozen at its pre-edit value");

  const gl = await query<any>(`SELECT debit, credit FROM altax.v3_gl_entries WHERE ref = $1`, [paycheckId]);
  const debits = money(gl.reduce((s, l) => s + Number(l.debit || 0), 0));
  const credits = money(gl.reduce((s, l) => s + Number(l.credit || 0), 0));
  assert.equal(debits, credits, "GL must be reposted in balance after an edit");
  const wages = gl.find((l: any) => Number(l.debit) >= 400);
  assert.ok(wages, "reposted GL must carry the new $400 wage expense");
});

test("paycheck delete: removes the check and every GL line, and requires the typed confirm", async () => {
  const refused = await api(`/accounting/paychecks/${paycheckId}/delete`, { method: "POST", body: JSON.stringify({ confirm: "yes" }) });
  assert.equal(refused.status, 400, "delete without the exact confirm phrase must be refused");

  await apiJson(`/accounting/paychecks/${paycheckId}/delete`, { method: "POST", body: JSON.stringify({ confirm: "DELETE PAYCHECK" }) });
  const left = await queryOne<any>(`SELECT COUNT(*)::int AS n FROM altax.v3_paychecks WHERE paycheck_id = $1`, [paycheckId]);
  const glLeft = await queryOne<any>(`SELECT COUNT(*)::int AS n FROM altax.v3_gl_entries WHERE ref = $1`, [paycheckId]);
  assert.equal(left!.n, 0, "paycheck must be gone");
  assert.equal(glLeft!.n, 0, "its GL lines must be gone with it");
});

test("sales tax previews: MD / DC / PA rates compute per state law", async () => {
  const md = await apiJson("/accounting/sales/preview", {
    method: "POST",
    body: JSON.stringify({ clientId: TEST_CLIENT, categoryLines: [{ categoryId: "CAT-MD-ST6", taxableAmount: 100 }] }),
  });
  assert.equal(md.totalTaxDue, 6, "MD general 6% on $100");

  const dc = await apiJson("/accounting/sales/preview", {
    method: "POST",
    body: JSON.stringify({ clientId: "C-8358", categoryLines: [{ categoryId: "CAT-DC-SOFTDRINK", taxableAmount: 100 }] }),
  });
  assert.equal(dc.totalTaxDue, 8, "DC soft drinks 8% on $100");

  const pa = await apiJson("/accounting/sales/preview", {
    method: "POST",
    body: JSON.stringify({
      clientId: "C-8359",
      categoryLines: [
        { categoryId: "CAT-PA-GENERAL", taxableAmount: 100 },
        { categoryId: "CAT-PA-PHILA", taxableAmount: 100 },
      ],
    }),
  });
  assert.equal(pa.totalTaxDue, 8, "PA 6% state + 2% Philadelphia local on $100 each");
});

test("sales preview writes nothing", async () => {
  const before_ = await queryOne<any>(`SELECT COUNT(*)::int AS n FROM altax.v3_sales_input`);
  await apiJson("/accounting/sales/preview", {
    method: "POST",
    body: JSON.stringify({ clientId: TEST_CLIENT, categoryLines: [{ categoryId: "CAT-MD-ST6", taxableAmount: 55 }] }),
  });
  const after_ = await queryOne<any>(`SELECT COUNT(*)::int AS n FROM altax.v3_sales_input`);
  assert.equal(after_!.n, before_!.n, "preview must never create a sale");
});

test("backup encryption: round-trips exactly and fails closed on tampering", () => {
  const original = JSON.stringify({ schema: "altax", data: { t: [{ a: 1, b: "x" }] } });
  const enc = encryptBackup(original);
  assert.ok(isEncryptedBackup(enc));
  assert.equal(decryptBackup(enc), original, "decrypt(encrypt(x)) must equal x byte-for-byte");

  const [magic, blob] = enc.split("\n");
  const flipped = blob.slice(0, 80) + (blob[80] === "A" ? "B" : "A") + blob.slice(81);
  assert.throws(() => decryptBackup(`${magic}\n${flipped}`), "a tampered backup must refuse to decrypt, never return garbage");
});
