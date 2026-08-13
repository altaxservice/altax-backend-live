import crypto from "crypto";
import { Router, Request, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit, logClientActivity } from "../../common/audit";
import { sendEmail, sendSms, NotConfiguredError, parseEmailList } from "../../common/notifications";
import { wrapEmailHtml } from "../../common/emailTemplate";
import { resolveTemplate } from "../templates/templates.routes";
import { publicBaseUrl } from "../../common/publicUrl";
import { getAppointmentSettings, bookableWeekdayLabel, REMINDER_LEAD_PRESETS, type StaffReminderChannel } from "../../common/appointmentSettings";
import { escapeHtml } from "../../common/html";
import { alertAdmins } from "../../common/adminAlerts";

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
  /** "Invite Others" — additional emails CC'd on the confirmation/reminder/cancellation sends, alongside the primary contact. Not a portal account or a real RSVP flow. */
  guestEmails?: string[] | null;
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
  const guestEmails = input.guestEmails?.length ? input.guestEmails : null;
  await query(
    `INSERT INTO altax.v3_appointments
       (appointment_id, title, client_id, contact_name, contact_email, contact_phone,
        start_time, end_time, location, notes, assigned_to, status, notify_client, created_by, manage_token,
        appointment_type_id, appointment_type_name, guest_emails)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Scheduled',$12,$13,$14,$15,$16,$17)`,
    [appointmentId, title, clientId, contactName, contactEmail, contactPhone,
      input.startTime, input.endTime, input.location?.trim() || null, input.notes?.trim() || null,
      assignedTo, notifyClient, input.createdBy, manageToken,
      input.appointmentTypeId || null, input.appointmentTypeName || null, guestEmails]
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
  if (clientId) {
    const when = appt ? `${fmtDate(new Date(appt.start_time))} at ${fmtTime(new Date(appt.start_time))}` : "";
    await logClientActivity(clientId, "Appointment Scheduled", `"${title}"${when ? ` — ${when}` : ""}.`, input.createdBy);
  }

  return { appointmentId };
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" });
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
}
/** Language-neutral month/day/weekday for the email's ticket-style date card — digits and a 3-letter month/weekday read fine unreversed inside either an LTR or RTL layout, so this doesn't need a bdi wrapper the way prose does. */
function fmtCardParts(d: Date): { month: string; day: string; weekday: string } {
  return {
    month: d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short" }).toUpperCase(),
    day: d.toLocaleDateString("en-US", { timeZone: "America/New_York", day: "numeric" }),
    weekday: d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" }).toUpperCase(),
  };
}

export type AppointmentNoticeType =
  | "Appointment Confirmation" | "Appointment Reminder" | "Appointment Cancelled"
  | "Appointment Confirmation Request" | "Appointment Rescheduled" | "Appointment Completed";

/** Fixed 24-hours-before lead time for the "please confirm" ask — deliberately
 * NOT part of the admin-editable REMINDER_LEAD_PRESETS list (no toggle; this
 * always fires), and tracked in its own v3_appointments column
 * (confirmation_request_sent_at) rather than reminder_lead_minutes_sent, since
 * 1440 (24h) is already a common value in that admin-configured array. */
