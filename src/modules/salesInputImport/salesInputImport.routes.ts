import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler, ValidationError } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { logAudit } from "../../common/audit";
import { readWorkbookSheetByName } from "../../common/xlsxReader";
import { scanFileForMalware } from "../../common/malwareScan";
import { parseSalesInputSheet, SALES_INPUT_SHEET_NAME, type ParsedSalesInputRow } from "./salesInputParser";
import { createSalesInputRecord, computeCategoryLinesTax, deleteSalesInputRecord, type SalesCategoryLineInput } from "../accounting/accounting.routes";

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

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

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

/** Each detected rate column (salesInputParser.ts's findRateColumns — driven by whatever "N%" labels are actually in the header, not a fixed MD list) is matched against this client's own state's configured categories by percentage. */
function buildCategoryLines(row: ParsedSalesInputRow, rateMap: Map<number, { category_id: string; category_name: string }>): { lines: SalesCategoryLineInput[]; unmapped: string[] } {
  const lines: SalesCategoryLineInput[] = [];
  const unmapped: string[] = [];
  for (const col of row.categoryAmounts) {
    if (!col.amount) continue;
    const category = rateMap.get(col.pct);
    if (!category) {
      unmapped.push(col.label);
      continue;
    }
    lines.push({ categoryId: category.category_id, taxableAmount: col.amount });
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
      adjustments: row.adjustments, paymentDate: row.paymentDate, notes: row.notes,
      categoryLines: lines, unmappedCategories: unmapped, totalTaxDue: Math.round(totalTaxDue * 100) / 100,
      action: existingDates.has(row.saleDate) ? "duplicate" : "create",
    });
  }

  res.json({
    ok: true, rows: previewRows, skipped: parsed.skipped, sheetName: SALES_INPUT_SHEET_NAME,
    // True when the header had zero "N%" rate columns at all — every row above will then
    // import with an empty categoryLines regardless of Gross Sales, silently landing as
    // fully non-taxable. Confirmed live, 2026-09-07: a DC client's file used "8%"/"10%"
    // headers that this importer didn't yet recognize (it only knew Maryland's 4 names),
    // and nothing here told staff the categories hadn't come through.
    noRateColumnsFound: !parsed.hasRateColumns,
  });
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

  // One ID for the whole commit, not per row — tags every row this request
  // creates so the entire import can be reversed in one action later (see
  // POST /batches/:batchId/undo below) instead of hunting down each row
  // individually. Real incident that motivated this: a whole other
  // company's data got imported by mistake, and undoing it meant finding
  // every affected row by timestamp and deleting each one by hand.
  const importBatchId = `SIBATCH-${idSuffix()}`;

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
      await query(`UPDATE altax.v3_sales_input SET import_batch_id = $2 WHERE sale_id = $1`, [result.saleId, importBatchId]);
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
  res.status(succeeded > 0 ? 201 : 400).json({
    ok: succeeded > 0, succeeded, failed: rows.length - succeeded, results,
    batchId: succeeded > 0 ? importBatchId : null,
  });
}));

/** Recent import batches for one client — most recent first, capped at 10 — so "Undo this import" can be found later, not just right after committing. */
salesInputImportRouter.get("/batches/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  const rows = await query<any>(
    `SELECT import_batch_id, MIN(created_at) AS imported_at, COUNT(*)::int AS row_count, SUM(gross_sales) AS total_gross
       FROM altax.v3_sales_input
      WHERE client_id = $1 AND import_batch_id IS NOT NULL
      GROUP BY import_batch_id
      ORDER BY MIN(created_at) DESC
      LIMIT 10`,
    [client.client_id]
  );
  res.json({
    batches: rows.map((r) => ({ batchId: r.import_batch_id, importedAt: r.imported_at, rowCount: r.row_count, totalGross: Number(r.total_gross || 0) })),
  });
}));

/**
 * Reverses an entire import in one action — every v3_sales_input row tagged
 * with this batch ID, for this client, via the same deleteSalesInputRecord
 * helper the single-sale delete route uses (accounting.routes.ts), so a
 * one-at-a-time delete and a whole-batch undo can never reverse the ledger
 * differently. Scoped to what the import itself created — a separate "Mark
 * Filed" action a staff member took afterward isn't touched here; auto-
 * guessing which filed periods "belong" to a given import by time-proximity
 * would risk deleting a real, unrelated filing. Admin-only, same weight as
 * the single-sale delete this reuses.
 */
salesInputImportRouter.post("/batches/:batchId/undo", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { batchId } = req.params;
  const loaded = await loadClient(req, String((req.body || {}).clientId || "").trim());
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  const rows = await query<any>(
    `SELECT sale_id FROM altax.v3_sales_input WHERE import_batch_id = $1 AND client_id = $2`,
    [batchId, client.client_id]
  );
  if (!rows.length) return res.status(404).json({ error: "This import batch has nothing left to undo — it may have already been reversed." });

  let glLinesRemoved = 0;
  for (const row of rows) {
    const removed = await deleteSalesInputRecord(row.sale_id);
    glLinesRemoved += removed.glLinesRemoved;
  }

  await logAudit("Accounting", "UNDO_SALES_IMPORT", batchId, "", "", `${rows.length}`,
    `Undid import batch ${batchId}: ${rows.length} sale(s) removed by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true, rowsRemoved: rows.length, glLinesRemoved });
}));
