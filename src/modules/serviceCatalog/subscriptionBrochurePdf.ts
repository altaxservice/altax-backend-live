/**
 * "Subscription Plans" client-facing brochure — direct owner request,
 * 2026-08-26, redesigned 2026-08-26 to match a reference mockup the owner
 * supplied (dark-green letterhead, serif display type, dotted-leader price
 * rows, a 3-step "how one-time engagements are priced" panel, a CTA banner).
 * Same hand-drawn pdf-lib approach as reportsPdf.ts (no official template
 * exists for this) — every number/label/tier still comes live from
 * v3_service_catalog/v3_subscription_tiers and the firm's own Firm Settings
 * (name/logo/phone/email), never hardcoded from the reference image.
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
const HEADER_H = 132;

const INK = rgb(0.094, 0.125, 0.165);
const MUTED = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.85, 0.85, 0.85);
const WHITE = rgb(1, 1, 1);
const OFFWHITE = rgb(0.85, 0.9, 0.87);
const DARKGREEN = rgb(0.106, 0.216, 0.176);
const CREAM = rgb(0.961, 0.941, 0.894);
const GOLD = rgb(0.663, 0.514, 0.29);
const GOLD_TEXT = rgb(0.541, 0.416, 0.208);
const TEAL_LINE = rgb(0.106, 0.216, 0.176);

const TIER_COLOR: Record<SubscriptionTierKey, ReturnType<typeof rgb>> = {
  essentials: rgb(0.059, 0.463, 0.431),
  growth: GOLD_TEXT,
  complete: rgb(0.086, 0.396, 0.204),
};

const TIER_BLURB: Record<SubscriptionTierKey, string> = {
  essentials: "A single compliance filing relationship — no ongoing bookkeeping.",
  growth: "Bookkeeping, or two or more compliance services together.",
  complete: "Full back office: bookkeeping and payroll together with tax compliance.",
};

function money(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Width of `str` as Cursor.tracked() would draw it — for positioning a rule/line relative to letter-tracked text. */
function trackedWidth(font: PDFFont, str: string, size: number, extraTracking: number): number {
  const safe = pdfSafeText(str);
  return safe.split("").reduce((w, ch) => w + font.widthOfTextAtSize(ch, size) + extraTracking, -extraTracking);
}