export const CONFIRMATION_REQUEST_LEAD_MINUTES = 1440;

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
 *
 * Leads with a "ticket"-style date card (month/day/weekday + time, in the
 * brand's navy/gold) so the one thing a client actually needs at a glance —
 * when — doesn't have to be found inside a paragraph. Cancelled notices reuse
 * the same card in a muted gray with the time struck through, so it visually
 * reads as "this used to be your appointment" rather than looking identical
 * to a confirmation.
 */
export function buildAppointmentEmailHtml(
  resolved: { message_english: string; message_arabic: string },
  includeDetails: boolean, manageUrl: string,
  settings: Awaited<ReturnType<typeof getAppointmentSettings>> | null,
  durationMinutes: number,
  hero: { title: string; startDate: Date; noticeType: AppointmentNoticeType; bookUrl: string }
): string {
  const englishHtml = escapeHtml(resolved.message_english).replace(/\n/g, "<br>");
  const arabicHtml = escapeHtml(resolved.message_arabic).replace(/\n/g, "<br>");
  const isCancelled = hero.noticeType === "Appointment Cancelled";
  const isCompleted = hero.noticeType === "Appointment Completed";
  const isPastState = isCancelled || isCompleted;
  const { month, day, weekday } = fmtCardParts(hero.startDate);

  const cardBg = isPastState ? "#5b6570" : "#0f2d3e";
  const cardDateBg = isPastState ? "#4a5560" : "#0a2029";
  const cancelledBadge = isCancelled
    ? `<span style="display:inline-block; margin-left:8px; padding:2px 9px; border:1px solid rgba(255,255,255,0.45); border-radius:999px; color:#ffffff; font-size:10px; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; vertical-align:middle;">Cancelled</span>`
    : isCompleted
    ? `<span style="display:inline-block; margin-left:8px; padding:2px 9px; border:1px solid rgba(255,255,255,0.45); border-radius:999px; color:#ffffff; font-size:10px; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; vertical-align:middle;">Completed</span>`
    : "";
  const dateCard = `
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; margin:2px 0 22px; border-collapse:separate;">
      <tr>
        <td style="background:${cardBg}; border-radius:10px; overflow:hidden;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
            <tr>
              <td style="width:82px; background:${cardDateBg}; padding:16px 6px; text-align:center; vertical-align:middle;">
                <div style="color:#c9a86a; font-size:11px; font-weight:700; letter-spacing:0.08em;">${month}</div>
                <div style="color:#ffffff; font-size:28px; font-weight:800; line-height:1.15;">${day}</div>
                <div style="color:#9fb4bf; font-size:10px; letter-spacing:0.06em;">${weekday}</div>
              </td>
              <td style="padding:14px 18px; vertical-align:middle;">
                <div style="color:#ffffff; font-size:15px; font-weight:700; line-height:1.4;">${escapeHtml(hero.title)}${cancelledBadge}</div>
                <div style="color:#e4cd9a; font-size:13px; margin-top:4px; ${isCancelled ? "text-decoration:line-through; opacity:0.8;" : ""}">
                  🕐&nbsp; ${escapeHtml(fmtTime(hero.startDate))}${durationMinutes ? ` &middot; ${durationMinutes} min` : ""}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;

  let detailsHtml = "";
  if (includeDetails && settings) {
    const mapLink = settings.locationMapUrl
      ? `<br><a href="${escapeHtml(settings.locationMapUrl)}" dir="ltr" style="color:#a9834a; text-decoration:none;">${escapeHtml(settings.locationMapUrl)}</a>`
      : "";
    detailsHtml = `
      <div style="margin:0 0 18px; padding:16px 18px; background:#faf7f0; border:1px solid #ece3d1; border-radius:10px; text-align:center;">
        <div style="color:#8a6a35; font-size:12px; font-weight:600;">
          🔁&nbsp; <bdi dir="ltr">${escapeHtml(bookableWeekdayLabel(settings, "en"))}</bdi>
          &nbsp;/&nbsp;
          <bdi dir="rtl">${escapeHtml(bookableWeekdayLabel(settings, "ar"))}</bdi>
        </div>
        <div style="margin-top:9px; font-size:13.5px; color:#1a1a1a;">
          📍&nbsp; <bdi dir="ltr">${escapeHtml(settings.locationName)}</bdi>, <bdi dir="ltr">${escapeHtml(settings.locationAddress)}</bdi>
          ${mapLink}
        </div>
      </div>
      <div dir="ltr" style="text-align:left; margin-bottom:14px; color:#4b5563; font-size:13px;">${escapeHtml(settings.policyMessageEn).replace(/\n/g, "<br>")}</div>
      <div dir="rtl" style="text-align:right; margin-bottom:14px; color:#4b5563; font-size:13px;">${escapeHtml(settings.policyMessageAr).replace(/\n/g, "<br>")}</div>
    `;
  }

  // For a live/upcoming appointment, show all 3 actions right in the email —
  // Confirm, Reschedule, Cancel — as their own buttons rather than funneling
  // through one "Manage Appointment" link the client has to click through
  // first. Each still lands on the same public manage page (so the existing
  // token/ownership checks and, for Cancel, the native confirm() safety gate
  // all still apply — this only removes a click, not a safeguard), but an
  // ?action= param tells that page's JS to immediately trigger the matching
  // button there instead of making the client hunt for it. Only relevant
  // for a Scheduled appointment still ahead of it — a cancelled/completed
  // one has nothing to confirm/reschedule/cancel, so it keeps the single
  // "book again" button below.
  const ctaHtml = isPastState
    ? (hero.bookUrl
        ? `<div style="text-align:center; margin-top:16px;">
             <a href="${escapeHtml(hero.bookUrl)}" style="display:inline-block; background:#c9a86a; color:#0f2d3e; padding:12px 26px; border-radius:8px; text-decoration:none; font-size:14px; font-weight:700;">
               ${isCancelled
                 ? `Book a New Time &nbsp;·&nbsp; <bdi dir="rtl">احجز موعدًا جديدًا</bdi>`
                 : `Book Your Next Appointment &nbsp;·&nbsp; <bdi dir="rtl">احجز موعدك القادم</bdi>`}
             </a>
           </div>`
        : "")
    : manageUrl
    ? `
      <div style="text-align:center; margin-top:16px;">
        <a href="${escapeHtml(manageUrl)}&action=confirm" style="display:inline-block; width:100%; max-width:320px; box-sizing:border-box; background:#c9a86a; color:#0f2d3e; padding:12px 26px; border-radius:8px; text-decoration:none; font-size:14px; font-weight:700;">
          Confirm Your Appointment &nbsp;·&nbsp; <bdi dir="rtl">تأكيد الموعد</bdi>
        </a>
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; max-width:320px; margin:10px auto 0; border-collapse:separate;">
        <tr>
          <td style="width:50%; padding-right:5px;">
            <a href="${escapeHtml(manageUrl)}&action=reschedule" style="display:block; text-align:center; background:#ffffff; color:#0f2d3e; border:1px solid #d8c9a3; padding:10px 6px; border-radius:8px; text-decoration:none; font-size:12.5px; font-weight:700;">
              Reschedule &nbsp;·&nbsp; <bdi dir="rtl">إعادة الجدولة</bdi>
            </a>
          </td>
          <td style="width:50%; padding-left:5px;">
            <a href="${escapeHtml(manageUrl)}&action=cancel" style="display:block; text-align:center; background:#ffffff; color:#6b7280; border:1px solid #e5e7eb; padding:10px 6px; border-radius:8px; text-decoration:none; font-size:12.5px; font-weight:700;">
              Cancel &nbsp;·&nbsp; <bdi dir="rtl">إلغاء الموعد</bdi>
            </a>
          </td>
        </tr>
      </table>`
    : "";

  return `
    ${dateCard}
    <div dir="ltr" style="text-align:left;">${englishHtml}</div>
    <hr style="border:none; border-top:1px solid #e5e7eb; margin:16px 0;">
    <div dir="rtl" style="text-align:right;">${arabicHtml}</div>
    ${detailsHtml}
    ${ctaHtml}
  `;
}

/**
 * Short, purpose-built SMS text — reusing the full multi-paragraph email copy
 * verbatim (the old behavior) read like a wall of text on a phone and burned
 * extra SMS segments for no benefit. A text just needs the what/when at a
 * glance, a warm one-line close, and a link to act on it.
 *
 * Deliberately plain-ASCII (no emoji, no em dash) — either one forces the
 * whole message into UCS-2 encoding, which cuts a carrier's ~153-char GSM-7
 * segment down to ~67 chars and roughly doubles the segment count (and cost)
 * for the same text. The email keeps the emoji, since there it's pure visual
 * polish with no per-character billing behind it.
 */
export function buildAppointmentSmsText(
  noticeType: AppointmentNoticeType, title: string, dateLabel: string, timeLabel: string,
  durationMinutes: number, locationName: string | undefined, manageUrl: string, bookUrl: string,
  previousDateLabel?: string, previousTimeLabel?: string
): string {
  if (noticeType === "Appointment Cancelled") {
    return bookUrl
      ? `Your "${title}" on ${dateLabel} at ${timeLabel} was cancelled. Whenever you're ready, book a new time: ${bookUrl}`
      : `Your "${title}" on ${dateLabel} at ${timeLabel} was cancelled. Whenever you're ready, we'd love to have you back.`;
  }
  if (noticeType === "Appointment Completed") {
    return `Thanks for coming in for "${title}"! Let us know if you need anything else.${bookUrl ? ` Book again: ${bookUrl}` : ""}`;
  }
  if (noticeType === "Appointment Confirmation Request") {
    const manage = manageUrl ? ` Confirm, reschedule, or reach us: ${manageUrl}` : "";
    return `Please confirm: "${title}" on ${dateLabel} at ${timeLabel}, tomorrow.${manage}`;
  }
  if (noticeType === "Appointment Rescheduled") {
    const was = previousDateLabel && previousTimeLabel ? ` (was ${previousDateLabel} at ${previousTimeLabel})` : "";
    const manage = manageUrl ? ` Manage: ${manageUrl}` : "";
    return `Your "${title}" is now ${dateLabel} at ${timeLabel}${was}.${manage}`;
  }
  const lead = noticeType === "Appointment Reminder" ? "Reminder:" : "You're booked!";
  const closer = noticeType === "Appointment Reminder" ? "See you soon!" : "We can't wait to see you!";
  const durationSuffix = durationMinutes ? ` (${durationMinutes} min)` : "";
  const locationSuffix = locationName ? ` at ${locationName}` : "";
  const manage = manageUrl ? ` Manage: ${manageUrl}` : "";
  return `${lead} ${title} - ${dateLabel} at ${timeLabel}${durationSuffix}${locationSuffix}. ${closer}${manage}`;
}

