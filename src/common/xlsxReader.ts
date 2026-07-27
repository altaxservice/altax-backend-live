import * as XLSX from "xlsx";

/**
 * Reads the first sheet of an uploaded QBO/Drake export (.xls or .xlsx) into a plain
 * grid of strings, matching the shape used throughout payrollImport's parsers. Uses
 * SheetJS's own CDN-distributed build (see package.json — "xlsx": cdn.sheetjs.com/...)
 * rather than the npm registry's xlsx package, which is stuck on a version with known
 * prototype-pollution/ReDoS advisories; this matters here specifically because these
 * files are untrusted uploads, not internal data.
 */
export function readWorkbookRows(buffer: Buffer): string[][] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellText: true, cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
}
