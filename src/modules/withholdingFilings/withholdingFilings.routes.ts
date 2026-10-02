/**
 * Withholding filings — record and track a client's employer state income tax
 * withholding returns/payments, the same way sales tax filings are tracked:
 * periods come from the client's withholding frequency, the amount withheld
 * comes from their recorded paychecks, a filed/paid date turns a period into a
 * filing record, and late charges (where the state's rules are built) are
 * recomputed from those dates. Marking filed closes the matching task, can
 * email/text the client a confirmation with an acknowledge link, and schedules
 * a payment reminder if payment isn't recorded yet.
 *
 * See withholdingFiling.ts for each state's due dates and late-charge rules.
 */
import { Router, Response } from "express";
import crypto from "crypto";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { logAudit } from "../../common/audit";
import { publicBaseUrl } from "../../common/publicUrl";
import { deriveTaskRulesPeriodLabel, closeObligationTask, markObligationTaskPaid } from "../../common/taskRulesAgentBridge";
import {
  asWithholdingState, normalizeWithholdingFrequency, computeWithholdingBreakdown, computeWithholdingFiling,
  withholdingDueDate, withholdingRulesFor, loadWithheldByPeriod, calendarDatesSatisfied,
  type WithholdingFrequency, type WithholdingState,
} from "../../common/withholdingFiling";
import { stateDisplayName } from "../../common/stateNames";

export const withholdingFilingsRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function round2(n: number): number { return Math.round(n * 100) / 100; }
function isoDate(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}
function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface LoadedClient {
  clientId: string; clientName: string; email: string | null; emailAllowed: boolean; phone: string | null; smsAllowed: boolean;
  state: WithholdingState; frequency: WithholdingFrequency | null; frequencyRaw: string | null;
}
type LoadResult = { error: string; status: number } | { client: LoadedClient };

async function loadClient(req: AuthedRequest, clientId: string): Promise<LoadResult> {
  if (!clientId) return { error: "Client is required.", status: 400 };
  if (!(await canAccessClient(req.user!, clientId))) return { error: "You do not have access to this client.", status: 403 };
  const c = await queryOne<any>(
    `SELECT client_id, client_name, email, email_allowed, phone, sms_allowed, state, md_withholding_frequency FROM altax.v3_clients WHERE client_id = $1`,
    [clientId]
  );
  if (!c) return { error: "Client not found.", status: 404 };
  const state = asWithholdingState(c.state);
  if (!state) {
    return { error: `Withholding tracking isn't built for ${String(c.state || "this client's") || "this client's"} state yet — it covers MD, DC, VA, PA and DE.`, status: 400 };
  }
  return {
    client: {
      clientId: c.client_id, clientName: c.client_name, email: c.email, emailAllowed: Boolean(c.email_allowed),
      phone: c.phone, smsAllowed: Boolean(c.sms_allowed), state,
      frequency: normalizeWithholdingFrequency(c.md_withholding_frequency), frequencyRaw: c.md_withholding_frequency || null,
    },
  };
}

/** "Maryland Withholding Tax" / "DC Withholding Tax" — what the client reads in a confirmation. */
function filingTypeLabel(state: WithholdingState): string {
  return `${state === "DC" ? "DC" : stateDisplayName(state) ?? state} Withholding Tax`;
}


const COMPLETION_LABEL_PREFIX = "Withholding filing";

/**
 * Recording a filing here also clears the matching At a Glance deadline, the
 * same way "Mark done" does (v3_obligation_completions) — otherwise a period
 * that's filed would keep showing as an upcoming/overdue deadline.
 */
