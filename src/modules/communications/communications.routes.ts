import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient, getUserAliases, isAssignedToUser, normalizeText } from "../../common/assignment";
import { sendEmail, sendSms, sendWhatsApp, NotConfiguredError } from "../../common/notifications";

/**
 * Communications module — Phase 6 slice covering the plan's named test scenarios:
 * client reminders don't expose internal tasks, staff only see assigned-task
 * communications, clients receive tax/document-style messages, English/Arabic output
 * works. Ported from alTaxPortalCreateCommunication / alTaxV5AppendCommunication_,
 * alTaxPortalCreateTaskCommunication, alTaxPortalCreateStaffCommunication,
 * alTaxPortalSaveTemplate, and the visibility/language helpers
 * alTaxV5IsClientVisibleCommunication_ / alTaxV5CommunicationBodyForPreference_.
 *
 * Real send wiring (added once notifications.ts existed — see sendChannel() below):
 * Email/SMS/WhatsApp now actually attempt delivery via Resend/Twilio when the caller
 * passes sendNow (default true, matching legacy's "Send Email Now?" default), same
 * never-blocks-on-missing-config pattern used by billing.routes.ts and users.routes.ts.
 * Portal Note and Phone channels are always log-only (a phone call has no API to call).
 *
 * Automated reminders (staff task digests, client document/payment reminders) live in
 * the separate reminders.routes.ts module (POST /reminders/run), not here — kept apart
 * since they're triggered as a batch job rather than a single logged message.
 */
export const communicationsRouter = Router();

/**
 * Attempts a real send for Email/SMS/WhatsApp channels; Portal Note and Phone are
 * always log-only. Never throws — a missing provider key or a delivery failure is
 * reported back as { sent: false, error } rather than blocking the communication log
 * write, exactly like sendInviteEmail() in users.routes.ts.
 */
async function sendChannel(channel: string, to: string, subject: string, body: string): Promise<{ sent: boolean; error?: string }> {
  const normalized = normalizeText(channel);
  if (!to || !["email", "sms", "whatsapp"].includes(normalized)) return { sent: false };
  try {
    if (normalized === "email") {
      await sendEmail({ to, subject, html: `<p>${body.replace(/\n/g, "<br>")}</p>` });
    } else if (normalized === "sms") {
      await sendSms({ to, body });
    } else {
      await sendWhatsApp({ to, body });
    }
    return { sent: true };
  } catch (err: any) {
    return { sent: false, error: err instanceof NotConfiguredError ? err.message : (err?.message || "Send failed.") };
  }
}

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
}
function nextCommunicationId(): string {
  return `COM-${idSuffix()}`;
}
function nextTemplateId(): string {
  return `TPL-${idSuffix()}`;
}

/** Mirrors alTaxV5NormalizeClientLanguagePreference_. */
function normalizeLanguagePreference(value: unknown): "Arabic" | "English" | "Both" {
  const text = normalizeText(value || "Both");
  if (text.includes("arabic") || text.includes("عرب")) return "Arabic";
  if (text.includes("english") || text.includes("انجل")) return "English";
  return "Both";
}

/**
 * Mirrors alTaxV5CommunicationBodyForPreference_. Also the body actually handed to
 * sendChannel() below (POST / at line ~140) — when a client's language preference is
 * Arabic or Both, the real email/SMS/WhatsApp send includes the Arabic text, not just
 * English. Also returned standalone in API responses as a preview.
 */
function communicationBodyForPreference(english: string, arabic: string, subject: string, preference: unknown): string {
  const en = String(english || "").trim();
  const ar = String(arabic || "").trim();
  const sub = String(subject || "").trim();
  const pref = normalizeLanguagePreference(preference);
  if (en && ar) {
    if (pref === "English") return en;
    if (pref === "Arabic") return `${ar}\n\n---\n\n${en}`;
    return `${en}\n\n---\n\n${ar}`;
  }
  return en || ar || sub;
}

/** Mirrors alTaxV5IsClientVisibleCommunication_. */
function isClientVisibleCommunication(row: any, clientEmail: string): boolean {
  const combined = [row.direction, row.channel, row.source_system].map(normalizeText).join(" ");
  if (combined.includes("internal") || combined.includes("staff") || combined.includes("task")) return false;
  const subject = normalizeText(row.subject);
  if (subject.includes("staff reminder") || subject.includes("task reminder")) return false;
  const sentTo = normalizeText(row.sent_to);
  const sentBy = normalizeText(row.sent_by);
  const email = normalizeText(clientEmail);
  if (sentTo && sentTo.includes("@") && email && sentTo !== email && sentBy !== email) return false;
  return true;
}

