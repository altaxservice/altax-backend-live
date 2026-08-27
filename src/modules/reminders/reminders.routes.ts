import { Router, Request, Response } from "express";
import crypto from "crypto";
import { query, queryOne, withTransaction } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { normalizeText } from "../../common/assignment";
import { sendEmail, NotConfiguredError } from "../../common/notifications";
import { resolveTemplate } from "../templates/templates.routes";
import { wrapEmailHtml } from "../../common/emailTemplate";
import { escapeHtml } from "../../common/html";

/**
 * Automated reminders — the piece communications.routes.ts's module doc comment
 * flagged as "NOT ported... needs real background-job infrastructure this backend
 * doesn't have yet." Rather than an in-process scheduler (a bigger, riskier change —
 * this backend runs under both ts-node-dev in dev and a plain `node dist/server.js`
 * in prod, neither of which currently owns a persistent timer), this follows the
 * exact convention already established by recurring billing (billing.routes.ts
 * POST /billing/recurring/run): a manually-triggered, idempotent "run" endpoint an
 * admin/staff clicks (or an external cron hits) whenever they want reminders sent.
 * Same never-blocks-on-send-failure pattern as every other send path in this app.
 *
 * Three reminder types, each using the matching BUILT_IN template (see
 * templates.routes.ts) so subject/body — English and Arabic — come from the same
 * editable template system as manual Communications, not hardcoded strings:
 *   - Staff: ONE digest per staff member per day (not one email per task — see
 *     "one report a day for all the updates and status" in the user's request),
 *     covering every open task past/near its due date assigned to them. Each
 *     task's own "Staff Task Reminder" body is resolved individually (so
 *     {{clientName}} etc. reflect that task's own client) then joined into a
 *     single message. Assignee resolved against v3_users by email/name/user_id —
 *     matches assignment.ts's isAssignedToUser convention.
 *   - Clients (documents): one per client with open (status='Requested') document
 *     requests, listing all of them together rather than one email per document.
 *   - Clients (payments): one per client with a positive unpaid invoice balance,
 *     using the "Payment Reminder" template.
 * Idempotent via source_system='Reminders' + a deterministic source_record_id
 * (assignee/client id + today's date) — running twice in one day is a no-op the
 * second time, so this is safe to wire to a "Run Reminders" button a staff member
 * might click more than once.
 */
export const remindersRouter = Router();

const CLOSED_TASK_STATUSES = ["completed", "closed", "archived", "void"];

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

