/**
 * Per-staff working-hours overrides for appointment booking — v3_staff_schedules
 * (sql/144). Every staff member's hours default to the firm-wide
 * v3_appointment_settings row (appointmentSettings.ts); a row here overrides
 * individual days only, field by field — no row at all (the common case)
 * means 100% firm defaults, every day. Kept as its own module (not folded
 * into appointmentSettings.ts) since that file documents itself as firm-wide
 * only; this one is explicitly the per-person layer on top of it.
 */
import { query, queryOne } from "../config/db";
import { hoursForDay, type AppointmentSettings, type DayHours } from "./appointmentSettings";

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type WeekdayKey = typeof WEEKDAY_KEYS[number];

export interface StaffSchedule {
  /** null = no override for that day, inherit the firm-wide flag. */
  bookableWeekdays: Record<WeekdayKey, boolean | null>;
  /** startHour/endHour null = no override for that day, inherit hoursForDay's firm-wide result. */
  dayHours: Record<WeekdayKey, DayHours>;
}

const EMPTY_SCHEDULE: StaffSchedule = {
  bookableWeekdays: { sun: null, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null },
  dayHours: {
    sun: { startHour: null, endHour: null }, mon: { startHour: null, endHour: null }, tue: { startHour: null, endHour: null },
    wed: { startHour: null, endHour: null }, thu: { startHour: null, endHour: null }, fri: { startHour: null, endHour: null },
    sat: { startHour: null, endHour: null },
  },
};

function rowToSchedule(row: any): StaffSchedule {
  return {
    bookableWeekdays: {
      sun: row.bookable_sun, mon: row.bookable_mon, tue: row.bookable_tue, wed: row.bookable_wed,
      thu: row.bookable_thu, fri: row.bookable_fri, sat: row.bookable_sat,
    },
    dayHours: {
      sun: { startHour: row.sun_start_hour, endHour: row.sun_end_hour },
      mon: { startHour: row.mon_start_hour, endHour: row.mon_end_hour },
      tue: { startHour: row.tue_start_hour, endHour: row.tue_end_hour },
      wed: { startHour: row.wed_start_hour, endHour: row.wed_end_hour },
      thu: { startHour: row.thu_start_hour, endHour: row.thu_end_hour },
      fri: { startHour: row.fri_start_hour, endHour: row.fri_end_hour },
      sat: { startHour: row.sat_start_hour, endHour: row.sat_end_hour },
    },
  };
}

/** Batch load — for the availability computation, which needs every bookable staff member's overrides (if any) in one query. Staff with no row at all just aren't in the returned map; callers should treat a missing entry the same as EMPTY_SCHEDULE. */
export async function loadStaffSchedules(userIds: string[]): Promise<Map<string, StaffSchedule>> {
  const map = new Map<string, StaffSchedule>();
  if (!userIds.length) return map;
  const rows = await query<any>(`SELECT * FROM altax.v3_staff_schedules WHERE user_id = ANY($1::text[])`, [userIds]);
  for (const row of rows) map.set(row.user_id, rowToSchedule(row));
  return map;
}

/** Single lookup — for the Users & Access editor. Never null in the return value itself; a user with no saved overrides gets EMPTY_SCHEDULE back so the editor always has something to render. */
export async function getStaffSchedule(userId: string): Promise<StaffSchedule> {
  const row = await queryOne<any>(`SELECT * FROM altax.v3_staff_schedules WHERE user_id = $1`, [userId]);
  return row ? rowToSchedule(row) : { ...EMPTY_SCHEDULE };
}

export async function saveStaffSchedule(userId: string, schedule: StaffSchedule, updatedBy: string): Promise<void> {
  const bw = schedule.bookableWeekdays;
  const dh = schedule.dayHours;
  await query(
    `INSERT INTO altax.v3_staff_schedules
       (user_id, bookable_mon, bookable_tue, bookable_wed, bookable_thu, bookable_fri, bookable_sat, bookable_sun,
        mon_start_hour, mon_end_hour, tue_start_hour, tue_end_hour, wed_start_hour, wed_end_hour,
        thu_start_hour, thu_end_hour, fri_start_hour, fri_end_hour, sat_start_hour, sat_end_hour,
        sun_start_hour, sun_end_hour, updated_at, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now(),$23)
     ON CONFLICT (user_id) DO UPDATE SET
       bookable_mon=$2, bookable_tue=$3, bookable_wed=$4, bookable_thu=$5, bookable_fri=$6, bookable_sat=$7, bookable_sun=$8,
       mon_start_hour=$9, mon_end_hour=$10, tue_start_hour=$11, tue_end_hour=$12, wed_start_hour=$13, wed_end_hour=$14,
       thu_start_hour=$15, thu_end_hour=$16, fri_start_hour=$17, fri_end_hour=$18, sat_start_hour=$19, sat_end_hour=$20,
       sun_start_hour=$21, sun_end_hour=$22, updated_at = now(), updated_by=$23`,
    [userId, bw.mon, bw.tue, bw.wed, bw.thu, bw.fri, bw.sat, bw.sun,
      dh.mon.startHour, dh.mon.endHour, dh.tue.startHour, dh.tue.endHour, dh.wed.startHour, dh.wed.endHour,
      dh.thu.startHour, dh.thu.endHour, dh.fri.startHour, dh.fri.endHour, dh.sat.startHour, dh.sat.endHour,
      dh.sun.startHour, dh.sun.endHour, updatedBy]
  );
}

/** Staff's own override for this weekday if set, else the firm-wide flag. */
export function isStaffBookableWeekday(settings: AppointmentSettings, schedule: StaffSchedule | undefined, jsDay: number): boolean {
  const key = WEEKDAY_KEYS[jsDay];
  const override = schedule?.bookableWeekdays[key];
  return override !== null && override !== undefined ? override : settings.bookableWeekdays[key];
}

/** Staff's own hours override for this weekday if set, else the firm-wide hoursForDay result (which already falls back to businessStartHour/EndHour on its own). */
export function hoursForStaffDay(settings: AppointmentSettings, schedule: StaffSchedule | undefined, jsDay: number): { startHour: number; endHour: number } {
  const key = WEEKDAY_KEYS[jsDay];
  const override = schedule?.dayHours[key];
  const firmHours = hoursForDay(settings, jsDay);
  return {
    startHour: override?.startHour ?? firmHours.startHour,
    endHour: override?.endHour ?? firmHours.endHour,
  };
}
