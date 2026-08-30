/**
 * MD Unemployment Insurance quarterly wage filing record — Phase 2 of the
 * obligation-workflow rollout, same shape as Annual Report (sql/128) and
 * MD Sales Tax (Phase 1). Unlike Annual Report's flat fee, a real starting
 * amount can be suggested from SUM(v3_paychecks.suta) over the period —
 * that column is already a wage-base-capped, experience-rate-applied
 * figure (accounting.routes.ts) — but MD's real Contribution Report can
 * include adjustments this app doesn't model, so it's offered as a
 * suggestion, not force-trusted the way EFTPS/MD Sales Tax's live
 * recompute is: staff can adjust it before filing.
 */
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { logAudit } from "../../common/audit";
import { publicBaseUrl } from "../../common/publicUrl";
import { deriveTaskRulesPeriodLabel, closeTaskRulesAgentTask } from "../../common/taskRulesAgentBridge";

export const mdUiFilingsRouter = Router();

const TASK_NAME = "MD UI Wages Filing & Payment";

/** A DATE column comes back from SELECT * as a JS Date — String(date) gives "Mon Jun 30 2026...", not an ISO string, so the date must be read off the Date object's own toISOString(), not stringified directly. Same fix already applied elsewhere this session (templates.routes.ts's toIsoDateStr). */
function toIsoDateStr(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** MD's real, fixed statutory deadline — the 24th of the month after quarter-end, matching TR-009's rule config (due_day=24). Same convention as mdFiling.ts's mdDueDateForPeriod being a hardcoded statutory fact rather than derived from an editable rule. */
function mdUiDueDate(periodEnd: string): string {
  const [y, m] = periodEnd.split("-").map(Number);
  const dueMonth0 = m === 12 ? 0 : m; // m is 1-indexed; next month 0-indexed
  const dueYear = m === 12 ? y + 1 : y;
  return `${dueYear}-${String(dueMonth0 + 1).padStart(2, "0")}-24`;
}

type LoadClientResult = { error: string; status: number } | { client: { clientId: string; clientName: string; email: string | null; emailAllowed: boolean } };

async function loadClient(req: AuthedRequest, clientId: string): Promise<LoadClientResult> {
  if (!clientId) return { error: "Client is required.", status: 400 };
  if (!(await canAccessClient(req.user!, clientId))) return { error: "You do not have access to this client.", status: 403 };
  const client = await queryOne<any>(`SELECT client_id, client_name, email, email_allowed FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return { error: "Client not found.", status: 404 };
  return { client: { clientId: client.client_id, clientName: client.client_name, email: client.email, emailAllowed: Boolean(client.email_allowed) } };
}

mdUiFilingsRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.query.clientId || "").trim();
  const loaded = await loadClient(req, clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const rows = await query(`SELECT * FROM altax.v3_md_ui_filings WHERE client_id = $1 ORDER BY period_end DESC`, [clientId]);
  res.json({ filings: rows });
}));

/**
 * EFTPS-style Review & File: splits the requested range into real quarters
 * (reusing splitIntoMdFilingPeriods with a fixed "Quarterly" frequency —
 * MD UI has no variable client frequency the way sales tax does), and for
 * each quarter returns either the suggested amount (if not yet filed) or
 * the real recorded filing (if it is) — one row per quarter, same shape
 * EFTPS's GET /review already returns for months.
 */
mdUiFilingsRouter.get("/review", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.query.clientId || "").trim();
  const loaded = await loadClient(req, clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const periodStart = String(req.query.periodStart || "").trim();
  const periodEnd = String(req.query.periodEnd || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    return res.status(400).json({ error: "periodStart and periodEnd must be YYYY-MM-DD." });
  }

  const { splitIntoMdFilingPeriods } = await import("../../common/mdFiling");
  const { periods } = splitIntoMdFilingPeriods(periodStart, periodEnd, "Quarterly");
  if (!periods.length) return res.json({ quarters: [] });

  const existingRows = await query<any>(
    `SELECT * FROM altax.v3_md_ui_filings WHERE client_id = $1 AND period_end >= $2::date AND period_end <= $3::date`,
    [clientId, periods[0].start, periods[periods.length - 1].end]
  );
  const existingByPeriodEnd = new Map(existingRows.map((r: any) => [toIsoDateStr(r.period_end), r]));

  const quarters = [];
  for (const p of periods) {
    const existingRaw = existingByPeriodEnd.get(p.end) || null;
    const existingFiling = existingRaw ? { ...existingRaw, period_end: toIsoDateStr(existingRaw.period_end) } : null;
    let suggestedAmount: number | null = null;
    if (!existingFiling) {
      const row = await queryOne<{ total: string }>(
        `SELECT COALESCE(SUM(suta), 0) AS total FROM altax.v3_paychecks WHERE client_id = $1 AND pay_date::date >= $2::date AND pay_date::date <= $3::date`,
        [clientId, p.start, p.end]
      );
      suggestedAmount = Number(row?.total) || 0;
    }
    quarters.push({ periodStart: p.start, periodEnd: p.end, dueDate: mdUiDueDate(p.end), suggestedAmount, existingFiling });
  }
  res.json({ quarters });
}));

mdUiFilingsRouter.get("/suggested-amount", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.query.clientId || "").trim();
  const loaded = await loadClient(req, clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const periodStart = String(req.query.periodStart || "").trim();
  const periodEnd = String(req.query.periodEnd || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    return res.status(400).json({ error: "periodStart and periodEnd must be YYYY-MM-DD." });
  }
  const row = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(suta), 0) AS total FROM altax.v3_paychecks WHERE client_id = $1 AND pay_date::date >= $2::date AND pay_date::date <= $3::date`,
    [clientId, periodStart, periodEnd]
  );
  res.json({ suggestedAmount: Number(row?.total) || 0 });
}));

