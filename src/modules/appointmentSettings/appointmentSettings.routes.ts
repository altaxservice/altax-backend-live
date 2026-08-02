import { Router, Response } from "express";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { getAppointmentSettings, updateAppointmentSettings } from "../../common/appointmentSettings";

export const appointmentSettingsRouter = Router();

/** Any authed staff/admin can read — the "+ New Appointment" and Calendar views both need slot length/hours to build a sane default. */
appointmentSettingsRouter.get("/", requireAuth, asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json(await getAppointmentSettings());
}));

/** Admin-only — these rules govern every appointment the whole firm books, including the public booking page. */
appointmentSettingsRouter.patch("/", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const num = (v: unknown, fallback: undefined) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

  await updateAppointmentSettings({
    bookableWeekdays: body.bookableWeekdays && typeof body.bookableWeekdays === "object" ? body.bookableWeekdays : undefined,
    slotMinutes: num(body.slotMinutes, undefined),
    businessStartHour: num(body.businessStartHour, undefined),
    businessEndHour: num(body.businessEndHour, undefined),
    maxDaysAhead: num(body.maxDaysAhead, undefined),
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
