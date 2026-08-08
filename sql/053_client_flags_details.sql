-- The manual "+ Flag" form only ever had a single freeform "note" line and an
-- optional amount — no way to classify what kind of issue it is (e.g. "Not in
-- Good Standing"), no room for real detail (what year, what happened), and no
-- way to point staff at where to actually go resolve it. This adds:
--   category    — a short classification, from the same admin-editable
--                  dropdown-list pattern already used elsewhere (see
--                  MANAGED_DROPDOWN_DEFAULTS.clientFlagCategories)
--   details     — a real text body for specifics, separate from the short label
--   due_date    — an optional relevant date (when it needs resolving by, or
--                  since when it's been true)
--   link_task_id — an optional pointer to an existing Task for this client, so
--                  "where to go to fix it or track it" reuses the app's real
--                  task-tracking (status/assignee/due date) instead of a new
--                  parallel system. ON DELETE SET NULL: deleting the task
--                  shouldn't silently delete the flag too.
ALTER TABLE altax.v3_client_flags
  ADD COLUMN IF NOT EXISTS category VARCHAR(255),
  ADD COLUMN IF NOT EXISTS details TEXT,
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS link_task_id VARCHAR(64) REFERENCES altax.v3_tasks(task_id) ON DELETE SET NULL;