class Cursor {
  constructor(private page: PDFPage, private font: PDFFont, private bold: PDFFont, private top: number) {}
  text(x: number, yFromTop: number, str: string, opts: { size?: number; bold?: boolean; font?: PDFFont; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center" } = {}) {
    const size = opts.size ?? 10;
    const font = opts.font ?? (opts.bold ? this.bold : this.font);
    const safe = pdfSafeText(str);
    if (!safe) return;
    const width = font.widthOfTextAtSize(safe, size);
    const drawX = opts.align === "right" ? x - width : opts.align === "center" ? x - width / 2 : x;
    this.page.drawText(safe, { x: drawX, y: this.top - yFromTop, size, font, color: opts.color ?? INK });
  }
  /**
   * Letter-tracked (small-caps eyebrow style) text — pdf-lib's drawText has no
   * native letter-spacing, and padding with extra space *characters* doesn't
   * work: pdfSafeText normalizes every Unicode space variant (including a
   * non-breaking space) down to a plain space and then collapses runs of 2+
   * of them, which eats the tracking gap right at real word boundaries and
   * leaves words mashed together while individual letters stay spaced. This
   * draws each character with its own drawText call at a manually advanced
   * x position instead, so the gap is real geometry, not a character.
   */
  tracked(x: number, yFromTop: number, str: string, extraTracking: number, opts: { size?: number; bold?: boolean; font?: PDFFont; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center" } = {}) {
    const size = opts.size ?? 10;
    const font = opts.font ?? (opts.bold ? this.bold : this.font);
    const safe = pdfSafeText(str);
    if (!safe) return;
    const chars = safe.split("");
    const totalWidth = chars.reduce((w, ch) => w + font.widthOfTextAtSize(ch, size) + extraTracking, -extraTracking);
    let cx = opts.align === "right" ? x - totalWidth : opts.align === "center" ? x - totalWidth / 2 : x;
    for (const ch of chars) {
      this.page.drawText(ch, { x: cx, y: this.top - yFromTop, size, font, color: opts.color ?? INK });
      cx += font.widthOfTextAtSize(ch, size) + extraTracking;
    }
  }
  /** Splits into wrapped lines without drawing — lets a caller measure height (e.g. for a background box) before committing to draw. */
  wrapLines(str: string, maxWidth: number, opts: { size?: number; bold?: boolean; font?: PDFFont } = {}): string[] {
    const size = opts.size ?? 9;
    const font = opts.font ?? (opts.bold ? this.bold : this.font);
    const words = pdfSafeText(str).split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const attempt = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(attempt, size) > maxWidth && line) { lines.push(line); line = word; }
      else line = attempt;
    }
    if (line) lines.push(line);
    return lines;
  }
  wrapped(x: number, yFromTop: number, str: string, maxWidth: number, opts: { size?: number; bold?: boolean; font?: PDFFont; color?: ReturnType<typeof rgb>; lineHeight?: number } = {}): number {
    const size = opts.size ?? 9;
    const lineHeight = opts.lineHeight ?? size + 3;
    let y = yFromTop;
    for (const line of this.wrapLines(str, maxWidth, opts)) {
      this.text(x, y, line, opts);
      y += lineHeight;
    }
    return y;
  }
  line(x1: number, y1: number, x2: number, y2: number, color = LINE, thickness = 0.75, dashArray?: number[]) {
    this.page.drawLine({ start: { x: x1, y: this.top - y1 }, end: { x: x2, y: this.top - y2 }, thickness, color, dashArray });
  }
  rect(x: number, y: number, w: number, h: number, color = GOLD) {
    this.page.drawRectangle({ x, y: this.top - y - h, width: w, height: h, color });
  }
}

async function newPage(doc: PDFDocument, font: PDFFont, bold: PDFFont): Promise<{ page: PDFPage; c: Cursor }> {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const c = new Cursor(page, font, bold, PAGE_H);
  return { page, c };
}

interface Fonts { sans: PDFFont; sansBold: PDFFont; serifBold: PDFFont; serifItalic: PDFFont }

/** Dark-green letterhead shared by every page — logo (if set) at left, eyebrow/title/subtitle right-aligned. Returns the y content can start at. */
function drawLetterhead(page: PDFPage, c: Cursor, fonts: Fonts, profile: { firmName: string }, logo: Awaited<ReturnType<typeof embedFirmLogo>>, title: string, subtitle: string): number {
  c.rect(0, 0, PAGE_W, HEADER_H, DARKGREEN);
  c.rect(0, HEADER_H, PAGE_W, 3, GOLD);

  if (logo) {
    const logoH = 76;
    const logoW = (logo.width / logo.height) * logoH;
    page.drawImage(logo, { x: L, y: PAGE_H - HEADER_H / 2 - logoH / 2, width: logoW, height: logoH });
  } else {
    c.text(L, HEADER_H / 2 + 6, profile.firmName, { size: 20, font: fonts.serifBold, color: WHITE });
  }

  let y = 40;
  c.tracked(R, y, "SERVICE & FEE SCHEDULE", 1.5, { size: 8.5, bold: true, color: GOLD, align: "right" });
  y += 28;
  c.text(R, y, title, { size: 26, font: fonts.serifBold, color: WHITE, align: "right" });
  y += 22;
  c.text(R, y, subtitle, { size: 10, color: OFFWHITE, align: "right" });

  return HEADER_H + 34;
}

/** A serif section heading with a thin rule extending to the right margin, optionally followed by a muted subtitle line. */
function sectionHeading(c: Cursor, y: number, fonts: Fonts, title: string, subtitle?: string): number {
  const size = 15.5;
  c.text(L, y, title, { size, font: fonts.serifBold, color: INK });
  const w = fonts.serifBold.widthOfTextAtSize(title, size);
  c.line(L + w + 12, y - 5, R, y - 5, LINE, 1);
  y += 20;
  if (subtitle) {
    c.text(L, y, subtitle, { size: 9.5, color: MUTED });
    y += 16;
  }
  return y + 6;
}

