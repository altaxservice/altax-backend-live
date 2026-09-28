-- Client-triggered "save as template" for recurring purchases (rent,
-- insurance, loan payments) so a client doesn't retype the same entry every
-- month. No cron/scheduling -- unlike v3_recurring_billing, this only
-- pre-fills the purchase-draft form; the client still reviews/edits/submits
-- normally through the existing POST /client-books/purchase-drafts.
CREATE TABLE IF NOT EXISTS altax.v3_client_purchase_templates (
  template_id VARCHAR(64) PRIMARY KEY,
  client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  account VARCHAR(255) NOT NULL,
  vendor_name VARCHAR(255),
  default_amount NUMERIC(14,2),
  paid_by_card BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v3_client_purchase_templates_client ON altax.v3_client_purchase_templates(client_id);
