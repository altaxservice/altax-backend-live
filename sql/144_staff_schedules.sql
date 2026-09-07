-- Per-staff working-hours overrides for appointment booking — one optional
-- row per staff member, mirroring v3_appointment_settings's own per-weekday
-- column shape exactly. Every column is nullable at the FIELD level (not
-- just "no row = all defaults"): a staff member can override just one day's
-- hours while every other day keeps tracking the firm-wide default in
-- v3_appointment_settings automatically. No row at all (the common case)
-- means 100% firm defaults, every day.
CREATE TABLE IF NOT EXISTS altax.v3_staff_schedules (
    user_id VARCHAR(64) PRIMARY KEY REFERENCES altax.v3_users(user_id) ON DELETE CASCADE,
    bookable_mon BOOLEAN, bookable_tue BOOLEAN, bookable_wed BOOLEAN, bookable_thu BOOLEAN,
    bookable_fri BOOLEAN, bookable_sat BOOLEAN, bookable_sun BOOLEAN,
    mon_start_hour SMALLINT, mon_end_hour SMALLINT,
    tue_start_hour SMALLINT, tue_end_hour SMALLINT,
    wed_start_hour SMALLINT, wed_end_hour SMALLINT,
    thu_start_hour SMALLINT, thu_end_hour SMALLINT,
    fri_start_hour SMALLINT, fri_end_hour SMALLINT,
    sat_start_hour SMALLINT, sat_end_hour SMALLINT,
    sun_start_hour SMALLINT, sun_end_hour SMALLINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by VARCHAR(255)
);
