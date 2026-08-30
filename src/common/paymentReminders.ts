/**
 * Shared "remind the client before their payment is due" scheduler, fed by
 * all three filing/payment source systems (MD Sales Tax, obligation-completion
 * deposits like EFTPS, and task-tracked agency filings) instead of three
 * copy-pasted crons — mirrors how classifyMdFilingPeriod (mdFiling.ts) was
 * pulled out to kill duplicated MD-period logic across call sites earlier
 * this session.
 *
 * The cron (runPaymentDueReminders) is modeled directly on
 * runAppointmentConfirmationRequests (appointments.routes.ts): atomic claim
 * via UPDATE...RETURNING before sending (closes the same check-then-act race),
 * revert-to-Scheduled on failure so a transient error retries next sweep, and
 * alertAdmins once per run if anything genuinely failed.
 */
import { query, queryOne } from "../config/db";
import crypto from "crypto";
import { recordNotificationFailure } from "./notifications";
import { alertAdmins } from "./adminAlerts";
import { sendPaymentDueReminder } from "./filingConfirmationEmail";

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/** The UTC offset (in hours, e.g. -5 for EST or -4 for EDT) America/New_York is at on a given date — resolved via Intl against real IANA tzdata so DST transitions are handled correctly without a date library. */
function etOffsetHoursForDate(dateStr: string): number {
  const ref = new Date(`${dateStr}T12:00:00.000Z`); // noon UTC — nowhere near a DST-transition boundary
  const part = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
    .formatToParts(ref).find((p) => p.type === "timeZoneName")?.value || "GMT-5";
  return parseInt(part.replace("GMT", ""), 10) || -5;
}

/** A given wall-clock hour:minute in America/New_York on dateStr, as a real UTC instant. */
function etWallClockToUtc(dateStr: string, hour: number, minute: number): Date {
  const offsetHours = etOffsetHoursForDate(dateStr);
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour - offsetHours, minute, 0));
}

function toDateOnlyStr(v: unknown): string {
  return new Date(v as any).toISOString().slice(0, 10);
}

export interface ScheduleReminderInput {
  sourceSystem: "MdFiling" | "ObligationCompletion" | "Task" | "AnnualReportFiling" | "MdUiFiling";
  sourceRecordId: string;
  clientId: string;
  filingType: string;
  periodLabel: string | null;
  amount: number;
  paymentDueDate: string; // YYYY-MM-DD
  createdBy: string;
  /** Days before paymentDueDate to remind, at 9:00 AM ET. Default 1 (the original "day before" behavior) — EFTPS deposits pass 2, since the client needs enough notice to have funds in the account, not just a courtesy heads-up. */
  leadDays?: number;
}

/**
 * Schedules (or re-schedules) a payment-due reminder for 9:00 AM America/New_York,
 * leadDays before paymentDueDate (default 1, the original "day before" behavior).
 * If that instant has already passed (the due date is too close, or in the past,
 * by the time this is called), does NOT schedule anything — the immediate
 * filing-confirmation email already covers it, and a reminder that would fire in
 * the past is meaningless.
 */
export async function schedulePaymentReminder(input: ScheduleReminderInput): Promise<void> {
  const leadDays = input.leadDays ?? 1;
  const [y, m, d] = input.paymentDueDate.split("-").map(Number);
  const dayBeforeStr = new Date(Date.UTC(y, m - 1, d - leadDays)).toISOString().slice(0, 10);
  const remindAt = etWallClockToUtc(dayBeforeStr, 9, 0);
  if (remindAt.getTime() <= Date.now()) return;

  await query(
    `INSERT INTO altax.v3_payment_reminders
       (reminder_id, source_system, source_record_id, client_id, filing_type, period_label, amount, payment_due_date, remind_at, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Scheduled',$10)
     ON CONFLICT (source_system, source_record_id) DO UPDATE SET
       client_id = EXCLUDED.client_id, filing_type = EXCLUDED.filing_type, period_label = EXCLUDED.period_label,
       amount = EXCLUDED.amount, payment_due_date = EXCLUDED.payment_due_date, remind_at = EXCLUDED.remind_at,
       status = 'Scheduled', sent_at = NULL, canceled_at = NULL, canceled_reason = NULL, created_by = EXCLUDED.created_by`,
    [`PMTRM-${idSuffix()}`, input.sourceSystem, input.sourceRecordId, input.clientId, input.filingType, input.periodLabel,
      input.amount, input.paymentDueDate, remindAt.toISOString(), input.createdBy]
  );
}

/** Cancels a still-Scheduled reminder — payment was recorded, the filing was corrected/reverted, or the task was archived. No-op if none exists or it already fired/was already canceled. */
export async function cancelPaymentReminder(sourceSystem: string, sourceRecordId: string, reason: string): Promise<void> {
  await query(
    `UPDATE altax.v3_payment_reminders SET status = 'Canceled', canceled_at = now(), canceled_reason = $3
       WHERE source_system = $1 AND source_record_id = $2 AND status = 'Scheduled'`,
    [sourceSystem, sourceRecordId, reason]
  );
}

