import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { canAccessClient, getUserAliases, isAssignedToUser } from "../../common/assignment";
import { asyncHandler } from "../../common/asyncHandler";

/**
 * Tasks module — Phase 3 slice, scoped to the operational core only:
 * create / list / get / edit / void a task. Ported from alTaxPortalCreateWorkItem
 * (task mode only — the "request"/"document" mode branches into Document service,
 * Phase 4), alTaxV3CreateManualTask_, alTaxPortalUpdateTask, alTaxPortalVoidTask,
 * and the access-control functions alTaxV3PortalTaskAllowed_ / alTaxV3AssignedToUser_.
 *
 * Bulk complete (alTaxPortalCompleteTasks) + bulk void, auto-archive-on-completion,
 * alTaxPortalRestoreArchivedTask, and task-only document attachments were added later
 * in the same pass — see the bulk/archive/restore routes below and
 * documents.routes.ts's taskId upload path.
 *
 * Task Batches (alTaxPortalCreateTaskBatch) — bulk/recurring task creation across every
 * client matching a Task Rule — is NOT in this file. It already lives in
 * rules.routes.ts (POST /rules/:ruleId/batch, GET /rules/batches), with a frontend
 * page (RulesPage.tsx) already wired to it, and is a more complete implementation
 * than a first pass here would have been (dry-run preview, admin-only, a verified
 * TriggerColumn-to-column map with an explicit unrecognized-column policy). An
 * earlier pass in this file duplicated this under POST /tasks/batch before the
 * existing rules.routes.ts implementation was found — removed to avoid two
 * competing batch systems.
 *
 * Deliberately NOT ported:
 * - Task communications: covered separately by communications.routes.ts's
 *   POST/GET /communications/task, not this file.
 *
 * alTaxPortalDeleteTask / alTaxPortalDeleteTasks (hard row delete) were initially left
 * out in favor of Void as the safe substitute, matching the clients/users hard-delete
 * policy — but the user explicitly asked for real task-row deletion (2026-07-11), so
 * DELETE /:taskId and the bulk "delete" action below do port it. Unlike legacy (which
 * had no confirm-text gate on this at all), both require a typed confirmation from the
 * frontend (DELETE TASK / DELETE SELECTED) as an extra safety margin. All FKs pointing
 * at v3_tasks.task_id use ON DELETE SET NULL, so this can't orphan a row elsewhere.
 */
export const tasksRouter = Router();

const INTERNAL_CLIENT_ID = "C-ALTAX70";
const INTERNAL_CLIENT_NAME = "AL TAX SERVICE";

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
}

function nextTaskId(): string {
  return `WEB-TASK-${idSuffix()}`;
}

/** Mirrors alTaxV5InternalTaskClient_, minus portal-user provisioning (not needed: PortalEnabled stays false). */
async function ensureInternalClient(): Promise<{ client_id: string; client_name: string; assigned_to: string | null }> {
  const existing = await queryOne<any>(`SELECT client_id, client_name, assigned_to FROM altax.v3_clients WHERE client_id = $1`, [INTERNAL_CLIENT_ID]);
  if (existing) return existing;
  await query(
    `INSERT INTO altax.v3_clients (client_id, client_name, entity_type, status, state, assigned_to, client_type, service_type, portal_enabled)
     VALUES ($1,$2,'Internal','Active','MD','AL','Internal','Internal',false)
     ON CONFLICT (client_id) DO NOTHING`,
    [INTERNAL_CLIENT_ID, INTERNAL_CLIENT_NAME]
  );
  return { client_id: INTERNAL_CLIENT_ID, client_name: INTERNAL_CLIENT_NAME, assigned_to: "AL" };
}

/**
 * Mirrors alTaxV3PortalTaskAllowed_: admin sees everything; client and employee never
 * see tasks directly (the list route above returns [] for both by design); a direct
 * AssignedTo match always grants access; otherwise it falls back to canAccessClient for
 * staff/general. Employee is excluded before that fallback rather than falling through
 * to it — canAccessClient matches an employee against their own employer's clientId,
 * which would otherwise let an employee who knows/guesses a taskId view full task
 * details (notes, portal URLs, confirmation numbers, payment amounts) for their
 * employer. Same bug class as the billing/document-request fixes.
 */
async function canAccessTask(user: NonNullable<AuthedRequest["user"]>, task: any): Promise<boolean> {
  if (user.role === "admin") return true;
  if (user.role === "client" || user.role === "employee") return false;

  const aliases = await getUserAliases(user.email);
  if (isAssignedToUser(task.assigned_to, aliases)) return true;

  return canAccessClient(user, task.client_id);
}

