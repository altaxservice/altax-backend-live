import { Router, Response } from "express";
import crypto from "crypto";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient, getUserAliases, isAssignedToUser, normalizeText } from "../../common/assignment";
import { sendEmail, sendSms, sendWhatsApp, NotConfiguredError } from "../../common/notifications";
import { wrapEmailHtml } from "../../common/emailTemplate";
import { getFirmProfile } from "../../common/firmProfile";
import { publicBaseUrl } from "../../common/publicUrl";
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES } from "../documents/documents.routes";
import { resolveTemplate, substitutePlaceholders, computeClientPeriodSummary, computeClientPeriodSummaryArabic } from "../templates/templates.routes";

/** 24 random bytes, hex-encoded — same shape as contracts'/invoices' share_token. */
function generateShareToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

function docUploadIdSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
}

/**
 * SMS/WhatsApp can't carry a real file attachment (no MMS wired up), so when a
 * message with an attachment goes out on those channels, the file is saved as a
 * real Document instead — the same secure, hardened, audited path every other
 * document upload goes through (forced-attachment download headers, mime
 * allow-list, size cap), rather than a loosely-stored blob only reachable via a
 * bare link. Returns the direct download URL (same unauthenticated-but-unguessable
 * trust model as every other document link in this app) so the SMS text can point
 * straight at it. Pass clientId/clientName null for a staff-to-staff message
 * (there's no client behind it) — the row still gets a securely hosted download
 * link, it just won't appear in anyone's Documents list. Returns an error (not a
 * throw) on validation failure — the send still proceeds without a broken/
 * oversized attachment link.
 */
async function saveMessageAttachmentAsDocument(
  clientId: string | null, clientName: string | null, attachment: SendAttachment, uploadedBy: string
): Promise<{ fileUrl: string } | { error: string }> {
  const mimeType = (attachment.contentType || "application/octet-stream").toLowerCase();
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(mimeType)) return { error: `unsupported file type (${mimeType})` };
  const sizeBytes = Math.ceil((attachment.contentBase64.length * 3) / 4);
  if (sizeBytes > MAX_UPLOAD_BYTES) return { error: "attachment too large" };

  // client_id is nullable — a staff-to-staff message has no client behind it at all,
  // so this is stored as a client-less document purely to get a secure hosted
  // download link; it won't appear in anyone's Documents list, only via this direct URL.
  const uploadId = `DOC-${docUploadIdSuffix()}`;
  const fileUrl = `/documents/uploads/${uploadId}/download`;
  await query(
    `INSERT INTO altax.v3_document_uploads
       (upload_id, request_id, task_id, client_id, client_name, file_name, file_url, file_data, mime_type, file_size,
        uploaded_by, uploaded_at, direction, status, notes, hidden_from_client, source_system, source_record_id)
     VALUES ($1,NULL,NULL,$2,$3,$4,$5,$6,$7,$8,$9,now(),'Firm to Client','Uploaded',$10,$11,'Node Web App Message',$1)`,
    [uploadId, clientId, clientName, attachment.filename, fileUrl, attachment.contentBase64, mimeType, sizeBytes, uploadedBy,
      "Attached to a message.", !clientId]
  );
  return { fileUrl };
}

/**
 * SMS/WhatsApp bodies beyond this are the kind of thing that needs 8+ concatenated
 * segments even in plain English, and far more once Arabic forces UCS-2 encoding
 * (measured live: a real bilingual period-summary report ran ~2,500 characters —
 * 38 segments — well past what carriers reliably deliver in full). Short messages
 * (reminders, follow-ups) stay well under this and go out unchanged.
 */
const SMS_INLINE_MAX_CHARS = 400;

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

export interface SendAttachment { filename: string; contentBase64: string; contentType?: string }

const ARABIC_CHARS = /[؀-ۿݐ-ݿ]/;

/**
 * Turns a plain-text body into email HTML with correct per-section text direction —
 * previously every send just wrapped the whole string in one <p> with no dir/align at
 * all, so an Arabic section (e.g. the "Both" language preference's English-then-"---"
 * -then-Arabic merge from communicationBodyForPreference) rendered left-to-right, with
 * embedded dollar amounts scrambling the reading order. Splits on that exact "---"
 * divider and gives each resulting block its own dir="rtl"/"ltr" based on whether it's
 * actually Arabic text, rather than guessing from which language came first.
 */
