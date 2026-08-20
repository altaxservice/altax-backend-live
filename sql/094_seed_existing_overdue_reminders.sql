-- One-time seed for the payment-reminder overhaul (reminders.routes.ts). The
-- new one-time reminder uses a date-free dedup key (PAYREM-{invoiceId}), so
-- without this, every invoice already more than 3 days past its due date
-- today would look brand-new to the code and fire immediately on the first
-- sweep after deploy — a client with several overdue invoices would get
-- several reminder emails at once on day one.
--
-- This inserts a "already handled" v3_communications row for every invoice
-- that currently qualifies, under the exact same key the real sweep will
-- check, WITHOUT actually sending anything. The very first real sweep after
-- this runs sees them as already-sent and skips them; only invoices that
-- cross the 3-day-overdue line AFTER this point will ever trigger a real
-- send. This is a one-time backfill, safe to run once and never again —
-- running it a second time is a harmless no-op (ON CONFLICT-equivalent via
-- the WHERE NOT EXISTS below).
INSERT INTO altax.v3_communications
    (communication_id, client_id, client_name, related_task_id, direction, channel, subject,
     message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id, provider_message_id)
SELECT
    'COM-SEED-' || i.invoice_id,
    i.client_id, c.client_name, NULL, 'Outbound', 'Email',
    'Payment reminder (seeded, not sent)',
    'Seeded on rollout of the one-time payment reminder feature — this invoice was already overdue when the feature shipped, so no reminder was actually sent for it automatically.',
    '',
    c.email, 'System (Payment Reminder Seed)', now(),
    'Skipped (pre-existing overdue, seeded on rollout)',
    'Reminders', 'PAYREM-' || i.invoice_id, NULL
FROM altax.v3_invoices i
JOIN altax.v3_clients c ON c.client_id = i.client_id
WHERE lower(i.status) NOT IN ('paid', 'void') AND i.balance_due > 0
  AND i.due_date IS NOT NULL AND i.due_date <= now() - interval '3 days'
  AND NOT EXISTS (
    SELECT 1 FROM altax.v3_communications
     WHERE source_system = 'Reminders' AND source_record_id = 'PAYREM-' || i.invoice_id
  );
