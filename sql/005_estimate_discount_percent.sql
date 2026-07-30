-- ---------------------------------------------------------------------------
-- Estimates: percent-based discount, matching the invoice module's own
-- discountPercent/discountAmount pair (billing.routes.ts computeInvoiceTotals).
-- Estimates only ever had a flat discount_amount — staff quoting "10% off"
-- had to hand-compute the dollar figure themselves. When discount_percent is
-- set (> 0) it wins over discount_amount, same precedence invoices already use.
-- ---------------------------------------------------------------------------
ALTER TABLE v3_estimates ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0;
