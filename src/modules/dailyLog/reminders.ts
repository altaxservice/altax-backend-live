import crypto from "crypto";
import { query, queryOne, withTransaction } from "../../config/db";
import { sendChannel } from "../../common/sendChannel";
import { getFirmProfile } from "../../common/firmProfile";
import { escapeHtml } from "../../common/html";
import { publicBaseUrl } from "../../common/publicUrl";
import { buildAutoDraft } from "./dailyLog.routes";

const fmtMins = (m: number) => { const h = Math.floor(m / 60), r = m % 60; return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`; };

/** Firm-wide master switch — OFF until an admin turns it on (Daily Log page → Team today). */
export async function isDailyLogReminderEnabled(): Promise<boolean> {
  try {
    const row = await queryOne<any>(`SELECT daily_log_reminder_enabled AS v FROM altax.v3_firm_settings WHERE id = 'FIRM-1'`);
    return row?.v === true;
  } catch { return false; }
}

export function composeReminder(name: string, drafts: { clientName: string; count: number; suggestedMinutes: number }[], link: string | null) {
  const mins = drafts.reduce((t, d) => t + d.suggestedMinutes, 0);
  const subject = `Your Daily Log: ${drafts.length} client${drafts.length === 1 ? "" : "s"} waiting to be saved`;
  const lines = drafts.slice(0, 12).map((d) => `  • ${d.clientName} — ${d.count} action${d.count === 1 ? "" : "s"}, about ${fmtMins(d.suggestedMinutes)}`);
  const body = [
    `Hi ${name.split(" ")[0] || "there"},`,
    "",
    `Today's work is drafted and ready, but not saved to your Daily Log yet (${drafts.length} client${drafts.length === 1 ? "" : "s"}, about ${fmtMins(mins)} in all):`,
    ...lines,
    drafts.length > 12 ? `  …and ${drafts.length - 12} more` : "",
    "",
    "It takes one click: open Daily Log, check the minutes, and press Save.",
    link ? link : "",
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
  return { subject, body };
}

/**
 * 5:30 PM ET weekdays: each staff member with recorded work that isn't saved to their Daily Log gets one email for the day.
 * Does nothing unless the master switch is on. Idempotent per person per day. People with nothing unsaved get nothing.
 */
export async function runDailyLogReminders(actorEmail: string): Promise<{ sent: number; skipped: number; errors: string[] }> {
  if (!(await isDailyLogReminderEnabled())) return { sent: 0, skipped: 0, errors: ["Master switch is off — no reminders were sent."] };
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const errors: string[] = [];
  const people = await query<any>(`SELECT email, name FROM altax.v3_users WHERE lower(role) = 'staff' AND COALESCE(active, true) = true AND email IS NOT NULL AND email <> ''`);
  const firmName = (await getFirmProfile()).firmName;
  const base = publicBaseUrl();
  let sent = 0, skipped = 0;
  for (const u of people) {
    const email = String(u.email).toLowerCase();
    try {
      const drafts = await buildAutoDraft(email, date);
      if (drafts.length === 0) { skipped++; continue; }
      const { subject, body } = composeReminder(u.name || email, drafts, base ? `${base}/daily-log` : null);
      const sourceRecordId = `DLREM-${email}-${date}`;
      let outcome: { sent: boolean; already?: boolean; err?: string } = { sent: false };
      await withTransaction(async (db) => {
        await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [sourceRecordId]);
        const existing = await db.queryOne<any>(`SELECT 1 FROM altax.v3_communications WHERE source_system = 'DailyLogReminder' AND source_record_id = $1 AND status = 'Sent'`, [sourceRecordId]);
        if (existing) { outcome = { sent: false, already: true }; return; }
        const result = await sendChannel("email", email, subject, escapeHtml(body).replace(/\n/g, "<br>"), { firmName });
        await db.query(
          `INSERT INTO altax.v3_communications
             (communication_id, client_id, client_name, related_task_id, subject, message_english, message_arabic,
              sent_to, sent_by, direction, channel, sent_at, status, source_system, source_record_id, provider_message_id)
           VALUES ($1,NULL,NULL,NULL,$2,$3,'',$4,$5,'Outbound','Email',now(),$6,'DailyLogReminder',$7,$8)`,
          [`COM-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`, subject, body, email, actorEmail, result.sent ? "Sent" : "Failed", sourceRecordId, result.providerMessageId || null]
        );
        outcome = { sent: result.sent, err: result.error };
      });
      if (outcome.sent) sent++; else { skipped++; if (!outcome.already) errors.push(`${email}: ${outcome.err || "send failed"}`); }
    } catch (err: any) {
      skipped++; errors.push(`${email}: ${err?.message || "Unexpected error."}`);
    }
  }
  return { sent, skipped, errors };
}
