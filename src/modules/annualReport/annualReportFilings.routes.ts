/**
 * MD Annual Report filing record — Phase 2 of the obligation-workflow
 * rollout (file → client acknowledges → firm notified → 3-day reminder),
 * following the same shape MD Sales Tax got in Phase 1. A flat filed
 * amount, not a computed liability (no MD Form 202-style math applies to
 * an annual report filing fee) — staff enters the amount, suggested as
 * $75 in the frontend to match the existing billing catalog SKU.
 */
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { logAudit } from "../../common/audit";
import { publicBaseUrl } from "../../common/publicUrl";
import { deriveTaskRulesPeriodLabel, closeObligationTask, markObligationTaskPaid } from "../../common/taskRulesAgentBridge";

export const annualReportFilingsRouter = Router();

/** A DATE column comes back from SELECT * as a JS Date — String(date) gives "Mon Jun 30 2026...", not an ISO string, so the date must be read off the Date object's own toISOString(), not stringified directly. Same fix already applied elsewhere this session (templates.routes.ts's toIsoDateStr). */
function toIsoDateStr(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** MD's real, fixed statutory deadline — April 15 of the year following the report year, matching TR-007's rule config (due_day=15, due_month=4). */
function annualReportDueDate(periodEnd: string): string {
  const reportYear = Number(periodEnd.slice(0, 4));
  return `${reportYear + 1}-04-15`;
}

type LoadClientResult = { error: string; status: number } | { client: { clientId: string; clientName: string; email: string | null; emailAllowed: boolean; phone: string | null; smsAllowed: boolean } };

async function loadClient(req: AuthedRequest, clientId: string): Promise<LoadClientResult> {
  if (!clientId) return { error: "Client is required.", status: 400 };
  if (!(await canAccessClient(req.user!, clientId))) return { error: "You do not have access to this client.", status: 403 };
  const client = await queryOne<any>(`SELECT client_id, client_name, email, email_allowed, phone, sms_allowed FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return { error: "Client not found.", status: 404 };
  return { client: { clientId: client.client_id, clientName: client.client_name, email: client.email, emailAllowed: Boolean(client.email_allowed), phone: client.phone, smsAllowed: Boolean(client.sms_allowed) } };
}

annualReportFilingsRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.query.clientId || "").trim();
  const loaded = await loadClient(req, clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const rows = await query(`SELECT * FROM altax.v3_annual_report_filings WHERE client_id = $1 ORDER BY period_end DESC`, [clientId]);
  res.json({ filings: rows });
}));

/**
 * EFTPS-style Review & File: splits the requested range into real report
 * years (reusing splitIntoMdFilingPeriods with a fixed "Annually"
 * frequency), and for each year returns whether it's already filed. No
 * live suggested-amount source (flat fee) — amount stays staff-entered.
 */
annualReportFilingsRouter.get("/review", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.query.clientId || "").trim();
  const loaded = await loadClient(req, clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const periodStart = String(req.query.periodStart || "").trim();
  const periodEnd = String(req.query.periodEnd || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    return res.status(400).json({ error: "periodStart and periodEnd must be YYYY-MM-DD." });
  }

  const { splitIntoMdFilingPeriods } = await import("../../common/mdFiling");
  const { periods } = splitIntoMdFilingPeriods(periodStart, periodEnd, "Annually");
  if (!periods.length) return res.json({ years: [] });

  const existingRows = await query<any>(
    `SELECT * FROM altax.v3_annual_report_filings WHERE client_id = $1 AND period_end >= $2::date AND period_end <= $3::date`,
    [clientId, periods[0].start, periods[periods.length - 1].end]
  );
  const existingByPeriodEnd = new Map(existingRows.map((r: any) => [toIsoDateStr(r.period_end), r]));

  const years = periods.map((p) => {
    const existingRaw = existingByPeriodEnd.get(p.end) || null;
    const existingFiling = existingRaw ? { ...existingRaw, period_end: toIsoDateStr(existingRaw.period_end) } : null;
    return { periodStart: p.start, periodEnd: p.end, reportYear: Number(p.start.slice(0, 4)), dueDate: annualReportDueDate(p.end), suggestedAmount: 75, existingFiling };
  });
  res.json({ years });
}));

annualReportFilingsRouter.post("/mark-filed", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const loaded = await loadClient(req, String(body.clientId || "").trim());
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  const periodStart = String(body.periodStart || "").trim();
  const periodEnd = String(body.periodEnd || "").trim();
  const filedDate = String(body.filedDate || "").trim();
  const paidDateRaw = String(body.paidDate || "").trim();
  const paidDate = paidDateRaw ? paidDateRaw : null;
  const amount = Number(body.amount);
  const notify = body.notify === true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || !/^\d{4}-\d{2}-\d{2}$/.test(filedDate)
    || (paidDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) || !Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ error: "periodStart, periodEnd, and filedDate must be YYYY-MM-DD; amount must be a non-negative number." });
  }
  const dueDate = annualReportDueDate(periodEnd);

  const existing = await queryOne<{ period_end: string }>(
    `SELECT period_end FROM altax.v3_annual_report_filings WHERE client_id = $1 AND period_end = $2::date`,
    [client.clientId, periodEnd]
  );
  if (existing) return res.status(400).json({ error: "A filing for this period has already been recorded. Undo it first if you need to re-file." });

  const shareToken = crypto.randomBytes(24).toString("hex");
  const row = await queryOne<{ share_token: string }>(
    `INSERT INTO altax.v3_annual_report_filings (client_id, period_start, period_end, filed_date, paid_date, amount, filed_by, share_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING share_token`,
    [client.clientId, periodStart, periodEnd, filedDate, paidDate, amount, req.user!.email, shareToken]
  );
  await logAudit("Accounting", "ANNUAL_REPORT_FILED", client.clientId, "Period", "", `${periodStart} - ${periodEnd}: filed ${filedDate}${paidDate ? `, paid ${paidDate}` : ""}`,
    `MD Annual Report filing (${periodStart} - ${periodEnd}) marked filed ${filedDate}${paidDate ? `, paid ${paidDate}` : " (payment not yet recorded)"} by ${req.user!.email}.`, req.user!.email);

  await closeObligationTask({
    clientId: client.clientId, keyword: "annual report", dueDate,
    periodLabel: deriveTaskRulesPeriodLabel(periodStart, "Annual"), filedDate, paidDate,
  });

  if (notify) {
    const { sendFilingConfirmation } = await import("../../common/filingConfirmationEmail");
    const sourceRecordId = `${client.clientId}:${periodEnd}`;
    const acknowledgeUrl = `${publicBaseUrl(req) || ""}/public/annual-report/${row?.share_token}`;
    await sendFilingConfirmation({
      client, sourceRecordId, filingType: "Maryland Annual Report", periodLabel: periodStart.slice(0, 4),
      filedDate, amount, paymentDueDate: dueDate, paidDate, acknowledgeUrl, req,
    });
    await query(`UPDATE altax.v3_annual_report_filings SET sent_at = now() WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd]);
    if (!paidDate) {
      const { schedulePaymentReminder } = await import("../../common/paymentReminders");
      await schedulePaymentReminder({
        sourceSystem: "AnnualReportFiling", sourceRecordId, clientId: client.clientId, filingType: "Maryland Annual Report",
        periodLabel: periodStart.slice(0, 4), amount, paymentDueDate: dueDate, createdBy: req.user!.email, leadDays: 3,
      });
    }
  }

  res.json({ ok: true, periodEnd, filedDate, paidDate, amount });
}));

