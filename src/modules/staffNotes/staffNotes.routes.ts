import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { sendEmail, sendSms, recordNotificationFailure } from "../../common/notifications";
import { wrapEmailHtml } from "../../common/emailTemplate";
import { alertAdmins } from "../../common/adminAlerts";
import { etWallClockToUtc } from "../../common/paymentReminders";

const PRIORITIES = ["Low", "Normal", "High", "Urgent"];

/**
 * Firm Notes — a shared follow-up notebook for admin/staff, separate from
 * Tasks and separate from the per-client activity log (v3_client_activity_log,
 * the "Client Note"/"Firm Note" buttons on a client's own page). Real owner
 * request, 2026-09-07: while working through client tasks, staff need
 * somewhere to jot a quick reminder ("this client is missing something,"
 * "come back and invoice them") that isn't a formal Task, then review/
 * resolve/delete it later from ONE central place — not by visiting each
 * client individually, which the activity log has no way to do (every route
 * against it is scoped to one client_id).
 *
 * Visibility is role-based, not author-based, per two rounds of owner
 * clarification: staff don't need notes hidden from each other (one shared
 * notebook), but the owner's own notes as admin genuinely are different from
 * staff notes and need to stay separate. `visibility='firm'` (the default)
 * is visible to everyone; `visibility='admin'` is visible only to admin
 * accounts, and only an admin can ever create one — enforced server-side in
 * every route below, never trusted from client input alone.
 */
export const staffNotesRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

/**
 * The frontend's `<input type="datetime-local">` sends "YYYY-MM-DDTHH:mm"
 * with no timezone at all — treated as America/New_York wall-clock time
 * (matching how schedulePaymentReminder resolves a time typed by staff),
 * not the server's own timezone, so "2:30 PM" means 2:30 PM Eastern
 * regardless of what timezone the app happens to be running in.
 */
function parseRemindAtInput(raw: unknown): Date | null {
  const trimmed = String(raw || "").trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, dateStr, hh, mm] = match;
  return etWallClockToUtc(dateStr, Number(hh), Number(mm));
}

function normalizePriority(raw: unknown): string {
  const trimmed = String(raw || "").trim();
  return PRIORITIES.includes(trimmed) ? trimmed : "Normal";
}

staffNotesRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const status = String(req.query.status || "open").toLowerCase();
  const clientId = String(req.query.clientId || "").trim();
  const search = String(req.query.search || "").trim();
  const mineOnly = String(req.query.mine || "") === "1";

  const params: any[] = [req.user!.email];
  let where = "1=1";
  if (status === "open") where += ` AND n.status = 'Open'`;
  else if (status === "done") where += ` AND n.status = 'Done'`;
  if (clientId) { params.push(clientId); where += ` AND n.client_id = $${params.length}`; }
  if (search) { params.push(`%${search}%`); where += ` AND n.body ILIKE $${params.length}`; }
  if (mineOnly) { params.push(req.user!.email); where += ` AND n.author_email = $${params.length}`; }
  if (!isAdmin) where += ` AND n.visibility = 'firm'`;

  const rows = await query<any>(
    `SELECT n.*, c.client_name,
            EXISTS (SELECT 1 FROM altax.v3_activity_reads r WHERE r.entity_type = 'staff_note' AND r.entity_id = n.note_id AND r.reader_email = $1) AS is_read
       FROM altax.v3_staff_notes n
       LEFT JOIN altax.v3_clients c ON c.client_id = n.client_id
      WHERE ${where}
      ORDER BY (n.status = 'Open' AND n.remind_at IS NOT NULL AND n.remind_at <= now()) DESC, n.remind_at ASC NULLS LAST, n.created_at DESC`,
    params
  );
  res.json({
    notes: rows.map((r) => ({
      noteId: r.note_id, authorEmail: r.author_email, authorName: r.author_name,
      clientId: r.client_id, clientName: r.client_name, body: r.body, visibility: r.visibility,
      category: r.category, status: r.status, priority: r.priority, assignedTo: r.assigned_to,
      remindAt: r.remind_at, reminderSentAt: r.reminder_sent_at, resolvedAt: r.resolved_at, resolvedBy: r.resolved_by,
      createdAt: r.created_at, updatedAt: r.updated_at, unread: !r.is_read,
    })),
  });
}));

