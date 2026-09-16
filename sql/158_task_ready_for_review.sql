-- Real QC gate for task completion, direct owner request 2026-09-16:
-- "In Review" already existed as a status but was scoped to the permit
-- pipeline (Use & Occupancy/Health Permit — see 117_task_statuses_by_type.sql)
-- and carried zero enforcement — any task could jump straight from Not
-- Started to Completed with nobody else ever looking at it. This adds a
-- real, universal "Ready for Review" status plus a reviewed_by/reviewed_at
-- record (see tasks.routes.ts's new POST /:taskId/review), and blocks the
-- Ready for Review -> Completed transition until that review actually
-- happened (missingCompletionEvidence).
ALTER TABLE altax.v3_tasks ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(255);
ALTER TABLE altax.v3_tasks ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE altax.v3_archived_tasks ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(255);
ALTER TABLE altax.v3_archived_tasks ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- taskStatuses is only ever materialized into real rows the first time
-- someone uses List Settings (ensureDropdownSeeded) — mirrors
-- 117_task_statuses_by_type.sql's own guard so this produces the same end
-- state on an unseeded dev database as it does on production, instead of
-- silently inserting a lone 'Ready for Review' row that would then hide
-- every other status from managedTaskStatusesWithType's DB-rows-take-
-- priority-over-defaults fallback.
INSERT INTO altax.v3_dropdown_options (option_id, category, value, active, sort_order)
SELECT 'OPT-taskStatuses-seed-' || row_number() OVER (), 'taskStatuses', v.value, true, v.ord * 10
  FROM (VALUES
    ('Not Started',1), ('In Progress',2), ('In Process',3), ('Waiting Docs',4), ('Waiting on Client',5),
    ('Pending',6), ('Preparation',7), ('Submitted',8), ('In Review',9), ('Inspection Phase',10),
    ('Additional Information Required',11), ('Fee Due',12), ('Approved',13), ('Completed',14),
    ('Closed',15), ('Issued',16), ('Archived',17), ('Void',18), ('On Hold',19)
  ) AS v(value, ord)
 WHERE NOT EXISTS (SELECT 1 FROM altax.v3_dropdown_options WHERE category = 'taskStatuses');

-- task_type IS NULL = universal, applies to every task regardless of type
-- (statusOptionsForTaskType, TaskCells.tsx). Sort order 135 sits it right
-- before Completed (140) for every task type's status picker.
INSERT INTO altax.v3_dropdown_options (option_id, category, value, active, sort_order, task_type)
SELECT 'OPT-taskStatuses-readyforreview-' || (extract(epoch from clock_timestamp()) * 1000)::bigint,
       'taskStatuses', 'Ready for Review', true, 135, NULL
 WHERE NOT EXISTS (
   SELECT 1 FROM altax.v3_dropdown_options WHERE category = 'taskStatuses' AND value = 'Ready for Review' AND task_type IS NULL
 );
