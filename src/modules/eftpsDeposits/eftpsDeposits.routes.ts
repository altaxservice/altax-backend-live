import { Router, Response } from "express";
import crypto from "crypto";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler, ValidationError } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { logAudit } from "../../common/audit";
import { readWorkbookRows } from "../../common/xlsxReader";
import { scanFileForMalware } from "../../common/malwareScan";
import { publicBaseUrl } from "../../common/publicUrl";
import { schedulePaymentReminder, cancelPaymentReminder } from "../../common/paymentReminders";
import { sendEftpsDepositReport } from "../../common/filingConfirmationEmail";
import { closeEftpsStaffTask } from "./eftpsStaffTasks";
import { closeObligationTask, deriveTaskRulesPeriodLabel } from "../../common/taskRulesAgentBridge";
import { generateEftpsDepositPdf } from "./eftpsDepositPdf";
import {
  looksLikeDrakeTaxLiabilityByCheckDate, parseDrakeTaxLiabilityByCheckDate,
  looksLikeDrakePayrollWagesDetail, parseDrakePayrollWagesDetail,
  parseDrakeReportDateRange, type DrakeFederalPaycheckDetail, type DrakeTaxLiabilitySummary,
} from "../payrollImport/parsers";
import { computeEftpsBreakdown } from "./eftpsReconciliation";
import { decryptTolerant } from "../../common/encryption";

export const eftpsDepositsRouter = Router();

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

/**
 * A 3-digit random suffix (900 possible values) collided under a same-second
 * bulk-insert loop (confirmed live — 24 paychecks imported at once). Matches
 * paymentReminders.ts's approach instead: a UUID-derived suffix has enough
 * entropy that a same-second collision is not a real risk.
 */
function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

type LoadClientResult = { error: string; status: number } | { client: { client_id: string; client_name: string; email: string | null; email_allowed: boolean } };

