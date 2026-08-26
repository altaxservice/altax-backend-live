/**
 * "Subscription Plans" client-facing brochure — direct owner request,
 * 2026-08-26: a good-looking, printable explainer of the 3 subscription
 * tiers and the full Minimum Fee Schedule, generated live from
 * v3_service_catalog/v3_subscription_tiers so it never drifts from what's
 * actually configured. Same hand-drawn pdf-lib approach as reportsPdf.ts
 * (no official template exists for this), colors matched to the web app's
 * own tier badge colors (--teal/--amber/--green in frontend/src/index.css)
 * so the PDF reads as the same product, not a separate document.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { getFirmProfile } from "../../common/firmProfile";
import { embedFirmLogo } from "../../common/pdfLogo";
import { pdfSafeText } from "../../common/pdfText";
import { query } from "../../config/db";
import type { ServiceCatalogEntry, SubscriptionTierKey } from "../../common/subscriptionPricing";

const PAGE_W = 612;
const PAGE_H = 792;
const L = 48, R = PAGE_W - 48;

const INK = rgb(0.094, 0.125, 0.165);
const MUTED = rgb(0.42, 0.42, 0.42);
const LINE = rgb(0.85, 0.85, 0.85);
const GOLD = rgb(0.663, 0.514, 0.29);
const GOLD_TEXT = rgb(0.541, 0.416, 0.208);
const WHITE = rgb(1, 1, 1);

const TIER_STYLE: Record<SubscriptionTierKey, { fg: ReturnType<typeof rgb>; bg: ReturnType<typeof rgb> }> = {
  essentials: { fg: rgb(0.059, 0.463, 0.431), bg: rgb(0.851, 0.957, 0.937) },
  growth: { fg: rgb(0.631, 0.384, 0.027), bg: rgb(1, 0.957, 0.839) },
  complete: { fg: rgb(0.086, 0.396, 0.204), bg: rgb(0.863, 0.988, 0.906) },
};

const TIER_BLURB: Record<SubscriptionTierKey, string> = {
  essentials: "A single compliance relationship — one filing service, kept current and on time.",
  growth: "Bookkeeping on its own, or two or more services working together for broader coverage.",
  complete: "Bookkeeping and Payroll together with full tax compliance — we run the whole back office.",
};

function money(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

class Cursor {
  constructor(private page: PDFPage, private font: PDFFont, private bold: PDFFont, private top: number) {}
  text(x: number, yFromTop: number, str: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center"; maxWidth?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const safe = pdfSafeText(str);
    if (!safe) return;
    const width = font.widthOfTextAtSize(safe, size);
    const drawX = opts.align === "right" ? x - width : opts.align === "center" ? x - width / 2 : x;
    this.page.drawText(safe, { x: drawX, y: this.top - yFromTop, size, font, color: opts.color ?? INK });
  }
  /** Word-wraps into `maxWidth`, returns the y position after the last line. */
  wrapped(x: number, yFromTop: number, str: string, maxWidth: number, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; lineHeight?: number } = {}): number {
    const size = opts.size ?? 9;
    const font = opts.bold ? this.bold : this.font;
    const lineHeight = opts.lineHeight ?? size + 3;
    const words = pdfSafeText(str).split(/\s+/);
    let line = "";
    let y = yFromTop;
    for (const word of words) {
      const attempt = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(attempt, size) > maxWidth && line) {
        this.text(x, y, line, { size, bold: opts.bold, color: opts.color });
        y += lineHeight;
        line = word;
      } else {
        line = attempt;
      }
    }
    if (line) { this.text(x, y, line, { size, bold: opts.bold, color: opts.color }); y += lineHeight; }
    return y;
  }
  line(x1: number, y1: number, x2: number, y2: number, color = LINE, thickness = 0.75) {
    this.page.drawLine({ start: { x: x1, y: this.top - y1 }, end: { x: x2, y: this.top - y2 }, thickness, color });
  }
  rect(x: number, y: number, w: number, h: number, color = GOLD) {
    this.page.drawRectangle({ x, y: this.top - y - h, width: w, height: h, color });
  }
}

async function newPage(doc: PDFDocument, font: PDFFont, bold: PDFFont): Promise<{ page: PDFPage; c: Cursor }> {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const c = new Cursor(page, font, bold, PAGE_H);
  c.rect(0, 0, PAGE_W, 6, GOLD);
  return { page, c };
}

function drawFooter(c: Cursor, firmName: string, phone: string, email: string) {
  c.text(L, PAGE_H - 26, `${firmName} · ${phone} · ${email}`, { size: 8, color: MUTED });
  c.text(R, PAGE_H - 26, "Prices shown are minimums — actual fees may vary by engagement scope.", { size: 8, color: MUTED, align: "right" });
}

