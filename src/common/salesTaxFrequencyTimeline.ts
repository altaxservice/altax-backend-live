import { query, withTransaction } from "../config/db";
import { splitIntoMdFilingPeriodsForClient } from "./mdFiling";

/**
 * One place that owns a client's sales-tax filing-frequency timeline (v3_client_sales_tax_frequency_history).
 * A timeline is an ordered list of segments; each runs from its start date until the day before the next one starts,
 * and the last is open-ended. Every edit — the quick "change from this date" on the client form and the full timeline
 * editor — goes through here, so the history, the client's own current frequency and the period math can never drift
 * apart (they had: several clients showed Monthly on the profile while their history still said Quarterly, which made a
 * "Monthly effective July 1" save a silent no-op).
 */

export const FREQUENCIES = ["Monthly", "Quarterly", "Semiannual", "Annually", "N/A"] as const;
/** The anchor used for a client's first-ever segment — far enough back to cover all real filing history. */
export const TIMELINE_START = "2000-01-01";

export interface Segment { frequency: string; effectiveFrom: string; effectiveTo: string | null }
export interface SegmentInput { frequency: string; effectiveFrom: string }

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function loadTimeline(clientId: string): Promise<Segment[]> {
  const rows = await query<{ frequency: string; effective_from: string; effective_to: string | null }>(
    `SELECT frequency, effective_from::date::text AS effective_from, effective_to::date::text AS effective_to
       FROM altax.v3_client_sales_tax_frequency_history WHERE client_id = $1 ORDER BY effective_from ASC`, [clientId]);
  return rows.map((r) => ({ frequency: r.frequency, effectiveFrom: r.effective_from, effectiveTo: r.effective_to }));
}

/** Validates and normalizes user-supplied segments: known frequencies, valid ascending dates, adjacent duplicates merged, end dates derived. */
export function normalizeTimeline(input: SegmentInput[]): { segments: Segment[]; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(input) || input.length === 0) return { segments: [], errors: ["Add at least one frequency period."] };
  const cleaned: SegmentInput[] = [];
  for (const raw of input) {
    const frequency = String(raw?.frequency || "").trim();
    const effectiveFrom = String(raw?.effectiveFrom || "").trim();
    if (!(FREQUENCIES as readonly string[]).includes(frequency)) { errors.push(`"${frequency || "(blank)"}" is not a valid frequency.`); continue; }
    if (!ISO.test(effectiveFrom) || Number.isNaN(new Date(`${effectiveFrom}T00:00:00Z`).getTime())) { errors.push(`"${effectiveFrom || "(blank)"}" is not a valid date.`); continue; }
    cleaned.push({ frequency, effectiveFrom });
  }
  if (errors.length) return { segments: [], errors };
  cleaned.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  for (let i = 1; i < cleaned.length; i++) {
    if (cleaned[i].effectiveFrom === cleaned[i - 1].effectiveFrom) errors.push(`Two periods start on the same date (${cleaned[i].effectiveFrom}).`);
  }
  if (errors.length) return { segments: [], errors };
  // Merge neighbours with the same frequency — they're one continuous period.
  const merged: SegmentInput[] = [];
  for (const c of cleaned) {
    if (merged.length && merged[merged.length - 1].frequency === c.frequency) continue;
    merged.push(c);
  }
  const segments: Segment[] = merged.map((m, i) => ({ frequency: m.frequency, effectiveFrom: m.effectiveFrom, effectiveTo: i < merged.length - 1 ? dayBefore(merged[i + 1].effectiveFrom) : null }));
  return { segments, errors };
}

/**
 * "From this date on, the frequency is X." Keeps everything before the date, drops everything after, and starts X on the
 * date. Used by the quick change on the client form. Refuses to rewrite older history than the current + previous period —
 * that is what the full timeline editor is for — so a typo'd date can't silently wipe real history.
 */
