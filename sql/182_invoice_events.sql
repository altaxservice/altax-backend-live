-- Delivery trail for an invoice: when it was sent (and how), whether a send failed, and when the client opened it
-- through the share link. Reminders and payments already have their own records and are merged in when the
-- timeline is built (see src/common/invoiceEvents.ts).
CREATE TABLE IF NOT EXISTS altax.v3_invoice_events (
    event_id VARCHAR(64) PRIMARY KEY,
    invoice_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(16) NOT NULL CHECK (event_type IN ('sent','send_failed','viewed')),
    channel VARCHAR(16),
    sent_to VARCHAR(255),
    detail TEXT,
    actor VARCHAR(255),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_events_invoice ON altax.v3_invoice_events (invoice_id, occurred_at);

-- Backfill: invoices already sent from the app (their communication subject names the invoice).
INSERT INTO altax.v3_invoice_events (event_id, invoice_id, event_type, channel, sent_to, detail, actor, occurred_at)
SELECT 'EVT-BF-' || c.communication_id, m.invoice_id,
       CASE WHEN c.status ILIKE 'Failed%' OR c.status ILIKE 'Saved — %' THEN 'send_failed' ELSE 'sent' END,
       lower(c.channel), c.sent_to, CASE WHEN c.status ILIKE 'Failed%' OR c.status ILIKE 'Saved — %' THEN c.status END, c.sent_by, c.sent_at
  FROM altax.v3_communications c
  JOIN LATERAL (SELECT substring(c.subject from '(INV-[0-9A-Za-z-]+)') AS invoice_id) m ON m.invoice_id IS NOT NULL
  JOIN altax.v3_invoices i ON i.invoice_id = m.invoice_id
 WHERE c.source_system IN ('Invoice', 'Recurring Billing') AND c.subject ILIKE 'Invoice INV-%'
ON CONFLICT (event_id) DO NOTHING;