async function loadClient(req: AuthedRequest, clientId: string): Promise<LoadClientResult> {
  if (!clientId) return { error: "Client is required.", status: 400 };
  if (!(await canAccessClient(req.user!, clientId))) return { error: "You do not have access to this client.", status: 403 };
  const client = await queryOne<any>(`SELECT client_id, client_name, email, email_allowed FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return { error: "Client not found.", status: 404 };
  return { client };
}

type LoadDepositResult = { error: string; status: number } | { deposit: any };

async function loadDeposit(req: AuthedRequest, depositId: string): Promise<LoadDepositResult> {
  if (!depositId) return { error: "Deposit is required.", status: 400 };
  const deposit = await queryOne<any>(`SELECT * FROM altax.v3_eftps_deposits WHERE deposit_id = $1`, [depositId]);
  if (!deposit) return { error: "Deposit not found.", status: 404 };
  if (!(await canAccessClient(req.user!, deposit.client_id))) return { error: "You do not have access to this client.", status: 403 };
  return { deposit };
}

/** v3_eftps_deposits.due_date comes back from `SELECT *` as a JS Date object, not a string — String(date) yields a locale format ("Tue Sep 15 2026 ..."), not ISO, so it must go through toISOString() before use in a reminder's source_record_id. */
function isoDate(v: unknown): string {
  return new Date(v as string).toISOString().slice(0, 10);
}

/** v3_eftps_deposits has no stored label column — period_start/period_end are always the source of truth, formatted fresh wherever a human-readable label is needed (email, PDF). Accepts either a plain "YYYY-MM-DD" string (request-body values) or a JS Date object (a `SELECT *` row) — String(date) would shift UTC midnight back a day in local time, so a Date always goes through isoDate() first. */
function fmtPeriodLabel(start: unknown, end: unknown): string {
  const fmt = (v: unknown) => {
    const raw = v instanceof Date ? isoDate(v) : String(v).slice(0, 10);
    const d = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

function decodeUpload(fileBase64: string, label: string): Buffer {
  const cleaned = String(fileBase64 || "").trim();
  if (!cleaned) throw new ValidationError(`${label} file is required.`);
  const sizeBytes = Math.ceil((cleaned.length * 3) / 4);
  if (sizeBytes > MAX_IMPORT_BYTES) throw new ValidationError(`The ${label} file is too large — imports are limited to 8MB.`);
  try {
    return Buffer.from(cleaned, "base64");
  } catch {
    throw new ValidationError(`Could not read the ${label} file.`);
  }
}

/* ------------------------------------------------------------------ */
/* Import: Payroll Wages — any date range, any time, no period gate    */
/* ------------------------------------------------------------------ */

eftpsDepositsRouter.post("/import/payroll-wages/preview", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const loaded = await loadClient(req, String(body.clientId || "").trim());
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  try {
    const buffer = decodeUpload(body.fileBase64, "Payroll Wages");
    const scan = await scanFileForMalware(buffer, "eftps-payroll-wages");
    if (!scan.clean) return res.status(400).json({ error: "This file failed a security scan and could not be processed." });

    const rows = readWorkbookRows(buffer);
    if (!looksLikeDrakePayrollWagesDetail(rows)) {
      return res.status(400).json({ error: "That doesn't look like Drake's \"Payroll Wages\" report. Please double-check the file." });
    }
    const paychecks = parseDrakePayrollWagesDetail(rows);
    if (!paychecks.length) return res.status(400).json({ error: "No paychecks were found in this file." });

    const existing = await query<any>(
      `SELECT employee_name, pay_date::text AS pay_date, check_number FROM altax.v3_eftps_paycheck_import WHERE client_id = $1`,
      [client.client_id]
    );
    const existingKeys = new Set(existing.map((r: any) => `${r.employee_name}|${r.pay_date}|${r.check_number || ""}`));

    const previewRows = paychecks.map((p) => {
      const key = `${p.employeeName}|${p.payDate}|${p.checkNumber || ""}`;
      return { ...p, action: existingKeys.has(key) ? "duplicate" : "create" };
    });
    const newCount = previewRows.filter((r) => r.action === "create").length;
    res.json({ ok: true, rows: previewRows, newCount, duplicateCount: previewRows.length - newCount });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
}));

eftpsDepositsRouter.post("/import/payroll-wages/commit", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const loaded = await loadClient(req, String(body.clientId || "").trim());
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  const rows: DrakeFederalPaycheckDetail[] = Array.isArray(body.rows) ? body.rows.slice(0, 2000) : [];
  if (!rows.length) return res.status(400).json({ error: "No rows to import." });

  // ON CONFLICT DO NOTHING against uq_eftps_paycheck_import_key (sql/125) makes
  // a true duplicate structurally impossible, regardless of how many times this
  // route is called with the same file — confirmed live on client C-1005: the
  // same Drake export got re-imported 3 separate times over a few hours despite
  // an app-level SELECT-then-insert check and a confirm dialog, each time
  // doubling every federal deposit total. This replaces that fragile check
  // entirely rather than adding another layer on top of it.
  let created = 0, skipped = 0;
  for (const r of rows) {
    const employeeName = String(r.employeeName || "").trim();
    const payDate = String(r.payDate || "").trim();
    if (!employeeName || !payDate) { skipped++; continue; }
    const checkNumber = r.checkNumber ? String(r.checkNumber).trim() : null;

    const inserted = await query<{ id: string }>(
      `INSERT INTO altax.v3_eftps_paycheck_import
         (id, client_id, employee_name, pay_date, check_number, federal_withheld, social_security_withheld, medicare_withheld, source_system, source_record_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'EFTPS Payroll Wages Import',$1)
       ON CONFLICT (client_id, employee_name, pay_date, COALESCE(check_number, '')) DO NOTHING
       RETURNING id`,
      [`EFTPSPC-${idSuffix()}`, client.client_id, employeeName, payDate, checkNumber,
        Number(r.federalWithheld) || 0, Number(r.socialSecurityWithheld) || 0, Number(r.medicareWithheld) || 0]
    );
    if (inserted.length) created++; else skipped++;
  }

  await logAudit("Clients", "IMPORT_EFTPS_PAYCHECKS", client.client_id, "", "", `${created}/${rows.length}`,
    `Imported ${created} paycheck(s) for EFTPS from Payroll Wages by ${req.user!.email} (${skipped} already on file, skipped).`, req.user!.email);

  res.status(201).json({ ok: true, created, skipped });
}));

/* ------------------------------------------------------------------ */
/* Import: Tax Liability by Check Date — one snapshot per upload       */
/* ------------------------------------------------------------------ */

eftpsDepositsRouter.post("/import/tax-liability/preview", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const loaded = await loadClient(req, String(body.clientId || "").trim());
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  try {
    const buffer = decodeUpload(body.fileBase64, "Tax Liability by Check Date");
    const scan = await scanFileForMalware(buffer, "eftps-tax-liability");
    if (!scan.clean) return res.status(400).json({ error: "This file failed a security scan and could not be processed." });

    const rows = readWorkbookRows(buffer);
    if (!looksLikeDrakeTaxLiabilityByCheckDate(rows)) {
      return res.status(400).json({ error: "That doesn't look like Drake's \"Tax Liability by Check Date\" report. Please double-check the file." });
    }
    const range = parseDrakeReportDateRange(rows);
    if (!range) return res.status(400).json({ error: "Could not find a \"Check Dates\" range on this file — please confirm it's a real Drake export." });
    const summary = parseDrakeTaxLiabilityByCheckDate(rows);

    const existing = await queryOne<any>(
      `SELECT id FROM altax.v3_eftps_tax_liability_import WHERE client_id = $1 AND range_start = $2 AND range_end = $3`,
      [client.client_id, range.start, range.end]
    );

    res.json({ ok: true, range, summary, action: existing ? "duplicate" : "create" });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
}));

eftpsDepositsRouter.post("/import/tax-liability/commit", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const loaded = await loadClient(req, String(body.clientId || "").trim());
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  try {
    const rangeStart = String(body.rangeStart || "").trim();
    const rangeEnd = String(body.rangeEnd || "").trim();
    if (!rangeStart || !rangeEnd) throw new ValidationError("A valid date range is required.");
    const summary: DrakeTaxLiabilitySummary | undefined = body.summary;
    if (!summary) throw new ValidationError("No parsed summary to import.");

    // Upsert against uq_eftps_tax_liability_import_key (sql/125) — a snapshot
    // isn't summed the way paychecks are (only the latest is ever used for
    // reconciliation), so re-importing the same range is never a correctness
    // risk; it just refreshes the numbers instead of piling up duplicate rows.
    await query(
      `INSERT INTO altax.v3_eftps_tax_liability_import
         (id, client_id, range_start, range_end, federal_income_tax, social_security, medicare, total_941, imported_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (client_id, range_start, range_end) DO UPDATE SET
         federal_income_tax = EXCLUDED.federal_income_tax, social_security = EXCLUDED.social_security,
         medicare = EXCLUDED.medicare, total_941 = EXCLUDED.total_941,
         imported_by = EXCLUDED.imported_by, imported_at = now()`,
      [`EFTPSTL-${idSuffix()}`, client.client_id, rangeStart, rangeEnd,
        Number(summary.federalIncomeTax) || 0, Number(summary.socialSecurity) || 0, Number(summary.medicare) || 0, Number(summary.total941) || 0,
        req.user!.email]
    );

    await logAudit("Clients", "IMPORT_EFTPS_TAX_LIABILITY", client.client_id, "", "", `${rangeStart} to ${rangeEnd}`,
      `Imported a Tax Liability snapshot (${rangeStart} to ${rangeEnd}) by ${req.user!.email}.`, req.user!.email);

    res.status(201).json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
}));

/* ------------------------------------------------------------------ */
/* Imported data: raw list + delete, so staff can inspect and clean up */
/* an import themselves instead of it requiring a direct DB fix — the  */
/* database-level unique constraint (sql/125) prevents new duplicates  */
/* going forward, but doesn't retroactively clean up rows imported     */
/* before it existed.                                                  */
/* ------------------------------------------------------------------ */

eftpsDepositsRouter.get("/paycheck-import", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.query.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "Client is required." });
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const rows = await query<any>(
    `SELECT id, employee_name, pay_date::text AS pay_date, check_number, federal_withheld, social_security_withheld, medicare_withheld, created_at
       FROM altax.v3_eftps_paycheck_import WHERE client_id = $1 ORDER BY pay_date DESC, employee_name`,
    [clientId]
  );
  res.json({ rows });
}));

eftpsDepositsRouter.post("/paycheck-import/:id/delete", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const row = await queryOne<any>(`SELECT id, client_id, employee_name, pay_date::text AS pay_date FROM altax.v3_eftps_paycheck_import WHERE id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: "Row not found." });
  if (!(await canAccessClient(req.user!, row.client_id))) return res.status(403).json({ error: "You do not have access to this client." });

  await query(`DELETE FROM altax.v3_eftps_paycheck_import WHERE id = $1`, [row.id]);
  await logAudit("Clients", "EFTPS_PAYCHECK_IMPORT_DELETED", row.client_id, "", `${row.employee_name} ${row.pay_date}`, "",
    `Deleted an imported EFTPS paycheck row (${row.employee_name}, ${row.pay_date}) by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

eftpsDepositsRouter.post("/paycheck-import/clear", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const clientId = String(body.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "Client is required." });
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  // periodStart/periodEnd are optional — omitted clears everything for the
  // client (the "Imported Data" section's own Clear All), provided scopes it
  // to just that range (a single month's Delete button in Review & File).
  const periodStart = String(body.periodStart || "").trim();
  const periodEnd = String(body.periodEnd || "").trim();
  const result = periodStart && periodEnd
    ? await query<{ id: string }>(`DELETE FROM altax.v3_eftps_paycheck_import WHERE client_id = $1 AND pay_date >= $2 AND pay_date <= $3 RETURNING id`, [clientId, periodStart, periodEnd])
    : await query<{ id: string }>(`DELETE FROM altax.v3_eftps_paycheck_import WHERE client_id = $1 RETURNING id`, [clientId]);
  await logAudit("Clients", "EFTPS_PAYCHECK_IMPORT_CLEARED", clientId, "", String(result.length), "",
    `Cleared ${result.length} imported EFTPS paycheck row(s)${periodStart && periodEnd ? ` (${periodStart} to ${periodEnd})` : " (all)"} by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true, deleted: result.length });
}));

