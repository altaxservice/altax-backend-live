/**
 * Public, no-login MD Annual Report filing view + acknowledge — the
 * "share link" destination linked from the Save & Send email. Same pattern
 * as publicEftpsDeposit.routes.ts/publicMdFiling.routes.ts: access gated
 * entirely by knowing the opaque share_token, not by a portal account.
 * No PDF route — no PDF generator exists for this filing type.
 */
import { Router, Request, Response } from "express";
import { query, queryOne } from "../../config/db";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { rateLimit } from "../../common/rateLimit";
import { notifyStaffOfObligationConfirmed } from "../../common/obligationNotifications";

export const publicAnnualReportFilingsRouter = Router();

const limiter = rateLimit({ name: "public-annual-report", windowMs: 15 * 60 * 1000, max: 20 });

async function findByToken(token: string) {
  return queryOne<any>(`SELECT * FROM altax.v3_annual_report_filings WHERE share_token = $1`, [token]);
}

/** A DATE column comes back from SELECT * as a JS Date — String(date) gives "Sat Aug 01 2026...", not an ISO string, so the year must be read off the Date object (or its ISO form) directly. */
function yearOf(periodStart: unknown): string {
  if (periodStart instanceof Date) return String(periodStart.getUTCFullYear());
  return String(periodStart).slice(0, 4);
}

publicAnnualReportFilingsRouter.get("/:token", limiter, asyncHandler(async (req: Request, res: Response) => {
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

publicAnnualReportFilingsRouter.post("/:token/acknowledge", limiter, asyncHandler(async (req: Request, res: Response) => {
  const filing = await findByToken(req.params.token);
  if (!filing) return res.status(404).json({ error: "This link is invalid or has expired." });

  const ip = String(req.ip || req.socket.remoteAddress || "").slice(0, 64) || null;
  const claimed = await query<{ client_id: string }>(
    `UPDATE altax.v3_annual_report_filings SET acknowledged_at = now(), acknowledged_ip = $2
      WHERE share_token = $1 AND acknowledged_at IS NULL
      RETURNING client_id`,
    [req.params.token, ip]
  );
  if (claimed.length === 0) return res.json({ ok: true, alreadyAcknowledged: true });

  const acknowledgedAt = new Date().toISOString();
  await logAudit("Accounting", "ANNUAL_REPORT_ACKNOWLEDGED", filing.client_id, "acknowledged_at", "", acknowledgedAt,
    `MD Annual Report filing (${filing.period_start} - ${filing.period_end}) acknowledged by the client from IP ${ip || "unknown"}.`, "Client");

  const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [filing.client_id]);
  await notifyStaffOfObligationConfirmed({
    clientId: filing.client_id, clientName: client?.client_name || filing.client_id,
    filingType: "Maryland Annual Report", periodLabel: yearOf(filing.period_start),
    amount: Number(filing.amount), acknowledgedAt, acknowledgedIp: ip, req,
  });

  res.json({ ok: true, alreadyAcknowledged: false });
}));
