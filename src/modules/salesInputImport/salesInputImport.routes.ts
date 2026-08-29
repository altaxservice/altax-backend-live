import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler, ValidationError } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { logAudit } from "../../common/audit";
import { readWorkbookSheetByName } from "../../common/xlsxReader";
import { scanFileForMalware } from "../../common/malwareScan";
import { parseSalesInputSheet, SALES_INPUT_SHEET_NAME, type ParsedSalesInputRow } from "./salesInputParser";
import { createSalesInputRecord, computeCategoryLinesTax, type SalesCategoryLineInput } from "../accounting/accounting.routes";

/**
 * Imports a client's own "Sales_Input" tab (one row per day: gross sales + the MD 6%/
 * 12%/20%/60% tax-category breakdown) out of their reusable multi-sheet workbook.
 * Deliberately its own module, own router, own mount path — payroll is imported from
 * Drake/QBO through src/modules/payrollImport/ and stays completely separate; this file
 * never imports from there and payrollImport never imports from here. The only shared
 * dependency is accounting.routes.ts's own createSalesInputRecord/computeCategoryLinesTax
 * — the same functions POST /accounting/sales already uses — so an imported row and a
 * hand-typed row can never compute different tax or GL numbers.
 */
export const salesInputImportRouter = Router();

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
 * Resolves this client's active MD-style tax categories into a lookup by rate percent
 * (6, 12, 20, 60 ...) so each spreadsheet column ("Taxable @ 6%", "Vape @ 20%", ...) can
 * be matched to whichever category is actually configured at that rate today, rather than
 * hardcoding category IDs — if a category is ever renamed or its rate is edited, this
 * still resolves correctly.
 */
async function loadCategoryRateMap(state: string | null | undefined): Promise<Map<number, { category_id: string; category_name: string }>> {
  // Not filtering on r.scope = 'Global' here — some existing rate rows (e.g. ST6) are
  // global defaults but have scope stored as NULL rather than the literal string
  // 'Global', and requiring that exact value silently dropped them from this map.
  // client_id IS NULL/'' still excludes per-client overrides, which is what matters here.
  const rows = await query<any>(
    `SELECT c.category_id, c.category_name, r.rate AS rate_percent
     FROM altax.v3_sales_tax_categories c
     LEFT JOIN altax.v3_tax_rates r ON r.rate_id = c.default_rate_id AND r.active = true AND (r.client_id IS NULL OR r.client_id = '')
     WHERE c.active = true AND (c.state = $1 OR c.state IS NULL)`,
    [state || ""]
  );
  const map = new Map<number, { category_id: string; category_name: string }>();
  for (const row of rows) {
    const pct = Math.round(Number(row.rate_percent) * 100);
    if (Number.isFinite(pct) && pct > 0 && !map.has(pct)) map.set(pct, { category_id: row.category_id, category_name: row.category_name });
  }
  return map;
}

const CATEGORY_COLUMNS: { key: keyof Pick<ParsedSalesInputRow, "taxable6" | "special12" | "vape20" | "rate60">; pct: number; label: string }[] = [
  { key: "taxable6", pct: 6, label: "Taxable @ 6%" },
  { key: "special12", pct: 12, label: "Special @ 12%" },
  { key: "vape20", pct: 20, label: "Vape @ 20%" },
  { key: "rate60", pct: 60, label: "60% Rate Sales" },
];

function buildCategoryLines(row: ParsedSalesInputRow, rateMap: Map<number, { category_id: string; category_name: string }>): { lines: SalesCategoryLineInput[]; unmapped: string[] } {
  const lines: SalesCategoryLineInput[] = [];
  const unmapped: string[] = [];
  for (const col of CATEGORY_COLUMNS) {
    const amount = row[col.key];
    if (!amount) continue;
    const category = rateMap.get(col.pct);
    if (!category) {
      unmapped.push(col.label);
      continue;
    }
    lines.push({ categoryId: category.category_id, taxableAmount: amount });
  }
  return { lines, unmapped };
}

/**
 * Reads the workbook, targets only the Sales_Input tab (ignoring every other tab in the
 * client's reusable template), parses it, maps each category column to this client's
 * configured tax rates, checks for sale-dates that already exist for this client, and
 * computes the estimated tax per row — all read-only, nothing is written yet.
 */