function bodyToDirectionalHtml(body: string): string {
  const blocks = body.split(/\n\n---\n\n/);
  return blocks
    .map((block) => {
      const isArabic = ARABIC_CHARS.test(block);
      const html = block.trim().replace(/\n/g, "<br>");
      return isArabic
        ? `<div dir="rtl" style="direction:rtl; text-align:right; unicode-bidi:embed;">${html}</div>`
        : `<div dir="ltr" style="direction:ltr; text-align:left;">${html}</div>`;
    })
    .join('<hr style="border:none; border-top:1px solid #e5e7eb; margin:14px 0;">');
}

/**
 * Attempts a real send for Email/SMS/WhatsApp channels; Portal Note and Phone are
 * always log-only. Never throws — a missing provider key or a delivery failure is
 * reported back as { sent: false, error } rather than blocking the communication log
 * write, exactly like sendInviteEmail() in users.routes.ts.
 *
 * Email goes out through wrapEmailHtml — the same branded header/footer shell (firm
 * name + logo, styled body, firm contact info) every other outbound email in the app
 * already uses — instead of a bare <p> tag, and can carry one real attachment.
 * SMS/WhatsApp have no display-name concept at all (the client just sees a phone
 * number), so the firm's name is prefixed onto the body itself. Neither can carry a
 * real file (no MMS wired up) — when there's an attachment, the caller saves it as a
 * Document first (saveMessageAttachmentAsDocument) and passes the resulting
 * opts.documentUrl here, so the text can point straight at a real, secure download
 * link instead of silently dropping the file.
 */
