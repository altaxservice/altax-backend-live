-- "Park" a task: hide it from Active/Overdue/etc. without touching its real
-- status, for a task that's genuinely stuck (waiting on info, blocked on a
-- third party) and would otherwise sit in the Overdue pile forever. Separate
-- boolean+reason+audit trail from status, mirroring the archived_at/
-- archived_by/archive_reason triad on v3_archived_tasks, so parking never
-- collides with the existing open-ended status column.
ALTER TABLE altax.v3_tasks
  ADD COLUMN IF NOT EXISTS is_parked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS parked_reason TEXT,
  ADD COLUMN IF NOT EXISTS parked_by VARCHAR(255),
  ADD COLUMN IF NOT EXISTS parked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_v3_tasks_parked ON altax.v3_tasks (parked_at) WHERE is_parked = true;
