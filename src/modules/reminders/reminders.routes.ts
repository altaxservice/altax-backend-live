import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { normalizeText } from "../../common/assignment";
import { sendEmail, NotConfiguredError } from "../../common/notifications";
import { resolveTemplate } from "../templates/templates.routes";
import { wrapEmailHtml } from "../../common/emailTemplate";

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
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
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

/** Resolves a task's free-text assigned_to (email, name, or user_id) to a real, active user's email — mirrors assignment.ts's alias matching. */
async function resolveAssigneeEmail(assignedTo: string): Promise<string | null> {
  const norm = normalizeText(assignedTo);
  if (!norm) return null;
  const row = await queryOne<any>(
    `SELECT email FROM altax.v3_users WHERE active = true AND (lower(email) = $1 OR lower(name) = $1 OR lower(user_id) = $1) LIMIT 1`,
    [norm]
  );
  return row?.email || null;
}

/** Attempts a real email send, then always writes the communication log row regardless of send success — same pattern as sendChannel() in communications.routes.ts. */
async function sendAndLog(opts: {
  clientId: string | null; clientName: string | null; relatedTaskId: string | null;
  subject: string; bodyEnglish: string; bodyArabic: string; sentTo: string; sourceRecordId: string; actorEmail: string;
}): Promise<{ sent: boolean; sendError?: string }> {
  let sent = false;
  let sendError: string | undefined;
  try {
    await sendEmail({ to: opts.sentTo, subject: opts.subject, html: await wrapEmailHtml(`<p>${opts.bodyEnglish.replace(/\n/g, "<br>")}</p>`) });
    sent = true;
  } catch (err: any) {
    sendError = err instanceof NotConfiguredError ? err.message : (err?.message || "Send failed.");
  }
  const status = sent ? "Saved + Sent" : sendError ? `Saved — ${sendError}` : "Saved";
  await query(
    `INSERT INTO altax.v3_communications
       (communication_id, client_id, client_name, related_task_id, direction, channel, subject,
        message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id)
     VALUES ($1,$2,$3,$4,'Outbound','Email',$5,$6,$7,$8,$9,now(),$10,'Reminders',$11)`,
    [`COM-${idSuffix()}`, opts.clientId, opts.clientName, opts.relatedTaskId, opts.subject, opts.bodyEnglish, opts.bodyArabic,
      opts.sentTo, opts.actorEmail, status, opts.sourceRecordId]
  );
  return { sent, sendError };
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
export async function runReminders(actorEmail: string, daysAhead = 3) {
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

  for (const [email, items] of byAssignee) {
    const sourceRecordId = `STAFFREM-${normalizeText(email)}-${today}`;
    if (await alreadySent(sourceRecordId)) { staffSkipped++; continue; }

    const count = items.english.length;
    const subject = `Daily task reminder — ${count} item${count === 1 ? "" : "s"}`;
    const bodyEnglish = `You have ${count} task${count === 1 ? "" : "s"} due or overdue as of ${fmtDate(new Date())}:\n\n${items.english.join("\n\n")}`;
    const bodyArabic = `لديك ${count} مهمة مستحقة أو متأخرة اعتباراً من ${fmtDate(new Date())}:\n\n${items.arabic.join("\n\n")}`;

    const result = await sendAndLog({
      clientId: null, clientName: null, relatedTaskId: null,
      subject, bodyEnglish, bodyArabic, sentTo: email, sourceRecordId, actorEmail,
    });
    if (result.sent) staffSent++; else staffFailed++;
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
    });
    if (result.sent) clientSent++; else clientFailed++;
  }

  // --- Clients: one payment reminder per client with a positive unpaid invoice balance ---
  const clientsOwing = await query<any>(
    `SELECT c.client_id, c.client_name, c.email, COALESCE(SUM(i.balance_due), 0) AS balance_due
       FROM altax.v3_clients c
       JOIN altax.v3_invoices i ON i.client_id = c.client_id
      WHERE lower(i.status) NOT IN ('paid', 'void') AND i.balance_due > 0
      GROUP BY c.client_id, c.client_name, c.email
     HAVING COALESCE(SUM(i.balance_due), 0) > 0`
  );

  for (const client of clientsOwing) {
    const sourceRecordId = `PAYREM-${client.client_id}-${today}`;
    if (await alreadySent(sourceRecordId)) { paymentSkipped++; continue; }
    if (!client.email) { paymentSkipped++; continue; }

    const resolved = await resolveTemplate("Payment Reminder", client.client_id, "", "", {
      balanceDue: `$${Number(client.balance_due).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    });
    if (!resolved) { paymentSkipped++; continue; }

    const result = await sendAndLog({
      clientId: client.client_id, clientName: client.client_name || null, relatedTaskId: null,
      subject: resolved.subject, bodyEnglish: resolved.message_english, bodyArabic: resolved.message_arabic,
      sentTo: client.email, sourceRecordId, actorEmail,
    });
    if (result.sent) paymentSent++; else paymentFailed++;
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

  const admins = await query<any>(`SELECT email FROM altax.v3_users WHERE active = true AND lower(role) = 'admin' AND email IS NOT NULL AND email <> ''`);
  for (const admin of admins) {
    const sourceRecordId = `FIRMREM-${normalizeText(admin.email)}-${today}`;
    if (await alreadySent(sourceRecordId)) { firmSkipped++; continue; }

    const subject = `Firm task status — ${openTasks.length} open task${openTasks.length === 1 ? "" : "s"}`;
    const bodyEnglish = [
      `Firm-wide task status as of ${fmtDate(new Date())}: ${openTasks.length} open task${openTasks.length === 1 ? "" : "s"}.`,
      `\nBy status:\n${statusBreakdown || "None"}`,
      `\nOverdue (${overdueTasks.length}):\n${overdueTasks.length ? overdueTasks.map(fmtTaskLine).join("\n") : "None"}`,
      `\nDue within ${daysAhead} day${daysAhead === 1 ? "" : "s"} (${dueSoonTasks.length}):\n${dueSoonTasks.length ? dueSoonTasks.map(fmtTaskLine).join("\n") : "None"}`,
    ].join("\n");

    const result = await sendAndLog({
      clientId: null, clientName: null, relatedTaskId: null,
      subject, bodyEnglish, bodyArabic: bodyEnglish, sentTo: admin.email, sourceRecordId, actorEmail,
    });
    if (result.sent) firmSent++; else firmFailed++;
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
  const result = await runReminders(req.user!.email, daysAhead);
  res.json(result);
}));
