/**
 * Public, no-login appointment booking — the marketing site's "Book a
 * Consultation" button (previously an external Google Calendar link) and
 * the /book page linked from SMS/WhatsApp greeting messages. Creates a real
 * row in the same altax.v3_appointments table the staff Calendar reads, via
 * appointments.routes.ts's shared createAppointment() — so a public booking
 * shows up on the team calendar exactly like one a staff member books
 * directly, gets the same email/SMS confirmation and day-before reminder.
 */
import { Router, Request, Response } from "express";
import { query } from "../../config/db";
import { asyncHandler } from "../../common/asyncHandler";
import { rateLimit } from "../../common/rateLimit";
import { sendEmail, NotConfiguredError } from "../../common/notifications";
import { createAppointment } from "../appointments/appointments.routes";

export const publicAppointmentsRouter = Router();

// Mon-Fri, 9:00 AM - 5:00 PM America/New_York, 30-minute slots — a fixed
// business-hours default since there's no per-staff public scheduling yet
// (every appointment is firm-wide, matching the internal Calendar's own
// firm-wide-not-per-assignee model).
const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 17;
const SLOT_MINUTES = 30;
const MAX_DAYS_AHEAD = 60;

const availabilityLimiter = rateLimit({ name: "public-appointments-availability", windowMs: 5 * 60 * 1000, max: 60 });
const bookLimiter = rateLimit({ name: "public-appointments-book", windowMs: 15 * 60 * 1000, max: 8 });

function isWeekend(y: number, m: number, d: number): boolean {
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}

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

publicAppointmentsRouter.get("/availability", availabilityLimiter, asyncHandler(async (req: Request, res: Response) => {
  const dateStr = String(req.query.date || "").trim();
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return res.status(400).json({ error: "date is required as YYYY-MM-DD." });
  const [, yStr, moStr, dStr] = m;
  const y = Number(yStr), mo = Number(moStr), d = Number(dStr);

  const today = new Date();
  const requested = new Date(Date.UTC(y, mo - 1, d));
  const daysAhead = Math.floor((requested.getTime() - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86400000);
  if (daysAhead < 0 || daysAhead > MAX_DAYS_AHEAD) return res.json({ slots: [] });
  if (isWeekend(y, mo, d)) return res.json({ slots: [] });

  const dayStartIso = slotToUtcIso(y, mo, d, 0, 0);
  const dayEndIso = slotToUtcIso(y, mo, d, 23, 59);
  const booked = await query<any>(
    `SELECT start_time, end_time FROM altax.v3_appointments
      WHERE status = 'Scheduled' AND start_time < $2 AND end_time > $1`,
    [dayStartIso, dayEndIso]
  );
  const bookedRanges = booked.map((b: any) => ({ start: new Date(b.start_time).getTime(), end: new Date(b.end_time).getTime() }));

  const slots: string[] = [];
  const nowMs = Date.now();
  for (let hour = BUSINESS_START_HOUR; hour < BUSINESS_END_HOUR; hour++) {
    for (let minute = 0; minute < 60; minute += SLOT_MINUTES) {
      const startIso = slotToUtcIso(y, mo, d, hour, minute);
      const startMs = new Date(startIso).getTime();
      const endMs = startMs + SLOT_MINUTES * 60 * 1000;
      if (startMs <= nowMs) continue;
      const overlaps = bookedRanges.some((r) => startMs < r.end && endMs > r.start);
      if (!overlaps) slots.push(startIso);
    }
  }
  res.json({ slots });
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
  if (!name || !email || !phone || !startTime) {
    return res.status(400).json({ error: "Name, email, phone, and a time slot are required." });
  }

  const startMs = new Date(startTime).getTime();
  if (!Number.isFinite(startMs) || startMs <= Date.now()) {
    return res.status(400).json({ error: "That time slot is no longer valid — please pick another." });
  }
  const endTime = new Date(startMs + SLOT_MINUTES * 60 * 1000).toISOString();

  // Re-check the slot is still open right before booking — two visitors could
  // otherwise both grab the same slot between loading availability and submitting.
  const clash = await query<any>(
    `SELECT 1 FROM altax.v3_appointments WHERE status = 'Scheduled' AND start_time < $2 AND end_time > $1 LIMIT 1`,
    [startTime, endTime]
  );
  if (clash.length) return res.status(409).json({ error: "That time slot was just booked by someone else — please pick another." });

  let appointmentId: string;
  try {
    const created = await createAppointment({
      title: "Consultation", contactName: name, contactEmail: email, contactPhone: phone,
      startTime, endTime, notes: reason || undefined, notifyClient: true,
      createdBy: "Public Booking Form", req,
    });
    appointmentId = created.appointmentId;
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Could not book this appointment." });
  }

  try {
    const admins = await query<any>(
      `SELECT email FROM altax.v3_users WHERE active = true AND lower(role) = 'admin' AND email IS NOT NULL AND email <> ''`
    );
    const when = new Date(startTime).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" });
    const html = `
      <h2>New consultation booked online</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Phone:</strong> ${phone}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>When:</strong> ${when} ET</p>
      ${reason ? `<p><strong>Notes:</strong><br>${reason.replace(/\n/g, "<br>")}</p>` : ""}
      <p style="color:#777;font-size:12px;">Booked via the public /book page · ${appointmentId}</p>
    `;
    for (const admin of admins) {
      await sendEmail({ to: admin.email, subject: `New consultation booked — ${name}`, html });
    }
  } catch (err) {
    if (!(err instanceof NotConfiguredError)) {
      // eslint-disable-next-line no-console
      console.error("Public booking admin notification failed:", err);
    }
  }

  res.status(201).json({ ok: true });
}));
