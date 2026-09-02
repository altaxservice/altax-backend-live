import { Router, Response } from "express";
import crypto from "crypto";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { normalizeText } from "../../common/assignment";
import { sendEmail, recordNotificationFailure } from "../../common/notifications";
import { escapeHtml } from "../../common/html";

/**
 * Task Rules & Batches module — completes Phase 3. Ported from alTaxPortalSaveTaskRule,
 * alTaxV5ClientMatchesRule_, alTaxV5TaskDuplicateExists_, and alTaxPortalCreateTaskBatch.
 * All admin-only, matching alTaxV5RequirePortalUser_(email, true) in every legacy function
 * here. This is deterministic rule-matching (does client field X equal value Y), not
 * financial calculation — unlike Phase 7's Accounting engines, it doesn't fall under the
 * plan's "no test fixtures, no migration" rule, so it's safe to port alongside CRUD.
 *
 * alTaxV5NotifyStaffTaskBatch_ is now ported (below, as notifyStaffOfNewTaskBatches) —
 * email infra exists throughout this backend now, so the original "no email infra"
 * reasoning no longer applies. It only fires for the unattended nightly sweep, not a
 * staff-initiated "Run Agent Now", since that caller already sees the result in the UI.
 *
 * Deliberately NOT ported:
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
  return `${ts}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export function isActiveFlag(value: unknown): boolean {
  return !["no", "false", "inactive", "archived"].includes(normalizeText(value ?? "Yes"));
}

function dateOnly(value: unknown): Date {
  const parsed = value ? new Date(value as any) : new Date();
  const d = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function dateString(value: unknown): string {
  const d = dateOnly(value);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function addDays(value: unknown, days: number): Date {
  const d = dateOnly(value);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d;
}
function lastDayOfMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface DuePeriod { periodLabel: string; periodStart: string; periodEnd: string; dueDate: string }

/**
 * Computes the most recently fully-completed reporting period for a rule, as
 * of `asOf`, plus its due date — purely from frequency/due_day/due_month, with
 * no per-rule "last run" state stored anywhere (see sql/034_task_rules_agent.sql's
 * doc comment for the tradeoff this stateless design accepts). due_month is
 * treated as "how many calendar months after the period ends the filing is
 * due" (defaulting to 1, the same "due the following month" shape every
 * Monthly/Quarterly rule already uses) rather than an absolute month number —
 * this is a deliberate reinterpretation: due_month/period_type were columns
 * already sitting in the schema with no UI ever wired up to set them (every
 * existing rule has them NULL), so there's no live behavior this could
 * conflict with, and this shape lets Semiannual/Annual rules configure a
 * non-default offset without needing to also encode which specific month.
 *
 * Returns null when the rule's frequency has no sensible period/due-date
 * shape to compute automatically (Weekly, One-Time) or when due_day isn't
 * set — those rules simply aren't eligible for the Task Rules Agent and stay
 * manual-only via the existing Create Batch Tasks flow.
 */
