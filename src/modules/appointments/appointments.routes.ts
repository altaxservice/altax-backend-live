import crypto from "crypto";
import { Router, Request, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { sendEmail, sendSms, NotConfiguredError } from "../../common/notifications";
import { wrapEmailHtml } from "../../common/emailTemplate";
import { resolveTemplate } from "../templates/templates.routes";
import { publicBaseUrl } from "../../common/publicUrl";
import { getAppointmentSettings, bookableWeekdayLabel, REMINDER_LEAD_PRESETS, type StaffReminderChannel } from "../../common/appointmentSettings";
import { escapeHtml } from "../../common/html";

/**
 * Appointment scheduling on the Calendar page — a standalone, self-contained
 * scheduler (workspace-style: book anyone, existing client or a brand-new
 * contact, with email+SMS confirmation and an automatic day-before reminder).
 * Real Google Calendar sync is a later, separate add-on once a Google Cloud
 * OAuth app exists for this account; nothing here depends on it.
 *
 * Firm-wide, like a shared team calendar — every admin/staff member sees every
 * appointment (not scoped per-assignee the way Tasks is), since the point is
 * one place to see who on the team is booked when.
 */
export const appointmentsRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

export interface CreateAppointmentInput {
  title: string;
  clientId?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  startTime: string;
  endTime: string;
  location?: string | null;
  notes?: string | null;
  assignedTo?: string | null;
  notifyClient?: boolean;
  createdBy: string;
  /** Informational snapshot of which Appointment Type this was booked as — see sql/036_appointment_types.sql. Both null for an appointment with no type (e.g. most internal staff-created ones, or before this feature existed). */
  appointmentTypeId?: string | null;
  appointmentTypeName?: string | null;
  /** Skips the confirmation send (still creates + logs) — used when a caller wants to send it separately. */
  req?: Request;
}

/**
 * Shared appointment-creation logic — used by the internal staff "+ New
 * Appointment" route below AND the public self-service booking form
 * (publicAppointments.routes.ts), so both entry points create the exact same
 * kind of row, get the exact same email/SMS confirmation, and show up on the
 * one shared staff Calendar. A client match by email (best-effort, only when
 * exactly one client has that email on file) lets a public booking from an
 * existing client still land tagged to their record instead of a bare contact.
 */
/**
 * Whether `assignedTo` matches a real, currently-active admin/staff account
 * (by name, email, or user_id — same alias matching notifyStaffAssigned uses
 * to find who to notify). A typo or a since-removed name would otherwise be
 * accepted silently, and that appointment would never notify anyone of its
 * assignment — this catches it at write time instead.
 */
async function isActiveStaffAssignee(assignedTo: string): Promise<boolean> {
  const match = await queryOne<any>(
    `SELECT 1 FROM altax.v3_users
      WHERE coalesce(active, true) AND lower(role) IN ('admin', 'staff')
        AND (lower(email) = lower($1) OR lower(name) = lower($1) OR lower(user_id) = lower($1))`,
    [assignedTo]
  );
  return !!match;
}

export async function createAppointment(input: CreateAppointmentInput): Promise<{ appointmentId: string }> {
  const title = input.title.trim();
  if (!title) throw new Error("Title is required.");
  if (!input.startTime || !input.endTime) throw new Error("Start and end time are required.");
  if (new Date(input.endTime) < new Date(input.startTime)) throw new Error("End time can't be before start time.");
  const assignedTo = input.assignedTo?.trim() || null;
  if (assignedTo && !(await isActiveStaffAssignee(assignedTo))) {
    throw new Error(`"${assignedTo}" doesn't match an active staff/admin account — pick from the list.`);
  }

  let clientId = input.clientId || null;
  let contactName = input.contactName?.trim() || null;
  let contactEmail = input.contactEmail?.trim() || null;
  let contactPhone = input.contactPhone?.trim() || null;

  let client: any = null;
  if (clientId) {
    client = await queryOne<any>(`SELECT client_id, client_name, email, phone FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
    if (!client) throw new Error("Client not found.");
  } else if (contactEmail) {
    const matches = await query<any>(`SELECT client_id, client_name, email, phone FROM altax.v3_clients WHERE lower(email) = lower($1)`, [contactEmail]);
    if (matches.length === 1) { client = matches[0]; clientId = client.client_id; }
  }
  if (client) {
    if (!contactName) contactName = client.client_name;
    if (!contactEmail) contactEmail = client.email || null;
    if (!contactPhone) contactPhone = client.phone || null;
  }

  const notifyClient = input.notifyClient !== false;
  const appointmentId = `APT-${idSuffix()}`;
  const manageToken = crypto.randomBytes(24).toString("hex");
  await query(
    `INSERT INTO altax.v3_appointments
       (appointment_id, title, client_id, contact_name, contact_email, contact_phone,
        start_time, end_time, location, notes, assigned_to, status, notify_client, created_by, manage_token,
        appointment_type_id, appointment_type_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Scheduled',$12,$13,$14,$15,$16)`,
    [appointmentId, title, clientId, contactName, contactEmail, contactPhone,
      input.startTime, input.endTime, input.location?.trim() || null, input.notes?.trim() || null,
      assignedTo, notifyClient, input.createdBy, manageToken,
      input.appointmentTypeId || null, input.appointmentTypeName || null]
  );

  const appt = await queryOne<any>(`SELECT * FROM altax.v3_appointments WHERE appointment_id = $1`, [appointmentId]);
  if (notifyClient && appt) {
    await notifyAppointment({ ...appt, client_name: client?.client_name }, "Appointment Confirmation", input.createdBy, input.req);
  }
  // The staff-assignment heads-up (notifyStaffAssigned, below) previously only
  // fired when an EXISTING appointment got reassigned via PATCH — a brand new
  // appointment created with assignedTo already set (the normal "+ New
  // Appointment" flow) got no immediate notice at all, so the assignee never
  // knew until the next reminder sweep, if the appointment was even inside its
  // lead-time window yet.
  if (appt?.assigned_to) {
    await notifyStaffAssigned({ ...appt, client_name: client?.client_name }, input.req);
  }

  await logAudit("Calendar", "CREATE_APPOINTMENT", appointmentId, "", "", title,
    `Appointment "${title}" scheduled by ${input.createdBy}.`, input.createdBy);

  return { appointmentId };
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" });
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
}

export type AppointmentNoticeType = "Appointment Confirmation" | "Appointment Reminder" | "Appointment Cancelled";

/**
 * Builds the full bilingual PLAIN-TEXT body for logging/display (the
 * Communications page renders v3_communications.message_english/arabic as
 * plain text, white-space:pre-wrap — see CommunicationsPage.tsx) and for
 * SMS. Includes, for Confirmation/Reminder only (a cancellation notice
 * doesn't need re-stating the policy), the duration/weekly-schedule line,
 * office location+map link, and the admin-edited policy text from Calendar
 * Settings, then the manage-appointment link.
 */
function buildAppointmentPlainText(
  resolved: { message_english: string; message_arabic: string },
  includeDetails: boolean, manageUrl: string,
  settings: Awaited<ReturnType<typeof getAppointmentSettings>> | null,
  durationMinutes: number
): { english: string; arabic: string } {
  if (!includeDetails || !settings) {
    return { english: resolved.message_english, arabic: resolved.message_arabic };
  }
  const english = [
    resolved.message_english,
    `${durationMinutes} min appointment — available weekly on ${bookableWeekdayLabel(settings, "en")}`,
    `${settings.locationName}, ${settings.locationAddress}`,
    settings.locationMapUrl || "",
    "",
    settings.policyMessageEn,
    manageUrl ? `\nNeed to cancel or reschedule? ${manageUrl}` : "",
  ].filter(Boolean).join("\n");

  const arabic = [
    resolved.message_arabic,
    `مدة الموعد ${durationMinutes} دقيقة — متاح أسبوعيًا أيام ${bookableWeekdayLabel(settings, "ar")}`,
    `${settings.locationName}, ${settings.locationAddress}`,
    settings.locationMapUrl || "",
    "",
    settings.policyMessageAr,
    manageUrl ? `\nهل تحتاج لإلغاء الموعد أو إعادة جدولته؟ ${manageUrl}` : "",
  ].filter(Boolean).join("\n");

  return { english, arabic };
}

/**
 * Builds the actual HTML sent in the email — real structure (not the plain-text
 * blob run through bodyToDirectionalHtml) so the office address/map link, which
 * are Latin-script data, don't get visually reordered by the browser's bidi
 * algorithm when they'd otherwise sit inside a dir="rtl" paragraph. Every
 * Latin-script run inside the Arabic section is wrapped in <bdi dir="ltr">,
 * which isolates it from the surrounding RTL context. Shown once (not
 * duplicated per language) since an address/map link doesn't translate.
 */
export function buildAppointmentEmailHtml(
  resolved: { message_english: string; message_arabic: string },
  includeDetails: boolean, manageUrl: string,
  settings: Awaited<ReturnType<typeof getAppointmentSettings>> | null,
  durationMinutes: number
): string {
  const englishHtml = escapeHtml(resolved.message_english).replace(/\n/g, "<br>");
  const arabicHtml = escapeHtml(resolved.message_arabic).replace(/\n/g, "<br>");

  let detailsHtml = "";
  if (includeDetails && settings) {
    const mapLink = settings.locationMapUrl
      ? `<br><a href="${escapeHtml(settings.locationMapUrl)}" dir="ltr" style="color:#0f2d3e;">${escapeHtml(settings.locationMapUrl)}</a>`
      : "";
    detailsHtml = `
      <div style="margin:18px 0; padding:16px 0; border-top:1px solid #e5e7eb; border-bottom:1px solid #e5e7eb; text-align:center;">
        <div style="font-weight:700;">${durationMinutes} min appointment</div>
        <div style="color:#6b7280; font-size:12.5px; margin-top:3px;">
          <bdi dir="ltr">${escapeHtml(bookableWeekdayLabel(settings, "en"))}</bdi>
          &nbsp;/&nbsp;
          <bdi dir="rtl">${escapeHtml(bookableWeekdayLabel(settings, "ar"))}</bdi>
        </div>
        <div style="margin-top:10px; font-size:13.5px;">
          <bdi dir="ltr">${escapeHtml(settings.locationName)}</bdi><br>
          <bdi dir="ltr">${escapeHtml(settings.locationAddress)}</bdi>
          ${mapLink}
        </div>
      </div>
      <div dir="ltr" style="text-align:left; margin-bottom:14px;">${escapeHtml(settings.policyMessageEn).replace(/\n/g, "<br>")}</div>
      <div dir="rtl" style="text-align:right; margin-bottom:14px;">${escapeHtml(settings.policyMessageAr).replace(/\n/g, "<br>")}</div>
    `;
  }

  const manageHtml = manageUrl
    ? `<div style="text-align:center; margin-top:16px;">
         <a href="${escapeHtml(manageUrl)}" style="display:inline-block; background:#0f2d3e; color:#ffffff; padding:10px 18px; border-radius:6px; text-decoration:none; font-size:13.5px;">
           Cancel / Reschedule &nbsp;·&nbsp; <bdi dir="rtl">إلغاء أو إعادة جدولة</bdi>
         </a>
       </div>`
    : "";

  return `
    <div dir="ltr" style="text-align:left;">${englishHtml}</div>
    <hr style="border:none; border-top:1px solid #e5e7eb; margin:16px 0;">
    <div dir="rtl" style="text-align:right;">${arabicHtml}</div>
    ${detailsHtml}
    ${manageHtml}
  `;
}

/**
 * Sends the confirmation, reminder, or cancellation email/SMS for an appointment
 * and logs it to v3_communications (source_system='Appointments'), matching
 * reminders.routes.ts's sendAndLog convention — attempt the real send, but
 * always write the log row so the client's Communications history has a
 * record even if the send itself failed (e.g. email not configured yet in
 * this environment). Exported so the public cancel/reschedule flow
 * (publicAppointments.routes.ts) can send the same kind of notice.
 */
export async function notifyAppointment(appt: any, templateName: AppointmentNoticeType, actorEmail: string, req?: Request): Promise<void> {
  const email = appt.contact_email || null;
  const phone = appt.contact_phone || null;
  if (!email && !phone) return;

  const start = new Date(appt.start_time);
  const extra: Record<string, string> = {
    appointmentTitle: appt.title || "",
    appointmentDate: fmtDate(start),
    appointmentTime: fmtTime(start),
    appointmentLocation: appt.location ? ` at ${appt.location}` : "",
    appointmentLocationAr: appt.location ? ` في ${appt.location}` : "",
    clientName: appt.contact_name || appt.client_name || "",
  };
  const resolvedTemplate = await resolveTemplate(templateName, appt.client_id || "", "", "", extra);
  if (!resolvedTemplate) return;
  const includeDetails = templateName !== "Appointment Cancelled";
  const base = publicBaseUrl(req);
  const manageUrl = base && appt.manage_token ? `${base}/manage-appointment?token=${appt.manage_token}` : "";
  const settings = includeDetails ? await getAppointmentSettings() : null;
  const durationMinutes = Math.round((new Date(appt.end_time).getTime() - new Date(appt.start_time).getTime()) / 60000);
  const plainText = buildAppointmentPlainText(resolvedTemplate, includeDetails, manageUrl, settings, durationMinutes);

  const marker = templateName === "Appointment Reminder" ? "REM" : templateName === "Appointment Cancelled" ? "CANCEL" : "CONF";
  const channels: { channel: "Email" | "SMS"; to: string }[] = [];
  if (email) channels.push({ channel: "Email", to: email });
  if (phone) channels.push({ channel: "SMS", to: phone });

  // Logged as one row per channel actually attempted — matches every other send
  // path in this app (Communications, reminders), so a failed SMS doesn't get
  // silently masked by a successful email in the same log entry.
  for (const { channel, to } of channels) {
    let sent = false;
    let sendError: string | undefined;
    try {
      if (channel === "Email") {
        const html = buildAppointmentEmailHtml(resolvedTemplate, includeDetails, manageUrl, settings, durationMinutes);
        await sendEmail({ to, subject: resolvedTemplate.subject, html: await wrapEmailHtml(html, req) });
      } else {
        // SMS stays short — the full policy/location text only goes in the email (see
        // SMS_INLINE_MAX_CHARS convention in communications.routes.ts) — but the manage
        // link still goes out here too, since that's how an SMS/WhatsApp recipient
        // actually cancels or reschedules without calling the office.
        const smsBody = manageUrl ? `${resolvedTemplate.message_english} Manage: ${manageUrl}` : resolvedTemplate.message_english;
        await sendSms({ to, body: `AL TAX SERVICE: ${smsBody}` });
      }
      sent = true;
    } catch (err: any) {
      sendError = err instanceof NotConfiguredError ? err.message : (err?.message || "Send failed.");
    }
    const status = sent ? "Saved + Sent" : sendError ? `Saved — ${sendError}` : "Saved";
    await query(
      `INSERT INTO altax.v3_communications
         (communication_id, client_id, client_name, direction, channel, subject,
          message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id)
       VALUES ($1,$2,$3,'Outbound',$4,$5,$6,$7,$8,$9,now(),$10,'Appointments',$11)`,
      [`COM-${idSuffix()}`, appt.client_id || null, appt.contact_name || appt.client_name || null,
        channel, resolvedTemplate.subject, plainText.english, plainText.arabic,
        to, actorEmail, status, `APPT-${marker}-${appt.appointment_id}-${channel}`]
    );
  }
}

function leadLabel(minutes: number): string {
  return REMINDER_LEAD_PRESETS.find((p) => p.minutes === minutes)?.label || `${minutes} minutes before`;
}

/**
 * Internal heads-up to the assigned staff member, the staff member who
 * created the appointment (even if it's unassigned or assigned to someone
 * else), and every admin, at the same lead times configured for the client
 * reminder below — not just the daily digest's fixed 48-hour lookahead.
 * Channel (email/SMS/both) is the admin's
 * Calendar Settings choice (staffReminderChannel) — SMS only goes to whoever
 * actually has a phone on file in v3_users, same "best-effort, skip what's
 * missing" approach as email. Not routed through the template system or
 * logged to v3_communications (that log is for client-facing correspondence
 * only); each send is independently best-effort, same never-block-the-sweep
 * pattern as every other send in this file.
 */
async function resolveStaffRecipients(appt: any): Promise<Map<string, { email: string | null; phone: string | null }>> {
  const rows = await query<any>(
    `SELECT email, phone FROM altax.v3_users
      WHERE coalesce(active, true)
        AND (lower(role) = 'admin' OR lower(email) = lower($1) OR lower(name) = lower($1) OR lower(user_id) = lower($1) OR lower(email) = lower($2))`,
    [appt.assigned_to || "", appt.created_by || ""]
  );
  const recipients = new Map<string, { email: string | null; phone: string | null }>();
  for (const r of rows) {
    const key = String(r.email || r.phone || "").toLowerCase();
    if (!key) continue;
    recipients.set(key, { email: r.email || null, phone: r.phone || null });
  }
  return recipients;
}

/**
 * Immediate "you've been assigned this appointment" heads-up — fired once,
 * right when a reassignment happens, unlike notifyAppointmentStaff's lead-time
 * reminders below. Only the newly assigned staff member (looked up the same
 * alias-matching way as the reminder sweep), not every admin, since the point
 * is telling the one person whose calendar just changed, not a broadcast.
 */
async function notifyStaffAssigned(appt: any, req?: Request): Promise<void> {
  if (!appt.assigned_to) return;
  const rows = await query<any>(
    `SELECT email, phone FROM altax.v3_users
      WHERE coalesce(active, true)
        AND (lower(email) = lower($1) OR lower(name) = lower($1) OR lower(user_id) = lower($1))`,
    [appt.assigned_to]
  );
  const start = new Date(appt.start_time);
  const who = appt.contact_name || appt.client_name || "a contact";
  const subject = `You've been assigned: ${appt.title || "Appointment"} with ${who}`;
  const html = `<p>You've been assigned to <strong>${escapeHtml(appt.title || "Appointment")}</strong> with ${escapeHtml(who)}.</p>
    <p>${escapeHtml(fmtDate(start))} at ${escapeHtml(fmtTime(start))}${appt.location ? ` &middot; ${escapeHtml(appt.location)}` : ""}</p>`;
  const smsBody = `AL TAX SERVICE: You've been assigned — ${appt.title || "Appointment"} with ${who} on ${fmtDate(start)} at ${fmtTime(start)}${appt.location ? ` (${appt.location})` : ""}.`;

  const seen = new Set<string>();
  for (const r of rows) {
    const key = String(r.email || r.phone || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (r.email) {
      try { await sendEmail({ to: r.email, subject, html: await wrapEmailHtml(html, req) }); } catch { /* best-effort */ }
    }
    if (r.phone) {
      try { await sendSms({ to: r.phone, body: smsBody }); } catch { /* best-effort */ }
    }
  }
}

/**
 * Immediate heads-up to the assigned staff, the appointment's creator, and
 * every admin when an appointment's TIME changes or it's cancelled — whether
 * a client did it themselves via the public manage-appointment link, or
 * another staff member rescheduled it on their behalf. Previously only the
 * CLIENT got a confirmation either way (notifyAppointment); staff learned
 * about a changed or cancelled appointment only by happening to notice it on
 * their calendar, or not at all if it was outside the next reminder's lead
 * window. Distinct from notifyStaffAssigned (a NEW assignment) and
 * notifyAppointmentStaff below (the scheduled lead-time reminder) — this
 * fires once, right when the change lands. excludeIdentifier (an email) lets
 * the internal PATCH route skip notifying whichever staff member just made
 * the change themselves.
 */
export async function notifyStaffOfAppointmentChange(
  appt: any, kind: "Cancelled" | "Rescheduled", req?: Request, previousStartTime?: string, excludeIdentifier?: string
): Promise<void> {
  const recipients = await resolveStaffRecipients(appt);
  if (recipients.size === 0) return;
  const settings = await getAppointmentSettings();
  const who = appt.contact_name || appt.client_name || "a contact";
  const newStart = new Date(appt.start_time);
  const detailLine = kind === "Cancelled"
    ? `Was scheduled for ${fmtDate(newStart)} at ${fmtTime(newStart)}${appt.location ? ` · ${appt.location}` : ""}.`
    : previousStartTime
      ? `Moved from ${fmtDate(new Date(previousStartTime))} ${fmtTime(new Date(previousStartTime))} to ${fmtDate(newStart)} ${fmtTime(newStart)}${appt.location ? ` · ${appt.location}` : ""}.`
      : `New time: ${fmtDate(newStart)} at ${fmtTime(newStart)}${appt.location ? ` · ${appt.location}` : ""}.`;
  const label = kind === "Cancelled" ? "Client cancelled" : "Appointment rescheduled";
  const subject = `${label}: ${appt.title || "Appointment"} with ${who}`;
  const html = `<p><strong>${escapeHtml(label)}</strong> — ${escapeHtml(appt.title || "Appointment")} with ${escapeHtml(who)}</p>
    <p>${escapeHtml(detailLine)}${appt.assigned_to ? ` &middot; Assigned to ${escapeHtml(appt.assigned_to)}` : ""}</p>`;
  const smsBody = `AL TAX SERVICE: ${label} — ${appt.title || "Appointment"} with ${who}. ${detailLine}`;

  const excludeLower = excludeIdentifier ? excludeIdentifier.toLowerCase() : null;
  for (const { email, phone } of recipients.values()) {
    if (excludeLower && email && email.toLowerCase() === excludeLower) continue;
    if ((settings.staffReminderChannel === "email" || settings.staffReminderChannel === "both") && email) {
      try { await sendEmail({ to: email, subject, html: await wrapEmailHtml(html, req) }); } catch { /* best-effort */ }
    }
    if ((settings.staffReminderChannel === "sms" || settings.staffReminderChannel === "both") && phone) {
      try { await sendSms({ to: phone, body: smsBody }); } catch { /* best-effort */ }
    }
  }
}

async function notifyAppointmentStaff(appt: any, leadMinutes: number, channel: StaffReminderChannel, req?: Request): Promise<void> {
  const recipients = await resolveStaffRecipients(appt);
  if (recipients.size === 0) return;

  const start = new Date(appt.start_time);
  const who = appt.contact_name || appt.client_name || "a contact";
  const lead = leadLabel(leadMinutes);
  const subject = `Reminder — ${lead}: ${appt.title || "Appointment"} with ${who}`;
  const html = `<p>${escapeHtml(lead)} — <strong>${escapeHtml(appt.title || "Appointment")}</strong></p>
    <p>${escapeHtml(who)}${appt.assigned_to ? ` &middot; Assigned to ${escapeHtml(appt.assigned_to)}` : ""}</p>
    <p>${escapeHtml(fmtDate(start))} at ${escapeHtml(fmtTime(start))}${appt.location ? ` &middot; ${escapeHtml(appt.location)}` : ""}</p>`;
  const smsBody = `AL TAX SERVICE: ${lead} — ${appt.title || "Appointment"} with ${who} on ${fmtDate(start)} at ${fmtTime(start)}${appt.location ? ` (${appt.location})` : ""}.`;

  for (const { email, phone } of recipients.values()) {
    if ((channel === "email" || channel === "both") && email) {
      try {
        await sendEmail({ to: email, subject, html: await wrapEmailHtml(html, req) });
      } catch {
        // best-effort — one recipient's failed send shouldn't block the others or the sweep
      }
    }
    if ((channel === "sms" || channel === "both") && phone) {
      try {
        await sendSms({ to: phone, body: smsBody });
      } catch {
        // best-effort, same as above
      }
    }
  }
}

/**
 * Sends every configured reminder (Calendar Settings' reminderLeadMinutes —
 * e.g. "1 day before", "1 hour before") for each Scheduled appointment that
 * has reached that lead time and hasn't gotten that specific one yet, tracked
 * per-appointment in reminder_lead_minutes_sent. Called hourly from
 * server.ts's cron, same "hourly sweep with an idempotency marker" shape as
 * the daily reminders job, just on appointments instead of tasks/documents/
 * invoices. The client-facing email/SMS (notifyAppointment) still respects
 * notify_client; the internal staff/admin heads-up (notifyAppointmentStaff)
 * fires regardless, since the team should know about an appointment even if
 * the client opted out of their own reminder.
 */
export async function runAppointmentReminders(actorEmail: string, req?: Request): Promise<{ sent: number; failed: number }> {
  const settings = await getAppointmentSettings();
  let sent = 0, failed = 0;

  for (const leadMinutes of settings.reminderLeadMinutes) {
    const target = new Date(Date.now() + leadMinutes * 60 * 1000);
    // A 2-hour-wide window centered on the target time, same margin the old
    // hardcoded day-before reminder used — wide enough that the hourly cron
    // can't step over an appointment's window between two runs.
    const windowStart = new Date(target.getTime() - 60 * 60 * 1000);
    const windowEnd = new Date(target.getTime() + 60 * 60 * 1000);
    const due = await query<any>(
      `SELECT a.*, c.client_name AS linked_client_name FROM altax.v3_appointments a
         LEFT JOIN altax.v3_clients c ON c.client_id = a.client_id
        WHERE a.status = 'Scheduled' AND a.start_time BETWEEN $1 AND $2
          AND NOT ($3 = ANY(a.reminder_lead_minutes_sent))`,
      [windowStart.toISOString(), windowEnd.toISOString(), leadMinutes]
    );
    for (const appt of due) {
      try {
        if (appt.notify_client) {
          await notifyAppointment({ ...appt, client_name: appt.linked_client_name }, "Appointment Reminder", actorEmail, req);
        }
        await notifyAppointmentStaff({ ...appt, client_name: appt.linked_client_name }, leadMinutes, settings.staffReminderChannel, req);
        await query(
          `UPDATE altax.v3_appointments SET reminder_lead_minutes_sent = array_append(reminder_lead_minutes_sent, $2) WHERE appointment_id = $1`,
          [appt.appointment_id, leadMinutes]
        );
        sent++;
      } catch {
        failed++;
      }
    }
  }
  return { sent, failed };
}

/**
 * A logged-in client's own upcoming (and recent past) appointments — the
 * client portal's only view into appointments before this route existed was
 * whatever confirmation/reminder email or text they'd received and kept;
 * losing that message meant calling the office to even know their own
 * appointment time. Read-only: the manage link (same one every confirmation/
 * reminder already includes) covers cancel/reschedule, so this doesn't need
 * its own separate write path. Scoped strictly to req.user.clientId — never
 * accepts a clientId from the client, so one client can't fetch another's.
 */
appointmentsRouter.get("/mine", requireAuth, requireRole("client"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = req.user!.clientId;
  if (!clientId) return res.json({ appointments: [] });
  const rows = await query<any>(
    `SELECT appointment_id, title, start_time, end_time, location, status, manage_token, appointment_type_name
       FROM altax.v3_appointments
      WHERE client_id = $1 AND status = 'Scheduled' AND end_time > now() - interval '1 day'
      ORDER BY start_time ASC`,
    [clientId]
  );
  const base = publicBaseUrl(req);
  res.json({
    appointments: rows.map((r: any) => ({
      appointmentId: r.appointment_id, title: r.title, startTime: r.start_time, endTime: r.end_time,
      location: r.location, status: r.status, appointmentTypeName: r.appointment_type_name,
      manageUrl: base && r.manage_token ? `${base}/manage-appointment?token=${r.manage_token}` : null,
    })),
  });
}));

appointmentsRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const start = String(req.query.start || "").trim();
  const end = String(req.query.end || "").trim();
  const params: any[] = [];
  let where = "";
  if (start && end) {
    where = `WHERE a.start_time < $2 AND a.end_time > $1`;
    params.push(start, end);
  }
  const rows = await query<any>(
    `SELECT a.*, c.client_name AS linked_client_name FROM altax.v3_appointments a
       LEFT JOIN altax.v3_clients c ON c.client_id = a.client_id
       ${where}
      ORDER BY a.start_time ASC`,
    params
  );
  res.json({ appointments: rows.map((r: any) => ({ ...r, client_name: r.linked_client_name || r.contact_name })) });
}));