/**
 * Sends the confirmation, reminder, or cancellation email/SMS for an appointment
 * and logs it to v3_communications (source_system='Appointments'), matching
 * reminders.routes.ts's sendAndLog convention — attempt the real send, but
 * always write the log row so the client's Communications history has a
 * record even if the send itself failed (e.g. email not configured yet in
 * this environment). Exported so the public cancel/reschedule flow
 * (publicAppointments.routes.ts) can send the same kind of notice. Returns
 * per-channel failure descriptions (BC-003) — the v3_communications row
 * already carries the failure for anyone who opens that client's history,
 * but the bulk reminder sweep (runAppointmentReminders) has no other way to
 * know a "successful" pass actually failed to reach anyone, since every send
 * is individually try/caught right here and never throws back out.
 */
export async function notifyAppointment(appt: any, templateName: AppointmentNoticeType, actorEmail: string, req?: Request): Promise<{ failures: string[] }> {
  const email = appt.contact_email || null;
  const phone = appt.contact_phone || null;
  if (!email && !phone) return { failures: [] };

  const start = new Date(appt.start_time);
  // previous_start_time is only ever set by the two reschedule call sites,
  // right before they switch to the "Appointment Rescheduled" notice type —
  // every other caller leaves it undefined, so previousDate/previousTime just
  // fall back to substitutePlaceholders' blankable-token handling for them.
  const previousStart = appt.previous_start_time ? new Date(appt.previous_start_time) : null;
  const extra: Record<string, string> = {
    appointmentTitle: appt.title || "",
    appointmentDate: fmtDate(start),
    appointmentTime: fmtTime(start),
    appointmentLocation: appt.location ? ` at ${appt.location}` : "",
    appointmentLocationAr: appt.location ? ` في ${appt.location}` : "",
    clientName: appt.contact_name || appt.client_name || "",
    previousDate: previousStart ? fmtDate(previousStart) : "",
    previousTime: previousStart ? fmtTime(previousStart) : "",
  };
  const resolvedTemplate = await resolveTemplate(templateName, appt.client_id || "", "", "", extra);
  if (!resolvedTemplate) return { failures: [] };
  const includeDetails = templateName !== "Appointment Cancelled" && templateName !== "Appointment Completed";
  const base = publicBaseUrl(req);
  const manageUrl = base && appt.manage_token ? `${base}/manage-appointment?token=${appt.manage_token}` : "";
  const bookUrl = base ? `${base}/book` : "";
  // Fetched unconditionally now (not just when includeDetails) so
  // clientReminderChannel can gate which channels fire below for every
  // notice type, not just Reminder/Confirmation — includeDetails still
  // controls whether location/policy text gets baked into the message body.
  const settings = await getAppointmentSettings();
  const durationMinutes = Math.round((new Date(appt.end_time).getTime() - new Date(appt.start_time).getTime()) / 60000);
  const plainText = buildAppointmentPlainText(resolvedTemplate, includeDetails, manageUrl, includeDetails ? settings : null, durationMinutes);

  const marker = templateName === "Appointment Reminder" ? "REM"
    : templateName === "Appointment Cancelled" ? "CANCEL"
    : templateName === "Appointment Confirmation Request" ? "CONFREQ"
    : templateName === "Appointment Rescheduled" ? "RESCHED"
    : templateName === "Appointment Completed" ? "DONE"
    : "CONF";
  const channels: { channel: "Email" | "SMS"; to: string }[] = [];
  if (email && (settings.clientReminderChannel === "email" || settings.clientReminderChannel === "both")) channels.push({ channel: "Email", to: email });
  if (phone && (settings.clientReminderChannel === "sms" || settings.clientReminderChannel === "both")) channels.push({ channel: "SMS", to: phone });

  // Logged as one row per channel actually attempted — matches every other send
  // path in this app (Communications, reminders), so a failed SMS doesn't get
  // silently masked by a successful email in the same log entry.
  const failures: string[] = [];
  for (const { channel, to } of channels) {
    let sent = false;
    let sendError: string | undefined;
    let providerMessageId: string | null = null;
    try {
      if (channel === "Email") {
        const html = buildAppointmentEmailHtml(resolvedTemplate, includeDetails, manageUrl, includeDetails ? settings : null, durationMinutes,
          { title: appt.title || "Appointment", startDate: start, noticeType: templateName, bookUrl });
        // "Invite Others" guests are CC'd on the same confirmation/reminder/
        // cancellation email the primary contact gets — no separate send
        // path, no portal account, matching the existing Cc/Bcc convention.
        const result = await sendEmail({ to, cc: parseEmailList(appt.guest_emails), subject: resolvedTemplate.subject, html: await wrapEmailHtml(html, req) });
        providerMessageId = result.providerMessageId;
      } else {
        // SMS stays short — a purpose-built one-liner, not the multi-paragraph
        // email copy — but the manage/book link still goes out here too, since
        // that's how an SMS/WhatsApp recipient actually acts without calling.
        const smsBody = buildAppointmentSmsText(templateName, appt.title || "Appointment", extra.appointmentDate, extra.appointmentTime,
          durationMinutes, includeDetails ? settings.locationName : undefined, manageUrl, bookUrl,
          extra.previousDate || undefined, extra.previousTime || undefined);
        const result = await sendSms({ to, body: `AL TAX SERVICE: ${smsBody}` });
        providerMessageId = result.providerMessageId;
      }
      sent = true;
    } catch (err: any) {
      sendError = err instanceof NotConfiguredError ? err.message : (err?.message || "Send failed.");
    }
    const status = sent ? "Saved + Sent" : sendError ? `Saved — ${sendError}` : "Saved";
    if (!sent) failures.push(`Client ${channel}${sendError ? `: ${sendError}` : ""}`);
    await query(
      `INSERT INTO altax.v3_communications
         (communication_id, client_id, client_name, direction, channel, subject,
          message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id, provider_message_id)
       VALUES ($1,$2,$3,'Outbound',$4,$5,$6,$7,$8,$9,now(),$10,'Appointments',$11,$12)`,
      [`COM-${idSuffix()}`, appt.client_id || null, appt.contact_name || appt.client_name || null,
        channel, resolvedTemplate.subject, plainText.english, plainText.arabic,
        to, actorEmail, status, `APPT-${marker}-${appt.appointment_id}-${channel}`, providerMessageId]
    );
  }
  return { failures };
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

async function notifyAppointmentStaff(appt: any, leadMinutes: number, channel: StaffReminderChannel, req?: Request): Promise<{ failures: string[] }> {
  const recipients = await resolveStaffRecipients(appt);
  if (recipients.size === 0) return { failures: [] };

  const start = new Date(appt.start_time);
  const who = appt.contact_name || appt.client_name || "a contact";
  const lead = leadLabel(leadMinutes);
  const subject = `Reminder — ${lead}: ${appt.title || "Appointment"} with ${who}`;
  const html = `<p>${escapeHtml(lead)} — <strong>${escapeHtml(appt.title || "Appointment")}</strong></p>
    <p>${escapeHtml(who)}${appt.assigned_to ? ` &middot; Assigned to ${escapeHtml(appt.assigned_to)}` : ""}</p>
    <p>${escapeHtml(fmtDate(start))} at ${escapeHtml(fmtTime(start))}${appt.location ? ` &middot; ${escapeHtml(appt.location)}` : ""}</p>`;
  const smsBody = `AL TAX SERVICE: ${lead} — ${appt.title || "Appointment"} with ${who} on ${fmtDate(start)} at ${fmtTime(start)}${appt.location ? ` (${appt.location})` : ""}.`;

  // Unlike notifyAppointment (client-facing), these internal heads-up sends are
  // not logged to v3_communications — that log is client correspondence history,
  // not staff internal notices. So the only way a failure here is ever visible
  // anywhere (BC-003) is if the caller surfaces this return value.
  const failures: string[] = [];
  for (const { email, phone } of recipients.values()) {
    if ((channel === "email" || channel === "both") && email) {
      try {
        await sendEmail({ to: email, subject, html: await wrapEmailHtml(html, req) });
      } catch (err: any) {
        failures.push(`Staff email to ${email}: ${err?.message || "send failed"}`);
      }
    }
    if ((channel === "sms" || channel === "both") && phone) {
      try {
        await sendSms({ to: phone, body: smsBody });
      } catch (err: any) {
        failures.push(`Staff SMS to ${phone}: ${err?.message || "send failed"}`);
      }
    }
  }
  return { failures };
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
export async function runAppointmentReminders(actorEmail: string, req?: Request): Promise<{ sent: number; failed: number; channelFailures: number }> {
  const settings = await getAppointmentSettings();
  let sent = 0, failed = 0, channelFailures = 0;
  // BC-003: notifyAppointment/notifyAppointmentStaff already try/catch every
  // individual send internally (so one bad phone number can't take down the
  // rest of the sweep), which means the outer try/catch below almost never
  // fires for a real delivery failure — it only catches something more
  // fundamental (DB down, template missing). Collecting the per-channel
  // failures those two functions now return is the only way this run's own
  // "did everything actually go out" accounting — and the admin alert below —
  // reflects real delivery failures instead of just unhandled exceptions.
  const channelFailureDetails: string[] = [];

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
      // Claim first, atomically: the UPDATE's own WHERE clause re-checks
      // "not yet sent" against the row as it stands at UPDATE time, so a
      // second concurrent sweep (an overlapping hourly tick, a manual trigger,
      // or a second app instance) targeting the same appointment+leadMinutes
      // blocks on the row lock, then matches zero rows once the first commits
      // — closing the double-send race the old check-then-act shape left open.
      const claimed = await query<any>(
        `UPDATE altax.v3_appointments SET reminder_lead_minutes_sent = array_append(reminder_lead_minutes_sent, $2)
           WHERE appointment_id = $1 AND NOT ($2 = ANY(reminder_lead_minutes_sent))
           RETURNING appointment_id`,
        [appt.appointment_id, leadMinutes]
      );
      if (!claimed.length) continue;
      try {
        const apptFailures: string[] = [];
        if (appt.notify_client) {
          const { failures } = await notifyAppointment({ ...appt, client_name: appt.linked_client_name }, "Appointment Reminder", actorEmail, req);
          apptFailures.push(...failures);
        }
        const { failures: staffFailures } = await notifyAppointmentStaff({ ...appt, client_name: appt.linked_client_name }, leadMinutes, settings.staffReminderChannel, req);
        apptFailures.push(...staffFailures);
        if (apptFailures.length) {
          channelFailures++;
          channelFailureDetails.push(`${appt.title || "Appointment"} (${appt.appointment_id}, ${leadLabel(leadMinutes)}): ${apptFailures.join("; ")}`);
        }
        sent++;
      } catch (err) {
        // Previously a bare `catch { failed++ }` — no console output, no alert,
        // no audit row, so a broken reminder was invisible everywhere. This job
        // never throws (every failure is caught here), so server.ts's own
        // .catch(alertAdmins) on the cron call never fired either.
        failed++;
        // eslint-disable-next-line no-console
        console.error(`[runAppointmentReminders] failed for appointment ${appt.appointment_id} (lead ${leadMinutes}m):`, err);
        // Undo the claim so a transient send failure is retried next sweep
        // instead of being permanently marked "sent" despite never sending.
        await query(
          `UPDATE altax.v3_appointments SET reminder_lead_minutes_sent = array_remove(reminder_lead_minutes_sent, $2) WHERE appointment_id = $1`,
          [appt.appointment_id, leadMinutes]
        );
      }
    }
  }
  if (failed > 0) {
    await alertAdmins(
      "Appointment reminders: some sends failed",
      `${failed} of ${sent + failed} appointment reminder(s) failed to send this run. Check the server logs for per-appointment errors (search "[runAppointmentReminders] failed for appointment").`
    );
  }
  if (channelFailureDetails.length > 0) {
    await alertAdmins(
      "Appointment reminders: some channels failed to deliver",
      `${channelFailures} reminder(s) this run had at least one channel (client email/SMS or staff email/SMS) that failed to send, even though the overall reminder was marked sent:\n\n${channelFailureDetails.slice(0, 20).join("\n")}${channelFailureDetails.length > 20 ? `\n…and ${channelFailureDetails.length - 20} more.` : ""}`
    );
  }
  return { sent, failed, channelFailures };
}