/**
 * Log a client-facing communication — ported from alTaxPortalCreateCommunication +
 * alTaxV5AppendCommunication_'s record-write path (sending stripped, see module doc
 * comment). Any authenticated role may call this; access is enforced per-client via
 * canAccessClient (client role can only log against their own client).
 */
communicationsRouter.post("/", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const clientId = String(body.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "clientId is required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }

  const client = await queryOne<any>(`SELECT client_id, client_name, email, preferred_language FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const subject = String(body.subject || "AL TAX SERVICE").trim();
  const messageEnglish = String(body.messageEnglish || "").trim();
  const messageArabic = String(body.messageArabic || "").trim();
  const languagePreference = body.languagePreference || client.preferred_language || "Both";
  const previewBody = communicationBodyForPreference(messageEnglish, messageArabic, subject, languagePreference);

  const communicationId = nextCommunicationId();
  const channel = String(body.channel || "Portal Note").trim();
  const direction = String(body.direction || "Outbound").trim();
  const sentTo = String(body.sentTo || client.email || "").trim();
  const sendNow = body.sendNow === undefined ? true : Boolean(body.sendNow);

  const result = sendNow ? await sendChannel(channel, sentTo, subject, previewBody) : { sent: false };
  const status = result.sent ? "Saved + Sent" : result.error ? `Saved — ${result.error}` : "Saved";

  await query(
    `INSERT INTO altax.v3_communications
       (communication_id, client_id, client_name, related_task_id, direction, channel, subject,
        message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),$12,$13,$1)`,
    [
      communicationId, client.client_id, client.client_name, String(body.relatedTaskId || "").trim() || null,
      direction, channel, subject, messageEnglish, messageArabic, sentTo || null, req.user!.email, status,
      String(body.sourceSystem || "Node Web App").trim(),
    ]
  );

  await logAudit("Communications", "CREATE", communicationId, "", "", sentTo || client.email || "",
    "Communication saved from web app.", req.user!.email);

  res.status(201).json({ ok: true, communicationId, status, previewBody, sent: result.sent, sendError: result.error });
}));

/**
 * List communications — admin sees all; client sees only their own client's
 * client-visible messages (isClientVisibleCommunication — internal/staff/task-tagged
 * rows are hidden); employee sees only messages sent to or by them (matches legacy's
 * employee branch, which is the one place employees DO get communications, unlike
 * tasks/documents/invoices where that role sees nothing); staff/general see
 * communications tied to clients they have task access to.
 */
communicationsRouter.get("/", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const role = req.user!.role;

  if (role === "admin") {
    const rows = await query(`SELECT * FROM altax.v3_communications ORDER BY sent_at DESC NULLS LAST`);
    return res.json({ communications: rows });
  }

  if (role === "client") {
    const rows = await query<any>(`SELECT * FROM altax.v3_communications WHERE client_id = $1 ORDER BY sent_at DESC NULLS LAST`, [req.user!.clientId]);
    return res.json({ communications: rows.filter((r) => isClientVisibleCommunication(r, req.user!.email)) });
  }

  if (role === "employee") {
    const email = normalizeText(req.user!.email);
    const rows = await query(
      `SELECT * FROM altax.v3_communications WHERE lower(sent_to) = $1 OR lower(sent_by) = $1 ORDER BY sent_at DESC NULLS LAST`,
      [email]
    );
    return res.json({ communications: rows });
  }

  const aliases = await getUserAliases(req.user!.email);
  const rows = await query(
    `SELECT * FROM altax.v3_communications
      WHERE client_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($1::text[]))
         OR direction = 'Staff to Staff'
      ORDER BY sent_at DESC NULLS LAST`,
    [Array.from(aliases)]
  );
  res.json({ communications: rows });
}));

/**
 * Task note/message thread — powers the "Review Notes / Messages" action on a
 * task row. Same access rule as posting: assigned staff or anyone with client
 * access to the task's client. Not in the original ported-function list because
 * legacy read this via the general Communications list filtered client-side by
 * RelatedTaskID; this is a thin, purpose-built equivalent. Employee is excluded
 * explicitly — tasks are an admin/staff/client concept (tasks.routes.ts returns []
 * for employee entirely), so an employee falling through to canAccessClient here
 * would otherwise view internal task note threads for their employer's tasks.
 */
communicationsRouter.get("/task/:taskId", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (req.user!.role === "employee") return res.status(403).json({ error: "You do not have access to this task." });
  const { taskId } = req.params;
  const task = await queryOne<any>(`SELECT * FROM altax.v3_tasks WHERE task_id = $1`, [taskId]);
  if (!task) return res.status(404).json({ error: "Task not found." });

  const aliases = await getUserAliases(req.user!.email);
  const taskAllowed = isAssignedToUser(task.assigned_to, aliases) || (await canAccessClient(req.user!, task.client_id));
  if (!taskAllowed) return res.status(403).json({ error: "You do not have access to this task." });

  const rows = await query(
    `SELECT * FROM altax.v3_communications WHERE related_task_id = $1 ORDER BY sent_at ASC NULLS LAST`,
    [taskId]
  );
  res.json({ communications: rows });
}));

/**
 * Task note/message — ported from alTaxPortalCreateTaskCommunication. Admin/staff
 * only (approximates alTaxV5IsAssignableStaffRole_, which has no client/employee
 * members in this backend's role set), and must have access to the target task via
 * the same assigned-to-me-or-accessible-client rule Tasks uses.
 */
communicationsRouter.post("/task", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const taskId = String(body.taskId || "").trim();
  if (!taskId) return res.status(400).json({ error: "Task ID is required." });

  const task = await queryOne<any>(`SELECT * FROM altax.v3_tasks WHERE task_id = $1`, [taskId]);
  if (!task) return res.status(404).json({ error: "Task not found." });

  const aliases = await getUserAliases(req.user!.email);
  const taskAllowed = isAssignedToUser(task.assigned_to, aliases) || (await canAccessClient(req.user!, task.client_id));
  if (!taskAllowed) return res.status(403).json({ error: "You do not have access to this task." });

  const isNote = normalizeText(body.mode || body.type || "message") === "note";
  const messageText = String(body.messageEnglish || body.message || body.note || "").trim();
  if (!messageText) return res.status(400).json({ error: isNote ? "Enter a task note." : "Enter a task message." });

  const recipient = String(body.recipientEmail || body.sentTo || body.recipient || "").trim();
  if (!isNote && !recipient) return res.status(400).json({ error: "Select a recipient with a valid email." });

  const communicationId = nextCommunicationId();
  const subject = String(body.subject || `${isNote ? "Task note" : "Task message"}: ${task.task_name || task.task_id}`).trim();
  const channel = isNote ? "Task Note" : "Task Message";
  const direction = isNote ? "Internal Note" : (["admin", "staff"].includes(req.user!.role) ? "Staff to Admin" : "Internal Note");

  await query(
    `INSERT INTO altax.v3_communications
       (communication_id, client_id, client_name, related_task_id, direction, channel, subject,
        message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),'Saved','Node Web App Task',$1)`,
    [
      communicationId, task.client_id, task.client_name, task.task_id, direction, channel, subject,
      messageText, String(body.messageArabic || "").trim() || null, isNote ? null : recipient, req.user!.email,
    ]
  );

  await logAudit("Communications", isNote ? "TASK_NOTE" : "TASK_MESSAGE", communicationId, task.task_id,
    req.user!.email, isNote ? "" : recipient, "Saved", req.user!.email);

  res.status(201).json({ ok: true, communicationId, status: "Saved" });
}));

/**
 * Active admin/staff directory — powers the Firm Staff Messages recipient picker.
 * Deliberately separate from GET /users (admin-only, returns invite/lockout
 * fields): this is just name+email+role for an active-user dropdown, safe for
 * any admin/staff caller to see.
 */
communicationsRouter.get("/staff-directory", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query(
    `SELECT name, email, phone, role FROM altax.v3_users WHERE active = true AND lower(role) IN ('admin','staff') ORDER BY name ASC`
  );
  res.json({ staff: rows });
}));

/**
 * Staff-to-staff message — ported from alTaxPortalCreateStaffCommunication.
 * Admin/staff only; recipient must resolve to an active admin/staff portal user.
 */
communicationsRouter.post("/staff", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const recipientAlias = String(body.recipientEmail || body.sentTo || body.recipient || "").trim();
  if (!recipientAlias) return res.status(400).json({ error: "Select an active staff/admin recipient." });

  const recipient = await queryOne<any>(
    `SELECT email, name, phone FROM altax.v3_users
      WHERE active = true AND lower(role) IN ('admin','staff')
        AND (lower(email) = $1 OR lower(name) = $1)
      LIMIT 1`,
    [normalizeText(recipientAlias)]
  );
  if (!recipient) return res.status(400).json({ error: "Select an active staff/admin user with a valid email." });

  const subject = String(body.subject || "Firm staff message").trim();
  const messageText = String(body.messageEnglish || body.message || subject || "").trim();
  if (!messageText) return res.status(400).json({ error: "Enter a staff message." });

  const channel = String(body.channel || "Email").trim();
  const sendNow = body.sendNow === undefined ? true : Boolean(body.sendNow);
  const sentTo = String(body.sentTo || (["sms", "whatsapp"].includes(normalizeText(channel)) ? recipient.phone : recipient.email) || "").trim();

  const result = sendNow ? await sendChannel(channel, sentTo, subject, messageText) : { sent: false };
  const status = result.sent ? "Saved + Sent" : result.error ? `Saved — ${result.error}` : "Saved";

  const communicationId = nextCommunicationId();
  await query(
    `INSERT INTO altax.v3_communications
       (communication_id, client_id, client_name, related_task_id, direction, channel, subject,
        message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id)
     VALUES ($1,NULL,NULL,NULL,'Staff to Staff',$2,$3,$4,NULL,$5,$6,now(),$7,'Node Web App Staff',$1)`,
    [communicationId, channel, subject, messageText, sentTo || recipient.email, req.user!.email, status]
  );

  await logAudit("Communications", "STAFF_MESSAGE", communicationId, "", req.user!.email, recipient.email,
    status, req.user!.email);

  res.status(201).json({ ok: true, communicationId, status, sentTo: sentTo || recipient.email, sent: result.sent, sendError: result.error });
}));

const TEMPLATE_FIELDS: Record<string, string> = {
  templateName: "template_name",
  category: "category",
  subject: "subject",
  messageEnglish: "message_english",
  messageArabic: "message_arabic",
  active: "active",
  notes: "notes",
};

/**
 * Create or update a message template — ported from alTaxPortalSaveTemplate:
 * upserts by templateId when given, else by exact (case-insensitive) name match.
 * Admin/staff only (mirrors alTaxV5RequireFirmUser_ — no client/employee callers).
 */
communicationsRouter.post("/templates", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const templateName = String(body.templateName || "").trim();
  if (!templateName) return res.status(400).json({ error: "Template name is required." });

  let templateId = String(body.templateId || "").trim();
  let existing = templateId
    ? await queryOne<any>(`SELECT template_id FROM altax.v3_templates WHERE template_id = $1`, [templateId])
    : await queryOne<any>(`SELECT template_id FROM altax.v3_templates WHERE lower(template_name) = $1`, [templateName.toLowerCase()]);
  if (existing) templateId = existing.template_id;
  if (!templateId) templateId = nextTemplateId();

  const fields: Record<string, any> = { template_name: templateName };
  for (const [key, column] of Object.entries(TEMPLATE_FIELDS)) {
    if (key === "templateName") continue;
    if (Object.prototype.hasOwnProperty.call(body, key)) fields[column] = body[key];
  }
  if (fields.active === undefined) fields.active = true;
  if (typeof fields.active !== "boolean") fields.active = normalizeText(fields.active) !== "no";

  if (existing) {
    const setClause = Object.keys(fields).map((col, i) => `${col} = $${i + 2}`).join(", ");
    await query(
      `UPDATE altax.v3_templates SET ${setClause}, updated_at = now(), updated_by = $${Object.keys(fields).length + 2} WHERE template_id = $1`,
      [templateId, ...Object.values(fields), req.user!.email]
    );
  } else {
    const columns = ["template_id", ...Object.keys(fields), "updated_by", "source_system", "source_record_id"];
    const values = [templateId, ...Object.values(fields), req.user!.email, "Node Web App", templateId];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    await query(`INSERT INTO altax.v3_templates (${columns.join(", ")}) VALUES (${placeholders})`, values);
  }

  await logAudit("Templates", "SAVE_TEMPLATE", templateId, "TemplateName", "", templateName,
    `Template saved by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, templateId });
}));

/** List templates — admin/staff only, matching who can create/edit them. */
communicationsRouter.get("/templates", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rows = await query(`SELECT * FROM altax.v3_templates ORDER BY template_name ASC`);
  res.json({ templates: rows });
}));
