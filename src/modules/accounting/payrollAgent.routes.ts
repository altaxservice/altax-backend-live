import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { calculatePaycheck, createSinglePaycheck, type PaycheckCreationResult } from "./accounting.routes";

/**
 * Payroll Agent — background automation that drafts upcoming paychecks for
 * employees on a recurring pay schedule, so staff review/approve a draft
 * instead of re-entering the same numbers every pay period. Modeled directly
 * on billing.routes.ts's v3_recurring_billing + runRecurringBillingSweep
 * pattern, with one deliberate difference: this never creates a real,
 * GL-posted v3_paychecks row on its own. It only ever produces a Pending
 * draft in v3_payroll_drafts; a real paycheck is created — via the exact
 * same createSinglePaycheck() the manual entry form and batch route use —
 * only when staff explicitly approves it. Drafts store no dollar amounts;
 * every number shown to staff is computed fresh from calculatePaycheck()
 * whenever a draft is displayed or approved, so a draft can never go stale
 * on screen (see sql/026_payroll_agent.sql's header comment).
 */
export const payrollAgentRouter = Router();

const FREQUENCIES = ["Weekly", "Biweekly", "Semimonthly", "Monthly"] as const;

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
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

/**
 * Advances a pay date one period forward for the four supported payroll
 * frequencies. Semimonthly uses a single fixed convention — the 1st and the
 * 16th of each month — rather than a per-schedule custom day; a schedule
 * anchored anywhere else in the month snaps to whichever of those two dates
 * comes next. This is a deliberate v1 simplification (see the plan's
 * "explicitly deferred" list), not an attempt at full QuickBooks-style
 * custom semimonthly scheduling.
 */
function nextPayrollDate(value: unknown, frequency: unknown): Date {
  const d = dateOnly(value);
  const key = String(frequency || "Biweekly").trim();
  if (key === "Weekly") { d.setUTCDate(d.getUTCDate() + 7); return d; }
  if (key === "Biweekly") { d.setUTCDate(d.getUTCDate() + 14); return d; }
  if (key === "Monthly") { d.setUTCMonth(d.getUTCMonth() + 1); return d; }
  // Semimonthly: 1st and 16th.
  if (d.getUTCDate() < 16) { d.setUTCDate(16); return d; }
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** Same recurring-amount eligibility rule enforced both when a schedule is
 * created and again at sweep time — an employee who was eligible when the
 * schedule was set up but has since gone inactive, become a contractor, or
 * had their pay defaults cleared should stop drafting, not draft a stale or
 * wrong number. */
function eligibilityError(employee: any): string | null {
  if (!employee) return "Employee not found.";
  const status = String(employee.status || "Active").trim().toLowerCase();
  if (["inactive", "archived", "deleted", "no", "false"].includes(status)) {
    return "This employee is not active.";
  }
  const workerSignal = [employee.worker_type, employee.form_type].join(" ").toLowerCase();
  if (workerSignal.includes("contractor") || workerSignal.includes("1099")) {
    return "Contractors are not eligible for the Payroll Agent — use the Contractors/1099 workflow instead.";
  }
  const hasGross = Number(employee.default_gross_wages) > 0;
  const hasHourly = Number(employee.pay_rate) > 0 && Number(employee.default_hours) > 0;
  if (!hasGross && !hasHourly) {
    return "This employee needs a Default Gross Wages amount, or both Pay Rate and Default Hours, before the Payroll Agent can draft their pay.";
  }
  return null;
}

payrollAgentRouter.post("/schedules", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const clientId = String(body.clientId || "").trim();
  const employeeId = String(body.employeeId || "").trim();
  if (!clientId || !employeeId) return res.status(400).json({ error: "Client and employee are required." });
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const frequency = String(body.frequency || "").trim();
  if (!FREQUENCIES.includes(frequency as any)) {
    return res.status(400).json({ error: `Frequency must be one of: ${FREQUENCIES.join(", ")}.` });
  }
  const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });
  const employee = await queryOne<any>(`SELECT * FROM altax.v3_employees WHERE employee_id = $1 AND client_id = $2`, [employeeId, clientId]);
  const ineligible = eligibilityError(employee);
  if (ineligible) return res.status(400).json({ error: ineligible });

  const anchorDate = dateString(body.anchorDate);
  const leadDays = Math.max(0, Math.trunc(Number(body.leadDays) || 5));

  const existing = await queryOne<any>(`SELECT payroll_schedule_id FROM altax.v3_payroll_schedules WHERE employee_id = $1`, [employeeId]);
  if (existing) {
    await query(
      `UPDATE altax.v3_payroll_schedules SET
         frequency=$2, anchor_date=$3, next_pay_date=$3, lead_days=$4, status='Active', notes=$5, updated_at=now()
       WHERE payroll_schedule_id=$1`,
      [existing.payroll_schedule_id, frequency, anchorDate, leadDays, String(body.notes || "").trim() || null]
    );
    await logAudit("Accounting", "PAYROLL_AGENT_SCHEDULE_UPDATE", existing.payroll_schedule_id, "", "", frequency,
      `Payroll agent schedule re-enabled for ${employee.employee_name} by ${req.user!.email}.`, req.user!.email);
    return res.json({ ok: true, payrollScheduleId: existing.payroll_schedule_id });
  }

  const payrollScheduleId = `PSCH-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_payroll_schedules
       (payroll_schedule_id, client_id, client_name, employee_id, employee_name, frequency, anchor_date, next_pay_date, lead_days, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10)`,
    [payrollScheduleId, client.client_id, client.client_name, employeeId, employee.employee_name, frequency, anchorDate, leadDays,
      String(body.notes || "").trim() || null, req.user!.email]
  );
  await logAudit("Accounting", "PAYROLL_AGENT_SCHEDULE_CREATE", payrollScheduleId, "", "", frequency,
    `Payroll agent schedule created for ${employee.employee_name} by ${req.user!.email}.`, req.user!.email);
  res.status(201).json({ ok: true, payrollScheduleId });
}));

