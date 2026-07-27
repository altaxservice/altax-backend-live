import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { logAudit } from "../../common/audit";
import { readWorkbookRows } from "../../common/xlsxReader";
import { detectFormat, parseQboEmployeeDetails, parseQboPayrollDetails, parseDrakeEmployeeListing, parseDrakePayrollSummary, type ParsedEmployee, type ParsedPaycheck } from "./parsers";
import { createSinglePaycheck, upsertEmployeeRecord } from "../accounting/accounting.routes";

export const payrollImportRouter = Router();

/** Same cap as every other base64-in-JSON upload in this app (documents.routes.ts's MAX_UPLOAD_BYTES). */
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

type LoadClientResult = { error: string; status: number } | { client: { client_id: string; client_name: string; state: string } };

async function loadClient(req: AuthedRequest, clientId: string): Promise<LoadClientResult> {
  if (!clientId) return { error: "Client is required.", status: 400 };
  if (!(await canAccessClient(req.user!, clientId))) return { error: "You do not have access to this client.", status: 403 };
  const client = await queryOne<any>(`SELECT client_id, client_name, state FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return { error: "Client not found.", status: 404 };
  return { client };
}

function decodeUpload(fileBase64: string): { buffer: Buffer } | { error: string } {
  const cleaned = String(fileBase64 || "").trim();
  if (!cleaned) return { error: "No file was uploaded." };
  const sizeBytes = Math.ceil((cleaned.length * 3) / 4);
  if (sizeBytes > MAX_IMPORT_BYTES) return { error: "That file is too large — imports are limited to 8MB." };
  try {
    return { buffer: Buffer.from(cleaned, "base64") };
  } catch {
    return { error: "Could not read this file." };
  }
}

/**
 * Reads + auto-detects + parses an uploaded QBO/Drake export, and cross-checks each
 * parsed row against what's already in this client's data — so the frontend can show
 * "this will create a new employee" vs "this will update an existing one" / "this
 * paycheck already exists, will be skipped" before anything is actually written.
 * Nothing in this route writes to the database.
 */
payrollImportRouter.post("/preview", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const loaded = await loadClient(req, String(body.clientId || "").trim());
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  const decoded = decodeUpload(body.fileBase64);
  if ("error" in decoded) return res.status(400).json({ error: decoded.error });

  let rows: string[][];
  try {
    rows = readWorkbookRows(decoded.buffer);
  } catch {
    return res.status(400).json({ error: "Could not read this file — make sure it's an unmodified export from QuickBooks Online or Drake Accounting." });
  }

  const format = detectFormat(rows);
  if (!format) {
    return res.status(400).json({ error: "This file doesn't match a supported QuickBooks Online or Drake Accounting export. Supported: QBO Employee Details, QBO Payroll Details, Drake Employee Listing, Drake Payroll Summary." });
  }
  if (format.kind === "unsupported-employee-detailed-listing") {
    return res.status(400).json({ error: "Drake's \"Employee Detailed Listing\" export isn't supported yet — use \"Employee Listing\" instead for employee import." });
  }

  if (format.kind === "employees") {
    const parsed = format.source === "qbo" ? parseQboEmployeeDetails(rows) : parseDrakeEmployeeListing(rows);
    const existing = await query<any>(`SELECT employee_id, employee_name FROM altax.v3_employees WHERE client_id = $1`, [client.client_id]);
    const existingByName = new Map(existing.map((e: any) => [String(e.employee_name).toLowerCase(), e.employee_id]));
    const previewRows = parsed.map((row: ParsedEmployee) => ({
      ...row,
      action: existingByName.has(row.employeeName.toLowerCase()) ? "update" : "create",
      existingEmployeeId: existingByName.get(row.employeeName.toLowerCase()) || null,
    }));
    return res.json({ ok: true, source: format.source, kind: "employees", rows: previewRows });
  }

  const parsed = (format.source === "qbo" ? parseQboPayrollDetails(rows) : parseDrakePayrollSummary(rows))
    .slice()
    .sort((a, b) => a.payDate.localeCompare(b.payDate));
  const existingChecks = await query<any>(
    `SELECT employee, pay_date::date::text AS pay_date FROM altax.v3_paychecks WHERE client_id = $1 AND lower(status) <> 'void'`,
    [client.client_id]
  );
  const existingKeys = new Set(existingChecks.map((p: any) => `${String(p.employee).toLowerCase()}|${p.pay_date}`));
  const previewRows = parsed.map((row: ParsedPaycheck) => ({
    ...row,
    action: existingKeys.has(`${row.employeeName.toLowerCase()}|${row.payDate}`) ? "duplicate" : "create",
  }));
  return res.json({ ok: true, source: format.source, kind: "paychecks", rows: previewRows });
}));

/**
 * Actually writes the rows the caller confirmed from /preview (the frontend owns the
 * row list between preview and commit — same shape sent back, possibly with unwanted
 * rows removed — matching how the batch paycheck modal already works). Employees go
 * through upsertEmployeeRecord (matched by name, not an import-source ID); paychecks
 * go through the exact same createSinglePaycheck every other paycheck creation path
 * uses, in chronological order so FUTA/SUTA annual wage-cap tracking comes out
 * correct. One bad row doesn't block the rest — results are reported per row.
 */
payrollImportRouter.post("/commit", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const loaded = await loadClient(req, String(body.clientId || "").trim());
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  const kind = String(body.kind || "");
  const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return res.status(400).json({ error: "No rows to import." });
  if (rows.length > 500) return res.status(400).json({ error: "Imports are limited to 500 rows at a time." });

  if (kind === "employees") {
    const results: any[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const { employeeId, created } = await upsertEmployeeRecord({
          clientId: client.client_id, clientName: client.client_name, employeeName: String(row.employeeName || "").trim(),
          email: row.email, phone: row.phone, payType: row.payType, payRate: row.payRate,
          streetAddress: row.streetAddress, city: row.city, state: row.state, zipCode: row.zipCode,
          ssnMasked: row.ssnMasked, federalFilingStatus: row.federalFilingStatus, stateFilingStatus: row.stateFilingStatus,
          status: row.status, appendNotes: row.extraNotes,
          updatedBy: req.user!.email,
        });
        results.push({ index: i, employeeName: row.employeeName, ok: true, employeeId, created });
      } catch (err: any) {
        results.push({ index: i, employeeName: row.employeeName, ok: false, error: err?.message || "Could not import this employee." });
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    await logAudit("Employees", "IMPORT", client.client_id, "", "", `${succeeded}/${rows.length}`,
      `Employee import: ${succeeded}/${rows.length} rows by ${req.user!.email}.`, req.user!.email);
    return res.status(succeeded > 0 ? 201 : 400).json({ ok: succeeded > 0, succeeded, failed: rows.length - succeeded, results });
  }

  if (kind === "paychecks") {
    const sorted = rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => String(a.row.payDate || "").localeCompare(String(b.row.payDate || "")));

    const existingChecks = await query<any>(
      `SELECT employee, pay_date::date::text AS pay_date FROM altax.v3_paychecks WHERE client_id = $1 AND lower(status) <> 'void'`,
      [client.client_id]
    );
    const existingKeys = new Set(existingChecks.map((p: any) => `${String(p.employee).toLowerCase()}|${p.pay_date}`));

    const results: any[] = [];
    for (const { row, index } of sorted) {
      const employeeName = String(row.employeeName || "").trim();
      const payDate = String(row.payDate || "").trim();
      const key = `${employeeName.toLowerCase()}|${payDate}`;
      if (existingKeys.has(key)) {
        results.push({ index, employeeName, payDate, ok: false, error: "A paycheck for this employee on this date already exists — skipped." });
        continue;
      }
      const result = await createSinglePaycheck(client, employeeName, {
        payDate, payPeriodStart: row.payPeriodStart, payPeriodEnd: row.payPeriodEnd,
        grossWages: row.grossWages, federalWithholding: row.federalWithholding, stateTax: row.stateTax,
        checkNumber: row.checkNumber,
      }, req.user!.email);
      results.push({ index, employeeName, payDate, ...result });
      if (result.ok) existingKeys.add(key);
    }

    results.sort((a, b) => a.index - b.index);
    const succeeded = results.filter((r) => r.ok).length;
    await logAudit("Accounting", "IMPORT_PAYROLL", client.client_id, "", "", `${succeeded}/${rows.length}`,
      `Paycheck import: ${succeeded}/${rows.length} rows by ${req.user!.email}.`, req.user!.email);
    return res.status(succeeded > 0 ? 201 : 400).json({ ok: succeeded > 0, succeeded, failed: rows.length - succeeded, results });
  }

  return res.status(400).json({ error: "kind must be \"employees\" or \"paychecks\"." });
}));
