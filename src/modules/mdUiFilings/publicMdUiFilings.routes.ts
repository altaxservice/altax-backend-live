/**
 * Public, no-login MD UI filing view + acknowledge — same pattern as
 * publicAnnualReportFilings.routes.ts. No PDF route — no PDF generator
 * exists for this filing type.
 */
import { Router, Request, Response } from "express";
import { query, queryOne } from "../../config/db";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { rateLimit } from "../../common/rateLimit";
import { notifyStaffOfObligationConfirmed } from "../../common/obligationNotifications";
import { deriveTaskRulesPeriodLabel } from "../../common/taskRulesAgentBridge";

export const publicMdUiFilingsRouter = Router();

const limiter = rateLimit({ name: "public-md-ui", windowMs: 15 * 60 * 1000, max: 20 });

async function findByToken(token: string) {
  return queryOne<any>(`SELECT * FROM altax.v3_md_ui_filings WHERE share_token = $1`, [token]);
}

function toIsoDate(v: unknown): string | undefined {
  if (!v) return undefined;
  const raw = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

publicMdUiFilingsRouter.get("/:token", limiter, asyncHandler(async (req: Request, res: Response) => {
  const filing = await findByToken(req.params.token);
  if (!filing) return res.status(404).json({ error: "This link is invalid or has expired." });

  const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [filing.client_id]);
  res.json({
    filing: {
      client_name: client?.client_name || "",
      period_start: filing.period_start, period_end: filing.period_end,
      filed_date: filing.filed_date, paid_date: filing.paid_date, amount: filing.amount,
      acknowledged_at: filing.acknowledged_at,
    },
  });
}));

publicMdUiFilingsRouter.post("/:token/acknowledge", limiter, asyncHandler(async (req: Request, res: Response) => {
  const filing = await findByToken(req.params.token);
  if (!filing) return res.status(404).json({ error: "This link is invalid or has expired." });

  const ip = String(req.ip || req.socket.remoteAddress || "").slice(0, 64) || null;
  const claimed = await query<{ client_id: string }>(
    `UPDATE altax.v3_md_ui_filings SET acknowledged_at = now(), acknowledged_ip = $2
      WHERE share_token = $1 AND acknowledged_at IS NULL
      RETURNING client_id`,
    [req.params.token, ip]
  );
  if (claimed.length === 0) return res.json({ ok: true, alreadyAcknowledged: true });

  const acknowledgedAt = new Date().toISOString();
  await logAudit("Accounting", "MD_UI_ACKNOWLEDGED", filing.client_id, "acknowledged_at", "", acknowledgedAt,
    `MD UI wage filing (${filing.period_start} - ${filing.period_end}) acknowledged by the client from IP ${ip || "unknown"}.`, "Client");

  const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [filing.client_id]);
  const periodStartIso = toIsoDate(filing.period_start);
  await notifyStaffOfObligationConfirmed({
    clientId: filing.client_id, clientName: client?.client_name || filing.client_id,
    filingType: "Maryland Unemployment Insurance",
    periodLabel: (periodStartIso && deriveTaskRulesPeriodLabel(periodStartIso, "Quarterly")) || null,
    amount: Number(filing.amount), acknowledgedAt, acknowledgedIp: ip, req,
  });

  res.json({ ok: true, alreadyAcknowledged: false });
}));
