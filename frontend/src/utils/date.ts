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
