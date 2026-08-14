-- PERF-008 (hard audit, 2026-08-13): v3_tasks had three single-column indexes
-- (client_id, status, assigned_to) but no composite matching the actual
-- "this client's open/overdue items" query shape used on every client detail
-- page load and by PERF-010's new paginated live-tab queries. Partial index
-- (excluding terminal statuses) keeps it small and fast to maintain since
-- most rows are eventually completed/void/closed/archived.
CREATE INDEX IF NOT EXISTS idx_v3_tasks_open_due
  ON altax.v3_tasks (client_id, agency_due_date)
  WHERE lower(status) NOT IN ('completed', 'void', 'closed', 'archived');
