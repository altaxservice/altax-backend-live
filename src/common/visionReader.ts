import { queryOne } from "../config/db";
import { finalizeClover, type CloverParse } from "./posSummary";

/**
 * Reads a photo or screenshot of a POS report (Clover Sales Overview / Taxes — flat, tilted, crumpled, any phone photo) with Claude's vision.
 * Used only when an admin has switched "Smart reading" on AND ANTHROPIC_API_KEY is set on the server, because it sends the picture to
 * Anthropic's API. The answer is never trusted blindly: it goes through the same self-checks as every other reading (do the payment types
 * add up to the amount collected? do the tax sections add up to the report's total?), and staff still review before saving.
 */
export const isSmartReadingKeyConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

export async function isSmartReadingEnabled(): Promise<boolean> {
  if (!isSmartReadingKeyConfigured()) return false;
  try { return (await queryOne<any>(`SELECT pos_smart_reading_enabled AS v FROM altax.v3_firm_settings WHERE id = 'FIRM-1'`))?.v === true; } catch { return false; }
}

const PROMPT = `This is a photo or screenshot of a point-of-sale sales report from Clover (a "Sales Overview" report, a "Taxes" report, or both). It may be tilted, curved, crumpled, dim or small. Read it carefully and return ONLY a JSON object, no other text, in exactly this shape:
{
  "periodStart": "YYYY-MM-DD" or null,
  "periodEnd": "YYYY-MM-DD" or null,
  "taxSections": [ { "name": string, "ratePercent": number, "applicableSales": number, "amountCollected": number, "amountRefunded": number, "netAmount": number } ],
  "totalApplicableSales": number or null,
  "overview": { "grossSales": number|null, "refunds": number|null, "netSales": number|null, "taxesAndFees": number|null, "amountCollected": number|null },
  "tenders": [ { "name": string, "amount": number } ]
}
Rules:
- taxSections: one entry per rate heading in the Taxes report, e.g. "Sales Tax (6%)", "No Tax (0%)", "Tax Removed (0%)", or a heading like "20 (20%)". ratePercent is the number in the brackets. Do NOT include the final "Total" block as a section — put its Applicable Sales in totalApplicableSales.
- tenders: ONLY the main payment types in the "Sales by tender type" part (for example "Debit Card", "Credit Card", "EBT", "Cash", "Gift Card"). Skip the indented card-brand lines (Visa, MasterCard, Discover, American Express) and any repeated sub-line.
- Use plain numbers (no $ or commas); a refund shown in brackets or with a minus is negative. If a value is not visible or you cannot read it with confidence, use null — never guess or calculate a missing number.
- If the picture contains only one of the two reports, leave the other part empty ([] or null values).`;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function readReportWithClaude(buffer: Buffer): Promise<CloverParse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Smart reading isn't set up on the server.");
  // Normalise to a reasonably sized JPEG so any phone photo is accepted and the request stays small and quick.
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp(buffer).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  const res = await fetch(process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 2000,
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } }, { type: "text", text: PROMPT }] }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`Smart reading failed (${res.status}).`);
  const body: any = await res.json();
  const text = String(body?.content?.find((c: any) => c.type === "text")?.text || "");
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

  const out: CloverParse = {
    from: /^\d{4}-\d{2}-\d{2}$/.test(json.periodStart || "") ? json.periodStart : null, to: /^\d{4}-\d{2}-\d{2}$/.test(json.periodEnd || "") ? json.periodEnd : null,
    taxSections: [], overview: { gross: null, refunds: null, net: null, taxes: null, collected: null },
    tenders: { debit: 0, credit: 0, ebt: 0, cash: 0, other: [] }, foundOverview: false, foundTaxes: false, warnings: [], totalApplicable: num(json.totalApplicableSales), checks: [],
  };
  for (const s of Array.isArray(json.taxSections) ? json.taxSections : []) {
    const rate = num(s.ratePercent); const applicable = num(s.applicableSales);
    if (rate === null || applicable === null) continue;
    const collected = num(s.amountCollected) ?? 0, refunded = num(s.amountRefunded) ?? 0;
    out.taxSections.push({ name: String(s.name || `${rate}%`).slice(0, 80), rate, applicable, collected, refunded, net: num(s.netAmount) ?? Math.round((collected + refunded) * 100) / 100 });
  }
  out.foundTaxes = out.taxSections.length > 0;
  const o = json.overview || {};
  out.overview = { gross: num(o.grossSales), refunds: num(o.refunds), net: num(o.netSales), taxes: num(o.taxesAndFees), collected: num(o.amountCollected) };
  for (const t of Array.isArray(json.tenders) ? json.tenders : []) {
    const name = String(t.name || "").trim(); const a = num(t.amount); if (!name || a === null) continue;
    if (/^debit/i.test(name)) out.tenders.debit = a; else if (/^credit/i.test(name)) out.tenders.credit = a; else if (/^ebt|snap/i.test(name)) out.tenders.ebt = a; else if (/^cash$/i.test(name)) out.tenders.cash = a; else out.tenders.other.push({ name, amount: a });
  }
  out.foundOverview = out.overview.collected !== null || out.overview.gross !== null || Object.values({ d: out.tenders.debit, c: out.tenders.credit, e: out.tenders.ebt, h: out.tenders.cash }).some((x) => x > 0);
  return finalizeClover(out);
}
