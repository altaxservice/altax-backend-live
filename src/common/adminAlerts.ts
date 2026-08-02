import { query } from "../config/db";
import { sendEmail } from "./notifications";
import { getFirmProfile } from "./firmProfile";
import { escapeHtml } from "./html";

/** Same admin-lookup shape as autoBackup.ts's backupRecipients — kept as its own small
 * copy rather than a shared import since the two modules have no other coupling and
 * this alerting path deliberately must not depend on anything that could itself be
 * the thing that's broken. */
async function activeAdminEmails(): Promise<string[]> {
  const admins = await query<any>(
    `SELECT email FROM altax.v3_users WHERE lower(role) = 'admin' AND coalesce(active, true) AND email IS NOT NULL`
  );
  const emails = admins.map((a) => String(a.email)).filter(Boolean);
  if (emails.length > 0) return emails;
  const firm = await getFirmProfile().catch(() => null);
  return firm?.email ? [String(firm.email)] : [];
}

/**
 * Best-effort admin alert for something that needs a human's attention soon — a cron
 * job failing, or the process itself crashing. Previously there was no alerting
 * anywhere in the app beyond console.error, which only reaches whoever happens to be
 * looking at Railway's logs at that moment.
 *
 * Never throws: a failure to SEND the alert (email not configured, Resend down, DB
 * unreachable while fetching admin emails) must not compound whatever already went
 * wrong, and must not itself become an unhandled rejection. console.error always
 * fires first regardless of whether the email step succeeds, so Railway's own logs
 * remain the fallback of last resort.
 */
export async function alertAdmins(subject: string, detail: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.error(`[alert] ${subject}: ${detail}`);
  try {
    const recipients = await activeAdminEmails();
    if (recipients.length === 0) return;
    const html = `<p><strong>${escapeHtml(subject)}</strong></p><pre style="white-space:pre-wrap;font-family:monospace;font-size:13px;">${escapeHtml(detail)}</pre>`;
    for (const to of recipients) {
      await sendEmail({ to, subject: `AL TAX Nexus alert: ${subject}`, html }).catch(() => {});
    }
  } catch {
    // Already logged above — swallow so a failure to alert never compounds the original problem.
  }
}
