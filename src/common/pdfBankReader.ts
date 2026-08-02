/**
 * Extracts transaction lines from an uploaded bank-statement PDF. pdfjs-dist v6 ships
 * ESM-only (no CommonJS build), so it's loaded via a genuine dynamic import — forced
 * through the Function constructor because TypeScript's commonjs output otherwise
 * downlevels `import()` to `require()`, which cannot load an ESM-only package.
 */
const importEsm = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfjs = await importEsm("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  const lines: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Group text items by their vertical position so words on the same
    // printed line end up in the same string, in left-to-right reading order.
    const rows = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items as any[]) {
      if (typeof item.str !== "string" || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push({ x: item.transform[4], str: item.str });
    }
    const orderedYs = [...rows.keys()].sort((a, b) => b - a);
    for (const y of orderedYs) {
      const row = rows.get(y)!.sort((a, b) => a.x - b.x);
      lines.push(row.map((r) => r.str).join(" ").replace(/\s+/g, " ").trim());
    }
  }
  await doc.cleanup();
  return lines.join("\n");
}

export interface ParsedBankLine {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
}

const DATE_RE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/;
const AMOUNT_RE = /\(?-?\$?[\d,]{1,3}(?:,\d{3})*\.\d{2}\)?/g;

function toIsoDate(m: RegExpMatchArray): string {
  let [, mm, dd, yy] = m;
  let year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function parseAmount(token: string): number {
  const negative = token.startsWith("(") || token.startsWith("-");
  const digits = token.replace(/[^0-9.]/g, "");
  const n = Number(digits);
  return negative ? -n : n;
}

/**
 * Best-effort line scanner: no standard PDF bank-statement layout exists the way CSV
 * headers give us one, so this looks for a leading date and a trailing dollar amount
 * on each text line. When a line ends with two amount-like tokens close together (the
 * common "amount ... running balance" layout), the second-to-last is treated as the
 * transaction amount and the last as the balance column, which is discarded. Rows that
 * don't match both a date and an amount are silently skipped — this is intentionally
 * lossy; the per-line Delete button on the Bank Rec screen is the safety net for staff
 * to remove anything misparsed, rather than requiring a full preview-before-commit UI.
 */
export function parsePdfBankLines(text: string): ParsedBankLine[] {
  const out: ParsedBankLine[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const dateMatch = line.match(DATE_RE);
    if (!dateMatch) continue;
    const amounts = [...line.matchAll(AMOUNT_RE)];
    if (!amounts.length) continue;
    // When two trailing amounts appear, the second-to-last is the transaction amount and
    // the last is a running balance column (the common bank-statement layout); cut the
    // description before whichever token is used so neither amount nor balance leaks in.
    const amountMatch = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[amounts.length - 1];
    const amount = parseAmount(amountMatch[0]);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const description = line.slice(dateMatch[0].length, amountMatch.index).trim();
    out.push({ date: toIsoDate(dateMatch as RegExpMatchArray), description: description.slice(0, 255), amount });
  }
  return out;
}