/**
 * Create a task — ported from alTaxV3CreateManualTask_. Admin/staff only: in legacy,
 * a client-role caller is silently redirected into document-request creation instead
 * (Document service, Phase 4), so it's out of scope here rather than dropped.
 * Pass internalTask:true (or clientId "C-ALTAX70") for firm-internal work not tied to
 * a real client — the internal placeholder client is auto-created if missing.
 */
tasksRouter.post("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const internalTask = Boolean(body.internalTask) || String(body.clientId || "").trim() === INTERNAL_CLIENT_ID;

  let client: { client_id: string; client_name: string; assigned_to: string | null };
  if (internalTask) {
    client = await ensureInternalClient();
  } else {
    const clientId = String(body.clientId || "").trim();
    if (!clientId) return res.status(400).json({ error: "Please select a client or mark this as an internal task." });
    const found = await queryOne<any>(`SELECT client_id, client_name, assigned_to FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
    if (!found) return res.status(404).json({ error: `Client not found: ${clientId}` });
    client = found;
  }

  const dueDate = String(body.agencyDueDate || body.dueDate || "").trim();
  if (!dueDate) return res.status(400).json({ error: "Due date is required." });

  const taskId = nextTaskId();
  const serviceLine = String(body.taskType || body.serviceLine || "Custom").trim();
  const taskName = String(body.taskName || "").trim() || serviceLine;

  /**
   * Auto-apply a matching Task Rule's defaults — ported behavior distinct
   * from the Task Batches engine (rules.routes.ts): that engine generates
   * many tasks at once from a rule across matching clients, keyed off
   * client-field matching. This is the single-manual-task convenience case —
   * if the task's own TaskType/ServiceLine matches an active rule by name,
   * pull that rule's Frequency/PaymentRequired/PortalName/PortalURL as
   * defaults, but only for fields the caller didn't already supply. Due-date
   * period math (DueMonth/DueDay) is deliberately not computed here — that's
   * real date logic already owned by the batch engine's period calculator,
   * not something to re-derive for a single ad-hoc task.
   */
  const matchingRule = await queryOne<any>(
    `SELECT * FROM altax.v3_task_rules WHERE lower(task_type) = lower($1) AND active = true LIMIT 1`,
    [serviceLine]
  );

  const frequency = String(body.frequency || matchingRule?.frequency || "One-Time").trim();
  const paymentRequired = body.paymentRequired !== undefined ? Boolean(body.paymentRequired) : Boolean(matchingRule?.payment_required);
  const portalName = String(body.portalName || matchingRule?.portal_name || "").trim() || null;
  const portalUrl = String(body.portalUrl || matchingRule?.portal_url || "").trim() || null;

  await query(
    `INSERT INTO altax.v3_tasks
       (task_id, client_id, client_name, service_line, task_name, period, frequency, agency_due_date,
        staff_due_date, status, assigned_to, payment_required, payment_amount, portal_name, portal_url,
        notes, source_system, source_record_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'Node Web App',$1)`,
    [
      taskId, client.client_id, client.client_name, serviceLine, taskName,
      String(body.period || "").trim() || null, frequency, dueDate,
      String(body.staffDueDate || "").trim() || null, String(body.status || "Not Started").trim(),
      String(body.assignedTo || client.assigned_to || "").trim() || null,
      paymentRequired, body.paymentAmount ?? null,
      portalName, portalUrl,
      String(body.notes || (internalTask ? "Internal task - not tied to a client yet." : "Created from web app.")).trim(),
    ]
  );

  await logAudit("Tasks", "CREATE", taskId, "", "", String(body.status || "Not Started"),
    "Manual task created from web app.", req.user!.email);

  res.status(201).json({ ok: true, taskId, clientId: client.client_id, appliedRuleId: matchingRule?.rule_id });
}));

/**
 * List tasks — mirrors the role branches of alTaxV3PortalFilterData_: admin gets every
 * task; client and employee get none directly (legacy: v3_Tasks = [] for client, and
 * the employee branch never populates v3_Tasks at all); staff/general get only tasks
 * assigned to them (alTaxV3AssignedToUser_). The secondary legacy rule — staff also
 * seeing tasks for any client already made visible to them by another assignment — is
 * not replicated; this is a narrower, safe subset of the legacy visibility rule.
 */
const TASK_FILE_COLUMNS = `
  (SELECT COUNT(*) FROM altax.v3_document_uploads u WHERE u.task_id = t.task_id AND lower(u.status) NOT IN ('removed','replaced'))::int AS file_count,
  (SELECT u.file_name FROM altax.v3_document_uploads u WHERE u.task_id = t.task_id AND lower(u.status) NOT IN ('removed','replaced') ORDER BY u.uploaded_at DESC NULLS LAST LIMIT 1) AS first_file_name,
  (SELECT u.file_url FROM altax.v3_document_uploads u WHERE u.task_id = t.task_id AND lower(u.status) NOT IN ('removed','replaced') ORDER BY u.uploaded_at DESC NULLS LAST LIMIT 1) AS first_file_url
`;

tasksRouter.get("/", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const role = req.user!.role;

  if (role === "admin") {
    const rows = await query(`SELECT t.*, ${TASK_FILE_COLUMNS} FROM altax.v3_tasks t ORDER BY t.agency_due_date ASC NULLS LAST`);
    return res.json({ tasks: rows });
  }
  if (role === "client" || role === "employee") {
    return res.json({ tasks: [] });
  }

  const aliases = await getUserAliases(req.user!.email);
  const rows = await query(
    `SELECT t.*, ${TASK_FILE_COLUMNS} FROM altax.v3_tasks t WHERE lower(t.assigned_to) = ANY($1::text[]) ORDER BY t.agency_due_date ASC NULLS LAST`,
    [Array.from(aliases)]
  );
  res.json({ tasks: rows });
}));

/** Single task — access-checked via canAccessTask (see above). */
tasksRouter.get("/:taskId", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { taskId } = req.params;
  const task = await queryOne<any>(`SELECT * FROM altax.v3_tasks WHERE task_id = $1`, [taskId]);
  if (!task) return res.status(404).json({ error: "Task not found." });

  if (!(await canAccessTask(req.user!, task))) {
    return res.status(403).json({ error: "You do not have access to this task." });
  }

  res.json({ task });
}));

/** camelCase API field -> [db column, isBoolean]. Allow-list ported 1:1 from alTaxPortalUpdateTask. */
const TASK_UPDATABLE_FIELDS: Record<string, { column: string; boolean?: boolean }> = {
  serviceLine: { column: "service_line" },
  taskName: { column: "task_name" },
  period: { column: "period" },
  frequency: { column: "frequency" },
  agencyDueDate: { column: "agency_due_date" },
  staffDueDate: { column: "staff_due_date" },
  status: { column: "status" },
  assignedTo: { column: "assigned_to" },
  paymentRequired: { column: "payment_required", boolean: true },
  paymentAmount: { column: "payment_amount" },
  filedDate: { column: "filed_date" },
  paidDate: { column: "paid_date" },
  confirmationNumber: { column: "confirmation_number" },
  portalName: { column: "portal_name" },
  portalUrl: { column: "portal_url" },
  notes: { column: "notes" },
};

function isCompletedStatus(status: unknown): boolean {
  return String(status || "").trim().toLowerCase() === "completed";
}

/**
 * Moves a task row from v3_tasks into v3_archived_tasks (same columns plus
 * ArchivedAt/ArchivedBy/ArchiveReason) and removes it from the live table.
 * Ported behavior: legacy auto-archives a task the moment its status becomes
 * Completed, keeping the active Tasks list free of finished work while
 * preserving the record (alTaxPortalRestoreArchivedTask reverses this).
 */
async function archiveTask(taskId: string, reason: string, archivedBy: string): Promise<void> {
  const task = await queryOne<any>(`SELECT * FROM altax.v3_tasks WHERE task_id = $1`, [taskId]);
  if (!task) return;
  await query(
    `INSERT INTO altax.v3_archived_tasks
       (task_id, client_id, client_name, service_line, task_name, period, frequency, agency_due_date,
        staff_due_date, status, assigned_to, payment_required, payment_amount, filed_date, paid_date,
        confirmation_number, portal_name, portal_url, notes, source_system, source_record_id,
        archived_at, archived_by, archive_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,now(),$22,$23)`,
    [task.task_id, task.client_id, task.client_name, task.service_line, task.task_name, task.period, task.frequency,
      task.agency_due_date, task.staff_due_date, task.status, task.assigned_to, task.payment_required, task.payment_amount,
      task.filed_date, task.paid_date, task.confirmation_number, task.portal_name, task.portal_url, task.notes,
      task.source_system, task.source_record_id, archivedBy, reason]
  );
  await query(`DELETE FROM altax.v3_tasks WHERE task_id = $1`, [taskId]);
}

/**
 * Update task fields — ported from alTaxPortalUpdateTask: allow-listed fields, per-field
 * audit diff. Client role is blocked entirely in legacy ("Client portal cannot edit
 * internal tasks."), so this route isn't opened to it; staff must also pass the same
 * canAccessTask check used for reads. If the edit sets status to Completed, the task
 * is auto-archived (see archiveTask above) after the update lands.
 */
tasksRouter.patch("/:taskId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { taskId } = req.params;
  const old = await queryOne<any>(`SELECT * FROM altax.v3_tasks WHERE task_id = $1`, [taskId]);
  if (!old) return res.status(404).json({ error: "Task not found." });

  if (!(await canAccessTask(req.user!, old))) {
    return res.status(403).json({ error: "You do not have access to this task." });
  }

  const body = req.body || {};
  const fields: Record<string, any> = {};
  for (const [key, { column, boolean }] of Object.entries(TASK_UPDATABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      if (boolean) {
        fields[column] = Boolean(body[key]);
      } else {
        const v = body[key];
        fields[column] = v === "" || v === undefined ? null : v;
      }
    }
  }
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: "No task fields received." });
  }

  const setClause = Object.keys(fields).map((col, i) => `${col} = $${i + 2}`).join(", ");
  await query(`UPDATE altax.v3_tasks SET ${setClause}, updated_at = now() WHERE task_id = $1`, [taskId, ...Object.values(fields)]);

  for (const [col, newValue] of Object.entries(fields)) {
    const oldValue = old[col];
    if (String(oldValue ?? "") !== String(newValue ?? "")) {
      await logAudit("Tasks", "EDIT", taskId, col, String(oldValue ?? ""), String(newValue ?? ""),
        "Task edited from web app.", req.user!.email);
    }
  }

  let archived = false;
  if (Object.prototype.hasOwnProperty.call(fields, "status") && isCompletedStatus(fields.status) && !isCompletedStatus(old.status)) {
    await archiveTask(taskId, "Auto-archived on completion", req.user!.email);
    await logAudit("Tasks", "ARCHIVE", taskId, "Status", "Completed", "Archived",
      "Task auto-archived after being marked Completed.", req.user!.email);
    archived = true;
  }

  res.json({ ok: true, archived });
}));

/** List archived tasks — admin/staff, powers the restore UI. */
tasksRouter.get("/archived/list", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rows = await query(`SELECT * FROM altax.v3_archived_tasks ORDER BY archived_at DESC NULLS LAST`);
  res.json({ tasks: rows });
}));

/**
 * Restore an archived task back into the live v3_tasks table — ported from
 * alTaxPortalRestoreArchivedTask. Status is left exactly as it was archived
 * (typically "Completed"); staff can re-edit it from there if it needs to
 * reopen as in-progress.
 */
tasksRouter.post("/:taskId/restore", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { taskId } = req.params;
  const archived = await queryOne<any>(`SELECT * FROM altax.v3_archived_tasks WHERE task_id = $1`, [taskId]);
  if (!archived) return res.status(404).json({ error: "Archived task not found." });

  await query(
    `INSERT INTO altax.v3_tasks
       (task_id, client_id, client_name, service_line, task_name, period, frequency, agency_due_date,
        staff_due_date, status, assigned_to, payment_required, payment_amount, filed_date, paid_date,
        confirmation_number, portal_name, portal_url, notes, source_system, source_record_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [archived.task_id, archived.client_id, archived.client_name, archived.service_line, archived.task_name,
      archived.period, archived.frequency, archived.agency_due_date, archived.staff_due_date, archived.status,
      archived.assigned_to, archived.payment_required, archived.payment_amount, archived.filed_date, archived.paid_date,
      archived.confirmation_number, archived.portal_name, archived.portal_url, archived.notes,
      archived.source_system, archived.source_record_id]
  );
  await query(`DELETE FROM altax.v3_archived_tasks WHERE task_id = $1`, [taskId]);
  await logAudit("Tasks", "RESTORE", taskId, "Status", "Archived", archived.status || "",
    `Task restored from archive by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, taskId });
}));

/**
 * Bulk task actions — ported from alTaxPortalCompleteTasks (complete) plus a
 * void equivalent, layered on the same single-task primitives above rather
 * than a separate bulk SQL path, so every access check/audit-log/auto-archive
 * behavior stays identical to acting on one task at a time.
 */
tasksRouter.post("/bulk", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const taskIds: string[] = Array.isArray(body.taskIds) ? body.taskIds.map((id: unknown) => String(id).trim()).filter(Boolean) : [];
  const action = String(body.action || "").trim().toLowerCase();
  if (!taskIds.length) return res.status(400).json({ error: "No tasks selected." });
  if (!["complete", "void", "delete"].includes(action)) return res.status(400).json({ error: "Unsupported bulk action." });

  if (action === "delete") {
    if (req.user!.role !== "admin") return res.status(403).json({ error: "Only admin can permanently delete tasks." });
    if (String(body.confirm || "").trim() !== "DELETE SELECTED") {
      return res.status(400).json({ error: 'Type "DELETE SELECTED" to confirm this permanent action.' });
    }
  }

  let succeeded = 0;
  const failed: string[] = [];

  for (const taskId of taskIds) {
    const task = await queryOne<any>(`SELECT * FROM altax.v3_tasks WHERE task_id = $1`, [taskId]);
    if (!task || !(await canAccessTask(req.user!, task))) {
      failed.push(taskId);
      continue;
    }

    if (action === "complete") {
      await query(`UPDATE altax.v3_tasks SET status = 'Completed', updated_at = now() WHERE task_id = $1`, [taskId]);
      await logAudit("Tasks", "EDIT", taskId, "status", task.status || "", "Completed",
        "Task bulk-completed from web app.", req.user!.email);
      await archiveTask(taskId, "Auto-archived on bulk completion", req.user!.email);
      await logAudit("Tasks", "ARCHIVE", taskId, "Status", "Completed", "Archived",
        "Task auto-archived after bulk completion.", req.user!.email);
    } else if (action === "void") {
      const newNotes = `${task.notes || ""}\nVoided ${new Date().toISOString()}: Bulk voided from web app`;
      await query(`UPDATE altax.v3_tasks SET status = 'Void', notes = $2, updated_at = now() WHERE task_id = $1`, [taskId, newNotes]);
      await logAudit("Tasks", "VOID", taskId, "Status", task.status || "", "Void",
        `Task bulk-voided by ${req.user!.email}.`, req.user!.email);
    } else {
      await query(`DELETE FROM altax.v3_tasks WHERE task_id = $1`, [taskId]);
      await logAudit("Tasks", "DELETE", taskId, "TaskName", task.task_name || "", "",
        `Task permanently deleted (bulk) by ${req.user!.email}.`, req.user!.email);
    }
    succeeded++;
  }

  res.json({ ok: true, succeeded, failed });
}));

/**
 * Void a task — ported from alTaxPortalVoidTask: soft status change (Status=Void,
 * timestamped note appended), not a delete. Same access rule as edit.
 */
tasksRouter.post("/:taskId/void", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { taskId } = req.params;
  const reason = String((req.body || {}).reason || "Voided from web app");

  const old = await queryOne<any>(`SELECT * FROM altax.v3_tasks WHERE task_id = $1`, [taskId]);
  if (!old) return res.status(404).json({ error: "Task not found." });

  if (!(await canAccessTask(req.user!, old))) {
    return res.status(403).json({ error: "You do not have access to this task." });
  }

  const newNotes = `${old.notes || ""}\nVoided ${new Date().toISOString()}: ${reason}`;
  await query(`UPDATE altax.v3_tasks SET status = 'Void', notes = $2, updated_at = now() WHERE task_id = $1`, [taskId, newNotes]);
  await logAudit("Tasks", "VOID", taskId, "Status", old.status || "", "Void", `Task voided by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, taskId, status: "Void" });
}));

/**
 * Permanently delete a task row — ported from alTaxPortalDeleteTask, admin-only.
 * Requires a typed "DELETE TASK" confirmation from the frontend (legacy had no
 * confirm-text gate on this at all — see module doc comment). Every FK pointing at
 * v3_tasks.task_id uses ON DELETE SET NULL, so this can't orphan a payment, document
 * request, upload, or communication row — they just lose their task link.
 */
tasksRouter.post("/:taskId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { taskId } = req.params;
  if (String((req.body || {}).confirm || "").trim() !== "DELETE TASK") {
    return res.status(400).json({ error: 'Type "DELETE TASK" to confirm this permanent action.' });
  }

  const old = await queryOne<any>(`SELECT * FROM altax.v3_tasks WHERE task_id = $1`, [taskId]);
  if (!old) return res.status(404).json({ error: "Task not found." });

  await query(`DELETE FROM altax.v3_tasks WHERE task_id = $1`, [taskId]);
  await logAudit("Tasks", "DELETE", taskId, "TaskName", old.task_name || "", "",
    `Task permanently deleted by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, taskId });
}));