function fmtDate(v: unknown): string {
  if (!v) return "Not set";
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? "Not set" : d.toLocaleDateString(undefined, { timeZone: "UTC" });
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function alreadySent(sourceRecordId: string): Promise<boolean> {
  const row = await queryOne<any>(
    `SELECT 1 FROM altax.v3_communications WHERE source_system = 'Reminders' AND source_record_id = $1`,
    [sourceRecordId]
  );
  return !!row;
}

// PERF-015 (Hard Audit, 2026-08-13) — the staff-digest sweep below calls this
// once per due task, and most tasks in any given run share one of a handful
// of staff assignees, so the same lookup repeats heavily. Short TTL cache
// keyed by the normalized assigned_to string, same tradeoff as this file's
// other caches — a role/active-flag change takes up to 30s to be picked up.
const assigneeEmailCache = new Map<string, { email: string | null; at: number }>();
const ASSIGNEE_EMAIL_CACHE_TTL_MS = 30_000;

/** Resolves a task's free-text assigned_to (email, name, or user_id) to a real, active user's email — mirrors assignment.ts's alias matching. */
export async function resolveAssigneeEmail(assignedTo: string): Promise<string | null> {
  const norm = normalizeText(assignedTo);
  if (!norm) return null;
  const cached = assigneeEmailCache.get(norm);
  if (cached && Date.now() - cached.at < ASSIGNEE_EMAIL_CACHE_TTL_MS) return cached.email;
  const row = await queryOne<any>(
    `SELECT email FROM altax.v3_users WHERE active = true AND (lower(email) = $1 OR lower(name) = $1 OR lower(user_id) = $1) LIMIT 1`,
    [norm]
  );
  const email = row?.email || null;
  assigneeEmailCache.set(norm, { email, at: Date.now() });
  return email;
}

/**
 * Attempts a real email send, then always writes the communication log row
 * regardless of send success — same pattern as sendChannel() in
 * communications.routes.ts.
 *
 * The advisory lock + re-check inside one transaction is the real fix for a
 * production bug this exact function had: two overlapping runs of
 * runReminders (a manual "Run Reminders" click landing during the daily 6:30AM
 * cron, or any other overlap) could both pass the loop's own alreadySent()
 * pre-check before either had written its v3_communications row, so both sent
 * the same digest — confirmed by real duplicate rows already in production
 * (e.g. 4 identical STAFFREM sends to the same person on the same day).
 * pg_advisory_xact_lock, keyed by sourceRecordId, serializes any two callers
 * targeting the same recipient+day: the second blocks until the first's
 * transaction commits, then its own re-check inside the lock correctly sees
 * "already sent" and skips — the same lock-then-recheck shape already proven
 * in billing.routes.ts's runRecurringBillingSweep.
 */
async function sendAndLog(opts: {
  clientId: string | null; clientName: string | null; relatedTaskId: string | null;
  subject: string; bodyEnglish: string; bodyArabic: string; sentTo: string; sourceRecordId: string; actorEmail: string;
  /** Overrides the plain-paragraph HTML normally built from bodyEnglish/bodyArabic — for a digest that needs real structure (headings, grouped lists) rather than one prose block. bodyEnglish is still what's stored in v3_communications for the Activity Timeline/search. */
  bodyHtml?: string;
}, req?: Request): Promise<{ sent: boolean; sendError?: string; alreadySent?: boolean }> {
  return withTransaction(async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [opts.sourceRecordId]);
    const existing = await db.queryOne<any>(
      `SELECT 1 FROM altax.v3_communications WHERE source_system = 'Reminders' AND source_record_id = $1`,
      [opts.sourceRecordId]
    );
    if (existing) return { sent: false, alreadySent: true };

    let sent = false;
    let sendError: string | undefined;
    let providerMessageId: string | null = null;
    try {
      // bodyArabic was already being accepted, logged to v3_communications,
      // and shown on the Activity Timeline — but silently never rendered
      // into the actual email that goes out, so every digest sent through
      // here (document requests, staff task digest) was English-only
      // regardless of what its caller built. Mirrors the plain-paragraph
      // bilingual shape used elsewhere (appointment emails), not the
      // row-table shape (billing receipts) since this is prose, not data.
      const bodyHtml = opts.bodyHtml
        ? opts.bodyHtml
        : opts.bodyArabic
        ? `<p style="margin:0 0 16px;">${escapeHtml(opts.bodyEnglish).replace(/\n/g, "<br>")}</p><p dir="rtl" style="margin:0; text-align:right;">${escapeHtml(opts.bodyArabic).replace(/\n/g, "<br>")}</p>`
        : `<p style="margin:0;">${escapeHtml(opts.bodyEnglish).replace(/\n/g, "<br>")}</p>`;
      const result = await sendEmail({ to: opts.sentTo, subject: opts.subject, html: await wrapEmailHtml(bodyHtml, req) });
      providerMessageId = result.providerMessageId;
      sent = true;
    } catch (err: any) {
      sendError = err instanceof NotConfiguredError ? err.message : (err?.message || "Send failed.");
    }
    const status = sent ? "Saved + Sent" : sendError ? `Saved — ${sendError}` : "Saved";
    await db.query(
      `INSERT INTO altax.v3_communications
         (communication_id, client_id, client_name, related_task_id, direction, channel, subject,
          message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id, provider_message_id)
       VALUES ($1,$2,$3,$4,'Outbound','Email',$5,$6,$7,$8,$9,now(),$10,'Reminders',$11,$12)`,
      [`COM-${idSuffix()}`, opts.clientId, opts.clientName, opts.relatedTaskId, opts.subject, opts.bodyEnglish, opts.bodyArabic,
        opts.sentTo, opts.actorEmail, status, opts.sourceRecordId, providerMessageId]
    );
    return { sent, sendError };
  });
}