async function loadScheduleForAccess(req: AuthedRequest, res: Response, id: string) {
  const schedule = await queryOne<any>(`SELECT * FROM altax.v3_payroll_schedules WHERE payroll_schedule_id = $1`, [id]);
  if (!schedule) { res.status(404).json({ error: "Schedule not found." }); return null; }
  if (!(await canAccessClient(req.user!, schedule.client_id))) {
    res.status(403).json({ error: "You do not have access to this client." });
    return null;
  }
  return schedule;
}

payrollAgentRouter.get("/schedules/:employeeId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const schedule = await queryOne<any>(`SELECT * FROM altax.v3_payroll_schedules WHERE employee_id = $1`, [req.params.employeeId]);
  if (schedule && !(await canAccessClient(req.user!, schedule.client_id))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  res.json({ schedule: schedule || null });
}));

for (const [action, status] of [["pause", "Paused"], ["resume", "Active"], ["archive", "Archived"]] as const) {
  payrollAgentRouter.post(`/schedules/:id/${action}`, requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
    const schedule = await loadScheduleForAccess(req, res, req.params.id);
    if (!schedule) return;
    await query(`UPDATE altax.v3_payroll_schedules SET status=$2, updated_at=now() WHERE payroll_schedule_id=$1`, [schedule.payroll_schedule_id, status]);
    await logAudit("Accounting", `PAYROLL_AGENT_SCHEDULE_${action.toUpperCase()}`, schedule.payroll_schedule_id, "", schedule.status, status,
      `Payroll agent schedule ${action}d by ${req.user!.email}.`, req.user!.email);
    res.json({ ok: true });
  }));
}

/**
 * The sweep: for every Active schedule due within lead_days of its
 * next_pay_date, draft it (idempotent — the DB's UNIQUE(payroll_schedule_id,
 * pay_date) constraint plus this pre-check make re-running the same day a
 * no-op) and always advance next_pay_date to the following period,
 * regardless of whether a new draft was created — this is what makes
 * dismissing a draft NOT cause it to redraft the same period; advancement
 * happens here, at draft-creation time, not at approve/dismiss time.
 */
