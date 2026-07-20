import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { normalizeText } from "../../common/assignment";

/**
 * Task Rules & Batches module — completes Phase 3. Ported from alTaxPortalSaveTaskRule,
 * alTaxV5ClientMatchesRule_, alTaxV5TaskDuplicateExists_, and alTaxPortalCreateTaskBatch.
 * All admin-only, matching alTaxV5RequirePortalUser_(email, true) in every legacy function
 * here. This is deterministic rule-matching (does client field X equal value Y), not
 * financial calculation — unlike Phase 7's Accounting engines, it doesn't fall under the
 * plan's "no test fixtures, no migration" rule, so it's safe to port alongside CRUD.
 *
 * Deliberately NOT ported:
 * - alTaxV5NotifyStaffTaskBatch_: emails staff about newly assigned batch tasks. No email
 *   infra exists in this backend (same reasoning as every other notification skipped).
 * - alTaxV5EnsureQuarterlyMDWithholdingRule_: legacy auto-seeds one specific hardcoded rule
 *   as a side effect of nearly every task-creation call. That's a one-time bootstrapping
 *   concern from the old system, not something a clean Node reimplementation should quietly
 *   redo on every request — if that rule is needed, create it explicitly via POST /rules
 *   like any other rule.
 *
 * One addition beyond a literal port: POST /rules/:ruleId/batch accepts a `dryRun` flag
 * that computes exactly what a batch run would do (matched clients, would-create,
 * would-skip) without writing anything. The plan's Phase 3 test list calls for "batch
 * tasks with review step" — legacy has no separate preview endpoint I could find, so this
 * is the safe way to support that review step: look before you leap on an operation that
 * can create dozens of task rows at once.
 */
export const rulesRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
}

export function isActiveFlag(value: unknown): boolean {
  return !["no", "false", "inactive", "archived"].includes(normalizeText(value ?? "Yes"));
}

/**
 * v3_Task_Rules.TriggerColumn values -> actual v3_clients Postgres column.
 *
 * IMPORTANT: verified against live production rule data (GET /rules), the real
 * TriggerColumn values are human-readable labels typed by staff — "Business Return
 * Type", "EFTPS?", "Sales Tax Frequency" — NOT the PascalCase schema field names
 * ("BusinessReturnType") originally assumed here. Both forms are mapped below.
 * Bounded, known set — safer than a generic PascalCase/label-to-snake_case guess.
 */
const CLIENT_TRIGGER_COLUMNS: Record<string, string> = {
  ClientName: "client_name", EntityType: "entity_type", Status: "status", State: "state",
  Email: "email", Phone: "phone", AssignedTo: "assigned_to",
  SalesTaxFrequency: "sales_tax_frequency", "Sales Tax Frequency": "sales_tax_frequency",
  PayrollEnabled: "payroll_enabled", "Payroll?": "payroll_enabled",
  PayrollFrequency: "payroll_frequency", "Payroll Frequency": "payroll_frequency",
  PayrollSystem: "payroll_system",
  EFTPSEnabled: "eftps_enabled", "EFTPS?": "eftps_enabled",
  MDWithholdingFrequency: "md_withholding_frequency", "MD Withholding Frequency": "md_withholding_frequency",
  MDUIEnabled: "mdui_enabled", "MD UI": "mdui_enabled",
  MDAnnualReportEnabled: "md_annual_report_enabled", "MD Annual Report?": "md_annual_report_enabled",
  BusinessReturnType: "business_return_type", "Business Return Type": "business_return_type",
  SMSAllowed: "sms_allowed", EmailAllowed: "email_allowed", PortalEnabled: "portal_enabled",
  ClientType: "client_type", ServiceType: "service_type", W21099Enabled: "w21099_enabled",
  PreferredLanguage: "preferred_language",
};

/**
 * Mirrors alTaxV5ClientMatchesRule_, with one deliberate correction: legacy resolves
 * TriggerColumn via a direct property lookup on the client row object
 * (client[TriggerColumn]), which returns undefined — and therefore never matches —
 * for any label that isn't a real field name. Reimplementing that literally via a
 * lookup table would mean "unrecognized trigger column" silently falls through to
 * "match nobody" one way (legacy) or, if the table lookup itself is treated as the
 * empty-trigger case, "match everyone" the other way (a bug I caught testing this
 * against real rule data — see rules.routes.ts history). This version makes the
 * distinction explicit: only a genuinely EMPTY trigger column on the rule means
 * "matches every client" (legacy's actual global-rule case); an unrecognized
 * non-empty label matches nobody automatically and must be handled via the explicit
 * `clientIds` selection path instead of guessed at.
 */