/**
 * Sends the "please confirm your appointment" ask exactly once, ~24 hours
 * before each Scheduled appointment — a fixed lead time (CONFIRMATION_REQUEST_LEAD_MINUTES),
 * not one of the admin-configurable reminderLeadMinutes above, since this
 * always fires (no settings toggle) and is idempotency-tracked in its own
 * column (confirmation_request_sent_at) rather than the shared
 * reminder_lead_minutes_sent array, to avoid colliding with a real 1-day
 * (1440-minute) reminder the admin may also have configured. Same 2-hour
 * window / hourly-sweep shape as runAppointmentReminders above. Client-only
 * (respects notify_client) — the team already gets a heads-up for this lead
 * time via notifyAppointmentStaff if 1440 happens to be one of their
 * configured lead times; this doesn't duplicate that.
 */
export async function runAppointmentConfirmationRequests(actorEmail: string, req?: Request): Promise<{ sent: number; failed: number; channelFailures: number }> {
  const target = new Date(Date.now() + CONFIRMATION_REQUEST_LEAD_MINUTES * 60 * 1000);
  const windowStart = new Date(target.getTime() - 60 * 60 * 1000);
  const windowEnd = new Date(target.getTime() + 60 * 60 * 1000);
  let sent = 0, failed = 0, channelFailures = 0;
  const channelFailureDetails: string[] = []; // BC-003, same reasoning as runAppointmentReminders above

  const due = await query<any>(
    `SELECT a.*, c.client_name AS linked_client_name FROM altax.v3_appointments a
       LEFT JOIN altax.v3_clients c ON c.client_id = a.client_id
      WHERE a.status = 'Scheduled' AND a.start_time BETWEEN $1 AND $2
        AND a.confirmation_request_sent_at IS NULL`,
    [windowStart.toISOString(), windowEnd.toISOString()]
  );
  for (const appt of due) {
    // Same atomic claim-first pattern as runAppointmentReminders above —
    // closes the identical check-then-act race on confirmation_request_sent_at.
    const claimed = await query<any>(
      `UPDATE altax.v3_appointments SET confirmation_request_sent_at = now()
         WHERE appointment_id = $1 AND confirmation_request_sent_at IS NULL
         RETURNING appointment_id`,
      [appt.appointment_id]
    );
    if (!claimed.length) continue;
    try {
      if (appt.notify_client) {
        const { failures } = await notifyAppointment({ ...appt, client_name: appt.linked_client_name }, "Appointment Confirmation Request", actorEmail, req);
        if (failures.length) {
          channelFailures++;
          channelFailureDetails.push(`${appt.title || "Appointment"} (${appt.appointment_id}): ${failures.join("; ")}`);
        }
      }
      sent++;
    } catch (err) {
      // Same visibility fix as runAppointmentReminders above — a bare
      // `catch { failed++ }` left a broken confirmation-request sweep with
      // zero trace anywhere (no console output, no alert, no audit row).
      failed++;
      // eslint-disable-next-line no-console
      console.error(`[runAppointmentConfirmationRequests] failed for appointment ${appt.appointment_id}:`, err);
      // Undo the claim so a transient failure is retried next sweep.
      await query(
        `UPDATE altax.v3_appointments SET confirmation_request_sent_at = NULL WHERE appointment_id = $1`,
        [appt.appointment_id]
      );
    }
  }
  if (failed > 0) {
    await alertAdmins(
      "Appointment confirmation requests: some sends failed",
      `${failed} of ${sent + failed} appointment confirmation request(s) failed to send this run. Check the server logs for per-appointment errors (search "[runAppointmentConfirmationRequests] failed for appointment").`
    );
  }
  if (channelFailureDetails.length > 0) {
    await alertAdmins(
      "Appointment confirmation requests: some channels failed to deliver",
      `${channelFailures} confirmation request(s) this run had a channel that failed to send:\n\n${channelFailureDetails.slice(0, 20).join("\n")}${channelFailureDetails.length > 20 ? `\n…and ${channelFailureDetails.length - 20} more.` : ""}`
    );
  }
  return { sent, failed, channelFailures };
}