eftpsDepositsRouter.get("/tax-liability-import", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.query.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "Client is required." });
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const rows = await query<any>(
    `SELECT id, range_start::text AS range_start, range_end::text AS range_end, federal_income_tax, social_security, medicare, total_941, imported_by, imported_at
       FROM altax.v3_eftps_tax_liability_import WHERE client_id = $1 ORDER BY range_start DESC`,
    [clientId]
  );
  res.json({ rows });
}));

eftpsDepositsRouter.post("/tax-liability-import/:id/delete", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const row = await queryOne<any>(`SELECT id, client_id, range_start::text AS range_start, range_end::text AS range_end FROM altax.v3_eftps_tax_liability_import WHERE id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: "Row not found." });
  if (!(await canAccessClient(req.user!, row.client_id))) return res.status(403).json({ error: "You do not have access to this client." });

  await query(`DELETE FROM altax.v3_eftps_tax_liability_import WHERE id = $1`, [row.id]);
  await logAudit("Clients", "EFTPS_TAX_LIABILITY_IMPORT_DELETED", row.client_id, "", `${row.range_start} to ${row.range_end}`, "",
    `Deleted an imported EFTPS Tax Liability snapshot (${row.range_start} to ${row.range_end}) by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Review: any period, computed live from stored imports               */
/* ------------------------------------------------------------------ */

async function computeForPeriod(clientId: string, periodStart: string, periodEnd: string) {
  const rows = await query<any>(
    `SELECT employee_name, pay_date::text AS pay_date, check_number, federal_withheld, social_security_withheld, medicare_withheld
       FROM altax.v3_eftps_paycheck_import
      WHERE client_id = $1 AND pay_date >= $2 AND pay_date <= $3`,
    [clientId, periodStart, periodEnd]
  );
  const paychecks: DrakeFederalPaycheckDetail[] = rows.map((r: any) => ({
    employeeName: r.employee_name, payDate: r.pay_date, checkNumber: r.check_number || undefined,
    federalWithheld: Number(r.federal_withheld) || 0,
    socialSecurityWithheld: Number(r.social_security_withheld) || 0,
    medicareWithheld: Number(r.medicare_withheld) || 0,
  }));

  const snapshot = await queryOne<any>(
    `SELECT federal_income_tax, social_security, medicare, total_941 FROM altax.v3_eftps_tax_liability_import
      WHERE client_id = $1 AND range_start = $2 AND range_end = $3
      ORDER BY imported_at DESC LIMIT 1`,
    [clientId, periodStart, periodEnd]
  );
  const taxLiability: DrakeTaxLiabilitySummary | null = snapshot
    ? { federalIncomeTax: Number(snapshot.federal_income_tax) || 0, socialSecurity: Number(snapshot.social_security) || 0, medicare: Number(snapshot.medicare) || 0, total941: Number(snapshot.total_941) || 0, futa: 0, total940: 0, stateTotal: 0, localTotal: 0, grandTotal: 0 }
    : null;

  return { computation: computeEftpsBreakdown(paychecks, taxLiability), hasReconciliationReference: Boolean(snapshot), paycheckCount: paychecks.length };
}

type MonthBucket = { monthKey: string; periodStart: string; periodEnd: string };

/**
 * Splits [periodStart, periodEnd] into one bucket per calendar month touched —
 * clipped to the requested range only at the first/last bucket, interior
 * months are always the full calendar month (EFTPS deposits are always filed
 * per full calendar month in practice). All-UTC arithmetic, same convention
 * isoDate()/fmtPeriodLabel() above already require — local-time Date math
 * would shift month boundaries by a day depending on server TZ. Capped at 36
 * iterations, same guard reports.routes.ts's computeFirmSummary uses for the
 * same reason (a runaway-range backstop, not an expected real case).
 */
function splitIntoMonthBuckets(periodStart: string, periodEnd: string): MonthBucket[] {
  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(`${periodEnd}T00:00:00Z`);
  const buckets: MonthBucket[] = [];
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return buckets;

  let cy = start.getUTCFullYear(), cm = start.getUTCMonth();
  const ey = end.getUTCFullYear(), em = end.getUTCMonth();
  let guard = 0;
  while ((cy < ey || (cy === ey && cm <= em)) && guard < 36) {
    const monthFirst = new Date(Date.UTC(cy, cm, 1));
    const monthLast = new Date(Date.UTC(cy, cm + 1, 0));
    const bucketStart = monthFirst > start ? monthFirst : start;
    const bucketEnd = monthLast < end ? monthLast : end;
    buckets.push({
      monthKey: `${cy}-${String(cm + 1).padStart(2, "0")}`,
      periodStart: bucketStart.toISOString().slice(0, 10),
      periodEnd: bucketEnd.toISOString().slice(0, 10),
    });
    cm++;
    if (cm > 11) { cm = 0; cy++; }
    guard++;
  }
  return buckets;
}

/**
 * Computes one review row per calendar month touched by [periodStart,
 * periodEnd] in 3 batched queries (not N+1 — up to 36 months would otherwise
 * mean 36 sequential round trips). computeEftpsBreakdown itself is unchanged,
 * just invoked once per bucket instead of once for the whole range.
 */
async function computeMonthlyReview(clientId: string, periodStart: string, periodEnd: string) {
  const buckets = splitIntoMonthBuckets(periodStart, periodEnd);
  if (!buckets.length) return [];
  const rangeStart = buckets[0].periodStart, rangeEnd = buckets[buckets.length - 1].periodEnd;

  const paycheckRows = await query<any>(
    `SELECT employee_name, pay_date::text AS pay_date, check_number, federal_withheld, social_security_withheld, medicare_withheld
       FROM altax.v3_eftps_paycheck_import
      WHERE client_id = $1 AND pay_date >= $2 AND pay_date <= $3`,
    [clientId, rangeStart, rangeEnd]
  );
  const paychecksByMonth = new Map<string, DrakeFederalPaycheckDetail[]>();
  for (const r of paycheckRows) {
    const key = String(r.pay_date).slice(0, 7); // pay_date is already bounded to [rangeStart, rangeEnd] by the query, so every row lands in exactly one bucket
    const list = paychecksByMonth.get(key) || [];
    list.push({
      employeeName: r.employee_name, payDate: r.pay_date, checkNumber: r.check_number || undefined,
      federalWithheld: Number(r.federal_withheld) || 0,
      socialSecurityWithheld: Number(r.social_security_withheld) || 0,
      medicareWithheld: Number(r.medicare_withheld) || 0,
    });
    paychecksByMonth.set(key, list);
  }

  const snapshotRows = await query<any>(
    `SELECT range_start::text AS range_start, range_end::text AS range_end, federal_income_tax, social_security, medicare, total_941
       FROM altax.v3_eftps_tax_liability_import
      WHERE client_id = $1 AND range_start >= $2 AND range_end <= $3
      ORDER BY imported_at DESC`,
    [clientId, rangeStart, rangeEnd]
  );
  const snapshotByPeriod = new Map<string, any>();
  for (const s of snapshotRows) {
    const key = `${s.range_start}|${s.range_end}`;
    if (!snapshotByPeriod.has(key)) snapshotByPeriod.set(key, s); // ORDER BY imported_at DESC above means first-seen is most recent
  }

  const existingRows = await query<any>(
    `SELECT deposit_id, period_start::text AS period_start, period_end::text AS period_end,
            status, filing_date::text AS filing_date, due_date::text AS due_date,
            payment_date::text AS payment_date, total_amount, reconciliation_status, acknowledged_at
       FROM altax.v3_eftps_deposits
      WHERE client_id = $1 AND period_start >= $2 AND period_end <= $3`,
    [clientId, rangeStart, rangeEnd]
  );
  const existingByPeriod = new Map(existingRows.map((r: any) => [`${r.period_start}|${r.period_end}`, r]));

  return buckets.map((b) => {
    const paychecks = paychecksByMonth.get(b.monthKey) || [];
    const snapshot = snapshotByPeriod.get(`${b.periodStart}|${b.periodEnd}`);
    const taxLiability: DrakeTaxLiabilitySummary | null = snapshot
      ? { federalIncomeTax: Number(snapshot.federal_income_tax) || 0, socialSecurity: Number(snapshot.social_security) || 0, medicare: Number(snapshot.medicare) || 0, total941: Number(snapshot.total_941) || 0, futa: 0, total940: 0, stateTotal: 0, localTotal: 0, grandTotal: 0 }
      : null;
    return {
      monthKey: b.monthKey, periodStart: b.periodStart, periodEnd: b.periodEnd,
      label: fmtPeriodLabel(b.periodStart, b.periodEnd),
      paycheckCount: paychecks.length,
      computation: paychecks.length ? computeEftpsBreakdown(paychecks, taxLiability) : null,
      hasReconciliationReference: Boolean(snapshot),
      existingDeposit: existingByPeriod.get(`${b.periodStart}|${b.periodEnd}`) || null,
    };
  });
}

eftpsDepositsRouter.get("/review", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.query.clientId || "").trim();
  const periodStart = String(req.query.periodStart || "").trim();
  const periodEnd = String(req.query.periodEnd || "").trim();
  if (!clientId) return res.status(400).json({ error: "Client is required." });
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  if (!periodStart || !periodEnd) return res.status(400).json({ error: "Select a period." });

  const months = await computeMonthlyReview(clientId, periodStart, periodEnd);
  res.json({ ok: true, months });
}));