export function clientMatchesRule(client: any, rule: any): boolean {
  const triggerColumnRaw = String(rule.trigger_column || "").trim();
  const triggerValue = normalizeText(rule.trigger_value);
  if (!triggerColumnRaw || !triggerValue || triggerValue === "=") return true;

  const triggerColumn = CLIENT_TRIGGER_COLUMNS[triggerColumnRaw];
  if (!triggerColumn) return false;

  const actual = normalizeText(client[triggerColumn]);
  if (actual === triggerValue) return true;
  return triggerValue === "yes" && ["yes", "true", "active"].includes(actual);
}

/**
 * Create or update a task rule — ported from alTaxPortalSaveTaskRule. Admin-only.
 */
rulesRouter.post("/", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const taskType = String(body.taskType || "").trim();
  if (!taskType) return res.status(400).json({ error: "Task type is required." });

  const ruleId = String(body.ruleId || "").trim() || `TR-${idSuffix()}`;
  const existing = await queryOne<any>(`SELECT rule_id FROM altax.v3_task_rules WHERE rule_id = $1`, [ruleId]);

  const fields = {
    task_type: taskType,
    trigger_column: String(body.triggerColumn || "").trim() || null,
    trigger_value: String(body.triggerValue || "").trim() || null,
    frequency: String(body.frequency || "Monthly").trim(),
    period_type: String(body.periodType || "").trim() || null,
    due_month: String(body.dueMonth || "").trim() || null,
    due_day: String(body.dueDay || "").trim() || null,
    payment_required: body.paymentRequired === undefined ? false : Boolean(body.paymentRequired),
    requires_filing: body.requiresFiling === undefined ? true : Boolean(body.requiresFiling),
    portal_name: String(body.portalName || "").trim() || null,
    warning_days: String(body.warningDays || "14,7,3").trim() || null,
    active: body.active === undefined ? true : Boolean(body.active),
    notes: String(body.notes || "").trim() || null,
    depends_on: String(body.dependsOn || "").trim() || null,
    portal_url: String(body.portalUrl || "").trim() || null,
  };

  if (existing) {
    const setClause = Object.keys(fields).map((col, i) => `${col} = $${i + 2}`).join(", ");
    await query(`UPDATE altax.v3_task_rules SET ${setClause}, updated_at = now() WHERE rule_id = $1`, [ruleId, ...Object.values(fields)]);
    await logAudit("Rules", "EDIT_RULE", ruleId, "", "", taskType, `Task rule edited by ${req.user!.email}.`, req.user!.email);
  } else {
    const columns = ["rule_id", ...Object.keys(fields)];
    const values = [ruleId, ...Object.values(fields)];
    await query(`INSERT INTO altax.v3_task_rules (${columns.join(", ")}) VALUES (${values.map((_, i) => `$${i + 1}`).join(", ")})`, values);
    await logAudit("Rules", "CREATE_RULE", ruleId, "", "", taskType, `Task rule created by ${req.user!.email}.`, req.user!.email);
  }

  res.json({ ok: true, ruleId });
}));

/** List task rules — admin/staff read (reference/config data). */
rulesRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query(`SELECT * FROM altax.v3_task_rules ORDER BY task_type ASC`);
  res.json({ rules: rows });
}));

/**
 * Run a task rule as a batch — ported from alTaxPortalCreateTaskBatch. Admin-only.
 * Matches active clients against the rule's trigger (or uses an explicit clientIds
 * list), skips clients that already have a matching non-terminal task
 * (alTaxV5TaskDuplicateExists_), creates one task per remaining match, and logs a
 * v3_Task_Batches summary row. Pass `dryRun: true` to compute the same matches/skips
 * without writing anything — see module doc comment for why.
 */
