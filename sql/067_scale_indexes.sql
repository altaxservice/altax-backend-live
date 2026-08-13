-- Hard audit (2026-08-13), PERF-002/003/004/005 + SEC-006: the six tables from the
-- original 001_init_schema.sql never got the composite/partial-index treatment that
-- every table added since migration #020 consistently received. These are the four
-- highest-impact gaps — two tables (document_uploads, archived_tasks) had zero
-- indexes at all beyond their primary key.

-- PERF-002: v3_audit_log's only index is (module, record_id) — good for "history of
-- one record," useless for "recent activity across modules," which is exactly what
-- the since-last-login digest (GET /system/activity-since-login) and the Security
-- feed both query on every login.
CREATE INDEX IF NOT EXISTS idx_v3_audit_log_logged_at ON altax.v3_audit_log(logged_at DESC);

-- PERF-003: v3_document_uploads has zero indexes at all. client_id backs the
-- client/staff list views (ordered by uploaded_at); task_id and request_id back the
-- per-task and per-request upload lookups used on every client/task detail page.
CREATE INDEX IF NOT EXISTS idx_v3_document_uploads_client ON altax.v3_document_uploads(client_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_document_uploads_task ON altax.v3_document_uploads(task_id);
CREATE INDEX IF NOT EXISTS idx_v3_document_uploads_request ON altax.v3_document_uploads(request_id);

-- PERF-004: v3_archived_tasks has zero indexes at all, despite being the one table
-- in the schema guaranteed to only grow (every completed/archived task lands here
-- and is never purged). Backs the per-client Annual Value Report and the firm-wide
-- Archived Tasks list.
CREATE INDEX IF NOT EXISTS idx_v3_archived_tasks_client_archived ON altax.v3_archived_tasks(client_id, archived_at);

-- PERF-005: v3_communications has a single-column client_id index only, with no
-- composite on sent_at (every client-scoped read orders by it) and no index at all
-- on related_task_id despite an explicit FK — the Task Notes join fires on every
-- client detail page load. Replaces the old single-column index.
DROP INDEX IF EXISTS altax.idx_communications_client;
CREATE INDEX IF NOT EXISTS idx_v3_communications_client_sent ON altax.v3_communications(client_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_communications_related_task ON altax.v3_communications(related_task_id);

-- SEC-006: contractor_payments has an FK on client_id with no dedicated index,
-- same gap as document_uploads had — folded in here since it's the identical fix.
CREATE INDEX IF NOT EXISTS idx_v3_contractor_payments_client ON altax.v3_contractor_payments(client_id);