export function computeDuePeriod(rule: any, asOf: Date): DuePeriod | null {
  const freq = String(rule.frequency || "").trim().toLowerCase();
  const dueDay = Math.trunc(Number(rule.due_day));
  if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) return null;

  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth();

  function dueDateInMonth(year: number, month0: number): string {
    const day = Math.min(dueDay, lastDayOfMonth(year, month0));
    return dateString(new Date(Date.UTC(year, month0, day)));
  }

  if (freq === "monthly") {
    const pm = m === 0 ? 11 : m - 1;
    const py = m === 0 ? y - 1 : y;
    const periodStart = dateString(new Date(Date.UTC(py, pm, 1)));
    const periodEnd = dateString(new Date(Date.UTC(py, pm, lastDayOfMonth(py, pm))));
    const dueMonth0 = pm === 11 ? 0 : pm + 1;
    const dueYear = pm === 11 ? py + 1 : py;
    return { periodLabel: `${MONTH_NAMES[pm]} ${py}`, periodStart, periodEnd, dueDate: dueDateInMonth(dueYear, dueMonth0) };
  }

  if (freq === "quarterly") {
    const currentQuarter = Math.floor(m / 3);
    let pq = currentQuarter - 1;
    let py = y;
    if (pq < 0) { pq = 3; py = y - 1; }
    const qStartMonth0 = pq * 3;
    const qEndMonth0 = qStartMonth0 + 2;
    const periodStart = dateString(new Date(Date.UTC(py, qStartMonth0, 1)));
    const periodEnd = dateString(new Date(Date.UTC(py, qEndMonth0, lastDayOfMonth(py, qEndMonth0))));
    const dueMonth0 = qEndMonth0 === 11 ? 0 : qEndMonth0 + 1;
    const dueYear = qEndMonth0 === 11 ? py + 1 : py;
    return { periodLabel: `Q${pq + 1} ${py}`, periodStart, periodEnd, dueDate: dueDateInMonth(dueYear, dueMonth0) };
  }

  if (freq === "semiannual" || freq === "annual") {
    const offsetMonths = Math.max(1, Math.trunc(Number(rule.due_month)) || 1);

    if (freq === "annual") {
      const py = y - 1;
      const periodStart = dateString(new Date(Date.UTC(py, 0, 1)));
      const periodEnd = dateString(new Date(Date.UTC(py, 11, 31)));
      const totalMonths = 11 + offsetMonths;
      const dueYear = py + Math.floor(totalMonths / 12);
      const dueMonth0 = totalMonths % 12;
      return { periodLabel: `${py}`, periodStart, periodEnd, dueDate: dueDateInMonth(dueYear, dueMonth0) };
    }

    // Semiannual: H1 = Jan-Jun, H2 = Jul-Dec — whichever half most recently completed.
    const inH1 = m < 6;
    const endYear = inH1 ? y - 1 : y;
    const endMonth0 = inH1 ? 11 : 5;
    const periodStart = dateString(new Date(Date.UTC(endYear, inH1 ? 6 : 0, 1)));
    const periodEnd = dateString(new Date(Date.UTC(endYear, endMonth0, lastDayOfMonth(endYear, endMonth0))));
    const label = inH1 ? `H2 ${endYear}` : `H1 ${endYear}`;
    const totalMonths = endMonth0 + offsetMonths;
    const dueYear = endYear + Math.floor(totalMonths / 12);
    const dueMonth0 = totalMonths % 12;
    return { periodLabel: label, periodStart, periodEnd, dueDate: dueDateInMonth(dueYear, dueMonth0) };
  }

  return null; // Weekly, One-Time, or an unrecognized frequency.
}

/**
 * The last `count` periods for a rule, oldest first — built by walking
 * computeDuePeriod backward rather than duplicating its date math. Feeding a
 * period's own periodStart back in as the next asOf deterministically yields
 * the immediately preceding period for every frequency computeDuePeriod
 * supports (Monthly steps back one month, Quarterly one quarter, Semiannual
 * one half, Annual one year — verified against each branch above). Stops
 * early (fewer than `count` results) for Weekly/One-Time/no-due_day rules,
 * matching computeDuePeriod's own null contract — those simply have no
 * period grid to walk.
 */
export function computeDuePeriodsBack(rule: any, asOf: Date, count: number): DuePeriod[] {
  const periods: DuePeriod[] = [];
  let cursor = asOf;
  for (let i = 0; i < count; i++) {
    const p = computeDuePeriod(rule, cursor);
    if (!p) break;
    periods.push(p);
    cursor = new Date(`${p.periodStart}T00:00:00Z`);
  }
  return periods.reverse();
}

