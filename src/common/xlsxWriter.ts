import * as XLSX from "xlsx";

/** Builds a single-sheet .xlsx file from a header row + data rows — the write-side counterpart to xlsxReader.ts's read. Sheet names are capped at Excel's 31-char limit. */
export function buildXlsxBuffer(sheetName: string, headers: string[], rows: (string | number)[][]): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31) || "Sheet1");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