async function recordCalendarCompletion(client: LoadedClient, periodStart: string, periodEnd: string, filedDate: string, paidDate: string | null, taxDue: number, userEmail: string) {
  if (!client.frequency) return;
  for (const date of calendarDatesSatisfied(client.state, client.frequency, periodEnd)) {
    await query(
      `INSERT INTO altax.v3_obligation_completions (client_id, source, due_date, label, completed_date, completed_by, amount, paid_date)
       VALUES ($1,'MD Withholding',$2,$3,$4,$5,$6,$7)
       ON CONFLICT (client_id, source, due_date) DO UPDATE SET label = EXCLUDED.label, completed_date = EXCLUDED.completed_date,
         completed_by = EXCLUDED.completed_by, completed_at = now(), amount = EXCLUDED.amount, paid_date = EXCLUDED.paid_date`,
      [client.clientId, date, `${COMPLETION_LABEL_PREFIX} ${periodStart} – ${periodEnd}`, filedDate, userEmail, taxDue, paidDate]
    );
  }
}

async function removeCalendarCompletion(client: LoadedClient, periodStart: string, periodEnd: string) {
  if (!client.frequency) return;
  await query(
    `DELETE FROM altax.v3_obligation_completions WHERE client_id = $1 AND source = 'MD Withholding' AND due_date = ANY($2::date[]) AND label = $3`,
    [client.clientId, calendarDatesSatisfied(client.state, client.frequency, periodEnd), `${COMPLETION_LABEL_PREFIX} ${periodStart} – ${periodEnd}`]
  );
}

function taskPeriodLabel(periodStart: string, frequency: WithholdingFrequency | null): string | null {
  return deriveTaskRulesPeriodLabel(periodStart, frequency === "Annually" ? "annual" : frequency);
}

function metaFor(client: LoadedClient) {
  const rules = withholdingRulesFor(client.state);
  const supported = client.frequency !== null && rules.frequencies.includes(client.frequency);
  return {
    state: client.state, frequency: client.frequency, frequencyRaw: client.frequencyRaw, supported,
    agency: rules.agency, formName: client.frequency ? rules.formName[client.frequency] ?? null : null,
    hasLateCharges: rules.hasLateCharges, supportedFrequencies: rules.frequencies,
  };
}

/** Periods for a range: GET /withholding-filings/:clientId?from=&to=&filedDate=&paidDate= */
withholdingFilingsRouter.get("/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;
  const meta = metaFor(client);
  if (!meta.supported || !client.frequency) return res.json({ meta, breakdown: null });

  const today = new Date().toISOString().slice(0, 10);
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return res.status(400).json({ error: "from and to must be YYYY-MM-DD." });
  const filedDate = DATE_RE.test(String(req.query.filedDate || "")) ? String(req.query.filedDate) : today;
  const paidDate = DATE_RE.test(String(req.query.paidDate || "")) ? String(req.query.paidDate) : today;
  const breakdown = await computeWithholdingBreakdown(client.clientId, client.state, client.frequency, from, to, filedDate, paidDate);
  res.json({ meta, breakdown });
}));

/** Every period that has a recorded filing — the persistent History list. */
withholdingFilingsRouter.get("/:clientId/history", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;
  if (!client.frequency) return res.json({ periods: [] });
  const first = await queryOne<{ d: string | null }>(`SELECT MIN(period_start)::date::text AS d FROM altax.v3_withholding_filings WHERE client_id = $1`, [client.clientId]);
  if (!first?.d) return res.json({ periods: [] });
  const today = new Date().toISOString().slice(0, 10);
  const breakdown = await computeWithholdingBreakdown(client.clientId, client.state, client.frequency, first.d, today, today, today);
  res.json({ periods: breakdown.periods.filter((p) => p.markedFiledDate !== null) });
}));

withholdingFilingsRouter.get("/:clientId/excluded-periods", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const rows = await query<any>(
    `SELECT period_start::date::text AS period_start, period_end::date::text AS period_end, reason, excluded_by, excluded_at
       FROM altax.v3_withholding_period_exclusions WHERE client_id = $1 ORDER BY period_end DESC`,
    [loaded.client.clientId]
  );
  res.json({ excluded: rows.map((r) => ({ start: r.period_start, end: r.period_end, reason: r.reason, excludedBy: r.excluded_by, excludedAt: r.excluded_at })) });
}));