/** The largest lead time in a rule's comma-separated warning_days ("14,7,3") — how many days before the due date the agent starts drafting. Falls back to 7 when unset/unparseable. */
function parseMaxWarningDays(rule: any): number {
  const parts = String(rule.warning_days || "").split(",").map((s) => Math.trunc(Number(s.trim()))).filter((n) => Number.isFinite(n) && n >= 0);
  return parts.length ? Math.max(...parts) : 7;
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
export const CLIENT_TRIGGER_COLUMNS: Record<string, string> = {
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
function matchesSingleCondition(client: any, triggerColumnRaw: string, triggerValueRaw: string): boolean {
  const triggerColumn = CLIENT_TRIGGER_COLUMNS[triggerColumnRaw];
  if (!triggerColumn) return false;

  const triggerValue = normalizeText(triggerValueRaw);
  const actual = normalizeText(client[triggerColumn]);
  if (actual === triggerValue) return true;
  return triggerValue === "yes" && ["yes", "true", "active"].includes(actual);
}

/**
 * A rule normally has one trigger_column/trigger_value pair. trigger_column_2/
 * trigger_value_2 (sql/136_task_rules_second_condition.sql) add an optional
 * second, AND-combined condition — needed for a rule like "Form 941 Filing"
 * that must require BOTH its real domain gate (Payroll? = Yes) AND a
 * payroll-provider split (PayrollSystem = Drake), where simply repointing
 * trigger_column to PayrollSystem would silently drop the domain gate for
 * every client whose provider happens to match but who doesn't actually have
 * that obligation enabled.
 */
export function clientMatchesRule(client: any, rule: any): boolean {
  const triggerColumnRaw = String(rule.trigger_column || "").trim();
  const triggerValueRaw = String(rule.trigger_value || "").trim();
  const isEmptyTrigger = !triggerColumnRaw || !normalizeText(triggerValueRaw) || normalizeText(triggerValueRaw) === "=";

  const triggerColumn2Raw = String(rule.trigger_column_2 || "").trim();
  const triggerValue2Raw = String(rule.trigger_value_2 || "").trim();
  const hasSecondCondition = triggerColumn2Raw && normalizeText(triggerValue2Raw) && normalizeText(triggerValue2Raw) !== "=";

  const firstMatches = isEmptyTrigger || matchesSingleCondition(client, triggerColumnRaw, triggerValueRaw);
  if (!firstMatches) return false;
  if (!hasSecondCondition) return true;
  return matchesSingleCondition(client, triggerColumn2Raw, triggerValue2Raw);
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
    trigger_column_2: String(body.triggerColumn2 || "").trim() || null,
    trigger_value_2: String(body.triggerValue2 || "").trim() || null,
    frequency: String(body.frequency || "Monthly").trim(),
    period_type: String(body.periodType || "").trim() || null,
    due_month: String(body.dueMonth || "").trim() || null,
    due_day: String(body.dueDay || "").trim() || null,
    payment_required: body.paymentRequired === undefined ? false : Boolean(body.paymentRequired),
    requires_filing: body.requiresFiling === undefined ? true : Boolean(body.requiresFiling),
    portal_name: String(body.portalName || "").trim() || null,
    warning_days: String(body.warningDays || "14,7,3").trim() || null,
    active: body.active === undefined ? true : Boolean(body.active),
    agent_enabled: body.agentEnabled === undefined ? true : Boolean(body.agentEnabled),
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


interface RunRuleBatchOpts {
  periodLabel: string;
  dueDate: string;
  periodStart?: string;
  periodEnd?: string;
  staffDueDate?: string;
  assignedTo?: string;
  notes?: string;
  clientIds?: string[];
  dryRun?: boolean;
  actorEmail: string;
}
interface RunRuleBatchOk {
  ok: true;
  wouldCreate: number; wouldSkip: number;
  results: { clientId: string; clientName: string; action: "create" | "skip" }[];
  created?: number; skipped?: number; batchId?: string;
}
type RunRuleBatchResult = RunRuleBatchOk | { ok: false; error: string };

/**
 * The actual batch-creation logic, extracted from the POST /:ruleId/batch
 * handler below so both that route AND the Task Rules Agent's draft-approval
 * route (further down) share exactly one implementation — matching active
 * clients, the per-client duplicate-task guard, and the v3_task_batches
 * summary row all happen here, once. The route stays a thin wrapper; the
 * agent's approval path calls this directly with no clientIds, so it matches
 * whichever clients the rule's trigger matches LIVE at approval time — never
 * a snapshot taken back when the draft was created.
 */
async function runRuleBatch(rule: any, opts: RunRuleBatchOpts): Promise<RunRuleBatchResult> {
  const dryRun = Boolean(opts.dryRun);
  const taskType = String(rule.task_type || "Custom").trim();
  const assignedTo = String(opts.assignedTo || "").trim();

  const selectedClientIds = new Set<string>((opts.clientIds || []).map((c) => String(c).trim()).filter(Boolean));
  const activeClients = await query<any>(`SELECT * FROM altax.v3_clients WHERE status IS NULL OR lower(status) NOT IN ('no','false','inactive','archived')`);
  const matchedClients = activeClients.filter((client) =>
    selectedClientIds.size > 0 ? selectedClientIds.has(String(client.client_id)) : clientMatchesRule(client, rule)
  );
  if (!matchedClients.length) return { ok: false, error: "No active clients matched this batch." };

  const results: { clientId: string; clientName: string; action: "create" | "skip" }[] = [];
  for (const client of matchedClients) {
    const duplicate = await queryOne(
      `SELECT 1 FROM altax.v3_tasks
        WHERE client_id = $1 AND lower(task_name) = lower($2) AND lower(coalesce(period,'')) = lower($3)
          AND lower(status) NOT IN ('completed','closed','archived','void')
        LIMIT 1`,
      [client.client_id, taskType, opts.periodLabel]
    );
    results.push({ clientId: client.client_id, clientName: client.client_name, action: duplicate ? "skip" : "create" });
  }

  const toCreate = results.filter((r) => r.action === "create");
  const skipped = results.length - toCreate.length;

  if (dryRun) {
    return { ok: true, wouldCreate: toCreate.length, wouldSkip: skipped, results };
  }

  const batchId = `BATCH-${idSuffix()}`;
  const batchNote = String(opts.notes || "").trim();
  // 1120/1120S/1065/Schedule C used to be four separately-named task types
  // cluttering both the Task Rules list and every client's task list, purely
  // because each has its own due date and so needs its own rule row — the
  // owner's own words: "it should be only one Task, and we can mention the
  // type inside the task." They now share one task_type ("Business Return",
  // the pre-existing catalog entry in MANAGED_DROPDOWN_DEFAULTS.taskTypes —
  // not a new string); the specific return type still needs to be visible
  // somewhere, so it goes in the task's own notes instead of the name.
  const isBusinessReturnRule = CLIENT_TRIGGER_COLUMNS[String(rule.trigger_column || "").trim()] === "business_return_type";
  const returnTypeNote = isBusinessReturnRule && rule.trigger_value ? `Return type: ${rule.trigger_value}` : null;
  const taskNotes = [returnTypeNote, `Created by batch ${batchId}`, batchNote ? `Batch notes: ${batchNote}` : null].filter(Boolean).join("\n");

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
        taskId, client.client_id, client.client_name, taskType, opts.periodLabel,
        String(rule.frequency || "").trim() || null, opts.dueDate,
        String(opts.staffDueDate || "").trim() || null, finalAssignedTo,
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
      batchId, opts.actorEmail, rule.rule_id, taskType, String(rule.frequency || "").trim() || null, opts.periodLabel,
      opts.periodStart || null, opts.periodEnd || null, opts.dueDate,
      String(opts.staffDueDate || "").trim() || null, assignedTo || null, toCreate.length, skipped,
      batchNote || null, matchedClients.map((c) => c.client_id).join(", "),
    ]
  );

  await logAudit("Tasks", "BATCH_CREATE", batchId, "", "", String(toCreate.length),
    `Batch tasks created from rule ${rule.rule_id}.`, opts.actorEmail);

  return { ok: true, wouldCreate: toCreate.length, wouldSkip: skipped, results, created: toCreate.length, skipped, batchId };
}

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

  const result = await runRuleBatch(rule, {
    periodLabel, dueDate,
    periodStart: String(body.periodStart || "").trim() || undefined,
    periodEnd: String(body.periodEnd || "").trim() || undefined,
    staffDueDate: body.staffDueDate, assignedTo: body.assignedTo, notes: body.notes,
    clientIds: Array.isArray(body.clientIds) ? body.clientIds : undefined,
    dryRun: Boolean(body.dryRun),
    actorEmail: req.user!.email,
  });
  if (!result.ok) return res.status(400).json({ error: result.error });

  if (body.dryRun) {
    return res.json({ ok: true, dryRun: true, ruleId, wouldCreate: result.wouldCreate, wouldSkip: result.wouldSkip, results: result.results });
  }
  res.status(201).json({ ok: true, batchId: result.batchId, created: result.created, skipped: result.skipped, results: result.results });
}));

