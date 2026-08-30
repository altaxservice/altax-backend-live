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
import { deriveTaskRulesPeriodLabel, closeTaskRulesAgentTask } from "../../common/taskRulesAgentBridge";

export const annualReportFilingsRouter = Router();

const TASK_NAME = "MD Annual Report Filing & Payment";

type LoadClientResult = { error: string; status: number } | { client: { clientId: string; clientName: string; email: string | null; emailAllowed: boolean } };

async function loadClient(req: AuthedRequest, clientId: string): Promise<LoadClientResult> {
  if (!clientId) return { error: "Client is required.", status: 400 };
  if (!(await canAccessClient(req.user!, clientId))) return { error: "You do not have access to this client.", status: 403 };
  const client = await queryOne<any>(`SELECT client_id, client_name, email, email_allowed FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return { error: "Client not found.", status: 404 };
  return { client: { clientId: client.client_id, clientName: client.client_name, email: client.email, emailAllowed: Boolean(client.email_allowed) } };
}

annualReportFilingsRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.query.clientId || "").trim();
  const loaded = await loadClient(req, clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const rows = await query(`SELECT * FROM altax.v3_annual_report_filings WHERE client_id = $1 ORDER BY period_end DESC`, [clientId]);
  res.json({ filings: rows });
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
  const dueDate = String(body.dueDate || "").trim();
  const notify = body.notify === true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || !/^\d{4}-\d{2}-\d{2}$/.test(filedDate)
    || (paidDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) || !Number.isFinite(amount) || amount < 0
    || (notify && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))) {
    return res.status(400).json({ error: "periodStart, periodEnd, filedDate (and dueDate, if notifying) must be YYYY-MM-DD; amount must be a non-negative number." });
  }

  const newShareToken = crypto.randomBytes(24).toString("hex");
  const row = await queryOne<{ share_token: string }>(
    `INSERT INTO altax.v3_annual_report_filings (client_id, period_start, period_end, filed_date, paid_date, amount, filed_by, share_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (client_id, period_end) DO UPDATE SET
       period_start = EXCLUDED.period_start, filed_date = EXCLUDED.filed_date, paid_date = EXCLUDED.paid_date,
       amount = EXCLUDED.amount, filed_by = EXCLUDED.filed_by, filed_at = now(),
       share_token = COALESCE(altax.v3_annual_report_filings.share_token, EXCLUDED.share_token)
     RETURNING share_token`,
    [client.clientId, periodStart, periodEnd, filedDate, paidDate, amount, req.user!.email, newShareToken]
  );
  await logAudit("Accounting", "ANNUAL_REPORT_FILED", client.clientId, "Period", "", `${periodStart} - ${periodEnd}: filed ${filedDate}${paidDate ? `, paid ${paidDate}` : ""}`,
    `MD Annual Report filing (${periodStart} - ${periodEnd}) marked filed ${filedDate}${paidDate ? `, paid ${paidDate}` : " (payment not yet recorded)"} by ${req.user!.email}.`, req.user!.email);

  await closeTaskRulesAgentTask(client.clientId, TASK_NAME, deriveTaskRulesPeriodLabel(periodStart, "Annual"));

  if (notify) {
    const { sendFilingConfirmation } = await import("../../common/filingConfirmationEmail");
    const sourceRecordId = `${client.clientId}:${periodEnd}`;
    const acknowledgeUrl = `${publicBaseUrl(req) || ""}/public/annual-report/${row?.share_token}`;
    await sendFilingConfirmation({
      client, sourceRecordId, filingType: "Maryland Annual Report", periodLabel: periodStart.slice(0, 4),
      filedDate, amount, paymentDueDate: dueDate, paidDate, acknowledgeUrl, req,
    });
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
  const existing = await queryOne<any>(`SELECT paid_date FROM altax.v3_annual_report_filings WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd]);
  if (!existing) return res.status(400).json({ error: "This period hasn't been marked filed yet — mark it filed first." });
  if (existing.paid_date) return res.status(400).json({ error: "This period already has a payment recorded. Use unmark to correct it, then re-record." });

  await query(`UPDATE altax.v3_annual_report_filings SET paid_date = $3 WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd, paidDate]);
  await logAudit("Accounting", "ANNUAL_REPORT_PAYMENT_RECORDED", client.clientId, "Period", "", `${periodEnd}: paid ${paidDate}`,
    `Payment for MD Annual Report filing (period ending ${periodEnd}) recorded as paid ${paidDate} by ${req.user!.email}.`, req.user!.email);

  const { cancelPaymentReminder } = await import("../../common/paymentReminders");
  await cancelPaymentReminder("AnnualReportFiling", `${client.clientId}:${periodEnd}`, "Payment recorded");

  res.json({ ok: true, periodEnd, paidDate });
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