/**
 * Flips any Scheduled appointment whose end time has passed to Completed, and
 * sends the client a thank-you (respecting notify_client, same as every other
 * client-facing notice here). Without the status flip, a past appointment sat
 * as "Scheduled" forever — visually identical to an upcoming one on the
 * Calendar page (both rendered the same gray pill), with nothing to say "this
 * already happened." "Completed" was already an allowed status in the schema
 * (sql/022_appointments.sql's CHECK constraint) but nothing ever set it;
 * StatusBadge's colorClassFor already maps "completed" to green, so this
 * needed no new frontend styling — just the write. Called hourly from
 * server.ts's cron, same shape as the other sweeps here. No "was this
 * actually attended" judgment — a no-show still flips to Completed and still
 * gets the thank-you exactly like an attended one; staff can still manually
 * Cancel/Delete afterward if that distinction matters for a specific
 * appointment (in which case the thank-you has already gone out — an
 * accepted trade-off for keeping this a single unconditional sweep rather
 * than a judgment call the system can't make).
 */
export async function runAppointmentAutoComplete(actorEmail: string, req?: Request): Promise<{ completed: number }> {
  const rows = await query<any>(
    `UPDATE altax.v3_appointments SET status = 'Completed', updated_at = now()
      WHERE status = 'Scheduled' AND end_time < now()
      RETURNING *`
  );
  // Batch-fetched separately rather than a JOIN in the UPDATE (Postgres's
  // UPDATE...FROM can't express "match if present, otherwise still update" —
  // a bare-contact booking with no client_id needs to complete too).
  const clientIds = [...new Set(rows.map((r: any) => r.client_id).filter(Boolean))];
  const clientNameById = new Map<string, string>();
  if (clientIds.length) {
    const clients = await query<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = ANY($1)`, [clientIds]);
    for (const c of clients) clientNameById.set(c.client_id, c.client_name);
  }
  for (const r of rows) {
    await logAudit("Calendar", "AUTO_COMPLETE_APPOINTMENT", r.appointment_id, "Status", "Scheduled", "Completed",
      `Appointment "${r.title}" auto-marked Completed after its scheduled time passed.`, actorEmail);
    if (r.notify_client) {
      try {
        await notifyAppointment({ ...r, client_name: clientNameById.get(r.client_id) }, "Appointment Completed", actorEmail, req);
      } catch {
        // best-effort — the status flip above already succeeded and is logged
      }
    }
  }
  return { completed: rows.length };
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
      notifyClient: body.notifyClient !== false, guestEmails: parseEmailList(body.guestEmails) || null, createdBy: req.user!.email, req,
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
  const newAssignedTo = body.assignedTo !== undefined ? (body.assignedTo ? String(body.assignedTo).trim() || null : null) : existing.assigned_to;
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
       confirmation_request_sent_at = CASE WHEN $9 THEN NULL ELSE confirmation_request_sent_at END,
       appointment_type_id = $10, appointment_type_name = $11, guest_emails = $12,
       updated_at = now()
     WHERE appointment_id = $1`,
    [appointmentId, title, startTime, endTime,
      body.location !== undefined ? (body.location ? String(body.location).trim() || null : null) : existing.location,
      body.notes !== undefined ? (body.notes ? String(body.notes).trim() || null : null) : existing.notes,
      body.assignedTo !== undefined ? (body.assignedTo ? String(body.assignedTo).trim() || null : null) : existing.assigned_to,
      body.notifyClient !== undefined ? !!body.notifyClient : existing.notify_client,
      timeChanged,
      // A JS `null` sent in the JSON body means "clear the type" (the Edit
      // modal's "Custom" duration option sends exactly this) — but
      // `String(null)` stringifies to the 4-character text "null", not an
      // empty string, so the old `String(x).trim() || null` here was writing
      // the literal word "null" into appointment_type_id, which then failed
      // its FK constraint against v3_appointment_types with a raw 500. Every
      // appointment booked through the public /book page has a null type (no
      // picker shown when there's only one type), so editing and saving any
      // of them hit this on every single save.
      body.appointmentTypeId !== undefined ? (body.appointmentTypeId ? String(body.appointmentTypeId).trim() || null : null) : existing.appointment_type_id,
      body.appointmentTypeName !== undefined ? (body.appointmentTypeName ? String(body.appointmentTypeName).trim() || null : null) : existing.appointment_type_name,
      body.guestEmails !== undefined ? (parseEmailList(body.guestEmails) || null) : existing.guest_emails]
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
        await notifyAppointment(
          { ...updated, client_name: updated.linked_client_name, previous_start_time: existing.start_time },
          "Appointment Rescheduled", req.user!.email, req
        );
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
  if (existing.client_id) {
    await logClientActivity(existing.client_id, "Appointment Updated", `"${title}" edited by ${req.user!.email}.`, req.user!.email);
  }
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
  if (existing.client_id) {
    await logClientActivity(existing.client_id, "Appointment Cancelled", `"${existing.title}" cancelled by ${req.user!.email}.`, req.user!.email);
  }
  res.json({ ok: true });
}));