function daysOverdue(due: string, nowTime: number): number {
  return Math.max(0, Math.round((nowTime - new Date(due).getTime()) / 86400000));
}

/**
 * Groups the flat overdue-task list by task name — direct owner request,
 * 2026-08-26/27, after a real digest showed 40 overdue tasks as one long
 * flat bullet list, most of them the same task name repeated ("Sales Tax
 * Filing" for 17 different clients) with no way to see that at a glance.
 * Grouped, sorted worst-first (both which group has the oldest overdue item,
 * and which client within a group is furthest overdue) so the real pattern —
 * "17 clients all missed the same July 15 Sales Tax deadline" — reads as one
 * finding instead of 17 identical-looking lines buried in the middle of 40.
 */
function groupOverdueTasks(tasks: any[], nowTime: number): { name: string; items: { task: any; days: number }[]; maxDays: number }[] {
  const groups = new Map<string, any[]>();
  for (const t of tasks) {
    const name = (t.task_name || "Task").trim();
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(t);
  }
  return Array.from(groups.entries())
    .map(([name, items]) => {
      const withDays = items
        .map((task) => ({ task, days: daysOverdue(task.staff_due_date || task.agency_due_date, nowTime) }))
        .sort((a, b) => b.days - a.days);
      return { name, items: withDays, maxDays: withDays[0]?.days || 0 };
    })
    .sort((a, b) => b.maxDays - a.maxDays);
}

/**
 * The firm digest's actual HTML — previously it had none of its own; it went
 * through sendAndLog's generic "one prose paragraph" wrapper same as every
 * other reminder type, which is fine for a few sentences but unreadable once
 * OVERDUE alone can run 40 lines. Real structure (headings, a callout for
 * books health, a status table, grouped overdue) instead of one wall of
 * plain text with line breaks.
 */
