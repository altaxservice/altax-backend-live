-- Hard audit (2026-08-13), Phase 1: PERF-006/PERF-007. Two more write/read hot
-- spots that never got the composite/partial-index treatment applied to the rest
-- of the schema in sql/067.

-- PERF-006: v3_gl_entries has no index on ref, used by every payroll/sales/
-- contractor edit-delete-and-regenerate cycle (DELETE ... WHERE ref = $1 before
-- re-posting) — a write-path hot spot every time one of those records is edited,
-- not just a report query.
CREATE INDEX IF NOT EXISTS idx_v3_gl_entries_ref ON altax.v3_gl_entries(ref);

-- PERF-007: v3_invoices has no index on status or due_date — the firm-wide AR/
-- overdue report scans the whole table. Partial index excludes the two terminal
-- statuses (the report only ever cares about open invoices); a plain composite
-- backs the existing per-client, date-ordered invoice list.
CREATE INDEX IF NOT EXISTS idx_v3_invoices_status_open ON altax.v3_invoices(status) WHERE status NOT IN ('Paid', 'Void');
CREATE INDEX IF NOT EXISTS idx_v3_invoices_client_date ON altax.v3_invoices(client_id, invoice_date);