export function changeFromDate(history: Segment[], newFreq: string, effectiveDate: string): { segments: SegmentInput[]; changed: boolean; error?: string } {
  const sorted = [...history].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  if (sorted.length >= 2 && effectiveDate <= sorted[sorted.length - 2].effectiveFrom) {
    return { segments: [], changed: false, error: `That date is before the current frequency period began (${sorted[sorted.length - 2].effectiveFrom}). Use "Edit frequency timeline" to change earlier history.` };
  }
  const kept: SegmentInput[] = sorted.filter((s) => s.effectiveFrom < effectiveDate).map((s) => ({ frequency: s.frequency, effectiveFrom: s.effectiveFrom }));
  if (newFreq) kept.push({ frequency: newFreq, effectiveFrom: effectiveDate });
  // The very first segment keeps its anchor so earlier real data is never orphaned.
  if (kept.length && !sorted.length) kept[0].effectiveFrom = effectiveDate;
  const before = JSON.stringify(normalizeTimeline(sorted.map((s) => ({ frequency: s.frequency, effectiveFrom: s.effectiveFrom }))).segments);
  const norm = normalizeTimeline(kept.length ? kept : []);
  const after = JSON.stringify(norm.segments);
  return { segments: kept, changed: before !== after };
}

/** Replaces the whole timeline in one transaction and keeps the client's own current-frequency field in step with it. */
export async function saveTimeline(clientId: string, segments: Segment[], actorEmail: string): Promise<void> {
  await withTransaction(async (db) => {
    await db.query(`DELETE FROM altax.v3_client_sales_tax_frequency_history WHERE client_id = $1`, [clientId]);
    for (const s of segments) {
      await db.query(
        `INSERT INTO altax.v3_client_sales_tax_frequency_history (client_id, frequency, effective_from, effective_to, created_by) VALUES ($1,$2,$3,$4,$5)`,
        [clientId, s.frequency, s.effectiveFrom, s.effectiveTo, actorEmail]);
    }
    const current = segments.length ? segments[segments.length - 1].frequency : null;
    await db.query(`UPDATE altax.v3_clients SET sales_tax_frequency = $2 WHERE client_id = $1`, [clientId, current]);
  });
}

export interface PreviewPeriod { start: string; end: string; frequency: string }

/** The filing periods a timeline produces for a date range, each labelled with the frequency that created it. */
export function previewPeriods(segments: Segment[], from: string, to: string): PreviewPeriod[] {
  const { periods } = splitIntoMdFilingPeriodsForClient(from, to, segments, segments.length ? segments[segments.length - 1].frequency : null);
  return periods.map((p: any) => {
    const seg = segments.find((s) => s.effectiveFrom <= p.start && (!s.effectiveTo || s.effectiveTo >= p.start));
    return { start: p.start, end: p.end, frequency: seg?.frequency || "" };
  });
}

/** Already-filed periods that the new timeline would no longer produce exactly (different start/end) — editing across those needs an explicit OK. */
export async function filedConflicts(clientId: string, next: Segment[]): Promise<{ start: string; end: string; paidDate: string | null }[]> {
  const filed = await query<{ s: string; e: string; paid: string | null }>(
    `SELECT period_start::date::text AS s, period_end::date::text AS e, paid_date::date::text AS paid FROM altax.v3_md_filing_payments WHERE client_id = $1 ORDER BY period_start`, [clientId]);
  if (!filed.length) return [];
  const from = filed[0].s;
  const last = filed[filed.length - 1].e;
  const end = new Date(`${last}T00:00:00Z`); end.setUTCFullYear(end.getUTCFullYear() + 1);
  const periods = previewPeriods(next, from, end.toISOString().slice(0, 10));
  const keys = new Set(periods.map((p) => `${p.start}|${p.end}`));
  return filed.filter((f) => !keys.has(`${f.s}|${f.e}`)).map((f) => ({ start: f.s, end: f.e, paidDate: f.paid }));
}