rulesRouter.post("/:ruleId/batch", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { ruleId } = req.params;
  const rule = await queryOne<any>(`SELECT * FROM altax.v3_task_rules WHERE rule_id = $1`, [ruleId]);
  if (!rule) return res.status(404).json({ error: "Rule not found." });
  if (!isActiveFlag(rule.active)) return res.status(400).json({ error: "Rule is inactive." });

  const body = req.body || {};
  const periodLabel = String(body.periodLabel || "").trim();
  const dueDate = String(body.dueDate || "").trim();
  if (!periodLabel) return res.status(400).json({ error: "Period label is required." });
  if (!dueDate) return res.status(400).json({ error: "Due date is required." });

  const dryRun = Boolean(body.dryRun);
  const taskType = String(rule.task_type || body.taskType || "Custom").trim();
  const assignedTo = String(body.assignedTo || "").trim();

  const selectedClientIds = new Set<string>(Array.isArray(body.clientIds) ? body.clientIds.map((c: any) => String(c).trim()).filter(Boolean) : []);
  const activeClients = await query<any>(`SELECT * FROM altax.v3_clients WHERE status IS NULL OR lower(status) NOT IN ('no','false','inactive','archived')`);
  const matchedClients = activeClients.filter((client) =>
    selectedClientIds.size > 0 ? selectedClientIds.has(String(client.client_id)) : clientMatchesRule(client, rule)
  );
  if (!matchedClients.length) return res.status(400).json({ error: "No active clients matched this batch." });

  const results: { clientId: string; clientName: string; action: "create" | "skip" }[] = [];
  for (const client of matchedClients) {
    const duplicate = await queryOne(
      `SELECT 1 FROM altax.v3_tasks
        WHERE client_id = $1 AND lower(task_name) = lower($2) AND lower(coalesce(period,'')) = lower($3)
          AND lower(status) NOT IN ('completed','closed','archived','void')
        LIMIT 1`,
      [client.client_id, taskType, periodLabel]
    );
    results.push({ clientId: client.client_id, clientName: client.client_name, action: duplicate ? "skip" : "create" });
  }

  const toCreate = results.filter((r) => r.action === "create");
  const skipped = results.length - toCreate.length;

  if (dryRun) {
    return res.json({ ok: true, dryRun: true, ruleId, wouldCreate: toCreate.length, wouldSkip: skipped, results });
  }

  const batchId = `BATCH-${idSuffix()}`;
  const batchNote = String(body.notes || "").trim();
  const taskNotes = `Created by batch ${batchId}${batchNote ? `\nBatch notes: ${batchNote}` : ""}`;

  for (const r of toCreate) {
    const client = matchedClients.find((c) => c.client_id === r.clientId)!;
    const taskId = `BT-${idSuffix()}`;
    const finalAssignedTo = String(assignedTo || client.assigned_to || "AL").trim();
    await query(
      `INSERT INTO altax.v3_tasks
         (task_id, client_id, client_name, service_line, task_name, period, frequency, agency_due_date,
          staff_due_date, status, assigned_to, payment_required, portal_name, portal_url, notes,
          source_system, source_record_id)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,'Not Started',$9,$10,$11,$12,$13,'Unified Web App Batch',$14)`,
      [
        taskId, client.client_id, client.client_name, taskType, periodLabel,
        String(rule.frequency || body.frequency || "").trim() || null, dueDate,
        String(body.staffDueDate || "").trim() || null, finalAssignedTo,
        Boolean(rule.payment_required), String(rule.portal_name || "").trim() || null,
        String(rule.portal_url || "").trim() || null, taskNotes, batchId,
      ]
    );
  }

  await query(
    `INSERT INTO altax.v3_task_batches
       (batch_id, created_at, created_by, rule_id, task_type, frequency, period_label, period_start,
        period_end, due_date, staff_due_date, assigned_to, task_count, skipped_count, status, notes,
        selected_client_i_ds)
     VALUES ($1,now(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Created',$14,$15)`,
    [
      batchId, req.user!.email, ruleId, taskType, String(rule.frequency || "").trim() || null, periodLabel,
      String(body.periodStart || "").trim() || null, String(body.periodEnd || "").trim() || null, dueDate,
      String(body.staffDueDate || "").trim() || null, assignedTo || null, toCreate.length, skipped,
      batchNote || null, matchedClients.map((c) => c.client_id).join(", "),
    ]
  );

  await logAudit("Tasks", "BATCH_CREATE", batchId, "", "", String(toCreate.length),
    `Batch tasks created from rule ${ruleId}.`, req.user!.email);

  res.status(201).json({ ok: true, batchId, created: toCreate.length, skipped, results });
}));

/** List past task batches — admin/staff read, for reviewing what a prior batch run did. */
rulesRouter.get("/batches", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query(`SELECT * FROM altax.v3_task_batches ORDER BY created_at DESC NULLS LAST`);
  res.json({ batches: rows });
}));
