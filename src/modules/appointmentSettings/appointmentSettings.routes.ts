import { Router, Response } from "express";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { getAppointmentSettings, updateAppointmentSettings, REMINDER_LEAD_PRESETS } from "../../common/appointmentSettings";

export const appointmentSettingsRouter = Router();

/** Any authed staff/admin can read — the "+ New Appointment" and Calendar views both need slot length/hours to build a sane default. */
appointmentSettingsRouter.get("/", requireAuth, asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json(await getAppointmentSettings());
}));

/** Admin-only — these rules govern every appointment the whole firm books, including the public booking page. */
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Parses the client's { mon: { startHour, endHour }, ... } payload, dropping any day whose value isn't a well-formed override so a bad entry can't corrupt other days. */
function parseDayHours(raw: unknown): Record<string, { startHour: number | null; endHour: number | null }> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, { startHour: number | null; endHour: number | null }> = {};
  for (const key of DAY_KEYS) {
    const entry = (raw as any)[key];
    if (!entry || typeof entry !== "object") continue;
    const startHour = typeof entry.startHour === "number" && Number.isFinite(entry.startHour) ? entry.startHour : null;
    const endHour = typeof entry.endHour === "number" && Number.isFinite(entry.endHour) ? entry.endHour : null;
    out[key] = { startHour, endHour };
  }
  return Object.keys(out).length ? out : undefined;
}

/** Drops anything not in the fixed preset list so a bad value can't slip past the DB CHECK constraint into a 500. */
function parseReminderLeadMinutes(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const allowed = new Set(REMINDER_LEAD_PRESETS.map((p) => p.minutes));
  const out = Array.from(new Set(raw.filter((v) => typeof v === "number" && allowed.has(v))));
  return out;
}

appointmentSettingsRouter.patch("/", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const num = (v: unknown, fallback: undefined) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

  await updateAppointmentSettings({
    bookableWeekdays: body.bookableWeekdays && typeof body.bookableWeekdays === "object" ? body.bookableWeekdays : undefined,
    slotMinutes: num(body.slotMinutes, undefined),
    businessStartHour: num(body.businessStartHour, undefined),
    businessEndHour: num(body.businessEndHour, undefined),
    dayHours: parseDayHours(body.dayHours) as any,
    maxDaysAhead: num(body.maxDaysAhead, undefined),
    reminderLeadMinutes: parseReminderLeadMinutes(body.reminderLeadMinutes),
    locationName: typeof body.locationName === "string" ? body.locationName.trim() : undefined,
    locationAddress: typeof body.locationAddress === "string" ? body.locationAddress.trim() : undefined,
    locationMapUrl: typeof body.locationMapUrl === "string" ? body.locationMapUrl.trim() : undefined,
    policyMessageEn: typeof body.policyMessageEn === "string" ? body.policyMessageEn : undefined,
    policyMessageAr: typeof body.policyMessageAr === "string" ? body.policyMessageAr : undefined,
    updatedBy: req.user!.email,
  });

  await logAudit("Calendar", "UPDATE_APPOINTMENT_SETTINGS", "APPT-1", "", "", "", "Appointment booking settings updated.", req.user!.email);

  res.json(await getAppointmentSettings());
}));