/** List past task batches — admin/staff read, for reviewing what a prior batch run did. */
rulesRouter.get("/batches", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query(`SELECT * FROM altax.v3_task_batches ORDER BY created_at DESC NULLS LAST`);
  res.json({ batches: rows });
}));

// ---------------------------------------------------------------------------
// Task Rules Agent — background automation that drafts recurring compliance
// task batches from an active rule instead of requiring a staff member to
// open Create Batch Tasks and type in the period/due date by hand every time
// one rolls around. Same "auto-draft, staff reviews and approves before
// anything real gets created" two-gate shape as the Payroll Agent
// (payrollAgent.routes.ts) and Bank Rec Agent (bankRec.routes.ts) — see
// sql/034_task_rules_agent.sql's header comment for the full design and its
// one accepted tradeoff (no per-rule "last run" state, so a long sweep outage
// can skip an intervening period once time has moved past it).
// ---------------------------------------------------------------------------

/** Whether the nightly cron is allowed to draft on its own — checked by server.ts before calling runTaskRulesAgentSweep. Manual "Run Agent Now" (the /agent/run route below) never checks this; it's an explicit staff action. */
export async function isTaskRulesAgentAutoRunEnabled(): Promise<boolean> {
  const row = await queryOne<any>(`SELECT auto_run_enabled FROM altax.v3_task_rules_agent_settings WHERE id = 'TRAGENT-1'`);
  return row ? row.auto_run_enabled !== false : true;
}

/**
 * One digest email per sweep run (not one per batch) to every active
 * admin/staff user, matching the SWOT Findings Sweep / Monthly Management
 * Summary convention already used elsewhere in this app. Best-effort:
 * the drafts themselves are already committed by the time this runs, so a
 * failed send here never loses or blocks any created draft.
 */
