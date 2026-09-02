import crypto from "crypto";
import { query, queryOne } from "../../config/db";
import { computeDuePeriod } from "../rules/rules.routes";

// A 3-digit random suffix collided in a same-second bulk-insert loop
// elsewhere in this module (eftpsDeposits.routes.ts) — this sweep also loops
// over every eftps_enabled client within one run, so it uses the same
// higher-entropy UUID-derived suffix as a precaution, not just a one-off fix.
function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/**
 * Runs daily. For every eftps_enabled client, ensures a staff task exists for
 * the current (most recently closed) monthly deposit period — a real safety
 * net against EFTPS's hard "8PM ET, one calendar day before due date" cutoff,
 * not just a courtesy nudge. staff_due_date is set 5 days before the actual
 * due date, giving real runway; the existing 6:30AM staff digest
 * (reminders.routes.ts) only emails a task once it's within 3 calendar days
 * of staff_due_date, so this lands in that digest automatically with no new
 * email code needed. Idempotent per (client, period) — safe to run every day.
 */
export async function ensureEftpsStaffTasks(): Promise<{ created: number }> {
  const clients = await query<any>(
    `SELECT client_id, client_name, assigned_to, payroll_system FROM altax.v3_clients WHERE eftps_enabled = true AND status <> 'Archived'`
  );
  let created = 0;
  const now = new Date();

  for (const client of clients) {
    const period = computeDuePeriod({ frequency: "Monthly", due_day: "15", due_month: "1" }, now);
    if (!period) continue;

    const alreadyProcessed = await queryOne<any>(
      `SELECT deposit_id FROM altax.v3_eftps_deposits WHERE client_id = $1 AND period_start = $2 AND period_end = $3`,
      [client.client_id, period.periodStart, period.periodEnd]
    );
    if (alreadyProcessed) continue;

    const sourceRecordId = `${client.client_id}:${period.periodEnd}`;
    const existingTask = await queryOne<any>(
      `SELECT task_id FROM altax.v3_tasks WHERE source_system = 'EftpsDepositTask' AND source_record_id = $1`,
      [sourceRecordId]
    );
    if (existingTask) continue;

    const [y, m, d] = period.dueDate.split("-").map(Number);
    const staffDueDate = new Date(Date.UTC(y, m - 1, d - 5)).toISOString().slice(0, 10);

    // QBO auto-deposits federal payroll tax itself (confirmed by the firm,
    // same distinction already applied to "Payroll Processing" via
    // TR-018/TR-019, and to Form 941/MD UI via TR-013/TR-009/TR-029/TR-030) —
    // staff only need to confirm it happened, via the EFTPS Deposits page's
    // bulk QBO-confirm view, not run the Drake import workflow.
    const isQbo = String(client.payroll_system || "").trim().toUpperCase() === "QBO";
    const taskName = isQbo
      ? `EFTPS Deposit — Confirm QBO Filed — ${period.periodLabel}`
      : `EFTPS Deposit Due — ${period.periodLabel}`;
    const notes = isQbo
      ? `Federal payroll tax deposit for ${period.periodLabel}, due ${period.dueDate}. QuickBooks Online auto-deposits this — confirm it went through (EFTPS Deposits page, "Confirm QBO Filed") rather than filing it manually.`
      : `Federal payroll tax deposit for ${period.periodLabel}, due ${period.dueDate}. Use the EFTPS Deposit workflow (import Drake's Tax Liability and Payroll Wages reports for this period) to process.`;

    await query(
      `INSERT INTO altax.v3_tasks
         (task_id, client_id, client_name, task_name, service_line, status, assigned_to, staff_due_date, agency_due_date,
          notes, source_system, source_record_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'Payroll & Employment','Not Started',$5,$6,$7,$8,'EftpsDepositTask',$9, now(), now())`,
      [`T-${idSuffix()}`, client.client_id, client.client_name, taskName,
        client.assigned_to || null, staffDueDate, period.dueDate, notes,
        sourceRecordId]
    );
    created++;
  }
  return { created };
}

/**
 * Closes the proactive staff task for a period once its EFTPS deposit has been
 * saved — otherwise it keeps reappearing in the daily digest even after staff
 * have already handled it. No-op if no such task exists. filedDate is set
 * here (not just status) so the Compliance Timeline's on-time/late check
 * (complianceTimeline.ts, computeTaskRuleLanes) has real evidence to compare
 * against agency_due_date, instead of falling back to its "Completed but no
 * filed_date on record" benefit-of-the-doubt default.
 */
export async function closeEftpsStaffTask(clientId: string, periodEnd: string, filedDate: string): Promise<void> {
  await query(
    `UPDATE altax.v3_tasks SET status = 'Completed', filed_date = $2::date, updated_at = now()
      WHERE source_system = 'EftpsDepositTask' AND source_record_id = $1 AND status NOT IN ('Completed', 'Closed', 'Archived', 'Void')`,
    [`${clientId}:${periodEnd}`, filedDate]
  );
}
