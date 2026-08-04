/**
 * Public, no-login appointment booking and self-service management — the
 * marketing site's "Book a Consultation" button (previously an external
 * Google Calendar link), the /book page linked from SMS/WhatsApp greeting
 * messages, and the /manage-appointment page linked from every confirmation
 * and reminder so a client can cancel or reschedule without logging in.
 * Creates/updates real rows in the same altax.v3_appointments table the
 * staff Calendar reads, via appointments.routes.ts's shared
 * createAppointment()/notifyAppointment() — so a public booking behaves
 * exactly like one a staff member makes directly. All booking rules
 * (bookable weekdays, hours, slot length, how far ahead) come from
 * appointmentSettings.ts, editable via the Calendar page's Settings tab.
 */
import { Router, Request, Response } from "express";
import { query, queryOne, pool } from "../../config/db";
import { asyncHandler } from "../../common/asyncHandler";
import { rateLimit } from "../../common/rateLimit";
import { sendEmail, NotConfiguredError } from "../../common/notifications";
import { logAudit } from "../../common/audit";
import { createAppointment, notifyAppointment } from "../appointments/appointments.routes";
import { getAppointmentSettings, isBookableWeekday, hoursForDay, type AppointmentSettings } from "../../common/appointmentSettings";
import { escapeHtml } from "../../common/html";

export const publicAppointmentsRouter = Router();

const availabilityLimiter = rateLimit({ name: "public-appointments-availability", windowMs: 5 * 60 * 1000, max: 60 });
const bookLimiter = rateLimit({ name: "public-appointments-book", windowMs: 15 * 60 * 1000, max: 8 });
const manageLimiter = rateLimit({ name: "public-appointments-manage", windowMs: 15 * 60 * 1000, max: 20 });

/** Builds the ET wall-clock offset for a given date (handles EST/EDT) via Intl, avoiding a timezone-data dependency. */
function etOffsetMinutes(y: number, m: number, d: number, hour: number): number {
  const utcGuess = new Date(Date.UTC(y, m - 1, d, hour));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", hour12: false, timeZoneName: "shortOffset",
  }).formatToParts(utcGuess);
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value || "GMT-5";
  const match = tzName.match(/GMT([+-]\d+)/);
  return match ? -Number(match[1]) * 60 : 300;
}

function slotToUtcIso(y: number, m: number, d: number, hour: number, minute: number): string {
  const offsetMin = etOffsetMinutes(y, m, d, hour);
  const utcMs = Date.UTC(y, m - 1, d, hour, minute) + offsetMin * 60 * 1000;
  return new Date(utcMs).toISOString();
}

