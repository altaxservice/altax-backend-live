-- Direct owner request, 2026-08-27: group the "Task Statuses" list (List
-- Settings) by Task Type instead of one flat list shared by every task,
-- since a permit-style task (Use & Occupancy, Health Permit) genuinely has
-- phases (In Review, Fee Due, Inspection Phase...) a simple compliance
-- filing task never uses.
--
-- NULL task_type means "general" — applies regardless of the task's own
-- type (Not Started, Submitted, Completed, etc.). A non-null value scopes
-- the status to exactly one Task Type value (matching v3_dropdown_options'
-- own category='taskTypes' rows). A task's own "type" is stored in
-- v3_tasks.service_line, not a column literally named task_type — that
-- name is v3_task_rules' own column for the recurring-rule config, a
-- different table; the frontend's "Task Type" picker (NewWorkItemModal)
-- writes into service_line (tasks.routes.ts: `body.taskType || body.serviceLine`).
ALTER TABLE altax.v3_dropdown_options ADD COLUMN IF NOT EXISTS task_type VARCHAR(255);

-- This category (taskStatuses) is only ever materialized into real rows the
-- first time someone uses the List Settings "Add"/Rename/etc. UI
-- (ensureDropdownSeeded in system.routes.ts) — production already has 19
-- real rows (an admin used Add to append "Issued" and "On Hold" beyond the
-- 17 hardcoded defaults), but a fresh/dev database has none yet. Seed the
-- full real 19-value set first if it's missing, so this migration produces
-- the same end state everywhere instead of silently no-op'ing on an
-- unseeded database.
INSERT INTO altax.v3_dropdown_options (option_id, category, value, active, sort_order)
SELECT 'OPT-taskStatuses-seed-' || row_number() OVER (), 'taskStatuses', v.value, true, v.ord * 10
  FROM (VALUES
    ('Not Started',1), ('In Progress',2), ('In Process',3), ('Waiting Docs',4), ('Waiting on Client',5),
    ('Pending',6), ('Preparation',7), ('Submitted',8), ('In Review',9), ('Inspection Phase',10),
    ('Additional Information Required',11), ('Fee Due',12), ('Approved',13), ('Completed',14),
    ('Closed',15), ('Issued',16), ('Archived',17), ('Void',18), ('On Hold',19)
  ) AS v(value, ord)
 WHERE NOT EXISTS (SELECT 1 FROM altax.v3_dropdown_options WHERE category = 'taskStatuses');

-- General/universal statuses stay NULL (untouched); only the permit-
-- review-pipeline statuses get scoped to Use & Occupancy Permit.
UPDATE altax.v3_dropdown_options
   SET task_type = 'Use & Occupancy Permit'
 WHERE category = 'taskStatuses'
   AND value IN ('In Review', 'Inspection Phase', 'Additional Information Required', 'Fee Due', 'Approved', 'Issued')
   AND task_type IS NULL;

-- Health Permit goes through the same real Baltimore inspection/fee/review
-- pipeline as Use & Occupancy — duplicate the same 6 phase rows scoped to
-- it too, rather than force two different permit types to share one
-- task_type value. Guarded so this migration is safe to run twice.
INSERT INTO altax.v3_dropdown_options (option_id, category, value, active, sort_order, task_type)
SELECT 'OPT-taskStatuses-' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || row_number() OVER (),
       'taskStatuses', d1.value, d1.active, d1.sort_order, 'Health Permit'
  FROM altax.v3_dropdown_options d1
 WHERE d1.category = 'taskStatuses'
   AND d1.task_type = 'Use & Occupancy Permit'
   AND NOT EXISTS (
     SELECT 1 FROM altax.v3_dropdown_options d2
      WHERE d2.category = 'taskStatuses' AND d2.task_type = 'Health Permit' AND d2.value = d1.value
   );