function buildFirmDigestHtml(opts: {
  asOf: Date; openTaskCount: number; unbalancedClients: any[]; upcomingAppointments: any[];
  statusCounts: Map<string, number>; overdueTasks: any[]; dueSoonTasks: any[]; daysAhead: number; nowTime: number;
}): string {
  const { asOf, openTaskCount, unbalancedClients, upcomingAppointments, statusCounts, overdueTasks, dueSoonTasks, daysAhead, nowTime } = opts;
  const esc = escapeHtml;
  const sectionTitle = (label: string) => `<h3 style="margin:26px 0 10px; font-size:13px; letter-spacing:0.04em; text-transform:uppercase; color:#5b6b63;">${esc(label)}</h3>`;

  const booksHealthHtml = unbalancedClients.length
    ? `<div style="margin:0 0 8px; padding:14px 18px; background:#fdf1f1; border-left:4px solid #a83a3a; border-radius:4px;">
         <strong>${unbalancedClients.length} client${unbalancedClients.length === 1 ? "" : "s"} out of balance</strong> — open Reports &rarr; Trial Balance for each to find and correct the entries.
         <ul style="margin:8px 0 0; padding-left:18px; font-size:13px;">
           ${unbalancedClients.map((c: any) => `<li>${esc(c.client_name || c.client_id)} — off by $${Math.abs(Number(c.difference)).toFixed(2)} (debits $${c.debits} vs credits $${c.credits})</li>`).join("")}
         </ul>
       </div>`
    : `<div style="margin:0 0 8px; padding:12px 18px; background:#eef2ef; border-left:4px solid #4a7a5f; border-radius:4px;">All clients' ledgers are in balance. No action needed.</div>`;

  const fmtApptLineHtml = (a: any) => {
    const when = new Date(a.start_time).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const who = a.linked_client_name || a.contact_name || "—";
    return `<li>${esc(when)} ET — <strong>${esc(a.title || "Appointment")}</strong> with ${esc(who)}${a.assigned_to ? ` (${esc(a.assigned_to)})` : ""}</li>`;
  };
  const appointmentsHtml = upcomingAppointments.length
    ? `<ul style="margin:0; padding-left:18px; font-size:13px;">${upcomingAppointments.map(fmtApptLineHtml).join("")}</ul>`
    : `<p style="margin:0; font-size:13px; color:#5b5b57;">None scheduled.</p>`;

  const statusRows = Array.from(statusCounts.entries())
    .map(([status, count]) => `<tr><td style="padding:3px 14px 3px 0; color:#444;">${esc(status)}</td><td style="padding:3px 0; text-align:right; font-weight:600;">${count}</td></tr>`)
    .join("");
  const statusTableHtml = statusRows
    ? `<table style="border-collapse:collapse; font-size:13px;">${statusRows}</table>`
    : `<p style="margin:0; font-size:13px; color:#5b5b57;">No open tasks.</p>`;

  function overdueGroupsHtml(tasks: any[], emptyLabel: string): string {
    if (tasks.length === 0) return `<p style="margin:0; font-size:13px; color:#5b5b57;">${esc(emptyLabel)}</p>`;
    const groups = groupOverdueTasks(tasks, nowTime);
    return groups.map((g) => {
      const clientLines = g.items.map(({ task, days }) =>
        `<li>${esc(task.client_name || task.client_id || "Unassigned")}${days > 0 ? ` — <span style="color:#a83a3a;">${days} day${days === 1 ? "" : "s"} overdue</span>` : ` — due ${esc(fmtDate(task.staff_due_date || task.agency_due_date))}`}</li>`
      ).join("");
      return `<div style="margin:0 0 14px;">
        <div style="font-weight:700; font-size:13.5px;">${esc(g.name)} <span style="font-weight:400; color:#5b6b63;">— ${g.items.length} client${g.items.length === 1 ? "" : "s"}${g.maxDays > 0 ? `, up to ${g.maxDays} day${g.maxDays === 1 ? "" : "s"} overdue` : ""}</span></div>
        <ul style="margin:4px 0 0; padding-left:18px; font-size:13px; color:#333;">${clientLines}</ul>
      </div>`;
    }).join("");
  }

  return `
    <p style="margin:0 0 4px; font-size:15px;"><strong>Firm-wide status as of ${esc(fmtDate(asOf))}: ${openTaskCount} open task${openTaskCount === 1 ? "" : "s"}.</strong></p>

    ${sectionTitle("Books Health")}
    ${booksHealthHtml}

    ${sectionTitle(`Upcoming Appointments — next 48 hours (${upcomingAppointments.length})`)}
    ${appointmentsHtml}

    ${sectionTitle("Tasks by Status")}
    ${statusTableHtml}

    ${sectionTitle(`Overdue (${overdueTasks.length})`)}
    ${overdueGroupsHtml(overdueTasks, "None.")}

    ${sectionTitle(`Due Within ${daysAhead} Day${daysAhead === 1 ? "" : "s"} (${dueSoonTasks.length})`)}
    ${overdueGroupsHtml(dueSoonTasks, "None.")}
  `;
}

/**
 * Sends every due staff reminder + client document-request digest + the firm-wide
 * digest, and always the two client-facing categories. Extracted from the route
 * handler so both POST /reminders/run (a staff member clicking the button) and the
 * daily cron job (server.ts, 6:30AM America/New_York) call the exact same logic —
 * one consolidated email per recipient per day, never one per task or per status
 * change. daysAhead (default 3) controls how far ahead of a task's due date to
 * start reminding — 0 means "today and overdue only."
 */
