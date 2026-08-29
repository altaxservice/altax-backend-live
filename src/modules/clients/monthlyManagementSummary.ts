import crypto from "crypto";
import { query, queryOne, withTransaction } from "../../config/db";
import { sendChannel } from "../../common/sendChannel";
import { getFirmProfile } from "../../common/firmProfile";
import { resolveAssigneeEmail } from "../reminders/reminders.routes";
import { escapeHtml } from "../../common/html";

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

async function alreadySent(sourceRecordId: string): Promise<boolean> {
  const row = await queryOne<any>(`SELECT 1 FROM altax.v3_communications WHERE source_system = 'MonthlyManagementSummary' AND source_record_id = $1`, [sourceRecordId]);
  return !!row;
}

const PRIORITY_ORDER: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

/** Buckets an open finding's target_date into an action-timeline label — mirrors the "Immediate/30/60/90-day" grouping the user asked for in the Advisor Recommendations spec. */
function actionBucket(targetDate: string | null, priority: string): "Immediate" | "30-Day" | "60-Day" | "90-Day" | "No Target Date" {
  if (!targetDate) return priority === "Urgent" ? "Immediate" : "No Target Date";
  const days = Math.round((new Date(`${targetDate}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  if (days <= 0) return "Immediate";
  if (days <= 30) return "30-Day";
  if (days <= 60) return "60-Day";
  return "90-Day";
}

/**
 * One monthly email per staff member (or per admin, for clients with no
 * assigned staff), covering every one of their clients that currently has
 * open SWOT findings — mirrors the existing "ONE digest per staff member,
 * not one email per item" convention runReminders() already established
 * for the daily staff task digest. Run once a month, right after the
 * monthly snapshot sweep (server.ts cron) so the figures it references are
 * fresh. Idempotent per recipient per month via the same alreadySent
 * pattern reminders.routes.ts uses, keyed to v3_communications.
 */
export async function runMonthlyManagementSummary(actorEmail: string): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const monthKey = new Date().toISOString().slice(0, 7);
  const errors: string[] = [];

  const clientsWithFindings = await query<any>(
    `SELECT DISTINCT c.client_id, c.client_name, c.assigned_to
       FROM altax.v3_clients c
       JOIN altax.v3_swot_findings f ON f.client_id = c.client_id AND f.status IN ('Open', 'In Progress')`
  );
  if (clientsWithFindings.length === 0) return { sent: 0, skipped: 0, errors };

  const admins = await query<any>(`SELECT email FROM altax.v3_users WHERE active = true AND lower(role) = 'admin' AND email IS NOT NULL AND email <> ''`);
  const adminEmails: string[] = admins.map((a: any) => a.email);

  // Group clients under each recipient email — a client with no resolvable
  // assignee goes to every admin (same "unassigned work is everyone's"
  // convention used elsewhere), not silently dropped.
  const byRecipient = new Map<string, { clientId: string; clientName: string }[]>();
  for (const c of clientsWithFindings) {
    const resolved = c.assigned_to ? await resolveAssigneeEmail(c.assigned_to) : null;
    const recipients = resolved ? [resolved] : adminEmails;
    for (const email of recipients) {
      if (!byRecipient.has(email)) byRecipient.set(email, []);
      byRecipient.get(email)!.push({ clientId: c.client_id, clientName: c.client_name });
    }
  }

  const firmName = (await getFirmProfile()).firmName;
  let sent = 0;
  let skipped = 0;

  // Per-recipient try/catch — previously a DB error mid-loop aborted every
  // remaining recipient with no record of who got skipped, matching SWOT
  // Sweep's per-client isolation pattern.
  for (const [email, clients] of byRecipient) {
    try {
      const sourceRecordId = `MGMTSUM-${email.toLowerCase()}-${monthKey}`;
      if (await alreadySent(sourceRecordId)) { skipped++; continue; }

      const sections: string[] = [];
      for (const c of clients) {
        const findings = await query<any>(
          `SELECT category, finding_text, priority, target_date FROM altax.v3_swot_findings
            WHERE client_id = $1 AND status IN ('Open', 'In Progress') ORDER BY finding_text`,
          [c.clientId]
        );
        if (findings.length === 0) continue;
        const sorted = [...findings].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));
        const topFindings = sorted.slice(0, 5);
        const topRisks = sorted.filter((f: any) => f.category === "Threat").slice(0, 5);
        const topOpportunities = sorted.filter((f: any) => f.category === "Opportunity").slice(0, 5);

        const buckets: Record<string, string[]> = { Immediate: [], "30-Day": [], "60-Day": [], "90-Day": [], "No Target Date": [] };
        for (const f of findings) {
          const b = actionBucket(f.target_date ? new Date(f.target_date).toISOString().slice(0, 10) : null, f.priority);
          buckets[b].push(f.finding_text);
        }

        const lines: string[] = [`=== ${c.clientName} ===`];
        lines.push(`Top findings: ${topFindings.map((f: any) => `[${f.priority}] ${f.finding_text}`).join(" | ") || "none"}`);
        if (topRisks.length) lines.push(`Top risks: ${topRisks.map((f: any) => f.finding_text).join(" | ")}`);
        if (topOpportunities.length) lines.push(`Top opportunities: ${topOpportunities.map((f: any) => f.finding_text).join(" | ")}`);
        for (const [label, items] of Object.entries(buckets)) {
          if (items.length) lines.push(`${label}: ${items.join(" | ")}`);
        }
        sections.push(lines.join("\n"));
      }
      if (sections.length === 0) { skipped++; continue; }

      const subject = `Monthly Client Advisory Summary — ${monthKey}`;
      // Kept plain here — this is also what gets stored in v3_communications
      // below. Escaped separately, right before the actual email send.
      const body = `Monthly summary of open SWOT/advisory findings across your assigned clients.\n\n${sections.join("\n\n")}\n\nFull detail on each client's SWOT Analysis tab.`;

      // Advisory lock + re-check inside one transaction — the plain alreadySent()
      // pre-check above has the same unlocked check-then-act race AUTO-001 had on
      // reminders.routes.ts's runReminders (two overlapping runs both pass the
      // pre-check before either writes its v3_communications row, both send).
      // Keyed by sourceRecordId so it only serializes the same recipient+month,
      // matching runRecurringBillingSweep/sendAndLog's proven pattern.
      let outcome: { sent: boolean; alreadySent?: boolean; sendError?: string } = { sent: false };
      await withTransaction(async (db) => {
        await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [sourceRecordId]);
        const existing = await db.queryOne<any>(
          `SELECT 1 FROM altax.v3_communications WHERE source_system = 'MonthlyManagementSummary' AND source_record_id = $1`,
          [sourceRecordId]
        );
        if (existing) { outcome = { sent: false, alreadySent: true }; return; }

        const result = await sendChannel("email", email, subject, escapeHtml(body), { firmName });
        await db.query(
          `INSERT INTO altax.v3_communications
             (communication_id, client_id, client_name, related_task_id, subject, message_english, message_arabic,
              sent_to, sent_by, direction, channel, sent_at, status, source_system, source_record_id, provider_message_id)
           VALUES ($1,NULL,NULL,NULL,$2,$3,'',$4,$5,'Outbound','Email',now(),$6,'MonthlyManagementSummary',$7,$8)`,
          [`COM-${idSuffix()}`, subject, body, email, actorEmail, result.sent ? "Sent" : "Failed", sourceRecordId, result.providerMessageId || null]
        );
        outcome = { sent: result.sent, sendError: result.error };
      });

      if (outcome.sent) sent++;
      else if (outcome.alreadySent) skipped++;
      else { skipped++; errors.push(`${email}: ${outcome.sendError || "send failed"}`); }
    } catch (err: any) {
      skipped++;
      errors.push(`${email}: ${err?.message || "Unexpected error sending this recipient's summary."}`);
      // eslint-disable-next-line no-console
      console.error(`[runMonthlyManagementSummary] failed for ${email}:`, err);
    }
  }

  return { sent, skipped, errors };
}
