/**
 * Admin-editable appointment booking rules — which weekdays are bookable, slot
 * length, business hours, booking horizon, office location/map link, and the
 * bilingual policy text appended to every confirmation/reminder. Editable via
 * the Calendar page's Settings tab (admin-only). Same singleton-row pattern as
 * firmProfile.ts: v3_appointment_settings is the source of truth once a row
 * exists; DEFAULT_APPOINTMENT_SETTINGS is only the fallback before the firm
 * has ever saved anything through that page.
 */
import { queryOne, query } from "../config/db";
import { DEFAULT_FIRM_PROFILE } from "./firmProfile";

const NO_OVERRIDE: DayHours = { startHour: null, endHour: null };

/**
 * Fixed preset list for reminder lead times — admin picks any combination via
 * checkboxes rather than a free-text field, since the sweep job (server.ts,
 * hourly) can only reliably catch a preset it explicitly knows to check for.
 * The DB CHECK constraint on v3_appointment_settings.reminder_lead_minutes
 * mirrors this exact list.
 */
export type StaffReminderChannel = "email" | "sms" | "both";
export const STAFF_REMINDER_CHANNELS: StaffReminderChannel[] = ["email", "sms", "both"];

export const REMINDER_LEAD_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 10080, label: "1 week before" },
  { minutes: 4320, label: "3 days before" },
  { minutes: 1440, label: "1 day before" },
  { minutes: 240, label: "4 hours before" },
  { minutes: 120, label: "2 hours before" },
  { minutes: 60, label: "1 hour before" },
];

export const DEFAULT_APPOINTMENT_SETTINGS = {
  bookableWeekdays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false },
  slotMinutes: 60,
  // Buffer enforced on both sides of every existing appointment when checking
  // a new booking for conflicts — keeps back-to-back appointments from
  // touching with zero turnaround time. Separate from slotMinutes (the
  // picker's time-grid step) and from an Appointment Type's duration.
  gapMinutes: 15,
  businessStartHour: 9,
  businessEndHour: 17,
  dayHours: { mon: NO_OVERRIDE, tue: NO_OVERRIDE, wed: NO_OVERRIDE, thu: NO_OVERRIDE, fri: NO_OVERRIDE, sat: NO_OVERRIDE, sun: NO_OVERRIDE },
  maxDaysAhead: 60,
  // Matches the DB column default — day-before only, same as the old hardcoded behavior.
  reminderLeadMinutes: [1440] as number[],
  // Matches the DB column default — email only, same as the old hardcoded behavior.
  staffReminderChannel: "email" as StaffReminderChannel,
  locationName: DEFAULT_FIRM_PROFILE.firmName,
  locationAddress: `${DEFAULT_FIRM_PROFILE.street}, ${DEFAULT_FIRM_PROFILE.city}, ${DEFAULT_FIRM_PROFILE.state} ${DEFAULT_FIRM_PROFILE.zipCode}`,
  locationMapUrl: "",
  policyMessageEn:
    "Important Appointment Policy:\n\n" +
    "- If your appointment shows a time range (for example 2:00 PM - 3:00 PM), your appointment starts promptly at the start time.\n" +
    "- This is not an open arrival window — please do not arrive at any time within the range.\n" +
    "- Late arrivals may result in reduced meeting time or rescheduling.\n\n" +
    "All appointments are scheduled and displayed in Eastern Time (ET) - New York time.\n\n" +
    "Please bring all required documents and relevant information.",
  policyMessageAr:
    "سياسة الموعد المهمة:\n\n" +
    "- إذا كان موعدك ظاهرًا كنطاق زمني (مثلاً من 2:00 إلى 3:00 مساءً)، فهذا يعني أن الموعد يبدأ تمامًا في وقت البداية.\n" +
    "- هذا ليس وقت حضور مفتوح — يرجى عدم الحضور في أي وقت داخل هذا النطاق.\n" +
    "- التأخير قد يؤدي إلى تقليل مدة الجلسة أو إعادة جدولة الموعد.\n\n" +
    "جميع المواعيد تُجدوَل وتُعرض بتوقيت شرق أمريكا (ET) - توقيت نيويورك.\n\n" +
    "يرجى إحضار جميع المستندات والمعلومات اللازمة.",
} as const;

export interface DayHours {
  startHour: number | null;
  endHour: number | null;
}