async function sendConfirmation(
  req: AuthedRequest, client: LoadedClient, row: { periodStart: string; periodEnd: string; filedDate: string; paidDate: string | null; taxDue: number; balanceDue: number | null; shareToken: string },
  dueDate: string
): Promise<{ sent: boolean; noContact: boolean }> {
  const canEmail = Boolean(client.emailAllowed && client.email);
  const canSms = Boolean(client.smsAllowed && client.phone);
  if (!canEmail && !canSms) return { sent: false, noContact: true };
  const { sendFilingConfirmation, fmtPeriodRange } = await import("../../common/filingConfirmationEmail");
  const sourceRecordId = `${client.clientId}:${row.periodEnd}`;
  const hasBalanceDue = row.balanceDue != null && round2(row.balanceDue) !== row.taxDue;
  const { sent } = await sendFilingConfirmation({
    client: { clientId: client.clientId, clientName: client.clientName, email: client.email, emailAllowed: client.emailAllowed, phone: client.phone, smsAllowed: client.smsAllowed },
    sourceRecordId, filingType: filingTypeLabel(client.state), periodLabel: fmtPeriodRange(row.periodStart, row.periodEnd),
    filedDate: row.filedDate, amount: row.taxDue, amountLabel: "Tax Withheld", amountLabelAr: "الضريبة المستقطعة",
    breakdown: hasBalanceDue ? [{ label: "Balance Due", labelAr: "الرصيد المستحق", valueStr: money(row.balanceDue!) }] : undefined,
    paymentDueDate: dueDate, paidDate: row.paidDate, acknowledgeUrl: `${publicBaseUrl(req) || ""}/public/withholding/${row.shareToken}`, req,
  });
  return { sent, noContact: false };
}