async function notifyStaffOfNewTaskBatches(created: { draftId: string; ruleId: string; taskType: string; periodLabel: string; dueDate: string }[]): Promise<void> {
  if (created.length === 0) return;
  const recipients = await query<any>(`SELECT email FROM altax.v3_users WHERE active = true AND lower(role) IN ('admin','staff') AND email IS NOT NULL AND email <> ''`);
  if (recipients.length === 0) return;

  const rows = created
    .map((c) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(c.taskType)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(c.periodLabel)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(c.dueDate)}</td></tr>`)
    .join("");
  const html = `
    <div style="max-width:520px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
      <div style="background:#1f2937;color:#ffffff;padding:16px 20px;border-radius:10px 10px 0 0;">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;opacity:0.85;">Task Rules Agent</div>
        <div style="font-size:19px;font-weight:800;margin-top:4px;">${created.length} new task batch${created.length === 1 ? "" : "es"} awaiting review</div>
      </div>
      <div style="border:1px solid #e0e0e0;border-top:none;border-radius:0 0 10px 10px;padding:18px 20px;font-size:14px;">
        <p style="margin:0 0 12px;">The nightly Task Rules Agent sweep drafted the following batch${created.length === 1 ? "" : "es"}. Review and create them from Task Rules &amp; Batches.</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr><th style="text-align:left;padding:6px 10px;border-bottom:2px solid #ddd;">Task Type</th><th style="text-align:left;padding:6px 10px;border-bottom:2px solid #ddd;">Period</th><th style="text-align:left;padding:6px 10px;border-bottom:2px solid #ddd;">Due Date</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  for (const r of recipients) {
    try {
      await sendEmail({ to: r.email, subject: `${created.length} new task batch${created.length === 1 ? "" : "es"} awaiting review`, html });
    } catch (err) {
      await recordNotificationFailure(`rules:agent-batch-digest:${r.email}`, err);
    }
  }
}

/**
 * The sweep: for every active rule with an auto-schedulable frequency
 * (Monthly/Quarterly/Semiannual/Annual with a due_day set — see
 * computeDuePeriod), computes the most recently completed period and its due
 * date, and — once today is within the rule's warning window of that due
 * date, or already past it — creates a Pending draft, unless one already
 * exists for this exact rule+period (idempotent via the
 * UNIQUE(rule_id, period_label) constraint) or a real batch already covers it
 * (the period was already run manually via Create Batch Tasks).
 */