// Admin-only: staff can Edit and Cancel (both preserve the row and its
// history — Cancel just flips status), but permanent deletion destroys the
// compliance/audit trail entirely, so it's restricted one level up. See the
// architecture review's "Remove Appointment Delete from Staff Portal" section.
appointmentsRouter.post("/:appointmentId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { appointmentId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_appointments WHERE appointment_id = $1`, [appointmentId]);
  if (!existing) return res.status(404).json({ error: "Appointment not found." });
  // Snapshot the row before it's gone — DELETE_APPOINTMENT used to log with
  // empty old/new values, so the audit trail said only THAT something was
  // deleted, never WHAT. This is the only trace left once the row is gone.
  const snapshot = [
    `Title: ${existing.title}`,
    `Contact: ${existing.contact_name || existing.client_id || "—"}`,
    `When: ${fmtDate(new Date(existing.start_time))} at ${fmtTime(new Date(existing.start_time))}`,
    `Status: ${existing.status}`,
    existing.assigned_to ? `Assigned to: ${existing.assigned_to}` : null,
  ].filter(Boolean).join(" · ");
  await query(`DELETE FROM altax.v3_appointments WHERE appointment_id = $1`, [appointmentId]);
  await logAudit("Calendar", "DELETE_APPOINTMENT", appointmentId, "", snapshot, "",
    `Appointment deleted by ${req.user!.email}. ${snapshot}`, req.user!.email);
  res.json({ ok: true });
}));
