import crypto from "crypto";
import { query, queryOne } from "../../config/db";

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/**
 * Closes a kiosk punch and folds the worked duration into v3_time_entries —
 * the SAME table Staff Capacity (reports.routes.ts's computeStaffCapacity)
 * already reads, so kiosk-recorded hours show up there automatically with
 * no separate reporting path. entry_date is the clock-IN date (not
 * clock-out) so an overnight shift still lands on the day it started.
 *
 * Multiple clock-in/out cycles by the same person on the same day ADD onto
 * one v3_time_entries row (matched by user_email + entry_date +
 * source_system='Kiosk') rather than creating a new row each time — a
 * lunch-break clock-out/back-in shouldn't fragment the day's total.
 */
export async function closePunchAndRecordHours(
  punch: { punch_id: string; user_id: string; clock_in_at: string | Date },
  clockOutAt: Date,
  note: string
): Promise<{ hoursAdded: number; timeEntryId: string }> {
  const clockInAt = new Date(punch.clock_in_at);
  const hoursAdded = Math.max(0, Math.round(((clockOutAt.getTime() - clockInAt.getTime()) / 3600000) * 100) / 100);
  // Real incident, 2026-09-18: a 9:26 PM Eastern clock-in is already 1:26 AM
  // UTC the next day, so a naive toISOString().slice(0,10) silently recorded
  // an evening punch under tomorrow's date. Read the calendar date in the
  // firm's own timezone instead (same convention as appointments/reminders
  // elsewhere in this codebase) so it matches the day the person actually
  // worked, not whatever day UTC happened to be at that moment.
  const entryDate = clockInAt.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  const user = await queryOne<any>(`SELECT email FROM altax.v3_users WHERE user_id = $1`, [punch.user_id]);
  const userEmail = user?.email || punch.user_id;

  const existing = await queryOne<any>(
    `SELECT time_entry_id, hours FROM altax.v3_time_entries WHERE user_email = $1 AND entry_date = $2 AND source_system = 'Kiosk'`,
    [userEmail, entryDate]
  );

  let timeEntryId: string;
  if (existing) {
    timeEntryId = existing.time_entry_id;
    await query(
      `UPDATE altax.v3_time_entries SET hours = hours + $2, updated_at = now() WHERE time_entry_id = $1`,
      [timeEntryId, hoursAdded]
    );
  } else {
    timeEntryId = `TE-${idSuffix()}`;
    await query(
      `INSERT INTO altax.v3_time_entries (time_entry_id, user_email, entry_date, hours, description, status, source_system, source_record_id)
       VALUES ($1,$2,$3,$4,'Kiosk clock-in/out','Submitted','Kiosk',$5)`,
      [timeEntryId, userEmail, entryDate, hoursAdded, punch.punch_id]
    );
  }

  await query(
    `UPDATE altax.v3_kiosk_punches SET clock_out_at = $2, time_entry_id = $3 WHERE punch_id = $1`,
    [punch.punch_id, clockOutAt.toISOString(), timeEntryId]
  );

  return { hoursAdded, timeEntryId };
}
