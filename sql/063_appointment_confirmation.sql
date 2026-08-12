-- "Confirm Your Appointment" — a fixed, automatic ask sent 24 hours before an
-- appointment, distinct from the admin-configurable reminder system. Two
-- columns, both nullable timestamps:
--
--   confirmation_request_sent_at — idempotency marker for the 24h auto-send.
--   Deliberately its own column rather than reusing reminder_lead_minutes_sent
--   (an array of admin-configured lead times): 1440 minutes (24h) is already a
--   common value in that array, so appending to it would either collide with a
--   real 1-day reminder or require the array to distinguish "reminder" from
--   "confirmation request" — a separate column sidesteps that ambiguity.
--
--   client_confirmed_at — set when the client taps "Yes, I'll be there" on the
--   manage-appointment page. Null forever if they never confirm (including if
--   they cancel/reschedule instead, or simply never click).

ALTER TABLE altax.v3_appointments ADD COLUMN IF NOT EXISTS confirmation_request_sent_at TIMESTAMPTZ NULL;
ALTER TABLE altax.v3_appointments ADD COLUMN IF NOT EXISTS client_confirmed_at TIMESTAMPTZ NULL;