export async function runTaskRulesAgentSweep(actorEmail: string, opts: { runDate?: string } = {}): Promise<{ created: any[]; skipped: number; errors: string[] }> {
  const runDate = dateOnly(opts.runDate);
  // active alone used to be the only gate — every active rule got swept
  // whether or not that was ever a deliberate choice for automation
  // specifically (sql/126_task_rules_agent_enabled.sql). agent_enabled is
  // the explicit "yes, draft this one automatically" opt-in; active still
  // independently controls whether a rule can be used for a manual batch.
  const rules = await query<any>(`SELECT * FROM altax.v3_task_rules WHERE active = true AND agent_enabled = true`);
  const created: any[] = [];
  const errors: string[] = [];
  let skipped = 0;

  // Per-rule try/catch — previously a single bad rule (a DB error, an unexpected
  // shape) aborted every remaining rule's draft with no record of who got
  // skipped, matching SWOT Sweep's per-client isolation pattern.
  for (const rule of rules) {
    try {
      const period = computeDuePeriod(rule, runDate);
      if (!period) { skipped++; continue; }

      // Never originate a brand-new draft for a period whose due date has
      // already passed. Without this, the very first sweep for a rule (or a
      // sweep that follows a long outage) would "discover" every historical
      // period at once and draft all of them — most of which were already
      // filed and completed by staff long before this feature existed. The
      // duplicate-task guard in runRuleBatch deliberately excludes completed/
      // closed tasks (so a straggler client can still get a fresh task for the
      // *current* period even after everyone else's is done), which means it
      // does NOT catch "this exact period was already finished" — so
      // backfilling old periods reliably recreated already-done work. Once a
      // period's due date has passed without ever being drafted, it's handled
      // manually via the existing Create Batch Tasks flow, not by the agent.
      if (dateOnly(period.dueDate).getTime() < runDate.getTime()) { skipped++; continue; }

      const draftFrom = addDays(dateOnly(period.dueDate), -parseMaxWarningDays(rule));
      if (draftFrom.getTime() > runDate.getTime()) { skipped++; continue; }

      const existingDraft = await queryOne<any>(
        `SELECT task_batch_draft_id FROM altax.v3_task_batch_drafts WHERE rule_id = $1 AND period_label = $2`,
        [rule.rule_id, period.periodLabel]
      );
      if (existingDraft) { skipped++; continue; }
      const existingBatch = await queryOne<any>(
        `SELECT batch_id FROM altax.v3_task_batches WHERE rule_id = $1 AND period_label = $2`,
        [rule.rule_id, period.periodLabel]
      );
      if (existingBatch) { skipped++; continue; }

      // Dry-run first — a rule whose trigger currently matches no active client
      // (a narrow trigger, or every matching client already archived) is a
      // normal, quiet skip here, not an error to surface.
      const preview = await runRuleBatch(rule, {
        periodLabel: period.periodLabel, dueDate: period.dueDate,
        periodStart: period.periodStart, periodEnd: period.periodEnd,
        dryRun: true, actorEmail,
      });
      if (!preview.ok) { skipped++; continue; }

      const draftId = `TBDFT-${idSuffix()}`;
      const sourceRecordId = `${rule.rule_id}:${period.periodLabel}`;
      await query(
        `INSERT INTO altax.v3_task_batch_drafts
           (task_batch_draft_id, rule_id, task_type, frequency, period_label, period_start, period_end, due_date,
            matched_client_count, source_record_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (rule_id, period_label) DO NOTHING`,
        [draftId, rule.rule_id, rule.task_type, rule.frequency, period.periodLabel, period.periodStart, period.periodEnd, period.dueDate,
          preview.wouldCreate + preview.wouldSkip, sourceRecordId]
      );
      created.push({ draftId, ruleId: rule.rule_id, taskType: rule.task_type, periodLabel: period.periodLabel, dueDate: period.dueDate });
    } catch (err: any) {
      errors.push(`${rule.task_type || rule.rule_id}: ${err?.message || "Unexpected error drafting this rule."}`);
      // eslint-disable-next-line no-console
      console.error(`[runTaskRulesAgentSweep] rule ${rule.rule_id} failed:`, err);
    }
  }

  if (created.length > 0 && actorEmail.startsWith("System (")) {
    try {
      await notifyStaffOfNewTaskBatches(created);
    } catch (err) {
      await recordNotificationFailure("rules:agent-batch-digest-wrapper", err);
    }
  }

  return { created, skipped, errors };
}

rulesRouter.post("/agent/run", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const result = await runTaskRulesAgentSweep(req.user!.email, { runDate: req.body?.runDate });
  res.json({ ok: true, ...result });
}));

rulesRouter.get("/agent/settings", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const row = await queryOne<any>(`SELECT * FROM altax.v3_task_rules_agent_settings WHERE id = 'TRAGENT-1'`);
  res.json({
    autoRunEnabled: row ? row.auto_run_enabled !== false : true,
    updatedBy: row?.updated_by ?? null,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  });
}));

