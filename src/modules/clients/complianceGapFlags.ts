import { query, queryOne } from "../../config/db";
import { CLIENT_TRIGGER_COLUMNS, clientMatchesRule, computeDuePeriod, type DuePeriod } from "../rules/rules.routes";

/**
 * Three new automatic gap checks for computeClientFlags() (clients.routes.ts),
 * extending the existing MD-sales-tax-only automation to cover every service
 * with real, verifiable, current data behind it. Deliberately built ONLY from
 * data the app can trust — see each function's own comment for what evidence
 * it requires before it will ever assert a gap. Two real production bugs this
 * session (sales-tax-frequency-history, $0 MD filing periods) were both caused
 * by inferring obligation history from incomplete data; nothing here repeats
 * that mistake.
 */

const ACTIVE_CLIENT_STATUS_FILTER = `(status IS NULL OR lower(status) NOT IN ('no','false','inactive','archived'))`;

export function isoDate(v: unknown): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / 86400000);
}

/**
 * Later of two optional ISO dates, treating either as "no opinion" if unset —
 * used to combine an obligation-specific registered-since date with
 * date_of_formation as a compliance-deadline floor (see
 * sql/102_obligation_registered_since.sql). A business can't owe an
 * obligation before it legally existed, and it can't register for one before
 * that either, so whichever confirmed date is later is the real floor.
 */
export function laterOf(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b || null;
  if (!b) return a;
  return a > b ? a : b;
}

// ---------------------------------------------------------------------------
// Payroll cadence — a payroll-enabled client with real paycheck history on
// file has gone longer than their own pay frequency should allow without a
// new one. Clients with zero paycheck history are skipped entirely (real
// signal is genuinely absent — same as "we never had data that far back,"
// not evidence of a gap). Deliberately does NOT use
// v3_payroll_schedules.next_pay_date — that column advances on every nightly
// Payroll Agent sweep regardless of whether anything was ever approved, so a
// stale value there proves nothing.
// ---------------------------------------------------------------------------

const PAYROLL_FREQUENCY_INTERVAL_DAYS: Record<string, number> = {
  weekly: 7, "bi-weekly": 14, "semi-monthly": 16, monthly: 31,
};

export interface PayrollCadenceGap { lastPayDate: string; daysSinceLastPay: number }

function payrollIntervalDays(frequency: unknown): number | null {
  const key = String(frequency || "").trim().toLowerCase();
  return PAYROLL_FREQUENCY_INTERVAL_DAYS[key] ?? null;
}

export async function computeClientPayrollCadenceGap(
  clientId: string, clientRow: any, graceDays: number, asOf: string = new Date().toISOString().slice(0, 10)
): Promise<PayrollCadenceGap | null> {
  if (clientRow.payroll_enabled !== true) return null;
  const intervalDays = payrollIntervalDays(clientRow.payroll_frequency);
  if (!intervalDays) return null;
  const row = await queryOne<any>(
    `SELECT MAX(pay_date) AS last_pay_date FROM altax.v3_paychecks WHERE client_id = $1 AND lower(coalesce(status,'')) <> 'void'`,
    [clientId]
  );
  const lastPayDate = isoDate(row?.last_pay_date);
  if (!lastPayDate) return null;
  const daysSince = daysBetween(lastPayDate, asOf);
  if (daysSince <= intervalDays + graceDays) return null;
  return { lastPayDate, daysSinceLastPay: daysSince };
}

