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

export const DEFAULT_APPOINTMENT_SETTINGS = {
  bookableWeekdays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false },
  slotMinutes: 60,
  businessStartHour: 9,
  businessEndHour: 17,
  maxDaysAhead: 60,
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

export interface AppointmentSettings {
  bookableWeekdays: { mon: boolean; tue: boolean; wed: boolean; thu: boolean; fri: boolean; sat: boolean; sun: boolean };
  slotMinutes: number;
  businessStartHour: number;
  businessEndHour: number;
  maxDaysAhead: number;
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
    businessStartHour: row?.business_start_hour ?? d.businessStartHour,
    businessEndHour: row?.business_end_hour ?? d.businessEndHour,
    maxDaysAhead: row?.max_days_ahead ?? d.maxDaysAhead,
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
  const merged = {
    bookable_mon: w.mon, bookable_tue: w.tue, bookable_wed: w.wed, bookable_thu: w.thu, bookable_fri: w.fri, bookable_sat: w.sat, bookable_sun: w.sun,
    slot_minutes: fields.slotMinutes ?? existing.slotMinutes,
    business_start_hour: fields.businessStartHour ?? existing.businessStartHour,
    business_end_hour: fields.businessEndHour ?? existing.businessEndHour,
    max_days_ahead: fields.maxDaysAhead ?? existing.maxDaysAhead,
    location_name: fields.locationName ?? existing.locationName,
    location_address: fields.locationAddress ?? existing.locationAddress,
    location_map_url: fields.locationMapUrl ?? existing.locationMapUrl,
    policy_message_en: fields.policyMessageEn ?? existing.policyMessageEn,
    policy_message_ar: fields.policyMessageAr ?? existing.policyMessageAr,
  };
  await query(
    `INSERT INTO altax.v3_appointment_settings
       (id, bookable_mon, bookable_tue, bookable_wed, bookable_thu, bookable_fri, bookable_sat, bookable_sun,
        slot_minutes, business_start_hour, business_end_hour, max_days_ahead,
        location_name, location_address, location_map_url, policy_message_en, policy_message_ar, updated_at, updated_by)
     VALUES ('APPT-1', $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now(), $17)
     ON CONFLICT (id) DO UPDATE SET
       bookable_mon=$1, bookable_tue=$2, bookable_wed=$3, bookable_thu=$4, bookable_fri=$5, bookable_sat=$6, bookable_sun=$7,
       slot_minutes=$8, business_start_hour=$9, business_end_hour=$10, max_days_ahead=$11,
       location_name=$12, location_address=$13, location_map_url=$14, policy_message_en=$15, policy_message_ar=$16,
       updated_at = now(), updated_by=$17`,
    [merged.bookable_mon, merged.bookable_tue, merged.bookable_wed, merged.bookable_thu, merged.bookable_fri, merged.bookable_sat, merged.bookable_sun,
      merged.slot_minutes, merged.business_start_hour, merged.business_end_hour, merged.max_days_ahead,
      merged.location_name, merged.location_address, merged.location_map_url, merged.policy_message_en, merged.policy_message_ar, fields.updatedBy]
  );
}

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Maps JS Date#getDay() (0=Sun) to the matching bookableWeekdays flag. */
export function isBookableWeekday(settings: AppointmentSettings, jsDay: number): boolean {
  return settings.bookableWeekdays[WEEKDAY_KEYS[jsDay]];
}

export function bookableWeekdayLabel(settings: AppointmentSettings, lang: "en" | "ar" = "en"): string {
  const namesEn: Record<typeof WEEKDAY_KEYS[number], string> = { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" };
  const namesAr: Record<typeof WEEKDAY_KEYS[number], string> = { sun: "الأحد", mon: "الاثنين", tue: "الثلاثاء", wed: "الأربعاء", thu: "الخميس", fri: "الجمعة", sat: "السبت" };
  const names = lang === "ar" ? namesAr : namesEn;
  const ordered: (typeof WEEKDAY_KEYS[number])[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const days = ordered.filter((k) => settings.bookableWeekdays[k]).map((k) => names[k]);
  return days.join(lang === "ar" ? "، " : ", ");
}
