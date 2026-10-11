/** Report period presets shared by the client portal's Reports page and My Income & Expenses. Weeks run Monday–Sunday. */
export type PeriodKey = "today" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "thisQuarter" | "lastQuarter" | "thisHalf" | "lastHalf" | "thisYear" | "lastYear" | "custom";
export const PERIOD_KEYS: PeriodKey[] = ["today", "thisWeek", "lastWeek", "thisMonth", "lastMonth", "thisQuarter", "lastQuarter", "thisHalf", "lastHalf", "thisYear", "lastYear", "custom"];

const pad = (n: number) => String(n).padStart(2, "0");
export const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function rangeForPeriod(key: PeriodKey): { from: string; to: string } {
  const n = new Date(); const y = n.getFullYear(); const m = n.getMonth(); const q = Math.floor(m / 3); const h = m < 6 ? 0 : 1;
  const monday = new Date(y, m, n.getDate() - ((n.getDay() + 6) % 7));
  const addDays = (d: Date, k: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + k);
  switch (key) {
    case "today": return { from: isoLocal(n), to: isoLocal(n) };
    case "thisWeek": return { from: isoLocal(monday), to: isoLocal(addDays(monday, 6)) };
    case "lastWeek": return { from: isoLocal(addDays(monday, -7)), to: isoLocal(addDays(monday, -1)) };
    case "thisMonth": return { from: isoLocal(new Date(y, m, 1)), to: isoLocal(new Date(y, m + 1, 0)) };
    case "lastMonth": return { from: isoLocal(new Date(y, m - 1, 1)), to: isoLocal(new Date(y, m, 0)) };
    case "thisQuarter": return { from: isoLocal(new Date(y, q * 3, 1)), to: isoLocal(new Date(y, q * 3 + 3, 0)) };
    case "lastQuarter": return { from: isoLocal(new Date(y, (q - 1) * 3, 1)), to: isoLocal(new Date(y, q * 3, 0)) };
    case "thisHalf": return { from: isoLocal(new Date(y, h * 6, 1)), to: isoLocal(new Date(y, h * 6 + 6, 0)) };
    case "lastHalf": return { from: isoLocal(new Date(y, (h - 1) * 6, 1)), to: isoLocal(new Date(y, h * 6, 0)) };
    case "lastYear": return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default: return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
}