export async function runPayrollAgentSweep(
  actor: { email: string; role: string; clientId?: string },
  opts: { runDate?: string; clientId?: string } = {}
): Promise<{ created: any[]; skipped: number; errors: string[] }> {
  const runDate = dateOnly(opts.runDate);
  const clientFilter = String(opts.clientId || "").trim();

  const schedules = await query<any>(`SELECT * FROM altax.v3_payroll_schedules WHERE status = 'Active'`);
  const created: any[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (const schedule of schedules) {
    if (clientFilter && schedule.client_id !== clientFilter) { skipped++; continue; }
    if (!(await canAccessClient(actor, schedule.client_id))) { skipped++; continue; }

    const nextPayDate = dateOnly(schedule.next_pay_date);
    const draftFrom = addDays(nextPayDate, -Math.max(0, Number(schedule.lead_days) || 0));
    if (draftFrom.getTime() > runDate.getTime()) { skipped++; continue; }

    // Re-validate eligibility at sweep time, not just at schedule creation —
    // an employee could have gone inactive or lost their pay defaults since.
    const employee = await queryOne<any>(`SELECT * FROM altax.v3_employees WHERE employee_id = $1`, [schedule.employee_id]);
    const ineligible = eligibilityError(employee);
    if (ineligible) {
      errors.push(`${schedule.employee_name || schedule.employee_id}: ${ineligible}`);
      // Advance anyway — an employee that stays ineligible for weeks shouldn't
      // pile up errors for every missed period, just the current one.
      await query(
        `UPDATE altax.v3_payroll_schedules SET next_pay_date=$2, updated_at=now() WHERE payroll_schedule_id=$1`,
        [schedule.payroll_schedule_id, dateString(nextPayrollDate(nextPayDate, schedule.frequency))]
      );
      continue;
    }

    const payDateString = dateString(nextPayDate);
    const existingDraft = await queryOne<any>(
      `SELECT payroll_draft_id FROM altax.v3_payroll_drafts WHERE payroll_schedule_id = $1 AND pay_date = $2`,
      [schedule.payroll_schedule_id, payDateString]
    );
    if (!existingDraft) {
      const payrollDraftId = `PDFT-${idSuffix()}`;
      const sourceRecordId = `${schedule.payroll_schedule_id}:${payDateString}`;
      await query(
        `INSERT INTO altax.v3_payroll_drafts
           (payroll_draft_id, payroll_schedule_id, client_id, client_name, employee_id, employee_name, pay_date, source_record_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [payrollDraftId, schedule.payroll_schedule_id, schedule.client_id, schedule.client_name, schedule.employee_id, schedule.employee_name,
          payDateString, sourceRecordId]
      );
      await query(
        `UPDATE altax.v3_payroll_schedules SET last_drafted_pay_date=$2, updated_at=now() WHERE payroll_schedule_id=$1`,
        [schedule.payroll_schedule_id, payDateString]
      );
      created.push({ payrollDraftId, employeeId: schedule.employee_id, employeeName: schedule.employee_name, clientId: schedule.client_id, payDate: payDateString });
    } else {
      skipped++;
    }

    await query(
      `UPDATE altax.v3_payroll_schedules SET next_pay_date=$2, updated_at=now() WHERE payroll_schedule_id=$1`,
      [schedule.payroll_schedule_id, dateString(nextPayrollDate(nextPayDate, schedule.frequency))]
    );
  }

  return { created, skipped, errors };
}

payrollAgentRouter.post("/run", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const result = await runPayrollAgentSweep(req.user!, { runDate: body.runDate, clientId: body.clientId });
  res.json({ ok: true, ...result });
}));

/** Dashboard summary card payload — active schedule count, pending draft
 * count, and the min/max pay-date range across pending drafts for the
 * "Collecting for Aug 1-7" style label. */
payrollAgentRouter.get("/summary", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const activeSchedules = await query<any>(`SELECT client_id FROM altax.v3_payroll_schedules WHERE status = 'Active'`);
  const accessibleActive = [];
  for (const s of activeSchedules) { if (await canAccessClient(req.user!, s.client_id)) accessibleActive.push(s); }

  const pendingDrafts = await query<any>(`SELECT client_id, pay_date FROM altax.v3_payroll_drafts WHERE status = 'Pending'`);
  const accessiblePending = [];
  for (const d of pendingDrafts) { if (await canAccessClient(req.user!, d.client_id)) accessiblePending.push(d); }

  let rangeLabel: string | null = null;
  if (accessiblePending.length) {
    const dates = accessiblePending.map((d) => dateOnly(d.pay_date).getTime());
    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    rangeLabel = min.getTime() === max.getTime() ? fmt(min) : `${fmt(min)} - ${fmt(max)}`;
  }

  res.json({
    active: accessibleActive.length > 0,
    scheduleCount: accessibleActive.length,
    pendingCount: accessiblePending.length,
    rangeLabel,
  });
}));

/** Pending drafts, each with a fresh computed preview merged with any staff
 * overrides — never a stale saved number. */
payrollAgentRouter.get("/drafts", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const status = String(req.query.status || "Pending").trim();
  const clientFilter = String(req.query.clientId || "").trim();
  const params: any[] = [status];
  let sql = `SELECT * FROM altax.v3_payroll_drafts WHERE status = $1`;
  if (clientFilter) { params.push(clientFilter); sql += ` AND client_id = $${params.length}`; }
  sql += ` ORDER BY pay_date ASC, client_name ASC`;
  const rows = await query<any>(sql, params);

  const results = [];
  for (const draft of rows) {
    if (!(await canAccessClient(req.user!, draft.client_id))) continue;
    const employee = await queryOne<any>(`SELECT * FROM altax.v3_employees WHERE employee_id = $1`, [draft.employee_id]);
    const client = await queryOne<any>(`SELECT state FROM altax.v3_clients WHERE client_id = $1`, [draft.client_id]);
    let preview: any = null;
    let previewError: string | null = null;
    if (employee) {
      const overrideBody = { ...(draft.staff_overrides || {}), payDate: dateString(draft.pay_date) };
      try {
        preview = await calculatePaycheck(draft.client_id, draft.employee_name, employee, overrideBody, client?.state);
      } catch (err: any) {
        previewError = err?.message || "Could not compute a preview for this draft.";
      }
    } else {
      previewError = "Employee no longer exists.";
    }
    results.push({ ...draft, preview, previewError });
  }
  res.json({ drafts: results });
}));

payrollAgentRouter.patch("/drafts/:id", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const draft = await queryOne<any>(`SELECT * FROM altax.v3_payroll_drafts WHERE payroll_draft_id = $1`, [req.params.id]);
  if (!draft) return res.status(404).json({ error: "Draft not found." });
  if (!(await canAccessClient(req.user!, draft.client_id))) return res.status(403).json({ error: "You do not have access to this client." });
  if (draft.status !== "Pending") return res.status(400).json({ error: "Only pending drafts can be edited." });

  const overrides = req.body?.overrides && typeof req.body.overrides === "object" ? req.body.overrides : {};
  await query(`UPDATE altax.v3_payroll_drafts SET staff_overrides = $2, updated_at = now() WHERE payroll_draft_id = $1`, [draft.payroll_draft_id, JSON.stringify(overrides)]);
  res.json({ ok: true });
}));

async function approveDraft(draftId: string, actorEmail: string, extraOverrides: Record<string, any> = {}): Promise<{ ok: boolean; error?: string; paycheckId?: string }> {
  const draft = await queryOne<any>(`SELECT * FROM altax.v3_payroll_drafts WHERE payroll_draft_id = $1`, [draftId]);
  if (!draft) return { ok: false, error: "Draft not found." };
  if (draft.status !== "Pending") return { ok: false, error: `This draft is already ${draft.status}.` };

  const client = await queryOne<any>(`SELECT client_id, client_name, state FROM altax.v3_clients WHERE client_id = $1`, [draft.client_id]);
  if (!client) return { ok: false, error: "Client not found." };
  const employee = await queryOne<any>(`SELECT * FROM altax.v3_employees WHERE employee_id = $1`, [draft.employee_id]);
  const ineligible = eligibilityError(employee);
  if (ineligible) return { ok: false, error: ineligible };

  const body = { ...(draft.staff_overrides || {}), ...extraOverrides, payDate: dateString(draft.pay_date) };
  const result: PaycheckCreationResult = await createSinglePaycheck(client, draft.employee_name, body, actorEmail);
  if (!result.ok) return { ok: false, error: result.error };

  await query(
    `UPDATE altax.v3_payroll_drafts SET status='Approved', resulting_paycheck_id=$2, approved_by=$3, approved_at=now(), updated_at=now() WHERE payroll_draft_id=$1`,
    [draft.payroll_draft_id, result.paycheckId, actorEmail]
  );
  await logAudit("Accounting", "PAYROLL_AGENT_APPROVE", draft.payroll_draft_id, "PaycheckID", "", result.paycheckId,
    `Payroll agent draft approved by ${actorEmail}.`, actorEmail);
  return { ok: true, paycheckId: result.paycheckId };
}

payrollAgentRouter.post("/drafts/:id/approve", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const draft = await queryOne<any>(`SELECT client_id FROM altax.v3_payroll_drafts WHERE payroll_draft_id = $1`, [req.params.id]);
  if (!draft) return res.status(404).json({ error: "Draft not found." });
  if (!(await canAccessClient(req.user!, draft.client_id))) return res.status(403).json({ error: "You do not have access to this client." });

  const overrides = req.body?.overrides && typeof req.body.overrides === "object" ? req.body.overrides : {};
  const result = await approveDraft(req.params.id, req.user!.email, overrides);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
}));

payrollAgentRouter.post("/drafts/approve-bulk", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const draftIds: string[] = Array.isArray(req.body?.draftIds) ? req.body.draftIds : [];
  if (!draftIds.length) return res.status(400).json({ error: "At least one draft is required." });

  const results: { draftId: string; ok: boolean; error?: string; paycheckId?: string }[] = [];
  for (const draftId of draftIds) {
    const draft = await queryOne<any>(`SELECT client_id FROM altax.v3_payroll_drafts WHERE payroll_draft_id = $1`, [draftId]);
    if (!draft) { results.push({ draftId, ok: false, error: "Draft not found." }); continue; }
    if (!(await canAccessClient(req.user!, draft.client_id))) { results.push({ draftId, ok: false, error: "No access to this client." }); continue; }
    const result = await approveDraft(draftId, req.user!.email);
    results.push({ draftId, ...result });
  }

  const succeeded = results.filter((r) => r.ok).length;
  res.status(succeeded > 0 ? 200 : 400).json({ ok: succeeded > 0, succeeded, failed: results.length - succeeded, results });
}));

payrollAgentRouter.post("/drafts/:id/dismiss", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const draft = await queryOne<any>(`SELECT * FROM altax.v3_payroll_drafts WHERE payroll_draft_id = $1`, [req.params.id]);
  if (!draft) return res.status(404).json({ error: "Draft not found." });
  if (!(await canAccessClient(req.user!, draft.client_id))) return res.status(403).json({ error: "You do not have access to this client." });
  if (draft.status !== "Pending") return res.status(400).json({ error: `This draft is already ${draft.status}.` });

  await query(
    `UPDATE altax.v3_payroll_drafts SET status='Dismissed', dismissed_reason=$2, dismissed_by=$3, dismissed_at=now(), updated_at=now() WHERE payroll_draft_id=$1`,
    [draft.payroll_draft_id, String(req.body?.reason || "").trim() || null, req.user!.email]
  );
  await logAudit("Accounting", "PAYROLL_AGENT_DISMISS", draft.payroll_draft_id, "", "", "Dismissed",
    `Payroll agent draft dismissed by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));
