/**
 * "You haven't logged sales in a while" client portal nudge — a parallel
 * sibling to complianceReminders.ts, not an extension of it: that module is
 * deadline-based (a real due date on the calendar), this one is activity-gap
 * based (no due date, just "it's been N days since your last entry"). Same
 * delivery/dedup machinery reused directly: sendChannel for branded email/SMS,
 * pg_advisory_xact_lock + a v3_communications row for dedup, logAudit for the
 * sweep summary — see complianceReminders.ts's runComplianceDeadlineReminders
 * for the pattern this mirrors line for line.
 */
import { query, withTransaction } from "../config/db";
import { sendChannel } from "./sendChannel";
import { getFirmProfile } from "./firmProfile";
import { logAudit } from "./audit";
import { escapeHtml } from "./html";

/** Business days (Mon-Fri) since a client last logged a sale, before the nudge fires. */
const GAP_THRESHOLD_DAYS = 5;

function stableKey(clientId: string, lastDate: string): string {
  return `${clientId}:sales-logging-nudge:${lastDate}`;
}

function buildMessage(clientName: string, lastDateUs: string, firmName: string): { subject: string; body: string; smsBody: string } {
  const safeClientName = escapeHtml(clientName);
  const subject = "Reminder: log your recent sales in your AL TAX Nexus portal";
  const en = `Dear ${safeClientName},\n\nWe noticed you haven't logged any daily sales in your My Books portal since ${lastDateUs}. Keeping your entries current helps us keep your books accurate and your tax filings on time.\n\nLog in anytime to add your recent sales and purchases.\n\nThank you,\n${firmName}`;
  const ar = `عزيزنا ${safeClientName}،\n\nلاحظنا أنك لم تسجل أي مبيعات يومية في بوابة سجلاتي المالية منذ ${lastDateUs}. تحديث إدخالاتك بانتظام يساعدنا في الحفاظ على دقة سجلاتك وتقديم إقراراتك الضريبية في وقتها.\n\nيمكنك تسجيل الدخول في أي وقت لإضافة مبيعاتك ومشترياتك الأخيرة.\n\nشكراً لكم،\n${firmName}`;
  const body = `${en}\n\n---\n\n${ar}`;
  const smsBody = `Reminder: log your recent sales in your AL TAX Nexus portal — nothing logged since ${lastDateUs}.`;
  return { subject, body, smsBody };
}

/**
 * Daily sweep — for every active client with a My Books login and the nudge
 * enabled, finds the most recent sale date across both the client's own
 * pending drafts and already-approved v3_sales_input rows. A client who has
 * never logged anything at all (null max date) is skipped entirely — a
 * brand-new client isn't "overdue," they just haven't started. Only a real
 * gap after at least one prior entry counts.
 */
export async function runSalesLoggingNudges(actorEmail: string, opts: { clientId?: string } = {}): Promise<{ sent: number; skipped: number }> {
  const firmName = (await getFirmProfile()).firmName;
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const clientFilter = String(opts.clientId || "").trim();

  const clients = await query<any>(
    `SELECT c.client_id, c.client_name, c.email, c.phone, c.email_allowed, c.sms_allowed,
            GREATEST(
              COALESCE((SELECT MAX(sale_date) FROM altax.v3_client_sales_drafts WHERE client_id = c.client_id AND status != 'Dismissed'), '1900-01-01'::date),
              COALESCE((SELECT MAX(sale_date) FROM altax.v3_sales_input WHERE client_id = c.client_id), '1900-01-01'::date)
            ) AS last_sale_date
       FROM altax.v3_clients c
      WHERE c.sales_logging_nudges_enabled = true
            AND c.portal_enabled = true
            AND (c.status IS NULL OR lower(c.status) NOT IN ('no', 'false', 'inactive', 'archived'))
            AND ($1 = '' OR c.client_id = $1)
            AND EXISTS (SELECT 1 FROM altax.v3_users u WHERE u.role = 'client' AND (u.assigned_client_id = c.client_id OR EXISTS (
              SELECT 1 FROM altax.v3_user_clients uc WHERE uc.user_id = u.user_id AND uc.client_id = c.client_id
            )))`,
    [clientFilter]
  );

  let sent = 0;
  let skipped = 0;
  for (const c of clients) {
    try {
      const lastDateStr = c.last_sale_date ? new Date(c.last_sale_date).toISOString().slice(0, 10) : null;
      if (!lastDateStr || lastDateStr === "1900-01-01") { skipped++; continue; } // never logged anything -- not overdue, just new
      const gapDays = Math.round((today.getTime() - new Date(`${lastDateStr}T00:00:00Z`).getTime()) / 86400000);
      if (gapDays < GAP_THRESHOLD_DAYS) continue;

      const canEmail = Boolean(c.email_allowed && c.email);
      const canSms = Boolean(c.sms_allowed && c.phone);
      if (!canEmail && !canSms) { skipped++; continue; }

      const dedupKey = stableKey(c.client_id, lastDateStr);
      const lastDateUs = new Date(`${lastDateStr}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      const { subject, body, smsBody } = buildMessage(c.client_name, lastDateUs, firmName);

      const result = await withTransaction(async (db) => {
        await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [dedupKey]);
        const existing = await db.queryOne<any>(
          `SELECT 1 FROM altax.v3_communications WHERE source_system = 'SalesLoggingNudge' AND source_record_id = $1`,
          [dedupKey]
        );
        if (existing) return { alreadySent: true, anySent: false };

        let anySent = false;
        let providerMessageId: string | null = null;
        if (canEmail) {
          const emailResult = await sendChannel("email", c.email, subject, body, { firmName });
          if (emailResult.sent) { anySent = true; providerMessageId = emailResult.providerMessageId || null; }
        }
        if (canSms) {
          const smsResult = await sendChannel("sms", c.phone, subject, smsBody, { firmName });
          if (smsResult.sent) { anySent = true; providerMessageId = providerMessageId || smsResult.providerMessageId || null; }
        }

        await db.query(
          `INSERT INTO altax.v3_communications
             (communication_id, client_id, client_name, related_task_id, subject, message_english, message_arabic,
              sent_to, sent_by, direction, channel, sent_at, status, source_system, source_record_id, provider_message_id)
           VALUES ($1,$2,$3,NULL,$4,$5,'',$6,$7,'Outbound','Email',now(),$8,'SalesLoggingNudge',$9,$10)`,
          [
            `COM-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`, c.client_id, c.client_name, subject, body,
            [canEmail ? c.email : null, canSms ? c.phone : null].filter(Boolean).join(", "),
            actorEmail, anySent ? "Sent" : "Failed", dedupKey, providerMessageId,
          ]
        );
        return { alreadySent: false, anySent };
      });
      if (result.alreadySent) continue;
      if (result.anySent) sent++; else skipped++;
    } catch {
      skipped++;
    }
  }

  if (sent > 0 || skipped > 0) {
    await logAudit("Clients", "SALES_LOGGING_NUDGE_SWEEP", "Firm", "", "", "", `Sales logging nudge sweep: ${sent} sent, ${skipped} skipped, by ${actorEmail}.`, actorEmail);
  }
  return { sent, skipped };
}
