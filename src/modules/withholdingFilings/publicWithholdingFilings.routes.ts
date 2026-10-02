/**
 * Public, no-login withholding filing view + acknowledge — the destination of
 * the "I've reviewed this" link in the filing confirmation email/SMS. Mirror of
 * publicDcFiling.routes.ts: access is gated entirely by the opaque share token.
 */
import { Router, Request, Response } from "express";
import { query, queryOne } from "../../config/db";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { rateLimit } from "../../common/rateLimit";
import { notifyStaffOfObligationConfirmed } from "../../common/obligationNotifications";
import { stateDisplayName } from "../../common/stateNames";

export const publicWithholdingFilingsRouter = Router();

const limiter = rateLimit({ name: "public-withholding-filing", windowMs: 15 * 60 * 1000, max: 20 });

async function findByToken(token: string) {
  return queryOne<any>(`SELECT * FROM altax.v3_withholding_filings WHERE share_token = $1`, [token]);
}

function fmtPeriodLabel(start: unknown, end: unknown): string {
  const fmt = (v: unknown) => {
    const raw = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
    const d = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

function filingType(state: unknown): string {
  const code = String(state || "").trim().toUpperCase();
  return `${code === "DC" ? "DC" : stateDisplayName(code) ?? "State"} Withholding Tax`;
}

publicWithholdingFilingsRouter.get("/:token", limiter, asyncHandler(async (req: Request, res: Response) => {
  const filing = await findByToken(req.params.token);
  if (!filing) return res.status(404).json({ error: "This link is invalid or has expired." });
  const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [filing.client_id]);
  res.json({
    filing: {
      client_name: client?.client_name || "", filing_type: filingType(filing.state),
      period_start: filing.period_start, period_end: filing.period_end,
      filed_date: filing.filed_date, paid_date: filing.paid_date,
      tax_due: filing.tax_due, balance_due: filing.balance_due, on_time: filing.on_time,
      acknowledged_at: filing.acknowledged_at,
    },
  });
}));

publicWithholdingFilingsRouter.post("/:token/acknowledge", limiter, asyncHandler(async (req: Request, res: Response) => {
  const filing = await findByToken(req.params.token);
  if (!filing) return res.status(404).json({ error: "This link is invalid or has expired." });

  const ip = String(req.ip || req.socket.remoteAddress || "").slice(0, 64) || null;
  const claimed = await query<{ client_id: string }>(
    `UPDATE altax.v3_withholding_filings SET acknowledged_at = now(), acknowledged_ip = $2
      WHERE share_token = $1 AND acknowledged_at IS NULL RETURNING client_id`,
    [req.params.token, ip]
  );
  if (claimed.length === 0) return res.json({ ok: true, alreadyAcknowledged: true });

  const acknowledgedAt = new Date().toISOString();
  await logAudit("Accounting", "WITHHOLDING_FILING_ACKNOWLEDGED", filing.client_id, "acknowledged_at", "", acknowledgedAt,
    `${filing.state || ""} withholding filing (${filing.period_start} - ${filing.period_end}) acknowledged by the client from IP ${ip || "unknown"}.`, "Client");
  const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [filing.client_id]);
  await notifyStaffOfObligationConfirmed({
    clientId: filing.client_id, clientName: client?.client_name || filing.client_id,
    filingType: filingType(filing.state), periodLabel: fmtPeriodLabel(filing.period_start, filing.period_end),
    amount: Number(filing.tax_due), acknowledgedAt, acknowledgedIp: ip, req,
  });
  res.json({ ok: true, alreadyAcknowledged: false });
}));
