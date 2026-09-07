/**
 * Parser for a client's own "Sales_Input" tab inside their reusable multi-sheet workbook
 * (see xlsxReader.readWorkbookSheetByName — the caller picks out just this one tab before
 * handing rows here). Fixed columns: Date (aka "Period Date") | Gross Sales | Adjustments |
 * Payment Date | Notes | Year — plus any number of tax-rate columns in between, one per
 * category actually configured for the client's state (Maryland's are "Taxable @ 6%" /
 * "Special @ 12%" / "Vape @ 20%" / "60% Rate Sales", but DC/PA/VA each have their own —
 * see findRateColumns below). Standalone on purpose — this has nothing to do with payroll
 * import (src/modules/payrollImport/), which reads a completely different Drake/QBO layout.
 */

export const SALES_INPUT_SHEET_NAME = "Sales_Input";

export interface CategoryAmount {
  pct: number;
  label: string;
  amount: number;
}

export interface ParsedSalesInputRow {
  rowNumber: number; // 1-based position within the sheet, for error messages
  saleDate: string; // ISO yyyy-mm-dd
  rawDate: string; // original cell text, for display
  grossSales: number;
  categoryAmounts: CategoryAmount[];
  adjustments: number;
  paymentDate: string | null;
  notes: string;
}

export interface SalesInputParseResult {
  rows: ParsedSalesInputRow[];
  skipped: { rowNumber: number; reason: string }[];
  headerRowFound: boolean;
  /** False when the header had zero recognizable "N%" rate columns at all — every row's tax categories would then be silently empty regardless of what's in Gross Sales, which is exactly the failure mode this flag exists to catch (confirmed live, 2026-09-07: a DC client's 8%/10% columns went unrecognized when this only looked for Maryland's 4 fixed names). */
  hasRateColumns: boolean;
}

function normalizeHeader(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findColumn(header: string[], isMatch: (normalized: string) => boolean): number {
  return header.findIndex((h) => isMatch(normalizeHeader(h)));
}

function parseMoney(cell: string | undefined): number {
  if (!cell) return 0;
  const cleaned = String(cell).trim().replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!cleaned || cleaned === "-") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Accepts common spreadsheet date text ("1/5/2026", "2026-01-05", "01/05/26") and returns ISO yyyy-mm-dd, or null if it doesn't look like a date. */
function parseFlexibleDate(cell: string | undefined): string | null {
  const raw = String(cell || "").trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (slash) {
    const [, m, d, yRaw] = slash;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

/**
 * Scans the raw grid for the header row (the one with a "Gross Sales" cell), maps the
 * expected columns by tolerant name matching (case/spacing-insensitive, so "Taxable @ 6%"
 * / "Taxable 6%" / "taxable_6" all resolve the same), then parses every row below it —
 * skipping blank placeholder rows and the sheet's own Total row, and recording (not
 * silently dropping) anything that couldn't be read so the import preview can show staff
 * exactly what didn't come through.
 */
/**
 * Every header cell that isn't one of the known fixed columns is a candidate tax-rate
 * column, identified by whatever percentage figure appears in its own label — "Taxable @
 * 6%", "60% Rate Sales", "8%", "10%" all resolve the same way (extract the number next to
 * "%", nothing about the surrounding words matters). This is what makes the importer
 * state-agnostic: it no longer needs to know MD's specific category names up front, just
 * that a column is labeled with a rate — loadCategoryRateMap (salesInputImport.routes.ts)
 * then matches that rate against whichever categories are actually configured for the
 * client's own state.
 */
function findRateColumns(header: string[], excluded: Set<number>): { idx: number; pct: number; label: string }[] {
  const columns: { idx: number; pct: number; label: string }[] = [];
  for (let idx = 0; idx < header.length; idx++) {
    if (excluded.has(idx)) continue;
    const label = String(header[idx] || "").trim();
    const match = label.match(/(\d+(?:\.\d+)?)\s*%/);
    if (!match) continue;
    const pct = Math.round(Number(match[1]));
    if (Number.isFinite(pct) && pct > 0) columns.push({ idx, pct, label: label || `${pct}%` });
  }
  return columns;
}

export function parseSalesInputSheet(rawRows: string[][]): SalesInputParseResult {
  const headerRowIndex = rawRows.findIndex((r) => r.some((c) => normalizeHeader(c) === "grosssales"));
  if (headerRowIndex === -1) {
    return { rows: [], skipped: [], headerRowFound: false, hasRateColumns: false };
  }
  const header = rawRows[headerRowIndex];

  const dateIdx = findColumn(header, (h) => h.includes("date") && !h.includes("payment"));
  const grossIdx = findColumn(header, (h) => h === "grosssales");
  const adjustmentsIdx = findColumn(header, (h) => h.includes("adjust"));
  const paymentDateIdx = findColumn(header, (h) => h.includes("payment") && h.includes("date"));
  const notesIdx = findColumn(header, (h) => h.includes("note"));
  const yearIdx = findColumn(header, (h) => h === "year");

  const rateColumns = findRateColumns(header, new Set([dateIdx, grossIdx, adjustmentsIdx, paymentDateIdx, notesIdx, yearIdx].filter((i) => i !== -1)));

  const rows: ParsedSalesInputRow[] = [];
  const skipped: { rowNumber: number; reason: string }[] = [];

  for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
    const r = rawRows[i];
    const rowNumber = i + 1;
    if (!r || r.every((c) => !String(c || "").trim())) continue;

    const rawDate = dateIdx !== -1 ? String(r[dateIdx] || "").trim() : "";
    if (/^total/i.test(rawDate)) continue;

    const grossSales = grossIdx !== -1 ? parseMoney(r[grossIdx]) : 0;
    const categoryAmounts: CategoryAmount[] = rateColumns.map((col) => ({ pct: col.pct, label: col.label, amount: parseMoney(r[col.idx]) }));
    const adjustments = adjustmentsIdx !== -1 ? parseMoney(r[adjustmentsIdx]) : 0;
    const notes = notesIdx !== -1 ? String(r[notesIdx] || "").trim() : "";

    // A blank placeholder row for a future month — no amounts anywhere. The client's
    // reusable template pre-fills a period-end date for every month of the year, so a
    // future month can have a date typed in well before any sales are recorded against it.
    // A genuinely confirmed zero-sales period (e.g. a registered-but-dormant client who
    // still owes a nil return) looks numerically identical to an unfilled row, so it needs
    // its own signal to opt out of this skip — any text in Notes ("no sales this period",
    // "confirmed zero", etc.) is treated as "this row was deliberately filled in as zero,"
    // not "never touched."
    if (grossSales === 0 && categoryAmounts.every((c) => c.amount === 0) && adjustments === 0 && !notes) continue;

    const saleDate = parseFlexibleDate(rawDate);
    if (!saleDate) {
      skipped.push({ rowNumber, reason: rawDate ? `Could not read the date "${rawDate}".` : "This row has amounts but no date." });
      continue;
    }

    rows.push({
      rowNumber, saleDate, rawDate, grossSales, categoryAmounts, adjustments,
      paymentDate: paymentDateIdx !== -1 ? parseFlexibleDate(String(r[paymentDateIdx] || "")) : null,
      notes,
    });
  }

  return { rows, skipped, headerRowFound: true, hasRateColumns: rateColumns.length > 0 };
}