/**
 * The sidebar badge count — deliberately every OPEN note, not just unread
 * ones. Real owner confusion, live: 2 open notes on screen, badge showing
 * "1" — the badge was counting unread only, so a note someone had merely
 * clicked into (marking it read) dropped off the count even though it was
 * still completely unresolved. For a follow-up notebook the number that
 * matters is "how many things still need doing," not "have I glanced at
 * this yet" — read/unread stays as a per-row visual cue in the list (the
 * bold text + dot), it just no longer drives the badge.
 */
staffNotesRouter.get("/open-count", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const row = await queryOne<any>(
    `SELECT COUNT(*)::int AS count FROM altax.v3_staff_notes n
      WHERE n.status = 'Open' ${isAdmin ? "" : "AND n.visibility = 'firm'"}`
  );
  res.json({ count: row?.count || 0 });
}));

staffNotesRouter.post("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const body = String(req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "Note text is required." });
  const clientId = String(req.body?.clientId || "").trim() || null;
  const category = String(req.body?.category || "").trim() || null;
  const remindAt = parseRemindAtInput(req.body?.remindAt);
  const priority = normalizePriority(req.body?.priority);
  const assignedTo = String(req.body?.assignedTo || "").trim() || null;
  // Never trust visibility: 'admin' from the request body alone — a staff
  // account could otherwise write itself into the admin-only tier.
  const visibility = isAdmin && req.body?.visibility === "admin" ? "admin" : "firm";

  if (clientId) {
    const client = await queryOne<any>(`SELECT client_id FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
    if (!client) return res.status(400).json({ error: "Client not found." });
  }

  const noteId = `SN-${idSuffix()}`;
  const authorRow = await queryOne<any>(`SELECT name FROM altax.v3_users WHERE lower(email) = lower($1)`, [req.user!.email]);
  await query(
    `INSERT INTO altax.v3_staff_notes (note_id, author_email, author_name, client_id, body, visibility, category, remind_at, priority, assigned_to)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [noteId, req.user!.email, authorRow?.name || req.user!.email, clientId, body, visibility, category, remindAt, priority, assignedTo]
  );
  await logAudit("Notes", "CREATE_STAFF_NOTE", noteId, "", "", "", `Note added by ${req.user!.email}.`, req.user!.email);
  res.status(201).json({ ok: true, noteId });
}));

/**
 * Edits an existing note's text/client/category/remind date — real owner
 * report, live: notes weren't editable at all, only deletable. Author or
 * admin only, same permission shape as delete (a shared notebook still
 * shouldn't let anyone rewrite anyone else's entry). Visibility is NOT
 * editable here — flipping a note between Team/Admin Only after the fact
 * is a bigger decision than a typo fix; delete and recreate it if it
 * genuinely needs to change tiers.
 */