mdUiFilingsRouter.post("/mark-filed", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
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
  const dueDate = mdUiDueDate(periodEnd);

  const existing = await queryOne<{ period_end: string }>(
    `SELECT period_end FROM altax.v3_md_ui_filings WHERE client_id = $1 AND period_end = $2::date`,
    [client.clientId, periodEnd]
  );
  if (existing) return res.status(400).json({ error: "A filing for this period has already been recorded. Undo it first if you need to re-file." });

  const periodLabel = deriveTaskRulesPeriodLabel(periodStart, "Quarterly") || `${periodStart} – ${periodEnd}`;
  const shareToken = crypto.randomBytes(24).toString("hex");
  const row = await queryOne<{ share_token: string }>(
    `INSERT INTO altax.v3_md_ui_filings (client_id, period_start, period_end, filed_date, paid_date, amount, filed_by, share_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING share_token`,
    [client.clientId, periodStart, periodEnd, filedDate, paidDate, amount, req.user!.email, shareToken]
  );
  await logAudit("Accounting", "MD_UI_FILED", client.clientId, "Period", "", `${periodStart} - ${periodEnd}: filed ${filedDate}${paidDate ? `, paid ${paidDate}` : ""}`,
    `MD UI wage filing (${periodStart} - ${periodEnd}) marked filed ${filedDate}${paidDate ? `, paid ${paidDate}` : " (payment not yet recorded)"} by ${req.user!.email}.`, req.user!.email);

  await closeTaskRulesAgentTask(client.clientId, TASK_NAME, deriveTaskRulesPeriodLabel(periodStart, "Quarterly"));

  if (notify) {
    const { sendFilingConfirmation } = await import("../../common/filingConfirmationEmail");
    const sourceRecordId = `${client.clientId}:${periodEnd}`;
    const acknowledgeUrl = `${publicBaseUrl(req) || ""}/public/md-ui/${row?.share_token}`;
    await sendFilingConfirmation({
      client, sourceRecordId, filingType: "Maryland Unemployment Insurance", periodLabel,
      filedDate, amount, paymentDueDate: dueDate, paidDate, acknowledgeUrl, req,
    });
    if (!paidDate) {
      const { schedulePaymentReminder } = await import("../../common/paymentReminders");
      await schedulePaymentReminder({
        sourceSystem: "MdUiFiling", sourceRecordId, clientId: client.clientId, filingType: "Maryland Unemployment Insurance",
        periodLabel, amount, paymentDueDate: dueDate, createdBy: req.user!.email, leadDays: 3,
      });
    }
  }

  res.json({ ok: true, periodEnd, filedDate, paidDate, amount });
}));

mdUiFilingsRouter.post("/:clientId/:periodEnd/record-payment", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  const periodEnd = req.params.periodEnd;
  const paidDate = String((req.body || {}).paidDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || !/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) {
    return res.status(400).json({ error: "periodEnd and paidDate must be YYYY-MM-DD." });
  }
  const existing = await queryOne<any>(`SELECT paid_date FROM altax.v3_md_ui_filings WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd]);
  if (!existing) return res.status(400).json({ error: "This period hasn't been marked filed yet — mark it filed first." });
  if (existing.paid_date) return res.status(400).json({ error: "This period already has a payment recorded. Use unmark to correct it, then re-record." });

  await query(`UPDATE altax.v3_md_ui_filings SET paid_date = $3 WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd, paidDate]);
  await logAudit("Accounting", "MD_UI_PAYMENT_RECORDED", client.clientId, "Period", "", `${periodEnd}: paid ${paidDate}`,
    `Payment for MD UI wage filing (period ending ${periodEnd}) recorded as paid ${paidDate} by ${req.user!.email}.`, req.user!.email);

  const { cancelPaymentReminder } = await import("../../common/paymentReminders");
  await cancelPaymentReminder("MdUiFiling", `${client.clientId}:${periodEnd}`, "Payment recorded");

  res.json({ ok: true, periodEnd, paidDate });
}));

mdUiFilingsRouter.post("/:clientId/:periodEnd/unmark", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  const periodEnd = req.params.periodEnd;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return res.status(400).json({ error: "periodEnd must be YYYY-MM-DD." });

  await query(`DELETE FROM altax.v3_md_ui_filings WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd]);
  await logAudit("Accounting", "MD_UI_UNMARKED", client.clientId, "Period", "", periodEnd,
    `MD UI wage filing (period ending ${periodEnd}) un-marked by ${req.user!.email}.`, req.user!.email);

  const { cancelPaymentReminder } = await import("../../common/paymentReminders");
  await cancelPaymentReminder("MdUiFiling", `${client.clientId}:${periodEnd}`, "Filing un-marked");

  res.json({ ok: true });
}));