rulesRouter.post("/agent/settings", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const enabled = Boolean((req.body || {}).autoRunEnabled);
  await query(
    `INSERT INTO altax.v3_task_rules_agent_settings (id, auto_run_enabled, updated_by, updated_at)
     VALUES ('TRAGENT-1', $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET auto_run_enabled = $1, updated_by = $2, updated_at = now()`,
    [enabled, req.user!.email]
  );
  await logAudit("Rules", "TASK_RULES_AGENT_AUTO_RUN_TOGGLE", "TRAGENT-1", "", "", enabled ? "On" : "Off",
    `Task Rules Agent auto-run turned ${enabled ? "on" : "off"} by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true, autoRunEnabled: enabled });
}));

/** Dashboard summary card payload — active-rule count, pending draft count, and the min/max due-date range across pending drafts. */
rulesRouter.get("/agent/summary", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const activeRules = await query<any>(`SELECT rule_id FROM altax.v3_task_rules WHERE active = true`);
  const pendingDrafts = await query<any>(`SELECT due_date FROM altax.v3_task_batch_drafts WHERE status = 'Pending'`);

  let rangeLabel: string | null = null;
  if (pendingDrafts.length) {
    const dates = pendingDrafts.map((d: any) => dateOnly(d.due_date).getTime());
    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    rangeLabel = min.getTime() === max.getTime() ? fmt(min) : `${fmt(min)} - ${fmt(max)}`;
  }

  res.json({
    active: activeRules.length > 0,
    ruleCount: activeRules.length,
    pendingCount: pendingDrafts.length,
    rangeLabel,
    autoRunEnabled: await isTaskRulesAgentAutoRunEnabled(),
  });
}));

/** Pending (or other-status) drafts, each with a freshly recomputed match preview — never a stale count, same "recompute at display time" rule Payroll Agent's calculatePaycheck preview follows. */
rulesRouter.get("/batch-drafts", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const status = String(req.query.status || "Pending").trim();
  const rows = await query<any>(`SELECT * FROM altax.v3_task_batch_drafts WHERE status = $1 ORDER BY due_date ASC, period_label ASC`, [status]);

  const results = [];
  for (const draft of rows) {
    const rule = await queryOne<any>(`SELECT * FROM altax.v3_task_rules WHERE rule_id = $1`, [draft.rule_id]);
    let preview: { wouldCreate: number; wouldSkip: number } | null = null;
    let previewError: string | null = null;
    if (!rule) {
      previewError = "Rule no longer exists.";
    } else if (!isActiveFlag(rule.active)) {
      previewError = "This rule has since been deactivated.";
    } else {
      const overrides = draft.staff_overrides || {};
      const preview_ = await runRuleBatch(rule, {
        periodLabel: draft.period_label, dueDate: dateString(draft.due_date),
        periodStart: draft.period_start ? dateString(draft.period_start) : undefined,
        periodEnd: draft.period_end ? dateString(draft.period_end) : undefined,
        staffDueDate: overrides.staffDueDate, assignedTo: overrides.assignedTo, notes: overrides.notes,
        dryRun: true, actorEmail: "preview",
      });
      if (preview_.ok) preview = { wouldCreate: preview_.wouldCreate, wouldSkip: preview_.wouldSkip };
      else previewError = preview_.error;
    }
    results.push({ ...draft, preview, previewError });
  }
  res.json({ drafts: results });
}));

rulesRouter.patch("/batch-drafts/:id", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const draft = await queryOne<any>(`SELECT * FROM altax.v3_task_batch_drafts WHERE task_batch_draft_id = $1`, [req.params.id]);
  if (!draft) return res.status(404).json({ error: "Draft not found." });
  if (draft.status !== "Pending") return res.status(400).json({ error: "Only pending drafts can be edited." });

  const overrides = req.body?.overrides && typeof req.body.overrides === "object" ? req.body.overrides : {};
  await query(`UPDATE altax.v3_task_batch_drafts SET staff_overrides = $2, updated_at = now() WHERE task_batch_draft_id = $1`, [draft.task_batch_draft_id, JSON.stringify(overrides)]);
  res.json({ ok: true });
}));

/** Reverts a failed-after-claim draft back to Pending so it's still approvable once the underlying issue is fixed. */
async function releaseBatchDraftClaim(draftId: string): Promise<void> {
  await query(
    `UPDATE altax.v3_task_batch_drafts SET status='Pending', approved_by=NULL, approved_at=NULL, updated_at=now() WHERE task_batch_draft_id=$1`,
    [draftId]
  );
}

async function approveBatchDraft(draftId: string, actorEmail: string): Promise<{ ok: true; batchId: string; created: number; skipped: number } | { ok: false; error: string }> {
  // Atomic claim first, same pattern as Payroll/Bank Rec Agent — a double-click
  // or concurrent bulk-approve can no longer both pass an earlier status read
  // and both run the batch twice for the same draft.
  const claimed = await queryOne<any>(
    `UPDATE altax.v3_task_batch_drafts SET status='Approved', approved_by=$2, approved_at=now(), updated_at=now()
     WHERE task_batch_draft_id=$1 AND status='Pending' RETURNING *`,
    [draftId, actorEmail]
  );
  if (!claimed) {
    const draft = await queryOne<any>(`SELECT status FROM altax.v3_task_batch_drafts WHERE task_batch_draft_id = $1`, [draftId]);
    if (!draft) return { ok: false, error: "Draft not found." };
    return { ok: false, error: `This draft is already ${draft.status}.` };
  }

  const rule = await queryOne<any>(`SELECT * FROM altax.v3_task_rules WHERE rule_id = $1`, [claimed.rule_id]);
  if (!rule) { await releaseBatchDraftClaim(draftId); return { ok: false, error: "Rule no longer exists." }; }
  if (!isActiveFlag(rule.active)) { await releaseBatchDraftClaim(draftId); return { ok: false, error: "This rule has since been deactivated." }; }

  const overrides = claimed.staff_overrides || {};
  const result = await runRuleBatch(rule, {
    periodLabel: claimed.period_label, dueDate: dateString(claimed.due_date),
    periodStart: claimed.period_start ? dateString(claimed.period_start) : undefined,
    periodEnd: claimed.period_end ? dateString(claimed.period_end) : undefined,
    staffDueDate: overrides.staffDueDate, assignedTo: overrides.assignedTo, notes: overrides.notes,
    actorEmail,
  });
  if (!result.ok) { await releaseBatchDraftClaim(draftId); return { ok: false, error: result.error }; }

  await query(`UPDATE altax.v3_task_batch_drafts SET resulting_batch_id=$2, updated_at=now() WHERE task_batch_draft_id=$1`, [draftId, result.batchId]);
  await logAudit("Tasks", "TASK_RULES_AGENT_APPROVE", draftId, "BatchID", "", result.batchId || "",
    `Task Rules Agent draft approved by ${actorEmail}.`, actorEmail);
  return { ok: true, batchId: result.batchId!, created: result.created!, skipped: result.skipped! };
}

rulesRouter.post("/batch-drafts/:id/approve", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const result = await approveBatchDraft(req.params.id, req.user!.email);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
}));

/** Bulk approve — partial success allowed, mirroring the Payroll Agent's approve-bulk. */
rulesRouter.post("/batch-drafts/approve-bulk", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const draftIds: string[] = Array.isArray(req.body?.draftIds) ? req.body.draftIds : [];
  if (!draftIds.length) return res.status(400).json({ error: "At least one draft is required." });

  const results: { draftId: string; ok: boolean; error?: string; batchId?: string; created?: number; skipped?: number }[] = [];
  for (const draftId of draftIds) {
    const result = await approveBatchDraft(draftId, req.user!.email);
    results.push({ draftId, ...result });
  }
  const succeeded = results.filter((r) => r.ok).length;
  res.status(succeeded > 0 ? 200 : 400).json({ ok: succeeded > 0, succeeded, failed: results.length - succeeded, results });
}));

rulesRouter.post("/batch-drafts/:id/dismiss", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const draft = await queryOne<any>(`SELECT * FROM altax.v3_task_batch_drafts WHERE task_batch_draft_id = $1`, [req.params.id]);
  if (!draft) return res.status(404).json({ error: "Draft not found." });
  if (draft.status !== "Pending") return res.status(400).json({ error: `This draft is already ${draft.status}.` });

  await query(
    `UPDATE altax.v3_task_batch_drafts SET status='Dismissed', dismissed_reason=$2, dismissed_by=$3, dismissed_at=now(), updated_at=now() WHERE task_batch_draft_id=$1`,
    [draft.task_batch_draft_id, String(req.body?.reason || "").trim() || null, req.user!.email]
  );
  await logAudit("Tasks", "TASK_RULES_AGENT_DISMISS", draft.task_batch_draft_id, "", "", "Dismissed",
    `Task Rules Agent draft dismissed by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

/**
 * Single rule — the Rule Detail page. Deliberately registered LAST among GET
 * routes on this router: a bare "/:ruleId" would otherwise shadow every
 * single-segment literal path above it (GET /batches, GET /batch-drafts) since
 * Express matches route registration order, not specificity.
 */
rulesRouter.get("/:ruleId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rule = await queryOne<any>(`SELECT * FROM altax.v3_task_rules WHERE rule_id = $1`, [req.params.ruleId]);
  if (!rule) return res.status(404).json({ error: "Rule not found." });
  res.json({ rule });
}));

