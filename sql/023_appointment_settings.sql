-- Admin-editable appointment booking rules — which weekdays are bookable, slot
-- length, business hours, how far ahead someone can book, the office
-- location/map link, and the bilingual policy text appended to every
-- confirmation/reminder. Singleton row (id='APPT-1'), same shape as
-- v3_firm_settings — see src/common/firmProfile.ts for the identical pattern.
CREATE TABLE IF NOT EXISTS altax.v3_appointment_settings (
    id VARCHAR(16) PRIMARY KEY DEFAULT 'APPT-1',
    bookable_mon BOOLEAN NOT NULL DEFAULT true,
    bookable_tue BOOLEAN NOT NULL DEFAULT true,
    bookable_wed BOOLEAN NOT NULL DEFAULT true,
    bookable_thu BOOLEAN NOT NULL DEFAULT true,
    bookable_fri BOOLEAN NOT NULL DEFAULT true,
    bookable_sat BOOLEAN NOT NULL DEFAULT false,
    bookable_sun BOOLEAN NOT NULL DEFAULT false,
    slot_minutes INTEGER NOT NULL DEFAULT 60,
    business_start_hour INTEGER NOT NULL DEFAULT 9,
    business_end_hour INTEGER NOT NULL DEFAULT 17,
    max_days_ahead INTEGER NOT NULL DEFAULT 60,
    location_name VARCHAR(255),
    location_address VARCHAR(500),
    location_map_url VARCHAR(500),
    policy_message_en TEXT,
    policy_message_ar TEXT,
    updated_by VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_v3_appointment_settings_hours CHECK (business_end_hour > business_start_hour),
    CONSTRAINT chk_v3_appointment_settings_slot CHECK (slot_minutes IN (15, 20, 30, 45, 60, 90, 120))
);

-- Lets a client cancel/reschedule their own booking from the confirmation/reminder
-- link without logging in — 24 random bytes hex-encoded, same shape as
-- communications' share_token (see communications.routes.ts's generateShareToken).
ALTER TABLE altax.v3_appointments ADD COLUMN IF NOT EXISTS manage_token VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS uq_v3_appointments_manage_token ON altax.v3_appointments(manage_token) WHERE manage_token IS NOT NULL;
