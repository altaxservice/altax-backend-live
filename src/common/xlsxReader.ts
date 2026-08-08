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

/**
 * Reads one specific sheet by name out of a multi-tab workbook, ignoring every
 * other tab — for a client's own reusable multi-sheet workbook (Sales_Input,
 * Payroll_Input, Manual_JE, GL_Engine, etc. all in one file), grabbing "the
 * first sheet" like readWorkbookRows does would silently read the wrong tab.
 * Name matching is tolerant of case and spacing ("Sales_Input" / "Sales Input"
 * / "sales input" all match) since different client copies of a shared
 * template can drift slightly. Returns every sheet name found so a caller can
 * show a clear "no matching tab" error instead of silently reading garbage.
 */
export function readWorkbookSheetByName(buffer: Buffer, sheetNameQuery: string): { rows: string[][]; availableSheetNames: string[] } {
  const workbook = XLSX.read(buffer, { type: "buffer", cellText: true, cellDates: false });
  const availableSheetNames = workbook.SheetNames;
  const normalize = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
  const target = normalize(sheetNameQuery);
  const match = availableSheetNames.find((name) => normalize(name) === target);
  if (!match) return { rows: [], availableSheetNames };
  const sheet = workbook.Sheets[match];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
  return { rows, availableSheetNames };
}