staffNotesRouter.post("/:noteId/edit", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const { noteId } = req.params;
  const note = await queryOne<any>(`SELECT * FROM altax.v3_staff_notes WHERE note_id = $1`, [noteId]);
  if (!note) return res.status(404).json({ error: "Note not found." });
  if (note.visibility === "admin" && !isAdmin) return res.status(403).json({ error: "You do not have access to this note." });
  if (note.author_email.toLowerCase() !== req.user!.email.toLowerCase() && !isAdmin) {
    return res.status(403).json({ error: "Only the author or an admin can edit this note." });
  }

  const body = String(req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "Note text is required." });
  const clientId = String(req.body?.clientId || "").trim() || null;
  const category = String(req.body?.category || "").trim() || null;
  const remindAt = parseRemindAtInput(req.body?.remindAt);
  const priority = normalizePriority(req.body?.priority);
  const assignedTo = String(req.body?.assignedTo || "").trim() || null;

  if (clientId) {
    const client = await queryOne<any>(`SELECT client_id FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
    if (!client) return res.status(400).json({ error: "Client not found." });
  }

  // A note already reminded about, then rescheduled to a new time (or given
  // a reminder for the first time), needs a fresh chance to fire — without
  // this, editing remind_at after the original reminder already went out
  // would silently never notify anyone again.
  const oldRemindAt = note.remind_at ? new Date(note.remind_at).getTime() : null;
  const newRemindAt = remindAt ? remindAt.getTime() : null;
  const rearm = oldRemindAt !== newRemindAt;

  await query(
    `UPDATE altax.v3_staff_notes SET body = $2, client_id = $3, category = $4, remind_at = $5, priority = $6, assigned_to = $7,
            reminder_sent_at = CASE WHEN $8 THEN NULL ELSE reminder_sent_at END, updated_at = now()
      WHERE note_id = $1`,
    [noteId, body, clientId, category, remindAt, priority, assignedTo, rearm]
  );
  await logAudit("Notes", "EDIT_STAFF_NOTE", noteId, "", "", "", `Note edited by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

staffNotesRouter.post("/:noteId/status", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const { noteId } = req.params;
  const note = await queryOne<any>(`SELECT * FROM altax.v3_staff_notes WHERE note_id = $1`, [noteId]);
  if (!note) return res.status(404).json({ error: "Note not found." });
  if (note.visibility === "admin" && !isAdmin) return res.status(403).json({ error: "You do not have access to this note." });

  const status = req.body?.status === "Done" ? "Done" : "Open";
  await query(
    `UPDATE altax.v3_staff_notes SET status = $2, resolved_at = $3, resolved_by = $4, updated_at = now() WHERE note_id = $1`,
    [noteId, status, status === "Done" ? new Date() : null, status === "Done" ? req.user!.email : null]
  );
  res.json({ ok: true });
}));

staffNotesRouter.post("/:noteId/read", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const { noteId } = req.params;
  const note = await queryOne<any>(`SELECT visibility FROM altax.v3_staff_notes WHERE note_id = $1`, [noteId]);
  if (!note) return res.status(404).json({ error: "Note not found." });
  if (note.visibility === "admin" && !isAdmin) return res.status(403).json({ error: "You do not have access to this note." });

  await query(
    `INSERT INTO altax.v3_activity_reads (entity_type, entity_id, reader_email) VALUES ('staff_note', $1, $2) ON CONFLICT DO NOTHING`,
    [noteId, req.user!.email]
  );
  res.json({ ok: true });
}));