/* ------------------------------------------------------------------ */
/* Mark Filed / Record Payment / Send / Undo — separate steps,         */
/* mirroring the MD Sales Tax filing workflow exactly                  */
/* ------------------------------------------------------------------ */

async function buildSendPayload(deposit: any, req: AuthedRequest) {
  const client = await queryOne<any>(`SELECT client_id, client_name, email, email_allowed FROM altax.v3_clients WHERE client_id = $1`, [deposit.client_id]);
  const lines = await query<any>(`SELECT employee_name, federal_income_tax, social_security, medicare, subtotal FROM altax.v3_eftps_deposit_lines WHERE deposit_id = $1 ORDER BY employee_name`, [deposit.deposit_id]);
  const acknowledgeUrl = `${publicBaseUrl(req) || ""}/public/eftps-deposits/${deposit.share_token}`;
  return sendEftpsDepositReport({
    client: { clientId: client.client_id, clientName: client.client_name, email: client.email, emailAllowed: Boolean(client.email_allowed) },
    sourceRecordId: deposit.deposit_id, periodLabel: fmtPeriodLabel(deposit.period_start, deposit.period_end),
    filingDate: deposit.filing_date, paymentDate: deposit.payment_date, dueDate: isoDate(deposit.due_date),
    federalIncomeTaxTotal: Number(deposit.federal_income_tax_total), socialSecurityTotal: Number(deposit.social_security_total),
    medicareTotal: Number(deposit.medicare_total), totalAmount: Number(deposit.total_amount),
    employees: lines.map((l: any) => ({ employeeName: l.employee_name, federalIncomeTax: Number(l.federal_income_tax), socialSecurity: Number(l.social_security), medicare: Number(l.medicare), subtotal: Number(l.subtotal) })),
    acknowledgeUrl, req,
  });
}

