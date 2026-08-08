/**
 * Parser for a client's own "Sales_Input" tab inside their reusable multi-sheet workbook
 * (see xlsxReader.readWorkbookSheetByName — the caller picks out just this one tab before
 * handing rows here). Column layout, left to right:
 *   Date | Gross Sales | Taxable @ 6% | Special @ 12% | Vape @ 20% | 60% Rate Sales |
 *   Adjustments | Payment Date | Notes | Year
 * Standalone on purpose — this has nothing to do with payroll import
 * (src/modules/payrollImport/), which reads a completely different Drake/QBO layout.
 */

export const SALES_INPUT_SHEET_NAME = "Sales_Input";

export interface ParsedSalesInputRow {
  rowNumber: number; // 1-based position within the sheet, for error messages
  saleDate: string; // ISO yyyy-mm-dd
  rawDate: string; // original cell text, for display
  grossSales: number;
  taxable6: number;
  special12: number;
  vape20: number;
  rate60: number;
  adjustments: number;
  paymentDate: string | null;
  notes: string;
}

export interface SalesInputParseResult {
  rows: ParsedSalesInputRow[];
  skipped: { rowNumber: number; reason: string }[];
  headerRowFound: boolean;
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
export function parseSalesInputSheet(rawRows: string[][]): SalesInputParseResult {
  const headerRowIndex = rawRows.findIndex((r) => r.some((c) => normalizeHeader(c) === "grosssales"));
  if (headerRowIndex === -1) {
    return { rows: [], skipped: [], headerRowFound: false };
  }
  const header = rawRows[headerRowIndex];

  const dateIdx = findColumn(header, (h) => h === "date");
  const grossIdx = findColumn(header, (h) => h === "grosssales");
  const taxable6Idx = findColumn(header, (h) => h.includes("taxable") && h.includes("6"));
  const special12Idx = findColumn(header, (h) => h.includes("special") && h.includes("12"));
  const vape20Idx = findColumn(header, (h) => h.includes("vape"));
  const rate60Idx = findColumn(header, (h) => h.includes("60") && h.includes("rate"));
  const adjustmentsIdx = findColumn(header, (h) => h.includes("adjust"));
  const paymentDateIdx = findColumn(header, (h) => h.includes("payment") && h.includes("date"));
  const notesIdx = findColumn(header, (h) => h.includes("note"));

  const rows: ParsedSalesInputRow[] = [];
  const skipped: { rowNumber: number; reason: string }[] = [];

  for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
    const r = rawRows[i];
    const rowNumber = i + 1;
    if (!r || r.every((c) => !String(c || "").trim())) continue;

    const rawDate = dateIdx !== -1 ? String(r[dateIdx] || "").trim() : "";
    if (/^total/i.test(rawDate)) continue;

    const grossSales = grossIdx !== -1 ? parseMoney(r[grossIdx]) : 0;
    const taxable6 = taxable6Idx !== -1 ? parseMoney(r[taxable6Idx]) : 0;
    const special12 = special12Idx !== -1 ? parseMoney(r[special12Idx]) : 0;
    const vape20 = vape20Idx !== -1 ? parseMoney(r[vape20Idx]) : 0;
    const rate60 = rate60Idx !== -1 ? parseMoney(r[rate60Idx]) : 0;
    const adjustments = adjustmentsIdx !== -1 ? parseMoney(r[adjustmentsIdx]) : 0;

    // A blank placeholder row for a future month — no date and no amounts anywhere.
    if (!rawDate && grossSales === 0 && taxable6 === 0 && special12 === 0 && vape20 === 0 && rate60 === 0 && adjustments === 0) continue;

    const saleDate = parseFlexibleDate(rawDate);
    if (!saleDate) {
      skipped.push({ rowNumber, reason: rawDate ? `Could not read the date "${rawDate}".` : "This row has amounts but no date." });
      continue;
    }

    rows.push({
      rowNumber, saleDate, rawDate, grossSales, taxable6, special12, vape20, rate60, adjustments,
      paymentDate: paymentDateIdx !== -1 ? parseFlexibleDate(String(r[paymentDateIdx] || "")) : null,
      notes: notesIdx !== -1 ? String(r[notesIdx] || "").trim() : "",
    });
  }

  return { rows, skipped, headerRowFound: true };
}