/** Author or admin only — a shared notebook still shouldn't let anyone erase anyone else's entry. */
staffNotesRouter.post("/:noteId/delete", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const { noteId } = req.params;
  const note = await queryOne<any>(`SELECT * FROM altax.v3_staff_notes WHERE note_id = $1`, [noteId]);
  if (!note) return res.status(404).json({ error: "Note not found." });
  if (note.visibility === "admin" && !isAdmin) return res.status(403).json({ error: "You do not have access to this note." });
  if (note.author_email.toLowerCase() !== req.user!.email.toLowerCase() && !isAdmin) {
    return res.status(403).json({ error: "Only the author or an admin can delete this note." });
  }

  await query(`DELETE FROM altax.v3_activity_reads WHERE entity_type = 'staff_note' AND entity_id = $1`, [noteId]);
  await query(`DELETE FROM altax.v3_staff_notes WHERE note_id = $1`, [noteId]);
  await logAudit("Notes", "DELETE_STAFF_NOTE", noteId, "", "", "", `Note deleted by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

function noteReminderEmailHtml(note: any, targetName: string): string {
  const priorityLine = note.priority && note.priority !== "Normal"
    ? `<div style="display:inline-block;margin-bottom:10px;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.03em;background:${note.priority === "Urgent" ? "#ffe4e1" : note.priority === "High" ? "#fff4d6" : "#eef2f7"};color:${note.priority === "Urgent" ? "#b42318" : note.priority === "High" ? "#a16207" : "#475467"};">${note.priority}</div>`
    : "";
  return `
    <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
      <div style="background:#202833;color:#ffffff;padding:16px 20px;border-radius:10px 10px 0 0;">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;opacity:0.85;">Note Reminder</div>
        <div style="font-size:17px;font-weight:800;margin-top:4px;">${note.client_name ? escapeHtmlBasic(note.client_name) : "Firm Note"}</div>
      </div>
      <div style="border:1px solid #e0e0e0;border-top:none;border-radius:0 0 10px 10px;padding:18px 20px;font-size:14px;">
        <p style="margin:0 0 4px;color:#666;">Hi ${escapeHtmlBasic(targetName)},</p>
        ${priorityLine}
        <div style="white-space:pre-wrap;font-weight:600;line-height:1.5;">${escapeHtmlBasic(note.body)}</div>
        <p style="margin:14px 0 0;color:#666;font-size:12px;">Added by ${escapeHtmlBasic(note.author_name || note.author_email)}. Open Notes in AL TAX Nexus to mark this done.</p>
      </div>
    </div>`;
}

function escapeHtmlBasic(s: string): string {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Fires every note reminder actually due — a plain SMS/email to whoever's
 * assigned (falling back to the note's own author when unassigned), unlike
 * the old behavior where "Remind me on" only ever colored a row red and
 * folded into an unrelated daily digest's aggregate count. Same atomic
 * claim-then-send shape as runPaymentDueReminders (paymentReminders.ts):
 * claim via UPDATE...RETURNING before sending so two overlapping sweeps
 * can't double-send, and un-claim on failure so a transient error retries
 * next sweep instead of silently going unnoticed forever.
 */
export async function runStaffNoteReminders(): Promise<void> {
  const due = await query<any>(
    `SELECT n.*, c.client_name FROM altax.v3_staff_notes n
       LEFT JOIN altax.v3_clients c ON c.client_id = n.client_id
      WHERE n.status = 'Open' AND n.reminder_sent_at IS NULL
        AND n.remind_at IS NOT NULL AND n.remind_at <= now()`
  );
  if (due.length === 0) return;

  const failures: string[] = [];
  for (const note of due) {
    const claimed = await queryOne<any>(
      `UPDATE altax.v3_staff_notes SET reminder_sent_at = now() WHERE note_id = $1 AND reminder_sent_at IS NULL RETURNING note_id`,
      [note.note_id]
    );
    if (!claimed) continue; // another sweep already claimed this one

    try {
      const targetIdentifier = note.assigned_to || note.author_email;
      const target = await queryOne<any>(
        `SELECT name, email, phone FROM altax.v3_users WHERE lower(name) = lower($1) OR lower(email) = lower($1) LIMIT 1`,
        [targetIdentifier]
      );
      if (!target?.email) {
        // No resolvable person to notify — leave it claimed (retrying
        // forever against a name that doesn't match any account helps no
        // one) but tell an admin once so a typo'd "Assigned To" gets fixed.
        failures.push(`"${note.body.slice(0, 60)}" — assigned to "${targetIdentifier}", no matching user found.`);
        continue;
      }
      const clientSuffix = note.client_name ? ` — ${note.client_name}` : "";
      const subject = `Note reminder${note.priority && note.priority !== "Normal" ? ` (${note.priority})` : ""}${clientSuffix}`;
      const html = await wrapEmailHtml(noteReminderEmailHtml(note, target.name || target.email));
      await sendEmail({ to: target.email, subject, html });
      if (target.phone) {
        const smsBody = `AL TAX SERVICE note reminder${clientSuffix}: ${note.body.slice(0, 220)}`;
        try { await sendSms({ to: target.phone, body: smsBody }); } catch (err) { await recordNotificationFailure(`staffNoteReminder:sms:${note.note_id}`, err); }
      }
    } catch (err) {
      await recordNotificationFailure(`staffNoteReminder:email:${note.note_id}`, err);
      // Revert the claim so a transient send failure gets retried next sweep instead of silently never notifying anyone.
      await query(`UPDATE altax.v3_staff_notes SET reminder_sent_at = NULL WHERE note_id = $1`, [note.note_id]);
      failures.push(`"${note.body.slice(0, 60)}" — send failed.`);
    }
  }
  if (failures.length > 0) {
    await alertAdmins("Staff note reminders had failures", failures.join("\n"));
  }
}