eftpsDepositsRouter.post("/mark-filed", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const loaded = await loadClient(req, String(body.clientId || "").trim());
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  try {
    const periodStart = String(body.periodStart || "").trim();
    const periodEnd = String(body.periodEnd || "").trim();
    const dueDate = String(body.dueDate || "").trim();
    const filingDate = String(body.filingDate || "").trim();
    const periodLabel = String(body.periodLabel || `${periodStart} to ${periodEnd}`).trim();
    const notify = body.notify === true;

    if (!periodStart || !periodEnd || !dueDate) throw new ValidationError("Period start, period end, and due date are required.");
    if (!filingDate) throw new ValidationError("Filing date is required.");

    const existingDeposit = await queryOne<any>(
      `SELECT deposit_id FROM altax.v3_eftps_deposits WHERE client_id = $1 AND period_start = $2 AND period_end = $3`,
      [client.client_id, periodStart, periodEnd]
    );
    if (existingDeposit) throw new ValidationError("An EFTPS deposit for this period has already been filed. View it in the deposit history instead of creating a new one.");

    // Recomputed here, live, from what's actually stored — never trusts a
    // client-submitted total, same principle as the MD filing "mark filed" route.
    const { computation, paycheckCount } = await computeForPeriod(client.client_id, periodStart, periodEnd);
    if (!paycheckCount) throw new ValidationError("No imported paychecks fall within this period — nothing to file.");

    const depositId = `EFTPS-${idSuffix()}`;
    const shareToken = crypto.randomBytes(24).toString("hex");

    // payment_date is deliberately NULL here — filing and payment are separate
    // facts (direct owner correction, 2026-08-29: "I have not filed it yet"
    // was being forced to also fabricate a payment date to save at all).
    await query(
      `INSERT INTO altax.v3_eftps_deposits
         (deposit_id, client_id, period_start, period_end, due_date, filing_date, payment_date,
          federal_income_tax_total, social_security_total, medicare_total, total_amount,
          reconciliation_status, status, share_token, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10,$11,$12,$13,$14, now(), now())`,
      [depositId, client.client_id, periodStart, periodEnd, dueDate, filingDate,
        computation.federalIncomeTaxTotal, computation.socialSecurityTotal, computation.medicareTotal, computation.totalAmount,
        computation.reconciliationStatus, notify ? "Sent" : "Filed", shareToken, req.user!.email]
    );

    for (const e of computation.employees) {
      await query(
        `INSERT INTO altax.v3_eftps_deposit_lines (line_id, deposit_id, employee_name, federal_income_tax, social_security, medicare, subtotal)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [`EFTPSL-${idSuffix()}`, depositId, e.employeeName, e.federalIncomeTax, e.socialSecurity, e.medicare, e.subtotal]
      );
    }

    // Keeps the existing compliance-calendar deadline list, the generic
    // obligation UI, and the reminder re-check-at-fire-time logic all working
    // with zero changes to that code — paid_date stays NULL until Record
    // Payment is called separately.
    await query(
      `INSERT INTO altax.v3_obligation_completions (client_id, source, due_date, label, completed_date, completed_by, amount, paid_date)
       VALUES ($1,'EFTPS',$2,$3,$4,$5,$6,NULL)
       ON CONFLICT (client_id, source, due_date) DO UPDATE SET
         label = EXCLUDED.label, completed_date = EXCLUDED.completed_date, completed_by = EXCLUDED.completed_by,
         amount = EXCLUDED.amount, paid_date = NULL, completed_at = now()`,
      [client.client_id, dueDate, `EFTPS Deposit — ${periodLabel}`, filingDate, req.user!.email, computation.totalAmount]
    );

    // closeEftpsStaffTask handles tasks the daily sweep created (exact source_system
    // match, no due date/period stored on those rows); closeObligationTask handles
    // everything else — manually created tasks and batch-generated ones — matched by
    // keyword + due date instead, since those never carry the sweep's exact naming.
    // Its period-label match needs deriveTaskRulesPeriodLabel's "August 2026" convention
    // specifically, NOT the `periodLabel` above (a formatted date range, "Aug 1, 2026 –
    // Aug 31, 2026", used for the email/audit log) — confirmed live, a manually-created
    // task's own `period` field read "August 2026" and never matched the date-range
    // string, so the task silently never closed even though its due date also didn't
    // match (hand-typed, off from the real statutory date).
    await closeEftpsStaffTask(client.client_id, periodEnd);
    await closeObligationTask({
      clientId: client.client_id, keyword: "eftps", dueDate,
      periodLabel: deriveTaskRulesPeriodLabel(periodStart, "Monthly"), filedDate: filingDate, paidDate: null,
    });

    let emailResult: { sent: boolean } = { sent: false };
    if (notify) {
      // Mirrors mark-filed's own notify && !paidDate gating exactly — payment
      // is never known at this point, so the reminder always gets scheduled
      // here when the client is being notified at all.
      const sourceRecordId = `${client.client_id}:EFTPS:${dueDate}`;
      await schedulePaymentReminder({
        sourceSystem: "ObligationCompletion", sourceRecordId, clientId: client.client_id,
        filingType: "EFTPS Deposit", periodLabel, amount: computation.totalAmount, paymentDueDate: dueDate,
        createdBy: req.user!.email, leadDays: 3,
      });
      const deposit = await queryOne<any>(`SELECT * FROM altax.v3_eftps_deposits WHERE deposit_id = $1`, [depositId]);
      emailResult = await buildSendPayload(deposit, req);
    }

    await logAudit("Clients", "EFTPS_DEPOSIT_FILED", client.client_id, "amount", "", String(computation.totalAmount),
      `EFTPS deposit for ${periodLabel} (${depositId}) filed${notify ? " and sent" : ""} by ${req.user!.email}.`, req.user!.email);

    res.status(201).json({ ok: true, depositId, emailSent: emailResult.sent });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
}));

eftpsDepositsRouter.post("/:depositId/record-payment", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadDeposit(req, req.params.depositId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { deposit } = loaded;

  try {
    const paymentDate = String((req.body || {}).paymentDate || "").trim();
    if (!paymentDate) throw new ValidationError("A payment date is required.");
    if (deposit.payment_date) throw new ValidationError("This deposit already has a payment date recorded. Undo it first if you need to correct it.");

    await query(`UPDATE altax.v3_eftps_deposits SET payment_date = $2, updated_at = now() WHERE deposit_id = $1`, [deposit.deposit_id, paymentDate]);
    await query(
      `UPDATE altax.v3_obligation_completions SET paid_date = $3, completed_at = now() WHERE client_id = $1 AND source = 'EFTPS' AND due_date = $2`,
      [deposit.client_id, deposit.due_date, paymentDate]
    );
    await cancelPaymentReminder("ObligationCompletion", `${deposit.client_id}:EFTPS:${isoDate(deposit.due_date)}`, "Payment recorded");

    await logAudit("Clients", "EFTPS_DEPOSIT_PAYMENT_RECORDED", deposit.client_id, "payment_date", "", paymentDate,
      `Payment recorded for EFTPS deposit ${deposit.deposit_id} by ${req.user!.email}.`, req.user!.email);

    res.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
}));

eftpsDepositsRouter.post("/:depositId/send", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadDeposit(req, req.params.depositId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { deposit } = loaded;

  const result = await buildSendPayload(deposit, req);
  if (result.sent && deposit.status !== "Sent") {
    await query(`UPDATE altax.v3_eftps_deposits SET status = 'Sent', updated_at = now() WHERE deposit_id = $1`, [deposit.deposit_id]);
  }
  await logAudit("Clients", "EFTPS_DEPOSIT_SENT", deposit.client_id, "", "", deposit.deposit_id,
    `EFTPS deposit report ${deposit.deposit_id} sent by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, sent: result.sent });
}));