export async function computeFirmWidePayrollCadenceGaps(
  graceDays: number, asOf: string = new Date().toISOString().slice(0, 10)
): Promise<Map<string, { clientName: string } & PayrollCadenceGap>> {
  const rows = await query<any>(
    `SELECT c.client_id, c.client_name, c.payroll_frequency,
            (SELECT MAX(p.pay_date) FROM altax.v3_paychecks p
              WHERE p.client_id = c.client_id AND lower(coalesce(p.status,'')) <> 'void') AS last_pay_date
       FROM altax.v3_clients c
      WHERE c.payroll_enabled = true AND c.payroll_frequency IS NOT NULL AND c.payroll_frequency NOT IN ('', 'N/A')
        AND ${ACTIVE_CLIENT_STATUS_FILTER}`
  );
  const out = new Map<string, { clientName: string } & PayrollCadenceGap>();
  for (const r of rows) {
    const intervalDays = payrollIntervalDays(r.payroll_frequency);
    if (!intervalDays) continue;
    const lastPayDate = isoDate(r.last_pay_date);
    if (!lastPayDate) continue;
    const daysSince = daysBetween(lastPayDate, asOf);
    if (daysSince > intervalDays + graceDays) {
      out.set(r.client_id, { clientName: r.client_name, lastPayDate, daysSinceLastPay: daysSince });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bookkeeping staleness — a client with an ESTABLISHED, recent pattern of GL
// activity (at least 2 postings in the 12 months before the gap started) has
// gone quiet past a threshold. Gated on real GL history, not services[] —
// there's no dedicated "bookkeeping enabled" column anywhere in the schema,
// and services[] is exactly the loosely-synced array this check is designed
// not to trust. A client with zero/one GL entries ever is correctly skipped
// either way (never established a real posting cadence to fall out of).
//
// Real production data check (2026-08-17): the firm's whole client base
// normally lags ~48 days behind on posting (monthly close cadence) — a naive
// 45-day threshold flagged 25 of 86 clients simultaneously, all for the same
// firm-wide catch-up rhythm, not individual problems. 75 days correctly
// narrows to the 2 genuinely stale clients. Default set accordingly.
// ---------------------------------------------------------------------------

export interface BookkeepingStaleness { lastEntryDate: string; daysSinceLastEntry: number }

export async function computeClientBookkeepingStaleness(
  clientId: string, staleDaysThreshold: number, asOf: string = new Date().toISOString().slice(0, 10)
): Promise<BookkeepingStaleness | null> {
  const row = await queryOne<any>(
    `SELECT MAX(entry_date) AS last_entry_date,
            COUNT(*) FILTER (WHERE entry_date >= $2::date - interval '12 months'
                                AND entry_date < $2::date - ($3::text || ' days')::interval) AS recent_count
       FROM altax.v3_gl_entries WHERE client_id = $1`,
    [clientId, asOf, staleDaysThreshold]
  );
  const lastEntryDate = isoDate(row?.last_entry_date);
  if (!lastEntryDate || Number(row?.recent_count || 0) < 2) return null;
  const daysSince = daysBetween(lastEntryDate, asOf);
  if (daysSince <= staleDaysThreshold) return null;
  return { lastEntryDate, daysSinceLastEntry: daysSince };
}

export async function computeFirmWideBookkeepingStaleness(
  staleDaysThreshold: number, asOf: string = new Date().toISOString().slice(0, 10)
): Promise<Map<string, { clientName: string } & BookkeepingStaleness>> {
  const rows = await query<any>(
    `SELECT g.client_id, c.client_name, MAX(g.entry_date) AS last_entry_date,
            COUNT(*) FILTER (WHERE g.entry_date >= $1::date - interval '12 months'
                                AND g.entry_date < $1::date - ($2::text || ' days')::interval) AS recent_count
       FROM altax.v3_gl_entries g
       JOIN altax.v3_clients c ON c.client_id = g.client_id
      GROUP BY g.client_id, c.client_name`,
    [asOf, staleDaysThreshold]
  );
  const out = new Map<string, { clientName: string } & BookkeepingStaleness>();
  for (const r of rows) {
    const lastEntryDate = isoDate(r.last_entry_date);
    if (!lastEntryDate || Number(r.recent_count || 0) < 2) continue;
    const daysSince = daysBetween(lastEntryDate, asOf);
    if (daysSince > staleDaysThreshold) {
      out.set(r.client_id, { clientName: r.client_name, lastEntryDate, daysSinceLastEntry: daysSince });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Missing compliance task — for the 4 obligation sources complianceCalendar.ts
// itself documents as UNVERIFIED_PAST_SOURCES (EFTPS, MD Withholding, MD UI,
// Business Tax Return), nothing today cross-checks whether the Task Rules
// Agent actually drafted (and staff approved) a task for the current period.
// Scoped to only the single most-recently-closed period per rule —
// computeDuePeriod() only ever returns that one period by construction, so
// this can never assert a backlog of assumed-missed history.
//
// Real production data check (2026-08-17): task `period` label text is NOT a
// reliable match key — the same real obligation shows up as "June 30, 2026"
// on a real MD UI task where computeDuePeriod() would generate "Q2 2026" for
// the same period, and MD Withholding tasks split between "6/1/2026" and
// "June 2026" for the identical period. agency_due_date is far more
// consistent but still drifted by 1 day on real historical rows (2026-07-14
// vs. the rule's own due_day=15). Matches on a +/-5 day due-date window
// instead of exact date or period-string equality, to absorb that real-world
// noise without either false-negatives (missing a real match) or
// false-positives (asserting a gap that's actually just filed under an older
// period-label convention).
//
// Same real-data check ALSO found task_name drift independent of the above:
// a rule's task_type label can be edited after tasks already exist under the
// old name (confirmed live — rule TR-009 is now "MD UI Wages Filing &
// Payment" but a real, already-completed task for it is just "MD UI Wages
// Filing"). Exact task_name equality would call that a false "missing" gap.
// Matches on either label being a prefix of the other instead — catches this
// exact drift pattern (a suffix like "& Payment" added later) while still
// keeping genuinely distinct rules apart (TR-009 "...Filing" and TR-010
// "...payment" diverge immediately, so neither prefixes the other).
// ---------------------------------------------------------------------------

export function taskLabelsLikelyMatch(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

const MISSING_TASK_TRIGGER_COLUMNS = new Set(["eftps_enabled", "md_withholding_frequency", "mdui_enabled", "business_return_type"]);
export const MISSING_TASK_MATCH_WINDOW_DAYS = 5;

// A confirmed registered-since date (see sql/102_obligation_registered_since.sql)
// is a hard fact, not a heuristic — never flag a period as "missing" before it.
// business_return_type has no equivalent column: there's no natural
// "registered since" concept for annual tax prep, and Annual-frequency rules
// are already excluded by relevantMissingTaskRules above.
const REGISTERED_SINCE_COLUMN: Record<string, string> = {
  eftps_enabled: "eftps_registered_since",
  md_withholding_frequency: "md_withholding_registered_since",
  mdui_enabled: "mdui_registered_since",
};

export interface MissingComplianceTaskGap { ruleId: string; taskType: string; periodLabel: string; dueDate: string }

// Real production data check (2026-08-17): Annual-frequency rules in this
// group — the 4 Business Tax Return rules (1120/1120S/1065/Schedule C) and
// MD Withholding Annual Reconciliation (MW508) — turned out to essentially
// NEVER have a matching v3_tasks/v3_archived_tasks row firm-wide (76/52/33/18
// clients respectively out of the whole active client base, on a fresh
// re-check). That's not individual clients falling behind — it's that annual
// return prep and MW508 are handled directly during tax season and were
// never tracked through this task system to begin with. Scoped out entirely
// rather than guessing at a per-client answer the app has no data to support.
//
// Second real production data check (2026-08-18, against actual production —
// the first check above ran against the dev database by mistake and missed
// this): MD UI and MD Withholding each define a separate Filing rule
// (TR-009, TR-014*) AND Payment rule (TR-010, TR-015*) for the same
// obligation, but staff only ever create ONE combined task per period,
// always named "... Filing" — confirmed zero tasks named "...payment" exist
// anywhere in production (open or archived) for either obligation, across
// every client. The Payment rule variant would therefore flag nearly every
// enrolled client every period, not because payment was actually missed,
// but because "Payment" was never tracked as a task distinct from "Filing"
// to begin with — the same false-positive shape as the Annual exclusion
// above, just triggered by task_type instead of frequency. EFTPS has no
// such split (a single "EFTPS Deposit" rule covers the whole obligation),
// so it's unaffected by this exclusion.
export function relevantMissingTaskRules(rules: any[]): any[] {
  return rules.filter((rule) => {
    const col = CLIENT_TRIGGER_COLUMNS[String(rule.trigger_column || "").trim()];
    if (!col || !MISSING_TASK_TRIGGER_COLUMNS.has(col)) return false;
    if (String(rule.frequency || "").trim().toLowerCase() === "annual") return false;
    return !/\bpayment$/i.test(String(rule.task_type || "").trim());
  });
}

export async function computeClientMissingComplianceTaskGaps(clientId: string, clientRow: any, asOf: Date = new Date()): Promise<MissingComplianceTaskGap[]> {
  const rules = relevantMissingTaskRules(await query<any>(`SELECT * FROM altax.v3_task_rules WHERE active = true`));
  const asOfStr = asOf.toISOString().slice(0, 10);
  const candidates: { rule: any; period: DuePeriod }[] = [];
  for (const rule of rules) {
    if (!clientMatchesRule(clientRow, rule)) continue;
    const period = computeDuePeriod(rule, asOf);
    if (!period || period.dueDate >= asOfStr) continue; // not yet due — nothing to check
    const col = CLIENT_TRIGGER_COLUMNS[String(rule.trigger_column || "").trim()];
    const registeredSince = laterOf(isoDate(clientRow[REGISTERED_SINCE_COLUMN[col] || ""]), isoDate(clientRow.date_of_formation));
    if (registeredSince && period.dueDate < registeredSince) continue; // obligation didn't exist yet
    candidates.push({ rule, period });
  }
  if (candidates.length === 0) return [];

  const clientTasks = await query<any>(
    `SELECT task_name, agency_due_date::date AS agency_due_date FROM altax.v3_tasks
      WHERE client_id = $1 AND agency_due_date IS NOT NULL
      UNION ALL
      SELECT task_name, agency_due_date::date AS agency_due_date FROM altax.v3_archived_tasks
      WHERE client_id = $1 AND agency_due_date IS NOT NULL`,
    [clientId]
  );
  const clientTaskRows = clientTasks
    .map((r: any) => ({ taskName: String(r.task_name || ""), dueDate: isoDate(r.agency_due_date) }))
    .filter((r): r is { taskName: string; dueDate: string } => !!r.dueDate);

  const gaps: MissingComplianceTaskGap[] = [];
  for (const { rule, period } of candidates) {
    const taskType = String(rule.task_type || "").trim();
    const hasMatch = clientTaskRows.some((r) =>
      taskLabelsLikelyMatch(r.taskName, taskType) && Math.abs(daysBetween(r.dueDate, period.dueDate)) <= MISSING_TASK_MATCH_WINDOW_DAYS
    );
    if (!hasMatch) gaps.push({ ruleId: rule.rule_id, taskType, periodLabel: period.periodLabel, dueDate: period.dueDate });
  }
  return gaps;
}

export async function computeFirmWideMissingComplianceTaskGaps(asOf: Date = new Date()): Promise<Map<string, { clientName: string; gaps: MissingComplianceTaskGap[] }>> {
  const [clients, allRules] = await Promise.all([
    query<any>(`SELECT * FROM altax.v3_clients WHERE ${ACTIVE_CLIENT_STATUS_FILTER}`),
    query<any>(`SELECT * FROM altax.v3_task_rules WHERE active = true`),
  ]);
  const rules = relevantMissingTaskRules(allRules);
  if (rules.length === 0 || clients.length === 0) return new Map();
  const asOfStr = asOf.toISOString().slice(0, 10);

  type Candidate = { clientId: string; clientName: string; rule: any; period: DuePeriod };
  const candidates: Candidate[] = [];
  for (const client of clients) {
    for (const rule of rules) {
      if (!clientMatchesRule(client, rule)) continue;
      const period = computeDuePeriod(rule, asOf);
      if (!period || period.dueDate >= asOfStr) continue;
      const col = CLIENT_TRIGGER_COLUMNS[String(rule.trigger_column || "").trim()];
      const registeredSince = laterOf(isoDate(client[REGISTERED_SINCE_COLUMN[col] || ""]), isoDate(client.date_of_formation));
      if (registeredSince && period.dueDate < registeredSince) continue; // obligation didn't exist yet
      candidates.push({ clientId: client.client_id, clientName: client.client_name, rule, period });
    }
  }
  if (candidates.length === 0) return new Map();

  const clientIds = Array.from(new Set(candidates.map((c) => c.clientId)));
  const existingRows = await query<any>(
    `SELECT client_id, task_name, agency_due_date::date AS agency_due_date FROM altax.v3_tasks
      WHERE client_id = ANY($1::text[]) AND agency_due_date IS NOT NULL
      UNION ALL
      SELECT client_id, task_name, agency_due_date::date AS agency_due_date FROM altax.v3_archived_tasks
      WHERE client_id = ANY($1::text[]) AND agency_due_date IS NOT NULL`,
    [clientIds]
  );
  const tasksByClient = new Map<string, { taskName: string; dueDate: string }[]>();
  for (const r of existingRows) {
    const d = isoDate(r.agency_due_date);
    if (!d) continue;
    if (!tasksByClient.has(r.client_id)) tasksByClient.set(r.client_id, []);
    tasksByClient.get(r.client_id)!.push({ taskName: String(r.task_name || ""), dueDate: d });
  }

  const out = new Map<string, { clientName: string; gaps: MissingComplianceTaskGap[] }>();
  for (const c of candidates) {
    const taskType = String(c.rule.task_type || "").trim();
    const clientTaskRows = tasksByClient.get(c.clientId) || [];
    const hasMatch = clientTaskRows.some((r) =>
      taskLabelsLikelyMatch(r.taskName, taskType) && Math.abs(daysBetween(r.dueDate, c.period.dueDate)) <= MISSING_TASK_MATCH_WINDOW_DAYS
    );
    if (hasMatch) continue;
    if (!out.has(c.clientId)) out.set(c.clientId, { clientName: c.clientName, gaps: [] });
    out.get(c.clientId)!.gaps.push({ ruleId: c.rule.rule_id, taskType, periodLabel: c.period.periodLabel, dueDate: c.period.dueDate });
  }
  return out;
}

// ---------------------------------------------------------------------------
// MD Annual Report — firm-wide list of clients with no recorded completion
// (v3_obligation_completions) for their most recently due Annual Report. See
// complianceCalendar.ts's computeUpcomingDeadlines for the same per-client
// logic and its full rationale (mirrored here rather than imported, since
// that file is deliberately DB-access-free — see its own top comment).
// dateOfFormation is the same floor used there: without it, a client that
// didn't exist yet for the fiscal year in question would be falsely flagged.
//
// 2026-08-26: that floor originally REQUIRED a formation date to include a
// client at all — but 140 of the 141 real clients with the flag on have no
// date_of_formation on file, so this sweep was silently only ever checking
// 1 client. Flipped to match complianceCalendar.ts: a missing formation
// date now means "include them" (assume old enough), and only a formation
// date that PROVES the client is too new excludes them.
// ---------------------------------------------------------------------------

export interface MdAnnualReportOverdue { clientId: string; clientName: string; dueDate: string }

export async function computeFirmWideMdAnnualReportOverdue(asOf: Date = new Date()): Promise<MdAnnualReportOverdue[]> {
  const clients = await query<any>(
    `SELECT client_id, client_name, date_of_formation FROM altax.v3_clients
      WHERE md_annual_report_enabled = true AND ${ACTIVE_CLIENT_STATUS_FILTER}`
  );
  if (clients.length === 0) return [];
  const asOfStr = asOf.toISOString().slice(0, 10);
  const period = computeDuePeriod({ frequency: "Annual", due_day: "15", due_month: "4" }, asOf);
  if (!period || period.dueDate >= asOfStr) return [];

  const eligible = clients.filter((c: any) => {
    const formed = isoDate(c.date_of_formation);
    return !formed || formed <= period.periodEnd;
  });
  if (eligible.length === 0) return [];

  const clientIds = eligible.map((c: any) => c.client_id);
  const completions = await query<any>(
    `SELECT client_id FROM altax.v3_obligation_completions WHERE source = 'MD Annual Report' AND due_date = $1::date AND client_id = ANY($2::text[])`,
    [period.dueDate, clientIds]
  );
  const completedIds = new Set(completions.map((r: any) => r.client_id));

  return eligible
    .filter((c: any) => !completedIds.has(c.client_id))
    .map((c: any) => ({ clientId: c.client_id, clientName: c.client_name, dueDate: period.dueDate }));
}