appointmentsRouter.post("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  try {
    const { appointmentId } = await createAppointment({
      title: String(body.title || ""), clientId: String(body.clientId || "").trim() || null,
      contactName: body.contactName, contactEmail: body.contactEmail, contactPhone: body.contactPhone,
      startTime: String(body.startTime || ""), endTime: String(body.endTime || ""),
      location: body.location, notes: body.notes, assignedTo: body.assignedTo,
      appointmentTypeId: body.appointmentTypeId || null, appointmentTypeName: body.appointmentTypeName || null,
      notifyClient: body.notifyClient !== false, createdBy: req.user!.email, req,
    });
    res.status(201).json({ ok: true, appointmentId });
  } catch (err: any) {
    const notFound = err?.message === "Client not found.";
    res.status(notFound ? 404 : 400).json({ error: err?.message || "Could not create this appointment." });
  }
}));

appointmentsRouter.patch("/:appointmentId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { appointmentId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_appointments WHERE appointment_id = $1`, [appointmentId]);
  if (!existing) return res.status(404).json({ error: "Appointment not found." });

  const body = req.body || {};
  const title = body.title !== undefined ? String(body.title).trim() : existing.title;
  const startTime = body.startTime !== undefined ? String(body.startTime).trim() : existing.start_time;
  const endTime = body.endTime !== undefined ? String(body.endTime).trim() : existing.end_time;
  if (!title) return res.status(400).json({ error: "Title is required." });
  if (new Date(endTime) < new Date(startTime)) return res.status(400).json({ error: "End time can't be before start time." });

  // A reschedule (start_time changing) clears the sent-reminder tracking so
  // every configured reminder fires again for the new time rather than
  // silently never sending.
  const timeChanged = new Date(startTime).getTime() !== new Date(existing.start_time).getTime();
  const newAssignedTo = body.assignedTo !== undefined ? String(body.assignedTo).trim() || null : existing.assigned_to;
  const assignmentChanged = newAssignedTo !== existing.assigned_to;
  // Only validate when the assignment is actually changing to a new value —
  // an appointment already assigned to someone since made inactive (the
  // frontend's "(Inactive)" option) must still be editable for its OTHER
  // fields without being forced into a reassignment first.
  if (assignmentChanged && newAssignedTo && !(await isActiveStaffAssignee(newAssignedTo))) {
    return res.status(400).json({ error: `"${newAssignedTo}" doesn't match an active staff/admin account — pick from the list.` });
  }

  await query(
    `UPDATE altax.v3_appointments SET
       title = $2, start_time = $3, end_time = $4, location = $5, notes = $6, assigned_to = $7,
       notify_client = $8,
       reminder_sent_at = CASE WHEN $9 THEN NULL ELSE reminder_sent_at END,
       reminder_lead_minutes_sent = CASE WHEN $9 THEN '{}' ELSE reminder_lead_minutes_sent END,
       appointment_type_id = $10, appointment_type_name = $11,
       updated_at = now()
     WHERE appointment_id = $1`,
    [appointmentId, title, startTime, endTime,
      body.location !== undefined ? String(body.location).trim() || null : existing.location,
      body.notes !== undefined ? String(body.notes).trim() || null : existing.notes,
      body.assignedTo !== undefined ? String(body.assignedTo).trim() || null : existing.assigned_to,
      body.notifyClient !== undefined ? !!body.notifyClient : existing.notify_client,
      timeChanged,
      body.appointmentTypeId !== undefined ? String(body.appointmentTypeId).trim() || null : existing.appointment_type_id,
      body.appointmentTypeName !== undefined ? String(body.appointmentTypeName).trim() || null : existing.appointment_type_name]
  );

  if (timeChanged || assignmentChanged) {
    const updated = await queryOne<any>(
      `SELECT a.*, c.client_name AS linked_client_name FROM altax.v3_appointments a
         LEFT JOIN altax.v3_clients c ON c.client_id = a.client_id
        WHERE a.appointment_id = $1`,
      [appointmentId]
    );
    // A staff-initiated reschedule changes the time the client was told to
    // show up at — they need the same "here's your new time" notice a
    // self-service reschedule already sends, or they'll show up at the old slot.
    if (timeChanged && updated) {
      if (updated.notify_client) {
        await notifyAppointment({ ...updated, client_name: updated.linked_client_name }, "Appointment Confirmation", req.user!.email, req);
      }
      // Staff notification is independent of the client's own notify_client
      // preference — the assigned staff/admins need to know their calendar
      // changed regardless of whether the client opted into notifications.
      // Excludes whoever just made this edit — no need to notify yourself.
      await notifyStaffOfAppointmentChange(
        { ...updated, client_name: updated.linked_client_name }, "Rescheduled", req, existing.start_time, req.user!.email
      );
    }
    // A reassignment means someone new is now on the hook for this
    // appointment — give them the same immediate heads-up a brand-new
    // booking's assignee would've gotten, instead of them finding out at the
    // next reminder sweep (or not at all, if it's outside the lead window).
    if (assignmentChanged && newAssignedTo && updated) {
      await notifyStaffAssigned({ ...updated, client_name: updated.linked_client_name }, req);
    }
  }

  await logAudit("Calendar", "UPDATE_APPOINTMENT", appointmentId, "", "", title,
    `Appointment "${title}" updated by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

appointmentsRouter.post("/:appointmentId/cancel", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { appointmentId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_appointments WHERE appointment_id = $1`, [appointmentId]);
  if (!existing) return res.status(404).json({ error: "Appointment not found." });
  await query(`UPDATE altax.v3_appointments SET status = 'Cancelled', updated_at = now() WHERE appointment_id = $1`, [appointmentId]);

  if (existing.notify_client) {
    const client = existing.client_id
      ? await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [existing.client_id])
      : null;
    await notifyAppointment({ ...existing, client_name: client?.client_name }, "Appointment Cancelled", req.user!.email, req);
  }

  await logAudit("Calendar", "CANCEL_APPOINTMENT", appointmentId, "Status", existing.status, "Cancelled",
    `Appointment "${existing.title}" cancelled by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

appointmentsRouter.post("/:appointmentId/delete", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { appointmentId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_appointments WHERE appointment_id = $1`, [appointmentId]);
  if (!existing) return res.status(404).json({ error: "Appointment not found." });
  await query(`DELETE FROM altax.v3_appointments WHERE appointment_id = $1`, [appointmentId]);
  await logAudit("Calendar", "DELETE_APPOINTMENT", appointmentId, "", "", "",
    `Appointment "${existing.title}" deleted by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));