export async function generateSubscriptionBrochurePdf(): Promise<Uint8Array> {
  const [catalogRaw, tiers] = await Promise.all([
    query<ServiceCatalogEntry>(`SELECT * FROM altax.v3_service_catalog WHERE active = true AND legacy = false ORDER BY sort_order ASC`),
    query<{ tier_key: SubscriptionTierKey; tier_name: string; description: string | null }>(`SELECT * FROM altax.v3_subscription_tiers ORDER BY sort_order ASC`),
  ]);
  const profile = await getFirmProfile();

  const doc = await PDFDocument.create();
  doc.setTitle("Subscription Plans");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedFirmLogo(doc, profile);

  const { page, c } = await newPage(doc, font, bold);

  // Letterhead
  let y = 46;
  let textL = L;
  if (logo) {
    const h = 30;
    const w = (logo.width / logo.height) * h;
    page.drawImage(logo, { x: L, y: PAGE_H - y - h + 8, width: w, height: h });
    textL = L + w + 12;
  }
  c.text(textL, y, profile.firmName, { size: 18, bold: true, color: GOLD_TEXT });
  c.text(R, y, "Subscription Plans", { size: 20, bold: true, align: "right" });
  y += 18;
  c.text(textL, y, "Ongoing bookkeeping, payroll & compliance support", { size: 10, color: MUTED });
  y += 20;
  c.line(L, y, R, y, INK, 1.25);
  y += 26;

  // Three tier cards, side by side
  const gap = 14;
  const cardW = (R - L - gap * 2) / 3;
  const cardTop = y;
  let maxCardBottom = cardTop;
  tiers.forEach((t, i) => {
    const style = TIER_STYLE[t.tier_key] || TIER_STYLE.essentials;
    const x = L + i * (cardW + gap);
    let cy = cardTop;
    c.rect(x, cy, cardW, 26, style.fg);
    c.text(x + cardW / 2, cy + 17, t.tier_name, { size: 12, bold: true, color: WHITE, align: "center" });
    cy += 26;
    c.rect(x, cy, cardW, 96, style.bg);
    const desc = t.description || TIER_BLURB[t.tier_key] || "";
    const textY = c.wrapped(x + 10, cy + 16, desc, cardW - 20, { size: 8.5, color: INK, lineHeight: 11 });
    cy += 96;
    maxCardBottom = Math.max(maxCardBottom, cy);
    void textY;
  });
  y = maxCardBottom + 24;

  y = c.wrapped(L, y, "Every service is priced individually — a client's monthly subscription is simply the total of whichever services they need, and the tier above reflects the depth of that relationship.", R - L, { size: 8.5, color: MUTED, lineHeight: 12 });
  y += 4;
  y = c.wrapped(L, y, "One-time services (formation, permits, and similar projects) are billed per engagement and are never part of the monthly subscription.", R - L, { size: 8.5, color: MUTED, lineHeight: 12 });
  y += 16;

  // Fee schedule table
  c.text(L, y, "MINIMUM FEE SCHEDULE", { size: 11, bold: true, color: GOLD_TEXT });
  y += 18;

  const groups = Array.from(new Set(catalogRaw.map((s) => s.group_name)));
  const COL_LABEL = L, COL_BILLED = R - 190, COL_FEE = R;

  // Takes the cursor explicitly rather than closing over the page-1 `c` —
  // a closure here previously kept drawing page 2+'s header onto page 1
  // (at whatever small `y` the new page starts from), since a page break
  // swaps in a new Cursor but a closure would still reference the old one.
  function drawTableHeader(cur: Cursor, yy: number): number {
    cur.text(COL_LABEL, yy, "Service", { size: 8.5, bold: true, color: MUTED });
    cur.text(COL_BILLED, yy, "Billed", { size: 8.5, bold: true, color: MUTED });
    cur.text(COL_FEE, yy, "Fee", { size: 8.5, bold: true, color: MUTED, align: "right" });
    yy += 8;
    cur.line(L, yy, R, yy, LINE, 1);
    return yy + 12;
  }

  let currentC = c;
  y = drawTableHeader(currentC, y);

  for (const group of groups) {
    if (y > PAGE_H - 110) {
      drawFooter(currentC, profile.firmName, profile.phone, profile.email);
      const next = await newPage(doc, font, bold);
      currentC = next.c;
      y = 56;
      y = drawTableHeader(currentC, y);
    }
    currentC.text(L, y, group.toUpperCase(), { size: 8, bold: true, color: rgb(0.5, 0.5, 0.5) });
    y += 13;
    for (const s of catalogRaw.filter((c2) => c2.group_name === group)) {
      if (y > PAGE_H - 90) {
        drawFooter(currentC, profile.firmName, profile.phone, profile.email);
        const next = await newPage(doc, font, bold);
        currentC = next.c;
        y = 56;
        y = drawTableHeader(currentC, y);
      }
      const billed = s.role === "one_time" ? "One-time" : "Monthly";
      const feeText = s.min_fee != null ? money(s.min_fee) : "—";
      currentC.text(COL_LABEL, y, s.label, { size: 9.5 });
      currentC.text(COL_BILLED, y, billed, { size: 9, color: MUTED });
      currentC.text(COL_FEE, y, feeText, { size: 9.5, bold: true, align: "right" });
      y += 15;
    }
    y += 6;
  }

  drawFooter(currentC, profile.firmName, profile.phone, profile.email);
  return doc.save();
}
