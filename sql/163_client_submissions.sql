-- Client-submitted daily sales and purchases/expenses, staged for staff
-- review before they become real records. Nothing here ever touches
-- v3_gl_entries directly -- approval calls the SAME code paths a staff
-- member's own entry would (createSalesInputRecord / createManualJournalEntry
-- in accounting.routes.ts), so an approved client submission is
-- indistinguishable from a staff-entered one once it lands.
--
-- Modeled on v3_je_drafts' Pending/Approved/Dismissed pattern (Bank Rec's
-- own client-submission-like queue), for the same reason: one proven review
-- workflow instead of a second, slightly-different one.

CREATE TABLE IF NOT EXISTS altax.v3_client_sales_drafts (
  draft_id VARCHAR(64) PRIMARY KEY,
  client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
  client_name VARCHAR(255),
  sale_date DATE NOT NULL,
  -- [{categoryId, categoryName, taxableAmount}] as submitted by the client --
  -- categoryName is a display-time snapshot (categories can be renamed later
  -- without corrupting a client's still-pending history).
  category_lines JSONB NOT NULL,
  gross_sales NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Dismissed')),
  submitted_by VARCHAR(255),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Staff can correct a line before approving -- same shape as category_lines,
  -- applied instead of the client's own submitted lines when present.
  staff_overrides JSONB,
  resulting_sale_id VARCHAR(64),
  approved_by VARCHAR(255),
  approved_at TIMESTAMPTZ,
  dismissed_by VARCHAR(255),
  dismissed_at TIMESTAMPTZ,
  dismissed_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v3_client_sales_drafts_client ON altax.v3_client_sales_drafts(client_id, status);

CREATE TABLE IF NOT EXISTS altax.v3_client_purchase_drafts (
  draft_id VARCHAR(64) PRIMARY KEY,
  client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
  client_name VARCHAR(255),
  purchase_date DATE NOT NULL,
  vendor_name VARCHAR(255),
  description TEXT,
  account VARCHAR(255) NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  paid_by_card BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Dismissed')),
  submitted_by VARCHAR(255),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  staff_overrides JSONB,
  resulting_je_id VARCHAR(64),
  approved_by VARCHAR(255),
  approved_at TIMESTAMPTZ,
  dismissed_by VARCHAR(255),
  dismissed_at TIMESTAMPTZ,
  dismissed_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v3_client_purchase_drafts_client ON altax.v3_client_purchase_drafts(client_id, status);
