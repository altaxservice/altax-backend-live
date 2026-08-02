import { Router, Request, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { sendEmail, sendSms, NotConfiguredError } from "../../common/notifications";
import { wrapEmailHtml } from "../../common/emailTemplate";
import { resolveTemplate } from "../templates/templates.routes";

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
export async function createAppointment(input: CreateAppointmentInput): Promise<{ appointmentId: string }> {
  const title = input.title.trim();
  if (!title) throw new Error("Title is required.");
  if (!input.startTime || !input.endTime) throw new Error("Start and end time are required.");
  if (new Date(input.endTime) < new Date(input.startTime)) throw new Error("End time can't be before start time.");

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
  await query(
    `INSERT INTO altax.v3_appointments
       (appointment_id, title, client_id, contact_name, contact_email, contact_phone,
        start_time, end_time, location, notes, assigned_to, status, notify_client, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Scheduled',$12,$13)`,
    [appointmentId, title, clientId, contactName, contactEmail, contactPhone,
      input.startTime, input.endTime, input.location?.trim() || null, input.notes?.trim() || null,
      input.assignedTo?.trim() || null, notifyClient, input.createdBy]
  );

  const appt = await queryOne<any>(`SELECT * FROM altax.v3_appointments WHERE appointment_id = $1`, [appointmentId]);
  if (notifyClient && appt) {
    await notifyAppointment({ ...appt, client_name: client?.client_name }, "Appointment Confirmation", input.createdBy, input.req);
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

/**
 * Sends the confirmation or reminder email/SMS for an appointment and logs it to
 * v3_communications (source_system='Appointments'), matching reminders.routes.ts's
 * sendAndLog convention — attempt the real send, but always write the log row so
 * the client's Communications history has a record even if the send itself failed
 * (e.g. email not configured yet in this environment).
 */
async function notifyAppointment(appt: any, templateName: "Appointment Confirmation" | "Appointment Reminder", actorEmail: string, req?: Request): Promise<void> {
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
  const resolved = await resolveTemplate(templateName, appt.client_id || "", "", "", extra);
  if (!resolved) return;

  const marker = templateName === "Appointment Reminder" ? "REM" : "CONF";
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
        await sendEmail({ to, subject: resolved.subject, html: await wrapEmailHtml(`<p>${resolved.message_english.replace(/\n/g, "<br>")}</p>`, req) });
      } else {
        await sendSms({ to, body: `AL TAX SERVICE: ${resolved.message_english}` });
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
        channel, resolved.subject, resolved.message_english, resolved.message_arabic,
        to, actorEmail, status, `APPT-${marker}-${appt.appointment_id}-${channel}`]
    );
  }
}

/**
 * Sends the day-before reminder for every Scheduled appointment starting between
 * 23 and 25 hours from now that hasn't already gotten one — called hourly from
 * server.ts's cron, same "hourly sweep with an idempotency marker" shape as the
 * daily reminders job, just on appointments instead of tasks/documents/invoices.
 */
export async function runAppointmentReminders(actorEmail: string): Promise<{ sent: number; failed: number }> {
  const windowStart = new Date(Date.now() + 23 * 60 * 60 * 1000);
  const windowEnd = new Date(Date.now() + 25 * 60 * 60 * 1000);
  const due = await query<any>(
    `SELECT a.*, c.client_name AS linked_client_name FROM altax.v3_appointments a
       LEFT JOIN altax.v3_clients c ON c.client_id = a.client_id
      WHERE a.status = 'Scheduled' AND a.reminder_sent_at IS NULL AND a.notify_client = true
        AND a.start_time BETWEEN $1 AND $2`,
    [windowStart.toISOString(), windowEnd.toISOString()]
  );
  let sent = 0, failed = 0;
  for (const appt of due) {
    try {
      await notifyAppointment({ ...appt, client_name: appt.linked_client_name }, "Appointment Reminder", actorEmail);
      await query(`UPDATE altax.v3_appointments SET reminder_sent_at = now() WHERE appointment_id = $1`, [appt.appointment_id]);
      sent++;
    } catch {
      failed++;
    }
  }
  return { sent, failed };
}

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

  // A reschedule (start_time changing) clears reminder_sent_at so the day-before
  // reminder fires again for the new time rather than silently never sending.
  const timeChanged = new Date(startTime).getTime() !== new Date(existing.start_time).getTime();

  await query(
    `UPDATE altax.v3_appointments SET
       title = $2, start_time = $3, end_time = $4, location = $5, notes = $6, assigned_to = $7,
       notify_client = $8, reminder_sent_at = CASE WHEN $9 THEN NULL ELSE reminder_sent_at END, updated_at = now()
     WHERE appointment_id = $1`,
    [appointmentId, title, startTime, endTime,
      body.location !== undefined ? String(body.location).trim() || null : existing.location,
      body.notes !== undefined ? String(body.notes).trim() || null : existing.notes,
      body.assignedTo !== undefined ? String(body.assignedTo).trim() || null : existing.assigned_to,
      body.notifyClient !== undefined ? !!body.notifyClient : existing.notify_client,
      timeChanged]
  );
  await logAudit("Calendar", "UPDATE_APPOINTMENT", appointmentId, "", "", title,
    `Appointment "${title}" updated by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

appointmentsRouter.post("/:appointmentId/cancel", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { appointmentId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_appointments WHERE appointment_id = $1`, [appointmentId]);
  if (!existing) return res.status(404).json({ error: "Appointment not found." });
  await query(`UPDATE altax.v3_appointments SET status = 'Cancelled', updated_at = now() WHERE appointment_id = $1`, [appointmentId]);
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
