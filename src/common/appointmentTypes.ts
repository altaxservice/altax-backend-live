/**
 * Appointment Types — the admin-configurable list of named durations (e.g.
 * "Quick Question" 15 min, "Full Consultation" 60 min) shown as a picker on
 * the public /book page and on the internal "+ New Appointment" form. See
 * sql/036_appointment_types.sql's header comment for how this differs from
 * appointmentSettings.ts's slotMinutes (now the spacing between candidate
 * start times, not the appointment's actual length).
 */
import { query, queryOne } from "../config/db";

export interface AppointmentType {
  appointmentTypeId: string;
  name: string;
  durationMinutes: number;
  active: boolean;
  sortOrder: number;
}

function fromRow(row: any): AppointmentType {
  return {
    appointmentTypeId: row.appointment_type_id,
    name: row.name,
    durationMinutes: row.duration_minutes,
    active: row.active,
    sortOrder: row.sort_order,
  };
}

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

export async function listAppointmentTypes(activeOnly: boolean): Promise<AppointmentType[]> {
  const rows = await query<any>(
    `SELECT * FROM altax.v3_appointment_types ${activeOnly ? "WHERE active = true" : ""} ORDER BY sort_order ASC, duration_minutes ASC`
  );
  return rows.map(fromRow);
}

export async function createAppointmentType(input: { name: string; durationMinutes: number; sortOrder?: number }): Promise<AppointmentType> {
  const name = input.name.trim();
  if (!name) throw new Error("Name is required.");
  const durationMinutes = Math.trunc(input.durationMinutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 480) {
    throw new Error("Duration must be between 1 and 480 minutes.");
  }
  const appointmentTypeId = `APPTTYPE-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_appointment_types (appointment_type_id, name, duration_minutes, sort_order)
     VALUES ($1,$2,$3,$4)`,
    [appointmentTypeId, name, durationMinutes, Math.trunc(input.sortOrder ?? 0)]
  );
  const row = await queryOne<any>(`SELECT * FROM altax.v3_appointment_types WHERE appointment_type_id = $1`, [appointmentTypeId]);
  return fromRow(row);
}

export async function updateAppointmentType(
  appointmentTypeId: string,
  patch: { name?: string; durationMinutes?: number; active?: boolean; sortOrder?: number }
): Promise<AppointmentType> {
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_appointment_types WHERE appointment_type_id = $1`, [appointmentTypeId]);
  if (!existing) throw new Error("Appointment type not found.");
  const name = patch.name !== undefined ? patch.name.trim() : existing.name;
  if (!name) throw new Error("Name is required.");
  const durationMinutes = patch.durationMinutes !== undefined ? Math.trunc(patch.durationMinutes) : existing.duration_minutes;
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 480) {
    throw new Error("Duration must be between 1 and 480 minutes.");
  }
  const active = patch.active !== undefined ? patch.active : existing.active;
  const sortOrder = patch.sortOrder !== undefined ? Math.trunc(patch.sortOrder) : existing.sort_order;
  await query(
    `UPDATE altax.v3_appointment_types SET name=$2, duration_minutes=$3, active=$4, sort_order=$5, updated_at=now() WHERE appointment_type_id=$1`,
    [appointmentTypeId, name, durationMinutes, active, sortOrder]
  );
  const row = await queryOne<any>(`SELECT * FROM altax.v3_appointment_types WHERE appointment_type_id = $1`, [appointmentTypeId]);
  return fromRow(row);
}

/**
 * Resolves the real duration (in minutes) for a booking request. Never trusts
 * a client-supplied minute count directly — only an appointmentTypeId, looked
 * up server-side — so a forged request can't request an arbitrary-length
 * appointment. Falls back to fallbackMinutes (the settings grid step) when no
 * type id is given or it doesn't match an active type, matching the exact
 * pre-appointment-types behavior for any caller that doesn't pass one.
 */
export async function resolveAppointmentDuration(appointmentTypeId: string | null | undefined, fallbackMinutes: number): Promise<{ durationMinutes: number; appointmentTypeId: string | null; appointmentTypeName: string | null }> {
  const id = String(appointmentTypeId || "").trim();
  if (!id) return { durationMinutes: fallbackMinutes, appointmentTypeId: null, appointmentTypeName: null };
  const row = await queryOne<any>(`SELECT * FROM altax.v3_appointment_types WHERE appointment_type_id = $1 AND active = true`, [id]);
  if (!row) return { durationMinutes: fallbackMinutes, appointmentTypeId: null, appointmentTypeName: null };
  return { durationMinutes: row.duration_minutes, appointmentTypeId: row.appointment_type_id, appointmentTypeName: row.name };
}
