import crypto from "crypto";
import { query, queryOne, withTransaction } from "../config/db";
import { sendChannel } from "./sendChannel";
import { getFirmProfile } from "./firmProfile";
import { publicBaseUrl } from "./publicUrl";

/**
 * Two small notices around the client-entry approval flow:
 *  - notifyStaffOfClientEntry: an email to the firm's admins and the client's assigned staff member when a client logs a
 *    sale, expense or asset in the portal, so nothing waits unseen. Coalesced (at most one email per client per 10
 *    minutes — the email states how many entries are waiting) and fire-and-forget: a mail failure never blocks the client.
 *  - notifyClientOfDismissal: tells a client, with the reviewer's reason, that an entry could not be used.
 */

const COALESCE_MINUTES = 10;
const money = (v: number) => `$${(Math.round(v * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const comId = () => `COM-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;

export async function notifyStaffOfClientEntry(clientId: string, summary: string): Promise<void> {
  try {
    // Claim the 10-minute window up front (row inserted before any mail goes out), so two entries submitted
    // back to back can't both send — the second sees the first's claim and stays quiet.
    const claimId = comId();
    const claimed = await withTransaction(async (db) => {
      await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`cea-${clientId}`]);
      const recent = await db.queryOne<any>(
        `SELECT 1 FROM altax.v3_communications WHERE source_system = 'ClientEntryAlert' AND client_id = $1 AND sent_at > now() - ($2 || ' minutes')::interval LIMIT 1`, [clientId, String(COALESCE_MINUTES)]);
      if (recent) return false;
      await db.query(
        `INSERT INTO altax.v3_communications (communication_id, client_id, client_name, related_task_id, subject, message_english, message_arabic, sent_to, sent_by, direction, channel, sent_at, status, source_system, source_record_id)
         SELECT $1, c.client_id, c.client_name, NULL, 'Client entry alert', '', '', '', 'System (Client Entry Alert)', 'Outbound', 'Email', now(), 'Sending', 'ClientEntryAlert', $3
           FROM altax.v3_clients c WHERE c.client_id = $2`,
        [claimId, clientId, `CEA-${clientId}-${Date.now()}`]);
      return true;
    });
    if (!claimed) return;
    const c = await queryOne<any>(`SELECT client_id, client_name, assigned_to FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
    if (!c) return;
    const admins = await query<any>(`SELECT email FROM altax.v3_users WHERE active = true AND lower(role) = 'admin' AND email IS NOT NULL AND email <> ''`);
    const recipients = new Set<string>(admins.map((a: any) => String(a.email).toLowerCase()));
    if (c.assigned_to) {
      const norm = String(c.assigned_to).trim().toLowerCase();
      const staff = await queryOne<any>(`SELECT email FROM altax.v3_users WHERE active = true AND (lower(email) = $1 OR lower(name) = $1 OR lower(user_id) = $1) LIMIT 1`, [norm]);
      if (staff?.email) recipients.add(String(staff.email).toLowerCase());
    }
    if (!recipients.size) { await query(`UPDATE altax.v3_communications SET status = 'Skipped' WHERE communication_id = $1`, [claimId]); return; }

    const counts = await queryOne<any>(
      `SELECT (SELECT COUNT(*) FROM altax.v3_client_sales_drafts WHERE client_id = $1 AND status = 'Pending')::int AS s,
              (SELECT COUNT(*) FROM altax.v3_client_purchase_drafts WHERE client_id = $1 AND status = 'Pending')::int AS p`, [clientId]);
    let assets = 0;
    try { assets = Number((await queryOne<any>(`SELECT COUNT(*)::int AS n FROM altax.v3_client_asset_drafts WHERE client_id = $1 AND status = 'Pending'`, [clientId]))?.n || 0); } catch { /* not migrated */ }
    const total = (counts?.s || 0) + (counts?.p || 0) + assets;
    const base = publicBaseUrl();
    const subject = `Client entry waiting: ${c.client_name} — ${summary}`;
    const body = [
      `${c.client_name} just logged ${summary} in the client portal.`,
      `${total} entr${total === 1 ? "y" : "ies"} from this client ${total === 1 ? "is" : "are"} now waiting for approval (${counts?.s || 0} sales, ${counts?.p || 0} expenses${assets ? `, ${assets} assets` : ""}).`,
      base ? `Review and approve: ${base}/dashboard?tab=submissions` : "Open the Command Center → Client entries tab to review and approve.",
      "You'll get at most one of these emails per client every 10 minutes.",
    ].join("\n\n");
    const firmName = (await getFirmProfile()).firmName;
    const list = Array.from(recipients);
    let anySent = false;
    for (const to of list) {
      const r = await sendChannel("email", to, subject, body, { firmName });
      anySent = anySent || r.sent;
    }
    await query(`UPDATE altax.v3_communications SET subject = $2, message_english = $3, sent_to = $4, status = $5 WHERE communication_id = $1`, [claimId, subject, body, list.join(", "), anySent ? "Sent" : "Failed"]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[notifyStaffOfClientEntry] failed:", err);
  }
}

/** Emails the client (when allowed) that an entry couldn't be used, with the reviewer's reason. Never throws. */
export async function notifyClientOfDismissal(clientId: string, what: string, dateLabel: string, amount: number, reason: string | null): Promise<void> {
  try {
    const c = await queryOne<any>(`SELECT client_id, client_name, email, email_allowed FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
    if (!c || !c.email || c.email_allowed === false) return;
    const firmName = (await getFirmProfile()).firmName;
    const base = publicBaseUrl();
    const why = reason?.trim();
    const en = [
      `Hello,`,
      `We couldn't use one of the entries you logged for ${c.client_name}: ${what} for ${dateLabel} (${money(amount)}).`,
      why ? `Reason from your accountant: ${why}` : "Please check the entry and enter it again, or reply to this email and we'll help.",
      base ? `You can see it and re-enter it in My Books: ${base}/my-books` : "You can see it and re-enter it in My Books in your client portal.",
      `— ${firmName}`,
    ].join("\n\n");
    const ar = [
      `مرحباً،`,
      `لم نتمكن من استخدام أحد الإدخالات التي سجّلتها لـ ${c.client_name}: ${what} بتاريخ ${dateLabel} (${money(amount)}).`,
      why ? `سبب محاسبك: ${why}` : "يرجى مراجعة الإدخال وإعادة إدخاله، أو الرد على هذه الرسالة وسنساعدك.",
      base ? `يمكنك الاطّلاع عليه وإعادة إدخاله في دفاتري: ${base}/my-books` : "يمكنك الاطّلاع عليه وإعادة إدخاله في صفحة دفاتري في بوابة العميل.",
      `— ${firmName}`,
    ].join("\n\n");
    const subject = `An entry couldn't be used — ${c.client_name} · تعذّر استخدام أحد الإدخالات`;
    const body = `${en}\n\n---\n\n${ar}`;
    const r = await sendChannel("email", c.email, subject, body, { firmName });
    await query(
      `INSERT INTO altax.v3_communications (communication_id, client_id, client_name, related_task_id, subject, message_english, message_arabic, sent_to, sent_by, direction, channel, sent_at, status, source_system, source_record_id)
       VALUES ($1,$2,$3,NULL,$4,$5,'',$6,'System (Entry Dismissed)','Outbound','Email',now(),$7,'EntryDismissed',$8)`,
      [comId(), c.client_id, c.client_name, subject, body, c.email, r.sent ? "Sent" : "Failed", `ED-${c.client_id}-${Date.now()}`]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[notifyClientOfDismissal] failed:", err);
  }
}