function drawFooter(c: Cursor, firmName: string, phone: string, email: string) {
  c.line(L, PAGE_H - 40, R, PAGE_H - 40, LINE, 1);
  c.text(L, PAGE_H - 26, `${firmName.toUpperCase()}  ·  ${phone}  ·  ${email}`, { size: 8, color: MUTED });
  c.text(R, PAGE_H - 26, "Prices shown are minimums — actual fees may vary by engagement scope.", { size: 8, color: MUTED, align: "right" });
}

/** The dotted-leader table header row: left label + right-aligned amount column title, with a thin rule beneath. */
function drawTableHeader(c: Cursor, y: number, amountLabel: string): number {
  c.tracked(L, y, "SERVICE", 1.2, { size: 8.5, bold: true, color: MUTED });
  c.tracked(R, y, amountLabel, 1.2, { size: 8.5, bold: true, color: MUTED, align: "right" });
  y += 8;
  c.line(L, y, R, y, TEAL_LINE, 1.25);
  return y + 14;
}

/** One priced row: label on the left, a dotted leader, then the amount right-aligned. `amountColor`/`amountFont` let one-time rows render an italic gold "By quote" instead of a bold dollar figure. */
function feeRow(c: Cursor, y: number, fonts: Fonts, label: string, amountText: string, amountColor: ReturnType<typeof rgb>, amountFont: PDFFont, amountBold: boolean) {
  c.text(L, y, label, { size: 10.5 });
  const amountSize = 10.5;
  const amountWidth = amountFont.widthOfTextAtSize(amountText, amountSize);
  c.text(R, y, amountText, { size: amountSize, font: amountFont, bold: amountBold, color: amountColor, align: "right" });
  const labelWidth = fonts.sans.widthOfTextAtSize(label, 10.5);
  c.line(L + labelWidth + 6, y - 3, R - amountWidth - 6, y - 3, LINE, 0.75, [1, 2]);
}