export async function runReminders(actorEmail: string, daysAhead = 3, req?: Request) {
  daysAhead = Math.min(30, Math.max(0, daysAhead));
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + daysAhead);
  const today = todayKey();

  let staffSent = 0, staffSkipped = 0, staffFailed = 0;
  let clientSent = 0, clientSkipped = 0, clientFailed = 0;
  let paymentSent = 0, paymentSkipped = 0, paymentFailed = 0;

  // --- Staff: ONE digest per staff member per day, covering every open, assigned task
  // due within the horizon (or overdue) — not one email per task. The user explicitly
  // asked for "one report a day for all the updates and status" rather than a flood of
  // per-task messages, so tasks are grouped by resolved assignee first, and each
  // task's "Staff Task Reminder" body (English + Arabic) is resolved individually
  // (so {{clientName}} etc. still reflect that specific task's own client) and then
  // joined into a single message per person.
  const dueTasks = await query<any>(
    `SELECT * FROM altax.v3_tasks
      WHERE assigned_to IS NOT NULL AND assigned_to <> ''
        AND lower(status) <> ALL($1::text[])
        AND COALESCE(staff_due_date, agency_due_date) IS NOT NULL
        AND COALESCE(staff_due_date, agency_due_date) <= $2
      ORDER BY COALESCE(staff_due_date, agency_due_date) ASC`,
    [CLOSED_TASK_STATUSES, horizon.toISOString()]
  );

  const byAssignee = new Map<string, { english: string[]; arabic: string[] }>();
  for (const t of dueTasks) {
    const email = await resolveAssigneeEmail(t.assigned_to);
    if (!email) continue;
    const dueDate = t.staff_due_date || t.agency_due_date;
    const resolved = await resolveTemplate("Staff Task Reminder", t.client_id || "", "", "", {
      taskName: t.task_name || "", taskStatus: t.status || "", dueDate: fmtDate(dueDate),
    });
    if (!resolved) continue;
    if (!byAssignee.has(email)) byAssignee.set(email, { english: [], arabic: [] });
    byAssignee.get(email)!.english.push(resolved.message_english);
    byAssignee.get(email)!.arabic.push(resolved.message_arabic);
  }

  // Per-recipient try/catch — previously a DB error mid-loop (e.g. one bad row,
  // a dropped connection) aborted every remaining recipient in this loop with no
  // record of who got skipped, matching SWOT Sweep's per-client isolation pattern.
  for (const [email, items] of byAssignee) {
    try {
      const sourceRecordId = `STAFFREM-${normalizeText(email)}-${today}`;
      if (await alreadySent(sourceRecordId)) { staffSkipped++; continue; }

      const count = items.english.length;
      const subject = `Your task digest — ${count} item${count === 1 ? "" : "s"} due or overdue`;
      const bodyEnglish = `Here is your task summary for ${fmtDate(new Date())}. You have ${count} task${count === 1 ? "" : "s"} due or overdue:\n\n${items.english.join("\n\n")}`;
      const bodyArabic = `فيما يلي ملخص مهامكم ليوم ${fmtDate(new Date())}. لديكم ${count} مهمة مستحقة أو متأخرة:\n\n${items.arabic.join("\n\n")}`;

      const result = await sendAndLog({
        clientId: null, clientName: null, relatedTaskId: null,
        subject, bodyEnglish, bodyArabic, sentTo: email, sourceRecordId, actorEmail,
      }, req);
      if (result.sent) staffSent++; else if (result.alreadySent) staffSkipped++; else staffFailed++;
    } catch (err) {
      staffFailed++;
      // eslint-disable-next-line no-console
      console.error(`[runReminders] staff digest failed for ${email}:`, err);
    }
  }

  // --- Clients: one digest per client covering every open (Requested) document request ---
  const openRequests = await query<any>(
    `SELECT * FROM altax.v3_document_requests WHERE status = 'Requested' ORDER BY client_id, request_date`
  );
  const byClient = new Map<string, any[]>();
  for (const r of openRequests) {
    if (!r.client_id) continue;
    if (!byClient.has(r.client_id)) byClient.set(r.client_id, []);
    byClient.get(r.client_id)!.push(r);
  }

  for (const [clientId, requests] of byClient) {
    try {
      const sourceRecordId = `CLIENTREM-${clientId}-${today}`;
      if (await alreadySent(sourceRecordId)) { clientSkipped++; continue; }

      const client = await queryOne<any>(`SELECT client_id, client_name, email FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
      if (!client?.email) { clientSkipped++; continue; }

      const itemsList = requests.map((r) => `- ${r.requested_item || "Document"} (requested ${fmtDate(r.request_date)})`).join("\n");
      const resolved = await resolveTemplate("Document Request", clientId, "", "", { itemsList });
      if (!resolved) { clientSkipped++; continue; }

      const result = await sendAndLog({
        clientId, clientName: client.client_name || null, relatedTaskId: null,
        subject: resolved.subject, bodyEnglish: resolved.message_english, bodyArabic: resolved.message_arabic,
        sentTo: client.email, sourceRecordId, actorEmail,
      }, req);
      if (result.sent) clientSent++; else if (result.alreadySent) clientSkipped++; else clientFailed++;
    } catch (err) {
      clientFailed++;
      // eslint-disable-next-line no-console
      console.error(`[runReminders] client document-request digest failed for ${clientId}:`, err);
    }
  }

  // --- Clients: ONE payment reminder per invoice, ever, fired once that invoice
  // is more than 3 days past its own due date. Previously this summed EVERY
  // unpaid invoice into one client-level balance and re-fired daily (dedup key
  // included today's date) — annoying, and gave staff no way to send one on
  // demand. Per-invoice + a date-free dedup key (PAYREM-{invoiceId}) makes
  // alreadySent()/sendAndLog()'s existing "fires once per key, forever"
  // mechanics do the one-time work with no other changes needed. A separate
  // manual "Send Reminder" action exists on the invoice itself (billing.routes.ts
  // POST /invoices/:invoiceId/send-reminder) using its own PAYREM-MANUAL-* key,
  // so staff can always send one regardless of whether this auto reminder has
  // already fired for that invoice.
  const overdueInvoices = await query<any>(
    `SELECT i.invoice_id, i.client_id, i.balance_due, c.client_name, c.email
       FROM altax.v3_invoices i
       JOIN altax.v3_clients c ON c.client_id = i.client_id
      WHERE lower(i.status) NOT IN ('paid', 'void') AND i.balance_due > 0
        AND i.due_date IS NOT NULL AND i.due_date <= now() - interval '3 days'`
  );

  for (const invoice of overdueInvoices) {
    try {
      const sourceRecordId = `PAYREM-${invoice.invoice_id}`;
      if (await alreadySent(sourceRecordId)) { paymentSkipped++; continue; }
      if (!invoice.email) { paymentSkipped++; continue; }

      const resolved = await resolveTemplate("Payment Reminder", invoice.client_id, "", "", {
        balanceDue: `$${Number(invoice.balance_due).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      });
      if (!resolved) { paymentSkipped++; continue; }

      const result = await sendAndLog({
        clientId: invoice.client_id, clientName: invoice.client_name || null, relatedTaskId: null,
        subject: resolved.subject, bodyEnglish: resolved.message_english, bodyArabic: resolved.message_arabic,
        sentTo: invoice.email, sourceRecordId, actorEmail,
      }, req);
      if (result.sent) paymentSent++; else if (result.alreadySent) paymentSkipped++; else paymentFailed++;
    } catch (err) {
      paymentFailed++;
      // eslint-disable-next-line no-console
      console.error(`[runReminders] payment reminder failed for invoice ${invoice.invoice_id}:`, err);
    }
  }

  // --- Firm: ONE daily digest per active admin, summarizing every open task's status
  // firm-wide (counts by status + overdue list + due-soon list) — never one email per
  // task or per status change, same "one report a day" rule as the staff digest.
  let firmSent = 0, firmSkipped = 0, firmFailed = 0;
  const openTasks = await query<any>(
    `SELECT * FROM altax.v3_tasks WHERE lower(status) <> ALL($1::text[]) ORDER BY COALESCE(staff_due_date, agency_due_date) ASC NULLS LAST`,
    [CLOSED_TASK_STATUSES]
  );
  const statusCounts = new Map<string, number>();
  const overdueTasks: any[] = [];
  const dueSoonTasks: any[] = [];
  const nowTime = Date.now();
  for (const t of openTasks) {
    const statusLabel = t.status || "Not Started";
    statusCounts.set(statusLabel, (statusCounts.get(statusLabel) || 0) + 1);
    const due = t.staff_due_date || t.agency_due_date;
    if (!due) continue;
    const dueTime = new Date(due).getTime();
    if (Number.isNaN(dueTime)) continue;
    if (dueTime < nowTime) overdueTasks.push(t);
    else if (dueTime <= horizon.getTime()) dueSoonTasks.push(t);
  }
  const fmtTaskLine = (t: any) => `- ${t.client_name || t.client_id || "Unassigned"}: ${t.task_name || "Task"} (${t.status || "Not Started"}, due ${fmtDate(t.staff_due_date || t.agency_due_date)})`;
  const statusBreakdown = Array.from(statusCounts.entries()).map(([status, count]) => `${status}: ${count}`).join("\n");

  // --- Books health: trial-balance every client's ledger nightly, so an
  // out-of-balance ledger is flagged the next morning instead of whenever
  // someone happens to open Reports → Trial Balance. Same half-cent tolerance
  // as the report itself. Silence in the digest means everything balances.
  const unbalancedClients = await query<any>(
    `SELECT client_id, client_name,
            ROUND(SUM(debit)::numeric, 2) AS debits,
            ROUND(SUM(credit)::numeric, 2) AS credits,
            ROUND((SUM(debit) - SUM(credit))::numeric, 2) AS difference
       FROM altax.v3_gl_entries
      GROUP BY client_id, client_name
     HAVING ABS(SUM(debit) - SUM(credit)) > 0.005
      ORDER BY ABS(SUM(debit) - SUM(credit)) DESC`
  );
  const booksHealthSection = unbalancedClients.length
    ? `\nBOOKS OUT OF BALANCE — ${unbalancedClients.length} CLIENT${unbalancedClients.length === 1 ? "" : "S"}\n` +
      unbalancedClients.map((c) =>
        `- ${c.client_name || c.client_id}: off by $${Math.abs(Number(c.difference)).toFixed(2)} (debits $${c.debits} vs credits $${c.credits})`
      ).join("\n") +
      `\nOpen Reports -> Trial Balance for each client listed to find and correct the entries.`
    : `\nBOOKS HEALTH\nAll clients' ledgers are in balance. No action needed.`;

  // --- Upcoming appointments: everything Scheduled in the next 48 hours, so
  // admins/staff get a daily heads-up alongside the task summary instead of
  // having to check the Calendar proactively. The client's own day-before
  // reminder (appointments.routes.ts's runAppointmentReminders, hourly cron)
  // is separate — this is the firm-side view of the same data.
  const upcomingAppointments = await query<any>(
    `SELECT a.*, c.client_name AS linked_client_name FROM altax.v3_appointments a
       LEFT JOIN altax.v3_clients c ON c.client_id = a.client_id
      WHERE a.status = 'Scheduled' AND a.start_time BETWEEN now() AND now() + interval '48 hours'
      ORDER BY a.start_time ASC`
  );
  const fmtApptLine = (a: any) => {
    const when = new Date(a.start_time).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const who = a.linked_client_name || a.contact_name || "—";
    return `- ${when} ET — ${a.title || "Appointment"} with ${who}${a.assigned_to ? ` (${a.assigned_to})` : ""}`;
  };
  const appointmentsSection = `\nUPCOMING APPOINTMENTS — next 48 hours (${upcomingAppointments.length})\n${upcomingAppointments.length ? upcomingAppointments.map(fmtApptLine).join("\n") : "None scheduled."}`;

  // Same content for every admin recipient — built once outside the loop below.
  // bodyEnglish (plain text) is still what's stored in v3_communications for the
  // Activity Timeline/search; bodyHtml (real headings + grouped overdue list,
  // via buildFirmDigestHtml) is what the actual email renders — previously this
  // digest had no HTML of its own, just sendAndLog's generic one-paragraph
  // wrapper, unreadable once OVERDUE alone ran 40 lines.
  const asOf = new Date();
  const bodyEnglish = [
    `Firm-wide status as of ${fmtDate(asOf)}: ${openTasks.length} open task${openTasks.length === 1 ? "" : "s"}.`,
    booksHealthSection,
    appointmentsSection,
    `\nTASKS BY STATUS\n${statusBreakdown || "None"}`,
    `\nOVERDUE (${overdueTasks.length})\n${overdueTasks.length ? overdueTasks.map(fmtTaskLine).join("\n") : "None."}`,
    `\nDUE WITHIN ${daysAhead} DAY${daysAhead === 1 ? "" : "S"} (${dueSoonTasks.length})\n${dueSoonTasks.length ? dueSoonTasks.map(fmtTaskLine).join("\n") : "None."}`,
  ].join("\n");
  const bodyHtml = buildFirmDigestHtml({
    asOf, openTaskCount: openTasks.length, unbalancedClients, upcomingAppointments,
    statusCounts, overdueTasks, dueSoonTasks, daysAhead, nowTime,
  });
  const subject = unbalancedClients.length
    ? `Firm daily digest — ${openTasks.length} open task${openTasks.length === 1 ? "" : "s"}, books out of balance for ${unbalancedClients.length} client${unbalancedClients.length === 1 ? "" : "s"}`
    : `Firm daily digest — ${openTasks.length} open task${openTasks.length === 1 ? "" : "s"}`;

  const admins = await query<any>(`SELECT email FROM altax.v3_users WHERE active = true AND lower(role) = 'admin' AND email IS NOT NULL AND email <> ''`);
  for (const admin of admins) {
    try {
      const sourceRecordId = `FIRMREM-${normalizeText(admin.email)}-${today}`;
      if (await alreadySent(sourceRecordId)) { firmSkipped++; continue; }

      // This digest is internal, English-only operational content — bodyArabic
      // is "" on purpose (not bodyEnglish again): sendAndLog renders bodyArabic
      // as a SECOND block whenever it's truthy, which is what produced a real
      // doubled-up email body before this fix.
      const result = await sendAndLog({
        clientId: null, clientName: null, relatedTaskId: null,
        subject, bodyEnglish, bodyArabic: "", bodyHtml, sentTo: admin.email, sourceRecordId, actorEmail,
      }, req);
      if (result.sent) firmSent++; else if (result.alreadySent) firmSkipped++; else firmFailed++;
    } catch (err) {
      firmFailed++;
      // eslint-disable-next-line no-console
      console.error(`[runReminders] firm digest failed for ${admin.email}:`, err);
    }
  }

  await logAudit("Reminders", "RUN", "Batch", "", "", today,
    `Reminders run by ${actorEmail}: ${staffSent} staff digests, ${firmSent} firm digests, ${clientSent} document digests, ${paymentSent} payment reminders sent.`, actorEmail);

  return {
    ok: true,
    staff: { sent: staffSent, skipped: staffSkipped, failed: staffFailed },
    firm: { sent: firmSent, skipped: firmSkipped, failed: firmFailed },
    clients: { sent: clientSent, skipped: clientSkipped, failed: clientFailed },
    payments: { sent: paymentSent, skipped: paymentSkipped, failed: paymentFailed },
  };
}

/**
 * Manual trigger — a staff member clicking "Run Reminders" in Communications. The
 * daily 6:30AM cron (server.ts) calls runReminders() directly, bypassing this route.
 */
remindersRouter.post("/run", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const daysAhead = Number(req.body?.daysAhead) || 3;
  const result = await runReminders(req.user!.email, daysAhead, req);
  res.json(result);
}));