/** Real open slots for one calendar date, honoring Calendar Settings (bookable weekdays, hours, slot length, booking horizon) and already-booked appointments. Shared by the availability endpoint and the reschedule flow. */
async function computeAvailableSlots(y: number, mo: number, d: number, settings: AppointmentSettings, excludeAppointmentId?: string): Promise<string[]> {
  const today = new Date();
  const requested = new Date(Date.UTC(y, mo - 1, d));
  const daysAhead = Math.floor((requested.getTime() - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86400000);
  if (daysAhead < 0 || daysAhead > settings.maxDaysAhead) return [];
  const jsDay = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  if (!isBookableWeekday(settings, jsDay)) return [];

  const dayStartIso = slotToUtcIso(y, mo, d, 0, 0);
  const dayEndIso = slotToUtcIso(y, mo, d, 23, 59);
  const params: any[] = [dayStartIso, dayEndIso];
  let excludeClause = "";
  if (excludeAppointmentId) { excludeClause = "AND appointment_id <> $3"; params.push(excludeAppointmentId); }
  const booked = await query<any>(
    `SELECT start_time, end_time FROM altax.v3_appointments
      WHERE status = 'Scheduled' AND start_time < $2 AND end_time > $1 ${excludeClause}`,
    params
  );
  const bookedRanges = booked.map((b: any) => ({ start: new Date(b.start_time).getTime(), end: new Date(b.end_time).getTime() }));

  const slots: string[] = [];
  const nowMs = Date.now();
  const { startHour, endHour } = hoursForDay(settings, jsDay);
  for (let hour = startHour; hour < endHour; hour++) {
    for (let minute = 0; minute < 60; minute += settings.slotMinutes) {
      const startIso = slotToUtcIso(y, mo, d, hour, minute);
      const startMs = new Date(startIso).getTime();
      const endMs = startMs + settings.slotMinutes * 60 * 1000;
      if (startMs <= nowMs) continue;
      const overlaps = bookedRanges.some((r) => startMs < r.end && endMs > r.start);
      if (!overlaps) slots.push(startIso);
    }
  }
  return slots;
}

function parseDateParam(raw: unknown): { y: number; mo: number; d: number } | null {
  const m = String(raw || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

function etDateParts(iso: string): { y: number; mo: number; d: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const hour = get("hour");
  return { y: get("year"), mo: get("month"), d: get("day"), hour: hour === 24 ? 0 : hour, minute: get("minute") };
}

/**
 * Re-validates a requested startTime against Calendar Settings server-side —
 * /availability's slot list is a convenience for the picker, not a trust
 * boundary, so a request forged straight at /book or /reschedule (bypassing
 * the picker entirely) still has to land on a real bookable weekday/hour
 * within the booking horizon rather than just "any future time that doesn't
 * clash with an existing appointment."
 */
/**
 * Serializes booking creation/reschedule for a given calendar day via a
 * Postgres advisory lock. The clash-check SELECT and the eventual write
 * (inside createAppointment, or the reschedule UPDATE) run on separate pooled
 * connections, but the advisory lock is database-global, so a second request
 * for the same day genuinely blocks here — closing the TOCTOU window between
 * "is this slot still open" and "book it" that let two visitors both pass the
 * clash check and both land in the same slot. Different days never contend.
 */
async function withDayBookingLock<T>(startTime: string, fn: () => Promise<T>): Promise<T> {
  const { y, mo, d } = etDateParts(startTime);
  const lockKey = `appt-book:${y}-${mo}-${d}`;
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(hashtext($1))`, [lockKey]);
    return await fn();
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [lockKey]).catch(() => {});
    client.release();
  }
}

function isSlotWithinSettings(startTime: string, settings: AppointmentSettings): boolean {
  const { y, mo, d, hour, minute } = etDateParts(startTime);
  const today = new Date();
  const daysAhead = Math.floor((Date.UTC(y, mo - 1, d) - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86400000);
  if (daysAhead < 0 || daysAhead > settings.maxDaysAhead) return false;
  const jsDay = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  if (!isBookableWeekday(settings, jsDay)) return false;
  const { startHour, endHour } = hoursForDay(settings, jsDay);
  if (hour < startHour || hour >= endHour) return false;
  // Must land on a real slot boundary (e.g. :00/:30 for a 30-minute grid) —
  // otherwise a forged startTime like 09:07 straddles two real slots
  // (09:00-09:30 and 09:30-10:00 both show as unavailable afterward) without
  // ever showing up as a bookable option in /availability.
  return minute % settings.slotMinutes === 0;
}

/**
 * The display-safe subset of Calendar Settings — what the public /book page's
 * "Appointments are available ..." hours note reads, so it can never drift
 * from the real bookable-weekday/hours configuration admins set on the
 * Calendar page's Settings tab (previously that line was a hardcoded string
 * in book.html, so changing Settings silently stopped matching the page).
 * Deliberately excludes the policy text and internal fields — this is only
 * what the booking page itself needs to display.
 */
publicAppointmentsRouter.get("/settings", availabilityLimiter, asyncHandler(async (_req: Request, res: Response) => {
  const settings = await getAppointmentSettings();
  res.json({
    bookableWeekdays: settings.bookableWeekdays,
    businessStartHour: settings.businessStartHour,
    businessEndHour: settings.businessEndHour,
    dayHours: settings.dayHours,
    slotMinutes: settings.slotMinutes,
  });
}));

publicAppointmentsRouter.get("/availability", availabilityLimiter, asyncHandler(async (req: Request, res: Response) => {
  const parsed = parseDateParam(req.query.date);
  if (!parsed) return res.status(400).json({ error: "date is required as YYYY-MM-DD." });
  const settings = await getAppointmentSettings();
  const excludeAppointmentId = String(req.query.excludeAppointmentId || "").trim() || undefined;
  const slots = await computeAvailableSlots(parsed.y, parsed.mo, parsed.d, settings, excludeAppointmentId);
  res.json({ slots, slotMinutes: settings.slotMinutes });
}));

publicAppointmentsRouter.post("/book", bookLimiter, asyncHandler(async (req: Request, res: Response) => {
  const body = req.body || {};
  // Honeypot — same convention as publicContact.routes.ts's "website" field.
  if (body.website) return res.json({ ok: true });

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const phone = String(body.phone || "").trim();
  const startTime = String(body.startTime || "").trim();
  const reason = String(body.reason || "").trim();
  // Phone/email are how we'd confirm or remind someone, but the fields stay
  // optional rather than required — a walk-in prospect who'd rather not share
  // either shouldn't be blocked from getting on the calendar at all. If both
  // are left blank, createAppointment() below just skips the confirmation
  // send (see notifyAppointment's early return) rather than failing.
  if (!name || !startTime) {
    return res.status(400).json({ error: "Name and a time slot are required." });
  }

  const startMs = new Date(startTime).getTime();
  if (!Number.isFinite(startMs) || startMs <= Date.now()) {
    return res.status(400).json({ error: "That time slot is no longer valid — please pick another." });
  }
  const settings = await getAppointmentSettings();
  const endTime = new Date(startMs + settings.slotMinutes * 60 * 1000).toISOString();

  if (!isSlotWithinSettings(startTime, settings)) {
    return res.status(400).json({ error: "That time is outside our booking hours — please pick an available slot." });
  }

  let appointmentId: string;
  try {
    // Re-check the slot is still open right before booking, and hold the
    // per-day advisory lock across both the check and the create — two
    // visitors submitting for the same slot within milliseconds of each
    // other now serialize here instead of both passing the check and both
    // landing in the same slot.
    appointmentId = await withDayBookingLock(startTime, async () => {
      const clash = await query<any>(
        `SELECT 1 FROM altax.v3_appointments WHERE status = 'Scheduled' AND start_time < $2 AND end_time > $1 LIMIT 1`,
        [startTime, endTime]
      );
      if (clash.length) throw new Error("That time slot was just booked by someone else — please pick another.");
      const created = await createAppointment({
        title: "Consultation", contactName: name, contactEmail: email, contactPhone: phone,
        startTime, endTime, notes: reason || undefined, notifyClient: true,
        createdBy: "Public Booking Form", req,
      });
      return created.appointmentId;
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Could not book this appointment." });
  }

  try {
    const admins = await query<any>(
      `SELECT email FROM altax.v3_users WHERE active = true AND lower(role) = 'admin' AND email IS NOT NULL AND email <> ''`
    );
    const when = new Date(startTime).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" });
    // This entire email is built from unauthenticated public input (name/phone/
    // email/reason) — unlike every other email builder in this app, this one
    // used to interpolate it raw. A booking named e.g. `<a href=...>Urgent...`
    // would render as a live link inside the firm's own internal admin
    // notification. Escape everything, and only convert newlines to <br> AFTER
    // escaping so the <br> tags themselves don't get escaped too.
    const html = `
      <h2>New consultation booked online</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Phone:</strong> ${phone ? escapeHtml(phone) : "not provided"}</p>
      <p><strong>Email:</strong> ${email ? escapeHtml(email) : "not provided"}</p>
      <p><strong>When:</strong> ${when} ET</p>
      ${reason ? `<p><strong>Notes:</strong><br>${escapeHtml(reason).replace(/\n/g, "<br>")}</p>` : ""}
      <p style="color:#777;font-size:12px;">Booked via the public /book page &middot; ${escapeHtml(appointmentId)}</p>
    `;
    // Per-admin try/catch — previously one admin's failed send (bad address,
    // transient SMTP error) aborted the whole loop, so the rest of the firm's
    // admins never learned a new consultation was booked online.
    for (const admin of admins) {
      try {
        await sendEmail({ to: admin.email, subject: `New consultation booked — ${name}`, html });
      } catch (err) {
        if (!(err instanceof NotConfiguredError)) {
          // eslint-disable-next-line no-console
          console.error(`Public booking admin notification failed for ${admin.email}:`, err);
        }
      }
    }
  } catch (err) {
    if (!(err instanceof NotConfiguredError)) {
      // eslint-disable-next-line no-console
      console.error("Public booking admin notification failed:", err);
    }
  }

  res.status(201).json({ ok: true });
}));

/** Looks up an appointment by its manage_token — never by appointment_id, so this can't be used to probe/enumerate other people's bookings. Only a live, still-Scheduled, still-future appointment can be managed. */
async function findManageableAppointment(token: string): Promise<any | null> {
  if (!token) return null;
  const appt = await queryOne<any>(
    `SELECT a.*, c.client_name AS linked_client_name FROM altax.v3_appointments a
       LEFT JOIN altax.v3_clients c ON c.client_id = a.client_id
      WHERE a.manage_token = $1`,
    [token]
  );
  if (!appt) return null;
  return { ...appt, client_name: appt.linked_client_name || appt.contact_name };
}

publicAppointmentsRouter.get("/manage/:token", manageLimiter, asyncHandler(async (req: Request, res: Response) => {
  const appt = await findManageableAppointment(req.params.token);
  if (!appt) return res.status(404).json({ error: "Appointment not found." });
  const canManage = appt.status === "Scheduled" && new Date(appt.start_time).getTime() > Date.now();
  res.json({
    title: appt.title, startTime: appt.start_time, endTime: appt.end_time, status: appt.status,
    contactName: appt.contact_name, canManage,
  });
}));

publicAppointmentsRouter.post("/manage/:token/cancel", manageLimiter, asyncHandler(async (req: Request, res: Response) => {
  const appt = await findManageableAppointment(req.params.token);
  if (!appt) return res.status(404).json({ error: "Appointment not found." });
  if (appt.status !== "Scheduled") return res.status(400).json({ error: "This appointment is no longer active." });
  if (new Date(appt.start_time).getTime() <= Date.now()) return res.status(400).json({ error: "This appointment has already passed." });

  await query(`UPDATE altax.v3_appointments SET status = 'Cancelled', updated_at = now() WHERE appointment_id = $1`, [appt.appointment_id]);
  await logAudit("Calendar", "CANCEL_APPOINTMENT", appt.appointment_id, "Status", appt.status, "Cancelled",
    `Appointment "${appt.title}" cancelled by the client via the manage-appointment link.`, "Public Manage Link");
  try {
    await notifyAppointment(appt, "Appointment Cancelled", "Public Manage Link", req);
  } catch {
    // Best-effort — the cancellation itself already succeeded and is logged above.
  }
  res.json({ ok: true });
}));

publicAppointmentsRouter.post("/manage/:token/reschedule", manageLimiter, asyncHandler(async (req: Request, res: Response) => {
  const appt = await findManageableAppointment(req.params.token);
  if (!appt) return res.status(404).json({ error: "Appointment not found." });
  if (appt.status !== "Scheduled") return res.status(400).json({ error: "This appointment is no longer active." });
  if (new Date(appt.start_time).getTime() <= Date.now()) return res.status(400).json({ error: "This appointment has already passed." });

  const startTime = String((req.body || {}).startTime || "").trim();
  const startMs = new Date(startTime).getTime();
  if (!startTime || !Number.isFinite(startMs) || startMs <= Date.now()) {
    return res.status(400).json({ error: "That time slot is no longer valid — please pick another." });
  }
  const settings = await getAppointmentSettings();
  const endTime = new Date(startMs + settings.slotMinutes * 60 * 1000).toISOString();

  if (!isSlotWithinSettings(startTime, settings)) {
    return res.status(400).json({ error: "That time is outside our booking hours — please pick an available slot." });
  }

  // Same per-day advisory lock as /book — closes the same TOCTOU window
  // between the clash-check and the actual write.
  try {
    await withDayBookingLock(startTime, async () => {
      const clash = await query<any>(
        `SELECT 1 FROM altax.v3_appointments WHERE status = 'Scheduled' AND appointment_id <> $1 AND start_time < $3 AND end_time > $2 LIMIT 1`,
        [appt.appointment_id, startTime, endTime]
      );
      if (clash.length) throw new Error("__clash__");
      await query(
        `UPDATE altax.v3_appointments SET start_time = $2, end_time = $3, reminder_sent_at = NULL, reminder_lead_minutes_sent = '{}', updated_at = now() WHERE appointment_id = $1`,
        [appt.appointment_id, startTime, endTime]
      );
    });
  } catch (err: any) {
    if (err?.message === "__clash__") {
      return res.status(409).json({ error: "That time slot was just booked by someone else — please pick another." });
    }
    throw err;
  }
  await logAudit("Calendar", "UPDATE_APPOINTMENT", appt.appointment_id, "", "", appt.title,
    `Appointment "${appt.title}" rescheduled by the client via the manage-appointment link.`, "Public Manage Link");

  const updated = await queryOne<any>(`SELECT * FROM altax.v3_appointments WHERE appointment_id = $1`, [appt.appointment_id]);
  try {
    await notifyAppointment({ ...updated, client_name: appt.client_name }, "Appointment Confirmation", "Public Manage Link", req);
  } catch {
    // Best-effort — the reschedule itself already succeeded and is logged above.
  }
  res.json({ ok: true });
}));