export async function generateSubscriptionBrochurePdf(): Promise<Uint8Array> {
  const [catalogRaw, tiers] = await Promise.all([
    query<ServiceCatalogEntry>(`SELECT * FROM altax.v3_service_catalog WHERE active = true AND legacy = false ORDER BY sort_order ASC`),
    query<{ tier_key: SubscriptionTierKey; tier_name: string; description: string | null }>(`SELECT * FROM altax.v3_subscription_tiers ORDER BY sort_order ASC`),
  ]);
  const profile = await getFirmProfile();

  const doc = await PDFDocument.create();
  doc.setTitle("Subscription Plans");
  const fonts: Fonts = {
    sans: await doc.embedFont(StandardFonts.Helvetica),
    sansBold: await doc.embedFont(StandardFonts.HelveticaBold),
    serifBold: await doc.embedFont(StandardFonts.TimesRomanBold),
    serifItalic: await doc.embedFont(StandardFonts.TimesRomanItalic),
  };
  const logo = await embedFirmLogo(doc, profile);

  const recurring = catalogRaw.filter((s) => s.role !== "one_time");
  const oneTime = catalogRaw.filter((s) => s.role === "one_time");

  // ---------- Page 1: tier cards + subscription pricing ----------
  const p1 = await newPage(doc, fonts.sans, fonts.sansBold);
  let y = drawLetterhead(p1.page, p1.c, fonts, profile, logo, "Subscription Plans", "Ongoing bookkeeping, payroll & compliance support");

  y = sectionHeading(p1.c, y, fonts, "Relationship Tiers", "Where a client sits depends on how much of their back office we carry.");

  const gap = 14;
  const cardW = (R - L - gap * 2) / 3;
  const cardTop = y;
  const cardBodyH = 112;
  const TIER_ORDINAL = ["TIER ONE", "TIER TWO", "TIER THREE"];
  tiers.forEach((t, i) => {
    const color = TIER_COLOR[t.tier_key] || TIER_COLOR.essentials;
    const x = L + i * (cardW + gap);
    p1.c.line(x, cardTop, x + cardW, cardTop, color, 2.5);
    p1.c.line(x, cardTop, x, cardTop + cardBodyH, LINE, 0.75);
    p1.c.line(x + cardW, cardTop, x + cardW, cardTop + cardBodyH, LINE, 0.75);
    p1.c.line(x, cardTop + cardBodyH, x + cardW, cardTop + cardBodyH, LINE, 0.75);
    let cy = cardTop + 22;
    p1.c.tracked(x + 16, cy, TIER_ORDINAL[i] || `TIER ${i + 1}`, 1.2, { size: 7.5, bold: true, color: MUTED });
    cy += 16;
    const words = t.tier_name.split(" ");
    const firstLine = words.slice(0, -1).join(" ") || words[0];
    const lastLine = words.length > 1 ? words[words.length - 1] : "";
    p1.c.text(x + 16, cy, firstLine, { size: 17, font: fonts.serifBold, color });
    cy += 19;
    if (lastLine) { p1.c.text(x + 16, cy, lastLine, { size: 17, font: fonts.serifBold, color }); cy += 22; } else cy += 6;
    p1.c.wrapped(x + 16, cy, t.description || TIER_BLURB[t.tier_key] || "", cardW - 32, { size: 9, color: INK, lineHeight: 12.5 });
  });
  y = cardTop + cardBodyH + 24;

  // Cream callout — height measured from wrapped lines before drawing the background.
  const calloutLead = "Every service is priced individually.";
  const calloutRest = " A client's monthly subscription is simply the total of whichever services they need — and the tier above reflects the depth of that relationship.";
  const calloutLines = p1.c.wrapLines(`${calloutLead}${calloutRest}`, R - L - 32, { size: 10.5 });
  const calloutH = 20 + calloutLines.length * 15;
  p1.c.rect(L, y, R - L, calloutH, CREAM);
  p1.c.rect(L, y, 4, calloutH, GOLD);
  let cy2 = y + 20;
  for (const line of calloutLines) { p1.c.text(L + 20, cy2, line, { size: 10.5, color: INK }); cy2 += 15; }
  y += calloutH + 14;

  y = drawTableHeader(p1.c, y, "MONTHLY FEE");
  for (const group of Array.from(new Set(recurring.map((s) => s.group_name)))) {
    p1.c.tracked(L, y, group.toUpperCase(), 1.2, { size: 7.5, bold: true, color: GOLD_TEXT });
    y += 13;
    p1.c.line(L + trackedWidth(fonts.sansBold, group.toUpperCase(), 7.5, 1.2) + 10, y - 4, R, y - 4, LINE, 0.75);
    for (const s of recurring.filter((e) => e.group_name === group)) {
      feeRow(p1.c, y, fonts, s.label, s.min_fee != null ? money(s.min_fee) : "—", INK, fonts.sansBold, true);
      y += 15;
    }
    y += 2;
  }
  drawFooter(p1.c, profile.firmName, profile.phone, profile.email);

  // ---------- Page 2: one-time services + how they're priced + CTA ----------
  const p2 = await newPage(doc, fonts.sans, fonts.sansBold);
  y = drawLetterhead(p2.page, p2.c, fonts, profile, logo, "Other Services", "Project & per-engagement work, billed separately");

  y = sectionHeading(p2.c, y, fonts, "Project & Per-Engagement Work", "Billed per engagement — never part of the monthly subscription.");
  y = drawTableHeader(p2.c, y, "FEE");
  for (const group of Array.from(new Set(oneTime.map((s) => s.group_name)))) {
    p2.c.tracked(L, y, group.toUpperCase(), 1.2, { size: 7.5, bold: true, color: GOLD_TEXT });
    y += 13;
    p2.c.line(L + trackedWidth(fonts.sansBold, group.toUpperCase(), 7.5, 1.2) + 10, y - 4, R, y - 4, LINE, 0.75);
    for (const s of oneTime.filter((e) => e.group_name === group)) {
      // Always "By quote", even if a reference min_fee is set — that figure is an
      // internal staff floor, not a rate to present to the client for something
      // explicitly scoped-before-we-start (see the callout below).
      feeRow(p2.c, y, fonts, s.label, "By quote", GOLD_TEXT, fonts.serifItalic, false);
      y += 15;
    }
    y += 4;
  }
  y += 6;

  const scopedLead = "Scoped before we start.";
  const scopedRest = " Each engagement above is quoted in writing once we understand what's involved, so there is no open-ended billing and nothing lands on the monthly invoice.";
  const scopedLines = p2.c.wrapLines(`${scopedLead}${scopedRest}`, R - L - 32, { size: 10.5 });
  const scopedH = 20 + scopedLines.length * 15;
  p2.c.rect(L, y, R - L, scopedH, CREAM);
  p2.c.rect(L, y, 4, scopedH, GOLD);
  let cy3 = y + 20;
  for (const line of scopedLines) { p2.c.text(L + 20, cy3, line, { size: 10.5, color: INK }); cy3 += 15; }
  y += scopedH + 20;

  y = sectionHeading(p2.c, y, fonts, "How These Engagements Are Priced", "A flat fee, agreed before any work begins.");
  y += 8;
  const stepTop = y;
  const steps = [
    { n: "01", label: "SCOPE", body: "We review what the matter involves — entity type, filings required, documents on hand — before quoting anything." },
    { n: "02", label: "WRITTEN QUOTE", body: "You receive a flat fee in writing, along with what is included and what would fall outside it." },
    { n: "03", label: "DELIVER", body: "Work is completed to the agreed dates and billed once. Nothing is added to your monthly subscription." },
  ];
  const stepW = (R - L) / 3;
  p2.c.line(L, stepTop - 8, R, stepTop - 8, LINE, 1);
  steps.forEach((s, i) => {
    const x = L + i * stepW;
    if (i > 0) p2.c.line(x - 12, stepTop, x - 12, stepTop + 82, LINE, 0.75);
    let sy = stepTop + 22;
    p2.c.text(x, sy, s.n, { size: 22, font: fonts.serifBold, color: GOLD_TEXT });
    sy += 20;
    p2.c.tracked(x, sy, s.label, 1.2, { size: 8.5, bold: true, color: INK });
    sy += 14;
    p2.c.wrapped(x, sy, s.body, stepW - 20, { size: 9, color: MUTED, lineHeight: 12.5 });
  });
  y = stepTop + 100;
  p2.c.line(L, y, R, y, LINE, 1);
  y += 16;

  const ctaTextWidth = R - L - 24 - 24 - 160; // leaves room for the phone/email block on the right
  const ctaBodyLines = p2.c.wrapLines("Tell us what you're filing and who's on payroll — we'll map it to a monthly figure before you commit.", ctaTextWidth, { size: 9 });
  const ctaH = Math.max(84, 48 + ctaBodyLines.length * 13 + 18);
  p2.c.rect(L, y, R - L, ctaH, DARKGREEN);
  p2.c.rect(L, y, 4, ctaH, GOLD);
  p2.c.text(L + 24, y + 30, "Not sure which tier fits?", { size: 15, font: fonts.serifBold, color: WHITE });
  let ctaBodyY = y + 48;
  for (const line of ctaBodyLines) { p2.c.text(L + 24, ctaBodyY, line, { size: 9, color: OFFWHITE }); ctaBodyY += 13; }
  p2.c.text(R - 24, y + ctaH / 2 - 8, profile.phone, { size: 12, bold: true, color: GOLD, align: "right" });
  p2.c.text(R - 24, y + ctaH / 2 + 8, profile.email, { size: 10, color: GOLD, align: "right" });

  drawFooter(p2.c, profile.firmName, profile.phone, profile.email);

  return doc.save();
}
