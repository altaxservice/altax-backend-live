import crypto from "crypto";
import { query, withTransaction } from "../../config/db";
import { sendChannel } from "../../common/sendChannel";
import { getFirmProfile } from "../../common/firmProfile";
import { escapeHtml } from "../../common/html";

/** YYYY-MM-DD in local server time (the cron runs with America/New_York). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/**
 * Weekly Daily Log summary — one private email per author covering the previous Monday–Sunday: entries, time logged,
 * clients touched, the busiest days, and where the time went. Daily Log entries are private to their author
 * (see dailyLog.routes.ts), so each person only ever receives their own week. Authors with no entries are skipped —
 * logging is optional, so an empty week is silence, not a nag. Idempotent per author per week via the same
 * v3_communications + advisory-lock pattern as the monthly management summary.
 */
export async function runWeeklyDailyLogSummary(actorEmail: string): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Monday of the week that just ended (the cron fires Monday morning).
  const dow = (today.getDay() + 6) % 7; // Mon=0 … Sun=6
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - dow);
  const start = new Date(thisMonday);
  start.setDate(thisMonday.getDate() - 7);
  const end = new Date(thisMonday);
  end.setDate(thisMonday.getDate() - 1);
  const from = ymd(start);
  const to = ymd(end);
  const errors: string[] = [];

  const rows = await query<any>(
    `SELECT l.author_email, l.author_name, l.logged_at, l.category, l.body, l.time_spent_minutes, c.client_name
       FROM altax.v3_daily_logs l
       LEFT JOIN altax.v3_clients c ON c.client_id = l.client_id
      WHERE l.logged_at::date >= $1 AND l.logged_at::date <= $2 AND l.author_email IS NOT NULL AND l.author_email <> ''
      ORDER BY l.logged_at ASC`,
    [from, to]
  );
  if (rows.length === 0) return { sent: 0, skipped: 0, errors };

  const byAuthor = new Map<string, any[]>();
  for (const r of rows) {
    const key = String(r.author_email).toLowerCase();
    if (!byAuthor.has(key)) byAuthor.set(key, []);
    byAuthor.get(key)!.push(r);
  }

  const firmName = (await getFirmProfile()).firmName;
  let sent = 0;
  let skipped = 0;

  for (const [email, logs] of byAuthor) {
    try {
      const sourceRecordId = `DAILYLOGWEEK-${email}-${from}`;
      const minutes = logs.reduce((sum, l) => sum + Number(l.time_spent_minutes || 0), 0);
      const clients = new Set(logs.map((l) => l.client_name).filter(Boolean));
      const perDay = new Map<string, number>();
      const perCategory = new Map<string, number>();
      const perClient = new Map<string, number>();
      for (const l of logs) {
        const day = ymd(new Date(l.logged_at));
        perDay.set(day, (perDay.get(day) || 0) + 1);
        const cat = l.category || "General";
        perCategory.set(cat, (perCategory.get(cat) || 0) + 1);
        if (l.client_name) perClient.set(l.client_name, (perClient.get(l.client_name) || 0) + 1);
      }
      const top = (m: Map<string, number>, n: number) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} (${v})`).join(", ");
      const dayLines = Array.from(perDay.entries()).sort().map(([d, n]) => `  ${new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}: ${n} entr${n === 1 ? "y" : "ies"}`);

      const subject = `Your Daily Log — week of ${new Date(`${from}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
      const body = [
        `Here's your Daily Log for ${from} to ${to}.`,
        "",
        `Entries: ${logs.length}   ·   Time logged: ${minutes ? fmtHours(minutes) : "none recorded"}   ·   Clients touched: ${clients.size}`,
        "",
        "By day:",
        ...dayLines,
        "",
        perClient.size ? `Most logged clients: ${top(perClient, 5)}` : "",
        perCategory.size ? `Where the work went: ${top(perCategory, 5)}` : "",
        "",
        "Open Daily Log in the app to review, copy or export the full week.",
      ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");

      let outcome: { sent: boolean; alreadySent?: boolean; sendError?: string } = { sent: false };
      await withTransaction(async (db) => {
        await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [sourceRecordId]);
        const existing = await db.queryOne<any>(
          `SELECT 1 FROM altax.v3_communications WHERE source_system = 'DailyLogWeekly' AND source_record_id = $1`, [sourceRecordId]);
        if (existing) { outcome = { sent: false, alreadySent: true }; return; }
        const result = await sendChannel("email", email, subject, escapeHtml(body).replace(/\n/g, "<br>"), { firmName });
        await db.query(
          `INSERT INTO altax.v3_communications
             (communication_id, client_id, client_name, related_task_id, subject, message_english, message_arabic,
              sent_to, sent_by, direction, channel, sent_at, status, source_system, source_record_id, provider_message_id)
           VALUES ($1,NULL,NULL,NULL,$2,$3,'',$4,$5,'Outbound','Email',now(),$6,'DailyLogWeekly',$7,$8)`,
          [`COM-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`, subject, body, email, actorEmail, result.sent ? "Sent" : "Failed", sourceRecordId, result.providerMessageId || null]
        );
        outcome = { sent: result.sent, sendError: result.error };
      });

      if (outcome.sent) sent++;
      else if (outcome.alreadySent) skipped++;
      else { skipped++; errors.push(`${email}: ${outcome.sendError || "send failed"}`); }
    } catch (err: any) {
      skipped++;
      errors.push(`${email}: ${err?.message || "Unexpected error sending this weekly summary."}`);
      // eslint-disable-next-line no-console
      console.error(`[runWeeklyDailyLogSummary] failed for ${email}:`, err);
    }
  }
  return { sent, skipped, errors };
}