annualReportFilingsRouter.post("/:clientId/:periodEnd/record-payment", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  const periodEnd = req.params.periodEnd;
  const paidDate = String((req.body || {}).paidDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || !/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) {
    return res.status(400).json({ error: "periodEnd and paidDate must be YYYY-MM-DD." });
  }
  const existing = await queryOne<any>(`SELECT period_start, paid_date FROM altax.v3_annual_report_filings WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd]);
  if (!existing) return res.status(400).json({ error: "This period hasn't been marked filed yet — mark it filed first." });
  if (existing.paid_date) return res.status(400).json({ error: "This period already has a payment recorded. Use unmark to correct it, then re-record." });

  await query(`UPDATE altax.v3_annual_report_filings SET paid_date = $3 WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd, paidDate]);
  await logAudit("Accounting", "ANNUAL_REPORT_PAYMENT_RECORDED", client.clientId, "Period", "", `${periodEnd}: paid ${paidDate}`,
    `Payment for MD Annual Report filing (period ending ${periodEnd}) recorded as paid ${paidDate} by ${req.user!.email}.`, req.user!.email);

  // mark-filed already closed the task with paid_date left null when payment
  // wasn't yet known — that flipped its status to Completed, which excludes
  // it from closeObligationTask's own matching query, so this has to fill in
  // paid_date directly rather than calling that again (same gap found and
  // fixed on EFTPS/MD Sales Tax/Form 941/MD UI's record-payment routes).
  const periodStartStr = new Date(existing.period_start).toISOString().slice(0, 10);
  await markObligationTaskPaid({
    clientId: client.clientId, keyword: "annual report", dueDate: annualReportDueDate(periodEnd),
    periodLabel: deriveTaskRulesPeriodLabel(periodStartStr, "Annual"), paidDate,
  });

  const { cancelPaymentReminder } = await import("../../common/paymentReminders");
  await cancelPaymentReminder("AnnualReportFiling", `${client.clientId}:${periodEnd}`, "Payment recorded");

  res.json({ ok: true, periodEnd, paidDate });
}));

/**
 * Independently (re-)sends the filing-confirmation email for an already-filed
 * year — same standalone action EFTPS already has (POST
 * /eftps-deposits/:depositId/send), not just a one-time choice bundled into
 * mark-filed's own `notify` flag.
 */