async function sendChannel(
  channel: string, to: string, subject: string, body: string,
  opts: { req?: AuthedRequest; firmName?: string; attachment?: SendAttachment; viewUrl?: string; documentUrl?: string; portalUrl?: string } = {}
): Promise<{ sent: boolean; error?: string }> {
  const normalized = normalizeText(channel);
  if (!to || !["email", "sms", "whatsapp"].includes(normalized)) return { sent: false };
  try {
    if (normalized === "email") {
      const html = await wrapEmailHtml(bodyToDirectionalHtml(body), opts.req);
      const attachments = opts.attachment
        ? [{ filename: opts.attachment.filename, content: Buffer.from(opts.attachment.contentBase64, "base64"), contentType: opts.attachment.contentType }]
        : undefined;
      await sendEmail({ to, subject, html, attachments });
    } else {
      const firmName = opts.firmName || "AL Tax Service";
      // Long bodies (a full bilingual report) can't fit SMS/WhatsApp in a readable
      // number of segments — send a short pointer to the public view page instead
      // of the whole text. Short messages (reminders, follow-ups) are unaffected.
      let effectiveBody = body.length > SMS_INLINE_MAX_CHARS && opts.viewUrl
        ? `${subject}. View / اطّلع على الرسالة: ${opts.viewUrl}`
        : body;
      // A file can't ride inside SMS/WhatsApp text regardless of length — offer both
      // a direct secure download link and the option to log into the client portal,
      // rather than dropping the attachment with no trace of it ever existing.
      if (opts.documentUrl) {
        effectiveBody += ` Attachment: ${opts.documentUrl}`;
        if (opts.portalUrl) effectiveBody += ` Or view it securely in your client portal: ${opts.portalUrl}`;
      }
      const prefixed = `${firmName}: ${effectiveBody}`;
      if (normalized === "sms") await sendSms({ to, body: prefixed });
      else await sendWhatsApp({ to, body: prefixed });
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

  const firmName = (await getFirmProfile()).firmName;
  const base = publicBaseUrl(req);
  const shareToken = sendNow && base && ["email", "sms", "whatsapp"].includes(normalizeText(channel)) ? generateShareToken() : null;
  const viewUrl = shareToken ? `${base}/public/message/${shareToken}` : undefined;
  // SMS/WhatsApp can't carry the real attachment inline — save it as a Document
  // first so the send can point at a real, secure download link instead of
  // silently dropping the file.
  let documentUrl: string | undefined;
  if (body.attachment && ["sms", "whatsapp"].includes(normalizeText(channel)) && sendNow) {
    const saved = await saveMessageAttachmentAsDocument(client.client_id, client.client_name, body.attachment, req.user!.email);
    if ("fileUrl" in saved && base) documentUrl = `${base}${saved.fileUrl}`;
  }
  const portalUrl = base ? `${base}/login/client` : undefined;
  const result = sendNow ? await sendChannel(channel, sentTo, subject, previewBody, { req, firmName, attachment: body.attachment, viewUrl, documentUrl, portalUrl: documentUrl ? portalUrl : undefined }) : { sent: false };
  const status = result.sent ? "Saved + Sent" : result.error ? `Saved — ${result.error}` : "Saved";

  await query(
    `INSERT INTO altax.v3_communications
       (communication_id, client_id, client_name, related_task_id, direction, channel, subject,
        message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id, share_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),$12,$13,$1,$14)`,
    [
      communicationId, client.client_id, client.client_name, String(body.relatedTaskId || "").trim() || null,
      direction, channel, subject, messageEnglish, messageArabic, sentTo || null, req.user!.email, status,
      String(body.sourceSystem || "Node Web App").trim(), shareToken,
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

  const firmName = (await getFirmProfile()).firmName;
  const base = publicBaseUrl(req);
  let documentUrl: string | undefined;
  if (body.attachment && ["sms", "whatsapp"].includes(normalizeText(channel)) && sendNow) {
    const saved = await saveMessageAttachmentAsDocument(null, null, body.attachment, req.user!.email);
    if ("fileUrl" in saved && base) documentUrl = `${base}${saved.fileUrl}`;
  }
  const result = sendNow ? await sendChannel(channel, sentTo, subject, messageText, { req, firmName, attachment: body.attachment, documentUrl }) : { sent: false };
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

/**
 * Bulk staff blast — same message to many staff/admin users in one action, mirroring
 * POST /communications/bulk below for clients. No consent gate here (unlike the client
 * version): internal team messaging isn't subject to A2P/marketing opt-in rules, so
 * every active admin/staff recipient with a usable address for the channel is sent to.
 */
communicationsRouter.post("/staff/bulk", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const recipientEmails: string[] = Array.isArray(body.recipientEmails)
    ? Array.from(new Set(body.recipientEmails.map((e: any) => String(e).trim()).filter(Boolean)))
    : [];
  if (recipientEmails.length === 0) return res.status(400).json({ error: "Select at least one staff recipient." });

  const channels: string[] = Array.isArray(body.channels) ? body.channels : [];
  if (channels.length === 0) return res.status(400).json({ error: "Choose at least one channel." });

  const subject = String(body.subject || "Firm staff message").trim();
  const messageText = String(body.messageEnglish || body.message || subject || "").trim();
  if (!messageText) return res.status(400).json({ error: "Enter a staff message." });
  const sendNow = body.sendNow === undefined ? true : Boolean(body.sendNow);
  const attachment: SendAttachment | undefined = body.attachment;
  const firmName = (await getFirmProfile()).firmName;
  const base = publicBaseUrl(req);

  const results: { email: string; name: string; channel: string; sent: boolean; skipped?: string; error?: string }[] = [];

  for (const email of recipientEmails) {
    const recipient = await queryOne<any>(
      `SELECT email, name, phone FROM altax.v3_users WHERE active = true AND lower(role) IN ('admin','staff') AND lower(email) = $1 LIMIT 1`,
      [normalizeText(email)]
    );
    if (!recipient) {
      results.push({ email, name: email, channel: "-", sent: false, skipped: "Not an active staff/admin user." });
      continue;
    }

    for (const channel of channels) {
      const normalized = normalizeText(channel);
      const sentTo = String((normalized === "sms" || normalized === "whatsapp") ? recipient.phone : recipient.email) || "";
      let skip = "";
      if (!sentTo) skip = normalized === "sms" || normalized === "whatsapp" ? "No phone on file." : "No email on file.";

      if (skip) {
        results.push({ email, name: recipient.name, channel, sent: false, skipped: skip });
        continue;
      }

      let documentUrl: string | undefined;
      if (attachment && (normalized === "sms" || normalized === "whatsapp") && sendNow) {
        const saved = await saveMessageAttachmentAsDocument(null, null, attachment, req.user!.email);
        if ("fileUrl" in saved && base) documentUrl = `${base}${saved.fileUrl}`;
      }
      const result = sendNow ? await sendChannel(channel, sentTo, subject, messageText, { req, firmName, attachment, documentUrl }) : { sent: false };
      const status = result.sent ? "Saved + Sent" : result.error ? `Saved — ${result.error}` : "Saved";
      const communicationId = nextCommunicationId();
      await query(
        `INSERT INTO altax.v3_communications
           (communication_id, client_id, client_name, related_task_id, direction, channel, subject,
            message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id)
         VALUES ($1,NULL,NULL,NULL,'Staff to Staff',$2,$3,$4,NULL,$5,$6,now(),$7,'Node Web App Bulk Staff',$1)`,
        [communicationId, channel, subject, messageText, sentTo, req.user!.email, status]
      );
      results.push({ email, name: recipient.name, channel, sent: result.sent, error: result.error });
    }
  }

  await logAudit("Communications", "BULK_STAFF_MESSAGE", "", "", "", `${recipientEmails.length} staff`,
    `Bulk staff message sent by ${req.user!.email} to ${recipientEmails.length} recipient(s) via ${channels.join(", ")}.`, req.user!.email);

  res.json({ ok: true, results });
}));

/**
 * Bulk client blast — send/save the same message to many clients in one action, so
 * staff aren't stuck opening each client one at a time. Each client is still checked
 * individually: canAccessClient (a staff member can't blast clients outside their
 * assignment) and, for SMS/WhatsApp, sms_allowed — and for Email, email_allowed — so a
 * bulk send can never reach someone who hasn't opted in. That consent gate matters
 * beyond courtesy: the whole point of the A2P 10DLC campaign approval is that Twilio/
 * carriers trust every SMS this account sends is opt-in, and a bulk tool is exactly
 * where a real accidental mass-send-to-everyone mistake would happen. Skipped clients
 * are reported back with a reason, never silently dropped.
 */
communicationsRouter.post("/bulk", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const clientIds: string[] = Array.isArray(body.clientIds)
    ? Array.from(new Set(body.clientIds.map((id: any) => String(id).trim()).filter(Boolean)))
    : [];
  if (clientIds.length === 0) return res.status(400).json({ error: "Select at least one client." });

  const channels: string[] = Array.isArray(body.channels) ? body.channels : [];
  if (channels.length === 0) return res.status(400).json({ error: "Choose at least one channel." });

  const rawSubject = String(body.subject || "AL TAX SERVICE").trim();
  const rawMessageEnglish = String(body.messageEnglish || "").trim();
  const rawMessageArabic = String(body.messageArabic || "").trim();
  const templateName = String(body.templateName || "").trim();
  const periodStart = String(body.periodStart || "").trim();
  const periodEnd = String(body.periodEnd || "").trim();
  if (!templateName && !rawMessageEnglish && !rawMessageArabic) return res.status(400).json({ error: "Enter a message." });
  const sendNow = body.sendNow === undefined ? true : Boolean(body.sendNow);
  const attachment: SendAttachment | undefined = body.attachment;
  const firmName = (await getFirmProfile()).firmName;
  const base = publicBaseUrl(req);

  const results: { clientId: string; clientName: string; channel: string; sent: boolean; skipped?: string; error?: string }[] = [];

  for (const clientId of clientIds) {
    if (!(await canAccessClient(req.user!, clientId))) {
      results.push({ clientId, clientName: clientId, channel: "-", sent: false, skipped: "You do not have access to this client." });
      continue;
    }
    const client = await queryOne<any>(
      `SELECT client_id, client_name, email, phone, sms_allowed, email_allowed, preferred_language FROM altax.v3_clients WHERE client_id = $1`,
      [clientId]
    );
    if (!client) {
      results.push({ clientId, clientName: clientId, channel: "-", sent: false, skipped: "Client not found." });
      continue;
    }

    // Every recipient gets their own resolved text, not the same literal string —
    // {{clientName}}, {{periodSummary}}, etc. are substituted per-client here (a named
    // template pulls the client's own real sales-tax/payroll numbers for the period;
    // free-typed text still gets {{clientName}}-style tokens resolved) so a bulk send
    // reads as personalized mail-merge, not a form letter with literal placeholders.
    let subject = rawSubject;
    let messageEnglish = rawMessageEnglish;
    let messageArabic = rawMessageArabic;
    if (templateName) {
      const resolved = await resolveTemplate(templateName, clientId, periodStart, periodEnd);
      if (resolved) {
        subject = resolved.subject;
        messageEnglish = resolved.message_english;
        messageArabic = resolved.message_arabic;
      }
    } else {
      const extra: Record<string, string> = {};
      const usesPeriodSummary = [subject, messageEnglish, messageArabic].some((t) => t.includes("{{periodSummary}}"));
      const usesPeriodSummaryAr = [subject, messageEnglish, messageArabic].some((t) => t.includes("{{periodSummaryAr}}"));
      if (periodStart && periodEnd) {
        extra.periodLabel = ` for ${periodStart} - ${periodEnd}`;
        extra.periodLabelAr = ` للفترة من ${periodStart} إلى ${periodEnd}`;
        // Only queried when the free-typed text actually uses the token — computing it for
        // every recipient regardless would be a wasted sales/payroll query per client on
        // every bulk send that sets a period but doesn't reference it.
        if (usesPeriodSummary) extra.periodSummary = await computeClientPeriodSummary(clientId, periodStart, periodEnd);
        if (usesPeriodSummaryAr) extra.periodSummaryAr = await computeClientPeriodSummaryArabic(clientId, periodStart, periodEnd);
      }
      subject = substitutePlaceholders(subject, client, extra);
      messageEnglish = substitutePlaceholders(messageEnglish, client, extra);
      messageArabic = substitutePlaceholders(messageArabic, client, extra);
    }

    const previewBody = communicationBodyForPreference(messageEnglish, messageArabic, subject, body.languagePreference || client.preferred_language);

    for (const channel of channels) {
      const normalized = normalizeText(channel);
      let sentTo = "";
      let skip = "";
      if (normalized === "email") {
        sentTo = client.email || "";
        if (!sentTo) skip = "No email on file.";
        else if (!client.email_allowed) skip = "Client has not opted in to email.";
      } else if (normalized === "sms" || normalized === "whatsapp") {
        sentTo = client.phone || "";
        if (!sentTo) skip = "No phone on file.";
        else if (!client.sms_allowed) skip = "Client has not opted in to SMS/WhatsApp.";
      } else {
        skip = `"${channel}" isn't supported for bulk send — use Portal Note individually if needed.`;
      }

      if (skip) {
        results.push({ clientId, clientName: client.client_name, channel, sent: false, skipped: skip });
        continue;
      }

      const communicationId = nextCommunicationId();
      const shareToken = sendNow && base ? generateShareToken() : null;
      const viewUrl = shareToken ? `${base}/public/message/${shareToken}` : undefined;
      let documentUrl: string | undefined;
      if (attachment && (normalized === "sms" || normalized === "whatsapp") && sendNow) {
        const saved = await saveMessageAttachmentAsDocument(client.client_id, client.client_name, attachment, req.user!.email);
        if ("fileUrl" in saved && base) documentUrl = `${base}${saved.fileUrl}`;
      }
      const portalUrl = documentUrl && base ? `${base}/login/client` : undefined;
      const result = sendNow ? await sendChannel(channel, sentTo, subject, previewBody, { req, firmName, attachment, viewUrl, documentUrl, portalUrl }) : { sent: false };
      const status = result.sent ? "Saved + Sent" : result.error ? `Saved — ${result.error}` : "Saved";
      await query(
        `INSERT INTO altax.v3_communications
           (communication_id, client_id, client_name, related_task_id, direction, channel, subject,
            message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id, share_token)
         VALUES ($1,$2,$3,NULL,'Outbound',$4,$5,$6,$7,$8,$9,now(),$10,'Node Web App Bulk',$1,$11)`,
        [communicationId, client.client_id, client.client_name, channel, subject, messageEnglish || null, messageArabic || null, sentTo, req.user!.email, status, shareToken]
      );
      results.push({ clientId, clientName: client.client_name, channel, sent: result.sent, error: result.error });
    }
  }

  await logAudit("Communications", "BULK_SEND", "", "", "", `${clientIds.length} client(s)`,
    `Bulk message sent by ${req.user!.email} to ${clientIds.length} client(s) via ${channels.join(", ")}.`, req.user!.email);

  res.json({ ok: true, results });
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
