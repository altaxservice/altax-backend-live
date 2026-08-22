/**
 * Formats a calendar-date-only value (due dates, invoice dates, pay dates —
 * stored as UTC-midnight TIMESTAMPTZ with no real time-of-day meaning).
 * Plain `new Date(v).toLocaleDateString()` renders in the browser's local
 * timezone, which silently shifts the date back a day for any US timezone
 * (confirmed live: a 2026-07-09 input round-tripped and displayed as 7/8).
 * Forcing the Intl formatter to read UTC fields keeps the calendar date the
 * user entered. Do not use this for real timestamps (sent_at, logged_at,
 * last_login) where the local time-of-day is meaningful — those should keep
 * using toLocaleString()/toLocaleDateString() as-is.
 */
export function fmtDateOnly(value: unknown): string {
  if (!value) return "—";
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { timeZone: "UTC" });
}

/**
 * Whole-day difference between a calendar-date-only value (due date, invoice
 * due date, pay date) and today, comparing calendar dates only — not a raw
 * timestamp diff. Same underlying bug as fmtDateOnly's doc comment: naively
 * diffing `new Date(value)` (UTC midnight) against `new Date()` (or even
 * local midnight) shifts every date back a day for any US timezone, making a
 * task/invoice due *today* register as already overdue. Slicing the date
 * string avoids the Date constructor's timezone reinterpretation entirely —
 * both sides become local-midnight-of-their-calendar-date before diffing.
 * Positive = in the future, 0 = today, negative = overdue.
 */
export function daysUntil(value: unknown): number | null {
  if (!value) return null;
  const target = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/**
 * Formats a real lifecycle timestamp (signed_at, submitted_at, uploaded_at,
 * logged_at, etc.) with both date and time — unlike fmtDateOnly, the
 * time-of-day here is meaningful and stored, so it should be shown, not
 * dropped. Local timezone (toLocaleString's default), since these are real
 * moments, not calendar dates.
 */
export function fmtDateTime(value: unknown): string {
  if (!value) return "—";
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Calendar-day difference between a real timestamp and now — for staleness
 * bucketing (e.g. "over 30 days since last check"). Compares local calendar
 * dates, not a raw ms diff, so a check made at 11pm yesterday reads as
 * "1 day ago" rather than rounding to "0" from a same-24h-window diff.
 */
export function daysSince(value: unknown): number | null {
  if (!value) return null;
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((startOfToday.getTime() - startOfThat.getTime()) / 86400000);
}

/**
 * "today at 2:15 PM" / "yesterday at 9:03 AM" / "Aug 19 at 9:03 AM (3d ago)" —
 * for real check-in timestamps (external verification "Mark Checked", etc.)
 * where the exact time matters (which of two same-day checks is current) as
 * much as the at-a-glance recency does. Callers prepend their own label
 * ("Checked ...", "MDTAXCONNECT: ...").
 */
export function fmtCheckedAt(value: unknown): string {
  if (!value) return "Never checked";
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return "Never checked";
  const diffDays = daysSince(value)!;
  const timeStr = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (diffDays <= 0) return `today at ${timeStr}`;
  if (diffDays === 1) return `yesterday at ${timeStr}`;
  const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${dateStr} at ${timeStr} (${diffDays}d ago)`;
}