salesInputImportRouter.post("/preview", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const loaded = await loadClient(req, String(body.clientId || "").trim());
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  const decoded = decodeUpload(body.fileBase64);
  if ("error" in decoded) return res.status(400).json({ error: decoded.error });

  const scan = await scanFileForMalware(decoded.buffer, "sales-input-import");
  if (scan.scanned && !scan.clean) {
    return res.status(400).json({ error: `This file was flagged by malware scanning${scan.foundViruses?.length ? ` (${scan.foundViruses.join(", ")})` : ""} and was not imported.` });
  }

  let sheet: ReturnType<typeof readWorkbookSheetByName>;
  try {
    sheet = readWorkbookSheetByName(decoded.buffer, SALES_INPUT_SHEET_NAME);
  } catch {
    return res.status(400).json({ error: "Could not read this file — make sure it's an unmodified .xls or .xlsx workbook." });
  }
  if (!sheet.rows.length) {
    return res.status(400).json({
      error: `This workbook doesn't have a "${SALES_INPUT_SHEET_NAME}" tab. Tabs found: ${sheet.availableSheetNames.join(", ") || "(none)"}.`,
    });
  }

  const parsed = parseSalesInputSheet(sheet.rows);
  if (!parsed.headerRowFound) {
    return res.status(400).json({ error: `Found the "${SALES_INPUT_SHEET_NAME}" tab, but couldn't find its "Gross Sales" header row — make sure the layout hasn't changed.` });
  }
  if (!parsed.rows.length) {
    return res.status(400).json({ error: "No usable rows were found on the Sales_Input tab.", skipped: parsed.skipped });
  }

  const rateMap = await loadCategoryRateMap(client.state);
  const existing = await query<any>(`SELECT sale_date::date::text AS sale_date FROM altax.v3_sales_input WHERE client_id = $1`, [client.client_id]);
  const existingDates = new Set(existing.map((r: any) => r.sale_date));

  const previewRows = [];
  for (const row of parsed.rows) {
    const { lines, unmapped } = buildCategoryLines(row, rateMap);
    let totalTaxDue = 0;
    try {
      const computed = await computeCategoryLinesTax(lines, client.client_id, client.state);
      totalTaxDue = computed.totalTax + row.adjustments;
    } catch {
      // Leave totalTaxDue at 0 rather than fail the whole preview over one row's category mismatch.
    }
    previewRows.push({
      rowNumber: row.rowNumber, saleDate: row.saleDate, rawDate: row.rawDate, grossSales: row.grossSales,
      taxable6: row.taxable6, special12: row.special12, vape20: row.vape20, rate60: row.rate60,
      adjustments: row.adjustments, paymentDate: row.paymentDate, notes: row.notes,
      categoryLines: lines, unmappedCategories: unmapped, totalTaxDue: Math.round(totalTaxDue * 100) / 100,
      action: existingDates.has(row.saleDate) ? "duplicate" : "create",
    });
  }

  res.json({ ok: true, rows: previewRows, skipped: parsed.skipped, sheetName: SALES_INPUT_SHEET_NAME });
}));

/**
 * Writes the rows the caller confirmed from /preview (the frontend owns the row list —
 * same shape sent back, possibly with unwanted/duplicate rows removed). Every write goes
 * through createSalesInputRecord tagged source_system='Sales Input Import', the exact
 * same transactional insert+GL-posting path POST /accounting/sales uses for manual entry,
 * so imported and hand-typed sales can never diverge in their tax/GL math. Re-checks for
 * existing sale-dates at commit time (not just at preview time) so a stale preview can't
 * double-post if the client was edited in between. One bad row doesn't block the rest.
 */
salesInputImportRouter.post("/commit", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const loaded = await loadClient(req, String(body.clientId || "").trim());
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return res.status(400).json({ error: "No rows to import." });
  if (rows.length > 500) return res.status(400).json({ error: "Imports are limited to 500 rows at a time." });

  const sorted = rows.map((row, index) => ({ row, index })).sort((a, b) => String(a.row.saleDate || "").localeCompare(String(b.row.saleDate || "")));

  const existing = await query<any>(`SELECT sale_date::date::text AS sale_date FROM altax.v3_sales_input WHERE client_id = $1`, [client.client_id]);
  const existingDates = new Set(existing.map((r: any) => r.sale_date));

  const results: any[] = [];
  for (const { row, index } of sorted) {
    const saleDate = String(row.saleDate || "").trim();
    if (!saleDate) {
      results.push({ index, saleDate, ok: false, error: "Missing sale date — skipped." });
      continue;
    }
    if (existingDates.has(saleDate)) {
      results.push({ index, saleDate, ok: false, error: "A sales record already exists for this date — skipped." });
      continue;
    }
    try {
      const categoryLines: SalesCategoryLineInput[] = Array.isArray(row.categoryLines) ? row.categoryLines : [];
      const result = await createSalesInputRecord(client, {
        saleDate, grossSales: row.grossSales, adjustments: row.adjustments,
        paymentDate: row.paymentDate, notes: row.notes, categoryLines,
      }, req.user!.email, "Sales Input Import");
      results.push({ index, saleDate, ok: true, saleId: result.saleId, totalTaxDue: result.totalTaxDue });
      existingDates.add(saleDate);
    } catch (err) {
      // Hard Audit finding, 2026-08-29: createSalesInputRecord's real INSERT/GL
      // posting failing (not just its intentional validation) used to put a raw
      // Postgres error into this row's reported result.
      if (err instanceof ValidationError) {
        results.push({ index, saleDate, ok: false, error: err.message });
      } else {
        // eslint-disable-next-line no-console
        console.error(err);
        results.push({ index, saleDate, ok: false, error: "Could not import this row." });
      }
    }
  }

  results.sort((a, b) => a.index - b.index);
  const succeeded = results.filter((r) => r.ok).length;
  await logAudit("Accounting", "IMPORT_SALES_INPUT", client.client_id, "", "", `${succeeded}/${rows.length}`,
    `Sales Input import: ${succeeded}/${rows.length} rows by ${req.user!.email}.`, req.user!.email);
  res.status(succeeded > 0 ? 201 : 400).json({ ok: succeeded > 0, succeeded, failed: rows.length - succeeded, results });
}));