withholdingFilingsRouter.post("/:clientId/mark-filed", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;
  if (!client.frequency) return res.status(400).json({ error: "Set this client's Withholding Frequency on their profile first." });

  const body = req.body || {};
  const periodStart = String(body.periodStart || "").trim();
  const periodEnd = String(body.periodEnd || "").trim();
  const filedDate = String(body.filedDate || "").trim();
  const paidDate = String(body.paidDate || "").trim() || null;
  const notify = body.notify === true;
  if (!DATE_RE.test(periodStart) || !DATE_RE.test(periodEnd) || !DATE_RE.test(filedDate) || (paidDate !== null && !DATE_RE.test(paidDate))) {
    return res.status(400).json({ error: "periodStart, periodEnd, and filedDate must be YYYY-MM-DD (paidDate too, if provided)." });
  }
  const existing = await queryOne<any>(`SELECT 1 FROM altax.v3_withholding_filings WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd]);
  if (existing) return res.status(400).json({ error: "A filing for this period has already been recorded. Delete it first if you need to re-file." });

  const [withheld] = await loadWithheldByPeriod(client.clientId, client.state, [{ start: periodStart, end: periodEnd }]);
  const taxDue = body.taxDue !== undefined && Number.isFinite(Number(body.taxDue)) && Number(body.taxDue) >= 0 ? round2(Number(body.taxDue)) : withheld;
  const dueDate = withholdingDueDate(client.state, client.frequency, periodEnd);
  const result = paidDate ? await computeWithholdingFiling(client.state, taxDue, dueDate, filedDate, paidDate) : null;
  const shareToken = crypto.randomBytes(24).toString("hex");

  await query(
    `INSERT INTO altax.v3_withholding_filings (client_id, period_start, period_end, state, filed_date, paid_date, tax_due, balance_due, on_time, filed_by, share_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [client.clientId, periodStart, periodEnd, client.state, filedDate, paidDate, taxDue, result?.balanceDue ?? null, result?.onTime ?? null, req.user!.email, shareToken]
  );
  await logAudit("Accounting", "WITHHOLDING_FILING_MARK_FILED", client.clientId, "Period", "", `${periodStart} - ${periodEnd}: filed ${filedDate}${paidDate ? `, paid ${paidDate}` : ""}`,
    `${client.state} withholding filing (${periodStart} - ${periodEnd}) marked filed ${filedDate}${paidDate ? `, paid ${paidDate}` : " (payment not yet recorded)"} by ${req.user!.email}.`, req.user!.email);

  await closeObligationTask({
    clientId: client.clientId, keyword: "withholding", excludeKeyword: "reconciliation", dueDate,
    periodLabel: taskPeriodLabel(periodStart, client.frequency), filedDate, paidDate,
  });
  await recordCalendarCompletion(client, periodStart, periodEnd, filedDate, paidDate, taxDue, req.user!.email);

  let notified = false;
  let noContact = false;
  if (notify) {
    const out = await sendConfirmation(req, client, { periodStart, periodEnd, filedDate, paidDate, taxDue, balanceDue: result?.balanceDue ?? null, shareToken }, dueDate);
    notified = out.sent; noContact = out.noContact;
    if (out.sent) {
      await query(`UPDATE altax.v3_withholding_filings SET sent_at = now() WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd]);
      if (!paidDate) {
        const { schedulePaymentReminder } = await import("../../common/paymentReminders");
        await schedulePaymentReminder({
          sourceSystem: "WithholdingFiling", sourceRecordId: `${client.clientId}:${periodEnd}`, clientId: client.clientId, filingType: filingTypeLabel(client.state),
          periodLabel: `${periodStart} – ${periodEnd}`, amount: taxDue, paymentDueDate: dueDate, createdBy: req.user!.email, leadDays: 3,
        });
      }
    }
  }
  res.json({ ok: true, periodEnd, filedDate, paidDate, onTime: result?.onTime ?? null, balanceDue: result?.balanceDue ?? null, notified: notify ? notified : undefined, noContact: notify ? noContact : undefined });
}));

withholdingFilingsRouter.post("/:clientId/record-payment", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;
  if (!client.frequency) return res.status(400).json({ error: "Set this client's Withholding Frequency on their profile first." });

  const periodEnd = String((req.body || {}).periodEnd || "").trim();
  const paidDate = String((req.body || {}).paidDate || "").trim();
  if (!DATE_RE.test(periodEnd) || !DATE_RE.test(paidDate)) return res.status(400).json({ error: "periodEnd and paidDate must be YYYY-MM-DD." });

  const existing = await queryOne<any>(`SELECT period_start, filed_date, paid_date, tax_due FROM altax.v3_withholding_filings WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd]);
  if (!existing) return res.status(400).json({ error: "This period hasn't been marked filed yet — mark it filed first." });
  if (existing.paid_date) return res.status(400).json({ error: "This period already has a payment recorded. Delete the filing and re-file to correct it." });

  const dueDate = withholdingDueDate(client.state, client.frequency, periodEnd);
  const result = await computeWithholdingFiling(client.state, Number(existing.tax_due), dueDate, isoDate(existing.filed_date), paidDate);
  await query(`UPDATE altax.v3_withholding_filings SET paid_date = $3, balance_due = $4, on_time = $5 WHERE client_id = $1 AND period_end = $2::date`,
    [client.clientId, periodEnd, paidDate, result.balanceDue, result.onTime]);
  await logAudit("Accounting", "WITHHOLDING_FILING_RECORD_PAYMENT", client.clientId, "Period", "", `${periodEnd}: paid ${paidDate}`,
    `Payment for ${client.state} withholding filing (period ending ${periodEnd}) recorded as paid ${paidDate} by ${req.user!.email}.`, req.user!.email);

  await markObligationTaskPaid({
    clientId: client.clientId, keyword: "withholding", excludeKeyword: "reconciliation", dueDate,
    periodLabel: taskPeriodLabel(isoDate(existing.period_start), client.frequency), paidDate,
  });
  await recordCalendarCompletion(client, isoDate(existing.period_start), periodEnd, isoDate(existing.filed_date), paidDate, Number(existing.tax_due), req.user!.email);
  const { cancelPaymentReminder } = await import("../../common/paymentReminders");
  await cancelPaymentReminder("WithholdingFiling", `${client.clientId}:${periodEnd}`, "Payment recorded");

  res.json({ ok: true, periodEnd, paidDate, onTime: result.onTime, balanceDue: result.balanceDue });
}));

