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
import { schedulePaymentReminder } from "../../common/paymentReminders";
import { sendEftpsDepositReport } from "../../common/filingConfirmationEmail";
import { closeEftpsStaffTask } from "./eftpsStaffTasks";
import {
  looksLikeDrakeTaxLiabilityByCheckDate, parseDrakeTaxLiabilityByCheckDate,
  looksLikeDrakePayrollWagesDetail, parseDrakePayrollWagesDetail,
} from "../payrollImport/parsers";
import { computeEftpsBreakdown } from "./eftpsReconciliation";

export const eftpsDepositsRouter = Router();

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

type LoadClientResult = { error: string; status: number } | { client: { client_id: string; client_name: string; email: string | null; email_allowed: boolean } };

async function loadClient(req: AuthedRequest, clientId: string): Promise<LoadClientResult> {
  if (!clientId) return { error: "Client is required.", status: 400 };
  if (!(await canAccessClient(req.user!, clientId))) return { error: "You do not have access to this client.", status: 403 };
  const client = await queryOne<any>(`SELECT client_id, client_name, email, email_allowed FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return { error: "Client not found.", status: 404 };
  return { client };
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

/**
 * Parses both Drake reports and computes the reconciled per-employee federal
 * breakdown. Writes nothing — the frontend echoes this same computation back
 * to POST / on commit, matching the existing payrollImport preview/commit split.
 */
eftpsDepositsRouter.post("/preview", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const loaded = await loadClient(req, String(body.clientId || "").trim());
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });

  try {
    const taxLiabilityBuffer = decodeUpload(body.taxLiabilityFileBase64, "Tax Liability by Check Date");
    const payrollWagesBuffer = decodeUpload(body.payrollWagesFileBase64, "Payroll Wages");

    const [taxLiabilityScan, payrollWagesScan] = await Promise.all([
      scanFileForMalware(taxLiabilityBuffer, "eftps-tax-liability"),
      scanFileForMalware(payrollWagesBuffer, "eftps-payroll-wages"),
    ]);
    if (!taxLiabilityScan.clean) return res.status(400).json({ error: "The Tax Liability file failed a security scan and could not be processed." });
    if (!payrollWagesScan.clean) return res.status(400).json({ error: "The Payroll Wages file failed a security scan and could not be processed." });

    const taxLiabilityRows = readWorkbookRows(taxLiabilityBuffer);
    if (!looksLikeDrakeTaxLiabilityByCheckDate(taxLiabilityRows)) {
      return res.status(400).json({ error: "That doesn't look like Drake's \"Tax Liability by Check Date\" report. Please double-check the file." });
    }
    const payrollWagesRows = readWorkbookRows(payrollWagesBuffer);
    if (!looksLikeDrakePayrollWagesDetail(payrollWagesRows)) {
      return res.status(400).json({ error: "That doesn't look like Drake's \"Payroll Wages\" report. Please double-check the file." });
    }

    const taxLiability = parseDrakeTaxLiabilityByCheckDate(taxLiabilityRows);
    const paychecks = parseDrakePayrollWagesDetail(payrollWagesRows);
    if (!paychecks.length) return res.status(400).json({ error: "No paychecks were found in the Payroll Wages file." });

    const computation = computeEftpsBreakdown(paychecks, taxLiability);
    res.json({ ok: true, computation });
  } catch (err) {
    // decodeUpload throws ValidationError for anything meant to reach the client
    // (missing/oversized/unreadable file) — anything else re-throws to the
    // global handler's generic message, never a raw internal error string.
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
}));

/** Save & Close / Save & Send — writes the deposit + line items, upserts the shared obligation-tracking row, closes the proactive staff task, schedules the client reminder, and (Save & Send only) emails the report. */
eftpsDepositsRouter.post("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const loaded = await loadClient(req, String(body.clientId || "").trim());
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  try {
    const periodStart = String(body.periodStart || "").trim();
    const periodEnd = String(body.periodEnd || "").trim();
    const dueDate = String(body.dueDate || "").trim();
    const filingDate = String(body.filingDate || "").trim();
    const paymentDate = String(body.paymentDate || "").trim();
    const periodLabel = String(body.periodLabel || `${periodStart} to ${periodEnd}`).trim();
    const action = body.action === "send" ? "send" : "close";
    const employees = Array.isArray(body.employees) ? body.employees : [];

    if (!periodStart || !periodEnd || !dueDate) throw new ValidationError("Period start, period end, and due date are required.");
    if (!filingDate) throw new ValidationError("Filing date is required.");
    if (!paymentDate) throw new ValidationError("Payment date is required.");
    if (!employees.length) throw new ValidationError("At least one employee's breakdown is required.");

    const existing = await queryOne<any>(
      `SELECT deposit_id FROM altax.v3_eftps_deposits WHERE client_id = $1 AND period_start = $2 AND period_end = $3`,
      [client.client_id, periodStart, periodEnd]
    );
    if (existing) throw new ValidationError("An EFTPS deposit for this period has already been saved. View it in the deposit history instead of creating a new one.");

    // Recomputed server-side from the submitted breakdown, not trusted from the
    // client, the same way invoice totals are always server-computed from line
    // items rather than a client-sent total.
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const normalizedEmployees = employees.map((e: any) => {
      const federalIncomeTax = round2(Number(e.federalIncomeTax) || 0);
      const socialSecurity = round2(Number(e.socialSecurity) || 0);
      const medicare = round2(Number(e.medicare) || 0);
      return { employeeName: String(e.employeeName || "").trim() || "Unknown", federalIncomeTax, socialSecurity, medicare, subtotal: round2(federalIncomeTax + socialSecurity + medicare) };
    });
    const federalIncomeTaxTotal = round2(normalizedEmployees.reduce((s: number, e: any) => s + e.federalIncomeTax, 0));
    const socialSecurityTotal = round2(normalizedEmployees.reduce((s: number, e: any) => s + e.socialSecurity, 0));
    const medicareTotal = round2(normalizedEmployees.reduce((s: number, e: any) => s + e.medicare, 0));
    const totalAmount = round2(federalIncomeTaxTotal + socialSecurityTotal + medicareTotal);
    const reconciliationStatus = body.reconciliationStatus === "Mismatch" ? "Mismatch" : "Matched";

    const depositId = `EFTPS-${idSuffix()}`;
    const shareToken = crypto.randomBytes(24).toString("hex");
    const status = action === "send" ? "Sent" : "Filed";

    await query(
      `INSERT INTO altax.v3_eftps_deposits
         (deposit_id, client_id, period_start, period_end, due_date, filing_date, payment_date,
          federal_income_tax_total, social_security_total, medicare_total, total_amount,
          reconciliation_status, status, share_token, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now(), now())`,
      [depositId, client.client_id, periodStart, periodEnd, dueDate, filingDate, paymentDate,
        federalIncomeTaxTotal, socialSecurityTotal, medicareTotal, totalAmount,
        reconciliationStatus, status, shareToken, req.user!.email]
    );

    for (const e of normalizedEmployees) {
      await query(
        `INSERT INTO altax.v3_eftps_deposit_lines (line_id, deposit_id, employee_name, federal_income_tax, social_security, medicare, subtotal)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [`EFTPSL-${idSuffix()}`, depositId, e.employeeName, e.federalIncomeTax, e.socialSecurity, e.medicare, e.subtotal]
      );
    }

    // Keeps the existing compliance-calendar deadline list, the generic
    // obligation UI, and the reminder re-check-at-fire-time logic all working
    // with zero changes to that code — this is the same (client, source,
    // due_date) key the generic "Mark Done" button already writes.
    await query(
      `INSERT INTO altax.v3_obligation_completions (client_id, source, due_date, label, completed_date, completed_by, amount, paid_date)
       VALUES ($1,'EFTPS',$2,$3,$4,$5,$6,$7)
       ON CONFLICT (client_id, source, due_date) DO UPDATE SET
         label = EXCLUDED.label, completed_date = EXCLUDED.completed_date, completed_by = EXCLUDED.completed_by,
         amount = EXCLUDED.amount, paid_date = EXCLUDED.paid_date, completed_at = now()`,
      [client.client_id, dueDate, `EFTPS Deposit — ${periodLabel}`, filingDate, req.user!.email, totalAmount, paymentDate]
    );

    await closeEftpsStaffTask(client.client_id, periodEnd);

    const sourceRecordId = `${client.client_id}:EFTPS:${dueDate}`;
    await schedulePaymentReminder({
      sourceSystem: "ObligationCompletion", sourceRecordId, clientId: client.client_id,
      filingType: "EFTPS Deposit", periodLabel, amount: totalAmount, paymentDueDate: paymentDate,
      createdBy: req.user!.email, leadDays: 2,
    });

    let emailResult: { sent: boolean } = { sent: false };
    if (action === "send") {
      const acknowledgeUrl = `${publicBaseUrl(req) || ""}/public/eftps-deposits/${shareToken}`;
      emailResult = await sendEftpsDepositReport({
        client: { clientId: client.client_id, clientName: client.client_name, email: client.email, emailAllowed: Boolean(client.email_allowed) },
        sourceRecordId: depositId, periodLabel, filingDate, paymentDate,
        federalIncomeTaxTotal, socialSecurityTotal, medicareTotal, totalAmount,
        employees: normalizedEmployees, acknowledgeUrl, req,
      });
    }

    await logAudit("Clients", "EFTPS_DEPOSIT_SAVED", client.client_id, "amount", "", String(totalAmount),
      `EFTPS deposit for ${periodLabel} (${depositId}) ${action === "send" ? "saved and sent" : "saved"} by ${req.user!.email}.`, req.user!.email);

    res.status(201).json({ ok: true, depositId, emailSent: emailResult.sent });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
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