annualReportFilingsRouter.post("/:clientId/:periodEnd/send", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  const periodEnd = req.params.periodEnd;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return res.status(400).json({ error: "periodEnd must be YYYY-MM-DD." });
  const existing = await queryOne<any>(
    `SELECT period_start, filed_date, paid_date, amount, share_token FROM altax.v3_annual_report_filings WHERE client_id = $1 AND period_end = $2::date`,
    [client.clientId, periodEnd]
  );
  if (!existing) return res.status(400).json({ error: "This period hasn't been marked filed yet — mark it filed first." });

  const periodStartStr = new Date(existing.period_start).toISOString().slice(0, 10);
  const filedDateStr = new Date(existing.filed_date).toISOString().slice(0, 10);
  const paidDateStr = existing.paid_date ? new Date(existing.paid_date).toISOString().slice(0, 10) : null;
  const dueDate = annualReportDueDate(periodEnd);

  const { sendFilingConfirmation } = await import("../../common/filingConfirmationEmail");
  const sourceRecordId = `${client.clientId}:${periodEnd}`;
  const acknowledgeUrl = `${publicBaseUrl(req) || ""}/public/annual-report/${existing.share_token}`;
  await sendFilingConfirmation({
    client, sourceRecordId, filingType: "Maryland Annual Report", periodLabel: periodStartStr.slice(0, 4),
    filedDate: filedDateStr, amount: Number(existing.amount), paymentDueDate: dueDate, paidDate: paidDateStr, acknowledgeUrl, req,
  });

  await query(`UPDATE altax.v3_annual_report_filings SET sent_at = now() WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd]);
  await logAudit("Accounting", "ANNUAL_REPORT_SENT", client.clientId, "Period", "", periodEnd,
    `MD Annual Report filing confirmation (period ending ${periodEnd}) sent by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true });
}));

/**
 * Corrects an already-filed year's stored filed date / paid date / amount —
 * for when the real number on Maryland's own filing portal ends up
 * different from what was entered here. This amount was always
 * staff-entered in the first place (never computed from real transactional
 * data), so overwriting it doesn't create the drift-from-real-data risk
 * that exists for EFTPS/MD Sales Tax/Form 941.
 */
annualReportFilingsRouter.post("/:clientId/:periodEnd/edit", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  const periodEnd = req.params.periodEnd;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return res.status(400).json({ error: "periodEnd must be YYYY-MM-DD." });
  const body = req.body || {};
  const filedDate = String(body.filedDate || "").trim();
  const paidDateRaw = String(body.paidDate || "").trim();
  const paidDate = paidDateRaw ? paidDateRaw : null;
  const amount = Number(body.amount);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filedDate) || (paidDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) || !Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ error: "filedDate must be YYYY-MM-DD; paidDate must be YYYY-MM-DD or empty; amount must be a non-negative number." });
  }

  const existing = await queryOne<any>(`SELECT period_start, paid_date FROM altax.v3_annual_report_filings WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd]);
  if (!existing) return res.status(400).json({ error: "This period hasn't been marked filed yet." });

  await query(
    `UPDATE altax.v3_annual_report_filings SET filed_date = $3, paid_date = $4, amount = $5 WHERE client_id = $1 AND period_end = $2::date`,
    [client.clientId, periodEnd, filedDate, paidDate, amount]
  );
  await logAudit("Accounting", "ANNUAL_REPORT_EDITED", client.clientId, "Period", "", periodEnd,
    `MD Annual Report filing (period ending ${periodEnd}) corrected to filed ${filedDate}${paidDate ? `, paid ${paidDate}` : ""}, amount $${amount.toFixed(2)} by ${req.user!.email}.`, req.user!.email);

  if (paidDate && !existing.paid_date) {
    const periodStartStr = new Date(existing.period_start).toISOString().slice(0, 10);
    await markObligationTaskPaid({
      clientId: client.clientId, keyword: "annual report", dueDate: annualReportDueDate(periodEnd),
      periodLabel: deriveTaskRulesPeriodLabel(periodStartStr, "Annual"), paidDate,
    });
  }

  res.json({ ok: true, periodEnd, filedDate, paidDate, amount });
}));

annualReportFilingsRouter.post("/:clientId/:periodEnd/unmark", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  const periodEnd = req.params.periodEnd;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return res.status(400).json({ error: "periodEnd must be YYYY-MM-DD." });

  await query(`DELETE FROM altax.v3_annual_report_filings WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd]);
  await logAudit("Accounting", "ANNUAL_REPORT_UNMARKED", client.clientId, "Period", "", periodEnd,
    `MD Annual Report filing (period ending ${periodEnd}) un-marked by ${req.user!.email}.`, req.user!.email);

  const { cancelPaymentReminder } = await import("../../common/paymentReminders");
  await cancelPaymentReminder("AnnualReportFiling", `${client.clientId}:${periodEnd}`, "Filing un-marked");

  res.json({ ok: true });
}));