/**
 * Permanent delete — type-to-confirm, matching UsersPage's own permanent-delete
 * convention, because this one has real, non-obvious side effects worth a staff
 * member consciously typing through rather than a single click: v3_task_batch_drafts
 * has ON DELETE CASCADE on rule_id (sql/034_task_rules_agent.sql), so any pending or
 * already-approved draft still referencing this rule is deleted along with it; and
 * v3_task_batches has ON DELETE SET NULL (sql/001_init_schema.sql), so historical
 * batches lose their link back to this rule (the batch and its tasks aren't touched).
 */
rulesRouter.post("/:ruleId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rule = await queryOne<any>(`SELECT rule_id, task_type FROM altax.v3_task_rules WHERE rule_id = $1`, [req.params.ruleId]);
  if (!rule) return res.status(404).json({ error: "Rule not found." });
  if (String((req.body || {}).confirm || "").trim() !== "DELETE RULE") {
    return res.status(400).json({ error: 'Type "DELETE RULE" to confirm this permanent action.' });
  }

  await query(`DELETE FROM altax.v3_task_rules WHERE rule_id = $1`, [rule.rule_id]);
  await logAudit("Rules", "DELETE_RULE", rule.rule_id, "", rule.task_type, "", `Task rule ${rule.rule_id} (${rule.task_type}) permanently deleted by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));