/**
 * Belt-and-suspenders re-check at fire time: cancelPaymentReminder() should
 * already have canceled a reminder the moment payment was recorded, but this
 * closes the narrow race where payment lands in the exact window between this
 * sweep's claim and its send. Returns false (safe to skip sending) if the
 * underlying record can't be found at all — nothing left to remind about.
 */
async function isStillUnpaid(sourceSystem: string, sourceRecordId: string): Promise<boolean> {
  if (sourceSystem === "MdFiling") {
    const [clientId, periodEnd] = sourceRecordId.split(":");
    const row = await queryOne<any>(`SELECT paid_date FROM altax.v3_md_filing_payments WHERE client_id = $1 AND period_end = $2`, [clientId, periodEnd]);
    return !row || !row.paid_date;
  }
  if (sourceSystem === "ObligationCompletion") {
    const parts = sourceRecordId.split(":");
    const clientId = parts[0];
    const dueDate = parts[parts.length - 1];
    const source = parts.slice(1, -1).join(":");
    const row = await queryOne<any>(`SELECT paid_date FROM altax.v3_obligation_completions WHERE client_id = $1 AND source = $2 AND due_date = $3`, [clientId, source, dueDate]);
    return !row || !row.paid_date;
  }
  if (sourceSystem === "Task") {
    const row = await queryOne<any>(`SELECT paid_date FROM altax.v3_tasks WHERE task_id = $1`, [sourceRecordId]);
    if (row) return !row.paid_date;
    return false; // task no longer in the live table (archived/deleted) — archiveTask() already cancels its reminder, and either way there's nothing actionable left to remind about
  }
  if (sourceSystem === "AnnualReportFiling" || sourceSystem === "MdUiFiling") {
    const [clientId, periodEnd] = sourceRecordId.split(":");
    const table = sourceSystem === "AnnualReportFiling" ? "v3_annual_report_filings" : "v3_md_ui_filings";
    const row = await queryOne<any>(`SELECT paid_date FROM altax.${table} WHERE client_id = $1 AND period_end = $2`, [clientId, periodEnd]);
    return !row || !row.paid_date;
  }
  return false;
}

/** The hourly sweep. Same shape as runAppointmentConfirmationRequests (appointments.routes.ts:766). */
export async function runPaymentDueReminders(actorEmail: string): Promise<{ sent: number; canceled: number; failed: number }> {
  const now = Date.now();
  const windowStart = new Date(now - 60 * 60 * 1000);
  const windowEnd = new Date(now + 60 * 60 * 1000);
  let sent = 0, canceled = 0, failed = 0;

  const due = await query<any>(
    `SELECT * FROM altax.v3_payment_reminders WHERE status = 'Scheduled' AND remind_at BETWEEN $1 AND $2`,
    [windowStart.toISOString(), windowEnd.toISOString()]
  );

  for (const r of due) {
    const claimed = await query<any>(
      `UPDATE altax.v3_payment_reminders SET status = 'Sent', sent_at = now() WHERE reminder_id = $1 AND status = 'Scheduled' RETURNING *`,
      [r.reminder_id]
    );
    if (!claimed.length) continue;
    try {
      const stillUnpaid = await isStillUnpaid(r.source_system, r.source_record_id);
      if (!stillUnpaid) {
        await query(
          `UPDATE altax.v3_payment_reminders SET status = 'Canceled', canceled_at = now(), canceled_reason = 'Paid before reminder fired' WHERE reminder_id = $1`,
          [r.reminder_id]
        );
        canceled++;
        continue;
      }
      const client = await queryOne<any>(`SELECT client_id, client_name, email, email_allowed FROM altax.v3_clients WHERE client_id = $1`, [r.client_id]);
      if (!client) { canceled++; continue; }
      const { sent: wasSent } = await sendPaymentDueReminder({
        client: { clientId: client.client_id, clientName: client.client_name, email: client.email, emailAllowed: Boolean(client.email_allowed) },
        sourceRecordId: `PaymentDueReminder:${r.reminder_id}`,
        filingType: r.filing_type,
        periodLabel: r.period_label,
        amount: Number(r.amount),
        paymentDueDate: toDateOnlyStr(r.payment_due_date),
      });
      if (wasSent) sent++;
    } catch (err) {
      failed++;
      await recordNotificationFailure(`paymentDueReminder:${r.reminder_id}`, err);
      // Un-claim so a transient failure is retried next sweep — same pattern as runAppointmentConfirmationRequests.
      await query(`UPDATE altax.v3_payment_reminders SET status = 'Scheduled', sent_at = NULL WHERE reminder_id = $1`, [r.reminder_id]);
    }
  }

  if (failed > 0) {
    await alertAdmins(
      "Payment due reminders: some sends failed",
      `${failed} payment-due reminder(s) failed to send this run (${actorEmail}). Check the server logs for per-reminder errors (search "[notification] paymentDueReminder").`
    );
  }
  return { sent, canceled, failed };
}
