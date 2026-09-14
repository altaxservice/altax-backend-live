-- Real owner request, 2026-09-14: connect Tasks, Notes, and Daily Log so
-- each can reference the others (a Note about a specific task, a Log entry
-- against a task, a Task spun off from a Note/Log entry) instead of being
-- three siloed tools. Notes already had client_id; Daily Log already had
-- both client_id and task_id (sql/150). This gives Notes the same task_id
-- link so all three share the identical two linking keys.
ALTER TABLE altax.v3_staff_notes ADD COLUMN IF NOT EXISTS task_id VARCHAR(64) REFERENCES altax.v3_tasks(task_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_v3_staff_notes_task ON altax.v3_staff_notes(task_id);
