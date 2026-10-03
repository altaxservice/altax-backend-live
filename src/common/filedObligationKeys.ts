import { query } from "../config/db";
import { annualReportDueDate } from "./obligationSchedules";

/**
 * At a Glance hides a deadline once it's "completed" (v3_obligation_completions,
 * keyed `${source}|${date}`). Recording a UI wage filing, an annual/biennial
 * report, or a Form 941 in their own filing tables should hide the matching
 * deadline too, without a second "Mark done" — this derives those keys from the
 * filings themselves, with each date computed the way the calendar computes it
 * (complianceCalendar.ts), so the two never disagree.
 *
 * Form 941's Q4 return is skipped on purpose: its January 31 date is shared with
 * the Form 940 deadline under the same source, so hiding it could hide a 940
 * that hasn't been filed.
 */
function isoOnly(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}
function lastDay(year: number, month0: number): number { return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate(); }
function nextBusinessDay(d: string): string {
  const x = new Date(`${d}T00:00:00Z`);
  const dow = x.getUTCDay();
  if (dow === 6) x.setUTCDate(x.getUTCDate() + 2); else if (dow === 0) x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}

/** The calendar's UI date for a quarter: MD the firm's 24th target, VA/PA month-end moved off a weekend, DC/DE month-end as published. */
function uiCalendarDate(state: string, periodEnd: string): string {
  const [y, m] = periodEnd.split("-").map(Number);
  const dueYear = m === 12 ? y + 1 : y;
  const dueMonth0 = m % 12;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (!state || state === "MD") return `${dueYear}-${pad(dueMonth0 + 1)}-24`;
  const monthEnd = `${dueYear}-${pad(dueMonth0 + 1)}-${pad(lastDay(dueYear, dueMonth0))}`;
  return state === "VA" || state === "PA" ? nextBusinessDay(monthEnd) : monthEnd;
}

export async function loadFiledCalendarKeys(
  clientId: string, client: { state?: string | null; entity_type?: string | null; date_of_formation?: unknown }
): Promise<Set<string>> {
  const keys = new Set<string>();
  const state = String(client.state || "").trim().toUpperCase();
  const formation = client.date_of_formation ? isoOnly(client.date_of_formation) : null;

  const [ui, annual, f941] = await Promise.all([
    query<any>(`SELECT period_end FROM altax.v3_md_ui_filings WHERE client_id = $1`, [clientId]),
    query<any>(`SELECT period_end FROM altax.v3_annual_report_filings WHERE client_id = $1`, [clientId]),
    query<any>(`SELECT period_end, quarter FROM altax.v3_form941_filings WHERE client_id = $1`, [clientId]),
  ]);
  for (const r of ui) keys.add(`MD UI|${uiCalendarDate(state, isoOnly(r.period_end))}`);
  for (const r of annual) {
    const reportYear = Number(isoOnly(r.period_end).slice(0, 4));
    const due = state && state !== "MD"
      ? annualReportDueDate({ clientId, state, entityType: client.entity_type ?? null, dateOfFormation: formation }, reportYear + 1)
      : `${reportYear + 1}-04-15`;
    if (due) keys.add(`MD Annual Report|${due}`);
  }
  for (const r of f941) {
    const end = isoOnly(r.period_end);
    if (Number(r.quarter) === 4) continue;
    const [y, m] = end.split("-").map(Number);
    keys.add(`Federal Payroll Tax|${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay(y, m)).padStart(2, "0")}`);
  }
  return keys;
}