eftpsDepositsRouter.post("/:depositId/unmark", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadDeposit(req, req.params.depositId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { deposit } = loaded;

  await query(`DELETE FROM altax.v3_eftps_deposits WHERE deposit_id = $1`, [deposit.deposit_id]);
  await query(`DELETE FROM altax.v3_obligation_completions WHERE client_id = $1 AND source = 'EFTPS' AND due_date = $2`, [deposit.client_id, deposit.due_date]);
  await cancelPaymentReminder("ObligationCompletion", `${deposit.client_id}:EFTPS:${isoDate(deposit.due_date)}`, "Deposit undone");

  await logAudit("Clients", "EFTPS_DEPOSIT_UNMARKED", deposit.client_id, "", String(deposit.total_amount), "",
    `EFTPS deposit ${deposit.deposit_id} undone by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true });
}));

eftpsDepositsRouter.get("/:depositId/pdf", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadDeposit(req, req.params.depositId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { deposit } = loaded;

  const client = await queryOne<any>(`SELECT client_id, client_name, ein, address FROM altax.v3_clients WHERE client_id = $1`, [deposit.client_id]);
  const lines = await query<any>(`SELECT employee_name, federal_income_tax, social_security, medicare, subtotal FROM altax.v3_eftps_deposit_lines WHERE deposit_id = $1 ORDER BY employee_name`, [deposit.deposit_id]);

  // ein is encrypted at rest — undecrypted here put raw ciphertext into the printed
  // EFTPS deposit report, overflowing the EIN box (same bug found live on the Bill of Sale).
  const pdfBytes = await generateEftpsDepositPdf({
    client: { clientName: client?.client_name || "", clientId: deposit.client_id, ein: client?.ein ? decryptTolerant(client.ein) : null, address: client?.address || null },
    periodLabel: fmtPeriodLabel(deposit.period_start, deposit.period_end),
    filingDate: deposit.filing_date, paymentDate: deposit.payment_date,
    federalIncomeTaxTotal: Number(deposit.federal_income_tax_total), socialSecurityTotal: Number(deposit.social_security_total),
    medicareTotal: Number(deposit.medicare_total), totalAmount: Number(deposit.total_amount),
    employees: lines.map((l: any) => ({ employeeName: l.employee_name, federalIncomeTax: Number(l.federal_income_tax), socialSecurity: Number(l.social_security), medicare: Number(l.medicare), subtotal: Number(l.subtotal) })),
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="EFTPS_${deposit.client_id}_${isoDate(deposit.period_end)}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

eftpsDepositsRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.query.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "Client is required." });
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const deposits = await query<any>(
    `SELECT * FROM altax.v3_eftps_deposits WHERE client_id = $1 ORDER BY period_end DESC`,
    [clientId]
  );
  res.json({ deposits });
}));