export interface AppointmentSettings {
  bookableWeekdays: { mon: boolean; tue: boolean; wed: boolean; thu: boolean; fri: boolean; sat: boolean; sun: boolean };
  slotMinutes: number;
  gapMinutes: number;
  businessStartHour: number;
  businessEndHour: number;
  /** Optional per-weekday hour overrides. A day with startHour/endHour === null falls back to businessStartHour/businessEndHour. */
  dayHours: { mon: DayHours; tue: DayHours; wed: DayHours; thu: DayHours; fri: DayHours; sat: DayHours; sun: DayHours };
  maxDaysAhead: number;
  reminderLeadMinutes: number[];
  staffReminderChannel: StaffReminderChannel;
  locationName: string;
  locationAddress: string;
  locationMapUrl: string;
  policyMessageEn: string;
  policyMessageAr: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

export async function getAppointmentSettings(): Promise<AppointmentSettings> {
  const row = await queryOne<any>(`SELECT * FROM altax.v3_appointment_settings WHERE id = 'APPT-1'`);
  const d = DEFAULT_APPOINTMENT_SETTINGS;
  return {
    bookableWeekdays: row
      ? { mon: row.bookable_mon, tue: row.bookable_tue, wed: row.bookable_wed, thu: row.bookable_thu, fri: row.bookable_fri, sat: row.bookable_sat, sun: row.bookable_sun }
      : { ...d.bookableWeekdays },
    slotMinutes: row?.slot_minutes ?? d.slotMinutes,
    gapMinutes: row?.gap_minutes ?? d.gapMinutes,
    businessStartHour: row?.business_start_hour ?? d.businessStartHour,
    businessEndHour: row?.business_end_hour ?? d.businessEndHour,
    dayHours: row
      ? {
          mon: { startHour: row.mon_start_hour, endHour: row.mon_end_hour },
          tue: { startHour: row.tue_start_hour, endHour: row.tue_end_hour },
          wed: { startHour: row.wed_start_hour, endHour: row.wed_end_hour },
          thu: { startHour: row.thu_start_hour, endHour: row.thu_end_hour },
          fri: { startHour: row.fri_start_hour, endHour: row.fri_end_hour },
          sat: { startHour: row.sat_start_hour, endHour: row.sat_end_hour },
          sun: { startHour: row.sun_start_hour, endHour: row.sun_end_hour },
        }
      : { ...d.dayHours },
    maxDaysAhead: row?.max_days_ahead ?? d.maxDaysAhead,
    reminderLeadMinutes: row?.reminder_lead_minutes ?? [...d.reminderLeadMinutes],
    staffReminderChannel: (row?.staff_reminder_channel as StaffReminderChannel) ?? d.staffReminderChannel,
    locationName: row?.location_name ?? d.locationName,
    locationAddress: row?.location_address ?? d.locationAddress,
    locationMapUrl: row?.location_map_url ?? d.locationMapUrl,
    policyMessageEn: row?.policy_message_en ?? d.policyMessageEn,
    policyMessageAr: row?.policy_message_ar ?? d.policyMessageAr,
    updatedBy: row?.updated_by ?? null,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function updateAppointmentSettings(fields: Partial<Omit<AppointmentSettings, "updatedBy" | "updatedAt">> & { updatedBy: string }): Promise<void> {
  const existing = await getAppointmentSettings();
  const w = { ...existing.bookableWeekdays, ...fields.bookableWeekdays };
  const dh = { ...existing.dayHours, ...fields.dayHours };
  const merged = {
    bookable_mon: w.mon, bookable_tue: w.tue, bookable_wed: w.wed, bookable_thu: w.thu, bookable_fri: w.fri, bookable_sat: w.sat, bookable_sun: w.sun,
    slot_minutes: fields.slotMinutes ?? existing.slotMinutes,
    gap_minutes: fields.gapMinutes ?? existing.gapMinutes,
    business_start_hour: fields.businessStartHour ?? existing.businessStartHour,
    business_end_hour: fields.businessEndHour ?? existing.businessEndHour,
    max_days_ahead: fields.maxDaysAhead ?? existing.maxDaysAhead,
    reminder_lead_minutes: fields.reminderLeadMinutes ?? existing.reminderLeadMinutes,
    staff_reminder_channel: fields.staffReminderChannel ?? existing.staffReminderChannel,
    location_name: fields.locationName ?? existing.locationName,
    location_address: fields.locationAddress ?? existing.locationAddress,
    location_map_url: fields.locationMapUrl ?? existing.locationMapUrl,
    policy_message_en: fields.policyMessageEn ?? existing.policyMessageEn,
    policy_message_ar: fields.policyMessageAr ?? existing.policyMessageAr,
  };
  await query(
    `INSERT INTO altax.v3_appointment_settings
       (id, bookable_mon, bookable_tue, bookable_wed, bookable_thu, bookable_fri, bookable_sat, bookable_sun,
        slot_minutes, gap_minutes, business_start_hour, business_end_hour, max_days_ahead,
        location_name, location_address, location_map_url, policy_message_en, policy_message_ar,
        mon_start_hour, mon_end_hour, tue_start_hour, tue_end_hour, wed_start_hour, wed_end_hour,
        thu_start_hour, thu_end_hour, fri_start_hour, fri_end_hour, sat_start_hour, sat_end_hour,
        sun_start_hour, sun_end_hour, reminder_lead_minutes, staff_reminder_channel, updated_at, updated_by)
     VALUES ('APPT-1', $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
             $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33, now(), $34)
     ON CONFLICT (id) DO UPDATE SET
       bookable_mon=$1, bookable_tue=$2, bookable_wed=$3, bookable_thu=$4, bookable_fri=$5, bookable_sat=$6, bookable_sun=$7,
       slot_minutes=$8, gap_minutes=$9, business_start_hour=$10, business_end_hour=$11, max_days_ahead=$12,
       location_name=$13, location_address=$14, location_map_url=$15, policy_message_en=$16, policy_message_ar=$17,
       mon_start_hour=$18, mon_end_hour=$19, tue_start_hour=$20, tue_end_hour=$21, wed_start_hour=$22, wed_end_hour=$23,
       thu_start_hour=$24, thu_end_hour=$25, fri_start_hour=$26, fri_end_hour=$27, sat_start_hour=$28, sat_end_hour=$29,
       sun_start_hour=$30, sun_end_hour=$31, reminder_lead_minutes=$32, staff_reminder_channel=$33,
       updated_at = now(), updated_by=$34`,
    [merged.bookable_mon, merged.bookable_tue, merged.bookable_wed, merged.bookable_thu, merged.bookable_fri, merged.bookable_sat, merged.bookable_sun,
      merged.slot_minutes, merged.gap_minutes, merged.business_start_hour, merged.business_end_hour, merged.max_days_ahead,
      merged.location_name, merged.location_address, merged.location_map_url, merged.policy_message_en, merged.policy_message_ar,
      dh.mon.startHour, dh.mon.endHour, dh.tue.startHour, dh.tue.endHour, dh.wed.startHour, dh.wed.endHour,
      dh.thu.startHour, dh.thu.endHour, dh.fri.startHour, dh.fri.endHour, dh.sat.startHour, dh.sat.endHour,
      dh.sun.startHour, dh.sun.endHour, merged.reminder_lead_minutes, merged.staff_reminder_channel, fields.updatedBy]
  );
}

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Maps JS Date#getDay() (0=Sun) to the matching bookableWeekdays flag. */
export function isBookableWeekday(settings: AppointmentSettings, jsDay: number): boolean {
  return settings.bookableWeekdays[WEEKDAY_KEYS[jsDay]];
}

/** Resolves the effective business hours for a given JS weekday (0=Sun), falling back to the firm-wide default when that day has no override. */
export function hoursForDay(settings: AppointmentSettings, jsDay: number): { startHour: number; endHour: number } {
  const override = settings.dayHours[WEEKDAY_KEYS[jsDay]];
  return {
    startHour: override.startHour ?? settings.businessStartHour,
    endHour: override.endHour ?? settings.businessEndHour,
  };
}

export function bookableWeekdayLabel(settings: AppointmentSettings, lang: "en" | "ar" = "en"): string {
  const namesEn: Record<typeof WEEKDAY_KEYS[number], string> = { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" };
  const namesAr: Record<typeof WEEKDAY_KEYS[number], string> = { sun: "الأحد", mon: "الاثنين", tue: "الثلاثاء", wed: "الأربعاء", thu: "الخميس", fri: "الجمعة", sat: "السبت" };
  const names = lang === "ar" ? namesAr : namesEn;
  const ordered: (typeof WEEKDAY_KEYS[number])[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const days = ordered.filter((k) => settings.bookableWeekdays[k]).map((k) => names[k]);
  return days.join(lang === "ar" ? "، " : ", ");
}
