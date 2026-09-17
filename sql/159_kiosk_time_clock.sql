-- Time Clock Kiosk — direct owner request 2026-09-17: a shared tablet/computer
-- where any Admin or Staff member (present or hired later — the roster is a
-- live query, not a fixed list) clocks in/out without a real account login on
-- the shared device. A kiosk PIN is a separate, short, low-privilege secret —
-- never the person's real password — so a PIN leak or a shared device never
-- exposes real account access. A separate lockout counter (not the login
-- one) means someone guessing PINs at the kiosk can't also lock the person
-- out of their real login, and vice versa.
ALTER TABLE altax.v3_users ADD COLUMN IF NOT EXISTS kiosk_pin_hash VARCHAR(255);
ALTER TABLE altax.v3_users ADD COLUMN IF NOT EXISTS kiosk_pin_failed_count INTEGER;
ALTER TABLE altax.v3_users ADD COLUMN IF NOT EXISTS kiosk_pin_locked_until TIMESTAMPTZ;

-- A physical kiosk (tablet, shared computer) authenticates as a DEVICE, not a
-- user — its own long random token, issued by an admin, revocable independently
-- of any person's account. Multiple devices (e.g. a second office) are fine.
CREATE TABLE IF NOT EXISTS altax.v3_kiosk_devices (
    device_id VARCHAR(64) PRIMARY KEY,
    device_token VARCHAR(128) NOT NULL UNIQUE,
    label VARCHAR(255),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(255),
    last_used_at TIMESTAMPTZ
);

-- One row per clock-in; clock_out_at is null while still clocked in. On
-- clock-out, the worked duration is folded into a v3_time_entries row for
-- that calendar day (time_entry_id links back to it) — the SAME table
-- Staff Capacity already reads, so kiosk punches show up there automatically
-- with no separate reporting to build.
CREATE TABLE IF NOT EXISTS altax.v3_kiosk_punches (
    punch_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES altax.v3_users(user_id) ON DELETE CASCADE,
    device_id VARCHAR(64) REFERENCES altax.v3_kiosk_devices(device_id) ON DELETE SET NULL,
    clock_in_at TIMESTAMPTZ NOT NULL,
    clock_out_at TIMESTAMPTZ,
    time_entry_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v3_kiosk_punches_open ON altax.v3_kiosk_punches(user_id) WHERE clock_out_at IS NULL;
