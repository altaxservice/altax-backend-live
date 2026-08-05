-- "Invite Others" — additional email addresses invited to an appointment
-- beyond the primary client/contact. They receive the same confirmation/
-- reminder/cancellation emails as the primary contact (CC'd, same shape as
-- the existing Cc/Bcc pattern on invoice/document sends), not a separate
-- portal account or a real calendar-invite/RSVP flow.

ALTER TABLE altax.v3_appointments
    ADD COLUMN IF NOT EXISTS guest_emails TEXT[];