withholdingFilingsRouter.post("/:clientId/send", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;
  if (!client.frequency) return res.status(400).json({ error: "Set this client's Withholding Frequency on their profile first." });

  const periodEnd = String((req.body || {}).periodEnd || "").trim();
  if (!DATE_RE.test(periodEnd)) return res.status(400).json({ error: "periodEnd must be YYYY-MM-DD." });
  const e = await queryOne<any>(
    `SELECT period_start, filed_date, paid_date, tax_due, balance_due, share_token FROM altax.v3_withholding_filings WHERE client_id = $1 AND period_end = $2::date`,
    [client.clientId, periodEnd]
  );
  if (!e) return res.status(400).json({ error: "This period hasn't been marked filed yet — mark it filed first." });

  const dueDate = withholdingDueDate(client.state, client.frequency, periodEnd);
  const out = await sendConfirmation(req, client, {
    periodStart: isoDate(e.period_start), periodEnd, filedDate: isoDate(e.filed_date), paidDate: e.paid_date ? isoDate(e.paid_date) : null,
    taxDue: Number(e.tax_due), balanceDue: e.balance_due !== null ? Number(e.balance_due) : null, shareToken: e.share_token,
  }, dueDate);
  if (out.noContact) {
    return res.status(400).json({ error: "This client has no email or phone number on file (or both are opted out) — nothing was sent. Add contact info on the client's profile first." });
  }
  if (!out.sent) return res.status(502).json({ error: "Could not send this confirmation — the email/SMS provider reported a failure. Try again, or check the client's contact info." });
  await query(`UPDATE altax.v3_withholding_filings SET sent_at = now() WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd]);
  await logAudit("Accounting", "WITHHOLDING_FILING_SENT", client.clientId, "Period", "", periodEnd,
    `${client.state} withholding filing confirmation (period ending ${periodEnd}) sent by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

withholdingFilingsRouter.post("/:clientId/edit", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;
  if (!client.frequency) return res.status(400).json({ error: "Set this client's Withholding Frequency on their profile first." });

  const body = req.body || {};
  const periodEnd = String(body.periodEnd || "").trim();
  const filedDate = String(body.filedDate || "").trim();
  const paidDate = String(body.paidDate || "").trim() || null;
  const taxDue = Number(body.taxDue);
  if (!DATE_RE.test(periodEnd) || !DATE_RE.test(filedDate) || (paidDate !== null && !DATE_RE.test(paidDate)) || !Number.isFinite(taxDue) || taxDue < 0) {
    return res.status(400).json({ error: "periodEnd and filedDate must be YYYY-MM-DD; paidDate must be YYYY-MM-DD or empty; taxDue must be a non-negative number." });
  }
  const existing = await queryOne<any>(`SELECT period_start, paid_date FROM altax.v3_withholding_filings WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd]);
  if (!existing) return res.status(400).json({ error: "This period hasn't been marked filed yet." });

  const dueDate = withholdingDueDate(client.state, client.frequency, periodEnd);
  const result = paidDate ? await computeWithholdingFiling(client.state, taxDue, dueDate, filedDate, paidDate) : null;
  await query(
    `UPDATE altax.v3_withholding_filings SET filed_date = $3, paid_date = $4, tax_due = $5, balance_due = $6, on_time = $7 WHERE client_id = $1 AND period_end = $2::date`,
    [client.clientId, periodEnd, filedDate, paidDate, taxDue, result?.balanceDue ?? taxDue, result?.onTime ?? null]
  );
  await logAudit("Accounting", "WITHHOLDING_FILING_EDITED", client.clientId, "Period", "", periodEnd,
    `${client.state} withholding filing (period ending ${periodEnd}) corrected to filed ${filedDate}${paidDate ? `, paid ${paidDate}` : ""}, tax $${taxDue.toFixed(2)} by ${req.user!.email}.`, req.user!.email);
  await recordCalendarCompletion(client, isoDate(existing.period_start), periodEnd, filedDate, paidDate, taxDue, req.user!.email);
  if (paidDate && !existing.paid_date) {
    await markObligationTaskPaid({
      clientId: client.clientId, keyword: "withholding", excludeKeyword: "reconciliation", dueDate,
      periodLabel: taskPeriodLabel(isoDate(existing.period_start), client.frequency), paidDate,
    });
  }
  res.json({ ok: true, periodEnd, filedDate, paidDate, taxDue, balanceDue: result?.balanceDue ?? taxDue, onTime: result?.onTime ?? null });
}));

/** Delete a recorded filing so the period can be filed again from scratch. */
withholdingFilingsRouter.post("/:clientId/unmark", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const periodEnd = String((req.body || {}).periodEnd || "").trim();
  if (!DATE_RE.test(periodEnd)) return res.status(400).json({ error: "periodEnd must be YYYY-MM-DD." });
  const toRemove = await queryOne<any>(`SELECT period_start FROM altax.v3_withholding_filings WHERE client_id = $1 AND period_end = $2::date`, [loaded.client.clientId, periodEnd]);
  await query(`DELETE FROM altax.v3_withholding_filings WHERE client_id = $1 AND period_end = $2::date`, [loaded.client.clientId, periodEnd]);
  if (toRemove) await removeCalendarCompletion(loaded.client, isoDate(toRemove.period_start), periodEnd);
  const { cancelPaymentReminder } = await import("../../common/paymentReminders");
  await cancelPaymentReminder("WithholdingFiling", `${loaded.client.clientId}:${periodEnd}`, "Filing deleted");
  await logAudit("Accounting", "WITHHOLDING_FILING_UNMARKED", loaded.client.clientId, "Period", "", periodEnd,
    `${loaded.client.state} withholding filing (period ending ${periodEnd}) deleted by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

withholdingFilingsRouter.post("/:clientId/exclude-period", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const periodStart = String((req.body || {}).periodStart || "").trim();
  const periodEnd = String((req.body || {}).periodEnd || "").trim();
  const reason = String((req.body || {}).reason || "").trim() || null;
  if (!DATE_RE.test(periodStart) || !DATE_RE.test(periodEnd)) return res.status(400).json({ error: "periodStart and periodEnd must be YYYY-MM-DD." });
  const filed = await queryOne<any>(`SELECT 1 FROM altax.v3_withholding_filings WHERE client_id = $1 AND period_end = $2::date`, [loaded.client.clientId, periodEnd]);
  if (filed) return res.status(400).json({ error: "This period has already been filed — delete that filing first if you need to exclude it instead." });
  await query(
    `INSERT INTO altax.v3_withholding_period_exclusions (client_id, period_start, period_end, reason, excluded_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (client_id, period_end) DO NOTHING`,
    [loaded.client.clientId, periodStart, periodEnd, reason, req.user!.email]
  );
  await logAudit("Accounting", "WITHHOLDING_PERIOD_EXCLUDED", loaded.client.clientId, "Period", "", periodEnd,
    `${loaded.client.state} withholding period ${periodStart} - ${periodEnd} excluded (no filing obligation)${reason ? `: ${reason}` : ""}, by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

withholdingFilingsRouter.post("/:clientId/restore-period", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const periodEnd = String((req.body || {}).periodEnd || "").trim();
  if (!DATE_RE.test(periodEnd)) return res.status(400).json({ error: "periodEnd must be YYYY-MM-DD." });
  await query(`DELETE FROM altax.v3_withholding_period_exclusions WHERE client_id = $1 AND period_end = $2::date`, [loaded.client.clientId, periodEnd]);
  await logAudit("Accounting", "WITHHOLDING_PERIOD_RESTORED", loaded.client.clientId, "Period", "", periodEnd,
    `${loaded.client.state} withholding period ending ${periodEnd} restored by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

